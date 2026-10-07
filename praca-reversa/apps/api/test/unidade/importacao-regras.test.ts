import type { SeparadorDecimal } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import type { CelulaTabela, LinhaTabela, Tabela } from '../../src/modules/importacao/arquivo/ler.js';
import type { TipoValor } from '../../src/modules/importacao/arquivo/xlsx.js';
import { LIMITES_IMPORTACAO_PADRAO } from '../../src/modules/importacao/campos.js';
import { classificarDevolucoes, interpretarDevolucoes, type EstadoDevolucoes } from '../../src/modules/importacao/devolucoes.js';
import { chaveLinhaDocumento, data, decimalExato, identificador, linhaDocumento, quantidade } from '../../src/modules/importacao/interpretar.js';
import { classificarProdutos, interpretarProdutos, type EstadoProdutos } from '../../src/modules/importacao/produtos.js';

const cel = (texto: string | null, tipo: TipoValor = 'TEXTO', formula = false): CelulaTabela => ({ texto, tipo, formula, formatoTexto: tipo === 'TEXTO', longa: false });
const F = { campo: 'x', rotulo: 'Campo' };
const valor = <T>(r: { ok: true; valor: T } | { ok: false }) => (r.ok ? r.valor : null);
const codigo = (r: { ok: boolean; motivo?: { code: string } }) => (r.ok ? 'OK' : (r.motivo?.code ?? '?'));

describe('Identificadores: texto exato, sem reconstrução', () => {
  it('preserva zeros e só remove espaços das pontas', () => {
    expect(valor(identificador(cel('  000123 '), F, 1000))).toBe('000123');
    expect(valor(identificador(undefined, F, 1000))).toBeNull();
  });

  it('número, data, notação científica e fórmula viram pendência específica', () => {
    expect(codigo(identificador(cel('123', 'NUMERO'), F, 1000))).toBe('IDENTIFICADOR_NUMERICO');
    expect(codigo(identificador(cel('2026-09-15', 'DATA'), F, 1000))).toBe('IDENTIFICADOR_NUMERICO');
    expect(codigo(identificador(cel('7,89123E+12'), F, 1000))).toBe('NOTACAO_CIENTIFICA');
    expect(codigo(identificador(cel('7.89123456789012E+15'), F, 1000))).toBe('NOTACAO_CIENTIFICA');
    expect(codigo(identificador(cel('ABC', 'TEXTO', true), F, 1000))).toBe('FORMULA');
    expect(codigo(identificador(cel('#N/A', 'ERRO'), F, 1000))).toBe('ERRO_CELULA');
    expect(codigo(identificador(cel('A B'), F, 1000, { semEspacos: true }))).toBe('IDENTIFICADOR_INVALIDO');
    expect(codigo(identificador(cel('x'.repeat(65)), F, 1000))).toBe('IDENTIFICADOR_INVALIDO');
  });

  it('linha do documento: inteiro do XLSX aceito; só dígitos comparados sem zeros à esquerda', () => {
    expect(valor(linhaDocumento(cel('1', 'NUMERO'), F, 1000))).toBe('1');
    expect(codigo(linhaDocumento(cel('1.5', 'NUMERO'), F, 1000))).toBe('IDENTIFICADOR_NUMERICO');
    expect(valor(linhaDocumento(cel('001'), F, 1000))).toBe('001');
    expect(chaveLinhaDocumento('001')).toBe('1');
    expect(chaveLinhaDocumento('000')).toBe('0');
    expect(chaveLinhaDocumento('A01')).toBe('A01');
  });
});

