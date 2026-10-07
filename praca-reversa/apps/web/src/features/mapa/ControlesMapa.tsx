import type { ElementoLayout } from '@praca-reversa/contracts';
import { IconeAlvo, IconeMais, IconeMenos, IconeVisaoGeral } from '../../components/Icones';

interface Props {
  podeAmpliar: boolean;
  podeReduzir: boolean;
  /** Motivo exibido quando não há palete no mapa para centralizar. */
  bloqueioCentralizar: string | null;
  /** Zonas e blocos que podem ser enquadrados. */
  areas: readonly ElementoLayout[];
  aoAmpliar: () => void;
  aoReduzir: () => void;
  aoVisaoGeral: () => void;
  aoCentralizar: () => void;
  aoFocarArea: (codigo: string) => void;
}

/** Controles de câmera. Nenhum deles altera endereços ou estoque. */
export function ControlesMapa(props: Props) {
  const { bloqueioCentralizar } = props;
  return (
    <>
      <div className="controles-mapa" role="group" aria-label="Navegação do mapa">
        <button type="button" className="botao-mapa" onClick={props.aoAmpliar} disabled={!props.podeAmpliar} aria-label="Ampliar" title="Ampliar (+)">
          <IconeMais />
        </button>
        <button type="button" className="botao-mapa" onClick={props.aoReduzir} disabled={!props.podeReduzir} aria-label="Reduzir" title="Reduzir (−)">
          <IconeMenos />
        </button>
        <button type="button" className="botao-mapa botao-mapa--texto" onClick={props.aoVisaoGeral} title="Enquadrar a praça inteira (Home)">
          <IconeVisaoGeral />
          <span>Visão geral</span>
        </button>
        <button
          type="button"
          className="botao-mapa botao-mapa--texto"
          onClick={props.aoCentralizar}
          disabled={bloqueioCentralizar !== null}
          title={bloqueioCentralizar ?? 'Centralizar o palete selecionado (C)'}
        >
          <IconeAlvo />
          <span>Centralizar</span>
        </button>
      </div>
      <label className="seletor-zona">
        <span className="seletor-zona-rotulo">Ir para bloco ou zona</span>
        <select
          value=""
          onChange={(evento) => {
            if (evento.target.value !== '') props.aoFocarArea(evento.target.value);
          }}
        >
          <option value="">Escolher…</option>
          {props.areas.map((area) => (
            <option key={area.id} value={area.code}>
              {area.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
