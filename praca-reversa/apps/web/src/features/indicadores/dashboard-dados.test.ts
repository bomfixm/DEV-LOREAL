import type { Indicadores } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import { barrasConferencia, intervaloCurto, pontosDeAtencao, textoPercentual, usoPosicoes } from './dashboard-dados';

/** Resposta fictícia mínima (mesma forma da API); cada teste muda só o que importa. */
function indicadores(mudar: (d: Indicadores) => void = () => undefined): Indicadores {
  const d: Indicadores = {
    scope: { id: '00000000-0000-4000-8000-000000000001', name: 'Escopo fictício', demo: true },
    period: { start: '2026-10-01', end: '2026-10-22', timezone: 'America/Sao_Paulo', startUtc: '2026-10-01T03:00:00.000Z', endUtc: '2026-10-23T03:00:00.000Z', includesToday: true },
    consultedAt: '2026-10-22T12:00:00.000Z',
    positionsBasis: { label: 'Base', provisional: false, layout: { name: 'Layout', revision: 2, schematic: false, totalCapacity: null, provisionalCodes: 0 }, changesInPeriod: 0 },
    praca: {
      palletsInStock: 10,
      palletsReserved: 0,
      palletsWithPosition: 10,
      palletsLocationPending: 0,
      positions: { registered: 30, eligible: 20, occupied: 10, free: 10, unavailable: 10, unavailableOccupied: 0 },
      occupancyPercent: '50.0',
      occupancyNote: 'Ocupação sobre as posições elegíveis do layout ativo.',
      drawnAreas: { zones: 1, blocks: 2, corridors: 1, docks: 1 },
      period: { registered: 4, moves: 12, retiredEmpty: 0, shippedWhole: 0 },
    },
    conferencia: {
      byState: { NAO_CONFERIDO: 6, PARCIAL: 2, AGUARDANDO_VALIDACAO: 0, RECONCILIADO: 2 },
      activeCounts: 1,
      pendingObservations: 0,
      period: { started: 1, concluded: 0, reconciled: 0, recounts: 0, cancelled: 0 },
    },
    estoque: {
      current: [],
      palletsWithUnknownContent: 0,
      documentary: { declaredOnPallets: [], importedDocuments: [] },
      flow: [],
      returns: { physical: 0, physicalQuantity: [], notices: 0 },
    },
    claims: null,
    valores: null,
    janelas: null,
    idade: { byMonth: [], withoutEntryDate: [], documentReference: { lines: 0, oldest: null, newest: null } },
    restricted: ['claims', 'valores', 'janelas'],
    unavailable: [],
  };
  mudar(d);
  return d;
}

describe('dashboard de indicadores: dados derivados', () => {
  it('período curto repete o ano só quando muda', () => {
    expect(intervaloCurto({ start: '2026-10-01', end: '2026-10-22' })).toBe('01/10 a 22/10/2026');
    expect(intervaloCurto({ start: '2025-12-15', end: '2026-01-10' })).toBe('15/12/2025 a 10/01/2026');
    expect(intervaloCurto({ start: '2026-10-22', end: '2026-10-22' })).toBe('22/10/2026');
  });

  it('sem base não há porcentagem (nunca "0%")', () => {
    expect(textoPercentual('96.4')).toBe('96,4%');
    expect(textoPercentual(null)).toBeNull();
  });

  it('uso das posições: ocupadas e livres da mesma base; indisponíveis fora do gráfico', () => {
    const d = indicadores();
    if (d.praca === null) throw new Error('praça');
    const uso = usoPosicoes(d.praca);
    expect(uso).toEqual({ base: 20, ocupadas: 10, livres: 10, indisponiveis: 10, indisponiveisComPalete: 0, fracao: 0.5 });
    // Partes do gráfico somam a base (elegíveis), não as cadastradas (elegíveis + indisponíveis).
    expect((uso?.ocupadas ?? 0) + (uso?.livres ?? 0)).toBe(uso?.base);
    d.praca.positions = null;
    expect(usoPosicoes(d.praca)).toBeNull();
    const semElegiveis = indicadores((x) => {
      if (x.praca?.positions) x.praca.positions = { registered: 5, eligible: 0, occupied: 0, free: 0, unavailable: 5, unavailableOccupied: 0 };
    });
    expect(semElegiveis.praca && usoPosicoes(semElegiveis.praca)?.fracao).toBeNull();
  });

  it('barras de conferência: só estados de paletes (exclusivos), sem somar sessões ou observações', () => {
    const d = indicadores();
    if (d.conferencia === null) throw new Error('conferência');
    const { total, barras } = barrasConferencia(d.conferencia);
    expect(total).toBe(10);
    expect(barras.map((b) => [b.estado, b.valor, b.fracao])).toEqual([
      ['NAO_CONFERIDO', 6, 0.6],
      ['PARCIAL', 2, 0.2],
      ['AGUARDANDO_VALIDACAO', 0, 0],
      ['RECONCILIADO', 2, 0.2],
    ]);
    const vazio = barrasConferencia({ ...d.conferencia, byState: { NAO_CONFERIDO: 0, PARCIAL: 0, AGUARDANDO_VALIDACAO: 0, RECONCILIADO: 0 } });
    expect(vazio.barras.every((b) => b.fracao === 0)).toBe(true);
  });

  it('pontos de atenção vêm só dos números: contagem zero não gera ponto', () => {
    expect(pontosDeAtencao(indicadores())).toEqual([]);
    const d = indicadores((x) => {
      x.positionsBasis = { ...x.positionsBasis, provisional: true, changesInPeriod: 3 };
      if (x.praca) x.praca.palletsLocationPending = 1;
      if (x.estoque) x.estoque.palletsWithUnknownContent = 8;
      if (x.conferencia) x.conferencia.byState.AGUARDANDO_VALIDACAO = 2;
    });
    const pontos = pontosDeAtencao(d);
    expect(pontos.map((p) => p.chave)).toEqual(['base', 'configuracao', 'localizacao', 'desconhecido', 'aguardando']);
    expect(pontos.find((p) => p.chave === 'configuracao')?.texto).toContain('mudou 3 vezes no período');
    expect(pontos.find((p) => p.chave === 'localizacao')?.texto).toBe('1 palete com localização pendente.');
    expect(pontos.find((p) => p.chave === 'localizacao')?.relatorio).toEqual({ tipo: 'paletes', localizacao: 'PENDENTE' });
    // Conteúdo desconhecido não tem relatório com a mesma definição: nenhum atalho que mostre outra lista.
    expect(pontos.find((p) => p.chave === 'desconhecido')?.relatorio).toBeUndefined();
  });

  it('fluxo que não fecha vira alerta; áreas fora do perfil não geram ponto', () => {
    const d = indicadores((x) => {
      x.estoque = null;
      x.conferencia = null;
      x.praca = null;
    });
    expect(pontosDeAtencao(d)).toEqual([]);
    const fluxo = indicadores((x) => {
      x.estoque?.flow.push({
        unit: 'UN',
        opening: '1',
        entries: '0',
        entriesFromReturns: '0',
        exits: '0',
        adjustments: '0',
        transfersMoved: '0',
        transfersNet: '0',
        closing: '2',
        current: '2',
        consistent: false,
        events: { entries: 0, exits: 0, adjustments: 0, transfers: 0 },
      });
    });
    expect(pontosDeAtencao(fluxo)[0]).toMatchObject({ chave: 'fluxo-UN', tom: 'alerta' });
  });
});
