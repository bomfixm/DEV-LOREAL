import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { aguardarMapa, aguardarMapaParado, ehCelular, entrar, obterPraca } from './apoio';

/**
 * Capturas "antes" e "depois" do redesign do front (dados fictícios do E2E):
 * mesmas telas e mesmos passos nas duas fases. FASE=antes|depois escolhe o
 * prefixo dos arquivos em docs/capturas/redesign. Só roda com @captura.
 */
const PASTA = 'docs/capturas/redesign';
const FASE = process.env.FASE === 'antes' ? 'antes' : 'depois';

async function capturar(page: Page, celular: boolean, nome: string): Promise<void> {
  mkdirSync(PASTA, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${PASTA}/${FASE}-${celular ? 'celular' : 'computador'}-${nome}.png` });
}

async function chamar(page: Page, caminho: string, corpo: unknown): Promise<APIResponse> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return page.request.fetch(caminho, { method: 'POST', data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
}

async function abrirPesquisa(page: Page, celular: boolean): Promise<void> {
  if (celular) await page.getByRole('button', { name: 'Busca', exact: true }).click();
  else if (await page.getByTestId('painel-busca-botao').isVisible()) await page.getByTestId('painel-busca-botao').click();
}

test.describe('Redesign do front: capturas antes/depois @captura', () => {
  test('mapa, pesquisa, resumo, Ver mais e páginas principais', async ({ page }, testInfo) => {
    const celular = ehCelular(testInfo);
    await entrar(page, 'supervisorDemo');
    await aguardarMapa(page);
    await aguardarMapaParado(page);
    await capturar(page, celular, '01-mapa');

    // Pesquisa: localiza sem abrir o palete.
    await abrirPesquisa(page, celular);
    await page.getByTestId('campo-busca').fill('PAL-DEMO-001');
    await expect(page.getByTestId('resultado-busca').first()).toBeVisible();
    await capturar(page, celular, '02-pesquisa');

    // Etapa 3: escolher o resultado abre a janela do palete; detalhes completos recolhidos nela.
    await page.locator('[data-testid="resultado-busca"][data-palete="PAL-DEMO-001"] [data-testid="resultado-abrir"]').first().click();
    await expect(page.getByTestId('janela-palete')).toContainText('PAL-DEMO-001');
    await aguardarMapaParado(page);
    await capturar(page, celular, '03-resumo');
    await page.getByTestId('janela-detalhes-completos').locator('summary').click();
    await expect(page.getByTestId('detalhe')).toBeVisible();
    await capturar(page, celular, '04-ver-mais');
    await page.keyboard.press('Escape');
    if (celular) return;

    for (const [rota, nome] of [
      ['/inventarios', '06-inventario'],
      ['/paletes/novo', '07-recebimento'],
      ['/janelas', '08-agendas'],
      // Rota antiga do catálogo de SKU (retirado): abre "Registrar conteúdo".
      ['/produtos/catalogo', '09-registrar-conteudo'],
    ] as const) {
      await page.goto(rota);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('main h2').first()).toBeVisible();
      await page.waitForTimeout(1500);
      await capturar(page, celular, nome);
    }
  });

  test('nota com duas Deliveries (conteúdo registrado, fictício): 1 documento, 2 parcelas', async ({ page }, testInfo) => {
    const celular = ehCelular(testInfo);
    test.skip(celular, 'Uma captura basta (computador).');
    const s = randomUUID().replace(/\D/g, '').slice(0, 5).padEnd(5, '7');
    await entrar(page, 'operador');
    const praca = await obterPraca(page);
    const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
    const livre = praca.layout.positions.find((p) => p.available && !ocupadas.has(p.id)) ?? null;
    const r = await chamar(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: livre?.id ?? null, notes: 'Redesign (fictício)', declaredItems: [] });
    expect(r.status(), await r.text()).toBe(201);
    const p = (await r.json()) as { id: string; code: string };
    // A bipagem real não traz Delivery (complemento manual): a mesma NFD com duas Deliveries vem do cadastro de conteúdo.
    for (const [delivery, volumes] of [[`DLV-${s}-A`, 3], [`DLV-${s}-B`, 7]] as const) {
      const c = await chamar(page, `/api/v1/paletes/${p.id}/conteudos`, { sender: 'Remetente fictício A', documentType: 'NFD', documentNumber: `00${s}01`, delivery });
      expect(c.status(), await c.text()).toBe(201);
      const itens = ((await c.json()) as { items: { id: string; delivery: string | null }[] }).items;
      const alvo = itens.find((i) => i.delivery === delivery);
      const k = await chamar(page, `/api/v1/paletes/${p.id}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id: alvo?.id }, counted: volumes, origin: 'CONTAGEM_INFORMADA', reference: null });
      expect(k.status(), await k.text()).toBe(201);
    }
    await page.goto(`/paletes/${p.id}`);
    await expect(page.getByTestId('janela-documentos')).toHaveText('1');
    await expect(page.getByTestId('janela-volumes')).toContainText('10');
    await page.getByTestId('janela-detalhes-completos').locator('summary').click();
    const tabela = page.getByTestId('tabela-documentos');
    await expect(tabela.getByTestId('linha-documento')).toHaveCount(2);
    await expect(tabela).toContainText('1 documento');
    await tabela.scrollIntoViewIfNeeded();
    await capturar(page, celular, '05-duas-deliveries');
  });
});
