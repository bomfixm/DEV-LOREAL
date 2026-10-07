import { createHash } from 'node:crypto';
import { ErroApiSchema, ListaAuditoriaSchema, UsuarioAdminSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { executarIdempotente, jsonCanonico } from '../../src/modules/idempotencia/executar.js';
import {
  ID_ESCOPO_NAVEGACAO,
  ID_ESCOPO_PRACA,
  appDeTeste,
  bancoDeTeste,
  chave,
  como,
  criarUsuario,
  entrar,
  prepararDados,
  type SessaoTeste,
  type UsuarioTeste,
} from './apoio.js';

let db: Banco;
let app: FastifyInstance;
let admin: UsuarioTeste;
let sAdmin: SessaoTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  admin = await criarUsuario(db, 'admin', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]);
  sAdmin = await entrar(app, admin);
});

afterAll(async () => {
  await db.$disconnect();
});

const SENHA_INICIAL = 'senha-inicial-do-teste-42';
const novoUsuario = (login = 'carla') => ({ login, name: 'Carla Teste', initialPassword: SENHA_INICIAL, role: 'CONSULTA' });

function criar(corpo: object, chaveIdem: string | null, sessao = sAdmin) {
  return como(app, sessao, {
    method: 'POST',
    url: '/api/v1/admin/usuarios',
    payload: corpo,
    headers: chaveIdem === null ? {} : { 'idempotency-key': chaveIdem },
  });
}

