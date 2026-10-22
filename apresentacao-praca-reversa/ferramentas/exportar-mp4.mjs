// MP4 complementar (para compartilhar), feito quadro a quadro a partir da própria apresentação:
// relógio da página controlado pelo Playwright e animações posicionadas por tempo — sem gravação de tela.
// Não substitui a apresentação navegável. Uso: node ferramentas/exportar-mp4.mjs [segundos por cena]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(raiz, '..', 'motion-praca-reversa', 'package.json'));
const { chromium } = require('playwright');
const porCena = Number(process.argv[2] || 6.5);
const FPS = 30;
const saida = join(raiz, 'entrega', 'Praca-Reversa-Apresentacao-complemento.mp4');

const navegador = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const contexto = await navegador.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await contexto.setOffline(true);
const pg = await contexto.newPage();
await pg.clock.install();
await pg.goto(pathToFileURL(join(raiz, 'entrega', 'Praca-Reversa-Apresentacao.html')).href);
await pg.waitForSelector('body[data-pronto="1"]');
await pg.addStyleTag({ content: '#controles,#progresso,#aviso{display:none!important} body{cursor:none}' });
await pg.evaluate(() => {
  window.__mp4 = {
    base: [],
    ir(n, modo) {
      window.PR_APRESENTACAO.ir(n, modo);
      this.base = document.getAnimations().map((a) => { a.pause(); return [a, a.currentTime || 0]; });
    },
    em(ms) { for (const [a, b] of this.base) if (a.playState !== 'idle') a.currentTime = b + ms; },
  };
});

const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', saida], { stdio: ['pipe', 'inherit', 'inherit'] });
const quadros = Math.round(porCena * FPS);
const passo = 1000 / FPS;
const total = await pg.evaluate(() => window.PR_APRESENTACAO.total);
for (let c = 0; c < total; c++) {
  await pg.evaluate(([n, modo]) => window.__mp4.ir(n, modo), [c, c === 0 ? 'salto' : 'passo']);
  for (let q = 0; q < quadros; q++) {
    await pg.evaluate((ms) => window.__mp4.em(ms), q * passo);
    const img = await pg.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r));
    await pg.clock.runFor(passo);
  }
  console.log(`cena ${c + 1}/${total}`);
}
ff.stdin.end();
await new Promise((r, j) => ff.on('close', (cod) => (cod === 0 ? r() : j(new Error(`ffmpeg ${cod}`)))));
await contexto.close();
await navegador.close();
console.log(`MP4: ${saida} (${total} cenas × ${porCena} s, ${FPS} fps, sem áudio)`);
