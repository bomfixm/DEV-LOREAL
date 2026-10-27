/**
 * Proteção antes de substituir o inventário ativo (26 out. 2026): ANTES da
 * transação que retira a base antiga,
 * 1. gera (e, havendo destino independente, publica) uma revisão da planilha
 *    com a base atual, marcada "antes da substituição" (retenção própria);
 * 2. cria o backup completo verificado (motivo PRE_SUBSTITUICAO) e tenta
 *    enviá-lo ao destino.
 * Sem a cópia local verificada da planilha E do backup, a substituição é
 * recusada (nada muda). Falha só no envio externo não bloqueia: as cópias
 * verificadas ficam no servidor e o trabalhador reenvia com espera crescente.
 * A importação em si continua numa transação única: se ela for desfeita, a
 * planilha atual continua sendo a da base anterior (nenhuma marca nova).
 */
import type { Banco } from '../../db/cliente.js';
import { ErroHttp } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { processarEscopo } from '../planilha/processar.js';
import { processarBackups } from './backup.js';
import type { ConfigPlanilha } from './configuracao.js';

const esperar = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

export interface ProtecaoPrevia {
  revisao: number;
  backupId: string;
  planilhaPublicada: boolean;
  backupEnviado: boolean;
}

export async function protegerAntesDaSubstituicao(db: Banco, escopoId: string, config: ConfigPlanilha, autor: { usuarioId: string; requestId: string }, substitui: string): Promise<ProtecaoPrevia> {
  let revisao: number | null = null;
  let publicada = false;
  for (let tentativa = 0; tentativa < 45 && revisao === null; tentativa += 1) {
    const r = await processarEscopo(db, escopoId, config, { gerar: 'SEMPRE', motivo: 'PRE_SUBSTITUICAO', enviar: true, ignorarEspera: true, solicitadoPorId: autor.usuarioId });
    if (r.situacao === 'OCUPADO') {
      await esperar(2_000);
      continue;
    }
    if (r.geracao?.situacao !== 'GERADA') throw new ErroHttp(503, 'PROTECAO_PREVIA_FALHOU', `A cópia da planilha anterior à substituição não foi gerada (${r.geracao?.erro ?? 'sem detalhe'}). Nada foi substituído.`);
    revisao = r.geracao.revisao;
    publicada = r.envio?.situacao === 'PUBLICADA';
  }
  if (revisao === null) throw new ErroHttp(503, 'PROTECAO_PREVIA_FALHOU', 'A planilha deste escopo está sendo gerada por outro processo há mais de 90 s. Tente de novo; nada foi substituído.');
  let backup = null;
  for (let tentativa = 0; tentativa < 90 && backup === null; tentativa += 1) {
    const r = await processarBackups(db, config, { forcar: true, motivo: 'PRE_SUBSTITUICAO' });
    if (r.situacao === 'OCUPADO') {
      await esperar(2_000);
      continue;
    }
    if (r.backupId === null) throw new ErroHttp(503, 'PROTECAO_PREVIA_FALHOU', `O backup completo anterior à substituição falhou (${r.erro ?? 'sem detalhe'}). Nada foi substituído.`);
    backup = r;
  }
  if (backup?.backupId == null) throw new ErroHttp(503, 'PROTECAO_PREVIA_FALHOU', 'Outra rotina de backup está em andamento há mais de 3 min. Tente de novo; nada foi substituído.');
  const protecao = { revisao, backupId: backup.backupId, planilhaPublicada: publicada, backupEnviado: backup.enviados.includes(backup.backupId) };
  await registrarEvento(db, {
    acao: 'PROTECAO_PRE_SUBSTITUICAO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: 'INVENTARIO',
    alvoId: escopoId,
    detalhes: { substitui, revisao, backup: backup.backupId, planilhaPublicada: publicada, backupEnviado: protecao.backupEnviado },
    requestId: autor.requestId,
  });
  return protecao;
}
