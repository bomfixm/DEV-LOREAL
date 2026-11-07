import { expect, test } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';
import { entrarNoMapa, irParaPagina } from './apoio';

test.skip(({ isMobile }) => isMobile, 'Fluxo de acesso no layout de computador.');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** TOTP (RFC 6238) do passo informado, calculado no teste de forma independente da API. */
function codigoTotp(base32: string, passo: number): string {
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of base32.replace(/[\s=]/g, '').toUpperCase()) {
    valor = (valor << 5) | ALFABETO.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(contador).digest();
  const deslocamento = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  return String((hmac.readUInt32BE(deslocamento) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const passoAtual = () => Math.floor(Date.now() / 1000 / 30);

test('verificação em duas etapas: ativar pela tela, entrar com o código e redefinir pelo administrador', async ({ page, browser }) => {
  test.setTimeout(120_000);
  // 1) O administrador cria um usuário novo só para este teste.
  await entrarNoMapa(page, 'admin');
  await irParaPagina(page, 'Administração de acesso');
  const login = `fator.${randomBytes(3).toString('hex')}`;
  const senha = randomBytes(12).toString('base64url');
  await page.getByLabel('Login').fill(login);
  await page.getByLabel('Nome', { exact: true }).fill('Fator E2E');
  await page.getByLabel('Senha inicial (mín. 12 caracteres)').fill(senha);
  await page.getByRole('button', { name: 'Criar usuário' }).click();
  await expect(page.getByTestId('mensagem-acesso')).toContainText(`Usuário ${login} criado`);

  // 2) O usuário entra só com a senha e ativa pela tela "Segurança da conta".
  const contexto = await browser.newContext();
  const usuario = await contexto.newPage();
  await usuario.goto('/entrar');
  await usuario.getByLabel('Usuário').fill(login);
  await usuario.getByLabel('Senha', { exact: true }).fill(senha);
  await usuario.getByRole('button', { name: 'Entrar' }).click();
  await expect(usuario.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
  await irParaPagina(usuario, 'Segurança da conta');
  await usuario.getByTestId('ativar-2fa').click();
  await expect(usuario.getByTestId('qr-segundo-fator')).toBeVisible();
  const chave = (await usuario.getByTestId('chave-2fa').textContent()) ?? '';
  expect(chave).toMatch(/^[A-Z2-7]{32}$/);

  // Código errado é recusado; o certo ativa e mostra os códigos de recuperação uma única vez.
  await usuario.getByTestId('codigo-confirmar').fill('000000');
  await usuario.getByRole('button', { name: 'Confirmar e ativar' }).click();
  await expect(usuario.getByRole('alert')).toContainText('Código inválido');
  await usuario.getByTestId('codigo-confirmar').fill(codigoTotp(chave, passoAtual()));
  await usuario.getByRole('button', { name: 'Confirmar e ativar' }).click();
  await expect(usuario.getByTestId('codigos-recuperacao')).toBeVisible();
  const recuperacao = await usuario.getByTestId('codigos-recuperacao').locator('code').allTextContents();
  expect(recuperacao).toHaveLength(8);
  await usuario.getByRole('button', { name: 'Guardei os códigos' }).click();
  await expect(usuario.getByTestId('situacao-2fa')).toContainText('Ativada');

  // 3) Sair e entrar de novo: a senha sozinha pede o código; com o código do aplicativo (passo seguinte) entra.
  await usuario.evaluate(async () => {
    const corpo = (await (await fetch('/api/v1/sessao')).json()) as { csrfToken: string };
    const csrf = corpo.csrfToken;
    await fetch('/api/v1/sessao', { method: 'DELETE', headers: { 'x-csrf-token': csrf } });
  });
  await usuario.goto('/entrar');
  await usuario.getByLabel('Usuário').fill(login);
  await usuario.getByLabel('Senha', { exact: true }).fill(senha);
  await usuario.getByRole('button', { name: 'Entrar' }).click();
  await expect(usuario.getByTestId('campo-codigo')).toBeVisible();
  await usuario.getByTestId('campo-codigo').fill('111111');
  await usuario.getByRole('button', { name: 'Entrar' }).click();
  await expect(usuario.getByTestId('erro-login')).toContainText('Código inválido');
  await usuario.getByTestId('campo-codigo').fill(codigoTotp(chave, passoAtual() + 1));
  await usuario.getByRole('button', { name: 'Entrar' }).click();
  await expect(usuario.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);

  // 4) O administrador vê a conta com duas etapas e redefine (perdeu o celular); a senha volta a bastar.
  await page.reload();
  const linha = page.locator(`.usuario-linha[data-login="${login}"]`);
  await expect(linha).toContainText('Duas etapas: ativada');
  page.once('dialog', (d) => void d.accept());
  await linha.getByTestId('redefinir-2fa').click();
  await expect(page.getByTestId('mensagem-acesso')).toContainText('Duas etapas');
  await expect(linha).toContainText('Duas etapas: desativada');
  await expect(page.getByTestId('lista-auditoria')).toContainText('Verificação em duas etapas redefinida');

  await contexto.close();
});
