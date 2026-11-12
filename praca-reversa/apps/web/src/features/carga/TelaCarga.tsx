import {
  API_PREFIXO,
  CargaJanelaSchema,
  JanelasCargaSchema,
  OrigemEmbarqueSchema,
  type CargaJanela,
  type OrigemEmbarque,
  type PaleteEmbarque,
  type Sessao,
  type SituacaoDocEmbarque,
  type TipoEmissao,
  type TipoVeiculo,
  type VeiculoCarga,
} from '@praca-reversa/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChaves, ehConflitoDeVersao } from '../../api/chaves';
import { enviarJson, mensagemDeFalha, obterJson } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { EstadoTela, MensagemAcao } from '../../components/Moldura';
import type { Navegar, Rota } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { documentoDoEmbarque } from '../espelhos/conteudo-espelho';
import { EditorLayout } from '../espelhos/EditorLayout';
import { aplicarLayoutEmbarque, layoutDoEmbarque } from '../espelhos/layout-armazenamento';
import { ImpressaoCarga, type PedidoImpressao } from './Impressao';
import { MapaVeiculo } from './MapaVeiculo';
import { SelecaoVeiculos } from './SelecaoVeiculos';
import { textoDocs } from './textos';
import './carga.css';

const API = `${API_PREFIXO}/cargas`;
type Mensagem = {
  tipo: 'ok' | 'erro' | 'conflito' | 'aviso';
  texto: string;
} | null;
type RotaCarga = Extract<Rota, { tipo: 'carga' }>;

/** Envia uma mutação idempotente e devolve a carga atualizada. */
function useMutacao(aoResultado: (c: CargaJanela) => void, aoMensagem: (m: Mensagem) => void, aoConflito: () => void) {
  const chaves = useChaves();
  const [ocupado, setOcupado] = useState(false);
  async function executar(assinatura: string, metodo: 'POST' | 'PUT', url: string, corpo: unknown, sucesso: string): Promise<CargaJanela | null> {
    setOcupado(true);
    aoMensagem(null);
    try {
      const c = await enviarJson(metodo, url, CargaJanelaSchema, {
        corpo,
        idempotencia: chaves.para(assinatura),
      });
      chaves.concluir(assinatura);
      aoResultado(c);
      aoMensagem({ tipo: 'ok', texto: sucesso });
      return c;
    } catch (e) {
      chaves.concluir(assinatura, e);
      if (ehConflitoDeVersao(e)) {
        aoMensagem({ tipo: 'conflito', texto: mensagemDeFalha(e) });
        aoConflito();
      } else aoMensagem({ tipo: 'erro', texto: mensagemDeFalha(e) });
      return null;
    } finally {
      setOcupado(false);
    }
  }
  return { executar, ocupado };
}

