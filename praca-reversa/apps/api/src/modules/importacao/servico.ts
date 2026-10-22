/**
 * Lotes de importação: envio do arquivo, leitura da estrutura, prévia
 * versionada, confirmação, descarte e consultas. Tudo no servidor e restrito
 * ao escopo ativo; o navegador nunca envia linhas "já validadas".
 *
 * Confirmação (na transação da idempotência):
 * 1. bloqueio consultivo por escopo: confirmações de importação do mesmo escopo
 *    acontecem uma de cada vez;
 * 2. lote bloqueado (FOR UPDATE); lote já confirmado → resultado existente;
 * 3. versão da prévia conferida; o arquivo guardado é relido com o mapeamento
 *    guardado e reclassificado contra os dados atuais;
 * 4. assinatura diferente da revisada → prévia desatualizada (nada gravado);
 * 5. gravação dos registros, linhas finais, lote CONFIRMADO e auditoria juntos.
 * Restrições únicas no banco (SKU, código, documento/linha, arquivo
 * confirmado) protegem lotes concorrentes.
 */
import {
  ACOES_INVENTARIO_APLICAVEIS,
  ParametrosBipagemSchema,
  ParametrosInventarioSchema,
  ResumoBipagemSchema,
  ParametrosSelecaoSchema,
  TIPOS_IMPORTACAO,
  camposDoTipo,
  verificarMapeamento,
  type ConfirmarImportacaoSchema,
  type ParametrosBipagem,
  type ParametrosInventario,
  type ParametrosSelecao,
  type ResumoBipagem,
  type ConsultaEstrutura,
  type EstruturaArquivo,
  type FormatoArquivo,
  type Escopo,
  type FiltroLinhas,
  type FiltroLotes,
  type LimitesImportacao,
  type LinhaImportacao,
  type LoteImportacao,
  type LoteResumo,
  type MotivoLinha,
  type OpcoesLeitura,
  type PaginaLinhas,
  type PaginaLotes,
  type ResultadoConfirmacao,
  type ResultadoEnvio,
  type ResultadoGravacao,
  type SeparadorDecimal,
  type TipoImportacao,
  type Mapeamento,
} from '@praca-reversa/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica } from '../../db/erros.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { jsonCanonico } from '../idempotencia/executar.js';
import { ErroArquivo } from './arquivo/erros.js';
import { detectarFormato, lerTabela, type FormatoTabela, type Tabela } from './arquivo/ler.js';
import { carregarDestino, classificarBipagem, gravarBipagem, importacoesAnteriores, interpretarBipagem, reconhecerBipagem } from './bipagem.js';
import { sugerirColunas } from './campos.js';
import { carregarEstadoClaims, classificarClaims, gravarClaims, interpretarClaims } from './claims.js';
import { carregarEstadoDevolucoes, classificarDevolucoes, gravarDevolucoes, interpretarDevolucoes } from './devolucoes.js';
import { carregarEstadoInventario, classificarInventario, gravarInventario, interpretarInventario } from './inventario.js';
import { carregarEstadoProdutos, classificarProdutos, gravarProdutos, interpretarProdutos } from './produtos.js';
import { carregarEstadoSelecao, classificarSelecao, gravarSelecao, interpretarSelecao } from './selecao.js';
import type { LinhaClassificada } from './tipos.js';
import type { z } from 'zod';

type Db = Banco | Transacao;
type ConfirmarImportacao = z.output<typeof ConfirmarImportacaoSchema>;

/** Limites por tipo de importação (inventário e seleção têm limites próprios). */
export type LimitesPorTipo = (tipo: TipoImportacao) => LimitesImportacao;
type Limites = LimitesImportacao | LimitesPorTipo;
const limitesDe = (limites: Limites, tipo: TipoImportacao): LimitesImportacao => (typeof limites === 'function' ? limites(tipo) : limites);

/** Tipos de planilha operacional (inventário e seleção): parâmetros próprios e limites maiores. */
export const TIPOS_PLANILHA: readonly TipoImportacao[] = ['INVENTARIO', 'SELECAO_CLIENTE', 'BIPAGEM'];

/** Parâmetros validados do tipo (`null` nos tipos sem parâmetros). */
export function parametrosDoTipo(tipo: TipoImportacao, bruto: unknown): ParametrosInventario | ParametrosSelecao | ParametrosBipagem | null {
  if (tipo === 'INVENTARIO' || tipo === 'SELECAO_CLIENTE' || tipo === 'BIPAGEM') {
    const schema = tipo === 'INVENTARIO' ? ParametrosInventarioSchema : tipo === 'SELECAO_CLIENTE' ? ParametrosSelecaoSchema : ParametrosBipagemSchema;
    const r = schema.safeParse(bruto ?? {});
    if (!r.success) {
      const problema = r.error.issues[0];
      const campo = problema?.path.join('.') ?? '';
      throw requisicaoInvalida(`Parâmetros da importação: ${campo ? `${campo}: ` : ''}${problema?.message ?? 'inválidos'}.`);
    }
    return r.data;
  }
  return null;
}

/** Resumo da prévia gravado no lote: linhas de texto, bloqueio geral (quando houver) e, na bipagem, o resumo estruturado. */
interface ResumoPrevia {
  linhas: string[];
  bloqueio: string | null;
  bipagem?: ResumoBipagem | null;
}

function resumoPreviaDe(v: unknown): ResumoPrevia {
  if (typeof v === 'object' && v !== null && 'linhas' in v && Array.isArray((v as ResumoPrevia).linhas)) {
    const r = v as ResumoPrevia;
    const bipagem = ResumoBipagemSchema.safeParse((v as { bipagem?: unknown }).bipagem);
    return {
      linhas: r.linhas.filter((x): x is string => typeof x === 'string'),
      bloqueio: typeof r.bloqueio === 'string' ? r.bloqueio : null,
      bipagem: bipagem.success ? bipagem.data : null,
    };
  }
  return { linhas: [], bloqueio: null, bipagem: null };
}

export interface Autor {
  usuarioId: string;
  requestId: string;
}

const pessoaSelect = { select: { login: true, nome: true } } as const;
const pessoa = (u: { login: string; nome: string } | null) => (u ? { login: u.login, name: u.nome } : null);

