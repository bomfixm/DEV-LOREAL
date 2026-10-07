// Backup coerente do Praça Reversa (etapa 09): banco, anexos (bytea no mesmo
// banco) e configuração não secreta, num único snapshot REPEATABLE READ.
//
// Uso:
//   node scripts/recuperacao/criar-backup.mjs [--origem=DATABASE_URL] [--destino=.dados/backups] [--metodo=copia|pg_dump]
//
// --origem é o NOME da variável de ambiente com a URL (a URL e a senha nunca
// aparecem em argumentos, logs ou manifesto). --metodo=copia (padrão) exporta
// cada tabela como JSON por linha, em ordem da chave, compactado; pg_dump usa
// o pg_dump oficial (formato custom) no MESMO snapshot, quando instalado
// (PG_BIN ou PATH, versão >= servidor). O resultado vai para uma pasta nova
// (nunca sobrescreve) fora da área versionada; o nome final só aparece quando
// tudo terminou e foi conferido.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import {
  FORMATO,
  RAIZ,
  VERSAO_FORMATO,
  agoraCompacto,
  ambientePg,
  argumentos,
  binarioPg,
  carregarEnv,
  conectar,
  configuracaoNaoSecreta,
  descreverTabelas,
  executar,
  falhar,
  identificacao,
  inventarioAnexos,
  migracoesAplicadas,
  percorrerTabela,
  sequencias,
  sha256,
  sha256DoArquivo,
  urlDaVariavel,
} from './comum.mjs';

/** Pasta de destino: fora do repositório versionado (só .dados/, que é ignorado, é aceito dentro dele). */
function pastaDestino(valor) {
  const pasta = resolve(RAIZ, valor ?? '.dados/backups');
  const dentro = !relative(RAIZ, pasta).startsWith('..');
  const emDados = pasta === resolve(RAIZ, '.dados') || pasta.startsWith(resolve(RAIZ, '.dados') + sep);
  if (dentro && !emDados) falhar('Backups não podem ficar na área versionada do repositório (use .dados/ ou uma pasta externa protegida).');
  return pasta;
}

/** Tabela → JSON por linha compactado, com controle de vazão (a memória não cresce com o tamanho). */
async function exportarTabela(cliente, tabela, arquivo) {
  const gzip = createGzip({ level: 6 });
  const escrita = pipeline(gzip, createWriteStream(arquivo, { mode: 0o600 }));
  try {
    const resumo = await percorrerTabela(cliente, tabela, async (linha) => {
      if (!gzip.write(`${linha}\n`)) await once(gzip, 'drain');
    });
    gzip.end();
    await escrita;
    return resumo;
  } catch (erro) {
    gzip.destroy(erro);
    await escrita.catch(() => undefined);
    throw erro;
  }
}

