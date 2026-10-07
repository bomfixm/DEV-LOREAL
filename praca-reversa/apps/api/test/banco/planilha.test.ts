import { ResultadoPublicacaoPlanilhaSchema, SituacaoPlanilhaSchema, type Escopo } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import type { Banco } from '../../src/db/cliente.js';
import { lerTabela, type Tabela } from '../../src/modules/importacao/arquivo/ler.js';
import { executarCarga, lerPacote } from '../../src/modules/importacao/carga-lote.js';
import { criarLayoutDesenhoAprovado } from '../../src/modules/layout/aplicar-desenho.js';
import { moverPalete } from '../../src/modules/movimentos/servico.js';
import { nomeArquivoPlanilha } from '../../src/modules/planilha/montar.js';
import { escoposDevidos, publicarPlanilha } from '../../src/modules/planilha/publicacao.js';
import type { ConfigPlanilha } from '../../src/modules/planilha/situacao.js';
import { CONFIG_TESTE, ID_ESCOPO_PRACA, bancoDeTeste, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste, type UsuarioTeste } from './apoio.js';
import { bytesDoPacote, montarPacote, type LinhaTeste } from './pacote-carga.js';

/**
 * Planilha única contra PostgreSQL real: fila durável por gatilhos, snapshot
 * consistente, conteúdo do Inventário (vínculo por linha, misto, NFD em dois
 * paletes, desconhecidos em branco, sem alocação, Delivery como texto),
 * Movimentações sem repetição, isolamento entre escopos, publicações
 * concorrentes, destino indisponível, reinício, falha de leitura, arquivo
 * defeituoso, ordem das versões e retenção. Dados fictícios; pastas temporárias.
 */
const API = '/api/v1';
let db: Banco;
let pastas: string[] = [];
let escopoA: Escopo;
let escopoB: Escopo;
let supervisor: UsuarioTeste;

const LINHAS_A: LinhaTeste[] = [
  { linha: 3, tipo: 'NFD', numero: '0001001', delivery: '00D-001', remetente: 'Remetente A', endereco: '13 - A101', volumes: '3', marcador: '01\\02', numeroPlanilha: '501' },
  { linha: 4, tipo: 'NFD', numero: '0001002', delivery: 'D-002', remetente: 'Remetente B', endereco: '13 - A101', volumes: '2', numeroPlanilha: '501' },
  { linha: 5, tipo: 'NFD', numero: '0001001', delivery: '00D-001', remetente: 'Remetente A', endereco: '15 - A120', volumes: '1', marcador: '02\\02', numeroPlanilha: '502' },
  { linha: 6, tipo: 'NFD', numero: '0001004', remetente: '=HYPERLINK("http://x")', endereco: '15 - A122', volumes: '', numeroPlanilha: '503' },
  { linha: 7, tipo: 'MI', numero: '0001006', remetente: 'Remetente F', endereco: '15 - A124', volumes: '2', numeroPlanilha: '504' },
  { linha: 8, tipo: 'NFD', numero: '0001007', delivery: 'D-007', remetente: 'Remetente G', endereco: '15 - A126', livre: true, volumes: '5' },
  { linha: 9, remetente: 'Remetente H', endereco: '15 - A128', volumes: '6', numeroPlanilha: '505' },
];
const LINHAS_B: LinhaTeste[] = [{ linha: 3, tipo: 'NFD', numero: '9990001', delivery: 'D-B', remetente: 'Outro cliente', endereco: '11 - A1', volumes: '7', numeroPlanilha: '1' }];

function pacote(linhas: readonly LinhaTeste[]) {
  const r = lerPacote(bytesDoPacote(montarPacote(linhas)), 'dados-importacao.json');
  if (!r.ok) throw new Error(r.erros.join(' | '));
  return r.pacote;
}

