import {
  ConciliacaoSchema,
  DocumentosPaleteSchema,
  InventarioResumoSchema,
  LoteImportacaoSchema,
  PaginaLinhasInventarioSchema,
  PaginaLinhasSchema,
  PropostaJanelaSchema,
  ResultadoConfirmacaoSchema,
  ResultadoEnvioSchema,
  ResultadoPropostaSchema,
  RespostaBuscaSchema,
  SelecaoDetalheSchema,
  type Conciliacao,
  type LoteImportacao,
  type ResultadoConciliacao,
  type ResultadoEnvio,
} from '@praca-reversa/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { bancoDeTeste, chave, codigoErro, como, enviarArquivo, idPosicao, mutar, ID_ESCOPO_PRACA, type SessaoTeste } from './apoio.js';
import { API, criarProduto, montarAmbiente, palete, reconciliar, segmentoDe, type Ambiente } from './claims-apoio.js';
import { janelaConfirmada, liberarMaterial, pecas } from './janelas-apoio.js';
import { CABECALHO_INVENTARIO, VERDE, csvTeste, xlsxTeste, type CelulaTeste } from './planilhas.js';

/**
 * Complemento "seleção do cliente" contra PostgreSQL real: inventário
 * conferido (vínculos NF × palete × endereço, sem saldo validado), seleção do
 * cliente (lista e marcação), conciliação por situação, proposta e reserva
 * pela etapa 08, versão substitutiva e permissões. Dados fictícios.
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

const VALIDADA = { valor: 'VALIDADA', cor: VERDE } as const;

/** Inventário fictício no formato do modelo operacional (linha 1 = título; 2 = cabeçalho). */
function linhasInventario(): CelulaTeste[][] {
  return [
    [12345678, 'NFD', 5550001, 3, 'Remetente fictício A', 'Outubro', 2, '15 - A101', 9101, VALIDADA, '01\\02', 'CNPJ'], // 3: cria 9101 em F08-P01
    [12345679, 'NFD', 5550002, 2, 'Remetente fictício B', 'Outubro', 2, '15- A101', 9101, 'VALIDAR', null, 'PF'], // 4: 2ª NF no mesmo palete
    [12345678, 'NFD', 5550001, 1, 'Remetente fictício A', 'Outubro', 2, '15 - A103', 9102, VALIDADA, '02\\02', 'CNPJ'], // 5: mesma NF em outro palete
    [12345678, 'NFD', 5550001, 3, 'Remetente fictício A', 'Outubro', 2, '15 - A101', 9101, VALIDADA, '01\\02', 'CNPJ'], // 6: repetida
    [12345680, 'MI', 5550001, 4, 'Remetente fictício C', null, null, '13 - A120', 9103, VALIDADA, null, 'CNPJ'], // 7: mesmo número, outro tipo; sem posição
    [12345681, 'NFD', 5550009, 5, null, null, null, { valor: '15 - A105', cor: VERDE }, 9104, null, null, 'CNPJ'], // 8: endereço livre
    [12345682, 'NFD', 5550003, 1, null, null, null, '15 - A107', 'GR - 12', VALIDADA, null, 'CNPJ'], // 9: N° Pallet inválido
    [12345683, 'NFD', 5550005, 2, null, null, null, '15 - A109', 9105, VALIDADA, null, 'CNPJ'], // 10: 9105 em dois endereços
    [12345684, 'NFD', 5550006, 2, null, null, null, '15 - A111', 9105, VALIDADA, null, 'CNPJ'], // 11
    [12345685, 'NFD', 5550010, 6, null, null, null, '11 - A1', 'PAL-DEMO-001', VALIDADA, null, 'CNPJ'], // 12: palete existente, mesma posição
    [12345686, 'NFD', 5550011, 6, null, null, null, '11 - A5', 'PAL-DEMO-002', VALIDADA, null, 'CNPJ'], // 13: registro atual diverge
    [12345687, 'NFD', 5550012, { valor: 4, formula: 'SUM(1,3)' }, null, null, null, '15 - A113', 9106, VALIDADA, null, 'CNPJ'], // 14: fórmula em VOLUMES
    [12345688, 'NFD', 5550013, 0, null, null, null, '15 - A115', 9107, VALIDADA, null, 'CNPJ'], // 15: zero é valor
    ['*', null, 'A', null, null, null, null, 'A120', 9108, null, null, null], // 16: endereço sem fileira
    [12345690, 'NFD', Number('12345678901234567'), 1, null, null, null, '15 - A117', 9109, VALIDADA, null, 'CNPJ'], // 17: número truncado pelo Excel
  ];
}

function planilhaInventario(linhas = linhasInventario(), formatadasAte = 20_000): Buffer {
  return xlsxTeste([
    { nome: "Inventario ficticio - 28-09", titulo: 'Inventário fictício', cabecalho: CABECALHO_INVENTARIO, linhas, formatadasAte },
    { nome: 'DADOS DO PISO', cabecalho: ['Total'], linhas: [[{ valor: 15, formula: 'COUNTA(Inv!A3:A100)' }]] },
    { nome: 'Oculta PF', oculta: true, cabecalho: CABECALHO_INVENTARIO, linhas: [[1, 'NFD', 1, 1, 'X', null, null, '15 - A101', 1, null, null, 'PF']] },
  ]);
}

const PARAMETROS_INVENTARIO = {
  description: 'Inventário fictício definitivo',
  definitive: true,
  countReference: 'CONF-FICT-001',
  countDate: '2026-09-28',
  countSource: 'Conferência fictícia da operação',
  palletNumberMeaning: 'IDENTIFICADOR_PALETE',
  freeAddressFontColors: [VERDE],
  documentTypes: [{ code: 'NFD', meaning: 'NF de devolução (definição fictícia)', originType: 'NOTA_FISCAL' }],
};

async function enviar(s: SessaoTeste, tipo: 'INVENTARIO' | 'SELECAO_CLIENTE', nome: string, conteudo: Buffer, status = 201): Promise<ResultadoEnvio> {
  const r = await enviarArquivo(a.app, s, tipo, nome, conteudo);
  expect(r.statusCode, r.body).toBe(status);
  return ResultadoEnvioSchema.parse(r.json());
}

/** Colunas sugeridas lendo o cabeçalho na linha informada. */
async function sugeridas(loteId: string, headerRow: number): Promise<Record<string, number | null>> {
  const r = await como(a.app, a.sup, { method: 'GET', url: `${API}/importacoes/${loteId}/estrutura?headerRow=${String(headerRow)}` });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ suggestedColumns: Record<string, number | null> }>().suggestedColumns;
}

