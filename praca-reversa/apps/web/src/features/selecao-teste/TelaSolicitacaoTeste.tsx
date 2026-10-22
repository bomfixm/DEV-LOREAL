import {
  ROTULO_SITUACAO_ALTERACAO_TESTE,
  ROTULO_SITUACAO_SOLICITACAO_TESTE,
  SolicitacaoTesteSchema,
  VerificacaoTesteSchema,
  type ItemSolicitacaoTeste,
  type ItemVersaoTeste,
  type SolicitacaoTeste,
  type VerificacaoTeste,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha, obterJson } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { PassosTeste, SeloAmbienteTeste } from './comum';
import { avaliarEscolha } from './escolha';
import { API_TESTE, textoAgenda, textoDocumento, textoPedido, textoVolumes } from './textos';

type Mensagem = { tipo: 'ok' | 'erro'; texto: string } | null;

/** Mutação da solicitação com chave de idempotência por ação (clique repetido não grava duas vezes). */
function useMutacao(aoAtualizar: (s: SolicitacaoTeste) => void) {
  const chaves = useChaves();
  const [ocupado, setOcupado] = useState(false);
  async function executar(metodo: 'POST' | 'PATCH', url: string, corpo: unknown, assinatura: string, descricao: string): Promise<SolicitacaoTeste | FalhaRequisicao | Error> {
    setOcupado(true);
    try {
      const s = await enviarJson(metodo, url, SolicitacaoTesteSchema, { corpo, idempotencia: chaves.para(assinatura), descricao });
      chaves.concluir(assinatura);
      aoAtualizar(s);
      return s;
    } catch (falha) {
      chaves.concluir(assinatura, falha);
      return falha instanceof Error ? falha : new Error(mensagemDeFalha(falha));
    } finally {
      setOcupado(false);
    }
  }
  return { executar, ocupado };
}

/**
 * Solicitação de teste: revisão do carrinho (editável enquanto rascunho ou
 * revisão autorizada) e, depois do envio, acompanhamento — versões enviadas,
 * pedidos de alteração, respostas e histórico. Lista própria do teste,
 * separada das solicitações e agendas reais.
 */
export function TelaSolicitacaoTeste({ id, aoNavegar }: { id: string; aoNavegar: Navegar }) {
  const { carga, recarregar } = useRecurso(`${API_TESTE}/solicitacoes/${id}`, SolicitacaoTesteSchema);
  const [local, setLocal] = useState<SolicitacaoTeste | null>(null);
  const servidor = carga?.estado === 'pronto' ? carga.dados : null;
  const s = local !== null && (servidor === null || local.version >= servidor.version) ? local : servidor;

  return (
    <main className="principal principal--pagina st-pagina" data-testid="tela-solicitacao-teste">
      <div className="pagina-conteudo st-conteudo">
        <header className="st-topo">
          <div>
            <h2>
              Solicitação de teste {s?.code ?? ''}
              {s !== null && (
                <span className={`st-chip st-chip--${s.status}`} data-testid="st-situacao">
                  {ROTULO_SITUACAO_SOLICITACAO_TESTE[s.status]}
                </span>
              )}
            </h2>
            {s !== null && (
              <p className="st-nota">
                Agenda: <strong>{textoAgenda(s.agenda)}</strong> · Criada por {s.createdBy.name} em {formatarDataHora(s.createdAt)}
                {s.sentAt !== null && ` · Enviada em ${formatarDataHora(s.sentAt)}`}
                {s.sentVersion > 1 && ` · versão ${String(s.sentVersion)}`}
              </p>
            )}
          </div>
          <SeloAmbienteTeste />
        </header>
        <PassosTeste ativo={s?.can.edit === true ? 'revisar' : 'acompanhar'} solicitacaoId={s?.can.edit === true ? s.id : null} aoNavegar={aoNavegar} />

        {s === null ? (
          carga?.estado === 'erro' ? (
            <div className="estado-erro" role="alert">
              <p>{carga.mensagem}</p>
              <button type="button" className="botao-secundario" onClick={recarregar}>
                Tentar novamente
              </button>
            </div>
          ) : (
            <p className="st-nota" role="status">
              Carregando a solicitação…
            </p>
          )
        ) : s.can.edit ? (
          <Revisao key={s.id} s={s} aoAtualizar={setLocal} aoNavegar={aoNavegar} />
        ) : (
          <Acompanhamento s={s} aoAtualizar={setLocal} aoNavegar={aoNavegar} />
        )}
      </div>
    </main>
  );
}

