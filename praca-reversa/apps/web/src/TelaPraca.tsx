import {
  API_PREFIXO,
  LIMITE_ETIQUETAS,
  ListaPaletesSchema,
  PaleteDetalheSchema,
  extrairIdPalete,
  type ListaPaletes as ListaDoServidor,
  type PaleteResumo,
  type Permissao,
  type Praca,
} from '@praca-reversa/contracts';
import { Suspense, lazy, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useRecurso } from './api/use-recurso';
import { IconeAtualizar, IconeBusca, IconeLista, IconeMais, IconeMapa } from './components/Icones';
import { CRITERIOS_VAZIOS, gravarMemoriaBusca, lerMemoriaBusca } from './features/busca/estado';

import { PainelBusca } from './features/busca/PainelBusca';
import type { MargensMapa, VisaoMapa } from './features/mapa/controlador-mapa';
import { ControlesMapa } from './features/mapa/ControlesMapa';
import { Legenda } from './features/mapa/Legenda';
import { MapaPraca, type MapaPracaHandle } from './features/mapa/MapaPraca';
import { DetalhePalete } from './features/paletes/DetalhePalete';
import { ROTULOS_CONFERENCIA } from './features/paletes/estados';
import { agruparPaletes, filtroAtivo, FILTRO_VAZIO, normalizar, urlFiltro, type Filtro } from './features/paletes/filtro';
import { ListaPaletes, type EstadoFiltro } from './features/paletes/ListaPaletes';
import { PaleteAvulso } from './features/paletes/PaleteAvulso';
import { AjudaTarefa } from './features/ajuda/AjudaTarefa';
import { ResumoSelecao } from './features/paletes/ResumoSelecao';
import type { Navegar } from './rotas';

// Leitor da câmera carregado só quando aberto (etapa 09).
const LeituraPraca = lazy(() => import('./features/camera/LeituraPraca').then((m) => ({ default: m.LeituraPraca })));

/** Altura aproximada do cartão de seleção no celular, para centralizar acima dele. */
const DESLOCAMENTO_RESUMO_PX = 190;

/** Espaço dos controles sobrepostos ao mapa (seletor de zona, botões, legenda e selo). */
const MARGENS_LARGO: MargensMapa = { topo: 84, direita: 144, base: 60, esquerda: 16 };
const MARGENS_COMPACTO: MargensMapa = { topo: 76, direita: 60, base: 48, esquerda: 8 };

type Aba = 'mapa' | 'lista' | 'busca';
/** Conteúdo do painel lateral no computador. */
type ModoPainel = 'paletes' | 'busca';

/** Espera depois da última tecla antes de consultar o filtro no servidor. */
const ESPERA_FILTRO_MS = 250;

function urlPalete(id: string): string {
  return `${API_PREFIXO}/paletes/${encodeURIComponent(id)}`;
}

function estadoHistoricoTemDetalhe(): boolean {
  const estado: unknown = window.history.state;
  return typeof estado === 'object' && estado !== null && 'prDetalhe' in estado;
}

function textoSelecao(palete: PaleteResumo): string {
  const local = palete.positionCode === null ? 'Sem posição registrada' : `Posição ${palete.positionCode}`;
  return `${palete.code} selecionado. ${local}. ${ROTULOS_CONFERENCIA[palete.countState].texto}${palete.activeCountId !== null ? '; em conferência' : ''}.`;
}

interface Props {
  praca: Praca;
  compacto: boolean;
  /** Palete pedido pela rota /paletes/<id> (link, QR ou busca). */
  paleteRota: string | null;
  permissoes: readonly Permissao[];
  /** Falha ao atualizar a praça depois de uma gravação (os dados exibidos são os anteriores). */
  falhaAtualizacao: string | null;
  aoRepetirAtualizacao: () => void;
  aoNavegar: Navegar;
  aoTrocarEscopo: (escopoId: string) => Promise<string | null>;
  /** Usuário + escopo (memória da busca). */
  chaveMemoria: string;
  /** Versão dos dados (aumenta depois de gravações): a busca consulta de novo. */
  versaoDados: number;
}

/**
 * Mapa, lista e detalhe da praça do escopo ativo. Mapa e lista mostram os
 * mesmos registros do banco; selecionar em um reflete no outro e na rota.
 */
