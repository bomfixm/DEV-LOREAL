import {
  ErroApiSchema,
  ListaPaletesSchema,
  PaleteDetalheSchema,
  PracaSchema,
  SessaoSchema,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
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

const PAL = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let db: Banco;
let app: FastifyInstance;
let consulta: UsuarioTeste;
let soNavegacao: UsuarioTeste;
let admin: UsuarioTeste;
let sConsulta: SessaoTeste;
let sNavegacao: SessaoTeste;
let sAdmin: SessaoTeste;

beforeAll(async () => {
  db = bancoDeTeste();
  await prepararDados(db);
  app = await appDeTeste(db);
  consulta = await criarUsuario(db, 'consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]);
  soNavegacao = await criarUsuario(db, 'navegacao', [[ID_ESCOPO_NAVEGACAO, 'CONSULTA']]);
  admin = await criarUsuario(db, 'admin', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]);
  [sConsulta, sNavegacao, sAdmin] = await Promise.all([entrar(app, consulta), entrar(app, soNavegacao), entrar(app, admin)]);
});

afterAll(async () => {
  await db.$disconnect();
});

const codigo = (r: { json: () => unknown }) => ErroApiSchema.parse(r.json()).error.code;

describe('acesso sem sessão', () => {
  it.each([
    ['GET', '/api/v1/praca'],
    ['GET', '/api/v1/paletes'],
    ['GET', `/api/v1/paletes/${PAL(1)}`],
    ['GET', '/api/v1/admin/usuarios'],
    ['GET', '/api/v1/admin/auditoria'],
    ['POST', '/api/v1/admin/usuarios'],
  ] as const)('%s %s responde 401 sem dados', async (method, url) => {
    const resposta = await app.inject({ method, url, ...(method === 'POST' ? { payload: {} } : {}) });
    expect(resposta.statusCode).toBe(401);
    expect(codigo(resposta)).toBe('NAO_AUTENTICADO');
    expect(resposta.body).not.toContain('PAL-DEMO');
  });

  it('as rotas públicas de demonstração da etapa 01 não existem mais', async () => {
    for (const url of ['/api/v1/demo/praca', `/api/v1/demo/paletes/${PAL(1)}`]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });
});

describe('permissões por perfil', () => {
  it('perfil consulta lê a praça mas não administra acesso nem auditoria', async () => {
    expect((await como(app, sConsulta, { method: 'GET', url: '/api/v1/praca' })).statusCode).toBe(200);
    const usuarios = await como(app, sConsulta, { method: 'GET', url: '/api/v1/admin/usuarios' });
    expect(usuarios.statusCode).toBe(403);
    expect(codigo(usuarios)).toBe('ACESSO_NEGADO');
    expect((await como(app, sConsulta, { method: 'GET', url: '/api/v1/admin/auditoria' })).statusCode).toBe(403);
    const criar = await como(app, sConsulta, {
      method: 'POST',
      url: '/api/v1/admin/usuarios',
      headers: { 'idempotency-key': chave() },
      payload: { login: 'intruso', name: 'Intruso', initialPassword: 'x'.repeat(16), role: 'ADMINISTRADOR' },
    });
    expect(criar.statusCode).toBe(403);
    expect(await db.usuario.findUnique({ where: { login: 'intruso' } })).toBeNull();
    const negado = await db.eventoAuditoria.findFirstOrThrow({ where: { acao: 'ACESSO_NEGADO', atorUsuarioId: consulta.id } });
    expect(negado.escopoId).toBe(ID_ESCOPO_PRACA);
  });

  it('administrador técnico não recebe aprovação financeira', async () => {
    const sessao = SessaoSchema.parse((await como(app, sAdmin, { method: 'GET', url: '/api/v1/sessao' })).json());
    expect(sessao.permissions).toContain('acesso.administrar');
    expect(sessao.permissions).not.toContain('claim.aprovar_financeiro');
  });

  it('mudança de perfil vale para a sessão já aberta', async () => {
    const operador = await criarUsuario(db, 'promovido', [[ID_ESCOPO_PRACA, 'CONSULTA']]);
    const sessao = await entrar(app, operador);
    expect((await como(app, sessao, { method: 'GET', url: '/api/v1/admin/usuarios' })).statusCode).toBe(403);
    await db.vinculo.updateMany({ where: { usuarioId: operador.id }, data: { perfil: 'ADMINISTRADOR' } });
    expect((await como(app, sessao, { method: 'GET', url: '/api/v1/admin/usuarios' })).statusCode).toBe(200);
    await db.vinculo.updateMany({ where: { usuarioId: operador.id }, data: { ativo: false } });
    const semEscopo = await como(app, sessao, { method: 'GET', url: '/api/v1/praca' });
    expect(semEscopo.statusCode).toBe(403);
    expect(codigo(semEscopo)).toBe('SEM_ESCOPO');
  });
});

describe('isolamento entre escopos', () => {
  it('cada sessão vê somente a praça do seu escopo ativo', async () => {
    const informada = PracaSchema.parse((await como(app, sConsulta, { method: 'GET', url: '/api/v1/praca' })).json());
    const navegacao = PracaSchema.parse((await como(app, sNavegacao, { method: 'GET', url: '/api/v1/praca' })).json());
    expect(informada.scope.id).toBe(ID_ESCOPO_PRACA);
    expect(informada.pallets.map((p) => p.code)).toEqual(['PAL-DEMO-001', 'PAL-DEMO-002', 'PAL-DEMO-003', 'PAL-DEMO-004', 'PAL-DEMO-005', 'PAL-DEMO-006']);
    expect(navegacao.scope.id).toBe(ID_ESCOPO_NAVEGACAO);
    expect(navegacao.pallets).toHaveLength(337);
    expect(navegacao.pallets.some((p) => p.code === 'PAL-DEMO-001')).toBe(false);
  });

  it('palete de outro escopo responde como inexistente e a tentativa fica auditada no escopo dono', async () => {
    const deOutroEscopo = await como(app, sNavegacao, { method: 'GET', url: `/api/v1/paletes/${PAL(1)}` });
    const inexistente = await como(app, sNavegacao, { method: 'GET', url: `/api/v1/paletes/${PAL(999_999)}` });
    expect(deOutroEscopo.statusCode).toBe(404);
    expect(inexistente.statusCode).toBe(404);
    expect(ErroApiSchema.parse(deOutroEscopo.json()).error).toEqual(ErroApiSchema.parse(inexistente.json()).error);
    expect(deOutroEscopo.body).not.toContain('PAL-DEMO-001');
    const evento = await db.eventoAuditoria.findFirstOrThrow({ where: { alvoId: PAL(1), acao: 'ACESSO_NEGADO' } });
    expect(evento.escopoId).toBe(ID_ESCOPO_PRACA);
  });

  it('o filtro do servidor não devolve paletes de outro escopo', async () => {
    const lista = ListaPaletesSchema.parse(
      (await como(app, sNavegacao, { method: 'GET', url: '/api/v1/paletes?texto=PAL-DEMO-00&limite=500' })).json(),
    );
    expect(lista.items.map((p) => p.code)).toEqual(['PAL-DEMO-007', 'PAL-DEMO-008', 'PAL-DEMO-009']);
  });

  it('administrador de um escopo não lista usuários de outro escopo', async () => {
    const lista = (await como(app, sAdmin, { method: 'GET', url: '/api/v1/admin/usuarios' })).json<{ items: { login: string }[] }>();
    const logins = lista.items.map((u) => u.login);
    expect(logins).toContain('consulta');
    expect(logins).not.toContain('navegacao');
  });
});

describe('praça e paletes (somente leitura)', () => {
  it('layout do esquema informado com capacidade total desconhecida e sem conteúdo no resumo', async () => {
    const praca = PracaSchema.parse((await como(app, sConsulta, { method: 'GET', url: '/api/v1/praca' })).json());
    expect(praca.scope.demo).toBe(true);
    expect(praca.layout?.totalCapacity).toBeNull();
    expect(praca.layout?.positions).toHaveLength(494);
    expect(praca.layout?.positions.filter((p) => !p.deactivated)).toHaveLength(194);
    expect(praca.layout?.rows.filter((r) => r.code.startsWith('F')).map((r) => r.code)).toEqual(['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12']);
    expect(praca.layout?.positions.every((p) => !p.occupancySurveyed && p.provisionalCode)).toBe(true);
    expect(praca.pallets.find((p) => p.code === 'PAL-DEMO-004')?.positionCode).toBe('F02-P01');
    expect(JSON.stringify(praca.pallets)).not.toMatch(/currentItems|observations|declaredItems|DEMO-101/);
  });

  it('detalhe mantém desconhecido, parcial e declarado × observado separados', async () => {
    const detalhe = async (n: number) =>
      PaleteDetalheSchema.parse((await como(app, sConsulta, { method: 'GET', url: `/api/v1/paletes/${PAL(n)}` })).json());
    const reconciliado = await detalhe(1);
    expect(reconciliado.currentItems?.map((i) => i.quantity)).toEqual(['24', '12']);
    expect(reconciliado.dataSource).toBe('DEMONSTRACAO_FICTICIA');
    const desconhecido = await detalhe(2);
    expect([desconhecido.currentItems, desconhecido.observedCounts, desconhecido.declaredItems]).toEqual([null, [], null]);
    const aguardando = await detalhe(3);
    expect(aguardando.currentItems).toBeNull();
    expect(aguardando.observedCounts.map((c) => [c.session.scope, c.items[0]?.quantity])).toEqual([['COMPLETA', '9']]);
    expect(aguardando.declaredItems?.[0]?.quantity).toBe('12');
    const parcial = await detalhe(5);
    expect(parcial.currentItems).toBeNull();
    expect(parcial.observedCounts[0]?.session.scope).toBe('PARCIAL');
    expect(parcial.observedCounts[0]?.items[0]).toMatchObject({ quantity: '6', lot: null, originType: null, originReference: null });
  });

  it('preserva SKU, lote e código de barras como texto com zeros à esquerda', async () => {
    await db.itemDeclarado.create({
      data: {
        escopoId: ID_ESCOPO_PRACA,
        paleteId: PAL(2),
        ordem: 0,
        sku: '000123',
        descricao: 'Item com zeros',
        lote: '0042',
        origemTipo: 'NOTA_FISCAL',
        origemReferencia: '00099',
        quantidade: '1.250',
        unidadeMedida: 'KG',
        condicao: 'EM_AVALIACAO',
      },
    });
    const detalhe = PaleteDetalheSchema.parse((await como(app, sConsulta, { method: 'GET', url: `/api/v1/paletes/${PAL(2)}` })).json());
    expect(detalhe.declaredItems?.[0]).toMatchObject({ sku: '000123', lot: '0042', originType: 'NOTA_FISCAL', originReference: '00099', quantity: '1.25' });
    // Declaração documental não vira saldo nem observação.
    expect(detalhe.currentItems).toBeNull();
    expect(detalhe.observedCounts).toEqual([]);
    await db.itemDeclarado.deleteMany({ where: { paleteId: PAL(2) } });
  });

  it('filtro do servidor ignora separadores, filtra por situação e respeita limite', async () => {
    const consultar = async (query: string) => como(app, sConsulta, { method: 'GET', url: `/api/v1/paletes?${query}` });
    const porPosicao = ListaPaletesSchema.parse((await consultar('texto=f02p0')).json());
    expect(porPosicao.items.map((p) => p.positionCode)).toEqual(['F02-P01', 'F02-P02', 'F02-P03']);
    const naoConferidos = ListaPaletesSchema.parse((await consultar('conferencia=NAO_CONFERIDO')).json());
    expect(naoConferidos.items.map((p) => p.code)).toEqual(['PAL-DEMO-002']);
    const limitado = ListaPaletesSchema.parse((await consultar('limite=2')).json());
    expect(limitado).toMatchObject({ total: 6, limit: 2, truncated: true });
    expect(limitado.items).toHaveLength(2);
    for (const invalido of ['limite=0', 'limite=501', `texto=${'x'.repeat(65)}`, 'conferencia=QUALQUER']) {
      expect((await consultar(invalido)).statusCode, invalido).toBe(400);
    }
    const injecao = ListaPaletesSchema.parse((await consultar(`texto=${encodeURIComponent("' OR 1=1 --")}`)).json());
    expect(injecao.items).toHaveLength(0);
  });

  it('consultar a praça e os paletes não altera nenhum registro', async () => {
    const instantaneo = async () =>
      JSON.stringify(
        await db.palete.findMany({ orderBy: { id: 'asc' }, select: { id: true, posicaoId: true, versao: true, atualizadoEm: true } }),
      );
    const antes = await instantaneo();
    for (const url of ['/api/v1/praca', '/api/v1/paletes?texto=PAL', `/api/v1/paletes/${PAL(1)}`]) {
      await como(app, sConsulta, { method: 'GET', url });
    }
    expect(await instantaneo()).toBe(antes);
  });

  it('identificador inválido responde 400', async () => {
    const resposta = await como(app, sConsulta, { method: 'GET', url: '/api/v1/paletes/PAL-DEMO-001' });
    expect(resposta.statusCode).toBe(400);
  });
});
