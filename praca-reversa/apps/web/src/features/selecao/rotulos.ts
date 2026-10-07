import type { ContextoDocumentoSelecao, ModalidadeSelecao, SituacaoConciliacao } from '@praca-reversa/contracts';

export const ROTULOS_MODALIDADE: Record<ModalidadeSelecao, string> = {
  LISTA: 'Lista já selecionada',
  MARCACAO: 'Inventário com marcação',
};

export const ROTULOS_CONTEXTO_NF: Record<ContextoDocumentoSelecao, string> = {
  DOCUMENTO_INVENTARIO: 'NF como documento do inventário (TIPO + NUMERO)',
  ORIGEM_DEVOLUCAO: 'NF como origem da devolução nos registros',
  OUTRA_REFERENCIA: 'Outra referência (comparada como texto)',
};

/** Marcador textual de cada situação (a cor nunca é o único sinal). */
export const MARCADOR_SITUACAO: Record<SituacaoConciliacao, string> = {
  LOCALIZADO: '✓',
  LOCALIZADO_COM_RESTRICAO: '⚠',
  DOCUMENTO_SEM_PALETE: '▤',
  PALETE_SEM_ENDERECO: '?',
  NAO_ENCONTRADO: '∅',
  AMBIGUO: '≠',
  APENAS_HISTORICO: '⟲',
  QUANTIDADE_NAO_ATENDIDA: '−',
  INFORMACAO_PENDENTE: '…',
};

/** Filtros rápidos pedidos na tela (cada um agrupa situações). */
export const FILTROS_RAPIDOS: readonly { rotulo: string; situacoes: readonly SituacaoConciliacao[] }[] = [
  { rotulo: 'Localizados', situacoes: ['LOCALIZADO'] },
  { rotulo: 'Sem palete', situacoes: ['DOCUMENTO_SEM_PALETE'] },
  { rotulo: 'Sem endereço', situacoes: ['PALETE_SEM_ENDERECO'] },
  { rotulo: 'Não encontrados', situacoes: ['NAO_ENCONTRADO'] },
  { rotulo: 'Ambíguos', situacoes: ['AMBIGUO'] },
  { rotulo: 'Divergência de quantidade', situacoes: ['QUANTIDADE_NAO_ATENDIDA'] },
  { rotulo: 'Restrições', situacoes: ['LOCALIZADO_COM_RESTRICAO'] },
  { rotulo: 'Histórico / pendente', situacoes: ['APENAS_HISTORICO', 'INFORMACAO_PENDENTE'] },
];