export function TelaCarga({ sessao, rota, aoNavegar }: { sessao: Sessao; rota: RotaCarga; aoNavegar: Navegar }) {
  const pode = (p: Sessao['permissions'][number]) => sessao.permissions.includes(p);
  const podePreparar = pode('expedicao.preparar');
  const podeDocs = pode('expedicao.documentos');
  const podeConfirmar = pode('expedicao.confirmar');
  const janelas = useRecurso(`${API}/janelas`, JanelasCargaSchema);
  const listaJanelas = janelas.carga?.estado === 'pronto' ? janelas.carga.dados.items : [];
  const janelaId = rota.janela ?? listaJanelas.find((j) => j.vehicles > 0)?.id ?? null;
  const [versao, setVersao] = useState(0);
  const carga = useRecurso(janelaId === null ? null : `${API}/janelas/${janelaId}`, CargaJanelaSchema, versao);
  const [resposta, setResposta] = useState<CargaJanela | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const lida = carga.carga?.estado === 'pronto' ? carga.carga.dados : null;
  const dados = resposta !== null && resposta.window.id === janelaId && (lida === null || resposta.generatedAt >= lida.generatedAt) ? resposta : lida;
  const recarregar = () => {
    setResposta(null);
    setVersao((v) => v + 1);
  };
  const m = useMutacao(setResposta, setMensagem, recarregar);

  const ativos = dados?.vehicles.filter((v) => v.state !== 'CANCELADO') ?? [];
  // Sem veículo na rota: tela de seleção (cards). Com veículo: mapa daquele veículo.
  const veiculo = dados?.vehicles.find((v) => v.id === rota.veiculo) ?? null;
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [posicao, setPosicao] = useState<number | null>(null);
  const [movendo, setMovendo] = useState<string | null>(null);
  const [painelAberto, setPainelAberto] = useState(true);
  const [impressao, setImpressao] = useState<PedidoImpressao | null>(null);
  // Espelho: só imprime depois de paginado (linhas medidas) e com as fontes carregadas.
  const [impressaoPronta, setImpressaoPronta] = useState<PedidoImpressao | null>(null);
  const aoImpressaoPronta = useCallback(() => { setImpressaoPronta(impressao); }, [impressao]);
  // Editor do layout do espelho de embarque (palete de exemplo).
  const [editorEspelho, setEditorEspelho] = useState<string | null>(null);
  const palete = veiculo?.pallets.find((p) => p.id === selecionado) ?? null;
  const paleteMovendo = veiculo?.pallets.find((p) => p.id === movendo) ?? null;

  useEffect(() => {
    if (impressao === null) return;
    if (impressao.kind === 'ESPELHO' && impressaoPronta !== impressao) return;
    const t = window.setTimeout(() => {
      window.print();
    }, 150);
    const fim = () => {
      setImpressao(null);
    };
    window.addEventListener('afterprint', fim);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', fim);
    };
  }, [impressao, impressaoPronta]);

  const ir = (mudanca: Partial<RotaCarga>) => {
    setSelecionado(null);
    setPosicao(null);
    setMovendo(null);
    aoNavegar({ ...rota, ...mudanca, tipo: 'carga' });
  };

  function adicionarVeiculo(kind: TipoVeiculo) {
    if (dados === null) return;
    void m.executar(
      `veiculo:${kind}:${dados.window.id}:${String(ativos.length)}`,
      'POST',
      `${API}/janelas/${dados.window.id}/veiculos`,
      { kind },
      kind === 'CARRETA' ? 'Carreta adicionada.' : 'Truck adicionado.',
    );
  }

  async function emitir(kind: TipoEmissao, final: boolean, v: VeiculoCarga, p: PaleteEmbarque | null) {
    const url = p === null ? `${API}/veiculos/${v.id}/mapa` : `${API}/paletes/${p.id}/emissoes`;
    const nome = kind === 'MAPA' ? 'Mapa' : kind === 'ETIQUETA' ? 'Etiqueta' : kind === 'ESPELHO' ? 'Espelho' : 'Lista de documentos';
    const c = await m.executar(
      `emitir:${kind}:${String(final)}:${p?.id ?? v.id}:${String(p?.revision ?? 0)}:${String(Date.now())}`,
      'POST',
      url,
      { kind, final },
      `${nome} ${final ? 'final' : 'rascunho'} registrada: abrindo a impressão.`,
    );
    if (c) setImpressao({ kind, final, veiculoId: v.id, paleteId: p?.id ?? null, ...(kind === 'ESPELHO' ? { layout: layoutDoEmbarque() } : {}) });
  }

  if (janelas.carga?.estado !== 'pronto') return <EstadoTela carga={janelas.carga} titulo="Não foi possível carregar as janelas" aoTentarNovamente={janelas.recarregar} />;

  return (
    <main className="principal principal--pagina tela-carga" data-testid="tela-carga">
      <div className="pagina-conteudo carga-conteudo">
        <header className="carga-topo nao-imprimir">
          <div className="carga-topo-linha">
            <h2>Expedição</h2>
            <label className="carga-janela">
              <span className="campo-rotulo">Janela</span>
              <select
                value={janelaId ?? ''}
                onChange={(e) => {
                  ir({ janela: e.target.value || null, veiculo: null });
                }}
                data-testid="carga-janela"
              >
                {janelaId === null && <option value="">Escolha a janela…</option>}
                {listaJanelas.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} — {j.name}
                    {j.vehicles > 0 ? ` · ${String(j.vehicles)} veículo(s)` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="carga-visao" role="group" aria-label="Visão">
              <button type="button" aria-pressed={rota.visao === 'operacao'} onClick={() => ir({ visao: 'operacao' })} data-testid="visao-operacao">
                Operação
              </button>
              <button type="button" aria-pressed={rota.visao === 'adm'} onClick={() => ir({ visao: 'adm' })} data-testid="visao-adm">
                Administrativo
              </button>
            </div>
          </div>
          {dados !== null && veiculo !== null && (
            <div className="carga-veiculos" role="tablist" aria-label="Veículos da janela">
              <button type="button" className="botao-secundario botao-compacto carga-voltar" onClick={() => ir({ veiculo: null })} data-testid="carga-voltar">
                ‹ Veículos
              </button>
              {ativos.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={veiculo.id === v.id}
                  className={`carga-veiculo-chip carga-veiculo-chip--${v.state.toLowerCase()}`}
                  onClick={() => ir({ veiculo: v.id })}
                  data-testid={`veiculo-${v.label}`}
                >
                  <strong>{v.label}</strong>
                  {v.plate !== null && <span> · {v.plate}</span>}
                  <span className="carga-ocupacao">
                    {' '}
                    {v.occupied}/{v.capacity}
                  </span>
                  {v.state === 'FECHADO' && <span className="carga-selo-fechado"> · Fechada</span>}
                </button>
              ))}
            </div>
          )}
          <MensagemAcao mensagem={mensagem} testId="carga-mensagem" />
        </header>

        {janelaId === null ? (
          <p className="estado-vazio nao-imprimir">Escolha uma janela para montar a expedição.</p>
        ) : dados === null ? (
          <div className="nao-imprimir">
            <EstadoTela carga={carga.carga} titulo="Não foi possível carregar a carga" aoTentarNovamente={carga.recarregar} />
          </div>
        ) : veiculo === null ? (
          <div className="nao-imprimir">
            <SelecaoVeiculos dados={dados} podePreparar={podePreparar} ocupado={m.ocupado} aoAbrir={(v) => ir({ veiculo: v.id })} aoAdicionar={adicionarVeiculo} />
          </div>
        ) : (
          <div className={`carga-corpo nao-imprimir${painelAberto ? '' : ' carga-corpo--sem-painel'}`}>
            <section className="carga-centro" aria-label={`Mapa ${veiculo.label}`}>
              <ResumoVeiculo veiculo={veiculo} />
              {!veiculo.layoutConfirmed && (
                <p className="carga-aviso" data-testid="disposicao-provisoria">
                  Disposição provisória ({veiculo.rows} fileiras × {veiculo.cols} colunas): ajuste e confirme a grade com a operação em “Veículo”.
                </p>
              )}
              {rota.visao === 'operacao' ? (
                <>
                  {paleteMovendo !== null && (
                    <p className="carga-aviso carga-aviso--acao" role="status">
                      Movendo <strong>{paleteMovendo.label}</strong>: toque numa posição livre.{' '}
                      <button type="button" className="botao-link" onClick={() => setMovendo(null)}>
                        Cancelar
                      </button>
                    </p>
                  )}
                  <MapaVeiculo
                    veiculo={veiculo}
                    selecionado={selecionado}
                    posicaoEscolhida={posicao}
                    movendo={paleteMovendo}
                    aoEscolherPosicao={(pos) => {
                      if (paleteMovendo !== null) {
                        void m
                          .executar(
                            `mover:${paleteMovendo.id}:${String(paleteMovendo.version)}:${String(pos)}`,
                            'PUT',
                            `${API}/paletes/${paleteMovendo.id}/posicao`,
                            {
                              expectedVersion: paleteMovendo.version,
                              position: pos,
                            },
                            `${paleteMovendo.label} na posição ${String(pos)} (planejada; confirme no carregamento).`,
                          )
                          .then(() => {
                            setMovendo(null);
                            setSelecionado(paleteMovendo.id);
                          });
                        return;
                      }
                      setSelecionado(null);
                      setPosicao(pos);
                      setPainelAberto(true);
                    }}
                    aoEscolherPalete={(p) => {
                      setPosicao(null);
                      setMovendo(null);
                      setSelecionado(p.id);
                      setPainelAberto(true);
                    }}
                  />
                  <p className="carga-legenda">
                    <span>┄ tracejado = posição planejada</span> <span>■ contorno cheio = confirmada no carregamento</span> <span>✓ Físico = operação conferiu</span>{' '}
                    <span>Docs = conferência do administrativo</span>
                  </p>
                  <SemPosicao
                    veiculo={veiculo}
                    aoEscolher={(p) => {
                      setSelecionado(p.id);
                      setPosicao(null);
                      setPainelAberto(true);
                    }}
                  />
                </>
              ) : (
                <FilaAdm
                  veiculo={veiculo}
                  selecionado={selecionado}
                  aoEscolher={(p) => {
                    setSelecionado(p.id);
                    setPainelAberto(true);
                  }}
                />
              )}
              <AcoesVeiculo
                key={`${veiculo.id}:${String(veiculo.version)}`}
                veiculo={veiculo}
                dados={dados}
                podePreparar={podePreparar}
                podeConfirmar={podeConfirmar}
                m={m}
                aoEmitir={(final) => void emitir('MAPA', final, veiculo, null)}
              />
              <p className="carga-baixa" data-testid="carga-baixa">
                {dados.stockEffect}
              </p>
            </section>

            <aside className="carga-painel" aria-label="Detalhes" data-aberto={painelAberto ? 'sim' : 'nao'}>
              <button type="button" className="botao-link carga-painel-alternar" onClick={() => setPainelAberto(!painelAberto)} aria-expanded={painelAberto}>
                {painelAberto ? 'Recolher detalhes ›' : '‹ Detalhes'}
              </button>
              {painelAberto &&
                (palete !== null ? (
                  rota.visao === 'adm' ? (
                    <ChecklistDocumentos p={palete} veiculo={veiculo} podeDocs={podeDocs} m={m} aoImprimir={() => void emitir('DOCUMENTOS', true, veiculo, palete)} />
                  ) : (
                    <DetalhePalete
                      key={palete.id}
                      p={palete}
                      veiculo={veiculo}
                      dados={dados}
                      podePreparar={podePreparar}
                      m={m}
                      aoMover={() => {
                        setMovendo(palete.id);
                        setSelecionado(null);
                      }}
                      aoEmitir={(kind, final) => void emitir(kind, final, veiculo, palete)}
                      aoEditarEspelho={() => { setEditorEspelho(palete.id); }}
                    />
                  )
                ) : posicao !== null && rota.visao === 'operacao' ? (
                  <NovoPalete
                    key={`${veiculo.id}:${String(posicao)}`}
                    veiculo={veiculo}
                    janelaId={dados.window.id}
                    posicao={posicao}
                    podePreparar={podePreparar}
                    m={m}
                    aoCriado={() => setPosicao(null)}
                    aoUsarExistente={(p) => {
                      void m
                        .executar(
                          `mover:${p.id}:${String(p.version)}:${String(posicao)}`,
                          'PUT',
                          `${API}/paletes/${p.id}/posicao`,
                          { expectedVersion: p.version, position: posicao },
                          `${p.label} na posição ${String(posicao)} (planejada).`,
                        )
                        .then(() => {
                          setPosicao(null);
                          setSelecionado(p.id);
                        });
                    }}
                  />
                ) : (
                  <div className="carga-painel-vazio">
                    <p>
                      {rota.visao === 'adm'
                        ? 'Escolha um palete da fila para conferir os documentos.'
                        : 'Toque numa posição livre para alocar um palete ou num palete para ver NFs, volumes e situação.'}
                    </p>
                  </div>
                ))}
            </aside>
          </div>
        )}
      </div>
      {impressao !== null && dados !== null && <ImpressaoCarga carga={dados} pedido={impressao} aoPronto={aoImpressaoPronta} />}
      {editorEspelho !== null && dados !== null && veiculo !== null && (() => {
        const doVeiculo = veiculo.pallets.filter((x) => x.state === 'ATIVO');
        const inicio = Math.max(0, doVeiculo.findIndex((x) => x.id === editorEspelho));
        return (
          <EditorLayout
            documentos={doVeiculo.map((x) => documentoDoEmbarque(dados, veiculo, x, true))}
            geracao={dados.generatedAt}
            inicio={inicio}
            layoutInicial={layoutDoEmbarque()}
            rotuloAplicar="Aplicar ao espelho de embarque"
            explicacao="O layout vale para todas as vias do cliente impressas neste computador (rascunho e final). Para conferir, navegue pelos paletes deste veículo:"
            aoSair={() => { setEditorEspelho(null); }}
            aoAplicar={(novo) => {
              aplicarLayoutEmbarque(novo);
              setEditorEspelho(null);
              setMensagem({ tipo: 'ok', texto: 'Layout do espelho de embarque aplicado. Vale para as próximas impressões deste computador; nenhum dado do palete mudou.' });
            }}
          />
        );
      })()}
    </main>
  );
}

