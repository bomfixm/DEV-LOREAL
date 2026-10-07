// Restauração do Praça Reversa (etapa 09) SOMENTE em banco novo e isolado,
// com comparação completa contra o manifesto. Não existe botão de restauração
// na interface: é procedimento do responsável técnico.
//
// Uso:
//   node scripts/recuperacao/restaurar-backup.mjs --backup=<pasta> --destino=<banco_novo> [--servidor=DATABASE_URL] [--relatorio=<arquivo.json>] [--manter-em-falha]
//
// Proteções: o destino precisa ser um nome novo contendo "restauracao" ou
// "ensaio", diferente do banco de origem e de todos os bancos configurados
// (DATABASE_URL*); se já existir, nada é feito. Arquivo corrompido, manifesto
// adulterado, migrações diferentes do código ou erro de carga interrompem com
// código de saída diferente de zero; em falha depois de criado, o banco novo é
// removido (salvo --manter-em-falha). Sessões antigas são revogadas no banco
// restaurado; usuários e autoria do histórico são preservados.
import { spawnSync } from 'node:child_process';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import {
  RAIZ,
  ambientePg,
  argumentos,
  aspas,
  binarioPg,
  carregarEnv,
  comBanco,
  conectar,
  conferirArquivos,
  descreverTabelas,
  executar,
  falhar,
  identificacao,
  inventarioAnexos,
  invariantes,
  lerManifesto,
  migracoesAplicadas,
  migracoesDoRepositorio,
  nomeBanco,
  orfaos,
  percorrerTabela,
  urlDaVariavel,
} from './comum.mjs';

/** Tamanho aproximado de cada lote de inserção (texto JSON). */
const LOTE_BYTES = 4 * 1_048_576;

function conferirDestino(destino, manifesto, servidor) {
  if (typeof destino !== 'string' || !/^[a-z][a-z0-9_]{2,62}$/.test(destino)) {
    falhar('Informe --destino com o nome de um banco NOVO (minúsculas, números e _), por exemplo praca_reversa_restauracao_20261004.');
  }
  if (!/(restauracao|ensaio)/.test(destino)) falhar('O nome do banco de destino precisa conter "restauracao" ou "ensaio" (proteção contra digitar o banco de trabalho).');
  if (destino === manifesto.banco.origem.banco) falhar('O destino é o próprio banco de origem do backup. Nada foi alterado.');
  const configurados = Object.entries(process.env)
    .filter(([nome, valor]) => /^DATABASE_URL/.test(nome) && valor)
    .map(([nome, valor]) => {
      try {
        return [nome, nomeBanco(new URL(valor))];
      } catch {
        return [nome, ''];
      }
    });
  const conflito = configurados.find(([, banco]) => banco === destino);
  if (conflito) falhar(`O destino é o banco configurado em ${conflito[0]} (ambiente de trabalho). Nada foi alterado.`);
  if (process.env.APP_AMBIENTE === 'producao' && servidor === 'DATABASE_URL') {
    falhar('Em produção, restaure num servidor isolado: --servidor=<VARIAVEL> com a URL do ambiente de teste de recuperação (não a DATABASE_URL da operação).');
  }
}

function conferirMigracoes(manifesto) {
  const codigo = migracoesDoRepositorio().map(({ nome, checksum }) => `${nome}:${checksum}`);
  const backup = manifesto.migracoes.map(({ nome, checksum }) => `${nome}:${checksum}`);
  if (codigo.join('|') !== backup.join('|')) {
    const faltam = backup.filter((m) => !codigo.includes(m));
    const sobram = codigo.filter((m) => !backup.includes(m));
    falhar(
      `As migrações do backup não são as deste código (aplicação ${String(manifesto.aplicacao.versao)}). Use a versão do aplicativo do backup para restaurar. Só no backup: ${faltam.join(', ') || '—'}; só no código: ${sobram.join(', ') || '—'}.`,
    );
  }
}

/** Cria a tabela de controle do Prisma a partir das colunas registradas no manifesto. */
async function criarTabelaControle(cliente, manifesto) {
  const t = manifesto.tabelas.find((x) => x.nome === '_prisma_migrations');
  if (!t) falhar('Manifesto sem a tabela _prisma_migrations.');
  const colunas = t.colunas.map((c) => `${aspas(c.nome)} ${c.tipo}`).join(', ');
  await cliente.query(`CREATE TABLE "_prisma_migrations" (${colunas}, PRIMARY KEY (${t.chave.map(aspas).join(', ')}))`);
}

async function aplicarMigracoes(cliente) {
  for (const m of migracoesDoRepositorio()) {
    await cliente.query('BEGIN');
    try {
      await cliente.query(readFileSync(m.arquivo, 'utf8'));
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      falhar(`Migração ${m.nome} falhou no destino: ${erro.message.split('\n')[0]}`);
    }
  }
}

