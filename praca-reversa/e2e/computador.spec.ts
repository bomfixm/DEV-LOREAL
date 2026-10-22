import { expect, test, type Page } from '@playwright/test';
import { mostrarListaPaletesNoMapa } from '../apps/web/src/features/mapa/configuracao';
import {
  aguardarMapaParado,
  centro,
  centroDaCaixa,
  cruzam,
  entrarNoMapa,
  focarArea,
  forma,
  mapa,
  obterPraca,
  resumo,
  verMais,
  zoom,
} from './apoio';

test.skip(({ isMobile }) => isMobile, 'Fluxos do layout de computador.');

// Desenho aprovado: PAL-DEMO-001…003 na Fileira 11 (F01); 004…006 na Fileira 12 (F02).
const INICIO = 'Fileira 11 · FB01';
const PAR_15 = 'Fileira 12 · FB02';
const detalhe = (page: Page) => page.getByTestId('detalhe');

/**
 * Escolhe o palete pela lista (coluna ativa) ou, com a lista desativada no
 * computador (D254), pela pesquisa do cabeçalho ("Ver no mapa"). Nos dois
 * casos o mapa centraliza e a janela do palete abre (etapa 3).
 */
async function escolherNaLista(page: Page, codigo: string): Promise<void> {
  if (mostrarListaPaletesNoMapa) {
    await page.getByLabel('Código, posição ou link do QR').fill(codigo);
    await expect(page.locator(`.item-palete[data-codigo="${codigo}"]`)).toBeVisible();
    await page.locator(`.item-palete[data-codigo="${codigo}"]`).click();
  } else {
    await page.getByTestId('campo-busca').fill(codigo);
    await page.locator(`[data-testid="resultado-busca"][data-palete="${codigo}"]`).first().getByTestId('resultado-abrir').click();
  }
  await expect(page.getByTestId('janela-palete')).toBeVisible();
}

/** Fecha a janela do palete (Esc), mantendo a seleção. */
async function fecharJanela(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('janela-palete')).toHaveCount(0);
}

/** Títulos visíveis (não ocultos por falta de espaço) e alvos de seleção na tela. */
async function titulosSobreAlvos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visiveis = [...document.querySelectorAll<HTMLElement>('.pr-rotulo-caixa')].filter(
      (el) => getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none',
    );
    const alvos = [...document.querySelectorAll('path[data-palete-id], path[data-posicao]')].map((p) => p.getBoundingClientRect());
    const cruza = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    return visiveis.filter((el) => alvos.some((r) => cruza(el.getBoundingClientRect(), r))).map((el) => el.textContent);
  });
}

test.describe('desenho aprovado: Fileiras 11–16 e GR, área desativada', () => {
  test.beforeEach(async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
  });

  test('faixas da esquerda para a direita, pares próximos, blocos separados e área desativada fora da capacidade', async ({ page }) => {
    const praca = await obterPraca(page);
    expect(praca.layout.totalCapacity).toBeNull();
    const porFileira = await page.locator('path[data-posicao]').evaluateAll((els) => {
      const contagem: Record<string, number> = {};
      for (const el of els) {
        const fileira = (el.getAttribute('data-posicao') ?? '').split('-')[0] ?? '';
        contagem[fileira] = (contagem[fileira] ?? 0) + 1;
      }
      return contagem;
    });
    const ativas = ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12'];
    expect(ativas.map((f) => porFileira[f])).toEqual([17, 17, 17, 17, 17, 17, 17, 15, 15, 15, 15, 15]);
    expect(Object.keys(porFileira).filter((f) => f.startsWith('D')).every((f) => porFileira[f] === 25)).toBe(true);

    // Faixas verticais: x cresce da Fileira 11 até a GR; dentro do par as faixas ficam mais próximas que entre blocos.
    const esquerda = async (codigo: string) => (await page.locator(`path[data-posicao="${codigo}"]`).boundingBox())?.x ?? 0;
    const xs = await Promise.all(ativas.map((f) => esquerda(`${f}-P01`)));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const passo = (i: number) => (xs[i + 1] ?? 0) - (xs[i] ?? 0);
    const dentroDoPar = Math.max(passo(1), passo(3), passo(5), passo(7), passo(9));
    const entreBlocos = Math.min(passo(0), passo(2), passo(4), passo(6), passo(8), passo(10));
    expect(dentroDoPar).toBeLessThan(entreBlocos);

    // Posições sem palete: ocupação desconhecida (não "vazia"); área desativada identificada à parte.
    await expect(page.locator('path.pr-posicao--desconhecida')).toHaveCount(194);
    await expect(page.locator('path.pr-posicao--desativada')).toHaveCount(300);
    await expect(page.getByTestId('nota-layout')).toContainText('Capacidade total ainda desconhecida');
  });

  test('títulos de bloco e rótulos de fileira não cobrem alvos de seleção, na visão geral e no zoom', async ({ page }) => {
    expect(await titulosSobreAlvos(page)).toEqual([]);
    await focarArea(page, PAR_15);
    expect(await titulosSobreAlvos(page)).toEqual([]);
    await expect(page.locator('.pr-rotulo-fileira', { hasText: 'F02' })).toBeVisible();
    // Zoom de consulta (centralizar pela lista): títulos continuam fora dos alvos.
    await escolherNaLista(page, 'PAL-DEMO-005');
    await fecharJanela(page);
    await aguardarMapaParado(page);
    expect(await titulosSobreAlvos(page)).toEqual([]);
    // Códigos legíveis e ocupação desconhecida identificada por texto.
    await expect(page.locator('.pr-rotulo-palete', { hasText: 'PAL-DEMO-005' })).toBeVisible();
    await expect(page.locator('.pr-rotulo-posicao', { hasText: 'ocupação desconhecida' }).first()).toBeVisible();
  });
});

