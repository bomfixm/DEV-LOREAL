import {
  ClaimDetalheSchema,
  ConferenciaDetalheSchema,
  PaleteDetalheSchema,
  ProdutoSchema,
  RespostaCandidatosSchema,
  type ClaimDetalhe,
  type CondicaoMaterial,
  type CriarClaim,
  type PaleteDetalhe,
  type Produto,
  type RespostaCandidatos,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_NAVEGACAO, ID_ESCOPO_PRACA, appDeTeste, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste } from './apoio.js';

/**
 * Cenários dos claims (etapa 07) pelo fluxo real da API: produtos, paletes,
 * conferência completa reconciliada (saldo validado), claims, evidências e
 * validação. Dados fictícios.
 */
export const API = '/api/v1';

export interface Ambiente {
  db: Banco;
  app: FastifyInstance;
  sup: SessaoTeste;
  op: SessaoTeste;
  analista: SessaoTeste;
  financeiro: SessaoTeste;
  consulta: SessaoTeste;
  outroEscopo: SessaoTeste;
}

export async function montarAmbiente(db: Banco): Promise<Ambiente> {
  await prepararDados(db);
  const app = await appDeTeste(db);
  const [sup, op, analista, financeiro, consulta, outro] = await Promise.all([
    criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'operador', [[ID_ESCOPO_PRACA, 'OPERADOR']]),
    criarUsuario(db, 'analista', [[ID_ESCOPO_PRACA, 'ANALISTA_CLAIMS']]),
    criarUsuario(db, 'financeiro', [[ID_ESCOPO_PRACA, 'ANALISTA_CLAIMS']]),
    criarUsuario(db, 'consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]),
    criarUsuario(db, 'analista.outro', [[ID_ESCOPO_NAVEGACAO, 'ANALISTA_CLAIMS']]),
  ]);
  // Concessão explícita de aprovação financeira (só a este analista).
  await db.vinculo.updateMany({ where: { usuarioId: financeiro.id, escopoId: ID_ESCOPO_PRACA }, data: { aprovaFinanceiro: true } });
  const sessoes = await Promise.all([entrar(app, sup), entrar(app, op), entrar(app, analista), entrar(app, financeiro), entrar(app, consulta), entrar(app, outro)]);
  return { db, app, sup: sessoes[0], op: sessoes[1], analista: sessoes[2], financeiro: sessoes[3], consulta: sessoes[4], outroEscopo: sessoes[5] };
}

export async function criarProduto(a: Ambiente, sku: string, descricao: string): Promise<Produto> {
  const r = await mutar(a.app, a.sup, 'POST', `${API}/produtos`, { sku, description: descricao, canonicalUnit: 'UN', active: true, barcodes: [] });
  expect(r.statusCode, r.body).toBe(201);
  return ProdutoSchema.parse(r.json());
}

/** Próxima posição livre do layout ativo do escopo. */
async function posicaoLivre(db: Banco): Promise<string> {
  const [linha] = await db.$queryRaw<{ id: string }[]>`
    SELECT pos.id::text FROM posicao pos JOIN layout l ON l.id = pos.layout_id
     WHERE pos.escopo_id = ${ID_ESCOPO_PRACA}::uuid AND l.ativo AND pos.disponivel AND pos.retirada_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM palete p WHERE p.posicao_id = pos.id)
     ORDER BY pos.codigo DESC LIMIT 1`;
  if (!linha) throw new Error('Sem posição livre no layout de demonstração.');
  return linha.id;
}

export async function criarPalete(a: Ambiente, comPosicao = true): Promise<PaleteDetalhe> {
  const positionId = comPosicao ? await posicaoLivre(a.db) : null;
  const r = await mutar(a.app, a.op, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId, notes: null, declaredItems: [] });
  expect(r.statusCode, r.body).toBe(201);
  return PaleteDetalheSchema.parse(r.json());
}

export async function palete(a: Ambiente, id: string): Promise<PaleteDetalhe> {
  return PaleteDetalheSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/paletes/${id}` })).json());
}

export interface Item {
  productId: string;
  quantity: string;
  lot: string | null;
  ref: string | null;
  condition?: CondicaoMaterial;
  originType?: 'DEVOLUCAO' | 'NOTA_FISCAL';
}

/** Contagem completa concluída e reconciliada pelo supervisor (saldo validado). */
export async function reconciliar(a: Ambiente, paleteId: string, itens: Item[], completa = true) {
  const p = await palete(a, paleteId);
  const inicio = await mutar(a.app, a.op, 'POST', `${API}/paletes/${paleteId}/conferencias`, {
    scope: completa ? 'COMPLETA' : 'PARCIAL',
    scopeDescription: completa ? null : 'Camada de cima',
    expectedVersion: p.version,
  });
  expect(inicio.statusCode, inicio.body).toBe(201);
  const sessao = ConferenciaDetalheSchema.parse(inicio.json());
  for (const i of itens) {
    const r = await mutar(a.app, a.op, 'POST', `${API}/conferencias/${sessao.id}/observacoes`, {
      mode: 'MANUAL',
      productId: i.productId,
      quantity: i.quantity,
      unit: 'UN',
      lot: i.lot,
      originType: i.ref === null ? null : (i.originType ?? 'DEVOLUCAO'),
      originReference: i.ref,
      condition: i.condition ?? 'SAUDAVEL',
    });
    expect(r.statusCode, r.body).toBe(201);
  }
  const atual = ConferenciaDetalheSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/conferencias/${sessao.id}` })).json());
  const fim = await mutar(a.app, a.op, 'POST', `${API}/conferencias/${sessao.id}/concluir`, {
    expectedRevision: atual.revision,
    expectedPalletVersion: atual.pallet.version,
    confirmFullScope: completa,
  });
  expect(fim.statusCode, fim.body).toBe(200);
  const concluida = ConferenciaDetalheSchema.parse(fim.json());
  if (!completa) return { sessao: concluida, palete: await palete(a, paleteId) };
  const r = await mutar(a.app, a.sup, 'POST', `${API}/conferencias/${sessao.id}/reconciliar`, { expectedPalletVersion: concluida.pallet.version, justification: 'Saldo de teste' });
  return { sessao: concluida, resposta: r, palete: await palete(a, paleteId) };
}

