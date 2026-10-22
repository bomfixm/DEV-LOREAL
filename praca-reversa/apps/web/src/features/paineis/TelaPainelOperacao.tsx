import { API_PREFIXO, PainelOperacaoSchema, ROTULOS_SITUACAO_CLAIM, type JanelaPainel, type PainelOperacao, type Permissao, type TarefaPainel } from '@praca-reversa/contracts';
import { useState } from 'react';
import { EstadoTela } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { JanelaModal } from '../paletes/JanelaPalete';
import { ComparacaoJanelas } from './comum';
import { useConsultaViva } from './consulta-viva';
import { consultaDe, filtrosDe, textoVolumesRua, volumes, type ValoresFiltro } from './formato';
import { AcaoBloco, BarraFiltros, BarraSegmentada, BlocoResumo, CartaoResumo, ListaPrioridades, PaginaPainel, ResumoJanela, VolumesPorRua } from './resumo';
import { intercalarTarefas, totalTarefas, useLinhasResumo } from './resumo-dados';

type Detalhe = 'numeros' | 'janelas' | 'ruas' | 'prioridades';

/** "2026-10-01" → "01/10/2026" (data do período, sem fuso). */
const dataCurta = (d: string) => d.split('-').reverse().join('/');

/**
 * Painel da operação (DHL) em uma tela (etapa 4): filtros, quatro cartões,
 * janela selecionada, situação da praça, volumes por rua e prioridades.
 * Números do servidor numa única leitura; cada cartão abre a lista com os
 * mesmos filtros; definições e números secundários abrem em "Detalhes".
 */
