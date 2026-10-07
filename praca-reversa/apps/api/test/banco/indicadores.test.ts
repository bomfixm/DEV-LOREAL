import {
  ClaimDetalheSchema,
  ExemploTutorialSchema,
  IndicadoresSchema,
  PaleteDetalheSchema,
  PreferenciaTutorialSchema,
  RelatorioSchema,
  ResultadoMovimentoSchema,
  type Indicadores,
  type PaleteDetalhe,
  type Relatorio,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ID_ESCOPO_NAVEGACAO,
  ID_ESCOPO_PRACA,
  Relogio,
  appDeTeste,
  bancoDeTeste,
  chave,
  codigoErro,
  como,
  criarUsuario,
  entrar,
  mutar,
  prepararDados,
  type SessaoTeste,
  type UsuarioTeste,
} from './apoio.js';
import { API, candidatos, claimFalta, criarClaim, criarPalete, criarProduto, palete, reconciliar, recuperar, segmentoDe, type Ambiente, type Item } from './claims-apoio.js';
import { confirmar, corpoExpedicao, criarJanela, dadosJanela, liberarMaterial, pecas, reservarOk } from './janelas-apoio.js';

/**
 * Etapa 10: indicadores, relatórios, retirada de palete vazio (T29) e
 * preferência do tutorial, contra PostgreSQL real e pelo fluxo da API. O
 * relógio da API é controlado para colocar eventos em instantes conhecidos
 * (início do período, virada do dia no fuso da operação). Dados fictícios.
 */
const db = bancoDeTeste();
afterAll(async () => {
  await db.$disconnect();
});

interface Mundo extends Ambiente {
  relogio: Relogio;
  usuarios: Record<'sup' | 'op' | 'analista' | 'financeiro' | 'consulta' | 'outroEscopo', UsuarioTeste>;
  relogar: () => Promise<void>;
}

