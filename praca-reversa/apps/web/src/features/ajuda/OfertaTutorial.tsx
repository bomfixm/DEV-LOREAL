import { adiarTutorial, usePreferencia, useTutorial } from './estado';

/**
 * Convite do primeiro acesso (etapa 10): uma faixa, não uma janela — não
 * bloqueia a operação. "Começar" abre o tutorial; "Agora não" guarda a escolha
 * (o tutorial continua em Ajuda → Começar aqui).
 */
export function OfertaTutorial({ usuarioId, aoComecar }: { usuarioId: string; aoComecar: () => void }) {
  const preferencia = usePreferencia(usuarioId);
  const tutorial = useTutorial();
  if (preferencia?.state !== 'NAO_INICIADO' || tutorial.ativo) return null;
  return (
    <section className="oferta-tutorial" aria-label="Começar aqui" data-testid="oferta-tutorial">
      <p>
        <strong>Primeira vez aqui?</strong> Aprenda a encontrar um produto e o palete onde ele está, em 6 passos curtos. O tutorial só
        aponta os botões; não grava nada.
      </p>
      <div className="oferta-acoes">
        <button type="button" className="botao-primario botao-compacto" onClick={aoComecar} data-testid="oferta-comecar">
          Começar
        </button>
        <button
          type="button"
          className="botao-secundario botao-compacto"
          onClick={() => {
            adiarTutorial(usuarioId);
          }}
          data-testid="oferta-agora-nao"
        >
          Agora não
        </button>
      </div>
    </section>
  );
}
