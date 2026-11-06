import { expect, test } from '@playwright/test';
import { ConteudoPaleteSchema, ConteudosPaleteSchema } from '@praca-reversa/contracts';
import { entrar } from './apoio';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const items = [11, 15, 16].flatMap((row, i) => [101, 102].map((number, j) => ({ id: id(i * 2 + j + 1), code: String(i * 2 + j + 1), address: `${String(row)} - A${String(number)}`, row: String(row), number })));
test('espelhos: múltiplas ruas, lados, paletes, prévia e impressão', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'Impressão de espelhos é só no computador.');
  let denso = false;
  const linha = ConteudoPaleteSchema.parse({ id: id(900), kind: 'REGISTRADO', sender: 'REMETENTE DE TESTE', documentType: 'NFD', documentNumber: '0000123', delivery: '0000456', description: null, source: null, palletFull: null, version: 1, count: { state: 'REALIZADA', counted: '117', expected: null, origin: 'CONTAGEM_FISICA', at: '2026-11-05T15:00:00.000Z', by: null, reference: null }, createdAt: '2026-11-05T15:00:00.000Z' });
  await entrar(page, 'operadorDemo');
  await page.route('**/api/v1/espelhos/opcoes', (route) => route.fulfill({ json: { items } }));
  await page.route(/\/api\/v1\/espelhos\?/, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const ids = query.get('ids')?.split(',');
    const rows = query.get('rows')?.split(',') ?? [];
    const side = query.get('side');
    const selected = items.filter((p) => ids ? ids.includes(p.id) : rows.includes(p.row) && (side === 'todos' || p.number % 2 === (side === 'impares' ? 1 : 0)));
    await route.fulfill({ json: { generatedAt: '2026-11-05T15:00:00.000Z', scope: { name: 'Teste de impressão', demo: true }, items: selected.map((p) => ({ ...p, contents: ConteudosPaleteSchema.parse({ palletId: p.id, items: denso ? Array.from({ length: 31 }, (_, n) => ({ ...linha, id: id(900 + n), sender: 'REMETENTE '.repeat(20), delivery: '0'.repeat(60), documentNumber: '0'.repeat(60) })) : [linha], documents: 1, withoutDocument: 0, full: 'NAO_INFORMADO' }) })) } });
  });
  await page.goto('/espelhos');
  await page.getByRole('button', { name: 'Ruas ímpares (11, 13, 15…)', exact: true }).click();
  await expect(page.getByLabel('Rua 11', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Rua 15', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Rua 16', { exact: true })).not.toBeChecked();
  await page.getByLabel('Rua 15', { exact: true }).uncheck();
  await page.getByLabel('Rua 16', { exact: true }).check();
  await page.getByRole('combobox', { name: 'Endereços', exact: true }).selectOption('impares');
  await page.getByRole('button', { name: 'Gerar prévia', exact: true }).click();
  await expect(page.locator('.espelho-folha')).toHaveCount(2);
  await expect(page.locator('.espelho-folha').first()).toContainText('RUA 11 - A101');
  await expect(page.locator('.espelho-folha').last()).toContainText('RUA 16 - A101');
  await page.getByRole('button', { name: 'Selecionar todas as ruas' }).click();
  await expect(page.locator('.espelho-folha')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Endereços', exact: true }).selectOption('pares');
  await page.getByRole('button', { name: 'Gerar prévia', exact: true }).click();
  await expect(page.locator('.espelho-folha')).toHaveCount(3);
  if (info.project.name === 'computador') {
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.espelhos-selecao')).toBeHidden();
    await page.pdf({ path: info.outputPath('espelhos.pdf'), preferCSSPageSize: true, printBackground: true });
    await page.locator('.espelho-folha').first().screenshot({ path: info.outputPath('espelho.png') });
    const bounds = await page.locator('.espelho-interior').first().evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
    await page.emulateMedia({ media: 'screen' });
  }
  await page.getByRole('combobox', { name: 'Selecionar por', exact: true }).selectOption('paletes');
  await page.getByLabel('Palete 1 · 11 - A101', { exact: true }).check();
  await page.getByRole('button', { name: 'Gerar prévia', exact: true }).click();
  await expect(page.locator('.espelho-folha')).toHaveCount(1);
  denso = true;
  await page.getByRole('button', { name: 'Gerar prévia', exact: true }).click();
  await expect(page.locator('.espelho-folha')).not.toHaveCount(1);
  await expect(page.locator('.espelho-folha tbody tr')).toHaveCount(31);
  const semCortes = await page.locator('.espelho-folha').evaluateAll((folhas) => folhas.every((folha) => {
    const tabela = folha.querySelector('table'); const rodape = folha.querySelector('footer');
    return tabela !== null && rodape !== null && tabela.getBoundingClientRect().bottom < rodape.getBoundingClientRect().top;
  }));
  expect(semCortes).toBe(true);
});
