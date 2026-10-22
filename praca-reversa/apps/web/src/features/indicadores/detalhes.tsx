import {
  ROTULOS_BASE_PESO,
  ROTULOS_METRICA,
  ROTULOS_MOTIVO_CLAIM,
  ROTULOS_SITUACAO_CLAIM,
  ROTULOS_SITUACAO_JANELA,
  type FiltroPendencia,
  type FluxoUnidade,
  type Indicadores,
  type QuantidadeUnidade,
  type ValorMoeda,
} from '@praca-reversa/contracts';
import type { ReactNode } from 'react';
import type { Navegar } from '../../rotas';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { AjudaTarefa } from '../ajuda/AjudaTarefa';
import { ROTULOS_FILTRO_PENDENCIA } from '../claims/rotulos';
import { contagem, intervaloCurto, plural, textoPercentual } from './dashboard-dados';
import { fq, fv, textoPeriodo } from './formato';
import { AcaoModulo, BarrasConferencia, Modulo, Numero, Selo } from './pecas';

/**
 * Abas de detalhe dos Indicadores: todos os números da tela anterior,
 * agrupados por assunto, com unidade e critério. "Sobre os números" reúne
 * base, período, regras e limites.
 */

interface PropsDetalhe {
  d: Indicadores;
  podeRelatorio: boolean;
  aoRelatorio: (parametros: Record<string, string>) => void;
}

function PorUnidade({ itens, vazio }: { itens: readonly QuantidadeUnidade[]; vazio: string }) {
  if (itens.length === 0) return <>{vazio}</>;
  return <>{itens.map((i) => `${fq(i.quantity)} ${i.unit}`).join(' · ')}</>;
}

function PorMoeda({ itens, vazio }: { itens: readonly ValorMoeda[]; vazio: string }) {
  if (itens.length === 0) return <>{vazio}</>;
  return <>{itens.map((i) => `${i.currency} ${fv(i.value)}`).join(' · ')}</>;
}

function Lista({ children, periodo = false }: { children: ReactNode; periodo?: boolean }) {
  return <dl className={periodo ? 'ind-numeros ind-numeros--periodo' : 'ind-numeros'}>{children}</dl>;
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="ind-bloco">
      <h4>{titulo}</h4>
      {children}
    </div>
  );
}

// ---------- Praça e movimentações ----------

export function PainelPraca({ d, podeRelatorio, aoRelatorio, aoNavegar }: PropsDetalhe & { aoNavegar: Navegar }) {
  const praca = d.praca;
  const intervalo = intervaloCurto(d.period);
  return (
    <div className="ind-grade ind-grade--detalhe">
      {praca === null ? (
        <p className="ind-restritas">Seu perfil não consulta a praça: esses números não são enviados a este aparelho.</p>
      ) : (
        <>
          <Modulo
            titulo="Praça agora"
            subtitulo="Posição atual · cada palete e cada posição contam uma vez"
            classe="ind-mod--metade"
            testId="ind-praca"
            selo={d.positionsBasis.provisional ? <Selo>Base provisória</Selo> : undefined}
            acao={
              podeRelatorio && praca.palletsLocationPending > 0 ? (
                <AcaoModulo
                  aoClicar={() => {
                    aoRelatorio({ tipo: 'paletes', localizacao: 'PENDENTE' });
                  }}
                >
                  Localização pendente
                </AcaoModulo>
              ) : undefined
            }
          >
            <Lista>
              <Numero rotulo="Paletes na praça" valor={contagem(praca.palletsInStock)} nota={`${plural(praca.palletsReserved, 'reservado', 'reservados')} para janela (parte do total)`} testId="ind-paletes" />
              <Numero rotulo="Com posição" valor={contagem(praca.palletsWithPosition)} />
              <Numero rotulo="Localização pendente" valor={contagem(praca.palletsLocationPending)} nota="não é ausência física" />
              <Numero
                rotulo="Ocupação"
                valor={textoPercentual(praca.occupancyPercent) ?? 'sem base para cálculo'}
                nota={praca.occupancyNote}
                testId="ind-ocupacao-detalhe"
              />
              {praca.positions && (
                <>
                  <Numero rotulo="Posições cadastradas" valor={contagem(praca.positions.registered)} nota="elegíveis + indisponíveis" />
                  <Numero
                    rotulo="Posições elegíveis (base)"
                    valor={contagem(praca.positions.eligible)}
                    nota={`${contagem(praca.positions.occupied)} ocupadas · ${contagem(praca.positions.free)} livres (sem palete registrado)`}
                    testId="ind-posicoes"
                  />
                  <Numero
                    rotulo="Posições indisponíveis"
                    valor={contagem(praca.positions.unavailable)}
                    nota={praca.positions.unavailableOccupied > 0 ? `fora da base; ${contagem(praca.positions.unavailableOccupied)} com palete registrado (à parte)` : 'fora da base'}
                  />
                </>
              )}
              {praca.drawnAreas && (
                <Numero
                  rotulo="Áreas desenhadas (não são posições)"
                  valor={contagem(praca.drawnAreas.corridors + praca.drawnAreas.docks + praca.drawnAreas.zones + praca.drawnAreas.blocks)}
                  nota={`${plural(praca.drawnAreas.corridors, 'corredor', 'corredores')}, ${plural(praca.drawnAreas.docks, 'doca', 'docas')}, ${plural(praca.drawnAreas.zones, 'zona', 'zonas')}, ${plural(praca.drawnAreas.blocks, 'bloco', 'blocos')}`}
                />
              )}
            </Lista>
          </Modulo>
          <Modulo titulo="Paletes e localização no período" subtitulo={`${intervalo} · eventos, não volumes nem paletes distintos`} tom="suave" classe="ind-mod--metade" testId="ind-periodo-praca">
            <Lista periodo>
              <Numero rotulo="Paletes cadastrados" valor={contagem(praca.period.registered)} nota="cadastro no sistema no período" />
              <Numero rotulo="Mudanças de localização" valor={contagem(praca.period.moves)} nota="eventos de movimento e de correção de localização" />
              <Numero rotulo="Paletes vazios retirados (consolidação)" valor={contagem(praca.period.retiredEmpty)} nota="não é saída de estoque" testId="ind-retirados" />
              <Numero rotulo="Paletes que saíram inteiros na expedição" valor={contagem(praca.period.shippedWhole)} nota="expedição confirmada" />
            </Lista>
          </Modulo>
        </>
      )}
      {d.janelas !== null && <Janelas d={d} aoRelatorio={aoRelatorio} aoNavegar={aoNavegar} />}
    </div>
  );
}

