import {
  ExpedicaoDetalheSchema,
  JanelaDetalheSchema,
  PaleteDetalheSchema,
  ReservaDetalheSchema,
  type ConfirmarExpedicao,
  type CriarJanela,
  type ExpedicaoDetalhe,
  type JanelaDetalhe,
  type PaleteDetalhe,
  type ReservaDetalhe,
  type RestricaoEntrada,
  type UnidadeCargaEntrada,
} from '@praca-reversa/contracts';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { como, mutar, type SessaoTeste } from './apoio.js';
import { API, criarPalete, criarProduto, palete, reconciliar, segmentoDe, type Ambiente, type Item } from './claims-apoio.js';

/**
 * Cenários das janelas (etapa 08) pelo fluxo real da API: material
 * reconciliado, liberação, janela autorizada, reserva, preparação e
 * expedição. Todas as autorizações, datas, documentos e medidas são
 * fictícios.
 */
export { API };

/** Intervalo de saída fictício em torno do relógio real dos testes (a API usa o relógio do sistema). */
const BASE = Date.now();
export const SAIDA_INICIO = new Date(BASE - 6 * 3_600_000).toISOString();
export const SAIDA_FIM = new Date(BASE + 6 * 3_600_000).toISOString();
/** Saída real informada na confirmação (já aconteceu). */
export const SAIDA_REAL = new Date(BASE - 30 * 60_000).toISOString();
export const MES = SAIDA_INICIO.slice(0, 7);

export function dadosJanela(restricoes: RestricaoEntrada[], extra: Partial<CriarJanela> = {}): CriarJanela {
  return {
    name: 'Janela fictícia de outubro — 1ª',
    clientReference: 'AUT-FICT-0001',
    referenceMonth: MES,
    exitStart: SAIDA_INICIO,
    exitEnd: SAIDA_FIM,
    preparationDeadline: null,
    restrictions: restricoes,
    criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: [], notes: null },
    authorization: { source: 'E-mail fictício do cliente', reference: '000123', date: '2026-10-01', responsible: 'Contato fictício' },
    notes: 'Dados fictícios de teste.',
    ...extra,
  };
}

export async function criarJanela(a: Ambiente, dados: CriarJanela, s: SessaoTeste = a.sup): Promise<JanelaDetalhe> {
  const r = await mutar(a.app, s, 'POST', `${API}/janelas`, dados);
  expect(r.statusCode, r.body).toBe(200);
  return JanelaDetalheSchema.parse(r.json());
}

export async function janela(a: Ambiente, id: string, s: SessaoTeste = a.sup): Promise<JanelaDetalhe> {
  const r = await como(a.app, s, { method: 'GET', url: `${API}/janelas/${id}` });
  expect(r.statusCode, r.body).toBe(200);
  return JanelaDetalheSchema.parse(r.json());
}

export async function confirmar(a: Ambiente, j: JanelaDetalhe): Promise<JanelaDetalhe> {
  const r = await mutar(a.app, a.sup, 'POST', `${API}/janelas/${j.id}/confirmar`, { expectedVersion: j.version });
  expect(r.statusCode, r.body).toBe(200);
  return JanelaDetalheSchema.parse(r.json());
}

/** Janela confirmada com as restrições informadas. */
export async function janelaConfirmada(a: Ambiente, restricoes: RestricaoEntrada[], extra: Partial<CriarJanela> = {}): Promise<JanelaDetalhe> {
  return confirmar(a, await criarJanela(a, dadosJanela(restricoes, extra)));
}

export const pecas = (limite: string | null): RestricaoEntrada => ({ metric: 'QUANTIDADE', unit: 'UN', limit: limite });

/** Palete reconciliado com os itens informados (produto criado se faltar). */
export async function paleteComSaldo(a: Ambiente, itens: (Omit<Item, 'productId'> & { sku: string })[]): Promise<PaleteDetalhe> {
  const p = await criarPalete(a);
  const produtos = new Map<string, string>();
  for (const i of itens) {
    if (!produtos.has(i.sku)) {
      const existente = await a.db.produto.findFirst({ where: { sku: i.sku }, select: { id: true } });
      produtos.set(i.sku, existente?.id ?? (await criarProduto(a, i.sku, `Produto fictício ${i.sku}`)).id);
    }
  }
  const { resposta } = await reconciliar(
    a,
    p.id,
    itens.map(({ sku, ...resto }) => ({ ...resto, productId: produtos.get(sku) ?? '' })),
  );
  expect(resposta?.statusCode, resposta?.body).toBe(200);
  return palete(a, p.id);
}

