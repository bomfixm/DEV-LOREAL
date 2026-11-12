/**
 * Paginação da tabela de notas pela altura medida de cada linha (em mm), com a
 * fonte, a largura e o espaçamento do layout aplicado. Nunca corta nem descarta
 * linha: o que não cabe vai para a folha seguinte, que repete o cabeçalho e a
 * identificação do palete. Uma linha mais alta que a área inteira fica sozinha
 * numa folha e é sinalizada (`grandes`) para ajuste antes de imprimir.
 */
export interface Paginacao {
  /** Índices das linhas em cada folha (sempre ao menos uma folha). */
  folhas: number[][];
  /** Índices de linhas que não cabem nem sozinhas na área da tabela. */
  grandes: number[];
}
/** Folga para arredondamento de bordas entre a medição e a impressão. */
const FOLGA_MM = 0.6;

export function paginarPorAltura(linhas: readonly number[], cabecalho: number, alturaTabela: number): Paginacao {
  const disponivel = alturaTabela - cabecalho - FOLGA_MM;
  const folhas: number[][] = [[]];
  const grandes: number[] = [];
  let usado = 0;
  linhas.forEach((altura, i) => {
    const atual = folhas.at(-1) ?? [];
    if (usado + altura > disponivel && atual.length > 0) {
      folhas.push([]);
      usado = 0;
    }
    folhas.at(-1)?.push(i);
    usado += altura;
    if (altura > disponivel) grandes.push(i);
  });
  return { folhas, grandes };
}
