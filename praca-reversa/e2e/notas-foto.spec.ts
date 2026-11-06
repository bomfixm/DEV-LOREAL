import { expect, test, type Page } from '@playwright/test';
import { entrar, obterPraca } from './apoio';

/** Etiqueta desenhada no navegador (fixture: NÃO é a foto real): faixa preta com texto branco e os nomes abaixo. */
async function etiqueta(page: Page, nf: string, ref: string): Promise<Buffer> {
  const dados = await page.evaluate(
    ([numero, referencia]) => {
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 800;
      const x = c.getContext('2d');
      if (!x) throw new Error('sem canvas');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, 1200, 800);
      x.fillStyle = '#000';
      x.fillRect(0, 60, 1200, 130);
      x.fillStyle = '#fff';
      x.font = 'bold 90px Arial';
      x.fillText(numero ?? '', 60, 160);
      x.fillStyle = '#000';
      x.font = 'bold 60px Arial';
      x.fillText('Atacadao S.A', 60, 300);
      x.fillText('Loreal Brasil Com. Cosm. Ltda', 60, 400);
      x.font = 'bold 80px Arial';
      x.fillText(referencia ?? '', 60, 560);
      return c.toDataURL('image/png').split(',')[1] ?? '';
    },
    [nf, ref],
  );
  return Buffer.from(dados, 'base64');
}

test('notas por foto: foto, leitura real, FULL com 100 manual, salvar, recarregar e incluir', async ({ page }, info) => {
  test.setTimeout(240_000);
  test.skip(info.project.name !== 'computador', 'O fluxo é o mesmo; o celular real é testado no aparelho.');
  await entrar(page, 'supervisorDemo');
  const praca = await obterPraca(page);
  const palete = praca.pallets.find((p) => p.positionId !== null);
  if (!palete) throw new Error('Sem palete.');
  await page.goto(`/paletes/${palete.id}/notas-foto`);
  await expect(page.getByTestId('tela-notas-foto')).toBeVisible();

  // A foto não sai do aparelho: nenhuma requisição leva imagem.
  const comImagem: string[] = [];
  page.on('request', (r) => {
    const tipo = r.headers()['content-type'] ?? '';
    if (r.method() !== 'GET' && (tipo.includes('octet-stream') || tipo.startsWith('image/') || (r.postDataBuffer()?.length ?? 0) > 64 * 1024)) comImagem.push(r.url());
  });
  await page.getByTestId('notas-foto-galeria').setInputFiles({ name: 'etiqueta.png', mimeType: 'image/png', buffer: await etiqueta(page, '000094123-1', '00001/00002') });
  const linha = page.getByTestId('notas-foto-linha');
  await expect(linha).toHaveCount(1, { timeout: 30_000 });

  // OCR real no navegador: NF sem o sufixo, remetente certo, destinatário fora e volumes vazios.
  await expect(linha.getByTestId('notas-foto-numero')).toHaveValue('94123', { timeout: 150_000 });
  await expect(linha.getByTestId('notas-foto-remetente')).toHaveValue(/Atacadao/);
  await expect(linha.getByTestId('notas-foto-volumes')).toHaveValue('');
  await expect(linha.getByTestId('notas-foto-etiqueta')).toHaveValue('');

  await linha.getByTestId('notas-foto-etiqueta').selectOption('FULL');
  await expect(linha).toContainText('não é quantidade');
  await linha.getByTestId('notas-foto-volumes').fill('100');
  await expect(linha.getByTestId('notas-foto-volumes')).toHaveValue('100');
  await page.getByTestId('notas-foto-salvar').click();
  await expect(page.getByTestId('notas-foto-resumo')).toContainText('1 nota(s) salva(s)');

  // Retomar depois: recarregar mantém tudo, a partir do servidor.
  await page.reload();
  await expect(page.getByTestId('notas-foto-linha').getByTestId('notas-foto-volumes')).toHaveValue('100', { timeout: 30_000 });

  await page.getByTestId('notas-foto-incluir').click();
  await expect(page.getByTestId('notas-foto-resumo')).toContainText('1 nota(s) incluída(s)');
  await expect(page.getByTestId('notas-foto-linha')).toHaveCount(0);
  const conteudos = (await (await page.request.get(`/api/v1/paletes/${palete.id}/conteudos`)).json()) as { items: { documentNumber: string | null; sender: string | null; count: { counted: string | null } }[] };
  const nota = conteudos.items.filter((i) => i.documentNumber === '94123');
  expect(nota).toHaveLength(1);
  expect(nota[0]?.count.counted).toBe('100');
  expect(nota[0]?.sender).toMatch(/Atacadao/);
  expect(comImagem).toEqual([]);
});
