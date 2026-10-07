import { CABECALHO_CONTRATO, VERSAO_CONTRATO, VersaoServidorSchema } from '@praca-reversa/contracts';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { lerCaminhoBase, lerPersistenciaLocal } from '../../src/config.js';
import { criarBanco } from '../../src/db/cliente.js';

// Banco nunca consultado nestes testes (só arquivos estáticos e rotas públicas sem banco).
const db = criarBanco('postgresql://ninguem:x@127.0.0.1:1/nenhum', () => undefined);
const config = {
  ambiente: 'teste' as const,
  urlPublica: 'http://127.0.0.1:3000',
  cookieSeguro: false,
  appSegredo: 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
  sessaoInatividadeMinutos: 120,
  sessaoDuracaoMaximaHoras: 12,
};
const appDeTeste = (interfaceDir: string | null, caminhoBase = '/') =>
  criarApp({ db, config, interfaceDir, aplicativo: { versao: '0.9.0-teste', caminhoBase, persistenciaLocal: true } });

let pasta: string;
let pastaBase: string;

function criarBuild(destino: string, base: string): void {
  mkdirSync(join(destino, 'assets'));
  writeFileSync(join(destino, 'index.html'), `<!doctype html><title>Praça Reversa</title><script type="module" src="${base}assets/app-abc123.js"></script>`);
  writeFileSync(join(destino, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(destino, 'sw.js'), 'self.addEventListener("fetch", () => {})');
  writeFileSync(join(destino, 'manifest.webmanifest'), '{"name":"Praça Reversa"}');
}

beforeAll(() => {
  pasta = mkdtempSync(join(tmpdir(), 'praca-web-'));
  criarBuild(pasta, '/');
  pastaBase = mkdtempSync(join(tmpdir(), 'praca-web-base-'));
  criarBuild(pastaBase, '/praca/');
});

afterAll(() => {
  rmSync(pasta, { recursive: true, force: true });
  rmSync(pastaBase, { recursive: true, force: true });
});

describe('interface na mesma origem', () => {
  it('serve index.html sem cache e arquivos com hash como imutáveis', async () => {
    const app = await appDeTeste(pasta);
    const raiz = await app.inject({ method: 'GET', url: '/' });
    expect(raiz.statusCode).toBe(200);
    expect(raiz.body).toContain('Praça Reversa');
    expect(raiz.headers['cache-control']).toBe('no-cache');

    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const sw = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(sw.headers['cache-control']).toBe('no-cache');
    await app.close();
  });

  it('devolve index.html para rotas da interface, mas não para a API ou arquivos ausentes', async () => {
    const app = await appDeTeste(pasta);
    const rota = await app.inject({ method: 'GET', url: '/paletes/qualquer' });
    expect(rota.statusCode).toBe(200);
    expect(rota.headers['content-type']).toContain('text/html');

    const api = await app.inject({ method: 'GET', url: '/api/v1/inexistente' });
    expect(api.statusCode).toBe(404);
    expect(api.headers['content-type']).toContain('application/json');
    expect(api.headers['cache-control']).toBe('no-store');

    const arquivo = await app.inject({ method: 'GET', url: '/imagem-inexistente.png' });
    expect(arquivo.statusCode).toBe(404);
    expect(arquivo.headers['content-type']).toContain('application/json');
    await app.close();
  });

  it('não serve a interface quando a pasta não é configurada', async () => {
    const app = await appDeTeste(null);
    const raiz = await app.inject({ method: 'GET', url: '/' });
    expect(raiz.statusCode).toBe(404);
    await app.close();
  });

  it('recusa iniciar com build gerado para outro caminho-base', async () => {
    await expect(appDeTeste(pasta, '/praca/')).rejects.toThrow(/caminho-base "\/praca\/"/);
    await expect(appDeTeste(pastaBase, '/')).rejects.toThrow(/caminho-base "\/"/);
  });
});

describe('caminho-base (CAMINHO_BASE=/praca/)', () => {
  it('serve interface, rotas profundas e API sob o caminho-base; a raiz leva à instalação', async () => {
    const app = await appDeTeste(pastaBase, '/praca/');
    const indice = await app.inject({ method: 'GET', url: '/praca/' });
    expect(indice.statusCode).toBe(200);
    expect(indice.body).toContain('/praca/assets/app-abc123.js');

    const profunda = await app.inject({ method: 'GET', url: '/praca/paletes/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e' });
    expect(profunda.statusCode).toBe(200);
    expect(profunda.headers['content-type']).toContain('text/html');

    const asset = await app.inject({ method: 'GET', url: '/praca/assets/app-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');

    const saude = await app.inject({ method: 'GET', url: '/praca/api/v1/health' });
    expect(saude.statusCode).toBe(200);
    expect(saude.headers['cache-control']).toBe('no-store');
    expect(saude.headers[CABECALHO_CONTRATO]).toBe(String(VERSAO_CONTRATO));

    // API inexistente sob o caminho-base: JSON 404, nunca o index.html.
    const apiAusente = await app.inject({ method: 'GET', url: '/praca/api/v1/inexistente' });
    expect(apiAusente.statusCode).toBe(404);
    expect(apiAusente.headers['content-type']).toContain('application/json');

    // Fora do caminho-base: a API "solta" não existe; a raiz redireciona.
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(404);
    const raiz = await app.inject({ method: 'GET', url: '/' });
    expect(raiz.statusCode).toBe(302);
    expect(raiz.headers.location).toBe('/praca/');
    expect((await app.inject({ method: 'GET', url: '/paletes/x' })).headers['content-type']).toContain('application/json');
    await app.close();
  });

  it('versão pública informa contrato, política de rascunho e caminho-base', async () => {
    const app = await appDeTeste(pastaBase, '/praca/');
    const resposta = await app.inject({ method: 'GET', url: '/praca/api/v1/versao' });
    expect(resposta.statusCode).toBe(200);
    const versao = VersaoServidorSchema.parse(resposta.json());
    expect(versao).toMatchObject({ application: '0.9.0-teste', contract: VERSAO_CONTRATO, localDrafts: true, labelOrigin: 'http://127.0.0.1:3000', basePath: '/praca/' });
    await app.close();
  });

  it('interface de outro contrato não grava (antes de autenticar ou validar), mas pode entrar e sair', async () => {
    const app = await appDeTeste(null);
    const antiga = await app.inject({
      method: 'POST',
      url: '/api/v1/paletes',
      headers: { 'content-type': 'application/json', [CABECALHO_CONTRATO]: String(VERSAO_CONTRATO - 1) },
      payload: {},
    });
    expect(antiga.statusCode).toBe(409);
    expect(antiga.json()).toMatchObject({ error: { code: 'VERSAO_INCOMPATIVEL' } });
    const futura = await app.inject({
      method: 'POST',
      url: '/api/v1/paletes',
      headers: { 'content-type': 'application/json', [CABECALHO_CONTRATO]: String(VERSAO_CONTRATO + 1) },
      payload: {},
    });
    expect(futura.json()).toMatchObject({ error: { code: 'VERSAO_INCOMPATIVEL' } });
    // Sair continua possível (sem sessão: resposta normal da rota, não VERSAO_INCOMPATIVEL).
    const sair = await app.inject({ method: 'DELETE', url: '/api/v1/sessao', headers: { [CABECALHO_CONTRATO]: '1' } });
    expect(sair.json()).not.toMatchObject({ error: { code: 'VERSAO_INCOMPATIVEL' } });
    // Contrato atual segue para a autenticação normal.
    const atual = await app.inject({
      method: 'POST',
      url: '/api/v1/paletes',
      headers: { 'content-type': 'application/json', [CABECALHO_CONTRATO]: String(VERSAO_CONTRATO) },
      payload: {},
    });
    expect(atual.statusCode).toBe(401);
    await app.close();
  });
});

describe('configuração da etapa 09', () => {
  it('caminho-base aceita só segmentos simples', () => {
    expect(lerCaminhoBase(undefined)).toBe('/');
    expect(lerCaminhoBase('/praca')).toBe('/praca/');
    expect(lerCaminhoBase('/praca/reversa/')).toBe('/praca/reversa/');
    for (const invalido of ['praca', '/../x/', '//x/', '/praca?x=1', '/pra ca/', 'C:/Program Files/Git/praca/']) {
      expect(() => lerCaminhoBase(invalido), invalido).toThrow(/CAMINHO_BASE/);
    }
  });

  it('rascunho no navegador nunca em produção', () => {
    expect(lerPersistenciaLocal(undefined, true)).toBe(false);
    expect(lerPersistenciaLocal('desativada', true)).toBe(false);
    expect(() => lerPersistenciaLocal('ativada', true)).toThrow(/PERSISTENCIA_LOCAL/);
    expect(lerPersistenciaLocal(undefined, false)).toBe(true);
    expect(lerPersistenciaLocal('desativada', false)).toBe(false);
  });
});
