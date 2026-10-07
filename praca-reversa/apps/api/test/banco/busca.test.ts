import {
  ConferenciaDetalheSchema,
  LoteImportacaoSchema,
  PaleteDetalheSchema,
  ProdutoSchema,
  RespostaBuscaSchema,
  ResultadoEnvioSchema,
  type PaleteDetalhe,
  type Produto,
  type RespostaBusca,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import {
  ID_ESCOPO_NAVEGACAO,
  ID_ESCOPO_PRACA,
  appDeTeste,
  bancoDeTeste,
  como,
  codigoErro,
  criarUsuario,
  entrar,
  enviarArquivo,
  idPosicao,
  mutar,
  prepararDados,
  type SessaoTeste,
} from './apoio.js';

/**
 * Busca operacional contra PostgreSQL real: bases separadas (saldo validado,
 * observado, declarado no palete, documento importado), 5 + 7 = 12 mesmo com
 * declaração de 100 e recontagens, localização e saldo atuais depois de
 * movimentações, paginação estável, filtros, escopo e exportação CSV.
 */
const API = '/api/v1';
let db: Banco;
let app: FastifyInstance;
let sSup: SessaoTeste;
let sOp: SessaoTeste;
let sCons: SessaoTeste;
let sNav: SessaoTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const [sup, op, cons, nav] = await Promise.all([
    criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'operador', [[ID_ESCOPO_PRACA, 'OPERADOR']]),
    criarUsuario(db, 'consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]),
    criarUsuario(db, 'nav.supervisor', [[ID_ESCOPO_NAVEGACAO, 'SUPERVISOR_ESTOQUE']]),
  ]);
  [sSup, sOp, sCons, sNav] = await Promise.all([entrar(app, sup), entrar(app, op), entrar(app, cons), entrar(app, nav)]);
});

afterAll(async () => {
  await db.$disconnect();
});

// ---------- Apoio ----------

async function criarProduto(sku: string, descricao: string, codigo: string | null = null): Promise<Produto> {
  const r = await mutar(app, sSup, 'POST', `${API}/produtos`, {
    sku,
    description: descricao,
    canonicalUnit: 'UN',
    active: true,
    barcodes: codigo === null ? [] : [{ code: codigo, packaging: 'UN', factor: '1' }],
  });
  expect(r.statusCode, r.body).toBe(201);
  return ProdutoSchema.parse(r.json());
}

async function criarPalete(posicao: string | null, declarados: object[] = []): Promise<PaleteDetalhe> {
  const positionId = posicao === null ? null : await idPosicao(db, ID_ESCOPO_PRACA, posicao);
  const r = await mutar(app, sOp, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId, notes: null, declaredItems: declarados });
  expect(r.statusCode, r.body).toBe(201);
  return PaleteDetalheSchema.parse(r.json());
}

async function palete(id: string): Promise<PaleteDetalhe> {
  return PaleteDetalheSchema.parse((await como(app, sSup, { method: 'GET', url: `${API}/paletes/${id}` })).json());
}

interface Item {
  productId: string;
  quantity: string;
  lot: string | null;
  ref: string | null;
}

async function observar(sessaoId: string, itens: Item[]) {
  for (const i of itens) {
    const r = await mutar(app, sOp, 'POST', `${API}/conferencias/${sessaoId}/observacoes`, {
      mode: 'MANUAL',
      productId: i.productId,
      quantity: i.quantity,
      unit: 'UN',
      lot: i.lot,
      originType: i.ref === null ? null : 'DEVOLUCAO',
      originReference: i.ref,
      condition: 'SAUDAVEL',
    });
    expect(r.statusCode, r.body).toBe(201);
  }
}

