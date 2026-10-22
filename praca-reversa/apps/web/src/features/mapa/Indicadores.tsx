import type { PaleteResumo } from '@praca-reversa/contracts';
import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  paletes: readonly PaleteResumo[];
  /** Posições com desocupação confirmada (desativada/ocupada nunca entram). */
  posicoesLivres: number;
  /** Paletes no resultado do filtro/busca em uso; `null` sem filtro. */
  noFiltro: number | null;
  /**
   * Sem a coluna da lista (etapa 2): as posições livres abrem a partir do
   * próprio indicador (até 30, como a lista fazia). `null` = só o número.
   */
  livres?: readonly { id: string; texto: string }[] | null;
  aoEscolherLivre?: (posicaoId: string) => void;
  /** Atalhos fora do desenho (ex.: Validação urgente — sem endereço). */
  extra?: ReactNode;
}

/** "Posições livres" com a lista curta ao tocar; fecha ao escolher, ao tocar fora ou com Esc. */
function IndicadorLivres({ total, livres, aoEscolher }: { total: number; livres: readonly { id: string; texto: string }[]; aoEscolher: (id: string) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
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
      className="indicador indicador--livre indicador--lista"
      data-testid="indicador-livres"
      onKeyDown={(evento) => {
        if (evento.key === 'Escape' && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>
        <span className="indicador-valor">{total}</span>
        <span className="indicador-rotulo">Posições livres (confirmadas)</span>
      </summary>
      <div className="indicador-lista" data-testid="posicoes-livres">
        <p>
          <span className="selo-livre">PALETE LIVRE</span> {total} posição(ões) com desocupação confirmada
        </p>
        <ul>
          {livres.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="botao-link"
                onClick={() => {
                  if (ref.current) ref.current.open = false;
                  aoEscolher(p.id);
                }}
              >
                {p.texto}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * Indicadores compactos da praça (front aprovado), calculados dos registros
 * carregados. Divergência de volumes depende dos volumes esperados, que ainda
 * não têm fonte: aparece como "sem dado", nunca como zero.
 */
export function Indicadores({ paletes, posicoesLivres, noFiltro, livres = null, aoEscolherLivre, extra = null }: Props) {
  const emEstoque = paletes.filter((p) => p.flowState === 'EM_ESTOQUE').length;
  // Divergência pendente: paletes cuja conferência de volumes mais recente encontrou diferença.
  const comDivergencia = paletes.filter((p) => (p.volumeCheck?.differences ?? 0) > 0 || p.volumeCheck?.state === 'CONFERIDO_COM_DIFERENCA').length;
  const paraAgenda = paletes.filter((p) => p.flowState === 'RESERVADO').length;
  return (
    <section className="indicadores-praca" aria-label="Indicadores da praça" data-testid="indicadores-praca">
      {livres !== null && livres.length > 0 && aoEscolherLivre !== undefined ? (
        <IndicadorLivres total={posicoesLivres} livres={livres} aoEscolher={aoEscolherLivre} />
      ) : (
        <p className="indicador indicador--livre" data-testid="indicador-livres">
          <span className="indicador-valor">{posicoesLivres}</span>
          <span className="indicador-rotulo">Posições livres (confirmadas)</span>
        </p>
      )}
      <p className="indicador indicador--estoque" data-testid="indicador-estoque">
        <span className="indicador-valor">{emEstoque}</span>
        <span className="indicador-rotulo">Paletes em estoque</span>
      </p>
      <p className="indicador indicador--agenda" data-testid="indicador-agenda">
        <span className="indicador-valor">{paraAgenda}</span>
        <span className="indicador-rotulo">Para agenda (reservados)</span>
      </p>
      <p className="indicador indicador--divergencia" data-testid="indicador-divergencia" title="Paletes cuja conferência de volumes mais recente encontrou diferença (a quantidade atual já é a contada).">
        <span className="indicador-valor">{comDivergencia}</span>
        <span className="indicador-rotulo">Paletes com diferença na conferência</span>
      </p>
      {noFiltro !== null && (
        <p className="indicador indicador--filtro" data-testid="indicador-filtro">
          <span className="indicador-valor">{noFiltro}</span>
          <span className="indicador-rotulo">Paletes no filtro atual</span>
        </p>
      )}
      {extra}
    </section>
  );
}
