/**
 * Trabalhador da planilha automática e da proteção (26 out. 2026).
 *
 * A fila e as concessões ficam no banco (gatilhos na mesma transação de cada
 * alteração; `controle_planilha` e `controle_protecao`): o trabalhador só
 * acorda o trabalho. Por isso funciona igual
 * - no processo contínuo da API (hospedagem atual: servidor mantido pela
 *   tarefa do Windows, que o reinicia se cair) — `iniciarTrabalhador`;
 * - num agendador externo (Agendador de Tarefas, cron ou função agendada da
 *   hospedagem) — `npm run protecao:processar` roda uma volta e sai.
 * Reinício no meio do trabalho: a concessão vence e outra volta retoma; dois
 * processos nunca trabalham o mesmo escopo ao mesmo tempo.
 *
 * Cada volta: escopos devidos (gerar e/ou enviar), reconciliação periódica
 * (cópia local e destino) e, em paralelo, o backup diário com envio.
 */
import type { Banco } from '../../db/cliente.js';
import { escoposDevidos, processarEscopo } from '../planilha/processar.js';
import { processarBackups, type ResultadoBackup } from './backup.js';
import type { ConfigPlanilha } from './configuracao.js';

export interface Registro {
  info: (dados: object, mensagem: string) => void;
  warn: (dados: object, mensagem: string) => void;
  error: (dados: object, mensagem: string) => void;
}

export interface EstadoTrabalhador {
  /** Última reconciliação por escopo (memória do processo; refeita depois de reiniciar). */
  reconciliadoEm: Map<string, number>;
}

/** Uma volta da planilha: escopos devidos e reconciliação vencida. */
export async function voltaPlanilha(db: Banco, config: ConfigPlanilha, log: Registro, estado: EstadoTrabalhador, agora: () => Date = () => new Date()): Promise<number> {
  const devidos = new Map((await escoposDevidos(db, config, agora())).map((d) => [d.escopoId, d]));
  const ativos = await db.escopo.findMany({ where: { ativo: true, demonstracao: false }, select: { id: true } });
  for (const { id } of ativos) {
    const reconciliar = agora().getTime() - (estado.reconciliadoEm.get(id) ?? 0) >= config.reconciliarMs;
    const d = devidos.get(id);
    if (!d && !reconciliar) continue;
    const inicio = Date.now();
    const r = await processarEscopo(db, id, config, { gerar: d?.gerar || reconciliar ? 'SE_DEVIDO' : 'NAO', motivo: 'ALTERACAO', enviar: true, reconciliar, agora });
    if (r.situacao === 'OCUPADO') continue;
    if (reconciliar) estado.reconciliadoEm.set(id, agora().getTime());
    const dados = { escopoId: id, revisao: r.geracao?.revisao ?? r.envio?.revisao ?? null, geracao: r.geracao?.situacao ?? null, envio: r.envio?.situacao ?? null, reconciliado: r.reconciliado, duracaoMs: Date.now() - inicio };
    if (r.geracao?.situacao === 'FALHOU') log.warn({ ...dados, erro: r.geracao.erro }, 'Planilha: geração falhou (a última revisão boa continua; nova tentativa com espera)');
    else if (r.envio?.situacao === 'FALHOU') log.warn({ ...dados, erro: r.envio.erro }, 'Planilha: envio ao destino falhou (a cópia anterior continua lá; nova tentativa com espera)');
    else if (r.geracao !== null || r.envio?.situacao === 'PUBLICADA') log.info(dados, 'Planilha: revisão processada');
  }
  return devidos.size;
}

/** Uma volta completa (para agendador externo): planilha de todos os escopos e backups. */
export async function voltaCompleta(db: Banco, config: ConfigPlanilha, log: Registro): Promise<{ escopos: number; backup: ResultadoBackup }> {
  const escopos = await voltaPlanilha(db, config, log, { reconciliadoEm: new Map() });
  const backup = await processarBackups(db, config, {});
  return { escopos, backup };
}

/** Trabalhador contínuo no processo da API (encadeado: uma volta só termina antes da próxima). */
export function iniciarTrabalhador(db: Banco, config: ConfigPlanilha, log: Registro): { parar: () => Promise<void>; acordar: () => void } {
  const estado: EstadoTrabalhador = { reconciliadoEm: new Map() };
  let parado = false;
  let temporizador: NodeJS.Timeout | null = null;
  let volta: Promise<void> = Promise.resolve();
  let backup: Promise<void> | null = null;
  let proximoBackupMs = 0;
  let executando = false;
  let pedido = false;

  const agendar = (ms: number) => {
    if (parado) return;
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      volta = executar();
    }, ms);
    temporizador.unref();
  };

  const executar = async () => {
    if (executando) {
      pedido = true;
      return;
    }
    executando = true;
    try {
      await voltaPlanilha(db, config, log, estado);
    } catch (erro) {
      log.error({ err: erro }, 'Planilha: falha na volta do trabalhador (nova volta no próximo intervalo)');
    } finally {
      executando = false;
    }
    // Backup em paralelo: uma cópia longa não atrasa a planilha.
    if (backup === null && Date.now() >= proximoBackupMs) {
      proximoBackupMs = Date.now() + 60_000;
      backup = processarBackups(db, config, {})
        .then((r) => {
          if (r.situacao === 'FALHOU') log.warn({ erro: r.erro, backup: r.backupId, enviados: r.enviados }, 'Proteção: backup ou envio falhou (nova tentativa com espera)');
          else if (r.backupId !== null || r.enviados.length > 0) log.info({ backup: r.backupId, enviados: r.enviados }, 'Proteção: backup completo processado');
        })
        .catch((erro: unknown) => {
          log.error({ err: erro }, 'Proteção: falha na rotina de backup');
        })
        .finally(() => {
          backup = null;
        });
    }
    agendar(pedido ? 0 : config.intervaloMs);
    pedido = false;
  };

  agendar(1_000);
  return {
    acordar: () => {
      agendar(0);
    },
    parar: async () => {
      parado = true;
      if (temporizador) clearTimeout(temporizador);
      await volta;
      await backup;
    },
  };
}
