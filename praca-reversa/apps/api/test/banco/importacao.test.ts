import {
  LoteImportacaoSchema,
  PaginaLinhasSchema,
  PaginaLotesSchema,
  ProdutoSchema,
  ResultadoConfirmacaoSchema,
  ResultadoEnvioSchema,
  type ClassificacaoLinha,
  type LoteImportacao,
  type OpcoesLeitura,
  type ResultadoEnvio,
  type SeparadorDecimal,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
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
  enviarArquivo,
  mutar,
  prepararDados,
  type SessaoTeste,
} from './apoio.js';

/**
 * Importação de produtos e documentos de devolução contra PostgreSQL real:
 * T14 (arquivo/linha repetidos), T15 (zeros preservados), T16 (documento de
 * 100 unidades não cria saldo), concorrência entre lotes, reenvio, falha na
 * gravação, limites, fórmulas, modelos e permissões.
 */
const API = '/api/v1';
const FIXTURES = new URL('../fixtures/excel/', import.meta.url);
let db: Banco;
let app: FastifyInstance;
let sSup: SessaoTeste;
let sSup2: SessaoTeste;
let sOp: SessaoTeste;
let sCons: SessaoTeste;
let sNav: SessaoTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const [sup, sup2, op, cons, nav] = await Promise.all([
    criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'supervisor2', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'operador', [[ID_ESCOPO_PRACA, 'OPERADOR']]),
    criarUsuario(db, 'consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]),
    criarUsuario(db, 'nav.supervisor', [[ID_ESCOPO_NAVEGACAO, 'SUPERVISOR_ESTOQUE']]),
  ]);
  [sSup, sSup2, sOp, sCons, sNav] = await Promise.all([entrar(app, sup), entrar(app, sup2), entrar(app, op), entrar(app, cons), entrar(app, nav)]);
});

afterAll(async () => {
  await db.$disconnect();
});

// ---------- Apoio ----------

