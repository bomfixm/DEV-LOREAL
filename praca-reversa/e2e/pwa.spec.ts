import { chromium, expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { abrirMenuConta, dimensoesPng, entrar, entrarNoMapa, obterPraca } from './apoio';

test.skip(({ isMobile }) => isMobile, 'Verificações de instalação executadas no perfil de computador (Chromium).');

interface Manifesto {
  id: string;
  name: string;
  short_name: string;
  lang: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

async function aguardarServiceWorker(page: Page) {
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

test.describe('PWA', () => {
  test('manifest e ícones próprios estão corretos', async ({ page }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const resposta = await page.request.get(String(href));
    expect(resposta.ok()).toBe(true);
    const manifesto = (await resposta.json()) as Manifesto;
    expect(manifesto).toMatchObject({ name: 'Praça Reversa', short_name: 'Praça Reversa', lang: 'pt-BR', display: 'standalone' });
    // Endereços relativos ao manifest (funcionam com caminho-base); aqui resolvem para "/" (identidade estável da etapa 01).
    const base = new URL(String(href), page.url());
    expect(new URL(manifesto.start_url, base).pathname).toBe('/');
    expect(new URL(manifesto.scope, base).pathname).toBe('/');
    expect(new URL(manifesto.id, new URL(manifesto.start_url, base)).pathname).toBe('/');
    const tamanhos = manifesto.icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`).sort();
    expect(tamanhos).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
    for (const icone of [...manifesto.icons, { src: '/icons/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png' }]) {
      const arquivo = await page.request.get(new URL(icone.src, new URL(String(href), page.url())).href);
      expect(arquivo.ok(), icone.src).toBe(true);
      const { largura, altura } = dimensoesPng(await arquivo.body());
      expect(`${String(largura)}x${String(altura)}`).toBe(icone.sizes);
    }
  });

  test('o service worker não guarda respostas da API, sessão ou dados autenticados', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await aguardarServiceWorker(page);
    const caches = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const nome of await window.caches.keys()) {
        const cache = await window.caches.open(nome);
        for (const req of await cache.keys()) urls.push(new URL(req.url).pathname);
      }
      return urls;
    });
    expect(caches.length).toBeGreaterThan(0);
    expect(caches.filter((u) => u.startsWith('/api/'))).toEqual([]);
    const cabecalho = (await page.request.get('/api/v1/praca')).headers()['cache-control'];
    expect(cabecalho).toBe('no-store');
  });

  test('Chromium com perfil persistente não aponta impedimentos de instalação', async ({ baseURL }, testInfo) => {
    // Contextos comuns do Playwright são anônimos e sempre recebem "in-incognito".
    const perfil = mkdtempSync(join(tmpdir(), 'praca-pwa-'));
    const canal = testInfo.project.use.channel;
    const contexto = await chromium.launchPersistentContext(perfil, canal ? { channel: canal } : {});
    try {
      const page = contexto.pages()[0] ?? (await contexto.newPage());
      await page.goto(String(baseURL));
      await aguardarServiceWorker(page);
      const cdp = await contexto.newCDPSession(page);
      const manifesto = (await cdp.send('Page.getAppManifest')) as { errors: unknown[] };
      expect(manifesto.errors).toEqual([]);
      const instalacao = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: unknown[] };
      expect(instalacao.installabilityErrors).toEqual([]);
      await cdp.detach();
    } finally {
      await contexto.close();
      rmSync(perfil, { recursive: true, force: true });
    }
  });

  test('sem conexão: abre a casca, avisa e não exibe paletes; depois do logout nada privado fica offline', async ({ page, context }) => {
    await entrarNoMapa(page, 'consulta');
    await aguardarServiceWorker(page);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('aviso-conexao')).toContainText('Sem conexão');
    await expect(page.getByTestId('tela-sem-conexao')).toContainText('não são guardados para uso sem conexão');
    await expect(page.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
    await expect(page.locator('path[data-palete-id]')).toHaveCount(0);
    await expect(page.getByText('PAL-DEMO-001')).toHaveCount(0);
    // A API nunca recebe o index.html do service worker como resposta.
    expect(await page.evaluate(() => fetch('/api/v1/praca').then((r) => r.headers.get('content-type') ?? 'sem tipo', () => 'falhou'))).toBe('falhou');
    expect(await page.evaluate(() => fetch('/api/v1/conferencias/x/anexos/y').then((r) => r.headers.get('content-type') ?? 'sem tipo', () => 'falhou'))).toBe('falhou');

    await context.setOffline(false);
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.locator('path[data-palete-id]').first()).toBeAttached();

    await page.getByTestId('menu-conta').locator('summary').click();
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('aviso-conexao')).toBeVisible();
    await expect(page.getByText('PAL-DEMO-001')).toHaveCount(0);
    await expect(page.locator('path[data-palete-id]')).toHaveCount(0);
    await context.setOffline(false);
    const inexistente = await page.evaluate(() => fetch('/api/v1/inexistente').then((r) => ({ status: r.status, tipo: r.headers.get('content-type') ?? '' })));
    expect(inexistente.status).toBe(404);
    expect(inexistente.tipo).toContain('application/json');
  });

  test('nova versão durante a contagem: aviso, atualização adiada até resolver, sem perder nem repetir; outra aba não troca sozinha', async ({ page, context }) => {
    test.setTimeout(150_000);
    const sw = resolve('apps/web/dist/sw.js');
    const original = readFileSync(sw, 'utf8');
    try {
      await entrar(page, 'supervisor');
      await aguardarServiceWorker(page);
      const outra = await context.newPage();
      await outra.goto('/');
      await expect.poll(() => outra.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
      await outra.evaluate(() => {
        (window as unknown as { __marcador: number }).__marcador = 1;
      });

      // Conferência com uma entrada cuja resposta se perdeu (em confirmação).
      const csrf = ((await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string }).csrfToken;
      const sufixo = randomUUID().slice(0, 6).toUpperCase();
      const codigo = `00099${sufixo}`;
      const produto = await page.request.post('/api/v1/produtos', {
        data: { sku: `PWA${sufixo}`, description: 'Tônico fictício', canonicalUnit: 'UN', active: true, barcodes: [{ code: codigo, packaging: 'UN', factor: '1' }] },
        headers: { 'x-csrf-token': csrf, 'idempotency-key': randomUUID() },
      });
      expect(produto.status()).toBe(201);
      const praca = await obterPraca(page);
      const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
      const livre = praca.layout.positions.find((p) => p.available && !ocupadas.has(p.id));
      const palete = await page.request.post('/api/v1/paletes', {
        data: { code: { mode: 'GERAR' }, positionId: livre?.id ?? null, notes: null, declaredItems: [] },
        headers: { 'x-csrf-token': csrf, 'idempotency-key': randomUUID() },
      });
      const { id: paleteId } = (await palete.json()) as { id: string };
      await page.goto(`/paletes/${paleteId}`);
      await page.getByTestId('iniciar-conferencia').click();
      await page.getByRole('radio', { name: /^Completa/ }).check();
      await page.getByTestId('confirmar-inicio').click();
      await expect(page).toHaveURL(/\/conferencias\/[0-9a-f-]{36}$/);
      const enderecoConferencia = page.url();
      const conferenciaId = new URL(enderecoConferencia).pathname.split('/').pop() ?? '';
      await page.getByRole('radio', { name: 'Uma unidade por leitura' }).check();
      await page.getByLabel('Condição (obrigatória)').selectOption({ label: 'Saudável' });
      await page.getByTestId('campo-codigo').fill(codigo);
      await page.keyboard.press('Enter');
      await page.getByTestId('confirmar-item').click();
      await expect(page.getByTestId('retorno-entrada')).toContainText('1 UN');
      await page.route('**/api/v1/operacoes/**', (r) => r.abort('connectionrefused'));
      await page.route('**/api/v1/conferencias/*/observacoes', async (r) => {
        await r.fetch();
        await r.abort('connectionreset');
      }, { times: 1 });
      await page.getByTestId('campo-codigo').fill(codigo);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('entrada-nao-confirmada')).toHaveAttribute('data-estado', 'incerta');

      // Versão nova publicada no servidor (service worker diferente): aviso nas duas abas, nada ativado.
      writeFileSync(sw, `${original}\n// versão de teste ${randomUUID()}\n`);
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
      await expect(page.getByTestId('aviso-nova-versao')).toBeVisible({ timeout: 30_000 });
      await outra.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
      await expect(outra.getByTestId('aviso-nova-versao')).toBeVisible({ timeout: 30_000 });

      // Atualizar agora perderia a decisão sobre a entrada em confirmação: adiado, com o motivo.
      page.once('dialog', (d) => void d.accept());
      await page.getByTestId('atualizar-aplicativo').click();
      await expect(page.getByTestId('impedimentos-atualizacao')).toContainText('não confirmada');
      await expect(page).toHaveURL(enderecoConferencia);

      // Verificação pela chave: já estava no rascunho; nada é somado de novo.
      await page.unroute('**/api/v1/operacoes/**');
      await page.getByRole('button', { name: 'Verificar no servidor' }).click();
      await expect(page.getByTestId('mensagem-conferencia')).toContainText('nada foi somado de novo');
      await page.getByTestId('impedimentos-atualizacao').getByRole('button', { name: 'Entendi' }).click();

      // Agora atualiza: a contagem confirmada continua no servidor e a tela volta à mesma conferência.
      page.once('dialog', (d) => void d.accept());
      await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), page.getByTestId('atualizar-aplicativo').click()]);
      await expect(page.getByTestId('tela-conferencia')).toBeVisible();
      expect(page.url()).toBe(enderecoConferencia);
      await expect(page.getByTestId('aviso-nova-versao')).toHaveCount(0);
      const linhas = ((await (await page.request.get(`/api/v1/conferencias/${conferenciaId}`)).json()) as { lines: unknown[] }).lines;
      expect(linhas).toHaveLength(2);

      // A outra aba foi avisada e não recarregou sozinha.
      await expect(outra.getByTestId('aviso-outra-aba')).toBeVisible({ timeout: 30_000 });
      expect(await outra.evaluate(() => (window as unknown as { __marcador?: number }).__marcador)).toBe(1);
      await outra.close();
    } finally {
      writeFileSync(sw, original);
    }
  });

  test('API de outra versão: confirmações bloqueadas sem envio, aviso para atualizar; a API recusa contrato antigo', async ({ page }) => {
    await entrar(page, 'supervisor');
    await page.route('**/api/v1/versao', (r) =>
      r.fulfill({ json: { application: '9.9.9', contract: 99, minimumClientContract: 99, localDrafts: true, labelOrigin: 'http://127.0.0.1', basePath: '/' } }),
    );
    await page.reload();
    await expect(page.getByTestId('aviso-incompativel')).toContainText('Versão incompatível com o servidor');
    let gravacoes = 0;
    page.on('request', (req) => {
      if (req.method() !== 'GET' && req.url().includes('/api/v1/') && !req.url().includes('/sessao')) gravacoes += 1;
    });
    await page.goto('/produtos');
    await page.getByRole('button', { name: 'Novo produto' }).click();
    await page.getByLabel(/^SKU/).fill(`INC${randomUUID().slice(0, 6)}`);
    await page.getByLabel('Descrição', { exact: true }).fill('Produto fictício');
    await page.getByRole('button', { name: 'Gravar produto' }).click();
    await expect(page.getByTestId('mensagem-produto')).toContainText('nada foi enviado');
    expect(gravacoes).toBe(0);
    // Sair continua possível para atualizar.
    await abrirMenuConta(page);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    // Proteção do servidor: contrato antigo no cabeçalho é recusado antes de qualquer validação.
    const r = await page.request.post('/api/v1/produtos', { data: {}, headers: { 'x-praca-contrato': '1' } });
    expect(r.status()).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('VERSAO_INCOMPATIVEL');
  });
});
