import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { LinhaTabela } from './conteudo-espelho';
import { Medidor, type EntradaMedicao, type MedidaTabela } from './FolhaEspelho';
import { blocoDe, type LayoutEspelho } from './layout-modelo';
import { paginarPorAltura } from './paginas';

export interface PaginasDoDocumento {
  folhas: LinhaTabela[][];
  /** Linhas que não cabem nem sozinhas na área da tabela (precisam de ajuste antes de imprimir). */
  grandes: LinhaTabela[];
}

/** Só o que muda a altura das linhas: mover o bloco ou mudar a altura não exige medir de novo. */
const assinaturaTabela = (l: LayoutEspelho): string => JSON.stringify([l.tabela, blocoDe(l, 'tabela').largura, blocoDe(l, 'tabela').estilo]);

/**
 * Pagina cada documento pelas alturas medidas com o layout dele. Enquanto uma
 * nova medição não chega, usa a anterior (a tela não pisca durante o arraste);
 * `pronto` só é verdadeiro com a medição do layout atual (a impressão espera por ele).
 */
export function usePaginacao(entradas: readonly EntradaMedicao[]): { pronto: boolean; paginas: Map<string, PaginasDoDocumento>; medidor: ReactNode } {
  const [medidas, setMedidas] = useState<{ assinatura: string; mapa: Map<string, MedidaTabela> } | null>(null);
  const assinatura = useMemo(() => entradas.map((e) => `${e.chave}|${assinaturaTabela(e.layout)}`).join('\n'), [entradas]);
  const aoMedir = useCallback((a: string, mapa: Map<string, MedidaTabela>) => { setMedidas({ assinatura: a, mapa }); }, []);
  const paginas = useMemo(() => {
    const r = new Map<string, PaginasDoDocumento>();
    for (const e of entradas) {
      const itens = e.documento.linhas;
      const medida = medidas?.mapa.get(e.chave);
      if (itens.length === 0 || medida?.linhas.length !== itens.length) {
        r.set(e.chave, { folhas: [[...itens]], grandes: [] });
        continue;
      }
      const p = paginarPorAltura(medida.linhas, medida.cabecalho, blocoDe(e.layout, 'tabela').altura ?? 100);
      r.set(e.chave, { folhas: p.folhas.map((f) => f.flatMap((i) => itens[i] ?? [])), grandes: p.grandes.flatMap((i) => itens[i] ?? []) });
    }
    return r;
  }, [entradas, medidas]);
  const pronto = medidas?.assinatura === assinatura;
  return { pronto, paginas, medidor: <Medidor entradas={entradas} assinatura={assinatura} aoMedir={aoMedir} /> };
}

/** Texto de aviso para uma linha que não cabe: usa as primeiras células com conteúdo. */
export const descreverLinha = (l: LinhaTabela): string => l.celulas.filter((c) => c !== '' && c !== '—').slice(0, 3).join(' · ');
