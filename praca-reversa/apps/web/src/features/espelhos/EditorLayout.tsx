import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as KeyboardEventReact, type PointerEvent as PointerEventReact, type ReactNode } from 'react';
import { IconeMais, IconeMenos } from '../../components/Icones';
import type { DocumentoEspelho } from './conteudo-espelho';
import { FolhaEspelho, type ModoGesto } from './FolhaEspelho';
import { fonteDisponivel } from './fontes';
import { desfazer, iniciarHistorico, refazer, registrar, restaurar, substituir, type Historico } from './historico';
import { excluirModelo, modelosSalvos, salvarModelo, type ModeloSalvo } from './layout-armazenamento';
import {
  adicionarTexto, ajustarTamanho, alinharItens, alterarItem, alterarItens, assinaturaLayout, caixaDoItem, COM_ROTULO, deslocarItens, ehTexto, FONTES, itensDe,
  MAX_CARACTERES_TEXTO, MAX_TEXTOS, MODELOS_DO_SISTEMA, nomeDoItem, noPasso, OCULTAVEIS, PAPEL, PASSO_MM, PX_POR_MM,
  type CampoId, type EstiloTexto, type FonteId, type ItemId, type LayoutEspelho,
} from './layout-modelo';
import { descreverLinha, usePaginacao } from './usePaginacao';
import './editor-layout.css';
import { medirFolha, medirItensDoEditor, problemasDaFolha, type Problema } from './verificacao';

/**
 * Editor de layout dos espelhos (praça e embarque): um rascunho único para todos os documentos abertos. A folha
 * mostra os dados reais do espelho em foco; navegar entre os espelhos mantém o
 * rascunho. Nada é gravado até "Aplicar aos N espelhos"; "Cancelar" descarta.
 * Durante o arraste só a folha em foco é redesenhada.
 *
 * Seleção: clique seleciona um item; Shift (ou Ctrl) + clique soma/tira; arrastar
 * numa área vazia da folha seleciona por área; Ctrl+A seleciona tudo. Com vários
 * itens, arrastar qualquer um move o grupo, as setas movem todos e o painel
 * muda fonte, tamanho e alinhamento de todos de uma vez.
 */
interface Props {
  /** Espelhos navegáveis (dados reais), na ordem de impressão. */
  documentos: readonly DocumentoEspelho[];
  /** Muda quando os dados mudam (refaz a medição das linhas). */
  geracao: string;
  inicio?: number;
  /** Layout de partida do rascunho ("Restaurar" volta a ele). */
  layoutInicial: LayoutEspelho;
  /** Quantos layouts diferentes os documentos usam hoje (aviso). */
  distintos?: number;
  rotuloAplicar: string;
  /** O que a aplicação inclui (mostrado em "Quais espelhos?"). */
  explicacao: string;
  aoAplicar: (layout: LayoutEspelho) => void;
  aoSair: () => void;
}
interface Gesto {
  /** Itens que se movem juntos (o grupo selecionado ou só o alvo). */
  ids: readonly ItemId[];
  alvo: ItemId;
  modo: ModoGesto;
  x0: number;
  y0: number;
  /** Layout no início do gesto: o deslocamento é sempre calculado a partir dele. */
  inicio: LayoutEspelho;
  escala: number;
  moveu: boolean;
}
interface Laco { x0: number; y0: number; x1: number; y1: number }
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ENCAIXE_MM = 1.5;
const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
const ALINHAMENTOS = [['esquerda', 'Esquerda'], ['centro', 'Centro'], ['direita', 'Direita']] as const;

function NumeroMm({ rotulo, valor, aoMudar, min, max, passo = PASSO_MM, sufixo = 'mm', teste }: { rotulo: string; valor: number; aoMudar: (v: number) => void; min: number; max: number; passo?: number; sufixo?: string; teste?: string }) {
  return <label className="ed-numero"><span>{rotulo}</span><input
    type="number"
    inputMode="decimal"
    value={valor}
    min={min}
    max={max}
    step={passo}
    data-testid={teste}
    onChange={(e) => { const v = e.currentTarget.valueAsNumber; if (Number.isFinite(v)) aoMudar(Math.min(Math.max(v, min), max)); }}
  /><small>{sufixo}</small></label>;
}

