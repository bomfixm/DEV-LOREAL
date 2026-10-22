// Exporta os PDFs de apoio: backup estático das 12 cenas (sem animação), roteiro e guia.
// Uso: node ferramentas/exportar-pdf.mjs
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(raiz, '..', 'motion-praca-reversa', 'package.json'));
const { chromium } = require('playwright');
const entrega = join(raiz, 'entrega');
const navegador = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const contexto = await navegador.newContext({ viewport: { width: 1920, height: 1080 } });
await contexto.setOffline(true);
const pg = await contexto.newPage();

await pg.goto(`${pathToFileURL(join(entrega, 'Praca-Reversa-Apresentacao.html')).href}?estatico`);
await pg.waitForSelector('body[data-pronto="1"]');
await pg.pdf({ path: join(entrega, 'Praca-Reversa-Apresentacao-estatica.pdf'), width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });

for (const [html, pdf] of [['Roteiro-do-apresentador.html', 'Roteiro-do-apresentador.pdf'], ['Guia-rapido.html', 'Guia-rapido.pdf']]) {
  await pg.goto(pathToFileURL(join(entrega, html)).href);
  await pg.evaluate(() => document.fonts.ready);
  await pg.pdf({ path: join(entrega, pdf), format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
}
await contexto.close();
await navegador.close();
console.log('PDFs gerados em entrega/.');
