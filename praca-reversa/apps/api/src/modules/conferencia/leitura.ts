/**
 * Consultas da conferência. Tudo restrito ao escopo ativo; sessão de outro
 * escopo responde como inexistente (`null`).
 */
import {
  normalizarQuantidade,
  type ConferenciaDetalhe,
  type ConferenciaResumo,
  type ContagemObservada,
  type HistoricoConferencias,
  type LinhaObservacao,
  type PaleteDetalhe,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { eventoDaVersao, itemSaldo, lerEventos, lerSaldoPalete, ultimaReconciliacao } from '../estoque/saldo.js';
import { comparar, totalizar, type LinhaParaTotal, type ProdutoParaConversao } from './regras.js';
import { anexosDaConferencia } from './anexos.js';

type Db = Banco | Transacao;

const pessoaSelect = { select: { login: true, nome: true } } as const;
const pessoa = (u: { login: string; nome: string } | null) => (u ? { login: u.login, name: u.nome } : null);

export const selecaoSessao = {
  id: true,
  numero: true,
  paleteId: true,
  escopoContagem: true,
  descricaoEscopo: true,
  motivo: true,
  situacao: true,
  revisao: true,
  iniciadaEm: true,
  atualizadaEm: true,
  concluidaEm: true,
  canceladaEm: true,
  reconciliadaEm: true,
  responsavel: pessoaSelect,
  concluidaPor: pessoaSelect,
  sessaoOrigem: { select: { id: true, numero: true } },
} as const satisfies Prisma.SessaoConferenciaSelect;

type SessaoSelecionada = Prisma.SessaoConferenciaGetPayload<{ select: typeof selecaoSessao }>;

interface Contagem {
  ativas: number;
  pendentes: number;
}

/** Linhas ativas e pendentes por sessão (linhas removidas não contam). */
export async function contarLinhas(db: Db, sessaoIds: readonly string[]): Promise<Map<string, Contagem>> {
  const mapa = new Map<string, Contagem>();
  if (sessaoIds.length === 0) return mapa;
  const grupos = await db.observacaoConferencia.groupBy({
    by: ['sessaoId', 'pendencia'],
    where: { sessaoId: { in: [...sessaoIds] }, removidaEm: null },
    _count: { _all: true },
  });
  for (const g of grupos) {
    const atual = mapa.get(g.sessaoId) ?? { ativas: 0, pendentes: 0 };
    atual.ativas += g._count._all;
    if (g.pendencia !== null) atual.pendentes += g._count._all;
    mapa.set(g.sessaoId, atual);
  }
  return mapa;
}

export function resumoSessao(s: SessaoSelecionada, contagem: Contagem | undefined): ConferenciaResumo {
  return {
    id: s.id,
    number: s.numero,
    palletId: s.paleteId,
    scope: s.escopoContagem,
    scopeDescription: s.descricaoEscopo,
    kind: s.motivo,
    origin: s.sessaoOrigem ? { id: s.sessaoOrigem.id, number: s.sessaoOrigem.numero } : null,
    state: s.situacao,
    revision: s.revisao,
    responsible: pessoa(s.responsavel),
    startedAt: s.iniciadaEm.toISOString(),
    updatedAt: s.atualizadaEm.toISOString(),
    concludedAt: s.concluidaEm?.toISOString() ?? null,
    concludedBy: pessoa(s.concluidaPor),
    cancelledAt: s.canceladaEm?.toISOString() ?? null,
    reconciledAt: s.reconciliadaEm?.toISOString() ?? null,
    activeLines: contagem?.ativas ?? 0,
    pendingLines: contagem?.pendentes ?? 0,
  };
}

const selecaoLinha = {
  id: true,
  ordem: true,
  produtoId: true,
  sku: true,
  descricao: true,
  codigoLido: true,
  modoEntrada: true,
  quantidadeInformada: true,
  unidadeInformada: true,
  fatorConversao: true,
  quantidadeCanonica: true,
  unidadeCanonica: true,
  lote: true,
  origemTipo: true,
  origemReferencia: true,
  condicao: true,
  pendencia: true,
  nota: true,
  evidencia: true,
  revisao: true,
  registradoEm: true,
  registradoPor: pessoaSelect,
  removidaEm: true,
  removidaPor: pessoaSelect,
  motivoRemocao: true,
  revisoes: {
    where: { acao: 'CORRIGIDA' },
    orderBy: { revisao: 'desc' as const },
    take: 1,
    select: { ocorridoEm: true, autor: pessoaSelect },
  },
} as const satisfies Prisma.ObservacaoConferenciaSelect;

type LinhaSelecionada = Prisma.ObservacaoConferenciaGetPayload<{ select: typeof selecaoLinha }>;

export function linhaObservacao(l: LinhaSelecionada): LinhaObservacao {
  const correcao = l.revisoes[0];
  return {
    id: l.id,
    order: l.ordem,
    productId: l.produtoId,
    sku: l.sku,
    description: l.descricao,
    codeRead: l.codigoLido,
    entryMode: l.modoEntrada,
    quantity: l.quantidadeInformada.toFixed(),
    unit: l.unidadeInformada,
    factor: l.fatorConversao?.toFixed() ?? null,
    canonicalQuantity: l.quantidadeCanonica?.toFixed() ?? null,
    canonicalUnit: l.unidadeCanonica,
    lot: l.lote,
    originType: l.origemTipo,
    originReference: l.origemReferencia,
    condition: l.condicao,
    pending: l.pendencia,
    note: l.nota,
    evidence: l.evidencia,
    revision: l.revisao,
    registeredAt: l.registradoEm.toISOString(),
    registeredBy: pessoa(l.registradoPor),
    corrected: correcao ? { at: correcao.ocorridoEm.toISOString(), by: pessoa(correcao.autor) } : null,
    removed: l.removidaEm ? { at: l.removidaEm.toISOString(), by: pessoa(l.removidaPor), reason: l.motivoRemocao } : null,
  };
}

function paraTotal(l: LinhaSelecionada): LinhaParaTotal {
  return {
    id: l.id,
    produtoId: l.produtoId,
    sku: l.sku,
    descricao: l.descricao,
    codigoLido: l.codigoLido,
    lote: l.lote,
    origemTipo: l.origemTipo,
    origemReferencia: l.origemReferencia,
    condicao: l.condicao,
    quantidadeInformada: l.quantidadeInformada.toFixed(),
    unidadeInformada: l.unidadeInformada,
    quantidadeCanonica: l.quantidadeCanonica?.toFixed() ?? null,
    unidadeCanonica: l.unidadeCanonica,
    pendencia: l.pendencia,
    removida: l.removidaEm !== null,
  };
}

/** Linhas da sessão (inclui removidas, para o histórico) em ordem de registro. */
export async function lerLinhas(db: Db, escopoId: string, sessaoId: string): Promise<LinhaSelecionada[]> {
  return db.observacaoConferencia.findMany({ where: { escopoId, sessaoId }, orderBy: { ordem: 'asc' }, select: selecaoLinha });
}

/** Totais e pendências das linhas ativas de uma sessão. */
export async function totaisDaSessao(db: Db, escopoId: string, sessaoId: string) {
  return totalizar((await lerLinhas(db, escopoId, sessaoId)).map(paraTotal));
}

async function produtosParaConversao(db: Db, escopoId: string, ids: readonly string[]): Promise<Map<string, ProdutoParaConversao>> {
  if (ids.length === 0) return new Map();
  const produtos = await db.produto.findMany({
    where: { escopoId, id: { in: [...new Set(ids)] } },
    select: { id: true, sku: true, descricao: true, unidadeCanonica: true, codigosBarras: { select: { embalagem: true, fatorConversao: true } } },
  });
  return new Map(
    produtos.map((p) => [
      p.id,
      {
        id: p.id,
        sku: p.sku,
        descricao: p.descricao,
        unidadeCanonica: p.unidadeCanonica,
        embalagens: p.codigosBarras.map((c) => ({ embalagem: c.embalagem, fator: c.fatorConversao?.toFixed() ?? null })),
      },
    ]),
  );
}

/** Detalhe da sessão de conferência; `null` se não existir no escopo. */
export async function lerConferencia(db: Db, escopoId: string, id: string): Promise<ConferenciaDetalhe | null> {
  const s = await db.sessaoConferencia.findFirst({
    where: { id, escopoId },
    select: {
      ...selecaoSessao,
      justificativa: true,
      observacoes: true,
      versaoPaleteInicial: true,
      versaoSaldoInicial: true,
      escopoCompletoConfirmado: true,
      canceladaPor: pessoaSelect,
      motivoCancelamento: true,
      reconciliadaPor: pessoaSelect,
      justificativaReconciliacao: true,
      pendenciaReconciliacao: true,
      pendenciaRegistradaEm: true,
      evento: { select: { id: true } },
      recontagens: { orderBy: { numero: 'asc' }, select: { id: true, numero: true, situacao: true } },
      palete: {
        select: {
          id: true,
          codigo: true,
          versao: true,
          versaoSaldo: true,
          estadoConferencia: true,
          estadoLiberacao: true,
          arquivadoEm: true,
          posicao: { select: { codigo: true } },
          declarados: { orderBy: { ordem: 'asc' } },
        },
      },
    },
  });
  if (!s) return null;
  const linhas = await lerLinhas(db, escopoId, id);
  const { totais, pendencias } = totalizar(linhas.map(paraTotal));
  const contagem = { ativas: linhas.filter((l) => l.removidaEm === null).length, pendentes: pendencias.length };

  let comparacao: ConferenciaDetalhe['comparison'] = null;
  if (s.situacao !== 'EM_ANDAMENTO') {
    // Só o palete reconciliado tem saldo validado integral para comparar; o
    // saldo recebido por transferência num palete não conferido não vira "zero" do resto.
    const reconciliado = (await ultimaReconciliacao(db, escopoId, s.paleteId)) !== null;
    const saldo = reconciliado ? await lerSaldoPalete(db, escopoId, s.paleteId) : null;
    const produtos = await produtosParaConversao(db, escopoId, [
      ...s.palete.declarados.flatMap((d) => (d.produtoId ? [d.produtoId] : [])),
      ...linhas.flatMap((l) => (l.produtoId ? [l.produtoId] : [])),
      ...(saldo ?? []).map((x) => x.produtoId),
    ]);
    const porLinha = new Map(linhas.map((l) => [l.id, l]));
    comparacao = comparar({
      escopo: s.escopoContagem,
      totais,
      pendencias: pendencias.map((p) => {
        const l = porLinha.get(p.lineId);
        return { ...p, produtoId: l?.produtoId ?? null, origemTipo: l?.origemTipo ?? null, origemReferencia: l?.origemReferencia ?? null };
      }),
      declarados: s.palete.declarados.map((d) => ({
        produtoId: d.produtoId,
        descricao: d.descricao,
        lote: d.lote,
        origemTipo: d.origemTipo,
        origemReferencia: d.origemReferencia,
        quantidade: d.quantidade.toFixed(),
        unidade: d.unidadeMedida,
      })),
      saldo,
      produtos,
    });
  }

  const substituta = s.recontagens.find((r) => r.situacao === 'CONCLUIDA' || r.situacao === 'RECONCILIADA');
  const aberta = s.situacao === 'EM_ANDAMENTO' || s.situacao === 'CONCLUIDA';
  return {
    ...resumoSessao(s, contagem),
    justification: s.justificativa,
    notes: s.observacoes,
    initialPalletVersion: s.versaoPaleteInicial,
    fullScopeConfirmed: s.escopoCompletoConfirmado,
    cancelledBy: pessoa(s.canceladaPor),
    cancelReason: s.motivoCancelamento,
    reconciledBy: pessoa(s.reconciliadaPor),
    reconciliationJustification: s.justificativaReconciliacao,
    reconciliationEventId: s.evento?.id ?? null,
    supersededBy: s.situacao === 'SUBSTITUIDA' && substituta ? { id: substituta.id, number: substituta.numero } : null,
    recounts: s.recontagens.map((r) => ({ id: r.id, number: r.numero, state: r.situacao })),
    pendingReconciliation:
      s.pendenciaReconciliacao && s.pendenciaRegistradaEm
        ? { at: s.pendenciaRegistradaEm.toISOString(), reason: s.pendenciaReconciliacao }
        : null,
    outdated: aberta && s.palete.versaoSaldo !== s.versaoSaldoInicial,
    pallet: {
      id: s.palete.id,
      code: s.palete.codigo,
      positionCode: s.palete.posicao?.codigo ?? null,
      version: s.palete.versao,
      countState: s.palete.estadoConferencia,
      releaseState: s.palete.estadoLiberacao,
      archived: s.palete.arquivadoEm !== null,
    },
    lines: linhas.map(linhaObservacao),
    totals: totais,
    pending: pendencias,
    comparison: comparacao,
    attachments: await anexosDaConferencia(db, escopoId, id),
  };
}

/** Partes do detalhe do palete que vêm da conferência e do estoque validado. */
export async function conferenciaDoPalete(
  db: Db,
  escopoId: string,
  paleteId: string,
): Promise<Pick<PaleteDetalhe, 'activeCountId' | 'activeCount' | 'observedCounts' | 'currentItems' | 'lastReconciliation' | 'lastStockEvent'>> {
  const reconciliacao = await ultimaReconciliacao(db, escopoId, paleteId);
  const palete = await db.palete.findFirstOrThrow({ where: { id: paleteId, escopoId }, select: { versaoSaldo: true } });
  const idUltimo = palete.versaoSaldo > 1 ? await eventoDaVersao(db, escopoId, paleteId, palete.versaoSaldo) : null;
  const ultimo = idUltimo
    ? await db.eventoEstoque.findUniqueOrThrow({
        where: { id: idUltimo },
        select: { id: true, tipo: true, ocorridoEm: true, autor: pessoaSelect, sessao: { select: { id: true, numero: true } } },
      })
    : null;
  const sessoes = await db.sessaoConferencia.findMany({
    where: {
      escopoId,
      paleteId,
      OR: [{ situacao: 'EM_ANDAMENTO' }, { situacao: 'CONCLUIDA', ...(reconciliacao ? { concluidaEm: { gt: reconciliacao.ocorridoEm } } : {}) }],
    },
    orderBy: { numero: 'asc' },
    select: selecaoSessao,
  });
  const contagens = await contarLinhas(db, sessoes.map((s) => s.id));
  const ativa = sessoes.find((s) => s.situacao === 'EM_ANDAMENTO');
  const observadas: ContagemObservada[] = [];
  for (const s of sessoes) {
    if (s.situacao !== 'CONCLUIDA') continue;
    const { totais, pendencias } = await totaisDaSessao(db, escopoId, s.id);
    observadas.push({ session: resumoSessao(s, contagens.get(s.id)), items: totais, pending: pendencias });
  }
  const saldo = ultimo ? await lerSaldoPalete(db, escopoId, paleteId) : null;
  const referencia = (e: NonNullable<typeof ultimo>) => ({
    eventId: e.id,
    type: e.tipo,
    at: e.ocorridoEm.toISOString(),
    by: pessoa(e.autor),
    session: e.sessao ? { id: e.sessao.id, number: e.sessao.numero } : null,
  });
  return {
    activeCountId: ativa?.id ?? null,
    activeCount: ativa ? resumoSessao(ativa, contagens.get(ativa.id)) : null,
    observedCounts: observadas,
    currentItems: saldo
      ? saldo.map((x) => ({ ...itemSaldo(x), quantity: normalizarQuantidade(x.quantidade), reserved: normalizarQuantidade(x.reservada) }))
      : null,
    lastReconciliation: reconciliacao ? referencia(reconciliacao) : null,
    lastStockEvent: ultimo ? referencia(ultimo) : null,
  };
}

/** Conferências em andamento por palete do escopo (para mapa e lista). */
export async function conferenciasAtivas(db: Db, escopoId: string, paleteIds?: readonly string[]): Promise<Map<string, string>> {
  const ativas = await db.sessaoConferencia.findMany({
    where: { escopoId, ativa: true, ...(paleteIds ? { paleteId: { in: [...paleteIds] } } : {}) },
    select: { id: true, paleteId: true },
  });
  return new Map(ativas.map((s) => [s.paleteId, s.id]));
}

/** Histórico do palete: todas as conferências e os eventos de estoque. */
export async function historicoDoPalete(db: Db, escopoId: string, paleteId: string): Promise<HistoricoConferencias> {
  const sessoes = await db.sessaoConferencia.findMany({ where: { escopoId, paleteId }, orderBy: { numero: 'desc' }, select: selecaoSessao });
  const contagens = await contarLinhas(db, sessoes.map((s) => s.id));
  return {
    sessions: sessoes.map((s) => resumoSessao(s, contagens.get(s.id))),
    events: await lerEventos(db, escopoId, { paleteId }),
  };
}