type Mut = ReturnType<typeof useMutacao>;

function ResumoVeiculo({ veiculo }: { veiculo: VeiculoCarga }) {
  return (
    <div className="carga-resumo" data-testid="carga-resumo">
      <strong className="carga-resumo-titulo">
        {veiculo.label}
        {veiculo.name ? ` · ${veiculo.name}` : ''}
        {veiculo.plate ? ` · Placa ${veiculo.plate}` : ' · Placa não informada'}
      </strong>
      <span className="carga-resumo-numeros">
        <span data-testid="carga-ocupacao">
          {veiculo.occupied}/{veiculo.capacity} paletes
        </span>
        <span>{veiculo.positioned} com posição</span>
        <span>{veiculo.confirmedPositions} confirmada(s)</span>
        <span>{veiculo.pallets.filter((p) => p.state === 'ATIVO' && p.physical.checked).length} físico conferido</span>
        <span>{veiculo.pallets.filter((p) => p.state === 'ATIVO' && p.docs.state === 'CONFERIDA').length} docs conferidos</span>
      </span>
      <span className={`carga-situacao carga-situacao--${veiculo.state.toLowerCase()}`}>
        {veiculo.state === 'MONTAGEM' ? 'Em montagem' : veiculo.state === 'FECHADO' ? 'Carga fechada' : 'Cancelado'}
      </span>
    </div>
  );
}

function SemPosicao({ veiculo, aoEscolher }: { veiculo: VeiculoCarga; aoEscolher: (p: PaleteEmbarque) => void }) {
  const lista = veiculo.pallets.filter((p) => p.state === 'ATIVO' && p.position === null);
  if (lista.length === 0) return null;
  return (
    <div className="carga-sem-posicao" data-testid="sem-posicao">
      <strong>Sem posição no veículo:</strong>{' '}
      {lista.map((p) => (
        <button key={p.id} type="button" className="botao-secundario botao-compacto" onClick={() => aoEscolher(p)}>
          {p.label} · {p.volumes} vol
        </button>
      ))}
    </div>
  );
}

