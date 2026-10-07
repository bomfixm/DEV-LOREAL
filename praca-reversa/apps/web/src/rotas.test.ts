import { describe, expect, it } from 'vitest';
import { caminhoDe, destinoSeguro, lerRota } from './rotas';

const ID = '00000000-0000-4000-8000-000000000001';

describe('rotas', () => {
  it('lê e reconstrói as rotas estáveis', () => {
    expect(lerRota(`/paletes/${ID}`, '')).toEqual({ tipo: 'palete', id: ID });
    expect(lerRota(`/paletes/${ID.toUpperCase()}/`, '')).toEqual({ tipo: 'palete', id: ID });
    expect(lerRota('/paletes/novo', '')).toEqual({ tipo: 'novo-palete' });
    expect(lerRota('/etiquetas', `?ids=${ID},${ID},nao-uuid`)).toEqual({ tipo: 'etiquetas', ids: [ID] });
    expect(lerRota('/paletes/123', '')).toEqual({ tipo: 'desconhecida' });
    expect(caminhoDe({ tipo: 'entrar', retorno: `/paletes/${ID}` })).toBe(`/entrar?retorno=%2Fpaletes%2F${ID}`);
  });

  it('movimentações do palete têm endereço próprio pelo ID permanente', () => {
    for (const tipo of ['mover', 'transferir', 'historico'] as const) {
      expect(lerRota(`/paletes/${ID}/${tipo}`, '')).toEqual({ tipo, id: ID });
      expect(caminhoDe({ tipo, id: ID })).toBe(`/paletes/${ID}/${tipo}`);
      expect(destinoSeguro(`/paletes/${ID}/${tipo}`)).toBe(`/paletes/${ID}/${tipo}`);
    }
    expect(lerRota(`/paletes/${ID}/apagar`, '')).toEqual({ tipo: 'desconhecida' });
    expect(lerRota(`/paletes/nao-e-id/mover`, '')).toEqual({ tipo: 'desconhecida' });
  });

  it('seleção do cliente, inventários e importação com tipo escolhido', () => {
    expect(lerRota('/selecoes', '')).toEqual({ tipo: 'selecoes' });
    expect(lerRota(`/selecoes/${ID}`, '?situacao=AMBIGUO,NAO_ENCONTRADO')).toEqual({ tipo: 'selecao', id: ID, situacao: 'AMBIGUO,NAO_ENCONTRADO' });
    expect(lerRota(`/selecoes/${ID}`, '?situacao=<script>')).toEqual({ tipo: 'selecao', id: ID, situacao: null });
    expect(caminhoDe({ tipo: 'selecao', id: ID, situacao: 'AMBIGUO' })).toBe(`/selecoes/${ID}?situacao=AMBIGUO`);
    expect(lerRota(`/inventarios/${ID}`, '')).toEqual({ tipo: 'inventario', id: ID });
    expect(lerRota('/importacoes/nova', '?tipo=SELECAO_CLIENTE')).toEqual({ tipo: 'nova-importacao', importar: 'SELECAO_CLIENTE' });
    expect(lerRota('/importacoes/nova', '?tipo=OUTRO')).toEqual({ tipo: 'nova-importacao' });
    expect(destinoSeguro('/importacoes/nova?tipo=INVENTARIO')).toBe('/importacoes/nova?tipo=INVENTARIO');
    expect(lerRota('/selecoes/nao-e-id', '')).toEqual({ tipo: 'desconhecida' });
  });

  it('destino de retorno só aceita caminhos internos conhecidos', () => {
    expect(destinoSeguro(`/paletes/${ID}`)).toBe(`/paletes/${ID}`);
    expect(destinoSeguro(`/etiquetas?ids=${ID}`)).toBe(`/etiquetas?ids=${ID}`);
    expect(destinoSeguro('/produtos')).toBe('/produtos');
    for (const malicioso of [
      'https://exemplo.invalid/paletes',
      '//exemplo.invalid/paletes',
      '/\\exemplo.invalid',
      'javascript:alert(1)',
      '/%2F%2Fexemplo.invalid',
      '/entrar?retorno=https://exemplo.invalid',
      '/paletes/nao-e-id',
      ' /produtos',
      '/produtos\n',
      null,
    ]) {
      expect(destinoSeguro(malicioso), String(malicioso)).toBe('/');
    }
  });
});
