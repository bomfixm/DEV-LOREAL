import { ClaimDetalheSchema, PaginaHistoricoClaimSchema, ResumoClaimsSchema, type ClaimDetalhe } from '@praca-reversa/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { bancoDeTeste, codigoErro, como, mutar } from './apoio.js';
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
 * Claims contra PostgreSQL real (etapa 07): fluxo da demonstração (falta de
 * 12 → dois candidatos do mesmo SKU → um de outra origem → conferir →
 * validar 3 → 9 sem recuperação → regularização parcial → histórico e
 * valores separados), T17, T18 e T20, regras de valor e de encerramento.
 * Dados fictícios.
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

/** SKU com dois paletes: A (devolução do caso, 5 un) e B (outra devolução, 4 un). */
async function doisCandidatos() {
  const produto = await criarProduto(a, '000777', 'Máscara capilar fictícia');
  const pa = await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-A-01' }]);
  const pb = await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '4', lot: 'L-01', ref: 'DEV-B-02' }]);
  return { produto, pa: pa.palete, pb: pb.palete };
}

describe('Fluxo da demonstração: falta de 12, validar 3, manter 9, regularização parcial', () => {
  it('candidatos do mesmo SKU com origens diferentes; só o compatível é validado; valores ficam separados', async () => {
    const { pa, pb } = await doisCandidatos();
    const claim = await criarClaim(a, claimFalta('000777'));
    expect(claim.code).toMatch(/^CLM-\d{6}$/);
    expect(claim.state).toBe('EM_ANALISE');
    const linha = claim.lines[0];
    if (!linha) throw new Error('linha');
    expect(linha.estimateTotal).toBe('120.00');
    expect(claim.totals.estimated).toEqual([{ currency: 'BRL', value: '120.00' }]);
    expect(claim.totals.avoidedConfirmed).toEqual([]);

    const c = await candidatos(a, claim.id, linha.id);
    const saldo = c.items.filter((i) => i.base === 'SALDO_VALIDADO');
    expect(saldo.map((i) => i.pallet?.code).sort()).toEqual([pa.code, pb.code].sort());
    const compativel = saldo.find((i) => i.pallet?.id === pa.id);
    const outraOrigem = saldo.find((i) => i.pallet?.id === pb.id);
    expect(compativel?.checks).toMatchObject({ product: 'COMPATIVEL', origin: 'COMPATIVEL', lot: 'COMPATIVEL', condition: 'COMPATIVEL' });
    expect(compativel?.validatable).toBe(true);
    expect(compativel?.eligible).toBe('5');
    expect(outraOrigem?.checks.origin).toBe('INCOMPATIVEL');
    expect(outraOrigem?.validatable).toBe(false);
    expect(outraOrigem?.blockers.join(' ')).toContain('Outra origem');
    // Nenhuma "confiança" inventada: só pistas concretas.
    expect(JSON.stringify(c)).not.toMatch(/%/);

    // Investigar o candidato compatível muda a situação por ação explícita.
    const reg = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/candidatos`, {
      lineId: linha.id,
      base: 'SALDO_VALIDADO',
      palletId: pa.id,
      segmentId: compativel?.segmentId,
    });
    expect(reg.statusCode, reg.body).toBe(200);
    expect(ClaimDetalheSchema.parse(reg.json()).state).toBe('CANDIDATO_LOCALIZADO');

    const antes = await palete(a, pa.id);
    const depois3 = await recuperar(a, claim.id, linha.id, pa.id, segmentoDe(pa, '000777'), '3');
    const l = depois3.lines[0];
    expect(l?.recovered).toBe('3');
    expect(l?.remaining).toBe('9');
    expect(depois3.totals.withoutValidatedRecovery).toEqual([{ unit: 'UN', quantity: '9' }]);
    // Recuperação física não é valor evitado.
    expect(depois3.totals.avoidedConfirmed).toEqual([]);
    expect(depois3.recoveries[0]?.currentLocations).toEqual([expect.objectContaining({ palletId: pa.id, quantity: '3' })]);

    // Validar recuperação não muda estoque, condição, liberação, localização nem reserva.
    const depoisPalete = await palete(a, pa.id);
    expect(depoisPalete.currentItems?.[0]?.quantity).toBe(antes.currentItems?.[0]?.quantity);
    expect(depoisPalete.currentItems?.[0]?.reserved).toBe('0');
    expect(depoisPalete.currentItems?.[0]?.claimLinked).toBe('3');
    expect(depoisPalete.releaseState).toBe(antes.releaseState);
    expect(depoisPalete.countState).toBe(antes.countState);
    expect(depoisPalete.positionId).toBe(antes.positionId);
    expect(depoisPalete.flowState).toBe(antes.flowState);

    // Regularização parcial (3 un) com evidência fictícia, por perfil com aprovação financeira.
    const evid = depois3.evidences[0]?.id;
    const resultado = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, {
      type: 'REGULARIZACAO',
      decisionDate: '2026-10-05',
      lines: [{ lineId: linha.id, quantity: '3' }],
      value: '30.00',
      currency: 'BRL',
      source: 'Portal do cliente (fictício)',
      reference: 'REG-FICT-0001',
      evidenceIds: [evid],
    });
    expect(resultado.statusCode, resultado.body).toBe(200);
    const final = ClaimDetalheSchema.parse(resultado.json());
    expect(final.totals.avoidedConfirmed).toEqual([{ currency: 'BRL', value: '30.00' }]);
    expect(final.totals.estimated).toEqual([{ currency: 'BRL', value: '120.00' }]);
    expect(final.totals.inTreatmentQuantity).toEqual([{ unit: 'UN', quantity: '9' }]);
    expect(final.lines[0]?.coveredRegularized).toBe('3');
    expect(final.results[0]?.estimateSnapshot.total).toBe('30.00');
    // Recuperação parcial não confirma o valor integral: o caso não é regularizado.
    const enc = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/encerrar`, {
      expectedVersion: final.version,
      to: 'REGULARIZADO',
      decision: 'Tentativa de encerrar sem cobertura integral.',
      pendenciesAcknowledged: true,
    });
    expect(enc.statusCode).toBe(409);

    const hist = await como(a.app, a.analista, { method: 'GET', url: `${API}/claims/${claim.id}/historico` });
    const tipos = PaginaHistoricoClaimSchema.parse(hist.json()).items.map((e) => e.type);
    expect(tipos).toEqual(expect.arrayContaining(['CASO_CRIADO', 'CANDIDATO_REGISTRADO', 'EVIDENCIA_REGISTRADA', 'VALIDACAO_SOLICITADA', 'RECUPERACAO_VALIDADA', 'RESULTADO_REGISTRADO']));
  });

  it('T17: mesmo SKU de outra devolução é candidato, mas não regulariza (validação bloqueada no servidor)', async () => {
    const { pb } = await doisCandidatos();
    const claim = await criarClaim(a, claimFalta('000777'));
    const linha = claim.lines[0];
    if (!linha) throw new Error('linha');
    const e = await evidenciaMaterial(a, claim.id, linha.id, pb.id, segmentoDe(pb, '000777'), '2');
    const s = await solicitar(a, claim.id, e, '2');
    expect(s.statusCode).toBe(409);
    expect(codigoErro(s)).toBe('RECUPERACAO_BLOQUEADA');
    expect(s.json<{ error: { message: string } }>().error.message).toContain('Outra origem');
    const d = await detalhe(a, claim.id);
    expect(d.lines[0]?.recovered).toBe('0');
    expect(d.recoveries).toHaveLength(0);
    expect(d.state).not.toBe('REGULARIZADO');
  });

  it('origem só por NF e origem pendente exigem comprovação antes de validar', async () => {
    const produto = await criarProduto(a, '000778', 'Condicionador fictício');
    const p = await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '6', lot: null, ref: null }]);
    // Caso com origem só por NF: pendente; material sem origem: pendente.
    const claimNf = await criarClaim(a, claimFalta('000778', {}, { originType: 'NOTA_FISCAL', originReference: '000045678', lot: null }));
    expect(claimNf.pendencies.map((x) => x.code)).toContain('ORIGEM_PENDENTE');
    const linha = claimNf.lines[0];
    if (!linha) throw new Error('linha');
    const c = await candidatos(a, claimNf.id, linha.id);
    expect(c.items[0]?.checks.origin).toBe('PENDENTE');
    const e = await evidenciaMaterial(a, claimNf.id, linha.id, p.palete.id, segmentoDe(p.palete, '000778'), '1');
    const s = await solicitar(a, claimNf.id, e, '1');
    expect(codigoErro(s)).toBe('RECUPERACAO_BLOQUEADA');
  });

  it('lote exigido divergente: sinaliza e só valida com tratativa documentada', async () => {
    const produto = await criarProduto(a, '000779', 'Creme fictício');
    const p = await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '6', lot: 'L-99', ref: 'DEV-A-01' }]);
    const claim = await criarClaim(a, claimFalta('000779', {}, { lotRequired: true, lot: 'L-01' }));
    const linha = claim.lines[0];
    if (!linha) throw new Error('linha');
    const c = await candidatos(a, claim.id, linha.id);
    expect(c.items[0]?.checks.lot).toBe('INCOMPATIVEL');
    expect(c.items[0]?.validatable).toBe(false);
    const e = await evidenciaMaterial(a, claim.id, linha.id, p.palete.id, segmentoDe(p.palete, '000779'), '2');
    expect((await solicitar(a, claim.id, e, '2')).statusCode).toBe(200);
    const sem = await validarRec(a, claim.id, e, '2');
    expect(codigoErro(sem)).toBe('RECUPERACAO_BLOQUEADA');
    const com = await validarRec(a, claim.id, e, '2', { lotTreatment: 'Cliente aceitou lote L-99 conforme e-mail fictício nº 123.' });
    expect(com.statusCode, com.body).toBe(200);
    expect(ClaimDetalheSchema.parse(com.json()).recoveries[0]?.lotTreatment).toContain('L-99');
  });

  it('documento isolado e conferência parcial não criam recuperação, saldo nem economia', async () => {
    const produto = await criarProduto(a, '000780', 'Tônico fictício');
    const parcial = await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '3', lot: 'L-01', ref: 'DEV-A-01' }], false);
    const claim = await criarClaim(a, claimFalta('000780'));
    const linha = claim.lines[0];
    if (!linha) throw new Error('linha');
    const c = await candidatos(a, claim.id, linha.id);
    const observado = c.items.find((i) => i.base === 'OBSERVADO');
    expect(observado?.pallet?.id).toBe(parcial.palete.id);
    expect(observado?.validatable).toBe(false);
    expect(observado?.blockers[0]).toContain('não substitui o saldo reconciliado');
    // Evidência descritiva (sem material conferido) não vai à validação.
    const r = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/evidencias`, {
      lineId: linha.id,
      type: 'DESCRICAO',
      description: 'Conferência parcial indicou 3 unidades na camada de cima.',
      verifiableReference: `Conferência nº ${String(parcial.sessao.number)}`,
    });
    expect(r.statusCode, r.body).toBe(200);
    const d = ClaimDetalheSchema.parse(r.json());
    const e = d.evidences[0];
    const s = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/evidencias/${e?.id ?? ''}/solicitar-validacao`, { expectedVersion: e?.version, quantity: '3' });
    expect(codigoErro(s)).toBe('RECUPERACAO_BLOQUEADA');
    const p = await palete(a, parcial.palete.id);
    expect(p.currentItems).toBeNull();
    const final = await detalhe(a, claim.id);
    expect(final.totals.validatedRecovery).toEqual([]);
    expect(final.totals.avoidedConfirmed).toEqual([]);
  });

  it('T18: avaria localizada registra evidência e o motivo continua em avaliação (material não vira saudável)', async () => {
    const produto = await criarProduto(a, '000781', 'Kit fictício');
    const p = await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '2', lot: 'L-01', ref: 'DEV-A-01', condition: 'AVARIADO' }]);
    const claim = await criarClaim(a, { ...claimFalta('000781', {}, { quantity: '2' }), reason: 'AVARIA' });
    const linha = claim.lines[0];
    if (!linha) throw new Error('linha');
    const c = await candidatos(a, claim.id, linha.id);
    expect(c.items[0]?.checks.condition).toBe('COMPATIVEL');
    expect(c.items[0]?.clues.join(' ')).toContain('continua em avaliação');
    await evidenciaMaterial(a, claim.id, linha.id, p.palete.id, segmentoDe(p.palete, '000781'), '2');
    const d = await detalhe(a, claim.id);
    expect(d.evidences[0]?.material?.condition).toBe('AVARIADO');
    expect(d.pendencies.map((x) => x.code)).toContain('AVARIA_EM_AVALIACAO');
    expect(d.results).toHaveLength(0);
    expect(['REGULARIZADO', 'PERDA_CONFIRMADA', 'ENCERRADO']).not.toContain(d.state);
    const depois = await palete(a, p.palete.id);
    expect(depois.currentItems?.[0]?.condition).toBe('AVARIADO');
    expect(depois.releaseState).toBe(p.palete.releaseState);
  });

  it('material avariado num caso de falta: evidência registrável, validação bloqueada', async () => {
    const produto = await criarProduto(a, '000782', 'Sérum fictício');
    const p = await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '2', lot: 'L-01', ref: 'DEV-A-01', condition: 'AVARIADO' }]);
    const claim = await criarClaim(a, claimFalta('000782'));
    const linha = claim.lines[0];
    if (!linha) throw new Error('linha');
    const e = await evidenciaMaterial(a, claim.id, linha.id, p.palete.id, segmentoDe(p.palete, '000782'), '2');
    const s = await solicitar(a, claim.id, e, '2');
    expect(codigoErro(s)).toBe('RECUPERACAO_BLOQUEADA');
  });

  it('T20: estimativa sem regularização não aparece como valor evitado; resumo separa as bases e moedas', async () => {
    await criarProduto(a, '000783', 'Óleo fictício');
    await criarClaim(a, claimFalta('000783'));
    await criarClaim(a, claimFalta('000783', { currency: 'USD' }, { estimatedValue: '7.50', valueBase: 'TOTAL_LINHA' }));
    const r = await como(a.app, a.analista, { method: 'GET', url: `${API}/claims/resumo` });
    expect(r.statusCode, r.body).toBe(200);
    const resumo = ResumoClaimsSchema.parse(r.json());
    expect(resumo.estimated).toEqual([
      { currency: 'BRL', value: '120.00', cases: 1, partialCases: 0 },
      { currency: 'USD', value: '7.50', cases: 1, partialCases: 0 },
    ]);
    expect(resumo.avoidedConfirmed).toEqual([]);
    expect(resumo.validatedRecovery).toEqual([]);
  });
});

