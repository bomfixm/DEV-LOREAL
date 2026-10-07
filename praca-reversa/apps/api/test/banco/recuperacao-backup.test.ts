import { ClaimDetalheSchema, ConferenciaDetalheSchema, PaleteDetalheSchema, ResultadoOperacaoSchema, type ConfirmarExpedicao, type ReservaDetalhe } from '@praca-reversa/contracts';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { criarBanco, type Banco } from '../../src/db/cliente.js';
import { CONFIG_TESTE, ID_ESCOPO_NAVEGACAO, ID_ESCOPO_PRACA, URL_TESTE, bancoDeTeste, chave, como, criarUsuario, entrar, mutar, type SessaoTeste, type UsuarioTeste } from './apoio.js';
import { API, claimFalta, criarClaim, criarPalete, montarAmbiente, recuperar, segmentoDe, type Ambiente } from './claims-apoio.js';
import { corpoExpedicao, expedir, janelaConfirmada, materialLiberado, paleteComSaldo, pecas, reservarOk } from './janelas-apoio.js';

/**
 * Etapa 09 — ensaio de backup e restauração (T31), com PostgreSQL real e
 * dados fictícios: fixtures pelo fluxo da API, fotografia de controle,
 * backup coerente, restauração em banco NOVO, comparação, aplicação apontada
 * para o banco restaurado (autenticação, documentos, permissões, sessões
 * antigas, idempotência sem nova baixa) e falhas que não podem virar sucesso.
 */
const executar = promisify(execFile);
const RAIZ = resolve(import.meta.dirname, '..', '..', '..', '..');
const SCRIPTS = resolve(RAIZ, 'scripts', 'recuperacao');
const DESTINO = `praca_reversa_restauracao_ensaio_${Date.now().toString(36)}`;
const db = bancoDeTeste();
let a: Ambiente;
let usuario: UsuarioTeste;
let pastaBackups: string;
let backup: string;
let urlRestaurada: string;
let dbRestaurado: Banco | null = null;
const duracoes: Record<string, number> = {};
/** Etapas concluídas com sucesso (o registro final só diz "APROVADO" com todas). */
const etapasAprovadas = new Set<string>();

interface Fixtures {
  paleteId: string;
  segmentoId: string;
  reserva: ReservaDetalhe;
  corpoExpedicao: ConfirmarExpedicao;
  chaveExpedicao: string;
  conferenciaId: string;
  anexoConferenciaId: string;
  anexoConferenciaSha: string;
  claimId: string;
  sessaoAntiga: SessaoTeste;
}
let f: Fixtures;

function rodar(script: string, args: string[]) {
  return executar(process.execPath, [join(SCRIPTS, script), ...args], { cwd: RAIZ, env: process.env, maxBuffer: 10 * 1_048_576 });
}

async function falhaDe(script: string, args: string[]): Promise<{ codigo: number; saida: string }> {
  try {
    await rodar(script, args);
    return { codigo: 0, saida: '' };
  } catch (erro) {
    const e = erro as { code?: number; stderr?: string; stdout?: string };
    return { codigo: e.code ?? -1, saida: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function jpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1_500)]);
}

async function bancoExiste(nome: string): Promise<boolean> {
  const cliente = new pg.Client({ connectionString: URL_TESTE.replace(/\/[^/?]+(\?|$)/, '/postgres$1') });
  await cliente.connect();
  try {
    return (await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [nome])).rowCount === 1;
  } finally {
    await cliente.end();
  }
}

