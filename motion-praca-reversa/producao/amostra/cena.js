/* Amostra de acabamento — Praça Reversa (15 s, 1920×1080, 30 fps).
 * Tudo é função do número do quadro (sem animações CSS nem relógio): o
 * renderizador chama definirQuadro(n) e fotografa. Telas = capturas reais do
 * aplicativo (dados fictícios da demonstração); textos e realces são camadas
 * sobrepostas, sem alterar números.
 */
'use strict';
const FPS = 30;
const TOTAL = 450;
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const E = {
  lin: (t) => t,
  io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  suave: (t) => t * t * (3 - 2 * t),
};
/** Pista de valores: [[quadro, valor, curva?], ...]; a curva vale para o trecho que termina na chave. */
function pista(f, chaves) {
  if (f <= chaves[0][0]) return chaves[0][1];
  for (let i = 1; i < chaves.length; i++) {
    const [f1, v1, curva] = chaves[i];
    const [f0, v0] = chaves[i - 1];
    if (f <= f1) return v0 + (v1 - v0) * E[curva || 'io']((f - f0) / (f1 - f0));
  }
  return chaves[chaves.length - 1][1];
}
const trecho = (f, a, b, curva = 'io') => E[curva](clamp((f - a) / (b - a), 0, 1));

/* ---------- Planos: câmera por ponto de foco ---------- */
// O ponto (focoX, focoY) do plano fica em (x, y) da tela; giros e escala acontecem em volta dele.
function aplicarPlano(el, c) {
  el.style.left = `${c.x - c.focoX}px`;
  el.style.top = `${c.y - c.focoY}px`;
  el.style.transformOrigin = `${c.focoX}px ${c.focoY}px`;
  el.style.transform = `translateZ(${(c.z || 0).toFixed(2)}px) rotateX(${(c.rx || 0).toFixed(3)}deg) rotateY(${(c.ry || 0).toFixed(3)}deg) rotateZ(${(c.rz || 0).toFixed(3)}deg) scale(${(c.s ?? 1).toFixed(4)})`;
  const op = clamp(c.op ?? 1, 0, 1);
  el.style.opacity = op.toFixed(3);
  el.style.visibility = op <= 0.002 ? 'hidden' : 'visible';
  const filtros = [];
  if ((c.blur || 0) > 0.05) filtros.push(`blur(${c.blur.toFixed(2)}px)`);
  if (c.bright !== undefined && Math.abs(c.bright - 1) > 0.005) filtros.push(`brightness(${c.bright.toFixed(3)})`);
  // Filtro na câmera (2D, escala da tela): o plano continua rasterizado na escala em que aparece.
  const alvo = el.parentElement?.classList.contains('camera') ? el.parentElement : el;
  alvo.style.filter = filtros.length ? filtros.join(' ') : 'none';
}
/** Desfoque de movimento: só durante deslocamentos rápidos (chegada limpa). */
function borrao(estado, f, tamanho) {
  const a = estado(f);
  const b = estado(Math.max(0, f - 1));
  const d = Math.hypot(a.x - b.x, a.y - b.y) + Math.abs((a.s ?? 1) - (b.s ?? 1)) * tamanho * 0.5 + Math.abs((a.z || 0) - (b.z || 0)) * 0.15;
  return clamp((d - 12) * 0.08, 0, 7);
}
/** Posição na tela de um ponto do plano, já com perspectiva (mede um marcador invisível). */
function pontoNaTela(el, estado, px, py) {
  aplicarPlano(el, estado);
  const m = document.createElement('div');
  m.style.cssText = `position:absolute;left:${px}px;top:${py}px;width:2px;height:2px;margin:-1px 0 0 -1px`;
  el.appendChild(m);
  const r = m.getBoundingClientRect();
  el.removeChild(m);
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/* ---------- Tipografia ---------- */
function montarPalavras(el, texto, destaques = []) {
  el.innerHTML = texto
    .split(' ')
    .map((p) => `<span class="palavra"><span${destaques.includes(p) ? ' style="color:var(--amarelo)"' : ''}>${p}</span></span>`)
    .join(' ');
  return [...el.querySelectorAll('.palavra > span')];
}
/** Revela palavras por máscara (sobe de dentro da linha), com escalonamento. */
function revelar(spans, f, inicio, passo = 3, duracao = 16, saida = null) {
  spans.forEach((s, i) => {
    const t = trecho(f, inicio + i * passo, inicio + i * passo + duracao, 'expo');
    let y = (1 - t) * 112;
    if (saida !== null) y -= trecho(f, saida + i * 2, saida + i * 2 + 12, 'in') * 112;
    s.style.transform = `translateY(${y.toFixed(2)}%)`;
  });
}

/* ---------- Corredores da praça em luz (abertura) ---------- */
function montarPiso() {
  const svg = $('svg-piso');
  const ns = 'http://www.w3.org/2000/svg';
  const blocos = ['U', 'P', 'P', 'P', 'P', 'P', 'U'];
  const larg = 80 * 1.4;
  const alt = 48 * 1.4;
  const corredor = 72 * 1.4;
  const dentro = 12 * 1.4;
  const totalL = blocos.reduce((s, b) => s + (b === 'P' ? 2 * larg + dentro : larg) + corredor, -corredor);
  let x = 1300 - totalL / 2;
  const linhas = 34;
  const y0 = 1300 - (linhas * (alt + 8)) / 2;
  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = '<linearGradient id="g-luz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcc00" stop-opacity="0"/><stop offset="0.5" stop-color="#ffe680" stop-opacity="1"/><stop offset="1" stop-color="#ffcc00" stop-opacity="0"/></linearGradient>';
  svg.appendChild(defs);
  const corredores = [];
  blocos.forEach((b, i) => {
    const colunas = b === 'P' ? 2 : 1;
    for (let c = 0; c < colunas; c++) {
      const cx = x + c * (larg + dentro);
      for (let r = 0; r < linhas; r++) {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', cx.toFixed(1));
        rect.setAttribute('y', (y0 + r * (alt + 8)).toFixed(1));
        rect.setAttribute('width', larg.toFixed(1));
        rect.setAttribute('height', alt.toFixed(1));
        rect.setAttribute('rx', '6');
        rect.setAttribute('fill', 'rgba(255,204,0,0.035)');
        rect.setAttribute('stroke', 'rgba(255,214,90,0.22)');
        rect.setAttribute('stroke-width', '1.6');
        svg.appendChild(rect);
      }
    }
    x += (b === 'P' ? 2 * larg + dentro : larg);
    if (i < blocos.length - 1) {
      const meio = x + corredor / 2;
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', meio.toFixed(1));
      l.setAttribute('x2', meio.toFixed(1));
      l.setAttribute('y1', y0.toFixed(1));
      l.setAttribute('y2', (y0 + linhas * (alt + 8)).toFixed(1));
      l.setAttribute('stroke', '#ffd84d');
      l.setAttribute('stroke-width', '5');
      l.setAttribute('stroke-linecap', 'round');
      l.setAttribute('stroke-dasharray', '180 1900');
      svg.appendChild(l);
      corredores.push(l);
    }
    x += corredor;
  });
  return corredores;
}

/* ---------- Trilhas de luz entre elementos relacionados ---------- */
function montarTrilhas() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 1920 1080');
  svg.style.cssText = 'position:absolute;inset:0;width:1920px;height:1080px;pointer-events:none;overflow:visible';
  svg.innerHTML =
    '<defs><filter id="brilho" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
    '<path id="trilha-1" fill="none" stroke="#ffcc00" stroke-width="3.5" stroke-linecap="round" filter="url(#brilho)"/>' +
    '<path id="trilha-2" fill="none" stroke="#ffcc00" stroke-width="3.5" stroke-linecap="round" filter="url(#brilho)"/>';
  $('palco').insertBefore(svg, $('ficha'));
  return { t1: $('trilha-1'), t2: $('trilha-2') };
}
function curva(p0, p1, curvatura) {
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2 - curvatura;
  return { d: `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`, mx, my };
}
function pontoCurva(p0, p1, c, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.mx + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.my + t * t * p1.y };
}

