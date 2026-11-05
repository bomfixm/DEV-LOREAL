// Build da Vercel (Build Output API). Etapas:
//  1. contratos + cliente Prisma + interface (apps/web/dist);
//  2. migrações pendentes (prisma migrate deploy) SÓ em produção — apenas
//     acrescenta, nunca apaga nem recria o banco; preview não toca o banco;
//  3. empacota a função da API e monta .vercel/output.
// Sem credenciais aqui: DIRECT_URL e DATABASE_URL vêm das variáveis do projeto.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const executar = (cmd, args, extra = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...extra });
  if (r.status !== 0) {
    console.error(`Falhou: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
};

executar(npm, ['run', 'build:netlify']);

const ambiente = process.env.VERCEL_ENV ?? 'local';
if (ambiente === 'production') {
  if (!process.env.DIRECT_URL) {
    console.error('DIRECT_URL ausente no ambiente de produção: as migrações não podem ser aplicadas.');
    process.exit(1);
  }
  console.log('Produção: aplicando migrações pendentes (prisma migrate deploy).');
  executar(npm, ['run', 'db:migrar']);
} else {
  console.log(`Ambiente "${ambiente}": migrações NÃO aplicadas (só a produção altera o banco).`);
}

const saida = '.vercel/output';
rmSync(saida, { recursive: true, force: true });
mkdirSync(`${saida}/functions/api.func`, { recursive: true });
cpSync('apps/web/dist', `${saida}/static`, { recursive: true });

const { build } = await import('esbuild');
await build({
  entryPoints: ['vercel/entrada.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24',
  outfile: `${saida}/functions/api.func/index.mjs`,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  loader: { '.pem': 'text' },
  logLevel: 'warning',
});

writeFileSync(`${saida}/functions/api.func/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs24.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  maxDuration: 60,
  regions: ['gru1'],
}, null, 2));

const cabecalhosPwa = (src) => ({ src, headers: { 'cache-control': 'no-cache' }, continue: true });
writeFileSync(`${saida}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '/(.*)', headers: { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY' }, continue: true },
    cabecalhosPwa('/index\\.html'),
    cabecalhosPwa('/sw\\.js'),
    { src: '/manifest\\.webmanifest', headers: { 'cache-control': 'no-cache', 'content-type': 'application/manifest+json' }, continue: true },
    { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '/api(?:/.*)?', dest: '/api' },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' },
  ],
}, null, 2));
console.log('Saída da Vercel montada em .vercel/output');
