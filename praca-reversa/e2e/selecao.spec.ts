import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { aguardarMapaParado, entrar } from './apoio';

/**
 * Seleção do cliente e conciliação pela interface (complemento), no escopo de
 * demonstração (dados fictícios): inventário conferido → seleção do cliente →
 * resultados com uma NF localizada, uma distribuída em dois paletes e uma sem
 * vínculo → pendências → proposta de separação → reserva pelo fluxo da janela.
 * As capturas (@captura) repetem o percurso e gravam docs/capturas/selecao-cliente.
 */
const PASTA = 'docs/capturas/selecao-cliente';

const CABECALHO = ['DELIVERY', 'TIPO', 'NUMERO', 'VOLUMES', 'REMETENTE', 'MÊS AGENDA', 'JANELA', 'RUA', 'N° Pallet', 'DOCUMENTAÇÃO', 'PALLET FULL', 'PF/CNPJ'];

function csv(linhas: (string | null)[][]): Buffer {
  return Buffer.from(String.fromCharCode(0xfeff) + linhas.map((l) => l.map((c) => c ?? '').join(';')).join('\r\n') + '\r\n', 'utf8');
}

/** Inventário fictício: NF de devolução no PAL-DEMO-004 (com saldo liberado), NF em dois paletes novos e NF com N° Pallet inválido. */
function inventario(s: string, enderecos: [string, string]): Buffer {
  return csv([
    CABECALHO,
    ['80000001', 'DEV', 'DEV-DEMO-01', '4', 'Remetente fictício A', 'Outubro', 'J-DEMO', '11 - A1', 'PAL-DEMO-001', 'VALIDADA', null, 'CNPJ'],
    ['80000002', 'DEV', 'DEV-DEMO-04', '6', 'Remetente fictício B', 'Outubro', 'J-DEMO', '12 - A101', 'PAL-DEMO-004', 'VALIDADA', null, 'CNPJ'],
    [`8000${s}003`, 'NFD', `777${s}001`, '3', 'Remetente fictício C', 'Outubro', null, enderecos[0], `E2E-${s}9101`, 'VALIDAR', '01\\02', 'CNPJ'],
    [`8000${s}003`, 'NFD', `777${s}001`, '2', 'Remetente fictício C', 'Outubro', null, enderecos[1], `E2E-${s}9102`, 'VALIDADA', '02\\02', 'CNPJ'],
    [`8000${s}004`, 'NFD', `777${s}005`, '1', 'Remetente fictício D', null, null, '15 - A121', 'GR - 7', 'VALIDADA', null, 'PF'],
  ]);
}

function selecao(s: string): Buffer {
  return csv([
    ['Palete', 'NF', 'Tipo', 'Linha do pedido', 'SKU', 'Quantidade solicitada', 'Unidade'],
    [null, 'DEV-DEMO-04', 'DEV', '1', null, null, null],
    [null, `777${s}001`, 'NFD', '2', null, null, null],
    [null, `777${s}005`, 'NFD', '3', null, null, null],
    [null, `777${s}099`, 'NFD', '4', null, null, null],
  ]);
}

