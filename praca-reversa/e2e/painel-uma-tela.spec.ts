import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ehCelular, entrar } from './apoio';
import type { Credenciais } from './credenciais';

/**
 * Etapa 4 (19 out. 2026): o resumo dos painéis cabe numa tela no computador
 * (1366×768, 1280×720 e 1920×1080), com o menu compacto ou expandido e nos
 * dois temas, sem rolagem da página, sem conteúdo cortado, sem zoom/escala e
 * sem fonte abaixo de 12 px. Dados fictícios (demonstração e escopos do E2E).
 * FASE_CAPTURA=antes só fotografa o leiaute anterior (nada é verificado).
 */
const PASTA = 'docs/capturas/etapa4-dashboard';
const ANTES = process.env.FASE_CAPTURA === 'antes';
const capturar = (tags: readonly string[]) => ANTES || tags.includes('@captura') || process.env.CAPTURAR === '1';
const TAMANHOS = [
  [1366, 768],
  [1280, 720],
  [1920, 1080],
] as const;
type Menu = 'compacto' | 'expandido';
type Tema = 'claro' | 'escuro';

const WIDGETS_OPERACAO = ['painel-filtros', 'card-paletes', 'card-volumes', 'card-sem-endereco', 'card-reconferencia', 'painel-janela', 'painel-situacao', 'painel-ruas', 'painel-prioridades'];
const WIDGETS_CLIENTE = ['painel-filtros', 'cli-card-paletes', 'cli-card-volumes', 'cli-card-solicitado', 'cli-card-expedido', 'cliente-janela', 'cliente-etapas', 'painel-ruas', 'cliente-historico'];

async function preferencias(page: Page, menu: Menu, tema: Tema) {
  await page.addInitScript(
    ([m, t]) => {
      try {
        window.localStorage.setItem('praca-reversa:menu', m);
        window.localStorage.setItem('praca-reversa:tema', t);
      } catch {
        // Sem armazenamento: o teste falha adiante ao conferir o tema.
      }
    },
    [menu, tema] as const,
  );
}

/** Página sem rolagem, widgets inteiros dentro da tela, nada cortado, sem escala e fonte ≥ 12 px. */
async function cabeNaTela(page: Page, widgets: readonly string[], rotulo: string) {
  const medida = await page.evaluate((ids) => {
    const raiz = document.scrollingElement ?? document.documentElement;
    const rolagens = [...document.querySelectorAll<HTMLElement>('main, .pagina-conteudo, .painel-tela')].map((e) => ({
      classe: e.className,
      vertical: e.scrollHeight - e.clientHeight,
      horizontal: e.scrollWidth - e.clientWidth,
    }));
    const fora = ids.flatMap((id) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (el === null) return [`${id}: ausente`];
      const r = el.getBoundingClientRect();
      const problemas: string[] = [];
      if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight + 0.5 || r.right > window.innerWidth + 0.5) problemas.push(`${id}: fora da tela ${JSON.stringify({ top: r.top, bottom: r.bottom, right: r.right })}`);
      // Conteúdo cortado dentro do widget (inclusive por overflow escondido).
      if (el.scrollHeight - el.clientHeight > 1 || el.scrollWidth - el.clientWidth > 1) problemas.push(`${id}: conteúdo cortado ${String(el.scrollHeight)}/${String(el.clientHeight)}`);
      return problemas;
    });
    // Menor fonte com texto visível dentro do resumo.
    let menorFonte = 99;
    for (const el of document.querySelectorAll<HTMLElement>('.painel-tela *')) {
      const temTexto = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (!temTexto || el.offsetParent === null || el.closest('.visualmente-oculto')) continue;
      menorFonte = Math.min(menorFonte, Number.parseFloat(getComputedStyle(el).fontSize));
    }
    const escala = [document.documentElement, document.body, document.querySelector('main'), document.querySelector('.painel-tela')].map((e) => (e ? `${getComputedStyle(e).transform}|${getComputedStyle(e).zoom}` : ''));
    return { vertical: raiz.scrollHeight - raiz.clientHeight, horizontal: raiz.scrollWidth - raiz.clientWidth, rolagens, fora, menorFonte, escala };
  }, widgets);
  expect(medida.vertical, `${rotulo}: rolagem vertical da página`).toBeLessThanOrEqual(1);
  expect(medida.horizontal, `${rotulo}: rolagem horizontal da página`).toBeLessThanOrEqual(1);
  for (const r of medida.rolagens) {
    expect(r.vertical, `${rotulo}: rolagem vertical em ${r.classe}`).toBeLessThanOrEqual(1);
    expect(r.horizontal, `${rotulo}: rolagem horizontal em ${r.classe}`).toBeLessThanOrEqual(1);
  }
  expect(medida.fora, rotulo).toEqual([]);
  expect(medida.menorFonte, `${rotulo}: menor fonte`).toBeGreaterThanOrEqual(12);
  for (const e of medida.escala) expect(['', 'none|1'], `${rotulo}: sem transform/zoom`).toContain(e);
}

