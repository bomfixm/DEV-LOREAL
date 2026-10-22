import type { Layout, PaleteResumo } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import { agruparPaletes, filtroAtivo, FILTRO_VAZIO, normalizar, urlFiltro } from './filtro';

const F1 = '20000000-0000-4000-8000-000000000001';
const F2 = '20000000-0000-4000-8000-000000000002';
const pos = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const layout: Layout = {
  id: '30000000-0000-4000-8000-000000000001',
  code: 'L',
  version: 't',
  revision: 1,
  name: 'Teste',
  unit: 'UNIDADE_DE_DESENHO',
  origin: 'SUPERIOR_ESQUERDO',
  width: 500,
  height: 300,
  totalCapacity: null,
  schematic: true,
  fictional: false,
  elements: [
    { id: '40000000-0000-4000-8000-000000000001', kind: 'BLOCO', code: 'B01', label: 'Fileira única de 15', fictional: false, x: 0, y: 0, width: 400, height: 50, labelBox: null, operationalName: null, addressPrefix: null },
    { id: '40000000-0000-4000-8000-000000000002', kind: 'BLOCO', code: 'B02', label: 'Par de 15', fictional: false, x: 0, y: 100, width: 400, height: 50, labelBox: null, operationalName: null, addressPrefix: null },
  ],
  rows: [
    { id: F1, code: 'F01', label: 'F01', order: 1, blockCode: 'B01', x: 0, y: 10, width: 300, height: 30, labelBox: { x: 0, y: 10, width: 30, height: 30 }, side: null },
    { id: F2, code: 'F02', label: 'F02', order: 2, blockCode: 'B02', x: 0, y: 110, width: 300, height: 30, labelBox: { x: 0, y: 110, width: 30, height: 30 }, side: null },
  ],
  positions: [
    { id: pos(1), code: 'F01-P01', provisionalCode: true, rowId: F1, number: 1, x: 40, y: 10, width: 40, height: 30, available: true, unavailableReason: null, occupancySurveyed: false, deactivated: false, address: null, freeConfirmed: null },
    { id: pos(2), code: 'F01-P02', provisionalCode: true, rowId: F1, number: 2, x: 90, y: 10, width: 40, height: 30, available: true, unavailableReason: null, occupancySurveyed: false, deactivated: false, address: null, freeConfirmed: null },
    { id: pos(3), code: 'F02-P01', provisionalCode: true, rowId: F2, number: 1, x: 40, y: 110, width: 40, height: 30, available: true, unavailableReason: null, occupancySurveyed: false, deactivated: false, address: null, freeConfirmed: null },
  ],
};

function resumo(n: number, posicao: number | null): PaleteResumo {
  const p = posicao === null ? undefined : layout.positions[posicao - 1];
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    code: `PAL-DEMO-${String(n).padStart(3, '0')}`,
    positionId: p?.id ?? null,
    positionCode: p?.code ?? null,
    countState: 'NAO_CONFERIDO',
    releaseState: 'PENDENTE',
    flowState: 'EM_ESTOQUE',
    pendingReason: null,
    activeCountId: null,
    reconference: null,
    volumeCheck: null,
    legacyCode: null,
  };
}

const paletes = [resumo(3, 3), resumo(2, 2), resumo(9, null), resumo(1, 1)];

describe('filtro da lista', () => {
  it('ignora acentos, maiúsculas e separadores', () => {
    expect(normalizar(' F01-P02 ')).toBe('f01p02');
    expect(normalizar('Não')).toBe('nao');
  });

  it('indica quando há filtro ativo', () => {
    expect(filtroAtivo(FILTRO_VAZIO)).toBe(false);
    expect(filtroAtivo({ texto: ' - ', conferencia: 'TODOS' })).toBe(false);
    expect(filtroAtivo({ texto: '', conferencia: 'RECONCILIADO' })).toBe(true);
  });

  it('monta a consulta do servidor com limite e texto limitado a 64 caracteres', () => {
    const url = new URL(urlFiltro({ texto: ` ${'x'.repeat(80)} `, conferencia: 'PARCIAL' }), 'http://local');
    expect(url.pathname).toBe('/api/v1/paletes');
    expect(url.searchParams.get('texto')).toHaveLength(64);
    expect(url.searchParams.get('conferencia')).toBe('PARCIAL');
    expect(url.searchParams.get('limite')).toBe('500');
    expect(new URL(urlFiltro(FILTRO_VAZIO), 'http://local').searchParams.has('texto')).toBe(false);
  });
});

describe('agrupamento da lista', () => {
  it('segue a ordem das fileiras, com o bloco como subtítulo e localização pendente ao final', () => {
    const grupos = agruparPaletes(paletes, layout);
    expect(grupos.map((g) => g.titulo)).toEqual(['F01', 'F02', 'Localização pendente']);
    expect(grupos[0]?.subtitulo).toBe('Fileira única de 15');
    expect(grupos[0]?.paletes.map((p) => p.positionCode)).toEqual(['F01-P01', 'F01-P02']);
    expect(grupos[2]?.paletes.map((p) => p.code)).toEqual(['PAL-DEMO-009']);
  });

  it('sem posição com endereço informado: agrupa pela fileira do endereço, ordena pelo número (não como texto) e mantém o resto em localização pendente', () => {
    const informado = (n: number, endereco: string) => ({ ...resumo(n, null), informedAddress: endereco });
    const comNome: Layout = { ...layout, elements: [...layout.elements, { ...layout.elements[0], id: '40000000-0000-4000-8000-000000000003', code: 'FB05', label: 'FB05', operationalName: 'Fileira 15', addressPrefix: '15' } as Layout['elements'][number]] };
    const grupos = agruparPaletes([informado(4, 'GR - 5'), informado(5, '15 - A120'), informado(6, '13 - A120'), informado(7, '15 - A99'), resumo(9, null), resumo(1, 1)], comNome);
    expect(grupos.map((g) => g.titulo)).toEqual(['F01', 'Fileira 13', 'Fileira 15', 'Fileira GR', 'Localização pendente']);
    expect(grupos[2]?.paletes.map((p) => p.informedAddress)).toEqual(['15 - A99', '15 - A120']);
    expect(grupos[2]?.subtitulo).toMatch(/posição no mapa pendente/);
    expect(grupos[4]?.paletes.map((p) => p.code)).toEqual(['PAL-DEMO-009']);
  });

  it('representa todos os paletes exatamente uma vez, mesmo sem layout', () => {
    for (const l of [layout, null]) {
      const ids = agruparPaletes(paletes, l).flatMap((g) => g.paletes.map((p) => p.id));
      expect(ids.sort()).toEqual(paletes.map((p) => p.id).sort());
    }
  });
});