/** Lê o arquivo da tabela por fluxo (linhas com anexos podem somar centenas de MB) e insere em lotes. */
async function carregarTabela(cliente, pasta, t) {
  if (t.linhas === 0) return;
  const colunas = t.colunas.map((c) => aspas(c.nome)).join(', ');
  const sql = `INSERT INTO ${aspas(t.nome)} (${colunas}) OVERRIDING SYSTEM VALUE SELECT ${colunas} FROM json_populate_recordset(null::${aspas(t.nome)}, $1::json)`;
  let lote = [];
  let tamanho = 0;
  const enviar = async () => {
    if (lote.length === 0) return;
    await cliente.query(sql, [`[${lote.join(',')}]`]);
    lote = [];
    tamanho = 0;
  };
  let lidas = 0;
  const leitor = createInterface({ input: createReadStream(resolve(pasta, t.arquivo)).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const linha of leitor) {
    if (linha === '') continue;
    lidas += 1;
    lote.push(linha);
    tamanho += linha.length;
    if (tamanho >= LOTE_BYTES) await enviar();
  }
  await enviar();
  if (lidas !== t.linhas) falhar(`${t.nome}: o arquivo tem ${String(lidas)} linha(s), o manifesto ${String(t.linhas)}.`);
}

async function carregarCopia(cliente, pasta, manifesto) {
  await criarTabelaControle(cliente, manifesto);
  await aplicarMigracoes(cliente);
  await cliente.query('BEGIN');
  try {
    // Dados idênticos aos do snapshot: gatilhos de regra não são reexecutados na
    // carga (como no pg_restore, que cria gatilhos depois dos dados); CHECKs,
    // unicidade e tipos continuam valendo, e tudo é conferido em seguida.
    await cliente.query('SET LOCAL session_replication_role = replica');
    for (const t of manifesto.tabelas) await carregarTabela(cliente, pasta, t);
    for (const s of manifesto.sequencias) {
      if (s.valor !== null) await cliente.query('SELECT setval($1::regclass, $2::bigint, true)', [`public.${aspas(s.nome)}`, s.valor]);
    }
    await cliente.query('COMMIT');
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  }
}

function carregarPgDump(url, pasta) {
  const ferramenta = binarioPg('pg_restore');
  if (!ferramenta) falhar('pg_restore não encontrado (defina PG_BIN com a pasta das ferramentas cliente do PostgreSQL).');
  const r = spawnSync(ferramenta.caminho, ['--exit-on-error', '--no-owner', '--no-privileges', `--dbname=${nomeBanco(url)}`, resolve(pasta, 'banco.dump')], {
    env: ambientePg(url),
    encoding: 'utf8',
  });
  if (r.status !== 0) falhar(`pg_restore falhou (código ${String(r.status)}): ${(r.stderr ?? '').split('\n')[0]}`);
}

/** Compara o banco restaurado com o manifesto: contagens, conteúdo, relações, anexos, regras e migrações. */
async function verificar(cliente, manifesto) {
  const falhas = [];
  await cliente.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const tabelas = await descreverTabelas(cliente);
    const porNome = new Map(tabelas.map((t) => [t.nome, t]));
    const comparacao = [];
    for (const esperado of manifesto.tabelas) {
      const atual = porNome.get(esperado.nome);
      if (!atual) {
        falhas.push(`${esperado.nome}: tabela ausente`);
        continue;
      }
      const resumo = await percorrerTabela(cliente, { ...atual, colunas: esperado.colunas, chave: esperado.chave });
      const igual = resumo.linhas === esperado.linhas && resumo.sha256 === esperado.sha256Conteudo;
      comparacao.push({ tabela: esperado.nome, linhas: resumo.linhas, esperado: esperado.linhas, conteudoIgual: igual });
      if (!igual) falhas.push(`${esperado.nome}: ${String(resumo.linhas)} linha(s) restaurada(s) de ${String(esperado.linhas)}; conteúdo ${resumo.sha256 === esperado.sha256Conteudo ? 'igual' : 'DIFERENTE'}`);
    }
    for (const t of tabelas) if (!manifesto.tabelas.some((m) => m.nome === t.nome)) falhas.push(`${t.nome}: tabela que não existe no backup`);

    const relacoes = await orfaos(cliente);
    falhas.push(...relacoes.problemas);
    const anexos = await inventarioAnexos(cliente);
    falhas.push(...anexos.problemas);
    const esperados = new Map(manifesto.anexos.itens.map((i) => [`${i.tabela}:${i.id}`, i]));
    for (const i of anexos.itens) {
      const e = esperados.get(`${i.tabela}:${i.id}`);
      if (!e) falhas.push(`anexo ${i.tabela} ${i.id}: não estava no backup`);
      else if (e.sha256 !== i.sha256 || e.entidade !== i.entidade) falhas.push(`anexo ${i.tabela} ${i.id}: conteúdo ou vínculo diferente`);
      esperados.delete(`${i.tabela}:${i.id}`);
    }
    for (const chave of esperados.keys()) falhas.push(`anexo ${chave}: AUSENTE na restauração`);
    const regras = await invariantes(cliente);
    for (const r of regras) if (r.violacoes !== 0) falhas.push(`regra "${r.regra}": ${r.violacoes === null ? `não verificada (${String(r.erro)})` : `${String(r.violacoes)} violação(ões)`}`);
    const migracoes = await migracoesAplicadas(cliente);
    if (JSON.stringify(migracoes) !== JSON.stringify(manifesto.migracoes)) falhas.push('migrações registradas diferentes do backup');
    await cliente.query('COMMIT');
    return { falhas, tabelas: comparacao, relacoes: relacoes.verificadas, anexos: { total: anexos.total, bytes: anexos.bytes }, regras };
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  }
}

