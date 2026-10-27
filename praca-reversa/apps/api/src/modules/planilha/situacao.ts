/**
 * Estados da planilha e da proteção (26 out. 2026), pela evidência registrada
 * de cada item — nunca verde só porque o servidor responde:
 *
 * - Atualizada: a última revisão/cópia está confirmada onde deveria estar;
 * - Atualizando: trabalho em andamento agora (concessão ativa);
 * - Aguardando: há alteração ou cópia na fila, ainda dentro do alvo;
 * - Atrasada: na fila além do prazo configurado (ou cópia vencida);
 * - Falhou: a última tentativa falhou depois do último sucesso;
 * - Não configurado: falta o destino independente (ou o configurado não é
 *   independente), ou nunca houve evidência válida (teste com dados fictícios
 *   não conta como teste dos dados atuais).
 */
import type { ConfigPlanilha } from '../protecao/configuracao.js';
import type { ResumoEnvio, ResumoProtecao } from './dados.js';

export type { ConfigPlanilha } from '../protecao/configuracao.js';

export type Estado = 'Atualizada' | 'Atualizando' | 'Aguardando' | 'Atrasada' | 'Falhou' | 'Não configurado';

export interface ItemSituacao {
  recurso: string;
  estado: Estado;
  ultimoSucesso: Date | null;
  detalhe: string;
}

const BRASILIA = 'America/Sao_Paulo';
export const dataHoraBr = (d: Date | null) => (d === null ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: BRASILIA }).format(d));
const tamanho = (b: bigint | number | null) => (b === null ? '' : `${(Number(b) / 1_048_576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`);
const segundos = (ms: number) => (ms < 120_000 ? `${String(Math.round(ms / 1_000))} s` : `${String(Math.round(ms / 60_000))} min`);

export interface ControleLido {
  revisaoDados: number;
  revisaoPublicada: number;
  falhasSeguidas: number;
  ultimaFalha: string | null;
  ultimaFalhaEm: Date | null;
  envioFalhas: number;
  envioUltimaFalha: string | null;
  envioUltimaFalhaEm: Date | null;
  publicandoDesde: Date | null;
}

export interface GeracaoLida {
  revisao: number;
  concluidoEm: Date;
  instanteDados: Date;
}

/** Destino independente: configurado e independente, ou por que não. */
export function estadoDestino(config: ConfigPlanilha, demo: boolean, ultimoEnvio: ResumoEnvio | null, falha: { em: Date | null; mensagem: string | null }): ItemSituacao {
  const recurso = 'Destino independente';
  if (demo) return { recurso, estado: 'Não configurado', ultimoSucesso: null, detalhe: 'Escopo de demonstração: dados fictícios nunca vão para o destino da operação.' };
  const d = config.destino;
  if (d === null) return { recurso, estado: 'Não configurado', ultimoSucesso: null, detalhe: 'PLANILHA_DESTINO não configurado: a planilha fica só no servidor do aplicativo (não protege contra a perda do servidor).' };
  if (!d.independente) return { recurso, estado: 'Não configurado', ultimoSucesso: null, detalhe: `${d.descricao}: ${d.motivo ?? 'não é independente do servidor.'}` };
  if (falha.em !== null && (ultimoEnvio === null || falha.em > ultimoEnvio.concluidoEm)) {
    return { recurso, estado: 'Falhou', ultimoSucesso: ultimoEnvio?.concluidoEm ?? null, detalhe: `${d.descricao} · última gravação falhou em ${dataHoraBr(falha.em)}: ${falha.mensagem ?? ''}` };
  }
  if (ultimoEnvio === null) return { recurso, estado: 'Aguardando', ultimoSucesso: null, detalhe: `${d.descricao} · configurado; nenhuma gravação confirmada ainda.` };
  return { recurso, estado: 'Atualizada', ultimoSucesso: ultimoEnvio.concluidoEm, detalhe: `${d.descricao} · gravação confirmada (relida e conferida pelo SHA-256) em ${dataHoraBr(ultimoEnvio.concluidoEm)}.` };
}

