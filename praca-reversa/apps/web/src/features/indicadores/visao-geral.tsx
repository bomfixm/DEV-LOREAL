import type { Indicadores } from '@praca-reversa/contracts';
import { IconeCaixa, IconePosicao, IconePrancheta, IconeSetas } from '../../components/Icones';
import type { AbaIndicadores } from '../../rotas';
import { barrasConferencia, contagem, intervaloCurto, plural, pontosDeAtencao, textoPercentual, usoPosicoes } from './dashboard-dados';
import { fq } from './formato';
import { AcaoModulo, AnelOcupacao, BarrasConferencia, Kpi, Modulo, Selo } from './pecas';

interface Props {
  d: Indicadores;
  podeRelatorio: boolean;
  aoRelatorio: (parametros: Record<string, string>) => void;
  aoAbrirAba: (aba: AbaIndicadores) => void;
}

/**
 * Visão geral: quatro indicadores (posição atual separada do período),
 * módulos de posições, conferência e movimentação, e uma faixa de estoque e
 * atenção. Os detalhes completos ficam nas abas.
 */
export function VisaoGeral({ d, podeRelatorio, aoRelatorio, aoAbrirAba }: Props) {
  const intervalo = intervaloCurto(d.period);
  const provisoria = d.positionsBasis.provisional;
  return (
    <div className="ind-grade">
      <IndicadoresPrincipais d={d} intervalo={intervalo} podeRelatorio={podeRelatorio} aoRelatorio={aoRelatorio} />
      {d.praca !== null && <UsoDasPosicoes d={d} provisoria={provisoria} />}
      {d.conferencia !== null && (
        <Modulo
          titulo="Conferência dos paletes"
          subtitulo={`Estado no cadastro · posição atual · ${plural(barrasConferencia(d.conferencia).total, 'palete', 'paletes')} na praça`}
          classe="ind-mod--conferencia"
          testId="ind-mod-conferencia"
          acao={
            <AcaoModulo
              aoClicar={() => {
                aoAbrirAba('conferencias');
              }}
            >
              Sessões
            </AcaoModulo>
          }
        >
          <BarrasConferencia
            conferencia={d.conferencia}
            prefixo="ind-conf-"
            aoAbrir={
              podeRelatorio
                ? (estado) => {
                    aoRelatorio({ tipo: 'paletes', conferencia: estado });
                  }
                : null
            }
          />
          <p className="ind-nota">A conferência de volumes em tabela não muda este estado (o mapa mostra a de volumes).</p>
          <p className="ind-nota ind-nota--separada">
            À parte (outras unidades, não somadas aos paletes): {plural(d.conferencia.activeCounts, 'conferência em andamento', 'conferências em andamento')} ·{' '}
            {plural(d.conferencia.pendingObservations, 'observação pendente', 'observações pendentes')}.
          </p>
        </Modulo>
      )}
      {d.praca !== null && (
        <Modulo
          titulo="Movimentação no período"
          subtitulo={intervalo}
          tom="suave"
          classe="ind-mod--movimentacao"
          testId="ind-mod-movimentacao"
          acao={
            <AcaoModulo
              aoClicar={() => {
                aoAbrirAba('movimentacoes');
              }}
            >
              Detalhes
            </AcaoModulo>
          }
        >
          <p className="ind-destaque">
            <strong data-testid="ind-mov-mudancas">{contagem(d.praca.period.moves)}</strong>
            <span>{d.praca.period.moves === 1 ? 'mudança de localização' : 'mudanças de localização'}</span>
          </p>
          <dl className="ind-mini">
            <div>
              <dt>Paletes cadastrados</dt>
              <dd>{contagem(d.praca.period.registered)}</dd>
            </div>
            <div>
              <dt>Saíram inteiros na expedição</dt>
              <dd>{contagem(d.praca.period.shippedWhole)}</dd>
            </div>
            <div>
              <dt>Vazios retirados (consolidação)</dt>
              <dd>{contagem(d.praca.period.retiredEmpty)}</dd>
            </div>
          </dl>
          <p className="ind-nota">Eventos registrados no período, não volumes nem paletes distintos. Retirar palete vazio não é saída de estoque.</p>
        </Modulo>
      )}
      {d.estoque !== null && <EstoqueEIdade d={d} aoAbrirAba={aoAbrirAba} />}
      <PontosDeAtencao d={d} podeRelatorio={podeRelatorio} aoRelatorio={aoRelatorio} />
      {d.restricted.length > 0 && <AreasRestritas d={d} />}
    </div>
  );
}

