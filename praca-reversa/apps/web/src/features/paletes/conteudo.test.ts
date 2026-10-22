import type { ContagemObservada, PaleteDetalhe } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import { apresentarConteudo } from './conteudo';

const PRODUTO = '50000000-0000-4000-8000-000000000001';

const item = {
  segmentId: '40000000-0000-4000-8000-000000000001',
  productId: PRODUTO,
  sku: '00101',
  description: 'Shampoo',
  lot: 'LOTE-A',
  originType: 'DEVOLUCAO',
  originReference: 'DEV-01',
  condition: 'SAUDAVEL',
  lineage: null,
  quantity: '1200',
  unit: 'UN',
  reserved: '0',
  claimLinked: '0', released: '0', blocked: null,
} as const;

const reconciliacao = { eventId: '60000000-0000-4000-8000-000000000001', type: 'SALDO_INICIAL', at: '2026-10-02T12:00:00.000Z', by: null, session: null } as const;
const transferencia = { eventId: '60000000-0000-4000-8000-000000000002', type: 'TRANSFERENCIA', at: '2026-10-02T13:00:00.000Z', by: null, session: null } as const;
const reconciliado = { lastReconciliation: reconciliacao, lastStockEvent: reconciliacao };

function contagem(scope: 'PARCIAL' | 'COMPLETA', quantidade: string, extra: Partial<ContagemObservada['items'][number]> = {}): ContagemObservada {
  return {
    session: {
      id: '70000000-0000-4000-8000-000000000001',
      number: 2,
      palletId: '00000000-0000-4000-8000-000000000001',
      scope,
      scopeDescription: scope === 'PARCIAL' ? 'Camada superior' : null,
      kind: 'CONFERENCIA',
      origin: null,
      state: 'CONCLUIDA',
      revision: 4,
      responsible: { login: 'op', name: 'Operador' },
      startedAt: '2026-10-02T12:00:00.000Z',
      updatedAt: '2026-10-02T12:05:00.000Z',
      concludedAt: '2026-10-02T12:05:00.000Z',
      concludedBy: { login: 'op', name: 'Operador' },
      cancelledAt: null,
      reconciledAt: null,
      activeLines: 1,
      pendingLines: 0,
    },
    items: [
      {
        key: 'k',
        productId: PRODUTO,
        sku: '00101',
        description: 'Shampoo',
        lot: 'LOTE-A',
        originType: 'DEVOLUCAO',
        originReference: 'DEV-01',
        condition: 'SAUDAVEL',
        quantity: quantidade,
        unit: 'UN',
        lines: 1,
        ...extra,
      },
    ],
    pending: [],
  };
}

function palete(parcial: Partial<PaleteDetalhe>): PaleteDetalhe {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'PAL-TESTE-001',
    positionId: '10000000-0000-4000-8000-000000000001',
    positionCode: 'F01-P01',
    countState: 'NAO_CONFERIDO',
    releaseState: 'PENDENTE',
    flowState: 'EM_ESTOQUE',
    pendingReason: null,
    activeCountId: null,
    reconference: null,
    volumeCheck: null,
    legacyCode: null,
    currentItems: null,
    observedCounts: [],
    activeCount: null,
    lastReconciliation: null,
    lastStockEvent: null,
    declaredItems: null,
    dataSource: 'DEMONSTRACAO_FICTICIA',
    updatedAt: '2026-10-02T12:00:00.000Z',
    version: 1,
    notes: null,
    createdAt: '2026-10-02T12:00:00.000Z',
    createdBy: null,
    codeOrigin: 'DEMONSTRACAO',
    archived: null,
    palletBlock: null,
    ...parcial,
  };
}

