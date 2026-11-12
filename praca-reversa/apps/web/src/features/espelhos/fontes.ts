import { CAMPOS, FONTES, type FonteId, type LayoutEspelho } from './layout-modelo';

/** Carrega as fontes usadas antes de medir/imprimir (evita trocar de fonte no meio e mudar quebras). */
export async function carregarFontes(layouts: readonly LayoutEspelho[]): Promise<void> {
  const usadas = new Set(layouts.flatMap((l) => CAMPOS.map((c) => l.blocos[c].estilo.fonte)));
  const pedidos = FONTES.filter((f) => usadas.has(f.id)).flatMap((f) => [`400 12pt ${f.carregar}`, `700 12pt ${f.carregar}`]);
  await Promise.all(pedidos.map((p) => document.fonts.load(p).catch(() => [])));
  await document.fonts.ready;
}

/**
 * Fonte do sistema existe neste computador? Compara a largura de um texto com a
 * fonte pedida e com as genéricas: se for igual às duas, o navegador usaria um
 * substituto (e as quebras mudariam). Inter vem com o Praça e está sempre disponível.
 */
export function fonteDisponivel(id: FonteId): boolean {
  const f = FONTES.find((x) => x.id === id);
  if (f === undefined) return false;
  if (!f.sistema) return true;
  const canvas = document.createElement('canvas').getContext('2d');
  if (canvas === null) return true;
  const amostra = 'mmmmmmmmmmlliWW0123456789';
  return ['monospace', 'serif', 'sans-serif'].some((generica) => {
    canvas.font = `40px ${generica}`;
    const base = canvas.measureText(amostra).width;
    canvas.font = `40px ${f.carregar}, ${generica}`;
    return canvas.measureText(amostra).width !== base;
  });
}
