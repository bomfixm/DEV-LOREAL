import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { abrirMenuConta, ehCelular, entrar } from './apoio';

/**
 * Planilha e proteção (26 out. 2026), no escopo de cadastro do E2E (dados
 * fictícios, sem destino independente): a tela mostra a situação real de cada
 * parte, "Tentar novamente agora" reprocessa de verdade, o download entrega a
 * revisão validada (XLSX) e o operador só consulta.
 */
async function abrirTela(page: Page): Promise<void> {
  await abrirMenuConta(page);
  await page.getByRole('button', { name: 'Planilha e proteção' }).click();
  await expect(page.getByTestId('tela-planilha')).toBeVisible();
}

const PASTA = 'docs/capturas/planilha';
async function capturar(page: Page, nome: string): Promise<void> {
  if (process.env.CAPTURAR !== '1') return;
  mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: `${PASTA}/${nome}.png`, fullPage: true });
}

/** Item da situação pelo título (o nome aparece também no detalhe de outros itens). */
const item = (page: Page, nome: string) => page.getByTestId('planilha-item').filter({ has: page.locator('strong').getByText(nome, { exact: true }) });

test.describe('Planilha e proteção', () => {
  test('supervisor vê a situação verdadeira, reprocessa e baixa a revisão validada', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'mesma tela no celular; o fluxo é verificado no computador');
    await entrar(page, 'supervisor');
    await abrirTela(page);
    await expect(page.getByTestId('planilha-item')).toHaveCount(6);
    await expect(item(page, 'Destino independente')).toContainText('Não configurado');
    await expect(item(page, 'Backup completo externo')).toContainText('Não configurado');
    await expect(item(page, 'Teste de restauração')).toContainText('Teste de restauração pendente');
    await expect(page.getByTestId('planilha-destino')).toContainText('Não configurado');
    await page.getByTestId('planilha-publicar').click();
    await expect(page.getByTestId('planilha-mensagem')).toContainText(/Revisão \d+ gerada e validada no servidor|Nada pendente/);
    await expect(page.getByTestId('planilha-gerada')).toContainText(/Revisão \d+ · dados de/);
    await expect(page.getByTestId('planilha-baixar-detalhe')).toContainText('só no servidor (não publicada no destino)');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('planilha-baixar').click()]);
    expect(download.suggestedFilename()).toMatch(/^Praca-Reversa-.+-r\d{6}-\d{8}T\d{6}Z-.+\.xlsx$/);
    expect(readFileSync(await download.path()).subarray(0, 2).toString('latin1')).toBe('PK');
    await expect(page.getByTestId('planilha-versoes').locator('li').first()).toContainText(/Revisão \d+/);
    await capturar(page, 'situacao-sem-destino');
  });

  test('operador consulta a situação sem reprocessar nem baixar', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'verificado no computador');
    await entrar(page, 'operador');
    await abrirTela(page);
    await expect(page.getByTestId('planilha-item')).toHaveCount(6);
    await expect(page.getByTestId('planilha-publicar')).toHaveCount(0);
    await expect(page.getByTestId('planilha-baixar')).toHaveCount(0);
    expect((await page.request.get('/api/v1/planilha/arquivo')).status()).toBe(403);
  });
});
