import { CorrespondenciaEnderecosSchema, PracaSchema, ResultadoLayoutSchema, normalizarEndereco } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { semearDemonstracao } from '../../src/demo/semear.js';
import { resolverEnderecos } from '../../src/modules/layout/enderecos.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, codigoErro, como, criarUsuario, entrar, idPosicao, mutar, prepararDados, type SessaoTeste } from './apoio.js';
import type { FastifyInstance } from 'fastify';

/**
 * Desenho aprovado da praça, nomes operacionais (Fileiras 11–16 e GR), área
 * desativada e tabela de correspondência de endereços reais (itens 13 e 14
 * do complemento) contra PostgreSQL real. Endereços da demonstração são
 * fictícios.
 */
const API = '/api/v1';
let db: Banco;
let app: FastifyInstance;
let sup: SessaoTeste;
let op: SessaoTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const [s, o] = await Promise.all([criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]), criarUsuario(db, 'operador', [[ID_ESCOPO_PRACA, 'OPERADOR']])]);
  [sup, op] = await Promise.all([entrar(app, s), entrar(app, o)]);
});

afterAll(async () => {
  await db.$disconnect();
});

async function praca(s: SessaoTeste = sup) {
  const r = await como(app, s, { method: 'GET', url: `${API}/praca` });
  expect(r.statusCode, r.body).toBe(200);
  return PracaSchema.parse(r.json());
}

async function correspondencia() {
  const r = await como(app, sup, { method: 'GET', url: `${API}/layout/enderecos` });
  expect(r.statusCode, r.body).toBe(200);
  return CorrespondenciaEnderecosSchema.parse(r.json());
}

async function fileira(codigo: string) {
  return db.fileira.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_PRACA, codigo, layout: { ativo: true } }, select: { id: true } });
}