const selecaoLote = {
  id: true,
  tipo: true,
  situacao: true,
  formato: true,
  nomeArquivo: true,
  hashArquivo: true,
  tamanhoBytes: true,
  paleteId: true,
  opcoes: true,
  separadorDecimal: true,
  colunas: true,
  parametros: true,
  resumoPrevia: true,
  excluidas: true,
  versao: true,
  versaoPrevia: true,
  assinaturaPrevia: true,
  previaGeradaEm: true,
  totalLinhas: true,
  linhasVazias: true,
  validasNovas: true,
  duplicadas: true,
  invalidas: true,
  conflitantes: true,
  gravadas: true,
  ignoradas: true,
  resultado: true,
  criadoEm: true,
  confirmadoEm: true,
  descartadoEm: true,
  ultimaFalhaEm: true,
  ultimaFalha: true,
  criadoPor: pessoaSelect,
  confirmadoPor: pessoaSelect,
} as const satisfies Prisma.LoteImportacaoSelect;

type LoteSelecionado = Prisma.LoteImportacaoGetPayload<{ select: typeof selecaoLote }>;

export const OPCOES_PADRAO: OpcoesLeitura = { sheet: null, headerRow: 1, encoding: null, delimiter: null };

function resumo(l: LoteSelecionado): LoteResumo {
  return {
    id: l.id,
    type: l.tipo,
    state: l.situacao,
    format: l.formato,
    fileName: l.nomeArquivo,
    fileHash: l.hashArquivo,
    fileSize: l.tamanhoBytes,
    createdAt: l.criadoEm.toISOString(),
    createdBy: pessoa(l.criadoPor),
    confirmedAt: l.confirmadoEm?.toISOString() ?? null,
    confirmedBy: pessoa(l.confirmadoPor),
    discardedAt: l.descartadoEm?.toISOString() ?? null,
    previewVersion: l.versaoPrevia,
    palletId: l.paleteId,
    counters: {
      total: l.totalLinhas,
      empty: l.linhasVazias,
      validNew: l.validasNovas,
      duplicate: l.duplicadas,
      invalid: l.invalidas,
      conflicting: l.conflitantes,
      excluded: l.excluidas,
      written: l.gravadas,
      ignored: l.ignoradas,
    },
    lastFailure: l.ultimaFalhaEm && l.ultimaFalha ? { at: l.ultimaFalhaEm.toISOString(), message: l.ultimaFalha } : null,
  };
}

function bloqueio(l: LoteSelecionado): string | null {
  if (l.situacao === 'CONFIRMADO') return 'Lote já confirmado.';
  if (l.situacao === 'DESCARTADO') return 'Lote descartado: nada foi gravado.';
  if (l.situacao === 'AGUARDANDO_MAPEAMENTO') return 'Escolha a planilha e as colunas e gere a prévia.';
  if (l.totalLinhas === 0) return 'O arquivo não tem linhas de dados.';
  const geral = resumoPreviaDe(l.resumoPrevia).bloqueio;
  if (geral !== null) return geral;
  // Inventário conferido: linhas com pendência ficam registradas como não aplicadas (não bloqueiam o conjunto válido).
  if (l.tipo === 'INVENTARIO') return null;
  if (l.tipo === 'BIPAGEM' && (l.invalidas > 0 || l.conflitantes > 0 || l.validasNovas === 0)) {
    return 'Há linhas com erro, notas repetidas aguardando escolha ou nada a acrescentar: veja a prévia.';
  }
  if (l.invalidas > 0 || l.conflitantes > 0) {
    return `${String(l.invalidas)} linha(s) inválida(s) e ${String(l.conflitantes)} conflitante(s) precisam de correção: corrija o arquivo de origem (ou o mapeamento) e envie de novo.`;
  }
  if (l.tipo === 'SELECAO_CLIENTE' && l.validasNovas === 0) return 'Nenhuma linha selecionada: confira a coluna de marcação e os valores que significam seleção.';
  return null;
}

function detalhe(l: LoteSelecionado, limites: Limites): LoteImportacao {
  const motivo = bloqueio(l);
  return {
    ...resumo(l),
    version: l.versao,
    previewGeneratedAt: l.previaGeradaEm?.toISOString() ?? null,
    options: (l.opcoes as OpcoesLeitura | null) ?? null,
    decimalSeparator: (l.separadorDecimal as SeparadorDecimal | null) ?? null,
    columns: (l.colunas as Record<string, number | null> | null) ?? null,
    parameters: (l.parametros as LoteImportacao['parameters'] | null) ?? null,
    previewSummary: resumoPreviaDe(l.resumoPrevia).linhas,
    canConfirm: motivo === null,
    blockReason: motivo,
    result: (l.resultado as ResultadoGravacao | null) ?? null,
    limits: limitesDe(limites, l.tipo),
    palletImport: l.tipo === 'BIPAGEM' ? (resumoPreviaDe(l.resumoPrevia).bipagem ?? null) : null,
  };
}

async function lerLote(db: Db, escopoId: string, id: string): Promise<LoteSelecionado> {
  const l = await db.loteImportacao.findFirst({ where: { id, escopoId }, select: selecaoLote });
  if (!l) throw naoEncontrado('Lote de importação não encontrado neste escopo.');
  return l;
}

/** Lote do escopo (detalhe), ou 404 — também para lote de outro escopo. */
export async function detalharLote(db: Db, escopoId: string, id: string, limites: Limites): Promise<LoteImportacao> {
  return detalhe(await lerLote(db, escopoId, id), limites);
}

function paraHttp(erro: unknown): never {
  if (erro instanceof ErroArquivo) throw new ErroHttp(400, 'ARQUIVO_INVALIDO', erro.message);
  throw erro;
}

// ---------- Estrutura ----------

function estrutura(tipo: TipoImportacao, tabela: Tabela): EstruturaArquivo {
  const amostra = tabela.linhas.slice(0, 10).map((l) => ({
    row: l.numero,
    cells: tabela.cabecalho.map((c) => {
      const celula = l.celulas[c.indice];
      if (celula === undefined) return { text: null, kind: 'VAZIO' as const };
      const texto = celula.texto === null ? null : celula.texto.length > 120 ? `${celula.texto.slice(0, 120)}…` : celula.texto;
      return { text: texto, kind: celula.formula ? ('FORMULA' as const) : celula.tipo };
    }),
  }));
  return {
    format: tabela.formato,
    sheets: tabela.planilhas.map((p) => ({ name: p.nome, hidden: p.oculta, rows: p.linhas })),
    options: tabela.opcoes,
    interpretation: tabela.interpretacao,
    headers: tabela.cabecalho.map((c) => ({ index: c.indice, letter: c.letra, text: c.texto })),
    sample: amostra,
    dataRows: tabela.linhas.length,
    emptyRows: tabela.vazias,
    suggestedColumns: sugerirColunas(tipo, tabela.cabecalho),
    warnings: tabela.avisos,
    fontColors: coresDeFonte(tabela),
  };
}

