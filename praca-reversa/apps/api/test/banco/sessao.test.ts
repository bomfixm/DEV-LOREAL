import { ErroApiSchema, SessaoSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import {
  ID_ESCOPO_NAVEGACAO,
  ID_ESCOPO_PRACA,
  Relogio,
  appDeTeste,
  bancoDeTeste,
  como,
  cookieDe,
  criarUsuario,
  entrar,
  prepararDados,
  type UsuarioTeste,
} from './apoio.js';

let db: Banco;
let relogio: Relogio;
let app: FastifyInstance;
let maria: UsuarioTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  relogio = new Relogio();
  app = await appDeTeste(db, { agora: relogio.agora });
  maria = await criarUsuario(db, 'maria', [
    [ID_ESCOPO_PRACA, 'CONSULTA'],
    [ID_ESCOPO_NAVEGACAO, 'OPERADOR'],
  ]);
});

afterAll(async () => {
  await db.$disconnect();
});

const login = (corpo: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/v1/sessao', payload: corpo as object, headers });

describe('login', () => {
  it('cria sessão com cookie HttpOnly, SameSite=Strict e escopo ativo inicial', async () => {
    const resposta = await login({ login: 'Maria', senha: maria.senha });
    expect(resposta.statusCode).toBe(200);
    const cabecalho = String(resposta.headers['set-cookie']);
    expect(cabecalho).toMatch(/^pr_sessao=[A-Za-z0-9_-]{43};/);
    expect(cabecalho).toMatch(/HttpOnly/);
    expect(cabecalho).toMatch(/SameSite=Strict/);
    expect(cabecalho).toMatch(/Path=\//);
    expect(cabecalho).not.toMatch(/Secure/); // desenvolvimento local em http
    const sessao = SessaoSchema.parse(resposta.json());
    expect(sessao.user.login).toBe('maria');
    expect(sessao.activeScope?.id).toBe(ID_ESCOPO_PRACA);
    expect(sessao.role).toBe('CONSULTA');
    expect(sessao.scopes.map((e) => e.id)).toEqual([ID_ESCOPO_PRACA, ID_ESCOPO_NAVEGACAO]);
    expect(resposta.body).not.toMatch(/argon2|senha_hash|senhaHash/);
    // No banco fica só o hash do identificador, nunca o valor do cookie.
    const token = cookieDe(resposta).split('=')[1] ?? '';
    const registros = await db.sessao.findMany();
    expect(registros).toHaveLength(1);
    expect(registros[0]?.tokenHash).not.toBe(token);
    expect(registros[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('não revela se a conta existe: senha errada e login inexistente respondem igual', async () => {
    const senhaErrada = await login({ login: 'maria', senha: 'senha-errada-123' });
    const inexistente = await login({ login: 'ninguem', senha: 'senha-errada-123' });
    expect(senhaErrada.statusCode).toBe(401);
    expect(inexistente.statusCode).toBe(401);
    expect(ErroApiSchema.parse(senhaErrada.json()).error).toEqual(ErroApiSchema.parse(inexistente.json()).error);
    expect(senhaErrada.headers['set-cookie']).toBeUndefined();
    const eventos = await db.eventoAuditoria.findMany({ where: { acao: 'LOGIN_FALHA' } });
    expect(eventos).toHaveLength(2);
    expect(JSON.stringify(eventos)).not.toContain('senha-errada-123');
  });

  it('renova o identificador a cada login e revoga o anterior do mesmo navegador', async () => {
    const primeira = await entrar(app, maria);
    const segunda = await app.inject({
      method: 'POST',
      url: '/api/v1/sessao',
      payload: { login: maria.login, senha: maria.senha },
      headers: { cookie: primeira.cookie },
    });
    expect(cookieDe(segunda)).not.toBe(primeira.cookie);
    const antiga = await como(app, primeira, { method: 'GET', url: '/api/v1/sessao' });
    expect(antiga.statusCode).toBe(401);
  });

  it('limita tentativas por conta e libera depois da janela', async () => {
    for (let i = 0; i < 5; i++) expect((await login({ login: 'maria', senha: `errada-${String(i)}-xxxxx` })).statusCode).toBe(401);
    const bloqueada = await login({ login: 'maria', senha: maria.senha });
    expect(bloqueada.statusCode).toBe(429);
    expect(ErroApiSchema.parse(bloqueada.json()).error.code).toBe('MUITAS_TENTATIVAS');
    expect(Number(bloqueada.headers['retry-after'])).toBeGreaterThan(0);
    expect(await db.eventoAuditoria.count({ where: { acao: 'LOGIN_BLOQUEADO' } })).toBe(1);
    relogio.avancar(15 * 60_000 + 1_000);
    expect((await login({ login: 'maria', senha: maria.senha })).statusCode).toBe(200);
  });

  it('conta desativada não entra, com a mesma resposta genérica', async () => {
    await db.usuario.update({ where: { id: maria.id }, data: { ativo: false } });
    const resposta = await login({ login: 'maria', senha: maria.senha });
    expect(resposta.statusCode).toBe(401);
    expect(ErroApiSchema.parse(resposta.json()).error.code).toBe('CREDENCIAIS_INVALIDAS');
  });

  it('aceita somente JSON e recusa outra origem', async () => {
    const formulario = await app.inject({
      method: 'POST',
      url: '/api/v1/sessao',
      payload: `login=maria&senha=${maria.senha}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(formulario.statusCode).toBe(415);
    const texto = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: 'x', headers: { 'content-type': 'text/plain' } });
    expect(texto.statusCode).toBe(415);
    const outraOrigem = await login({ login: 'maria', senha: maria.senha }, { origin: 'https://exemplo-malicioso.test' });
    expect(outraOrigem.statusCode).toBe(403);
    expect(ErroApiSchema.parse(outraOrigem.json()).error.code).toBe('ORIGEM_INVALIDA');
    const crossSite = await login({ login: 'maria', senha: maria.senha }, { 'sec-fetch-site': 'cross-site' });
    expect(crossSite.statusCode).toBe(403);
  });
});

describe('sessão atual, expiração e logout', () => {
  it('sem cookie: 401 NAO_AUTENTICADO', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/v1/sessao' });
    expect(resposta.statusCode).toBe(401);
    expect(ErroApiSchema.parse(resposta.json()).error.code).toBe('NAO_AUTENTICADO');
  });

  it('expira por inatividade', async () => {
    const sessao = await entrar(app, maria);
    relogio.avancar(119 * 60_000);
    expect((await como(app, sessao, { method: 'GET', url: '/api/v1/sessao' })).statusCode).toBe(200);
    relogio.avancar(121 * 60_000);
    const expirada = await como(app, sessao, { method: 'GET', url: '/api/v1/sessao' });
    expect(expirada.statusCode).toBe(401);
    expect(ErroApiSchema.parse(expirada.json()).error.code).toBe('SESSAO_EXPIRADA');
    expect(String(expirada.headers['set-cookie'])).toMatch(/pr_sessao=;/);
  });

  it('expira pela duração máxima mesmo com uso contínuo', async () => {
    const sessao = await entrar(app, maria);
    for (let h = 0; h < 11; h++) {
      relogio.avancar(60 * 60_000);
      expect((await como(app, sessao, { method: 'GET', url: '/api/v1/sessao' })).statusCode).toBe(200);
    }
    relogio.avancar(61 * 60_000);
    expect((await como(app, sessao, { method: 'GET', url: '/api/v1/sessao' })).statusCode).toBe(401);
  });

  it('logout exige token anti-CSRF, revoga no servidor e rejeita a sessão revogada', async () => {
    const sessao = await entrar(app, maria);
    const semToken = await como(app, sessao, { method: 'DELETE', url: '/api/v1/sessao', semCsrf: true });
    expect(semToken.statusCode).toBe(403);
    expect(ErroApiSchema.parse(semToken.json()).error.code).toBe('CSRF_INVALIDO');
    const tokenErrado = await app.inject({
      method: 'DELETE',
      url: '/api/v1/sessao',
      headers: { cookie: sessao.cookie, 'x-csrf-token': 'x'.repeat(43) },
    });
    expect(tokenErrado.statusCode).toBe(403);

    const saida = await como(app, sessao, { method: 'DELETE', url: '/api/v1/sessao' });
    expect(saida.statusCode).toBe(204);
    expect(String(saida.headers['set-cookie'])).toMatch(/pr_sessao=;/);
    const registro = await db.sessao.findFirstOrThrow();
    expect(registro.revogadaEm).not.toBeNull();
    expect(registro.motivoRevogacao).toBe('LOGOUT');

    const reutilizada = await como(app, sessao, { method: 'GET', url: '/api/v1/praca' });
    expect(reutilizada.statusCode).toBe(401);
    expect(ErroApiSchema.parse(reutilizada.json()).error.code).toBe('SESSAO_EXPIRADA');
  });

  it('conta desativada perde a sessão aberta', async () => {
    const sessao = await entrar(app, maria);
    await db.usuario.update({ where: { id: maria.id }, data: { ativo: false } });
    expect((await como(app, sessao, { method: 'GET', url: '/api/v1/praca' })).statusCode).toBe(401);
  });

  it('troca para escopo com vínculo e recusa escopo sem vínculo', async () => {
    const sessao = await entrar(app, maria);
    const troca = await como(app, sessao, { method: 'PUT', url: '/api/v1/sessao/escopo', payload: { scopeId: ID_ESCOPO_NAVEGACAO } });
    expect(troca.statusCode).toBe(200);
    expect(SessaoSchema.parse(troca.json()).role).toBe('OPERADOR');

    const joao = await criarUsuario(db, 'joao', [[ID_ESCOPO_NAVEGACAO, 'CONSULTA']]);
    const sessaoJoao = await entrar(app, joao);
    const negada = await como(app, sessaoJoao, { method: 'PUT', url: '/api/v1/sessao/escopo', payload: { scopeId: ID_ESCOPO_PRACA } });
    expect(negada.statusCode).toBe(403);
    const evento = await db.eventoAuditoria.findFirstOrThrow({ where: { acao: 'ESCOPO_ALTERADO', resultado: 'NEGADO' } });
    expect(evento.escopoId).toBe(ID_ESCOPO_PRACA);
    expect(evento.atorUsuarioId).toBe(joao.id);
  });

  it('registra login e logout na auditoria sem dados secretos', async () => {
    const sessao = await entrar(app, maria);
    await como(app, sessao, { method: 'DELETE', url: '/api/v1/sessao' });
    const eventos = await db.eventoAuditoria.findMany({ where: { atorUsuarioId: maria.id }, orderBy: { ocorridoEm: 'asc' } });
    expect(eventos.map((e) => e.acao)).toEqual(['LOGIN_SUCESSO', 'LOGOUT']);
    const texto = JSON.stringify(eventos);
    expect(texto).not.toContain(maria.senha);
    expect(texto).not.toContain(sessao.cookie.split('=')[1] ?? '###');
    expect(texto).not.toContain(sessao.csrf);
  });
});