function config(destino: boolean, extra: Partial<ConfigPlanilha> = {}): ConfigPlanilha {
  const local = mkdtempSync(join(tmpdir(), 'praca-planilha-local-'));
  const externo = mkdtempSync(join(tmpdir(), 'praca-planilha-destino-'));
  pastas.push(local, externo);
  return {
    automatica: true,
    destino: destino ? { tipo: 'PASTA', caminho: externo, descricao: 'Pasta de teste (fictícia)' } : null,
    pastaLocal: local,
    intervaloMs: 60_000,
    agruparMs: 0,
    reconciliarMs: 3_600_000,
    versoesManter: 60,
    eventosMax: 1_000,
    concessaoMs: 600_000,
    backup: { prazoHoras: 26, destinoDescricao: null, responsavel: null, restauracaoPrazoDias: 90 },
    ...extra,
  };
}

async function criarEscopo(codigo: string): Promise<Escopo> {
  const unidade = await db.unidade.create({ data: { id: randomUUID(), codigo: `UN-${codigo}`, nome: `Unidade ${codigo}`, demonstracao: false } });
  const cliente = await db.cliente.create({ data: { id: randomUUID(), codigo: `CLI-${codigo}`, nome: `Cliente ${codigo}`, demonstracao: false } });
  const e = await db.escopo.create({ data: { id: randomUUID(), unidadeId: unidade.id, clienteId: cliente.id, nome: `Praça ${codigo}`, demonstracao: false } });
  return { id: e.id, name: e.nome, unitCode: unidade.codigo, unitName: unidade.nome, clientCode: cliente.codigo, clientName: cliente.nome, demo: false };
}

const arquivo = (cfg: ConfigPlanilha, e: Escopo) => join(cfg.destino?.caminho ?? join(cfg.pastaLocal, e.id), nomeArquivoPlanilha(e.unitCode, e.clientCode));
const hash = (caminho: string) => createHash('sha256').update(readFileSync(caminho)).digest('hex');
const ler = (caminho: string, aba: string, cabecalho: number): Tabela =>
  lerTabela(readFileSync(caminho), 'XLSX', { sheet: aba, headerRow: cabecalho, encoding: null, delimiter: null }, {
    maxBytes: 50_000_000,
    maxRows: 10_000,
    maxColumns: 60,
    maxCellChars: 32_767,
    maxUncompressedBytes: 500_000_000,
    maxZipEntries: 60,
    maxProcessingMs: 60_000,
  });
const texto = (t: Tabela, linha: number, col: number) => t.linhas[linha]?.celulas[col]?.texto ?? null;
const pendentes = async (e: Escopo) => db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM alteracao_planilha WHERE escopo_id = ${e.id}::uuid`.then((r) => r[0]?.n ?? 0);

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  escopoA = await criarEscopo('PLAN-A');
  escopoB = await criarEscopo('PLAN-B');
  supervisor = await criarUsuario(db, 'supervisor.planilha', [
    [escopoA.id, 'SUPERVISOR_ESTOQUE'],
    [escopoB.id, 'SUPERVISOR_ESTOQUE'],
  ]);
  const autor = { usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` };
  await executarCarga(db, escopoA, autor, pacote(LINHAS_A), { substitui: null, descricao: null }, new Date('2026-10-06T12:00:00Z'));
  await executarCarga(db, escopoB, autor, pacote(LINHAS_B), { substitui: null, descricao: null }, new Date('2026-10-06T12:00:00Z'));
});

afterEach(() => {
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
  pastas = [];
});

afterAll(async () => {
  await db.$disconnect();
});

