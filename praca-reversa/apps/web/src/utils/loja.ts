import { useSyncExternalStore } from 'react';

/** Estado fora do React (sobrevive à troca de tela), lido com useSyncExternalStore. */
export interface Loja<T> {
  ler: () => T;
  definir: (novo: T | ((atual: T) => T)) => void;
  assinar: (ouvinte: () => void) => () => void;
}

export function criarLoja<T>(inicial: T): Loja<T> {
  let atual = inicial;
  const ouvintes = new Set<() => void>();
  return {
    ler: () => atual,
    definir: (novo) => {
      const proximo = typeof novo === 'function' ? (novo as (a: T) => T)(atual) : novo;
      if (Object.is(proximo, atual)) return;
      atual = proximo;
      for (const ouvinte of [...ouvintes]) ouvinte();
    },
    assinar: (ouvinte) => {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
  };
}

export function useLoja<T>(loja: Loja<T>): T {
  return useSyncExternalStore(loja.assinar, loja.ler, loja.ler);
}
