import { HistoricoLiberacaoSchema, PaginaMaterialSchema, PaleteDetalheSchema, PreviaReservaSchema, ResultadoTransferenciaSchema, type PaleteDetalhe } from '@praca-reversa/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bancoDeTeste, codigoErro, como, mutar } from './apoio.js';
import { claimFalta, criarClaim, criarPalete, detalhe, evidenciaMaterial, montarAmbiente, palete, reconciliar, recuperar, segmentoDe, solicitar, type Ambiente } from './claims-apoio.js';
import {
  API,
  corpoExpedicao,
  corpoReserva,
  expedir,
  expedirOk,
  janela,
  janelaConfirmada,
  liberarMaterial,
  materialLiberado,
  paleteComSaldo,
  pecas,
  reservar,
  reservarOk,
  restricao,
  saldoAtual,
} from './janelas-apoio.js';

const db = bancoDeTeste();
let a: Ambiente;

beforeAll(async () => {
  a = await montarAmbiente(db);
});
afterAll(async () => {
  await a.app.close();
  await db.$disconnect();
});

const acao = (p: PaleteDetalhe, corpo: Record<string, unknown>) => mutar(a.app, a.sup, 'POST', `${API}/paletes/${p.id}/liberacao`, { expectedVersion: p.version, ...corpo });

async function fila(query: string) {
  const r = await como(a.app, a.sup, { method: 'GET', url: `${API}/material-expedicao?${query}` });
  expect(r.statusCode, r.body).toBe(200);
  return PaginaMaterialSchema.parse(r.json());
}