/** Geração local (cópia no servidor, para download). */
export function estadoGeracao(config: ConfigPlanilha, demo: boolean, c: ControleLido, pendentes: { quantidade: number; desde: Date | null }, ultima: GeracaoLida | null, agora: Date): ItemSituacao {
  const recurso = 'Geração local (servidor)';
  const base = ultima === null ? 'Nenhuma revisão gerada ainda.' : `Revisão ${String(ultima.revisao)} com os dados de ${dataHoraBr(ultima.instanteDados)}.`;
  if (c.falhasSeguidas > 0) return { recurso, estado: 'Falhou', ultimoSucesso: ultima?.concluidoEm ?? null, detalhe: `${String(c.falhasSeguidas)} falha(s) seguida(s); última em ${dataHoraBr(c.ultimaFalhaEm)}: ${c.ultimaFalha ?? ''} A última revisão boa continua valendo. ${base}` };
  if (c.publicandoDesde !== null) return { recurso, estado: 'Atualizando', ultimoSucesso: ultima?.concluidoEm ?? null, detalhe: `Gerando ou enviando desde ${dataHoraBr(c.publicandoDesde)}. ${base}` };
  // Demonstração: gerada só por pedido ("Tentar novamente agora"), nunca pelo trabalhador.
  if (demo && (pendentes.quantidade > 0 || ultima === null)) {
    return { recurso, estado: 'Aguardando', ultimoSucesso: ultima?.concluidoEm ?? null, detalhe: `Escopo de demonstração: a planilha é gerada só quando pedida ("Tentar novamente agora"); ${String(pendentes.quantidade)} alteração(ões) desde a última. ${base}` };
  }
  if (pendentes.quantidade > 0 || ultima === null) {
    const espera = pendentes.desde === null ? 0 : agora.getTime() - pendentes.desde.getTime();
    return {
      recurso,
      estado: espera > config.atrasoMs ? 'Atrasada' : 'Aguardando',
      ultimoSucesso: ultima?.concluidoEm ?? null,
      detalhe: `${String(pendentes.quantidade)} alteração(ões) confirmada(s) aguardando${pendentes.desde ? ` há ${segundos(espera)}` : ''} (revisão ${String(c.revisaoDados + 1)}). ${base}`,
    };
  }
  return { recurso, estado: 'Atualizada', ultimoSucesso: ultima.concluidoEm, detalhe: base };
}

/** Planilha no destino independente: a revisão gerada mais recente precisa estar confirmada lá. */
export function estadoPublicacao(config: ConfigPlanilha, demo: boolean, c: ControleLido, pendentes: { quantidade: number; desde: Date | null }, ultima: GeracaoLida | null, publicada: ResumoEnvio | null, agora: Date): ItemSituacao {
  const recurso = 'Planilha no destino independente';
  const d = config.destino;
  if (demo || !d?.independente) return { recurso, estado: 'Não configurado', ultimoSucesso: null, detalhe: demo ? 'Escopo de demonstração (só geração local).' : 'Sem destino independente: nenhuma cópia fora do servidor.' };
  const base = publicada === null ? 'Nenhuma revisão publicada ainda.' : `Revisão ${publicada.referencia} publicada em ${dataHoraBr(publicada.concluidoEm)}.`;
  if (c.envioFalhas > 0) return { recurso, estado: 'Falhou', ultimoSucesso: publicada?.concluidoEm ?? null, detalhe: `${String(c.envioFalhas)} falha(s) seguida(s) no envio; última em ${dataHoraBr(c.envioUltimaFalhaEm)}: ${c.envioUltimaFalha ?? ''} A última cópia boa continua no destino. ${base}` };
  if (c.publicandoDesde !== null) return { recurso, estado: 'Atualizando', ultimoSucesso: publicada?.concluidoEm ?? null, detalhe: `Trabalho em andamento desde ${dataHoraBr(c.publicandoDesde)}. ${base}` };
  const atrasoEnvio = ultima !== null && c.revisaoPublicada < ultima.revisao;
  if (pendentes.quantidade > 0 || atrasoEnvio || ultima === null) {
    const desde = [pendentes.desde, atrasoEnvio ? ultima.concluidoEm : null].filter((x): x is Date => x !== null).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const espera = desde === null ? 0 : agora.getTime() - desde.getTime();
    return {
      recurso,
      estado: espera > config.atrasoMs ? 'Atrasada' : 'Aguardando',
      ultimoSucesso: publicada?.concluidoEm ?? null,
      detalhe: `${atrasoEnvio ? `Revisão ${String(ultima.revisao)} gerada e aguardando envio` : `${String(pendentes.quantidade)} alteração(ões) aguardando a revisão ${String(c.revisaoDados + 1)}`}${desde ? ` há ${segundos(espera)}` : ''}. ${base}`,
    };
  }
  return { recurso, estado: 'Atualizada', ultimoSucesso: publicada?.concluidoEm ?? null, detalhe: base };
}

/** Versão anterior preservada no destino (a publicada antes da atual). */
export function estadoVersaoAnterior(config: ConfigPlanilha, demo: boolean, anterior: ResumoEnvio | null): ItemSituacao {
  const recurso = 'Versão anterior preservada';
  if (demo || !config.destino?.independente) return { recurso, estado: 'Não configurado', ultimoSucesso: null, detalhe: 'Sem destino independente: as versões anteriores ficam só na pasta local do servidor (download pelo aplicativo).' };
  if (anterior === null) return { recurso, estado: 'Aguardando', ultimoSucesso: null, detalhe: 'Ainda não há versão anterior publicada no destino.' };
  return {
    recurso,
    estado: 'Atualizada',
    ultimoSucesso: anterior.concluidoEm,
    detalhe: `Revisão ${anterior.referencia} (${anterior.chave ?? ''}). Retenção: últimas ${String(config.retencao.ultimas)}, uma por dia por ${String(config.retencao.diariasDias)} dias e as anteriores a substituições por ${String(config.retencao.preSubstituicaoDias)} dias.`,
  };
}

