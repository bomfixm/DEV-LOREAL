import { z } from 'zod';
import { paraMilesimos } from './decimal.js';

/**
 * Valores monetários exatos (etapa 07; docs/DADOS-E-REGRAS.md R19). Valor
 * informado: texto com até 15 dígitos inteiros e 2 casas, igual à coluna
 * decimal(18,2). Valor calculado (unitário × quantidade de até 3 casas): até
 * 5 casas, sem arredondamento. As contas usam BigInt em cem-milésimos; nada
 * passa por ponto flutuante. Moedas diferentes nunca são somadas.
 */
export const FORMATO_VALOR = /^\d{1,15}(\.\d{1,2})?$/;
/** Valor calculado/agregado: até 20 dígitos inteiros e 5 casas. */
export const FORMATO_VALOR_CALCULADO = /^-?\d{1,20}(\.\d{1,5})?$/;
/** Código de moeda de três letras (ex.: BRL, USD). Nenhuma conversão é feita. */
export const FORMATO_MOEDA = /^[A-Z]{3}$/;

export const ValorSchema = z.string().trim().regex(FORMATO_VALOR, 'Valor: número com até 2 casas decimais, separador ponto, sem milhar (ex.: 1250.50).');
export const ValorCalculadoSchema = z.string().regex(FORMATO_VALOR_CALCULADO, 'Valor calculado inválido');
export const MoedaSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(FORMATO_MOEDA, 'Moeda: código de 3 letras (ex.: BRL).');

const ESCALA = 100_000n;

/** "12.5" → 1250000n (cem-milésimos). Aceita valor informado ou calculado. */
export function paraCemMilesimos(texto: string): bigint {
  const partes = /^(-)?(\d{1,20})(?:\.(\d{1,5}))?$/.exec(texto);
  if (!partes) throw new Error(`Valor inválido: ${texto}`);
  const valor = BigInt(partes[2] ?? '0') * ESCALA + BigInt((partes[3] ?? '').padEnd(5, '0'));
  return partes[1] ? -valor : valor;
}

/** Texto canônico, com pelo menos 2 casas ("12.50", "3.33333", "-1.00"). */
export function deCemMilesimos(valor: bigint): string {
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;
  const inteiro = (absoluto / ESCALA).toString();
  let fracao = (absoluto % ESCALA).toString().padStart(5, '0').replace(/0+$/, '');
  if (fracao.length < 2) fracao = fracao.padEnd(2, '0');
  return `${negativo ? '-' : ''}${inteiro}.${fracao}`;
}

export function normalizarValor(texto: string): string {
  return deCemMilesimos(paraCemMilesimos(texto));
}

export function somarValores(valores: readonly string[]): string {
  return deCemMilesimos(valores.reduce((total, v) => total + paraCemMilesimos(v), 0n));
}

export function subtrairValores(a: string, b: string): string {
  return deCemMilesimos(paraCemMilesimos(a) - paraCemMilesimos(b));
}

export function compararValores(a: string, b: string): -1 | 0 | 1 {
  const d = paraCemMilesimos(a) - paraCemMilesimos(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

/**
 * Valor unitário (2 casas) × quantidade (3 casas): resultado exato com até 5
 * casas. Um valor TOTAL nunca passa por aqui (não é multiplicado de novo).
 */
export function valorUnitarioVezesQuantidade(unitario: string, quantidade: string): string {
  // cem-milésimos × milésimos = 10^8; dividir por 1000 é exato porque o
  // unitário tem no máximo 2 casas (múltiplo de 1000 em cem-milésimos).
  const produto = paraCemMilesimos(unitario) * paraMilesimos(quantidade);
  return deCemMilesimos(produto / 1000n);
}

/** Totais por moeda (nunca somados entre moedas), em ordem alfabética da moeda. */
export function totaisPorMoeda(itens: readonly { moeda: string; valor: string }[]): { currency: string; value: string }[] {
  const mapa = new Map<string, bigint>();
  for (const i of itens) mapa.set(i.moeda, (mapa.get(i.moeda) ?? 0n) + paraCemMilesimos(i.valor));
  return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({ currency, value: deCemMilesimos(v) }));
}
