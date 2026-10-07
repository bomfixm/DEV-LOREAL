import { ConferenciaDetalheSchema, ResultadoOperacaoSchema } from '@praca-reversa/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bancoDeTeste, chave, codigoErro, como, mutar } from './apoio.js';
import { API, criarPalete, criarProduto, montarAmbiente, type Ambiente } from './claims-apoio.js';
import { corpoExpedicao, expedir, janelaConfirmada, materialLiberado, pecas, reservarOk, saldoAtual } from './janelas-apoio.js';

/**
 * Etapa 09 — resposta perdida não é recusa (T30). O pedido chega ao servidor,
 * a resposta não chega à interface: a consulta autenticada pela chave mostra
 * o resultado; repetir com a mesma chave devolve o mesmo resultado sem nova
 * gravação; outra carga com a mesma chave é recusada. Dados fictícios.
 */
const db = bancoDeTeste();
let a: Ambiente;

beforeAll(async () => {
  a = await montarAmbiente(db);
});

afterAll(async () => {
  await a.app.close();
  await db.$disconnect();
});

async function consultar(s: Ambiente['sup'], k: string) {
  const r = await como(a.app, s, { method: 'GET', url: `${API}/operacoes/${k}` });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.headers['cache-control']).toBe('no-store');
  return ResultadoOperacaoSchema.parse(r.json());
}

describe('consulta do resultado de operação (GET /operacoes/:chave)', () => {
  it('entrada da conferência com resposta perdida: registrada uma vez; reenvio repete a resposta; outro corpo é recusado', async () => {
    const produto = await criarProduto(a, 'SKU-REC-01', 'Produto fictício de recuperação');
    const p = await criarPalete(a);
    const inicio = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', scopeDescription: null, expectedVersion: p.version });
    expect(inicio.statusCode, inicio.body).toBe(201);
    const conferencia = ConferenciaDetalheSchema.parse(inicio.json());
    const k = chave();
    const corpo = { mode: 'MANUAL', productId: produto.id, quantity: '3', unit: 'UN', lot: null, originType: null, originReference: null, condition: 'SAUDAVEL' };

    // O servidor grava; a interface "não recebe" esta resposta.
    const perdida = await mutar(a.app, a.op, 'POST', `${API}/conferencias/${conferencia.id}/observacoes`, corpo, k);
    expect(perdida.statusCode, perdida.body).toBe(201);

    const resultado = await consultar(a.op, k);
    expect(resultado.state).toBe('REGISTRADA');
    expect(resultado.operations).toHaveLength(1);
    expect(resultado.operations[0]).toMatchObject({ operation: 'conferencia.observar', status: 201 });
    expect(resultado.operations[0]?.response).toEqual(perdida.json());

    // Repetir com a mesma chave e o mesmo corpo: mesma resposta, nada novo no rascunho.
    const repetida = await mutar(a.app, a.op, 'POST', `${API}/conferencias/${conferencia.id}/observacoes`, corpo, k);
    expect(repetida.statusCode).toBe(201);
    expect(repetida.headers['idempotency-replayed']).toBe('true');
    expect(repetida.json()).toEqual(perdida.json());
    // Mesma chave, outro corpo: recusado (a mudança exige resolver o anterior e nova chave).
    const alterada = await mutar(a.app, a.op, 'POST', `${API}/conferencias/${conferencia.id}/observacoes`, { ...corpo, quantity: '4' }, k);
    expect(alterada.statusCode).toBe(422);
    expect(codigoErro(alterada)).toBe('IDEMPOTENCIA_CONFLITO');
    expect(await db.observacaoConferencia.count({ where: { sessaoId: conferencia.id } })).toBe(1);
  });

  it('expedição com resposta perdida: uma única baixa; consulta e reenvio não geram outra', async () => {
    const { p, seg } = await materialLiberado(a, 'SKU-REC-02', '5');
    const j = await janelaConfirmada(a, [pecas('100')]);
    const r = await reservarOk(a, j, [{ p, seg, q: '5' }]);
    const corpo = await corpoExpedicao(a, r);
    const k = chave();
    const perdida = await expedir(a, r, corpo, a.sup, k);
    expect(perdida.statusCode, perdida.body).toBe(200);
    const depois = await saldoAtual(a, p.id, seg);

    const resultado = await consultar(a.sup, k);
    expect(resultado.state).toBe('REGISTRADA');
    expect(resultado.operations[0]?.operation).toMatch(/expedicao/);

    const repetida = await expedir(a, r, corpo, a.sup, k);
    expect(repetida.statusCode).toBe(200);
    expect(repetida.headers['idempotency-replayed']).toBe('true');
    expect(await saldoAtual(a, p.id, seg)).toEqual(depois);
    expect(await db.eventoEstoque.count({ where: { paleteId: p.id, tipo: 'EXPEDICAO' } })).toBe(1);

    // Outra chave para a mesma reserva: a expedição é única (não há segunda baixa).
    const outra = await expedir(a, r, corpo, a.sup, chave());
    expect(outra.statusCode).toBeGreaterThanOrEqual(400);
    expect(await db.eventoEstoque.count({ where: { paleteId: p.id, tipo: 'EXPEDICAO' } })).toBe(1);
  });

  it('chave sem registro: NAO_ENCONTRADA (ainda pode estar em processamento; não é recusa)', async () => {
    const resultado = await consultar(a.op, chave());
    expect(resultado.state).toBe('NAO_ENCONTRADA');
    expect(resultado.operations).toEqual([]);
  });

  it('isolada por usuário, escopo e sessão; chave inválida é recusada', async () => {
    const k = chave();
    const criado = await mutar(a.app, a.sup, 'POST', `${API}/produtos`, { sku: 'SKU-REC-04', description: 'Outro fictício', canonicalUnit: 'UN', active: true, barcodes: [] }, k);
    expect(criado.statusCode).toBe(201);
    expect((await consultar(a.sup, k)).state).toBe('REGISTRADA');
    // Outro usuário do mesmo escopo e usuário de outro escopo não veem o resultado.
    expect((await consultar(a.op, k)).state).toBe('NAO_ENCONTRADA');
    expect((await consultar(a.outroEscopo, k)).state).toBe('NAO_ENCONTRADA');
    // Sem sessão: 401, nada exposto.
    const anonimo = await a.app.inject({ method: 'GET', url: `${API}/operacoes/${k}` });
    expect(anonimo.statusCode).toBe(401);
    const invalida = await como(a.app, a.sup, { method: 'GET', url: `${API}/operacoes/curta` });
    expect(invalida.statusCode).toBe(400);
    // A resposta não traz o hash do pedido.
    expect(JSON.stringify((await consultar(a.sup, k)).operations)).not.toMatch(/payload|hash/i);
  });
});