/* ---------- Estados dos planos ---------- */
const PLANILHA = { w: 1116, h: 525 };
const MAPA = { w: 1818, h: 944, palete: { x: 292, y: 139.5 } };
const JANELA = { w: 860, h: 535, volumes: { x: 783, y: 248 }, linha: { x: 430, y: 248 } };
const PAINEL = { w: 965, h: 212, separado: { x: 295, y: 127 } };

function estadoPlanilha(f) {
  return {
    focoX: pista(f, [[118, 558], [150, 300]]),
    focoY: pista(f, [[118, 262], [150, 301]]),
    x: pista(f, [[74, 1200], [106, 1150], [118, 1150], [150, 1010], [168, 760, 'in'], [196, 300, 'in']]),
    y: pista(f, [[74, 600], [106, 560], [150, 560], [196, 420, 'in']]),
    z: pista(f, [[74, -1100], [106, 0, 'expo'], [165, 0], [196, -900, 'in']]),
    rx: pista(f, [[74, 18], [106, 10], [118, 9], [150, 4], [196, 14]]),
    ry: pista(f, [[74, -30], [106, -15], [118, -14], [150, -6], [196, 18]]),
    s: pista(f, [[74, 0.9], [106, 1], [118, 1.02], [150, 2.15]]),
    op: pista(f, [[74, 0], [88, 1, 'out'], [180, 1], [196, 0]]),
    bright: pista(f, [[150, 1], [168, 0.55]]),
    blur: pista(f, [[150, 0], [170, 3.5]]),
  };
}
function estadoMapa(f) {
  return {
    focoX: pista(f, [[190, 909], [232, MAPA.palete.x]]),
    focoY: pista(f, [[190, 472], [232, MAPA.palete.y]]),
    x: pista(f, [[160, 960], [190, 960], [232, 900]]),
    y: pista(f, [[160, 700], [192, 560, 'out'], [232, 520]]),
    z: pista(f, [[160, -700], [194, 0, 'out'], [366, 0], [392, -600, 'in']]),
    rx: pista(f, [[160, 40], [194, 18, 'out'], [232, 10], [245, 10], [280, 14]]),
    ry: pista(f, [[190, 0], [232, -4]]),
    s: pista(f, [[160, 0.88], [194, 0.95, 'out'], [232, 2.6], [245, 2.6], [300, 2.78, 'out']]),
    op: pista(f, [[160, 0], [184, 1, 'out'], [366, 1], [392, 0]]),
    bright: pista(f, [[245, 1], [280, 0.5]]),
    blur: pista(f, [[245, 0], [282, 7]]),
  };
}
let ALVO_PALETE = { x: 900, y: 520 };
let LARGURA_PALETE_TELA = 160;
function estadoJanela(f) {
  const t = trecho(f, 245, 282, 'expo');
  const sIni = LARGURA_PALETE_TELA / JANELA.w;
  return {
    focoX: pista(f, [[306, JANELA.w / 2], [345, JANELA.linha.x]]),
    focoY: pista(f, [[306, JANELA.h / 2], [345, JANELA.linha.y]]),
    x: f < 292 ? ALVO_PALETE.x + (1190 - ALVO_PALETE.x) * t : pista(f, [[306, 1190], [345, 960], [366, 960], [394, 300, 'in']]),
    y: f < 292 ? ALVO_PALETE.y + (540 - ALVO_PALETE.y) * t : pista(f, [[306, 540], [345, 520], [366, 520], [394, 560, 'in']]),
    z: pista(f, [[245, 0], [282, 60, 'expo'], [366, 60], [394, -600, 'in']]),
    rx: pista(f, [[245, 10], [282, 3, 'expo'], [345, 1], [366, 1], [394, 12]]),
    ry: pista(f, [[282, -8], [306, -6], [345, 0], [366, 0], [394, 20]]),
    s: f < 282 ? sIni + (1.12 - sIni) * t : pista(f, [[306, 1.12], [345, 2.0]]),
    op: pista(f, [[245, 0], [251, 1, 'out'], [372, 1], [394, 0]]),
    blur: pista(f, [[366, 0], [392, 10]]),
  };
}
function estadoPainel(f) {
  return {
    focoX: PAINEL.separado.x,
    focoY: PAINEL.separado.y,
    x: pista(f, [[378, 1700], [406, 900, 'expo'], [450, 870, 'lin']]),
    y: pista(f, [[378, 620], [406, 500, 'expo'], [450, 496, 'lin']]),
    z: pista(f, [[378, -500], [406, 0, 'expo']]),
    rx: pista(f, [[378, 16], [406, 7, 'expo'], [450, 5, 'lin']]),
    ry: pista(f, [[378, -24], [406, -10, 'expo'], [450, -7, 'lin']]),
    s: pista(f, [[378, 1.0], [406, 1.3, 'expo'], [450, 1.34, 'lin']]),
    op: pista(f, [[378, 0], [390, 1, 'out']]),
  };
}
// Linha da bipagem: sai da planilha (quadro 150) e encaixa no palete (quadro 228).
let ORIGEM_LINHA = { x: 1000, y: 560 };
let ESCALA_LINHA = 2.15;
function estadoLinha(f) {
  const voo = trecho(f, 168, 228, 'io');
  const c = curva(ORIGEM_LINHA, ALVO_PALETE, 260);
  const p = pontoCurva(ORIGEM_LINHA, ALVO_PALETE, c, voo);
  return {
    focoX: 268, // parte da linha com Tipo, Número, CNPJ, remetente e Lidos
    focoY: 13.5,
    x: p.x,
    y: p.y,
    z: pista(f, [[150, 0], [164, 90, 'out'], [200, 120], [228, 0]]),
    rx: pista(f, [[150, 4], [228, 10]]),
    ry: pista(f, [[150, -6], [228, -4]]),
    s: pista(f, [[150, ESCALA_LINHA], [166, ESCALA_LINHA * 1.06, 'out'], [196, 0.75, 'io'], [228, 0.24, 'out']]),
    op: pista(f, [[150, 0], [154, 1], [222, 1], [232, 0]]),
  };
}