export function EditorLayout({ documentos, geracao, inicio = 0, layoutInicial: inicial, distintos = 1, rotuloAplicar, explicacao, aoAplicar, aoSair }: Props) {
  const tipo = inicial.documento;
  const [historico, setHistorico] = useState<Historico<LayoutEspelho>>(() => iniciarHistorico(inicial));
  const layout = historico.presente;
  const [indice, setIndice] = useState(inicio);
  const [pagina, setPagina] = useState(0);
  const [selecao, setSelecao] = useState<readonly ItemId[]>([]);
  const [laco, setLaco] = useState<Laco | null>(null);
  const [zoom, setZoom] = useState<number | 'ajustar'>('ajustar');
  const [area, setArea] = useState({ largura: 900, altura: 600 });
  const [painel, setPainel] = useState(true);
  const [guias, setGuias] = useState(true);
  const [lista, setLista] = useState(false);
  const [nomeModelo, setNomeModelo] = useState<string | null>(null);
  const [salvos, setSalvos] = useState<ModeloSalvo[]>(() => modelosSalvos().filter((m) => m.layout.documento === tipo));
  const [aviso, setAviso] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<Problema[]>([]);
  const [guiaCentro, setGuiaCentro] = useState(false);
  const palco = useRef<HTMLDivElement>(null);
  const folha = useRef<HTMLElement | null>(null);
  const gesto = useRef<Gesto | null>(null);
  // Digitação seguida no mesmo texto vira um passo só do desfazer.
  const digitando = useRef<ItemId | null>(null);

  const documento = documentos[Math.min(indice, documentos.length - 1)];
  const chave = documento === undefined ? '' : `${geracao}|${documento.id}`;
  const entradas = useMemo(() => (documento === undefined ? [] : [{ chave, documento, layout }]), [chave, documento, layout]);
  const { paginas, medidor } = usePaginacao(entradas);
  const pags = paginas.get(chave);
  const totalPaginas = pags?.folhas.length ?? 1;
  const paginaAtual = Math.min(pagina, totalPaginas - 1);

  const alterado = assinaturaLayout(layout) !== assinaturaLayout(inicial);
  const modelosSistema = MODELOS_DO_SISTEMA.filter((m) => m.layout.documento === tipo);
  const disponiveis = useMemo(() => new Map(FONTES.map((f) => [f.id, fonteDisponivel(f.id)])), []);
  const escala = zoom === 'ajustar' ? Math.max(0.3, Math.min((area.largura - 40) / (PAPEL.largura * PX_POR_MM), (area.altura - 40) / (PAPEL.altura * PX_POR_MM))) : zoom;
  // Só itens que existem no rascunho atual (desfazer pode tirar um texto selecionado).
  const todos = itensDe(layout);
  const sel = selecao.filter((id) => todos.includes(id));

  // Tamanho da área de trabalho para "Ajustar à página" (não muda nenhuma medida da folha).
  useEffect(() => {
    const el = palco.current;
    if (el === null) return;
    const obs = new ResizeObserver(([e]) => { if (e !== undefined) setArea({ largura: e.contentRect.width, altura: e.contentRect.height }); });
    obs.observe(el);
    return () => { obs.disconnect(); };
  }, [painel]);

  // Sobreposições e cortes da folha em foco, medidos depois de desenhar.
  useLayoutEffect(() => {
    const quadro = requestAnimationFrame(() => {
      const el = folha.current;
      if (el === null) return;
      const novos = problemasDaFolha(medirFolha(el), layout.margem);
      for (const linha of pags?.grandes ?? []) novos.push({ campo: 'tabela', gravidade: 'erro', texto: `Tabela de notas: a linha ${descreverLinha(linha)} não cabe na altura da tabela.` });
      setProblemas((atual) => (JSON.stringify(atual) === JSON.stringify(novos) ? atual : novos));
    });
    return () => { cancelAnimationFrame(quadro); };
  }, [layout, documento, paginaAtual, pags]);

  const mudar = (novo: LayoutEspelho) => { digitando.current = null; setHistorico((h) => registrar(h, novo)); };
  const mudarItens = (ids: readonly ItemId[], m: Parameters<typeof alterarItens>[2]) => { mudar(alterarItens(layout, ids, m)); };
  const mudarEstilo = (ids: readonly ItemId[], e: Partial<EstiloTexto>) => { mudarItens(ids, () => ({ estilo: e })); };
  const focarPalco = () => { palco.current?.focus({ preventScroll: true }); };

  const aoPressionar = (id: ItemId, modo: ModoGesto, e: PointerEventReact<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    focarPalco();
    // Shift/Ctrl + clique: soma ou tira da seleção, sem mover.
    if (modo === 'mover' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      setSelecao(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
      return;
    }
    const grupo = modo === 'mover' && sel.length > 1 && sel.includes(id) ? sel : [id];
    if (grupo.length === 1) setSelecao([id]);
    gesto.current = { ids: grupo, alvo: id, modo, x0: e.clientX, y0: e.clientY, inicio: layout, escala, moveu: false };
    const mover = (ev: PointerEvent) => {
      const g = gesto.current;
      if (g === null) return;
      if (!g.moveu && Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < 3) return;
      const dx = (ev.clientX - g.x0) / (g.escala * PX_POR_MM);
      const dy = (ev.clientY - g.y0) / (g.escala * PX_POR_MM);
      const b = caixaDoItem(g.inicio, g.alvo);
      let centro = false;
      let aplicar: (l: LayoutEspelho) => LayoutEspelho;
      if (g.modo === 'mover' && g.ids.length > 1) {
        aplicar = (l) => deslocarItens(l, g.ids, noPasso(dx), noPasso(dy), g.inicio);
      } else if (g.modo === 'mover') {
        let x = noPasso(b.x + dx);
        const meio = PAPEL.largura / 2;
        if (Math.abs(x + b.largura / 2 - meio) < ENCAIXE_MM) { x = meio - b.largura / 2; centro = true; }
        else if (Math.abs(x - layout.margem) < ENCAIXE_MM) x = layout.margem;
        else if (Math.abs(x + b.largura - (PAPEL.largura - layout.margem)) < ENCAIXE_MM) x = PAPEL.largura - layout.margem - b.largura;
        const y = noPasso(b.y + dy);
        aplicar = (l) => alterarItem(l, g.alvo, { x, y });
      } else if (g.modo === 'largura-direita') {
        const largura = Math.max(5, noPasso(b.largura + dx));
        aplicar = (l) => alterarItem(l, g.alvo, { largura });
      } else if (g.modo === 'largura-esquerda') {
        const x = Math.min(noPasso(b.x + dx), b.x + b.largura - 5);
        aplicar = (l) => alterarItem(l, g.alvo, { x, largura: b.largura - (x - b.x) });
      } else {
        const altura = Math.max(campoMinimo(g.alvo), noPasso((b.altura ?? 0) + dy));
        aplicar = (l) => alterarItem(l, g.alvo, { altura });
      }
      setGuiaCentro(centro);
      // Primeiro movimento do gesto vira um passo do desfazer; os seguintes só atualizam.
      const primeiro = !g.moveu;
      g.moveu = true;
      digitando.current = null;
      setHistorico((h) => (primeiro ? registrar(h, aplicar(h.presente)) : substituir(h, aplicar(h.presente))));
    };
    const soltar = () => {
      const g = gesto.current;
      gesto.current = null;
      // Clique sem arrastar num item de um grupo: fica só ele selecionado.
      if (g !== null && !g.moveu && g.ids.length > 1) setSelecao([g.alvo]);
      setGuiaCentro(false);
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  };

  // Seleção por área: arrastar numa parte vazia da folha (ou em volta dela). Com Shift/Ctrl, soma à seleção.
  const iniciarLaco = (e: PointerEventReact<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-campo-editor]') !== null) return;
    const el = folha.current;
    if (el === null) return;
    e.preventDefault();
    focarPalco();
    const r = el.getBoundingClientRect();
    const k = escala * PX_POR_MM;
    const cx = e.clientX;
    const cy = e.clientY;
    const x0 = (cx - r.left) / k;
    const y0 = (cy - r.top) / k;
    const aditivo = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = aditivo ? sel : [];
    let fim: Laco | null = null;
    const mover = (ev: PointerEvent) => {
      if (fim === null && Math.hypot(ev.clientX - cx, ev.clientY - cy) < 4) return;
      fim = { x0, y0, x1: (ev.clientX - r.left) / k, y1: (ev.clientY - r.top) / k };
      setLaco(fim);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      setLaco(null);
      const l = fim;
      if (l === null) { if (!aditivo) setSelecao([]); return; }
      const [ax, bx] = [Math.min(l.x0, l.x1), Math.max(l.x0, l.x1)];
      const [ay, by] = [Math.min(l.y0, l.y1), Math.max(l.y0, l.y1)];
      const dentro = medirItensDoEditor(el).filter((c) => c.x < bx && c.x + c.largura > ax && c.y < by && c.y + c.altura > ay).map((c) => c.campo);
      setSelecao([...new Set([...base, ...dentro])]);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  };

  const teclado = (e: KeyboardEventReact<HTMLElement>) => {
    const alvo = e.target as HTMLElement;
    if (alvo.closest('input, select, textarea') !== null) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const tecla = e.key.toLowerCase();
    if (ctrl && tecla === 'z') { e.preventDefault(); digitando.current = null; setHistorico((h) => (e.shiftKey ? refazer(h) : desfazer(h))); return; }
    if (ctrl && tecla === 'y') { e.preventDefault(); digitando.current = null; setHistorico(refazer); return; }
    if (ctrl && tecla === 'a') { e.preventDefault(); setSelecao(todos); return; }
    if (e.key === 'Escape') { setSelecao([]); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const textos = sel.filter(ehTexto);
      if (textos.length > 0) { e.preventDefault(); excluirTextos(textos); }
      return;
    }
    if (sel.length === 0) return;
    const passo = e.shiftKey ? 5 : PASSO_MM;
    const d = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    mudar(deslocarItens(layout, sel, d[0] ?? 0, d[1] ?? 0));
  };

  const novoTexto = () => {
    const novo = adicionarTexto(layout);
    if (novo === null) { setAviso(`Limite de ${String(MAX_TEXTOS)} textos por layout.`); return; }
    mudar(novo.layout);
    setSelecao([novo.id]);
    setPainel(true);
  };
  const excluirTextos = (ids: readonly ItemId[]) => {
    mudar(ids.reduce((l, id) => ({ ...l, textos: l.textos.filter((t) => t.id !== id) }), layout));
    setSelecao(sel.filter((x) => !ids.includes(x)));
  };
  const escreverTexto = (id: ItemId, texto: string) => {
    const continua = digitando.current === id;
    digitando.current = id;
    setHistorico((h) => (continua ? substituir(h, alterarItem(h.presente, id, { texto })) : registrar(h, alterarItem(h.presente, id, { texto }))));
  };

  const irPara = (i: number) => { setIndice(Math.max(0, Math.min(documentos.length - 1, i))); setPagina(0); };
  const sair = () => {
    if (alterado && !window.confirm('Descartar as alterações deste layout? Os espelhos continuam com o layout aplicado antes.')) return;
    aoSair();
  };
  const carregarModelo = (valor: string) => {
    const m = [...modelosSistema, ...salvos].find((x) => x.id === valor);
    if (m !== undefined) { mudar(m.layout); setAviso(`Modelo “${m.nome}” carregado no rascunho. Nada foi aplicado ainda.`); }
  };
  const salvar = () => {
    if (nomeModelo === null) return;
    try {
      const m = salvarModelo(nomeModelo, layout);
      setSalvos(modelosSalvos().filter((x) => x.layout.documento === tipo));
      setNomeModelo(null);
      setAviso(`Modelo “${m.nome}” salvo neste computador (só a aparência, sem dados de palete).`);
    } catch (erro) {
      setAviso(erro instanceof Error ? erro.message : 'Não foi possível salvar o modelo.');
    }
  };
  const escolher = (id: ItemId, somar: boolean) => {
    if (!somar) { setSelecao([id]); return; }
    setSelecao(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  };

  const erros = problemas.filter((p) => p.gravidade === 'erro');
  const comProblema = new Set(problemas.map((p) => p.campo));
  if (documento === undefined) return null;
  const linhas = pags?.folhas[paginaAtual] ?? documento.linhas;
  const larguraPx = PAPEL.largura * PX_POR_MM * escala;
  const alturaPx = PAPEL.altura * PX_POR_MM * escala;
  const unico = sel.length === 1 ? sel[0] : undefined;
  const b = unico === undefined ? null : caixaDoItem(layout, unico);
  const textoUnico = unico === undefined ? undefined : layout.textos.find((t) => t.id === unico);
  const campoUnico = unico !== undefined && !ehTexto(unico) ? (unico as CampoId) : undefined;
  const textosSelecionados = sel.filter(ehTexto);
  const titulo = sel.length === 0 ? 'Folha' : unico !== undefined ? nomeDoItem(layout, unico) : `${String(sel.length)} itens selecionados`;

  /** Fonte, tamanho (com A− / A+), negrito e alinhamento do texto, para um ou vários itens. */
  const controlesTexto = (ids: readonly ItemId[]): ReactNode => {
    const comTexto = ids.filter((id) => id !== 'divisoria');
    const estilos = comTexto.map((id) => caixaDoItem(layout, id).estilo);
    const e0 = estilos[0];
    if (e0 === undefined) return null;
    const varios = comTexto.length > 1;
    const mesmaFonte = estilos.every((e) => e.fonte === e0.fonte);
    return <>
      <label className="ed-linha">Fonte <select value={mesmaFonte ? e0.fonte : ''} data-testid="ed-fonte" onChange={(e) => { mudarEstilo(comTexto, { fonte: e.currentTarget.value as FonteId }); }}>
        {!mesmaFonte && <option value="" disabled>Várias</option>}
        {FONTES.map((f) => <option key={f.id} value={f.id} disabled={disponiveis.get(f.id) === false}>{f.rotulo}{disponiveis.get(f.id) === false ? ' (não instalada)' : ''}</option>)}
      </select></label>
      <div className="ed-grade2">
        <NumeroMm rotulo={varios ? 'Tamanho (todos)' : 'Tamanho'} valor={e0.tamanho} min={5} max={72} passo={0.5} sufixo="pt" aoMudar={(v) => { mudarEstilo(comTexto, { tamanho: v }); }} teste="ed-tamanho" />
        <label className="ed-check"><input type="checkbox" checked={estilos.every((e) => e.negrito)} onChange={(e) => { mudarEstilo(comTexto, { negrito: e.currentTarget.checked }); }} /> Negrito</label>
      </div>
      <div className="ed-tamanho-rapido" role="group" aria-label="Tamanho do texto">
        <button type="button" className="botao-secundario ed-mini" onClick={() => { mudar(ajustarTamanho(layout, comTexto, -1)); }} data-testid="ed-menor" title={varios ? 'Diminui 1 pt em cada um' : 'Diminui 1 pt'}>A− menor</button>
        <button type="button" className="botao-secundario ed-mini" onClick={() => { mudar(ajustarTamanho(layout, comTexto, 1)); }} data-testid="ed-maior" title={varios ? 'Aumenta 1 pt em cada um' : 'Aumenta 1 pt'}>A+ maior</button>
      </div>
      <div className="ed-segmentado" role="group" aria-label="Alinhamento do texto">{ALINHAMENTOS.map(([a, rotulo]) => {
        const ativo = estilos.every((e) => e.alinhamento === a);
        return <button key={a} type="button" aria-pressed={ativo} className={ativo ? 'ed-ativo' : ''} onClick={() => { mudarEstilo(comTexto, { alinhamento: a }); }}>{rotulo}</button>;
      })}</div>
    </>;
  };

  return <div className="editor-layout nao-imprimir" role="dialog" aria-modal="true" aria-label="Editar layout dos espelhos" data-testid="editor-layout" onKeyDown={teclado}>
    <header className="ed-topo">
      <div className="ed-grupo">
        <strong className="ed-titulo">Editar layout</strong>
        <select aria-label="Começar de um modelo" value="" onChange={(e) => { carregarModelo(e.currentTarget.value); }} data-testid="ed-modelo">
          <option value="" disabled>Modelos…</option>
          <optgroup label="Do sistema">{modelosSistema.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</optgroup>
          {salvos.length > 0 && <optgroup label="Salvos neste computador">{salvos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</optgroup>}
        </select>
        <button type="button" className="botao-secundario ed-mini" onClick={() => { digitando.current = null; setHistorico(desfazer); }} disabled={historico.passado.length === 0} title="Desfazer (Ctrl+Z)">↶ Desfazer</button>
        <button type="button" className="botao-secundario ed-mini" onClick={() => { digitando.current = null; setHistorico(refazer); }} disabled={historico.futuro.length === 0} title="Refazer (Ctrl+Y)">↷ Refazer</button>
        <button type="button" className="botao-secundario ed-mini" onClick={() => { digitando.current = null; setHistorico(restaurar); }} disabled={!alterado} title="Volta ao layout com que o rascunho começou">Restaurar</button>
        <button type="button" className="botao-secundario ed-mini" onClick={novoTexto} data-testid="ed-adicionar-texto" title="Acrescenta um texto livre na folha (aparece em todos os espelhos com este layout)">+ Texto</button>
      </div>
      <div className="ed-grupo">
        <button type="button" className="botao-secundario botao-icone ed-mini" aria-label="Afastar" onClick={() => { setZoom(ZOOMS.findLast((z) => z < escala - 0.01) ?? ZOOMS[0] ?? 0.5); }}><IconeMenos /></button>
        <span className="ed-zoom" data-testid="ed-zoom">{Math.round(escala * 100)}%</span>
        <button type="button" className="botao-secundario botao-icone ed-mini" aria-label="Aproximar" onClick={() => { setZoom(ZOOMS.find((z) => z > escala + 0.01) ?? 2); }}><IconeMais /></button>
        <button type="button" className={`botao-secundario ed-mini${zoom === 'ajustar' ? ' ed-ativo' : ''}`} onClick={() => { setZoom('ajustar'); }}>Ajustar à página</button>
        <label className="ed-check"><input type="checkbox" checked={guias} onChange={(e) => { setGuias(e.currentTarget.checked); }} /> Guias</label>
      </div>
      <div className="ed-grupo ed-grupo--direita">
        <button type="button" className="botao-secundario botao-icone ed-mini" aria-label="Espelho anterior" disabled={indice === 0} onClick={() => { irPara(indice - 1); }}>‹</button>
        <span className="ed-nav" data-testid="ed-navegacao">Espelho {indice + 1}/{documentos.length} · <strong>{documento.codigo}</strong></span>
        <button type="button" className="botao-secundario botao-icone ed-mini" aria-label="Próximo espelho" disabled={indice >= documentos.length - 1} onClick={() => { irPara(indice + 1); }}>›</button>
        {totalPaginas > 1 && <span className="ed-nav">Folha <select aria-label="Folha do espelho" value={paginaAtual} onChange={(e) => { setPagina(Number(e.currentTarget.value)); }}>{Array.from({ length: totalPaginas }, (_, i) => <option key={i} value={i}>{i + 1}/{totalPaginas}</option>)}</select></span>}
        <button type="button" className="botao-link ed-mini" aria-expanded={lista} onClick={() => { setLista(!lista); }}>Quais espelhos?</button>
        <button type="button" className="botao-secundario ed-mini" onClick={() => { setNomeModelo(nomeModelo === null ? '' : null); }}>Salvar como modelo</button>
        <button type="button" className="botao-secundario ed-mini" onClick={sair}>Cancelar</button>
        <button type="button" className="botao-primario ed-mini" data-testid="ed-aplicar" onClick={() => { aoAplicar(layout); }}>{rotuloAplicar}</button>
      </div>
    </header>
    {(lista || nomeModelo !== null || aviso !== null || distintos > 1) && <div className="ed-faixa">
      {lista && <div className="ed-lista" data-testid="ed-lista"><strong>{explicacao}</strong> {documentos.map((d, i) => <button key={d.id} type="button" className={`ed-chip${i === indice ? ' ed-ativo' : ''}`} onClick={() => { irPara(i); }}>{d.codigo}</button>)}</div>}
      {nomeModelo !== null && <form className="ed-salvar" onSubmit={(e) => { e.preventDefault(); salvar(); }}><label>Nome do modelo <input autoFocus value={nomeModelo} maxLength={60} onChange={(e) => { setNomeModelo(e.currentTarget.value); }} data-testid="ed-nome-modelo" /></label><button type="submit" className="botao-primario ed-mini" disabled={nomeModelo.trim() === ''}>Salvar modelo</button><span className="ed-dica">Guarda só a aparência. Não muda o padrão nem os espelhos já aplicados.</span>
        {salvos.length > 0 && <span className="ed-dica">Salvos: {salvos.map((m) => <button key={m.id} type="button" className="botao-link" onClick={() => { if (window.confirm(`Excluir o modelo “${m.nome}”?`)) { excluirModelo(m.id); setSalvos(modelosSalvos().filter((x) => x.layout.documento === tipo)); } }}>excluir “{m.nome}”</button>)}</span>}</form>}
      {distintos > 1 && <p className="ed-dica">Hoje estes espelhos usam {distintos} layouts diferentes. O rascunho começou pelo do espelho aberto; ao aplicar, todos ficam iguais.</p>}
      {aviso !== null && <p className="ed-dica" role="status">{aviso} <button type="button" className="botao-link" onClick={() => { setAviso(null); }}>ok</button></p>}
    </div>}
    <div className="ed-corpo">
      <div className="ed-palco" ref={palco} tabIndex={-1} onPointerDown={iniciarLaco} data-testid="ed-palco">
        <div className="ed-folha" style={{ width: `${String(larguraPx)}px`, height: `${String(alturaPx)}px` }}>
          <div className="ed-escala" style={{ transform: `scale(${String(escala)})` }}>
            <FolhaEspelho
              documento={documento}
              pagina={paginaAtual}
              totalPaginas={totalPaginas}
              linhas={linhas}
              layout={layout}
              refFolha={(el) => { folha.current = el; }}
              edicao={{ selecionados: new Set(sel), comProblema, aoPressionar, aoFocar: (id) => { if (!sel.includes(id)) setSelecao([id]); } }}
            />
            {guias && <div className="ed-guias" aria-hidden="true">
              <div className="ed-guia-area" style={{ inset: `${String(layout.margem)}mm` }} />
              <div className={`ed-guia-centro${guiaCentro ? ' ed-guia-centro--ativa' : ''}`} />
            </div>}
            {laco !== null && <div className="ed-laco" data-testid="ed-laco" style={{ left: `${String(Math.min(laco.x0, laco.x1))}mm`, top: `${String(Math.min(laco.y0, laco.y1))}mm`, width: `${String(Math.abs(laco.x1 - laco.x0))}mm`, height: `${String(Math.abs(laco.y1 - laco.y0))}mm` }} />}
          </div>
        </div>
        {medidor}
      </div>
      {painel ? <aside className="ed-painel" aria-label="Propriedades" data-testid="ed-painel">
        <div className="ed-painel-topo"><strong data-testid="ed-titulo-painel">{titulo}</strong><button type="button" className="botao-link" onClick={() => { setPainel(false); }}>Recolher</button></div>
        {problemas.length > 0 && <ul className="ed-problemas" data-testid="ed-problemas">{problemas.map((p, i) => <li key={i} className={`ed-problema ed-problema--${p.gravidade}`}><button type="button" className="botao-link" onClick={() => { setSelecao([p.campo]); }}>{p.gravidade === 'erro' ? 'Corrigir: ' : 'Atenção: '}{p.texto}</button></li>)}</ul>}
        {sel.length === 0 && <>
          <p className="ed-dica">Clique num campo da folha para mover e ajustar. <strong>Vários de uma vez:</strong> Shift + clique, ou arraste numa parte vazia da folha para selecionar por área (Ctrl+A seleciona tudo). Setas movem 0,5 mm (Shift: 5 mm).</p>
          <div className="ed-campos">{todos.map((c) => <button key={c} type="button" className="botao-secundario ed-mini" onClick={(e) => { escolher(c, e.shiftKey || e.ctrlKey); }}>{nomeDoItem(layout, c)}</button>)}</div>
          <button type="button" className="botao-secundario ed-mini" onClick={novoTexto}>+ Adicionar texto</button>
          <label className="ed-linha">Moldura <select value={layout.moldura} onChange={(e) => { mudar({ ...layout, moldura: e.currentTarget.value === 'dhl' ? 'dhl' : 'nenhuma' }); }}><option value="nenhuma">Sem moldura (fundo branco)</option><option value="dhl">Moldura DHL</option></select></label>
          <NumeroMm rotulo="Margem da guia" valor={layout.margem} min={0} max={30} aoMudar={(v) => { mudar({ ...layout, margem: v }); }} />
          <p className="ed-dica">Papel: A4 paisagem (área de impressão {PAPEL.largura} × {PAPEL.altura} mm). Zoom e janela não mudam o tamanho impresso.</p>
        </>}
        {sel.length > 1 && <>
          <ul className="ed-sel-lista" data-testid="ed-selecao">{sel.slice(0, 8).map((id) => <li key={id}>{nomeDoItem(layout, id)}</li>)}{sel.length > 8 && <li>e mais {sel.length - 8}</li>}</ul>
          <p className="ed-dica">Arraste qualquer um deles para mover o grupo; as setas movem todos. Shift + clique tira ou põe um item.</p>
          {controlesTexto(sel)}
          <span className="ed-linha">Alinhar posições entre si</span>
          <div className="ed-alinhar" role="group" aria-label="Alinhar posições">
            {([['esquerda', 'Esquerdas'], ['centro', 'Centros'], ['direita', 'Direitas'], ['topo', 'Topos']] as const).map(([m, rotulo]) => <button key={m} type="button" className="botao-secundario ed-mini" onClick={() => { mudar(alinharItens(layout, sel, m)); }} data-testid={`ed-alinhar-${m}`}>{rotulo}</button>)}
          </div>
          {textosSelecionados.length > 0 && <button type="button" className="botao-link botao-perigo-texto" onClick={() => { excluirTextos(textosSelecionados); }}>Excluir {textosSelecionados.length} texto(s) livre(s)</button>}
          <button type="button" className="botao-link" onClick={() => { setSelecao([]); }}>Limpar seleção</button>
        </>}
        {unico !== undefined && b !== null && <>
          {textoUnico !== undefined && <label className="ed-linha">Texto (aparece igual em todos os espelhos com este layout)
            <textarea className="ed-texto" value={textoUnico.texto} maxLength={MAX_CARACTERES_TEXTO} onChange={(e) => { escreverTexto(textoUnico.id, e.currentTarget.value); }} data-testid="ed-texto" />
          </label>}
          <div className="ed-grade2">
            <NumeroMm rotulo="X" valor={b.x} min={0} max={PAPEL.largura} aoMudar={(v) => { mudar(alterarItem(layout, unico, { x: v })); }} teste="ed-x" />
            <NumeroMm rotulo="Y" valor={b.y} min={0} max={PAPEL.altura} aoMudar={(v) => { mudar(alterarItem(layout, unico, { y: v })); }} teste="ed-y" />
            <NumeroMm rotulo="Largura" valor={b.largura} min={5} max={PAPEL.largura} aoMudar={(v) => { mudar(alterarItem(layout, unico, { largura: v })); }} teste="ed-largura" />
            {b.altura !== null && <NumeroMm rotulo={unico === 'divisoria' ? 'Espessura' : 'Altura'} valor={b.altura} min={campoMinimo(unico)} max={PAPEL.altura} passo={unico === 'divisoria' ? 0.1 : PASSO_MM} aoMudar={(v) => { mudar(alterarItem(layout, unico, { altura: v })); }} />}
          </div>
          {controlesTexto([unico])}
          {campoUnico !== undefined && COM_ROTULO.has(campoUnico) && <label className="ed-check"><input type="checkbox" checked={b.rotulo} onChange={(e) => { mudar(alterarItem(layout, unico, { rotulo: e.currentTarget.checked })); }} /> Mostrar rótulo pequeno acima</label>}
          {campoUnico !== undefined && OCULTAVEIS.has(campoUnico) && <label className="ed-check"><input type="checkbox" checked={b.visivel} onChange={(e) => { mudar(alterarItem(layout, unico, { visivel: e.currentTarget.checked })); }} /> Mostrar na folha</label>}
          {unico === 'tabela' && <>
            <label className="ed-linha">Cabeçalho <select value={layout.tabela.cabecalho} onChange={(e) => { mudar({ ...layout, tabela: { ...layout.tabela, cabecalho: e.currentTarget.value === 'escuro' ? 'escuro' : 'claro' } }); }}><option value="claro">Claro (linha embaixo)</option><option value="escuro">Escuro (fundo preto)</option></select></label>
            <label className="ed-linha">Linhas <select value={layout.tabela.linhas} onChange={(e) => { mudar({ ...layout, tabela: { ...layout.tabela, linhas: e.currentTarget.value === 'grade' ? 'grade' : 'horizontais' } }); }}><option value="horizontais">Só horizontais</option><option value="grade">Grade completa</option></select></label>
            <NumeroMm rotulo="Respiro da linha" valor={layout.tabela.espacamento} min={0.3} max={6} passo={0.1} aoMudar={(v) => { mudar({ ...layout, tabela: { ...layout.tabela, espacamento: v } }); }} />
            <p className="ed-dica">A altura define até onde a tabela vai em cada folha; as linhas que passarem seguem na folha seguinte, com cabeçalho e palete repetidos.</p>
          </>}
          {textoUnico !== undefined && <button type="button" className="botao-link botao-perigo-texto" onClick={() => { excluirTextos([textoUnico.id]); }} data-testid="ed-excluir-texto">Excluir este texto</button>}
          {erros.length === 0 && problemas.length === 0 && <p className="ed-dica">Posição: {fmt(b.x)} × {fmt(b.y)} mm.</p>}
        </>}
      </aside> : <button type="button" className="botao-secundario ed-reabrir" onClick={() => { setPainel(true); }}>Propriedades{problemas.length > 0 ? ` (${String(problemas.length)} aviso${problemas.length > 1 ? 's' : ''})` : ''}</button>}
    </div>
  </div>;
}

function campoMinimo(id: ItemId): number {
  return id === 'tabela' ? 20 : 0.1;
}
