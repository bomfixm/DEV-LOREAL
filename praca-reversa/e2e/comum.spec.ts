import { expect, test } from '@playwright/test';
import { aguardarMapa, entrar, entrarNoMapa, obterPraca } from './apoio';

test.describe('acesso e demonstração', () => {
  test('sem sessão mostra o login e nenhum dado da praça', async ({ page }) => {
    const respostasPraca: number[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/v1/praca') || r.url().includes('/api/v1/paletes')) respostasPraca.push(r.status());
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await expect(page.getByTestId('status-api')).toHaveText('Servidor disponível');
    await expect(page.locator('path[data-palete-id]')).toHaveCount(0);
    expect(respostasPraca).toEqual([]);
    expect((await page.request.get('/api/v1/praca')).status()).toBe(401);
  });

  test('o indicador não afirma banco disponível quando a prontidão falha', async ({ page }) => {
    await page.route('**/api/v1/health/ready', (rota) =>
      rota.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'indisponivel', database: 'indisponivel' }) }),
    );
    await page.goto('/');
    await expect(page.getByTestId('status-api')).toHaveText('Banco indisponível');
    // Etapa 09: sem nenhuma resposta da API (não só da prontidão), o estado é "Servidor sem resposta".
    await page.route('**/api/v1/**', (rota) => rota.abort('connectionrefused'));
    await page.reload();
    await expect(page.getByTestId('status-api')).toHaveText('Servidor sem resposta');
    await expect(page.getByTestId('tela-sem-conexao')).toContainText('Servidor sem resposta');
  });

  test('credenciais inválidas: mensagem genérica, sem revelar se a conta existe', async ({ page }) => {
    await page.goto('/');
    for (const login of ['consulta.e2e', 'conta.inexistente']) {
      await page.getByLabel('Usuário').fill(login);
      await page.getByLabel('Senha', { exact: true }).fill('senha-errada-123');
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(page.getByTestId('erro-login')).toHaveText('Usuário ou senha inválidos.');
    }
    await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('');
  });

  test('após o login, identifica usuário, escopo e modo demonstração', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await expect(page.getByTestId('selo-demo')).toHaveText('Demonstração');
    await expect(page.getByTestId('aviso-demo')).toContainText('fictícios');
    await expect(page.getByTestId('menu-conta')).toContainText('Consulta E2E');
    await expect(page.getByTestId('menu-conta')).toContainText('Praça informada · demonstração');
  });

  test('mapa e lista representam exatamente os mesmos paletes do banco', async ({ page }) => {
    await entrarNoMapa(page, 'consultaNavegacao');
    const praca = await obterPraca(page);
    const comPosicao = praca.pallets.filter((p) => p.positionId !== null).map((p) => p.id).sort();
    const semPosicao = praca.pallets.filter((p) => p.positionId === null).map((p) => p.code).sort();
    expect(semPosicao).toEqual(['PAL-DEMO-342', 'PAL-DEMO-343']);

    const idsMapa = await page.locator('path[data-palete-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-palete-id') ?? ''));
    expect(idsMapa.sort()).toEqual(comPosicao);
    const idsLista = await page.locator('.item-palete').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
    expect(idsLista.sort()).toEqual(praca.pallets.map((p) => p.id).sort());

    // No celular a lista fica oculta até a aba ser aberta; por isso a busca é por texto, não por papel acessível.
    const pendentes = page.locator('section.grupo-lista', { has: page.locator('h3', { hasText: 'Localização pendente' }) });
    const codigos = await pendentes.locator('.item-palete').evaluateAll((els) => els.map((e) => e.getAttribute('data-codigo') ?? ''));
    expect(codigos.sort()).toEqual(semPosicao);
  });

  test('erro da API ao carregar a praça é informado e pode ser repetido', async ({ page }) => {
    await page.route('**/api/v1/praca', (rota) => rota.abort('connectionrefused'));
    await entrar(page, 'consulta');
    const erro = page.getByTestId('erro-praca');
    await expect(erro).toContainText('Não foi possível carregar a praça');
    await expect(page.locator('path[data-palete-id]')).toHaveCount(0);
    await page.unroute('**/api/v1/praca');
    await erro.getByRole('button', { name: 'Tentar novamente' }).click();
    await aguardarMapa(page);
  });

  test('resposta fora do contrato é recusada em vez de exibir dados inventados', async ({ page }) => {
    await page.route('**/api/v1/praca', (rota) =>
      rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ scope: {}, pallets: [{ code: 1 }] }) }),
    );
    await entrar(page, 'consulta');
    await expect(page.getByTestId('erro-praca')).toContainText('formato inesperado');
  });
});
