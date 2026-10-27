import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ehCelular, entrar, obterPraca } from './apoio';

/**
 * Validação urgente — sem endereço (26 out. 2026), no escopo de cadastro do
 * E2E (dados fictícios): a barra "Colocar no mapa" aparece ao marcar a primeira
 * nota, sem rolar até o fim; contadores e seleção por ID sobrevivem a busca e
 * atualização; a janela reaproveita a escolha do destino (palete ocupado pede
 * confirmação); conflito com outra pessoa não grava nada e mantém o que falta.
 */
async function cabecalhos(page: Page): Promise<Record<string, string>> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() };
}

async function chamar(page: Page, caminho: string, corpo: unknown): Promise<APIResponse> {
  return page.request.fetch(caminho, { method: 'POST', data: corpo, headers: await cabecalhos(page) });
}

async function paleteNovo(page: Page): Promise<{ id: string; code: string }> {
  const praca = await obterPraca(page);
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  const livre = praca.layout.positions.find((p) => p.available && !ocupadas.has(p.id)) ?? null;
  const r = await chamar(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: livre?.id ?? null, notes: 'Validação urgente (fictício)', declaredItems: [] });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string; code: string };
}

/** Conteúdo registrado com volumes informados; devolve o ID da ocorrência. */
async function conteudo(page: Page, paleteId: string, numero: string, volumes: number): Promise<string> {
  const r = await chamar(page, `/api/v1/paletes/${paleteId}/conteudos`, { sender: `Remetente Fictício ${numero}`, documentType: 'NFD', documentNumber: numero });
  expect(r.status(), await r.text()).toBe(201);
  const id = ((await r.json()) as { items: { id: string; documentNumber: string | null }[] }).items.find((i) => i.documentNumber === numero)?.id ?? '';
  const c = await chamar(page, `/api/v1/paletes/${paleteId}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id }, counted: volumes, origin: 'CONTAGEM_INFORMADA' });
  expect(c.status(), await c.text()).toBe(201);
  return id;
}

/** Fila fictícia: `n` notas enviadas à validação a partir de um palete (prefixo único por teste). */
async function fila(page: Page, prefixo: string, n: number): Promise<{ numeros: string[]; ids: string[] }> {
  const origem = await paleteNovo(page);
  const numeros = Array.from({ length: n }, (_, i) => `${prefixo}${String(i + 1).padStart(2, '0')}`);
  const ids: string[] = [];
  for (const [i, numero] of numeros.entries()) ids.push(await conteudo(page, origem.id, numero, i + 1));
  const r = await chamar(page, `/api/v1/paletes/${origem.id}/conteudos/acoes`, { action: 'VALIDACAO', items: ids.map((id) => ({ kind: 'REGISTRADO', id })), reason: 'Local físico a confirmar (teste)' });
  expect(r.status(), await r.text()).toBeLessThan(300);
  return { numeros, ids };
}

const PASTA = 'docs/capturas/validacao-urgente';
async function capturar(page: Page, nome: string): Promise<void> {
  if (process.env.CAPTURAR !== '1') return;
  mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: `${PASTA}/${nome}.png` });
}

const item = (page: Page, numero: string) => page.locator(`[data-testid="validacao-item"][data-numero="${numero}"]`);

async function abrirFila(page: Page, filtro: string): Promise<void> {
  await page.goto('/validacao');
  await expect(page.getByTestId('tela-validacao')).toBeVisible();
  await page.getByPlaceholder('Nota, remetente, palete ou endereço').fill(filtro);
}

test.describe('Validação urgente — barra e janela "Colocar no mapa"', () => {
  test('marcar uma nota no começo ou no meio mostra a ação sem ir ao fim; contadores, busca e limpar seleção', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'fluxo do computador; o celular tem teste próprio');
    const s = randomUUID().replace(/\D/g, '').slice(0, 4).padEnd(4, '7');
    await entrar(page, 'supervisor');
    const { numeros } = await fila(page, `9${s}`, 14);
    await abrirFila(page, `9${s}`);
    await expect(page.getByTestId('validacao-item')).toHaveCount(14);
    await expect(page.getByTestId('validacao-barra')).toHaveCount(0);
    // Começo e meio da lista: a barra aparece na tela, sem rolar até o fim.
    await item(page, numeros[1] ?? '').getByTestId('validacao-marcar').check();
    await expect(page.getByTestId('validacao-barra')).toBeInViewport();
    await expect(page.getByTestId('validacao-barra-contagem')).toHaveText('1 nota selecionada');
    await item(page, numeros[7] ?? '').getByTestId('validacao-marcar').check();
    await expect(page.getByTestId('validacao-barra')).toBeInViewport();
    await expect(page.getByTestId('validacao-barra-contagem')).toHaveText('2 notas selecionadas');
    await capturar(page, '01-barra-ao-selecionar');
    // Último card: a barra não o cobre (o clique alcança a caixa de seleção).
    await item(page, numeros[13] ?? '').getByTestId('validacao-marcar').check();
    await expect(page.getByTestId('validacao-barra-contagem')).toHaveText('3 notas selecionadas');
    // Todas as exibidas = as 14 da busca; outra busca esconde 13, mas a seleção continua contando todas.
    await page.getByTestId('validacao-todas').check();
    await expect(page.getByTestId('validacao-barra-contagem')).toHaveText('14 notas selecionadas');
    await page.getByPlaceholder('Nota, remetente, palete ou endereço').fill(numeros[0] ?? '');
    await expect(page.getByTestId('validacao-item')).toHaveCount(1);
    await expect(page.getByTestId('validacao-barra')).toContainText('14 notas selecionadas · 13 fora da busca atual');
    // A janela lista todas as incluídas, inclusive as escondidas pela busca.
    await page.getByTestId('validacao-colocar').click();
    await expect(page.getByTestId('validacao-janela').getByTestId('janela-titulo')).toHaveText('Colocar 14 notas no mapa');
    await expect(page.getByTestId('validacao-janela-item')).toHaveCount(14);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('validacao-janela')).toHaveCount(0);
    // Limpar: a barra sai; busca e lista ficam.
    await page.getByTestId('validacao-limpar').click();
    await expect(page.getByTestId('validacao-barra')).toHaveCount(0);
    await expect(page.getByPlaceholder('Nota, remetente, palete ou endereço')).toHaveValue(numeros[0] ?? '');
    await expect(page.getByTestId('validacao-item')).toHaveCount(1);
  });

  test('colocar no palete ocupado pede confirmação; sucesso tira da lista; conflito com outra pessoa não grava e mantém o resto', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'fluxo do computador');
    const s = randomUUID().replace(/\D/g, '').slice(0, 4).padEnd(4, '8');
    await entrar(page, 'supervisor');
    const { numeros, ids } = await fila(page, `8${s}`, 5);
    const destino = await paleteNovo(page);
    await conteudo(page, destino.id, `7${s}00`, 4);
    await abrirFila(page, `8${s}`);
    // Palete ocupado: o servidor pede confirmação; acrescentar mantém o conteúdo do destino.
    for (const n of numeros.slice(0, 2)) await item(page, n).getByTestId('validacao-marcar').check();
    await page.getByTestId('validacao-colocar').click();
    const janela = page.getByTestId('validacao-janela');
    await expect(janela.getByTestId('janela-titulo')).toHaveText('Colocar 2 notas no mapa');
    await janela.getByTestId('escolher-busca').fill(destino.code);
    await janela.getByTestId('escolher-palete').first().click();
    await capturar(page, '02-janela-destino');
    await janela.getByTestId('acao-mover-confirmar').click();
    await expect(janela.getByTestId('acao-confirmar-ocupado')).toBeVisible();
    await janela.getByTestId('acao-acrescentar').click();
    await expect(janela).toHaveCount(0);
    await expect(page.getByTestId('validacao-mensagem')).toContainText(`2 conteúdo(s) alocado(s) no palete ${destino.code}`);
    await expect(page.getByTestId('validacao-item')).toHaveCount(3);
    await expect(page.getByTestId('validacao-barra')).toHaveCount(0);
    // Conflito: outra pessoa resolve uma das selecionadas antes da confirmação.
    for (const n of numeros.slice(2, 4)) await item(page, n).getByTestId('validacao-marcar').check();
    await page.getByTestId('validacao-colocar').click();
    await janela.getByTestId('escolher-busca').fill(destino.code);
    await janela.getByTestId('escolher-palete').first().click();
    const outro = await chamar(page, '/api/v1/validacao/resolver', { items: [{ kind: 'REGISTRADO', id: ids[2] }], destination: { kind: 'PALETE', id: destino.id }, confirmOccupied: true, reason: 'Resolvido por outra pessoa (teste)' });
    expect(outro.status(), await outro.text()).toBeLessThan(300);
    await janela.getByTestId('acao-mover-confirmar').click();
    await expect(janela.getByTestId('acoes-mensagem')).toContainText(`já foi resolvida por outra pessoa (NFD ${numeros[2] ?? ''})`);
    await expect(janela.getByTestId('validacao-janela-item')).toHaveCount(1);
    await expect(page.getByTestId('validacao-barra-contagem')).toHaveText('1 nota selecionada');
    // Repetir com o que falta: grava só a pendente.
    await janela.getByTestId('acao-mover-confirmar').click();
    await janela.getByTestId('acao-acrescentar').click();
    await expect(page.getByTestId('validacao-mensagem')).toContainText('1 conteúdo(s) alocado(s)');
    await expect(page.getByTestId('validacao-item')).toHaveCount(1);
  });

  test('celular: a barra aparece ao marcar e abre a janela', async ({ page }, testInfo) => {
    test.skip(!ehCelular(testInfo), 'só no celular');
    const s = randomUUID().replace(/\D/g, '').slice(0, 4).padEnd(4, '6');
    await entrar(page, 'supervisor');
    const { numeros } = await fila(page, `6${s}`, 6);
    await abrirFila(page, `6${s}`);
    await item(page, numeros[2] ?? '').getByTestId('validacao-marcar').check();
    await expect(page.getByTestId('validacao-barra')).toBeInViewport();
    await capturar(page, '03-celular-barra');
    await page.getByTestId('validacao-colocar').click();
    await expect(page.getByTestId('validacao-janela').getByTestId('janela-titulo')).toHaveText('Colocar 1 nota no mapa');
  });
});
