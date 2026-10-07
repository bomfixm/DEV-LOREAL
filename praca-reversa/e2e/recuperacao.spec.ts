import { expect, test, type APIRequestContext, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { abrirMenuConta, entrar, obterPraca, type PracaApi } from './apoio';
import { credenciais } from './credenciais';

/**
 * Etapa 09 — conexão, operações com resultado incerto, rascunho não enviado
 * (política de teste: sessionStorage permitido com dados fictícios) e anexos
 * da conferência. Escopo de teste não demonstrativo.
 */

interface Palete {
  id: string;
  code: string;
  version: number;
}

function sufixo(testInfo: TestInfo): string {
  return testInfo.project.name === 'celular' ? '2' : '1';
}

async function csrf(page: Page): Promise<string> {
  return ((await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string }).csrfToken;
}

async function chamar(page: Page, metodo: 'POST' | 'PATCH', caminho: string, corpo: unknown): Promise<APIResponse> {
  return page.request.fetch(caminho, { method: metodo, data: corpo, headers: { 'x-csrf-token': await csrf(page), 'idempotency-key': randomUUID() } });
}

async function criar<T>(page: Page, caminho: string, corpo: unknown): Promise<T> {
  const r = await chamar(page, 'POST', caminho, corpo);
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as T;
}

function livres(praca: PracaApi, fileira: string): { id: string; code: string }[] {
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  const naFileira = praca.layout.positions.filter((p) => p.code.startsWith(`${fileira}-`) && p.available && !ocupadas.has(p.id));
  const todas = naFileira.length >= 3 ? naFileira : praca.layout.positions.filter((p) => p.available && !ocupadas.has(p.id));
  return todas.map((p) => ({ id: p.id, code: p.code }));
}

async function sessaoApi(request: APIRequestContext, quem: 'operador' | 'supervisor'): Promise<string> {
  const { login, senha } = credenciais()[quem];
  const r = await request.post('/api/v1/sessao', { data: { login, senha } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { csrfToken: string }).csrfToken;
}

async function rede(page: Page): Promise<string | null> {
  return page.getByTestId('status-api').getAttribute('data-rede');
}

/** Produto com código de unidade e palete com conferência completa aberta pela tela, modo leitura. */
async function conferenciaAberta(page: Page, testInfo: TestInfo, nome: string) {
  // Sufixo aleatório: o banco de E2E é reaproveitado entre execuções e repetições.
  const s = `${sufixo(testInfo)}${randomBytes(2).toString('hex').toUpperCase()}`;
  const sku = `REC${nome}${s}`;
  const codigo = `00088${nome}${s}01`;
  await criar(page, '/api/v1/produtos', { sku, description: `Sérum fictício ${nome}`, canonicalUnit: 'UN', active: true, barcodes: [{ code: codigo, packaging: 'UN', factor: '1' }] });
  const [posicao] = livres(await obterPraca(page), 'F03');
  if (!posicao) throw new Error('Sem posição livre.');
  const palete = await criar<Palete>(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: posicao.id, notes: null, declaredItems: [] });
  await page.goto(`/paletes/${palete.id}`);
  await page.getByTestId('iniciar-conferencia').click();
  await page.getByRole('radio', { name: /^Completa/ }).check();
  await page.getByTestId('confirmar-inicio').click();
  await expect(page).toHaveURL(/\/conferencias\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split('/').pop() ?? '';
  await page.getByRole('radio', { name: 'Uma unidade por leitura' }).check();
  await page.getByLabel('Condição (obrigatória)').selectOption({ label: 'Saudável' });
  return { id, sku, codigo, palete };
}

async function ler(page: Page, codigo: string): Promise<void> {
  const campo = page.getByTestId('campo-codigo');
  await campo.click();
  await page.keyboard.type(codigo);
  await page.keyboard.press('Enter');
}

async function linhasConferencia(page: Page, id: string): Promise<number> {
  return ((await (await page.request.get(`/api/v1/conferencias/${id}`)).json()) as { lines: { removed: unknown }[] }).lines.length;
}

test.describe('conexão e recuperação', () => {
  test('estados distintos: sem conexão, servidor sem resposta, banco e servidor indisponíveis, sessão expirada', async ({ page, context }, testInfo) => {
    test.skip(sufixo(testInfo) === '2', 'Estados globais verificados no computador.');
    await entrar(page, 'supervisor');
    await expect.poll(() => rede(page)).toBe('conectado');

    await context.setOffline(true);
    await expect.poll(() => rede(page)).toBe('sem-conexao');
    await expect(page.getByTestId('aviso-conexao')).toContainText('Sem conexão com a rede');
    await context.setOffline(false);
    await expect.poll(() => rede(page)).toBe('conectado');
    await expect(page.getByTestId('aviso-conexao')).toHaveCount(0);

    const verificar = () => page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.route('**/api/v1/health/ready', (r) => r.abort('connectionrefused'));
    await verificar();
    await expect.poll(() => rede(page)).toBe('servidor-sem-resposta');
    await expect(page.getByTestId('aviso-conexao')).toContainText('Servidor sem resposta');
    await page.unroute('**/api/v1/health/ready');

    await page.route('**/api/v1/health/ready', (r) => r.fulfill({ status: 503, json: { status: 'indisponivel', database: 'indisponivel' } }));
    await verificar();
    await expect.poll(() => rede(page)).toBe('banco-indisponivel');
    await page.unroute('**/api/v1/health/ready');

    await page.route('**/api/v1/health/ready', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }));
    await verificar();
    await expect.poll(() => rede(page)).toBe('servidor-indisponivel');
    await page.unroute('**/api/v1/health/ready');
    await verificar();
    await expect.poll(() => rede(page)).toBe('conectado');

    // Sessão expirada: estado próprio, volta ao login com aviso (não é "sem conexão").
    await page.route('**/api/v1/praca', (r) => r.fulfill({ status: 401, json: { error: { code: 'SESSAO_EXPIRADA', message: 'Sessão expirada.' } } }));
    await page.reload();
    await expect(page.getByText('Sessão expirada: entre novamente.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await page.unroute('**/api/v1/praca');
  });

  test('resposta perdida depois da gravação: em confirmação, outro pedido bloqueado, verificação sem nova gravação', async ({ page }, testInfo) => {
    test.skip(sufixo(testInfo) === '2', 'Fluxo de computador.');
    test.setTimeout(120_000);
    await entrar(page, 'supervisor');
    const destinos = livres(await obterPraca(page), 'F03');
    const [origem, d1, d2] = destinos;
    if (!origem || !d1 || !d2) throw new Error('Sem posições livres.');
    const palete = await criar<Palete>(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: origem.id, notes: null, declaredItems: [] });
    await page.goto(`/paletes/${palete.id}/mover`);
    await page.getByTestId('motivo-mover').fill('Reorganização fictícia');
    await page.getByTestId('busca-posicao').fill(d1.code);
    await page.getByRole('button', { name: new RegExp(`^${d1.code}`) }).click();
    await page.getByTestId('confirmar-posicao').check();

    // O servidor grava; a resposta se perde. A verificação fica indisponível por enquanto.
    await page.route('**/api/v1/operacoes/**', (r) => r.abort('connectionrefused'));
    await page.route('**/api/v1/paletes/*/movimentos', async (r) => {
      await r.fetch();
      await r.abort('connectionreset');
    }, { times: 1 });
    await page.getByTestId('confirmar-movimento').click();
    await expect(page.getByTestId('aviso-mover')).toHaveAttribute('data-tipo', 'rede');
    await expect(page.getByTestId('painel-incertas')).toContainText('Movimento de palete');
    await expect(page.getByTestId('situacao-operacao').first()).toHaveText('em confirmação');
    await expect(page.getByTestId('selo-em-confirmacao')).toBeVisible();

    // Mudar o pedido (outro destino) exige resolver o anterior: nada é enviado.
    let envios = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/movimentos')) envios += 1;
    });
    await page.getByTestId('busca-posicao').fill(d2.code);
    await page.getByRole('button', { name: new RegExp(`^${d2.code}`) }).click();
    await page.getByTestId('confirmar-posicao').check();
    await page.getByTestId('confirmar-movimento').click();
    await expect(page.getByTestId('aviso-mover')).toHaveAttribute('data-tipo', 'bloqueio');
    await expect(page.getByTestId('aviso-mover')).toContainText('pedido anterior em confirmação');
    expect(envios).toBe(0);

    // Verificação autenticada pela chave: registrada uma vez, nada repetido.
    await page.unroute('**/api/v1/operacoes/**');
    // A verificação automática (a cada 10 s) pode chegar antes do toque: os dois caminhos levam ao mesmo resultado.
    await page
      .getByRole('button', { name: 'Verificar agora' })
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    await expect(page.getByTestId('situacao-operacao').first()).toHaveText('confirmada pelo servidor', { timeout: 20_000 });
    const historico = (await (await page.request.get(`/api/v1/paletes/${palete.id}/historico`)).json()) as { locationEvents: unknown[] };
    expect(historico.locationEvents).toHaveLength(1);
    await page.getByTestId('dispensar-incerta').click();
    await expect(page.getByTestId('painel-incertas')).toHaveCount(0);
  });

  test('rascunho não enviado: isolado e rotulado, divergência ao reconectar exige revisão, saída da conta limpa tudo', async ({ page, context, request }, testInfo) => {
    test.setTimeout(150_000);
    await entrar(page, 'supervisor');
    const { id, sku, codigo } = await conferenciaAberta(page, testInfo, 'R');
    await ler(page, codigo);
    await page.getByTestId('confirmar-item').click();
    await expect(page.getByTestId('retorno-entrada')).toContainText(`1 UN de ${sku}`);

    // Sem conexão: a leitura fica "não enviada" (nada sai do aparelho).
    await context.setOffline(true);
    await ler(page, codigo);
    await expect(page.getByTestId('entrada-nao-confirmada')).toHaveAttribute('data-estado', 'nao-enviada');
    await expect(page.getByTestId('nao-enviadas')).toContainText('Guardadas também nesta aba do navegador');

    // Armazenamento acessível a scripts: só o mínimo, com versão, data e rótulo; nada de token ou senha.
    const token = await page.evaluate(async () => {
      const resposta = await fetch('/api/v1/sessao').catch(() => null);
      return resposta ? ((await resposta.json()) as { csrfToken: string }).csrfToken : null;
    });
    expect(token).toBeNull();
    const armazenado = await page.evaluate(() => ({
      sessao: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k) ?? ''])),
      local: localStorage.length,
      cookies: document.cookie,
    }));
    const chaves = Object.keys(armazenado.sessao);
    expect(chaves).toHaveLength(1);
    expect(chaves[0]).toMatch(new RegExp(`^pr-conferencia-nao-enviadas:v2:[0-9a-f-]+:[0-9a-f-]+:${id}$`));
    const gravado = JSON.parse(Object.values(armazenado.sessao)[0] ?? '{}') as { rotulo: string; versao: number; salvoEm: string; itens: { corpo: { code: string } }[] };
    expect(gravado).toMatchObject({ rotulo: 'não enviado', versao: 2 });
    expect(Date.parse(gravado.salvoEm)).not.toBeNaN();
    expect(gravado.itens[0]?.corpo.code).toBe(codigo);
    expect(JSON.stringify(armazenado)).not.toMatch(/senha|password|csrf|pr_sessao/i);
    expect(armazenado.local).toBe(0);
    expect(armazenado.cookies).toBe('');

    // Outra pessoa registra no mesmo rascunho enquanto esta tela está sem conexão.
    const outroCsrf = await sessaoApi(request, 'operador');
    const produto = (await (await request.get(`/api/v1/produtos/identificar?codigo=${codigo}`)).json()) as { productId: string };
    const outra = await request.post(`/api/v1/conferencias/${id}/observacoes`, {
      data: { mode: 'MANUAL', productId: produto.productId, quantity: '2', unit: 'UN', lot: null, originType: null, originReference: null, condition: 'SAUDAVEL' },
      headers: { 'x-csrf-token': outroCsrf, 'idempotency-key': randomUUID() },
    });
    expect(outra.status(), await outra.text()).toBe(201);

    // Reconectar: divergência mostrada; envio só depois da revisão, sem sobrescrever o outro registro.
    await context.setOffline(false);
    await expect(page.getByTestId('divergencia-rascunho')).toBeVisible();
    const enviar = page.getByTestId('entrada-nao-confirmada').getByRole('button', { name: 'Enviar agora' });
    await expect(enviar).toBeDisabled();
    await page.getByTestId('divergencia-rascunho').getByRole('button', { name: 'Revisei' }).click();
    await enviar.click();
    await expect(page.getByTestId('entrada-nao-confirmada')).toHaveCount(0);
    expect(await linhasConferencia(page, id)).toBe(3);

    // Outra entrada sem conexão; sair da conta avisa e descarta tudo do navegador.
    await context.setOffline(true);
    await ler(page, codigo);
    await expect(page.getByTestId('entrada-nao-confirmada')).toHaveCount(1);
    await context.setOffline(false);
    await expect.poll(() => rede(page)).toBe('conectado');
    let aviso = '';
    page.once('dialog', (d) => {
      aviso = d.message();
      void d.accept();
    });
    await abrirMenuConta(page);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    expect(aviso).toContain('não enviado');
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('pr-')))).toEqual([]);

    // Outro usuário na mesma aba não vê nem envia o anterior.
    const { login, senha } = credenciais().operador;
    await page.getByLabel('Usuário').fill(login);
    await page.getByLabel('Senha', { exact: true }).fill(senha);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByTestId('menu-conta')).toBeVisible();
    await page.goto(`/conferencias/${id}`);
    await expect(page.getByTestId('tela-conferencia')).toBeVisible();
    await expect(page.getByTestId('entrada-nao-confirmada')).toHaveCount(0);
    expect(await linhasConferencia(page, id)).toBe(3);
  });

  test('anexos da conferência: foto privada enviada e baixada; tipo inválido e sem conexão não aparecem como enviados', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    await entrar(page, 'supervisor');
    const { id } = await conferenciaAberta(page, testInfo, 'A');
    const foto = { name: 'palete-frente.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2_000)]) };
    await page.getByTestId('enviar-anexo-conferencia').setInputFiles(foto);
    await expect(page.getByTestId('lista-anexos-conferencia')).toContainText('palete-frente.jpg');
    await expect(page.getByTestId('estado-anexo-conferencia')).toContainText('registrado (privado)');

    const download = page.waitForEvent('download');
    await page.getByTestId('lista-anexos-conferencia').getByRole('button', { name: /palete-frente\.jpg/ }).click();
    expect((await download).suggestedFilename()).toBe('palete-frente.jpg');

    await page.getByTestId('enviar-anexo-conferencia').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('<html>não é imagem</html>') });
    await expect(page.getByTestId('estado-anexo-conferencia')).toContainText('não foi aceito');

    await context.setOffline(true);
    await expect(page.getByTestId('enviar-anexo-conferencia')).toBeDisabled();
    await context.setOffline(false);
    // Recusada/ausente nunca vira anexo: só a foto válida está na conferência.
    const detalhe = (await (await page.request.get(`/api/v1/conferencias/${id}`)).json()) as { attachments: { name: string }[] };
    expect(detalhe.attachments.map((a) => a.name)).toEqual(['palete-frente.jpg']);
  });
});
