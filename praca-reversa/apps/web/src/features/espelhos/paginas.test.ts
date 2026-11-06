import { ConteudoPaleteSchema } from '@praca-reversa/contracts';
import { expect, it } from 'vitest';
import { paginarEspelho } from './paginas';
it('distribui textos longos sem perder nem duplicar linhas e mantém folha para palete vazio', () => {
  const item = ConteudoPaleteSchema.parse({ id: '00000000-0000-4000-8000-000000000001', kind: 'REGISTRADO', sender: 'R'.repeat(200), documentType: 'NFD', documentNumber: '0'.repeat(60), delivery: '0'.repeat(60), description: null, source: null, palletFull: null, version: 1, count: { state: 'AGUARDANDO', counted: null, expected: null, origin: null, at: null, by: null, reference: null }, createdAt: '2026-11-05T15:00:00.000Z' });
  const items = Array.from({ length: 31 }, (_, n) => ({ ...item, id: String(n) }));
  const pages = paginarEspelho(items, { code: 'P'.repeat(40), address: '15 - A101' });
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.flat()).toEqual(items);
  expect(pages.every((p) => p.length > 0)).toBe(true);
  expect(paginarEspelho([], { code: '1', address: null })).toEqual([[]]);
});
