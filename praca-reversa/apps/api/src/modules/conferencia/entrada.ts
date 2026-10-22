/**
 * Resolução de uma entrada de conferência: produto, embalagem, fator e
 * conversão exata para a unidade canônica. O fator vem sempre do cadastro (no
 * momento da entrada) e fica gravado na linha; nunca é presumido nem enviado
 * pela interface. Código não cadastrado e fator desconhecido viram pendência
 * somente quando pedido de forma explícita.
 */
import { UNIDADE_PECA, ehQuantidadeInteira, multiplicarExato, type ModoEntrada, type PendenciaObservacao } from '@praca-reversa/contracts';
import type { Transacao } from '../../db/cliente.js';
import { ErroHttp, requisicaoInvalida } from '../../http/erros.js';
import { identificarCodigo, produtoPorId, type ProdutoIdentificado } from '../produtos/identificar.js';

export interface Entrada {
  mode: ModoEntrada;
  code: string | null;
  productId: string | null;
  packagingCode: string | null;
  quantity: string | null;
  unit: string | null;
  description: string | null;
  registerAsPending: boolean;
}

export interface EntradaResolvida {
  produtoId: string | null;
  sku: string | null;
  descricao: string;
  codigoLido: string | null;
  quantidadeInformada: string;
  unidadeInformada: string;
  fatorConversao: string | null;
  quantidadeCanonica: string | null;
  unidadeCanonica: string | null;
  pendencia: PendenciaObservacao | null;
}

const naoCadastrado = (codigo: string) =>
  new ErroHttp(
    422,
    'CODIGO_NAO_CADASTRADO',
    `Código ${codigo} não cadastrado neste escopo. Nenhum SKU foi associado. Registre como pendência (modo manual, com quantidade e unidade).`,
  );

const conversaoDesconhecida = (mensagem: string) => new ErroHttp(422, 'CONVERSAO_DESCONHECIDA', mensagem);

function pendenteDeFator(p: ProdutoIdentificado, codigo: string | null, quantidade: string, unidade: string): EntradaResolvida {
  return {
    produtoId: p.id,
    sku: p.sku,
    descricao: p.descricao,
    codigoLido: codigo,
    quantidadeInformada: quantidade,
    unidadeInformada: unidade,
    fatorConversao: null,
    quantidadeCanonica: null,
    unidadeCanonica: p.unidadeCanonica,
    pendencia: 'FATOR_DESCONHECIDO',
  };
}

function convertido(p: ProdutoIdentificado, codigo: string | null, quantidade: string, unidade: string, fator: string): EntradaResolvida {
  const canonica = multiplicarExato(quantidade, fator);
  if (canonica === null) {
    throw conversaoDesconhecida(`${quantidade} ${unidade} × fator ${fator} não tem resultado exato com 3 casas decimais: nada foi arredondado.`);
  }
  if (p.unidadeCanonica === UNIDADE_PECA && !ehQuantidadeInteira(canonica)) {
    throw conversaoDesconhecida(`${quantidade} ${unidade} × fator ${fator} = ${canonica} ${UNIDADE_PECA}: peças precisam ser inteiras.`);
  }
  return {
    produtoId: p.id,
    sku: p.sku,
    descricao: p.descricao,
    codigoLido: codigo,
    quantidadeInformada: quantidade,
    unidadeInformada: unidade,
    fatorConversao: fator,
    quantidadeCanonica: canonica,
    unidadeCanonica: p.unidadeCanonica,
    pendencia: null,
  };
}

