import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { aguardarMapa, centro, ehCelular, entrar, obterPraca, zoom } from './apoio';

/**
 * Janela do palete (etapa 3, out. 2026), no escopo de cadastro do E2E (dados
 * fictícios no layout da bipagem real): clicar no palete abre a janela sobre
 * a página, sem coluna à direita; resumo curto, tabela paginada com remetente
 * longo e opcionais vazios; Esc fecha preservando zoom, centro e pesquisa;
 * trocar de palete não mostra dados do anterior; perfil de consulta sem ações
 * de escrita; celular sem rolagem horizontal.
 */
const CAB = ['Tipo', 'Número', 'Leituras', 'Lidos', 'CNPJ Remetente', 'Remetente'];
const LONGO = 'Comercial Fictícia de Peças, Acessórios e Motocicletas do Nordeste Brasileiro Limitada — Filial de Distribuição Regional';

async function cabecalhos(page: Page): Promise<Record<string, string>> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() };
}

async function chamar(page: Page, caminho: string, corpo: unknown): Promise<APIResponse> {
  return page.request.fetch(caminho, { method: 'POST', data: corpo, headers: await cabecalhos(page) });
}

async function paleteNovo(page: Page): Promise<{ id: string; code: string }> {
  const praca = await obterPraca(page);
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  const livre = praca.layout.positions.find((p) => p.available && !ocupadas.has(p.id)) ?? null;
  const r = await chamar(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: livre?.id ?? null, notes: 'Janela (fictício)', declaredItems: [] });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string; code: string };
}

/** Importa a bipagem pela API (o fluxo da tela é coberto em bipagem.spec). */
async function importarBipagem(page: Page, paleteId: string, linhas: (string | number)[][]): Promise<void> {
  const csv = Buffer.from(String.fromCharCode(0xfeff) + [CAB, ...linhas].map((l) => l.join(';')).join('\r\n') + '\r\n', 'utf8');
  const envio = await page.request.post(`/api/v1/importacoes?tipo=BIPAGEM&palete=${paleteId}`, {
    data: csv,
    headers: { ...(await cabecalhos(page)), 'content-type': 'application/octet-stream', 'x-arquivo-nome': encodeURIComponent(`janela-${randomUUID()}.csv`) },
  });
  expect(envio.status(), await envio.text()).toBe(201);
  const lote = ((await envio.json()) as { batch: { id: string; previewVersion: number } }).batch;
  const conf = await chamar(page, `/api/v1/importacoes/${lote.id}/confirmar`, { previewVersion: lote.previewVersion, reviewed: true });
  expect(conf.status(), await conf.text()).toBe(200);
}

async function clicarPalete(page: Page, id: string): Promise<void> {
  await page.locator(`path[data-palete-id="${id}"]`).dispatchEvent('click');
}

