import {
  API_PREFIXO,
  IndicadoresSchema,
  ROTULOS_BASE_PESO,
  ROTULOS_METRICA,
  ROTULOS_MOTIVO_CLAIM,
  ROTULOS_SITUACAO_CLAIM,
  ROTULOS_SITUACAO_JANELA,
  type FiltroPendencia,
  type FluxoUnidade,
  type Indicadores,
  type Permissao,
  type QuantidadeUnidade,
  type ValorMoeda,
} from '@praca-reversa/contracts';
import { useState, type ReactNode } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { EstadoTela, Pagina } from '../../components/Moldura';
import { IconeAtualizar } from '../../components/Icones';
import type { Navegar } from '../../rotas';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { AjudaTarefa } from '../ajuda/AjudaTarefa';
import { ROTULOS_FILTRO_PENDENCIA } from '../claims/rotulos';
import { ROTULOS_CONFERENCIA } from '../paletes/estados';
import { fq, fv, textoPeriodo } from './formato';

interface Props {
  inicio: string | null;
  fim: string | null;
  permissoes: readonly Permissao[];
  aoNavegar: Navegar;
}

function Numero({ rotulo, valor, nota, testId }: { rotulo: string; valor: ReactNode; nota?: ReactNode; testId?: string }) {
  return (
    <div className="indicador" data-testid={testId}>
      <dt>{rotulo}</dt>
      <dd>
        <strong className="indicador-valor">{valor}</strong>
        {nota !== undefined && <span className="indicador-nota">{nota}</span>}
      </dd>
    </div>
  );
}

function PorUnidade({ itens, vazio }: { itens: readonly QuantidadeUnidade[]; vazio: string }) {
  if (itens.length === 0) return <>{vazio}</>;
  return <>{itens.map((i) => `${fq(i.quantity)} ${i.unit}`).join(' · ')}</>;
}

function PorMoeda({ itens, vazio }: { itens: readonly ValorMoeda[]; vazio: string }) {
  if (itens.length === 0) return <>{vazio}</>;
  return <>{itens.map((i) => `${i.currency} ${fv(i.value)}`).join(' · ')}</>;
}

function Cartao({ titulo, base, children, acoes, testId }: { titulo: string; base: string; children: ReactNode; acoes?: ReactNode; testId: string }) {
  return (
    <section className="cartao cartao-indicadores" aria-labelledby={`ind-${testId}`} data-testid={testId}>
      <h3 id={`ind-${testId}`}>{titulo}</h3>
      <p className="indicador-base">{base}</p>
      {children}
      {acoes !== undefined && <div className="acoes-linha">{acoes}</div>}
    </section>
  );
}