describe('Desenho aprovado e nomes operacionais (item 13)', () => {
  it('mapa com 194 posições ativas e 300 desativadas; blocos FB01–FB07 com os nomes Fileiras 11–16 e GR', async () => {
    const { layout } = await praca();
    if (!layout) throw new Error('sem layout');
    expect(layout.positions).toHaveLength(494);
    expect(layout.positions.filter((p) => p.available && !p.deactivated)).toHaveLength(194);
    expect(layout.positions.filter((p) => p.deactivated && !p.available)).toHaveLength(300);
    const nomes = layout.elements.filter((e) => e.kind === 'BLOCO' && e.code.startsWith('FB')).map((e) => [e.code, e.operationalName, e.addressPrefix]);
    expect(nomes).toEqual([
      ['FB01', 'Fileira 11', '11'],
      ['FB02', 'Fileira 12', '12'],
      ['FB03', 'Fileira 13', '13'],
      ['FB04', 'Fileira 14', '14'],
      ['FB05', 'Fileira 15', '15'],
      ['FB06', 'Fileira 16', '16'],
      ['FB07', 'GR — Grade', 'GR'],
    ]);
    expect(layout.rows.find((r) => r.code === 'F02')?.side).toBe('ESQUERDO');
    expect(layout.rows.find((r) => r.code === 'F03')?.side).toBe('DIREITO');
    expect(layout.positions.find((p) => p.code === 'F01-P01')?.address).toEqual({ text: '11 - A1', state: 'CONFIRMADO' });
    expect(layout.positions.find((p) => p.code === 'F02-P01')?.address).toBeNull();
    expect(layout.totalCapacity).toBeNull();
  });

  it('nomenclatura aplicada de novo não muda nada (idempotente); reaplicar o seed não duplica posições e preserva IDs', async () => {
    const antes = await db.posicao.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_PRACA, codigo: 'F01-P01' }, select: { id: true } });
    const { layout } = await praca();
    const r = await mutar(app, sup, 'POST', `${API}/layout/nomenclatura-aprovada`, { expectedRevision: layout?.revision });
    expect(r.statusCode, r.body).toBe(200);
    expect(ResultadoLayoutSchema.parse(r.json())).toMatchObject({ revision: layout?.revision, summary: expect.stringMatching(/já estavam aplicados/) as unknown });
    await semearDemonstracao(db, new Date('2026-10-05T12:00:00Z'));
    expect(await db.posicao.count({ where: { escopoId: ID_ESCOPO_PRACA } })).toBe(494);
    const depois = await db.posicao.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_PRACA, codigo: 'F01-P01' }, select: { id: true } });
    expect(depois.id).toBe(antes.id);
  });

  it('layout de demonstração em versão anterior é atualizado pelo código: IDs, paletes e histórico preservados; sobra livre é retirada', async () => {
    const layout = await db.layout.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_PRACA, ativo: true } });
    const f08 = await fileira('F08');
    const p01 = await db.posicao.findFirstOrThrow({ where: { layoutId: layout.id, codigo: 'F01-P01' } });
    const ocupante = await db.palete.findFirstOrThrow({ where: { posicaoId: p01.id } });
    // Simula a versão anterior: geometria diferente e uma posição que não existe no desenho aprovado.
    await db.posicao.update({ where: { id: p01.id }, data: { x: p01.x + 4_000, y: p01.y + 4_000 } });
    await db.posicao.create({ data: { id: randomUUID(), escopoId: ID_ESCOPO_PRACA, layoutId: layout.id, fileiraId: f08.id, codigo: 'F08-P16', numero: 16, x: 9_000, y: 9_000, largura: 80, altura: 48 } });
    await db.layout.update({ where: { id: layout.id }, data: { versao: 'esquema-2026-10-02' } });
    await semearDemonstracao(db, new Date('2026-10-05T12:00:00Z'));
    const atualizado = await db.posicao.findFirstOrThrow({ where: { id: p01.id } });
    expect([atualizado.x, atualizado.y]).toEqual([p01.x, p01.y]);
    expect((await db.palete.findFirstOrThrow({ where: { id: ocupante.id } })).posicaoId).toBe(p01.id);
    expect((await db.posicao.findFirstOrThrow({ where: { layoutId: layout.id, codigo: 'F08-P16' } })).retiradaEm).not.toBeNull();
    expect(await db.posicao.count({ where: { layoutId: layout.id, retiradaEm: null } })).toBe(494);
    expect(await db.historicoLayout.count({ where: { layoutId: layout.id, acao: 'DESENHO_APROVADO_APLICADO' } })).toBe(1);
  });

  it('posição desativada não recebe palete; a ativação explícita a torna disponível', async () => {
    const d = await idPosicao(db, ID_ESCOPO_PRACA, 'D01-P01');
    const recusa = await mutar(app, op, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId: d, notes: null, declaredItems: [] });
    expect(recusa.statusCode).toBe(409);
    const { layout } = await praca();
    const ativar = await mutar(app, sup, 'PATCH', `${API}/layout/posicoes/${d}`, { expectedRevision: layout?.revision, available: true });
    expect(ativar.statusCode, ativar.body).toBe(200);
    expect(ResultadoLayoutSchema.parse(ativar.json()).summary).toMatch(/ativada/);
    const posicao = await db.posicao.findUniqueOrThrow({ where: { id: d } });
    expect([posicao.disponivel, posicao.desativada]).toEqual([true, false]);
    const ok = await mutar(app, op, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId: d, notes: null, declaredItems: [] });
    expect(ok.statusCode, ok.body).toBe(201);
    // Indicadores: a área desativada fica fora da capacidade ativa.
    expect((await praca()).layout?.positions.filter((p) => p.deactivated)).toHaveLength(299);
  });

  it('escopo sem layout recebe o desenho aprovado; com layout em uso, a criação é recusada', async () => {
    const unidade = await db.unidade.create({ data: { id: randomUUID(), codigo: 'UN-TESTE-DESENHO', nome: 'Unidade teste (fictícia)', demonstracao: true } });
    const cliente = await db.cliente.findFirstOrThrow({ where: { codigo: 'DEMO-CLIENTE' } });
    const escopo = await db.escopo.create({ data: { id: randomUUID(), unidadeId: unidade.id, clienteId: cliente.id, nome: 'Escopo teste sem layout', demonstracao: true } });
    const u = await criarUsuario(db, 'sup.novo', [[escopo.id, 'SUPERVISOR_ESTOQUE']]);
    const s = await entrar(app, u);
    const r = await mutar(app, s, 'POST', `${API}/layout/desenho-aprovado`, {});
    expect(r.statusCode, r.body).toBe(201);
    expect(await db.posicao.count({ where: { escopoId: escopo.id } })).toBe(494);
    expect(await db.elementoLayout.count({ where: { escopoId: escopo.id, nomeOperacional: 'Fileira 15', prefixoEndereco: '15' } })).toBe(1);
    const repetido = await mutar(app, s, 'POST', `${API}/layout/desenho-aprovado`, {});
    expect(repetido.statusCode).toBe(409);
  });
});

