import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  abrirMenuConta,
  aguardarMapa,
  aguardarMapaParado,
  bordaBranca,
  decodificarQr,
  entrar,
  forma,
  obterPraca,
  type PracaApi,
} from './apoio';
import { credenciais, type Credenciais } from './credenciais';

const PAL_DEMO_001 = '00000000-0000-4000-8000-000000000001';

/** Primeira posição livre e disponível da fileira indicada (escopo de cadastro). */
function posicaoLivre(praca: PracaApi, fileira: string) {
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  const livre = praca.layout.positions.find((p) => p.code.startsWith(`${fileira}-`) && p.available && !ocupadas.has(p.id));
  if (!livre) throw new Error(`Sem posição livre em ${fileira}.`);
  return livre;
}

async function irPeloMenu(page: Page, item: string): Promise<void> {
  await abrirMenuConta(page);
  await page.getByRole('button', { name: item }).click();
}

/** Login pelo formulário numa página que já está na tela de entrada. */
async function preencherLogin(page: Page, quem: keyof Credenciais): Promise<void> {
  const { login, senha } = credenciais()[quem];
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function novaPaginaSemSessao(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const contexto = await browser.newContext({ baseURL: baseURL ?? '', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  return contexto.newPage();
}

/** Token anti-CSRF da sessão do navegador (para chamadas diretas à API no teste). */
async function csrf(page: Page): Promise<string> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return sessao.csrfToken;
}

test.describe('cadastro, mapa, etiqueta e QR', () => {
  test('computador: cadastrar → localizar no mapa → imprimir etiqueta → abrir pelo QR', async ({ page, browser, isMobile, baseURL }) => {
    test.skip(isMobile, 'Fluxo de computador.');
    await entrar(page, 'supervisor');

    // Produto com SKU e código de barras textuais (zeros à esquerda).
    await irPeloMenu(page, 'Produtos');
    await page.getByRole('button', { name: 'Novo produto' }).click();
    await page.getByLabel('SKU', { exact: true }).fill('000321');
    await page.getByLabel('Descrição', { exact: true }).fill('Condicionador fictício 200 ml');
    await page.getByRole('button', { name: 'Acrescentar código de barras' }).click();
    await page.getByLabel('Código de barras 1').fill('0007890000017');
    await page.getByRole('button', { name: 'Gravar produto' }).click();
    await expect(page.getByTestId('mensagem-produto')).toContainText('Produto 000321 cadastrado');
    await expect(page.locator('.produto-linha[data-sku="000321"]')).toContainText('0007890000017');

    // Palete com código gerado, posição inicial e linha declarada.
    const livre = posicaoLivre(await obterPraca(page), 'F03');
    await irPeloMenu(page, 'Cadastrar palete');
    await page.getByLabel('Código da posição').fill(livre.code);
    await expect(page.getByTestId('situacao-posicao')).toContainText('Livre');
    await page.getByRole('button', { name: 'Acrescentar linha declarada' }).click();
    const linha = page.getByTestId('linha-declarada').first();
    await linha.getByLabel('SKU (vazio = produto pendente)').fill('000321');
    await linha.getByLabel('Lote (vazio = pendente)').fill('0042');
    await linha.getByLabel('Documento de origem').selectOption({ label: 'Nota fiscal' });
    await linha.getByLabel('Referência do documento').fill('000456');
    await linha.getByLabel('Quantidade declarada').fill('2');
    await page.getByLabel('Observações do cadastro (opcional)').fill('Palete de teste E2E');
    await page.getByRole('button', { name: 'Cadastrar palete' }).click();
    const sucesso = page.getByTestId('cadastro-sucesso');
    await expect(sucesso).toBeVisible();
    const codigo = ((await sucesso.locator('.sucesso-codigo').textContent()) ?? '').trim();
    const id = ((await sucesso.locator('code').textContent()) ?? '').trim();
    expect(codigo).toMatch(/^PR-\d{6}$/);
    await expect(sucesso).toContainText(livre.code);

    // Mapa, lista e detalhe mostram o mesmo registro, pela rota estável.
    await sucesso.getByRole('button', { name: 'Ver no mapa' }).click();
    await expect(page).toHaveURL(new RegExp(`/paletes/${id}$`));
    await aguardarMapa(page);
    await expect(page.getByTestId('detalhe')).toHaveAttribute('data-palete-id', id);
    await expect(page.getByTestId('conteudo-desconhecido')).toBeVisible();
    await expect(page.getByTestId('itens-declarados')).toContainText('000321');
    await expect(page.getByTestId('itens-declarados')).toContainText('Nota fiscal 000456');
    await expect(page.getByTestId('observacoes')).toHaveText('Palete de teste E2E');
    await expect(page.locator(`.item-palete[data-id="${id}"]`)).toContainText(livre.code);
    await aguardarMapaParado(page);
    const caixaPalete = await forma(page, codigo).boundingBox();
    const caixaPosicao = await page.locator(`path[data-posicao="${livre.code}"]`).boundingBox();
    if (!caixaPalete || !caixaPosicao) throw new Error('Palete ou posição fora da tela.');
    expect(caixaPalete.x).toBeGreaterThanOrEqual(caixaPosicao.x - 1);
    expect(caixaPalete.x + caixaPalete.width).toBeLessThanOrEqual(caixaPosicao.x + caixaPosicao.width + 1);

    // Busca pelo código escrito (alternativa ao QR).
    await page.getByRole('button', { name: 'Fechar' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByLabel('Código, posição ou link do QR').fill(codigo.toLowerCase());
    await page.getByLabel('Código, posição ou link do QR').press('Enter');
    await expect(page.getByTestId('detalhe')).toHaveAttribute('data-palete-id', id);
    await expect(page).toHaveURL(new RegExp(`/paletes/${id}$`));

    // Etiqueta: prévia, impressão A4 e QR real com o link do palete.
    await page.getByTestId('acao-etiqueta').click();
    await expect(page).toHaveURL(new RegExp(`/etiquetas\\?ids=${id}$`));
    await expect(page.getByTestId('etiqueta-codigo')).toHaveText(codigo);
    await expect(page.getByTestId('etiqueta-posicao')).toContainText(`${livre.code} — código provisório`);
    await expect(page.getByTestId('aviso-endereco-local')).toBeVisible();
    const textoEtiqueta = (await page.getByTestId('etiqueta').textContent()) ?? '';
    expect(textoEtiqueta).not.toContain('000321');
    expect(textoEtiqueta).toContain('Não é SSCC');

    await page.emulateMedia({ media: 'print' });
    const medidas = await page.evaluate(() => {
      const mm = 96 / 25.4;
      const el = (seletor: string) => {
        const encontrado = document.querySelector(seletor);
        if (!(encontrado instanceof HTMLElement || encontrado instanceof SVGElement)) throw new Error(seletor);
        return encontrado;
      };
      const codigoEl = el('[data-testid="etiqueta-codigo"]') as HTMLElement;
      const etiqueta = el('.etiqueta') as HTMLElement;
      const folha = el('.folha-a4').getBoundingClientRect();
      const qr = el('[data-testid="etiqueta-qr"]');
      return {
        fonteCodigoMm: Number.parseFloat(getComputedStyle(codigoEl).fontSize) / mm,
        qrMm: qr.getBoundingClientRect().width / mm,
        ladoQr: (qr as SVGSVGElement).viewBox.baseVal.width,
        folhaMm: { largura: folha.width / mm, altura: folha.height / mm },
        cortaEtiqueta: etiqueta.scrollHeight > etiqueta.clientHeight + 1 || etiqueta.scrollWidth > etiqueta.clientWidth + 1,
        cortaCodigo: codigoEl.scrollWidth > codigoEl.clientWidth + 1,
        topo: getComputedStyle(el('.topo')).display,
      };
    });
    expect(medidas.folhaMm.largura).toBeCloseTo(190, 0);
    expect(medidas.folhaMm.altura).toBeCloseTo(276, 0);
    expect(medidas.fonteCodigoMm).toBeGreaterThan(12);
    expect(medidas.qrMm).toBeGreaterThan(80);
    expect(medidas.cortaEtiqueta).toBe(false);
    expect(medidas.cortaCodigo).toBe(false);
    expect(medidas.topo).toBe('none');
    const png = await page.getByTestId('etiqueta-qr').screenshot();
    const link = decodificarQr(png);
    expect(link).toBe(`${baseURL ?? ''}/paletes/${id}`);
    // Zona de silêncio: 4 módulos brancos em volta (com folga de antisserrilhado).
    expect(bordaBranca(png, (4 / medidas.ladoQr) * 0.85)).toBe(true);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length).toBe(1);
    await page.emulateMedia({ media: 'screen' });

    // Abrir o link do QR sem sessão: login e retorno ao mesmo palete.
    const outra = await novaPaginaSemSessao(browser, baseURL);
    await outra.goto(link ?? '');
    await expect(outra).toHaveURL(/\/entrar\?retorno=%2Fpaletes%2F/);
    await expect(outra.getByTestId('aviso-retorno')).toContainText('palete');
    await preencherLogin(outra, 'consultaCadastro');
    await expect(outra).toHaveURL(new RegExp(`/paletes/${id}$`));
    await expect(outra.getByTestId('detalhe')).toHaveAttribute('data-palete-id', id);
    await expect(outra.getByRole('heading', { name: codigo })).toBeVisible();
    await expect(outra.getByTestId('acao-etiqueta')).toHaveCount(0);
    await outra.context().close();
  });

  test('etiquetas em lote do resultado do filtro, duas por folha', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Fluxo de computador.');
    await entrar(page, 'operador');
    const token = await csrf(page);
    // Dois paletes sem posição (localização pendente), cadastrados pela API.
    for (let i = 0; i < 2; i++) {
      const resposta = await page.request.post('/api/v1/paletes', {
        headers: { 'x-csrf-token': token, 'idempotency-key': `lote-e2e-${String(i)}-${String(Date.now())}` },
        data: { code: { mode: 'INFORMAR', value: `LOTE-E2E-${String(i + 1)}` }, positionId: null },
      });
      expect(resposta.status()).toBe(201);
    }
    await page.reload();
    await page.getByLabel('Código, posição ou link do QR').fill('lote-e2e');
    await expect(page.getByTestId('contagem-lista')).toContainText('2 de');
    await page.getByTestId('etiquetas-resultado').click();
    await expect(page.getByTestId('etiqueta')).toHaveCount(2);
    await page.getByLabel('Formato').selectOption('A4_2');
    await expect(page.getByTestId('folha')).toHaveCount(1);
    await expect(page.getByTestId('etiqueta-posicao').first()).toContainText('Sem posição registrada');
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length).toBe(1);
    const cortes = await page.locator('.etiqueta').evaluateAll((els) =>
      els.map((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1),
    );
    expect(cortes).toEqual([false, false]);
    for (const qr of await page.getByTestId('etiqueta-qr').all()) {
      expect(decodificarQr(await qr.screenshot())).toMatch(/\/paletes\/[0-9a-f-]{36}$/);
    }
  });

  test('retorno após o login aceita só destinos internos', async ({ browser, isMobile, baseURL }) => {
    test.skip(isMobile, 'Verificação de rota.');
    for (const destino of ['https://exemplo.invalid/paletes', '//exemplo.invalid/x', '/\\exemplo.invalid', '/paletes/nao-e-id']) {
      const pagina = await novaPaginaSemSessao(browser, baseURL);
      await pagina.goto(`/entrar?retorno=${encodeURIComponent(destino)}`);
      await preencherLogin(pagina, 'consultaCadastro');
      await expect(pagina.getByTestId('menu-conta')).toBeVisible();
      const url = new URL(pagina.url());
      expect(url.origin).toBe(new URL(baseURL ?? '').origin);
      expect(url.pathname).toBe('/');
      await pagina.context().close();
    }
  });

  test('layout pela interface: bloco ao final e posição indisponível, sem mudar IDs nem vínculos', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Configuração no computador.');
    await entrar(page, 'supervisor');
    const antes = await obterPraca(page);
    await irPeloMenu(page, 'Layout da praça');
    const form = page.getByTestId('form-bloco');
    await form.getByLabel('Tipo de bloco').selectOption('UNICA');
    await form.getByLabel('Posições por fileira').fill('17');
    await form.getByLabel('Título do bloco').fill('Outro extremo: fileira única de 17 (teste)');
    await form.getByRole('button', { name: 'Acrescentar bloco' }).click();
    await expect(page.getByTestId('mensagem-layout')).toContainText('acrescentado ao final');
    const depois = await obterPraca(page);
    expect(depois.layout.rows.length).toBe(antes.layout.rows.length + 1);
    for (const p of antes.layout.positions) {
      expect(depois.layout.positions.find((q) => q.id === p.id)).toMatchObject({ code: p.code, x: p.x, y: p.y });
    }
    expect(depois.pallets.map((p) => [p.id, p.positionId]).sort()).toEqual(antes.pallets.map((p) => [p.id, p.positionId]).sort());

    // Posição livre fica indisponível com motivo.
    const livre = posicaoLivre(depois, 'F05');
    const posicoes = page.getByTestId('lista-posicoes');
    await posicoes.getByLabel('Fileira').selectOption({ label: 'F05' });
    await posicoes.getByRole('button', { name: `Editar ${livre.code}` }).click();
    await posicoes.getByLabel('Disponível para paletes').uncheck();
    await posicoes.getByLabel('Motivo da indisponibilidade').fill('Pilar (teste)');
    await posicoes.getByRole('button', { name: `Gravar ${livre.code}` }).click();
    await expect(page.getByTestId('mensagem-layout')).toContainText('indisponível');
    await expect(page.getByTestId('historico-layout')).toContainText(livre.code);

    // Cadastro direto pela API na posição indisponível é recusado.
    const resposta = await page.request.post('/api/v1/paletes', {
      headers: { 'x-csrf-token': await csrf(page), 'idempotency-key': `indisponivel-${String(Date.now())}` },
      data: { code: { mode: 'GERAR' }, positionId: livre.id },
    });
    expect(resposta.status()).toBe(409);

    await page.getByRole('button', { name: 'Voltar ao mapa' }).click();
    await expect(page.getByTestId('mapa')).toHaveAttribute('data-zoom', /-?\d/);
    await expect(page.locator(`path[data-posicao="${livre.code}"]`)).toHaveClass(/pr-posicao--indisponivel/);
  });

  test('sem permissão: consulta não cadastra pela interface nem pela API', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Permissões verificadas no computador.');
    await entrar(page, 'consultaCadastro');
    await abrirMenuConta(page);
    await expect(page.getByRole('button', { name: 'Cadastrar palete' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Novo palete' })).toHaveCount(0);
    await page.goto('/paletes/novo');
    await expect(page.getByTestId('sem-permissao')).toBeVisible();
    const resposta = await page.request.post('/api/v1/paletes', {
      headers: { 'x-csrf-token': await csrf(page), 'idempotency-key': `sem-permissao-${String(Date.now())}` },
      data: { code: { mode: 'GERAR' }, positionId: null },
    });
    expect(resposta.status()).toBe(403);
    expect((await page.request.get(`/api/v1/etiquetas?ids=${PAL_DEMO_001}`)).status()).toBe(403);
  });

  test('etiqueta de palete da demonstração identifica dados fictícios', async ({ page, isMobile, baseURL }) => {
    test.skip(isMobile, 'Etiqueta de demonstração no computador.');
    await entrar(page, 'operadorDemo');
    await page.goto(`/etiquetas?ids=${PAL_DEMO_001}`);
    await expect(page.getByTestId('etiqueta-codigo')).toHaveText('PAL-DEMO-001');
    await expect(page.getByTestId('etiqueta')).toContainText('DEMONSTRAÇÃO — DADOS FICTÍCIOS');
    await expect(page.getByTestId('etiqueta-posicao')).toContainText('F01-P01 — código provisório');
    expect(decodificarQr(await page.getByTestId('etiqueta-qr').screenshot())).toBe(`${baseURL ?? ''}/paletes/${PAL_DEMO_001}`);
  });

  test('celular: cadastrar, ver no mapa, imprimir etiqueta e abrir pelo QR', async ({ page, isMobile, baseURL }) => {
    test.skip(!isMobile, 'Fluxo de celular.');
    await entrar(page, 'operador');
    const livre = posicaoLivre(await obterPraca(page), 'F04');
    await page.getByRole('button', { name: /^Lista/ }).tap();
    await page.getByRole('button', { name: 'Novo palete' }).tap();
    await page.getByLabel('Código da posição').fill(livre.code);
    await expect(page.getByTestId('situacao-posicao')).toContainText('Livre');
    await page.getByRole('button', { name: 'Cadastrar palete' }).tap();
    const sucesso = page.getByTestId('cadastro-sucesso');
    await expect(sucesso).toBeVisible();
    const codigo = ((await sucesso.locator('.sucesso-codigo').textContent()) ?? '').trim();
    const id = ((await sucesso.locator('code').textContent()) ?? '').trim();
    const semRolagem = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await semRolagem()).toBe(true);

    // Rota do palete no celular abre direto o detalhe; voltar mostra o mapa com a seleção.
    await sucesso.getByRole('button', { name: 'Ver no mapa' }).tap();
    await expect(page.getByTestId('detalhe')).toHaveAttribute('data-palete-id', id);
    await expect(page.getByTestId('conteudo-desconhecido')).toBeVisible();
    await page.getByTestId('detalhe').getByRole('button', { name: 'Voltar ao mapa' }).tap();
    await expect(page.getByTestId('resumo-selecao')).toContainText(codigo);
    await expect(forma(page, codigo)).toBeVisible();

    await page.getByRole('button', { name: 'Ver conteúdo' }).tap();
    await page.getByTestId('acao-etiqueta').tap();
    await expect(page.getByTestId('etiqueta-codigo')).toHaveText(codigo);
    expect(await semRolagem()).toBe(true);
    const link = decodificarQr(await page.getByTestId('etiqueta-qr').screenshot());
    expect(link).toBe(`${baseURL ?? ''}/paletes/${id}`);

    // O link lido pela câmera abre o mesmo palete (sessão já aberta).
    await page.goto(link ?? '');
    await expect(page.getByTestId('detalhe')).toHaveAttribute('data-palete-id', id);
    await expect(page.getByRole('heading', { name: codigo })).toBeVisible();
  });
});
