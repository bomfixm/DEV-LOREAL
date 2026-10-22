// Trilha e efeitos do filme (150 s), sintetizados aqui, sem amostras de terceiros.
// Lê os eventos e as seções gravados pela cena (out/filme-eventos.json, gerado
// por `node producao/render.mjs filme --eventos`) e gera WAV 48 kHz estéreo 16 bits.
// Uso (pasta motion-praca-reversa): node producao/audio-filme.mjs producao/out/filme-audio.wav
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const RAIZ = resolve(import.meta.dirname);
const [saidaArg = 'producao/out/filme-audio.wav'] = process.argv.slice(2);
const marcas = JSON.parse(readFileSync(resolve(RAIZ, 'out', 'filme-eventos.json'), 'utf8'));
const TAXA = 48_000;
const DURACAO = marcas.total / 30;
const N = Math.round(TAXA * DURACAO);
const E = new Float32Array(N);
const D = new Float32Array(N);
const q = (quadro) => quadro / 30;

let semente = 20261020;
const ruido = () => {
  semente = (semente * 1664525 + 1013904223) >>> 0;
  return semente / 2 ** 31 - 1;
};
function biquad(tipo) {
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return {
    definir(f, Q = 0.7) {
      const w = (2 * Math.PI * Math.min(f, TAXA * 0.45)) / TAXA;
      const c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q);
      let n0, n1, n2;
      if (tipo === 'passa-baixa') [n0, n1, n2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
      else if (tipo === 'passa-alta') [n0, n1, n2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
      else [n0, n1, n2] = [al, 0, -al];
      const a0 = 1 + al;
      b0 = n0 / a0; b1 = n1 / a0; b2 = n2 / a0; a1 = (-2 * c) / a0; a2 = (1 - al) / a0;
    },
    processar(x) {
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      return y;
    },
  };
}
function som(t0, dur, gerar, ganho = 1, pan = 0) {
  const i0 = Math.round(t0 * TAXA);
  const n = Math.round(dur * TAXA);
  const ge = ganho * Math.cos(((pan + 1) * Math.PI) / 4);
  const gd = ganho * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < n && i0 + i < N; i++) {
    if (i0 + i < 0) continue;
    const v = gerar(i / TAXA, i);
    E[i0 + i] += v * ge;
    D[i0 + i] += v * gd;
  }
}
const decai = (t, tau) => Math.exp(-t / tau);
const ataque = (t, a) => Math.min(1, t / a);

/* ---------- Intensidade por seção (cenas do roteiro) ---------- */
// [início em s, pad, pulso, chimbal, arpejo]
const S = marcas.secoes.map((f) => q(f));
const NIVEIS = [
  [S[0], 0.55, 0, 0, 0], // 1 problema: drone, sem batida
  [S[1], 1.0, 0, 0, 0.35], // 2 título
  [S[2], 0.8, 1, 0.8, 0], // 3 bipagem
  [S[3], 0.8, 1, 1, 0.6], // 4 mapa
  [S[4], 0.8, 1, 1, 0.6], // 5 busca
  [S[5], 0.9, 1, 1, 0.8], // 6 janela
  [S[6], 0.9, 0.7, 0.5, 0.4], // 7 reconferência (mais calma)
  [S[7], 1.0, 1, 1, 1], // 8 painel (sobe)
  [S[8], 0.9, 1, 1, 0.8], // 9 registros
  [S[9], 1.0, 0, 0, 0.5], // 10 fecho
];
function nivel(t, k) {
  let i = 0;
  while (i + 1 < NIVEIS.length && t >= NIVEIS[i + 1][0]) i++;
  const atual = NIVEIS[i][k];
  const anterior = i > 0 ? NIVEIS[i - 1][k] : atual;
  return anterior + (atual - anterior) * Math.min(1, (t - NIVEIS[i][0]) / 1.2);
}

/* ---------- Harmonia (96 BPM; compasso = 2,5 s) ---------- */
const BATIDA = 60 / 96;
const ACORDES = {
  Am9: { notas: [110, 164.81, 196, 261.63, 493.88], grave: 55 },
  Fmaj9: { notas: [87.31, 130.81, 164.81, 220, 392], grave: 43.65 },
  Cadd9: { notas: [130.81, 196, 293.66, 329.63, 523.25], grave: 65.41 },
  G6: { notas: [98, 146.83, 246.94, 329.63, 587.33], grave: 49 },
};
const segmentos = [
  { de: 0, ate: S[1], a: 'Am9' },
  { de: S[1], ate: S[1] + 5, a: 'Fmaj9' },
  { de: S[1] + 5, ate: S[2], a: 'Cadd9' },
];
const ciclo = ['Am9', 'Fmaj9', 'Cadd9', 'G6'];
for (let t = S[2], i = 0; t < S[9]; t += 5, i++) segmentos.push({ de: t, ate: Math.min(t + 5, S[9]), a: ciclo[i % 4] });
segmentos.push({ de: S[9], ate: S[9] + 5, a: 'Fmaj9' }, { de: S[9] + 5, ate: DURACAO, a: 'Cadd9' });
const acordeEm = (t) => ACORDES[(segmentos.find((s) => t >= s.de && t < s.ate) ?? segmentos.at(-1)).a];

