import {
  CorrespondenciaEnderecosSchema,
  EstoqueTesteSchema,
  ListaAgendasTesteSchema,
  ListaSolicitacoesTesteSchema,
  PaleteTesteSchema,
  ResultadoLayoutSchema,
  SessaoSchema,
  SolicitacaoTesteSchema,
  VerificacaoTesteSchema,
  type Escopo,
  type PaleteTeste,
  type SolicitacaoTeste,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import type { Banco } from '../../src/db/cliente.js';
import { executarCarga, lerPacote, type PacoteLido } from '../../src/modules/importacao/carga-lote.js';
import { CONFIG_TESTE, appDeTeste, bancoDeTeste, chave, codigoErro, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste, type UsuarioTeste } from './apoio.js';
import { bytesDoPacote, montarPacote, type LinhaTeste } from './pacote-carga.js';

/**
 * "Seleção cliente — teste" contra PostgreSQL real, num escopo operacional
 * criado no teste com inventário fictício (nada do estoque real é usado):
 * palete full, nota de palete misto, 13 volumes de uma nota com 100, Delivery
 * sem volumes discriminados, carrinho com observações, bloqueio depois do
 * envio, pedido de alteração (aprovação, recusa, versões e histórico),
 * solicitação adicional para a mesma agenda, clique repetido no envio e a
 * prova de que nenhuma tabela da operação real muda.
 */
const API = '/api/v1';
const S = `${API}/selecao-teste`;
const CARGA = new Date('2026-10-06T12:00:00Z');

/** Inventário fictício (Fileira 13 confirmada: A101–A133 ímpares). */
const LINHAS: LinhaTeste[] = [
  // 701: palete full (uma nota).
  { linha: 3, tipo: 'NFD', numero: '0007001', remetente: 'Remetente Full', endereco: '13 - A101', volumes: '12', numeroPlanilha: '701' },
  // 702: palete misto (duas notas, uma com Delivery cadastrada).
  { linha: 4, tipo: 'NFD', numero: '0007002', delivery: 'D-02', remetente: 'Remetente Misto B', endereco: '13 - A103', volumes: '6', numeroPlanilha: '702' },
  { linha: 5, tipo: 'NFD', numero: '0007003', remetente: 'Remetente Misto C', endereco: '13 - A103', volumes: '4', numeroPlanilha: '702' },
  // 703: nota com 100 volumes, sem Delivery discriminada.
  { linha: 6, tipo: 'NFD', numero: '0007100', remetente: 'Remetente Cem', endereco: '13 - A105', volumes: '100', numeroPlanilha: '703' },
  // 704: nota sem volumes informados.
  { linha: 7, tipo: 'NFD', numero: '0007004', remetente: 'Remetente Sem Volume', endereco: '13 - A107', volumes: '', numeroPlanilha: '704' },
];

let db: Banco;
let app: FastifyInstance;
let escopo: Escopo;
let supervisor: UsuarioTeste;
let sup: SessaoTeste;
let outroSup: SessaoTeste;
let op: SessaoTeste;
let cli: SessaoTeste;
let janelaId: string;

function pacote(): PacoteLido {
  const r = lerPacote(bytesDoPacote(montarPacote(LINHAS)), 'dados-importacao.json');
  if (!r.ok) throw new Error(`Pacote fictício recusado: ${r.erros.join(' | ')}`);
  return r.pacote;
}

/** O N° Pallet único do endereço é o código do palete criado pela carga (D296). */
async function paleteId(numero: string): Promise<string> {
  const p = await db.palete.findFirstOrThrow({ where: { escopoId: escopo.id, codigo: numero }, select: { id: true } });
  return p.id;
}

async function palete(codigo: string, s: SessaoTeste = sup): Promise<PaleteTeste> {
  const r = await como(app, s, { method: 'GET', url: `${S}/paletes/${await paleteId(codigo)}` });
  expect(r.statusCode, r.body).toBe(200);
  return PaleteTesteSchema.parse(r.json());
}

const ref = (p: PaleteTeste, numero: string) => {
  const c = p.contents.find((x) => x.documentNumber === numero);
  if (!c) throw new Error(`nota ${numero} ausente`);
  return c.ref;
};

async function nova(s: SessaoTeste = sup, agenda: unknown = { reference: 'Agenda teste novembro', date: '2026-11-10' }, extra: Record<string, unknown> = {}): Promise<SolicitacaoTeste> {
  const r = await mutar(app, s, 'POST', `${S}/solicitacoes`, { agenda, ...extra });
  expect([200, 201], r.body).toContain(r.statusCode);
  return SolicitacaoTesteSchema.parse(r.json());
}

async function adicionar(sol: SolicitacaoTeste, corpo: Record<string, unknown>, s: SessaoTeste = sup) {
  return mutar(app, s, 'POST', `${S}/solicitacoes/${sol.id}/itens`, { expectedVersion: sol.version, ...corpo });
}

function ok(r: { statusCode: number; body: string }, status = 200): SolicitacaoTeste {
  expect(r.statusCode, r.body).toBe(status);
  return SolicitacaoTesteSchema.parse(JSON.parse(r.body));
}

/** Fotografia das tabelas da operação real que o teste nunca pode alterar. */
async function fotografia() {
  const contar = async (tabela: string) => Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${tabela}"`))[0]?.n ?? 0);
  const tabelas = [
    'palete',
    'vinculo_documento_palete',
    'conteudo_palete',
    'contagem_volumes',
    'evento_volumes_janela',
    'meta_janela_volumes',
    'reserva_janela',
    'linha_reserva',
    'expedicao',
    'saldo_estoque',
    'evento_estoque',
    'evento_localizacao',
    'endereco_posicao',
    'reconferencia_palete',
    'selecao_cliente',
    'alteracao_planilha',
    'evento_auditoria',
  ];
  const contagens = Object.fromEntries(await Promise.all(tabelas.map(async (t) => [t, await contar(t)] as const)));
  const paletes = await db.palete.findMany({
    where: { escopoId: escopo.id },
    orderBy: { codigo: 'asc' },
    select: { codigo: true, versao: true, estadoFluxo: true, posicaoId: true, estadoConferencia: true, ultimaMovimentacaoEm: true, arquivadoEm: true },
  });
  const vinculos = await db.vinculoDocumentoPalete.findMany({ where: { escopoId: escopo.id }, orderBy: { id: 'asc' }, select: { id: true, situacao: true, volumes: true, delivery: true } });
  const janela = await db.janelaDevolucao.findUniqueOrThrow({ where: { id: janelaId }, select: { versao: true, situacao: true, atualizadoEm: true } });
  return { contagens, paletes, vinculos, janela };
}

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db, { agora: () => new Date(CARGA.getTime() + 60_000) });
  const unidade = await db.unidade.create({ data: { id: randomUUID(), codigo: 'UN-TESTE-SELTESTE', nome: 'Unidade de teste da seleção', demonstracao: false } });
  const cliente = await db.cliente.create({ data: { id: randomUUID(), codigo: 'CLI-TESTE-SELTESTE', nome: 'Cliente fictício', demonstracao: false } });
  const e = await db.escopo.create({ data: { id: randomUUID(), unidadeId: unidade.id, clienteId: cliente.id, nome: 'Praça de teste · seleção', demonstracao: false } });
  escopo = { id: e.id, name: e.nome, unitCode: unidade.codigo, unitName: unidade.nome, clientCode: cliente.codigo, clientName: cliente.nome, demo: false };
  supervisor = await criarUsuario(db, 'supervisor.selteste', [[e.id, 'SUPERVISOR_ESTOQUE']]);
  const outro = await criarUsuario(db, 'supervisor.outro', [[e.id, 'SUPERVISOR_ESTOQUE']]);
  const operador = await criarUsuario(db, 'operador.selteste', [[e.id, 'OPERADOR']]);
  const clienteUsuario = await criarUsuario(db, 'cliente.selteste', [[e.id, 'CLIENTE_CONSULTA']]);
  // Concessão explícita só para os supervisores (responsáveis internos do teste).
  await db.vinculo.updateMany({ where: { escopoId: e.id, usuarioId: { in: [supervisor.id, outro.id] } }, data: { selecaoClienteTeste: true } });
  sup = await entrar(app, supervisor);
  outroSup = await entrar(app, outro);
  op = await entrar(app, operador);
  cli = await entrar(app, clienteUsuario);
  const desenho = await mutar(app, sup, 'POST', `${API}/layout/desenho-aprovado`, {});
  expect(desenho.statusCode, desenho.body).toBe(201);
  const c = CorrespondenciaEnderecosSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/layout/enderecos` })).json());
  const f04 = await db.fileira.findFirstOrThrow({ where: { escopoId: e.id, codigo: 'F04', layout: { ativo: true } }, select: { id: true } });
  const proposta = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${f04.id}/sequencia`, { expectedRevision: c.revision, segments: 'A101-A133/2', direction: 'P01_PRIMEIRO', source: 'Levantamento fictício' });
  expect(proposta.statusCode, proposta.body).toBe(200);
  const confirmar = await mutar(app, sup, 'POST', `${API}/layout/fileiras/${f04.id}/enderecos/confirmar`, { expectedRevision: ResultadoLayoutSchema.parse(proposta.json()).revision, expectedProposed: 17 });
  expect(confirmar.statusCode, confirmar.body).toBe(200);
  await executarCarga(db, escopo, { usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` }, pacote(), { substitui: null, descricao: null }, CARGA);
  const j = await db.janelaDevolucao.create({
    data: {
      id: randomUUID(),
      escopoId: e.id,
      numero: 901,
      codigo: 'JAN-000901',
      nome: 'Janela fictícia de novembro',
      confirmadaEm: CARGA,
      confirmadaPorId: supervisor.id,
      autorizacaoFonte: 'E-mail fictício',
      autorizacaoReferencia: 'REF-FICT',
      autorizacaoData: new Date('2026-10-01T00:00:00Z'),
      autorizacaoResponsavel: 'Contato fictício',
      mesReferencia: new Date('2026-11-01T00:00:00Z'),
      saidaInicio: new Date('2026-11-10T12:00:00Z'),
      saidaFim: new Date('2026-11-11T12:00:00Z'),
      situacao: 'CONFIRMADA',
      criadoPorId: supervisor.id,
      criadoEm: CARGA,
      atualizadoEm: CARGA,
    },
  });
  janelaId = j.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe('acesso', () => {
  it('só com a concessão explícita do vínculo; operador e cliente não acessam; desligada na instalação, as rotas somem', async () => {
    expect(sup.corpo.permissions).toEqual(expect.arrayContaining(['selecao_teste.solicitar', 'selecao_teste.responder']));
    expect(op.corpo.permissions).not.toContain('selecao_teste.solicitar');
    expect(cli.corpo.permissions).not.toContain('selecao_teste.solicitar');
    for (const s of [op, cli]) {
      expect((await como(app, s, { method: 'GET', url: `${S}/estoque` })).statusCode).toBe(403);
      expect((await mutar(app, s, 'POST', `${S}/solicitacoes`, { agenda: { reference: 'Agenda', date: null } })).statusCode).toBe(403);
    }
    // Funcionalidade desligada (SELECAO_CLIENTE_TESTE=desativada): sem rotas e sem permissões, mesmo com a concessão.
    const desligada = await criarApp({ db, config: CONFIG_TESTE, interfaceDir: null, selecaoClienteTeste: false });
    const s = await entrar(desligada, supervisor);
    expect(s.corpo.permissions).not.toContain('selecao_teste.solicitar');
    expect((await como(desligada, s, { method: 'GET', url: `${S}/estoque` })).statusCode).toBe(404);
    await desligada.close();
  });

  it('administração concede só a supervisor ou administrador; o banco recusa a concessão a outro perfil', async () => {
    const admin = await criarUsuario(db, 'admin.selteste', [[escopo.id, 'ADMINISTRADOR']]);
    const adm = await entrar(app, admin);
    const alvo = await criarUsuario(db, 'supervisor.novo', [[escopo.id, 'SUPERVISOR_ESTOQUE']]);
    const r = await mutar(app, adm, 'PUT', `${API}/admin/usuarios/${alvo.id}/vinculo`, { role: 'SUPERVISOR_ESTOQUE', active: true, clientSelectionTest: true });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<{ clientSelectionTest: boolean }>().clientSelectionTest).toBe(true);
    const sessao = SessaoSchema.parse((await como(app, await entrar(app, alvo), { method: 'GET', url: `${API}/sessao` })).json());
    expect(sessao.permissions).toContain('selecao_teste.solicitar');
    const operador = await db.usuario.findFirstOrThrow({ where: { login: 'operador.selteste' }, select: { id: true } });
    const negado = await mutar(app, adm, 'PUT', `${API}/admin/usuarios/${operador.id}/vinculo`, { role: 'OPERADOR', active: true, clientSelectionTest: true });
    expect(negado.statusCode).toBe(400);
    // Mudar para um perfil não elegível retira a concessão.
    const rebaixado = await mutar(app, adm, 'PUT', `${API}/admin/usuarios/${alvo.id}/vinculo`, { role: 'OPERADOR', active: true });
    expect(rebaixado.json<{ clientSelectionTest: boolean }>().clientSelectionTest).toBe(false);
    await expect(db.vinculo.updateMany({ where: { usuarioId: operador.id }, data: { selecaoClienteTeste: true } })).rejects.toThrow();
  });
});

describe('consulta do estoque (só leitura)', () => {
  it('lista pesquisável por palete, tipo + número, remetente e Delivery; janela do palete com full/misto e "mais informações"', async () => {
    const listar = async (texto: string) => {
      const r = await como(app, sup, { method: 'GET', url: `${S}/estoque?texto=${encodeURIComponent(texto)}` });
      expect(r.statusCode, r.body).toBe(200);
      return EstoqueTesteSchema.parse(r.json());
    };
    expect((await listar('')).total).toBe(4);
    expect((await listar('702')).rows.map((r) => r.palletType)).toEqual(['MISTO']);
    const porNota = await listar('NFD 0007100');
    expect(porNota.total).toBe(1);
    expect(porNota.rows[0]?.matches).toHaveLength(1);
    expect((await listar('Remetente Misto C')).rows[0]?.matches).toHaveLength(1);
    expect((await listar('D-02')).total).toBe(1);
    expect((await listar('nada-parecido')).total).toBe(0);

    const misto = await palete('702');
    expect(misto.palletType).toBe('MISTO');
    expect(misto.contents.map((c) => [c.documentNumber, c.delivery, c.volumes])).toEqual([
      ['0007002', 'D-02', 6],
      ['0007003', null, 4],
    ]);
    expect(misto.moreInfo.address).toBe('13 - A103');
    expect(misto.moreInfo.skus).toEqual([]);
    const semVolume = await palete('704');
    expect(semVolume.contents[0]?.volumes).toBeNull();
    const agendas = ListaAgendasTesteSchema.parse((await como(app, sup, { method: 'GET', url: `${S}/agendas` })).json());
    expect(agendas.windows.map((w) => w.code)).toEqual(['JAN-000901']);
  });
});

describe('carrinho', () => {
  it('palete full inteiro, nota de palete misto, 13 de 100 e Delivery sem quantidade discriminada: resumo sem total incompleto', async () => {
    let sol = await nova(sup, { windowId: janelaId });
    expect(sol.agenda).toMatchObject({ kind: 'JANELA', code: 'JAN-000901', date: '2026-11-10' });
    expect(sol.code).toBe('TESTE-000001');

    // Palete full inteiro, com observação do palete.
    const full = await palete('701');
    sol = ok(await adicionar(sol, { palletId: full.palletId, wholePallet: true, note: 'Separar com filme novo' }));
    // Uma nota específica do palete misto (a outra fica no palete).
    const misto = await palete('702');
    sol = ok(await adicionar(sol, { palletId: misto.palletId, wholePallet: false, contents: [{ ref: ref(misto, '0007003'), volumes: 4, delivery: null, note: null }] }));
    // 13 volumes de uma nota com 100 (os outros 87 continuam no estoque).
    const cem = await palete('703');
    sol = ok(await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 13, delivery: '8000123', note: 'Só a Delivery 8000123' }] }));
    // Outra Delivery da mesma nota, sem quantidade conhecida: análise (o total da nota não é atribuído a ela).
    sol = ok(await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: null, delivery: '8000999', note: null }] }));

    expect(sol.items).toHaveLength(4);
    const [itemFull, itemMisto, item13, itemAnalise] = sol.items;
    expect(itemFull).toMatchObject({ scope: 'PALETE', requestedVolumes: 12, needsAnalysis: false, note: 'Separar com filme novo' });
    expect(itemFull?.presented.contents).toHaveLength(1);
    expect(itemMisto).toMatchObject({ scope: 'CONTEUDO', requestedVolumes: 4, needsAnalysis: false, presented: { palletType: 'MISTO', volumes: 4 } });
    expect(item13).toMatchObject({ requestedVolumes: 13, requestedDelivery: '8000123', deliveryNotRegistered: true, needsAnalysis: false, presented: { volumes: 100 }, note: 'Só a Delivery 8000123' });
    expect(itemAnalise).toMatchObject({ requestedVolumes: null, requestedDelivery: '8000999', needsAnalysis: true });
    expect(itemAnalise?.analysisReason).toContain('não discriminados');
    // Total só dos itens com quantidade definida; o item em análise fica fora e é contado à parte.
    expect(sol.totals).toEqual({ items: 4, pallets: 3, definedVolumes: 12 + 4 + 13, itemsInAnalysis: 1 });

    // A Delivery pedida não foi gravada no estoque.
    const vinculo = await db.vinculoDocumentoPalete.findFirstOrThrow({ where: { escopoId: escopo.id, numeroDocumento: '0007100' }, select: { delivery: true } });
    expect(vinculo.delivery).toBeNull();
  });

  it('quantidade válida: inteira, até o informado; várias Deliveries da mesma nota não passam do total; nota sem volume vai para análise', async () => {
    let sol = await nova();
    const cem = await palete('703');
    const acima = await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 101, delivery: null, note: null }] });
    expect(acima.statusCode).toBe(409);
    expect(codigoErro(acima)).toBe('QUANTIDADE_INDISPONIVEL');
    const fracao = await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 2.5, delivery: null, note: null }] });
    expect(fracao.statusCode).toBe(400);
    const semQuantidade = await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: null, delivery: null, note: null }] });
    expect(semQuantidade.statusCode).toBe(400);
    sol = ok(await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 60, delivery: 'A', note: null }] }));
    const soma = await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 41, delivery: 'B', note: null }] });
    expect(codigoErro(soma)).toBe('QUANTIDADE_INDISPONIVEL');
    sol = ok(await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 40, delivery: 'B', note: null }] }));
    const repetida = await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 1, delivery: 'a', note: null }] });
    expect(codigoErro(repetida)).toBe('SELECAO_DUPLICADA');

    const sem = await palete('704');
    sol = ok(await adicionar(sol, { palletId: sem.palletId, wholePallet: false, contents: [{ ref: ref(sem, '0007004'), volumes: 3, delivery: null, note: null }] }));
    expect(sol.items.at(-1)).toMatchObject({ requestedVolumes: 3, needsAnalysis: true });
    expect(sol.totals).toMatchObject({ definedVolumes: 100, itemsInAnalysis: 1 });
    // Palete inteiro com nota sem volume: sem total presumido.
    const outra = await nova(sup, { reference: 'Outra agenda', date: null });
    const inteiro = ok(await adicionar(outra, { palletId: sem.palletId, wholePallet: true }));
    expect(inteiro.items[0]).toMatchObject({ requestedVolumes: null, needsAnalysis: true });
    expect(inteiro.totals).toMatchObject({ definedVolumes: 0, itemsInAnalysis: 1 });
  });

  it('palete inteiro e notas do mesmo palete não convivem: conflito explicado e troca explícita', async () => {
    let sol = await nova();
    const misto = await palete('702');
    sol = ok(await adicionar(sol, { palletId: misto.palletId, wholePallet: false, contents: [{ ref: ref(misto, '0007002'), volumes: 6, delivery: null, note: null }] }));
    const conflito = await adicionar(sol, { palletId: misto.palletId, wholePallet: true });
    expect(conflito.statusCode).toBe(409);
    expect(codigoErro(conflito)).toBe('SELECAO_DUPLICADA');
    expect(conflito.json<{ error: { message: string } }>().error.message).toContain('contar os volumes duas vezes');
    sol = ok(await adicionar(sol, { palletId: misto.palletId, wholePallet: true, replace: true }));
    expect(sol.items.map((i) => i.scope)).toEqual(['PALETE']);
    expect(sol.totals.definedVolumes).toBe(10);
    const nota = await adicionar(sol, { palletId: misto.palletId, wholePallet: false, contents: [{ ref: ref(misto, '0007003'), volumes: 4, delivery: null, note: null }] });
    expect(codigoErro(nota)).toBe('SELECAO_DUPLICADA');
    const duplicado = await adicionar(sol, { palletId: misto.palletId, wholePallet: true });
    expect(codigoErro(duplicado)).toBe('SELECAO_DUPLICADA');
  });

  it('ajustar quantidade e observação, remover item, versão desatualizada recusada; outro usuário não edita', async () => {
    let sol = await nova(sup, { reference: 'Agenda teste novembro', date: '2026-11-10' }, { note: 'Agenda de teste' });
    const cem = await palete('703');
    sol = ok(await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 13, delivery: null, note: null }] }));
    const item = sol.items[0];
    if (!item) throw new Error('sem item');
    const antiga = sol.version;
    sol = ok(await mutar(app, sup, 'PATCH', `${S}/solicitacoes/${sol.id}/itens/${item.id}`, { expectedVersion: sol.version, volumes: 20, note: 'Caixas com avaria à parte' }));
    expect(sol.items[0]).toMatchObject({ requestedVolumes: 20, note: 'Caixas com avaria à parte' });
    const desatualizada = await mutar(app, sup, 'PATCH', `${S}/solicitacoes/${sol.id}/itens/${item.id}`, { expectedVersion: antiga, volumes: 5 });
    expect(codigoErro(desatualizada)).toBe('CONFLITO_VERSAO');
    const alheio = await mutar(app, outroSup, 'PATCH', `${S}/solicitacoes/${sol.id}/itens/${item.id}`, { expectedVersion: sol.version, volumes: 5 });
    expect(alheio.statusCode).toBe(403);
    sol = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/itens/${item.id}/remocao`, { expectedVersion: sol.version }));
    expect(sol.items).toHaveLength(0);
    expect(sol.history.map((h) => h.text).join(' | ')).toContain('Retirado');
    // Voltar à tela com a mesma agenda continua o mesmo carrinho.
    expect((await nova()).id).toBe(sol.id);
  });
});

