import { PracaSchema, type Posicao } from '@praca-reversa/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { bancoDeTeste, codigoErro, como, mutar, ID_ESCOPO_PRACA } from './apoio.js';
import { API, criarPalete, montarAmbiente, palete, type Ambiente } from './claims-apoio.js';

/**
 * "Palete livre" (ajustes de 08/10/2026), contra PostgreSQL real: a posição só
 * fica livre com desocupação confirmada — movimento/saída/retirada registrados
 * ou confirmação explícita no local —, nunca só por falta de palete
 * registrado; um palete que passe a ocupá-la limpa a marcação; área
 * desativada nunca é livre. Dados fictícios.
 */
let db: Banco;
let a: Ambiente;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  a = await montarAmbiente(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function posicoes(): Promise<Map<string, Posicao>> {
  const r = await como(a.app, a.op, { method: 'GET', url: `${API}/praca` });
  expect(r.statusCode, r.body).toBe(200);
  return new Map((PracaSchema.parse(r.json()).layout?.positions ?? []).map((p) => [p.id, p]));
}

async function livres(n: number): Promise<{ id: string; codigo: string }[]> {
  return db.$queryRaw<{ id: string; codigo: string }[]>`
    SELECT pos.id::text, pos.codigo FROM posicao pos JOIN layout l ON l.id = pos.layout_id
     WHERE pos.escopo_id = ${ID_ESCOPO_PRACA}::uuid AND l.ativo AND pos.disponivel AND NOT pos.desativada AND pos.retirada_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM palete p WHERE p.posicao_id = pos.id)
     ORDER BY pos.codigo LIMIT ${n}`;
}

describe('Palete livre (posição com desocupação confirmada)', () => {
  it('movimento registrado libera a origem; o destino ocupado não é livre; sem palete registrado não basta', async () => {
    const p = await criarPalete(a);
    const origem = p.positionId;
    if (origem === null) throw new Error('palete sem posição');
    const [destino, outra] = await livres(2);
    if (!destino || !outra) throw new Error('sem posições');
    const antes = await posicoes();
    expect(antes.get(destino.id)?.freeConfirmed).toBeNull();
    expect(antes.get(outra.id)?.freeConfirmed).toBeNull();
    const r = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/movimentos`, {
      destinationPositionId: destino.id,
      confirmedPositionCode: destino.codigo,
      expectedVersion: (await palete(a, p.id)).version,
      reason: 'Reorganização (teste)',
    });
    expect(r.statusCode, r.body).toBe(200);
    const depois = await posicoes();
    expect(depois.get(origem)?.freeConfirmed?.origin).toBe('MOVIMENTO');
    expect(depois.get(destino.id)?.freeConfirmed).toBeNull();
    expect(depois.get(outra.id)?.freeConfirmed).toBeNull();
    // Um palete cadastrado na posição livre limpa a marcação.
    const r2 = await mutar(a.app, a.op, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId: origem, notes: null, declaredItems: [] });
    expect(r2.statusCode, r2.body).toBe(201);
    expect((await posicoes()).get(origem)?.freeConfirmed).toBeNull();
  });

  it('confirmação explícita no local: exige a declaração, recusa posição ocupada ou desativada e registra auditoria', async () => {
    const [vazia] = await livres(1);
    if (!vazia) throw new Error('sem posição');
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/posicoes/${vazia.id}/livre`, {}))).toBe('REQUISICAO_INVALIDA');
    expect((await mutar(a.app, a.consulta, 'POST', `${API}/posicoes/${vazia.id}/livre`, { confirmedEmpty: true })).statusCode).toBe(403);
    const r = await mutar(a.app, a.op, 'POST', `${API}/posicoes/${vazia.id}/livre`, { confirmedEmpty: true, note: 'Conferido no turno da manhã' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<{ freeConfirmed: { origin: string } }>().freeConfirmed.origin).toBe('CONFIRMACAO');
    expect((await posicoes()).get(vazia.id)?.freeConfirmed?.origin).toBe('CONFIRMACAO');
    expect(await db.eventoAuditoria.count({ where: { acao: 'POSICAO_LIVRE_CONFIRMADA', alvoId: vazia.id } })).toBe(1);
    // Repetir não duplica o registro.
    expect((await mutar(a.app, a.op, 'POST', `${API}/posicoes/${vazia.id}/livre`, { confirmedEmpty: true })).statusCode).toBe(200);
    expect(await db.eventoAuditoria.count({ where: { acao: 'POSICAO_LIVRE_CONFIRMADA', alvoId: vazia.id } })).toBe(1);

    const p = await criarPalete(a);
    const ocupada = p.positionId ?? '';
    const r3 = await mutar(a.app, a.op, 'POST', `${API}/posicoes/${ocupada}/livre`, { confirmedEmpty: true });
    expect(r3.statusCode).toBe(409);
    expect(r3.body).toContain(p.code);
    const [desativada] = await db.$queryRaw<{ id: string }[]>`
      SELECT pos.id::text FROM posicao pos JOIN layout l ON l.id = pos.layout_id
       WHERE pos.escopo_id = ${ID_ESCOPO_PRACA}::uuid AND l.ativo AND pos.desativada LIMIT 1`;
    if (desativada) expect((await mutar(a.app, a.op, 'POST', `${API}/posicoes/${desativada.id}/livre`, { confirmedEmpty: true })).statusCode).toBe(409);
    // O banco recusa livre em posição desativada mesmo fora da API.
    if (desativada) {
      await expect(db.$executeRaw`UPDATE posicao SET livre_confirmada_em = now(), livre_origem = 'CONFIRMACAO' WHERE id = ${desativada.id}::uuid`).rejects.toThrow();
    }
  });

  it('correção de movimento não marca posição livre por suposição', async () => {
    const p = await criarPalete(a);
    const [destino] = await livres(1);
    if (!destino || p.positionId === null) throw new Error('dados');
    const mov = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/movimentos`, {
      destinationPositionId: destino.id,
      confirmedPositionCode: destino.codigo,
      expectedVersion: (await palete(a, p.id)).version,
      reason: 'Movimento lançado errado (teste)',
    });
    expect(mov.statusCode, mov.body).toBe(200);
    const evento = await db.eventoLocalizacao.findFirstOrThrow({ where: { paleteId: p.id, tipo: 'MOVIMENTO' }, select: { id: true } });
    const corr = await mutar(a.app, a.sup, 'POST', `${API}/movimentos/${evento.id}/correcao`, {
      destinationPositionId: p.positionId,
      confirmedPositionCode: (await posicoes()).get(p.positionId)?.code,
      expectedVersion: (await palete(a, p.id)).version,
      reason: 'O palete nunca saiu do lugar (teste)',
    });
    expect(corr.statusCode, corr.body).toBe(200);
    // O palete voltou à origem (não é livre) e o destino do lançamento errado não vira livre.
    const fim = await posicoes();
    expect(fim.get(p.positionId)?.freeConfirmed).toBeNull();
    expect(fim.get(destino.id)?.freeConfirmed).toBeNull();
  });
});