/** Cores de fonte gravadas nas células de dados, por coluna (padrão/sem cor não entra). */
function coresDeFonte(tabela: Tabela): EstruturaArquivo['fontColors'] {
  if (tabela.formato !== 'XLSX') return [];
  const porColuna = new Map<number, Map<string, number>>();
  for (const l of tabela.linhas) {
    l.celulas.forEach((c, indice) => {
      const cor = c?.corFonte ?? null;
      if (cor === null || cor === 'TEMA:1' || cor === 'FF000000') return;
      const m = porColuna.get(indice) ?? new Map<string, number>();
      m.set(cor, (m.get(cor) ?? 0) + 1);
      porColuna.set(indice, m);
    });
  }
  return [...porColuna.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, cores]) => ({ index, colors: [...cores.entries()].sort((a, b) => b[1] - a[1]).map(([color, cells]) => ({ color, cells })) }));
}

/** Lote da carga em lote (pacote JSON, comando local) não tem leitura de planilha nem prévia na tela. */
function formatoTabular(formato: FormatoArquivo): FormatoTabela {
  if (formato === 'JSON') throw new ErroHttp(409, 'CONFLITO', 'Este lote veio da carga em lote (pacote JSON) pelo comando local: não tem leitura de planilha nem prévia na tela.');
  return formato;
}

/** Lê e valida o arquivo recebido (antes de gravar qualquer coisa). */
export function analisarArquivo(conteudo: Buffer, nomeArquivo: string, limites: LimitesImportacao): { formato: FormatoTabela; tabela: Tabela; hash: string } {
  if (conteudo.length > limites.maxBytes) {
    throw new ErroHttp(413, 'ARQUIVO_INVALIDO', `Arquivo acima do limite de ${String(Math.round(limites.maxBytes / 1_048_576))} MB.`);
  }
  try {
    const formato = detectarFormato(conteudo, nomeArquivo);
    const tabela = lerTabela(conteudo, formato, OPCOES_PADRAO, limites);
    return { formato, tabela, hash: createHash('sha256').update(conteudo).digest('hex') };
  } catch (erro) {
    return paraHttp(erro);
  }
}

/** Grava o lote recebido (sem prévia). Mesmo arquivo já confirmado → resultado existente, nada novo. */
export async function registrarEnvio(
  tx: Transacao,
  escopo: Escopo,
  autor: Autor,
  dados: { tipo: TipoImportacao; nomeArquivo: string; conteudo: Buffer; formato: 'CSV' | 'XLSX'; tabela: Tabela; hash: string; paleteId?: string | null },
  limites: Limites,
  agora: Date = new Date(),
): Promise<{ status: number; corpo: ResultadoEnvio }> {
  // Bipagem (21 out.): o lote nasce sem palete — o destino é escolhido no mapa e gravado na confirmação.
  // O palete aberto (atalho da janela do palete) vira o destino inicial. O mesmo arquivo já importado
  // não é recusado aqui: a prévia avisa e pede a confirmação de nova operação.
  const paleteInicial = dados.tipo === 'BIPAGEM' ? (dados.paleteId ?? null) : null;
  if (paleteInicial !== null) {
    const palete = await tx.palete.findFirst({ where: { id: paleteInicial, escopoId: escopo.id }, select: { id: true } });
    if (!palete) throw naoEncontrado('Palete de destino não encontrado neste escopo.');
  }
  const confirmado =
    dados.tipo === 'BIPAGEM'
      ? null
      : await tx.loteImportacao.findFirst({ where: { escopoId: escopo.id, tipo: dados.tipo, hashArquivo: dados.hash, situacao: 'CONFIRMADO' }, select: selecaoLote });
  if (confirmado) {
    return { status: 200, corpo: { batch: null, structure: null, alreadyImported: resumo(confirmado), openDuplicates: [] } };
  }
  const abertos = await tx.loteImportacao.findMany({
    where: { escopoId: escopo.id, tipo: dados.tipo, hashArquivo: dados.hash, situacao: { in: ['AGUARDANDO_MAPEAMENTO', 'PREVIA'] }, criadoPorId: dados.tipo === 'BIPAGEM' ? autor.usuarioId : undefined },
    select: { id: true },
    orderBy: { criadoEm: 'asc' },
  });
  const id = randomUUID();
  await tx.loteImportacao.create({
    data: {
      id,
      escopoId: escopo.id,
      tipo: dados.tipo,
      situacao: 'AGUARDANDO_MAPEAMENTO',
      formato: dados.formato,
      nomeArquivo: dados.nomeArquivo,
      hashArquivo: dados.hash,
      tamanhoBytes: dados.conteudo.length,
      paleteId: null,
      criadoPorId: autor.usuarioId,
    },
  });
  await tx.arquivoImportacao.create({ data: { loteId: id, escopoId: escopo.id, conteudo: new Uint8Array(dados.conteudo) } });
  await registrarEvento(tx, {
    acao: 'IMPORTACAO_ENVIADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'LOTE_IMPORTACAO',
    alvoId: id,
    detalhes: { tipo: dados.tipo, formato: dados.formato, bytes: dados.conteudo.length, hash: dados.hash, linhas: dados.tabela.linhas.length, ...(paleteInicial === null ? {} : { palete: paleteInicial }) },
    requestId: autor.requestId,
  });
  // Bipagem: os campos são reconhecidos pelo nome e a prévia sai junto com o envio (sem mapeamento manual).
  const batch =
    dados.tipo === 'BIPAGEM'
      ? await gerarPrevia(
          tx,
          escopo,
          autor,
          id,
          { expectedVersion: 1, options: OPCOES_PADRAO, decimalSeparator: 'VIRGULA', columns: {}, parameters: paleteInicial === null ? null : { destination: { kind: 'PALETE', id: paleteInicial } } },
          limites,
          agora,
        )
      : detalhe(await lerLote(tx, escopo.id, id), limites);
  return {
    status: 201,
    corpo: {
      batch,
      structure: estrutura(dados.tipo, dados.tabela),
      alreadyImported: null,
      openDuplicates: abertos.map((a) => a.id),
    },
  };
}

