import {
  ConferenciaDetalheSchema,
  LoteEtiquetasSchema,
  HistoricoPaleteSchema,
  ListaPaletesSchema,
  PaleteDetalheSchema,
  PracaSchema,
  ProdutoSchema,
  ResultadoMovimentoSchema,
  ResultadoTransferenciaSchema,
  type PaleteDetalhe,
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
    criarUsuario(db, 'nav.supervisor', [[ID_ESCOPO_NAVEGACAO, 'SUPERVISOR_ESTOQUE']]),
  ]);
  const [supervisor, supervisor2, op, operador2, consulta, navSupervisor] = usuarios;
  operador = op;
  [sSup, sSup2, sOp, sOp2, sCons, sNavSup] = await Promise.all([
    entrar(app, supervisor),
    entrar(app, supervisor2),
    entrar(app, op),
    entrar(app, operador2),
    entrar(app, consulta),
    entrar(app, navSupervisor),
  ]);
});

afterAll(async () => {
  await db.$disconnect();
});

// ---------- Apoio ----------

let sequencia = 0;

async function criarProduto(sku: string): Promise<Produto> {
  const r = await mutar(app, sSup, 'POST', `${API}/produtos`, { sku, description: `Produto ${sku}`, canonicalUnit: 'UN', active: true, barcodes: [] });
  expect(r.statusCode, r.body).toBe(201);
  return ProdutoSchema.parse(r.json());
}

async function criarPalete(posicao: string | null = null): Promise<PaleteDetalhe> {
  const positionId = posicao === null ? null : await idPosicao(db, ID_ESCOPO_PRACA, posicao);
  const r = await mutar(app, sOp, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId, notes: null, declaredItems: [] });
  expect(r.statusCode, r.body).toBe(201);
  return PaleteDetalheSchema.parse(r.json());
}

async function palete(id: string, s: SessaoTeste = sCons): Promise<PaleteDetalhe> {
  const r = await como(app, s, { method: 'GET', url: `${API}/paletes/${id}` });
  expect(r.statusCode, r.body).toBe(200);
  return PaleteDetalheSchema.parse(r.json());
}

interface Item {
  productId: string;
  quantity: string;
  lot?: string | null;
  originType?: 'DEVOLUCAO' | 'NOTA_FISCAL' | null;
  originReference?: string | null;
  condition?: 'SAUDAVEL' | 'AVARIADO' | 'EM_AVALIACAO';
}

