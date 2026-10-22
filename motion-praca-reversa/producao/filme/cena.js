/* Filme de apresentação — Praça Reversa (150 s, 1920×1080, 30 fps).
 * Roteiro: ROTEIRO-MOTION-PRACA-150S.txt (10 cenas). Tudo é função do número
 * do quadro (motor.js). Telas = capturas reais do aplicativo no ambiente
 * isolado (dados fictícios da demonstração); textos, realces, etiquetas,
 * fichas e trilhas são camadas sobrepostas, sem alterar números.
 * Personagem: a NF-e 900123 (5 volumes) do palete PAL-DEMO-001 (11 - A1).
 */
'use strict';
const M = Motor;
const { pista, trecho } = M;
const TOTAL = 4500;
const $ = (id) => document.getElementById(id);
const cap = (n) => `../capturas/${n}`;
const atv = (n) => `../ativos/${n}`;
const TELA = { w: 1920, h: 1080 };
const tela = (id, arquivo) => M.plano({ id, src: cap(arquivo), ...TELA, raio: 14 });

/* ---------- Atalhos que também marcam o som ---------- */
function frase(texto, entra, sai, extra = {}) {
  M.frase({ texto, entra, sai, x: 120, y: 892, tamanho: 64, ...extra });
  M.som(entra, 'texto');
}
function realce(p, x, y, w, h, chaves, classe = '') {
  M.realce(p, { x, y, w, h, chaves, classe });
  const sobe = chaves.find(([, v], i) => i > 0 && v > chaves[i - 1][1]);
  if (sobe) M.som(sobe[0] - 4, 'tic');
}
function ficha(html, de, para, ini, fim, curvatura = 200) {
  M.ficha({ html, de, para, ini, fim, curvatura });
  M.som(ini, 'voo', { dur: fim - ini });
  M.som(fim, 'encaixe');
}
const etiqueta = (html, p, x, y, lado, chaves, classe = 'etiqueta') => M.etiqueta({ html, p, x, y, lado, chaves, classe });
const janela = (a, b, c, d) => [[a, 0], [b, 1, 'out'], [c, 1], [d, 0]];
const cliques = [];
function clicar(p, de, ate, f0, f1) {
  cliques.push([f0, { p, ...de }], [f1, { p, ...ate }, true], [f1 + 12, { p, ...ate }, false, 'oculto']);
  M.som(f1, 'clique');
}

/* =====================================================================
 * Planos (a ordem de criação é a ordem de pintura)
 * ===================================================================== */
