// Copia os arquivos do OCR (tesseract.js e português) para public/ocr, para serem
// servidos pelo próprio aplicativo: nada é baixado de CDN e a foto não sai daqui.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '../../..');
const destino = resolve(aqui, '../public/ocr');
const modulos = resolve(raiz, 'node_modules');
mkdirSync(destino, { recursive: true });
const arquivos = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz', 'por.traineddata.gz'],
];
for (const [origem, nome] of arquivos) {
  const caminho = resolve(modulos, origem);
  if (!existsSync(caminho)) throw new Error(`OCR: arquivo não encontrado: ${origem}`);
  copyFileSync(caminho, resolve(destino, nome));
}
console.log(`OCR: ${String(arquivos.length)} arquivos em public/ocr.`);
