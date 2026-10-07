import { z } from 'zod';

/**
 * Formatos e normalização de códigos legíveis (docs/DADOS-E-REGRAS.md, R01 e
 * R02). Códigos são texto: zeros à esquerda são preservados.
 *
 * Regra explícita de normalização: o código do palete e o da posição são
 * gravados sem espaços nas pontas e em maiúsculas. A "chave" de comparação
 * ignora separadores (". _ / -"), de modo que "PAL-001" e "PAL001" não podem
 * identificar paletes diferentes no mesmo escopo.
 */
export const FORMATO_CODIGO_PALETE = /^[A-Z0-9][A-Z0-9._/-]{0,39}$/;
export const FORMATO_CODIGO_POSICAO = /^[A-Z0-9][A-Z0-9._/-]{0,31}$/;
export const FORMATO_CODIGO_ELEMENTO = /^[A-Z0-9][A-Z0-9_-]{0,15}$/;
/** Unidade de medida ou embalagem: UN, CX, KG… */
export const FORMATO_UNIDADE = /^[A-Z0-9]{1,10}$/;

/** Chave de comparação: maiúsculas e somente letras/dígitos (igual à coluna codigo_busca). */
export function chaveDeCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const CodigoPaleteSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(FORMATO_CODIGO_PALETE, 'Código do palete: até 40 caracteres, letras, números e . _ / -, começando por letra ou número.');

export const CodigoPosicaoSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(FORMATO_CODIGO_POSICAO, 'Código da posição: até 32 caracteres, letras, números e . _ / -.');

export const CodigoElementoSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(FORMATO_CODIGO_ELEMENTO, 'Código: até 16 caracteres, letras, números, _ ou -.');

export const UnidadeMedidaSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(FORMATO_UNIDADE, 'Unidade: 1 a 10 letras maiúsculas ou dígitos (ex.: UN, CX).');

/** Unidade em que a contagem é por peça inteira (R03). */
export const UNIDADE_PECA = 'UN';

const SEM_CONTROLE = /^[^\p{Cc}]*$/u;

/** Texto curto de identificação (SKU, lote, referência): sem caracteres de controle. */
export function textoIdentificador(maximo: number, rotulo: string) {
  return z
    .string()
    .trim()
    .min(1, `${rotulo}: informe um valor.`)
    .max(maximo, `${rotulo}: até ${String(maximo)} caracteres.`)
    .regex(SEM_CONTROLE, `${rotulo}: caracteres inválidos.`);
}

/** Texto livre opcional (aceita quebras de linha): vazio vira `null`. */
export function textoOpcional(maximo: number) {
  return z
    .string()
    .trim()
    .max(maximo, `Até ${String(maximo)} caracteres.`)
    .regex(/^(?:[^\p{Cc}]|[\n\r\t])*$/u, 'Caracteres inválidos.')
    .nullable()
    .transform((v) => (v === null || v === '' ? null : v));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ID permanente de palete a partir do texto lido de um QR ou digitado: o
 * próprio UUID ou um link que termine em /paletes/<UUID>. Não confia no host
 * do link: só o identificador é aproveitado.
 */
export function extrairIdPalete(texto: string): string | null {
  const valor = texto.trim();
  if (UUID.test(valor)) return valor.toLowerCase();
  const correspondencia = /\/paletes\/([0-9a-f-]{36})\/?(?:[?#].*)?$/i.exec(valor);
  const id = correspondencia?.[1];
  return id !== undefined && UUID.test(id) ? id.toLowerCase() : null;
}