describe('idempotência na criação de usuário', () => {
  it('repetir o mesmo pedido não duplica a alteração e devolve o resultado original', async () => {
    const k = chave();
    const primeira = await criar(novoUsuario(), k);
    const segunda = await criar(novoUsuario(), k);
    expect(primeira.statusCode).toBe(201);
    expect(segunda.statusCode).toBe(201);
    expect(segunda.headers['idempotency-replayed']).toBe('true');
    expect(segunda.json()).toEqual(primeira.json());
    expect(UsuarioAdminSchema.parse(primeira.json())).toMatchObject({ login: 'carla', role: 'CONSULTA', accountActive: true });
    expect(await db.usuario.count({ where: { login: 'carla' } })).toBe(1);
    expect(await db.eventoAuditoria.count({ where: { acao: 'USUARIO_CRIADO' } })).toBe(1);
    expect(await db.registroIdempotencia.count()).toBe(1);
  });

  it('pedidos concorrentes com a mesma chave produzem uma única alteração', async () => {
    const k = chave();
    const respostas = await Promise.all(Array.from({ length: 6 }, () => criar(novoUsuario(), k)));
    expect(respostas.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
    const ids = new Set(respostas.map((r) => UsuarioAdminSchema.parse(r.json()).id));
    expect(ids.size).toBe(1);
    expect(await db.usuario.count({ where: { login: 'carla' } })).toBe(1);
    expect(await db.vinculo.count({ where: { usuario: { login: 'carla' } } })).toBe(1);
    expect(await db.eventoAuditoria.count({ where: { acao: 'USUARIO_CRIADO' } })).toBe(1);
    expect(respostas.filter((r) => r.headers['idempotency-replayed'] === 'true')).toHaveLength(5);
  });

  it('a mesma chave com outro pedido é rejeitada sem alteração', async () => {
    const k = chave();
    expect((await criar(novoUsuario('carla'), k)).statusCode).toBe(201);
    const outro = await criar(novoUsuario('daniel'), k);
    expect(outro.statusCode).toBe(422);
    expect(ErroApiSchema.parse(outro.json()).error.code).toBe('IDEMPOTENCIA_CONFLITO');
    expect(await db.usuario.findUnique({ where: { login: 'daniel' } })).toBeNull();
  });

  it('pedidos concorrentes com a mesma chave e corpos diferentes: um vence, o outro é rejeitado', async () => {
    const k = chave();
    const [a, b] = await Promise.all([criar(novoUsuario('carla'), k), criar(novoUsuario('daniel'), k)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 422]);
    expect(await db.usuario.count({ where: { login: { in: ['carla', 'daniel'] } } })).toBe(1);
  });

  it('exige a chave e não grava resultado parcial quando a operação falha', async () => {
    const semChave = await criar(novoUsuario(), null);
    expect(semChave.statusCode).toBe(400);
    expect(ErroApiSchema.parse(semChave.json()).error.code).toBe('IDEMPOTENCIA_AUSENTE');

    expect((await criar(novoUsuario('carla'), chave())).statusCode).toBe(201);
    const duplicado = await criar(novoUsuario('carla'), chave());
    expect(duplicado.statusCode).toBe(409);
    expect(await db.registroIdempotencia.count()).toBe(1);
    expect(await db.eventoAuditoria.count({ where: { acao: 'USUARIO_CRIADO' } })).toBe(1);
  });

  it('não guarda a senha nem um hash simples do pedido', async () => {
    await criar(novoUsuario(), chave());
    const registro = await db.registroIdempotencia.findFirstOrThrow();
    const texto = JSON.stringify(await db.registroIdempotencia.findMany()) + JSON.stringify(await db.eventoAuditoria.findMany());
    expect(texto).not.toContain(SENHA_INICIAL);
    const hashSimples = createHash('sha256').update(jsonCanonico({ corpo: novoUsuario() })).digest('hex');
    expect(registro.payloadHash).not.toBe(hashSimples);
    expect(texto).not.toContain('argon2');
  });

  it('o usuário criado entra com a senha inicial e vê somente o escopo do administrador', async () => {
    await criar(novoUsuario(), chave());
    const sessao = await entrar(app, { login: 'carla', senha: SENHA_INICIAL });
    expect(sessao.corpo.scopes.map((e) => e.id)).toEqual([ID_ESCOPO_PRACA]);
    expect(sessao.corpo.role).toBe('CONSULTA');
  });
});

describe('idempotência sob concorrência real no PostgreSQL', () => {
  it('a segunda transação espera o índice único e devolve o resultado da primeira', async () => {
    let execucoes = 0;
    const pedido = { escopoId: ID_ESCOPO_PRACA, usuarioId: admin.id, operacao: 'teste.lento', chave: chave(), payload: { x: 1 } };
    const mutacao = async (tx: Parameters<Parameters<Banco['$transaction']>[0]>[0]) => {
      execucoes++;
      await tx.$executeRaw`SELECT pg_sleep(0.4)`;
      return { status: 200, corpo: { execucao: execucoes } };
    };
    const inicio = Date.now();
    const [a, b] = await Promise.all([
      executarIdempotente(db, 'segredo-de-teste-com-mais-de-32-caracteres', pedido, mutacao),
      executarIdempotente(db, 'segredo-de-teste-com-mais-de-32-caracteres', pedido, mutacao),
    ]);
    expect(execucoes).toBe(1);
    expect(a.corpo).toEqual(b.corpo);
    expect([a.repetido, b.repetido].sort()).toEqual([false, true]);
    // As duas chamadas começaram antes de a primeira terminar (sobreposição real).
    expect(Date.now() - inicio).toBeLessThan(800);
  });
});

describe('vínculos e contas', () => {
  it('altera perfil com idempotência e aplica na sessão aberta do usuário', async () => {
    const carla = await criarUsuario(db, 'carla', [[ID_ESCOPO_PRACA, 'CONSULTA']]);
    const sCarla = await entrar(app, carla);
    const k = chave();
    const pedido = { method: 'PUT' as const, url: `/api/v1/admin/usuarios/${carla.id}/vinculo`, payload: { role: 'ADMINISTRADOR', active: true }, headers: { 'idempotency-key': k } };
    expect((await como(app, sAdmin, pedido)).statusCode).toBe(200);
    expect((await como(app, sAdmin, pedido)).headers['idempotency-replayed']).toBe('true');
    expect(await db.eventoAuditoria.count({ where: { acao: 'VINCULO_ALTERADO' } })).toBe(1);
    expect((await como(app, sCarla, { method: 'GET', url: '/api/v1/admin/usuarios' })).statusCode).toBe(200);
  });

  it('impede remover o próprio acesso administrativo e o último administrador', async () => {
    const proprio = await como(app, sAdmin, {
      method: 'PUT',
      url: `/api/v1/admin/usuarios/${admin.id}/vinculo`,
      payload: { role: 'CONSULTA', active: true },
      headers: { 'idempotency-key': chave() },
    });
    expect(proprio.statusCode).toBe(409);
    expect(await db.vinculo.count({ where: { usuarioId: admin.id, perfil: 'ADMINISTRADOR' } })).toBe(1);
  });

  it('desativar conta revoga as sessões abertas e bloqueia o login', async () => {
    const carla = await criarUsuario(db, 'carla', [[ID_ESCOPO_PRACA, 'CONSULTA']]);
    const sCarla = await entrar(app, carla);
    const resposta = await como(app, sAdmin, {
      method: 'PATCH',
      url: `/api/v1/admin/usuarios/${carla.id}/conta`,
      payload: { active: false },
      headers: { 'idempotency-key': chave() },
    });
    expect(resposta.statusCode).toBe(200);
    expect(UsuarioAdminSchema.parse(resposta.json()).accountActive).toBe(false);
    expect((await como(app, sCarla, { method: 'GET', url: '/api/v1/praca' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { login: 'carla', senha: carla.senha } });
    expect(login.statusCode).toBe(401);
    expect(await db.sessao.count({ where: { usuarioId: carla.id, revogadaEm: null } })).toBe(0);
    const evento = await db.eventoAuditoria.findFirstOrThrow({ where: { acao: 'CONTA_DESATIVADA' } });
    expect(evento.detalhes).toEqual({ sessoesRevogadas: 1 });
  });

  it('não altera conta com acesso a escopo que o administrador não administra', async () => {
    const compartilhado = await criarUsuario(db, 'compartilhado', [
      [ID_ESCOPO_PRACA, 'CONSULTA'],
      [ID_ESCOPO_NAVEGACAO, 'CONSULTA'],
    ]);
    const resposta = await como(app, sAdmin, {
      method: 'PATCH',
      url: `/api/v1/admin/usuarios/${compartilhado.id}/conta`,
      payload: { active: false },
      headers: { 'idempotency-key': chave() },
    });
    expect(resposta.statusCode).toBe(403);
    expect((await db.usuario.findUniqueOrThrow({ where: { id: compartilhado.id } })).ativo).toBe(true);
  });

  it('usuário de outro escopo é tratado como inexistente', async () => {
    const outro = await criarUsuario(db, 'outro', [[ID_ESCOPO_NAVEGACAO, 'CONSULTA']]);
    const resposta = await como(app, sAdmin, {
      method: 'PUT',
      url: `/api/v1/admin/usuarios/${outro.id}/vinculo`,
      payload: { role: 'ADMINISTRADOR', active: true },
      headers: { 'idempotency-key': chave() },
    });
    expect(resposta.statusCode).toBe(404);
    expect(await db.vinculo.count({ where: { usuarioId: outro.id, escopoId: ID_ESCOPO_PRACA } })).toBe(0);
  });
});

describe('auditoria', () => {
  it('lista apenas eventos do escopo ativo, mais recentes primeiro, sem segredos', async () => {
    await criar(novoUsuario(), chave());
    const lista = ListaAuditoriaSchema.parse((await como(app, sAdmin, { method: 'GET', url: '/api/v1/admin/auditoria?limite=50' })).json());
    expect(lista.items[0]?.action).toBe('USUARIO_CRIADO');
    expect(lista.items.some((e) => e.action === 'LOGIN_SUCESSO')).toBe(true);
    expect(lista.items.some((e) => e.action === 'SEED_DEMONSTRACAO')).toBe(true);
    const doOutroEscopo = await db.eventoAuditoria.count({ where: { escopoId: ID_ESCOPO_NAVEGACAO } });
    expect(doOutroEscopo).toBeGreaterThan(0);
    expect(lista.items).toHaveLength(await db.eventoAuditoria.count({ where: { escopoId: ID_ESCOPO_PRACA } }));
    expect(JSON.stringify(lista)).not.toContain(SENHA_INICIAL);
  });
});
