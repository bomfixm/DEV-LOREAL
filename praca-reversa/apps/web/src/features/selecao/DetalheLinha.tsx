import {
  API_PREFIXO,
  ROTULOS_ABRANGENCIA,
  ROTULOS_SITUACAO_CONCILIACAO,
  SelecaoDetalheSchema,
  type ResultadoConciliacao,
} from '@praca-reversa/contracts';
import { useId, useState } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { IconeAlvo } from '../../components/Icones';
import { MensagemAcao } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { MARCADOR_SITUACAO } from './rotulos';

const q = (v: string | null, unidade: string | null) => (v === null ? 'não comparável' : `${formatarQuantidade(v)}${unidade ? ` ${unidade}` : ''}`);

/** Resolver uma identificação ambígua: só os candidatos mostrados, com motivo (auditado). */
function Resolver({ selecaoId, versao, linha, aoResolvido }: { selecaoId: string; versao: number; linha: ResultadoConciliacao; aoResolvido: () => void }) {
  const ids = useId();
  const chaves = useChaves();
  const conectado = useConectado();
  const [escolha, setEscolha] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null>(null);
  const candidato = escolha === null ? null : (linha.candidates[escolha] ?? null);

  async function resolver() {
    if (!candidato) return;
    const corpo = { expectedVersion: versao, palletId: candidato.palletId, documentKey: candidato.documentKey, reason: motivo.trim() };
    const assinatura = `resolver:${linha.lineId}:${JSON.stringify(corpo)}`;
    setEnviando(true);
    setMensagem(null);
    try {
      await enviarJson('POST', `${API_PREFIXO}/selecoes/${selecaoId}/linhas/${linha.lineId}/resolucao`, SelecaoDetalheSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: 'Resolução registrada (com motivo e autor). A conciliação foi recalculada.' });
      aoResolvido();
    } catch (e) {
      chaves.concluir(assinatura, e);
      setMensagem({ tipo: e instanceof FalhaRequisicao && (e.codigo === 'CONFLITO_VERSAO' || e.tipo === 'rede') ? 'conflito' : 'erro', texto: mensagemDeFalha(e) });
      if (e instanceof FalhaRequisicao && e.codigo === 'CONFLITO_VERSAO') aoResolvido();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <fieldset className="cartao resolver-linha" data-testid="resolver-linha">
      <legend className="campo-rotulo">Resolver a identificação</legend>
      <p className="campo-ajuda">Escolha um dos candidatos mostrados. Nada é presumido: a escolha fica registrada com o motivo e pode ser anulada depois.</p>
      {linha.candidates.map((c, i) => (
        <label key={`${c.palletId ?? ''}:${c.documentKey ?? ''}`} className="opcao opcao--bloco">
          <input type="radio" name={`${ids}-candidato`} checked={escolha === i} onChange={() => { setEscolha(i); }} data-testid="candidato-resolucao" />
          <span>
            <strong>{c.palletCode ?? c.documentKey ?? 'Candidato'}</strong> — {c.description}
          </span>
        </label>
      ))}
      <label className="campo">
        <span className="campo-rotulo">Motivo da escolha</span>
        <input value={motivo} maxLength={500} onChange={(e) => { setMotivo(e.target.value); }} placeholder="ex.: cliente confirmou o tipo documental por e-mail" data-testid="motivo-resolucao" />
      </label>
      <MensagemAcao mensagem={mensagem} testId="mensagem-resolucao" />
      <button type="button" className="botao-primario" disabled={candidato === null || motivo.trim().length < 3 || enviando || !conectado} onClick={() => { void resolver(); }} data-testid="confirmar-resolucao">
        {enviando ? 'Registrando…' : 'Registrar resolução'}
      </button>
    </fieldset>
  );
}