describe('Fila durável e conteúdo', () => {
  it('gatilhos marcam o escopo alterado na mesma transação (desfeita = sem marca) e a publicação apaga só o que incluiu', async () => {
    expect(await pendentes(escopoA)).toBeGreaterThan(0);
    const antesB = await pendentes(escopoB);
    const antesA = await pendentes(escopoA);
    await expect(
      db.$transaction(async (tx) => {
        await tx.palete.updateMany({ where: { escopoId: escopoA.id }, data: { observacoes: 'alteração desfeita' } });
        throw new Error('desfazer');
      }),
    ).rejects.toThrow('desfazer');
    expect(await pendentes(escopoA)).toBe(antesA);
    const cfg = config(true);
    const r = await publicarPlanilha(db, escopoA.id, cfg, { motivo: 'ALTERACAO' });
    expect(r.situacao).toBe('PUBLICADA');
    expect(await pendentes(escopoA)).toBe(0);
    expect(await pendentes(escopoB)).toBe(antesB);
    // Alteração confirmada depois: nova marca.
    await db.palete.updateMany({ where: { escopoId: escopoA.id }, data: { observacoes: 'alteração confirmada' } });
    expect(await pendentes(escopoA)).toBe(1);
  });

  it('Inventário: uma linha por vínculo, NFD em dois paletes com os próprios volumes, misto, desconhecidos em branco, sem alocação, Delivery e NFD como texto, escopos isolados', async () => {
    const cfg = config(true);
    expect((await publicarPlanilha(db, escopoA.id, cfg, { motivo: 'MANUAL' })).situacao).toBe('PUBLICADA');
    const inv = ler(arquivo(cfg, escopoA), 'Inventário', 10);
    const linhas = inv.linhas.filter((l) => l.numero > 10 && /^\d{2} - |^Sem alocação|^Localização/.test(l.celulas[1]?.texto ?? ''));
    const nfd = (n: string) => linhas.filter((l) => l.celulas[3]?.texto === n);
    // NFD 0001001 em dois paletes: duas linhas, cada uma com o seu volume (nada repetido nem somado).
    expect(nfd('0001001').map((l) => [l.celulas[1]?.texto, l.celulas[6]?.texto, l.celulas[11]?.texto])).toEqual([
      ['13 - A101', '3', '00D-001'],
      ['15 - A120', '1', '00D-001'],
    ]);
    expect(nfd('0001001').every((l) => l.celulas[3]?.tipo === 'TEXTO' && l.celulas[11]?.tipo === 'TEXTO')).toBe(true);
    expect(nfd('0001001').map((l) => l.celulas[8]?.texto)).toEqual(['Sim', 'Sim']);
    // Palete misto: as duas notas com o mesmo palete, "Não" em palete full.
    const misto = linhas.filter((l) => l.celulas[1]?.texto === '13 - A101');
    expect(misto).toHaveLength(2);
    expect(new Set(misto.map((l) => l.celulas[2]?.texto)).size).toBe(1);
    expect(misto.map((l) => l.celulas[7]?.texto)).toEqual(['Não', 'Não']);
    expect(nfd('0001001')[1]?.celulas[7]?.texto).toBe('Sim');
    // Volume desconhecido em branco (não zero); cidade e produto em branco; fórmula de origem continua texto.
    const desconhecido = nfd('0001004')[0];
    expect(desconhecido?.celulas[6]).toBeUndefined();
    expect(desconhecido?.celulas[5]).toBeUndefined();
    expect(desconhecido?.celulas[9]).toBeUndefined();
    expect(desconhecido?.celulas[4]?.texto).toBe('=HYPERLINK("http://x")');
    expect(desconhecido?.celulas[4]?.formula).toBe(false);
    // MI não aparece como NFD; palete só com conteúdo sem número aparece sem nota; endereço livre vira "Sem alocação".
    expect(linhas.find((l) => l.celulas[1]?.texto === '15 - A124')?.celulas[3]).toBeUndefined();
    expect(linhas.find((l) => l.celulas[1]?.texto === '15 - A124')?.celulas[10]?.texto).toContain('MI 0001006 (não é NFD)');
    expect(linhas.find((l) => l.celulas[1]?.texto === '15 - A128')?.celulas[10]?.texto).toContain('Palete sem nota informada');
    const semAlocacao = linhas.find((l) => l.celulas[1]?.texto === 'Sem alocação');
    expect(semAlocacao?.celulas[3]?.texto).toBe('0001007');
    expect(semAlocacao?.celulas[2]).toBeUndefined();
    expect(semAlocacao?.celulas[10]?.texto).toContain('endereço antigo 15 - A126 livre');
    // Isolamento: nada do outro escopo.
    expect(inv.linhas.some((l) => l.celulas.some((c) => c?.texto === '9990001'))).toBe(false);
    // Resumo: vínculos ≠ notas ≠ paletes; total parcial por volume desconhecido.
    const xml = readFileSync(arquivo(cfg, escopoA)).toString('latin1');
    expect(xml.length).toBeGreaterThan(0);
    const resumo = ler(arquivo(cfg, escopoA), 'Inventário', 7);
    expect(texto(resumo, 0, 1)).toBe('5');
    expect(resumo.linhas[1]?.celulas[1]?.texto ?? '').toMatch(/Total parcial: 1 vínculo/);
  });

  it('Movimentações: cada evento uma vez pelo ID; mover o palete misto gera uma linha, não uma por nota', async () => {
    const palete = await db.linhaInventario.findFirstOrThrow({ where: { escopoId: escopoA.id, enderecoCanonico: '13 - A101', aplicada: true }, select: { paleteId: true } });
    // Escopo sem layout: desenho aprovado pelo serviço existente, para haver posição de destino.
    await db.$transaction((tx) => criarLayoutDesenhoAprovado(tx, escopoA, { name: 'Praça de teste' }, { usuarioId: supervisor.id, requestId: 'teste' }, new Date()));
    const destino = await db.posicao.findFirstOrThrow({ where: { escopoId: escopoA.id, disponivel: true, desativada: false, retiradaEm: null, palete: null, layout: { ativo: true } }, select: { id: true, codigo: true } });
    const p = await db.palete.findUniqueOrThrow({ where: { id: palete.paleteId ?? '' }, select: { versao: true } });
    await db.$transaction((tx) =>
      moverPalete(tx, escopoA, palete.paleteId ?? '', { destinationPositionId: destino.id, confirmedPositionCode: destino.codigo, expectedVersion: p.versao, reason: 'Teste da planilha' }, { usuarioId: supervisor.id, requestId: 'teste' }, new Date()),
    );
    const cfg = config(false);
    expect((await publicarPlanilha(db, escopoA.id, cfg, { motivo: 'ALTERACAO' })).situacao).toBe('GERADA_LOCAL');
    const mov = ler(arquivo(cfg, escopoA), 'Movimentações', 9);
    const eventos = mov.linhas.filter((l) => l.numero > 9 && l.celulas[2]?.texto);
    const ids = eventos.map((l) => l.celulas[2]?.texto);
    expect(new Set(ids).size).toBe(ids.length);
    const movimentos = eventos.filter((l) => l.celulas[3]?.texto === 'Movimentação');
    expect(movimentos).toHaveLength(1);
    expect(movimentos[0]?.celulas[7]?.texto).toBe(destino.codigo);
    expect(movimentos[0]?.celulas[1]?.tipo).toBe('DATA');
  });
});