async function principal() {
  carregarEnv();
  const args = argumentos();
  const variavel = typeof args.origem === 'string' ? args.origem : 'DATABASE_URL';
  const metodo = args.metodo === 'pg_dump' ? 'pg_dump' : args.metodo === undefined || args.metodo === 'copia' ? 'copia' : falhar('--metodo deve ser copia ou pg_dump.');
  const url = urlDaVariavel(variavel);
  const origem = identificacao(url);
  const destinoBase = pastaDestino(typeof args.destino === 'string' ? args.destino : undefined);
  const inicio = Date.now();
  const id = randomUUID();
  const nome = `praca-reversa-backup-${origem.banco}-${agoraCompacto()}-${id.slice(0, 8)}`;
  const final = join(destinoBase, nome);
  const parcial = `${final}.parcial`;
  if (existsSync(final)) falhar(`Destino já existe: ${final}`);
  let pgDump = null;
  if (metodo === 'pg_dump') {
    pgDump = binarioPg('pg_dump');
    if (!pgDump) falhar('pg_dump não encontrado (defina PG_BIN com a pasta das ferramentas cliente do PostgreSQL ou use --metodo=copia).');
  }

  console.log(`Backup ${id} de ${origem.host}:${origem.porta}/${origem.banco} (${variavel}), método ${metodo}…`);
  // Conecta antes de criar a pasta: origem inacessível não deixa nada para trás.
  const cliente = await conectar(url);
  let concluido = false;
  try {
    mkdirSync(join(parcial, 'dados'), { recursive: true });
    // Um único snapshot: todas as tabelas, inclusive anexos, do mesmo instante.
    await cliente.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: [info] } = await cliente.query(
      `SELECT version() AS versao, current_setting('server_version_num')::int AS numero, pg_export_snapshot() AS snapshot, now() AS instante`,
    );
    if (pgDump && pgDump.maior < Math.floor(info.numero / 10_000)) {
      falhar(`pg_dump ${pgDump.maior} é mais antigo que o servidor ${Math.floor(info.numero / 10_000)}: use as ferramentas da mesma versão ou mais nova.`);
    }
    const migracoes = await migracoesAplicadas(cliente);
    const anexos = await inventarioAnexos(cliente);
    if (anexos.problemas.length > 0) falhar(`Integridade dos anexos na origem reprovada: ${anexos.problemas.join('; ')}. Backup interrompido.`);
    const tabelas = await descreverTabelas(cliente);
    const resultado = [];
    let ordem = 0;
    for (const t of tabelas) {
      ordem += 1;
      if (metodo === 'copia') {
        const arquivo = join('dados', `${String(ordem).padStart(3, '0')}-${t.nome}.ndjson.gz`);
        const resumo = await exportarTabela(cliente, t, join(parcial, arquivo));
        resultado.push({ nome: t.nome, colunas: t.colunas, chave: t.chave, linhas: resumo.linhas, sha256Conteudo: resumo.sha256, arquivo: arquivo.split(sep).join('/'), sha256Arquivo: await sha256DoArquivo(join(parcial, arquivo)) });
      } else {
        const resumo = await percorrerTabela(cliente, t);
        resultado.push({ nome: t.nome, colunas: t.colunas, chave: t.chave, linhas: resumo.linhas, sha256Conteudo: resumo.sha256, arquivo: null, sha256Arquivo: null });
      }
    }
    const seqs = await sequencias(cliente);
    const extras = [];
    if (pgDump) {
      const dump = join(parcial, 'banco.dump');
      const r = spawnSync(pgDump.caminho, ['--format=custom', `--snapshot=${info.snapshot}`, '--no-owner', '--no-privileges', `--file=${dump}`], {
        env: ambientePg(url),
        encoding: 'utf8',
      });
      if (r.status !== 0) falhar(`pg_dump falhou (código ${String(r.status)}): ${(r.stderr ?? '').split('\n')[0]}`);
      extras.push({ arquivo: 'banco.dump', sha256: await sha256DoArquivo(dump) });
    }
    await cliente.query('COMMIT');

    const configuracao = configuracaoNaoSecreta();
    writeFileSync(join(parcial, 'configuracao.json'), `${JSON.stringify(configuracao, null, 2)}\n`, { mode: 0o600 });
    extras.push({ arquivo: 'configuracao.json', sha256: sha256(readFileSync(join(parcial, 'configuracao.json'))) });
    const pacote = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
    const manifesto = {
      formato: FORMATO,
      versaoFormato: VERSAO_FORMATO,
      id,
      criadoEm: new Date().toISOString(),
      instanteDoSnapshot: new Date(info.instante).toISOString(),
      duracaoMs: Date.now() - inicio,
      metodo,
      ferramenta: pgDump ? pgDump.texto : 'cópia lógica por snapshot (scripts/recuperacao)',
      aplicacao: { versao: pacote.version },
      banco: { servidor: info.versao, versaoNumerica: info.numero, origem, isolamento: 'REPEATABLE READ READ ONLY (snapshot único)' },
      migracoes,
      tabelas: resultado,
      sequencias: seqs,
      anexos: { total: anexos.total, bytes: anexos.bytes, itens: anexos.itens },
      arquivosExtras: extras,
      observacoes: [
        'Contém dados pessoais e hashes de senha: guarde em local protegido, nunca no repositório.',
        'Restaura o ponto do snapshot; alterações posteriores exigem apuração operacional.',
      ],
    };
    const texto = `${JSON.stringify(manifesto, null, 2)}\n`;
    writeFileSync(join(parcial, 'manifesto.json'), texto, { mode: 0o600 });
    writeFileSync(join(parcial, 'manifesto.sha256'), `${sha256(Buffer.from(texto, 'utf8'))}  manifesto.json\n`, { mode: 0o600 });
    renameSync(parcial, final);
    concluido = true;
    const linhas = resultado.reduce((s, t) => s + t.linhas, 0);
    console.log(`Backup concluído em ${String(manifesto.duracaoMs)} ms: ${final}`);
    console.log(`  ${String(resultado.length)} tabelas, ${String(linhas)} linhas, ${String(anexos.total)} anexo(s) (${String(anexos.bytes)} bytes), ${String(migracoes.length)} migrações.`);
  } finally {
    await cliente.query('ROLLBACK').catch(() => undefined);
    await cliente.end();
    if (!concluido) rmSync(parcial, { recursive: true, force: true });
  }
}

await executar(principal);
