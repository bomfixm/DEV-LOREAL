import {
  ConteudosPaleteSchema,
  LoteImportacaoSchema,
  PaleteDetalheSchema,
  ResultadoConfirmacaoSchema,
  ResultadoEnvioSchema,
  type DocumentoBipagem,
  type LoteImportacao,
  type ParametrosBipagem,
} from '@praca-reversa/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { definirNumeracao, previsaoNumeroPalete, reservarNumeroPalete } from '../../src/modules/paletes/numeracao.js';
import { ID_ESCOPO_PRACA, bancoDeTeste, chave, codigoErro, como, mutar, type SessaoTeste } from './apoio.js';
import { API, criarPalete, montarAmbiente, type Ambiente } from './claims-apoio.js';
import { csvTeste } from './planilhas.js';

/**
 * Importação fixa da bipagem "Etiquetas" (21 out. 2026, D283–D288), contra
 * PostgreSQL de teste (escopo de demonstração; nada na operação real): um
 * arquivo = um palete; destino escolhido no mapa (posição livre = palete
 * novo numerado pela série do piso; ocupada = acrescenta ao palete dela);
 * notas repetidas pedem "Revalidar" ou "Importar separadamente"; nada é
 * gravado na prévia; erro/zeros não criam palete; reenvio do mesmo arquivo
 * avisa; confirmação repetida não duplica; numeração concorrente não repete;
 * posição ocupada entre a prévia e a confirmação refaz a prévia.
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

const AMOSTRA = fileURLToPath(new URL('../../../../amostras/Bipagem-real.xlsx', import.meta.url));
const temAmostra = existsSync(AMOSTRA);
const CAB = ['Status', 'Tipo', 'Número', 'Leituras', 'Lidos', 'Última Leitura', 'CNPJ Remetente', 'Remetente', 'Posicao'] as const;
type Linha = [tipo: string, numero: string, lidos: string | number, cnpj: string, remetente: string];
const arquivo = (...linhas: Linha[]) => csvTeste([...CAB], linhas.map(([t, n, l, c, r]) => ['OK', t, n, 9, l, '19/10/2026 10:00', c, r, 'IGNORADA']));

async function enviar(conteudo: Buffer, opcoes: { palete?: string; nome?: string; sessao?: SessaoTeste; status?: number } = {}) {
  const r = await como(a.app, opcoes.sessao ?? a.op, {
    method: 'POST',
    url: `${API}/importacoes?tipo=BIPAGEM${opcoes.palete ? `&palete=${opcoes.palete}` : ''}`,
    payload: conteudo,
    headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': encodeURIComponent(opcoes.nome ?? `Etiquetas-${chave()}.${conteudo.subarray(0, 2).toString('latin1') === 'PK' ? 'xlsx' : 'csv'}`), 'idempotency-key': chave() },
  });
  expect(r.statusCode, r.body).toBe(opcoes.status ?? 201);
  return r;
}

/** Envia e devolve o lote já em prévia (o servidor reconhece as colunas; não há mapeamento). */
async function previa(conteudo: Buffer, palete?: string): Promise<LoteImportacao> {
  const envio = ResultadoEnvioSchema.parse((await enviar(conteudo, { palete })).json());
  if (!envio.batch) throw new Error('Envio sem lote.');
  expect(envio.batch.state).toBe('PREVIA');
  return envio.batch;
}

/** Destino, decisões e confirmação de nova operação (refaz a prévia; nada é gravado). */
async function ajustar(lote: LoteImportacao, parametros: Partial<ParametrosBipagem>): Promise<LoteImportacao> {
  const atual = (lote.parameters ?? {}) as Partial<ParametrosBipagem>;
  const r = await mutar(a.app, a.op, 'PUT', `${API}/importacoes/${lote.id}/mapeamento`, {
    expectedVersion: lote.version,
    options: { sheet: null, headerRow: 1, encoding: null, delimiter: null },
    decimalSeparator: 'VIRGULA',
    columns: {},
    parameters: { ...atual, ...parametros },
  });
  expect(r.statusCode, r.body).toBe(200);
  return LoteImportacaoSchema.parse(r.json());
}

