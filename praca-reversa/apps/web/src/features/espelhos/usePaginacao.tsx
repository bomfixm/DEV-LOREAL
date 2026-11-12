import type { ConteudoPalete } from '@praca-reversa/contracts';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Medidor, type EntradaMedicao, type MedidaTabela } from './FolhaEspelho';
import type { LayoutEspelho } from './layout-modelo';
import { paginarPorAltura } from './paginas';

export interface PaginasDoPalete {
  folhas: ConteudoPalete[][];
  /** Notas que não cabem nem sozinhas na área da tabela (precisam de ajuste antes de imprimir). */
  grandes: ConteudoPalete[];
}

/** Só o que muda a altura das linhas: mover o bloco ou mudar a altura não exige medir de novo. */
const assinaturaTabela = (l: LayoutEspelho): string => JSON.stringify([l.tabela, l.blocos.tabela.largura, l.blocos.tabela.estilo]);

/**
 * Pagina cada palete pelas alturas medidas com o layout dele. Enquanto uma
 * nova medição não chega, usa a anterior (a tela não pisca durante o arraste);
 * `pronto` só é verdadeiro com a medição do layout atual (a impressão espera por ele).
 */
export function usePaginacao(entradas: readonly EntradaMedicao[]): { pronto: boolean; paginas: Map<string, PaginasDoPalete>; medidor: ReactNode } {
  const [medidas, setMedidas] = useState<{ assinatura: string; mapa: Map<string, MedidaTabela> } | null>(null);
  const assinatura = useMemo(() => entradas.map((e) => `${e.chave}|${assinaturaTabela(e.layout)}`).join('\n'), [entradas]);
  const aoMedir = useCallback((a: string, mapa: Map<string, MedidaTabela>) => { setMedidas({ assinatura: a, mapa }); }, []);
  const paginas = useMemo(() => {
    const r = new Map<string, PaginasDoPalete>();
    for (const e of entradas) {
      const itens = e.palete.contents.items;
      const medida = medidas?.mapa.get(e.chave);
      if (itens.length === 0 || medida?.linhas.length !== itens.length) {
        r.set(e.chave, { folhas: [[...itens]], grandes: [] });
        continue;
      }
      const p = paginarPorAltura(medida.linhas, medida.cabecalho, e.layout.blocos.tabela.altura ?? 100);
      r.set(e.chave, { folhas: p.folhas.map((f) => f.flatMap((i) => itens[i] ?? [])), grandes: p.grandes.flatMap((i) => itens[i] ?? []) });
    }
    return r;
  }, [entradas, medidas]);
  const pronto = medidas?.assinatura === assinatura;
  return { pronto, paginas, medidor: <Medidor entradas={entradas} assinatura={assinatura} aoMedir={aoMedir} /> };
}
