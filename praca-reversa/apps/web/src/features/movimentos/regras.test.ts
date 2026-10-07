import type { ItemSaldo, Layout, PaleteResumo } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import { FalhaRequisicao } from '../../api/cliente';
import { classificarFalha, disponivel, posicoesLivres, previaSaldo, problemaQuantidade } from './regras';

const SEG = '40000000-0000-4000-8000-000000000001';
const item = (quantity: string, reserved = '0', segmentId = SEG): ItemSaldo => ({
  segmentId,
  productId: '50000000-0000-4000-8000-000000000001',
  sku: '000123',
  description: 'Produto fictício',
  lot: '0042',
  originType: 'DEVOLUCAO',
  originReference: 'DEV-0007',
  condition: 'SAUDAVEL',
  lineage: null,
  quantity,
  unit: 'UN',
  reserved,
  claimLinked: '0', released: '0', blocked: null,
});

describe('saldo disponível e quantidade', () => {
  it('disponível = saldo validado − reservas ativas', () => {
    expect(disponivel(item('10', '4'))).toBe('6');
    expect(disponivel(item('2.5', '0.5'))).toBe('2');
  });

  it('quantidade positiva, inteira em peças e até o disponível', () => {
    expect(problemaQuantidade('8', 'UN', '10')).toBeNull();
    expect(problemaQuantidade('1,5', 'KG', '10')).toBeNull();
    expect(problemaQuantidade('', 'UN', '10')).toMatch(/Informe/);
    expect(problemaQuantidade('0', 'UN', '10')).toMatch(/maior que zero/);
    expect(problemaQuantidade('-1', 'UN', '10')).toMatch(/3 casas/);
    expect(problemaQuantidade('1,5', 'UN', '10')).toMatch(/inteira/);
    expect(problemaQuantidade('7', 'UN', '6')).toMatch(/Maior que o disponível: 6 UN/);
    expect(problemaQuantidade('2.0001', 'KG', '10')).toMatch(/3 casas/);
  });

  it('prévia: a origem perde e o destino ganha a mesma quantidade (total igual)', () => {
    const [sai, entra] = previaSaldo(SEG, '8', { codigo: 'PAL-A', itens: [item('10')] }, { codigo: 'PAL-B', itens: [item('3')] });
    expect([sai.antes, sai.depois, entra.antes, entra.depois]).toEqual(['10', '2', '3', '11']);
    const [, novo] = previaSaldo(SEG, '1', { codigo: 'PAL-A', itens: [item('10')] }, { codigo: 'PAL-C', itens: null });
    expect([novo.antes, novo.depois]).toEqual(['0', '1']);
  });
});

describe('respostas da API', () => {
  it('separa saldo insuficiente, destino indisponível, conflito, permissão e resposta incerta', () => {
    const http = (status: number, codigo: string) => new FalhaRequisicao('http', 'mensagem', status, codigo);
    expect(classificarFalha(http(409, 'SALDO_INSUFICIENTE'))).toMatchObject({ tipo: 'saldo', incerto: false });
    expect(classificarFalha(http(409, 'DESTINO_INDISPONIVEL'))).toMatchObject({ tipo: 'destino', incerto: false });
    expect(classificarFalha(http(409, 'CONFLITO_VERSAO'))).toMatchObject({ tipo: 'conflito', incerto: false });
    expect(classificarFalha(http(403, 'ACESSO_NEGADO'))).toMatchObject({ tipo: 'permissao', incerto: false });
    expect(classificarFalha(http(400, 'REQUISICAO_INVALIDA'))).toMatchObject({ tipo: 'campo', incerto: false });
    expect(classificarFalha(new FalhaRequisicao('rede', 'sem rede'))).toMatchObject({ tipo: 'rede', incerto: true });
    expect(classificarFalha(http(500, 'ERRO_INTERNO'))).toMatchObject({ incerto: true });
  });
});

describe('posições de destino', () => {
  const layout = {
    rows: [{ id: 'f1', label: 'Fileira 1' }],
    positions: [
      { id: 'p1', code: 'F01-P01', rowId: 'f1', available: true },
      { id: 'p2', code: 'F01-P02', rowId: 'f1', available: true },
      { id: 'p3', code: 'F01-P03', rowId: 'f1', available: false },
      { id: 'p4', code: 'F01-P10', rowId: 'f1', available: true },
    ],
  } as unknown as Layout;
  const paletes = [{ positionId: 'p1' }] as PaleteResumo[];

  it('só posições disponíveis e sem palete; filtro ignora separadores e caixa', () => {
    expect(posicoesLivres(layout, paletes, '', null).map((p) => p.codigo)).toEqual(['F01-P02', 'F01-P10']);
    expect(posicoesLivres(layout, paletes, 'f01p1', null).map((p) => p.codigo)).toEqual(['F01-P10']);
    expect(posicoesLivres(layout, [], '', 'p2').map((p) => p.codigo)).toEqual(['F01-P01', 'F01-P10']);
    expect(posicoesLivres(null, paletes, '', null)).toEqual([]);
  });
});