/** CSV com ; e BOM; campos com ; ou aspas entre aspas. */
function csv(linhas: readonly (readonly (string | null)[])[]): Buffer {
  const campo = (v: string | null) => (v === null ? '' : /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return Buffer.from(String.fromCharCode(0xfeff) + linhas.map((l) => l.map(campo).join(';')).join('\r\n') + '\r\n', 'utf8');
}

const CAB_PRODUTOS = ['SKU', 'Descrição', 'Unidade canônica', 'Código de barras', 'Embalagem do código', 'Fator'];
const CAB_DEVOLUCOES = ['Referência da devolução', 'Linha/item do documento', 'SKU', 'Quantidade declarada', 'Unidade declarada', 'NF', 'Lote', 'Data do documento'];

async function enviar(s: SessaoTeste, tipo: 'PRODUTOS' | 'DEVOLUCOES', nome: string, conteudo: Buffer, status = 201): Promise<ResultadoEnvio> {
  const r = await enviarArquivo(app, s, tipo, nome, conteudo);
  expect(r.statusCode, r.body).toBe(status);
  return ResultadoEnvioSchema.parse(r.json());
}

interface OpcoesMapa {
  options?: Partial<OpcoesLeitura>;
  decimal?: SeparadorDecimal;
  columns?: Record<string, number | null>;
}

async function mapear(s: SessaoTeste, lote: LoteImportacao, envio: ResultadoEnvio | null, opcoes: OpcoesMapa = {}, status = 200) {
  const sugeridas = envio?.structure?.suggestedColumns ?? lote.columns ?? {};
  const r = await mutar(app, s, 'PUT', `${API}/importacoes/${lote.id}/mapeamento`, {
    expectedVersion: lote.version,
    options: { sheet: null, headerRow: 1, encoding: null, delimiter: null, ...(lote.options ?? {}), ...opcoes.options },
    decimalSeparator: opcoes.decimal ?? 'VIRGULA',
    columns: opcoes.columns ?? sugeridas,
  });
  expect(r.statusCode, r.body).toBe(status);
  return status === 200 ? LoteImportacaoSchema.parse(r.json()) : null;
}

/** Envia e gera a prévia com o mapeamento sugerido. */
async function importar(s: SessaoTeste, tipo: 'PRODUTOS' | 'DEVOLUCOES', nome: string, conteudo: Buffer, opcoes: OpcoesMapa = {}): Promise<LoteImportacao> {
  const envio = await enviar(s, tipo, nome, conteudo);
  if (!envio.batch) throw new Error('Lote não criado.');
  const lote = await mapear(s, envio.batch, envio, opcoes);
  if (!lote) throw new Error('Prévia não gerada.');
  return lote;
}

function confirmar(s: SessaoTeste, lote: Pick<LoteImportacao, 'id' | 'previewVersion'>, chaveIdem: string = chave()) {
  return mutar(app, s, 'POST', `${API}/importacoes/${lote.id}/confirmar`, { previewVersion: lote.previewVersion, reviewed: true }, chaveIdem);
}

async function confirmado(s: SessaoTeste, lote: LoteImportacao) {
  const r = await confirmar(s, lote);
  expect(r.statusCode, r.body).toBe(200);
  return ResultadoConfirmacaoSchema.parse(r.json());
}

async function lote(id: string, s: SessaoTeste = sSup) {
  const r = await como(app, s, { method: 'GET', url: `${API}/importacoes/${id}` });
  expect(r.statusCode, r.body).toBe(200);
  return LoteImportacaoSchema.parse(r.json());
}

async function linhas(id: string, classificacao?: ClassificacaoLinha) {
  const r = await como(app, sSup, { method: 'GET', url: `${API}/importacoes/${id}/linhas?tamanho=200${classificacao ? `&classificacao=${classificacao}` : ''}` });
  expect(r.statusCode, r.body).toBe(200);
  return PaginaLinhasSchema.parse(r.json());
}

const resumoLinhas = async (id: string) => (await linhas(id)).items.map((l) => [l.row, l.classification, l.reasons.map((m) => m.code).join(',')]);

/** Estado físico do escopo: saldo, segmentos, eventos, conferências, ocupação, liberação. */
async function estadoFisico(): Promise<string> {
  const [contagens] = await db.$queryRaw<Record<string, bigint>[]>`
    SELECT (SELECT count(*) FROM saldo_estoque) AS saldos, (SELECT coalesce(sum(quantidade), 0)::text FROM saldo_estoque) AS soma,
           (SELECT count(*) FROM segmento_estoque) AS segmentos, (SELECT count(*) FROM evento_estoque) AS eventos,
           (SELECT count(*) FROM linha_evento_estoque) AS linhas_evento, (SELECT count(*) FROM evento_localizacao) AS localizacoes,
           (SELECT count(*) FROM sessao_conferencia) AS sessoes, (SELECT count(*) FROM observacao_conferencia) AS observacoes,
           (SELECT count(*) FROM item_declarado) AS declarados, (SELECT count(*) FROM palete) AS paletes`;
  const paletes = await db.palete.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, posicaoId: true, estadoConferencia: true, estadoLiberacao: true, estadoFluxo: true, versao: true, versaoSaldo: true },
  });
  return JSON.stringify({ contagens, paletes }, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

async function produtosPadrao(): Promise<void> {
  const l = await importar(
    sSup,
    'PRODUTOS',
    'produtos.csv',
    csv([
      CAB_PRODUTOS,
      ['000123', 'Xampu teste', 'UN', '0200000123001', 'UN', '1'],
      ['000123', 'Xampu teste', 'UN', '10200000123008', 'CX', '12'],
      ['000123', 'Xampu teste', 'UN', '20200000123005', 'PCT', null],
      ['MODELO-KG', 'Pó a granel', 'KG', null, null, null],
    ]),
  );
  expect(l.counters).toMatchObject({ total: 4, validNew: 4, invalid: 0, conflicting: 0 });
  await confirmado(sSup, l);
}

// ---------- Cenários ----------

describe('Cadastro de produtos (T15)', () => {
  it('CSV preserva zeros de SKU e código de barras; repetir o SKU acrescenta códigos; nada de saldo', async () => {
    const antes = await estadoFisico();
    const l = await importar(
      sSup,
      'PRODUTOS',
      'produtos.csv',
      csv([
        CAB_PRODUTOS,
        ['000123', 'Xampu "suave"; 300 ml', 'UN', '0200000123001', 'UN', '1'],
        ['000123', 'Xampu "suave"; 300 ml', 'UN', '10200000123008', 'CX', '12'],
        ['007', 'Fórmula =1+1 na descrição', 'UN', null, null, null],
        ['FORM-1', '=HYPERLINK("http://exemplo.invalid")', 'UN', null, null, null],
      ]),
    );
    expect(l.counters).toMatchObject({ total: 4, validNew: 4, duplicate: 0, invalid: 0, conflicting: 0 });
    expect(l.canConfirm).toBe(true);
    const r = await confirmado(sSup, l);
    expect(r.alreadyConfirmed).toBe(false);
    expect(r.batch).toMatchObject({ state: 'CONFIRMADO', counters: { written: 4, ignored: 0 }, result: { productsCreated: 3, barcodesAdded: 2 } });
    const p = await db.produto.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_PRACA, sku: '000123' }, include: { codigosBarras: { orderBy: { codigo: 'asc' } } } });
    expect(p.descricao).toBe('Xampu "suave"; 300 ml');
    expect(p.codigosBarras.map((c) => [c.codigo, c.embalagem, c.fatorConversao?.toFixed() ?? null])).toEqual([
      ['0200000123001', 'UN', '1'],
      ['10200000123008', 'CX', '12'],
    ]);
    expect(await db.produto.count({ where: { escopoId: ID_ESCOPO_PRACA, sku: { in: ['007', 'FORM-1'] } } })).toBe(2);
    // O texto original fica no banco (a proteção de fórmula é só nos downloads).
    expect((await db.produto.findFirstOrThrow({ where: { sku: 'FORM-1' } })).descricao).toBe('=HYPERLINK("http://exemplo.invalid")');
    expect(await estadoFisico()).toBe(antes);
    const auditoria = await db.eventoAuditoria.findMany({ where: { alvoId: l.id }, orderBy: { ocorridoEm: 'asc' }, select: { acao: true } });
    expect(auditoria.map((a) => a.acao)).toEqual(['IMPORTACAO_ENVIADA', 'IMPORTACAO_PREVIA_GERADA', 'IMPORTACAO_CONFIRMADA']);
  });

  it('XLSX do Excel: identificador gravado como número é sinalizado e bloqueia a confirmação', async () => {
    const l = await importar(sSup, 'PRODUTOS', 'produtos.xlsx', readFileSync(new URL('produtos.xlsx', FIXTURES)));
    expect(await resumoLinhas(l.id)).toEqual([
      [2, 'VALIDA_NOVA', ''],
      [3, 'VALIDA_NOVA', ''],
      [4, 'VALIDA_NOVA', ''],
      [5, 'INVALIDA', 'IDENTIFICADOR_NUMERICO'],
    ]);
    const invalida = (await linhas(l.id, 'INVALIDA')).items[0];
    expect(invalida?.read.sku).toBe('456');
    expect(invalida?.reasons[0]?.message).toMatch(/zeros à esquerda/i);
    expect(l.canConfirm).toBe(false);
    const r = await confirmar(sSup, l);
    expect(r.statusCode).toBe(409);
    expect(codigoErro(r)).toBe('IMPORTACAO_BLOQUEADA');
    expect(await db.produto.count({ where: { sku: '000123' } })).toBe(0);
  });

  it('produto existente com outra unidade/descrição é conflito; unidade canônica em uso não muda', async () => {
    await produtosPadrao();
    const l = await importar(sSup, 'PRODUTOS', 'conflito.csv', csv([CAB_PRODUTOS, ['000123', 'Xampu teste', 'CX', null, null, null], ['000123', 'Outro nome', 'UN', null, null, null]]));
    expect(await resumoLinhas(l.id)).toEqual([
      [2, 'CONFLITANTE', 'UNIDADE_CANONICA_DIFERENTE'],
      [3, 'CONFLITANTE', 'DESCRICAO_DIFERENTE'],
    ]);
    expect(codigoErro(await confirmar(sSup, l))).toBe('IMPORTACAO_BLOQUEADA');
    expect((await db.produto.findFirstOrThrow({ where: { sku: '000123' } })).unidadeCanonica).toBe('UN');
  });
});

