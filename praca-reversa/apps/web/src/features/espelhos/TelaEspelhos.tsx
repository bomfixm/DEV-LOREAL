import { API_PREFIXO, LoteEspelhosSchema, PracaSchema, type LoteEspelhos } from '@praca-reversa/contracts';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { EstadoTela } from '../../components/Moldura';
import { IconeImprimir, IconeMais, IconeMenos } from '../../components/Icones';
import type { MargensMapa } from '../mapa/controlador-mapa';
import { MapaPraca, type MapaPracaHandle } from '../mapa/MapaPraca';
import '../mapa/escolher-no-mapa.css';
import { formatarDataHora } from '../../utils/datas';
import { EditorLayout } from './EditorLayout';
import { FolhaEspelho } from './FolhaEspelho';
import { carregarFontes } from './fontes';
import { aplicarLayout, layoutsDosPaletes } from './layout-armazenamento';
import { assinaturaLayout, LAYOUT_PADRAO, MODELOS_DO_SISTEMA, type LayoutEspelho } from './layout-modelo';
import { alternarGrupo, indiceDoMapa, ordenarParaImpressao } from './selecao';
import { usePaginacao } from './usePaginacao';
import { medirFolha, problemasDaFolha } from './verificacao';
import './espelhos.css';
import './editor-layout.css';

const MARGENS: MargensMapa = { topo: 12, direita: 56, base: 12, esquerda: 12 };

interface Verificacao {
  folhas: number;
  erros: { codigo: string; texto: string }[];
  avisos: { codigo: string; texto: string }[];
}

/**
 * Folhas da prévia/impressão: cada palete com o layout aplicado a ele. A
 * paginação espera a medição das linhas; depois, cada folha é conferida
 * (campo fora do papel, conteúdo cortado, sobreposição) antes de liberar a impressão.
 */
const Folhas = memo(function Folhas({ lote, layouts, aoVerificar }: { lote: LoteEspelhos; layouts: ReadonlyMap<string, LayoutEspelho>; aoVerificar: (v: Verificacao | null) => void }) {
  const entradas = useMemo(() => lote.items.map((p) => ({ chave: `${lote.generatedAt}|${p.id}`, palete: p, layout: layouts.get(p.id) ?? LAYOUT_PADRAO })), [lote, layouts]);
  const { pronto, paginas, medidor } = usePaginacao(entradas);
  const raiz = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const quadro = requestAnimationFrame(() => {
      if (!pronto || raiz.current === null) { aoVerificar(null); return; }
      const folhas = [...raiz.current.querySelectorAll<HTMLElement>('.espelho-folha')];
      const v: Verificacao = { folhas: folhas.length, erros: [], avisos: [] };
      let k = 0;
      for (const e of entradas) {
        const pg = paginas.get(e.chave);
        for (const nota of pg?.grandes ?? []) v.erros.push({ codigo: e.palete.code, texto: `Tabela de notas: a nota ${nota.documentNumber ?? nota.delivery ?? ''} não cabe na altura da tabela.` });
        for (let n = 0; n < (pg?.folhas.length ?? 1); n += 1) {
          const el = folhas[k];
          k += 1;
          if (el === undefined) continue;
          for (const p of problemasDaFolha(medirFolha(el), e.layout.margem)) (p.gravidade === 'erro' ? v.erros : v.avisos).push({ codigo: e.palete.code, texto: p.texto });
        }
      }
      aoVerificar(v);
    });
    return () => { cancelAnimationFrame(quadro); };
  }, [pronto, paginas, entradas, aoVerificar]);
  return <div className="espelhos-folhas" ref={raiz} data-pronto={pronto ? 'sim' : 'nao'}>
    {entradas.flatMap((e) => {
      const folhas = paginas.get(e.chave)?.folhas ?? [[]];
      return folhas.map((linhas, n) => <FolhaEspelho
        key={`${e.palete.id}-${String(n)}`}
        contexto={{ palete: e.palete, pagina: n, totalPaginas: folhas.length, escopo: lote.scope, geradoEm: lote.generatedAt }}
        linhas={linhas}
        layout={e.layout}
      />);
    })}
    {medidor}
  </div>;
});

const nomeDoLayout = (l: LayoutEspelho): string => MODELOS_DO_SISTEMA.find((m) => assinaturaLayout(m.layout) === assinaturaLayout(l))?.nome ?? 'personalizado';

