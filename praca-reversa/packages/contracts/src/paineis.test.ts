import { describe, expect, it } from 'vitest';
import { RegistrarSeparacaoVolumesSchema, SEM_BASE, SEM_META, progressoParaCliente, progressoVolumes } from './paineis.js';

describe('progresso da janela em volumes (T, P, E sem dupla contagem)', () => {
  it('exemplo fictício: meta 8.000, expedidos 2.000, separados aguardando 4.500', () => {
    const r = progressoVolumes(8000, 4500, 2000);
    expect(r).toMatchObject({
      requested: 8000,
      separatedWaiting: 4500,
      shipped: 2000,
      prepared: 6500,
      missingToSeparate: 1500,
      missingToShip: 6000,
      preparationPercent: '81.25',
      shippingPercent: '25.00',
      basisNote: null,
      excessPrepared: null,
      excessShipped: null,
    });
  });

  it('expedir 1.000 do separado: P 3.500, E 3.000, preparados e falta separar iguais, falta expedir 5.000', () => {
    const r = progressoVolumes(8000, 4500 - 1000, 2000 + 1000);
    expect(r).toMatchObject({
      separatedWaiting: 3500,
      shipped: 3000,
      prepared: 6500,
      missingToSeparate: 1500,
      missingToShip: 5000,
      preparationPercent: '81.25',
      shippingPercent: '37.50',
    });
  });

  it('sem meta: nenhuma porcentagem e faltantes desconhecidos (nunca zero)', () => {
    const r = progressoVolumes(null, 10, 0);
    expect(r).toMatchObject({
      requested: null,
      missingToSeparate: null,
      missingToShip: null,
      preparationPercent: null,
      shippingPercent: null,
      basisNote: SEM_META,
    });
  });

  it('meta zero: "Sem base para cálculo", sem porcentagem', () => {
    const r = progressoVolumes(0, 0, 0);
    expect(r.preparationPercent).toBeNull();
    expect(r.shippingPercent).toBeNull();
    expect(r.basisNote).toBe(SEM_BASE);
    expect(progressoVolumes(0, 5, 0).excessPrepared).toBe(5);
  });

  it('excesso preservado na visão interna e omitido na do cliente', () => {
    const r = progressoVolumes(100, 30, 90);
    expect(r).toMatchObject({
      prepared: 120,
      missingToSeparate: 0,
      missingToShip: 10,
      preparationPercent: '120.00',
      excessPrepared: 20,
      excessShipped: null,
    });
    const cliente = progressoParaCliente(r);
    expect(cliente).toMatchObject({ prepared: 120 });
    expect(Object.keys(cliente)).not.toContain('excessPrepared');
    expect(Object.keys(cliente)).not.toContain('excessShipped');
  });

  it('rejeita volumes fracionários ou negativos (sem arredondar)', () => {
    expect(() => progressoVolumes(10.5, 0, 0)).toThrow(RangeError);
    expect(() => progressoVolumes(10, -1, 0)).toThrow(RangeError);
  });

  it('separação exige exatamente um conteúdo e volumes inteiros positivos', () => {
    expect(RegistrarSeparacaoVolumesSchema.safeParse({ volumes: 3 }).success).toBe(false);
    expect(
      RegistrarSeparacaoVolumesSchema.safeParse({
        linkId: '6f1c1f9e-8d7e-4c7a-9b6a-1d2e3f4a5b6c',
        contentId: '7f1c1f9e-8d7e-4c7a-9b6a-1d2e3f4a5b6c',
        volumes: 3,
      }).success,
    ).toBe(false);
    expect(
      RegistrarSeparacaoVolumesSchema.safeParse({
        linkId: '6f1c1f9e-8d7e-4c7a-9b6a-1d2e3f4a5b6c',
        volumes: 2.5,
      }).success,
    ).toBe(false);
    expect(
      RegistrarSeparacaoVolumesSchema.safeParse({
        linkId: '6f1c1f9e-8d7e-4c7a-9b6a-1d2e3f4a5b6c',
        volumes: 3,
      }).success,
    ).toBe(true);
  });
});
