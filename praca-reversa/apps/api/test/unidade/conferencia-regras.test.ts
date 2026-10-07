import type { TotalObservado } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import {
  chaveBase,
  chaveSegmento,
  comparar,
  converterDeclarado,
  planejarReconciliacao,
  totalizar,
  type LinhaParaTotal,
  type ProdutoParaConversao,
  type SaldoAtual,
} from '../../src/modules/conferencia/regras.js';

const PROD_A = '10000000-0000-4000-8000-00000000000a';
const PROD_B = '10000000-0000-4000-8000-00000000000b';

const produtoA: ProdutoParaConversao = { id: PROD_A, sku: '000A', descricao: 'Produto A', unidadeCanonica: 'UN', embalagens: [{ embalagem: 'CX', fator: '12' }] };
const produtoB: ProdutoParaConversao = { id: PROD_B, sku: '000B', descricao: 'Produto B', unidadeCanonica: 'UN', embalagens: [{ embalagem: 'CX', fator: null }] };
const produtos = new Map<string, ProdutoParaConversao>([
  [PROD_A, produtoA],
  [PROD_B, produtoB],
]);

let n = 0;
function linha(parcial: Partial<LinhaParaTotal>): LinhaParaTotal {
  n += 1;
  return {
    id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    produtoId: PROD_A,
    sku: '000A',
    descricao: 'Produto A',
    codigoLido: null,
    lote: null,
    origemTipo: null,
    origemReferencia: null,
    condicao: 'SAUDAVEL',
    quantidadeInformada: '1',
    unidadeInformada: 'UN',
    quantidadeCanonica: '1',
    unidadeCanonica: 'UN',
    pendencia: null,
    removida: false,
    ...parcial,
  };
}

describe('totais da conferência', () => {
  it('leituras repetidas somam; removidas não contam; pendentes ficam fora do total', () => {
    const { totais, pendencias } = totalizar([
      linha({}),
      linha({}),
      linha({ removida: true }),
      linha({ quantidadeInformada: '1', unidadeInformada: 'CX', quantidadeCanonica: '12' }),
      linha({ produtoId: PROD_B, sku: '000B', pendencia: 'FATOR_DESCONHECIDO', quantidadeCanonica: null, unidadeInformada: 'CX' }),
      linha({ produtoId: null, sku: null, pendencia: 'PRODUTO_NAO_IDENTIFICADO', quantidadeCanonica: null, unidadeCanonica: null, codigoLido: '0000999' }),
    ]);
    expect(totais.map((t) => [t.sku, t.quantity, t.lines])).toEqual([['000A', '14', 3]]);
    expect(pendencias.map((p) => [p.kind, p.codeRead])).toEqual([
      ['FATOR_DESCONHECIDO', null],
      ['PRODUTO_NAO_IDENTIFICADO', '0000999'],
    ]);
  });

  it('lote, origem e condição separam segmentos; pendente tem identidade própria', () => {
    const { totais } = totalizar([
      linha({ lote: 'L1' }),
      linha({ lote: null }),
      linha({ lote: null, origemTipo: 'DEVOLUCAO', origemReferencia: 'DEV-1' }),
      linha({ lote: null, condicao: 'AVARIADO' }),
    ]);
    expect(totais).toHaveLength(4);
    expect(new Set(totais.map((t) => t.key)).size).toBe(4);
    expect(chaveBase({ produtoId: PROD_A, lote: null, origemTipo: null, origemReferencia: null, condicao: 'SAUDAVEL' })).not.toBe(
      chaveBase({ produtoId: PROD_A, lote: '', origemTipo: null, origemReferencia: null, condicao: 'SAUDAVEL' }),
    );
    // Linhagens distintas: mesmos atributos pendentes, segmentos diferentes.
    const pendente = { produtoId: PROD_A, lote: null, origemTipo: null, origemReferencia: null, condicao: 'SAUDAVEL' } as const;
    expect(chaveSegmento({ ...pendente, linhagem: 'sessao-1' })).not.toBe(chaveSegmento({ ...pendente, linhagem: 'sessao-2' }));
    expect(chaveSegmento({ ...pendente, linhagem: null }).startsWith(chaveBase(pendente))).toBe(true);
  });
});

