import { memo, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as PointerEventReact, type ReactNode } from 'react';
import { paraEndereco } from '../../base';
import { textoFantasma, type DocumentoEspelho, type LinhaTabela } from './conteudo-espelho';
import { carregarFontes } from './fontes';
import { blocoDe, camposDe, cssDaFonte, NOME_CAMPO, nomeDoItem, type BlocoLayout, type ItemId, type LayoutEspelho } from './layout-modelo';
import './espelhos.css';

/**
 * Uma folha do espelho desenhada a partir do layout (mm/pt). É o mesmo
 * componente na prévia, no editor e na impressão (praça e embarque): o que se
 * vê é o que sai no PDF. Elementos do editor (contorno, alças) só existem com
 * `edicao` e ficam fora da impressão.
 */
export type ModoGesto = 'mover' | 'largura-esquerda' | 'largura-direita' | 'altura';
export interface EdicaoFolha {
  /** Itens selecionados (campos e textos livres); as alças só aparecem com um item só. */
  selecionados: ReadonlySet<ItemId>;
  comProblema: ReadonlySet<ItemId>;
  aoPressionar: (id: ItemId, modo: ModoGesto, evento: PointerEventReact<HTMLElement>) => void;
  aoFocar: (id: ItemId) => void;
}

const estiloTexto = (b: Pick<BlocoLayout, 'estilo'>): CSSProperties => ({
  fontFamily: cssDaFonte(b.estilo.fonte),
  fontSize: `${String(b.estilo.tamanho)}pt`,
  fontWeight: b.estilo.negrito ? 700 : 400,
  textAlign: b.estilo.alinhamento === 'esquerda' ? 'left' : b.estilo.alinhamento === 'centro' ? 'center' : 'right',
});
const posicao = (b: Pick<BlocoLayout, 'x' | 'y' | 'largura' | 'altura'>, comAltura: boolean): CSSProperties => ({
  left: `${String(b.x)}mm`,
  top: `${String(b.y)}mm`,
  width: `${String(b.largura)}mm`,
  ...(comAltura && b.altura !== null ? { height: `${String(b.altura)}mm` } : {}),
});

/** Tabela do espelho (bloco único). Usada na folha e na medição das linhas. */
export function TabelaEspelho({ layout, documento, linhas }: { layout: LayoutEspelho; documento: DocumentoEspelho; linhas: readonly LinhaTabela[] }) {
  const t = layout.tabela;
  const n = documento.cabecalho.length;
  const classe = `ef-tabela ef-tabela--cab-${t.cabecalho} ef-tabela--${t.linhas}`;
  const celula: CSSProperties = { paddingTop: `${String(t.espacamento)}mm`, paddingBottom: `${String(t.espacamento)}mm` };
  return <table className={classe} style={estiloTexto(blocoDe(layout, 'tabela'))} data-conteudo="">
    <colgroup>{documento.cabecalho.map((h, i) => <col key={h} style={{ width: `${String(t.colunas[i] ?? 100 / n)}%` }} />)}</colgroup>
    <thead><tr>{documento.cabecalho.map((h) => <th key={h} style={celula}>{h}</th>)}</tr></thead>
    <tbody>{linhas.length === 0
      ? <tr><td colSpan={n} style={celula}>{documento.vazio}</td></tr>
      : linhas.map((l) => <tr key={l.id} className={l.total === true ? 'ef-total' : l.destaque === true ? 'ef-diferenca' : undefined}>{l.celulas.map((v, i) => <td key={i} style={celula} colSpan={l.total === true && i === 0 ? n - (l.celulas.length - 1) : undefined}>{v}</td>)}</tr>)}</tbody>
  </table>;
}

interface PropsFolha {
  documento: DocumentoEspelho;
  pagina: number;
  totalPaginas: number;
  linhas: readonly LinhaTabela[];
  layout: LayoutEspelho;
  edicao?: EdicaoFolha;
  refFolha?: (el: HTMLElement | null) => void;
}

