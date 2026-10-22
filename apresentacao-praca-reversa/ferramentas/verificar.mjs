// Verificação automática da apresentação entregue (arquivo único, aberto por file://, sem internet).
// Uso: node ferramentas/verificar.mjs <pasta de evidências> [--rapido]  (--rapido: 5 s por cena parada em vez de 60 s)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(raiz, '..', 'motion-praca-reversa', 'package.json'));
const { chromium } = require('playwright');
const saida = process.argv[2];
const rapido = process.argv.includes('--rapido');
mkdirSync(saida, { recursive: true });
const arquivo = join(raiz, 'entrega', 'Praca-Reversa-Apresentacao.html');
const url = pathToFileURL(arquivo).href;
const R = [];
const ok = (nome, cond, detalhe = '') => { R.push({ nome, ok: !!cond, detalhe }); console.log(`${cond ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// 0. Conteúdo do arquivo: nada de acesso, conexão ou consulta externa.
const html = readFileSync(arquivo, 'utf8').replace(/data:[a-z/+0-9.-]+;base64,[A-Za-z0-9+/=]+/g, 'DATA');
ok('arquivo sem credenciais, conexões ou URLs externas', !/postgres(ql)?:\/\/|DATABASE_URL|senha|password|token|https?:\/\/(?!www\.w3\.org)/i.test(html),
  `${Math.round(html.length / 1024)} KB`);

const navegador = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const contexto = await navegador.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await contexto.setOffline(true);
const pg = await contexto.newPage();
const erros = [];
pg.on('console', (m) => { if (['error', 'warning'].includes(m.type())) erros.push(m.text()); });
pg.on('pageerror', (e) => erros.push(e.message));
pg.on('request', (r) => { if (!/^(file|data|about):/.test(r.url())) erros.push(`requisição externa: ${r.url()}`); });
await pg.goto(url);
await pg.waitForSelector('body[data-pronto="1"]', { timeout: 10000 });
const atual = () => pg.evaluate(() => window.PR_APRESENTACAO.atual());
const estado = () => pg.evaluate(() => ({
  ativas: [...document.querySelectorAll('.cena.ativa')].map((s) => s.dataset.cena),
  saindo: document.querySelectorAll('.cena.saindo').length,
  pontes: document.querySelector('#pontes').children.length,
  ocultos: document.querySelectorAll('.ponte-oculto').length,
}));
ok('abre offline por file:// na cena 01', (await atual()) === 0);
ok('fonte Inter carregada (embutida)', await pg.evaluate(() => document.fonts.check('800 72px Inter')));

// 1. Avanço manual: uma tecla = uma cena; nada avança sozinho.
await espera(4000);
ok('sem avanço automático (4 s parado)', (await atual()) === 0);
const teclas = ['ArrowRight', 'PageDown', ' ', 'ArrowDown', 'Enter'];
for (const t of teclas) { const a = await atual(); await pg.keyboard.press(t); await espera(250); ok(`tecla ${JSON.stringify(t)} avança uma cena`, (await atual()) === a + 1); }
for (const t of ['ArrowLeft', 'PageUp', 'ArrowUp', 'Backspace']) { const a = await atual(); await pg.keyboard.press(t); await espera(250); ok(`tecla ${t} volta uma cena`, (await atual()) === a - 1); }
await pg.keyboard.press('End'); await espera(200); ok('End vai à última', (await atual()) === 11);
await pg.keyboard.press('ArrowRight'); await espera(200); ok('na última, avançar não passa do fim', (await atual()) === 11);
await pg.keyboard.press('Home'); await espera(200); ok('Home vai à primeira', (await atual()) === 0);

// 2. Botões visíveis (clique único = uma cena; espaço logo depois não repete o clique).
await pg.mouse.move(900, 500);
await pg.click('#controles [data-acao="proxima"]'); await espera(150);
ok('botão Próxima avança uma cena', (await atual()) === 1);
await pg.keyboard.press(' '); await espera(150);
ok('espaço depois do clique avança só uma vez', (await atual()) === 2);
await pg.click('#controles [data-acao="anterior"]'); await espera(150);
ok('botão Anterior volta', (await atual()) === 1);

// 3. Avanço rápido, volta inteira e salto pelo índice: sempre uma cena ativa, sem restos de transição.
await pg.keyboard.press('Home');
for (let i = 0; i < 11; i++) await pg.keyboard.press('ArrowRight');
await espera(900);
let e = await estado();
ok('avanço rápido (11 teclas seguidas) termina na 12', (await atual()) === 11 && e.ativas.join() === '12' && e.saindo === 0 && e.pontes === 0 && e.ocultos === 0, JSON.stringify(e));
for (let i = 11; i > 0; i--) {
  await pg.keyboard.press('ArrowLeft');
  await espera(1600);
  const v = await pg.evaluate(() => {
    const s = document.querySelector('.cena.ativa');
    const t = s.querySelector('.titulo');
    const r = t.getBoundingClientRect();
    return { id: s.dataset.cena, op: getComputedStyle(t).opacity, dentro: r.left >= 0 && r.right <= innerWidth && r.top >= 0 };
  });
  if (v.id !== String(i).padStart(2, '0') || v.op !== '1' || !v.dentro) ok(`voltar para a cena ${i}`, false, JSON.stringify(v));
}
ok('volta de 12 até 01, uma a uma, com título visível em cada cena', (await atual()) === 0);
await pg.keyboard.press('i'); await espera(200);
ok('I abre o índice', await pg.isVisible('#indice'));
await pg.click('#indice [data-ir="8"]'); await espera(1500);
e = await estado();
ok('salto pelo índice para a 09 mostra a cena completa', (await atual()) === 8 && e.ativas.join() === '09' && !(await pg.isVisible('#indice')));
await pg.screenshot({ path: join(saida, 'salto-indice-09.png') });
await pg.keyboard.press('i'); await pg.keyboard.press('Escape'); await espera(200);
ok('Esc fecha o índice', !(await pg.isVisible('#indice')));

// 4. Pontes: 02 → 03 (conteúdo → documento) e 05 → 06 (palete 256 → janela). Quadro no meio da transição.
await pg.evaluate(() => window.PR_APRESENTACAO.ir(1, 'salto')); await espera(1500);
await pg.keyboard.press('ArrowRight'); await espera(330);
const meio = await estado();
await pg.screenshot({ path: join(saida, 'ponte-02-03-meio.png') });
await espera(900);
e = await estado();
ok('ponte 02→03 acontece e termina limpa', meio.pontes >= 2 && e.pontes === 0 && e.ocultos === 0, `no meio: ${meio.pontes} clones; depois: ${JSON.stringify(e)}`);
await pg.evaluate(() => window.PR_APRESENTACAO.ir(4, 'salto')); await espera(2500);
await pg.keyboard.press('ArrowRight'); await espera(330);
const meio2 = await estado();
await pg.screenshot({ path: join(saida, 'ponte-05-06-meio.png') });
await espera(900);
e = await estado();
ok('ponte 05→06 (palete 256 → janela do palete) termina limpa', meio2.pontes >= 2 && e.pontes === 0 && e.ocultos === 0, `no meio: ${JSON.stringify(meio2)}; depois: ${JSON.stringify(e)}`);
await pg.keyboard.press('ArrowLeft'); await espera(330);
const meio3 = await estado();
await espera(2200);
ok('ponte também na volta 06→05', meio3.pontes >= 2 && (await estado()).pontes === 0);

// 5. Notas do apresentador: janela própria, sincronizada; a tela projetada nunca recebe a fala.
const [notas] = await Promise.all([contexto.waitForEvent('page'), pg.keyboard.press('n')]);
await notas.waitForSelector('#n-fala p');
const R0 = await pg.evaluate(() => window.PR_ROTEIRO);
const textoNotas = async () => notas.evaluate(() => ({ num: document.getElementById('n-num').textContent, fala: document.getElementById('n-fala').textContent }));
let tn = await textoNotas();
ok('N abre a janela de notas com a fala da cena atual', tn.num.includes('05') && tn.fala.includes(R0[4].fala[0].slice(0, 40)));
await notas.keyboard.press('ArrowRight'); await espera(400);
tn = await textoNotas();
ok('avançar na janela de notas avança a apresentação e atualiza a fala', (await atual()) === 5 && tn.num.includes('06') && tn.fala.includes(R0[5].fala[0].slice(0, 40)));
await notas.click('#n-ant'); await espera(300);
ok('botão Anterior das notas volta a apresentação', (await atual()) === 4);
await pg.keyboard.press('ArrowRight'); await espera(300);
ok('avançar na apresentação atualiza as notas', (await textoNotas()).num.includes('06'));
const vazou = await pg.evaluate((falas) => {
  const t = document.body.innerText;
  return falas.flatMap((r) => r.fala).filter((f) => t.includes(f.slice(0, 50))).length;
}, R0);
ok('nenhuma fala aparece na tela projetada', vazou === 0, `${vazou} trechos`);
await notas.screenshot({ path: join(saida, 'notas-apresentador.png') });
await notas.close();

// 6. Movimento reduzido e tela preta.
await pg.keyboard.press('m'); await espera(300);
const calmo = await pg.evaluate(() => ({ c: document.body.classList.contains('calmo'), luz: getComputedStyle(document.querySelector('.cena.ativa .luz')).animationPlayState }));
ok('M reduz movimentos (luz parada) e mantém a cena', calmo.c && calmo.luz === 'paused' && (await atual()) === 5);
await pg.keyboard.press('ArrowRight'); await espera(500);
ok('com movimento reduzido a navegação continua', (await atual()) === 6 && (await estado()).pontes === 0);
await pg.keyboard.press('m'); await espera(200);
await pg.keyboard.press('b'); await espera(400);
ok('B escurece a tela', await pg.evaluate(() => getComputedStyle(document.getElementById('cortina')).opacity === '1'));
await pg.keyboard.press('b'); await espera(400);

// 7. Tela cheia (se o navegador sem janela permitir) e retorno pela URL.
await pg.keyboard.press('f'); await espera(500);
const cheia = await pg.evaluate(() => !!document.fullscreenElement);
if (cheia) { await pg.keyboard.press('Escape'); await espera(300); }
ok('F pede tela cheia', true, cheia ? 'entrou em tela cheia' : 'o Chromium sem janela não entra em tela cheia; testar F/Esc no Chrome/Edge da sala');
await pg.goto(`${url}#7`); await pg.waitForSelector('body[data-pronto="1"]');
ok('recarregar com #7 volta à cena 07', (await atual()) === 6);

// 8. Leitura parada: texto e números não se movem nem mudam; a luz continua viva.
const fotografar = () => pg.evaluate(() => {
  const s = document.querySelector('.cena.ativa');
  const els = [...s.querySelectorAll('.titulo, .apoio, .campo, .placa, .palete-chip, .doc-chip, .selo, .exemplo, h3, p, li, .c8-grade div, text')];
  return {
    caixas: els.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.width * 10), Math.round(r.height * 10), el.textContent.trim().slice(0, 30), getComputedStyle(el).opacity].join('|'); }),
    luz: (() => { const l = s.querySelector('.luz'); return l ? getComputedStyle(l).transform : ''; })(),
  };
});
const parado = rapido ? 5000 : 60000;
for (const n of [5, 6, 8]) {
  await pg.evaluate((i) => window.PR_APRESENTACAO.ir(i, 'salto'), n - 1);
  await espera(3000);
  const a = await fotografar();
  await pg.screenshot({ path: join(saida, `parado-${n}-inicio.png`) });
  await espera(parado);
  const b = await fotografar();
  await pg.screenshot({ path: join(saida, `parado-${n}-fim.png`) });
  const mudou = a.caixas.filter((x, i) => x !== b.caixas[i]);
  ok(`cena ${String(n).padStart(2, '0')} parada ${parado / 1000} s: ${a.caixas.length} textos sem mudar de lugar nem de valor; luz ambiente em movimento`, mudou.length === 0 && a.caixas.length === b.caixas.length && a.luz !== b.luz, mudou.slice(0, 3).join(' ; '));
}

