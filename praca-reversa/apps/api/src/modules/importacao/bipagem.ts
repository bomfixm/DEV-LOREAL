/**
 * Importação fixa da bipagem "Etiquetas" (21 out. 2026; D283–D288; substitui
 * a regra de 19 out.: docs/IMPORTACAO-BIPAGEM.md).
 *
 * - Um arquivo = um único palete bipado. O leitor reconhece pelo nome (sem
 *   acentos, maiúsculas ou espaços) Tipo, Número, Lidos e Remetente
 *   (obrigatórios) e CNPJ Remetente e Última Leitura (opcionais), em qualquer
 *   ordem e aba; nada é mapeado pelo operador. Status, Baixa indevida, Série,
 *   Leituras, Destino, Posicao, Area e demais colunas não entram em regra.
 * - Lidos é a quantidade (inteiro ≥ 0; vazio, negativo, fracionário ou texto
 *   = erro da linha, nunca zero). Lidos = 0 é relatado e não gera entrada.
 * - O destino vem do mapa: posição livre = palete novo (número da série do
 *   piso, gerado na confirmação); posição ocupada = o palete dela (número e
 *   conteúdo preservados; as notas são acrescentadas). Atalho: o palete aberto.
 * - Nota repetida no palete ou no próprio arquivo (mesmo tipo, número, CNPJ e
 *   remetente; ou identificação incompleta) pede decisão por linha:
 *   "Revalidar" (não acrescenta a linha; nada muda) ou "Importar
 *   separadamente" (nova entrada; as duas contam). Nada é somado, fundido,
 *   substituído ou apagado.
 * - Nada é gravado no envio nem na prévia. Erro, arquivo vazio ou só zeros
 *   não criam palete. Nada exige SKU, Delivery ou validade.
 */
