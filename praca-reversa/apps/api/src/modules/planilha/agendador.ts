/**
 * Agendador da planilha no processo da API: a cada intervalo, publica os
 * escopos devidos (alterações agrupadas ou reconciliação periódica vencida),
 * um por vez. A fila e a concessão ficam no banco, então reinícios e mais de
 * um processo não duplicam nem perdem publicações; o agendador só acorda o
 * trabalho. Nunca roda duas voltas ao mesmo tempo no mesmo processo.
 */
import type { Banco } from '../../db/cliente.js';
import { escoposDevidos, publicarPlanilha } from './publicacao.js';
import type { ConfigPlanilha } from './situacao.js';

export interface Registro {
  info: (dados: object, mensagem: string) => void;
  warn: (dados: object, mensagem: string) => void;
  error: (dados: object, mensagem: string) => void;
}

export function iniciarAgendadorPlanilha(db: Banco, config: ConfigPlanilha, log: Registro): { parar: () => Promise<void> } {
  let parado = false;
  let volta: Promise<void> = Promise.resolve();
  const executar = async () => {
    const devidos = await escoposDevidos(db, config, new Date());
    for (const { escopoId, motivo } of devidos) {
      if (parado) return;
      const inicio = Date.now();
      const r = await publicarPlanilha(db, escopoId, config, { motivo });
      const dados = { escopoId, motivo, versao: r.versao, situacao: r.situacao, duracaoMs: Date.now() - inicio };
      if (r.situacao === 'FALHOU') log.warn({ ...dados, erro: r.erro }, 'Planilha: publicação falhou (a última versão boa continua; nova tentativa agendada)');
      else if (r.situacao !== 'OCUPADO') log.info(dados, 'Planilha: versão gerada');
    }
  };
  const temporizador = setInterval(() => {
    volta = volta.then(async () => {
      if (parado) return;
      try {
        await executar();
      } catch (erro) {
        log.error({ err: erro }, 'Planilha: falha no agendador (nova volta no próximo intervalo)');
      }
    });
  }, config.intervaloMs);
  temporizador.unref();
  return {
    parar: async () => {
      parado = true;
      clearInterval(temporizador);
      await volta;
    },
  };
}
