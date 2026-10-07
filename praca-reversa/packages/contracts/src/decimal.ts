import { z } from 'zod';

/**
 * Quantidades decimais exatas (R03): texto com até 15 dígitos inteiros e 3
 * casas decimais, igual à coluna decimal(18,3) do banco. As contas são feitas
 * em milésimos com BigInt, sem ponto flutuante, na API e na interface.
 */
export const FORMATO_QUANTIDADE = /^\d{1,15}(\.\d{1,3})?$/;
/** Diferença ou ajuste: pode ser negativo. */
export const FORMATO_QUANTIDADE_COM_SINAL = /^-?\d{1,15}(\.\d{1,3})?$/;

/** Quantidade decimal exata, não negativa, transmitida como texto (ex.: "24", "1.5"). */
export const QuantidadeSchema = z.string().regex(FORMATO_QUANTIDADE, 'Quantidade decimal inválida');
/** Diferença/ajuste com sinal (ex.: "-3", "12"). */
export const QuantidadeComSinalSchema = z.string().regex(FORMATO_QUANTIDADE_COM_SINAL, 'Quantidade com sinal inválida');

const MILESIMOS = 1000n;
/** Maior valor representável em decimal(18,3), em milésimos. */
const LIMITE = 10n ** 18n;

/** Converte "12.5" em 12500n (milésimos). Lança erro para texto fora do formato. */
export function paraMilesimos(texto: string): bigint {
  const partes = /^(-)?(\d{1,15})(?:\.(\d{1,3}))?$/.exec(texto);
  if (!partes) throw new Error(`Quantidade inválida: ${texto}`);
  const valor = BigInt(partes[2] ?? '0') * MILESIMOS + BigInt((partes[3] ?? '').padEnd(3, '0'));
  return partes[1] ? -valor : valor;
}

/** Converte milésimos em texto canônico ("12.5", "-3", "0"). */
export function deMilesimos(valor: bigint): string {
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;
  if (absoluto >= LIMITE) throw new Error('Quantidade acima do limite de 15 dígitos inteiros.');
  const inteiro = (absoluto / MILESIMOS).toString();
  const fracao = (absoluto % MILESIMOS).toString().padStart(3, '0').replace(/0+$/, '');
  return `${negativo ? '-' : ''}${inteiro}${fracao ? `.${fracao}` : ''}`;
}

/** Texto canônico de uma quantidade (remove zeros supérfluos: "12.500" → "12.5"). */
export function normalizarQuantidade(texto: string): string {
  return deMilesimos(paraMilesimos(texto));
}

export function somarQuantidades(valores: readonly string[]): string {
  return deMilesimos(valores.reduce((total, v) => total + paraMilesimos(v), 0n));
}

/** a − b, com sinal. */
export function subtrairQuantidades(a: string, b: string): string {
  return deMilesimos(paraMilesimos(a) - paraMilesimos(b));
}

export function compararQuantidades(a: string, b: string): -1 | 0 | 1 {
  const diferenca = paraMilesimos(a) - paraMilesimos(b);
  return diferenca < 0n ? -1 : diferenca > 0n ? 1 : 0;
}

export function ehQuantidadeInteira(texto: string): boolean {
  return paraMilesimos(texto) % MILESIMOS === 0n;
}

/**
 * Produto exato de duas quantidades (ex.: 2 caixas × fator 12). Devolve `null`
 * quando o resultado precisaria de mais de 3 casas decimais ou excede o limite:
 * nesse caso não há conversão exata e nada é arredondado.
 */
export function multiplicarExato(a: string, b: string): string | null {
  const produto = paraMilesimos(a) * paraMilesimos(b);
  if (produto % MILESIMOS !== 0n) return null;
  const resultado = produto / MILESIMOS;
  if (resultado >= LIMITE || resultado <= -LIMITE) return null;
  return deMilesimos(resultado);
}