// Cena 1: informação dispersa.
const FUNDO1 = M.plano({ id: 'fundo1', src: cap('20-mapa-loreal-escuro.png'), w: 1818, h: 945, raio: 16, sombra: false });
const F_TAB = M.plano({ id: 'f-tab', src: atv('tabela-bipagem.png'), w: 1116, h: 525 });
const F_MAPA = M.plano({ id: 'f-mapa', src: atv('fragmento-mapa.png'), w: 560, h: 760 });
const F_BUSCA = M.plano({ id: 'f-busca', src: atv('campo-busca.png'), w: 556, h: 38, raio: 8 });
const F_L2 = M.plano({ id: 'f-l2', src: atv('linha-bipagem-2.png'), w: 1072, h: 27, raio: 6 });
const F_L3 = M.plano({ id: 'f-l3', src: atv('linha-bipagem-3.png'), w: 1072, h: 27, raio: 6 });
// Cena 3: recebimento.
const S01 = tela('s01', '01-bipagem-tela.png');
const S02 = tela('s02', '02-bipagem-previa.png');
const S03 = tela('s03', '03-bipagem-resultado.png');
const PL = M.plano({ id: 'previa', src: atv('tabela-bipagem.png'), w: 1116, h: 525, raio: 12 });
const HERO = M.plano({ id: 'heroi', src: atv('linha-bipagem.png'), w: 1072, h: 27, raio: 6 });
// Cena 4: mapa e janela do palete.
const UI4 = tela('ui4', '04-mapa-loreal-escuro.png');
const MAPA = M.plano({ id: 'mapa', src: cap('20-mapa-loreal-escuro.png'), w: 1818, h: 945, raio: 0, sombra: false });
const J4 = M.plano({ id: 'janela4', src: cap('22-janela-escuro.png'), w: 860, h: 536, raio: 14 });
// Cena 5: busca, divergência, histórico e QR.
const B30 = tela('b30', '30-busca-resultado-escuro.png');
const B31 = tela('b31', '31-busca-abre-palete-escuro.png');
const P32 = M.plano({ id: 'p32', src: cap('32-prioridades-claro.png'), w: 860, h: 310, raio: 14 });
const M34 = tela('m34', '34-mover-tela-claro.png');
const H35 = tela('h35', '35-historico-correcao-claro.png');
const E36 = M.plano({ id: 'e36', src: cap('36b-etiqueta-elemento.png'), w: 720, h: 1044, raio: 10 });
const J36 = M.plano({ id: 'j36', src: cap('22-janela-claro.png'), w: 860, h: 536, raio: 14 });
// Cena 6: janela de saída.
const V38 = tela('v38', '38-volumes-janela-busca-claro.png');
const V39 = tela('v39', '39-volumes-janela-expedido-claro.png');
const P24 = M.plano({ id: 'p24', src: cap('24-painel-janela-claro.png'), w: 965, h: 334, raio: 14 });
const P40 = M.plano({ id: 'p40', src: cap('40-painel-janela-expedido-claro.png'), w: 965, h: 334, raio: 14 });
// Cena 7: reconferência.
const M41 = M.plano({ id: 'm41', src: cap('41-mapa-final-escuro.png'), w: 1818, h: 945, raio: 16 });
const J42 = M.plano({ id: 'j42', src: cap('42-janela-reconferencia-claro.png'), w: 860, h: 286, raio: 14 });
const R43B = M.plano({ id: 'r43b', src: cap('43b-reconferencia-antes.png'), w: 1116, h: 635, raio: 14 });
const R43C = M.plano({ id: 'r43c', src: cap('43c-reconferencia-depois.png'), w: 1116, h: 688, raio: 14 });
// Cena 8: painel e cliente.
const P48 = M.plano({ id: 'p48', src: cap('48-painel-final-claro.png'), w: 1852, h: 1018, raio: 16 });
const C48B = M.plano({ id: 'c48b', src: cap('48b-painel-cartoes-claro.png'), w: 1640, h: 95, raio: 12 });
const C48C = M.plano({ id: 'c48c', src: cap('48c-painel-janela-claro.png'), w: 965, h: 334, raio: 12 });
const C48D = M.plano({ id: 'c48d', src: cap('48d-painel-prioridades-claro.png'), w: 666, h: 501, raio: 12 });
const C45 = M.plano({ id: 'c45', src: cap('45-painel-cliente-claro.png'), w: 1852, h: 1018, raio: 16 });
// Cena 9: consulta e exportação (tabela = conteúdo do CSV exportado de verdade).
const K46 = tela('k46', '46-consulta-cliente-claro.png');
const CSV_LINHAS = [
  ['Tipo do documento', 'Número', 'Delivery', 'Remetente', 'Volumes', 'Base dos volumes', 'Palete', 'Full/misto', 'Endereço', 'Rua', 'Etapa na janela'],
  ['MI', '4410', '', 'Comercial Exemplo S.A.', '1', 'Contado', 'PAL-DEMO-001', 'Misto', '11 - A1', 'Fileira 11', ''],
  ['MI', '4411', '', 'Distribuidora Demonstração Ltda', '1', 'Contado', 'PAL-DEMO-001', 'Misto', '11 - A1', 'Fileira 11', ''],
  ['NF', '900123', '', 'Distribuidora Demonstração Ltda', '2', 'Contado', 'PAL-DEMO-001', 'Misto', '11 - A1', 'Fileira 11', ''],
  ['NF', '900124', '', 'Distribuidora Demonstração Ltda', '3', 'Contado', 'PAL-DEMO-001', 'Misto', '11 - A1', 'Fileira 11', ''],
  ['NF', '900126', '', 'Comercial Exemplo S.A.', '2', 'Contado', 'PAL-DEMO-001', 'Misto', '11 - A1', 'Fileira 11', ''],
  ['NF', '900127', '', 'Distribuidora Demonstração Ltda', '4', 'Contado', 'PAL-DEMO-001', 'Misto', '11 - A1', 'Fileira 11', ''],
  ['', 'Não informado', '', '', 'Não informado', '', 'PAL-DEMO-002', 'Não informado', '11 - A2', 'Fileira 11', ''],
  ['', 'Não informado', '', '', 'Não informado', '', 'PAL-DEMO-003', 'Não informado', '11 - A3', 'Fileira 11', ''],
  ['', 'Não informado', '', '', 'Não informado', '', 'PAL-DEMO-005', 'Não informado', '11 - A5', 'Fileira 11', ''],
  ['', 'Não informado', '', '', 'Não informado', '', 'PAL-DEMO-004', 'Não informado', 'Localização em atualização', '', ''],
  ['', 'Não informado', '', '', 'Não informado', '', 'PAL-DEMO-006', 'Não informado', 'Localização em atualização', '', ''],
];
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const csvHtml =
  '<div class="csv"><header><i>CSV</i>estoque-2026-10-200203.csv<span>Estoque consultado em 19/10/2026, 23:03 (America/Sao_Paulo)</span></header><table>' +
  CSV_LINHAS.map((l, i) => `<tr${l[1] === '900123' ? ' class="alvo"' : ''}><td>${String(i + 2)}</td>${l.map((c) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('') +
  '</table></div>';
const CSV = M.plano({ id: 'csv', html: csvHtml, w: 1660, h: 470, raio: 12 });
// Cena 10: mapa ao fundo.
const FUNDO10 = M.plano({ id: 'fundo10', src: cap('20-mapa-loreal-escuro.png'), w: 1818, h: 945, raio: 16, sombra: false });

/* =====================================================================
 * Cena 1 (0–360): o material está aqui; a informação precisa acompanhar.
 * ===================================================================== */
M.animar(FUNDO1, [
  [0, { x: 960, y: 640, z: -1100, rx: 56, s: 1.35, op: 0, blur: 5, bright: 0.55 }],
  [40, { op: 0.45 }, 'out'],
  [300, { z: -850, y: 600 }, 'lin'],
  [345, { op: 0, z: -700 }, 'in'],
]);
const deriva = (p, a, b, sumir = 250) =>
  M.animar(p, [
    [0, { ...a, op: 0 }],
    [30, { op: a.op ?? 1 }, 'out'],
    [sumir, b, 'lin'],
    [sumir + 70, { z: b.z - 700, blur: 7, op: 0 }, 'in'],
  ]);
deriva(F_TAB, { x: 520, y: 330, z: -260, rx: 12, ry: 28, rz: -3, s: 0.78, blur: 2.4, op: 0.9 }, { x: 470, y: 320, z: -200 });
deriva(F_MAPA, { x: 1490, y: 470, z: -160, rx: 6, ry: -26, rz: 2, s: 0.82, blur: 1.2, op: 0.95 }, { x: 1440, y: 460, z: -120 }, 240);
deriva(F_BUSCA, { x: 1160, y: 180, z: 120, rx: 10, ry: -14, rz: 1, s: 1.15 }, { x: 1110, y: 176, z: 150 }, 230);
deriva(F_L2, { x: 1120, y: 760, z: -60, rx: 8, ry: 20, rz: 2, s: 0.86, blur: 0.8, op: 0.9 }, { x: 1060, y: 752, z: -30 }, 235);
deriva(F_L3, { x: 600, y: 600, z: -380, rx: 4, ry: 24, rz: -2, s: 0.8, blur: 2.6, op: 0.8 }, { x: 560, y: 596, z: -340 }, 225);
etiqueta('Muitos paletes', F_MAPA, 280, 60, 'cima', janela(40, 52, 200, 214), 'etiqueta limite');
etiqueta('Conteúdo pouco visível', F_TAB, 558, 0, 'cima', janela(70, 82, 200, 214), 'etiqueta limite');
etiqueta('Busca manual', F_BUSCA, 278, 38, 'baixo', janela(100, 112, 205, 218), 'etiqueta limite');
etiqueta('Risco de divergências e claims', F_L3, 536, 0, 'cima', janela(130, 142, 210, 222), 'etiqueta limite');
frase('O material está aqui.', 26, 132, { destaques: ['material'], y: 880, tamanho: 72 });
frase('A informação precisa acompanhar.', 150, 300, { destaques: ['informação'], y: 880, tamanho: 72 });

/* =====================================================================
 * Cena 2 (360–660): Praça Reversa — informação conectada à operação.
 * Cena 3 (660–1200): da bipagem ao palete.
 * ===================================================================== */
// Telas do recebimento: mesma câmera; a troca entre elas é a mudança de estado da página.
const K_REC = [
  [664, { focoX: 990, focoY: 330, x: 960, y: 660, z: -900, rx: 22, ry: -18, s: 1.0, op: 0 }],
  [702, { y: 520, z: 0, rx: 6, ry: -6, s: 1.2, op: 1 }, 'expo'],
  [740, { focoX: 600, focoY: 408, x: 760, y: 540, rx: 4, ry: -4, s: 1.35 }],
  [752, {}],
  [792, { focoX: 994, focoY: 578, x: 960, y: 540, rx: 3, ry: -3, s: 1.0, bright: 0.42, blur: 4 }],
  [960, {}],
  [985, { focoX: 800, focoY: 760, x: 960, y: 560, rx: 2, ry: -2, s: 1.25, bright: 1, blur: 0 }],
  [1024, {}],
  [1056, { focoX: 870, focoY: 390, x: 900, y: 520, s: 1.6 }],
  [1150, { s: 1.66 }, 'lin'],
  [1190, { z: -700, rx: 18, ry: 14, op: 0, blur: 4 }, 'in'],
];
M.animar(S01, K_REC, [[0, 1], [744, 1], [756, 0]]);
M.animar(S02, K_REC, [[744, 0], [756, 1], [1014, 1], [1026, 0]]);
M.animar(S03, K_REC, [[1014, 0], [1026, 1]]);
M.som(670, 'entra');
M.som(750, 'troca');
M.som(1020, 'confirma');

// A prévia (cartão real da tela) se descola, inclina e volta ao lugar.
M.animar(
  PL,
  [
    [760, { ...M.alinhar(S02, 760, 436, 316), op: 1 }],
    [802, { focoX: 558, focoY: 262, x: 960, y: 540, z: 80, rx: 6, ry: -10, rz: 0, s: 1.35 }],
    [848, { s: 1.38 }, 'lin'],
    [878, { focoX: 380, focoY: 88, x: 880, y: 470, rx: 4, ry: -6, s: 1.7 }],
    [905, { s: 1.72 }, 'lin'],
    [930, { focoX: 420, focoY: 301, x: 860, y: 540, rx: 3, ry: -5, s: 1.95 }],
    [958, { s: 1.98 }, 'lin'],
    [985, { ...M.alinhar(S02, 985, 436, 316) }],
  ],
  [[759, 0], [760, 1], [985, 1], [989, 0]],
);
M.som(762, 'sobe');
const CAMPOS = [[81, 34], [135, 58], [202, 112], [331, 82], [537, 38]];
const barras = CAMPOS.map(([x, w]) => {
  const b = document.createElement('div');
  b.style.cssText = `position:absolute;left:${x - 3}px;top:283px;height:3px;width:${w + 6}px;border-radius:2px;background:#ffcc00;transform-origin:0 50%;box-shadow:0 0 10px rgba(255,204,0,.7);opacity:0`;
  PL.el.appendChild(b);
  return b;
});
M.aCada((f) => {
  barras.forEach((b, i) => {
    b.style.transform = `scaleX(${trecho(f, 808 + i * 5, 820 + i * 5, 'expo').toFixed(3)})`;
    b.style.opacity = pista(f, [[806, 0], [808, 1], [866, 1], [874, 0]]).toFixed(3);
  });
});
etiqueta('Tipo · Número · Lidos · CNPJ · Remetente', PL, 300, 236, 'cima', janela(812, 822, 862, 872));
etiqueta('Os demais campos da exportação não são usados', PL, 300, 300, 'baixo', janela(826, 836, 862, 872), 'etiqueta limite');
realce(PL, 22, 54, 170, 68, janela(884, 890, 920, 928));
realce(PL, 202, 54, 170, 68, janela(890, 896, 920, 928));
realce(PL, 382, 54, 170, 68, janela(896, 902, 920, 928));
realce(PL, 562, 54, 170, 68, janela(902, 908, 920, 928));
realce(PL, 12, 284, 1092, 35, janela(936, 942, 976, 982));
etiqueta('<b>Lidos 5</b> = 5 volumes', PL, 541, 288, 'cima', janela(942, 950, 974, 982));
etiqueta('Delivery, SKU e validade: opcionais', PL, 330, 316, 'baixo', janela(950, 958, 974, 982), 'etiqueta limite');
realce(S03, 450, 366, 850, 30, janela(1058, 1066, 1140, 1150));
frase('Da bipagem ao palete.', 690, 790, { destaques: ['bipagem', 'palete.'], classe: 'faixa' });
frase('Revisar antes de gravar.', 884, 975, { classe: 'faixa' });
frase('Sem redigitar.', 1062, 1140, { destaques: ['redigitar.'], classe: 'faixa' });
clicar(S02, { x: 760, y: 820 }, { x: 560, y: 900 }, 994, 1012);

