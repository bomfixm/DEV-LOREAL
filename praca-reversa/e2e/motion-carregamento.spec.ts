import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { aguardarMapa, ehCelular, entrar, obterPraca } from './apoio';

/**
 * Abertura pós-login e indicador de carregamento (D334), contra o build real
 * e o banco do E2E (dados fictícios). As buscas são atrasadas de propósito
 * pela interceptação do navegador para medir a regra dos 1,5 s:
 * - busca de 1.200 ms: o indicador nunca aparece;
 * - busca de 2.500 ms: aparece aos 1,5 s e sai quando os dados chegam;
 * - erro e cancelamento (troca de rota) não deixam indicador preso;
 * - a abertura toca uma vez, não toca em login rejeitado e não se sobrepõe ao indicador;
 * - movimento reduzido: a abertura toca assim mesmo (D335) e o desenho do indicador fica parado, mesma regra.
 */
const PASTA = 'docs/capturas/motion';
const URL_PRACA = /\/api\/v1\/praca(\?|$)/;
const URL_CONTEUDOS = /\/api\/v1\/paletes\/[^/]+\/conteudos(\?|$)/;

interface Evento {
  t: number;
  abertura: boolean;
  visiveis: number;
}

declare global {
  interface Window {
    __linhaMotion?: Evento[];
  }
}

/** Linha do tempo na página: presença da abertura e quantidade de indicadores visíveis, com o horário (Date.now). */
async function gravarLinhaDoTempo(page: Page) {
  await page.addInitScript(() => {
    const linha: Evento[] = [];
    window.__linhaMotion = linha;
    let anterior = '';
    const registrar = () => {
      const abertura = document.querySelector('[data-testid="abertura"]') !== null;
      const visiveis = document.querySelectorAll('[data-carregamento="visivel"]').length;
      const chave = `${String(abertura)}:${String(visiveis)}`;
      if (chave === anterior) return;
      anterior = chave;
      linha.push({ t: Date.now(), abertura, visiveis });
    };
    new MutationObserver(registrar).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-carregamento'] });
  });
}

async function linhaDoTempo(page: Page): Promise<Evento[]> {
  return page.evaluate(() => window.__linhaMotion ?? []);
}

/** Atrasa a resposta real da API em `ms` e anota quando a busca começou e terminou (horário do sistema). */
async function atrasar(page: Page, url: RegExp, ms: number, falhar = false) {
  const marcas: { inicio: number; fim: number }[] = [];
  await page.route(url, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const inicio = Date.now();
    await new Promise((r) => setTimeout(r, ms));
    try {
      if (falhar) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ codigo: 'ERRO_INTERNO', mensagem: 'Falha simulada no teste.' }) });
      else await route.continue();
    } catch {
      // Página fechada ou busca cancelada pela interface: nada a fazer.
    }
    marcas.push({ inicio, fim: Date.now() });
  });
  return marcas;
}

/** Intervalos em que algum indicador esteve visível. */
function intervalosVisiveis(linha: Evento[]): { de: number; ate: number | null }[] {
  const intervalos: { de: number; ate: number | null }[] = [];
  for (const e of linha) {
    const aberto = intervalos.at(-1);
    if (e.visiveis > 0 && aberto?.ate !== null) intervalos.push({ de: e.t, ate: null });
    if (e.visiveis === 0 && aberto?.ate === null) aberto.ate = e.t;
  }
  return intervalos;
}

