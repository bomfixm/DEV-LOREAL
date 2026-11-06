import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { celulasDaLinha, janelaLida, lerPlanilhaSeparacao } from './ler-planilha';

const REAL = 'C:/Users/Administrator/Downloads/Separação Litigio - janela 10.11.xlsx';

describe('leitura da planilha da separação no navegador', () => {
  it('lê texto compartilhado, número, texto em linha e ignora célula vazia formatada', () => {
    const c = celulasDaLinha('<c r="A2" s="1"/><c r="B2" t="s"><v>1</v></c><c r="D2"><v>1545525</v></c><c r="E2" t="inlineStr"><is><t>A &amp; B</t></is></c><c r="F2"><v>7.0</v></c>', ['x', 'NFD']);
    expect([...c]).toEqual([
      [1, 'NFD'],
      [3, '1545525'],
      [4, 'A & B'],
      [5, '7'],
    ]);
  });

  it('janela em número de série do Excel vira data; texto fica como veio', () => {
    expect(janelaLida('46336')).toBe('2026-11-10');
    expect(janelaLida('10/11')).toBe('10/11');
  });

  it.skipIf(!existsSync(REAL))('lê a planilha real de 6 MB e devolve só as 33 notas, em tamanho que cabe no envio', async () => {
    const r = await lerPlanilhaSeparacao(new Blob([readFileSync(REAL)]), 'real.xlsx');
    expect(r.window).toBe('2026-11-10');
    expect(r.notes).toHaveLength(33);
    expect(r.notes[0]).toMatchObject({ row: 2, number: '1545525', type: 'NFD', informedPallet: '1002', informedAddress: '13 - A126', volumes: '6', sender: 'LOJAS RENNER SA' });
    expect(r.headers).toContain('CHAVE DE ACESSO');
    expect(r.notes[0]?.values).toMatchObject({ 'N DO PALETE': '1002', NFD: '8607134', ORDEM: '60801133', JANELA: '2026-11-10', CP: 'Separar - Nota de litigio', 'CHAVE DE ACESSO': '23260307216054000219550030086071341557111962' });
    expect(r.notes[32]).toMatchObject({ row: 34, number: '1323004', informedPallet: '56' });
    expect(JSON.stringify(r).length).toBeLessThan(100_000);
  }, 120_000);

  it('recusa arquivo que não é xlsx', async () => {
    await expect(lerPlanilhaSeparacao(new Blob(['texto qualquer que nao e zip nenhum, com mais de vinte e dois bytes']), 'x.xlsx')).rejects.toThrow(/não é uma planilha/);
  });
});
