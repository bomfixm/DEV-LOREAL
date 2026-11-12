import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ehCelular, entrar } from './apoio';

/**
 * Expedição DHL — carga por veículo (11 nov. 2026), no banco de E2E (dados
 * fictícios): janela com duas carretas e um truck, paletes FULL e
 * fracionado, posições planejadas e confirmadas, físico conferido, visão do
 * administrativo e capturas da tela. Nada aqui baixa estoque.
 */
const PASTA = 'docs/capturas/expedicao';

async function api(page: Page, metodo: 'POST' | 'PUT', caminho: string, corpo: unknown): Promise<Record<string, unknown>> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  const r = await page.request.fetch(caminho, { method: metodo, data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
  expect(r.status(), await r.text()).toBeLessThan(300);
  return (await r.json()) as Record<string, unknown>;
}

interface Carga {
  vehicles: { id: string; label: string; version: number; pallets: { id: string; number: number; version: number; revision: number; lines: { id: string }[] }[] }[];
}

async function origem(page: Page, volumes: number[], remetente: string): Promise<{ id: string; code: string; conteudos: { id: string; kind: string }[] }> {
  const p = (await api(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: null, notes: null, declaredItems: [] })) as { id: string; code: string };
  for (const [i, v] of volumes.entries()) {
    const lista = (await api(page, 'POST', `/api/v1/paletes/${p.id}/conteudos`, { sender: remetente, documentType: 'NF', documentNumber: `${String(4100 + i)}${String(Math.floor(Math.random() * 900) + 100)}` })) as { items: { id: string; kind: string }[] };
    const novo = lista.items.at(-1);
    if (!novo) throw new Error('sem conteúdo');
    await api(page, 'POST', `/api/v1/paletes/${p.id}/conteudos/contagens`, { target: { kind: novo.kind, id: novo.id }, counted: v, origin: 'CONTAGEM_FISICA' });
  }
  const lista = (await (await page.request.get(`/api/v1/paletes/${p.id}/conteudos`)).json()) as { items: { id: string; kind: string }[] };
  return { id: p.id, code: p.code, conteudos: lista.items.map((i) => ({ id: i.id, kind: i.kind === 'IMPORTADO' ? 'VINCULO' : 'CONTEUDO' })) };
}

