import type { ElementoLayout } from '@praca-reversa/contracts';
import type { ReactNode } from 'react';
import { IconeAlvo, IconeMais, IconeMenos } from '../../components/Icones';

interface Props {
  podeAmpliar: boolean;
  podeReduzir: boolean;
  /** Motivo exibido quando não há palete no mapa para centralizar. */
  bloqueioCentralizar: string | null;
  /** Zonas e blocos que podem ser enquadrados. */
  areas: readonly ElementoLayout[];
  aoAmpliar: () => void;
  aoReduzir: () => void;
  /** "Ver praça completa": inclui as posições superiores. */
  aoVisaoGeral: () => void;
  /** "Focar L'Oréal": volta ao enquadramento inicial. */
  aoFocarPrincipal: () => void;
  aoCentralizar: () => void;
  aoFocarArea: (codigo: string) => void;
  /** Ação compacta junto do seletor de zona (ex.: "Ler QR" quando a lista não está na tela). */
  extra?: ReactNode;
}

/**
 * Controles de câmera: ampliar, reduzir e centralizar num grupo compacto de
 * ícones (etapa 2) e, junto das ferramentas, os dois enquadramentos da praça
 * (20 out. 2026): "Focar L'Oréal" (vista inicial) e "Ver praça completa".
 * Nenhum deles altera endereços ou estoque.
 */
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
        <button
          type="button"
          className="botao-mapa botao-mapa--icone"
          onClick={props.aoCentralizar}
          disabled={bloqueioCentralizar !== null}
          title={bloqueioCentralizar ?? 'Centralizar o palete selecionado (C)'}
        >
          <IconeAlvo />
          <span className="visualmente-oculto">Centralizar</span>
        </button>
      </div>
      <div className="ferramentas-mapa">
        {props.extra}
        <div className="enquadramentos-mapa" role="group" aria-label="Enquadramento da praça">
          <button type="button" className="botao-mapa botao-mapa--texto" onClick={props.aoFocarPrincipal} title="Volta ao enquadramento inicial: a área da L'Oréal inteira (Home)" data-testid="focar-loreal">
            Focar L'Oréal
          </button>
          <button type="button" className="botao-mapa botao-mapa--texto" onClick={props.aoVisaoGeral} title="Mostra a praça inteira, com as posições superiores" data-testid="ver-praca-completa">
            Ver praça completa
          </button>
        </div>
        <label className="seletor-zona">
          <span className="seletor-zona-rotulo visualmente-oculto">Ir para bloco ou zona</span>
          <select
            value=""
            title="Ir para bloco ou zona"
            onChange={(evento) => {
              if (evento.target.value !== '') props.aoFocarArea(evento.target.value);
            }}
          >
            <option value="">Ir para…</option>
            {props.areas.map((area) => (
              <option key={area.id} value={area.code}>
                {area.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
