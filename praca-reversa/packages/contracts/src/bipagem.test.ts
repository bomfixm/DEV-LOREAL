import { describe, expect, it } from 'vitest';
import { chaveIdentidadeBipagem, cnpjComparavel, compararIdentidade, digitosCnpj, grupoTipoDocumento, normalizarRotuloBipagem, remetenteComparavel, tipoDocumentoBipagem } from './bipagem.js';

/** Regra de notas repetidas combinada com o usuário (mesmos casos do leitor Python de referência, `testar_leitor.py`). */
const base = { tipo: 'NF-e', numero: '000123', cnpj: '08.250.575/0002-55', remetente: 'Empresa Exemplo' };

describe('bipagem: tipos e CNPJ', () => {
  it('NF-e e Minuta têm código interno próprio; NF-e nunca vira NFD; tipo desconhecido não é adivinhado', () => {
    expect(tipoDocumentoBipagem('NF-e')).toEqual({ codigo: 'NF', original: 'NF-e' });
    expect(tipoDocumentoBipagem(' nfe ')).toEqual({ codigo: 'NF', original: 'NF-e' });
    expect(tipoDocumentoBipagem('Minuta')).toEqual({ codigo: 'MI', original: 'Minuta' });
    expect(tipoDocumentoBipagem('NFD')).toEqual({ codigo: 'NFD', original: 'NFD' });
    expect(tipoDocumentoBipagem('CT-e')).toBeNull();
    expect(normalizarRotuloBipagem('  Última   Leitura ')).toBe('ultima leitura');
    expect(normalizarRotuloBipagem('Número')).toBe('numero');
  });

  it('CNPJ: só dígitos na comparação, zeros preservados, nunca completado por suposição', () => {
    expect(digitosCnpj('03.962.539/0002-09')).toBe('03962539000209');
    expect(cnpjComparavel('08.250.575/0002-55')).toBe('08250575000255');
    expect(cnpjComparavel('8250575000255')).toBeNull();
    expect(remetenteComparavel('  Empresa   EXEMPLO ')).toBe('empresa exemplo');
    expect(remetenteComparavel('Distribuição São João')).toBe('distribuicao sao joao');
  });
});

describe('bipagem: mesma nota no mesmo palete', () => {
  it('mesma identidade (tipo, número, CNPJ e remetente) pede decisão, independentemente da quantidade', () => {
    expect(compararIdentidade(base, { ...base, remetente: 'EMPRESA EXEMPLO', cnpj: '08250575000255' })).toBe('COINCIDE');
  });

  it('CNPJ ou remetente diferentes = outra entrada (sem aviso só pelo número)', () => {
    expect(compararIdentidade(base, { ...base, cnpj: '03.962.539/0002-09' })).toBe('DIFERENTE');
    expect(compararIdentidade(base, { ...base, remetente: 'Outra Empresa' })).toBe('DIFERENTE');
    expect(compararIdentidade(base, { ...base, numero: '000124' })).toBe('DIFERENTE');
  });

  it('CNPJ ou remetente ausente não comprova igualdade: identificação incompleta', () => {
    expect(compararIdentidade(base, { ...base, cnpj: null })).toBe('INCOMPLETA');
    expect(compararIdentidade(base, { ...base, remetente: null })).toBe('INCOMPLETA');
    expect(compararIdentidade({ ...base, cnpj: null }, { ...base, cnpj: null })).toBe('INCOMPLETA');
    // Diferença informada vence a falta do outro campo.
    expect(compararIdentidade({ ...base, cnpj: null }, { ...base, cnpj: null, remetente: 'Outra' })).toBe('DIFERENTE');
  });

  it('tipo legado equivalente (NFE, NF) coincide; NFD é outro documento; número é comparado como texto', () => {
    expect(grupoTipoDocumento('NF-e')).toBe('nfe');
    expect(compararIdentidade(base, { ...base, tipo: 'NFE' })).toBe('COINCIDE');
    expect(compararIdentidade(base, { ...base, tipo: 'NF' })).toBe('COINCIDE');
    expect(compararIdentidade({ ...base, tipo: 'Minuta' }, { ...base, tipo: 'MI' })).toBe('COINCIDE');
    expect(compararIdentidade(base, { ...base, tipo: 'NFD' })).toBe('DIFERENTE');
    expect(compararIdentidade(base, { ...base, numero: '123' })).toBe('DIFERENTE');
  });

  it('chave legível guarda tipo, número, CNPJ e remetente normalizados', () => {
    expect(chaveIdentidadeBipagem(base)).toBe('nfe|000123|08250575000255|empresa exemplo');
  });
});
