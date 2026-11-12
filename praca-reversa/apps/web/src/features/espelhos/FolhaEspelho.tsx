import type { ConteudoPalete } from '@praca-reversa/contracts';
import { memo, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as PointerEventReact, type ReactNode } from 'react';
import { paraEndereco } from '../../base';
import { celulasDaNota, textoDoCampo, textoFantasma, type ContextoFolha, type PaleteDoLote } from './conteudo-espelho';
import { carregarFontes } from './fontes';
import { CAMPOS, COLUNAS_TABELA, cssDaFonte, NOME_CAMPO, type BlocoLayout, type CampoId, type LayoutEspelho } from './layout-modelo';

/**
 * Uma folha do espelho desenhada a partir do layout (mm/pt). É o mesmo
 * componente na prévia, no editor e na impressão: o que se vê é o que sai no
 * PDF. Elementos do editor (contorno, alças) só existem com `edicao` e ficam
 * fora da impressão.
 */
export type ModoGesto = 'mover' | 'largura-esquerda' | 'largura-direita' | 'altura';
export interface EdicaoFolha {
  selecionado: CampoId | null;
  comProblema: ReadonlySet<CampoId>;
  aoPressionar: (campo: CampoId, modo: ModoGesto, evento: PointerEventReact<HTMLElement>) => void;
  aoFocar: (campo: CampoId) => void;
}

const estiloTexto = (b: BlocoLayout): CSSProperties => ({
  fontFamily: cssDaFonte(b.estilo.fonte),
  fontSize: `${String(b.estilo.tamanho)}pt`,
  fontWeight: b.estilo.negrito ? 700 : 400,
  textAlign: b.estilo.alinhamento === 'esquerda' ? 'left' : b.estilo.alinhamento === 'centro' ? 'center' : 'right',
});
const posicao = (b: BlocoLayout, comAltura: boolean): CSSProperties => ({
  left: `${String(b.x)}mm`,
  top: `${String(b.y)}mm`,
  width: `${String(b.largura)}mm`,
  ...(comAltura && b.altura !== null ? { height: `${String(b.altura)}mm` } : {}),
});

/** Tabela de notas (bloco único). Usada na folha e na medição das linhas. */
export function TabelaNotas({ layout, palete, linhas }: { layout: LayoutEspelho; palete: PaleteDoLote; linhas: readonly ConteudoPalete[] }) {
  const t = layout.tabela;
  const b = layout.blocos.tabela;
  const classe = `ef-tabela ef-tabela--cab-${t.cabecalho} ef-tabela--${t.linhas}`;
  const celula: CSSProperties = { paddingTop: `${String(t.espacamento)}mm`, paddingBottom: `${String(t.espacamento)}mm` };
  return <table className={classe} style={estiloTexto(b)} data-conteudo="">
    <colgroup>{t.colunas.map((w, i) => <col key={COLUNAS_TABELA[i]} style={{ width: `${String(w)}%` }} />)}</colgroup>
    <thead><tr>{COLUNAS_TABELA.map((h) => <th key={h} style={celula}>{h}</th>)}</tr></thead>
    <tbody>{linhas.length === 0
      ? <tr><td colSpan={COLUNAS_TABELA.length} style={celula}>SEM CONTEÚDO REGISTRADO — CONFERÊNCIA PENDENTE</td></tr>
      : linhas.map((d) => <tr key={d.id}>{celulasDaNota(d, palete).map((v, i) => <td key={COLUNAS_TABELA[i]} style={celula}>{v}</td>)}</tr>)}</tbody>
  </table>;
}

interface PropsFolha {
  contexto: ContextoFolha;
  linhas: readonly ConteudoPalete[];
  layout: LayoutEspelho;
  edicao?: EdicaoFolha;
  rotulo?: string;
  refFolha?: (el: HTMLElement | null) => void;
}

