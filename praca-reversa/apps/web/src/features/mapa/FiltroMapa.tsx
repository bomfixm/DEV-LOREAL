import { ESTADOS_CONFERENCIA, type EstadoConferencia } from '@praca-reversa/contracts';
import { useEffect, useRef } from 'react';
import { IconeImprimir } from '../../components/Icones';
import { ROTULOS_CONFERENCIA } from '../paletes/estados';
import { FILTRO_VAZIO, filtroAtivo, type Filtro } from '../paletes/filtro';
import type { EstadoFiltro } from '../paletes/ListaPaletes';

interface Props {
  filtro: Filtro;
  estadoFiltro: EstadoFiltro;
  /** Paletes no resultado carregado. */
  quantidade: number;
  aoMudarFiltro: (filtro: Filtro) => void;
  aoRepetirFiltro: () => void;
  /** Enter no campo: código exato ou link/ID do QR abre o palete. */
  aoConfirmarBusca: (texto: string) => void;
  /** Etiquetas do resultado; `null` = sem permissão ou resultado grande demais. */
  aoImprimirResultado: (() => void) | null;
}

/**
 * Filtro dos paletes como ação compacta do mapa (etapa 2, com a coluna da
 * lista desativada — D254): código/posição/endereço, conferência e "precisam
 * de reconferência", consultados no servidor (o mesmo filtro da lista), que
 * esmaecem no mapa os paletes fora do resultado; etiquetas do resultado.
 */
export function FiltroMapa({ filtro, estadoFiltro, quantidade, aoMudarFiltro, aoRepetirFiltro, aoConfirmarBusca, aoImprimirResultado }: Props) {
  const ref = useRef<HTMLDetailsElement>(null);
  const ativo = filtroAtivo(filtro);
  useEffect(() => {
    const aoTocar = (evento: PointerEvent) => {
      const el = ref.current;
      if (el?.open && evento.target instanceof Node && !el.contains(evento.target)) el.open = false;
    };
    document.addEventListener('pointerdown', aoTocar);
    return () => {
      document.removeEventListener('pointerdown', aoTocar);
    };
  }, []);
  return (
    <details
      ref={ref}
      className="filtro-mapa"
      data-testid="filtro-mapa"
      onKeyDown={(evento) => {
        if (evento.key === 'Escape' && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary className="botao-mapa botao-mapa--texto" data-ativo={ativo ? 'sim' : undefined}>
        Filtrar
        {ativo && estadoFiltro.estado === 'pronto' && <span className="filtro-mapa-contagem">{estadoFiltro.total}</span>}
      </summary>
      <div className="filtro-mapa-painel" role="search" aria-label="Filtrar paletes">
        <label className="campo">
          <span className="campo-rotulo">Código, posição ou link do QR</span>
          <input
            type="search"
            value={filtro.texto}
            placeholder="Ex.: PAL-DEMO-002, F01-P03 ou 15 - A120"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            onChange={(e) => {
              aoMudarFiltro({ ...filtro, texto: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                aoConfirmarBusca(filtro.texto);
              }
            }}
          />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Conferência</span>
          <select
            value={filtro.conferencia}
            onChange={(e) => {
              aoMudarFiltro({ ...filtro, conferencia: e.target.value as EstadoConferencia | 'TODOS' });
            }}
          >
            <option value="TODOS">Todas as situações</option>
            {ESTADOS_CONFERENCIA.map((estado) => (
              <option key={estado} value={estado}>
                {ROTULOS_CONFERENCIA[estado].texto}
              </option>
            ))}
          </select>
        </label>
        <label className="opcao" data-testid="filtro-reconferencia">
          <input
            type="checkbox"
            checked={filtro.reconferencia === true}
            onChange={(e) => {
              aoMudarFiltro({ ...filtro, reconferencia: e.target.checked });
            }}
          />
          <span>
            <span aria-hidden="true">⟳</span> Precisam de reconferência
          </span>
        </label>
        <p aria-live="polite" data-testid="contagem-lista">
          {estadoFiltro.estado === 'filtrando'
            ? 'Filtrando no servidor…'
            : estadoFiltro.estado === 'pronto'
              ? `${String(quantidade)} de ${String(estadoFiltro.total)} paletes no resultado (os demais ficam esmaecidos no mapa)`
              : 'Sem filtro: todos os paletes no mapa.'}
        </p>
        {estadoFiltro.estado === 'pronto' && estadoFiltro.truncado && (
          <p className="filtro-nota" role="status">
            Mostrando os primeiros {quantidade} de {estadoFiltro.total}. Refine o filtro.
          </p>
        )}
        {estadoFiltro.estado === 'erro' && (
          <div className="estado-erro" role="alert">
            <p>Não foi possível filtrar. {estadoFiltro.mensagem}</p>
            <button type="button" className="botao-secundario botao-compacto" onClick={aoRepetirFiltro}>
              Tentar novamente
            </button>
          </div>
        )}
        <div className="acoes-linha">
          {ativo && (
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                aoMudarFiltro(FILTRO_VAZIO);
              }}
            >
              Limpar filtro
            </button>
          )}
          {aoImprimirResultado !== null && estadoFiltro.estado === 'pronto' && quantidade > 0 && (
            <button type="button" className="botao-secundario botao-compacto" onClick={aoImprimirResultado} data-testid="etiquetas-resultado">
              <IconeImprimir />
              Etiquetas do resultado ({quantidade})
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
