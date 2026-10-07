import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { abrirMenuConta, aguardarMapa, entrar, entrarNoMapa, focarArea, forma, obterPraca, trocarEscopo } from './apoio';
import { credenciais } from './credenciais';

test.skip(({ isMobile }) => isMobile, 'Fluxos de acesso no layout de computador.');

const abrirMenu = abrirMenuConta;

test.describe('sessão na interface', () => {
  test('sair encerra a sessão no servidor e descarta os dados da tela', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await abrirMenu(page);
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByTestId('aviso-login')).toHaveText('Você saiu.');
    await expect(page.locator('path[data-palete-id]')).toHaveCount(0);
    await expect(page.locator('.item-palete')).toHaveCount(0);
    expect((await page.request.get('/api/v1/praca')).status()).toBe(401);
    await page.goBack();
    await expect(page.locator('path[data-palete-id]')).toHaveCount(0);
  });

  test('sessão encerrada fora da tela leva ao login com aviso na próxima ação', async ({ page, context, request }) => {
    await entrarNoMapa(page, 'consulta');
    const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
    const cookie = (await context.cookies()).find((c) => c.name === 'pr_sessao');
    // Outro cliente HTTP encerra a sessão no servidor; o navegador mantém o cookie.
    const saida = await request.delete('/api/v1/sessao', {
      headers: { cookie: `pr_sessao=${String(cookie?.value)}`, 'x-csrf-token': sessao.csrfToken },
    });
    expect(saida.status()).toBe(204);
    await forma(page, 'PAL-DEMO-001').click();
    await expect(page.getByTestId('aviso-login')).toHaveText('Sessão expirada: entre novamente. O que não foi enviado continua nesta aba para você revisar.');
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  });

  test('mutação sem o token anti-CSRF é recusada mesmo com o cookie de sessão', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    const semToken = await page.request.delete('/api/v1/sessao');
    expect(semToken.status()).toBe(403);
    expect((await page.request.get('/api/v1/praca')).status()).toBe(200);
  });
});

test.describe('permissões e escopos', () => {
  test('consulta não vê administração e a API recusa a chamada direta', async ({ page }) => {
    await entrarNoMapa(page, 'consulta');
    await abrirMenu(page);
    await expect(page.getByRole('button', { name: 'Administração de acesso' })).toHaveCount(0);
    expect((await page.request.get('/api/v1/admin/usuarios')).status()).toBe(403);
  });

  test('usuário de outro escopo não acessa palete da praça informada, nem por ID direto', async ({ page }) => {
    await entrarNoMapa(page, 'restrito');
    const praca = await obterPraca(page);
    expect(praca.scope.name).toBe('Cenário de navegação · fictício');
    expect(praca.pallets.some((p) => p.code === 'PAL-DEMO-001')).toBe(false);
    const direto = await page.request.get('/api/v1/paletes/00000000-0000-4000-8000-000000000001');
    expect(direto.status()).toBe(404);
    expect(await direto.text()).not.toContain('PAL-DEMO-001');
  });

  test('administrador troca de escopo e o mapa passa a mostrar só os registros do novo escopo', async ({ page }) => {
    await entrarNoMapa(page, 'admin');
    await expect(page.locator('path[data-palete-id]')).toHaveCount(6);
    await trocarEscopo(page, 'Cenário de navegação · fictício — Administrador');
    await expect(page.locator('path[data-palete-id]')).toHaveCount(335);
    await expect(forma(page, 'PAL-DEMO-001')).toHaveCount(0);
  });
});

test.describe('administração de acesso', () => {
  test('cria usuário com resposta perdida: a nova tentativa reutiliza a chave e não duplica', async ({ page }) => {
    await entrarNoMapa(page, 'admin');
    await abrirMenu(page);
    await page.getByRole('button', { name: 'Administração de acesso' }).click();
    await expect(page.getByTestId('tela-acesso')).toBeVisible();

    const chaves: string[] = [];
    let primeira = true;
    await page.route('**/api/v1/admin/usuarios', async (rota) => {
      if (rota.request().method() !== 'POST') return rota.continue();
      chaves.push(rota.request().headers()['idempotency-key'] ?? '');
      if (primeira) {
        primeira = false;
        await rota.fetch(); // o servidor processa...
        return rota.abort('failed'); // ...mas a resposta se perde no caminho
      }
      return rota.continue();
    });

    const login = `novo.${randomBytes(3).toString('hex')}`;
    await page.getByLabel('Login').fill(login);
    await page.getByLabel('Nome', { exact: true }).fill('Usuário Novo');
    await page.getByLabel('Senha inicial (mín. 12 caracteres)').fill(randomBytes(12).toString('base64url'));
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    // Etapa 09: resposta perdida fica "em confirmação" (pode ter sido registrada), não é recusa.
    await expect(page.getByTestId('mensagem-acesso')).toContainText('Sem resposta do servidor');
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    await expect(page.getByTestId('mensagem-acesso')).toContainText(`Usuário ${login} criado`);

    expect(chaves).toHaveLength(2);
    expect(chaves[0]).toBe(chaves[1]);
    const lista = (await (await page.request.get('/api/v1/admin/usuarios')).json()) as { items: { login: string }[] };
    expect(lista.items.filter((u) => u.login === login)).toHaveLength(1);
    await expect(page.locator(`.usuario-linha[data-login="${login}"]`)).toHaveCount(1);
    await expect(page.getByTestId('lista-auditoria')).toContainText('Usuário criado');
  });

  test('desativar conta encerra a sessão aberta do usuário e impede novo login', async ({ page, browser }) => {
    const outro = await browser.newContext();
    const paginaUsuario = await outro.newPage();
    await entrarNoMapa(paginaUsuario, 'descartavel');

    await entrarNoMapa(page, 'admin');
    await abrirMenu(page);
    await page.getByRole('button', { name: 'Administração de acesso' }).click();
    const linha = page.locator('.usuario-linha[data-login="descartavel.e2e"]');
    await linha.getByRole('button', { name: 'Desativar conta' }).click();
    await expect(page.getByTestId('mensagem-acesso')).toContainText('sessões abertas foram encerradas');
    await expect(linha).toContainText('Conta desativada');
    await expect(page.getByTestId('lista-auditoria')).toContainText('Conta desativada');

    await focarArea(paginaUsuario, 'Fileira 11 · FB01');
    await forma(paginaUsuario, 'PAL-DEMO-002').click();
    await expect(paginaUsuario.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    const { login, senha } = credenciais().descartavel;
    await paginaUsuario.getByLabel('Usuário').fill(login);
    await paginaUsuario.getByLabel('Senha', { exact: true }).fill(senha);
    await paginaUsuario.getByRole('button', { name: 'Entrar' }).click();
    await expect(paginaUsuario.getByTestId('erro-login')).toHaveText('Usuário ou senha inválidos.');
    await outro.close();
  });

  test('administrador não pode alterar o próprio acesso pela tela', async ({ page }) => {
    await entrar(page, 'admin');
    await aguardarMapa(page);
    await abrirMenu(page);
    await page.getByRole('button', { name: 'Administração de acesso' }).click();
    const propria = page.locator('.usuario-linha[data-login="admin.e2e"]');
    await expect(propria.getByRole('button', { name: 'Desativar conta' })).toBeDisabled();
    await expect(propria.getByLabel('Perfil de admin.e2e')).toBeDisabled();
  });
});
