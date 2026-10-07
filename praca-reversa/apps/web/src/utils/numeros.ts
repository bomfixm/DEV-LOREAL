/**
 * Formata quantidade decimal recebida como texto ("1250.5") em pt-BR
 * ("1.250,5") sem passar por ponto flutuante, preservando a exatidão.
 */
export function formatarQuantidade(decimal: string): string {
  const correspondencia = /^(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!correspondencia) return decimal;
  const inteiro = (correspondencia[1] ?? '0').replace(/^0+(?=\d)/, '');
  const fracao = (correspondencia[2] ?? '').replace(/0+$/, '');
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fracao ? `${agrupado},${fracao}` : agrupado;
}
