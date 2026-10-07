import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = fileURLToPath(new URL('../../../../', import.meta.url));
const API = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Recria o esquema do banco de testes e aplica as migrações versionadas com
 * `prisma migrate deploy` — o mesmo caminho usado em ambientes reais.
 * Por segurança, só atua em bancos cujo nome termina em `_teste`.
 */
export default async function prepararBanco(): Promise<void> {
  if (existsSync(`${RAIZ}.env`)) process.loadEnvFile(`${RAIZ}.env`);
  const url = process.env.DATABASE_URL_TESTE;
  if (!url) throw new Error('Defina DATABASE_URL_TESTE (npm run env:local) e inicie o banco (npm run db:iniciar).');
  const nome = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!nome.endsWith('_teste')) throw new Error(`Banco de testes precisa terminar em _teste (recebido: ${nome}).`);

  const cliente = new pg.Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    throw new Error(`PostgreSQL de testes indisponível. Rode npm run db:iniciar. (${erro instanceof Error ? erro.message : String(erro)})`, {
      cause: erro,
    });
  }
  try {
    await cliente.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  } finally {
    await cliente.end();
  }

  const migracao = spawnSync(process.execPath, [`${RAIZ}node_modules/prisma/build/index.js`, 'migrate', 'deploy'], {
    cwd: API,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (migracao.status !== 0) throw new Error(`Falha ao migrar o banco de testes:\n${migracao.stdout}\n${migracao.stderr}`);
}
