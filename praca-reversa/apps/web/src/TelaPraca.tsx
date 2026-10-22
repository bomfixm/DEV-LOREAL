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
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecurso } from './api/use-recurso';
import { IconeAtualizar, IconeBusca, IconeFechar, IconeLista, IconeMais, IconeMapa, IconeQr } from './components/Icones';
import { CRITERIOS_VAZIOS, gravarMemoriaBusca, lerMemoriaBusca } from './features/busca/estado';

import { PainelBusca } from './features/busca/PainelBusca';
import { ocupacaoSemPalete, type MargensMapa, type VisaoMapa } from './features/mapa/controlador-mapa';
import { DetalhePosicao } from './features/mapa/DetalhePosicao';
import { Indicadores } from './features/mapa/Indicadores';
import { ControlesMapa } from './features/mapa/ControlesMapa';
import { mostrarListaPaletesNoMapa } from './features/mapa/configuracao';
import { FiltroMapa } from './features/mapa/FiltroMapa';
import { Legenda } from './features/mapa/Legenda';
import { MapaPraca, type MapaPracaHandle } from './features/mapa/MapaPraca';
import { DetalhePalete } from './features/paletes/DetalhePalete';
import { estadoExibido } from './features/paletes/estados';
import { agruparPaletes, filtroAtivo, FILTRO_VAZIO, normalizar, urlFiltro, type Filtro } from './features/paletes/filtro';
import { ListaPaletes, type EstadoFiltro } from './features/paletes/ListaPaletes';
import { PaleteAvulso } from './features/paletes/PaleteAvulso';
import { AjudaTarefa } from './features/ajuda/AjudaTarefa';
import { JanelaModal, JanelaPalete } from './features/paletes/JanelaPalete';
import { ConferenciaTabela } from './features/conteudos/ConferenciaTabela';
import { textoResultadoConferencia } from './features/conteudos/textos-resultado';
import { CartaoValidacao } from './features/conteudos/CartaoValidacao';
import type { Navegar } from './rotas';

// Leitor da câmera carregado só quando aberto (etapa 09).
const LeituraPraca = lazy(() => import('./features/camera/LeituraPraca').then((m) => ({ default: m.LeituraPraca })));

/** Espaço dos controles sobrepostos ao mapa (seletor de zona, botões, legenda e selo); compactos desde a etapa 2. */
const MARGENS_LARGO: MargensMapa = { topo: 64, direita: 64, base: 52, esquerda: 16 };
const MARGENS_COMPACTO: MargensMapa = { topo: 76, direita: 60, base: 48, esquerda: 8 };
/** Controles sobre o mapa no computador, medidos a cada enquadramento (a área principal fica livre deles). */
const SOBREPOSTOS_MAPA = ':scope > .controles-mapa, :scope > .ferramentas-mapa, :scope > .legenda, :scope > .marca-demo, :scope > .aviso-atualizacao--mapa';

