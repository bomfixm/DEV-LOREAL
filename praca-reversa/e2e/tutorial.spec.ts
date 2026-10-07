import { expect, test, type Locator, type Page } from '@playwright/test';
import { aguardarMapa, ehCelular, entrar } from './apoio';
import type { Credenciais } from './credenciais';

/**
 * Tutorial e ajuda (etapa 10), no computador e no celular (Pixel 7
 * emulado): convite de primeiro acesso, primeiro percurso com os elementos
 * reais da tela, interromper/retomar, ambiente vazio, permissões e ajuda por
 * tarefa. O tutorial só observa: nenhuma gravação além da preferência do
 * próprio usuário. Dados fictícios da demonstração.
 */

async function balaoNaoCobre(page: Page): Promise<void> {
  const balao = await page.getByTestId('tutorial').boundingBox();
  const destaque = await page.getByTestId('tutorial-destaque').boundingBox();
  if (!balao || !destaque) throw new Error('Balão ou destaque ausente.');
  // O destaque tem 6 px de folga em volta do elemento real.
  const alvo = { x: destaque.x + 6, y: destaque.y + 6, width: destaque.width - 12, height: destaque.height - 12 };
  const cruza = balao.x < alvo.x + alvo.width && alvo.x < balao.x + balao.width && balao.y < alvo.y + alvo.height && alvo.y < balao.y + balao.height;
  expect(cruza, `balão ${JSON.stringify(balao)} cobre o alvo ${JSON.stringify(alvo)}`).toBe(false);
}

async function aguardarPasso(page: Page, passo: number, apontando = true): Promise<Locator> {
  const balao = page.getByTestId('tutorial');
  await expect(balao).toHaveAttribute('data-passo', String(passo));
  if (apontando) {
    await expect(balao).toHaveAttribute('data-apontando', 'sim');
    await expect(page.getByTestId('tutorial-destaque')).toBeVisible();
  }
  return balao;
}

/** Gravações feitas pela página (método diferente de GET) durante o percurso. */
function vigiarGravacoes(page: Page): string[] {
  const gravacoes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes('/api/')) gravacoes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return gravacoes;
}

async function preferencia(page: Page): Promise<{ state: string; step: number | null }> {
  return (await (await page.request.get('/api/v1/preferencias/tutorial')).json()) as { state: string; step: number | null };
}

