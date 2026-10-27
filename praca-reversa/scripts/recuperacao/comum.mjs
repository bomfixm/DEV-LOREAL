// Backup e restauração do Praça Reversa (etapa 09) — partes comuns.
//
// Conjunto coerente: banco e anexos estão no mesmo PostgreSQL (anexos em
// bytea), então um único snapshot REPEATABLE READ cobre dados, relações e
// arquivos do mesmo instante. Nenhuma senha vai para argumentos, logs ou
// manifesto: as conexões vêm de variáveis de ambiente (nomeadas nos
// argumentos) e só host, porta e nome do banco são registrados.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

export const RAIZ = resolve(import.meta.dirname, '..', '..');
export const FORMATO = 'praca-reversa-backup';
export const VERSAO_FORMATO = 1;
/** Tabelas com conteúdo de arquivo (bytea "conteudo"), com a entidade dona e a coluna de hash quando existe. */
export const TABELAS_ANEXOS = [
  { tabela: 'anexo_conferencia', entidade: 'conferencia_id', hash: 'sha256' },
  { tabela: 'anexo_claim', entidade: 'claim_id', hash: 'sha256' },
  { tabela: 'anexo_janela', entidade: 'janela_id', hash: 'sha256' },
  { tabela: 'arquivo_importacao', entidade: 'lote_id', hash: null },
];
/** Variáveis de configuração NÃO secretas copiadas para o backup (as demais são só nomeadas). */
const CONFIG_PERMITIDA = /^(APP_AMBIENTE|APP_URL_PUBLICA|CAMINHO_BASE|PERSISTENCIA_LOCAL|HOST|PORT|LOG_LEVEL|COOKIE_SEGURO|SESSAO_[A-Z_]+|IMPORTACAO_[A-Z_]+|BUSCA_[A-Z_]+|CLAIMS_[A-Z_]+)$/;
const CONFIG_SECRETA = ['DATABASE_URL', 'APP_SEGREDO', 'PROTECAO_S3_CHAVE_ACESSO', 'PROTECAO_S3_SEGREDO'];

export function falhar(mensagem, codigo = 1) {
  const erro = new Error(mensagem);
  erro.codigoSaida = codigo;
  throw erro;
}

/** Carrega o .env da raiz sem sobrescrever o ambiente (mesma regra do Node). */
export function carregarEnv() {
  const arquivo = resolve(RAIZ, '.env');
  if (existsSync(arquivo)) process.loadEnvFile(arquivo);
}

export function argumentos(argv = process.argv.slice(2)) {
  const saida = {};
  for (const a of argv) {
    const m = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(a);
    if (!m) falhar(`Argumento não reconhecido: ${a}`);
    saida[m[1]] = m[2] ?? true;
  }
  return saida;
}

/** URL de conexão a partir do NOME de uma variável de ambiente (a URL nunca aparece em argumentos). */
export function urlDaVariavel(nome) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(nome)) falhar(`Nome de variável inválido: ${nome}`);
  const valor = process.env[nome];
  if (!valor) falhar(`${nome} não está definida (ambiente ou .env).`);
  let url;
  try {
    url = new URL(valor);
  } catch {
    falhar(`${nome} não é uma URL PostgreSQL válida.`);
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') falhar(`${nome} não é uma URL PostgreSQL.`);
  return url;
}

export function nomeBanco(url) {
  return decodeURIComponent(url.pathname.slice(1).split('/')[0] ?? '');
}

/** Identificação sem segredo: host, porta e banco. */
export function identificacao(url) {
  return { host: url.hostname, porta: Number(url.port || 5432), banco: nomeBanco(url) };
}

export function comBanco(url, banco) {
  const nova = new URL(url.href);
  nova.pathname = `/${banco}`;
  return nova;
}

export async function conectar(url) {
  const cliente = new pg.Client({ connectionString: url.href, application_name: 'praca-reversa-recuperacao' });
  await cliente.connect();
  // JSON e datas idênticos nos dois lados (o texto exportado entra no hash).
  await cliente.query("SET TIME ZONE 'UTC'");
  return cliente;
}

export function sha256(conteudo) {
  return createHash('sha256').update(conteudo).digest('hex');
}

