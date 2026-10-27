import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { aguardarMapa, aguardarMapaParado, entrar } from './apoio';

/**
 * Capturas de evidência da etapa 10 (npm run capturas), uma demonstração com
 * **dados fictícios** na praça informada: convite do primeiro acesso → os
 * seis passos do primeiro percurso ("encontrar um produto e saber em qual
 * palete/endereço ele está") apontando os elementos reais → central de ajuda
 * → ajuda curta na tela → indicadores → relatórios; no celular, o mesmo
 * percurso com o balão encostado no lado oposto ao elemento.
 */
const PASTA = 'docs/capturas/etapa-10';

async function capturar(page: Page, nome: string): Promise<void> {
  mkdirSync(PASTA, { recursive: true });
  // O balão segue o elemento a cada 250 ms: espera assentar antes da foto.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PASTA}/${nome}.png` });
}

async function passo(page: Page, n: number): Promise<void> {
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-passo', String(n));
}

test.describe('capturas etapa 10 @captura', () => {
  test('computador: convite → primeiro percurso → ajuda → indicadores → relatórios', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Fluxo de computador.');
    test.setTimeout(180_000);
    await entrar(page, 'tutorialComputador');
    await aguardarMapaParado(page);
    await expect(page.getByTestId('oferta-tutorial')).toBeVisible();
    await capturar(page, '01-convite-primeiro-acesso');
    await page.getByTestId('oferta-comecar').click();
    await passo(page, 1);
    await capturar(page, '02-passo1-ambiente-demonstracao');
    await page.getByTestId('tutorial-proximo').click();
    await passo(page, 2);
    await capturar(page, '03-passo2-onde-pesquisar');
    await page.getByTestId('campo-busca').fill('DEMO-101');
    await expect(page.getByTestId('tutorial-estado')).toHaveAttribute('data-feito', 'sim');
    await capturar(page, '04-passo2-codigo-pesquisado');
    await page.getByTestId('tutorial-proximo').click();
    await passo(page, 3);
    await capturar(page, '05-passo3-escolher-resultado');
    await page.locator('[data-testid="resultado-busca"][data-palete="PAL-DEMO-001"][data-base="SALDO_VALIDADO"]').getByTestId('resultado-abrir').click();
    await expect(page.getByTestId('tutorial-estado')).toHaveAttribute('data-feito', 'sim');
    await page.getByTestId('tutorial-proximo').click();
    await passo(page, 4);
    await aguardarMapaParado(page);
    await capturar(page, '06-passo4-id-e-endereco');
    await page.getByTestId('tutorial-proximo').click();
    await passo(page, 5);
    await capturar(page, '07-passo5-quantidades-e-pendencias');
    await page.getByTestId('tutorial-proximo').click();
    await passo(page, 6);
    await capturar(page, '08-passo6-repetir-e-proximos-guias');
    await page.getByTestId('tutorial-abrir-ajuda').click();
    await expect(page.getByTestId('tela-ajuda')).toBeVisible();
    await capturar(page, '09-central-de-ajuda');
    await page.getByTestId('guia-conferir').scrollIntoViewIfNeeded();
    await capturar(page, '10-guia-por-tarefa-conferir');

    // Ajuda curta na própria tela (mapa).
    await page.goto('/');
    await aguardarMapa(page);
    await page.getByTestId('ajuda-consultar').first().locator('summary').click();
    await expect(page.getByTestId('guia-consultar').first()).toBeVisible();
    await capturar(page, '11-ajuda-na-tela-do-mapa');

    // Indicadores e relatórios (supervisor de estoque da demonstração).
    await page.getByTestId('menu-conta').locator('summary').click();
    await page.getByRole('button', { name: 'Sair' }).click();
    // Navegar antes da resposta interromperia a saída e manteria a sessão.
    await expect(page.getByTestId('aviso-login')).toHaveText('Você saiu.');
    await entrar(page, 'supervisorDemo');
    await page.goto('/indicadores');
    await expect(page.getByTestId('base-posicoes')).toBeVisible();
    await capturar(page, '12-indicadores');
    // Dashboard de 22/10/2026: estoque e fluxo ficam na aba "Estoque e idade".
    await page.getByTestId('ind-aba-estoque').click();
    await expect(page.getByTestId('ind-estoque')).toBeVisible();
    await capturar(page, '13-indicadores-estoque-e-fluxo');
    await page.goto('/relatorios?tipo=paletes&somentePendencias=1');
    await expect(page.getByTestId('relatorio-tabela')).toBeVisible();
    await capturar(page, '14-relatorio-paletes-e-pendencias');
    await page.goto('/relatorios?tipo=estoque');
    await expect(page.getByTestId('relatorio')).toHaveAttribute('data-tipo', 'estoque');
    await capturar(page, '15-relatorio-movimento-do-estoque');
  });

  test('celular: primeiro percurso com o balão sem cobrir a ação', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Fluxo de celular.');
    test.setTimeout(180_000);
    await entrar(page, 'tutorialCelular');
    await aguardarMapaParado(page);
    await capturar(page, '16-celular-convite');
    await page.getByTestId('oferta-comecar').click();
    await page.getByTestId('tutorial-proximo').click();
    await passo(page, 2);
    await capturar(page, '17-celular-passo2-aba-busca');
    await page.getByRole('button', { name: 'Busca', exact: true }).click();
    await page.getByTestId('campo-busca').fill('DEMO-101');
    await expect(page.getByTestId('tutorial-estado')).toHaveAttribute('data-feito', 'sim');
    await page.getByTestId('tutorial-proximo').click();
    await passo(page, 3);
    await capturar(page, '18-celular-passo3-resultados');
    await page.locator('[data-testid="resultado-busca"][data-palete="PAL-DEMO-001"][data-base="SALDO_VALIDADO"]').getByTestId('resultado-abrir').click();
    await page.getByTestId('tutorial-proximo').click();
    await passo(page, 4);
    await aguardarMapaParado(page);
    await capturar(page, '19-celular-passo4-ver-conteudo');
    await capturar(page, '20-celular-passo4-id-e-endereco');
    await page.getByTestId('tutorial-proximo').click();
    await passo(page, 5);
    await capturar(page, '21-celular-passo5-quantidades');
    await page.getByTestId('tutorial-sair').click();
    await page.goto('/indicadores');
    await expect(page.getByTestId('tela-indicadores')).toBeVisible();
    await capturar(page, '22-celular-indicadores');
  });
});