async function capturar(page: Page, nome: string | null): Promise<void> {
  if (nome === null) return;
  mkdirSync(PASTA, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${PASTA}/${nome}.png` });
}

async function chamar(page: Page, metodo: 'POST', caminho: string, corpo: unknown): Promise<APIResponse> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return page.request.fetch(caminho, { method: metodo, data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
}

async function enviarArquivo(page: Page, tipo: 'INVENTARIO' | 'SELECAO_CLIENTE', nome: string, conteudo: Buffer): Promise<void> {
  await page.goto(`/importacoes/nova?tipo=${tipo}`);
  await expect(page.getByTestId(`tipo-${tipo}`)).toBeChecked();
  await page.getByTestId('arquivo-importacao').setInputFiles({ name: nome, mimeType: 'text/csv', buffer: conteudo });
  await page.getByTestId('enviar-arquivo').click();
  await expect(page.getByTestId('secao-mapeamento')).toBeVisible();
  await expect(page.getByTestId('interpretacao')).toBeVisible();
}

async function confirmarLote(page: Page): Promise<void> {
  await page.getByTestId('confirmar-revisao').check();
  await page.getByTestId('confirmar-importacao').click();
  await expect(page.getByTestId('aviso-confirmacao')).toContainText('confirmada pelo servidor');
  await expect(page.getByTestId('resumo-lote')).toHaveAttribute('data-situacao', 'CONFIRMADO');
}

/** Inventário conferido pela tela: parâmetros explícitos, prévia com ações, conjunto aplicado. */
async function importarInventario(page: Page, s: string, enderecos: [string, string], fotos: Record<string, string> | null): Promise<void> {
  await enviarArquivo(page, 'INVENTARIO', `inventario-ficticio-${s}.csv`, inventario(s, enderecos));
  await expect(page.getByTestId('coluna-address')).not.toHaveValue('');
  await expect(page.getByTestId('coluna-palletNumber')).not.toHaveValue('');
  const p = page.getByTestId('parametros-inventario');
  await page.getByTestId('param-descricao').fill(`Inventário fictício conferido (${s})`);
  await page.getByTestId('param-referencia-conferencia').fill(`CONF-E2E-${s}`);
  await page.getByTestId('param-data-conferencia').fill('2026-09-28');
  await page.getByTestId('param-definitivo').check();
  await page.getByTestId('param-npallet-palete').check();
  await p.getByRole('button', { name: 'Acrescentar definição' }).click();
  await p.getByLabel('Sigla').fill('DEV');
  await p.getByLabel('Significado confirmado').fill('Devolução fictícia da demonstração');
  await p.getByLabel('Origem nos registros').selectOption('DEVOLUCAO');
  await capturar(page, fotos?.parametros ?? null);
  await page.getByTestId('gerar-previa').click();
  await expect(page.getByTestId('secao-previa')).toBeVisible();
  await expect(page.getByTestId('resumo-previa')).toContainText('Saldo validado por produto não muda');
  await expect(page.locator('[data-testid="linha-importacao"][data-linha="6"]')).toHaveAttribute('data-classificacao', 'CONFLITANTE');
  await expect(page.locator('[data-testid="linha-importacao"][data-linha="4"] [data-testid="acao-linha"]')).toContainText('criar cadastro proposto');
  await capturar(page, fotos?.previa ?? null);
  await expect(page.getByTestId('total-aplicaveis')).not.toHaveText('…');
  await page.getByTestId('secao-confirmar').scrollIntoViewIfNeeded();
  await capturar(page, fotos?.confirmar ?? null);
  await confirmarLote(page);
  await expect(page.getByTestId('resultado-gravacao')).toContainText('Saldo validado por produto não mudou');
}

async function importarSelecao(page: Page, s: string, fotos: Record<string, string> | null): Promise<void> {
  await enviarArquivo(page, 'SELECAO_CLIENTE', `selecao-cliente-${s}.csv`, selecao(s));
  await page.getByTestId('param-pedido').fill(`PED-E2E-${s}`);
  const inventarioOpcao = page.getByTestId('param-inventario').locator('option', { hasText: `Inventário fictício conferido (${s})` });
  await expect(inventarioOpcao).toHaveCount(1);
  await page.getByTestId('param-inventario').selectOption({ label: (await inventarioOpcao.textContent()) ?? '' });
  await page.getByTestId('param-nf-sem-quantidade').selectOption('TODO_MATERIAL_DO_INVENTARIO');
  await capturar(page, fotos?.parametros ?? null);
  await page.getByTestId('gerar-previa').click();
  await expect(page.getByTestId('secao-previa')).toBeVisible();
  await expect(page.getByTestId('resumo-previa')).toContainText(`Pedido PED-E2E-${s}`);
  await capturar(page, fotos?.previa ?? null);
  await confirmarLote(page);
  await page.getByTestId('ver-selecao').click();
  await expect(page.getByTestId('tela-selecao')).toBeVisible();
  await expect(page.getByTestId('tabela-conciliacao')).toBeVisible();
}

const linha = (page: Page, n: number) => page.locator(`[data-testid="linha-conciliacao"][data-linha="${String(n)}"]`);

async function janelaConfirmada(page: Page, nome: string): Promise<void> {
  const agora = Date.now();
  const criar = await chamar(page, 'POST', '/api/v1/janelas', {
    name: nome,
    clientReference: 'AUT-FICT-E2E',
    referenceMonth: new Date(agora).toISOString().slice(0, 7),
    exitStart: new Date(agora - 6 * 3_600_000).toISOString(),
    exitEnd: new Date(agora + 30 * 3_600_000).toISOString(),
    preparationDeadline: null,
    restrictions: [{ metric: 'QUANTIDADE', unit: 'UN', limit: '100' }],
    criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: [], notes: null },
    authorization: { source: 'E-mail fictício do cliente', reference: 'AUT-E2E', date: '2026-10-01', responsible: 'Contato fictício' },
    notes: 'Janela fictícia do teste de interface.',
  });
  expect(criar.status(), await criar.text()).toBe(200);
  const j = (await criar.json()) as { id: string; version: number };
  const confirmar = await chamar(page, 'POST', `/api/v1/janelas/${j.id}/confirmar`, { expectedVersion: j.version });
  expect(confirmar.status(), await confirmar.text()).toBe(200);
}

/** Percurso completo no computador (com fotos quando `capturas`). */
async function percursoComputador(page: Page, capturas: boolean): Promise<void> {
  const s = 'D';
  const foto = (nome: string) => (capturas ? nome : null);
  await entrar(page, 'supervisorDemo');
  await page.goto('/selecoes');
  await expect(page.getByTestId('tela-selecoes')).toBeVisible();
  await capturar(page, foto('01-selecao-do-cliente-vazia'));

  await importarInventario(page, s, ['15 - A101', '15 - A103'], capturas ? { parametros: '02-inventario-parametros', previa: '03-inventario-previa-acoes', confirmar: '04-inventario-conjunto-aplicado' } : null);
  await page.getByTestId('ver-inventario').click();
  await expect(page.getByTestId('resumo-inventario')).toBeVisible();
  await expect(page.getByTestId('totais-inventario')).toContainText('5:');
  await capturar(page, foto('05-inventario-de-referencia'));

  await importarSelecao(page, s, capturas ? { parametros: '06-selecao-parametros', previa: '07-selecao-previa' } : null);
  // Resultados: NF localizada (com saldo liberado), NF em dois paletes, NF sem vínculo e NF não encontrada.
  await expect(linha(page, 2)).toHaveAttribute('data-situacao', 'LOCALIZADO');
  await expect(linha(page, 3)).toContainText(`E2E-${s}9101`);
  await expect(linha(page, 3)).toContainText(`E2E-${s}9102`);
  await expect(linha(page, 3)).toContainText('15 - A101');
  await expect(linha(page, 4)).toHaveAttribute('data-situacao', 'DOCUMENTO_SEM_PALETE');
  await expect(linha(page, 5)).toHaveAttribute('data-situacao', 'NAO_ENCONTRADO');
  await expect(page.getByTestId('paletes-distintos')).toHaveText('3');
  await capturar(page, foto('08-conciliacao-resultados'));

  // Detalhe da NF distribuída: os dois paletes, informado × atual, e o mapa centralizado.
  await linha(page, 3).getByTestId('abrir-linha').click();
  const detalhe = page.getByTestId('detalhe-linha-selecao');
  await expect(detalhe.getByTestId('alocacao')).toHaveCount(2);
  await expect(detalhe).toContainText('volumes (não são unidades de produto)');
  await capturar(page, foto('09-detalhe-nf-em-dois-paletes'));
  await detalhe.getByTestId('centralizar-alocacao').first().click();
  await aguardarMapaParado(page);
  await expect(page.getByTestId('mapa-selecao-secao')).toContainText('Destaque da linha 3');
  await capturar(page, foto('10-mapa-posicoes-conhecidas'));

  // Pendências: filtro e exportação (CSV autorizado, com a base da consulta).
  await page.getByTestId('filtro-situacao-DOCUMENTO_SEM_PALETE').click();
  await expect(page.getByTestId('linha-conciliacao')).toHaveCount(1);
  await capturar(page, foto('11-filtro-nf-sem-palete'));
  const baixar = page.waitForEvent('download');
  await page.getByTestId('exportar-pendencias').click();
  const arquivo = await baixar;
  expect(arquivo.suggestedFilename()).toMatch(/^pendencias-SEL-\d+\.csv$/);
  await page.getByTestId('filtro-situacao-DOCUMENTO_SEM_PALETE').click();

  // Proposta para a janela e reserva pelo fluxo da etapa 08.
  await janelaConfirmada(page, `Janela fictícia da seleção (${s})`);
  await page.reload();
  await expect(linha(page, 2)).toHaveAttribute('data-situacao', 'LOCALIZADO');
  await linha(page, 2).getByTestId('marcar-linha').check();
  await linha(page, 4).getByTestId('marcar-linha').check();
  await expect(page.getByTestId('marcadas')).toContainText('2 linha(s) marcada(s), 1 elegível(is)');
  const proposta = page.getByTestId('secao-proposta-janela');
  await proposta.getByTestId('escolher-janela').selectOption({ label: (await proposta.getByTestId('escolher-janela').locator('option', { hasText: `Janela fictícia da seleção (${s})` }).textContent()) ?? '' });
  await proposta.getByTestId('montar-proposta').click();
  await expect(proposta.getByTestId('itens-proposta')).toContainText('PAL-DEMO-004');
  await expect(proposta.getByTestId('itens-proposta')).toContainText('DEMO-103');
  await expect(proposta.getByTestId('verificacao-reserva')).toContainText('pode reservar');
  await proposta.scrollIntoViewIfNeeded();
  await capturar(page, foto('12-proposta-para-a-janela'));
  await proposta.getByTestId('revisei-proposta').check();
  await proposta.getByTestId('confirmar-reserva-selecao').click();
  await expect(proposta.getByTestId('mensagem-proposta')).toContainText('confirmada pelo fluxo da janela');
  await capturar(page, foto('13-reserva-confirmada'));
  await proposta.getByTestId('abrir-reserva').click();
  await expect(page.getByTestId('lista-preparacao')).toContainText('PAL-DEMO-004');
  await capturar(page, foto('14-lista-de-preparacao-da-reserva'));

  // Palete: documentos informados no inventário; busca por NF revela as duas alocações.
  await page.goto('/selecoes');
  await capturar(page, foto('15-historico-de-selecoes'));
}

test.describe('seleção do cliente', () => {
  test('computador: inventário → seleção → localizada, em dois paletes e sem vínculo → pendências → proposta → reserva', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Fluxo de computador.');
    test.setTimeout(240_000);
    await percursoComputador(page, false);
    // Documentos do inventário no detalhe do palete e busca por NF (base própria, sem quantidade de produto).
    await page.goto('/');
    await page.getByTestId('campo-busca').fill('777D001');
    const vinculos = page.locator('[data-testid="resultado-busca"][data-base="INVENTARIO"]');
    await expect(vinculos).toHaveCount(2);
    await expect(vinculos.first()).toContainText('não são unidades de produto nem saldo validado');
  });

  test('celular: lista vira cartões e o detalhe mostra os paletes da NF', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Fluxo de celular.');
    test.setTimeout(240_000);
    const s = 'C';
    await entrar(page, 'supervisorDemo');
    await importarInventario(page, s, ['15 - A105', '15 - A107'], null);
    await importarSelecao(page, s, null);
    await expect(linha(page, 3)).toContainText(`E2E-${s}9101`);
    // Celular: cada linha é um cartão com rótulos por campo.
    await expect(linha(page, 3).locator('td[data-rotulo="Situação"]')).toBeVisible();
    await linha(page, 3).getByTestId('abrir-linha').click();
    await expect(page.getByTestId('detalhe-linha-selecao').getByTestId('alocacao')).toHaveCount(2);
    await expect(page.getByTestId('mapa-selecao-secao')).toBeVisible();
  });
});

test.describe('capturas seleção do cliente @captura', () => {
  test('computador: percurso da seleção do cliente', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Fluxo de computador.');
    test.setTimeout(300_000);
    await percursoComputador(page, true);
  });
});
