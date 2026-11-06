import { interpretarCodigos, interpretarEtiqueta, type LeituraEtiqueta } from '@praca-reversa/contracts';
import { paraEndereco } from '../../base';
import { criarDecodificador } from '../camera/deteccao';

/** Lado maior da foto usada na leitura (fica só na memória do aparelho; nunca é enviada). */
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

/** Reduz a foto para a leitura (orientação correta). Falha com mensagem clara, nunca em silêncio. */
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

interface LinhaOcr {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[];
}
interface TrabalhadorOcr {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(imagem: HTMLCanvasElement, opcoes?: object, saida?: object): Promise<{ data: { text: string; blocks: { paragraphs: { lines: LinhaOcr[] }[] }[] | null } }>;
}
let trabalhador: Promise<TrabalhadorOcr> | null = null;

/** OCR local: os arquivos ficam no próprio aplicativo (/ocr); a foto não sai do aparelho. */
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

/** Foto na orientação pedida (a evidência original não existe fora daqui). */
function desenhar(img: ImageBitmap, rotacao: number): HTMLCanvasElement {
  const deitado = rotacao % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = deitado ? img.height : img.width;
  canvas.height = deitado ? img.width : img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ErroFoto('Este navegador não conseguiu ler a foto.');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotacao * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return canvas;
}

function recorte(origem: HTMLCanvasElement, x: number, y: number, w: number, h: number, escala = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * escala));
  c.height = Math.max(1, Math.round(h * escala));
  const g = c.getContext('2d');
  if (!g) throw new ErroFoto('Este navegador não conseguiu ler a foto.');
  g.filter = 'grayscale(1) contrast(1.6)';
  g.imageSmoothingQuality = 'high';
  g.drawImage(origem, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

export interface ResultadoOcr extends LeituraEtiqueta {
  rawText: string;
  fromBarcode: boolean;
}

/** Partes da imagem, com sobreposição: as barras e a caixa ao fundo atrapalham menos o texto. */
const PARTES: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.35, 0],
  [0, 0.2],
  [0.35, 0.2],
  [0, 0.4],
  [0.35, 0.4],
  [0, 0.6],
  [0.35, 0.6],
];

/** Relê só os dígitos da linha "Dlv", ampliada: a leitura geral erra dígito (5 vira 3). */
async function digitosDaLinha(leitor: TrabalhadorOcr, parte: HTMLCanvasElement, linha: LinhaOcr): Promise<string | null> {
  const palavra = linha.words.find((p) => /^\d{3,}/.test(p.text));
  if (!palavra) return null;
  const altura = linha.bbox.y1 - linha.bbox.y0;
  const margem = Math.round(altura * 0.25);
  await leitor.setParameters({ tessedit_pageseg_mode: '13', tessedit_char_whitelist: '0123456789' });
  try {
    const x = Math.max(0, palavra.bbox.x0 - margem);
    const r = await leitor.recognize(recorte(parte, x, Math.max(0, linha.bbox.y0 - margem), linha.bbox.x1 - x + margem, altura + 2 * margem, 3));
    const digitos = r.data.text.replace(/\D/g, '');
    return digitos.length >= 6 && digitos.length <= 12 ? digitos : null;
  } finally {
    await leitor.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
  }
}

/**
 * Lê a foto aqui no aparelho: primeiro o código de barras (exato), depois o texto
 * por partes até achar o que falta. Nada sai do aparelho além do resultado.
 */
export async function lerFoto(foto: Blob, rotacao = 0): Promise<ResultadoOcr> {
  const img = await createImageBitmap(foto);
  try {
    const tela = desenhar(img, rotacao);
    let codigos: ReturnType<typeof interpretarCodigos> = { number: null, reference: null, delivery: null, raw: null };
    try {
      const decodificador = await criarDecodificador(['code_128', 'code_39', 'qr_code']);
      codigos = interpretarCodigos((await decodificador.detectar(tela)).map((d) => d.valor));
    } catch {
      // Sem leitor de código neste aparelho: segue só com o texto.
    }
    const leitor = await ocr();
    await leitor.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
    const textos: string[] = [];
    let deliveryRelida: string | null = null;
    const w = Math.round(tela.width * 0.65);
    const h = Math.round(tela.height * 0.4);
    for (const [px, py] of PARTES) {
      const parte = recorte(tela, Math.round(tela.width * px), Math.round(tela.height * py), w, h);
      const r = await leitor.recognize(parte, {}, { text: true, blocks: true });
      textos.push(r.data.text);
      if (codigos.delivery === null && deliveryRelida === null) {
        const linhas = (r.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
        const dlv = linhas.find((l) => /\bD\s*[lIi1!|]+\s*v\b/i.test(l.text));
        if (dlv) deliveryRelida = await digitosDaLinha(leitor, parte, dlv);
      }
      const parcial = interpretarEtiqueta(textos.join('\n'));
      // Para cedo só com tudo em mãos: a L'Oréal não tem fração; a DHL precisa do número e da fração.
      const delivery = codigos.delivery ?? deliveryRelida ?? parcial.delivery;
      const numero = codigos.number ?? parcial.number;
      const fracao = codigos.reference ?? parcial.reference;
      if (parcial.sender !== null && (delivery !== null || (numero !== null && fracao !== null))) break;
    }
    const texto = textos.join('\n');
    const lido = interpretarEtiqueta(texto);
    const delivery = codigos.delivery ?? deliveryRelida ?? lido.delivery;
    const numero = codigos.number ?? lido.number;
    return {
      ...lido,
      number: numero,
      numberRaw: codigos.raw ?? lido.numberRaw,
      delivery,
      // Etiqueta L'Oréal não tem fração: o que parecer uma é erro de leitura.
      reference: codigos.reference ?? (numero === null && delivery !== null ? null : lido.reference),
      candidates: codigos.number !== null ? [] : lido.candidates,
      fromBarcode: codigos.raw !== null,
      rawText: texto.slice(0, 8_000),
    };
  } finally {
    img.close();
  }
}
