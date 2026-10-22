import { describe, expect, it } from 'vitest';
import {
  CadastroPaleteSchema,
  CodigoPaleteSchema,
  CriarProdutoSchema,
  LayoutSchema,
  LoteEtiquetasSchema,
  PERFIS,
  chaveDeCodigo,
  ehEnderecoLocal,
  extrairIdPalete,
  perfilPossui,
  type Layout,
} from './index.js';

const ID = '0a1b2c3d-0000-4000-8000-000000000123';

describe('códigos legíveis', () => {
  it('código do palete em maiúsculas; chave ignora separadores e preserva zeros', () => {
    expect(CodigoPaleteSchema.parse(' pal-x/001 ')).toBe('PAL-X/001');
    expect(chaveDeCodigo('PAL-X/001')).toBe(chaveDeCodigo('palx001'));
    expect(chaveDeCodigo('000123')).toBe('000123');
    for (const invalido of ['', 'PAL X', '-PAL', 'PAL#1', 'x'.repeat(41)]) {
      expect(CodigoPaleteSchema.safeParse(invalido).success, invalido).toBe(false);
    }
  });

  it('extrai o ID permanente do link do QR ou do UUID digitado, sem confiar no host', () => {
    expect(extrairIdPalete(`http://192.168.0.10:3000/paletes/${ID}`)).toBe(ID);
    expect(extrairIdPalete(`https://outro.exemplo/paletes/${ID.toUpperCase()}?x=1`)).toBe(ID);
    expect(extrairIdPalete(ID)).toBe(ID);
    expect(extrairIdPalete('PAL-DEMO-001')).toBeNull();
    expect(extrairIdPalete(`/paletes/${ID}/extra`)).toBeNull();
  });
});

describe('produto', () => {
  const base = { sku: '000123', description: 'Shampoo', canonicalUnit: 'un', active: true, barcodes: [] };

  it('SKU e código de barras textuais; unidade normalizada', () => {
    const produto = CriarProdutoSchema.parse({ ...base, barcodes: [{ code: '0007891234567', packaging: 'cx', factor: '12' }] });
    expect(produto).toMatchObject({ sku: '000123', canonicalUnit: 'UN', barcodes: [{ code: '0007891234567', packaging: 'CX', factor: '12' }] });
    expect(CriarProdutoSchema.safeParse({ ...base, sku: 123 }).success).toBe(false);
  });

  it('fator explícito: 1 na unidade canônica, inteiro para peças, maior que zero, sem código repetido', () => {
    const com = (barcodes: object[]) => CriarProdutoSchema.safeParse({ ...base, barcodes }).success;
    expect(com([{ code: '1', packaging: 'UN', factor: '1' }])).toBe(true);
    expect(com([{ code: '1', packaging: 'UN', factor: '6' }])).toBe(false);
    expect(com([{ code: '1', packaging: 'CX', factor: '1.5' }])).toBe(false);
    expect(com([{ code: '1', packaging: 'CX', factor: '0' }])).toBe(false);
    expect(com([{ code: '1', packaging: 'CX', factor: '' }])).toBe(false);
    expect(com([{ code: '1', packaging: 'CX', factor: '6' }, { code: '1', packaging: 'PCT', factor: '2' }])).toBe(false);
    expect(CriarProdutoSchema.safeParse({ ...base, canonicalUnit: 'KG', barcodes: [{ code: '1', packaging: 'SC', factor: '2.5' }] }).success).toBe(true);
  });
});

describe('cadastro de palete', () => {
  const linha = { sku: null, description: 'Caixa sem etiqueta', lot: null, originType: null, originReference: null, quantity: '3', unit: 'UN' };

  it('aceita palete sem posição, sem linhas, com código gerado', () => {
    expect(CadastroPaleteSchema.parse({ code: { mode: 'GERAR' }, positionId: null })).toMatchObject({ notes: null, declaredItems: [] });
  });

  it('linha declarada: produto/lote/origem pendentes permitidos; quantidade positiva e inteira em UN', () => {
    const tentar = (extra: object) => CadastroPaleteSchema.safeParse({ code: { mode: 'GERAR' }, positionId: null, declaredItems: [{ ...linha, ...extra }] }).success;
    expect(tentar({})).toBe(true);
    expect(tentar({ description: null })).toBe(false);
    expect(tentar({ originReference: 'NF-1' })).toBe(false);
    expect(tentar({ quantity: '0' })).toBe(false);
    expect(tentar({ quantity: '1.5' })).toBe(false);
    expect(tentar({ quantity: '1.5', unit: 'KG' })).toBe(true);
    expect(tentar({ quantity: '1,5', unit: 'KG' })).toBe(false);
  });

  it('não existe campo de saldo no cadastro: quantidades extras são descartadas', () => {
    const dados = CadastroPaleteSchema.parse({ code: { mode: 'GERAR' }, positionId: null, currentItems: [{ quantity: '9' }] });
    expect(dados).not.toHaveProperty('currentItems');
  });
});

