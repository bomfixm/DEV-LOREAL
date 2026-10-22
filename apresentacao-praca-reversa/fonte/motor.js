// Controlador único da apresentação: navegação manual, pontes entre cenas, controles, índice e notas.
// Sem avanço automático, sem consulta externa e sem gravação em lugar nenhum além da posição na URL (#n).
(() => {
  const R = window.PR_ROTEIRO;
  const CENAS = window.PR_CENAS;
  const $ = (s, r = document) => r.querySelector(s);
  const palco = $('#palco');
  const raiz = $('#cenas');
  const pontes = $('#pontes');
  const total = CENAS.length;
  const estatico = /[?&]estatico\b/.test(location.search);

  // ---------- Montagem: todas as cenas existem desde o início ----------
  const secoes = CENAS.map((c, i) => {
    const s = document.createElement('section');
    s.className = `cena ${c.fundo}`;
    s.dataset.cena = c.id;
    s.setAttribute('aria-label', `Cena ${c.id} — ${R[i].titulo}`);
    s.innerHTML = c.html();
    raiz.append(s);
    return s;
  });

  if (estatico) {
    document.body.classList.add('estatico');
    secoes.forEach((s) => s.classList.add('ativa'));
    document.fonts.ready.then(() => { $('#carregando')?.remove(); document.body.dataset.pronto = '1'; });
    return;
  }

  // ---------- Escala do palco (1920×1080 → janela) ----------
  let escala = 1;
  function ajustar() {
    const w = window.innerWidth, h = window.innerHeight;
    escala = Math.min(w / 1920, h / 1080);
    palco.style.transform = `translate(${(w - 1920 * escala) / 2}px, ${(h - 1080 * escala) / 2}px) scale(${escala})`;
  }
  window.addEventListener('resize', ajustar);
  ajustar();

  // ---------- Movimento reduzido ----------
  const prefereCalmo = window.matchMedia('(prefers-reduced-motion: reduce)');
  let calmo = prefereCalmo.matches;
  function aplicarCalmo() {
    document.body.classList.toggle('calmo', calmo);
    $('#b-movimento')?.setAttribute('aria-pressed', String(calmo));
    notificar();
  }

  // ---------- Navegação ----------
  let atual = -1;
  let tSaida = null;
  let tPonte = null;
  const ouvintes = new Set();
  const notificar = () => ouvintes.forEach((f) => f());

  function encerrarTransicoes() {
    clearTimeout(tSaida);
    clearTimeout(tPonte);
    pontes.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    pontes.replaceChildren();
    secoes.forEach((s) => s.classList.remove('saindo', 'sai-aproxima'));
    document.querySelectorAll('.ponte-oculto').forEach((el) => el.classList.remove('ponte-oculto'));
  }

  /** Retângulo em coordenadas do palco (desfaz a escala). */
  function retangulo(el) {
    const r = el.getBoundingClientRect(), p = palco.getBoundingClientRect();
    return { x: (r.left - p.left) / escala, y: (r.top - p.top) / escala, w: r.width / escala, h: r.height / escala };
  }
  function paresDePonte(de, para) {
    const pares = [];
    de.querySelectorAll('[data-ponte]').forEach((a) => {
      const chaves = a.dataset.ponte.split(' ');
      const b = [...para.querySelectorAll('[data-ponte]')].find((x) => x.dataset.ponte.split(' ').some((k) => chaves.includes(k)));
      if (b) pares.push([a, b]);
    });
    return pares;
  }
  function clone(el, r) {
    const k = el.cloneNode(true);
    k.removeAttribute('data-e');
    k.removeAttribute('data-ponte');
    k.classList.remove('ponte-oculto', 'ponte-alvo');
    k.querySelectorAll('[data-e]').forEach((x) => x.removeAttribute('data-e'));
    Object.assign(k.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, animation: 'none', opacity: '1', transform: 'none' });
    pontes.append(k);
    return k;
  }

  function ir(n, modo = 'passo') {
    n = Math.max(0, Math.min(total - 1, n));
    if (n === atual) return;
    const de = atual >= 0 ? secoes[atual] : null;
    const para = secoes[n];
    encerrarTransicoes();
    secoes.forEach((s) => s.querySelectorAll('.ponte-alvo').forEach((x) => x.classList.remove('ponte-alvo')));

    const adjacente = de && Math.abs(n - atual) === 1 && modo === 'passo' && !calmo;
    const pares = adjacente ? paresDePonte(de, para) : [];
    const origens = pares.map(([a]) => retangulo(a));

    if (de) {
      de.classList.remove('ativa');
      de.classList.add('saindo');
      if (CENAS[atual].saida === 'aproxima' && n > atual && !calmo) de.classList.add('sai-aproxima');
      tSaida = setTimeout(() => de.classList.remove('saindo', 'sai-aproxima'), 620);
    }

    // Destinos das pontes medidos no estado de leitura, antes de a entrada começar.
    let destinos = [];
    if (pares.length) {
      para.classList.add('ativa', 'medindo');
      destinos = pares.map(([, b]) => retangulo(b));
      para.classList.remove('ativa', 'medindo');
    }
    void para.offsetWidth;
    para.classList.add('ativa');

    pares.forEach(([a, b], i) => {
      const ra = origens[i], rb = destinos[i];
      if (!ra.w || !rb.w) return;
      b.classList.add('ponte-alvo', 'ponte-oculto');
      a.classList.add('ponte-oculto');
      // A moldura muda de forma; o conteúdo só desliza e troca por transparência (letras nunca esticam).
      const ca = getComputedStyle(a), cb = getComputedStyle(b);
      const caixa = document.createElement('div');
      pontes.append(caixa);
      const ka = clone(a, ra), kb = clone(b, rb);
      [ka, kb].forEach((k) => Object.assign(k.style, { background: 'transparent', boxShadow: 'none', borderColor: 'transparent' }));
      const forma = (r, c) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, backgroundColor: c.backgroundColor, borderRadius: c.borderRadius, boxShadow: c.boxShadow === 'none' ? '0 0 0 0 transparent' : c.boxShadow });
      const op = { duration: 760, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'both' };
      const d = `translate(${rb.x - ra.x}px, ${rb.y - ra.y}px)`, v = `translate(${ra.x - rb.x}px, ${ra.y - rb.y}px)`;
      caixa.animate([forma(ra, ca), forma(rb, cb)], op);
      ka.animate([{ transform: 'none', opacity: 1 }, { transform: d, opacity: 0, offset: 0.45 }, { transform: d, opacity: 0 }], op);
      kb.animate([{ transform: v, opacity: 0 }, { transform: v, opacity: 0, offset: 0.5 }, { transform: 'none', opacity: 1 }], op);
    });
    if (pares.length) {
      tPonte = setTimeout(() => {
        pontes.replaceChildren();
        pares.forEach(([a, b]) => { a.classList.remove('ponte-oculto'); b.classList.remove('ponte-oculto'); });
      }, 780);
    }

    atual = n;
    history.replaceState(null, '', `#${n + 1}`);
    notificar();
  }
  const proxima = () => ir(atual + 1);
  const anterior = () => ir(atual - 1);

  // ---------- Controles visíveis ----------
  const controles = $('#controles');
  const contador = $('#contador');
  const progresso = $('#progresso');
  ouvintes.add(() => {
    contador.textContent = `${String(atual + 1).padStart(2, '0')} / ${total}`;
    progresso.style.width = `${((atual + 1) / total) * 100}%`;
  });
  let tOcultar = null;
  let controlesFixosOcultos = false;
  function mostrarControles() {
    if (controlesFixosOcultos) return;
    document.body.classList.remove('controles-ocultos', 'ocultar-cursor');
    clearTimeout(tOcultar);
    tOcultar = setTimeout(() => {
      if (controles.matches(':hover') || !$('#indice').hidden) return;
      document.body.classList.add('controles-ocultos', 'ocultar-cursor');
    }, 2600);
  }
  window.addEventListener('mousemove', mostrarControles);
  function alternarControles() {
    controlesFixosOcultos = !controlesFixosOcultos;
    if (controlesFixosOcultos) document.body.classList.add('controles-ocultos', 'ocultar-cursor');
    else mostrarControles();
  }

  let tAviso = null;
  function aviso(texto) {
    const a = $('#aviso');
    a.textContent = texto;
    a.classList.add('visivel');
    clearTimeout(tAviso);
    tAviso = setTimeout(() => a.classList.remove('visivel'), 5200);
  }

  function telaCheia() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => aviso('O navegador não permitiu a tela cheia. Use F11.'));
  }
  document.addEventListener('fullscreenchange', () => $('#b-tela')?.setAttribute('aria-pressed', String(!!document.fullscreenElement)));

  function alternarCortina() { document.body.classList.toggle('cortina'); }

  // ---------- Índice ----------
  const indice = $('#indice');
  const lista = $('#indice ol');
  lista.innerHTML = R.map((r, i) => `<li><button type="button" data-ir="${i}"><b>${r.id}</b><span>${r.titulo}</span></button></li>`).join('');
  function abrirIndice() {
    indice.hidden = false;
    lista.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-current', String(i === atual)));
    lista.querySelectorAll('button')[Math.max(0, atual)]?.focus();
    mostrarControles();
  }
  function fecharIndice() { indice.hidden = true; document.activeElement?.blur?.(); }
  lista.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ir]');
    if (!b) return;
    fecharIndice();
    ir(Number(b.dataset.ir), 'salto');
  });
  indice.addEventListener('click', (ev) => { if (ev.target === indice) fecharIndice(); });

  // ---------- Teclado (passador comum: PageDown/PageUp; também setas e espaço) ----------
  const AVANCA = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'Enter']);
  const VOLTA = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']);
  function teclado(ev, origem = 'apresentacao') {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const k = ev.key;
    if (!indice.hidden) {
      if (k === 'Escape' || k === 'i' || k === 'I') { ev.preventDefault(); fecharIndice(); }
      if (k === 'Enter' || k === ' ') return; // o botão em foco no índice decide
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Tab'].includes(k)) return;
      return;
    }
    if (AVANCA.has(k)) { ev.preventDefault(); if (!ev.repeat) proxima(); }
    else if (VOLTA.has(k)) { ev.preventDefault(); if (!ev.repeat) anterior(); }
    else if (k === 'Home') { ev.preventDefault(); ir(0, 'salto'); }
    else if (k === 'End') { ev.preventDefault(); ir(total - 1, 'salto'); }
    else if (k === 'i' || k === 'I' || k === 'g' || k === 'G') { ev.preventDefault(); abrirIndice(); }
    else if ((k === 'f' || k === 'F') && origem === 'apresentacao') { ev.preventDefault(); telaCheia(); }
    else if (k === 'm' || k === 'M') { ev.preventDefault(); calmo = !calmo; aplicarCalmo(); aviso(calmo ? 'Movimentos reduzidos.' : 'Movimentos normais.'); }
    else if (k === 'n' || k === 'N') { ev.preventDefault(); abrirNotas(); }
    else if (k === 'h' || k === 'H') { ev.preventDefault(); alternarControles(); }
    else if (k === 'b' || k === 'B' || k === '.') { ev.preventDefault(); alternarCortina(); }
    else if (/^[0-9]$/.test(k)) { /* sem atalho numérico: evita salto acidental */ }
  }
  window.addEventListener('keydown', (ev) => teclado(ev));

  // Botões: o clique age uma vez e devolve o foco ao documento (espaço/Enter não repetem a ação).
  controles.addEventListener('mousedown', (ev) => ev.preventDefault());
  controles.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const acao = b.dataset.acao;
    if (acao === 'anterior') anterior();
    else if (acao === 'proxima') proxima();
    else if (acao === 'indice') abrirIndice();
    else if (acao === 'notas') abrirNotas();
    else if (acao === 'movimento') { calmo = !calmo; aplicarCalmo(); }
    else if (acao === 'tela') telaCheia();
    else if (acao === 'ocultar') alternarControles();
    b.blur();
  });

  // ---------- Notas do apresentador (janela própria; nunca na tela projetada) ----------
  let jNotas = null;
  let inicioFala = null;
  let tRelogio = null;
  const CSS_NOTAS = `
    *{box-sizing:border-box} body{margin:0;background:#17191C;color:#F5F3EB;font-family:Inter,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased}
    header{display:flex;align-items:center;gap:18px;padding:16px 24px;background:#0F1012;border-bottom:1px solid #2A2E34;position:sticky;top:0}
    header .cena{font-size:15px;font-weight:700;color:#FFCC00;letter-spacing:.06em}
    header h1{margin:0;font-size:22px;font-weight:800;flex:1}
    header .tempo{font-variant-numeric:tabular-nums;font-size:20px;font-weight:700}
    header .hora{font-variant-numeric:tabular-nums;font-size:15px;color:#9A978E}
    main{display:grid;grid-template-columns:1fr 330px;gap:0;min-height:calc(100vh - 64px)}
    .fala{padding:26px 34px 60px;font-size:27px;line-height:1.5}
    .fala p{margin:0 0 18px}
    aside{background:#1F2226;padding:22px;border-left:1px solid #2A2E34;display:flex;flex-direction:column;gap:18px}
    aside h2{margin:0 0 6px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#9A978E}
    .prox{font-size:19px;font-weight:700;line-height:1.35}
    .cuidados{margin:0;padding-left:18px;font-size:16px;line-height:1.45;color:#D8D4C8}
    .cuidados li{margin-bottom:8px}
    .botoes{display:flex;gap:10px}
    button{font:700 16px Inter,'Segoe UI',Arial,sans-serif;padding:12px 16px;border-radius:10px;border:0;background:#2E3238;color:#F5F3EB;cursor:pointer;flex:1}
    button.prim{background:#FFCC00;color:#17191C}
    .lista{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
    .lista button{padding:8px 0;font-size:14px;flex:none}
    .lista button[aria-current=true]{background:#FFCC00;color:#17191C}
    .dica{font-size:13px;color:#9A978E;line-height:1.5}`;
  function montarNotas(d) {
    d.open();
    d.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Notas — Praça Reversa</title><style>${CSS_NOTAS}</style></head><body>
      <header><span class="cena" id="n-num"></span><h1 id="n-tit"></h1><span class="tempo" id="n-tempo" title="Tempo desde que as notas foram abertas">00:00</span><span class="hora" id="n-hora"></span></header>
      <main><section class="fala" id="n-fala"></section>
      <aside>
        <div class="botoes"><button id="n-ant">‹ Anterior</button><button class="prim" id="n-prox">Próxima ›</button></div>
        <div><h2>Próxima cena</h2><div class="prox" id="n-prox-tit"></div></div>
        <div><h2>Lembretes</h2><ul class="cuidados" id="n-cuid"></ul></div>
        <div><h2>Ir para</h2><div class="lista" id="n-lista"></div></div>
        <div class="dica">Esta janela fica no seu monitor; a apresentação vai para o projetor (tela estendida). Setas, espaço e PageUp/PageDown funcionam aqui também. Em tela espelhada, use o roteiro impresso ou no celular.</div>
        <button id="n-zerar">Zerar tempo</button>
      </aside></main></body></html>`);
    d.close();
  }
  function atualizarNotas() {
    if (!jNotas || jNotas.closed) return;
    const d = jNotas.document;
    const r = R[atual];
    const prox = R[atual + 1];
    d.getElementById('n-num').textContent = `CENA ${r.id} / ${String(total).padStart(2, '0')}`;
    d.getElementById('n-tit').textContent = r.titulo;
    d.getElementById('n-fala').innerHTML = r.fala.map((p) => `<p>${p}</p>`).join('');
    d.getElementById('n-prox-tit').textContent = prox ? `${prox.id} · ${prox.titulo}` : 'Fim — permanecer nesta cena';
    d.getElementById('n-cuid').innerHTML = (r.cuidados || []).map((c) => `<li>${c}</li>`).join('') || '<li>—</li>';
    d.getElementById('n-lista').innerHTML = R.map((x, i) => `<button data-ir="${i}" aria-current="${i === atual}">${x.id}</button>`).join('');
    d.title = `Notas ${r.id} — Praça Reversa`;
  }
  function relogio() {
    if (!jNotas || jNotas.closed) { clearInterval(tRelogio); tRelogio = null; return; }
    const s = Math.floor((Date.now() - inicioFala) / 1000);
    const d = jNotas.document;
    d.getElementById('n-tempo').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    d.getElementById('n-hora').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function abrirNotas() {
    if (jNotas && !jNotas.closed) { jNotas.focus(); return; }
    jNotas = window.open('', 'praca-reversa-notas', 'popup=yes,width=1200,height=820');
    if (!jNotas) { aviso('O navegador bloqueou a janela de notas. Permita janelas pop-up para este arquivo ou use o "Roteiro do apresentador".'); return; }
    try {
      montarNotas(jNotas.document);
    } catch {
      aviso('Não foi possível preparar a janela de notas neste navegador. Use o "Roteiro do apresentador".');
      return;
    }
    const d = jNotas.document;
    d.getElementById('n-ant').onclick = () => anterior();
    d.getElementById('n-prox').onclick = () => proxima();
    d.getElementById('n-zerar').onclick = () => { inicioFala = Date.now(); relogio(); };
    d.getElementById('n-lista').addEventListener('click', (ev) => { const b = ev.target.closest('[data-ir]'); if (b) ir(Number(b.dataset.ir), 'salto'); });
    d.addEventListener('mousedown', (ev) => { if (ev.target.closest('button')) ev.preventDefault(); });
    jNotas.addEventListener('keydown', (ev) => teclado(ev, 'notas'));
    inicioFala = Date.now();
    clearInterval(tRelogio);
    tRelogio = setInterval(relogio, 1000);
    relogio();
    atualizarNotas();
  }
  ouvintes.add(atualizarNotas);
  window.addEventListener('beforeunload', () => { clearInterval(tRelogio); });

  // ---------- Início ----------
  aplicarCalmo();
  prefereCalmo.addEventListener?.('change', (ev) => { calmo = ev.matches; aplicarCalmo(); });
  const inicial = Math.max(0, Math.min(total - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));
  document.fonts.ready.then(() => {
    $('#carregando')?.remove();
    ir(inicial, 'salto');
    mostrarControles();
    document.body.dataset.pronto = '1';
  });
  window.addEventListener('hashchange', () => {
    const n = (parseInt(location.hash.slice(1), 10) || 1) - 1;
    if (n !== atual) ir(n, 'salto');
  });

  // Somente para conferência automatizada (sem efeito na apresentação).
  window.PR_APRESENTACAO = { ir, proxima, anterior, atual: () => atual, total, calmo: () => calmo };
})();
