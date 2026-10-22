import { describe, expect, it } from 'vitest';
import { DIAS_RECONFERENCIA, situacaoReconferencia, type RelogioPalete } from './reconferencia.js';

const DIA = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-10-01T12:00:00.000Z');
const em = (dias: number, ms = 0) => new Date(T0.getTime() + dias * DIA + ms);
const base: RelogioPalete = { inicioEm: T0, inicioOrigem: 'CADASTRO', ultimaMovimentacaoEm: null, ultimaMovimentacaoTipo: null, ultimaReconferenciaEm: null, ultimaReconferenciaOrigem: null };

describe('situacaoReconferencia', () => {
  it('20 períodos completos de 24 horas: um milissegundo antes não vence, o limite exato já vence', () => {
    expect(DIAS_RECONFERENCIA).toBe(20);
    expect(situacaoReconferencia(base, em(20, -1))).toMatchObject({ due: false, daysUntilDue: 1, daysWithoutMovement: 19, nextAt: em(20).toISOString() });
    expect(situacaoReconferencia(base, em(20))).toMatchObject({ due: true, daysUntilDue: 0, daysWithoutMovement: 20 });
    expect(situacaoReconferencia(base, em(0))).toMatchObject({ due: false, daysUntilDue: 20, daysWithoutMovement: 0 });
  });

  it('a base é o mais recente entre entrada, movimentação e reconferência completa', () => {
    const movido = { ...base, ultimaMovimentacaoEm: em(10), ultimaMovimentacaoTipo: 'MOVIMENTO' as const };
    expect(situacaoReconferencia(movido, em(25))).toMatchObject({ due: false, nextAt: em(30).toISOString(), daysWithoutMovement: 15 });
    // Movimentação anterior à entrada (dado antigo) não puxa a base para trás.
    expect(situacaoReconferencia({ ...base, ultimaMovimentacaoEm: em(-5), ultimaMovimentacaoTipo: 'MOVIMENTO' }, em(20)).due).toBe(true);
  });

  it('reconferência reinicia o prazo, mas os dias sem movimentação continuam contando desde a última movimentação ou entrada', () => {
    const reconferido = { ...base, ultimaReconferenciaEm: em(15), ultimaReconferenciaOrigem: 'RECONFERENCIA_VOLUMES' as const };
    expect(situacaoReconferencia(reconferido, em(25))).toMatchObject({ due: false, nextAt: em(35).toISOString(), daysWithoutMovement: 25, daysUntilDue: 10 });
  });

  it('reconferência exigida por decisão: necessária já, com o motivo, até uma reconferência completa posterior', () => {
    const exigida = { ...base, exigidaEm: em(3), exigidaMotivo: 'Notas de linhas em revisão: conferir o palete.' };
    expect(situacaoReconferencia(exigida, em(4))).toMatchObject({ due: true, daysUntilDue: 0, required: { at: em(3).toISOString(), reason: 'Notas de linhas em revisão: conferir o palete.' } });
    // Reconferência completa anterior à exigência não a atende; posterior atende e o prazo volta a contar dela.
    expect(situacaoReconferencia({ ...exigida, ultimaReconferenciaEm: em(2), ultimaReconferenciaOrigem: 'RECONFERENCIA_VOLUMES' }, em(4)).due).toBe(true);
    expect(situacaoReconferencia({ ...exigida, ultimaReconferenciaEm: em(5), ultimaReconferenciaOrigem: 'RECONFERENCIA_VOLUMES' }, em(6))).toMatchObject({ due: false, required: null, nextAt: em(25).toISOString() });
    expect(situacaoReconferencia(base, em(4)).required).toBeNull();
  });
});