import {
  CAMPOS_IMPORTACAO,
  chaveIdentidadeBipagem,
  compararIdentidade,
  digitosCnpj,
  tipoDocumentoBipagem,
  type AlvoBipagem,
  type CoincidenciaBipagem,
  type DestinoBipagem,
  type DestinoResumoBipagem,
  type DocumentoBipagem,
  type Escopo,
  type LimitesImportacao,
  type MotivoLinha,
  type ParametrosBipagem,
  type RegistroSemLeitura,
  type ResultadoGravacao,
  type ResumoBipagem,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { reservarNumeroPalete } from '../paletes/numeracao.js';
import { enderecosInformados } from '../paletes/notas.js';
import { registrarMovimentacaoRelevante } from '../paletes/relogio.js';
import { cadastrarPalete } from '../paletes/servico.js';
import { ErroArquivo } from './arquivo/erros.js';
import { lerTabela, type CelulaTabela, type FormatoTabela, type Tabela } from './arquivo/ler.js';
import { dataDeSerial } from './arquivo/xlsx.js';
import { sugerirColunas } from './campos.js';
import { decimalExato, identificador, textoLido, textoLivre, type Campo } from './interpretar.js';
import { celulaDe, lidosDaLinha, type Entrada, type LinhaClassificada } from './tipos.js';

type Db = Banco | Transacao;

export const CAMPOS_BIPAGEM = ['documentType', 'documentNumber', 'readVolumes', 'sender', 'senderCnpj', 'lastRead'] as const;
type CampoBipagem = (typeof CAMPOS_BIPAGEM)[number];
const OBRIGATORIOS: readonly CampoBipagem[] = ['documentType', 'documentNumber', 'readVolumes', 'sender'];

const CAMPOS: Readonly<Record<CampoBipagem, Campo>> = {
  documentType: { campo: 'documentType', rotulo: 'Tipo' },
  documentNumber: { campo: 'documentNumber', rotulo: 'Número' },
  readVolumes: { campo: 'readVolumes', rotulo: 'Lidos' },
  sender: { campo: 'sender', rotulo: 'Remetente' },
  senderCnpj: { campo: 'senderCnpj', rotulo: 'CNPJ Remetente' },
  lastRead: { campo: 'lastRead', rotulo: 'Última Leitura' },
};

const MAX_VOLUMES = 100_000;
const motivo = (code: string, field: string | null, message: string): MotivoLinha => ({ code, field, message });
const plural = (n: number, um: string, varios: string) => `${String(n)} ${n === 1 ? um : varios}`;
const listaLinhas = (ns: readonly number[]) => (ns.length > 8 ? `${ns.slice(0, 8).join(', ')}… (${String(ns.length)})` : ns.join(', '));
const semZeros = (t: string) => t.replace(/^0+(?=\d)/, '');

// ---------- Reconhecimento do arquivo ----------

export interface ArquivoReconhecido {
  tabela: Tabela;
  colunas: Record<string, number | null>;
}

const OPCOES = (sheet: string | null, headerRow: number) => ({ sheet, headerRow, encoding: null, delimiter: null });

/**
 * Encontra a aba e a linha de cabeçalho com Tipo, Número, Lidos e Remetente
 * (primeiras 10 linhas de cada aba, visíveis antes das ocultas). Sem eles:
 * erro curto com o que falta e a orientação de exportar no padrão — nada é
 * gravado e nenhum mapeador é aberto.
 */
export function reconhecerBipagem(conteudo: Buffer, formato: FormatoTabela, limites: LimitesImportacao): ArquivoReconhecido {
  const primeira = lerTabela(conteudo, formato, OPCOES(null, 1), limites);
  const abas = formato === 'XLSX' ? [...primeira.planilhas.filter((p) => !p.oculta), ...primeira.planilhas.filter((p) => p.oculta)].map((p) => p.nome) : [null];
  let melhor: { faltam: CampoBipagem[]; aba: string | null } = { faltam: [...OBRIGATORIOS], aba: null };
  for (const aba of abas) {
    for (let linha = 1; linha <= 10; linha += 1) {
      let tabela: Tabela;
      try {
        tabela = aba === abas[0] && linha === 1 ? primeira : lerTabela(conteudo, formato, OPCOES(aba, linha), limites);
      } catch (erro) {
        if (erro instanceof ErroArquivo && erro.codigo === 'CABECALHO_VAZIO') continue;
        throw erro;
      }
      const colunas = sugerirColunas('BIPAGEM', tabela.cabecalho);
      const faltam = OBRIGATORIOS.filter((c) => colunas[c] === null || colunas[c] === undefined);
      if (faltam.length === 0) return { tabela, colunas };
      if (faltam.length < melhor.faltam.length) melhor = { faltam, aba };
    }
  }
  const nomes = melhor.faltam.map((c) => CAMPOS[c].rotulo);
  throw new ErroArquivo(
    'COLUNAS_BIPAGEM',
    `Não encontrei ${nomes.length === 1 ? 'a coluna' : 'as colunas'} ${nomes.join(', ')}${melhor.aba ? ` (aba "${melhor.aba}")` : ''}. Exporte de novo a bipagem de um palete no padrão "Etiquetas": Tipo, Número, Lidos e Remetente (CNPJ Remetente e Última Leitura, se houver).`,
  );
}

// ---------- Leitura das linhas ----------

export interface LinhaBipagemLida {
  numero: number;
  lidos: Record<string, string | null>;
  erros: MotivoLinha[];
  avisos: MotivoLinha[];
  /** Tipo como lido (ex.: NF-e) e o código interno (NF, MI, NFD). */
  tipoLido: string | null;
  tipoCodigo: string | null;
  tipoCanonico: string | null;
  numeroDocumento: string | null;
  volumes: number | null;
  /** CNPJ como lido e só os dígitos (11 a 14; `null` = ausente ou inválido, sem completar por suposição). */
  cnpj: string | null;
  cnpjDigitos: string | null;
  remetente: string | null;
  /** Última Leitura como lida: AAAA-MM-DD[THH:MM[:SS]] (horário local da bipagem, sem fuso). */
  ultimaLeitura: string | null;
  /** Identidade legível (tipo|número|CNPJ|remetente); nula se a linha tem erro. */
  chave: string | null;
}

/** Número do documento: texto exato; inteiro gravado como número pela exportação é lido como texto. */
function lerNumero(c: CelulaTabela | undefined, max: number): { valor: string | null; erro?: MotivoLinha } {
  const f = CAMPOS.documentNumber;
  if (c?.tipo === 'NUMERO' && !c.formula) {
    const t = (c.texto ?? '').trim();
    if (/^\d{1,15}$/.test(t)) return { valor: t };
    return { valor: null, erro: motivo('NUMERO_INVALIDO', f.campo, `Número "${t}" não é um número de documento inteiro.`) };
  }
  const r = identificador(c, f, max, { maximo: 60 });
  if (!r.ok) return { valor: null, erro: r.motivo };
  return r.valor === null ? { valor: null, erro: motivo('CAMPO_OBRIGATORIO', f.campo, 'Número vazio.') } : { valor: r.valor };
}

/** Lidos: inteiro de 0 a 100.000 (vazio, negativo, fracionário ou texto = erro da linha; nunca vira zero). */
export function lerLidos(c: CelulaTabela | undefined): { valor: number | null; erro?: MotivoLinha } {
  const f = CAMPOS.readVolumes;
  const lido = textoLido(c);
  if (c?.formula) return { valor: null, erro: motivo('FORMULA', f.campo, `Lidos: a célula tem fórmula (${lido ?? ''}); use o valor fixo.`) };
  if (c === undefined || lido === null || lido.trim() === '') return { valor: null, erro: motivo('CAMPO_OBRIGATORIO', f.campo, 'Lidos vazio.') };
  const t = lido.trim();
  let inteiro: string | null = null;
  if (c.tipo === 'NUMERO') {
    const d = decimalExato(t);
    if (d !== null && !d.negativo && d.fracao === '') inteiro = d.inteiro;
    else if (d?.negativo) return { valor: null, erro: motivo('LIDOS_NEGATIVO', f.campo, `Lidos negativo (${t}).`) };
  } else if (/^\d+$/.test(t)) {
    inteiro = semZeros(t);
  } else if (/^-\s*\d/.test(t)) {
    return { valor: null, erro: motivo('LIDOS_NEGATIVO', f.campo, `Lidos negativo (${t}).`) };
  }
  if (inteiro === null) return { valor: null, erro: motivo('LIDOS_INVALIDO', f.campo, `Lidos "${t}" não é um número inteiro de volumes.`) };
  const n = Number(inteiro);
  if (!Number.isSafeInteger(n) || n > MAX_VOLUMES) return { valor: null, erro: motivo('LIDOS_INVALIDO', f.campo, `Lidos acima de ${String(MAX_VOLUMES)} (${t}).`) };
  return { valor: n };
}

/**
 * CNPJ (ou CPF) do remetente, opcional: texto original preservado; comparação
 * pelos dígitos. Número da planilha perde os zeros à esquerda, que são
 * completados até 14 (regra do documento). Texto com outra quantidade de
 * dígitos fica como lido, sem dígitos de comparação (aviso; não é erro).
 */
function lerCnpj(c: CelulaTabela | undefined): { valor: string | null; digitos: string | null; erro?: MotivoLinha; aviso?: MotivoLinha } {
  const f = CAMPOS.senderCnpj;
  const lido = textoLido(c);
  if (c?.formula) return { valor: null, digitos: null, erro: motivo('FORMULA', f.campo, 'CNPJ Remetente: a célula tem fórmula; use o valor fixo.') };
  if (c === undefined || lido === null || lido.trim() === '') return { valor: null, digitos: null };
  const t = lido.trim();
  if (c.tipo === 'NUMERO' && /^\d{11,14}$/.test(t)) {
    const digitos = t.length === 11 ? t : t.padStart(14, '0');
    return { valor: t, digitos, ...(digitos === t ? {} : { aviso: motivo('CNPJ_NUMERICO', f.campo, `CNPJ Remetente gravado como número (${t}); comparado como ${digitos}.`) }) };
  }
  const digitos = digitosCnpj(t);
  if (/^[\d.\-/\s]+$/.test(t) && (digitos.length === 14 || digitos.length === 11)) return { valor: t, digitos };
  return { valor: t.slice(0, 40), digitos: null, aviso: motivo('CNPJ_INCOMPLETO', f.campo, `CNPJ Remetente "${t}" não tem 14 dígitos: mantido como lido, sem completar por suposição.`) };
}

/**
 * Última Leitura, opcional: data/hora da bipagem como lida — célula de data
 * do Excel, serial numérico ou texto "DD/MM/AAAA HH:MM[:SS]" / ISO. Sem fuso
 * inventado; não é a data de conferência. Não reconhecida = aviso.
 */
export function lerUltimaLeitura(c: CelulaTabela | undefined): { valor: string | null; aviso?: MotivoLinha } {
  const f = CAMPOS.lastRead;
  const lido = textoLido(c);
  if (c === undefined || lido === null || lido.trim() === '') return { valor: null };
  const t = lido.trim();
  const naoReconhecida = { valor: null, aviso: motivo('ULTIMA_LEITURA', f.campo, `Última Leitura "${t}" não reconhecida: valor original preservado no lote.`) };
  if (c.formula) return naoReconhecida;
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(t);
  if (iso) return { valor: `${iso[1] ?? ''}${iso[2] === undefined ? '' : `T${iso[2]}:${iso[3] ?? '00'}:${iso[4] ?? '00'}`}` };
  if (c.tipo === 'NUMERO' && /^\d+(?:\.\d+)?$/.test(t)) {
    const d = dataDeSerial(t, false);
    return d === null ? naoReconhecida : { valor: d.length === 10 ? `${d}T00:00:00` : d };
  }
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (br) {
    const [, d, m, a, h, mi, s] = br;
    const dia = Number(d);
    const mes = Number(m);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || (h !== undefined && Number(h) > 23)) return naoReconhecida;
    const data = `${a ?? ''}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    return { valor: h === undefined ? data : `${data}T${h.padStart(2, '0')}:${mi ?? '00'}:${s ?? '00'}` };
  }
  return naoReconhecida;
}

export function interpretarBipagem(e: Entrada): LinhaBipagemLida[] {
  const max = e.limites.maxCellChars;
  return e.tabela.linhas.map((linha) => {
    const erros: MotivoLinha[] = [];
    const avisos: MotivoLinha[] = [];
    const c = (campo: CampoBipagem) => celulaDe(linha, e.colunas, campo);

    let tipoLido: string | null = null;
    let tipo: ReturnType<typeof tipoDocumentoBipagem> = null;
    const rTipo = textoLivre(c('documentType'), CAMPOS.documentType, max, 1, 40);
    if (!rTipo.ok) erros.push(rTipo.motivo);
    else if (rTipo.valor === null) erros.push(motivo('CAMPO_OBRIGATORIO', 'documentType', 'Tipo vazio.'));
    else {
      tipoLido = rTipo.valor;
      tipo = tipoDocumentoBipagem(rTipo.valor);
      if (tipo === null) erros.push(motivo('TIPO_DESCONHECIDO', 'documentType', `Tipo "${rTipo.valor}" não reconhecido (esperado NF-e, Minuta ou NFD).`));
    }

    const numero = lerNumero(c('documentNumber'), max);
    if (numero.erro) erros.push(numero.erro);
    const lidos = lerLidos(c('readVolumes'));
    if (lidos.erro) erros.push(lidos.erro);
    const cnpj = lerCnpj(c('senderCnpj'));
    if (cnpj.erro) erros.push(cnpj.erro);
    if (cnpj.aviso) avisos.push(cnpj.aviso);
    const rRemetente = textoLivre(c('sender'), CAMPOS.sender, max, 1, 200);
    let remetente: string | null = null;
    if (!rRemetente.ok) erros.push(rRemetente.motivo);
    else if (rRemetente.valor === null) erros.push(motivo('CAMPO_OBRIGATORIO', 'sender', 'Remetente vazio.'));
    else remetente = rRemetente.valor;
    const ultima = lerUltimaLeitura(c('lastRead'));
    if (ultima.aviso) avisos.push(ultima.aviso);

    // Lidos = 0 não exige identificação completa: a linha só é relatada.
    const zero = lidos.valor === 0;
    const errosFinais = zero ? erros.filter((x) => x.field === 'readVolumes') : erros;
    return {
      numero: linha.numero,
      lidos: lidosDaLinha(linha, e.colunas),
      erros: errosFinais,
      avisos,
      tipoLido,
      tipoCodigo: tipo?.codigo ?? null,
      tipoCanonico: tipo?.original ?? null,
      numeroDocumento: numero.valor,
      volumes: lidos.valor,
      cnpj: cnpj.valor,
      cnpjDigitos: cnpj.digitos,
      remetente,
      ultimaLeitura: ultima.valor,
      chave: errosFinais.length === 0 ? chaveIdentidadeBipagem({ tipo: tipo?.codigo ?? tipoLido, numero: numero.valor, cnpj: cnpj.digitos ?? cnpj.valor, remetente }) : null,
    };
  });
}

// ---------- Destino e o que ele já tem ----------

interface AlvoExistente {
  alvo: AlvoBipagem;
  tipo: string | null;
  numero: string | null;
  remetente: string | null;
  cnpj: string | null;
  fonte: string;
  /** Contagem vigente (a mais recente) ou os volumes informados no inventário; `null` = sem contagem. */
  volumes: number | null;
}

export interface PaleteEstado {
  id: string;
  codigo: string;
  posicaoCodigo: string | null;
  endereco: string | null;
  mapaPendente: boolean;
  arquivado: boolean;
  expedido: boolean;
}

export interface DestinoEstado {
  tipo: 'NOVO_PALETE' | 'PALETE_EXISTENTE';
  posicao: { id: string; codigo: string; endereco: string | null } | null;
  palete: PaleteEstado | null;
  bloqueio: string | null;
  alvos: AlvoExistente[];
}

/** Palete: código, posição e endereço real (confirmado) ou informado no inventário. */
export async function paleteDestino(db: Db, escopoId: string, paleteId: string): Promise<PaleteEstado> {
  const p = await db.palete.findFirst({
    where: { id: paleteId, escopoId },
    select: { id: true, codigo: true, arquivadoEm: true, estadoFluxo: true, posicao: { select: { codigo: true, endereco: { select: { endereco: true, situacao: true } } } } },
  });
  if (!p) throw naoEncontrado('Palete de destino não encontrado neste escopo.');
  const enderecoReal = p.posicao?.endereco?.situacao === 'CONFIRMADO' ? p.posicao.endereco.endereco : null;
  const informado = p.posicao === null ? ((await enderecosInformados(db, escopoId, [p.id])).get(p.id)?.endereco ?? null) : null;
  return {
    id: p.id,
    codigo: p.codigo,
    posicaoCodigo: p.posicao?.codigo ?? null,
    endereco: enderecoReal ?? informado,
    mapaPendente: p.posicao === null && informado !== null,
    arquivado: p.arquivadoEm !== null,
    expedido: p.estadoFluxo === 'EXPEDIDO',
  };
}

export function paleteDestinoParaContrato(p: PaleteEstado): NonNullable<DestinoResumoBipagem['pallet']> {
  return { id: p.id, code: p.codigo, positionCode: p.posicaoCodigo, address: p.endereco, mapPending: p.mapaPendente, archived: p.arquivado, shipped: p.expedido };
}

/** Conteúdos ativos do palete (registrados e do inventário) com a contagem vigente. */
async function alvosDoPalete(db: Db, escopoId: string, paleteId: string): Promise<AlvoExistente[]> {
  const [registrados, importados] = await Promise.all([
    db.conteudoPalete.findMany({
      where: { escopoId, paleteId, situacao: 'ATIVO' },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      select: { id: true, tipoDocumento: true, numeroDocumento: true, remetente: true, cnpjRemetente: true, cnpjRemetenteDigitos: true, origem: true, linhaArquivo: true },
    }),
    db.vinculoDocumentoPalete.findMany({
      where: { escopoId, paleteId, situacao: 'ATIVO' },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      select: { id: true, tipoDocumento: true, numeroDocumento: true, volumes: true, inventario: { select: { codigo: true } }, linhaInventario: { select: { linhaArquivo: true, remetente: true } } },
    }),
  ]);
  // Contagem vigente pela ocorrência (uma ocorrência movida leva as contagens consigo).
  const alvos = [...registrados.map((r) => r.id), ...importados.map((v) => v.id)];
  const contagens =
    alvos.length === 0
      ? []
      : await db.$queryRaw<{ alvo: string; volumes: number }[]>`
          SELECT DISTINCT ON (coalesce(c.conteudo_id, c.vinculo_id)) coalesce(c.conteudo_id, c.vinculo_id)::text AS alvo, c.volumes_contados AS volumes
            FROM contagem_volumes c
           WHERE c.escopo_id = ${escopoId}::uuid AND coalesce(c.conteudo_id, c.vinculo_id) = ANY(${alvos}::uuid[])
           ORDER BY coalesce(c.conteudo_id, c.vinculo_id), c.registrada_em DESC, c.id DESC`;
  const contagemPor = new Map(contagens.map((c) => [c.alvo, c.volumes]));
  return [
    ...registrados.map(
      (r): AlvoExistente => ({
        alvo: { kind: 'REGISTRADO', id: r.id },
        tipo: r.tipoDocumento,
        numero: r.numeroDocumento,
        remetente: r.remetente,
        cnpj: r.cnpjRemetenteDigitos ?? r.cnpjRemetente,
        fonte: r.origem === 'BIPAGEM' ? `bipagem, linha ${String(r.linhaArquivo ?? '?')}` : 'registrado à mão',
        volumes: contagemPor.get(r.id) ?? null,
      }),
    ),
    ...importados.map(
      (v): AlvoExistente => ({
        alvo: { kind: 'IMPORTADO', id: v.id },
        tipo: v.tipoDocumento,
        numero: v.numeroDocumento,
        remetente: v.linhaInventario.remetente,
        cnpj: null,
        fonte: `${v.inventario.codigo}, linha ${String(v.linhaInventario.linhaArquivo)}`,
        volumes: contagemPor.get(v.id) ?? (v.volumes !== null && v.volumes.isInteger() && v.volumes.gte(0) ? v.volumes.toNumber() : null),
      }),
    ),
  ];
}

/**
 * Resolve o destino escolhido. Na confirmação (`bloquear`), a posição e o
 * palete ficam travados até o fim da transação: se a posição foi ocupada
 * depois da prévia, o destino muda e a prévia é refeita (nada é gravado).
 */
export async function carregarDestino(db: Db, escopoId: string, destino: DestinoBipagem | null, bloquear: boolean): Promise<DestinoEstado | null> {
  if (destino === null) return null;
  if (destino.kind === 'PALETE') {
    if (bloquear) await db.$queryRaw`SELECT id FROM palete WHERE id = ${destino.id}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
    const palete = await paleteDestino(db, escopoId, destino.id);
    const pos = await db.palete.findFirst({ where: { id: palete.id, escopoId }, select: { posicao: { select: { id: true, codigo: true } } } });
    return {
      tipo: 'PALETE_EXISTENTE',
      posicao: pos?.posicao ? { id: pos.posicao.id, codigo: pos.posicao.codigo, endereco: palete.endereco } : null,
      palete,
      bloqueio: palete.arquivado ? `O palete ${palete.codigo} está arquivado: não recebe conteúdo.` : palete.expedido ? `O palete ${palete.codigo} já foi expedido: não recebe conteúdo.` : null,
      alvos: await alvosDoPalete(db, escopoId, palete.id),
    };
  }
  const travar = bloquear ? 'FOR UPDATE OF p' : '';
  const [posicao] = await db.$queryRawUnsafe<
    { id: string; codigo: string; disponivel: boolean; motivo: string | null; retirada: boolean; desativada: boolean; ativo: boolean; endereco: string | null }[]
  >(
    `SELECT p.id::text, p.codigo, p.disponivel, p.motivo_indisponibilidade AS motivo, p.retirada_em IS NOT NULL AS retirada, p.desativada, l.ativo,
            CASE WHEN ep.situacao = 'CONFIRMADO' THEN ep.endereco END AS endereco
       FROM posicao p JOIN layout l ON l.id = p.layout_id LEFT JOIN endereco_posicao ep ON ep.posicao_id = p.id
      WHERE p.id = $1::uuid AND p.escopo_id = $2::uuid ${travar}`,
    destino.id,
    escopoId,
  );
  if (!posicao) throw naoEncontrado('Posição não encontrada no mapa deste escopo.');
  const local = { id: posicao.id, codigo: posicao.codigo, endereco: posicao.endereco };
  const ocupante = await db.palete.findFirst({ where: { escopoId, posicaoId: posicao.id }, select: { id: true } });
  if (ocupante) {
    if (bloquear) await db.$queryRaw`SELECT id FROM palete WHERE id = ${ocupante.id}::uuid FOR UPDATE`;
    const palete = await paleteDestino(db, escopoId, ocupante.id);
    return {
      tipo: 'PALETE_EXISTENTE',
      posicao: local,
      palete,
      bloqueio: palete.arquivado || palete.expedido ? `O palete ${palete.codigo} não recebe conteúdo (${palete.arquivado ? 'arquivado' : 'expedido'}).` : null,
      alvos: await alvosDoPalete(db, escopoId, palete.id),
    };
  }
  const nome = posicao.endereco ?? posicao.codigo;
  const bloqueio =
    posicao.retirada || !posicao.ativo
      ? `A posição ${nome} não está no layout ativo.`
      : posicao.desativada
        ? `A posição ${nome} fica numa área desativada: escolha uma posição em uso.`
        : !posicao.disponivel
          ? `A posição ${nome} está indisponível${posicao.motivo ? ` (${posicao.motivo})` : ''}.`
          : null;
  return { tipo: 'NOVO_PALETE', posicao: local, palete: null, bloqueio, alvos: [] };
}

