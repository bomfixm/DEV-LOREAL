import { expect, test, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { abrirPalete, abrirMenuConta, aguardarMapa, entrar, obterPraca, type PracaApi } from './apoio';
import { credenciais, type Credenciais } from './credenciais';

/**
 * Janelas, reservas e expedição pela interface (etapa 08), no escopo de teste
 * não demonstrativo: liberar material no detalhe do palete → cadastrar e
 * confirmar uma janela autorizada (limite em peças e paletes) → filas
 * elegível/pendente → reservar 8 com revisão de capacidade → prévia que
 * excede o restante → lista de preparação, palete no mapa e volta →
 * preparação → saída parcial (6 enviados, 2 liberados) → capacidade
 * restante 14 → retorno documental sem repor saldo; permissões; sem conexão;
 * celular. Todas as autorizações, datas e documentos são fictícios.
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
  currentItems: { segmentId: string }[] | null;
}

function livres(praca: PracaApi, prefixo: string): { id: string; code: string }[] {
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  return praca.layout.positions.filter((p) => p.code.startsWith(prefixo) && p.available && !ocupadas.has(p.id)).map((p) => ({ id: p.id, code: p.code }));
}

async function paleteComSaldo(page: Page, posicaoId: string | null, produtoId: string, quantidade: string, origem: string): Promise<Palete> {
  const p = await exigir<Palete>(await chamar(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: posicaoId, notes: null, declaredItems: [] }), 201);
  const s = await exigir<{ id: string }>(await chamar(page, 'POST', `/api/v1/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: p.version }), 201);
  await exigir(
    await chamar(page, 'POST', `/api/v1/conferencias/${s.id}/observacoes`, {
      mode: 'MANUAL',
      productId: produtoId,
      quantity: quantidade,
      unit: 'UN',
      lot: 'L-08',
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

async function liberarPelaApi(page: Page, p: Palete, quantidade: string): Promise<Palete> {
  return exigir<Palete>(
    await chamar(page, 'POST', `/api/v1/paletes/${p.id}/liberacao`, {
      action: 'LIBERAR',
      expectedVersion: p.version,
      segmentId: p.currentItems?.[0]?.segmentId,
      quantity: quantidade,
      criterion: 'Critério fictício',
      source: 'Fonte fictícia',
      reference: null,
      reason: 'Liberação de teste E2E',
    }),
    200,
  );
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

/** "AAAA-MM-DDTHH:mm" no horário de Brasília, deslocado em minutos de agora. */
function localSp(minutos: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(Date.now() + minutos * 60_000))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year ?? ''}-${p.month ?? ''}-${p.day ?? ''}T${p.hour ?? ''}:${p.minute ?? ''}`;
}

const sufixo = (testInfo: TestInfo) => (testInfo.project.name === 'celular' ? 'C' : 'D');

async function cadastrarJanelaPelaApi(page: Page, nome: string, limite: string): Promise<{ id: string; version: number }> {
  const inicio = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const j = await exigir<{ id: string; version: number }>(
    await chamar(page, 'POST', '/api/v1/janelas', {
      name: nome,
      clientReference: '000801',
      referenceMonth: inicio.slice(0, 7),
      exitStart: inicio,
      exitEnd: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      restrictions: [{ metric: 'QUANTIDADE', unit: 'UN', limit: limite }],
      criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: [], notes: null },
      authorization: { source: 'E-mail fictício', reference: '000801', date: inicio.slice(0, 10), responsible: 'Contato fictício' },
      notes: 'Dados fictícios de teste.',
    }),
    200,
  );
  return exigir(await chamar(page, 'POST', `/api/v1/janelas/${j.id}/confirmar`, { expectedVersion: j.version }), 200);
}

test.describe('janelas e expedição', () => {
  test('computador: liberar → janela autorizada → elegível/pendente → reservar 8 → preparação no mapa → saída 6 + liberar 2 → restante 14 → retorno', async ({ page, isMobile, context }, testInfo) => {
    test.skip(isMobile, 'Fluxo de computador.');
    test.setTimeout(240_000);
    const s = sufixo(testInfo);
    await entrar(page, 'supervisor');
    const sku = `JAN-E2E-${s}`;
    const produto = await exigir<{ id: string }>(await chamar(page, 'POST', '/api/v1/produtos', { sku, description: `Condicionador fictício ${s}`, canonicalUnit: 'UN', active: true, barcodes: [] }), 201);
    const vagas = livres(await obterPraca(page), 'F04-');
    const a = await paleteComSaldo(page, vagas[0]?.id ?? null, produto.id, '12', `DEV-E2E-J-${s}`);
    const b = await paleteComSaldo(page, vagas[1]?.id ?? null, produto.id, '5', `DEV-E2E-J-${s}`);
    const c = await liberarPelaApi(page, await paleteComSaldo(page, vagas[2]?.id ?? null, produto.id, '15', `DEV-E2E-J-${s}`), '15');

    // 1. Liberação pelo detalhe do palete (conferência não libera).
    await abrirPalete(page, a.id);
    const lib = page.getByTestId('secao-liberacao');
    await expect(lib.getByTestId('item-liberacao')).toContainText('0 de 12 UN liberado(s)');
    await lib.getByTestId('abrir-liberar').click();
    await lib.getByTestId('criterio-liberacao').fill('Material saudável conferido (fictício)');
    await lib.getByTestId('fonte-liberacao').fill('Checklist fictício');
    await lib.getByTestId('motivo-liberacao').fill('Liberação para a janela de teste');
    await lib.getByTestId('enviar-liberacao').click();
    await expect(lib.getByTestId('item-liberacao')).toContainText('12 de 12 UN liberado(s)');

    // 2. Cadastrar a janela (rascunho com pendências) e confirmar.
    await page.goto('/janelas');
    await page.getByTestId('nova-janela').click();
    await page.getByTestId('janela-nome').fill(`Janela fictícia E2E ${s}`);
    await page.getByTestId('janela-saida-inicio').fill(localSp(-360));
    await page.getByTestId('janela-saida-fim').fill(localSp(360));
    await page.getByTestId('janela-mes').fill(localSp(-360).slice(0, 7));
    await page.getByTestId('adicionar-restricao').click();
    await page.getByTestId('restricao-limite').first().fill('20');
    await page.getByTestId('adicionar-restricao').click();
    await page.getByTestId('restricao-metrica').nth(1).selectOption('PALETES');
    await page.getByTestId('restricao-limite').nth(1).fill('2');
    await page.getByTestId('criterios-definidos').check();
    await page.getByTestId('gravar-janela').click();
    await expect(page.getByTestId('situacao-janela')).toHaveText('Rascunho');
    await expect(page.getByTestId('pendencias-janela')).toContainText('Registro da autorização incompleto');
    await page.getByTestId('editar-janela').click();
    await page.getByTestId('autorizacao-fonte').fill('E-mail fictício do cliente');
    await page.getByTestId('autorizacao-referencia').fill('000802');
    await page.getByTestId('autorizacao-data').fill(localSp(-1440).slice(0, 10));
    await page.getByTestId('autorizacao-responsavel').fill('Contato fictício');
    await page.getByTestId('gravar-janela').click();
    await page.getByTestId('confirmar-janela').click();
    await expect(page.getByTestId('situacao-janela')).toHaveText('Confirmada');
    await expect(page.getByTestId('capacidade')).toContainText('Restam 20');

    // 3. Filas: A elegível; B (não liberado) nas pendências com próximo passo.
    await page.getByTestId('aba-janela-material').click();
    await page.getByTestId('filtro-material').fill(sku);
    await page.getByTestId('filtro-material').press('Enter');
    const itemA = page.locator(`[data-testid="item-material"][data-palete="${a.code}"]`);
    await expect(itemA).toContainText('disponível 12');
    await expect(page.locator(`[data-testid="item-material"][data-palete="${b.code}"]`)).toHaveCount(0);
    await page.getByTestId('fila-pendente').click();
    await expect(page.locator(`[data-testid="item-material"][data-palete="${b.code}"]`)).toContainText('Liberar a quantidade por ação autorizada');
    await page.getByTestId('fila-elegivel').click();

    // 4. Prévia que excede o restante (C 15 + A 8 > 20) e reserva de 8.
    await itemA.getByTestId('selecionar-material').check();
    await itemA.getByTestId('quantidade-material').fill('8');
    const itemC = page.locator(`[data-testid="item-material"][data-palete="${c.code}"]`);
    await itemC.getByTestId('selecionar-material').check();
    await page.getByTestId('previa-reserva').click();
    await expect(page.getByTestId('bloqueios-previa')).toContainText('acima do restante 20');
    await expect(page.getByTestId('confirmar-reserva')).toBeDisabled();
    await itemC.getByTestId('selecionar-material').uncheck();
    await page.getByTestId('previa-reserva').click();
    await expect(page.getByTestId('resultado-previa')).toContainText('Tudo cabe');
    await page.getByTestId('confirmar-reserva').click();
    await expect(page.getByTestId('tela-reserva')).toBeVisible();
    await expect(page.getByTestId('situacao-reserva')).toContainText('Ativa');

    // 5. Lista de preparação → palete no mapa → volta à preparação.
    await expect(page.getByTestId('linha-preparacao')).toHaveCount(1);
    await page.getByTestId('abrir-palete-preparacao').click();
    await aguardarMapa(page);
    await expect(page.getByTestId('retorno-reserva')).toBeVisible();
    await expect(page.getByTestId('janela-palete')).toContainText(a.code);
    // Separação parcial (8 de 12): o detalhe mostra solicitado × permanece; reservar não é saída.
    await page.getByTestId('janela-detalhes-completos').locator('summary').click();
    const agenda = page.getByTestId('secao-agenda');
    await expect(agenda.getByTestId('linha-agenda')).toHaveCount(1);
    await expect(agenda.getByTestId('linha-agenda')).toContainText('8 UN');
    await expect(agenda.getByTestId('linha-agenda')).toContainText('4 UN');
    await expect(agenda).toContainText('não é saída');
    await page.keyboard.press('Escape');
    await page.getByTestId('voltar-a-preparacao').click();
    await expect(page.getByTestId('tela-reserva')).toBeVisible();

    // 6. Preparação (não baixa estoque).
    await page.getByTestId('abrir-preparar').click();
    await page.getByTestId('responsavel').selectOption({ label: 'Supervisor E2E' });
    await page.getByTestId('enviar-preparar').click();
    await expect(page.getByTestId('preparacao-registrada')).toContainText('Separada/preparada');

    // 7. Sem conexão: nenhuma saída é confirmada localmente.
    await page.getByTestId('abrir-expedir').click();
    await context.setOffline(true);
    await expect(page.getByTestId('enviar-expedir')).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByTestId('aviso-conexao')).toHaveCount(0);

    // 8. Saída parcial: 6 enviados, 2 liberados (confirmação explícita).
    await page.getByTestId('responsavel').selectOption({ label: 'Supervisor E2E' });
    await page.getByTestId('quantidade-linha').fill('6');
    await expect(page.getByTestId('aviso-parcial')).toContainText('enviado 6, restante 2 UN liberado');
    await expect(page.getByTestId('enviar-expedir')).toBeDisabled();
    await page.getByTestId('ciente-parcial').check();
    await page.getByTestId('enviar-expedir').click();
    await expect(page.getByTestId('tela-expedicao')).toBeVisible();
    await expect(page.getByTestId('situacao-expedicao')).toContainText('conclusão parcial');
    await expect(page.getByTestId('linhas-expedicao')).toContainText('6');
    const saldoA = await exigir<{ currentItems: { quantity: string; reserved: string }[] }>(await page.request.get(`/api/v1/paletes/${a.id}`), 200);
    expect(saldoA.currentItems.map((i) => [i.quantity, i.reserved])).toEqual([['6', '0']]);

    // 9. Retorno documental: registrado, sem repor saldo.
    await page.getByTestId('abrir-retorno').click();
    await page.getByTestId('tipo-retorno').selectOption('AVISO_DOCUMENTAL');
    await page.getByTestId('motivo-retorno').fill('Aviso fictício de recusa parcial');
    await page.getByTestId('enviar-retorno').click();
    await expect(page.getByTestId('item-retorno')).toContainText('não repõe saldo');
    const depois = await exigir<{ currentItems: { quantity: string }[] }>(await page.request.get(`/api/v1/paletes/${a.id}`), 200);
    expect(depois.currentItems.map((i) => i.quantity)).toEqual(['6']);

    // 10. Capacidade restante 14 (20 − 6 expedido) e histórico.
    await page.getByRole('button', { name: /^JAN-/ }).first().click();
    await expect(page.getByTestId('capacidade')).toContainText('Restam 14');
    await page.getByTestId('aba-janela-historico').click();
    await expect(page.getByTestId('secao-historico-janela')).toContainText('Expedição confirmada');
    await expect(page.getByTestId('secao-historico-janela')).toContainText('Retorno registrado');

    // 11. Operador vê, prepara, mas não reserva nem expede.
    await trocarUsuario(page, 'operador');
    await page.goto('/janelas');
    await expect(page.getByTestId('nova-janela')).toHaveCount(0);
    const negado = await chamar(page, 'POST', '/api/v1/janelas', {});
    expect(negado.status()).toBe(403);
  });

  test('celular: lista mensal, janela, fila elegível e reserva (emulação)', async ({ page, isMobile }, testInfo) => {
    test.skip(!isMobile, 'Fluxo de celular.');
    test.setTimeout(180_000);
    const s = sufixo(testInfo);
    await entrar(page, 'supervisor');
    const sku = `JAN-E2E-${s}`;
    const produto = await exigir<{ id: string }>(await chamar(page, 'POST', '/api/v1/produtos', { sku, description: `Máscara fictícia ${s}`, canonicalUnit: 'UN', active: true, barcodes: [] }), 201);
    const vaga = livres(await obterPraca(page), 'F02-')[0];
    const p = await liberarPelaApi(page, await paleteComSaldo(page, vaga?.id ?? null, produto.id, '4', `DEV-E2E-M-${s}`), '4');
    const j = await cadastrarJanelaPelaApi(page, `Janela celular E2E ${s}`, '10');
    await page.goto('/janelas');
    await expect(page.getByTestId('lista-janelas')).toContainText(`Janela celular E2E ${s}`);
    await page.goto(`/janelas/${j.id}?aba=material`);
    await page.getByTestId('filtro-material').fill(sku);
    await page.getByTestId('filtro-material').press('Enter');
    const item = page.locator(`[data-testid="item-material"][data-palete="${p.code}"]`);
    await item.getByTestId('selecionar-material').check();
    await page.getByTestId('previa-reserva').click();
    await page.getByTestId('confirmar-reserva').click();
    await expect(page.getByTestId('tela-reserva')).toBeVisible();
    await expect(page.getByTestId('linha-preparacao')).toHaveCount(1);
    // Sem rolagem horizontal da página no celular (a tabela rola no próprio contêiner).
    const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(larguras[0]).toBeLessThanOrEqual((larguras[1] ?? 0) + 1);
  });
});