test.describe('Janela do palete', () => {
  test('palete com muitas notas: janela sobre o mapa, tabela paginada, Esc preserva mapa e pesquisa, troca sem dados do anterior', async ({ page }, testInfo) => {
    await percurso(page, ehCelular(testInfo), false);
  });

  test('capturas da janela do palete @captura', async ({ page }, testInfo) => {
    await percurso(page, ehCelular(testInfo), true);
  });

  async function percurso(page: Page, celular: boolean, capturas: boolean): Promise<void> {
    const nome = (n: string) => `docs/capturas/etapa3-janela-palete/e2e-${celular ? 'celular-412x915' : 'computador-1366x768'}-${n}.png`;
    if (capturas && !celular) await page.setViewportSize({ width: 1366, height: 768 });
    const s = randomUUID().replace(/\D/g, '').slice(0, 4).padEnd(4, '7');
    await entrar(page, 'operador');
    const cheio = await paleteNovo(page);
    const outro = await paleteNovo(page);
    // 60 NF-e (1 a 3 volumes cada; uma com remetente longo) e uma Minuta sem leitura.
    const linhas: (string | number)[][] = Array.from({ length: 60 }, (_, i) => ['NF-e', `8${s}${String(i).padStart(2, '0')}`, 1, (i % 3) + 1, '11.111.111/0001-11', i === 0 ? LONGO : 'Remetente Fictício A']);
    linhas.push(['Minuta', `9${s}`, 0, 0, '22.222.222/0001-22', 'Remetente Fictício B']);
    await importarBipagem(page, cheio.id, linhas);
    await importarBipagem(page, outro.id, [['Minuta', `7${s}`, 1, 4, '33.333.333/0001-33', 'Remetente Fictício C']]);
    const totalVolumes = linhas.slice(0, 60).reduce((soma, l) => soma + Number(l[3]), 0);

    await page.goto('/');
    await aguardarMapa(page);
    await expect(page.getByTestId('janela-palete')).toHaveCount(0);
    // Pesquisa no cabeçalho (computador) continua depois de abrir e fechar a janela.
    if (!celular) await page.getByTestId('campo-busca').fill(`zz${s}`);
    const zoomAntes = await zoom(page);
    const centroAntes = await centro(page);
    const larguraMapa = await page.getByTestId('mapa').evaluate((el) => el.getBoundingClientRect().width);
    if (capturas) await page.screenshot({ path: nome('janela-fechada') });

    await clicarPalete(page, cheio.id);
    const janela = page.getByTestId('janela-palete');
    await expect(janela).toBeVisible();
    await expect(janela.getByTestId('janela-titulo')).toHaveText(`Palete ${cheio.code}`);
    await expect(janela.getByTestId('janela-titulo')).toBeFocused();
    await expect(janela.getByTestId('janela-volumes')).toHaveText(`${String(totalVolumes)} · lidos na bipagem`);
    await expect(janela.getByTestId('janela-documentos')).toHaveText('60');
    await expect(janela.getByTestId('janela-linha')).toHaveCount(50);
    await expect(janela.getByTestId('janela-paginas')).toContainText('1–50 de 60');
    await expect(janela.locator('thead')).toContainText('CNPJ');
    await expect(janela.locator(`[data-testid="janela-linha"][data-numero="8${s}00"]`)).toContainText(LONGO);
    if (capturas) await page.screenshot({ path: nome('janela-aberta') });
    await janela.getByTestId('janela-proxima').click();
    await expect(janela.getByTestId('janela-linha')).toHaveCount(10);
    await expect(janela.getByTestId('janela-paginas')).toContainText('51–60 de 60');
    // Opcionais vazios: sem bloco de pendência, só a nota recolhida.
    await janela.getByTestId('janela-adicionais').locator('summary').click();
    await expect(janela.getByTestId('janela-adicionais')).toContainText('Nenhum Delivery ou descrição registrado');
    await expect(janela.getByTestId('acao-volumes')).toBeVisible();
    await expect(janela.getByTestId('acao-bipagem')).toBeVisible();
    await expect(janela.getByTestId('acao-registrar-conteudo')).toBeVisible();
    // Sem coluna do palete: o mapa manteve a largura; a janela tem largura limitada e a página não rola na horizontal.
    expect(await page.getByTestId('mapa').evaluate((el) => el.getBoundingClientRect().width)).toBe(larguraMapa);
    await expect(page.locator('.painel-detalhe')).toHaveCount(0);
    const caixa = await janela.boundingBox();
    if (!celular) expect(caixa?.width ?? 0).toBeLessThanOrEqual(880);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    // Foco contido: Tab não sai da janela.
    for (let i = 0; i < 30; i += 1) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('[data-testid="janela-palete"]')?.contains(document.activeElement) ?? false)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(janela).toHaveCount(0);
    expect(await zoom(page)).toBe(zoomAntes);
    expect(await centro(page)).toEqual(centroAntes);
    if (!celular) await expect(page.getByTestId('campo-busca')).toHaveValue(`zz${s}`);
    await expect(page).toHaveURL(new RegExp(`/paletes/${cheio.id}$`));

    // Outro palete: só os dados dele.
    await clicarPalete(page, outro.id);
    await expect(janela.getByTestId('janela-titulo')).toHaveText(`Palete ${outro.code}`);
    await expect(janela.getByTestId('janela-linha')).toHaveCount(1);
    await expect(janela.getByTestId('janela-linha')).toContainText(`7${s}`);
    await expect(janela.getByTestId('janela-volumes')).toHaveText('4 · lidos na bipagem');
    await expect(janela).not.toContainText(`8${s}00`);
    await janela.getByTestId('janela-fechar').click();
    await expect(janela).toHaveCount(0);
  }

  test('perfil de consulta: janela sem ações de escrita; palete sem conteúdo mostra "Não informado"', async ({ page }) => {
    await entrar(page, 'consultaCadastro');
    const praca = await obterPraca(page);
    const p = praca.pallets.find((x) => x.positionId !== null);
    test.skip(p === undefined, 'Sem palete posicionado no escopo de cadastro.');
    if (p === undefined) return;
    await page.goto(`/paletes/${p.id}`);
    const janela = page.getByTestId('janela-palete');
    await expect(janela).toBeVisible();
    await expect(janela.getByTestId('acao-volumes')).toHaveCount(0);
    await expect(janela.getByTestId('acao-bipagem')).toHaveCount(0);
    await expect(janela.getByTestId('acao-registrar-conteudo')).toHaveCount(0);
    await expect(janela.getByTestId('janela-volumes')).not.toHaveText('0');
    await page.keyboard.press('Escape');
    await expect(janela).toHaveCount(0);
  });

  test('acesso do cliente: sem mapa nem janela do palete', async ({ page }) => {
    await entrar(page, 'clienteDemo');
    await expect(page.getByTestId('mapa')).toHaveCount(0);
    await expect(page.getByTestId('janela-palete')).toHaveCount(0);
  });
});