describe('Quantidades da linha e do material', () => {
  it('caso de 12 com 3 validadas mantém 9; nova validação não passa de 12 nem do elegível; unidade incompatível rejeitada', async () => {
    const produto = await criarProduto(a, '000790', 'Gel fictício');
    const pa = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '20', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const claim = await criarClaim(a, claimFalta('000790'));
    const linha = claim.lines[0];
    if (!linha) throw new Error('linha');
    const seg = segmentoDe(pa, '000790');
    await recuperar(a, claim.id, linha.id, pa.id, seg, '3');
    // 10 > 9 restantes da linha (o palete tem 17 elegíveis).
    const e = await evidenciaMaterial(a, claim.id, linha.id, pa.id, seg, '10');
    const s = await solicitar(a, claim.id, e, '10');
    expect(codigoErro(s)).toBe('QUANTIDADE_INDISPONIVEL');
    expect(s.json<{ error: { message: string } }>().error.message).toContain('restante da linha');
    // Quantidade fracionária em UN rejeitada.
    const e2 = await evidenciaMaterial(a, claim.id, linha.id, pa.id, seg, '2');
    const frac = await solicitar(a, claim.id, e2, '1.5');
    expect(frac.statusCode).toBe(400);
    const d = await detalhe(a, claim.id);
    expect(d.lines[0]?.recovered).toBe('3');
    expect(d.lines[0]?.remaining).toBe('9');
  });

  it('linha com unidade diferente da canônica fica em triagem e bloqueia validação', async () => {
    await criarProduto(a, '000791', 'Spray fictício');
    const claim = await criarClaim(a, claimFalta('000791', {}, { unit: 'CX', quantity: '2' }));
    expect(claim.pendencies.map((x) => x.code)).toContain('UNIDADE_INCOMPATIVEL');
    const lista = await como(a.app, a.analista, { method: 'GET', url: `${API}/claims?pendencia=TRIAGEM` });
    expect(lista.json<{ items: { id: string; triage: boolean }[] }>().items.find((i) => i.id === claim.id)?.triage).toBe(true);
  });
});

