import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { aguardarMapaParado, entrar, focarArea, obterPraca } from './apoio';

/**
 * Vista inicial do mapa (20 out. 2026): ao entrar, a área da L'Oréal (zona
 * de baixo do desenho aprovado, com as posições vazias) ocupa o espaço livre
 * entre os controles, com os endereços legíveis; as posições superiores
 * continuam acessíveis ("Ver praça completa"); a navegação do usuário não é
 * reiniciada ao abrir/fechar a janela do palete nem ao recolher o menu; o
 * link de um palete o localiza normalmente. Dados fictícios da demonstração.
 */
const PASTA = 'docs/capturas/mapa-inicial';
const capturar = (tags: readonly string[]) => tags.includes('@captura') || process.env.CAPTURAR === '1';

const mapa = (page: Page) => page.getByTestId('mapa');

async function vista(page: Page) {
  const m = mapa(page);
  return {
    zoom: Number(await m.getAttribute('data-zoom')),
    x: Number(await m.getAttribute('data-centro-x')),
    y: Number(await m.getAttribute('data-centro-y')),
    enquadramento: await m.getAttribute('data-enquadramento'),
  };
}

/** Medidas da vista: zona principal (a de baixo), controles sobrepostos e rótulos de endereço. */
async function medir(page: Page) {
  return mapa(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const rel = (b: DOMRect) => ({ esquerda: b.left - r.left, topo: b.top - r.top, direita: b.right - r.left, base: b.bottom - r.top });
    const zonas = [...el.querySelectorAll('path.pr-elemento--ZONA')].map((p) => rel(p.getBoundingClientRect())).sort((a, b) => b.topo - a.topo);
    const sobrepostos = [...(el.parentElement?.querySelectorAll(':scope > .ferramentas-mapa, :scope > .legenda, :scope > .controles-mapa, :scope > .marca-demo') ?? [])].map((o) => rel(o.getBoundingClientRect()));
    const dentro = (b: { esquerda: number; topo: number; direita: number; base: number }) => b.esquerda >= -0.5 && b.topo >= -0.5 && b.direita <= r.width + 0.5 && b.base <= r.height + 0.5;
    const rotulos = [...el.querySelectorAll<HTMLElement>('.pr-rotulo-endereco--curto, .pr-rotulo-endereco--principal')].filter((e) => e.offsetParent !== null && getComputedStyle(e).display !== 'none');
    // Fora da vista o Leaflet recorta a forma (caminho vazio, tamanho zero): conta só as desenhadas inteiras na tela.
    const desativadasNaTela = [...el.querySelectorAll('path.pr-posicao--desativada')].filter((p) => {
      const b = p.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && dentro(rel(b));
    }).length;
    return {
      largura: r.width,
      altura: r.height,
      principal: zonas[0] ?? null,
      sobrepostos,
      rotulos: rotulos.length,
      cortados: rotulos.filter((e) => e.scrollWidth > e.clientWidth + 0.5).map((e) => e.textContent),
      menorFonte: Math.min(...rotulos.map((e) => Number.parseFloat(getComputedStyle(e).fontSize))),
      desativadasNaTela,
    };
  });
}

const cruza = (a: { esquerda: number; topo: number; direita: number; base: number }, b: typeof a) => a.esquerda < b.direita && b.esquerda < a.direita && a.topo < b.base && b.topo < a.base;

async function abrir(page: Page, testInfo: TestInfo, largura: number, altura: number) {
  test.skip(testInfo.project.name !== 'computador', 'Enquadramento do computador (1366×768 e 1920×1080).');
  await page.setViewportSize({ width: largura, height: altura });
  await entrar(page, 'consulta');
  await expect(mapa(page)).toHaveAttribute('data-enquadramento', 'principal');
  await aguardarMapaParado(page);
}

