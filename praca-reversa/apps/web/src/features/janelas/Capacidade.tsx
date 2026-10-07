import type { RestricaoJanela } from '@praca-reversa/contracts';
import { q, rotuloMetrica } from './rotulos';

/**
 * Capacidade por métrica: limite autorizado, reservado ativo, expedido e
 * restante, separados (o expedido nunca aparece também como reservado).
 * Limite pendente aparece como pendência, nunca como ilimitado.
 */
export function Capacidade({ restricoes, compacta = false }: { restricoes: readonly RestricaoJanela[]; compacta?: boolean }) {
  if (restricoes.length === 0) {
    return <p className="capacidade-vazia selo selo-alerta">Nenhuma restrição declarada: capacidade pendente (não é ilimitada)</p>;
  }
  return (
    <ul className={`capacidade-lista${compacta ? ' capacidade-lista--compacta' : ''}`} data-testid="capacidade">
      {restricoes.map((r) => {
        // Só para o medidor visual; os números exibidos são os decimais exatos da API.
        const limite = r.limit === null ? null : Number(r.limit);
        return (
          <li key={r.id} className="capacidade-item" data-metrica={r.metric} data-estado={r.state}>
            <div className="capacidade-topo">
              <strong>{rotuloMetrica(r)}</strong>
              {r.state === 'PENDENTE' ? (
                <span className="selo selo-alerta">Limite pendente</span>
              ) : r.state === 'SEM_CAPACIDADE' ? (
                <span className="selo selo-alerta">Sem capacidade restante</span>
              ) : (
                <span className="selo selo-ok">Restam {q(r.remaining)}</span>
              )}
            </div>
            {limite !== null && limite > 0 && (
              <meter
                className="capacidade-medidor"
                min={0}
                max={limite}
                high={limite * 0.9}
                value={Math.min(limite, Number(r.reserved) + Number(r.shipped))}
                aria-label={`Ocupado: expedido ${q(r.shipped)} + reservado ${q(r.reserved)} de ${q(r.limit)}`}
              />
            )}
            <dl className="capacidade-numeros">
              <div>
                <dt>Limite autorizado</dt>
                <dd>{q(r.limit)}</dd>
              </div>
              <div>
                <dt>Reservado ativo</dt>
                <dd>{q(r.reserved)}</dd>
              </div>
              <div>
                <dt>Expedido</dt>
                <dd>{q(r.shipped)}</dd>
              </div>
              <div>
                <dt>Restante</dt>
                <dd>{q(r.remaining)}</dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