type Aba = 'mapa' | 'lista' | 'busca';
/** Conteúdo do painel lateral no computador (sem a coluna da lista, 'busca' = resultados flutuantes sobre o mapa). */
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
  return `${palete.code} selecionado. ${local}. ${estadoExibido(palete).rotulo.texto}${palete.activeCountId !== null ? '; em conferência' : ''}.`;
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

  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [avulsoId, setAvulsoId] = useState<string | null>(null);
  /** Posição escolhida no mapa sem palete por cima (detalhe da posição, "palete livre"). */
  const [posicaoId, setPosicaoId] = useState<string | null>(null);
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
  // Etapa 3: escolher um palete (ou posição) abre a janela sobre a página; fechar mantém a seleção e o mapa como estavam.
  const [detalheAberto, setDetalheAberto] = useState(false);
  // Leitura por câmera (etapa 09) e nova montagem da busca com o produto lido.
  const [leitorAberto, setLeitorAberto] = useState(false);
  const [geracaoBusca, setGeracaoBusca] = useState(0);
  const [visao, setVisao] = useState<VisaoMapa | null>(null);
  const [anuncio, setAnuncio] = useState('');
  // Conferência em tabela sobre o mapa: fecha só depois de gravar; o mapa (zoom, posição, filtros) não muda.
  const [conferindo, setConferindo] = useState<PaleteResumo | null>(null);
  const [avisoResultado, setAvisoResultado] = useState<string | null>(null);
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

  // Rota → seleção: link, QR ou busca selecionam o palete pedido (centralizado,
  // com a janela do palete aberta). Palete fora da praça carregada abre a
  // janela do detalhe avulso. Seleção feita aqui mesmo já está na rota.
  if (paleteRota !== rotaVista) {
    setRotaVista(paleteRota);
    if (paleteRota === null) {
      setAvulsoId(null);
    } else if (paleteRota !== selecionadoId) {
      const palete = porId.get(paleteRota);
      if (palete) {
        setSelecionadoId(palete.id);
        setAvulsoId(null);
        setDetalheAberto(true);
        if (palete.positionId !== null) setPedidoCentralizar((p) => ({ id: palete.id, n: (p?.n ?? 0) + 1 }));
      } else {
        setSelecionadoId(null);
        setAvulsoId(paleteRota);
        setDetalheAberto(true);
      }
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
  // Lista de paletes: aba do celular ou, no computador, coluna controlada por `mostrarListaPaletesNoMapa`.
  const comLista = compacto || mostrarListaPaletesNoMapa;
  const grupos = useMemo(() => (comLista ? agruparPaletes(itensLista, layout) : []), [comLista, itensLista, layout]);
  const modo: ModoPainel = compacto ? (aba === 'busca' ? 'busca' : 'paletes') : modoLargo;
  const idsFiltro = useMemo(() => (ativo ? new Set(itensLista.map((p) => p.id)) : null), [ativo, itensLista]);
  // O mapa destaca o resultado do painel em uso: filtro da lista ou paletes da busca.
  const idsVisiveis = modo === 'busca' ? destaqueBusca : idsFiltro;
  // O painel de busca é montado na primeira vez que é aberto e depois continua montado (guarda o resultado).
  const [buscaMontada, setBuscaMontada] = useState(modo === 'busca' || !compacto);
  if ((modo === 'busca' || !compacto) && !buscaMontada) setBuscaMontada(true);
  const semEndereco = useMemo(() => (comLista ? paletes.filter((p) => p.positionId === null).length : 0), [comLista, paletes]);
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
  const posicaoEscolhida = posicaoId === null ? null : (layout?.positions.find((p) => p.id === posicaoId) ?? null);
  const posicoesLivres = useMemo(
    () => (layout?.positions ?? []).filter((p) => ocupacaoSemPalete(p) === 'livre' && !paletes.some((pa) => pa.positionId === p.id)),
    [layout, paletes],
  );
  const { carga: cargaDetalhe, recarregar: recarregarDetalhe } = useRecurso(
    selecionado === null ? null : urlPalete(selecionado.id),
    PaleteDetalheSchema,
    versaoDetalhe,
  );

  useEffect(() => {
    if (pedidoCentralizar === null) return;
    mapaRef.current?.centralizar(pedidoCentralizar.id);
  }, [pedidoCentralizar]);

  useEffect(() => {
    // Volta de outra página para uma entrada que estava com o detalhe aberto: a tela recomeça no
    // resumo/mapa, então a marca antiga sai do histórico (senão "Voltar ao mapa" a reencontraria).
    if (estadoHistoricoTemDetalhe()) window.history.replaceState(null, '');
    const aoVoltar = () => {
      setDetalheAberto(estadoHistoricoTemDetalhe());
    };
    window.addEventListener('popstate', aoVoltar);
    return () => {
      window.removeEventListener('popstate', aoVoltar);
    };
  }, []);

  // Foco: a janela começa no título, contém o foco e o devolve a quem a abriu (JanelaModal).

  /** Escolher um palete abre a janela dele (a seleção fica marcada no mapa ao fechar). */
  function selecionar(palete: PaleteResumo) {
    setSelecionadoId(palete.id);
    setAvulsoId(null);
    setPosicaoId(null);
    setAnuncio(textoSelecao(palete));
    aoNavegar({ tipo: 'palete', id: palete.id }, { substituir: true });
    abrirDetalhe();
  }

  /** Abre a janela. No celular entra no histórico: o voltar do aparelho fecha a janela. */
  function abrirDetalhe() {
    if (detalheAberto) return;
    setDetalheAberto(true);
    if (compacto) window.history.pushState({ prDetalhe: true }, '');
  }

  /** Fecha a janela; seleção, posição, zoom e pesquisa ficam como estavam. */
  function fecharDetalhe() {
    if (compacto && estadoHistoricoTemDetalhe()) window.history.back();
    else setDetalheAberto(false);
  }

  function escolherNoMapa(id: string) {
    const palete = porId.get(id);
    if (palete) selecionar(palete);
  }

  /** Posição escolhida no mapa: com palete registrado abre o palete; sem palete, o detalhe da posição. */
  function escolherPosicao(id: string) {
    const ocupante = paletes.find((p) => p.positionId === id);
    if (ocupante) {
      selecionar(ocupante);
      return;
    }
    setSelecionadoId(null);
    setAvulsoId(null);
    setPosicaoId(id);
    aoNavegar({ tipo: 'praca' }, { substituir: true });
    abrirDetalhe();
  }

  /** Lista e busca: escolher um palete (clique) centraliza e abre a janela dele; digitar não abre nada. */
  function escolherNaLista(id: string) {
    const palete = porId.get(id);
    if (!palete) return;
    selecionar(palete);
    if (palete.positionId !== null) mapaRef.current?.centralizar(id);
    if (compacto) setAba('mapa');
  }

  /** Resultado da busca com palete: centraliza e mostra o resumo do palete certo (fora da praça carregada, pela rota). */
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

  /** Enter na pesquisa do cabeçalho com o link/ID do QR (leitor-teclado): abre o palete. */
  function confirmarTextoBusca(texto: string): boolean {
    const id = extrairIdPalete(texto);
    if (id === null) return false;
    if (porId.has(id)) escolherNaLista(id);
    else aoNavegar({ tipo: 'palete', id });
    return true;
  }

  /** "Centralizar" (atalho C, controle do mapa ou janela): fecha a janela e centraliza o palete. */
  function centralizarSelecionado() {
    if (selecionado?.positionId == null) return;
    if (detalheAberto) fecharDetalhe();
    mapaRef.current?.centralizar(selecionado.id);
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
  /** Endereço da janela: o real da posição (confirmado) ou o informado no inventário; sem código técnico de posição. */
  const enderecoJanela = (p: PaleteResumo): string | null => {
    const posicao = p.positionId === null ? undefined : layout?.positions.find((x) => x.id === p.positionId);
    if (posicao?.address?.state === 'CONFIRMADO') return posicao.address.text;
    if (p.positionId === null && p.informedAddress) return `${p.informedAddress} (informado no inventário)`;
    return null;
  };
  const aberto = (p: PaleteResumo) => p.flowState !== 'EXPEDIDO';
  const idsEtiquetas = ativo && itensLista.length > 0 && itensLista.length <= LIMITE_ETIQUETAS ? itensLista.map((p) => p.id) : null;

  const painelBusca = buscaMontada && (
    <PainelBusca
      key={geracaoBusca}
      chaveMemoria={chaveMemoria}
      permissoes={permissoes}
      versao={versaoDados}
      oculto={modo !== 'busca'}
      campoNoTopo={!compacto}
      aoAtivar={() => {
        if (!compacto) setModoLargo('busca');
      }}
      aoConfirmarTexto={confirmarTextoBusca}
      aoEscolherPalete={escolherNaBusca}
      aoAbrirImportacao={(id) => {
        aoNavegar({ tipo: 'importacao', id });
      }}
      aoAbrirInventario={(id) => {
        aoNavegar({ tipo: 'inventario', id });
      }}
      aoMudarDestaque={aoMudarDestaque}
    />
  );
  const notaLayout =
    layout === null
      ? null
      : `${layout.name}: ${String(layout.positions.length)} posições desenhadas${layout.schematic ? ', geometria esquemática' : ''}. Capacidade total ${layout.totalCapacity === null ? 'ainda desconhecida' : `confirmada: ${String(layout.totalCapacity)}`}. Uma posição desenhada não comprova ocupação.`;

  return (
    <>
      {!compacto && (
        <Indicadores
          paletes={paletes}
          posicoesLivres={posicoesLivres.length}
          noFiltro={idsVisiveis === null ? null : idsVisiveis.size}
          livres={comLista ? null : posicoesLivres.slice(0, 30).map((p) => ({ id: p.id, texto: p.address?.state === 'CONFIRMADO' ? `${p.address.text} · ${p.code}` : p.code }))}
          aoEscolherLivre={escolherPosicao}
          extra={
            pode('validacao.consultar') ? (
              <CartaoValidacao
                versao={versaoDetalhe + versaoDados}
                aoAbrir={() => {
                  aoNavegar({ tipo: 'validacao' });
                }}
              />
            ) : null
          }
        />
      )}
      {compacto && pode('validacao.consultar') && (
        <CartaoValidacao
          compacto
          versao={versaoDetalhe + versaoDados}
          aoAbrir={() => {
            aoNavegar({ tipo: 'validacao' });
          }}
        />
      )}
      {!comLista && falhaAtualizacao !== null && (
        <div className="estado-erro aviso-atualizacao aviso-atualizacao--mapa" role="alert">
          <p>Não foi possível atualizar a praça: {falhaAtualizacao}</p>
          <button type="button" className="botao-secundario botao-compacto" onClick={aoRepetirAtualizacao}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      <main
        className="principal"
        data-aba={aba}
        data-detalhe={detalheAberto ? 'aberto' : 'fechado'}
        data-lista={comLista ? 'sim' : 'nao'}
      >
        {comLista ? (
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
            {compacto && modo === 'paletes' && pode('palete.cadastrar') && (
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
          {posicoesLivres.length > 0 && (
            <details className="posicoes-livres" data-testid="posicoes-livres" open={!compacto}>
              <summary>
                <span className="selo-livre">PALETE LIVRE</span> {posicoesLivres.length} posição(ões) com desocupação confirmada
              </summary>
              <ul>
                {posicoesLivres.slice(0, 30).map((p) => (
                  <li key={p.id}>
                    <button type="button" className="botao-link" onClick={() => { escolherPosicao(p.id); }}>
                      {p.address?.state === 'CONFIRMADO' ? `${p.address.text} · ${p.code}` : p.code}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {notaLayout !== null && (
            <p className="nota-layout" data-testid="nota-layout">
              {notaLayout}
            </p>
          )}
          </div>
          {painelBusca}
        </aside>
        ) : (
          // Sem a coluna: resultados da busca do cabeçalho flutuam sobre o mapa só enquanto a busca está em uso.
          <aside className="busca-flutuante" aria-labelledby="titulo-busca-flutuante" hidden={modo !== 'busca'} data-testid="busca-flutuante">
            <div className="busca-flutuante-topo">
              <h2 id="titulo-busca-flutuante" className="painel-titulo">
                Resultados da busca
              </h2>
              <button
                type="button"
                className="botao-icone"
                aria-label="Fechar resultados da busca"
                title="Fechar resultados (a pesquisa continua no cabeçalho)"
                onClick={() => {
                  setModoLargo('paletes');
                }}
                data-testid="fechar-busca"
              >
                <IconeFechar />
              </button>
            </div>
            {painelBusca}
          </aside>
        )}

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
                // Computador: o enquadramento mede os controles sobrepostos na hora (coluna de ferramentas, legenda, selo).
                sobrepostos={compacto ? undefined : SOBREPOSTOS_MAPA}
                aoSelecionar={escolherNoMapa}
                aoEscolherPosicao={escolherPosicao}
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
                aoFocarPrincipal={() => mapaRef.current?.focarPrincipal()}
                aoCentralizar={centralizarSelecionado}
                aoFocarArea={(codigo) => mapaRef.current?.focarElemento(codigo)}
                extra={
                  comLista ? null : (
                    <>
                    <FiltroMapa
                      filtro={filtro}
                      estadoFiltro={estadoFiltro}
                      quantidade={itensLista.length}
                      aoMudarFiltro={setFiltro}
                      aoRepetirFiltro={repetirFiltro}
                      aoConfirmarBusca={confirmarBusca}
                      aoImprimirResultado={
                        pode('etiqueta.imprimir') && idsEtiquetas !== null
                          ? () => {
                              aoNavegar({ tipo: 'etiquetas', ids: idsEtiquetas });
                            }
                          : null
                      }
                    />
                    <button
                      type="button"
                      className="botao-mapa botao-mapa--texto"
                      onClick={() => {
                        setLeitorAberto(true);
                      }}
                      title="Ler o QR da etiqueta com a câmera"
                      data-testid="ler-codigo-praca"
                    >
                      <IconeQr />
                      <span>Ler QR</span>
                    </button>
                    </>
                  )
                }
              />
              <Legenda nota={comLista ? null : notaLayout} />
            </>
          )}
          {praca.scope.demo && (
            <p className="marca-demo" aria-hidden="true">
              Demonstração · dados fictícios
            </p>
          )}
        </section>


        <p className="visualmente-oculto" aria-live="polite" data-testid="anuncio">
          {anuncio}
        </p>
      </main>

      {/* Conferência em tabela (21 out. 2026): fecha só depois da gravação confirmada e volta à janela do palete. */}
      {conferindo !== null && (
        <JanelaModal
          titulo={<>Conferir volumes · Palete {conferindo.code}</>}
          subtitulo={enderecoJanela(conferindo) ?? 'Endereço não informado'}
          aoFechar={() => {
            setConferindo(null);
          }}
          testId="janela-conferencia-volumes"
          classe="conf-janela"
        >
          <ConferenciaTabela
            key={conferindo.id}
            paleteId={conferindo.id}
            paleteCodigo={conferindo.code}
            aoCancelar={() => {
              setConferindo(null);
            }}
            aoConcluir={(r) => {
              setConferindo(null);
              setAvisoResultado(textoResultadoConferencia(r));
              dadosAlterados();
              setDetalheAberto(true);
            }}
            aoReconferido={(texto) => {
              setConferindo(null);
              setAvisoResultado(texto);
              dadosAlterados();
              setDetalheAberto(true);
            }}
          />
        </JanelaModal>
      )}
      {avisoResultado !== null && (
        <div className="aviso-resultado" role="status" data-testid="aviso-resultado">
          <p>{avisoResultado}</p>
          <button
            type="button"
            className="botao-secundario botao-icone"
            aria-label="Fechar aviso"
            onClick={() => {
              setAvisoResultado(null);
            }}
          >
            <IconeFechar />
          </button>
        </div>
      )}
      {/* Janela sobre a página (etapa 3): nenhuma coluna do grid é reservada para o palete. */}
      {detalheAberto && selecionado !== null && conferindo === null && (
        <JanelaPalete
          key={selecionado.id}
          palete={selecionado}
          endereco={enderecoJanela(selecionado)}
          permissoes={permissoes}
          versao={versaoDetalhe}
          carga={cargaDetalhe}
          aoFechar={fecharDetalhe}
          aoCentralizar={centralizarSelecionado}
          aoConferirVolumes={
            pode('conferencia.registrar') && aberto(selecionado)
              ? () => {
                  setAvisoResultado(null);
                  setConferindo(selecionado);
                }
              : null
          }
          aoAlterado={(texto) => {
            dadosAlterados();
            setAvisoResultado(texto);
          }}
          aoAbrirValidacao={pode('validacao.consultar') ? () => { aoNavegar({ tipo: 'validacao' }); } : null}
          aoImportarBipagem={pode('palete.cadastrar') && aberto(selecionado) ? () => { aoNavegar({ tipo: 'bipagem', id: selecionado.id }); } : null}
          aoRegistrarConteudo={pode('palete.cadastrar') && aberto(selecionado) ? () => { aoNavegar({ tipo: 'novo-conteudo', palete: selecionado.id }); } : null}
          aoImprimir={pode('etiqueta.imprimir') ? () => { aoNavegar({ tipo: 'etiquetas', ids: [selecionado.id] }); } : null}
          detalhesCompletos={
            <DetalhePalete
              embutido
              resumo={selecionado}
              carga={cargaDetalhe}
              local={selecionado.positionId === null ? null : (localPorPosicao.get(selecionado.positionId) ?? null)}
              consultadoEm={praca.consultedAt}
              compacto={compacto}
              permissoes={permissoes}
              tituloRef={tituloDetalheRef}
              aoCentralizar={centralizarSelecionado}
              aoFechar={fecharDetalhe}
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
          }
        />
      )}
      {detalheAberto && selecionado === null && avulsoId !== null && (
        <JanelaModal titulo={null} rotulo="Palete" aoFechar={fecharDetalhe} testId="janela-avulso">
          <PaleteAvulso
            key={avulsoId}
            id={avulsoId}
            compacto={compacto}
            permissoes={permissoes}
            consultadoEm={praca.consultedAt}
            tituloRef={tituloDetalheRef}
            aoFechar={fecharDetalhe}
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
        </JanelaModal>
      )}
      {detalheAberto && selecionado === null && avulsoId === null && posicaoEscolhida !== null && (
        <JanelaModal titulo={null} rotulo={`Posição ${posicaoEscolhida.code}`} aoFechar={fecharDetalhe} testId="janela-posicao">
          <DetalhePosicao
            key={posicaoEscolhida.id}
            posicao={posicaoEscolhida}
            local={localPorPosicao.get(posicaoEscolhida.id) ?? null}
            compacto={compacto}
            podeRegistrar={pode('movimento.registrar')}
            aoReceberPalete={
              pode('palete.cadastrar')
                ? () => {
                    aoNavegar({ tipo: 'novo-palete', posicao: posicaoEscolhida.id });
                  }
                : null
            }
            tituloRef={tituloDetalheRef}
            aoFechar={fecharDetalhe}
            aoAlterado={dadosAlterados}
          />
        </JanelaModal>
      )}

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
