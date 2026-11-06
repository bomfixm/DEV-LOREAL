import { describe, expect, it } from 'vitest';
import { interpretarEtiqueta, totalIndicado } from './notas-foto.js';

const EXEMPLO = ['DHL', '000094123-1', 'Atacadao S.A', 'Loreal Brasil Com. Cosm. Ltda', '00001/00002', '7891234567890'].join('\n');

describe('leitura da etiqueta', () => {
  it('exemplo real: NF 94123 (sem juntar o sufixo), remetente Atacadao, nunca o destinatário', () => {
    const r = interpretarEtiqueta(EXEMPLO);
    expect(r).toMatchObject({ number: '94123', numberRaw: '000094123-1', sender: 'Atacadao S.A', reference: '1/2', candidates: [] });
  });

  it('a fração não indica FULL: sem evidência explícita o tipo fica pendente', () => {
    expect(interpretarEtiqueta(EXEMPLO).labelKind).toBeNull();
    expect(interpretarEtiqueta(`${EXEMPLO}\nFULL`).labelKind).toBe('FULL');
    expect(interpretarEtiqueta(`${EXEMPLO}\nVolumes: 01/02`).labelKind).toBe('COMUM');
  });

  it('FULL 00001/00002 não sugere volumes; comum 01/02 sugere total 2', () => {
    expect(totalIndicado('FULL', '1/2')).toBeNull();
    expect(totalIndicado(null, '1/2')).toBeNull();
    expect(totalIndicado('COMUM', '1/2')).toBe(2);
    expect(totalIndicado('COMUM', null)).toBeNull();
  });

  it('rótulo Remetente vence a posição; destinatário não preenche', () => {
    const r = interpretarEtiqueta(['000094123-1', 'Destinatario: Loreal Brasil', 'Remetente: Atacadao S.A'].join('\n'));
    expect(r.sender).toBe('Atacadao S.A');
    expect(interpretarEtiqueta(['000094123-1', 'Destinatario: Loreal Brasil'].join('\n')).sender).toBeNull();
  });

  it('não usa GTIN, chave, data ou código de barras como NF; caixa ao fundo sem faixa não dá remetente', () => {
    const r = interpretarEtiqueta(['7891234567890', '23260307216054000219550030086071341557111962', 'Emissao 10/11/2026', 'Shampoo Loreal Paris'].join('\n'));
    expect(r.number).toBeNull();
    expect(r.sender).toBeNull();
    expect(r.reference).toBeNull();
  });

  it('dois números possíveis: nenhum é escolhido, ficam para a revisão', () => {
    const r = interpretarEtiqueta(['000094123-1', 'Atacadao S.A', '000055555-2'].join('\n'));
    expect(r.number).toBeNull();
    expect(r.candidates).toEqual(['94123', '55555']);
  });

  it('NF rotulada sem faixa é aceita; sem ela e sem rótulo, nada é inventado', () => {
    expect(interpretarEtiqueta('NF 94123').number).toBe('94123');
    expect(interpretarEtiqueta('Nota Fiscal: 0094123').number).toBe('94123');
    expect(interpretarEtiqueta('qualquer texto 12345').number).toBeNull();
    expect(interpretarEtiqueta('')).toMatchObject({ number: null, sender: null, reference: null, labelKind: null });
  });

  it('data dd/mm/aaaa não é referência; fração inválida também não', () => {
    expect(interpretarEtiqueta('10/11/2026').reference).toBeNull();
    expect(interpretarEtiqueta('5/2').reference).toBeNull();
    expect(interpretarEtiqueta('0/2').reference).toBeNull();
    expect(interpretarEtiqueta('01/02').reference).toBe('1/2');
  });
});