test.describe('seleção e conteúdo', () => {
  test.beforeEach(async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
  });

  test('palete não conferido mostra conteúdo desconhecido, sem quantidade presumida', async ({ page }) => {
    await focarArea(page, INICIO);
    await forma(page, 'PAL-DEMO-002').click();
    // Etapa 3: o clique abre a janela; os detalhes completos ficam recolhidos nela.
    await expect(resumo(page).getByTestId('janela-titulo')).toHaveText('Palete PAL-DEMO-002');
    await expect(detalhe(page)).toHaveCount(0);
    await verMais(page);
    await expect(detalhe(page)).toContainText('Posição F01-P02');
    await expect(detalhe(page)).toContainText('código provisório');
    await expect(page.getByTestId('conteudo-desconhecido')).toContainText('Nenhuma quantidade física é presumida');
    await expect(detalhe(page).locator('.item-conteudo')).toHaveCount(0);
    await expect(detalhe(page)).not.toContainText(/\b0 UN\b/);
  });

  test('reconciliado mostra o saldo validado do palete correto', async ({ page }) => {
    await focarArea(page, INICIO);
    await forma(page, 'PAL-DEMO-001').click();
    await verMais(page);
    const saldo = page.getByTestId('itens-saldo');
    await expect(saldo).toContainText('Shampoo');
    await expect(saldo).toContainText('24 UN');
    await expect(saldo).toContainText('12 UN');
  });

  test('conferência parcial não aparece como completa', async ({ page }) => {
    await focarArea(page, PAR_15);
    await forma(page, 'PAL-DEMO-005').click();
    await verMais(page);
    await expect(page.getByTestId('conteudo-parcial')).toContainText('não é saldo validado');
    const observados = page.getByTestId('itens-observados');
    await expect(observados).toContainText('6 UN');
    await expect(observados).toContainText('Lote pendente');
    await expect(observados).toContainText('Origem pendente');
    await expect(page.getByTestId('itens-saldo')).toHaveCount(0);
  });

  test('aguardando validação separa observado e declarado', async ({ page }) => {
    await focarArea(page, INICIO);
    await forma(page, 'PAL-DEMO-003').click();
    await verMais(page);
    await expect(page.getByTestId('itens-observados')).toContainText('9 UN');
    await expect(page.getByTestId('itens-declarados')).toContainText('12 UN');
    await expect(page.getByTestId('itens-declarados')).toContainText('não comprova presença física');
    await expect(detalhe(page)).toContainText('Bloqueado');
  });

  test('seleções rápidas e repetidas terminam no conteúdo do último palete', async ({ page }) => {
    const praca = await obterPraca(page);
    // A janela cobre o mapa: os cliques rápidos chegam direto às formas (como trocas de rota seguidas).
    for (const codigo of ['PAL-DEMO-001', 'PAL-DEMO-002', 'PAL-DEMO-006', 'PAL-DEMO-001', 'PAL-DEMO-004']) {
      await forma(page, codigo).dispatchEvent('click');
    }
    const ultimo = praca.pallets.find((p) => p.code === 'PAL-DEMO-004');
    await expect(resumo(page).getByTestId('janela-titulo')).toHaveText('Palete PAL-DEMO-004');
    await verMais(page);
    await expect(detalhe(page)).toHaveAttribute('data-palete-id', String(ultimo?.id));
    await expect(page.getByTestId('itens-saldo')).toContainText('Creme capilar');
    await expect(page.getByTestId('itens-saldo')).toContainText('36 UN');
    await expect(page.locator('path.pr-palete--selecionado')).toHaveCount(1);
    if (mostrarListaPaletesNoMapa) await expect(page.locator('.item-palete[aria-current="true"]')).toHaveAttribute('data-codigo', 'PAL-DEMO-004');
  });

  test('erro ao carregar o detalhe é informado e pode ser repetido', async ({ page }) => {
    await page.route('**/api/v1/paletes/**', (rota) => rota.fulfill({ status: 500, body: '' }));
    await forma(page, 'PAL-DEMO-001').click();
    await verMais(page);
    await expect(detalhe(page).getByRole('alert')).toContainText('Não foi possível carregar o conteúdo');
    await page.unroute('**/api/v1/paletes/**');
    await detalhe(page).getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByTestId('itens-saldo')).toContainText('24 UN');
  });
});

