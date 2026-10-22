// Trilha e efeitos sintetizados aqui (sem amostras de terceiros), sincronizados
// aos quadros da cena (30 fps). Gera WAV 48 kHz, estéreo, 16 bits.
// Uso (pasta motion-praca-reversa): node producao/audio.mjs amostra producao/out/amostra-audio.wav
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [cena = 'amostra', saidaArg = 'producao/out/amostra-audio.wav'] = process.argv.slice(2);
const TAXA = 48_000;
const DURACAO = 15;
const N = TAXA * DURACAO;
const E = new Float32Array(N);
const D = new Float32Array(N);
const q = (quadro) => quadro / 30; // quadro → segundos

// Ruído determinístico (sempre o mesmo resultado).
let semente = 12345;
const ruido = () => {
  semente = (semente * 1664525 + 1013904223) >>> 0;
  return semente / 2 ** 31 - 1;
};

/** Biquad (RBJ) com frequência ajustável ao longo do som. */
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

/** Escreve um som curto a partir de t0 (s), com panorâmica (-1 esquerda … 1 direita). */
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

/* ---------- Base musical (96 BPM) ---------- */
const BATIDA = 60 / 96;
const ACORDES = [
  { de: 0, ate: 7.6, notas: [110, 164.81, 196, 261.63, 493.88], grave: 55 },
  { de: 7.4, ate: 15, notas: [87.31, 130.81, 164.81, 220, 392], grave: 43.65 },
];
for (const acorde of ACORDES) {
  acorde.notas.forEach((f0, k) => {
    const lp = biquad('passa-baixa');
    lp.definir(1800, 0.6);
    for (const desafina of [-0.0035, 0.0035]) {
      const f = f0 * (1 + desafina);
      som(acorde.de, acorde.ate - acorde.de, (t) => {
        const T = acorde.de + t;
        const env = Math.min(1, t / 1.4) * Math.min(1, (acorde.ate - acorde.de - t) / 0.5) * (T > 14.2 ? Math.max(0, (15 - T) / 0.8) : 1);
        const lfo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.21 * T + k);
        const onda = Math.sin(2 * Math.PI * f * t) + 0.32 * Math.sin(2 * Math.PI * 2 * f * t) + 0.12 * Math.sin(2 * Math.PI * 3 * f * t);
        return lp.processar(onda) * env * lfo;
      }, 0.028, k % 2 ? 0.35 : -0.35);
    }
  });
}
// Pulso grave a partir da planilha.
for (let t = 2.5; t < 14.6; t += BATIDA) {
  const g = t < 7.5 ? 55 : 43.65;
  som(t, 0.45, (s) => Math.sin(2 * Math.PI * (g + 45 * decai(s, 0.035)) * s) * decai(s, 0.16), 0.22);
}
// Chimbal suave nos contratempos.
const hp = biquad('passa-alta');
hp.definir(7000, 0.7);
for (let t = 4.85 + BATIDA / 2; t < 14.4; t += BATIDA) som(t, 0.06, (s) => hp.processar(ruido()) * decai(s, 0.012), 0.10, 0.25);
// Arpejo leve (colcheias) na parte final.
const ARPEJO = [523.25, 659.25, 783.99, 659.25, 698.46, 880, 783.99, 659.25];
for (let i = 0, t = 9.0; t < 14.2; i++, t += BATIDA / 2) {
  const f = ARPEJO[i % ARPEJO.length];
  som(t, 0.35, (s) => (Math.abs(((s * f) % 1) * 4 - 2) - 1) * decai(s, 0.09) * ataque(s, 0.004), 0.045, i % 2 ? 0.4 : -0.4);
}

