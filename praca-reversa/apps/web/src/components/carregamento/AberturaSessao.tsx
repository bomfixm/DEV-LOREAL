import { useEffect } from 'react';
import { encerrarAbertura, useAberturaTocando } from './abertura';
import './carregamento.css';

/** Margem de segurança: se o fim da animação não chegar (aba em segundo plano), encerra assim mesmo. */
const LIMITE_MS = 1500;

/**
 * Abertura pós-login (D334): cerca de 1,1 s, por cima da tela já montada, sem
 * bloquear cliques (pointer-events: none). A primeira tela é preparada em
 * paralelo; ao sair, o indicador de carregamento só aparece se a busca já
 * tiver passado de 1,5 s (contagem desde o início da busca).
 */
export function AberturaSessao() {
  const tocando = useAberturaTocando();
  useEffect(() => {
    if (!tocando) return;
    const seguranca = window.setTimeout(encerrarAbertura, LIMITE_MS);
    return () => {
      window.clearTimeout(seguranca);
    };
  }, [tocando]);
  if (!tocando) return null;
  return (
    <div
      className="abertura"
      aria-hidden="true"
      data-testid="abertura"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) encerrarAbertura();
      }}
    >
      <div className="abertura-palco">
        <p className="abertura-titulo">Praça Reversa</p>
        <span className="abertura-traco" />
        <p className="abertura-operacao">Operação L’Oréal</p>
      </div>
    </div>
  );
}