describe('Consistência da publicação', () => {
  it('publicações concorrentes: uma publica, a outra encontra a concessão ocupada; versões únicas', async () => {
    const cfg = config(true);
    const [a, b] = await Promise.all([publicarPlanilha(db, escopoA.id, cfg, { motivo: 'ALTERACAO' }), publicarPlanilha(db, escopoA.id, cfg, { motivo: 'MANUAL' })]);
    expect([a.situacao, b.situacao].sort()).toEqual(['OCUPADO', 'PUBLICADA']);
    const versoes = await db.publicacaoPlanilha.findMany({ where: { escopoId: escopoA.id }, select: { versao: true } });
    expect(versoes).toHaveLength(1);
  });

  it('destino indisponível, falha de leitura e arquivo defeituoso nunca substituem a última versão boa; nova tentativa com espera', async () => {
    const cfg = config(true);
    expect((await publicarPlanilha(db, escopoA.id, cfg, { motivo: 'ALTERACAO' })).situacao).toBe('PUBLICADA');
    const bom = hash(arquivo(cfg, escopoA));
    await db.palete.updateMany({ where: { escopoId: escopoA.id }, data: { observacoes: 'nova alteração' } });
    for (const simular of [{ falharDestino: true }, { falharLeitura: true }, { corromper: true }]) {
      await db.controlePlanilha.update({ where: { escopoId: escopoA.id }, data: { proximaTentativaEm: null } });
      const r = await publicarPlanilha(db, escopoA.id, cfg, { motivo: 'ALTERACAO', simular });
      expect(r.situacao).toBe('FALHOU');
      expect(hash(arquivo(cfg, escopoA))).toBe(bom);
      expect(await pendentes(escopoA)).toBeGreaterThan(0);
    }
    const controle = await db.controlePlanilha.findUniqueOrThrow({ where: { escopoId: escopoA.id } });
    expect(controle.falhasSeguidas).toBe(3);
    expect(controle.proximaTentativaEm?.getTime()).toBeGreaterThan(Date.now());
    expect((await escoposDevidos(db, cfg, new Date())).map((x) => x.escopoId)).not.toContain(escopoA.id);
    const situacao = await db.publicacaoPlanilha.findMany({ where: { escopoId: escopoA.id, situacao: 'FALHOU' }, select: { erro: true } });
    expect(situacao.map((s) => s.erro).join(' ')).toMatch(/Destino indisponível.*|Leitura do banco|Validação|não confere/);
    // Depois da espera: publica e zera as falhas.
    await db.controlePlanilha.update({ where: { escopoId: escopoA.id }, data: { proximaTentativaEm: null } });
    expect((await publicarPlanilha(db, escopoA.id, cfg, { motivo: 'ALTERACAO' })).situacao).toBe('PUBLICADA');
    expect((await db.controlePlanilha.findUniqueOrThrow({ where: { escopoId: escopoA.id } })).falhasSeguidas).toBe(0);
    expect(hash(arquivo(cfg, escopoA))).not.toBe(bom);
  });

  it('reinício: concessão vigente bloqueia; vencida é retomada e a tentativa interrompida fica registrada como falha', async () => {
    const cfg = config(true, { concessaoMs: 60_000 });
    await db.controlePlanilha.create({ data: { escopoId: escopoA.id, versaoAtual: 1, publicandoDesde: new Date(), publicandoPor: 'processo-anterior' } });
    await db.publicacaoPlanilha.create({ data: { id: randomUUID(), escopoId: escopoA.id, versao: 1, situacao: 'GERANDO', motivo: 'ALTERACAO', iniciadoEm: new Date() } });
    expect((await publicarPlanilha(db, escopoA.id, cfg, { motivo: 'ALTERACAO' })).situacao).toBe('OCUPADO');
    await db.controlePlanilha.update({ where: { escopoId: escopoA.id }, data: { publicandoDesde: new Date(Date.now() - 120_000) } });
    const r = await publicarPlanilha(db, escopoA.id, cfg, { motivo: 'RECONCILIACAO' });
    expect(r).toMatchObject({ situacao: 'PUBLICADA', versao: 2 });
    const interrompida = await db.publicacaoPlanilha.findFirstOrThrow({ where: { escopoId: escopoA.id, versao: 1 } });
    expect(interrompida.situacao).toBe('FALHOU');
    expect(interrompida.erro).toMatch(/Interrompida/);
  });

  it('ordem: destino com versão mais nova recusa a antiga e a numeração avança; versões anteriores preservadas com retenção', async () => {
    const cfg = config(true, { versoesManter: 3 });
    const base = nomeArquivoPlanilha(escopoA.unitCode, escopoA.clientCode).replace('.xlsx', '');
    writeFileSync(join(cfg.destino?.caminho ?? '', `${base}.versao.json`), JSON.stringify({ versao: 5, arquivo: 'x', instanteSnapshot: '', hash: '', copia: '' }));
    const antiga = await publicarPlanilha(db, escopoA.id, cfg, { motivo: 'ALTERACAO' });
    expect(antiga.situacao).toBe('FALHOU');
    expect(antiga.erro).toMatch(/versão 5/);
    expect(existsSync(arquivo(cfg, escopoA))).toBe(false);
    for (let i = 0; i < 4; i += 1) {
      await db.controlePlanilha.update({ where: { escopoId: escopoA.id }, data: { proximaTentativaEm: null } });
      expect((await publicarPlanilha(db, escopoA.id, cfg, { motivo: 'MANUAL' })).situacao).toBe('PUBLICADA');
    }
    const versoes = readdirSync(join(cfg.destino?.caminho ?? '', 'versoes')).sort();
    expect(versoes).toHaveLength(3);
    expect(versoes.map((v) => Number(/-v(\d+)-/.exec(v)?.[1]))).toEqual([7, 8, 9]);
    const ultima = await db.publicacaoPlanilha.findFirstOrThrow({ where: { escopoId: escopoA.id, situacao: 'PUBLICADA' }, orderBy: { versao: 'desc' } });
    expect(ultima.versao).toBe(9);
    expect(ultima.versaoAnteriorPreservada).toMatch(/-v000008-/);
  });

  it('escopo de demonstração nunca vai para o destino da operação (só geração local); escopo sem dados gera planilha vazia válida', async () => {
    const cfg = config(true);
    const demo = await publicarPlanilha(db, ID_ESCOPO_PRACA, cfg, { motivo: 'MANUAL' });
    expect(demo.situacao).toBe('GERADA_LOCAL');
    expect(readdirSync(cfg.destino?.caminho ?? '')).toHaveLength(0);
    const vazio = await criarEscopo('PLAN-VAZIO');
    const r = await publicarPlanilha(db, vazio.id, cfg, { motivo: 'MANUAL' });
    expect(r.situacao).toBe('PUBLICADA');
    const inv = ler(arquivo(cfg, vazio), 'Inventário', 10);
    expect(inv.linhas.some((l) => (l.celulas[1]?.texto ?? '').startsWith('Nenhum vínculo'))).toBe(true);
  });
});