function Janelas({ d, aoRelatorio, aoNavegar }: { d: Indicadores; aoRelatorio: PropsDetalhe['aoRelatorio']; aoNavegar: Navegar }) {
  const j = d.janelas;
  if (j === null) return null;
  return (
    <Modulo
      titulo="Janelas e expedição"
      subtitulo="Cada janela nas próprias métricas, sem conversão por fator genérico · restante = limite − reservado ativo − expedido"
      classe="ind-mod--inteiro"
      testId="ind-janelas"
      acao={
        <AcaoModulo
          aoClicar={() => {
            aoRelatorio({ tipo: 'expedicoes' });
          }}
        >
          Expedições do período
        </AcaoModulo>
      }
    >
      <div className="ind-colunas">
        <div>
          {j.windows.length === 0 ? (
            <p className="ind-nota">Nenhuma janela no período.</p>
          ) : (
            <ul className="ind-janelas">
              {j.windows.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    className="botao-link"
                    onClick={() => {
                      aoNavegar({ tipo: 'janela', id: w.id, aba: 'resumo' });
                    }}
                  >
                    {w.code} — {w.name}
                  </button>{' '}
                  <span className="ind-nota">({ROTULOS_SITUACAO_JANELA[w.state]})</span>
                  <ul>
                    {w.restrictions.length === 0 && <li>Sem restrição de capacidade cadastrada.</li>}
                    {w.restrictions.map((r) => (
                      <li key={`${r.metric}-${r.unit}`}>
                        {ROTULOS_METRICA[r.metric]}
                        {r.weightBase ? ` ${ROTULOS_BASE_PESO[r.weightBase]}` : ''} ({r.unit}): limite {r.limit === null ? 'pendente (não é ilimitado)' : fq(r.limit)} · reservado ativo {fq(r.reservedActive)} ·
                        expedido {fq(r.shipped)} · restante {r.remaining === null ? 'sem base' : fq(r.remaining)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {j.truncated && <p className="ind-nota">Mostrando as primeiras janelas do período.</p>}
        </div>
        <Lista periodo>
          <Numero rotulo="Expedições confirmadas" valor={contagem(j.period.expeditions)} nota={`${contagem(j.period.partialExpeditions)} com conclusão parcial`} />
          <Numero rotulo="Enviado (baixa)" valor={<PorUnidade itens={j.period.shipped} vazio="nada" />} nota="por unidade, sem conversão" />
          <Numero rotulo="Paletes que saíram inteiros" valor={contagem(j.period.palletsShippedWhole)} />
          <Numero
            rotulo="Reservas criadas / canceladas ou liberadas"
            valor={`${contagem(j.period.reservationsCreated)} / ${contagem(j.period.reservationsCancelled)}`}
            nota="reserva não altera o físico"
          />
        </Lista>
      </div>
    </Modulo>
  );
}

// ---------- Conferências ----------

export function PainelConferencias({ d, podeRelatorio, aoRelatorio }: PropsDetalhe) {
  const c = d.conferencia;
  if (c === null) return <p className="ind-restritas">Seu perfil não consulta a conferência: esses números não são enviados a este aparelho.</p>;
  return (
    <div className="ind-grade ind-grade--detalhe">
      <Modulo titulo="Paletes por estado" subtitulo="Estado no cadastro · posição atual" classe="ind-mod--metade" testId="ind-conferencia">
        <BarrasConferencia
          conferencia={c}
          prefixo="ind-conf-aba-"
          aoAbrir={
            podeRelatorio
              ? (estado) => {
                  aoRelatorio({ tipo: 'paletes', conferencia: estado });
                }
              : null
          }
        />
        <p className="ind-nota">A conferência de volumes em tabela não muda este estado (o mapa mostra a de volumes).</p>
        <p className="ind-nota">"Reconciliado" não é "liberado"; conferido não libera material. "Não conferido" não significa reconferência vencida (regra própria de 20 dias, no Painel da operação).</p>
      </Modulo>
      <Modulo titulo="Sessões e observações" subtitulo="Contadores independentes: não se somam aos paletes" tom="suave" classe="ind-mod--metade" testId="ind-conferencia-sessoes">
        <Bloco titulo="Agora">
          <Lista>
            <Numero rotulo="Conferências em andamento" valor={contagem(c.activeCounts)} nota="sessões abertas" />
            <Numero rotulo="Observações pendentes" valor={contagem(c.pendingObservations)} nota="produto não identificado ou fator desconhecido" />
          </Lista>
        </Bloco>
        <Bloco titulo={`No período · ${intervaloCurto(d.period)}`}>
          <Lista periodo>
            <Numero rotulo="Iniciadas" valor={contagem(c.period.started)} />
            <Numero rotulo="Concluídas" valor={contagem(c.period.concluded)} />
            <Numero rotulo="Reconciliadas" valor={contagem(c.period.reconciled)} />
            <Numero rotulo="Recontagens" valor={contagem(c.period.recounts)} />
            <Numero rotulo="Canceladas" valor={contagem(c.period.cancelled)} />
          </Lista>
        </Bloco>
        <p className="ind-nota">Cada sessão conta pelo horário de cada etapa (início, conclusão, reconciliação, cancelamento).</p>
      </Modulo>
    </div>
  );
}

// ---------- Estoque e idade ----------

function TabelaFluxo({ fluxo }: { fluxo: readonly FluxoUnidade[] }) {
  if (fluxo.length === 0) return <p className="ind-nota">Nenhum saldo validado nem evento de estoque até o fim do período.</p>;
  return (
    <div className="tabela-rolagem ind-tabela-rolagem" tabIndex={0} role="region" aria-label="Fluxo do saldo validado por unidade">
      <table className="tabela-indicadores ind-tabela" data-testid="fluxo-estoque">
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
                {f.entriesFromReturns !== '0' && <span className="ind-nota"> (retorno: {fq(f.entriesFromReturns)})</span>}
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

export function PainelEstoque({ d, podeRelatorio, aoRelatorio }: PropsDetalhe) {
  const e = d.estoque;
  const idade = d.idade;
  if (e === null) return <p className="ind-restritas">Seu perfil não consulta o estoque: esses números não são enviados a este aparelho.</p>;
  return (
    <div className="ind-grade ind-grade--detalhe">
      <Modulo
        titulo="Estoque validado"
        subtitulo="Saldo validado por unidade (sem conversão entre unidades) · posição atual"
        classe="ind-mod--metade"
        testId="ind-estoque"
        acao={
          podeRelatorio ? (
            <AcaoModulo
              aoClicar={() => {
                aoRelatorio({ tipo: 'estoque' });
              }}
            >
              Por produto, lote e origem
            </AcaoModulo>
          ) : undefined
        }
      >
        {e.current.length === 0 ? (
          <p className="ind-indisponivel">
            <span className="ind-traco" aria-hidden="true" />
            <strong>{e.palletsWithUnknownContent > 0 ? 'Saldo validado indisponível' : 'Nenhum saldo validado neste escopo'}</strong>
          </p>
        ) : (
          <Lista>
            {e.current.map((s) => (
              <Numero
                key={s.unit}
                rotulo={`Saldo validado (${s.unit})`}
                valor={fq(s.validated)}
                nota={`reservado ${fq(s.reserved)} · disponível ${fq(s.available)} · vinculado a claim ${fq(s.linked)} · ${plural(s.skus, 'SKU', 'SKUs')} em ${plural(s.pallets, 'palete', 'paletes')}`}
                testId={`ind-saldo-${s.unit}`}
              />
            ))}
          </Lista>
        )}
        {e.palletsWithUnknownContent > 0 && (
          <p className="ind-aviso" data-testid="ind-desconhecido">
            {plural(e.palletsWithUnknownContent, 'palete', 'paletes')} na praça sem conteúdo totalmente validado (não conferidos, parciais ou aguardando validação): o saldo validado não representa todo o
            material físico. Conteúdo desconhecido não é zero.
          </p>
        )}
        <Bloco titulo="Base documental (separada; não é estoque físico)">
          <Lista>
            <Numero rotulo="Declarado nos paletes" valor={<PorUnidade itens={e.documentary.declaredOnPallets} vazio="nenhum" />} nota="por unidade declarada" />
            <Numero rotulo="Documentos importados" valor={<PorUnidade itens={e.documentary.importedDocuments} vazio="nenhum" />} nota="por unidade canônica" />
          </Lista>
        </Bloco>
      </Modulo>
      {idade !== null && (
        <Modulo titulo="Idade do material" subtitulo="Saldo validado atual pelo mês da primeira entrada física validada (mesma regra do FIFO das janelas)" tom="suave" classe="ind-mod--metade" testId="ind-idade">
          {idade.byMonth.length === 0 && idade.withoutEntryDate.length === 0 ? (
            <p className="ind-indisponivel">
              <span className="ind-traco" aria-hidden="true" />
              <strong>Sem saldo validado para compor a idade</strong>
            </p>
          ) : (
            <ul className="ind-meses">
              {idade.byMonth.map((m) => (
                <li key={`${m.month}-${m.unit}`}>
                  <span>
                    {m.month.slice(5)}/{m.month.slice(0, 4)}
                  </span>
                  <strong>
                    {fq(m.quantity)} {m.unit}
                  </strong>
                  <span className="ind-nota">{plural(m.lines, 'linha', 'linhas')}</span>
                </li>
              ))}
              {idade.withoutEntryDate.map((m) => (
                <li key={`sem-${m.unit}`} className="ind-meses-pendente">
                  <span>Sem data de entrada validada</span>
                  <strong>
                    {fq(m.quantity)} {m.unit}
                  </strong>
                </li>
              ))}
            </ul>
          )}
          <p className="ind-nota">
            Referência apenas documental (data do documento importado, não é entrada física): {plural(idade.documentReference.lines, 'linha', 'linhas')}
            {idade.documentReference.oldest
              ? `, de ${formatarData(`${idade.documentReference.oldest}T12:00:00Z`)} a ${formatarData(`${idade.documentReference.newest ?? idade.documentReference.oldest}T12:00:00Z`)}`
              : ''}
            .
          </p>
          <p className="ind-nota">Sem faixas de idade nem metas: critérios do cliente ainda não informados. A reconferência de 20 dias é outra regra.</p>
        </Modulo>
      )}
      <Modulo titulo={`Fluxo do saldo validado · ${intervaloCurto(d.period)}`} subtitulo="Pelos eventos de estoque registrados no período" classe="ind-mod--inteiro" testId="ind-fluxo">
        <TabelaFluxo fluxo={e.flow} />
        <p className="ind-nota">
          Retornos físicos registrados: {contagem(e.returns.physical)} (<PorUnidade itens={e.returns.physicalQuantity} vazio="sem quantidade" />
          ), que entram no saldo só depois de conferidos e reconciliados. Avisos documentais de retorno: {contagem(e.returns.notices)} (não alteram o saldo).
        </p>
      </Modulo>
    </div>
  );
}

// ---------- Claims e valores ----------

export function PainelClaims({ d, aoRelatorio }: { d: Indicadores; aoRelatorio: PropsDetalhe['aoRelatorio'] }) {
  const c = d.claims;
  const v = d.valores;
  return (
    <div className="ind-grade ind-grade--detalhe">
      {c !== null && (
        <Modulo
          titulo="Claims"
          subtitulo="Posição atual dos casos · candidato é pista; recuperação validada vem de vínculo válido com o material"
          classe="ind-mod--metade"
          testId="ind-claims"
          acao={
            <AcaoModulo
              aoClicar={() => {
                aoRelatorio({ tipo: 'claims' });
              }}
            >
              Casos e valores
            </AcaoModulo>
          }
        >
          <Lista>
            <Numero rotulo="Casos" valor={contagem(c.cases)} nota={`${contagem(c.open)} não finalizado(s)`} />
            <Numero rotulo="Casos com candidato em investigação" valor={contagem(c.casesWithCandidates)} nota={`${plural(c.candidatesInvestigating, 'candidato', 'candidatos')}; pista, não recuperação`} />
            <Numero
              rotulo="Recuperação física validada"
              valor={c.recoveredValidated.length === 0 ? 'nenhuma' : c.recoveredValidated.map((r) => `${fq(r.quantity)} ${r.unit}`).join(' · ')}
              nota={c.recoveredValidated.length === 0 ? undefined : `${contagem(c.recoveredValidated.reduce((t, r) => t + r.cases, 0))} caso(s) por unidade`}
            />
          </Lista>
          <p className="ind-nota">Por situação: {c.byState.map((s) => `${ROTULOS_SITUACAO_CLAIM[s.state]} ${String(s.count)}`).join(' · ') || 'nenhum caso'}.</p>
          <p className="ind-nota">Por motivo: {c.byReason.map((m) => `${ROTULOS_MOTIVO_CLAIM[m.reason]} ${String(m.count)}`).join(' · ') || 'nenhum caso'}.</p>
          <p className="ind-nota">
            Pendências:{' '}
            {c.pendencies
              .filter((p) => p.count > 0)
              .map((p) => `${ROTULOS_FILTRO_PENDENCIA[p.code as FiltroPendencia]} ${String(p.count)}`)
              .join(' · ') || 'nenhuma'}
            .
          </p>
          <Bloco titulo={`No período · ${intervaloCurto(d.period)}`}>
            <Lista periodo>
              <Numero rotulo="Casos registrados" valor={contagem(c.period.opened)} />
              <Numero rotulo="Recuperações validadas" valor={<PorUnidade itens={c.period.recoveries} vazio="nenhuma" />} />
              <Numero rotulo="Estornos de recuperação" valor={contagem(c.period.reversals)} />
              <Numero rotulo="Casos encerrados" valor={contagem(c.period.closed)} />
            </Lista>
          </Bloco>
        </Modulo>
      )}
      {v !== null && (
        <Modulo
          titulo="Valores"
          subtitulo="Por moeda, sem conversão · estimativa não é valor evitado"
          tom="suave"
          classe="ind-mod--metade"
          testId="ind-valores"
        >
          <Lista>
            <Numero
              rotulo="Estimativa em análise"
              valor={<PorMoeda itens={v.estimatedInAnalysis} vazio="nenhuma" />}
              nota={
                v.estimatedInAnalysis.some((e) => e.partialCases > 0)
                  ? `${String(v.estimatedInAnalysis.reduce((t, e) => t + e.partialCases, 0))} caso(s) com estimativa parcial; não é valor evitado`
                  : 'não é valor evitado'
              }
              testId="ind-estimado"
            />
            <Numero rotulo="Valor evitado confirmado" valor={<PorMoeda itens={v.avoidedConfirmed} vazio="nenhum" />} testId="ind-evitado" />
            <Numero rotulo="Perda confirmada" valor={<PorMoeda itens={v.lossConfirmed} vazio="nenhuma" />} />
            <Numero rotulo="Resultados corrigidos / anulados" valor={`${String(v.corrections.corrected)} / ${String(v.corrections.annulled)}`} nota="fora dos totais; histórico preservado no caso" />
          </Lista>
          <Bloco titulo={`Registrado no período · ${intervaloCurto(d.period)}`}>
            <Lista periodo>
              <Numero rotulo="Valor evitado confirmado" valor={<PorMoeda itens={v.period.avoidedConfirmed} vazio="nenhum" />} />
              <Numero rotulo="Perda confirmada" valor={<PorMoeda itens={v.period.lossConfirmed} vazio="nenhuma" />} />
            </Lista>
          </Bloco>
          <p className="ind-nota">Confirmados vêm de resultados vigentes registrados por quem tem aprovação financeira. Moedas diferentes nunca se somam.</p>
        </Modulo>
      )}
    </div>
  );
}

// ---------- Sobre os números ----------

/**
 * Metodologia: base de posições (revisão e mudanças), período e fuso,
 * leitura única, regras de leitura, indicadores sem base de medição e
 * perfis. Aparece em "Sobre os números" e, sempre, na impressão.
 */
export function Metodologia({ d, impressao = false }: { d: Indicadores; impressao?: boolean }) {
  const b = d.positionsBasis;
  const id = (nome: string) => (impressao ? undefined : nome);
  return (
    <div className="ind-metodologia">
      <section>
        <h3>Base de posições</h3>
        <p className={b.provisional ? 'ind-aviso' : undefined} data-testid={id('ind-sobre-base')}>
          <strong>{b.label}</strong>
          {b.layout && (
            <>
              {' '}
              · {b.layout.name}, revisão {b.layout.revision}
              {b.layout.schematic ? ', desenho esquemático' : ''}
              {b.layout.provisionalCodes > 0 ? `, ${plural(b.layout.provisionalCodes, 'código de posição provisório', 'códigos de posição provisórios')}` : ''}
              {b.layout.totalCapacity === null ? '; capacidade física total ainda desconhecida' : `; capacidade confirmada ${contagem(b.layout.totalCapacity)}`}.
            </>
          )}
        </p>
        <p>
          {b.changesInPeriod > 0
            ? `A configuração mudou ${plural(b.changesInPeriod, 'vez', 'vezes')} no período: ativar ou desativar posições muda o denominador e não comprova redução de estoque.`
            : 'Sem alteração na configuração das posições no período.'}{' '}
          Ocupação = ocupadas ÷ elegíveis; as indisponíveis ficam fora da base. Enquanto a base for provisória, a ocupação também é provisória (não é capacidade física validada).
        </p>
      </section>
      <section>
        <h3>Período e leitura</h3>
        <p data-testid={id('ind-sobre-periodo')}>Período: {textoPeriodo(d.period)}.</p>
        <p>
          Consultado em {formatarDataHora(d.consultedAt)} (horário de Brasília), numa única leitura do banco: todos os números desta tela vêm da mesma fotografia. Abrir um relatório faz outra consulta, com o próprio
          horário.
        </p>
      </section>
      <section>
        <h3>Como ler os números</h3>
        <ul>
          <li>"Posição atual" é o estado agora e não muda com o período; "No período" conta acontecimentos entre as datas.</li>
          <li>Paletes, posições, sessões, eventos, documentos e volumes são unidades diferentes: nunca são somados entre si. Quantidades ficam por unidade (UN, CX…) e valores por moeda.</li>
          <li>Mudanças de localização são eventos (movimento e correção), não volumes movimentados nem paletes distintos. Retirar um palete vazio (consolidação) não é saída de estoque.</li>
          <li>
            "Não conferido" é o estado de conferência no cadastro do palete (conferência por produto e reconciliação). A conferência de volumes em tabela não altera esse estado. Não significa reconferência
            vencida: essa tem regra própria de 20 dias, no Painel da operação.
          </li>
          <li>Conteúdo não validado continua desconhecido: "sem saldo validado" não quer dizer que não há caixas no piso. Zero só aparece quando há base para afirmar zero.</li>
          <li>Idade = mês da primeira entrada física validada do material. Data de importação ou de documento não é entrada física.</li>
          <li>Base documental (declarado e documentos importados) é separada do saldo validado e não vira conferência física.</li>
          <li>Sem séries diárias nesta consulta: os gráficos mostram totais do período, sem curvas, metas ou tendências.</li>
        </ul>
      </section>
      <section data-testid={id('ind-indisponiveis')}>
        <h3>Sem base de medição (pendências)</h3>
        <ul>
          {d.unavailable.map((u) => (
            <li key={u.title}>
              <strong>{u.title}:</strong> {u.reason}
            </li>
          ))}
        </ul>
      </section>
      {d.restricted.length > 0 && (
        <section>
          <h3>Perfil</h3>
          <p>Áreas fora do seu perfil não são enviadas pelo servidor a este aparelho (não estão só escondidas).</p>
        </section>
      )}
      {!impressao && (
        <section>
          <h3>Ajuda</h3>
          <AjudaTarefa tarefa="consultar" />
        </section>
      )}
    </div>
  );
}
