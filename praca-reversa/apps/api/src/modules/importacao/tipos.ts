import type { ClassificacaoLinha, LimitesImportacao, MotivoLinha, SeparadorDecimal } from '@praca-reversa/contracts';
import type { LinhaTabela, Tabela } from './arquivo/ler.js';
import { textoLido } from './interpretar.js';

/** Resultado de uma linha do arquivo na prévia. */
export interface LinhaClassificada {
  numero: number;
  classificacao: ClassificacaoLinha;
  chave: string | null;
  valores: Record<string, string | null>;
  lidos: Record<string, string | null>;
  motivos: MotivoLinha[];
  avisos: MotivoLinha[];
  /** Inventário/seleção: ação proposta (vincular, criar cadastro…). */
  acao?: string | null;
}

export interface Entrada {
  tabela: Tabela;
  /** Campo → índice da coluna. */
  colunas: Readonly<Record<string, number | null>>;
  separador: SeparadorDecimal;
  limites: LimitesImportacao;
}

/** Valores como lidos no arquivo para os campos mapeados (relatório e prévia). */
export function lidosDaLinha(linha: LinhaTabela, colunas: Readonly<Record<string, number | null>>): Record<string, string | null> {
  const lidos: Record<string, string | null> = {};
  for (const [campo, coluna] of Object.entries(colunas)) lidos[campo] = coluna === null ? null : textoLido(linha.celulas[coluna]);
  return lidos;
}

export function celulaDe(linha: LinhaTabela, colunas: Readonly<Record<string, number | null>>, campo: string) {
  const coluna = colunas[campo];
  return coluna === null || coluna === undefined ? undefined : linha.celulas[coluna];
}

/**
 * Classificação final de uma linha: erro de formato/regra → inválida; mesma
 * identidade com dado diferente → conflitante; algo a gravar → válida nova;
 * tudo já existente e igual → duplicada (com o motivo).
 */
export function classificarLinha(
  erros: readonly MotivoLinha[],
  conflitos: readonly MotivoLinha[],
  nova: boolean,
  duplicidades: readonly MotivoLinha[],
): { classificacao: ClassificacaoLinha; motivos: MotivoLinha[] } {
  if (erros.length > 0) return { classificacao: 'INVALIDA', motivos: [...erros] };
  if (conflitos.length > 0) return { classificacao: 'CONFLITANTE', motivos: [...conflitos] };
  if (nova) return { classificacao: 'VALIDA_NOVA', motivos: [] };
  return { classificacao: 'DUPLICADA', motivos: [...duplicidades] };
}