test.describe('Tutorial de primeiro uso', () => {
  test('primeiro acesso: convite, percurso com os elementos reais, sem gravar nada além da preferência', async ({ page }, testInfo) => {
    const celular = ehCelular(testInfo);
    const quem: keyof Credenciais = celular ? 'tutorialCelular' : 'tutorialComputador';
    await entrar(page, quem);
    await aguardarMapa(page);
    // Depois do login: tudo o que a página gravar durante o tutorial.
    const gravacoes = vigiarGravacoes(page);
    const convite = page.getByTestId('oferta-tutorial');
    await expect(convite).toBeVisible();
    await expect(convite.getByRole('button', { name: 'Começar' })).toBeVisible();
    await expect(convite.getByRole('button', { name: 'Agora não' })).toBeVisible();
    await convite.getByRole('button', { name: 'Começar' }).click();

    // 1. Ambiente: demonstração com dados fictícios, apontando o selo real.
    let balao = await aguardarPasso(page, 1);
    await expect(balao).toContainText('Você está na demonstração');
    await expect(balao).toContainText('fictícios');
    await expect(balao.getByRole('heading')).toBeFocused();
    await balaoNaoCobre(page);
    await balao.getByRole('button', { name: 'Próximo' }).click();

    // 2. Onde pesquisar: aponta "Buscar conteúdo" (computador) ou a aba "Busca" (celular), com o exemplo real.
    balao = await aguardarPasso(page, 2);
    await expect(page.getByTestId('tutorial-exemplo')).toContainText('DEMO-101');
    await balaoNaoCobre(page);
    if (celular) await page.getByRole('button', { name: 'Busca', exact: true }).click();
    else await page.getByTestId('painel-busca-botao').click();
    await expect(balao).toContainText('Digite DEMO-101 no campo "Buscar"');
    await expect(page.getByTestId('tutorial-estado')).toHaveAttribute('data-feito', 'nao');
    await page.getByTestId('campo-busca').fill('DEMO-101');
    await expect(page.getByTestId('tutorial-estado')).toHaveAttribute('data-feito', 'sim');
    await balaoNaoCobre(page);
    await balao.getByRole('button', { name: 'Próximo' }).click();

    // 3. Escolher: aponta "Ver no mapa" do cartão com saldo validado; explica que o SKU aparece em vários paletes e bases.
    balao = await aguardarPasso(page, 3);
    await expect(balao).toContainText('PAL-DEMO-001');
    await expect(balao).toContainText(/aparece em \d+ palete\(s\)/);
    await expect(balao).toContainText('As bases não se somam');
    await balaoNaoCobre(page);
    await page.locator('[data-testid="resultado-busca"][data-palete="PAL-DEMO-001"][data-base="SALDO_VALIDADO"]').getByTestId('resultado-abrir').click();
    await expect(page.getByTestId('tutorial-estado')).toHaveAttribute('data-feito', 'sim');
    await balao.getByRole('button', { name: 'Próximo' }).click();

    // 4. Palete: ID permanente e endereço (no celular, primeiro "Ver conteúdo").
    balao = await aguardarPasso(page, 4);
    if (celular) {
      await expect(balao).toContainText('Toque em "Ver conteúdo"');
      await balaoNaoCobre(page);
      await page.getByRole('button', { name: 'Ver conteúdo' }).click();
      await expect(balao).toContainText('ID permanente');
    }
    await expect(balao).toContainText('ID identifica o palete. Endereço mostra onde ele está agora');
    await expect(page.getByTestId('detalhe')).toContainText('PAL-DEMO-001');
    await balaoNaoCobre(page);
    await balao.getByRole('button', { name: 'Próximo' }).click();

    // 5. Quantidades e pendências: aponta a seção "Conteúdo".
    balao = await aguardarPasso(page, 5);
    await expect(balao).toContainText('Declarado veio do documento; observado veio da contagem; saldo validado foi conferido e aprovado');
    await expect(balao).toContainText('não que o palete está vazio');
    await balao.getByRole('button', { name: 'Anterior' }).click();
    await aguardarPasso(page, 4);
    await page.getByTestId('tutorial').getByRole('button', { name: 'Próximo' }).click();
    await aguardarPasso(page, 5);
    await page.getByTestId('tutorial').getByRole('button', { name: 'Próximo' }).click();

    // 6. Repetir e próximos guias: aponta o botão "Ajuda".
    balao = await aguardarPasso(page, 6);
    await expect(balao).toContainText('Próximos guias para o seu perfil');
    await balao.getByRole('button', { name: 'Concluir', exact: true }).click();
    await expect(page.getByTestId('tutorial')).toBeHidden();
    await expect.poll(async () => (await preferencia(page)).state).toBe('CONCLUIDO');
    await page.reload();
    await aguardarMapa(page);
    await expect(page.getByTestId('oferta-tutorial')).toBeHidden();
    // O tutorial não clicou nem gravou nada no estoque: só a preferência do próprio usuário.
    expect(gravacoes.filter((g) => !g.endsWith('/api/v1/preferencias/tutorial'))).toEqual([]);
  });

  test('"Agora não" guarda a escolha; o tutorial continua na Ajuda; sair no meio e continuar do mesmo passo', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'Preferência por usuário: verificada uma vez no computador.');
    await entrar(page, 'tutorialAdiar');
    await aguardarMapa(page);
    await page.getByTestId('oferta-tutorial').getByRole('button', { name: 'Agora não' }).click();
    await expect(page.getByTestId('oferta-tutorial')).toBeHidden();
    await expect.poll(async () => (await preferencia(page)).state).toBe('ADIADO');
    await page.reload();
    await aguardarMapa(page);
    await expect(page.getByTestId('oferta-tutorial')).toBeHidden();

    // Começar pela Ajuda, avançar e sair no passo 2 (Escape dentro do balão).
    await page.getByTestId('botao-ajuda').click();
    await expect(page.getByTestId('tela-ajuda')).toBeVisible();
    await page.getByTestId('ajuda-comecar-tutorial').click();
    await aguardarMapa(page);
    await aguardarPasso(page, 1);
    await page.getByTestId('tutorial-proximo').click();
    await aguardarPasso(page, 2);
    await page.getByTestId('tutorial').getByRole('heading').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tutorial')).toBeHidden();
    await expect.poll(async () => preferencia(page)).toMatchObject({ state: 'INTERROMPIDO', step: 2 });

    // Retomar do mesmo passo pela Ajuda.
    await page.getByTestId('botao-ajuda').click();
    await expect(page.getByTestId('ajuda-continuar')).toHaveText('Continuar do passo 2');
    await page.getByTestId('ajuda-continuar').click();
    await aguardarPasso(page, 2);
    // Recolher não perde o passo.
    await page.getByRole('button', { name: 'Recolher o tutorial' }).click();
    await expect(page.getByTestId('tutorial-mostrar')).toHaveText('Tutorial · passo 2 de 6 — mostrar');
    await page.getByTestId('tutorial-mostrar').click();
    await aguardarPasso(page, 2);
    await page.getByTestId('tutorial-sair').click();
    await expect(page.getByTestId('tutorial')).toBeHidden();
  });

  test('ambiente vazio: orienta um próximo passo válido sem apontar para botões que não existem', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'Ambiente vazio verificado no computador.');
    await entrar(page, 'adminVazio');
    await expect(page.getByTestId('sem-layout')).toBeVisible();
    await page.getByTestId('botao-ajuda').click();
    await page.getByTestId('ajuda-comecar-tutorial').click();
    const balao = await aguardarPasso(page, 1);
    await expect(balao).toContainText('Você está no escopo da operação');
    await expect(balao).toContainText('não cria, não move e não confirma nada');
    await page.getByTestId('tutorial-proximo').click();
    await aguardarPasso(page, 2);
    await expect(page.getByTestId('tutorial')).toContainText('Sem exemplo neste escopo');
    await expect(page.getByTestId('tutorial')).toContainText('Você não precisa criar estoque para aprender');
    for (const passo of [3, 4, 5]) {
      await page.getByTestId('tutorial-proximo').click();
      await aguardarPasso(page, passo, false);
      await expect(page.getByTestId('tutorial')).toHaveAttribute('data-apontando', 'nao');
      await expect(page.getByTestId('tutorial')).toContainText('Indisponível agora');
      await expect(page.getByTestId('tutorial-destaque')).toBeHidden();
    }
    await page.getByTestId('tutorial-proximo').click();
    await aguardarPasso(page, 6);
    await page.getByTestId('tutorial-concluir').click();
    await expect(page.getByTestId('tutorial')).toBeHidden();
  });
});

