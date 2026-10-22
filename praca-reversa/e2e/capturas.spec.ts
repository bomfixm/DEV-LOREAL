import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { abrirPalete, aguardarMapa, aguardarMapaParado, entrar, obterPraca, type PracaApi } from './apoio';

/**
 * Capturas de evidência da etapa 08 (npm run capturas), que também servem de
 * demonstração passo a passo com **dados fictícios** na praça informada
 * (escopo de demonstração): liberar material no palete → cadastrar uma janela
 * autorizada com limite conhecido (e outras três janelas do mês, uma em
 * rascunho com campos pendentes) → material elegível e pendente → reservar
 * uma seleção → lista de preparação e palete no mapa → outra reserva
 * respeita capacidade/saldo → confirmar saída parcial (6 enviados, 2
 * liberados) → baixa única, capacidade restante e histórico → reserva
 * cancelada antes da saída → retorno físico sem apagar a expedição original.
 * Todas as autorizações, datas, documentos e medidas são fictícios. As
 * capturas das etapas anteriores ficam em docs/capturas/etapa-0N.
 */
const PASTA = 'docs/capturas/etapa-08';
const SKU = 'DEMO-808';

async function capturar(page: Page, nome: string, opcoes: { mapa?: boolean; altura?: number } = {}): Promise<void> {
  if (opcoes.mapa) await aguardarMapaParado(page);
  const tamanho = page.viewportSize();
  if (opcoes.altura !== undefined && tamanho) await page.setViewportSize({ width: tamanho.width, height: opcoes.altura });
  await page.screenshot({ path: `${PASTA}/${nome}.png` });
  if (opcoes.altura !== undefined && tamanho) await page.setViewportSize(tamanho);
}

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
  currentItems: { segmentId: string }[] | null;
}

function livres(praca: PracaApi): { id: string; code: string }[] {
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  return praca.layout.positions.filter((p) => p.available && !ocupadas.has(p.id)).map((p) => ({ id: p.id, code: p.code }));
}

