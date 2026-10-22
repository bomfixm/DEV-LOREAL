import { describe, expect, it } from 'vitest';
import {
  CriarUsuarioSchema,
  ItemSaldoSchema,
  LayoutSchema,
  PERFIS,
  PERMISSOES_POR_PERFIL,
  PaleteDetalheSchema,
  QuantidadeSchema,
  perfilPossui,
  verificarOcupacao,
  type ContagemObservada,
  type Layout,
  type PaleteDetalhe,
  type PaleteResumo,
} from './index.js';

const item = {
  segmentId: '40000000-0000-4000-8000-000000000001',
  productId: '50000000-0000-4000-8000-000000000001',
  sku: '000123',
  description: 'Produto fictício',
  lot: 'LOTE-0001',
  originType: 'DEVOLUCAO',
  originReference: 'DEV-0001',
  condition: 'SAUDAVEL',
  lineage: null,
  quantity: '12',
  unit: 'UN',
  reserved: '0',
  claimLinked: '0', released: '0', blocked: null,
} as const;

const reconciliacao = {
  eventId: '60000000-0000-4000-8000-000000000001',
  type: 'SALDO_INICIAL',
  at: '2026-10-02T12:00:00.000Z',
  by: null,
  session: null,
} as const;

const transferencia = {
  eventId: '60000000-0000-4000-8000-000000000002',
  type: 'TRANSFERENCIA',
  at: '2026-10-02T13:00:00.000Z',
  by: { login: 'operador', name: 'Operador' },
  session: null,
} as const;

/** Saldo validado definido por reconciliação (último evento = a própria reconciliação). */
const reconciliado = { lastReconciliation: reconciliacao, lastStockEvent: reconciliacao };

function contagem(scope: 'PARCIAL' | 'COMPLETA'): ContagemObservada {
  return {
    session: {
      id: '70000000-0000-4000-8000-000000000001',
      number: 1,
      palletId: '00000000-0000-4000-8000-000000000099',
      scope,
      scopeDescription: scope === 'PARCIAL' ? 'Camada superior' : null,
      kind: 'CONFERENCIA',
      origin: null,
      state: 'CONCLUIDA',
      revision: 3,
      responsible: { login: 'operador', name: 'Operador' },
      startedAt: '2026-10-02T12:00:00.000Z',
      updatedAt: '2026-10-02T12:10:00.000Z',
      concludedAt: '2026-10-02T12:10:00.000Z',
      concludedBy: { login: 'operador', name: 'Operador' },
      cancelledAt: null,
      reconciledAt: null,
      activeLines: 6,
      pendingLines: 0,
    },
    items: [
      {
        key: 'k',
        productId: item.productId,
        sku: item.sku,
        description: item.description,
        lot: null,
        originType: null,
        originReference: null,
        condition: 'SAUDAVEL',
        quantity: '6',
        unit: 'UN',
        lines: 6,
      },
    ],
    pending: [],
  };
}

const ID_POS_1 = '10000000-0000-4000-8000-000000000001';
const ID_POS_2 = '10000000-0000-4000-8000-000000000002';
const ID_FILEIRA = '20000000-0000-4000-8000-000000000001';

