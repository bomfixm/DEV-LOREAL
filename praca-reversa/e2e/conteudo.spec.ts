import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { abrirMenuConta, ehCelular, entrar, obterPraca } from './apoio';

/**
 * Cadastro de conteúdo e conferência de volumes (out. 2026), no escopo de
 * cadastro do E2E (dados fictícios): /produtos abre "Registrar conteúdo";
 * salvar só com o remetente (sem SKU, código de barras ou volumes); o
 * registro persiste após recarregar; dois sem nota do mesmo remetente ficam
 * distintos; contagem já feita sem identificação; previsto ausente/divergente;
 * completar a identificação preserva a contagem.
 */
async function chamar(page: Page, caminho: string, corpo: unknown): Promise<APIResponse> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return page.request.fetch(caminho, { method: 'POST', data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
}

test.describe('Registrar conteúdo e conferência de volumes', () => {
  test('remetente só, persistência, contagem já feita, previsto e identificação completada depois', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'Fluxo de computador (o celular usa as mesmas telas).');
    await entrar(page, 'operador');
    const praca = await obterPraca(page);
    const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
    const livre = praca.layout.positions.find((p) => p.available && !ocupadas.has(p.id)) ?? null;
    const r = await chamar(page, '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: livre?.id ?? null, notes: 'Conteúdo (fictício)', declaredItems: [] });
    expect(r.status(), await r.text()).toBe(201);
    const p = (await r.json()) as { id: string; code: string };

    // Menu (lateral e da conta): "Registrar conteúdo" uma vez e nenhum "Catálogo de SKU".
    await page.goto('/');
    const lateral = page.getByTestId('barra-lateral');
    // Etapa 2: "Registrar conteúdo" fica em "Mais".
    await lateral.getByTestId('navegacao-mais-botao').click();
    await expect(lateral.getByRole('link', { name: 'Registrar conteúdo' })).toHaveCount(1);
    await expect(lateral.getByText('Catálogo de SKU')).toHaveCount(0);
    await abrirMenuConta(page);
    const menuConta = page.getByTestId('menu-conta');
    await expect(menuConta.getByRole('button', { name: 'Registrar conteúdo' })).toHaveCount(1);
    await expect(menuConta.getByText('Catálogo de SKU')).toHaveCount(0);

    // Rotas antigas ("Novo produto" e catálogo de SKU) levam ao "Registrar conteúdo", sem SKU.
    for (const antiga of ['/produtos', '/produtos/catalogo']) {
      await page.goto(antiga);
      await expect(page).toHaveURL(/\/conteudos\/novo$/);
      await expect(page.getByRole('heading', { name: 'Registrar conteúdo' })).toBeVisible();
      await expect(page.getByText('Novo produto')).toHaveCount(0);
      await expect(page.getByText(/Catálogo de SKU|Novo SKU|Unidade canônica|Código de barras/)).toHaveCount(0);
      await expect(page.getByLabel(/^SKU/)).toHaveCount(0);
    }
    // Voltar do navegador não reabre o endereço antigo (foi substituído).
    await page.goBack();
    await expect(page).not.toHaveURL(/\/produtos/);

    // Palete pelo contexto; salvar só com o remetente.
    await page.goto(`/conteudos/novo?palete=${p.id}`);
    await expect(page.getByTestId('conteudo-palete-codigo')).toHaveText(p.code);
    await page.getByTestId('conteudo-remetente').fill('Remetente Fictício E2E');
    await page.getByTestId('salvar-conteudo').click();
    await expect(page.getByTestId('conteudo-salvo')).toContainText('Documento não informado');
    await expect(page.getByTestId('conteudo-salvo')).toContainText('Delivery não informado');
    await expect(page.getByTestId('conteudo-salvo-volumes')).toHaveText('Aguardando conferência');
    // Outro do mesmo remetente, também sem nota: continua distinto.
    await page.getByTestId('registrar-outro').click();
    await page.getByTestId('conteudo-remetente').fill('Remetente Fictício E2E');
    await page.getByTestId('salvar-conteudo').click();
    await expect(page.getByTestId('conteudo-salvo')).toBeVisible();
    // Terceiro com NF (zeros à esquerda) e Delivery.
    await page.getByTestId('registrar-outro').click();
    await page.getByTestId('conteudo-remetente').fill('Remetente Fictício E2E');
    await page.getByTestId('conteudo-tipo-NF').check();
    await page.getByTestId('conteudo-numero').fill('000777');
    await page.getByTestId('conteudo-delivery').fill('DLV-E2E-1');
    await page.getByTestId('salvar-conteudo').click();
    await page.getByTestId('ir-conferencia').click();

    // Conferência de volumes (recarregada do servidor): identificação nos cartões, contagem na tabela única.
    await expect(page).toHaveURL(new RegExp(`/paletes/${p.id}/volumes$`));
    await page.reload();
    const itens = page.getByTestId('conteudo-item');
    await expect(itens).toHaveCount(3);
    await expect(page.getByTestId('volumes-resumo')).toContainText('3 aguardando conferência');
    await expect(page.getByTestId('volumes-resumo')).toContainText('1 documento(s) identificado(s)');
    const primeiro = itens.nth(0);
    await expect(primeiro.getByTestId('conteudo-identificacao-pendente')).toBeVisible();
    await expect(primeiro.getByTestId('conteudo-volumes')).toHaveText('Aguardando conferência');
    // Os cartões não contam mais nota por nota (a contagem é na tabela).
    await expect(primeiro.getByTestId('contar-volumes')).toHaveCount(0);

    // Completar a identificação do primeiro.
    await primeiro.getByTestId('completar-identificacao').click();
    await itens.nth(0).getByTestId('identificacao-tipo').selectOption('NFD');
    await itens.nth(0).getByTestId('identificacao-numero').fill('000123');
    await itens.nth(0).getByTestId('salvar-identificacao').click();
    await expect(page.getByTestId('mensagem-volumes')).toContainText('a contagem continua a mesma');

    // Tabela: sem quantidade atual, cada linha exige o contado; conferência completa com declaração.
    const tabela = page.getByTestId('volumes-tabela');
    await expect(tabela.getByTestId('conf-linha')).toHaveCount(3);
    await expect(tabela.getByTestId('conf-confirmar-todos')).toBeDisabled();
    const contados = tabela.getByTestId('conf-contado');
    await contados.nth(0).fill('10');
    await contados.nth(1).fill('2');
    await contados.nth(2).fill('8');
    await tabela.getByTestId('conf-declaracao').check();
    await tabela.getByTestId('conf-concluir-diferencas').click();

    // Gravado: volta ao palete no mapa, que mostra o que ficou no banco.
    await expect(page).toHaveURL(new RegExp(`/paletes/${p.id}$`));
    await expect(page.getByTestId('janela-documentos')).toHaveText('2 + 1 sem documento');
    await expect(page.getByTestId('janela-volumes')).toHaveText('20 · contados');
    await expect(page.getByTestId('janela-conferencia')).toContainText('Conferido sem diferença');
  });
});
