import { z } from 'zod';
import { UNIDADE_PECA, UnidadeMedidaSchema, textoIdentificador } from './codigos.js';
import { FORMATO_QUANTIDADE } from './decimal.js';

/** SKU textual: zeros à esquerda preservados; somente espaços das pontas são removidos. */
export const SkuSchema = textoIdentificador(64, 'SKU');

/** Código de barras como texto (sem espaços), nunca número. */
export const CodigoBarrasSchema = z
  .string()
  .trim()
  .min(1, 'Informe o código de barras.')
  .max(64, 'Código de barras: até 64 caracteres.')
  .regex(/^[\x21-\x7E]+$/, 'Código de barras sem espaços nem acentos.');

const inteiro = (q: string) => /^\d+$/.test(q);

/**
 * Embalagem identificada por um código de barras. O fator (quantas unidades
 * canônicas há nesta embalagem) é informado por quem cadastra: nada é deduzido
 * do formato do código. `null` = fator ainda desconhecido/não aprovado: o
 * código é reconhecido, mas nenhuma conversão é feita até o fator ser aprovado
 * (etapa 04, T07). A embalagem na unidade canônica sempre tem fator 1.
 */
export const EmbalagemProdutoSchema = z.object({
  code: CodigoBarrasSchema,
  packaging: UnidadeMedidaSchema,
  factor: z
    .string()
    .regex(FORMATO_QUANTIDADE, 'Fator: número com até 3 casas decimais (ex.: 12 ou 0,5).')
    .refine((q) => Number(q) > 0, 'O fator precisa ser maior que zero.')
    .nullable(),
});
export type EmbalagemProduto = z.infer<typeof EmbalagemProdutoSchema>;

const DadosProdutoBase = z.object({
  description: z.string().trim().min(2, 'Descrição: pelo menos 2 caracteres.').max(200),
  canonicalUnit: UnidadeMedidaSchema,
  active: z.boolean(),
  barcodes: z.array(EmbalagemProdutoSchema).max(20, 'Até 20 códigos de barras por produto.'),
});

/** Coerência entre unidade canônica e embalagens. Lista vazia significa coerente. */
export function verificarEmbalagens(dados: { canonicalUnit: string; barcodes: readonly EmbalagemProduto[] }): string[] {
  const problemas: string[] = [];
  const codigos = new Set<string>();
  for (const e of dados.barcodes) {
    if (codigos.has(e.code)) problemas.push(`Código de barras repetido: ${e.code}`);
    codigos.add(e.code);
    if (e.packaging === dados.canonicalUnit && (e.factor === null || Number(e.factor) !== 1)) {
      problemas.push(`O código ${e.code} está na unidade canônica (${e.packaging}): o fator precisa ser 1.`);
    }
    if (dados.canonicalUnit === UNIDADE_PECA && e.factor !== null && !inteiro(e.factor)) {
      problemas.push(`Produto contado em peças: o fator de ${e.code} precisa ser inteiro.`);
    }
  }
  return problemas;
}

function refinarEmbalagens(dados: { canonicalUnit: string; barcodes: readonly EmbalagemProduto[] }, ctx: z.RefinementCtx) {
  for (const problema of verificarEmbalagens(dados)) ctx.addIssue({ code: 'custom', message: problema, path: ['barcodes'] });
}

export const CriarProdutoSchema = DadosProdutoBase.extend({ sku: SkuSchema }).superRefine(refinarEmbalagens);
export type CriarProduto = z.infer<typeof CriarProdutoSchema>;

/** O SKU não muda: é a identificação textual do produto no escopo. */
export const AlterarProdutoSchema = DadosProdutoBase.extend({
  expectedVersion: z.number().int().positive(),
}).superRefine(refinarEmbalagens);
export type AlterarProduto = z.infer<typeof AlterarProdutoSchema>;

export const ProdutoSchema = z.object({
  id: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  canonicalUnit: z.string().min(1),
  active: z.boolean(),
  version: z.number().int().positive(),
  barcodes: z.array(EmbalagemProdutoSchema),
  /** Já referenciado em conteúdo declarado, observado, em saldo ou em documento importado: a unidade canônica não pode mudar. */
  inUse: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Produto = z.infer<typeof ProdutoSchema>;

export const LIMITE_MAXIMO_PRODUTOS = 200;
export const FiltroProdutosSchema = z.object({
  texto: z.string().trim().max(64).optional(),
  inativos: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO_PRODUTOS).default(100),
});
export type FiltroProdutos = z.infer<typeof FiltroProdutosSchema>;

export const ListaProdutosSchema = z.object({
  items: z.array(ProdutoSchema),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type ListaProdutos = z.infer<typeof ListaProdutosSchema>;
