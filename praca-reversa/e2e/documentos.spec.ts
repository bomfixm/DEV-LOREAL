import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { abrirMenuConta, ehCelular, entrar } from './apoio';

/**
 * Termos de uso e aviso de privacidade (27 out. 2026), com dados fictícios do
 * E2E: links discretos no login e no menu da conta (teclado e celular);
 * página pública sem versão publicada diz isso, sem texto provisório (T06);
 * minuta não aparece em /termos até a referência da aprovação e a
 * publicação (T07); conta comum não vê a administração. A exigência de
 * aceite fica desligada no E2E (padrão): ninguém é bloqueado.
 */
const PASTA = 'docs/capturas/termos-privacidade';
async function capturar(page: import('@playwright/test').Page, nome: string): Promise<void> {
  if (process.env.CAPTURAR !== '1') return;
  mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: `${PASTA}/${nome}.png` });
}

test.describe('Termos de uso e privacidade', () => {
  test('login: links por teclado; páginas públicas sem versão publicada não mostram texto provisório', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Usuário')).toBeVisible();
    const termos = page.getByTestId('link-termos');
    await expect(termos).toBeVisible();
    await expect(page.getByTestId('link-privacidade')).toBeVisible();
    // Teclado: o link recebe foco e abre com Enter.
    await termos.focus();
    await expect(termos).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/termos$/);
    const tela = page.getByTestId('tela-documento');
    await expect(tela).toBeVisible();
    // Sem entrar: ou "não publicado" ou a versão publicada (outro teste pode ter publicado neste banco).
    await expect(tela.getByTestId('documento-nao-publicado').or(tela.getByTestId('documento-versao'))).toBeVisible();
    await expect(tela).not.toContainText('MINUTA');
    await capturar(page, `01-termos-sem-entrar-${ehCelular(test.info()) ? 'celular' : 'computador'}`);
    const rolagem = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(rolagem).toBeLessThanOrEqual(1);
    await page.goto('/privacidade');
    await expect(page.getByTestId('tela-documento')).toHaveAttribute('data-documento', 'privacidade');
    await page.getByRole('button', { name: 'Voltar para entrar' }).click();
    await expect(page.getByLabel('Usuário')).toBeVisible();
  });

  test('conta comum: links no menu da conta; administração dos documentos negada', async ({ page }) => {
    await entrar(page, 'operador');
    await abrirMenuConta(page);
    await page.getByTestId('menu-conta').getByTestId('link-privacidade').click();
    await expect(page.getByTestId('tela-documento')).toHaveAttribute('data-documento', 'privacidade');
    await page.goto('/documentos');
    await expect(page.getByTestId('tela-documentos')).toHaveCount(0);
    const r = await page.request.get('/api/v1/admin/documentos');
    expect(r.status()).toBe(403);
  });

  test('administrador: minuta fica fora do público até registrar a aprovação e publicar; versão nova substitui', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'fluxo do computador; a página pública é conferida no celular no outro teste');
    const marca = randomUUID().slice(0, 8);
    const texto = `# Uso do aplicativo\n\nTexto fictício de teste ${marca}. Sem validade jurídica.\n\n- Item fictício um\n- Item fictício dois`;
    await entrar(page, 'admin');
    await page.goto('/documentos');
    const tela = page.getByTestId('tela-documentos');
    await expect(tela).toBeVisible();
    await expect(tela.getByTestId('documentos-exigencia')).toContainText('desligado nesta instalação');
    await tela.getByTestId('documento-tipo').selectOption('TERMOS_DE_USO');
    await tela.getByTestId('documento-titulo-novo').fill(`Termos de uso (teste ${marca})`);
    await tela.getByTestId('documento-conteudo-novo').fill(texto);
    await tela.getByTestId('documento-criar-minuta').click();
    await expect(tela.getByTestId('documentos-mensagem')).toContainText('Minuta criada');
    const item = tela.getByTestId('documento-versao-item').filter({ hasText: `teste ${marca}` });
    await expect(item).toHaveAttribute('data-situacao', 'MINUTA');
    await capturar(page, '02-administracao-minuta');
    // Público continua sem a minuta.
    const publico = await page.request.get('/api/v1/documentos-publicos/termos');
    expect(await publico.text()).not.toContain(marca);
    // Publicar sem aprovação: não há botão; a referência curta é recusada pelo servidor.
    await expect(item.getByTestId('documento-publicar')).toHaveCount(0);
    await item.getByTestId('documento-referencia').fill('ok');
    await item.getByTestId('documento-responsavel').fill('Pessoa fictícia');
    await item.getByTestId('documento-registrar-aprovacao').click();
    await expect(tela.getByTestId('documentos-mensagem')).toContainText('referência da aprovação');
    await item.getByTestId('documento-referencia').fill(`Parecer fictício de teste ${marca}`);
    await item.getByTestId('documento-registrar-aprovacao').click();
    await expect(item).toHaveAttribute('data-situacao', 'APROVADO');
    await item.getByTestId('documento-publicar').click();
    await item.getByTestId('documento-confirmar-publicacao').click();
    await expect(item).toHaveAttribute('data-situacao', 'PUBLICADO');
    // Página pública mostra a versão publicada, como texto (lista e subtítulo), sem a referência interna.
    await page.goto('/termos');
    const doc = page.getByTestId('tela-documento');
    await expect(doc).toContainText(`Texto fictício de teste ${marca}`);
    await expect(doc.getByRole('listitem')).toHaveCount(2);
    await expect(doc).not.toContainText('Parecer fictício');
    await capturar(page, '03-termos-publicados');
  });
});