test.describe('Ajuda por tarefa', () => {
  test('central de ajuda: guias com o que fazer/onde/o que aparece, adaptados ao perfil; glossário e dúvidas', async ({ page }) => {
    await entrar(page, 'consulta');
    await aguardarMapa(page);
    await page.getByTestId('botao-ajuda').click();
    const ajuda = page.getByTestId('tela-ajuda');
    await expect(ajuda.getByRole('heading', { name: 'Começar aqui' })).toBeVisible();
    for (const titulo of ['Consultar palete ou produto', 'Cadastrar palete', 'Conferir material', 'Tratar divergência', 'Mover palete ou transferir produtos', 'Investigar claim', 'Preparar uma janela de devolução', 'Confirmar saída (expedição)', 'Usar a câmera e o aplicativo instalado', 'Resolver uma interrupção']) {
      await expect(ajuda.getByRole('heading', { name: titulo, exact: true })).toBeVisible();
    }
    // Perfil Consulta: cadastro é de outro perfil (sem instrução de contorno).
    const cadastrar = page.getByTestId('guia-cadastrar');
    await expect(cadastrar.getByTestId('guia-sem-permissao')).toContainText('Seu perfil não cadastra paletes');
    await expect(cadastrar.locator('li[data-pode="nao"]').first()).toContainText('Outro perfil executa este passo');
    await expect(page.getByTestId('guia-consultar').locator('li[data-pode="nao"]')).toHaveCount(0);
    await expect(ajuda.getByRole('heading', { name: 'Glossário' })).toBeVisible();
    for (const termo of ['Palete', 'Endereço (posição)', 'SKU', 'Lote', 'Conferência', 'Reconciliação', 'Claim', 'Liberação', 'Janela', 'Reserva', 'Expedição']) {
      await expect(ajuda.locator('.glossario dt', { hasText: termo }).first()).toBeVisible();
    }
    await expect(ajuda.getByRole('heading', { name: 'O que esta versão ainda não faz' })).toBeVisible();
    // Guia pedido pela tela de origem.
    await page.goto('/ajuda?guia=interrupcao');
    await expect(page.locator('.ajuda-guia--pedido')).toContainText('Resolver uma interrupção');
  });

  test('ajuda curta na própria tela: mapa e aplicativo', async ({ page }, testInfo) => {
    await entrar(page, 'operadorDemo');
    await aguardarMapa(page);
    // No celular a ajuda do mapa fica na aba "Lista" (o mapa ocupa a tela).
    if (ehCelular(testInfo)) await page.getByRole('button', { name: /^Lista/ }).click();
    const ajudaMapa = page.getByTestId('ajuda-consultar').first();
    await ajudaMapa.locator('summary').click();
    await expect(ajudaMapa).toContainText('Toque em "Buscar conteúdo"');
    await expect(ajudaMapa).toContainText('ID identifica o palete');
    await page.goto('/aplicativo');
    const ajudaCamera = page.getByTestId('ajuda-camera');
    await ajudaCamera.locator('summary').click();
    await expect(ajudaCamera).toContainText('Ler código (câmera)');
    await ajudaCamera.getByRole('button', { name: /Abrir na Ajuda/ }).click();
    await expect(page.locator('.ajuda-guia--pedido')).toContainText('Usar a câmera e o aplicativo instalado');
  });
});
