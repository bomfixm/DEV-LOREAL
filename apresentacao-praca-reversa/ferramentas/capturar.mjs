// Captura o estado de leitura de cada cena do HTML entregue (aberto por file://, como na sala).
// Uso: node ferramentas/capturar.mjs <pasta de saída> [largura] [altura] [cenas, ex.: 1,5,6]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(raiz, '..', 'motion-praca-reversa', 'package.json'));
const { chromium } = require('playwright');

const [saida, largura = '1920', altura = '1080', lista] = process.argv.slice(2);
mkdirSync(saida, { recursive: true });
const url = pathToFileURL(join(raiz, 'entrega', 'Praca-Reversa-Apresentacao.html')).href;

const navegador = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const contexto = await navegador.newContext({ viewport: { width: +largura, height: +altura }, deviceScaleFactor: 1 });
const pagina = await contexto.newPage();
const erros = [];
pagina.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') erros.push(`${m.type()}: ${m.text()}`); });
pagina.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
pagina.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) erros.push(`requisição externa: ${r.url()}`); });
await pagina.goto(url);
await pagina.waitForSelector('body[data-pronto="1"]');
const total = await pagina.evaluate(() => window.PR_APRESENTACAO.total);
const cenas = lista ? lista.split(',').map(Number) : Array.from({ length: total }, (_, i) => i + 1);
for (const n of cenas) {
  await pagina.evaluate((i) => window.PR_APRESENTACAO.ir(i, 'salto'), n - 1);
  await pagina.mouse.move(5, 5);
  await pagina.waitForTimeout(2600);
  await pagina.evaluate(() => document.body.classList.add('controles-ocultos'));
  await pagina.waitForTimeout(450);
  await pagina.screenshot({ path: join(saida, `cena-${String(n).padStart(2, '0')}-${largura}x${altura}.png`) });
}
console.log(erros.length ? erros.join('\n') : 'Sem erros no console nem requisições externas.');
await contexto.close();
await navegador.close();