describe('etiqueta', () => {
  const lote = {
    generatedAt: '2026-10-02T12:00:00.000Z',
    environment: 'teste',
    baseUrl: 'https://praca.exemplo.interno',
    localAddress: false,
    scope: { name: 'Teste', demo: false },
    labels: [{ palletId: ID, code: 'PR-000001', url: `https://praca.exemplo.interno/paletes/${ID}`, positionCode: null, positionProvisional: null }],
  };

  it('o link do QR precisa ser a rota do próprio palete na URL base', () => {
    expect(LoteEtiquetasSchema.safeParse(lote).success).toBe(true);
    const errado = { ...lote, labels: [{ ...lote.labels[0], url: 'https://praca.exemplo.interno/paletes/outro' }] };
    expect(LoteEtiquetasSchema.safeParse(errado).success).toBe(false);
  });

  it('endereços que só funcionam no próprio computador são identificados', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'app.localhost', '0.0.0.0']) expect(ehEnderecoLocal(host), host).toBe(true);
    for (const host of ['192.168.0.10', 'praca.exemplo.interno']) expect(ehEnderecoLocal(host), host).toBe(false);
  });
});

describe('geometria do layout', () => {
  const F1 = '20000000-0000-4000-8000-000000000001';
  const pos = (n: number, x: number) => ({
    id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    code: `F01-P${String(n).padStart(2, '0')}`,
    provisionalCode: true,
    rowId: F1,
    number: n,
    x,
    y: 10,
    width: 40,
    height: 30,
    available: true,
    unavailableReason: null,
    occupancySurveyed: false,
    deactivated: false,
    address: null,
    freeConfirmed: null,
  });
  const layout = (parcial: Partial<Layout>): Layout => ({
    id: '30000000-0000-4000-8000-000000000001',
    code: 'L',
    version: 't',
    revision: 1,
    name: 'Teste',
    unit: 'UNIDADE_DE_DESENHO',
    origin: 'SUPERIOR_ESQUERDO',
    width: 300,
    height: 100,
    totalCapacity: null,
    schematic: true,
    fictional: true,
    elements: [],
    rows: [{ id: F1, code: 'F01', label: 'F01', order: 1, blockCode: null, x: 0, y: 10, width: 200, height: 30, labelBox: { x: 0, y: 10, width: 30, height: 30 }, side: null }],
    positions: [pos(1, 40), pos(2, 90)],
    ...parcial,
  });

  it('recusa posições sobrepostas e título sobre posição', () => {
    expect(LayoutSchema.safeParse(layout({})).success).toBe(true);
    expect(LayoutSchema.safeParse(layout({ positions: [pos(1, 40), pos(2, 70)] })).success).toBe(false);
    const titulo = { id: '40000000-0000-4000-8000-000000000001', kind: 'ZONA' as const, code: 'Z', label: 'Zona', fictional: true, x: 0, y: 0, width: 300, height: 100, operationalName: null, addressPrefix: null };
    expect(LayoutSchema.safeParse(layout({ elements: [{ ...titulo, labelBox: { x: 0, y: 0, width: 300, height: 9 } }] })).success).toBe(true);
    expect(LayoutSchema.safeParse(layout({ elements: [{ ...titulo, labelBox: { x: 0, y: 0, width: 300, height: 20 } }] })).success).toBe(false);
  });
});

describe('permissões da etapa 03', () => {
  it('cadastro e etiqueta para operador e supervisor; produto, layout e arquivamento só para o supervisor', () => {
    const quem = (permissao: Parameters<typeof perfilPossui>[1]) => PERFIS.filter((p) => perfilPossui(p, permissao));
    expect(quem('palete.cadastrar')).toEqual(['OPERADOR', 'SUPERVISOR_ESTOQUE']);
    expect(quem('etiqueta.imprimir')).toEqual(['OPERADOR', 'SUPERVISOR_ESTOQUE']);
    expect(quem('produto.cadastrar')).toEqual(['SUPERVISOR_ESTOQUE']);
    expect(quem('layout.configurar')).toEqual(['SUPERVISOR_ESTOQUE']);
    expect(quem('palete.arquivar')).toEqual(['SUPERVISOR_ESTOQUE']);
    // O acesso do cliente (painel do cliente) não consulta produtos.
    expect(quem('produto.consultar')).toEqual(PERFIS.filter((p) => p !== 'CLIENTE_CONSULTA'));
  });
});
