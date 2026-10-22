import { expect, test, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { abrirPalete, aguardarMapaParado, entrar, obterPraca, verMais } from './apoio';
import { imagemDoCodigo, instalarCameraFalsa, mostrarNaCamera } from './camera-falsa';

/**
 * Capturas de evidência da etapa 09 (npm run capturas), também uma
 * demonstração com **dados fictícios** na praça informada: entrar e ver como
 * instalar → aparelho e versões → ler o QR do palete pela câmera (simulada) e
 * abrir o palete → ler código de caixa com fator → conferir pela câmera com
 * unidade explícita → sem conexão a leitura fica "não enviada" → resposta
 * perdida fica "em confirmação" e é resolvida pela chave sem duplicar → foto
 * na conferência → nova versão com atualização adiada até resolver → abertura
 * sem conexão. A câmera é simulada (canvas); não é teste em aparelho físico.
 */
const PASTA = 'docs/capturas/etapa-09';

async function capturar(page: Page, nome: string): Promise<void> {
  mkdirSync(PASTA, { recursive: true });
  await page.screenshot({ path: `${PASTA}/${nome}.png` });
}

test.describe('capturas etapa 09 @captura', () => {
  test('computador: instalar → câmera e QR → conferência pela câmera → sem conexão → em confirmação → foto → nova versão → abertura offline', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'Fluxo de computador.');
    test.setTimeout(240_000);
    await instalarCameraFalsa(page);
    await page.goto('/');
    await expect(page.getByTestId('abrir-aplicativo')).toBeVisible();
    await capturar(page, '01-login-com-instalacao');
    await page.getByTestId('abrir-aplicativo').click();
    await expect(page.getByTestId('tela-aplicativo')).toBeVisible();
    await expect(page.getByTestId('versoes')).toContainText('contrato 9');
    await capturar(page, '02-aplicativo-e-aparelho');

    await entrar(page, 'supervisorDemo');
    const praca = await obterPraca(page);
    const comQr = praca.pallets.find((p) => p.positionId !== null && p.countState === 'RECONCILIADO') ?? praca.pallets.find((p) => p.positionId !== null);
    const livre = praca.pallets.find((p) => p.positionId !== null && p.countState === 'NAO_CONFERIDO' && !p.activeCountId);
    if (!comQr || !livre) throw new Error('Paletes de demonstração ausentes.');

    // QR do palete pela câmera.
    await page.goto('/');
    await aguardarMapaParado(page);
    await mostrarNaCamera(page, await imagemDoCodigo(`${String(baseURL)}/paletes/${comQr.id}`, 'QRCode'));
    await page.getByTestId('ler-codigo-praca').click();
    await expect(page.getByTestId('leitura-palete')).toBeVisible({ timeout: 30_000 });
    await capturar(page, '03-camera-qr-do-palete');
    await page.getByTestId('abrir-palete-lido').click();
    await expect(page.getByTestId('janela-palete')).toContainText(comQr.code);
    await verMais(page);
    await aguardarMapaParado(page);
    await capturar(page, '04-palete-aberto-pelo-qr');
    await page.keyboard.press('Escape');

    // Caixa com fator conhecido (Code 128 com o texto exato do cadastro de demonstração).
    await mostrarNaCamera(page, await imagemDoCodigo('12000000001011', 'Code128'));
    await page.getByTestId('ler-codigo-praca').click();
    await expect(page.getByTestId('produto-lido')).toBeVisible({ timeout: 30_000 });
    await capturar(page, '05-camera-caixa-com-fator');
    await page.getByTestId('fechar-camera').click();

    // Conferência pela câmera, com unidade explícita antes de somar.
    await abrirPalete(page, livre.id);
    await page.getByTestId('iniciar-conferencia').click();
    await page.getByRole('radio', { name: /^Completa/ }).check();
    await page.getByTestId('confirmar-inicio').click();
    await expect(page).toHaveURL(/\/conferencias\/[0-9a-f-]{36}$/);
    const conferencia = page.url();
    await page.getByRole('radio', { name: 'Uma unidade por leitura' }).check();
    await page.getByLabel('Condição (obrigatória)').selectOption({ label: 'Saudável' });
    await mostrarNaCamera(page, await imagemDoCodigo('2000000001014', 'Code128'));
    await page.getByTestId('ler-codigo-conferencia').click();
    await expect(page.getByTestId('usar-codigo-lido')).toBeVisible({ timeout: 30_000 });
    await capturar(page, '06-camera-na-conferencia');
    await page.getByTestId('usar-codigo-lido').click();
    await expect(page.getByTestId('confirmar-item')).toContainText('Confirmar e somar 1 UN');
    await capturar(page, '07-confirmacao-com-unidade');
    await page.getByTestId('confirmar-item').click();
    await expect(page.getByTestId('retorno-entrada')).toContainText('Registrado no rascunho');

    // Sem conexão: a leitura fica "não enviada"; nada é confirmado.
    await context.setOffline(true);
    await page.getByTestId('campo-codigo').fill('2000000001014');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('entrada-nao-confirmada')).toHaveAttribute('data-estado', 'nao-enviada');
    await capturar(page, '08-sem-conexao-nao-enviada');
    await context.setOffline(false);
    await page.getByTestId('entrada-nao-confirmada').getByRole('button', { name: 'Enviar agora' }).click();
    await expect(page.getByTestId('entrada-nao-confirmada')).toHaveCount(0);

    // Resposta perdida: em confirmação até a verificação pela chave.
    await page.route('**/api/v1/operacoes/**', (r) => r.abort('connectionrefused'));
    await page.route('**/api/v1/conferencias/*/observacoes', async (r) => {
      await r.fetch();
      await r.abort('connectionreset');
    }, { times: 1 });
    await page.getByTestId('campo-codigo').fill('2000000001014');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('entrada-nao-confirmada')).toHaveAttribute('data-estado', 'incerta');

    // Nova versão publicada enquanto a contagem está aberta: aviso e atualização adiada.
    const sw = resolve('apps/web/dist/sw.js');
    const original = readFileSync(sw, 'utf8');
    try {
      writeFileSync(sw, `${original}\n// versão de demonstração ${randomUUID()}\n`);
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
      await expect(page.getByTestId('aviso-nova-versao')).toBeVisible({ timeout: 30_000 });
      page.once('dialog', (d) => void d.accept());
      await page.getByTestId('atualizar-aplicativo').click();
      await expect(page.getByTestId('impedimentos-atualizacao')).toBeVisible();
      await capturar(page, '09-em-confirmacao-e-atualizacao-adiada');
      await page.unroute('**/api/v1/operacoes/**');
      await page.getByRole('button', { name: 'Verificar no servidor' }).click();
      await expect(page.getByTestId('mensagem-conferencia')).toContainText('nada foi somado de novo');
      await page.getByTestId('impedimentos-atualizacao').getByRole('button', { name: 'Entendi' }).click();
      await capturar(page, '10-verificado-sem-duplicar');

      // Foto da conferência (arquivo fictício), privada.
      await page.getByTestId('enviar-anexo-conferencia').setInputFiles({
        name: 'palete-lateral.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2_048)]),
      });
      await expect(page.getByTestId('lista-anexos-conferencia')).toContainText('palete-lateral.jpg');
      await page.getByTestId('anexos-conferencia').scrollIntoViewIfNeeded();
      await capturar(page, '11-foto-na-conferencia');

      // Atualiza: volta à mesma conferência, rascunho confirmado no servidor.
      page.once('dialog', (d) => void d.accept());
      await Promise.all([page.waitForEvent('load', { timeout: 30_000 }), page.getByTestId('atualizar-aplicativo').click()]);
      await expect(page.getByTestId('tela-conferencia')).toBeVisible();
      expect(page.url()).toBe(conferencia);
      await capturar(page, '12-atualizado-mesma-conferencia');
    } finally {
      writeFileSync(sw, original);
    }

    // Abertura sem conexão: casca da interface, sem dados nem login fictício.
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('tela-sem-conexao')).toBeVisible();
    await capturar(page, '13-abertura-sem-conexao');
    await context.setOffline(false);
  });

  test('celular: câmera em tela cheia e conferência com "Ler código" (emulação Pixel 7)', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Fluxo de celular.');
    test.setTimeout(120_000);
    await instalarCameraFalsa(page);
    await entrar(page, 'supervisorDemo');
    await page.goto('/');
    await page.getByRole('button', { name: /^Lista/ }).click();
    await page.getByTestId('ler-codigo-praca').click();
    await mostrarNaCamera(page, await imagemDoCodigo('12000000001011', 'Code128'));
    await expect(page.getByTestId('produto-lido')).toBeVisible({ timeout: 30_000 });
    await capturar(page, '14-celular-camera-produto');
    await page.getByTestId('fechar-camera').click();
    await page.goto('/aplicativo');
    await expect(page.getByTestId('tela-aplicativo')).toBeVisible();
    await capturar(page, '15-celular-aplicativo-e-aparelho');
  });
});
