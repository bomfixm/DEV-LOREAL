import {
  ExpedicaoDetalheSchema,
  JanelaDetalheSchema,
  PaginaHistoricoJanelaSchema,
  PaginaMaterialSchema,
  PaleteDetalheSchema,
  ReservaDetalheSchema,
} from '@praca-reversa/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ID_ESCOPO_PRACA, bancoDeTeste, chave, codigoErro, como, mutar } from './apoio.js';
import { criarPalete, montarAmbiente, palete, reconciliar, type Ambiente } from './claims-apoio.js';
import {
  API,
  SAIDA_FIM,
  cancelar,
  corpoExpedicao,
  criarJanela,
  dadosJanela,
  expedir,
  expedirOk,
  janela,
  janelaConfirmada,
  materialLiberado,
  pecas,
  reserva,
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

async function eventosExpedicao(paleteId: string) {
  return db.eventoEstoque.count({ where: { paleteId, tipo: 'EXPEDICAO' } });
}

describe('janelas: cadastro, situação e capacidade pendente', () => {
  it('rascunho guarda pendências; não reserva; confirmar exige autorização e intervalo; datas em UTC com fuso da operação', async () => {
    const { p, seg } = await materialLiberado(a, 'JAN-A1', '10');
    const rascunho = await criarJanela(a, dadosJanela([pecas(null)], { exitStart: null, exitEnd: null, authorization: { source: null, reference: null, date: null, responsible: null } }));
    expect(rascunho.state).toBe('RASCUNHO');
    expect(rascunho.code).toMatch(/^JAN-\d{6}$/);
    expect(rascunho.timeZone).toBe('America/Sao_Paulo');
    expect(rascunho.pendencies.join(' ')).toMatch(/Rascunho/);
    expect(rascunho.pendencies.join(' ')).toMatch(/saída autorizado pendente/);
    expect(rascunho.pendencies.join(' ')).toMatch(/não é ilimitado/);
    expect(restricao(rascunho, 'QUANTIDADE')).toMatchObject({ limit: null, remaining: null, state: 'PENDENTE' });

    const r = await reservar(a, rascunho, [{ p, seg, q: '1' }]);
    expect([r.statusCode, codigoErro(r)]).toEqual([409, 'SITUACAO_INVALIDA']);
    const c = await mutar(a.app, a.sup, 'POST', `${API}/janelas/${rascunho.id}/confirmar`, { expectedVersion: rascunho.version });
    expect([c.statusCode, codigoErro(c)]).toEqual([409, 'PENDENCIA_DOCUMENTAL']);
    expect(c.json<{ error: { message: string } }>().error.message).toMatch(/data\/horário de saída.*fonte da autorização/);

    // Confirmada com limite ainda pendente: capacidade desconhecida não é ilimitada.
    const comLimitePendente = await janelaConfirmada(a, [pecas(null)]);
    expect(comLimitePendente.state).toBe('CONFIRMADA');
    expect(comLimitePendente.exitEnd).toBe(SAIDA_FIM);
    const pendente = await reservar(a, comLimitePendente, [{ p, seg, q: '1' }]);
    expect([pendente.statusCode, codigoErro(pendente)]).toEqual([409, 'CAPACIDADE_INSUFICIENTE']);
    expect(pendente.json<{ error: { message: string } }>().error.message).toMatch(/pendente: capacidade desconhecida não é ilimitada/);

    // Limite zero: nenhuma reserva positiva.
    const zero = await janelaConfirmada(a, [pecas('0')]);
    const semCapacidade = await reservar(a, zero, [{ p, seg, q: '1' }]);
    expect([semCapacidade.statusCode, codigoErro(semCapacidade)]).toEqual([409, 'CAPACIDADE_INSUFICIENTE']);
    expect(semCapacidade.json<{ error: { message: string } }>().error.message).toMatch(/é zero/);

    // Sem restrição declarada: capacidade pendente.
    const semRestricao = await janelaConfirmada(a, []);
    expect((await reservar(a, semRestricao, [{ p, seg, q: '1' }])).statusCode).toBe(409);
    expect((await saldoAtual(a, p.id, seg))?.reservada).toBe('0');
  });

  it('cenário 2: saldo 12 reservado em 8 continua físico 12 e disponível 4; cancelar libera 8 e a capacidade, uma única vez', async () => {
    const { p, seg } = await materialLiberado(a, 'JAN-A2', '12');
    const j = await janelaConfirmada(a, [pecas('20')]);
    const r = await reservarOk(a, j, [{ p, seg, q: '8' }]);
    expect(r.code).toMatch(/^RES-\d{6}$/);
    expect(r.state).toBe('ATIVA');
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '12', reservada: '8' });
    const fila = PaginaMaterialSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/material-expedicao?janela=${j.id}&texto=JAN-A2` })).json());
    expect(fila.items.map((i) => [i.quantity, i.reserved, i.available])).toEqual([['12', '8', '4']]);
    expect(restricao(await janela(a, j.id), 'QUANTIDADE')).toMatchObject({ limit: '20', reserved: '8', shipped: '0', remaining: '12' });
    expect((await palete(a, p.id)).flowState).toBe('RESERVADO');

    const k = chave();
    const c1 = await cancelar(a, r, a.sup, k);
    expect(c1.statusCode, c1.body).toBe(200);
    expect(ReservaDetalheSchema.parse(c1.json()).state).toBe('CANCELADA');
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '12', reservada: '0', liberada: '12' });
    expect(restricao(await janela(a, j.id), 'QUANTIDADE')).toMatchObject({ reserved: '0', remaining: '20' });
    expect((await palete(a, p.id)).flowState).toBe('EM_ESTOQUE');
    // Mesma chave: resposta original; outra chave: nada é liberado de novo.
    expect((await cancelar(a, r, a.sup, k)).headers['idempotency-replayed']).toBe('true');
    const c2 = await cancelar(a, { id: r.id, version: r.version + 1 });
    expect([c2.statusCode, codigoErro(c2)]).toEqual([409, 'SITUACAO_INVALIDA']);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '12', reservada: '0' });
    expect(await db.eventoEstoque.count({ where: { paleteId: p.id, tipo: 'EXPEDICAO' } })).toBe(0);
  });

  it('cenário 11: 12 / reserva 8 / saída 6 / liberação 2 → saldo 6, reservado 0, expedido 6, restante 14; palete residual fica', async () => {
    const { p, seg } = await materialLiberado(a, 'JAN-A3', '12');
    const posicaoAntes = p.positionCode;
    const j = await janelaConfirmada(a, [pecas('20')]);
    const r = await reservarOk(a, j, [{ p, seg, q: '8' }]);
    const linha = r.lines[0]?.id ?? '';
    // Envio menor sem confirmar o restante: recusado, nada baixado.
    const semConfirmar = await expedir(a, r, await corpoExpedicao(a, r, { quantidades: { [linha]: '6' } }));
    expect([semConfirmar.statusCode, codigoErro(semConfirmar)]).toEqual([409, 'CONFLITO']);
    expect(semConfirmar.json<{ error: { message: string } }>().error.message).toMatch(/quantidade enviada e o restante a liberar/);
    // Aumento não é aceito na confirmação.
    const acima = await expedir(a, r, await corpoExpedicao(a, r, { quantidades: { [linha]: '9' } }));
    expect([acima.statusCode, codigoErro(acima)]).toEqual([409, 'CONFLITO']);
    expect(await eventosExpedicao(p.id)).toBe(0);

    const e = await expedirOk(a, r, await corpoExpedicao(a, r, { quantidades: { [linha]: '6' }, remainderAcknowledged: true }));
    expect(e.code).toMatch(/^EXP-\d{6}$/);
    expect(e.partial).toBe(true);
    expect(e.lines.map((l) => [l.reserved, l.shipped, l.releasedRemainder])).toEqual([['8', '6', '2']]);
    expect(e.metrics.map((m) => [m.reserved, m.shipped, m.released])).toEqual([['8', '6', '2']]);
    expect(e.stockEventIds).toHaveLength(1);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '6', reservada: '0', liberada: '6' });
    expect(restricao(await janela(a, j.id), 'QUANTIDADE')).toMatchObject({ limit: '20', reserved: '0', shipped: '6', remaining: '14' });
    const rr = await reserva(a, r.id);
    expect([rr.state, rr.partial, rr.lines[0]?.shipped, rr.lines[0]?.releasedRemainder]).toEqual(['CONSUMIDA', true, '6', '2']);
    // Palete com saldo restante continua na posição e em estoque (não é marcado expedido).
    const depois = await palete(a, p.id);
    expect([depois.flowState, depois.positionCode, depois.currentItems?.[0]?.quantity]).toEqual(['EM_ESTOQUE', posicaoAntes, '6']);
    // Evento de estoque com a baixa única.
    const ev = await db.eventoEstoque.findFirstOrThrow({ where: { paleteId: p.id, tipo: 'EXPEDICAO' }, include: { linhas: true } });
    expect([ev.expedicaoId, ev.linhas.map((l) => [l.quantidadeAnterior.toFixed(), l.delta.toFixed(), l.quantidadePosterior.toFixed()])]).toEqual([e.id, [['12', '-6', '6']]]);
  });

  it('cenário 10 / T24: confirmar a mesma reserva duas vezes (mesma chave, outra chave, outro payload) gera uma baixa', async () => {
    const { p, seg } = await materialLiberado(a, 'JAN-A4', '10');
    const j = await janelaConfirmada(a, [pecas('50')]);
    const r = await reservarOk(a, j, [{ p, seg, q: '4' }]);
    const corpo = await corpoExpedicao(a, r);
    const k = chave();
    const primeira = await expedir(a, r, corpo, a.sup, k);
    expect(primeira.statusCode, primeira.body).toBe(200);
    // Resposta perdida: reenvio com a mesma chave devolve a saída original.
    const reenvio = await expedir(a, r, corpo, a.sup, k);
    expect([reenvio.statusCode, reenvio.headers['idempotency-replayed']]).toEqual([200, 'true']);
    expect(ExpedicaoDetalheSchema.parse(reenvio.json()).id).toBe(ExpedicaoDetalheSchema.parse(primeira.json()).id);
    // Mesma chave com outro payload: rejeitada.
    const outroPayload = await expedir(a, r, { ...corpo, notes: 'outra coisa' }, a.sup, k);
    expect([outroPayload.statusCode, codigoErro(outroPayload)]).toEqual([422, 'IDEMPOTENCIA_CONFLITO']);
    // Outra chave: a reserva já foi consumida.
    const outraChave = await expedir(a, r, corpo);
    expect([outraChave.statusCode, codigoErro(outraChave)]).toEqual([409, 'SITUACAO_INVALIDA']);
    expect(outraChave.json<{ error: { message: string } }>().error.message).toMatch(/já foi confirmada \(EXP-/);
    expect(await eventosExpedicao(p.id)).toBe(1);
    expect(await db.expedicao.count({ where: { reservaId: r.id } })).toBe(1);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '6', reservada: '0' });
    // T26: cancelar a reserva já expedida não repõe estoque.
    const cancelamento = await cancelar(a, { id: r.id, version: (await reserva(a, r.id)).version });
    expect([cancelamento.statusCode, codigoErro(cancelamento)]).toEqual([409, 'SITUACAO_INVALIDA']);
    expect(cancelamento.json<{ error: { message: string } }>().error.message).toMatch(/já foi expedida/);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '6' });
    // O banco também impede apagar ou desfazer a expedição.
    const exp = await db.expedicao.findFirstOrThrow({ where: { reservaId: r.id } });
    await expect(db.$executeRawUnsafe(`DELETE FROM expedicao WHERE id = '${exp.id}'`)).rejects.toThrow(/JANELA_IMUTAVEL/);
    await expect(db.$executeRawUnsafe(`UPDATE linha_expedicao SET quantidade_enviada = 0 WHERE expedicao_id = '${exp.id}'`)).rejects.toThrow();
  });

  it('período, futuro, documentos exigidos (referência com zeros à esquerda) e responsável do escopo', async () => {
    const { p, seg } = await materialLiberado(a, 'JAN-A5', '5');
    const j = await janelaConfirmada(a, [pecas('10')], {
      criteria: { defined: true, acceptedConditions: ['SAUDAVEL'], acceptedOriginTypes: null, requireLot: false, requireOrigin: false, requiredDocuments: ['Romaneio fictício'], notes: null },
    });
    const r = await reservarOk(a, j, [{ p, seg, q: '5' }]);
    const fora = await expedir(a, r, await corpoExpedicao(a, r, { shippedAt: new Date(Date.parse(SAIDA_FIM) + 3_600_000).toISOString() }));
    expect(fora.statusCode).toBeGreaterThanOrEqual(400);
    const antes = await expedir(a, r, await corpoExpedicao(a, r, { shippedAt: new Date(Date.now() - 20 * 3_600_000).toISOString() }));
    expect([antes.statusCode, codigoErro(antes)]).toEqual([409, 'SITUACAO_INVALIDA']);
    expect(antes.json<{ error: { message: string } }>().error.message).toMatch(/fora do período autorizado/);
    const semDoc = await expedir(a, r, await corpoExpedicao(a, r));
    expect([semDoc.statusCode, codigoErro(semDoc)]).toEqual([409, 'PENDENCIA_DOCUMENTAL']);
    const outroResp = await expedir(a, r, await corpoExpedicao(a, r, { responsibleId: (await db.usuario.findUniqueOrThrow({ where: { login: 'analista.outro' } })).id, documents: [{ name: 'Romaneio fictício', reference: '000777', attachmentId: null }] }));
    expect(outroResp.statusCode).toBe(400);
    expect(await eventosExpedicao(p.id)).toBe(0);
    const e = await expedirOk(a, r, await corpoExpedicao(a, r, { documents: [{ name: 'Romaneio fictício', reference: '000777', attachmentId: null }] }));
    expect(e.documents).toEqual([{ name: 'Romaneio fictício', reference: '000777', attachmentId: null }]);
  });

  it('palete inteiro sai: posição liberada só quando todo o saldo validado foi enviado', async () => {
    const { p, seg } = await materialLiberado(a, 'JAN-A6', '7');
    const j = await janelaConfirmada(a, [pecas('100'), { metric: 'PALETES', limit: '3' }]);
    const r = await reservarOk(a, j, [{ p, seg, q: '7' }]);
    const parcial = await reservarOk(a, j, await (async () => {
      const outro = await materialLiberado(a, 'JAN-A6B', '9');
      return [{ p: outro.p, seg: outro.seg, q: '4' }];
    })());
    // Com saldo restante, o palete não sai.
    const recusa = await expedir(a, parcial, await corpoExpedicao(a, parcial, { loadUnits: [{ palletId: parcial.lines[0]?.palletId ?? '', boxes: null, weightKg: null, weightBase: null, volumeM3: null, measurementSource: null, palletLeaves: true }] }));
    expect([recusa.statusCode, codigoErro(recusa)]).toEqual([409, 'CONFLITO']);
    expect(recusa.json<{ error: { message: string } }>().error.message).toMatch(/saldo restante/);
    const e = await expedirOk(a, r, await corpoExpedicao(a, r, { loadUnits: [{ palletId: p.id, boxes: null, weightKg: null, weightBase: null, volumeM3: null, measurementSource: null, palletLeaves: true }] }));
    expect(e.loadUnits).toMatchObject([{ palletId: p.id, palletLeft: true }]);
    expect(restricao(await janela(a, j.id), 'PALETES')).toMatchObject({ shipped: '1', reserved: '1' });
    const saiu = await palete(a, p.id);
    expect([saiu.flowState, saiu.positionId, saiu.currentItems]).toEqual(['EXPEDIDO', null, []]);
    expect(await db.eventoLocalizacao.count({ where: { paleteId: p.id, tipo: 'SAIDA_EXPEDICAO' } })).toBe(1);
    // Palete expedido não recebe conteúdo nem conferência.
    const conf = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', scopeDescription: null, expectedVersion: saiu.version });
    expect(conf.statusCode).toBe(409);
  });

  it('cenário 15: retorno — aviso não repõe saldo; recebimento físico limitado ao enviado vira declaração; a entrada é a reconciliação', async () => {
    const { p, seg } = await materialLiberado(a, 'JAN-A7', '10');
    const j = await janelaConfirmada(a, [pecas('10')]);
    const r = await reservarOk(a, j, [{ p, seg, q: '6' }]);
    const e = await expedirOk(a, r, await corpoExpedicao(a, r));
    const linhaExp = e.lines[0]?.id ?? '';
    const anexo = await como(a.app, a.sup, {
      method: 'POST',
      url: `${API}/janelas/${j.id}/anexos`,
      payload: Buffer.from('%PDF-1.4\n% comprovante fictício de retorno\n'),
      headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': encodeURIComponent('retorno.pdf'), 'idempotency-key': chave() },
    });
    expect(anexo.statusCode, anexo.body).toBe(200);
    const anexoId = anexo.json<{ id: string }>().id;
    const base = { expectedVersion: e.version, receivedAt: new Date(Date.now() - 60_000).toISOString(), reason: 'Recusa fictícia do cliente', condition: 'SAUDAVEL' as const, notes: null };

    const aviso = await mutar(a.app, a.sup, 'POST', `${API}/expedicoes/${e.id}/retornos`, { ...base, type: 'AVISO_DOCUMENTAL', lines: [{ expeditionLineId: linhaExp, quantity: '6' }], attachmentIds: [], destinationPalletId: null });
    expect(aviso.statusCode, aviso.body).toBe(200);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '4' });
    expect(ExpedicaoDetalheSchema.parse(aviso.json()).lines[0]?.returned).toBe('0');

    const destino = await criarPalete(a);
    const fisico = (q: string, k?: string) =>
      mutar(a.app, a.sup, 'POST', `${API}/expedicoes/${e.id}/retornos`, { ...base, type: 'RECEBIMENTO_FISICO', lines: [{ expeditionLineId: linhaExp, quantity: q }], attachmentIds: [anexoId], destinationPalletId: destino.id }, k);
    const acima = await fisico('7');
    expect([acima.statusCode, codigoErro(acima)]).toEqual([409, 'QUANTIDADE_INDISPONIVEL']);
    // Destino reconciliado/com saldo (ID de outra unidade física) não serve.
    const naoServe = await mutar(a.app, a.sup, 'POST', `${API}/expedicoes/${e.id}/retornos`, { ...base, type: 'RECEBIMENTO_FISICO', lines: [{ expeditionLineId: linhaExp, quantity: '1' }], attachmentIds: [anexoId], destinationPalletId: p.id });
    expect(naoServe.statusCode).toBe(409);
    const ok = await fisico('4');
    expect(ok.statusCode, ok.body).toBe(200);
    const comRetorno = ExpedicaoDetalheSchema.parse(ok.json());
    expect(comRetorno.lines[0]?.returned).toBe('4');
    expect(comRetorno.returns.map((x) => x.type)).toEqual(['AVISO_DOCUMENTAL', 'RECEBIMENTO_FISICO']);
    expect(comRetorno.returns[1]?.nextStep).toMatch(/reconciliação/);
    expect(await fisico('3').then((x) => [x.statusCode, codigoErro(x)])).toEqual([409, 'QUANTIDADE_INDISPONIVEL']);
    // Nenhum saldo repõe sozinho; capacidade da janela não volta; a saída original continua.
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '4' });
    expect(restricao(await janela(a, j.id), 'QUANTIDADE')).toMatchObject({ shipped: '6', remaining: '4' });
    expect(await db.expedicao.count({ where: { id: e.id } })).toBe(1);
    const declarado = await palete(a, destino.id);
    expect(declarado.declaredItems?.map((i) => [i.sku, i.quantity, i.lot, i.originReference])).toEqual([['JAN-A7', '4', 'L-01', 'DEV-FICT-1']]);
    expect(declarado.currentItems).toBeNull();
    // A entrada acontece pela conferência e reconciliação do palete de destino.
    const produto = await db.produto.findFirstOrThrow({ where: { sku: 'JAN-A7' } });
    const { resposta } = await reconciliar(a, destino.id, [{ productId: produto.id, quantity: '4', lot: 'L-01', ref: 'DEV-FICT-1' }]);
    expect(resposta?.statusCode, resposta?.body).toBe(200);
    const entrou = await palete(a, destino.id);
    expect(entrou.currentItems?.map((i) => [i.quantity, i.released])).toEqual([['4', '0']]);
  });

  it('correção de informação versionada sem efeito físico; janela com reservas ativas exige liberação explícita para encerrar', async () => {
    const { p, seg } = await materialLiberado(a, 'JAN-A8', '10');
    const j = await janelaConfirmada(a, [pecas('10')]);
    const r1 = await reservarOk(a, j, [{ p, seg, q: '3' }]);
    const e = await expedirOk(a, r1, await corpoExpedicao(a, r1));
    const corr = await mutar(a.app, a.sup, 'POST', `${API}/expedicoes/${e.id}/correcao`, { expectedVersion: e.version, reason: 'Observação digitada errada', notes: 'Observação corrigida (fictícia)' });
    expect(corr.statusCode, corr.body).toBe(200);
    const corrigida = ExpedicaoDetalheSchema.parse(corr.json());
    expect([corrigida.version, corrigida.notes, corrigida.corrections.length]).toEqual([2, 'Observação corrigida (fictícia)', 1]);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '7' });

    const atual = await janela(a, j.id);
    const r2 = await reservarOk(a, atual, [{ p: await palete(a, p.id), seg, q: '2' }]);
    // Reduzir o limite abaixo de reservado + expedido: bloqueado.
    const reduzir = await mutar(a.app, a.sup, 'PUT', `${API}/janelas/${j.id}`, {
      ...dadosJanela([pecas('4')]),
      expectedVersion: (await janela(a, j.id)).version,
      ruleChange: { justification: 'Cliente reduziu a janela (fictício)', source: 'E-mail fictício 000124' },
    });
    expect([reduzir.statusCode, codigoErro(reduzir)]).toEqual([409, 'CAPACIDADE_INSUFICIENTE']);
    // Alterar regra de janela confirmada sem justificativa: recusado.
    const semJust = await mutar(a.app, a.sup, 'PUT', `${API}/janelas/${j.id}`, { ...dadosJanela([pecas('12')]), expectedVersion: (await janela(a, j.id)).version });
    expect(semJust.statusCode).toBe(400);
    const aumentar = await mutar(a.app, a.sup, 'PUT', `${API}/janelas/${j.id}`, {
      ...dadosJanela([pecas('12')]),
      expectedVersion: (await janela(a, j.id)).version,
      ruleChange: { justification: 'Cliente ampliou a janela (fictício)', source: 'E-mail fictício 000125' },
    });
    expect(aumentar.statusCode, aumentar.body).toBe(200);
    const ampliada = JanelaDetalheSchema.parse(aumentar.json());
    expect([ampliada.rulesVersion, ampliada.ruleVersions.length, restricao(ampliada, 'QUANTIDADE').remaining]).toEqual([2, 2, '7']);
    // A fotografia da reserva anterior não muda.
    expect((await reserva(a, r2.id)).rulesVersion).toBe(1);

    const encerrar = (liberar: boolean) =>
      mutar(a.app, a.sup, 'POST', `${API}/janelas/${j.id}/encerrar`, { expectedVersion: ampliada.version, reason: 'Janela realizada (fictício)', releaseActiveReservations: liberar });
    const bloqueado = await encerrar(false);
    expect([bloqueado.statusCode, codigoErro(bloqueado)]).toEqual([409, 'SITUACAO_INVALIDA']);
    expect(bloqueado.json<{ error: { message: string } }>().error.message).toMatch(/reserva\(s\) ativa\(s\)/);
    const cancelarJanela = await mutar(a.app, a.sup, 'POST', `${API}/janelas/${j.id}/cancelar`, { expectedVersion: ampliada.version, reason: 'teste', releaseActiveReservations: true });
    expect([cancelarJanela.statusCode, codigoErro(cancelarJanela)]).toEqual([409, 'SITUACAO_INVALIDA']);
    const encerrada = await encerrar(true);
    expect(encerrada.statusCode, encerrada.body).toBe(200);
    const fim = JanelaDetalheSchema.parse(encerrada.json());
    expect([fim.state, fim.activeReservations, restricao(fim, 'QUANTIDADE').shipped, restricao(fim, 'QUANTIDADE').reserved]).toEqual(['ENCERRADA', 0, '3', '0']);
    expect((await reserva(a, r2.id)).state).toBe('LIBERADA');
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '7', reservada: '0' });
    const historico = PaginaHistoricoJanelaSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/janelas/${j.id}/historico` })).json());
    expect(historico.items.map((h) => h.type)).toEqual(
      expect.arrayContaining(['JANELA_CRIADA', 'JANELA_CONFIRMADA', 'RESERVA_CRIADA', 'EXPEDICAO_CONFIRMADA', 'EXPEDICAO_CORRIGIDA', 'REGRAS_ALTERADAS', 'RESERVA_LIBERADA', 'JANELA_ENCERRADA']),
    );
    // Janela encerrada não muda.
    expect((await mutar(a.app, a.sup, 'PUT', `${API}/janelas/${j.id}`, { ...dadosJanela([pecas('12')]), expectedVersion: fim.version })).statusCode).toBe(409);
  });

  it('preparação: diferença registrada sem ajustar saldo; medidas maiores revalidam a capacidade (m³)', async () => {
    const { p, seg } = await materialLiberado(a, 'JAN-A9', '10');
    const j = await janelaConfirmada(a, [pecas('100'), { metric: 'VOLUME_M3', limit: '2.5' }]);
    const unidade = { palletId: p.id, boxes: null, weightKg: null, weightBase: null, volumeM3: '1.2', measurementSource: 'Trena fictícia' };
    const r = await reservarOk(a, j, [{ p, seg, q: '10' }], [unidade]);
    expect(restricao(await janela(a, j.id), 'VOLUME_M3')).toMatchObject({ reserved: '1.2', remaining: '1.3' });
    const resp = (await db.usuario.findUniqueOrThrow({ where: { login: 'operador' } })).id;
    const preparar = (extra: Record<string, unknown>, versao: number) =>
      mutar(a.app, a.op, 'POST', `${API}/reservas/${r.id}/preparacao`, {
        expectedVersion: versao,
        preparedAt: new Date(Date.now() - 600_000).toISOString(),
        responsibleId: resp,
        lines: [{ lineId: r.lines[0]?.id, quantity: '9' }],
        notes: null,
        ...extra,
      });
    const grande = await preparar({ loadUnits: [{ ...unidade, volumeM3: '2.6' }] }, r.version);
    expect([grande.statusCode, codigoErro(grande)]).toEqual([409, 'CAPACIDADE_INSUFICIENTE']);
    const ok = await preparar({ loadUnits: [{ ...unidade, volumeM3: '1.4' }] }, r.version);
    expect(ok.statusCode, ok.body).toBe(200);
    const preparada = ReservaDetalheSchema.parse(ok.json());
    expect([preparada.preparation.state, preparada.lines[0]?.prepared, preparada.loadUnits[0]?.volumeM3, preparada.loadUnits[0]?.version]).toEqual(['DIVERGENTE', '9', '1.4', 2]);
    expect(preparada.preparation.differences.join(' ')).toMatch(/separado 9 de 10/);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '10', reservada: '10' });
    const jPrep = await janela(a, j.id);
    expect([jPrep.state, restricao(jPrep, 'VOLUME_M3').reserved]).toEqual(['PREPARACAO', '1.4']);
    // Saída com volume real menor libera a diferença; maior que o reservado exige nova medição.
    const maior = await expedir(a, preparada, await corpoExpedicao(a, preparada, { loadUnits: [{ ...unidade, volumeM3: '1.5', palletLeaves: false }] }));
    expect([maior.statusCode, codigoErro(maior)]).toEqual([409, 'CAPACIDADE_INSUFICIENTE']);
    const semVolume = await expedir(a, preparada, await corpoExpedicao(a, preparada));
    expect([semVolume.statusCode, codigoErro(semVolume)]).toEqual([409, 'CAPACIDADE_INSUFICIENTE']);
    const e = await expedirOk(a, preparada, await corpoExpedicao(a, preparada, { loadUnits: [{ ...unidade, volumeM3: '1.1', palletLeaves: false }] }));
    expect(e.metrics.find((m) => m.metric === 'VOLUME_M3')).toMatchObject({ reserved: '1.4', shipped: '1.1', released: '0.3' });
    expect(restricao(await janela(a, j.id), 'VOLUME_M3')).toMatchObject({ reserved: '0', shipped: '1.1', remaining: '1.4' });
    // Lista de preparação: CSV interno com endereço atual e fotografia.
    const csv = await como(a.app, a.sup, { method: 'GET', url: `${API}/reservas/${r.id}/preparacao.csv` });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toMatch(/Lista de preparação — documento operacional interno/);
    expect(csv.body).toMatch(/JAN-A9/);
  });

  it('dados do palete mudaram desde a revisão: reserva recusada com os dados atuais; movimento mantém a reserva e atualiza o endereço atual', async () => {
    const { p, seg } = await materialLiberado(a, 'JAN-A10', '6');
    const j = await janelaConfirmada(a, [pecas('10')]);
    const r = await reservarOk(a, j, [{ p, seg, q: '2' }]);
    // Mover o palete (etapa 05) não muda estoque nem capacidade; a lista mostra o endereço atual.
    const atual = await palete(a, p.id);
    const livre = await db.$queryRaw<{ id: string; codigo: string }[]>`
      SELECT pos.id::text, pos.codigo FROM posicao pos JOIN layout l ON l.id = pos.layout_id
       WHERE pos.escopo_id = ${ID_ESCOPO_PRACA}::uuid AND l.ativo AND pos.disponivel AND pos.retirada_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM palete x WHERE x.posicao_id = pos.id) ORDER BY pos.codigo LIMIT 1`;
    const destino = livre[0];
    if (!destino) throw new Error('sem posição livre');
    const mov = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/movimentos`, { destinationPositionId: destino.id, confirmedPositionCode: destino.codigo, expectedVersion: atual.version, reason: 'Reorganização (fictício)' });
    expect(mov.statusCode, mov.body).toBe(200);
    const rr = await reserva(a, r.id);
    expect([rr.lines[0]?.snapshotPositionCode, rr.lines[0]?.currentPositionCode, rr.state]).toEqual([atual.positionCode, destino.codigo, 'ATIVA']);
    expect(await saldoAtual(a, p.id, seg)).toMatchObject({ quantidade: '6', reservada: '2' });
    // Revisão antiga (versão do palete anterior ao movimento): recusada.
    const velha = await reservar(a, await janela(a, j.id), [{ p: atual, seg, q: '1' }]);
    expect([velha.statusCode, codigoErro(velha)]).toEqual([409, 'CONFLITO_VERSAO']);
    const nova = await reservar(a, await janela(a, j.id), [{ p: PaleteDetalheSchema.parse(mov.json<{ pallet: unknown }>().pallet), seg, q: '1' }]);
    expect(nova.statusCode, nova.body).toBe(200);
  });
});