/** SHA-256 de um arquivo lido por fluxo (backups grandes não cabem numa string). */
export async function sha256DoArquivo(caminho) {
  const hash = createHash('sha256');
  for await (const parte of createReadStream(caminho)) hash.update(parte);
  return hash.digest('hex');
}

export function aspas(nome) {
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) falhar(`Identificador inesperado: ${nome}`);
  return `"${nome}"`;
}

/** Tabelas do esquema public com colunas (sem geradas) e chave primária. */
export async function descreverTabelas(cliente) {
  const { rows: tabelas } = await cliente.query(
    `SELECT c.relname AS nome FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`,
  );
  const resultado = [];
  for (const { nome } of tabelas) {
    const { rows: colunas } = await cliente.query(
      `SELECT a.attname AS nome, format_type(a.atttypid, a.atttypmod) AS tipo
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
        ORDER BY a.attnum`,
      [nome],
    );
    const { rows: pk } = await cliente.query(
      `SELECT a.attname AS nome FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordem) ON true
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
        WHERE n.nspname = 'public' AND c.relname = $1 AND i.indisprimary ORDER BY k.ordem`,
      [nome],
    );
    resultado.push({ nome, colunas: colunas.map((c) => ({ nome: c.nome, tipo: c.tipo })), chave: pk.map((p) => p.nome) });
  }
  return resultado;
}

/** Consulta determinística: uma linha JSON por registro, na ordem da chave primária. */
export function consultaDaTabela(t) {
  const colunas = t.colunas.map((c) => aspas(c.nome)).join(', ');
  const ordem = t.chave.length > 0 ? t.chave.map(aspas).join(', ') : '1';
  // Apelido sem colisão possível com nomes de coluna (há colunas "x" e "y" no layout).
  const sufixo = t.chave.length > 0 ? '' : ' ORDER BY row_to_json(registro_exportado__)::text';
  return `SELECT row_to_json(registro_exportado__)::text AS linha FROM (SELECT ${colunas} FROM ${aspas(t.nome)} ORDER BY ${ordem}) registro_exportado__${sufixo}`;
}

/**
 * Percorre a tabela por cursor (dentro da transação/snapshot atual),
 * entregando cada linha JSON. Devolve contagem e SHA-256 do conteúdo.
 */
export async function percorrerTabela(cliente, t, aoLer) {
  const cursor = `c_${t.nome}`;
  await cliente.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${consultaDaTabela(t)}`);
  const hash = createHash('sha256');
  let linhas = 0;
  // Linhas com arquivo (bytea vira hexadecimal no JSON) vêm de poucas em poucas: memória limitada.
  const lote = t.colunas.some((c) => c.tipo === 'bytea') ? 8 : 500;
  for (;;) {
    const { rows } = await cliente.query(`FETCH ${String(lote)} FROM ${cursor}`);
    if (rows.length === 0) break;
    for (const { linha } of rows) {
      hash.update(linha);
      hash.update('\n');
      linhas += 1;
      if (aoLer) await aoLer(linha);
    }
  }
  await cliente.query(`CLOSE ${cursor}`);
  return { linhas, sha256: hash.digest('hex') };
}

export async function sequencias(cliente) {
  const { rows } = await cliente.query(`SELECT sequencename AS nome, last_value::text AS valor FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1`);
  return rows.map((r) => ({ nome: r.nome, valor: r.valor }));
}

/**
 * Inventário dos anexos no snapshot: hash recalculado do conteúdo, tamanho e
 * entidade. Hash gravado diferente do conteúdo reprova o conjunto.
 */
export async function inventarioAnexos(cliente) {
  const itens = [];
  const problemas = [];
  for (const a of TABELAS_ANEXOS) {
    const existe = await cliente.query(`SELECT to_regclass($1) IS NOT NULL AS existe`, [`public.${a.tabela}`]);
    if (!existe.rows[0].existe) continue;
    const id = a.tabela === 'arquivo_importacao' ? 'lote_id' : 'id';
    const hashGravado = a.hash ? `${aspas(a.hash)}` : 'NULL';
    const { rows } = await cliente.query(
      `SELECT ${aspas(id)}::text AS id, ${aspas(a.entidade)}::text AS entidade, octet_length(conteudo) AS tamanho,
              encode(sha256(conteudo), 'hex') AS calculado, ${hashGravado} AS gravado
         FROM ${aspas(a.tabela)} ORDER BY 1`,
    );
    for (const r of rows) {
      itens.push({ tabela: a.tabela, id: r.id, entidade: r.entidade, tamanho: Number(r.tamanho), sha256: r.calculado });
      if (r.gravado !== null && r.gravado !== r.calculado) problemas.push(`${a.tabela} ${r.id}: hash gravado diferente do conteúdo`);
    }
  }
  if (TABELAS_ANEXOS.some((a) => a.tabela === 'arquivo_importacao')) {
    const { rows } = await cliente.query(
      `SELECT a.lote_id::text AS id FROM arquivo_importacao a JOIN lote_importacao l ON l.id = a.lote_id
        WHERE l.hash_arquivo <> encode(sha256(a.conteudo), 'hex')`,
    ).catch(() => ({ rows: [] }));
    for (const r of rows) problemas.push(`arquivo_importacao ${r.id}: hash do lote diferente do conteúdo`);
  }
  return { itens, problemas, total: itens.length, bytes: itens.reduce((s, i) => s + i.tamanho, 0) };
}

/** Migrações aplicadas (nome e checksum) — a restauração exige o mesmo conjunto do código. */
export async function migracoesAplicadas(cliente) {
  const { rows } = await cliente.query(
    `SELECT migration_name AS nome, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  return rows;
}