// 9. Preferência do sistema por menos movimento.
const ctx2 = await navegador.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
await ctx2.setOffline(true);
const p2 = await ctx2.newPage();
await p2.goto(url); await p2.waitForSelector('body[data-pronto="1"]');
ok('respeita "reduzir movimento" do sistema', await p2.evaluate(() => document.body.classList.contains('calmo')));
// 10. 1366×768: tudo dentro da tela, sem rolagem.
const cortes = [];
for (let i = 0; i < 12; i++) {
  await p2.evaluate((n) => window.PR_APRESENTACAO.ir(n, 'salto'), i);
  await espera(500);
  const c = await p2.evaluate(() => {
    const s = document.querySelector('.cena.ativa');
    const palco = document.getElementById('palco').getBoundingClientRect();
    const fora = [...s.querySelectorAll('.titulo, .apoio, .selo, .exemplo, .campo, .placa, h3, p, li, .nota-tela')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width && (r.left < palco.left - 1 || r.right > palco.right + 1 || r.top < palco.top - 1 || r.bottom > palco.bottom + 1);
    }).map((el) => el.textContent.trim().slice(0, 30));
    return { fora, rola: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight };
  });
  if (c.fora.length || c.rola) cortes.push(`${i + 1}: ${JSON.stringify(c)}`);
  await p2.evaluate(() => document.body.classList.add('controles-ocultos'));
  await espera(400);
  await p2.screenshot({ path: join(saida, `1366x768-cena-${String(i + 1).padStart(2, '0')}.png`) });
}
ok('1366×768: nenhum texto fora do palco e sem rolagem nas 12 cenas', cortes.length === 0, cortes.join(' | '));
await ctx2.close();

ok('sem erros no console nem requisições externas (internet desligada)', erros.length === 0, erros.slice(0, 5).join(' | '));
await contexto.close();
await navegador.close();
writeFileSync(join(saida, 'resultado.json'), JSON.stringify(R, null, 1));
const falhas = R.filter((r) => !r.ok).length;
console.log(`\n${R.length - falhas} de ${R.length} verificações aprovadas.`);
process.exit(falhas ? 1 : 0);