function propsDeEdicao(edicao: EdicaoFolha | undefined, id: ItemId, nome: string): Record<string, unknown> {
  if (edicao === undefined) return {};
  const selecionado = edicao.selecionados.has(id);
  return {
    tabIndex: 0,
    role: 'button',
    'aria-label': `${nome}${selecionado ? ' (selecionado)' : ''}`,
    'aria-pressed': selecionado,
    onPointerDown: (e: PointerEventReact<HTMLElement>) => { edicao.aoPressionar(id, 'mover', e); },
    onFocus: () => { edicao.aoFocar(id); },
  };
}

function Alcas({ edicao, id, altura }: { edicao: EdicaoFolha | undefined; id: ItemId; altura: boolean }) {
  if (edicao?.selecionados.size !== 1 || !edicao.selecionados.has(id)) return null;
  return <>
    <span className="ef-alca ef-alca--esquerda" aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); edicao.aoPressionar(id, 'largura-esquerda', e); }} />
    <span className="ef-alca ef-alca--direita" aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); edicao.aoPressionar(id, 'largura-direita', e); }} />
    {altura && <span className="ef-alca ef-alca--base" aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); edicao.aoPressionar(id, 'altura', e); }} />}
  </>;
}

export function FolhaEspelho({ documento, pagina, totalPaginas, linhas, layout, edicao, refFolha }: PropsFolha) {
  const blocos: ReactNode[] = [];
  for (const campo of camposDe(layout)) {
    const b = blocoDe(layout, campo);
    let fantasma = false;
    let conteudo: ReactNode;
    if (campo === 'tabela') {
      conteudo = <TabelaEspelho layout={layout} documento={documento} linhas={linhas} />;
    } else if (campo === 'divisoria') {
      if (!b.visivel && edicao === undefined) continue;
      fantasma = !b.visivel;
      conteudo = <div className="ef-linha" />;
    } else {
      if (!b.visivel && edicao === undefined) continue;
      const texto = documento.texto(campo, pagina, totalPaginas);
      fantasma = !b.visivel;
      let rotulo = '';
      let valor: string;
      if (texto === null) {
        const exemplo = edicao === undefined ? null : textoFantasma(campo);
        if (exemplo === null) continue;
        valor = exemplo;
        fantasma = true;
      } else {
        rotulo = b.rotulo ? texto.rotulo : '';
        valor = b.rotulo || texto.semRotulo === undefined ? texto.valor : texto.semRotulo;
      }
      conteudo = <div data-conteudo="">{rotulo !== '' && <span className="ef-rotulo">{rotulo}</span>}<span className={`ef-valor ef-valor--${campo}`}>{valor}</span></div>;
    }
    const selecionado = edicao?.selecionados.has(campo) === true;
    const classe = ['ef-bloco', `ef-bloco--${campo}`, fantasma ? 'ef-bloco--fantasma' : '', selecionado ? 'ef-bloco--selecionado' : '', edicao?.comProblema.has(campo) === true ? 'ef-bloco--problema' : ''].filter((c) => c !== '').join(' ');
    const comAltura = campo === 'tabela' || campo === 'divisoria';
    const estilo: CSSProperties = { ...posicao(b, comAltura), ...(comAltura ? {} : estiloTexto(b)) };
    blocos.push(<div
      key={campo}
      className={classe}
      style={estilo}
      data-campo={fantasma ? undefined : campo}
      data-campo-editor={campo}
      {...propsDeEdicao(edicao, campo, NOME_CAMPO[campo])}
    >
      {conteudo}
      <Alcas edicao={edicao} id={campo} altura={campo === 'tabela'} />
    </div>);
  }
  // Textos livres: texto puro (sem HTML), quebra de linha preservada; vazio não é impresso.
  for (const t of layout.textos) {
    const vazio = t.texto.trim() === '';
    if (vazio && edicao === undefined) continue;
    const nome = nomeDoItem(layout, t.id);
    const selecionado = edicao?.selecionados.has(t.id) === true;
    const classe = ['ef-bloco', 'ef-bloco--texto', vazio ? 'ef-bloco--fantasma' : '', selecionado ? 'ef-bloco--selecionado' : '', edicao?.comProblema.has(t.id) === true ? 'ef-bloco--problema' : ''].filter((c) => c !== '').join(' ');
    blocos.push(<div
      key={t.id}
      className={classe}
      style={{ ...posicao({ ...t, altura: null }, false), ...estiloTexto(t) }}
      data-campo={vazio ? undefined : t.id}
      data-nome={nome}
      data-campo-editor={t.id}
      {...propsDeEdicao(edicao, t.id, nome)}
    >
      <div data-conteudo="" className="ef-texto-livre">{vazio ? '(texto vazio)' : t.texto}</div>
      <Alcas edicao={edicao} id={t.id} altura={false} />
    </div>);
  }
  return <section className={`espelho-folha${edicao === undefined ? '' : ' espelho-folha--edicao'}`} ref={refFolha} aria-label={`Espelho ${documento.codigo}, página ${String(pagina + 1)}`} data-palete={documento.codigo} data-documento={documento.tipo}>
    {layout.moldura === 'dhl' && <img className="espelho-moldura" src={paraEndereco('/espelhos-moldura.png')} alt="" />}
    {blocos}
  </section>;
}