export function segmentoDe(p: PaleteDetalhe, sku: string, lote: string | null = null): string {
  const item = p.currentItems?.find((i) => i.sku === sku && (lote === null || i.lot === lote));
  if (!item) throw new Error(`Palete ${p.code} sem saldo de ${sku}.`);
  return item.segmentId;
}

export async function criarClaim(a: Ambiente, dados: CriarClaim, s: SessaoTeste = a.analista): Promise<ClaimDetalhe> {
  const r = await mutar(a.app, s, 'POST', `${API}/claims`, dados);
  expect(r.statusCode, r.body).toBe(200);
  return ClaimDetalheSchema.parse(r.json());
}

export async function detalhe(a: Ambiente, id: string, s: SessaoTeste = a.analista): Promise<ClaimDetalhe> {
  const r = await como(a.app, s, { method: 'GET', url: `${API}/claims/${id}` });
  expect(r.statusCode, r.body).toBe(200);
  return ClaimDetalheSchema.parse(r.json());
}

export async function candidatos(a: Ambiente, claimId: string, linhaId: string): Promise<RespostaCandidatos> {
  const r = await como(a.app, a.analista, { method: 'GET', url: `${API}/claims/${claimId}/linhas/${linhaId}/candidatos` });
  expect(r.statusCode, r.body).toBe(200);
  return RespostaCandidatosSchema.parse(r.json());
}

/** Evidência de material conferido (saldo validado do palete × segmento). Devolve o ID da evidência. */
export async function evidenciaMaterial(a: Ambiente, claimId: string, linhaId: string, paleteId: string, segmentoId: string, quantidade: string): Promise<string> {
  const r = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claimId}/evidencias`, {
    lineId: linhaId,
    type: 'MATERIAL_CONFERIDO',
    palletId: paleteId,
    segmentId: segmentoId,
    quantity: quantidade,
    description: 'Material conferido no palete (dados fictícios de teste).',
  });
  expect(r.statusCode, r.body).toBe(200);
  const d = ClaimDetalheSchema.parse(r.json());
  const e = d.evidences.at(-1);
  if (!e) throw new Error('Evidência não registrada.');
  return e.id;
}

export async function solicitar(a: Ambiente, claimId: string, evidenciaId: string, quantidade: string) {
  const atual = await detalhe(a, claimId);
  const e = atual.evidences.find((x) => x.id === evidenciaId);
  return mutar(a.app, a.analista, 'POST', `${API}/claims/${claimId}/evidencias/${evidenciaId}/solicitar-validacao`, { expectedVersion: e?.version ?? 1, quantity: quantidade });
}

export async function validarRec(a: Ambiente, claimId: string, evidenciaId: string, quantidade: string, extra: Record<string, unknown> = {}, chaveIdem?: string) {
  const atual = await detalhe(a, claimId);
  const e = atual.evidences.find((x) => x.id === evidenciaId);
  return mutar(
    a.app,
    a.analista,
    'POST',
    `${API}/claims/${claimId}/evidencias/${evidenciaId}/validar`,
    { expectedVersion: e?.version ?? 1, quantity: quantidade, justification: 'Material conferido e compatível (teste).', ...extra },
    chaveIdem,
  );
}

/** Evidência → solicitação → validação, esperando sucesso. */
export async function recuperar(a: Ambiente, claimId: string, linhaId: string, paleteId: string, segmentoId: string, quantidade: string): Promise<ClaimDetalhe> {
  const e = await evidenciaMaterial(a, claimId, linhaId, paleteId, segmentoId, quantidade);
  const s = await solicitar(a, claimId, e, quantidade);
  expect(s.statusCode, s.body).toBe(200);
  const v = await validarRec(a, claimId, e, quantidade);
  expect(v.statusCode, v.body).toBe(200);
  return ClaimDetalheSchema.parse(v.json());
}

export function claimFalta(sku: string, extra: Partial<CriarClaim> = {}, linha: Partial<CriarClaim['lines'][number]> = {}): CriarClaim {
  return {
    externalReference: `CLM-FICT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    reason: 'EXTRAVIO_FALTA',
    priority: 'ALTA',
    deadline: '2026-10-30',
    currency: 'BRL',
    valueSource: 'Tabela de preço fictícia',
    chargeFinalized: false,
    lines: [
      {
        lineRef: '1',
        sku,
        quantity: '12',
        unit: 'UN',
        lot: 'L-01',
        lotRequired: false,
        originType: 'DEVOLUCAO',
        originReference: 'DEV-A-01',
        originLine: '1',
        estimatedValue: '10.00',
        valueBase: 'UNITARIO',
        ...linha,
      },
    ],
    ...extra,
  };
}
