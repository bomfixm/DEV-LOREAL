import { interpretarEtiqueta, type LeituraEtiqueta } from '@praca-reversa/contracts';
import { paraEndereco } from '../../base';

/** Lado maior da foto guardada: legível para a NF e pequena o bastante para o limite de envio. */
const LADO_MAXIMO = 2000;
const QUALIDADE = 0.85;

export class ErroFoto extends Error {}

async function abrir(arquivo: Blob): Promise<ImageBitmap> {
  try {
    // A orientação da câmera (EXIF) é aplicada aqui: a foto sai sempre em pé.
    return await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    throw new ErroFoto('Este aparelho não abriu a imagem (formato HEIC?). No iPhone, use Ajustes > Câmera > Formatos > Mais compatível, ou envie em JPEG.');
  }
}

/** Reduz a foto para envio (JPEG, orientação correta). Falha com mensagem clara, nunca em silêncio. */
export async function prepararFoto(arquivo: Blob): Promise<Blob> {
  const img = await abrir(arquivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * escala);
  canvas.height = Math.round(img.height * escala);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ErroFoto('Este navegador não conseguiu preparar a foto.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();
  const blob = await new Promise<Blob | null>((resolver) => {
    canvas.toBlob(resolver, 'image/jpeg', QUALIDADE);
  });
  if (!blob) throw new ErroFoto('Este navegador não conseguiu preparar a foto.');
  return blob;
}

interface TrabalhadorOcr {
  recognize(imagem: HTMLCanvasElement): Promise<{ data: { text: string } }>;
}
let trabalhador: Promise<TrabalhadorOcr> | null = null;

/** OCR local: os arquivos ficam no próprio aplicativo (/ocr); a foto não sai para nenhum serviço. */
function ocr(): Promise<TrabalhadorOcr> {
  trabalhador ??= import('tesseract.js').then(({ createWorker }) =>
    createWorker('por', 1, {
      workerPath: paraEndereco('/ocr/worker.min.js'),
      corePath: paraEndereco('/ocr'),
      langPath: paraEndereco('/ocr'),
      gzip: true,
      workerBlobURL: false,
    }),
  ) as Promise<TrabalhadorOcr>;
  return trabalhador;
}

function desenhar(img: ImageBitmap, rotacao: number): HTMLCanvasElement {
  const deitado = rotacao % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = deitado ? img.height : img.width;
  canvas.height = deitado ? img.width : img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new ErroFoto('Este navegador não conseguiu ler a foto.');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotacao * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return canvas;
}

/** Cinza e contraste; invertida, a faixa preta com texto branco vira texto escuro. A evidência guardada não muda. */
function preparar(canvas: HTMLCanvasElement, inverter: boolean): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  const dados = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const p = dados.data;
  for (let i = 0; i < p.length; i += 4) {
    const cinza = 0.299 * (p[i] ?? 0) + 0.587 * (p[i + 1] ?? 0) + 0.114 * (p[i + 2] ?? 0);
    const forte = Math.max(0, Math.min(255, (cinza - 128) * 1.4 + 128));
    const v = inverter ? 255 - forte : forte;
    p[i] = v;
    p[i + 1] = v;
    p[i + 2] = v;
  }
  ctx.putImageData(dados, 0, 0);
  return canvas;
}

export interface ResultadoOcr extends LeituraEtiqueta {
  rawText: string;
}

/** Lê a foto salva. A segunda passada (invertida) só roda se a primeira não achou o número. */
export async function lerFoto(fotoId: string, apiPrefixo: string, rotacao = 0): Promise<ResultadoOcr> {
  const resposta = await fetch(paraEndereco(`${apiPrefixo}/notas-foto/fotos/${fotoId}`), { credentials: 'same-origin' });
  if (!resposta.ok) throw new ErroFoto('Não foi possível abrir a foto salva.');
  const img = await createImageBitmap(await resposta.blob());
  try {
    const leitor = await ocr();
    const primeira = (await leitor.recognize(preparar(desenhar(img, rotacao), false))).data.text;
    let texto = primeira;
    if (interpretarEtiqueta(primeira).number === null) {
      const segunda = (await leitor.recognize(preparar(desenhar(img, rotacao), true))).data.text;
      texto = `${segunda}\n${primeira}`;
    }
    return { ...interpretarEtiqueta(texto), rawText: texto.slice(0, 8_000) };
  } finally {
    img.close();
  }
}