export function TelaPraca({ praca, compacto, paleteRota, permissoes, falhaAtualizacao, aoRepetirAtualizacao, aoNavegar, aoTrocarEscopo, chaveMemoria, versaoDados }: Props) {
  const mapaRef = useRef<MapaPracaHandle>(null);
  const tituloDetalheRef = useRef<HTMLHeadingElement>(null);
  const verConteudoRef = useRef<HTMLButtonElement>(null);
  const retornoFocoRef = useRef<HTMLElement | null>(null);
  const detalheEstavaAberto = useRef(false);

  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [avulsoId, setAvulsoId] = useState<string | null>(null);
  const [rotaVista, setRotaVista] = useState<string | null>(null);
  const [pedidoCentralizar, setPedidoCentralizar] = useState<{ id: string; n: number } | null>(null);
  const [versaoDetalhe, setVersaoDetalhe] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>(FILTRO_VAZIO);
  const [filtroAplicado, setFiltroAplicado] = useState<Filtro>(FILTRO_VAZIO);
  const [ultimaLista, setUltimaLista] = useState<ListaDoServidor | null>(null);
  const [aba, setAba] = useState<Aba>('mapa');
  // A busca continua aberta ao voltar de outra página (memória da aba, por usuário e escopo).
  const [modoLargo, setModoLargo] = useState<ModoPainel>(() => (lerMemoriaBusca(chaveMemoria)?.ativo ? 'busca' : 'paletes'));
  const [destaqueBusca, setDestaqueBusca] = useState<ReadonlySet<string> | null>(null);
  const aoMudarDestaque = useCallback((ids: ReadonlySet<string> | null) => {
    setDestaqueBusca(ids);
  }, []);
  const [detalheAberto, setDetalheAberto] = useState(false);
  // Leitura por câmera (etapa 09) e nova montagem da busca com o produto lido.
  const [leitorAberto, setLeitorAberto] = useState(false);
  const [geracaoBusca, setGeracaoBusca] = useState(0);
  const [visao, setVisao] = useState<VisaoMapa | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const pode = (p: Permissao) => permissoes.includes(p);

  const { layout, pallets: paletes } = praca;
  const porId = useMemo(() => new Map(paletes.map((p) => [p.id, p])), [paletes]);
  const localPorPosicao = useMemo(() => {
    const fileiras = new Map((layout?.rows ?? []).map((f) => [f.id, f]));
    const areas = new Map((layout?.elements ?? []).map((e) => [e.code, e.operationalName ?? e.label]));
    return new Map(
      (layout?.positions ?? []).map((p) => {
        const fileira = fileiras.get(p.rowId);
        const area = fileira?.blockCode ? areas.get(fileira.blockCode) : undefined;
        // Endereço real só pela tabela de correspondência (confirmado ou proposto, nunca presumido).
        const endereco = p.address === null ? null : p.address.state === 'CONFIRMADO' ? `Endereço ${p.address.text}` : `Endereço proposto ${p.address.text} (a confirmar)`;
        const lado = fileira?.side === 'ESQUERDO' ? 'lado esquerdo' : fileira?.side === 'DIREITO' ? 'lado direito' : null;
        return [p.id, [endereco, fileira?.label, area, lado].filter(Boolean).join(' · ') || null];
      }),
    );
  }, [layout]);
  const areasNavegaveis = useMemo(
    () => (layout?.elements ?? []).filter((e) => e.kind === 'ZONA' || e.kind === 'BLOCO'),
    [layout],
  );

  // Rota → seleção: link, QR ou busca abrem o palete pedido (centralizado; no
  // celular, direto no detalhe). Seleção feita aqui mesmo já está na rota.
  if (paleteRota !== rotaVista) {
    setRotaVista(paleteRota);
    if (paleteRota === null) {
      setAvulsoId(null);
    } else if (paleteRota !== selecionadoId) {
      const palete = porId.get(paleteRota);
      if (palete) {
        setSelecionadoId(palete.id);
        setAvulsoId(null);
        if (palete.positionId !== null) setPedidoCentralizar((p) => ({ id: palete.id, n: (p?.n ?? 0) + 1 }));
      } else {
        setSelecionadoId(null);
        setAvulsoId(paleteRota);
      }
      if (compacto) setDetalheAberto(true);
    }
  }
  // Palete aberto pelo link antes de a praça recarregar: passa a ser seleção normal.
  if (avulsoId !== null && porId.has(avulsoId)) {
    const palete = porId.get(avulsoId);
    setAvulsoId(null);
    setSelecionadoId(avulsoId);
    if (palete?.positionId != null) setPedidoCentralizar((p) => ({ id: avulsoId, n: (p?.n ?? 0) + 1 }));
  }

  // Filtro consultado no servidor (validação e limite na API).
  useEffect(() => {
    const espera = setTimeout(() => {
      setFiltroAplicado(filtro);
    }, ESPERA_FILTRO_MS);
    return () => {
      clearTimeout(espera);
    };
  }, [filtro]);
  const ativo = filtroAtivo(filtroAplicado);
  const { carga: cargaFiltro, recarregar: repetirFiltro } = useRecurso(
    ativo ? urlFiltro(filtroAplicado) : null,
    ListaPaletesSchema,
  );
  if (cargaFiltro?.estado === 'pronto' && cargaFiltro.dados !== ultimaLista) setUltimaLista(cargaFiltro.dados);
  const itensLista = useMemo(() => (ativo ? (ultimaLista?.items ?? []) : paletes), [ativo, ultimaLista, paletes]);
  const grupos = useMemo(() => agruparPaletes(itensLista, layout), [itensLista, layout]);
  const modo: ModoPainel = compacto ? (aba === 'busca' ? 'busca' : 'paletes') : modoLargo;
  const idsFiltro = useMemo(() => (ativo ? new Set(itensLista.map((p) => p.id)) : null), [ativo, itensLista]);
  // O mapa destaca o resultado do painel em uso: filtro da lista ou paletes da busca.
  const idsVisiveis = modo === 'busca' ? destaqueBusca : idsFiltro;
  // O painel de busca é montado na primeira vez que é aberto e depois continua montado (guarda o resultado).
  const [buscaMontada, setBuscaMontada] = useState(modo === 'busca');
  if (modo === 'busca' && !buscaMontada) setBuscaMontada(true);
  const semEndereco = useMemo(() => paletes.filter((p) => p.positionId === null).length, [paletes]);
  const aguardandoFiltro = filtro !== filtroAplicado && (filtroAtivo(filtro) || ativo);
  const estadoFiltro: EstadoFiltro =
    !ativo && !aguardandoFiltro
      ? { estado: 'inativo' }
      : aguardandoFiltro || cargaFiltro?.estado === 'carregando'
        ? { estado: 'filtrando' }
        : cargaFiltro?.estado === 'erro'
          ? { estado: 'erro', mensagem: cargaFiltro.mensagem }
          : { estado: 'pronto', total: ultimaLista?.total ?? 0, truncado: ultimaLista?.truncated ?? false };

  const selecionado = selecionadoId === null ? null : (porId.get(selecionadoId) ?? null);
  const { carga: cargaDetalhe, recarregar: recarregarDetalhe } = useRecurso(
    selecionado === null ? null : urlPalete(selecionado.id),
    PaleteDetalheSchema,
    versaoDetalhe,
  );

  const deslocamento = useEffectEvent(() => (compacto && !detalheAberto ? DESLOCAMENTO_RESUMO_PX : 0));
  useEffect(() => {
    if (pedidoCentralizar === null) return;
    mapaRef.current?.centralizar(pedidoCentralizar.id, { deslocamentoInferiorPx: deslocamento() });
  }, [pedidoCentralizar]);

  useEffect(() => {
    const aoVoltar = () => {
      setDetalheAberto(estadoHistoricoTemDetalhe());
    };
    window.addEventListener('popstate', aoVoltar);
    return () => {
      window.removeEventListener('popstate', aoVoltar);
    };
  }, []);

  // Foco: título ao abrir o detalhe no celular; retorno ao ponto de origem ao fechar.
  useEffect(() => {
    if (!compacto) return;
    if (detalheAberto) {
      tituloDetalheRef.current?.focus();
    } else if (detalheEstavaAberto.current) {
      const destino = retornoFocoRef.current?.isConnected ? retornoFocoRef.current : verConteudoRef.current;
      destino?.focus();
    }
    detalheEstavaAberto.current = detalheAberto;
  }, [detalheAberto, compacto]);

  function selecionar(palete: PaleteResumo) {
    setSelecionadoId(palete.id);
    setAvulsoId(null);
    setAnuncio(textoSelecao(palete));
    aoNavegar({ tipo: 'palete', id: palete.id }, { substituir: true });
  }

  function abrirDetalhe() {
    retornoFocoRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDetalheAberto(true);
    window.history.pushState({ prDetalhe: true }, '');
  }

  function fecharDetalhe() {
    if (estadoHistoricoTemDetalhe()) window.history.back();
    else setDetalheAberto(false);
  }

  function escolherNoMapa(id: string) {
    const palete = porId.get(id);
    if (palete) selecionar(palete);
  }

  function escolherNaLista(id: string) {
    const palete = porId.get(id);
    if (!palete) return;
    selecionar(palete);
    if (palete.positionId !== null) {
      mapaRef.current?.centralizar(id, { deslocamentoInferiorPx: compacto ? DESLOCAMENTO_RESUMO_PX : 0 });
      if (compacto) setAba('mapa');
    } else if (compacto) {
      abrirDetalhe();
    }
  }

  /** Resultado da busca com palete: centraliza e abre o palete certo (fora da praça carregada, pela rota). */
  function escolherNaBusca(id: string) {
    if (porId.has(id)) escolherNaLista(id);
    else aoNavegar({ tipo: 'palete', id });
  }

  /** Enter na busca: link/ID do QR abre o palete; código exato (ou resultado único) seleciona. */
  function confirmarBusca(texto: string) {
    const id = extrairIdPalete(texto);
    if (id !== null) {
      aoNavegar({ tipo: 'palete', id });
      return;
    }
    const chave = normalizar(texto);
    const exato = itensLista.find((p) => normalizar(p.code) === chave) ?? (itensLista.length === 1 ? itensLista[0] : undefined);
    if (exato) escolherNaLista(exato.id);
  }

  function centralizarSelecionado() {
    if (selecionado?.positionId == null) return;
    if (compacto && detalheAberto) fecharDetalhe();
    mapaRef.current?.centralizar(selecionado.id, { deslocamentoInferiorPx: compacto ? DESLOCAMENTO_RESUMO_PX : 0 });
  }

  function limparSelecao() {
    setSelecionadoId(null);
    setAvulsoId(null);
    setAnuncio('Seleção removida.');
    aoNavegar({ tipo: 'praca' }, { substituir: true });
  }

  function trocarAba(nova: Aba) {
    if (detalheAberto) fecharDetalhe();
    setAba(nova);
  }

  function dadosAlterados() {
    setVersaoDetalhe((v) => v + 1);
    aoRepetirAtualizacao();
  }

  const bloqueioCentralizar =
    selecionado === null
      ? 'Selecione um palete para centralizar.'
      : selecionado.positionId === null
        ? 'Palete sem posição: não aparece no mapa.'
        : null;
  const mostrarDetalhe = !compacto || detalheAberto;
  const idsEtiquetas = ativo && itensLista.length > 0 && itensLista.length <= LIMITE_ETIQUETAS ? itensLista.map((p) => p.id) : null;

  return (
    <>
      <main className="principal" data-aba={aba} data-detalhe={detalheAberto ? 'aberto' : 'fechado'}>
        <aside className="painel-lista" aria-labelledby="titulo-lista" hidden={compacto && aba === 'mapa'} data-modo={modo}>
          {!compacto && (
            <div className="alternar-painel" role="group" aria-label="Conteúdo do painel">
              <button type="button" aria-pressed={modo === 'paletes'} onClick={() => { setModoLargo('paletes'); }} data-testid="painel-paletes">
                <IconeLista />
                Paletes
              </button>
              <button type="button" aria-pressed={modo === 'busca'} onClick={() => { setModoLargo('busca'); }} data-testid="painel-busca-botao">
                <IconeBusca />
                Buscar conteúdo
              </button>
            </div>
          )}
          <div className="painel-lista-topo">
            <h2 id="titulo-lista" className="painel-titulo">
              {modo === 'busca' ? 'Buscar produtos, paletes e documentos' : 'Paletes'}
            </h2>
            {modo === 'paletes' && pode('palete.cadastrar') && (
              <button
                type="button"
                className="botao-primario botao-compacto"
                onClick={() => {
                  aoNavegar({ tipo: 'novo-palete' });
                }}
              >
                <IconeMais />
                Novo palete
              </button>
            )}
          </div>
          <AjudaTarefa tarefa="consultar" />
          {falhaAtualizacao !== null && (
            <div className="estado-erro aviso-atualizacao" role="alert">
              <p>Não foi possível atualizar a praça: {falhaAtualizacao}</p>
              <button type="button" className="botao-secundario" onClick={aoRepetirAtualizacao}>
                <IconeAtualizar />
                Tentar novamente
              </button>
            </div>
          )}
          <div className="painel-modo" hidden={modo !== 'paletes'}>
          <ListaPaletes
            grupos={grupos}
            total={paletes.length}
            semEndereco={semEndereco}
            filtro={filtro}
            estadoFiltro={estadoFiltro}
            aoRepetirFiltro={repetirFiltro}
            selecionadoId={selecionadoId}
            aoMudarFiltro={setFiltro}
            aoEscolher={escolherNaLista}
            aoConfirmarBusca={confirmarBusca}
            aoLerCodigo={() => {
              setLeitorAberto(true);
            }}
            aoImprimirResultado={
              pode('etiqueta.imprimir') && idsEtiquetas !== null
                ? () => {
                    aoNavegar({ tipo: 'etiquetas', ids: idsEtiquetas });
                  }
                : null
            }
          />
          </div>
          {buscaMontada && (
          <PainelBusca
            key={geracaoBusca}
            chaveMemoria={chaveMemoria}
            permissoes={permissoes}
            versao={versaoDados}
            oculto={modo !== 'busca'}
            aoEscolherPalete={escolherNaBusca}
            aoAbrirImportacao={(id) => {
              aoNavegar({ tipo: 'importacao', id });
            }}
            aoMudarDestaque={aoMudarDestaque}
          />
          )}
        </aside>

        <section className="area-mapa" aria-label="Mapa da praça">
          {layout === null ? (
            <div className="estado-vazio estado-tela" data-testid="sem-layout">
              <p>Nenhum layout ativo neste escopo. Os paletes aparecem somente na lista.</p>
              {pode('layout.configurar') && (
                <button
                  type="button"
                  className="botao-secundario"
                  onClick={() => {
                    aoNavegar({ tipo: 'layout' });
                  }}
                >
                  Configurar layout
                </button>
              )}
            </div>
          ) : (
            <>
              <MapaPraca
                ref={mapaRef}
                layout={layout}
                paletes={paletes}
                selecionadoId={selecionadoId}
                idsVisiveis={idsVisiveis}
                margens={compacto ? MARGENS_COMPACTO : MARGENS_LARGO}
                aoSelecionar={escolherNoMapa}
                aoMudarVisao={setVisao}
              />
              <ControlesMapa
                podeAmpliar={visao === null || visao.zoom < visao.zoomMaximo - 0.001}
                podeReduzir={visao === null || visao.zoom > visao.zoomMinimo + 0.001}
                bloqueioCentralizar={bloqueioCentralizar}
                areas={areasNavegaveis}
                aoAmpliar={() => mapaRef.current?.ampliar()}
                aoReduzir={() => mapaRef.current?.reduzir()}
                aoVisaoGeral={() => mapaRef.current?.visaoGeral()}
                aoCentralizar={centralizarSelecionado}
                aoFocarArea={(codigo) => mapaRef.current?.focarElemento(codigo)}
              />
              <Legenda />
            </>
          )}
          {praca.scope.demo && (
            <p className="marca-demo" aria-hidden="true">
              Demonstração · dados fictícios
            </p>
          )}
          {compacto && selecionado !== null && !detalheAberto && (
            <ResumoSelecao
              palete={selecionado}
              verConteudoRef={verConteudoRef}
              aoVerConteudo={abrirDetalhe}
              aoCentralizar={centralizarSelecionado}
              aoFechar={limparSelecao}
            />
          )}
        </section>

        {mostrarDetalhe && (
          <aside
            className="painel-detalhe"
            aria-label="Detalhe do palete"
            onKeyDown={(evento) => {
              if (compacto && evento.key === 'Escape') fecharDetalhe();
            }}
          >
            {selecionado !== null ? (
              <DetalhePalete
                resumo={selecionado}
                carga={cargaDetalhe}
                local={selecionado.positionId === null ? null : (localPorPosicao.get(selecionado.positionId) ?? null)}
                consultadoEm={praca.consultedAt}
                compacto={compacto}
                permissoes={permissoes}
                tituloRef={tituloDetalheRef}
                aoCentralizar={centralizarSelecionado}
                aoFechar={compacto ? fecharDetalhe : limparSelecao}
                aoRecarregar={recarregarDetalhe}
                aoImprimir={() => {
                  aoNavegar({ tipo: 'etiquetas', ids: [selecionado.id] });
                }}
                aoAbrirConferencia={(id) => {
                  aoNavegar({ tipo: 'conferencia', id });
                }}
                aoMovimentar={(acao) => {
                  aoNavegar({ tipo: acao, id: selecionado.id });
                }}
                aoAlterado={dadosAlterados}
              />
            ) : avulsoId !== null ? (
              <PaleteAvulso
                key={avulsoId}
                id={avulsoId}
                compacto={compacto}
                permissoes={permissoes}
                consultadoEm={praca.consultedAt}
                tituloRef={tituloDetalheRef}
                aoFechar={compacto ? fecharDetalhe : limparSelecao}
                aoImprimir={() => {
                  aoNavegar({ tipo: 'etiquetas', ids: [avulsoId] });
                }}
                aoAbrirConferencia={(id) => {
                  aoNavegar({ tipo: 'conferencia', id });
                }}
                aoMovimentar={(acao) => {
                  aoNavegar({ tipo: acao, id: avulsoId });
                }}
                aoAlterado={aoRepetirAtualizacao}
                aoTrocarEscopo={aoTrocarEscopo}
              />
            ) : (
              <div className="estado-vazio detalhe-vazio" data-testid="detalhe-vazio">
                <p>Selecione um palete no mapa ou na lista para ver o conteúdo, ou use "Buscar conteúdo" para achar um produto pelo SKU, código de barras, lote ou documento.</p>
                <p>Paletes ainda não conferidos aparecem com conteúdo desconhecido.</p>
                {layout !== null && (
                  <p data-testid="nota-layout">
                    {layout.name}: {layout.positions.length} posições desenhadas
                    {layout.schematic ? ', geometria esquemática' : ''}. Capacidade total{' '}
                    {layout.totalCapacity === null ? 'ainda desconhecida' : `confirmada: ${String(layout.totalCapacity)}`}. Uma
                    posição desenhada não comprova ocupação.
                  </p>
                )}
              </div>
            )}
          </aside>
        )}

        <p className="visualmente-oculto" aria-live="polite" data-testid="anuncio">
          {anuncio}
        </p>
      </main>

      {compacto && (
        <nav className="abas" aria-label="Visualização">
          <button
            type="button"
            className="aba"
            aria-pressed={aba === 'mapa' && !detalheAberto}
            onClick={() => {
              trocarAba('mapa');
            }}
          >
            <IconeMapa />
            Mapa
          </button>
          <button
            type="button"
            className="aba"
            aria-pressed={aba === 'lista' && !detalheAberto}
            onClick={() => {
              trocarAba('lista');
            }}
          >
            <IconeLista />
            Lista ({paletes.length})
          </button>
          <button
            type="button"
            className="aba"
            aria-pressed={aba === 'busca' && !detalheAberto}
            onClick={() => {
              trocarAba('busca');
            }}
            data-tutorial="aba-busca"
          >
            <IconeBusca />
            Busca
          </button>
        </nav>
      )}
      {leitorAberto && (
        <Suspense fallback={null}>
        <LeituraPraca
          aoFechar={() => {
            setLeitorAberto(false);
          }}
          aoAbrirPalete={(id) => {
            setLeitorAberto(false);
            if (porId.has(id)) escolherNaLista(id);
            else aoNavegar({ tipo: 'palete', id });
          }}
          aoBuscarProduto={
            pode('palete.consultar')
              ? (texto) => {
                  setLeitorAberto(false);
                  gravarMemoriaBusca(chaveMemoria, { criterios: { ...CRITERIOS_VAZIOS, texto, campo: 'SKU' }, pagina: 1, escolhido: null, ativo: true });
                  setGeracaoBusca((g) => g + 1);
                  setBuscaMontada(true);
                  if (compacto) trocarAba('busca');
                  else setModoLargo('busca');
                }
              : null
          }
        />
        </Suspense>
      )}
    </>
  );
}
