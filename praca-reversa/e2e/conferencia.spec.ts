import { expect, test, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { abrirPalete, entrar, obterPraca, type PracaApi, verMais } from './apoio';
import { credenciais } from './credenciais';

/**
 * Conferência e reconciliação pela interface, no escopo de teste não
 * demonstrativo (dados fictícios criados pela API a cada execução).
 */

interface Produto {
  id: string;
}

interface Palete {
  id: string;
  code: string;
}

/** Sufixo por perfil de execução: computador e celular compartilham o banco de E2E. */
function sufixo(testInfo: TestInfo): string {
  return testInfo.project.name === 'celular' ? '2' : '1';
}

async function chamar(page: Page, metodo: 'POST' | 'PUT' | 'PATCH', caminho: string, corpo: unknown): Promise<APIResponse> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return page.request.fetch(caminho, {
    method: metodo,
    data: corpo,
    headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() },
  });
}

async function criar<T>(page: Page, caminho: string, corpo: unknown): Promise<T> {
  const r = await chamar(page, 'POST', caminho, corpo);
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as T;
}

function posicaoLivre(praca: PracaApi, fileira: string): string {
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  const livre = praca.layout.positions.find((p) => p.code.startsWith(`${fileira}-`) && p.available && !ocupadas.has(p.id));
  if (!livre) throw new Error(`Sem posição livre em ${fileira}.`);
  return livre.id;
}

/** Produto com código da unidade e caixa de fator 12; palete com 12 UN declaradas na NF 000555. */
async function prepararCenario(page: Page, testInfo: TestInfo, nome: string): Promise<{ palete: Palete; codigoUnidade: string; codigoCaixa: string }> {
  const s = sufixo(testInfo);
  const sku = `00${nome}${s}`;
  const codigoUnidade = `00078900${nome}${s}`;
  const codigoCaixa = `00178900${nome}${s}`;
  await criar<Produto>(page, '/api/v1/produtos', {
    sku,
    description: `Shampoo fictício ${nome}`,
    canonicalUnit: 'UN',
    active: true,
    barcodes: [
      { code: codigoUnidade, packaging: 'UN', factor: '1' },
      { code: codigoCaixa, packaging: 'CX', factor: '12' },
    ],
  });
  const palete = await criar<Palete>(page, '/api/v1/paletes', {
    code: { mode: 'GERAR' },
    positionId: posicaoLivre(await obterPraca(page), 'F05'),
    notes: null,
    declaredItems: [{ sku, description: null, lot: null, originType: 'NOTA_FISCAL', originReference: '000555', quantity: '12', unit: 'UN' }],
  });
  return { palete, codigoUnidade, codigoCaixa };
}