async function lerArquivo(db: Db, escopoId: string, loteId: string): Promise<Buffer> {
  const arquivo = await db.arquivoImportacao.findFirst({ where: { loteId, escopoId }, select: { conteudo: true } });
  if (!arquivo) throw naoEncontrado('Arquivo do lote não encontrado.');
  return Buffer.from(arquivo.conteudo);
}

/** Estrutura do arquivo com outras opções de leitura (planilha, cabeçalho, codificação, delimitador). */
export async function consultarEstrutura(db: Db, escopoId: string, loteId: string, consulta: ConsultaEstrutura, limites: Limites): Promise<EstruturaArquivo> {
  const lote = await lerLote(db, escopoId, loteId);
  const conteudo = await lerArquivo(db, escopoId, loteId);
  const opcoes: OpcoesLeitura = {
    sheet: consulta.sheet ?? null,
    headerRow: consulta.headerRow ?? 1,
    encoding: consulta.encoding ?? null,
    delimiter: consulta.delimiter ?? null,
  };
  try {
    return estrutura(lote.tipo, lerTabela(conteudo, formatoTabular(lote.formato), opcoes, limitesDe(limites, lote.tipo)));
  } catch (erro) {
    return paraHttp(erro);
  }
}

// ---------- Prévia ----------

/** Dados do lote usados na gravação (fotografia do inventário e da seleção). */
interface ContextoGravacao {
  loteId: string;
  nomeArquivo: string;
  hashArquivo: string;
  aba: string | null;
  /** Inventário: linhas aplicáveis deixadas de fora na confirmação. */
  excluidas: ReadonlySet<number>;
}

const RESULTADO_VAZIO: ResultadoGravacao = {
  productsCreated: 0,
  barcodesAdded: 0,
  documentsCreated: 0,
  documentLinesCreated: 0,
  claimsCreated: 0,
  claimLinesCreated: 0,
  inventoryId: null,
  inventoryLines: 0,
  inventoryLinesApplied: 0,
  inventoryLinesPending: 0,
  documentLinksCreated: 0,
  palletsCreated: 0,
  palletsLocated: 0,
  selectionId: null,
  selectionLines: 0,
  documentLinksEnded: 0,
  palletId: null,
  documentsWritten: 0,
  contentsCreated: 0,
  countsRegistered: 0,
  documentsUnchanged: 0,
  recordsWithoutReads: 0,
  volumesRead: 0,
  palletCode: null,
  palletCreated: false,
  rowsRevalidated: 0,
};

interface Classificacao {
  tabela: Tabela;
  /** Colunas efetivamente usadas (na bipagem, as reconhecidas pelo servidor). */
  colunas: Record<string, number | null>;
  linhas: LinhaClassificada[];
  assinatura: string;
  resumo: ResumoPrevia;
  gravar: (tx: Transacao, escopo: Escopo, autor: Autor, contexto: ContextoGravacao, agora: Date) => Promise<{ resultado: ResultadoGravacao; registros: Map<number, string> }>;
}

