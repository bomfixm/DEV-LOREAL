/**
 * Desfazer/refazer do rascunho do editor. Um gesto (arraste inteiro, um campo
 * numérico, uma tecla) vira um passo: `registrar` guarda o estado anterior e
 * `substituir` atualiza durante o gesto sem empilhar cada pixel.
 */
export interface Historico<T> {
  passado: readonly T[];
  presente: T;
  futuro: readonly T[];
  /** Estado de partida do rascunho ("Restaurar"). */
  inicial: T;
}
const LIMITE = 100;

export const iniciarHistorico = <T>(inicial: T): Historico<T> => ({ passado: [], presente: inicial, futuro: [], inicial });

export function registrar<T>(h: Historico<T>, novo: T): Historico<T> {
  if (Object.is(novo, h.presente)) return h;
  return { ...h, passado: [...h.passado, h.presente].slice(-LIMITE), presente: novo, futuro: [] };
}
export const substituir = <T>(h: Historico<T>, novo: T): Historico<T> => ({ ...h, presente: novo });
export function desfazer<T>(h: Historico<T>): Historico<T> {
  const anterior = h.passado.at(-1);
  return anterior === undefined ? h : { ...h, passado: h.passado.slice(0, -1), presente: anterior, futuro: [h.presente, ...h.futuro] };
}
export function refazer<T>(h: Historico<T>): Historico<T> {
  const proximo = h.futuro[0];
  return proximo === undefined ? h : { ...h, passado: [...h.passado, h.presente], presente: proximo, futuro: h.futuro.slice(1) };
}
/** Volta ao estado de partida, como um passo que também pode ser desfeito. */
export const restaurar = <T>(h: Historico<T>): Historico<T> => registrar(h, h.inicial);