export function liberarMaterial(a: Ambiente, p: PaleteDetalhe, segmentoId: string, quantidade: string, s: SessaoTeste = a.sup, chaveIdem?: string): Promise<LightMyRequestResponse> {
  return mutar(
    a.app,
    s,
    'POST',
    `${API}/paletes/${p.id}/liberacao`,
    {
      action: 'LIBERAR',
      expectedVersion: p.version,
      segmentId: segmentoId,
      quantity: quantidade,
      criterion: 'Material saudável conferido (critério fictício)',
      source: 'Checklist fictício de liberação',
      reference: 'LIB-0001',
      reason: 'Liberação de teste',
    },
    chaveIdem,
  );
}

/** Palete com um SKU reconciliado e liberado. */
export async function materialLiberado(a: Ambiente, sku: string, quantidade: string, liberar = quantidade): Promise<{ p: PaleteDetalhe; seg: string }> {
  const p = await paleteComSaldo(a, [{ sku, quantity: quantidade, lot: 'L-01', ref: 'DEV-FICT-1' }]);
  const seg = segmentoDe(p, sku);
  const r = await liberarMaterial(a, p, seg, liberar);
  expect(r.statusCode, r.body).toBe(200);
  return { p: PaleteDetalheSchema.parse(r.json()), seg };
}

export interface LinhaSel {
  p: PaleteDetalhe;
  seg: string;
  q: string;
}

export function corpoReserva(j: Pick<JanelaDetalhe, 'version'>, linhas: LinhaSel[], unidades: UnidadeCargaEntrada[] = []) {
  return {
    expectedWindowVersion: j.version,
    lines: linhas.map((l) => ({ palletId: l.p.id, segmentId: l.seg, quantity: l.q, expectedPalletVersion: l.p.version })),
    loadUnits: unidades,
    notes: null,
  };
}

export function reservar(a: Ambiente, j: Pick<JanelaDetalhe, 'id' | 'version'>, linhas: LinhaSel[], unidades: UnidadeCargaEntrada[] = [], s: SessaoTeste = a.sup, chaveIdem?: string) {
  return mutar(a.app, s, 'POST', `${API}/janelas/${j.id}/reservas`, corpoReserva(j, linhas, unidades), chaveIdem);
}

export async function reservarOk(a: Ambiente, j: Pick<JanelaDetalhe, 'id' | 'version'>, linhas: LinhaSel[], unidades: UnidadeCargaEntrada[] = []): Promise<ReservaDetalhe> {
  const r = await reservar(a, j, linhas, unidades);
  expect(r.statusCode, r.body).toBe(200);
  return ReservaDetalheSchema.parse(r.json());
}

export async function reserva(a: Ambiente, id: string, s: SessaoTeste = a.sup): Promise<ReservaDetalhe> {
  const r = await como(a.app, s, { method: 'GET', url: `${API}/reservas/${id}` });
  expect(r.statusCode, r.body).toBe(200);
  return ReservaDetalheSchema.parse(r.json());
}

export async function idUsuario(a: Ambiente, login: string): Promise<string> {
  return (await a.db.usuario.findUniqueOrThrow({ where: { login }, select: { id: true } })).id;
}

/** Confirmação da saída com as quantidades por linha (padrão: tudo o reservado). */
export async function corpoExpedicao(a: Ambiente, r: ReservaDetalhe, extra: Partial<ConfirmarExpedicao> & { quantidades?: Record<string, string> } = {}): Promise<ConfirmarExpedicao> {
  const { quantidades, ...resto } = extra;
  return {
    expectedVersion: r.version,
    shippedAt: SAIDA_REAL,
    responsibleId: await idUsuario(a, 'supervisor'),
    lines: r.lines.map((l) => ({ lineId: l.id, quantity: quantidades?.[l.id] ?? l.quantity })),
    loadUnits: [],
    documents: [],
    remainderAcknowledged: false,
    notes: null,
    ...resto,
  };
}

