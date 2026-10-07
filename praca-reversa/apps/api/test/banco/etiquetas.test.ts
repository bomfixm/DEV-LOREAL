import { LoteEtiquetasSchema, PaleteDetalheSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import type { Banco } from '../../src/db/cliente.js';
import {
  CONFIG_TESTE,
  ID_ESCOPO_NAVEGACAO,
  ID_ESCOPO_PRACA,
  appDeTeste,
  bancoDeTeste,
  como,
  criarUsuario,
  entrar,
  mutar,
  prepararDados,
  type SessaoTeste,
  type UsuarioTeste,
} from './apoio.js';

const PAL = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let db: Banco;
let app: FastifyInstance;
let operador: UsuarioTeste;
let sOperador: SessaoTeste;
let sConsulta: SessaoTeste;
let sNavOperador: SessaoTeste;
let sSupervisor: SessaoTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  operador = await criarUsuario(db, 'operador', [[ID_ESCOPO_PRACA, 'OPERADOR']]);
  const outros = await Promise.all([
    criarUsuario(db, 'consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]),
    criarUsuario(db, 'nav.operador', [[ID_ESCOPO_NAVEGACAO, 'OPERADOR']]),
    criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
  ]);
  [sOperador, sConsulta, sNavOperador, sSupervisor] = await Promise.all([
    entrar(app, operador),
    entrar(app, outros[0]),
    entrar(app, outros[1]),
    entrar(app, outros[2]),
  ]);
});

afterAll(async () => {
  await db.$disconnect();
});

const etiquetas = (sessao: SessaoTeste, ids: string, aplicacao = app) =>
  como(aplicacao, sessao, { method: 'GET', url: `/api/v1/etiquetas?ids=${ids}` });

describe('etiquetas internas', () => {
  it('link pelo ID permanente com a URL base do ambiente; nenhum conteúdo do palete', async () => {
    const resposta = await etiquetas(sOperador, `${PAL(1)},${PAL(4)},${PAL(1)}`);
    expect(resposta.statusCode).toBe(200);
    const lote = LoteEtiquetasSchema.parse(resposta.json());
    expect(lote).toMatchObject({ environment: 'teste', baseUrl: 'http://praca.teste.invalid:8080', localAddress: false, scope: { demo: true } });
    expect(lote.labels).toEqual([
      { palletId: PAL(1), code: 'PAL-DEMO-001', url: `http://praca.teste.invalid:8080/paletes/${PAL(1)}`, positionCode: 'F01-P01', positionProvisional: true },
      { palletId: PAL(4), code: 'PAL-DEMO-004', url: `http://praca.teste.invalid:8080/paletes/${PAL(4)}`, positionCode: 'F02-P01', positionProvisional: true },
    ]);
    // Sem produto, quantidade, lote ou documento.
    const texto = resposta.body;
    for (const proibido of ['DEMO-101', 'sku', 'quantity', 'lot', 'returnReference', 'senha']) expect(texto).not.toContain(proibido);
    const evento = await db.eventoAuditoria.findFirstOrThrow({ where: { acao: 'ETIQUETA_EMITIDA' } });
    expect(evento.detalhes).toMatchObject({ quantidade: 2, codigos: 'PAL-DEMO-001, PAL-DEMO-004' });
  });

  it('palete sem posição: etiqueta sem endereço; a identidade não depende da posição', async () => {
    const criado = PaleteDetalheSchema.parse((await mutar(app, sOperador, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: null })).json());
    const lote = LoteEtiquetasSchema.parse((await etiquetas(sOperador, criado.id)).json());
    expect(lote.labels[0]).toMatchObject({ code: 'PAL-DEMO-007', positionCode: null, positionProvisional: null });
    expect(lote.labels[0]?.url.endsWith(`/paletes/${criado.id}`)).toBe(true);
  });

  it('nega sem permissão, de outro escopo e de palete arquivado; limita o lote', async () => {
    expect((await etiquetas(sConsulta, PAL(1))).statusCode).toBe(403);
    expect((await etiquetas(sNavOperador, PAL(1))).statusCode).toBe(404);
    expect(await db.eventoAuditoria.count({ where: { acao: 'ACESSO_NEGADO', escopoId: ID_ESCOPO_PRACA, alvoId: PAL(1) } })).toBe(1);
    expect((await etiquetas(sOperador, `${PAL(1)},${PAL(7)}`)).statusCode).toBe(404);
    expect((await etiquetas(sOperador, 'nao-e-uuid')).statusCode).toBe(400);
    const muitos = Array.from({ length: 51 }, (_, i) => PAL(1000 + i)).join(',');
    expect((await etiquetas(sOperador, muitos)).statusCode).toBe(400);

    const criado = PaleteDetalheSchema.parse((await mutar(app, sOperador, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: null })).json());
    expect((await mutar(app, sSupervisor, 'POST', `/api/v1/paletes/${criado.id}/arquivar`, { expectedVersion: 1, reason: 'Teste de arquivo' })).statusCode).toBe(200);
    expect((await etiquetas(sOperador, criado.id)).statusCode).toBe(409);
    expect(await db.eventoAuditoria.count({ where: { acao: 'ETIQUETA_EMITIDA' } })).toBe(0);
  });

  it('endereço local é sinalizado: não serve para outro aparelho', async () => {
    const local = await criarApp({ db, config: { ...CONFIG_TESTE, urlPublica: 'http://127.0.0.1:3000' }, interfaceDir: null });
    try {
      const sessao = await entrar(local, operador);
      const lote = LoteEtiquetasSchema.parse((await etiquetas(sessao, PAL(2), local)).json());
      expect(lote.localAddress).toBe(true);
      expect(lote.labels[0]?.url).toBe(`http://127.0.0.1:3000/paletes/${PAL(2)}`);
    } finally {
      await local.close();
    }
  });
});