/** Importações confirmadas anteriores do mesmo arquivo (aviso; não bloqueiam uma nova operação confirmada). */
export async function importacoesAnteriores(db: Db, escopoId: string, loteId: string, hash: string): Promise<ResumoBipagem['previousImports']> {
  const lotes = await db.loteImportacao.findMany({
    where: { escopoId, tipo: 'BIPAGEM', hashArquivo: hash, situacao: 'CONFIRMADO', id: { not: loteId } },
    orderBy: { confirmadoEm: 'asc' },
    select: { id: true, confirmadoEm: true, palete: { select: { codigo: true } }, confirmadoPor: { select: { nome: true } } },
  });
  return lotes.map((l) => ({ batchId: l.id, at: (l.confirmadoEm ?? new Date(0)).toISOString(), palletCode: l.palete?.codigo ?? null, by: l.confirmadoPor?.nome ?? null }));
}

// ---------- Classificação ----------

export interface GravacaoBipagem {
  linha: LinhaBipagemLida;
  chave: string;
  separada: boolean;
}

export interface PlanoBipagem {
  destino: DestinoEstado | null;
  gravacoes: GravacaoBipagem[];
  revalidadas: number[];
  resumo: ResumoBipagem;
  textos: string[];
  semLeitura: number;
  volumes: number;
  novaOperacao: boolean;
}