async function confirmar(lote: Pick<LoteImportacao, 'id' | 'previewVersion'>, status = 200, chaveIdem = chave()) {
  const r = await como(a.app, a.op, {
    method: 'POST',
    url: `${API}/importacoes/${lote.id}/confirmar`,
    payload: { previewVersion: lote.previewVersion, reviewed: true },
    headers: { 'idempotency-key': chaveIdem },
  });
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

async function conteudos(paleteId: string) {
  const r = await como(a.app, a.op, { method: 'GET', url: `${API}/paletes/${paleteId}/conteudos` });
  expect(r.statusCode, r.body).toBe(200);
  return ConteudosPaleteSchema.parse(r.json());
}

/** Posição livre do layout de demonstração (em uso, disponível, sem palete). */
async function posicaoLivre(pular = 0): Promise<string> {
  const linhas = await db.$queryRaw<{ id: string }[]>`
    SELECT pos.id::text FROM posicao pos JOIN layout l ON l.id = pos.layout_id
     WHERE pos.escopo_id = ${ID_ESCOPO_PRACA}::uuid AND l.ativo AND pos.disponivel AND NOT pos.desativada AND pos.retirada_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM palete p WHERE p.posicao_id = pos.id)
     ORDER BY pos.codigo LIMIT ${pular + 1}`;
  const linha = linhas[pular];
  if (!linha) throw new Error('Sem posição livre no layout de demonstração.');
  return linha.id;
}

const totalPaletes = async () => db.palete.count({ where: { escopoId: ID_ESCOPO_PRACA } });
const doc = (l: LoteImportacao, numero: string, linha?: number): DocumentoBipagem => {
  const d = l.palletImport?.documents.find((x) => x.number === numero && (linha === undefined || x.row === linha));
  if (!d) throw new Error(`${numero} fora da prévia.`);
  return d;
};

/** Importa a amostra numa posição livre (palete novo) e devolve o palete criado. */
async function amostraEmPaleteNovo(): Promise<{ id: string; code: string; posicao: string }> {
  const posicao = await posicaoLivre();
  const lote = await ajustar(await previa(readFileSync(AMOSTRA)), { destination: { kind: 'POSICAO', id: posicao } });
  const c = ResultadoConfirmacaoSchema.parse((await confirmar(lote)).json());
  const { palletId, palletCode } = c.batch.result ?? {};
  if (!palletId || !palletCode) throw new Error('sem palete');
  return { id: palletId, code: palletCode, posicao };
}

describe('Bipagem "Etiquetas": amostra real (amostras/Bipagem-real.xlsx)', () => {
  it.skipIf(!temAmostra)('prévia sem destino não grava nada; na posição livre, palete novo numerado com 41 entradas e 47 volumes', async () => {
    const antes = await totalPaletes();
    const lote = await previa(readFileSync(AMOSTRA));
    const r = lote.palletImport;
    if (!r) throw new Error('sem resumo');
    expect(r.sheet).toBe('Etiquetas_1');
    expect(r.columns.map((c) => `${c.letter}:${c.header}`)).toEqual(['C:Tipo', 'D:Número', 'G:Lidos', 'K:Remetente', 'J:CNPJ Remetente', 'I:Última Leitura']);
    expect(r.counters).toMatchObject({ records: 63, withReads: 41, withoutReads: 22, volumes: 47, rowsWithErrors: 0, accepted: 41, volumesToAdd: 47, awaitingDecision: 0, revalidated: 0 });
    expect(r.destination).toBeNull();
    expect(r.blockers).toEqual(['Escolha no mapa a posição deste palete.']);
    expect(lote.canConfirm).toBe(false);
    expect(doc(lote, '285987')).toMatchObject({ volumes: 5, typeCode: 'NF', senderCnpj: '03.962.539/0002-09', action: 'NOVO' });
    expect(doc(lote, '1379')).toMatchObject({ volumes: 1, row: 13, typeCode: 'MI' });
    expect(await totalPaletes()).toBe(antes);

    // Posição livre escolhida no mapa: palete novo, número só na confirmação.
    const posicao = await posicaoLivre();
    const comDestino = await ajustar(lote, { destination: { kind: 'POSICAO', id: posicao } });
    expect(comDestino.palletImport?.destination).toMatchObject({ kind: 'NOVO_PALETE', pallet: null, currentEntries: 0, blocked: null });
    expect(comDestino.canConfirm).toBe(true);
    expect(await totalPaletes()).toBe(antes);
    const numero = String(await previsaoNumeroPalete(db, ID_ESCOPO_PRACA));

    const c = ResultadoConfirmacaoSchema.parse((await confirmar(comDestino)).json());
    expect(c.batch.result).toMatchObject({ palletCode: numero, palletCreated: true, contentsCreated: 41, countsRegistered: 41, recordsWithoutReads: 22, volumesRead: 47, rowsRevalidated: 0 });
    const paleteId = c.batch.result?.palletId ?? '';
    const p = PaleteDetalheSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/paletes/${paleteId}` })).json());
    expect([p.code, p.positionId]).toEqual([numero, posicao]);
    const api = await conteudos(paleteId);
    expect(api.items).toHaveLength(41);
    expect(api.items.reduce((s, i) => s + Number(i.count.counted ?? 0), 0)).toBe(47);
    expect(api.items.find((i) => i.documentNumber === '285987')).toMatchObject({ documentType: 'NF', documentTypeOriginal: 'NF-e', count: { counted: '5', origin: 'BIPAGEM' } });
    // Lote ligado ao palete na confirmação; numeração avançou; prévia não criou nada antes.
    expect((await db.loteImportacao.findUniqueOrThrow({ where: { id: lote.id }, select: { paleteId: true } })).paleteId).toBe(paleteId);
    expect(await previsaoNumeroPalete(db, ID_ESCOPO_PRACA)).toBeGreaterThan(Number(numero));
    expect(await totalPaletes()).toBe(antes + 1);
  });

  it.skipIf(!temAmostra)('mesmo arquivo de novo no palete ocupado: aviso da importação anterior; Revalidar não acrescenta; Importar separadamente cria outra entrada e as duas contam', async () => {
    const p = await amostraEmPaleteNovo();
    const lote = await previa(readFileSync(AMOSTRA));
    expect(lote.palletImport?.previousImports).toHaveLength(1);
    const ocupado = await ajustar(lote, { destination: { kind: 'POSICAO', id: p.posicao } });
    const r = ocupado.palletImport;
    expect(r?.destination).toMatchObject({ kind: 'PALETE_EXISTENTE', pallet: { code: p.code }, currentEntries: 41, currentVolumes: 47 });
    expect(r?.counters).toMatchObject({ accepted: 0, awaitingDecision: 41 });
    const nf = doc(ocupado, '285987');
    expect(nf).toMatchObject({ action: 'COINCIDENTE', awaitingDecision: true });
    expect(nf.matches).toEqual([expect.objectContaining({ source: 'PALETE', volumes: 5, incomplete: false })]);
    expect(r?.blockers.join(' ')).toMatch(/já foi importado.*nova operação/);

    // Tudo revalidado: nada a acrescentar (nem com nova operação confirmada).
    const linhas = (r?.documents ?? []).map((d) => d.row);
    const todas = await ajustar(ocupado, { newOperation: true, decisions: linhas.map((row) => ({ row, decision: 'REVALIDAR' as const })) });
    expect(todas.palletImport?.blockers).toEqual(['Todas as notas foram revalidadas: nada a acrescentar.']);
    expect(todas.canConfirm).toBe(false);

    // 285987 importada separadamente; as demais revalidadas.
    const separada = await ajustar(todas, { decisions: linhas.map((row) => ({ row, decision: row === nf.row ? ('IMPORTAR_SEPARADO' as const) : ('REVALIDAR' as const) })) });
    expect(separada.palletImport?.counters).toMatchObject({ accepted: 1, volumesToAdd: 5, revalidated: 40, awaitingDecision: 0 });
    const original = (await conteudos(p.id)).items.find((i) => i.documentNumber === '285987');
    const c = ResultadoConfirmacaoSchema.parse((await confirmar(separada)).json());
    expect(c.batch.result).toMatchObject({ palletId: p.id, palletCreated: false, contentsCreated: 1, volumesRead: 5, rowsRevalidated: 40 });
    const depois = await conteudos(p.id);
    expect(depois.items).toHaveLength(42);
    expect(depois.items.reduce((s, i) => s + Number(i.count.counted ?? 0), 0)).toBe(52);
    const nfs = depois.items.filter((i) => i.documentNumber === '285987');
    expect(nfs.map((i) => i.count.counted)).toEqual(['5', '5']);
    // A entrada antiga não mudou (mesmo registro, mesma contagem).
    expect(nfs.find((i) => i.id === original?.id)?.count).toEqual(original?.count);
    // Revalidar não é conferência: o prazo de reconferência não foi reiniciado por ela.
    const pal = await db.palete.findUniqueOrThrow({ where: { id: p.id }, select: { ultimaReconferenciaEm: true } });
    expect(pal.ultimaReconferenciaEm).toBeNull();
    const [acoes] = await db.$queryRaw<{ revalidar: number; separado: number; ignoradas: number }[]>`
      SELECT count(*) FILTER (WHERE acao = 'REVALIDAR')::int AS revalidar, count(*) FILTER (WHERE acao = 'IMPORTAR_SEPARADO')::int AS separado,
             count(*) FILTER (WHERE resultado = 'IGNORADA_DUPLICADA')::int AS ignoradas
        FROM linha_importacao WHERE lote_id = ${lote.id}::uuid`;
    expect(acoes).toEqual({ revalidar: 40, separado: 1, ignoradas: 40 });
    expect(await db.conteudoPalete.count({ where: { paleteId: p.id, decisaoBipagem: 'IMPORTAR_SEPARADO' } })).toBe(1);
  });
});

describe('Bipagem "Etiquetas": regra de notas repetidas (dados fictícios)', () => {
  it('mesmo número com outro remetente ou CNPJ é outra entrada; CNPJ ausente pede decisão; repetição no próprio arquivo também', async () => {
    const p = await criarPalete(a);
    const primeira = await previa(arquivo(['NF-e', '900001', 10, '11.111.111/0001-11', 'Remetente A']), p.id);
    expect(primeira.palletImport?.destination).toMatchObject({ kind: 'PALETE_EXISTENTE', pallet: { id: p.id } });
    await confirmar(primeira);

    const lote = await previa(
      arquivo(
        ['NF-e', '900001', 3, '22.222.222/0001-22', 'Remetente B'],
        ['NF-e', '900001', 5, '11111111000111', 'REMETENTE A'],
        ['NF-e', '900001', 2, '', 'Remetente A'],
        ['Minuta', '77', 1, '33.333.333/0001-33', 'Remetente C'],
        ['Minuta', '77', 1, '33.333.333/0001-33', 'Remetente C'],
      ),
      p.id,
    );
    expect(lote.palletImport?.documents.map((d) => [d.row, d.action, d.matches.map((m) => `${m.source}${m.row === null ? '' : `:${String(m.row)}`}${m.incomplete ? '?' : ''}`)])).toEqual([
      [2, 'NOVO', []],
      [3, 'COINCIDENTE', ['PALETE']],
      [4, 'COINCIDENTE', ['PALETE?', 'ARQUIVO:3?']],
      [5, 'NOVO', []],
      [6, 'COINCIDENTE', ['ARQUIVO:5']],
    ]);
    expect(lote.canConfirm).toBe(false);
    const decidido = await ajustar(lote, {
      decisions: [
        { row: 3, decision: 'REVALIDAR' },
        { row: 4, decision: 'IMPORTAR_SEPARADO' },
        { row: 6, decision: 'IMPORTAR_SEPARADO' },
      ],
    });
    expect(decidido.palletImport?.counters).toMatchObject({ accepted: 4, volumesToAdd: 7, revalidated: 1, awaitingDecision: 0 });
    await confirmar(decidido);
    const c = await conteudos(p.id);
    expect(c.items.map((i) => [i.documentNumber, i.sender, i.count.counted]).sort()).toEqual(
      [
        ['900001', 'Remetente A', '10'],
        ['900001', 'Remetente B', '3'],
        ['900001', 'Remetente A', '2'],
        ['77', 'Remetente C', '1'],
        ['77', 'Remetente C', '1'],
      ].sort(),
    );
  });

  it('linha com erro, arquivo só com zeros ou lote descartado não criam palete; posição desativada é recusada', async () => {
    const antes = await totalPaletes();
    const posicao = await posicaoLivre();
    const erro = await ajustar(await previa(arquivo(['NF-e', '1', 2, '', 'R'], ['NF-e', '2', '-1', '', 'R'])), { destination: { kind: 'POSICAO', id: posicao } });
    expect(erro.palletImport?.blockers.join(' ')).toMatch(/1 linha com erro \(3\): corrija a exportação/);
    const recusa = await confirmar(erro, 409);
    expect(codigoErro(recusa)).toBe('IMPORTACAO_BLOQUEADA');
    const zeros = await ajustar(await previa(arquivo(['NF-e', '1', 0, '', 'R'])), { destination: { kind: 'POSICAO', id: posicao } });
    expect(zeros.palletImport?.blockers).toContain('Nenhuma linha com volumes lidos: nada a importar.');
    const descartar = await mutar(a.app, a.op, 'POST', `${API}/importacoes/${zeros.id}/descartar`, { expectedVersion: zeros.version });
    expect(descartar.statusCode, descartar.body).toBe(200);
    const [desativada] = await db.$queryRaw<{ id: string }[]>`SELECT id::text FROM posicao WHERE escopo_id = ${ID_ESCOPO_PRACA}::uuid AND desativada LIMIT 1`;
    if (desativada) {
      const l = await ajustar(await previa(arquivo(['NF-e', '1', 1, '', 'R'])), { destination: { kind: 'POSICAO', id: desativada.id } });
      expect(l.palletImport?.destination?.blocked).toMatch(/área desativada/);
    }
    expect(await totalPaletes()).toBe(antes);
    // Consulta não importa.
    await enviar(arquivo(['NF-e', '1', 1, '', 'R']), { sessao: a.consulta, status: 403 });
  });
});

describe('Bipagem "Etiquetas": confirmação, concorrência e numeração', () => {
  it('posição ocupada entre a prévia e a confirmação: nada gravado e a prévia passa a mostrar o palete que chegou', async () => {
    const posicao = await posicaoLivre();
    const lote = await ajustar(await previa(arquivo(['NF-e', '500', 4, '', 'Remetente X'])), { destination: { kind: 'POSICAO', id: posicao } });
    expect(lote.palletImport?.destination?.kind).toBe('NOVO_PALETE');
    const outro = await mutar(a.app, a.op, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId: posicao, notes: null, declaredItems: [] });
    expect(outro.statusCode, outro.body).toBe(201);
    const recusa = await confirmar(lote, 409);
    expect(codigoErro(recusa)).toBe('PREVIA_DESATUALIZADA');
    const atual = LoteImportacaoSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/importacoes/${lote.id}` })).json());
    expect(atual.palletImport?.destination).toMatchObject({ kind: 'PALETE_EXISTENTE', pallet: { id: outro.json<{ id: string }>().id } });
    expect(await db.conteudoPalete.count({ where: { escopoId: ID_ESCOPO_PRACA, origem: 'BIPAGEM' } })).toBe(0);
  });

  it('clique duplo e repetição gravam uma vez; dois lotes na mesma posição livre criam um palete só', async () => {
    const antes = await totalPaletes();
    const posicao = await posicaoLivre();
    const lote = await ajustar(await previa(arquivo(['NF-e', '700', 2, '', 'Remetente Y'])), { destination: { kind: 'POSICAO', id: posicao } });
    const k = chave();
    const [r1, r2] = await Promise.all([confirmar(lote, 200, k), confirmar(lote, 200, k)]);
    expect(r2.json()).toEqual(r1.json());
    expect(ResultadoConfirmacaoSchema.parse((await confirmar(lote, 200)).json()).alreadyConfirmed).toBe(true);
    expect(await totalPaletes()).toBe(antes + 1);

    const livre = await posicaoLivre();
    const [l1, l2] = await Promise.all([
      previa(arquivo(['NF-e', '701', 1, '', 'R1'])).then((l) => ajustar(l, { destination: { kind: 'POSICAO', id: livre } })),
      previa(arquivo(['NF-e', '702', 1, '', 'R2'])).then((l) => ajustar(l, { destination: { kind: 'POSICAO', id: livre } })),
    ]);
    const respostas = await Promise.all([
      como(a.app, a.op, { method: 'POST', url: `${API}/importacoes/${l1.id}/confirmar`, payload: { previewVersion: l1.previewVersion, reviewed: true }, headers: { 'idempotency-key': chave() } }),
      como(a.app, a.op, { method: 'POST', url: `${API}/importacoes/${l2.id}/confirmar`, payload: { previewVersion: l2.previewVersion, reviewed: true }, headers: { 'idempotency-key': chave() } }),
    ]);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await db.palete.count({ where: { escopoId: ID_ESCOPO_PRACA, posicaoId: livre } })).toBe(1);
    expect(await totalPaletes()).toBe(antes + 2);
  });

  it('numeração: parte do último informado, pula faixas reservadas e números usados; reservas simultâneas nunca repetem', async () => {
    const agora = new Date('2026-10-21T12:00:00Z');
    const autor = (await db.usuario.findFirstOrThrow({ where: { login: 'supervisor' }, select: { id: true } })).id;
    await db.$transaction((tx) => definirNumeracao(tx, ID_ESCOPO_PRACA, { ultimo: 278, reservados: [{ de: 1000, ate: 1015 }], origem: 'teste' }, autor, agora));
    expect(await previsaoNumeroPalete(db, ID_ESCOPO_PRACA)).toBe(279);
    const usado = await mutar(a.app, a.op, 'POST', `${API}/paletes`, { code: { mode: 'INFORMAR', value: '280' }, positionId: null, notes: null, declaredItems: [] });
    expect(usado.statusCode, usado.body).toBe(201);
    const reservar = () => db.$transaction((tx) => reservarNumeroPalete(tx, ID_ESCOPO_PRACA, agora));
    expect(await reservar()).toBe('279');
    expect(await reservar()).toBe('281');
    await db.$transaction((tx) => definirNumeracao(tx, ID_ESCOPO_PRACA, { ultimo: 998, reservados: [{ de: 1000, ate: 1015 }], origem: 'teste' }, autor, agora));
    expect([await reservar(), await reservar()]).toEqual(['999', '1016']);
    const simultaneos = await Promise.all(Array.from({ length: 6 }, () => reservar()));
    expect(new Set(simultaneos).size).toBe(6);
  });
});
