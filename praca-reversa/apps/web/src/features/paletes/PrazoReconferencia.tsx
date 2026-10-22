import type { ReconferenciaPalete, TipoMovimentacaoRelevante } from '@praca-reversa/contracts';
import { formatarDataHora } from '../../utils/datas';

const TIPO_MOVIMENTACAO: Readonly<Record<TipoMovimentacaoRelevante, string>> = {
  MOVIMENTO: 'mudança de localização',
  CORRECAO_LOCALIZACAO: 'correção de localização',
  RETIRADA_VAZIO: 'retirada do palete vazio',
  TRANSFERENCIA_ENVIADA: 'material transferido para outro palete',
  TRANSFERENCIA_RECEBIDA: 'material recebido de outro palete',
  CORRECAO_TRANSFERENCIA: 'correção de transferência',
  SAIDA_PARCIAL: 'saída parcial na expedição',
  RETORNO_FISICO: 'retorno físico de material',
  ENTRADA_CONTEUDO: 'entrada de material',
};

const dias = (n: number) => `${String(n)} ${n === 1 ? 'dia' : 'dias'}`;

/** Situação curta (lista e resumo): "⟳ Reconferência necessária" ou "Reconferência em X dias", e os dias sem movimentação. */
export function SeloReconferencia({ r }: { r: ReconferenciaPalete }) {
  return r.due ? (
    <span className="selo-reconferencia" data-testid="selo-reconferencia">
      <span aria-hidden="true">⟳</span> Reconferência necessária
    </span>
  ) : (
    <span className="item-alerta-neutro" data-testid="prazo-reconferencia-curto">
      Reconferência em {dias(r.daysUntilDue)}
    </span>
  );
}

/**
 * Prazo de reconferência após 20 dias (detalhe e resumo). Calculado pelo
 * servidor; dias sem movimentação contam desde a última movimentação ou a
 * entrada (não desde a conferência). Separado de conferência, liberação,
 * reserva e saldo.
 */
export function PrazoReconferencia({ r, aoConferir }: { r: ReconferenciaPalete; aoConferir: (() => void) | null }) {
  return (
    <section className={r.due ? 'cartao prazo-reconferencia prazo-reconferencia--vencido' : 'cartao prazo-reconferencia'} aria-label="Reconferência após 20 dias sem movimentação" data-testid="prazo-reconferencia" data-vencido={r.due ? 'sim' : 'nao'}>
      <p className="prazo-reconferencia-situacao">
        <SeloReconferencia r={r} />
        <span data-testid="dias-sem-movimentacao">{dias(r.daysWithoutMovement)} sem movimentação</span>
      </p>
      <dl className="situacao">
        <div>
          <dt>Última movimentação relevante</dt>
          <dd>
            {r.lastMovementAt !== null
              ? `${formatarDataHora(r.lastMovementAt)}${r.lastMovementType ? ` · ${TIPO_MOVIMENTACAO[r.lastMovementType]}` : ''}`
              : `Nenhuma desde a entrada (${formatarDataHora(r.startedAt)}${r.startOrigin === 'IMPLANTACAO' ? ', data de implantação da regra' : ''})`}
          </dd>
        </div>
        <div>
          <dt>Última conferência completa</dt>
          <dd data-testid="ultima-conferencia-completa">
            {r.lastFullCountAt === null ? 'Não registrada' : `${formatarDataHora(r.lastFullCountAt)}${r.lastFullCountBy ? ` · ${r.lastFullCountBy.name}` : ''}`}
          </dd>
        </div>
        <div>
          <dt>Reconferência prevista</dt>
          <dd data-testid="reconferencia-prevista">{formatarDataHora(r.nextAt)}</dd>
        </div>
      </dl>
      {aoConferir !== null && (
        <button type="button" className={r.due ? 'botao-primario' : 'botao-secundario'} onClick={aoConferir} data-testid="acao-conferir-palete">
          Conferir palete
        </button>
      )}
    </section>
  );
}
