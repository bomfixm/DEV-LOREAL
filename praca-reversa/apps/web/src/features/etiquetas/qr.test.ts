import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { ZONA_SILENCIO, caminhoSvgQr, gerarMatrizQr, ladoComMargem, type MatrizQr } from './qr';

/** Rasteriza a matriz (com zona de silêncio) em RGBA, como numa impressão. */
function rasterizar(matriz: MatrizQr, escala: number): { dados: Uint8ClampedArray; lado: number } {
  const lado = ladoComMargem(matriz) * escala;
  const dados = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (let linha = 0; linha < matriz.tamanho; linha++) {
    for (let coluna = 0; coluna < matriz.tamanho; coluna++) {
      if (!matriz.escuro(linha, coluna)) continue;
      for (let dy = 0; dy < escala; dy++) {
        for (let dx = 0; dx < escala; dx++) {
          const x = (coluna + ZONA_SILENCIO) * escala + dx;
          const y = (linha + ZONA_SILENCIO) * escala + dy;
          const i = (y * lado + x) * 4;
          dados[i] = dados[i + 1] = dados[i + 2] = 0;
        }
      }
    }
  }
  return { dados, lado };
}

describe('QR da etiqueta', () => {
  it('decodifica exatamente o link do palete (somente o link)', () => {
    const url = 'http://192.168.0.10:3000/paletes/0a1b2c3d-0000-4000-8000-000000000123';
    const matriz = gerarMatrizQr(url);
    const { dados, lado } = rasterizar(matriz, 4);
    const lido = jsQR(dados, lado, lado);
    expect(lido?.data).toBe(url);
  });

  it('desenha só módulos escuros, dentro da zona de silêncio', () => {
    const matriz = gerarMatrizQr('https://praca.exemplo.interno/paletes/0a1b2c3d-0000-4000-8000-000000000123');
    const caminho = caminhoSvgQr(matriz);
    const xs = [...caminho.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
    expect(xs.length).toBeGreaterThan(0);
    for (const [x, y, largura] of xs) {
      expect(x).toBeGreaterThanOrEqual(ZONA_SILENCIO);
      expect(y).toBeGreaterThanOrEqual(ZONA_SILENCIO);
      expect(x + largura).toBeLessThanOrEqual(ZONA_SILENCIO + matriz.tamanho);
      expect(y).toBeLessThan(ZONA_SILENCIO + matriz.tamanho);
    }
  });
});