function destinoParaContrato(d: DestinoEstado): DestinoResumoBipagem {
  const conhecidos = d.alvos.filter((a) => a.volumes !== null);
  return {
    kind: d.tipo,
    position: d.posicao === null ? null : { id: d.posicao.id, code: d.posicao.codigo, address: d.posicao.endereco },
    pallet: d.palete === null ? null : paleteDestinoParaContrato(d.palete),
    currentEntries: d.alvos.length,
    currentVolumes: conhecidos.reduce((s, a) => s + (a.volumes ?? 0), 0),
    currentUnknown: d.alvos.length - conhecidos.length,
    blocked: d.bloqueio,
  };
}

const identidade = (l: LinhaBipagemLida) => ({ tipo: l.tipoCodigo ?? l.tipoLido, numero: l.numeroDocumento, cnpj: l.cnpjDigitos ?? l.cnpj, remetente: l.remetente });

export function classificarBipagem(
  lidas: readonly LinhaBipagemLida[],
  destino: DestinoEstado | null,
  anteriores: ResumoBipagem['previousImports'],
  p: ParametrosBipagem,
  arquivo: { aba: string | null; linhaCabecalho: number; cabecalho: readonly { indice: number; letra: string; texto: string }[]; colunas: Readonly<Record<string, number | null>> },
): { linhas: LinhaClassificada[]; plano: PlanoBipagem } {
  const decisoes = new Map(p.decisions.map((d) => [d.row, d.decision]));
  const validas = lidas.filter((l) => l.erros.length === 0 && l.volumes !== null);
  const positivas = validas.filter((l) => (l.volumes ?? 0) > 0 && l.chave !== null);

  const documentos: DocumentoBipagem[] = [];
  const gravacoes: GravacaoBipagem[] = [];
  const revalidadas: number[] = [];
  const porLinha = new Map<number, LinhaClassificada>();
  const valores = (l: LinhaBipagemLida): Record<string, string | null> => ({
    documentType: l.tipoLido,
    documentTypeCode: l.tipoCodigo,
    documentNumber: l.numeroDocumento,
    readVolumes: l.volumes === null ? null : String(l.volumes),
    sender: l.remetente,
    senderCnpj: l.cnpj,
    lastRead: l.ultimaLeitura,
  });
  const base = (l: LinhaBipagemLida) => ({ numero: l.numero, chave: l.chave, valores: valores(l), lidos: l.lidos, avisos: l.avisos });

  for (const l of lidas) {
    if (l.erros.length > 0 || l.volumes === null) {
      porLinha.set(l.numero, { ...base(l), classificacao: 'INVALIDA', motivos: l.erros.length > 0 ? l.erros : [motivo('LINHA_INCOMPLETA', null, 'Linha incompleta.')], acao: null });
    } else if (l.volumes === 0) {
      porLinha.set(l.numero, { ...base(l), classificacao: 'EXCLUIDA', motivos: [motivo('SEM_LEITURA', 'readVolumes', 'Lidos = 0: relatado; não gera entrada no palete.')], acao: 'SEM_LEITURA' });
    }
  }

  const anterioresNoArquivo: LinhaBipagemLida[] = [];
  for (const l of positivas) {
    const volumes = l.volumes ?? 0;
    const coincidencias: CoincidenciaBipagem[] = [];
    for (const a of destino?.alvos ?? []) {
      const r = compararIdentidade(identidade(l), { tipo: a.tipo, numero: a.numero, cnpj: a.cnpj, remetente: a.remetente });
      if (r !== 'DIFERENTE') {
        coincidencias.push({ source: 'PALETE', target: a.alvo, row: null, documentType: a.tipo, documentNumber: a.numero, senderCnpj: a.cnpj, sender: a.remetente, volumes: a.volumes, origin: a.fonte, incomplete: r === 'INCOMPLETA' });
      }
    }
    for (const o of anterioresNoArquivo) {
      const r = compararIdentidade(identidade(l), identidade(o));
      if (r !== 'DIFERENTE') {
        coincidencias.push({ source: 'ARQUIVO', target: null, row: o.numero, documentType: o.tipoLido, documentNumber: o.numeroDocumento, senderCnpj: o.cnpj, sender: o.remetente, volumes: o.volumes, origin: `linha ${String(o.numero)} deste arquivo`, incomplete: r === 'INCOMPLETA' });
      }
    }
    anterioresNoArquivo.push(l);

    const decisao = coincidencias.length === 0 ? null : (decisoes.get(l.numero) ?? null);
    const acao: DocumentoBipagem['action'] = coincidencias.length === 0 ? 'NOVO' : decisao === 'REVALIDAR' ? 'REVALIDADO' : decisao === 'IMPORTAR_SEPARADO' ? 'IMPORTAR_SEPARADO' : 'COINCIDENTE';
    const avisos: string[] = [];
    if (coincidencias.some((c) => c.incomplete)) avisos.push('Identificação incompleta (falta CNPJ ou remetente de um lado): não dá para afirmar que é a mesma nota.');
    documentos.push({
      row: l.numero,
      type: l.tipoLido ?? '',
      typeCode: l.tipoCodigo ?? '',
      number: l.numeroDocumento ?? '',
      senderCnpj: l.cnpj,
      sender: l.remetente ?? '',
      volumes,
      lastRead: l.ultimaLeitura,
      action: acao,
      matches: coincidencias,
      decision: decisao,
      awaitingDecision: acao === 'COINCIDENTE',
      notices: avisos,
    });

    const chave = l.chave ?? '';
    if (acao === 'NOVO' || acao === 'IMPORTAR_SEPARADO') {
      gravacoes.push({ linha: l, chave, separada: acao === 'IMPORTAR_SEPARADO' });
      porLinha.set(l.numero, {
        ...base(l),
        classificacao: 'VALIDA_NOVA',
        motivos: [],
        acao: acao === 'NOVO' ? 'NOVO' : 'IMPORTAR_SEPARADO',
        ...(acao === 'IMPORTAR_SEPARADO'
          ? { avisos: [...l.avisos, motivo('IMPORTADA_SEPARADA', null, 'Importada separadamente: nova entrada; a coincidente não muda e as duas contam.')] }
          : {}),
      });
    } else if (acao === 'REVALIDADO') {
      revalidadas.push(l.numero);
      porLinha.set(l.numero, {
        ...base(l),
        classificacao: 'DUPLICADA',
        motivos: [motivo('REVALIDADA', null, 'Revalidada: a entrada existente fica como está; esta linha não é acrescentada.')],
        acao: 'REVALIDAR',
      });
    } else {
      const onde = coincidencias.map((c) => (c.source === 'PALETE' ? `no palete (${c.origin})` : c.origin)).join('; ');
      porLinha.set(l.numero, {
        ...base(l),
        classificacao: 'CONFLITANTE',
        motivos: [motivo('AGUARDA_DECISAO', null, `Mesma nota ${onde}: escolha Revalidar ou Importar separadamente.`)],
        acao: 'AGUARDA_DECISAO',
      });
    }
  }

  const linhas = lidas.map((l) => porLinha.get(l.numero)).filter((x): x is LinhaClassificada => x !== undefined);
  const semLeitura: RegistroSemLeitura[] = validas
    .filter((l) => l.volumes === 0)
    .map((l) => ({ row: l.numero, type: l.tipoLido, number: l.numeroDocumento, senderCnpj: l.cnpj, sender: l.remetente }));
  const erros = linhas.filter((l) => l.classificacao === 'INVALIDA').map((l) => ({ row: l.numero, messages: l.motivos.map((m) => m.message) }));
  const porTipo = new Map<string, { records: number; withReads: number; volumes: number }>();
  for (const l of validas) {
    const t = l.tipoCanonico ?? l.tipoLido ?? 'Sem tipo';
    const x = porTipo.get(t) ?? { records: 0, withReads: 0, volumes: 0 };
    x.records += 1;
    if ((l.volumes ?? 0) > 0) x.withReads += 1;
    x.volumes += l.volumes ?? 0;
    porTipo.set(t, x);
  }
  const volumes = positivas.reduce((s, l) => s + (l.volumes ?? 0), 0);
  const volumesGravar = gravacoes.reduce((s, g) => s + (g.linha.volumes ?? 0), 0);
  const aguardando = documentos.filter((d) => d.awaitingDecision).length;

  const bloqueios: string[] = [];
  if (destino === null) bloqueios.push('Escolha no mapa a posição deste palete.');
  else if (destino.bloqueio !== null) bloqueios.push(destino.bloqueio);
  if (erros.length > 0) bloqueios.push(`${plural(erros.length, 'linha com erro', 'linhas com erro')} (${listaLinhas(erros.map((x) => x.row))}): corrija a exportação e envie de novo.`);
  if (aguardando > 0) bloqueios.push(`${plural(aguardando, 'nota repetida aguarda', 'notas repetidas aguardam')} sua escolha: Revalidar ou Importar separadamente.`);
  if (anteriores.length > 0 && !p.newOperation) {
    bloqueios.push(`Este arquivo já foi importado (${anteriores.map((a) => `${a.palletCode === null ? '' : `palete ${a.palletCode}, `}${a.at.slice(0, 10)}`).join('; ')}): confirme que é uma nova operação para importar de novo.`);
  }
  if (positivas.length === 0 && erros.length === 0) bloqueios.push('Nenhuma linha com volumes lidos: nada a importar.');
  else if (erros.length === 0 && aguardando === 0 && gravacoes.length === 0) bloqueios.push('Todas as notas foram revalidadas: nada a acrescentar.');

  const letra = (campo: string) => {
    const i = arquivo.colunas[campo];
    const h = i === null || i === undefined ? undefined : arquivo.cabecalho.find((c) => c.indice === i);
    return { letter: h?.letra ?? '—', header: h?.texto ?? '' };
  };
  const resumo: ResumoBipagem = {
    destination: destino === null ? null : destinoParaContrato(destino),
    sheet: arquivo.aba,
    headerRow: arquivo.linhaCabecalho,
    columns: CAMPOS_IMPORTACAO.BIPAGEM.map((d) => ({ field: d.campo, label: d.rotulo, required: d.obrigatorio, ...letra(d.campo) })),
    counters: {
      records: lidas.length,
      withReads: positivas.length,
      withoutReads: semLeitura.length,
      rowsWithErrors: erros.length,
      volumes,
      accepted: gravacoes.length,
      volumesToAdd: volumesGravar,
      revalidated: revalidadas.length,
      awaitingDecision: aguardando,
      byType: [...porTipo.entries()].map(([type, x]) => ({ type, ...x })),
    },
    documents: documentos,
    withoutReads: semLeitura,
    errors: erros,
    previousImports: anteriores,
    blockers: bloqueios,
  };
  const destinoTexto =
    destino === null
      ? 'Destino: escolher no mapa.'
      : destino.tipo === 'NOVO_PALETE'
        ? `Destino: palete novo em ${destino.posicao?.endereco ?? destino.posicao?.codigo ?? '?'} (número gerado ao confirmar).`
        : `Destino: palete ${destino.palete?.codigo ?? '?'} (${String(destino.alvos.length)} entrada(s) já registrada(s)).`;
  const textos = [
    `${plural(lidas.length, 'linha', 'linhas')}: ${String(positivas.length)} com volumes lidos (${plural(volumes, 'volume', 'volumes')}), ${String(semLeitura.length)} sem volumes${erros.length > 0 ? `, ${plural(erros.length, 'com erro', 'com erro')}` : ''}.`,
    destinoTexto,
    `A gravar: ${plural(gravacoes.length, 'entrada', 'entradas')} (${plural(volumesGravar, 'volume', 'volumes')}); ${String(revalidadas.length)} revalidada(s); ${String(aguardando)} aguardando escolha.`,
  ];
  return { linhas, plano: { destino, gravacoes, revalidadas, resumo, textos, semLeitura: semLeitura.length, volumes: volumesGravar, novaOperacao: p.newOperation } };
}

