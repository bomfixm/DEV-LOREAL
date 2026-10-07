// PostgreSQL local de desenvolvimento, sem instalação no sistema nem Docker.
// Usa os binários oficiais empacotados em @embedded-postgres/<plataforma>
// (initdb e pg_ctl). O cluster fica em PG_DADOS (padrão .dados/postgres) e
// escuta somente em 127.0.0.1. Os binários são copiados para
// .dados/pg-bin/<versão>: o servidor em execução não prende arquivos de
// node_modules, e `npm ci`/`npm install` continuam funcionando no Windows.
//
// Uso: node scripts/banco-local.mjs iniciar | parar | status
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import pg from 'pg';

const raiz = resolve(import.meta.dirname, '..');
const arquivoEnv = resolve(raiz, '.env');
if (!existsSync(arquivoEnv)) {
  console.error('Arquivo .env não encontrado. Rode primeiro: npm run env:local');
  process.exit(1);
}
process.loadEnvFile(arquivoEnv);

const urlPrincipal = lerUrl('DATABASE_URL');
const urls = ['DATABASE_URL', 'DATABASE_URL_TESTE', 'DATABASE_URL_E2E'].map((n) => [n, process.env[n]]).filter(([, v]) => v);
const porta = urlPrincipal.port || '5432';
const usuario = decodeURIComponent(urlPrincipal.username);
const senha = decodeURIComponent(urlPrincipal.password);
const dados = resolve(raiz, process.env.PG_DADOS ?? '.dados/postgres');
const log = `${dados}.log`;

function lerUrl(nome) {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`${nome} não definido no .env.`);
    process.exit(1);
  }
  const url = new URL(valor);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    console.error(`${nome} aponta para ${url.hostname}. Este script só gerencia o banco local; use o servidor indicado diretamente.`);
    process.exit(1);
  }
  return url;
}

async function binarios() {
  const pacotes = {
    'win32-x64': '@embedded-postgres/windows-x64',
    'linux-x64': '@embedded-postgres/linux-x64',
    'linux-arm64': '@embedded-postgres/linux-arm64',
    'darwin-x64': '@embedded-postgres/darwin-x64',
    'darwin-arm64': '@embedded-postgres/darwin-arm64',
  };
  const pacote = pacotes[`${platform()}-${arch()}`];
  if (!pacote) throw new Error(`Plataforma sem binários empacotados: ${platform()}-${arch()}`);
  const modulo = await import(pacote);
  const nativo = dirname(dirname(modulo.pg_ctl));
  const { version } = JSON.parse(readFileSync(resolve(nativo, '..', 'package.json'), 'utf8'));
  const destino = resolve(raiz, '.dados', 'pg-bin', `${platform()}-${arch()}-${version}`);
  if (!existsSync(join(destino, 'bin', basename(modulo.pg_ctl)))) {
    console.log(`Copiando binários do PostgreSQL ${version} para ${destino}…`);
    cpSync(nativo, destino, { recursive: true });
  }
  return {
    initdb: join(destino, 'bin', basename(modulo.initdb)),
    pg_ctl: join(destino, 'bin', basename(modulo.pg_ctl)),
  };
}

function executar(binario, args) {
  // stdio ignorado: o servidor iniciado em segundo plano não deve herdar os
  // descritores deste processo. A saída do PostgreSQL vai para o arquivo de log.
  return spawnSync(binario, args, { stdio: 'ignore', windowsHide: true }).status;
}

function mostrarLog() {
  if (existsSync(log)) console.error(readFileSync(log, 'utf8').split('\n').slice(-25).join('\n'));
}

async function criarBancos() {
  const cliente = new pg.Client({ host: '127.0.0.1', port: Number(porta), user: usuario, password: senha, database: 'postgres' });
  await cliente.connect();
  try {
    for (const [nome, valor] of urls) {
      const banco = decodeURIComponent(new URL(valor).pathname.slice(1));
      if (!/^[a-z0-9_]+$/.test(banco)) throw new Error(`Nome de banco inválido em ${nome}: ${banco}`);
      const existe = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [banco]);
      if (existe.rowCount === 0) {
        await cliente.query(`CREATE DATABASE "${banco}" ENCODING 'UTF8'`);
        console.log(`Banco criado: ${banco}`);
      }
    }
  } finally {
    await cliente.end();
  }
}

async function iniciar() {
  const { initdb, pg_ctl } = await binarios();
  if (!existsSync(join(dados, 'PG_VERSION'))) {
    mkdirSync(dados, { recursive: true });
    const arquivoSenha = join(tmpdir(), `praca-pw-${randomBytes(6).toString('hex')}`);
    writeFileSync(arquivoSenha, senha, { mode: 0o600 });
    try {
      const status = executar(initdb, ['-D', dados, '-U', usuario, '--auth=scram-sha-256', `--pwfile=${arquivoSenha}`, '-E', 'UTF8', '--locale=C']);
      if (status !== 0) throw new Error('initdb falhou.');
    } finally {
      rmSync(arquivoSenha, { force: true });
    }
    console.log(`Cluster PostgreSQL criado em ${dados}`);
  }
  if (executar(pg_ctl, ['status', '-D', dados]) === 0) {
    console.log('PostgreSQL local já está em execução.');
  } else {
    const status = executar(pg_ctl, ['start', '-D', dados, '-l', log, '-w', '-t', '60', '-o', `-p ${porta} -c listen_addresses=127.0.0.1`]);
    if (status !== 0) {
      mostrarLog();
      throw new Error('Não foi possível iniciar o PostgreSQL local.');
    }
    console.log(`PostgreSQL local iniciado em 127.0.0.1:${porta} (log: ${log}).`);
  }
  await criarBancos();
}

async function parar() {
  const { pg_ctl } = await binarios();
  if (executar(pg_ctl, ['status', '-D', dados]) !== 0) {
    console.log('PostgreSQL local não está em execução.');
    return;
  }
  if (executar(pg_ctl, ['stop', '-D', dados, '-m', 'fast', '-w']) !== 0) throw new Error('Falha ao parar o PostgreSQL local.');
  console.log('PostgreSQL local parado.');
}

async function status() {
  const { pg_ctl } = await binarios();
  const ativo = executar(pg_ctl, ['status', '-D', dados]) === 0;
  console.log(ativo ? `PostgreSQL local em execução (127.0.0.1:${porta}).` : 'PostgreSQL local parado.');
  process.exitCode = ativo ? 0 : 3;
}

const comandos = { iniciar, parar, status };
const comando = comandos[process.argv[2] ?? ''];
if (!comando) {
  console.error('Uso: node scripts/banco-local.mjs iniciar | parar | status');
  process.exit(1);
}
await comando().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