/* ---------- Montagem ---------- */
for (const id of ['planilha', 'mapa', 'linha', 'janela', 'painel']) {
  const plano = $(id);
  const camera = document.createElement('div');
  camera.className = 'camera';
  plano.parentElement.insertBefore(camera, plano);
  camera.appendChild(plano);
}
const corredores = montarPiso();
const trilhas = montarTrilhas();
const titulo = [...$('titulo').querySelectorAll('.palavra > span')];
const subtitulo = montarPalavras($('subtitulo'), 'Informação conectada à operação.', ['conectada']);
let ORIGEM_FICHA = { x: 1100, y: 520 };
let ALVO_SEPARADO = { x: 1000, y: 520 };

// Barras sob os cabeçalhos dos 5 campos lidos (Tipo, Número, CNPJ Remetente, Remetente, Lidos).
const CAMPOS = [
  [81, 34],
  [135, 58],
  [202, 112],
  [331, 82],
  [537, 38],
];
const barrasCampos = CAMPOS.map(([x, w]) => {
  const b = document.createElement('div');
  b.style.cssText = `position:absolute;left:${x - 3}px;top:283px;height:3px;width:${w + 6}px;border-radius:2px;background:#ffcc00;transform-origin:0 50%;box-shadow:0 0 10px rgba(255,204,0,.7)`;
  $('planilha').appendChild(b);
  return b;
});

