import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ehCelular, entrar, obterPraca } from './apoio';

/**
 * Importar a bipagem "Etiquetas" pela interface (21 out. 2026, D283–D288), no
 * escopo de cadastro do E2E (dados fictícios no layout da exportação real):
 * arquivo → prévia (notas, volumes, sem volumes; CNPJ e Última Leitura em
 * "Mais informações") → posição livre no mapa → palete novo numerado na
 * confirmação → o mesmo arquivo de novo no palete: aviso de importação
 * anterior, "nova operação", notas repetidas com Revalidar e Importar
 * separadamente. As capturas (@captura) gravam docs/capturas/bipagem-etiquetas.
 */
const PASTA = 'docs/capturas/bipagem-etiquetas';
const CAB = ['Status', 'Baixa indevida', 'Tipo', 'Número', 'Série', 'Leituras', 'Lidos', 'Destino', 'Última Leitura', 'CNPJ Remetente', 'Remetente', 'Posicao', 'Area'];

function csv(linhas: (string | number | null)[][]): Buffer {
  return Buffer.from(String.fromCharCode(0xfeff) + [CAB, ...linhas].map((l) => l.map((c) => (c === null ? '' : String(c))).join(';')).join('\r\n') + '\r\n', 'utf8');
}

/** Exportação fictícia de um palete: 3 notas com leitura (NF-e com Leituras ≠ Lidos) e 1 linha zero. */
function exportacao(s: string): Buffer {
  return csv([
    [1, 'S', 'NF-e', `7${s}1`, '55', 1, 10, 'LOU', '19/10/2026 10:15', '11.111.111/0001-11', 'Remetente Fictício A Ltda', 'P9', 'X'],
    [1, 'N', 'NF-e', `7${s}2`, '1', 1, 2, 'LOU', '19/10/2026 10:16', '22.222.222/0001-22', 'Remetente Fictício B Ltda', 'P9', 'X'],
    [3, 'N', 'Minuta', `9${s}`, '219', 0, 0, 'LOU', null, '33.333.333/0001-33', 'Remetente Fictício C', null, null],
    [1, 'S', 'Minuta', `9${s}`, '219', 0.1, 1, 'LOU', null, '33.333.333/0001-33', 'Remetente Fictício C', null, null],
  ]);
}

