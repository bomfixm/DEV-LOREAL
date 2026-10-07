import { describe, expect, it } from 'vitest';
import { deslocarMes, formatarDataHora, mesAtual, nomeDoMes, paraEntradaLocal, paraIsoNoFuso } from './datas';

describe('datas', () => {
  it('apresenta UTC no fuso de São Paulo, em pt-BR', () => {
    expect(formatarDataHora('2026-10-02T12:00:00.000Z')).toMatch(/^02\/10\/2026,? 09:00$/);
    expect(formatarDataHora('2026-10-02T02:30:00.000Z')).toMatch(/^01\/10\/2026,? 23:30$/);
  });

  it('não inventa data para valor inválido', () => {
    expect(formatarDataHora('ontem')).toBe('data inválida');
    expect(paraIsoNoFuso('')).toBeNull();
    expect(paraIsoNoFuso('2026-10-07')).toBeNull();
    expect(paraEntradaLocal(null)).toBe('');
  });

  it('data/hora digitada no fuso da operação vira UTC e volta igual (janela de saída)', () => {
    expect(paraIsoNoFuso('2026-10-07T08:00')).toBe('2026-10-07T11:00:00.000Z');
    expect(paraIsoNoFuso('2026-10-07T23:30')).toBe('2026-10-08T02:30:00.000Z');
    expect(paraEntradaLocal('2026-10-08T02:30:00.000Z')).toBe('2026-10-07T23:30');
    expect(paraEntradaLocal(paraIsoNoFuso('2026-12-31T18:45'))).toBe('2026-12-31T18:45');
  });

  it('meses da visão mensal', () => {
    expect(deslocarMes('2026-12', 1)).toBe('2027-01');
    expect(deslocarMes('2026-01', -1)).toBe('2025-12');
    expect(mesAtual(Date.parse('2026-11-01T02:00:00Z'))).toBe('2026-10');
    expect(nomeDoMes('2026-10')).toBe('Outubro de 2026');
  });
});
