import type { EstadoConferencia, EstadoLiberacao } from '@praca-reversa/contracts';
import { ROTULOS_CONFERENCIA, ROTULOS_LIBERACAO, estadoExibido } from '../features/paletes/estados';

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

/** Estado de conferência exibido (volumes ou SKU), o mesmo do mapa. */
export function SeloConferenciaExibida({ palete, curto = false }: { palete: { countState: EstadoConferencia; volumeCheck?: { state: string } | null }; curto?: boolean }) {
  const { chave, rotulo } = estadoExibido(palete);
  return (
    <span className={`selo selo-conferencia selo-conferencia--${chave}`} data-testid="selo-conferencia" data-estado={chave}>
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