/** Saldo validado pelo fluxo real: conferência completa, conclusão e reconciliação. */
async function reconciliar(paleteId: string, itens: Item[]): Promise<PaleteDetalhe> {
  const p = await palete(paleteId);
  const inicio = await mutar(app, sOp, 'POST', `${API}/paletes/${paleteId}/conferencias`, { scope: 'COMPLETA', expectedVersion: p.version });
  expect(inicio.statusCode, inicio.body).toBe(201);
  const sessao = ConferenciaDetalheSchema.parse(inicio.json());
  for (const i of itens) {
    const r = await mutar(app, sOp, 'POST', `${API}/conferencias/${sessao.id}/observacoes`, {
      mode: 'MANUAL',
      productId: i.productId,
      quantity: i.quantity,
      unit: 'UN',
      lot: i.lot ?? null,
      originType: i.originType ?? null,
      originReference: i.originReference ?? null,
      condition: i.condition ?? 'SAUDAVEL',
    });
    expect(r.statusCode, r.body).toBe(201);
  }
  const atual = ConferenciaDetalheSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/conferencias/${sessao.id}` })).json());
  const concluida = await mutar(app, sOp, 'POST', `${API}/conferencias/${sessao.id}/concluir`, {
    expectedRevision: atual.revision,
    expectedPalletVersion: atual.pallet.version,
    confirmFullScope: true,
  });
  expect(concluida.statusCode, concluida.body).toBe(200);
  const v = ConferenciaDetalheSchema.parse(concluida.json()).pallet.version;
  const rec = await mutar(app, sSup, 'POST', `${API}/conferencias/${sessao.id}/reconciliar`, { expectedPalletVersion: v, justification: 'Saldo de teste' });
  expect(rec.statusCode, rec.body).toBe(200);
  return palete(paleteId);
}

function segmento(p: PaleteDetalhe, filtro: (i: NonNullable<PaleteDetalhe['currentItems']>[number]) => boolean) {
  const item = (p.currentItems ?? []).find(filtro);
  if (!item) throw new Error('Segmento não encontrado no palete.');
  return item;
}

function transferir(
  s: SessaoTeste,
  origem: PaleteDetalhe,
  destino: PaleteDetalhe,
  segmentId: string,
  quantity: string,
  chaveIdem: string = chave(),
  extra: object = {},
) {
  return mutar(
    app,
    s,
    'POST',
    `${API}/transferencias`,
    {
      sourcePalletId: origem.id,
      destinationPalletId: destino.id,
      segmentId,
      quantity,
      expectedSourceVersion: origem.version,
      expectedDestinationVersion: destino.version,
      reason: 'Consolidação de teste',
      ...extra,
    },
    chaveIdem,
  );
}

function mover(s: SessaoTeste, p: PaleteDetalhe, posicaoId: string, codigo: string, chaveIdem: string = chave(), versao = p.version) {
  return mutar(
    app,
    s,
    'POST',
    `${API}/paletes/${p.id}/movimentos`,
    { destinationPositionId: posicaoId, confirmedPositionCode: codigo, expectedVersion: versao, reason: 'Reorganização de teste' },
    chaveIdem,
  );
}

async function historico(id: string, s: SessaoTeste = sCons) {
  const r = await como(app, s, { method: 'GET', url: `${API}/paletes/${id}/historico` });
  expect(r.statusCode, r.body).toBe(200);
  return HistoricoPaleteSchema.parse(r.json());
}

async function cenarioDezParaTres() {
  sequencia += 1;
  const produto = await criarProduto(`MOV-${String(sequencia).padStart(3, '0')}`);
  const origem = await reconciliar((await criarPalete()).id, [{ productId: produto.id, quantity: '10', lot: '0042', originType: 'DEVOLUCAO', originReference: 'DEV-0007' }]);
  const destino = await reconciliar((await criarPalete()).id, [{ productId: produto.id, quantity: '3', lot: '0042', originType: 'DEVOLUCAO', originReference: 'DEV-0007' }]);
  const seg = segmento(origem, (i) => i.productId === produto.id);
  return { produto, origem, destino, seg };
}

const quantidades = async (id: string) => ((await palete(id)).currentItems ?? []).map((i) => [i.sku, i.lot, i.originReference, i.condition, i.quantity, i.reserved]);

// ---------- Transferência ----------

describe('transferência entre paletes', () => {
  it('T08: 8 de um disponível 10 → origem 2, destino 3 + 8 = 11, um evento, segmento preservado', async () => {
    const { produto, origem, destino, seg } = await cenarioDezParaTres();
    const r = await transferir(sOp, origem, destino, seg.segmentId, '8');
    expect(r.statusCode, r.body).toBe(200);
    const { event, source, destination } = ResultadoTransferenciaSchema.parse(r.json());
    expect(event).toMatchObject({ type: 'TRANSFERENCIA', pallet: { id: origem.id }, destination: { id: destino.id }, author: { login: 'operador' }, correctedEventId: null });
    expect(event.lines.map((l) => [l.pallet.id, l.before, l.delta, l.after])).toEqual(
      expect.arrayContaining([
        [origem.id, '10', '-8', '2'],
        [destino.id, '3', '8', '11'],
      ]),
    );
    expect(event.lines.every((l) => l.segmentId === seg.segmentId && l.lot === '0042' && l.originReference === 'DEV-0007' && l.condition === 'SAUDAVEL')).toBe(true);
    expect([source.version, destination.version]).toEqual([origem.version + 1, destino.version + 1]);
    expect(await quantidades(origem.id)).toEqual([[produto.sku, '0042', 'DEV-0007', 'SAUDAVEL', '2', '0']]);
    expect(await quantidades(destino.id)).toEqual([[produto.sku, '0042', 'DEV-0007', 'SAUDAVEL', '11', '0']]);
    expect(await db.eventoEstoque.count({ where: { tipo: 'TRANSFERENCIA' } })).toBe(1);
    expect(await db.eventoAuditoria.count({ where: { acao: 'TRANSFERENCIA_REGISTRADA' } })).toBe(1);
    // Os dois paletes continuam reconciliados; nada de expedição ou liberação.
    expect([(await palete(origem.id)).countState, (await palete(destino.id)).releaseState]).toEqual(['RECONCILIADO', 'PENDENTE']);
  });

  it('T09: falha entre a baixa e a entrada reverte saldo, evento, auditoria e idempotência', async () => {
    const { origem, destino, seg } = await cenarioDezParaTres();
    const antes = { o: await quantidades(origem.id), d: await quantidades(destino.id), e: await db.eventoEstoque.count(), a: await db.eventoAuditoria.count() };
    // Falha no momento da entrada no destino (depois da baixa na origem, na mesma transação).
    await db.$executeRawUnsafe(`CREATE FUNCTION falha_entrada() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FALHA_SIMULADA_NA_ENTRADA'; END $$`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER falha_entrada BEFORE INSERT OR UPDATE ON saldo_estoque FOR EACH ROW WHEN (NEW.palete_id = '${destino.id}'::uuid) EXECUTE FUNCTION falha_entrada()`,
    );
    const k = chave();
    try {
      const r = await transferir(sOp, origem, destino, seg.segmentId, '8', k);
      expect(r.statusCode).toBe(500);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER falha_entrada ON saldo_estoque');
      await db.$executeRawUnsafe('DROP FUNCTION falha_entrada()');
    }
    expect({ o: await quantidades(origem.id), d: await quantidades(destino.id), e: await db.eventoEstoque.count(), a: await db.eventoAuditoria.count() }).toEqual(antes);
    expect(await db.registroIdempotencia.count({ where: { chave: k } })).toBe(0);
    expect([(await palete(origem.id)).version, (await palete(destino.id)).version]).toEqual([origem.version, destino.version]);
    // A mesma ação, repetida depois, grava uma única vez.
    expect((await transferir(sOp, origem, destino, seg.segmentId, '8', k)).statusCode).toBe(200);
    expect(await db.eventoEstoque.count({ where: { tipo: 'TRANSFERENCIA' } })).toBe(1);
  });

  it('T10: pedidos simultâneos de 8 e 6 sobre saldo 10 não confirmam mais que 10', async () => {
    const { origem, destino, seg } = await cenarioDezParaTres();
    const outro = await reconciliar((await criarPalete()).id, []);
    const [a, b] = await Promise.all([transferir(sOp, origem, destino, seg.segmentId, '8'), transferir(sOp2, origem, outro, seg.segmentId, '6')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const recusada = a.statusCode === 409 ? a : b;
    expect(['SALDO_INSUFICIENTE', 'CONFLITO_VERSAO']).toContain(codigoErro(recusada));
    const restante = (await palete(origem.id)).currentItems?.[0]?.quantity;
    expect(['2', '4']).toContain(restante);
    const recebido = [...((await palete(destino.id)).currentItems ?? []), ...((await palete(outro.id)).currentItems ?? [])]
      .map((i) => Number(i.quantity))
      .reduce((t, q) => t + q, 0);
    expect(recebido + Number(restante)).toBe(13);
    expect(await db.eventoEstoque.count({ where: { tipo: 'TRANSFERENCIA' } })).toBe(1);

    // Cinco pedidos de 3 sobre o novo saldo, com versões atualizadas: nunca abaixo de zero.
    const p = await palete(origem.id);
    const d = await palete(destino.id);
    const respostas = await Promise.all([1, 2, 3, 4, 5].map(() => transferir(sOp, p, d, seg.segmentId, '1')));
    expect(respostas.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(respostas.every((r) => r.statusCode === 200 || r.statusCode === 409)).toBe(true);
  });

  it('T11/T12: reenvio após resposta perdida e reinício da API devolve o original; mesma chave com outro pedido é rejeitada', async () => {
    const { origem, destino, seg } = await cenarioDezParaTres();
    const k = chave();
    const primeira = await transferir(sOp, origem, destino, seg.segmentId, '8', k);
    expect(primeira.statusCode).toBe(200);
    // Reenvio igual, inclusive depois de reiniciar a API (nova instância e novo cliente do banco).
    await app.close();
    const db2 = bancoDeTeste();
    const app2 = await appDeTeste(db2);
    try {
      const s2 = await entrar(app2, operador);
      const corpo = {
        sourcePalletId: origem.id,
        destinationPalletId: destino.id,
        segmentId: seg.segmentId,
        quantity: '8',
        expectedSourceVersion: origem.version,
        expectedDestinationVersion: destino.version,
        reason: 'Consolidação de teste',
      };
      const [r1, r2] = await Promise.all([mutar(app2, s2, 'POST', `${API}/transferencias`, corpo, k), mutar(app2, s2, 'POST', `${API}/transferencias`, corpo, k)]);
      for (const r of [r1, r2]) {
        expect([r.statusCode, r.headers['idempotency-replayed']]).toEqual([200, 'true']);
        expect(r.json()).toEqual(primeira.json());
      }
      const outra = await mutar(app2, s2, 'POST', `${API}/transferencias`, { ...corpo, quantity: '1' }, k);
      expect([outra.statusCode, codigoErro(outra)]).toEqual([422, 'IDEMPOTENCIA_CONFLITO']);
    } finally {
      await app2.close();
      await db2.$disconnect();
      app = await appDeTeste(db);
    }
    expect(await db.eventoEstoque.count({ where: { tipo: 'TRANSFERENCIA' } })).toBe(1);
    expect((await palete(origem.id)).currentItems?.[0]?.quantity).toBe('2');
  });

  it('autorização atual conferida antes de devolver o resultado guardado', async () => {
    const { origem, destino, seg } = await cenarioDezParaTres();
    const k = chave();
    expect((await transferir(sOp, origem, destino, seg.segmentId, '1', k)).statusCode).toBe(200);
    // O perfil do operador muda para consulta: o reenvio com a mesma chave não devolve o resultado.
    await db.vinculo.update({ where: { usuarioId_escopoId: { usuarioId: operador.id, escopoId: ID_ESCOPO_PRACA } }, data: { perfil: 'CONSULTA' } });
    const reenvio = await transferir(sOp, origem, destino, seg.segmentId, '1', k);
    expect([reenvio.statusCode, reenvio.headers['idempotency-replayed']]).toEqual([403, undefined]);
    expect(await db.eventoEstoque.count({ where: { tipo: 'TRANSFERENCIA' } })).toBe(1);
  });

  it('T13: reserva ativa — disponível = saldo − reserva; a parte reservada não se move', async () => {
    const { origem, destino, seg } = await cenarioDezParaTres();
    // Reserva real da etapa 08 (liberação + janela + reserva); não muda a versão do palete.
    await reservarPelaApi(app, sSup, origem.id, seg.segmentId, '4');
    // A liberação (ação autorizada) mudou a versão do palete: a tela recarrega antes de transferir.
    const origemAtual = await palete(origem.id);
    const sete = await transferir(sOp, origemAtual, destino, seg.segmentId, '7');
    expect([sete.statusCode, codigoErro(sete)]).toEqual([409, 'SALDO_INSUFICIENTE']);
    expect(sete.json<{ error: { message: string } }>().error.message).toMatch(/disponível 6/);
    const seis = await transferir(sOp, origemAtual, destino, seg.segmentId, '6');
    expect(seis.statusCode, seis.body).toBe(200);
    expect((await palete(origem.id)).currentItems?.map((i) => [i.quantity, i.reserved])).toEqual([['4', '4']]);
    expect((await palete(destino.id)).currentItems?.map((i) => [i.quantity, i.reserved])).toEqual([['9', '0']]);
  });

  it('reserva concorrente e transferência contra o mesmo saldo: nunca reservado acima do saldo', async () => {
    for (let rodada = 0; rodada < 3; rodada++) {
      const { origem, destino, seg } = await cenarioDezParaTres();
      await reservarPelaApi(app, sSup, origem.id, seg.segmentId, '4', '10');
      // Reserva da etapa 08 (outra janela) e transferência simultâneas sobre o disponível de 6.
      const segunda = reservarPelaApi(app, sSup, origem.id, seg.segmentId, '5').then(
        () => 1,
        () => 0,
      );
      const [reservadas, transferencia] = await Promise.all([segunda, transferir(sOp, origem, destino, seg.segmentId, '6')]);
      const linha = await db.saldoEstoque.findFirstOrThrow({ where: { paleteId: origem.id } });
      expect(Number(linha.quantidadeReservada)).toBeLessThanOrEqual(Number(linha.quantidade));
      // No máximo uma das duas operações coube no disponível (nunca as duas).
      expect(reservadas + (transferencia.statusCode === 200 ? 1 : 0)).toBeLessThanOrEqual(1);
      expect(Number(linha.quantidade)).toBe(transferencia.statusCode === 200 ? 4 : 10);
      expect(Number(linha.quantidadeReservada)).toBe(reservadas === 1 ? 9 : 4);
    }
  });

  it('valida quantidade, origem/destino, segmento, conferência ativa e versão', async () => {
    const { origem, destino, seg } = await cenarioDezParaTres();
    for (const q of ['0', '-1', '1.5', '2.0001', 'abc']) {
      expect((await transferir(sOp, origem, destino, seg.segmentId, q)).statusCode).toBe(400);
    }
    expect((await transferir(sOp, origem, origem, seg.segmentId, '1')).statusCode).toBe(400);
    expect((await transferir(sOp, origem, destino, '10000000-0000-4000-8000-000000000999', '1')).statusCode).toBe(409);
    const desatualizada = await transferir(sOp, origem, destino, seg.segmentId, '1', chave(), { expectedSourceVersion: origem.version + 1 });
    expect([desatualizada.statusCode, codigoErro(desatualizada)]).toEqual([409, 'CONFLITO_VERSAO']);
    // Conferência em andamento no destino (ou na origem) bloqueia a transferência daquele palete.
    const inicio = await mutar(app, sOp, 'POST', `${API}/paletes/${destino.id}/conferencias`, { scope: 'PARCIAL', scopeDescription: 'Camada', expectedVersion: destino.version });
    expect(inicio.statusCode).toBe(201);
    const bloqueada = await transferir(sOp, origem, destino, seg.segmentId, '1');
    expect([bloqueada.statusCode, codigoErro(bloqueada)]).toEqual([409, 'CONFLITO']);
    expect(await quantidades(origem.id)).toEqual([[expect.any(String), '0042', 'DEV-0007', 'SAUDAVEL', '10', '0']]);
    // Palete arquivado não recebe.
    const vazio = await criarPalete();
    const arquivar = await mutar(app, sSup, 'POST', `${API}/paletes/${vazio.id}/arquivar`, { expectedVersion: vazio.version, reason: 'Cadastro errado' });
    expect(arquivar.statusCode).toBe(200);
    const paraArquivado = await transferir(sOp, origem, await palete(vazio.id), seg.segmentId, '1');
    expect(paraArquivado.statusCode).toBe(409);
  });

  it('liberação é do material (etapa 08): transferência nunca libera; chega pendente ao destino e o bloqueio acompanha', async () => {
    const { origem, destino, seg } = await cenarioDezParaTres();
    // Destino totalmente liberado recebe material não liberado: aceito, e o destino deixa de estar todo liberado.
    const d = await palete(destino.id);
    const liberacao = await mutar(app, sSup, 'POST', `${API}/paletes/${destino.id}/liberacao`, {
      action: 'LIBERAR',
      expectedVersion: d.version,
      segmentId: seg.segmentId,
      quantity: '3',
      criterion: 'Critério fictício',
      source: 'Fonte fictícia',
      reference: null,
      reason: 'Liberação de teste',
    });
    expect(liberacao.statusCode, liberacao.body).toBe(200);
    expect((await palete(destino.id)).releaseState).toBe('LIBERADO');
    const r = await transferir(sOp, origem, await palete(destino.id), seg.segmentId, '2');
    expect(r.statusCode, r.body).toBe(200);
    const t = ResultadoTransferenciaSchema.parse(r.json());
    expect(t.notes.join(' ')).toMatch(/chega ao palete .* pendente de liberação/);
    expect(t.destination.currentItems?.map((i) => [i.quantity, i.released])).toEqual([['5', '3']]);
    expect(t.destination.releaseState).toBe('PENDENTE');
    expect(t.event.lines.every((l) => l.condition === 'SAUDAVEL')).toBe(true);
    // Palete de origem bloqueado inteiro: o material chega bloqueado; correção também não desbloqueia.
    const o = await palete(origem.id);
    const bloqueio = await mutar(app, sSup, 'POST', `${API}/paletes/${origem.id}/liberacao`, { action: 'BLOQUEAR_PALETE', expectedVersion: o.version, reason: 'Avaliação fictícia' });
    expect(bloqueio.statusCode, bloqueio.body).toBe(200);
    const r2 = await transferir(sOp, await palete(origem.id), await palete(destino.id), seg.segmentId, '1');
    expect(r2.statusCode, r2.body).toBe(200);
    const t2 = ResultadoTransferenciaSchema.parse(r2.json());
    expect(t2.destination.currentItems?.[0]?.blocked?.reason).toMatch(/Herdado do palete .*Avaliação fictícia/);
    expect(t2.destination.releaseState).toBe('BLOQUEADO');
    const correcao = await mutar(app, sSup, 'POST', `${API}/transferencias/${t.event.id}/correcao`, {
      quantity: '1',
      expectedSourceVersion: (await palete(destino.id)).version,
      expectedDestinationVersion: (await palete(origem.id)).version,
      reason: 'Devolver ao palete de origem',
    });
    expect(correcao.statusCode, correcao.body).toBe(200);
    expect((await palete(origem.id)).releaseState).toBe('BLOQUEADO');
  });

  it('transferências cruzadas simultâneas (A→B e B→A) terminam sem impasse', async () => {
    const { produto, origem, destino, seg } = await cenarioDezParaTres();
    const segB = segmento(destino, (i) => i.productId === produto.id);
    const respostas = await Promise.all([
      transferir(sOp, origem, destino, seg.segmentId, '2'),
      transferir(sOp2, destino, origem, segB.segmentId, '1'),
    ]);
    expect(respostas.every((r) => r.statusCode === 200 || codigoErro(r) === 'CONFLITO_VERSAO')).toBe(true);
    expect(respostas.some((r) => r.statusCode === 200)).toBe(true);
    const total = [...((await palete(origem.id)).currentItems ?? []), ...((await palete(destino.id)).currentItems ?? [])].reduce((t, i) => t + Number(i.quantity), 0);
    expect(total).toBe(13);
  });

  it('identidade: lotes, origens e condições distintos e pendentes não se unem; desconhecido não vira conferido', async () => {
    const produto = await criarProduto('ID-001');
    const a = await reconciliar((await criarPalete()).id, [
      { productId: produto.id, quantity: '5' },
      { productId: produto.id, quantity: '2', lot: 'L1', originType: 'DEVOLUCAO', originReference: 'DEV-1' },
      { productId: produto.id, quantity: '1', lot: 'L1', originType: 'DEVOLUCAO', originReference: 'DEV-1', condition: 'AVARIADO' },
    ]);
    const b = await reconciliar((await criarPalete()).id, [{ productId: produto.id, quantity: '4' }]);
    const pendenteA = segmento(a, (i) => i.lot === null);
    const pendenteB = segmento(b, (i) => i.lot === null);
    // Dois registros pendentes distintos: identidades diferentes, apesar dos mesmos campos nulos.
    expect(pendenteA.segmentId).not.toBe(pendenteB.segmentId);
    expect([pendenteA.lineage, pendenteB.lineage].every((l) => l !== null)).toBe(true);
    const r = await transferir(sOp, a, b, pendenteA.segmentId, '3');
    expect(r.statusCode, r.body).toBe(200);
    const bDepois = await palete(b.id);
    expect((bDepois.currentItems ?? []).filter((i) => i.lot === null).map((i) => i.quantity).sort()).toEqual(['3', '4']);
    // Avariado continua avariado; o mesmo lote saudável e o avariado continuam separados.
    const avariado = segmento(a, (i) => i.condition === 'AVARIADO');
    expect((await transferir(sOp, await palete(a.id), bDepois, avariado.segmentId, '1')).statusCode).toBe(200);
    const final = await palete(b.id);
    expect((final.currentItems ?? []).map((i) => [i.lot, i.condition, i.quantity]).sort()).toEqual(
      [
        [null, 'SAUDAVEL', '3'],
        [null, 'SAUDAVEL', '4'],
        ['L1', 'AVARIADO', '1'],
      ].sort(),
    );
    // Contagem completa que não distingue as duas linhagens pendentes: recusada se o total mudou.
    const p = await palete(b.id);
    const inicio = ConferenciaDetalheSchema.parse((await mutar(app, sOp, 'POST', `${API}/paletes/${b.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: p.version })).json());
    for (const corpo of [
      { productId: produto.id, quantity: '6' },
      { productId: produto.id, quantity: '1', lot: 'L1', originType: 'DEVOLUCAO', originReference: 'DEV-1', condition: 'AVARIADO' },
    ]) {
      await mutar(app, sOp, 'POST', `${API}/conferencias/${inicio.id}/observacoes`, { mode: 'MANUAL', unit: 'UN', condition: 'SAUDAVEL', ...corpo });
    }
    const atual = ConferenciaDetalheSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/conferencias/${inicio.id}` })).json());
    await mutar(app, sOp, 'POST', `${API}/conferencias/${inicio.id}/concluir`, { expectedRevision: atual.revision, expectedPalletVersion: atual.pallet.version, confirmFullScope: true });
    const rec = await mutar(app, sSup, 'POST', `${API}/conferencias/${inicio.id}/reconciliar`, { expectedPalletVersion: (await palete(b.id)).version, justification: 'Teste de linhagem' });
    expect([rec.statusCode, codigoErro(rec)]).toEqual([409, 'CONFLITO_SALDO']);
    expect(rec.json<{ error: { message: string } }>().error.message).toMatch(/linhagens/);

    // Palete nunca conferido recebe um segmento conhecido: continua não conferido, conteúdo ainda desconhecido.
    const desconhecido = await criarPalete();
    const de = await palete(a.id);
    const recebido = await transferir(sOp, de, desconhecido, segmento(de, (i) => i.lot === 'L1' && i.condition === 'SAUDAVEL').segmentId, '1');
    expect(recebido.statusCode, recebido.body).toBe(200);
    const d = await palete(desconhecido.id);
    expect([d.countState, d.lastReconciliation, d.observedCounts, d.currentItems?.map((i) => i.quantity)]).toEqual(['NAO_CONFERIDO', null, [], ['1']]);
    expect(d.lastStockEvent?.type).toBe('TRANSFERENCIA');
    const lista = PracaSchema.parse((await como(app, sCons, { method: 'GET', url: `${API}/praca` })).json());
    expect(lista.pallets.find((x) => x.id === desconhecido.id)?.countState).toBe('NAO_CONFERIDO');
  });
});

