import { ConteudosPaleteSchema, CorrespondenciaEnderecosSchema, FilaValidacaoSchema, PaleteDetalheSchema, ResultadoLayoutSchema, type Escopo } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { executarCarga, lerPacote, type PacoteLido } from '../../src/modules/importacao/carga-lote.js';
import { aplicarCorrecao, planejarCorrecao } from '../../src/modules/paletes/correcao-identidade.js';
import { previsaoNumeroPalete } from '../../src/modules/paletes/numeracao.js';
import { appDeTeste, bancoDeTeste, codigoErro, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste, type UsuarioTeste } from './apoio.js';
import { bytesDoPacote, montarPacote, type LinhaTeste } from './pacote-carga.js';

/**
 * Correção dos paletes cadastrados pelo endereço (21 out. 2026), num escopo
 * operacional de teste com a Fileira 13 confirmada — como o caso 11 - A42, com
 * dados fictícios: em 06/10 o endereço 13 - A101 tinha o palete 1 (três notas);
 * em 20/10, o palete 256 (uma nota de 117 volumes). A carga antiga reaproveitou
 * o registro técnico. A correção dá o número operacional (256) sem mudar o ID,
 * leva as notas indevidas para a validação, encerra as que constam noutro
 * palete e não toca no que entrou depois nem no que foi recontado.
 */
const API = '/api/v1';
let db: Banco;
let app: FastifyInstance;
let escopo: Escopo;
let supervisor: UsuarioTeste;
let sup: SessaoTeste;
let cliente: SessaoTeste;

const V1: LinhaTeste[] = [
  { linha: 3, tipo: 'NFD', numero: '0007885', remetente: 'Remetente Fictício A', endereco: '13 - A101', volumes: '1', numeroPlanilha: '1' },
  { linha: 4, tipo: 'NFD', numero: '0007886', remetente: 'Remetente Fictício B', endereco: '13 - A101', volumes: '2', numeroPlanilha: '1' },
  { linha: 5, tipo: 'NFD', numero: '0007887', remetente: 'Remetente Fictício C', endereco: '13 - A101', volumes: '1', numeroPlanilha: '1' },
  { linha: 6, tipo: 'NFD', numero: '0007900', remetente: 'Remetente Fictício D', endereco: '13 - A103', volumes: '3', numeroPlanilha: '2' },
  { linha: 7, tipo: 'NFD', numero: '0007901', remetente: 'Remetente Fictício E', endereco: '13 - A103', volumes: '1', numeroPlanilha: '2' },
  { linha: 8, tipo: 'NFD', numero: '0007950', remetente: 'Remetente Fictício F', endereco: '13 - A105', volumes: '4', numeroPlanilha: '3' },
];
/** 20/10: 13 - A101 tem o palete 256; o palete 3 foi para 13 - A107; 13 - A105 não aparece. */
const V2: LinhaTeste[] = [
  { linha: 3, tipo: 'NFD', numero: '0009802', remetente: 'Remetente Fictício Sleiman', endereco: '13 - A101', volumes: '117', marcador: '03\\09', numeroPlanilha: '256' },
  { linha: 4, tipo: 'NFD', numero: '0007900', remetente: 'Remetente Fictício D', endereco: '13 - A103', volumes: '3', numeroPlanilha: '2' },
  { linha: 5, tipo: 'NFD', numero: '0007950', remetente: 'Remetente Fictício F', endereco: '13 - A107', volumes: '4', numeroPlanilha: '3' },
];

function lido(linhas: readonly LinhaTeste[], variante: string): PacoteLido {
  const r = lerPacote(bytesDoPacote(montarPacote(linhas, { variante })), 'dados-importacao.json');
  if (!r.ok) throw new Error(`Pacote fictício recusado: ${r.erros.join(' | ')}`);
  return r.pacote;
}