// A linha da NF-e 900123 (a mesma da prévia): personagem do filme.
const ALVO_ARQUIVO = M.ponto(S01, 740, 600, 408);
M.animar(HERO, [
  [0, { focoX: 536, focoY: 13.5, x: 840, y: 660, z: -220, rx: 6, ry: 16, rz: -2, s: 0.9, op: 0, blur: 2.2 }],
  [24, { op: 1 }, 'out'],
  [210, { x: 800, y: 650, z: -190 }, 'lin'],
  [300, { x: 960, y: 560, z: 0, rx: 0, ry: 0, rz: 0, s: 1.55, blur: 0 }],
  [360, { s: 1.6 }, 'lin'],
  [412, { y: 800, s: 1.12 }],
  [640, { s: 1.15 }, 'lin'],
  [690, { y: 760, z: 60, s: 1.22 }],
  [740, { x: ALVO_ARQUIVO.x, y: ALVO_ARQUIVO.y, z: 0, rx: 4, ry: -4, s: 0.3 }, 'in'],
]);
HERO.opPista = [[0, 1], [728, 1], [742, 0]];
M.som(232, 'sobe');
M.som(735, 'encaixe');
realce(HERO, 0, 0, 1072, 27, [[262, 0], [270, 1, 'out'], [352, 1], [372, 0.0]]);
etiqueta('<b>PAL-DEMO-001</b>', HERO, 150, 27, 'baixo', janela(470, 480, 600, 612));
etiqueta('<b>11 - A1</b> · posição', HERO, 536, 27, 'baixo', janela(478, 488, 600, 612));
etiqueta('<b>5</b> volumes', HERO, 930, 27, 'baixo', janela(486, 496, 600, 612));

