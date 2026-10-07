// Teste de restauração em ambiente ISOLADO com dados FICTÍCIOS (planilha única
// e proteção dos dados): cria um banco de ensaio novo, aplica as migrações do
// repositório e o seed de demonstração, faz o backup dele com
// criar-backup.mjs, restaura num segundo banco novo com restaurar-backup.mjs
// (comparação completa) e REGISTRA o resultado no banco principal
// (registro_protecao, TESTE_RESTAURACAO). Nunca toca o banco em uso: os dois
// bancos de ensaio e a pasta temporária são removidos no fim.
//
// Uso: node scripts/recuperacao/teste-restauracao.mjs [--servidor=DATABASE_URL] [--manter-bancos]
// Exige permissão de CREATEDB no servidor (ver docs/IMPLANTACAO.md).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RAIZ, argumentos, aspas, carregarEnv, comBanco, conectar, executar, falhar, urlDaVariavel } from './comum.mjs';
import { registrarProtecao } from './rotina-backup.mjs';

function rodar(comando, args, env) {
  const r = spawnSync(comando, args, { cwd: RAIZ, env, encoding: 'utf8' });
  if (r.status !== 0) falhar(`${args.map((a) => a.split(/[\\/]/).pop()).join(' ')} falhou (código ${String(r.status)}): ${((r.stderr || r.stdout) ?? '').trim().split('\n').slice(-2).join(' ')}`);
  return r.stdout ?? '';
}

async function principal() {
  carregarEnv();
  const args = argumentos();
  const servidor = typeof args.servidor === 'string' ? args.servidor : 'DATABASE_URL';
  const base = urlDaVariavel(servidor);
  const sufixo = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Date.now().toString(36)}`;
  const origem = `praca_reversa_ensaio_origem_${sufixo}`;
  const restaurado = `praca_reversa_ensaio_restauracao_${sufixo}`;
  const pasta = mkdtempSync(join(tmpdir(), 'praca-teste-restauracao-'));
  const env = { ...process.env, URL_ENSAIO_ORIGEM: comBanco(base, origem).href };
  const iniciadoEm = new Date();
  const admin = await conectar(comBanco(base, 'postgres'));
  let relatorio = null;
  let backupId = null;
  try {
    console.log(`1/4 banco de ensaio ${origem} com migrações e dados fictícios…`);
    await admin.query(`CREATE DATABASE ${aspas(origem)}`);
    rodar(process.execPath, [resolve(RAIZ, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy', '--config', resolve(RAIZ, 'apps', 'api', 'prisma.config.ts')], {
      ...process.env,
      DATABASE_URL: env.URL_ENSAIO_ORIGEM,
    });
    rodar(process.execPath, [resolve(RAIZ, 'node_modules', 'tsx', 'dist', 'cli.mjs'), resolve(RAIZ, 'apps', 'api', 'src', 'cli', 'semear-demo.ts')], {
      ...process.env,
      DATABASE_URL: env.URL_ENSAIO_ORIGEM,
      APP_AMBIENTE: 'teste',
    });
    console.log('2/4 backup do banco de ensaio…');
    rodar(process.execPath, [resolve(RAIZ, 'scripts', 'recuperacao', 'criar-backup.mjs'), '--origem=URL_ENSAIO_ORIGEM', `--destino=${pasta}`], env);
    const [nome] = readdirSync(pasta).filter((n) => n.startsWith('praca-reversa-backup-'));
    if (!nome) falhar('Backup do ensaio não encontrado.');
    backupId = JSON.parse(readFileSync(join(pasta, nome, 'manifesto.json'), 'utf8')).id;
    console.log(`3/4 restauração em ${restaurado} com comparação completa…`);
    const arquivoRelatorio = join(pasta, 'relatorio.json');
    const r = spawnSync(
      process.execPath,
      [resolve(RAIZ, 'scripts', 'recuperacao', 'restaurar-backup.mjs'), `--backup=${join(pasta, nome)}`, `--destino=${restaurado}`, `--servidor=${servidor}`, `--relatorio=${arquivoRelatorio}`],
      { cwd: RAIZ, env, encoding: 'utf8' },
    );
    try {
      relatorio = JSON.parse(readFileSync(arquivoRelatorio, 'utf8'));
    } catch {
      relatorio = { resultado: 'FALHOU', falhas: [((r.stderr || r.stdout) ?? '').trim().split('\n').slice(-1)[0] ?? 'sem relatório'] };
    }
    const aprovado = r.status === 0 && relatorio.resultado === 'APROVADA';
    console.log('4/4 registro do resultado no banco principal…');
    await registrarProtecao(base, {
      tipo: 'TESTE_RESTAURACAO',
      situacao: aprovado ? 'VERIFICADO' : 'FALHOU',
      iniciadoEm,
      concluidoEm: new Date(),
      identificador: backupId,
      ambiente: restaurado,
      dados: 'FICTICIOS',
      responsavel: process.env.BACKUP_RESPONSAVEL ?? null,
      mensagem: aprovado ? null : (relatorio.falhas ?? []).slice(0, 5).join('; ').slice(0, 500) || 'Restauração reprovada.',
      detalhes: { tabelas: relatorio.tabelas ?? null, linhas: relatorio.linhas ?? null, relacoes: relatorio.chavesEstrangeirasVerificadas ?? null, duracaoMs: relatorio.duracaoMs ?? null, origem },
    });
    if (!aprovado) falhar(`Teste de restauração REPROVADO: ${(relatorio.falhas ?? []).slice(0, 3).join('; ')}`, 2);
    console.log(`Teste de restauração APROVADO e registrado: ${String(relatorio.tabelas)} tabelas, ${String(relatorio.linhas)} linhas iguais, banco isolado ${restaurado}.`);
  } catch (erro) {
    if (relatorio === null) {
      await registrarProtecao(base, {
        tipo: 'TESTE_RESTAURACAO',
        situacao: 'FALHOU',
        iniciadoEm,
        concluidoEm: new Date(),
        identificador: backupId,
        ambiente: restaurado,
        dados: 'FICTICIOS',
        mensagem: (erro instanceof Error ? erro.message : String(erro)).slice(0, 500),
      }).catch(() => undefined);
    }
    throw erro;
  } finally {
    if (!args['manter-bancos']) {
      for (const banco of [origem, restaurado]) await admin.query(`DROP DATABASE IF EXISTS ${aspas(banco)} WITH (FORCE)`).catch(() => undefined);
    }
    await admin.end();
    rmSync(pasta, { recursive: true, force: true });
  }
}

await executar(principal);
