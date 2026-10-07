import {
  CriarClaimSchema,
  RegistrarResultadoSchema,
  compararValores,
  normalizarValor,
  permissoesDoVinculo,
  somarValores,
  totaisPorMoeda,
  valorUnitarioVezesQuantidade,
} from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import { tipoDoConteudo } from '../../src/modules/claims/evidencias.js';
import {
  estimadoDoCaso,
  estimativaParaCobertura,
  estimativaTotalLinha,
  origemDaLinhaPendente,
  pendenciasDaLinha,
  porUnidade,
  situacaoAposDecisao,
  transicoesPermitidas,
  verificarMaterial,
  type LinhaRegra,
} from '../../src/modules/claims/regras.js';
import { vinculadaAMover } from '../../src/modules/claims/vinculos.js';

const PROD = '50000000-0000-4000-8000-000000000001';
const OUTRO = '50000000-0000-4000-8000-000000000002';

const linha = (extra: Partial<LinhaRegra> = {}): LinhaRegra => ({
  id: '60000000-0000-4000-8000-000000000001',
  identificador: '1',
  produtoId: PROD,
  sku: '000123',
  unidade: 'UN',
  unidadeCanonica: 'UN',
  quantidade: '12',
  lote: 'L-01',
  loteExigido: false,
  origemTipo: 'DEVOLUCAO',
  origemReferencia: 'DEV-A-01',
  origemLinha: '1',
  valorEstimado: '10.00',
  baseValor: 'UNITARIO',
  recuperada: '0',
  coberta: '0',
  ...extra,
});

const material = { produtoId: PROD, sku: '000123', unidade: 'UN', lote: 'L-01', origemTipo: 'DEVOLUCAO' as const, origemReferencia: 'DEV-A-01', condicao: 'SAUDAVEL' as const };

describe('compatibilidade de candidatos (pistas, não prova)', () => {
  it('mesmo SKU, lote e devolução: compatível, sem bloqueios', () => {
    const v = verificarMaterial(linha(), 'EXTRAVIO_FALTA', material);
    expect(v.checks).toEqual({ product: 'COMPATIVEL', lot: 'COMPATIVEL', origin: 'COMPATIVEL', condition: 'COMPATIVEL' });
    expect(v.bloqueios).toEqual([]);
    expect(v.pistas.join(' ')).not.toMatch(/%/);
  });

  it('mesmo SKU de outra devolução: origem incompatível e bloqueio', () => {
    const v = verificarMaterial(linha(), 'EXTRAVIO_FALTA', { ...material, origemReferencia: 'DEV-B-02' });
    expect(v.checks.origin).toBe('INCOMPATIVEL');
    expect(v.bloqueios.join(' ')).toContain('Mesmo SKU de outra devolução não regulariza');
  });

  it('NF sozinha e origem pendente não identificam devolução e linha', () => {
    expect(origemDaLinhaPendente({ origemTipo: 'NOTA_FISCAL', origemReferencia: '000045' })).toContain('NF');
    expect(verificarMaterial(linha({ origemTipo: 'NOTA_FISCAL', origemReferencia: '000045' }), 'EXTRAVIO_FALTA', material).checks.origin).toBe('PENDENTE');
    expect(verificarMaterial(linha(), 'EXTRAVIO_FALTA', { ...material, origemReferencia: null, origemTipo: null }).checks.origin).toBe('PENDENTE');
  });

  it('documento da linha com outro produto torna a origem incompatível', () => {
    const v = verificarMaterial(linha(), 'EXTRAVIO_FALTA', material, { produtoId: OUTRO, lote: null });
    expect(v.checks.origin).toBe('INCOMPATIVEL');
  });

  it('lote exigido divergente ou desconhecido: bloqueio de lote (tratativa documentada)', () => {
    expect(verificarMaterial(linha({ loteExigido: true }), 'EXTRAVIO_FALTA', { ...material, lote: 'L-99' }).bloqueioLote).toContain('L-99');
    expect(verificarMaterial(linha({ loteExigido: true }), 'EXTRAVIO_FALTA', { ...material, lote: null }).checks.lot).toBe('PENDENTE');
    expect(verificarMaterial(linha(), 'EXTRAVIO_FALTA', { ...material, lote: 'L-99' }).checks.lot).toBe('NAO_EXIGIDO');
  });

  it('condição: falta exige saudável; avaria aceita avariado e mantém o motivo em avaliação', () => {
    expect(verificarMaterial(linha(), 'EXTRAVIO_FALTA', { ...material, condicao: 'AVARIADO' }).checks.condition).toBe('INCOMPATIVEL');
    const avaria = verificarMaterial(linha(), 'AVARIA', { ...material, condicao: 'AVARIADO' });
    expect(avaria.checks.condition).toBe('COMPATIVEL');
    expect(avaria.pistas.join(' ')).toContain('continua em avaliação');
    expect(verificarMaterial(linha(), 'AVARIA', material).checks.condition).toBe('PENDENTE');
  });

  it('produto fora do cadastro e unidade diferente bloqueiam', () => {
    expect(verificarMaterial(linha({ produtoId: null }), 'EXTRAVIO_FALTA', material).checks.product).toBe('PENDENTE');
    expect(verificarMaterial(linha({ unidade: 'CX' }), 'EXTRAVIO_FALTA', material).bloqueios.join(' ')).toContain('Unidade');
  });
});

