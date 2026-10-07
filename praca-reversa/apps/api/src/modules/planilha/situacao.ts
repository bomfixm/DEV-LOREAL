/**
 * Estados da planilha e da proteção dos dados, mostrados na aba "Proteção e
 * ajuda" e na tela do aplicativo: Atualizada, Atualização pendente, Falhou,
 * Não configurado e Não testado. Sucesso só depois das verificações
 * registradas (publicação validada no destino independente; backup conferido
 * pelo manifesto; restauração comparada em banco isolado). Configuração
 * ausente nunca aparece como proteção ativa.
 */
import type { ProtecaoResumo, PublicacaoResumo } from './dados.js';

export type Estado = 'Atualizada' | 'Atualização pendente' | 'Falhou' | 'Não configurado' | 'Não testado';

export interface ConfigPlanilha {
  /** Agendador ligado (marcações → publicação). */
  automatica: boolean;
  /** Destino independente (pasta sincronizada/compartilhada fora do servidor) ou `null`. */
  destino: { tipo: 'PASTA'; caminho: string; descricao: string } | null;
  /** Pasta da geração local (no servidor; não conta como cópia publicada). */
  pastaLocal: string;
  intervaloMs: number;
  agruparMs: number;
  reconciliarMs: number;
  versoesManter: number;
  eventosMax: number;
  concessaoMs: number;
  backup: { prazoHoras: number; destinoDescricao: string | null; responsavel: string | null; restauracaoPrazoDias: number };
}

export interface ItemSituacao {
  recurso: string;
  estado: Estado;
  ultimoSucesso: Date | null;
  detalhe: string;
}

const tamanho = (b: bigint | null) => (b === null ? '' : `${(Number(b) / 1_048_576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`);
const dataBr = (d: Date | null) => (d === null ? '' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d));

export function estadoBackup(config: ConfigPlanilha, verificado: ProtecaoResumo | null, ultimo: ProtecaoResumo | null, agora: Date): ItemSituacao {
  if (ultimo !== null && ultimo.situacao === 'FALHOU' && (verificado === null || ultimo.concluidoEm > verificado.concluidoEm)) {
    return { recurso: 'Backup completo', estado: 'Falhou', ultimoSucesso: verificado?.concluidoEm ?? null, detalhe: `Última tentativa falhou em ${dataBr(ultimo.concluidoEm)}: ${ultimo.mensagem ?? ''}${verificado ? ` Último backup verificado: ${verificado.identificador ?? ''}.` : ''}` };
  }
  if (verificado === null) {
    return { recurso: 'Backup completo', estado: 'Não configurado', ultimoSucesso: null, detalhe: 'Nenhum backup completo verificado registrado. Configure a rotina (docs/IMPLANTACAO.md).' };
  }
  const resumo = `${verificado.identificador ?? 'sem identificador'} · ${tamanho(verificado.tamanhoBytes)} · ${verificado.destino ?? 'destino não informado'}`;
  if (!verificado.foraDoServidor) {
    return { recurso: 'Backup completo', estado: 'Não configurado', ultimoSucesso: verificado.concluidoEm, detalhe: `Último backup verificado (${resumo}) ficou no mesmo servidor: não protege contra perda do servidor. Configure um destino fora do servidor.` };
  }
  const atrasado = agora.getTime() - verificado.concluidoEm.getTime() > config.backup.prazoHoras * 3_600_000;
  return {
    recurso: 'Backup completo',
    estado: atrasado ? 'Atualização pendente' : 'Atualizada',
    ultimoSucesso: verificado.concluidoEm,
    detalhe: `${atrasado ? `Sem backup verificado há mais de ${String(config.backup.prazoHoras)} h. ` : ''}${resumo}.`,
  };
}

export function estadoRestauracao(config: ConfigPlanilha, teste: ProtecaoResumo | null, agora: Date): ItemSituacao {
  if (teste === null) return { recurso: 'Teste de restauração', estado: 'Não testado', ultimoSucesso: null, detalhe: 'Nenhum teste de restauração registrado.' };
  if (teste.situacao === 'FALHOU') return { recurso: 'Teste de restauração', estado: 'Falhou', ultimoSucesso: null, detalhe: `Falhou em ${dataBr(teste.concluidoEm)} (${teste.ambiente ?? 'ambiente isolado'}): ${teste.mensagem ?? ''}` };
  const antigo = agora.getTime() - teste.concluidoEm.getTime() > config.backup.restauracaoPrazoDias * 86_400_000;
  return {
    recurso: 'Teste de restauração',
    estado: antigo ? 'Atualização pendente' : 'Atualizada',
    ultimoSucesso: teste.concluidoEm,
    detalhe: `Aprovado em banco isolado ${teste.ambiente ?? ''} com dados ${teste.dados === 'FICTICIOS' ? 'fictícios' : 'da operação'}${teste.identificador ? ` (backup ${teste.identificador})` : ''}.${antigo ? ` Repetir: mais de ${String(config.backup.restauracaoPrazoDias)} dias.` : ''}`,
  };
}

/** Estado vivo da publicação (tela do aplicativo). */
export function estadoPublicacao(
  config: ConfigPlanilha,
  s: { pendentes: number; desde: Date | null; falhasSeguidas: number; ultimaFalha: string | null; ultimaFalhaEm: Date | null; ultimaPublicada: PublicacaoResumo | null; publicandoDesde: Date | null },
  agora: Date,
): ItemSituacao {
  if (config.destino === null || !config.automatica) {
    return {
      recurso: 'Planilha no destino independente',
      estado: 'Não configurado',
      ultimoSucesso: null,
      detalhe: `${!config.automatica ? 'Atualização automática desativada. ' : ''}${config.destino === null ? 'Destino independente não configurado (PLANILHA_DESTINO): a planilha é gerada só no servidor, como cópia local.' : ''}`.trim(),
    };
  }
  if (s.falhasSeguidas > 0) {
    return { recurso: 'Planilha no destino independente', estado: 'Falhou', ultimoSucesso: s.ultimaPublicada?.concluidoEm ?? null, detalhe: `${String(s.falhasSeguidas)} falha(s) seguida(s); última em ${dataBr(s.ultimaFalhaEm)}: ${s.ultimaFalha ?? ''}. A última versão boa continua no destino.` };
  }
  if (s.pendentes > 0 || s.ultimaPublicada === null) {
    const atraso = s.desde === null ? null : Math.round((agora.getTime() - s.desde.getTime()) / 1_000);
    return {
      recurso: 'Planilha no destino independente',
      estado: 'Atualização pendente',
      ultimoSucesso: s.ultimaPublicada?.concluidoEm ?? null,
      detalhe: `${String(s.pendentes)} alteração(ões) aguardando${atraso === null ? '' : ` há ${String(atraso)} s`}${s.publicandoDesde ? ' · publicação em andamento' : ''}${s.ultimaPublicada === null ? ' · ainda não publicada' : ''}.`,
    };
  }
  return { recurso: 'Planilha no destino independente', estado: 'Atualizada', ultimoSucesso: s.ultimaPublicada.concluidoEm, detalhe: `Versão ${String(s.ultimaPublicada.versao)} com os dados de ${dataBr(s.ultimaPublicada.instanteSnapshot)}.` };
}
