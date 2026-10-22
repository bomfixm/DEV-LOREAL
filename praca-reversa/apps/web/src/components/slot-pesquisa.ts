import { useSyncExternalStore } from 'react';

/**
 * Espaço da pesquisa em destaque no cabeçalho do mapa (computador). O
 * cabeçalho registra o elemento pela ref; o painel da busca coloca ali a
 * caixa de pesquisa (portal), mantendo estado e resultados no próprio painel.
 */
let elemento: HTMLElement | null = null;
const ouvintes = new Set<() => void>();

export function registrarSlotPesquisa(el: HTMLElement | null): void {
  if (el === elemento) return;
  elemento = el;
  for (const avisar of ouvintes) avisar();
}

function assinar(avisar: () => void): () => void {
  ouvintes.add(avisar);
  return () => {
    ouvintes.delete(avisar);
  };
}

export function useSlotPesquisa(ativo: boolean): HTMLElement | null {
  const atual = useSyncExternalStore(assinar, () => elemento, () => null);
  return ativo ? atual : null;
}
