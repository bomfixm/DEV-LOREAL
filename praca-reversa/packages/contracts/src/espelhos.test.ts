import { describe, expect, it } from 'vitest';
import { decomporEnderecoEspelho, FiltroEspelhosSchema, selecionarEspelhos } from './espelhos.js';
const opcoes = [101, 102, 103, 104].map((n) => ({ id: String(n), code: String(n), address: `15 - A${String(n)}`, row: '15', number: n }));
describe('seleção de espelhos', () => {
  it('interpreta endereços reais e preserva pendências', () => {
    expect(decomporEnderecoEspelho('15 - A101')).toEqual({ row: '15', number: 101 });
    expect(decomporEnderecoEspelho('GR15')).toEqual({ row: 'GR', number: 15 });
    expect(decomporEnderecoEspelho('FB05-A01')).toEqual({ row: null, number: null });
    expect(decomporEnderecoEspelho(null)).toEqual({ row: null, number: null });
  });
  it('imprime ímpares crescentes e pares decrescentes da rua escolhida', () => {
    expect(selecionarEspelhos(opcoes, '15', 'impares').map((p) => p.number)).toEqual([101, 103]);
    expect(selecionarEspelhos(opcoes, '15', 'pares').map((p) => p.number)).toEqual([104, 102]);
    expect(selecionarEspelhos(opcoes, '16', 'todos')).toEqual([]);
  });
  it('recusa filtro vazio, combinação ambígua e IDs inválidos', () => {
    for (const f of [{}, { ids: 'errado' }, { rows: '15', side: 'outro' }, { rows: '15', ids: '00000000-0000-4000-8000-000000000001' }]) expect(FiltroEspelhosSchema.safeParse(f).success).toBe(false);
  });
});