describe('Documentos de devolução (T16)', () => {
  it('documento de 100 unidades cria só a declaração documental: saldo, ocupação, conferência e liberação não mudam', async () => {
    await produtosPadrao();
    const antes = await estadoFisico();
    const l = await importar(sSup, 'DEVOLUCOES', 'dev.csv', csv([CAB_DEVOLUCOES, ['DEV-T-0001', '1', '000123', '100', 'UN', '000045678', '0042', '15/09/2026'], ['DEV-T-0001', '2', '000123', '2', 'CX', '000045678', null, '15/09/2026']]));
    expect(l.counters).toMatchObject({ total: 2, validNew: 2 });
    const pendente = (await linhas(l.id)).items[1];
    expect(pendente?.values).toMatchObject({ quantity: '2', unit: 'CX', factor: '12', canonicalQuantity: '24', canonicalUnit: 'UN', lot: null });
    expect(pendente?.notices.map((a) => a.code)).toEqual(['LOTE_PENDENTE']);
    const r = await confirmado(sSup, l);
    expect(r.batch.result).toEqual({
      productsCreated: 0,
      barcodesAdded: 0,
      documentsCreated: 1,
      documentLinesCreated: 2,
      claimsCreated: 0,
      claimLinesCreated: 0,
      // Contadores do inventário e da seleção (complemento) ficam zerados nos documentos.
      inventoryId: null,
      inventoryLines: 0,
      inventoryLinesApplied: 0,
      inventoryLinesPending: 0,
      documentLinksCreated: 0,
      palletsCreated: 0,
      palletsLocated: 0,
      selectionId: null,
      selectionLines: 0,
      // Contadores da bipagem (palete de destino e notas) também zerados.
      documentLinksEnded: 0,
      palletId: null,
      documentsWritten: 0,
      contentsCreated: 0,
      countsRegistered: 0,
      documentsUnchanged: 0,
      recordsWithoutReads: 0,
      volumesRead: 0,
      palletCode: null,
      palletCreated: false,
      rowsRevalidated: 0,
    });
    expect(await estadoFisico()).toBe(antes);
    const gravadas = await db.linhaDocumentoDevolucao.findMany({ orderBy: { linhaArquivo: 'asc' } });
    expect(gravadas.map((g) => [g.referenciaLinha, g.sku, g.quantidadeDeclarada.toFixed(), g.unidadeDeclarada, g.fatorConversao.toFixed(), g.quantidadeCanonica.toFixed(), g.notaFiscal, g.lote])).toEqual([
      ['1', '000123', '100', 'UN', '1', '100', '000045678', '0042'],
      ['2', '000123', '2', 'CX', '12', '24', '000045678', null],
    ]);
    expect(gravadas[0]?.dataDocumento?.toISOString().slice(0, 10)).toBe('2026-09-15');
    // Produto com documento importado: unidade canônica não pode mais mudar.
    const produto = ProdutoSchema.parse((await como(app, sSup, { method: 'GET', url: `${API}/produtos?texto=000123` })).json<{ items: unknown[] }>().items[0]);
    expect(produto.inUse).toBe(true);
    const troca = await mutar(app, sSup, 'PUT', `${API}/produtos/${produto.id}`, { description: produto.description, canonicalUnit: 'KG', active: true, barcodes: [], expectedVersion: produto.version });
    expect(troca.statusCode).toBe(409);
    // Registros documentais não são alterados nem apagados.
    await expect(db.$executeRawUnsafe(`UPDATE linha_documento_devolucao SET quantidade_declarada = 1`)).rejects.toThrow(/HISTORICO_IMUTAVEL/);
    await expect(db.$executeRawUnsafe(`DELETE FROM documento_devolucao`)).rejects.toThrow(/HISTORICO_IMUTAVEL/);
  });

  it('erros específicos: SKU não cadastrado, unidade incompatível, fator desconhecido, chave incompleta', async () => {
    await produtosPadrao();
    const l = await importar(
      sSup,
      'DEVOLUCOES',
      'erros.csv',
      csv([
        CAB_DEVOLUCOES,
        ['DEV-E', '1', 'NAO-EXISTE', '1', 'UN', null, null, null],
        ['DEV-E', '2', '000123', '1', 'KG', null, null, null],
        ['DEV-E', '3', '000123', '1', 'PCT', null, null, null],
        [null, '4', '000123', '1', 'UN', null, null, null],
        ['DEV-E', null, '000123', '1', 'UN', null, null, null],
        ['DEV-E', '6', '000123', '1.234,5', 'UN', null, null, null],
        ['DEV-E', '7', '000123', '1', 'UN', null, null, '31/02/2026'],
        ['DEV-E', '8', '000123', '5', 'UN', null, null, null],
      ]),
    );
    expect(await resumoLinhas(l.id)).toEqual([
      [2, 'INVALIDA', 'SKU_NAO_CADASTRADO'],
      [3, 'INVALIDA', 'UNIDADE_INCOMPATIVEL'],
      [4, 'INVALIDA', 'FATOR_DESCONHECIDO'],
      [5, 'INVALIDA', 'CAMPO_OBRIGATORIO,CHAVE_INCOMPLETA'],
      [6, 'INVALIDA', 'CAMPO_OBRIGATORIO,CHAVE_INCOMPLETA'],
      [7, 'INVALIDA', 'QUANTIDADE_AMBIGUA'],
      [8, 'INVALIDA', 'DATA_INVALIDA'],
      [9, 'VALIDA_NOVA', ''],
    ]);
    expect(l).toMatchObject({ canConfirm: false, counters: { invalid: 7, validNew: 1 } });
    expect(codigoErro(await confirmar(sSup, l))).toBe('IMPORTACAO_BLOQUEADA');
    expect(await db.linhaDocumentoDevolucao.count()).toBe(0);
    // Relatório de erros: linhas inválidas com motivo e valores lidos; download auditado.
    const rel = await como(app, sSup, { method: 'GET', url: `${API}/importacoes/${l.id}/relatorio.csv` });
    expect(rel.statusCode).toBe(200);
    expect(rel.headers['content-type']).toMatch(/text\/csv/);
    expect(rel.body.charCodeAt(0)).toBe(0xfeff);
    expect(rel.body).toContain('"2";"Inválida";"SKU NAO-EXISTE não cadastrado');
    expect(rel.body).toContain('"1.234,5"');
    expect(rel.body).not.toContain('"9";"Válida');
  });

  it('XLSX com várias abas (Excel): escolha da aba, data, decimal, número no lugar de identificador, fórmula e casas a mais', async () => {
    await produtosPadrao();
    const conteudo = readFileSync(new URL('devolucoes-varias-abas.xlsx', FIXTURES));
    const envio = await enviar(sSup, 'DEVOLUCOES', 'devolucoes.xlsx', conteudo);
    expect(envio.structure?.sheets.map((s) => s.name)).toEqual(['Instruções', 'Devoluções', 'Resumo']);
    expect(envio.structure?.options.sheet).toBe('Instruções');
    const batch = envio.batch;
    if (!batch) throw new Error('lote');
    const estrutura = await como(app, sSup, { method: 'GET', url: `${API}/importacoes/${batch.id}/estrutura?sheet=${encodeURIComponent('Devoluções')}` });
    expect(estrutura.statusCode, estrutura.body).toBe(200);
    const est = estrutura.json<NonNullable<ResultadoEnvio['structure']>>();
    expect(est.sample[0]?.cells.map((c) => c.kind)).toEqual(['TEXTO', 'NUMERO', 'TEXTO', 'NUMERO', 'TEXTO', 'TEXTO', 'TEXTO', 'DATA']);
    expect(est.sample.find((s) => s.row === 6)?.cells[3]?.kind).toBe('FORMULA');
    expect(Object.values(est.suggestedColumns).every((c) => c !== null)).toBe(true);
    const l = await mapear(sSup, batch, null, { options: { sheet: 'Devoluções' }, columns: est.suggestedColumns });
    if (!l) throw new Error('prévia');
    expect(await resumoLinhas(l.id)).toEqual([
      [2, 'VALIDA_NOVA', ''],
      [3, 'VALIDA_NOVA', ''],
      [4, 'INVALIDA', 'IDENTIFICADOR_NUMERICO'],
      [5, 'INVALIDA', 'IDENTIFICADOR_NUMERICO'],
      [6, 'INVALIDA', 'FORMULA'],
      [7, 'INVALIDA', 'IDENTIFICADOR_NUMERICO'],
      [8, 'INVALIDA', 'CASAS_DECIMAIS'],
      [9, 'VALIDA_NOVA', ''],
    ]);
    const valores = (await linhas(l.id, 'VALIDA_NOVA')).items.map((i) => i.values);
    expect(valores[0]).toMatchObject({ returnReference: 'DEV-XL-0001', lineReference: '1', sku: '000123', quantity: '100', invoice: '000045678', lot: '0042', documentDate: '2026-09-15' });
    expect(valores[2]).toMatchObject({ sku: 'MODELO-KG', quantity: '1.5', unit: 'KG', canonicalQuantity: '1.5' });
  });

  it('CSV com vírgula como delimitador e ponto decimal escolhido; o separador errado é sinalizado', async () => {
    await produtosPadrao();
    const conteudo = Buffer.from('Referência da devolução,Linha,SKU,Quantidade,Unidade\r\n"DEV-V","1","MODELO-KG","1.5","KG"\r\n"DEV-V","2","MODELO-KG","2","KG"\r\n', 'utf8');
    const envio = await enviar(sSup, 'DEVOLUCOES', 'virgula.csv', conteudo);
    expect(envio.structure?.options.delimiter).toBe('VIRGULA');
    expect(envio.structure?.interpretation.join(' ')).toMatch(/vírgula \(,\) \(detectado/);
    const batch = envio.batch;
    if (!batch) throw new Error('lote');
    const v1 = await mapear(sSup, batch, envio, { decimal: 'VIRGULA' });
    if (!v1) throw new Error('prévia');
    expect(await resumoLinhas(v1.id)).toEqual([
      [2, 'INVALIDA', 'QUANTIDADE_AMBIGUA'],
      [3, 'VALIDA_NOVA', ''],
    ]);
    // Remapear (decimal com ponto) gera nova versão e invalida a anterior.
    const v2 = await mapear(sSup, v1, envio, { decimal: 'PONTO' });
    if (!v2) throw new Error('prévia 2');
    expect(v2.previewVersion).toBe(v1.previewVersion + 1);
    expect(v2.counters).toMatchObject({ validNew: 2, invalid: 0 });
    const antiga = await confirmar(sSup, v1);
    expect(antiga.statusCode).toBe(409);
    expect(codigoErro(antiga)).toBe('PREVIA_DESATUALIZADA');
    // Mapear com a versão antiga do lote também é recusado.
    expect(await mapear(sSup, v1, envio, { decimal: 'PONTO' }, 409)).toBeNull();
    const ok = await confirmado(sSup, v2);
    expect(ok.batch.counters.written).toBe(2);
  });
});

describe('Duplicidade e conflito (T14)', () => {
  const ARQUIVO = () => csv([CAB_DEVOLUCOES, ['DEV-D-1', '1', '000123', '100', 'UN', '000045678', null, null]]);

  it('mesmo arquivo de novo: resultado existente, sem nova importação; linha repetida no arquivo e em outro arquivo não duplicam', async () => {
    await produtosPadrao();
    const primeiro = await importar(sSup, 'DEVOLUCOES', 'a.csv', ARQUIVO());
    await confirmado(sSup, primeiro);
    const repetido = await enviar(sSup, 'DEVOLUCOES', 'copia-com-outro-nome.csv', ARQUIVO(), 200);
    expect(repetido.batch).toBeNull();
    expect(repetido.alreadyImported?.id).toBe(primeiro.id);
    // Outro arquivo: a mesma linha (001 = 1), uma repetida dentro dele e uma nova.
    const outro = await importar(
      sSup,
      'DEVOLUCOES',
      'b.csv',
      csv([CAB_DEVOLUCOES, ['DEV-D-1', '001', '000123', '100', 'UN', '000045678', null, null], ['DEV-D-1', '2', '000123', '3', 'UN', null, null, null], ['DEV-D-1', '2', '000123', '3', 'UN', null, null, null]]),
    );
    expect(await resumoLinhas(outro.id)).toEqual([
      [2, 'DUPLICADA', 'DUPLICADA_EXISTENTE'],
      [3, 'VALIDA_NOVA', ''],
      [4, 'DUPLICADA', 'DUPLICADA_NO_ARQUIVO'],
    ]);
    const r = await confirmado(sSup, outro);
    expect(r.batch.counters).toMatchObject({ written: 1, ignored: 2 });
    expect((await linhas(outro.id)).items.map((l) => l.result)).toEqual(['IGNORADA_DUPLICADA', 'GRAVADA', 'IGNORADA_DUPLICADA']);
    expect(await db.linhaDocumentoDevolucao.count()).toBe(2);
    expect(await db.documentoDevolucao.count()).toBe(1);
  });

  it('mesma chave com outro conteúdo é conflito, sem sobrescrever', async () => {
    await produtosPadrao();
    await confirmado(sSup, await importar(sSup, 'DEVOLUCOES', 'a.csv', ARQUIVO()));
    const l = await importar(sSup, 'DEVOLUCOES', 'c.csv', csv([CAB_DEVOLUCOES, ['DEV-D-1', '1', '000123', '90', 'UN', '000045678', 'L9', null]]));
    const [linha] = (await linhas(l.id)).items;
    expect(linha?.classification).toBe('CONFLITANTE');
    expect(linha?.reasons[0]?.message).toMatch(/quantidade 100 UN → 90 UN; lote pendente → L9/);
    expect(codigoErro(await confirmar(sSup, l))).toBe('IMPORTACAO_BLOQUEADA');
    expect((await db.linhaDocumentoDevolucao.findFirstOrThrow()).quantidadeDeclarada.toFixed()).toBe('100');
  });
});

describe('Concorrência e reenvio', () => {
  it('dois lotes diferentes com o mesmo registro confirmados ao mesmo tempo: um grava, o outro pede nova revisão', async () => {
    await produtosPadrao();
    const a = await importar(sSup, 'DEVOLUCOES', 'a.csv', csv([CAB_DEVOLUCOES, ['DEV-C', '1', '000123', '10', 'UN', null, null, null]]));
    const b = await importar(sSup2, 'DEVOLUCOES', 'b.csv', csv([CAB_DEVOLUCOES, ['DEV-C', '1', '000123', '10', 'UN', null, null, null], ['DEV-C', '2', '000123', '4', 'UN', null, null, null]]));
    const respostas = await Promise.all([confirmar(sSup, a), confirmar(sSup2, b)]);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const perdedor = respostas.find((r) => r.statusCode === 409);
    expect(perdedor && codigoErro(perdedor)).toBe('PREVIA_DESATUALIZADA');
    expect(await db.linhaDocumentoDevolucao.count({ where: { chaveLinha: '1' } })).toBe(1);
    // A prévia do lote que perdeu foi refeita: a linha 1 agora é duplicada.
    const idPerdedor = respostas[0].statusCode === 409 ? a.id : b.id;
    const atual = await lote(idPerdedor);
    expect(atual.state).toBe('PREVIA');
    expect(atual.counters.duplicate).toBe(1);
    const final = await confirmado(idPerdedor === a.id ? sSup : sSup2, atual);
    expect(final.batch.state).toBe('CONFIRMADO');
    expect(await db.linhaDocumentoDevolucao.count()).toBe(2);
  });

  it('o mesmo arquivo em dois lotes confirmados ao mesmo tempo é gravado uma vez', async () => {
    await produtosPadrao();
    const a = await importar(sSup, 'DEVOLUCOES', 'x.csv', ARQUIVO_MESMO());
    const envio = await enviar(sSup2, 'DEVOLUCOES', 'x-de-novo.csv', ARQUIVO_MESMO());
    expect(envio.openDuplicates).toEqual([a.id]);
    if (!envio.batch) throw new Error('lote');
    const b = await mapear(sSup2, envio.batch, envio);
    if (!b) throw new Error('prévia');
    const respostas = await Promise.all([confirmar(sSup, a), confirmar(sSup2, b)]);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const perdedor = respostas.find((r) => r.statusCode === 409);
    expect(perdedor && codigoErro(perdedor)).toBe('ARQUIVO_JA_IMPORTADO');
    expect(await db.linhaDocumentoDevolucao.count()).toBe(1);
    expect(await db.loteImportacao.count({ where: { situacao: 'CONFIRMADO', tipo: 'DEVOLUCOES' } })).toBe(1);
  });

  it('clique duplo (chaves diferentes) e reenvio com a mesma chave após resposta perdida devolvem o mesmo resultado', async () => {
    await produtosPadrao();
    const l = await importar(sSup, 'DEVOLUCOES', 'y.csv', ARQUIVO_MESMO());
    const [r1, r2] = await Promise.all([confirmar(sSup, l), confirmar(sSup, l)]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    const corpos = [r1, r2].map((r) => ResultadoConfirmacaoSchema.parse(r.json()));
    expect(corpos.map((c) => c.alreadyConfirmed).sort()).toEqual([false, true]);
    expect(await db.linhaDocumentoDevolucao.count()).toBe(1);
    // Resposta perdida: o mesmo pedido com a mesma chave devolve o resultado guardado.
    const m = await importar(sSup, 'DEVOLUCOES', 'z.csv', csv([CAB_DEVOLUCOES, ['DEV-R', '1', '000123', '7', 'UN', null, null, null]]));
    const k = chave();
    const primeiro = await confirmar(sSup, m, k);
    const reenvio = await confirmar(sSup, m, k);
    expect(reenvio.statusCode).toBe(200);
    expect(reenvio.headers['idempotency-replayed']).toBe('true');
    expect(reenvio.json()).toEqual(primeiro.json());
    expect(await db.linhaDocumentoDevolucao.count({ where: { documento: { referencia: 'DEV-R' } } })).toBe(1);
  });

  function ARQUIVO_MESMO() {
    return csv([CAB_DEVOLUCOES, ['DEV-M', '1', '000123', '1', 'UN', null, null, null]]);
  }
});

describe('Falha durante a gravação', () => {
  it('reverte tudo, sem sucesso falso; o histórico registra a falha; a nova tentativa grava uma vez', async () => {
    await produtosPadrao();
    const l = await importar(sSup, 'DEVOLUCOES', 'falha.csv', csv([CAB_DEVOLUCOES, ['DEV-F', '1', '000123', '5', 'UN', null, null, null], ['DEV-F', '2', '000123', '6', 'UN', null, null, null]]));
    await db.$executeRawUnsafe(`CREATE FUNCTION falha_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.chave_linha = '2' THEN RAISE EXCEPTION 'falha simulada na gravação'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER falha_teste BEFORE INSERT ON linha_documento_devolucao FOR EACH ROW EXECUTE FUNCTION falha_teste()`);
    const k = chave();
    try {
      const r = await confirmar(sSup, l, k);
      expect(r.statusCode).toBe(500);
      expect(codigoErro(r)).toBe('ERRO_INTERNO');
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER falha_teste ON linha_documento_devolucao');
      await db.$executeRawUnsafe('DROP FUNCTION falha_teste()');
    }
    expect(await db.documentoDevolucao.count()).toBe(0);
    expect(await db.linhaDocumentoDevolucao.count()).toBe(0);
    const depois = await lote(l.id);
    expect(depois.state).toBe('PREVIA');
    expect(depois.counters.written).toBe(0);
    expect(depois.lastFailure?.message).toMatch(/falhou e foi desfeita: nada deste lote foi importado/);
    expect(await db.eventoAuditoria.count({ where: { alvoId: l.id, acao: 'IMPORTACAO_FALHOU' } })).toBe(1);
    expect(await db.registroIdempotencia.count({ where: { chave: k } })).toBe(0);
    const nova = await confirmar(sSup, l, k);
    expect(nova.statusCode, nova.body).toBe(200);
    const final = ResultadoConfirmacaoSchema.parse(nova.json()).batch;
    expect(final).toMatchObject({ state: 'CONFIRMADO', lastFailure: null, counters: { written: 2 } });
    expect(await db.linhaDocumentoDevolucao.count()).toBe(2);
  });
});

describe('Limites, formatos e modelos', () => {
  it('arquivo incompatível, acima do tamanho ou com linhas demais é recusado antes de criar lote', async () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(200)]);
    const r1 = await enviarArquivo(app, sSup, 'PRODUTOS', 'antigo.xls', ole);
    expect(r1.statusCode).toBe(400);
    expect(codigoErro(r1)).toBe('ARQUIVO_INVALIDO');
    const pequeno = await appDeTeste(db, { limitesImportacao: { maxBytes: 1_024, maxRows: 3 } });
    const s = await entrar(pequeno, { login: 'supervisor', senha: (await criarSenhaNova('supervisor')).senha });
    const grande = await enviarArquivo(pequeno, s, 'PRODUTOS', 'grande.csv', Buffer.alloc(2_048, 0x41));
    expect(grande.statusCode).toBe(413);
    expect(codigoErro(grande)).toBe('ARQUIVO_INVALIDO');
    const linhasDemais = await enviarArquivo(pequeno, s, 'PRODUTOS', 'linhas.csv', csv([CAB_PRODUTOS, ['1', 'aa', 'UN', null, null, null], ['2', 'bb', 'UN', null, null, null], ['3', 'cc', 'UN', null, null, null], ['4', 'dd', 'UN', null, null, null]]));
    expect(linhasDemais.statusCode).toBe(400);
    expect(linhasDemais.json<{ error: { message: string } }>().error.message).toMatch(/limite é 3/);
    await pequeno.close();
    expect(await db.loteImportacao.count()).toBe(0);
  });

  it('modelos XLSX e CSV baixados pela API são importados pelo próprio fluxo', async () => {
    for (const [arquivo, tipo] of [
      ['produtos.xlsx', 'PRODUTOS'],
      ['devolucoes.csv', 'DEVOLUCOES'],
    ] as const) {
      const r = await como(app, sSup, { method: 'GET', url: `${API}/importacoes/modelos/${arquivo}` });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-disposition']).toContain(`modelo-${arquivo}`);
      const l = await importar(sSup, tipo, arquivo, r.rawPayload);
      expect(l.counters.invalid + l.counters.conflicting, JSON.stringify(await resumoLinhas(l.id))).toBe(0);
      await confirmado(sSup, l);
    }
    expect(await db.produto.count({ where: { sku: { in: ['000123', '000456', 'MODELO-789', 'MODELO-KG'] } } })).toBe(4);
    expect(await db.linhaDocumentoDevolucao.count()).toBe(5);
    const fatorPendente = await db.codigoBarras.findFirstOrThrow({ where: { codigo: '10200000456002' } });
    expect(fatorPendente.fatorConversao).toBeNull();
  });

  it('descartar encerra o lote sem gravar; lote descartado não confirma', async () => {
    const l = await importar(sSup, 'PRODUTOS', 'p.csv', csv([CAB_PRODUTOS, ['D-1', 'Descartável', 'UN', null, null, null]]));
    const r = await mutar(app, sSup, 'POST', `${API}/importacoes/${l.id}/descartar`, { expectedVersion: l.version });
    expect(r.statusCode, r.body).toBe(200);
    expect(LoteImportacaoSchema.parse(r.json()).state).toBe('DESCARTADO');
    expect((await confirmar(sSup, l)).statusCode).toBe(409);
    expect(await db.produto.count({ where: { sku: 'D-1' } })).toBe(0);
  });
});

