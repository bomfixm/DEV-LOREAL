import { LoteEspelhosSchema, OpcoesEspelhosSchema } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, como, criarUsuario, entrar, mutar, prepararDados } from './apoio.js';
const db = bancoDeTeste();
beforeAll(async () => { await prepararDados(db); });
afterAll(async () => { await db.$disconnect(); });
it('gera espelho com conteúdo atual, sem presumir contagem; protege acesso, escopo e filtros', async () => {
  const app = await appDeTeste(db);
  try {
    const sup = await entrar(app, await criarUsuario(db, 'espelho.supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]));
    const consulta = await entrar(app, await criarUsuario(db, 'espelho.consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]));
    const get = (url: string) => como(app, sup, { method: 'GET', url });
    expect((await como(app, consulta, { method: 'GET', url: '/api/v1/espelhos/opcoes' })).statusCode).toBe(403);
    const opcoes = OpcoesEspelhosSchema.parse((await get('/api/v1/espelhos/opcoes')).json());
    const p = opcoes.items[0]; expect(p).toBeDefined(); if (!p) return;
    const criacao = await mutar(app, sup, 'POST', `/api/v1/paletes/${p.id}/conteudos`, { sender: 'REMETENTE ESPELHO', documentType: 'NFD', documentNumber: '0000123', delivery: '0000456' });
    expect(criacao.statusCode).toBe(201);
    const r = await get(`/api/v1/espelhos?ids=${p.id},${p.id}`); expect(r.statusCode).toBe(200);
    const lote = LoteEspelhosSchema.parse(r.json()); expect(lote.items).toHaveLength(1);
    const linha = lote.items[0]?.contents.items.find((c) => c.documentNumber === '0000123');
    expect(linha?.delivery).toBe('0000456'); expect(linha?.count.counted).toBeNull(); expect(linha?.count.expected).toBeNull();
    expect((await get(`/api/v1/espelhos?ids=${p.id},${randomUUID()}`)).statusCode).toBe(404);
    expect((await get('/api/v1/espelhos')).statusCode).toBe(400);
    const vazia = await get('/api/v1/espelhos?rows=inexistente'); expect(vazia.statusCode).toBe(200); expect(LoteEspelhosSchema.parse(vazia.json()).items).toEqual([]);
  } finally { await app.close(); }
});
