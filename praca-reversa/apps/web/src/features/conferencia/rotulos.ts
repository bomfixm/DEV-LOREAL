import type {
  EscopoConferencia,
  ModoEntrada,
  MotivoConferencia,
  PendenciaObservacao,
  SituacaoConferencia,
  SituacaoVinculo,
  TipoEventoEstoque,
  TipoOrigemDocumento,
} from '@praca-reversa/contracts';
import { formatarQuantidade } from '../../utils/numeros';
import { ROTULOS_ORIGEM_DOCUMENTO } from '../paletes/conteudo';

export const ROTULOS_ESCOPO: Record<EscopoConferencia, { texto: string; explicacao: string }> = {
  PARCIAL: {
    texto: 'Parcial',
    explicacao:
      'Conta só uma parte física do palete (por exemplo, uma camada ou um produto). O restante continua pendente: nada é declarado ausente e o saldo do palete não é substituído.',
  },
  COMPLETA: {
    texto: 'Completa',
    explicacao:
      'Conta todo o conteúdo físico do palete. Ao concluir, você confirma que nada ficou de fora; a contagem aguarda validação antes de virar saldo.',
  },
};

/** Situação com marcador não cromático (a cor sempre acompanha texto). */
export const ROTULOS_SITUACAO: Record<SituacaoConferencia, { texto: string; marcador: string }> = {
  EM_ANDAMENTO: { texto: 'Em andamento (rascunho)', marcador: '✎' },
  CONCLUIDA: { texto: 'Concluída', marcador: '…' },
  CANCELADA: { texto: 'Cancelada', marcador: '✕' },
  RECONCILIADA: { texto: 'Reconciliada', marcador: '✓' },
  SUBSTITUIDA: { texto: 'Substituída por recontagem', marcador: '↻' },
};

export const ROTULOS_MOTIVO: Record<MotivoConferencia, string> = {
  CONFERENCIA: 'Conferência',
  RECONTAGEM: 'Recontagem',
};

export const ROTULOS_MODO: Record<ModoEntrada, { texto: string; curto: string; explicacao: string }> = {
  MANUAL: {
    texto: 'Quantidade manual',
    curto: 'Manual',
    explicacao: 'Leia ou digite o código, informe a quantidade e a unidade e confirme.',
  },
  LEITURA_UNIDADE: {
    texto: 'Uma unidade por leitura',
    curto: 'Leitura (unidade)',
    explicacao: 'Cada leitura do código da unidade soma 1 peça. Leituras repetidas somam: cada uma é uma peça real.',
  },
  LEITURA_EMBALAGEM: {
    texto: 'Uma embalagem por leitura',
    curto: 'Leitura (embalagem)',
    explicacao: 'Cada leitura soma 1 embalagem do código lido, convertida pelo fator aprovado (ex.: 1 CX = 12 UN).',
  },
};

export const ROTULOS_PENDENCIA: Record<PendenciaObservacao, string> = {
  PRODUTO_NAO_IDENTIFICADO: 'Código não cadastrado: produto não identificado',
  FATOR_DESCONHECIDO: 'Embalagem sem fator aprovado: sem conversão',
};

export const ROTULOS_VINCULO: Record<SituacaoVinculo, { texto: string; marcador: string }> = {
  CONFERE: { texto: 'Confere', marcador: '=' },
  FALTA: { texto: 'Falta', marcador: '−' },
  SOBRA: { texto: 'Sobra', marcador: '+' },
  SEM_DECLARACAO: { texto: 'Sem declaração', marcador: '?' },
  INDISPONIVEL: { texto: 'Comparação indisponível', marcador: '!' },
  PARCIAL: { texto: 'Parcial: não comparado', marcador: '½' },
};

export const ROTULOS_EVENTO: Record<TipoEventoEstoque, string> = {
  SALDO_INICIAL: 'Saldo inicial',
  AJUSTE_RECONCILIACAO: 'Ajuste de reconciliação',
  TRANSFERENCIA: 'Transferência entre paletes',
  CORRECAO_TRANSFERENCIA: 'Correção de transferência',
  EXPEDICAO: 'Baixa por expedição',
};

export function textoOrigem(tipo: TipoOrigemDocumento | null, referencia: string | null): string {
  if (tipo === null) return 'Origem pendente';
  return `${ROTULOS_ORIGEM_DOCUMENTO[tipo]}${referencia === null ? ' (referência pendente)' : ` ${referencia}`}`;
}

export function quantidadeComUnidade(quantidade: string | null, unidade: string | null): string {
  if (quantidade === null) return '—';
  return `${formatarQuantidade(quantidade)}${unidade ? ` ${unidade}` : ''}`;
}

/** Diferença com sinal explícito (−3, +2, 0), sem ponto flutuante. */
export function formatarDiferenca(diferenca: string): string {
  if (diferenca.startsWith('-')) return `−${formatarQuantidade(diferenca.slice(1))}`;
  return diferenca === '0' ? '0' : `+${formatarQuantidade(diferenca)}`;
}
