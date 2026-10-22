import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { aguardarMapa, centro, ehCelular, entrar, obterPraca, zoom } from './apoio';

/**
 * Conferência em tabela e correção de conteúdos (21 out. 2026), no escopo de
 * cadastro do E2E (dados fictícios): a conferência abre sobre o mapa, grava
 * 130 → 126, fecha só depois da resposta, mostra o resultado e atualiza a
 * cor/estado do palete sem mexer no zoom; conjunto alterado mantém o digitado;
 * conteúdos vão para a validação sem endereço e voltam escolhendo o destino.
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
  const r = await chamar(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: livre?.id ?? null, notes: 'Conferência em tabela (fictício)', declaredItems: [] });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string; code: string };
}

/** Conteúdo registrado com a quantidade atual informada (contagem já feita). */
async function conteudo(page: Page, paleteId: string, numero: string, volumes: number): Promise<string> {
  const r = await chamar(page, `/api/v1/paletes/${paleteId}/conteudos`, { sender: `Remetente Fictício ${numero}`, documentType: 'NFD', documentNumber: numero });
  expect(r.status(), await r.text()).toBe(201);
  const itens = ((await r.json()) as { items: { id: string; documentNumber: string | null }[] }).items;
  const id = itens.find((i) => i.documentNumber === numero)?.id ?? '';
  const c = await chamar(page, `/api/v1/paletes/${paleteId}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id }, counted: volumes, origin: 'CONTAGEM_INFORMADA' });
  expect(c.status(), await c.text()).toBe(201);
  return id;
}

const PASTA = 'docs/capturas/conferencia-tabela';
async function capturar(page: Page, nome: string): Promise<void> {
  if (process.env.CAPTURAR !== '1') return;
  mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: `${PASTA}/${nome}.png` });
}

async function abrirPalete(page: Page, id: string): Promise<void> {
  await page.locator(`path[data-palete-id="${id}"]`).dispatchEvent('click');
  await expect(page.getByTestId('janela-palete')).toBeVisible();
}

test.describe('Conferência em tabela e correção de conteúdos', () => {
  test('130 recontados como 126: grava, fecha sozinha, mostra o resultado e atualiza estado e cor sem mexer no mapa', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'fluxo do computador; o celular usa a mesma tabela em fichas');
    const s = randomUUID().replace(/\D/g, '').slice(0, 5).padEnd(5, '3');
    await entrar(page, 'supervisor');
    const p = await paleteNovo(page);
    await conteudo(page, p.id, `61${s}`, 130);
    await conteudo(page, p.id, `62${s}`, 4);
    await page.goto('/');
    await aguardarMapa(page);
    const zoomAntes = await zoom(page);
    const centroAntes = await centro(page);
    await abrirPalete(page, p.id);
    // Contagens já feitas, nota por nota, contam como conferência parcial; falta a completa.
    await expect(page.getByTestId('janela-conferencia')).toContainText('Conferido parcialmente');
    await expect(page.getByTestId('janela-conferencia')).toContainText('todos contados, falta a conferência completa');
    await page.getByTestId('acao-volumes').click();
    const tela = page.getByTestId('janela-conferencia-volumes');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('conf-linha')).toHaveCount(2);
    // A quantidade atual é a referência; o contado começa com ela e só a linha com diferença muda.
    const linha = tela.locator(`[data-testid="conf-linha"][data-numero="61${s}"]`);
    await expect(linha.getByTestId('conf-atual')).toHaveText('130');
    await linha.getByTestId('conf-contado').fill('126');
    await expect(linha.getByTestId('conf-diferenca')).toHaveText('-4');
    await capturar(page, '01-tabela-130-para-126');
    // Sem a declaração física, nada é gravado.
    await expect(tela.getByTestId('conf-concluir-diferencas')).toBeDisabled();
    await tela.getByTestId('conf-declaracao').check();
    await expect(tela.getByTestId('conf-confirmar-todos')).toBeDisabled();
    await tela.getByTestId('conf-concluir-diferencas').click();
    // Fecha depois da gravação, com o resultado; volta à janela do palete com o que ficou no banco.
    await expect(tela).toHaveCount(0);
    await expect(page.getByTestId('aviso-resultado')).toContainText(`61${s} 130 → 126 (-4)`);
    await expect(page.getByTestId('janela-palete')).toBeVisible();
    await expect(page.getByTestId('janela-conferencia')).toContainText('Conferido com diferença');
    await expect(page.getByTestId('janela-volumes')).toContainText('130');
    await expect(page.locator(`path[data-palete-id="${p.id}"]`)).toHaveAttribute('data-estado', 'CONFERIDO_COM_DIFERENCA');
    await capturar(page, '02-fechou-com-resultado');
    expect(await zoom(page)).toBe(zoomAntes);
    expect(await centro(page)).toEqual(centroAntes);
    // Recarregar mostra 126 (persistido), nunca 130 nem 130 + 126.
    await page.reload();
    await aguardarMapa(page);
    await abrirPalete(page, p.id);
    await expect(page.locator(`[data-testid="janela-linha"][data-numero="61${s}"] [data-testid="janela-linha-volumes"]`)).toHaveText('126');
    await expect(page.getByTestId('janela-volumes')).toContainText('130');
    await page.getByTestId('acao-volumes').click();
    await expect(page.getByTestId('janela-conferencia-volumes').locator(`[data-testid="conf-linha"][data-numero="61${s}"] [data-testid="conf-atual"]`)).toHaveText('126');
  });

  test('conjunto alterado durante a conferência: erro, a tela fica aberta e os valores digitados ficam', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'fluxo do computador');
    const s = randomUUID().replace(/\D/g, '').slice(0, 5).padEnd(5, '4');
    await entrar(page, 'supervisor');
    const p = await paleteNovo(page);
    await conteudo(page, p.id, `71${s}`, 10);
    await page.goto('/');
    await aguardarMapa(page);
    await abrirPalete(page, p.id);
    await page.getByTestId('acao-volumes').click();
    const tela = page.getByTestId('janela-conferencia-volumes');
    await tela.getByTestId('conf-contado').first().fill('9');
    // Outra entrada no palete depois de abrir a tabela.
    await conteudo(page, p.id, `72${s}`, 2);
    await tela.getByTestId('conf-declaracao').check();
    await tela.getByTestId('conf-concluir-diferencas').click();
    await expect(tela.getByTestId('conf-mensagem')).toContainText('mudou');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('conf-contado').first()).toHaveValue('9');
    await tela.getByTestId('conf-recarregar').click();
    await expect(tela.getByTestId('conf-linha')).toHaveCount(2);
    await expect(tela.locator(`[data-testid="conf-linha"][data-numero="71${s}"] [data-testid="conf-contado"]`)).toHaveValue('9');
  });

  test('selecionar vários, enviar à validação e resolver escolhendo o destino; o cartão aparece fora do mapa', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'fluxo do computador');
    const s = randomUUID().replace(/\D/g, '').slice(0, 5).padEnd(5, '5');
    await entrar(page, 'supervisor');
    const origem = await paleteNovo(page);
    const destino = await paleteNovo(page);
    await conteudo(page, origem.id, `81${s}`, 3);
    await conteudo(page, origem.id, `82${s}`, 5);
    await conteudo(page, origem.id, `83${s}`, 1);
    await page.goto('/');
    await aguardarMapa(page);
    await abrirPalete(page, origem.id);
    await page.getByTestId('acao-corrigir-conteudos').click();
    const sel = page.getByTestId('janela-tabela-selecao');
    await sel.locator(`[data-testid="janela-linha-selecao"][data-numero="81${s}"] [data-testid="selecionar-conteudo"]`).check();
    await sel.locator(`[data-testid="janela-linha-selecao"][data-numero="82${s}"] [data-testid="selecionar-conteudo"]`).check();
    await expect(page.getByTestId('acoes-resumo')).toContainText('2 conteúdo(s) selecionado(s) · 8 volume(s)');
    await capturar(page, '03-selecionar-conteudos');
    await page.getByTestId('acao-validacao').click();
    await page.getByTestId('acao-motivo').fill('Não encontrados no palete (teste)');
    await page.getByTestId('acao-validacao-confirmar').click();
    await expect(page.getByTestId('aviso-resultado')).toContainText('2 conteúdo(s)');
    await expect(page.locator('[data-testid="janela-linha"]')).toHaveCount(1);
    // Cartão vermelho fora do desenho da praça; abre a fila.
    await page.getByTestId('janela-fechar').click();
    await page.getByTestId('cartao-validacao').click();
    await expect(page.getByTestId('tela-validacao')).toBeVisible();
    const item = page.locator(`[data-testid="validacao-item"][data-numero="81${s}"]`);
    await expect(item).toContainText('Não encontrados no palete (teste)');
    await expect(item).toContainText(`palete ${origem.code}`);
    await capturar(page, '04-validacao-sem-endereco');
    await item.getByTestId('validacao-marcar').check();
    await page.locator(`[data-testid="validacao-item"][data-numero="82${s}"]`).getByTestId('validacao-marcar').check();
    await page.getByTestId('escolher-busca').fill(destino.code);
    await page.getByTestId('escolher-palete').first().click();
    await expect(page.getByTestId('acao-destino')).toContainText(destino.code);
    await page.getByTestId('acao-mover-confirmar').click();
    await expect(page.getByTestId('validacao-mensagem')).toContainText(`alocado(s) no palete ${destino.code}`);
    await expect(page.locator(`[data-testid="validacao-item"][data-numero="81${s}"]`)).toHaveCount(0);
  });
});
