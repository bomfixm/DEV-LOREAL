import { ProntidaoSchema, SaudeSchema } from '@praca-reversa/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBanco, type Banco } from '../../src/db/cliente.js';
import { CONFIG_TESTE, appDeTeste, bancoDeTeste, prepararDados } from './apoio.js';
import { criarApp } from '../../src/app.js';

let db: Banco;

beforeAll(async () => {
  db = bancoDeTeste();
  await prepararDados(db, false);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('saúde e prontidão', () => {
  it('/health é mínimo e não expõe configuração', async () => {
    const app = await appDeTeste(db);
    const resposta = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(resposta.statusCode).toBe(200);
    expect(SaudeSchema.parse(resposta.json())).toEqual({ status: 'ok' });
    expect(resposta.body).not.toMatch(/postgres|5433|versao|version|DATABASE/i);
    expect(resposta.headers['cache-control']).toBe('no-store');
  });

  it('/health/ready confirma o banco disponível', async () => {
    const app = await appDeTeste(db);
    const resposta = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(resposta.statusCode).toBe(200);
    expect(ProntidaoSchema.parse(resposta.json())).toEqual({ status: 'pronto', database: 'disponivel' });
  });

  it('com o banco fora do ar: API responde, prontidão 503 e rotas de dados 503 sem detalhes internos', async () => {
    const semBanco = criarBanco('postgresql://ninguem:x@127.0.0.1:1/inexistente', () => undefined);
    const app = await criarApp({ db: semBanco, config: CONFIG_TESTE, interfaceDir: null });
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    const pronto = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(pronto.statusCode).toBe(503);
    expect(ProntidaoSchema.parse(pronto.json())).toEqual({ status: 'indisponivel', database: 'indisponivel' });
    const praca = await app.inject({ method: 'GET', url: '/api/v1/praca', headers: { cookie: 'pr_sessao=qualquer' } });
    expect(praca.statusCode).toBe(503);
    expect(praca.json()).toMatchObject({ error: { code: 'BANCO_INDISPONIVEL' } });
    expect(praca.body).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|stack/i);
    await semBanco.$disconnect();
  });
});
