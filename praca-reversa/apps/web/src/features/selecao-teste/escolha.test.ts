import { describe, expect, it } from 'vitest';
import { avaliarEscolha } from './escolha';

describe('avaliarEscolha (seleção cliente — teste)', () => {
  it('13 volumes de uma nota com 100: quantidade definida', () => {
    expect(avaliarEscolha({ volumes: 100, delivery: null }, { quantidade: '13', delivery: '8000123' })).toEqual({ volumes: 13, erro: null, analise: null });
  });

  it('acima do informado, fração, zero e vazio sem motivo são recusados', () => {
    expect(avaliarEscolha({ volumes: 3, delivery: null }, { quantidade: '4', delivery: '' }).erro).toContain('Acima dos 3 volumes');
    expect(avaliarEscolha({ volumes: 3, delivery: null }, { quantidade: '2.5', delivery: '' }).erro).toContain('inteiro');
    expect(avaliarEscolha({ volumes: 3, delivery: null }, { quantidade: '0', delivery: '' }).erro).toContain('mínima');
    expect(avaliarEscolha({ volumes: 3, delivery: null }, { quantidade: '', delivery: '' }).erro).toContain('de 1 a 3');
  });

  it('Delivery sem volumes discriminados: sem quantidade vai para análise, sem atribuir o total da nota', () => {
    const r = avaliarEscolha({ volumes: 100, delivery: null }, { quantidade: '', delivery: '8000999' });
    expect(r).toMatchObject({ volumes: null, erro: null });
    expect(r.analise).toContain('não é atribuído');
    // A mesma Delivery já cadastrada na nota não é "nova": precisa de quantidade.
    expect(avaliarEscolha({ volumes: 6, delivery: 'D-02' }, { quantidade: '', delivery: 'd-02' }).erro).not.toBeNull();
  });

  it('nota sem volume informado: quantidade desconhecida não vira zero', () => {
    expect(avaliarEscolha({ volumes: null, delivery: null }, { quantidade: '', delivery: '' })).toMatchObject({ volumes: null, erro: null });
    expect(avaliarEscolha({ volumes: null, delivery: null }, { quantidade: '5', delivery: '' })).toMatchObject({ volumes: 5, erro: null });
  });
});
