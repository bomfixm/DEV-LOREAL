import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { entrar } from './apoio';

/**
 * Dashboard de Indicadores (pedido de 22/10/2026): a tela usa toda a área
 * útil ao lado do menu (sem coluna central limitada, sem rolagem horizontal,
 * sem zoom/escala, fonte ≥ 12 px) em 1920, 2560, 1366, 1280, 768, 390 e
 * 320 px de largura, a 200% de zoom (1366×768 → 683×384 px de CSS), com o
 * menu compacto ou expandido e nos dois temas. Dados fictícios (escopo de
 * demonstração do E2E). FASE_CAPTURA=antes só fotografa a tela anterior.
 */
const PASTA = 'docs/capturas/indicadores-dashboard';
const ANTES = process.env.FASE_CAPTURA === 'antes';
type Menu = 'compacto' | 'expandido';
type Tema = 'claro' | 'escuro';

/** [largura, altura, rótulo]; 683×384 = 1366×768 com zoom de 200% no navegador. */
const TAMANHOS = [
  [1920, 1080, '1920x1080'],
  [2560, 1440, '2560x1440'],
  [1366, 768, '1366x768'],
  [1280, 720, '1280x720'],
  [768, 1024, '768x1024'],
  [390, 844, '390x844'],
  [320, 640, '320x640'],
  [683, 384, '1366x768-zoom-200'],
] as const;

const KPIS = ['ind-kpi-paletes', 'ind-kpi-livres', 'ind-kpi-nao-conferidos', 'ind-kpi-mudancas'];

