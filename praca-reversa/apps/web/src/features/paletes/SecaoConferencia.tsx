import {
  API_PREFIXO,
  ConferenciaDetalheSchema,
  HistoricoConferenciasSchema,
  type EscopoConferencia,
  type PaleteDetalhe,
  type Permissao,
} from '@praca-reversa/contracts';
import { useId, useState } from 'react';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { MensagemAcao } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import { formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { ROTULOS_ESCOPO, ROTULOS_EVENTO, ROTULOS_MOTIVO, ROTULOS_SITUACAO, formatarDiferenca, textoOrigem } from '../conferencia/rotulos';

interface Props {
  detalhe: PaleteDetalhe;
  permissoes: readonly Permissao[];
  aoAbrirConferencia: (id: string) => void;
  /** Depois de uma gravação confirmada (ou conflito): recarregar detalhe, mapa e lista. */
  aoAlterado: () => void;
}

type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;

function Historico({ paleteId, aoAbrirConferencia }: { paleteId: string; aoAbrirConferencia: (id: string) => void }) {
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/paletes/${paleteId}/conferencias`, HistoricoConferenciasSchema);
  if (carga?.estado === 'erro') {
    return (
      <div className="estado-erro" role="alert">
        <p>Não foi possível carregar o histórico. {carga.mensagem}</p>
        <button type="button" className="botao-secundario" onClick={recarregar}>
          Tentar novamente
        </button>
      </div>
    );
  }
  if (carga?.estado !== 'pronto') return <p className="estado-carregando">Carregando histórico…</p>;
  const { sessions, events } = carga.dados;
  return (
    <div className="historico-conferencia" data-testid="historico-conferencia">
      <h4>Conferências ({sessions.length})</h4>
      {sessions.length === 0 ? (
        <p className="sem-itens">Nenhuma conferência registrada.</p>
      ) : (
        <ul className="lista-historico">
          {sessions.map((s) => (
            <li key={s.id}>
              <button type="button" className="botao-link" onClick={() => { aoAbrirConferencia(s.id); }}>
                Nº {s.number}
              </button>{' '}
              {ROTULOS_MOTIVO[s.kind]} {ROTULOS_ESCOPO[s.scope].texto.toLowerCase()} · <strong>{ROTULOS_SITUACAO[s.state].texto}</strong> · {s.responsible?.name ?? 'carga de demonstração'},{' '}
              {formatarDataHora(s.startedAt)} · {s.activeLines} linha(s){s.pendingLines > 0 ? `, ${String(s.pendingLines)} pendente(s)` : ''}
            </li>
          ))}
        </ul>
      )}
      <h4>Eventos de estoque ({events.length})</h4>
      {events.length === 0 ? (
        <p className="sem-itens">Nenhum saldo validado registrado para este palete.</p>
      ) : (
        <ul className="lista-historico">
          {events.map((e) => (
            <li key={e.id}>
              <strong>{ROTULOS_EVENTO[e.type]}</strong> · {formatarDataHora(e.at)} · {e.author?.name ?? 'carga de demonstração'}
              {e.session ? ` · conferência nº ${String(e.session.number)}` : ''}
              {e.destination ? ` · ${e.pallet.code} → ${e.destination.code}` : ''} — {e.reason}
              {e.lines.length > 0 && (
                <ul>
                  {e.lines.map((l) => (
                    <li key={`${l.pallet.id}:${l.segmentId}`}>
                      {e.destination ? `${l.pallet.code}: ` : ''}
                      {l.sku} · {l.lot ?? 'lote pendente'} · {textoOrigem(l.originType, l.originReference)}: {formatarQuantidade(l.before)} → {formatarQuantidade(l.after)} {l.unit} (
                      {formatarDiferenca(l.delta)})
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Conferência no detalhe do palete: iniciar (parcial ou completa), continuar o
 * rascunho, abrir contagens aguardando validação e consultar o histórico.
 */
export function SecaoConferencia({ detalhe, permissoes, aoAbrirConferencia, aoAlterado }: Props) {
  const ids = useId();
  const conectado = useConectado();
  const chaves = useChaves();
  const [iniciando, setIniciando] = useState(false);
  const [escopo, setEscopo] = useState<EscopoConferencia | null>(null);
  const [descricao, setDescricao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [verHistorico, setVerHistorico] = useState(false);
  const podeRegistrar = permissoes.includes('conferencia.registrar');
  const ativa = detalhe.activeCount;
  const aguardando = detalhe.observedCounts.find((c) => c.session.scope === 'COMPLETA');
  const podeIniciar = podeRegistrar && detalhe.archived === null && ativa === null && aguardando === undefined;

  async function iniciar() {
    if (escopo === null) return;
    const corpo = { scope: escopo, scopeDescription: descricao.trim() || null, expectedVersion: detalhe.version };
    const assinatura = `iniciar:${detalhe.id}:${JSON.stringify(corpo)}`;
    setOcupado(true);
    setMensagem(null);
    try {
      const sessao = await enviarJson('POST', `${API_PREFIXO}/paletes/${detalhe.id}/conferencias`, ConferenciaDetalheSchema, {
        corpo,
        idempotencia: chaves.para(assinatura),
      });
      chaves.concluir(assinatura);
      aoAlterado();
      aoAbrirConferencia(sessao.id);
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      if (ehConflitoDeVersao(erro) || (erro instanceof FalhaRequisicao && erro.codigo === 'CONFLITO')) {
        setMensagem({ tipo: 'conflito', texto: `${mensagemDeFalha(erro)} Os dados do palete foram recarregados.` });
        setIniciando(false);
        aoAlterado();
      } else {
        setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="detalhe-secao" aria-labelledby={`${ids}-titulo`} data-testid="secao-conferencia">
      <h3 id={`${ids}-titulo`}>Conferência</h3>

      {ativa !== null && (
        <div className="aviso-conferencia" role="note" data-testid="conferencia-ativa">
          <p>
            <span className="selo selo-situacao selo-situacao--EM_ANDAMENTO">
              <span className="selo-marcador" aria-hidden="true">
                {ROTULOS_SITUACAO.EM_ANDAMENTO.marcador}
              </span>
              Em conferência
            </span>{' '}
            Nº {ativa.number} · {ROTULOS_ESCOPO[ativa.scope].texto.toLowerCase()}
            {ativa.scopeDescription ? ` (${ativa.scopeDescription})` : ''} · iniciada por {ativa.responsible?.name ?? '—'} em {formatarDataHora(ativa.startedAt)} · rascunho salvo em{' '}
            {formatarDataHora(ativa.updatedAt)} · {ativa.activeLines} linha(s).
          </p>
          <p className="bloco-nota">Enquanto a conferência estiver em andamento, mover, transferir e arquivar este palete ficam bloqueados.</p>
          <button type="button" className="botao-primario" onClick={() => { aoAbrirConferencia(ativa.id); }} data-testid="continuar-conferencia">
            {podeRegistrar ? 'Continuar conferência' : 'Abrir conferência'}
          </button>
        </div>
      )}

      {detalhe.observedCounts.length > 0 && (
        <ul className="lista-historico">
          {detalhe.observedCounts.map((c) => (
            <li key={c.session.id}>
              Conferência nº {c.session.number} ({ROTULOS_ESCOPO[c.session.scope].texto.toLowerCase()}) concluída
              {c.session.scope === 'COMPLETA' ? ', aguardando validação' : ', observações registradas'}.{' '}
              <button type="button" className="botao-link" onClick={() => { aoAbrirConferencia(c.session.id); }}>
                Abrir conferência nº {c.session.number}
              </button>
            </li>
          ))}
        </ul>
      )}

      {detalhe.lastReconciliation !== null && (
        <p className="bloco-nota">
          Saldo validado por {ROTULOS_EVENTO[detalhe.lastReconciliation.type].toLowerCase()} em {formatarDataHora(detalhe.lastReconciliation.at)}
          {detalhe.lastReconciliation.by ? ` por ${detalhe.lastReconciliation.by.name}` : ''}
          {detalhe.lastReconciliation.session ? ` (conferência nº ${String(detalhe.lastReconciliation.session.number)})` : ''}.
        </p>
      )}

      {podeIniciar && !iniciando && (
        <button
          type="button"
          className="botao-primario"
          onClick={() => {
            setIniciando(true);
            setMensagem(null);
          }}
          data-testid="iniciar-conferencia"
        >
          Iniciar conferência
        </button>
      )}
      {podeRegistrar && ativa === null && aguardando !== undefined && (
        <p className="bloco-nota">Há uma contagem completa aguardando validação: reconcilie, cancele ou solicite recontagem dela antes de iniciar outra.</p>
      )}

      {iniciando && (
        <form
          className="formulario-coluna"
          onSubmit={(e) => {
            e.preventDefault();
            void iniciar();
          }}
        >
          <fieldset className="escolha-escopo">
            <legend>O que será conferido?</legend>
            {(['COMPLETA', 'PARCIAL'] as const).map((opcao) => (
              <label key={opcao} className="opcao opcao--escopo">
                <input type="radio" name={`${ids}-escopo`} value={opcao} checked={escopo === opcao} onChange={() => { setEscopo(opcao); }} />
                <span>
                  <strong>{ROTULOS_ESCOPO[opcao].texto}</strong> — {ROTULOS_ESCOPO[opcao].explicacao}
                </span>
              </label>
            ))}
          </fieldset>
          {escopo === 'PARCIAL' && (
            <label className="campo">
              <span className="campo-rotulo">Parte física que será conferida (obrigatória)</span>
              <input value={descricao} maxLength={200} placeholder="ex.: camada superior; somente o SKU 000123" onChange={(e) => { setDescricao(e.target.value); }} />
            </label>
          )}
          {!conectado && <p className="mensagem-conflito">Sem conexão: a conferência só começa com o servidor disponível.</p>}
          <div className="acoes-linha">
            <button
              type="submit"
              className="botao-primario"
              disabled={ocupado || !conectado || escopo === null || (escopo === 'PARCIAL' && descricao.trim().length < 3)}
              data-testid="confirmar-inicio"
            >
              {ocupado ? 'Iniciando…' : 'Iniciar'}
            </button>
            <button type="button" className="botao-link" onClick={() => { setIniciando(false); }}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <MensagemAcao mensagem={mensagem} testId="mensagem-conferencia-palete" />

      <details
        className="detalhe-historico"
        onToggle={(e) => {
          setVerHistorico(e.currentTarget.open);
        }}
      >
        <summary>Histórico de conferências e estoque</summary>
        {verHistorico && <Historico paleteId={detalhe.id} aoAbrirConferencia={aoAbrirConferencia} />}
      </details>
    </section>
  );
}
