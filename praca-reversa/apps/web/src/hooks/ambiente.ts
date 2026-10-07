import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(consulta: string): boolean {
  const assinar = useCallback(
    (avisar: () => void) => {
      const lista = window.matchMedia(consulta);
      lista.addEventListener('change', avisar);
      return () => {
        lista.removeEventListener('change', avisar);
      };
    },
    [consulta],
  );
  return useSyncExternalStore(
    assinar,
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}

function assinarConexao(avisar: () => void): () => void {
  window.addEventListener('online', avisar);
  window.addEventListener('offline', avisar);
  return () => {
    window.removeEventListener('online', avisar);
    window.removeEventListener('offline', avisar);
  };
}

/** Estado de rede informado pelo navegador; a disponibilidade da API é verificada à parte. */
export function useConectado(): boolean {
  return useSyncExternalStore(
    assinarConexao,
    () => navigator.onLine,
    () => true,
  );
}