/** Mede, uma vez, os pontos de chegada (palete no mapa, volumes da janela, "Separado" do painel). */
function medirAlvos() {
  const m = pontoNaTela($('mapa'), estadoMapa(232), MAPA.palete.x, MAPA.palete.y);
  const ladoA = pontoNaTela($('mapa'), estadoMapa(245), MAPA.palete.x - 32, MAPA.palete.y);
  const ladoB = pontoNaTela($('mapa'), estadoMapa(245), MAPA.palete.x + 32, MAPA.palete.y);
  ALVO_PALETE = m;
  LARGURA_PALETE_TELA = Math.hypot(ladoB.x - ladoA.x, ladoB.y - ladoA.y);
  ORIGEM_LINHA = pontoNaTela($('planilha'), estadoPlanilha(150), 22 + 268, 288 + 13.5);
  ESCALA_LINHA = estadoPlanilha(150).s;
  ORIGEM_FICHA = pontoNaTela($('janela'), estadoJanela(366), JANELA.volumes.x, JANELA.volumes.y);
  ALVO_SEPARADO = pontoNaTela($('painel'), estadoPainel(412), PAINEL.separado.x, PAINEL.separado.y);
}

/* ---------- Quadro ---------- */
function definirQuadro(f) {
  // Luz de fundo (parallax lento) e intensidade por cena.
  $('luz-a').style.transform = `translate(${(-420 + f * 1.2).toFixed(1)}px, ${(640 - f * 0.25).toFixed(1)}px) rotate(-16deg)`;
  $('luz-b').style.transform = `translate(${(1180 - f * 0.9).toFixed(1)}px, ${(120 + f * 0.15).toFixed(1)}px) rotate(12deg)`;
  $('luz-c').style.transform = `translate(${(520 + Math.sin(f / 60) * 40).toFixed(1)}px, ${(90 + Math.cos(f / 70) * 30).toFixed(1)}px)`;
  $('luz-a').style.opacity = pista(f, [[0, 0], [24, 1], [160, 0.8], [250, 0.55], [400, 0.9]]).toFixed(3);
  $('luz-b').style.opacity = pista(f, [[0, 0], [30, 0.9], [200, 0.5], [420, 0.75]]).toFixed(3);

  // Corredores da praça em luz: avançam em perspectiva e saem quando a planilha chega.
  const avanço = f * 9;
  $('piso').style.transform = `translateY(380px) rotateX(66deg) translateY(${(-avanço).toFixed(1)}px) scale(${(1 + trecho(f, 56, 90, 'in') * 0.6).toFixed(3)})`;
  $('cena-piso').style.opacity = pista(f, [[0, 0], [20, 1, 'out'], [60, 1], [92, 0, 'in']]).toFixed(3);
  corredores.forEach((l, i) => l.setAttribute('stroke-dashoffset', (-(f * 46 + i * 330) % 2080).toFixed(1)));

  // Abertura: símbolo DHL, título e subtítulo; saída com a câmera atravessando o título.
  const saida = trecho(f, 62, 84, 'in');
  const passagem = (el, cx, cy) => {
    el.style.transformOrigin = `${cx}px ${cy}px`;
    el.style.transform = `scale(${(1 + saida * 0.7).toFixed(3)})`;
    el.style.filter = saida > 0.01 ? `blur(${(saida * 16).toFixed(2)}px)` : 'none';
  };
  const dhl = $('dhl');
  const larguraDhl = 46 * (1980 / 300);
  dhl.style.left = `${960 - larguraDhl / 2}px`;
  dhl.style.top = `${pista(f, [[6, 352], [26, 336, 'expo']])}px`;
  dhl.style.opacity = (trecho(f, 6, 22, 'out') * (1 - saida)).toFixed(3);
  passagem(dhl, larguraDhl / 2, 23 + 540 - 336);
  const tit = $('titulo');
  tit.style.left = `${960 - tit.offsetWidth / 2}px`;
  tit.style.top = '418px';
  tit.style.letterSpacing = `${pista(f, [[10, -0.06], [44, -0.035, 'out']]).toFixed(4)}em`;
  tit.style.opacity = (1 - saida).toFixed(3);
  passagem(tit, tit.offsetWidth / 2, 540 - 418);
  revelar(titulo, f, 10, 6, 20);
  const sub = $('subtitulo');
  sub.style.left = `${960 - sub.offsetWidth / 2}px`;
  sub.style.top = '598px';
  sub.style.opacity = (0.92 * (1 - saida)).toFixed(3);
  passagem(sub, sub.offsetWidth / 2, 540 - 598);
  revelar(subtitulo, f, 30, 3, 16);

  // Planilha da bipagem (plano claro) e os 5 campos lidos.
  const ep = estadoPlanilha(f);
  ep.blur = (ep.blur || 0) + borrao(estadoPlanilha, f, PLANILHA.w);
  aplicarPlano($('planilha'), ep);
  barrasCampos.forEach((b, i) => {
    b.style.transform = `scaleX(${trecho(f, 96 + i * 5, 108 + i * 5, 'expo').toFixed(3)})`;
    b.style.opacity = pista(f, [[140, 1], [152, 0]]).toFixed(3);
  });
  $('realce-linha').style.opacity = pista(f, [[130, 0], [138, 1, 'out'], [150, 1], [156, 0]]).toFixed(3);

  // Linha da NF: destaca-se e voa até o palete.
  const el = estadoLinha(f);
  el.blur = borrao(estadoLinha, f, 1072 * 0.5);
  aplicarPlano($('linha'), el);

  // Mapa (plano escuro).
  const em = estadoMapa(f);
  em.blur = (em.blur || 0) + borrao(estadoMapa, f, 600);
  aplicarPlano($('mapa'), em);
  const pulso = trecho(f, 226, 240, 'out');
  const realcePalete = $('realce-palete');
  realcePalete.style.opacity = pista(f, [[224, 0], [230, 1], [245, 1], [262, 0]]).toFixed(3);
  realcePalete.style.transform = `scale(${(1.6 - 0.6 * pulso).toFixed(3)})`;

  // Janela do palete: emerge da posição; a câmera vai à linha da NF.
  const ej = estadoJanela(f);
  ej.blur = (ej.blur || 0) + borrao(estadoJanela, f, 500);
  aplicarPlano($('janela'), ej);
  $('realce-resumo').style.opacity = pista(f, [[276, 0], [284, 1], [302, 1], [310, 0]]).toFixed(3);
  $('realce-janela-linha').style.opacity = pista(f, [[318, 0], [326, 1, 'out'], [366, 1], [372, 0]]).toFixed(3);

  // Painel: janela de saída com o volume separado.
  const epn = estadoPainel(f);
  epn.blur = borrao(estadoPainel, f, 500);
  aplicarPlano($('painel'), epn);
  const realceSep = $('realce-separado');
  realceSep.style.opacity = pista(f, [[408, 0], [414, 1]]).toFixed(3);
  realceSep.style.transform = `scale(${(1.25 - 0.25 * trecho(f, 408, 420, 'out')).toFixed(3)})`;

  // Ficha "5 volumes": da linha da janela do palete ao "Separado" do painel.
  const ficha = $('ficha');
  const tf = trecho(f, 370, 410, 'io');
  const cf = curva(ORIGEM_FICHA, ALVO_SEPARADO, 180);
  const pf = pontoCurva(ORIGEM_FICHA, ALVO_SEPARADO, cf, tf);
  const escalaFicha = pista(f, [[366, 0.4], [380, 1, 'out'], [400, 1], [412, 0.35, 'in']]);
  ficha.style.left = `${(pf.x - ficha.offsetWidth / 2).toFixed(1)}px`;
  ficha.style.top = `${(pf.y - ficha.offsetHeight / 2).toFixed(1)}px`;
  ficha.style.transform = `scale(${escalaFicha.toFixed(3)})`;
  ficha.style.opacity = pista(f, [[366, 0], [372, 1], [406, 1], [413, 0]]).toFixed(3);

  // Trilhas de luz (continuidade entre o que está relacionado).
  const c1 = curva(ORIGEM_LINHA, ALVO_PALETE, 260);
  trilhas.t1.setAttribute('d', c1.d);
  const comp1 = trilhas.t1.getTotalLength();
  const r1 = trecho(f, 168, 228, 'io');
  trilhas.t1.setAttribute('stroke-dasharray', `${(comp1 * r1).toFixed(1)} ${comp1.toFixed(1)}`);
  trilhas.t1.style.opacity = pista(f, [[168, 0], [176, 0.9], [228, 0.9], [246, 0]]).toFixed(3);
  trilhas.t2.setAttribute('d', cf.d);
  const comp2 = trilhas.t2.getTotalLength();
  trilhas.t2.setAttribute('stroke-dasharray', `${(comp2 * tf).toFixed(1)} ${comp2.toFixed(1)}`);
  trilhas.t2.style.opacity = pista(f, [[368, 0], [374, 0.9], [402, 0.9], [412, 0]]).toFixed(3);

  // Etiqueta do endereço (posição real do palete na tela).
  const etq = $('etq-endereco');
  const pp = f >= 222 && f <= 266 ? pontoNaTela($('mapa'), em, MAPA.palete.x - 44, MAPA.palete.y) : { x: 0, y: 0 };
  aplicarPlano($('mapa'), em);
  etq.style.left = `${(pp.x - etq.offsetWidth).toFixed(1)}px`;
  etq.style.top = `${(pp.y - etq.offsetHeight / 2).toFixed(1)}px`;
  etq.style.opacity = pista(f, [[232, 0], [240, 1, 'out'], [252, 1], [262, 0]]).toFixed(3);
  etq.style.transform = `translateY(${((1 - trecho(f, 232, 244, 'expo')) * 14).toFixed(1)}px)`;

  const campos = $('etq-campos');
  const pc = f >= 92 && f <= 150 ? pontoNaTela($('planilha'), ep, 300, 230) : { x: 0, y: 0 };
  aplicarPlano($('planilha'), ep);
  campos.style.left = `${(pc.x - campos.offsetWidth / 2).toFixed(1)}px`;
  campos.style.top = `${(pc.y - 60).toFixed(1)}px`;
  campos.style.opacity = pista(f, [[96, 0], [104, 1, 'out'], [124, 1], [132, 0]]).toFixed(3);
  const lidos = $('etq-lidos');
  const pl = f >= 136 && f <= 168 ? pontoNaTela($('planilha'), ep, 541, 288) : { x: 0, y: 0 };
  aplicarPlano($('planilha'), ep);
  lidos.style.left = `${(pl.x - lidos.offsetWidth / 2).toFixed(1)}px`;
  lidos.style.top = `${(pl.y - 74).toFixed(1)}px`;
  lidos.style.opacity = pista(f, [[140, 0], [146, 1, 'out'], [158, 1], [164, 0]]).toFixed(3);
  lidos.style.transform = `translateY(${((1 - trecho(f, 140, 150, 'expo')) * 12).toFixed(1)}px)`;
  textos(f);

  $('selo-demo').style.opacity = pista(f, [[70, 0], [84, 1]]).toFixed(3);
  $('vinheta').style.opacity = '1';
}