/* =====================================================================
 * Cena 4 (1200–1770): localizar, abrir, entender.
 * ===================================================================== */
M.animar(UI4, [
  [1186, { focoX: 960, focoY: 540, x: 960, y: 700, z: -700, rx: 40, ry: 0, s: 0.88, op: 0 }],
  [1212, { y: 560, z: 0, rx: 18, s: 0.95, op: 1 }, 'out'],
  [1240, { focoX: 377, focoY: 258.4, x: 900, y: 520, rx: 10, ry: -4, s: 2.6 }],
  [1295, { s: 2.72 }, 'lin'],
  [1345, { focoX: 960, focoY: 540, x: 960, y: 545, rx: 4, ry: 0, s: 0.9 }],
  [1405, {}],
  [1440, { bright: 0.5, blur: 6, s: 0.93 }],
  [1592, {}],
  [1630, { bright: 1, blur: 0, s: 0.9 }],
  [1700, {}],
  [1762, { focoX: 619, focoY: 30, x: 960, y: 430, rx: 0, ry: 0, s: 3.0 }],
  [1772, { op: 0 }, 'lin'],
]);
UI4.opPista = [[1290, 0], [1325, 1]];
M.animar(MAPA, M.seguir(UI4, 85, 118.86), [[1200, 1], [1300, 1], [1330, 0]]);
M.som(1192, 'entra');
realce(MAPA, 260, 122, 64, 35, janela(1234, 1240, 1290, 1304));
etiqueta('<b>11 - A1</b> · PAL-DEMO-001', MAPA, 250, 139.5, 'esq', janela(1244, 1252, 1288, 1298));
etiqueta('<b>Focar L’Oréal</b> · Ver praça completa', UI4, 296, 250, 'dir', janela(1350, 1360, 1396, 1404));
frase('Localizar.', 1242, 1292, { tamanho: 76 });
ficha('PAL-DEMO-001<small>11 - A1 · 16 volumes lidos na bipagem</small>', { p: S03, x: 520, y: 234, f: 1150 }, { p: MAPA, x: 292, y: 139.5, f: 1240 }, 1152, 1236, 260);
// Janela do palete: nasce do tamanho e do lugar do palete na tela.
const PAL1 = M.ponto(UI4, 1405, 377, 258.4);
const PAL1_A = M.ponto(UI4, 1405, 345, 258.4);
const PAL1_B = M.ponto(UI4, 1405, 409, 258.4);
const PAL2 = M.ponto(UI4, 1625, 377, 258.4);
const larguraPal = Math.hypot(PAL1_B.x - PAL1_A.x, PAL1_B.y - PAL1_A.y);
M.animar(J4, [
  [1405, { focoX: 430, focoY: 268, x: PAL1.x, y: PAL1.y, z: 0, rx: 4, s: larguraPal / 860, op: 0 }],
  [1411, { op: 1 }, 'out'],
  [1442, { x: 1000, y: 540, z: 60, rx: 3, ry: -6, s: 1.12 }, 'expo'],
  [1466, { focoX: 170, focoY: 104, x: 640, y: 470, rx: 2, ry: -4, s: 1.9 }],
  [1510, { s: 1.94 }, 'lin'],
  [1540, { focoX: 430, focoY: 248, x: 960, y: 520, rx: 1, ry: 0, s: 1.75 }],
  [1590, { s: 1.78 }, 'lin'],
  [1625, { focoX: 430, focoY: 268, x: PAL2.x, y: PAL2.y, z: 0, rx: 4, ry: 0, s: (larguraPal / 860) * (0.9 / 0.93) }, 'in'],
  [1631, { op: 0 }],
]);
clicar(UI4, { x: 700, y: 430 }, { x: 377, y: 258.4 }, 1382, 1400);
M.som(1406, 'abre');
M.som(1622, 'fecha');
realce(J4, 15, 80, 330, 48, janela(1460, 1468, 1506, 1516));
realce(J4, 16, 228, 828, 39, janela(1534, 1542, 1586, 1596));
etiqueta('<b>NF-e 900123</b> · a mesma linha da bipagem', J4, 600, 228, 'cima', janela(1546, 1554, 1584, 1594));
frase('Abrir.', 1410, 1452, { tamanho: 76 });
frase('Entender.', 1462, 1528, { tamanho: 76 });
frase('O mapa abre na área da L’Oréal.', 1640, 1712, { destaques: ['L’Oréal.'], tamanho: 56, classe: 'faixa' });

/* =====================================================================
 * Cena 5 (1770–2250): uma busca, o endereço, a ação.
 * ===================================================================== */
const K_BUSCA = [
  [1762, { focoX: 619, focoY: 30, x: 960, y: 430, z: 0, rx: 0, ry: 0, s: 3.0, op: 1 }],
  [1800, { s: 3.05 }, 'lin'],
  [1840, { focoX: 300, focoY: 500, x: 640, y: 540, rx: 2, ry: 8, s: 1.55 }],
  [1886, { s: 1.58 }, 'lin'],
  [1930, { focoX: 960, focoY: 420, x: 960, y: 520, rx: 0, ry: 0, s: 1.45 }],
  [1965, { s: 1.48 }, 'lin'],
  [1992, { x: 600, z: -600, rx: 10, ry: 20, op: 0, blur: 4 }, 'in'],
];
M.animar(B30, K_BUSCA, [[1762, 0], [1770, 1], [1886, 1], [1898, 0]]);
M.animar(B31, K_BUSCA, [[1886, 0], [1898, 1]]);
for (let i = 0; i < 6; i++) M.som(1752 + i * 3, 'tecla');
realce(B30, 107, 390, 374, 236, janela(1846, 1854, 1880, 1888));
etiqueta('<b>PAL-DEMO-001</b> · posição registrada F01-P01', B30, 481, 470, 'dir', janela(1850, 1858, 1880, 1888));
clicar(B30, { x: 420, y: 700 }, { x: 192, y: 594 }, 1866, 1882);
M.som(1892, 'troca');
etiqueta('<b>11 - A1</b> · endereço registrado', B31, 650, 290, 'cima', janela(1906, 1914, 1960, 1968));
frase('Uma busca.', 1772, 1838, { tamanho: 76 });
frase('O endereço.', 1902, 1966, { tamanho: 76, classe: 'faixa' });

