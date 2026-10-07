// Gera os ícones da PWA a partir de um desenho próprio (palete + seta de retorno).
// Uso: npm run icones. Requer o Chromium do Playwright (npx playwright install chromium)
// ou um navegador instalado indicado em PLAYWRIGHT_CANAL (por exemplo, chrome ou msedge).
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const AMARELO = '#FFCC00';
const VERMELHO = '#D40511';
const PUBLICO = new URL('../apps/web/public/', import.meta.url);

/** Desenho em 512×512. `escala` reduz o conteúdo para a área segura dos ícones mascaráveis. */
function svg({ cantos, escala }) {
  const fundo = cantos
    ? `<rect width="512" height="512" rx="104" fill="${AMARELO}"/>`
    : `<rect width="512" height="512" fill="${AMARELO}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${fundo}
  <g transform="translate(256 256) scale(${escala}) translate(-256 -256)" fill="${VERMELHO}">
    <path d="M352 232V184Q352 136 304 136H190" fill="none" stroke="${VERMELHO}" stroke-width="40" stroke-linecap="round"/>
    <path d="M226 92L178 136L226 180" fill="none" stroke="${VERMELHO}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="104" y="282" width="304" height="36" rx="6"/>
    <rect x="120" y="318" width="56" height="50"/>
    <rect x="228" y="318" width="56" height="50"/>
    <rect x="336" y="318" width="56" height="50"/>
    <rect x="104" y="368" width="304" height="30" rx="6"/>
  </g>
</svg>
`;
}

const variantes = [
  { arquivo: 'icons/icon-192.png', tamanho: 192, cantos: true, escala: 1 },
  { arquivo: 'icons/icon-512.png', tamanho: 512, cantos: true, escala: 1 },
  { arquivo: 'icons/icon-maskable-512.png', tamanho: 512, cantos: false, escala: 0.74 },
  { arquivo: 'icons/apple-touch-icon-180.png', tamanho: 180, cantos: false, escala: 0.82 },
];

await mkdir(new URL('icons/', PUBLICO), { recursive: true });
await writeFile(new URL('favicon.svg', PUBLICO), svg({ cantos: true, escala: 1 }));

const canal = process.env.PLAYWRIGHT_CANAL;
const navegador = await chromium.launch(canal ? { channel: canal } : {});
try {
  for (const v of variantes) {
    const pagina = await navegador.newPage({ viewport: { width: v.tamanho, height: v.tamanho }, deviceScaleFactor: 1 });
    const desenho = svg(v).replace('width="512" height="512"', `width="${v.tamanho}" height="${v.tamanho}"`);
    await pagina.setContent(`<html><body style="margin:0;background:transparent">${desenho}</body></html>`);
    const png = await pagina.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: v.tamanho, height: v.tamanho } });
    await writeFile(new URL(v.arquivo, PUBLICO), png);
    await pagina.close();
    console.log(`Gerado ${v.arquivo} (${v.tamanho}×${v.tamanho})`);
  }
} finally {
  await navegador.close();
}
