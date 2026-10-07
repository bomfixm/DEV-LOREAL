import type { PaleteResumo } from '@praca-reversa/contracts';
import type { Ref } from 'react';
import { IconeAlvo, IconeFechar } from '../../components/Icones';
import { SeloConferencia } from '../../components/Selos';

interface Props {
  palete: PaleteResumo;
  verConteudoRef: Ref<HTMLButtonElement>;
  aoVerConteudo: () => void;
  aoCentralizar: () => void;
  aoFechar: () => void;
}

/** Cartão do palete selecionado no celular, sobre a base do mapa. */
export function ResumoSelecao({ palete, verConteudoRef, aoVerConteudo, aoCentralizar, aoFechar }: Props) {
  return (
    <section className="resumo-selecao" aria-label={`Palete selecionado: ${palete.code}`} data-testid="resumo-selecao">
      <div className="resumo-info">
        <p className="resumo-codigo">{palete.code}</p>
        <p className="resumo-endereco">{palete.positionCode ?? 'Sem posição registrada'}</p>
        <SeloConferencia estado={palete.countState} />
        {palete.activeCountId !== null && <span className="item-alerta item-alerta--conferencia">✎ Em conferência</span>}
      </div>
      <div className="resumo-acoes">
        <button type="button" className="botao-primario" ref={verConteudoRef} onClick={aoVerConteudo} data-tutorial="ver-conteudo">
          Ver conteúdo
        </button>
        <button
          type="button"
          className="botao-secundario botao-icone"
          onClick={aoCentralizar}
          disabled={palete.positionId === null}
          aria-label="Centralizar no mapa"
          title="Centralizar no mapa"
        >
          <IconeAlvo />
        </button>
        <button type="button" className="botao-secundario botao-icone" onClick={aoFechar} aria-label="Fechar seleção" title="Fechar seleção">
          <IconeFechar />
        </button>
      </div>
    </section>
  );
}
