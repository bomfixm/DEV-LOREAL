import type { ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/ambiente';
import { useAberturaTocando } from './abertura';
import { useCarregamentoLento } from './use-carregamento';
import './carregamento.css';

/**
 * Desenho do indicador (D334): uma embalagem que se transforma — perfume →
 * shampoo → creme → perfume — no mesmo estilo dos ícones do menu lateral: só
 * traço, uma cor (a do texto), pontas e cantos arredondados, dentro do
 * quadrado amarelo do item ativo. Corpo, tampa e rótulo mantêm a mesma
 * estrutura de caminho em todas as etapas, para a interpolação ser contínua
 * (SMIL nativo, sem biblioteca). Com movimento reduzido, fica o perfume parado.
 */
interface Forma {
  /** Meia largura na base e no topo do corpo, raio do fundo, ombro (y e altura), meia largura e topo do gargalo. */
  w: number;
  wt: number;
  r: number;
  s: number;
  q: number;
  n: number;
  t: number;
  tampa: { x: number; y: number; w: number; h: number; rx: number };
  /** Rótulo: uma linha horizontal (como as linhas internas dos ícones). */
  rotulo: { x1: number; x2: number; y: number };
}

const BASE = 88;
const C = 50;

const PERFUME: Forma = { w: 23, wt: 23, r: 6, s: 52, q: 6, n: 6, t: 43, tampa: { x: 41, y: 22, w: 18, h: 12, rx: 3 }, rotulo: { x1: 39, x2: 61, y: 70 } };
const SHAMPOO: Forma = { w: 15, wt: 13, r: 8, s: 36, q: 10, n: 6, t: 25, tampa: { x: 40, y: 9, w: 20, h: 8, rx: 3.5 }, rotulo: { x1: 44, x2: 56, y: 58 } };
const CREME: Forma = { w: 29, wt: 29, r: 6, s: 63, q: 2, n: 27, t: 59, tampa: { x: 19, y: 44, w: 62, h: 6, rx: 3 }, rotulo: { x1: 33, x2: 67, y: 75 } };

/** Ciclo de 4,8 s: cada embalagem fica 1 s e a transformação dura 600 ms. */
const DURACAO = '4.8s';
const TEMPOS = '0;0.2083;0.3333;0.5417;0.6667;0.875;1';
const PARADO = '0 0 1 1';
const SUAVE = '.45 0 .25 1';
const CURVAS = [PARADO, SUAVE, PARADO, SUAVE, PARADO, SUAVE].join(';');
const SEQUENCIA = [PERFUME, PERFUME, SHAMPOO, SHAMPOO, CREME, CREME, PERFUME];

function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** Caminho do corpo: sempre os mesmos comandos (M, L, 6×C, 2×L, Z), só mudam os números. */
function corpo(f: Forma): string {
  const lado = (BASE - f.r - f.s) * 0.4;
  const ombro = f.s - f.q;
  const meio = (f.wt - f.n) * 0.3;
  return [
    `M${n(C)} ${n(BASE)}`,
    `L${n(C + f.w - f.r)} ${n(BASE)}`,
    `C${n(C + f.w)} ${n(BASE)} ${n(C + f.w)} ${n(BASE)} ${n(C + f.w)} ${n(BASE - f.r)}`,
    `C${n(C + f.w)} ${n(BASE - f.r - lado)} ${n(C + f.wt)} ${n(f.s + lado)} ${n(C + f.wt)} ${n(f.s)}`,
    `C${n(C + f.wt)} ${n(f.s - f.q * 0.8)} ${n(C + f.n + meio)} ${n(ombro)} ${n(C + f.n)} ${n(ombro)}`,
    `L${n(C + f.n)} ${n(f.t)}`,
    `L${n(C - f.n)} ${n(f.t)}`,
    `L${n(C - f.n)} ${n(ombro)}`,
    `C${n(C - f.n - meio)} ${n(ombro)} ${n(C - f.wt)} ${n(f.s - f.q * 0.8)} ${n(C - f.wt)} ${n(f.s)}`,
    `C${n(C - f.wt)} ${n(f.s + lado)} ${n(C - f.w)} ${n(BASE - f.r - lado)} ${n(C - f.w)} ${n(BASE - f.r)}`,
    `C${n(C - f.w)} ${n(BASE)} ${n(C - f.w)} ${n(BASE)} ${n(C - f.w + f.r)} ${n(BASE)}`,
    'Z',
  ].join(' ');
}

function rotulo(f: Forma): string {
  return `M${n(f.rotulo.x1)} ${n(f.rotulo.y)} L${n(f.rotulo.x2)} ${n(f.rotulo.y)}`;
}

function Animar({ atributo, valor, animado }: { atributo: string; valor: (f: Forma) => string; animado: boolean }) {
  if (!animado) return null;
  return (
    <animate
      attributeName={atributo}
      dur={DURACAO}
      repeatCount="indefinite"
      calcMode="spline"
      keyTimes={TEMPOS}
      keySplines={CURVAS}
      values={SEQUENCIA.map(valor).join(';')}
    />
  );
}

export function EmbalagemMorfo({ animado, className }: { animado: boolean; className?: string }) {
  const t = PERFUME.tampa;
  return (
    <span className={['carregamento-quadro', className].filter(Boolean).join(' ')} aria-hidden="true">
      <svg
        className="carregamento-embalagem"
        viewBox="6 4 88 88"
        fill="none"
        stroke="currentColor"
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        data-animado={animado ? 'sim' : 'nao'}
      >
        <path d={corpo(PERFUME)}>
          <Animar atributo="d" valor={corpo} animado={animado} />
        </path>
        <path d={rotulo(PERFUME)}>
          <Animar atributo="d" valor={rotulo} animado={animado} />
        </path>
        <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={t.rx}>
          <Animar atributo="x" valor={(f) => n(f.tampa.x)} animado={animado} />
          <Animar atributo="y" valor={(f) => n(f.tampa.y)} animado={animado} />
          <Animar atributo="width" valor={(f) => n(f.tampa.w)} animado={animado} />
          <Animar atributo="height" valor={(f) => n(f.tampa.h)} animado={animado} />
          <Animar atributo="rx" valor={(f) => n(f.tampa.rx)} animado={animado} />
        </rect>
      </svg>
    </span>
  );
}

export interface PropsCarregando {
  /** "Carregando…" ou a mensagem real da busca. */
  mensagem?: ReactNode;
  /** Principal: primeira abertura de uma tela (mapa, página). Compacta: tabela, filtro, painel, espelho, Expedição. */
  variante?: 'principal' | 'compacta';
  /** A busca da área está pendente. Padrão: true (o componente é montado enquanto a busca dura). */
  pendente?: boolean;
  /** Identifica a busca: mudar a chave (nova busca) reinicia a contagem dos 1,5 s. */
  chave?: string;
  /** Elemento usado: `span` para encaixar numa linha de texto. */
  como?: 'div' | 'p' | 'span';
  className?: string;
  'data-testid'?: string;
}

/**
 * Indicador de carregamento (D334). Só aparece se a busca continuar pendente
 * aos 1,5 s; antes disso o lugar fica reservado e vazio (sem spinner). Some
 * assim que a busca termina, sem esperar o fim do ciclo. Enquanto a abertura
 * pós-login está na tela, espera ela sair. O texto é anunciado uma vez
 * (região viva); o desenho é decorativo.
 */
export function Carregando({ mensagem = 'Carregando…', variante = 'compacta', pendente = true, chave = 'busca', como = 'div', className, 'data-testid': testId }: PropsCarregando) {
  const lento = useCarregamentoLento(pendente ? [chave] : []);
  const abertura = useAberturaTocando();
  const reduzido = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (!pendente) return null;
  const visivel = lento && !abertura;
  const Tag = como;
  const classes = ['estado-carregando', 'carregamento', `carregamento--${variante}`, visivel ? 'carregamento--visivel' : 'carregamento--espera', className]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag className={classes} role="status" aria-live="polite" aria-busy="true" data-testid={testId} data-carregamento={visivel ? 'visivel' : 'espera'}>
      {visivel && (
        <>
          <EmbalagemMorfo animado={!reduzido} className="carregamento-desenho" />
          <span className="carregamento-mensagem">{mensagem}</span>
        </>
      )}
    </Tag>
  );
}
