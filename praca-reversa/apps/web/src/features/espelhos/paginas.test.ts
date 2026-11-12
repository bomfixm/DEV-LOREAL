import { expect, it } from 'vitest';
import { paginarPorAltura } from './paginas';

it('distribui linhas pela altura medida sem perder nem duplicar e mantém folha para palete vazio', () => {
  const linhas = Array.from({ length: 31 }, (_, n) => (n % 3 === 0 ? 14 : 6));
  const { folhas, grandes } = paginarPorAltura(linhas, 8, 100);
  expect(folhas.length).toBeGreaterThan(1);
  expect(folhas.flat()).toEqual(linhas.map((_, i) => i));
  expect(folhas.every((f) => f.length > 0)).toBe(true);
  // Nenhuma folha passa da área disponível (100 − 8 de cabeçalho − folga).
  expect(folhas.every((f) => f.reduce((s, i) => s + (linhas[i] ?? 0), 0) <= 100 - 8)).toBe(true);
  expect(grandes).toEqual([]);
  expect(paginarPorAltura([], 8, 100)).toEqual({ folhas: [[]], grandes: [] });
});

it('linha mais alta que a área fica sozinha e é sinalizada (não é cortada nem descartada)', () => {
  const { folhas, grandes } = paginarPorAltura([10, 200, 10], 8, 100);
  expect(folhas).toEqual([[0], [1], [2]]);
  expect(grandes).toEqual([1]);
});
