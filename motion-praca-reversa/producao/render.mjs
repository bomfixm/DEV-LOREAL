// Renderizador quadro a quadro: serve a pasta producao/ localmente, abre a cena
// no Chromium (Playwright), chama definirQuadro(n) e fotografa cada quadro;
// o FFmpeg monta o MP4 (H.264, yuv420p, 30 fps) com o áudio.
// Uso (pasta motion-praca-reversa):
//   node producao/render.mjs amostra --quadros 0,60,300        (quadros soltos em PNG)
//   node producao/render.mjs amostra --video out/previa-acabamento.mp4 --audio producao/out/amostra-audio.wav
//   node producao/render.mjs filme --eventos                    (só grava out/filme-eventos.json)
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const RAIZ = resolve(import.meta.dirname);
const [cena = 'amostra', ...resto] = process.argv.slice(2);
const opcao = (nome) => {
  const i = resto.indexOf(nome);
  return i >= 0 ? resto[i + 1] : undefined;
};
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.css': 'text/css', '.svg': 'image/svg+xml' };
const servidor = createServer((req, res) => {
  const caminho = resolve(RAIZ, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''));
  if (!caminho.startsWith(RAIZ) || !existsSync(caminho) || statSync(caminho).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TIPOS[extname(caminho)] ?? 'application/octet-stream' });
  createReadStream(caminho).pipe(res);
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const porta = servidor.address().port;

const navegador = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'] });
const page = await navegador.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') erros.push(m.text());
});
await page.goto(`http://127.0.0.1:${String(porta)}/${cena}/index.html`);
await page.waitForFunction(() => window.pronto instanceof Promise);
await page.evaluate(() => window.pronto);
if (erros.length) console.error('Erros na cena:', erros);
const total = await page.evaluate(() => window.TOTAL_QUADROS);
// Eventos de som e seções da trilha (lidos pelo audio.mjs).
const marcas = await page.evaluate(() => ({ total: window.TOTAL_QUADROS, secoes: window.SECOES ?? [], eventos: window.EVENTOS ?? [] }));
mkdirSync(resolve(RAIZ, 'out'), { recursive: true });
writeFileSync(resolve(RAIZ, 'out', `${cena}-eventos.json`), JSON.stringify(marcas, null, 1));
if (resto.includes('--eventos')) {
  console.log(`Eventos: out/${cena}-eventos.json (${String(marcas.eventos.length)})`);
  await navegador.close();
  servidor.close();
  process.exit(0);
}

const quadrosSoltos = opcao('--quadros');
if (quadrosSoltos !== undefined) {
  const pasta = resolve(RAIZ, 'out', 'quadros', cena);
  mkdirSync(pasta, { recursive: true });
  for (const q of quadrosSoltos.split(',').map(Number)) {
    await page.evaluate((n) => window.definirQuadro(n), q);
    await page.screenshot({ path: join(pasta, `q${String(q).padStart(4, '0')}.png`) });
  }
  console.log(`Quadros em ${pasta}`);
} else {
  const pasta = resolve(RAIZ, 'quadros', cena);
  rmSync(pasta, { recursive: true, force: true });
  mkdirSync(pasta, { recursive: true });
  const inicio = Date.now();
  for (let q = 0; q < total; q++) {
    await page.evaluate((n) => window.definirQuadro(n), q);
    await page.screenshot({ path: join(pasta, `${String(q).padStart(5, '0')}.png`) });
    if (q % 60 === 0) console.log(`quadro ${String(q)}/${String(total)} (${((Date.now() - inicio) / 1000).toFixed(0)} s)`);
  }
  const saida = resolve(RAIZ, '..', opcao('--video') ?? `out/${cena}.mp4`);
  mkdirSync(resolve(saida, '..'), { recursive: true });
  const audio = opcao('--audio');
  const args = ['-y', '-v', 'error', '-framerate', '30', '-i', join(pasta, '%05d.png')];
  if (audio) args.push('-i', resolve(RAIZ, '..', audio));
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart');
  if (audio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push(saida);
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('FFmpeg falhou.');
  console.log(`Vídeo: ${saida} (${String(readdirSync(pasta).length)} quadros)`);
}
await navegador.close();
servidor.close();
