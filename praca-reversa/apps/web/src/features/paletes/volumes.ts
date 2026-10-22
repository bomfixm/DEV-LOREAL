import { compararQuantidades, somarQuantidades } from '@praca-reversa/contracts';
import { formatarQuantidade } from '../../utils/numeros';

/** Situação dos volumes: contados e previstos ficam separados mesmo quando a tela mostra um só valor. */
export type SituacaoVolumes = 'iguais' | 'falta' | 'excesso' | 'sem-previsto' | 'pendente';

export interface VolumesApresentados {
  texto: string;
  situacao: SituacaoVolumes;
  /** Divergência: identifica a ordem dos números ("contados / previstos"). */
  legenda: string | null;
}

/**
 * Regra de exibição (cadastro de conteúdo, out. 2026): iguais → "10 volumes";
 * divergentes → "8 / 10 volumes" (contados / previstos); previsto ausente →
 * "10 volumes · previsto não informado"; contagem ausente → "Aguardando
 * conferência" (nunca zero). O previsto nunca é preenchido com o contado.
 */
export function apresentarVolumes(contados: string | null, previstos: string | null): VolumesApresentados {
  if (contados === null) {
    return {
      texto: previstos === null ? 'Aguardando conferência' : `Aguardando conferência · ${formatarQuantidade(previstos)} previstos`,
      situacao: 'pendente',
      legenda: null,
    };
  }
  const n = formatarQuantidade(contados);
  if (previstos === null) return { texto: `${n} volumes · previsto não informado`, situacao: 'sem-previsto', legenda: null };
  const comparacao = compararQuantidades(contados, previstos);
  if (comparacao === 0) return { texto: `${n} volumes`, situacao: 'iguais', legenda: null };
  return { texto: `${n} / ${formatarQuantidade(previstos)} volumes`, situacao: comparacao < 0 ? 'falta' : 'excesso', legenda: 'contados / previstos' };
}

/** Volumes do palete: soma das contagens dos conteúdos deste palete (nunca o total da nota); os sem contagem ficam à parte. */
export function volumesDoPalete(itens: readonly { count: { counted: string | null } }[]): { total: string | null; pendentes: number } {
  const conhecidos = itens.flatMap((i) => (i.count.counted === null ? [] : [i.count.counted]));
  return { total: conhecidos.length === 0 ? null : somarQuantidades(conhecidos), pendentes: itens.length - conhecidos.length };
}

/** Sequência FULL como informada ("01\\07" na planilha) apresentada como "1/7"; vários marcadores ficam juntos ("1/2 e 2/2"). */
export function textoSequenciaFull(marcador: string | null): string | null {
  if (marcador === null || marcador.trim() === '') return null;
  const partes = [...marcador.matchAll(/(\d+)\s*[\\/]\s*(\d+)/g)].map((m) => `${String(Number(m[1]))}/${String(Number(m[2]))}`);
  return partes.length === 0 ? marcador.trim() : partes.join(' e ');
}
