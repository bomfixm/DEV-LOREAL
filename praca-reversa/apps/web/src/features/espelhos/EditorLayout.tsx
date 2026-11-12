import type { LoteEspelhos } from '@praca-reversa/contracts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as KeyboardEventReact, type PointerEvent as PointerEventReact } from 'react';
import { IconeMais, IconeMenos } from '../../components/Icones';
import { FolhaEspelho, type ModoGesto } from './FolhaEspelho';
import { fonteDisponivel } from './fontes';
import { desfazer, iniciarHistorico, refazer, registrar, restaurar, substituir, type Historico } from './historico';
import { excluirModelo, modelosSalvos, salvarModelo, type ModeloSalvo } from './layout-armazenamento';
import {
  alterarBloco, assinaturaLayout, CAMPOS, COM_ROTULO, FONTES, LAYOUT_PADRAO, MODELOS_DO_SISTEMA, NOME_CAMPO, noPasso, OCULTAVEIS, PAPEL, PASSO_MM, PX_POR_MM,
  type BlocoLayout, type CampoId, type EstiloTexto, type FonteId, type LayoutEspelho,
} from './layout-modelo';
import { usePaginacao } from './usePaginacao';
import { medirFolha, problemasDaFolha, type Problema } from './verificacao';

/**
 * Editor de layout dos espelhos: um rascunho único para o lote inteiro. A folha
 * mostra os dados reais do espelho em foco; navegar entre os espelhos mantém o
 * rascunho. Nada é gravado até "Aplicar aos N espelhos"; "Cancelar" descarta.
 * Durante o arraste só a folha em foco é redesenhada.
 */
interface Props {
  lote: LoteEspelhos;
  aplicados: ReadonlyMap<string, LayoutEspelho>;
  aoAplicar: (ids: string[], layout: LayoutEspelho) => void;
  aoSair: () => void;
}
interface Gesto {
  campo: CampoId;
  modo: ModoGesto;
  x0: number;
  y0: number;
  bloco: BlocoLayout;
  escala: number;
  moveu: boolean;
}
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ENCAIXE_MM = 1.5;
const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');

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

