import { expect, test, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { abrirMenuConta, aguardarMapa, aguardarMapaParado, centroDaCaixa, entrar, forma, mapa, obterPraca, type PracaApi } from './apoio';
import { credenciais, type Credenciais } from './credenciais';

/**
 * Claims pela interface (etapa 07), no escopo de teste não demonstrativo:
 * importar uma lista com falta de 12 → ver dois candidatos do mesmo SKU (um
 * de outra origem) → abrir o palete compatível no mapa e voltar ao caso no
 * mesmo contexto → registrar evidência de 3 → solicitar e validar → manter 9
 * sem recuperação → regularização parcial por perfil com aprovação
 * financeira → histórico e valores separados; permissões; celular.
 * Dados fictícios.
 */

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

function livres(praca: PracaApi, prefixo: string): { id: string; code: string }[] {
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  return praca.layout.positions.filter((p) => p.code.startsWith(prefixo) && p.available && !ocupadas.has(p.id)).map((p) => ({ id: p.id, code: p.code }));
}

/** Palete com saldo validado pelo fluxo real (conferência completa reconciliada). */
async function paleteComSaldo(page: Page, posicaoId: string | null, produtoId: string, quantidade: string, origem: string): Promise<Palete> {
  const p = await exigir<Palete>(await chamar(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: posicaoId, notes: null, declaredItems: [] }), 201);
  const s = await exigir<{ id: string }>(await chamar(page, 'POST', `/api/v1/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: p.version }), 201);
  await exigir(
    await chamar(page, 'POST', `/api/v1/conferencias/${s.id}/observacoes`, {
      mode: 'MANUAL',
      productId: produtoId,
      quantity: quantidade,
      unit: 'UN',
      lot: 'L-01',
      originType: 'DEVOLUCAO',
      originReference: origem,
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

async function trocarUsuario(page: Page, quem: keyof Credenciais): Promise<void> {
  await abrirMenuConta(page);
  await page.getByRole('button', { name: 'Sair' }).click();
  const { login, senha } = credenciais()[quem];
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByTestId('menu-conta')).toBeVisible();
}

function csv(linhas: string[][]): Buffer {
  return Buffer.from(String.fromCharCode(0xfeff) + linhas.map((l) => l.join(';')).join('\r\n') + '\r\n', 'utf8');
}

const CAB = ['Referência do claim', 'Linha do claim', 'Motivo', 'SKU', 'Quantidade em análise', 'Unidade', 'Lote', 'Tipo da origem', 'Referência da origem', 'Linha da origem', 'Prazo', 'Valor estimado', 'Base do valor', 'Moeda', 'Fonte do valor'];

const sufixo = (testInfo: TestInfo) => (testInfo.project.name === 'celular' ? 'C' : 'D');

/** Prepara (como supervisor) o produto e dois paletes do mesmo SKU: um da devolução do caso, outro de outra devolução. */
async function cenario(page: Page, s: string, posicao: boolean) {
  const sku = `CLM-E2E-${s}`;
  const produto = await exigir<{ id: string }>(await chamar(page, 'POST', '/api/v1/produtos', { sku, description: `Máscara fictícia ${s}`, canonicalUnit: 'UN', active: true, barcodes: [] }), 201);
  const vagas = posicao ? livres(await obterPraca(page), 'F05-') : [];
  const compativel = await paleteComSaldo(page, vagas[0]?.id ?? null, produto.id, '5', `DEV-E2E-A-${s}`);
  const outraOrigem = await paleteComSaldo(page, vagas[1]?.id ?? null, produto.id, '4', `DEV-E2E-B-${s}`);
  return { sku, compativel, outraOrigem };
}

test.describe('claims', () => {
  test('computador: importar falta de 12 → candidatos → mapa e volta → validar 3 → manter 9 → regularização parcial → histórico', async ({ page, isMobile }, testInfo) => {
    test.skip(isMobile, 'Fluxo de computador.');
    test.setTimeout(240_000);
    const s = sufixo(testInfo);
    await entrar(page, 'supervisor');
    const { sku, compativel, outraOrigem } = await cenario(page, s, true);

    // 1. Analista importa a lista (fluxo da etapa 06, tipo "Lista de claims").
    await trocarUsuario(page, 'analista');
    await page.goto('/importacoes/nova');
    await expect(page.getByTestId('tipo-PRODUTOS')).toBeDisabled();
    await page.getByTestId('tipo-CLAIMS').check();
    await page.getByTestId('arquivo-importacao').setInputFiles({
      name: 'claims-e2e.csv',
      mimeType: 'text/csv',
      buffer: csv([CAB, [`CLM-E2E-REF-${s}`, '1', 'FALTA', sku, '12', 'UN', 'L-01', 'DEVOLUCAO', `DEV-E2E-A-${s}`, '1', '30/11/2026', '10,00', 'UNITARIO', 'BRL', 'Tabela fictícia']]),
    });
    await page.getByTestId('enviar-arquivo').click();
    await expect(page.getByTestId('secao-mapeamento')).toBeVisible();
    await page.getByTestId('gerar-previa').click();
    await expect(page.getByTestId('contadores-lote')).toContainText('Serão gravadas: 1');
    await page.getByTestId('confirmar-revisao').check();
    await page.getByTestId('confirmar-importacao').click();
    await expect(page.getByTestId('resultado-gravacao')).toContainText('1 caso(s) novo(s)');
    await page.getByTestId('ver-claims').click();

    // 2. Lista com filtro e abertura do caso.
    await expect(page.getByTestId('tela-claims')).toBeVisible();
    await page.getByTestId('filtro-texto-claims').fill(`CLM-E2E-REF-${s}`);
    await page.getByTestId('filtro-texto-claims').press('Enter');
    await expect(page.getByTestId('item-claim')).toHaveCount(1);
    await expect(page.getByTestId('item-claim')).toContainText('12 UN');
    await page.getByTestId('item-claim').click();
    await expect(page.getByTestId('claim-situacao')).toHaveText('Em análise');
    await expect(page.getByTestId('total-estimado')).toContainText('120,00 BRL');
    await expect(page.getByTestId('total-evitado')).toHaveText('nenhum');

    // 3. Candidatos: dois do mesmo SKU; o de outra devolução é incompatível e não validável.
    await page.getByTestId('aba-candidatos').click();
    const saldo = page.locator('[data-testid="candidato"][data-base="SALDO_VALIDADO"]');
    await expect(saldo).toHaveCount(2);
    const certo = page.locator(`[data-testid="candidato"][data-palete="${compativel.code}"]`);
    const outro = page.locator(`[data-testid="candidato"][data-palete="${outraOrigem.code}"]`);
    await expect(outro.getByTestId('bloqueios-candidato')).toContainText('Outra origem');
    await expect(outro).toContainText('origem incompatível');
    await expect(certo).toContainText('origem compatível');
    await certo.getByTestId('investigar-candidato').click();
    await expect(page.getByTestId('claim-situacao')).toHaveText('Candidato localizado');

    // 4. Ver no mapa: centraliza o palete certo; "Voltar ao claim" reabre linha e candidatos.
    await page.locator(`[data-testid="candidato"][data-palete="${compativel.code}"]`).getByTestId('ver-no-mapa').click();
    await aguardarMapa(page);
    await expect(page.getByTestId('detalhe').getByRole('heading', { level: 2 })).toHaveText(compativel.code);
    await aguardarMapaParado(page);
    const noMapa = await centroDaCaixa(forma(page, compativel.code));
    const centro = await centroDaCaixa(mapa(page));
    expect(Math.abs(noMapa.x - centro.x)).toBeLessThan(6);
    expect(Math.abs(noMapa.y - centro.y)).toBeLessThan(6);
    await page.getByTestId('voltar-ao-claim').click();
    await expect(page.getByTestId('secao-candidatos')).toBeVisible();
    await expect(page).toHaveURL(/aba=candidatos/);

    // 5. Evidência de material conferido (3) → solicitar → validar.
    await page.locator(`[data-testid="candidato"][data-palete="${compativel.code}"]`).getByTestId('evidencia-material').click();
    await page.getByTestId('evidencia-quantidade').fill('3');
    await page.getByTestId('evidencia-descricao').fill('Conferidas 3 unidades no palete da devolução do caso (fictício).');
    await page.getByTestId('evidencia-material-confirmar').click();
    await expect(page.getByTestId('mensagem-claim')).toContainText('Evidência registrada');
    await page.getByTestId('aba-evidencias').click();
    await page.getByTestId('solicitar-validacao').click();
    await page.getByTestId('solicitar-quantidade').fill('3');
    await page.getByTestId('solicitar-validacao-confirmar').click();
    await expect(page.getByTestId('claim-situacao')).toHaveText('Validação pendente');
    await page.getByTestId('validar-recuperacao').click();
    await page.getByTestId('validar-justificativa').fill('Material conferido, mesma devolução e lote (fictício).');
    await page.getByTestId('validar-recuperacao-confirmar').click();
    await expect(page.getByTestId('total-recuperado')).toHaveText('3 UN');
    await expect(page.getByTestId('total-sem-recuperacao')).toHaveText('9 UN');
    await expect(page.getByTestId('total-evitado')).toHaveText('nenhum');
    await expect(page.getByTestId('recuperacao')).toContainText(compativel.code);

    // 6. Analista sem concessão não registra resultado (só consulta).
    await page.getByTestId('aba-resultados').click();
    await expect(page.getByTestId('form-resultado')).toHaveCount(0);
    const id = /\/claims\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    const negado = await chamar(page, 'POST', `/api/v1/claims/${id}/resultados`, { type: 'REGULARIZACAO', decisionDate: '2026-10-05', lines: [], value: null, currency: null, source: 'x', reference: 'x' });
    expect(negado.status()).toBe(403);

    // 7. Perfil com aprovação financeira registra a regularização parcial (3) com evidência.
    await trocarUsuario(page, 'financeiro');
    await page.goto(`/claims/${id}?aba=resultados`);
    await page.getByTestId('resultado-data').fill('2026-10-05');
    await page.getByTestId('resultado-quantidade').fill('3');
    await page.getByTestId('resultado-valor').fill('30,00');
    await page.getByTestId('resultado-fonte').fill('Portal do cliente (fictício)');
    await page.getByTestId('resultado-referencia').fill('REG-E2E-0001');
    await page.getByTestId('resultado-evidencia').first().check();
    await page.getByTestId('registrar-resultado').click();
    await expect(page.getByTestId('total-evitado')).toHaveText('30,00 BRL');
    await expect(page.getByTestId('total-estimado')).toContainText('120,00 BRL');
    await expect(page.getByTestId('total-sem-recuperacao')).toHaveText('9 UN');
    await page.getByTestId('aba-historico').click();
    await expect(page.getByTestId('lista-historico-claim')).toContainText('Resultado registrado');
    await expect(page.getByTestId('lista-historico-claim')).toContainText('Recuperação física validada');
  });

  test('operador não acessa claims; consulta não vê o menu; chamada direta negada', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Fluxo de computador.');
    await entrar(page, 'operador');
    await abrirMenuConta(page);
    await expect(page.getByRole('button', { name: 'Claims' })).toHaveCount(0);
    await page.goto('/claims');
    await expect(page.getByTestId('sem-permissao')).toBeVisible();
    expect((await page.request.get('/api/v1/claims')).status()).toBe(403);
    expect((await chamar(page, 'POST', '/api/v1/claims', { reason: 'AVARIA', lines: [] })).status()).toBe(403);
  });

  test('celular: lista em cartões, detalhe e candidatos sem rolagem horizontal', async ({ page, isMobile }, testInfo) => {
    test.skip(!isMobile, 'Fluxo de celular.');
    test.setTimeout(180_000);
    const s = sufixo(testInfo);
    await entrar(page, 'supervisor');
    const { sku } = await cenario(page, s, false);
    await trocarUsuario(page, 'analista');
    const caso = await exigir<{ id: string }>(
      await chamar(page, 'POST', '/api/v1/claims', {
        externalReference: `CLM-E2E-CEL-${s}`,
        reason: 'EXTRAVIO_FALTA',
        lines: [{ lineRef: '1', sku, quantity: '12', unit: 'UN', lot: 'L-01', originType: 'DEVOLUCAO', originReference: `DEV-E2E-A-${s}`, originLine: '1' }],
      }),
      200,
    );
    await page.goto('/claims');
    await expect(page.getByTestId('lista-claims')).toBeVisible();
    const largura = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(largura).toBeLessThanOrEqual(0);
    await page.goto(`/claims/${caso.id}?aba=candidatos`);
    await expect(page.locator('[data-testid="candidato"][data-base="SALDO_VALIDADO"]')).toHaveCount(2);
    const largura2 = await page.evaluate(() => {
      const principal = document.querySelector('.principal--pagina');
      return principal ? principal.scrollWidth - principal.clientWidth : 0;
    });
    expect(largura2).toBeLessThanOrEqual(0);
    // Sem posição no mapa: o candidato mostra a pendência de localização.
    await expect(page.locator('[data-testid="candidato"][data-base="SALDO_VALIDADO"]').first()).toContainText('localização pendente');
  });
});