describe('Quantidades exatas', () => {
  const q = (texto: string, tipo: TipoValor = 'TEXTO', sep: SeparadorDecimal = 'VIRGULA') => quantidade(cel(texto, tipo), F, sep, 1000);

  it('separador escolhido; sem milhar; até 3 casas; maior que zero', () => {
    expect(valor(q('1,5'))).toBe('1.5');
    expect(valor(q('1.5', 'TEXTO', 'PONTO'))).toBe('1.5');
    expect(valor(q('007'))).toBe('7');
    expect(valor(q('12,500'))).toBe('12.5');
    expect(codigo(q('1.234,5'))).toBe('QUANTIDADE_AMBIGUA');
    expect(codigo(q('1.5'))).toBe('QUANTIDADE_AMBIGUA');
    expect(codigo(q('1,5', 'TEXTO', 'PONTO'))).toBe('QUANTIDADE_AMBIGUA');
    expect(codigo(q('1,2345'))).toBe('CASAS_DECIMAIS');
    expect(codigo(q('0'))).toBe('QUANTIDADE_INVALIDA');
    expect(codigo(q('-3'))).toBe('QUANTIDADE_INVALIDA');
    expect(codigo(q('dez'))).toBe('QUANTIDADE_INVALIDA');
  });

  it('número do XLSX: valor binário pela menor representação, sem arredondar além dela', () => {
    expect(valor(q('100', 'NUMERO'))).toBe('100');
    expect(valor(q('1.0049999999999999', 'NUMERO'))).toBe('1.005');
    expect(valor(q('1E-3', 'NUMERO'))).toBe('0.001');
    expect(valor(q('1.5E+2', 'NUMERO'))).toBe('150');
    const r = q('1.2344999999999999', 'NUMERO');
    expect(codigo(r)).toBe('CASAS_DECIMAIS');
    expect(r.ok ? '' : r.motivo.message).toContain('1.2345');
    expect(codigo(quantidade(cel('100', 'NUMERO', true), F, 'VIRGULA', 1000))).toBe('FORMULA');
    expect(decimalExato('0.30000000000000004')).toEqual({ inteiro: '0', fracao: '30000000000000004', negativo: false });
  });
});

describe('Datas do documento', () => {
  const d = (texto: string, tipo: TipoValor = 'TEXTO') => data(cel(texto, tipo), F, 1000);
  it('DD/MM/AAAA e AAAA-MM-DD; célula de data do XLSX', () => {
    expect(valor(d('15/09/2026'))).toBe('2026-09-15');
    expect(valor(d('2026-09-15'))).toBe('2026-09-15');
    expect(valor(d('2026-09-15', 'DATA'))).toBe('2026-09-15');
  });
  it('data inválida, ambígua ou com hora é recusada', () => {
    expect(codigo(d('31/02/2026'))).toBe('DATA_INVALIDA');
    expect(codigo(d('15/09/26'))).toBe('DATA_INVALIDA');
    expect(codigo(d('09/15/2026'))).toBe('DATA_INVALIDA');
    expect(codigo(d('46280', 'NUMERO'))).toBe('DATA_AMBIGUA');
    expect(codigo(d('2026-09-15T12:00:00', 'DATA'))).toBe('DATA_COM_HORA');
  });
});

// ---------- Classificação (sem banco: estado informado) ----------

function tabela(cabecalho: string[], linhas: (string | null)[][]): Tabela {
  const dados: LinhaTabela[] = linhas.map((l, i) => ({ numero: i + 2, celulas: l.map((v) => (v === null ? undefined : cel(v))) }));
  return {
    formato: 'CSV',
    planilhas: [],
    opcoes: { sheet: null, headerRow: 1, encoding: 'UTF-8', delimiter: 'PONTO_E_VIRGULA' },
    interpretacao: [],
    avisos: [],
    cabecalho: cabecalho.map((t, indice) => ({ indice, letra: String.fromCharCode(65 + indice), texto: t })),
    linhas: dados,
    vazias: 0,
  };
}

const colunasDe = (campos: string[]) => Object.fromEntries(campos.map((c, i) => [c, i]));

