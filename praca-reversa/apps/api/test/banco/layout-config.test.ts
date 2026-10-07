import {
  HistoricoLayoutSchema,
  PaleteDetalheSchema,
  PracaSchema,
  ResultadoLayoutSchema,
  type Layout,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import {
  ID_ESCOPO_NAVEGACAO,
  ID_ESCOPO_PRACA,
  appDeTeste,
  bancoDeTeste,
  como,
  codigoErro,
  criarUsuario,
  entrar,
  idPosicao,
  mutar,
  prepararDados,
  type SessaoTeste,
} from './apoio.js';

let db: Banco;
let app: FastifyInstance;
let sSupervisor: SessaoTeste;
let sOperador: SessaoTeste;
let sAdmin: SessaoTeste;
let sConsulta: SessaoTeste;
let sNavSupervisor: SessaoTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const usuarios = await Promise.all([
    criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'operador', [[ID_ESCOPO_PRACA, 'OPERADOR']]),
    criarUsuario(db, 'admin', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]),
    criarUsuario(db, 'consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]),
    criarUsuario(db, 'nav.supervisor', [[ID_ESCOPO_NAVEGACAO, 'SUPERVISOR_ESTOQUE']]),
  ]);
  [sSupervisor, sOperador, sAdmin, sConsulta, sNavSupervisor] = await Promise.all([
    entrar(app, usuarios[0]),
    entrar(app, usuarios[1]),
    entrar(app, usuarios[2]),
    entrar(app, usuarios[3]),
    entrar(app, usuarios[4]),
  ]);
});

afterAll(async () => {
  await db.$disconnect();
});

async function layoutDe(sessao: SessaoTeste): Promise<{ layout: Layout; pallets: { id: string; positionId: string | null; positionCode: string | null }[] }> {
  const praca = PracaSchema.parse((await como(app, sessao, { method: 'GET', url: '/api/v1/praca' })).json());
  if (!praca.layout) throw new Error('Sem layout ativo.');
  return { layout: praca.layout, pallets: praca.pallets };
}

const bloco = (expectedRevision: number) => ({ expectedRevision, kind: 'PAR', positionsPerRow: 17, title: 'Par de fileiras de 17 (levantado)' });

