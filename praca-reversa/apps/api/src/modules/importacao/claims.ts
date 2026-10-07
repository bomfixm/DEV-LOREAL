/**
 * Importação de lista de claims (etapa 07): cria só registros de
 * investigação (casos e linhas). Não altera estoque, condição, localização,
 * recuperação, valor confirmado nem nada no sistema do cliente.
 *
 * Identidade de uma linha: referência do claim + linha do claim (no escopo).
 * SKU sozinho não identifica um claim; sem referência ou sem linha, a linha
 * fica inválida (nenhuma identidade é gerada). Dados do caso (motivo, datas,
 * prazo, responsável, prioridade, moeda, fonte, situação externa, cobrança e
 * observações) se repetem iguais nas linhas do mesmo caso. Mesma identidade e
 * mesmo conteúdo → duplicata; conteúdo diferente → conflito, sem sobrescrever
 * (casos encerrados, recuperações e decisões nunca mudam por importação).
 * Referências e códigos são texto; quantidades e valores exatos.
 */
import {
  UNIDADE_PECA,
  ehQuantidadeInteira,
  normalizarQuantidade,
  normalizarValor,
  type BaseValor,
  type MotivoClaim,
  type MotivoLinha,
  type PrioridadeClaim,
  type SeparadorDecimal,
  type TipoOrigemDocumento,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica } from '../../db/erros.js';
import { ErroHttp } from '../../http/erros.js';
import { registrarEventoClaim } from '../claims/historico.js';
import { PERFIS_RESPONSAVEIS } from '../claims/leitura.js';
import { codigoClaim, proximoNumero } from '../claims/servico.js';
import type { CelulaTabela, LinhaTabela } from './arquivo/ler.js';
import { chaveLinhaDocumento, data, identificador, linhaDocumento, obrigatorio, quantidade, textoLivre, unidade, type Campo, type Resultado } from './interpretar.js';
import { celulaDe, classificarLinha, lidosDaLinha, type Entrada, type LinhaClassificada } from './tipos.js';

const CAMPOS = {
  externalReference: { campo: 'externalReference', rotulo: 'Referência do claim' },
  lineRef: { campo: 'lineRef', rotulo: 'Linha do claim' },
  reason: { campo: 'reason', rotulo: 'Motivo' },
  sku: { campo: 'sku', rotulo: 'SKU' },
  quantity: { campo: 'quantity', rotulo: 'Quantidade em análise' },
  unit: { campo: 'unit', rotulo: 'Unidade' },
  description: { campo: 'description', rotulo: 'Descrição do produto' },
  lot: { campo: 'lot', rotulo: 'Lote' },
  lotRequired: { campo: 'lotRequired', rotulo: 'Lote exigido' },
  originType: { campo: 'originType', rotulo: 'Tipo da origem' },
  originReference: { campo: 'originReference', rotulo: 'Referência da origem' },
  originLine: { campo: 'originLine', rotulo: 'Linha da origem' },
  openedOn: { campo: 'openedOn', rotulo: 'Data de abertura' },
  occurredOn: { campo: 'occurredOn', rotulo: 'Data da ocorrência' },
  deadline: { campo: 'deadline', rotulo: 'Prazo' },
  responsible: { campo: 'responsible', rotulo: 'Responsável (login)' },
  priority: { campo: 'priority', rotulo: 'Prioridade' },
  estimatedValue: { campo: 'estimatedValue', rotulo: 'Valor estimado' },
  valueBase: { campo: 'valueBase', rotulo: 'Base do valor' },
  currency: { campo: 'currency', rotulo: 'Moeda' },
  valueSource: { campo: 'valueSource', rotulo: 'Fonte do valor' },
  externalStatus: { campo: 'externalStatus', rotulo: 'Situação externa' },
  chargeReference: { campo: 'chargeReference', rotulo: 'Referência da cobrança' },
  chargeFinalized: { campo: 'chargeFinalized', rotulo: 'Cobrança finalizada' },
  notes: { campo: 'notes', rotulo: 'Observações' },
} as const satisfies Record<string, Campo>;

const SEP = '\u001f';

function aplicar<T>(r: Resultado<T>, erros: MotivoLinha[]): T | null {
  if (r.ok) return r.valor;
  erros.push(r.motivo);
  return null;
}

/** Texto de opção sem acentos, maiúsculo, com espaços/hífens/barras como "_". */
function chaveOpcao(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/g, '_');
}