describe('Classificação de produtos', () => {
  const campos = ['sku', 'description', 'canonicalUnit', 'barcode', 'packaging', 'factor'];
  const estado: EstadoProdutos = {
    porSku: new Map([['000123', { id: 'p1', sku: '000123', descricao: 'Xampu', unidade: 'UN', ativo: true }]]),
    porSkuMaiusculo: new Map([['000123', ['000123']], ['DEMO-1', ['DEMO-1']]]),
    codigos: new Map([['0789', { codigo: '0789', produtoId: 'p1', sku: '000123', embalagem: 'UN', fator: '1' }]]),
    codigosPorProduto: new Map([['p1', 1]]),
  };
  const classificar = (linhas: (string | null)[][]) =>
    classificarProdutos(interpretarProdutos({ tabela: tabela(campos, linhas), colunas: colunasDe(campos), separador: 'VIRGULA', limites: LIMITES_IMPORTACAO_PADRAO }), estado);

  it('nova, duplicada (cadastro e arquivo), conflitante e inválida', () => {
    const { linhas, plano } = classificar([
      ['000123', 'Xampu', 'UN', '0789', 'UN', '1'], // 2: igual ao cadastro → duplicada
      ['000123', 'Xampu', 'UN', '1789', 'CX', '12'], // 3: código novo do produto existente → nova
      ['000123', 'Xampu', 'CX', null, null, null], // 4: unidade canônica diferente → conflito
      ['000456', 'Condicionador', 'UN', null, null, null], // 5: nova
      ['000456', 'Condicionador', 'UN', null, null, null], // 6: igual à linha 5 → duplicada
      ['000456', 'Outro nome', 'UN', null, null, null], // 7: mesmo SKU, outra descrição → conflito
      ['demo-1', 'Semelhante', 'UN', null, null, null], // 8: só difere em maiúsculas → conflito
      ['000789', 'Sem embalagem', 'UN', '0999', null, null], // 9: código sem embalagem → inválida
      ['000790', 'Fator pendente', 'UN', '1999', 'CX', null], // 10: nova com aviso de fator pendente
      ['000791', 'Fator errado', 'UN', '2999', 'UN', '12'], // 11: embalagem = canônica com fator ≠ 1 → inválida
      ['000792', 'Código de outro', 'UN', '0789', 'UN', '1'], // 12: código de outro produto → conflito
    ]);
    expect(linhas.map((l) => [l.numero, l.classificacao, l.motivos.map((m) => m.code).join(',')])).toEqual([
      [2, 'DUPLICADA', 'DUPLICADA_EXISTENTE,DUPLICADA_EXISTENTE'],
      [3, 'VALIDA_NOVA', ''],
      [4, 'CONFLITANTE', 'UNIDADE_CANONICA_DIFERENTE'],
      [5, 'VALIDA_NOVA', ''],
      [6, 'DUPLICADA', 'DUPLICADA_NO_ARQUIVO'],
      [7, 'CONFLITANTE', 'CONFLITO_NO_ARQUIVO'],
      [8, 'CONFLITANTE', 'SKU_SEMELHANTE'],
      [9, 'INVALIDA', 'EMBALAGEM_OBRIGATORIA'],
      [10, 'VALIDA_NOVA', ''],
      [11, 'INVALIDA', 'FATOR_INVALIDO'],
      [12, 'CONFLITANTE', 'CODIGO_DE_OUTRO_PRODUTO'],
    ]);
    expect(linhas[8]?.avisos.map((a) => a.code)).toEqual(['FATOR_PENDENTE']);
    expect(plano.produtosNovos.map((p) => p.sku)).toEqual(['000456', '000790']);
    expect(plano.codigosNovos.map((c) => [c.codigo, c.fator])).toEqual([
      ['1789', '12'],
      ['1999', null],
    ]);
    expect([...plano.produtosAlterados]).toEqual(['p1']);
  });
});

