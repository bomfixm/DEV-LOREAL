import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ehCelular, entrar, obterPraca, type PracaApi } from './apoio';

/**
 * Registrar conteúdo — palete confirmado só por ação explícita (27 out. 2026),
 * no escopo de cadastro do E2E (paletes fictícios 1, 10, 100 e 1000): digitar
 * devagar, colar, apagar, Tab ou sair do campo não confirmam o palete; Enter
 * confirma o número completo (correspondência exata, nunca prefixo ou primeira
 * sugestão) sem disparar "Salvar conteúdo"; número inexistente não avança;
 * "Trocar palete" segue a mesma regra; salvar e conferência continuam iguais.
 */
async function chamar(page: Page, caminho: string, corpo: unknown): Promise<APIResponse> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return page.request.fetch(caminho, { method: 'POST', data: corpo, headers: { 'x-csrf-token': sessao.csrfToken, 'idempotency-key': randomUUID() } });
}

const CODIGOS = ['1', '10', '100', '1000'] as const;
type Codigo = (typeof CODIGOS)[number];
interface PaleteTeste {
  id: string;
  endereco: string;
}

/** Paletes 1, 10, 100 e 1000 (criados uma vez por banco de E2E); 10 e 100 em posições livres diferentes. */
async function paletesDoTeste(page: Page): Promise<Record<Codigo, PaleteTeste>> {
  let praca: PracaApi = await obterPraca(page);
  const existentes = new Set(praca.pallets.map((p) => p.code));
  const ocupadas = new Set(praca.pallets.map((p) => p.positionId));
  const livres = praca.layout.positions.filter((p) => p.available && !ocupadas.has(p.id));
  for (const code of CODIGOS) {
    if (existentes.has(code)) continue;
    const posicao = code === '10' || code === '100' ? livres.shift() : undefined;
    const r = await chamar(page, '/api/v1/paletes', { code: { mode: 'INFORMAR', value: code }, positionId: posicao?.id ?? null, notes: 'Confirmar palete só com Enter (fictício)', declaredItems: [] });
    expect(r.status(), await r.text()).toBe(201);
  }
  praca = await obterPraca(page);
  const posicoes = new Map(praca.layout.positions.map((p) => [p.id, p.code]));
  const resultado = {} as Record<Codigo, PaleteTeste>;
  for (const code of CODIGOS) {
    const p = praca.pallets.find((x) => x.code === code);
    expect(p, `palete ${code} na praça`).toBeTruthy();
    const posicao = p?.positionId ? posicoes.get(p.positionId) : undefined;
    resultado[code] = { id: p?.id ?? '', endereco: posicao ? `Posição ${posicao}` : 'Sem endereço registrado' };
  }
  expect(resultado['100'].endereco).not.toBe(resultado['10'].endereco);
  return resultado;
}

const entrada = (page: Page): Locator => page.getByTestId('conteudo-palete-entrada');
const escolhido = (page: Page): Locator => page.getByTestId('conteudo-palete-codigo');

/** Digita tecla a tecla com pausa, conferindo a cada dígito que nada foi confirmado. */
async function digitarDevagar(page: Page, texto: string, pausa = 700): Promise<void> {
  const campo = entrada(page);
  const inicial = await campo.inputValue();
  for (let i = 0; i < texto.length; i += 1) {
    await page.keyboard.type(texto.charAt(i));
    await page.waitForTimeout(pausa);
    await expect(campo).toHaveValue(inicial + texto.slice(0, i + 1));
    await expect(escolhido(page)).toHaveCount(0);
  }
}

async function confirmadoCom(page: Page, code: string, p: PaleteTeste): Promise<void> {
  await expect(escolhido(page)).toHaveText(code);
  await expect(page.getByTestId('conteudo-palete-destino')).toContainText(p.endereco);
  await expect(entrada(page)).toHaveCount(0);
}

/** POSTs de conteúdo feitos pela tela (nenhum pode sair do Enter do palete). */
function contarSalvamentos(page: Page): () => number {
  let n = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/conteudos')) n += 1;
  });
  return () => n;
}

