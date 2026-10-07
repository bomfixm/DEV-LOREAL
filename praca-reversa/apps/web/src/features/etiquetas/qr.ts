import { create } from 'qrcode';

/** Margem livre obrigatória ao redor do QR (zona de silêncio), em módulos. */
export const ZONA_SILENCIO = 4;

export interface MatrizQr {
  /** Módulos por lado, sem a zona de silêncio. */
  tamanho: number;
  escuro(linha: number, coluna: number): boolean;
}

/**
 * Codifica o texto (o link do palete) com a biblioteca `qrcode`. Correção de
 * erro "Q" (~25%): a etiqueta de palete sofre atrito e sujeira.
 */
export function gerarMatrizQr(texto: string): MatrizQr {
  const qr = create(texto, { errorCorrectionLevel: 'Q' });
  const { modules } = qr;
  return { tamanho: modules.size, escuro: (linha, coluna) => modules.get(linha, coluna) === 1 };
}

/**
 * Caminho SVG dos módulos escuros, deslocado pela zona de silêncio. Um
 * retângulo por sequência horizontal de módulos, para manter o arquivo curto.
 */
export function caminhoSvgQr(matriz: MatrizQr): string {
  const partes: string[] = [];
  for (let linha = 0; linha < matriz.tamanho; linha++) {
    let inicio = -1;
    for (let coluna = 0; coluna <= matriz.tamanho; coluna++) {
      const escuro = coluna < matriz.tamanho && matriz.escuro(linha, coluna);
      if (escuro && inicio < 0) inicio = coluna;
      if (!escuro && inicio >= 0) {
        partes.push(`M${String(inicio + ZONA_SILENCIO)} ${String(linha + ZONA_SILENCIO)}h${String(coluna - inicio)}v1h-${String(coluna - inicio)}z`);
        inicio = -1;
      }
    }
  }
  return partes.join('');
}

/** Lado total do desenho (módulos + zona de silêncio dos dois lados). */
export function ladoComMargem(matriz: MatrizQr): number {
  return matriz.tamanho + 2 * ZONA_SILENCIO;
}
