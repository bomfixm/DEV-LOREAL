import type { Retangulo } from '@praca-reversa/contracts';

/**
 * Única adaptação entre as coordenadas do layout e o CRS.Simple do Leaflet
 * (docs/MAPA-ZOOM.md). No layout, a origem fica no canto superior esquerdo e
 * y cresce para baixo; no Leaflet, a ordem é [lat, lng] e lat cresce para cima.
 * Para um desenho de altura H: (x, y) ⇄ [H − y, x].
 */
export interface PontoLayout {
  x: number;
  y: number;
}

export type LatLngTupla = readonly [lat: number, lng: number];
/** Limites no formato do Leaflet: [sudoeste, nordeste]. */
export type LimitesTupla = readonly [LatLngTupla, LatLngTupla];

export interface Conversor {
  readonly altura: number;
  paraLatLng(ponto: PontoLayout): LatLngTupla;
  deLatLng(latLng: LatLngTupla): PontoLayout;
  limitesDe(retangulo: Retangulo): LimitesTupla;
  centroDe(retangulo: Retangulo): PontoLayout;
}

export function criarConversor(altura: number): Conversor {
  if (!Number.isFinite(altura) || altura <= 0) throw new Error('Altura do layout inválida.');
  const paraLatLng = ({ x, y }: PontoLayout): LatLngTupla => [altura - y, x];
  return {
    altura,
    paraLatLng,
    deLatLng: ([lat, lng]) => ({ x: lng, y: altura - lat }),
    limitesDe: (r) => [paraLatLng({ x: r.x, y: r.y + r.height }), paraLatLng({ x: r.x + r.width, y: r.y })],
    centroDe: (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }),
  };
}

/** Retângulo reduzido igualmente em todos os lados (palete dentro da posição). */
export function recuar(retangulo: Retangulo, margem: number): Retangulo {
  const m = Math.min(margem, retangulo.width / 4, retangulo.height / 4);
  return {
    x: retangulo.x + m,
    y: retangulo.y + m,
    width: retangulo.width - 2 * m,
    height: retangulo.height - 2 * m,
  };
}
