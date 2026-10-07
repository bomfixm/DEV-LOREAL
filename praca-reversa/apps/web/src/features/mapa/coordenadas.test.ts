import { describe, expect, it } from 'vitest';
import { criarConversor, recuar } from './coordenadas';

describe('conversão layout ⇄ CRS.Simple', () => {
  const H = 1000;
  const conv = criarConversor(H);

  it('posiciona os cantos do desenho', () => {
    expect(conv.paraLatLng({ x: 0, y: 0 })).toEqual([1000, 0]); // superior esquerdo
    expect(conv.paraLatLng({ x: 2000, y: 0 })).toEqual([1000, 2000]); // superior direito
    expect(conv.paraLatLng({ x: 0, y: 1000 })).toEqual([0, 0]); // inferior esquerdo
    expect(conv.paraLatLng({ x: 2000, y: 1000 })).toEqual([0, 2000]); // inferior direito
  });

  it('converte retângulo em limites sudoeste/nordeste', () => {
    const limites = conv.limitesDe({ x: 100, y: 200, width: 80, height: 50 });
    expect(limites).toEqual([
      [750, 100],
      [800, 180],
    ]);
    const [[sul, oeste], [norte, leste]] = limites;
    expect(norte - sul).toBe(50);
    expect(leste - oeste).toBe(80);
  });

  it('ida e volta preserva o ponto, inclusive fracionário', () => {
    for (const ponto of [
      { x: 0, y: 0 },
      { x: 123.5, y: 987.25 },
      { x: 2000, y: 1000 },
    ]) {
      expect(conv.deLatLng(conv.paraLatLng(ponto))).toEqual(ponto);
    }
  });

  it('o centro do retângulo corresponde ao centro dos limites', () => {
    const r = { x: 40, y: 60, width: 80, height: 52 };
    const [[sul, oeste], [norte, leste]] = conv.limitesDe(r);
    expect(conv.deLatLng([(sul + norte) / 2, (oeste + leste) / 2])).toEqual(conv.centroDe(r));
  });

  it('recusa altura inválida', () => {
    expect(() => criarConversor(0)).toThrow();
    expect(() => criarConversor(Number.NaN)).toThrow();
  });
});

describe('recuo do palete dentro da posição', () => {
  it('mantém o centro e reduz as medidas', () => {
    const posicao = { x: 10, y: 20, width: 80, height: 52 };
    const palete = recuar(posicao, 5);
    expect(palete).toEqual({ x: 15, y: 25, width: 70, height: 42 });
  });

  it('limita o recuo em posições pequenas', () => {
    const palete = recuar({ x: 0, y: 0, width: 8, height: 8 }, 5);
    expect(palete.width).toBeGreaterThan(0);
    expect(palete.height).toBeGreaterThan(0);
  });
});