test.describe('navegação do mapa', () => {
  test('botões, roda do mouse e visão geral alteram só a câmera; nenhuma gravação é enviada', async ({ page }) => {
    const metodos: string[] = [];
    await entrarNoMapa(page, 'consulta');
    page.on('request', (r) => {
      if (r.url().includes('/api/')) metodos.push(r.method());
    });
    const antes = await obterPraca(page);
    const inicial = await zoom(page);

    await page.getByRole('button', { name: 'Ampliar' }).click();
    await expect.poll(() => zoom(page)).toBeGreaterThan(inicial);
    await aguardarMapaParado(page);
    const ampliado = await zoom(page);
    await page.getByRole('button', { name: 'Reduzir' }).click();
    await expect.poll(() => zoom(page)).toBeLessThan(ampliado);

    const caixa = await mapa(page).boundingBox();
    if (!caixa) throw new Error('Mapa sem caixa.');
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await aguardarMapaParado(page);
    const antesRoda = await zoom(page);
    await page.mouse.wheel(0, -600);
    await expect.poll(() => zoom(page)).toBeGreaterThan(antesRoda);
    await aguardarMapaParado(page);

    // Vista inicial = área da L'Oréal ("Focar L'Oréal" volta a ela); a praça completa fica mais afastada.
    await page.getByRole('button', { name: "Focar L'Oréal" }).click();
    await aguardarMapaParado(page);
    expect(Math.abs((await zoom(page)) - inicial)).toBeLessThan(0.01);
    await page.getByRole('button', { name: 'Ver praça completa' }).click();
    await aguardarMapaParado(page);
    expect(await zoom(page)).toBeLessThan(inicial);

    const depois = await obterPraca(page);
    expect(depois.pallets).toEqual(antes.pallets);
    expect(depois.layout).toEqual(antes.layout);
    // Navegar não envia nenhuma requisição de gravação (normalmente nenhuma requisição).
    expect(metodos.filter((m) => m !== 'GET')).toEqual([]);
  });

  test('zoom pela roda mantém o ponto sob o cursor', async ({ page }) => {
    await entrarNoMapa(page, 'consultaNavegacao');
    await focarArea(page, 'Zona Norte (fictícia)');
    const alvo = page.locator('path[data-palete-id]').nth(40);
    const antes = await centroDaCaixa(alvo);
    await page.mouse.move(antes.x, antes.y);
    const zoomAntes = await zoom(page);
    await page.mouse.wheel(0, -360);
    await expect.poll(() => zoom(page)).toBeGreaterThan(zoomAntes);
    await aguardarMapaParado(page);
    const depois = await centroDaCaixa(alvo);
    expect(Math.abs(depois.x - antes.x)).toBeLessThan(12);
    expect(Math.abs(depois.y - antes.y)).toBeLessThan(12);
  });

  test('arrastar começando sobre um palete move a visão sem selecionar', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await focarArea(page, INICIO);
    const inicio = await centroDaCaixa(forma(page, 'PAL-DEMO-002'));
    const centroAntes = await centro(page);
    await page.mouse.move(inicio.x, inicio.y);
    await page.mouse.down();
    await page.mouse.move(inicio.x + 160, inicio.y + 90, { steps: 12 });
    await page.mouse.up();
    await aguardarMapaParado(page);

    // Sem seleção, o painel da seleção não ocupa espaço.
    await expect(page.locator('.painel-detalhe')).toHaveCount(0);
    await expect(page.locator('path.pr-palete--selecionado')).toHaveCount(0);
    const centroDepois = await centro(page);
    expect(Math.abs(centroDepois.x - centroAntes.x) + Math.abs(centroDepois.y - centroAntes.y)).toBeGreaterThan(30);

    const z = await zoom(page);
    await page.getByRole('button', { name: 'Ampliar' }).click();
    await expect.poll(() => zoom(page)).toBeGreaterThan(z);
    await forma(page, 'PAL-DEMO-002').click();
    await expect(resumo(page)).toContainText('PAL-DEMO-002');
  });

  test('limites de deslocamento permitem recuperar a praça', async ({ page }) => {
    await entrarNoMapa(page, 'consultaNavegacao');
    const caixa = await mapa(page).boundingBox();
    if (!caixa) throw new Error('Mapa sem caixa.');
    for (let i = 0; i < 4; i++) {
      await page.mouse.move(caixa.x + 40, caixa.y + 120);
      await page.mouse.down();
      await page.mouse.move(caixa.x + caixa.width - 20, caixa.y + caixa.height - 20, { steps: 8 });
      await page.mouse.up();
    }
    await aguardarMapaParado(page);
    const naTela = await page.locator('path[data-palete-id]').evaluateAll(
      (els, area: { x: number; y: number; width: number; height: number }) =>
        els.filter((e) => {
          const r = e.getBoundingClientRect();
          return r.right > area.x && r.left < area.x + area.width && r.bottom > area.y && r.top < area.y + area.height;
        }).length,
      caixa,
    );
    expect(naTela).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Ver praça completa' }).click();
    await aguardarMapaParado(page);
    const praca = await obterPraca(page);
    const totalNoMapa = praca.pallets.filter((p) => p.positionId !== null).length;
    const dentro = await page.locator('path[data-palete-id]').evaluateAll(
      (els, area: { x: number; y: number; width: number; height: number }) =>
        els.filter((e) => {
          const r = e.getBoundingClientRect();
          return r.left >= area.x - 1 && r.right <= area.x + area.width + 1 && r.top >= area.y - 1 && r.bottom <= area.y + area.height + 1;
        }).length,
      caixa,
    );
    expect(dentro).toBe(totalNoMapa);
  });

  test('teclado: lista percorrida com setas, Enter seleciona; mapa responde a +, setas e Home', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    if (mostrarListaPaletesNoMapa) {
      await page.locator('.item-palete[tabindex="0"]').focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('.item-palete:focus')).toHaveAttribute('data-codigo', 'PAL-DEMO-003');
      await page.keyboard.press('Enter');
      await expect(resumo(page)).toContainText('PAL-DEMO-003');
      await expect(page.locator('.item-palete[aria-current="true"]')).toHaveAttribute('data-codigo', 'PAL-DEMO-003');
      await fecharJanela(page);
      await aguardarMapaParado(page);
    } else {
      // Sem a lista: aproxima uma área para haver para onde deslocar com as setas.
      await focarArea(page, INICIO);
    }

    await mapa(page).focus();
    const z = await zoom(page);
    await page.keyboard.press('NumpadAdd');
    await expect.poll(() => zoom(page)).toBeGreaterThan(z);
    await aguardarMapaParado(page);
    const antes = await centro(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await centro(page)).x).toBeGreaterThan(antes.x);
    await aguardarMapaParado(page);
    await page.keyboard.press('Home');
    await aguardarMapaParado(page);
    expect(await zoom(page)).toBeLessThan(z);
  });
});

