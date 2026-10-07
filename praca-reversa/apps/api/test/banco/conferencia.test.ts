import {
  ConferenciaDetalheSchema,
  HistoricoConferenciasSchema,
  ListaPaletesSchema,
  ListaProdutosSchema,
  PaleteDetalheSchema,
  PracaSchema,
  PreviaReconciliacaoSchema,
  ProdutoSchema,
  ResultadoObservacaoSchema,
  ResultadoReconciliacaoSchema,
  type ConferenciaDetalhe,
  type EmbalagemProduto,
  type Produto,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import {
  ID_ESCOPO_NAVEGACAO,
  ID_ESCOPO_PRACA,
  appDeTeste,
  bancoDeTeste,
  chave,
  como,
  codigoErro,
  criarUsuario,
  entrar,
  idPosicao,
  mutar,
  prepararDados,
  type SessaoTeste,
  type UsuarioTeste,
} from './apoio.js';
import { reservarPelaApi } from './janelas-apoio.js';

const API = '/api/v1';
let db: Banco;
let app: FastifyInstance;
let sSup: SessaoTeste;
let sSup2: SessaoTeste;
let sOp: SessaoTeste;
let sOp2: SessaoTeste;
let sCons: SessaoTeste;
let sAdmin: SessaoTeste;
let sNavOp: SessaoTeste;
let sNavSup: SessaoTeste;
let operador: UsuarioTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const usuarios = await Promise.all([
    criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'supervisor2', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'operador', [[ID_ESCOPO_PRACA, 'OPERADOR']]),
    criarUsuario(db, 'operador2', [[ID_ESCOPO_PRACA, 'OPERADOR']]),
    criarUsuario(db, 'consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]),
    criarUsuario(db, 'admin', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]),
    criarUsuario(db, 'nav.operador', [[ID_ESCOPO_NAVEGACAO, 'OPERADOR']]),
    criarUsuario(db, 'nav.supervisor', [[ID_ESCOPO_NAVEGACAO, 'SUPERVISOR_ESTOQUE']]),
  ]);
  const [supervisor, supervisor2, op, operador2, consulta, admin, navOperador, navSupervisor] = usuarios;
  operador = op;
  [sSup, sSup2, sOp, sOp2, sCons, sAdmin, sNavOp, sNavSup] = await Promise.all([
    entrar(app, supervisor),
    entrar(app, supervisor2),
    entrar(app, op),
    entrar(app, operador2),
    entrar(app, consulta),
    entrar(app, admin),
    entrar(app, navOperador),
    entrar(app, navSupervisor),
  ]);
});

afterAll(async () => {
  await db.$disconnect();
});

// ---------- Apoio ----------

async function criarProduto(sku: string, barcodes: EmbalagemProduto[] = [], canonicalUnit = 'UN'): Promise<Produto> {
  const r = await mutar(app, sSup, 'POST', `${API}/produtos`, { sku, description: `Produto ${sku}`, canonicalUnit, active: true, barcodes });
  expect(r.statusCode, r.body).toBe(201);
  return ProdutoSchema.parse(r.json());
}

interface Declarada {
  sku: string | null;
  description?: string | null;
  lot?: string | null;
  originType?: 'DEVOLUCAO' | 'NOTA_FISCAL' | 'MANIFESTO' | 'OUTRO' | null;
  originReference?: string | null;
  quantity: string;
  unit: string;
}

async function criarPalete(declaradas: Declarada[] = [], posicao: string | null = null) {
  const positionId = posicao === null ? null : await idPosicao(db, ID_ESCOPO_PRACA, posicao);
  const declaredItems = declaradas.map((d) => ({ description: null, lot: null, originType: null, originReference: null, ...d }));
  const r = await mutar(app, sOp, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId, notes: null, declaredItems });
  expect(r.statusCode, r.body).toBe(201);
  return PaleteDetalheSchema.parse(r.json());
}

async function palete(id: string, s: SessaoTeste = sCons) {
  const r = await como(app, s, { method: 'GET', url: `${API}/paletes/${id}` });
  expect(r.statusCode, r.body).toBe(200);
  return PaleteDetalheSchema.parse(r.json());
}

async function ler(id: string, s: SessaoTeste = sCons): Promise<ConferenciaDetalhe> {
  const r = await como(app, s, { method: 'GET', url: `${API}/conferencias/${id}` });
  expect(r.statusCode, r.body).toBe(200);
  return ConferenciaDetalheSchema.parse(r.json());
}

async function iniciar(paleteId: string, scope: 'PARCIAL' | 'COMPLETA' = 'COMPLETA', s: SessaoTeste = sOp, descricao: string | null = null) {
  const p = await palete(paleteId);
  return mutar(app, s, 'POST', `${API}/paletes/${paleteId}/conferencias`, {
    scope,
    scopeDescription: descricao ?? (scope === 'PARCIAL' ? 'Camada superior' : null),
    expectedVersion: p.version,
  });
}

async function iniciarOk(paleteId: string, scope: 'PARCIAL' | 'COMPLETA' = 'COMPLETA', s: SessaoTeste = sOp, descricao: string | null = null) {
  const r = await iniciar(paleteId, scope, s, descricao);
  expect(r.statusCode, r.body).toBe(201);
  return ConferenciaDetalheSchema.parse(r.json());
}

const base = { condition: 'SAUDAVEL' } as const;

function entrada(sessaoId: string, corpo: object, s: SessaoTeste = sOp, chaveIdem: string = chave()) {
  return mutar(app, s, 'POST', `${API}/conferencias/${sessaoId}/observacoes`, { ...base, ...corpo }, chaveIdem);
}

async function entradaOk(sessaoId: string, corpo: object, s: SessaoTeste = sOp) {
  const r = await entrada(sessaoId, corpo, s);
  expect(r.statusCode, r.body).toBe(201);
  return ResultadoObservacaoSchema.parse(r.json());
}

/** Quantidade manual na unidade canônica. */
const manual = (productId: string, quantity: string, extra: object = {}) => ({ mode: 'MANUAL', productId, quantity, unit: 'UN', ...extra });

async function concluir(sessaoId: string, s: SessaoTeste = sOp, confirmar = true, chaveIdem: string = chave()) {
  const d = await ler(sessaoId);
  return mutar(
    app,
    s,
    'POST',
    `${API}/conferencias/${sessaoId}/concluir`,
    { expectedRevision: d.revision, expectedPalletVersion: d.pallet.version, confirmFullScope: confirmar },
    chaveIdem,
  );
}

async function concluirOk(sessaoId: string, s: SessaoTeste = sOp) {
  const r = await concluir(sessaoId, s);
  expect(r.statusCode, r.body).toBe(200);
  return ConferenciaDetalheSchema.parse(r.json());
}

async function reconciliar(sessaoId: string, s: SessaoTeste = sSup, chaveIdem: string = chave(), justificativa = 'Contagem revisada pelo supervisor') {
  const d = await ler(sessaoId);
  return mutar(app, s, 'POST', `${API}/conferencias/${sessaoId}/reconciliar`, { expectedPalletVersion: d.pallet.version, justification: justificativa }, chaveIdem);
}

