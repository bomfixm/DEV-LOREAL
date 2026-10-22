import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { abrirMenuConta, ehCelular, entrar } from './apoio';
import { credenciais, type Credenciais } from './credenciais';

/**
 * "Seleção cliente — teste" pela interface (D267–D273), no escopo de cadastro
 * com dados fictícios: o administrador libera a área para o supervisor na
 * Administração de acesso; o operador continua sem acesso; o supervisor
 * escolhe agenda de teste, pesquisa, escolhe notas e palete inteiro (com a
 * troca quando conflitam), abre o mapa e volta com a pesquisa mantida, revisa,
 * vê a diferença de estoque antes de enviar, envia (bloqueado depois), pede
 * alteração (recusada, depois aprovada), envia a revisão (versão 2) e abre
 * uma solicitação adicional com o aviso de conteúdo já pedido. O estoque não
 * é movimentado. Regras e limites estão nos testes da API
 * (apps/api/test/banco/selecao-teste.test.ts).
 */
const API_TESTE = '/api/v1/selecao-teste';
const CELULAR = 'Fluxo de computador (as regras estão nos testes da API).';

/** Sessão de API de outra conta, num contexto próprio (cookies separados). */
async function sessaoApi(browser: Browser, quem: keyof Credenciais): Promise<{ request: APIRequestContext; csrf: string; fechar: () => Promise<void> }> {
  const contexto = await browser.newContext();
  const { login, senha } = credenciais()[quem];
  const r = await contexto.request.post('/api/v1/sessao', { data: { login, senha } });
  expect(r.ok(), await r.text()).toBe(true);
  const { csrfToken } = (await r.json()) as { csrfToken: string };
  return { request: contexto.request, csrf: csrfToken, fechar: () => contexto.close() };
}

/** Libera ou retira a área para o supervisor do escopo de cadastro (pela API da administração). */
async function concessaoSupervisor(browser: Browser, liberar: boolean): Promise<void> {
  const admin = await sessaoApi(browser, 'adminCadastro');
  const lista = (await (await admin.request.get('/api/v1/admin/usuarios')).json()) as { items: { id: string; login: string; role: string; membershipActive: boolean }[] };
  const u = lista.items.find((x) => x.login === credenciais().supervisor.login);
  if (!u) throw new Error('supervisor do escopo de cadastro não encontrado');
  const r = await admin.request.put(`/api/v1/admin/usuarios/${u.id}/vinculo`, {
    data: { role: u.role, active: u.membershipActive, clientSelectionTest: liberar },
    headers: { 'x-csrf-token': admin.csrf, 'idempotency-key': randomUUID() },
  });
  expect(r.ok(), await r.text()).toBe(true);
  await admin.fechar();
}

