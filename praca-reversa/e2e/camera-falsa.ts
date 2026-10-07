import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

/**
 * Câmera simulada (etapa 09). Os códigos são gerados aqui mesmo pelo
 * gravador do ZXing-C++ (zxing-wasm, o mesmo projeto do decodificador da
 * interface) e mostrados de dois jeitos:
 * - vídeo Y4M para a câmera falsa do Chrome (--use-file-for-fake-video-capture),
 *   passando pelo getUserMedia real do navegador;
 * - canvas no lugar do getUserMedia (instalarCameraFalsa), para trocar o
 *   código durante o teste e simular permissão negada, câmera ocupada,
 *   permissão concedida depois do cancelamento e ausência do recurso.
 * Nada sai da máquina; dados fictícios.
 */
export type FormatoTeste = 'Code128' | 'QRCode';

interface Simbolo {
  largura: number;
  altura: number;
  dados: Uint8ClampedArray;
}

type Escrever = (texto: string, opcoes: { format: FormatoTeste; scale: number }) => Promise<{ error: string; symbol: Simbolo | null }>;
let escritor: Promise<Escrever> | null = null;

async function obterEscritor(): Promise<Escrever> {
  escritor ??= (async () => {
    const req = createRequire(join(process.cwd(), 'package.json'));
    const modulo = (await import(pathToFileURL(req.resolve('zxing-wasm/writer')).href)) as {
      prepareZXingModule: (o: { overrides: { wasmBinary: ArrayBuffer } }) => void;
      writeBarcode: (texto: string, opcoes: { format: string; scale: number }) => Promise<{ error: string; symbol: { width: number; height: number; data: Uint8ClampedArray } | null }>;
    };
    const pasta = dirname(dirname(dirname(req.resolve('zxing-wasm/writer'))));
    const wasm = readFileSync(join(pasta, 'writer', 'zxing_writer.wasm'));
    modulo.prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) } });
    return async (texto, opcoes) => {
      const r = await modulo.writeBarcode(texto, opcoes);
      return { error: r.error, symbol: r.symbol ? { largura: r.symbol.width, altura: r.symbol.height, dados: r.symbol.data } : null };
    };
  })();
  return escritor;
}

async function simbolo(texto: string, formato: FormatoTeste): Promise<Simbolo> {
  const r = await (await obterEscritor())(texto, { format: formato, scale: 1 });
  if (!r.symbol || r.error) throw new Error(`Não foi possível gerar ${formato} para ${texto}: ${r.error}`);
  return r.symbol;
}

/** Quadro em tons de cinza (0 = preto) com o símbolo centralizado e margem branca. */
async function quadro(texto: string, formato: FormatoTeste, largura: number, altura: number): Promise<Uint8Array> {
  const s = await simbolo(texto, formato);
  // Cabe nas duas dimensões, com margem branca (zona de silêncio) em volta.
  const escalaX = Math.max(1, Math.floor(Math.min((largura * 0.8) / s.largura, formato === 'QRCode' ? (altura * 0.8) / s.altura : Infinity)));
  const escalaY = formato === 'QRCode' ? escalaX : Math.max(1, Math.min(escalaX * 2, Math.floor((altura * 0.6) / s.altura)));
  const w = s.largura * escalaX;
  const h = s.altura * escalaY;
  const x0 = Math.floor((largura - w) / 2);
  const y0 = Math.floor((altura - h) / 2);
  const pixels = new Uint8Array(largura * altura).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const modulo = s.dados[Math.floor(y / escalaY) * s.largura + Math.floor(x / escalaX)] ?? 255;
      pixels[(y0 + y) * largura + x0 + x] = modulo < 128 ? 0 : 255;
    }
  }
  return pixels;
}