function opcao<T extends string | boolean>(c: CelulaTabela | undefined, f: Campo, max: number, mapa: Readonly<Record<string, T>>, aceitos: string): Resultado<T | null> {
  const texto = textoLivre(c, f, max, 1, 60);
  if (!texto.ok) return texto;
  if (texto.valor === null) return { ok: true, valor: null };
  const valor = mapa[chaveOpcao(texto.valor)];
  if (valor === undefined) return { ok: false, motivo: { code: 'OPCAO_INVALIDA', field: f.campo, message: `${f.rotulo}: "${texto.valor}" não é aceito (use ${aceitos}).` } };
  return { ok: true, valor };
}

const MOTIVOS: Readonly<Record<string, MotivoClaim>> = {
  FALTA: 'EXTRAVIO_FALTA',
  EXTRAVIO: 'EXTRAVIO_FALTA',
  EXTRAVIO_FALTA: 'EXTRAVIO_FALTA',
  AVARIA: 'AVARIA',
  DIVERGENCIA_DOCUMENTAL: 'DIVERGENCIA_DOCUMENTAL',
  DIVERGENCIA: 'DIVERGENCIA_DOCUMENTAL',
};
const SIM_NAO: Readonly<Record<string, boolean>> = { SIM: true, S: true, TRUE: true, VERDADEIRO: true, '1': true, NAO: false, N: false, FALSE: false, FALSO: false, '0': false };
const PRIORIDADES: Readonly<Record<string, PrioridadeClaim>> = { URGENTE: 'URGENTE', ALTA: 'ALTA', NORMAL: 'NORMAL', BAIXA: 'BAIXA' };
const BASES: Readonly<Record<string, BaseValor>> = { TOTAL: 'TOTAL_LINHA', TOTAL_LINHA: 'TOTAL_LINHA', UNITARIO: 'UNITARIO', UNIDADE: 'UNITARIO', POR_UNIDADE: 'UNITARIO' };
const ORIGENS: Readonly<Record<string, TipoOrigemDocumento>> = {
  DEVOLUCAO: 'DEVOLUCAO',
  NOTA_FISCAL: 'NOTA_FISCAL',
  NF: 'NOTA_FISCAL',
  MANIFESTO: 'MANIFESTO',
  OUTRO: 'OUTRO',
};

/** Valor monetário: até 2 casas, mesmo separador decimal da prévia, sem milhar nem símbolo. */
function valor(c: CelulaTabela | undefined, f: Campo, separador: SeparadorDecimal, max: number): Resultado<string | null> {
  const q = quantidade(c, f, separador, max, true);
  if (!q.ok || q.valor === null) return q;
  if (/\.\d{3}$/.test(q.valor)) return { ok: false, motivo: { code: 'CASAS_DECIMAIS', field: f.campo, message: `${f.rotulo}: até 2 casas decimais (nada é arredondado).` } };
  return { ok: true, valor: normalizarValor(q.valor) };
}

interface Caso {
  motivo: MotivoClaim | null;
  dataAbertura: string | null;
  dataOcorrencia: string | null;
  prazo: string | null;
  responsavel: string | null;
  prioridade: PrioridadeClaim | null;
  moeda: string | null;
  fonteValor: string | null;
  situacaoExterna: string | null;
  referenciaCobranca: string | null;
  cobrancaFinalizada: boolean;
  observacoes: string | null;
}

interface Conteudo {
  sku: string;
  quantidade: string;
  unidade: string;
  descricao: string | null;
  lote: string | null;
  loteExigido: boolean;
  origemTipo: TipoOrigemDocumento | null;
  origemReferencia: string | null;
  origemLinha: string | null;
  valor: string | null;
  baseValor: BaseValor | null;
}

interface Interpretada {
  linha: LinhaTabela;
  lidos: Record<string, string | null>;
  erros: MotivoLinha[];
  referencia: string | null;
  linhaRef: string | null;
  caso: Caso;
  conteudo: Conteudo | null;
}