describe('liberação do material (palete × segmento)', () => {
  it('liberação parcial identifica quantidade e segmento; palete misto não é liberado inteiro; conferência não libera', async () => {
    const p = await paleteComSaldo(a, [
      { sku: 'LIB-A', quantity: '10', lot: 'L-01', ref: 'DEV-L-1' },
      { sku: 'LIB-B', quantity: '5', lot: 'L-02', ref: 'DEV-L-2' },
    ]);
    // Reconciliação não libera nada.
    expect(p.currentItems?.map((i) => [i.sku, i.released])).toEqual([
      ['LIB-A', '0'],
      ['LIB-B', '0'],
    ]);
    expect(p.releaseState).toBe('PENDENTE');
    const segA = segmentoDe(p, 'LIB-A');
    const acima = await liberarMaterial(a, p, segA, '11');
    expect([acima.statusCode, codigoErro(acima)]).toEqual([409, 'SALDO_INSUFICIENTE']);
    const r = await liberarMaterial(a, p, segA, '6');
    expect(r.statusCode, r.body).toBe(200);
    const depois = PaleteDetalheSchema.parse(r.json());
    expect(depois.currentItems?.map((i) => [i.sku, i.quantity, i.released])).toEqual([
      ['LIB-A', '10', '6'],
      ['LIB-B', '5', '0'],
    ]);
    // Uma linha liberada (e só parte dela) não libera o palete misto.
    expect(depois.releaseState).toBe('PENDENTE');
    const resto = await liberarMaterial(a, depois, segA, '4');
    const segB = segmentoDe(depois, 'LIB-B');
    const tudo = await liberarMaterial(a, PaleteDetalheSchema.parse(resto.json()), segB, '5');
    expect(PaleteDetalheSchema.parse(tudo.json()).releaseState).toBe('LIBERADO');
    // Histórico com critério, fonte e autor; revisão antiga recusada.
    const hist = HistoricoLiberacaoSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/paletes/${p.id}/liberacao` })).json());
    expect(hist.items.filter((h) => h.type === 'LIBERAR').map((h) => [h.sku, h.quantity, h.source])).toEqual([
      ['LIB-B', '5', 'Checklist fictício de liberação'],
      ['LIB-A', '4', 'Checklist fictício de liberação'],
      ['LIB-A', '6', 'Checklist fictício de liberação'],
    ]);
    expect((await liberarMaterial(a, p, segA, '1')).statusCode).toBe(409);
    // Palete não reconciliado (conteúdo desconhecido) não tem material a liberar.
    const novo = await criarPalete(a);
    expect((await liberarMaterial(a, novo, segA, '1')).statusCode).toBe(404);
  });

  it('bloqueio da linha e do palete inteiro: fila de pendências com motivo, responsável e próximo passo; desbloqueio com motivo', async () => {
    const { p, seg } = await materialLiberado(a, 'LIB-C', '8');
    const b = await acao(p, { action: 'BLOQUEAR', segmentId: seg, reason: 'Avaria encontrada na separação (fictício)' });
    expect(b.statusCode, b.body).toBe(200);
    const bloqueado = PaleteDetalheSchema.parse(b.json());
    expect([bloqueado.releaseState, bloqueado.currentItems?.[0]?.blocked?.reason]).toEqual(['BLOQUEADO', 'Avaria encontrada na separação (fictício)']);
    expect((await fila('fila=ELEGIVEL&texto=LIB-C')).total).toBe(0);
    const pend = await fila('fila=PENDENTE&texto=LIB-C');
    const pendencia = pend.items[0]?.pendencies.find((x) => x.code === 'MATERIAL_BLOQUEADO');
    expect(pendencia?.responsible?.login).toBe('supervisor');
    expect(pendencia?.nextStep).toMatch(/desbloquear/);
    // Liberar material bloqueado: recusado.
    expect((await liberarMaterial(a, bloqueado, seg, '0.5')).statusCode).toBe(409);
    const d = await acao(bloqueado, { action: 'DESBLOQUEAR', segmentId: seg, reason: 'Avaria descartada na reavaliação (fictício)' });
    expect(PaleteDetalheSchema.parse(d.json()).releaseState).toBe('LIBERADO');
    const bp = await acao(PaleteDetalheSchema.parse(d.json()), { action: 'BLOQUEAR_PALETE', reason: 'Palete em avaliação (fictício)' });
    const pb = PaleteDetalheSchema.parse(bp.json());
    expect([pb.releaseState, pb.palletBlock?.reason]).toEqual(['BLOQUEADO', 'Palete em avaliação (fictício)']);
    expect((await fila('fila=PENDENTE&texto=LIB-C')).items[0]?.pendencies.map((x) => x.code)).toContain('PALETE_BLOQUEADO');
    const db2 = await acao(pb, { action: 'DESBLOQUEAR_PALETE', reason: 'Avaliação concluída (fictício)' });
    expect(PaleteDetalheSchema.parse(db2.json()).releaseState).toBe('LIBERADO');
  });

  it('cenário 7 / T23: não liberado, documento isolado e observação não reconciliada não são reservados; bloqueio posterior impede expedir', async () => {
    const j = await janelaConfirmada(a, [pecas('100')]);
    // Reconciliado mas não liberado.
    const p = await paleteComSaldo(a, [{ sku: 'LIB-D', quantity: '6', lot: 'L-01', ref: 'DEV-L-3' }]);
    const seg = segmentoDe(p, 'LIB-D');
    const naoLiberado = await reservar(a, j, [{ p, seg, q: '1' }]);
    expect([naoLiberado.statusCode, codigoErro(naoLiberado)]).toEqual([409, 'MATERIAL_INELEGIVEL']);
    expect(naoLiberado.json<{ error: { message: string } }>().error.message).toMatch(/aguardando liberação/);
    // Observação parcial (não reconciliada) não fornece saldo.
    const parcial = await criarPalete(a);
    const produto = await db.produto.findFirstOrThrow({ where: { sku: 'LIB-D' } });
    await reconciliar(a, parcial.id, [{ productId: produto.id, quantity: '3', lot: 'L-01', ref: 'DEV-L-3' }], false);
    const semSaldo = await reservar(a, j, [{ p: await palete(a, parcial.id), seg, q: '1' }]);
    expect(semSaldo.statusCode).toBe(409);
    expect(semSaldo.json<{ error: { message: string } }>().error.message).toMatch(/Sem saldo validado/);

    // Reservado e depois bloqueado: a saída é recusada no servidor, nada baixado.
    const l = await liberarMaterial(a, p, seg, '6');
    const liberado = PaleteDetalheSchema.parse(l.json());
    const r = await reservarOk(a, j, [{ p: liberado, seg, q: '4' }]);
    const b = await acao(liberado, { action: 'BLOQUEAR', segmentId: seg, reason: 'Recall fictício do lote' });
    expect(b.statusCode, b.body).toBe(200);
    const saida = await expedir(a, r, await corpoExpedicao(a, r));
    expect([saida.statusCode, codigoErro(saida)]).toEqual([409, 'MATERIAL_INELEGIVEL']);
    expect(saida.json<{ error: { message: string } }>().error.message).toMatch(/Recall fictício/);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '6', reservada: '4' });
    expect(await db.eventoEstoque.count({ where: { paleteId: p.id, tipo: 'EXPEDICAO' } })).toBe(0);
    // Revogar abaixo do reservado: recusado (a reserva precisa ser tratada antes).
    const revogar = await acao(PaleteDetalheSchema.parse(b.json()), { action: 'REVOGAR', segmentId: seg, quantity: '3', reason: 'Revisão (fictício)' });
    expect(revogar.statusCode).toBe(409);
  });

  it('FIFO pela entrada física comprovada, sem superar bloqueio ou critério; critérios de condição e lote', async () => {
    const antigo = await materialLiberado(a, 'FIFO-1', '5');
    const novo = await materialLiberado(a, 'FIFO-1', '5');
    // Material avariado conferido: só sai se a janela aceitar a condição.
    const avariado = await paleteComSaldo(a, [{ sku: 'FIFO-1', quantity: '2', lot: null, ref: null, condition: 'AVARIADO' }]);
    const segAv = segmentoDe(avariado, 'FIFO-1');
    await liberarMaterial(a, avariado, segAv, '2');
    const j = await janelaConfirmada(a, [pecas('100')], {
      criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: true, requireOrigin: true, requiredDocuments: [], notes: null },
    });
    const eleg = await fila(`janela=${j.id}&fila=ELEGIVEL&texto=FIFO-1`);
    expect(eleg.items.map((i) => i.palletCode)).toEqual([antigo.p.code, novo.p.code]);
    expect(eleg.items.every((i) => i.fifoDate !== null)).toBe(true);
    const pend = await fila(`janela=${j.id}&fila=PENDENTE&texto=FIFO-1`);
    expect(pend.items.find((i) => i.palletId === avariado.id)?.pendencies.map((x) => x.code)).toEqual(expect.arrayContaining(['CRITERIO_CONDICAO', 'CRITERIO_ORIGEM', 'CRITERIO_LOTE']));
    const r = await reservar(a, j, [{ p: await palete(a, avariado.id), seg: segAv, q: '1' }]);
    expect([r.statusCode, codigoErro(r)]).toEqual([409, 'MATERIAL_INELEGIVEL']);
    // Paginação no servidor.
    const pagina = await fila(`janela=${j.id}&fila=ELEGIVEL&texto=FIFO-1&tamanho=1&pagina=2`);
    expect([pagina.total, pagina.items.map((i) => i.palletCode)]).toEqual([2, [novo.p.code]]);
  });
});

describe('capacidade, unidades e medidas', () => {
  it('T22: m³ com volume desconhecido não reserva; base de peso não se mistura; caixas exigem contagem; várias linhas no mesmo palete contam um palete', async () => {
    const p = await paleteComSaldo(a, [
      { sku: 'CAP-A', quantity: '10', lot: 'L-1', ref: 'DEV-C-1' },
      { sku: 'CAP-B', quantity: '10', lot: 'L-2', ref: 'DEV-C-2' },
    ]);
    const sa = segmentoDe(p, 'CAP-A');
    const sb = segmentoDe(p, 'CAP-B');
    const p1 = PaleteDetalheSchema.parse((await liberarMaterial(a, p, sa, '10')).json());
    const p2 = PaleteDetalheSchema.parse((await liberarMaterial(a, p1, sb, '10')).json());
    const j = await janelaConfirmada(a, [pecas('100'), { metric: 'VOLUME_M3', limit: '3' }, { metric: 'PALETES', limit: '1' }]);
    const linhas = [
      { p: p2, seg: sa, q: '4' },
      { p: p2, seg: sb, q: '4' },
    ];
    const previa = PreviaReservaSchema.parse((await como(a.app, a.sup, { method: 'POST', url: `${API}/janelas/${j.id}/reservas/previa`, payload: corpoReserva(j, linhas) })).json());
    expect(previa.allowed).toBe(false);
    expect(previa.metrics.map((m) => [m.metric, m.state, m.requested])).toEqual([
      ['QUANTIDADE', 'OK', '8'],
      ['PALETES', 'OK', '1'],
      ['VOLUME_M3', 'PENDENTE', null],
    ]);
    const semVolume = await reservar(a, j, linhas);
    expect([semVolume.statusCode, codigoErro(semVolume)]).toEqual([409, 'CAPACIDADE_INSUFICIENTE']);
    expect(semVolume.json<{ error: { message: string } }>().error.message).toMatch(/Volume \(m³\) desconhecido/);
    const r = await reservarOk(a, j, linhas, [{ palletId: p.id, boxes: null, weightKg: null, weightBase: null, volumeM3: '0.85', measurementSource: 'Trena fictícia' }]);
    expect(r.metrics.map((m) => [m.metric, m.value])).toEqual(expect.arrayContaining([['PALETES', '1'], ['QUANTIDADE', '8'], ['VOLUME_M3', '0.85']]));

    const peso = await janelaConfirmada(a, [{ metric: 'PESO_KG', weightBase: 'BRUTO', limit: '500' }, { metric: 'CAIXAS', limit: '10' }]);
    const p3 = await materialLiberado(a, 'CAP-C', '5');
    const liquido = await reservar(a, peso, [{ p: p3.p, seg: p3.seg, q: '5' }], [{ palletId: p3.p.id, boxes: '2', weightKg: '120.5', weightBase: 'LIQUIDO', volumeM3: null, measurementSource: 'Balança fictícia' }]);
    expect([liquido.statusCode, codigoErro(liquido)]).toEqual([409, 'CAPACIDADE_INSUFICIENTE']);
    expect(liquido.json<{ error: { message: string } }>().error.message).toMatch(/bruto e líquido não se misturam/);
    const semCaixas = await reservar(a, peso, [{ p: p3.p, seg: p3.seg, q: '5' }], [{ palletId: p3.p.id, boxes: null, weightKg: '120.5', weightBase: 'BRUTO', volumeM3: null, measurementSource: 'Balança fictícia' }]);
    expect(semCaixas.json<{ error: { message: string } }>().error.message).toMatch(/Contagem de caixas desconhecid/);
    await reservarOk(a, peso, [{ p: p3.p, seg: p3.seg, q: '5' }], [{ palletId: p3.p.id, boxes: '2', weightKg: '120.5', weightBase: 'BRUTO', volumeM3: null, measurementSource: 'Balança fictícia' }]);
    expect(restricao(await janela(a, peso.id), 'PESO_KG')).toMatchObject({ reserved: '120.5', remaining: '379.5' });
  });

  it('cenários 6 e 9: várias restrições falham juntas; reserva com várias linhas é integral; peças não fracionam', async () => {
    const x = await materialLiberado(a, 'CAP-D', '10');
    const y = await materialLiberado(a, 'CAP-E', '3');
    const j = await janelaConfirmada(a, [pecas('8'), { metric: 'PALETES', limit: '1' }]);
    // Peças cabem (8), mas são 2 paletes: falha por paletes, com motivo específico.
    const duas = await reservar(a, j, [
      { p: x.p, seg: x.seg, q: '5' },
      { p: y.p, seg: y.seg, q: '3' },
    ]);
    expect([duas.statusCode, codigoErro(duas)]).toEqual([409, 'CAPACIDADE_INSUFICIENTE']);
    expect(duas.json<{ error: { message: string } }>().error.message).toMatch(/paletes/);
    // Uma linha acima do disponível derruba a seleção inteira.
    const j2 = await janelaConfirmada(a, [pecas('100'), { metric: 'PALETES', limit: '5' }]);
    const integral = await reservar(a, j2, [
      { p: x.p, seg: x.seg, q: '5' },
      { p: y.p, seg: y.seg, q: '4' },
    ]);
    expect([integral.statusCode, codigoErro(integral)]).toEqual([409, 'SALDO_INSUFICIENTE']);
    expect(await saldoAtual(a, x.p.id, x.seg)).toMatchObject({ reservada: '0' });
    expect(restricao(await janela(a, j2.id), 'QUANTIDADE').reserved).toBe('0');
    expect(await db.reservaJanela.count({ where: { janelaId: j2.id } })).toBe(0);
    const fracao = await reservar(a, j2, [{ p: x.p, seg: x.seg, q: '1.5' }]);
    expect(fracao.json<{ error: { message: string } }>().error.message).toMatch(/precisa ser inteira/);
  });
});

describe('movimentos, reconciliação e claims com reservas', () => {
  it('T13 / cenário 8: transferir a parte reservada é recusado; o material transferido chega pendente de liberação e o bloqueio acompanha', async () => {
    const { p, seg } = await materialLiberado(a, 'MOV-A', '10');
    const destino = await paleteComSaldo(a, [{ sku: 'MOV-Z', quantity: '1', lot: 'L-9', ref: 'DEV-M-9' }]);
    const j = await janelaConfirmada(a, [pecas('100')]);
    await reservarOk(a, j, [{ p, seg, q: '7' }]);
    const transferir = async (de: PaleteDetalhe, para: PaleteDetalhe, q: string) =>
      mutar(a.app, a.op, 'POST', `${API}/transferencias`, {
        sourcePalletId: de.id,
        destinationPalletId: para.id,
        segmentId: seg,
        quantity: q,
        expectedSourceVersion: (await palete(a, de.id)).version,
        expectedDestinationVersion: (await palete(a, para.id)).version,
        reason: 'Consolidação (fictício)',
      });
    const reservado = await transferir(p, destino, '4');
    expect([reservado.statusCode, codigoErro(reservado)]).toEqual([409, 'SALDO_INSUFICIENTE']);
    expect(reservado.json<{ error: { message: string } }>().error.message).toMatch(/disponível 3/);
    const ok = await transferir(p, destino, '3');
    expect(ok.statusCode, ok.body).toBe(200);
    const t = ResultadoTransferenciaSchema.parse(ok.json());
    expect(t.notes.join(' ')).toMatch(/pendente de liberação/);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '7', reservada: '7', liberada: '7' });
    expect(await saldoAtual(a, destino.id, seg)).toMatchObject({ quantidade: '3', liberada: '0' });

    // Material bloqueado chega bloqueado ao destino (sem desbloqueio por transferência).
    const b = await materialLiberado(a, 'MOV-B', '4');
    const bl = await acao(b.p, { action: 'BLOQUEAR', segmentId: b.seg, reason: 'Em avaliação (fictício)' });
    expect(bl.statusCode).toBe(200);
    const tb = await mutar(a.app, a.op, 'POST', `${API}/transferencias`, {
      sourcePalletId: b.p.id,
      destinationPalletId: destino.id,
      segmentId: b.seg,
      quantity: '2',
      expectedSourceVersion: (await palete(a, b.p.id)).version,
      expectedDestinationVersion: (await palete(a, destino.id)).version,
      reason: 'Separar para avaliação (fictício)',
    });
    expect(tb.statusCode, tb.body).toBe(200);
    const destinoDepois = await palete(a, destino.id);
    expect(destinoDepois.currentItems?.find((i) => i.segmentId === b.seg)?.blocked?.reason).toMatch(/Herdado do palete .*Em avaliação/);
    expect(destinoDepois.releaseState).toBe('BLOQUEADO');
  });

  it('reconciliação que reduz o saldo limita a parte liberada; abaixo do reservado é conflito registrado', async () => {
    const { p, seg } = await materialLiberado(a, 'REC-A', '10');
    const produto = await db.produto.findFirstOrThrow({ where: { sku: 'REC-A' } });
    const { resposta } = await reconciliar(a, p.id, [{ productId: produto.id, quantity: '8', lot: 'L-01', ref: 'DEV-FICT-1' }]);
    expect(resposta?.statusCode, resposta?.body).toBe(200);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '8', liberada: '8' });
    expect(await db.eventoLiberacao.count({ where: { paleteId: p.id, tipo: 'AJUSTE_SALDO' } })).toBe(1);
    const j = await janelaConfirmada(a, [pecas('100')]);
    await reservarOk(a, j, [{ p: await palete(a, p.id), seg, q: '6' }]);
    const r2 = await reconciliar(a, p.id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-FICT-1' }]);
    expect([r2.resposta?.statusCode, r2.resposta?.json<{ error: { code: string } }>().error.code]).toEqual([409, 'CONFLITO_SALDO']);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '8', reservada: '6' });
    await mutar(a.app, a.sup, 'POST', `${API}/conferencias/${r2.sessao.id}/cancelar`, { reason: 'Recontagem necessária (fictício)', expectedRevision: r2.sessao.revision });
  });

  it('cenário 16: quantidade vinculada a recuperação de claim não é reservada; a saída do restante preserva o vínculo e a quota', async () => {
    const { p, seg } = await materialLiberado(a, 'CLM-EXP', '10');
    const c = await criarClaim(a, claimFalta('CLM-EXP', {}, { quantity: '4', lot: 'L-01', originReference: 'DEV-FICT-1' }));
    const linha = c.lines[0]?.id ?? '';
    await recuperar(a, c.id, linha, p.id, seg, '4');
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '10', vinculada: '4', liberada: '10' });
    const j = await janelaConfirmada(a, [pecas('100')]);
    const atual = await palete(a, p.id);
    const demais = await reservar(a, j, [{ p: atual, seg, q: '7' }]);
    expect([demais.statusCode, codigoErro(demais)]).toEqual([409, 'SALDO_INSUFICIENTE']);
    expect(demais.json<{ error: { message: string } }>().error.message).toMatch(/vinculado a claim 4/);
    const pend = await fila(`janela=${j.id}&fila=PENDENTE&texto=CLM-EXP`);
    expect(pend.items[0]?.pendencies.map((x) => x.code)).toContain('VINCULADO_CLAIM');
    const r = await reservarOk(a, j, [{ p: atual, seg, q: '6' }]);
    await expedirOk(a, r, await corpoExpedicao(a, r));
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '4', vinculada: '4', reservada: '0' });
    const depois = await detalhe(a, c.id);
    expect(depois.lines[0]?.recovered).toBe('4');
    // A mesma quantidade comprovada não justifica outro claim (nada livre para nova recuperação).
    const outro = await criarClaim(a, claimFalta('CLM-EXP', {}, { quantity: '2', lot: 'L-01', originReference: 'DEV-FICT-1' }));
    const e = await evidenciaMaterial(a, outro.id, outro.lines[0]?.id ?? '', p.id, seg, '1');
    const pedido = await solicitar(a, outro.id, e, '1');
    expect([pedido.statusCode, codigoErro(pedido)]).toEqual([409, 'QUANTIDADE_INDISPONIVEL']);
  });
});
