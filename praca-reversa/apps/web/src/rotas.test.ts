import { describe, expect, it } from 'vitest';
import { caminhoDe, destinoSeguro, ehEnderecoAntigo, lerRota } from './rotas';

const ID = '00000000-0000-4000-8000-000000000001';

describe('rotas', () => {
  it('lê e reconstrói as rotas estáveis', () => {
    expect(lerRota(`/paletes/${ID}`, '')).toEqual({ tipo: 'palete', id: ID });
    expect(lerRota(`/paletes/${ID.toUpperCase()}/`, '')).toEqual({ tipo: 'palete', id: ID });
    expect(lerRota('/paletes/novo', '')).toEqual({ tipo: 'novo-palete' });
    // Endereços antigos ("Novo produto" e catálogo de SKU, retirado): levam a "Registrar conteúdo".
    expect(lerRota('/produtos/catalogo', '')).toEqual({ tipo: 'novo-conteudo' });
    expect(lerRota('/produtos/catalogo/', '?x=1')).toEqual({ tipo: 'novo-conteudo' });
    expect(lerRota('/produtos', '')).toEqual({ tipo: 'novo-conteudo' });
    expect(ehEnderecoAntigo('/produtos/catalogo')).toBe(true);
    expect(ehEnderecoAntigo('/produtos')).toBe(true);
    expect(ehEnderecoAntigo('/conteudos/novo')).toBe(false);
    expect(lerRota('/produtos/outra', '')).toEqual({ tipo: 'desconhecida' });
    expect(lerRota('/conteudos/novo', '?palete=AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toEqual({ tipo: 'novo-conteudo', palete: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(lerRota('/conteudos/novo', '')).toEqual({ tipo: 'novo-conteudo' });
    expect(lerRota('/paletes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/volumes', '')).toEqual({ tipo: 'volumes', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(lerRota('/paletes/novo', '?posicao=AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toEqual({ tipo: 'novo-palete', posicao: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(lerRota('/paletes/novo', '?posicao=x')).toEqual({ tipo: 'novo-palete' });
    expect(lerRota('/etiquetas', `?ids=${ID},${ID},nao-uuid`)).toEqual({ tipo: 'etiquetas', ids: [ID] });
    expect(lerRota('/paletes/123', '')).toEqual({ tipo: 'desconhecida' });
    expect(caminhoDe({ tipo: 'entrar', retorno: `/paletes/${ID}` })).toBe(`/entrar?retorno=%2Fpaletes%2F${ID}`);
  });

  it('movimentações do palete têm endereço próprio pelo ID permanente', () => {
    for (const tipo of ['mover', 'transferir', 'historico', 'retirar', 'bipagem'] as const) {
      expect(lerRota(`/paletes/${ID}/${tipo}`, '')).toEqual({ tipo, id: ID });
      expect(caminhoDe({ tipo, id: ID })).toBe(`/paletes/${ID}/${tipo}`);
      expect(destinoSeguro(`/paletes/${ID}/${tipo}`)).toBe(`/paletes/${ID}/${tipo}`);
    }
    expect(lerRota(`/paletes/${ID}/apagar`, '')).toEqual({ tipo: 'desconhecida' });
    expect(lerRota(`/paletes/nao-e-id/mover`, '')).toEqual({ tipo: 'desconhecida' });
    // Importar bipagem aberto sem palete: a página só pede a escolha do palete.
    expect(lerRota('/bipagem', '')).toEqual({ tipo: 'bipagem-escolher' });
    expect(caminhoDe({ tipo: 'bipagem-escolher' })).toBe('/bipagem');
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

  it('painéis guardam os filtros na URL (só chaves conhecidas, em ordem fixa)', () => {
    const uuid = '6f1c1f9e-8d7e-4c7a-9b6a-1d2e3f4a5b6c';
    expect(lerRota('/painel', '?inicio=2026-10-01&fim=2026-10-31&x=1')).toEqual({ tipo: 'painel', parametros: 'inicio=2026-10-01&fim=2026-10-31' });
    expect(caminhoDe(lerRota('/painel/estoque', '?situacao=sem-endereco&rua=Rua+15'))).toBe('/painel/estoque?rua=Rua+15&situacao=sem-endereco');
    expect(caminhoDe(lerRota('/painel/cliente', '?aba=historico&documento=0003001&pagina=2'))).toBe('/painel/cliente?aba=historico&documento=0003001&pagina=2');
    expect(lerRota(`/painel/janelas/${uuid.toUpperCase()}`, '')).toEqual({ tipo: 'painel-janela', id: uuid });
    expect(destinoSeguro(`/painel/janelas/${uuid}`)).toBe(`/painel/janelas/${uuid}`);
    expect(lerRota('/painel/janelas/nao-e-id', '').tipo).toBe('desconhecida');
  });

  it('destino de retorno só aceita caminhos internos conhecidos', () => {
    expect(destinoSeguro(`/paletes/${ID}`)).toBe(`/paletes/${ID}`);
    expect(destinoSeguro(`/etiquetas?ids=${ID}`)).toBe(`/etiquetas?ids=${ID}`);
    expect(destinoSeguro('/produtos')).toBe('/conteudos/novo');
    expect(destinoSeguro('/produtos/catalogo')).toBe('/conteudos/novo');
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