async function iniciarPelaTela(page: Page, escopo: 'Parcial' | 'Completa', descricao?: string): Promise<string> {
  await page.getByTestId('iniciar-conferencia').click();
  await page.getByRole('radio', { name: new RegExp(`^${escopo}`) }).check();
  if (descricao !== undefined) await page.getByLabel('Parte física que será conferida (obrigatória)').fill(descricao);
  await page.getByTestId('confirmar-inicio').click();
  await expect(page).toHaveURL(/\/conferencias\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('situacao-conferencia')).toContainText('Em andamento');
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

async function prepararEntrada(page: Page, modo: 'Uma unidade por leitura' | 'Uma embalagem por leitura' | 'Quantidade manual', origem: string | null): Promise<void> {
  await page.getByRole('radio', { name: modo }).check();
  await page.getByLabel('Condição (obrigatória)').selectOption({ label: 'Saudável' });
  if (origem !== null) await page.getByLabel('Origem (vazio = pendente)').selectOption({ label: origem });
}

/**
 * Leitura pelo leitor que digita como teclado: código + Enter no campo do
 * código. Na primeira leitura o usuário toca o campo; nas seguintes o foco
 * já precisa estar lá (devolvido pela tela depois de cada registro).
 */
async function ler(page: Page, codigo: string, focar = false): Promise<void> {
  const campo = page.getByTestId('campo-codigo');
  if (focar) await campo.click();
  await expect(campo).toBeFocused();
  await page.keyboard.type(codigo);
  await page.keyboard.press('Enter');
}

async function concluir(page: Page, completa: boolean): Promise<void> {
  await page.getByRole('button', { name: 'Concluir conferência…' }).click();
  if (completa) {
    await expect(page.getByTestId('confirmar-conclusao')).toBeDisabled();
    await page.getByTestId('confirmar-escopo').check();
  }
  await page.getByTestId('confirmar-conclusao').click();
  await expect(page.getByTestId('situacao-conferencia')).toContainText('Concluída');
}

test.describe('conferência e reconciliação', () => {
  test('computador: QR → parcial → rascunho retomado → completa com divergência → recontagem → reconciliação', async ({ page, browser, isMobile, baseURL }, testInfo) => {
    test.skip(isMobile, 'Fluxo de computador.');
    await entrar(page, 'supervisor');
    const { palete, codigoUnidade, codigoCaixa } = await prepararCenario(page, testInfo, 'C1');
    await page.getByTestId('menu-conta').locator('summary').click();
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

    // Operador abre o palete pelo link do QR.
    await entrar(page, 'operador');
    await abrirPalete(page, palete.id);
    await expect(page.getByTestId('janela-titulo')).toHaveText(`Palete ${palete.code}`);
    await expect(page.getByTestId('conteudo-desconhecido')).toBeVisible();

    // Parcial: duas leituras do mesmo código somam duas peças.
    const parcial = await iniciarPelaTela(page, 'Parcial', 'Camada superior');
    await prepararEntrada(page, 'Uma unidade por leitura', 'Nota fiscal 000555 (declarada)');
    await ler(page, codigoUnidade, true);
    await expect(page.getByTestId('confirmacao-item')).toContainText(`00C1${sufixo(testInfo)}`);
    await page.getByTestId('confirmar-item').click();
    await expect(page.getByTestId('item-atual')).toBeVisible();
    await ler(page, codigoUnidade);
    await expect(page.getByTestId('totais-conferencia')).toContainText('2 UN');
    // Mapa e lista indicam a conferência em andamento.
    expect((await obterPraca(page)).pallets.find((p) => p.id === palete.id)).toMatchObject({ activeCountId: parcial });

    // Rascunho no servidor: recarregar a página (ou outro aparelho) retoma as linhas.
    await page.reload();
    await expect(page.getByTestId('estado-rascunho')).toContainText('Rascunho salvo no servidor em');
    await expect(page.getByTestId('linha-observacao')).toHaveCount(2);
    await concluir(page, false);
    await expect(page.getByTestId('comparacao')).toContainText('Parcial: não comparado');
    await page.getByRole('button', { name: `Palete ${palete.code}` }).first().click();
    await verMais(page);
    await expect(page.getByTestId('conteudo-parcial')).toContainText('não é saldo validado');
    await expect(page.getByTestId('itens-observados')).toContainText('2 UN');

    // Completa com divergência: declarado 12, observado 9.
    await iniciarPelaTela(page, 'Completa');
    await prepararEntrada(page, 'Uma unidade por leitura', 'Nota fiscal 000555 (declarada)');
    await ler(page, codigoUnidade, true);
    await page.getByTestId('confirmar-item').click();
    for (let i = 0; i < 8; i++) await ler(page, codigoUnidade);
    await expect(page.getByTestId('totais-conferencia')).toContainText('9 UN');
    await expect(page.getByTestId('linha-observacao')).toHaveCount(9);
    await concluir(page, true);
    const falta = page.getByTestId('vinculo-comparacao').filter({ hasText: '000555' });
    await expect(falta).toHaveAttribute('data-status', 'FALTA');
    await expect(falta).toContainText('12 UN');
    await expect(falta).toContainText('9 UN');
    await expect(falta).toContainText('−3 UN');
    // Operador não reconcilia.
    await expect(page.getByTestId('abrir-reconciliacao')).toHaveCount(0);

    // Recontagem vinculada: 1 caixa (fator 12).
    await page.getByRole('button', { name: 'Solicitar recontagem…' }).click();
    await page.getByLabel('Justificativa (obrigatória)').fill('Diferença de 3 unidades na contagem completa');
    await page.getByRole('button', { name: 'Iniciar recontagem' }).click();
    await expect(page.getByTestId('situacao-conferencia')).toContainText('Em andamento');
    await expect(page.getByTestId('tela-conferencia')).toContainText('Recontagem');
    const recontagem = new URL(page.url()).pathname.split('/').pop() ?? '';
    await prepararEntrada(page, 'Uma embalagem por leitura', 'Nota fiscal 000555 (declarada)');
    await ler(page, codigoCaixa, true);
    await expect(page.getByTestId('confirmar-item')).toContainText('1 CX (= 12 UN)');
    await page.getByTestId('confirmar-item').click();
    await expect(page.getByTestId('totais-conferencia')).toContainText('12 UN');
    await concluir(page, true);
    await expect(page.getByTestId('vinculo-comparacao').filter({ hasText: '000555' })).toHaveAttribute('data-status', 'CONFERE');

    // Supervisor reconcilia: prévia dos efeitos, justificativa e saldo validado.
    const contexto = await browser.newContext({ baseURL: baseURL ?? '', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    const sup = await contexto.newPage();
    await entrar(sup, 'supervisor');
    await sup.goto(`/conferencias/${recontagem}`);
    await sup.getByTestId('abrir-reconciliacao').click();
    await expect(sup.getByTestId('previa-reconciliacao')).toContainText('+12 UN');
    await expect(sup.getByTestId('confirmar-reconciliacao')).toBeDisabled();
    await sup.getByLabel('Justificativa (obrigatória)').fill('Recontagem confere com a nota fiscal');
    await sup.getByTestId('confirmar-reconciliacao').click();
    await expect(sup.getByTestId('mensagem-conferencia')).toContainText('Saldo inicial gravado');
    await expect(sup.getByTestId('reconciliada')).toBeVisible();
    await sup.getByRole('button', { name: 'Voltar ao palete' }).click();
    await verMais(sup);
    await expect(sup.getByTestId('itens-saldo')).toContainText('12 UN');
    // Lista (se estiver na tela; no computador fica desativada, D254) e API com a mesma situação.
    if ((await sup.locator('.painel-lista').count()) > 0) await expect(sup.locator(`.item-palete[data-codigo="${palete.code}"]`)).toContainText('Reconciliado');
    expect((await obterPraca(sup)).pallets.find((p) => p.id === palete.id)).toMatchObject({ countState: 'RECONCILIADO', activeCountId: null });
    // A conferência original foi substituída, com as observações preservadas.
    await sup.getByTestId('secao-conferencia').getByText('Histórico de conferências e estoque').click();
    const historico = sup.getByTestId('historico-conferencia');
    await expect(historico).toContainText('Substituída por recontagem');
    await expect(historico).toContainText('Saldo inicial');
    await contexto.close();
  });

  test('pendências: código não cadastrado e fator desconhecido não viram saldo; sem conexão não conclui', async ({ page, context, isMobile }, testInfo) => {
    test.skip(isMobile, 'Fluxo de computador.');
    await entrar(page, 'supervisor');
    const { palete, codigoUnidade } = await prepararCenario(page, testInfo, 'P1');
    await criar(page, '/api/v1/produtos', {
      sku: `00P2${sufixo(testInfo)}`,
      description: 'Condicionador fictício (caixa sem fator aprovado)',
      canonicalUnit: 'UN',
      active: true,
      barcodes: [{ code: `0017890099${sufixo(testInfo)}`, packaging: 'CX', factor: null }],
    });
    await abrirPalete(page, palete.id);
    await iniciarPelaTela(page, 'Completa');

    // Fator desconhecido: conversão bloqueada; pendência explícita.
    await prepararEntrada(page, 'Uma embalagem por leitura', null);
    await ler(page, `0017890099${sufixo(testInfo)}`, true);
    await expect(page.getByTestId('fator-desconhecido')).toContainText('conversão está bloqueada');
    await page.getByTestId('confirmar-item').click();
    await expect(page.getByTestId('pendencias-conferencia')).toContainText('sem fator aprovado');

    // Código não cadastrado: nenhum SKU associado; pendência com quantidade informada.
    await ler(page, '0000999000');
    await expect(page.getByTestId('codigo-nao-cadastrado')).toContainText('Nenhum SKU foi associado');
    await page.getByTestId('codigo-nao-cadastrado').getByLabel('Quantidade observada').fill('2');
    await page.getByTestId('codigo-nao-cadastrado').getByLabel('Unidade observada').fill('CX');
    await page.getByRole('button', { name: 'Registrar pendência' }).click();
    await expect(page.getByTestId('pendencias-conferencia')).toContainText('Código não cadastrado');
    await expect(page.getByTestId('totais-conferencia')).toContainText('Nenhuma quantidade convertida');

    // Item confirmado; sem conexão, a leitura fica como não enviada e concluir é bloqueado.
    await page.getByRole('radio', { name: 'Uma unidade por leitura' }).check();
    await ler(page, codigoUnidade, true);
    await page.getByTestId('confirmar-item').click();
    await expect(page.getByTestId('totais-conferencia')).toContainText('1 UN');
    await context.setOffline(true);
    await expect(page.getByTestId('estado-rascunho')).toContainText('Sem conexão');
    await page.getByTestId('campo-codigo').focus();
    await ler(page, codigoUnidade);
    await expect(page.getByTestId('nao-enviadas')).toContainText('1 entrada(s) não confirmada(s) pelo servidor');
    await expect(page.getByTestId('entrada-nao-confirmada')).toHaveAttribute('data-estado', 'nao-enviada');
    await page.getByRole('button', { name: 'Concluir conferência…' }).click();
    await expect(page.getByTestId('confirmar-conclusao')).toBeDisabled();
    await expect(page.getByTestId('acoes-conferencia')).toContainText('Sem conexão');
    // Reconexão: rascunho e versão consultados; a entrada só vai com confirmação do usuário (mesma chave).
    await context.setOffline(false);
    await expect(page.getByTestId('estado-rascunho')).not.toContainText('Sem conexão');
    await expect(page.getByTestId('nao-enviadas')).toBeVisible();
    await page.getByRole('button', { name: 'Enviar agora' }).click();
    await expect(page.getByTestId('nao-enviadas')).toHaveCount(0);
    await expect(page.getByTestId('totais-conferencia')).toContainText('2 UN');

    // Concluir é possível; a reconciliação fica bloqueada pelas pendências (verificado pela prévia).
    await page.getByTestId('confirmar-escopo').check();
    await page.getByTestId('confirmar-conclusao').click();
    await expect(page.getByTestId('situacao-conferencia')).toContainText('Concluída');
    await page.getByTestId('abrir-reconciliacao').click();
    await expect(page.getByTestId('bloqueios-reconciliacao')).toContainText('pendente');
    await expect(page.getByTestId('confirmar-reconciliacao')).toBeDisabled();
  });

  test('sessão de login encerrada durante a conferência: entrada guardada, novo login volta à conferência e reenvia sem duplicar', async ({
    page,
    context,
    request,
    isMobile,
  }, testInfo) => {
    test.skip(isMobile, 'Fluxo de computador.');
    await entrar(page, 'supervisor');
    const { palete, codigoUnidade } = await prepararCenario(page, testInfo, 'S1');
    await abrirPalete(page, palete.id);
    const conferencia = await iniciarPelaTela(page, 'Completa');
    await prepararEntrada(page, 'Uma unidade por leitura', null);
    await ler(page, codigoUnidade, true);
    await page.getByTestId('confirmar-item').click();
    await expect(page.getByTestId('totais-conferencia')).toContainText('1 UN');

    // Outro cliente encerra a sessão no servidor; o navegador ainda tem o cookie.
    const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
    const cookie = (await context.cookies()).find((c) => c.name === 'pr_sessao');
    const saida = await request.delete('/api/v1/sessao', { headers: { cookie: `pr_sessao=${String(cookie?.value)}`, 'x-csrf-token': sessao.csrfToken } });
    expect(saida.status()).toBe(204);
    await ler(page, codigoUnidade);
    await expect(page.getByTestId('aviso-login')).toHaveText('Sessão expirada: entre novamente. O que não foi enviado continua nesta aba para você revisar.');

    const { login, senha } = credenciais().supervisor;
    await page.getByLabel('Usuário').fill(login);
    await page.getByLabel('Senha', { exact: true }).fill(senha);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(new RegExp(`/conferencias/${conferencia}$`));
    await expect(page.getByTestId('entrada-nao-confirmada')).toContainText('não enviada (sessão expirada)');
    await expect(page.getByTestId('totais-conferencia')).toContainText('1 UN');
    await page.getByRole('button', { name: 'Enviar agora' }).click();
    await expect(page.getByTestId('nao-enviadas')).toHaveCount(0);
    await expect(page.getByTestId('totais-conferencia')).toContainText('2 UN');
  });

  test('consulta não inicia conferência pela interface nem pela API', async ({ page, isMobile }, testInfo) => {
    test.skip(isMobile, 'Fluxo de computador.');
    await entrar(page, 'supervisor');
    const { palete } = await prepararCenario(page, testInfo, 'Q1');
    await page.getByTestId('menu-conta').locator('summary').click();
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await entrar(page, 'consultaCadastro');
    await abrirPalete(page, palete.id);
    await expect(page.getByTestId('secao-conferencia')).toBeVisible();
    await expect(page.getByTestId('iniciar-conferencia')).toHaveCount(0);
    const r = await chamar(page, 'POST', `/api/v1/paletes/${palete.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: 1 });
    expect(r.status()).toBe(403);
  });

  test('celular: conferência por toque e leitor, sem rolagem horizontal, foco no código', async ({ page, isMobile }, testInfo) => {
    test.skip(!isMobile, 'Fluxo de celular.');
    await entrar(page, 'supervisor');
    const { palete, codigoUnidade } = await prepararCenario(page, testInfo, 'M1');
    await abrirPalete(page, palete.id);
    await expect(page.getByTestId('detalhe')).toBeVisible();
    await iniciarPelaTela(page, 'Completa');
    await prepararEntrada(page, 'Uma unidade por leitura', 'Nota fiscal 000555 (declarada)');
    const modo = await page.getByRole('radio', { name: 'Uma unidade por leitura' }).locator('xpath=..').boundingBox();
    expect(modo?.height ?? 0).toBeGreaterThanOrEqual(44);
    await ler(page, codigoUnidade, true);
    await page.getByTestId('confirmar-item').tap();
    await expect(page.getByTestId('campo-codigo')).toBeFocused();
    await ler(page, codigoUnidade);
    await expect(page.getByTestId('totais-conferencia')).toContainText('2 UN');
    const largura = await page.evaluate(() => ({ conteudo: document.documentElement.scrollWidth, janela: window.innerWidth }));
    expect(largura.conteudo).toBeLessThanOrEqual(largura.janela);
    await concluir(page, true);
    const vinculo = page.getByTestId('vinculo-comparacao').first();
    await expect(vinculo).toContainText('Falta');
    const caixa = await vinculo.boundingBox();
    expect(caixa?.width ?? 999).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  });
});