export function TelaPainelOperacao({ parametros, permissoes, aoNavegar }: { parametros: string; permissoes: readonly Permissao[]; aoNavegar: Navegar }) {
  const [versao, setVersao] = useState(0);
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  // Prioridades à vista no resumo; as demais em "Ver todas".
  const linhasPrioridades = useLinhasResumo(4, 8);
  const filtros = filtrosDe(parametros);
  const periodo = consultaDe({ inicio: filtros.inicio, fim: filtros.fim });
  const { dados, carga, recarregar } = useConsultaViva(`${API_PREFIXO}/painel/operacao${periodo ? `?${periodo}` : ''}`, PainelOperacaoSchema, versao);
  const lista = (v: ValoresFiltro) => {
    aoNavegar({ tipo: 'painel-estoque', parametros: consultaDe(v) });
  };
  const mudar = (v: ValoresFiltro) => {
    aoNavegar({ tipo: 'painel', parametros: consultaDe({ ...filtros, ...v }) });
  };
  if (dados === null) {
    return (
      <PaginaPainel titulo="Painel da operação" testId="tela-painel-operacao">
        <EstadoTela carga={carga ?? { estado: 'carregando' }} titulo="Não foi possível carregar o painel" aoTentarNovamente={recarregar} />
      </PaginaPainel>
    );
  }
  const d: PainelOperacao = dados;
  const v = d.stock.volumes;
  const semVolume = v.currentCoverage.total - v.currentCoverage.known;
  // Próxima janela primeiro; depois as do período.
  const janelas: JanelaPainel[] = [...(d.nextWindow ? [d.nextWindow] : []), ...d.windows.filter((j) => j.id !== d.nextWindow?.id)];
  const janela = janelas.find((j) => j.id === filtros.janela) ?? janelas[0] ?? null;
  const prioridades = intercalarTarefas(d.tasks.items, linhasPrioridades);
  const totalPrioridades = totalTarefas(d.tasks.totals);
  const fechar = () => {
    setDetalhe(null);
  };
  const abrirTarefa = (t: TarefaPainel) => {
    if (t.palletId !== null) aoNavegar({ tipo: 'palete', id: t.palletId });
    else if (t.windowId !== null) aoNavegar({ tipo: 'painel-janela', id: t.windowId });
    else aoNavegar({ tipo: 'inventarios' });
  };
  const abrirRua = (rua: string) => {
    lista(rua === 'Sem endereço confirmado' ? { situacao: 'sem-endereco' } : { rua });
  };

  return (
    <PaginaPainel titulo="Painel da operação" testId="tela-painel-operacao">
      <BarraFiltros
        janelas={janelas}
        janela={janela?.id ?? null}
        aoEscolherJanela={(id) => {
          mudar({ janela: id });
        }}
        periodo={{ inicio: d.period.start, fim: d.period.end }}
        aoAplicarPeriodo={(inicio, fim) => {
          mudar({ inicio, fim });
        }}
        consultadoEm={d.consultedAt}
        carga={carga}
        aoAtualizar={() => {
          setVersao((x) => x + 1);
        }}
        acoes={
          <>
            <button
              type="button"
              className="painel-acao"
              onClick={() => {
                setDetalhe('numeros');
              }}
              data-testid="abrir-detalhes"
            >
              Detalhes
            </button>
            <button
              type="button"
              className="painel-acao painel-acao--ajuda"
              onClick={() => {
                aoNavegar({ tipo: 'ajuda', guia: 'painel' });
              }}
              aria-label="Como ler o painel"
              title="Como ler o painel"
              data-testid="ajuda-painel"
            >
              <span aria-hidden="true">?</span>
            </button>
          </>
        }
      />

      <div className="painel-cartoes">
        <CartaoResumo
          destaque
          rotulo="Paletes na praça"
          valor={volumes(d.stock.activePallets)}
          unidade="paletes"
          contexto={`${volumes(d.stock.fullPallets)} full · ${volumes(d.stock.mixedPallets)} misto(s)`}
          dica="Cada palete conta uma vez, mesmo com várias notas."
          aoAbrir={() => {
            lista({});
          }}
          testId="card-paletes"
        />
        <CartaoResumo
          rotulo="Volumes registrados"
          valor={v.currentCoverage.known === 0 ? 'Não informado' : volumes(v.current)}
          unidade="volumes"
          contexto={`${volumes(d.stock.documents)} ${d.stock.documents === 1 ? 'nota/minuta' : 'notas/minutas'}${semVolume > 0 ? ` · ${volumes(semVolume)} sem volume` : ''}`}
          tom={semVolume > 0 ? 'atencao' : 'neutro'}
          dica="Contado quando houver; senão o informado no inventário. Leitura da bipagem conta uma vez, como contagem."
          aoAbrir={() => {
            lista({});
          }}
          testId="card-volumes"
        />
        <CartaoResumo
          rotulo="Sem endereço"
          valor={volumes(d.location.palletsWithoutAddress)}
          unidade="paletes"
          contexto={`${volumes(d.location.documentsWithoutPallet)} NF(s) sem palete`}
          tom={d.location.palletsWithoutAddress > 0 ? 'alerta' : 'neutro'}
          dica="Paletes sem endereço confirmado no mapa. NFs sem palete: linhas do inventário sem RUA/palete (lista em Inventário)."
          aoAbrir={() => {
            lista({ situacao: 'sem-endereco' });
          }}
          testId="card-sem-endereco"
        />
        <CartaoResumo
          rotulo="Precisa conferir"
          valor={volumes(d.reconference.due)}
          unidade="paletes"
          contexto={`regra de 20 dias · ${volumes(d.reconference.dueNext7Days)} vencem em 7 dias`}
          tom={d.reconference.due > 0 ? 'alerta' : 'neutro'}
          dica="20 dias sem movimentação (relógio do palete; abrir o painel ou renomear posição não reinicia)."
          aoAbrir={() => {
            lista({ situacao: 'reconferencia' });
          }}
          testId="card-reconferencia"
        />
      </div>

      <div className="painel-linha painel-linha--meio">
        <BlocoResumo
          titulo="Janela selecionada"
          testId="painel-janela"
          classe="painel-bloco--janela"
          acao={
            <div className="painel-bloco-acoes">
              {d.windows.length > 1 && (
                <button
                  type="button"
                  className="painel-acao"
                  onClick={() => {
                    setDetalhe('janelas');
                  }}
                  data-testid="comparar-janelas"
                >
                  Comparar ({d.windows.length})
                </button>
              )}
              {janela !== null && (
                <AcaoBloco
                  aoClicar={() => {
                    aoNavegar({ tipo: 'painel-janela', id: janela.id });
                  }}
                  testId="abrir-janela"
                >
                  Abrir janela
                </AcaoBloco>
              )}
            </div>
          }
        >
          <ResumoJanela janela={janela} interno vazio="Nenhuma janela no período. Janelas e metas vêm do cadastro (nada é criado para preencher o painel)." />
        </BlocoResumo>

        <BlocoResumo
          titulo="Situação da praça"
          testId="painel-situacao"
          acao={
            <AcaoBloco
              aoClicar={() => {
                aoNavegar({ tipo: 'praca' });
              }}
            >
              Ver mapa
            </AcaoBloco>
          }
        >
          {d.positions === null ? (
            <p className="painel-vazio">Sem layout de posições cadastrado: situação das posições não disponível.</p>
          ) : (
            <BarraSegmentada
              rotulo="Posições ativas"
              partes={[
                { chave: 'ocupadas', rotulo: 'Ocupadas', valor: d.positions.occupied },
                { chave: 'livres', rotulo: 'Livres confirmadas', valor: d.positions.freeConfirmed, dica: 'Desocupação confirmada.' },
                { chave: 'desconhecidas', rotulo: 'Ocupação desconhecida', valor: d.positions.unknown, dica: 'Sem registro: não conta como livre.' },
              ]}
              total={`${volumes(d.positions.occupied + d.positions.freeConfirmed + d.positions.unknown)} posições ativas · sem registro não é livre${d.positions.provisional ? ' · base provisória' : ''}`}
            />
          )}
        </BlocoResumo>
      </div>

      <div className="painel-linha painel-linha--baixo">
        <BlocoResumo
          titulo="Volumes por rua"
          testId="painel-ruas"
          classe="painel-bloco--ruas"
          acao={
            d.byStreet.length > 0 ? (
              <AcaoBloco
                aoClicar={() => {
                  setDetalhe('ruas');
                }}
                testId="abrir-tabela-ruas"
              >
                Tabela
              </AcaoBloco>
            ) : undefined
          }
        >
          <VolumesPorRua ruas={d.byStreet} aoAbrir={abrirRua} />
        </BlocoResumo>

        <BlocoResumo
          titulo="Prioridades"
          testId="painel-prioridades"
          acao={
            totalPrioridades > 0 ? (
              <AcaoBloco
                aoClicar={() => {
                  setDetalhe('prioridades');
                }}
                testId="ver-prioridades"
              >
                Ver todas ({volumes(totalPrioridades)})
              </AcaoBloco>
            ) : undefined
          }
        >
          {prioridades.length === 0 ? <p className="painel-vazio">Nenhuma prioridade pendente.</p> : <ListaPrioridades itens={prioridades} aoAbrir={abrirTarefa} />}
        </BlocoResumo>
      </div>

      {detalhe === 'numeros' && (
        <JanelaModal titulo="Números e definições" subtitulo={d.scope.name} aoFechar={fechar} testId="painel-detalhes">
          <dl className="painel-definicoes">
            <div>
              <dt>Volumes registrados</dt>
              <dd>
                {v.currentCoverage.known === 0 ? 'Não informado' : volumes(v.current)}: contado quando houver; senão o informado no inventário{v.shipped > 0 ? `, menos ${volumes(v.shipped)} já expedido(s)` : ''}. Base
                conhecida em {volumes(v.currentCoverage.known)} de {volumes(v.currentCoverage.total)} conteúdo(s).
              </dd>
            </div>
            <div data-testid="card-informados-conferidos">
              <dt>Informado × conferido</dt>
              <dd>
                Informados no inventário: {volumes(v.informed)} (em {volumes(v.informedCoverage.known)} de {volumes(v.informedCoverage.total)}) · conferidos na contagem: {volumes(v.counted)} (em{' '}
                {volumes(v.countedCoverage.known)} de {volumes(v.countedCoverage.total)}). Bases distintas, não somadas; a leitura importada da bipagem é uma contagem (não soma de novo).
              </dd>
            </div>
            <div>
              <dt>Sem volume</dt>
              <dd>
                {volumes(semVolume)} conteúdo(s) sem volume informado nem contado (aparece como “Não informado”, nunca zero).{' '}
                {semVolume > 0 && (
                  <button
                    type="button"
                    className="botao-link"
                    onClick={() => {
                      lista({ situacao: 'sem-volume' });
                    }}
                    data-testid="card-sem-volume"
                  >
                    Ver lista
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt>Notas/minutas</dt>
              <dd>
                {volumes(d.stock.documents)} distintas pela identidade fiscal (tipo, número e Delivery/remetente) · {volumes(d.stock.contents)} registro(s) NF × palete. A mesma nota em outro palete não vira outra
                nota.
              </dd>
            </div>
            <div data-testid="card-incompletos">
              <dt>Identificação incompleta</dt>
              <dd>
                {volumes(d.stock.incomplete.withoutDocument)} sem NF · {volumes(d.stock.incomplete.withoutType)} sem tipo do documento.
              </dd>
            </div>
            <div>
              <dt>Sem endereço</dt>
              <dd>
                {volumes(d.location.palletsWithoutAddress)} palete(s) sem endereço confirmado · {volumes(d.location.documentsWithoutPallet)} NF(s) do inventário sem RUA/palete.{' '}
                {d.location.documentsWithoutPallet > 0 && (
                  <button
                    type="button"
                    className="botao-link"
                    onClick={() => {
                      aoNavegar({ tipo: 'inventarios' });
                    }}
                    data-testid="card-nf-sem-palete"
                  >
                    Ver no inventário
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt>Precisa conferir</dt>
              <dd>
                {volumes(d.reconference.due)} vencido(s) · {volumes(d.reconference.dueNext7Days)} vencem nos próximos 7 dias
                {d.reconference.nextDueAt ? ` · próximo vencimento ${formatarDataHora(d.reconference.nextDueAt)}` : ''}. Regra de 20 dias sem movimentação, pelo relógio do palete (cadastro, importação,
                abrir o painel ou renomear posição não reiniciam o prazo).
              </dd>
            </div>
            {d.positions !== null && (
              <div>
                <dt>Posições</dt>
                <dd>
                  {volumes(d.positions.active)} ativas · {volumes(d.positions.excluded)} desativada(s)/indisponível(is) fora da conta{d.positions.provisional ? ' · base provisória' : ''}. Sem palete
                  registrado não é posição livre: livre só com desocupação confirmada.
                </dd>
              </div>
            )}
            <div>
              <dt>Período</dt>
              <dd>
                {dataCurta(d.period.start)} a {dataCurta(d.period.end)}: filtra janelas e acontecimentos; o estoque é sempre o de agora.
                {d.historyFrom !== null && ` Histórico disponível desde ${formatarData(d.historyFrom)} (cadastro/importação não é data de chegada física).`}
              </dd>
            </div>
          </dl>
          {d.claims !== null && permissoes.includes('claim.consultar') && (
            <section className="painel-detalhe-claims" aria-label="Claims (visão interna)" data-testid="painel-claims">
              <h3>Claims (visão interna)</h3>
              <dl className="painel-definicoes">
                <div data-testid="card-claims-abertos">
                  <dt>Casos abertos</dt>
                  <dd>
                    {volumes(d.claims.open)} de {volumes(d.claims.cases)} caso(s)
                    {d.claims.byState.length > 0 && ` · ${d.claims.byState.map((s) => `${ROTULOS_SITUACAO_CLAIM[s.state]}: ${String(s.count)}`).join(' · ')}`}
                  </dd>
                </div>
                <div data-testid="card-claims-recuperados">
                  <dt>Recuperações confirmadas</dt>
                  <dd>{d.claims.recoveredValidated.length === 0 ? 'Nenhuma' : d.claims.recoveredValidated.map((r) => `${r.quantity} ${r.unit}`).join(' · ')} (candidato não é recuperação).</dd>
                </div>
                {d.values !== null && (
                  <div data-testid="card-claims-valores">
                    <dt>Estimado × confirmado</dt>
                    <dd>
                      Confirmado: {d.values.avoidedConfirmed.length === 0 ? 'sem resultado confirmado' : d.values.avoidedConfirmed.map((x) => `${x.currency} ${x.value}`).join(' · ')} · estimado em análise
                      (não é valor evitado): {d.values.estimatedInAnalysis.length === 0 ? 'nenhum' : d.values.estimatedInAnalysis.map((x) => `${x.currency} ${x.value}`).join(' · ')}.
                    </dd>
                  </div>
                )}
              </dl>
              <button
                type="button"
                className="botao-secundario botao-compacto"
                onClick={() => {
                  aoNavegar({ tipo: 'claims' });
                }}
              >
                Abrir claims
              </button>
            </section>
          )}
        </JanelaModal>
      )}

      {detalhe === 'janelas' && (
        <JanelaModal titulo="Janelas do período" subtitulo={`${dataCurta(d.period.start)} a ${dataCurta(d.period.end)} · em volumes`} aoFechar={fechar} testId="painel-janelas-todas">
          <ComparacaoJanelas
            janelas={d.windows}
            aoAbrir={(id) => {
              aoNavegar({ tipo: 'painel-janela', id });
            }}
          />
        </JanelaModal>
      )}

      {detalhe === 'ruas' && (
        <JanelaModal titulo="Paletes e volumes por rua" subtitulo="Estoque de agora · volume contado quando houver; senão informado" aoFechar={fechar} testId="painel-ruas-tabela">
          <div className="tabela-rolagem">
            <table className="tabela-indicadores">
              <thead>
                <tr>
                  <th scope="col">Rua / área</th>
                  <th scope="col">Paletes</th>
                  <th scope="col">Volumes</th>
                </tr>
              </thead>
              <tbody>
                {d.byStreet.map((r) => (
                  <tr key={r.street}>
                    <td>
                      <button
                        type="button"
                        className="botao-link"
                        onClick={() => {
                          abrirRua(r.street);
                        }}
                      >
                        {r.street}
                      </button>
                    </td>
                    <td>{volumes(r.pallets)}</td>
                    <td>{textoVolumesRua(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </JanelaModal>
      )}

      {detalhe === 'prioridades' && (
        <JanelaModal titulo="Prioridades da operação" subtitulo={`${volumes(totalPrioridades)} no total`} aoFechar={fechar} testId="painel-prioridades-todas">
          <p className="painel-totais-prioridades">
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                lista({ situacao: 'reconferencia' });
              }}
            >
              {volumes(d.tasks.totals.reconference)} reconferência(s) vencida(s)
            </button>{' '}
            · {volumes(d.tasks.totals.separation)} janela(s) com separação pendente ·{' '}
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                lista({ situacao: 'sem-endereco' });
              }}
            >
              {volumes(d.tasks.totals.location)} palete(s) sem endereço
            </button>{' '}
            ·{' '}
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                aoNavegar({ tipo: 'inventarios' });
              }}
            >
              {volumes(d.tasks.totals.documentsWithoutPallet)} NF(s) sem palete
            </button>
          </p>
          {d.tasks.items.length < totalPrioridades && <p className="resumo-nota">Abaixo, até 25 de cada tipo; as listas completas abrem pelos totais acima.</p>}
          <ListaPrioridades itens={d.tasks.items} aoAbrir={abrirTarefa} testId="lista-prioridades" />
        </JanelaModal>
      )}
    </PaginaPainel>
  );
}
