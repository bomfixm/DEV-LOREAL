import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ehCelular, entrar } from './apoio';

/**
 * Janela do palete → "Adicionar à expedição" (12 nov. 2026), no banco de E2E
 * (dados fictícios): escolhe um veículo em montagem, o palete entra FULL sem
 * posição (mesma criação da Expedição) e um cartão do palete "voa" até o ícone
 * da Expedição no menu, que pula ao receber.
 */
async function api(page: Page, caminho: string, corpo: unknown): Promise<Record<string, unknown>> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  const r = await page.request.fetch(caminho, { method: 'POST', data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
  expect(r.status(), await r.text()).toBeLessThan(300);
  return (await r.json()) as Record<string, unknown>;
}

test('janela do palete: adicionar à expedição escolhendo o veículo, com o palete voando até a Expedição @captura', async ({ page }, testInfo) => {
  test.skip(ehCelular(testInfo), 'Animação até o menu lateral: computador.');
  await entrar(page, 'supervisor');
  const agora = Date.now();
  const janela = (await api(page, '/api/v1/janelas', {
    name: 'Janela fictícia — adicionar pela janela do palete',
    clientReference: 'AUT-FICT-ADD',
    referenceMonth: new Date(agora).toISOString().slice(0, 7),
    exitStart: new Date(agora - 3_600_000).toISOString(),
    exitEnd: new Date(agora + 86_400_000).toISOString(),
    preparationDeadline: null,
    restrictions: [{ metric: 'QUANTIDADE', unit: 'UN', limit: '100' }],
    criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: [], notes: null },
    authorization: { source: 'E-mail fictício', reference: 'ADD-1', date: new Date(agora).toISOString().slice(0, 10), responsible: 'Contato fictício' },
    notes: 'Dados fictícios.',
  })) as { id: string; code?: string };
  const carga = (await api(page, `/api/v1/cargas/janelas/${janela.id}/veiculos`, { kind: 'TRUCK' })) as { window: { code: string }; vehicles: { id: string; label: string }[] };
  const truck = carga.vehicles[0];
  if (!truck) throw new Error('sem veículo');
  const p = (await api(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: null, notes: null, declaredItems: [] })) as { id: string; code: string };
  const lista = (await api(page, `/api/v1/paletes/${p.id}/conteudos`, { sender: 'Remetente Fictício Carrinho', documentType: 'NF', documentNumber: `77${String(agora).slice(-6)}` })) as { items: { id: string; kind: string }[] };
  const nota = lista.items.at(-1);
  if (!nota) throw new Error('sem nota');
  await api(page, `/api/v1/paletes/${p.id}/conteudos/contagens`, { target: { kind: nota.kind, id: nota.id }, counted: 9, origin: 'CONTAGEM_FISICA' });

  await page.goto(`/paletes/${p.id}`);
  await page.getByTestId('acao-adicionar-expedicao').click();
  const escolha = page.getByTestId('adicionar-expedicao');
  await expect(escolha).toContainText(`Adicionar o palete ${p.code}`);
  const botao = escolha.locator(`[data-testid="adicionar-expedicao-veiculo"][data-veiculo="${carga.window.code} ${truck.label}"]`);
  await expect(botao).toContainText('0/16 paletes');
  mkdirSync('docs/capturas/expedicao', { recursive: true });
  await page.screenshot({ path: 'docs/capturas/expedicao/computador-9-adicionar-pela-janela.png' });

  // A animação: o cartão aparece voando e, no fim, o ícone da Expedição recebe o pulo.
  // Para as capturas, as animações rodam a 1/4 da velocidade (só neste teste).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
  await botao.click();
  await expect(page.locator('.voo-palete')).toBeAttached();
  await expect(page.locator('.voo-palete')).toHaveText(`P ${p.code}`);
  for (const quadro of [1, 2, 3, 4]) {
    await page.waitForTimeout(650);
    await page.screenshot({ path: `docs/capturas/expedicao/voo-${String(quadro)}.png` });
  }
  await expect(page.locator('a[data-destino="carga"].voo-recebeu')).toBeAttached();
  await expect(page.locator('.voo-palete')).toHaveCount(0);

  const depois = (await (await page.request.get(`/api/v1/cargas/janelas/${janela.id}`)).json()) as { vehicles: { id: string; pallets: { kind: string; position: number | null; sourcePalletCode: string | null; state: string }[] }[] };
  const noTruck = depois.vehicles.find((v) => v.id === truck.id)?.pallets ?? [];
  expect(noTruck).toHaveLength(1);
  expect(noTruck[0]).toMatchObject({ kind: 'FULL', position: null, sourcePalletCode: p.code, state: 'ATIVO' });

  // De novo no mesmo palete: o servidor recusa (já sai FULL) e a mensagem aparece na escolha.
  await page.getByTestId('acao-adicionar-expedicao').click();
  await page.getByTestId('adicionar-expedicao').locator(`[data-veiculo="${carga.window.code} ${truck.label}"]`).click();
  await expect(page.getByTestId('adicionar-expedicao').getByRole('alert')).toContainText('FULL');
});
