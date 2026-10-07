import { describe, expect, it } from 'vitest';
import { CONTRATO_MINIMO_INTERFACE, VERSAO_CONTRATO, VersaoServidorSchema, contratoAceito, interpretarLeitura } from './aplicativo.js';

const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const LOCAL = { origens: ['https://praca.exemplo.interno', 'http://127.0.0.1:4310'], caminhoBase: '/' };
const COM_BASE = { origens: ['https://praca.exemplo.interno'], caminhoBase: '/praca/' };

describe('interpretarLeitura', () => {
  it('ID permanente ou link exato desta instalação abre o palete', () => {
    expect(interpretarLeitura(ID, LOCAL)).toEqual({ tipo: 'palete', id: ID });
    expect(interpretarLeitura(ID.toUpperCase(), LOCAL)).toEqual({ tipo: 'palete', id: ID });
    expect(interpretarLeitura(`https://praca.exemplo.interno/paletes/${ID}`, LOCAL)).toEqual({ tipo: 'palete', id: ID });
    expect(interpretarLeitura(`http://127.0.0.1:4310/paletes/${ID}/`, LOCAL)).toEqual({ tipo: 'palete', id: ID });
    expect(interpretarLeitura(`https://praca.exemplo.interno/praca/paletes/${ID}`, COM_BASE)).toEqual({ tipo: 'palete', id: ID });
  });

  it('caminho-base diferente na mesma origem não é rota reconhecida', () => {
    expect(interpretarLeitura(`https://praca.exemplo.interno/paletes/${ID}`, COM_BASE).tipo).toBe('externo');
    expect(interpretarLeitura(`https://praca.exemplo.interno/paletes/${ID}/mover`, LOCAL).tipo).toBe('externo');
  });

  it('link de palete de outro endereço não abre sozinho', () => {
    expect(interpretarLeitura(`https://outro.exemplo/paletes/${ID}`, LOCAL)).toEqual({ tipo: 'palete-outra-origem', id: ID, origem: 'https://outro.exemplo' });
    expect(interpretarLeitura(`https://outro.exemplo/x/paletes/${ID}`, LOCAL)).toEqual({ tipo: 'palete-outra-origem', id: ID, origem: 'https://outro.exemplo' });
  });

  it('endereços externos, esquemas e credenciais são só texto', () => {
    for (const texto of [
      'https://exemplo.invalid/promocao',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      `https://usuario:senha@praca.exemplo.interno/paletes/${ID}`,
      'mailto:alguem@exemplo.invalid',
      `ftp://praca.exemplo.interno/paletes/${ID}`,
    ]) {
      expect(interpretarLeitura(texto, LOCAL).tipo, texto).toBe('externo');
    }
  });

  it('código de produto preserva zeros e caixa; só remove quebras das pontas', () => {
    expect(interpretarLeitura('0007891234567895', LOCAL)).toEqual({ tipo: 'codigo', codigo: '0007891234567895' });
    expect(interpretarLeitura('sku-abc-001\r\n', LOCAL)).toEqual({ tipo: 'codigo', codigo: 'sku-abc-001' });
    expect(interpretarLeitura('PAL-DEMO-001', LOCAL)).toEqual({ tipo: 'codigo', codigo: 'PAL-DEMO-001' });
  });

  it('vazio, controle, espaço interno ou longo demais é inválido', () => {
    for (const texto of ['', '   ', 'ABC\u0007DEF', 'COM ESPACO', 'x'.repeat(65)]) {
      expect(interpretarLeitura(texto, LOCAL).tipo, JSON.stringify(texto)).toBe('invalido');
    }
  });
});

describe('contrato entre interface e API', () => {
  it('aceita só a faixa declarada pela API', () => {
    const api = { contract: VERSAO_CONTRATO, minimumClientContract: CONTRATO_MINIMO_INTERFACE };
    expect(contratoAceito(VERSAO_CONTRATO, api)).toBe(true);
    expect(contratoAceito(CONTRATO_MINIMO_INTERFACE - 1, api)).toBe(false);
    expect(contratoAceito(VERSAO_CONTRATO + 1, api)).toBe(false);
    expect(contratoAceito(Number.NaN, api)).toBe(false);
  });

  it('caminho-base precisa começar e terminar com barra', () => {
    const base = { application: '0.9.0', contract: 9, minimumClientContract: 9, localDrafts: false, labelOrigin: 'https://x.invalid' };
    expect(VersaoServidorSchema.safeParse({ ...base, basePath: '/' }).success).toBe(true);
    expect(VersaoServidorSchema.safeParse({ ...base, basePath: '/praca/' }).success).toBe(true);
    expect(VersaoServidorSchema.safeParse({ ...base, basePath: '/praca' }).success).toBe(false);
    expect(VersaoServidorSchema.safeParse({ ...base, basePath: '//x/' }).success).toBe(false);
  });
});