export function TelaEspelhos({ aoVoltar }: { aoVoltar: () => void }) {
  const praca = useRecurso(`${API_PREFIXO}/praca`, PracaSchema);
  const mapa = useRef<MapaPracaHandle>(null);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [pedido, setPedido] = useState<string | null>(null);
  const previa = useRecurso(pedido, LoteEspelhosSchema);
  const [editando, setEditando] = useState(false);
  const [recemAplicados, setRecemAplicados] = useState<{ lote: string; mapa: ReadonlyMap<string, LayoutEspelho> } | null>(null);
  const [verificacao, setVerificacao] = useState<Verificacao | null>(null);
  const [avisoAplicado, setAvisoAplicado] = useState<string | null>(null);
  const [impressao, setImpressao] = useState<{ lote: LoteEspelhos; layouts: ReadonlyMap<string, LayoutEspelho> } | null>(null);
  const dados = praca.carga?.estado === 'pronto' ? praca.carga.dados : null;
  const layout = dados?.layout ?? null;
  const indice = useMemo(() => (dados === null || layout === null ? null : indiceDoMapa(layout, dados.pallets)), [dados, layout]);
  const lote = previa.carga?.estado === 'pronto' ? previa.carga.dados : null;
  // Layout aplicado de cada palete do lote (lido de novo depois de "Aplicar").
  const lidos = useMemo(() => (lote === null ? null : layoutsDosPaletes(lote.items.map((p) => p.id))), [lote]);
  const layouts = lote !== null && recemAplicados?.lote === lote.generatedAt ? recemAplicados.mapa : lidos;
  const aoVerificar = useCallback((v: Verificacao | null) => { setVerificacao(v); }, []);

  // Fim da impressão: volta a mostrar a prévia viva.
  useEffect(() => {
    const fim = () => { setImpressao(null); };
    window.addEventListener('afterprint', fim);
    return () => { window.removeEventListener('afterprint', fim); };
  }, []);
  useEffect(() => {
    if (impressao === null) return;
    let ativo = true;
    // Fontes carregadas e folhas desenhadas com a versão capturada antes de abrir a impressão.
    void carregarFontes([...impressao.layouts.values()]).then(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => { if (ativo) window.print(); }));
    });
    return () => { ativo = false; };
  }, [impressao]);

  if (praca.carga?.estado !== 'pronto' || dados === null) return <EstadoTela carga={praca.carga} titulo="Não foi possível carregar o mapa" aoTentarNovamente={praca.recarregar} />;
  const alterar = (novo: Set<string>) => {
    setMarcados(novo);
    setPedido(null);
    setEditando(false);
    setAvisoAplicado(null);
  };
  const grupo = (ids: readonly string[] | undefined) => {
    alterar(alternarGrupo(marcados, ids ?? []));
  };
  const total = marcados.size;
  const folhasLote = impressao?.lote ?? lote;
  const layoutsLote = impressao?.layouts ?? layouts;
  const usados = layouts === null ? [] : [...new Set([...layouts.values()].map(nomeDoLayout))];
  const podeImprimir = lote !== null && lote.items.length > 0 && verificacao !== null && verificacao.erros.length === 0 && impressao === null;
  return <main className="principal principal--pagina tela-espelhos" data-testid="tela-espelhos"><div className="pagina-conteudo">
    <header className="pagina-topo nao-imprimir"><h2>Imprimir espelhos</h2>
      <p>Escolha no mapa: clique no <strong>nome da rua</strong> para marcar a rua inteira, no <strong>F##</strong> para marcar a fileira ou num <strong>palete</strong> para marcar só ele. Clique de novo para desmarcar. O que está marcado fica <strong>branco</strong>.</p>
      <div className="acoes-linha"><button type="button" className="botao-secundario" onClick={aoVoltar}>Voltar ao mapa</button><button type="button" className="botao-secundario" onClick={() => { alterar(new Set()); praca.recarregar(); }}>Atualizar paletes</button></div>
    </header>
    <div className="escolha-mapa nao-imprimir" data-testid="espelhos-mapa">
      <div className="escolha-mapa-area">
        {layout === null ? <p className="estado-vazio">Esta praça ainda não tem layout cadastrado.</p> : <>
          <MapaPraca
            ref={mapa}
            layout={layout}
            paletes={dados.pallets}
            selecionadoId={null}
            idsVisiveis={null}
            margens={MARGENS}
            selecaoMultipla={marcados}
            aoSelecionar={(id) => { if (indice?.elegiveis.has(id) === true) grupo([id]); }}
            aoEscolherBloco={(codigo) => { grupo(indice?.porBloco.get(codigo)); }}
            aoEscolherFileira={(id) => { grupo(indice?.porFileira.get(id)); }}
            aoMudarVisao={() => undefined}
          />
          <div className="escolha-mapa-zoom">
            <button type="button" className="botao-secundario botao-icone" onClick={() => mapa.current?.ampliar()} aria-label="Aproximar"><IconeMais /></button>
            <button type="button" className="botao-secundario botao-icone" onClick={() => mapa.current?.reduzir()} aria-label="Afastar"><IconeMenos /></button>
          </div>
        </>}
      </div>
      <div className="espelhos-barra">
        <p data-testid="espelhos-contagem"><strong>{total}</strong> palete(s) marcado(s){total > 250 ? ' — o limite é 250 por impressão: desmarque alguma rua ou fileira.' : '.'}</p>
        <button type="button" className="botao-link" disabled={total === 0} onClick={() => { alterar(new Set()); }}>Limpar seleção</button>
        <button
          type="button"
          className="botao-primario"
          disabled={total === 0 || total > 250 || previa.carga?.estado === 'carregando'}
          onClick={() => {
            if (layout === null) return;
            const ids = ordenarParaImpressao([...marcados], layout, dados.pallets);
            setPedido(`${API_PREFIXO}/espelhos?${new URLSearchParams({ ids: ids.join(',') }).toString()}`);
            previa.recarregar();
          }}
        >{previa.carga?.estado === 'carregando' ? 'Preparando…' : 'Gerar prévia'}</button>
      </div>
    </div>
    {previa.carga !== null && previa.carga.estado !== 'pronto' && <div className="nao-imprimir"><EstadoTela carga={previa.carga} titulo="Não foi possível gerar os espelhos" aoTentarNovamente={previa.recarregar} /></div>}
    {lote !== null && layouts !== null && <div className="espelhos-imprimir nao-imprimir" data-testid="espelhos-acoes">
      <p>{lote.items.length} espelho(s){verificacao === null ? ', preparando folhas…' : `, ${String(verificacao.folhas)} folha(s)`}. Gerado em {formatarDataHora(lote.generatedAt)}. Layout: <strong data-testid="espelhos-layout-usado">{usados.join(' + ')}</strong>.</p>
      {avisoAplicado !== null && <p className="espelhos-aplicado" role="status">{avisoAplicado}</p>}
      {verificacao !== null && verificacao.erros.length > 0 && <div className="espelhos-problemas" role="alert" data-testid="espelhos-problemas"><strong>Ajuste antes de imprimir — conteúdo sairia cortado:</strong><ul>{verificacao.erros.slice(0, 12).map((e, i) => <li key={i}>Espelho {e.codigo}: {e.texto}</li>)}</ul>{verificacao.erros.length > 12 && <p>e mais {verificacao.erros.length - 12}.</p>}</div>}
      {verificacao !== null && verificacao.avisos.length > 0 && <details className="espelhos-avisos"><summary>{verificacao.avisos.length} aviso(s) de alinhamento (não impedem a impressão)</summary><ul>{verificacao.avisos.slice(0, 20).map((e, i) => <li key={i}>Espelho {e.codigo}: {e.texto}</li>)}</ul></details>}
      <p>Use A4 paisagem, escala 100%, sem cabeçalho e rodapé do navegador. Para baixar, escolha “Salvar como PDF” na janela de impressão.</p>
      <div className="acoes-linha">
        <button type="button" className="botao-secundario" disabled={lote.items.length === 0} onClick={() => { setAvisoAplicado(null); setEditando(true); }} data-testid="espelhos-editar">Editar layout</button>
        <button type="button" className="botao-primario" disabled={!podeImprimir} onClick={() => { setImpressao({ lote, layouts }); }}><IconeImprimir /> Imprimir espelhos</button>
      </div>
    </div>}
    {folhasLote !== null && layoutsLote !== null && <Folhas lote={folhasLote} layouts={layoutsLote} aoVerificar={aoVerificar} />}
    {editando && lote !== null && layouts !== null && <EditorLayout
      lote={lote}
      aplicados={layouts}
      aoSair={() => { setEditando(false); }}
      aoAplicar={(ids, novo) => {
        aplicarLayout(ids, novo);
        setRecemAplicados({ lote: lote.generatedAt, mapa: layoutsDosPaletes(lote.items.map((p) => p.id)) });
        setEditando(false);
        setAvisoAplicado(`Layout aplicado a ${String(ids.length)} espelho(s) deste lote. Os demais paletes e o padrão do sistema não mudaram.`);
      }}
    />}
  </div></main>;
}