/** Fotografia de controle: o que precisa voltar igual (consultas só de leitura). */
async function fotografia(cliente: pg.Client) {
  const consultas: Record<string, string> = {
    paletes: `SELECT id, codigo, estado_conferencia, estado_liberacao, estado_fluxo, versao, posicao_id FROM palete ORDER BY id`,
    segmentos: `SELECT id, produto_id, lote, origem_tipo, origem_referencia, condicao FROM segmento_estoque ORDER BY id`,
    saldos: `SELECT palete_id, segmento_id, quantidade::text, quantidade_reservada::text, quantidade_liberada::text, quantidade_vinculada::text, versao FROM saldo_estoque ORDER BY 1, 2`,
    eventos: `SELECT id, tipo, palete_id, expedicao_id, evento_anterior_id FROM evento_estoque ORDER BY id`,
    movimentos: `SELECT * FROM evento_localizacao ORDER BY id`,
    reservas: `SELECT id, situacao, versao FROM reserva_janela ORDER BY id`,
    expedicoes: `SELECT id, reserva_id, codigo FROM expedicao ORDER BY id`,
    claims: `SELECT id, codigo, situacao, versao FROM claim ORDER BY id`,
    recuperacoes: `SELECT id, situacao, quantidade::text FROM recuperacao_claim ORDER BY id`,
    anexos: `SELECT 'conferencia' AS t, id, conferencia_id AS dono, encode(sha256(conteudo), 'hex') AS h FROM anexo_conferencia
             UNION ALL SELECT 'claim', id, claim_id, encode(sha256(conteudo), 'hex') FROM anexo_claim
             UNION ALL SELECT 'janela', id, janela_id, encode(sha256(conteudo), 'hex') FROM anexo_janela ORDER BY 1, 2`,
    idempotencia: `SELECT escopo_id, usuario_id, operacao, chave, payload_hash, status_http FROM registro_idempotencia ORDER BY chave, operacao`,
    auditoria: `SELECT count(*)::int AS n FROM evento_auditoria`,
  };
  const resultado: Record<string, unknown[]> = {};
  for (const [nome, sql] of Object.entries(consultas)) {
    try {
      resultado[nome] = (await cliente.query(sql)).rows;
    } catch (erro) {
      throw new Error(`fotografia ${nome}: ${(erro as Error).message}`, { cause: erro });
    }
  }
  return resultado;
}

async function comCliente<T>(url: string, fazer: (c: pg.Client) => Promise<T>): Promise<T> {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    return await fazer(cliente);
  } finally {
    await cliente.end();
  }
}

beforeAll(async () => {
  a = await montarAmbiente(db);
  usuario = await criarUsuario(db, 'ensaio.supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]);
  pastaBackups = mkdtempSync(join(tmpdir(), 'praca-backups-'));
  urlRestaurada = URL_TESTE.replace(/\/[^/?]+(\?|$)/, `/${DESTINO}$1`);
}, 120_000);

afterAll(async () => {
  await dbRestaurado?.$disconnect();
  await a.app.close();
  await db.$disconnect();
  await comCliente(URL_TESTE.replace(/\/[^/?]+(\?|$)/, '/postgres$1'), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${DESTINO}" WITH (FORCE)`);
  });
  rmSync(pastaBackups, { recursive: true, force: true });
});