test.describe('Registrar conteúdo — palete confirmado só com Enter', () => {
  test('digitar 100 devagar não confirma 1 nem 10; Enter confirma 100 com o endereço, sem salvar', async ({ page }) => {
    await entrar(page, 'operador');
    const paletes = await paletesDoTeste(page);
    const salvamentos = contarSalvamentos(page);
    await page.goto('/conteudos/novo');
    await expect(entrada(page)).toBeVisible();
    await entrada(page).click();

    await digitarDevagar(page, '100');
    // Continua no seletor com 100 intacto; nada para salvar ainda.
    await expect(entrada(page)).toBeFocused();
    await expect(page.getByTestId('salvar-conteudo')).toBeDisabled();
    await page.waitForTimeout(1500);
    await expect(entrada(page)).toHaveValue('100');
    await expect(escolhido(page)).toHaveCount(0);

    await entrada(page).press('Enter');
    await confirmadoCom(page, '100', paletes['100']);
    // O mesmo Enter não dispara "Salvar conteúdo" (nem a validação dele).
    await page.waitForTimeout(500);
    expect(salvamentos()).toBe(0);
    await expect(page.getByTestId('erro-conteudo')).toHaveCount(0);
    await expect(page.getByTestId('conteudo-salvo')).toHaveCount(0);
    await expect(page.getByTestId('salvar-conteudo')).toBeEnabled();
  });

  test('10, 1000, colar, Backspace, Tab, sair do campo, inexistente e "Trocar palete"', async ({ page, context }, testInfo) => {
    await entrar(page, 'operador');
    const paletes = await paletesDoTeste(page);
    await page.goto('/conteudos/novo');
    await entrada(page).click();

    // 10: devagar, só confirma no Enter.
    await digitarDevagar(page, '10');
    await entrada(page).press('Enter');
    await confirmadoCom(page, '10', paletes['10']);

    // Trocar palete: o campo volta vazio, com o foco, e a regra é a mesma.
    await page.getByRole('button', { name: 'Trocar palete' }).click();
    await expect(entrada(page)).toHaveValue('');
    await expect(entrada(page)).toBeFocused();
    await digitarDevagar(page, '1000', 500);
    await entrada(page).press('Enter');
    await confirmadoCom(page, '1000', paletes['1000']);

    // Colar 100 não confirma; Backspace e redigitar também não; Tab e clique fora também não.
    await page.getByRole('button', { name: 'Trocar palete' }).click();
    if (!ehCelular(testInfo)) {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate(() => navigator.clipboard.writeText('100'));
      await entrada(page).press('ControlOrMeta+V');
    } else {
      // Celular emulado sem área de transferência: inserção de uma vez, como o teclado faz ao colar.
      await page.keyboard.insertText('100');
    }
    await expect(entrada(page)).toHaveValue('100');
    await page.waitForTimeout(800);
    await expect(escolhido(page)).toHaveCount(0);
    await entrada(page).press('Backspace');
    await page.waitForTimeout(600);
    await expect(entrada(page)).toHaveValue('10');
    await expect(escolhido(page)).toHaveCount(0);
    await entrada(page).press('Backspace');
    await entrada(page).press('Backspace');
    await expect(entrada(page)).toHaveValue('');
    await digitarDevagar(page, '100', 400);
    await entrada(page).press('Tab');
    await page.waitForTimeout(600);
    await expect(entrada(page)).toHaveValue('100');
    await expect(escolhido(page)).toHaveCount(0);
    await page.getByRole('heading', { name: 'Registrar conteúdo' }).click();
    await page.waitForTimeout(600);
    await expect(escolhido(page)).toHaveCount(0);

    // Inexistente: avisa, não avança nem escolhe outro (nem por prefixo), e o campo segue para correção.
    await entrada(page).fill('100999');
    await entrada(page).press('Enter');
    await expect(page.getByTestId('conteudo-palete-aviso')).toContainText('100999');
    await expect(escolhido(page)).toHaveCount(0);
    await expect(entrada(page)).toHaveValue('100999');
    await expect(entrada(page)).toBeFocused();
    // Corrigir com Backspace até 100 e confirmar.
    for (let i = 0; i < 3; i += 1) await entrada(page).press('Backspace');
    await expect(page.getByTestId('conteudo-palete-aviso')).toHaveCount(0);
    await expect(escolhido(page)).toHaveCount(0);
    await entrada(page).press('Enter');
    await confirmadoCom(page, '100', paletes['100']);

    // 1 existe, mas só é escolhido quando 1 é o número completo confirmado.
    await page.getByRole('button', { name: 'Trocar palete' }).click();
    await page.keyboard.type('1');
    await page.waitForTimeout(600);
    await expect(escolhido(page)).toHaveCount(0);
    await entrada(page).press('Enter');
    await confirmadoCom(page, '1', paletes['1']);
  });

  test('praça ainda carregando: Enter não escolhe e a resposta atrasada não confirma sozinha', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'mesma regra no celular (coberta acima)');
    await entrar(page, 'operador');
    const paletes = await paletesDoTeste(page);
    let liberar: () => void = () => undefined;
    const retida = new Promise<void>((r) => {
      liberar = r;
    });
    await page.route('**/api/v1/praca', async (rota) => {
      await retida;
      await rota.continue();
    });
    await page.goto('/conteudos/novo');
    await entrada(page).click();
    await page.keyboard.type('100');
    await entrada(page).press('Enter');
    await expect(page.getByTestId('conteudo-palete-aviso')).toContainText('Carregando');
    await expect(escolhido(page)).toHaveCount(0);
    // A lista chega depois: nada é escolhido sem um novo Enter.
    liberar();
    await expect(page.getByTestId('conteudo-palete-aviso')).toHaveCount(0);
    await page.waitForTimeout(800);
    await expect(entrada(page)).toHaveValue('100');
    await expect(escolhido(page)).toHaveCount(0);
    await entrada(page).press('Enter');
    await confirmadoCom(page, '100', paletes['100']);
  });

  test('escolher da lista de sugestões confirma o palete exato', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'mesma regra no celular (coberta acima)');
    await entrar(page, 'operador');
    const paletes = await paletesDoTeste(page);
    await page.goto('/conteudos/novo');
    await entrada(page).click();
    await page.keyboard.type('10');
    await expect(escolhido(page)).toHaveCount(0);
    // A lista nativa (datalist) não é clicável pelo Playwright: o Chrome preenche o campo e dispara um
    // "input" sem tipo de digitação — o mesmo evento é reproduzido aqui com o valor escolhido.
    await entrada(page).evaluate((campo: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(campo, '100');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await confirmadoCom(page, '100', paletes['100']);
  });

  test('remetente, documento e Delivery opcionais, salvar e conferência continuam iguais no 100', async ({ page }, testInfo) => {
    test.skip(ehCelular(testInfo), 'fluxo de computador (o celular usa as mesmas telas)');
    await entrar(page, 'operador');
    const paletes = await paletesDoTeste(page);
    const remetente = `Remetente Enter ${randomUUID().slice(0, 6)}`;
    await page.goto('/conteudos/novo');
    await entrada(page).click();
    await page.keyboard.type('100');
    await entrada(page).press('Enter');
    await confirmadoCom(page, '100', paletes['100']);

    // Sem remetente, a validação de sempre (o servidor não é chamado).
    await page.getByTestId('salvar-conteudo').click();
    await expect(page.getByTestId('erro-conteudo')).toBeVisible();
    await expect(page.getByTestId('conteudo-salvo')).toHaveCount(0);

    // Enter no remetente salva, como antes (submissão do formulário do conteúdo).
    await page.getByTestId('conteudo-remetente').fill(remetente);
    await page.getByTestId('conteudo-remetente').press('Enter');
    await expect(page.getByTestId('conteudo-salvo')).toContainText('100');
    await expect(page.getByTestId('conteudo-salvo')).toContainText('Documento não informado');
    await expect(page.getByTestId('conteudo-salvo')).toContainText('Delivery não informado');
    await expect(page.getByTestId('conteudo-salvo-volumes')).toHaveText('Aguardando conferência');

    await page.getByTestId('registrar-outro').click();
    await expect(escolhido(page)).toHaveText('100');
    await page.getByTestId('conteudo-remetente').fill(remetente);
    await page.getByTestId('conteudo-tipo-NF').check();
    await page.getByTestId('conteudo-numero').fill('000314');
    await page.getByTestId('conteudo-delivery').fill('DLV-ENTER-1');
    await page.getByTestId('salvar-conteudo').click();
    await expect(page.getByTestId('conteudo-salvo')).toContainText('DLV-ENTER-1');
    await page.getByTestId('ir-conferencia').click();

    // Conferência de volumes do palete 100 (não do 10) com os dois conteúdos.
    await expect(page).toHaveURL(new RegExp(`/paletes/${paletes['100'].id}/volumes$`));
    const itens = page.getByTestId('conteudo-item').filter({ hasText: remetente });
    await expect(itens).toHaveCount(2);
    await expect(page.getByTestId('volumes-tabela').getByTestId('conf-linha').filter({ hasText: remetente })).toHaveCount(2);
    const doDez = (await (await page.request.get(`/api/v1/paletes/${paletes['10'].id}/conteudos`)).json()) as { items: { sender: string }[] };
    expect(doDez.items.filter((i) => i.sender === remetente)).toHaveLength(0);
  });
});