async function abrir(browser: Browser, testInfo: TestInfo, largura: number, altura: number, menu: Menu, tema: Tema): Promise<Page> {
  const celular = largura < 600;
  const contexto = await browser.newContext({
    viewport: { width: largura, height: altura },
    baseURL: testInfo.project.use.baseURL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    isMobile: celular,
    hasTouch: celular,
    deviceScaleFactor: celular ? 2 : 1,
  });
  const page = await contexto.newPage();
  await page.addInitScript(
    ([m, t]) => {
      try {
        window.localStorage.setItem('praca-reversa:menu', m);
        window.localStorage.setItem('praca-reversa:tema', t);
      } catch {
        // Sem armazenamento: a verificação do tema falha adiante.
      }
    },
    [menu, tema] as const,
  );
  await entrar(page, 'supervisorDemo');
  await page.goto('/indicadores');
  await expect(page.getByTestId('tela-indicadores')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-tema', tema);
  if (ANTES) await expect(page.getByTestId('base-posicoes')).toBeVisible();
  else await expect(page.getByTestId('indicadores-consultado-em')).toBeVisible();
  await page.waitForTimeout(400);
  return page;
}

/** Largura aproveitada, sem rolagem horizontal, sem escala e com fonte legível. */
async function conferirLargura(page: Page, rotulo: string, menu: Menu): Promise<void> {
  const m = await page.evaluate(() => {
    const raiz = document.scrollingElement ?? document.documentElement;
    const main = document.querySelector<HTMLElement>('main[data-testid="tela-indicadores"]');
    const tela = document.querySelector<HTMLElement>('[data-testid="ind-tela"]');
    const barra = document.querySelector<HTMLElement>('[data-testid="barra-lateral"]');
    if (main === null || tela === null) return null;
    const rm = main.getBoundingClientRect();
    const rt = tela.getBoundingClientRect();
    let menorFonte = 99;
    for (const el of tela.querySelectorAll<HTMLElement>('*')) {
      const temTexto = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (!temTexto || el.offsetParent === null || el.closest('.visualmente-oculto, [hidden]')) continue;
      menorFonte = Math.min(menorFonte, Number.parseFloat(getComputedStyle(el).fontSize));
    }
    // Elementos que passam da borda direita da área (corte ou rolagem horizontal escondida).
    const passam = [...tela.querySelectorAll<HTMLElement>('*')]
      .filter((el) => el.offsetParent !== null && !el.closest('.tabela-rolagem') && el.getBoundingClientRect().right > rt.right + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    return {
      paginaH: raiz.scrollWidth - raiz.clientWidth,
      mainH: main.scrollWidth - main.clientWidth,
      vazioEsquerda: rt.left - rm.left,
      vazioDireita: rm.right - rt.right,
      larguraMain: rm.width,
      larguraTela: rt.width,
      barraDireita: barra ? barra.getBoundingClientRect().right : 0,
      mainEsquerda: rm.left,
      alturaTela: rt.height,
      alturaMain: main.clientHeight,
      menorFonte,
      passam,
      escala: [document.documentElement, document.body, main, tela].map((e) => `${getComputedStyle(e).transform}|${getComputedStyle(e).zoom}`),
    };
  });
  expect(m, `${rotulo}: tela montada`).not.toBeNull();
  if (m === null) return;
  expect(m.paginaH, `${rotulo}: rolagem horizontal da página`).toBeLessThanOrEqual(1);
  expect(m.mainH, `${rotulo}: rolagem horizontal da área`).toBeLessThanOrEqual(1);
  expect(m.passam, `${rotulo}: nada passa da borda direita`).toEqual([]);
  // A área ocupa a largura inteira ao lado do menu (sem coluna central): sem faixas laterais além do respiro.
  expect(m.larguraTela, `${rotulo}: largura da área`).toBeGreaterThanOrEqual(m.larguraMain - 1);
  expect(m.vazioEsquerda, `${rotulo}: faixa à esquerda`).toBeLessThanOrEqual(1);
  expect(m.vazioDireita, `${rotulo}: faixa à direita`).toBeLessThanOrEqual(1);
  // O conteúdo começa logo depois do menu (compacto ou expandido); sem coluna reservada no celular.
  if (m.barraDireita > 0) expect(Math.abs(m.mainEsquerda - m.barraDireita), `${rotulo}: menu ${menu} sem espaço reservado`).toBeLessThanOrEqual(1);
  else expect(m.mainEsquerda, `${rotulo}: sem coluna de menu no celular`).toBeLessThanOrEqual(1);
  // Ocupa ao menos a altura útil da área (sem esticar painel vazio: o rodapé desce).
  expect(m.alturaTela, `${rotulo}: altura útil`).toBeGreaterThanOrEqual(m.alturaMain - 1);
  expect(m.menorFonte, `${rotulo}: menor fonte`).toBeGreaterThanOrEqual(12);
  for (const e of m.escala) expect(['none|1'], `${rotulo}: sem transform/zoom`).toContain(e);
}

/** Captura da página inteira: a janela cresce até a altura do conteúdo (a rolagem é da área principal). */
async function capturar(page: Page, nome: string): Promise<void> {
  mkdirSync(PASTA, { recursive: true });
  const tamanho = page.viewportSize();
  if (tamanho === null) return;
  const altura = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main');
    const topo = main?.getBoundingClientRect().top ?? 0;
    return Math.ceil(topo + (main?.scrollHeight ?? 0));
  });
  await page.setViewportSize({ width: tamanho.width, height: Math.max(tamanho.height, altura) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${PASTA}/${nome}.png` });
  await page.setViewportSize(tamanho);
}

test.describe('Indicadores: dashboard na área útil', () => {
  test('largura toda, sem rolagem horizontal nem escala: sete tamanhos, zoom 200%, menu compacto e expandido, claro e escuro', async ({ browser }, testInfo) => {
    test.skip(ANTES || testInfo.project.name !== 'computador', 'Aceite de leiaute: projeto computador (cada tamanho num contexto próprio).');
    test.setTimeout(300_000);
    for (const [largura, altura, rotulo] of TAMANHOS) {
      const combinacoes: readonly (readonly [Menu, Tema])[] =
        largura >= 1024
          ? [
              ['compacto', 'claro'],
              ['expandido', 'escuro'],
            ]
          : [['compacto', largura === 390 ? 'escuro' : 'claro']];
      for (const [menu, tema] of combinacoes) {
        const page = await abrir(browser, testInfo, largura, altura, menu, tema);
        const nome = `${rotulo} menu ${menu} ${tema}`;
        for (const id of KPIS) await expect(page.getByTestId(id), nome).toBeVisible();
        await conferirLargura(page, nome, menu);
        // Cada aba de detalhe também cabe na largura, com fonte legível.
        for (const [aba, modulo] of [
          ['movimentacoes', 'ind-praca'],
          ['conferencias', 'ind-conferencia'],
          ['estoque', 'ind-estoque'],
          ['claims', 'ind-claims'],
        ] as const) {
          await page.getByTestId(`ind-aba-${aba}`).click();
          await expect(page).toHaveURL(new RegExp(`aba=${aba}`));
          await expect(page.getByTestId(modulo)).toBeVisible();
          await conferirLargura(page, `${nome} (aba ${aba})`, menu);
        }
        await page.context().close();
      }
    }
  });

  test('menu expandido e recolhido na mesma tela: a área acompanha sem espaço reservado', async ({ browser }, testInfo) => {
    test.skip(ANTES || testInfo.project.name !== 'computador', 'Computador.');
    const page = await abrir(browser, testInfo, 1366, 768, 'compacto', 'claro');
    const largura = async () => page.getByTestId('ind-tela').evaluate((e) => e.getBoundingClientRect().width);
    const compacto = await largura();
    await page.getByTestId('alternar-menu').click();
    await expect(page.getByTestId('barra-lateral')).toHaveAttribute('data-estado', 'expandido');
    const expandido = await largura();
    expect(compacto - expandido).toBeGreaterThan(100);
    await conferirLargura(page, '1366 menu expandido (alternado)', 'expandido');
    await page.getByTestId('alternar-menu').click();
    await expect.poll(largura).toBeCloseTo(compacto, 0);
    await page.context().close();
  });

  test('capturas: desktop claro e escuro, notebook, tablet, celular e abas @captura', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'computador', 'Capturas geradas a partir do projeto computador.');
    test.setTimeout(300_000);
    if (ANTES) {
      for (const [largura, altura, rotulo, tema] of [
        [1920, 1080, '1920x1080', 'claro'],
        [1920, 1080, '1920x1080', 'escuro'],
        [390, 844, '390x844', 'claro'],
      ] as const) {
        const page = await abrir(browser, testInfo, largura, altura, 'compacto', tema);
        await page.screenshot({ path: `${PASTA}/antes-${rotulo}-${tema}.png` });
        await page.context().close();
      }
      return;
    }
    const fotos: readonly (readonly [number, number, string, Menu, Tema])[] = [
      [1920, 1080, '1920x1080', 'compacto', 'claro'],
      [1920, 1080, '1920x1080', 'expandido', 'escuro'],
      [2560, 1440, '2560x1440', 'compacto', 'claro'],
      [1366, 768, '1366x768', 'expandido', 'claro'],
      [1280, 720, '1280x720', 'compacto', 'escuro'],
      [768, 1024, '768x1024', 'compacto', 'claro'],
      [390, 844, '390x844', 'compacto', 'claro'],
      [390, 844, '390x844', 'compacto', 'escuro'],
      [320, 640, '320x640', 'compacto', 'claro'],
    ];
    for (const [largura, altura, rotulo, menu, tema] of fotos) {
      const page = await abrir(browser, testInfo, largura, altura, menu, tema);
      await capturar(page, `depois-${rotulo}-menu-${menu}-${tema}`);
      if (largura === 1920 && tema === 'claro') {
        for (const aba of ['movimentacoes', 'conferencias', 'estoque'] as const) {
          await page.getByTestId(`ind-aba-${aba}`).click();
          await capturar(page, `depois-${rotulo}-aba-${aba}-${tema}`);
        }
        await page.getByTestId('ind-aba-visao').click();
        await page.getByTestId('indicadores-sobre').click();
        await expect(page.getByTestId('ind-sobre')).toBeVisible();
        await page.screenshot({ path: `${PASTA}/depois-${rotulo}-sobre-os-numeros-${tema}.png` });
      }
      await page.context().close();
    }
  });
});