export function FolhaEspelho({ contexto, linhas, layout, edicao, rotulo, refFolha }: PropsFolha) {
  const blocos: ReactNode[] = [];
  for (const campo of CAMPOS) {
    const b = layout.blocos[campo];
    let fantasma = false;
    let conteudo: ReactNode;
    if (campo === 'tabela') {
      conteudo = <TabelaNotas layout={layout} palete={contexto.palete} linhas={linhas} />;
    } else if (campo === 'divisoria') {
      if (!b.visivel && edicao === undefined) continue;
      fantasma = !b.visivel;
      conteudo = <div className="ef-linha" />;
    } else {
      if (!b.visivel && edicao === undefined) continue;
      let texto = textoDoCampo(campo, contexto);
      fantasma = !b.visivel;
      if (texto === null) {
        if (edicao === undefined || (campo !== 'continuacao' && campo !== 'demo')) continue;
        texto = { rotulo: '', valor: textoFantasma(campo) };
        fantasma = true;
      }
      conteudo = <div data-conteudo="">{b.rotulo && texto.rotulo !== '' && <span className="ef-rotulo">{texto.rotulo}</span>}<span className={`ef-valor ef-valor--${campo}`}>{texto.valor}</span></div>;
    }
    const selecionado = edicao?.selecionado === campo;
    const classe = ['ef-bloco', `ef-bloco--${campo}`, fantasma ? 'ef-bloco--fantasma' : '', selecionado ? 'ef-bloco--selecionado' : '', edicao?.comProblema.has(campo) === true ? 'ef-bloco--problema' : ''].filter((c) => c !== '').join(' ');
    const comAltura = campo === 'tabela' || campo === 'divisoria';
    const estilo: CSSProperties = { ...posicao(b, comAltura), ...(campo === 'tabela' || campo === 'divisoria' ? {} : estiloTexto(b)) };
    blocos.push(<div
      key={campo}
      className={classe}
      style={estilo}
      data-campo={fantasma ? undefined : campo}
      data-campo-editor={campo}
      {...(edicao === undefined ? {} : {
        tabIndex: 0,
        role: 'button',
        'aria-label': `${NOME_CAMPO[campo]}${selecionado ? ' (selecionado)' : ''}`,
        'aria-pressed': selecionado,
        onPointerDown: (e: PointerEventReact<HTMLElement>) => { edicao.aoPressionar(campo, 'mover', e); },
        onFocus: () => { edicao.aoFocar(campo); },
      })}
    >
      {conteudo}
      {edicao !== undefined && selecionado && <>
        <span className="ef-alca ef-alca--esquerda" aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); edicao.aoPressionar(campo, 'largura-esquerda', e); }} />
        <span className="ef-alca ef-alca--direita" aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); edicao.aoPressionar(campo, 'largura-direita', e); }} />
        {campo === 'tabela' && <span className="ef-alca ef-alca--base" aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); edicao.aoPressionar(campo, 'altura', e); }} />}
      </>}
    </div>);
  }
  return <section className={`espelho-folha${edicao === undefined ? '' : ' espelho-folha--edicao'}`} ref={refFolha} aria-label={rotulo ?? `Espelho ${contexto.palete.code}, página ${String(contexto.pagina + 1)}`} data-palete={contexto.palete.code}>
    {layout.moldura === 'dhl' && <img className="espelho-moldura" src={paraEndereco('/espelhos-moldura.png')} alt="" />}
    {blocos}
  </section>;
}

/** Altura medida da tabela de um palete com um layout: cabeçalho e cada linha (mm). */
export interface MedidaTabela {
  cabecalho: number;
  linhas: number[];
}
export interface EntradaMedicao {
  chave: string;
  palete: PaleteDoLote;
  layout: LayoutEspelho;
}
const MM_POR_PX = 25.4 / 96;

/**
 * Renderiza fora da tela a tabela inteira de cada palete com a largura e o
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
    {entradas.map((e) => <div key={e.chave} data-medida={e.chave} style={{ width: `${String(e.layout.blocos.tabela.largura)}mm` }}>
      <TabelaNotas layout={e.layout} palete={e.palete} linhas={e.palete.contents.items} />
    </div>)}
  </div>;
}

/** Só mede de novo quando muda o que altera a altura das linhas (assinatura). */
export const Medidor = memo(MedidorTabelas, (a, b) => a.assinatura === b.assinatura);
