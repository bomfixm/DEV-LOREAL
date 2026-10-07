import type { IdentificacaoCodigo } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';

const selecaoProduto = {
  id: true,
  sku: true,
  descricao: true,
  ativo: true,
  unidadeCanonica: true,
  codigosBarras: { select: { codigo: true, embalagem: true, fatorConversao: true }, orderBy: { codigo: 'asc' as const } },
} as const;

export interface ProdutoIdentificado {
  id: string;
  sku: string;
  descricao: string;
  ativo: boolean;
  unidadeCanonica: string;
  embalagens: { codigo: string; embalagem: string; fator: string | null }[];
}

export interface Identificacao {
  produto: ProdutoIdentificado;
  /** Como o código foi reconhecido. */
  via: 'CODIGO_BARRAS' | 'SKU';
  codigo: string;
  /** Embalagem do código lido (pelo SKU: a unidade canônica). */
  embalagem: string;
  /** Fator aprovado; `null` = desconhecido. */
  fator: string | null;
}

function produtoDe(p: {
  id: string;
  sku: string;
  descricao: string;
  ativo: boolean;
  unidadeCanonica: string;
  codigosBarras: { codigo: string; embalagem: string; fatorConversao: { toFixed(): string } | null }[];
}): ProdutoIdentificado {
  return {
    id: p.id,
    sku: p.sku,
    descricao: p.descricao,
    ativo: p.ativo,
    unidadeCanonica: p.unidadeCanonica,
    embalagens: p.codigosBarras.map((c) => ({ codigo: c.codigo, embalagem: c.embalagem, fator: c.fatorConversao?.toFixed() ?? null })),
  };
}

/**
 * Identifica um código lido ou digitado: primeiro como código de barras
 * cadastrado (texto exato), depois como SKU (texto exato). Não há busca por
 * semelhança: código não encontrado é `null` e vira pendência explícita.
 */
export async function identificarCodigo(db: Banco | Transacao, escopoId: string, codigo: string): Promise<Identificacao | null> {
  const barras = await db.codigoBarras.findUnique({
    where: { escopoId_codigo: { escopoId, codigo } },
    select: { codigo: true, embalagem: true, fatorConversao: true, produto: { select: selecaoProduto } },
  });
  if (barras) {
    return {
      produto: produtoDe(barras.produto),
      via: 'CODIGO_BARRAS',
      codigo: barras.codigo,
      embalagem: barras.embalagem,
      fator: barras.fatorConversao?.toFixed() ?? null,
    };
  }
  const produto = await db.produto.findUnique({ where: { escopoId_sku: { escopoId, sku: codigo } }, select: selecaoProduto });
  if (!produto) return null;
  return { produto: produtoDe(produto), via: 'SKU', codigo: produto.sku, embalagem: produto.unidadeCanonica, fator: '1' };
}

export async function produtoPorId(db: Banco | Transacao, escopoId: string, id: string): Promise<ProdutoIdentificado | null> {
  const p = await db.produto.findFirst({ where: { id, escopoId }, select: selecaoProduto });
  return p ? produtoDe(p) : null;
}

export function respostaIdentificacao(i: Identificacao): IdentificacaoCodigo {
  return {
    code: i.codigo,
    match: i.via,
    productId: i.produto.id,
    sku: i.produto.sku,
    description: i.produto.descricao,
    active: i.produto.ativo,
    canonicalUnit: i.produto.unidadeCanonica,
    packaging: i.embalagem,
    factor: i.fator,
    packagings: i.produto.embalagens.map((e) => ({ code: e.codigo, packaging: e.embalagem, factor: e.fator })),
  };
}