// Divergência: palete sem endereço, mover e histórico.
M.animar(P32, [
  [1966, { focoX: 590, focoY: 150, x: 1300, y: 560, z: -600, rx: 10, ry: -24, s: 1.2, op: 0 }],
  [1992, { x: 1000, y: 520, z: 0, rx: 4, ry: -6, s: 1.55, op: 1 }, 'expo'],
  [2024, { s: 1.58 }, 'lin'],
  [2044, { x: 520, z: -500, ry: 18, op: 0, blur: 3 }, 'in'],
]);
M.som(1972, 'entra');
realce(P32, 498, 94, 186, 28, janela(1996, 2003, 2028, 2036), 'vermelho');
etiqueta('Divergências de alocação ficam visíveis', P32, 590, 92, 'cima', janela(1998, 2006, 2028, 2036));
realce(P32, 22, 226, 816, 30, janela(2008, 2014, 2028, 2036));
clicar(P32, { x: 420, y: 290 }, { x: 140, y: 240 }, 2008, 2024);
const K_MOV = [
  [2032, { focoX: 640, focoY: 470, x: 1100, y: 560, z: -700, rx: 12, ry: -20, s: 1.2, op: 0 }],
  [2058, { x: 960, y: 540, z: 0, rx: 3, ry: -4, s: 1.4, op: 1 }, 'expo'],
  [2104, { s: 1.43 }, 'lin'],
  [2134, { focoX: 760, focoY: 530, x: 960, y: 520, s: 1.75 }],
  [2160, { s: 1.78 }, 'lin'],
  [2186, { x: 700, z: -600, ry: 16, op: 0, blur: 4 }, 'in'],
];
M.animar(M34, K_MOV, [[0, 1], [2094, 1], [2106, 0]]);
M.animar(H35, K_MOV, [[2094, 0], [2106, 1]]);
M.som(2036, 'entra');
realce(M34, 452, 360, 74, 26, janela(2060, 2066, 2090, 2098));
clicar(M34, { x: 900, y: 700 }, { x: 684, y: 582 }, 2066, 2080);
realce(M34, 612, 554, 146, 56, janela(2082, 2086, 2098, 2104));
M.som(2100, 'troca');
realce(H35, 466, 500, 620, 52, janela(2128, 2136, 2170, 2178));
etiqueta('Sem endereço: <b>3 → 2</b>', H35, 1090, 527, 'dir', janela(2140, 2148, 2172, 2180));
frase('A ação.', 2062, 2124, { tamanho: 76, classe: 'faixa' });
frase('Histórico com origem e destino.', 2132, 2178, { tamanho: 56, classe: 'faixa' });

// QR da etiqueta → palete.
M.animar(E36, [
  [2172, { focoX: 350, focoY: 524, x: 560, y: 620, z: -500, rx: 6, ry: 22, rz: -4, s: 0.7, op: 0 }],
  [2198, { x: 600, y: 470, z: 0, rx: 2, ry: 14, rz: -2, s: 0.8, op: 1 }, 'expo'],
  [2236, { s: 0.84 }, 'lin'],
  [2256, { x: 400, z: -600, op: 0, blur: 4 }, 'in'],
]);
M.animar(J36, [
  [2190, { focoX: 430, focoY: 268, x: 1420, y: 560, z: -400, ry: -24, s: 0.7, op: 0 }],
  [2212, { x: 1350, y: 500, z: 0, rx: 3, ry: -12, s: 0.84, op: 1 }, 'expo'],
  [2236, { s: 0.86 }, 'lin'],
  [2256, { x: 1600, z: -600, op: 0, blur: 4 }, 'in'],
]);
M.som(2176, 'entra');
ficha('Abre o palete<small>PAL-DEMO-001 · 11 - A1</small>', { p: E36, x: 350, y: 524, f: 2200 }, { p: J36, x: 160, y: 40, f: 2214 }, 2200, 2224, 160);
frase('O QR da etiqueta abre o palete.', 2196, 2244, { destaques: ['QR'], tamanho: 56, classe: 'faixa' });

/* =====================================================================
 * Cena 6 (2250–2900): o cliente escolhe, a operação prepara.
 * ===================================================================== */
M.animar(V38, [
  [2246, { focoX: 700, focoY: 698, x: 1000, y: 640, z: -700, rx: 16, ry: -14, s: 1.3, op: 0 }],
  [2276, { x: 900, y: 520, z: 0, rx: 3, ry: -4, s: 1.5, op: 1 }, 'expo'],
  [2332, { s: 1.53 }, 'lin'],
  [2372, { focoX: 760, focoY: 1040, x: 860, y: 560, s: 1.55 }],
  [2408, { s: 1.57 }, 'lin'],
  [2440, { x: 700, z: -200, bright: 0.45, blur: 5 }],
  [2470, { op: 0 }],
]);
M.som(2250, 'entra');
realce(V38, 452, 686, 490, 26, janela(2282, 2290, 2336, 2344));
realce(V38, 464, 1028, 560, 48, janela(2378, 2386, 2420, 2428));
frase('O cliente escolhe.', 2286, 2352, { destaques: ['cliente'], tamanho: 72, classe: 'faixa' });
frase('A operação prepara.', 2382, 2452, { destaques: ['operação'], tamanho: 72, classe: 'faixa' });
const K_PAINEL = [
  [2396, { focoX: 295, focoY: 127, x: 1500, y: 600, z: -500, rx: 16, ry: -24, s: 1.0, op: 0 }],
  [2426, { x: 1200, y: 500, z: 0, rx: 7, ry: -10, s: 1.3, op: 1 }, 'expo'],
  [2452, { s: 1.32 }, 'lin'],
  [2490, { focoX: 482, focoY: 167, x: 960, y: 520, rx: 3, ry: -2, s: 1.6 }],
  [2560, { s: 1.63 }, 'lin'],
  [2594, { x: 1500, y: 260, z: -400, rx: 6, ry: -14, s: 0.7, op: 0 }],
  [2648, {}],
  [2684, { x: 960, y: 520, z: 0, rx: 3, ry: -2, s: 1.6, op: 1 }],
  [2720, { s: 1.62 }, 'lin'],
  [2862, { s: 1.7 }, 'lin'],
  [2900, { z: -700, rx: 20, op: 0, blur: 4 }, 'in'],
];
M.animar(P24, K_PAINEL, [[0, 1], [2704, 1], [2716, 0]]);
M.animar(P40, K_PAINEL, [[2704, 0], [2716, 1]]);
M.som(2404, 'entra');
ficha('5 volumes<small>NF-e 900123 · separado para a janela</small>', { p: V38, x: 560, y: 1042, f: 2410 }, { p: P24, x: 295, y: 127, f: 2452 }, 2410, 2450, 180);
realce(P24, 206, 84, 176, 64, janela(2448, 2454, 2520, 2530));
etiqueta('Preparação <b>25%</b> · falta separar 15', P24, 666, 84, 'cima', janela(2470, 2478, 2540, 2550));
M.animar(V39, [
  [2570, { focoX: 700, focoY: 990, x: 760, y: 720, z: -600, rx: 14, ry: 14, s: 1.3, op: 0 }],
  [2600, { x: 800, y: 620, z: 0, rx: 3, ry: 4, s: 1.5, op: 1 }, 'expo'],
  [2662, { s: 1.52 }, 'lin'],
  [2692, { x: 500, z: -500, op: 0, blur: 4 }, 'in'],
]);
M.som(2574, 'entra');
realce(V39, 464, 990, 470, 44, janela(2608, 2616, 2660, 2668));
etiqueta('Expedição de 3 volume(s) confirmada.', V39, 760, 1058, 'dir', janela(2620, 2628, 2664, 2672));
M.som(2624, 'confirma');
ficha('3 volumes<small>expedição confirmada</small>', { p: V39, x: 560, y: 1004, f: 2652 }, { p: P24, x: 478, y: 127, f: 2700 }, 2654, 2702, 160);
M.som(2710, 'troca');
[17, 205, 393, 581, 769].forEach((x, i) => realce(P40, x, 84, 170, 64, janela(2722 + i * 10, 2728 + i * 10, 2850, 2860)));
frase('Solicitado, separado e expedido: estados distintos.', 2730, 2862, { destaques: ['distintos.'], tamanho: 56 });

