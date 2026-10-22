import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mostrarListaPaletesNoMapa } from '../apps/web/src/features/mapa/configuracao';
import { aguardarMapa, ehCelular, entrar, forma, obterPraca } from './apoio';

/**
 * Ajustes de 08/10/2026, no escopo de cadastro do E2E (dados fictícios):
 * "palete livre" em verde no mapa (posição com desocupação confirmada por
 * movimento ou no local) e rolagem do painel esquerdo em tela baixa (só com
 * a lista ativa, D254). Etapa 3: escolher o palete abre a janela dele (nada
 * abre sozinho); "Detalhes completos" dentro dela; fechar mantém a seleção;
 * posição livre oferece "Receber palete aqui".
 * As capturas (@captura) gravam docs/capturas/ajustes-2026-10-08.
 */
const PASTA = 'docs/capturas/ajustes-2026-10-08';

async function capturar(page: Page, nome: string | null): Promise<void> {
  if (nome === null) return;
  mkdirSync(PASTA, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${PASTA}/${nome}.png` });
}

async function chamar(page: Page, caminho: string, corpo: unknown): Promise<APIResponse> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return page.request.fetch(caminho, { method: 'POST', data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
}

async function percurso(page: Page, celular: boolean, capturas: boolean): Promise<void> {
  const nome = (n: string) => (capturas ? `${celular ? 'celular' : 'computador'}-${n}` : null);
  await entrar(page, 'operador');
  // Palete criado numa posição e movido para outra: a origem vira "palete livre".
  const praca = await obterPraca(page);
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  const vagas = praca.layout.positions.filter((p) => p.available && !ocupadas.has(p.id));
  const [a, b, c] = vagas;
  if (!a || !b || !c) throw new Error('Sem posições livres no escopo de cadastro do E2E.');
  const r = await chamar(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: a.id, notes: 'Ajustes (fictício)', declaredItems: [] });
  expect(r.status(), await r.text()).toBe(201);
  const p = (await r.json()) as { id: string; code: string; version: number };
  const mov = await chamar(page, `/api/v1/paletes/${p.id}/movimentos`, { destinationPositionId: b.id, confirmedPositionCode: b.code, expectedVersion: p.version, reason: 'Reorganização (fictício)' });
  expect(mov.status(), await mov.text()).toBe(200);

  await page.goto('/');
  await aguardarMapa(page);
  const livre = page.locator(`path[data-posicao="${a.code}"]`);
  await expect(livre).toHaveAttribute('data-livre', 'true');
  await expect(page.locator(`path[data-posicao="${c.code}"]`)).not.toHaveAttribute('data-livre', 'true');
  await expect(page.locator('.legenda summary')).toContainText('Palete livre');
  if (!celular) {
    await expect(page.getByTestId('posicoes-livres')).toContainText(a.code);
    // Front aprovado: menu lateral com as funções principais e indicadores com dados reais (divergência sem fonte ≠ zero).
    await expect(page.getByTestId('navegacao-principal').getByRole('link', { name: 'Mapa da praça' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('navegacao-principal')).toContainText('Recebimento');
    await expect(page.getByTestId('indicador-livres')).not.toHaveText(/^0\b/);
    await expect(page.getByTestId('indicador-divergencia')).toContainText('Paletes com diferença na conferência');
    await expect(page.locator('.legenda summary')).toContainText('Separação para agenda');
  }
  await capturar(page, nome('01-mapa-palete-livre'));

  // Posição sem palete registrado (não confirmada): o operador confere no local e registra como livre.
  if (celular) {
    await page.evaluate((codigo) => {
      document.querySelector(`path[data-posicao="${codigo}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, c.code);
  } else {
    await page.locator(`path[data-posicao="${c.code}"]`).click({ force: true });
  }
  const detalhe = page.getByTestId('detalhe-posicao');
  await expect(detalhe).toBeVisible();
  await expect(detalhe.getByTestId('posicao-sem-confirmacao')).toContainText('não comprova');
  await expect(detalhe.getByTestId('registrar-livre')).toBeDisabled();
  await detalhe.getByTestId('posicao-conferida').check();
  await capturar(page, nome('02-registrar-posicao-livre'));
  await detalhe.getByTestId('registrar-livre').click();
  await expect(page.getByTestId('mensagem-posicao')).toContainText('palete livre');
  await expect(page.getByTestId('detalhe-posicao').getByTestId('posicao-livre')).toContainText('conferida vazia no local');
  await expect(page.locator(`path[data-posicao="${c.code}"]`)).toHaveAttribute('data-livre', 'true');
  await capturar(page, nome('03-posicao-livre-registrada'));

  // Posição livre: "Receber palete aqui" abre o cadastro com esta posição escolhida.
  await page.getByTestId('detalhe-posicao').getByTestId('receber-palete').click();
  await expect(page).toHaveURL(/\/paletes\/novo\?posicao=/);
  await expect(page.getByLabel('Código da posição')).toHaveValue(c.code);
  await expect(page.getByTestId('situacao-posicao')).toContainText('Livre');
  await capturar(page, nome('04-receber-palete-na-posicao-livre'));
  await page.goBack();
  await aguardarMapa(page);

  // Ao entrar na praça nada fica selecionado; escolher o palete abre a janela dele.
  await expect(page.getByTestId('janela-palete')).toHaveCount(0);
  if (celular) {
    await page.getByRole('button', { name: /^Lista/ }).click();
    await page.getByLabel('Código, posição ou link do QR').fill(p.code);
    await page.locator(`.item-palete[data-codigo="${p.code}"]`).click();
  } else {
    await forma(page, p.code).dispatchEvent('click');
  }
  const janela = page.getByTestId('janela-palete');
  await expect(janela.getByTestId('janela-titulo')).toHaveText(`Palete ${p.code}`);
  await expect(janela.getByTestId('janela-sem-conteudo')).toContainText('Nenhum conteúdo registrado');
  await expect(forma(page, p.code)).toHaveClass(/pr-palete--selecionado/);
  await capturar(page, nome('05-janela-do-palete'));

  // Detalhes completos (recolhidos na janela): a consulta completa existente continua.
  await janela.getByTestId('janela-detalhes-completos').locator('summary').click();
  const completo = janela.getByTestId('detalhe');
  await expect(completo.getByTestId('secao-movimentacoes')).toBeVisible();
  // Agenda: consultar não reserva nem baixa nada; sem pedido, o detalhe diz isso.
  await expect(completo.getByTestId('secao-agenda')).toContainText('não é saída');
  await capturar(page, nome('06-detalhes-completos'));
  await janela.getByTestId('janela-fechar').click();
  await expect(janela).toHaveCount(0);
  // Fechar a janela mantém a seleção marcada no mapa.
  await expect(forma(page, p.code)).toHaveClass(/pr-palete--selecionado/);
}

test.describe('Ajustes de 08/10/2026', () => {
  test('palete livre (receber palete aqui) e janela do palete com detalhes completos', async ({ page }, testInfo) => {
    await percurso(page, ehCelular(testInfo), false);
  });

  test('painel esquerdo rola até o fim em tela baixa', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'No celular a lista ocupa a tela inteira (mesma regra de rolagem).');
    test.skip(!mostrarListaPaletesNoMapa, 'Coluna da lista desativada no computador (features/mapa/configuracao.ts, D254).');
    await page.setViewportSize({ width: 1280, height: 560 });
    await entrar(page, 'operador');
    await aguardarMapa(page);
    const painel = page.locator('.painel-lista');
    // Abre a ajuda para aumentar o conteúdo do painel (antes, o que passava da altura ficava inalcançável).
    const ajuda = painel.locator('.ajuda-tarefa summary').first();
    if ((await ajuda.count()) > 0) await ajuda.click();
    const medidas = await painel.evaluate((el) => ({ rola: el.scrollHeight > el.clientHeight, overflow: getComputedStyle(el).overflowY }));
    expect(medidas.overflow).toBe('auto');
    expect(medidas.rola).toBe(true);
    await painel.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.locator('.item-palete').last()).toBeInViewport();
    // O mapa continua utilizável ao lado.
    await expect(page.getByTestId('mapa')).toBeVisible();
  });

  test('capturas dos ajustes @captura', async ({ page }, testInfo) => {
    await percurso(page, ehCelular(testInfo), true);
  });
});