// ---------- Revisão do carrinho (antes do envio) ----------

function Revisao({ s, aoAtualizar, aoNavegar }: { s: SolicitacaoTeste; aoAtualizar: (s: SolicitacaoTeste) => void; aoNavegar: Navegar }) {
  const { executar, ocupado } = useMutacao(aoAtualizar);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [observacao, setObservacao] = useState(s.note ?? '');
  const [verificacao, setVerificacao] = useState<VerificacaoTeste | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [conferindo, setConferindo] = useState(false);

  const resultado = (r: SolicitacaoTeste | Error, ok: string) => {
    setMensagem(r instanceof Error ? { tipo: 'erro', texto: r.message } : { tipo: 'ok', texto: ok });
    return !(r instanceof Error);
  };

  async function conferir() {
    setConferindo(true);
    setMensagem(null);
    try {
      const v = await obterJson(`${API_TESTE}/solicitacoes/${s.id}/verificacao`, VerificacaoTesteSchema);
      setVerificacao(v);
      setConfirmar(v.differences.length === 0);
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(falha) });
    } finally {
      setConferindo(false);
    }
  }

  async function usarDadosAtuais() {
    if (verificacao === null) return;
    const itemIds = [...new Set(verificacao.differences.filter((d) => d.refreshable).map((d) => d.itemId))];
    const r = await executar('POST', `${API_TESTE}/solicitacoes/${s.id}/atualizacao-dados`, { expectedVersion: s.version, itemIds }, `dados:${s.id}:${String(s.version)}`, 'Usar dados atuais (teste)');
    if (resultado(r, 'Dados atualizados. As quantidades pedidas não mudaram: confira e envie.')) await conferir();
  }

  async function enviar() {
    const r = await executar('POST', `${API_TESTE}/solicitacoes/${s.id}/envio`, { expectedVersion: s.version }, `envio:${s.id}:${String(s.version)}`, 'Enviar solicitação (teste)');
    if (r instanceof FalhaRequisicao && r.codigo === 'DADOS_ALTERADOS') {
      setMensagem({ tipo: 'erro', texto: r.message });
      await conferir();
      return;
    }
    if (resultado(r, 'Solicitação enviada. Ela fica guardada como foi enviada; mudanças só por pedido de alteração.')) setConfirmar(false);
  }

  return (
    <>
      {s.status === 'EM_REVISAO' && (
        <p className="st-aviso-suave" data-testid="st-revisao-autorizada">
          Revisão autorizada: ajuste os itens e envie a revisão. A versão {s.sentVersion} enviada continua guardada.
        </p>
      )}
      <section className="st-secao" aria-label="Itens escolhidos">
        <div className="st-secao-topo">
          <h3>Revise o que vai ser pedido</h3>
          <button type="button" className="botao-secundario" onClick={() => { aoNavegar({ tipo: 'selecao-teste', solicitacao: s.id }); }} data-testid="st-continuar-escolhendo">
            Continuar escolhendo
          </button>
        </div>
        {s.items.length === 0 ? (
          <p className="st-nota">Nada escolhido ainda.</p>
        ) : (
          <ul className="st-itens">
            {s.items.map((i) => (
              <ItemEditavel key={`${i.id}:${String(s.version)}`} item={i} s={s} executar={executar} ocupado={ocupado} aoMensagem={setMensagem} />
            ))}
          </ul>
        )}
      </section>

      <section className="st-secao" aria-label="Observação geral">
        <label className="campo">
          <span className="campo-rotulo">Observação geral da solicitação (opcional)</span>
          <textarea rows={2} maxLength={1000} value={observacao} onChange={(ev) => { setObservacao(ev.target.value); }} data-testid="st-observacao-geral" />
        </label>
        {observacao.trim() !== (s.note ?? '') && (
          <button
            type="button"
            className="botao-secundario"
            disabled={ocupado}
            onClick={() =>
              void executar('PATCH', `${API_TESTE}/solicitacoes/${s.id}`, { expectedVersion: s.version, note: observacao.trim() === '' ? null : observacao.trim() }, `obs:${s.id}:${String(s.version)}`, 'Observação geral (teste)').then((r) => resultado(r, 'Observação salva.'))
            }
            data-testid="st-salvar-observacao-geral"
          >
            Salvar observação
          </button>
        )}
      </section>

      <Resumo s={s} />

      {mensagem !== null && (
        <p className={mensagem.tipo === 'ok' ? 'mensagem-ok' : 'estado-erro'} role={mensagem.tipo === 'ok' ? 'status' : 'alert'} data-testid="st-mensagem">
          {mensagem.texto}
        </p>
      )}

      {verificacao !== null && verificacao.differences.length > 0 && (
        <section className="st-secao st-diferencas" aria-label="O estoque mudou" data-testid="st-diferencas">
          <h3>O estoque mudou desde a escolha</h3>
          <p className="st-nota">Nenhuma quantidade foi trocada automaticamente. Revise cada item antes de enviar.</p>
          <table className="st-tabela">
            <thead>
              <tr>
                <th scope="col">Palete / nota</th>
                <th scope="col">O que mudou</th>
                <th scope="col">Antes</th>
                <th scope="col">Agora</th>
              </tr>
            </thead>
            <tbody>
              {verificacao.differences.map((d, i) => (
                <tr key={`${d.itemId}-${String(i)}`} className={d.blocking ? 'st-linha-bloqueio' : undefined}>
                  <td>
                    {d.palletCode}
                    {d.document !== null && ` · ${d.document}`}
                  </td>
                  <td>
                    {d.text}
                    {d.blocking && <strong> Ajuste a quantidade ou retire o item.</strong>}
                  </td>
                  <td>{d.before ?? '—'}</td>
                  <td>{d.now ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {verificacao.differences.some((d) => d.refreshable) && (
            <button type="button" className="botao-secundario" disabled={ocupado} onClick={() => void usarDadosAtuais()} data-testid="st-usar-dados-atuais">
              Usar os dados atuais nestes itens
            </button>
          )}
        </section>
      )}

      {confirmar ? (
        <section className="st-secao st-confirmar" aria-label="Confirmar envio" data-testid="st-confirmar">
          <h3>Confirmar o envio?</h3>
          <p>
            Depois de enviada, a solicitação fica bloqueada para edição. Para mudar algo, use “Solicitar alteração” e aguarde a resposta.
          </p>
          <div className="st-acoes">
            <button type="button" className="botao-primario" disabled={ocupado} onClick={() => void enviar()} data-testid="st-confirmar-envio">
              {ocupado ? 'Enviando…' : 'Confirmar envio'}
            </button>
            <button type="button" className="botao-secundario" disabled={ocupado} onClick={() => { setConfirmar(false); }}>
              Voltar
            </button>
          </div>
        </section>
      ) : (
        <div className="st-acoes">
          <button type="button" className="botao-primario" disabled={!s.can.send || conferindo || ocupado} onClick={() => void conferir()} data-testid="st-conferir-enviar">
            {conferindo ? 'Conferindo o estoque…' : s.status === 'EM_REVISAO' ? 'Conferir e enviar a revisão' : 'Conferir e enviar'}
          </button>
        </div>
      )}
    </>
  );
}

function ItemEditavel({
  item,
  s,
  executar,
  ocupado,
  aoMensagem,
}: {
  item: ItemSolicitacaoTeste;
  s: SolicitacaoTeste;
  executar: ReturnType<typeof useMutacao>['executar'];
  ocupado: boolean;
  aoMensagem: (m: Mensagem) => void;
}) {
  const [quantidade, setQuantidade] = useState(item.requestedVolumes === null ? '' : String(item.requestedVolumes));
  const [delivery, setDelivery] = useState(item.requestedDelivery ?? '');
  const [observacao, setObservacao] = useState(item.note ?? '');
  const nota = item.scope === 'CONTEUDO';
  const av = nota ? avaliarEscolha({ volumes: item.presented.volumes, delivery: item.content?.delivery ?? null }, { quantidade, delivery }) : null;
  const mudou =
    (nota && (quantidade !== (item.requestedVolumes === null ? '' : String(item.requestedVolumes)) || delivery.trim() !== (item.requestedDelivery ?? ''))) ||
    observacao.trim() !== (item.note ?? '');

  async function salvar() {
    const corpo = nota
      ? { expectedVersion: s.version, volumes: av?.volumes ?? null, delivery: delivery.trim() === '' ? null : delivery.trim(), note: observacao.trim() === '' ? null : observacao.trim() }
      : { expectedVersion: s.version, note: observacao.trim() === '' ? null : observacao.trim() };
    const r = await executar('PATCH', `${API_TESTE}/solicitacoes/${s.id}/itens/${item.id}`, corpo, `item:${item.id}:${String(s.version)}:${JSON.stringify(corpo)}`, 'Ajustar item (teste)');
    aoMensagem(r instanceof Error ? { tipo: 'erro', texto: r.message } : { tipo: 'ok', texto: 'Item ajustado.' });
  }

  async function remover() {
    const r = await executar('POST', `${API_TESTE}/solicitacoes/${s.id}/itens/${item.id}/remocao`, { expectedVersion: s.version }, `remover:${item.id}:${String(s.version)}`, 'Retirar item (teste)');
    aoMensagem(r instanceof Error ? { tipo: 'erro', texto: r.message } : { tipo: 'ok', texto: 'Item retirado.' });
  }

  return (
    <li className="st-item" data-testid="st-item">
      <div className="st-item-cabeca">
        <p>
          <strong>Palete {item.palletCode}</strong> · {nota ? textoDocumento(item.content) : 'palete inteiro'}
          {item.content?.sender !== null && item.content?.sender !== undefined && <span className="st-nota"> · {item.content.sender}</span>}
        </p>
        <p className="st-nota">
          {nota
            ? `Informado ao escolher: ${textoVolumes(item.presented.volumes)}${item.content?.delivery ? ` · Delivery cadastrada ${item.content.delivery}` : ''}`
            : item.presented.contents.length === 0
              ? 'Nenhuma nota identificada no cadastro deste palete.'
              : `${String(item.presented.contents.length)} nota${item.presented.contents.length === 1 ? '' : 's'}: ${item.presented.contents.map((c) => textoDocumento(c)).join(', ')}`}
        </p>
      </div>
      <div className="st-item-campos">
        {nota ? (
          <>
            <label className="campo">
              <span className="campo-rotulo">Quantidade{item.presented.volumes === null ? '' : ` (de ${String(item.presented.volumes)})`}</span>
              <input type="number" inputMode="numeric" min={1} step={1} max={item.presented.volumes ?? undefined} value={quantidade} onChange={(ev) => { setQuantidade(ev.target.value); }} data-testid="st-item-quantidade" />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Delivery pedida</span>
              <input type="text" maxLength={60} value={delivery} onChange={(ev) => { setDelivery(ev.target.value); }} data-testid="st-item-delivery" />
            </label>
          </>
        ) : (
          <p className="st-item-pedido">
            Pedido: <strong>{textoPedido(item)}</strong>
          </p>
        )}
        <label className="campo st-item-observacao">
          <span className="campo-rotulo">Observação deste item</span>
          <textarea rows={2} maxLength={500} value={observacao} onChange={(ev) => { setObservacao(ev.target.value); }} data-testid="st-item-observacao" />
        </label>
      </div>
      {av?.erro !== null && av?.erro !== undefined && <p className="st-erro">{av.erro}</p>}
      {item.needsAnalysis && !mudou && <p className="st-analise">Em análise: {item.analysisReason}</p>}
      {item.deliveryNotRegistered && !mudou && <p className="st-nota">A Delivery {item.requestedDelivery} não está discriminada no cadastro: a operação confere a quantidade dela.</p>}
      {item.otherRequests.map((o) => (
        <p key={o.id + o.detail} className="st-aviso-suave" data-testid="st-outro-pedido">
          Também na solicitação {o.code} ({ROTULO_SITUACAO_SOLICITACAO_TESTE[o.status]}): {o.detail}. Confira se é um complemento.
        </p>
      ))}
      <div className="st-acoes">
        {mudou && (
          <button type="button" className="botao-secundario" disabled={ocupado || (av?.erro ?? null) !== null} onClick={() => void salvar()} data-testid="st-item-salvar">
            Salvar ajuste
          </button>
        )}
        <button type="button" className="botao-link" disabled={ocupado} onClick={() => void remover()} data-testid="st-item-retirar">
          Retirar da seleção
        </button>
      </div>
    </li>
  );
}

function Resumo({ s }: { s: SolicitacaoTeste }) {
  return (
    <section className="st-secao st-resumo" aria-label="Resumo" data-testid="st-resumo">
      <h3>Resumo</h3>
      <dl>
        <dt>Agenda</dt>
        <dd>{textoAgenda(s.agenda)}</dd>
        <dt>Itens</dt>
        <dd>
          {s.totals.items} ({s.totals.pallets} palete{s.totals.pallets === 1 ? '' : 's'})
        </dd>
        <dt>Total com quantidade definida</dt>
        <dd data-testid="st-resumo-total">
          <strong>{textoVolumes(s.totals.definedVolumes)}</strong>
        </dd>
      </dl>
      {s.totals.itemsInAnalysis > 0 && (
        <p className="st-aviso-suave" data-testid="st-resumo-analise">
          {s.totals.itemsInAnalysis} item{s.totals.itemsInAnalysis === 1 ? '' : 's'} sem quantidade definida: a operação analisa e eles não entram no total acima. Este total não é o
          total confirmado do pedido.
        </p>
      )}
      {s.note !== null && <p className="st-nota">Observação geral: {s.note}</p>}
    </section>
  );
}

// ---------- Depois do envio ----------

function Acompanhamento({ s, aoAtualizar, aoNavegar }: { s: SolicitacaoTeste; aoAtualizar: (s: SolicitacaoTeste) => void; aoNavegar: Navegar }) {
  const { executar, ocupado } = useMutacao(aoAtualizar);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [justificativa, setJustificativa] = useState('');
  const [resposta, setResposta] = useState('');
  const [criando, setCriando] = useState(false);
  const chaves = useChaves();
  const pendente = s.changeRequests.find((c) => c.status === 'PENDENTE') ?? null;

  const resultado = (r: SolicitacaoTeste | Error, ok: string) => {
    setMensagem(r instanceof Error ? { tipo: 'erro', texto: r.message } : { tipo: 'ok', texto: ok });
  };

  async function novaAdicional() {
    const agenda = s.agenda.kind === 'JANELA' ? { windowId: s.agenda.windowId } : { reference: s.agenda.reference, date: s.agenda.date };
    const assinatura = `adicional:${s.id}`;
    setCriando(true);
    try {
      const nova = await enviarJson('POST', `${API_TESTE}/solicitacoes`, SolicitacaoTesteSchema, { corpo: { agenda, additional: true }, idempotencia: chaves.para(assinatura), descricao: 'Solicitação adicional (teste)' });
      chaves.concluir(assinatura);
      aoNavegar({ tipo: 'selecao-teste', solicitacao: nova.id });
    } catch (falha) {
      chaves.concluir(assinatura, falha);
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(falha) });
    } finally {
      setCriando(false);
    }
  }

  return (
    <>
      <p className="st-nota">Enviada: a solicitação está bloqueada para edição. Esta é uma solicitação de teste, separada das solicitações e agendas reais.</p>
      <Resumo s={s} />
      <section className="st-secao" aria-label="Itens enviados">
        <h3>Itens da versão {s.sentVersion}</h3>
        <TabelaVersao itens={s.versions.find((v) => v.number === s.sentVersion)?.items ?? []} />
      </section>

      <section className="st-secao" aria-label="Alterações" data-testid="st-alteracoes">
        <h3>Alterações</h3>
        {s.changeRequests.length === 0 && <p className="st-nota">Nenhum pedido de alteração.</p>}
        <ul className="st-alteracoes">
          {s.changeRequests.map((c) => (
            <li key={c.id} data-testid="st-alteracao">
              <p>
                <strong>{ROTULO_SITUACAO_ALTERACAO_TESTE[c.status]}</strong> · pedido por {c.requestedBy.name} em {formatarDataHora(c.requestedAt)} (sobre a versão {c.baseVersion})
              </p>
              <p>“{c.reason}”</p>
              {c.response !== null && (
                <p className="st-nota">
                  Resposta de {c.respondedBy?.name ?? ''}
                  {c.respondedAt !== null && ` em ${formatarDataHora(c.respondedAt)}`}: “{c.response}”
                  {c.resultingVersion !== null && ` · gerou a versão ${String(c.resultingVersion)}`}
                </p>
              )}
            </li>
          ))}
        </ul>
        {s.can.requestChange && (
          <div className="st-form">
            <label className="campo">
              <span className="campo-rotulo">Solicitar alteração — explique o que precisa mudar</span>
              <textarea rows={2} maxLength={1000} value={justificativa} placeholder="Ex.: Faltou selecionar 10 notas" onChange={(ev) => { setJustificativa(ev.target.value); }} data-testid="st-justificativa" />
            </label>
            <button
              type="button"
              className="botao-primario"
              disabled={ocupado || justificativa.trim().length < 5}
              onClick={() =>
                void executar('POST', `${API_TESTE}/solicitacoes/${s.id}/alteracoes`, { reason: justificativa.trim() }, `alteracao:${s.id}:${String(s.version)}`, 'Solicitar alteração (teste)').then((r) => {
                  resultado(r, 'Pedido de alteração registrado. A seleção não muda até a resposta.');
                  if (!(r instanceof Error)) setJustificativa('');
                })
              }
              data-testid="st-solicitar-alteracao"
            >
              Solicitar alteração
            </button>
          </div>
        )}
        {pendente !== null && s.can.respond && (
          <div className="st-form" data-testid="st-responder">
            <label className="campo">
              <span className="campo-rotulo">Resposta ao pedido de alteração</span>
              <textarea rows={2} maxLength={1000} value={resposta} onChange={(ev) => { setResposta(ev.target.value); }} data-testid="st-resposta" />
            </label>
            <div className="st-acoes">
              {(['APROVAR', 'RECUSAR'] as const).map((decisao) => (
                <button
                  key={decisao}
                  type="button"
                  className={decisao === 'APROVAR' ? 'botao-primario' : 'botao-secundario'}
                  disabled={ocupado || resposta.trim().length < 2}
                  onClick={() =>
                    void executar(
                      'POST',
                      `${API_TESTE}/solicitacoes/${s.id}/alteracoes/${pendente.id}/resposta`,
                      { decision: decisao, response: resposta.trim() },
                      `resposta:${pendente.id}:${decisao}`,
                      'Responder alteração (teste)',
                    ).then((r) => {
                      resultado(r, decisao === 'APROVAR' ? 'Alteração aprovada: a revisão está liberada.' : 'Alteração recusada: a solicitação continua como enviada.');
                      if (!(r instanceof Error)) setResposta('');
                    })
                  }
                  data-testid={decisao === 'APROVAR' ? 'st-aprovar' : 'st-recusar'}
                >
                  {decisao === 'APROVAR' ? 'Aprovar' : 'Recusar'}
                </button>
              ))}
            </div>
          </div>
        )}
        {mensagem !== null && (
          <p className={mensagem.tipo === 'ok' ? 'mensagem-ok' : 'estado-erro'} role={mensagem.tipo === 'ok' ? 'status' : 'alert'} data-testid="st-mensagem">
            {mensagem.texto}
          </p>
        )}
      </section>

      <section className="st-secao" aria-label="Solicitação adicional">
        <h3>Precisa pedir mais para esta agenda?</h3>
        <p className="st-nota">Uma solicitação adicional fica separada desta, com o próprio número.</p>
        <button type="button" className="botao-secundario" disabled={criando} onClick={() => void novaAdicional()} data-testid="st-nova-adicional">
          {criando ? 'Abrindo…' : 'Nova solicitação adicional para esta agenda'}
        </button>
      </section>

      {s.versions.length > 1 && (
        <section className="st-secao" aria-label="Versões enviadas">
          <h3>Versões enviadas</h3>
          {s.versions.map((v) => (
            <details key={v.number} className="st-versao" data-testid="st-versao">
              <summary>
                Versão {v.number} · {formatarDataHora(v.sentAt)} por {v.sentBy.name} · {textoVolumes(v.totals.definedVolumes)} definidos
                {v.totals.itemsInAnalysis > 0 && ` · ${String(v.totals.itemsInAnalysis)} em análise`}
              </summary>
              <TabelaVersao itens={v.items} />
            </details>
          ))}
        </section>
      )}
      <Historico s={s} />
    </>
  );
}

function TabelaVersao({ itens }: { itens: readonly ItemVersaoTeste[] }) {
  return (
    <div className="st-tabela-rolagem">
      <table className="st-tabela" data-testid="st-tabela-versao">
        <thead>
          <tr>
            <th scope="col">Palete</th>
            <th scope="col">Nota</th>
            <th scope="col">Delivery pedida</th>
            <th scope="col" className="st-num">Apresentado</th>
            <th scope="col" className="st-num">No envio</th>
            <th scope="col">Pedido</th>
            <th scope="col">Observação</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.id}>
              <td>{i.palletCode}</td>
              <td>{i.scope === 'PALETE' ? 'Palete inteiro' : textoDocumento(i.content)}</td>
              <td>{i.requestedDelivery ?? '—'}</td>
              <td className="st-num">
                {i.presented.volumes === null ? 'não inf.' : i.presented.volumes.toLocaleString('pt-BR')}
                {i.presented.unknownContents > 0 && ` + ${String(i.presented.unknownContents)} sem vol.`}
              </td>
              <td className="st-num">{i.atSend.volumes === null ? 'não inf.' : i.atSend.volumes.toLocaleString('pt-BR')}</td>
              <td className={i.needsAnalysis ? 'st-analise' : undefined}>{textoPedido(i)}</td>
              <td>{i.note ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Historico({ s }: { s: SolicitacaoTeste }) {
  return (
    <details className="st-secao st-historico" data-testid="st-historico">
      <summary>Histórico ({s.history.length})</summary>
      <ol>
        {s.history.map((h, i) => (
          <li key={`${h.at}-${String(i)}`}>
            <span className="st-nota">
              {formatarDataHora(h.at)} · {h.by.name}
            </span>{' '}
            {h.text}
          </li>
        ))}
      </ol>
    </details>
  );
}