export function interpretarClaims(e: Entrada): Interpretada[] {
  const max = e.limites.maxCellChars;
  return e.tabela.linhas.map((linha) => {
    const erros: MotivoLinha[] = [];
    const c = (campo: string) => celulaDe(linha, e.colunas, campo);
    const faltantes: MotivoLinha[] = [];
    for (const f of [CAMPOS.externalReference, CAMPOS.lineRef, CAMPOS.reason, CAMPOS.sku, CAMPOS.quantity, CAMPOS.unit]) {
      const falta = obrigatorio(c(f.campo), f);
      if (falta) faltantes.push(falta);
    }
    if (faltantes.some((m) => m.field === 'externalReference' || m.field === 'lineRef')) {
      faltantes.push({
        code: 'CHAVE_INCOMPLETA',
        field: null,
        message: 'Sem a referência do claim e a linha do claim a linha não pode ser identificada (SKU sozinho não identifica um claim). Corrija o arquivo ou o mapeamento.',
      });
    }
    erros.push(...faltantes);
    const referencia = aplicar(identificador(c('externalReference'), CAMPOS.externalReference, max, { maximo: 80 }), erros);
    const linhaRef = aplicar(linhaDocumento(c('lineRef'), CAMPOS.lineRef, max), erros);
    if (linhaRef !== null && linhaRef.length > 40) erros.push({ code: 'IDENTIFICADOR_INVALIDO', field: 'lineRef', message: 'Linha do claim: até 40 caracteres.' });
    const motivo = aplicar(opcao(c('reason'), CAMPOS.reason, max, MOTIVOS, 'FALTA, EXTRAVIO, AVARIA ou DIVERGENCIA DOCUMENTAL'), erros);
    const sku = aplicar(identificador(c('sku'), CAMPOS.sku, max, { maximo: 60 }), erros);
    const qtd = aplicar(quantidade(c('quantity'), CAMPOS.quantity, e.separador, max), erros);
    const un = aplicar(unidade(c('unit'), CAMPOS.unit, max), erros);
    if (un === UNIDADE_PECA && qtd !== null && !ehQuantidadeInteira(qtd)) {
      erros.push({ code: 'QUANTIDADE_NAO_INTEIRA', field: 'quantity', message: 'Quantidade em análise: em peças (UN) precisa ser inteira.' });
    }
    const descricao = aplicar(textoLivre(c('description'), CAMPOS.description, max, 1, 200), erros);
    const lote = aplicar(identificador(c('lot'), CAMPOS.lot, max, { maximo: 60 }), erros);
    const loteExigido = aplicar(opcao(c('lotRequired'), CAMPOS.lotRequired, max, SIM_NAO, 'SIM ou NAO'), erros) ?? false;
    const origemTipo = aplicar(opcao(c('originType'), CAMPOS.originType, max, ORIGENS, 'DEVOLUCAO, NOTA_FISCAL, MANIFESTO ou OUTRO'), erros);
    const origemReferencia = aplicar(identificador(c('originReference'), CAMPOS.originReference, max, { maximo: 80 }), erros);
    const origemLinha = aplicar(linhaDocumento(c('originLine'), CAMPOS.originLine, max), erros);
    if (origemReferencia !== null && origemTipo === null && !erros.some((m) => m.field === 'originType')) {
      erros.push({ code: 'ORIGEM_SEM_TIPO', field: 'originType', message: 'Tipo da origem: obrigatório quando há referência da origem (nenhum tipo é presumido).' });
    }
    const dataAbertura = aplicar(data(c('openedOn'), CAMPOS.openedOn, max), erros);
    const dataOcorrencia = aplicar(data(c('occurredOn'), CAMPOS.occurredOn, max), erros);
    const prazo = aplicar(data(c('deadline'), CAMPOS.deadline, max), erros);
    const responsavel = aplicar(identificador(c('responsible'), CAMPOS.responsible, max), erros)?.toLowerCase() ?? null;
    const prioridade = aplicar(opcao(c('priority'), CAMPOS.priority, max, PRIORIDADES, 'URGENTE, ALTA, NORMAL ou BAIXA'), erros);
    const valorEstimado = aplicar(valor(c('estimatedValue'), CAMPOS.estimatedValue, e.separador, max), erros);
    const baseValor = aplicar(opcao(c('valueBase'), CAMPOS.valueBase, max, BASES, 'TOTAL ou UNITARIO'), erros);
    const moedaTexto = aplicar(textoLivre(c('currency'), CAMPOS.currency, max, 1, 10), erros);
    const moeda = moedaTexto === null ? null : moedaTexto.toUpperCase();
    if (moeda !== null && !/^[A-Z]{3}$/.test(moeda)) erros.push({ code: 'MOEDA_INVALIDA', field: 'currency', message: `Moeda: "${moedaTexto ?? ''}" — use o código de 3 letras (ex.: BRL).` });
    const fonteValor = aplicar(textoLivre(c('valueSource'), CAMPOS.valueSource, max, 1, 200), erros);
    if (valorEstimado !== null) {
      if (baseValor === null && !erros.some((m) => m.field === 'valueBase')) erros.push({ code: 'BASE_AUSENTE', field: 'valueBase', message: 'Base do valor: informe TOTAL ou UNITARIO (um total nunca é multiplicado de novo).' });
      if (moeda === null) erros.push({ code: 'MOEDA_AUSENTE', field: 'currency', message: 'Moeda: obrigatória quando há valor estimado.' });
      if (fonteValor === null) erros.push({ code: 'FONTE_AUSENTE', field: 'valueSource', message: 'Fonte do valor: obrigatória quando há valor estimado.' });
    } else if (baseValor !== null) {
      erros.push({ code: 'VALOR_AUSENTE', field: 'estimatedValue', message: 'Base do valor informada sem valor estimado.' });
    }
    const situacaoExterna = aplicar(textoLivre(c('externalStatus'), CAMPOS.externalStatus, max, 1, 120), erros);
    const referenciaCobranca = aplicar(identificador(c('chargeReference'), CAMPOS.chargeReference, max, { maximo: 80 }), erros);
    const cobrancaFinalizada = aplicar(opcao(c('chargeFinalized'), CAMPOS.chargeFinalized, max, SIM_NAO, 'SIM ou NAO'), erros) ?? false;
    const observacoes = aplicar(textoLivre(c('notes'), CAMPOS.notes, max, 1, 2000), erros);
    const conteudo =
      sku !== null && qtd !== null && un !== null
        ? { sku, quantidade: qtd, unidade: un, descricao, lote, loteExigido, origemTipo, origemReferencia, origemLinha, valor: valorEstimado, baseValor }
        : null;
    return {
      linha,
      lidos: lidosDaLinha(linha, e.colunas),
      erros,
      referencia,
      linhaRef,
      caso: { motivo, dataAbertura, dataOcorrencia, prazo, responsavel, prioridade, moeda, fonteValor, situacaoExterna, referenciaCobranca, cobrancaFinalizada, observacoes },
      conteudo,
    };
  });
}

