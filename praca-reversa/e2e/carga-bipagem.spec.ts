import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ehCelular, entrar } from './apoio';

/**
 * Expedição — palete fracionado pela bipagem (12 nov. 2026), no banco de E2E
 * (dados fictícios). A planilha "Etiquetas" do palete de embarque é lida sem
 * gravar: NF com uma origem com saldo vem marcada; NF em dois paletes pede
 * escolha; sem saldo ou sem origem fica pendente. "Alocar" cria o fracionado só
 * com as NFs prontas.
 */
const PASTA = 'docs/capturas/expedicao';

async function api(page: Page, metodo: 'POST' | 'PUT', caminho: string, corpo: unknown): Promise<Record<string, unknown>> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  const r = await page.request.fetch(caminho, { method: metodo, data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
  expect(r.status(), await r.text()).toBeLessThan(300);
  return (await r.json()) as Record<string, unknown>;
}

/** Palete de origem com NFs de número fixo e volumes contados. */
async function origem(page: Page, notas: [string, number][]): Promise<{ id: string; code: string }> {
  const p = (await api(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: null, notes: null, declaredItems: [] })) as { id: string; code: string };
  for (const [numero, volumes] of notas) {
    const lista = (await api(page, 'POST', `/api/v1/paletes/${p.id}/conteudos`, { sender: 'Remetente Fictício Bipagem', documentType: 'NF', documentNumber: numero })) as { items: { id: string; kind: string }[] };
    const novo = lista.items.at(-1);
    if (!novo) throw new Error('sem conteúdo');
    await api(page, 'POST', `/api/v1/paletes/${p.id}/conteudos/contagens`, { target: { kind: novo.kind, id: novo.id }, counted: volumes, origin: 'CONTAGEM_FISICA' });
  }
  return p;
}

test('Expedição: palete fracionado pela bipagem — prévia com origens, escolha e alocação só das NFs prontas @captura', async ({ page }, testInfo) => {
  test.skip(ehCelular(testInfo), 'Montagem da carga pelo arquivo: computador.');
  test.setTimeout(180_000);
  await entrar(page, 'supervisor');
  const s = randomUUID().replace(/\D/g, '').slice(0, 5).padEnd(5, '3');
  const agora = Date.now();
  const janela = (await api(page, 'POST', '/api/v1/janelas', {
    name: 'Janela fictícia — bipagem do embarque',
    clientReference: 'AUT-FICT-BIP',
    referenceMonth: new Date(agora).toISOString().slice(0, 7),
    exitStart: new Date(agora - 3_600_000).toISOString(),
    exitEnd: new Date(agora + 86_400_000).toISOString(),
    preparationDeadline: null,
    restrictions: [{ metric: 'QUANTIDADE', unit: 'UN', limit: '100' }],
    criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: [], notes: null },
    authorization: { source: 'E-mail fictício', reference: 'BIP-1', date: new Date(agora).toISOString().slice(0, 10), responsible: 'Contato fictício' },
    notes: 'Dados fictícios.',
  })) as { id: string };
  const c = (await api(page, 'POST', `/api/v1/cargas/janelas/${janela.id}/veiculos`, { kind: 'CARRETA' })) as { vehicles: { id: string }[] };
  const carreta = c.vehicles[0]?.id ?? '';
  // A: NF 1 (20 vol), NF 2 (6 vol), NF 3 (2 vol). B: NF 2 de novo (5 vol). NF 9 não existe na praça.
  const a = await origem(page, [[`8${s}1`, 20], [`8${s}2`, 6], [`8${s}3`, 2]]);
  const b = await origem(page, [[`8${s}2`, 5]]);
  const arquivo = Buffer.from(
    [
      'Tipo;Número;Volumes;Lidos;Destino;Remetente',
      `NF-e;8${s}1;20;8;LOU;Remetente Fictício Bipagem`,
      `NF-e;8${s}2;6;4;LOU;Remetente Fictício Bipagem`,
      `NF-e;8${s}3;4;4;LOU;Remetente Fictício Bipagem`,
      `NF-e;8${s}9;3;3;LOU;Remetente Fictício Bipagem`,
      `NF-e;8${s}8;5;0;LOU;Remetente Fictício Bipagem`,
    ].join('\r\n'),
    'utf8',
  );

  await page.goto(`/expedicao?janela=${janela.id}&veiculo=${carreta}`);
  await page.getByTestId('posicao-1').click();
  await page.getByRole('radio', { name: /Fracionado/ }).check();
  await page.getByTestId('bipagem-embarque-arquivo').setInputFiles({ name: `bipagem-embarque-${s}.csv`, mimeType: 'text/csv', buffer: arquivo });
  await page.getByTestId('bipagem-embarque-ler').click();
  const resumo = page.getByTestId('bipagem-embarque-resumo');
  await expect(resumo).toContainText('4 NF(s)');
  await expect(resumo).toContainText('1 pronta(s)');
  await expect(resumo).toContainText('3 pendente(s)');
  await expect(resumo).toContainText('1 com Lidos = 0');
  const linha = (nf: string) => page.locator(`[data-testid="bipagem-embarque-linha"][data-nf="${nf}"]`);
  await expect(linha(`8${s}1`)).toHaveAttribute('data-situacao', 'PRONTA');
  await expect(linha(`8${s}1`)).toContainText(`Palete ${a.code}`);
  await expect(linha(`8${s}1`)).toContainText('de 20');
  await expect(linha(`8${s}2`)).toHaveAttribute('data-situacao', 'ESCOLHER');
  await expect(linha(`8${s}3`)).toHaveAttribute('data-situacao', 'SEM_SALDO');
  await expect(linha(`8${s}9`)).toHaveAttribute('data-situacao', 'SEM_ORIGEM');
  await expect(linha(`8${s}9`)).toContainText('não encontrada');

  // NF 2 está em A (6) e em B (5): escolher B.
  const seletor = linha(`8${s}2`).getByTestId('bipagem-embarque-origem');
  const valorB = await seletor.locator('option', { hasText: `Palete ${b.code}` }).getAttribute('value');
  await seletor.selectOption(valorB ?? '');
  await expect(linha(`8${s}2`)).toHaveAttribute('data-situacao', 'PRONTA');
  await expect(page.getByTestId('bipagem-embarque-alocar')).toHaveText('Alocar palete com 2 NF(s) · 12 volume(s)');
  mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: `${PASTA}/computador-8-bipagem-fracionado.png`, fullPage: true });

  await page.getByTestId('bipagem-embarque-alocar').click();
  await expect(page.getByTestId('carga-ocupacao')).toHaveText('1/28 paletes');
  const carga = (await (await page.request.get(`/api/v1/cargas/janelas/${janela.id}`)).json()) as { vehicles: { id: string; pallets: { kind: string; position: number | null; lines: { documentNumber: string | null; volumes: number; sourcePalletCode: string }[] }[] }[] };
  const p01 = carga.vehicles.find((v) => v.id === carreta)?.pallets[0];
  expect(p01).toMatchObject({ kind: 'FRACIONADO', position: 1 });
  expect(p01?.lines.map((l) => [l.documentNumber, l.volumes, l.sourcePalletCode]).sort()).toEqual([[`8${s}1`, 8, a.code], [`8${s}2`, 4, b.code]].sort());
});