/** PNG (data URL) do código, para a câmera simulada por canvas. */
export async function imagemDoCodigo(texto: string, formato: FormatoTeste, largura = 640, altura = 480): Promise<string> {
  const cinza = await quadro(texto, formato, largura, altura);
  const png = new PNG({ width: largura, height: altura });
  for (let i = 0; i < cinza.length; i++) {
    const v = cinza[i] ?? 255;
    png.data[i * 4] = v;
    png.data[i * 4 + 1] = v;
    png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

/** Vídeo Y4M (4:2:0, cinza) para a câmera falsa do Chrome; o navegador repete o arquivo. */
export async function videoDoCodigo(arquivo: string, texto: string, formato: FormatoTeste, largura = 640, altura = 480, quadros = 10): Promise<void> {
  const y = await quadro(texto, formato, largura, altura);
  const croma = Buffer.alloc((largura / 2) * (altura / 2) * 2, 128);
  const partes: Buffer[] = [Buffer.from(`YUV4MPEG2 W${String(largura)} H${String(altura)} F10:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < quadros; i++) partes.push(Buffer.from('FRAME\n'), Buffer.from(y.map((v) => (v === 0 ? 16 : 235))), croma);
  writeFileSync(arquivo, Buffer.concat(partes));
}

export interface EstadoCameraFalsa {
  chamadas: number;
  restricoes: string[];
  trilhasAtivas: number;
  trilhasTotal: number;
}

/**
 * Substitui navigator.mediaDevices.getUserMedia por uma câmera de canvas.
 * Chame antes de navegar. No navegador: window.__cameraFalsa.
 */
export async function instalarCameraFalsa(page: Page, opcoes: { semRecurso?: boolean; inseguro?: boolean } = {}): Promise<void> {
  await page.addInitScript((o: { semRecurso: boolean; inseguro: boolean }) => {
    interface Camera {
      imagem: string | null;
      erro: string | null;
      atrasoMs: number;
      chamadas: number;
      restricoes: string[];
      trilhas: MediaStreamTrack[];
      desenhada: string | null;
    }
    const janela = window as unknown as { __cameraFalsa: Camera };
    const camera: Camera = { imagem: null, erro: null, atrasoMs: 0, chamadas: 0, restricoes: [], trilhas: [], desenhada: null };
    janela.__cameraFalsa = camera;
    if (o.inseguro) Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true });
    if (o.semRecurso) {
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
      return;
    }
    const getUserMedia = async (restricoes: MediaStreamConstraints): Promise<MediaStream> => {
      camera.chamadas += 1;
      camera.restricoes.push(JSON.stringify(restricoes));
      if (camera.atrasoMs > 0) await new Promise((r) => setTimeout(r, camera.atrasoMs));
      if (camera.erro) throw new DOMException('Câmera simulada', camera.erro);
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      let carregada: string | null = null;
      const desenhar = () => {
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 640, 480);
        if (camera.imagem !== null && carregada !== camera.imagem) {
          img.src = camera.imagem;
          carregada = camera.imagem;
        }
        if (camera.imagem !== null && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, 0, 0, 640, 480);
          camera.desenhada = carregada;
        }
      };
      desenhar();
      const relogio = setInterval(desenhar, 50);
      const stream = canvas.captureStream(15);
      for (const trilha of stream.getTracks()) {
        camera.trilhas.push(trilha);
        const parar = trilha.stop.bind(trilha);
        trilha.stop = () => {
          clearInterval(relogio);
          parar();
        };
      }
      return stream;
    };
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia, enumerateDevices: () => Promise.resolve([]) }, configurable: true });
  }, { semRecurso: opcoes.semRecurso ?? false, inseguro: opcoes.inseguro ?? false });
}

/**
 * Troca o que a câmera "vê". Com a câmera aberta, espera o canvas desenhar a
 * imagem nova e o vídeo avançar alguns quadros (como mover o aparelho para o
 * próximo código antes de tocar em "Ler próximo").
 */
export async function mostrarNaCamera(page: Page, imagem: string | null): Promise<void> {
  await page.evaluate((i) => {
    (window as unknown as { __cameraFalsa: { imagem: string | null } }).__cameraFalsa.imagem = i;
  }, imagem);
  const aberta = await page.evaluate(() => (window as unknown as { __cameraFalsa: { trilhas: MediaStreamTrack[] } }).__cameraFalsa.trilhas.some((t) => t.readyState === 'live'));
  if (!aberta || imagem === null) return;
  await page.waitForFunction((i) => (window as unknown as { __cameraFalsa: { desenhada: string | null } }).__cameraFalsa.desenhada === i, imagem);
  await page.waitForTimeout(500);
}

export async function configurarCamera(page: Page, mudanca: { erro?: string | null; atrasoMs?: number }): Promise<void> {
  await page.evaluate((m) => {
    const c = (window as unknown as { __cameraFalsa: { erro: string | null; atrasoMs: number } }).__cameraFalsa;
    if (m.erro !== undefined) c.erro = m.erro;
    if (m.atrasoMs !== undefined) c.atrasoMs = m.atrasoMs;
  }, mudanca);
}

export async function estadoCamera(page: Page): Promise<EstadoCameraFalsa> {
  return page.evaluate(() => {
    const c = (window as unknown as { __cameraFalsa: { chamadas: number; restricoes: string[]; trilhas: MediaStreamTrack[] } }).__cameraFalsa;
    return {
      chamadas: c.chamadas,
      restricoes: c.restricoes,
      trilhasAtivas: c.trilhas.filter((t) => t.readyState === 'live').length,
      trilhasTotal: c.trilhas.length,
    };
  });
}
