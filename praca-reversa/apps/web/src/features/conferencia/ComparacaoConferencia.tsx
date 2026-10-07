import type { Comparacao } from '@praca-reversa/contracts';
import { ROTULOS_CONDICAO } from '../paletes/estados';
import { ROTULOS_PENDENCIA, ROTULOS_VINCULO, formatarDiferenca, quantidadeComUnidade, textoOrigem } from './rotulos';

/**
 * Declarado (documento), observado (esta contagem) e validado (saldo atual)
 * em colunas separadas, por vínculo produto + origem. Sem declaração, não há
 * esperado zero; na parcial, nada é declarado ausente.
 */
export function ComparacaoConferencia({ comparacao }: { comparacao: Comparacao }) {
  return (
    <section className="cartao" aria-labelledby="titulo-comparacao" data-testid="comparacao">
      <h3 id="titulo-comparacao">Comparação</h3>
      <p className="bloco-nota">
        {comparacao.scope === 'PARCIAL'
          ? 'Conferência parcial: os itens fora do escopo continuam pendentes. Nenhuma diferença é calculada e nada é declarado ausente.'
          : 'Diferença = observado − declarado, só quando as duas quantidades existem na mesma unidade. Saldo validado só muda na reconciliação.'}
      </p>
      {comparacao.links.length === 0 ? (
        <p className="sem-itens">Nada a comparar: sem declaração e sem observação convertida.</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela-comparacao">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col">Origem</th>
                <th scope="col">Declarado</th>
                <th scope="col">Observado</th>
                <th scope="col">Validado atual</th>
                <th scope="col">Diferença</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {comparacao.links.map((l) => {
                const rotulo = ROTULOS_VINCULO[l.status];
                return (
                  <tr key={l.key} data-testid="vinculo-comparacao" data-sku={l.sku} data-status={l.status}>
                    <th scope="row" data-rotulo="Produto">
                      <span className="item-sku">{l.sku}</span> {l.description}
                      <span className="tabela-unidade"> · {l.unit}</span>
                    </th>
                    <td data-rotulo="Origem" className={l.originType === null ? 'pendente' : undefined}>
                      {textoOrigem(l.originType, l.originReference)}
                      {l.declaredLots.some((x) => x !== null) && (
                        <span className="tabela-nota"> · lote declarado {l.declaredLots.map((x) => x ?? 'pendente').join(', ')}</span>
                      )}
                    </td>
                    <td data-rotulo="Declarado">{l.declared === null ? (l.status === 'SEM_DECLARACAO' ? 'Sem declaração' : 'Indisponível') : quantidadeComUnidade(l.declared, l.unit)}</td>
                    <td data-rotulo="Observado">
                      {l.observed === null ? 'Não contado' : quantidadeComUnidade(l.observed, l.unit)}
                      {l.observedDetail.length > 1 && (
                        <span className="tabela-nota">
                          {' '}
                          ({l.observedDetail.map((d) => `${quantidadeComUnidade(d.quantity, null)} ${d.lot ?? 'lote pendente'} ${ROTULOS_CONDICAO[d.condition].toLowerCase()}`).join('; ')})
                        </span>
                      )}
                    </td>
                    <td data-rotulo="Validado atual">{l.validated === null ? 'Nunca reconciliado' : quantidadeComUnidade(l.validated, l.unit)}</td>
                    <td data-rotulo="Diferença" className="tabela-diferenca">
                      {l.difference === null ? '—' : `${formatarDiferenca(l.difference)} ${l.unit}`}
                    </td>
                    <td data-rotulo="Situação">
                      <span className={`selo selo-vinculo selo-vinculo--${l.status}`}>
                        <span className="selo-marcador" aria-hidden="true">
                          {rotulo.marcador}
                        </span>
                        {rotulo.texto}
                      </span>
                      {l.notes.length > 0 && <span className="tabela-nota"> {l.notes.join(' ')}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {comparacao.declaredWithoutProduct.length > 0 && (
        <p className="bloco-nota">
          Declarado com produto pendente (não comparável):{' '}
          {comparacao.declaredWithoutProduct.map((d) => `${d.description} — ${quantidadeComUnidade(d.quantity, d.unit)}${d.originReference ? ` (${d.originReference})` : ''}`).join('; ')}.
        </p>
      )}
      {comparacao.pending.length > 0 && (
        <p className="bloco-nota linha-pendencia">
          ⚠ {comparacao.pending.length} observação(ões) pendente(s): {comparacao.pending.map((p) => `${p.sku ?? p.codeRead ?? p.description} (${ROTULOS_PENDENCIA[p.kind].toLowerCase()})`).join('; ')}.
        </p>
      )}
    </section>
  );
}
