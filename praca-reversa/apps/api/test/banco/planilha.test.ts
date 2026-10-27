import { ResultadoPublicacaoPlanilhaSchema, SituacaoPlanilhaSchema, type Escopo } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { RAIZ_REPOSITORIO } from '../../src/config.js';
import type { Banco } from '../../src/db/cliente.js';
import { lerTabela, type Tabela } from '../../src/modules/importacao/arquivo/ler.js';
import { executarCarga, lerPacote } from '../../src/modules/importacao/carga-lote.js';
import { pastaVersoes } from '../../src/modules/planilha/arquivos.js';
import { prefixoPlanilha } from '../../src/modules/planilha/envio.js';
import { ABA_INVENTARIO, ABA_MOVIMENTOS, ABA_PROTECAO, COL, COLUNAS_INVENTARIO, LINHA_CABECALHO_INVENTARIO, LINHA_CABECALHO_MOVIMENTOS, baseDoNome } from '../../src/modules/planilha/montar.js';
import { escoposDevidos, processarEscopo } from '../../src/modules/planilha/processar.js';
import { processarBackups } from '../../src/modules/protecao/backup.js';
import { PLANILHA_PADRAO, type ConfigPlanilha } from '../../src/modules/protecao/configuracao.js';
import { DestinoPasta, DestinoS3, type Destino } from '../../src/modules/protecao/destino.js';
import { testarRestauracao } from '../../src/modules/protecao/restauracao.js';
import { protegerAntesDaSubstituicao } from '../../src/modules/protecao/substituicao.js';
import { voltaPlanilha } from '../../src/modules/protecao/trabalhador.js';
import { CONFIG_TESTE, bancoDeTeste, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste, type UsuarioTeste } from './apoio.js';
import { bytesDoPacote, montarPacote, type LinhaTeste } from './pacote-carga.js';
import { CREDENCIAIS_FALSAS, iniciarS3Falso, type S3Falso } from './s3-falso.js';

/**
 * Planilha automática e proteção (26 out. 2026) contra PostgreSQL real e um
 * serviço S3 compatível local de teste: fila durável, revisão crescente,
 * conteúdo reconciliável do Inventário (pendências, validação, desconhecidos,
 * texto literal), movimento/baixa parcial/complemento sem duplicar, envio com
 * confirmação, falha e retentativa, reinício e repetição da mesma revisão,
 * revisão antiga nunca sobrescreve, substituição do inventário com proteção
 * prévia, permissões, backup externo e restauração isolada. Dados fictícios;
 * pastas temporárias; nada sai da máquina.
 */
const API = '/api/v1';
const CARGA = new Date('2026-10-20T12:00:00Z');
let db: Banco;
let pastas: string[] = [];
let s3: S3Falso;
let app: FastifyInstance;
let escopo: Escopo;
let outro: Escopo;
let supervisor: UsuarioTeste;
let sup: SessaoTeste;
let op: SessaoTeste;

// Fileira 13 confirmada de A101 a A133 (ímpares); 15 - A120 fica sem posição no mapa.
const LINHAS: LinhaTeste[] = [
  { linha: 3, tipo: 'NFD', numero: '0001001', delivery: '00D-001', remetente: 'Remetente A', endereco: '13 - A101', volumes: '3', marcador: '01\\02', numeroPlanilha: '501' },
  { linha: 4, tipo: 'NFD', numero: '0001002', delivery: 'D-002', remetente: 'Remetente B', endereco: '13 - A101', volumes: '2', numeroPlanilha: '501' },
  { linha: 5, tipo: 'NFD', numero: '0001001', delivery: '00D-001', remetente: 'Remetente A', endereco: '13 - A103', volumes: '1', marcador: '02\\02', numeroPlanilha: '502' },
  { linha: 6, tipo: 'NFD', numero: '0001004', remetente: '=HYPERLINK("http://x")', endereco: '13 - A105', volumes: '', numeroPlanilha: '503' },
  { linha: 7, tipo: 'MI', numero: '0001006', remetente: 'Remetente F', endereco: '13 - A107', volumes: '2', numeroPlanilha: '504' },
  { linha: 8, tipo: 'NFD', numero: '0001007', delivery: 'D-007', remetente: 'Remetente G', endereco: '13 - A109', livre: true, volumes: '5' },
  { linha: 9, remetente: 'Remetente H', endereco: '13 - A111', volumes: '6', numeroPlanilha: '505' },
  { linha: 10, tipo: 'NFD', numero: '0001010', delivery: 'D-010', remetente: 'Remetente J', endereco: '15 - A120', volumes: '4', numeroPlanilha: '506' },
];

const pacote = (linhas: readonly LinhaTeste[], variante?: string) => {
  const r = lerPacote(bytesDoPacote(montarPacote(linhas, variante ? { variante } : {})), 'dados-importacao.json');
  if (!r.ok) throw new Error(r.erros.join(' | '));
  return r.pacote;
};

const temporaria = (prefixo: string) => {
  const p = mkdtempSync(join(tmpdir(), prefixo));
  pastas.push(p);
  return p;
};

const s3Destino = (prefixo = 'praca'): Destino =>
  new DestinoS3({ endpoint: s3.endpoint, regiao: CREDENCIAIS_FALSAS.regiao, bucket: s3.bucket, prefixo, estilo: 'CAMINHO', chaveAcesso: CREDENCIAIS_FALSAS.chaveAcesso, segredo: CREDENCIAIS_FALSAS.segredo }, 'Armazenamento S3 de teste (fictício)', true, null);

function config(destino: Destino | null, extra: Partial<ConfigPlanilha> = {}): ConfigPlanilha {
  return {
    ...PLANILHA_PADRAO,
    automatica: true,
    destino,
    pastaLocal: temporaria('praca-planilha-local-'),
    agruparMs: 0,
    esperaMaximaMs: 0,
    protegerSubstituicao: true,
    ...extra,
    backup: { ...PLANILHA_PADRAO.backup, automatico: false, destino, pastaLocal: temporaria('praca-backups-'), variavelBanco: 'DATABASE_URL_TESTE', raiz: RAIZ_REPOSITORIO, ...extra.backup },
  };
}