describe('Resultado da regularização: permissão, fonte, evidência, cobrança finalizada e correção', () => {
  async function casoComRecuperacao(): Promise<{ claim: ClaimDetalhe; linhaId: string; evidenciaId: string }> {
    const produto = await criarProduto(a, '000800', 'Loção fictícia');
    const pa = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '12', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const criado = await criarClaim(a, claimFalta('000800'));
    const linhaId = criado.lines[0]?.id ?? '';
    const claim = await recuperar(a, criado.id, linhaId, pa.id, segmentoDe(pa, '000800'), '12');
    return { claim, linhaId, evidenciaId: claim.evidences[0]?.id ?? '' };
  }

  it('valor diferente da estimativa exige justificativa; atualização de preço não muda a decisão', async () => {
    const { claim, linhaId, evidenciaId } = await casoComRecuperacao();
    const base = {
      type: 'REGULARIZACAO',
      decisionDate: '2026-10-06',
      lines: [{ lineId: linhaId, quantity: '12' }],
      value: '100.00',
      currency: 'BRL',
      source: 'Nota de crédito fictícia',
      reference: 'NC-FICT-01',
      evidenceIds: [evidenciaId],
    };
    const sem = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, base);
    expect(sem.statusCode).toBe(400);
    const com = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, { ...base, valueJustification: 'Desconto contratual informado pelo cliente (fictício).' });
    expect(com.statusCode, com.body).toBe(200);
    const d = ClaimDetalheSchema.parse(com.json());
    expect(d.results[0]?.estimateSnapshot.total).toBe('120.00');
    // Atualiza o preço da linha depois da decisão: o retrato não muda.
    const alt = await mutar(a.app, a.analista, 'PUT', `${API}/claims/${claim.id}`, {
      ...claimFalta('000800'),
      externalReference: d.externalReference,
      expectedVersion: d.version,
      reasonForChange: 'Tabela de preço atualizada',
      lines: [{ ...claimFalta('000800').lines[0], id: linhaId, estimatedValue: '15.00' }],
    });
    expect(alt.statusCode, alt.body).toBe(200);
    const depois = ClaimDetalheSchema.parse(alt.json());
    expect(depois.lines[0]?.estimateTotal).toBe('180.00');
    expect(depois.results[0]?.estimateSnapshot.total).toBe('120.00');
    expect(depois.results[0]?.value).toBe('100.00');
  });

  it('cobrança finalizada exige prova do resultado externo; sem chamada externa', async () => {
    await criarProduto(a, '000801', 'Pomada fictícia');
    const claim = await criarClaim(a, claimFalta('000801', { chargeFinalized: true }));
    expect(claim.pendencies.map((p) => p.code)).toContain('COBRANCA_FINALIZADA');
    const anexo = await como(a.app, a.analista, {
      method: 'POST',
      url: `${API}/claims/${claim.id}/anexos`,
      payload: Buffer.from('%PDF-1.4\n% documento fictício\n'),
      headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': 'prova.pdf', 'idempotency-key': 'anexo-prova-0001' },
    });
    expect(anexo.statusCode, anexo.body).toBe(200);
    const anexoId = anexo.json<{ id: string }>().id;
    const base = {
      type: 'REGULARIZACAO',
      decisionDate: '2026-10-06',
      lines: [{ lineId: claim.lines[0]?.id, quantity: '12' }],
      value: '120.00',
      currency: 'BRL',
      source: 'Área financeira do cliente (fictício)',
      reference: 'FIN-FICT-9',
      attachmentIds: [anexoId],
    };
    const sem = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, base);
    expect(sem.statusCode).toBe(409);
    const com = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, { ...base, externalResultReference: 'ESTORNO-FICT-77' });
    expect(com.statusCode, com.body).toBe(200);
    const d = ClaimDetalheSchema.parse(com.json());
    expect(d.pendencies.map((p) => p.code)).not.toContain('COBRANCA_FINALIZADA');
    expect(d.results[0]?.attachments[0]?.id).toBe(anexoId);
  });

  it('correção cria novo resultado vinculado; anulação libera a cobertura; nada é apagado; reabrir não desfaz decisões', async () => {
    const { claim, linhaId, evidenciaId } = await casoComRecuperacao();
    const base = {
      type: 'REGULARIZACAO',
      decisionDate: '2026-10-06',
      lines: [{ lineId: linhaId, quantity: '12' }],
      value: '120.00',
      currency: 'BRL',
      source: 'Portal do cliente (fictício)',
      reference: 'REG-FICT-1',
      evidenceIds: [evidenciaId],
    };
    const r1 = ClaimDetalheSchema.parse((await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, base)).json());
    const original = r1.results[0];
    // Cobertura não passa de 12: outro resultado igual é recusado.
    const dup = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, base);
    expect(codigoErro(dup)).toBe('QUANTIDADE_INDISPONIVEL');
    const corr = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, {
      ...base,
      reference: 'REG-FICT-1-CORRIGIDO',
      correctsResultId: original?.id,
      correctionReason: 'Referência digitada errada no registro original.',
    });
    expect(corr.statusCode, corr.body).toBe(200);
    const r2 = ClaimDetalheSchema.parse(corr.json());
    expect(r2.results).toHaveLength(2);
    expect(r2.results[0]?.state).toBe('CORRIGIDO');
    expect(r2.results[1]?.correctsResultId).toBe(original?.id);
    expect(r2.totals.avoidedConfirmed).toEqual([{ currency: 'BRL', value: '120.00' }]);
    // Estorno da recuperação bloqueado enquanto um resultado vigente cita a evidência.
    const rec = r2.recoveries[0];
    const est = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/recuperacoes/${rec?.id ?? ''}/estornar`, { expectedVersion: rec?.version, reason: 'Tentativa de estorno com resultado vigente.' });
    expect(est.statusCode).toBe(409);
    // Encerrar regularizado e reabrir: a decisão anterior fica no histórico; resultados e vínculos continuam.
    const enc = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/encerrar`, {
      expectedVersion: r2.version,
      to: 'REGULARIZADO',
      decision: 'Cliente regularizou as 12 unidades (fictício).',
      pendenciesAcknowledged: true,
    });
    expect(enc.statusCode, enc.body).toBe(200);
    const encerrado = ClaimDetalheSchema.parse(enc.json());
    expect(encerrado.state).toBe('REGULARIZADO');
    const reab = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/reabrir`, {
      expectedVersion: encerrado.version,
      to: 'BUSCA_EM_ANDAMENTO',
      reason: 'Cliente contestou a regularização (fictício).',
    });
    expect(reab.statusCode, reab.body).toBe(200);
    const reaberto = ClaimDetalheSchema.parse(reab.json());
    expect(reaberto.state).toBe('BUSCA_EM_ANDAMENTO');
    expect(reaberto.totals.avoidedConfirmed).toEqual([{ currency: 'BRL', value: '120.00' }]);
    expect(reaberto.lines[0]?.recovered).toBe('12');
    const anular = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados/${r2.results[1]?.id ?? ''}/anular`, {
      expectedVersion: r2.results[1]?.version,
      reason: 'Contestação aceita: resultado deixa de valer (fictício).',
    });
    expect(anular.statusCode, anular.body).toBe(200);
    const anulado = ClaimDetalheSchema.parse(anular.json());
    expect(anulado.results.map((r) => r.state)).toEqual(['CORRIGIDO', 'ANULADO']);
    expect(anulado.totals.avoidedConfirmed).toEqual([]);
    expect(anulado.lines[0]?.covered).toBe('0');
    const hist = PaginaHistoricoClaimSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims/${claim.id}/historico` })).json());
    expect(hist.items.map((e) => e.type)).toEqual(expect.arrayContaining(['RESULTADO_CORRIGIDO', 'CASO_ENCERRADO', 'CASO_REABERTO', 'RESULTADO_ANULADO']));
    // Tabelas de decisão nunca perdem linhas.
    await expect(db.$executeRaw`DELETE FROM resultado_claim WHERE claim_id = ${claim.id}::uuid`).rejects.toThrow(/CLAIM_IMUTAVEL/);
    await expect(db.$executeRaw`DELETE FROM evento_claim WHERE claim_id = ${claim.id}::uuid`).rejects.toThrow(/HISTORICO_IMUTAVEL/);
  });

  it('perda confirmada exige resultado de perda; validação pendente impede encerrar', async () => {
    await criarProduto(a, '000802', 'Batom fictício');
    const claim = await criarClaim(a, claimFalta('000802'));
    const semResultado = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/encerrar`, {
      expectedVersion: claim.version,
      to: 'PERDA_CONFIRMADA',
      decision: 'Nenhum candidato encontrado (não prova perda).',
      pendenciesAcknowledged: true,
    });
    expect(semResultado.statusCode).toBe(409);
    const perda = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, {
      type: 'PERDA_CONFIRMADA',
      decisionDate: '2026-10-07',
      lines: [{ lineId: claim.lines[0]?.id, quantity: '12' }],
      value: '120.00',
      currency: 'BRL',
      source: 'Comitê de perdas (fictício)',
      reference: 'PERDA-FICT-3',
      evidenceIds: [],
      attachmentIds: [],
    });
    expect(perda.statusCode).toBe(400);
    const desc = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/evidencias`, {
      lineId: claim.lines[0]?.id,
      type: 'DESCRICAO',
      description: 'Ata do comitê de perdas com a decisão (fictícia).',
      verifiableReference: 'ATA-FICT-3',
    });
    const comEvid = ClaimDetalheSchema.parse(desc.json());
    const perda2 = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, {
      type: 'PERDA_CONFIRMADA',
      decisionDate: '2026-10-07',
      lines: [{ lineId: claim.lines[0]?.id, quantity: '12' }],
      value: '120.00',
      currency: 'BRL',
      source: 'Comitê de perdas (fictício)',
      reference: 'PERDA-FICT-3',
      evidenceIds: [comEvid.evidences[0]?.id],
    });
    expect(perda2.statusCode, perda2.body).toBe(200);
    const d = ClaimDetalheSchema.parse(perda2.json());
    expect(d.totals.lossConfirmed).toEqual([{ currency: 'BRL', value: '120.00' }]);
    expect(d.totals.avoidedConfirmed).toEqual([]);
    const enc = await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/encerrar`, {
      expectedVersion: d.version,
      to: 'PERDA_CONFIRMADA',
      decision: 'Perda confirmada pelo comitê (fictício).',
      pendenciesAcknowledged: true,
    });
    expect(enc.statusCode, enc.body).toBe(200);
  });
});
