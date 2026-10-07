import {
  API_PREFIXO,
  ConciliacaoSchema,
  PracaSchema,
  ROTULOS_SITUACAO_CONCILIACAO,
  SITUACOES_CONCILIACAO,
  type Conciliacao,
  type Permissao,
  type ResultadoConciliacao,
  type SituacaoConciliacao,
  type TipoExportacaoSelecao,
} from '@praca-reversa/contracts';
import { useMemo, useRef, useState } from 'react';
import { baixarArquivo, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeArquivo, IconeAtualizar } from '../../components/Icones';
import { Pagina } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { MapaPraca, type MapaPracaHandle } from '../mapa/MapaPraca';
import { DetalheLinha } from './DetalheLinha';
import { PropostaJanela } from './PropostaJanela';
import { FILTROS_RAPIDOS, MARCADOR_SITUACAO, ROTULOS_CONTEXTO_NF, ROTULOS_MODALIDADE } from './rotulos';

const TAMANHO = 100;
const MARGENS = { topo: 8, direita: 8, base: 8, esquerda: 8 };

const ROTULOS_EXPORTACAO: Record<TipoExportacaoSelecao, string> = {
  separacao: 'Lista de separação (proposta, por palete/endereço)',
  pendencias: 'Relatório de pendências',
  conciliacao: 'Conciliação completa',
};

function lerSituacoes(texto: string | null): SituacaoConciliacao[] {
  if (texto === null) return [];
  return texto.split(',').filter((s): s is SituacaoConciliacao => (SITUACOES_CONCILIACAO as readonly string[]).includes(s));
}

function solicitado(l: ResultadoConciliacao): string {
  const r = l.request;
  if (l.scope === 'PALETE') return `Palete ${r.palletRef ?? '?'}`;
  if (r.documentNumber !== null) return `${r.documentType ?? 'Doc.'} ${r.documentNumber}${r.delivery ? ` · DELIVERY ${r.delivery}` : ''}`;
  return r.delivery ? `DELIVERY ${r.delivery}` : '—';
}

/**
 * Conciliação de uma seleção do cliente: resumo (linhas, documentos e paletes
 * distintos, sem somar), filtros por situação, tabela com paletes/endereços
 * atuais e bases, detalhe com todos os paletes, mapa com as posições
 * conhecidas, exportações e proposta para a janela. Nada aqui altera estoque.
 */