describe('Permissões e escopo', () => {
  it('operador e consulta não importam; outro escopo não enxerga o lote; histórico e relatório exigem permissão', async () => {
    const l = await importar(sSup, 'PRODUTOS', 'p.csv', csv([CAB_PRODUTOS, ['P-1', 'Produto', 'UN', null, null, null]]));
    for (const s of [sOp, sCons]) {
      expect((await enviarArquivo(app, s, 'PRODUTOS', 'p.csv', csv([CAB_PRODUTOS]))).statusCode).toBe(403);
      expect((await confirmar(s, l)).statusCode).toBe(403);
      expect((await mutar(app, s, 'PUT', `${API}/importacoes/${l.id}/mapeamento`, {})).statusCode).toBe(403);
      expect((await mutar(app, s, 'POST', `${API}/importacoes/${l.id}/descartar`, { expectedVersion: l.version })).statusCode).toBe(403);
      for (const url of [`${API}/importacoes/${l.id}`, `${API}/importacoes/${l.id}/linhas`, `${API}/importacoes/${l.id}/relatorio.csv`, `${API}/importacoes/modelos/produtos.csv`]) {
        expect((await como(app, s, { method: 'GET', url })).statusCode, url).toBe(403);
      }
    }
    // Consulta não vê o histórico; o operador consulta só os lotes da seleção do cliente (selecao.consultar): o de produtos não aparece.
    expect((await como(app, sCons, { method: 'GET', url: `${API}/importacoes` })).statusCode).toBe(403);
    const historicoOp = PaginaLotesSchema.parse((await como(app, sOp, { method: 'GET', url: `${API}/importacoes` })).json());
    expect(historicoOp.total).toBe(0);
    expect((await como(app, sOp, { method: 'GET', url: `${API}/importacoes?tipo=PRODUTOS` })).statusCode).toBe(403);
    for (const url of [`${API}/importacoes/${l.id}`, `${API}/importacoes/${l.id}/linhas`, `${API}/importacoes/${l.id}/relatorio.csv`, `${API}/importacoes/${l.id}/estrutura`]) {
      expect((await como(app, sNav, { method: 'GET', url })).statusCode, url).toBe(404);
    }
    expect((await confirmar(sNav, l)).statusCode).toBe(404);
    const historicoNav = PaginaLotesSchema.parse((await como(app, sNav, { method: 'GET', url: `${API}/importacoes` })).json());
    expect(historicoNav.total).toBe(0);
    const semSessao = await app.inject({ method: 'POST', url: `${API}/importacoes?tipo=PRODUTOS`, payload: Buffer.from('a'), headers: { 'content-type': 'application/octet-stream' } });
    expect(semSessao.statusCode).toBe(401);
    const semCsrf = await como(app, sSup, { method: 'POST', url: `${API}/importacoes?tipo=PRODUTOS`, payload: Buffer.from('a;b'), headers: { 'content-type': 'application/octet-stream', 'idempotency-key': chave() }, semCsrf: true });
    expect(semCsrf.statusCode).toBe(403);
    expect(await db.produto.count({ where: { sku: 'P-1' } })).toBe(0);
    const historico = PaginaLotesSchema.parse((await como(app, sSup, { method: 'GET', url: `${API}/importacoes` })).json());
    expect(historico.items.map((i) => [i.id, i.state])).toEqual([[l.id, 'PREVIA']]);
  });
});

/** Nova senha para entrar em outra instância da API com o mesmo usuário. */
async function criarSenhaNova(login: string) {
  const { gerarHashSenha } = await import('../../src/modules/acesso/senhas.js');
  const senha = `senha-teste-${login}-0123456789`;
  await db.usuario.update({ where: { login }, data: { senhaHash: await gerarHashSenha(senha) } });
  return { senha };
}