async function reconciliarOk(sessaoId: string, s: SessaoTeste = sSup) {
  const r = await reconciliar(sessaoId, s);
  expect(r.statusCode, r.body).toBe(200);
  return ResultadoReconciliacaoSchema.parse(r.json());
}

async function contar(paleteId: string) {
  return {
    eventos: await db.eventoEstoque.count({ where: { paleteId } }),
    linhas: await db.linhaEventoEstoque.count({ where: { paleteId } }),
    saldos: await db.saldoEstoque.count({ where: { paleteId } }),
    auditoria: await db.eventoAuditoria.count({ where: { acao: 'CONFERENCIA_RECONCILIADA' } }),
    idempotencia: await db.registroIdempotencia.count({ where: { operacao: 'conferencia.reconciliar' } }),
  };
}

// ---------- T02: desconhecido continua desconhecido ----------

describe('palete não conferido', () => {
  it('mapa, lista e detalhe mostram conteúdo desconhecido, sem zero nem saldo inventado (T02)', async () => {
    const novo = await criarPalete([], 'F03-P01');
    const praca = PracaSchema.parse((await como(app, sCons, { method: 'GET', url: `${API}/praca` })).json());
    expect(praca.pallets.find((p) => p.id === novo.id)).toMatchObject({ countState: 'NAO_CONFERIDO', activeCountId: null });
    const lista = ListaPaletesSchema.parse((await como(app, sCons, { method: 'GET', url: `${API}/paletes?texto=${novo.code}` })).json());
    expect(lista.items.map((p) => [p.code, p.countState])).toEqual([[novo.code, 'NAO_CONFERIDO']]);
    for (const id of [novo.id, '00000000-0000-4000-8000-000000000002']) {
      const d = await palete(id);
      expect([d.countState, d.currentItems, d.observedCounts, d.lastReconciliation]).toEqual(['NAO_CONFERIDO', null, [], null]);
    }
    // Iniciar a conferência não muda o conteúdo: continua desconhecido até concluir/validar.
    const sessao = await iniciarOk(novo.id);
    const durante = await palete(novo.id);
    expect([durante.countState, durante.currentItems, durante.activeCountId]).toEqual(['NAO_CONFERIDO', null, sessao.id]);
    const praca2 = PracaSchema.parse((await como(app, sCons, { method: 'GET', url: `${API}/praca` })).json());
    expect(praca2.pallets.find((p) => p.id === novo.id)?.activeCountId).toBe(sessao.id);
  });
});

// ---------- Início, rascunho e cancelamento ----------

