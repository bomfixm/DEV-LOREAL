import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { credenciais, type Credenciais } from './credenciais';

export interface PaleteApi {
  id: string;
  code: string;
  positionId: string | null;
  positionCode: string | null;
  countState: string;
  activeCountId?: string | null;
}

export interface PosicaoApi {
  id: string;
  code: string;
  available: boolean;
  rowId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PracaApi {
  scope: { id: string; name: string; demo: boolean };
  layout: {
    totalCapacity: number | null;
    rows: { id: string; code: string; label: string; order: number; y: number; labelBox: { x: number; y: number; width: number; height: number } }[];
    elements: { code: string; kind: string; label: string; labelBox: { x: number; y: number; width: number; height: number } | null }[];
    positions: PosicaoApi[];
  };
  pallets: PaleteApi[];
}

export function ehCelular(testInfo: TestInfo): boolean {
  return testInfo.project.name === 'celular';
}

/** Entra pela tela de login, como um usuário faria. */
export async function entrar(page: Page, quem: keyof Credenciais): Promise<void> {
  const { login, senha } = credenciais()[quem];
  await page.goto('/');
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByTestId('menu-conta')).toBeVisible();
}

/** Praça do escopo ativo, pela mesma sessão do navegador. */
export async function obterPraca(page: Page): Promise<PracaApi> {
  const resposta = await page.request.get('/api/v1/praca');
  expect(resposta.ok()).toBe(true);
  return (await resposta.json()) as PracaApi;
}

export function mapa(page: Page): Locator {
  return page.getByTestId('mapa');
}

export function forma(page: Page, codigo: string): Locator {
  return page.locator(`path[data-codigo="${codigo}"]`);
}

export async function aguardarMapa(page: Page): Promise<void> {
  await expect(mapa(page)).toHaveAttribute('data-zoom', /-?\d/);
  await expect(page.locator('path[data-palete-id]').first()).toBeAttached();
}

export async function entrarNoMapa(page: Page, quem: keyof Credenciais): Promise<void> {
  await entrar(page, quem);
  await aguardarMapa(page);
}

/** Troca o escopo ativo pelo menu da conta. */
export async function abrirMenuConta(page: Page): Promise<void> {
  const menu = page.getByTestId('menu-conta');
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await expect(menu.locator('.menu-conta-painel')).toBeVisible();
}

export async function trocarEscopo(page: Page, nome: string): Promise<void> {
  await abrirMenuConta(page);
  await page.getByLabel('Unidade / cliente').selectOption({ label: nome });
  await expect(page.getByTestId('menu-conta').locator('summary')).toContainText(nome.split(' — ')[0] ?? nome);
  await aguardarMapa(page);
}

export async function zoom(page: Page): Promise<number> {
  return Number(await mapa(page).getAttribute('data-zoom'));
}

export async function centro(page: Page): Promise<{ x: number; y: number }> {
  const el = mapa(page);
  return {
    x: Number(await el.getAttribute('data-centro-x')),
    y: Number(await el.getAttribute('data-centro-y')),
  };
}

/**
 * Aguarda o fim de animações: o mapa marca `data-movendo` entre movestart e
 * moveend; considera parado quando a marca some e a visão não muda mais.
 */
export async function aguardarMapaParado(page: Page): Promise<void> {
  let anterior = '';
  await expect
    .poll(
      async () =>
        mapa(page).evaluate((el) => {
          if (el.hasAttribute('data-movendo')) return '';
          return `${el.getAttribute('data-zoom') ?? ''}|${el.getAttribute('data-centro-x') ?? ''}|${el.getAttribute('data-centro-y') ?? ''}`;
        }).then((atual) => {
          const parado = atual !== '' && atual === anterior;
          anterior = atual;
          return parado;
        }),
      { intervals: [100, 150, 200, 250, 300] },
    )
    .toBe(true);
}

export async function focarArea(page: Page, nome: string): Promise<void> {
  await page.getByLabel('Ir para bloco ou zona').selectOption({ label: nome });
  await aguardarMapaParado(page);
}

export async function centroDaCaixa(locator: Locator): Promise<{ x: number; y: number }> {
  const caixa = await locator.boundingBox();
  if (!caixa) throw new Error('Elemento sem caixa visível.');
  return { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 };
}

/** Pinça com dois toques via protocolo do Chromium (emulação de toque). */
export async function pinca(
  page: Page,
  centroTela: { x: number; y: number },
  distanciaInicial: number,
  distanciaFinal: number,
  final: 'touchEnd' | 'touchCancel' = 'touchEnd',
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const pontos = (d: number) => [
    { x: centroTela.x - d / 2, y: centroTela.y, id: 1 },
    { x: centroTela.x + d / 2, y: centroTela.y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pontos(distanciaInicial) });
  const passos = 10;
  for (let i = 1; i <= passos; i++) {
    const d = distanciaInicial + ((distanciaFinal - distanciaInicial) * i) / passos;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pontos(d) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: final, touchPoints: [] });
  await cdp.detach();
}

/** Lê largura e altura do cabeçalho IHDR de um PNG. */
export function dimensoesPng(conteudo: Buffer): { largura: number; altura: number } {
  const assinatura = conteudo.subarray(0, 8).toString('hex');
  if (assinatura !== '89504e470d0a1a0a') throw new Error('Arquivo não é PNG.');
  return { largura: conteudo.readUInt32BE(16), altura: conteudo.readUInt32BE(20) };
}

/** Retângulos de tela que se cruzam. */
export function cruzam(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Decodifica um QR a partir de uma captura PNG (como a câmera leria a etiqueta). */
export function decodificarQr(png: Buffer): string | null {
  const imagem = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(imagem.data), imagem.width, imagem.height)?.data ?? null;
}

/** Faixa externa da imagem toda branca (zona de silêncio do QR), com tolerância de antisserrilhado. */
export function bordaBranca(png: Buffer, fracao: number): boolean {
  const imagem = PNG.sync.read(png);
  const faixaX = Math.floor(imagem.width * fracao);
  const faixaY = Math.floor(imagem.height * fracao);
  for (let y = 0; y < imagem.height; y++) {
    for (let x = 0; x < imagem.width; x++) {
      const dentro = x >= faixaX && x < imagem.width - faixaX && y >= faixaY && y < imagem.height - faixaY;
      if (dentro) continue;
      const i = (y * imagem.width + x) * 4;
      if ((imagem.data[i] ?? 0) < 200 || (imagem.data[i + 1] ?? 0) < 200 || (imagem.data[i + 2] ?? 0) < 200) return false;
    }
  }
  return true;
}