describe('estimativas e valores exatos', () => {
  it('unitário × quantidade; total nunca é multiplicado de novo', () => {
    expect(estimativaTotalLinha(linha())).toBe('120.00');
    expect(estimativaTotalLinha(linha({ valorEstimado: '120.00', baseValor: 'TOTAL_LINHA' }))).toBe('120.00');
    expect(estimativaTotalLinha(linha({ valorEstimado: '0.33', quantidade: '1.5' }))).toBe('0.495');
  });

  it('estimativa para cobertura parcial: unitário proporcional; total só cobrindo a linha inteira', () => {
    expect(estimativaParaCobertura(linha(), '3')).toBe('30.00');
    expect(estimativaParaCobertura(linha({ valorEstimado: '120.00', baseValor: 'TOTAL_LINHA' }), '3')).toBeNull();
    expect(estimativaParaCobertura(linha({ valorEstimado: '120.00', baseValor: 'TOTAL_LINHA' }), '12')).toBe('120.00');
  });

  it('moedas e unidades nunca se somam entre si', () => {
    expect(totaisPorMoeda([{ moeda: 'USD', valor: '1.50' }, { moeda: 'BRL', valor: '2.25' }, { moeda: 'BRL', valor: '0.75' }])).toEqual([
      { currency: 'BRL', value: '3.00' },
      { currency: 'USD', value: '1.50' },
    ]);
    expect(porUnidade([{ unidade: 'UN', quantidade: '3' }, { unidade: 'CX', quantidade: '1' }, { unidade: 'UN', quantidade: '2' }])).toEqual([
      { unit: 'CX', quantity: '1' },
      { unit: 'UN', quantity: '5' },
    ]);
    expect(estimadoDoCaso([linha(), linha({ valorEstimado: null, baseValor: null })], 'BRL')).toEqual({ estimado: [{ currency: 'BRL', value: '120.00' }], parcial: true });
  });

  it('aritmética monetária sem ponto flutuante', () => {
    expect(somarValores(['0.10', '0.20'])).toBe('0.30');
    expect(valorUnitarioVezesQuantidade('19.99', '3')).toBe('59.97');
    expect(normalizarValor('7.5')).toBe('7.50');
    expect(compararValores('30.00', '30')).toBe(0);
  });
});

