import { expect, test } from '@playwright/test';
import { entrar } from './apoio';

/**
 * Espelhos: a seleção é feita no mapa (6 nov. 2026). Clicar no nome da rua marca
 * a rua inteira, no F## marca a fileira e no palete marca só ele; clicar de novo
 * desmarca. Marcado = branco. Só no computador.
 */
test('espelhos: escolher no mapa por rua, fileira e palete; prévia e impressão', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'Impressão de espelhos é só no computador.');
  await entrar(page, 'operadorDemo');
  await page.goto('/espelhos');
  await expect(page.getByTestId('espelhos-mapa')).toBeVisible();
  await page.locator('path[data-palete-id]').first().waitFor({ state: 'attached' });
  const contagem = async () => Number((await page.getByTestId('espelhos-contagem').locator('strong').innerText()).trim());
  const brancos = () => page.locator('path.pr-palete--espelho').count();
  const gerar = page.getByRole('button', { name: 'Gerar prévia', exact: true });

  expect(await contagem()).toBe(0);
  await expect(gerar).toBeDisabled();

  // Rua inteira: o título do bloco marca todos os paletes dela; clicar de novo desmarca.
  // (No cenário de demonstração os blocos são estreitos e o título some neste zoom: o clique é disparado no elemento.)
  const rua = page.locator('.pr-titulo--BLOCO.pr-rotulo-clicavel', { hasText: 'Fileira 11' }).first();
  await rua.dispatchEvent('click');
  const daRua = await contagem();
  expect(daRua).toBeGreaterThan(0);
  expect(await brancos()).toBe(daRua);
  await rua.dispatchEvent('click');
  expect(await contagem()).toBe(0);
  expect(await brancos()).toBe(0);

  // Fileira: o rótulo F## marca só os paletes daquela fileira.
  await page.locator('.pr-rotulo-fileira.pr-rotulo-clicavel', { hasText: /^F02$/ }).first().dispatchEvent('click');
  const daFileira = await contagem();
  expect(daFileira).toBeGreaterThan(0);
  expect(await brancos()).toBe(daFileira);

  // Palete avulso: soma um; clicar nele de novo tira.
  const avulso = page.locator('path[data-palete-id]:not(.pr-palete--espelho)').first();
  const codigo = await avulso.getAttribute('data-codigo');
  await avulso.click({ force: true });
  expect(await contagem()).toBe(daFileira + 1);
  await page.locator(`path[data-codigo="${codigo ?? ''}"]`).click({ force: true });
  expect(await contagem()).toBe(daFileira);

  // Prévia: uma folha no mínimo por palete marcado, ordem estável e sem cortar texto.
  await expect(gerar).toBeEnabled();
  await gerar.click();
  await expect(page.locator('.espelho-folha').first()).toBeVisible();
  expect(await page.locator('.espelho-folha').count()).toBeGreaterThanOrEqual(daFileira);
  // Layout do editor (nov. 2026): a tabela não passa da área dela nem encosta no rodapé, e a conferência não aponta corte.
  await expect(page.locator('.espelhos-folhas[data-pronto="sim"]')).toBeVisible();
  const semCortes = await page.locator('.espelho-folha').evaluateAll((folhas) =>
    folhas.every((folha) => {
      const area = folha.querySelector<HTMLElement>('[data-campo="tabela"]');
      const tabela = area?.querySelector('table') ?? null;
      const rodape = folha.querySelector('[data-campo="emissao"]');
      return area !== null && tabela !== null && rodape !== null && tabela.scrollHeight <= area.clientHeight + 1 && tabela.getBoundingClientRect().bottom < rodape.getBoundingClientRect().top;
    }),
  );
  expect(semCortes).toBe(true);
  await expect(page.getByTestId('espelhos-problemas')).toHaveCount(0);

  // Mudar a seleção invalida a prévia (não imprime o que não está marcado).
  await page.locator('.pr-rotulo-fileira.pr-rotulo-clicavel', { hasText: /^F02$/ }).first().dispatchEvent('click');
  await expect(page.locator('.espelho-folha')).toHaveCount(0);

  // Impressão: a seleção some e sobram só as folhas.
  await expect(gerar).toBeDisabled();
  await page.locator('.pr-rotulo-fileira.pr-rotulo-clicavel', { hasText: /^F02$/ }).first().dispatchEvent('click');
  await gerar.click();
  await expect(page.locator('.espelho-folha').first()).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('espelhos-mapa')).toBeHidden();
  await page.pdf({ path: info.outputPath('espelhos.pdf'), preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
});
