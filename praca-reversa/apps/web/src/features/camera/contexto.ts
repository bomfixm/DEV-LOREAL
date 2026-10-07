import type { ContextoLeitura } from '@praca-reversa/contracts';
import { useVersao } from '../../api/versao';
import { CAMINHO_BASE } from '../../base';

/** Origens desta instalação (aberta agora e a das etiquetas) e caminho-base, para reconhecer QR internos. */
export function useContextoLeitura(): ContextoLeitura {
  const etiquetas = useVersao().servidor?.labelOrigin ?? null;
  const origens = etiquetas !== null && etiquetas !== window.location.origin ? [window.location.origin, etiquetas] : [window.location.origin];
  return { origens, caminhoBase: CAMINHO_BASE };
}
