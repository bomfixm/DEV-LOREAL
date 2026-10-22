// As 12 cenas. Cada uma devolve o HTML do estado de leitura; as animações de entrada só definem o início
// (data-e + --i), então saltar, voltar ou abrir pelo índice mostra sempre a cena completa.
(() => {
  const D = window.PR_DADOS;
  const M = window.PR_MAPA;
  const r256 = D.registros.p256;
  const r257 = D.registros.p257;

  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const px = (n) => `${Math.round(n * 10) / 10}px`;
  /** Atributos de entrada: tipo, ordem e estilo extra. */
  const e = (tipo, i, estilo = '') => `data-e="${tipo}" style="--i:${i};${estilo}"`;

  // ---------- Ícones (traço único, mesma família) ----------
  const ICONE_APP = '<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="104" fill="#FFCC00"/><g fill="#D40511"><path d="M352 232V184Q352 136 304 136H190" fill="none" stroke="#D40511" stroke-width="40" stroke-linecap="round"/><path d="M226 92L178 136L226 180" fill="none" stroke="#D40511" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/><rect x="104" y="282" width="304" height="36" rx="6"/><rect x="120" y="318" width="56" height="50"/><rect x="228" y="318" width="56" height="50"/><rect x="336" y="318" width="56" height="50"/><rect x="104" y="368" width="304" height="30" rx="6"/></g></svg>';
  const ICONE_PALETE = '<svg viewBox="0 -4 54 40" aria-hidden="true" style="color:#D40511"><g fill="currentColor"><rect x="0" y="2" width="54" height="9" rx="2"/><rect x="3" y="11" width="10" height="11"/><rect x="22" y="11" width="10" height="11"/><rect x="41" y="11" width="10" height="11"/><rect x="0" y="22" width="54" height="8" rx="2"/></g></svg>';
  const ICONE_DOC = '<svg viewBox="0 0 22 26" aria-hidden="true"><path d="M3 1h11l6 6v16a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 1v6h6M6 13h10M6 18h7" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const ICONE_OK = '<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="none" stroke="#17784A" stroke-width="2.5"/><path d="M8.5 14.5l3.8 3.8 7.4-8" fill="none" stroke="#17784A" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICONE_SETA = '<svg viewBox="0 0 80 32" aria-hidden="true"><path d="M4 16h66M58 6l12 10-12 10" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICONE_ABRIR = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M5 7l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const marca = () => `<div class="marca">${ICONE_APP}<span>Praça Reversa</span></div>`;
  const selo = (estado, nome) => {
    const cls = estado === 'TESTE' ? ' teste' : estado === 'AJUSTE' ? ' ajuste' : '';
    return `<span class="selo${cls}"><i></i><span class="estado">${esc(D.selos[estado])}</span><span class="sep">·</span><span>${esc(nome)}</span></span>`;
  };
  const exemplo = () => `<span class="exemplo">${ICONE_DOC}${esc(D.inventario.rotulo)}</span>`;
  const paleteTitulo = (r, ponte) => `<div class="palete-titulo"${ponte ? ` data-ponte="${ponte}"` : ''}>${ICONE_PALETE}<span>Palete ${esc(r.palete)}</span></div>`;
  const placa = (r) => `<div class="placa"><small>Posição</small><b>${esc(r.posicao)}</b></div>`;
  const campo = (k, v, vazio) => `<div class="campo"><span class="k">${esc(k)}</span><span class="v${vazio ? ' vazio' : ''}">${esc(v)}</span></div>`;
  const delivery = (r) => campo('Delivery', r.delivery || 'Não informado', !r.delivery);

  // ---------- Mapa (geometria real do escopo, sem ocupação) ----------
  const VB_ATIVA = [14, 1600, 1520, 1092];
  const TEMAS = {
    escuro: { zona: '#1C1F23', borda: '#2E3238', corr: '#15171A', pos: '#272B31', posBorda: '#3A3F47', txt: '#8C9198', rua: '#D6D2C6', titulo: '#8C8A82', desat: '#24272C', suave: '#FFCC00' },
    claro: { zona: '#FFFFFF', borda: '#DAD5C7', corr: '#F2EFE7', pos: '#F8F6F0', posBorda: '#CFC9B8', txt: '#6B6F77', rua: '#30343A', titulo: '#7A7D84', desat: '#E7E3D8', suave: '#8A6400' },
  };
  function svgMapa(o) {
    const T = TEMAS[o.tema || 'escuro'];
    const d = o.destaques || {};
    const vb = o.vb || VB_ATIVA;
    let s = `<svg class="mapa-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${o.w}" height="${o.h}" aria-hidden="true">`;
    s += `<defs><filter id="${o.id}-brilho" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="10"/></filter></defs>`;
    for (const z of M.zonas) {
      if (z.codigo !== 'Z-ATIVA' && !o.desativadas) continue;
      s += `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="22" fill="${T.zona}" stroke="${T.borda}" stroke-width="2"/>`;
      if (o.tituloZona !== false) s += `<text x="${z.x + 26}" y="${z.y + 38}" font-size="22" font-weight="700" fill="${T.titulo}">${esc(z.rotulo)}</text>`;
    }
    for (const c of M.corredores) {
      if (!c.codigo.startsWith('FC') && !o.desativadas) continue;
      s += `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="8" fill="${T.corr}"/>`;
    }
    if (o.ruas !== false) {
      for (const b of M.blocos) {
        if (!b.ativo) continue;
        s += `<text x="${b.x + b.w / 2}" y="${b.y + 27}" text-anchor="middle" font-size="20" font-weight="700" fill="${T.rua}">${esc(b.nome.replace(' (GR)', ''))}</text>`;
      }
    }
    for (const [x, y, w, h, rot, end, des] of M.posicoes) {
      if (des) {
        if (o.desativadas) s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${T.desat}"/>`;
        continue;
      }
      const tipo = d[end];
      let fill = T.pos, stroke = T.posBorda, sw = 1.5, cor = T.txt, peso = 600, op = o.opacidade || 1;
      if (tipo === 'forte') {
        s += `<rect class="brilho-pos anima-continua" x="${x - 8}" y="${y - 8}" width="${w + 16}" height="${h + 16}" rx="14" fill="#FFCC00" opacity=".6" filter="url(#${o.id}-brilho)"/>`;
        fill = '#FFCC00'; stroke = '#FFE27A'; sw = 2; cor = '#17191C'; peso = 800; op = 1;
      } else if (tipo === 'suave') {
        fill = 'rgba(255,204,0,.14)'; stroke = '#FFCC00'; sw = 3; cor = T.suave; peso = 800; op = 1;
      }
      s += `<g opacity="${op}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
      if (o.rotulos !== false) s += `<text x="${x + w / 2}" y="${y + h / 2 + 6}" text-anchor="middle" font-size="17" font-weight="${peso}" fill="${cor}">${esc(rot)}</text>`;
      s += '</g>';
    }
    return s + '</svg>';
  }
  const posicao = (endereco) => M.posicoes.find((p) => p[5] === endereco);

  // Cena 05: enquadramento da câmera (visão geral da L'Oréal → aproximação na Rua 11).
  const C5 = (() => {
    const W = 940, H = 840, svgW = 900;
    const k = svgW / VB_ATIVA[2];
    const svgH = VB_ATIVA[3] * k;
    const ox = 20, oy = (H - svgH) / 2;
    const jan = [-200, 1610, 760, (760 * H) / W];
    const S = W / (jan[2] * k);
    const tx = -S * (ox + (jan[0] - VB_ATIVA[0]) * k);
    const ty = -S * (oy + (jan[1] - VB_ATIVA[1]) * k);
    const f = W / jan[2];
    const pt = (ux, uy) => ({ x: (ux - jan[0]) * f, y: (uy - jan[1]) * f });
    return { W, H, svgW, svgH, ox, oy, jan, S, tx, ty, pt, f };
  })();

  // ---------- Cenas ----------
  const cenas = [];

  // 01 — Cada volume no lugar certo
  cenas.push({
    id: '01', fundo: 'fundo-escuro', saida: 'aproxima',
    html: () => `
      <div class="luz l-amarela" style="left:880px;top:-240px;width:1500px;height:1150px;--dx:-130px;--dy:70px;animation-duration:15s"></div>
      <div class="luz l-quente" style="left:-360px;top:620px;width:1100px;height:820px;--dx:140px;--dy:-50px;animation-duration:12s"></div>
      <div class="c1-moldura" ${e('escala', 0, 'left:690px;top:58px;width:1320px;height:968px')}></div>
      <div class="c1-moldura" ${e('escala', 1, 'left:722px;top:92px;width:1250px;height:900px')}></div>
      <div class="c1-mapa camada-lenta" style="--dx:-16px;--dy:9px">
        <div ${e('plano', 2)}>${svgMapa({ id: 'm1', tema: 'escuro', w: 1150, h: Math.round((1150 * VB_ATIVA[3]) / VB_ATIVA[2]) })}</div>
      </div>
      <div class="c1-veu"></div>
      <div class="c1-texto">
        <div class="c1-icone" ${e('escala', 2)}>${ICONE_APP}</div>
        <h1 class="titulo c1-titulo" ${e('sobe', 3)}>Praça <span class="destaque">Reversa</span></h1>
        <p class="c1-frase" ${e('sobe', 5)}>Cada volume no lugar certo.</p>
        <p class="c1-contexto" ${e('sobe', 6)}>Logística reversa · Operação DHL / L’Oréal</p>
      </div>
      <div class="c1-rodape" ${e('fade', 8)}><span class="dhl-placa"><span class="dhl-img" role="img" aria-label="DHL"></span></span><span>Ao fundo: desenho real da praça, área da L’Oréal</span></div>`,
  });

  // 02 — Organização precisa de informação
  const c2Cartao = (x, i, n, titulo, texto, fichas, ponte) => `
      <div class="cartao c2-cartao" ${e('sobe', i, `left:${x}px`)}${ponte ? ` data-ponte="${ponte}"` : ''}>
        <div class="ordem">${n}</div><h3>${titulo}</h3><p>${texto}</p>
        <div class="fichas">${fichas.map((f) => `<span class="ficha">${f}</span>`).join('')}</div>
      </div>`;
  cenas.push({
    id: '02', fundo: 'fundo-claro',
    html: () => `
      <div class="luz l-branca" style="left:1100px;top:-300px;width:1300px;height:900px;--dx:-80px;--dy:40px;animation-duration:16s"></div>
      <div class="luz l-amarela-suave" style="left:-200px;top:560px;width:1200px;height:800px;--dx:120px;--dy:-30px;animation-duration:13s"></div>
      ${marca()}
      <div class="abs" style="left:120px;top:150px;width:1500px">
        <h2 class="titulo" ${e('sobe', 0)}>Organização precisa de informação.</h2>
        <p class="apoio" ${e('sobe', 1, 'margin-top:22px')}>A busca física fica mais difícil quando o cadastro não acompanha o piso.</p>
      </div>
      <svg class="abs" style="left:120px;top:530px" width="1680" height="40" aria-hidden="true"><path ${e('traco', 4, '--comp:1200')} d="M250 20H1430" stroke="#FFCC00" stroke-width="6" stroke-linecap="round" fill="none"/></svg>
      ${c2Cartao(120, 2, '01', 'Conteúdo', 'Que nota é, de quem veio.', ['Tipo', 'Número', 'Remetente'], 'conteudo')}
      ${c2Cartao(710, 3, '02', 'Endereço', 'Em que rua e posição está.', ['Rua', 'Posição'])}
      ${c2Cartao(1300, 4, '03', 'Quantidade', 'Quantos volumes há de fato.', ['Volumes contados'])}
      <div class="c2-verbos" ${e('sobe', 6)}><span>Localizar</span><span>Conferir</span><span>Preparar a saída</span></div>`,
  });

  // 03 — Uma nota. Paletes diferentes.
  const c3Palete = (r, x, i) => `
      <div class="cartao c3-pal" ${e('sobe', i, `left:${x}px`)}>
        <div class="topo">${paleteTitulo(r)}${placa(r)}</div>
        <div class="dados">${campo('Volumes', r.volumes)}${campo('FULL', r.full)}${delivery(r)}</div>
      </div>`;
  cenas.push({
    id: '03', fundo: 'fundo-claro',
    html: () => `
      <div class="luz l-amarela-suave" style="left:500px;top:300px;width:1300px;height:900px;--dx:-90px;--dy:-40px;animation-duration:14s"></div>
      ${marca()}
      <h2 class="titulo abs" ${e('sobe', 0, 'left:120px;top:150px')}>Uma nota. <span class="destaque">Paletes diferentes.</span></h2>
      <div class="c3-doc" ${e('escala', 1)} data-ponte="conteudo registro">
        <div><div class="rotulo">Documento</div><div class="num-doc num">${esc(r256.tipo)} ${esc(r256.numero)}</div></div>
        <div class="rem"><div class="rotulo">Remetente</div><b>${esc(r256.remetente)}</b></div>
      </div>
      <svg class="abs" style="left:120px;top:440px" width="1680" height="100" aria-hidden="true">
        <path ${e('traco', 3, '--comp:220')} d="M400 0 C400 50 400 50 400 100" stroke="#FFCC00" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path ${e('traco', 3, '--comp:220')} d="M1280 0 C1280 50 1280 50 1280 100" stroke="#FFCC00" stroke-width="5" fill="none" stroke-linecap="round"/>
      </svg>
      ${c3Palete(r256, 120, 4)}
      ${c3Palete(r257, 1000, 5)}
      <div class="c3-rodape" ${e('fade', 7)}>${exemplo()}<span class="nota-tela">Dois registros da mesma nota · não é o total da nota</span></div>`,
  });

  // 04 — A informação já existe
  cenas.push({
    id: '04', fundo: 'fundo-claro',
    html: () => `
      <div class="luz l-branca" style="left:1000px;top:200px;width:1200px;height:1000px;--dx:-60px;--dy:-60px;animation-duration:15s"></div>
      ${marca()}
      <div class="abs" style="left:120px;top:150px;width:1600px">
        <h2 class="titulo" ${e('sobe', 0)}>A informação já existe.</h2>
        <p class="apoio" ${e('sobe', 1, 'margin-top:18px')}>Menos redigitação. Mais cuidado com a origem dos dados.</p>
      </div>
      <div class="cartao c4-fonte" ${e('plano', 2, 'top:350px')} data-ponte="registro">
        <div class="cab"><b>Inventário da praça</b><span class="rotulo">Aba ${esc(D.inventario.aba)} · linha ${r256.linha}</span></div>
        <div class="c4-linha">
          <div class="k">Palete</div><div class="k">Posição</div><div class="k">Documento</div><div class="k">Volumes</div><div class="k">FULL</div>
          <div class="v">${esc(r256.palete)}</div><div class="v">${esc(r256.posicao)}</div><div class="v">${esc(r256.tipo)} ${esc(r256.numero)}</div><div class="v">${r256.volumes}</div><div class="v">${esc(r256.full)}</div>
        </div>
        <div style="margin-top:18px">${exemplo()}</div>
      </div>
      <div class="cartao c4-fonte" ${e('plano', 3, 'top:660px')}>
        <div class="cab"><b>Bipagem de um palete</b><span class="rotulo">1 arquivo = 1 palete</span></div>
        <div class="c4-colunas">
          <span class="col-chip principal">Tipo</span><span class="col-chip principal">Número</span><span class="col-chip principal">Lidos</span><span class="col-chip principal">Remetente</span>
          <span class="legenda">+</span><span class="col-chip adicional">CNPJ</span><span class="col-chip adicional">Última leitura</span>
        </div>
        <div class="c4-colunas"><span class="col-chip manual">Delivery</span><span class="col-chip manual">SKU</span><span class="col-chip manual">Validade</span><span class="legenda">manuais e opcionais</span></div>
      </div>
      <div class="c4-trilho">
        <svg class="abs" style="left:30px;top:30px" width="6" height="400" aria-hidden="true"><path ${e('traco', 4, '--comp:400')} d="M3 0V400" stroke="#FFCC00" stroke-width="5" fill="none"/></svg>
        <div class="c4-passo" ${e('direita', 4, 'top:0')}><div class="bola">1</div><div><h3>Importar</h3><p>O arquivo vira uma prévia.</p></div></div>
        <div class="c4-passo" ${e('direita', 5, 'top:200px')}><div class="bola">2</div><div><h3>Revisar</h3><p>Nota repetida fica à parte, sem somar.</p></div></div>
        <div class="c4-passo" ${e('direita', 6, 'top:400px')}><div class="bola">3</div><div><h3>Confirmar</h3><p>A pessoa escolhe a posição no mapa e confirma.</p></div></div>
      </div>
      <div class="selos abs" ${e('fade', 8, 'left:120px;top:970px')}>${selo('DISPONIVEL', 'Bipagem de um palete')}${selo('AJUSTE', 'Carga do inventário completo')}</div>`,
  });

  // 05 — Onde está o palete 256?
  const c5Marca = (r, tipo, i, extraTexto) => {
    const p = posicao(r.posicao);
    const a = C5.pt(p[0], p[1]);
    const meio = a.y + (p[3] * C5.f) / 2;
    return `<div class="c5-marca" style="left:${px(a.x - 4)};top:${px(meio)}"><div>
        <div ${e('esquerda', i, 'display:flex;align-items:center;gap:12px')}>
          ${extraTexto ? `<span style="font-size:18px;font-weight:600;color:var(--tx-escuro-3)">${extraTexto}</span>` : ''}
          <span class="palete-chip${tipo === 'suave' ? ' suave' : ''}"${tipo === 'forte' ? ' data-ponte="p256"' : ''}>${ICONE_PALETE}Palete ${esc(r.palete)}</span>
        </div><div class="fio" ${e('largura', i + 1)}></div></div></div>`;
  };
  cenas.push({
    id: '05', fundo: 'fundo-escuro',
    html: () => {
      const mini = 216 / VB_ATIVA[2];
      const miniOy = 8 + (166 - VB_ATIVA[3] * mini) / 2;
      const jx0 = Math.max(C5.jan[0], VB_ATIVA[0]);
      return `
      <div class="luz l-amarela-suave" style="left:400px;top:-300px;width:1600px;height:1100px;--dx:-100px;--dy:80px;animation-duration:16s"></div>
      ${marca()}
      <div class="c5-esq">
        <h2 class="titulo" ${e('sobe', 0)}>Onde está o<br><span class="destaque">palete 256?</span></h2>
      </div>
      <div class="c5-caminho">
        <span class="doc-chip" ${e('esquerda', 1)}>${ICONE_DOC.replace('<svg', '<svg style="width:22px;height:26px"')}${esc(r256.tipo)} ${esc(r256.numero)}</span>
        <div class="liga" ${e('altura', 2)}></div>
        <span class="palete-chip" ${e('esquerda', 2)}>${ICONE_PALETE}Palete ${esc(r256.palete)}</span>
        <div class="liga" ${e('altura', 3)}></div>
        <div ${e('esquerda', 3)}>${placa(r256)}</div>
      </div>
      <div class="abs" ${e('fade', 5, 'left:120px;top:850px')}>${exemplo()}</div>
      <div class="selos abs" ${e('fade', 6, 'left:120px;top:900px')}>${selo('DISPONIVEL', 'Mapa e busca')}</div>
      <div class="cartao-escuro c5-painel" ${e('escala', 1)}>
        <div class="legenda-painel">Área da L’Oréal · desenho real da praça</div>
        <div class="mapa-camera" style="transform:translate(${px(C5.tx)},${px(C5.ty)}) scale(${C5.S.toFixed(4)})">
          <div class="abs" style="left:${px(C5.ox)};top:${px(C5.oy)}">${svgMapa({ id: 'm5', tema: 'escuro', tituloZona: false, w: C5.svgW, h: Math.round(C5.svgH), destaques: { [r256.posicao]: 'forte', [r257.posicao]: 'suave' } })}</div>
        </div>
        ${c5Marca(r256, 'forte', 1)}
        ${c5Marca(r257, 'suave', 2)}
        <div class="c5-mini" ${e('fade', 4, 'animation-delay:1.7s')}>
          <div class="abs" style="left:8px;top:${px(miniOy)}">${svgMapa({ id: 'mm5', tema: 'escuro', w: 216, h: Math.round(VB_ATIVA[3] * mini), rotulos: false, ruas: false, tituloZona: false })}</div>
          <div class="janela" style="left:${px(8 + (jx0 - VB_ATIVA[0]) * mini)};top:${px(miniOy + (C5.jan[1] - VB_ATIVA[1]) * mini)};width:${px((C5.jan[0] + C5.jan[2] - jx0) * mini)};height:${px(C5.jan[3] * mini)}"></div>
        </div>
      </div>`;
    },
  });

  // 06 — O essencial, logo de cara.
  const VB_TRILHA = [28, 1648, 112, 500];
  const trilhaF = 180 / VB_TRILHA[2];
  cenas.push({
    id: '06', fundo: 'fundo-claro',
    html: () => {
      const p = posicao(r256.posicao);
      const meio = 150 + (p[1] + p[3] / 2 - VB_TRILHA[1]) * trilhaF;
      return `
      <div class="luz l-amarela-suave" style="left:200px;top:-200px;width:1100px;height:900px;--dx:80px;--dy:60px;animation-duration:14s"></div>
      ${marca()}
      <div class="c6-trilha" ${e('fade', 0)}>${svgMapa({ id: 'm6', tema: 'claro', vb: VB_TRILHA, w: 180, h: Math.round(VB_TRILHA[3] * trilhaF), opacidade: 0.55, tituloZona: false, destaques: { [r256.posicao]: 'forte' } })}</div>
      <div class="c6-fio" ${e('largura', 2, `top:${px(meio - 1.5)};width:100px`)}></div>
      <h2 class="titulo abs" ${e('sobe', 0, 'left:400px;top:140px')}>O essencial, logo de cara.</h2>
      <div class="cartao c6-janela" ${e('plano', 1)}>
        <div class="topo">${paleteTitulo(r256, 'p256')}${placa(r256)}</div>
        <div class="grade">
          ${campo('Documento', `${r256.tipo} ${r256.numero}`)}${campo('Volumes', r256.volumes)}${campo('FULL', r256.full)}
          ${delivery(r256)}<div class="largo">${campo('Remetente', r256.remetente)}</div>
        </div>
        <div class="mais"><span>Mais informações${ICONE_ABRIR}</span><span>Conferência informada no inventário: ${esc(r256.conferencia)}</span></div>
      </div>
      <div class="c6-rodape" ${e('fade', 4)}>${exemplo()}${selo('DISPONIVEL', 'Janela do palete')}</div>
      <div class="c6-nota nota-tela" ${e('fade', 5)}>Composição da apresentação com os dados do inventário · não é captura da tela</div>`;
    },
  });

  // 07 — Pedido não é baixa de estoque.
  const c7Passo = (x, i, n, titulo, texto, op) => `<div class="cartao c7-passo${op ? ' op' : ''}" ${e('sobe', i, `left:${x}px`)}><div class="n">${n}</div><h3>${titulo}</h3><p>${texto}</p></div>`;
  const c7Seta = (x, i) => `<div class="c7-seta" ${e('fade', i, `left:${x}px`)}>${ICONE_SETA}</div>`;
  cenas.push({
    id: '07', fundo: 'fundo-claro',
    html: () => `
      <div class="luz l-branca" style="left:-200px;top:-200px;width:1200px;height:900px;--dx:90px;--dy:50px;animation-duration:15s"></div>
      ${marca()}
      <div class="abs" style="left:120px;top:150px;width:1600px">
        <h2 class="titulo" ${e('sobe', 0)}>Pedido não é <span class="destaque">baixa de estoque.</span></h2>
        <p class="apoio" ${e('sobe', 1, 'margin-top:18px')}>O cliente escolhe o que quer receber. A operação separa e registra a saída.</p>
      </div>
      <div class="c7-faixa" ${e('fade', 2, 'left:120px;width:800px;border-color:#B9B3A2;color:var(--tx-2)')}><span>Cliente</span></div>
      <div class="c7-faixa" ${e('fade', 3, 'left:1000px;width:800px;border-color:var(--grafite);color:var(--tx)')}><span>Operação</span></div>
      ${c7Passo(120, 2, '01', 'Solicitar', 'escolhe os volumes')}
      ${c7Seta(480, 3)}
      ${c7Passo(560, 3, '02', 'Revisar', 'resumo e observações')}
      ${c7Seta(920, 4)}
      ${c7Passo(1000, 4, '03', 'Separar', 'a operação prepara', true)}
      ${c7Seta(1360, 5)}
      ${c7Passo(1440, 5, '04', 'Registrar a saída', 'baixa efetiva', true)}
      <div class="c7-regra" ${e('plano', 6)}><b>Selecionar não dá baixa nem libera posição.</b><span>O saldo não solicitado permanece no palete.</span></div>
      <div class="c7-opcoes" ${e('sobe', 7)}>
        <div class="rotulo">O cliente pode pedir</div>
        <div class="lista"><div class="op-item"><i></i>Palete FULL</div><div class="op-item"><i></i>Parte de uma nota</div><div class="op-item"><i></i>Delivery específica</div></div>
      </div>
      <div class="selos abs" ${e('fade', 9, 'left:120px;top:960px;align-items:center')}>${selo('TESTE', 'Seleção do cliente no app')}<span class="nota-tela">O processo atual pela planilha continua valendo.</span></div>`,
  });

  // 08 — Conferir precisa atualizar o estoque.
  const c8Elo = (x, i, n, titulo, texto) => `<div class="cartao-escuro c8-elo" ${e('sobe', i, `left:${x}px`)}><div class="n">${n}</div><h3>${titulo}</h3><p>${texto}</p></div>`;
  cenas.push({
    id: '08', fundo: 'fundo-escuro',
    html: () => `
      <div class="luz l-quente" style="left:900px;top:300px;width:1300px;height:1000px;--dx:-120px;--dy:-40px;animation-duration:14s"></div>
      ${marca()}
      <h2 class="titulo abs" ${e('sobe', 0, 'left:120px;top:150px')}>Conferir precisa <span class="destaque">atualizar o estoque.</span></h2>
      <svg class="abs" style="left:120px;top:408px" width="1680" height="8" aria-hidden="true"><path ${e('traco', 2, '--comp:1600')} d="M40 4H1640" stroke="#FFCC00" stroke-width="4" stroke-linecap="round" fill="none" opacity=".75"/></svg>
      ${c8Elo(120, 1, '01', 'Contagem', 'o que foi contado no piso')}
      ${c8Elo(552, 2, '02', 'Quantidade atual', 'passa a valer no palete')}
      ${c8Elo(984, 3, '03', 'Status', 'estado e cor do palete')}
      ${c8Elo(1416, 4, '04', 'Histórico', 'quem, quando e quanto')}
      <div class="c8-vinte" ${e('sobe', 5)}>
        <div class="grande"><b class="num">20</b><span>dias sem movimentação</span></div>
        <p>Regra de atenção para nova conferência, contada da última conferência completa.</p>
      </div>
      <div class="c8-grade">${Array.from({ length: 20 }, (_, n) => `<div class="${n === 19 ? 'fim' : ''}" ${e('escala', 6 + n * 0.25)}>${n + 1}</div>`).join('')}</div>
      <div class="c8-grade-legenda" ${e('fade', 9)}>Regra em dias, não um calendário · abrir a tela não renova o prazo</div>
      <div class="selos abs" ${e('fade', 10, 'left:120px;top:968px')}>${selo('DISPONIVEL', 'Conferência do palete em tabela')}${selo('DISPONIVEL', 'Aviso de 20 dias')}</div>`,
  });

  // 09 — Sem endereço confirmado? Validar.
  cenas.push({
    id: '09', fundo: 'fundo-claro',
    html: () => {
      const h = 618, w = Math.round((h * VB_ATIVA[2]) / VB_ATIVA[3]);
      return `
      <div class="luz l-amarela-suave" style="left:1100px;top:200px;width:1100px;height:900px;--dx:-80px;--dy:50px;animation-duration:15s"></div>
      ${marca()}
      <div class="abs" style="left:120px;top:150px;width:1500px">
        <h2 class="titulo" ${e('sobe', 0)}>Sem endereço confirmado? <span class="destaque">Validar.</span></h2>
        <p class="apoio" ${e('sobe', 1, 'margin-top:18px')}>Não inventar localização. Pendências internas ficam fora do mapa físico e da visão do cliente.</p>
      </div>
      <div class="cartao c9-mapa" ${e('escala', 2)}><div class="abs" style="left:${(1040 - w) / 2}px;top:11px">${svgMapa({ id: 'm9', tema: 'claro', w, h })}</div></div>
      <div class="cartao c9-gaveta" ${e('direita', 4)}>
        <div class="rotulo">Área interna</div>
        <h3>Validação interna</h3>
        <ul>
          <li>${ICONE_OK}Não é uma posição física</li>
          <li>${ICONE_OK}Não conta como espaço ocupado</li>
          <li>${ICONE_OK}Não aparece para o cliente</li>
          <li>${ICONE_OK}Origem e histórico preservados</li>
        </ul>
        <div class="resolve">Com o endereço confirmado, a nota vai para o palete certo, com histórico.</div>
        <div class="pe">${selo('DISPONIVEL', 'Fila de validação')}</div>
      </div>`;
    },
  });

  // 10 — Cada pessoa vê o que precisa.
  cenas.push({
    id: '10', fundo: 'fundo-claro',
    html: () => `
      <div class="luz l-branca" style="left:700px;top:-300px;width:1300px;height:900px;--dx:-70px;--dy:60px;animation-duration:16s"></div>
      ${marca()}
      <div class="abs" style="left:120px;top:150px;width:1600px">
        <h2 class="titulo" ${e('sobe', 0)}>Cada pessoa vê o que precisa.</h2>
        <p class="apoio" ${e('sobe', 1, 'margin-top:18px')}>A mesma base, com acesso pelo perfil — também nas consultas.</p>
      </div>
      <div class="cartao-escuro c10-lado" ${e('esquerda', 2, 'left:120px')}>
        <div class="rotulo">Operação DHL</div>
        <h3>Estoque, localização e pendências</h3>
        <ul><li><i></i>Conteúdo e volumes dos paletes</li><li><i></i>Localização no mapa</li><li><i></i>Pendências e validação interna</li></ul>
        <div class="pe">${selo('DISPONIVEL', 'Painel da operação')}</div>
      </div>
      <div class="c10-meio" ${e('largura', 3)}></div>
      <div class="cartao c10-lado" ${e('direita', 3, 'left:1000px')}>
        <div class="rotulo">Cliente</div>
        <h3>Informações autorizadas</h3>
        <ul><li><i></i>Material disponível para consulta</li><li><i></i>O que foi solicitado</li><li><i></i>Histórico autorizado</li></ul>
        <div class="pe">${selo('TESTE', 'Painel do cliente')}</div>
      </div>
      <div class="c10-nota nota-tela" ${e('fade', 5)}>A validação interna não aparece na visão do cliente. Sem janelas reais cadastradas, esta cena não mostra números.</div>`,
  });

  // 11 — Cada mudança precisa de rastro.
  cenas.push({
    id: '11', fundo: 'fundo-escuro',
    html: () => `
      <div class="luz l-quente" style="left:-400px;top:-300px;width:1500px;height:1100px;--dx:120px;--dy:60px;animation-duration:15s"></div>
      ${marca()}
      <h2 class="titulo abs" ${e('sobe', 0, 'left:120px;top:150px')}>Cada mudança precisa de <span class="destaque">rastro.</span></h2>
      <div class="c11-cab rotulo" ${e('fade', 1)}><span>Origem</span><span>Responsável</span><span>Data</span><span>Registro</span></div>
      <div class="c11-tempo" ${e('altura', 2)}></div>
      <div class="c11-no real" ${e('escala', 3)}></div>
      <div class="cartao-escuro c11-linha real" ${e('esquerda', 3)}>
        <div>Inventário (planilha) · linha ${r256.linha}</div><div class="vazio">Não registrado</div><div class="num">${esc(r256.conferencia)}</div><div>Conferência informada · Palete ${esc(r256.palete)} · ${r256.volumes} volumes</div>
      </div>
      <div class="c11-no futuro" ${e('escala', 5)}></div>
      <div class="c11-linha futura" ${e('fade', 5)}>Próximos registros no sistema: contagem, movimentação e saída</div>
      <div class="c11-exemplo" ${e('fade', 6)}>${exemplo()}</div>
      <div class="selos c11-selos" ${e('fade', 7)}>${selo('DISPONIVEL', 'Histórico de movimentações')}${selo('AJUSTE', 'Cópia de segurança fora da máquina')}</div>`,
  });

  // 12 — Testar, medir e evoluir.
  const c12Ind = (x, i, titulo, pergunta) => `<div class="cartao c12-ind" ${e('sobe', i, `left:${x}px`)}><div class="rotulo">A medir no piloto</div><h3>${titulo}</h3><p>${pergunta}</p><div class="medida">Sem número ainda: será medido</div></div>`;
  cenas.push({
    id: '12', fundo: 'fundo-claro',
    html: () => `
      <div class="luz l-amarela-suave" style="left:600px;top:400px;width:1500px;height:1000px;--dx:-100px;--dy:-60px;animation-duration:16s"></div>
      <div class="luz l-branca" style="left:-300px;top:-300px;width:1100px;height:900px;--dx:80px;--dy:40px;animation-duration:13s"></div>
      <h2 class="titulo abs" ${e('sobe', 0, 'left:120px;top:150px')}>Transformar visibilidade em resultado.</h2>
      <div class="c12-passos" ${e('sobe', 1)}><span><span class="n">1</span>Validar a base</span><span class="tr"></span><span><span class="n">2</span>Testar no piso</span><span class="tr"></span><span><span class="n">3</span>Medir o efeito</span></div>
      ${c12Ind(120, 2, 'Tempo de localização', 'Quanto tempo leva para achar uma nota na praça?')}
      ${c12Ind(690, 3, 'Diferenças de estoque', 'Quanto a contagem difere do que está registrado?')}
      ${c12Ind(1260, 4, 'Claims investigados', 'Quantos casos de possível perda conseguimos investigar?')}
      <div class="c12-rodape" ${e('fade', 6)}>
        <div class="marca-final">${ICONE_APP}<span>Praça Reversa</span></div>
        <span class="dhl-placa"><span class="dhl-img" role="img" aria-label="DHL"></span></span>
        <div class="direita nota-tela">Versão de teste · piloto no piso a iniciar<br>Dados da apresentação: recorte de ${esc(D.snapshot.data)}</div>
      </div>`,
  });

  window.PR_CENAS = cenas;
})();