test.describe('lista, filtro no servidor e redimensionamento', () => {
  test('escolher na lista centraliza um palete distante em nível legível', async ({ page }) => {
    await entrarNoMapa(page, 'consultaNavegacao');
    const praca = await obterPraca(page);
    const posicoes = new Map(praca.layout.positions.map((p) => [p.id, p]));
    const distante = [...praca.pallets].reverse().find((p) => p.positionCode?.startsWith('R-'));
    if (!distante?.positionId) throw new Error('Palete distante não encontrado.');
    const posicao = posicoes.get(distante.positionId);
    if (!posicao) throw new Error('Posição não encontrada.');

    await escolherNaLista(page, distante.code);
    await aguardarMapaParado(page);
    await expect(resumo(page)).toContainText(distante.code);
    await fecharJanela(page);
    expect(await zoom(page)).toBeGreaterThanOrEqual(0.75);
    const c = await centro(page);
    expect(Math.abs(c.x - (posicao.x + posicao.width / 2))).toBeLessThan(2);
    expect(Math.abs(c.y - (posicao.y + posicao.height / 2))).toBeLessThan(2);
    const noMapa = await centroDaCaixa(forma(page, distante.code));
    const centroMapa = await centroDaCaixa(mapa(page));
    expect(Math.abs(noMapa.x - centroMapa.x)).toBeLessThan(4);
    expect(Math.abs(noMapa.y - centroMapa.y)).toBeLessThan(4);
    await expect(page.locator('.pr-rotulo-palete--selecionado')).toContainText(distante.code);
  });

  test('redimensionar a janela preserva o centro e a seleção', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await escolherNaLista(page, 'PAL-DEMO-005');
    await fecharJanela(page);
    await aguardarMapaParado(page);
    const antes = await centro(page);
    await page.setViewportSize({ width: 1100, height: 760 });
    await aguardarMapaParado(page);
    const depois = await centro(page);
    expect(Math.abs(depois.x - antes.x)).toBeLessThan(1.5);
    expect(Math.abs(depois.y - antes.y)).toBeLessThan(1.5);
    const noMapa = await centroDaCaixa(forma(page, 'PAL-DEMO-005'));
    const centroMapa = await centroDaCaixa(mapa(page));
    expect(Math.abs(noMapa.x - centroMapa.x)).toBeLessThan(4);
    expect(Math.abs(noMapa.y - centroMapa.y)).toBeLessThan(4);
    await expect(page.locator('path.pr-palete--selecionado')).toHaveAttribute('data-codigo', 'PAL-DEMO-005');
  });

  test('filtro consultado no servidor: lista (ou filtro do mapa) e mapa mostram o mesmo resultado', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    if (!mostrarListaPaletesNoMapa) await page.getByTestId('filtro-mapa').locator('summary').click();
    const consultas: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/paletes?')) consultas.push(r.url());
    });
    await page.getByLabel('Código, posição ou link do QR').fill('f02-p0');
    if (mostrarListaPaletesNoMapa) await expect(page.locator('.item-palete')).toHaveCount(3);
    else await expect(page.getByTestId('contagem-lista')).toContainText('3 de 3');
    await expect(page.locator('path[data-palete-id]:not(.pr-palete--esmaecido)')).toHaveCount(3);
    expect(consultas.some((u) => u.includes('texto=f02-p0'))).toBe(true);
    // A caixa de seleção (o filtro 'Precisam de reconferência' também tem 'conferência' no rótulo).
    await page.locator(mostrarListaPaletesNoMapa ? '.painel-modo' : '.filtro-mapa-painel').getByRole('combobox', { name: /^Conferência/ }).selectOption('PARCIAL');
    if (mostrarListaPaletesNoMapa) await expect(page.locator('.item-palete')).toHaveCount(1);
    await expect(page.locator('path[data-palete-id]:not(.pr-palete--esmaecido)')).toHaveCount(1);
    await expect(page.locator('path[data-palete-id]:not(.pr-palete--esmaecido)')).toHaveAttribute('data-codigo', 'PAL-DEMO-005');
    await page.getByRole('button', { name: 'Limpar filtro' }).click();
    await expect(page.locator('path.pr-palete--esmaecido')).toHaveCount(0);
    if (mostrarListaPaletesNoMapa) await expect(page.locator('.item-palete')).toHaveCount(6);
  });

  test('palete sem posição fica em localização pendente e não pode ser centralizado', async ({ page }) => {
    await entrarNoMapa(page, 'consultaNavegacao');
    await escolherNaLista(page, 'PAL-DEMO-343');
    await expect(resumo(page).getByTestId('janela-endereco')).toHaveText('Endereço não informado');
    await expect(resumo(page).getByTestId('janela-centralizar')).toBeDisabled();
    await verMais(page);
    await expect(detalhe(page)).toContainText('Localização pendente');
    await expect(page.locator('.controles-mapa').getByRole('button', { name: 'Centralizar', exact: true })).toBeDisabled();
    await expect(page.getByTestId('conteudo-desconhecido')).toBeVisible();
  });

  test('cenário de navegação: posição sem palete aparece como "sem palete registrado"', async ({ page }) => {
    await entrarNoMapa(page, 'consultaNavegacao');
    await expect(page.locator('path.pr-posicao--desconhecida')).toHaveCount(0);
    expect(await page.locator('path.pr-posicao--sem-registro').count()).toBe(384 - 6);
    expect(await titulosSobreAlvos(page)).toEqual([]);
    await focarArea(page, 'Zona Sul (fictícia)');
    expect(await titulosSobreAlvos(page)).toEqual([]);
    const norte = page.locator('.pr-titulo--ZONA', { hasText: 'Zona Norte' });
    const sul = page.locator('.pr-titulo--ZONA', { hasText: 'Zona Sul' });
    const [caixaNorte, caixaSul] = [await norte.boundingBox(), await sul.boundingBox()];
    if (caixaNorte && caixaSul) expect(cruzam(caixaNorte, caixaSul)).toBe(false);
  });
});