// ---------- Gravação ----------

/**
 * Grava o conjunto aprovado na transação da confirmação (bloqueio de
 * importação do escopo; posição e palete travados): palete novo com o número
 * da série do piso (posição livre) ou o palete existente, conteúdos (origem
 * BIPAGEM) e contagens informadas. "Revalidar" não grava nada. Só a entrada
 * de conteúdo reinicia o prazo de reconferência (movimentação "entrada de
 * conteúdo"); Última Leitura não é conferência. Qualquer falha desfaz tudo.
 */
export async function gravarBipagem(
  tx: Transacao,
  escopo: Escopo,
  autor: { usuarioId: string; requestId: string },
  lote: { id: string; nomeArquivo: string },
  plano: PlanoBipagem,
  agora: Date,
): Promise<{ resultado: Partial<ResultadoGravacao>; registros: Map<number, string> }> {
  const destino = plano.destino;
  if (destino === null) throw new ErroHttp(409, 'IMPORTACAO_BLOQUEADA', 'Escolha no mapa a posição deste palete.');
  if (destino.bloqueio !== null) throw new ErroHttp(409, 'CONFLITO', destino.bloqueio);
  if (plano.gravacoes.length === 0) throw new ErroHttp(409, 'IMPORTACAO_BLOQUEADA', 'Nada para acrescentar a este palete.');

  let palete: { id: string; codigo: string };
  let criado = false;
  if (destino.tipo === 'NOVO_PALETE') {
    if (destino.posicao === null) throw new ErroHttp(409, 'CONFLITO', 'Posição de destino ausente.');
    const numero = await reservarNumeroPalete(tx, escopo.id, agora);
    const detalhe = await cadastrarPalete(
      tx,
      escopo,
      { code: { mode: 'INFORMAR', value: numero }, positionId: destino.posicao.id, notes: `Cadastrado pela importação da bipagem (${lote.nomeArquivo}).`.slice(0, 500), declaredItems: [] },
      autor,
      agora,
      { codigoDaNumeracao: true },
    );
    palete = { id: detalhe.id, codigo: detalhe.code };
    criado = true;
  } else {
    if (destino.palete === null) throw new ErroHttp(409, 'CONFLITO', 'Palete de destino ausente.');
    palete = { id: destino.palete.id, codigo: destino.palete.codigo };
  }

  const registros = new Map<number, string>();
  for (const g of plano.gravacoes) {
    const l = g.linha;
    const id = randomUUID();
    await tx.conteudoPalete.create({
      data: {
        id,
        escopoId: escopo.id,
        paleteId: palete.id,
        remetente: l.remetente ?? '',
        tipoDocumento: l.tipoCodigo,
        tipoDocumentoOriginal: l.tipoLido,
        numeroDocumento: l.numeroDocumento,
        cnpjRemetente: l.cnpj,
        cnpjRemetenteDigitos: l.cnpjDigitos,
        origem: 'BIPAGEM',
        loteImportacaoId: lote.id,
        linhaArquivo: l.numero,
        ultimaLeitura: l.ultimaLeitura,
        decisaoBipagem: g.separada ? 'IMPORTAR_SEPARADO' : null,
        criadoPorId: autor.usuarioId,
        criadoEm: agora,
        atualizadoEm: agora,
      },
    });
    await tx.contagemVolumes.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        paleteId: palete.id,
        conteudoId: id,
        vinculoId: null,
        volumesContados: l.volumes ?? 0,
        volumesPrevistos: null,
        origem: 'BIPAGEM',
        referencia: `Bipagem ${lote.nomeArquivo}, linha ${String(l.numero)}`.slice(0, 200),
        loteImportacaoId: lote.id,
        linhaArquivo: l.numero,
        chaveBipagem: g.chave,
        registradaPorId: autor.usuarioId,
        registradaEm: agora,
      },
    });
    registros.set(l.numero, id);
  }
  await registrarMovimentacaoRelevante(tx, escopo.id, [palete.id], 'ENTRADA_CONTEUDO', agora);
  await registrarEvento(tx, {
    acao: 'BIPAGEM_IMPORTADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: palete.id,
    detalhes: {
      palete: palete.codigo,
      paleteCriado: criado,
      posicao: destino.posicao?.codigo ?? null,
      endereco: destino.posicao?.endereco ?? null,
      lote: lote.id,
      arquivo: lote.nomeArquivo,
      registros: plano.resumo.counters.records,
      entradas: plano.gravacoes.length,
      separadas: plano.gravacoes.filter((g) => g.separada).map((g) => g.linha.numero).join(', ') || null,
      revalidadas: plano.revalidadas.join(', ') || null,
      semLeitura: plano.semLeitura,
      volumes: plano.volumes,
      novaOperacao: plano.novaOperacao,
    },
    requestId: autor.requestId,
  });
  return {
    resultado: {
      palletId: palete.id,
      palletCode: palete.codigo,
      palletCreated: criado,
      documentsWritten: plano.gravacoes.length,
      contentsCreated: plano.gravacoes.length,
      countsRegistered: plano.gravacoes.length,
      documentsUnchanged: plano.revalidadas.length,
      recordsWithoutReads: plano.semLeitura,
      volumesRead: plano.volumes,
      rowsRevalidated: plano.revalidadas.length,
    },
    registros,
  };
}