async function percorrer(page: Page, testInfo: TestInfo, quem: keyof Credenciais, caminho: string, tela: string, widgets: readonly string[], nome: string) {
  test.skip(testInfo.project.name !== 'computador', 'Aceite de uma tela: computador.');
  test.setTimeout(240_000);
  for (const [largura, altura] of TAMANHOS) {
    for (const [menu, tema] of [
      ['compacto', 'claro'],
      ['expandido', 'escuro'],
      ['expandido', 'claro'],
      ['compacto', 'escuro'],
    ] as const) {
      const contexto = await page.context().browser()?.newContext({ viewport: { width: largura, height: altura }, baseURL: testInfo.project.use.baseURL });
      if (!contexto) throw new Error('Sem navegador.');
      const p = await contexto.newPage();
      await preferencias(p, menu, tema);
      await entrar(p, quem);
      await p.goto(caminho);
      await expect(p.getByTestId(tela)).toBeVisible();
      await expect(p.locator('html')).toHaveAttribute('data-tema', tema);
      // Espera a consulta do resumo (e o histórico do cliente) terminar.
      await expect(p.getByTestId('painel-consultado-em').first()).toBeVisible();
      // O app mantém consultas periódicas (sem 'networkidle'): espera o histórico do cliente e as fontes assentarem.
      if (nome === 'cliente' && !ANTES) await expect(p.getByTestId('cliente-historico').locator('.resumo-eventos, .painel-vazio:not(:has-text("Carregando"))')).toBeVisible();
      await p.waitForTimeout(700);
      const rotulo = `${nome} ${String(largura)}×${String(altura)} menu ${menu} tema ${tema}`;
      if (!ANTES) await cabeNaTela(p, widgets, rotulo);
      // Capturas: página inteira (fullPage) no tamanho informado; antes = leiaute anterior.
      if (capturar(testInfo.tags) && (ANTES ? menu === 'compacto' && tema === 'claro' : tema === (menu === 'compacto' ? 'claro' : 'escuro'))) {
        mkdirSync(PASTA, { recursive: true });
        // Antes: a rolagem era interna ao conteúdo; solta a altura para a captura mostrar a página inteira.
        if (ANTES) {
          await p.evaluate(() => {
            for (const el of document.querySelectorAll<HTMLElement>('.app, .app-coluna, main')) {
              el.style.height = 'auto';
              el.style.overflow = 'visible';
            }
          });
        }
        await p.screenshot({ path: `${PASTA}/${ANTES ? 'antes' : 'depois'}-${nome}-${String(largura)}x${String(altura)}-menu-${menu}-${tema}.png`, fullPage: true });
      }
      await contexto.close();
    }
  }
}