/** Altura medida da tabela de um documento com um layout: cabeçalho e cada linha (mm). */
export interface MedidaTabela {
  cabecalho: number;
  linhas: number[];
}
export interface EntradaMedicao {
  chave: string;
  documento: DocumentoEspelho;
  layout: LayoutEspelho;
}
const MM_POR_PX = 25.4 / 96;

/**
 * Renderiza fora da tela a tabela inteira de cada documento com a largura e o
 * estilo do layout e mede as linhas (sem zoom). A paginação usa essas alturas,
 * então a prévia e o PDF quebram as folhas nos mesmos pontos.
 */
function MedidorTabelas({ entradas, assinatura, aoMedir }: { entradas: readonly EntradaMedicao[]; assinatura: string; aoMedir: (assinatura: string, medidas: Map<string, MedidaTabela>) => void }) {
  const raiz = useRef<HTMLDivElement>(null);
  const entradasRef = useRef(entradas);
  const aoMedirRef = useRef(aoMedir);
  useLayoutEffect(() => {
    entradasRef.current = entradas;
    aoMedirRef.current = aoMedir;
  });
  useLayoutEffect(() => {
    let ativo = true;
    void carregarFontes(entradasRef.current.map((e) => e.layout)).then(() => {
      const el = raiz.current;
      if (!ativo || el === null) return;
      const medidas = new Map<string, MedidaTabela>();
      for (const caixa of el.querySelectorAll<HTMLElement>('[data-medida]')) {
        const chave = caixa.dataset.medida ?? '';
        const cabecalho = caixa.querySelector('thead')?.getBoundingClientRect().height ?? 0;
        const linhas = [...caixa.querySelectorAll('tbody > tr')].map((tr) => tr.getBoundingClientRect().height * MM_POR_PX);
        medidas.set(chave, { cabecalho: cabecalho * MM_POR_PX, linhas });
      }
      aoMedirRef.current(assinatura, medidas);
    });
    return () => { ativo = false; };
  }, [assinatura]);
  return <div className="ef-medidor" ref={raiz} aria-hidden="true">
    {entradas.map((e) => <div key={e.chave} data-medida={e.chave} style={{ width: `${String(blocoDe(e.layout, 'tabela').largura)}mm` }}>
      <TabelaEspelho layout={e.layout} documento={e.documento} linhas={e.documento.linhas} />
    </div>)}
  </div>;
}

/** Só mede de novo quando muda o que altera a altura das linhas (assinatura). */
export const Medidor = memo(MedidorTabelas, (a, b) => a.assinatura === b.assinatura);