interface CasoExistente extends Omit<Caso, 'responsavel'> {
  id: string;
  codigo: string;
  situacao: string;
  responsavel: string | null;
  linhas: Map<string, Conteudo & { identificador: string }>;
  maiorOrdem: number;
}

export interface EstadoClaims {
  casos: Map<string, CasoExistente>;
  produtos: Map<string, { id: string; unidade: string }>;
  responsaveis: Map<string, string>;
}

const data10 = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));

/**
 * Casos com as referências do arquivo, produtos pelos SKUs e responsáveis
 * pelos logins. Na confirmação, os casos citados ficam bloqueados (FOR UPDATE).
 */
export async function carregarEstadoClaims(db: Banco | Transacao, escopoId: string, linhas: readonly Interpretada[], bloquear: boolean): Promise<EstadoClaims> {
  const referencias = [...new Set(linhas.flatMap((l) => (l.referencia === null ? [] : [l.referencia])))];
  const skus = [...new Set(linhas.flatMap((l) => (l.conteudo === null ? [] : [l.conteudo.sku])))];
  const logins = [...new Set(linhas.flatMap((l) => (l.caso.responsavel === null ? [] : [l.caso.responsavel])))];
  if (bloquear && referencias.length > 0) {
    await db.$queryRaw`SELECT id FROM claim WHERE escopo_id = ${escopoId}::uuid AND referencia_externa = ANY(${referencias}::text[]) ORDER BY id FOR UPDATE`;
  }
  const casos =
    referencias.length === 0
      ? []
      : await db.claim.findMany({
          where: { escopoId, referenciaExterna: { in: referencias } },
          include: { responsavel: { select: { login: true } }, linhas: true },
        });
  const produtos = skus.length === 0 ? [] : await db.produto.findMany({ where: { escopoId, sku: { in: skus } }, select: { id: true, sku: true, unidadeCanonica: true } });
  const vinculos =
    logins.length === 0
      ? []
      : await db.vinculo.findMany({
          where: { escopoId, ativo: true, perfil: { in: [...PERFIS_RESPONSAVEIS] }, usuario: { ativo: true, login: { in: logins } } },
          select: { usuario: { select: { id: true, login: true } } },
        });
  return {
    casos: new Map(
      casos.map((c) => [
        c.referenciaExterna ?? '',
        {
          id: c.id,
          codigo: c.codigo,
          situacao: c.situacao,
          motivo: c.motivo,
          dataAbertura: data10(c.dataAbertura),
          dataOcorrencia: data10(c.dataOcorrencia),
          prazo: data10(c.prazo),
          responsavel: c.responsavel?.login ?? null,
          prioridade: c.prioridade,
          moeda: c.moeda,
          fonteValor: c.fonteValor,
          situacaoExterna: c.situacaoExterna,
          referenciaCobranca: c.referenciaCobranca,
          cobrancaFinalizada: c.cobrancaFinalizada,
          observacoes: c.observacoes,
          maiorOrdem: c.linhas.reduce((m, l) => Math.max(m, l.ordem), 0),
          linhas: new Map(
            c.linhas.map((l) => [
              l.chaveLinha,
              {
                identificador: l.identificador,
                sku: l.sku,
                quantidade: normalizarQuantidade(l.quantidadeAnalise.toFixed()),
                unidade: l.unidade,
                descricao: l.descricao,
                lote: l.lote,
                loteExigido: l.loteExigido,
                origemTipo: l.origemTipo,
                origemReferencia: l.origemReferencia,
                origemLinha: l.origemLinha,
                valor: l.valorEstimado === null ? null : normalizarValor(l.valorEstimado.toFixed()),
                baseValor: l.baseValor,
              },
            ]),
          ),
        },
      ]),
    ),
    produtos: new Map(produtos.map((p) => [p.sku, { id: p.id, unidade: p.unidadeCanonica }])),
    responsaveis: new Map(vinculos.map((v) => [v.usuario.login, v.usuario.id])),
  };
}