/** Navegação interna (sem recarregar a página), como um link do app. */
async function irPara(page: Page, caminho: string) {
  await page.evaluate((c) => {
    history.pushState(null, '', c);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, caminho);
}

test.beforeEach(async ({ page }) => {
  await gravarLinhaDoTempo(page);
});

test('busca de 1.200 ms: nenhum indicador; a abertura toca uma vez e não repete na navegação interna', async ({ page }) => {
  const marcas = await atrasar(page, URL_PRACA, 1200);
  await entrar(page, 'consulta');
  await aguardarMapa(page);
  expect(marcas.length).toBeGreaterThan(0);
  // Navega por outras telas e volta: a abertura não toca de novo.
  await irPara(page, '/claims');
  await page.waitForTimeout(400);
  await irPara(page, '/');
  await aguardarMapa(page);
  await page.waitForTimeout(1600);
  const linha = await linhaDoTempo(page);
  expect(intervalosVisiveis(linha)).toEqual([]);
  const aparicoes = linha.filter((e, i) => e.abertura && !(linha[i - 1]?.abertura ?? false)).length;
  expect(aparicoes).toBe(1);
});

test('busca de 2.500 ms: o indicador aparece aos 1,5 s, sem sobrepor a abertura, e sai quando os dados chegam', async ({ page }, testInfo) => {
  const marcas = await atrasar(page, URL_PRACA, 2500);
  await entrar(page, 'consulta');
  const indicador = page.locator('[data-carregamento="visivel"]');
  await expect(indicador).toHaveCount(1);
  // Embalagem vetorial animada (SVG com caminho e animação nativa), variação principal.
  await expect(indicador).toHaveClass(/carregamento--principal/);
  await expect(indicador.locator('svg[data-animado="sim"] path animate[attributeName="d"]')).toHaveCount(2);
  await expect(indicador).toContainText('Carregando…');
  if (testInfo.project.name === 'computador' || testInfo.project.name === 'celular') {
    mkdirSync(PASTA, { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${PASTA}/carregamento-principal-${testInfo.project.name}.png` });
  }
  await aguardarMapa(page);
  await expect(indicador).toHaveCount(0);

  const linha = await linhaDoTempo(page);
  const busca = marcas[0];
  expect(busca).toBeDefined();
  if (!busca) return;
  const vis = intervalosVisiveis(linha);
  expect(vis).toHaveLength(1);
  const [intervalo] = vis;
  if (!intervalo) return;
  // Aparece só depois de 1,5 s da busca (margem para o tempo da página registrar a busca).
  expect(intervalo.de - busca.inicio).toBeGreaterThanOrEqual(1400);
  expect(intervalo.de - busca.inicio).toBeLessThan(2100);
  // Sai assim que os dados chegam (sem esperar o ciclo do desenho).
  expect(intervalo.ate).not.toBeNull();
  expect((intervalo.ate ?? 0) - busca.fim).toBeLessThan(600);
  // Nunca abertura e indicador ao mesmo tempo.
  expect(linha.some((e) => e.abertura && e.visiveis > 0)).toBe(false);
});

test('login rejeitado: sem abertura', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Usuário').fill('ninguem.motion');
  await page.getByLabel('Senha', { exact: true }).fill('senha-errada-motion');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  await page.waitForTimeout(1500);
  const linha = await linhaDoTempo(page);
  expect(linha.some((e) => e.abertura)).toBe(false);
  await expect(page.getByTestId('menu-conta')).toHaveCount(0);
});

test('erro depois de 1,5 s: o indicador sai e a tela de erro aparece', async ({ page }) => {
  await atrasar(page, URL_PRACA, 2000, true);
  await entrar(page, 'consulta');
  await expect(page.getByTestId('erro-praca')).toBeVisible();
  await expect(page.locator('[data-carregamento]')).toHaveCount(0);
  const vis = intervalosVisiveis(await linhaDoTempo(page));
  expect(vis.every((v) => v.ate !== null)).toBe(true);
});

test('compacta na janela do palete; troca de rota no meio cancela sem indicador preso', async ({ page }, testInfo) => {
  await entrar(page, 'consulta');
  await aguardarMapa(page);
  const praca = await obterPraca(page);
  const [p1, p2] = praca.pallets;
  expect(p1).toBeDefined();
  if (!p1 || !p2) return;
  await atrasar(page, URL_CONTEUDOS, 2500);

  // Lenta: indicador compacto dentro da janela; no computador o mapa continua à vista.
  await irPara(page, `/paletes/${p1.id}`);
  const janela = page.getByTestId('janela-palete');
  await expect(janela).toBeVisible();
  const indicador = janela.locator('[data-carregamento="visivel"]');
  await expect(indicador).toHaveCount(1);
  await expect(indicador).toHaveClass(/carregamento--compacta/);
  if (!ehCelular(testInfo)) await expect(page.getByTestId('mapa')).toBeVisible();
  mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: `${PASTA}/carregamento-compacto-${testInfo.project.name}.png` });
  await expect(indicador).toHaveCount(0, { timeout: 5000 });

  // Cancelada antes de 1,5 s (volta ao mapa): nada aparece depois.
  const antes = (await linhaDoTempo(page)).length;
  await irPara(page, `/paletes/${p2.id}`);
  await page.waitForTimeout(700);
  await irPara(page, '/');
  await page.waitForTimeout(2500);
  const depois = (await linhaDoTempo(page)).slice(antes);
  expect(intervalosVisiveis(depois)).toEqual([]);
  await expect(page.locator('[data-carregamento="visivel"]')).toHaveCount(0);
});

test.describe('movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' });

  test('a abertura toca assim mesmo; desenho estático com a mesma regra dos 1,5 s', async ({ page }, testInfo) => {
    const marcas = await atrasar(page, URL_PRACA, 2500);
    await entrar(page, 'consulta');
    const indicador = page.locator('[data-carregamento="visivel"]');
    await expect(indicador).toHaveCount(1);
    await expect(indicador.locator('svg[data-animado="nao"]')).toHaveCount(1);
    await expect(indicador.locator('animate')).toHaveCount(0);
    mkdirSync(PASTA, { recursive: true });
    await page.screenshot({ path: `${PASTA}/carregamento-reduzido-${testInfo.project.name}.png` });
    await aguardarMapa(page);
    await expect(indicador).toHaveCount(0);
    const linha = await linhaDoTempo(page);
    expect(linha.some((e) => e.abertura)).toBe(true);
    expect(linha.some((e) => e.abertura && e.visiveis > 0)).toBe(false);
    const [intervalo] = intervalosVisiveis(linha);
    const busca = marcas[0];
    expect(intervalo && busca ? intervalo.de - busca.inicio : 0).toBeGreaterThanOrEqual(1400);
  });
});

test('captura da abertura (meio da animação)', async ({ page }, testInfo) => {
  await page.goto('/');
  const { login, senha } = await import('./credenciais').then((m) => m.credenciais().consulta);
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByTestId('abertura')).toBeAttached();
  await page.waitForTimeout(550);
  mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: `${PASTA}/abertura-${testInfo.project.name}.png` });
  await expect(page.getByTestId('abertura')).toHaveCount(0);
  // Cliques não ficam bloqueados: a camada não recebe eventos.
  await expect(page.getByTestId('menu-conta')).toBeVisible();
});
