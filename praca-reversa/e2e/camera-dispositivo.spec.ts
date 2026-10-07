import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entrar } from './apoio';
import { videoDoCodigo } from './camera-falsa';
import { credenciais } from './credenciais';

/**
 * Etapa 09 — câmera pelo getUserMedia real do Chrome, com o dispositivo falso
 * do navegador alimentado por um vídeo Y4M com o QR de um palete da
 * demonstração (dados fictícios). Comprova pedido de permissão, vídeo,
 * decodificação local e abertura do palete autenticado. Não substitui teste
 * em aparelho físico.
 */
const VIDEO = join(tmpdir(), `praca-camera-qr-${String(process.pid)}.y4m`);

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO}`] },
  permissions: ['camera'],
});

let paleteId = '';
let codigo = '';

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL: String(baseURL) });
  const { login, senha } = credenciais().consulta;
  expect((await api.post('/api/v1/sessao', { data: { login, senha } })).ok()).toBe(true);
  const praca = (await (await api.get('/api/v1/praca')).json()) as { pallets: { id: string; code: string; positionId: string | null }[] };
  const palete = praca.pallets.find((p) => p.positionId !== null);
  if (!palete) throw new Error('Sem palete de demonstração.');
  paleteId = palete.id;
  codigo = palete.code;
  await api.dispose();
  await videoDoCodigo(VIDEO, `${String(baseURL)}/paletes/${paleteId}`, 'QRCode');
});

test('câmera do navegador (dispositivo falso do Chrome) lê o QR do palete e abre o palete autenticado', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Dispositivo falso configurado no perfil de computador.');
  await entrar(page, 'consulta');
  await page.getByTestId('ler-codigo-praca').click();
  await expect(page.getByTestId('leitura-palete')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('valor-lido')).toContainText(`/paletes/${paleteId}`);
  await page.getByTestId('abrir-palete-lido').click();
  await expect(page).toHaveURL(new RegExp(`/paletes/${paleteId}$`));
  await expect(page.getByTestId('detalhe')).toContainText(codigo);
  await expect(page.getByTestId('leitor-camera')).toHaveCount(0);
});