describe('transferência e conferência', () => {
  it('palete não conferido que recebeu saldo: a conferência completa ajusta o conhecido; arquivamento continua bloqueado', async () => {
    const { produto, origem, seg } = await cenarioDezParaTres();
    const novo = await criarPalete('F06-P01');
    expect((await transferir(sOp, origem, novo, seg.segmentId, '4')).statusCode).toBe(200);
    // Recebeu saldo validado: não é mais "cadastro feito por engano"; o arquivamento fica bloqueado.
    const p = await palete(novo.id);
    expect(p.countState).toBe('NAO_CONFERIDO');
    const arquivar = await mutar(app, sSup, 'POST', `${API}/paletes/${novo.id}/arquivar`, { expectedVersion: p.version, reason: 'Teste de arquivamento' });
    expect([arquivar.statusCode, codigoErro(arquivar)]).toEqual([409, 'CONFLITO']);
    // Conferência completa encontra 4 do segmento recebido e 2 de outro material: ajuste, não saldo inicial.
    const reconciliado = await reconciliar(novo.id, [
      { productId: produto.id, quantity: '4', lot: '0042', originType: 'DEVOLUCAO', originReference: 'DEV-0007' },
      { productId: produto.id, quantity: '2', condition: 'AVARIADO' },
    ]);
    expect([reconciliado.countState, reconciliado.lastReconciliation?.type, reconciliado.lastStockEvent?.type]).toEqual([
      'RECONCILIADO',
      'AJUSTE_RECONCILIACAO',
      'AJUSTE_RECONCILIACAO',
    ]);
    expect((reconciliado.currentItems ?? []).map((i) => [i.lot, i.condition, i.quantity, i.lineage === null]).sort()).toEqual(
      [
        ['0042', 'SAUDAVEL', '4', true],
        [null, 'AVARIADO', '2', false],
      ].sort(),
    );
    expect(reconciliado.positionCode).toBe('F06-P01');
    const h = await historico(novo.id);
    expect(h.stockEvents.map((e) => e.type)).toEqual(['AJUSTE_RECONCILIACAO', 'TRANSFERENCIA']);
  });
});