async function classificarArquivo(
  db: Db,
  escopoId: string,
  tipo: TipoImportacao,
  formato: 'CSV' | 'XLSX',
  conteudo: Buffer,
  opcoes: OpcoesLeitura,
  colunas: Record<string, number | null>,
  separador: SeparadorDecimal,
  limites: LimitesImportacao,
  bloquear: boolean,
  parametros: ParametrosInventario | ParametrosSelecao | ParametrosBipagem | null,
  lote: { id: string; hashArquivo: string },
): Promise<Classificacao> {
  let tabela: Tabela;
  try {
    if (tipo === 'BIPAGEM') {
      const r = reconhecerBipagem(conteudo, formato, limites);
      tabela = r.tabela;
      colunas = r.colunas;
    } else {
      tabela = lerTabela(conteudo, formato, opcoes, limites);
    }
  } catch (erro) {
    return paraHttp(erro);
  }
  for (const [campo, coluna] of Object.entries(colunas)) {
    if (coluna !== null && coluna >= tabela.cabecalho.length) {
      throw requisicaoInvalida(`A coluna escolhida para ${campo} não existe no cabeçalho desta planilha.`);
    }
  }
  const entrada = { tabela, colunas, separador, limites };
  const semResumo: ResumoPrevia = { linhas: [], bloqueio: null };
  if (tipo === 'PRODUTOS') {
    const interpretadas = interpretarProdutos(entrada);
    const estado = await carregarEstadoProdutos(db, escopoId, interpretadas, bloquear);
    const { linhas, plano } = classificarProdutos(interpretadas, estado);
    return {
      tabela,
      colunas,
      linhas,
      assinatura: assinar(linhas),
      resumo: semResumo,
      gravar: async (tx, e, autor) => {
        const r = await gravarProdutos(tx, e.id, autor.usuarioId, plano);
        return { resultado: { ...RESULTADO_VAZIO, productsCreated: r.produtosCriados, barcodesAdded: r.codigosAdicionados }, registros: plano.registroPorLinha };
      },
    };
  }
  if (tipo === 'CLAIMS') {
    const interpretadas = interpretarClaims(entrada);
    const estado = await carregarEstadoClaims(db, escopoId, interpretadas, bloquear);
    const { linhas, plano } = classificarClaims(interpretadas, estado);
    return {
      tabela,
      colunas,
      linhas,
      assinatura: assinar(linhas),
      resumo: semResumo,
      gravar: async (tx, e, autor, contexto, agora) => {
        const r = await gravarClaims(tx, e.id, contexto.loteId, plano, autor.usuarioId, agora);
        return { resultado: { ...RESULTADO_VAZIO, claimsCreated: r.casosCriados, claimLinesCreated: r.linhasCriadas }, registros: plano.registroPorLinha };
      },
    };
  }
  if (tipo === 'INVENTARIO') {
    const p = parametros as ParametrosInventario;
    const interpretadas = interpretarInventario(entrada, p);
    const estado = await carregarEstadoInventario(db, escopoId, interpretadas, p);
    const { linhas, plano } = classificarInventario(interpretadas, estado, p);
    const faltas = [
      ...(p.definitive ? [] : ['confirme que este é o arquivo identificado pela operação como versão definitiva']),
      ...(p.palletNumberMeaning === null ? ['confirme se o N° Pallet identifica o palete ou numera a posição'] : []),
    ];
    return {
      tabela,
      colunas,
      linhas,
      assinatura: assinar(linhas, p),
      resumo: { linhas: plano.resumo, bloqueio: faltas.length > 0 ? `Antes de confirmar: ${faltas.join('; ')}.` : null },
      gravar: async (tx, e, autor, contexto, agora) => {
        const r = await gravarInventario(tx, e, autor, { id: contexto.loteId, nomeArquivo: contexto.nomeArquivo, hashArquivo: contexto.hashArquivo, aba: contexto.aba }, plano, contexto.excluidas, agora);
        return {
          resultado: {
            ...RESULTADO_VAZIO,
            inventoryId: r.resultado.inventarioId,
            inventoryLines: r.resultado.linhas,
            inventoryLinesApplied: r.resultado.aplicadas,
            inventoryLinesPending: r.resultado.pendentes,
            documentLinksCreated: r.resultado.vinculos,
            palletsCreated: r.resultado.paletesCriados,
            palletsLocated: r.resultado.localizacoes,
          },
          registros: r.registros,
        };
      },
    };
  }
  if (tipo === 'BIPAGEM') {
    const p = parametros as ParametrosBipagem;
    const interpretadas = interpretarBipagem(entrada);
    const destino = await carregarDestino(db, escopoId, p.destination, bloquear);
    const anteriores = await importacoesAnteriores(db, escopoId, lote.id, lote.hashArquivo);
    const { linhas, plano } = classificarBipagem(interpretadas, destino, anteriores, p, { aba: tabela.opcoes.sheet, linhaCabecalho: tabela.opcoes.headerRow, cabecalho: tabela.cabecalho, colunas });
    return {
      tabela,
      colunas,
      linhas,
      // O resumo (destino e o que ele já tem, notas, decisões, importações anteriores) entra na assinatura:
      // mudou desde a revisão (posição ocupada por outra pessoa, nota nova no palete…) → nova prévia.
      assinatura: assinar(linhas, { parametros: p, resumo: plano.resumo }),
      resumo: { linhas: plano.textos, bloqueio: plano.resumo.blockers.length > 0 ? plano.resumo.blockers.join(' ') : null, bipagem: plano.resumo },
      gravar: async (tx, e, autor, contexto, agora) => {
        const r = await gravarBipagem(tx, e, autor, { id: contexto.loteId, nomeArquivo: contexto.nomeArquivo }, plano, agora);
        return { resultado: { ...RESULTADO_VAZIO, ...r.resultado }, registros: r.registros };
      },
    };
  }
  if (tipo === 'SELECAO_CLIENTE') {
    const p = parametros as ParametrosSelecao;
    if (p.mode === 'MARCACAO' && (colunas.mark ?? null) === null) throw requisicaoInvalida('Inventário com marcação: escolha a coluna de decisão (Marcação).');
    if (p.mode === 'MARCACAO' && p.markValues.length === 0) throw requisicaoInvalida('Inventário com marcação: informe os valores que significam seleção (ex.: SIM, X).');
    const interpretadas = interpretarSelecao(entrada, p);
    const estado = await carregarEstadoSelecao(db, escopoId, p);
    const { linhas, plano } = classificarSelecao(interpretadas, estado, p);
    return {
      tabela,
      colunas,
      linhas,
      assinatura: assinar(linhas, p),
      resumo: {
        linhas: plano.resumo,
        bloqueio: estado.mesmaReferencia !== null ? `Já existe a seleção ${estado.mesmaReferencia.codigo} para o pedido ${p.orderReference}: importe como versão substitutiva dela.` : null,
      },
      gravar: async (tx, e, autor, contexto, agora) => {
        const r = await gravarSelecao(tx, e, autor, { id: contexto.loteId }, plano, agora);
        return { resultado: { ...RESULTADO_VAZIO, selectionId: r.selecaoId, selectionLines: r.linhas }, registros: r.registros };
      },
    };
  }
  const interpretadas = interpretarDevolucoes(entrada);
  const estado = await carregarEstadoDevolucoes(db, escopoId, interpretadas, bloquear);
  const { linhas, plano } = classificarDevolucoes(interpretadas, estado);
  return {
    tabela,
    colunas,
    linhas,
    assinatura: assinar(linhas),
    resumo: semResumo,
    gravar: async (tx, e, _autor, contexto) => {
      const r = await gravarDevolucoes(tx, e.id, contexto.loteId, plano);
      return { resultado: { ...RESULTADO_VAZIO, documentsCreated: r.documentosCriados, documentLinesCreated: r.linhasCriadas }, registros: plano.registroPorLinha };
    },
  };
}

/**
 * Assinatura da prévia: tudo o que quem revisa viu (classificação, ação,
 * chaves, valores, lidos, motivos, avisos e parâmetros do tipo).
 */
function assinar(linhas: readonly LinhaClassificada[], parametros: unknown = null): string {
  return createHash('sha256')
    .update(jsonCanonico([parametros, linhas.map((l) => [l.numero, l.classificacao, l.acao ?? null, l.chave, l.valores, l.lidos, l.motivos, l.avisos])]))
    .digest('hex');
}

function contar(linhas: readonly LinhaClassificada[]) {
  const n = (c: string) => linhas.filter((l) => l.classificacao === c).length;
  return {
    totalLinhas: linhas.length,
    validasNovas: n('VALIDA_NOVA'),
    duplicadas: n('DUPLICADA'),
    invalidas: n('INVALIDA'),
    conflitantes: n('CONFLITANTE'),
    excluidas: n('EXCLUIDA'),
  };
}

async function substituirLinhas(tx: Transacao, escopoId: string, loteId: string, linhas: readonly LinhaClassificada[], registros?: ReadonlyMap<number, string>): Promise<void> {
  await tx.linhaImportacao.deleteMany({ where: { loteId, escopoId } });
  const json = (v: unknown) => v as Prisma.InputJsonValue;
  for (let i = 0; i < linhas.length; i += 1_000) {
    await tx.linhaImportacao.createMany({
      data: linhas.slice(i, i + 1_000).map((l) => {
        const registro = registros?.get(l.numero) ?? null;
        return {
          escopoId,
          loteId,
          numero: l.numero,
          classificacao: l.classificacao,
          chave: l.chave,
          valores: json(l.valores),
          lidos: json(l.lidos),
          motivos: json(l.motivos),
          avisos: json(l.avisos),
          resultado: registros === undefined ? null : l.classificacao === 'VALIDA_NOVA' ? ('GRAVADA' as const) : l.classificacao === 'DUPLICADA' ? ('IGNORADA_DUPLICADA' as const) : null,
          registroId: l.classificacao === 'VALIDA_NOVA' ? registro : null,
          acao: l.acao ?? null,
        };
      }),
    });
  }
}