function palete(parcial: Partial<PaleteDetalhe>): PaleteDetalhe {
  return {
    id: '00000000-0000-4000-8000-000000000099',
    code: 'PAL-TESTE-099',
    positionId: ID_POS_1,
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

function layout(parcial: Partial<Layout> = {}): Layout {
  const caixa = { x: 0, y: 10, width: 30, height: 30 };
  return {
    id: '30000000-0000-4000-8000-000000000001',
    code: 'L',
    version: 't1',
    revision: 1,
    name: 'Teste',
    unit: 'UNIDADE_DE_DESENHO',
    origin: 'SUPERIOR_ESQUERDO',
    width: 200,
    height: 100,
    totalCapacity: null,
    schematic: true,
    fictional: true,
    elements: [],
    rows: [{ id: ID_FILEIRA, code: 'F01', label: 'F01', order: 1, blockCode: null, x: 0, y: 10, width: 140, height: 30, labelBox: caixa, side: null }],
    positions: [
      { id: ID_POS_1, code: 'F01-P01', provisionalCode: true, rowId: ID_FILEIRA, number: 1, x: 40, y: 10, width: 40, height: 30, available: true, unavailableReason: null, occupancySurveyed: false, deactivated: false, address: null, freeConfirmed: null },
      { id: ID_POS_2, code: 'F01-P02', provisionalCode: true, rowId: ID_FILEIRA, number: 2, x: 90, y: 10, width: 40, height: 30, available: false, unavailableReason: 'Pilar', occupancySurveyed: false, deactivated: false, address: null, freeConfirmed: null },
    ],
    ...parcial,
  };
}

describe('conteúdo do palete', () => {
  it('rejeita quantidade presumida em palete não conferido', () => {
    expect(PaleteDetalheSchema.safeParse(palete({ currentItems: [], ...reconciliado })).success).toBe(false);
    expect(PaleteDetalheSchema.safeParse(palete({ currentItems: [item] })).success).toBe(false);
  });

  it('transferência recebida mostra só o saldo conhecido e não torna o palete conferido', () => {
    // Palete nunca conferido que recebeu um segmento por transferência: continua não conferido.
    expect(PaleteDetalheSchema.safeParse(palete({ currentItems: [item], lastStockEvent: transferencia })).success).toBe(true);
    // "Reconciliado" só vem de reconciliação, nunca de transferência.
    expect(PaleteDetalheSchema.safeParse(palete({ countState: 'RECONCILIADO', currentItems: [item], lastStockEvent: transferencia })).success).toBe(false);
    // Reconciliado que depois transferiu/recebeu continua reconciliado.
    expect(
      PaleteDetalheSchema.safeParse(palete({ countState: 'RECONCILIADO', currentItems: [], lastReconciliation: reconciliacao, lastStockEvent: transferencia })).success,
    ).toBe(true);
    // Reconciliação registrada não convive com "não conferido".
    expect(PaleteDetalheSchema.safeParse(palete({ currentItems: [item], lastReconciliation: reconciliacao, lastStockEvent: transferencia })).success).toBe(false);
  });

  it('rejeita observações físicas em palete não conferido', () => {
    expect(PaleteDetalheSchema.safeParse(palete({ observedCounts: [contagem('PARCIAL')] })).success).toBe(false);
  });

  it('não aceita conferência parcial apresentada como saldo validado', () => {
    const resultado = PaleteDetalheSchema.safeParse(
      palete({ countState: 'PARCIAL', observedCounts: [contagem('PARCIAL')], currentItems: [item], ...reconciliado }),
    );
    expect(resultado.success).toBe(false);
  });

  it('aceita conferência parcial com observações e saldo ainda desconhecido', () => {
    expect(PaleteDetalheSchema.safeParse(palete({ countState: 'PARCIAL', observedCounts: [contagem('PARCIAL')] })).success).toBe(true);
  });

  it('parcial não sustenta "aguardando validação": exige contagem completa concluída', () => {
    expect(PaleteDetalheSchema.safeParse(palete({ countState: 'AGUARDANDO_VALIDACAO', observedCounts: [contagem('PARCIAL')] })).success).toBe(false);
    expect(PaleteDetalheSchema.safeParse(palete({ countState: 'AGUARDANDO_VALIDACAO', observedCounts: [contagem('COMPLETA')] })).success).toBe(true);
  });

  it('exige saldo validado no palete reconciliado e aceita vazio verificado', () => {
    expect(PaleteDetalheSchema.safeParse(palete({ countState: 'RECONCILIADO' })).success).toBe(false);
    expect(PaleteDetalheSchema.safeParse(palete({ countState: 'RECONCILIADO', currentItems: [item], ...reconciliado })).success).toBe(true);
    expect(PaleteDetalheSchema.safeParse(palete({ countState: 'RECONCILIADO', currentItems: [], ...reconciliado })).success).toBe(true);
    expect(PaleteDetalheSchema.safeParse(palete({ countState: 'RECONCILIADO', currentItems: [item] })).success).toBe(false);
  });

  it('nova contagem completa aguardando validação mantém o saldo validado anterior separado', () => {
    const resultado = PaleteDetalheSchema.safeParse(
      palete({ countState: 'AGUARDANDO_VALIDACAO', currentItems: [item], ...reconciliado, observedCounts: [contagem('COMPLETA')] }),
    );
    expect(resultado.success).toBe(true);
  });

  it('exige posição e código da posição coerentes', () => {
    expect(PaleteDetalheSchema.safeParse(palete({ positionCode: null })).success).toBe(false);
    expect(PaleteDetalheSchema.safeParse(palete({ positionId: null, positionCode: null })).success).toBe(true);
  });
});

describe('códigos e quantidades', () => {
  it('preserva zeros à esquerda em SKU e não aceita números', () => {
    const resultado = ItemSaldoSchema.parse(item);
    expect(resultado.sku).toBe('000123');
    expect(ItemSaldoSchema.safeParse({ ...item, sku: 123 }).success).toBe(false);
  });

  it('quantidade é decimal exato em texto, não negativa', () => {
    expect(QuantidadeSchema.safeParse('24').success).toBe(true);
    expect(QuantidadeSchema.safeParse('1.125').success).toBe(true);
    expect(QuantidadeSchema.safeParse('-1').success).toBe(false);
    expect(QuantidadeSchema.safeParse('1e3').success).toBe(false);
    expect(QuantidadeSchema.safeParse(12).success).toBe(false);
  });

  it('mantém lote desconhecido como nulo', () => {
    expect(ItemSaldoSchema.parse({ ...item, lot: null }).lot).toBeNull();
    expect(ItemSaldoSchema.safeParse({ ...item, lot: '' }).success).toBe(false);
  });
});

describe('layout', () => {
  it('aceita layout coerente com capacidade total desconhecida', () => {
    const resultado = LayoutSchema.safeParse(layout());
    expect(resultado.success).toBe(true);
    expect(resultado.data?.totalCapacity).toBeNull();
  });

  it('rejeita posição fora da sua fileira ou do desenho', () => {
    const base = layout();
    const [p1, p2] = base.positions;
    if (!p1 || !p2) throw new Error('layout de teste incompleto');
    expect(LayoutSchema.safeParse(layout({ positions: [{ ...p1, y: 50 }, p2] })).success).toBe(false);
    expect(LayoutSchema.safeParse(layout({ positions: [{ ...p1, x: 190 }, p2] })).success).toBe(false);
  });

  it('rejeita código de posição duplicado', () => {
    const base = layout();
    const [p1, p2] = base.positions;
    if (!p1 || !p2) throw new Error('layout de teste incompleto');
    expect(LayoutSchema.safeParse(layout({ positions: [p1, { ...p2, code: p1.code }] })).success).toBe(false);
  });
});

describe('ocupação', () => {
  const resumo = (n: number, positionId: string | null, positionCode: string | null): PaleteResumo => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    code: `P${String(n)}`,
    positionId,
    positionCode,
    countState: 'NAO_CONFERIDO',
    releaseState: 'PENDENTE',
    flowState: 'EM_ESTOQUE',
    pendingReason: null,
    activeCountId: null,
    reconference: null,
    volumeCheck: null,
    legacyCode: null,
  });

  it('aceita palete em posição existente e palete sem posição', () => {
    expect(verificarOcupacao(layout(), [resumo(1, ID_POS_1, 'F01-P01'), resumo(2, null, null)])).toEqual([]);
  });

  it('rejeita posição indisponível, inexistente, código divergente e identificação repetida', () => {
    const problemas = verificarOcupacao(layout(), [
      resumo(1, ID_POS_2, 'F01-P02'),
      resumo(2, '10000000-0000-4000-8000-000000000999', 'X'),
      resumo(3, ID_POS_1, 'F09-P09'),
      resumo(1, null, null),
    ]);
    expect(problemas.some((p) => p.includes('indisponível'))).toBe(true);
    expect(problemas.some((p) => p.includes('inexistente'))).toBe(true);
    expect(problemas.some((p) => p.includes('divergente'))).toBe(true);
    expect(problemas.some((p) => p.includes('ID de palete duplicado'))).toBe(true);
  });
});

