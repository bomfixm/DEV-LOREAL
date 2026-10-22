import { describe, expect, it } from 'vitest';
import { apresentarVolumes, textoSequenciaFull, volumesDoPalete } from './volumes';

describe('apresentarVolumes', () => {
  it('contados iguais aos previstos: um único valor', () => {
    expect(apresentarVolumes('10', '10')).toEqual({ texto: '10 volumes', situacao: 'iguais', legenda: null });
  });

  it('divergência mostra contados / previstos, identificados', () => {
    expect(apresentarVolumes('8', '10')).toEqual({ texto: '8 / 10 volumes', situacao: 'falta', legenda: 'contados / previstos' });
    expect(apresentarVolumes('12', '10')).toEqual({ texto: '12 / 10 volumes', situacao: 'excesso', legenda: 'contados / previstos' });
  });

  it('previsto ausente: mostra o contado e "previsto não informado" (nunca copia o contado)', () => {
    expect(apresentarVolumes('7', null)).toEqual({ texto: '7 volumes · previsto não informado', situacao: 'sem-previsto', legenda: null });
    // Zero contado continua zero (não vira pendência).
    expect(apresentarVolumes('0', null).texto).toBe('0 volumes · previsto não informado');
  });

  it('contagem ausente é pendência, nunca zero', () => {
    expect(apresentarVolumes(null, null)).toEqual({ texto: 'Aguardando conferência', situacao: 'pendente', legenda: null });
    expect(apresentarVolumes(null, '10').texto).toBe('Aguardando conferência · 10 previstos');
    expect(apresentarVolumes(null, '10').texto).not.toMatch(/\b0 volumes\b/);
  });
});

describe('volumesDoPalete', () => {
  it('soma só as contagens dos conteúdos deste palete e conta os que aguardam', () => {
    expect(volumesDoPalete([{ count: { counted: '4' } }, { count: { counted: '6' } }, { count: { counted: null } }])).toEqual({ total: '10', pendentes: 1 });
  });

  it('nenhuma contagem: total pendente (não zero)', () => {
    expect(volumesDoPalete([{ count: { counted: null } }])).toEqual({ total: null, pendentes: 1 });
    expect(volumesDoPalete([])).toEqual({ total: null, pendentes: 0 });
  });
});

describe('textoSequenciaFull', () => {
  it('apresenta o marcador da planilha como posição no conjunto', () => {
    expect(textoSequenciaFull('01\\07')).toBe('1/7');
    expect(textoSequenciaFull('7/9')).toBe('7/9');
    expect(textoSequenciaFull('01\\02 02\\02')).toBe('1/2 e 2/2');
  });

  it('vazio = não informado; texto fora do padrão fica como informado', () => {
    expect(textoSequenciaFull(null)).toBeNull();
    expect(textoSequenciaFull('  ')).toBeNull();
    expect(textoSequenciaFull('SIM')).toBe('SIM');
  });
});