async function mapear(lote: LoteImportacao, envio: ResultadoEnvio | null, parametros: Record<string, unknown>, extra: { headerRow?: number; columns?: Record<string, number | null> } = {}, status = 200) {
  const headerRow = extra.headerRow ?? 1;
  const colunas = extra.columns ?? (headerRow !== 1 ? await sugeridas(lote.id, headerRow) : (envio?.structure?.suggestedColumns ?? lote.columns ?? {}));
  const r = await mutar(a.app, a.sup, 'PUT', `${API}/importacoes/${lote.id}/mapeamento`, {
    expectedVersion: lote.version,
    options: { sheet: null, headerRow, encoding: null, delimiter: null },
    decimalSeparator: 'VIRGULA',
    columns: colunas,
    parameters: parametros,
  });
  expect(r.statusCode, r.body).toBe(status);
  return status === 200 ? LoteImportacaoSchema.parse(r.json()) : r;
}

async function linhasLote(id: string) {
  const r = await como(a.app, a.sup, { method: 'GET', url: `${API}/importacoes/${id}/linhas?tamanho=200` });
  expect(r.statusCode, r.body).toBe(200);
  return PaginaLinhasSchema.parse(r.json()).items;
}

async function confirmarLote(lote: Pick<LoteImportacao, 'id' | 'previewVersion'>, corpo: Record<string, unknown> = {}, status = 200, chaveIdem = chave()) {
  const r = await mutar(a.app, a.sup, 'POST', `${API}/importacoes/${lote.id}/confirmar`, { previewVersion: lote.previewVersion, reviewed: true, ...corpo }, chaveIdem);
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

/** Importa e confirma o inventário fictício; devolve o lote confirmado e o ID do inventário. */
async function inventarioImportado() {
  const envio = await enviar(a.sup, 'INVENTARIO', 'inventario-ficticio.xlsx', planilhaInventario());
  const lote = (await mapear(envio.batch as LoteImportacao, envio, PARAMETROS_INVENTARIO, { headerRow: 2 })) as LoteImportacao;
  const aplicaveis = (await linhasLote(lote.id)).filter((l) => l.classification === 'VALIDA_NOVA' && l.action !== 'REFERENCIA_HISTORICA').length;
  const r = await confirmarLote(lote, { expectedApplicable: aplicaveis });
  const resultado = ResultadoConfirmacaoSchema.parse(r.json());
  const inventarioId = resultado.batch.result?.inventoryId;
  if (!inventarioId) throw new Error('Inventário não registrado.');
  return { lote: resultado.batch, inventarioId };
}

async function paletePorCodigo(codigo: string) {
  return db.palete.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_PRACA, codigo }, include: { posicao: { select: { codigo: true } } } });
}

