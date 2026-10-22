import { ConferenciaDetalheSchema, PaleteDetalheSchema, PracaSchema, ProdutoSchema, ReconferenciaPaleteSchema, type PaleteDetalhe } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { corrigirMovimento, moverPalete } from '../../src/modules/movimentos/servico.js';
import { ID_ESCOPO_PRACA, Relogio, appDeTeste, bancoDeTeste, chave, codigoErro, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste, type UsuarioTeste } from './apoio.js';

/**
 * Reconferência após 20 dias sem movimentação, com relógio controlado (nada de
 * esperar 20 dias reais nem mexer em dados da operação): sem alerta antes,
 * alerta exatamente no limite; movimento válido, transferência (origem e
 * destino), conferência completa e reconferência registrada reiniciam;
 * consulta, renomeação, edição de metadados, movimento recusado, repetição
 * idempotente, conferência parcial e cancelada não; o aviso não muda
 * conferência, liberação nem saldo; palete arquivado fica de fora; o prazo
 * persiste depois de reiniciar o servidor. Dados fictícios.
 */
const API = '/api/v1';
const DIA = 24 * 60 * 60 * 1000;
let db: Banco;
let app: FastifyInstance;
let relogio: Relogio;
let usuarios: { sup: UsuarioTeste; op: UsuarioTeste; cons: UsuarioTeste };
let sSup: SessaoTeste;
let sOp: SessaoTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  relogio = new Relogio();
  app = await appDeTeste(db, { agora: relogio.agora });
  const [sup, op, cons] = await Promise.all([
    criarUsuario(db, 'supervisor.relogio', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'operador.relogio', [[ID_ESCOPO_PRACA, 'OPERADOR']]),
    criarUsuario(db, 'consulta.relogio', [[ID_ESCOPO_PRACA, 'CONSULTA']]),
  ]);
  usuarios = { sup, op, cons };
  await entrarDeNovo();
});

afterAll(async () => {
  await db.$disconnect();
});

/** Avança o relógio e renova as sessões (a sessão expira antes de 20 dias). */
async function avancar(ms: number): Promise<void> {
  relogio.avancar(ms);
  await entrarDeNovo();
}

async function entrarDeNovo(): Promise<void> {
  [sSup, sOp] = await Promise.all([entrar(app, usuarios.sup), entrar(app, usuarios.op)]);
}

async function posicoesLivres(n: number): Promise<{ id: string; codigo: string }[]> {
  return db.$queryRaw<{ id: string; codigo: string }[]>`
    SELECT p.id::text, p.codigo FROM posicao p JOIN layout l ON l.id = p.layout_id AND l.ativo
     WHERE p.escopo_id = ${ID_ESCOPO_PRACA}::uuid AND p.disponivel AND p.retirada_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM palete pa WHERE pa.posicao_id = p.id)
     ORDER BY p.codigo LIMIT ${n}`;
}

async function criarPalete(posicaoId: string | null = null): Promise<PaleteDetalhe> {
  const r = await mutar(app, sOp, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId: posicaoId, notes: null, declaredItems: [] });
  expect(r.statusCode, r.body).toBe(201);
  return PaleteDetalheSchema.parse(r.json());
}

async function palete(id: string): Promise<PaleteDetalhe> {
  const r = await como(app, sOp, { method: 'GET', url: `${API}/paletes/${id}` });
  expect(r.statusCode, r.body).toBe(200);
  return PaleteDetalheSchema.parse(r.json());
}

const iso = (ms: number) => new Date(ms).toISOString();

