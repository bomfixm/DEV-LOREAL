// Ensaio de volume do backup/restauração (etapa 09), só com dados FICTÍCIOS.
//
// Uso: node scripts/recuperacao/ensaio-volume.mjs [--servidor=DATABASE_URL] [--anexos=300] [--anexo-kb=1024] [--eventos=200000]
//
// 1. faz backup da base indicada em --servidor (padrão: desenvolvimento, só leitura);
// 2. restaura num banco de ensaio novo e acrescenta volume fictício: fotos de
//    conferência (bytes aleatórios com assinatura JPEG; hash conferido pelo
//    banco) e eventos de auditoria marcados como fictícios;
// 3. mede backup e restauração desse banco com volume (outro banco novo);
// 4. remove os bancos de ensaio e as pastas temporárias e imprime o resumo.
// Nada é alterado na base de origem.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RAIZ, argumentos, carregarEnv, comBanco, conectar, executar, falhar, urlDaVariavel } from './comum.mjs';

function rodar(script, args, env = process.env) {
  const inicio = Date.now();
  const saida = execFileSync(process.execPath, [resolve(RAIZ, 'scripts', 'recuperacao', script), ...args], { cwd: RAIZ, env, encoding: 'utf8' });
  return { ms: Date.now() - inicio, saida };
}

function tamanhoPasta(pasta) {
  let total = 0;
  for (const nome of readdirSync(pasta, { recursive: true })) {
    const caminho = join(pasta, String(nome));
    const info = statSync(caminho);
    if (info.isFile()) total += info.size;
  }
  return total;
}

function unicaPasta(pasta) {
  const [nome] = readdirSync(pasta).filter((n) => n.startsWith('praca-reversa-backup-'));
  if (!nome) falhar('Backup não encontrado.');
  return join(pasta, nome);
}

async function principal() {
  carregarEnv();
  const args = argumentos();
  const servidor = typeof args.servidor === 'string' ? args.servidor : 'DATABASE_URL';
  const anexos = Number(args.anexos ?? 300);
  const kb = Number(args['anexo-kb'] ?? 1024);
  const eventos = Number(args.eventos ?? 200_000);
  const base = urlDaVariavel(servidor);
  const sufixo = Date.now().toString(36);
  const bancoVolume = `praca_reversa_ensaio_volume_${sufixo}`;
  const bancoRestaurado = `praca_reversa_restauracao_volume_${sufixo}`;
  const pastas = [mkdtempSync(join(tmpdir(), 'praca-volume-a-')), mkdtempSync(join(tmpdir(), 'praca-volume-b-'))];
  const env = { ...process.env, URL_ENSAIO_VOLUME: comBanco(base, bancoVolume).href };
  const resultado = { parametros: { anexos, anexoKb: kb, eventos }, etapas: {} };
  try {
    console.log('1/4 backup da base de origem (só leitura)…');
    resultado.etapas.backupOrigemMs = rodar('criar-backup.mjs', [`--origem=${servidor}`, `--destino=${pastas[0]}`]).ms;
    console.log('2/4 cópia para o banco de ensaio e volume fictício…');
    resultado.etapas.copiaMs = rodar('restaurar-backup.mjs', [`--backup=${unicaPasta(pastas[0])}`, `--destino=${bancoVolume}`, `--servidor=${servidor}`]).ms;
    const cliente = await conectar(comBanco(base, bancoVolume));
    try {
      const inicio = Date.now();
      const { rows: [conf] } = await cliente.query(
        `SELECT s.id, s.escopo_id, u.id AS usuario FROM sessao_conferencia s CROSS JOIN LATERAL (SELECT id FROM usuario ORDER BY criado_em LIMIT 1) u ORDER BY s.iniciada_em LIMIT 1`,
      );
      if (!conf) falhar('A base de origem não tem conferência para receber os anexos fictícios.');
      // Bytes aleatórios (md5 encadeado) com assinatura JPEG; o CHECK confere o SHA-256.
      await cliente.query(
        `INSERT INTO anexo_conferencia (id, escopo_id, conferencia_id, nome, tipo_conteudo, tamanho, sha256, conteudo, enviado_por_id, enviado_em)
         SELECT gen_random_uuid(), $1, $2, 'ficticio-' || n || '.jpg', 'image/jpeg', octet_length(c), encode(sha256(c), 'hex'), c, $3, now()
           FROM (SELECT n, decode('ffd8ffe0', 'hex') || decode(string_agg(md5(n::text || '-' || k::text || random()::text), ''), 'hex') AS c
                   FROM generate_series(1, $4::int) n, generate_series(1, $5::int) k GROUP BY n) x`,
        [conf.escopo_id, conf.id, conf.usuario, anexos, Math.ceil((kb * 1024) / 16)],
      );
      await cliente.query(
        `INSERT INTO evento_auditoria (id, ocorrido_em, acao, resultado, detalhes)
         SELECT gen_random_uuid(), now() - (n || ' seconds')::interval, 'ENSAIO_VOLUME_FICTICIO', 'SUCESSO', jsonb_build_object('n', n, 'ficticio', true)
           FROM generate_series(1, $1::int) n`,
        [eventos],
      );
      resultado.etapas.volumeMs = Date.now() - inicio;
      const { rows: [tam] } = await cliente.query(`SELECT pg_database_size(current_database())::bigint AS bytes`);
      resultado.bancoComVolumeBytes = Number(tam.bytes);
    } finally {
      await cliente.end();
    }
    console.log('3/4 backup do banco com volume…');
    const backup = rodar('criar-backup.mjs', ['--origem=URL_ENSAIO_VOLUME', `--destino=${pastas[1]}`], env);
    resultado.etapas.backupComVolumeMs = backup.ms;
    const pasta = unicaPasta(pastas[1]);
    resultado.backupBytes = tamanhoPasta(pasta);
    const manifesto = JSON.parse(readFileSync(join(pasta, 'manifesto.json'), 'utf8'));
    resultado.linhas = manifesto.tabelas.reduce((s, t) => s + t.linhas, 0);
    resultado.anexosNoBackup = manifesto.anexos.total;
    console.log('4/4 restauração com verificação completa…');
    const relatorio = join(pastas[1], 'relatorio.json');
    resultado.etapas.restauracaoComVolumeMs = rodar('restaurar-backup.mjs', [`--backup=${pasta}`, `--destino=${bancoRestaurado}`, `--servidor=${servidor}`, `--relatorio=${relatorio}`]).ms;
    const r = JSON.parse(readFileSync(relatorio, 'utf8'));
    resultado.restauracao = { resultado: r.resultado, etapas: r.etapas, anexos: r.anexos, linhas: r.linhas };
  } finally {
    const admin = await conectar(comBanco(base, 'postgres'));
    try {
      for (const banco of [bancoVolume, bancoRestaurado]) await admin.query(`DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
    for (const p of pastas) rmSync(p, { recursive: true, force: true });
  }
  console.log(JSON.stringify(resultado, null, 2));
}

await executar(principal);