/* ---------- Textos da cena: palavras que se substituem ---------- */
const frases = [
  // [elemento, texto, destaques, entra, sai, x, y]
  ['texto-a', 'Da bipagem', ['bipagem'], 90, 116, 150, 250],
  ['texto-b', 'ao palete.', ['palete.'], 98, 116, 150, 334],
  ['texto-a', 'Localizar.', [], 200, 258, 120, 860],
  ['texto-a', 'Abrir.', [], 262, 284, 120, 860],
  ['texto-a', 'Entender.', [], 288, 304, 120, 860],
  ['texto-a', 'Da bipagem à janela de saída.', ['janela', 'saída.'], 404, 9999, 120, 860],
];
const montadas = new Map();
function textos(f) {
  const ativos = { 'texto-a': null, 'texto-b': null };
  for (const fr of frases) {
    const [id, , , entra, sai] = fr;
    if (f >= entra - 1 && f < sai + 14) ativos[id] = fr;
  }
  for (const id of ['texto-a', 'texto-b']) {
    const el = $(id);
    const fr = ativos[id];
    if (!fr) {
      el.style.opacity = '0';
      continue;
    }
    const [, texto, destaques, entra, sai, x, y] = fr;
    if (montadas.get(id) !== texto) {
      montarPalavras(el, texto, destaques);
      montadas.set(id, texto);
    }
    el.style.opacity = '1';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.textShadow = '0 4px 30px rgba(0,0,0,0.65)';
    revelar([...el.querySelectorAll('.palavra > span')], f, entra, 3, 16, sai < 9999 ? sai : null);
  }
}

window.TOTAL_QUADROS = TOTAL;
window.FPS = FPS;
window.definirQuadro = definirQuadro;
window.pronto = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => (i.complete ? i.decode().catch(() => undefined) : new Promise((r) => (i.onload = r)))));
  medirAlvos();
  const q = Number(new URLSearchParams(location.search).get('q') ?? '0');
  definirQuadro(q);
  return true;
})();
