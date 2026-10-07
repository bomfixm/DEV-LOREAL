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