const ROTULO_CASO: Readonly<Record<keyof Caso, string>> = {
  motivo: 'motivo',
  dataAbertura: 'data de abertura',
  dataOcorrencia: 'data da ocorrência',
  prazo: 'prazo',
  responsavel: 'responsável',
  prioridade: 'prioridade',
  moeda: 'moeda',
  fonteValor: 'fonte do valor',
  situacaoExterna: 'situação externa',
  referenciaCobranca: 'referência da cobrança',
  cobrancaFinalizada: 'cobrança finalizada',
  observacoes: 'observações',
};

function diferencasCaso(a: Omit<Caso, 'responsavel'> & { responsavel: string | null }, b: Caso): string[] {
  const vazio = (v: string | boolean | null) => (v === null ? 'não informado' : String(v));
  return (Object.keys(ROTULO_CASO) as (keyof Caso)[]).filter((k) => a[k] !== b[k]).map((k) => `${ROTULO_CASO[k]} ${vazio(a[k])} → ${vazio(b[k])}`);
}

function diferencasLinha(a: Conteudo, b: Conteudo): string[] {
  const vazio = (v: string | null) => v ?? 'pendente';
  const lista: string[] = [];
  if (a.sku !== b.sku) lista.push(`SKU ${a.sku} → ${b.sku}`);
  if (a.quantidade !== b.quantidade || a.unidade !== b.unidade) lista.push(`quantidade ${a.quantidade} ${a.unidade} → ${b.quantidade} ${b.unidade}`);
  if (a.descricao !== b.descricao) lista.push(`descrição ${vazio(a.descricao)} → ${vazio(b.descricao)}`);
  if (a.lote !== b.lote) lista.push(`lote ${vazio(a.lote)} → ${vazio(b.lote)}`);
  if (a.loteExigido !== b.loteExigido) lista.push(`lote exigido ${a.loteExigido ? 'SIM' : 'NAO'} → ${b.loteExigido ? 'SIM' : 'NAO'}`);
  if (a.origemTipo !== b.origemTipo || a.origemReferencia !== b.origemReferencia || a.origemLinha !== b.origemLinha) {
    lista.push(`origem ${vazio(a.origemReferencia)}/${vazio(a.origemLinha)} → ${vazio(b.origemReferencia)}/${vazio(b.origemLinha)}`);
  }
  if (a.valor !== b.valor || a.baseValor !== b.baseValor) lista.push(`valor ${vazio(a.valor)} ${vazio(a.baseValor)} → ${vazio(b.valor)} ${vazio(b.baseValor)}`);
  return lista;
}

interface LinhaNova extends Conteudo {
  id: string;
  numero: number;
  identificador: string;
  chaveLinha: string;
  produtoId: string | null;
}

interface CasoNovo extends Caso {
  id: string;
  referencia: string;
  responsavelId: string | null;
  linhas: LinhaNova[];
}

export interface PlanoClaims {
  casosNovos: Map<string, CasoNovo>;
  linhasEmExistentes: (LinhaNova & { claimId: string; codigo: string; ordem: number })[];
  registroPorLinha: Map<number, string>;
}

