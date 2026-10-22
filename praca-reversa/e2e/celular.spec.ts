import { expect, test, type Page } from '@playwright/test';
import { aguardarMapaParado, centro, centroDaCaixa, entrarNoMapa, focarArea, forma, mapa, obterPraca, pinca, verMais, zoom } from './apoio';

test.skip(({ isMobile }) => !isMobile, 'Fluxos do layout de celular.');

// Desenho aprovado: PAL-DEMO-001…003 na Fileira 11 (F01); 004…006 na Fileira 12 (F02).
const INICIO = 'Fileira 11 · FB01';
/** Etapa 3: tocar no palete abre a janela dele (tela cheia no celular). */
const resumo = (page: Page) => page.getByTestId('janela-palete');
const detalhe = (page: Page) => page.getByTestId('detalhe');

test.describe('celular', () => {
  test('login e interface reorganizada: mapa em tela cheia, abas e lista separada', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await expect(page.locator('.app')).toHaveAttribute('data-layout', 'compacto');
    await expect(page.getByRole('navigation', { name: 'Visualização' })).toBeVisible();
    await expect(page.locator('.painel-lista')).toBeHidden();
    await expect(page.locator('.painel-detalhe')).toHaveCount(0);
    const caixaMapa = await mapa(page).boundingBox();
    expect(caixaMapa?.width).toBe(page.viewportSize()?.width);
    await page.getByRole('button', { name: /^Lista/ }).tap();
    await expect(page.locator('.painel-lista')).toBeVisible();
  });

  test('menu da conta acessível por toque, com escopo e saída', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await page.getByTestId('menu-conta').locator('summary').tap();
    await expect(page.getByLabel('Unidade / cliente')).toBeVisible();
    await page.getByRole('button', { name: 'Sair' }).tap();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await expect(page.locator('path[data-palete-id]')).toHaveCount(0);
  });

  test('toque abre a janela do palete; fechar preserva seleção e visão', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await focarArea(page, INICIO);
    await aguardarMapaParado(page);
    const visaoAntes = { z: await zoom(page), c: await centro(page) };
    await forma(page, 'PAL-DEMO-003').tap();
    await expect(resumo(page).getByTestId('janela-titulo')).toHaveText('Palete PAL-DEMO-003');
    await expect(resumo(page).getByTestId('janela-titulo')).toBeFocused();

    await verMais(page);
    await expect(detalhe(page)).toContainText('F01-P03');
    await expect(page.getByTestId('itens-observados')).toContainText('9 UN');
    await expect(page.getByTestId('itens-declarados')).toContainText('12 UN');

    await resumo(page).getByTestId('janela-fechar').tap();
    await expect(resumo(page)).toHaveCount(0);
    expect(await zoom(page)).toBe(visaoAntes.z);
    expect(await centro(page)).toEqual(visaoAntes.c);
    await expect(page.locator('path.pr-palete--selecionado')).toHaveAttribute('data-codigo', 'PAL-DEMO-003');
  });

  test('botão voltar do aparelho fecha a janela sem sair do aplicativo', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await focarArea(page, INICIO);
    await forma(page, 'PAL-DEMO-002').tap();
    await verMais(page);
    await expect(page.getByTestId('conteudo-desconhecido')).toBeVisible();
    await page.goBack();
    await expect(resumo(page)).toHaveCount(0);
    await expect(page.locator('path.pr-palete--selecionado')).toHaveAttribute('data-codigo', 'PAL-DEMO-002');
    // Continua no aplicativo, na rota estável do palete selecionado (etapa 03).
    expect(new URL(page.url()).pathname).toBe('/paletes/00000000-0000-4000-8000-000000000002');
  });

  test('escolher na lista abre a janela; ao fechar, o palete está centralizado no mapa', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await page.getByRole('button', { name: /^Lista/ }).tap();
    await page.getByLabel('Código, posição ou link do QR').fill('PAL-DEMO-001');
    await page.locator('.item-palete[data-codigo="PAL-DEMO-001"]').tap();
    await expect(page.locator('.painel-lista')).toBeHidden();
    await expect(resumo(page).getByTestId('janela-titulo')).toHaveText('Palete PAL-DEMO-001');
    await resumo(page).getByTestId('janela-fechar').tap();
    await expect(resumo(page)).toHaveCount(0);
    await aguardarMapaParado(page);
    const palete = await centroDaCaixa(forma(page, 'PAL-DEMO-001'));
    const caixaMapa = await mapa(page).boundingBox();
    if (!caixaMapa) throw new Error('Mapa sem caixa.');
    expect(Math.abs(palete.x - (caixaMapa.x + caixaMapa.width / 2))).toBeLessThan(4);
    expect(Math.abs(palete.y - (caixaMapa.y + caixaMapa.height / 2))).toBeLessThan(4);
  });

  test('pinça amplia e reduz sem alterar dados', async ({ page }) => {
    await entrarNoMapa(page, 'consultaNavegacao');
    const antes = await obterPraca(page);
    const meio = await centroDaCaixa(mapa(page));
    const inicial = await zoom(page);
    await pinca(page, meio, 60, 260);
    await expect.poll(() => zoom(page)).toBeGreaterThan(inicial);
    await aguardarMapaParado(page);
    const ampliado = await zoom(page);
    await pinca(page, meio, 260, 80);
    await expect.poll(() => zoom(page)).toBeLessThan(ampliado);
    await aguardarMapaParado(page);
    const depois = await obterPraca(page);
    expect(depois.pallets).toEqual(antes.pallets);
    await expect(page.locator('path.pr-palete--selecionado')).toHaveCount(0);
  });

  test('gesto de pinça cancelado deixa o mapa utilizável', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await focarArea(page, INICIO);
    const meio = await centroDaCaixa(mapa(page));
    await pinca(page, meio, 60, 200, 'touchCancel');
    await aguardarMapaParado(page);
    const z = await zoom(page);
    await page.getByRole('button', { name: 'Ampliar' }).tap();
    await expect.poll(() => zoom(page)).toBeGreaterThan(z);
    await aguardarMapaParado(page);
    await page.getByRole('button', { name: 'Ver praça completa' }).tap();
    await aguardarMapaParado(page);
    await focarArea(page, 'Fileira 12 · FB02');
    await forma(page, 'PAL-DEMO-004').tap();
    await expect(resumo(page)).toContainText('PAL-DEMO-004');
  });
});
