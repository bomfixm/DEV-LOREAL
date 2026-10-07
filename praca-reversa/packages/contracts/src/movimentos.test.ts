import { describe, expect, it } from 'vitest';
import { CorrigirLocalizacaoSchema, CorrigirTransferenciaSchema, MoverPaleteSchema, TransferirSchema } from './index.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const S = '40000000-0000-4000-8000-000000000001';

const transferencia = {
  sourcePalletId: A,
  destinationPalletId: B,
  segmentId: S,
  quantity: '8',
  expectedSourceVersion: 3,
  expectedDestinationVersion: 5,
  reason: 'Consolidação',
};

describe('transferência', () => {
  it('quantidade positiva, exata, em texto; erro de formato não derruba a validação', () => {
    expect(TransferirSchema.safeParse(transferencia).success).toBe(true);
    expect(TransferirSchema.safeParse({ ...transferencia, quantity: '1.5' }).success).toBe(true);
    for (const quantity of ['0', '0.000', '-1', '2.0001', 'abc', '', 8]) {
      expect(TransferirSchema.safeParse({ ...transferencia, quantity }).success).toBe(false);
    }
  });

  it('origem e destino precisam ser paletes diferentes; motivo obrigatório', () => {
    expect(TransferirSchema.safeParse({ ...transferencia, destinationPalletId: A }).success).toBe(false);
    expect(TransferirSchema.safeParse({ ...transferencia, reason: ' ' }).success).toBe(false);
    expect(TransferirSchema.safeParse({ ...transferencia, expectedSourceVersion: 0 }).success).toBe(false);
  });

  it('correção: quantidade positiva e versões dos dois paletes', () => {
    const correcao = { quantity: '3', expectedSourceVersion: 4, expectedDestinationVersion: 6, reason: 'Transferido a mais' };
    expect(CorrigirTransferenciaSchema.safeParse(correcao).success).toBe(true);
    expect(CorrigirTransferenciaSchema.safeParse({ ...correcao, quantity: '0' }).success).toBe(false);
    expect(CorrigirTransferenciaSchema.safeParse({ ...correcao, expectedDestinationVersion: undefined }).success).toBe(false);
  });
});

describe('mudança de localização', () => {
  it('código confirmado normalizado em maiúsculas; posição pelo ID permanente', () => {
    const r = MoverPaleteSchema.parse({ destinationPositionId: S, confirmedPositionCode: ' f03-p09 ', expectedVersion: 2, reason: 'Reorganização' });
    expect(r.confirmedPositionCode).toBe('F03-P09');
    expect(MoverPaleteSchema.safeParse({ destinationPositionId: 'F03-P09', confirmedPositionCode: 'F03-P09', expectedVersion: 2, reason: 'Reorganização' }).success).toBe(
      false,
    );
  });

  it('correção de localização: posição e código juntos, ou ambos nulos (volta à localização pendente)', () => {
    const base = { expectedVersion: 3, reason: 'Posição errada' };
    expect(CorrigirLocalizacaoSchema.safeParse({ ...base, destinationPositionId: S, confirmedPositionCode: 'F05-P04' }).success).toBe(true);
    expect(CorrigirLocalizacaoSchema.safeParse({ ...base, destinationPositionId: null, confirmedPositionCode: null }).success).toBe(true);
    expect(CorrigirLocalizacaoSchema.safeParse({ ...base, destinationPositionId: S, confirmedPositionCode: null }).success).toBe(false);
  });
});
