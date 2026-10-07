import type { FiltroPendencia, MotivoClaim, OrdemClaims, PrioridadeClaim, SituacaoClaim } from '@praca-reversa/contracts';

export interface Filtros {
  texto: string;
  motivo: MotivoClaim | '';
  situacao: SituacaoClaim | 'ABERTOS' | '';
  responsavel: string;
  prazo: '' | 'VENCIDO' | 'PROXIMOS_7_DIAS' | 'COM_PRAZO' | 'SEM_PRAZO';
  pendencia: FiltroPendencia | '';
  prioridade: PrioridadeClaim | 'NENHUMA' | '';
  ordem: OrdemClaims | '';
  pagina: number;
}

export const VAZIOS: Filtros = { texto: '', motivo: '', situacao: '', responsavel: '', prazo: '', pendencia: '', prioridade: '', ordem: '', pagina: 1 };
export const ABERTOS: SituacaoClaim[] = ['EM_ANALISE', 'BUSCA_EM_ANDAMENTO', 'CANDIDATO_LOCALIZADO', 'VALIDACAO_PENDENTE'];

/** Filtros da lista guardados só na memória da aba (voltar do detalhe preserva o contexto). */
export const memoria = new Map<string, Filtros>();
export function limparMemoriaClaims(): void {
  memoria.clear();
}