/** Palete com saldo validado pelo fluxo real (conferência completa reconciliada), como o supervisor faria. */
async function paleteComSaldo(page: Page, posicaoId: string, produtoId: string, quantidade: string, origem: string): Promise<Palete> {
  const p = await exigir<Palete>(await chamar(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: posicaoId, notes: 'Demonstração (fictício)', declaredItems: [] }), 201);
  const s = await exigir<{ id: string }>(await chamar(page, 'POST', `/api/v1/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: p.version }), 201);
  await exigir(
    await chamar(page, 'POST', `/api/v1/conferencias/${s.id}/observacoes`, {
      mode: 'MANUAL',
      productId: produtoId,
      quantity: quantidade,
      unit: 'UN',
      lot: 'L-DEMO-8',
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
  await exigir(await chamar(page, 'POST', `/api/v1/conferencias/${s.id}/reconciliar`, { expectedPalletVersion: c.pallet.version, justification: 'Saldo de demonstração (fictício)' }), 200);
  return exigir<Palete>(await page.request.get(`/api/v1/paletes/${p.id}`), 200);
}

async function liberar(page: Page, p: Palete, quantidade: string): Promise<Palete> {
  return exigir<Palete>(
    await chamar(page, 'POST', `/api/v1/paletes/${p.id}/liberacao`, {
      action: 'LIBERAR',
      expectedVersion: p.version,
      segmentId: p.currentItems?.[0]?.segmentId,
      quantity: quantidade,
      criterion: 'Material saudável conferido (critério fictício)',
      source: 'Checklist fictício de liberação',
      reference: 'LIB-DEMO-0801',
      reason: 'Liberação de demonstração',
    }),
    200,
  );
}

/** "AAAA-MM-DDTHH:mm" no horário de Brasília, deslocado em minutos de agora. */
function localSp(minutos: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(Date.now() + minutos * 60_000))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year ?? ''}-${p.month ?? ''}-${p.day ?? ''}T${p.hour ?? ''}:${p.minute ?? ''}`;
}

/** Outras janelas fictícias do mês: cada uma com os próprios dados (nada distribuído automaticamente). */
async function outrasJanelas(page: Page): Promise<void> {
  const mes = localSp(0).slice(0, 7);
  const criterios = { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: ['Romaneio fictício'], notes: null };
  const base = (nome: string, dias: number, restricoes: unknown[], confirmar: boolean) => ({
    name: nome,
    clientReference: `AUT-DEMO-08${String(dias).padStart(2, '0')}`,
    referenceMonth: mes,
    exitStart: confirmar ? new Date(Date.now() + dias * 86_400_000).toISOString() : null,
    exitEnd: confirmar ? new Date(Date.now() + dias * 86_400_000 + 4 * 3_600_000).toISOString() : null,
    restrictions: restricoes,
    criteria: confirmar ? criterios : { ...criterios, defined: false },
    authorization: confirmar ? { source: 'E-mail fictício do cliente', reference: `00080${String(dias)}`, date: localSp(0).slice(0, 10), responsible: 'Contato fictício' } : {},
    notes: 'Janela fictícia de demonstração.',
  });
  const j2 = await exigir<{ id: string; version: number }>(await chamar(page, 'POST', '/api/v1/janelas', base('2ª janela do mês (fictícia)', 7, [{ metric: 'VOLUME_M3', limit: '12' }, { metric: 'PALETES', limit: '8' }], true)), 200);
  await exigir(await chamar(page, 'POST', `/api/v1/janelas/${j2.id}/confirmar`, { expectedVersion: j2.version }), 200);
  const j3 = await exigir<{ id: string; version: number }>(await chamar(page, 'POST', '/api/v1/janelas', base('3ª janela do mês (fictícia)', 14, [{ metric: 'PESO_KG', weightBase: 'BRUTO', limit: '800' }], true)), 200);
  await exigir(await chamar(page, 'POST', `/api/v1/janelas/${j3.id}/confirmar`, { expectedVersion: j3.version }), 200);
  await exigir(await chamar(page, 'POST', '/api/v1/janelas', base('4ª janela do mês (fictícia, dados pendentes)', 21, [{ metric: 'QUANTIDADE', unit: 'UN', limit: null }], false)), 200);
}

const PDF_FICTICIO = Buffer.from('%PDF-1.4\n% Comprovante FICTICIO de demonstracao - nao representa documento real\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

test.describe('capturas @captura', () => {
  test('computador: liberar → janela autorizada → elegível/pendente → reservar → preparação no mapa → capacidade → saída parcial → baixa única → cancelamento → retorno', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Capturas de computador.');
    test.setTimeout(300_000);
    await entrar(page, 'supervisorDemo');
    const produto = await exigir<{ id: string }>(await chamar(page, 'POST', '/api/v1/produtos', { sku: SKU, description: 'Shampoo fictício 400 ml', canonicalUnit: 'UN', active: true, barcodes: [] }), 201);
    const vagas = livres(await obterPraca(page));
    const a = await paleteComSaldo(page, vagas[0]?.id ?? '', produto.id, '12', 'DEV-DEMO-0801');
    const b = await paleteComSaldo(page, vagas[1]?.id ?? '', produto.id, '5', 'DEV-DEMO-0802');
    const c = await liberar(page, await paleteComSaldo(page, vagas[2]?.id ?? '', produto.id, '15', 'DEV-DEMO-0803'), '15');

    // 1. Liberação parcial pelo detalhe do palete (conferência não libera).
    await abrirPalete(page, a.id);
    await aguardarMapa(page);
    const lib = page.getByTestId('secao-liberacao');
    await lib.getByTestId('abrir-liberar').click();
    await lib.getByTestId('criterio-liberacao').fill('Material saudável conferido (critério fictício)');
    await lib.getByTestId('fonte-liberacao').fill('Checklist fictício de liberação');
    await lib.getByTestId('motivo-liberacao').fill('Liberação para a janela de demonstração');
    await lib.getByTestId('enviar-liberacao').click();
    await expect(lib.getByTestId('item-liberacao')).toContainText('12 de 12 UN liberado(s)');
    await lib.scrollIntoViewIfNeeded();
    await capturar(page, 'computador-01-liberacao-no-palete', { mapa: true });

    // 2. Cadastro da janela autorizada (dados fictícios).
    await outrasJanelas(page);
    await page.goto('/janelas/nova');
    await page.getByTestId('janela-nome').fill('1ª janela do mês (fictícia)');
    await page.getByTestId('janela-referencia').fill('AUT-DEMO-0801');
    await page.getByTestId('janela-mes').fill(localSp(-360).slice(0, 7));
    await page.getByTestId('janela-saida-inicio').fill(localSp(-360));
    await page.getByTestId('janela-saida-fim').fill(localSp(360));
    await page.getByTestId('adicionar-restricao').click();
    await page.getByTestId('restricao-limite').first().fill('20');
    await page.getByTestId('adicionar-restricao').click();
    await page.getByTestId('restricao-metrica').nth(1).selectOption('PALETES');
    await page.getByTestId('restricao-limite').nth(1).fill('3');
    await page.getByTestId('criterios-definidos').check();
    await page.getByTestId('janela-documentos').fill('Romaneio fictício');
    await page.getByTestId('autorizacao-fonte').fill('E-mail fictício do cliente');
    await page.getByTestId('autorizacao-referencia').fill('000801');
    await page.getByTestId('autorizacao-data').fill(localSp(-1440).slice(0, 10));
    await page.getByTestId('autorizacao-responsavel').fill('Contato fictício');
    await capturar(page, 'computador-02-cadastro-da-janela', { altura: 1900 });
    await page.getByTestId('gravar-janela').click();
    await page.getByTestId('confirmar-janela').click();
    await expect(page.getByTestId('situacao-janela')).toHaveText('Confirmada');
    await capturar(page, 'computador-03-janela-confirmada-capacidade', { altura: 1300 });
    const janelaId = new URL(page.url()).pathname.split('/')[2] ?? '';

    // 3. Visão mensal: quatro janelas cadastradas, cada uma com os próprios dados.
    await page.goto('/janelas');
    await expect(page.getByTestId('cartao-janela')).toHaveCount(4);
    await capturar(page, 'computador-04-lista-mensal', { altura: 1500 });

    // 4. Material elegível (FIFO) e pendências.
    await page.goto(`/janelas/${janelaId}?aba=material`);
    await page.getByTestId('filtro-material').fill(SKU);
    await page.getByTestId('filtro-material').press('Enter');
    await expect(page.locator(`[data-testid="item-material"][data-palete="${a.code}"]`)).toBeVisible();
    await capturar(page, 'computador-05-material-elegivel', { altura: 1100 });
    await page.getByTestId('fila-pendente').click();
    await expect(page.locator(`[data-testid="item-material"][data-palete="${b.code}"]`)).toBeVisible();
    await capturar(page, 'computador-06-pendencias', { altura: 1300 });
    await page.getByTestId('fila-elegivel').click();

    // 5. Reservar 8 do palete A, com revisão no servidor.
    const itemA = page.locator(`[data-testid="item-material"][data-palete="${a.code}"]`);
    await itemA.getByTestId('selecionar-material').check();
    await itemA.getByTestId('quantidade-material').fill('8');
    await page.getByTestId('previa-reserva').click();
    await expect(page.getByTestId('resultado-previa')).toContainText('Tudo cabe');
    await page.getByTestId('revisao-reserva').scrollIntoViewIfNeeded();
    await capturar(page, 'computador-07-revisao-da-reserva', { altura: 1300 });
    await page.getByTestId('confirmar-reserva').click();
    await expect(page.getByTestId('tela-reserva')).toBeVisible();
    await capturar(page, 'computador-08-lista-de-preparacao', { altura: 1100 });
    const reservaUrl = page.url();

    // 6. Palete no mapa a partir da preparação e volta.
    await page.getByTestId('abrir-palete-preparacao').click();
    await aguardarMapa(page);
    await expect(page.getByTestId('retorno-reserva')).toBeVisible();
    await capturar(page, 'computador-09-palete-no-mapa-e-volta', { mapa: true });
    await page.getByTestId('voltar-a-preparacao').click();
    await page.getByTestId('abrir-preparar').click();
    await page.getByTestId('responsavel').selectOption({ label: 'Supervisor demonstração E2E' });
    await page.getByTestId('enviar-preparar').click();
    await expect(page.getByTestId('preparacao-registrada')).toContainText('Separada/preparada');

    // 7. Outra reserva respeita a capacidade: 13 do palete C passa do restante 12.
    await page.goto(`/janelas/${janelaId}?aba=material`);
    await page.getByTestId('filtro-material').fill(SKU);
    await page.getByTestId('filtro-material').press('Enter');
    const itemC = page.locator(`[data-testid="item-material"][data-palete="${c.code}"]`);
    await itemC.getByTestId('selecionar-material').check();
    await itemC.getByTestId('quantidade-material').fill('13');
    await page.getByTestId('previa-reserva').click();
    await expect(page.getByTestId('bloqueios-previa')).toContainText('acima do restante 12');
    await page.getByTestId('revisao-reserva').scrollIntoViewIfNeeded();
    await capturar(page, 'computador-10-outra-reserva-respeita-capacidade', { altura: 1300 });

    // 8. Saída parcial: 6 enviados, 2 liberados.
    await page.goto(reservaUrl);
    await page.getByTestId('abrir-expedir').click();
    await page.getByTestId('responsavel').selectOption({ label: 'Supervisor demonstração E2E' });
    await page.getByTestId('quantidade-linha').fill('6');
    await page.getByTestId('documento-referencia').fill('000123');
    await page.getByTestId('ciente-parcial').check();
    await page.getByTestId('painel-expedir').scrollIntoViewIfNeeded();
    await capturar(page, 'computador-11-confirmar-saida-parcial', { altura: 1600 });
    await page.getByTestId('enviar-expedir').click();
    await expect(page.getByTestId('tela-expedicao')).toBeVisible();
    await capturar(page, 'computador-12-expedicao-baixa-unica', { altura: 1300 });
    const expedicaoUrl = page.url();

    // 9. Capacidade restante 14 (20 − 6) e saldo do palete 6.
    await page.goto(`/janelas/${janelaId}`);
    await expect(page.getByTestId('capacidade')).toContainText('Restam 14');
    await capturar(page, 'computador-13-capacidade-restante-14', { altura: 1100 });

    // 10. Reserva cancelada antes da saída: estoque e capacidade voltam.
    await page.goto(`/janelas/${janelaId}?aba=material`);
    await page.getByTestId('filtro-material').fill(SKU);
    await page.getByTestId('filtro-material').press('Enter');
    const itemC2 = page.locator(`[data-testid="item-material"][data-palete="${c.code}"]`);
    await itemC2.getByTestId('selecionar-material').check();
    await itemC2.getByTestId('quantidade-material').fill('5');
    await page.getByTestId('previa-reserva').click();
    await page.getByTestId('confirmar-reserva').click();
    await expect(page.getByTestId('tela-reserva')).toBeVisible();
    await page.getByTestId('abrir-cancelar-reserva').click();
    await page.getByTestId('motivo-cancelar-reserva').fill('Cliente pediu outra composição (fictício)');
    await page.getByTestId('enviar-cancelar').click();
    await expect(page.getByTestId('situacao-reserva')).toContainText('Cancelada');
    await capturar(page, 'computador-14-reserva-cancelada', { altura: 1100 });

    // 11. Retorno físico ligado à expedição original (que permanece).
    const destino = await exigir<Palete>(await chamar(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: vagas[3]?.id ?? null, notes: 'Recebimento do retorno (fictício)', declaredItems: [] }), 201);
    await page.goto(expedicaoUrl);
    await page.getByTestId('abrir-retorno').click();
    await page.getByTestId('motivo-retorno').fill('Recusa parcial na entrega (fictícia)');
    await page.getByTestId('quantidade-retorno').fill('2');
    await page.getByTestId('codigo-destino-retorno').fill(destino.code);
    await page.getByTestId('destino-retorno').selectOption({ value: destino.id });
    await page.getByTestId('anexo-retorno').setInputFiles({ name: 'comprovante-retorno-ficticio.pdf', mimeType: 'application/pdf', buffer: PDF_FICTICIO });
    await page.getByTestId('enviar-retorno').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('enviar-retorno')).toBeEnabled();
    await page.waitForTimeout(500);
    await page.getByTestId('enviar-retorno').click();
    await expect(page.getByTestId('item-retorno')).toContainText('Recebimento físico');
    await page.getByTestId('retornos').scrollIntoViewIfNeeded();
    await capturar(page, 'computador-15-retorno-fisico', { altura: 1500 });

    // 12. Histórico da janela.
    await page.goto(`/janelas/${janelaId}?aba=historico`);
    await expect(page.getByTestId('secao-historico-janela')).toContainText('Retorno registrado');
    await capturar(page, 'computador-16-historico', { altura: 1400 });
  });

  test('celular: lista mensal, janela, material e preparação (emulação Pixel 7)', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Capturas de celular.');
    test.setTimeout(120_000);
    await entrar(page, 'supervisorDemo');
    await page.goto('/janelas');
    await expect(page.getByTestId('lista-janelas')).toBeVisible();
    await capturar(page, 'celular-01-lista-mensal');
    await page.locator('[data-testid="cartao-janela"]', { hasText: '1ª janela do mês' }).getByTestId('abrir-janela').click();
    await expect(page.getByTestId('tela-janela')).toBeVisible();
    await expect(page.getByTestId('capacidade')).toBeVisible();
    await capturar(page, 'celular-02-capacidade');
    await page.getByTestId('aba-janela-material').click();
    await page.getByTestId('filtro-material').fill(SKU);
    await page.getByTestId('filtro-material').press('Enter');
    await expect(page.getByTestId('item-material').first()).toBeVisible();
    await capturar(page, 'celular-03-material-elegivel');
    await page.getByTestId('aba-janela-reservas').click();
    await page.getByTestId('item-reserva').first().click();
    await expect(page.getByTestId('tela-reserva')).toBeVisible();
    await capturar(page, 'celular-04-reserva-e-preparacao');
  });
});
