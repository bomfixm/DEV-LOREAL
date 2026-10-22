import {
  CorrespondenciaEnderecosSchema,
  EstoqueClienteSchema,
  HistoricoClienteSchema,
  LinhasJanelaClienteSchema,
  PainelClienteSchema,
  PainelOperacaoSchema,
  ResultadoLayoutSchema,
  ResultadoVolumesSchema,
  VolumesJanelaSchema,
  type EstoqueCliente,
  type Escopo,
  type PainelOperacao,
  type VolumesJanela,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { executarCarga, lerPacote, type PacoteLido } from '../../src/modules/importacao/carga-lote.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, chave, codigoErro, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste, type UsuarioTeste } from './apoio.js';
import { bytesDoPacote, montarPacote, type LinhaTeste } from './pacote-carga.js';

/**
 * Painéis da operação DHL e do cliente contra PostgreSQL real, num escopo
 * operacional criado no teste (dados fictícios): janela em VOLUMES (meta,
 * separação, expedição e estorno por NF × palete), estoque atual sem dupla
 * contagem, projeção do cliente sem dados internos (JSON e CSV), escopo e
 * escritas negadas, filtros × totais e reconferência de 20 dias persistida.
 */
const API = '/api/v1';
const CARGA = new Date('2026-10-06T12:00:00Z');
const DIA = 24 * 60 * 60 * 1000;

class RelogioAjustavel {
  atual = new Date(CARGA.getTime() + DIA);
  readonly agora = (): Date => new Date(this.atual.getTime());
}

let db: Banco;
let app: FastifyInstance;
let relogio: RelogioAjustavel;
let escopo: Escopo;
let supervisor: UsuarioTeste;
let sup: SessaoTeste;
let op: SessaoTeste;
let cli: SessaoTeste;
let clienteUsuario: UsuarioTeste;

/** Inventário fictício (linha 1 = título; 2 = cabeçalho). Fileira 13 confirmada: A101–A133 ímpares. */
const LINHAS: LinhaTeste[] = [
  { linha: 3, tipo: 'NFD', numero: '0003001', delivery: 'D-01', remetente: 'Remetente Misto A', endereco: '13 - A101', volumes: '10', numeroPlanilha: '601' },
  { linha: 4, tipo: 'NFD', numero: '0003002', delivery: 'D-02', remetente: 'Remetente Misto B', endereco: '13 - A101', volumes: '6', numeroPlanilha: '601' },
  { linha: 5, tipo: 'NFD', numero: '0003003', remetente: 'Remetente C', endereco: '13 - A103', volumes: '4', numeroPlanilha: '602' },
  { linha: 6, tipo: 'NFD', numero: '0003003', remetente: 'Remetente C', endereco: '13 - A105', volumes: '5', numeroPlanilha: '603' },
  { linha: 7, tipo: 'NFD', numero: '0003004', remetente: 'Remetente D', endereco: '13 - A107', volumes: '3', numeroPlanilha: '604' },
  { linha: 8, tipo: 'NFD', numero: '0003004', remetente: 'Remetente E', endereco: '13 - A109', volumes: '2', numeroPlanilha: '605' },
  { linha: 9, tipo: 'NFD', numero: '0003006', remetente: 'Remetente F', endereco: '13 - A111', volumes: '', numeroPlanilha: '606' },
  { linha: 10, tipo: 'NFD', numero: '0009000', remetente: 'Remetente G', endereco: '13 - A113', volumes: '9000', numeroPlanilha: '607' },
  { linha: 11, tipo: 'NFD', numero: '0003007', remetente: '=SOMA(1;2)', endereco: '13 - A115', volumes: '1', numeroPlanilha: '608' },
  { linha: 12, tipo: 'NFD', numero: '0003005', remetente: 'Remetente H', endereco: '', volumes: '7' },
];

function pacote(): PacoteLido {
  const r = lerPacote(bytesDoPacote(montarPacote(LINHAS)), 'dados-importacao.json');
  if (!r.ok) throw new Error(`Pacote fictício recusado: ${r.erros.join(' | ')}`);
  return r.pacote;
}

const carregar = () => executarCarga(db, escopo, { usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` }, pacote(), { substitui: null, descricao: null }, CARGA);

async function vinculo(numero: string, remetente?: string): Promise<{ id: string; paleteId: string; palete: string }> {
  const v = await db.vinculoDocumentoPalete.findFirstOrThrow({
    where: { escopoId: escopo.id, numeroDocumento: numero, situacao: 'ATIVO', ...(remetente ? { linhaInventario: { remetente } } : {}) },
    select: { id: true, paleteId: true, palete: { select: { codigo: true } } },
  });
  return { id: v.id, paleteId: v.paleteId, palete: v.palete.codigo };
}

let numeroJanela = 0;
/** Janela confirmada (fixture com autorização fictícia); `rotulo` só identifica no nome. */
async function janela(rotulo: string, alvo: string = escopo.id): Promise<string> {
  numeroJanela += 1;
  const numero = 900 + numeroJanela;
  const j = await db.janelaDevolucao.create({
    data: {
      id: randomUUID(),
      escopoId: alvo,
      numero,
      codigo: `JAN-${String(numero).padStart(6, '0')}`,
      nome: `Janela fictícia ${rotulo}`,
      confirmadaEm: CARGA,
      confirmadaPorId: supervisor.id,
      autorizacaoFonte: 'E-mail fictício',
      autorizacaoReferencia: 'REF-FICT',
      autorizacaoData: new Date('2026-10-01T00:00:00Z'),
      autorizacaoResponsavel: 'Contato fictício',
      mesReferencia: new Date('2026-10-01T00:00:00Z'),
      saidaInicio: new Date('2026-10-20T12:00:00Z'),
      saidaFim: new Date('2026-10-21T12:00:00Z'),
      situacao: 'CONFIRMADA',
      criadoPorId: supervisor.id,
      criadoEm: CARGA,
      atualizadoEm: CARGA,
    },
  });
  return j.id;
}

interface LinhaSel {
  abrangencia: 'PALETE' | 'DOCUMENTO';
  tipo?: string;
  numero?: string;
  palete?: string;
  quantidade?: string;
  unidade?: string;
}

let numeroSelecao = 0;
/** Seleção do cliente como gravada pela importação (fixture: lote + seleção + linhas). */
async function selecao(referencia: string, versao: number, linhas: readonly LinhaSel[], substitui: string | null = null): Promise<{ id: string; linhas: string[] }> {
  const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
  const n = linhas.length;
  const lote = await db.loteImportacao.create({
    data: {
      id: randomUUID(),
      escopoId: escopo.id,
      tipo: 'SELECAO_CLIENTE',
      situacao: 'CONFIRMADO',
      formato: 'CSV',
      nomeArquivo: `selecao-${referencia}-${String(versao)}.csv`,
      hashArquivo: hash(),
      tamanhoBytes: 10,
      versaoPrevia: 1,
      assinaturaPrevia: hash(),
      previaGeradaEm: CARGA,
      opcoes: {},
      colunas: {},
      separadorDecimal: 'VIRGULA',
      parametros: {},
      totalLinhas: n,
      validasNovas: n,
      gravadas: n,
      resultado: {},
      confirmadoEm: CARGA,
      confirmadoPorId: supervisor.id,
    },
  });
  if (substitui) await db.selecaoCliente.update({ where: { id: substitui }, data: { situacao: 'SUBSTITUIDA' } });
  const id = randomUUID();
  numeroSelecao += 1;
  await db.selecaoCliente.create({
    data: {
      id,
      escopoId: escopo.id,
      numero: numeroSelecao,
      codigo: `SEL-${String(numeroSelecao).padStart(6, '0')}`,
      referenciaPedido: referencia,
      versaoPedido: versao,
      modalidade: 'LISTA',
      loteImportacaoId: lote.id,
      parametros: {},
      situacao: 'REGISTRADA',
      substituiId: substitui,
      totalLinhas: linhas.length,
      linhasExcluidas: 0,
      criadoPorId: supervisor.id,
      criadoEm: new Date(CARGA.getTime() + 60_000),
    },
  });
  const ids: string[] = [];
  for (const [i, l] of linhas.entries()) {
    const idLinha = randomUUID();
    ids.push(idLinha);
    await db.linhaSelecao.create({
      data: {
        id: idLinha,
        escopoId: escopo.id,
        selecaoId: id,
        linhaArquivo: i + 2,
        abrangencia: l.abrangencia,
        regraAbrangencia: 'coluna',
        paleteReferencia: l.palete ?? null,
        tipoDocumento: l.tipo ?? null,
        numeroDocumento: l.numero ?? null,
        chaveDocumento: l.numero ? `${l.tipo ?? ''}|${l.numero}` : null,
        quantidade: l.quantidade ?? null,
        unidade: l.unidade ?? null,
        lidos: {},
        chave: `${referencia}-${String(i)}`,
      },
    });
  }
  return { id, linhas: ids };
}

async function meta(janelaId: string, volumes: number, selectionId: string | null = null, s: SessaoTeste = sup) {
  const r = await mutar(app, s, 'POST', `${API}/janelas/${janelaId}/volumes/meta`, { volumes, selectionId, reference: 'E-mail fictício' });
  expect(r.statusCode, r.body).toBe(201);
  return ResultadoVolumesSchema.parse(r.json());
}

async function separar(janelaId: string, linkId: string, volumes: number, extra: { selectionLineId?: string } = {}, s: SessaoTeste = op, chaveIdem: string = chave()) {
  return mutar(app, s, 'POST', `${API}/janelas/${janelaId}/volumes/separacoes`, { linkId, volumes, ...extra }, chaveIdem);
}

async function expedir(janelaId: string, linkId: string, volumes: number, s: SessaoTeste = sup) {
  return mutar(app, s, 'POST', `${API}/janelas/${janelaId}/volumes/expedicoes`, { items: [{ linkId, volumes }] });
}

async function volumes(janelaId: string): Promise<VolumesJanela> {
  const r = await como(app, sup, { method: 'GET', url: `${API}/janelas/${janelaId}/volumes` });
  expect(r.statusCode, r.body).toBe(200);
  return VolumesJanelaSchema.parse(r.json());
}

async function painel(s: SessaoTeste = sup): Promise<PainelOperacao> {
  const r = await como(app, s, { method: 'GET', url: `${API}/painel/operacao` });
  expect(r.statusCode, r.body).toBe(200);
  return PainelOperacaoSchema.parse(r.json());
}

async function estoque(consulta: string, s: SessaoTeste = cli, rota = 'painel/cliente/estoque'): Promise<EstoqueCliente> {
  const r = await como(app, s, { method: 'GET', url: `${API}/${rota}${consulta ? `?${consulta}` : ''}` });
  expect(r.statusCode, r.body).toBe(200);
  return EstoqueClienteSchema.parse(r.json());
}

const ok = (r: { statusCode: number; body: string }) => expect(r.statusCode, r.body).toBe(201);

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  relogio = new RelogioAjustavel();
  app = await appDeTeste(db, { agora: relogio.agora });
  const unidade = await db.unidade.create({ data: { id: randomUUID(), codigo: 'UN-TESTE-PAINEL', nome: 'Unidade de teste dos painéis', demonstracao: false } });
  const cliente = await db.cliente.create({ data: { id: randomUUID(), codigo: 'CLI-TESTE-PAINEL', nome: 'Cliente fictício', demonstracao: false } });
  const e = await db.escopo.create({ data: { id: randomUUID(), unidadeId: unidade.id, clienteId: cliente.id, nome: 'Praça de teste · Cliente fictício', demonstracao: false } });
  escopo = { id: e.id, name: e.nome, unitCode: unidade.codigo, unitName: unidade.nome, clientCode: cliente.codigo, clientName: cliente.nome, demo: false };
  supervisor = await criarUsuario(db, 'supervisor.painel', [[e.id, 'SUPERVISOR_ESTOQUE']]);
  const operador = await criarUsuario(db, 'operador.painel', [[e.id, 'OPERADOR']]);
  clienteUsuario = await criarUsuario(db, 'cliente.consulta', [[e.id, 'CLIENTE_CONSULTA']]);
  sup = await entrar(app, supervisor);
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
  await carregar();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('estoque atual (painel da operação)', () => {
  it('palete conta uma vez; NF em dois paletes é um documento; mesmo número com remetentes distintos são dois; NF sem palete aparece para resolução', async () => {
    const p = await painel();
    expect(p.stock.activePallets).toBe(8);
    expect(p.stock.contents).toBe(9);
    // 0003001, 0003002, 0003003 (dois paletes), 0003004 × 2 remetentes, 0003006, 0009000, 0003007.
    expect(p.stock.documents).toBe(8);
    expect(p.stock.mixedPallets).toBe(1);
    expect(p.stock.volumes).toMatchObject({ informed: 9031, informedCoverage: { known: 8, total: 9 }, counted: 0, current: 9031, currentCoverage: { known: 8, total: 9 }, shipped: 0 });
    expect(p.location.documentsWithoutPallet).toBe(1);
    expect(p.tasks.items.some((t) => t.kind === 'NF_SEM_PALETE' && t.label.includes('0003005'))).toBe(true);
    expect(p.positions).toMatchObject({ occupied: 8 });
    expect(p.positions?.unknown).toBe((p.positions?.active ?? 0) - 8);
    expect(p.byStreet.reduce((t, r) => t + r.pallets, 0)).toBe(p.stock.activePallets);

    const nf = await estoque('documento=0003003');
    expect(nf.total).toBe(2);
    expect(nf.totals).toMatchObject({ volumes: 9, pallets: 2, documents: 1 });
    const mesmoNumero = await estoque('documento=0003004');
    expect(mesmoNumero.totals).toMatchObject({ volumes: 5, pallets: 2, documents: 2 });
  });

  it('cards e lista usam a mesma definição: total do card = soma das linhas; filtros por rua, palete e situação', async () => {
    const p = await painel();
    const lista = await estoque('', sup, 'painel/operacao/estoque');
    expect(lista.totals.volumes).toBe(p.stock.volumes.current);
    expect(lista.totals.pallets).toBe(p.stock.activePallets);
    expect(lista.totals.documents).toBe(p.stock.documents);
    const rua = p.byStreet[0];
    if (!rua) throw new Error('sem rua');
    const daRua = await estoque(`rua=${encodeURIComponent(rua.street)}`, sup, 'painel/operacao/estoque');
    expect(daRua.totals.pallets).toBe(rua.pallets);
    expect(daRua.totals.volumes).toBe(rua.volumes);
    expect((await estoque('situacao=misto', sup, 'painel/operacao/estoque')).total).toBe(2);
    expect((await estoque('situacao=sem-endereco', sup, 'painel/operacao/estoque')).total).toBe(0);
    const semVolume = await estoque('situacao=sem-volume');
    expect(semVolume.rows.map((r) => r.documentNumber)).toEqual(['0003006']);
    expect(semVolume.rows[0]?.volumes).toBeNull();
    expect(semVolume.totals.volumesCoverage).toEqual({ known: 0, total: 1 });
  });
});

describe('janela em volumes', () => {
  it('exemplo fictício 8.000 / 2.000 / 4.500 e expedição de mais 1.000 (P → E na mesma operação)', async () => {
    const j = await janela('JAN-8000');
    const grande = await vinculo('0009000');
    await meta(j, 8000);
    ok(await separar(j, grande.id, 4000));
    ok(await separar(j, grande.id, 2500));
    ok(await expedir(j, grande.id, 2000));
    let v = await volumes(j);
    expect(v.window.progress).toMatchObject({ requested: 8000, separatedWaiting: 4500, shipped: 2000, prepared: 6500, missingToSeparate: 1500, missingToShip: 6000, preparationPercent: '81.25', shippingPercent: '25.00' });

    ok(await expedir(j, grande.id, 1000));
    v = await volumes(j);
    expect(v.window.progress).toMatchObject({ separatedWaiting: 3500, shipped: 3000, prepared: 6500, missingToSeparate: 1500, missingToShip: 5000 });
    // Painel interno e do cliente mostram os mesmos números.
    const p = await painel();
    expect(p.windows.find((x) => x.id === j)?.progress).toMatchObject({ separatedWaiting: 3500, shipped: 3000 });
    const c = PainelClienteSchema.parse((await como(app, cli, { method: 'GET', url: `${API}/painel/cliente` })).json());
    expect(c.windows.find((x) => x.id === j)?.progress).toMatchObject({ requested: 8000, separatedWaiting: 3500, shipped: 3000, missingToShip: 5000 });

    // Não expede mais que o separado aguardando; não separa além da base (9.000) somando todas as janelas.
    expect(codigoErro(await expedir(j, grande.id, 3501))).toBe('CONFLITO');
    const outra = await janela('JAN-OUTRA');
    expect(codigoErro(await separar(outra, grande.id, 2501))).toBe('CONFLITO');
    ok(await separar(outra, grande.id, 2500));
    // Estoque atual desconta o expedido (contado/informado − expedido).
    expect((await estoque('documento=0009000')).totals.volumes).toBe(6000);
  });

  it('palete misto: escolher uma NF mantém as demais no estoque e disponíveis para outra janela', async () => {
    const j1 = await janela('JAN-MISTO-1');
    const a = await vinculo('0003001');
    const b = await vinculo('0003002');
    expect(a.paleteId).toBe(b.paleteId);
    const s = await selecao('PED-1', 1, [{ abrangencia: 'DOCUMENTO', tipo: 'NFD', numero: '0003001' }]);
    await meta(j1, 10, s.id);
    let v = await volumes(j1);
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0]).toMatchObject({ stage: 'LOCALIZADA', requested: 10, separatedWaiting: 0, shipped: 0, pallets: [{ code: a.palete, address: '13 - A101' }] });
    ok(await separar(j1, a.id, 10, { selectionLineId: s.linhas[0] ?? '' }));
    ok(await expedir(j1, a.id, 10));
    v = await volumes(j1);
    expect(v.lines[0]).toMatchObject({ stage: 'EXPEDIDA', shipped: 10 });
    const doPalete = await estoque(`palete=${encodeURIComponent(a.palete)}`);
    expect(doPalete.rows.map((r) => [r.documentNumber, r.volumes])).toEqual([['0003002', 6]]);
    expect(doPalete.rows[0]?.palletType).toBe('MISTO');
    const j2 = await janela('JAN-MISTO-2');
    ok(await separar(j2, b.id, 6));
    expect(codigoErro(await separar(j2, a.id, 1))).toBe('CONFLITO');
  });

  it('pedido menor que a NF: representa a parte pedida e o restante separadamente', async () => {
    const j = await janela('JAN-PARTE');
    const s = await selecao('PED-PARTE', 1, [{ abrangencia: 'DOCUMENTO', tipo: 'NFD', numero: '0003003', quantidade: '3', unidade: 'volumes' }]);
    await meta(j, 3, s.id);
    const v = await volumes(j);
    expect(v.lines[0]).toMatchObject({ requested: 3, locatedVolumes: 9, remainder: 6 });
    expect(v.lines[0]?.pallets).toHaveLength(2);
    expect(v.window.selectedSum).toBe(3);
    expect(v.window.goalDifference).toBeNull();
  });

  it('seleção, importação e reserva sem preparação real não contam como separados nem expedidos', async () => {
    const j = await janela('JAN-SEM-PREP');
    const s = await selecao('PED-2', 1, [
      { abrangencia: 'DOCUMENTO', tipo: 'NFD', numero: '0003003' },
      { abrangencia: 'PALETE', palete: (await vinculo('0003004', 'Remetente D')).palete },
    ]);
    await meta(j, 100, s.id);
    await db.palete.updateMany({ where: { escopoId: escopo.id, codigo: (await vinculo('0003003')).palete }, data: { estadoFluxo: 'RESERVADO' } });
    const v = await volumes(j);
    expect(v.window.progress).toMatchObject({ requested: 100, separatedWaiting: 0, shipped: 0, prepared: 0, preparationPercent: '0.00', shippingPercent: '0.00' });
    expect(v.window.stages).toMatchObject({ lines: 2, located: 2, inSeparation: 0, separated: 0, shipped: 0 });
    // Meta 100 × soma selecionada (9 + 3): diferença registrada para revisão interna, nada é corrigido.
    expect(v.window.selectedSum).toBe(12);
    expect(v.window.goalDifference).toBe(88);
    expect((await painel()).stock.volumes.current).toBe(9031);
  });

  it('reenvio, revisão da seleção e correção não duplicam atendimento nem descartam histórico', async () => {
    const j = await janela('JAN-REV');
    const a = await vinculo('0003001');
    const s1 = await selecao('PED-3', 1, [{ abrangencia: 'DOCUMENTO', tipo: 'NFD', numero: '0003001' }]);
    await meta(j, 10, s1.id);
    const k = chave();
    const r1 = await separar(j, a.id, 8, { selectionLineId: s1.linhas[0] ?? '' }, op, k);
    const r2 = await separar(j, a.id, 8, { selectionLineId: s1.linhas[0] ?? '' }, op, k);
    ok(r1);
    expect(r2.statusCode).toBe(r1.statusCode);
    expect(r2.json()).toEqual(r1.json());
    expect(await db.eventoVolumesJanela.count({ where: { janelaId: j } })).toBe(1);

    // Reenvio do mesmo pacote de inventário: nada muda nos números da janela nem no estoque.
    await carregar();
    expect((await volumes(j)).window.progress).toMatchObject({ separatedWaiting: 8, shipped: 0 });

    // Correção: estorno parcial com motivo, evento próprio ligado ao corrigido.
    const evento = ResultadoVolumesSchema.parse(r1.json()).events[0] ?? '';
    const est = await mutar(app, op, 'POST', `${API}/janelas/${j}/volumes/estornos`, { eventId: evento, volumes: 3, reason: 'Contagem fictícia corrigida no teste' });
    ok(est);
    let v = await volumes(j);
    expect(v.window.progress).toMatchObject({ separatedWaiting: 5, prepared: 5 });
    expect(v.events.map((e) => e.type).sort()).toEqual(['ESTORNO_SEPARACAO', 'SEPARACAO']);
    expect(v.events.find((e) => e.type === 'SEPARACAO')?.reversible).toBe(5);

    // Nova versão da seleção: a meta aponta a versão substituída → revisão; atendimento não duplica.
    const s2 = await selecao('PED-3', 2, [{ abrangencia: 'DOCUMENTO', tipo: 'NFD', numero: '0003001' }, { abrangencia: 'DOCUMENTO', tipo: 'NFD', numero: '0003002' }], s1.id);
    v = await volumes(j);
    expect(v.goals[0]?.selection?.superseded).toBe(true);
    expect(v.window.needsReview).toBe(true);
    expect(v.reviewNotes.length).toBeGreaterThan(0);
    expect(v.lines).toHaveLength(2);
    expect(v.window.progress).toMatchObject({ separatedWaiting: 5, shipped: 0 });
    // Linha da versão substituída não recebe nova separação.
    expect(codigoErro(await separar(j, a.id, 1, { selectionLineId: s1.linhas[0] ?? '' }))).toBe('CONFLITO');
    await meta(j, 16, s2.id);
    ok(await separar(j, a.id, 1, { selectionLineId: s2.linhas[0] ?? '' }));
    // Histórico do cliente mostra a correção sem somar duas vezes.
    const h = HistoricoClienteSchema.parse((await como(app, cli, { method: 'GET', url: `${API}/painel/cliente/historico?janela=${j}` })).json());
    expect(h.events.map((e) => [e.type, e.volumes, e.correction])).toEqual(
      expect.arrayContaining([
        ['SEPARACAO', 8, false],
        ['ESTORNO_SEPARACAO', 3, true],
        ['SEPARACAO', 1, false],
      ]),
    );
  });

  it('dados incompletos, meta zero e quantidade sem base não produzem porcentagem', async () => {
    const sem = await vinculo('0003006');
    const j = await janela('JAN-INC');
    const r = await separar(j, sem.id, 1);
    expect(codigoErro(r)).toBe('CONFLITO');
    expect(r.body).toContain('volumes não informados');
    let v = await volumes(j);
    expect(v.window.progress).toMatchObject({ requested: null, preparationPercent: null, shippingPercent: null, missingToSeparate: null, basisNote: 'Sem meta informada' });
    await meta(j, 0);
    v = await volumes(j);
    expect(v.window.progress).toMatchObject({ requested: 0, preparationPercent: null, shippingPercent: null, basisNote: 'Sem base para cálculo' });
    // Linha em unidade não comparável (caixas) não vira volumes.
    const s = await selecao('PED-CX', 1, [{ abrangencia: 'DOCUMENTO', tipo: 'NFD', numero: '0003002', quantidade: '2', unidade: 'CX' }]);
    await meta(j, 2, s.id);
    v = await volumes(j);
    expect(v.lines[0]?.requested).toBeNull();
    expect(v.window.selectedSum).toBeNull();
  });
});

describe('projeção do cliente e permissões', () => {
  it('cliente vê só estoque, janelas e histórico permitidos: nada interno no JSON nem nas exportações', async () => {
    const j = await janela('JAN-CLI');
    const a = await vinculo('0003001');
    await meta(j, 5000);
    ok(await separar(j, a.id, 10));
    const ev = ResultadoVolumesSchema.parse((await expedir(j, a.id, 4)).json()).events[0] ?? '';
    ok(await mutar(app, sup, 'POST', `${API}/janelas/${j}/volumes/estornos`, { eventId: ev, volumes: 1, reason: 'Justificativa interna fictícia XYZ' }));
    const respostas = [
      await como(app, cli, { method: 'GET', url: `${API}/painel/cliente` }),
      await como(app, cli, { method: 'GET', url: `${API}/painel/cliente/estoque` }),
      await como(app, cli, { method: 'GET', url: `${API}/painel/cliente/historico` }),
      await como(app, cli, { method: 'GET', url: `${API}/painel/cliente/janelas/${j}` }),
      await como(app, cli, { method: 'GET', url: `${API}/painel/cliente/estoque/exportar` }),
      await como(app, cli, { method: 'GET', url: `${API}/painel/cliente/historico/exportar` }),
    ];
    for (const r of respostas) {
      expect(r.statusCode, r.body).toBe(200);
      for (const proibido of ['claims', 'values', 'excess', 'goalDifference', 'selectedSum', 'needsReview', 'reviewNotes', 'reason', 'supervisor.painel', 'operador.painel', 'Justificativa interna', 'Usuário ']) {
        expect(r.body, proibido).not.toContain(proibido);
      }
    }
    const painelCli = PainelClienteSchema.parse(respostas[0]?.json());
    expect(painelCli.stock).toMatchObject({ pallets: 8, documents: 8 });
    expect(EstoqueClienteSchema.parse(respostas[1]?.json()).rows.every((x) => x.palletId === null)).toBe(true);
    LinhasJanelaClienteSchema.parse(respostas[3]?.json());
    // CSV: fórmula neutralizada e códigos como texto (zeros à esquerda).
    const csv = respostas[4]?.body ?? '';
    expect(respostas[4]?.headers['content-type']).toContain('text/csv');
    expect(csv).toContain(`"'=SOMA(1;2)"`);
    expect(csv).toContain('"0003002"');
    expect(respostas[5]?.body).toContain('Correção de expedição');
    // A visão interna (supervisor com claim.consultar) recebe claims; a do cliente, não.
    expect((await painel()).claims).not.toBeNull();
    expect((await painel(op)).claims).toBeNull();
  });

  it('outro escopo e escritas operacionais negadas ao cliente; login, sessão e logout continuam', async () => {
    const jDemo = await janela('JAN-DEMO', ID_ESCOPO_PRACA);
    const j = await janela('JAN-PROPRIA');
    const a = await vinculo('0003001');
    expect((await como(app, cli, { method: 'GET', url: `${API}/painel/cliente/janelas/${jDemo}` })).statusCode).toBe(404);
    expect((await como(app, cli, { method: 'GET', url: `${API}/painel/cliente/historico?janela=${jDemo}` })).statusCode).toBe(404);
    expect((await como(app, cli, { method: 'GET', url: `${API}/painel/cliente/estoque?janela=${jDemo}` })).statusCode).toBe(404);
    for (const url of ['/painel/operacao', '/painel/operacao/estoque', `/janelas/${j}/volumes`, '/praca', '/paletes', `/paletes/${a.paleteId}`, '/janelas', '/claims', '/indicadores']) {
      const r = await como(app, cli, { method: 'GET', url: `${API}${url}` });
      expect(r.statusCode, url).toBe(403);
    }
    expect(codigoErro(await mutar(app, cli, 'POST', `${API}/janelas/${j}/volumes/meta`, { volumes: 1 }))).toBe('ACESSO_NEGADO');
    expect(codigoErro(await separar(j, a.id, 1, {}, cli))).toBe('ACESSO_NEGADO');
    expect(codigoErro(await expedir(j, a.id, 1, cli))).toBe('ACESSO_NEGADO');
    expect(codigoErro(await mutar(app, cli, 'POST', `${API}/paletes/${a.paleteId}/conteudos`, { sender: 'X' }))).toBe('ACESSO_NEGADO');
    expect((await mutar(app, cli, 'PUT', `${API}/sessao/escopo`, { scopeId: ID_ESCOPO_PRACA })).statusCode).toBeGreaterThanOrEqual(403);
    // Operador separa, mas não registra meta nem confirma expedição.
    expect(codigoErro(await mutar(app, op, 'POST', `${API}/janelas/${j}/volumes/meta`, { volumes: 1 }))).toBe('ACESSO_NEGADO');
    expect(codigoErro(await expedir(j, a.id, 1, op))).toBe('ACESSO_NEGADO');
    // Sessão do cliente: consulta e saída normais.
    expect((await como(app, cli, { method: 'GET', url: `${API}/sessao` })).statusCode).toBe(200);
    const sair = await como(app, cli, { method: 'DELETE', url: `${API}/sessao` });
    expect(sair.statusCode).toBeLessThan(300);
    expect((await como(app, cli, { method: 'GET', url: `${API}/painel/cliente` })).statusCode).toBe(401);
    cli = await entrar(app, clienteUsuario);
    expect((await como(app, cli, { method: 'GET', url: `${API}/painel/cliente` })).statusCode).toBe(200);
  });

  it('estoque do cliente filtrado pela janela mostra a etapa de cada NF; atualização após operação', async () => {
    const j = await janela('JAN-ETAPA');
    const a = await vinculo('0003001');
    const s = await selecao('PED-4', 1, [{ abrangencia: 'DOCUMENTO', tipo: 'NFD', numero: '0003001' }, { abrangencia: 'DOCUMENTO', tipo: 'NFD', numero: '0003003' }]);
    await meta(j, 19, s.id);
    let lista = await estoque(`janela=${j}`);
    expect(lista.rows.map((r) => [r.documentNumber, r.windowStage]).sort()).toEqual([
      ['0003001', 'LOCALIZADA'],
      ['0003003', 'LOCALIZADA'],
      ['0003003', 'LOCALIZADA'],
    ]);
    ok(await separar(j, a.id, 4));
    lista = await estoque(`janela=${j}`);
    expect(lista.rows.find((r) => r.documentNumber === '0003001')?.windowStage).toBe('EM_SEPARACAO');
    const c = PainelClienteSchema.parse((await como(app, cli, { method: 'GET', url: `${API}/painel/cliente` })).json());
    expect(c.windows.find((x) => x.id === j)?.stages).toMatchObject({ lines: 2, inSeparation: 1, located: 1 });
  });
});

describe('reconferência de 20 dias no painel interno', () => {
  it('usa o relógio persistido do palete (não a data de criação/importação como chegada física)', async () => {
    // Data de criação antiga não vence a reconferência: vale o relógio persistido.
    const a = await vinculo('0003001');
    await db.$executeRaw`UPDATE palete SET criado_em = '2025-01-01T00:00:00Z' WHERE id = ${a.paleteId}::uuid`;
    let p = await painel();
    expect(p.reconference.due).toBe(0);
    expect(p.reconference.nextDueAt).toBe(new Date(CARGA.getTime() + 20 * DIA).toISOString());
    relogio.atual = new Date(CARGA.getTime() + 20 * DIA);
    // Sessões têm duração máxima: entra de novo no "dia seguinte".
    sup = await entrar(app, supervisor);
    cli = await entrar(app, clienteUsuario);
    p = await painel();
    expect(p.reconference.due).toBe(8);
    expect(p.tasks.totals.reconference).toBe(8);
    const r = await mutar(app, sup, 'POST', `${API}/paletes/${a.paleteId}/reconferencias`, { wholePallet: true, result: 'SEM_DIFERENCA', notes: null });
    expect(r.statusCode, r.body).toBe(201);
    p = await painel();
    expect(p.reconference.due).toBe(7);
    expect(p.tasks.items.filter((t) => t.kind === 'RECONFERENCIA').map((t) => t.palletCode)).not.toContain(a.palete);
    const lista = await estoque('situacao=reconferencia', sup, 'painel/operacao/estoque');
    expect(lista.totals.pallets).toBe(7);
    // Histórico: "Entrada registrada no sistema" (não é recebimento físico).
    const h = HistoricoClienteSchema.parse((await como(app, cli, { method: 'GET', url: `${API}/painel/cliente/historico?palete=${encodeURIComponent(a.palete)}` })).json());
    expect(h.events.map((e) => e.type)).toEqual(expect.arrayContaining(['ENTRADA_REGISTRADA', 'RECONFERENCIA']));
  });
});
