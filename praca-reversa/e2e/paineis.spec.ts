import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ehCelular, entrar } from './apoio';

/**
 * Painéis na tela, com os dados fictícios da demonstração (nada é criado para
 * preencher cards): painel da operação com cards clicáveis que abrem a lista
 * com os mesmos filtros (na URL) e totais iguais aos do card; acesso do
 * cliente cai direto no painel do cliente, sem mapa e com a API interna
 * negada. Números, fórmulas e projeção são testados na API
 * (apps/api/test/banco/paineis.test.ts).
 */
const PASTA = 'docs/capturas/paineis';
const capturar = (tags: readonly string[]) => tags.includes('@captura') || process.env.CAPTURAR === '1';

test.describe('Painéis da operação e do cliente', () => {
  test('painel da operação: cards, lista com os mesmos filtros e voltar à mesma consulta', async ({ page }, testInfo) => {
    await entrar(page, 'supervisorDemo');
    await page.goto('/painel');
    const painel = page.getByTestId('tela-painel-operacao');
    await expect(painel).toBeVisible();
    await expect(page.getByTestId('painel-consultado-em')).toBeVisible();
    const paletes = page.getByTestId('card-paletes');
    await expect(paletes).toContainText('Paletes na praça');
    const totalCard = (await paletes.locator('.painel-card-valor').innerText()).trim();
    await expect(page.getByTestId('card-reconferencia')).toContainText('Precisa conferir');
    await expect(page.getByTestId('grafico-ruas')).toBeVisible();
    if (capturar(testInfo.tags)) {
      mkdirSync(PASTA, { recursive: true });
      await page.screenshot({ path: `${PASTA}/${ehCelular(testInfo) ? 'celular' : 'computador'}-01-painel-operacao.png`, fullPage: true });
    }

    // Etapa 4: definições e números secundários em "Detalhes"; prioridades completas em "Ver todas".
    await page.getByTestId('abrir-detalhes').click();
    await expect(page.getByTestId('painel-detalhes')).toContainText('Informado × conferido');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('painel-detalhes')).toHaveCount(0);
    if ((await page.getByTestId('ver-prioridades').count()) > 0) {
      await page.getByTestId('ver-prioridades').click();
      await expect(page.getByTestId('lista-prioridades')).toBeVisible();
      await page.getByTestId('janela-fechar').click();
    }
    const valor = async (id: string) => (await page.getByTestId(id).locator('.painel-card-valor').innerText()).trim();
    const volumesCard = await valor('card-volumes');
    const semEndereco = await valor('card-sem-endereco');
    const conferir = await valor('card-reconferencia');

    // Card → lista com o mesmo número de paletes.
    await paletes.click();
    await expect(page).toHaveURL(/\/painel\/estoque$/);
    await expect(page.getByTestId('estoque-totais')).toContainText(`${totalCard} palete(s)`);
    // Volumes registrados: mesma soma da lista (desconhecido continua desconhecido, nunca zero).
    await expect(page.getByTestId('estoque-total-volumes')).toHaveText(volumesCard === 'Não informado' ? 'volumes não informados' : volumesCard);

    // Precisa conferir → lista da reconferência com o mesmo total de paletes.
    await page.goto('/painel');
    await page.getByTestId('card-reconferencia').click();
    await expect(page).toHaveURL(/\/painel\/estoque\?situacao=reconferencia$/);
    await expect(page.getByTestId('estoque-totais')).toContainText(`${conferir} palete(s)`);

    // Filtro na URL; voltar devolve a mesma consulta.
    await page.goto('/painel');
    await page.getByTestId('card-sem-endereco').click();
    await expect(page).toHaveURL(/\/painel\/estoque\?situacao=sem-endereco$/);
    await expect(page.getByTestId('tela-painel-estoque')).toContainText('Só paletes sem endereço confirmado');
    await expect(page.getByTestId('estoque-totais')).toContainText(`${semEndereco} palete(s)`);
    await page.getByTestId('aba-historico').click();
    await expect(page).toHaveURL(/aba=historico/);
    await expect(page.getByTestId('consulta-operacao')).toContainText('Entrada registrada no sistema');
    await page.goBack();
    await expect(page).toHaveURL(/\/painel\/estoque\?situacao=sem-endereco$/);
  });

  test('volumes da janela: meta, separação e expedição por NF na tela (P → E sem dupla contagem)', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'Fluxo de computador (o celular usa os mesmos componentes).');
    await entrar(page, 'supervisor');
    const chamar = async (metodo: 'POST' | 'PUT', caminho: string, corpo: unknown, status: number) => {
      const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
      const r = await page.request.fetch(caminho, { method: metodo, data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
      expect(r.status(), await r.text()).toBe(status);
      return (await r.json()) as Record<string, unknown>;
    };
    // Dados fictícios no escopo de teste do E2E: janela confirmada, palete com uma NF de 12 volumes contados.
    const inicio = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const criada = await chamar(
      'POST',
      '/api/v1/janelas',
      {
        name: 'Janela fictícia dos painéis',
        clientReference: '000901',
        referenceMonth: inicio.slice(0, 7),
        exitStart: inicio,
        exitEnd: new Date(Date.now() + 6 * 3_600_000).toISOString(),
        restrictions: [{ metric: 'QUANTIDADE', unit: 'UN', limit: '100' }],
        criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: [], notes: null },
        authorization: { source: 'E-mail fictício', reference: '000901', date: inicio.slice(0, 10), responsible: 'Contato fictício' },
        notes: 'Dados fictícios de teste.',
      },
      200,
    );
    const janela = await chamar('POST', `/api/v1/janelas/${String(criada.id)}/confirmar`, { expectedVersion: criada.version }, 200);
    const palete = await chamar('POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: null, notes: null, declaredItems: [] }, 201);
    const numero = `9${String(Date.now()).slice(-7)}`;
    const conteudos = (await chamar('POST', `/api/v1/paletes/${String(palete.id)}/conteudos`, { sender: 'Remetente fictício', documentType: 'NFD', documentNumber: numero, delivery: null, description: null }, 201)) as {
      items: { id: string; documentNumber: string | null }[];
    };
    const conteudo = conteudos.items.find((c) => c.documentNumber === numero);
    if (!conteudo) throw new Error('conteúdo não registrado');
    await chamar('POST', `/api/v1/paletes/${String(palete.id)}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id: conteudo.id }, counted: 12, expected: null, origin: 'CONTAGEM_INFORMADA', reference: 'Teste fictício' }, 201);

    // Tela da janela (Agendas) → Volumes da janela.
    await page.goto(`/janelas/${String(janela.id)}`);
    await page.getByTestId('abrir-volumes-janela').click();
    await expect(page).toHaveURL(new RegExp(`/painel/janelas/${String(janela.id)}$`));
    const tela = page.getByTestId('tela-volumes-janela');
    await expect(tela).toContainText('Sem meta informada');
    await page.getByTestId('meta-volumes').fill('10');
    await page.getByTestId('meta-registrar').click();
    await expect(page.getByTestId('volumes-mensagem')).toContainText('Meta registrada');
    await page.getByTestId('vj-busca').fill(numero);
    await page.getByTestId('vj-buscar').click();
    await expect(page.getByTestId('vj-achados')).toContainText('disponível: 12');
    await page.getByTestId('vj-qtd-separar').fill('8');
    await page.getByTestId('vj-separar-botao').click();
    await expect(page.getByTestId('volumes-mensagem')).toContainText('Separação de 8 volume(s) registrada');
    await expect(page.getByTestId('separados-aguardando')).toHaveText('8');
    page.once('dialog', (d) => {
      void d.accept();
    });
    await page.getByTestId('vj-qtd-expedir').fill('3');
    await page.getByTestId('vj-expedir-botao').click();
    await expect(page.getByTestId('volumes-mensagem')).toContainText('Expedição de 3 volume(s) confirmada');
    await expect(page.getByTestId('separados-aguardando')).toHaveText('5');
    await expect(page.getByTestId('barra-preparacao')).toContainText('8 de 10 (80,00%) · falta separar 2');
    await expect(page.getByTestId('barra-expedicao')).toContainText('3 de 10 (30,00%) · falta expedir 7');

    // Etapa 4: o resumo do painel mostra os mesmos números da janela (T 10, P 5, E 3), numa tela de 1366×768.
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/painel?janela=${String(janela.id)}`);
    const resumo = page.getByTestId('painel-janela');
    await expect(resumo.getByTestId('janela-solicitado')).toHaveText('10');
    await expect(resumo.getByTestId('janela-separado')).toHaveText('5');
    await expect(resumo.getByTestId('janela-expedido')).toHaveText('3');
    await expect(resumo.getByTestId('janela-falta-separar')).toHaveText('2');
    await expect(resumo.getByTestId('janela-falta-expedir')).toHaveText('7');
    await expect(resumo.getByTestId('barra-preparacao')).toContainText('80,00%');
    await expect(resumo.getByTestId('barra-expedicao')).toContainText('30,00%');
    expect(await page.evaluate(() => document.querySelector('main')?.scrollHeight === document.querySelector('main')?.clientHeight)).toBe(true);
    if (capturar(testInfo.tags)) {
      mkdirSync('docs/capturas/etapa4-dashboard', { recursive: true });
      await page.screenshot({ path: 'docs/capturas/etapa4-dashboard/depois-operacao-1366x768-janela-com-volumes.png', fullPage: true });
    }
    if (capturar(testInfo.tags)) {
      mkdirSync(PASTA, { recursive: true });
      await page.screenshot({ path: `${PASTA}/computador-03-volumes-janela.png`, fullPage: true });
    }
  });

  test('acesso do cliente: abre no painel do cliente, consulta e exporta; mapa e API interna negados', async ({ page }, testInfo) => {
    await entrar(page, 'clienteDemo');
    const painel = page.getByTestId('tela-painel-cliente');
    await expect(painel).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('cli-card-paletes')).toContainText('Paletes');
    for (const id of ['cli-card-volumes', 'cli-card-solicitado', 'cli-card-expedido', 'cliente-janela', 'cliente-etapas', 'painel-ruas', 'cliente-historico']) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Prioridades');
    // Etapa 4: a consulta completa (estoque, histórico, exportação) abre ao clicar; o resumo cabe numa tela.
    const totalPaletes = (await page.getByTestId('cli-card-paletes').locator('.painel-card-valor').innerText()).trim();
    await page.getByTestId('cli-card-paletes').click();
    await expect(page).toHaveURL(/\/painel\/cliente\?aba=estoque$/);
    await expect(page.getByTestId('consulta-cliente')).toBeVisible();
    await expect(page.getByTestId('estoque-totais')).toContainText(`${totalPaletes} palete(s)`);
    await page.getByRole('button', { name: 'Voltar ao painel' }).click();
    await expect(page.getByTestId('cliente-historico')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Claims');
    // A API interna é negada no servidor, não só escondida na tela.
    for (const url of ['/api/v1/praca', '/api/v1/painel/operacao', '/api/v1/claims']) {
      expect((await page.request.get(url)).status(), url).toBe(403);
    }
    const resposta = await page.request.get('/api/v1/painel/cliente/estoque');
    expect(resposta.status()).toBe(200);
    const corpo = await resposta.text();
    for (const proibido of ['claims', 'excess', 'reason', 'login']) expect(corpo).not.toContain(proibido);

    // Card → lista com o filtro na URL.
    await page.getByTestId('cli-card-localizacao').click();
    await expect(page).toHaveURL(/\/painel\/cliente\?situacao=sem-endereco$/);
    await page.getByTestId('aba-historico').click();
    await expect(page).toHaveURL(/aba=historico/);
    const download = page.waitForEvent('download');
    await page.getByTestId('exportar-historico').click();
    expect((await download).suggestedFilename()).toMatch(/historico.*\.csv$/);
    if (capturar(testInfo.tags)) {
      mkdirSync(PASTA, { recursive: true });
      await page.goto('/painel/cliente');
      await expect(page.getByTestId('tela-painel-cliente')).toBeVisible();
      await page.screenshot({ path: `${PASTA}/${ehCelular(testInfo) ? 'celular' : 'computador'}-02-painel-cliente.png`, fullPage: true });
    }
    // Sem rolagem horizontal no celular.
    if (ehCelular(testInfo)) {
      const largura = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(largura).toBeLessThanOrEqual(1);
    }
  });
});
