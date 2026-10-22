import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mostrarListaPaletesNoMapa } from '../apps/web/src/features/mapa/configuracao';
import { aguardarMapa, aguardarMapaParado, ehCelular, entrar, resumo } from './apoio';

/**
 * Reconferência após 20 dias na tela, com dados fictícios da demonstração. O
 * prazo real é calculado e testado na API com relógio controlado
 * (apps/api/test/banco/reconferencia.test.ts); aqui a resposta da praça é
 * marcada como vencida para um palete só no navegador do teste (nada é
 * alterado no banco para simular idade), para conferir cor, rótulo, legenda,
 * resumo, a ação "Conferir palete", o registro da reconferência completa
 * (gravado de verdade, no escopo de demonstração) e o filtro.
 */
const PASTA = 'docs/capturas/reconferencia';

async function marcarVencido(page: Page): Promise<() => { id: string; code: string } | null> {
  let alvo: { id: string; code: string } | null = null;
  await page.route('**/api/v1/praca', async (rota) => {
    const resposta = await rota.fetch();
    const praca = (await resposta.json()) as { pallets: { id: string; code: string; positionId: string | null; reconference: Record<string, unknown> | null }[] };
    const p = praca.pallets.find((x) => (alvo === null ? x.positionId !== null && x.reconference !== null : x.id === alvo.id));
    if (p?.reconference) {
      alvo ??= { id: p.id, code: p.code };
      p.reconference = { ...p.reconference, due: true, daysUntilDue: 0, daysWithoutMovement: 23 };
    }
    await rota.fulfill({ response: resposta, json: praca });
  });
  return () => alvo;
}

test.describe('Reconferência após 20 dias sem movimentação', () => {
  test('palete vencido em laranja com "Reconferência necessária", legenda, resumo, conferir palete e filtro', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'Fluxo de computador (o celular usa os mesmos componentes).');
    const alvo = await marcarVencido(page);
    await entrar(page, 'supervisorDemo');
    await aguardarMapa(page);
    const p = alvo();
    if (!p) throw new Error('Nenhum palete com posição na demonstração.');

    // Mapa: preenchimento laranja (classe) sem perder os outros marcadores; legenda com o significado.
    await expect(page.locator(`path[data-palete-id="${p.id}"]`)).toHaveClass(/pr-palete--reconferencia/);
    await page.locator('.legenda summary').click();
    await expect(page.locator('.legenda')).toContainText('Reconferência necessária');

    // Janela do palete: aviso curto; dias sem movimentação nos detalhes completos; ação "Conferir volumes".
    await page.goto(`/paletes/${p.id}`);
    await aguardarMapa(page);
    await expect(resumo(page).getByTestId('janela-reconferencia')).toHaveText('Precisa conferir');
    await page.getByTestId('janela-detalhes-completos').locator('summary').click();
    await expect(page.getByTestId('dias-sem-movimentacao')).toContainText('23 dias sem movimentação');
    await expect(page.locator('.pr-rotulo-reconferencia').first()).toContainText('Reconferência necessária');
    if (testInfo.tags.includes('@captura') || process.env.CAPTURAR === '1') {
      mkdirSync(PASTA, { recursive: true });
      await aguardarMapaParado(page);
      await page.screenshot({ path: `${PASTA}/01-mapa-palete-vencido.png` });
    }

    // Conferir palete → janela de conferência sobre o mapa; palete sem conteúdo registrado: reconferência completa (palete inteiro, sem diferença).
    await resumo(page).getByTestId('acao-volumes').click();
    const janela = page.getByTestId('janela-conferencia-volumes');
    await expect(janela).toBeVisible();
    const secao = janela.getByTestId('reconferencia-completa');
    await expect(secao).toBeVisible();
    await expect(secao.getByTestId('registrar-reconferencia')).toBeDisabled();
    await secao.getByTestId('reconferencia-inteiro').check();
    if (process.env.CAPTURAR === '1') await page.screenshot({ path: `${PASTA}/02-reconferencia-registrada.png`, fullPage: true });
    await secao.getByTestId('registrar-reconferencia').click();
    // Gravado: a janela fecha e o resultado aparece; o palete volta aberto.
    await expect(janela).toHaveCount(0);
    await expect(page.getByTestId('aviso-resultado')).toContainText('reconferência completa registrada');
    await expect(page.getByTestId('janela-palete')).toBeVisible();

    // Filtro "Precisam de reconferência": consultado no servidor com o mesmo prazo.
    await page.goto('/');
    await aguardarMapa(page);
    const pedido = page.waitForRequest((r) => r.url().includes('/api/v1/paletes?') && r.url().includes('reconferencia=sim'));
    if (!mostrarListaPaletesNoMapa) await page.getByTestId('filtro-mapa').locator('summary').click();
    await page.getByTestId('filtro-reconferencia').locator('input').check();
    await pedido;
  });
});