function AnularResolucao({ selecaoId, versao, linha, aoAnulado }: { selecaoId: string; versao: number; linha: ResultadoConciliacao; aoAnulado: () => void }) {
  const chaves = useChaves();
  const conectado = useConectado();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null>(null);
  async function anular() {
    const corpo = { expectedVersion: versao, reason: motivo.trim() };
    const assinatura = `anular:${linha.lineId}:${JSON.stringify(corpo)}`;
    try {
      await enviarJson('POST', `${API_PREFIXO}/selecoes/${selecaoId}/linhas/${linha.lineId}/resolucao/anular`, SelecaoDetalheSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      aoAnulado();
    } catch (e) {
      chaves.concluir(assinatura, e);
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(e) });
    }
  }
  if (!aberto) {
    return (
      <button type="button" className="botao-link" onClick={() => { setAberto(true); }}>
        Anular resolução…
      </button>
    );
  }
  return (
    <div className="acoes-linha">
      <label className="campo">
        <span className="campo-rotulo">Motivo da anulação</span>
        <input value={motivo} maxLength={300} onChange={(e) => { setMotivo(e.target.value); }} />
      </label>
      <button type="button" className="botao-secundario" disabled={motivo.trim().length < 3 || !conectado} onClick={() => { void anular(); }}>
        Anular (o histórico é preservado)
      </button>
      <MensagemAcao mensagem={mensagem} testId="mensagem-anulacao" />
    </div>
  );
}

/**
 * Detalhe de uma linha conciliada: todos os paletes correspondentes, com
 * alocação informada × atual, documentos, material validado (com reservado,
 * liberado e disponível), restrições, saídas anteriores e conflitos de
 * demanda. Localização, base de quantidade e elegibilidade são separadas.
 */
