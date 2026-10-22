import { expect, test, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { abrirMenuConta, aguardarMapa, aguardarMapaParado, centroDaCaixa, entrar, forma, mapa, obterPraca, type PracaApi, verMais } from './apoio';
import { credenciais, type Credenciais } from './credenciais';

/**
 * Busca e importação pela interface (etapa 06), no escopo de teste não
 * demonstrativo: importar produtos (CSV) → revisar devoluções (XLSX com várias
 * abas e linhas inválidas; relatório de erros) → confirmar um documento →
 * buscar o SKU → escolher o palete com saldo validado → mapa centralizado no
 * palete certo; respostas antigas da busca descartadas; contexto preservado
 * ao voltar; permissões; celular (Pixel 7 emulado).
 */

const FIXTURE_XLSX = 'apps/api/test/fixtures/excel/devolucoes-varias-abas.xlsx';

async function chamar(page: Page, metodo: 'POST' | 'PUT', caminho: string, corpo: unknown): Promise<APIResponse> {
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
}

function livresF05(praca: PracaApi): { id: string; code: string }[] {
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  return praca.layout.positions.filter((p) => p.code.startsWith('F05-') && p.available && !ocupadas.has(p.id)).map((p) => ({ id: p.id, code: p.code }));
}

/** Palete reconciliado pelo fluxo real (conferência completa e reconciliação do supervisor). */
async function paleteComSaldo(page: Page, posicaoId: string, produtoId: string, quantidade: string, lote: string): Promise<Palete> {
  const p = await exigir<Palete>(await chamar(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: posicaoId, notes: null, declaredItems: [] }), 201);
  const s = await exigir<{ id: string }>(await chamar(page, 'POST', `/api/v1/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: p.version }), 201);
  await exigir(
    await chamar(page, 'POST', `/api/v1/conferencias/${s.id}/observacoes`, {
      mode: 'MANUAL',
      productId: produtoId,
      quantity: quantidade,
      unit: 'UN',
      lot: lote,
      originType: 'DEVOLUCAO',
      originReference: 'DEV-E2E-BUSCA',
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
  return exigir<Palete>(await page.request.get(`/api/v1/paletes/${p.id}`), 200);
}

function csv(linhas: string[][]): Buffer {
  return Buffer.from(String.fromCharCode(0xfeff) + linhas.map((l) => l.join(';')).join('\r\n') + '\r\n', 'utf8');
}

/** Envia o arquivo pela tela e gera a prévia com as colunas sugeridas. */
async function importarPelaTela(page: Page, tipo: 'PRODUTOS' | 'DEVOLUCOES', nome: string, conteudo: Buffer, opcoes: { planilha?: string } = {}) {
  await page.goto('/importacoes/nova');
  await page.getByTestId(`tipo-${tipo}`).check();
  await page.getByTestId('arquivo-importacao').setInputFiles({
    name: nome,
    mimeType: nome.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
    buffer: conteudo,
  });
  await page.getByTestId('enviar-arquivo').click();
  await expect(page.getByTestId('secao-mapeamento')).toBeVisible();
  await expect(page.getByTestId('interpretacao')).toBeVisible();
  if (opcoes.planilha) {
    await page.getByTestId('escolher-planilha').selectOption(opcoes.planilha);
    await expect(page.getByTestId('interpretacao')).toContainText(`Planilha "${opcoes.planilha}"`);
  }
  await expect(page.getByTestId('coluna-sku')).not.toHaveValue('');
  await page.getByTestId('gerar-previa').click();
  await expect(page.getByTestId('secao-previa')).toBeVisible();
  await expect(page.getByTestId('versao-previa')).toContainText('versão');
}

async function confirmarPelaTela(page: Page) {
  await page.getByTestId('confirmar-revisao').check();
  await page.getByTestId('confirmar-importacao').click();
  await expect(page.getByTestId('aviso-confirmacao')).toContainText('confirmada pelo servidor');
  await expect(page.getByTestId('resumo-lote')).toHaveAttribute('data-situacao', 'CONFIRMADO');
}

async function trocarUsuario(page: Page, quem: keyof Credenciais): Promise<void> {
  await abrirMenuConta(page);
  await page.getByRole('button', { name: 'Sair' }).click();
  const { login, senha } = credenciais()[quem];
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByTestId('menu-conta')).toBeVisible();
}

const sufixo = (testInfo: TestInfo) => (testInfo.project.name === 'celular' ? 'C' : 'D');

test.describe('busca e importação', () => {
  test('computador: importar produtos → revisar devoluções → confirmar documento → buscar SKU → centralizar o palete certo', async ({ page, isMobile }, testInfo) => {
    test.skip(isMobile, 'Fluxo de computador.');
    test.setTimeout(180_000);
    const s = sufixo(testInfo);
    const sku = `00E2E${s}1`;
    await entrar(page, 'supervisor');

    // 1. Produtos por CSV: zeros à esquerda preservados; o produto 000123 serve ao XLSX das devoluções.
    await importarPelaTela(
      page,
      'PRODUTOS',
      'produtos-e2e.csv',
      csv([
        ['SKU', 'Descrição', 'Unidade canônica', 'Código de barras', 'Embalagem do código', 'Fator'],
        [sku, `Xampu E2E ${s}`, 'UN', `0789E2E${s}0001`, 'UN', '1'],
        ['000123', 'Xampu teste E2E', 'UN', '10200000123008', 'CX', '12'],
        ['MODELO-KG', 'Pó a granel E2E', 'KG', '', '', ''],
      ]),
    );
    await expect(page.getByTestId('contadores-lote')).toContainText('Serão gravadas: 3');
    await expect(page.locator('[data-testid="linha-importacao"][data-linha="2"]')).toContainText(sku);
    await confirmarPelaTela(page);
    await expect(page.getByTestId('resultado-gravacao')).toContainText('3 produto(s) criado(s)');

    // 2. Devoluções em XLSX com várias abas: escolher a aba; linhas inválidas bloqueiam; relatório de erros.
    await importarPelaTela(page, 'DEVOLUCOES', 'devolucoes-e2e.xlsx', readFileSync(FIXTURE_XLSX), { planilha: 'Devoluções' });
    await expect(page.getByTestId('contadores-lote')).toContainText('precisam de correção: 5');
    await expect(page.getByTestId('bloqueio-confirmacao')).toBeVisible();
    await expect(page.getByTestId('confirmar-importacao')).toBeDisabled();
    await page.getByTestId('filtro-INVALIDA').click();
    await expect(page.locator('[data-testid="linha-importacao"][data-linha="4"]')).toContainText('Zeros à esquerda');
    await expect(page.locator('[data-testid="linha-importacao"][data-linha="6"]')).toContainText('fórmula');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('baixar-relatorio').click()]);
    const relatorio = readFileSync(await download.path(), 'utf8');
    expect(relatorio).toContain('"Inválida"');
    expect(relatorio).toContain('"DEV-XL-0002"');
    // Remapear invalida a prévia anterior (nova versão).
    const versaoAntes = await page.getByTestId('versao-previa').innerText();
    await page.getByTestId('alterar-colunas').click();
    await page.getByTestId('decimal-ponto').check();
    await page.getByTestId('gerar-previa').click();
    await expect(page.getByTestId('versao-previa')).not.toHaveText(versaoAntes);

    // 3. Documento de 100 UN confirmado: declaração documental, nenhum saldo.
    const doc = `DEV-E2E-${s}`;
    await importarPelaTela(
      page,
      'DEVOLUCOES',
      'devolucao-e2e.csv',
      csv([
        ['Referência da devolução', 'Linha', 'SKU', 'Quantidade declarada', 'Unidade declarada', 'NF', 'Lote', 'Data do documento'],
        [doc, '1', sku, '100', 'UN', '000045678', '', '15/09/2026'],
      ]),
    );
    await expect(page.getByTestId('contadores-lote')).toContainText('Serão gravadas: 1');
    await confirmarPelaTela(page);
    await expect(page.getByTestId('resultado-gravacao')).toContainText('Nenhum saldo físico foi criado');

    // 4. Saldo validado em dois paletes (5 e 7) pelo fluxo real.
    const produtos = (await (await page.request.get(`/api/v1/produtos?texto=${sku}`)).json()) as { items: { id: string }[] };
    const produtoId = produtos.items[0]?.id ?? '';
    const [p1, p2] = livresF05(await obterPraca(page));
    if (!p1 || !p2) throw new Error('Sem posições livres em F05.');
    const pa = await paleteComSaldo(page, p1.id, produtoId, '5', 'L-A');
    const pb = await paleteComSaldo(page, p2.id, produtoId, '7', 'L-B');

    // 5. Buscar o SKU: dois saldos validados e o documento à parte; resumo sem somar bases.
    await page.goto('/');
    await aguardarMapa(page);
    await page.getByTestId('campo-busca').fill(sku);
    await expect(page.getByTestId('busca-total')).toContainText('3 resultado(s)');
    const resultados = page.getByTestId('resultado-busca');
    await expect(resultados).toHaveCount(3);
    await expect(page.locator('[data-testid="resultado-busca"][data-base="DOCUMENTO"]')).toContainText('sem vínculo físico');
    await expect(page.locator('[data-testid="resultado-busca"][data-base="DOCUMENTO"]')).toContainText('nenhum palete ou endereço é presumido');
    const resumo = page.getByTestId('resumo-busca');
    await expect(resumo.locator('[data-base="SALDO_VALIDADO"]')).toContainText('12 UN');
    await expect(resumo.locator('[data-base="DOCUMENTO"]')).toContainText('100 UN');
    await expect(resumo).not.toContainText('112');
    // Mapa destaca só os paletes do resultado.
    await expect(page.locator('path[data-palete-id]:not(.pr-palete--esmaecido)')).toHaveCount(2);

    // 6. Escolher o palete B: o mapa centraliza o palete certo e a janela dele abre; detalhes completos recolhidos nela.
    await page.locator(`[data-testid="resultado-busca"][data-base="SALDO_VALIDADO"][data-palete="${pb.code}"]`).getByTestId('resultado-abrir').click();
    await expect(page.getByTestId('janela-titulo')).toHaveText(`Palete ${pb.code}`);
    await expect(page.getByTestId('detalhe')).toHaveCount(0);
    await verMais(page);
    await expect(page.getByTestId('itens-saldo')).toContainText('7 UN');
    await aguardarMapaParado(page);
    const noMapa = await centroDaCaixa(forma(page, pb.code));
    const centroMapa = await centroDaCaixa(mapa(page));
    expect(Math.abs(noMapa.x - centroMapa.x)).toBeLessThan(6);
    expect(Math.abs(noMapa.y - centroMapa.y)).toBeLessThan(6);
    await expect(page.locator('path.pr-palete--selecionado')).toHaveAttribute('data-codigo', pb.code);
    expect(pa.code).not.toBe(pb.code);

    // 7. Abrir o histórico e voltar: busca, resultado e escolha preservados.
    await page.getByTestId('acao-historico').click();
    await expect(page).toHaveURL(new RegExp(`/paletes/${pb.id}/historico`));
    await page.goBack();
    await expect(page.getByTestId('painel-busca')).toBeVisible();
    await expect(page.getByTestId('campo-busca')).toHaveValue(sku);
    await expect(page.locator(`[data-testid="resultado-busca"][data-palete="${pb.code}"][aria-current="true"]`)).toHaveCount(1);
    // A volta pela rota do palete reabre a janela dele; fechar devolve o mapa com a busca.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('janela-palete')).toHaveCount(0);

    // 8. Exportação CSV do mesmo filtro.
    const [exportado] = await Promise.all([page.waitForEvent('download'), page.getByTestId('busca-exportar').click()]);
    const conteudo = readFileSync(await exportado.path(), 'utf8');
    expect(conteudo).toContain(`texto: ${sku}`);
    expect(conteudo.split('\r\n').filter((l) => l.includes(`"${sku}"`))).toHaveLength(3);
  });

  test('computador: resposta antiga da busca é descartada quando o texto muda', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Fluxo de computador.');
    await entrar(page, 'supervisor');
    await page.route('**/api/v1/busca?*', async (rota) => {
      if (rota.request().url().includes('texto=LENTA')) await new Promise((r) => setTimeout(r, 2_000));
      await rota.continue();
    });
    await aguardarMapa(page);
    await page.getByTestId('campo-busca').fill('LENTA');
    await page.waitForRequest((r) => r.url().includes('texto=LENTA'));
    await page.getByTestId('campo-busca').fill('MODELO-KG');
    await expect(page.getByTestId('busca-total')).toContainText('resultado(s)');
    const atual = await page.getByTestId('busca-total').innerText();
    const resultadosAtuais = await page.getByTestId('resultado-busca').count();
    // Depois que a resposta atrasada de "LENTA" chega, a tela continua mostrando a busca atual.
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId('campo-busca')).toHaveValue('MODELO-KG');
    await expect(page.getByTestId('busca-total')).toHaveText(atual);
    await expect(page.getByTestId('resultado-busca')).toHaveCount(resultadosAtuais);
  });

  test('consulta: busca sem exportar e sem importação; chamada direta negada', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Fluxo de computador.');
    await entrar(page, 'consultaCadastro');
    await aguardarMapa(page);
    await page.getByTestId('campo-busca').fill('000123');
    await expect(page.getByTestId('busca-total')).toContainText('resultado(s)');
    await expect(page.getByTestId('busca-exportar')).toHaveCount(0);
    await abrirMenuConta(page);
    await expect(page.getByRole('button', { name: 'Importações' })).toHaveCount(0);
    await page.goto('/importacoes');
    await expect(page.getByTestId('sem-permissao')).toBeVisible();
    expect((await page.request.get('/api/v1/importacoes')).status()).toBe(403);
    expect((await page.request.get('/api/v1/busca/exportar?texto=000123')).status()).toBe(403);
  });

  test('celular: busca na aba própria, escolha centraliza no mapa; importação sem rolagem horizontal', async ({ page, isMobile }, testInfo) => {
    test.skip(!isMobile, 'Fluxo de celular.');
    test.setTimeout(150_000);
    const s = sufixo(testInfo);
    const sku = `00E2E${s}9`;
    await entrar(page, 'supervisor');
    const produto = await exigir<{ id: string }>(await chamar(page, 'POST', '/api/v1/produtos', { sku, description: `Condicionador E2E ${s}`, canonicalUnit: 'UN', active: true, barcodes: [] }), 201);
    const [p1] = livresF05(await obterPraca(page));
    if (!p1) throw new Error('Sem posição livre em F05.');
    const palete = await paleteComSaldo(page, p1.id, produto.id, '4', 'L-C');

    await page.goto('/');
    await aguardarMapa(page);
    await page.getByRole('button', { name: 'Busca', exact: true }).click();
    await page.getByTestId('campo-busca').fill(sku);
    await expect(page.getByTestId('resultado-busca')).toHaveCount(1);
    const larguras = await page.getByTestId('painel-busca').evaluate((el) => ({ rolagem: el.scrollWidth, visivel: el.clientWidth }));
    expect(larguras.rolagem).toBeLessThanOrEqual(larguras.visivel + 1);
    await page.getByTestId('resultado-abrir').click();
    await expect(page.getByTestId('janela-titulo')).toHaveText(`Palete ${palete.code}`);
    // O voltar do aparelho fecha a janela e mostra o mapa.
    await page.goBack();
    await expect(page.getByTestId('janela-palete')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mapa', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Busca', exact: true }).click();
    await expect(page.getByTestId('campo-busca')).toHaveValue(sku);
    await expect(page.getByTestId('resultado-busca')).toHaveCount(1);

    // Importação pelo celular: prévia legível, sem rolagem horizontal da página.
    await importarPelaTela(
      page,
      'PRODUTOS',
      'produtos-celular.csv',
      csv([
        ['SKU', 'Descrição', 'Unidade canônica', 'Código de barras', 'Embalagem do código', 'Fator'],
        [`00CEL${s}`, 'Produto celular', 'UN', '', '', ''],
      ]),
    );
    const pagina = await page.getByTestId('tela-importacao').evaluate((el) => ({ rolagem: el.scrollWidth, visivel: el.clientWidth }));
    expect(pagina.rolagem).toBeLessThanOrEqual(pagina.visivel + 1);
    await confirmarPelaTela(page);
    await trocarUsuario(page, 'consultaCadastro');
    await page.goto('/');
    await aguardarMapa(page);
    await page.getByRole('button', { name: 'Busca', exact: true }).click();
    await expect(page.getByTestId('campo-busca')).toHaveValue('');
  });
});
