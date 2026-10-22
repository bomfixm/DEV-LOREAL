import { CorrespondenciaEnderecosSchema, ResultadoLayoutSchema, type Escopo } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { executarCarga, lerPacote, type PacoteLido } from '../../src/modules/importacao/carga-lote.js';
import { appDeTeste, bancoDeTeste, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste, type UsuarioTeste } from './apoio.js';
import { bytesDoPacote, montarPacote, type LinhaTeste } from './pacote-carga.js';

/**
 * Carga do inventário com o palete identificado pelo N° Pallet (21 out.
 * 2026), num escopo operacional de teste com a Fileira 13 confirmada (13 -
 * A101 = F04-P01, A103 = P02, A105 = P03, A107 = P04). O caso 11 - A42 não se
 * repete; o palete que mudou de endereço leva as notas sem duplicar; nada
 * desfaz movimentação, validação ou cancelamento feitos no aplicativo; o
 * palete ainda sem número recebe o seu. Dados fictícios.
 */
const API = '/api/v1';
let db: Banco;
let app: FastifyInstance;
let escopo: Escopo;
let supervisor: UsuarioTeste;
let sup: SessaoTeste;

const linha = (n: number, numero: string, endereco: string, numeroPlanilha: string, volumes = '1'): LinhaTeste => ({
  linha: n,
  tipo: 'NFD',
  numero,
  remetente: `Remetente Fictício ${numero}`,
  endereco,
  volumes,
  numeroPlanilha,
});

function lido(linhas: readonly LinhaTeste[], variante: string): PacoteLido {
  const r = lerPacote(bytesDoPacote(montarPacote(linhas, { variante })), 'dados-importacao.json');
  if (!r.ok) throw new Error(`Pacote fictício recusado: ${r.erros.join(' | ')}`);
  return r.pacote;
}