describe('comparação declarado × observado × validado', () => {
  const total = (quantidade: string, extra: Partial<TotalObservado> = {}): TotalObservado => ({
    key: chaveBase({ produtoId: PROD_A, lote: null, origemTipo: 'NOTA_FISCAL', origemReferencia: 'NF-1', condicao: 'SAUDAVEL' }),
    productId: PROD_A,
    sku: '000A',
    description: 'Produto A',
    lot: null,
    originType: 'NOTA_FISCAL',
    originReference: 'NF-1',
    condition: 'SAUDAVEL',
    quantity: quantidade,
    unit: 'UN',
    lines: 1,
    ...extra,
  });
  const declarado = (quantidade: string, unidade = 'UN', extra = {}) => ({
    produtoId: PROD_A,
    descricao: 'Produto A',
    lote: null,
    origemTipo: 'NOTA_FISCAL' as const,
    origemReferencia: 'NF-1',
    quantidade,
    unidade,
    ...extra,
  });

  it('12 declarado e 9 observado: falta 3; saldo validado à parte', () => {
    const c = comparar({ escopo: 'COMPLETA', totais: [total('9')], pendencias: [], declarados: [declarado('12')], saldo: null, produtos });
    expect(c.links[0]).toMatchObject({ declared: '12', observed: '9', validated: null, difference: '-3', status: 'FALTA' });
  });

  it('declaração em caixa usa o fator aprovado; sem fator, comparação indisponível', () => {
    const ok = comparar({ escopo: 'COMPLETA', totais: [total('24')], pendencias: [], declarados: [declarado('2', 'CX')], saldo: null, produtos });
    expect(ok.links[0]).toMatchObject({ declared: '24', status: 'CONFERE', difference: '0' });
    expect(converterDeclarado(produtoB, '1', 'CX')).toBeNull();
    expect(converterDeclarado(produtoA, '1', 'PCT')).toBeNull();
  });

  it('sem declaração não há esperado zero; parcial não declara ausência; completa mostra não encontrado', () => {
    const semDeclaracao = comparar({ escopo: 'COMPLETA', totais: [total('5')], pendencias: [], declarados: [], saldo: null, produtos });
    expect(semDeclaracao.links[0]).toMatchObject({ declared: null, status: 'SEM_DECLARACAO', difference: null });
    const parcial = comparar({ escopo: 'PARCIAL', totais: [], pendencias: [], declarados: [declarado('12')], saldo: null, produtos });
    expect(parcial.links[0]).toMatchObject({ observed: null, status: 'PARCIAL', difference: null });
    const completa = comparar({ escopo: 'COMPLETA', totais: [], pendencias: [], declarados: [declarado('12')], saldo: null, produtos });
    expect(completa.links[0]).toMatchObject({ observed: '0', status: 'FALTA', difference: '-12' });
  });

  it('origem pendente não compensa a falta de uma devolução identificada', () => {
    const pendente = total('3', {
      key: chaveBase({ produtoId: PROD_A, lote: null, origemTipo: null, origemReferencia: null, condicao: 'SAUDAVEL' }),
      originType: null,
      originReference: null,
    });
    const c = comparar({ escopo: 'COMPLETA', totais: [total('9'), pendente], pendencias: [], declarados: [declarado('12')], saldo: null, produtos });
    expect(c.links.find((l) => l.originReference === 'NF-1')).toMatchObject({ observed: '9', difference: '-3', status: 'FALTA' });
    expect(c.links.find((l) => l.originType === null)).toMatchObject({ observed: '3', status: 'SEM_DECLARACAO' });
  });

  it('linha pendente de conversão torna a comparação do vínculo indisponível', () => {
    const c = comparar({
      escopo: 'COMPLETA',
      totais: [total('9')],
      pendencias: [
        { lineId: PROD_B, kind: 'FATOR_DESCONHECIDO', description: 'A', sku: '000A', codeRead: null, quantity: '1', unit: 'PCT', produtoId: PROD_A, origemTipo: 'NOTA_FISCAL', origemReferencia: 'NF-1' },
      ],
      declarados: [declarado('12')],
      saldo: null,
      produtos,
    });
    expect(c.links[0]).toMatchObject({ status: 'INDISPONIVEL', difference: null });
  });
});

