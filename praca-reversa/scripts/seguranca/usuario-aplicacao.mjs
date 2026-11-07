// Usuário do banco com poucos poderes para a aplicação (passo 6 da segurança).
//
// O dono do banco (DATABASE_URL) continua existindo para migrações, backup,
// restauração e comandos de manutenção. O servidor passa a usar um usuário que
// só LÊ e GRAVA linhas: não cria, altera nem apaga tabelas, não esvazia tabelas
// (TRUNCATE), não cria bancos e não apaga nem altera a auditoria.
//
// Uso: node scripts/seguranca/usuario-aplicacao.mjs [--origem=DATABASE_URL] [--papel=praca_app]
// Pode ser repetido: reaplica as permissões e troca a senha. A senha é gerada
// aqui, gravada só no .env (DATABASE_URL_APLICACAO) e nunca é exibida.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const RAIZ = resolve(import.meta.dirname, '..', '..');
const NOME_PAPEL = /^[a-z][a-z0-9_]{2,40}$/;

const aspas = (identificador) => `"${identificador.replaceAll('"', '""')}"`;

/**
 * Cria (ou atualiza) o papel e aplica as permissões no banco da conexão `admin`.
 * `admin` é um pg.Client conectado como dono do banco.
 */
export async function prepararUsuarioAplicacao(admin, { papel, senha }) {
  if (!NOME_PAPEL.test(papel)) throw new Error('Nome de usuário inválido (use letras minúsculas, números e _).');
  if (typeof senha !== 'string' || senha.length < 24) throw new Error('Senha curta demais.');
  const p = aspas(papel);
  const literalSenha = admin.escapeLiteral(senha);
  const opcoes = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT';

  const existe = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [papel]);
  await admin.query(`${existe.rowCount ? 'ALTER' : 'CREATE'} ROLE ${p} WITH ${opcoes} PASSWORD ${literalSenha}`);

  const banco = (await admin.query('SELECT current_database() AS nome')).rows[0].nome;
  await admin.query(`GRANT CONNECT ON DATABASE ${aspas(banco)} TO ${p}`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${p}`);
  await admin.query(`REVOKE CREATE ON SCHEMA public FROM ${p}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${p}`);
  await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${p}`);
  // Tabelas e sequências criadas por migrações futuras (pelo dono) já nascem com esses direitos.
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${p}`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${p}`);

  // Auditoria só cresce: a aplicação lê e acrescenta, nunca altera nem apaga.
  const somenteAcrescentar = ['evento_auditoria', '_prisma_migrations'];
  for (const tabela of somenteAcrescentar) {
    const achou = await admin.query("SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1", [tabela]);
    if (!achou.rowCount) continue;
    await admin.query(
      tabela === '_prisma_migrations'
        ? `REVOKE INSERT, UPDATE, DELETE ON ${aspas(tabela)} FROM ${p}`
        : `REVOKE UPDATE, DELETE ON ${aspas(tabela)} FROM ${p}`,
    );
  }
}

/** Troca usuário e senha na URL de conexão do dono. */
export function urlDoUsuario(urlDono, papel, senha) {
  const url = new URL(urlDono);
  url.username = papel;
  url.password = senha;
  return url.href;
}

function gravarNoEnv(arquivo, chave, valor) {
  const atual = existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : '';
  const eol = atual.includes('\r\n') ? '\r\n' : '\n';
  const linha = `${chave}=${valor}`;
  const padrao = new RegExp(`^${chave}=.*$`, 'm');
  const novo = padrao.test(atual) ? atual.replace(padrao, () => linha) : `${atual}${atual && !atual.endsWith('\n') ? eol : ''}${linha}${eol}`;
  writeFileSync(arquivo, novo);
}

async function principal() {
  const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const arquivoEnv = resolve(RAIZ, '.env');
  if (existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);
  const variavel = typeof args.origem === 'string' ? args.origem : 'DATABASE_URL';
  const papel = typeof args.papel === 'string' ? args.papel : 'praca_app';
  const urlDono = process.env[variavel];
  if (!urlDono) throw new Error(`${variavel} não definido no .env.`);

  const senha = randomBytes(32).toString('base64url');
  const admin = new pg.Client({ connectionString: urlDono });
  await admin.connect();
  try {
    await admin.query('BEGIN');
    await prepararUsuarioAplicacao(admin, { papel, senha });
    await admin.query('COMMIT');
  } catch (erro) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    await admin.end();
  }
  gravarNoEnv(arquivoEnv, 'DATABASE_URL_APLICACAO', urlDoUsuario(urlDono, papel, senha));
  console.log(`Usuário "${papel}" pronto. DATABASE_URL_APLICACAO gravada no .env (a senha não é exibida).`);
  console.log('Reinicie o servidor para ele passar a usar esse usuário.');
}

if (import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  principal().catch((erro) => {
    console.error(`Falhou: ${erro.message}`);
    process.exit(1);
  });
}