async function estadoSaldo(): Promise<string> {
  const [c] = await db.$queryRaw<{ saldos: bigint; soma: string; segmentos: bigint; reservas: bigint; liberado: string }[]>`
    SELECT (SELECT count(*) FROM saldo_estoque) AS saldos, (SELECT coalesce(sum(quantidade), 0)::text FROM saldo_estoque) AS soma,
           (SELECT count(*) FROM segmento_estoque) AS segmentos, (SELECT count(*) FROM reserva_janela) AS reservas,
           (SELECT coalesce(sum(quantidade_liberada), 0)::text FROM saldo_estoque) AS liberado`;
  return JSON.stringify(c, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

// ---------- Inventário conferido ----------

describe('Inventário conferido (itens 4, 15–19)', () => {
  it('lê só a aba de dados, sem linhas só formatadas; sugere RUA/N° Pallet e mostra a fonte verde; aba de resumo e oculta não entram', async () => {
    const envio = await enviar(a.sup, 'INVENTARIO', 'inventario-ficticio.xlsx', planilhaInventario());
    const estrutura = envio.structure;
    expect(estrutura?.sheets.map((s) => [s.name, s.hidden])).toEqual([
      ['Inventario ficticio - 28-09', false],
      ['DADOS DO PISO', false],
      ['Oculta PF', true],
    ]);
    // Cabeçalho na linha 2: a prévia relê com headerRow 2.
    const r = await como(a.app, a.sup, { method: 'GET', url: `${API}/importacoes/${envio.batch?.id ?? ''}/estrutura?headerRow=2` });
    expect(r.statusCode, r.body).toBe(200);
    const comCabecalho = r.json<NonNullable<ResultadoEnvio['structure']>>();
    expect(comCabecalho.dataRows).toBe(15);
    expect(comCabecalho.headers.map((h) => h.text)).toEqual([...CABECALHO_INVENTARIO]);
    const sugestao = comCabecalho.suggestedColumns;
    expect([sugestao.address, sugestao.palletNumber, sugestao.documentNumber, sugestao.documentType, sugestao.volumes]).toEqual([7, 8, 2, 1, 3]);
    const cores = new Map(comCabecalho.fontColors.map((c) => [c.index, c.colors]));
    expect(cores.get(7)?.find((c) => c.color === VERDE)?.cells).toBe(1);
    expect(cores.get(9)?.find((c) => c.color === VERDE)?.cells).toBeGreaterThan(5);
  });

  it('prévia: ações por linha, endereço livre, identidade, parcelas e conflitos; confirmação exige o significado do N° Pallet', async () => {
    const envio = await enviar(a.sup, 'INVENTARIO', 'inventario-ficticio.xlsx', planilhaInventario());
    const semSignificado = (await mapear(envio.batch as LoteImportacao, envio, { ...PARAMETROS_INVENTARIO, palletNumberMeaning: null }, { headerRow: 2 })) as LoteImportacao;
    expect(semSignificado.canConfirm).toBe(false);
    expect(semSignificado.blockReason).toMatch(/N° Pallet/);
    const lote = (await mapear(semSignificado, null, PARAMETROS_INVENTARIO, { headerRow: 2, columns: semSignificado.columns ?? {} })) as LoteImportacao;
    expect(lote.canConfirm).toBe(true);
    const linhas = await linhasLote(lote.id);
    const acao = new Map(linhas.map((l) => [l.row, l.action]));
    expect(Object.fromEntries([...acao.entries()])).toEqual({
      3: 'CRIAR_CADASTRO',
      4: 'VINCULAR',
      5: 'CRIAR_CADASTRO',
      6: 'DUPLICADA_ARQUIVO',
      7: 'CRIAR_CADASTRO',
      8: 'REFERENCIA_HISTORICA',
      9: 'REQUER_RESOLUCAO',
      10: 'REQUER_RESOLUCAO',
      11: 'REQUER_RESOLUCAO',
      12: 'VINCULAR',
      13: 'VINCULAR',
      14: 'CRIAR_CADASTRO',
      15: 'CRIAR_CADASTRO',
      16: 'CRIAR_CADASTRO',
      17: 'REQUER_RESOLUCAO',
    });
    const linha = (n: number) => linhas.find((l) => l.row === n);
    const codigos = (n: number) => [...(linha(n)?.reasons ?? []), ...(linha(n)?.notices ?? [])].map((m) => m.code);
    expect(linha(3)?.values).toMatchObject({ position: 'F08-P01', positionState: 'confirmada', locate: 'F08-P01', volumesUnit: 'VOLUMES', palletFull: '01\\02' });
    expect(codigos(3)).toContain('IDENTIFICADOR_NUMERICO');
    expect(codigos(4)).toContain('ENDERECO_NORMALIZADO');
    expect(linha(7)?.values.positionState).toBe('pendente');
    expect(codigos(7)).toContain('POSICAO_VISUAL_PENDENTE');
    expect(codigos(8)).toContain('ENDERECO_LIVRE');
    expect(codigos(9)).toContain('PALETE_CODIGO_INVALIDO');
    expect(codigos(10)).toContain('PALETE_EM_DOIS_ENDERECOS');
    expect(codigos(13)).toContain('ENDERECO_DIVERGENTE');
    expect(codigos(14)).toContain('VOLUMES_FORMULA');
    expect(linha(14)?.values.volumes).toBeNull();
    expect(linha(15)?.values.volumes).toBe('0');
    expect(codigos(16)).toContain('ENDERECO_SEM_FILEIRA');
    expect(codigos(17)).toContain('IDENTIFICADOR_TRUNCADO');
    expect(lote.counters).toMatchObject({ total: 15, validNew: 10, duplicate: 1, conflicting: 3, invalid: 1 });
    // Conjunto aplicável (vincular, criar cadastro, atualizar): a referência histórica fica de fora.
    const aplicaveis = await como(a.app, a.sup, { method: 'GET', url: `${API}/importacoes/${lote.id}/linhas?aplicaveis=true&tamanho=200` });
    expect(PaginaLinhasSchema.parse(aplicaveis.json()).items.map((l) => l.row)).toEqual([3, 4, 5, 7, 12, 13, 14, 15, 16]);
    expect(lote.previewSummary.join(' ')).toMatch(/Tipos documentais sem definição operacional .*: MI \(1\)/);
  });

  it('confirmação aplica só o conjunto revisado: paletes propostos, localização pela tabela confirmada, vínculos por linha, sem saldo validado', async () => {
    const antes = await estadoSaldo();
    const demo002 = await paletePorCodigo('PAL-DEMO-002');
    const { lote, inventarioId } = await inventarioImportado();
    expect(lote.state).toBe('CONFIRMADO');
    expect(lote.result).toMatchObject({ inventoryLines: 15, inventoryLinesApplied: 9, palletsCreated: 6, palletsLocated: 4, documentLinksCreated: 9 });
    // Saldo validado, segmentos, liberação e reservas não mudam.
    expect(await estadoSaldo()).toBe(antes);
    const p9101 = await paletePorCodigo('9101');
    expect([p9101.posicao?.codigo, p9101.estadoConferencia, p9101.origemCodigo]).toEqual(['F08-P01', 'NAO_CONFERIDO', 'EXISTENTE']);
    expect((await paletePorCodigo('9102')).posicao?.codigo).toBe('F08-P02');
    expect((await paletePorCodigo('9103')).posicaoId).toBeNull();
    expect((await paletePorCodigo('9108')).posicaoId).toBeNull();
    expect(await db.palete.count({ where: { codigo: { in: ['9104', '9105', '9109', 'GR - 12'] } } })).toBe(0);
    // Registro atual prevalece (endereço informado ≠ atual).
    const demo002Depois = await paletePorCodigo('PAL-DEMO-002');
    expect([demo002Depois.posicaoId, demo002Depois.versao]).toEqual([demo002.posicaoId, demo002.versao]);
    // NF distribuída em dois paletes; duas NFs no mesmo palete; volumes por linha (sem soma).
    const nf = await db.vinculoDocumentoPalete.findMany({ where: { chaveDocumento: 'NFD|5550001', situacao: 'ATIVO' }, include: { palete: { select: { codigo: true } } } });
    expect(nf.map((v) => [v.palete.codigo, v.volumes?.toFixed(0)]).sort()).toEqual([
      ['9101', '3'],
      ['9102', '1'],
    ]);
    const docs = DocumentosPaleteSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/paletes/${p9101.id}/documentos` })).json());
    expect(docs.items.map((d) => d.documentKey).sort()).toEqual(['NFD|5550001', 'NFD|5550002']);
    expect(docs.items.every((d) => d.volumesUnit === 'VOLUMES' && d.source.countReference === 'CONF-FICT-001' && d.informedAddress === '15 - A101')).toBe(true);
    // MI 5550001 é outro documento (mesmo número, outro contexto).
    expect(await db.vinculoDocumentoPalete.count({ where: { chaveDocumento: 'MI|5550001' } })).toBe(1);
    // Busca por NF revela todas as alocações conhecidas (base própria, sem quantidade de produto nem soma no resumo).
    const busca = RespostaBuscaSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/busca?texto=5550001&campo=NF` })).json());
    const vinculos = busca.items.filter((i) => i.base === 'INVENTARIO');
    expect(vinculos.map((i) => [i.pallet?.code, i.documentLink?.documentType, i.documentLink?.volumes, i.pallet?.positionCode ?? null]).sort()).toEqual([
      ['9101', 'NFD', '3', 'F08-P01'],
      ['9102', 'NFD', '1', 'F08-P02'],
      ['9103', 'MI', '4', null],
    ]);
    expect(vinculos.every((i) => i.quantity === null && i.match === 'NF' && i.documentLink?.volumesUnit === 'VOLUMES' && i.documentLink.inventoryId === inventarioId)).toBe(true);
    expect(vinculos.find((i) => i.pallet?.code === '9101')?.documentLink?.informedAddress).toBe('15 - A101');
    expect(busca.summary.some((g) => (g.base as string) === 'INVENTARIO')).toBe(false);
    expect(new Set(busca.palletIds)).toEqual(new Set(vinculos.map((i) => i.pallet?.id)));
    // Filtro de palete continua valendo; condição (sem sentido para o vínculo) o exclui.
    const semPosicao = RespostaBuscaSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/busca?texto=5550001&campo=NF&localizacao=PENDENTE` })).json());
    expect(semPosicao.items.filter((i) => i.base === 'INVENTARIO').map((i) => i.pallet?.code)).toEqual(['9103']);
    const comCondicao = RespostaBuscaSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/busca?texto=5550001&campo=NF&condicao=SAUDAVEL` })).json());
    expect(comCondicao.items.some((i) => i.base === 'INVENTARIO')).toBe(false);
    // Fotografia: todas as linhas, aplicadas ou não, com o endereço informado.
    const inv = InventarioResumoSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/inventarios/${inventarioId}` })).json());
    expect(inv.totals).toEqual({ lines: 15, applied: 9, pending: 4, historical: 1 });
    expect(inv.countDate).toBe('2026-09-28');
    expect(inv.externalCount.state).toBe('NAO_REGISTRADA');
    const historicas = PaginaLinhasInventarioSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/inventarios/${inventarioId}/linhas?situacao=HISTORICAS` })).json());
    expect(historicas.items.map((l) => [l.row, l.freeAddress, l.applied, l.address])).toEqual([[8, true, false, '15 - A105']]);
  });

  it('reenvio do mesmo arquivo devolve o resultado existente; arquivo novo com as mesmas linhas não duplica nada', async () => {
    await inventarioImportado();
    const vinculos = await db.vinculoDocumentoPalete.count();
    const paletes = await db.palete.count();
    const repetido = await enviar(a.sup, 'INVENTARIO', 'inventario-ficticio.xlsx', planilhaInventario(), 200);
    expect(repetido.alreadyImported?.state).toBe('CONFIRMADO');
    // Mesmas linhas, outro arquivo (CSV): já importado / sem nada novo.
    const csv = csvTeste(
      [...CABECALHO_INVENTARIO],
      linhasInventario()
        .slice(0, 5)
        .map((l) => l.map((c) => (c !== null && typeof c === 'object' ? c.valor : c))),
    );
    const envio = await enviar(a.sup, 'INVENTARIO', 'inventario-ficticio.csv', csv);
    const lote = (await mapear(envio.batch as LoteImportacao, envio, PARAMETROS_INVENTARIO)) as LoteImportacao;
    const acoes = (await linhasLote(lote.id)).map((l) => [l.row, l.action]);
    expect(acoes).toEqual([
      [2, 'JA_IMPORTADO'],
      [3, 'JA_IMPORTADO'],
      [4, 'JA_IMPORTADO'],
      [5, 'DUPLICADA_ARQUIVO'],
      [6, 'JA_IMPORTADO'],
    ]);
    await confirmarLote(lote, { expectedApplicable: 0 });
    expect([await db.vinculoDocumentoPalete.count(), await db.palete.count()]).toEqual([vinculos, paletes]);
  });

  it('conferência externa é reconhecida à parte, sem mudar saldo nem estado de conferência por SKU', async () => {
    const { inventarioId } = await inventarioImportado();
    const antes = await estadoSaldo();
    const inv = InventarioResumoSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/inventarios/${inventarioId}` })).json());
    const negado = await mutar(a.app, a.op, 'POST', `${API}/inventarios/${inventarioId}/conferencia-externa`, { expectedVersion: inv.version, reference: 'X', date: null, source: 'Fonte fictícia' });
    expect(negado.statusCode).toBe(403);
    const r = await mutar(a.app, a.sup, 'POST', `${API}/inventarios/${inventarioId}/conferencia-externa`, {
      expectedVersion: inv.version,
      reference: 'CONF-FICT-001',
      date: '2026-09-28',
      source: 'Planilha conferida pela operação (fictícia)',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(InventarioResumoSchema.parse(r.json()).externalCount.state).toBe('RECONHECIDA');
    expect(await db.vinculoDocumentoPalete.count({ where: { inventarioId, conferidoExternamente: false, situacao: 'ATIVO' } })).toBe(0);
    expect(await estadoSaldo()).toBe(antes);
    expect((await paletePorCodigo('9101')).estadoConferencia).toBe('NAO_CONFERIDO');
  });

  it('registros mudados depois da revisão (posição ocupada): nada é gravado e a prévia é refeita', async () => {
    const envio = await enviar(a.sup, 'INVENTARIO', 'inventario-ficticio.xlsx', planilhaInventario());
    const lote = (await mapear(envio.batch as LoteImportacao, envio, PARAMETROS_INVENTARIO, { headerRow: 2 })) as LoteImportacao;
    // Outra pessoa ocupa F08-P07 (destino da linha 14) depois da revisão.
    const r = await mutar(a.app, a.op, 'POST', `${API}/paletes`, { code: { mode: 'INFORMAR', value: 'OUTRO-1' }, positionId: await idPosicao(db, ID_ESCOPO_PRACA, 'F08-P07'), notes: null, declaredItems: [] });
    expect(r.statusCode, r.body).toBe(201);
    const falha = await confirmarLote(lote, { expectedApplicable: 9 }, 409);
    expect(codigoErro(falha)).toBe('PREVIA_DESATUALIZADA');
    expect(await db.palete.count({ where: { codigo: { in: ['9101', '9102'] } } })).toBe(0);
    expect(await db.vinculoDocumentoPalete.count()).toBe(0);
    expect(await db.inventarioReferencia.count()).toBe(0);
  });

  it('linhas deixadas de fora ficam não aplicadas e podem ser reapresentadas depois, com rastreabilidade', async () => {
    const envio = await enviar(a.sup, 'INVENTARIO', 'inventario-ficticio.xlsx', planilhaInventario());
    const lote = (await mapear(envio.batch as LoteImportacao, envio, PARAMETROS_INVENTARIO, { headerRow: 2 })) as LoteImportacao;
    const errado = await confirmarLote(lote, { expectedApplicable: 9, excludedRows: [15] }, 409);
    expect(codigoErro(errado)).toBe('CONFLITO');
    const r = await confirmarLote(lote, { expectedApplicable: 8, excludedRows: [15] });
    const inventarioId = ResultadoConfirmacaoSchema.parse(r.json()).batch.result?.inventoryId ?? '';
    expect(await db.palete.count({ where: { codigo: '9107' } })).toBe(0);
    const linha15 = await db.linhaInventario.findFirstOrThrow({ where: { inventarioId, linhaArquivo: 15 } });
    expect([linha15.aplicada, linha15.paleteId]).toEqual([false, null]);
    // Reapresentação só das pendências corrigidas (9105 com um endereço só).
    const corrigida = xlsxTeste([
      { nome: 'Pendências', titulo: 'Correção fictícia', cabecalho: CABECALHO_INVENTARIO, linhas: [[12345683, 'NFD', 5550005, 2, null, null, null, '15 - A109', 9105, 'VALIDADA', null, 'CNPJ']] },
    ]);
    const envio2 = await enviar(a.sup, 'INVENTARIO', 'pendencias.xlsx', corrigida);
    const lote2 = (await mapear(envio2.batch as LoteImportacao, envio2, { ...PARAMETROS_INVENTARIO, complementsInventoryId: inventarioId }, { headerRow: 2 })) as LoteImportacao;
    expect(lote2.previewSummary.join(' ')).toMatch(/1 linha\(s\) resolvem pendências/);
    await confirmarLote(lote2, { expectedApplicable: 1 });
    const original = await db.linhaInventario.findFirstOrThrow({ where: { inventarioId, linhaArquivo: 10 } });
    expect(original.resolvidaPorId).not.toBeNull();
    expect((await paletePorCodigo('9105')).posicao?.codigo).toBe('F08-P05');
  });
});

// ---------- Seleção e conciliação ----------

const CAB_SELECAO = ['Palete', 'NF', 'Tipo', 'Linha do pedido', 'SKU', 'Quantidade solicitada', 'Unidade'];

async function materialValidado(codigoPalete: string, sku: string, quantidade: string, ref: string) {
  const p = await paletePorCodigo(codigoPalete);
  const produto = (await db.produto.findFirst({ where: { escopoId: ID_ESCOPO_PRACA, sku }, select: { id: true } })) ?? (await criarProduto(a, sku, `Produto fictício ${sku}`));
  const { resposta } = await reconciliar(a, p.id, [{ productId: produto.id, quantity: quantidade, lot: null, ref, originType: 'NOTA_FISCAL' }]);
  expect(resposta?.statusCode, resposta?.body).toBe(200);
  const detalhe = await palete(a, p.id);
  const seg = segmentoDe(detalhe, sku);
  const lib = await liberarMaterial(a, detalhe, seg, quantidade);
  expect(lib.statusCode, lib.body).toBe(200);
  return { id: p.id, seg };
}

async function selecaoImportada(inventarioId: string, linhas: (string | number | null)[][], extra: Record<string, unknown> = {}, cabecalho = CAB_SELECAO) {
  const envio = await enviar(a.sup, 'SELECAO_CLIENTE', `selecao-${chave()}.csv`, csvTeste(cabecalho, linhas));
  const lote = (await mapear(envio.batch as LoteImportacao, envio, {
    mode: 'LISTA',
    orderReference: 'PED-FICT-001',
    inventoryId: inventarioId,
    documentContext: 'DOCUMENTO_INVENTARIO',
    documentWithoutQuantity: 'TODO_MATERIAL_DO_INVENTARIO',
    duplicates: 'AGRUPAR_IDENTICAS',
    ...extra,
  })) as LoteImportacao;
  return lote;
}

async function conciliacao(selecaoId: string, query = '', s: SessaoTeste = a.sup): Promise<Conciliacao> {
  const r = await como(a.app, s, { method: 'GET', url: `${API}/selecoes/${selecaoId}/conciliacao?tamanho=500${query}` });
  expect(r.statusCode, r.body).toBe(200);
  return ConciliacaoSchema.parse(r.json());
}

const porLinha = (c: Conciliacao) => new Map<number, ResultadoConciliacao>(c.items.map((i) => [i.row, i]));

const LINHAS_PADRAO: (string | number | null)[][] = [
  [null, '5550001', 'NFD', '1', 'SKU-FICT-1', '10', 'UN'], // 2: 3 + 5 de 10
  [null, '5550002', 'NFD', '2', null, null, null], // 3: NF sem saldo validado relacionado
  [null, '5550099', 'NFD', '3', null, null, null], // 4: não encontrada
  [null, '5550009', 'NFD', '4', null, null, null], // 5: só endereço livre (histórico)
  [null, '5550001', null, '5', null, null, null], // 6: número isolado com dois contextos
  ['9103', null, null, '6', null, null, null], // 7: palete sem endereço
  [null, null, null, '7', 'SKU-FICT-1', '2', 'UN'], // 8: SKU isolado
  [null, '5550005', 'NFD', '8', null, null, null], // 9: NF citada no inventário sem vínculo aplicado
  ['9101', '5550001', 'NFD', '9', null, null, null], // 10: NF naquele palete (todo o material)
];

async function cenarioPadrao() {
  const { inventarioId } = await inventarioImportado();
  const m9101 = await materialValidado('9101', 'SKU-FICT-1', '3', '5550001');
  const m9102 = await materialValidado('9102', 'SKU-FICT-1', '5', '5550001');
  const lote = await selecaoImportada(inventarioId, LINHAS_PADRAO);
  expect(lote.canConfirm, lote.blockReason ?? '').toBe(true);
  const r = await confirmarLote(lote);
  const selecaoId = ResultadoConfirmacaoSchema.parse(r.json()).batch.result?.selectionId ?? '';
  return { inventarioId, selecaoId, m9101, m9102 };
}

describe('Seleção do cliente e conciliação (itens 1–3, 6–8, 10)', () => {
  it('abrangências, situações distintas, quantidades por base e conflito de demanda, sem criar estoque', async () => {
    const { selecaoId } = await cenarioPadrao();
    const antes = await estadoSaldo();
    const c = await conciliacao(selecaoId);
    const l = porLinha(c);
    // 3 + 5 de 10: dois paletes, 8 identificadas, 2 não atendidas (não é perda).
    const dez = l.get(2);
    expect(dez?.scope).toBe('LINHA_PRODUTO');
    expect(dez?.situation).toBe('QUANTIDADE_NAO_ATENDIDA');
    expect(dez?.alsoSituations).toContain('LOCALIZADO');
    expect(dez?.allocations.map((x) => [x.pallet.code, x.currentPosition?.address])).toEqual([
      ['9101', '15 - A101'],
      ['9102', '15 - A103'],
    ]);
    expect(dez?.quantities).toMatchObject({ requested: '10', validated: '8', available: '8', unmet: '2', comparable: true });
    expect(dez?.eligible).toBe(true);
    expect(l.get(3)?.situation).toBe('INFORMACAO_PENDENTE');
    expect(l.get(3)?.alsoSituations).toContain('LOCALIZADO');
    expect(l.get(3)?.quantities.informedVolumes).toBe('2');
    expect(l.get(4)?.situation).toBe('NAO_ENCONTRADO');
    expect(l.get(5)?.situation).toBe('APENAS_HISTORICO');
    expect(l.get(5)?.reasons.join(' ')).toMatch(/15 - A105/);
    expect(l.get(6)?.situation).toBe('AMBIGUO');
    expect(l.get(6)?.candidates.map((x) => x.documentKey).sort()).toEqual(['MI|5550001', 'NFD|5550001']);
    expect(l.get(7)?.situation).toBe('PALETE_SEM_ENDERECO');
    expect(l.get(7)?.scope).toBe('PALETE');
    expect(l.get(8)?.situation).toBe('AMBIGUO');
    expect(l.get(8)?.reasons.join(' ')).toMatch(/SKU SKU-FICT-1 sem documento de origem/);
    expect(l.get(9)?.situation).toBe('DOCUMENTO_SEM_PALETE');
    expect(l.get(10)?.situation).toBe('LOCALIZADO');
    expect(l.get(10)?.allocations.map((x) => x.pallet.code)).toEqual(['9101']);
    // Mesmo material físico em duas solicitações: conflito apontado, não duas disponibilidades.
    expect(dez?.demandConflicts.map((x) => x.row)).toContain(10);
    expect(c.summary).toMatchObject({ requestedLines: 9, distinctPallets: 3 });
    // Filtro por situação.
    const pendentes = await conciliacao(selecaoId, '&situacao=AMBIGUO,NAO_ENCONTRADO');
    expect(pendentes.items.map((i) => i.row).sort((x, y) => x - y)).toEqual([4, 6, 8]);
    expect(await estadoSaldo()).toBe(antes);
  });

  it('resolução explícita de ambiguidade (só candidatos mostrados), com auditoria e anulação preservada', async () => {
    const { selecaoId } = await cenarioPadrao();
    const sel = SelecaoDetalheSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/selecoes/${selecaoId}` })).json());
    const linha = porLinha(await conciliacao(selecaoId)).get(6);
    const forte = await mutar(a.app, a.sup, 'POST', `${API}/selecoes/${selecaoId}/linhas/${linha?.lineId ?? ''}/resolucao`, {
      expectedVersion: sel.version,
      palletId: null,
      documentKey: 'NFD|9999999',
      reason: 'Tentativa fora dos candidatos',
    });
    expect(forte.statusCode).toBe(400);
    const r = await mutar(a.app, a.sup, 'POST', `${API}/selecoes/${selecaoId}/linhas/${linha?.lineId ?? ''}/resolucao`, {
      expectedVersion: sel.version,
      palletId: null,
      documentKey: 'NFD|5550001',
      reason: 'Cliente confirmou que é a NF de devolução (fictício)',
    });
    expect(r.statusCode, r.body).toBe(200);
    const depois = porLinha(await conciliacao(selecaoId)).get(6);
    expect(depois?.resolution?.documentKey).toBe('NFD|5550001');
    expect(depois?.allocations.map((x) => x.pallet.code).sort()).toEqual(['9101', '9102']);
    expect(await db.eventoAuditoria.count({ where: { acao: 'SELECAO_RESOLUCAO_REGISTRADA' } })).toBe(1);
  });

  it('marcação: só os valores configurados selecionam; mapeamento sem coluna de decisão é recusado; duplicidade exige decisão', async () => {
    const { inventarioId } = await inventarioImportado();
    const cab = [...CABECALHO_INVENTARIO, 'DEVOLVER'];
    const copia = (n: number, marca: string | null) => [...(linhasInventario()[n] ?? []).map((c) => (c !== null && typeof c === 'object' ? c.valor : c)), marca];
    const arquivo = xlsxTeste([{ nome: 'Inventario com escolha', titulo: 'Escolha do cliente (fictícia)', cabecalho: cab, linhas: [copia(0, 'SIM'), copia(1, 'sim'), copia(2, null), copia(4, 'NAO'), copia(9, 'X')] }]);
    const envio = await enviar(a.sup, 'SELECAO_CLIENTE', 'inventario-marcado.xlsx', arquivo);
    const base = { mode: 'MARCACAO', markValues: ['SIM'], orderReference: 'PED-FICT-MARCA', inventoryId: inventarioId, documentContext: 'DOCUMENTO_INVENTARIO' };
    const semColuna = await mapear(envio.batch as LoteImportacao, envio, base, { headerRow: 2, columns: { ...(envio.structure?.suggestedColumns ?? {}), mark: null } }, 400);
    expect(semColuna).toBeDefined();
    const r = await como(a.app, a.sup, { method: 'GET', url: `${API}/importacoes/${envio.batch?.id ?? ''}/estrutura?headerRow=2` });
    const sugestao = r.json<{ suggestedColumns: Record<string, number | null> }>().suggestedColumns;
    expect(sugestao.mark).toBe(12);
    const lote = (await mapear(envio.batch as LoteImportacao, null, base, { headerRow: 2, columns: sugestao })) as LoteImportacao;
    const linhas = await linhasLote(lote.id);
    expect(linhas.map((l) => [l.row, l.classification])).toEqual([
      [3, 'VALIDA_NOVA'],
      [4, 'VALIDA_NOVA'],
      [5, 'EXCLUIDA'],
      [6, 'EXCLUIDA'],
      [7, 'EXCLUIDA'],
    ]);
    expect(linhas.find((l) => l.row === 5)?.reasons[0]?.message).toMatch(/vazio não é aprovação/);
    expect(lote.counters.excluded).toBe(3);
    // Linha inteira repetida: sem decisão, bloqueia.
    const rep = xlsxTeste([{ nome: 'Inventario com escolha', titulo: 'x', cabecalho: cab, linhas: [copia(0, 'SIM'), copia(0, 'SIM')] }]);
    const envio2 = await enviar(a.sup, 'SELECAO_CLIENTE', 'repetida.xlsx', rep);
    const lote2 = (await mapear(envio2.batch as LoteImportacao, null, { ...base, orderReference: 'PED-FICT-REP' }, { headerRow: 2, columns: sugestao })) as LoteImportacao;
    expect(lote2.canConfirm).toBe(false);
    expect((await linhasLote(lote2.id)).map((l) => l.reasons.map((m) => m.code).join())).toEqual(['', 'DUPLICIDADE_DECIDIR']);
    const lote3 = (await mapear(lote2, null, { ...base, orderReference: 'PED-FICT-REP', duplicates: 'AGRUPAR_IDENTICAS' }, { headerRow: 2, columns: sugestao })) as LoteImportacao;
    expect(lote3.counters).toMatchObject({ validNew: 1, duplicate: 1 });
    await confirmarLote(lote3);
    const agrupada = await db.linhaSelecao.findFirstOrThrow({ where: { duplicadaDeId: { not: null } } });
    expect(agrupada.decisaoDuplicidade).toMatch(/nada foi somado/);
  });

  it('códigos com zeros, unidade/quantidade desconhecidas e identificador truncado recebem o tratamento correto', async () => {
    const { inventarioId } = await inventarioImportado();
    const arquivo = xlsxTeste([
      {
        nome: 'Lista',
        cabecalho: CAB_SELECAO,
        linhas: [
          ['0009101', '0005550001', 'NFD', '1', null, null, null],
          [null, Number('12345678901234567'), 'NFD', '2', null, null, null],
          [null, '5550001', 'NFD', '3', 'SKU-FICT-1', '4', null],
          [null, '5550001', 'NFD', '4', 'SKU-FICT-1', null, 'UN'],
        ],
      },
    ]);
    const envio = await enviar(a.sup, 'SELECAO_CLIENTE', 'lista.xlsx', arquivo);
    const lote = (await mapear(envio.batch as LoteImportacao, envio, { mode: 'LISTA', orderReference: 'PED-FICT-ZEROS', inventoryId: inventarioId, documentContext: 'DOCUMENTO_INVENTARIO' })) as LoteImportacao;
    const linhas = await linhasLote(lote.id);
    const r = (n: number) => linhas.find((l) => l.row === n);
    expect(r(2)?.values).toMatchObject({ palletCode: '0009101', documentNumber: '0005550001' });
    expect(r(2)?.notices.map((m) => m.code)).toContain('NF_SEM_ALOCACAO');
    expect(r(3)?.reasons.map((m) => m.code)).toContain('IDENTIFICADOR_TRUNCADO');
    expect(r(4)?.reasons.map((m) => m.code)).toContain('QUANTIDADE_SEM_UNIDADE');
    expect(r(5)?.classification).toBe('VALIDA_NOVA');
    expect(r(5)?.notices.map((m) => m.code)).toContain('QUANTIDADE_NAO_INFORMADA');
    expect(lote.canConfirm).toBe(false);
  });
});