describe('pendências, situação e alocação', () => {
  it('pendências de triagem bloqueiam a validação; avaria fica em avaliação até resultado', () => {
    const p = pendenciasDaLinha(linha({ produtoId: null, origemReferencia: null, origemTipo: null, loteExigido: true, lote: null }), 'AVARIA', '0');
    expect(p.filter((x) => x.blocksValidation).map((x) => x.code)).toEqual(['PRODUTO_NAO_CADASTRADO', 'ORIGEM_PENDENTE', 'LOTE_PENDENTE']);
    expect(p.map((x) => x.code)).toContain('AVARIA_EM_AVALIACAO');
    expect(pendenciasDaLinha(linha({ recuperada: '12' }), 'EXTRAVIO_FALTA', '0').map((x) => x.code)).not.toContain('SEM_RECUPERACAO_VALIDADA');
  });

  it('transições manuais só entre as situações de investigação e sem validação pendente', () => {
    expect(transicoesPermitidas('EM_ANALISE', 0)).toEqual(['BUSCA_EM_ANDAMENTO', 'CANDIDATO_LOCALIZADO']);
    expect(transicoesPermitidas('BUSCA_EM_ANDAMENTO', 1)).toEqual([]);
    expect(transicoesPermitidas('REGULARIZADO', 0)).toEqual([]);
    expect(situacaoAposDecisao(0)).toBe('CANDIDATO_LOCALIZADO');
    expect(situacaoAposDecisao(2)).toBe('VALIDACAO_PENDENTE');
  });

  it('transferência: a parte livre sai primeiro; só o que passa dela leva o vínculo', () => {
    expect(vinculadaAMover('5', '0', '3', '2')).toBe('0');
    expect(vinculadaAMover('5', '0', '3', '4')).toBe('2');
    expect(vinculadaAMover('5', '1', '3', '4')).toBe('3');
    expect(vinculadaAMover('5', '0', '5', '1')).toBe('1');
  });

  it('aprovação financeira só por concessão a perfil elegível', () => {
    expect(permissoesDoVinculo('ANALISTA_CLAIMS', false)).not.toContain('claim.aprovar_financeiro');
    expect(permissoesDoVinculo('ANALISTA_CLAIMS', true)).toContain('claim.aprovar_financeiro');
    expect(permissoesDoVinculo('ADMINISTRADOR', true)).not.toContain('claim.aprovar_financeiro');
    expect(permissoesDoVinculo('OPERADOR', true)).not.toContain('claim.tratar');
  });

  it('anexo: tipo pelo conteúdo, não pela extensão', () => {
    expect(tipoDoConteudo(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(tipoDoConteudo(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(tipoDoConteudo(Buffer.from('RIFF0000WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(tipoDoConteudo(Buffer.from('<svg></svg>'))).toBeNull();
  });
});

describe('contratos de cadastro e resultado', () => {
  const base = {
    reason: 'EXTRAVIO_FALTA',
    lines: [{ lineRef: '1', sku: '000123', quantity: '12', unit: 'UN', estimatedValue: '10.00', valueBase: 'UNITARIO' }],
  };
  it('valor estimado exige base, moeda e fonte; linha repetida é recusada', () => {
    expect(CriarClaimSchema.safeParse(base).success).toBe(false);
    expect(CriarClaimSchema.safeParse({ ...base, currency: 'BRL', valueSource: 'Tabela' }).success).toBe(true);
    const semBase = { ...base, currency: 'BRL', valueSource: 'Tabela', lines: [{ ...base.lines[0], valueBase: null }] };
    expect(CriarClaimSchema.safeParse(semBase).success).toBe(false);
    const repetida = { ...base, currency: 'BRL', valueSource: 'Tabela', lines: [base.lines[0], base.lines[0]] };
    expect(CriarClaimSchema.safeParse(repetida).success).toBe(false);
  });

  it('resultado exige evidência, fonte, referência; valor e moeda juntos', () => {
    const r = { type: 'REGULARIZACAO', decisionDate: '2026-10-05', lines: [{ lineId: '60000000-0000-4000-8000-000000000001', quantity: '3' }], value: '30.00', currency: 'BRL', source: 'Portal', reference: 'R-1' };
    expect(RegistrarResultadoSchema.safeParse(r).success).toBe(false);
    expect(RegistrarResultadoSchema.safeParse({ ...r, evidenceIds: ['70000000-0000-4000-8000-000000000001'] }).success).toBe(true);
    expect(RegistrarResultadoSchema.safeParse({ ...r, currency: null, evidenceIds: ['70000000-0000-4000-8000-000000000001'] }).success).toBe(false);
  });
});