/** Migrações do repositório (mesmo checksum que o Prisma grava: SHA-256 do arquivo). */
export function migracoesDoRepositorio() {
  const pasta = resolve(RAIZ, 'apps', 'api', 'prisma', 'migrations');
  return readdirSync(pasta, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((nome) => {
      const arquivo = resolve(pasta, nome, 'migration.sql');
      const conteudo = readFileSync(arquivo);
      return { nome, checksum: sha256(conteudo), arquivo };
    });
}

/** Chaves estrangeiras sem registro de destino (deve ser zero). */
export async function orfaos(cliente) {
  const { rows: fks } = await cliente.query(
    `SELECT con.conname AS nome, src.relname AS origem, dst.relname AS destino,
            array_agg(sa.attname::text ORDER BY k.ord) AS colunas_origem, array_agg(da.attname::text ORDER BY k.ord) AS colunas_destino
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid JOIN pg_class dst ON dst.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = src.relnamespace
       JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(sk, dk, ord) ON true
       JOIN pg_attribute sa ON sa.attrelid = src.oid AND sa.attnum = k.sk
       JOIN pg_attribute da ON da.attrelid = dst.oid AND da.attnum = k.dk
      WHERE con.contype = 'f' AND n.nspname = 'public'
      GROUP BY con.conname, src.relname, dst.relname ORDER BY 1`,
  );
  const problemas = [];
  for (const fk of fks) {
    const origem = fk.colunas_origem.map((c) => `o.${aspas(c)}`);
    const condicao = fk.colunas_origem.map((c, i) => `d.${aspas(fk.colunas_destino[i])} = o.${aspas(c)}`).join(' AND ');
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM ${aspas(fk.origem)} o WHERE ${origem.map((c) => `${c} IS NOT NULL`).join(' AND ')}
         AND NOT EXISTS (SELECT 1 FROM ${aspas(fk.destino)} d WHERE ${condicao})`,
    );
    if (rows[0].n > 0) problemas.push(`${fk.nome}: ${rows[0].n} registro(s) sem destino`);
  }
  return { verificadas: fks.length, problemas };
}

/** Regras de estoque e expedição que o dado restaurado precisa respeitar (amostra das invariantes). */
export async function invariantes(cliente) {
  const consultas = [
    ['saldo negativo ou reservado/liberado/vinculado acima do saldo', `SELECT count(*)::int AS n FROM saldo_estoque WHERE quantidade < 0 OR quantidade_reservada > quantidade OR quantidade_liberada > quantidade OR quantidade_vinculada > quantidade`],
    ['reservado diferente das linhas de reservas ativas', `SELECT count(*)::int AS n FROM saldo_estoque s WHERE s.quantidade_reservada <> COALESCE((SELECT sum(l.quantidade) FROM linha_reserva l JOIN reserva_janela r ON r.id = l.reserva_id WHERE l.palete_id = s.palete_id AND l.segmento_id = s.segmento_id AND r.situacao = 'ATIVA'), 0)`],
    ['mais de uma expedição por reserva', `SELECT count(*)::int AS n FROM (SELECT reserva_id FROM expedicao GROUP BY reserva_id HAVING count(*) > 1) x`],
    ['mais de uma baixa de expedição por palete na mesma expedição', `SELECT count(*)::int AS n FROM (SELECT expedicao_id, palete_id FROM evento_estoque WHERE expedicao_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) x`],
    ['chave de idempotência sem resposta concluída', `SELECT count(*)::int AS n FROM registro_idempotencia WHERE status_http = 0`],
  ];
  const resultado = [];
  for (const [regra, sql] of consultas) {
    try {
      const { rows } = await cliente.query(sql);
      resultado.push({ regra, violacoes: rows[0].n });
    } catch (erro) {
      resultado.push({ regra, violacoes: null, erro: erro.message.split('\n')[0] });
    }
  }
  return resultado;
}

/** Configuração não secreta; as secretas são só nomeadas (vêm do cofre do ambiente). */
export function configuracaoNaoSecreta() {
  const valores = {};
  for (const [nome, valor] of Object.entries(process.env).sort()) {
    if (CONFIG_PERMITIDA.test(nome) && valor !== undefined) valores[nome] = valor;
  }
  return {
    valores,
    segredosNecessarios: CONFIG_SECRETA,
    observacao:
      'APP_SEGREDO precisa ser o mesmo da origem para que repetições com a mesma chave de idempotência sejam reconhecidas; DATABASE_URL aponta para o banco restaurado. Nenhum segredo é copiado.',
  };
}

export function lerManifesto(pasta) {
  const caminho = resolve(pasta, 'manifesto.json');
  const caminhoHash = resolve(pasta, 'manifesto.sha256');
  if (!existsSync(caminho) || !existsSync(caminhoHash)) falhar(`Backup incompleto em ${pasta}: manifesto ausente.`);
  const bruto = readFileSync(caminho);
  const esperado = readFileSync(caminhoHash, 'utf8').trim().split(/\s+/)[0];
  if (sha256(bruto) !== esperado) falhar('Manifesto corrompido: o hash não confere. Nada foi restaurado.');
  let manifesto;
  try {
    manifesto = JSON.parse(bruto.toString('utf8'));
  } catch {
    falhar('Manifesto ilegível. Nada foi restaurado.');
  }
  if (manifesto.formato !== FORMATO || manifesto.versaoFormato !== VERSAO_FORMATO) falhar('Formato de backup desconhecido. Nada foi restaurado.');
  return manifesto;
}

/** Confere o hash de cada arquivo listado no manifesto antes de qualquer alteração. */
export async function conferirArquivos(pasta, manifesto) {
  const arquivos = [...manifesto.tabelas.filter((t) => t.arquivo).map((t) => ({ arquivo: t.arquivo, sha256: t.sha256Arquivo })), ...(manifesto.arquivosExtras ?? [])];
  for (const a of arquivos) {
    const caminho = resolve(pasta, a.arquivo);
    if (!existsSync(caminho)) falhar(`Arquivo do backup ausente: ${a.arquivo}. Nada foi restaurado.`);
    if ((await sha256DoArquivo(caminho)) !== a.sha256) falhar(`Arquivo do backup corrompido: ${a.arquivo}. Nada foi restaurado.`);
  }
  return arquivos.length;
}

export function agoraCompacto(data = new Date()) {
  return data.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
}

export async function executar(principal) {
  try {
    await principal();
  } catch (erro) {
    console.error(`ERRO: ${erro instanceof Error ? erro.message : String(erro)}`);
    process.exitCode = erro?.codigoSaida ?? 1;
  }
}

/** Ferramenta cliente oficial do PostgreSQL (PG_BIN ou PATH), com a versão maior. */
export function binarioPg(nome) {
  const pasta = process.env.PG_BIN;
  const caminho = pasta ? join(pasta, process.platform === 'win32' ? `${nome}.exe` : nome) : nome;
  const r = spawnSync(caminho, ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const versao = /(\d+)(?:\.(\d+))?/.exec(r.stdout);
  return { caminho, maior: versao ? Number(versao[1]) : 0, texto: r.stdout.trim() };
}

/** Variáveis de conexão para ferramentas oficiais (senha por ambiente, nunca por argumento). */
export function ambientePg(url) {
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: nomeBanco(url),
  };
}