// Pad: duas vozes levemente desafinadas por nota, filtro suave, entrada e saída cruzadas.
for (const seg of segmentos) {
  const ac = ACORDES[seg.a];
  const de = Math.max(0, seg.de - 0.25);
  const dur = Math.min(DURACAO, seg.ate + 0.35) - de;
  ac.notas.forEach((f0, k) => {
    const lp = biquad('passa-baixa');
    lp.definir(1700, 0.6);
    for (const desafina of [-0.0035, 0.0035]) {
      const f = f0 * (1 + desafina);
      som(de, dur, (t) => {
        const T = de + t;
        const env = Math.min(1, t / 0.9) * Math.min(1, (dur - t) / 0.6);
        const lfo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.21 * T + k);
        const onda = Math.sin(2 * Math.PI * f * t) + 0.32 * Math.sin(2 * Math.PI * 2 * f * t) + 0.12 * Math.sin(2 * Math.PI * 3 * f * t);
        return lp.processar(onda) * env * lfo * nivel(T, 1) * (T < 1.5 ? T / 1.5 : 1);
      }, 0.026, k % 2 ? 0.35 : -0.35);
    }
  });
}
// Cena 1: batida grave espaçada (a cada 2 tempos), sem bateria.
for (let t = 2.4; t < S[1] - 0.6; t += BATIDA * 2) som(t, 0.5, (s) => Math.sin(2 * Math.PI * (52 + 30 * decai(s, 0.04)) * s) * decai(s, 0.2), 0.16);
// Pulso grave a cada tempo (cena 3 em diante), na nota grave do acorde.
for (let t = S[2]; t < DURACAO - 6; t += BATIDA) {
  const g = nivel(t, 2);
  if (g < 0.02) continue;
  const f = acordeEm(t).grave;
  som(t, 0.45, (s) => Math.sin(2 * Math.PI * (f + 45 * decai(s, 0.035)) * s) * decai(s, 0.16), 0.2 * g);
}
// Chimbal nos contratempos.
const hp = biquad('passa-alta');
hp.definir(7000, 0.7);
for (let t = S[2] + BATIDA / 2; t < DURACAO - 6; t += BATIDA) {
  const g = nivel(t, 3);
  if (g > 0.02) som(t, 0.06, (s) => hp.processar(ruido()) * decai(s, 0.012), 0.09 * g, 0.25);
}
// Arpejo leve (colcheias) com as notas do acorde uma oitava acima.
for (let i = 0, t = S[1] + 2; t < DURACAO - 2; i++, t += BATIDA / 2) {
  const g = nivel(t, 4);
  if (g < 0.02) continue;
  const ac = acordeEm(t).notas;
  const f = ac[2 + (i % 3)] * 2;
  som(t, 0.35, (s) => (Math.abs(((s * f) % 1) * 4 - 2) - 1) * decai(s, 0.09) * ataque(s, 0.004), 0.04 * g, i % 2 ? 0.4 : -0.4);
}