async function principal() {
  carregarEnv();
  const args = argumentos();
  const inicio = Date.now();
  if (typeof args.backup !== 'string') falhar('Informe --backup=<pasta do backup>.');
  const pasta = resolve(RAIZ, args.backup);
  const servidor = typeof args.servidor === 'string' ? args.servidor : 'DATABASE_URL';
  // 1. Integridade e compatibilidade antes de qualquer alteração.
  const manifesto = lerManifesto(pasta);
  const arquivos = await conferirArquivos(pasta, manifesto);
  conferirDestino(args.destino, manifesto, servidor);
  if (manifesto.metodo === 'copia') conferirMigracoes(manifesto);
  const base = urlDaVariavel(servidor);
  const destino = comBanco(base, args.destino);
  const etapas = { integridadeMs: Date.now() - inicio };
  console.log(`Backup ${manifesto.id} (${manifesto.metodo}) íntegro: ${String(arquivos)} arquivo(s) conferido(s). Destino novo: ${identificacao(destino).host}:${String(identificacao(destino).porta)}/${args.destino}.`);

  // 2. Banco novo (nunca sobrescreve).
  const admin = await conectar(comBanco(base, 'postgres'));
  try {
    const existe = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [args.destino]);
    if (existe.rowCount > 0) falhar(`O banco ${args.destino} já existe. A restauração só cria banco novo; nada foi alterado.`);
    await admin.query(`CREATE DATABASE ${aspas(args.destino)} TEMPLATE template0 ENCODING 'UTF8'`);
  } finally {
    await admin.end();
  }

  let sucesso = false;
  let relatorio = null;
  try {
    const carga = Date.now();
    if (manifesto.metodo === 'copia') {
      const cliente = await conectar(destino);
      try {
        await carregarCopia(cliente, pasta, manifesto);
      } finally {
        await cliente.end();
      }
    } else {
      carregarPgDump(destino, pasta);
    }
    etapas.cargaMs = Date.now() - carga;

    const conferencia = Date.now();
    const cliente = await conectar(destino);
    try {
      const resultado = await verificar(cliente, manifesto);
      etapas.verificacaoMs = Date.now() - conferencia;
      // Sessões do backup não valem no ambiente restaurado (autoria preservada nos registros).
      const revogadas = await cliente.query(
        "UPDATE sessao SET revogada_em = now(), motivo_revogacao = 'RESTAURACAO' WHERE revogada_em IS NULL",
      );
      relatorio = {
        backup: manifesto.id,
        metodo: manifesto.metodo,
        instanteDoSnapshot: manifesto.instanteDoSnapshot,
        destino: identificacao(destino),
        resultado: resultado.falhas.length === 0 ? 'APROVADA' : 'REPROVADA',
        falhas: resultado.falhas,
        tabelas: resultado.tabelas.length,
        linhas: resultado.tabelas.reduce((s, t) => s + t.linhas, 0),
        chavesEstrangeirasVerificadas: resultado.relacoes,
        anexos: resultado.anexos,
        regras: resultado.regras,
        sessoesRevogadas: revogadas.rowCount,
        duracaoMs: Date.now() - inicio,
        etapas,
        observacao: 'A restauração recupera o ponto do snapshot; alterações posteriores exigem apuração operacional.',
      };
      sucesso = resultado.falhas.length === 0;
    } finally {
      await cliente.end();
    }
  } catch (erro) {
    relatorio ??= { backup: manifesto.id, resultado: 'FALHOU', falhas: [erro instanceof Error ? erro.message : String(erro)], duracaoMs: Date.now() - inicio, etapas };
  } finally {
    if (typeof args.relatorio === 'string' && relatorio) writeFileSync(resolve(RAIZ, args.relatorio), `${JSON.stringify(relatorio, null, 2)}\n`);
    if (!sucesso && !args['manter-em-falha']) {
      const admin = await conectar(comBanco(base, 'postgres'));
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${aspas(args.destino)} WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  }
  if (!sucesso) {
    falhar(`Restauração REPROVADA: ${(relatorio?.falhas ?? []).slice(0, 10).join('; ')}${args['manter-em-falha'] ? ` (banco ${args.destino} mantido para análise; não use em operação)` : ' (banco de destino removido)'}.`, 2);
  }
  console.log(`Restauração APROVADA em ${String(relatorio.duracaoMs)} ms: ${String(relatorio.tabelas)} tabelas e ${String(relatorio.linhas)} linhas iguais ao backup, ${String(relatorio.anexos.total)} anexo(s) íntegro(s), ${String(relatorio.chavesEstrangeirasVerificadas)} relações sem órfãos, ${String(relatorio.sessoesRevogadas)} sessão(ões) antiga(s) revogada(s).`);
}

await executar(principal);