describe('apresentação do conteúdo', () => {
  it('palete não conferido é desconhecido e não tem linhas de quantidade', () => {
    const apresentacao = apresentarConteudo(palete({}));
    expect(apresentacao.tipo).toBe('desconhecido');
    expect(apresentacao).not.toHaveProperty('saldo');
    expect(apresentacao.explicacao).toMatch(/Nenhuma quantidade física é presumida/);
  });

  it('conferência parcial não aparece como saldo completo e mantém lote/origem pendentes', () => {
    const apresentacao = apresentarConteudo(
      palete({ countState: 'PARCIAL', observedCounts: [contagem('PARCIAL', '6', { lot: null, originType: null, originReference: null })] }),
    );
    expect(apresentacao.tipo).toBe('parcial');
    if (apresentacao.tipo !== 'parcial') return;
    expect(apresentacao.explicacao).toMatch(/não é saldo validado/);
    expect(apresentacao.contagens[0]?.titulo).toMatch(/parcial \(Camada superior\)/);
    expect(apresentacao.contagens[0]?.linhas[0]).toMatchObject({
      lote: 'Lote pendente',
      lotePendente: true,
      origem: 'Origem pendente',
      origemPendente: true,
      quantidade: '6 UN',
    });
  });

  it('aguardando validação separa declarado, observado e saldo validado anterior', () => {
    const apresentacao = apresentarConteudo(
      palete({
        countState: 'AGUARDANDO_VALIDACAO',
        observedCounts: [contagem('COMPLETA', '9')],
        currentItems: [item],
        ...reconciliado,
        declaredItems: [
          { productId: PRODUTO, sku: '00101', description: 'Shampoo', lot: 'LOTE-A', originType: 'DEVOLUCAO', originReference: 'DEV-01', quantity: '12', unit: 'UN', condition: null },
        ],
      }),
    );
    expect(apresentacao.tipo).toBe('aguardando');
    if (apresentacao.tipo !== 'aguardando') return;
    expect(apresentacao.contagens.flatMap((c) => c.linhas.map((l) => l.quantidade))).toEqual(['9 UN']);
    expect(apresentacao.declarados.map((l) => l.quantidade)).toEqual(['12 UN']);
    expect(apresentacao.saldoAnterior?.map((l) => l.quantidade)).toEqual(['1.200 UN']);
  });

  it('reconciliado mostra saldo validado formatado em pt-BR e preserva o SKU textual', () => {
    const apresentacao = apresentarConteudo(palete({ countState: 'RECONCILIADO', currentItems: [item], ...reconciliado }));
    expect(apresentacao.tipo).toBe('validado');
    if (apresentacao.tipo !== 'validado') return;
    expect(apresentacao.saldo[0]).toMatchObject({
      sku: '00101',
      quantidade: '1.200 UN',
      condicao: 'Saudável',
      origem: 'Devolução DEV-01',
    });
  });

  it('reconciliado vazio é ausência verificada, não conteúdo desconhecido', () => {
    const apresentacao = apresentarConteudo(palete({ countState: 'RECONCILIADO', currentItems: [], ...reconciliado }));
    expect(apresentacao.tipo).toBe('validado');
    expect(apresentacao.explicacao).toMatch(/ausência verificada/);
  });

  it('transferência recebida: só o item recebido é conhecido; o palete continua desconhecido, sem zero presumido', () => {
    const recebido = { ...item, quantity: '8', reserved: '0', lot: null, originType: null, originReference: null, lineage: '70000000-0000-4000-8000-000000000009' };
    const apresentacao = apresentarConteudo(palete({ currentItems: [recebido], lastStockEvent: transferencia }));
    expect(apresentacao.tipo).toBe('desconhecido');
    if (apresentacao.tipo !== 'desconhecido') return;
    expect(apresentacao.explicacao).toMatch(/Só o saldo recebido por transferência é conhecido/);
    expect(apresentacao.saldoConhecido?.map((l) => [l.quantidade, l.lote, l.registroProprio])).toEqual([['8 UN', 'Lote pendente', true]]);
    // Sem transferência, nada é conhecido.
    const nada = apresentarConteudo(palete({}));
    expect(nada.tipo === 'desconhecido' ? nada.saldoConhecido : 'x').toBeNull();
  });

  it('reserva ativa aparece junto do saldo validado', () => {
    const apresentacao = apresentarConteudo(palete({ countState: 'RECONCILIADO', currentItems: [{ ...item, quantity: '10', reserved: '4' }], ...reconciliado }));
    if (apresentacao.tipo !== 'validado') throw new Error('esperado validado');
    expect([apresentacao.saldo[0]?.quantidade, apresentacao.saldo[0]?.reservado]).toEqual(['10 UN', '4 UN']);
  });

  it('linha declarada mostra produto, lote e origem pendentes sem virar quantidade física', () => {
    const apresentacao = apresentarConteudo(
      palete({
        declaredItems: [
          { productId: null, sku: null, description: 'Caixa sem etiqueta', lot: null, originType: null, originReference: null, quantity: '3', unit: 'UN', condition: null },
          { productId: null, sku: '000777', description: 'Shampoo', lot: '0042', originType: 'NOTA_FISCAL', originReference: '000456', quantity: '2', unit: 'CX', condition: null },
        ],
      }),
    );
    expect(apresentacao.tipo).toBe('desconhecido');
    expect(apresentacao.declarados[0]).toMatchObject({ sku: 'Produto pendente', skuPendente: true, lote: 'Lote pendente', origem: 'Origem pendente', condicao: 'Não informada' });
    expect(apresentacao.declarados[1]).toMatchObject({ sku: '000777', origem: 'Nota fiscal 000456', origemPendente: false, quantidade: '2 CX' });
  });
});
