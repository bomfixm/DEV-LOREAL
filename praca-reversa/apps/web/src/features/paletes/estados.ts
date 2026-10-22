import type {
  CondicaoMaterial,
  EstadoConferencia,
  EstadoFluxo,
  EstadoLiberacao,
} from '@praca-reversa/contracts';

export interface RotuloEstado {
  /** Texto completo exibido no detalhe e na lista. */
  texto: string;
  /** Texto curto para o mapa. */
  curto: string;
  /** Marcador não cromático que acompanha a cor. */
  marcador: string;
  descricao: string;
}

export const ROTULOS_CONFERENCIA: Record<EstadoConferencia, RotuloEstado> = {
  NAO_CONFERIDO: {
    texto: 'Não conferido',
    curto: 'Não conferido',
    marcador: '?',
    descricao: 'Conteúdo físico desconhecido.',
  },
  PARCIAL: {
    texto: 'Conferência parcial',
    curto: 'Parcial',
    marcador: '½',
    descricao: 'Parte do conteúdo foi observada; o restante continua desconhecido.',
  },
  AGUARDANDO_VALIDACAO: {
    texto: 'Contado, aguardando validação',
    curto: 'Aguarda validação',
    marcador: '…',
    descricao: 'Contagem registrada; ainda não é saldo validado.',
  },
  RECONCILIADO: {
    texto: 'Reconciliado',
    curto: 'Reconciliado',
    marcador: '✓',
    descricao: 'Saldo validado após conferência e reconciliação.',
  },
};

export const ROTULOS_LIBERACAO: Record<EstadoLiberacao, string> = {
  PENDENTE: 'Liberação pendente',
  BLOQUEADO: 'Bloqueado',
  LIBERADO: 'Liberado',
};

export const ROTULOS_FLUXO: Record<EstadoFluxo, string> = {
  EM_ESTOQUE: 'Em estoque',
  RESERVADO: 'Reservado',
  EXPEDIDO: 'Expedido',
  VAZIO_ARQUIVADO: 'Vazio arquivado',
};

export const ROTULOS_CONDICAO: Record<CondicaoMaterial, string> = {
  SAUDAVEL: 'Saudável',
  AVARIADO: 'Avariado',
  EM_AVALIACAO: 'Em avaliação',
};

/** Estado de conferência exibido: SKU avançada prevalece; senão, a conferência de volumes (tabela). */
export type EstadoExibido = EstadoConferencia | 'CONFERIDO' | 'CONFERIDO_COM_DIFERENCA';

const ROTULOS_VOLUMES: Record<'CONFERIDO' | 'CONFERIDO_COM_DIFERENCA', RotuloEstado> = {
  CONFERIDO: { texto: 'Conferido sem diferença', curto: 'Conferido', marcador: '✓', descricao: 'Conferência completa dos volumes, sem diferença.' },
  CONFERIDO_COM_DIFERENCA: {
    texto: 'Conferido com diferença',
    curto: 'Com diferença',
    marcador: '≠',
    descricao: 'Conferência completa dos volumes com diferença registrada (quantidade atual = a contada).',
  },
};

/**
 * Um só estado de conferência em todas as telas (mapa, janela, lista):
 * conferência por SKU em validação/reconciliada prevalece; senão vale a de
 * volumes — parcial, conferido ou com diferença. Ocupação nunca muda por isto.
 */
export function estadoExibido(p: { countState: EstadoConferencia; volumeCheck?: { state: string } | null }): { chave: EstadoExibido; rotulo: RotuloEstado } {
  if (p.countState === 'RECONCILIADO' || p.countState === 'AGUARDANDO_VALIDACAO') return { chave: p.countState, rotulo: ROTULOS_CONFERENCIA[p.countState] };
  const v = p.volumeCheck?.state;
  if (v === 'CONFERIDO' || v === 'CONFERIDO_COM_DIFERENCA') return { chave: v, rotulo: ROTULOS_VOLUMES[v] };
  if (v === 'PARCIAL') return { chave: 'PARCIAL', rotulo: { ...ROTULOS_CONFERENCIA.PARCIAL, texto: 'Conferido parcialmente', descricao: 'Parte dos conteúdos foi conferida; o restante ainda não.' } };
  return { chave: p.countState, rotulo: ROTULOS_CONFERENCIA[p.countState] };
}

export const ROTULOS_ESTADO_VOLUMES = ROTULOS_VOLUMES;