function TabelaFluxo({ fluxo }: { fluxo: readonly FluxoUnidade[] }) {
  if (fluxo.length === 0) return <p className="estado-vazio">Nenhum saldo validado nem evento de estoque até o fim do período.</p>;
  return (
    <div className="tabela-rolagem">
      <table className="tabela-indicadores" data-testid="fluxo-estoque">
        <caption>Saldo final = inicial + entradas − saídas + ajustes (por unidade)</caption>
        <thead>
          <tr>
            <th scope="col">Unidade</th>
            <th scope="col">Saldo inicial</th>
            <th scope="col">Entradas validadas</th>
            <th scope="col">Saídas confirmadas</th>
            <th scope="col">Ajustes líquidos</th>
            <th scope="col">Saldo final</th>
            <th scope="col">Transferido entre paletes</th>
            <th scope="col">Conferência</th>
          </tr>
        </thead>
        <tbody>
          {fluxo.map((f) => (
            <tr key={f.unit} data-unidade={f.unit}>
              <th scope="row">{f.unit}</th>
              <td data-rotulo="Saldo inicial">{fq(f.opening)}</td>
              <td data-rotulo="Entradas validadas">
                {fq(f.entries)}
                {f.entriesFromReturns !== '0' && <span className="indicador-nota"> (retorno: {fq(f.entriesFromReturns)})</span>}
              </td>
              <td data-rotulo="Saídas confirmadas">{fq(f.exits)}</td>
              <td data-rotulo="Ajustes líquidos">{fq(f.adjustments)}</td>
              <td data-rotulo="Saldo final" data-testid="fluxo-final">
                <strong>{fq(f.closing)}</strong>
              </td>
              <td data-rotulo="Transferido entre paletes">{fq(f.transfersMoved)} (não altera o total)</td>
              <td data-rotulo="Conferência">{f.consistent ? '✓ fecha' : '✕ não fecha — comunique o suporte'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Painel de indicadores (etapa 10). Posição atual separada do período;
 * cada cartão informa a base. Tudo vem do servidor numa única leitura; áreas
 * fora do perfil não são devolvidas pela API.
 */
export function TelaIndicadores({ inicio, fim, permissoes, aoNavegar }: Props) {
  const [versao, setVersao] = useState(0);
  const [formInicio, setFormInicio] = useState(inicio ?? '');
  const [formFim, setFormFim] = useState(fim ?? '');
  const consulta = new URLSearchParams();
  if (inicio) consulta.set('inicio', inicio);
  if (fim) consulta.set('fim', fim);
  const q = consulta.toString();
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/indicadores${q ? `?${q}` : ''}`, IndicadoresSchema, versao);
  const voltar = () => {
    aoNavegar({ tipo: 'praca' });
  };
  const relatorio = (parametros: Record<string, string>) => {
    const p = new URLSearchParams(parametros);
    if (carga?.estado === 'pronto') {
      p.set('inicio', carga.dados.period.start);
      p.set('fim', carga.dados.period.end);
    }
    aoNavegar({ tipo: 'relatorios', parametros: p.toString() });
  };
  const podeRelatorio = permissoes.includes('palete.consultar');

  const formulario = (
    <form
      className="filtro-periodo"
      onSubmit={(e) => {
        e.preventDefault();
        aoNavegar({ tipo: 'indicadores', inicio: formInicio || null, fim: formFim || null });
        setVersao((v) => v + 1);
      }}
      aria-label="Período"
    >
      <label className="campo">
        <span className="campo-rotulo">Data inicial</span>
        <input type="date" value={formInicio} onChange={(e) => { setFormInicio(e.target.value); }} data-testid="indicadores-inicio" />
      </label>
      <label className="campo">
        <span className="campo-rotulo">Data final</span>
        <input type="date" value={formFim} onChange={(e) => { setFormFim(e.target.value); }} data-testid="indicadores-fim" />
      </label>
      <button type="submit" className="botao-primario botao-compacto" data-testid="indicadores-aplicar">
        Aplicar período
      </button>
      <button
        type="button"
        className="botao-link"
        onClick={() => {
          setFormInicio('');
          setFormFim('');
          aoNavegar({ tipo: 'indicadores', inicio: null, fim: null });
        }}
      >
        Mês atual
      </button>
    </form>
  );

  if (carga?.estado !== 'pronto') {
    return (
      <Pagina titulo="Indicadores" testId="tela-indicadores" aoVoltar={voltar}>
        {formulario}
        {carga?.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>Não foi possível calcular os indicadores. {carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={recarregar}>
              <IconeAtualizar />
              Tentar novamente
            </button>
          </div>
        ) : (
          <EstadoTela carga={{ estado: 'carregando' }} titulo="" aoTentarNovamente={recarregar} />
        )}
      </Pagina>
    );
  }
  const d: Indicadores = carga.dados;
  const restrita = (area: string) => d.restricted.includes(area as Indicadores['restricted'][number]);
  return (
    <Pagina
      titulo="Indicadores"
      testId="tela-indicadores"
      aoVoltar={voltar}
      descricao={
        <p>
          Posição atual separada do que aconteceu no período. Cada número informa a base; quantidades de unidades diferentes e moedas diferentes
          nunca são somadas.
        </p>
      }
    >
      <AjudaTarefa tarefa="consultar" />
      {formulario}
      <section className="cartao cabecalho-indicadores" data-testid="indicadores-cabecalho">
        <p>
          <strong>Unidade/cliente:</strong> {d.scope.name}
          {d.scope.demo && <span className="selo-demo-inline"> Demonstração · dados fictícios</span>}
        </p>
        <p data-testid="indicadores-periodo">
          <strong>Período:</strong> {textoPeriodo(d.period)}
        </p>
        <p>
          <strong>Consultado em:</strong> {formatarDataHora(d.consultedAt)} (horário de Brasília), numa única leitura do banco.
        </p>
        <p className={d.positionsBasis.provisional ? 'mensagem-conflito' : undefined} data-testid="base-posicoes">
          <strong>{d.positionsBasis.label}</strong>
          {d.positionsBasis.layout && (
            <>
              {' '}
              · {d.positionsBasis.layout.name}, revisão {d.positionsBasis.layout.revision}
              {d.positionsBasis.layout.schematic ? ', desenho esquemático' : ''}
              {d.positionsBasis.layout.provisionalCodes > 0 ? `, ${String(d.positionsBasis.layout.provisionalCodes)} código(s) de posição provisório(s)` : ''}
              {d.positionsBasis.layout.totalCapacity === null ? '; capacidade física total ainda desconhecida' : `; capacidade confirmada ${String(d.positionsBasis.layout.totalCapacity)}`}
            </>
          )}
          {d.positionsBasis.changesInPeriod > 0 && <> · a configuração mudou {d.positionsBasis.changesInPeriod} vez(es) no período (o denominador mudou)</>}
        </p>
        <button type="button" className="botao-secundario botao-compacto" onClick={() => { window.print(); }}>
          Imprimir
        </button>
      </section>

      <div className="grade-indicadores">
        {d.praca && (
          <Cartao
            titulo="Praça"
            base="Posição atual. Cada palete e cada posição contam uma vez, com qualquer número de produtos e documentos."
            testId="ind-praca"
            acoes={
              podeRelatorio && (
                <button type="button" className="botao-link" onClick={() => { relatorio({ tipo: 'paletes', localizacao: 'PENDENTE' }); }}>
                  Ver paletes com localização pendente
                </button>
              )
            }
          >
            <dl className="indicadores">
              <Numero rotulo="Paletes na praça" valor={d.praca.palletsInStock} nota={`${String(d.praca.palletsReserved)} reservado(s) para janela`} testId="ind-paletes" />
              <Numero rotulo="Com posição" valor={d.praca.palletsWithPosition} />
              <Numero rotulo="Localização pendente" valor={d.praca.palletsLocationPending} />
              <Numero
                rotulo="Ocupação"
                valor={d.praca.occupancyPercent === null ? 'sem base para cálculo' : `${d.praca.occupancyPercent.replace('.', ',')}%`}
                nota={d.praca.occupancyNote}
                testId="ind-ocupacao"
              />
              {d.praca.positions && (
                <>
                  <Numero rotulo="Posições elegíveis (denominador)" valor={d.praca.positions.eligible} nota={`${String(d.praca.positions.occupied)} ocupadas · ${String(d.praca.positions.free)} livres`} testId="ind-posicoes" />
                  <Numero
                    rotulo="Posições indisponíveis"
                    valor={d.praca.positions.unavailable}
                    nota={d.praca.positions.unavailableOccupied > 0 ? `${String(d.praca.positions.unavailableOccupied)} com palete registrado (à parte)` : 'fora do denominador'}
                  />
                </>
              )}
              {d.praca.drawnAreas && (
                <Numero
                  rotulo="Áreas desenhadas (não são posições)"
                  valor={d.praca.drawnAreas.corridors + d.praca.drawnAreas.docks + d.praca.drawnAreas.zones + d.praca.drawnAreas.blocks}
                  nota={`${String(d.praca.drawnAreas.corridors)} corredor(es), ${String(d.praca.drawnAreas.docks)} doca(s), ${String(d.praca.drawnAreas.zones)} zona(s), ${String(d.praca.drawnAreas.blocks)} bloco(s)`}
                />
              )}
            </dl>
            <h4>No período</h4>
            <dl className="indicadores indicadores--periodo">
              <Numero rotulo="Paletes cadastrados" valor={d.praca.period.registered} />
              <Numero rotulo="Mudanças de localização" valor={d.praca.period.moves} />
              <Numero rotulo="Paletes vazios retirados (consolidação)" valor={d.praca.period.retiredEmpty} nota="não é saída de estoque" testId="ind-retirados" />
              <Numero rotulo="Paletes que saíram inteiros na expedição" valor={d.praca.period.shippedWhole} />
            </dl>
          </Cartao>
        )}

        {d.conferencia && (
          <Cartao titulo="Conferência" base="Posição atual dos paletes na praça; o período conta as sessões pelo horário de cada etapa." testId="ind-conferencia">
            <dl className="indicadores">
              {(['NAO_CONFERIDO', 'PARCIAL', 'AGUARDANDO_VALIDACAO', 'RECONCILIADO'] as const).map((estado) => (
                <Numero
                  key={estado}
                  rotulo={ROTULOS_CONFERENCIA[estado].texto}
                  valor={
                    podeRelatorio ? (
                      <button type="button" className="botao-link botao-numero" onClick={() => { relatorio({ tipo: 'paletes', conferencia: estado }); }}>
                        {d.conferencia?.byState[estado]}
                      </button>
                    ) : (
                      d.conferencia?.byState[estado]
                    )
                  }
                  testId={`ind-conf-${estado}`}
                />
              ))}
              <Numero rotulo="Conferências em andamento" valor={d.conferencia.activeCounts} />
              <Numero rotulo="Observações pendentes" valor={d.conferencia.pendingObservations} nota="produto não identificado ou fator desconhecido" />
            </dl>
            <h4>No período</h4>
            <dl className="indicadores indicadores--periodo">
              <Numero rotulo="Iniciadas" valor={d.conferencia.period.started} />
              <Numero rotulo="Concluídas" valor={d.conferencia.period.concluded} />
              <Numero rotulo="Reconciliadas" valor={d.conferencia.period.reconciled} />
              <Numero rotulo="Recontagens" valor={d.conferencia.period.recounts} />
              <Numero rotulo="Canceladas" valor={d.conferencia.period.cancelled} />
            </dl>
          </Cartao>
        )}

        {d.estoque && (
          <Cartao
            titulo="Estoque validado"
            base="Saldo validado por unidade (sem conversão entre unidades). Documentos e contagens não validadas ficam à parte."
            testId="ind-estoque"
            acoes={
              podeRelatorio && (
                <button type="button" className="botao-link" onClick={() => { relatorio({ tipo: 'estoque' }); }}>
                  Detalhar por produto, lote e origem
                </button>
              )
            }
          >
            {d.estoque.current.length === 0 ? (
              <p className="estado-vazio">Nenhum saldo validado neste escopo.</p>
            ) : (
              <dl className="indicadores">
                {d.estoque.current.map((s) => (
                  <Numero
                    key={s.unit}
                    rotulo={`Saldo validado (${s.unit})`}
                    valor={fq(s.validated)}
                    nota={`reservado ${fq(s.reserved)} · disponível ${fq(s.available)} · vinculado a claim ${fq(s.linked)} · ${String(s.skus)} SKU(s) em ${String(s.pallets)} palete(s)`}
                    testId={`ind-saldo-${s.unit}`}
                  />
                ))}
              </dl>
            )}
            {d.estoque.palletsWithUnknownContent > 0 && (
              <p className="mensagem-conflito" data-testid="ind-desconhecido">
                {d.estoque.palletsWithUnknownContent} palete(s) na praça sem conteúdo totalmente validado (não conferidos, parciais ou aguardando validação):
                o saldo validado não representa todo o material físico. Conteúdo desconhecido não é zero.
              </p>
            )}
            <p className="indicador-base">
              Documental (não é estoque físico): declarado nos paletes <PorUnidade itens={d.estoque.documentary.declaredOnPallets} vazio="nenhum" />; documentos importados{' '}
              <PorUnidade itens={d.estoque.documentary.importedDocuments} vazio="nenhum" />.
            </p>
            <h4>No período</h4>
            <TabelaFluxo fluxo={d.estoque.flow} />
            <p className="indicador-base">
              Retornos físicos registrados: {d.estoque.returns.physical} (<PorUnidade itens={d.estoque.returns.physicalQuantity} vazio="sem quantidade" />), que entram no saldo só depois de
              conferidos e reconciliados. Avisos documentais de retorno: {d.estoque.returns.notices} (não alteram o saldo).
            </p>
          </Cartao>
        )}

        {d.idade && (
          <Cartao titulo="Idade do material" base="Saldo validado atual pelo mês da primeira entrada física validada (mesma regra do FIFO das janelas). Sem faixas ou metas: critérios do cliente ainda não informados." testId="ind-idade">
            {d.idade.byMonth.length === 0 && d.idade.withoutEntryDate.length === 0 ? (
              <p className="estado-vazio">Sem saldo validado.</p>
            ) : (
              <ul className="lista-simples">
                {d.idade.byMonth.map((m) => (
                  <li key={`${m.month}-${m.unit}`}>
                    {m.month.slice(5)}/{m.month.slice(0, 4)}: {fq(m.quantity)} {m.unit} ({m.lines} linha(s))
                  </li>
                ))}
                {d.idade.withoutEntryDate.map((m) => (
                  <li key={`sem-${m.unit}`} className="pendente">
                    Sem data de entrada validada: {fq(m.quantity)} {m.unit}
                  </li>
                ))}
              </ul>
            )}
            <p className="indicador-base">
              Referência apenas documental (data do documento importado, não é entrada física): {d.idade.documentReference.lines} linha(s)
              {d.idade.documentReference.oldest
                ? `, de ${formatarData(`${d.idade.documentReference.oldest}T12:00:00Z`)} a ${formatarData(`${d.idade.documentReference.newest ?? d.idade.documentReference.oldest}T12:00:00Z`)}`
                : ''}
              .
            </p>
          </Cartao>
        )}

        {d.claims && (
          <Cartao
            titulo="Claims"
            base="Posição atual dos casos. Candidato é pista; recuperação validada vem de vínculo válido com o material."
            testId="ind-claims"
            acoes={
              <button type="button" className="botao-link" onClick={() => { relatorio({ tipo: 'claims' }); }}>
                Detalhar casos e valores
              </button>
            }
          >
            <dl className="indicadores">
              <Numero rotulo="Casos" valor={d.claims.cases} nota={`${String(d.claims.open)} não finalizado(s)`} />
              <Numero rotulo="Casos com candidato em investigação" valor={d.claims.casesWithCandidates} nota={`${String(d.claims.candidatesInvestigating)} candidato(s); pista, não recuperação`} />
              <Numero
                rotulo="Recuperação física validada"
                valor={d.claims.recoveredValidated.length === 0 ? 'nenhuma' : d.claims.recoveredValidated.map((r) => `${fq(r.quantity)} ${r.unit}`).join(' · ')}
                nota={d.claims.recoveredValidated.length === 0 ? undefined : `${String(d.claims.recoveredValidated.reduce((t, r) => t + r.cases, 0))} caso(s) por unidade`}
              />
            </dl>
            <p className="indicador-base">
              Por situação: {d.claims.byState.map((s) => `${ROTULOS_SITUACAO_CLAIM[s.state]} ${String(s.count)}`).join(' · ') || 'nenhum caso'}.
            </p>
            <p className="indicador-base">Por motivo: {d.claims.byReason.map((m) => `${ROTULOS_MOTIVO_CLAIM[m.reason]} ${String(m.count)}`).join(' · ') || 'nenhum caso'}.</p>
            <p className="indicador-base">
              Pendências:{' '}
              {d.claims.pendencies
                .filter((p) => p.count > 0)
                .map((p) => `${ROTULOS_FILTRO_PENDENCIA[p.code as FiltroPendencia]} ${String(p.count)}`)
                .join(' · ') || 'nenhuma'}
              .
            </p>
            <h4>No período</h4>
            <dl className="indicadores indicadores--periodo">
              <Numero rotulo="Casos registrados" valor={d.claims.period.opened} />
              <Numero rotulo="Recuperações validadas" valor={<PorUnidade itens={d.claims.period.recoveries} vazio="nenhuma" />} />
              <Numero rotulo="Estornos de recuperação" valor={d.claims.period.reversals} />
              <Numero rotulo="Casos encerrados" valor={d.claims.period.closed} />
            </dl>
          </Cartao>
        )}

        {d.valores && (
          <Cartao titulo="Valores" base="Por moeda, sem conversão. Estimativa não é valor evitado; confirmados vêm de resultados vigentes registrados por quem tem aprovação financeira." testId="ind-valores">
            <dl className="indicadores">
              <Numero
                rotulo="Estimativa em análise"
                valor={<PorMoeda itens={d.valores.estimatedInAnalysis} vazio="nenhuma" />}
                nota={
                  d.valores.estimatedInAnalysis.some((e) => e.partialCases > 0)
                    ? `${String(d.valores.estimatedInAnalysis.reduce((t, e) => t + e.partialCases, 0))} caso(s) com estimativa parcial; não é valor evitado`
                    : 'não é valor evitado'
                }
                testId="ind-estimado"
              />
              <Numero rotulo="Valor evitado confirmado" valor={<PorMoeda itens={d.valores.avoidedConfirmed} vazio="nenhum" />} testId="ind-evitado" />
              <Numero rotulo="Perda confirmada" valor={<PorMoeda itens={d.valores.lossConfirmed} vazio="nenhuma" />} />
              <Numero rotulo="Resultados corrigidos / anulados" valor={`${String(d.valores.corrections.corrected)} / ${String(d.valores.corrections.annulled)}`} nota="fora dos totais; histórico preservado no caso" />
            </dl>
            <h4>Registrado no período</h4>
            <dl className="indicadores indicadores--periodo">
              <Numero rotulo="Valor evitado confirmado" valor={<PorMoeda itens={d.valores.period.avoidedConfirmed} vazio="nenhum" />} />
              <Numero rotulo="Perda confirmada" valor={<PorMoeda itens={d.valores.period.lossConfirmed} vazio="nenhuma" />} />
            </dl>
          </Cartao>
        )}

        {d.janelas && (
          <Cartao
            titulo="Janelas e fluxo"
            base="Cada janela usa as próprias métricas (peças, caixas, paletes, peso, volume), sem conversão por fator genérico. Restante = limite − reservado ativo − expedido."
            testId="ind-janelas"
            acoes={
              <button type="button" className="botao-link" onClick={() => { relatorio({ tipo: 'expedicoes' }); }}>
                Ver expedições do período
              </button>
            }
          >
            {d.janelas.windows.length === 0 ? (
              <p className="estado-vazio">Nenhuma janela no período.</p>
            ) : (
              <ul className="lista-janelas-indicadores">
                {d.janelas.windows.map((j) => (
                  <li key={j.id}>
                    <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'janela', id: j.id, aba: 'resumo' }); }}>
                      {j.code} — {j.name}
                    </button>{' '}
                    ({ROTULOS_SITUACAO_JANELA[j.state]})
                    <ul>
                      {j.restrictions.length === 0 && <li>Sem restrição de capacidade cadastrada.</li>}
                      {j.restrictions.map((r) => (
                        <li key={`${r.metric}-${r.unit}`}>
                          {ROTULOS_METRICA[r.metric]}
                          {r.weightBase ? ` ${ROTULOS_BASE_PESO[r.weightBase]}` : ''} ({r.unit}): limite {r.limit === null ? 'pendente (não é ilimitado)' : fq(r.limit)} · reservado ativo{' '}
                          {fq(r.reservedActive)} · expedido {fq(r.shipped)} · restante {r.remaining === null ? 'sem base' : fq(r.remaining)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {d.janelas.truncated && <p className="filtro-nota">Mostrando as primeiras janelas do período.</p>}
            <h4>No período</h4>
            <dl className="indicadores indicadores--periodo">
              <Numero rotulo="Expedições confirmadas" valor={d.janelas.period.expeditions} nota={`${String(d.janelas.period.partialExpeditions)} com conclusão parcial`} />
              <Numero rotulo="Enviado (baixa)" valor={<PorUnidade itens={d.janelas.period.shipped} vazio="nada" />} />
              <Numero rotulo="Paletes que saíram inteiros" valor={d.janelas.period.palletsShippedWhole} />
              <Numero rotulo="Reservas criadas / canceladas ou liberadas" valor={`${String(d.janelas.period.reservationsCreated)} / ${String(d.janelas.period.reservationsCancelled)}`} nota="reserva não altera o físico" />
            </dl>
          </Cartao>
        )}
      </div>

      {d.restricted.length > 0 && (
        <p className="bloco-nota" data-testid="ind-restritas">
          Seu perfil não consulta: {[restrita('claims') || restrita('valores') ? 'claims e valores' : null, restrita('janelas') ? 'janelas' : null, restrita('praca') ? 'praça, conferência e estoque' : null].filter(Boolean).join(', ')}. Esses números não são enviados a este aparelho.
        </p>
      )}
      <section className="cartao" aria-labelledby="ind-pendentes" data-testid="ind-indisponiveis">
        <h3 id="ind-pendentes">Sem base de medição (pendências)</h3>
        <ul>
          {d.unavailable.map((u) => (
            <li key={u.title}>
              <strong>{u.title}:</strong> {u.reason}
            </li>
          ))}
        </ul>
      </section>
    </Pagina>
  );
}