// ---------- Proposta, reserva e versões ----------

describe('Proposta para a janela e reserva pela etapa 08 (itens 5, 8, 9, 11)', () => {
  it('reserva só o elegível, sem usar o mesmo saldo duas vezes; reserva reduz o disponível sem mudar o físico', async () => {
    const { selecaoId, m9101, m9102 } = await cenarioPadrao();
    const janela = await janelaConfirmada(a, [pecas('100')]);
    const c = await conciliacao(selecaoId);
    const l = porLinha(c);
    const ids = [l.get(2)?.lineId, l.get(10)?.lineId, l.get(4)?.lineId].filter((x): x is string => x !== undefined);
    const r = await mutar(a.app, a.sup, 'POST', `${API}/selecoes/${selecaoId}/proposta-janela`, { windowId: janela.id, lineIds: ids });
    expect(r.statusCode, r.body).toBe(200);
    const proposta = PropostaJanelaSchema.parse(r.json());
    expect(proposta.items.map((i) => [i.palletCode, i.quantity])).toEqual([
      ['9101', '3'],
      ['9102', '5'],
    ]);
    expect(proposta.lines.find((x) => x.row === 2)).toMatchObject({ proposed: '8', unmet: '2' });
    expect(proposta.excluded.map((x) => x.row).sort((x, y) => x - y)).toEqual([4, 10]);
    expect(proposta.reservation?.allowed).toBe(true);
    const sel = SelecaoDetalheSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/selecoes/${selecaoId}` })).json());
    const corpo = { windowId: janela.id, expectedWindowVersion: proposta.windowVersion, expectedSelectionVersion: sel.version, signature: proposta.signature, lineIds: ids, reviewed: true };
    const k = chave();
    const res = await mutar(a.app, a.sup, 'POST', `${API}/selecoes/${selecaoId}/reservar`, corpo, k);
    expect(res.statusCode, res.body).toBe(200);
    const reserva = ResultadoPropostaSchema.parse(res.json());
    // Reenvio com a mesma chave: mesmo resultado; outra chave com a revisão antiga: recusada.
    const repetido = await mutar(a.app, a.sup, 'POST', `${API}/selecoes/${selecaoId}/reservar`, corpo, k);
    expect(ResultadoPropostaSchema.parse(repetido.json()).reservationId).toBe(reserva.reservationId);
    const outraChave = await mutar(a.app, a.sup, 'POST', `${API}/selecoes/${selecaoId}/reservar`, corpo);
    expect(outraChave.statusCode).toBe(409);
    expect(await db.reservaJanela.count()).toBe(1);
    const saldo = await db.saldoEstoque.findMany({ where: { paleteId: { in: [m9101.id, m9102.id] } }, select: { quantidade: true, quantidadeReservada: true } });
    expect(saldo.map((s) => [s.quantidade.toFixed(0), s.quantidadeReservada.toFixed(0)]).sort()).toEqual([
      ['3', '3'],
      ['5', '5'],
    ]);
    const depois = porLinha(await conciliacao(selecaoId)).get(2);
    expect(depois?.forwarded).toMatchObject({ reservedActive: '8', reservations: [reserva.reservationCode] });
    expect(depois?.quantities).toMatchObject({ validated: '8', reserved: '8', available: '0', unmet: '2' });
    expect(depois?.situation).toBe('QUANTIDADE_NAO_ATENDIDA');
  });

  it('movimento depois do inventário: endereço atual prevalece, fotografia preservada; proposta antiga não reserva', async () => {
    const { selecaoId, m9102, inventarioId } = await cenarioPadrao();
    const janela = await janelaConfirmada(a, [pecas('100')]);
    const linha = porLinha(await conciliacao(selecaoId)).get(2);
    const proposta = PropostaJanelaSchema.parse((await mutar(a.app, a.sup, 'POST', `${API}/selecoes/${selecaoId}/proposta-janela`, { windowId: janela.id, lineIds: [linha?.lineId] })).json());
    const p = await palete(a, m9102.id);
    const mov = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/movimentos`, {
      destinationPositionId: await idPosicao(db, ID_ESCOPO_PRACA, 'F08-P10'),
      confirmedPositionCode: 'F08-P10',
      expectedVersion: p.version,
      reason: 'Reorganização fictícia',
    });
    expect(mov.statusCode, mov.body).toBe(200);
    const sel = SelecaoDetalheSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/selecoes/${selecaoId}` })).json());
    const antiga = await mutar(a.app, a.sup, 'POST', `${API}/selecoes/${selecaoId}/reservar`, {
      windowId: janela.id,
      expectedWindowVersion: proposta.windowVersion,
      expectedSelectionVersion: sel.version,
      signature: proposta.signature,
      lineIds: [linha?.lineId],
      reviewed: true,
    });
    expect(antiga.statusCode).toBe(409);
    expect(codigoErro(antiga)).toBe('CONCILIACAO_DESATUALIZADA');
    expect(await db.reservaJanela.count()).toBe(0);
    const atual = porLinha(await conciliacao(selecaoId)).get(2)?.allocations.find((x) => x.pallet.code === '9102');
    expect([atual?.currentPosition?.code, atual?.currentPosition?.address, atual?.informedAddress, atual?.addressDiffers]).toEqual(['F08-P10', '15 - A119', '15 - A103', true]);
    const fotografia = await db.linhaInventario.findFirstOrThrow({ where: { inventarioId, linhaArquivo: 5 }, include: { posicao: { select: { codigo: true } } } });
    expect([fotografia.enderecoCanonico, fotografia.posicao?.codigo]).toEqual(['15 - A103', 'F08-P02']);
  });

  it('versão substitutiva mostra diferenças e reservas a revisar, sem cancelar nada; mesma referência sem substituição é bloqueada', async () => {
    const { selecaoId, inventarioId } = await cenarioPadrao();
    const janela = await janelaConfirmada(a, [pecas('100')]);
    const linha = porLinha(await conciliacao(selecaoId)).get(2);
    const proposta = PropostaJanelaSchema.parse((await mutar(a.app, a.sup, 'POST', `${API}/selecoes/${selecaoId}/proposta-janela`, { windowId: janela.id, lineIds: [linha?.lineId] })).json());
    const sel = SelecaoDetalheSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/selecoes/${selecaoId}` })).json());
    const res = await mutar(a.app, a.sup, 'POST', `${API}/selecoes/${selecaoId}/reservar`, {
      windowId: janela.id,
      expectedWindowVersion: proposta.windowVersion,
      expectedSelectionVersion: sel.version,
      signature: proposta.signature,
      lineIds: [linha?.lineId],
      reviewed: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    const mesma = await selecaoImportada(inventarioId, LINHAS_PADRAO.slice(0, 2));
    expect(mesma.canConfirm).toBe(false);
    expect(mesma.blockReason).toMatch(/versão substitutiva/);
    const v2 = await selecaoImportada(
      inventarioId,
      [
        [null, '5550001', 'NFD', '1', 'SKU-FICT-1', '6', 'UN'],
        [null, '5550099', 'NFD', '3', null, null, null],
        [null, '5550013', 'NFD', '11', null, null, null],
      ],
      { replacesSelectionId: selecaoId },
    );
    expect(v2.canConfirm, v2.blockReason ?? '').toBe(true);
    expect(v2.previewSummary.join(' ')).toMatch(/1 inclusão\(ões\), 7 exclusão\(ões\), 1 quantidade\(s\) alterada\(s\), 1 sem mudança/);
    expect(v2.previewSummary.join(' ')).toMatch(/Reservas ligadas à versão anterior/);
    const r = await confirmarLote(v2);
    const nova = ResultadoConfirmacaoSchema.parse(r.json()).batch.result?.selectionId ?? '';
    const detalhe = SelecaoDetalheSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/selecoes/${nova}` })).json());
    expect([detalhe.orderVersion, detalhe.replacesId, detalhe.differences?.reservationsToReview.length]).toEqual([2, selecaoId, 1]);
    expect((await db.selecaoCliente.findUniqueOrThrow({ where: { id: selecaoId } })).situacao).toBe('SUBSTITUIDA');
    expect((await db.reservaJanela.findFirstOrThrow()).situacao).toBe('ATIVA');
  });
});

// ---------- Exportações e permissões ----------

describe('Exportações e permissões (item 12)', () => {
  it('CSV identifica seleção, inventário e base; protege fórmulas; operador exporta mas não reserva; outro escopo não vê', async () => {
    const { selecaoId, inventarioId } = await cenarioPadrao();
    const sep = await como(a.app, a.op, { method: 'GET', url: `${API}/selecoes/${selecaoId}/exportar?tipo=separacao` });
    expect(sep.statusCode, sep.body).toBe(200);
    expect(sep.body).toMatch(/PROPOSTA \(não é reserva nem expedição/);
    expect(sep.body).toMatch(/"15 - A101";"F08-P01";"9101"/);
    const pend = await como(a.app, a.op, { method: 'GET', url: `${API}/selecoes/${selecaoId}/exportar?tipo=pendencias` });
    expect(pend.body).toMatch(/Não encontrado na base consultada/);
    expect(pend.body).not.toMatch(/;"=/);
    const conc = await como(a.app, a.analista, { method: 'GET', url: `${API}/selecoes/${selecaoId}/exportar?tipo=conciliacao` });
    expect(conc.statusCode).toBe(200);
    expect(await db.eventoAuditoria.count({ where: { acao: 'SELECAO_EXPORTADA' } })).toBe(3);
    // Permissões no servidor (chamadas diretas).
    expect((await como(a.app, a.consulta, { method: 'GET', url: `${API}/selecoes/${selecaoId}` })).statusCode).toBe(403);
    expect((await enviarArquivo(a.app, a.op, 'SELECAO_CLIENTE', 's.csv', csvTeste(CAB_SELECAO, LINHAS_PADRAO))).statusCode).toBe(403);
    expect((await enviarArquivo(a.app, a.op, 'INVENTARIO', 'i.csv', csvTeste([...CABECALHO_INVENTARIO], []))).statusCode).toBe(403);
    expect((await mutar(a.app, a.op, 'POST', `${API}/selecoes/${selecaoId}/proposta-janela`, { windowId: selecaoId, lineIds: [selecaoId] })).statusCode).toBe(403);
    expect((await como(a.app, a.outroEscopo, { method: 'GET', url: `${API}/selecoes/${selecaoId}` })).statusCode).toBe(404);
    expect((await como(a.app, a.outroEscopo, { method: 'GET', url: `${API}/selecoes/${selecaoId}/conciliacao` })).statusCode).toBe(404);
    expect((await como(a.app, a.outroEscopo, { method: 'GET', url: `${API}/inventarios/${inventarioId}` })).statusCode).toBe(404);
  });
});