function IndicadoresPrincipais({ d, intervalo, podeRelatorio, aoRelatorio }: { d: Indicadores; intervalo: string; podeRelatorio: boolean; aoRelatorio: Props['aoRelatorio'] }) {
  const praca = d.praca;
  const conf = d.conferencia;
  if (praca === null) return null;
  const uso = usoPosicoes(praca);
  const naoConferidos = conf?.byState.NAO_CONFERIDO ?? null;
  return (
    <div className="ind-kpis" role="group" aria-label="Indicadores principais">
      <Kpi
        rotulo="Paletes na praça"
        quando="Posição atual"
        valor={contagem(praca.palletsInStock)}
        unidade={praca.palletsInStock === 1 ? 'palete' : 'paletes'}
        contexto={`${contagem(praca.palletsWithPosition)} com posição · ${contagem(praca.palletsLocationPending)} com localização pendente`}
        icone={<IconeCaixa />}
        tom="amarelo"
        aoAbrir={
          podeRelatorio
            ? () => {
                aoRelatorio({ tipo: 'paletes' });
              }
            : undefined
        }
        acao="ver a lista de paletes na praça"
        testId="ind-kpi-paletes"
      />
      <Kpi
        rotulo="Posições livres"
        quando="Posição atual"
        valor={uso === null ? 'Sem base' : contagem(uso.livres)}
        unidade={uso?.livres === 1 ? 'posição' : 'posições'}
        selo={provisoriaSelo(d)}
        contexto={uso === null ? praca.occupancyNote : `sem palete registrado · de ${contagem(uso.base)} elegíveis`}
        icone={<IconePosicao />}
        tom="claro"
        testId="ind-kpi-livres"
      />
      {naoConferidos !== null && conf !== null && (
        <Kpi
          rotulo="Paletes não conferidos"
          quando="Posição atual"
          valor={contagem(naoConferidos)}
          unidade={naoConferidos === 1 ? 'palete' : 'paletes'}
          contexto={`de ${contagem(barrasConferencia(conf).total)} na praça · estado no cadastro`}
          icone={<IconePrancheta />}
          tom="claro"
          aoAbrir={
            podeRelatorio
              ? () => {
                  aoRelatorio({ tipo: 'paletes', conferencia: 'NAO_CONFERIDO' });
                }
              : undefined
          }
          acao="ver os paletes não conferidos"
          testId="ind-kpi-nao-conferidos"
        />
      )}
      <Kpi
        rotulo="Mudanças de localização"
        quando={`No período · ${intervalo}`}
        valor={contagem(praca.period.moves)}
        unidade={praca.period.moves === 1 ? 'evento' : 'eventos'}
        contexto="eventos registrados, não volumes"
        icone={<IconeSetas />}
        tom="grafite"
        testId="ind-kpi-mudancas"
      />
    </div>
  );
}

function provisoriaSelo(d: Indicadores) {
  return d.positionsBasis.provisional ? <Selo>Base provisória</Selo> : undefined;
}

function UsoDasPosicoes({ d, provisoria }: { d: Indicadores; provisoria: boolean }) {
  const praca = d.praca;
  if (praca === null) return null;
  const uso = usoPosicoes(praca);
  const percentual = textoPercentual(praca.occupancyPercent);
  const layout = d.positionsBasis.layout;
  return (
    <Modulo
      titulo="Uso das posições cadastradas"
      subtitulo="Ocupadas e livres da mesma base · posição atual"
      selo={provisoria ? <Selo testId="ind-selo-provisoria">Base provisória</Selo> : undefined}
      tom="grafite"
      classe="ind-mod--posicoes"
      testId="ind-mod-posicoes"
    >
      {uso === null || percentual === null ? (
        <div className="ind-sem-base" data-testid="ind-ocupacao">
          <p>
            <strong>{praca.occupancyNote}</strong>
          </p>
          <p className="ind-nota">Sem porcentagem: não há posições elegíveis para dividir.</p>
        </div>
      ) : (
        <div className="ind-uso">
          <AnelOcupacao uso={uso} percentual={percentual} provisoria={provisoria} testId="ind-ocupacao" />
          <dl className="ind-legenda">
            <div>
              <dt>
                <span className="ind-marca ind-marca--ocupadas" aria-hidden="true" />
                Ocupadas
              </dt>
              <dd>{contagem(uso.ocupadas)}</dd>
            </div>
            <div>
              <dt>
                <span className="ind-marca ind-marca--livres" aria-hidden="true" />
                Livres (sem palete registrado)
              </dt>
              <dd>{contagem(uso.livres)}</dd>
            </div>
            <div className="ind-legenda-base">
              <dt>Base: posições elegíveis</dt>
              <dd>{contagem(uso.base)}</dd>
            </div>
          </dl>
        </div>
      )}
      <p className="ind-nota ind-nota--base" data-testid="base-posicoes">
        <strong>{d.positionsBasis.label}</strong>
        {provisoria && percentual !== null ? '. Ocupação provisória: não é a capacidade física definitiva.' : ''}
      </p>
      <p className="ind-nota">
        {uso !== null && (
          <>
            Fora da base: {plural(uso.indisponiveis, 'posição indisponível', 'posições indisponíveis')}
            {uso.indisponiveisComPalete > 0 ? ` (${contagem(uso.indisponiveisComPalete)} com palete registrado, à parte)` : ''}.{' '}
          </>
        )}
        {layout === null ? 'Sem layout ativo.' : layout.totalCapacity === null ? 'Capacidade física ainda desconhecida.' : `Capacidade física confirmada: ${contagem(layout.totalCapacity)}.`}
      </p>
      {d.positionsBasis.changesInPeriod > 0 && (
        <p className="ind-nota ind-nota--aviso">
          A configuração mudou {plural(d.positionsBasis.changesInPeriod, 'vez', 'vezes')} no período: o denominador mudou.
        </p>
      )}
    </Modulo>
  );
}

