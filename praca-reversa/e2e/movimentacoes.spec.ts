import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { abrirMenuConta, aguardarMapa, aguardarMapaParado, centroDaCaixa, entrar, forma, obterPraca, type PracaApi } from './apoio';
import { credenciais, type Credenciais } from './credenciais';

/**
 * Movimentações pela interface (etapa 05), no escopo de teste não
 * demonstrativo: mover palete, transferir produtos, histórico e correções,
 * com conflito, destino indisponível, saldo insuficiente (reserva real da
 * etapa 08, feita pelo supervisor numa sessão própria), resposta perdida com
 * reenvio e sem conexão. Celular: perfil Pixel 7 emulado pelo Playwright.
 */

interface Palete {
  id: string;
  code: string;
  version: number;
  positionId: string | null;
  positionCode: string | null;
  currentItems: { segmentId: string; quantity: string; reserved: string }[] | null;
}

interface Historico {
  locationEvents: { id: string; type: string }[];
  stockEvents: { id: string; type: string; remainingCompensable: string | null }[];
}

function sufixo(testInfo: TestInfo): string {
  return testInfo.project.name === 'celular' ? '2' : '1';
}

async function chamar(page: Page, metodo: 'POST' | 'PATCH', caminho: string, corpo: unknown): Promise<APIResponse> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return page.request.fetch(caminho, { method: metodo, data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
}

async function exigir<T>(r: APIResponse, status: number): Promise<T> {
  expect(r.status(), await r.text()).toBe(status);
  return (await r.json()) as T;
}

async function palete(page: Page, id: string): Promise<Palete> {
  return exigir<Palete>(await page.request.get(`/api/v1/paletes/${id}`), 200);
}

async function historico(page: Page, id: string): Promise<Historico> {
  return exigir<Historico>(await page.request.get(`/api/v1/paletes/${id}/historico`), 200);
}

/** Posições livres da fileira F04 (as outras fileiras ficam para os demais testes de cadastro e conferência). */
function livres(praca: PracaApi): { id: string; code: string }[] {
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  return praca.layout.positions.filter((p) => p.code.startsWith('F04-') && p.available && !ocupadas.has(p.id)).map((p) => ({ id: p.id, code: p.code }));
}

/** Saldo validado pelo fluxo real: conferência completa, conclusão e reconciliação (supervisor). */
async function reconciliar(page: Page, paleteId: string, produtoId: string, quantidade: string): Promise<void> {
  const p = await palete(page, paleteId);
  const s = await exigir<{ id: string }>(await chamar(page, 'POST', `/api/v1/paletes/${paleteId}/conferencias`, { scope: 'COMPLETA', expectedVersion: p.version }), 201);
  await exigir(
    await chamar(page, 'POST', `/api/v1/conferencias/${s.id}/observacoes`, {
      mode: 'MANUAL',
      productId: produtoId,
      quantity: quantidade,
      unit: 'UN',
      lot: '0042',
      originType: 'DEVOLUCAO',
      originReference: 'DEV-E2E-07',
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

/** Produto e dois paletes reconciliados (10 e 3 do mesmo segmento), em posições livres da fileira F04. */
async function prepararCenario(page: Page, testInfo: TestInfo, nome: string) {
  const s = sufixo(testInfo);
  const produto = await exigir<{ id: string; sku: string }>(
    await chamar(page, 'POST', '/api/v1/produtos', { sku: `MV${nome}${s}`, description: `Condicionador fictício ${nome}`, canonicalUnit: 'UN', active: true, barcodes: [] }),
    201,
  );
  const [p1, p2] = livres(await obterPraca(page));
  if (!p1 || !p2) throw new Error('Sem posições livres em F04.');
  const novo = async (posicao: string) =>
    exigir<Palete>(await chamar(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: posicao, notes: null, declaredItems: [] }), 201);
  const origem = await novo(p1.id);
  const destino = await novo(p2.id);
  await reconciliar(page, origem.id, produto.id, '10');
  await reconciliar(page, destino.id, produto.id, '3');
  return { produto, origem: await palete(page, origem.id), destino: await palete(page, destino.id) };
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

interface Preparo {
  janela: { id: string; version: number };
  segmentoId: string;
}

/**
 * Etapa 08 (supervisor, antes da revisão): libera o saldo validado do palete e
 * confirma uma janela fictícia. A liberação muda a versão do palete; a reserva
 * feita depois, não.
 */
async function prepararReserva(page: Page, paleteId: string): Promise<Preparo> {
  const p = (await (await page.request.get(`/api/v1/paletes/${paleteId}`)).json()) as Palete & { currentItems: { segmentId: string; quantity: string }[] };
  const item = p.currentItems[0];
  if (!item) throw new Error('Palete sem saldo validado.');
  const liberado = await chamar(page, 'POST', `/api/v1/paletes/${paleteId}/liberacao`, {
    action: 'LIBERAR',
    expectedVersion: p.version,
    segmentId: item.segmentId,
    quantity: item.quantity,
    criterion: 'Critério fictício',
    source: 'Fonte fictícia',
    reference: null,
    reason: 'Liberação de teste E2E',
  });
  expect(liberado.status(), await liberado.text()).toBe(200);
  const inicio = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const criada = await chamar(page, 'POST', '/api/v1/janelas', {
    name: 'Janela fictícia E2E (movimentações)',
    clientReference: null,
    referenceMonth: inicio.slice(0, 7),
    exitStart: inicio,
    exitEnd: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    restrictions: [{ metric: 'QUANTIDADE', unit: 'UN', limit: '1000' }],
    criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: [], notes: null },
    authorization: { source: 'E-mail fictício', reference: '000901', date: inicio.slice(0, 10), responsible: 'Contato fictício' },
    notes: 'Dados fictícios de teste.',
  });
  expect(criada.status(), await criada.text()).toBe(200);
  const j = (await criada.json()) as { id: string; version: number };
  const confirmada = await chamar(page, 'POST', `/api/v1/janelas/${j.id}/confirmar`, { expectedVersion: j.version });
  expect(confirmada.status(), await confirmada.text()).toBe(200);
  return { janela: (await confirmada.json()) as { id: string; version: number }, segmentoId: item.segmentId };
}

/** Sessão própria do supervisor (a página continua com o operador). */
async function sessaoSupervisor(request: APIRequestContext): Promise<string> {
  const { login, senha } = credenciais().supervisor;
  const r = await request.post('/api/v1/sessao', { data: { login, senha } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { csrfToken: string }).csrfToken;
}

/** Reserva real (etapa 08): não muda a versão do palete. Devolve o ID e a versão da reserva. */
async function reservar(request: APIRequestContext, csrf: string, preparo: Preparo, paleteId: string, quantidade: string): Promise<{ id: string; version: number }> {
  const p = (await (await request.get(`/api/v1/paletes/${paleteId}`)).json()) as Palete;
  const r = await request.post(`/api/v1/janelas/${preparo.janela.id}/reservas`, {
    data: {
      expectedWindowVersion: preparo.janela.version,
      lines: [{ palletId: paleteId, segmentId: preparo.segmentoId, quantity: quantidade, expectedPalletVersion: p.version }],
      loadUnits: [],
      notes: null,
    },
    headers: { 'x-csrf-token': csrf, 'idempotency-key': randomUUID() },
  });
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as { id: string; version: number };
}

async function cancelarReserva(request: APIRequestContext, csrf: string, reserva: { id: string; version: number }): Promise<void> {
  const r = await request.post(`/api/v1/reservas/${reserva.id}/cancelar`, {
    data: { expectedVersion: reserva.version, reason: 'Fim do cenário de teste' },
    headers: { 'x-csrf-token': csrf, 'idempotency-key': randomUUID() },
  });
  expect(r.status(), await r.text()).toBe(200);
}

async function escolherPosicao(page: Page, codigo: string): Promise<void> {
  await page.getByTestId('busca-posicao').fill(codigo);
  await page.getByRole('button', { name: new RegExp(`^${codigo}`) }).click();
  await expect(page.getByTestId('previa-destino')).toContainText(codigo);
}

test.describe('movimentações com histórico', () => {
  test('computador: mover → transferir → histórico → corrigir, com conflito, destino ocupado, saldo insuficiente, resposta perdida e sem conexão', async ({
    page,
    context,
    request,
    isMobile,
  }, testInfo) => {
    test.skip(isMobile, 'Fluxo de computador.');
    test.setTimeout(150_000);
    await entrar(page, 'supervisor');
    const { origem, destino } = await prepararCenario(page, testInfo, 'M1');
    const preparo = await prepararReserva(page, origem.id);
    await trocarUsuario(page, 'operador');

    // ---- Mover palete (aberto pelo link do QR) ----
    await page.goto(`/paletes/${origem.id}`);
    await page.getByTestId('acao-mover').click();
    await expect(page).toHaveURL(new RegExp(`/paletes/${origem.id}/mover$`));
    await expect(page.getByTestId('endereco-atual')).toHaveText(origem.positionCode ?? '');
    const [d1, d2] = livres(await obterPraca(page));
    if (!d1 || !d2) throw new Error('Sem posições livres em F04.');
    await page.getByTestId('motivo-mover').fill('Reorganização da praça');

    // Destino ocupado por outra pessoa entre a escolha e a confirmação.
    await escolherPosicao(page, d1.code);
    await page.getByTestId('confirmar-posicao').check();
    await exigir(await chamar(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: d1.id, notes: null, declaredItems: [] }), 201);
    await page.getByTestId('confirmar-movimento').click();
    await expect(page.getByTestId('aviso-mover')).toHaveAttribute('data-tipo', 'destino');
    await expect(page.getByTestId('aviso-mover')).toContainText('Destino indisponível');
    await expect(page.getByTestId('previa-movimento')).toHaveCount(0);

    // Versão desatualizada: outra pessoa alterou o cadastro do palete.
    await escolherPosicao(page, d2.code);
    await page.getByTestId('confirmar-posicao').check();
    const atual = await palete(page, origem.id);
    await exigir(await chamar(page, 'PATCH', `/api/v1/paletes/${origem.id}`, { expectedVersion: atual.version, notes: 'Alterado em outra tela' }), 200);
    await page.getByTestId('confirmar-movimento').click();
    await expect(page.getByTestId('aviso-mover')).toHaveAttribute('data-tipo', 'conflito');
    await expect(page.getByTestId('confirmar-posicao')).not.toBeChecked();

    // Sem conexão: nada é enviado nem guardado para depois.
    await page.getByTestId('confirmar-posicao').check();
    await context.setOffline(true);
    await expect(page.getByTestId('movimento-sem-conexao')).toBeVisible();
    await expect(page.getByTestId('confirmar-movimento')).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByTestId('confirmar-movimento')).toBeEnabled();
    expect((await historico(page, origem.id)).locationEvents).toHaveLength(0);

    await page.getByTestId('confirmar-movimento').click();
    await expect(page.getByTestId('movimento-confirmado')).toContainText(`agora em ${d2.code}`);
    await page.getByRole('button', { name: 'Ver o palete no mapa' }).click();
    await expect(page.getByTestId('detalhe').locator('.detalhe-local')).toContainText(d2.code);
    const praca = await obterPraca(page);
    expect(praca.pallets.find((p) => p.id === origem.id)?.positionCode).toBe(d2.code);
    expect(praca.pallets.find((p) => p.positionCode === origem.positionCode)).toBeUndefined();

    // ---- Transferir produtos ----
    await page.getByTestId('acao-transferir').click();
    await expect(page).toHaveURL(new RegExp(`/paletes/${origem.id}/transferir$`));
    await page.getByRole('radio').first().check();
    await page.getByTestId('quantidade-transferir').fill('11');
    await expect(page.getByTestId('erro-quantidade')).toContainText('Maior que o disponível: 10 UN');
    await page.getByTestId('quantidade-transferir').fill('8');
    await page.getByTestId('busca-destino').fill(destino.code);
    await page.getByRole('button', { name: new RegExp(`^${destino.code}`) }).click();
    const previa = page.getByTestId('previa-transferencia');
    await expect(previa).toContainText(`${origem.code} (origem)`);
    await expect(previa.locator('tbody tr').first()).toContainText('10 UN');
    await expect(previa.locator('tbody tr').first()).toContainText('2 UN');
    await expect(previa.locator('tbody tr').nth(1)).toContainText('3 UN');
    await expect(previa.locator('tbody tr').nth(1)).toContainText('11 UN');
    await page.getByTestId('motivo-transferir').fill('Consolidação de paletes');
    await page.getByTestId('confirmar-transferencia-check').check();

    // Resposta perdida: o servidor registra, mas a resposta não chega. O reenvio usa a mesma chave.
    let chaves: string[] = [];
    await page.route('**/api/v1/transferencias', async (rota) => {
      chaves.push(rota.request().headers()['idempotency-key'] ?? '');
      await rota.fetch();
      await rota.abort('failed');
    }, { times: 1 });
    await page.getByTestId('confirmar-transferencia').click();
    await expect(page.getByTestId('aviso-transferir')).toHaveAttribute('data-tipo', 'rede');
    await page.route('**/api/v1/transferencias', async (rota) => {
      chaves.push(rota.request().headers()['idempotency-key'] ?? '');
      await rota.continue();
    });
    await page.getByTestId('reenviar-movimento').click();
    await expect(page.getByTestId('transferencia-confirmada')).toContainText('Transferência registrada');
    await page.unroute('**/api/v1/transferencias');
    expect(chaves).toHaveLength(2);
    expect(chaves[0]).toBe(chaves[1]);
    const hOrigem = await historico(page, origem.id);
    expect(hOrigem.stockEvents.filter((e) => e.type === 'TRANSFERENCIA')).toHaveLength(1);
    expect((await palete(page, origem.id)).currentItems?.map((i) => i.quantity)).toEqual(['2']);
    expect((await palete(page, destino.id)).currentItems?.map((i) => i.quantity)).toEqual(['11']);

    // Saldo insuficiente: uma reserva entra depois da revisão (sem mudar a versão do palete).
    chaves = [];
    await page.goto(`/paletes/${origem.id}/transferir`);
    await page.getByRole('radio').first().check();
    await page.getByTestId('quantidade-transferir').fill('2');
    await page.getByTestId('busca-destino').fill(destino.code);
    await page.getByRole('button', { name: new RegExp(`^${destino.code}`) }).click();
    await page.getByTestId('motivo-transferir').fill('Consolidação de paletes');
    await page.getByTestId('confirmar-transferencia-check').check();
    const csrf = await sessaoSupervisor(request);
    const reserva = await reservar(request, csrf, preparo, origem.id, '1');
    await page.getByTestId('confirmar-transferencia').click();
    await expect(page.getByTestId('aviso-transferir')).toHaveAttribute('data-tipo', 'saldo');
    await expect(page.getByTestId('aviso-transferir')).toContainText('disponível 1 UN');
    await expect(page.locator('.opcao-item').first()).toContainText('Reservado 1 UN');
    await cancelarReserva(request, csrf, reserva);

    // ---- Histórico (operador: sem correção) ----
    await page.goto(`/paletes/${origem.id}/historico`);
    await expect(page.getByTestId('evento-localizacao')).toHaveCount(1);
    await expect(page.getByTestId('evento-localizacao').first()).toContainText(`${origem.positionCode ?? ''} → ${d2.code}`);
    await expect(page.getByTestId('evento-estoque').first()).toHaveAttribute('data-tipo', 'TRANSFERENCIA');
    await expect(page.getByTestId('corrigir-transferencia')).toHaveCount(0);
    await expect(page.getByTestId('corrigir-localizacao')).toHaveCount(0);

    // ---- Correções pelo supervisor (permissão própria) ----
    await trocarUsuario(page, 'supervisor');
    await page.goto(`/paletes/${origem.id}/historico`);
    await page.getByTestId('corrigir-transferencia').click();
    await page.getByTestId('quantidade-correcao').fill('3');
    await expect(page.getByTestId('previa-correcao')).toContainText('11 → 8');
    await page.getByTestId('motivo-correcao-transf').fill('Transferido a mais');
    await page.getByTestId('confirmar-correcao-transf').check();
    await page.getByTestId('enviar-correcao-transf').click();
    await expect(page.getByTestId('mensagem-historico')).toContainText('Correção registrada');
    await expect(page.getByTestId('evento-estoque').first()).toHaveAttribute('data-tipo', 'CORRECAO_TRANSFERENCIA');
    await expect(page.getByTestId('restante-compensavel')).toContainText('5 UN');
    expect((await palete(page, origem.id)).currentItems?.map((i) => i.quantity)).toEqual(['5']);

    // Correção de localização: volta à posição anterior, conferida contra a ocupação atual.
    await page.getByTestId('corrigir-localizacao').click();
    await page.getByRole('button', { name: `Usar a posição anterior (${origem.positionCode ?? ''}), que está livre` }).click();
    await page.getByTestId('motivo-correcao-local').fill('Palete foi para a posição errada');
    await page.getByTestId('confirmar-correcao-local').check();
    await page.getByTestId('enviar-correcao-local').click();
    await expect(page.getByTestId('mensagem-historico')).toContainText(`agora em ${origem.positionCode ?? ''}`);
    await expect(page.getByTestId('historico-posicao-atual')).toHaveText(origem.positionCode ?? '');
    await expect(page.getByTestId('evento-localizacao')).toHaveCount(2);
  });

  test('permissões: consulta vê o histórico, não move, não transfere e não corrige', async ({ page, isMobile }, testInfo) => {
    test.skip(isMobile, 'Verificação de computador.');
    await entrar(page, 'supervisor');
    const { origem } = await prepararCenario(page, testInfo, 'P1');
    await trocarUsuario(page, 'consultaCadastro');
    await page.goto(`/paletes/${origem.id}`);
    await expect(page.getByTestId('secao-movimentacoes')).toBeVisible();
    await expect(page.getByTestId('acao-mover')).toHaveCount(0);
    await expect(page.getByTestId('acao-transferir')).toHaveCount(0);
    await page.getByTestId('acao-historico').click();
    await expect(page.getByTestId('tela-historico')).toBeVisible();
    await expect(page.getByTestId('corrigir-transferencia')).toHaveCount(0);
    for (const acao of ['mover', 'transferir']) {
      await page.goto(`/paletes/${origem.id}/${acao}`);
      await expect(page.getByTestId('sem-permissao')).toBeVisible();
    }
    // Chamada direta à API também é negada.
    const r = await chamar(page, 'POST', '/api/v1/transferencias', {
      sourcePalletId: origem.id,
      destinationPalletId: randomUUID(),
      segmentId: randomUUID(),
      quantity: '1',
      expectedSourceVersion: 1,
      expectedDestinationVersion: 1,
      reason: 'Tentativa sem permissão',
    });
    expect(r.status()).toBe(403);
  });

  test('T33/T34: arrastar, ampliar e centralizar o mapa não muda endereço, quantidade nem histórico', async ({ page, isMobile }, testInfo) => {
    test.skip(isMobile, 'Gestos de mouse; a pinça no celular é coberta em celular.spec.ts.');
    await entrar(page, 'supervisor');
    const { origem } = await prepararCenario(page, testInfo, 'T3');
    const antes = { praca: await obterPraca(page), palete: await palete(page, origem.id), historico: await historico(page, origem.id) };
    await page.goto(`/paletes/${origem.id}`);
    await aguardarMapa(page);
    await page.getByRole('button', { name: 'Centralizar no mapa' }).click();
    await aguardarMapaParado(page);
    const { x, y } = await centroDaCaixa(forma(page, origem.code));
    // Arraste começando sobre o palete, zoom com a roda e visão geral.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 180, y + 90, { steps: 12 });
    await page.mouse.up();
    await page.mouse.wheel(0, -400);
    await aguardarMapaParado(page);
    await page.getByRole('button', { name: 'Visão geral' }).click();
    await aguardarMapaParado(page);
    const depois = { praca: await obterPraca(page), palete: await palete(page, origem.id), historico: await historico(page, origem.id) };
    expect(depois.praca.pallets.map((p) => [p.id, p.positionId])).toEqual(antes.praca.pallets.map((p) => [p.id, p.positionId]));
    expect([depois.palete.version, depois.palete.currentItems]).toEqual([antes.palete.version, antes.palete.currentItems]);
    expect([depois.historico.locationEvents.length, depois.historico.stockEvents.length]).toEqual([
      antes.historico.locationEvents.length,
      antes.historico.stockEvents.length,
    ]);
  });

  test('celular: mover e transferir por toque, com a tela reorganizada', async ({ page, isMobile }, testInfo) => {
    test.skip(!isMobile, 'Fluxo de celular (emulação Pixel 7).');
    test.setTimeout(120_000);
    await entrar(page, 'supervisor');
    const { origem, destino } = await prepararCenario(page, testInfo, 'C5');
    await trocarUsuario(page, 'operador');
    await page.goto(`/paletes/${origem.id}`);
    await page.getByTestId('acao-mover').tap();
    const [livre] = livres(await obterPraca(page));
    if (!livre) throw new Error('Sem posição livre em F04.');
    await page.getByTestId('busca-posicao').fill(livre.code);
    await page.getByRole('button', { name: new RegExp(`^${livre.code}`) }).tap();
    await page.getByTestId('motivo-mover').fill('Liberar posição');
    await page.getByTestId('confirmar-posicao').check();
    // Botões no celular ocupam a largura (toque).
    const botao = page.getByTestId('confirmar-movimento');
    const largura = (await botao.boundingBox())?.width ?? 0;
    expect(largura).toBeGreaterThan((page.viewportSize()?.width ?? 0) * 0.6);
    await botao.tap();
    await expect(page.getByTestId('movimento-confirmado')).toContainText(`agora em ${livre.code}`);

    await page.goto(`/paletes/${origem.id}/transferir`);
    await page.getByRole('radio').first().check();
    await page.getByTestId('quantidade-transferir').fill('4');
    await page.getByTestId('busca-destino').fill(destino.code);
    await page.getByRole('button', { name: new RegExp(`^${destino.code}`) }).tap();
    await expect(page.getByTestId('previa-transferencia')).toContainText('7 UN');
    await page.getByTestId('motivo-transferir').fill('Consolidação de paletes');
    await page.getByTestId('confirmar-transferencia-check').check();
    await page.getByTestId('confirmar-transferencia').tap();
    await expect(page.getByTestId('transferencia-confirmada')).toBeVisible();
    // Sem rolagem horizontal na tela do celular.
    const rolagem = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(rolagem).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Ver histórico' }).tap();
    await expect(page.getByTestId('evento-localizacao')).toHaveCount(1);
    await expect(page.getByTestId('evento-estoque').first()).toHaveAttribute('data-tipo', 'TRANSFERENCIA');
  });
});
