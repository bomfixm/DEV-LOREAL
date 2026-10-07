import {
  ROTULOS_BASE_PESO,
  ROTULOS_METRICA,
  type CodigoPendenciaMaterial,
  type CondicaoMaterial,
  type MetricaCapacidade,
  type RestricaoJanela,
  type SituacaoPreparacao,
  type SituacaoReserva,
  type TipoEventoJanela,
  type TipoEventoLiberacao,
  type TipoOrigemDocumento,
  type TipoRetorno,
} from '@praca-reversa/contracts';
import { formatarQuantidade } from '../../utils/numeros';

export { ROTULOS_SITUACAO_JANELA, ROTULOS_METRICA, ROTULOS_BASE_PESO } from '@praca-reversa/contracts';

export const ROTULOS_SITUACAO_RESERVA: Readonly<Record<SituacaoReserva, string>> = {
  ATIVA: 'Ativa',
  LIBERADA: 'Liberada (sem saída)',
  CONSUMIDA: 'Consumida (expedida)',
  CANCELADA: 'Cancelada',
};

export const ROTULOS_PREPARACAO: Readonly<Record<SituacaoPreparacao, string>> = {
  PENDENTE: 'Preparação pendente',
  PREPARADA: 'Separada/preparada',
  DIVERGENTE: 'Separação com diferença',
};

export const ROTULOS_CONDICAO: Readonly<Record<CondicaoMaterial, string>> = { SAUDAVEL: 'Saudável', AVARIADO: 'Avariado', EM_AVALIACAO: 'Em avaliação' };
export const ROTULOS_ORIGEM: Readonly<Record<TipoOrigemDocumento, string>> = { DEVOLUCAO: 'Devolução', NOTA_FISCAL: 'Nota fiscal', MANIFESTO: 'Manifesto', OUTRO: 'Outro' };
export const ROTULOS_RETORNO: Readonly<Record<TipoRetorno, string>> = { AVISO_DOCUMENTAL: 'Aviso documental (não repõe saldo)', RECEBIMENTO_FISICO: 'Recebimento físico comprovado' };

export const ROTULOS_PENDENCIA_MATERIAL: Readonly<Record<CodigoPendenciaMaterial, string>> = {
  PALETE_BLOQUEADO: 'Palete bloqueado',
  MATERIAL_BLOQUEADO: 'Material bloqueado',
  NAO_LIBERADO: 'Não liberado',
  CONFERENCIA_PENDENTE: 'Conferência pendente',
  CONFERENCIA_EM_ANDAMENTO: 'Conferência em andamento',
  CRITERIO_CONDICAO: 'Condição não aceita',
  CRITERIO_ORIGEM: 'Origem não aceita',
  CRITERIO_LOTE: 'Lote exigido',
  CRITERIOS_PENDENTES: 'Critérios pendentes',
  VINCULADO_CLAIM: 'Vinculado a claim',
};

export const ROTULOS_EVENTO_JANELA: Readonly<Record<TipoEventoJanela, string>> = {
  JANELA_CRIADA: 'Janela cadastrada',
  JANELA_ALTERADA: 'Dados alterados',
  REGRAS_ALTERADAS: 'Regras alteradas (nova versão)',
  JANELA_CONFIRMADA: 'Janela confirmada',
  PREPARACAO_INICIADA: 'Preparação iniciada',
  JANELA_ENCERRADA: 'Janela encerrada',
  JANELA_CANCELADA: 'Janela cancelada',
  ANEXO_ENVIADO: 'Anexo enviado',
  RESERVA_CRIADA: 'Reserva criada',
  RESERVA_CANCELADA: 'Reserva cancelada',
  RESERVA_LIBERADA: 'Reserva liberada',
  PREPARACAO_REGISTRADA: 'Preparação registrada',
  MEDIDAS_ALTERADAS: 'Medidas alteradas',
  EXPEDICAO_CONFIRMADA: 'Expedição confirmada',
  EXPEDICAO_CORRIGIDA: 'Informação da expedição corrigida',
  RETORNO_REGISTRADO: 'Retorno registrado',
};

export const ROTULOS_EVENTO_LIBERACAO: Readonly<Record<TipoEventoLiberacao, string>> = {
  LIBERAR: 'Liberado',
  REVOGAR: 'Liberação revogada',
  BLOQUEAR: 'Material bloqueado',
  DESBLOQUEAR: 'Material desbloqueado',
  BLOQUEAR_PALETE: 'Palete bloqueado',
  DESBLOQUEAR_PALETE: 'Palete desbloqueado',
  AJUSTE_SALDO: 'Liberação limitada ao saldo',
  HERANCA_BLOQUEIO: 'Bloqueio herdado na transferência',
  MIGRACAO: 'Conversão da etapa 08',
};

/** "Quantidade (UN)", "Peso bruto (kg)", "Volume (m³)". */
export function rotuloMetrica(r: Pick<RestricaoJanela, 'metric' | 'unit' | 'weightBase'>): string {
  if (r.metric === 'PESO_KG') return `Peso ${r.weightBase ? ROTULOS_BASE_PESO[r.weightBase] : ''} (kg)`.replace('  ', ' ');
  if (r.metric === 'QUANTIDADE') return `Quantidade (${r.unit})`;
  return ROTULOS_METRICA[r.metric as MetricaCapacidade];
}

/** Quantidade exata em pt-BR, ou o texto informado quando pendente. */
export function q(valor: string | null, pendente = 'pendente'): string {
  return valor === null ? pendente : formatarQuantidade(valor);
}

/** "Devolução " antes da referência (tipo de origem em português), ou vazio. */
export function textoOrigem(tipo: TipoOrigemDocumento | null): string {
  return tipo === null ? '' : `${ROTULOS_ORIGEM[tipo]} `;
}
