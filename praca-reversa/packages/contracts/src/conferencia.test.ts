import { describe, expect, it } from 'vitest';
import {
  CancelarConferenciaSchema,
  ConcluirConferenciaSchema,
  EmbalagemProdutoSchema,
  IniciarConferenciaSchema,
  NovaObservacaoSchema,
  compararQuantidades,
  deMilesimos,
  ehQuantidadeInteira,
  multiplicarExato,
  normalizarQuantidade,
  paraMilesimos,
  somarQuantidades,
  subtrairQuantidades,
  verificarEmbalagens,
} from './index.js';

describe('quantidades decimais exatas', () => {
  it('converte texto em milésimos e de volta, sem ponto flutuante', () => {
    expect(paraMilesimos('12')).toBe(12_000n);
    expect(paraMilesimos('0.001')).toBe(1n);
    expect(paraMilesimos('-3.5')).toBe(-3_500n);
    expect(deMilesimos(12_500n)).toBe('12.5');
    expect(deMilesimos(-3_000n)).toBe('-3');
    expect(normalizarQuantidade('12.000')).toBe('12');
    expect(() => paraMilesimos('1e3')).toThrow();
    expect(() => paraMilesimos('1.2345')).toThrow();
  });

  it('soma, subtrai e compara exatamente (0,1 + 0,2 = 0,3)', () => {
    expect(somarQuantidades(['0.1', '0.2'])).toBe('0.3');
    expect(somarQuantidades([])).toBe('0');
    expect(subtrairQuantidades('9', '12')).toBe('-3');
    expect(compararQuantidades('0.3', somarQuantidades(['0.1', '0.2']))).toBe(0);
    expect(compararQuantidades('2', '10')).toBe(-1);
  });

  it('multiplica exatamente ou devolve null quando precisaria arredondar', () => {
    expect(multiplicarExato('1', '12')).toBe('12');
    expect(multiplicarExato('3', '0.5')).toBe('1.5');
    expect(multiplicarExato('0.333', '3')).toBe('0.999');
    expect(multiplicarExato('0.5', '0.333')).toBeNull();
    expect(multiplicarExato('999999999999999', '10')).toBeNull();
    expect(ehQuantidadeInteira('24')).toBe(true);
    expect(ehQuantidadeInteira('1.5')).toBe(false);
  });
});

describe('entradas da conferência', () => {
  it('parcial exige descrição do que será conferido; completa não', () => {
    expect(IniciarConferenciaSchema.safeParse({ scope: 'PARCIAL', scopeDescription: null, expectedVersion: 1 }).success).toBe(false);
    expect(IniciarConferenciaSchema.safeParse({ scope: 'PARCIAL', scopeDescription: 'Camada de cima', expectedVersion: 1 }).success).toBe(true);
    expect(IniciarConferenciaSchema.safeParse({ scope: 'COMPLETA', expectedVersion: 1 }).success).toBe(true);
  });

  it('leitura vale 1 e não aceita quantidade; manual exige quantidade e unidade; códigos e lotes ficam texto', () => {
    const leitura = NovaObservacaoSchema.parse({ mode: 'LEITURA_UNIDADE', code: ' 0007891234567 ', condition: 'SAUDAVEL' });
    expect(leitura).toMatchObject({ code: '0007891234567', quantity: null, lot: null, originType: null, registerAsPending: false });
    expect(NovaObservacaoSchema.safeParse({ mode: 'LEITURA_EMBALAGEM', code: '1', quantity: '2', condition: 'SAUDAVEL' }).success).toBe(false);
    expect(NovaObservacaoSchema.safeParse({ mode: 'LEITURA_UNIDADE', condition: 'SAUDAVEL' }).success).toBe(false);
    expect(NovaObservacaoSchema.safeParse({ mode: 'MANUAL', code: '1', quantity: '2', condition: 'SAUDAVEL' }).success).toBe(false);
    const manual = NovaObservacaoSchema.parse({ mode: 'MANUAL', code: '000123', quantity: '2', unit: 'cx', lot: '0042', condition: 'SAUDAVEL' });
    expect([manual.unit, manual.lot, manual.code]).toEqual(['CX', '0042', '000123']);
  });

  it('peças inteiras, quantidade positiva, referência de origem com tipo e condição explícita', () => {
    const base = { mode: 'MANUAL', code: '1', unit: 'UN', condition: 'SAUDAVEL' };
    expect(NovaObservacaoSchema.safeParse({ ...base, quantity: '1.5' }).success).toBe(false);
    expect(NovaObservacaoSchema.safeParse({ ...base, quantity: '0' }).success).toBe(false);
    expect(NovaObservacaoSchema.safeParse({ ...base, quantity: '1', originReference: 'NF-1' }).success).toBe(false);
    expect(NovaObservacaoSchema.safeParse({ ...base, quantity: '1', condition: undefined }).success).toBe(false);
    expect(NovaObservacaoSchema.safeParse({ ...base, quantity: '1.5', unit: 'KG' }).success).toBe(true);
  });

  it('conclusão e cancelamento exigem revisão vista; cancelamento exige motivo', () => {
    expect(ConcluirConferenciaSchema.parse({ expectedRevision: 3, expectedPalletVersion: 2 }).confirmFullScope).toBe(false);
    expect(CancelarConferenciaSchema.safeParse({ expectedRevision: 1, reason: '  ' }).success).toBe(false);
    expect(CancelarConferenciaSchema.safeParse({ expectedRevision: 1, reason: 'Palete errado' }).success).toBe(true);
  });

  it('embalagem pode ter fator desconhecido (pendente), mas a unidade canônica tem fator 1', () => {
    expect(EmbalagemProdutoSchema.parse({ code: '0017890000456', packaging: 'CX', factor: null }).factor).toBeNull();
    expect(verificarEmbalagens({ canonicalUnit: 'UN', barcodes: [{ code: '1', packaging: 'CX', factor: null }] })).toEqual([]);
    expect(verificarEmbalagens({ canonicalUnit: 'UN', barcodes: [{ code: '1', packaging: 'UN', factor: null }] })).toHaveLength(1);
    expect(verificarEmbalagens({ canonicalUnit: 'UN', barcodes: [{ code: '1', packaging: 'CX', factor: '1.5' }] })).toHaveLength(1);
  });
});