// ---------- Localização ----------

describe('mudança de localização', () => {
  it('preserva ID, código, QR, conteúdo e histórico; mapa, lista e detalhe mostram o mesmo registro', async () => {
    const produto = await criarProduto('LOC-001');
    const p = await reconciliar((await criarPalete('F03-P01')).id, [{ productId: produto.id, quantity: '5' }]);
    const etiquetaAntes = LoteEtiquetasSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/etiquetas?ids=${p.id}` })).json()).labels[0];
    const destino = await idPosicao(db, ID_ESCOPO_PRACA, 'F03-P09');
    const r = await mover(sOp, p, destino, 'f03-p09');
    expect(r.statusCode, r.body).toBe(200);
    const { event, pallet } = ResultadoMovimentoSchema.parse(r.json());
    expect(event).toMatchObject({ type: 'MOVIMENTO', from: { code: 'F03-P01' }, to: { id: destino, code: 'F03-P09' }, author: { login: 'operador' }, reason: 'Reorganização de teste' });
    expect([pallet.id, pallet.code, pallet.positionCode, pallet.version, pallet.currentItems?.map((i) => i.quantity)]).toEqual([p.id, p.code, 'F03-P09', p.version + 1, ['5']]);
    const praca = PracaSchema.parse((await como(app, sCons, { method: 'GET', url: `${API}/praca` })).json());
    expect(praca.pallets.find((x) => x.id === p.id)?.positionCode).toBe('F03-P09');
    expect(praca.pallets.some((x) => x.positionCode === 'F03-P01')).toBe(false);
    const lista = ListaPaletesSchema.parse((await como(app, sCons, { method: 'GET', url: `${API}/paletes?texto=F03-P09` })).json());
    expect(lista.items.map((x) => x.id)).toEqual([p.id]);
    const etiquetaDepois = LoteEtiquetasSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/etiquetas?ids=${p.id}` })).json()).labels[0];
    expect(etiquetaDepois?.url).toBe(etiquetaAntes?.url);
    expect(etiquetaDepois?.positionCode).toBe('F03-P09');
    // Nada de entrada nova por produto; saldo e conferência intactos.
    expect(await db.eventoEstoque.count({ where: { OR: [{ paleteId: p.id }, { paleteDestinoId: p.id }] } })).toBe(1);
    const h = await historico(p.id);
    expect(h.pallet).toMatchObject({ initialPosition: { code: 'F03-P01' }, currentPosition: { code: 'F03-P09' } });
    expect(h.locationEvents.map((e) => [e.from?.code, e.to?.code, e.latest])).toEqual([['F03-P01', 'F03-P09', true]]);
    expect(await db.eventoAuditoria.count({ where: { acao: 'PALETE_MOVIDO', alvoId: p.id } })).toBe(1);
  });

  it('palete sem conteúdo conferido ganha localização sem ganhar conteúdo, saldo ou liberação', async () => {
    const p = await criarPalete();
    const destino = await idPosicao(db, ID_ESCOPO_PRACA, 'F04-P01');
    expect((await mover(sOp, p, destino, 'F04-P01')).statusCode).toBe(200);
    const d = await palete(p.id);
    expect([d.positionCode, d.countState, d.currentItems, d.releaseState, d.pendingReason]).toEqual([
      'F04-P01',
      'NAO_CONFERIDO',
      null,
      'PENDENTE',
      'Conteúdo desconhecido até a conferência',
    ]);
  });

  it('dois paletes para a mesma posição ao mesmo tempo: só um ocupa; o outro mantém o vínculo', async () => {
    const a = await criarPalete('F04-P02');
    const b = await criarPalete('F04-P03');
    const alvo = await idPosicao(db, ID_ESCOPO_PRACA, 'F04-P10');
    const [ra, rb] = await Promise.all([mover(sOp, a, alvo, 'F04-P10'), mover(sOp2, b, alvo, 'F04-P10')]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 409]);
    expect(codigoErro(ra.statusCode === 409 ? ra : rb)).toBe('DESTINO_INDISPONIVEL');
    // O que perdeu a corrida continua vinculado à própria posição.
    const posicoes = [(await palete(a.id)).positionCode, (await palete(b.id)).positionCode].sort();
    expect(posicoes).toEqual(ra.statusCode === 200 ? ['F04-P03', 'F04-P10'] : ['F04-P02', 'F04-P10']);
    expect(await db.eventoLocalizacao.count()).toBe(1);
  });

  it('recusa destino ocupado, indisponível, de outro escopo, código não confirmado, versão antiga e conferência ativa', async () => {
    const p = await criarPalete('F04-P04');
    const ocupado = await idPosicao(db, ID_ESCOPO_PRACA, 'F01-P01');
    expect(codigoErro(await mover(sOp, p, ocupado, 'F01-P01'))).toBe('DESTINO_INDISPONIVEL');
    const livre = await idPosicao(db, ID_ESCOPO_PRACA, 'F04-P05');
    await db.posicao.update({ where: { id: livre }, data: { disponivel: false, motivoIndisponibilidade: 'Pilar' } });
    expect(codigoErro(await mover(sOp, p, livre, 'F04-P05'))).toBe('DESTINO_INDISPONIVEL');
    const outroEscopo = await idPosicao(db, ID_ESCOPO_NAVEGACAO, 'C-07');
    expect((await mover(sOp, p, outroEscopo, 'C-07')).statusCode).toBe(400);
    const certo = await idPosicao(db, ID_ESCOPO_PRACA, 'F04-P06');
    expect(codigoErro(await mover(sOp, p, certo, 'F04-P07'))).toBe('CONFLITO_VERSAO');
    expect(codigoErro(await mover(sOp, p, certo, 'F04-P06', chave(), p.version + 1))).toBe('CONFLITO_VERSAO');
    const inicio = await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: p.version });
    expect(inicio.statusCode).toBe(201);
    const emConferencia = await mover(sOp, p, certo, 'F04-P06');
    expect([emConferencia.statusCode, codigoErro(emConferencia)]).toEqual([409, 'CONFLITO']);
    expect((await palete(p.id)).positionCode).toBe('F04-P04');
    expect(await db.eventoLocalizacao.count()).toBe(0);
  });
});