describe('Tabela de correspondência de endereços (item 14)', () => {
  it('pendências por faixa; sequência gera proposta que só resolve depois de confirmada; fileiras diferentes, posições diferentes', async () => {
    const inicial = await correspondencia();
    expect(inicial.confirmedAddresses).toBe(47);
    expect(inicial.pending.join(' ')).toMatch(/Fileira 12 · F02 \(lado esquerdo\): sequência inicial\/final e sentido não informados/);
    expect(inicial.pending.join(' ')).toMatch(/GR — Grade · F12 \(faixa única\)/);
    let revisao = inicial.revision;
    const f04 = await fileira('F04');
    const proposta = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${f04.id}/sequencia`, { expectedRevision: revisao, segments: 'A101-A133/2', direction: 'P01_PRIMEIRO', source: 'Levantamento fictício' });
    expect(proposta.statusCode, proposta.body).toBe(200);
    revisao = ResultadoLayoutSchema.parse(proposta.json()).revision;
    const [a101] = [...(await resolverEnderecos(db, ID_ESCOPO_PRACA, [normalizarEndereco('13 - A101')])).values()];
    expect(a101?.resolucao).toBe('PROPOSTA');
    const confirmar = await mutar(app, sup, 'POST', `${API}/layout/fileiras/${f04.id}/enderecos/confirmar`, { expectedRevision: revisao, expectedProposed: 17 });
    expect(confirmar.statusCode, confirmar.body).toBe(200);
    revisao = ResultadoLayoutSchema.parse(confirmar.json()).revision;
    const f05 = await fileira('F05');
    const segunda = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${f05.id}/sequencia`, { expectedRevision: revisao, segments: 'A102-A134/2', direction: 'P01_ULTIMO', source: 'Levantamento fictício' });
    expect(segunda.statusCode, segunda.body).toBe(200);
    revisao = ResultadoLayoutSchema.parse(segunda.json()).revision;
    await mutar(app, sup, 'POST', `${API}/layout/fileiras/${f05.id}/enderecos/confirmar`, { expectedRevision: revisao, expectedProposed: 17 });
    const resolvidos = await resolverEnderecos(db, ID_ESCOPO_PRACA, ['13 - A101', '13 - A120', '15 - A120', '14 - A120', '99 - A1'].map((t) => normalizarEndereco(t)));
    expect([...resolvidos.entries()].map(([k, v]) => [k, v.resolucao, v.posicaoCodigo])).toEqual([
      ['13|A101', 'POSICAO', 'F04-P01'],
      ['13|A120', 'POSICAO', 'F05-P08'],
      ['15|A120', 'POSICAO', 'F09-P10'],
      ['14|A120', 'SEM_POSICAO', null],
      ['99|A1', 'PREFIXO_DESCONHECIDO', null],
    ]);
  });

  it('sequência com contagem diferente, endereço repetido em outra faixa e troca de confirmados sem motivo são recusados', async () => {
    const c = await correspondencia();
    const f06 = await fileira('F06');
    const menor = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${f06.id}/sequencia`, { expectedRevision: c.revision, segments: 'A101-A131/2', direction: 'P01_PRIMEIRO', source: 'Teste' });
    expect(menor.statusCode).toBe(422);
    expect(codigoErro(menor)).toBe('SEQUENCIA_INCOMPATIVEL');
    const f01 = await fileira('F01');
    const semMotivo = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${f01.id}/sequencia`, { expectedRevision: c.revision, segments: 'A42-A58', direction: 'P01_PRIMEIRO', source: 'Teste' });
    expect(semMotivo.statusCode).toBe(409);
    const f10 = await fileira('F10');
    // Prefixo 16: sem conflito com a 15; mas na mesma fileira operacional o endereço é único.
    const f11 = await fileira('F11');
    const r1 = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${f10.id}/sequencia`, { expectedRevision: c.revision, segments: 'A101-A129/2', direction: 'P01_ULTIMO', source: 'Teste' });
    expect(r1.statusCode, r1.body).toBe(200);
    const repetido = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${f11.id}/sequencia`, {
      expectedRevision: ResultadoLayoutSchema.parse(r1.json()).revision,
      segments: 'A101-A129/2',
      direction: 'P01_PRIMEIRO',
      source: 'Teste',
    });
    expect(repetido.statusCode).toBe(409);
    const operador = await mutar(app, op, 'PUT', `${API}/layout/fileiras/${f11.id}/sequencia`, { expectedRevision: c.revision, segments: 'A102-A130/2', direction: 'P01_PRIMEIRO', source: 'Teste' });
    expect(operador.statusCode).toBe(403);
  });
});
