import { expect, test } from '@playwright/test';
import { credenciais } from './credenciais';

/**
 * Etapa 09 — a mesma instalação sob caminho-base (CAMINHO_BASE=/praca/):
 * manifest, service worker, login, rota profunda do QR do palete, etiquetas e
 * API sob o prefixo. Servidor próprio (porta 4311) com build em dist-praca.
 */
test('caminho-base /praca/: manifest, service worker, login, QR profundo, etiquetas e API sob o prefixo', async ({ page, baseURL }) => {
  const origem = new URL(String(baseURL)).origin;
  await page.goto('./');
  expect(new URL(page.url()).pathname).toBe('/praca/');

  // Manifest e ícones resolvem dentro do caminho-base.
  const href = String(await page.locator('link[rel="manifest"]').getAttribute('href'));
  expect(href).toBe('/praca/manifest.webmanifest');
  const enderecoManifest = new URL(href, page.url());
  const manifesto = (await (await page.request.get(enderecoManifest.href)).json()) as { start_url: string; scope: string; icons: { src: string }[] };
  expect(new URL(manifesto.start_url, enderecoManifest).pathname).toBe('/praca/');
  expect(new URL(manifesto.scope, enderecoManifest).pathname).toBe('/praca/');
  for (const icone of manifesto.icons) expect((await page.request.get(new URL(icone.src, enderecoManifest).href)).ok(), icone.src).toBe(true);

  // Entrar e conferir o escopo do service worker.
  const { login, senha } = credenciais().operadorDemo;
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByTestId('menu-conta')).toBeVisible();
  const escopo = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(escopo).pathname).toBe('/praca/');

  // API só sob o prefixo; fora dele, nada.
  const praca = (await (await page.request.get('api/v1/praca')).json()) as { pallets: { id: string; code: string; positionId: string | null }[] };
  expect((await page.request.get(`${origem}/api/v1/health`)).status()).toBe(404);
  const palete = praca.pallets.find((p) => p.positionId !== null);
  if (!palete) throw new Error('Sem palete de demonstração.');

  // Etiqueta: o QR aponta para a rota profunda com o caminho-base.
  const etiquetas = (await (await page.request.get(`api/v1/etiquetas?ids=${palete.id}`)).json()) as { labels: { url: string }[] };
  expect(etiquetas.labels[0]?.url).toBe(`${origem}/praca/paletes/${palete.id}`);

  // Rota profunda aberta "pelo QR" (endereço completo) mostra o palete certo, autenticado.
  await page.goto(`${origem}/praca/paletes/${palete.id}`);
  await expect(page.getByTestId('detalhe')).toContainText(palete.code);
  expect(new URL(page.url()).pathname).toBe(`/praca/paletes/${palete.id}`);

  // Navegação interna mantém o prefixo.
  await page.getByTestId('menu-conta').locator('summary').click();
  await page.getByRole('button', { name: 'Aplicativo e aparelho' }).click();
  await expect(page.getByTestId('tela-aplicativo')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/praca/aplicativo');
  await expect(page.getByTestId('versoes')).toContainText('contrato 9');
});
