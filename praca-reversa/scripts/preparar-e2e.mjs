// Prepara o banco dos testes de interface (DATABASE_URL_E2E): recria o esquema,
// aplica as migrações, roda o seed de demonstração e cria um administrador com
// senha aleatória pelo mesmo comando local documentado (admin:criar).
// As credenciais geradas ficam em .dados/e2e/credenciais.json (não versionado).
// Requer `npm run build` antes (usa apps/api/dist).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const raiz = resolve(import.meta.dirname, '..');
if (existsSync(resolve(raiz, '.env'))) process.loadEnvFile(resolve(raiz, '.env'));

const url = process.env.DATABASE_URL_E2E;
if (!url) throw new Error('DATABASE_URL_E2E não definido (npm run env:local).');
const nome = decodeURIComponent(new URL(url).pathname.slice(1));
if (!nome.endsWith('_e2e')) throw new Error(`Banco de E2E precisa terminar em _e2e (recebido: ${nome}).`);

const cliente = new pg.Client({ connectionString: url });
await cliente.connect();
await cliente.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
await cliente.end();

const ambiente = { ...process.env, DATABASE_URL: url, APP_AMBIENTE: 'teste' };
function executar(rotulo, args, opcoes = {}) {
  const r = spawnSync(process.execPath, args, { cwd: raiz, env: ambiente, encoding: 'utf8', ...opcoes });
  if (r.status !== 0) throw new Error(`${rotulo} falhou:\n${r.stdout}\n${r.stderr}`);
}

executar('Migração', [resolve(raiz, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: resolve(raiz, 'apps/api') });
executar('Seed', [resolve(raiz, 'apps/api/dist/cli/semear-demo.js')]);
const admin = { login: 'admin.e2e', senha: randomBytes(18).toString('base64url') };
executar('Administrador', [resolve(raiz, 'apps/api/dist/cli/criar-admin.js'), '--login', admin.login, '--nome', 'Administrador E2E'], {
  input: `${admin.senha}\n`,
});
// Escopo próprio (não demonstrativo, dados de teste) para os cadastros de E2E:
// não altera as contagens verificadas nos escopos de demonstração.
const adminCadastro = { login: 'admin.cadastro.e2e', senha: randomBytes(18).toString('base64url') };
executar(
  'Administrador do escopo de cadastro',
  [
    resolve(raiz, 'apps/api/dist/cli/criar-admin.js'),
    '--login',
    adminCadastro.login,
    '--nome',
    'Administrador cadastro E2E',
    '--unidade',
    'E2E-UN',
    '--cliente',
    'E2E-CLI',
    '--unidade-nome',
    'Unidade de teste E2E',
    '--cliente-nome',
    'Cliente de teste E2E',
  ],
  { input: `${adminCadastro.senha}\n` },
);

// Etapa 10: escopo sem paletes (tutorial em ambiente vazio), só com o administrador.
const adminVazio = { login: 'admin.vazio.e2e', senha: randomBytes(18).toString('base64url') };
executar(
  'Administrador do escopo vazio',
  [
    resolve(raiz, 'apps/api/dist/cli/criar-admin.js'),
    '--login',
    adminVazio.login,
    '--nome',
    'Administrador escopo vazio E2E',
    '--unidade',
    'E2E-VZ',
    '--cliente',
    'E2E-VZC',
    '--unidade-nome',
    'Unidade vazia E2E',
    '--cliente-nome',
    'Cliente vazio E2E',
  ],
  { input: `${adminVazio.senha}\n` },
);

mkdirSync(resolve(raiz, '.dados/e2e'), { recursive: true });
writeFileSync(resolve(raiz, '.dados/e2e/credenciais.json'), JSON.stringify({ admin, adminCadastro, adminVazio }, null, 2), { mode: 0o600 });
console.log('Banco de E2E preparado.');
