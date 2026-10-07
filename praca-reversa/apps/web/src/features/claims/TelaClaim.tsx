import {
  API_PREFIXO,
  ClaimDetalheSchema,
  SITUACOES_FINAIS_CLAIM,
  situacaoFinal,
  type ClaimDetalhe,
  type Permissao,
  type SituacaoClaim,
  type SituacaoFinalClaim,
} from '@praca-reversa/contracts';
import { useId, useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { AbaClaim, Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { useAcoesClaim } from './acoes';
import { ROTULOS_MOTIVO, ROTULOS_PENDENCIA, ROTULOS_PRIORIDADE, ROTULOS_SITUACAO, formatarDataInformada, textoUnidades, textoValores } from './rotulos';
import { SecaoCandidatos, SecaoEvidencias, SecaoHistorico, SecaoLinhas, SecaoResultados } from './SecoesClaim';

const ABAS: { aba: AbaClaim; rotulo: string }[] = [
  { aba: 'linhas', rotulo: 'Linhas' },
  { aba: 'candidatos', rotulo: 'Candidatos' },
  { aba: 'evidencias', rotulo: 'Evidências e recuperações' },
  { aba: 'resultados', rotulo: 'Resultados' },
  { aba: 'historico', rotulo: 'Histórico' },
];

export interface PropsSecao {
  caso: ClaimDetalhe;
  linhaId: string | null;
  permissoes: readonly Permissao[];
  conectado: boolean;
  acoes: ReturnType<typeof useAcoesClaim>;
  aoNavegar: Navegar;
  aoEscolherLinha: (linhaId: string, aba?: AbaClaim) => void;
  versao: number;
}

/**
 * Detalhe do claim: dados do caso, totais em bases separadas (estimado,
 * recuperação física validada, valor evitado e perda confirmados),
 * pendências, ações explícitas e seções. Linha e seção ficam no endereço
 * (/claims/<id>?linha=…&aba=…): voltar do mapa reabre o mesmo contexto.
 */
export function TelaClaim({
  id,
  linha,
  aba,
  permissoes,
  aoNavegar,
  aoGravar,
}: {
  id: string;
  linha: string | null;
  aba: AbaClaim | null;
  permissoes: readonly Permissao[];
  aoNavegar: Navegar;
  aoGravar: () => void;
}) {
  const ids = useId();
  const conectado = useConectado();
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/claims/${id}`, ClaimDetalheSchema, versao);
  const [proprio, setProprio] = useState<{ versao: number; caso: ClaimDetalhe } | null>(null);
  const acoes = useAcoesClaim(
    (d) => {
      setProprio({ versao, caso: d });
      aoGravar();
    },
    () => {
      setProprio(null);
      setVersao((v) => v + 1);
    },
  );
  const [painel, setPainel] = useState<'situacao' | 'encerrar' | 'reabrir' | null>(null);
  const [para, setPara] = useState<string>('');
  const [texto, setTexto] = useState('');
  const [ciente, setCiente] = useState(false);
  const caso = proprio?.versao === versao ? proprio.caso : carga?.estado === 'pronto' ? carga.dados : null;
  const pode = (p: Permissao) => permissoes.includes(p);
  const abaAtual: AbaClaim = aba ?? 'linhas';
  const voltar = () => {
    aoNavegar({ tipo: 'claims' });
  };

  if (caso === null) {
    return (
      <Pagina titulo="Claim" testId="tela-claim" aoVoltar={voltar} rotuloVoltar="Voltar aos claims">
        {carga?.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>{carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={recarregar}>
              <IconeAtualizar />
              Tentar novamente
            </button>
          </div>
        ) : (
          <p className="estado-carregando">Carregando claim…</p>
        )}
      </Pagina>
    );
  }

  const linhaId = linha !== null && caso.lines.some((l) => l.id === linha) ? linha : (caso.lines[0]?.id ?? null);
  const final = situacaoFinal(caso.state);
  const aoEscolherLinha = (novaLinha: string, novaAba?: AbaClaim) => {
    aoNavegar({ tipo: 'claim', id, linha: novaLinha, aba: novaAba ?? abaAtual }, { substituir: true });
  };
  const ocupado = acoes.enviando !== null;
  const props: PropsSecao = { caso, linhaId, permissoes, conectado, acoes, aoNavegar, aoEscolherLinha, versao };
  const t = caso.totals;
  const bloqueantes = caso.pendencies.filter((p) => p.blocksValidation);
  const outras = caso.pendencies.filter((p) => !p.blocksValidation);

  async function enviarPainel() {
    if (!caso) return;
    const base = `${API_PREFIXO}/claims/${caso.id}`;
    let ok = null;
    if (painel === 'situacao') {
      ok = await acoes.executar(`situacao:${caso.id}:${para}:${String(caso.version)}`, 'POST', `${base}/situacao`, { expectedVersion: caso.version, to: para, reason: texto }, 'Situação alterada.');
    } else if (painel === 'encerrar') {
      ok = await acoes.executar(
        `encerrar:${caso.id}:${para}:${String(caso.version)}`,
        'POST',
        `${base}/encerrar`,
        { expectedVersion: caso.version, to: para, decision: texto, pendenciesAcknowledged: ciente },
        'Caso encerrado com a decisão registrada.',
      );
    } else if (painel === 'reabrir') {
      ok = await acoes.executar(`reabrir:${caso.id}:${String(caso.version)}`, 'POST', `${base}/reabrir`, { expectedVersion: caso.version, to: para, reason: texto }, 'Caso reaberto: decisões anteriores preservadas.');
    }
    if (ok) {
      setPainel(null);
      setTexto('');
      setCiente(false);
    }
  }

  const abrir = (p: typeof painel, destino: string) => {
    setPainel(p);
    setPara(destino);
    setTexto('');
    setCiente(false);
    acoes.setMensagem(null);
  };

  return (
    <Pagina ajuda="claim"
      titulo={`${caso.code}${caso.externalReference ? ` · ${caso.externalReference}` : ''}`}
      testId="tela-claim"
      aoVoltar={voltar}
      rotuloVoltar="Voltar aos claims"
    >
      <section className="cartao claim-topo" aria-labelledby={`${ids}-dados`} data-testid="claim-topo">
        <h3 id={`${ids}-dados`} className="visualmente-oculto">
          Dados do caso
        </h3>
        <p className="claim-situacao">
          <span className={`selo selo-claim selo-claim--${caso.state}`} data-testid="claim-situacao">
            {ROTULOS_SITUACAO[caso.state]}
          </span>{' '}
          {ROTULOS_MOTIVO[caso.reason]} · prioridade {caso.priority ? ROTULOS_PRIORIDADE[caso.priority].toLowerCase() : 'não definida'} · prazo{' '}
          <strong>{formatarDataInformada(caso.deadline)}</strong>
        </p>
        <dl className="claim-dados">
          <div>
            <dt>Responsável</dt>
            <dd>{caso.responsible?.name ?? 'sem responsável'}</dd>
          </div>
          <div>
            <dt>Abertura / ocorrência</dt>
            <dd>
              {formatarDataInformada(caso.openedOn)} / {formatarDataInformada(caso.occurredOn)}
            </dd>
          </div>
          <div>
            <dt>Situação externa</dt>
            <dd>{caso.externalStatus ?? 'não informada'}</dd>
          </div>
          <div>
            <dt>Cobrança/tratativa</dt>
            <dd>
              {caso.chargeReference ?? 'sem referência'}
              {caso.chargeFinalized ? ' · financeiramente finalizada' : ' · em investigação'}
            </dd>
          </div>
          <div>
            <dt>Valor estimado: fonte</dt>
            <dd>{caso.valueSource ?? 'não informada'}</dd>
          </div>
          <div>
            <dt>Registro</dt>
            <dd>
              {caso.origin === 'IMPORTACAO' ? 'importado' : 'manual'} por {caso.createdBy.name} em {formatarDataHora(caso.createdAt)}
            </dd>
          </div>
        </dl>
        {caso.notes && <p className="campo-ajuda">{caso.notes}</p>}
        {caso.closure && (
          <p className="mensagem-ok">
            Decisão de encerramento ({caso.closure.by.name}, {formatarDataHora(caso.closure.at)}): {caso.closure.decision}
          </p>
        )}
        <div className="acoes-linha">
          {pode('claim.tratar') && !final && (
            <button type="button" className="botao-secundario" disabled={!conectado} onClick={() => { aoNavegar({ tipo: 'editar-claim', id: caso.id }); }} data-testid="editar-claim">
              Editar dados
            </button>
          )}
          {pode('claim.tratar') && caso.allowedTransitions.length > 0 && (
            <button type="button" className="botao-secundario" disabled={!conectado || ocupado} onClick={() => { abrir('situacao', caso.allowedTransitions[0] ?? ''); }} data-testid="mudar-situacao">
              Mudar situação
            </button>
          )}
          {pode('claim.validar') && !final && (
            <button type="button" className="botao-secundario" disabled={!conectado || ocupado} onClick={() => { abrir('encerrar', 'ENCERRADO'); }} data-testid="encerrar-claim">
              Encerrar com decisão
            </button>
          )}
          {pode('claim.validar') && final && (
            <button type="button" className="botao-secundario" disabled={!conectado || ocupado} onClick={() => { abrir('reabrir', 'BUSCA_EM_ANDAMENTO'); }} data-testid="reabrir-claim">
              Reabrir
            </button>
          )}
        </div>
        {painel !== null && (
          <form
            className="painel-acao"
            onSubmit={(e) => {
              e.preventDefault();
              void enviarPainel();
            }}
            data-testid="painel-situacao"
          >
            <label className="campo">
              <span className="campo-rotulo">{painel === 'encerrar' ? 'Decisão final' : 'Nova situação'}</span>
              <select value={para} onChange={(e) => { setPara(e.target.value); }}>
                {(painel === 'situacao' ? caso.allowedTransitions : painel === 'encerrar' ? [...SITUACOES_FINAIS_CLAIM] : (['EM_ANALISE', 'BUSCA_EM_ANDAMENTO'] as SituacaoClaim[])).map((s) => (
                  <option key={s} value={s}>
                    {ROTULOS_SITUACAO[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">{painel === 'encerrar' ? 'Decisão documentada (trata as pendências)' : 'Motivo'}</span>
              <textarea value={texto} rows={2} maxLength={2000} onChange={(e) => { setTexto(e.target.value); }} data-testid="texto-situacao" />
            </label>
            {painel === 'encerrar' && (
              <>
                {caso.pendencies.length > 0 && (
                  <ul className="lista-pendencias-claim">
                    {caso.pendencies.map((p, i) => (
                      <li key={`${p.code}-${String(i)}`}>{p.message}</li>
                    ))}
                  </ul>
                )}
                <label className="opcao">
                  <input type="checkbox" checked={ciente} onChange={(e) => { setCiente(e.target.checked); }} data-testid="ciente-pendencias" />
                  <span>
                    A decisão trata as pendências listadas. {(para as SituacaoFinalClaim) === 'PERDA_CONFIRMADA' ? 'Ausência de candidatos não prova perda: exige resultado de perda registrado.' : ''}
                  </span>
                </label>
              </>
            )}
            {painel === 'reabrir' && <p className="campo-ajuda">Reabrir não desfaz regularização, resultados nem libera quantidade vinculada.</p>}
            <div className="acoes-linha">
              <button type="submit" className="botao-primario" disabled={ocupado || !conectado} data-testid="confirmar-situacao">
                {ocupado ? 'Gravando…' : 'Confirmar'}
              </button>
              <button type="button" className="botao-link" onClick={() => { setPainel(null); }}>
                Cancelar
              </button>
            </div>
          </form>
        )}
        <MensagemAcao mensagem={acoes.mensagem} testId="mensagem-claim" />
        {!conectado && <p className="mensagem-conflito">Sem conexão: consulta apenas; nada é registrado.</p>}
      </section>

      <section className="cartao" aria-labelledby={`${ids}-totais`} data-testid="claim-totais">
        <h3 id={`${ids}-totais`}>Quantidades e valores (bases separadas)</h3>
        <dl className="claim-totais">
          <div>
            <dt>Em análise</dt>
            <dd>{textoUnidades(t.inAnalysis)}</dd>
          </div>
          <div>
            <dt>Recuperação física validada</dt>
            <dd data-testid="total-recuperado">{textoUnidades(t.validatedRecovery)}</dd>
          </div>
          <div>
            <dt>Sem recuperação física validada</dt>
            <dd data-testid="total-sem-recuperacao">{textoUnidades(t.withoutValidatedRecovery)}</dd>
          </div>
          <div>
            <dt>Estimado em análise (não é valor evitado)</dt>
            <dd data-testid="total-estimado">
              {textoValores(t.estimated, 'não informado')}
              {t.estimatePartial ? ' (parcial: há linha sem valor)' : ''}
            </dd>
          </div>
          <div>
            <dt>Valor evitado confirmado</dt>
            <dd data-testid="total-evitado">{textoValores(t.avoidedConfirmed)}</dd>
          </div>
          <div>
            <dt>Perda/avaria confirmada</dt>
            <dd data-testid="total-perda">
              {textoValores(t.lossConfirmed)}
              {t.lossConfirmedQuantity.length > 0 ? ` (${textoUnidades(t.lossConfirmedQuantity)})` : ''}
            </dd>
          </div>
          <div>
            <dt>Em tratativa (sem resultado)</dt>
            <dd>{textoUnidades(t.inTreatmentQuantity)}</dd>
          </div>
        </dl>
      </section>

      {caso.pendencies.length > 0 && (
        <section className="cartao" aria-labelledby={`${ids}-pend`} data-testid="claim-pendencias">
          <h3 id={`${ids}-pend`}>Pendências</h3>
          {bloqueantes.length > 0 && (
            <>
              <p className="campo-ajuda">Bloqueiam a validação de recuperação (triagem):</p>
              <ul className="lista-pendencias-claim lista-pendencias-claim--bloqueio">
                {bloqueantes.map((p, i) => (
                  <li key={`${p.code}-${String(i)}`}>
                    <strong>{ROTULOS_PENDENCIA[p.code]}:</strong> {p.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {outras.length > 0 && (
            <ul className="lista-pendencias-claim">
              {outras.map((p, i) => (
                <li key={`${p.code}-${String(i)}`}>
                  <strong>{ROTULOS_PENDENCIA[p.code]}:</strong> {p.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="abas-claim" role="tablist" aria-label="Seções do claim">
        {ABAS.map((a) => (
          <button
            key={a.aba}
            type="button"
            role="tab"
            aria-selected={abaAtual === a.aba}
            onClick={() => {
              aoNavegar({ tipo: 'claim', id, linha: linhaId, aba: a.aba }, { substituir: true });
            }}
            data-testid={`aba-${a.aba}`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {abaAtual === 'linhas' && <SecaoLinhas {...props} />}
        {abaAtual === 'candidatos' && <SecaoCandidatos {...props} />}
        {abaAtual === 'evidencias' && <SecaoEvidencias {...props} />}
        {abaAtual === 'resultados' && <SecaoResultados {...props} />}
        {abaAtual === 'historico' && <SecaoHistorico {...props} />}
      </div>
      <p className="campo-ajuda">Consultado em {formatarDataHora(caso.consultedAt)} · versão {caso.version}</p>
    </Pagina>
  );
}