describe('plano de reconciliação', () => {
  const SESSAO = '70000000-0000-4000-8000-000000000001';
  const chaveA = chaveBase({ produtoId: PROD_A, lote: null, origemTipo: null, origemReferencia: null, condicao: 'SAUDAVEL' });
  let seq = 0;
  const saldo = (quantidade: string, reservada = '0', condicao: 'SAUDAVEL' | 'AVARIADO' = 'SAUDAVEL', linhagem = 'linhagem-1', vinculada = '0'): SaldoAtual => ({
    vinculada,
    segmentoId: `30000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`,
    chave: chaveSegmento({ produtoId: PROD_A, lote: null, origemTipo: null, origemReferencia: null, condicao, linhagem }),
    linhagem,
    produtoId: PROD_A,
    lote: null,
    origemTipo: null,
    origemReferencia: null,
    condicao,
    sku: '000A',
    descricao: 'Produto A',
    unidade: 'UN',
    quantidade,
    reservada,
  });
  const totalA = (q: string): TotalObservado => ({
    key: chaveA,
    productId: PROD_A,
    sku: '000A',
    description: 'Produto A',
    lot: null,
    originType: null,
    originReference: null,
    condition: 'SAUDAVEL',
    quantity: q,
    unit: 'UN',
    lines: 1,
  });

  it('primeira reconciliação cria o saldo observado; pendente ganha a linhagem da conferência', () => {
    const plano = planejarReconciliacao([totalA('9')], [], SESSAO);
    expect(plano.mudancas.map((m) => [m.atual, m.alvo, m.delta, m.segmentoId, m.linhagem])).toEqual([['0', '9', '9', null, SESSAO]]);
    const identificadoNovo = planejarReconciliacao(
      [{ ...totalA('2'), key: chaveBase({ produtoId: PROD_A, lote: 'L1', origemTipo: 'DEVOLUCAO', origemReferencia: 'DEV-1', condicao: 'SAUDAVEL' }), lot: 'L1', originType: 'DEVOLUCAO', originReference: 'DEV-1' }],
      [],
      SESSAO,
    );
    // Lote e origem conhecidos: mesmo material em qualquer palete, sem linhagem.
    expect(identificadoNovo.mudancas.map((m) => m.linhagem)).toEqual([null]);
  });

  it('contagem que não distingue duas linhagens pendentes: igual mantém; diferente é conflito, sem escolher uma', () => {
    const duas = [saldo('4', '0', 'SAUDAVEL', 'linhagem-1'), saldo('3', '0', 'SAUDAVEL', 'linhagem-2')];
    expect(planejarReconciliacao([totalA('7')], duas, SESSAO)).toMatchObject({ mudancas: [], inalterados: 2, conflitos: [] });
    const diferente = planejarReconciliacao([totalA('6')], duas, SESSAO);
    expect(diferente.mudancas).toEqual([]);
    expect(diferente.conflitos[0]).toMatch(/2 linhagens pendentes distintas/);
    // Não encontradas na completa: cada linhagem vai a zero separadamente.
    expect(planejarReconciliacao([], duas, SESSAO).mudancas.map((m) => [m.linhagem, m.alvo])).toEqual(
      expect.arrayContaining([
        ['linhagem-1', '0'],
        ['linhagem-2', '0'],
      ]),
    );
  });

  it('ajusta contra o saldo atual; segmento não observado na completa vai a zero; igual não gera linha', () => {
    const plano = planejarReconciliacao([totalA('8')], [saldo('10'), saldo('2', '0', 'AVARIADO')], SESSAO);
    expect(plano.mudancas.map((m) => [m.condicao, m.atual, m.alvo, m.delta])).toEqual([
      ['AVARIADO', '2', '0', '-2'],
      ['SAUDAVEL', '10', '8', '-2'],
    ]);
    expect(planejarReconciliacao([totalA('10')], [saldo('10')], SESSAO)).toMatchObject({ mudancas: [], inalterados: 1, conflitos: [] });
  });

  it('não deixa o saldo abaixo do reservado: conflito em vez de sobrescrever', () => {
    const plano = planejarReconciliacao([totalA('3')], [saldo('9', '5')], SESSAO);
    expect(plano.conflitos).toHaveLength(1);
    expect(plano.conflitos[0]).toMatch(/abaixo dos 5 reservados/);
  });
});