/** Pendências, edição do veículo, mapa e fechamento. */
function AcoesVeiculo({
  veiculo,
  dados,
  podePreparar,
  podeConfirmar,
  m,
  aoEmitir,
}: {
  veiculo: VeiculoCarga;
  dados: CargaJanela;
  podePreparar: boolean;
  podeConfirmar: boolean;
  m: Mut;
  aoEmitir: (final: boolean) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [placa, setPlaca] = useState(veiculo.plate ?? '');
  const [nome, setNome] = useState(veiculo.name ?? '');
  const [fileiras, setFileiras] = useState(veiculo.rows);
  const [colunas, setColunas] = useState(veiculo.cols);
  const [confirmada, setConfirmada] = useState(veiculo.layoutConfirmed);
  const [motivo, setMotivo] = useState('');
  const montagem = veiculo.state === 'MONTAGEM';
  const acao = (action: 'FECHAR' | 'REABRIR' | 'CANCELAR', texto: string) =>
    void m.executar(
      `veiculo-acao:${veiculo.id}:${String(veiculo.version)}:${action}`,
      'POST',
      `${API}/veiculos/${veiculo.id}/situacao`,
      {
        expectedVersion: veiculo.version,
        action,
        reason: motivo.trim() === '' ? null : motivo,
      },
      texto,
    );
  return (
    <section className="carga-acoes-veiculo">
      <div className="carga-pendencias" data-testid="carga-pendencias">
        {veiculo.pending.length === 0 ? (
          <p className="marca-ok">{montagem ? '✓ Sem pendências: a carga pode ser fechada pelo supervisor.' : '✓ Carga fechada.'}</p>
        ) : (
          <>
            <strong>Falta para fechar:</strong>
            <ul>
              {veiculo.pending.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="acoes-linha">
        {podePreparar && (
          <>
            <button type="button" className="botao-secundario" disabled={m.ocupado} onClick={() => aoEmitir(false)}>
              Imprimir prévia do mapa
            </button>
            <button type="button" className="botao-secundario" disabled={m.ocupado || veiculo.confirmedPositions === 0} onClick={() => aoEmitir(true)} title="Só posições confirmadas no carregamento">
              Imprimir mapa final
            </button>
          </>
        )}
        {veiculo.map !== null && (
          <span className={veiculo.map.outdated ? 'marca-erro' : 'marca-ok'} data-testid="mapa-emitido">
            Mapa {veiculo.map.final ? 'final' : 'prévia'} de {formatarDataHora(veiculo.map.at)}
            {veiculo.map.outdated ? ' — desatualizado: reemita' : ''}
          </span>
        )}
        {podePreparar && montagem && (
          <button type="button" className="botao-link" onClick={() => setEditando(!editando)} aria-expanded={editando}>
            Veículo (placa, grade)
          </button>
        )}
      </div>
      {editando && montagem && (
        <form
          className="carga-form-veiculo"
          onSubmit={(e) => {
            e.preventDefault();
            void m
              .executar(
                `veiculo-editar:${veiculo.id}:${String(veiculo.version)}:${placa}:${nome}:${String(fileiras)}:${String(colunas)}:${String(confirmada)}`,
                'PUT',
                `${API}/veiculos/${veiculo.id}`,
                {
                  expectedVersion: veiculo.version,
                  plate: placa.trim() === '' ? null : placa,
                  name: nome.trim() === '' ? null : nome,
                  rows: fileiras,
                  cols: colunas,
                  layoutConfirmed: confirmada,
                },
                'Veículo atualizado.',
              )
              .then((c) => {
                if (c) setEditando(false);
              });
          }}
        >
          <label className="campo">
            <span className="campo-rotulo">Placa</span>
            <input value={placa} maxLength={12} onChange={(e) => setPlaca(e.target.value.toUpperCase())} data-testid="veiculo-placa" />
          </label>
          <label className="campo">
            <span className="campo-rotulo">Nome (opcional)</span>
            <input value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} />
          </label>
          <label className="campo">
            <span className="campo-rotulo">Fileiras (frente → porta)</span>
            <input type="number" min={1} max={40} value={fileiras} onChange={(e) => setFileiras(Number(e.target.value))} />
          </label>
          <label className="campo">
            <span className="campo-rotulo">Colunas</span>
            <input type="number" min={1} max={4} value={colunas} onChange={(e) => setColunas(Number(e.target.value))} />
          </label>
          <label className="campo-check">
            <input type="checkbox" checked={confirmada} onChange={(e) => setConfirmada(e.target.checked)} /> Disposição confirmada com a operação
          </label>
          <button type="submit" className="botao-primario" disabled={m.ocupado}>
            Salvar veículo
          </button>
        </form>
      )}
      {podeConfirmar && veiculo.state !== 'CANCELADO' && (
        <details className="carga-supervisor">
          <summary>Supervisor: fechar, reabrir ou cancelar a carga</summary>
          <label className="campo">
            <span className="campo-rotulo">Motivo (obrigatório para reabrir ou cancelar)</span>
            <input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <div className="acoes-linha">
            {montagem && (
              <button type="button" className="botao-primario" disabled={m.ocupado || veiculo.pending.length > 0} onClick={() => acao('FECHAR', 'Carga fechada.')} data-testid="fechar-carga">
                Fechar carga
              </button>
            )}
            {veiculo.state === 'FECHADO' && (
              <button type="button" className="botao-secundario" disabled={m.ocupado || motivo.trim().length < 3} onClick={() => acao('REABRIR', 'Carga reaberta.')}>
                Reabrir com motivo
              </button>
            )}
            {montagem && (
              <button type="button" className="botao-secundario botao-perigo" disabled={m.ocupado || motivo.trim().length < 3} onClick={() => acao('CANCELAR', 'Veículo cancelado.')}>
                Cancelar veículo
              </button>
            )}
          </div>
          <p className="campo-ajuda">Fechar não baixa estoque. {dados.stockEffect}</p>
        </details>
      )}
    </section>
  );
}

/** Alocar numa posição livre: palete já montado sem posição, FULL (palete de origem inteiro) ou fracionado (NFs e volumes). */
function NovoPalete({
  veiculo,
  janelaId,
  posicao,
  podePreparar,
  m,
  aoCriado,
  aoUsarExistente,
}: {
  veiculo: VeiculoCarga;
  janelaId: string;
  posicao: number;
  podePreparar: boolean;
  m: Mut;
  aoCriado: () => void;
  aoUsarExistente: (p: PaleteEmbarque) => void;
}) {
  const [tipo, setTipo] = useState<'FULL' | 'FRACIONADO'>('FULL');
  const [numero, setNumero] = useState('');
  const [codigo, setCodigo] = useState('');
  const [origem, setOrigem] = useState<OrigemEmbarque | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [volumes, setVolumes] = useState<Record<string, string>>({});
  const semPosicao = veiculo.pallets.filter((p) => p.state === 'ATIVO' && p.position === null);
  const usados = new Set(veiculo.pallets.filter((p) => p.state === 'ATIVO').map((p) => p.number));
  let proximo = 1;
  while (usados.has(proximo) && proximo <= veiculo.capacity) proximo++;
  if (veiculo.state !== 'MONTAGEM') return <p className="carga-painel-vazio">Carga {veiculo.state === 'FECHADO' ? 'fechada' : 'cancelada'}: não recebe paletes.</p>;
  if (!podePreparar) return <p className="carga-painel-vazio">Posição {posicao} livre.</p>;
  const lotado = veiculo.occupied >= veiculo.capacity;

  async function buscar() {
    setBuscando(true);
    setErro(null);
    setOrigem(null);
    try {
      const o = await obterJson(`${API}/janelas/${janelaId}/origem?${new URLSearchParams({ codigo: codigo.trim() }).toString()}`, OrigemEmbarqueSchema);
      setOrigem(o);
      setVolumes({});
    } catch (e) {
      setErro(mensagemDeFalha(e));
    } finally {
      setBuscando(false);
    }
  }
  const linhas = Object.entries(volumes)
    .map(([id, v]) => ({ id, v: Number(v) }))
    .filter((l) => Number.isInteger(l.v) && l.v > 0);
  const totalFull = origem?.occurrences.reduce((s, o) => s + (o.available ?? 0), 0) ?? 0;

  return (
    <div className="carga-novo" data-testid="carga-novo">
      <h3>Posição {String(posicao).padStart(2, '0')} livre</h3>
      {lotado && <p className="estado-erro">O veículo já tem {veiculo.capacity} paletes: capacidade completa.</p>}
      {semPosicao.length > 0 && (
        <div className="carga-bloco">
          <strong>Colocar aqui um palete já montado:</strong>
          <div className="acoes-linha">
            {semPosicao.map((p) => (
              <button key={p.id} type="button" className="botao-secundario botao-compacto" disabled={m.ocupado} onClick={() => aoUsarExistente(p)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!lotado && (
        <form
          className="carga-bloco"
          onSubmit={(e) => {
            e.preventDefault();
            if (origem === null) return;
            const n = numero.trim() === '' ? null : Number(numero);
            const corpo =
              tipo === 'FULL'
                ? {
                    kind: 'FULL',
                    number: n,
                    position: posicao,
                    sourcePalletId: origem.palletId,
                  }
                : {
                    kind: 'FRACIONADO',
                    number: n,
                    position: posicao,
                    lines: linhas.map((l) => ({
                      occurrence: {
                        kind: origem.occurrences.find((o) => o.id === l.id)?.kind ?? 'CONTEUDO',
                        id: l.id,
                      },
                      volumes: l.v,
                    })),
                  };
            void m
              .executar(
                `criar:${veiculo.id}:${JSON.stringify(corpo)}`,
                'POST',
                `${API}/veiculos/${veiculo.id}/paletes`,
                corpo,
                `Palete alocado na posição ${String(posicao)} (planejada; confirme no carregamento).`,
              )
              .then((c) => {
                if (c) aoCriado();
              });
          }}
        >
          <strong>Novo palete de embarque</strong>
          <div className="carga-tipo" role="radiogroup" aria-label="Tipo">
            <label>
              <input type="radio" name="tipo" checked={tipo === 'FULL'} onChange={() => setTipo('FULL')} /> FULL (palete inteiro, sai fechado)
            </label>
            <label>
              <input type="radio" name="tipo" checked={tipo === 'FRACIONADO'} onChange={() => setTipo('FRACIONADO')} /> Fracionado (NFs e volumes separados)
            </label>
          </div>
          <label className="campo">
            <span className="campo-rotulo">Número no veículo (vazio = {String(proximo).padStart(2, '0')})</span>
            <input type="number" min={1} max={veiculo.capacity} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder={String(proximo)} data-testid="novo-numero" />
          </label>
          <div className="carga-busca-origem">
            <label className="campo">
              <span className="campo-rotulo">Palete de origem na praça</span>
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void buscar();
                  }
                }}
                placeholder="ex.: 256"
                data-testid="origem-codigo"
              />
            </label>
            <button type="button" className="botao-secundario" disabled={buscando || codigo.trim() === ''} onClick={() => void buscar()} data-testid="origem-buscar">
              {buscando ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
          {erro !== null && <p className="estado-erro">{erro}</p>}
          {origem !== null && (
            <div className="carga-origem" data-testid="carga-origem">
              <p>
                <strong>Palete {origem.code}</strong> · {origem.address ?? 'endereço não informado'}
                {!origem.onSite && <span className="marca-erro"> · fora da praça</span>}
                {origem.fullIn !== null && <span className="marca-erro"> · já sai FULL em {origem.fullIn}</span>}
              </p>
              <div className="carga-tabela-rolagem">
                <table className="janela-tabela">
                  <thead>
                    <tr>
                      <th>NF</th>
                      <th>Remetente</th>
                      <th className="numero">Base</th>
                      <th className="numero">Disponível</th>
                      {tipo === 'FRACIONADO' && <th className="numero">Neste palete</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {origem.occurrences.map((o) => (
                      <tr key={o.id}>
                        <td>
                          {o.documentType ?? ''} {o.documentNumber ?? 'sem número'}
                          {o.separatedHere > 0 && <span className="janela-base"> · {o.separatedHere} separado(s) nesta janela</span>}
                        </td>
                        <td>{o.sender ?? '—'}</td>
                        <td className="numero">{o.base ?? 'n/i'}</td>
                        <td className="numero">{o.available ?? 'n/i'}</td>
                        {tipo === 'FRACIONADO' && (
                          <td className="numero">
                            <input
                              type="number"
                              min={0}
                              max={o.available ?? 0}
                              disabled={o.available === null || o.available === 0}
                              value={volumes[o.id] ?? ''}
                              onChange={(e) =>
                                setVolumes({
                                  ...volumes,
                                  [o.id]: e.target.value,
                                })
                              }
                              aria-label={`Volumes da NF ${o.documentNumber ?? ''} neste palete`}
                              className="carga-input-volumes"
                              data-testid={`volumes-${o.documentNumber ?? o.id}`}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="campo-ajuda">
                {tipo === 'FULL'
                  ? `FULL leva todo o disponível do palete: ${String(totalFull)} volume(s). O palete sai fechado.`
                  : `Informe só os volumes realmente separados para este palete (${String(linhas.reduce((s, l) => s + l.v, 0))} no total). O restante continua na praça.`}
              </p>
              <button type="submit" className="botao-primario" disabled={m.ocupado || (tipo === 'FRACIONADO' ? linhas.length === 0 : totalFull === 0)} data-testid="alocar-palete">
                Alocar na posição {String(posicao).padStart(2, '0')}
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

function SituacaoEmissoes({ p }: { p: PaleteEmbarque }) {
  if (p.emissions.length === 0) return <p className="campo-ajuda">Nada impresso ainda.</p>;
  return (
    <ul className="carga-emissoes">
      {p.emissions.map((e) => (
        <li key={e.kind} className={e.outdated ? 'marca-erro' : undefined}>
          {e.kind === 'ETIQUETA' ? 'Etiqueta' : e.kind === 'ESPELHO' ? 'Espelho' : 'Lista de documentos'} {e.final ? 'final' : 'rascunho'} · rev. {e.revision ?? '—'} · {formatarDataHora(e.at)}
          {e.outdated ? ' — desatualizada: reemita' : ''}
        </li>
      ))}
    </ul>
  );
}

/** Detalhe do palete na visão da operação: conteúdo, posição, físico e impressões. */
function DetalhePalete({
  p,
  veiculo,
  dados,
  podePreparar,
  m,
  aoMover,
  aoEmitir,
  aoEditarEspelho,
}: {
  p: PaleteEmbarque;
  veiculo: VeiculoCarga;
  dados: CargaJanela;
  podePreparar: boolean;
  m: Mut;
  aoMover: () => void;
  aoEmitir: (kind: TipoEmissao, final: boolean) => void;
  aoEditarEspelho: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [vol, setVol] = useState<Record<string, string>>({});
  const [destino, setDestino] = useState('');
  const [motivo, setMotivo] = useState('');
  const montagem = veiculo.state === 'MONTAGEM' && podePreparar && p.state === 'ATIVO';
  const outros = dados.vehicles.filter((v) => v.id !== veiculo.id && v.state === 'MONTAGEM');
  const assin = `${p.id}:${String(p.version)}`;
  return (
    <div className="carga-detalhe" data-testid="carga-detalhe">
      <h3>
        {p.label} <span className="carga-tipo-selo">{p.kind === 'FULL' ? 'FULL' : 'Fracionado'}</span>
      </h3>
      <p className="carga-identidade" data-testid="carga-identidade">
        {p.identity}
      </p>
      <dl className="carga-dados">
        <div>
          <dt>Posição</dt>
          <dd>
            {p.position === null
              ? 'Sem posição'
              : `${String(p.position).padStart(2, '0')} · ${p.positionConfirmed ? `confirmada ${p.positionConfirmedAt ? formatarDataHora(p.positionConfirmedAt) : ''}` : 'planejada'}`}
          </dd>
        </div>
        <div>
          <dt>Origem</dt>
          <dd>{p.kind === 'FULL' ? `Palete ${p.sourcePalletCode ?? ''} inteiro` : [...new Set(p.lines.map((l) => l.sourcePalletCode))].map((c) => `Palete ${c}`).join(', ')}</dd>
        </div>
        <div>
          <dt>Conteúdo</dt>
          <dd>
            {p.lines.length} NF(s) · {p.volumes} volume(s) · revisão {p.revision}
          </dd>
        </div>
        <div>
          <dt>Físico</dt>
          <dd className={p.physical.checked ? 'marca-ok' : 'marca-pendente'}>
            {p.physical.checked
              ? `✓ Conferido${p.physical.by ? ` por ${p.physical.by}` : ''}${p.physical.at ? ` em ${formatarDataHora(p.physical.at)}` : ''}`
              : p.physical.revision !== null
                ? `○ Conteúdo mudou (rev. ${String(p.revision)}): conferir de novo`
                : '○ Pendente'}
          </dd>
        </div>
        <div>
          <dt>Documentação</dt>
          <dd className={p.docs.state === 'CONFERIDA' ? 'marca-ok' : p.docs.state === 'COM_PROBLEMA' ? 'marca-erro' : 'marca-pendente'}>{textoDocs(p)}</dd>
        </div>
      </dl>
      {p.state === 'CANCELADO' && <p className="estado-erro">Cancelado: {p.cancelReason}</p>}

      {!editando ? (
        <table className="janela-tabela carga-linhas">
          <thead>
            <tr>
              <th>NF</th>
              <th>Remetente</th>
              <th>Origem</th>
              <th className="numero">Vol.</th>
              <th>Docs</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.documentType ?? ''} {l.documentNumber ?? 'sem nº'}
                </td>
                <td>{l.sender ?? '—'}</td>
                <td>{l.sourcePalletCode}</td>
                <td className="numero">{l.volumes}</td>
                <td>{l.doc === null ? 'Pendente' : l.doc.state === 'CONFERIDO' ? '✓' : l.doc.state === 'FALTANTE' ? 'Faltante' : 'Divergente'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const lines = p.lines
              .map((l) => ({
                occurrence: l.occurrence,
                volumes: Number(vol[l.id] ?? l.volumes),
              }))
              .filter((l) => l.volumes > 0);
            void m
              .executar(
                `linhas:${assin}:${JSON.stringify(lines)}`,
                'PUT',
                `${API}/paletes/${p.id}/linhas`,
                { expectedVersion: p.version, lines },
                'Conteúdo alterado: revisão nova (físico e documentação deste palete voltam a pendentes).',
              )
              .then((c) => {
                if (c) setEditando(false);
              });
          }}
        >
          <p className="campo-ajuda">Ajuste os volumes (0 tira a NF do palete). Para acrescentar NF de outro palete, crie um palete novo ou cancele e remonte.</p>
          {p.lines.map((l) => (
            <label key={l.id} className="campo carga-linha-edicao">
              <span className="campo-rotulo">
                {l.documentType ?? ''} {l.documentNumber ?? 'sem nº'} (palete {l.sourcePalletCode})
              </span>
              <input type="number" min={0} value={vol[l.id] ?? String(l.volumes)} onChange={(e) => setVol({ ...vol, [l.id]: e.target.value })} />
            </label>
          ))}
          <div className="acoes-linha">
            <button type="submit" className="botao-primario" disabled={m.ocupado}>
              Salvar conteúdo
            </button>
            <button type="button" className="botao-link" onClick={() => setEditando(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {montagem && (
        <div className="carga-acoes">
          <div className="acoes-linha">
            {p.position !== null && (
              <button
                type="button"
                className={p.positionConfirmed ? 'botao-secundario' : 'botao-primario'}
                disabled={m.ocupado}
                onClick={() =>
                  void m.executar(
                    `conf:${assin}:${String(!p.positionConfirmed)}`,
                    'POST',
                    `${API}/paletes/${p.id}/confirmacao`,
                    {
                      expectedVersion: p.version,
                      confirmed: !p.positionConfirmed,
                    },
                    p.positionConfirmed ? 'Confirmação desfeita: posição volta a planejada.' : 'Posição confirmada no carregamento.',
                  )
                }
                data-testid="confirmar-posicao"
              >
                {p.positionConfirmed ? 'Desfazer confirmação' : 'Confirmar posição carregada'}
              </button>
            )}
            {!p.physical.checked && (
              <button
                type="button"
                className="botao-primario"
                disabled={m.ocupado}
                onClick={() =>
                  void m.executar(
                    `fisico:${assin}`,
                    'POST',
                    `${API}/paletes/${p.id}/fisico`,
                    { expectedVersion: p.version, revision: p.revision },
                    'Físico conferido: o palete entrou na fila do administrativo.',
                  )
                }
                data-testid="fisico-conferido"
              >
                Físico conferido
              </button>
            )}
          </div>
          <div className="acoes-linha">
            <button type="button" className="botao-secundario botao-compacto" onClick={aoMover}>
              Mover no veículo
            </button>
            {p.position !== null && (
              <button
                type="button"
                className="botao-secundario botao-compacto"
                disabled={m.ocupado}
                onClick={() =>
                  void m.executar(`tirar:${assin}`, 'PUT', `${API}/paletes/${p.id}/posicao`, { expectedVersion: p.version, position: null }, `${p.label} sem posição (o número continua).`)
                }
              >
                Tirar da posição
              </button>
            )}
            {p.kind === 'FRACIONADO' ? (
              <button type="button" className="botao-secundario botao-compacto" onClick={() => setEditando(!editando)}>
                Ajustar NFs/volumes
              </button>
            ) : (
              <button
                type="button"
                className="botao-secundario botao-compacto"
                disabled={m.ocupado}
                onClick={() =>
                  void m.executar(`recarregar:${assin}`, 'POST', `${API}/paletes/${p.id}/recarregar-origem`, { expectedVersion: p.version }, 'Conteúdo do FULL conferido com o palete de origem.')
                }
              >
                Recarregar do palete de origem
              </button>
            )}
          </div>
          {outros.length > 0 && (
            <div className="acoes-linha">
              <select value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Transferir para">
                <option value="">Transferir para…</option>
                {outros.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} ({v.occupied}/{v.capacity})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="botao-secundario botao-compacto"
                disabled={destino === '' || m.ocupado}
                onClick={() =>
                  void m.executar(
                    `transferir:${assin}:${destino}`,
                    'POST',
                    `${API}/paletes/${p.id}/transferencia`,
                    { expectedVersion: p.version, vehicleId: destino },
                    'Palete transferido: reimprima etiqueta, espelho e lista de documentos com a identidade nova.',
                  )
                }
              >
                Transferir
              </button>
            </div>
          )}
        </div>
      )}

      <div className="carga-bloco">
        <strong>Impressão</strong>
        <SituacaoEmissoes p={p} />
        {podePreparar && p.state === 'ATIVO' && (
          <div className="acoes-linha">
            <button type="button" className="botao-secundario botao-compacto" disabled={m.ocupado} onClick={() => aoEmitir('ETIQUETA', true)} data-testid="imprimir-etiqueta">
              Etiqueta
            </button>
            <button type="button" className="botao-secundario botao-compacto" disabled={m.ocupado} onClick={() => aoEmitir('ESPELHO', false)}>
              Espelho (rascunho)
            </button>
            <button
              type="button"
              className="botao-secundario botao-compacto"
              disabled={m.ocupado || !p.physical.checked}
              onClick={() => aoEmitir('ESPELHO', true)}
              title={p.physical.checked ? 'Via do cliente' : 'Depois do físico conferido'}
              data-testid="imprimir-espelho-final"
            >
              Espelho final (via cliente)
            </button>
            <button type="button" className="botao-link botao-compacto" onClick={aoEditarEspelho} data-testid="editar-layout-espelho">
              Layout do espelho
            </button>
          </div>
        )}
      </div>

      {montagem && (
        <details className="carga-bloco">
          <summary>Cancelar este palete</summary>
          <label className="campo">
            <span className="campo-rotulo">Motivo</span>
            <input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <button
            type="button"
            className="botao-secundario botao-perigo"
            disabled={m.ocupado || motivo.trim().length < 3}
            onClick={() =>
              void m.executar(`cancelar:${assin}`, 'POST', `${API}/paletes/${p.id}/cancelamento`, { expectedVersion: p.version, reason: motivo }, `${p.label} cancelado (histórico preservado).`)
            }
          >
            Cancelar palete
          </button>
        </details>
      )}
    </div>
  );
}

/** Visão do administrativo: fila por veículo (físico conferido primeiro) e abrir pelo número. */
function FilaAdm({ veiculo, selecionado, aoEscolher }: { veiculo: VeiculoCarga; selecionado: string | null; aoEscolher: (p: PaleteEmbarque) => void }) {
  const [busca, setBusca] = useState('');
  const lista = useMemo(() => {
    const ativos = veiculo.pallets.filter((p) => p.state === 'ATIVO');
    const ordem = {
      COM_PROBLEMA: 0,
      PENDENTE: 1,
      AGUARDANDO_FISICO: 3,
      CONFERIDA: 2,
    } as const;
    return ativos
      .filter(
        (p) =>
          busca.trim() === '' ||
          p.label.includes(busca.trim().toUpperCase()) ||
          String(p.number) === busca.trim().replace(/^0+/, '') ||
          p.lines.some((l) => (l.documentNumber ?? '').includes(busca.trim())),
      )
      .sort((a, b) => ordem[a.docs.state] - ordem[b.docs.state] || a.number - b.number);
  }, [veiculo, busca]);
  return (
    <div className="carga-fila" data-testid="fila-adm">
      <label className="campo">
        <span className="campo-rotulo">Abrir palete pelo número ou NF</span>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="ex.: 7 ou P07" data-testid="adm-busca" />
      </label>
      <table className="janela-tabela">
        <thead>
          <tr>
            <th>Palete</th>
            <th>Posição</th>
            <th className="numero">NFs</th>
            <th className="numero">Volumes</th>
            <th>Físico</th>
            <th>Documentação</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((p) => (
            <tr key={p.id} className={selecionado === p.id ? 'carga-fila-selecionada' : undefined}>
              <td>
                <button type="button" className="botao-link" onClick={() => aoEscolher(p)} data-testid={`adm-${p.label}`}>
                  {p.label}
                </button>{' '}
                <span className="janela-base">{p.kind === 'FULL' ? 'FULL' : 'Frac.'}</span>
              </td>
              <td>{p.position === null ? '—' : String(p.position).padStart(2, '0')}</td>
              <td className="numero">{p.lines.length}</td>
              <td className="numero">{p.volumes}</td>
              <td className={p.physical.checked ? 'marca-ok' : 'marca-pendente'}>{p.physical.checked ? '✓ Conferido' : 'Pendente'}</td>
              <td className={p.docs.state === 'CONFERIDA' ? 'marca-ok' : p.docs.state === 'COM_PROBLEMA' ? 'marca-erro' : 'marca-pendente'}>{textoDocs(p)}</td>
            </tr>
          ))}
          {lista.length === 0 && (
            <tr>
              <td colSpan={6}>Nenhum palete.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Checklist documental do administrativo: por NF, conferido / faltante / divergente com observação. */
function ChecklistDocumentos({ p, veiculo, podeDocs, m, aoImprimir }: { p: PaleteEmbarque; veiculo: VeiculoCarga; podeDocs: boolean; m: Mut; aoImprimir: () => void }) {
  const [notas, setNotas] = useState<Record<string, string>>({});
  const pode = podeDocs && p.physical.checked && veiculo.state === 'MONTAGEM' && p.state === 'ATIVO';
  const marcar = (linhaId: string, state: SituacaoDocEmbarque) => {
    const note = (notas[linhaId] ?? '').trim();
    void m.executar(
      `doc:${p.id}:${String(p.revision)}:${linhaId}:${state}:${note}`,
      'POST',
      `${API}/paletes/${p.id}/documentos`,
      {
        revision: p.revision,
        lineId: linhaId,
        state,
        note: note === '' ? null : note,
      },
      'Conferência do documento registrada.',
    );
  };
  return (
    <div className="carga-detalhe" data-testid="checklist-docs">
      <h3>
        {p.label} · documentos <span className="carga-tipo-selo">{p.kind === 'FULL' ? 'FULL' : 'Fracionado'}</span>
      </h3>
      <p className="carga-identidade">{p.identity}</p>
      <p className={p.physical.checked ? 'marca-ok' : 'marca-pendente'}>
        {p.physical.checked ? `✓ Físico conferido (revisão ${String(p.revision)})` : '○ Aguardando a operação conferir o físico: a documentação espera.'}
      </p>
      <ul className="carga-checklist">
        {p.lines.map((l) => (
          <li key={l.id} className={`carga-check carga-check--${l.doc?.state.toLowerCase() ?? 'pendente'}`}>
            <div className="carga-check-nf">
              <strong>
                {l.documentType ?? ''} {l.documentNumber ?? 'sem nº'}
              </strong>{' '}
              · {l.volumes} vol (referência) · {l.sender ?? '—'}
              {l.delivery ? ` · DLV ${l.delivery}` : ''}
            </div>
            <div className="carga-check-situacao">
              {l.doc === null
                ? 'Pendente'
                : `${l.doc.state === 'CONFERIDO' ? '✓ Conferido' : l.doc.state === 'FALTANTE' ? '✗ Faltante' : '≠ Divergente'} · ${l.doc.by} · ${formatarDataHora(l.doc.at)}${l.doc.note ? ` · ${l.doc.note}` : ''}`}
            </div>
            {pode && (
              <div className="acoes-linha">
                <input
                  placeholder="Observação (obrigatória se faltante/divergente)"
                  value={notas[l.id] ?? ''}
                  maxLength={300}
                  onChange={(e) => setNotas({ ...notas, [l.id]: e.target.value })}
                  aria-label={`Observação da NF ${l.documentNumber ?? ''}`}
                />
                <button type="button" className="botao-secundario botao-compacto" disabled={m.ocupado} onClick={() => marcar(l.id, 'CONFERIDO')} data-testid={`doc-ok-${l.documentNumber ?? l.id}`}>
                  Conferido
                </button>
                <button type="button" className="botao-secundario botao-compacto" disabled={m.ocupado || (notas[l.id] ?? '').trim() === ''} onClick={() => marcar(l.id, 'FALTANTE')}>
                  Faltante
                </button>
                <button type="button" className="botao-secundario botao-compacto" disabled={m.ocupado || (notas[l.id] ?? '').trim() === ''} onClick={() => marcar(l.id, 'DIVERGENTE')}>
                  Divergente
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="campo-ajuda">O administrativo não altera quantidades: os volumes são os da conferência física (referência). Mudança de conteúdo pela operação abre revisão nova.</p>
      <div className="carga-bloco">
        <SituacaoEmissoes p={p} />
        <button type="button" className="botao-secundario" disabled={m.ocupado} onClick={aoImprimir} data-testid="imprimir-docs">
          Imprimir lista de documentos
        </button>
      </div>
    </div>
  );
}