describe('iniciar, guardar rascunho e cancelar', () => {
  it('registra palete, escopo, responsável, horários e versões; parcial exige descrição', async () => {
    const p = await criarPalete();
    const semDescricao = await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/conferencias`, { scope: 'PARCIAL', scopeDescription: null, expectedVersion: p.version });
    expect(semDescricao.statusCode).toBe(400);
    const desatualizada = await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: p.version + 1 });
    expect([desatualizada.statusCode, codigoErro(desatualizada)]).toEqual([409, 'CONFLITO_VERSAO']);
    const s = await iniciarOk(p.id, 'PARCIAL', sOp, 'Somente a camada de cima');
    expect(s).toMatchObject({
      number: 1,
      palletId: p.id,
      scope: 'PARCIAL',
      scopeDescription: 'Somente a camada de cima',
      kind: 'CONFERENCIA',
      state: 'EM_ANDAMENTO',
      revision: 1,
      initialPalletVersion: p.version,
      responsible: { login: 'operador' },
      comparison: null,
    });
    const linha = await db.sessaoConferencia.findUniqueOrThrow({ where: { id: s.id } });
    expect([linha.escopoId, linha.versaoSaldoInicial, linha.ativa]).toEqual([ID_ESCOPO_PRACA, 1, true]);
    expect(await db.eventoAuditoria.count({ where: { acao: 'CONFERENCIA_INICIADA', alvoId: s.id } })).toBe(1);
  });

  it('duas pessoas iniciando ao mesmo tempo criam uma única conferência; não bloqueia outros paletes', async () => {
    const p = await criarPalete();
    const outro = await criarPalete();
    const v = (await palete(p.id)).version;
    const corpo = { scope: 'COMPLETA', expectedVersion: v };
    const respostas = await Promise.all(
      [sOp, sOp2, sSup, sOp, sOp2, sSup].map((s) => mutar(app, s, 'POST', `${API}/paletes/${p.id}/conferencias`, corpo)),
    );
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await db.sessaoConferencia.count({ where: { paleteId: p.id } })).toBe(1);
    // A proteção é por palete: outro palete inicia normalmente.
    await iniciarOk(outro.id, 'COMPLETA', sOp2);
  });

  it('rascunho fica no servidor e é retomado depois de reiniciar a API (nova instância e novo cliente do banco)', async () => {
    const produto = await criarProduto('0001001');
    const p = await criarPalete();
    const s = await iniciarOk(p.id);
    await entradaOk(s.id, manual(produto.id, '3', { lot: '000L1' }));
    const r2 = await entradaOk(s.id, manual(produto.id, '2'));
    expect(r2.session.revision).toBe(3);
    await app.close();

    const db2 = bancoDeTeste();
    const app2 = await appDeTeste(db2);
    try {
      const sessao2 = await entrar(app2, operador);
      const retomada = ConferenciaDetalheSchema.parse((await como(app2, sessao2, { method: 'GET', url: `${API}/conferencias/${s.id}` })).json());
      expect(retomada.state).toBe('EM_ANDAMENTO');
      expect(retomada.revision).toBe(3);
      expect(retomada.updatedAt).toBe(r2.session.updatedAt);
      expect(retomada.lines.map((l) => [l.quantity, l.lot])).toEqual([
        ['3', '000L1'],
        ['2', null],
      ]);
      const detalhe = PaleteDetalheSchema.parse((await como(app2, sessao2, { method: 'GET', url: `${API}/paletes/${p.id}` })).json());
      expect(detalhe.activeCount?.id).toBe(s.id);
    } finally {
      await app2.close();
      await db2.$disconnect();
      app = await appDeTeste(db);
    }
  });

  it('cancelar exige motivo e permissão, preserva histórico e libera o palete', async () => {
    const produto = await criarProduto('CANC-1');
    const p = await criarPalete();
    const s = await iniciarOk(p.id);
    await entradaOk(s.id, manual(produto.id, '4'));
    const atual = await ler(s.id);
    const semMotivo = await mutar(app, sOp, 'POST', `${API}/conferencias/${s.id}/cancelar`, { expectedRevision: atual.revision, reason: '' });
    expect(semMotivo.statusCode).toBe(400);
    // Outro operador não cancela a conferência de quem iniciou; supervisor pode.
    const outro = await mutar(app, sOp2, 'POST', `${API}/conferencias/${s.id}/cancelar`, { expectedRevision: atual.revision, reason: 'Palete errado' });
    expect(outro.statusCode).toBe(403);
    const cancelada = await mutar(app, sOp, 'POST', `${API}/conferencias/${s.id}/cancelar`, { expectedRevision: atual.revision, reason: 'Palete errado' });
    expect(cancelada.statusCode, cancelada.body).toBe(200);
    const d = ConferenciaDetalheSchema.parse(cancelada.json());
    expect(d).toMatchObject({ state: 'CANCELADA', cancelReason: 'Palete errado', cancelledBy: { login: 'operador' } });
    expect(d.lines).toHaveLength(1);
    // Nada mais entra na sessão cancelada; o palete pode receber nova conferência.
    expect((await entrada(s.id, manual(produto.id, '1'))).statusCode).toBe(409);
    const nova = await iniciarOk(p.id);
    expect(nova.number).toBe(2);
    const historico = HistoricoConferenciasSchema.parse((await como(app, sCons, { method: 'GET', url: `${API}/paletes/${p.id}/conferencias` })).json());
    expect(historico.sessions.map((x) => [x.number, x.state])).toEqual([
      [2, 'EM_ANDAMENTO'],
      [1, 'CANCELADA'],
    ]);
    // O banco não deixa apagar sessão nem observação.
    await expect(db.$executeRawUnsafe(`DELETE FROM observacao_conferencia WHERE sessao_id = '${s.id}'`)).rejects.toThrow(/OBSERVACAO_IMUTAVEL/);
    await expect(db.$executeRawUnsafe(`DELETE FROM sessao_conferencia WHERE id = '${s.id}'`)).rejects.toThrow(/CONFERENCIA_IMUTAVEL/);
  });
});

// ---------- Observações: leitura, unidade, embalagem e pendências ----------

describe('observações', () => {
  it('duas leituras deliberadas somam duas peças; reenviar a mesma ação não soma de novo', async () => {
    await criarProduto('000777', [{ code: '0007890000777', packaging: 'UN', factor: '1' }]);
    const p = await criarPalete();
    const s = await iniciarOk(p.id);
    const leitura = { mode: 'LEITURA_UNIDADE', code: '0007890000777' };
    const k1 = chave();
    const primeira = await entrada(s.id, leitura, sOp, k1);
    expect(primeira.statusCode, primeira.body).toBe(201);
    expect((await entrada(s.id, leitura)).statusCode).toBe(201);
    // Mesma ação reenviada (clique duplo, resposta perdida): resultado original, sem nova linha.
    const repetida = await entrada(s.id, leitura, sOp, k1);
    expect([repetida.statusCode, repetida.headers['idempotency-replayed']]).toEqual([201, 'true']);
    expect(repetida.json()).toEqual(primeira.json());
    // Envios simultâneos com a mesma chave: uma linha só.
    const k2 = chave();
    const simultaneos = await Promise.all([1, 2, 3, 4].map(() => entrada(s.id, leitura, sOp, k2)));
    expect(simultaneos.every((r) => r.statusCode === 201)).toBe(true);
    // Mesma chave com outro pedido: rejeitada.
    const outro = await entrada(s.id, { ...leitura, lot: 'L9' }, sOp, k1);
    expect([outro.statusCode, codigoErro(outro)]).toEqual([422, 'IDEMPOTENCIA_CONFLITO']);
    const d = await ler(s.id);
    expect(d.lines).toHaveLength(3);
    expect(d.totals.map((t) => [t.sku, t.quantity, t.unit, t.lines])).toEqual([['000777', '3', 'UN', 3]]);
    expect(d.lines.every((l) => l.codeRead === '0007890000777' && l.entryMode === 'LEITURA_UNIDADE')).toBe(true);
  });

  it('caixa com fator 12 converte exatamente e guarda o fator; código de caixa no modo unidade é recusado (T06)', async () => {
    await criarProduto('0000123', [
      { code: '0007891234567', packaging: 'UN', factor: '1' },
      { code: '00017891234564', packaging: 'CX', factor: '12' },
    ]);
    const p = await criarPalete();
    const s = await iniciarOk(p.id);
    const caixa = await entradaOk(s.id, { mode: 'LEITURA_EMBALAGEM', code: '00017891234564' });
    expect(caixa.line).toMatchObject({ quantity: '1', unit: 'CX', factor: '12', canonicalQuantity: '12', canonicalUnit: 'UN', pending: null, sku: '0000123' });
    const doisManuais = await entradaOk(s.id, { mode: 'MANUAL', code: '00017891234564', quantity: '2', unit: 'CX' });
    expect([doisManuais.line.canonicalQuantity, doisManuais.line.factor]).toEqual(['24', '12']);
    const noModoUnidade = await entrada(s.id, { mode: 'LEITURA_UNIDADE', code: '00017891234564' });
    expect([noModoUnidade.statusCode, codigoErro(noModoUnidade)]).toEqual([422, 'MODO_INCOMPATIVEL']);
    // Embalagens inteiras; peças inteiras.
    expect((await entrada(s.id, { mode: 'MANUAL', code: '00017891234564', quantity: '1.5', unit: 'CX' })).statusCode).toBe(400);
    expect((await entrada(s.id, { mode: 'MANUAL', code: '0007891234567', quantity: '2.5', unit: 'UN' })).statusCode).toBe(400);
    // O fator fica na linha: mudar o cadastro depois não altera a observação.
    const [produto] = ListaProdutosSchema.parse((await como(app, sCons, { method: 'GET', url: `${API}/produtos?texto=0000123` })).json()).items;
    if (!produto) throw new Error('Produto não encontrado.');
    const r = await mutar(app, sSup, 'PUT', `${API}/produtos/${produto.id}`, {
      expectedVersion: produto.version,
      description: produto.description,
      canonicalUnit: 'UN',
      active: true,
      barcodes: [{ code: '00017891234564', packaging: 'CX', factor: '24' }],
    });
    expect(r.statusCode, r.body).toBe(200);
    const d = await ler(s.id);
    expect(d.lines.map((l) => [l.factor, l.canonicalQuantity])).toEqual([
      ['12', '12'],
      ['12', '24'],
    ]);
    expect(d.totals.map((t) => t.quantity)).toEqual(['36']);
  });

  it('fator desconhecido bloqueia a conversão; código não cadastrado vira pendência sem inventar SKU (T07)', async () => {
    await criarProduto('000456', [
      { code: '0007890000456', packaging: 'UN', factor: '1' },
      { code: '0017890000456', packaging: 'CX', factor: null },
    ]);
    const p = await criarPalete();
    const s = await iniciarOk(p.id);
    const bloqueada = await entrada(s.id, { mode: 'LEITURA_EMBALAGEM', code: '0017890000456' });
    expect([bloqueada.statusCode, codigoErro(bloqueada)]).toEqual([422, 'CONVERSAO_DESCONHECIDA']);
    const semFator = await entradaOk(s.id, { mode: 'LEITURA_EMBALAGEM', code: '0017890000456', registerAsPending: true });
    expect(semFator.line).toMatchObject({ pending: 'FATOR_DESCONHECIDO', factor: null, canonicalQuantity: null, quantity: '1', unit: 'CX', sku: '000456' });
    const unidadeSemCadastro = await entrada(s.id, { mode: 'MANUAL', code: '0007890000456', quantity: '3', unit: 'PCT' });
    expect([unidadeSemCadastro.statusCode, codigoErro(unidadeSemCadastro)]).toEqual([422, 'CONVERSAO_DESCONHECIDA']);
    // Código não cadastrado: recusado na leitura; pendência explícita no manual, com zeros preservados.
    const desconhecido = await entrada(s.id, { mode: 'LEITURA_UNIDADE', code: '0000999000' });
    expect([desconhecido.statusCode, codigoErro(desconhecido)]).toEqual([422, 'CODIGO_NAO_CADASTRADO']);
    const identificar = await como(app, sOp, { method: 'GET', url: `${API}/produtos/identificar?codigo=0000999000` });
    expect([identificar.statusCode, codigoErro(identificar)]).toEqual([404, 'CODIGO_NAO_CADASTRADO']);
    const pendente = await entradaOk(s.id, {
      mode: 'MANUAL',
      code: '0000999000',
      quantity: '2',
      unit: 'CX',
      registerAsPending: true,
      lot: '0042',
      originType: 'NOTA_FISCAL',
      originReference: '000123',
    });
    expect(pendente.line).toMatchObject({
      pending: 'PRODUTO_NAO_IDENTIFICADO',
      productId: null,
      sku: null,
      codeRead: '0000999000',
      lot: '0042',
      originReference: '000123',
      canonicalQuantity: null,
    });
    const d = await ler(s.id);
    expect(d.totals).toEqual([]);
    expect(d.pending.map((x) => x.kind).sort()).toEqual(['FATOR_DESCONHECIDO', 'PRODUTO_NAO_IDENTIFICADO']);
    // Nenhum produto foi criado ou associado por semelhança.
    expect(await db.produto.count({ where: { escopoId: ID_ESCOPO_PRACA, sku: { contains: '999' } } })).toBe(0);

    // Concluir é possível; reconciliar fica bloqueado pelas pendências.
    await concluirOk(s.id);
    const previa = PreviaReconciliacaoSchema.parse((await como(app, sSup, { method: 'GET', url: `${API}/conferencias/${s.id}/reconciliacao` })).json());
    expect(previa.allowed).toBe(false);
    expect(previa.blockers.join(' ')).toMatch(/2 observação\(ões\) pendente/);
    const r = await reconciliar(s.id);
    expect([r.statusCode, codigoErro(r)]).toEqual([409, 'CONFLITO']);
    expect(await db.eventoEstoque.count({ where: { paleteId: p.id } })).toBe(0);
  });

  it('correção no rascunho mantém autoria e revisão; depois de concluída, observações não mudam', async () => {
    const produto = await criarProduto('CORR-1');
    const p = await criarPalete();
    const s = await iniciarOk(p.id);
    const { line } = await entradaOk(s.id, manual(produto.id, '5', { lot: 'L1' }));
    const corrigir = (rev: number, quantidade: string, sessao: SessaoTeste = sOp2) =>
      mutar(app, sessao, 'PATCH', `${API}/conferencias/${s.id}/observacoes/${line.id}`, {
        expectedRevision: rev,
        productId: produto.id,
        quantity: quantidade,
        unit: 'UN',
        lot: 'L1',
        originType: null,
        originReference: null,
        condition: 'AVARIADO',
        reason: 'Recontado na caixa',
      });
    const corrigida = await corrigir(1, '6');
    expect(corrigida.statusCode, corrigida.body).toBe(200);
    expect(ResultadoObservacaoSchema.parse(corrigida.json()).line).toMatchObject({
      quantity: '6',
      condition: 'AVARIADO',
      revision: 2,
      registeredBy: { login: 'operador' },
      corrected: { by: { login: 'operador2' } },
    });
    expect((await corrigir(1, '7')).statusCode).toBe(409);
    const historico = await db.revisaoObservacao.findMany({ where: { observacaoId: line.id } });
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({ revisao: 1, acao: 'CORRIGIDA', motivo: 'Recontado na caixa' });
    expect(historico[0]?.anterior).toMatchObject({ quantidadeInformada: '5', condicao: 'SAUDAVEL' });

    const segunda = await entradaOk(s.id, manual(produto.id, '1'));
    const removida = await mutar(app, sOp, 'POST', `${API}/conferencias/${s.id}/observacoes/${segunda.line.id}/remover`, {
      expectedRevision: 1,
      reason: 'Leitura acidental',
    });
    expect(removida.statusCode, removida.body).toBe(200);
    const d = await ler(s.id);
    expect(d.lines.map((l) => [l.quantity, l.removed?.reason ?? null])).toEqual([
      ['6', null],
      ['1', 'Leitura acidental'],
    ]);
    expect(d.totals.map((t) => [t.quantity, t.condition])).toEqual([['6', 'AVARIADO']]);

    await concluirOk(s.id);
    expect((await corrigir(2, '9', sOp)).statusCode).toBe(409);
    await expect(db.$executeRawUnsafe(`UPDATE observacao_conferencia SET quantidade_informada = 99 WHERE id = '${line.id}'`)).rejects.toThrow(
      /CONFERENCIA_ENCERRADA/,
    );
  });
});

// ---------- Parcial ----------

describe('conferência parcial', () => {
  it('com vários produtos confirma só o que foi observado, mantém o resto pendente e não reconcilia (T03)', async () => {
    const a = await criarProduto('PAR-A');
    const b = await criarProduto('PAR-B');
    const p = await criarPalete([
      { sku: 'PAR-A', originType: 'NOTA_FISCAL', originReference: 'NF-1', quantity: '12', unit: 'UN' },
      { sku: 'PAR-B', originType: 'NOTA_FISCAL', originReference: 'NF-1', quantity: '5', unit: 'UN' },
    ]);
    const s = await iniciarOk(p.id, 'PARCIAL', sOp, 'Somente o produto PAR-A');
    await entradaOk(s.id, manual(a.id, '12', { originType: 'NOTA_FISCAL', originReference: 'NF-1' }));
    const d = await concluirOk(s.id);
    expect(d.state).toBe('CONCLUIDA');
    expect(d.comparison?.links.map((l) => [l.sku, l.status, l.observed, l.difference])).toEqual([
      ['PAR-A', 'PARCIAL', '12', null],
      ['PAR-B', 'PARCIAL', null, null],
    ]);
    const detalhe = await palete(p.id);
    expect([detalhe.countState, detalhe.currentItems]).toEqual(['PARCIAL', null]);
    expect(detalhe.observedCounts.map((c) => [c.session.scope, c.items.map((i) => [i.sku, i.quantity])])).toEqual([['PARCIAL', [['PAR-A', '12']]]]);
    const r = await reconciliar(s.id);
    expect([r.statusCode, codigoErro(r)]).toEqual([409, 'CONFLITO']);
    expect(r.json<{ error: { message: string } }>().error.message).toMatch(/parcial não substitui o saldo integral/);
    expect(b.id).toBeTruthy();
  });

  it('parcial depois de uma reconciliação preserva o saldo validado anterior', async () => {
    const a = await criarProduto('PRES-A');
    const b = await criarProduto('PRES-B');
    const p = await criarPalete();
    const completa = await iniciarOk(p.id);
    await entradaOk(completa.id, manual(a.id, '10'));
    await entradaOk(completa.id, manual(b.id, '4'));
    await concluirOk(completa.id);
    await reconciliarOk(completa.id);
    const parcial = await iniciarOk(p.id, 'PARCIAL', sOp, 'Somente PRES-B');
    await entradaOk(parcial.id, manual(b.id, '3'));
    await concluirOk(parcial.id);
    const detalhe = await palete(p.id);
    expect(detalhe.countState).toBe('RECONCILIADO');
    expect(detalhe.currentItems?.map((i) => [i.sku, i.quantity])).toEqual([
      ['PRES-A', '10'],
      ['PRES-B', '4'],
    ]);
    expect(detalhe.observedCounts.map((c) => [c.session.number, c.items.map((i) => [i.sku, i.quantity])])).toEqual([[2, [['PRES-B', '3']]]]);
  });
});

// ---------- Comparação, reconciliação e eventos ----------

describe('comparação e reconciliação', () => {
  it('documento declara 12 e a contagem observa 9: diferença 3; saldo muda só na reconciliação autorizada (T05)', async () => {
    const a = await criarProduto('T05-A');
    const p = await criarPalete([{ sku: 'T05-A', lot: 'L1', originType: 'NOTA_FISCAL', originReference: '000555', quantity: '12', unit: 'UN' }], 'F03-P02');
    // Material bloqueado continua bloqueado depois da reconciliação (bloqueio do palete inteiro, etapa 08).
    await db.palete.update({ where: { id: p.id }, data: { estadoLiberacao: 'BLOQUEADO', bloqueioMotivo: 'Avaliação fictícia', bloqueadoEm: new Date() } });
    const s = await iniciarOk(p.id);
    for (let i = 0; i < 9; i++) await entradaOk(s.id, { mode: 'MANUAL', productId: a.id, quantity: '1', unit: 'UN', lot: 'L1', originType: 'NOTA_FISCAL', originReference: '000555' });
    const semConfirmar = await concluir(s.id, sOp, false);
    expect(semConfirmar.statusCode).toBe(400);
    const concluida = await concluirOk(s.id);
    const vinculo = concluida.comparison?.links[0];
    expect(vinculo).toMatchObject({ sku: 'T05-A', unit: 'UN', declared: '12', observed: '9', validated: null, difference: '-3', status: 'FALTA', originReference: '000555' });
    const antes = await palete(p.id);
    expect([antes.countState, antes.currentItems]).toEqual(['AGUARDANDO_VALIDACAO', null]);
    expect(await db.saldoEstoque.count({ where: { paleteId: p.id } })).toBe(0);

    const previa = PreviaReconciliacaoSchema.parse((await como(app, sSup, { method: 'GET', url: `${API}/conferencias/${s.id}/reconciliacao` })).json());
    expect(previa).toMatchObject({ allowed: true, eventType: 'SALDO_INICIAL', blockers: [], releaseState: 'BLOQUEADO' });
    expect(previa.changes.map((c) => [c.sku, c.current, c.target, c.delta])).toEqual([['T05-A', '0', '9', '9']]);
    // Operador registra contagem, mas não reconcilia.
    expect((await reconciliar(s.id, sOp)).statusCode).toBe(403);

    const { event, session } = await reconciliarOk(s.id);
    expect(event).toMatchObject({ type: 'SALDO_INICIAL', session: { id: s.id, number: 1 }, author: { login: 'supervisor' }, previousEventId: null });
    expect(event.lines.map((l) => [l.sku, l.lot, l.originReference, l.before, l.delta, l.after])).toEqual([['T05-A', 'L1', '000555', '0', '9', '9']]);
    expect(session).toMatchObject({ state: 'RECONCILIADA', reconciledBy: { login: 'supervisor' }, reconciliationEventId: event.id });
    const depois = await palete(p.id);
    expect(depois).toMatchObject({ countState: 'RECONCILIADO', releaseState: 'BLOQUEADO', version: antes.version + 1 });
    expect(depois.currentItems?.map((i) => [i.sku, i.lot, i.originType, i.originReference, i.condition, i.quantity, i.unit])).toEqual([
      ['T05-A', 'L1', 'NOTA_FISCAL', '000555', 'SAUDAVEL', '9', 'UN'],
    ]);
    expect(depois.lastReconciliation).toMatchObject({ eventId: event.id, type: 'SALDO_INICIAL', session: { number: 1 } });
    // Observações originais preservadas; auditoria registrada.
    expect((await ler(s.id)).lines).toHaveLength(9);
    expect(await db.eventoAuditoria.count({ where: { acao: 'CONFERENCIA_RECONCILIADA', alvoId: s.id } })).toBe(1);
  });

  it('origem pendente não compensa a falta de outra devolução; sem declaração não há esperado zero', async () => {
    const a = await criarProduto('ORI-A');
    const p = await criarPalete([{ sku: 'ORI-A', originType: 'DEVOLUCAO', originReference: 'DEV-1', quantity: '10', unit: 'UN' }]);
    const s = await iniciarOk(p.id);
    await entradaOk(s.id, manual(a.id, '6', { originType: 'DEVOLUCAO', originReference: 'DEV-1' }));
    await entradaOk(s.id, manual(a.id, '4'));
    const d = await concluirOk(s.id);
    const links = d.comparison?.links ?? [];
    expect(links.find((l) => l.originReference === 'DEV-1')).toMatchObject({ declared: '10', observed: '6', difference: '-4', status: 'FALTA' });
    expect(links.find((l) => l.originType === null)).toMatchObject({ declared: null, observed: '4', difference: null, status: 'SEM_DECLARACAO' });
    const { event } = await reconciliarOk(s.id);
    // Segmentos separados: origem pendente mantém identidade própria.
    expect(event.lines.map((l) => [l.originReference, l.after]).sort()).toEqual([
      ['DEV-1', '6'],
      [null, '4'],
    ].sort());
  });

  it('declaração em caixa com fator aprovado é convertida para comparar; sem fator, comparação indisponível', async () => {
    await criarProduto('CMP-A', [{ code: 'CX-CMP-A', packaging: 'CX', factor: '12' }]);
    await criarProduto('CMP-B', [{ code: 'CX-CMP-B', packaging: 'CX', factor: null }]);
    const p = await criarPalete([
      { sku: 'CMP-A', originType: 'NOTA_FISCAL', originReference: 'NF-9', quantity: '2', unit: 'CX' },
      { sku: 'CMP-B', originType: 'NOTA_FISCAL', originReference: 'NF-9', quantity: '1', unit: 'CX' },
    ]);
    const s = await iniciarOk(p.id);
    await entradaOk(s.id, { mode: 'MANUAL', code: 'CX-CMP-A', quantity: '2', unit: 'CX', originType: 'NOTA_FISCAL', originReference: 'NF-9' });
    const d = await concluirOk(s.id);
    const links = d.comparison?.links ?? [];
    expect(links.find((l) => l.sku === 'CMP-A')).toMatchObject({ declared: '24', observed: '24', status: 'CONFERE', difference: '0' });
    expect(links.find((l) => l.sku === 'CMP-B')).toMatchObject({ declared: null, status: 'INDISPONIVEL' });
  });

  it('recontagem vinculada preserva a original; correção posterior ajusta contra o saldo atual', async () => {
    const a = await criarProduto('REC-A');
    const p = await criarPalete([{ sku: 'REC-A', originType: 'DEVOLUCAO', originReference: 'DEV-7', quantity: '12', unit: 'UN' }]);
    const origem = { originType: 'DEVOLUCAO', originReference: 'DEV-7' };
    const s1 = await iniciarOk(p.id);
    await entradaOk(s1.id, manual(a.id, '9', origem));
    await concluirOk(s1.id);

    const pedirRecontagem = async (sessaoId: string, justificativa: string) => {
      const v = (await palete(p.id)).version;
      return mutar(app, sOp2, 'POST', `${API}/conferencias/${sessaoId}/recontagem`, { expectedPalletVersion: v, justification: justificativa });
    };
    expect((await pedirRecontagem(s1.id, '')).statusCode).toBe(400);
    const r2 = await pedirRecontagem(s1.id, 'Diferença de 3 unidades');
    expect(r2.statusCode, r2.body).toBe(201);
    const s2 = ConferenciaDetalheSchema.parse(r2.json());
    expect(s2).toMatchObject({ number: 2, kind: 'RECONTAGEM', origin: { id: s1.id, number: 1 }, justification: 'Diferença de 3 unidades', state: 'EM_ANDAMENTO' });
    // Enquanto a recontagem está em andamento, a original não é reconciliada.
    expect((await reconciliar(s1.id)).statusCode).toBe(409);
    await entradaOk(s2.id, manual(a.id, '10', origem), sOp2);
    await concluirOk(s2.id, sOp2);
    const original = await ler(s1.id);
    expect(original).toMatchObject({ state: 'SUBSTITUIDA', supersededBy: { id: s2.id, number: 2 } });
    expect(original.lines.map((l) => l.quantity)).toEqual(['9']);
    expect((await reconciliar(s1.id)).statusCode).toBe(409);
    const primeira = await reconciliarOk(s2.id);
    expect(primeira.event.type).toBe('SALDO_INICIAL');

    // Correção depois da reconciliação: nova sessão vinculada; ajuste contra o saldo atual.
    const r3 = await pedirRecontagem(s2.id, 'Duas unidades estavam avariadas');
    expect(r3.statusCode, r3.body).toBe(201);
    const s3 = ConferenciaDetalheSchema.parse(r3.json());
    await entradaOk(s3.id, manual(a.id, '8', origem));
    await entradaOk(s3.id, manual(a.id, '2', { ...origem, condition: 'AVARIADO' }));
    await concluirOk(s3.id);
    const ajuste = await reconciliarOk(s3.id);
    expect(ajuste.event).toMatchObject({ type: 'AJUSTE_RECONCILIACAO', previousEventId: primeira.event.id });
    expect(ajuste.event.lines.map((l) => [l.condition, l.before, l.delta, l.after])).toEqual(
      expect.arrayContaining([
        ['SAUDAVEL', '10', '-2', '8'],
        ['AVARIADO', '0', '2', '2'],
      ]),
    );

    // Ausência verificada na completa: o segmento avariado vai a zero e sai do saldo; nada fica negativo.
    const s4 = await iniciarOk(p.id);
    await entradaOk(s4.id, manual(a.id, '8', origem));
    await concluirOk(s4.id);
    const zera = await reconciliarOk(s4.id);
    expect(zera.event.lines.map((l) => [l.condition, l.before, l.delta, l.after])).toEqual([['AVARIADO', '2', '-2', '0']]);
    const final = await palete(p.id);
    expect(final.currentItems?.map((i) => [i.condition, i.quantity])).toEqual([['SAUDAVEL', '8']]);
    const historico = HistoricoConferenciasSchema.parse((await como(app, sCons, { method: 'GET', url: `${API}/paletes/${p.id}/conferencias` })).json());
    expect(historico.sessions.map((x) => [x.number, x.state, x.kind])).toEqual([
      [4, 'RECONCILIADA', 'CONFERENCIA'],
      [3, 'RECONCILIADA', 'RECONTAGEM'],
      [2, 'RECONCILIADA', 'RECONTAGEM'],
      [1, 'SUBSTITUIDA', 'CONFERENCIA'],
    ]);
    expect(historico.events.map((e) => e.type)).toEqual(['AJUSTE_RECONCILIACAO', 'AJUSTE_RECONCILIACAO', 'SALDO_INICIAL']);
    // Eventos são imutáveis.
    await expect(db.$executeRawUnsafe(`DELETE FROM evento_estoque WHERE palete_id = '${p.id}'`)).rejects.toThrow(/HISTORICO_IMUTAVEL/);
  });

  it('palete da demonstração aguardando validação (12 declarado, 9 observado) é reconciliado pelo fluxo normal', async () => {
    const PAL_003 = '00000000-0000-4000-8000-000000000003';
    const detalhe = await palete(PAL_003);
    const sessao = detalhe.observedCounts[0]?.session;
    expect(sessao).toMatchObject({ scope: 'COMPLETA', state: 'CONCLUIDA' });
    const d = await ler(sessao?.id ?? '');
    expect(d.comparison?.links[0]).toMatchObject({ sku: 'DEMO-101', declared: '12', observed: '9', difference: '-3', status: 'FALTA' });
    const { event } = await reconciliarOk(sessao?.id ?? '');
    expect(event.lines.map((l) => [l.sku, l.after])).toEqual([['DEMO-101', '9']]);
    expect((await palete(PAL_003)).releaseState).toBe('BLOQUEADO');
  });
});

// ---------- Concorrência, versão e idempotência ----------

describe('concorrência e versão', () => {
  async function contagemConcluida(sku: string, quantidade = '5') {
    const a = await criarProduto(sku);
    const p = await criarPalete([], null);
    const s = await iniciarOk(p.id);
    await entradaOk(s.id, manual(a.id, quantidade));
    await concluirOk(s.id);
    return { p, s, a };
  }

  it('duas reconciliações concorrentes e o reenvio após resposta perdida produzem um único evento', async () => {
    const { p, s } = await contagemConcluida('CONC-A');
    const respostas = await Promise.all([reconciliar(s.id, sSup), reconciliar(s.id, sSup2)]);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const ok = respostas.find((r) => r.statusCode === 200);
    const contagem = await contar(p.id);
    expect([contagem.eventos, contagem.saldos]).toEqual([1, 1]);

    // Reenvio com a mesma chave (resposta perdida): resultado original, nenhum evento novo.
    const { p: p2, s: s2 } = await contagemConcluida('CONC-B');
    const k = chave();
    const corpo = { expectedPalletVersion: (await ler(s2.id)).pallet.version, justification: 'Contagem revisada pelo supervisor' };
    const enviar = (justificativa?: string) =>
      mutar(app, sSup, 'POST', `${API}/conferencias/${s2.id}/reconciliar`, justificativa ? { ...corpo, justification: justificativa } : corpo, k);
    const primeira = await enviar();
    expect(primeira.statusCode).toBe(200);
    // O cliente não recebeu a resposta e reenvia exatamente o mesmo pedido (duas vezes, ao mesmo tempo).
    const [reenvio1, reenvio2] = await Promise.all([enviar(), enviar()]);
    for (const r of [reenvio1, reenvio2]) {
      expect([r.statusCode, r.headers['idempotency-replayed']]).toEqual([200, 'true']);
      expect(ResultadoReconciliacaoSchema.parse(r.json()).event.id).toBe(ResultadoReconciliacaoSchema.parse(primeira.json()).event.id);
    }
    expect((await contar(p2.id)).eventos).toBe(1);
    // Mesma chave com outro pedido: rejeitada sem alteração.
    const outra = await enviar('Outra justificativa');
    expect([outra.statusCode, codigoErro(outra)]).toEqual([422, 'IDEMPOTENCIA_CONFLITO']);
    expect((await contar(p2.id)).eventos).toBe(1);
    expect(ok).toBeDefined();
  });

  it('versão desatualizada impede concluir e reconciliar sem sobrescrever', async () => {
    const a = await criarProduto('VER-A');
    const p = await criarPalete();
    const s = await iniciarOk(p.id);
    await entradaOk(s.id, manual(a.id, '5'));
    const visto = await ler(s.id);
    // Outra pessoa acrescenta uma linha: a revisão revisada por quem conclui ficou antiga.
    await entradaOk(s.id, manual(a.id, '1'), sOp2);
    const r1 = await mutar(app, sOp, 'POST', `${API}/conferencias/${s.id}/concluir`, {
      expectedRevision: visto.revision,
      expectedPalletVersion: visto.pallet.version,
      confirmFullScope: true,
    });
    expect([r1.statusCode, codigoErro(r1)]).toEqual([409, 'CONFLITO_VERSAO']);
    // Palete alterado (observações do cadastro) durante a conferência: conclusão recusada até conferir a versão atual.
    const editar = await mutar(app, sOp, 'PATCH', `${API}/paletes/${p.id}`, { expectedVersion: visto.pallet.version, notes: 'Filme rasgado' });
    expect(editar.statusCode).toBe(200);
    const atual = await ler(s.id);
    const r2 = await mutar(app, sOp, 'POST', `${API}/conferencias/${s.id}/concluir`, {
      expectedRevision: atual.revision,
      expectedPalletVersion: visto.pallet.version,
      confirmFullScope: true,
    });
    expect([r2.statusCode, codigoErro(r2)]).toEqual([409, 'CONFLITO_VERSAO']);
    expect((await ler(s.id)).state).toBe('EM_ANDAMENTO');
    const concluida = await concluirOk(s.id);
    expect(concluida.totals.map((t) => t.quantity)).toEqual(['6']);
    // Reconciliar com a versão vista antes de uma alteração do palete: recusado.
    const vReconciliar = (await ler(s.id)).pallet.version;
    await mutar(app, sOp, 'PATCH', `${API}/paletes/${p.id}`, { expectedVersion: vReconciliar, notes: 'Etiqueta refeita' });
    const r3 = await mutar(app, sSup, 'POST', `${API}/conferencias/${s.id}/reconciliar`, { expectedPalletVersion: vReconciliar, justification: 'Conferido' });
    expect([r3.statusCode, codigoErro(r3)]).toEqual([409, 'CONFLITO_VERSAO']);
    expect(await db.eventoEstoque.count({ where: { paleteId: p.id } })).toBe(0);
  });

  it('protege o palete de operações conflitantes (preparação da etapa 05), só naquele palete (T04)', async () => {
    const a = await criarProduto('MOV-A');
    const p = await criarPalete([], 'F03-P03');
    const livre = await criarPalete([], 'F03-P04');
    const s0 = await iniciarOk(p.id);
    await entradaOk(s0.id, manual(a.id, '5'));
    await concluirOk(s0.id);
    await reconciliarOk(s0.id);

    // Conferência em andamento: localização, arquivamento e saldo daquele palete ficam bloqueados.
    const s = await iniciarOk(p.id);
    const destino = await idPosicao(db, ID_ESCOPO_PRACA, 'F03-P05');
    await expect(db.$executeRawUnsafe(`UPDATE palete SET posicao_id = '${destino}' WHERE id = '${p.id}'`)).rejects.toThrow(/PALETE_EM_CONFERENCIA/);
    await expect(db.$executeRawUnsafe(`UPDATE saldo_estoque SET quantidade = 4 WHERE palete_id = '${p.id}'`)).rejects.toThrow(/PALETE_EM_CONFERENCIA/);
    const arquivar = await mutar(app, sSup, 'POST', `${API}/paletes/${p.id}/arquivar`, { expectedVersion: (await palete(p.id)).version, reason: 'Teste' });
    expect([arquivar.statusCode, codigoErro(arquivar)]).toEqual([409, 'CONFLITO']);
    // Outro palete não é afetado.
    await db.$executeRawUnsafe(`UPDATE palete SET posicao_id = '${destino}' WHERE id = '${livre.id}'`);

    // Depois de concluída, uma movimentação simulada (nova versão de conteúdo) torna a contagem desatualizada.
    await entradaOk(s.id, manual(a.id, '5'));
    await concluirOk(s.id);
    await db.$executeRawUnsafe(`UPDATE palete SET versao_saldo = versao_saldo + 1 WHERE id = '${p.id}'`);
    const d = await ler(s.id);
    expect(d.outdated).toBe(true);
    const previa = PreviaReconciliacaoSchema.parse((await como(app, sSup, { method: 'GET', url: `${API}/conferencias/${s.id}/reconciliacao` })).json());
    expect(previa.allowed).toBe(false);
    const r = await reconciliar(s.id);
    expect([r.statusCode, codigoErro(r)]).toEqual([409, 'CONFLITO_VERSAO']);
    expect(await db.eventoEstoque.count({ where: { paleteId: p.id } })).toBe(1);
  });

  it('falha durante a gravação reverte saldo, evento, auditoria e idempotência juntos', async () => {
    const { p, s } = await contagemConcluida('FALHA-A', '7');
    const antes = await contar(p.id);
    const versoes = await db.palete.findUniqueOrThrow({ where: { id: p.id }, select: { versao: true, versaoSaldo: true, estadoConferencia: true } });
    await db.$executeRawUnsafe(`CREATE FUNCTION falha_simulada() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FALHA_SIMULADA_NA_AUDITORIA'; END $$`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER falha_simulada BEFORE INSERT ON evento_auditoria FOR EACH ROW WHEN (NEW.acao = 'CONFERENCIA_RECONCILIADA') EXECUTE FUNCTION falha_simulada()`,
    );
    const k = chave();
    try {
      const r = await reconciliar(s.id, sSup, k);
      expect(r.statusCode).toBe(500);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER falha_simulada ON evento_auditoria');
      await db.$executeRawUnsafe('DROP FUNCTION falha_simulada()');
    }
    expect(await contar(p.id)).toEqual(antes);
    expect(await db.segmentoEstoque.count({ where: { produto: { sku: 'FALHA-A' } } })).toBe(0);
    expect(await db.palete.findUniqueOrThrow({ where: { id: p.id }, select: { versao: true, versaoSaldo: true, estadoConferencia: true } })).toEqual(versoes);
    expect((await ler(s.id)).state).toBe('CONCLUIDA');
    // A mesma ação, repetida depois da falha, grava uma única vez.
    const r2 = await reconciliar(s.id, sSup, k);
    expect(r2.statusCode, r2.body).toBe(200);
    const depois = await contar(p.id);
    expect([depois.eventos, depois.saldos, depois.auditoria - antes.auditoria, depois.idempotencia - antes.idempotencia]).toEqual([1, 1, 1, 1]);
  });

  it('reserva existente: reconciliação não sobrescreve e registra a pendência', async () => {
    const { p, s, a } = await contagemConcluida('RES-A', '9');
    await reconciliarOk(s.id);
    // Reserva real da etapa 08 (liberação + janela + reserva).
    await reservarPelaApi(app, sSup, p.id, (await palete(p.id)).currentItems?.[0]?.segmentId ?? '', '5');
    const s2 = await iniciarOk(p.id);
    await entradaOk(s2.id, manual(a.id, '3'));
    await concluirOk(s2.id);
    const k = chave();
    const r = await reconciliar(s2.id, sSup, k);
    expect([r.statusCode, codigoErro(r)]).toEqual([409, 'CONFLITO_SALDO']);
    expect((await reconciliar(s2.id, sSup, k)).headers['idempotency-replayed']).toBe('true');
    const d = await ler(s2.id);
    expect(d.state).toBe('CONCLUIDA');
    expect(d.pendingReconciliation?.reason).toMatch(/abaixo dos 5 reservados/);
    expect((await palete(p.id)).currentItems?.map((i) => [i.quantity, i.reserved])).toEqual([['9', '5']]);
    expect(await db.eventoEstoque.count({ where: { paleteId: p.id } })).toBe(1);
    expect(await db.eventoAuditoria.count({ where: { acao: 'CONFERENCIA_RECONCILIACAO_RECUSADA', alvoId: s2.id } })).toBe(1);
  });
});

