import { describe, expect, it } from 'vitest';
import { interpretarCodigos, interpretarEtiqueta, totalIndicado } from './notas-foto.js';

const EXEMPLO = ['DHL', '000094123-1', 'Atacadao S.A', 'Loreal Brasil Com. Cosm. Ltda', '00001/00002', '7891234567890'].join('\n');

describe('leitura da etiqueta', () => {
  it('exemplo real: NF 94123 (sem juntar o sufixo), remetente Atacadao, nunca o destinatário', () => {
    const r = interpretarEtiqueta(EXEMPLO);
    expect(r).toMatchObject({ number: '94123', numberRaw: '000094123-1', sender: 'Atacadao S.A', reference: '1/2', candidates: [] });
  });

  it('a fração não indica FULL: sem evidência explícita o tipo fica pendente', () => {
    expect(interpretarEtiqueta(EXEMPLO).labelKind).toBeNull();
    expect(interpretarEtiqueta(`${EXEMPLO}\nFULL`).labelKind).toBe('FULL');
    // "Volumes" aparece também na etiqueta FULL: não é evidência de comum.
    expect(interpretarEtiqueta(`${EXEMPLO}\nVolumes: 01/02`).labelKind).toBeNull();
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

  it('etiqueta DHL real: NF do código de barras, volume 22 de 24; texto rotulado com zeros', () => {
    expect(interpretarCodigos(['12040854711-1-1545732-24-LOU-22'])).toEqual({ number: '1545732', reference: '22/24', delivery: null, raw: '12040854711-1-1545732-24-LOU-22' });
    expect(interpretarEtiqueta('NF:001545732-').number).toBe('1545732');
    expect(interpretarEtiqueta("Remetente: L'oreal Brasil Com. Cosm. Ltda\nDestinatario: Outra Empresa Ltda").sender).toBe("L'oreal Brasil Com. Cosm. Ltda");
  });

  it('etiqueta L\'Oréal real: Cl é o remetente e Dlv é a delivery; Load e Carton não entram', () => {
    const r = interpretarEtiqueta(['É. Cl: CLIENTE TESTE LOPES', 'End: RUA TESTE 27', 'CEP: 20274-480', 'ID: 2025114037'].join('\n'));
    expect(r.sender).toBe('CLIENTE TESTE LOPES');
    expect(interpretarEtiqueta('à Gl: CLIENTE TESTE LOPES').sender).toBe('CLIENTE TESTE LOPES');
    expect(interpretarEtiqueta('CEP: 202/0450 Estado: RJ').reference).toBeNull();
    expect(interpretarEtiqueta('DI! v: 89341 358').delivery).toBe('89341358');
    expect(interpretarEtiqueta('Dlv: 89341358').delivery).toBe('89341358');
    expect(interpretarCodigos(['0003891659', '00100203100054140812']).delivery).toBeNull();
    expect(interpretarCodigos(['0003891659', '89341358']).delivery).toBe('89341358');
  });

  it('data dd/mm/aaaa não é referência; fração inválida também não', () => {
    expect(interpretarEtiqueta('10/11/2026').reference).toBeNull();
    expect(interpretarEtiqueta('5/2').reference).toBeNull();
    expect(interpretarEtiqueta('0/2').reference).toBeNull();
    expect(interpretarEtiqueta('01/02').reference).toBe('1/2');
  });
});