/* ---------- Acentos (cada evento com um som próprio) ---------- */
// Subida do título.
{
  const bp = biquad('passa-faixa');
  som(0.2, 1.2, (t) => {
    bp.definir(300 + 2600 * (t / 1.2) ** 2, 1.2);
    return bp.processar(ruido()) * (t / 1.2) ** 2 * 0.9 + Math.sin(2 * Math.PI * (180 + 400 * t) * t) * 0.08 * (t / 1.2);
  }, 0.5);
}
// Título revelado: grave suave + brilho.
som(q(40), 0.9, (t) => Math.sin(2 * Math.PI * (48 + 30 * decai(t, 0.08)) * t) * decai(t, 0.35), 0.45);
som(q(40), 0.6, (t) => (Math.sin(2 * Math.PI * 1760 * t) + 0.5 * Math.sin(2 * Math.PI * 2637 * t)) * decai(t, 0.18) * ataque(t, 0.01), 0.05);
// Câmera atravessa o título (whoosh descendente).
{
  const bp = biquad('passa-faixa');
  som(q(62), 0.7, (t) => {
    bp.definir(3200 - 2600 * (t / 0.7), 0.9);
    return bp.processar(ruido()) * Math.sin(Math.PI * Math.min(1, t / 0.7));
  }, 0.55, -0.2);
}
// Campos lidos: cinco cliques que sobem.
[96, 101, 106, 111, 116].forEach((quadro, i) => {
  const f = 1900 + i * 230;
  som(q(quadro), 0.05, (t) => Math.sin(2 * Math.PI * f * t) * decai(t, 0.008) + ruido() * 0.2 * decai(t, 0.002), 0.22, -0.3 + i * 0.15);
});
// Linha destacada: clique duplo de seleção.
for (const d of [0, 0.035]) som(q(132) + d, 0.04, (t) => (Math.sin(2 * Math.PI * 1500 * t) * 0.6 + ruido() * 0.4) * decai(t, 0.006), 0.28, 0.1);
// "Lidos 5": nota curta.
som(q(142), 0.5, (t) => Math.sin(2 * Math.PI * 1318.5 * t) * decai(t, 0.14) * ataque(t, 0.004), 0.12, 0.2);
// Linha sobe da planilha (ar).
{
  const lp = biquad('passa-baixa');
  som(q(150), 0.5, (t) => {
    lp.definir(400 + 3000 * (t / 0.5), 0.7);
    return lp.processar(ruido()) * Math.sin(Math.PI * Math.min(1, t / 0.5));
  }, 0.25, 0.1);
}
// Voo da linha até o palete (efeito de passagem, da direita para a esquerda).
{
  const bp = biquad('passa-faixa');
  const dur = q(228) - q(168);
  som(q(168), dur, (t) => {
    const u = t / dur;
    bp.definir(700 + 2200 * Math.sin(Math.PI * u), 1.4);
    return bp.processar(ruido()) * Math.sin(Math.PI * u) ** 1.5;
  }, 0.5);
}
// Encaixe no palete: grave curto + clique + toque metálico.
som(q(228), 0.3, (t) => Math.sin(2 * Math.PI * (70 + 60 * decai(t, 0.02)) * t) * decai(t, 0.09), 0.6);
som(q(228), 0.02, () => ruido(), 0.25);
som(q(228) + 0.012, 0.25, (t) => (Math.sin(2 * Math.PI * 3100 * t) + 0.6 * Math.sin(2 * Math.PI * 4650 * t)) * decai(t, 0.05), 0.06, -0.2);
// Janela abre da posição (subida curta e mais aguda).
{
  const bp = biquad('passa-faixa');
  som(q(245), 0.5, (t) => {
    bp.definir(900 + 3500 * (t / 0.5), 1.1);
    return bp.processar(ruido()) * Math.sin(Math.PI * Math.min(1, t / 0.5)) ** 2;
  }, 0.42, 0.25);
  som(q(258), 0.3, (t) => Math.sin(2 * Math.PI * (220 + 90 * decai(t, 0.03)) * t) * decai(t, 0.08), 0.22, 0.2);
}
// Mudanças de foco: "16 lidos na bipagem" e a linha da NF.
som(q(284), 0.18, (t) => Math.sin(2 * Math.PI * 2489 * t) * decai(t, 0.03), 0.12, 0.3);
{
  const lp = biquad('passa-baixa');
  const dur = q(345) - q(306);
  som(q(306), dur, (t) => {
    lp.definir(250 + 1400 * (t / dur), 0.8);
    return lp.processar(ruido()) * Math.sin(Math.PI * (t / dur)) * 0.8;
  }, 0.2);
}
for (const d of [0, 0.03]) som(q(326) + d, 0.04, (t) => (Math.sin(2 * Math.PI * 1700 * t) * 0.6 + ruido() * 0.4) * decai(t, 0.006), 0.26, 0.05);
// Ficha "5 volumes" vai ao painel (passagem diferente, mais média).
{
  const bp = biquad('passa-faixa');
  const dur = q(410) - q(370);
  som(q(370), dur, (t) => {
    const u = t / dur;
    bp.definir(900 + 1100 * u, 2.2);
    return bp.processar(ruido()) * Math.sin(Math.PI * u) ** 1.3;
  }, 0.55);
}
// Encaixe no "Separado" e confirmação (duas notas que sobem).
som(q(410), 0.3, (t) => Math.sin(2 * Math.PI * (80 + 50 * decai(t, 0.02)) * t) * decai(t, 0.08), 0.5);
som(q(411), 1.2, (t) => Math.sin(2 * Math.PI * 659.25 * t) * decai(t, 0.35) * ataque(t, 0.005), 0.13, -0.15);
som(q(411) + 0.09, 1.3, (t) => Math.sin(2 * Math.PI * 987.77 * t) * decai(t, 0.42) * ataque(t, 0.005), 0.12, 0.15);

/* ---------- Mixagem: saturação suave, normalização e fade final ---------- */
let pico = 0;
for (let i = 0; i < N; i++) {
  const t = i / TAXA;
  const fim = t > 14.3 ? Math.max(0, (15 - t) / 0.7) : 1;
  E[i] = Math.tanh(E[i] * 1.1) * fim;
  D[i] = Math.tanh(D[i] * 1.1) * fim;
  pico = Math.max(pico, Math.abs(E[i]), Math.abs(D[i]));
}
const alvo = 10 ** (-1.5 / 20);
const ganho = pico > 0 ? alvo / pico : 1;
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
console.log(`Áudio (${cena}): ${saida} · pico ajustado de ${pico.toFixed(3)} para -1,5 dBFS`);
