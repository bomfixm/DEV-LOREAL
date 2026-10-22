import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icone"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconeMais = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconeMenos = () => (
  <Svg>
    <path d="M5 12h14" />
  </Svg>
);

export const IconeVisaoGeral = () => (
  <Svg>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </Svg>
);

export const IconeAlvo = () => (
  <Svg>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Svg>
);

export const IconeMapa = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 10h18M9 4v16M15 4v16" />
  </Svg>
);

export const IconeLista = () => (
  <Svg>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);

export const IconeFechar = () => (
  <Svg>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconeVoltar = () => (
  <Svg>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const IconeAtualizar = () => (
  <Svg>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </Svg>
);

export const IconeImprimir = () => (
  <Svg>
    <path d="M7 9V3h10v6M7 17H4v-7h16v7h-3" />
    <rect x="7" y="14" width="10" height="7" />
  </Svg>
);

export const IconeQr = () => (
  <Svg>
    <rect x="4" y="4" width="6" height="6" />
    <rect x="14" y="4" width="6" height="6" />
    <rect x="4" y="14" width="6" height="6" />
    <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
  </Svg>
);

export const IconeBusca = () => (
  <Svg>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Svg>
);

export const IconeArquivo = () => (
  <Svg>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9 13h6M9 17h6" />
  </Svg>
);

export const IconePrancheta = () => (
  <Svg>
    <path d="M9 4h6v3H9z" />
    <path d="M9 5.5H6v15h12v-15h-3M9 12h6M9 16h4" />
  </Svg>
);

export const IconeCaixa = () => (
  <Svg>
    <path d="M3.5 8 12 4l8.5 4v8L12 20l-8.5-4z" />
    <path d="M3.5 8 12 12l8.5-4M12 12v8" />
  </Svg>
);

export const IconeCalendario = () => (
  <Svg>
    <path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" />
  </Svg>
);

/** Painéis (gráfico de barras). */
export const IconePainel = () => (
  <Svg>
    <path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" />
  </Svg>
);

/** Tema claro. */
export const IconeSol = () => (
  <Svg>
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

/** Tema escuro. */
export const IconeLua = () => (
  <Svg>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Svg>
);

/** Abrir a lista correspondente (seta para cima e à direita). */
export const IconeAbrir = () => (
  <Svg>
    <path d="M7 17 17 7M9 7h8v8" />
  </Svg>
);

/** Menu lateral: expandir (setas para a direita) e recolher (para a esquerda). */
export const IconeExpandirMenu = () => (
  <Svg>
    <path d="M6 6l6 6-6 6M13 6l6 6-6 6" />
  </Svg>
);

export const IconeRecolherMenu = () => (
  <Svg>
    <path d="M18 6l-6 6 6 6M11 6l-6 6 6 6" />
  </Svg>
);

/** "Mais" (demais páginas). */
export const IconeReticencias = () => (
  <Svg>
    <path d="M5 12h.01M12 12h.01M19 12h.01" />
  </Svg>
);

/** Posição na praça (marcador de local). */
export const IconePosicao = () => (
  <Svg>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);

/** Mudança de localização (setas nos dois sentidos). */
export const IconeSetas = () => (
  <Svg>
    <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />
  </Svg>
);

/** Informação (sobre os números, metodologia). */
export const IconeInfo = () => (
  <Svg>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);