/** Chamada da API pela sessão do navegador (CSRF e chave de idempotência). */
async function chamar(page: Page, metodo: 'POST' | 'PATCH', caminho: string, corpo: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  const r = await page.request.fetch(caminho, { method: metodo, data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
  return { status: r.status(), json: (await r.json()) as Record<string, unknown> };
}

/** Palete fictício com notas registradas e contadas (dados do escopo de cadastro do E2E). */
async function paleteComNotas(page: Page, notas: { numero: string; remetente: string; delivery: string | null; volumes: number }[]): Promise<{ id: string; code: string; conteudos: Map<string, string> }> {
  const palete = await chamar(page, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: null, notes: null, declaredItems: [] });
  expect(palete.status, JSON.stringify(palete.json)).toBe(201);
  const id = String(palete.json.id);
  const conteudos = new Map<string, string>();
  for (const n of notas) {
    const r = await chamar(page, 'POST', `/api/v1/paletes/${id}/conteudos`, { sender: n.remetente, documentType: 'NFD', documentNumber: n.numero, delivery: n.delivery, description: null });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const c = (r.json.items as { id: string; documentNumber: string | null }[]).find((x) => x.documentNumber === n.numero);
    if (!c) throw new Error(`nota ${n.numero} não registrada`);
    conteudos.set(n.numero, c.id);
    await contar(page, id, c.id, n.volumes);
  }
  return { id, code: String(palete.json.code), conteudos };
}

async function contar(page: Page, paleteId: string, conteudoId: string, volumes: number): Promise<void> {
  const r = await chamar(page, 'POST', `/api/v1/paletes/${paleteId}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id: conteudoId }, counted: volumes, expected: null, origin: 'CONTAGEM_INFORMADA', reference: 'Teste fictício' });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
}

async function abrirArea(page: Page): Promise<void> {
  await abrirMenuConta(page);
  await page.getByTestId('menu-conta').getByRole('button', { name: 'Seleção cliente — teste' }).click();
  await expect(page.getByTestId('tela-selecao-teste')).toBeVisible();
  await expect(page.getByTestId('st-ambiente-teste')).toHaveText('Ambiente de teste — não movimenta estoque');
}

/** Pesquisa um número e abre a janela do único palete encontrado. */
async function abrirPaleteDaNota(page: Page, numero: string, codigo: string): Promise<void> {
  await page.getByTestId('st-pesquisa').fill(numero);
  await expect(page.getByTestId('st-total')).toHaveText('1 palete encontrado');
  await page.locator(`[data-testid="st-palete"][data-codigo="${codigo}"]`).click();
  await expect(page.getByTestId('st-janela')).toBeVisible();
}

test.describe('Seleção cliente — teste', () => {
  test.afterAll(async ({ browser }) => {
    // Nada fica liberado para as demais specs.
    await concessaoSupervisor(browser, false);
  });

  test('acesso só por concessão: o administrador libera na Administração de acesso; o operador continua sem a área', async ({ page, browser }, testInfo) => {
    test.skip(ehCelular(testInfo), CELULAR);
    // Sem concessão: tela e API negadas.
    const operador = await browser.newContext();
    const paginaOperador = await operador.newPage();
    await entrar(paginaOperador, 'operador');
    await paginaOperador.goto('/selecao-teste');
    await expect(paginaOperador.getByTestId('sem-permissao')).toBeVisible();
    expect((await paginaOperador.request.get(`${API_TESTE}/estoque`)).status()).toBe(403);
    await abrirMenuConta(paginaOperador);
    await expect(paginaOperador.getByTestId('menu-conta').getByRole('button', { name: 'Seleção cliente — teste' })).toHaveCount(0);
    await operador.close();

    // Concessão explícita pela tela do administrador.
    await entrar(page, 'adminCadastro');
    await abrirMenuConta(page);
    await page.getByRole('button', { name: 'Administração de acesso' }).click();
    const linha = page.locator(`.usuario-linha[data-login="${credenciais().supervisor.login}"]`);
    await linha.getByTestId('alternar-selecao-teste').click();
    await expect(page.getByTestId('mensagem-acesso')).toContainText('com acesso à Seleção cliente — teste');
    await expect(linha).toContainText('Seleção cliente — teste');
    // O operador não recebe a opção (só supervisor de estoque ou administrador).
    await expect(page.locator(`.usuario-linha[data-login="${credenciais().operador.login}"]`).getByTestId('alternar-selecao-teste')).toHaveCount(0);
  });

  test('percurso completo: escolher, revisar, enviar, alteração recusada e aprovada, revisão e solicitação adicional; estoque intacto', async ({ page, browser }, testInfo) => {
    test.skip(ehCelular(testInfo), CELULAR);
    await concessaoSupervisor(browser, true);
    await entrar(page, 'supervisor');
    const sufixo = String(Date.now()).slice(-6);
    const nf = { a: `71${sufixo}`, b: `72${sufixo}`, c: `73${sufixo}` };
    const misto = await paleteComNotas(page, [
      { numero: nf.a, remetente: 'Distribuidora Fictícia A', delivery: `80${sufixo}`, volumes: 12 },
      { numero: nf.b, remetente: 'Distribuidora Fictícia B', delivery: null, volumes: 5 },
    ]);
    const full = await paleteComNotas(page, [{ numero: nf.c, remetente: 'Distribuidora Fictícia C', delivery: null, volumes: 20 }]);

    // 1. Agenda de teste.
    await abrirArea(page);
    await page.getByTestId('st-agenda').selectOption('nova');
    await page.getByTestId('st-agenda-referencia').fill(`Agenda E2E ${sufixo}`);
    await page.getByTestId('st-comecar').click();
    await expect(page.getByTestId('st-agenda-atual')).toContainText(`Agenda E2E ${sufixo}`);

    // 2. Palete misto: escolher uma nota com quantidade parcial.
    await abrirPaleteDaNota(page, nf.a, misto.code);
    await expect(page.getByTestId('st-resumo-palete')).toContainText('2 notas · 17 volumes · 2 remetentes');
    const notaA = page.getByTestId('st-nota').filter({ hasText: nf.a });
    await notaA.getByTestId('st-marcar-nota').check();
    await page.getByTestId('st-quantidade').fill('8');
    await expect(page.getByTestId('st-previa')).toContainText(`NFD ${nf.a}`);
    await expect(page.getByTestId('st-previa')).toContainText('8 volumes');
    await page.getByTestId('st-adicionar').click();
    await expect(page.getByTestId('st-item-carrinho')).toHaveCount(1);
    await expect(page.getByTestId('st-total-carrinho')).toContainText('8 volumes');

    // Palete inteiro e notas do mesmo palete não convivem: o servidor recusa e a tela oferece a troca.
    await abrirPaleteDaNota(page, nf.a, misto.code);
    await expect(page.getByTestId('st-ja-na-selecao')).toBeVisible();
    await page.getByTestId('st-modo-inteiro').check();
    await page.getByTestId('st-adicionar').click();
    await expect(page.getByTestId('st-erro-adicionar')).toBeVisible();
    await page.getByTestId('st-trocar').click();
    await expect(page.getByTestId('st-janela')).toHaveCount(0);
    await expect(page.getByTestId('st-item-carrinho')).toHaveCount(1);
    await expect(page.getByTestId('st-total-carrinho')).toContainText('17 volumes');

    // Mapa em consulta: voltar mantém a pesquisa.
    await page.getByTestId('st-ver-mapa').click();
    await expect(page.getByTestId('st-mapa')).toBeVisible();
    await page.getByTestId('st-voltar-lista').click();
    await expect(page.getByTestId('st-mapa')).toHaveCount(0);
    await expect(page.getByTestId('st-pesquisa')).toHaveValue(nf.a);

    // Palete full: uma nota só abre em "palete inteiro".
    await abrirPaleteDaNota(page, nf.c, full.code);
    await expect(page.getByTestId('st-modo-inteiro')).toBeChecked();
    await expect(page.getByTestId('st-previa')).toContainText(`Palete ${full.code} inteiro`);
    await page.getByTestId('st-adicionar').click();
    await expect(page.getByTestId('st-item-carrinho')).toHaveCount(2);
    await expect(page.getByTestId('st-total-carrinho')).toContainText('37 volumes');

    // 3. Revisar.
    await page.getByTestId('st-revisar').click();
    await expect(page.getByTestId('tela-solicitacao-teste')).toBeVisible();
    await expect(page.getByTestId('st-situacao')).toHaveText('Carrinho (não enviada)');
    await expect(page.getByTestId('st-item')).toHaveCount(2);
    await expect(page.getByTestId('st-resumo-total')).toHaveText('37 volumes');
    const solicitacaoId = /\/selecao-teste\/solicitacoes\/([0-9a-f-]{36})/.exec(page.url())?.[1];
    if (solicitacaoId === undefined) throw new Error(`URL da solicitação inesperada: ${page.url()}`);

    // O estoque muda antes do envio: a diferença aparece e nada é trocado sozinho.
    await contar(page, full.id, full.conteudos.get(nf.c) ?? '', 25);
    await page.getByTestId('st-conferir-enviar').click();
    await expect(page.getByTestId('st-diferencas')).toContainText('Os volumes do palete mudaram.');
    await expect(page.getByTestId('st-confirmar')).toHaveCount(0);
    // "Usar os dados atuais" atualiza o apresentado e confere de novo: sem diferença, pede a confirmação.
    await page.getByTestId('st-usar-dados-atuais').click();
    await expect(page.getByTestId('st-diferencas')).toHaveCount(0);

    // 4. Enviar: depois disso, bloqueada no servidor.
    await expect(page.getByTestId('st-confirmar')).toBeVisible();
    await page.getByTestId('st-confirmar-envio').click();
    await expect(page.getByTestId('st-situacao')).toHaveText('Enviada');
    const enviada = (await (await page.request.get(`${API_TESTE}/solicitacoes/${solicitacaoId}`)).json()) as { version: number };
    const bloqueada = await chamar(page, 'PATCH', `${API_TESTE}/solicitacoes/${solicitacaoId}`, { expectedVersion: enviada.version, note: 'Tentativa depois do envio' });
    expect(bloqueada.status).toBe(409);
    expect((bloqueada.json.error as { code?: string } | undefined)?.code).toBe('SOLICITACAO_BLOQUEADA');

    // 5. Alteração recusada: continua como enviada.
    await page.getByTestId('st-justificativa').fill('Faltou uma nota no pedido');
    await page.getByTestId('st-solicitar-alteracao').click();
    await expect(page.getByTestId('st-situacao')).toHaveText('Alteração pedida');
    await page.getByTestId('st-resposta').fill('Mantida como enviada');
    await page.getByTestId('st-recusar').click();
    await expect(page.getByTestId('st-mensagem')).toContainText('Alteração recusada');
    await expect(page.getByTestId('st-situacao')).toHaveText('Enviada');
    await expect(page.getByTestId('st-alteracao')).toContainText('Recusada');

    // Alteração aprovada: revisão liberada, ajuste e envio da versão 2 (a 1 fica guardada).
    await page.getByTestId('st-justificativa').fill('Retirar o palete misto');
    await page.getByTestId('st-solicitar-alteracao').click();
    await expect(page.getByTestId('st-situacao')).toHaveText('Alteração pedida');
    await page.getByTestId('st-resposta').fill('Pode revisar');
    await page.getByTestId('st-aprovar').click();
    await expect(page.getByTestId('st-situacao')).toHaveText('Revisão autorizada');
    await expect(page.getByTestId('st-revisao-autorizada')).toBeVisible();
    await page.getByTestId('st-item').filter({ hasText: misto.code }).getByTestId('st-item-retirar').click();
    await expect(page.getByTestId('st-item')).toHaveCount(1);
    await page.getByTestId('st-conferir-enviar').click();
    await page.getByTestId('st-confirmar-envio').click();
    await expect(page.getByTestId('st-situacao')).toHaveText('Enviada');
    await expect(page.getByTestId('tela-solicitacao-teste')).toContainText('versão 2');
    await expect(page.getByTestId('st-versao')).toHaveCount(2);

    // 6. Solicitação adicional para a mesma agenda: aviso de conteúdo já pedido.
    await page.getByTestId('st-nova-adicional').click();
    await expect(page.getByTestId('st-agenda-atual')).toContainText(`Agenda E2E ${sufixo}`);
    await abrirPaleteDaNota(page, nf.c, full.code);
    await page.getByTestId('st-adicionar').click();
    await expect(page.getByTestId('st-item-carrinho')).toHaveCount(1);
    await page.getByTestId('st-revisar').click();
    await expect(page.getByTestId('st-outro-pedido')).toBeVisible();

    // Lista: as duas solicitações da agenda.
    await page.goto('/selecao-teste/solicitacoes');
    await expect(page.getByTestId('st-linha-solicitacao').filter({ hasText: `Agenda E2E ${sufixo}` })).toHaveCount(2);

    // Estoque intacto: notas, contagens e situação dos paletes como registrados.
    for (const [palete, esperado] of [
      [misto, { [nf.a]: '12', [nf.b]: '5' }],
      [full, { [nf.c]: '25' }],
    ] as const) {
      const conteudo = (await (await page.request.get(`/api/v1/paletes/${palete.id}/conteudos`)).json()) as { items: { documentNumber: string | null; count: { counted: string | null } }[] };
      expect(Object.fromEntries(conteudo.items.map((i) => [i.documentNumber ?? '', i.count.counted]))).toEqual(esperado);
      const detalhe = (await (await page.request.get(`/api/v1/paletes/${palete.id}`)).json()) as { flowState: string };
      expect(detalhe.flowState).toBe('EM_ESTOQUE');
    }
  });
});