export function EditorLayout({ lote, aplicados, aoAplicar, aoSair }: Props) {
  const ids = useMemo(() => lote.items.map((p) => p.id), [lote]);
  const inicial = aplicados.get(ids[0] ?? '') ?? LAYOUT_PADRAO;
  const [historico, setHistorico] = useState<Historico<LayoutEspelho>>(() => iniciarHistorico(inicial));
  const layout = historico.presente;
  const [indice, setIndice] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [selecionado, setSelecionado] = useState<CampoId | null>(null);
  const [zoom, setZoom] = useState<number | 'ajustar'>('ajustar');
  const [area, setArea] = useState({ largura: 900, altura: 600 });
  const [painel, setPainel] = useState(true);
  const [guias, setGuias] = useState(true);
  const [lista, setLista] = useState(false);
  const [nomeModelo, setNomeModelo] = useState<string | null>(null);
  const [salvos, setSalvos] = useState<ModeloSalvo[]>(() => modelosSalvos());
  const [aviso, setAviso] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<Problema[]>([]);
  const [guiaCentro, setGuiaCentro] = useState(false);
  const palco = useRef<HTMLDivElement>(null);
  const folha = useRef<HTMLElement | null>(null);
  const gesto = useRef<Gesto | null>(null);

  const palete = lote.items[Math.min(indice, lote.items.length - 1)];
  const entradas = useMemo(() => (palete === undefined ? [] : [{ chave: `${lote.generatedAt}|${palete.id}`, palete, layout }]), [lote.generatedAt, palete, layout]);
  const { paginas, medidor } = usePaginacao(entradas);
  const pags = palete === undefined ? undefined : paginas.get(`${lote.generatedAt}|${palete.id}`);
  const totalPaginas = pags?.folhas.length ?? 1;
  const paginaAtual = Math.min(pagina, totalPaginas - 1);

  const distintos = useMemo(() => new Set(ids.map((id) => assinaturaLayout(aplicados.get(id) ?? LAYOUT_PADRAO))).size, [ids, aplicados]);
  const alterado = assinaturaLayout(layout) !== assinaturaLayout(inicial);
  const disponiveis = useMemo(() => new Map(FONTES.map((f) => [f.id, fonteDisponivel(f.id)])), []);
  const escala = zoom === 'ajustar' ? Math.max(0.3, Math.min((area.largura - 40) / (PAPEL.largura * PX_POR_MM), (area.altura - 40) / (PAPEL.altura * PX_POR_MM))) : zoom;

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
      for (const nota of pags?.grandes ?? []) novos.push({ campo: 'tabela', gravidade: 'erro', texto: `Tabela de notas: a nota ${nota.documentNumber ?? nota.delivery ?? ''} não cabe na altura da tabela.` });
      setProblemas((atual) => (JSON.stringify(atual) === JSON.stringify(novos) ? atual : novos));
    });
    return () => { cancelAnimationFrame(quadro); };
  }, [layout, palete, paginaAtual, pags]);

  const mudar = (novo: LayoutEspelho) => { setHistorico((h) => registrar(h, novo)); };
  const mudarBloco = (campo: CampoId, m: Partial<Omit<BlocoLayout, 'estilo'>> & { estilo?: Partial<EstiloTexto> }) => { mudar(alterarBloco(layout, campo, m)); };

  const aoPressionar = (campo: CampoId, modo: ModoGesto, e: PointerEventReact<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setSelecionado(campo);
    e.currentTarget.closest<HTMLElement>('[data-campo-editor]')?.focus({ preventScroll: true });
    gesto.current = { campo, modo, x0: e.clientX, y0: e.clientY, bloco: layout.blocos[campo], escala, moveu: false };
    const mover = (ev: PointerEvent) => {
      const g = gesto.current;
      if (g === null) return;
      const dx = (ev.clientX - g.x0) / (g.escala * PX_POR_MM);
      const dy = (ev.clientY - g.y0) / (g.escala * PX_POR_MM);
      if (!g.moveu && Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < 3) return;
      const b = g.bloco;
      let m: Partial<BlocoLayout> = {};
      let centro = false;
      if (g.modo === 'mover') {
        let x = noPasso(b.x + dx);
        const meio = PAPEL.largura / 2;
        if (Math.abs(x + b.largura / 2 - meio) < ENCAIXE_MM) { x = meio - b.largura / 2; centro = true; }
        else if (Math.abs(x - layout.margem) < ENCAIXE_MM) x = layout.margem;
        else if (Math.abs(x + b.largura - (PAPEL.largura - layout.margem)) < ENCAIXE_MM) x = PAPEL.largura - layout.margem - b.largura;
        m = { x, y: noPasso(b.y + dy) };
      } else if (g.modo === 'largura-direita') {
        m = { largura: Math.max(5, noPasso(b.largura + dx)) };
      } else if (g.modo === 'largura-esquerda') {
        const x = Math.min(noPasso(b.x + dx), b.x + b.largura - 5);
        m = { x, largura: b.largura - (x - b.x) };
      } else {
        m = { altura: Math.max(campoMinimo(g.campo), noPasso((b.altura ?? 0) + dy)) };
      }
      setGuiaCentro(centro);
      // Primeiro movimento do gesto vira um passo do desfazer; os seguintes só atualizam.
      const primeiro = !g.moveu;
      g.moveu = true;
      setHistorico((h) => (primeiro ? registrar(h, alterarBloco(h.presente, g.campo, m)) : substituir(h, alterarBloco(h.presente, g.campo, m))));
    };
    const soltar = () => {
      gesto.current = null;
      setGuiaCentro(false);
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  };

  const teclado = (e: KeyboardEventReact<HTMLElement>) => {
    const alvo = e.target as HTMLElement;
    if (alvo.closest('input, select, textarea') !== null) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); setHistorico((h) => (e.shiftKey ? refazer(h) : desfazer(h))); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); setHistorico(refazer); return; }
    if (e.key === 'Escape') { setSelecionado(null); return; }
    if (selecionado === null) return;
    const passo = e.shiftKey ? 5 : PASSO_MM;
    const d = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const b = layout.blocos[selecionado];
    mudarBloco(selecionado, { x: noPasso(b.x + (d[0] ?? 0)), y: noPasso(b.y + (d[1] ?? 0)) });
  };

  const irPara = (i: number) => { setIndice(Math.max(0, Math.min(lote.items.length - 1, i))); setPagina(0); };
  const sair = () => {
    if (alterado && !window.confirm('Descartar as alterações deste layout? Os espelhos continuam com o layout aplicado antes.')) return;
    aoSair();
  };
  const carregarModelo = (valor: string) => {
    const m = [...MODELOS_DO_SISTEMA, ...salvos].find((x) => x.id === valor);
    if (m !== undefined) { mudar(m.layout); setAviso(`Modelo “${m.nome}” carregado no rascunho. Nada foi aplicado ainda.`); }
  };
  const salvar = () => {
    if (nomeModelo === null) return;
    try {
      const m = salvarModelo(nomeModelo, layout);
      setSalvos(modelosSalvos());
      setNomeModelo(null);
      setAviso(`Modelo “${m.nome}” salvo neste computador (só a aparência, sem dados de palete).`);
    } catch (erro) {
      setAviso(erro instanceof Error ? erro.message : 'Não foi possível salvar o modelo.');
    }
  };

  const b = selecionado === null ? null : layout.blocos[selecionado];
  const erros = problemas.filter((p) => p.gravidade === 'erro');
  const comProblema = new Set(problemas.map((p) => p.campo));
  if (palete === undefined) return null;
  const linhas = pags?.folhas[paginaAtual] ?? palete.contents.items;
  const larguraPx = PAPEL.largura * PX_POR_MM * escala;
  const alturaPx = PAPEL.altura * PX_POR_MM * escala;

  return <div className="editor-layout nao-imprimir" role="dialog" aria-modal="true" aria-label="Editar layout dos espelhos" data-testid="editor-layout" onKeyDown={teclado}>
    <header className="ed-topo">
      <div className="ed-grupo">
        <strong className="ed-titulo">Editar layout</strong>
        <select aria-label="Começar de um modelo" value="" onChange={(e) => { carregarModelo(e.currentTarget.value); }} data-testid="ed-modelo">
          <option value="" disabled>Modelos…</option>
          <optgroup label="Do sistema">{MODELOS_DO_SISTEMA.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</optgroup>
          {salvos.length > 0 && <optgroup label="Salvos neste computador">{salvos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</optgroup>}
        </select>
        <button type="button" className="botao-secundario ed-mini" onClick={() => { setHistorico(desfazer); }} disabled={historico.passado.length === 0} title="Desfazer (Ctrl+Z)">↶ Desfazer</button>
        <button type="button" className="botao-secundario ed-mini" onClick={() => { setHistorico(refazer); }} disabled={historico.futuro.length === 0} title="Refazer (Ctrl+Y)">↷ Refazer</button>
        <button type="button" className="botao-secundario ed-mini" onClick={() => { setHistorico(restaurar); }} disabled={!alterado} title="Volta ao layout com que o rascunho começou">Restaurar</button>
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
        <span className="ed-nav" data-testid="ed-navegacao">Espelho {indice + 1}/{lote.items.length} · <strong>{palete.code}</strong></span>
        <button type="button" className="botao-secundario botao-icone ed-mini" aria-label="Próximo espelho" disabled={indice >= lote.items.length - 1} onClick={() => { irPara(indice + 1); }}>›</button>
        {totalPaginas > 1 && <span className="ed-nav">Folha <select aria-label="Folha do espelho" value={paginaAtual} onChange={(e) => { setPagina(Number(e.currentTarget.value)); }}>{Array.from({ length: totalPaginas }, (_, i) => <option key={i} value={i}>{i + 1}/{totalPaginas}</option>)}</select></span>}
        <button type="button" className="botao-link ed-mini" aria-expanded={lista} onClick={() => { setLista(!lista); }}>Quais espelhos?</button>
        <button type="button" className="botao-secundario ed-mini" onClick={() => { setNomeModelo(nomeModelo === null ? '' : null); }}>Salvar como modelo</button>
        <button type="button" className="botao-secundario ed-mini" onClick={sair}>Cancelar</button>
        <button type="button" className="botao-primario ed-mini" data-testid="ed-aplicar" onClick={() => { aoAplicar([...ids], layout); }}>Aplicar aos {lote.items.length} espelhos</button>
      </div>
    </header>
    {(lista || nomeModelo !== null || aviso !== null || distintos > 1) && <div className="ed-faixa">
      {lista && <div className="ed-lista" data-testid="ed-lista"><strong>A aplicação inclui exatamente estes {lote.items.length} espelho(s) da prévia gerada em {new Date(lote.generatedAt).toLocaleTimeString('pt-BR')}:</strong> {lote.items.map((p, i) => <button key={p.id} type="button" className={`ed-chip${i === indice ? ' ed-ativo' : ''}`} onClick={() => { irPara(i); }}>{p.code}</button>)}<p>Para incluir ou tirar espelhos, cancele, mude a seleção no mapa e gere a prévia de novo.</p></div>}
      {nomeModelo !== null && <form className="ed-salvar" onSubmit={(e) => { e.preventDefault(); salvar(); }}><label>Nome do modelo <input autoFocus value={nomeModelo} maxLength={60} onChange={(e) => { setNomeModelo(e.currentTarget.value); }} data-testid="ed-nome-modelo" /></label><button type="submit" className="botao-primario ed-mini" disabled={nomeModelo.trim() === ''}>Salvar modelo</button><span className="ed-dica">Guarda só a aparência. Não muda o padrão nem os espelhos já aplicados.</span>
        {salvos.length > 0 && <span className="ed-dica">Salvos: {salvos.map((m) => <button key={m.id} type="button" className="botao-link" onClick={() => { if (window.confirm(`Excluir o modelo “${m.nome}”?`)) { excluirModelo(m.id); setSalvos(modelosSalvos()); } }}>excluir “{m.nome}”</button>)}</span>}</form>}
      {distintos > 1 && <p className="ed-dica">Hoje estes espelhos usam {distintos} layouts diferentes. O rascunho começou pelo do 1º espelho; ao aplicar, todos ficam iguais.</p>}
      {aviso !== null && <p className="ed-dica" role="status">{aviso} <button type="button" className="botao-link" onClick={() => { setAviso(null); }}>ok</button></p>}
    </div>}
    <div className="ed-corpo">
      <div className="ed-palco" ref={palco} onPointerDown={(e) => { if (e.target === e.currentTarget) setSelecionado(null); }}>
        <div className="ed-folha" style={{ width: `${String(larguraPx)}px`, height: `${String(alturaPx)}px` }}>
          <div className="ed-escala" style={{ transform: `scale(${String(escala)})` }}>
            <FolhaEspelho
              contexto={{ palete, pagina: paginaAtual, totalPaginas, escopo: lote.scope, geradoEm: lote.generatedAt }}
              linhas={linhas}
              layout={layout}
              refFolha={(el) => { folha.current = el; }}
              edicao={{ selecionado, comProblema, aoPressionar, aoFocar: setSelecionado }}
            />
            {guias && <div className="ed-guias" aria-hidden="true">
              <div className="ed-guia-area" style={{ inset: `${String(layout.margem)}mm` }} />
              <div className={`ed-guia-centro${guiaCentro ? ' ed-guia-centro--ativa' : ''}`} />
            </div>}
          </div>
        </div>
        {medidor}
      </div>
      {painel ? <aside className="ed-painel" aria-label="Propriedades">
        <div className="ed-painel-topo"><strong>{selecionado === null ? 'Folha' : NOME_CAMPO[selecionado]}</strong><button type="button" className="botao-link" onClick={() => { setPainel(false); }}>Recolher</button></div>
        {problemas.length > 0 && <ul className="ed-problemas" data-testid="ed-problemas">{problemas.map((p, i) => <li key={i} className={`ed-problema ed-problema--${p.gravidade}`}><button type="button" className="botao-link" onClick={() => { setSelecionado(p.campo); }}>{p.gravidade === 'erro' ? 'Corrigir: ' : 'Atenção: '}{p.texto}</button></li>)}</ul>}
        {b === null || selecionado === null ? <>
          <p className="ed-dica">Clique num campo da folha para mover e ajustar. Setas movem 0,5 mm (Shift: 5 mm).</p>
          <div className="ed-campos">{CAMPOS.map((c) => <button key={c} type="button" className="botao-secundario ed-mini" onClick={() => { setSelecionado(c); }}>{NOME_CAMPO[c]}</button>)}</div>
          <label className="ed-linha">Moldura <select value={layout.moldura} onChange={(e) => { mudar({ ...layout, moldura: e.currentTarget.value === 'dhl' ? 'dhl' : 'nenhuma' }); }}><option value="nenhuma">Sem moldura (fundo branco)</option><option value="dhl">Moldura DHL</option></select></label>
          <NumeroMm rotulo="Margem da guia" valor={layout.margem} min={0} max={30} aoMudar={(v) => { mudar({ ...layout, margem: v }); }} />
          <p className="ed-dica">Papel: A4 paisagem (área de impressão {PAPEL.largura} × {PAPEL.altura} mm). Zoom e janela não mudam o tamanho impresso.</p>
        </> : <>
          <div className="ed-grade2">
            <NumeroMm rotulo="X" valor={b.x} min={0} max={PAPEL.largura} aoMudar={(v) => { mudarBloco(selecionado, { x: v }); }} teste="ed-x" />
            <NumeroMm rotulo="Y" valor={b.y} min={0} max={PAPEL.altura} aoMudar={(v) => { mudarBloco(selecionado, { y: v }); }} teste="ed-y" />
            <NumeroMm rotulo="Largura" valor={b.largura} min={5} max={PAPEL.largura} aoMudar={(v) => { mudarBloco(selecionado, { largura: v }); }} teste="ed-largura" />
            {b.altura !== null && <NumeroMm rotulo={selecionado === 'divisoria' ? 'Espessura' : 'Altura'} valor={b.altura} min={campoMinimo(selecionado)} max={PAPEL.altura} passo={selecionado === 'divisoria' ? 0.1 : PASSO_MM} aoMudar={(v) => { mudarBloco(selecionado, { altura: v }); }} />}
          </div>
          {selecionado !== 'divisoria' && <>
            <label className="ed-linha">Fonte <select value={b.estilo.fonte} data-testid="ed-fonte" onChange={(e) => { mudarBloco(selecionado, { estilo: { fonte: e.currentTarget.value as FonteId } }); }}>
              {FONTES.map((f) => <option key={f.id} value={f.id} disabled={disponiveis.get(f.id) === false}>{f.rotulo}{disponiveis.get(f.id) === false ? ' (não instalada)' : ''}</option>)}
            </select></label>
            <div className="ed-grade2">
              <NumeroMm rotulo="Tamanho" valor={b.estilo.tamanho} min={5} max={72} passo={0.5} sufixo="pt" aoMudar={(v) => { mudarBloco(selecionado, { estilo: { tamanho: v } }); }} teste="ed-tamanho" />
              <label className="ed-check"><input type="checkbox" checked={b.estilo.negrito} onChange={(e) => { mudarBloco(selecionado, { estilo: { negrito: e.currentTarget.checked } }); }} /> Negrito</label>
            </div>
            <div className="ed-segmentado" role="group" aria-label="Alinhamento">{(['esquerda', 'centro', 'direita'] as const).map((a) => <button key={a} type="button" aria-pressed={b.estilo.alinhamento === a} className={b.estilo.alinhamento === a ? 'ed-ativo' : ''} onClick={() => { mudarBloco(selecionado, { estilo: { alinhamento: a } }); }}>{a === 'esquerda' ? 'Esquerda' : a === 'centro' ? 'Centro' : 'Direita'}</button>)}</div>
          </>}
          {COM_ROTULO.has(selecionado) && <label className="ed-check"><input type="checkbox" checked={b.rotulo} onChange={(e) => { mudarBloco(selecionado, { rotulo: e.currentTarget.checked }); }} /> Mostrar rótulo pequeno acima</label>}
          {OCULTAVEIS.has(selecionado) && <label className="ed-check"><input type="checkbox" checked={b.visivel} onChange={(e) => { mudarBloco(selecionado, { visivel: e.currentTarget.checked }); }} /> Mostrar na folha</label>}
          {selecionado === 'tabela' && <>
            <label className="ed-linha">Cabeçalho <select value={layout.tabela.cabecalho} onChange={(e) => { mudar({ ...layout, tabela: { ...layout.tabela, cabecalho: e.currentTarget.value === 'escuro' ? 'escuro' : 'claro' } }); }}><option value="claro">Claro (linha embaixo)</option><option value="escuro">Escuro (fundo preto)</option></select></label>
            <label className="ed-linha">Linhas <select value={layout.tabela.linhas} onChange={(e) => { mudar({ ...layout, tabela: { ...layout.tabela, linhas: e.currentTarget.value === 'grade' ? 'grade' : 'horizontais' } }); }}><option value="horizontais">Só horizontais</option><option value="grade">Grade completa</option></select></label>
            <NumeroMm rotulo="Respiro da linha" valor={layout.tabela.espacamento} min={0.3} max={6} passo={0.1} aoMudar={(v) => { mudar({ ...layout, tabela: { ...layout.tabela, espacamento: v } }); }} />
            <p className="ed-dica">A altura define até onde a tabela vai em cada folha; as notas que passarem seguem na folha seguinte, com cabeçalho e palete repetidos.</p>
          </>}
          {erros.length === 0 && problemas.length === 0 && <p className="ed-dica">Posição: {fmt(b.x)} × {fmt(b.y)} mm.</p>}
        </>}
      </aside> : <button type="button" className="botao-secundario ed-reabrir" onClick={() => { setPainel(true); }}>Propriedades{problemas.length > 0 ? ` (${String(problemas.length)} aviso${problemas.length > 1 ? 's' : ''})` : ''}</button>}
    </div>
  </div>;
}

function campoMinimo(campo: CampoId): number {
  return campo === 'tabela' ? 20 : 0.1;
}