export function expedir(a: Ambiente, r: ReservaDetalhe, corpo: ConfirmarExpedicao, s: SessaoTeste = a.sup, chaveIdem?: string) {
  return mutar(a.app, s, 'POST', `${API}/reservas/${r.id}/expedicao`, corpo, chaveIdem);
}

export async function expedirOk(a: Ambiente, r: ReservaDetalhe, corpo: ConfirmarExpedicao): Promise<ExpedicaoDetalhe> {
  const resposta = await expedir(a, r, corpo);
  expect(resposta.statusCode, resposta.body).toBe(200);
  return ExpedicaoDetalheSchema.parse(resposta.json());
}

export function cancelar(a: Ambiente, r: Pick<ReservaDetalhe, 'id' | 'version'>, s: SessaoTeste = a.sup, chaveIdem?: string) {
  return mutar(a.app, s, 'POST', `${API}/reservas/${r.id}/cancelar`, { expectedVersion: r.version, reason: 'Cliente pediu outra composição (fictício)' }, chaveIdem);
}

/** Saldo, reservado e liberado atuais de um palete × segmento. */
export async function saldoAtual(a: Ambiente, paleteId: string, segmentoId: string) {
  const s = await a.db.saldoEstoque.findUnique({ where: { paleteId_segmentoId: { paleteId, segmentoId } } });
  return s === null ? null : { quantidade: s.quantidade.toFixed(), reservada: s.quantidadeReservada.toFixed(), liberada: s.quantidadeLiberada.toFixed(), vinculada: s.quantidadeVinculada.toFixed() };
}

export function restricao(j: JanelaDetalhe, metrica: JanelaDetalhe['restrictions'][number]['metric']) {
  const r = j.restrictions.find((x) => x.metric === metrica);
  if (!r) throw new Error(`Janela sem restrição ${metrica}.`);
  return r;
}

/**
 * Reserva real pela API (liberação + janela confirmada + reserva), para
 * testes de outras etapas que precisam de quantidade reservada (o banco
 * confere que o reservado do saldo é a soma das reservas ativas).
 */
export async function reservarPelaApi(app: FastifyInstance, s: SessaoTeste, paleteId: string, segmentoId: string, quantidade: string, liberar: string = quantidade): Promise<ReservaDetalhe> {
  const antes = PaleteDetalheSchema.parse((await como(app, s, { method: 'GET', url: `${API}/paletes/${paleteId}` })).json());
  const jaLiberado = antes.currentItems?.find((i) => i.segmentId === segmentoId)?.released ?? '0';
  let atual = antes;
  if (jaLiberado === '0') {
    const l = await mutar(app, s, 'POST', `${API}/paletes/${paleteId}/liberacao`, {
      action: 'LIBERAR',
      expectedVersion: antes.version,
      segmentId: segmentoId,
      quantity: liberar,
      criterion: 'Critério fictício de teste',
      source: 'Fonte fictícia',
      reference: null,
      reason: 'Liberação para teste de reserva',
    });
    expect(l.statusCode, l.body).toBe(200);
    atual = PaleteDetalheSchema.parse(l.json());
  }
  const criada = await mutar(app, s, 'POST', `${API}/janelas`, dadosJanela([pecas('100000')]));
  expect(criada.statusCode, criada.body).toBe(200);
  const j = JanelaDetalheSchema.parse(criada.json());
  const confirmada = await mutar(app, s, 'POST', `${API}/janelas/${j.id}/confirmar`, { expectedVersion: j.version });
  expect(confirmada.statusCode, confirmada.body).toBe(200);
  const jc = JanelaDetalheSchema.parse(confirmada.json());
  const r = await mutar(app, s, 'POST', `${API}/janelas/${j.id}/reservas`, corpoReserva(jc, [{ p: atual, seg: segmentoId, q: quantidade }]));
  expect(r.statusCode, r.body).toBe(200);
  return ReservaDetalheSchema.parse(r.json());
}
