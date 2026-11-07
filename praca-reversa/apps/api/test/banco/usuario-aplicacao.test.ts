import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepararUsuarioAplicacao, urlDoUsuario } from '../../../../scripts/seguranca/usuario-aplicacao.mjs';
import { criarBanco, type Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, como, criarUsuario, entrar, prepararDados } from './apoio.js';

const PAPEL = 'praca_app_teste';
const SENHA = 'senha-de-teste-bem-longa-0123456789';
const URL_DONO = process.env.DATABASE_URL_TESTE ?? '';

let dono: Banco;
let limitado: Banco;
let adminPg: pg.Client;
let appPg: pg.Client;

beforeAll(async () => {
  dono = bancoDeTeste();
  await prepararDados(dono);
  adminPg = new pg.Client({ connectionString: URL_DONO });
  await adminPg.connect();
  await prepararUsuarioAplicacao(adminPg, { papel: PAPEL, senha: SENHA });
  const urlLimitada = urlDoUsuario(URL_DONO, PAPEL, SENHA);
  limitado = criarBanco(urlLimitada, () => undefined);
  appPg = new pg.Client({ connectionString: urlLimitada });
  await appPg.connect();
});

afterAll(async () => {
  await appPg.end();
  await limitado.$disconnect();
  await adminPg.query(`DROP OWNED BY "${PAPEL}"`);
  await adminPg.query(`DROP ROLE IF EXISTS "${PAPEL}"`);
  await adminPg.end();
  await dono.$disconnect();
});

const negado = async (sql: string) => {
  await expect(appPg.query(sql)).rejects.toMatchObject({ code: '42501' });
};

describe('usuário do banco da aplicação', () => {
  it('não tem poderes de administração', async () => {
    const r = await adminPg.query('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1', [PAPEL]);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
  });

  it('não apaga nem altera a estrutura, não esvazia tabelas e não cria bancos', async () => {
    await negado('DROP TABLE usuario');
    await negado('TRUNCATE usuario CASCADE');
    await negado('ALTER TABLE usuario ADD COLUMN x int');
    await negado('CREATE TABLE intrusa (id int)');
    await negado('CREATE DATABASE intrusao');
    await negado('DROP TABLE _prisma_migrations');
  });

  it('não altera nem apaga a auditoria, mas acrescenta e lê', async () => {
    await appPg.query("INSERT INTO evento_auditoria (id, acao, resultado) VALUES (gen_random_uuid(), 'TESTE_PAPEL', 'SUCESSO')");
    expect((await appPg.query("SELECT 1 FROM evento_auditoria WHERE acao = 'TESTE_PAPEL'")).rowCount).toBe(1);
    await negado("UPDATE evento_auditoria SET acao = 'X'");
    await negado('DELETE FROM evento_auditoria');
    await negado("INSERT INTO _prisma_migrations (id, checksum, migration_name) VALUES ('x', 'x', 'x')");
  });

  it('o sistema funciona normalmente com ele (entrar, gravar, ler, sair de tudo)', async () => {
    const app = await appDeTeste(limitado);
    const maria = await criarUsuario(dono, 'maria.papel', [[ID_ESCOPO_PRACA, 'OPERADOR']]);
    const sessao = await entrar(app, maria);
    expect((await como(app, sessao, { method: 'GET', url: '/api/v1/praca' })).statusCode).toBe(200);
    expect((await como(app, sessao, { method: 'DELETE', url: '/api/v1/sessao/todas' })).statusCode).toBe(204);
    expect((await como(app, sessao, { method: 'GET', url: '/api/v1/praca' })).statusCode).toBe(401);
    await app.close();
  });
});
