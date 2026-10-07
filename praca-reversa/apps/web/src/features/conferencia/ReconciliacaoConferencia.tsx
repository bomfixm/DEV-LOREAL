import { API_PREFIXO, PreviaReconciliacaoSchema, ResultadoReconciliacaoSchema, type ResultadoReconciliacao } from '@praca-reversa/contracts';
import { useState } from 'react';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { MensagemAcao } from '../../components/Moldura';
import { ROTULOS_CONDICAO, ROTULOS_LIBERACAO } from '../paletes/estados';
import { ROTULOS_EVENTO, formatarDiferenca, quantidadeComUnidade, textoOrigem } from './rotulos';

interface Props {
  sessaoId: string;
  conectado: boolean;
  /** Bloqueio vindo da tela (sem conexão, verificando após reconectar). */
  bloqueioTela: string | null;
  aoReconciliado: (resultado: ResultadoReconciliacao) => void;
  aoConflito: () => void;
  aoFechar: () => void;
}

type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;

/** Prévia dos efeitos e confirmação, com justificativa. A tela só mostra sucesso depois da resposta da API. */
export function ReconciliacaoConferencia({ sessaoId, conectado, bloqueioTela, aoReconciliado, aoConflito, aoFechar }: Props) {
  const chaves = useChaves();
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/conferencias/${sessaoId}/reconciliacao`, PreviaReconciliacaoSchema, versao);
  const [justificativa, setJustificativa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const previa = carga?.estado === 'pronto' ? carga.dados : null;

  async function confirmar() {
    if (!previa) return;
    const corpo = { expectedPalletVersion: previa.palletVersion, justification: justificativa.trim() };
    const assinatura = `reconciliar:${sessaoId}:${JSON.stringify(corpo)}`;
    setEnviando(true);
    setMensagem(null);
    try {
      const resultado = await enviarJson('POST', `${API_PREFIXO}/conferencias/${sessaoId}/reconciliar`, ResultadoReconciliacaoSchema, {
        corpo,
        idempotencia: chaves.para(assinatura),
      });
      chaves.concluir(assinatura);
      aoReconciliado(resultado);
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      if (erro instanceof FalhaRequisicao && erro.tipo === 'rede') {
        setMensagem({ tipo: 'erro', texto: `${mensagemDeFalha(erro)} Nada foi confirmado; ao repetir, a mesma ação não é aplicada duas vezes.` });
      } else if (ehConflitoDeVersao(erro) || (erro instanceof FalhaRequisicao && (erro.codigo === 'CONFLITO' || erro.codigo === 'CONFLITO_SALDO'))) {
        setMensagem({ tipo: 'conflito', texto: mensagemDeFalha(erro) });
        setVersao((v) => v + 1);
        aoConflito();
      } else {
        setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao painel-reconciliacao" aria-labelledby="titulo-reconciliacao" data-testid="painel-reconciliacao">
      <h3 id="titulo-reconciliacao">Reconciliar conferência</h3>
      {carga?.estado === 'erro' ? (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar a prévia. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            Tentar novamente
          </button>
        </div>
      ) : previa === null ? (
        <p className="estado-carregando">Calculando os efeitos…</p>
      ) : (
        <>
          <p>
            <strong>{ROTULOS_EVENTO[previa.eventType]}</strong> do palete <strong>{previa.palletCode}</strong>. Liberação atual:{' '}
            <strong>{ROTULOS_LIBERACAO[previa.releaseState]}</strong> (não muda).
          </p>
          {previa.blockers.length > 0 && (
            <ul className="lista-bloqueios" role="alert" data-testid="bloqueios-reconciliacao">
              {previa.blockers.map((b) => (
                <li key={b}>⚠ {b}</li>
              ))}
            </ul>
          )}
          {previa.changes.length === 0 ? (
            <p className="bloco-nota">Nenhum segmento muda ({previa.unchanged} igual(is) ao saldo validado). O evento registra a validação.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela-comparacao" data-testid="previa-reconciliacao">
                <thead>
                  <tr>
                    <th scope="col">Produto · lote · origem · condição</th>
                    <th scope="col">Saldo atual</th>
                    <th scope="col">Novo saldo</th>
                    <th scope="col">Ajuste</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.changes.map((c) => (
                    <tr key={c.segmentKey}>
                      <th scope="row" data-rotulo="Segmento">
                        <span className="item-sku">{c.sku}</span> {c.description} · {c.lot ?? 'lote pendente'} · {textoOrigem(c.originType, c.originReference)} ·{' '}
                        {ROTULOS_CONDICAO[c.condition]}
                      </th>
                      <td data-rotulo="Saldo atual">{quantidadeComUnidade(c.current, c.unit)}</td>
                      <td data-rotulo="Novo saldo">
                        {quantidadeComUnidade(c.target, c.unit)}
                        {c.target === '0' && <span className="tabela-nota"> (ausência verificada na completa)</span>}
                      </td>
                      <td data-rotulo="Ajuste" className="tabela-diferenca">
                        {formatarDiferenca(c.delta)} {c.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ul className="notas-reconciliacao">
            {previa.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <form
            className="formulario-coluna"
            onSubmit={(e) => {
              e.preventDefault();
              void confirmar();
            }}
          >
            <label className="campo">
              <span className="campo-rotulo">Justificativa (obrigatória)</span>
              <textarea value={justificativa} rows={2} maxLength={500} onChange={(e) => { setJustificativa(e.target.value); }} />
            </label>
            {bloqueioTela !== null && <p className="mensagem-conflito">{bloqueioTela}</p>}
            <div className="acoes-linha">
              <button
                type="submit"
                className="botao-primario"
                disabled={enviando || !conectado || bloqueioTela !== null || !previa.allowed || justificativa.trim().length < 3}
                data-testid="confirmar-reconciliacao"
              >
                {enviando ? 'Reconciliando…' : 'Confirmar reconciliação'}
              </button>
              <button type="button" className="botao-link" onClick={aoFechar}>
                Fechar
              </button>
            </div>
          </form>
        </>
      )}
      <MensagemAcao mensagem={mensagem} testId="mensagem-reconciliacao" />
    </section>
  );
}