function EstoqueEIdade({ d, aoAbrirAba }: { d: Indicadores; aoAbrirAba: Props['aoAbrirAba'] }) {
  const e = d.estoque;
  if (e === null) return null;
  const idade = d.idade;
  const documental = e.documentary.declaredOnPallets.length > 0 || e.documentary.importedDocuments.length > 0;
  const maisAntigo = idade?.byMonth[0] ?? null;
  return (
    <Modulo
      titulo="Estoque e idade"
      subtitulo="Saldo validado por unidade · posição atual"
      classe="ind-mod--estoque"
      testId="ind-mod-estoque"
      acao={
        <AcaoModulo
          aoClicar={() => {
            aoAbrirAba('estoque');
          }}
        >
          Ver detalhes
        </AcaoModulo>
      }
    >
      {e.current.length === 0 ? (
        <p className="ind-indisponivel" data-testid="ind-saldo-resumo">
          <span className="ind-traco" aria-hidden="true" />
          <strong>{e.palletsWithUnknownContent > 0 ? 'Saldo validado indisponível' : 'Nenhum saldo validado'}</strong>
        </p>
      ) : (
        <ul className="ind-saldos" data-testid="ind-saldo-resumo" aria-label="Saldo validado por unidade (sem conversão)">
          {e.current.map((s) => (
            <li key={s.unit}>
              <strong>{fq(s.validated)}</strong> <span>{s.unit}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="ind-nota">
        {e.palletsWithUnknownContent > 0
          ? `${plural(e.palletsWithUnknownContent, 'palete', 'paletes')} sem conteúdo totalmente validado: o saldo validado não representa todo o material (desconhecido não é zero).`
          : d.praca?.palletsInStock === 0
            ? 'Nenhum palete na praça.'
            : 'Todos os paletes na praça estão reconciliados (conteúdo validado).'}
      </p>
      {idade !== null && (
        <p className="ind-nota">
          Idade:{' '}
          {maisAntigo !== null
            ? `saldo desde ${maisAntigo.month.slice(5)}/${maisAntigo.month.slice(0, 4)} (mês da primeira entrada física validada).`
            : idade.withoutEntryDate.length > 0
              ? 'saldo sem data de entrada validada.'
              : 'sem saldo validado para compor o indicador.'}
        </p>
      )}
      {documental && <p className="ind-nota">Documentos e declarações ficam à parte: registro documental não é saldo validado.</p>}
    </Modulo>
  );
}

function PontosDeAtencao({ d, podeRelatorio, aoRelatorio }: { d: Indicadores; podeRelatorio: boolean; aoRelatorio: Props['aoRelatorio'] }) {
  const pontos = pontosDeAtencao(d);
  return (
    <Modulo titulo="Pontos de atenção" subtitulo="Tirados dos números desta consulta" classe="ind-mod--atencao" testId="ind-mod-atencao">
      {pontos.length === 0 ? (
        <p className="ind-nota">Nenhum ponto de atenção nos números desta consulta.</p>
      ) : (
        <ul className="ind-atencao">
          {pontos.map((p) => (
            <li key={p.chave} className={`ind-atencao-item ind-atencao-item--${p.tom}`} data-ponto={p.chave}>
              <span className="ind-atencao-marca" aria-hidden="true">
                {p.tom === 'alerta' ? '▲' : '◆'}
              </span>
              <span>
                <span className="visualmente-oculto">{p.tom === 'alerta' ? 'Ação necessária: ' : 'Atenção: '}</span>
                {p.texto}
              </span>
              {p.relatorio !== undefined && podeRelatorio && (
                <button
                  type="button"
                  className="botao-link nao-imprimir"
                  onClick={() => {
                    if (p.relatorio) aoRelatorio(p.relatorio);
                  }}
                >
                  Ver lista
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modulo>
  );
}

function AreasRestritas({ d }: { d: Indicadores }) {
  const r = (a: Indicadores['restricted'][number]) => d.restricted.includes(a);
  const areas = [r('claims') || r('valores') ? 'claims e valores' : null, r('janelas') ? 'janelas' : null, r('praca') ? 'praça, conferência e estoque' : null].filter(Boolean);
  return (
    <p className="ind-restritas" data-testid="ind-restritas">
      Seu perfil não consulta: {areas.join(', ')}. Esses números não são enviados a este aparelho.
    </p>
  );
}