describe('configuração do layout', () => {
  it('acrescenta bloco ao final, depois do último, sem mudar IDs, geometria existente nem vínculos', async () => {
    const antes = await layoutDe(sSupervisor);
    expect(antes.layout.revision).toBe(1);
    const resposta = await mutar(app, sSupervisor, 'POST', '/api/v1/layout/blocos', bloco(1));
    expect(resposta.statusCode).toBe(201);
    expect(ResultadoLayoutSchema.parse(resposta.json())).toMatchObject({ revision: 2 });

    const depois = await layoutDe(sConsulta);
    expect(depois.layout.revision).toBe(2);
    // Desenho aprovado (24 faixas): o bloco novo recebe as faixas seguintes na ordem, abaixo de tudo.
    const novas = depois.layout.rows.filter((f) => !antes.layout.rows.some((r) => r.id === f.id));
    expect(depois.layout.rows.slice(0, antes.layout.rows.length).map((f) => f.code)).toEqual(antes.layout.rows.map((f) => f.code));
    expect(novas.map((f) => f.code)).toEqual(['F25', 'F26']);
    expect(novas.map((f) => depois.layout.positions.filter((p) => p.rowId === f.id).length)).toEqual([17, 17]);
    const fundoAntes = Math.max(...antes.layout.positions.map((p) => p.y + p.height));
    expect(novas.every((f) => f.y > fundoAntes)).toBe(true);
    expect(depois.layout.positions.filter((p) => p.code.startsWith('F25')).every((p) => p.provisionalCode && !p.occupancySurveyed && !p.deactivated)).toBe(true);
    // Posições existentes: mesmos IDs, códigos e coordenadas; paletes no mesmo vínculo.
    for (const p of antes.layout.positions) {
      expect(depois.layout.positions.find((q) => q.id === p.id)).toEqual(p);
    }
    expect(depois.pallets.map((p) => [p.id, p.positionId])).toEqual(antes.pallets.map((p) => [p.id, p.positionId]));
    expect(depois.layout.totalCapacity).toBeNull();

    const historico = HistoricoLayoutSchema.parse((await como(app, sConsulta, { method: 'GET', url: '/api/v1/layout/historico' })).json());
    expect(historico.items).toHaveLength(1);
    expect(historico.items[0]).toMatchObject({ revision: 2, action: 'BLOCO_ACRESCENTADO', actor: { login: 'supervisor' } });
    expect(await db.eventoAuditoria.count({ where: { acao: 'LAYOUT_ALTERADO', escopoId: ID_ESCOPO_PRACA } })).toBe(1);
  });

  it('duas pessoas configurando ao mesmo tempo: a revisão desatualizada é recusada', async () => {
    const [a, b] = await Promise.all([
      mutar(app, sSupervisor, 'POST', '/api/v1/layout/blocos', bloco(1)),
      mutar(app, sSupervisor, 'POST', '/api/v1/layout/blocos', { ...bloco(1), kind: 'UNICA', positionsPerRow: 15 }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect([codigoErro(a), codigoErro(b)]).toContain('CONFLITO_VERSAO');
    const { layout } = await layoutDe(sSupervisor);
    expect(layout.revision).toBe(2);
    expect(await db.historicoLayout.count()).toBe(1);
  });

  it('posição ocupada: renomear preserva o vínculo; indisponibilizar e retirar são negados', async () => {
    const ocupada = await idPosicao(db, ID_ESCOPO_PRACA, 'F01-P01');
    const renomear = await mutar(app, sSupervisor, 'PATCH', `/api/v1/layout/posicoes/${ocupada}`, { expectedRevision: 1, code: 'r01-01', officialCode: true });
    expect(renomear.statusCode).toBe(200);
    const palete = PaleteDetalheSchema.parse(
      (await como(app, sConsulta, { method: 'GET', url: '/api/v1/paletes/00000000-0000-4000-8000-000000000001' })).json(),
    );
    expect(palete).toMatchObject({ positionId: ocupada, positionCode: 'R01-01' });
    const { layout } = await layoutDe(sConsulta);
    expect(layout.positions.find((p) => p.id === ocupada)).toMatchObject({ code: 'R01-01', provisionalCode: false });

    const indisponivel = await mutar(app, sSupervisor, 'PATCH', `/api/v1/layout/posicoes/${ocupada}`, {
      expectedRevision: 2,
      available: false,
      unavailableReason: 'Teste',
    });
    expect([indisponivel.statusCode, codigoErro(indisponivel)]).toEqual([409, 'CONFLITO']);
    const retirar = await mutar(app, sSupervisor, 'POST', `/api/v1/layout/posicoes/${ocupada}/retirar`, { expectedRevision: 2, reason: 'Teste' });
    expect(retirar.statusCode).toBe(409);
    expect((await db.posicao.findUniqueOrThrow({ where: { id: ocupada } })).disponivel).toBe(true);
  });

  it('posição livre: indisponível com motivo, retirada sai do desenho e o código não é reutilizado', async () => {
    const livre = await idPosicao(db, ID_ESCOPO_PRACA, 'F02-P15');
    const semMotivo = await mutar(app, sSupervisor, 'PATCH', `/api/v1/layout/posicoes/${livre}`, { expectedRevision: 1, available: false });
    expect(semMotivo.statusCode).toBe(400);
    expect(
      (await mutar(app, sSupervisor, 'PATCH', `/api/v1/layout/posicoes/${livre}`, { expectedRevision: 1, available: false, unavailableReason: 'Pilar' })).statusCode,
    ).toBe(200);
    expect((await layoutDe(sConsulta)).layout.positions.find((p) => p.id === livre)).toMatchObject({ available: false, unavailableReason: 'Pilar' });

    const retirada = await idPosicao(db, ID_ESCOPO_PRACA, 'F02-P14');
    expect((await mutar(app, sSupervisor, 'POST', `/api/v1/layout/posicoes/${retirada}/retirar`, { expectedRevision: 2, reason: 'Não existe' })).statusCode).toBe(200);
    const { layout } = await layoutDe(sConsulta);
    expect(layout.positions.some((p) => p.id === retirada)).toBe(false);
    expect(await db.posicao.count({ where: { id: retirada } })).toBe(1);
    const reutilizar = await mutar(app, sSupervisor, 'PATCH', `/api/v1/layout/posicoes/${livre}`, { expectedRevision: 3, code: 'F02P14' });
    expect([reutilizar.statusCode, codigoErro(reutilizar)]).toEqual([409, 'CONFLITO']);
    const codigoDePalete = await mutar(app, sSupervisor, 'PATCH', `/api/v1/layout/posicoes/${livre}`, { expectedRevision: 3, code: 'PAL-DEMO-001' });
    expect(codigoDePalete.statusCode).toBe(409);
  });

  it('mover bloco preserva IDs e vínculos; sobreposição e coordenada negativa são recusadas', async () => {
    const antes = await layoutDe(sSupervisor);
    // GR (FB07, faixa F12): bloco da extremidade do desenho aprovado.
    const gr = antes.layout.elements.find((e) => e.code === 'FB07');
    if (!gr) throw new Error('FB07 ausente');
    // Para fora da extremidade direita (abaixo há o corredor frontal; o título dele não pode cobrir posições).
    const mover = await mutar(app, sSupervisor, 'PATCH', '/api/v1/layout/elementos/FB07', { expectedRevision: 1, dx: 300, label: 'GR — Grade (posição a confirmar)' });
    expect(mover.statusCode, mover.body).toBe(200);
    const depois = await layoutDe(sSupervisor);
    expect(depois.layout.width).toBeGreaterThan(antes.layout.width);
    const f12 = (l: Layout) => l.positions.filter((p) => p.code.startsWith('F12-'));
    expect(f12(depois.layout).map((p) => [p.id, p.x, p.y])).toEqual(f12(antes.layout).map((p) => [p.id, p.x + 300, p.y]));
    expect(depois.layout.elements.find((e) => e.code === 'FB07')).toMatchObject({ label: 'GR — Grade (posição a confirmar)', x: gr.x + 300, operationalName: 'GR — Grade', addressPrefix: 'GR' });
    expect(depois.pallets).toEqual(antes.pallets);

    const sobreposto = await mutar(app, sSupervisor, 'PATCH', '/api/v1/layout/elementos/FB06', { expectedRevision: 2, dx: -150 });
    expect([sobreposto.statusCode, codigoErro(sobreposto)]).toEqual([422, 'GEOMETRIA_INVALIDA']);
    const negativo = await mutar(app, sSupervisor, 'PATCH', '/api/v1/layout/elementos/FB01', { expectedRevision: 2, dx: -500 });
    expect([negativo.statusCode, codigoErro(negativo)]).toEqual([422, 'GEOMETRIA_INVALIDA']);
    expect((await layoutDe(sSupervisor)).layout.revision).toBe(2);
    const redimensionarBloco = await mutar(app, sSupervisor, 'PATCH', '/api/v1/layout/elementos/FB01', { expectedRevision: 2, width: 100 });
    expect(redimensionarBloco.statusCode).toBe(400);
  });

  it('zona: criada com título fora das posições ou só na lista quando não cabe', async () => {
    const { layout } = await layoutDe(sSupervisor);
    const zona = await mutar(app, sSupervisor, 'POST', '/api/v1/layout/zonas', {
      expectedRevision: 1,
      code: 'z-triagem',
      label: 'Zona de triagem (fictícia)',
      x: 0,
      y: 0,
      width: layout.width,
      height: 44,
    });
    expect(zona.statusCode).toBe(201);
    // Zona sobre as faixas ativas: o título não cabe sem cobrir posições.
    const f01 = layout.positions.filter((p) => p.code.startsWith('F01-'));
    const topoF01 = Math.min(...f01.map((p) => p.y));
    const apertada = await mutar(app, sSupervisor, 'POST', '/api/v1/layout/zonas', {
      expectedRevision: 2,
      code: 'Z-FILEIRA',
      label: 'Sobre F01',
      x: 40,
      y: topoF01 + 20,
      width: 600,
      height: 200,
    });
    expect(apertada.statusCode).toBe(201);
    const depois = (await layoutDe(sConsulta)).layout;
    expect(depois.elements.find((e) => e.code === 'Z-TRIAGEM')?.labelBox).not.toBeNull();
    expect(depois.elements.find((e) => e.code === 'Z-FILEIRA')?.labelBox).toBeNull();
    const repetida = await mutar(app, sSupervisor, 'POST', '/api/v1/layout/zonas', { expectedRevision: 3, code: 'Z-TRIAGEM', label: 'Repetida', x: 0, y: 0, width: 50, height: 50 });
    expect(repetida.statusCode).toBe(409);
  });

  it('cria layout num escopo sem layout; segundo layout é recusado; blocos e paletes passam a funcionar', async () => {
    const unidade = await db.unidade.create({ data: { id: randomUUID(), codigo: 'UN-TESTE', nome: 'Unidade de teste' } });
    const cliente = await db.cliente.create({ data: { id: randomUUID(), codigo: 'CLI-TESTE', nome: 'Cliente de teste' } });
    const escopo = await db.escopo.create({ data: { id: randomUUID(), unidadeId: unidade.id, clienteId: cliente.id, nome: 'Escopo de teste' } });
    const supervisor = await criarUsuario(db, 'sup.novo', [[escopo.id, 'SUPERVISOR_ESTOQUE']]);
    const sessao = await entrar(app, supervisor);

    const vazio = PracaSchema.parse((await como(app, sessao, { method: 'GET', url: '/api/v1/praca' })).json());
    expect(vazio.layout).toBeNull();
    expect((await mutar(app, sessao, 'POST', '/api/v1/layout/blocos', bloco(1))).statusCode).toBe(404);
    const criado = await mutar(app, sessao, 'POST', '/api/v1/layout', { name: 'Praça do piloto (esquema)' });
    expect(criado.statusCode).toBe(201);
    expect((await mutar(app, sessao, 'POST', '/api/v1/layout', { name: 'Outro' })).statusCode).toBe(409);
    expect((await mutar(app, sessao, 'POST', '/api/v1/layout/blocos', { ...bloco(1), kind: 'UNICA', positionsPerRow: 15, title: 'Início' })).statusCode).toBe(201);
    expect((await mutar(app, sessao, 'POST', '/api/v1/layout/blocos', { ...bloco(2), positionsPerRow: 15, title: 'Par de 15' })).statusCode).toBe(201);
    const { layout } = await layoutDe(sessao);
    expect(layout).toMatchObject({ revision: 3, fictional: false, totalCapacity: null });
    expect(layout.rows.map((f) => f.code)).toEqual(['F01', 'F02', 'F03']);

    const posicao = layout.positions.find((p) => p.code === 'F02-P01');
    const palete = await mutar(app, sessao, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: posicao?.id ?? null });
    expect(PaleteDetalheSchema.parse(palete.json())).toMatchObject({ code: 'PR-000001', positionCode: 'F02-P01', dataSource: 'OPERACAO' });
  });

  it('somente quem configura altera o layout; consulta vê o histórico', async () => {
    for (const sessao of [sOperador, sAdmin, sConsulta]) {
      expect((await mutar(app, sessao, 'POST', '/api/v1/layout/blocos', bloco(1))).statusCode).toBe(403);
    }
    expect((await como(app, sConsulta, { method: 'GET', url: '/api/v1/layout/historico' })).statusCode).toBe(200);
    expect((await layoutDe(sConsulta)).layout.revision).toBe(1);
  });

  it('o cenário de navegação aceita alterações (geometria do fixture coerente) e isola escopos', async () => {
    const livre = await db.posicao.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_NAVEGACAO, disponivel: true, palete: { is: null } }, select: { id: true } });
    const resposta = await mutar(app, sNavSupervisor, 'PATCH', `/api/v1/layout/posicoes/${livre.id}`, { expectedRevision: 1, available: false, unavailableReason: 'Extintor' });
    expect(resposta.statusCode).toBe(200);
    const daPraca = await idPosicao(db, ID_ESCOPO_PRACA, 'F02-P02');
    expect((await mutar(app, sNavSupervisor, 'PATCH', `/api/v1/layout/posicoes/${daPraca}`, { expectedRevision: 2, available: false, unavailableReason: 'Pilar' })).statusCode).toBe(404);
    expect((await layoutDe(sSupervisor)).layout.revision).toBe(1);
  });
});
