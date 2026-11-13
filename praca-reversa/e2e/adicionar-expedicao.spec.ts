import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ehCelular, entrar } from './apoio';

/**
 * Janela do palete → Expedição (12–13 nov. 2026), no banco de E2E (dados
 * fictícios). Por nota: o caminhão na linha inclui só aquela ocorrência (NF
 * 37953, 2 volumes) num fracionado; a 740896 fica fora; uma cópia da nota voa
 * até o atalho "Expedição · N" do mapa, que só soma o que o servidor confirmou.
 * Palete inteiro: ação própria, com resumo; com nota já incluída, a regra atual
 * não deixa sair FULL e só as restantes entram. "Reduzir movimento": sem voo.
 */
async function api(page: Page, caminho: string, corpo: unknown): Promise<Record<string, unknown>> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  const r = await page.request.fetch(caminho, { method: 'POST', data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
  expect(r.status(), await r.text()).toBeLessThan(300);
  return (await r.json()) as Record<string, unknown>;
}

interface Cenario {
  janela: string;
  codigoJanela: string;
  truck: { id: string; label: string };
  palete: { id: string; code: string };
}

/** Janela com um truck em montagem e um palete com duas NFs contadas (2 e 5 volumes). */
async function cenario(page: Page, referencia: string): Promise<Cenario> {
  const agora = Date.now();
  const janela = (await api(page, '/api/v1/janelas', {
    name: `Janela fictícia — ${referencia}`,
    clientReference: referencia,
    referenceMonth: new Date(agora).toISOString().slice(0, 7),
    exitStart: new Date(agora - 3_600_000).toISOString(),
    exitEnd: new Date(agora + 86_400_000).toISOString(),
    preparationDeadline: null,
    restrictions: [{ metric: 'QUANTIDADE', unit: 'UN', limit: '100' }],
    criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: [], notes: null },
    authorization: { source: 'E-mail fictício', reference: referencia, date: new Date(agora).toISOString().slice(0, 10), responsible: 'Contato fictício' },
    notes: 'Dados fictícios.',
  })) as { id: string };
  const carga = (await api(page, `/api/v1/cargas/janelas/${janela.id}/veiculos`, { kind: 'TRUCK' })) as { window: { code: string }; vehicles: { id: string; label: string }[] };
  const truck = carga.vehicles[0];
  if (!truck) throw new Error('sem veículo');
  const p = (await api(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: null, notes: null, declaredItems: [] })) as { id: string; code: string };
  for (const [numero, volumes] of [
    ['37953', 2],
    ['740896', 5],
  ] as const) {
    const lista = (await api(page, `/api/v1/paletes/${p.id}/conteudos`, { sender: 'Remetente Fictício Carrinho', documentType: 'NF', documentNumber: numero })) as { items: { id: string; kind: string }[] };
    const nota = lista.items.at(-1);
    if (!nota) throw new Error('sem nota');
    await api(page, `/api/v1/paletes/${p.id}/conteudos/contagens`, { target: { kind: nota.kind, id: nota.id }, counted: volumes, origin: 'CONTAGEM_FISICA' });
  }
  return { janela: janela.id, codigoJanela: carga.window.code, truck, palete: p };
}

async function notasNaSelecao(page: Page): Promise<number> {
  return ((await (await page.request.get('/api/v1/cargas/selecao')).json()) as { notes: number }).notes;
}

async function paletesDoTruck(page: Page, c: Cenario) {
  const carga = (await (await page.request.get(`/api/v1/cargas/janelas/${c.janela}`)).json()) as {
    vehicles: { id: string; pallets: { kind: string; state: string; lines: { documentNumber: string | null; volumes: number }[] }[] }[];
  };
  return (carga.vehicles.find((v) => v.id === c.truck.id)?.pallets ?? []).filter((p) => p.state === 'ATIVO');
}

