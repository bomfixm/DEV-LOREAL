import type { EstadoConferencia, EstadoLiberacao } from '@praca-reversa/contracts';
import { ROTULOS_CONFERENCIA, ROTULOS_LIBERACAO } from '../features/paletes/estados';

/** Cor sempre acompanhada de texto e de um marcador não cromático. */
export function SeloConferencia({ estado, curto = false }: { estado: EstadoConferencia; curto?: boolean }) {
  const rotulo = ROTULOS_CONFERENCIA[estado];
  return (
    <span className={`selo selo-conferencia selo-conferencia--${estado}`}>
      <span className="selo-marcador" aria-hidden="true">
        {rotulo.marcador}
      </span>
      {curto ? rotulo.curto : rotulo.texto}
    </span>
  );
}

export function SeloLiberacao({ estado }: { estado: EstadoLiberacao }) {
  return <span className={`selo selo-liberacao selo-liberacao--${estado}`}>{ROTULOS_LIBERACAO[estado]}</span>;
}