/** Bloqueia o lote (FOR UPDATE) para alteração. */
async function bloquearLote(tx: Transacao, escopoId: string, id: string): Promise<void> {
  const linhas = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM lote_importacao WHERE id = ${id}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (linhas.length === 0) throw naoEncontrado('Lote de importação não encontrado neste escopo.');
}

/** Gera nova prévia com o mapeamento informado. A prévia anterior deixa de valer. */
export async function gerarPrevia(
  tx: Transacao,
  escopo: Escopo,
  autor: Autor,
  loteId: string,
  dados: {
    expectedVersion: number;
    options: OpcoesLeitura;
    decimalSeparator: SeparadorDecimal;
    columns: Record<string, number | null>;
    parameters?: Record<string, unknown> | null;
  },
  limites: Limites,
  agora: Date,
  motivo: 'MAPEAMENTO' | 'REVALIDACAO' = 'MAPEAMENTO',
): Promise<LoteImportacao> {
  await bloquearLote(tx, escopo.id, loteId);
  const lote = await lerLote(tx, escopo.id, loteId);
  if (lote.situacao === 'CONFIRMADO' || lote.situacao === 'DESCARTADO') {
    throw new ErroHttp(409, 'CONFLITO', lote.situacao === 'CONFIRMADO' ? 'Este lote já foi confirmado; a prévia não muda mais.' : 'Este lote foi descartado.');
  }
  if (lote.versao !== dados.expectedVersion) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O lote foi alterado em outra tela (nova prévia ou descarte). Os dados foram recarregados; confira antes de repetir.');
  }
  const colunas: Record<string, number | null> = {};
  for (const d of camposDoTipo(lote.tipo)) colunas[d.campo] = dados.columns[d.campo] ?? null;
  if (lote.tipo !== 'BIPAGEM') {
    const problemas = verificarMapeamento(lote.tipo, { ...dados.columns, ...colunas });
    if (problemas.length > 0) throw requisicaoInvalida(problemas[0]);
  }
  const parametros = parametrosDoTipo(lote.tipo, dados.parameters ?? null);
  const conteudo = await lerArquivo(tx, escopo.id, loteId);
  const c = await classificarArquivo(
    tx,
    escopo.id,
    lote.tipo,
    formatoTabular(lote.formato),
    conteudo,
    dados.options,
    colunas,
    dados.decimalSeparator,
    limitesDe(limites, lote.tipo),
    false,
    parametros,
    { id: loteId, hashArquivo: lote.hashArquivo },
  );
  await substituirLinhas(tx, escopo.id, loteId, c.linhas);
  const contagem = contar(c.linhas);
  await tx.loteImportacao.update({
    where: { id: loteId },
    data: {
      situacao: 'PREVIA',
      opcoes: c.tabela.opcoes,
      separadorDecimal: dados.decimalSeparator,
      colunas: c.colunas,
      parametros: parametros === null ? Prisma.DbNull : (parametros as unknown as Prisma.InputJsonObject),
      resumoPrevia:
        c.resumo.linhas.length === 0 && c.resumo.bloqueio === null && !c.resumo.bipagem
          ? Prisma.DbNull
          : { linhas: c.resumo.linhas, bloqueio: c.resumo.bloqueio, ...(c.resumo.bipagem ? { bipagem: c.resumo.bipagem as unknown as Prisma.InputJsonObject } : {}) },
      versao: { increment: 1 },
      versaoPrevia: { increment: 1 },
      assinaturaPrevia: c.assinatura,
      previaGeradaEm: agora,
      linhasVazias: c.tabela.vazias,
      ...contagem,
    },
  });
  await registrarEvento(tx, {
    acao: 'IMPORTACAO_PREVIA_GERADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'LOTE_IMPORTACAO',
    alvoId: loteId,
    detalhes: { motivo, versaoPrevia: lote.versaoPrevia + 1, ...contagem },
    requestId: autor.requestId,
  });
  return detalhe(await lerLote(tx, escopo.id, loteId), limites);
}