export function TelaSelecao({
  id,
  situacao,
  permissoes,
  aoNavegar,
  aoGravar,
}: {
  id: string;
  situacao: string | null;
  permissoes: readonly Permissao[];
  aoNavegar: Navegar;
  aoGravar: () => void;
}) {
  const [situacoes, setSituacoes] = useState<SituacaoConciliacao[]>(() => lerSituacoes(situacao));
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [versao, setVersao] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  const mapaRef = useRef<MapaPracaHandle>(null);
  const p = new URLSearchParams({ pagina: String(pagina), tamanho: String(TAMANHO) });
  if (situacoes.length > 0) p.set('situacao', situacoes.join(','));
  if (busca.trim()) p.set('texto', busca.trim());
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/selecoes/${id}/conciliacao?${p.toString()}`, ConciliacaoSchema, versao);
  const praca = useRecurso(`${API_PREFIXO}/praca`, PracaSchema, versao);
  // Recarga (filtro, resolução, reserva): o último resultado continua na tela até o novo chegar.
  const [ultimo, setUltimo] = useState<Conciliacao | null>(null);
  if (carga?.estado === 'pronto' && carga.dados !== ultimo) setUltimo(carga.dados);
  const dados = carga?.estado === 'pronto' ? carga.dados : ultimo;
  const atualizando = carga?.estado === 'carregando' && ultimo !== null;
  const mapa = praca.carga?.estado === 'pronto' ? praca.carga.dados : null;
  const podeResolver = permissoes.includes('selecao.importar');
  const podeExportar = permissoes.includes('selecao.exportar');
  const podePropor = permissoes.includes('selecao.importar') && permissoes.includes('janela.consultar');
  const atualizar = () => {
    setVersao((v) => v + 1);
  };
  const itens = useMemo(() => dados?.items ?? [], [dados]);
  const linhaAberta = itens.find((l) => l.lineId === aberta) ?? null;
  // Mapa: posições conhecidas das linhas marcadas (ou da linha aberta, ou de todo o resultado filtrado).
  const fonteDestaque = useMemo(() => (marcadas.size > 0 ? itens.filter((l) => marcadas.has(l.lineId)) : linhaAberta ? [linhaAberta] : itens), [itens, marcadas, linhaAberta]);
  const destaque = useMemo(() => new Set(fonteDestaque.flatMap((l) => l.allocations.filter((a) => a.currentPosition !== null).map((a) => a.pallet.id))), [fonteDestaque]);
  const semPosicao = fonteDestaque.filter((l) => l.allocations.length === 0 || l.allocations.some((a) => a.currentPosition === null)).length;
  const marcadasElegiveis = itens.filter((l) => marcadas.has(l.lineId) && l.eligible).map((l) => ({ id: l.lineId, row: l.row }));

  // Os filtros ficam na barra de endereços: voltar de um palete aberto daqui restaura o mesmo recorte.
  const filtrar = (novas: SituacaoConciliacao[]) => {
    setSituacoes(novas);
    setPagina(1);
    setMarcadas(new Set());
    aoNavegar({ tipo: 'selecao', id, situacao: novas.length > 0 ? novas.join(',') : null }, { substituir: true });
  };
  const alternarSituacao = (lista: readonly SituacaoConciliacao[]) => {
    const todas = lista.every((s) => situacoes.includes(s));
    filtrar(todas ? situacoes.filter((s) => !lista.includes(s)) : [...new Set([...situacoes, ...lista])]);
  };
  const marcar = (lineId: string, sim: boolean) => {
    const nova = new Set(marcadas);
    if (sim) nova.add(lineId);
    else nova.delete(lineId);
    setMarcadas(nova);
  };
  const exportar = (tipo: TipoExportacaoSelecao) => {
    setErroDownload(null);
    const q = new URLSearchParams({ tipo });
    if (situacoes.length > 0) q.set('situacao', situacoes.join(','));
    if (busca.trim()) q.set('texto', busca.trim());
    baixarArquivo(`${API_PREFIXO}/selecoes/${id}/exportar?${q.toString()}`, `${tipo}-${dados?.selection.code ?? 'selecao'}.csv`).catch((e: unknown) => {
      setErroDownload(mensagemDeFalha(e));
    });
  };
  const centralizar = (paleteId: string) => {
    if (!mapaRef.current?.centralizar(paleteId)) setErroDownload('O palete não está no mapa (localização pendente).');
    document.getElementById('mapa-selecao')?.scrollIntoView({ block: 'nearest' });
  };

  const s = dados?.selection ?? null;
  return (
    <Pagina
      titulo={s ? `Seleção ${s.code}` : 'Seleção do cliente'}
      testId="tela-selecao"
      ajuda="selecao"
      rotuloVoltar="Voltar às seleções"
      aoVoltar={() => {
        aoNavegar({ tipo: 'selecoes' });
      }}
    >
      {carga?.estado === 'erro' && dados === null && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar a conciliação. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {dados === null && carga?.estado !== 'erro' && <p className="estado-carregando">Conciliando no servidor…</p>}
      {s && dados && (
        <>
          <section className="cartao" data-testid="cabecalho-selecao">
            <dl className="situacao">
              <div>
                <dt>Pedido / versão</dt>
                <dd>
                  {s.orderReference} · versão {s.orderVersion}
                  {s.versionLabel ? ` (cliente: ${s.versionLabel})` : ''}
                  {s.state === 'SUBSTITUIDA' ? ' · substituída por versão nova' : ''}
                </dd>
              </div>
              <div>
                <dt>Modalidade</dt>
                <dd>
                  {ROTULOS_MODALIDADE[s.mode]}
                  {s.mode === 'MARCACAO' ? ` (seleciona: ${s.parameters.markValues.join(', ')}; ${String(s.excludedLines)} linha(s) fora)` : ''}
                </dd>
              </div>
              <div>
                <dt>Inventário de referência</dt>
                <dd>
                  {s.inventory ? (
                    <button type="button" className="botao-link" onClick={() => { if (s.inventory) aoNavegar({ tipo: 'inventario', id: s.inventory.id }); }}>
                      {s.inventory.code} — {s.inventory.description}
                    </button>
                  ) : (
                    'não informado (só registros atuais)'
                  )}
                </dd>
              </div>
              <div>
                <dt>Coluna NF</dt>
                <dd>{ROTULOS_CONTEXTO_NF[s.documentContext]}</dd>
              </div>
              <div>
                <dt>Arquivo</dt>
                <dd>
                  {s.fileName} · {formatarDataHora(s.createdAt)}
                  {s.createdBy ? ` por ${s.createdBy.name}` : ''}{' '}
                  <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'importacao', id: s.batchId }); }}>
                    ver lote
                  </button>
                </dd>
              </div>
              <div>
                <dt>Consulta</dt>
                <dd data-testid="base-consulta">
                  {formatarDataHora(dados.consultedAt)} · bases: {dados.basis.join(' ')}
                  {atualizando && <span className="estado-carregando"> Atualizando…</span>}
                </dd>
              </div>
            </dl>
            {s.differences && (
              <div className="mensagem-conflito" role="note" data-testid="diferencas-versao">
                <p>
                  Versão substitutiva de {s.differences.previousCode}: {s.differences.added.length} inclusão(ões), {s.differences.removed.length} exclusão(ões),{' '}
                  {s.differences.quantityChanged.length} quantidade(s) alterada(s), {s.differences.unchanged} sem mudança.
                </p>
                {s.differences.reservationsToReview.length > 0 && (
                  <p>
                    Reservas ligadas à versão anterior, a revisar no fluxo da janela (nada foi cancelado):{' '}
                    {s.differences.reservationsToReview.map((r) => `${r.code} (${r.state.toLowerCase()})`).join(', ')}.
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="cartao" aria-label="Resumo da conciliação" data-testid="resumo-conciliacao">
            <div className="numeros-conciliacao">
              <p>
                <strong data-testid="linhas-solicitadas">{dados.summary.requestedLines}</strong> linha(s) solicitada(s)
              </p>
              <p>
                <strong data-testid="documentos-resolvidos">{dados.summary.resolvedDocuments}</strong> documento(s) resolvido(s)
              </p>
              <p>
                <strong data-testid="paletes-distintos">{dados.summary.distinctPallets}</strong> palete(s) físico(s) distinto(s)
              </p>
              <p>
                <strong>{dados.summary.eligibleLines}</strong> elegível(is) · <strong>{dados.summary.pendingLines}</strong> com pendência
              </p>
            </div>
            <p className="campo-ajuda">Linhas, documentos e paletes são contagens diferentes: não se somam numa volumetria única.</p>
            <div className="abas-classificacao" role="group" aria-label="Filtrar por situação">
              <button type="button" aria-pressed={situacoes.length === 0} onClick={() => { filtrar([]); }}>
                Todas ({dados.summary.requestedLines})
              </button>
              {FILTROS_RAPIDOS.map((f) => {
                const n = f.situacoes.reduce((t, x) => t + dados.summary.bySituation[x], 0);
                return (
                  <button
                    key={f.rotulo}
                    type="button"
                    aria-pressed={f.situacoes.every((x) => situacoes.includes(x))}
                    onClick={() => {
                      alternarSituacao(f.situacoes);
                    }}
                    data-testid={`filtro-situacao-${f.situacoes[0] ?? ''}`}
                  >
                    {f.rotulo} ({n})
                  </button>
                );
              })}
            </div>
            <form
              className="acoes-linha"
              onSubmit={(e) => {
                e.preventDefault();
                setBusca(texto);
                setPagina(1);
              }}
            >
              <label className="campo">
                <span className="campo-rotulo">Procurar na seleção (palete, NF, SKU, linha)</span>
                <input value={texto} maxLength={64} onChange={(e) => { setTexto(e.target.value); }} data-testid="texto-conciliacao" />
              </label>
              <button type="submit" className="botao-secundario">
                Procurar
              </button>
            </form>
          </section>

          <section className="cartao" aria-label="Linhas da seleção" aria-busy={atualizando} data-testid="tabela-conciliacao">
            {itens.length === 0 ? (
              <p className="estado-vazio">
                {situacoes.length > 0 || busca ? 'Nenhuma linha com estes filtros.' : 'Esta seleção não tem linhas solicitadas (todas ficaram fora da marcação ou agrupadas).'}
              </p>
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela-comparacao tabela-selecao">
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="visualmente-oculto">Marcar</span>
                      </th>
                      <th scope="col">Linha</th>
                      <th scope="col">NF / devolução / palete</th>
                      <th scope="col">Produto</th>
                      <th scope="col">Solicitado</th>
                      <th scope="col">Paletes e endereços atuais</th>
                      <th scope="col">Bases</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Próximo passo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((l) => (
                      <tr key={l.lineId} aria-selected={aberta === l.lineId} data-testid="linha-conciliacao" data-linha={l.row} data-situacao={l.situation}>
                        <td data-rotulo="Marcar">
                          <input
                            type="checkbox"
                            aria-label={`Marcar linha ${String(l.row)}`}
                            checked={marcadas.has(l.lineId)}
                            onChange={(e) => {
                              marcar(l.lineId, e.target.checked);
                            }}
                            data-testid="marcar-linha"
                          />
                        </td>
                        <td data-rotulo="Linha">
                          <button type="button" className="botao-link" onClick={() => { setAberta(aberta === l.lineId ? null : l.lineId); }} data-testid="abrir-linha">
                            {l.row}
                            {l.lineRef ? ` · ${l.lineRef}` : ''}
                          </button>
                        </td>
                        <td data-rotulo="Solicitado">{solicitado(l)}</td>
                        <td data-rotulo="Produto">
                          {l.request.sku ? `${l.request.sku}${l.request.lot ? ` · lote ${l.request.lot}` : ''}` : <span className="tabela-nota">não aplicável</span>}
                        </td>
                        <td data-rotulo="Quantidade">{l.request.quantity !== null ? `${formatarQuantidade(l.request.quantity)} ${l.request.unit ?? ''}` : <span className="tabela-nota">não informada</span>}</td>
                        <td data-rotulo="Paletes">
                          {l.allocations.length === 0 ? (
                            <span className="pendente">nenhum palete comprovado</span>
                          ) : (
                            <ul className="lista-compacta">
                              {l.allocations.map((a) => (
                                <li key={a.pallet.id}>
                                  {a.pallet.code} · {a.currentPosition ? (a.currentPosition.address ?? a.currentPosition.code) : <span className="pendente">sem endereço</span>}
                                  {a.addressDiffers ? ' (≠ informado)' : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td data-rotulo="Bases">
                          {l.quantities.informedVolumes !== null && <span>{formatarQuantidade(l.quantities.informedVolumes)} vol. informados · </span>}
                          {l.quantities.validated !== null ? <span>validado {formatarQuantidade(l.quantities.validated)} · disp. {formatarQuantidade(l.quantities.available ?? '0')}</span> : <span className="tabela-nota">{l.quantities.basis}</span>}
                        </td>
                        <td data-rotulo="Situação">
                          <span className={`selo-situacao-conciliacao selo-situacao-conciliacao--${l.situation}`}>
                            <span aria-hidden="true">{MARCADOR_SITUACAO[l.situation]}</span> {ROTULOS_SITUACAO_CONCILIACAO[l.situation]}
                          </span>
                          {l.alsoSituations.length > 0 && <span className="tabela-nota"> + {l.alsoSituations.map((x) => ROTULOS_SITUACAO_CONCILIACAO[x]).join(', ')}</span>}
                          {l.eligible && <span className="tabela-nota"> · elegível</span>}
                        </td>
                        <td data-rotulo="Próximo passo" className="tabela-nota">
                          {l.nextStep}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {dados.total > TAMANHO && (
              <nav className="paginacao" aria-label="Páginas da conciliação">
                <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina((x) => x - 1); }}>
                  Anterior
                </button>
                <span>
                  Página {pagina} de {Math.ceil(dados.total / TAMANHO)}
                </span>
                <button type="button" className="botao-secundario botao-compacto" disabled={pagina * TAMANHO >= dados.total} onClick={() => { setPagina((x) => x + 1); }}>
                  Próxima
                </button>
              </nav>
            )}
            {marcadas.size > 0 && (
              <p className="campo-ajuda" data-testid="marcadas">
                {marcadas.size} linha(s) marcada(s), {marcadasElegiveis.length} elegível(is).{' '}
                <button type="button" className="botao-link" onClick={() => { setMarcadas(new Set()); }}>
                  Limpar
                </button>
              </p>
            )}
            {marcadas.size === 0 && itens.some((l) => l.eligible) && (
              <button type="button" className="botao-link" onClick={() => { setMarcadas(new Set(itens.filter((l) => l.eligible).map((l) => l.lineId))); }} data-testid="marcar-elegiveis">
                Marcar as elegíveis desta página
              </button>
            )}
          </section>

          {linhaAberta && (
            <DetalheLinha
              linha={linhaAberta}
              selecaoId={id}
              versaoSelecao={s.version}
              podeResolver={podeResolver && s.state === 'REGISTRADA'}
              aoCentralizar={centralizar}
              aoAbrirPalete={(paleteId) => {
                aoNavegar({ tipo: 'palete', id: paleteId });
              }}
              aoAtualizar={() => {
                atualizar();
                aoGravar();
              }}
            />
          )}

          <section className="cartao" aria-label="Mapa das posições conhecidas" data-testid="mapa-selecao-secao">
            <h3>Mapa: posições conhecidas</h3>
            <p className="campo-ajuda">
              {marcadas.size > 0 ? 'Destaque das linhas marcadas.' : linhaAberta ? `Destaque da linha ${String(linhaAberta.row)}.` : 'Destaque de todas as linhas desta página.'}{' '}
              {destaque.size} palete(s) com posição; {semPosicao} linha(s) com palete sem endereço ou sem palete ficam só na lista (nenhuma posição é inventada).
            </p>
            {mapa?.layout ? (
              <div id="mapa-selecao" className="mapa-selecao">
                <MapaPraca ref={mapaRef} layout={mapa.layout} paletes={mapa.pallets} selecionadoId={null} idsVisiveis={destaque} margens={MARGENS} aoSelecionar={(paleteId) => { aoNavegar({ tipo: 'palete', id: paleteId }); }} aoMudarVisao={() => undefined} />
              </div>
            ) : (
              <p className="estado-carregando">{praca.carga?.estado === 'erro' ? `Mapa indisponível: ${praca.carga.mensagem}` : 'Carregando o mapa…'}</p>
            )}
            {erroDownload && (
              <p className="mensagem-conflito" role="alert">
                {erroDownload}
              </p>
            )}
          </section>

          {podeExportar && (
            <section className="cartao" aria-label="Exportações" data-testid="exportacoes-selecao">
              <h3>Exportar (CSV)</h3>
              <p className="campo-ajuda">
                Com horário, inventário de referência, versão da seleção e os filtros atuais. A lista de separação é uma proposta: não representa material reservado nem
                expedido.
              </p>
              <div className="acoes-linha">
                {(['separacao', 'pendencias', 'conciliacao'] as const).map((t) => (
                  <button key={t} type="button" className="botao-secundario botao-compacto" onClick={() => { exportar(t); }} data-testid={`exportar-${t}`}>
                    <IconeArquivo />
                    {ROTULOS_EXPORTACAO[t]}
                  </button>
                ))}
              </div>
            </section>
          )}

          {podePropor && s.state === 'REGISTRADA' && (
            <PropostaJanela
              selecaoId={id}
              linhas={marcadasElegiveis}
              permissoes={permissoes}
              aoNavegar={aoNavegar}
              aoReservado={() => {
                atualizar();
                aoGravar();
              }}
            />
          )}
          {s.inventory === null && (
            <p className="campo-ajuda">Sem inventário de referência: as alocações vêm só dos vínculos e registros atuais ({formatarData(dados.consultedAt)}).</p>
          )}
        </>
      )}
    </Pagina>
  );
}