describe('perfis e permissões', () => {
  it('todos os perfis da operação consultam a praça e só o administrador administra acesso', () => {
    for (const perfil of PERFIS) {
      expect(perfilPossui(perfil, 'praca.consultar')).toBe(perfil !== 'CLIENTE_CONSULTA');
      expect(perfilPossui(perfil, 'acesso.administrar')).toBe(perfil === 'ADMINISTRADOR');
    }
  });

  it('perfil do cliente só consulta a projeção do painel do cliente (nada interno, nenhuma escrita)', () => {
    expect(PERMISSOES_POR_PERFIL.CLIENTE_CONSULTA).toEqual(['painel.cliente']);
    expect(PERFIS.filter((p) => perfilPossui(p, 'painel.operacao'))).toEqual(['CONSULTA', 'OPERADOR', 'SUPERVISOR_ESTOQUE', 'ANALISTA_CLAIMS', 'ADMINISTRADOR']);
    expect(PERFIS.filter((p) => perfilPossui(p, 'painel.cliente'))).toEqual(['SUPERVISOR_ESTOQUE', 'CLIENTE_CONSULTA']);
  });

  it('aprovação financeira não é concedida automaticamente a nenhum perfil, nem ao administrador', () => {
    for (const perfil of PERFIS) expect(PERMISSOES_POR_PERFIL[perfil]).not.toContain('claim.aprovar_financeiro');
  });

  it('reconciliar conferência é permissão própria do supervisor; operador só registra contagem', () => {
    expect(PERFIS.filter((p) => perfilPossui(p, 'conferencia.reconciliar'))).toEqual(['SUPERVISOR_ESTOQUE']);
    expect(PERFIS.filter((p) => perfilPossui(p, 'conferencia.registrar'))).toEqual(['OPERADOR', 'SUPERVISOR_ESTOQUE']);
  });

  it('sem perfil, nenhuma permissão', () => {
    expect(perfilPossui(null, 'praca.consultar')).toBe(false);
  });

  it('normaliza login e exige senha inicial de 12 caracteres', () => {
    const ok = CriarUsuarioSchema.parse({ login: '  Maria.Silva ', name: 'Maria', initialPassword: 'x'.repeat(12), role: 'CONSULTA' });
    expect(ok.login).toBe('maria.silva');
    expect(CriarUsuarioSchema.safeParse({ login: 'ma', name: 'Maria', initialPassword: 'x'.repeat(12), role: 'CONSULTA' }).success).toBe(false);
    expect(CriarUsuarioSchema.safeParse({ login: 'maria', name: 'Maria', initialPassword: 'curta', role: 'CONSULTA' }).success).toBe(false);
  });
});