async function capturar(page: Page, nome: string | null): Promise<void> {
  if (nome === null) return;
  mkdirSync(PASTA, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${PASTA}/${nome}.png`, fullPage: false });
}

/** Celular: nem o documento nem a página rolam na horizontal (as tabelas rolam dentro da própria região). */
async function semRolagemHorizontal(page: Page): Promise<void> {
  const medidas = await page.evaluate(() => {
    const principal = document.querySelector('[data-testid="tela-bipagem"]');
    return {
      documento: document.documentElement.scrollWidth - window.innerWidth,
      pagina: principal === null ? 0 : principal.scrollWidth - principal.clientWidth,
    };
  });
  expect(medidas.documento).toBeLessThanOrEqual(1);
  expect(medidas.pagina).toBeLessThanOrEqual(1);
}

async function enviar(page: Page, s: string): Promise<void> {
  await page.getByTestId('bipagem-arquivo').setInputFiles({ name: `Etiquetas-${s}.csv`, mimeType: 'text/csv', buffer: exportacao(s) });
  await page.getByTestId('bipagem-enviar').click();
  await expect(page.getByTestId('bipagem-previa')).toBeVisible();
}

async function percurso(page: Page, celular: boolean, capturas: boolean): Promise<void> {
  const nome = (n: string) => (capturas ? `${celular ? 'celular' : 'computador'}-${n}` : null);
  const s = randomUUID().replace(/\D/g, '').slice(0, 5).padEnd(5, '7');
  await entrar(page, 'operador');
  const praca = await obterPraca(page);
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  const livre = praca.layout.positions.find((p) => p.available && !ocupadas.has(p.id));
  if (!livre) throw new Error('Sem posição livre no escopo de cadastro.');

  // 1–2. Arquivo e prévia (nada gravado).
  await page.goto('/bipagem');
  await expect(page.getByRole('heading', { name: 'Importar bipagem' })).toBeVisible();
  await expect(page.getByTestId('tela-bipagem')).not.toContainText(/separador|SKU|unidade canônica|fator|código de barras/i);
  await enviar(page, s);
  await expect(page.getByTestId('bipagem-aceitas')).toContainText('3');
  await expect(page.getByTestId('bipagem-volumes')).toContainText('13');
  await expect(page.getByTestId('bipagem-sem-leitura')).toContainText('1');
  await expect(page.locator(`tr[data-documento="NF-e 7${s}1"]`)).toContainText('10');
  await page.getByTestId('bipagem-mais-informacoes').locator('summary').click();
  await expect(page.getByTestId('bipagem-mais-informacoes')).toContainText('11.111.111/0001-11');
  await expect(page.getByTestId('bipagem-mais-informacoes')).toContainText('19/10/2026 10:15');
  await capturar(page, nome('01-previa'));
  if (celular) await semRolagemHorizontal(page);

  // 3. Posição livre no mapa: palete novo, número só na confirmação.
  await expect(page.getByTestId('bipagem-mapa')).toBeVisible();
  await capturar(page, nome('02-mapa'));
  await page.locator(`path[data-posicao="${livre.code}"]`).dispatchEvent('click');
  await expect(page.getByTestId('bipagem-destino-resumo')).toContainText('Palete novo');
  await expect(page.getByTestId('bipagem-destino-resumo')).toContainText('gerado ao confirmar');
  await capturar(page, nome('03-destino-novo'));

  // 4. Confirmar: número definitivo.
  await page.getByTestId('bipagem-importar').click();
  const titulo = page.getByTestId('bipagem-resultado-titulo');
  await expect(titulo).toHaveText(/^Palete \S+ criado$/);
  const numero = ((await titulo.textContent()) ?? '').replace(/^Palete /, '').replace(/ criado$/, '');
  await expect(page.getByTestId('bipagem-resultado')).toContainText('3 notas importadas (13 volumes)');
  await capturar(page, nome('04-resultado'));
  const depois = await obterPraca(page);
  const criado = depois.pallets.find((p) => p.code === numero);
  expect(criado?.positionId).toBe(livre.id);
  const conteudo = async () =>
    ((await (await page.request.get(`/api/v1/paletes/${criado?.id ?? ''}/conteudos`)).json()) as { items: { documentNumber: string; count: { counted: string } }[] }).items;
  expect((await conteudo()).map((i) => [i.documentNumber, i.count.counted]).sort()).toEqual([[`7${s}1`, '10'], [`7${s}2`, '2'], [`9${s}`, '1']].sort());

  // O mesmo arquivo de novo, no palete criado: aviso da importação anterior e notas repetidas.
  await page.goto('/bipagem');
  await enviar(page, s);
  await page.locator(`path[data-palete-id="${criado?.id ?? ''}"]`).dispatchEvent('click');
  await expect(page.getByTestId('bipagem-destino-resumo')).toContainText('Este palete já contém notas. Deseja acrescentar os conteúdos desta importação?');
  await expect(page.getByTestId('bipagem-destino-codigo')).toHaveText(numero);
  await expect(page.getByTestId('bipagem-ja-importado')).toBeVisible();
  // Caixas e opções são confirmadas pelo servidor (a prévia é refeita): clicar e esperar.
  await page.getByTestId('bipagem-nova-operacao').click();
  await expect(page.getByTestId('bipagem-nova-operacao')).toBeChecked();
  await expect(page.getByTestId('bipagem-coincidencia')).toHaveCount(3);
  await page.getByTestId('bipagem-revalidar-todas').click();
  await expect(page.getByTestId('bipagem-bloqueio')).toContainText('nada a acrescentar');
  const separar = page.locator('[data-testid="bipagem-coincidencia"][data-linha="2"]').getByTestId('bipagem-separar');
  await separar.click();
  await expect(separar).toBeChecked();
  await expect(page.getByTestId('bipagem-destino-adicionar')).toHaveText('1 nota · 10 volumes');
  await capturar(page, nome('05-notas-repetidas'));
  if (celular) await semRolagemHorizontal(page);
  await page.getByTestId('bipagem-importar').click();
  await expect(page.getByTestId('bipagem-resultado-titulo')).toHaveText(`Acrescentado ao palete ${numero}`);
  await expect(page.getByTestId('bipagem-resultado')).toContainText('1 nota importada (10 volumes), 2 linhas revalidadas (não entraram)');
  await capturar(page, nome('06-acrescentado'));
  // Importar separadamente: a entrada antiga continua e a nova também conta (10 + 10).
  expect((await conteudo()).filter((i) => i.documentNumber === `7${s}1`).map((i) => i.count.counted)).toEqual(['10', '10']);
  expect(await conteudo()).toHaveLength(4);
}

test.describe('Importar bipagem "Etiquetas"', () => {
  test('arquivo → prévia → posição livre no mapa → palete novo numerado; o mesmo arquivo de novo: Revalidar e Importar separadamente', async ({ page }, testInfo) => {
    await percurso(page, ehCelular(testInfo), false);
  });

  test('capturas da importação da bipagem @captura', async ({ page }, testInfo) => {
    await percurso(page, ehCelular(testInfo), true);
  });
});
