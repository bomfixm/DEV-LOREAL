import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { entrar } from './apoio';

/**
 * Editor de layout dos espelhos (nov. 2026). Um rascunho para o lote; "Aplicar
 * aos N espelhos" grava só nos paletes daquele lote (neste computador). Os dados
 * de cada espelho continuam vindo da API. Só no computador.
 */
const PX_MM = 96 / 25.4;

async function abrir(page: Page) {
  await entrar(page, 'operadorDemo');
  await page.goto('/espelhos');
  await page.locator('path[data-palete-id]').first().waitFor({ state: 'attached' });
  await page.evaluate(() => { localStorage.removeItem('praca-reversa:espelhos-layout:v1'); });
}
/** Três paletes elegíveis (que marcam ao clicar), com código. */
async function tresPaletes(page: Page): Promise<string[]> {
  const codigos: string[] = [];
  const caminhos = page.locator('path[data-palete-id]');
  const n = await caminhos.count();
  for (let i = 0; i < n && codigos.length < 3; i += 1) {
    const c = caminhos.nth(i);
    const codigo = await c.getAttribute('data-codigo');
    if (codigo === null) continue;
    const antes = await contagem(page);
    await c.click({ force: true });
    if ((await contagem(page)) === antes + 1) {
      codigos.push(codigo);
      await c.click({ force: true });
    }
  }
  expect(codigos).toHaveLength(3);
  return codigos;
}
const contagem = async (page: Page) => Number((await page.getByTestId('espelhos-contagem').locator('strong').innerText()).trim());
async function marcarEGerar(page: Page, codigos: readonly string[]) {
  const limpar = page.getByRole('button', { name: 'Limpar seleção' });
  if (await limpar.isEnabled()) await limpar.click();
  for (const c of codigos) await page.locator(`path[data-codigo="${c}"]`).click({ force: true });
  expect(await contagem(page)).toBe(codigos.length);
  await page.getByRole('button', { name: 'Gerar prévia', exact: true }).click();
  await expect(page.locator('.espelhos-folhas[data-pronto="sim"]')).toBeVisible();
}
const blocoPalete = (page: Page, codigo: string) => page.locator(`.espelhos-folhas .espelho-folha[data-palete="${codigo}"] [data-campo="palete"]`).first();
const estilo = (page: Page, codigo: string) => blocoPalete(page, codigo).evaluate((el) => ({ left: (el as HTMLElement).style.left, top: (el as HTMLElement).style.top, fonte: (el as HTMLElement).style.fontSize, texto: el.textContent }));

