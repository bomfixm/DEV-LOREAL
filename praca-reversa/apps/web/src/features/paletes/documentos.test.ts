import { describe, expect, it } from 'vitest';
import { agruparDocumentos, contarDocumentos } from './documentos';
import { volumesDoPalete } from './volumes';

interface Item {
  documentType: string | null;
  documentNumber: string | null;
  delivery: string | null;
  state?: string;
  count: { counted: string | null };
}

const item = (campos: Partial<Item>): Item => ({ documentType: 'NF', documentNumber: '000123', delivery: null, count: { counted: null }, ...campos });

describe('agruparDocumentos', () => {
  it('uma NF com duas Deliveries: 1 documento, 2 parcelas com os volumes de cada uma', () => {
    const itens = [item({ delivery: 'DLV-1', count: { counted: '3' } }), item({ delivery: 'DLV-2', count: { counted: '7' } })];
    const grupos = agruparDocumentos(itens);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.parcelas.map((p) => [p.delivery, p.count.counted])).toEqual([
      ['DLV-1', '3'],
      ['DLV-2', '7'],
    ]);
    expect(contarDocumentos(itens)).toBe(1);
    // Volumes do palete = parcelas deste palete (10), não o total repetido.
    expect(volumesDoPalete(itens)).toEqual({ total: '10', pendentes: 0 });
  });

  it('mesmo número com tipo diferente (NF × MI) são documentos diferentes; Delivery vazio é aceito', () => {
    const grupos = agruparDocumentos([item({ documentNumber: '777' }), item({ documentNumber: '777', documentType: 'MI' }), item({ documentNumber: '888' })]);
    expect(grupos.map((g) => [g.tipo, g.numero, g.parcelas.length])).toEqual([
      ['NF', '777', 1],
      ['MI', '777', 1],
      ['NF', '888', 1],
    ]);
  });

  it('conteúdos sem documento nunca são unidos entre si nem contam como documento', () => {
    const itens = [item({ documentType: null, documentNumber: null }), item({ documentType: null, documentNumber: null }), item({})];
    expect(agruparDocumentos(itens)).toHaveLength(3);
    expect(contarDocumentos(itens)).toBe(1);
  });

  it('vínculos encerrados ficam fora', () => {
    expect(agruparDocumentos([item({ state: 'ENCERRADO' })])).toEqual([]);
  });
});