/** Backup completo no destino independente. */
export function estadoBackup(
  config: ConfigPlanilha,
  local: ResumoProtecao | null,
  externo: ResumoEnvio | null,
  controle: { executandoDesde: Date | null; falhas: number; ultimaFalha: string | null; ultimaFalhaEm: Date | null },
  agora: Date,
): ItemSituacao {
  const recurso = 'Backup completo externo';
  const b = config.backup;
  const localTexto = local === null ? 'Nenhum backup verificado no servidor.' : `Último verificado no servidor: ${dataHoraBr(local.concluidoEm)} (${local.identificador ?? 'sem identificador'}, ${tamanho(local.tamanhoBytes)}).`;
  if (!b.destino?.independente) {
    return { recurso, estado: 'Não configurado', ultimoSucesso: null, detalhe: `${b.destino === null ? 'Destino independente não configurado' : `${b.destino.descricao}: ${b.destino.motivo ?? 'não independente'}`}: o backup fica no mesmo servidor e não protege contra a perda dele. ${localTexto}` };
  }
  if (controle.executandoDesde !== null) return { recurso, estado: 'Atualizando', ultimoSucesso: externo?.concluidoEm ?? null, detalhe: `Backup ou envio em andamento desde ${dataHoraBr(controle.executandoDesde)}. ${localTexto}` };
  if (controle.falhas > 0 && controle.ultimaFalhaEm !== null && (externo === null || controle.ultimaFalhaEm > externo.concluidoEm)) {
    return { recurso, estado: 'Falhou', ultimoSucesso: externo?.concluidoEm ?? null, detalhe: `Última tentativa falhou em ${dataHoraBr(controle.ultimaFalhaEm)}: ${controle.ultimaFalha ?? ''} ${localTexto}` };
  }
  if (externo === null) return { recurso, estado: 'Aguardando', ultimoSucesso: null, detalhe: `Nenhum backup confirmado no destino ainda. ${localTexto}` };
  const vencido = agora.getTime() - externo.concluidoEm.getTime() > b.prazoHoras * 3_600_000;
  return {
    recurso,
    estado: vencido ? 'Atrasada' : 'Atualizada',
    ultimoSucesso: externo.concluidoEm,
    detalhe: `Backup ${externo.referencia} confirmado em ${b.destino.descricao} em ${dataHoraBr(externo.concluidoEm)}${vencido ? ` (mais de ${String(b.prazoHoras)} h)` : ''}. Frequência: ${b.automatico ? `a cada ${String(b.intervaloHoras)} h` : 'automático desligado'} e antes de cada substituição do inventário.`,
  };
}

/** Teste de restauração: só dados reais, num banco isolado, dentro do prazo, contam. */
export function estadoRestauracao(config: ConfigPlanilha, teste: ResumoProtecao | null, agora: Date): ItemSituacao {
  const recurso = 'Teste de restauração';
  if (teste === null) return { recurso, estado: 'Não configurado', ultimoSucesso: null, detalhe: 'Teste de restauração pendente: nenhum teste registrado. Rode npm run protecao:teste-restauracao (banco isolado; nunca sobre o banco em uso).' };
  const onde = `banco isolado ${teste.ambiente ?? '?'}`;
  if (teste.dados !== 'OPERACAO') {
    return { recurso, estado: 'Não configurado', ultimoSucesso: null, detalhe: `Teste de restauração pendente: o último teste (${dataHoraBr(teste.concluidoEm)}, ${onde}) usou dados fictícios e não comprova a restauração dos dados atuais.` };
  }
  if (teste.situacao !== 'VERIFICADO') return { recurso, estado: 'Falhou', ultimoSucesso: null, detalhe: `Falhou em ${dataHoraBr(teste.concluidoEm)} (${onde}): ${teste.mensagem ?? ''}` };
  const vencido = agora.getTime() - teste.concluidoEm.getTime() > config.backup.restauracaoPrazoDias * 86_400_000;
  const origem = typeof teste.detalhes?.origem === 'string' ? (teste.detalhes.origem === 'EXTERNO' ? 'cópia do destino independente' : 'cópia local do servidor') : 'backup';
  const instante = typeof teste.detalhes?.instanteBackup === 'string' ? ` de ${dataHoraBr(new Date(teste.detalhes.instanteBackup))}` : '';
  return {
    recurso,
    estado: vencido ? 'Atrasada' : 'Atualizada',
    ultimoSucesso: teste.concluidoEm,
    detalhe: `Backup ${teste.identificador ?? '?'}${instante} (${origem}) restaurado e comparado em ${dataHoraBr(teste.concluidoEm)} no ${onde}, removido depois; dados reais da operação.${vencido ? ` Repetir: mais de ${String(config.backup.restauracaoPrazoDias)} dias.` : ''}`,
  };
}
