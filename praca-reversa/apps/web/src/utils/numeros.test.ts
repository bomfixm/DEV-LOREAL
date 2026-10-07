import { describe, expect, it } from 'vitest';
import { formatarQuantidade } from './numeros';

describe('quantidade decimal', () => {
  it('formata em pt-BR sem perder exatidão', () => {
    expect(formatarQuantidade('24')).toBe('24');
    expect(formatarQuantidade('1250.5')).toBe('1.250,5');
    expect(formatarQuantidade('1.250')).toBe('1,25');
    expect(formatarQuantidade('1234567890123.125')).toBe('1.234.567.890.123,125');
    expect(formatarQuantidade('0.001')).toBe('0,001');
    expect(formatarQuantidade('007')).toBe('7');
  });

  it('não reinterpreta valores fora do formato', () => {
    expect(formatarQuantidade('1e3')).toBe('1e3');
  });
});
