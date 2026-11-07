import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, codigoErro, criarUsuario, prepararDados, type UsuarioTeste } from './apoio.js';

let db: Banco;
let maria: UsuarioTeste;
let ana: UsuarioTeste;

beforeAll(async () => {
  db = bancoDeTeste();
  await prepararDados(db);
  maria = await criarUsuario(db, 'maria.bloqueio', [[ID_ESCOPO_PRACA, 'OPERADOR']]);
  ana = await criarUsuario(db, 'ana.bloqueio', [[ID_ESCOPO_PRACA, 'OPERADOR']]);
});

afterAll(async () => {
  await db.$disconnect();
});

const LIMITES = { porConta: { maximo: 3, janelaMs: 15 * 60_000 }, porIp: { maximo: 50, janelaMs: 15 * 60_000 } };

async function tentar(app: Awaited<ReturnType<typeof appDeTeste>>, login: string, senha: string, ip = '10.0.0.1') {
  return app.inject({ method: 'POST', url: '/api/v1/sessao', remoteAddress: ip, payload: { login, senha } });
}

describe('bloqueio de login guardado no banco', () => {
  it('continua bloqueado depois de reiniciar o servidor (nova instância do app)', async () => {
    const antes = await appDeTeste(db, { limitesLogin: LIMITES });
    for (let i = 0; i < 3; i++) expect((await tentar(antes, maria.login, 'senha-errada')).statusCode).toBe(401);
    expect(codigoErro(await tentar(antes, maria.login, maria.senha))).toBe('MUITAS_TENTATIVAS');
    await antes.close();

    // "Reinício": outro app, sem nada em memória.
    const depois = await appDeTeste(db, { limitesLogin: LIMITES });
    const resposta = await tentar(depois, maria.login, maria.senha);
    expect(resposta.statusCode).toBe(429);
    expect(Number(resposta.headers['retry-after'])).toBeGreaterThan(0);
    // Outra conta, no mesmo servidor, não é afetada.
    expect((await tentar(depois, ana.login, ana.senha, '10.0.0.2')).statusCode).toBe(200);
    await depois.close();
  });

  it('libera quando as falhas saem da janela e o login certo zera a contagem da conta', async () => {
    await db.tentativaLogin.deleteMany({});
    let agora = new Date('2026-11-07T12:00:00Z');
    const app = await appDeTeste(db, { limitesLogin: LIMITES, agora: () => agora });
    for (let i = 0; i < 3; i++) await tentar(app, ana.login, 'errada', '10.0.0.3');
    expect((await tentar(app, ana.login, ana.senha, '10.0.0.3')).statusCode).toBe(429);

    agora = new Date(agora.getTime() + 15 * 60_000 + 1_000);
    expect((await tentar(app, ana.login, ana.senha, '10.0.0.3')).statusCode).toBe(200);
    expect(await db.tentativaLogin.count({ where: { tipo: 'CONTA' } })).toBe(0);
    await app.close();
  });

  it('não guarda o login digitado nem o IP em texto', async () => {
    await db.tentativaLogin.deleteMany({});
    const app = await appDeTeste(db, { limitesLogin: LIMITES });
    await tentar(app, 'alguem.inexistente', 'x', '203.0.113.77');
    await app.close();
    const linhas = await db.tentativaLogin.findMany();
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.tipo).sort()).toEqual(['CONTA', 'IP']);
    for (const l of linhas) {
      expect(l.chave).toMatch(/^[0-9a-f]{64}$/);
      expect(l.chave).not.toContain('203.0.113.77');
      expect(l.chave).not.toContain('inexistente');
    }
  });

  it('apaga falhas com mais de um dia na próxima falha registrada', async () => {
    await db.tentativaLogin.deleteMany({});
    await db.tentativaLogin.create({ data: { tipo: 'CONTA', chave: 'a'.repeat(64), ocorridoEm: new Date(Date.now() - 2 * 24 * 3_600_000) } });
    const app = await appDeTeste(db, { limitesLogin: LIMITES });
    await tentar(app, 'qualquer', 'x', '10.0.0.9');
    await app.close();
    expect(await db.tentativaLogin.count({ where: { chave: 'a'.repeat(64) } })).toBe(0);
  });
});