test('editor: A e B recebem o layout, C fica como estava; zoom não muda coordenadas; desfazer, cancelar e modelo salvo', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'Impressão de espelhos é só no computador.');
  await abrir(page);
  const [A = '', B = '', C = ''] = await tresPaletes(page);

  await marcarEGerar(page, [A, B]);
  await expect(page.getByTestId('espelhos-layout-usado')).toHaveText('Operacional limpo');
  const antesA = await estilo(page, A);
  expect(antesA.left).toBe('192mm');

  // Editar: número do palete no canto superior direito, 24 pt (controles numéricos).
  await page.getByTestId('espelhos-editar').click();
  const editor = page.getByTestId('editor-layout');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Aplicar aos 2 espelhos' })).toBeVisible();
  const folhaEditor = editor.locator('.espelho-folha');
  await folhaEditor.locator('[data-campo-editor="palete"]').click();
  // Largura antes da posição: com 85 mm o bloco não pode começar em 210 mm (a folha limita).
  await editor.getByTestId('ed-largura').fill('60');
  await editor.getByTestId('ed-x').fill('210');
  await editor.getByTestId('ed-y').fill('6');
  await editor.getByTestId('ed-tamanho').fill('24');
  await editor.getByTestId('ed-fonte').selectOption('arial');
  await expect(folhaEditor.locator('[data-campo-editor="palete"]')).toHaveCSS('font-size', `${String(24 * 96 / 72)}px`);

  // Arraste: 20 mm para a esquerda em dois zooms diferentes dá o mesmo deslocamento na folha.
  const arrastar = async (mm: number) => {
    const zoom = Number((await editor.getByTestId('ed-zoom').innerText()).replace('%', '')) / 100;
    const caixa = await folhaEditor.locator('[data-campo-editor="palete"]').boundingBox();
    if (caixa === null) throw new Error('sem caixa');
    const x = caixa.x + caixa.width / 2;
    const y = caixa.y + caixa.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (mm * PX_MM * zoom) / 2, y, { steps: 4 });
    await page.mouse.move(x + mm * PX_MM * zoom, y, { steps: 4 });
    await page.mouse.up();
  };
  await arrastar(-20);
  await expect(editor.getByTestId('ed-x')).toHaveValue('190');
  await editor.getByRole('button', { name: 'Afastar' }).click();
  await editor.getByRole('button', { name: 'Afastar' }).click();
  await arrastar(20);
  await expect(editor.getByTestId('ed-x')).toHaveValue('210');
  // Desfazer o último arraste (um passo só) e refazer.
  await editor.getByRole('button', { name: /Desfazer/ }).click();
  await expect(editor.getByTestId('ed-x')).toHaveValue('190');
  await editor.getByRole('button', { name: /Refazer/ }).click();
  await expect(editor.getByTestId('ed-x')).toHaveValue('210');
  // Teclado: seta move 0,5 mm.
  await folhaEditor.locator('[data-campo-editor="palete"]').press('ArrowRight');
  await expect(editor.getByTestId('ed-x')).toHaveValue('210.5');
  await folhaEditor.locator('[data-campo-editor="palete"]').press('ArrowLeft');

  // Navegar: o espelho B mostra o próprio número com o mesmo rascunho.
  await expect(folhaEditor.locator('[data-campo-editor="palete"]')).toContainText(A);
  await editor.getByRole('button', { name: 'Próximo espelho' }).click();
  await expect(editor.getByTestId('ed-navegacao')).toContainText(B);
  await expect(folhaEditor.locator('[data-campo-editor="palete"]')).toContainText(B);
  expect(await folhaEditor.locator('[data-campo-editor="palete"]').evaluate((el) => (el as HTMLElement).style.left)).toBe('210mm');

  // Salvar como modelo (só aparência).
  await editor.getByRole('button', { name: 'Salvar como modelo' }).click();
  await editor.getByTestId('ed-nome-modelo').fill('Topo à direita');
  await editor.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(editor.getByText('salvo neste computador')).toBeVisible();

  await editor.getByTestId('ed-aplicar').click();
  await expect(editor).toBeHidden();
  await expect(page.getByText('Layout aplicado a 2 espelho(s)')).toBeVisible();
  await expect(page.locator('.espelhos-folhas[data-pronto="sim"]')).toBeVisible();
  for (const c of [A, B]) {
    const e = await estilo(page, c);
    expect(e).toMatchObject({ left: '210mm', top: '6mm', fonte: '24pt' });
    expect(e.texto).toContain(c);
  }
  await expect(page.getByTestId('espelhos-problemas')).toHaveCount(0);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('espelhos-mapa')).toBeHidden();
  await expect(page.locator('.espelho-folha--edicao, .ef-alca, .ed-guias')).toHaveCount(0);
  await page.pdf({ path: info.outputPath('espelhos-A-B.pdf'), preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });

  // C, fora da aplicação, continua com o layout anterior (padrão).
  await marcarEGerar(page, [C]);
  expect(await estilo(page, C)).toMatchObject({ left: '192mm' });
  // A e C juntos: cada um com o seu.
  await marcarEGerar(page, [A, C]);
  expect((await estilo(page, A)).left).toBe('210mm');
  expect((await estilo(page, C)).left).toBe('192mm');
  await expect(page.getByTestId('espelhos-layout-usado')).toContainText('personalizado');

  // Cancelar descarta o rascunho: nada muda.
  await page.getByTestId('espelhos-editar').click();
  await page.getByTestId('editor-layout').locator('[data-campo-editor="palete"]').click();
  await page.getByTestId('ed-x').fill('100');
  page.once('dialog', (d) => { void d.accept(); });
  await page.getByTestId('editor-layout').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByTestId('editor-layout')).toBeHidden();
  expect((await estilo(page, A)).left).toBe('210mm');
  expect((await estilo(page, C)).left).toBe('192mm');

  // Modelo salvo aplicado a outra seleção (só C): carrega a aparência, não os dados de A.
  await marcarEGerar(page, [C]);
  await page.getByTestId('espelhos-editar').click();
  await page.getByTestId('ed-modelo').selectOption({ label: 'Topo à direita' });
  await expect(page.getByTestId('editor-layout').locator('[data-campo-editor="palete"]')).toContainText(C);
  await expect(page.getByTestId('editor-layout').locator('[data-campo-editor="palete"]')).not.toContainText(A);
  await page.getByTestId('ed-aplicar').click();
  expect(await estilo(page, C)).toMatchObject({ left: '210mm', fonte: '24pt' });
});