describe('Reconferência após 20 dias sem movimentação', () => {
  it('sem alerta antes do prazo e com alerta exatamente no limite; consulta, mapa, renomeação e edição de metadados não reiniciam', async () => {
    const t0 = relogio.agora().getTime();
    const p = await criarPalete();
    expect(p.reconference).toMatchObject({ startedAt: iso(t0), startOrigin: 'CADASTRO', lastMovementAt: null, lastFullCountAt: null, nextAt: iso(t0 + 20 * DIA), due: false, daysUntilDue: 20, daysWithoutMovement: 0 });

    await avancar(20 * DIA - 1);
    // Nada disto é movimentação: mapa, lista, detalhe, renomear o bloco e editar as observações do palete.
    expect((await como(app, sOp, { method: 'GET', url: `${API}/praca` })).statusCode).toBe(200);
    expect((await como(app, sOp, { method: 'GET', url: `${API}/paletes?texto=${encodeURIComponent(p.code)}` })).statusCode).toBe(200);
    const layout = await como(app, sSup, { method: 'GET', url: `${API}/layout/enderecos` });
    const renomear = await mutar(app, sSup, 'PATCH', `${API}/layout/elementos/FB01`, { expectedRevision: layout.json<{ revision: number }>().revision, label: 'Rua 11 · FB01', operationalName: 'Rua 11' });
    expect(renomear.statusCode, renomear.body).toBe(200);
    const notas = await mutar(app, sOp, 'PATCH', `${API}/paletes/${p.id}`, { expectedVersion: p.version, notes: 'Filme refeito' });
    expect(notas.statusCode, notas.body).toBe(200);
    const antes = await palete(p.id);
    expect(antes.reconference).toMatchObject({ due: false, daysUntilDue: 1, daysWithoutMovement: 19, nextAt: iso(t0 + 20 * DIA), lastMovementAt: null });

    relogio.avancar(1); // exatamente 20 períodos de 24 horas
    const praca = PracaSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/praca` })).json());
    const noMapa = praca.pallets.find((x) => x.id === p.id);
    expect(noMapa?.reconference).toMatchObject({ due: true, daysUntilDue: 0, daysWithoutMovement: 20 });
    // O aviso é separado: conferência e liberação continuam como estavam.
    expect([noMapa?.countState, noMapa?.releaseState, noMapa?.flowState]).toEqual([antes.countState, antes.releaseState, antes.flowState]);
  });

  it('movimento válido reinicia; movimento recusado e repetição idempotente não', async () => {
    const t0 = relogio.agora().getTime();
    const [a, b] = await posicoesLivres(2);
    if (!a || !b) throw new Error('sem posições livres');
    const p = await criarPalete(a.id);
    await avancar(10 * DIA);
    const recusado = await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/movimentos`, { destinationPositionId: b.id, confirmedPositionCode: b.codigo, expectedVersion: p.version + 5, reason: 'Teste recusado' });
    expect(recusado.statusCode).toBe(409);
    expect((await palete(p.id)).reconference?.lastMovementAt).toBeNull();
    const k = chave();
    const mov = await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/movimentos`, { destinationPositionId: b.id, confirmedPositionCode: b.codigo, expectedVersion: p.version, reason: 'Reorganização fictícia' }, k);
    expect(mov.statusCode, mov.body).toBe(200);
    const t10 = t0 + 10 * DIA;
    expect((await palete(p.id)).reconference).toMatchObject({ lastMovementAt: iso(t10), lastMovementType: 'MOVIMENTO', nextAt: iso(t10 + 20 * DIA), daysWithoutMovement: 0 });
    await avancar(5 * DIA);
    // A mesma operação repetida (mesma chave) devolve a resposta guardada: nada é gravado de novo.
    const repetida = await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/movimentos`, { destinationPositionId: b.id, confirmedPositionCode: b.codigo, expectedVersion: p.version, reason: 'Reorganização fictícia' }, k);
    expect(repetida.statusCode).toBe(200);
    expect((await palete(p.id)).reconference).toMatchObject({ lastMovementAt: iso(t10), daysWithoutMovement: 5, daysUntilDue: 15 });
  });

  it('correção de posição registrada pela carga (erro na tabela de endereços) com relogio: false não reinicia; a correção comum reinicia', async () => {
    const t0 = relogio.agora().getTime();
    const [a, b] = await posicoesLivres(2);
    if (!a || !b) throw new Error('sem posições livres');
    const p = await criarPalete(null);
    const escopo = sSup.corpo.activeScope;
    if (!escopo) throw new Error('sem escopo');
    const autor = { usuarioId: usuarios.sup.id, requestId: `teste-${chave()}` };
    const versao = async () => (await db.palete.findUniqueOrThrow({ where: { id: p.id }, select: { versao: true } })).versao;
    // Posição informada pela carga (dado de origem): não reinicia.
    await db.$transaction(async (tx) =>
      moverPalete(tx, escopo, p.id, { destinationPositionId: a.id, confirmedPositionCode: a.codigo, expectedVersion: await versao(), reason: 'Localização informada no inventário fictício' }, autor, relogio.agora(), { relogio: false }),
    );
    await avancar(3 * DIA);
    const registro = await db.eventoLocalizacao.findFirstOrThrow({ where: { paleteId: p.id }, orderBy: { versaoPaletePosterior: 'desc' }, select: { id: true } });
    // A tabela de endereços estava errada: a posição registrada pela carga é corrigida para "sem posição" sem reiniciar o prazo.
    await db.$transaction(async (tx) =>
      corrigirMovimento(tx, escopo, registro.id, { destinationPositionId: null, confirmedPositionCode: null, expectedVersion: await versao(), reason: 'Tabela de endereços corrigida (fictício)' }, autor, relogio.agora(), { relogio: false }),
    );
    let atual = await palete(p.id);
    expect(atual.positionId).toBeNull();
    expect(atual.reconference).toMatchObject({ lastMovementAt: null, nextAt: iso(t0 + 20 * DIA), daysWithoutMovement: 3 });
    const evento = await db.eventoLocalizacao.findFirstOrThrow({ where: { paleteId: p.id, tipo: 'CORRECAO' }, select: { eventoCorrigidoId: true } });
    expect(evento.eventoCorrigidoId).toBe(registro.id);
    // Correção comum (pela API, sem a opção) continua reiniciando.
    await db.$transaction(async (tx) =>
      moverPalete(tx, escopo, p.id, { destinationPositionId: b.id, confirmedPositionCode: b.codigo, expectedVersion: await versao(), reason: 'Posição pela tabela corrigida (fictício)' }, autor, relogio.agora(), { relogio: false }),
    );
    const ultimo = await db.eventoLocalizacao.findFirstOrThrow({ where: { paleteId: p.id }, orderBy: { versaoPaletePosterior: 'desc' }, select: { id: true } });
    const r = await mutar(app, sSup, 'POST', `${API}/movimentos/${ultimo.id}/correcao`, { destinationPositionId: a.id, confirmedPositionCode: a.codigo, expectedVersion: await versao(), reason: 'Correção física fictícia' });
    expect(r.statusCode, r.body).toBe(200);
    atual = await palete(p.id);
    expect(atual.reconference).toMatchObject({ lastMovementAt: iso(t0 + 3 * DIA), lastMovementType: 'CORRECAO_LOCALIZACAO' });
  });

  it('transferência reinicia a origem e o destino', async () => {
    const produto = ProdutoSchema.parse((await mutar(app, sSup, 'POST', `${API}/produtos`, { sku: 'REL-0001', description: 'Produto do relógio', canonicalUnit: 'UN', active: true, barcodes: [] })).json());
    const origem = await criarPalete();
    const destino = await criarPalete();
    // Saldo validado pelo fluxo real (conferência completa + reconciliação).
    const inicio = await mutar(app, sOp, 'POST', `${API}/paletes/${origem.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: origem.version });
    const sessao = ConferenciaDetalheSchema.parse(inicio.json());
    const obs = await mutar(app, sOp, 'POST', `${API}/conferencias/${sessao.id}/observacoes`, { mode: 'MANUAL', productId: produto.id, quantity: '10', unit: 'UN', lot: null, originType: null, originReference: null, condition: 'SAUDAVEL' });
    expect(obs.statusCode, obs.body).toBe(201);
    const atual = ConferenciaDetalheSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/conferencias/${sessao.id}` })).json());
    const concluida = await mutar(app, sOp, 'POST', `${API}/conferencias/${sessao.id}/concluir`, { expectedRevision: atual.revision, expectedPalletVersion: atual.pallet.version, confirmFullScope: true });
    expect(concluida.statusCode, concluida.body).toBe(200);
    const rec = await mutar(app, sSup, 'POST', `${API}/conferencias/${sessao.id}/reconciliar`, { expectedPalletVersion: ConferenciaDetalheSchema.parse(concluida.json()).pallet.version, justification: 'Saldo de teste' });
    expect(rec.statusCode, rec.body).toBe(200);
    await avancar(3 * DIA);
    const de = await palete(origem.id);
    const para = await palete(destino.id);
    const segmento = de.currentItems?.[0]?.segmentId ?? '';
    const t = await mutar(app, sOp, 'POST', `${API}/transferencias`, { sourcePalletId: de.id, destinationPalletId: para.id, segmentId: segmento, quantity: '4', expectedSourceVersion: de.version, expectedDestinationVersion: para.version, reason: 'Consolidação fictícia' });
    expect(t.statusCode, t.body).toBe(200);
    const agora = iso(relogio.agora().getTime());
    expect((await palete(origem.id)).reconference).toMatchObject({ lastMovementAt: agora, lastMovementType: 'TRANSFERENCIA_ENVIADA' });
    expect((await palete(destino.id)).reconference).toMatchObject({ lastMovementAt: agora, lastMovementType: 'TRANSFERENCIA_RECEBIDA' });
  });

  it('conferência completa reinicia mesmo sem diferença; parcial, rascunho e cancelamento não', async () => {
    const t0 = relogio.agora().getTime();
    const produto = ProdutoSchema.parse((await mutar(app, sSup, 'POST', `${API}/produtos`, { sku: 'REL-0002', description: 'Produto do relógio 2', canonicalUnit: 'UN', active: true, barcodes: [] })).json());
    const p = await criarPalete();
    await avancar(5 * DIA);
    // Parcial concluída: não cobre o palete inteiro.
    const parcial = ConferenciaDetalheSchema.parse((await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/conferencias`, { scope: 'PARCIAL', scopeDescription: 'Camada superior', expectedVersion: p.version })).json());
    await mutar(app, sOp, 'POST', `${API}/conferencias/${parcial.id}/observacoes`, { mode: 'MANUAL', productId: produto.id, quantity: '2', unit: 'UN', lot: null, originType: null, originReference: null, condition: 'SAUDAVEL' });
    const ap = ConferenciaDetalheSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/conferencias/${parcial.id}` })).json());
    expect((await mutar(app, sOp, 'POST', `${API}/conferencias/${parcial.id}/concluir`, { expectedRevision: ap.revision, expectedPalletVersion: ap.pallet.version, confirmFullScope: false })).statusCode).toBe(200);
    expect((await palete(p.id)).reconference).toMatchObject({ lastFullCountAt: null, nextAt: iso(t0 + 20 * DIA) });
    // Completa iniciada (rascunho) e cancelada: não.
    const v1 = (await palete(p.id)).version;
    const rascunho = ConferenciaDetalheSchema.parse((await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: v1 })).json());
    expect((await palete(p.id)).reconference?.lastFullCountAt).toBeNull();
    const r = ConferenciaDetalheSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/conferencias/${rascunho.id}` })).json());
    expect((await mutar(app, sOp, 'POST', `${API}/conferencias/${rascunho.id}/cancelar`, { expectedRevision: r.revision, reason: 'Palete errado' })).statusCode).toBe(200);
    expect((await palete(p.id)).reconference?.lastFullCountAt).toBeNull();
    // Completa concluída sem diferença (nenhuma observação nova): reinicia o prazo, não os dias sem movimentação.
    await avancar(2 * DIA);
    const v2 = (await palete(p.id)).version;
    const completa = ConferenciaDetalheSchema.parse((await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: v2 })).json());
    const c = ConferenciaDetalheSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/conferencias/${completa.id}` })).json());
    expect((await mutar(app, sOp, 'POST', `${API}/conferencias/${completa.id}/concluir`, { expectedRevision: c.revision, expectedPalletVersion: c.pallet.version, confirmFullScope: true })).statusCode).toBe(200);
    const t7 = t0 + 7 * DIA;
    expect((await palete(p.id)).reconference).toMatchObject({ lastFullCountAt: iso(t7), lastFullCountOrigin: 'CONFERENCIA_COMPLETA', nextAt: iso(t7 + 20 * DIA), daysWithoutMovement: 7 });
  });

  it('reconferência registrada na conferência de volumes reinicia o prazo sem mudar conferência, liberação ou saldo; parcial é recusada', async () => {
    const t0 = relogio.agora().getTime();
    const p = await criarPalete();
    await avancar(21 * DIA);
    const vencido = await palete(p.id);
    expect(vencido.reconference?.due).toBe(true);
    const semConfirmar = await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/reconferencias`, { result: 'SEM_DIFERENCA', notes: null });
    expect(semConfirmar.statusCode).toBe(400);
    const consulta = await entrar(app, usuarios.cons);
    expect(codigoErro(await mutar(app, consulta, 'POST', `${API}/paletes/${p.id}/reconferencias`, { wholePallet: true, result: 'SEM_DIFERENCA', notes: null }))).toBe('ACESSO_NEGADO');
    const r = await mutar(app, sOp, 'POST', `${API}/paletes/${p.id}/reconferencias`, { wholePallet: true, result: 'SEM_DIFERENCA', notes: '  Conferido sem diferença  ' });
    expect(r.statusCode, r.body).toBe(201);
    const t21 = t0 + 21 * DIA;
    expect(ReconferenciaPaleteSchema.parse(r.json())).toMatchObject({ due: false, lastFullCountAt: iso(t21), lastFullCountOrigin: 'RECONFERENCIA_VOLUMES', lastFullCountBy: { login: 'operador.relogio' }, nextAt: iso(t21 + 20 * DIA), daysWithoutMovement: 21 });
    const depois = await palete(p.id);
    expect([depois.countState, depois.releaseState, depois.flowState, depois.currentItems, depois.version]).toEqual([vencido.countState, vencido.releaseState, vencido.flowState, vencido.currentItems, vencido.version]);
    const registro = await db.reconferenciaPalete.findFirstOrThrow({ where: { paleteId: p.id }, select: { id: true, resultado: true, observacao: true, conteudos: true } });
    expect(registro).toMatchObject({ resultado: 'SEM_DIFERENCA', observacao: 'Conferido sem diferença', conteudos: 0 });
    // O registro é só acrescentado.
    await expect(db.reconferenciaPalete.update({ where: { id: registro.id }, data: { resultado: 'COM_DIFERENCA' } })).rejects.toThrow(/RECONFERENCIA_IMUTAVEL/);
  });

  it('palete arquivado fica fora do prazo; o prazo persiste depois de reiniciar o servidor', async () => {
    const t0 = relogio.agora().getTime();
    const p = await criarPalete();
    const outro = await criarPalete();
    const arquivar = await mutar(app, sSup, 'POST', `${API}/paletes/${outro.id}/arquivar`, { expectedVersion: outro.version, reason: 'Palete vazio retirado' });
    expect(arquivar.statusCode, arquivar.body).toBe(200);
    expect((await palete(outro.id)).reconference).toBeNull();
    // Reinício do servidor (nova instância, mesmo banco): o prazo vem do que foi persistido.
    await app.close();
    app = await appDeTeste(db, { agora: relogio.agora });
    await avancar(20 * DIA);
    expect((await palete(p.id)).reconference).toMatchObject({ startedAt: iso(t0), due: true });
  });
});
