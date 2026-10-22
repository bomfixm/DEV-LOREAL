import type { FullMisto, PorRua } from '@praca-reversa/contracts';

/** Volumes inteiros no formato brasileiro; desconhecido nunca vira zero. */
export function volumes(n: number | null, vazio = 'Não informado'): string {
  return n === null ? vazio : n.toLocaleString('pt-BR');
}

export function porcento(p: string | null): string | null {
  return p === null ? null : `${p.replace('.', ',')}%`;
}

export const ROTULO_FULL: Record<FullMisto, string> = { FULL: 'Full', MISTO: 'Misto', NAO_INFORMADO: 'Não informado' };

export interface ValoresFiltro {
  janela?: string;
  inicio?: string;
  fim?: string;
  rua?: string;
  palete?: string;
  documento?: string;
  delivery?: string;
  remetente?: string;
  situacao?: string;
}

export function filtrosDe(parametros: string): ValoresFiltro {
  const p = new URLSearchParams(parametros);
  const v: ValoresFiltro = {};
  for (const chave of ['janela', 'inicio', 'fim', 'rua', 'palete', 'documento', 'delivery', 'remetente', 'situacao'] as const) {
    const x = p.get(chave);
    if (x) v[chave] = x;
  }
  return v;
}

export function consultaDe(v: ValoresFiltro & { aba?: string; pagina?: number }): string {
  const p = new URLSearchParams();
  for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== '' && x !== null) p.set(k, String(x));
  return p.toString();
}

/** Volume de uma rua em texto: sem conteúdo registrado ou sem volume conhecido não vira zero. */
export function textoVolumesRua(r: PorRua): string {
  if (r.contents === 0) return 'Conteúdo não registrado (volume não informado)';
  if (r.contents === r.volumesUnknown) return 'Volumes não informados';
  return `${volumes(r.volumes)} volume(s)${r.volumesUnknown > 0 ? ` · ${String(r.volumesUnknown)} conteúdo(s) sem volume informado` : ''}`;
}