export function DetalheLinha({
  linha,
  selecaoId,
  versaoSelecao,
  podeResolver,
  aoCentralizar,
  aoAbrirPalete,
  aoAtualizar,
}: {
  linha: ResultadoConciliacao;
  selecaoId: string;
  versaoSelecao: number;
  podeResolver: boolean;
  aoCentralizar: (paleteId: string) => void;
  aoAbrirPalete: (paleteId: string) => void;
  aoAtualizar: () => void;
}) {
  const r = linha.request;
  const qt = linha.quantities;
  return (
    <section className="cartao detalhe-linha-selecao" aria-label={`Linha ${String(linha.row)} da seleção`} data-testid="detalhe-linha-selecao">
      <h3>
        Linha {linha.row}
        {linha.lineRef ? ` · ${linha.lineRef}` : ''} —{' '}
        <span className={`selo-situacao-conciliacao selo-situacao-conciliacao--${linha.situation}`}>
          <span aria-hidden="true">{MARCADOR_SITUACAO[linha.situation]}</span> {ROTULOS_SITUACAO_CONCILIACAO[linha.situation]}
        </span>
      </h3>
      <dl className="situacao">
        <div>
          <dt>Abrangência</dt>
          <dd>
            {ROTULOS_ABRANGENCIA[linha.scope]} ({linha.scopeRule})
          </dd>
        </div>
        <div>
          <dt>Solicitado</dt>
          <dd>
            {[r.palletRef ? `palete ${r.palletRef}` : null, r.documentNumber ? `${r.documentType ?? 'documento'} ${r.documentNumber}` : null, r.delivery ? `DELIVERY ${r.delivery}` : null, r.sku ? `SKU ${r.sku}` : null, r.lot ? `lote ${r.lot}` : null]
              .filter(Boolean)
              .join(' · ') || '—'}
            {r.quantity !== null ? ` · ${formatarQuantidade(r.quantity)} ${r.unit ?? ''}` : ' · quantidade não informada'}
          </dd>
        </div>
        {r.notes && (
          <div>
            <dt>Observação do cliente</dt>
            <dd>{r.notes}</dd>
          </div>
        )}
        <div>
          <dt>Próximo passo</dt>
          <dd>{linha.nextStep}</dd>
        </div>
      </dl>
      {linha.alsoSituations.length > 0 && (
        <p className="campo-ajuda">Também: {linha.alsoSituations.map((s) => ROTULOS_SITUACAO_CONCILIACAO[s]).join(', ')}.</p>
      )}
      {linha.reasons.length > 0 && (
        <ul className="linha-motivos">
          {linha.reasons.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <h4>Quantidades (cada base separada)</h4>
      <dl className="situacao" data-testid="quantidades-linha">
        <div>
          <dt>Solicitada</dt>
          <dd>{qt.requested === null ? 'não informada' : q(qt.requested, qt.unit)}</dd>
        </div>
        <div>
          <dt>Volumes informados no inventário</dt>
          <dd>{qt.informedVolumes === null ? '—' : `${formatarQuantidade(qt.informedVolumes)} volumes (não são unidades de produto)`}</dd>
        </div>
        <div>
          <dt>Validada atual</dt>
          <dd>{q(qt.validated, qt.unit)}</dd>
        </div>
        <div>
          <dt>Reservada</dt>
          <dd>{q(qt.reserved, qt.unit)}</dd>
        </div>
        <div>
          <dt>Disponível</dt>
          <dd>{q(qt.available, qt.unit)}</dd>
        </div>
        <div>
          <dt>Não atendida pelos registros</dt>
          <dd data-testid="nao-atendida">{qt.unmet === null ? '—' : q(qt.unmet, qt.unit)}</dd>
        </div>
      </dl>
      <p className="campo-ajuda">Base: {qt.basis}. Diferença não é perda nem claim: é ausência de registro até a investigação.</p>

      <h4>Paletes correspondentes ({linha.allocations.length})</h4>
      {linha.allocations.length === 0 && <p className="estado-vazio">Nenhum palete comprovado para esta linha. Nenhuma posição é presumida.</p>}
      <ul className="alocacoes-linha">
        {linha.allocations.map((a) => (
          <li key={a.pallet.id} className="alocacao" data-testid="alocacao" data-palete={a.pallet.code}>
            <div className="alocacao-topo">
              <strong>{a.pallet.code}</strong>
              <span className={a.currentPosition === null ? 'pendente' : undefined}>
                Atual: {a.currentPosition === null ? 'localização pendente' : `${a.currentPosition.address ?? 'endereço real pendente'} (${a.currentPosition.code})`}
              </span>
              {a.informedAddress !== null && (
                <span>
                  Informado: {a.informedAddress}
                  {a.informedSource ? ` (${a.informedSource.inventoryCode}, linha ${String(a.informedSource.row)}${a.informedSource.countDate ? `, conferido em ${formatarData(`${a.informedSource.countDate}T12:00:00Z`)}` : ''})` : ''}
                </span>
              )}
              {a.addressDiffers && <span className="item-alerta">Endereço informado ≠ atual: vale o registro atual</span>}
            </div>
            {a.documents.length > 0 && (
              <p>
                Documentos: {a.documents.map((d) => `${d.documentType ?? '?'} ${d.documentNumber}${d.volumes !== null ? ` (${formatarQuantidade(d.volumes)} ${d.unit.toLowerCase()})` : ''}`).join(' · ')}
              </p>
            )}
            {a.documentsAddedAfter.length > 0 && (
              <p className="mensagem-conflito">Documentos atuais que não estavam no inventário de referência (não incluídos): {a.documentsAddedAfter.join(', ')}.</p>
            )}
            {a.material.length > 0 ? (
              <div className="tabela-rolagem">
                <table className="tabela-comparacao">
                  <thead>
                    <tr>
                      <th scope="col">SKU / lote / origem</th>
                      <th scope="col">Validado</th>
                      <th scope="col">Reservado</th>
                      <th scope="col">Liberado</th>
                      <th scope="col">Disponível</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.material.map((m) => (
                      <tr key={m.segmentId}>
                        <td>
                          {m.sku} — {m.description}
                          <span className="tabela-nota">
                            {' '}
                            · lote {m.lot ?? 'pendente'} · {m.originType ?? 'origem pendente'} {m.originReference ?? ''}
                            {m.blocked ? ' · bloqueado' : ''}
                          </span>
                        </td>
                        <td>
                          {formatarQuantidade(m.validated)} {m.unit}
                        </td>
                        <td>{formatarQuantidade(m.reserved)}</td>
                        <td>{formatarQuantidade(m.released)}</td>
                        <td>{formatarQuantidade(m.available)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="campo-ajuda">Sem saldo validado por produto neste palete: conteúdo conhecido só no nível documental (NF, volumes).</p>
            )}
            {a.restrictions.length > 0 && (
              <ul className="linha-avisos">
                {a.restrictions.map((t) => (
                  <li key={t}>Restrição: {t}</li>
                ))}
              </ul>
            )}
            <p className={a.eligibleForShipping ? 'mensagem-ok' : 'campo-ajuda'}>{a.eligibleForShipping ? 'Elegível para a proposta da janela.' : 'Não elegível para saída agora.'}</p>
            <div className="acoes-linha">
              {a.currentPosition !== null && (
                <button type="button" className="botao-secundario botao-compacto" onClick={() => { aoCentralizar(a.pallet.id); }} data-testid="centralizar-alocacao">
                  <IconeAlvo />
                  Ver no mapa
                </button>
              )}
              <button type="button" className="botao-link" onClick={() => { aoAbrirPalete(a.pallet.id); }}>
                Abrir palete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {linha.shipped.length > 0 && (
        <>
          <h4>Já expedido (histórico, fora do estoque atual)</h4>
          <ul>
            {linha.shipped.map((x) => (
              <li key={`${x.expeditionId}:${x.palletCode}:${x.sku}`}>
                {x.code} em {formatarDataHora(x.at)}: {formatarQuantidade(x.quantity)} {x.unit} de {x.sku} (palete {x.palletCode})
              </li>
            ))}
          </ul>
        </>
      )}
      {linha.demandConflicts.length > 0 && (
        <p className="mensagem-conflito" role="note">
          Possível conflito de demanda: o mesmo material aparece em{' '}
          {linha.demandConflicts.map((d) => `${d.selectionCode} linha ${String(d.row)} (palete ${d.palletCode})`).join(', ')}. A disponibilidade não é duplicada; reserve
          pelo controle único da janela.
        </p>
      )}
      {(linha.forwarded.reservations.length > 0 || linha.forwarded.shipped !== '0') && (
        <p>
          Encaminhado: reservado ativo {formatarQuantidade(linha.forwarded.reservedActive)} · expedido {formatarQuantidade(linha.forwarded.shipped)}
          {linha.forwarded.reservations.length > 0 ? ` · reservas ${linha.forwarded.reservations.join(', ')}` : ''}
        </p>
      )}
      {linha.resolution && (
        <div className="cartao" data-testid="resolucao-registrada">
          <p>
            Resolvida: {linha.resolution.palletCode ?? linha.resolution.documentKey} — “{linha.resolution.reason}”
            {linha.resolution.by ? ` por ${linha.resolution.by.name}` : ''} em {formatarDataHora(linha.resolution.at)}.
          </p>
          {podeResolver && <AnularResolucao selecaoId={selecaoId} versao={versaoSelecao} linha={linha} aoAnulado={aoAtualizar} />}
        </div>
      )}
      {podeResolver && linha.resolution === null && linha.candidates.length > 0 && <Resolver selecaoId={selecaoId} versao={versaoSelecao} linha={linha} aoResolvido={aoAtualizar} />}
      {linha.duplicateOfRow !== null && <p className="campo-ajuda">Repetida da linha {linha.duplicateOfRow}: agrupada sem somar quantidades.</p>}
    </section>
  );
}
