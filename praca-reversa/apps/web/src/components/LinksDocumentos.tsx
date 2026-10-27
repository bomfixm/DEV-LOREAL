import type { MouseEvent } from 'react';
import { paraEndereco } from '../base';

/**
 * Links discretos para os termos de uso e o aviso de privacidade (login e
 * menu da conta). São links de verdade (teclado, nova aba); com `aoAbrir`,
 * o clique simples navega sem recarregar a página.
 */
export function LinksDocumentos({ aoAbrir }: { aoAbrir?: (documento: 'termos' | 'privacidade') => void }) {
  const abrir = (documento: 'termos' | 'privacidade') => (e: MouseEvent<HTMLAnchorElement>) => {
    if (aoAbrir === undefined || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    aoAbrir(documento);
  };
  return (
    <p className="links-documentos">
      <a href={paraEndereco('/termos')} onClick={abrir('termos')} data-testid="link-termos">
        Termos de uso
      </a>
      <a href={paraEndereco('/privacidade')} onClick={abrir('privacidade')} data-testid="link-privacidade">
        Privacidade
      </a>
    </p>
  );
}