test('espelhos: remetente longo, campos vazios e muitas notas paginam sem cortar @captura', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'Impressão de espelhos é só no computador.');
  await abrir(page);
  const [A = '', B = ''] = await tresPaletes(page);
  // Dados de teste só nesta página: um palete com 45 notas e textos longos, outro com campos vazios.
  await page.route('**/api/v1/espelhos?*', async (rota) => {
    const resposta = await rota.fetch();
    const lote = (await resposta.json()) as { items: { code: string; contents: { items: Record<string, unknown>[] } }[] };
    const [primeiro, segundo] = lote.items;
    // Nota completa no formato da API (o cenário de demonstração pode não ter notas nesses paletes).
    const base = {
      id: '', kind: 'REGISTRADO', sender: null, documentType: 'NF', documentNumber: null, delivery: null, description: null, source: null, palletFull: null, version: 1,
      count: { state: 'AGUARDANDO', counted: null, expected: '12', origin: null, at: null, by: null, reference: null }, createdAt: '2026-11-05T15:00:00.000Z',
    };
    if (primeiro !== undefined) {
      primeiro.contents.items = Array.from({ length: 45 }, (_, n) => ({
        ...base,
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        sender: n % 4 === 0 ? 'COMERCIAL DISTRIBUIDORA DE COSMÉTICOS E PRODUTOS DE BELEZA DO SUDESTE LTDA – FILIAL CAMPINAS' : `REMETENTE ${String(n)}`,
        documentNumber: String(100000 + n),
        delivery: n % 5 === 0 ? null : `80${String(4000000 + n)}`,
      }));
    }
    if (segundo !== undefined) segundo.contents.items = [{ ...base, id: '00000000-0000-4000-8000-0000000000ff', sender: null, delivery: null, documentType: null, documentNumber: null }];
    await rota.fulfill({ response: resposta, json: lote });
  });
  await marcarEGerar(page, [A, B]);
  const folhasA = page.locator(`.espelhos-folhas .espelho-folha[data-palete="${A}"]`);
  expect(await folhasA.count()).toBeGreaterThan(1);
  // Toda nota aparece uma vez; cada folha repete cabeçalho e identificação do palete.
  const linhas = await folhasA.locator('tbody tr').count();
  expect(linhas).toBe(45);
  for (let i = 0; i < (await folhasA.count()); i += 1) {
    await expect(folhasA.nth(i).locator('thead th').first()).toHaveText('DLV');
    await expect(folhasA.nth(i).locator('[data-campo="palete"]')).toContainText(A);
  }
  await expect(folhasA.nth(1).locator('[data-campo="continuacao"]')).toContainText('2/');
  // Nenhuma tabela passa da sua área (nada cortado).
  const cortes = await page.locator('.espelhos-folhas [data-campo="tabela"]').evaluateAll((els) => els.filter((el) => (el.querySelector('table')?.scrollHeight ?? 0) > el.clientHeight + 1).length);
  expect(cortes).toBe(0);
  await expect(page.getByTestId('espelhos-problemas')).toHaveCount(0);

  // Prévia e impressão quebram igual: mesmas alturas de linha na tela e na mídia de impressão.
  const alturas = () => page.locator('.espelhos-folhas .espelho-folha tbody tr').evaluateAll((trs) => trs.map((tr) => Math.round(tr.getBoundingClientRect().height * 10) / 10));
  const naTela = await alturas();
  await page.emulateMedia({ media: 'print' });
  expect(await alturas()).toEqual(naTela);
  await page.emulateMedia({ media: 'screen' });

  const pasta = resolve('docs/capturas/espelhos-editor');
  mkdirSync(pasta, { recursive: true });
  await page.locator('.espelhos-folhas .espelho-folha').first().screenshot({ path: resolve(pasta, '01-operacional-limpo-folha1.png') });
  await folhasA.nth(1).screenshot({ path: resolve(pasta, '02-operacional-limpo-continuacao.png') });
  await page.locator(`.espelhos-folhas .espelho-folha[data-palete="${B}"]`).first().screenshot({ path: resolve(pasta, '03-campos-vazios.png') });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: resolve(pasta, 'espelhos-operacional-limpo.pdf'), preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.getByTestId('espelhos-editar').click();
  await page.getByTestId('editor-layout').locator('[data-campo-editor="palete"]').click();
  await page.screenshot({ path: resolve(pasta, '04-editor.png') });
  await page.getByTestId('ed-modelo').selectOption({ label: 'Clássico (moldura DHL)' });
  await page.getByTestId('ed-aplicar').click();
  await expect(page.locator('.espelhos-folhas[data-pronto="sim"]')).toBeVisible();
  await page.locator('.espelhos-folhas .espelho-folha').first().screenshot({ path: resolve(pasta, '05-classico.png') });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: resolve(pasta, 'espelhos-classico.pdf'), preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
});
