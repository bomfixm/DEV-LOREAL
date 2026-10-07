// Rotina de backup completo (planilha única e proteção dos dados): cria o
// backup coerente com criar-backup.mjs, confere o manifesto e o hash de todos
// os arquivos, aplica a retenção e REGISTRA o resultado no banco
// (registro_protecao), que o aplicativo e a aba "Proteção e ajuda" mostram.
// Só registra VERIFICADO depois da conferência; falha também é registrada.
//
// Uso (agendar pelo Agendador de Tarefas do Windows ou cron; ver docs/IMPLANTACAO.md):
//   node scripts/recuperacao/rotina-backup.mjs [--destino=<pasta>] [--manter=14] [--origem=DATABASE_URL]
//
// Configuração (variáveis de ambiente; nenhuma é segredo):
//   BACKUP_DESTINO            pasta dos backups (padrão .dados/backups — no MESMO servidor)
//   BACKUP_FORA_DO_SERVIDOR   "sim" só quando BACKUP_DESTINO fica fora do servidor da aplicação
//                             (compartilhamento, disco de outra máquina, pasta sincronizada)
//   BACKUP_DESTINO_DESCRICAO  onde consultar (texto mostrado no aplicativo; sem credenciais)
//   BACKUP_RESPONSAVEL        quem acompanha e recebe as mensagens (canal: o próprio aplicativo)
//   BACKUP_MANTER             quantos backups verificados manter (padrão 14; mínimo 2)
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RAIZ, argumentos, carregarEnv, conectar, conferirArquivos, executar, falhar, lerManifesto, urlDaVariavel } from './comum.mjs';

function tamanhoPasta(pasta) {
  let total = 0;
  for (const nome of readdirSync(pasta, { recursive: true })) {
    const info = statSync(join(pasta, String(nome)));
    if (info.isFile()) total += info.size;
  }
  return total;
}

/** Registra o resultado (BACKUP ou TESTE_RESTAURACAO) e marca a planilha de todos os escopos para atualizar. */
export async function registrarProtecao(url, r) {
  const cliente = await conectar(url);
  try {
    await cliente.query('BEGIN');
    await cliente.query(
      `INSERT INTO registro_protecao (id, tipo, situacao, iniciado_em, concluido_em, identificador, tamanho_bytes, destino, fora_do_servidor, ambiente, dados, responsavel, mensagem, detalhes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [randomUUID(), r.tipo, r.situacao, r.iniciadoEm, r.concluidoEm, r.identificador ?? null, r.tamanhoBytes ?? null, r.destino ?? null, r.foraDoServidor ?? false, r.ambiente ?? null, r.dados ?? null, r.responsavel ?? null, r.mensagem ?? null, r.detalhes ?? null],
    );
    await cliente.query(`INSERT INTO alteracao_planilha (escopo_id, origem) SELECT id, 'registro_protecao' FROM escopo WHERE ativo`);
    await cliente.query('COMMIT');
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  } finally {
    await cliente.end();
  }
}

/** Mantém os `manter` backups verificados mais novos; nunca apaga o recém-criado nem deixa a pasta sem backup. */
function aplicarRetencao(destino, manter, recente) {
  const pastas = readdirSync(destino)
    .filter((n) => /^praca-reversa-backup-.+-\d{8}-\d{6}Z-[0-9a-f]{8}$/.test(n) && existsSync(join(destino, n, 'manifesto.json')))
    .sort()
    .reverse();
  const apagar = pastas.filter((n) => join(destino, n) !== recente).slice(Math.max(1, manter - 1));
  for (const n of apagar) rmSync(join(destino, n), { recursive: true, force: true });
  return apagar.length;
}

async function principal() {
  carregarEnv();
  const args = argumentos();
  const variavel = typeof args.origem === 'string' ? args.origem : 'DATABASE_URL';
  const url = urlDaVariavel(variavel);
  const destino = resolve(RAIZ, typeof args.destino === 'string' ? args.destino : (process.env.BACKUP_DESTINO ?? '.dados/backups'));
  const manter = Math.max(2, Number(args.manter ?? process.env.BACKUP_MANTER ?? 14));
  const fora = process.env.BACKUP_FORA_DO_SERVIDOR === 'sim';
  const descricao = process.env.BACKUP_DESTINO_DESCRICAO ?? (fora ? destino : `${destino} (mesmo servidor da aplicação)`);
  const responsavel = process.env.BACKUP_RESPONSAVEL ?? null;
  const iniciadoEm = new Date();
  let pasta = null;
  try {
    const r = spawnSync(process.execPath, [resolve(RAIZ, 'scripts', 'recuperacao', 'criar-backup.mjs'), `--origem=${variavel}`, `--destino=${destino}`], { cwd: RAIZ, env: process.env, encoding: 'utf8' });
    const linhaFinal = /Backup concluído em \d+ ms: (.+)$/m.exec(r.stdout ?? '');
    if (r.status !== 0 || !linhaFinal) falhar(`criar-backup falhou (código ${String(r.status)}): ${((r.stderr || r.stdout) ?? '').trim().split('\n').slice(-1)[0] ?? ''}`);
    pasta = linhaFinal[1].trim();
    // Verificação independente da criação: manifesto íntegro e hash de cada arquivo.
    const manifesto = lerManifesto(pasta);
    const arquivos = await conferirArquivos(pasta, manifesto);
    const tamanho = tamanhoPasta(pasta);
    const linhas = manifesto.tabelas.reduce((s, t) => s + t.linhas, 0);
    const removidos = aplicarRetencao(destino, manter, pasta);
    await registrarProtecao(url, {
      tipo: 'BACKUP',
      situacao: 'VERIFICADO',
      iniciadoEm,
      concluidoEm: new Date(),
      identificador: manifesto.id,
      tamanhoBytes: tamanho,
      destino: descricao,
      foraDoServidor: fora,
      dados: 'OPERACAO',
      responsavel,
      detalhes: { tabelas: manifesto.tabelas.length, linhas, arquivosConferidos: arquivos, anexos: manifesto.anexos.total, instanteDoSnapshot: manifesto.instanteDoSnapshot, retencao: manter, removidos },
    });
    console.log(`Backup VERIFICADO: ${manifesto.id} · ${String(tamanho)} bytes · ${String(arquivos)} arquivo(s) conferido(s) · ${String(linhas)} linhas · retenção ${String(manter)} (removidos ${String(removidos)}).`);
    if (!fora) console.log('ATENÇÃO: destino no mesmo servidor da aplicação (BACKUP_FORA_DO_SERVIDOR não é "sim"): o aplicativo mostra "Não configurado" para a proteção fora do servidor.');
  } catch (erro) {
    const mensagem = (erro instanceof Error ? erro.message : String(erro)).slice(0, 500);
    try {
      await registrarProtecao(url, { tipo: 'BACKUP', situacao: 'FALHOU', iniciadoEm, concluidoEm: new Date(), destino: descricao, foraDoServidor: fora, dados: 'OPERACAO', responsavel, mensagem, detalhes: { pasta } });
    } catch (registro) {
      console.error(`Não foi possível registrar a falha no banco: ${registro instanceof Error ? registro.message : String(registro)}`);
    }
    throw erro;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(RAIZ, 'scripts', 'recuperacao', 'rotina-backup.mjs')) await executar(principal);
