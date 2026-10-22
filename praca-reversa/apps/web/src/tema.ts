import { useSyncExternalStore } from 'react';

/**
 * Tema da tela (claro ou escuro). O papel impresso (etiquetas, relatórios)
 * continua sempre claro: as cores do escuro só valem em `@media screen`.
 * A escolha é uma preferência deste navegador (não é dado da operação); sem
 * escolha, segue o tema do sistema. O `index.html` aplica o mesmo antes da
 * primeira pintura, para a tela não piscar em branco.
 */
export type Tema = 'claro' | 'escuro';

const CHAVE = 'praca-reversa:tema';
/** Cor da barra do navegador/aplicativo instalado em cada tema. */
const COR_BARRA: Record<Tema, string> = { claro: '#FFCC00', escuro: '#0E0E10' };
const ouvintes = new Set<() => void>();

function escolhaSalva(): Tema | null {
  try {
    const valor = window.localStorage.getItem(CHAVE);
    return valor === 'claro' || valor === 'escuro' ? valor : null;
  } catch {
    return null;
  }
}

function consultaSistema(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
}

function temaDoSistema(): Tema {
  return consultaSistema()?.matches ? 'escuro' : 'claro';
}

function temaAtual(): Tema {
  return document.documentElement.dataset.tema === 'escuro' ? 'escuro' : 'claro';
}

function aplicar(tema: Tema) {
  document.documentElement.dataset.tema = tema;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_BARRA[tema]);
  for (const ouvinte of ouvintes) ouvinte();
}

/** Guarda a escolha neste navegador (sem armazenamento disponível, vale só nesta aba). */
export function escolherTema(tema: Tema) {
  try {
    window.localStorage.setItem(CHAVE, tema);
  } catch {
    // Armazenamento bloqueado (janela privada, política do navegador): aplica sem guardar.
  }
  aplicar(tema);
}

/** Aplica o tema e acompanha a troca do tema do sistema (sem escolha salva) e as outras abas. */
export function iniciarTema() {
  aplicar(escolhaSalva() ?? temaDoSistema());
  consultaSistema()?.addEventListener('change', () => {
    if (escolhaSalva() === null) aplicar(temaDoSistema());
  });
  window.addEventListener('storage', (evento) => {
    if (evento.key === CHAVE) aplicar(escolhaSalva() ?? temaDoSistema());
  });
}

export function useTema(): Tema {
  return useSyncExternalStore(
    (ouvinte) => {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
    temaAtual,
    () => 'claro',
  );
}
