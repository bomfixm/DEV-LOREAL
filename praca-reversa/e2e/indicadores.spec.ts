import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { aguardarMapa, ehCelular, entrar, obterPraca } from './apoio';

/**
 * Indicadores, relatórios e retirada de palete vazio pela interface (etapa
 * 10), no computador e no celular. Números do servidor, base explícita,
 * áreas fora do perfil não enviadas, exportação com permissão própria e
 * consolidação que libera posição sem saída de estoque. Dados fictícios.
 */

async function chamar(page: Page, metodo: 'POST' | 'PATCH', caminho: string, corpo: unknown): Promise<APIResponse> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return page.request.fetch(caminho, { method: metodo, data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
}

async function exigir<T>(r: APIResponse, status: number): Promise<T> {
  expect(r.status(), await r.text()).toBe(status);
  return (await r.json()) as T;
}

interface Palete {
  id: string;
  code: string;
  version: number;
  currentItems: { segmentId: string; quantity: string }[] | null;
}

async function palete(page: Page, id: string): Promise<Palete> {
  return exigir<Palete>(await page.request.get(`/api/v1/paletes/${id}`), 200);
}

async function reconciliar(page: Page, paleteId: string, produtoId: string, quantidade: string): Promise<void> {
  const p = await palete(page, paleteId);
  const s = await exigir<{ id: string }>(await chamar(page, 'POST', `/api/v1/paletes/${paleteId}/conferencias`, { scope: 'COMPLETA', expectedVersion: p.version }), 201);
  await exigir(
    await chamar(page, 'POST', `/api/v1/conferencias/${s.id}/observacoes`, {
      mode: 'MANUAL',
      productId: produtoId,
      quantity: quantidade,
      unit: 'UN',
      lot: 'L-IND',
      originType: 'DEVOLUCAO',
      originReference: 'DEV-E2E-10',
      condition: 'SAUDAVEL',
    }),
    201,
  );
  const d = await exigir<{ revision: number; pallet: { version: number } }>(await page.request.get(`/api/v1/conferencias/${s.id}`), 200);
  const c = await exigir<{ pallet: { version: number } }>(
    await chamar(page, 'POST', `/api/v1/conferencias/${s.id}/concluir`, { expectedRevision: d.revision, expectedPalletVersion: d.pallet.version, confirmFullScope: true }),
    200,
  );
  await exigir(await chamar(page, 'POST', `/api/v1/conferencias/${s.id}/reconciliar`, { expectedPalletVersion: c.pallet.version, justification: 'Saldo de teste E2E' }), 200);
}

test.describe('Indicadores', () => {
  test('painel com base explícita: praça, conferência, estoque, janelas; detalhar abre o relatório', async ({ page }) => {
    await entrar(page, 'supervisorDemo');
    await aguardarMapa(page);
    await page.goto('/indicadores');
    const tela = page.getByTestId('tela-indicadores');
    await expect(tela.getByTestId('base-posicoes')).toContainText('Base: posições cadastradas — validação do layout pendente');
    await expect(tela.getByTestId('indicadores-periodo')).toContainText('America/Sao_Paulo, início e fim inclusivos');
    await expect(tela.getByTestId('ind-ocupacao')).toContainText('%');
    await expect(tela.getByTestId('ind-ocupacao')).toContainText('provisória');
    await expect(tela.getByTestId('ind-desconhecido')).toContainText('Conteúdo desconhecido não é zero');
    await expect(tela.getByTestId('fluxo-estoque')).toContainText('✓ fecha');
    await expect(tela.getByTestId('ind-janelas')).toBeVisible();
    await expect(tela.getByTestId('ind-indisponiveis')).toContainText('Produtividade e tempo poupado');
    // Os números de paletes não conferidos levam ao relatório já filtrado.
    await tela.getByTestId('ind-conf-NAO_CONFERIDO').getByRole('button').click();
    const rel = page.getByTestId('relatorio');
    await expect(rel).toHaveAttribute('data-tipo', 'paletes');
    await expect(rel).toContainText('Conferência: Não conferido');
    await expect(page.getByTestId('relatorio-tabela')).toContainText('PAL-DEMO-002');
    await expect(page.getByTestId('relatorio-tabela')).not.toContainText('PAL-DEMO-001');
  });

  test('perfil Consulta não recebe claims nem valores e não exporta', async ({ page }) => {
    await entrar(page, 'consulta');
    await aguardarMapa(page);
    const pedidos: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/v1/indicadores')) pedidos.push(r.url());
    });
    await page.goto('/indicadores');
    await expect(page.getByTestId('ind-praca')).toBeVisible();
    await expect(page.getByTestId('ind-claims')).toBeHidden();
    await expect(page.getByTestId('ind-valores')).toBeHidden();
    await expect(page.getByTestId('ind-restritas')).toContainText('claims e valores');
    // A própria resposta da API não traz os números restritos.
    const corpo = (await (await page.request.get('/api/v1/indicadores')).json()) as { claims: unknown; valores: unknown };
    expect(corpo.claims).toBeNull();
    expect(corpo.valores).toBeNull();
    await page.goto('/relatorios');
    await expect(page.getByTestId('relatorio-claims')).toHaveCount(0);
    await expect(page.getByTestId('relatorio')).toBeVisible();
    await expect(page.getByTestId('relatorio-exportar')).toHaveCount(0);
    expect((await page.request.get('/api/v1/relatorios/paletes/exportar')).status()).toBe(403);
  });

  test('analista vê valores separados por moeda e exporta CSV com filtros, base e horário', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'Download verificado no computador.');
    await entrar(page, 'financeiroDemo');
    await aguardarMapa(page);
    await page.goto('/indicadores');
    await expect(page.getByTestId('ind-valores')).toContainText('não é valor evitado');
    await page.goto('/relatorios?tipo=claims');
    await expect(page.getByTestId('relatorio')).toHaveAttribute('data-tipo', 'claims');
    const download = page.waitForEvent('download');
    await page.getByTestId('relatorio-exportar').click();
    const arquivo = await download;
    expect(arquivo.suggestedFilename()).toMatch(/^relatorio-claims-[\d-]+\.csv$/);
    const texto = readFileSync(await arquivo.path(), 'utf8');
    expect(texto).toContain('"Claims: recuperações, regularizações e valores — Praça Reversa"');
    expect(texto).toContain('(demonstração, dados fictícios)');
    expect(texto).toContain('"Consultado em"');
    expect(texto).toContain('Valor estimado não é valor evitado');
  });
});

