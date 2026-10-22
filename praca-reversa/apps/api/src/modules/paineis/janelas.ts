/**
 * Janela em VOLUMES (painéis): meta informada pelo cliente, linhas da seleção
 * vigente e separação/expedição registradas por conteúdo (NF × palete).
 *
 * - T = meta vigente (a mais recente); nenhuma meta é criada sozinha.
 * - P/E vêm só de `evento_volumes_janela` da própria janela (nunca de toda a
 *   praça nem só pela data). Seleção, importação e reserva não contam.
 * - A seleção vigente é a última versão da referência ligada à meta; a
 *   versão substituída não vira pedido paralelo, e preparações ligadas a ela
 *   ficam marcadas para revisão (nada é desfeito).
 */
import {
  ROTULO_ETAPA_SELECAO,
  progressoVolumes,
  unidadeEhVolume,
  type ConteudoVolumes,
  type EtapaSelecao,
  type JanelaPainel,
  type LinhaSelecaoJanela,
  type MetaVolumes,
  type ResumoEtapas,
  type SituacaoJanela,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { pe, volumesInteiros, type BasePainel, type ConteudoBase, type SomaJanela } from './base.js';

type Db = Banco | Transacao;

export const chavePalete = (codigo: string) => codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface JanelaLinha {
  id: string;
  codigo: string;
  nome: string;
  situacao: SituacaoJanela;
  mesReferencia: Date;
  saidaInicio: Date | null;
  saidaFim: Date | null;
  prazoPreparacao: Date | null;
}

export const CAMPOS_JANELA = {
  id: true,
  codigo: true,
  nome: true,
  situacao: true,
  mesReferencia: true,
  saidaInicio: true,
  saidaFim: true,
  prazoPreparacao: true,
} as const;

interface SelecaoInfo {
  id: string;
  codigo: string;
  referenciaPedido: string;
  versaoPedido: number;
  situacao: string;
  criadoEm: Date;
}

interface MetaLida {
  volumes: number;
  referencia: string | null;
  informadoEm: Date;
  selecao: SelecaoInfo | null;
  /** Versão vigente da mesma referência (a própria, se não substituída). */
  vigente: SelecaoInfo | null;
}

/** Descritor de conteúdo para casar com as linhas (estoque atual ou conteúdo com eventos na janela). */
interface Descritor {
  id: string;
  paleteId: string;
  paleteCodigo: string;
  tipo: string | null;
  numero: string | null;
  delivery: string | null;
}

interface LinhaLida {
  id: string;
  linhaArquivo: number;
  abrangencia: 'PALETE' | 'DOCUMENTO' | 'LINHA_PRODUTO';
  paleteReferencia: string | null;
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  delivery: string | null;
  quantidade: string | null;
  unidade: string | null;
  resolucao: { paleteId: string | null; chaveDocumento: string | null } | null;
}

export interface SomasJanela {
  total: SomaJanela;
  porAlvo: Map<string, SomaJanela & Descritor>;
  /** Seleções citadas pelas separações desta janela. */
  selecoesCitadas: Set<string>;
}

const zero = (): SomaJanela => ({
  separado: 0,
  estornoSeparado: 0,
  expedido: 0,
  estornoExpedido: 0,
});

/** Somas de eventos por janela e por conteúdo, com a identificação do conteúdo (mesmo de palete já fora da praça). */
export async function somasDasJanelas(db: Db, escopoId: string, janelaIds: readonly string[]): Promise<Map<string, SomasJanela>> {
  const mapa = new Map<string, SomasJanela>(janelaIds.map((id) => [id, { total: zero(), porAlvo: new Map(), selecoesCitadas: new Set() }]));
  if (janelaIds.length === 0) return mapa;
  const linhas = await db.$queryRaw<
    {
      janela_id: string;
      alvo: string;
      palete_id: string;
      palete_codigo: string;
      tipo: string | null;
      numero: string | null;
      delivery: string | null;
      sep: bigint;
      est_sep: bigint;
      exp: bigint;
      est_exp: bigint;
    }[]
  >`
    SELECT ev.janela_id::text, coalesce(ev.vinculo_id, ev.conteudo_id)::text AS alvo, ev.palete_id::text, pa.codigo AS palete_codigo,
           coalesce(v.tipo_documento, c.tipo_documento) AS tipo, coalesce(v.numero_documento, c.numero_documento) AS numero,
           coalesce(v.delivery, c.delivery) AS delivery,
           coalesce(sum(ev.volumes) FILTER (WHERE ev.tipo = 'SEPARACAO'), 0) AS sep,
           coalesce(sum(ev.volumes) FILTER (WHERE ev.tipo = 'ESTORNO_SEPARACAO'), 0) AS est_sep,
           coalesce(sum(ev.volumes) FILTER (WHERE ev.tipo = 'EXPEDICAO'), 0) AS exp,
           coalesce(sum(ev.volumes) FILTER (WHERE ev.tipo = 'ESTORNO_EXPEDICAO'), 0) AS est_exp
      FROM evento_volumes_janela ev
      JOIN palete pa ON pa.id = ev.palete_id
      LEFT JOIN vinculo_documento_palete v ON v.id = ev.vinculo_id
      LEFT JOIN conteudo_palete c ON c.id = ev.conteudo_id
     WHERE ev.escopo_id = ${escopoId}::uuid AND ev.janela_id = ANY(${[...janelaIds]}::uuid[])
     GROUP BY 1, 2, 3, 4, 5, 6, 7`;
  for (const l of linhas) {
    const j = mapa.get(l.janela_id);
    if (!j) continue;
    const s: SomaJanela = {
      separado: Number(l.sep),
      estornoSeparado: Number(l.est_sep),
      expedido: Number(l.exp),
      estornoExpedido: Number(l.est_exp),
    };
    j.total.separado += s.separado;
    j.total.estornoSeparado += s.estornoSeparado;
    j.total.expedido += s.expedido;
    j.total.estornoExpedido += s.estornoExpedido;
    j.porAlvo.set(l.alvo, {
      ...s,
      id: l.alvo,
      paleteId: l.palete_id,
      paleteCodigo: l.palete_codigo,
      tipo: l.tipo,
      numero: l.numero,
      delivery: l.delivery,
    });
  }
  const citadas = await db.$queryRaw<{ janela_id: string; selecao_id: string }[]>`
    SELECT DISTINCT ev.janela_id::text, ls.selecao_id::text FROM evento_volumes_janela ev JOIN linha_selecao ls ON ls.id = ev.linha_selecao_id
     WHERE ev.escopo_id = ${escopoId}::uuid AND ev.janela_id = ANY(${[...janelaIds]}::uuid[]) AND ev.tipo = 'SEPARACAO'`;
  for (const c of citadas) mapa.get(c.janela_id)?.selecoesCitadas.add(c.selecao_id);
  return mapa;
}

/** Última versão da mesma referência de pedido (segue as substituições). */
async function versaoVigente(db: Db, escopoId: string, selecao: SelecaoInfo): Promise<SelecaoInfo> {
  let atual = selecao;
  for (let i = 0; i < 50 && atual.situacao === 'SUBSTITUIDA'; i++) {
    const proxima = await db.selecaoCliente.findFirst({
      where: { escopoId, substituiId: atual.id },
      select: {
        id: true,
        codigo: true,
        referenciaPedido: true,
        versaoPedido: true,
        situacao: true,
        criadoEm: true,
      },
    });
    if (!proxima) break;
    atual = proxima;
  }
  return atual;
}

/** Metas por janela (vigente = a mais recente) e o histórico. */
export async function metasDasJanelas(db: Db, escopoId: string, janelaIds: readonly string[]): Promise<Map<string, MetaLida[]>> {
  const mapa = new Map<string, MetaLida[]>();
  if (janelaIds.length === 0) return mapa;
  const metas = await db.metaJanelaVolumes.findMany({
    where: { escopoId, janelaId: { in: [...janelaIds] } },
    orderBy: [{ informadoEm: 'desc' }, { ordem: 'desc' }],
    select: {
      janelaId: true,
      volumes: true,
      referencia: true,
      informadoEm: true,
      selecao: {
        select: {
          id: true,
          codigo: true,
          referenciaPedido: true,
          versaoPedido: true,
          situacao: true,
          criadoEm: true,
        },
      },
    },
  });
  const vigentes = new Map<string, SelecaoInfo>();
  for (const m of metas) {
    let vigente: SelecaoInfo | null = null;
    if (m.selecao) {
      vigente = vigentes.get(m.selecao.id) ?? (await versaoVigente(db, escopoId, m.selecao));
      vigentes.set(m.selecao.id, vigente);
    }
    mapa.set(m.janelaId, [
      ...(mapa.get(m.janelaId) ?? []),
      {
        volumes: m.volumes,
        referencia: m.referencia,
        informadoEm: m.informadoEm,
        selecao: m.selecao,
        vigente,
      },
    ]);
  }
  return mapa;
}

export function metaParaContrato(m: MetaLida): MetaVolumes {
  return {
    volumes: m.volumes,
    reference: m.referencia,
    at: m.informadoEm.toISOString(),
    selection: m.selecao
      ? {
          id: m.selecao.id,
          code: m.selecao.codigo,
          orderRef: m.selecao.referenciaPedido,
          version: m.selecao.versaoPedido,
          superseded: m.vigente !== null && m.vigente.id !== m.selecao.id,
        }
      : null,
  };
}

async function linhasDaSelecao(db: Db, escopoId: string, selecaoId: string): Promise<LinhaLida[]> {
  const linhas = await db.linhaSelecao.findMany({
    where: { escopoId, selecaoId, duplicadaDeId: null },
    orderBy: { linhaArquivo: 'asc' },
    select: {
      id: true,
      linhaArquivo: true,
      abrangencia: true,
      paleteReferencia: true,
      tipoDocumento: true,
      numeroDocumento: true,
      delivery: true,
      quantidade: true,
      unidade: true,
      resolucoes: {
        where: { anuladaEm: null },
        orderBy: { criadoEm: 'desc' },
        take: 1,
        select: { paleteId: true, chaveDocumento: true },
      },
    },
  });
  return linhas.map((l) => ({
    id: l.id,
    linhaArquivo: l.linhaArquivo,
    abrangencia: l.abrangencia,
    paleteReferencia: l.paleteReferencia,
    tipoDocumento: l.tipoDocumento,
    numeroDocumento: l.numeroDocumento,
    delivery: l.delivery,
    quantidade: l.quantidade === null ? null : l.quantidade.toFixed(),
    unidade: l.unidade,
    resolucao: l.resolucoes[0] ?? null,
  }));
}

/**
 * A linha da seleção corresponde ao conteúdo? Palete inteiro: só os
 * conteúdos que já existiam quando a seleção foi registrada (nada chegado
 * depois entra sozinho). Documento: número + contexto (tipo e Delivery
 * quando informados); número sem tipo com mais de um contexto é ambíguo.
 */
function casa(l: LinhaLida, d: Descritor, chavePaleteLinha: string | null): boolean {
  if (l.resolucao?.paleteId && d.paleteId !== l.resolucao.paleteId) return false;
  if (l.resolucao?.chaveDocumento) return `${d.tipo ?? ''}|${d.numero ?? ''}` === l.resolucao.chaveDocumento;
  if (l.abrangencia === 'PALETE') return chavePaleteLinha !== null && chavePalete(d.paleteCodigo) === chavePaleteLinha;
  if (l.numeroDocumento === null || d.numero !== l.numeroDocumento) return false;
  if (l.tipoDocumento !== null && d.tipo !== l.tipoDocumento) return false;
  if (l.delivery !== null && d.delivery !== null && d.delivery !== l.delivery) return false;
  if (chavePaleteLinha !== null && chavePalete(d.paleteCodigo) !== chavePaleteLinha) return false;
  return true;
}

function etapa(localizada: boolean, pedido: number | null, p: number, e: number): EtapaSelecao {
  if (pedido !== null && pedido > 0 && e >= pedido) return 'EXPEDIDA';
  if (pedido !== null && pedido > 0 && p + e >= pedido) return 'SEPARADA';
  if (p + e > 0) return 'EM_SEPARACAO';
  return localizada ? 'LOCALIZADA' : 'NAO_LOCALIZADA';
}

export interface LinhasCalculadas {
  linhas: LinhaSelecaoJanela[];
  /** Conteúdos atuais casados por linha (para a separação ligada à linha). */
  conteudosPorLinha: Map<string, ConteudoBase[]>;
  resumo: ResumoEtapas;
  somaSelecionada: number | null;
}

/** Linhas da seleção vigente com a etapa (localizada, em separação, separada, expedida) e os volumes efetivos. */
export async function calcularLinhas(db: Db, escopoId: string, selecao: SelecaoInfo, base: BasePainel, somas: SomasJanela | undefined): Promise<LinhasCalculadas> {
  const lidas = await linhasDaSelecao(db, escopoId, selecao.id);
  const conteudosPorLinha = new Map<string, ConteudoBase[]>();
  const linhas: LinhaSelecaoJanela[] = [];
  const resumo: ResumoEtapas = {
    lines: 0,
    notLocated: 0,
    located: 0,
    inSeparation: 0,
    separated: 0,
    shipped: 0,
  };
  let soma: number | null = 0;
  const descritorDe = (c: ConteudoBase): Descritor => ({
    id: c.id,
    paleteId: c.paleteId,
    paleteCodigo: base.paletePorId.get(c.paleteId)?.codigo ?? '',
    tipo: c.tipo,
    numero: c.numero,
    delivery: c.delivery,
  });
  for (const l of lidas) {
    const chaveLinha = l.paleteReferencia === null ? null : chavePalete(l.paleteReferencia);
    let atuais = base.conteudos.filter((c) => casa(l, descritorDe(c), chaveLinha) && (l.abrangencia !== 'PALETE' || c.criadoEm <= selecao.criadoEm));
    // Número sem tipo com contextos diferentes: ambíguo (não localizado até a resolução).
    if (l.abrangencia !== 'PALETE' && l.tipoDocumento === null && l.resolucao === null && new Set(atuais.map((c) => c.tipo ?? '')).size > 1) atuais = [];
    conteudosPorLinha.set(l.id, atuais);
    const eventos = [...(somas?.porAlvo.values() ?? [])].filter((d) => casa(l, d, chaveLinha));
    let p = 0;
    let e = 0;
    for (const d of eventos) {
      const r = pe(d);
      p += r.p;
      e += r.e;
    }
    const conhecidos = atuais.every((c) => c.base !== null);
    const localizados = atuais.length > 0 && conhecidos ? atuais.reduce((t, c) => t + (c.base ?? 0), 0) : null;
    const quantidade = l.quantidade === null ? { valor: null, invalido: false } : volumesInteiros(l.quantidade);
    const pedido = l.quantidade !== null ? (unidadeEhVolume(l.unidade) && !quantidade.invalido ? quantidade.valor : null) : l.abrangencia === 'LINHA_PRODUTO' ? null : localizados;
    const st = etapa(atuais.length > 0, pedido, p, e);
    resumo.lines += 1;
    if (st === 'NAO_LOCALIZADA') resumo.notLocated += 1;
    else if (st === 'LOCALIZADA') resumo.located += 1;
    else if (st === 'EM_SEPARACAO') resumo.inSeparation += 1;
    else if (st === 'SEPARADA') resumo.separated += 1;
    else resumo.shipped += 1;
    soma = soma === null || pedido === null ? null : soma + pedido;
    const paletes = [...new Set(atuais.map((c) => c.paleteId))].map((id) => base.paletePorId.get(id)).filter((x) => x !== undefined);
    linhas.push({
      lineId: l.id,
      row: l.linhaArquivo,
      scope: l.abrangencia,
      documentType: l.tipoDocumento,
      documentNumber: l.numeroDocumento,
      delivery: l.delivery,
      palletRef: l.paleteReferencia,
      requested: pedido,
      locatedVolumes: localizados,
      remainder: pedido !== null && localizados !== null && pedido < localizados ? localizados - pedido : null,
      separatedWaiting: p,
      shipped: e,
      stage: st,
      pallets: paletes.map((x) => ({ code: x.codigo, address: x.endereco })),
    });
  }
  return {
    linhas,
    conteudosPorLinha,
    resumo,
    somaSelecionada: lidas.length === 0 ? null : soma,
  };
}

/** Resumo da janela para os painéis (T, P, E, etapas e diferenças para revisão interna). */
export async function resumirJanela(
  db: Db,
  escopoId: string,
  j: JanelaLinha,
  metas: MetaLida[] | undefined,
  somas: SomasJanela | undefined,
  base: BasePainel,
): Promise<JanelaPainel & { linhasCalculadas: LinhasCalculadas | null }> {
  const meta = metas?.[0] ?? null;
  const { p, e } = pe(somas?.total ?? zero());
  const vigente = meta?.vigente ?? null;
  const calculadas = vigente === null ? null : await calcularLinhas(db, escopoId, vigente, base, somas);
  const t = meta?.volumes ?? null;
  const citadas = somas?.selecoesCitadas ?? new Set<string>();
  const revisar = (vigente !== null && [...citadas].some((id) => id !== vigente.id)) || (meta?.selecao !== null && meta?.selecao !== undefined && vigente !== null && meta.selecao.id !== vigente.id);
  return {
    id: j.id,
    code: j.codigo,
    name: j.nome,
    situation: j.situacao,
    month: j.mesReferencia.toISOString().slice(0, 10),
    exitStart: j.saidaInicio?.toISOString() ?? null,
    exitEnd: j.saidaFim?.toISOString() ?? null,
    preparationDeadline: j.prazoPreparacao?.toISOString() ?? null,
    goal: meta === null ? null : metaParaContrato(meta),
    progress: progressoVolumes(t, p, e),
    stages: calculadas?.resumo ?? null,
    selectedSum: calculadas?.somaSelecionada ?? null,
    goalDifference: t !== null && calculadas?.somaSelecionada !== null && calculadas?.somaSelecionada !== undefined && calculadas.somaSelecionada !== t ? t - calculadas.somaSelecionada : null,
    needsReview: revisar,
    linhasCalculadas: calculadas,
  };
}

/** Conteúdo do estoque atual com os números da janela (lista de separação). */
export function conteudoVolumes(c: ConteudoBase, base: BasePainel, janelaId: string): ConteudoVolumes {
  const pal = base.paletePorId.get(c.paleteId);
  const { p, e } = pe(c.porJanela.get(janelaId) ?? zero());
  return {
    linkId: c.alvo === 'VINCULO' ? c.id : null,
    contentId: c.alvo === 'CONTEUDO' ? c.id : null,
    palletId: c.paleteId,
    palletCode: pal?.codigo ?? '',
    address: pal?.endereco ?? null,
    documentType: c.tipo,
    documentNumber: c.numero,
    delivery: c.delivery,
    sender: c.remetente,
    baseVolumes: c.base,
    basis: c.basis,
    committedAllWindows: c.comprometido,
    separatedWaiting: p,
    shipped: e,
    available: c.base === null ? null : Math.max(c.base - c.comprometido, 0),
  };
}

export { ROTULO_ETAPA_SELECAO };