describe('Tela e permissões', () => {
  let app: FastifyInstance;
  let cfg: ConfigPlanilha;
  let sup: SessaoTeste;

  beforeEach(async () => {
    cfg = config(false);
    app = await criarApp({ db, config: CONFIG_TESTE, interfaceDir: null, planilha: cfg });
    sup = await entrar(app, supervisor);
  });

  afterEach(async () => {
    await app.close();
  });

  it('situação honesta sem destino; tentar novamente e baixar com permissão; operador não publica; outro escopo não vê o arquivo', async () => {
    const r0 = await como(app, sup, { method: 'GET', url: `${API}/planilha/situacao` });
    expect(r0.statusCode, r0.body).toBe(200);
    const s0 = SituacaoPlanilhaSchema.parse(r0.json());
    expect(s0.items.find((i) => i.resource === 'Planilha no destino independente')?.state).toBe('Não configurado');
    expect(s0.items.find((i) => i.resource === 'Backup completo')?.state).toBe('Não configurado');
    expect(s0.items.find((i) => i.resource === 'Teste de restauração')?.state).toBe('Não testado');
    expect(s0.pending.count).toBeGreaterThan(0);
    const pub = await mutar(app, sup, 'POST', `${API}/planilha/publicar`, {});
    expect(pub.statusCode, pub.body).toBe(200);
    const resultado = ResultadoPublicacaoPlanilhaSchema.parse(pub.json());
    expect(resultado.result).toBe('GERADA_LOCAL');
    expect(resultado.situation.items[0]?.state).toBe('Não configurado');
    const baixar = await como(app, sup, { method: 'GET', url: `${API}/planilha/arquivo` });
    expect(baixar.statusCode).toBe(200);
    expect(baixar.headers['content-type']).toContain('spreadsheetml');
    expect(baixar.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
    const operador = await criarUsuario(db, 'operador.planilha', [[escopoA.id, 'OPERADOR']]);
    const op = await entrar(app, operador);
    expect((await mutar(app, op, 'POST', `${API}/planilha/publicar`, {})).statusCode).toBe(403);
    expect((await como(app, op, { method: 'GET', url: `${API}/planilha/arquivo` })).statusCode).toBe(403);
    // Escopo B (outra sessão no escopo B): não há arquivo dele, e o de A nunca é servido.
    const outro = await criarUsuario(db, 'supervisor.b', [[escopoB.id, 'SUPERVISOR_ESTOQUE']]);
    const sb = await entrar(app, outro);
    expect((await como(app, sb, { method: 'GET', url: `${API}/planilha/arquivo` })).statusCode).toBe(404);
  });
});