const LIMITES = { maxBytes: 50_000_000, maxRows: 10_000, maxColumns: 60, maxCellChars: 32_767, maxUncompressedBytes: 500_000_000, maxZipEntries: 60, maxProcessingMs: 60_000 };
const ler = (b: Buffer, aba: string, cab: number): Tabela => lerTabela(b, 'XLSX', { sheet: aba, headerRow: cab, encoding: null, delimiter: null }, LIMITES);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const pendentes = async (e: Escopo) => db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM alteracao_planilha WHERE escopo_id = ${e.id}::uuid`.then((r) => r[0]?.n ?? 0);
const base = (e: Escopo) => baseDoNome(e.unitCode, e.clientCode);

/** Arquivo principal da última revisão gerada (pasta local, conferido). */
async function ultimaLocal(cfg: ConfigPlanilha, e: Escopo): Promise<{ revisao: number; buffer: Buffer }> {
  const g = await db.geracaoPlanilha.findFirstOrThrow({ where: { escopoId: e.id, situacao: 'GERADA' }, orderBy: { revisao: 'desc' } });
  const nome = g.nomeArquivo ?? '';
  const buffer = readFileSync(join(pastaVersoes(cfg, e.id), nome));
  expect(sha(buffer)).toBe(g.hashArquivo);
  return { revisao: g.revisao ?? 0, buffer };
}

const linhasInv = (b: Buffer) => ler(b, ABA_INVENTARIO, LINHA_CABECALHO_INVENTARIO).linhas;
const txt = (l: Tabela['linhas'][number] | undefined, col: number) => l?.celulas[col]?.texto ?? null;

async function criarEscopo(codigo: string): Promise<Escopo> {
  const unidade = await db.unidade.create({ data: { id: randomUUID(), codigo: `UN-${codigo}`, nome: `Unidade ${codigo}`, demonstracao: false } });
  const cliente = await db.cliente.create({ data: { id: randomUUID(), codigo: `CLI-${codigo}`, nome: `Cliente ${codigo}`, demonstracao: false } });
  const e = await db.escopo.create({ data: { id: randomUUID(), unidadeId: unidade.id, clienteId: cliente.id, nome: `Praça ${codigo}`, demonstracao: false } });
  return { id: e.id, name: e.nome, unitCode: unidade.codigo, unitName: unidade.nome, clientCode: cliente.codigo, clientName: cliente.nome, demo: false };
}

async function confirmarFileira13(s: SessaoTeste, e: Escopo): Promise<void> {
  expect((await mutar(app, s, 'POST', `${API}/layout/desenho-aprovado`, {})).statusCode).toBe(201);
  const c = (await como(app, s, { method: 'GET', url: `${API}/layout/enderecos` })).json<{ revision: number }>();
  const f04 = await db.fileira.findFirstOrThrow({ where: { escopoId: e.id, codigo: 'F04', layout: { ativo: true } }, select: { id: true } });
  const proposta = await mutar(app, s, 'PUT', `${API}/layout/fileiras/${f04.id}/sequencia`, { expectedRevision: c.revision, segments: 'A101-A133/2', direction: 'P01_PRIMEIRO', source: 'Levantamento fictício' });
  expect(proposta.statusCode, proposta.body).toBe(200);
  const confirmar = await mutar(app, s, 'POST', `${API}/layout/fileiras/${f04.id}/enderecos/confirmar`, { expectedRevision: proposta.json<{ revision: number }>().revision, expectedProposed: 17 });
  expect(confirmar.statusCode, confirmar.body).toBe(200);
}

beforeAll(async () => {
  db = bancoDeTeste();
  s3 = await iniciarS3Falso();
});

beforeEach(async () => {
  await prepararDados(db);
  s3.objetos.clear();
  s3.falhar = false;
  s3.adulterarLeitura = false;
  s3.porPagina = 1_000;
  escopo = await criarEscopo('PLAN-A');
  outro = await criarEscopo('PLAN-B');
  supervisor = await criarUsuario(db, 'supervisor.planilha', [
    [escopo.id, 'SUPERVISOR_ESTOQUE'],
    [outro.id, 'SUPERVISOR_ESTOQUE'],
  ]);
  const operador = await criarUsuario(db, 'operador.planilha', [[escopo.id, 'OPERADOR']]);
  app = await criarApp({ db, config: CONFIG_TESTE, interfaceDir: null, planilha: config(null) });
  sup = await entrar(app, supervisor);
  op = await entrar(app, operador);
  await confirmarFileira13(sup, escopo);
  await executarCarga(db, escopo, { usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` }, pacote(LINHAS), { substitui: null, descricao: null }, CARGA);
  await executarCarga(db, outro, { usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` }, pacote([{ linha: 3, tipo: 'NFD', numero: '9990001', delivery: 'D-B', remetente: 'Outro cliente', endereco: '11 - A1', volumes: '7', numeroPlanilha: '1' }]), { substitui: null, descricao: null }, CARGA);
});

afterEach(async () => {
  await app.close();
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
  pastas = [];
});

afterAll(async () => {
  await s3.parar();
  await db.$disconnect();
});

describe('Fila durável e revisão', () => {
  it('gatilhos marcam na mesma transação (desfeita = sem marca); a revisão inclui só o que viu; alteração posterior fica para a seguinte', async () => {
    expect(await pendentes(escopo)).toBeGreaterThan(0);
    const antes = await pendentes(escopo);
    await expect(
      db.$transaction(async (tx) => {
        await tx.palete.updateMany({ where: { escopoId: escopo.id }, data: { observacoes: 'alteração desfeita' } });
        throw new Error('desfazer');
      }),
    ).rejects.toThrow('desfazer');
    expect(await pendentes(escopo)).toBe(antes);
    const cfg = config(null);
    const r1 = await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true });
    expect(r1).toMatchObject({ situacao: 'CONCLUIDO', geracao: { situacao: 'GERADA', revisao: 1 }, envio: { situacao: 'NAO_CONFIGURADO' } });
    expect(await pendentes(escopo)).toBe(0);
    expect(await pendentes(outro)).toBeGreaterThan(0);
    // Tabelas criadas depois da planilha única também marcam (contagem de volumes).
    const v = await db.vinculoDocumentoPalete.findFirstOrThrow({ where: { escopoId: escopo.id, numeroDocumento: '0001002' }, select: { id: true, paleteId: true } });
    const c = await mutar(app, op, 'POST', `${API}/paletes/${v.paleteId}/conteudos/contagens`, { target: { kind: 'IMPORTADO', id: v.id }, counted: 9, origin: 'CONTAGEM_FISICA' });
    expect(c.statusCode, c.body).toBe(201);
    expect(await pendentes(escopo)).toBeGreaterThan(0);
    const origens = await db.$queryRaw<{ origem: string }[]>`SELECT DISTINCT origem FROM alteracao_planilha WHERE escopo_id = ${escopo.id}::uuid`;
    expect(origens.map((o) => o.origem)).toContain('contagem_volumes');
    // Sem alteração: nada a gerar; com alteração: revisão 2 com o valor novo.
    const r2 = await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: false });
    expect(r2).toMatchObject({ situacao: 'CONCLUIDO', geracao: { situacao: 'GERADA', revisao: 2 } });
    const r3 = await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: false });
    expect(r3).toMatchObject({ situacao: 'CONCLUIDO', geracao: null });
    const { buffer } = await ultimaLocal(cfg, escopo);
    const linha = linhasInv(buffer).find((l) => txt(l, COL.NUMERO) === '0001002');
    expect([txt(linha, COL.VOLUMES), txt(linha, COL['ORIGEM DOS VOLUMES'])]).toEqual(['9', 'Contado no aplicativo']);
  });

  it('trabalhador: alterações agrupadas e espera máxima; escopo de demonstração fica de fora', async () => {
    // Primeira revisão: sempre devida (nunca gerada); depois, só alterações agrupadas.
    const cfg = config(null, { agruparMs: 60_000, esperaMaximaMs: 600_000 });
    await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: false });
    await db.palete.updateMany({ where: { escopoId: escopo.id }, data: { observacoes: 'alteração agrupada' } });
    const agora = new Date();
    expect((await escoposDevidos(db, cfg, agora)).map((d) => d.escopoId)).not.toContain(escopo.id);
    expect((await escoposDevidos(db, cfg, new Date(agora.getTime() + 61_000))).map((d) => d.escopoId)).toContain(escopo.id);
    const ids = (await escoposDevidos(db, config(null), agora)).map((d) => d.escopoId);
    expect(ids).toEqual(expect.arrayContaining([escopo.id, outro.id]));
    expect(await db.escopo.count({ where: { id: { in: ids }, demonstracao: true } })).toBe(0);
    const estado = { reconciliadoEm: new Map<string, number>() };
    await voltaPlanilha(db, config(null), { info: () => undefined, warn: () => undefined, error: () => undefined }, estado);
    expect(await db.geracaoPlanilha.count({ where: { escopoId: { in: [escopo.id, outro.id] }, situacao: 'GERADA' } })).toBe(3);
    expect(await pendentes(escopo)).toBe(0);
  });
});

describe('Conteúdo do Inventário', () => {
  it('mesmas colunas da operação; um registro por linha; NF em dois paletes com os próprios volumes; desconhecido, pendências e validação em texto fora da soma; texto literal; reconciliável', async () => {
    // Uma nota vai para a validação (sem endereço) e uma linha do lote ativo fica em revisão.
    const v = await db.vinculoDocumentoPalete.findFirstOrThrow({ where: { escopoId: escopo.id, numeroDocumento: '0001006' }, select: { id: true, paleteId: true } });
    const val = await mutar(app, sup, 'POST', `${API}/paletes/${v.paleteId}/conteudos/acoes`, { action: 'VALIDACAO', items: [{ kind: 'IMPORTADO', id: v.id }], reason: 'Palete não encontrado no piso (fictício)' });
    expect(val.statusCode, val.body).toBeLessThan(300);
    await db.$executeRaw`
      INSERT INTO linha_inventario (id, escopo_id, inventario_id, lote_importacao_id, linha_arquivo, delivery, tipo_documento, numero_documento, chave_documento, volumes, volumes_lido, remetente,
                                    endereco_lido, endereco_canonico, numero_palete, extras, identidade_documento, acao, aplicada, motivos, criado_em)
      SELECT ${randomUUID()}::uuid, escopo_id, inventario_id, lote_importacao_id, 99, '0007', 'NFD', '0009999', 'NFD|0009999', 12, '12', 'Remetente Revisão',
             'VALIDAR', NULL, '777', jsonb_build_object('pendencias', jsonb_build_array('endereco_a_validar')), encode(sha256('id-revisao'::bytea), 'hex'), 'REQUER_RESOLUCAO', false,
             '[{"code":"EM_REVISAO","field":null,"message":"Em revisão"}]'::jsonb, criado_em
        FROM linha_inventario WHERE escopo_id = ${escopo.id}::uuid ORDER BY linha_arquivo LIMIT 1`;
    const cfg = config(null);
    await processarEscopo(db, escopo.id, cfg, { gerar: 'SEMPRE', motivo: 'MANUAL', enviar: false });
    const { buffer, revisao } = await ultimaLocal(cfg, escopo);
    const inv = ler(buffer, ABA_INVENTARIO, LINHA_CABECALHO_INVENTARIO);
    expect(inv.cabecalho.slice(0, 13).map((c) => c.texto)).toEqual(['N° PALLET', 'DELIVERY', 'TIPO', 'NUMERO', 'VOLUMES', 'REMETENTE', 'MÊS AGENDA', 'JANELA', 'RUA', 'DOCUMENTAÇÃO', 'PALLET FULL', 'PF/CNPJ', 'INVENTÁRIO']);
    expect(inv.cabecalho.map((c) => c.texto)).toEqual([...COLUNAS_INVENTARIO]);
    const linhas = inv.linhas;
    const por = (n: string) => linhas.filter((l) => txt(l, COL.NUMERO) === n);
    // NF em dois paletes: duas linhas, cada uma com os próprios volumes e etiquetas; nada repetido nem somado.
    expect(por('0001001').map((l) => [txt(l, COL.RUA), txt(l, COL.VOLUMES), txt(l, COL.DELIVERY), txt(l, COL['PALLET FULL'])])).toEqual([
      ['13 - A101', '3', '00D-001', '01\\02'],
      ['13 - A103', '1', '00D-001', '02\\02'],
    ]);
    expect(por('0001001').every((l) => l.celulas[COL.NUMERO]?.tipo === 'TEXTO' && l.celulas[COL.DELIVERY]?.tipo === 'TEXTO' && l.celulas[COL.VOLUMES]?.tipo === 'NUMERO')).toBe(true);
    // Palete e endereço separados; misto com duas notas.
    expect(linhas.filter((l) => txt(l, COL.RUA) === '13 - A101').map((l) => txt(l, COL['N° PALLET']))).toEqual(['501', '501']);
    expect(txt(por('0001002')[0], COL['TIPO DO PALETE'])).toBe('Misto (várias notas)');
    // Volume desconhecido: "Não informado" (texto), nunca zero; remetente com "=" continua texto.
    const desconhecido = por('0001004')[0];
    expect([desconhecido?.celulas[COL.VOLUMES]?.tipo, txt(desconhecido, COL.VOLUMES)]).toEqual(['TEXTO', 'Não informado']);
    expect(txt(desconhecido, COL.REMETENTE)).toBe('=HYPERLINK("http://x")');
    expect(linhas.some((l) => l.celulas.some((c) => c?.formula))).toBe(false);
    // Validação: sem endereço nem palete, com motivo; volumes fora da soma.
    const emValidacao = por('0001006')[0];
    expect([txt(emValidacao, COL['N° PALLET']), txt(emValidacao, COL.RUA), txt(emValidacao, COL.TIPO), txt(emValidacao, COL.VOLUMES)]).toEqual([null, null, 'MI', 'Pendente: 2 volume(s) a localizar']);
    expect(txt(emValidacao, COL.PENDÊNCIA)).toMatch(/Palete não encontrado no piso/);
    // Linha do lote ativo em revisão: identificada, sem endereço nem quantidade inventados.
    const revisaoLinha = por('0009999')[0];
    expect([txt(revisaoLinha, COL.RUA), txt(revisaoLinha, COL.VOLUMES)]).toEqual([null, 'Pendente: 12 informado(s)']);
    expect(txt(revisaoLinha, COL.SITUAÇÃO)).toMatch(/Pendente no lote ativo/);
    expect(txt(revisaoLinha, COL.PENDÊNCIA)).toMatch(/Em revisão: Endereço a validar/);
    // Conteúdo sem documento, endereço livre (fora da praça) e palete sem posição no mapa.
    expect(txt(linhas.find((l) => txt(l, COL.RUA) === '13 - A111'), COL.SITUAÇÃO)).toMatch(/documento não informado/);
    expect(txt(por('0001007')[0], COL.SITUAÇÃO)).toMatch(/Fora da praça/);
    expect(txt(por('0001010')[0], COL.SITUAÇÃO)).toMatch(/endereço informado no inventário; posição no mapa a confirmar/);
    // Reconciliação: soma dos números = volumes conhecidos do snapshot; IDs únicos; nada do outro escopo.
    const soma = linhas.reduce((t, l) => t + (l.celulas[COL.VOLUMES]?.tipo === 'NUMERO' ? Number(txt(l, COL.VOLUMES)) : 0), 0);
    const g = await db.geracaoPlanilha.findFirstOrThrow({ where: { escopoId: escopo.id, revisao } });
    expect(soma).toBe((g.registros as { volumesConhecidos: number }).volumesConhecidos);
    expect(soma).toBe(3 + 2 + 1 + 4);
    const ids = linhas.map((l) => txt(l, COL['ID DO REGISTRO']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(linhas.some((l) => l.celulas.some((c) => c?.texto === '9990001'))).toBe(false);
    // Proteção e ajuda: escopo, revisão e lote; sem caminho do servidor.
    const prot = ler(buffer, ABA_PROTECAO, 2).linhas;
    const valor = (r: string) => prot.find((l) => txt(l, 0) === r)?.celulas[1]?.texto;
    expect(valor('Revisão dos dados')).toBe(String(revisao));
    expect(valor('Lote ativo')).toMatch(/^INV-000001/);
    expect(valor('Destino independente')).toMatch(/Não configurado/);
    expect(prot.some((l) => l.celulas.some((c) => (c?.texto ?? '').includes(cfg.pastaLocal)))).toBe(false);
  });

  it('movimento entre posições, baixa parcial e complemento opcional: a mesma linha muda, sem duplicar nem copiar a quantidade antiga', async () => {
    const cfg = config(null);
    await processarEscopo(db, escopo.id, cfg, { gerar: 'SEMPRE', motivo: 'MANUAL', enviar: false });
    // Movimento: palete 503 (13 - A105) vai para 13 - A121.
    const p = await db.palete.findFirstOrThrow({ where: { escopoId: escopo.id, codigo: '503' }, select: { id: true, versao: true } });
    const destino = await db.posicao.findFirstOrThrow({ where: { escopoId: escopo.id, endereco: { endereco: '13 - A121' } }, select: { id: true, codigo: true } });
    const mov = await mutar(app, op, 'POST', `${API}/paletes/${p.id}/movimentos`, { destinationPositionId: destino.id, confirmedPositionCode: destino.codigo, expectedVersion: p.versao, reason: 'Teste da planilha' });
    expect(mov.statusCode, mov.body).toBe(200);
    // Baixa parcial: 1 de 3 volumes da NF 0001001 no palete 501 separados e expedidos numa janela.
    const v = await db.vinculoDocumentoPalete.findFirstOrThrow({ where: { escopoId: escopo.id, numeroDocumento: '0001001', palete: { codigo: '501' } }, select: { id: true } });
    const j = await db.janelaDevolucao.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        numero: 901,
        codigo: 'JAN-000901',
        nome: 'Janela fictícia',
        confirmadaEm: CARGA,
        confirmadaPorId: supervisor.id,
        autorizacaoFonte: 'E-mail fictício',
        autorizacaoReferencia: 'REF-FICT',
        autorizacaoData: new Date('2026-10-01T00:00:00Z'),
        autorizacaoResponsavel: 'Contato fictício',
        mesReferencia: new Date('2026-10-01T00:00:00Z'),
        saidaInicio: new Date('2026-10-20T12:00:00Z'),
        saidaFim: new Date('2026-10-21T12:00:00Z'),
        situacao: 'CONFIRMADA',
        criadoPorId: supervisor.id,
        criadoEm: CARGA,
        atualizadoEm: CARGA,
      },
    });
    const sep = await mutar(app, op, 'POST', `${API}/janelas/${j.id}/volumes/separacoes`, { linkId: v.id, volumes: 1 });
    expect(sep.statusCode, sep.body).toBeLessThan(300);
    const exp = await mutar(app, sup, 'POST', `${API}/janelas/${j.id}/volumes/expedicoes`, { items: [{ linkId: v.id, volumes: 1 }] });
    expect(exp.statusCode, exp.body).toBeLessThan(300);
    // Complemento opcional: conteúdo registrado ganha o Delivery depois.
    const p2 = await db.palete.findFirstOrThrow({ where: { escopoId: escopo.id, codigo: '504' }, select: { id: true } });
    const novo = await mutar(app, op, 'POST', `${API}/paletes/${p2.id}/conteudos`, { sender: 'Remetente Novo', documentType: 'NF', documentNumber: '000123' });
    expect(novo.statusCode, novo.body).toBeLessThan(300);
    const item = novo.json<{ items: { id: string; kind: string; version: number; documentNumber: string | null }[] }>().items.find((i) => i.kind === 'REGISTRADO' && i.documentNumber === '000123');
    const alt = await mutar(app, op, 'PUT', `${API}/paletes/${p2.id}/conteudos/${item?.id ?? ''}`, { sender: 'Remetente Novo', documentType: 'NF', documentNumber: '000123', delivery: '00DLV-9', expectedVersion: item?.version ?? 1 });
    expect(alt.statusCode, alt.body).toBe(200);
    await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: false });
    const { buffer } = await ultimaLocal(cfg, escopo);
    const linhas = linhasInv(buffer);
    const movidas = linhas.filter((l) => txt(l, COL['N° PALLET']) === '503');
    expect(movidas.map((l) => txt(l, COL.RUA))).toEqual(['13 - A121']);
    const parcial = linhas.filter((l) => txt(l, COL.NUMERO) === '0001001' && txt(l, COL['N° PALLET']) === '501');
    expect(parcial.map((l) => [txt(l, COL.VOLUMES), txt(l, COL.SITUAÇÃO)])).toEqual([['2', 'No palete · saída parcial de 1 volume(s)']]);
    const registrado = linhas.filter((l) => txt(l, COL.NUMERO) === '000123');
    expect(registrado.map((l) => [txt(l, COL.DELIVERY), txt(l, COL.VOLUMES)])).toEqual([['00DLV-9', 'Não informado']]);
    // Movimentações: um evento de movimento (antes → depois), a saída por volumes e o complemento.
    const mov2 = ler(buffer, ABA_MOVIMENTOS, LINHA_CABECALHO_MOVIMENTOS).linhas;
    const acao = (a: string) => mov2.filter((l) => txt(l, 1) === a);
    expect(acao('Movimentação do palete').map((l) => [txt(l, 2), txt(l, 5)])).toEqual([['503', destino.codigo]]);
    expect(acao('Saída (expedição de volumes)').map((l) => [txt(l, 2), txt(l, 3), txt(l, 5)])).toEqual([['501', 'NFD 0001001', '1 volume(s)']]);
    expect(acao('Identificação do conteúdo completada')).toHaveLength(1);
    const ids = mov2.map((l) => txt(l, 9));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Destino independente', () => {
  it('publica com confirmação, versões anteriores e manifesto; download da mesma revisão; demonstração nunca vai ao destino', async () => {
    const cfg = config(s3Destino());
    const r1 = await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true });
    expect(r1).toMatchObject({ situacao: 'CONCLUIDO', geracao: { revisao: 1 }, envio: { situacao: 'PUBLICADA', revisao: 1 } });
    const pre = `praca/${prefixoPlanilha(base(escopo))}`;
    const atual = s3.objetos.get(`${pre}${base(escopo)}.xlsx`);
    const manifesto = JSON.parse(s3.objetos.get(`${pre}${base(escopo)}.manifesto.json`)?.toString('utf8') ?? '{}') as { revisao: number; sha256: string; versao: string };
    const local = await ultimaLocal(cfg, escopo);
    expect(atual && sha(atual)).toBe(sha(local.buffer));
    expect(manifesto).toMatchObject({ revisao: 1, sha256: sha(local.buffer) });
    expect(s3.objetos.has(`praca/${manifesto.versao}`)).toBe(true);
    // Download pela API: o mesmo arquivo, com a revisão e a publicação.
    const a = await criarApp({ db, config: CONFIG_TESTE, interfaceDir: null, planilha: cfg });
    try {
      const s = await entrar(a, supervisor);
      const d = await como(a, s, { method: 'GET', url: `${API}/planilha/arquivo` });
      expect(d.statusCode).toBe(200);
      expect(sha(d.rawPayload)).toBe(sha(local.buffer));
      expect(d.headers['x-planilha-revisao']).toBe('1');
      expect(String(d.headers['x-planilha-publicada'])).toMatch(/^\d{4}-/);
      const st = SituacaoPlanilhaSchema.parse((await como(a, s, { method: 'GET', url: `${API}/planilha/situacao` })).json());
      expect(st.items.find((i) => i.resource === 'Planilha no destino independente')?.state).toBe('Atualizada');
      expect(st.items.find((i) => i.resource === 'Destino independente')?.state).toBe('Atualizada');
      expect(st.revisions).toMatchObject({ generated: 1, published: 1 });
      expect(JSON.stringify(st)).not.toContain(CREDENCIAIS_FALSAS.segredo);
    } finally {
      await a.close();
    }
    // Segunda revisão: a anterior continua em versoes/.
    await db.palete.updateMany({ where: { escopoId: escopo.id }, data: { observacoes: 'nova alteração' } });
    expect(await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true })).toMatchObject({ envio: { situacao: 'PUBLICADA', revisao: 2 } });
    const versoes = [...s3.objetos.keys()].filter((k) => k.startsWith(`${pre}versoes/`) && k.endsWith('.xlsx'));
    expect(versoes.map((k) => /-r(\d{6})-/.exec(k)?.[1])).toEqual(['000001', '000002']);
    // Demonstração: só local.
    const demo = await db.escopo.findFirstOrThrow({ where: { demonstracao: true }, select: { id: true } });
    expect(await processarEscopo(db, demo.id, cfg, { gerar: 'SEMPRE', motivo: 'MANUAL', enviar: true })).toMatchObject({ envio: { situacao: 'NAO_CONFIGURADO' } });
    expect([...s3.objetos.keys()].some((k) => k.includes('DEMO'))).toBe(false);
  });

  it('destino indisponível: estoque salvo continua salvo, a cópia anterior fica, o estado acusa a falha e a retentativa publica', async () => {
    const cfg = config(s3Destino());
    await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true });
    const pre = `praca/${prefixoPlanilha(base(escopo))}`;
    const anterior = sha(s3.objetos.get(`${pre}${base(escopo)}.xlsx`) ?? Buffer.alloc(0));
    s3.falhar = true;
    await db.palete.updateMany({ where: { escopoId: escopo.id, codigo: '501' }, data: { observacoes: 'alteração durante a falha' } });
    const r = await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true });
    expect(r).toMatchObject({ geracao: { situacao: 'GERADA', revisao: 2 }, envio: { situacao: 'FALHOU' } });
    expect((await db.palete.findFirstOrThrow({ where: { escopoId: escopo.id, codigo: '501' } })).observacoes).toBe('alteração durante a falha');
    s3.falhar = false;
    expect(sha(s3.objetos.get(`${pre}${base(escopo)}.xlsx`) ?? Buffer.alloc(0))).toBe(anterior);
    const c = await db.controlePlanilha.findUniqueOrThrow({ where: { escopoId: escopo.id } });
    expect([c.revisaoDados, c.revisaoPublicada, c.envioFalhas]).toEqual([2, 1, 1]);
    expect(c.envioProximaEm?.getTime()).toBeGreaterThan(Date.now());
    // Dentro da espera o trabalhador não insiste; "Tentar novamente agora" ignora a espera.
    expect((await escoposDevidos(db, cfg, new Date())).find((d) => d.escopoId === escopo.id)?.enviar ?? false).toBe(false);
    const a = await criarApp({ db, config: CONFIG_TESTE, interfaceDir: null, planilha: cfg });
    try {
      const s = await entrar(a, supervisor);
      const st = SituacaoPlanilhaSchema.parse((await como(a, s, { method: 'GET', url: `${API}/planilha/situacao` })).json());
      expect(st.items.find((i) => i.resource === 'Planilha no destino independente')?.state).toBe('Falhou');
      expect(st.failures.some((f) => f.stage === 'ENVIO' && f.message.includes('HTTP 503'))).toBe(true);
      const pub = ResultadoPublicacaoPlanilhaSchema.parse((await mutar(a, s, 'POST', `${API}/planilha/publicar`, {})).json());
      expect(pub).toMatchObject({ result: 'PUBLICADA', revision: 2 });
      expect(pub.situation.items.find((i) => i.resource === 'Planilha no destino independente')?.state).toBe('Atualizada');
    } finally {
      await a.close();
    }
    // Leitura adulterada no destino: a confirmação percebe e não registra sucesso.
    s3.adulterarLeitura = true;
    await db.palete.updateMany({ where: { escopoId: escopo.id, codigo: '501' }, data: { observacoes: 'outra alteração' } });
    const adulterado = await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true });
    expect(adulterado).toMatchObject({ envio: { situacao: 'FALHOU' } });
    if (adulterado.situacao === 'CONCLUIDO') expect(adulterado.envio?.erro).toMatch(/não confere/);
    expect(await db.envioExterno.count({ where: { escopoId: escopo.id, referencia: '3', situacao: 'CONFIRMADO' } })).toBe(0);
  });

  it('reinício e repetição: concessão vencida é retomada; a mesma revisão não gera envio duplicado; revisão antiga nunca sobrescreve a nova', async () => {
    const cfg = config(s3Destino(), { concessaoMs: 60_000 });
    await db.controlePlanilha.create({ data: { escopoId: escopo.id, publicandoDesde: new Date(), publicandoPor: 'processo-anterior' } });
    await db.geracaoPlanilha.create({ data: { id: randomUUID(), escopoId: escopo.id, situacao: 'GERANDO', motivo: 'ALTERACAO', iniciadoEm: new Date() } });
    expect(await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true })).toEqual({ situacao: 'OCUPADO' });
    await db.controlePlanilha.update({ where: { escopoId: escopo.id }, data: { publicandoDesde: new Date(Date.now() - 120_000) } });
    expect(await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true })).toMatchObject({ geracao: { revisao: 1 }, envio: { situacao: 'PUBLICADA' } });
    expect((await db.geracaoPlanilha.findFirstOrThrow({ where: { escopoId: escopo.id, situacao: 'FALHOU' } })).erro).toMatch(/Interrompido/);
    // Duas voltas ao mesmo tempo: uma trabalha, a outra encontra a concessão ocupada.
    await db.palete.updateMany({ where: { escopoId: escopo.id }, data: { observacoes: 'concorrência' } });
    const [x, y] = await Promise.all([processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true }), processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'MANUAL', enviar: true })]);
    expect([x.situacao, y.situacao].sort()).toEqual(['CONCLUIDO', 'OCUPADO']);
    // Repetir o envio da mesma revisão: nada novo no destino nem no registro.
    const pedidos = s3.pedidos.filter((p) => p.metodo === 'PUT').length;
    await db.controlePlanilha.update({ where: { escopoId: escopo.id }, data: { revisaoPublicada: 1 } });
    expect(await processarEscopo(db, escopo.id, cfg, { gerar: 'NAO', motivo: 'ALTERACAO', enviar: true })).toMatchObject({ envio: { situacao: 'EM_DIA', revisao: 2 } });
    expect(s3.pedidos.filter((p) => p.metodo === 'PUT').length).toBe(pedidos);
    expect(await db.envioExterno.count({ where: { escopoId: escopo.id, referencia: '2', situacao: 'CONFIRMADO' } })).toBe(1);
    // Destino com revisão mais nova (ex.: banco restaurado de backup): a antiga é recusada, a numeração passa dela e a próxima publica.
    const chave = `praca/${prefixoPlanilha(base(escopo))}${base(escopo)}.manifesto.json`;
    const m = JSON.parse(s3.objetos.get(chave)?.toString('utf8') ?? '{}') as Record<string, unknown>;
    s3.objetos.set(chave, Buffer.from(JSON.stringify({ ...m, revisao: 50 })));
    await db.palete.updateMany({ where: { escopoId: escopo.id }, data: { observacoes: 'depois da restauração' } });
    const antiga = await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true });
    expect(antiga).toMatchObject({ geracao: { revisao: 3 }, envio: { situacao: 'FALHOU' } });
    if (antiga.situacao === 'CONCLUIDO') expect(antiga.envio?.erro).toMatch(/revisão 50/);
    expect(JSON.parse(s3.objetos.get(chave)?.toString('utf8') ?? '{}')).toMatchObject({ revisao: 50 });
    const nova = await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true, ignorarEspera: true });
    expect(nova).toMatchObject({ geracao: { revisao: 51 }, envio: { situacao: 'PUBLICADA', revisao: 51 } });
  });

  it('retenção: últimas N, uma por dia e as anteriores a substituições; nunca a atual', async () => {
    const cfg = config(s3Destino(), { retencao: { ultimas: 3, diariasDias: 0, preSubstituicaoDias: 30 } });
    await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true });
    await processarEscopo(db, escopo.id, cfg, { gerar: 'SEMPRE', motivo: 'PRE_SUBSTITUICAO', enviar: true });
    for (let i = 0; i < 4; i += 1) await processarEscopo(db, escopo.id, cfg, { gerar: 'SEMPRE', motivo: 'MANUAL', enviar: true });
    const pre = `praca/${prefixoPlanilha(base(escopo))}versoes/`;
    const revisoes = [...s3.objetos.keys()].filter((k) => k.startsWith(pre) && k.endsWith('.xlsx')).map((k) => Number(/-r(\d{6})-/.exec(k)?.[1]));
    expect(revisoes.sort((a, b) => a - b)).toEqual([2, 4, 5, 6]);
    expect([...s3.objetos.keys()].some((k) => k.startsWith(pre) && k.includes('-r000002-') && k.includes('antes-da-substituicao'))).toBe(true);
    const locais = readdirSync(pastaVersoes(cfg, escopo.id)).map((n) => Number(/-r(\d{6})-/.exec(n)?.[1]));
    expect([...new Set(locais)].sort((a, b) => a - b)).toEqual([2, 4, 5, 6]);
  });
});

describe('Substituição do inventário', () => {
  it('protege antes de trocar (planilha e backup da base anterior), a anterior continua recuperável e só a base nova confirmada vai ao arquivo atual', async () => {
    const cfg = config(s3Destino());
    await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true });
    const autor = { usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` };
    const p = await protegerAntesDaSubstituicao(db, escopo.id, cfg, autor, 'INV-000001');
    expect(p).toMatchObject({ revisao: 2, planilhaPublicada: true, backupEnviado: true });
    const g = await db.geracaoPlanilha.findFirstOrThrow({ where: { escopoId: escopo.id, revisao: 2 } });
    expect([g.motivo, g.preSubstituicao]).toEqual(['PRE_SUBSTITUICAO', true]);
    expect(await db.registroProtecao.count({ where: { tipo: 'BACKUP', situacao: 'VERIFICADO', identificador: p.backupId } })).toBe(1);
    expect([...s3.objetos.keys()].some((k) => k.startsWith('praca/backups/') && k.endsWith('/concluido.json'))).toBe(true);
    // Importação que falha (transação desfeita): nenhuma marca, a planilha atual continua a da base anterior.
    const antes = await pendentes(escopo);
    await expect(
      db.$transaction(async (tx) => {
        await tx.vinculoDocumentoPalete.updateMany({ where: { escopoId: escopo.id }, data: { situacao: 'ENCERRADO', encerradoEm: new Date(), encerradoPorId: supervisor.id, motivoEncerramento: 'troca desfeita' } });
        throw new Error('importação falhou');
      }),
    ).rejects.toThrow('importação falhou');
    expect(await pendentes(escopo)).toBe(antes);
    // Troca confirmada: só a base nova no arquivo atual; a anterior em versoes/.
    const novas: LinhaTeste[] = [
      { linha: 3, tipo: 'NFD', numero: '0001001', delivery: '00D-001', remetente: 'Remetente A', endereco: '13 - A101', volumes: '3', numeroPlanilha: '501' },
      { linha: 4, tipo: 'NFD', numero: '0002002', delivery: 'D-NOVA', remetente: 'Remetente Novo', endereco: '13 - A113', volumes: '8', numeroPlanilha: '520' },
    ];
    const inv = await db.inventarioReferencia.findFirstOrThrow({ where: { escopoId: escopo.id, situacao: 'ATIVO' }, select: { codigo: true } });
    await executarCarga(db, escopo, autor, pacote(novas, 'v2'), { substitui: inv.codigo, descricao: 'Versão nova (fictícia)' }, new Date('2026-10-22T12:00:00Z'));
    const r = await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true });
    expect(r).toMatchObject({ geracao: { revisao: 3 }, envio: { situacao: 'PUBLICADA' } });
    const { buffer } = await ultimaLocal(cfg, escopo);
    const numeros = linhasInv(buffer)
      .filter((l) => txt(l, COL.SITUAÇÃO)?.startsWith('No palete'))
      .map((l) => txt(l, COL.NUMERO));
    expect(numeros).toContain('0002002');
    expect(numeros).not.toContain('0001002');
    expect(ler(buffer, ABA_PROTECAO, 2).linhas.find((l) => txt(l, 0) === 'Lote ativo')?.celulas[1]?.texto).toMatch(/^INV-000002/);
    const pre = `praca/${prefixoPlanilha(base(escopo))}versoes/`;
    const anterior = [...s3.objetos.keys()].find((k) => k.startsWith(pre) && k.includes('-r000002-') && k.endsWith('-antes-da-substituicao.xlsx'));
    expect(anterior).toBeDefined();
    const numerosAnteriores = linhasInv(s3.objetos.get(anterior ?? '') ?? Buffer.alloc(0)).map((l) => txt(l, COL.NUMERO));
    expect(numerosAnteriores).toContain('0001002');
    // Movimentações: a importação é um evento; nenhuma movimentação física fictícia por registro.
    const mov = ler(buffer, ABA_MOVIMENTOS, LINHA_CABECALHO_MOVIMENTOS).linhas;
    expect(mov.filter((l) => txt(l, 1) === 'Inventário importado')).toHaveLength(2);
    expect(mov.filter((l) => txt(l, 1) === 'Movimentação do palete')).toHaveLength(0);
  });

  it('confirmação pela tela: proteção prévia antes da troca; sem backup possível, nada é substituído', async () => {
    const cfg = config(null, { backup: { ...PLANILHA_PADRAO.backup, variavelBanco: 'VARIAVEL_INEXISTENTE_TESTE', pastaLocal: temporaria('praca-backups-'), raiz: RAIZ_REPOSITORIO } });
    const autor = { usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` };
    await expect(protegerAntesDaSubstituicao(db, escopo.id, cfg, autor, 'INV-000001')).rejects.toMatchObject({ codigo: 'PROTECAO_PREVIA_FALHOU' });
    expect(await db.inventarioReferencia.count({ where: { escopoId: escopo.id, situacao: 'ATIVO' } })).toBe(1);
  });
});

describe('Permissões', () => {
  it('supervisor e administrador baixam e reprocessam; operador só consulta; cliente não vê nada; revisão de outro escopo não é servida', async () => {
    const cfg = config(null);
    await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true });
    const a = await criarApp({ db, config: CONFIG_TESTE, interfaceDir: null, planilha: cfg });
    try {
      const s = await entrar(a, supervisor);
      const o = await entrar(a, await criarUsuario(db, 'operador.b', [[escopo.id, 'OPERADOR']]));
      const adm = await entrar(a, await criarUsuario(db, 'admin.planilha', [[escopo.id, 'ADMINISTRADOR']]));
      const cli = await entrar(a, await criarUsuario(db, 'cliente.planilha', [[escopo.id, 'CLIENTE_CONSULTA']]));
      const st = SituacaoPlanilhaSchema.parse((await como(a, o, { method: 'GET', url: `${API}/planilha/situacao` })).json());
      expect([st.canPublish, st.canDownload]).toEqual([false, false]);
      expect(st.items.find((i) => i.resource === 'Destino independente')?.state).toBe('Não configurado');
      expect(st.items.find((i) => i.resource === 'Teste de restauração')?.detail).toMatch(/Teste de restauração pendente/);
      expect((await mutar(a, o, 'POST', `${API}/planilha/publicar`, {})).statusCode).toBe(403);
      expect((await como(a, o, { method: 'GET', url: `${API}/planilha/arquivo` })).statusCode).toBe(403);
      for (const u of [s, adm]) {
        expect((await como(a, u, { method: 'GET', url: `${API}/planilha/arquivo` })).statusCode).toBe(200);
        expect((await como(a, u, { method: 'GET', url: `${API}/planilha/revisoes/1/arquivo` })).statusCode).toBe(200);
      }
      expect(ResultadoPublicacaoPlanilhaSchema.parse((await mutar(a, adm, 'POST', `${API}/planilha/publicar`, {})).json()).result).toBe('EM_DIA');
      for (const url of ['/planilha/situacao', '/planilha/arquivo', '/planilha/revisoes/1/arquivo']) expect((await como(a, cli, { method: 'GET', url: `${API}${url}` })).statusCode).toBe(403);
      expect((await mutar(a, cli, 'POST', `${API}/planilha/publicar`, {})).statusCode).toBe(403);
      // Supervisor no escopo B: a revisão 1 do escopo A não é servida.
      const b = await entrar(a, await criarUsuario(db, 'supervisor.b', [[outro.id, 'SUPERVISOR_ESTOQUE']]));
      expect((await como(a, b, { method: 'GET', url: `${API}/planilha/revisoes/1/arquivo` })).statusCode).toBe(404);
    } finally {
      await a.close();
    }
  });
});

describe('Backup completo e restauração', () => {
  it('backup verificado vai ao destino com concluido.json; teste de restauração do backup externo em banco isolado registra o resultado verdadeiro e remove o banco', async () => {
    const cfg = config(s3Destino());
    const r = await processarBackups(db, cfg, { forcar: true, motivo: 'MANUAL' });
    expect(r.situacao, r.erro ?? '').toBe('OK');
    expect(r.enviados).toEqual([r.backupId]);
    const envio = await db.envioExterno.findFirstOrThrow({ where: { tipo: 'BACKUP', referencia: r.backupId ?? '' } });
    expect(envio.situacao).toBe('CONFIRMADO');
    // Repetir: nada a enviar de novo (idempotente).
    expect((await processarBackups(db, cfg, {})).enviados).toEqual([]);
    const teste = await testarRestauracao(db, cfg, { origem: 'EXTERNO' });
    expect(teste.aprovado, teste.mensagem).toBe(true);
    expect(teste).toMatchObject({ origem: 'EXTERNO', backupId: r.backupId });
    expect(teste.contagens?.vinculos_ativos).toBeGreaterThan(0);
    const reg = await db.registroProtecao.findFirstOrThrow({ where: { tipo: 'TESTE_RESTAURACAO' }, orderBy: { concluidoEm: 'desc' } });
    expect([reg.situacao, reg.dados, reg.identificador]).toEqual(['VERIFICADO', 'OPERACAO', r.backupId]);
    const bancos = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_database WHERE datname = ${teste.ambiente}`;
    expect(bancos[0]?.n).toBe(0);
    const a = await criarApp({ db, config: CONFIG_TESTE, interfaceDir: null, planilha: cfg });
    try {
      const st = SituacaoPlanilhaSchema.parse((await como(a, await entrar(a, supervisor), { method: 'GET', url: `${API}/planilha/situacao` })).json());
      expect(st.items.find((i) => i.resource === 'Backup completo externo')?.state).toBe('Atualizada');
      expect(st.items.find((i) => i.resource === 'Teste de restauração')?.state).toBe('Atualizada');
    } finally {
      await a.close();
    }
    // Teste com dados fictícios nunca aparece como proteção atual.
    await db.registroProtecao.create({ data: { id: randomUUID(), tipo: 'TESTE_RESTAURACAO', situacao: 'VERIFICADO', iniciadoEm: new Date(), concluidoEm: new Date(), ambiente: 'praca_reversa_ensaio_x', dados: 'FICTICIOS' } });
    const b = await criarApp({ db, config: CONFIG_TESTE, interfaceDir: null, planilha: cfg });
    try {
      const st = SituacaoPlanilhaSchema.parse((await como(b, await entrar(b, supervisor), { method: 'GET', url: `${API}/planilha/situacao` })).json());
      const t = st.items.find((i) => i.resource === 'Teste de restauração');
      expect(t?.state).toBe('Não configurado');
      expect(t?.detail).toMatch(/dados fictícios/);
    } finally {
      await b.close();
    }
  }, 120_000);

  it('pasta no disco do servidor não conta como destino independente', async () => {
    const pasta = temporaria('praca-pasta-local-');
    const d = new DestinoPasta(pasta, 'Pasta no disco do servidor', false, 'Pasta no disco deste servidor.');
    const cfg = config(d);
    expect(await processarEscopo(db, escopo.id, cfg, { gerar: 'SE_DEVIDO', motivo: 'ALTERACAO', enviar: true })).toMatchObject({ envio: { situacao: 'NAO_CONFIGURADO' } });
    expect(existsSync(join(pasta, 'planilha'))).toBe(false);
  });
});