describe('envio e acompanhamento', () => {
  it('envio registra a versão 1 com o apresentado e o solicitado; depois, edição bloqueada também no servidor', async () => {
    let sol = await nova(sup, { windowId: janelaId });
    const full = await palete('701');
    sol = ok(await adicionar(sol, { palletId: full.palletId, wholePallet: true, note: 'Prioridade na doca 2' }));
    sol = ok(await mutar(app, sup, 'PATCH', `${S}/solicitacoes/${sol.id}`, { expectedVersion: sol.version, note: 'Pedido de teste com uma observação geral' }));
    const enviado = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version }), 201);
    expect(enviado).toMatchObject({ status: 'ENVIADA', sentVersion: 1, note: 'Pedido de teste com uma observação geral' });
    expect(enviado.versions).toHaveLength(1);
    expect(enviado.versions[0]?.items[0]).toMatchObject({ scope: 'PALETE', requestedVolumes: 12, note: 'Prioridade na doca 2', atSend: { volumes: 12 } });
    expect(enviado.can).toEqual({ edit: false, send: false, requestChange: true, respond: false });
    const item = enviado.items[0];
    if (!item) throw new Error('sem item');
    const tentativas = [
      await adicionar(enviado, { palletId: (await palete('702')).palletId, wholePallet: true }),
      await mutar(app, sup, 'PATCH', `${S}/solicitacoes/${sol.id}/itens/${item.id}`, { expectedVersion: enviado.version, note: 'mudar' }),
      await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/itens/${item.id}/remocao`, { expectedVersion: enviado.version }),
      await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: enviado.version }),
    ];
    for (const t of tentativas) expect(codigoErro(t)).toBe('SOLICITACAO_BLOQUEADA');
    const lista = ListaSolicitacoesTesteSchema.parse((await como(app, sup, { method: 'GET', url: `${S}/solicitacoes` })).json());
    expect(lista.items[0]).toMatchObject({ code: 'TESTE-000001', status: 'ENVIADA', totals: { definedVolumes: 12 } });
  });

  it('clique repetido no envio: a mesma chave devolve o mesmo resultado; outra chave é recusada; uma única versão', async () => {
    let sol = await nova();
    sol = ok(await adicionar(sol, { palletId: (await palete('701')).palletId, wholePallet: true }));
    const k = chave();
    const [a, b] = await Promise.all([
      mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version }, k),
      mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version }, k),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(JSON.parse(a.body)).toEqual(JSON.parse(b.body));
    const outraChave = await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version });
    expect(outraChave.statusCode).toBe(409);
    expect(await db.versaoSelecaoTeste.count({ where: { solicitacaoId: sol.id } })).toBe(1);
  });

  it('estoque mudou antes do envio: mostra a diferença, não troca a quantidade e só envia depois da revisão', async () => {
    let sol = await nova();
    const cem = await palete('703');
    sol = ok(await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 90, delivery: null, note: null }] }));
    // A operação reconta a nota: agora 80 volumes (dado da operação, fora do teste).
    const vinculo = await db.vinculoDocumentoPalete.findFirstOrThrow({ where: { escopoId: escopo.id, numeroDocumento: '0007100' }, select: { id: true, paleteId: true } });
    await db.contagemVolumes.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        paleteId: vinculo.paleteId,
        vinculoId: vinculo.id,
        volumesContados: 80,
        origem: 'CONTAGEM_FISICA',
        registradaPorId: supervisor.id,
        registradaEm: new Date(CARGA.getTime() + 30_000),
      },
    });
    const envio = await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version });
    expect(envio.statusCode).toBe(409);
    expect(codigoErro(envio)).toBe('DADOS_ALTERADOS');
    const v = VerificacaoTesteSchema.parse((await como(app, sup, { method: 'GET', url: `${S}/solicitacoes/${sol.id}/verificacao` })).json());
    expect(v.differences).toHaveLength(1);
    expect(v.differences[0]).toMatchObject({ before: '100', now: '80', blocking: true, refreshable: true });
    // Usar os dados atuais não muda a quantidade pedida: o pedido de 90 continua acima e precisa de ajuste.
    sol = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/atualizacao-dados`, { expectedVersion: sol.version, itemIds: [sol.items[0]?.id] }));
    expect(sol.items[0]).toMatchObject({ requestedVolumes: 90, presented: { volumes: 80 } });
    expect(codigoErro(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version }))).toBe('DADOS_ALTERADOS');
    sol = ok(await mutar(app, sup, 'PATCH', `${S}/solicitacoes/${sol.id}/itens/${sol.items[0]?.id ?? ''}`, { expectedVersion: sol.version, volumes: 80 }));
    const enviado = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version }), 201);
    expect(enviado.versions[0]?.items[0]).toMatchObject({ requestedVolumes: 80, presented: { volumes: 80 }, atSend: { volumes: 80, volumesBasis: 'CONTADO' } });
  });

  it('pedido de alteração: recusa (nada muda), aprovação libera a revisão; versão 1 preservada; histórico completo', async () => {
    let sol = await nova();
    const misto = await palete('702');
    sol = ok(await adicionar(sol, { palletId: misto.palletId, wholePallet: false, contents: [{ ref: ref(misto, '0007002'), volumes: 6, delivery: null, note: null }] }));
    sol = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version }), 201);

    expect((await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/alteracoes`, { reason: 'curt' })).statusCode).toBe(400);
    sol = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/alteracoes`, { reason: 'Faltou selecionar 10 notas' }), 201);
    expect(sol.status).toBe('ALTERACAO_SOLICITADA');
    // O pedido sozinho não altera a seleção.
    expect(sol.items).toHaveLength(1);
    expect(codigoErro(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/alteracoes`, { reason: 'Outro pedido em seguida' }))).toBe('SITUACAO_INVALIDA');
    const pendente = sol.changeRequests[0];
    if (!pendente) throw new Error('sem pedido');
    // Recusa: volta a enviada, sem nova versão.
    sol = ok(await mutar(app, outroSup, 'POST', `${S}/solicitacoes/${sol.id}/alteracoes/${pendente.id}/resposta`, { decision: 'RECUSAR', response: 'Agenda já fechada para inclusão' }));
    expect(sol).toMatchObject({ status: 'ENVIADA', sentVersion: 1 });
    expect(sol.changeRequests[0]).toMatchObject({ status: 'RECUSADA', response: 'Agenda já fechada para inclusão', respondedBy: { login: 'supervisor.outro' } });
    expect(codigoErro(await mutar(app, outroSup, 'POST', `${S}/solicitacoes/${sol.id}/alteracoes/${pendente.id}/resposta`, { decision: 'APROVAR', response: 'Mudei de ideia' }))).toBe('SITUACAO_INVALIDA');

    // Novo pedido, aprovado: revisão controlada.
    sol = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/alteracoes`, { reason: 'Faltou a nota 0007003 do mesmo palete' }), 201);
    const segundo = sol.changeRequests[1];
    if (!segundo) throw new Error('sem segundo pedido');
    sol = ok(await mutar(app, outroSup, 'POST', `${S}/solicitacoes/${sol.id}/alteracoes/${segundo.id}/resposta`, { decision: 'APROVAR', response: 'Pode incluir até amanhã' }));
    expect(sol.status).toBe('EM_REVISAO');
    expect(sol.items).toHaveLength(1);
    sol = ok(await adicionar(sol, { palletId: misto.palletId, wholePallet: false, contents: [{ ref: ref(misto, '0007003'), volumes: 4, delivery: null, note: 'Incluída na revisão' }] }));
    sol = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version }), 201);
    expect(sol).toMatchObject({ status: 'ENVIADA', sentVersion: 2 });
    expect(sol.versions.map((v) => [v.number, v.totals.definedVolumes, v.items.length, v.changeRequestId])).toEqual([
      [1, 6, 1, null],
      [2, 10, 2, segundo.id],
    ]);
    expect(sol.changeRequests.map((c) => [c.status, c.resultingVersion])).toEqual([
      ['RECUSADA', null],
      ['APROVADA', 2],
    ]);
    const historico = sol.history.map((h) => h.text).join(' | ');
    for (const trecho of ['Enviada (versão 1)', 'Faltou selecionar 10 notas', 'recusada', 'aprovada', 'Revisão enviada (versão 2)']) expect(historico).toContain(trecho);
    // A versão 1 gravada não pode ser reescrita nem apagada.
    await expect(db.versaoSelecaoTeste.updateMany({ where: { solicitacaoId: sol.id, numero: 1 }, data: { totalVolumes: 0 } })).rejects.toThrow(/SELECAO_TESTE_IMUTAVEL/);
  });

  it('solicitação adicional para a mesma agenda: separada, com aviso do mesmo conteúdo em outro pedido (sem bloquear outra Delivery)', async () => {
    let primeira = await nova(sup, { windowId: janelaId });
    const cem = await palete('703');
    primeira = ok(await adicionar(primeira, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 13, delivery: 'D-1', note: null }] }));
    primeira = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${primeira.id}/envio`, { expectedVersion: primeira.version }), 201);

    let adicional = await nova(sup, { windowId: janelaId });
    expect(adicional.id).not.toBe(primeira.id);
    expect(adicional.code).toBe('TESTE-000002');
    adicional = ok(await adicionar(adicional, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 20, delivery: 'D-2', note: 'Complemento' }] }));
    expect(adicional.items[0]?.otherRequests).toEqual([expect.objectContaining({ code: 'TESTE-000001', status: 'ENVIADA' })]);
    expect(adicional.items[0]?.otherRequests[0]?.detail).toContain('13 volumes');
    // Rascunho seu existente: "solicitação adicional" explícita cria mais uma.
    const terceira = await nova(sup, { windowId: janelaId }, { additional: true });
    expect(terceira.code).toBe('TESTE-000003');
  });
});

describe('processo real intacto', () => {
  it('consultar, montar, enviar, pedir alteração e responder não baixam, não reservam e não mudam paletes, notas, agenda nem a planilha', async () => {
    const antes = await fotografia();
    let sol = await nova(sup, { windowId: janelaId });
    const full = await palete('701');
    const cem = await palete('703');
    sol = ok(await adicionar(sol, { palletId: full.palletId, wholePallet: true }));
    sol = ok(await adicionar(sol, { palletId: cem.palletId, wholePallet: false, contents: [{ ref: ref(cem, '0007100'), volumes: 13, delivery: '8000123', note: 'Teste' }] }));
    sol = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version }), 201);
    sol = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/alteracoes`, { reason: 'Faltou selecionar 10 notas' }), 201);
    const pedido = sol.changeRequests[0];
    if (!pedido) throw new Error('sem pedido');
    sol = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/alteracoes/${pedido.id}/resposta`, { decision: 'APROVAR', response: 'Pode revisar' }));
    sol = ok(await mutar(app, sup, 'POST', `${S}/solicitacoes/${sol.id}/envio`, { expectedVersion: sol.version }), 201);
    await como(app, sup, { method: 'GET', url: `${S}/estoque?texto=7100` });
    await como(app, sup, { method: 'GET', url: `${S}/solicitacoes/${sol.id}/verificacao` });
    expect(await fotografia()).toEqual(antes);
  });
});