export function classificarClaims(linhas: readonly Interpretada[], estado: EstadoClaims): { linhas: LinhaClassificada[]; plano: PlanoClaims } {
  const plano: PlanoClaims = { casosNovos: new Map(), linhasEmExistentes: [], registroPorLinha: new Map() };
  const vistas = new Map<string, Conteudo & { numero: number }>();
  const casosNoArquivo = new Map<string, Caso & { numero: number }>();
  const ordens = new Map<string, number>();
  const resultado: LinhaClassificada[] = [];

  for (const l of linhas) {
    const erros = [...l.erros];
    const conflitos: MotivoLinha[] = [];
    const duplicidades: MotivoLinha[] = [];
    const avisos: MotivoLinha[] = [];
    let nova = false;
    const chaveLinha = l.linhaRef === null ? null : chaveLinhaDocumento(l.linhaRef);
    const responsavelId = l.caso.responsavel === null ? null : (estado.responsaveis.get(l.caso.responsavel) ?? null);
    if (l.caso.responsavel !== null && responsavelId === null) {
      erros.push({
        code: 'RESPONSAVEL_INVALIDO',
        field: 'responsible',
        message: `Responsável ${l.caso.responsavel}: não é usuário ativo deste escopo com acesso para tratar claims (o arquivo não amplia acesso).`,
      });
    }
    const produto = l.conteudo === null ? undefined : estado.produtos.get(l.conteudo.sku);
    if (l.conteudo !== null && erros.length === 0) {
      if (!produto) avisos.push({ code: 'PRODUTO_PENDENTE', field: 'sku', message: `SKU ${l.conteudo.sku} fora do cadastro: o caso fica em triagem (a validação de recuperação exige o produto cadastrado).` });
      else if (produto.unidade !== l.conteudo.unidade) {
        avisos.push({ code: 'UNIDADE_PENDENTE', field: 'unit', message: `Unidade ${l.conteudo.unidade} diferente da canônica ${produto.unidade}: fica pendente (nenhuma conversão é presumida).` });
      }
      if (l.conteudo.origemReferencia === null) avisos.push({ code: 'ORIGEM_PENDENTE', field: 'originReference', message: 'Origem não informada: fica pendente (exigida antes de validar recuperação).' });
      if (l.caso.prazo === null) avisos.push({ code: 'PRAZO_NAO_INFORMADO', field: 'deadline', message: 'Prazo não informado (nenhum prazo é calculado).' });
    }

    if (erros.length === 0 && l.referencia !== null && chaveLinha !== null && l.linhaRef !== null && l.conteudo !== null) {
      const chave = `${l.referencia}${SEP}${chaveLinha}`;
      const caso = { ...l.caso };
      const noArquivo = casosNoArquivo.get(l.referencia);
      if (noArquivo) {
        const mudou = diferencasCaso(noArquivo, caso);
        if (mudou.length > 0) {
          conflitos.push({ code: 'CASO_DIVERGENTE_NO_ARQUIVO', field: null, message: `Dados do caso diferentes da linha ${String(noArquivo.numero)} do arquivo: ${mudou.join('; ')}.` });
        }
      }
      const existente = estado.casos.get(l.referencia);
      if (existente && conflitos.length === 0) {
        const mudouCaso = diferencasCaso(existente, caso);
        const linhaExistente = existente.linhas.get(chaveLinha);
        if (linhaExistente) {
          const mudou = [...mudouCaso, ...diferencasLinha(linhaExistente, l.conteudo)];
          if (mudou.length > 0) {
            conflitos.push({
              code: 'CONFLITO_EXISTENTE',
              field: null,
              message: `A linha ${linhaExistente.identificador} do claim ${l.referencia} (${existente.codigo}) já existe com outro conteúdo: ${mudou.join('; ')}. Nada é sobrescrito; altere o caso no aplicativo, se for o caso.`,
            });
          } else {
            duplicidades.push({ code: 'DUPLICADA_EXISTENTE', field: null, message: `Linha ${linhaExistente.identificador} do claim ${l.referencia} já registrada com o mesmo conteúdo (${existente.codigo}).` });
          }
        } else if (['REGULARIZADO', 'PERDA_CONFIRMADA', 'ENCERRADO'].includes(existente.situacao)) {
          conflitos.push({ code: 'CASO_ENCERRADO', field: null, message: `O claim ${l.referencia} (${existente.codigo}) está encerrado: a importação não acrescenta linhas. Reabra o caso, com motivo, se for o caso.` });
        } else if (mudouCaso.length > 0) {
          conflitos.push({ code: 'CONFLITO_EXISTENTE', field: null, message: `O claim ${l.referencia} (${existente.codigo}) já existe com outros dados do caso: ${mudouCaso.join('; ')}. Nada é sobrescrito.` });
        } else if (vistas.has(chave)) {
          const anterior = vistas.get(chave);
          const mudou = anterior ? diferencasLinha(anterior, l.conteudo) : [];
          if (mudou.length > 0) conflitos.push({ code: 'CONFLITO_NO_ARQUIVO', field: null, message: `A linha ${String(anterior?.numero ?? '')} do arquivo tem o mesmo claim e linha com outro conteúdo: ${mudou.join('; ')}.` });
          else duplicidades.push({ code: 'DUPLICADA_NO_ARQUIVO', field: null, message: `Igual à linha ${String(anterior?.numero ?? '')} do arquivo.` });
        } else {
          nova = true;
        }
      } else if (conflitos.length === 0) {
        const anterior = vistas.get(chave);
        if (anterior) {
          const mudou = diferencasLinha(anterior, l.conteudo);
          if (mudou.length > 0) conflitos.push({ code: 'CONFLITO_NO_ARQUIVO', field: null, message: `A linha ${String(anterior.numero)} do arquivo tem o mesmo claim e linha com outro conteúdo: ${mudou.join('; ')}.` });
          else duplicidades.push({ code: 'DUPLICADA_NO_ARQUIVO', field: null, message: `Igual à linha ${String(anterior.numero)} do arquivo.` });
        } else {
          nova = true;
        }
      }
      if (!noArquivo) casosNoArquivo.set(l.referencia, { ...caso, numero: l.linha.numero });
    }

    const { classificacao, motivos } = classificarLinha(erros, conflitos, nova, duplicidades);
    if (classificacao === 'VALIDA_NOVA' && l.referencia !== null && l.linhaRef !== null && chaveLinha !== null && l.conteudo !== null) {
      vistas.set(`${l.referencia}${SEP}${chaveLinha}`, { ...l.conteudo, numero: l.linha.numero });
      const id = randomUUID();
      const nova: LinhaNova = { ...l.conteudo, id, numero: l.linha.numero, identificador: l.linhaRef, chaveLinha, produtoId: produto?.id ?? null };
      const existente = estado.casos.get(l.referencia);
      if (existente) {
        const ordem = (ordens.get(existente.id) ?? existente.maiorOrdem) + 1;
        ordens.set(existente.id, ordem);
        plano.linhasEmExistentes.push({ ...nova, claimId: existente.id, codigo: existente.codigo, ordem });
      } else {
        const caso = plano.casosNovos.get(l.referencia) ?? { ...l.caso, id: randomUUID(), referencia: l.referencia, responsavelId, linhas: [] };
        caso.linhas.push(nova);
        plano.casosNovos.set(l.referencia, caso);
      }
      plano.registroPorLinha.set(l.linha.numero, id);
    }
    resultado.push({
      numero: l.linha.numero,
      classificacao,
      chave: l.referencia !== null && chaveLinha !== null ? `claim ${l.referencia} · linha ${chaveLinha}` : null,
      valores: {
        externalReference: l.referencia,
        lineRef: l.linhaRef,
        reason: l.caso.motivo,
        sku: l.conteudo?.sku ?? null,
        quantity: l.conteudo?.quantidade ?? null,
        unit: l.conteudo?.unidade ?? null,
        description: l.conteudo?.descricao ?? null,
        lot: l.conteudo?.lote ?? null,
        lotRequired: l.conteudo ? (l.conteudo.loteExigido ? 'SIM' : 'NAO') : null,
        originType: l.conteudo?.origemTipo ?? null,
        originReference: l.conteudo?.origemReferencia ?? null,
        originLine: l.conteudo?.origemLinha ?? null,
        openedOn: l.caso.dataAbertura,
        occurredOn: l.caso.dataOcorrencia,
        deadline: l.caso.prazo,
        responsible: l.caso.responsavel,
        priority: l.caso.prioridade,
        estimatedValue: l.conteudo?.valor ?? null,
        valueBase: l.conteudo?.baseValor ?? null,
        currency: l.caso.moeda,
        valueSource: l.caso.fonteValor,
        externalStatus: l.caso.situacaoExterna,
        chargeReference: l.caso.referenciaCobranca,
        chargeFinalized: l.caso.cobrancaFinalizada ? 'SIM' : 'NAO',
        notes: l.caso.observacoes,
      },
      lidos: l.lidos,
      motivos,
      avisos: classificacao === 'VALIDA_NOVA' ? avisos : [],
    });
  }
  return { linhas: resultado, plano };
}