test.describe('Painéis em uma tela (etapa 4)', () => {
  test('resumo da operação cabe numa tela: três tamanhos, menu compacto e expandido, claro e escuro @uma-tela', async ({ page }, testInfo) => {
    await percorrer(page, testInfo, 'supervisorDemo', '/painel', 'tela-painel-operacao', WIDGETS_OPERACAO, 'operacao');
  });

  test('resumo do cliente cabe numa tela: três tamanhos, menu compacto e expandido, claro e escuro @uma-tela', async ({ page }, testInfo) => {
    await percorrer(page, testInfo, 'clienteDemo', '/painel/cliente', 'tela-painel-cliente', WIDGETS_CLIENTE, 'cliente');
  });

  test('sem dados: nada vira zero, sem "0 / 0" nem "Em dia"; continua numa tela', async ({ page }, testInfo) => {
    test.skip(ANTES || testInfo.project.name !== 'computador', 'Computador.');
    await page.setViewportSize({ width: 1366, height: 768 });
    await entrar(page, 'adminVazio');
    await page.goto('/painel');
    await expect(page.getByTestId('painel-consultado-em')).toBeVisible();
    const tela = page.getByTestId('tela-painel-operacao');
    await expect(page.getByTestId('card-volumes')).toContainText('Não informado');
    await expect(page.getByTestId('painel-janela')).toContainText('Nenhuma janela');
    await expect(page.getByTestId('painel-ruas')).toContainText('Nenhum palete');
    await expect(page.getByTestId('painel-prioridades')).toContainText('Nenhuma prioridade');
    await expect(tela).not.toContainText('0 / 0');
    await expect(tela).not.toContainText('Em dia');
    await expect(tela).not.toContainText('%');
    await cabeNaTela(page, WIDGETS_OPERACAO, 'vazio 1366×768');
  });

  test('nome longo de janela e meta: quebra a linha, sem rolagem lateral; números e porcentagens da API', async ({ page }, testInfo) => {
    test.skip(ANTES || testInfo.project.name !== 'computador', 'Computador.');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      window.localStorage.setItem('praca-reversa:menu', 'expandido');
    });
    await entrar(page, 'supervisor');
    const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
    const chamar = async (caminho: string, corpo: unknown) => {
      const r = await page.request.post(caminho, { data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
      expect(r.ok(), await r.text()).toBe(true);
      return (await r.json()) as { id: string; version: number };
    };
    const inicio = new Date(Date.now() - 3_600_000).toISOString();
    const nome = `Janela fictícia com nome muito longo para conferir a quebra de linha no painel ${randomUUID().slice(0, 8)}`;
    const criada = await chamar('/api/v1/janelas', {
      name: nome,
      clientReference: '000902',
      referenceMonth: inicio.slice(0, 7),
      exitStart: inicio,
      exitEnd: new Date(Date.now() + 3_600_000).toISOString(),
      restrictions: [{ metric: 'QUANTIDADE', unit: 'UN', limit: '100' }],
      criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: [], notes: null },
      authorization: { source: 'E-mail fictício', reference: '000902', date: inicio.slice(0, 10), responsible: 'Contato fictício' },
      notes: 'Dados fictícios de teste.',
    });
    await chamar(`/api/v1/janelas/${criada.id}/confirmar`, { expectedVersion: criada.version });
    await chamar(`/api/v1/janelas/${criada.id}/volumes/meta`, { volumes: 8000, selectionId: null, reference: 'Teste fictício' });
    await page.goto(`/painel?janela=${criada.id}`);
    const janela = page.getByTestId('painel-janela');
    await expect(janela).toContainText(nome);
    // T 8.000, nada separado nem expedido: falta tudo; 0% só porque há meta válida.
    await expect(janela.getByTestId('janela-solicitado')).toHaveText('8.000');
    await expect(janela.getByTestId('janela-falta-separar')).toHaveText('8.000');
    await expect(janela.getByTestId('janela-falta-expedir')).toHaveText('8.000');
    await expect(janela.getByTestId('barra-preparacao')).toContainText('0,00%');
    await cabeNaTela(page, WIDGETS_OPERACAO, 'nome longo 1280×720 menu expandido');
  });

  test('celular: o resumo segue em coluna, sem rolagem lateral', async ({ page }, testInfo) => {
    test.skip(ANTES || !ehCelular(testInfo), 'Celular.');
    await entrar(page, 'supervisorDemo');
    await page.goto('/painel');
    await expect(page.getByTestId('painel-consultado-em')).toBeVisible();
    for (const id of WIDGETS_OPERACAO) await expect(page.getByTestId(id)).toBeAttached();
    // Nem a página nem o conteúdo (main) rolam para o lado; o cliente também.
    const lateral = () => page.evaluate(() => [document.documentElement, document.querySelector('main')].map((e) => (e ? e.scrollWidth - e.clientWidth : 0)));
    for (const sobra of await lateral()) expect(sobra).toBeLessThanOrEqual(1);
    await page.getByTestId('abrir-detalhes').click();
    await expect(page.getByTestId('painel-detalhes')).toBeVisible();
    await page.getByTestId('janela-fechar').click();
  });

  test('celular: resumo do cliente em coluna, sem rolagem lateral', async ({ page }, testInfo) => {
    test.skip(ANTES || !ehCelular(testInfo), 'Celular.');
    await entrar(page, 'clienteDemo');
    await expect(page.getByTestId('painel-consultado-em')).toBeVisible();
    for (const id of WIDGETS_CLIENTE) await expect(page.getByTestId(id)).toBeAttached();
    const sobras = await page.evaluate(() => [document.documentElement, document.querySelector('main')].map((e) => (e ? e.scrollWidth - e.clientWidth : 0)));
    for (const sobra of sobras) expect(sobra).toBeLessThanOrEqual(1);
  });
});