const autor = () => ({ usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` });
const carregar = (p: PacoteLido, opcoes: { substitui?: string; manterAusentes?: boolean; identidadePorEndereco?: boolean } = {}, quando = '2026-10-20T12:00:00Z') =>
  executarCarga(db, escopo, autor(), p, { substitui: opcoes.substitui ?? null, descricao: null, manterAusentes: opcoes.manterAusentes, identidadePorEndereco: opcoes.identidadePorEndereco }, new Date(quando));

async function palete(codigo: string): Promise<{ id: string; codigo: string; codigoLegado: string | null; posicao: string | null }> {
  const p = await db.palete.findFirstOrThrow({ where: { escopoId: escopo.id, codigo }, select: { id: true, codigo: true, codigoLegado: true, posicao: { select: { codigo: true } } } });
  return { id: p.id, codigo: p.codigo, codigoLegado: p.codigoLegado, posicao: p.posicao?.codigo ?? null };
}

async function paleteNaPosicao(posicao: string): Promise<{ id: string; codigo: string }> {
  return db.palete.findFirstOrThrow({ where: { escopoId: escopo.id, posicao: { codigo: posicao, layout: { ativo: true } } }, select: { id: true, codigo: true } });
}

/** Números das notas ativas do palete. */
async function notas(paleteId: string): Promise<string[]> {
  const v = await db.vinculoDocumentoPalete.findMany({ where: { escopoId: escopo.id, paleteId, situacao: 'ATIVO' }, select: { numeroDocumento: true } });
  return v.map((x) => x.numeroDocumento).sort();
}

async function vinculoAtivo(numero: string) {
  return db.vinculoDocumentoPalete.findMany({ where: { escopoId: escopo.id, numeroDocumento: numero, situacao: 'ATIVO' }, select: { id: true, paleteId: true, volumes: true, alocadoEm: true } });
}

async function motivosDaLinha(inventario: string, numero: string): Promise<string[]> {
  const l = await db.linhaInventario.findFirstOrThrow({ where: { escopoId: escopo.id, numeroDocumento: numero, inventario: { codigo: inventario } }, select: { motivos: true } });
  return (l.motivos as { code: string }[]).map((m) => m.code);
}

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const unidade = await db.unidade.create({ data: { id: randomUUID(), codigo: 'UN-TESTE-NUM', nome: 'Unidade operacional de teste', demonstracao: false } });
  const cli = await db.cliente.create({ data: { id: randomUUID(), codigo: 'CLI-TESTE-NUM', nome: 'Cliente de teste', demonstracao: false } });
  const e = await db.escopo.create({ data: { id: randomUUID(), unidadeId: unidade.id, clienteId: cli.id, nome: 'Praça de teste · Número do palete', demonstracao: false } });
  escopo = { id: e.id, name: e.nome, unitCode: unidade.codigo, unitName: unidade.nome, clientCode: cli.codigo, clientName: cli.nome, demo: false };
  supervisor = await criarUsuario(db, 'supervisor.num', [[e.id, 'SUPERVISOR_ESTOQUE']]);
  sup = await entrar(app, supervisor);
  const desenho = await mutar(app, sup, 'POST', `${API}/layout/desenho-aprovado`, {});
  expect(desenho.statusCode, desenho.body).toBe(201);
  const c = CorrespondenciaEnderecosSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/layout/enderecos` })).json());
  const f04 = await db.fileira.findFirstOrThrow({ where: { escopoId: e.id, codigo: 'F04', layout: { ativo: true } }, select: { id: true } });
  const proposta = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${f04.id}/sequencia`, { expectedRevision: c.revision, segments: 'A101-A133/2', direction: 'P01_PRIMEIRO', source: 'Levantamento fictício' });
  expect(proposta.statusCode, proposta.body).toBe(200);
  const confirmar = await mutar(app, sup, 'POST', `${API}/layout/fileiras/${f04.id}/enderecos/confirmar`, { expectedRevision: ResultadoLayoutSchema.parse(proposta.json()).revision, expectedProposed: 17 });
  expect(confirmar.statusCode, confirmar.body).toBe(200);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('Carga do inventário: palete pelo N° Pallet', () => {
  it('11 - A42 não se repete: o 256 é outro palete (sem posição enquanto o 1 ocupa o endereço); o palete 3 muda de endereço sem duplicar a nota', async () => {
    const V1 = [linha(3, '0007885', '13 - A101', '1'), linha(4, '0007886', '13 - A101', '1'), linha(5, '0007900', '13 - A103', '2'), linha(6, '0007950', '13 - A105', '3', '4')];
    const r1 = await carregar(lido(V1, 'v1'), {}, '2026-10-06T12:00:00Z');
    expect(r1.paletes).toMatchObject({ criados: 3 });
    expect([(await palete('1')).posicao, (await palete('2')).posicao, (await palete('3')).posicao]).toEqual(['F04-P01', 'F04-P02', 'F04-P03']);

    // 20/10: em 13 - A101 está o palete 256 (outra nota); o palete 3 foi para 13 - A107.
    const V2 = [linha(3, '0009802', '13 - A101', '256', '117'), linha(4, '0007900', '13 - A103', '2'), linha(5, '0007950', '13 - A107', '3', '4')];
    const r2 = await carregar(lido(V2, 'v2'), { substitui: 'INV-000001', manterAusentes: true });
    expect(r2.paletes).toMatchObject({ criados: 1, existentes: 2, emConflito: 0, numerosAtribuidos: 0 });
    expect(r2.vinculos).toMatchObject({ criados: 1, jaExistentes: 2, atualizados: 0, encerradosOutroPalete: 0 });
    // O 256 é palete novo, com o número da fonte e sem posição (o 1 continua registrado em 13 - A101).
    const p256 = await palete('256');
    expect(p256).toMatchObject({ codigoLegado: null, posicao: null });
    expect(await notas(p256.id)).toEqual(['0009802']);
    expect(await motivosDaLinha('INV-000002', '0009802')).toContain('POSICAO_COM_OUTRO_PALETE');
    // As notas do palete 1 não se misturam com o 256.
    expect(await notas((await palete('1')).id)).toEqual(['0007885', '0007886']);
    // Palete 3: fica onde o aplicativo registra (movimento é registro do piso) e a nota não é duplicada.
    const p3 = await palete('3');
    expect(p3.posicao).toBe('F04-P03');
    expect(await vinculoAtivo('0007950')).toHaveLength(1);
    expect(await motivosDaLinha('INV-000002', '0007950')).toContain('ENDERECO_DIVERGENTE');

    // Saída do palete 1 registrada: o reenvio do mesmo pacote localiza o 256 em 13 - A101.
    const p1 = await db.palete.findFirstOrThrow({ where: { escopoId: escopo.id, codigo: '1' }, select: { id: true, versao: true } });
    const p09 = await db.posicao.findFirstOrThrow({ where: { escopoId: escopo.id, codigo: 'F04-P09', layout: { ativo: true } }, select: { id: true } });
    const mov = await mutar(app, sup, 'POST', `${API}/paletes/${p1.id}/movimentos`, { destinationPositionId: p09.id, confirmedPositionCode: 'F04-P09', expectedVersion: p1.versao, reason: 'Palete 1 saiu do endereço (teste)' });
    expect(mov.statusCode, mov.body).toBe(200);
    const reenvio = await carregar(lido(V2, 'v2'), { substitui: 'INV-000001', manterAusentes: true });
    expect(reenvio).toMatchObject({ reenvio: true, paletes: { localizacoesRegistradas: 1 } });
    expect((await palete('256')).posicao).toBe('F04-P01');
  });

  it('não desfaz decisões do aplicativo: nota movida fica no palete novo (mesmo atualizada ou ausente); em validação ou cancelada não é recriada', async () => {
    const V1 = [linha(3, '0007885', '13 - A101', '1'), linha(4, '0007886', '13 - A101', '1', '2'), linha(5, '0007887', '13 - A101', '1'), linha(6, '0007900', '13 - A103', '2')];
    await carregar(lido(V1, 'v1'), {}, '2026-10-06T12:00:00Z');
    const p1 = await palete('1');
    const p2 = await palete('2');
    const id = async (numero: string) => ({ kind: 'IMPORTADO', id: (await vinculoAtivo(numero))[0]?.id ?? '' });
    const acao = (corpo: Record<string, unknown>) => mutar(app, sup, 'POST', `${API}/paletes/${p1.id}/conteudos/acoes`, corpo);
    expect((await acao({ action: 'MOVER', items: [await id('0007886')], destination: { kind: 'PALETE', id: p2.id }, confirmOccupied: true, reason: 'Estava no palete 2 (teste)' })).statusCode).toBe(200);
    expect((await acao({ action: 'VALIDACAO', items: [await id('0007887')], reason: 'Não encontrada no palete (teste)' })).statusCode).toBe(200);
    expect((await acao({ action: 'CANCELAR', items: [await id('0007885')], reason: 'Registro duplicado (teste)', confirm: true })).statusCode).toBe(200);

    // Versão nova sem manter ausentes: a mesma fonte, com o volume da 7886 corrigido (2 → 5).
    const V2 = V1.map((l) => (l.numero === '0007886' ? { ...l, volumes: '5' } : l));
    const r2 = await carregar(lido(V2, 'v2'), { substitui: 'INV-000001' });
    expect(r2.linhas.pendentes).toBe(2);
    // 7886: atualizada no palete para onde foi levada (o 2), não de volta no 1; a alocação manual continua marcada.
    const v886 = await vinculoAtivo('0007886');
    expect(v886).toHaveLength(1);
    expect(v886[0]).toMatchObject({ paleteId: p2.id });
    expect(v886[0]?.volumes?.toFixed()).toBe('5');
    expect(v886[0]?.alocadoEm).not.toBeNull();
    expect(await motivosDaLinha('INV-000002', '0007886')).toContain('OCORRENCIA_MOVIDA');
    // 7887 em validação e 7885 cancelada: linhas pendentes, nenhuma ocorrência nova.
    expect(await motivosDaLinha('INV-000002', '0007887')).toContain('NOTA_EM_VALIDACAO');
    expect(await motivosDaLinha('INV-000002', '0007885')).toContain('NOTA_CANCELADA');
    expect(await vinculoAtivo('0007887')).toHaveLength(0);
    expect(await vinculoAtivo('0007885')).toHaveLength(0);
    expect(await db.vinculoDocumentoPalete.count({ where: { escopoId: escopo.id, numeroDocumento: '0007887', situacao: 'VALIDACAO' } })).toBe(1);
    expect(await notas(p1.id)).toEqual([]);
    expect(await notas(p2.id)).toEqual(['0007886', '0007900']);

    // Versão seguinte sem a 7886: ausente, mas movida no piso — continua ativa no palete 2.
    const V3 = V2.filter((l) => l.numero !== '0007886');
    await carregar(lido(V3, 'v3'), { substitui: 'INV-000002' });
    expect(await vinculoAtivo('0007886')).toHaveLength(1);
    expect(await notas(p2.id)).toEqual(['0007886', '0007900']);
  });

  it('palete ainda sem número (PR-…) recebe o N° Pallet ligado a ele; sem ligação anterior, a posição com palete sem número fica em conflito', async () => {
    // Dados antigos (regra anterior): códigos gerados; o 13 - A105 sem N° Pallet.
    const V1 = [linha(3, '0007885', '13 - A101', '1'), linha(4, '0007950', '13 - A105', '')];
    await carregar(lido(V1, 'v1'), { identidadePorEndereco: true }, '2026-10-06T12:00:00Z');
    const antigo = await paleteNaPosicao('F04-P01');
    expect(antigo.codigo).toMatch(/^PR-\d{6}$/);
    const V2 = [linha(3, '0007885', '13 - A101', '1'), linha(4, '0007950', '13 - A105', '3')];
    const r = await carregar(lido(V2, 'v2'), { substitui: 'INV-000001' });
    expect(r.paletes).toMatchObject({ numerosAtribuidos: 1, emConflito: 1, criados: 0 });
    // Mesmo ID, número operacional 1, PR-… como legado e a troca no histórico.
    expect(await palete('1')).toMatchObject({ id: antigo.id, codigoLegado: antigo.codigo, posicao: 'F04-P01' });
    expect(await db.historicoCodigoPalete.count({ where: { paleteId: antigo.id, codigoAnterior: antigo.codigo, codigoNovo: '1' } })).toBe(1);
    expect(await vinculoAtivo('0007885')).toHaveLength(1);
    // 13 - A105: o palete do endereço não tem número e nunca foi ligado ao 3 — pode ser o mesmo; nada é aplicado por suposição.
    expect(await motivosDaLinha('INV-000002', '0007950')).toContain('POSICAO_COM_PALETE_SEM_NUMERO');
    expect(await db.palete.count({ where: { escopoId: escopo.id, codigo: '3' } })).toBe(0);
  });

  it('nota que a versão nova põe noutro palete: a ocorrência antiga é encerrada (com histórico), sem duplicar', async () => {
    const V1 = [linha(3, '0007885', '13 - A101', '1'), linha(4, '0007886', '13 - A101', '1'), linha(5, '0007900', '13 - A103', '2')];
    await carregar(lido(V1, 'v1'), {}, '2026-10-06T12:00:00Z');
    const p1 = await palete('1');
    const p2 = await palete('2');
    const antigo = (await vinculoAtivo('0007885'))[0]?.id ?? '';
    const V2 = [linha(3, '0007886', '13 - A101', '1'), linha(4, '0007900', '13 - A103', '2'), linha(5, '0007885', '13 - A103', '2')];
    const r = await carregar(lido(V2, 'v2'), { substitui: 'INV-000001', manterAusentes: true });
    expect(r.vinculos).toMatchObject({ criados: 1, encerradosOutroPalete: 1 });
    expect(await notas(p1.id)).toEqual(['0007886']);
    expect(await notas(p2.id)).toEqual(['0007885', '0007900']);
    const v = await db.vinculoDocumentoPalete.findUniqueOrThrow({ where: { id: antigo }, select: { situacao: true, motivoEncerramento: true } });
    expect(v.situacao).toBe('ENCERRADO');
    expect(v.motivoEncerramento).toMatch(/consta desta versão no palete 2 \(13 - A103\)/);
    expect(await db.historicoConteudo.count({ where: { vinculoId: antigo, acao: 'ENCERRAMENTO' } })).toBe(1);
  });
});
