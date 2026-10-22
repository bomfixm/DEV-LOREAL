/* Motor das cenas (quadro a quadro, sem relógio): planos com câmera por ponto
 * de foco e quadros-chave, realces, etiquetas ancoradas em pontos dos planos,
 * fichas que viajam por trilhas de luz, cursor com clique, frases com troca de
 * palavras e a lista de eventos de som (lida pelo audio.mjs).
 * As telas são capturas reais; tudo o que é desenhado aqui é sobreposição.
 */
'use strict';
const Motor = (() => {
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const E = {
    lin: (t) => t,
    io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    suave: (t) => t * t * (3 - 2 * t),
    passo: (t) => (t < 1 ? 0 : 1),
  };
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
  const $ = (id) => document.getElementById(id);

  const planos = [];
  const realces = [];
  const etiquetas = [];
  const fichas = [];
  const frases = [];
  const eventos = [];
  const extras = [];
  let cursorCfg = null;

  /* ---------- Planos ---------- */
  const PADRAO = { x: 960, y: 540, z: 0, rx: 0, ry: 0, rz: 0, s: 1, op: 0, blur: 0, bright: 1 };
  function plano({ id, src, w, h, html = '', raio = 16, sombra = true, imgAltura = null }) {
    const camera = document.createElement('div');
    camera.className = 'camera';
    const el = document.createElement('div');
    el.className = `plano${sombra ? ' sombra-plano' : ''}`;
    el.id = id;
    el.style.cssText = `width:${w}px;height:${h}px;border-radius:${raio}px`;
    if (src) {
      const img = new Image();
      img.src = src;
      img.alt = '';
      img.style.cssText = `display:block;width:${w}px;height:${imgAltura === null ? `${h}px` : 'auto'}`;
      el.appendChild(img);
    }
    if (html) el.insertAdjacentHTML('beforeend', html);
    camera.appendChild(el);
    $('planos').appendChild(camera);
    const p = { id, el, camera, w, h, chaves: [] };
    planos.push(p);
    return p;
  }
  /** Quadros-chave: [[quadro, {props}, curva], ...]; as props não informadas seguem as da chave anterior. */
  function animar(p, lista, opPista = null) {
    p.opPista = opPista;
    let atual = { ...PADRAO, focoX: p.w / 2, focoY: p.h / 2 };
    p.chaves = lista.map(([f, props, curva]) => {
      atual = { ...atual, ...props };
      return { f, v: { ...atual }, curva: curva || 'io' };
    });
    return p;
  }
  function estado(p, f) {
    const c = p.chaves;
    if (!c.length || f < c[0].f) return { ...(c[0]?.v ?? PADRAO), op: 0 };
    for (let i = 1; i < c.length; i++) {
      if (f <= c[i].f) {
        const t = E[c[i].curva]((f - c[i - 1].f) / (c[i].f - c[i - 1].f));
        const a = c[i - 1].v;
        const b = c[i].v;
        const r = {};
        for (const k of Object.keys(b)) r[k] = a[k] + (b[k] - a[k]) * t;
        return r;
      }
    }
    return { ...c[c.length - 1].v };
  }
  function aplicar(p, c) {
    const el = p.el;
    el.style.left = `${c.x - c.focoX}px`;
    el.style.top = `${c.y - c.focoY}px`;
    el.style.transformOrigin = `${c.focoX}px ${c.focoY}px`;
    el.style.transform = `translateZ(${c.z.toFixed(2)}px) rotateX(${c.rx.toFixed(3)}deg) rotateY(${c.ry.toFixed(3)}deg) rotateZ(${c.rz.toFixed(3)}deg) scale(${c.s.toFixed(4)})`;
    const op = clamp(c.op, 0, 1);
    p.camera.style.opacity = op.toFixed(3);
    p.camera.style.visibility = op <= 0.002 ? 'hidden' : 'visible';
    const filtros = [];
    if (c.blur > 0.05) filtros.push(`blur(${c.blur.toFixed(2)}px)`);
    if (Math.abs(c.bright - 1) > 0.005) filtros.push(`brightness(${c.bright.toFixed(3)})`);
    p.camera.style.filter = filtros.length ? filtros.join(' ') : 'none';
  }
  /** Desfoque de movimento só em deslocamentos rápidos (chegada limpa). */
  function borrao(p, f) {
    const a = estado(p, f);
    const b = estado(p, Math.max(0, f - 1));
    const d = Math.hypot(a.x - b.x, a.y - b.y) + Math.abs(a.s - b.s) * p.w * 0.35 + Math.abs(a.z - b.z) * 0.15;
    return clamp((d - 12) * 0.08, 0, 7);
  }
  /** Chaves de um plano-filho que acompanha o pai com a origem em (ox, oy) do pai. */
  function seguir(pai, ox, oy) {
    return pai.chaves.map((k) => [k.f, { ...k.v, focoX: k.v.focoX - ox, focoY: k.v.focoY - oy }, k.curva]);
  }
  /** Estado aplicado no quadro: opacidade própria do plano e desfoque de movimento. */
  function estadoFinal(p, f) {
    const st = estado(p, f);
    if (p.opPista) st.op *= pista(f, p.opPista);
    if (st.op > 0.002) st.blur += borrao(p, f);
    return st;
  }
  /** Ponto do plano na tela (com perspectiva) no quadro f. */
  function ponto(p, f, x, y) {
    const st = estado(p, f);
    aplicar(p, { ...st, op: 1 });
    const m = document.createElement('div');
    m.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:2px;height:2px;margin:-1px 0 0 -1px`;
    p.el.appendChild(m);
    const r = m.getBoundingClientRect();
    p.el.removeChild(m);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  /** Props para um plano-filho ficar exatamente sobre (ox, oy) do plano-pai no quadro f. */
  function alinhar(pai, f, ox, oy) {
    const st = estado(pai, f);
    return { focoX: st.focoX - ox, focoY: st.focoY - oy, x: st.x, y: st.y, z: st.z, rx: st.rx, ry: st.ry, rz: st.rz, s: st.s };
  }

  /* ---------- Realces dentro dos planos ---------- */
  function realce(p, { x, y, w, h, chaves, raio = 8, classe = '' }) {
    const el = document.createElement('div');
    el.className = `realce ${classe}`;
    el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${raio}px;opacity:0`;
    p.el.appendChild(el);
    realces.push({ el, chaves });
  }

  /* ---------- Etiquetas ancoradas ---------- */
  function etiqueta({ html, p, x, y, lado = 'cima', dist = 18, chaves, classe = 'etiqueta' }) {
    const el = document.createElement('div');
    el.className = classe;
    el.innerHTML = html;
    el.style.opacity = '0';
    $('sobreposicoes').appendChild(el);
    etiquetas.push({ el, p, x, y, lado, dist, chaves });
  }

  /* ---------- Fichas e trilhas ---------- */
  function ficha({ html, de, para, ini, fim, curvatura = 200, classe = 'ficha' }) {
    const el = document.createElement('div');
    el.className = classe;
    el.innerHTML = html;
    el.style.opacity = '0';
    $('sobreposicoes').appendChild(el);
    const trilha = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    trilha.setAttribute('class', 'trilha');
    $('trilhas').appendChild(trilha);
    fichas.push({ el, trilha, de, para, ini, fim, curvatura, p0: null, p1: null });
  }
  const curva = (p0, p1, k) => ({ mx: (p0.x + p1.x) / 2, my: (p0.y + p1.y) / 2 - k });
  const naCurva = (p0, p1, c, t) => {
    const u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * c.mx + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.my + t * t * p1.y };
  };

  /* ---------- Cursor ---------- */
  function cursor(chaves) {
    cursorCfg = { chaves, telas: [] };
  }

  /* ---------- Frases (palavras que entram por máscara e saem para cima) ---------- */
  function frase({ texto, destaques = [], entra, sai, x, y, tamanho = 66, peso = 700, alinhar = 'esquerda', classe = '' }) {
    const el = document.createElement('div');
    el.className = `frase ${classe}`;
    el.style.cssText = `font-size:${tamanho}px;font-weight:${peso};opacity:0`;
    el.innerHTML = texto
      .split(' ')
      .map((p) => `<span class="palavra"><span${destaques.includes(p) ? ' class="destaque"' : ''}>${p}</span></span>`)
      .join(' ');
    $('sobreposicoes').appendChild(el);
    frases.push({ el, spans: [...el.querySelectorAll('.palavra > span')], entra, sai, x, y, alinhar });
  }

  const som = (f, tipo, extra = {}) => eventos.push({ f, tipo, ...extra });
  const aCada = (fn) => extras.push(fn);

  /* ---------- Preparo: imagens, fontes e posições medidas ---------- */
  async function preparar() {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? i.decode().catch(() => undefined) : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    for (const fi of fichas) {
      fi.p0 = ponto(fi.de.p, fi.de.f, fi.de.x, fi.de.y);
      fi.p1 = ponto(fi.para.p, fi.para.f, fi.para.x, fi.para.y);
    }
    if (cursorCfg) cursorCfg.telas = cursorCfg.chaves.map(([f, alvo]) => (alvo.p ? ponto(alvo.p, f, alvo.x, alvo.y) : { x: alvo.x, y: alvo.y }));
    for (const p of planos) aplicar(p, { ...estado(p, 0) });
  }

  /* ---------- Quadro ---------- */
  function quadro(f) {
    for (const p of planos) aplicar(p, estadoFinal(p, f));
    for (const r of realces) {
      const op = pista(f, r.chaves);
      r.el.style.opacity = op.toFixed(3);
      // Pulso ao acender.
      const sobe = r.chaves.find(([kf, v], i) => i > 0 && v > r.chaves[i - 1][1] && f >= r.chaves[i - 1][0] && f <= kf + 10);
      r.el.style.transform = sobe ? `scale(${(1 + 0.12 * (1 - trecho(f, sobe[0] - 4, sobe[0] + 10, 'out'))).toFixed(3)})` : 'none';
    }
    for (const e of etiquetas) {
      const op = pista(f, e.chaves);
      e.el.style.opacity = op.toFixed(3);
      if (op <= 0.002) continue;
      const pt = ponto(e.p, f, e.x, e.y);
      aplicar(e.p, estadoFinal(e.p, f));
      const w = e.el.offsetWidth;
      const h = e.el.offsetHeight;
      const pos = { cima: [pt.x - w / 2, pt.y - h - e.dist], baixo: [pt.x - w / 2, pt.y + e.dist], esq: [pt.x - w - e.dist, pt.y - h / 2], dir: [pt.x + e.dist, pt.y - h / 2] }[e.lado];
      const sobe = 1 - trecho(f, e.chaves.find(([, v]) => v > 0)?.[0] ?? 0, (e.chaves.find(([, v]) => v > 0)?.[0] ?? 0) + 10, 'expo');
      e.el.style.left = `${pos[0].toFixed(1)}px`;
      e.el.style.top = `${(pos[1] + sobe * 12).toFixed(1)}px`;
    }
    for (const fi of fichas) {
      const t = trecho(f, fi.ini, fi.fim, 'io');
      const c = curva(fi.p0, fi.p1, fi.curvatura);
      const pt = naCurva(fi.p0, fi.p1, c, t);
      const op = f < fi.ini - 4 || f > fi.fim + 4 ? 0 : pista(f, [[fi.ini - 4, 0], [fi.ini + 2, 1], [fi.fim - 2, 1], [fi.fim + 4, 0]]);
      fi.el.style.opacity = op.toFixed(3);
      fi.el.style.left = `${(pt.x - fi.el.offsetWidth / 2).toFixed(1)}px`;
      fi.el.style.top = `${(pt.y - fi.el.offsetHeight / 2).toFixed(1)}px`;
      fi.el.style.transform = `scale(${pista(f, [[fi.ini - 4, 0.4], [fi.ini + 8, 1, 'out'], [fi.fim - 8, 1], [fi.fim + 2, 0.35, 'in']]).toFixed(3)})`;
      fi.trilha.setAttribute('d', `M ${fi.p0.x.toFixed(1)} ${fi.p0.y.toFixed(1)} Q ${c.mx.toFixed(1)} ${c.my.toFixed(1)} ${fi.p1.x.toFixed(1)} ${fi.p1.y.toFixed(1)}`);
      const comp = fi.trilha.getTotalLength();
      fi.trilha.setAttribute('stroke-dasharray', `${(comp * t).toFixed(1)} ${comp.toFixed(1)}`);
      fi.trilha.style.opacity = pista(f, [[fi.ini - 2, 0], [fi.ini + 4, 0.9], [fi.fim - 6, 0.9], [fi.fim + 4, 0]]).toFixed(3);
    }
    if (cursorCfg) {
      const { chaves, telas } = cursorCfg;
      const el = $('cursor');
      const anel = $('clique');
      let pos = null;
      let op = 0;
      for (let i = 0; i < chaves.length; i++) {
        if (f >= chaves[i][0] && (i === chaves.length - 1 || f <= chaves[i + 1][0])) {
          const a = telas[i];
          const b = telas[i + 1] ?? a;
          const fim = chaves[i + 1]?.[0] ?? chaves[i][0] + 1;
          const t = E.io(clamp((f - chaves[i][0]) / (fim - chaves[i][0]), 0, 1));
          pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          op = chaves[i][3] === 'oculto' ? 0 : 1;
        }
      }
      el.style.opacity = pos ? String(op) : '0';
      if (pos) el.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
      const clique = chaves.map((c, i) => ({ f: c[0], tela: telas[i], ok: c[2] === true })).filter((c) => c.ok && f >= c.f && f <= c.f + 14).pop();
      if (clique) {
        const t = (f - clique.f) / 14;
        anel.style.opacity = (1 - t).toFixed(3);
        anel.style.transform = `translate(${clique.tela.x.toFixed(1)}px, ${clique.tela.y.toFixed(1)}px) scale(${(0.4 + t * 1.4).toFixed(3)})`;
        el.style.transform += ` scale(${(0.86 + 0.14 * t).toFixed(3)})`;
      } else anel.style.opacity = '0';
    }
    for (const fr of frases) {
      const ativo = f >= fr.entra - 1 && f <= fr.sai + 16;
      fr.el.style.opacity = ativo ? '1' : '0';
      if (!ativo) continue;
      const w = fr.el.offsetWidth;
      fr.el.style.left = `${(fr.alinhar === 'centro' ? fr.x - w / 2 : fr.x).toFixed(1)}px`;
      fr.el.style.top = `${fr.y}px`;
      fr.el.style.setProperty('--t', (trecho(f, fr.entra - 4, fr.entra + 8, 'out') * (1 - trecho(f, fr.sai + 2, fr.sai + 12, 'out'))).toFixed(3));
      fr.spans.forEach((s, i) => {
        const t = trecho(f, fr.entra + i * 3, fr.entra + i * 3 + 16, 'expo');
        const saida = trecho(f, fr.sai + i * 2, fr.sai + i * 2 + 12, 'in');
        s.style.transform = `translateY(${((1 - t) * 112 - saida * 112).toFixed(2)}%)`;
      });
    }
    for (const fn of extras) fn(f);
  }

  return { E, pista, trecho, clamp, plano, animar, seguir, estado, alinhar, realce, etiqueta, ficha, cursor, frase, som, aCada, preparar, quadro, eventos, ponto };
})();