export async function resolverEntrada(tx: Transacao, escopoId: string, e: Entrada): Promise<EntradaResolvida> {
  const lido = e.code === null ? null : await identificarCodigo(tx, escopoId, e.code);
  let produto: ProdutoIdentificado | null = lido?.produto ?? null;
  if (e.productId !== null) {
    const escolhido = await produtoPorId(tx, escopoId, e.productId);
    if (!escolhido) throw requisicaoInvalida('Produto não encontrado neste escopo.');
    if (lido && lido.produto.id !== escolhido.id) {
      throw requisicaoInvalida(`O código ${lido.codigo} pertence ao SKU ${lido.produto.sku}, não ao produto escolhido (${escolhido.sku}).`);
    }
    produto = escolhido;
  }

  if (produto === null) {
    if (e.mode !== 'MANUAL' || !e.registerAsPending) {
      if (e.code !== null) throw naoCadastrado(e.code);
      throw requisicaoInvalida('Escolha o produto, leia o código ou registre como pendência.');
    }
    if (e.quantity === null || e.unit === null) throw requisicaoInvalida('Pendência: informe a quantidade e a unidade observadas.');
    const descricao = e.description ?? (e.code === null ? null : `Código ${e.code} não cadastrado`);
    if (descricao === null) throw requisicaoInvalida('Pendência sem código: descreva o item observado.');
    return {
      produtoId: null,
      sku: null,
      descricao,
      codigoLido: e.code,
      quantidadeInformada: e.quantity,
      unidadeInformada: e.unit,
      fatorConversao: null,
      quantidadeCanonica: null,
      unidadeCanonica: null,
      pendencia: 'PRODUTO_NAO_IDENTIFICADO',
    };
  }
  if (!produto.ativo) {
    throw new ErroHttp(409, 'CONFLITO', `O SKU ${produto.sku} está inativo no cadastro. Reative o produto ou registre o item como pendência.`);
  }

  const p = produto;
  if (e.mode === 'LEITURA_UNIDADE') {
    if (!lido) throw requisicaoInvalida('Leia o código da unidade.');
    if (lido.embalagem !== p.unidadeCanonica || lido.fator !== '1') {
      throw new ErroHttp(
        422,
        'MODO_INCOMPATIVEL',
        `O código ${lido.codigo} é da embalagem ${lido.embalagem}${lido.fator === null ? ' (fator desconhecido)' : ` (${lido.fator} ${p.unidadeCanonica})`}. No modo "uma unidade por leitura", leia o código da unidade ou troque para "uma embalagem por leitura".`,
      );
    }
    return convertido(p, lido.codigo, '1', p.unidadeCanonica, '1');
  }

  if (e.mode === 'LEITURA_EMBALAGEM') {
    if (!lido) throw requisicaoInvalida('Leia o código da embalagem.');
    if (lido.fator === null) {
      if (!e.registerAsPending) {
        throw conversaoDesconhecida(
          `A embalagem ${lido.embalagem} do código ${lido.codigo} (SKU ${p.sku}) não tem fator aprovado: a conversão está bloqueada. Registre como pendência ou peça a aprovação do fator.`,
        );
      }
      return pendenteDeFator(p, lido.codigo, '1', lido.embalagem);
    }
    return convertido(p, lido.codigo, '1', lido.embalagem, lido.fator);
  }

  // MANUAL: quantidade e unidade digitadas.
  if (e.quantity === null || e.unit === null) throw requisicaoInvalida('Informe a quantidade e a unidade observadas.');
  const quantidade = e.quantity;
  const unidade = e.unit;
  let fator: string | null | undefined;
  let codigo: string | null = lido?.codigo ?? null;
  if (e.packagingCode !== null) {
    const embalagem = p.embalagens.find((x) => x.codigo === e.packagingCode);
    if (!embalagem) throw requisicaoInvalida(`O código de embalagem ${e.packagingCode} não pertence ao SKU ${p.sku}.`);
    if (embalagem.embalagem !== unidade) {
      throw requisicaoInvalida(`O código ${embalagem.codigo} é da embalagem ${embalagem.embalagem}, não ${unidade}.`);
    }
    fator = embalagem.fator;
    codigo = embalagem.codigo;
  } else if (lido?.embalagem === unidade) {
    fator = lido.fator;
  } else if (unidade === p.unidadeCanonica) {
    fator = '1';
  } else {
    const fatores = new Set(p.embalagens.filter((x) => x.embalagem === unidade).map((x) => x.fator));
    if (fatores.size > 1) {
      throw requisicaoInvalida(`O SKU ${p.sku} tem mais de uma embalagem ${unidade} com fatores diferentes: escolha o código da embalagem.`);
    }
    fator = fatores.size === 1 ? [...fatores][0] : undefined;
  }
  if (unidade !== p.unidadeCanonica && !ehQuantidadeInteira(quantidade)) {
    throw requisicaoInvalida(`Embalagens (${unidade}) são contadas inteiras. Para embalagem aberta, conte na unidade ${p.unidadeCanonica}.`);
  }
  if (fator === undefined || fator === null) {
    if (!e.registerAsPending) {
      throw conversaoDesconhecida(
        fator === undefined
          ? `A unidade ${unidade} não está cadastrada para o SKU ${p.sku} (unidade canônica ${p.unidadeCanonica}): sem fator aprovado, a conversão está bloqueada.`
          : `A embalagem ${unidade} do SKU ${p.sku} não tem fator aprovado: a conversão está bloqueada.`,
      );
    }
    return pendenteDeFator(p, codigo, quantidade, unidade);
  }
  return convertido(p, codigo, quantidade, unidade, fator);
}
