import { API_PREFIXO, HistoricoLiberacaoSchema, PaleteDetalheSchema, compararQuantidades, subtrairQuantidades, type PaleteDetalhe, type Permissao } from '@praca-reversa/contracts';
import { useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { MensagemAcao } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import { formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { useAcoes } from './acoes';
import { ROTULOS_EVENTO_LIBERACAO } from './rotulos';

type Acao = 'LIBERAR' | 'REVOGAR' | 'BLOQUEAR' | 'DESBLOQUEAR' | 'BLOQUEAR_PALETE' | 'DESBLOQUEAR_PALETE';

const TITULOS: Record<Acao, string> = {
  LIBERAR: 'Liberar quantidade para expedição',
  REVOGAR: 'Revogar liberação',
  BLOQUEAR: 'Bloquear material',
  DESBLOQUEAR: 'Desbloquear material',
  BLOQUEAR_PALETE: 'Bloquear palete inteiro',
  DESBLOQUEAR_PALETE: 'Desbloquear palete',
};

/**
 * Liberação para expedição por palete × material (etapa 08). Conferência e
 * recuperação de claim não liberam; liberar exige critério, fonte e motivo;
 * a liberação parcial identifica a quantidade. Bloqueio do material ou do
 * palete inteiro tira o material da fila elegível e impede a saída.
 */
export function SecaoLiberacao({ detalhe, permissoes, aoAlterado }: { detalhe: PaleteDetalhe; permissoes: readonly Permissao[]; aoAlterado: () => void }) {
  const conectado = useConectado();
  const acoes = useAcoes(aoAlterado);
  const [aberto, setAberto] = useState<{ acao: Acao; segmento: string | null } | null>(null);
  const [quantidade, setQuantidade] = useState('');
  const [criterio, setCriterio] = useState('');
  const [fonte, setFonte] = useState('');
  const [referencia, setReferencia] = useState('');
  const [motivo, setMotivo] = useState('');
  const [verHistorico, setVerHistorico] = useState(false);
  const historico = useRecurso(verHistorico ? `${API_PREFIXO}/paletes/${detalhe.id}/liberacao` : null, HistoricoLiberacaoSchema);
  const podeLiberar = permissoes.includes('material.liberar');
  const itens = detalhe.currentItems ?? [];
  const ativo = detalhe.archived === null && detalhe.flowState !== 'EXPEDIDO';

  const abrir = (acao: Acao, segmento: string | null, sugestao = '') => {
    setAberto({ acao, segmento });
    setQuantidade(sugestao);
    setMotivo('');
    acoes.setMensagem(null);
  };

  return (
    <section className="detalhe-secao" aria-labelledby="secao-liberacao" data-testid="secao-liberacao">
      <h3 id="secao-liberacao">Liberação para expedição</h3>
      {detalhe.palletBlock && (
        <p className="mensagem-conflito" data-testid="bloqueio-palete">
          <strong>Palete bloqueado:</strong> {detalhe.palletBlock.reason} ({formatarDataHora(detalhe.palletBlock.at)}
          {detalhe.palletBlock.by ? ` · ${detalhe.palletBlock.by.name}` : ''}). Todo o conteúdo, inclusive o que chegar depois, fica fora da expedição.
        </p>
      )}
      {itens.length === 0 ? (
        <p className="sem-itens">Sem saldo validado: nada a liberar (conteúdo desconhecido ou documento não fornecem saldo).</p>
      ) : (
        <ul className="itens">
          {itens.map((i) => {
            const naoLiberado = subtrairQuantidades(i.quantity, i.released);
            return (
              <li key={i.segmentId} className="item-conteudo" data-testid="item-liberacao">
                <div className="item-conteudo-topo">
                  <span className="item-sku">{i.sku}</span>
                  <span className="item-descricao">lote {i.lot ?? 'pendente'}</span>
                  <span className="item-quantidade">
                    {formatarQuantidade(i.released)} de {formatarQuantidade(i.quantity)} {i.unit} liberado(s)
                  </span>
                </div>
                <p className="bloco-nota">
                  Reservado {formatarQuantidade(i.reserved)} · vinculado a claim {formatarQuantidade(i.claimLinked)}
                  {i.blocked ? ` · bloqueado: ${i.blocked.reason}${i.blocked.by ? ` (${i.blocked.by.name})` : ''}` : ''}
                </p>
                {podeLiberar && ativo && (
                  <div className="acoes-linha">
                    {compararQuantidades(naoLiberado, '0') > 0 && !i.blocked && detalhe.palletBlock === null && (
                      <button type="button" className="botao-secundario botao-compacto" onClick={() => { abrir('LIBERAR', i.segmentId, formatarQuantidade(naoLiberado).replace(/\./g, '')); }} data-testid="abrir-liberar">
                        Liberar
                      </button>
                    )}
                    {compararQuantidades(i.released, i.reserved) > 0 && (
                      <button type="button" className="botao-link" onClick={() => { abrir('REVOGAR', i.segmentId); }}>
                        Revogar
                      </button>
                    )}
                    <button type="button" className="botao-link" onClick={() => { abrir(i.blocked ? 'DESBLOQUEAR' : 'BLOQUEAR', i.segmentId); }} data-testid={i.blocked ? 'abrir-desbloquear' : 'abrir-bloquear'}>
                      {i.blocked ? 'Desbloquear' : 'Bloquear'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {podeLiberar && ativo && (
        <div className="acoes-linha">
          <button type="button" className="botao-link" onClick={() => { abrir(detalhe.palletBlock ? 'DESBLOQUEAR_PALETE' : 'BLOQUEAR_PALETE', null); }} data-testid="abrir-bloqueio-palete">
            {detalhe.palletBlock ? 'Desbloquear palete' : 'Bloquear palete inteiro'}
          </button>
        </div>
      )}
      {aberto && (
        <form
          className="painel-acao"
          data-testid="painel-liberacao"
          onSubmit={(e) => {
            e.preventDefault();
            const a = aberto.acao;
            const base = { action: a, expectedVersion: detalhe.version, reason: motivo };
            const corpo =
              a === 'LIBERAR'
                ? { ...base, segmentId: aberto.segmento, quantity: quantidade.trim().replace(',', '.'), criterion: criterio, source: fonte, reference: referencia.trim() || null }
                : a === 'REVOGAR'
                  ? { ...base, segmentId: aberto.segmento, quantity: quantidade.trim().replace(',', '.') }
                  : a === 'BLOQUEAR' || a === 'DESBLOQUEAR'
                    ? { ...base, segmentId: aberto.segmento }
                    : base;
            void acoes.executar(`liberacao:${detalhe.id}:${JSON.stringify(corpo)}`, 'POST', `${API_PREFIXO}/paletes/${detalhe.id}/liberacao`, corpo, PaleteDetalheSchema, `${TITULOS[a]}: registrado.`).then((d) => {
              if (d) {
                setAberto(null);
                aoAlterado();
              }
            });
          }}
        >
          <h4>{TITULOS[aberto.acao]}</h4>
          {(aberto.acao === 'LIBERAR' || aberto.acao === 'REVOGAR') && (
            <label className="campo">
              <span className="campo-rotulo">Quantidade</span>
              <input value={quantidade} inputMode="decimal" onChange={(e) => { setQuantidade(e.target.value); }} data-testid="quantidade-liberacao" />
            </label>
          )}
          {aberto.acao === 'LIBERAR' && (
            <>
              <label className="campo">
                <span className="campo-rotulo">Critério atendido</span>
                <input value={criterio} maxLength={300} onChange={(e) => { setCriterio(e.target.value); }} data-testid="criterio-liberacao" />
              </label>
              <label className="campo">
                <span className="campo-rotulo">Fonte (quem/qual registro autoriza)</span>
                <input value={fonte} maxLength={120} onChange={(e) => { setFonte(e.target.value); }} data-testid="fonte-liberacao" />
              </label>
              <label className="campo">
                <span className="campo-rotulo">Referência (opcional)</span>
                <input value={referencia} maxLength={120} onChange={(e) => { setReferencia(e.target.value); }} />
              </label>
            </>
          )}
          <label className="campo">
            <span className="campo-rotulo">Motivo</span>
            <input value={motivo} maxLength={500} onChange={(e) => { setMotivo(e.target.value); }} data-testid="motivo-liberacao" />
          </label>
          <div className="acoes-linha">
            <button type="submit" className="botao-primario" disabled={acoes.enviando !== null || !conectado || motivo.trim().length < 3} data-testid="enviar-liberacao">
              Registrar
            </button>
            <button type="button" className="botao-link" onClick={() => { setAberto(null); }}>
              Voltar
            </button>
          </div>
        </form>
      )}
      <MensagemAcao mensagem={acoes.mensagem} testId="mensagem-liberacao" />
      <details
        onToggle={(e) => {
          setVerHistorico(e.currentTarget.open);
        }}
      >
        <summary>Histórico de liberação e bloqueios</summary>
        {historico.carga?.estado === 'pronto' && (
          <ul className="lista-historico-claim" data-testid="historico-liberacao">
            {historico.carga.dados.items.length === 0 && <li>Nenhum registro.</li>}
            {historico.carga.dados.items.map((h) => (
              <li key={h.id}>
                <strong>{ROTULOS_EVENTO_LIBERACAO[h.type]}</strong> · {formatarDataHora(h.at)} · {h.by?.name ?? 'sistema'}
                {h.sku ? ` · ${h.sku}${h.lot ? ` lote ${h.lot}` : ''}` : ''}
                {h.quantity ? ` · ${formatarQuantidade(h.quantity)}` : ''}
                {h.releasedBefore !== null && h.releasedAfter !== null ? ` (liberado ${formatarQuantidade(h.releasedBefore)} → ${formatarQuantidade(h.releasedAfter)})` : ''}
                <p>
                  {h.reason}
                  {h.criterion ? ` · critério: ${h.criterion}` : ''}
                  {h.source ? ` · fonte: ${h.source}` : ''}
                  {h.reference ? ` · ref. ${h.reference}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
        {historico.carga?.estado === 'erro' && <p className="estado-erro">{historico.carga.mensagem}</p>}
      </details>
    </section>
  );
}