/* ---------- Efeitos por evento da cena ---------- */
const passagem = (t0, dur, f0, f1, ganho, pan = 0, Q = 1.2) => {
  const bp = biquad('passa-faixa');
  som(t0, dur, (t) => {
    const u = t / dur;
    bp.definir(f0 + (f1 - f0) * u, Q);
    return bp.processar(ruido()) * Math.sin(Math.PI * Math.min(1, u)) ** 1.4;
  }, ganho, pan);
};
let alterna = 1;
for (const ev of marcas.eventos) {
  const t = q(ev.f);
  alterna = -alterna;
  switch (ev.tipo) {
    case 'texto': // palavra entra: sopro curto e agudo
      passagem(t, 0.22, 5200, 2600, 0.12, alterna * 0.15, 0.9);
      break;
    case 'tic': // realce acende
      som(t, 0.2, (s) => Math.sin(2 * Math.PI * 2489 * s) * decai(s, 0.03), 0.09, alterna * 0.3);
      break;
    case 'clique':
      for (const d of [0, 0.035]) som(t + d, 0.04, (s) => (Math.sin(2 * Math.PI * 1600 * s) * 0.6 + ruido() * 0.4) * decai(s, 0.006), 0.26, 0.05);
      break;
    case 'tecla':
      som(t, 0.03, (s) => (ruido() * 0.7 + Math.sin(2 * Math.PI * 2200 * s) * 0.3) * decai(s, 0.005), 0.12, alterna * 0.2);
      break;
    case 'voo': // ficha percorre a trilha de luz
      passagem(t, q(ev.dur ?? 40), 700, 2600, 0.42, 0, 1.6);
      break;
    case 'encaixe': // grave curto + clique + toque metálico
      som(t, 0.3, (s) => Math.sin(2 * Math.PI * (70 + 60 * decai(s, 0.02)) * s) * decai(s, 0.09), 0.5);
      som(t, 0.02, () => ruido(), 0.18);
      som(t + 0.012, 0.25, (s) => (Math.sin(2 * Math.PI * 3100 * s) + 0.6 * Math.sin(2 * Math.PI * 4650 * s)) * decai(s, 0.05), 0.05, -0.2);
      break;
    case 'entra': // plano chega da profundidade
      passagem(t, 0.7, 2600, 500, 0.32, alterna * 0.3, 0.8);
      break;
    case 'troca': // a página muda de estado
      som(t, 0.25, (s) => Math.sin(2 * Math.PI * 880 * s) * decai(s, 0.06) * ataque(s, 0.004), 0.07, 0.1);
      passagem(t, 0.25, 1500, 3500, 0.12, 0, 1);
      break;
    case 'confirma': // duas notas que sobem
      som(t, 1.2, (s) => Math.sin(2 * Math.PI * 659.25 * s) * decai(s, 0.35) * ataque(s, 0.005), 0.11, -0.15);
      som(t + 0.09, 1.3, (s) => Math.sin(2 * Math.PI * 987.77 * s) * decai(s, 0.42) * ataque(s, 0.005), 0.1, 0.15);
      break;
    case 'sobe': {
      const lp = biquad('passa-baixa');
      som(t, 0.5, (s) => {
        lp.definir(400 + 3000 * (s / 0.5), 0.7);
        return lp.processar(ruido()) * Math.sin(Math.PI * Math.min(1, s / 0.5));
      }, 0.22, 0.1);
      break;
    }
    case 'abre':
      passagem(t, 0.5, 900, 4400, 0.36, 0.25, 1.1);
      som(t + 0.43, 0.3, (s) => Math.sin(2 * Math.PI * (220 + 90 * decai(s, 0.03)) * s) * decai(s, 0.08), 0.2, 0.2);
      break;
    case 'fecha':
      passagem(t - 0.2, 0.45, 3800, 700, 0.26, -0.2, 1.1);
      break;
    case 'subida': // título: subida antes e impacto na revelação
      passagem(t - 1.1, 1.2, 300, 2900, 0.45, 0, 1.2);
      som(t + 0.15, 1.0, (s) => Math.sin(2 * Math.PI * (48 + 30 * decai(s, 0.08)) * s) * decai(s, 0.35), 0.42);
      som(t + 0.15, 0.7, (s) => (Math.sin(2 * Math.PI * 1760 * s) + 0.5 * Math.sin(2 * Math.PI * 2637 * s)) * decai(s, 0.2) * ataque(s, 0.01), 0.05);
      break;
    case 'final': // brilho curto no quadro final
      [1046.5, 1318.5, 1568].forEach((f, k) => som(t + k * 0.07, 1.6, (s) => Math.sin(2 * Math.PI * f * s) * decai(s, 0.5) * ataque(s, 0.01), 0.035, (k - 1) * 0.4));
      break;
    default:
      break;
  }
}
// Saída do título da abertura: a câmera atravessa (whoosh descendente).
passagem(q(612), 0.7, 3200, 600, 0.45, -0.2, 0.9);

/* ---------- Mixagem ---------- */
let pico = 0;
for (let i = 0; i < N; i++) {
  const t = i / TAXA;
  const fim = t > DURACAO - 1.2 ? Math.max(0, (DURACAO - t) / 1.2) : 1;
  E[i] = Math.tanh(E[i] * 1.1) * fim;
  D[i] = Math.tanh(D[i] * 1.1) * fim;
  pico = Math.max(pico, Math.abs(E[i]), Math.abs(D[i]));
}
const ganho = pico > 0 ? 10 ** (-1.5 / 20) / pico : 1;
const dados = Buffer.alloc(44 + N * 4);
dados.write('RIFF', 0);
dados.writeUInt32LE(36 + N * 4, 4);
dados.write('WAVE', 8);
dados.write('fmt ', 12);
dados.writeUInt32LE(16, 16);
dados.writeUInt16LE(1, 20);
dados.writeUInt16LE(2, 22);
dados.writeUInt32LE(TAXA, 24);
dados.writeUInt32LE(TAXA * 4, 28);
dados.writeUInt16LE(4, 32);
dados.writeUInt16LE(16, 34);
dados.write('data', 36);
dados.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  dados.writeInt16LE(Math.round(Math.max(-1, Math.min(1, E[i] * ganho)) * 32767), 44 + i * 4);
  dados.writeInt16LE(Math.round(Math.max(-1, Math.min(1, D[i] * ganho)) * 32767), 46 + i * 4);
}
const saida = resolve(saidaArg);
mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, dados);
console.log(`Áudio do filme: ${saida} · ${DURACAO.toFixed(1)} s · ${String(marcas.eventos.length)} eventos · pico ajustado de ${pico.toFixed(3)} para -1,5 dBFS`);