describe('ensaio de backup e restauração', () => {
  it('fixtures: conferência/reconciliação, movimento, claim com evidência, reserva e expedição, anexos e idempotência', async () => {
    const inicio = Date.now();
    // Reconciliação + movimento.
    const pMov = await paleteComSaldo(a, [{ sku: 'SKU-ENS-01', quantity: '7', lot: 'L-ENS-1', ref: 'DEV-ENS-1' }]);
    const livre = await db.$queryRaw<{ id: string; codigo: string }[]>`
      SELECT pos.id::text, pos.codigo FROM posicao pos JOIN layout l ON l.id = pos.layout_id
       WHERE pos.escopo_id = ${ID_ESCOPO_PRACA}::uuid AND l.ativo AND pos.disponivel AND pos.retirada_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM palete p WHERE p.posicao_id = pos.id) ORDER BY pos.codigo LIMIT 1`;
    const destino = livre[0];
    if (!destino) throw new Error('sem posição livre');
    const movido = await mutar(a.app, a.op, 'POST', `${API}/paletes/${pMov.id}/movimentos`, {
      destinationPositionId: destino.id,
      confirmedPositionCode: destino.codigo,
      expectedVersion: pMov.version,
      reason: 'Reorganização do ensaio (fictícia)',
    });
    expect(movido.statusCode, movido.body).toBe(200);

    // Claim com evidência de material conferido, validação e anexo.
    const pClaim = await paleteComSaldo(a, [{ sku: 'SKU-ENS-02', quantity: '4', lot: 'L-ENS-2', ref: 'DEV-ENS-2' }]);
    const claim = await criarClaim(a, claimFalta('SKU-ENS-02', {}, { quantity: '2', lot: 'L-ENS-2', originReference: 'DEV-ENS-2' }));
    const linha = claim.lines[0];
    if (!linha) throw new Error('claim sem linha');
    const recuperado = await recuperar(a, claim.id, linha.id, pClaim.id, segmentoDe(pClaim, 'SKU-ENS-02'), '2');
    expect(recuperado.recoveries.length).toBeGreaterThan(0);
    const anexoClaim = await como(a.app, a.analista, {
      method: 'POST',
      url: `${API}/claims/${claim.id}/anexos`,
      payload: jpeg(),
      headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': 'evidencia-claim.jpg', 'idempotency-key': chave() },
    });
    expect(anexoClaim.statusCode, anexoClaim.body).toBe(200);

    // Reserva e expedição (baixa única) com chave guardada; anexo da janela.
    const { p, seg } = await materialLiberado(a, 'SKU-ENS-03', '6');
    const j = await janelaConfirmada(a, [pecas('100')]);
    const anexoJanela = await como(a.app, a.sup, {
      method: 'POST',
      url: `${API}/janelas/${j.id}/anexos`,
      payload: jpeg(),
      headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': 'autorizacao.jpg', 'idempotency-key': chave() },
    });
    expect([200, 201]).toContain(anexoJanela.statusCode);
    const reserva = await reservarOk(a, j, [{ p, seg, q: '6' }]);
    const corpo = await corpoExpedicao(a, reserva);
    const k = chave();
    // Expedição pelo usuário do ensaio (senha conhecida): o mesmo pedido será repetido na restauração.
    const sessaoEnsaio = await entrar(a.app, usuario);
    const expedida = await expedir(a, reserva, corpo, sessaoEnsaio, k);
    expect(expedida.statusCode, expedida.body).toBe(200);

    // Conferência em andamento com foto.
    const pConf = await criarPalete(a);
    const inicioConf = await mutar(a.app, a.op, 'POST', `${API}/paletes/${pConf.id}/conferencias`, { scope: 'COMPLETA', scopeDescription: null, expectedVersion: pConf.version });
    expect(inicioConf.statusCode, inicioConf.body).toBe(201);
    const conferencia = ConferenciaDetalheSchema.parse(inicioConf.json());
    const foto = jpeg();
    const anexo = await como(a.app, a.op, {
      method: 'POST',
      url: `${API}/conferencias/${conferencia.id}/anexos`,
      payload: foto,
      headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': 'palete.jpg', 'idempotency-key': chave() },
    });
    expect(anexo.statusCode, anexo.body).toBe(201);

    f = {
      paleteId: p.id,
      segmentoId: seg,
      reserva,
      corpoExpedicao: corpo,
      chaveExpedicao: k,
      conferenciaId: conferencia.id,
      anexoConferenciaId: (anexo.json<{ id: string }>()).id,
      anexoConferenciaSha: createHash('sha256').update(foto).digest('hex'),
      claimId: claim.id,
      sessaoAntiga: sessaoEnsaio,
    };
    duracoes.fixturesMs = Date.now() - inicio;
    etapasAprovadas.add('fixtures');
  }, 180_000);

  it('backup coerente e restauração em banco novo com comparação completa', async () => {
    const controle = await comCliente(URL_TESTE, fotografia);
    const t0 = Date.now();
    const criado = await rodar('criar-backup.mjs', ['--origem=DATABASE_URL_TESTE', `--destino=${pastaBackups}`]);
    duracoes.backupMs = Date.now() - t0;
    expect(criado.stdout).toMatch(/Backup concluído/);
    expect(criado.stdout + criado.stderr).not.toMatch(/postgres(ql)?:\/\/[^@\s]*:[^@\s]*@/);
    const [nome] = readdirSync(pastaBackups).filter((n) => n.startsWith('praca-reversa-backup-'));
    if (!nome) throw new Error('backup não criado');
    backup = join(pastaBackups, nome);
    const manifesto = JSON.parse(readFileSync(join(backup, 'manifesto.json'), 'utf8')) as { anexos: { total: number }; tabelas: unknown[] };
    expect(manifesto.anexos.total).toBe(3);
    // Nenhum segredo no manifesto nem na configuração copiada.
    const textoManifesto = readFileSync(join(backup, 'manifesto.json'), 'utf8') + readFileSync(join(backup, 'configuracao.json'), 'utf8');
    expect(textoManifesto).not.toContain(CONFIG_TESTE.appSegredo);
    expect(textoManifesto).not.toMatch(/postgres(ql)?:\/\//);
    expect(textoManifesto).not.toContain(usuario.senha);

    const relatorio = join(pastaBackups, 'relatorio.json');
    const t1 = Date.now();
    const restaurado = await rodar('restaurar-backup.mjs', [`--backup=${backup}`, `--destino=${DESTINO}`, '--servidor=DATABASE_URL_TESTE', `--relatorio=${relatorio}`]);
    duracoes.restauracaoMs = Date.now() - t1;
    expect(restaurado.stdout).toMatch(/Restauração APROVADA/);
    const r = JSON.parse(readFileSync(relatorio, 'utf8')) as { resultado: string; falhas: string[]; anexos: { total: number }; sessoesRevogadas: number };
    expect(r.resultado).toBe('APROVADA');
    expect(r.falhas).toEqual([]);
    expect(r.anexos.total).toBe(3);
    expect(r.sessoesRevogadas).toBeGreaterThan(0);

    // Comparação independente: IDs, origem/lote/condição, saldos, reservas, eventos, casos, valores, saídas e vínculos de anexos.
    const restauradoFoto = await comCliente(urlRestaurada, fotografia);
    expect(restauradoFoto).toEqual(controle);
    etapasAprovadas.add('restauracao');
  }, 300_000);

  it('aplicação apontada para a restauração: sessões antigas inválidas, login, documentos, permissões e idempotência sem nova baixa', async () => {
    dbRestaurado = criarBanco(urlRestaurada, () => undefined);
    const app = await criarApp({ db: dbRestaurado, config: CONFIG_TESTE, interfaceDir: null });
    try {
      // Sessão emitida antes do backup não vale no ambiente restaurado.
      const antiga = await como(app, f.sessaoAntiga, { method: 'GET', url: `${API}/sessao` });
      expect(antiga.statusCode).toBe(401);
      const s = await entrar(app, usuario);
      const palete = PaleteDetalheSchema.parse((await como(app, s, { method: 'GET', url: `${API}/paletes/${f.paleteId}` })).json());
      expect(palete.currentItems ?? []).toEqual([]);
      const conferencia = ConferenciaDetalheSchema.parse((await como(app, s, { method: 'GET', url: `${API}/conferencias/${f.conferenciaId}` })).json());
      expect(conferencia.attachments.map((x) => x.id)).toEqual([f.anexoConferenciaId]);
      const baixado = await como(app, s, { method: 'GET', url: `${API}/conferencias/${f.conferenciaId}/anexos/${f.anexoConferenciaId}` });
      expect(baixado.statusCode).toBe(200);
      expect(createHash('sha256').update(baixado.rawPayload).digest('hex')).toBe(f.anexoConferenciaSha);
      const claim = ClaimDetalheSchema.parse((await como(app, s, { method: 'GET', url: `${API}/claims/${f.claimId}` })).json());
      expect(claim.id).toBe(f.claimId);

      // Outro escopo continua sem acesso ao anexo restaurado (T28 depois da restauração).
      const fora = await criarUsuario(dbRestaurado, 'ensaio.outro', [[ID_ESCOPO_NAVEGACAO, 'SUPERVISOR_ESTOQUE']]);
      const sf = await entrar(app, fora);
      expect((await como(app, sf, { method: 'GET', url: `${API}/conferencias/${f.conferenciaId}/anexos/${f.anexoConferenciaId}` })).statusCode).toBe(404);

      // O pedido já registrado continua registrado e não gera outra baixa ao consultar/repetir.
      const eventosAntes = await dbRestaurado.eventoEstoque.count({ where: { tipo: 'EXPEDICAO' } });
      const saldoAntes = await dbRestaurado.saldoEstoque.findMany({ where: { paleteId: f.paleteId } });
      const consulta = ResultadoOperacaoSchema.parse((await como(app, s, { method: 'GET', url: `${API}/operacoes/${f.chaveExpedicao}` })).json());
      expect(consulta.state).toBe('REGISTRADA');
      const repetida = await mutar(app, s, 'POST', `${API}/reservas/${f.reserva.id}/expedicao`, f.corpoExpedicao, f.chaveExpedicao);
      expect(repetida.statusCode, repetida.body).toBe(200);
      expect(repetida.headers['idempotency-replayed']).toBe('true');
      // Outra chave para a mesma reserva: expedição única, recusada.
      const outra = await mutar(app, s, 'POST', `${API}/reservas/${f.reserva.id}/expedicao`, f.corpoExpedicao);
      expect(outra.statusCode).toBeGreaterThanOrEqual(400);
      expect(await dbRestaurado.eventoEstoque.count({ where: { tipo: 'EXPEDICAO' } })).toBe(eventosAntes);
      expect(await dbRestaurado.saldoEstoque.findMany({ where: { paleteId: f.paleteId } })).toEqual(saldoAntes);
      etapasAprovadas.add('aplicacao');
    } finally {
      await app.close();
    }
  }, 120_000);

  it('falhas não viram sucesso: arquivo corrompido, anexo ausente, destino impróprio, migrações diferentes e origem inacessível', async () => {
    // Arquivo corrompido: nada é criado.
    const corrompido = `${backup}-corrompido`;
    cpSync(backup, corrompido, { recursive: true });
    const arquivoDados = readdirSync(join(corrompido, 'dados')).find((n) => n.includes('saldo_estoque'));
    if (!arquivoDados) throw new Error('arquivo de saldo ausente');
    const caminho = join(corrompido, 'dados', arquivoDados);
    const bytes = readFileSync(caminho);
    bytes[bytes.length - 5] = (bytes[bytes.length - 5] ?? 0) ^ 0xff;
    writeFileSync(caminho, bytes);
    const r1 = await falhaDe('restaurar-backup.mjs', [`--backup=${corrompido}`, '--destino=praca_reversa_restauracao_corrompido', '--servidor=DATABASE_URL_TESTE']);
    expect(r1.codigo).not.toBe(0);
    expect(r1.saida).toMatch(/corrompido/);
    expect(await bancoExiste('praca_reversa_restauracao_corrompido')).toBe(false);

    // Conjunto incoerente: um anexo do inventário some dos dados (manifesto refeito de forma "consistente").
    const incompleto = `${backup}-incompleto`;
    cpSync(backup, incompleto, { recursive: true });
    const manifesto = JSON.parse(readFileSync(join(incompleto, 'manifesto.json'), 'utf8')) as {
      tabelas: { nome: string; arquivo: string | null; linhas: number; sha256Arquivo: string | null }[];
    };
    const tAnexo = manifesto.tabelas.find((t) => t.nome === 'anexo_janela');
    if (!tAnexo?.arquivo) throw new Error('tabela de anexos ausente');
    const gz = join(incompleto, tAnexo.arquivo);
    writeFileSync(gz, gzipSync(Buffer.from(gunzipSync(readFileSync(gz)).toString('utf8').split('\n').filter((l) => l !== '').slice(1).join('\n'))));
    tAnexo.linhas -= 1;
    tAnexo.sha256Arquivo = createHash('sha256').update(readFileSync(gz)).digest('hex');
    const texto = `${JSON.stringify(manifesto, null, 2)}\n`;
    writeFileSync(join(incompleto, 'manifesto.json'), texto);
    writeFileSync(join(incompleto, 'manifesto.sha256'), `${createHash('sha256').update(texto).digest('hex')}  manifesto.json\n`);
    const r2 = await falhaDe('restaurar-backup.mjs', [`--backup=${incompleto}`, '--destino=praca_reversa_restauracao_incompleto', '--servidor=DATABASE_URL_TESTE']);
    expect(r2.codigo).toBe(2);
    expect(r2.saida).toMatch(/REPROVADA/);
    expect(r2.saida).toMatch(/AUSENTE|anexo_janela/);
    expect(await bancoExiste('praca_reversa_restauracao_incompleto')).toBe(false);

    // Destinos impróprios: banco de trabalho, nome sem marca de restauração, banco já existente.
    const nomeTeste = new URL(URL_TESTE).pathname.slice(1);
    for (const destino of [nomeTeste, 'praca_reversa_copia', DESTINO]) {
      const r = await falhaDe('restaurar-backup.mjs', [`--backup=${backup}`, `--destino=${destino}`, '--servidor=DATABASE_URL_TESTE']);
      expect(r.codigo, destino).not.toBe(0);
      expect(r.saida, destino).toMatch(/Nada foi alterado|nada foi alterado|restauracao/);
    }
    expect(await bancoExiste(DESTINO)).toBe(true);

    // Migrações diferentes do código: recusado antes de criar o banco.
    const outraVersao = `${backup}-outra-versao`;
    cpSync(backup, outraVersao, { recursive: true });
    const m2 = JSON.parse(readFileSync(join(outraVersao, 'manifesto.json'), 'utf8')) as { migracoes: { nome: string; checksum: string }[] };
    m2.migracoes.push({ nome: '20991231000000_futura', checksum: 'f'.repeat(64) });
    const texto2 = `${JSON.stringify(m2, null, 2)}\n`;
    writeFileSync(join(outraVersao, 'manifesto.json'), texto2);
    writeFileSync(join(outraVersao, 'manifesto.sha256'), `${createHash('sha256').update(texto2).digest('hex')}  manifesto.json\n`);
    const r3 = await falhaDe('restaurar-backup.mjs', [`--backup=${outraVersao}`, '--destino=praca_reversa_restauracao_outra_versao', '--servidor=DATABASE_URL_TESTE']);
    expect(r3.codigo).not.toBe(0);
    expect(r3.saida).toMatch(/migrações/);
    expect(await bancoExiste('praca_reversa_restauracao_outra_versao')).toBe(false);

    // Origem inacessível: o backup falha e não deixa pasta parcial.
    const antes = readdirSync(pastaBackups).length;
    const url = new URL(URL_TESTE);
    url.port = '1';
    const r4 = await new Promise<{ codigo: number; saida: string }>((resolver) => {
      execFile(process.execPath, [join(SCRIPTS, 'criar-backup.mjs'), '--origem=URL_INACESSIVEL', `--destino=${pastaBackups}`], { cwd: RAIZ, env: { ...process.env, URL_INACESSIVEL: url.href } }, (erro, stdout, stderr) => {
        resolver({ codigo: erro ? ((erro as { code?: number }).code ?? -1) : 0, saida: stdout + stderr });
      });
    });
    expect(r4.codigo).not.toBe(0);
    expect(r4.saida).not.toContain(url.password);
    expect(readdirSync(pastaBackups).length).toBe(antes);

    // Backup na área versionada do repositório é recusado.
    const r5 = await falhaDe('criar-backup.mjs', ['--origem=DATABASE_URL_TESTE', '--destino=docs']);
    expect(r5.codigo).not.toBe(0);
    expect(existsSync(resolve(RAIZ, 'docs')) && readdirSync(resolve(RAIZ, 'docs')).some((n) => n.startsWith('praca-reversa-backup-'))).toBe(false);
    etapasAprovadas.add('falhas');
  }, 300_000);

  it('registra duração e resultado do ensaio (fora do repositório versionado)', () => {
    const pasta = resolve(RAIZ, '.dados', 'ensaios');
    mkdirSync(pasta, { recursive: true });
    writeFileSync(
      join(pasta, `recuperacao-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
      `${JSON.stringify({ ensaio: 'backup e restauração (etapa 09)', destino: DESTINO, duracoes, etapas: [...etapasAprovadas], resultado: etapasAprovadas.size === 4 ? 'APROVADO' : 'INCOMPLETO' }, null, 2)}\n`,
    );
    expect(duracoes.backupMs).toBeGreaterThan(0);
    expect(duracoes.restauracaoMs).toBeGreaterThan(0);
  });
});
