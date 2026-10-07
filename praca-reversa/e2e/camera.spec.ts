import { expect, test, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { entrar, obterPraca, type PracaApi } from './apoio';
import { configurarCamera, estadoCamera, imagemDoCodigo, instalarCameraFalsa, mostrarNaCamera } from './camera-falsa';

/**
 * Etapa 09 — leitura por câmera com câmera simulada (canvas no lugar do
 * getUserMedia; decodificação real pelo decodificador local da interface).
 * Escopo de teste não demonstrativo; produtos e paletes fictícios criados
 * pela API a cada execução.
 */

interface Palete {
  id: string;
  code: string;
  version: number;
}

function sufixo(testInfo: TestInfo): string {
  return testInfo.project.name === 'celular' ? '2' : '1';
}

async function chamar(page: Page, metodo: 'POST' | 'PATCH', caminho: string, corpo: unknown): Promise<APIResponse> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return page.request.fetch(caminho, { method: metodo, data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
}

async function criar<T>(page: Page, caminho: string, corpo: unknown): Promise<T> {
  const r = await chamar(page, 'POST', caminho, corpo);
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as T;
}

function posicaoLivre(praca: PracaApi): string {
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  const livre = praca.layout.positions.find((p) => p.code.startsWith('F03-') && p.available && !ocupadas.has(p.id)) ?? praca.layout.positions.find((p) => p.available && !ocupadas.has(p.id));
  if (!livre) throw new Error('Sem posição livre.');
  return livre.id;
}

/** Produto com código da unidade, caixa de fator 12 e caixa de fator desconhecido (zeros à esquerda nos códigos). */
async function prepararCenario(page: Page, testInfo: TestInfo, nome: string) {
  // Sufixo aleatório: o banco de E2E é reaproveitado entre execuções e repetições.
  const s = `${sufixo(testInfo)}${randomUUID().slice(0, 4).toUpperCase()}`;
  const sku = `CAM${nome}${s}`;
  const codigos = { unidade: `00079${nome}${s}01`, caixa: `00179${nome}${s}12`, semFator: `00279${nome}${s}99` };
  await criar(page, '/api/v1/produtos', {
    sku,
    description: `Máscara fictícia ${nome}`,
    canonicalUnit: 'UN',
    active: true,
    barcodes: [
      { code: codigos.unidade, packaging: 'UN', factor: '1' },
      { code: codigos.caixa, packaging: 'CX', factor: '12' },
      { code: codigos.semFator, packaging: 'FD', factor: null },
    ],
  });
  const palete = await criar<Palete>(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: posicaoLivre(await obterPraca(page)), notes: null, declaredItems: [] });
  return { sku, codigos, palete };
}

async function abrirLeitorNoMapa(page: Page, testInfo: TestInfo): Promise<void> {
  await page.goto('/');
  if (sufixo(testInfo) === '2') await page.getByRole('button', { name: /^Lista/ }).click();
  await page.getByTestId('ler-codigo-praca').click();
  await expect(page.getByTestId('leitor-camera')).toHaveAttribute('data-estado', 'lendo', { timeout: 20_000 });
}

test.describe('leitura por câmera', () => {
  test('mapa: produto com unidade e fator, pausa entre quadros, desconhecido e QR externo sem efeito, QR do palete abre o palete', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await instalarCameraFalsa(page);
    await entrar(page, 'supervisor');
    const { sku, codigos, palete } = await prepararCenario(page, testInfo, 'M');
    await abrirLeitorNoMapa(page, testInfo);

    // Só vídeo, câmera traseira preferida.
    const pedido = JSON.parse((await estadoCamera(page)).restricoes[0] ?? '{}') as { audio?: boolean; video?: { facingMode?: { ideal?: string } } };
    expect(pedido.audio).toBe(false);
    expect(pedido.video?.facingMode?.ideal).toBe('environment');

    // Caixa com fator: valor lido como texto (zeros preservados), produto e fator do cadastro.
    await mostrarNaCamera(page, await imagemDoCodigo(codigos.caixa, 'Code128'));
    await expect(page.getByTestId('valor-lido')).toHaveText(codigos.caixa);
    await expect(page.getByTestId('produto-lido')).toContainText(sku);
    await expect(page.getByTestId('embalagem-lida')).toHaveText('CX = 12 UN');

    // Pausa: outro código diante da câmera não substitui o resultado sem "Ler próximo".
    await mostrarNaCamera(page, await imagemDoCodigo(codigos.unidade, 'Code128'));
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId('valor-lido')).toHaveText(codigos.caixa);
    await page.getByTestId('ler-proximo').click();
    await expect(page.getByTestId('valor-lido')).toHaveText(codigos.unidade);
    await expect(page.getByTestId('embalagem-lida')).toContainText('unidade canônica');

    // Fator desconhecido: conversão bloqueada, nada presumido.
    await mostrarNaCamera(page, await imagemDoCodigo(codigos.semFator, 'Code128'));
    await page.getByTestId('ler-proximo').click();
    await expect(page.getByTestId('embalagem-lida')).toHaveText('FD — fator desconhecido: conversão bloqueada');

    // Código desconhecido: pendência, nenhum produto criado; zeros preservados.
    const desconhecido = `000${sufixo(testInfo)}4560`;
    await mostrarNaCamera(page, await imagemDoCodigo(desconhecido, 'Code128'));
    await page.getByTestId('ler-proximo').click();
    await expect(page.getByTestId('codigo-desconhecido')).toContainText(`Código ${desconhecido} não cadastrado`);
    expect((await page.request.get(`/api/v1/produtos/identificar?codigo=${desconhecido}`)).status()).toBe(404);

    // QR externo: mostrado como texto, nada aberto.
    await mostrarNaCamera(page, await imagemDoCodigo('https://exemplo.invalid/promocao', 'QRCode'));
    await page.getByTestId('ler-proximo').click();
    await expect(page.getByTestId('leitura-externa')).toContainText('nada foi aberto');
    await expect(page.getByTestId('leitura-externa').locator('a')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');

    // Sem acesso à API: a leitura fica pendente de consulta (produto não presumido).
    await page.route('**/api/v1/produtos/identificar**', (rota) => rota.abort('connectionrefused'));
    await mostrarNaCamera(page, await imagemDoCodigo(codigos.unidade, 'Code128'));
    await page.getByTestId('ler-proximo').click();
    await expect(page.getByTestId('leitura-pendente-consulta')).toContainText('pendente de consulta');
    await page.unroute('**/api/v1/produtos/identificar**');

    // QR do palete desta instalação: abre o palete (a API confere sessão e escopo) e libera a câmera.
    await mostrarNaCamera(page, await imagemDoCodigo(`${String(baseURL)}/paletes/${palete.id}`, 'QRCode'));
    await page.getByTestId('ler-proximo').click();
    await expect(page.getByTestId('leitura-palete')).toBeVisible();
    await page.getByTestId('abrir-palete-lido').click();
    await expect(page).toHaveURL(new RegExp(`/paletes/${palete.id}$`));
    await expect(page.getByTestId('leitor-camera')).toHaveCount(0);
    await expect.poll(async () => (await estadoCamera(page)).trilhasAtivas).toBe(0);
  });

  test('falhas e cancelamento mantêm a alternativa manual e liberam a câmera', async ({ page, context }, testInfo) => {
    test.skip(sufixo(testInfo) === '2', 'Coberto no computador; o celular repete o fluxo principal.');
    test.setTimeout(120_000);
    await instalarCameraFalsa(page);
    await entrar(page, 'supervisor');

    // Permissão recusada.
    await page.goto('/');
    await configurarCamera(page, { erro: 'NotAllowedError' });
    await page.getByTestId('ler-codigo-praca').click();
    await expect(page.getByTestId('falha-camera')).toHaveAttribute('data-falha', 'permissao-negada');
    await page.getByRole('button', { name: 'Fechar e digitar o código' }).click();
    await expect(page.getByTestId('leitor-camera')).toHaveCount(0);
    await expect(page.getByLabel('Código, posição ou link do QR')).toBeEnabled();

    // Câmera ocupada: tentar de novo depois de liberada.
    await configurarCamera(page, { erro: 'NotReadableError' });
    await page.getByTestId('ler-codigo-praca').click();
    await expect(page.getByTestId('falha-camera')).toHaveAttribute('data-falha', 'camera-ocupada');
    await configurarCamera(page, { erro: null });
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByTestId('leitor-camera')).toHaveAttribute('data-estado', 'lendo', { timeout: 20_000 });
    await page.getByTestId('fechar-camera').click();
    await expect.poll(async () => (await estadoCamera(page)).trilhasAtivas).toBe(0);

    // Cancelada antes de a permissão responder: a câmera concedida depois é liberada na hora.
    await configurarCamera(page, { atrasoMs: 1_500 });
    const antes = (await estadoCamera(page)).trilhasTotal;
    await page.getByTestId('ler-codigo-praca').click();
    await page.getByTestId('fechar-camera').click();
    await page.waitForTimeout(2_500);
    const depois = await estadoCamera(page);
    expect(depois.trilhasTotal).toBe(antes + 1);
    expect(depois.trilhasAtivas).toBe(0);

    // Contexto inseguro (HTTP por IP): nem pede a câmera.
    const insegura = await context.newPage();
    await instalarCameraFalsa(insegura, { inseguro: true });
    await insegura.goto('/');
    await insegura.getByTestId('ler-codigo-praca').click();
    await expect(insegura.getByTestId('falha-camera')).toHaveAttribute('data-falha', 'contexto-inseguro');
    expect((await estadoCamera(insegura)).chamadas).toBe(0);
    await insegura.close();

    // Navegador sem o recurso.
    const semRecurso = await context.newPage();
    await instalarCameraFalsa(semRecurso, { semRecurso: true });
    await semRecurso.goto('/');
    await semRecurso.getByTestId('ler-codigo-praca').click();
    await expect(semRecurso.getByTestId('falha-camera')).toHaveAttribute('data-falha', 'sem-recurso');
    await semRecurso.close();
  });

  test('câmera → conferência: unidade explícita, quadros repetidos não somam, leitura consciente seguinte soma, leitura antiga não vai para outra tela', async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    await instalarCameraFalsa(page);
    await entrar(page, 'supervisor');
    const { sku, codigos, palete } = await prepararCenario(page, testInfo, 'K');
    await page.goto(`/paletes/${palete.id}`);
    await page.getByTestId('iniciar-conferencia').click();
    await page.getByRole('radio', { name: /^Completa/ }).check();
    await page.getByTestId('confirmar-inicio').click();
    await expect(page).toHaveURL(/\/conferencias\/[0-9a-f-]{36}$/);
    const conferenciaId = new URL(page.url()).pathname.split('/').pop() ?? '';
    const linhas = async () => ((await (await page.request.get(`/api/v1/conferencias/${conferenciaId}`)).json()) as { lines: unknown[] }).lines.length;

    await page.getByRole('radio', { name: 'Uma unidade por leitura' }).check();
    await page.getByLabel('Condição (obrigatória)').selectOption({ label: 'Saudável' });

    // Primeira leitura: confirma produto e unidade antes de somar.
    await mostrarNaCamera(page, await imagemDoCodigo(codigos.unidade, 'Code128'));
    await page.getByTestId('ler-codigo-conferencia').click();
    await expect(page.getByTestId('usar-codigo-lido')).toHaveText('Usar este código', { timeout: 20_000 });
    await page.getByTestId('usar-codigo-lido').click();
    await expect(page.getByTestId('confirmacao-item')).toContainText(sku);
    await page.getByTestId('confirmar-item').click();
    await expect(page.getByTestId('retorno-entrada')).toContainText(`1 UN de ${sku}`);
    expect(await linhas()).toBe(1);

    // Mesmo código diante da câmera por vários quadros: um resultado, nenhuma soma sem toque.
    await page.getByTestId('ler-codigo-conferencia').click();
    await expect(page.getByTestId('usar-codigo-lido')).toHaveText(`Somar 1 UN de ${sku}`, { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    expect(await linhas()).toBe(1);
    await page.getByTestId('usar-codigo-lido').click();
    await expect.poll(linhas).toBe(2);

    // Caixa: unidade e fator explícitos na confirmação.
    await page.getByRole('radio', { name: 'Uma embalagem por leitura' }).check();
    await mostrarNaCamera(page, await imagemDoCodigo(codigos.caixa, 'Code128'));
    await page.getByTestId('ler-codigo-conferencia').click();
    await page.getByTestId('usar-codigo-lido').click();
    await expect(page.getByTestId('confirmar-item')).toHaveText('Confirmar e somar 1 CX (= 12 UN)');

    // Leitura feita e não usada; a pessoa sai da tela: nada vai para a conferência nem para outra tela.
    await page.getByRole('button', { name: 'Cancelar' }).first().click();
    await page.getByTestId('ler-codigo-conferencia').click();
    await expect(page.getByTestId('resultado-camera')).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    await expect(page.getByTestId('leitor-camera')).toHaveCount(0);
    await expect.poll(async () => (await estadoCamera(page)).trilhasAtivas).toBe(0);
    await page.goto(`/conferencias/${conferenciaId}`);
    await expect(page.getByTestId('campo-codigo')).toHaveValue('');
    expect(await linhas()).toBe(2);
  });
});