/** Revalida a prévia atual (depois de uma confirmação recusada por dados alterados). */
export async function revalidarPrevia(db: Banco, escopo: Escopo, autor: Autor, loteId: string, limites: Limites, agora: Date): Promise<void> {
  await db.$transaction(
    async (tx) => {
      const lote = await lerLote(tx, escopo.id, loteId);
      if (lote.situacao !== 'PREVIA' || lote.opcoes === null || lote.colunas === null || lote.separadorDecimal === null) return;
      await gerarPrevia(
        tx,
        escopo,
        autor,
        loteId,
        {
          expectedVersion: lote.versao,
          options: lote.opcoes as OpcoesLeitura,
          decimalSeparator: lote.separadorDecimal as SeparadorDecimal,
          columns: lote.colunas as Record<string, number | null>,
          parameters: (lote.parametros as Record<string, unknown> | null) ?? null,
        },
        limites,
        agora,
        'REVALIDACAO',
      );
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

// ---------- Confirmação ----------

export async function confirmar(
  tx: Transacao,
  escopo: Escopo,
  autor: Autor,
  loteId: string,
  dados: ConfirmarImportacao,
  limites: Limites,
  agora: Date,
): Promise<ResultadoConfirmacao> {
  // Uma confirmação de importação por escopo de cada vez (lotes concorrentes esperam).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`importacao:${escopo.id}`}, 0))`;
  await bloquearLote(tx, escopo.id, loteId);
  const lote = await lerLote(tx, escopo.id, loteId);
  if (lote.situacao === 'CONFIRMADO') return { batch: detalhe(lote, limites), alreadyConfirmed: true };
  if (lote.situacao === 'DESCARTADO') throw new ErroHttp(409, 'CONFLITO', 'Este lote foi descartado; envie o arquivo de novo.');
  if (lote.situacao !== 'PREVIA' || lote.opcoes === null || lote.colunas === null || lote.separadorDecimal === null) {
    throw new ErroHttp(409, 'CONFLITO', 'Gere a prévia antes de confirmar.');
  }
  if (lote.versaoPrevia !== dados.previewVersion) {
    throw new ErroHttp(409, 'PREVIA_DESATUALIZADA', `A prévia revisada (versão ${String(dados.previewVersion)}) foi substituída pela versão ${String(lote.versaoPrevia)}. Revise a prévia atual.`);
  }
  const motivoBloqueio = bloqueio(lote);
  if (motivoBloqueio !== null) throw new ErroHttp(409, 'IMPORTACAO_BLOQUEADA', motivoBloqueio);
  // Bipagem: arquivo já importado é aviso da prévia (nova operação confirmada pela pessoa), não recusa.
  const outro =
    lote.tipo === 'BIPAGEM'
      ? null
      : await tx.loteImportacao.findFirst({
          where: { escopoId: escopo.id, tipo: lote.tipo, hashArquivo: lote.hashArquivo, situacao: 'CONFIRMADO', id: { not: loteId } },
          select: { id: true, confirmadoEm: true },
        });
  if (outro) {
    throw new ErroHttp(
      409,
      'ARQUIVO_JA_IMPORTADO',
      lote.tipo === 'BIPAGEM'
        ? `Este mesmo arquivo já foi importado neste palete (lote ${outro.id.slice(0, 8)}): nada foi importado de novo.`
        : `Este mesmo arquivo já foi confirmado no lote ${outro.id.slice(0, 8)}: nada foi importado de novo.`,
    );
  }

  const conteudo = await lerArquivo(tx, escopo.id, loteId);
  const parametros = parametrosDoTipo(lote.tipo, lote.parametros);
  const c = await classificarArquivo(
    tx,
    escopo.id,
    lote.tipo,
    formatoTabular(lote.formato),
    conteudo,
    lote.opcoes as OpcoesLeitura,
    lote.colunas as Record<string, number | null>,
    lote.separadorDecimal as SeparadorDecimal,
    limitesDe(limites, lote.tipo),
    true,
    parametros,
    { id: loteId, hashArquivo: lote.hashArquivo },
  );
  if (c.assinatura !== lote.assinaturaPrevia) {
    throw new ErroHttp(409, 'PREVIA_DESATUALIZADA', 'Os dados mudaram desde a revisão (outro cadastro ou importação). Nada foi gravado: a prévia foi atualizada para nova revisão.');
  }
  // Inventário: o conjunto aplicado é escolhido explicitamente (quantas linhas e quais ficam de fora).
  const excluidas = new Set(dados.excludedRows);
  let linhasFinais = c.linhas;
  if (lote.tipo === 'INVENTARIO') {
    const aplicaveis = c.linhas.filter((l) => l.classificacao === 'VALIDA_NOVA' && l.acao !== 'REFERENCIA_HISTORICA');
    const numeros = new Set(aplicaveis.map((l) => l.numero));
    const fora = [...excluidas].find((n) => !numeros.has(n));
    if (fora !== undefined) throw requisicaoInvalida(`A linha ${String(fora)} não é aplicável: só linhas a vincular, criar ou atualizar podem ficar de fora.`);
    const esperadas = aplicaveis.length - excluidas.size;
    if (dados.expectedApplicable === undefined || dados.expectedApplicable !== esperadas) {
      throw new ErroHttp(
        409,
        'CONFLITO',
        `O conjunto a aplicar tem ${String(esperadas)} linha(s); informe esse número para confirmar o conjunto revisado (o restante fica registrado como não aplicado).`,
      );
    }
    linhasFinais = c.linhas.map((l) =>
      excluidas.has(l.numero)
        ? {
            ...l,
            classificacao: 'CONFLITANTE' as const,
            motivos: [{ code: 'NAO_SELECIONADA', field: null, message: 'Deixada de fora na confirmação: registrada como não aplicada (pode ser reapresentada depois).' }],
          }
        : l,
    );
  } else if (excluidas.size > 0) {
    throw requisicaoInvalida('Só a importação do inventário conferido permite deixar linhas válidas de fora.');
  }
  const { resultado, registros } = await c.gravar(
    tx,
    escopo,
    autor,
    { loteId, nomeArquivo: lote.nomeArquivo, hashArquivo: lote.hashArquivo, aba: (lote.opcoes as OpcoesLeitura).sheet, excluidas },
    agora,
  );
  await substituirLinhas(tx, escopo.id, loteId, linhasFinais, registros);
  const contagem = contar(linhasFinais);
  try {
    await tx.loteImportacao.update({
      where: { id: loteId },
      data: {
        situacao: 'CONFIRMADO',
        // Bipagem: o palete de destino (existente ou criado agora) é gravado no lote na confirmação.
        ...(lote.tipo === 'BIPAGEM' && lote.paleteId === null && resultado.palletId !== null ? { paleteId: resultado.palletId } : {}),
        confirmadoPorId: autor.usuarioId,
        confirmadoEm: agora,
        versao: { increment: 1 },
        gravadas: contagem.validasNovas,
        ignoradas: contagem.duplicadas,
        ...contagem,
        resultado,
        ultimaFalha: null,
        ultimaFalhaEm: null,
      },
    });
  } catch (erro) {
    if (ehViolacaoUnica(erro)) throw new ErroHttp(409, 'ARQUIVO_JA_IMPORTADO', 'Este mesmo arquivo acabou de ser confirmado em outro lote: nada foi importado de novo.');
    throw erro;
  }
  await registrarEvento(tx, {
    acao: 'IMPORTACAO_CONFIRMADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'LOTE_IMPORTACAO',
    alvoId: loteId,
    detalhes: {
      tipo: lote.tipo,
      versaoPrevia: lote.versaoPrevia,
      gravadas: contagem.validasNovas,
      ignoradas: contagem.duplicadas,
      produtosCriados: resultado.productsCreated,
      codigosAdicionados: resultado.barcodesAdded,
      documentosCriados: resultado.documentsCreated,
      linhasDocumento: resultado.documentLinesCreated,
      claimsCriados: resultado.claimsCreated,
      linhasClaim: resultado.claimLinesCreated,
      ...(lote.tipo === 'INVENTARIO'
        ? { inventario: resultado.inventoryId, aplicadas: resultado.inventoryLinesApplied, pendentes: resultado.inventoryLinesPending, deixadasDeFora: excluidas.size }
        : {}),
      ...(lote.tipo === 'SELECAO_CLIENTE' ? { selecao: resultado.selectionId, linhasSelecao: resultado.selectionLines } : {}),
      ...(lote.tipo === 'BIPAGEM'
        ? { palete: resultado.palletId, numeroPalete: resultado.palletCode, paleteCriado: resultado.palletCreated, entradas: resultado.documentsWritten, revalidadas: resultado.rowsRevalidated, excluidas: contagem.excluidas }
        : {}),
    },
    requestId: autor.requestId,
  });
  return { batch: detalhe(await lerLote(tx, escopo.id, loteId), limites), alreadyConfirmed: false };
}

/** Registra que a confirmação falhou e foi revertida (o lote continua na prévia; nada foi gravado). */
export async function registrarFalha(db: Banco, escopo: Escopo, autor: Autor, loteId: string, agora: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    const atualizado = await tx.loteImportacao.updateMany({
      where: { id: loteId, escopoId: escopo.id, situacao: 'PREVIA' },
      data: {
        ultimaFalhaEm: agora,
        ultimaFalha: `A gravação falhou e foi desfeita: nada deste lote foi importado. Tente confirmar de novo; se persistir, informe o código ${autor.requestId}.`,
      },
    });
    if (atualizado.count === 0) return;
    await registrarEvento(tx, {
      acao: 'IMPORTACAO_FALHOU',
      resultado: 'FALHA',
      atorUsuarioId: autor.usuarioId,
      escopoId: escopo.id,
      alvoTipo: 'LOTE_IMPORTACAO',
      alvoId: loteId,
      detalhes: { etapa: 'confirmacao' },
      requestId: autor.requestId,
    });
  });
}

export async function descartar(tx: Transacao, escopo: Escopo, autor: Autor, loteId: string, versao: number, limites: Limites, agora: Date): Promise<LoteImportacao> {
  await bloquearLote(tx, escopo.id, loteId);
  const lote = await lerLote(tx, escopo.id, loteId);
  if (lote.situacao === 'CONFIRMADO') throw new ErroHttp(409, 'CONFLITO', 'Lote confirmado não é descartado: os registros já gravados permanecem.');
  if (lote.situacao === 'DESCARTADO') return detalhe(lote, limites);
  if (lote.versao !== versao) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O lote foi alterado em outra tela. Os dados foram recarregados; confira antes de repetir.');
  await tx.loteImportacao.update({ where: { id: loteId }, data: { situacao: 'DESCARTADO', descartadoPorId: autor.usuarioId, descartadoEm: agora, versao: { increment: 1 } } });
  await registrarEvento(tx, {
    acao: 'IMPORTACAO_DESCARTADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'LOTE_IMPORTACAO',
    alvoId: loteId,
    detalhes: { tipo: lote.tipo, versaoPrevia: lote.versaoPrevia },
    requestId: autor.requestId,
  });
  return detalhe(await lerLote(tx, escopo.id, loteId), limites);
}

// ---------- Consultas ----------

export async function listarLotes(db: Db, escopoId: string, filtro: FiltroLotes, tipos: readonly TipoImportacao[] = TIPOS_IMPORTACAO): Promise<PaginaLotes> {
  const where: Prisma.LoteImportacaoWhereInput = {
    escopoId,
    // Só os tipos que o perfil pode consultar.
    ...(filtro.tipo ? { tipo: filtro.tipo } : { tipo: { in: [...tipos] } }),
    ...(filtro.situacao ? { situacao: filtro.situacao } : {}),
    ...(filtro.palete ? { paleteId: filtro.palete } : {}),
  };
  const [total, lotes] = await Promise.all([
    db.loteImportacao.count({ where }),
    db.loteImportacao.findMany({
      where,
      select: selecaoLote,
      orderBy: [{ criadoEm: 'desc' }, { id: 'asc' }],
      skip: (filtro.pagina - 1) * filtro.tamanho,
      take: filtro.tamanho,
    }),
  ]);
  return { items: lotes.map(resumo), total, page: filtro.pagina, pageSize: filtro.tamanho };
}

function linhaDe(l: {
  numero: number;
  classificacao: LinhaImportacao['classification'];
  chave: string | null;
  valores: unknown;
  lidos: unknown;
  motivos: unknown;
  avisos: unknown;
  resultado: LinhaImportacao['result'];
  acao: string | null;
}): LinhaImportacao {
  return {
    row: l.numero,
    classification: l.classificacao,
    key: l.chave,
    values: l.valores as Record<string, string | null>,
    read: l.lidos as Record<string, string | null>,
    reasons: l.motivos as MotivoLinha[],
    notices: l.avisos as MotivoLinha[],
    result: l.resultado,
    action: l.acao,
  };
}

export async function linhasDoLote(db: Db, escopoId: string, loteId: string, filtro: FiltroLinhas): Promise<PaginaLinhas> {
  const lote = await lerLote(db, escopoId, loteId);
  const where: Prisma.LinhaImportacaoWhereInput = {
    escopoId,
    loteId,
    ...(filtro.classificacao ? { classificacao: filtro.classificacao } : {}),
    ...(filtro.aplicaveis ? { acao: { in: [...ACOES_INVENTARIO_APLICAVEIS] } } : {}),
  };
  const [total, linhas] = await Promise.all([
    db.linhaImportacao.count({ where }),
    db.linhaImportacao.findMany({ where, orderBy: { numero: 'asc' }, skip: (filtro.pagina - 1) * filtro.tamanho, take: filtro.tamanho }),
  ]);
  return { items: linhas.map(linhaDe), total, page: filtro.pagina, pageSize: filtro.tamanho, previewVersion: lote.versaoPrevia };
}

/** Lote e linhas para o relatório de erros/duplicidades (todas as linhas que não são válidas novas). */
export async function dadosRelatorio(db: Db, escopoId: string, loteId: string) {
  const lote = await lerLote(db, escopoId, loteId);
  const linhas = await db.linhaImportacao.findMany({
    where: { escopoId, loteId, classificacao: { in: ['INVALIDA', 'CONFLITANTE', 'DUPLICADA', 'EXCLUIDA'] } },
    orderBy: { numero: 'asc' },
  });
  return { lote: resumo(lote), opcoes: lote.opcoes as OpcoesLeitura | null, linhas: linhas.map(linhaDe) };
}

export type DadosMapeamento = Pick<Mapeamento, 'expectedVersion'> & { options: OpcoesLeitura; decimalSeparator: SeparadorDecimal; columns: Record<string, number | null> };