test.describe('Consolidação pela interface', () => {
  test('transferir tudo e retirar o palete vazio: a posição fica livre e o estoque não muda', async ({ page }, testInfo) => {
    const s = ehCelular(testInfo) ? '2' : '1';
    await entrar(page, 'supervisor');
    const praca = await obterPraca(page);
    const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
    const [p1, p2] = praca.layout.positions.filter((p) => p.code.startsWith('F02-') && p.available && !ocupadas.has(p.id));
    if (!p1 || !p2) throw new Error('Sem posições livres em F02.');
    const produto = await exigir<{ id: string }>(
      await chamar(page, 'POST', '/api/v1/produtos', { sku: `CONS-${s}-${randomUUID().slice(0, 6)}`, description: 'Produto fictício da consolidação', canonicalUnit: 'UN', active: true, barcodes: [] }),
      201,
    );
    const novo = async (posicao: string) => exigir<Palete>(await chamar(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: posicao, notes: null, declaredItems: [] }), 201);
    const origem = await novo(p1.id);
    const destino = await novo(p2.id);
    await reconciliar(page, origem.id, produto.id, '7');
    await reconciliar(page, destino.id, produto.id, '2');
    const o = await palete(page, origem.id);
    const d = await palete(page, destino.id);
    await exigir(
      await chamar(page, 'POST', '/api/v1/transferencias', {
        sourcePalletId: o.id,
        destinationPalletId: d.id,
        segmentId: o.currentItems?.[0]?.segmentId,
        quantity: '7',
        expectedSourceVersion: o.version,
        expectedDestinationVersion: d.version,
        reason: 'Consolidação de paletes',
      }),
      200,
    );
    const antes = (await (await page.request.get('/api/v1/indicadores')).json()) as { praca: { positions: { occupied: number } }; estoque: { current: { unit: string; validated: string }[] } };
    await page.goto(`/paletes/${origem.id}`);
    await page.getByTestId('acao-retirar').click();
    const tela = page.getByTestId('tela-retirar');
    await expect(tela).toContainText('Não é saída de estoque');
    await expect(page.getByTestId('retirar-endereco')).toHaveText(p1.code);
    await page.getByTestId('motivo-retirar').fill(`Conteúdo consolidado no palete ${d.code}`);
    await expect(page.getByTestId('confirmar-retirada')).toBeDisabled();
    await page.getByTestId('confirmar-vazio').check();
    await page.getByTestId('confirmar-retirada').click();
    await expect(page.getByTestId('retirada-confirmada')).toContainText(`saiu da posição ${p1.code}`);
    const depois = (await (await page.request.get('/api/v1/indicadores')).json()) as typeof antes;
    expect(depois.praca.positions.occupied).toBe(antes.praca.positions.occupied - 1);
    expect(depois.estoque.current).toEqual(antes.estoque.current);
    const pracaDepois = await obterPraca(page);
    expect(pracaDepois.pallets.some((p) => p.id === origem.id)).toBe(false);
    expect((await palete(page, destino.id)).currentItems?.[0]?.quantity).toBe('9');
  });
});