test.describe('Vista inicial do mapa: foco na área da L’Oréal', () => {
  for (const [largura, altura] of [
    [1366, 768],
    [1920, 1080],
  ] as const) {
    test(`${String(largura)}×${String(altura)}: área principal inteira e legível, praça completa acessível @captura`, async ({ page }, testInfo) => {
      await abrir(page, testInfo, largura, altura);
      const m = await medir(page);
      if (!m.principal) throw new Error('Sem a zona principal.');
      // A área inteira (com as posições vazias) na tela, fora dos controles sobrepostos, usando a altura disponível.
      expect(m.principal.topo).toBeGreaterThanOrEqual(0);
      expect(m.principal.base).toBeLessThanOrEqual(m.altura);
      expect(m.principal.esquerda).toBeGreaterThanOrEqual(0);
      expect(m.principal.direita).toBeLessThanOrEqual(m.largura);
      for (const s of m.sobrepostos) expect(cruza(m.principal, s), `controle sobre a área: ${JSON.stringify(s)}`).toBe(false);
      expect((m.principal.base - m.principal.topo) / m.altura).toBeGreaterThan(0.85);
      // Endereços em todas as posições da área, sem corte e com fonte legível; as superiores fora da vista.
      expect(m.rotulos).toBeGreaterThanOrEqual(194);
      expect(m.cortados).toEqual([]);
      expect(m.menorFonte).toBeGreaterThanOrEqual(10);
      expect(m.desativadasNaTela).toBe(0);
      if (capturar(testInfo.tags)) {
        mkdirSync(PASTA, { recursive: true });
        await page.screenshot({ path: `${PASTA}/${String(largura)}x${String(altura)}-inicial.png` });
      }
      const inicial = await vista(page);

      // Ver praça completa: as posições superiores entram na vista (nada é alterado).
      await page.getByRole('button', { name: 'Ver praça completa' }).click();
      await aguardarMapaParado(page);
      await expect(mapa(page)).toHaveAttribute('data-enquadramento', 'completo');
      expect((await medir(page)).desativadasNaTela).toBe(300);
      expect((await vista(page)).zoom).toBeLessThan(inicial.zoom);
      if (capturar(testInfo.tags)) await page.screenshot({ path: `${PASTA}/${String(largura)}x${String(altura)}-praca-completa.png` });

      // Focar L'Oréal: volta ao enquadramento inicial.
      await page.getByRole('button', { name: "Focar L'Oréal" }).click();
      await aguardarMapaParado(page);
      const deVolta = await vista(page);
      expect(Math.abs(deVolta.zoom - inicial.zoom)).toBeLessThan(0.02);
      expect(Math.abs(deVolta.x - inicial.x)).toBeLessThan(2);
      expect(Math.abs(deVolta.y - inicial.y)).toBeLessThan(2);
    });
  }

  test('a navegação do usuário não reinicia: janela do palete e menu recolhido mantêm zoom e centro', async ({ page }, testInfo) => {
    await abrir(page, testInfo, 1366, 768);
    // Navegação do usuário: ir para um bloco (os paletes da demonstração ficam nele).
    await focarArea(page, 'Fileira 11 · FB01');
    await expect(mapa(page)).toHaveAttribute('data-enquadramento', 'elemento');
    const navegada = await vista(page);
    // Abrir e fechar a janela de um palete.
    await page.locator('path[data-palete-id]').first().click();
    await expect(page.getByTestId('janela-palete')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('janela-palete')).toHaveCount(0);
    await aguardarMapaParado(page);
    expect(await vista(page)).toMatchObject({ zoom: navegada.zoom, x: navegada.x, y: navegada.y });
    // Expandir e recolher o menu: muda a largura do mapa, não o zoom nem o ponto central.
    for (let i = 0; i < 2; i++) {
      await page.getByTestId('alternar-menu').click();
      await aguardarMapaParado(page);
      const agora = await vista(page);
      expect(agora.zoom).toBe(navegada.zoom);
      expect(Math.abs(agora.x - navegada.x)).toBeLessThan(1.5);
      expect(Math.abs(agora.y - navegada.y)).toBeLessThan(1.5);
    }
  });

  test('link do palete ao abrir a página: localiza o palete (não volta à área principal)', async ({ page }, testInfo) => {
    await abrir(page, testInfo, 1366, 768);
    const praca = await obterPraca(page);
    const alvo = praca.pallets.find((p) => p.positionId !== null);
    if (!alvo) throw new Error('Sem palete no mapa.');
    await page.goto(`/paletes/${alvo.id}`);
    await expect(page.getByTestId('janela-titulo')).toHaveText(`Palete ${alvo.code}`);
    await expect(mapa(page)).toHaveAttribute('data-enquadramento', 'palete');
    await aguardarMapaParado(page);
    expect((await vista(page)).zoom).toBeGreaterThanOrEqual(0.75);
  });
});