// ---------- Correções ----------

describe('correções', () => {
  it('correção de transferência: evento vinculado, original preservado, limite do não compensado e saldo atual', async () => {
    const { origem, destino, seg } = await cenarioDezParaTres();
    const t = ResultadoTransferenciaSchema.parse((await transferir(sOp, origem, destino, seg.segmentId, '8')).json());
    const corrigir = async (q: string, s: SessaoTeste = sSup, k: string = chave()) => {
      const o = await palete(origem.id);
      const d = await palete(destino.id);
      return mutar(
        app,
        s,
        'POST',
        `${API}/transferencias/${t.event.id}/correcao`,
        { quantity: q, expectedSourceVersion: d.version, expectedDestinationVersion: o.version, reason: 'Quantidade transferida a mais' },
        k,
      );
    };
    expect((await corrigir('3', sOp)).statusCode).toBe(403);
    const c1 = await corrigir('3');
    expect(c1.statusCode, c1.body).toBe(200);
    const correcao = ResultadoTransferenciaSchema.parse(c1.json()).event;
    expect(correcao).toMatchObject({ type: 'CORRECAO_TRANSFERENCIA', correctedEventId: t.event.id, pallet: { id: destino.id }, destination: { id: origem.id } });
    expect(await quantidades(origem.id)).toEqual([[expect.any(String), '0042', 'DEV-0007', 'SAUDAVEL', '5', '0']]);
    expect(await quantidades(destino.id)).toEqual([[expect.any(String), '0042', 'DEV-0007', 'SAUDAVEL', '8', '0']]);
    // Original preservado; restante compensável 5.
    const h = await historico(origem.id);
    const original = h.stockEvents.find((e) => e.id === t.event.id);
    expect(original?.lines.map((l) => l.delta).sort()).toEqual(['-8', '8']);
    expect([original?.remainingCompensable, original?.correctedBy.map((c) => c.id)]).toEqual(['5', [correcao.id]]);
    // Acima do não compensado: recusado.
    const demais = await corrigir('6');
    expect([demais.statusCode, codigoErro(demais)]).toEqual([409, 'CONFLITO']);
    // Duas correções simultâneas de 4 (restam 5): só uma.
    const [x, y] = await Promise.all([corrigir('4', sSup), corrigir('4', sSup2)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect((await historico(origem.id)).stockEvents.find((e) => e.id === t.event.id)?.remainingCompensable).toBe('1');
    expect(await quantidades(origem.id)).toEqual([[expect.any(String), '0042', 'DEV-0007', 'SAUDAVEL', '9', '0']]);
    // O palete que recebeu já transferiu o material adiante: a compensação restante
    // (1) não restaura saldo antigo — é recusada contra o disponível atual (0).
    const terceiro = await reconciliar((await criarPalete()).id, []);
    expect((await transferir(sOp, await palete(destino.id), terceiro, seg.segmentId, '4')).statusCode).toBe(200);
    const semSaldo = await corrigir('1');
    expect([semSaldo.statusCode, codigoErro(semSaldo)]).toEqual([409, 'SALDO_INSUFICIENTE']);
    expect(await quantidades(origem.id)).toEqual([[expect.any(String), '0042', 'DEV-0007', 'SAUDAVEL', '9', '0']]);
    expect(await quantidades(terceiro.id)).toEqual([[expect.any(String), '0042', 'DEV-0007', 'SAUDAVEL', '4', '0']]);
    expect((await palete(destino.id)).currentItems).toEqual([]);
    // Correção de correção não existe: só transferências são compensadas.
    const deCorrecao = await mutar(app, sSup, 'POST', `${API}/transferencias/${correcao.id}/correcao`, {
      quantity: '1',
      expectedSourceVersion: (await palete(origem.id)).version,
      expectedDestinationVersion: (await palete(destino.id)).version,
      reason: 'Tentativa sobre a correção',
    });
    expect([deCorrecao.statusCode, codigoErro(deCorrecao)]).toEqual([409, 'CONFLITO']);
    // Eventos imutáveis.
    await expect(db.$executeRawUnsafe(`DELETE FROM evento_estoque WHERE id = '${t.event.id}'`)).rejects.toThrow(/HISTORICO_IMUTAVEL/);
  });

  it('correção recusada quando o saldo atual do palete que recebeu não permite', async () => {
    const { origem, destino, seg } = await cenarioDezParaTres();
    const t = ResultadoTransferenciaSchema.parse((await transferir(sOp, origem, destino, seg.segmentId, '8')).json());
    await reservarPelaApi(app, sSup, destino.id, seg.segmentId, '9', '11');
    const o = await palete(origem.id);
    const d = await palete(destino.id);
    const r = await mutar(app, sSup, 'POST', `${API}/transferencias/${t.event.id}/correcao`, {
      quantity: '3',
      expectedSourceVersion: d.version,
      expectedDestinationVersion: o.version,
      reason: 'Devolver ao palete de origem',
    });
    expect([r.statusCode, codigoErro(r)]).toEqual([409, 'SALDO_INSUFICIENTE']);
    expect(await db.eventoEstoque.count({ where: { tipo: 'CORRECAO_TRANSFERENCIA' } })).toBe(0);
  });

  it('correção de localização: só o último movimento, contra a ocupação atual; nunca restaura cegamente', async () => {
    const p = await criarPalete('F05-P01');
    const m1 = ResultadoMovimentoSchema.parse((await mover(sOp, p, await idPosicao(db, ID_ESCOPO_PRACA, 'F05-P02'), 'F05-P02')).json());
    const m2 = ResultadoMovimentoSchema.parse((await mover(sOp, m1.pallet, await idPosicao(db, ID_ESCOPO_PRACA, 'F05-P03'), 'F05-P03')).json());
    const corrigir = async (eventoId: string, posicao: string | null, s: SessaoTeste = sSup) => {
      const atual = await palete(p.id);
      return mutar(app, s, 'POST', `${API}/movimentos/${eventoId}/correcao`, {
        destinationPositionId: posicao === null ? null : await idPosicao(db, ID_ESCOPO_PRACA, posicao),
        confirmedPositionCode: posicao,
        expectedVersion: atual.version,
        reason: 'Palete foi para a posição errada',
      });
    };
    // Movimento anterior não pode ser desfeito depois de um posterior.
    expect(codigoErro(await corrigir(m1.event.id, 'F05-P01'))).toBe('CONFLITO');
    expect((await corrigir(m2.event.id, 'F05-P02', sOp)).statusCode).toBe(403);
    // A posição anterior foi ocupada por outro palete: não volta para lá.
    const intruso = await criarPalete();
    expect((await mover(sOp, intruso, await idPosicao(db, ID_ESCOPO_PRACA, 'F05-P02'), 'F05-P02')).statusCode).toBe(200);
    expect(codigoErro(await corrigir(m2.event.id, 'F05-P02'))).toBe('DESTINO_INDISPONIVEL');
    const ok = await corrigir(m2.event.id, 'F05-P04');
    expect(ok.statusCode, ok.body).toBe(200);
    const correcao = ResultadoMovimentoSchema.parse(ok.json());
    expect(correcao.event).toMatchObject({ type: 'CORRECAO', correctedEventId: m2.event.id, from: { code: 'F05-P03' }, to: { code: 'F05-P04' } });
    const h = await historico(p.id);
    expect(h.locationEvents.map((e) => [e.type, e.from?.code, e.to?.code, e.latest])).toEqual([
      ['CORRECAO', 'F05-P03', 'F05-P04', true],
      ['MOVIMENTO', 'F05-P02', 'F05-P03', false],
      ['MOVIMENTO', 'F05-P01', 'F05-P02', false],
    ]);
    expect(h.locationEvents.find((e) => e.id === m2.event.id)?.correctedBy.map((c) => c.id)).toEqual([correcao.event.id]);
    await expect(db.$executeRawUnsafe(`UPDATE evento_localizacao SET motivo = 'x' WHERE id = '${m1.event.id}'`)).rejects.toThrow(/HISTORICO_IMUTAVEL/);
  });
});

// ---------- Permissões e escopo ----------

describe('permissões e escopo', () => {
  it('sem permissão ou de outro escopo: não move, não transfere, não consulta histórico nem corrige', async () => {
    const { origem, destino, seg } = await cenarioDezParaTres();
    const t = ResultadoTransferenciaSchema.parse((await transferir(sOp, origem, destino, seg.segmentId, '1')).json());
    const livre = await idPosicao(db, ID_ESCOPO_PRACA, 'F06-P01');
    const o = await palete(origem.id);
    const d = await palete(destino.id);
    expect((await mover(sCons, o, livre, 'F06-P01')).statusCode).toBe(403);
    expect((await transferir(sCons, o, d, seg.segmentId, '1')).statusCode).toBe(403);
    // Outro escopo: tudo como inexistente.
    expect((await mover(sNavSup, o, livre, 'F06-P01')).statusCode).toBe(404);
    expect((await transferir(sNavSup, o, d, seg.segmentId, '1')).statusCode).toBe(404);
    expect((await como(app, sNavSup, { method: 'GET', url: `${API}/paletes/${o.id}/historico` })).statusCode).toBe(404);
    const correcao = await mutar(app, sNavSup, 'POST', `${API}/transferencias/${t.event.id}/correcao`, {
      quantity: '1',
      expectedSourceVersion: d.version,
      expectedDestinationVersion: o.version,
      reason: 'Tentativa de outro escopo',
    });
    expect(correcao.statusCode).toBe(404);
    // Mistura entre escopos: destino de outro escopo é inexistente para quem transfere.
    const navPalete = await db.palete.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_NAVEGACAO } });
    const mistura = await mutar(app, sOp, 'POST', `${API}/transferencias`, {
      sourcePalletId: o.id,
      destinationPalletId: navPalete.id,
      segmentId: seg.segmentId,
      quantity: '1',
      expectedSourceVersion: o.version,
      expectedDestinationVersion: navPalete.versao,
      reason: 'Mistura de escopos',
    });
    expect(mistura.statusCode).toBe(404);
    expect(await quantidades(o.id)).toEqual([[expect.any(String), '0042', 'DEV-0007', 'SAUDAVEL', '9', '0']]);
    // Sem sessão: 401.
    expect((await app.inject({ method: 'GET', url: `${API}/paletes/${o.id}/historico` })).statusCode).toBe(401);
  });
});
