import { describe, expect, it } from 'vitest';
import { areaPrincipal, enderecoCurto, margensLivres, nivelDetalhe } from './enquadramento';

const pos = (x: number, y: number, desativada = false) => ({ x, y, width: 80, height: 48, deactivated: desativada });
const zona = (y: number, altura: number) => ({ kind: 'ZONA' as const, x: 34, y, width: 1480, height: altura });

describe('enquadramento inicial do mapa', () => {
  it('área principal = zona com posições em uso (L’Oréal embaixo), sem a área desativada de cima', () => {
    const layout = {
      width: 1562,
      height: 2792,
      elements: [zona(48, 1484), zona(1620, 1052), { kind: 'CORREDOR' as const, x: 48, y: 1540, width: 1466, height: 72 }],
      positions: [pos(60, 200, true), pos(60, 300, true), pos(60, 1700), pos(1400, 2600)],
    };
    expect(areaPrincipal(layout)).toEqual({ x: 34, y: 1620, width: 1480, height: 1052 });
  });

  it('duas zonas em uso = as duas; sem zonas, as posições em uso; sem nada em uso, a praça inteira', () => {
    expect(areaPrincipal({ width: 2264, height: 1808, elements: [zona(40, 760), zona(896, 760)], positions: [pos(60, 100), pos(60, 1000)] })).toEqual({
      x: 34,
      y: 40,
      width: 1480,
      height: 1616,
    });
    expect(areaPrincipal({ width: 1000, height: 900, elements: [], positions: [pos(100, 100), pos(300, 500), pos(900, 10, true)] })).toEqual({ x: 100, y: 100, width: 280, height: 448 });
    expect(areaPrincipal({ width: 1000, height: 900, elements: [zona(0, 900)], positions: [pos(100, 100, true)] })).toEqual({ x: 0, y: 0, width: 1000, height: 900 });
  });

  it('margens: controles do canto vão para a lateral (sobra largura); nada largo em cima', () => {
    // Mapa 1298×630, área alta (1480×1052): coluna de ferramentas e legenda à esquerda, botões à direita.
    const m = margensLivres(
      1298,
      630,
      1480 / 1052,
      [
        { esquerda: 10, topo: 10, direita: 210, base: 230 }, // ferramentas
        { esquerda: 10, topo: 420, direita: 220, base: 620 }, // legenda
        { esquerda: 1252, topo: 10, direita: 1288, base: 130 }, // + − centralizar
      ],
      { topo: 12, direita: 12, base: 12, esquerda: 12 },
    );
    expect(m).toEqual({ topo: 12, direita: 56, base: 12, esquerda: 230 });
  });

  it('margens: controle largo embaixo fica embaixo; sem controles, só a folga', () => {
    const m = margensLivres(1000, 600, 1, [{ esquerda: 10, topo: 540, direita: 990, base: 590 }], { topo: 8, direita: 8, base: 8, esquerda: 8 });
    expect(m).toEqual({ topo: 8, direita: 8, base: 70, esquerda: 8 });
    expect(margensLivres(800, 600, 1, [], { topo: 5, direita: 5, base: 5, esquerda: 5 })).toEqual({ topo: 5, direita: 5, base: 5, esquerda: 5 });
  });

  it('endereço curto: sem o número da rua (está no título do bloco); proposta mostra só o número da posição', () => {
    const p = (texto: string, estado: 'CONFIRMADO' | 'PROPOSTO') => ({ code: 'F03-P07', address: { text: texto, state: estado } }) as unknown as Parameters<typeof enderecoCurto>[0];
    expect(enderecoCurto(p('15 - A120', 'CONFIRMADO'), 'F03-P07')).toBe('A120');
    expect(enderecoCurto(p('GR - 9', 'CONFIRMADO'), 'F07-P01')).toBe('GR9');
    expect(enderecoCurto(p('12 - A79', 'PROPOSTO'), 'F03-P07')).toBe('P07');
    expect(enderecoCurto(undefined, 'F01-P12')).toBe('P12');
  });

  it('níveis de rótulo pela largura do palete em px: endereço curto a partir de 30 px', () => {
    expect(nivelDetalhe(29)).toBe(0);
    expect(nivelDetalhe(30)).toBe(1);
    expect(nivelDetalhe(59)).toBe(1);
    expect(nivelDetalhe(60)).toBe(2);
    expect(nivelDetalhe(112)).toBe(3);
  });
});