test('janela do palete: só a NF 37953 entra e voa até o atalho "Expedição · N"; palete inteiro com resumo e sobreposição @captura', async ({ page }, testInfo) => {
  test.skip(ehCelular(testInfo), 'Captura da animação: computador (o celular é coberto no teste de movimento reduzido).');
  await entrar(page, 'supervisor');
  const c = await cenario(page, 'AUT-FICT-NOTA');
  const antes = await notasNaSelecao(page);

  await page.goto(`/paletes/${c.palete.id}`);
  const linha = page.locator('[data-testid="janela-linha"][data-numero="37953"]');
  await expect(linha).toBeVisible();
  // O rodapé tem a ação explícita do palete inteiro; a linha tem a ação da nota.
  await expect(page.getByTestId('acao-adicionar-expedicao')).toHaveText(/Adicionar palete inteiro/);
  await linha.getByTestId('janela-linha-expedicao').click();
  const escolha = page.getByTestId('adicionar-notas');
  await expect(escolha).toContainText('Adicionar NF 37953 à expedição');
  const destino = escolha.locator(`fieldset[data-veiculo="${c.codigoJanela} ${c.truck.label}"] [data-destino="${c.truck.label} novo"]`);
  mkdirSync('docs/capturas/expedicao', { recursive: true });
  await page.screenshot({ path: 'docs/capturas/expedicao/computador-10-nota-escolher-destino.png' });

  // Animação a 1/4 da velocidade só para as capturas.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
  await destino.click();
  await expect(page.locator('.voo-copia')).toHaveText('NF 37953');
  const atalho = page.getByTestId('atalho-expedicao');
  await expect(atalho).toHaveAttribute('data-notas', String(antes + 1));
  await expect(atalho).toContainText(`· ${String(antes + 1)}`);
  for (const quadro of [1, 2, 3]) {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `docs/capturas/expedicao/voo-nota-${String(quadro)}.png` });
  }
  await expect(page.locator('.voo-copia')).toHaveCount(0);
  await expect(page.getByTestId('aviso-resultado')).toContainText(`NF 37953 (palete ${c.palete.code}, 2 volumes)`);
  // No servidor: um fracionado só com a 37953 (2 volumes); a 740896 continua fora.
  const paletes = await paletesDoTruck(page, c);
  expect(paletes).toHaveLength(1);
  expect(paletes[0]?.kind).toBe('FRACIONADO');
  expect(paletes[0]?.lines.map((l) => [l.documentNumber, l.volumes])).toEqual([['37953', 2]]);
  await expect(linha.getByTestId('janela-linha-na-expedicao')).toContainText('Truck 01');
  await expect(page.locator('[data-testid="janela-linha"][data-numero="740896"]').getByTestId('janela-linha-expedicao')).toBeVisible();
  await page.screenshot({ path: 'docs/capturas/expedicao/computador-11-nota-na-expedicao.png' });

  // Palete inteiro depois da nota: resumo com sobreposição; FULL não sai; só a restante entra (sem duplicar).
  await page.getByTestId('acao-adicionar-expedicao').click();
  await page.getByTestId('adicionar-expedicao').locator(`[data-testid="adicionar-expedicao-veiculo"][data-veiculo="${c.codigoJanela} ${c.truck.label}"]`).click();
  await expect(page.getByTestId('adicionar-expedicao-resumo')).toContainText('2 notas');
  await expect(page.getByTestId('adicionar-expedicao-sobreposicao')).toContainText('NF 37953');
  await expect(page.getByTestId('adicionar-expedicao-confirmar')).toHaveCount(0);
  await page.screenshot({ path: 'docs/capturas/expedicao/computador-12-palete-inteiro-sobreposicao.png' });
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  await page.getByTestId('adicionar-expedicao-restantes').click();
  await expect(atalho).toHaveAttribute('data-notas', String(antes + 2));
  expect((await paletesDoTruck(page, c)).flatMap((p) => p.lines.map((l) => l.documentNumber)).sort()).toEqual(['37953', '740896']);

  // O atalho abre a Expedição que já existe (no veículo) e, ao voltar, mostra a mesma seleção.
  await page.keyboard.press('Escape');
  await atalho.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/expedicao\\?.*janela=${c.janela}`));
  await page.goBack();
  await expect(page.getByTestId('atalho-expedicao')).toHaveAttribute('data-notas', String(antes + 2));
});

test('movimento reduzido: a nota entra e o contador sobe sem voo nem pulso; repetir não soma', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await entrar(page, 'supervisor');
  const c = await cenario(page, 'AUT-FICT-REDUZIDO');
  const antes = await notasNaSelecao(page);
  await page.goto(`/paletes/${c.palete.id}`);
  const linha = page.locator('[data-testid="janela-linha"][data-numero="740896"]');
  await linha.getByTestId('janela-linha-expedicao').click();
  await page.getByTestId('adicionar-notas-volumes').fill('3');
  await page.getByTestId('adicionar-notas').locator(`fieldset[data-veiculo="${c.codigoJanela} ${c.truck.label}"] [data-destino="${c.truck.label} novo"]`).click();
  await expect(page.getByTestId('aviso-resultado')).toContainText('NF 740896');
  await expect(page.getByTestId('aviso-resultado')).toContainText('3 volumes');
  await expect(page.locator('.voo-copia')).toHaveCount(0);
  expect(await notasNaSelecao(page)).toBe(antes + 1);
  // Parcial preservado (3 de 5) e a outra nota fora.
  expect((await paletesDoTruck(page, c)).flatMap((p) => p.lines.map((l) => [l.documentNumber, l.volumes]))).toEqual([['740896', 3]]);
  // A mesma nota de novo (outra chave): o servidor recusa e o contador não muda.
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  const conteudos = (await (await page.request.get(`/api/v1/paletes/${c.palete.id}/conteudos`)).json()) as { items: { id: string; documentNumber: string | null }[] };
  const ocorrencia = conteudos.items.find((i) => i.documentNumber === '740896');
  const repetida = await page.request.fetch(`/api/v1/cargas/veiculos/${c.truck.id}/notas`, {
    method: 'POST',
    data: { sourcePalletId: c.palete.id, lines: [{ occurrence: { kind: 'CONTEUDO', id: ocorrencia?.id } }] },
    headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() },
  });
  expect(repetida.status()).toBe(409);
  expect(await notasNaSelecao(page)).toBe(antes + 1);
});
