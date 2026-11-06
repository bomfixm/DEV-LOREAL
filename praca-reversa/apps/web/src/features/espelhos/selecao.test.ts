import type { Layout, PaleteResumo } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import { alternarGrupo, indiceDoMapa, ordenarParaImpressao } from './selecao';

const posicao = (id: string, rowId: string, texto: string | null) => ({ id, rowId, code: id, address: texto === null ? null : { state: 'CONFIRMADO', text: texto } });
const layout = {
  rows: [
    { id: 'F04', blockCode: 'FB03' },
    { id: 'F05', blockCode: 'FB03' },
    { id: 'F08', blockCode: 'FB05' },
  ],
  positions: [posicao('p1', 'F04', '13 - A101'), posicao('p2', 'F05', '13 - A102'), posicao('p3', 'F04', '13 - A103'), posicao('p4', 'F05', '13 - A104'), posicao('p5', 'F08', '16 - A101'), posicao('p6', 'F08', null)],
} as unknown as Layout;
const palete = (id: string, positionId: string | null, flowState = 'EM_ESTOQUE') => ({ id, code: id.toUpperCase(), positionId, flowState }) as unknown as PaleteResumo;
const paletes = [palete('a', 'p1'), palete('b', 'p2'), palete('c', 'p3'), palete('d', 'p4'), palete('e', 'p5'), palete('f', 'p6'), palete('g', null), palete('h', 'p2', 'EXPEDIDO')];

describe('seleção de espelhos no mapa', () => {
  it('agrupa por rua e por fileira só os paletes em estoque ou reservados com posição', () => {
    const { porBloco, porFileira, elegiveis } = indiceDoMapa(layout, paletes);
    expect(porBloco.get('FB03')).toEqual(['a', 'b', 'c', 'd']);
    expect(porBloco.get('FB05')).toEqual(['e', 'f']);
    expect(porFileira.get('F04')).toEqual(['a', 'c']);
    expect([...elegiveis].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('clicar marca o grupo; clicar de novo desmarca; grupo parcial completa', () => {
    const marcado = alternarGrupo(new Set(), ['a', 'c']);
    expect([...marcado]).toEqual(['a', 'c']);
    expect([...alternarGrupo(marcado, ['a', 'c'])]).toEqual([]);
    expect([...alternarGrupo(new Set(['a']), ['a', 'c'])].sort()).toEqual(['a', 'c']);
    expect([...alternarGrupo(new Set(['x']), [])]).toEqual(['x']);
  });

  it('imprime rua a rua; ímpares crescentes e depois pares decrescentes; sem endereço no fim', () => {
    const ordem = ordenarParaImpressao(['f', 'e', 'd', 'c', 'b', 'a'], layout, paletes);
    expect(ordem).toEqual(['a', 'c', 'd', 'b', 'e', 'f']);
  });
});