const autor = () => ({ usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` });

async function paleteEm(endereco: string): Promise<{ id: string; codigo: string; codigoLegado: string | null; posicaoId: string | null }> {
  const ep = await db.enderecoPosicao.findFirstOrThrow({ where: { escopoId: escopo.id, endereco }, select: { posicaoId: true } });
  return db.palete.findFirstOrThrow({ where: { escopoId: escopo.id, posicaoId: ep.posicaoId }, select: { id: true, codigo: true, codigoLegado: true, posicaoId: true } });
}

async function documentos(paleteId: string): Promise<string[]> {
  const r = await como(app, sup, { method: 'GET', url: `${API}/paletes/${paleteId}/conteudos` });
  expect(r.statusCode, r.body).toBe(200);
  return ConteudosPaleteSchema.parse(r.json())
    .items.map((i) => i.documentNumber ?? i.sender ?? '')
    .sort();
}

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const unidade = await db.unidade.create({ data: { id: randomUUID(), codigo: 'UN-TESTE-CORR', nome: 'Unidade operacional de teste', demonstracao: false } });
  const cli = await db.cliente.create({ data: { id: randomUUID(), codigo: 'CLI-TESTE-CORR', nome: 'Cliente de teste', demonstracao: false } });
  const e = await db.escopo.create({ data: { id: randomUUID(), unidadeId: unidade.id, clienteId: cli.id, nome: 'Praça de teste · Correção', demonstracao: false } });
  escopo = { id: e.id, name: e.nome, unitCode: unidade.codigo, unitName: unidade.nome, clientCode: cli.codigo, clientName: cli.nome, demo: false };
  supervisor = await criarUsuario(db, 'supervisor.corr', [[e.id, 'SUPERVISOR_ESTOQUE']]);
  sup = await entrar(app, supervisor);
  cliente = await entrar(app, await criarUsuario(db, 'cliente.corr', [[e.id, 'CLIENTE_CONSULTA']]));
  const desenho = await mutar(app, sup, 'POST', `${API}/layout/desenho-aprovado`, {});
  expect(desenho.statusCode, desenho.body).toBe(201);
  const c = CorrespondenciaEnderecosSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/layout/enderecos` })).json());
  const f04 = await db.fileira.findFirstOrThrow({ where: { escopoId: e.id, codigo: 'F04', layout: { ativo: true } }, select: { id: true } });
  const proposta = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${f04.id}/sequencia`, { expectedRevision: c.revision, segments: 'A101-A133/2', direction: 'P01_PRIMEIRO', source: 'Levantamento fictício' });
  expect(proposta.statusCode, proposta.body).toBe(200);
  const confirmar = await mutar(app, sup, 'POST', `${API}/layout/fileiras/${f04.id}/enderecos/confirmar`, { expectedRevision: ResultadoLayoutSchema.parse(proposta.json()).revision, expectedProposed: 17 });
  expect(confirmar.statusCode, confirmar.body).toBe(200);
  // 06/10 e 20/10 (substitui mantendo os ausentes, como foi feito na operação real), com a regra antiga da carga
  // (palete pelo endereço): reproduz os dados já cadastrados que a correção trata — a carga atual não os gera mais.
  await executarCarga(db, escopo, autor(), lido(V1, 'v1'), { substitui: null, descricao: null, identidadePorEndereco: true }, new Date('2026-10-06T12:00:00Z'));
  await executarCarga(db, escopo, autor(), lido(V2, 'v2'), { substitui: 'INV-000001', descricao: null, manterAusentes: true, identidadePorEndereco: true }, new Date('2026-10-20T12:00:00Z'));
});

afterAll(async () => {
  await db.$disconnect();
});

describe('Correção de paletes e alocações', () => {
  it('caso 13 - A101 (como 11 - A42): palete 256 com a NFD da fonte; notas indevidas na validação, rastreáveis; ID, QR e legado preservados', async () => {
    const antes = await paleteEm('13 - A101');
    // Sintoma: o registro técnico do palete 1 recebeu a nota do 256 e manteve as três antigas.
    expect(await documentos(antes.id)).toEqual(['0007885', '0007886', '0007887', '0009802']);
    // Entrada legítima posterior (registrada no aplicativo) e uma nota recontada com volume depois da data-base.
    const reg = await mutar(app, sup, 'POST', `${API}/paletes/${antes.id}/conteudos`, { sender: 'Remetente Fictício Posterior', documentType: 'NFD', documentNumber: '0008000' });
    expect(reg.statusCode, reg.body).toBe(201);
    const v887 = await db.vinculoDocumentoPalete.findFirstOrThrow({ where: { escopoId: escopo.id, numeroDocumento: '0007887', situacao: 'ATIVO' }, select: { id: true } });
    const cont = await mutar(app, sup, 'POST', `${API}/paletes/${antes.id}/conteudos/contagens`, { target: { kind: 'IMPORTADO', id: v887.id }, counted: 1, origin: 'CONTAGEM_FISICA' });
    expect(cont.statusCode, cont.body).toBe(201);

    const plano = await planejarCorrecao(db, escopo.id);
    expect(plano.inventario?.codigo).toBe('INV-000002');
    expect(plano.numeros.map((n) => [n.endereco, n.de, n.para]).sort()).toEqual([
      ['13 - A101', antes.codigo, '256'],
      ['13 - A103', (await paleteEm('13 - A103')).codigo, '2'],
      ['13 - A107', (await paleteEm('13 - A107')).codigo, '3'],
    ]);
    const decisoes = Object.fromEntries(plano.vinculos.map((v) => [`${v.documento}@${v.endereco ?? ''}`, v.decisao]));
    expect(decisoes).toEqual({
      'NFD 0007885@13 - A101': 'VALIDACAO',
      'NFD 0007886@13 - A101': 'VALIDACAO',
      'NFD 0007887@13 - A101': 'MANTER',
      'NFD 0007901@13 - A103': 'MANTER',
      'NFD 0007950@13 - A105': 'ENCERRAR',
    });
    expect(plano.vinculos.find((v) => v.documento === 'NFD 0007885')?.motivo).toMatch(/13 - A101 tem o palete 256; esta nota \(INV-000001, N° Pallet 1\) não consta da versão atual/);

    const r = await db.$transaction(async (tx) => aplicarCorrecao(tx, escopo, plano, autor(), new Date(), 'Correção de teste.'));
    expect(r).toMatchObject({ numeros: 3, validacao: 2, encerrados: 1, mantidos: 2 });

    // Mesmo ID, número operacional 256, PR-… guardado como legado; histórico da troca.
    const depois = await paleteEm('13 - A101');
    expect(depois).toMatchObject({ id: antes.id, codigo: '256', codigoLegado: antes.codigo, posicaoId: antes.posicaoId });
    expect(await db.historicoCodigoPalete.count({ where: { paleteId: antes.id, codigoAnterior: antes.codigo, codigoNovo: '256' } })).toBe(1);
    const detalhe = PaleteDetalheSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/paletes/${antes.id}` })).json());
    expect(detalhe).toMatchObject({ code: '256', legacyCode: antes.codigo, codeOrigin: 'EXISTENTE' });
    // Conteúdo físico atual: a NFD da fonte, a entrada posterior e a recontada; as indevidas saíram do total.
    expect(await documentos(antes.id)).toEqual(['0007887', '0008000', '0009802']);
    // Rastreáveis na validação, com o último palete como histórico e a origem.
    const fila = FilaValidacaoSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/validacao` })).json());
    expect(fila.items.map((i) => [i.documentNumber, i.volumes, i.lastKnown?.code, i.source]).sort()).toEqual([
      ['0007885', 1, '256', 'INV-000001, linha 3'],
      ['0007886', 2, '256', 'INV-000001, linha 4'],
    ]);
    expect(fila.items[0]?.history.map((e) => e.type)).toEqual(['IMPORTACAO', 'VALIDACAO']);
    // O cliente não alcança a fila.
    expect((await como(app, cliente, { method: 'GET', url: `${API}/validacao` })).statusCode).toBe(403);
    // Nota que consta noutro palete: vínculo antigo encerrado (a ocorrência atual a representa); nada apagado.
    expect(await db.vinculoDocumentoPalete.count({ where: { escopoId: escopo.id, numeroDocumento: '0007950' } })).toBe(2);
    expect(await db.vinculoDocumentoPalete.count({ where: { escopoId: escopo.id, numeroDocumento: '0007950', situacao: 'ATIVO' } })).toBe(1);
    // QR (link pelo ID) inalterado e o identificador legado ainda acha o palete.
    const busca = await como(app, sup, { method: 'GET', url: `${API}/paletes?texto=${encodeURIComponent(antes.codigo)}` });
    expect(busca.json<{ items: { id: string; code: string }[] }>().items.map((p) => [p.id, p.code])).toEqual([[antes.id, '256']]);
    // Repetir o plano: nada mais a trocar nem a mover.
    const novo = await planejarCorrecao(db, escopo.id);
    expect(novo.numeros).toEqual([]);
    expect(novo.vinculos.filter((v) => v.decisao !== 'MANTER')).toEqual([]);
    // Código legado nunca é reutilizado.
    const reusar = await mutar(app, sup, 'POST', `${API}/paletes`, { code: { mode: 'INFORMAR', value: antes.codigo }, positionId: null, notes: null, declaredItems: [] });
    expect(codigoErro(reusar)).toBe('CONFLITO');
  });

  it('posição fixa continua depois da saída do palete; o número que saiu fica no histórico e não é reutilizado', async () => {
    const plano = await planejarCorrecao(db, escopo.id);
    await db.$transaction(async (tx) => aplicarCorrecao(tx, escopo, plano, autor(), new Date(), 'Correção de teste.'));
    // 13 - A105: a única nota foi encerrada (consta em 13 - A107); o palete sai da posição.
    const p105 = await paleteEm('13 - A105');
    expect(await documentos(p105.id)).toEqual([]);
    const { versao } = await db.palete.findUniqueOrThrow({ where: { id: p105.id }, select: { versao: true } });
    // Saída física confirmada (movimento registrado para outra posição): a posição de origem fica e passa a livre.
    const f04p09 = await db.posicao.findFirstOrThrow({ where: { escopoId: escopo.id, codigo: 'F04-P09', layout: { ativo: true } }, select: { id: true } });
    const saida = await mutar(app, sup, 'POST', `${API}/paletes/${p105.id}/movimentos`, { destinationPositionId: f04p09.id, confirmedPositionCode: 'F04-P09', expectedVersion: versao, reason: 'Palete saiu da posição (teste)' });
    expect(saida.statusCode, saida.body).toBe(200);
    const pos = await db.posicao.findUniqueOrThrow({ where: { id: p105.posicaoId ?? '' }, select: { codigo: true, retiradaEm: true, livreConfirmadaEm: true } });
    expect(pos.retiradaEm).toBeNull();
    expect(pos.livreConfirmadaEm).not.toBeNull();
    expect(await db.palete.findUniqueOrThrow({ where: { id: p105.id }, select: { posicaoId: true, codigo: true } })).toMatchObject({ posicaoId: f04p09.id, codigo: p105.codigo });
    // Número do palete que saiu: recusado para outro palete; a numeração nova pula os usados (256, 2, 3 e o que saiu).
    expect(codigoErro(await mutar(app, sup, 'POST', `${API}/paletes`, { code: { mode: 'INFORMAR', value: p105.codigo }, positionId: null, notes: null, declaredItems: [] }))).toBe('CONFLITO');
    expect(codigoErro(await mutar(app, sup, 'POST', `${API}/paletes`, { code: { mode: 'INFORMAR', value: '256' }, positionId: null, notes: null, declaredItems: [] }))).toBe('CONFLITO');
    const previsao = await previsaoNumeroPalete(db, escopo.id);
    expect([1, 2, 3, 256]).not.toContain(previsao);
    // A posição recebe outro palete, com outro número, sem mudar o endereço.
    const novo = await mutar(app, sup, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId: p105.posicaoId, notes: null, declaredItems: [] });
    expect(novo.statusCode, novo.body).toBe(201);
    expect(PaleteDetalheSchema.parse(novo.json()).code).not.toBe(p105.codigo);
    expect(await db.enderecoPosicao.count({ where: { escopoId: escopo.id, endereco: '13 - A105' } })).toBe(1);
  });
});