// ---------- Permissões e escopo ----------

describe('permissões e escopo', () => {
  it('sem permissão ou de outro escopo não lê, edita, conclui nem reconcilia por chamada direta', async () => {
    const a = await criarProduto('PERM-A');
    const p = await criarPalete();
    const s = await iniciarOk(p.id);
    await entradaOk(s.id, manual(a.id, '2'));

    // Consulta lê, mas não registra; administrador técnico não registra contagem.
    expect((await como(app, sCons, { method: 'GET', url: `${API}/conferencias/${s.id}` })).statusCode).toBe(200);
    expect((await iniciar(p.id, 'COMPLETA', sCons)).statusCode).toBe(403);
    expect((await iniciar(p.id, 'COMPLETA', sAdmin)).statusCode).toBe(403);
    expect((await entrada(s.id, manual(a.id, '1'), sCons)).statusCode).toBe(403);
    expect((await entrada(s.id, manual(a.id, '1'), sAdmin)).statusCode).toBe(403);
    expect((await concluir(s.id, sCons)).statusCode).toBe(403);

    // Outro escopo: tudo responde como inexistente, inclusive para quem tem a permissão lá.
    for (const outro of [sNavOp, sNavSup]) {
      expect((await como(app, outro, { method: 'GET', url: `${API}/conferencias/${s.id}` })).statusCode).toBe(404);
      expect((await como(app, outro, { method: 'GET', url: `${API}/paletes/${p.id}/conferencias` })).statusCode).toBe(404);
      expect((await entrada(s.id, manual(a.id, '1'), outro)).statusCode).toBe(404);
      expect((await mutar(app, outro, 'POST', `${API}/conferencias/${s.id}/concluir`, { expectedRevision: 1, expectedPalletVersion: 1, confirmFullScope: true })).statusCode).toBe(404);
      expect((await mutar(app, outro, 'POST', `${API}/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: 1 })).statusCode).toBe(404);
    }
    expect(await db.eventoAuditoria.count({ where: { acao: 'ACESSO_NEGADO', alvoTipo: 'CONFERENCIA', alvoId: s.id } })).toBeGreaterThanOrEqual(2);

    await concluirOk(s.id);
    for (const semPermissao of [sOp, sCons, sAdmin]) {
      expect((await reconciliar(s.id, semPermissao)).statusCode).toBe(403);
      expect((await como(app, semPermissao, { method: 'GET', url: `${API}/conferencias/${s.id}/reconciliacao` })).statusCode).toBe(403);
    }
    expect((await mutar(app, sNavSup, 'POST', `${API}/conferencias/${s.id}/reconciliar`, { expectedPalletVersion: 1, justification: 'Tentativa' })).statusCode).toBe(404);
    // Cancelar contagem concluída é decisão do validador.
    const d = await ler(s.id);
    expect((await mutar(app, sOp, 'POST', `${API}/conferencias/${s.id}/cancelar`, { expectedRevision: d.revision, reason: 'Desistência' })).statusCode).toBe(403);
    // Sem sessão: 401; sem CSRF: 403.
    expect((await app.inject({ method: 'GET', url: `${API}/conferencias/${s.id}` })).statusCode).toBe(401);
    const semCsrf = await como(app, sSup, {
      method: 'POST',
      url: `${API}/conferencias/${s.id}/reconciliar`,
      payload: { expectedPalletVersion: d.pallet.version, justification: 'Sem token' },
      headers: { 'idempotency-key': chave() },
      semCsrf: true,
    });
    expect(semCsrf.statusCode).toBe(403);
    expect(await db.eventoEstoque.count({ where: { paleteId: p.id } })).toBe(0);
  });
});

// ---------- Funções do banco ----------

describe('funções auxiliares do banco', () => {
  it('UUID determinístico e chave de segmento iguais no PostgreSQL e no TypeScript', async () => {
    const { idDemoMd5 } = await import('../../src/demo/ids.js');
    const { chaveSegmento } = await import('../../src/modules/conferencia/regras.js');
    for (const nome of ['produto:x:DEMO-101', 'teste:ç', 'segmento:\u001fa\u001e']) {
      const [linha] = await db.$queryRaw<{ u: string }[]>`SELECT uuid_deterministico(${nome})::text AS u`;
      expect(linha?.u).toBe(idDemoMd5(nome));
    }
    const produto = '0b26aaa0-628e-3ea1-b4c7-4ec33e04a276';
    for (const [lote, tipo, ref] of [
      ['L1', 'NOTA_FISCAL', '000123'],
      [null, null, null],
      ['000', 'DEVOLUCAO', null],
    ] as const) {
      for (const linhagem of [null, 'b7d1c1a0-0000-4000-8000-000000000001']) {
        const [linha] = await db.$queryRaw<{ c: string }[]>`SELECT chave_segmento(${produto}::uuid, ${lote}, ${tipo}, ${ref}, 'AVARIADO', ${linhagem}) AS c`;
        expect(linha?.c).toBe(chaveSegmento({ produtoId: produto, lote, origemTipo: tipo, origemReferencia: ref, condicao: 'AVARIADO', linhagem }));
      }
    }
  });
});
