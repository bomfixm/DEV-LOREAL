import { useSyncExternalStore } from 'react';

/**
 * Estado do menu lateral do computador (etapa 2): compacto (só ícones, padrão)
 * ou expandido (ícones e nomes). É só uma preferência visual deste navegador
 * (não é dado da operação); sem armazenamento disponível, vale só nesta aba.
 */
export type EstadoMenu = 'compacto' | 'expandido';

const CHAVE = 'praca-reversa:menu';
const ouvintes = new Set<() => void>();
let atual: EstadoMenu | null = null;

function lerSalvo(): EstadoMenu {
  try {
    return window.localStorage.getItem(CHAVE) === 'expandido' ? 'expandido' : 'compacto';
  } catch {
    return 'compacto';
  }
}

function estado(): EstadoMenu {
  atual ??= lerSalvo();
  return atual;
}

export function escolherEstadoMenu(novo: EstadoMenu): void {
  atual = novo;
  try {
    window.localStorage.setItem(CHAVE, novo);
  } catch {
    // Armazenamento bloqueado: vale só nesta aba.
  }
  for (const avisar of ouvintes) avisar();
}

function assinar(avisar: () => void): () => void {
  ouvintes.add(avisar);
  return () => {
    ouvintes.delete(avisar);
  };
}

export function useEstadoMenu(): EstadoMenu {
  return useSyncExternalStore(assinar, estado, () => 'compacto');
}
