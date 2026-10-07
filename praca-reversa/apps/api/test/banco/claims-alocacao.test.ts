import { ClaimDetalheSchema, ConferenciaDetalheSchema, PaginaHistoricoClaimSchema, ResultadoTransferenciaSchema, normalizarQuantidade } from '@praca-reversa/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_PRACA, bancoDeTeste, chave, codigoErro, como, mutar } from './apoio.js';
import {
  API,
  candidatos,
  claimFalta,
  criarClaim,
  criarPalete,
  criarProduto,
  detalhe,
  evidenciaMaterial,
  montarAmbiente,
  palete,
  reconciliar,
  recuperar,
  segmentoDe,
  solicitar,
  validarRec,
  type Ambiente,
} from './claims-apoio.js';

/**
 * Alocação de recuperações ao material rastreável (etapa 07; T19): a mesma
 * quantidade física não sustenta duas recuperações, nem em concorrência; a
 * transferência leva o vínculo junto sem criar cota nova; reconciliação não
 * apaga quantidade vinculada; estorno explícito libera; idempotência, falha
 * sem gravação parcial e versões desatualizadas. Dados fictícios.
 */
let db: Banco;
let a: Ambiente;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  a = await montarAmbiente(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function vinculada(paleteId: string): Promise<string> {
  const [linha] = await db.$queryRaw<{ v: string }[]>`SELECT coalesce(sum(quantidade_vinculada), 0)::text AS v FROM saldo_estoque WHERE palete_id = ${paleteId}::uuid`;
  return normalizarQuantidade(linha?.v ?? '0');
}

/** Cancela a contagem concluída cuja reconciliação foi recusada (pendência registrada). */
async function cancelar(sessaoId: string) {
  const s = ConferenciaDetalheSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/conferencias/${sessaoId}` })).json());
  const r = await mutar(a.app, a.sup, 'POST', `${API}/conferencias/${sessaoId}/cancelar`, { expectedRevision: s.revision, reason: 'Contagem recusada na reconciliação (teste)' });
  expect(r.statusCode, r.body).toBe(200);
}

async function transferir(de: string, para: string, segmento: string, quantidade: string) {
  const [pd, pp] = [await palete(a, de), await palete(a, para)];
  return mutar(a.app, a.op, 'POST', `${API}/transferencias`, {
    sourcePalletId: de,
    destinationPalletId: para,
    segmentId: segmento,
    quantity: quantidade,
    expectedSourceVersion: pd.version,
    expectedDestinationVersion: pp.version,
    reason: 'Consolidação de teste',
  });
}

describe('T19: a mesma quantidade física não sustenta recuperações incompatíveis', () => {
  it('dois casos sobre a mesma quantidade: o segundo é bloqueado e nada passa do saldo', async () => {
    const produto = await criarProduto(a, '000900', 'Xampu fictício');
    const p = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const seg = segmentoDe(p, '000900');
    const c1 = await criarClaim(a, claimFalta('000900'));
    const c2 = await criarClaim(a, claimFalta('000900'));
    await recuperar(a, c1.id, c1.lines[0]?.id ?? '', p.id, seg, '5');
    const cand = await candidatos(a, c2.id, c2.lines[0]?.id ?? '');
    expect(cand.items[0]).toMatchObject({ eligible: '0', linked: '5', validatable: false });
    const e = await evidenciaMaterial(a, c2.id, c2.lines[0]?.id ?? '', p.id, seg, '3');
    const s = await solicitar(a, c2.id, e, '3');
    expect(codigoErro(s)).toBe('QUANTIDADE_INDISPONIVEL');
    expect(await vinculada(p.id)).toBe('5');
    // Nem por fora do serviço: o banco recusa vincular além do saldo.
    await expect(db.$executeRaw`UPDATE saldo_estoque SET quantidade_vinculada = quantidade_vinculada + 1 WHERE palete_id = ${p.id}::uuid`).rejects.toThrow(
      /saldo_vinculo_dentro_do_saldo/,
    );
  });

  it('10 elegíveis com validações concorrentes de 8 e 6 (casos diferentes): total vinculado ≤ 10', async () => {
    const produto = await criarProduto(a, '000901', 'Condicionador fictício');
    const p = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '10', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const seg = segmentoDe(p, '000901');
    const c1 = await criarClaim(a, claimFalta('000901'));
    const c2 = await criarClaim(a, claimFalta('000901'));
    const e1 = await evidenciaMaterial(a, c1.id, c1.lines[0]?.id ?? '', p.id, seg, '8');
    const e2 = await evidenciaMaterial(a, c2.id, c2.lines[0]?.id ?? '', p.id, seg, '6');
    expect((await solicitar(a, c1.id, e1, '8')).statusCode).toBe(200);
    expect((await solicitar(a, c2.id, e2, '6')).statusCode).toBe(200);
    const [r1, r2] = await Promise.all([validarRec(a, c1.id, e1, '8'), validarRec(a, c2.id, e2, '6')]);
    const codigos = [r1.statusCode, r2.statusCode].sort();
    expect(codigos).toEqual([200, 409]);
    const recusada = r1.statusCode === 409 ? r1 : r2;
    expect(codigoErro(recusada)).toBe('QUANTIDADE_INDISPONIVEL');
    const total = await db.$queryRaw<{ q: string }[]>`SELECT coalesce(sum(quantidade), 0)::text AS q FROM recuperacao_claim WHERE segmento_id = ${seg}::uuid AND situacao = 'ATIVA'`;
    expect(Number(total[0]?.q)).toBeLessThanOrEqual(10);
    expect(await vinculada(p.id)).toBe(normalizarQuantidade(total[0]?.q ?? '0'));
    // A tentativa recusada fica auditada; a evidência continua aguardando decisão.
    const auditoria = await db.eventoAuditoria.count({ where: { escopoId: ID_ESCOPO_PRACA, acao: 'CLAIM_VALIDACAO_RECUSADA', resultado: 'NEGADO' } });
    expect(auditoria).toBe(1);
  });

  it('mesma linha (12) com validações concorrentes de 8 e 6 em paletes diferentes: a linha não passa de 12', async () => {
    const produto = await criarProduto(a, '000902', 'Máscara fictícia');
    const pa = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '10', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const pb = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '10', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const c = await criarClaim(a, claimFalta('000902'));
    const linha = c.lines[0]?.id ?? '';
    const e1 = await evidenciaMaterial(a, c.id, linha, pa.id, segmentoDe(pa, '000902'), '8');
    const e2 = await evidenciaMaterial(a, c.id, linha, pb.id, segmentoDe(pb, '000902'), '6');
    await solicitar(a, c.id, e1, '8');
    await solicitar(a, c.id, e2, '6');
    const [r1, r2] = await Promise.all([validarRec(a, c.id, e1, '8'), validarRec(a, c.id, e2, '6')]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    const d = await detalhe(a, c.id);
    expect(Number(d.lines[0]?.recovered)).toBeLessThanOrEqual(12);
    expect(d.state).toBe('VALIDACAO_PENDENTE');
  });
});

describe('Transferência, reconciliação e estorno preservam a alocação', () => {
  it('transferência leva o vínculo junto (parte livre primeiro); destino não ganha cota nova; correção devolve', async () => {
    const produto = await criarProduto(a, '000910', 'Gel fictício');
    const pa = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const pb = await criarPalete(a);
    const seg = segmentoDe(pa, '000910');
    const c1 = await criarClaim(a, claimFalta('000910'));
    const d1 = await recuperar(a, c1.id, c1.lines[0]?.id ?? '', pa.id, seg, '3');
    const evidenciaAntiga = d1.evidences[0];
    // 4 de 5: sai a parte livre (2) e 2 vinculadas acompanham o material.
    const t = await transferir(pa.id, pb.id, seg, '4');
    expect(t.statusCode, t.body).toBe(200);
    const resultado = ResultadoTransferenciaSchema.parse(t.json());
    expect(resultado.notes.join(' ')).toContain('acompanharam o material');
    expect(await vinculada(pa.id)).toBe('1');
    expect(await vinculada(pb.id)).toBe('2');
    const depois = await detalhe(a, c1.id);
    expect(depois.recoveries[0]?.currentLocations.map((l) => [l.palletId, l.quantity]).sort()).toEqual([[pa.id, '1'], [pb.id, '2']].sort());
    // Histórico da evidência preserva o palete e o endereço da época.
    expect(depois.evidences[0]?.pallet?.id).toBe(pa.id);
    expect(depois.evidences[0]?.positionCodeAtTime).toBe(evidenciaAntiga?.positionCodeAtTime);
    const hist = PaginaHistoricoClaimSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims/${c1.id}/historico` })).json());
    expect(hist.items.some((e) => e.type === 'VINCULO_MOVIDO')).toBe(true);
    // Outro caso não reutiliza a quantidade no destino: elegível em B = 4 − 2 = 2.
    const c2 = await criarClaim(a, claimFalta('000910'));
    const pbAtual = await palete(a, pb.id);
    expect(pbAtual.currentItems?.[0]).toMatchObject({ quantity: '4', claimLinked: '2' });
    const e = await evidenciaMaterial(a, c2.id, c2.lines[0]?.id ?? '', pb.id, seg, '3');
    expect(codigoErro(await solicitar(a, c2.id, e, '3'))).toBe('QUANTIDADE_INDISPONIVEL');
    // Correção da transferência: devolve 4 (as 2 livres de B primeiro, depois as vinculadas).
    const corr = await mutar(a.app, a.sup, 'POST', `${API}/transferencias/${resultado.event.id}/correcao`, {
      quantity: '4',
      expectedSourceVersion: pbAtual.version,
      expectedDestinationVersion: (await palete(a, pa.id)).version,
      reason: 'Transferência desfeita (teste)',
    });
    expect(corr.statusCode, corr.body).toBe(200);
    expect(await vinculada(pa.id)).toBe('3');
    expect(await vinculada(pb.id)).toBe('0');
  });

  it('reconciliação que deixaria o saldo abaixo do vinculado é recusada com pendência; mudança de condição também', async () => {
    const produto = await criarProduto(a, '000911', 'Óleo fictício');
    const pa = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const seg = segmentoDe(pa, '000911');
    const c1 = await criarClaim(a, claimFalta('000911'));
    await recuperar(a, c1.id, c1.lines[0]?.id ?? '', pa.id, seg, '4');
    const recontagem = await reconciliar(a, pa.id, [{ productId: produto.id, quantity: '2', lot: 'L-01', ref: 'DEV-A-01' }]);
    expect(recontagem.resposta?.statusCode).toBe(409);
    expect(codigoErro(recontagem.resposta ?? (undefined as never))).toBe('CONFLITO_SALDO');
    expect(recontagem.resposta?.json<{ error: { message: string } }>().error.message).toContain('vinculados a recuperações de claim');
    await cancelar(recontagem.sessao.id);
    // Mesmo material registrado como avariado: o segmento saudável iria a zero → recusado (não cria cota nova).
    const avaria = await reconciliar(a, pa.id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-A-01', condition: 'AVARIADO' }]);
    expect(avaria.resposta?.statusCode).toBe(409);
    await cancelar(avaria.sessao.id);
    expect(await vinculada(pa.id)).toBe('4');
    expect((await palete(a, pa.id)).currentItems?.[0]?.quantity).toBe('5');
    // Recontagem que preserva o vinculado é aceita.
    const ok = await reconciliar(a, pa.id, [{ productId: produto.id, quantity: '4', lot: 'L-01', ref: 'DEV-A-01' }]);
    expect(ok.resposta?.statusCode, ok.resposta?.body).toBe(200);
  });

  it('estorno explícito libera a quantidade, com motivo e evento vinculado à recuperação original', async () => {
    const produto = await criarProduto(a, '000912', 'Tônico fictício');
    const pa = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const seg = segmentoDe(pa, '000912');
    const c1 = await criarClaim(a, claimFalta('000912'));
    const d = await recuperar(a, c1.id, c1.lines[0]?.id ?? '', pa.id, seg, '5');
    const rec = d.recoveries[0];
    const r = await mutar(a.app, a.analista, 'POST', `${API}/claims/${c1.id}/recuperacoes/${rec?.id ?? ''}/estornar`, {
      expectedVersion: rec?.version,
      reason: 'Material era de outro cliente (fictício).',
    });
    expect(r.statusCode, r.body).toBe(200);
    const depois = ClaimDetalheSchema.parse(r.json());
    expect(depois.recoveries[0]).toMatchObject({ state: 'ESTORNADA', currentLocations: [] });
    expect(depois.lines[0]).toMatchObject({ recovered: '0', remaining: '12' });
    expect(await vinculada(pa.id)).toBe('0');
    const hist = PaginaHistoricoClaimSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims/${c1.id}/historico` })).json());
    expect(hist.items.find((e) => e.type === 'RECUPERACAO_ESTORNADA')?.relatedId).toBe(rec?.id);
    // Recuperação não é apagada nem volta a ativa.
    await expect(db.$executeRaw`UPDATE recuperacao_claim SET situacao = 'ATIVA', versao = versao + 1 WHERE id = ${rec?.id ?? ''}::uuid`).rejects.toThrow(/CLAIM_IMUTAVEL/);
  });
});

describe('Idempotência, falha sem gravação parcial e versões', () => {
  it('reenvio com a mesma chave devolve o original; chave com outro conteúdo é recusada; falha não grava nada', async () => {
    const produto = await criarProduto(a, '000920', 'Batom fictício');
    const pa = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const seg = segmentoDe(pa, '000920');
    const c = await criarClaim(a, claimFalta('000920'));
    const e = await evidenciaMaterial(a, c.id, c.lines[0]?.id ?? '', pa.id, seg, '5');
    await solicitar(a, c.id, e, '5');
    // Falha (quantidade acima do solicitado): nada é gravado e a mesma chave pode ser usada de novo.
    const k = chave();
    const falha = await validarRec(a, c.id, e, '6', {}, k);
    expect(falha.statusCode).toBe(400);
    let d = await detalhe(a, c.id);
    expect(d.recoveries).toHaveLength(0);
    expect(d.evidences[0]?.state).toBe('VALIDACAO_SOLICITADA');
    expect(await vinculada(pa.id)).toBe('0');
    const ok = await validarRec(a, c.id, e, '5', {}, k);
    expect(ok.statusCode, ok.body).toBe(200);
    // Clique duplo/reenvio: mesma resposta, sem segunda recuperação.
    const repetido = await mutar(a.app, a.analista, 'POST', `${API}/claims/${c.id}/evidencias/${e}/validar`, {
      expectedVersion: 2,
      quantity: '5',
      justification: 'Material conferido e compatível (teste).',
    }, k);
    expect(repetido.statusCode).toBe(200);
    expect(repetido.headers['idempotency-replayed']).toBe('true');
    expect(repetido.json()).toEqual(ok.json());
    const outro = await mutar(a.app, a.analista, 'POST', `${API}/claims/${c.id}/evidencias/${e}/validar`, { expectedVersion: 2, quantity: '4', justification: 'Outra quantidade com a mesma chave.' }, k);
    expect(codigoErro(outro)).toBe('IDEMPOTENCIA_CONFLITO');
    d = await detalhe(a, c.id);
    expect(d.recoveries).toHaveLength(1);
    expect(await vinculada(pa.id)).toBe('5');
  });

  it('revisão antiga não confirma dados alterados: linha editada ou saldo mudado depois da evidência', async () => {
    const produto = await criarProduto(a, '000921', 'Kit fictício');
    const pa = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const pb = await criarPalete(a);
    const seg = segmentoDe(pa, '000921');
    const c = await criarClaim(a, claimFalta('000921'));
    const linha = c.lines[0];
    if (!linha) throw new Error('linha');
    const e = await evidenciaMaterial(a, c.id, linha.id, pa.id, seg, '2');
    await solicitar(a, c.id, e, '2');
    // Versão da evidência desatualizada.
    const velha = await mutar(a.app, a.analista, 'POST', `${API}/claims/${c.id}/evidencias/${e}/validar`, { expectedVersion: 1, quantity: '2', justification: 'Revisão antiga da evidência.' });
    expect(codigoErro(velha)).toBe('CONFLITO_VERSAO');
    // Saldo mudou depois da evidência (transferência de 1 unidade).
    expect((await transferir(pa.id, pb.id, seg, '1')).statusCode).toBe(200);
    const mudouSaldo = await validarRec(a, c.id, e, '2');
    expect(codigoErro(mudouSaldo)).toBe('CONFLITO_VERSAO');
    // Linha editada depois de outra evidência.
    const d = await detalhe(a, c.id);
    const rej = await mutar(a.app, a.analista, 'POST', `${API}/claims/${c.id}/evidencias/${e}/rejeitar`, { expectedVersion: d.evidences[0]?.version, justification: 'Saldo mudou: registrar nova evidência.' });
    expect(rej.statusCode, rej.body).toBe(200);
    const e2 = await evidenciaMaterial(a, c.id, linha.id, pa.id, seg, '2');
    await solicitar(a, c.id, e2, '2');
    const atual = await detalhe(a, c.id);
    const alt = await mutar(a.app, a.analista, 'PUT', `${API}/claims/${c.id}`, {
      ...claimFalta('000921'),
      externalReference: atual.externalReference,
      expectedVersion: atual.version,
      reasonForChange: 'Lote corrigido',
      lines: [{ ...claimFalta('000921').lines[0], id: linha.id, lot: 'L-02' }],
    });
    expect(alt.statusCode, alt.body).toBe(200);
    const mudouLinha = await validarRec(a, c.id, e2, '2');
    expect(codigoErro(mudouLinha)).toBe('CONFLITO_VERSAO');
  });
});

describe('Candidatos acompanham movimentações; histórico não prova presença', () => {
  it('palete esvaziado aparece só como histórico; o destino passa a ser o candidato atual; localização pendente sem posição', async () => {
    const produto = await criarProduto(a, '000930', 'Sérum fictício');
    const pa = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '3', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const semPosicao = await criarPalete(a, false);
    const c = await criarClaim(a, claimFalta('000930'));
    const linha = c.lines[0]?.id ?? '';
    const e = await evidenciaMaterial(a, c.id, linha, pa.id, segmentoDe(pa, '000930'), '3');
    expect((await transferir(pa.id, semPosicao.id, segmentoDe(pa, '000930'), '3')).statusCode).toBe(200);
    const cand = await candidatos(a, c.id, linha);
    expect(cand.items.filter((i) => i.base === 'SALDO_VALIDADO').map((i) => i.pallet?.id)).toEqual([semPosicao.id]);
    const atual = cand.items.find((i) => i.base === 'SALDO_VALIDADO');
    expect(atual?.pallet?.positionId).toBeNull();
    expect(atual?.clues.join(' ')).toContain('Localização pendente');
    const historico = cand.history.find((h) => h.pallet?.id === pa.id);
    expect(historico?.validatable).toBe(false);
    expect(historico?.blockers[0]).toContain('não prova presença atual');
    // A evidência antiga continua com o palete e o endereço da época.
    const d = await detalhe(a, c.id);
    expect(d.evidences.find((x) => x.id === e)?.positionCodeAtTime).toBe(pa.positionCode);
  });
});