describe('Classificação de documentos de devolução', () => {
  const campos = ['returnReference', 'lineReference', 'sku', 'quantity', 'unit', 'invoice', 'lot', 'documentDate'];
  const estado: EstadoDevolucoes = {
    produtos: new Map([
      ['000123', { id: 'p1', sku: '000123', ativo: true, unidade: 'UN', embalagens: [{ embalagem: 'UN', fator: '1' }, { embalagem: 'CX', fator: '12' }, { embalagem: 'PCT', fator: null }] }],
      ['INATIVO', { id: 'p2', sku: 'INATIVO', ativo: false, unidade: 'UN', embalagens: [] }],
    ]),
    porSkuMaiusculo: new Map([['000123', ['000123']], ['DEMO-1', ['DEMO-1']]]),
    documentos: new Map([['DEV-1', 'd1']]),
    linhas: new Map([['DEV-1' + String.fromCharCode(31) + '1', { documentoId: 'd1', sku: '000123', quantidade: '100', unidade: 'UN', lote: null, notaFiscal: '000045678', data: null, loteImportacaoId: 'aaaaaaaa-0000', linhaArquivo: 2 }]]),
  };
  const classificar = (linhas: (string | null)[][]) =>
    classificarDevolucoes(interpretarDevolucoes({ tabela: tabela(campos, linhas), colunas: colunasDe(campos), separador: 'VIRGULA', limites: LIMITES_IMPORTACAO_PADRAO }), estado);

  it('chave = devolução + linha; mesma chave igual → duplicada; diferente → conflito; erros específicos', () => {
    const { linhas, plano } = classificar([
      ['DEV-1', '001', '000123', '100', 'UN', '000045678', null, null], // 2: igual à já importada (001 = 1) → duplicada
      ['DEV-1', '1', '000123', '90', 'UN', '000045678', null, null], // 3: mesma chave, outra quantidade → conflito
      ['DEV-2', '1', '000123', '2', 'CX', null, 'L1', '15/09/2026'], // 4: nova (2 CX = 24 UN)
      ['DEV-2', '1', '000123', '2', 'CX', null, 'L1', '15/09/2026'], // 5: repetida no arquivo → duplicada
      ['DEV-2', '2', 'NAOEXISTE', '1', 'UN', null, null, null], // 6: SKU não cadastrado
      ['DEV-2', '3', '000123', '1', 'KG', null, null, null], // 7: unidade incompatível
      ['DEV-2', '4', '000123', '1', 'PCT', null, null, null], // 8: fator desconhecido
      [null, '5', '000123', '1', 'UN', null, null, null], // 9: sem referência → chave incompleta
      ['DEV-2', '6', 'INATIVO', '1', 'UN', null, null, null], // 10: SKU inativo
      ['DEV-2', '7', 'demo-1', '1', 'UN', null, null, null], // 11: não cadastrado (existe DEMO-1)
      ['DEV-2', '8', '000123', '1,5', 'UN', null, null, null], // 12: UN fracionado
      ['DEV-1', '2', '000123', '1', 'UN', null, null, null], // 13: linha nova num documento existente
    ]);
    expect(linhas.map((l) => [l.numero, l.classificacao, l.motivos.map((m) => m.code).join(',')])).toEqual([
      [2, 'DUPLICADA', 'DUPLICADA_EXISTENTE'],
      [3, 'CONFLITANTE', 'CONFLITO_EXISTENTE'],
      [4, 'VALIDA_NOVA', ''],
      [5, 'DUPLICADA', 'DUPLICADA_NO_ARQUIVO'],
      [6, 'INVALIDA', 'SKU_NAO_CADASTRADO'],
      [7, 'INVALIDA', 'UNIDADE_INCOMPATIVEL'],
      [8, 'INVALIDA', 'FATOR_DESCONHECIDO'],
      [9, 'INVALIDA', 'CAMPO_OBRIGATORIO,CHAVE_INCOMPLETA'],
      [10, 'INVALIDA', 'SKU_INATIVO'],
      [11, 'INVALIDA', 'SKU_NAO_CADASTRADO'],
      [12, 'INVALIDA', 'QUANTIDADE_NAO_INTEIRA'],
      [13, 'VALIDA_NOVA', ''],
    ]);
    expect(linhas[1]?.motivos[0]?.message).toContain('quantidade 100 UN → 90 UN');
    expect(linhas[9]?.motivos[0]?.message).toContain('existe DEMO-1');
    expect(linhas[2]?.valores).toMatchObject({ quantity: '2', unit: 'CX', factor: '12', canonicalQuantity: '24', canonicalUnit: 'UN', lot: 'L1', documentDate: '2026-09-15' });
    expect(plano.documentosNovos.map((d) => d.referencia)).toEqual(['DEV-2']);
    expect(plano.linhasNovas.map((l) => [l.referencia, l.chaveLinha, l.canonica])).toEqual([
      ['DEV-2', '1', '24'],
      ['DEV-1', '2', '1'],
    ]);
  });
});