/** Banco limpo com a demonstração, API com relógio controlado e os perfis do escopo da praça. */
async function montar(inicio: Date): Promise<Mundo> {
  await prepararDados(db);
  const relogio = new Relogio();
  relogio.avancar(inicio.getTime() - relogio.agora().getTime());
  const app: FastifyInstance = await appDeTeste(db, { agora: relogio.agora });
  const usuarios = {
    sup: await criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    op: await criarUsuario(db, 'operador', [[ID_ESCOPO_PRACA, 'OPERADOR']]),
    analista: await criarUsuario(db, 'analista', [[ID_ESCOPO_PRACA, 'ANALISTA_CLAIMS']]),
    financeiro: await criarUsuario(db, 'financeiro', [[ID_ESCOPO_PRACA, 'ANALISTA_CLAIMS']]),
    consulta: await criarUsuario(db, 'consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]),
    outroEscopo: await criarUsuario(db, 'supervisor.outro', [[ID_ESCOPO_NAVEGACAO, 'SUPERVISOR_ESTOQUE']]),
  };
  await db.vinculo.updateMany({ where: { usuarioId: usuarios.financeiro.id, escopoId: ID_ESCOPO_PRACA }, data: { aprovaFinanceiro: true } });
  const mundo = { db, app, relogio, usuarios } as Mundo;
  mundo.relogar = async () => {
    mundo.sup = await entrar(app, usuarios.sup);
    mundo.op = await entrar(app, usuarios.op);
    mundo.analista = await entrar(app, usuarios.analista);
    mundo.financeiro = await entrar(app, usuarios.financeiro);
    mundo.consulta = await entrar(app, usuarios.consulta);
    mundo.outroEscopo = await entrar(app, usuarios.outroEscopo);
  };
  await mundo.relogar();
  return mundo;
}

/** Data (AAAA-MM-DD) de um instante no fuso da operação. */
function dataLocal(instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

async function indicadores(m: Mundo, s: SessaoTeste, consulta = ''): Promise<Indicadores> {
  const r = await como(m.app, s, { method: 'GET', url: `${API}/indicadores${consulta}` });
  expect(r.statusCode, r.body).toBe(200);
  return IndicadoresSchema.parse(r.json());
}

async function relatorio(m: Mundo, s: SessaoTeste, tipo: string, consulta = ''): Promise<Relatorio> {
  const r = await como(m.app, s, { method: 'GET', url: `${API}/relatorios/${tipo}${consulta}` });
  expect(r.statusCode, r.body).toBe(200);
  return RelatorioSchema.parse(r.json());
}

const total = (r: Relatorio, rotulo: string) => r.summary.find((s) => s.label === rotulo)?.value;
const fluxoUn = (i: Indicadores) => i.estoque?.flow.find((f) => f.unit === 'UN');
const saldoUnPalete = (p: PaleteDetalhe) => String((p.currentItems ?? []).filter((i) => i.unit === 'UN').reduce((s, i) => s + Number(i.quantity), 0));
const saldoUn = (i: Indicadores) => i.estoque?.current.find((s) => s.unit === 'UN')?.validated ?? '0';

async function transferir(m: Mundo, de: PaleteDetalhe, para: PaleteDetalhe, segmento: string, quantidade: string) {
  const r = await mutar(m.app, m.op, 'POST', `${API}/transferencias`, {
    sourcePalletId: de.id,
    destinationPalletId: para.id,
    segmentId: segmento,
    quantity: quantidade,
    expectedSourceVersion: de.version,
    expectedDestinationVersion: para.version,
    reason: 'Consolidação de paletes',
  });
  expect(r.statusCode, r.body).toBe(200);
}

async function produto(m: Mundo, sku: string): Promise<string> {
  return (await criarProduto(m, sku, `Produto fictício ${sku}`)).id;
}

/** Palete com saldo validado (conferência completa reconciliada). */
async function comSaldo(m: Mundo, itens: Item[]): Promise<PaleteDetalhe> {
  const p = await criarPalete(m);
  const { resposta } = await reconciliar(m, p.id, itens);
  expect(resposta?.statusCode, resposta?.body).toBe(200);
  return palete(m, p.id);
}

function retirar(m: Mundo, p: PaleteDetalhe, s: SessaoTeste = m.op, chaveIdem: string = chave()) {
  return mutar(m.app, s, 'POST', `${API}/paletes/${p.id}/retirada-vazio`, { expectedVersion: p.version, reason: 'Conteúdo consolidado em outro palete (teste)', confirmEmpty: true }, chaveIdem);
}

describe('fluxo do estoque validado: 20 + 5 − 8 = 17, transferência e consolidação, ajuste −2 (etapa 10)', () => {
  let m: Mundo;
  let hoje: string;
  let a: PaleteDetalhe;
  let b: PaleteDetalhe;
  let produtoId: string;
  let expedicaoId: string;
  let janelaId: string;

  beforeAll(async () => {
    // Saldo inicial no dia anterior ao período; o restante acontece "hoje" (+26 h).
    m = await montar(new Date(Date.now() - 26 * 3_600_000));
    produtoId = await produto(m, 'IND-001');
    a = await comSaldo(m, [{ productId: produtoId, quantity: '20', lot: 'L-A', ref: 'DEV-IND-A' }]);
    m.relogio.avancar(26 * 3_600_000);
    await m.relogar();
    hoje = dataLocal(m.relogio.agora());
  });

  it('entrada 5 e expedição 8 sobre o saldo inicial 20 resultam em 17; transferir e consolidar mantêm 17; ajuste −2 resulta em 15', async () => {
    // Entrada validada de 5 (novo palete conferido e reconciliado).
    b = await comSaldo(m, [{ productId: produtoId, quantity: '5', lot: 'L-B', ref: 'DEV-IND-B' }]);
    // Expedição confirmada de 8 do palete A (liberação → janela → reserva → saída).
    const segA = segmentoDe(a, 'IND-001');
    const lib = await liberarMaterial(m, a, segA, '8');
    expect(lib.statusCode, lib.body).toBe(200);
    a = PaleteDetalheSchema.parse(lib.json());
    const agora = m.relogio.agora().getTime();
    const j = await confirmar(
      m,
      await criarJanela(m, dadosJanela([pecas('100')], { exitStart: new Date(agora - 3_600_000).toISOString(), exitEnd: new Date(agora + 3_600_000).toISOString(), referenceMonth: hoje.slice(0, 7) })),
    );
    janelaId = j.id;
    const reserva = await reservarOk(m, j, [{ p: a, seg: segA, q: '8' }]);
    const exp = await mutar(m.app, m.sup, 'POST', `${API}/reservas/${reserva.id}/expedicao`, await corpoExpedicao(m, reserva, { shippedAt: new Date(agora - 60_000).toISOString() }));
    expect(exp.statusCode, exp.body).toBe(200);
    expedicaoId = (exp.json<{ id: string }>()).id;

    const periodo = `?inicio=${hoje}&fim=${hoje}`;
    const r17 = await relatorio(m, m.sup, 'estoque', `${periodo}&sku=IND-001`);
    expect(total(r17, 'Saldo inicial (UN)')).toBe('20');
    expect(total(r17, 'Entradas validadas (UN)')).toBe('5');
    expect(total(r17, 'Saídas confirmadas (UN)')).toBe('8');
    expect(total(r17, 'Saldo final (UN)')).toBe('17');

    // Transferir 4 de A para B e consolidar B em A: o total continua 17.
    a = await palete(m, a.id);
    await transferir(m, a, b, segA, '4');
    b = await palete(m, b.id);
    a = await palete(m, a.id);
    const segB = segmentoDe(b, 'IND-001', 'L-B');
    await transferir(m, b, a, segB, '5');
    b = await palete(m, b.id);
    a = await palete(m, a.id);
    await transferir(m, b, a, segA, '4');
    b = await palete(m, b.id);
    const rConsolidado = await relatorio(m, m.sup, 'estoque', `${periodo}&sku=IND-001`);
    expect(total(rConsolidado, 'Saldo final (UN)')).toBe('17');
    expect(total(rConsolidado, 'Saídas confirmadas (UN)')).toBe('8');
    expect(total(rConsolidado, 'Transferido entre paletes (UN)')).toBe('13');

    // Palete B vazio sai da posição (consolidação): nenhuma saída de estoque.
    const antes = await indicadores(m, m.sup, periodo);
    const ret = await retirar(m, b);
    expect(ret.statusCode, ret.body).toBe(200);
    const depois = await indicadores(m, m.sup, periodo);
    expect(depois.praca?.palletsInStock).toBe((antes.praca?.palletsInStock ?? 0) - 1);
    expect(depois.praca?.positions?.occupied).toBe((antes.praca?.positions?.occupied ?? 0) - 1);
    expect(depois.praca?.period.retiredEmpty).toBe(1);
    expect(saldoUn(depois)).toBe(saldoUn(antes));
    expect(fluxoUn(depois)?.exits).toBe(fluxoUn(antes)?.exits);

    // Recontagem completa de A encontra 15: ajuste −2 identificável (evento próprio).
    a = await palete(m, a.id);
    const { resposta } = await reconciliar(m, a.id, [
      { productId: produtoId, quantity: '12', lot: 'L-A', ref: 'DEV-IND-A' },
      { productId: produtoId, quantity: '3', lot: 'L-B', ref: 'DEV-IND-B' },
    ]);
    expect(resposta?.statusCode, resposta?.body).toBe(200);
    const r15 = await relatorio(m, m.sup, 'estoque', `${periodo}&sku=IND-001`);
    expect(total(r15, 'Saldo inicial (UN)')).toBe('20');
    expect(total(r15, 'Entradas validadas (UN)')).toBe('5');
    expect(total(r15, 'Saídas confirmadas (UN)')).toBe('8');
    expect(total(r15, 'Ajustes líquidos (UN)')).toBe('-2');
    expect(total(r15, 'Saldo final (UN)')).toBe('15');
    const linhaB = r15.rows.find((l) => l.lote === 'L-B');
    expect(linhaB).toMatchObject({ entradas: '5', ajustes: '-2', final: '3' });
    const linhaA = r15.rows.find((l) => l.lote === 'L-A');
    expect(linhaA).toMatchObject({ inicial: '20', saidas: '8', ajustes: '0', final: '12' });
    // O período anterior não muda: a fotografia do dia anterior continua 20.
    const ontem = dataLocal(new Date(m.relogio.agora().getTime() - 26 * 3_600_000));
    const rOntem = await relatorio(m, m.sup, 'estoque', `?inicio=${ontem}&fim=${ontem}&sku=IND-001`);
    expect(total(rOntem, 'Entradas validadas (UN)')).toBe('20');
    expect(total(rOntem, 'Saldo final (UN)')).toBe('20');
  });

  it('o painel fecha o fluxo por unidade e bate com o saldo atual; transferências somam zero no escopo', async () => {
    const i = await indicadores(m, m.sup, `?inicio=${hoje}&fim=${hoje}`);
    const un = fluxoUn(i);
    expect(un?.consistent).toBe(true);
    expect(un?.transfersNet).toBe('0');
    expect(un?.current).toBe(un?.closing);
    expect(un?.closing).toBe(saldoUn(i));
    expect(i.janelas?.period.expeditions).toBe(1);
    expect(i.janelas?.period.shipped).toEqual([{ unit: 'UN', quantity: '8', lines: 1 }]);
    // Expedições e retornos no relatório: uma baixa de 8.
    const rExp = await relatorio(m, m.sup, 'expedicoes', `?inicio=${hoje}&fim=${hoje}`);
    expect(rExp.rows).toHaveLength(1);
    expect(rExp.rows[0]).toMatchObject({ enviado: '8', sku: 'IND-001', parcial: 'Não' });
  });

  it('aviso documental de retorno não altera o saldo; retorno físico entra só pela reconciliação do palete que recebeu', async () => {
    const periodo = `?inicio=${hoje}&fim=${hoje}`;
    const antes = await indicadores(m, m.sup, periodo);
    const expedicao = await como(m.app, m.sup, { method: 'GET', url: `${API}/expedicoes/${expedicaoId}` });
    const detalheExp = expedicao.json<{ version: number; lines: { id: string }[] }>();
    const aviso = await mutar(m.app, m.sup, 'POST', `${API}/expedicoes/${expedicaoId}/retornos`, {
      expectedVersion: detalheExp.version,
      type: 'AVISO_DOCUMENTAL',
      receivedAt: new Date(m.relogio.agora().getTime() - 30_000).toISOString(),
      reason: 'Cliente avisou devolução (fictício)',
      condition: 'SAUDAVEL',
    });
    expect(aviso.statusCode, aviso.body).toBe(200);
    const depoisAviso = await indicadores(m, m.sup, periodo);
    expect(saldoUn(depoisAviso)).toBe(saldoUn(antes));
    expect(depoisAviso.estoque?.returns.notices).toBe(1);
    expect(fluxoUn(depoisAviso)?.entries).toBe(fluxoUn(antes)?.entries);

    // Recebimento físico de 2: vira declaração no palete que recebeu; o saldo não muda.
    const anexo = await como(m.app, m.sup, {
      method: 'POST',
      url: `${API}/janelas/${janelaId}/anexos`,
      payload: Buffer.from('%PDF-1.4\n% comprovante fictício de retorno\n'),
      headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': encodeURIComponent('retorno.pdf'), 'idempotency-key': chave() },
    });
    expect(anexo.statusCode, anexo.body).toBe(200);
    const destino = await criarPalete(m);
    const exp2 = (await como(m.app, m.sup, { method: 'GET', url: `${API}/expedicoes/${expedicaoId}` })).json<{ version: number; lines: { id: string }[] }>();
    const fisico = await mutar(m.app, m.sup, 'POST', `${API}/expedicoes/${expedicaoId}/retornos`, {
      expectedVersion: exp2.version,
      type: 'RECEBIMENTO_FISICO',
      receivedAt: new Date(m.relogio.agora().getTime() - 20_000).toISOString(),
      reason: 'Recusa fictícia do cliente',
      condition: 'SAUDAVEL',
      destinationPalletId: destino.id,
      lines: [{ expeditionLineId: exp2.lines[0]?.id, quantity: '2' }],
      attachmentIds: [anexo.json<{ id: string }>().id],
    });
    expect(fisico.statusCode, fisico.body).toBe(200);
    const comRetorno = await indicadores(m, m.sup, periodo);
    expect(saldoUn(comRetorno)).toBe(saldoUn(antes));
    expect(comRetorno.estoque?.returns.physical).toBe(1);
    expect(comRetorno.estoque?.returns.physicalQuantity).toEqual([{ unit: 'UN', quantity: '2', lines: 1 }]);
    // A entrada acontece na conferência e reconciliação do palete que recebeu (entrada vinculada à saída).
    const { resposta } = await reconciliar(m, destino.id, [{ productId: produtoId, quantity: '2', lot: 'L-A', ref: 'DEV-IND-A' }]);
    expect(resposta?.statusCode, resposta?.body).toBe(200);
    const reconciliado = await indicadores(m, m.sup, periodo);
    const f0 = fluxoUn(antes);
    const f1 = fluxoUn(reconciliado);
    expect(Number(f1?.entries) - Number(f0?.entries)).toBe(2);
    expect(f1?.entriesFromReturns).toBe('2');
    expect(Number(f1?.closing) - Number(f0?.closing)).toBe(2);
    expect(f1?.consistent).toBe(true);
  });
  it('fluxo integrado: claim sobre o mesmo material não mexe no estoque; painel e relatórios separam as bases e respeitam permissões', async () => {
    const periodo = `?inicio=${hoje}&fim=${hoje}`;
    const antes = await indicadores(m, m.analista, periodo);
    a = await palete(m, a.id);
    const caso = await criarClaim(m, claimFalta('IND-001', {}, { quantity: '2', lot: 'L-A', originReference: 'DEV-IND-A', estimatedValue: '5.00', valueBase: 'UNITARIO' }));
    const linha = caso.lines[0];
    if (!linha) throw new Error('linha');
    await recuperar(m, caso.id, linha.id, a.id, segmentoDe(a, 'IND-001', 'L-A'), '1');
    const depois = await indicadores(m, m.analista, periodo);
    expect(saldoUn(depois)).toBe(saldoUn(antes));
    expect(fluxoUn(depois)?.closing).toBe(fluxoUn(antes)?.closing);
    expect(depois.claims?.recoveredValidated).toEqual([{ unit: 'UN', quantity: '1', cases: 1 }]);
    expect(depois.claims?.period.recoveries).toEqual([{ unit: 'UN', quantity: '1', lines: 1 }]);
    expect(depois.valores?.avoidedConfirmed).toEqual([]);
    // O operador vê praça e estoque; não recebe claims nem valores; não exporta.
    const op = await indicadores(m, m.op, periodo);
    expect(op.claims).toBeNull();
    expect(op.valores).toBeNull();
    expect((await como(m.app, m.op, { method: 'GET', url: `${API}/relatorios/paletes/exportar` })).statusCode).toBe(403);
    // Relatório de paletes: o palete A aparece uma vez, com o saldo validado atual.
    const rp = await relatorio(m, m.sup, 'paletes');
    expect(rp.rows.filter((l) => l.codigo === a.code)).toHaveLength(1);
    expect(rp.rows.find((l) => l.codigo === a.code)?.saldo).toBe(`${saldoUnPalete(await palete(m, a.id))} UN`);
  });
});


describe('consolidação de dois paletes num único palete (T29) e regras da retirada', () => {
  let m: Mundo;
  let produtoId: string;

  beforeAll(async () => {
    m = await montar(new Date());
    produtoId = await produto(m, 'IND-T29');
  });

  it('posições ocupadas caem; unidades em estoque permanecem iguais; nenhuma saída', async () => {
    const x = await comSaldo(m, [{ productId: produtoId, quantity: '10', lot: 'L-1', ref: 'DEV-T29' }]);
    let y = await comSaldo(m, [{ productId: produtoId, quantity: '6', lot: 'L-1', ref: 'DEV-T29' }]);
    const antes = await indicadores(m, m.sup);
    await transferir(m, x, y, segmentoDe(x, 'IND-T29'), '10');
    const xVazio = await palete(m, x.id);
    expect(xVazio.currentItems?.filter((i) => i.quantity !== '0') ?? []).toHaveLength(0);
    const r = await retirar(m, xVazio);
    expect(r.statusCode, r.body).toBe(200);
    const resultado = ResultadoMovimentoSchema.parse(r.json());
    expect(resultado.event.type).toBe('RETIRADA_VAZIO');
    expect(resultado.pallet.positionId).toBeNull();
    expect(resultado.pallet.flowState).toBe('VAZIO_ARQUIVADO');
    const depois = await indicadores(m, m.sup);
    expect(depois.praca?.positions?.occupied).toBe((antes.praca?.positions?.occupied ?? 0) - 1);
    expect(depois.praca?.palletsInStock).toBe((antes.praca?.palletsInStock ?? 0) - 1);
    expect(saldoUn(depois)).toBe(saldoUn(antes));
    expect(fluxoUn(depois)?.exits).toBe(fluxoUn(antes)?.exits);
    expect(depois.janelas?.period.expeditions).toBe(antes.janelas?.period.expeditions);
    y = await palete(m, y.id);
    expect(y.currentItems?.find((i) => i.sku === 'IND-T29')?.quantity).toBe('16');
    // O mapa não mostra mais o palete; o ID continua consultável e o código não volta a ser usado.
    const praca = (await como(m.app, m.sup, { method: 'GET', url: `${API}/praca` })).json<{ pallets: { id: string }[] }>();
    expect(praca.pallets.some((p) => p.id === x.id)).toBe(false);
    expect((await palete(m, x.id)).archived?.reason).toContain('consolidação');
    const repetido = await mutar(m.app, m.op, 'POST', `${API}/paletes`, { code: { mode: 'INFORMAR', value: x.code }, positionId: null, notes: null, declaredItems: [] });
    expect(repetido.statusCode).toBe(409);
  });

  it('recusa palete com saldo, conteúdo desconhecido, conferência pendente, sem permissão ou de outro escopo; repetir a mesma chave não repete', async () => {
    const cheio = await comSaldo(m, [{ productId: produtoId, quantity: '2', lot: 'L-2', ref: 'DEV-T29' }]);
    const comConteudo = await retirar(m, cheio);
    expect(codigoErro(comConteudo)).toBe('PALETE_NAO_VAZIO');
    const naoConferido = await criarPalete(m);
    expect(codigoErro(await retirar(m, naoConferido))).toBe('CONTEUDO_DESCONHECIDO');
    expect((await retirar(m, cheio, m.consulta)).statusCode).toBe(403);
    expect((await retirar(m, cheio, m.outroEscopo)).statusCode).toBe(404);
    // Esvazia por transferência e retira duas vezes com a mesma chave: um único evento.
    const destino = await comSaldo(m, [{ productId: produtoId, quantity: '1', lot: 'L-2', ref: 'DEV-T29' }]);
    await transferir(m, cheio, destino, segmentoDe(cheio, 'IND-T29'), '2');
    const vazio = await palete(m, cheio.id);
    const k = chave();
    const r1 = await retirar(m, vazio, m.op, k);
    const r2 = await retirar(m, vazio, m.op, k);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r2.headers['idempotency-replayed']).toBe('true');
    expect(await db.eventoLocalizacao.count({ where: { paleteId: vazio.id, tipo: 'RETIRADA_VAZIO' } })).toBe(1);
    // Outra chave: o palete já está arquivado.
    expect((await retirar(m, vazio)).statusCode).toBe(409);
  });
});

describe('contagem única, conteúdo desconhecido e base de posições', () => {
  let m: Mundo;

  beforeAll(async () => {
    m = await montar(new Date());
  });

  it('palete com várias linhas, documentos e contagens conta uma vez; conteúdo não conferido não vira zero', async () => {
    const antes = await indicadores(m, m.sup);
    const pid = await produto(m, 'IND-MULTI');
    const outro = await produto(m, 'IND-MULTI-2');
    const p = await comSaldo(m, [
      { productId: pid, quantity: '3', lot: 'L-1', ref: 'DEV-M-1' },
      { productId: pid, quantity: '4', lot: 'L-2', ref: 'DEV-M-2' },
      { productId: outro, quantity: '5', lot: null, ref: null },
    ]);
    // Palete não conferido com duas linhas declaradas em documento.
    const declarado = await mutar(m.app, m.op, 'POST', `${API}/paletes`, {
      code: { mode: 'GERAR' },
      positionId: null,
      notes: null,
      declaredItems: [
        { productId: pid, sku: 'IND-MULTI', description: 'Declarado 1', lot: null, originType: 'DEVOLUCAO', originReference: 'DEV-M-9', quantity: '12', unit: 'UN', condition: null },
        { productId: pid, sku: 'IND-MULTI', description: 'Declarado 2', lot: null, originType: 'DEVOLUCAO', originReference: 'DEV-M-9', quantity: '8', unit: 'UN', condition: null },
      ],
    });
    expect(declarado.statusCode, declarado.body).toBe(201);
    const pd = PaleteDetalheSchema.parse(declarado.json());
    const depois = await indicadores(m, m.sup);
    expect(depois.praca?.palletsInStock).toBe((antes.praca?.palletsInStock ?? 0) + 2);
    expect(depois.estoque?.palletsWithUnknownContent).toBe((antes.estoque?.palletsWithUnknownContent ?? 0) + 1);
    // Declarado não entra no saldo validado; aparece só na base documental.
    const un = (i: Indicadores) => i.estoque?.documentary.declaredOnPallets.find((d) => d.unit === 'UN')?.quantity ?? '0';
    expect(Number(un(depois)) - Number(un(antes))).toBe(20);
    expect(Number(saldoUn(depois)) - Number(saldoUn(antes))).toBe(12);
    const r = await relatorio(m, m.sup, 'paletes');
    expect(r.rows.filter((l) => l.codigo === p.code)).toHaveLength(1);
    expect(r.rows.find((l) => l.codigo === p.code)?.saldo).toBe('12 UN');
    const linhaDeclarado = r.rows.find((l) => l.codigo === pd.code);
    expect(linhaDeclarado?.saldo).toBeNull();
    expect(linhaDeclarado?.declarado).toBe('20 UN');
    expect(linhaDeclarado?.conferencia).toBe('Não conferido');
    expect(linhaDeclarado?.posicao).toBe('Localização pendente');
    expect(r.notes.join(' ')).toMatch(/sem conteúdo totalmente validado/);
  });

  it('ocupação sobre posições elegíveis; indisponível sai do denominador; base provisória informada; sem layout não há porcentagem', async () => {
    const antes = await indicadores(m, m.sup);
    expect(antes.positionsBasis.provisional).toBe(true);
    expect(antes.positionsBasis.label).toBe('Base: posições cadastradas — validação do layout pendente');
    expect(antes.praca?.occupancyNote).toMatch(/provisória/);
    const pos = antes.praca?.positions;
    expect(pos && pos.eligible + pos.unavailable).toBe(pos?.registered);
    expect(antes.praca?.occupancyPercent).toBe(((Math.round(((pos?.occupied ?? 0) * 1000) / (pos?.eligible ?? 1)) / 10).toFixed(1)));
    // Fixture isolada do banco de teste: uma posição livre fica indisponível (o denominador muda).
    const [livre] = await db.$queryRaw<{ id: string }[]>`
      SELECT s.id::text FROM posicao s JOIN layout l ON l.id = s.layout_id AND l.ativo
       WHERE s.escopo_id = ${ID_ESCOPO_PRACA}::uuid AND s.disponivel AND s.retirada_em IS NULL AND NOT EXISTS (SELECT 1 FROM palete p WHERE p.posicao_id = s.id) LIMIT 1`;
    await db.$executeRaw`UPDATE posicao SET disponivel = false, motivo_indisponibilidade = 'Teste de base' WHERE id = ${livre?.id}::uuid`;
    const depois = await indicadores(m, m.sup);
    expect(depois.praca?.positions?.eligible).toBe((pos?.eligible ?? 0) - 1);
    expect(depois.praca?.positions?.unavailable).toBe((pos?.unavailable ?? 0) + 1);
    expect(depois.praca?.positions?.occupied).toBe(pos?.occupied);
    expect(depois.praca?.palletsInStock).toBe(antes.praca?.palletsInStock);
    await db.$executeRaw`UPDATE posicao SET disponivel = true, motivo_indisponibilidade = NULL WHERE id = ${livre?.id}::uuid`;
    // Escopo sem layout ativo: sem base para cálculo (nenhuma porcentagem presumida).
    await db.$executeRaw`UPDATE layout SET ativo = false WHERE escopo_id = ${ID_ESCOPO_NAVEGACAO}::uuid`;
    const sem = await indicadores(m, m.outroEscopo);
    expect(sem.praca?.positions).toBeNull();
    expect(sem.praca?.occupancyPercent).toBeNull();
    expect(sem.praca?.occupancyNote).toMatch(/Sem base para cálculo/);
    expect(sem.positionsBasis.layout).toBeNull();
    await db.$executeRaw`UPDATE layout SET ativo = true WHERE escopo_id = ${ID_ESCOPO_NAVEGACAO}::uuid`;
  });
});

describe('claims e valores separados', () => {
  let m: Mundo;

  beforeAll(async () => {
    m = await montar(new Date());
  });

  it('candidato não é recuperação; estimativa não é valor evitado; moedas separadas; correção substitui e anulação sai do total; junções não multiplicam', async () => {
    const pid = await produto(m, '000900');
    const p = await comSaldo(m, [{ productId: pid, quantity: '20', lot: 'L-01', ref: 'DEV-A-01' }]);
    // Caso com duas linhas (o valor do caso não pode ser somado uma vez por linha ou evidência).
    const caso = await criarClaim(
      m,
      claimFalta('000900', {}, { quantity: '12', estimatedValue: '10.00', valueBase: 'UNITARIO' }),
    );
    const linha = caso.lines[0];
    if (!linha) throw new Error('linha');
    const base0 = await indicadores(m, m.analista);
    expect(base0.valores?.estimatedInAnalysis.find((e) => e.currency === 'BRL')?.value).toBe('120.00');
    expect(base0.valores?.avoidedConfirmed).toEqual([]);
    // Candidato em investigação: pista, não recuperação.
    const c = await candidatos(m, caso.id, linha.id);
    const cand = c.items.find((i) => i.base === 'SALDO_VALIDADO' && i.pallet?.id === p.id);
    const reg = await mutar(m.app, m.analista, 'POST', `${API}/claims/${caso.id}/candidatos`, { lineId: linha.id, base: 'SALDO_VALIDADO', palletId: p.id, segmentId: cand?.segmentId });
    expect(reg.statusCode, reg.body).toBe(200);
    const comCandidato = await indicadores(m, m.analista);
    expect(comCandidato.claims?.casesWithCandidates).toBe(1);
    expect(comCandidato.claims?.recoveredValidated).toEqual([]);
    // Recuperação parcial de 3 (duas evidências não multiplicam nada).
    await recuperar(m, caso.id, linha.id, p.id, segmentoDe(p, '000900'), '2');
    const depois = await recuperar(m, caso.id, linha.id, p.id, segmentoDe(p, '000900'), '1');
    const evidencias = depois.evidences.map((e) => e.id);
    const rec = await indicadores(m, m.analista);
    expect(rec.claims?.recoveredValidated).toEqual([{ unit: 'UN', quantity: '3', cases: 1 }]);
    expect(rec.valores?.avoidedConfirmed).toEqual([]);
    // Regularização parcial de R$ 30,00: não confirma o valor inteiro do caso.
    const hoje = dataLocal(m.relogio.agora());
    const res = await mutar(m.app, m.financeiro, 'POST', `${API}/claims/${caso.id}/resultados`, {
      type: 'REGULARIZACAO',
      decisionDate: hoje,
      lines: [{ lineId: linha.id, quantity: '3' }],
      value: '30.00',
      currency: 'BRL',
      source: 'Portal do cliente (fictício)',
      reference: 'REG-IND-1',
      evidenceIds: evidencias,
    });
    expect(res.statusCode, res.body).toBe(200);
    const r1 = ClaimDetalheSchema.parse(res.json());
    let v = await indicadores(m, m.analista);
    expect(v.valores?.avoidedConfirmed).toEqual([{ currency: 'BRL', value: '30.00', count: 1 }]);
    expect(v.valores?.estimatedInAnalysis.find((e) => e.currency === 'BRL')?.value).toBe('120.00');
    // Outra moeda num outro caso: nunca somada ao BRL.
    const pid2 = await produto(m, '000901');
    await comSaldo(m, [{ productId: pid2, quantity: '5', lot: 'L-01', ref: 'DEV-A-01' }]);
    await criarClaim(m, claimFalta('000901', { currency: 'USD' }, { quantity: '5', estimatedValue: '7.00', valueBase: 'UNITARIO' }));
    v = await indicadores(m, m.analista);
    expect(v.valores?.estimatedInAnalysis.map((e) => `${e.currency} ${e.value}`).sort()).toEqual(['BRL 120.00', 'USD 35.00']);
    // Correção substitui o resultado (o anterior fica no histórico, fora do total).
    const corr = await mutar(m.app, m.financeiro, 'POST', `${API}/claims/${caso.id}/resultados`, {
      type: 'REGULARIZACAO',
      decisionDate: hoje,
      lines: [{ lineId: linha.id, quantity: '3' }],
      value: '30.00',
      currency: 'BRL',
      source: 'Portal do cliente (fictício)',
      reference: 'REG-IND-1-C',
      evidenceIds: evidencias,
      correctsResultId: r1.results[0]?.id,
      correctionReason: 'Referência corrigida (teste).',
    });
    expect(corr.statusCode, corr.body).toBe(200);
    const r2 = ClaimDetalheSchema.parse(corr.json());
    v = await indicadores(m, m.analista);
    expect(v.valores?.avoidedConfirmed).toEqual([{ currency: 'BRL', value: '30.00', count: 1 }]);
    expect(v.valores?.corrections.corrected).toBe(1);
    const anular = await mutar(m.app, m.financeiro, 'POST', `${API}/claims/${caso.id}/resultados/${r2.results[1]?.id ?? ''}/anular`, {
      expectedVersion: r2.results[1]?.version,
      reason: 'Contestação aceita (teste).',
    });
    expect(anular.statusCode, anular.body).toBe(200);
    v = await indicadores(m, m.analista);
    expect(v.valores?.avoidedConfirmed).toEqual([]);
    expect(v.valores?.corrections).toEqual({ corrected: 1, annulled: 1 });
    // Relatório de claims: mesma definição, valores por moeda separados.
    const rc = await relatorio(m, m.analista, 'claims');
    const linhaCaso = rc.rows.find((l) => l.codigo === caso.code);
    expect(linhaCaso).toMatchObject({ recuperada: '3 UN', estimado: 'BRL 120.00', evitado: null, historico: '2', candidatos: '1' });
  });
});

describe('período no fuso da operação', () => {
  let m: Mundo;

  beforeAll(async () => {
    // 23:59:59,999 de 03/10/2026 em São Paulo (02:59:59,999 UTC do dia 04).
    m = await montar(new Date('2026-10-04T02:59:59.999Z'));
  });

  it('a virada do dia não perde nem repete eventos; limites inclusivos convertidos para UTC', async () => {
    const pid = await produto(m, 'IND-FUSO');
    const p = await comSaldo(m, [{ productId: pid, quantity: '3', lot: 'L-F', ref: 'DEV-F' }]);
    // 00:00:00,000 de 04/10 em São Paulo: recontagem para 7.
    m.relogio.avancar(1);
    await m.relogar();
    const atual = await palete(m, p.id);
    const { resposta } = await reconciliar(m, atual.id, [{ productId: pid, quantity: '7', lot: 'L-F', ref: 'DEV-F' }]);
    expect(resposta?.statusCode, resposta?.body).toBe(200);
    const dia3 = await relatorio(m, m.sup, 'estoque', '?inicio=2026-10-03&fim=2026-10-03&sku=IND-FUSO');
    expect(dia3.period).toMatchObject({ start: '2026-10-03', end: '2026-10-03', startUtc: '2026-10-03T03:00:00.000Z', endUtc: '2026-10-04T03:00:00.000Z' });
    expect(total(dia3, 'Entradas validadas (UN)')).toBe('3');
    expect(total(dia3, 'Ajustes líquidos (UN)')).toBe('0');
    expect(total(dia3, 'Saldo final (UN)')).toBe('3');
    const dia4 = await relatorio(m, m.sup, 'estoque', '?inicio=2026-10-04&fim=2026-10-04&sku=IND-FUSO');
    expect(total(dia4, 'Saldo inicial (UN)')).toBe('3');
    expect(total(dia4, 'Ajustes líquidos (UN)')).toBe('4');
    expect(total(dia4, 'Saldo final (UN)')).toBe('7');
    const ambos = await relatorio(m, m.sup, 'estoque', '?inicio=2026-10-03&fim=2026-10-04&sku=IND-FUSO');
    expect(total(ambos, 'Entradas validadas (UN)')).toBe('3');
    expect(total(ambos, 'Ajustes líquidos (UN)')).toBe('4');
  });

  it('padrão: do primeiro dia do mês até hoje; período inválido ou longo demais é recusado', async () => {
    const i = await indicadores(m, m.sup);
    expect(i.period).toMatchObject({ start: '2026-10-01', end: '2026-10-04', timezone: 'America/Sao_Paulo', includesToday: true });
    expect((await como(m.app, m.sup, { method: 'GET', url: `${API}/indicadores?inicio=2026-10-05&fim=2026-10-01` })).statusCode).toBe(400);
    expect((await como(m.app, m.sup, { method: 'GET', url: `${API}/indicadores?inicio=2025-01-01&fim=2026-10-04` })).statusCode).toBe(400);
    expect((await como(m.app, m.sup, { method: 'GET', url: `${API}/indicadores?inicio=2026-13-01` })).statusCode).toBe(400);
  });
});

describe('permissões, escopo e exportação', () => {
  let m: Mundo;

  beforeAll(async () => {
    m = await montar(new Date());
  });

  it('cada área exige sua permissão no servidor; outro escopo vê só os próprios números', async () => {
    const consulta = await indicadores(m, m.consulta);
    expect(consulta.claims).toBeNull();
    expect(consulta.valores).toBeNull();
    expect(consulta.restricted).toEqual(expect.arrayContaining(['claims', 'valores']));
    expect(consulta.janelas).not.toBeNull();
    expect(consulta.praca).not.toBeNull();
    const analista = await indicadores(m, m.analista);
    expect(analista.valores).not.toBeNull();
    expect((await como(m.app, m.consulta, { method: 'GET', url: `${API}/relatorios/claims` })).statusCode).toBe(403);
    expect((await como(m.app, m.analista, { method: 'GET', url: `${API}/relatorios/expedicoes` })).statusCode).toBe(200);
    const outro = await indicadores(m, m.outroEscopo);
    expect(outro.scope.id).toBe(ID_ESCOPO_NAVEGACAO);
    const sup = await indicadores(m, m.sup);
    expect(outro.praca?.palletsInStock).not.toBe(sup.praca?.palletsInStock);
    expect((await como(m.app, m.sup, { method: 'GET', url: `${API}/relatorios/desconhecido` })).statusCode).toBe(400);
  });

  it('exportar exige permissão própria; CSV com filtros, base, horário, limite e células protegidas contra fórmula; auditado', async () => {
    const pid = (await criarProduto(m, 'IND-CSV', '=HYPERLINK("http://exemplo.invalid","x")')).id;
    await comSaldo(m, [{ productId: pid, quantity: '2', lot: '+LOTE', ref: '00123' }]);
    expect((await como(m.app, m.op, { method: 'GET', url: `${API}/relatorios/estoque/exportar` })).statusCode).toBe(403);
    expect((await como(m.app, m.consulta, { method: 'GET', url: `${API}/relatorios/paletes/exportar` })).statusCode).toBe(403);
    const r = await como(m.app, m.sup, { method: 'GET', url: `${API}/relatorios/estoque/exportar?sku=IND-CSV` });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['cache-control']).toBe('no-store');
    const texto = r.body;
    expect(texto).toContain('"Movimento do estoque validado por produto, lote e origem — Praça Reversa"');
    expect(texto).toContain('"SKU (começa com)";"IND-CSV"');
    expect(texto).toMatch(/"Consultado em";"\d{2}\/\d{2}\/\d{4}/);
    expect(texto).toContain(`"'=HYPERLINK(""http://exemplo.invalid"",""x"")"`);
    expect(texto).toContain(`"'+LOTE"`);
    expect(texto).toContain('"Devolução 00123"');
    expect(texto).not.toMatch(/;=|;\+/);
    expect(await db.eventoAuditoria.count({ where: { acao: 'RELATORIO_EXPORTADO' } })).toBe(1);
    const negados = await db.eventoAuditoria.count({ where: { acao: 'ACESSO_NEGADO', detalhes: { path: ['permissao'], string_contains: 'relatorio.exportar' } } });
    expect(negados).toBeGreaterThan(0);
  });

  it('relatório do piloto: grupo pelos códigos, transferências que cruzam o grupo à parte, códigos não encontrados avisados', async () => {
    const pid = await produto(m, 'IND-PIL');
    const g1 = await comSaldo(m, [{ productId: pid, quantity: '9', lot: 'L-P', ref: 'DEV-P' }]);
    const fora = await comSaldo(m, [{ productId: pid, quantity: '1', lot: 'L-P', ref: 'DEV-P' }]);
    await transferir(m, g1, fora, segmentoDe(g1, 'IND-PIL'), '4');
    const r = await relatorio(m, m.sup, 'piloto', `?paletes=${encodeURIComponent(`${g1.code}, NAO-EXISTE-1`)}`);
    const un = r.rows.find((l) => l.unidade === 'UN');
    expect(un).toMatchObject({ entradas: '9', enviado: '4', recebido: '0', interno: '0', final: '5' });
    expect(r.notes.join(' ')).toContain('NAO-EXISTE-1');
    expect(total(r, 'Paletes do grupo encontrados')).toBe('1');
    expect((await como(m.app, m.sup, { method: 'GET', url: `${API}/relatorios/piloto` })).statusCode).toBe(400);
  });
});

describe('tutorial: preferência por usuário e exemplo sem gravação operacional', () => {
  let m: Mundo;

  beforeAll(async () => {
    m = await montar(new Date());
  });

  it('preferência começa não iniciada, guarda adiado/interrompido/concluído só do próprio usuário e recusa passo incoerente', async () => {
    const ler = async (s: SessaoTeste) => PreferenciaTutorialSchema.parse((await como(m.app, s, { method: 'GET', url: `${API}/preferencias/tutorial` })).json());
    expect((await ler(m.op)).state).toBe('NAO_INICIADO');
    const put = (s: SessaoTeste, corpo: unknown) => como(m.app, s, { method: 'PUT', url: `${API}/preferencias/tutorial`, payload: corpo as object });
    expect((await put(m.op, { state: 'INTERROMPIDO', step: 3 })).statusCode).toBe(200);
    expect(await ler(m.op)).toMatchObject({ state: 'INTERROMPIDO', step: 3 });
    expect((await ler(m.consulta)).state).toBe('NAO_INICIADO');
    expect((await put(m.op, { state: 'INTERROMPIDO', step: null })).statusCode).toBe(400);
    expect((await put(m.op, { state: 'CONCLUIDO', step: 2 })).statusCode).toBe(400);
    expect((await put(m.op, { state: 'CONCLUIDO', step: null })).statusCode).toBe(200);
    expect(await ler(m.op)).toMatchObject({ state: 'CONCLUIDO', step: null });
    // Sem token anti-CSRF a gravação é recusada como qualquer outra.
    expect((await como(m.app, m.op, { method: 'PUT', url: `${API}/preferencias/tutorial`, payload: { state: 'ADIADO', step: null }, semCsrf: true })).statusCode).toBe(403);
  });

  it('exemplo da demonstração: SKU em mais de um palete e base; nada operacional é gravado', async () => {
    const eventos = await db.eventoEstoque.count();
    const paletes = await db.palete.count();
    const r = await como(m.app, m.consulta, { method: 'GET', url: `${API}/ajuda/exemplo` });
    expect(r.statusCode, r.body).toBe(200);
    const ex = ExemploTutorialSchema.parse(r.json());
    expect(ex.kind).toBe('PRODUTO');
    expect(ex.demo).toBe(true);
    expect(ex.product?.sku).toBe('DEMO-101');
    expect(ex.pallet?.positionCode).not.toBeNull();
    expect(ex.occurrences.pallets).toBeGreaterThan(1);
    expect(ex.occurrences.bases).toEqual(expect.arrayContaining(['SALDO_VALIDADO', 'OBSERVADO']));
    expect(await db.eventoEstoque.count()).toBe(eventos);
    expect(await db.palete.count()).toBe(paletes);
    // Escopo sem saldo validado: exemplo de palete (ou nenhum), com o motivo.
    const outro = ExemploTutorialSchema.parse((await como(m.app, m.outroEscopo, { method: 'GET', url: `${API}/ajuda/exemplo` })).json());
    expect(['PALETE', 'NENHUM', 'PRODUTO']).toContain(outro.kind);
    if (outro.kind !== 'PRODUTO') expect(outro.reason).not.toBeNull();
  });
});