const dataOuNulo = (texto: string | null) => (texto === null ? null : new Date(`${texto}T00:00:00.000Z`));

/** Grava casos e linhas (investigação). Unicidade violada → prévia desatualizada. */
export async function gravarClaims(
  tx: Transacao,
  escopoId: string,
  loteImportacaoId: string,
  plano: PlanoClaims,
  autorId: string,
  agora: Date,
): Promise<{ casosCriados: number; linhasCriadas: number }> {
  try {
    let numero = plano.casosNovos.size > 0 ? await proximoNumero(tx, escopoId) : 0;
    for (const caso of plano.casosNovos.values()) {
      await tx.claim.create({
        data: {
          id: caso.id,
          escopoId,
          numero,
          codigo: codigoClaim(numero),
          referenciaExterna: caso.referencia,
          motivo: caso.motivo ?? 'EXTRAVIO_FALTA',
          situacao: 'EM_ANALISE',
          prioridade: caso.prioridade,
          prazo: dataOuNulo(caso.prazo),
          dataAbertura: dataOuNulo(caso.dataAbertura),
          dataOcorrencia: dataOuNulo(caso.dataOcorrencia),
          responsavelId: caso.responsavelId,
          moeda: caso.moeda,
          fonteValor: caso.fonteValor,
          situacaoExterna: caso.situacaoExterna,
          referenciaCobranca: caso.referenciaCobranca,
          cobrancaFinalizada: caso.cobrancaFinalizada,
          observacoes: caso.observacoes,
          origemCadastro: 'IMPORTACAO',
          loteImportacaoId,
          criadoPorId: autorId,
          criadoEm: agora,
          atualizadoEm: agora,
        },
      });
      await tx.linhaClaim.createMany({ data: caso.linhas.map((l, i) => ({ ...dadosLinha(l), escopoId, claimId: caso.id, ordem: i + 1, loteImportacaoId, linhaArquivo: l.numero, criadoEm: agora, atualizadoEm: agora })) });
      await registrarEventoClaim(tx, {
        escopoId,
        claimId: caso.id,
        tipo: 'CASO_IMPORTADO',
        autorId,
        agora,
        resumo: `Caso ${codigoClaim(numero)} importado (referência ${caso.referencia}) com ${String(caso.linhas.length)} linha(s). Só investigação: nada mudou no estoque nem no cliente.`,
        relacionadoId: loteImportacaoId,
        detalhes: { loteImportacao: loteImportacaoId, linhas: caso.linhas.length },
      });
      numero += 1;
    }
    for (const l of plano.linhasEmExistentes) {
      await tx.linhaClaim.create({ data: { ...dadosLinha(l), escopoId, claimId: l.claimId, ordem: l.ordem, loteImportacaoId, linhaArquivo: l.numero, criadoEm: agora, atualizadoEm: agora } });
      await registrarEventoClaim(tx, {
        escopoId,
        claimId: l.claimId,
        linhaId: l.id,
        tipo: 'LINHA_IMPORTADA',
        autorId,
        agora,
        resumo: `Linha ${l.identificador} acrescentada por importação (${l.sku}, ${l.quantidade} ${l.unidade}).`,
        relacionadoId: loteImportacaoId,
        detalhes: { loteImportacao: loteImportacaoId, linhaArquivo: l.numero },
      });
    }
    for (const claimId of new Set(plano.linhasEmExistentes.map((l) => l.claimId))) {
      await tx.claim.update({ where: { id: claimId }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
    }
  } catch (erro) {
    if (ehViolacaoUnica(erro)) {
      throw new ErroHttp(409, 'PREVIA_DESATUALIZADA', 'Outro cadastro ou importação gravou agora um claim com a mesma referência e linha. A prévia foi atualizada: revise antes de confirmar.');
    }
    throw erro;
  }
  const linhasCriadas = [...plano.casosNovos.values()].reduce((t, c) => t + c.linhas.length, 0) + plano.linhasEmExistentes.length;
  return { casosCriados: plano.casosNovos.size, linhasCriadas };
}

function dadosLinha(l: LinhaNova) {
  return {
    id: l.id,
    identificador: l.identificador,
    chaveLinha: l.chaveLinha,
    produtoId: l.produtoId,
    sku: l.sku,
    descricao: l.descricao,
    quantidadeAnalise: l.quantidade,
    unidade: l.unidade,
    lote: l.lote,
    loteExigido: l.loteExigido,
    origemTipo: l.origemTipo,
    origemReferencia: l.origemReferencia,
    origemLinha: l.origemLinha,
    valorEstimado: l.valor,
    baseValor: l.baseValor,
  };
}
