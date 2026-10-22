// Mantém a versão de teste no ar sem depender do app do Claude nem de um
// terminal aberto: sobe o PostgreSQL local quando está parado (por exemplo,
// depois de o computador dormir), inicia `apps/api/dist/server.js
// --porta=3000`, reinicia o servidor se ele cair e depois de um build novo
// (dist alterado e estável). Uma instância só (trava em .dados/servidor).
// Registro em .dados/servidor/servidor.log (fora do versionamento).
//
// Iniciado pela tarefa do Windows criada por scripts/instalar-tarefa-servidor.ps1.
// Uso manual: node scripts/manter-servidor.mjs [--porta=3000]
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');
const porta = process.argv.find((a) => a.startsWith('--porta='))?.slice('--porta='.length) ?? '3000';
const pasta = resolve(raiz, '.dados', 'servidor');
const arquivoLog = resolve(pasta, 'servidor.log');
const trava = resolve(pasta, `manter-${porta}.pid`);
const servidor = resolve(raiz, 'apps', 'api', 'dist', 'server.js');
const builds = [servidor, resolve(raiz, 'apps', 'web', 'dist', 'index.html')];
const LIMITE_LOG = 5 * 1_048_576;

mkdirSync(pasta, { recursive: true });

function registrar(texto) {
  try {
    if (existsSync(arquivoLog) && statSync(arquivoLog).size > LIMITE_LOG) renameSync(arquivoLog, `${arquivoLog}.1`);
    appendFileSync(arquivoLog, `${new Date().toISOString()} ${texto.endsWith('\n') ? texto : `${texto}\n`}`);
  } catch {
    // Registro é auxiliar: nunca derruba o servidor.
  }
}

// Uma instância por porta: a tarefa pode disparar de novo (logon, repetição) sem duplicar.
function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
if (existsSync(trava)) {
  const pid = Number(readFileSync(trava, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && vivo(pid)) process.exit(0);
}
writeFileSync(trava, String(process.pid));

function banco(acao) {
  return spawnSync(process.execPath, [resolve(raiz, 'scripts', 'banco-local.mjs'), acao], { cwd: raiz, encoding: 'utf8', windowsHide: true });
}

function garantirBanco() {
  if (banco('status').status === 0) return true;
  registrar('PostgreSQL local parado: iniciando.');
  const r = banco('iniciar');
  registrar(`${(r.stdout ?? '').trim()} ${(r.stderr ?? '').trim()}`.trim() || `banco-local iniciar: código ${String(r.status)}`);
  return r.status === 0;
}

const assinaturaBuild = () => builds.map((f) => (existsSync(f) ? statSync(f).mtimeMs : 0)).join('|');

let filho = null;
let encerrando = false;
let falhasSeguidas = 0;
let buildEmUso = '';
let buildVisto = '';
let reiniciarPorBuild = false;

function iniciarServidor() {
  if (encerrando || filho !== null) return;
  if (!existsSync(servidor)) {
    registrar(`Build ausente (${servidor}): rode npm run build. Nova tentativa em 30 s.`);
    setTimeout(iniciarServidor, 30_000);
    return;
  }
  garantirBanco();
  buildEmUso = assinaturaBuild();
  buildVisto = buildEmUso;
  const inicio = Date.now();
  registrar(`Iniciando o servidor na porta ${porta}.`);
  filho = spawn(process.execPath, [servidor, `--porta=${porta}`], { cwd: raiz, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  filho.stdout.on('data', (b) => registrar(String(b)));
  filho.stderr.on('data', (b) => registrar(String(b)));
  filho.on('exit', (codigo, sinal) => {
    filho = null;
    if (encerrando) return;
    const rapido = Date.now() - inicio < 30_000;
    falhasSeguidas = reiniciarPorBuild ? 0 : rapido ? falhasSeguidas + 1 : 0;
    const espera = reiniciarPorBuild ? 1_000 : Math.min(60_000, 5_000 * 2 ** Math.min(falhasSeguidas, 4));
    registrar(`Servidor encerrado (código ${String(codigo)}${sinal ? `, sinal ${sinal}` : ''})${reiniciarPorBuild ? ' para usar o build novo' : ''}. Reinicia em ${String(espera / 1000)} s.`);
    reiniciarPorBuild = false;
    setTimeout(iniciarServidor, espera);
  });
}

// Banco: confere a cada 30 s (o PostgreSQL local para quando o computador dorme).
setInterval(() => {
  if (!encerrando) garantirBanco();
}, 30_000);

// Build novo: reinicia quando o dist mudou e ficou estável por uma rodada (15 s).
setInterval(() => {
  if (encerrando || filho === null) return;
  const atual = assinaturaBuild();
  if (atual !== buildEmUso && atual === buildVisto) {
    registrar('Build novo detectado: reiniciando o servidor.');
    reiniciarPorBuild = true;
    filho.kill();
  }
  buildVisto = atual;
}, 15_000);

function encerrar() {
  encerrando = true;
  registrar('Encerrando (pedido de parada).');
  if (filho !== null) filho.kill();
  rmSync(trava, { force: true });
  setTimeout(() => process.exit(0), 2_000);
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

registrar(`Manter servidor: iniciado (pid ${String(process.pid)}, porta ${porta}).`);
iniciarServidor();
