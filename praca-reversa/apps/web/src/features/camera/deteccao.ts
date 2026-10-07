/**
 * Leitura por câmera (etapa 09): recursos e formatos detectados em tempo de
 * execução. O BarcodeDetector do navegador é usado quando existe e aceita
 * todos os formatos pedidos (Android/ChromeOS/macOS, conforme a versão);
 * senão, o decodificador local ZXing-C++ em WebAssembly (pacote
 * barcode-detector), servido pela própria instalação. Os quadros nunca saem
 * do aparelho.
 */

/** QR interno do palete. */
export const FORMATOS_PALETE: readonly string[] = ['qr_code'];
/** Códigos de produto e embalagem mais comuns (EAN/UPC, Code 128/39, ITF-14, DataMatrix) e QR. */
export const FORMATOS_PRODUTO: readonly string[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'data_matrix', 'qr_code'];

export const ROTULOS_FORMATO: Record<string, string> = {
  qr_code: 'QR',
  ean_13: 'EAN-13',
  ean_8: 'EAN-8',
  upc_a: 'UPC-A',
  upc_e: 'UPC-E',
  code_128: 'Code 128',
  code_39: 'Code 39',
  itf: 'ITF',
  data_matrix: 'DataMatrix',
};

export interface Deteccao {
  /** Valor exatamente como lido (texto; zeros preservados). */
  valor: string;
  formato: string;
}

export interface Decodificador {
  origem: 'nativo' | 'local';
  formatos: readonly string[];
  detectar(fonte: HTMLCanvasElement): Promise<Deteccao[]>;
}

interface DetectorLike {
  detect(fonte: HTMLCanvasElement): Promise<{ rawValue: string; format: string }[]>;
}
interface DetectorCtor {
  new (opcoes?: { formats?: string[] }): DetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

function adaptar(detector: DetectorLike, origem: Decodificador['origem'], formatos: readonly string[]): Decodificador {
  return {
    origem,
    formatos,
    async detectar(fonte) {
      const achados = await detector.detect(fonte);
      return achados.map((a) => ({ valor: a.rawValue, formato: a.format }));
    },
  };
}

/** Escolhe o decodificador: nativo se cobrir todos os formatos pedidos; senão, o local. */
export async function criarDecodificador(desejados: readonly string[]): Promise<Decodificador> {
  const nativo = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (nativo !== undefined) {
    try {
      const suportados = await nativo.getSupportedFormats();
      const formatos = desejados.filter((f) => suportados.includes(f));
      if (formatos.length === desejados.length) return adaptar(new nativo({ formats: [...formatos] }), 'nativo', formatos);
    } catch {
      // Detector nativo indisponível neste aparelho: segue para o local.
    }
  }
  const [modulo, wasm] = await Promise.all([import('barcode-detector/ponyfill'), import('zxing-wasm/reader/zxing_reader.wasm?url')]);
  // WebAssembly servido pela própria instalação (não pela CDN padrão do pacote).
  modulo.prepareZXingModule({
    overrides: {
      locateFile: (caminho: string, prefixo: string) => (caminho.endsWith('.wasm') ? wasm.default : prefixo + caminho),
    },
  });
  const Local = modulo.BarcodeDetector as unknown as DetectorCtor;
  const suportados = await Local.getSupportedFormats();
  const formatos = desejados.filter((f) => suportados.includes(f));
  return adaptar(new Local({ formats: [...formatos] }), 'local', formatos);
}

export type FalhaCamera = 'contexto-inseguro' | 'sem-recurso' | 'permissao-negada' | 'sem-camera' | 'camera-ocupada' | 'decodificador' | 'outra';

/** Antes de pedir a câmera: origem segura e API presentes. */
export function verificarSuporte(): FalhaCamera | null {
  if (typeof window === 'undefined' || !window.isSecureContext) return 'contexto-inseguro';
  // Navegadores antigos ou contexto restrito: mediaDevices pode nem existir.
  const dispositivos = (navigator as { mediaDevices?: Partial<MediaDevices> }).mediaDevices;
  if (typeof dispositivos?.getUserMedia !== 'function') return 'sem-recurso';
  return null;
}

/** Erro de getUserMedia → situação para a pessoa (nomes padronizados de DOMException). */
export function classificarErroCamera(erro: unknown): FalhaCamera {
  const nome = typeof erro === 'object' && erro !== null && 'name' in erro ? String(erro.name) : '';
  switch (nome) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permissao-negada';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'sem-camera';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'camera-ocupada';
    case 'TypeError':
      return 'sem-recurso';
    default:
      return 'outra';
  }
}

export const TEXTO_FALHA_CAMERA: Record<FalhaCamera, string> = {
  'contexto-inseguro': 'A câmera só funciona em endereço seguro (HTTPS, ou localhost no próprio computador). Use o leitor-teclado ou digite o código.',
  'sem-recurso': 'Este navegador não oferece acesso à câmera. Use o leitor-teclado ou digite o código.',
  'permissao-negada': 'A permissão da câmera foi recusada ou bloqueada. Libere nas configurações do site, ou use o leitor-teclado/digitação.',
  'sem-camera': 'Nenhuma câmera foi encontrada neste aparelho. Use o leitor-teclado ou digite o código.',
  'camera-ocupada': 'A câmera está em uso por outro aplicativo ou não pôde ser iniciada. Feche o outro uso e tente de novo, ou digite o código.',
  decodificador: 'O leitor de códigos não pôde ser carregado neste aparelho. Use o leitor-teclado ou digite o código.',
  outra: 'Não foi possível abrir a câmera. Use o leitor-teclado ou digite o código.',
};