/* =====================================================================
 * Cena 7 (2900–3360): conferir com prioridade.
 * ===================================================================== */
M.animar(M41, [
  [2900, { focoX: 909, focoY: 472, x: 960, y: 700, z: -700, rx: 40, s: 0.88, op: 0 }],
  [2928, { y: 560, z: 0, rx: 18, s: 0.95, op: 1 }, 'out'],
  [2962, { focoX: 292, focoY: 234.5, x: 900, y: 520, rx: 10, ry: -4, s: 2.5 }],
  [3030, { s: 2.6 }, 'lin'],
  [3066, { bright: 0.5, blur: 6, s: 2.65 }],
  [3200, {}],
  [3240, { z: -400, op: 0 }, 'in'],
]);
M.som(2906, 'entra');
realce(M41, 260, 217, 64, 35, janela(2962, 2968, 3030, 3040));
etiqueta('<b>PAL-DEMO-003</b> · 25 dias sem movimentação', M41, 250, 234.5, 'esq', janela(2972, 2980, 3028, 3036));
frase('Conferir com prioridade.', 2976, 3050, { destaques: ['prioridade.'], tamanho: 72 });
clicar(M41, { x: 420, y: 330 }, { x: 292, y: 234.5 }, 3016, 3032);
const PAL3 = M.ponto(M41, 3036, 292, 234.5);
const PAL3_A = M.ponto(M41, 3036, 260, 234.5);
const PAL3_B = M.ponto(M41, 3036, 324, 234.5);
M.animar(J42, [
  [3036, { focoX: 430, focoY: 143, x: PAL3.x, y: PAL3.y, rx: 6, s: Math.hypot(PAL3_B.x - PAL3_A.x, PAL3_B.y - PAL3_A.y) / 860, op: 0 }],
  [3042, { op: 1 }, 'out'],
  [3072, { x: 960, y: 470, z: 60, rx: 3, ry: -4, s: 1.45 }, 'expo'],
  [3112, { s: 1.48 }, 'lin'],
  [3136, { y: 300, z: -400, op: 0, blur: 3 }, 'in'],
]);
M.som(3038, 'abre');
realce(J42, 285, 84, 135, 40, janela(3078, 3086, 3115, 3122), 'vermelho');
etiqueta('Regra: <b>20 dias</b> sem movimentação', J42, 352, 124, 'baixo', janela(3082, 3090, 3115, 3122));
const K_RECONF = [
  [3120, { focoX: 558, focoY: 300, x: 960, y: 640, z: -500, rx: 12, ry: 0, s: 1.0, op: 0 }],
  [3146, { y: 540, z: 0, rx: 3, ry: -3, s: 1.12, op: 1 }, 'expo'],
  [3172, { focoX: 300, focoY: 140, x: 760, y: 420, s: 1.5 }],
  [3198, { s: 1.52 }, 'lin'],
  [3226, { focoX: 558, focoY: 560, x: 960, y: 680, s: 1.25 }],
  [3244, {}],
  [3276, { focoX: 558, focoY: 400, x: 960, y: 540, s: 1.15 }],
  [3332, { s: 1.18 }, 'lin'],
  [3366, { z: -600, op: 0, blur: 4 }, 'in'],
];
M.animar(R43B, K_RECONF, [[0, 1], [3240, 1], [3250, 0]]);
M.animar(R43C, K_RECONF, [[3240, 0], [3250, 1]]);
M.som(3124, 'entra');
realce(R43B, 36, 72, 446, 36, janela(3172, 3180, 3206, 3214));
realce(R43B, 36, 184, 345, 26, janela(3180, 3188, 3206, 3214));
clicar(R43B, { x: 800, y: 470 }, { x: 558, y: 593 }, 3220, 3238);
M.som(3246, 'confirma');
realce(R43C, 22, 570, 1072, 42, janela(3252, 3258, 3330, 3340));
realce(R43C, 36, 178, 345, 26, janela(3268, 3276, 3330, 3340));
etiqueta('Precisa conferir: <b>1 → 0</b> no painel', R43C, 850, 168, 'cima', janela(3280, 3288, 3330, 3340));
frase('Conferido, com registro.', 3260, 3340, { destaques: ['registro.'], tamanho: 64, classe: 'faixa' });

/* =====================================================================
 * Cena 8 (3360–3840): operação e gestão, com a mesma base.
 * ===================================================================== */