async function concluir(sessaoId: string, completa: boolean) {
  const atual = ConferenciaDetalheSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/conferencias/${sessaoId}` })).json());
  const r = await mutar(app, sOp, 'POST', `${API}/conferencias/${sessaoId}/concluir`, {
    expectedRevision: atual.revision,
    expectedPalletVersion: atual.pallet.version,
    confirmFullScope: completa,
  });
  expect(r.statusCode, r.body).toBe(200);
  return ConferenciaDetalheSchema.parse(r.json());
}

/** Contagem concluída (sem reconciliar). */
async function contar(paleteId: string, itens: Item[], completa = true) {
  const p = await palete(paleteId);
  const inicio = await mutar(app, sOp, 'POST', `${API}/paletes/${paleteId}/conferencias`, {
    scope: completa ? 'COMPLETA' : 'PARCIAL',
    scopeDescription: completa ? null : 'Camada superior',
    expectedVersion: p.version,
  });
  expect(inicio.statusCode, inicio.body).toBe(201);
  const sessao = ConferenciaDetalheSchema.parse(inicio.json());
  await observar(sessao.id, itens);
  return concluir(sessao.id, completa);
}

/** Saldo validado pelo fluxo real (contagem completa + reconciliação do supervisor). */
async function reconciliar(paleteId: string, itens: Item[]) {
  const sessao = await contar(paleteId, itens);
  const r = await mutar(app, sSup, 'POST', `${API}/conferencias/${sessao.id}/reconciliar`, { expectedPalletVersion: sessao.pallet.version, justification: 'Saldo de teste' });
  expect(r.statusCode, r.body).toBe(200);
  return palete(paleteId);
}

async function buscar(query: string, s: SessaoTeste = sSup): Promise<RespostaBusca> {
  const r = await como(app, s, { method: 'GET', url: `${API}/busca?${query}` });
  expect(r.statusCode, r.body).toBe(200);
  return RespostaBuscaSchema.parse(r.json());
}

const CAB = 'Referência da devolução;Linha;SKU;Quantidade declarada;Unidade declarada;NF;Lote;Data do documento';

async function importarDocumento(linhas: string[]) {
  const envio = await enviarArquivo(app, sSup, 'DEVOLUCOES', 'dev.csv', Buffer.from([CAB, ...linhas].join('\r\n'), 'utf8'));
  expect(envio.statusCode, envio.body).toBe(201);
  const e = ResultadoEnvioSchema.parse(envio.json());
  if (!e.batch || !e.structure) throw new Error('lote');
  const mapa = await mutar(app, sSup, 'PUT', `${API}/importacoes/${e.batch.id}/mapeamento`, {
    expectedVersion: e.batch.version,
    options: e.structure.options,
    decimalSeparator: 'VIRGULA',
    columns: e.structure.suggestedColumns,
  });
  expect(mapa.statusCode, mapa.body).toBe(200);
  const lote = LoteImportacaoSchema.parse(mapa.json());
  expect(lote.counters.validNew).toBe(linhas.length);
  const r = await mutar(app, sSup, 'POST', `${API}/importacoes/${lote.id}/confirmar`, { previewVersion: lote.previewVersion, reviewed: true });
  expect(r.statusCode, r.body).toBe(200);
}

/**
 * Cenário: BUS-001 com saldo validado 5 (PAL-A, lote L-01) e 7 (PAL-B, lote
 * L-02); PAL-A com nova contagem completa recontada (a original fica
 * substituída); PAL-B com contagem parcial; PAL-C sem posição com 12
 * declaradas; documento importado de 100 sem vínculo físico.
 */
async function cenario() {
  const produto = await criarProduto('BUS-001', 'Shampoo Cenário Busca', '0789000000017');
  const a = await reconciliar((await criarPalete('F03-P10')).id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-B-01' }]);
  const b = await reconciliar((await criarPalete('F03-P11')).id, [{ productId: produto.id, quantity: '7', lot: 'L-02', ref: 'DEV-B-02' }]);
  const c = await criarPalete(null, [{ sku: 'BUS-001', description: null, lot: null, originType: 'DEVOLUCAO', originReference: 'DEV-B-03', quantity: '12', unit: 'UN' }]);
  // Nova contagem completa em A e recontagem: só a recontagem fica como observação atual.
  const original = await contar(a.id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-B-01' }]);
  const pedido = await mutar(app, sOp, 'POST', `${API}/conferencias/${original.id}/recontagem`, { expectedPalletVersion: original.pallet.version, justification: 'Conferir de novo' });
  expect(pedido.statusCode, pedido.body).toBe(201);
  const recontagem = ConferenciaDetalheSchema.parse(pedido.json());
  await observar(recontagem.id, [{ productId: produto.id, quantity: '5', lot: 'L-01', ref: 'DEV-B-01' }]);
  await concluir(recontagem.id, true);
  await contar(b.id, [{ productId: produto.id, quantity: '7', lot: 'L-02', ref: 'DEV-B-02' }], false);
  await importarDocumento(['DEV-B-99;1;BUS-001;100;UN;000099;;15/09/2026']);
  return { produto, a, b, c, original, recontagem };
}

const chaves = (r: RespostaBusca) => r.items.map((i) => `${i.base}:${i.pallet?.code ?? '-'}:${i.quantity ?? '-'}`);

// ---------- Cenários ----------

describe('Busca por SKU: bases separadas e totais sem mistura', () => {
  it('saldo validado 5 + 7 = 12; observações, declaração e documento de 100 ficam à parte', async () => {
    const { a, b, c, original, recontagem } = await cenario();
    const r = await buscar('texto=BUS-001&campo=SKU');
    expect(r.total).toBe(6);
    expect(new Set(r.items.map((i) => i.match))).toEqual(new Set(['SKU']));
    expect(chaves(r)).toEqual([
      `SALDO_VALIDADO:${a.code}:5`,
      `SALDO_VALIDADO:${b.code}:7`,
      `OBSERVADO:${a.code}:5`,
      `OBSERVADO:${b.code}:7`,
      `DECLARADO_PALETE:${c.code}:12`,
      'DOCUMENTO:-:100',
    ]);
    const obsA = r.items.find((i) => i.base === 'OBSERVADO' && i.pallet?.id === a.id);
    expect(obsA?.session?.id).toBe(recontagem.id);
    expect(r.items.some((i) => i.session?.id === original.id)).toBe(false);
    const doc = r.items.find((i) => i.base === 'DOCUMENTO');
    expect(doc).toMatchObject({ pallet: null, originType: 'DEVOLUCAO', originReference: 'DEV-B-99', lot: null, document: { lineReference: '1', invoice: '000099', date: '2026-09-15', declaredQuantity: '100', declaredUnit: 'UN' } });
    const saldoA = r.items.find((i) => i.base === 'SALDO_VALIDADO' && i.pallet?.id === a.id);
    expect(saldoA).toMatchObject({ lot: 'L-01', originReference: 'DEV-B-01', condition: 'SAUDAVEL', reserved: '0', available: '5', unit: 'UN', pallet: { positionCode: 'F03-P10' } });
    expect(r.items.find((i) => i.base === 'DECLARADO_PALETE')?.pallet).toMatchObject({ positionId: null, positionCode: null });
    // Resumo: cada base com o seu total; nada soma 112 ou 124.
    const resumo = Object.fromEntries(r.summary.map((g) => [g.base, g]));
    expect(resumo.SALDO_VALIDADO).toMatchObject({ quantity: '12', reserved: '0', available: '12', records: 2, pallets: 2, unit: 'UN' });
    expect(resumo.SALDO_VALIDADO?.breakdown.map((x) => [x.lot, x.quantity])).toEqual([
      ['L-01', '5'],
      ['L-02', '7'],
    ]);
    expect(resumo.OBSERVADO).toMatchObject({ quantity: null, records: 2, pallets: 2 });
    expect(resumo.DECLARADO_PALETE).toMatchObject({ quantity: '12', records: 1 });
    expect(resumo.DOCUMENTO).toMatchObject({ quantity: '100', records: 1, pallets: 0 });
    expect(r.summary.some((g) => g.quantity === '112' || g.quantity === '124')).toBe(false);
    expect(new Set(r.palletIds)).toEqual(new Set([a.id, b.id, c.id]));
  });

  it('código de barras, lote, devolução, NF, prefixo e descrição aproximada', async () => {
    const { a, b } = await cenario();
    const barras = await buscar('texto=0789000000017');
    expect(barras.total).toBe(6);
    expect(new Set(barras.items.map((i) => i.match))).toEqual(new Set(['CODIGO_BARRAS']));
    const lote = await buscar('texto=l-02&campo=LOTE');
    expect(chaves(lote)).toEqual([`SALDO_VALIDADO:${b.code}:7`, `OBSERVADO:${b.code}:7`]);
    const dev = await buscar('texto=DEV-B-99&campo=DOCUMENTO');
    expect(chaves(dev)).toEqual(['DOCUMENTO:-:100']);
    expect((await buscar('texto=DEV-B-0&campo=DOCUMENTO')).items.map((i) => i.match)).toEqual(['DOCUMENTO_PREFIXO', 'DOCUMENTO_PREFIXO', 'DOCUMENTO_PREFIXO', 'DOCUMENTO_PREFIXO', 'DOCUMENTO_PREFIXO']);
    expect(chaves(await buscar('texto=000099&campo=NF'))).toEqual(['DOCUMENTO:-:100']);
    const descricao = await buscar('texto=cenario busca&campo=DESCRICAO');
    expect(descricao.total).toBe(6);
    expect(new Set(descricao.items.map((i) => i.match))).toEqual(new Set(['DESCRICAO_APROXIMADA']));
    const prefixo = await buscar('texto=BUS-0');
    expect(new Set(prefixo.items.map((i) => i.match))).toEqual(new Set(['SKU_PREFIXO']));
    // Texto curto não busca por início nem descrição.
    expect((await buscar('texto=BU')).total).toBe(0);
    expect(a.id).not.toBe(b.id);
  });

  it('palete pelo código, pelo link do QR e pelo endereço', async () => {
    const { a } = await cenario();
    const porCodigo = await buscar(`texto=${encodeURIComponent(a.code.toLowerCase())}`);
    expect(porCodigo.items.map((i) => [i.base, i.match, i.pallet?.id])).toEqual([['PALETE', 'CODIGO_PALETE', a.id]]);
    expect(porCodigo.items[0]?.quantity).toBeNull();
    const qr = await buscar(`texto=${encodeURIComponent(`https://qualquer.invalid/paletes/${a.id}`)}`);
    expect(qr.items.map((i) => i.match)).toEqual(['ID_PALETE']);
    expect((await buscar('texto=f03p10')).items.map((i) => [i.match, i.pallet?.id])).toEqual([['ENDERECO', a.id]]);
    expect((await buscar('texto=F03-P1&campo=ENDERECO')).items.map((i) => i.match)).toEqual(['ENDERECO_PARCIAL', 'ENDERECO_PARCIAL']);
  });
});

describe('Estado atual depois de movimentações (localização e saldo)', () => {
  it('mover e transferir: a busca mostra o novo endereço e o saldo atual, não o histórico', async () => {
    const { a, b } = await cenario();
    // A conferência pendente de A foi substituída pela recontagem concluída (sem conferência em andamento): pode mover.
    const destino = await idPosicao(db, ID_ESCOPO_PRACA, 'F03-P12');
    const atualA = await palete(a.id);
    const mov = await mutar(app, sOp, 'POST', `${API}/paletes/${a.id}/movimentos`, {
      destinationPositionId: destino,
      confirmedPositionCode: 'F03-P12',
      expectedVersion: atualA.version,
      reason: 'Reorganização de teste',
    });
    expect(mov.statusCode, mov.body).toBe(200);
    const seg = (await palete(a.id)).currentItems?.[0];
    if (!seg) throw new Error('segmento');
    const [pa, pb] = await Promise.all([palete(a.id), palete(b.id)]);
    const transf = await mutar(app, sOp, 'POST', `${API}/transferencias`, {
      sourcePalletId: a.id,
      destinationPalletId: b.id,
      segmentId: seg.segmentId,
      quantity: '2',
      expectedSourceVersion: pa.version,
      expectedDestinationVersion: pb.version,
      reason: 'Consolidação de teste',
    });
    expect(transf.statusCode, transf.body).toBe(200);
    const r = await buscar('texto=BUS-001&campo=SKU&base=SALDO_VALIDADO');
    expect(r.items.map((i) => [i.pallet?.code, i.pallet?.positionCode, i.lot, i.quantity])).toEqual([
      [a.code, 'F03-P12', 'L-01', '3'],
      [b.code, 'F03-P11', 'L-01', '2'],
      [b.code, 'F03-P11', 'L-02', '7'],
    ]);
    expect(r.summary).toHaveLength(1);
    expect(r.summary[0]).toMatchObject({ base: 'SALDO_VALIDADO', quantity: '12', records: 3, pallets: 2 });
    expect((await buscar('texto=f03p10')).total).toBe(0);
  });
});

describe('Filtros, paginação e validação', () => {
  it('filtros de base, localização, situação e em conferência; documento sai com filtro de palete', async () => {
    const { a, c } = await cenario();
    expect(chaves(await buscar('texto=BUS-001&base=DOCUMENTO'))).toEqual(['DOCUMENTO:-:100']);
    const pendente = await buscar('texto=BUS-001&localizacao=PENDENTE');
    expect(chaves(pendente)).toEqual([`DECLARADO_PALETE:${c.code}:12`]);
    const situacao = await buscar(`texto=BUS-001&conferencia=${a.countState}`);
    expect(situacao.items.every((i) => i.pallet?.countState === a.countState)).toBe(true);
    expect(situacao.items.some((i) => i.base === 'DOCUMENTO')).toBe(false);
    const liberacao = await buscar('texto=BUS-001&liberacao=LIBERADO');
    expect(liberacao.total).toBe(0);
    expect((await buscar('texto=BUS-001&condicao=AVARIADO')).total).toBe(0);
    // Sem texto: paletes pelos filtros (localização pendente) — conteúdo só com base escolhida.
    const semTexto = await buscar('localizacao=PENDENTE');
    expect(semTexto.items.every((i) => i.base === 'PALETE' && i.pallet?.positionId === null)).toBe(true);
    expect(semTexto.items.some((i) => i.pallet?.id === c.id)).toBe(true);
    const inicio = await mutar(app, sOp, 'POST', `${API}/paletes/${c.id}/conferencias`, { scope: 'COMPLETA', expectedVersion: c.version });
    expect(inicio.statusCode).toBe(201);
    const emConferencia = await buscar('texto=BUS-001&emConferencia=true');
    expect(chaves(emConferencia)).toEqual([`DECLARADO_PALETE:${c.code}:12`]);
    expect(emConferencia.items[0]?.pallet?.activeCountId).not.toBeNull();
    expect((await buscar('')).total).toBe(0);
  });

  it('paginação estável no servidor: páginas somam o total sem repetir', async () => {
    await cenario();
    const todas = await buscar('texto=BUS-001&tamanho=100');
    const paginas: string[] = [];
    for (let p = 1; p <= 3; p++) {
      const pagina = await buscar(`texto=BUS-001&tamanho=2&pagina=${String(p)}`);
      expect(pagina.total).toBe(6);
      paginas.push(...pagina.items.map((i) => i.key));
    }
    expect(paginas).toEqual(todas.items.map((i) => i.key));
    expect(new Set(paginas).size).toBe(6);
    for (const q of ['tamanho=101', 'pagina=0', 'pagina=500&tamanho=100', 'base=OUTRA', 'campo=XYZ', `texto=${'x'.repeat(121)}`]) {
      const r = await como(app, sSup, { method: 'GET', url: `${API}/busca?${q}` });
      expect(r.statusCode, q).toBe(400);
    }
  });
});

describe('Escopo, permissões e exportação', () => {
  it('outro escopo não vê nada; sem sessão 401; exportação exige permissão e segue os filtros', async () => {
    const { a, b } = await cenario();
    expect((await buscar('texto=BUS-001', sNav)).total).toBe(0);
    expect((await buscar(`texto=${a.id}`, sNav)).total).toBe(0);
    expect((await app.inject({ method: 'GET', url: `${API}/busca?texto=BUS-001` })).statusCode).toBe(401);
    // Consulta busca, mas não exporta; operador também não.
    expect((await buscar('texto=BUS-001', sCons)).total).toBe(6);
    for (const s of [sCons, sOp]) expect((await como(app, s, { method: 'GET', url: `${API}/busca/exportar?texto=BUS-001` })).statusCode).toBe(403);
    expect((await como(app, sNav, { method: 'GET', url: `${API}/busca/exportar?texto=BUS-001` })).body).not.toContain('BUS-001";');

    const exp = await como(app, sSup, { method: 'GET', url: `${API}/busca/exportar?texto=L-02&campo=LOTE` });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toMatch(/text\/csv/);
    expect(exp.headers['content-disposition']).toMatch(/attachment; filename="busca-/);
    const linhas = exp.body.split('\r\n');
    expect(linhas[0]?.charCodeAt(0)).toBe(0xfeff);
    expect(exp.body).toContain('"Filtros";"texto: L-02; buscar em: LOTE; bases: todas"');
    expect(exp.body).toMatch(/"Gerado em";"\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2} \(horário de Brasília\)"/);
    expect(exp.body).toContain('"Base das quantidades"');
    const dados = linhas.filter((l) => l.startsWith('"Saldo validado"') || l.startsWith('"Observado'));
    expect(dados).toHaveLength(2);
    expect(dados.every((l) => l.includes(`"${b.code}"`) && l.includes('"L-02"'))).toBe(true);
    expect(await db.eventoAuditoria.count({ where: { acao: 'BUSCA_EXPORTADA', escopoId: ID_ESCOPO_PRACA } })).toBe(1);
  });

  it('exportação limitada informa a limitação; texto com fórmula é protegido no CSV e intacto no banco', async () => {
    await cenario();
    await criarProduto('FORM-B', '=1+2 descrição perigosa');
    const reduzido = await appDeTeste(db, { exportacaoMaxLinhas: 2 });
    const r = await como(reduzido, sSup, { method: 'GET', url: `${API}/busca/exportar?texto=BUS-001` });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('"2 de 6 (limitado a 2 linhas: refine os filtros)"');
    await reduzido.close();
    // Produto sem estoque não aparece na busca de conteúdo; a proteção vale para qualquer célula exportada.
    const exp = await como(app, sSup, { method: 'GET', url: `${API}/busca/exportar?texto=BUS-001&campo=SKU` });
    expect(exp.body).not.toMatch(/;"=/);
    expect((await db.produto.findFirstOrThrow({ where: { sku: 'FORM-B' } })).descricao).toBe('=1+2 descrição perigosa');
  });
});

describe('Busca sem critério e erros', () => {
  it('sem texto nem filtro devolve vazio (nada carregado de uma vez)', async () => {
    await cenario();
    const r = await buscar('');
    expect(r).toMatchObject({ total: 0, items: [], summary: [] });
    const invalida = await como(app, sSup, { method: 'GET', url: `${API}/busca?emConferencia=talvez` });
    expect(codigoErro(invalida)).toBe('REQUISICAO_INVALIDA');
  });
});