test.describe('Expedição DHL', () => {
  test('montagem com duas carretas e um truck, detalhe do palete e visão do administrativo @captura', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    mkdirSync(PASTA, { recursive: true });
    const nome = (n: string) => `${PASTA}/${ehCelular(testInfo) ? 'celular' : 'computador'}-${n}.png`;
    await entrar(page, 'supervisor');
    const agora = Date.now();
    const janela = (await api(page, 'POST', '/api/v1/janelas', {
      name: 'Janela fictícia 10/11 — Expedição',
      clientReference: 'AUT-FICT-EXP',
      referenceMonth: new Date(agora).toISOString().slice(0, 7),
      exitStart: new Date(agora - 3_600_000).toISOString(),
      exitEnd: new Date(agora + 86_400_000).toISOString(),
      preparationDeadline: null,
      restrictions: [{ metric: 'QUANTIDADE', unit: 'UN', limit: '100' }],
      criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: [], notes: null },
      authorization: { source: 'E-mail fictício', reference: 'EXP-1', date: new Date(agora).toISOString().slice(0, 10), responsible: 'Contato fictício' },
      notes: 'Dados fictícios.',
    })) as { id: string };
    await api(page, 'POST', `/api/v1/cargas/janelas/${janela.id}/veiculos`, { kind: 'CARRETA' });
    await api(page, 'POST', `/api/v1/cargas/janelas/${janela.id}/veiculos`, { kind: 'CARRETA' });
    let c = (await api(page, 'POST', `/api/v1/cargas/janelas/${janela.id}/veiculos`, { kind: 'TRUCK' })) as unknown as Carga;
    const carreta = c.vehicles[0]?.id ?? '';
    // Paletes de origem fictícios: dois FULL e um de 20 volumes fracionado (8 embarcam).
    const o1 = await origem(page, [30, 12], 'Comercial Fictícia A');
    const o2 = await origem(page, [18], 'Distribuidora Fictícia B');
    const o3 = await origem(page, [20, 6], 'Remetente Fictício C');
    await api(page, 'POST', `/api/v1/cargas/veiculos/${carreta}/paletes`, { kind: 'FULL', number: 1, position: 1, sourcePalletId: o1.id });
    await api(page, 'POST', `/api/v1/cargas/veiculos/${carreta}/paletes`, { kind: 'FULL', number: 2, position: 2, sourcePalletId: o2.id });
    c = (await api(page, 'POST', `/api/v1/cargas/veiculos/${carreta}/paletes`, {
      kind: 'FRACIONADO',
      number: 7,
      position: 5,
      lines: [
        { occurrence: o3.conteudos[0], volumes: 8 },
        { occurrence: o3.conteudos[1], volumes: 6 },
      ],
    })) as unknown as Carga;
    const ps = c.vehicles[0]?.pallets ?? [];
    const p1 = ps.find((p) => p.number === 1);
    const p7 = ps.find((p) => p.number === 7);
    if (!p1 || !p7) throw new Error('paletes ausentes');
    // P01 confirmado e conferido; P07 com físico conferido e uma NF faltante no administrativo.
    c = (await api(page, 'POST', `/api/v1/cargas/paletes/${p1.id}/confirmacao`, { expectedVersion: p1.version, confirmed: true })) as unknown as Carga;
    const p1b = c.vehicles[0]?.pallets.find((p) => p.number === 1);
    if (p1b) await api(page, 'POST', `/api/v1/cargas/paletes/${p1b.id}/fisico`, { expectedVersion: p1b.version, revision: p1b.revision });
    c = (await api(page, 'POST', `/api/v1/cargas/paletes/${p7.id}/fisico`, { expectedVersion: p7.version, revision: p7.revision })) as unknown as Carga;
    const p7b = c.vehicles[0]?.pallets.find((p) => p.number === 7);
    if (p7b) {
      await api(page, 'POST', `/api/v1/cargas/paletes/${p7b.id}/documentos`, { revision: p7b.revision, lineId: p7b.lines[0]?.id, state: 'CONFERIDO', note: null });
      await api(page, 'POST', `/api/v1/cargas/paletes/${p7b.id}/documentos`, { revision: p7b.revision, lineId: p7b.lines[1]?.id, state: 'FALTANTE', note: 'Segunda via não veio' });
    }

    // Seleção: resumo da janela e um card por veículo; o card abre o mapa.
    await page.goto(`/expedicao?janela=${janela.id}`);
    await expect(page.getByTestId('selecao-veiculos')).toBeVisible();
    await expect(page.getByTestId('kpi-veiculos')).toContainText('3');
    await expect(page.getByTestId('kpi-paletes')).toContainText('3/72');
    await expect(page.getByTestId('card-Carreta 01')).toContainText('Carregando');
    await expect(page.getByTestId('card-Carreta 02')).toContainText('Não iniciada');
    await page.screenshot({ path: nome('0-selecao'), fullPage: true });
    await page.getByTestId('card-Carreta 01').click();
    await expect(page).toHaveURL(new RegExp(`veiculo=${carreta}`));
    await page.getByTestId('carga-voltar').click();
    await expect(page.getByTestId('selecao-veiculos')).toBeVisible();

    // Operação: mapa da carreta.
    await page.goto(`/expedicao?janela=${janela.id}&veiculo=${carreta}`);
    await expect(page.getByTestId('tela-carga')).toBeVisible();
    await expect(page.getByTestId('carga-ocupacao')).toHaveText('3/28 paletes');
    await expect(page.getByTestId('veiculo-Carreta 02')).toBeVisible();
    await expect(page.getByTestId('veiculo-Truck 01')).toBeVisible();
    await expect(page.getByTestId('disposicao-provisoria')).toBeVisible();
    await expect(page.getByTestId('carga-baixa')).toContainText('não baixa estoque');
    await page.screenshot({ path: nome('1-mapa'), fullPage: true });

    // Detalhe do P07 (fracionado: 8 + 6 volumes, físico conferido, um documento faltante).
    await page.getByTestId('palete-P07').click();
    await expect(page.getByTestId('carga-identidade')).toContainText('Carreta 01 · Palete 07');
    await expect(page.getByTestId('carga-detalhe')).toContainText('14 volume(s)');
    await page.screenshot({ path: nome('2-detalhe-palete'), fullPage: true });

    // Posição livre: alocar um fracionado pelo código do palete de origem.
    await page.getByTestId('posicao-6').click();
    await page.getByTestId('origem-codigo').fill(o3.code);
    await page.getByTestId('origem-buscar').click();
    await expect(page.getByTestId('carga-origem')).toBeVisible();
    await page.locator('input[type="radio"]').nth(1).check();
    await page.screenshot({ path: nome('3-alocar'), fullPage: true });
    await page.locator('[data-testid^="volumes-"]').first().fill('4');
    await page.getByTestId('alocar-palete').click();
    await expect(page.getByTestId('carga-ocupacao')).toHaveText('4/28 paletes');

    // Administrativo: fila e checklist do P07.
    await page.getByTestId('visao-adm').click();
    await expect(page.getByTestId('fila-adm')).toBeVisible();
    await page.getByTestId('adm-P07').click();
    await expect(page.getByTestId('checklist-docs')).toContainText('Faltante');
    await page.screenshot({ path: nome('4-administrativo'), fullPage: true });
    if (ehCelular(testInfo)) return;

    // Impressões (a janela de impressão do navegador é substituída por captura em modo de impressão).
    await page.evaluate(() => {
      window.print = () => undefined;
    });
    const imprimir = async (acao: () => Promise<void>, arquivo: string, tipo: string) => {
      await acao();
      await expect(page.locator(`[data-testid="carga-impressao"][data-tipo="${tipo}"]`)).toBeAttached();
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: `${PASTA}/${arquivo}.pdf`, format: 'A4', landscape: true, printBackground: true });
      await page.emulateMedia({ media: 'screen' });
      await page.reload();
      await page.evaluate(() => {
        window.print = () => undefined;
      });
    };
    await imprimir(async () => { await page.getByTestId('imprimir-docs').click(); }, 'impressao-lista-documentos', 'DOCUMENTOS');
    await page.getByTestId('visao-operacao').click();
    await imprimir(async () => { await page.getByTestId('palete-P07').click(); await page.getByTestId('imprimir-espelho-final').click(); }, 'impressao-espelho-final', 'ESPELHO');
    await imprimir(async () => { await page.getByTestId('palete-P07').click(); await page.getByTestId('imprimir-etiqueta').click(); }, 'impressao-etiqueta', 'ETIQUETA');
    await imprimir(async () => { await page.getByRole('button', { name: 'Imprimir prévia do mapa' }).click(); }, 'impressao-mapa-previa', 'MAPA');
    // Espelho de embarque com o editor de layout (12 nov. 2026): a mesma folha dos espelhos da praça, paginada,
    // com o layout aplicado neste computador; o pedido de impressão leva o layout capturado na emissão.
    // Padrão (Operacional limpo do embarque), em rascunho: aviso, identidade e número sem sobreposição.
    await page.getByTestId('palete-P07').click();
    await page.getByRole('button', { name: 'Espelho (rascunho)' }).click();
    const padrao = page.locator('[data-testid="carga-impressao"][data-tipo="ESPELHO"] .espelho-folha').first();
    await expect(padrao).toBeAttached();
    await page.emulateMedia({ media: 'print' });
    const sobrepostos = await padrao.evaluate((folha) => {
      const caixas = [...folha.querySelectorAll<HTMLElement>('[data-campo]')].map((el) => ({ c: el.dataset.campo, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }));
      return caixas.flatMap((a, i) => caixas.slice(i + 1).filter((b) => a.x + 1 < b.x + b.w && b.x + 1 < a.x + a.w && a.y + 1 < b.y + b.h && b.y + 1 < a.y + a.h).map((b) => `${a.c ?? ''}×${b.c ?? ''}`));
    });
    expect(sobrepostos).toEqual([]);
    await padrao.screenshot({ path: `${PASTA}/impressao-espelho-padrao.png` });
    await page.emulateMedia({ media: 'screen' });
    await page.reload();
    await page.evaluate(() => {
      window.print = () => undefined;
    });
    await page.getByTestId('palete-P07').click();
    await page.getByTestId('editar-layout-espelho').click();
    const editor = page.getByTestId('editor-layout');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveCSS('position', 'fixed');
    await expect(editor.getByTestId('ed-navegacao')).toContainText('P07');
    await editor.locator('[data-campo-editor="palete"]').click();
    await editor.getByTestId('ed-tamanho').fill('48');
    await page.screenshot({ path: nome('6-editor-espelho'), fullPage: true });
    await editor.getByTestId('ed-aplicar').click();
    await expect(editor).toBeHidden();
    await page.getByRole('button', { name: 'Espelho (rascunho)' }).click();
    const folha = page.locator('[data-testid="carga-impressao"][data-tipo="ESPELHO"] .espelho-folha[data-documento="embarque"]').first();
    await expect(folha).toBeAttached();
    expect(await folha.locator('[data-campo="palete"]').evaluate((el) => (el as HTMLElement).style.fontSize)).toBe('48pt');
    await expect(folha.locator('[data-campo="rascunho"]')).toContainText('RASCUNHO');
    await expect(folha.locator('tbody tr.ef-total')).toContainText('TOTAL DO PALETE');
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: `${PASTA}/impressao-espelho-editor.pdf`, format: 'A4', landscape: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    await page.reload();

    // Lote: vários paletes do veículo numa impressão só; o espelho final leva só os de físico conferido (P01 e P07).
    await page.evaluate(() => {
      window.print = () => undefined;
    });
    const lote = page.getByTestId('impressao-lote');
    await lote.locator('summary').click();
    await expect(lote).toContainText('4 de 4 marcados');
    await expect(page.getByTestId('lote-espelhos-finais')).toHaveText('Espelhos finais (2)');
    await page.getByTestId('lote-P02').uncheck();
    await expect(page.getByTestId('lote-espelhos-rascunho')).toHaveText('Espelhos rascunho (3)');
    await expect(page.getByTestId('lote-aviso-final')).toContainText('1 palete(s)');
    await page.screenshot({ path: nome('7-impressao-lote'), fullPage: true });
    await page.getByTestId('lote-espelhos-rascunho').click();
    const impressaoLote = page.locator('[data-testid="carga-impressao"][data-tipo="ESPELHO"]');
    await expect(impressaoLote).toHaveAttribute('data-paletes', '3');
    await expect(page.getByTestId('carga-mensagem')).toContainText('3 palete(s)');
    const paletesNoLote = await impressaoLote.locator('.espelho-folha').evaluateAll((fs) => [...new Set(fs.map((f) => (f as HTMLElement).dataset.palete ?? ''))]);
    expect(paletesNoLote).toHaveLength(3);
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: `${PASTA}/impressao-espelhos-lote.pdf`, format: 'A4', landscape: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    await page.reload();
    await page.evaluate(() => {
      window.print = () => undefined;
    });
    await page.getByTestId('impressao-lote').locator('summary').click();
    await page.getByTestId('lote-espelhos-finais').click();
    await expect(page.locator('[data-testid="carga-impressao"][data-tipo="ESPELHO"]')).toHaveAttribute('data-paletes', '2');
    await expect(page.locator('[data-testid="carga-impressao"] [data-campo="rascunho"]')).toHaveCount(0);
    await page.reload();
    await page.evaluate(() => {
      window.print = () => undefined;
    });
    await page.getByTestId('impressao-lote').locator('summary').click();
    await page.getByTestId('lote-etiquetas').click();
    await expect(page.locator('[data-testid="carga-impressao"][data-tipo="ETIQUETA"] .impr-etiqueta')).toHaveCount(4);
    await page.reload();

    // A etiqueta impressa aparece como emitida e atual no detalhe.
    await page.getByTestId('palete-P07').click();
    await expect(page.getByTestId('carga-detalhe')).toContainText('Etiqueta final');
  });
});