M.animar(P48, [
  [3380, { focoX: 926, focoY: 509, x: 960, y: 590, z: 0, rx: 5, ry: 0, s: 0.82, op: 0 }],
  [3440, {}],
  [3452, { op: 1 }, 'lin'],
  [3490, { s: 0.83 }, 'lin'],
  [3530, { focoX: 1132, focoY: 105, x: 960, y: 380, rx: 3, s: 1.55 }],
  [3592, { s: 1.58 }, 'lin'],
  [3626, { x: 480, z: -500, ry: 22, op: 0, blur: 4 }, 'in'],
]);
const montar = (p, ox, oy, de, f0, f1) => {
  const fim = M.alinhar(P48, 3440, ox, oy);
  M.animar(p, [
    [f0, { ...fim, ...de, x: fim.x + (de.dx ?? 0), y: fim.y + (de.dy ?? 0), op: 0 }],
    [f0 + 14, { op: 1 }, 'out'],
    [f1, { ...fim }, 'expo'],
    [3452, {}],
    [3458, { op: 0 }],
  ]);
  M.som(f1 - 6, 'encaixe');
};
montar(C48B, 106, 58, { dy: -320, z: -700, rx: 30 }, 3368, 3418);
montar(C48C, 106, 162, { dx: -760, z: -600, ry: 40 }, 3382, 3430);
montar(C48D, 1081, 506, { dx: 760, z: -600, ry: -40 }, 3392, 3440);
realce(P48, 518.5, 58, 402.5, 94, janela(3534, 3542, 3600, 3608));
realce(P48, 931, 58, 402.5, 94, janela(3546, 3554, 3600, 3608));
realce(P48, 1343.5, 58, 402.5, 94, janela(3558, 3566, 3600, 3608));
frase('Operação e gestão, com a mesma base.', 3396, 3504, { destaques: ['mesma', 'base.'], tamanho: 56, x: 960, y: 64, alinhar: 'centro' });
frase('Estoque, janela e prioridades em uma tela.', 3536, 3606, { tamanho: 52, classe: 'faixa' });
M.animar(C45, [
  [3600, { focoX: 926, focoY: 509, x: 1500, y: 560, z: -700, ry: -26, s: 0.8, op: 0 }],
  [3640, { x: 960, y: 560, z: 0, ry: -2, rx: 3, s: 0.82, op: 1 }, 'expo'],
  [3682, { s: 0.83 }, 'lin'],
  [3722, { focoX: 1132, focoY: 106, x: 960, y: 400, s: 1.5 }],
  [3790, { s: 1.52 }, 'lin'],
  [3830, { focoX: 1413, focoY: 650, x: 1000, y: 540, s: 1.5 }],
  [3902, { s: 1.52 }, 'lin'],
  [3936, { x: 600, z: -600, ry: 18, op: 0, blur: 4 }, 'in'],
]);
M.som(3606, 'entra');
frase('O cliente consulta o que é permitido.', 3650, 3740, { destaques: ['permitido.'], tamanho: 56, x: 960, y: 50, alinhar: 'centro' });
etiqueta('Perfil de consulta: sem claims, valores nem pendências internas', C45, 926, 1018, 'baixo', janela(3664, 3674, 3708, 3716), 'etiqueta limite');
realce(C45, 932, 60, 400, 92, janela(3726, 3734, 3790, 3800));
realce(C45, 1344, 60, 400, 92, janela(3738, 3746, 3790, 3800));

/* =====================================================================
 * Cena 9 (3840–4190): registrar, consultar, exportar.
 * ===================================================================== */
[560, 612, 664].forEach((y, i) => realce(C45, 1100, y, 640, 46, janela(3842 + i * 10, 3848 + i * 10, 3900, 3908)));
frase('Registrar.', 3846, 3908, { tamanho: 76, classe: 'faixa' });
M.animar(K46, [
  [3912, { focoX: 800, focoY: 560, x: 1100, y: 600, z: -700, rx: 12, ry: -20, s: 1.3, op: 0 }],
  [3942, { x: 960, y: 540, z: 0, rx: 3, ry: -4, s: 1.45, op: 1 }, 'expo'],
  [4002, { s: 1.48 }, 'lin'],
  [4030, { focoX: 994, focoY: 560, x: 960, y: 560, s: 1.35 }],
  [4040, {}],
  [4070, { bright: 0.45, blur: 6, s: 1.3 }],
  [4150, {}],
  [4186, { z: -500, op: 0 }, 'in'],
]);
M.som(3916, 'entra');
realce(K46, 452, 504, 560, 26, janela(3950, 3958, 3996, 4004));
realce(K46, 456, 694, 1080, 22, janela(3964, 3972, 4000, 4008));
etiqueta('<b>NF 900123</b> · 2 volumes no palete após a expedição de 3', K46, 870, 716, 'baixo', janela(3974, 3982, 4004, 4012));
frase('Consultar.', 3952, 4016, { tamanho: 76, classe: 'faixa' });
clicar(K46, { x: 1200, y: 660 }, { x: 994, y: 560 }, 4016, 4032);
const BOTAO = M.ponto(K46, 4036, 994, 560);
M.animar(CSV, [
  [4036, { focoX: 830, focoY: 235, x: BOTAO.x, y: BOTAO.y, s: 0.06, op: 0 }],
  [4044, { op: 1 }, 'out'],
  [4078, { x: 960, y: 500, z: 60, rx: 4, ry: -6, s: 1.0 }, 'expo'],
  [4150, { s: 1.03 }, 'lin'],
  [4186, { z: -600, op: 0, blur: 4 }, 'in'],
]);
M.som(4040, 'abre');
etiqueta('Exportação manual · arquivo CSV', CSV, 830, 470, 'baixo', janela(4086, 4094, 4150, 4160), 'etiqueta limite');
frase('Exportar.', 4062, 4140, { tamanho: 76, classe: 'faixa' });

/* =====================================================================
 * Cena 10 (4190–4500): mais visibilidade, menos procura; validar na operação.
 * ===================================================================== */
M.animar(FUNDO10, [
  [4186, { focoX: 909, focoY: 472, x: 960, y: 760, z: -900, rx: 58, s: 1.4, op: 0, bright: 0.5 }],
  [4236, { op: 0.5 }, 'out'],
  [4400, { z: -780 }, 'lin'],
  [4440, { op: 0.28, bright: 0.4, z: -760 }],
  [4500, { z: -720 }, 'lin'],
]);
frase('Mais visibilidade. Menos procura.', 4214, 4306, { destaques: ['visibilidade.', 'procura.'], tamanho: 84, x: 960, y: 420, alinhar: 'centro' });
frase('Validar na operação.', 4320, 4396, { destaques: ['operação.'], tamanho: 84, x: 960, y: 340, alinhar: 'centro' });
M.frase({ texto: 'Informação conectada à operação.', destaques: ['conectada'], entra: 420, sai: 612, x: 960, y: 598, tamanho: 40, peso: 650, alinhar: 'centro' });
M.frase({ texto: 'Informação conectada à operação.', destaques: ['conectada'], entra: 4436, sai: 99999, x: 960, y: 598, tamanho: 40, peso: 650, alinhar: 'centro' });
M.som(380, 'subida');
M.som(4404, 'subida');
M.som(4470, 'final');
const metas = [...document.querySelectorAll('.chip.meta')];
M.aCada((f) => {
  const larguras = metas.map((m) => m.offsetWidth);
  let x = 960 - (larguras.reduce((a, b) => a + b, 0) + 24 * (metas.length - 1)) / 2;
  metas.forEach((m, i) => {
    const t = trecho(f, 4336 + i * 7, 4352 + i * 7, 'expo');
    const sai = trecho(f, 4390 + i * 2, 4404 + i * 2, 'in');
    m.style.left = `${x.toFixed(1)}px`;
    m.style.opacity = (t * (1 - sai)).toFixed(3);
    m.style.transform = `translateY(${((1 - t) * 26 - sai * 20).toFixed(1)}px)`;
    x += larguras[i] + 24;
  });
  $('metas-rotulo').style.opacity = (trecho(f, 4330, 4344, 'out') * (1 - trecho(f, 4388, 4400, 'in'))).toFixed(3);
});
[4338, 4345, 4352].forEach((f) => M.som(f, 'tic'));

/* =====================================================================
 * Fundo, piso, título e selo (camadas fora dos planos)
 * ===================================================================== */
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
    x += b === 'P' ? 2 * larg + dentro : larg;
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
const corredores = montarPiso();
const titulo = [...$('titulo').querySelectorAll('.palavra > span')];
M.aCada((f) => {
  // Luz de fundo (parallax lento) com intensidade por cena.
  $('luz-a').style.transform = `translate(${(-300 + Math.sin(f / 300) * 260).toFixed(1)}px, ${(600 + Math.cos(f / 410) * 90).toFixed(1)}px) rotate(-16deg)`;
  $('luz-b').style.transform = `translate(${(1060 + Math.cos(f / 350) * 220).toFixed(1)}px, ${(140 + Math.sin(f / 380) * 70).toFixed(1)}px) rotate(12deg)`;
  $('luz-c').style.transform = `translate(${(520 + Math.sin(f / 60) * 40).toFixed(1)}px, ${(90 + Math.cos(f / 70) * 30).toFixed(1)}px)`;
  $('luz-a').style.opacity = pista(f, [[0, 0], [30, 0.85], [360, 0.7], [420, 1], [660, 0.55], [1200, 0.5], [1300, 0.4], [3360, 0.55], [4190, 0.6], [4260, 0.95], [4500, 0.85]]).toFixed(3);
  $('luz-b').style.opacity = pista(f, [[0, 0], [40, 0.7], [400, 0.9], [700, 0.45], [2900, 0.6], [4190, 0.5], [4300, 0.8]]).toFixed(3);

  // Corredores da praça em luz (abertura e fecho).
  const avanço = f * 9;
  const passagem2 = trecho(f, 612, 648, 'in');
  $('piso').style.transform = `translateY(380px) rotateX(66deg) translateY(${(-avanço % 2200).toFixed(1)}px) scale(${(1 + passagem2 * 0.6).toFixed(3)})`;
  $('cena-piso').style.opacity = (f < 2000 ? pista(f, [[350, 0], [392, 1, 'out'], [606, 1], [650, 0, 'in']]) : pista(f, [[4196, 0], [4250, 0.75, 'out'], [4500, 0.65]])).toFixed(3);
  corredores.forEach((l, i) => l.setAttribute('stroke-dashoffset', (-(f * 46 + i * 330) % 2080).toFixed(1)));

  // Símbolo DHL e título (abertura 380–650; fecho 4404–4500).
  const fecho = f >= 4390;
  const ini = fecho ? 4404 : 380;
  const saida = fecho ? 0 : trecho(f, 612, 648, 'in');
  const ativo = (f >= 370 && f < 652) || fecho;
  const dhl = $('dhl');
  const tit = $('titulo');
  dhl.style.visibility = ativo ? 'visible' : 'hidden';
  tit.style.visibility = ativo ? 'visible' : 'hidden';
  if (!ativo) return;
  const alturaDhl = 46;
  const larguraDhl = alturaDhl * (dhl.naturalWidth / dhl.naturalHeight || 6.87);
  dhl.style.height = `${alturaDhl}px`;
  dhl.style.left = `${960 - larguraDhl / 2}px`;
  dhl.style.top = `${pista(f, [[ini - 4, 352], [ini + 16, 336, 'expo']])}px`;
  dhl.style.opacity = (trecho(f, ini - 4, ini + 12, 'out') * (1 - saida)).toFixed(3);
  const passagem = (el, cx, cy) => {
    el.style.transformOrigin = `${cx}px ${cy}px`;
    el.style.transform = `scale(${(1 + saida * 0.7).toFixed(3)})`;
    el.style.filter = saida > 0.01 ? `blur(${(saida * 16).toFixed(2)}px)` : 'none';
  };
  passagem(dhl, larguraDhl / 2, 23 + 540 - 336);
  tit.style.left = `${960 - tit.offsetWidth / 2}px`;
  tit.style.top = '418px';
  tit.style.letterSpacing = `${pista(f, [[ini, -0.06], [ini + 34, -0.035, 'out']]).toFixed(4)}em`;
  tit.style.opacity = (1 - saida).toFixed(3);
  passagem(tit, tit.offsetWidth / 2, 540 - 418);
  titulo.forEach((s, i) => {
    const t = trecho(f, ini + 4 + i * 6, ini + 24 + i * 6, 'expo');
    s.style.transform = `translateY(${((1 - t) * 112).toFixed(2)}%)`;
  });
});
M.aCada((f) => {
  $('selo-demo').style.opacity = pista(f, [[14, 0], [30, 1]]).toFixed(3);
});

/* ---------- Cursor e exportação para o renderizador ---------- */
M.cursor(cliques.sort((a, b) => a[0] - b[0]));
window.TOTAL_QUADROS = TOTAL;
window.FPS = 30;
window.SECOES = [0, 360, 660, 1200, 1770, 2250, 2900, 3360, 3840, 4190];
window.EVENTOS = M.eventos;
window.definirQuadro = M.quadro;
window.pronto = (async () => {
  await M.preparar();
  const q = Number(new URLSearchParams(location.search).get('q') ?? '0');
  M.quadro(q);
  return true;
})();
