import { API_PREFIXO, LIMITE_MAXIMO_PALETES, type EstadoConferencia, type Layout, type PaleteResumo } from '@praca-reversa/contracts';

export interface Filtro {
  texto: string;
  conferencia: EstadoConferencia | 'TODOS';
}

export const FILTRO_VAZIO: Filtro = { texto: '', conferencia: 'TODOS' };

/** Minúsculas, sem acentos e sem separadores: "F01-P02" e "f01p02" se equivalem. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function filtroAtivo(filtro: Filtro): boolean {
  return normalizar(filtro.texto) !== '' || filtro.conferencia !== 'TODOS';
}

/** Consulta do filtro no servidor (mesma validação e limites da API). */
export function urlFiltro(filtro: Filtro): string {
  const parametros = new URLSearchParams();
  const texto = filtro.texto.trim().slice(0, 64);
  if (texto) parametros.set('texto', texto);
  if (filtro.conferencia !== 'TODOS') parametros.set('conferencia', filtro.conferencia);
  parametros.set('limite', String(LIMITE_MAXIMO_PALETES));
  return `${API_PREFIXO}/paletes?${parametros.toString()}`;
}

export interface GrupoPaletes {
  chave: string;
  titulo: string;
  subtitulo?: string;
  paletes: PaleteResumo[];
}

/** "15 - A120" → fileira "15" e número 120 (ordem numérica, não textual). */
function partesEndereco(endereco: string): { fileira: string; numero: number } {
  const [fileira = endereco, codigo = ''] = endereco.split(' - ');
  const numero = Number(codigo.replace(/^[A-Z]+/, ''));
  return { fileira, numero: Number.isFinite(numero) ? numero : Number.MAX_SAFE_INTEGER };
}

/**
 * Paletes sem posição com endereço informado no inventário: agrupados pela
 * fileira do endereço (nome operacional do layout, quando houver), ordenados
 * pelo número do endereço. A posição no mapa continua pendente.
 */
function gruposInformados(paletes: readonly PaleteResumo[], layout: Layout | null): GrupoPaletes[] {
  const nomes = new Map((layout?.elements ?? []).flatMap((e) => (e.addressPrefix ? [[e.addressPrefix, e.operationalName ?? e.label] as const] : [])));
  const ordemFileira = (f: string) => (/^\d+$/.test(f) ? Number(f) : 1_000 + f.charCodeAt(0));
  const grupos = new Map<string, PaleteResumo[]>();
  for (const p of paletes) {
    const { fileira } = partesEndereco(p.informedAddress ?? '');
    grupos.set(fileira, [...(grupos.get(fileira) ?? []), p]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => ordemFileira(a) - ordemFileira(b) || a.localeCompare(b))
    .map(([fileira, lista]) => ({
      chave: `informado-${fileira}`,
      titulo: nomes.get(fileira) ?? `Fileira ${fileira}`,
      subtitulo: 'Endereço informado · posição no mapa pendente',
      paletes: [...lista].sort((a, b) => partesEndereco(a.informedAddress ?? '').numero - partesEndereco(b.informedAddress ?? '').numero || a.code.localeCompare(b.code)),
    }));
}

/**
 * Agrupa por fileira na ordem do layout (do início para o outro extremo),
 * com o bloco ou a zona como subtítulo. Paletes sem posição com endereço
 * informado no inventário vêm depois, pela fileira do endereço; os demais
 * ficam em "Localização pendente", ao final.
 */
export function agruparPaletes(paletes: readonly PaleteResumo[], layout: Layout | null): GrupoPaletes[] {
  const posicoes = new Map((layout?.positions ?? []).map((p) => [p.id, p]));
  const fileiras = new Map((layout?.rows ?? []).map((f) => [f.id, f]));
  const elementos = new Map((layout?.elements ?? []).map((e) => [e.code, e]));
  const grupos = new Map<string, GrupoPaletes & { ordem: number }>();
  let pendentes: PaleteResumo[] = [];

  const ordemDe = (p: PaleteResumo) => {
    const posicao = p.positionId === null ? undefined : posicoes.get(p.positionId);
    const fileira = posicao ? fileiras.get(posicao.rowId) : undefined;
    return fileira && posicao ? fileira.order * 10_000 + posicao.number : Number.MAX_SAFE_INTEGER;
  };
  const ordenados = [...paletes].sort((a, b) => ordemDe(a) - ordemDe(b) || a.code.localeCompare(b.code));

  for (const palete of ordenados) {
    const posicao = palete.positionId === null ? undefined : posicoes.get(palete.positionId);
    const fileira = posicao ? fileiras.get(posicao.rowId) : undefined;
    if (!fileira) {
      pendentes.push(palete);
      continue;
    }
    let grupo = grupos.get(fileira.id);
    if (!grupo) {
      const bloco = fileira.blockCode === null ? undefined : elementos.get(fileira.blockCode);
      grupo = { chave: fileira.id, titulo: fileira.label, paletes: [], ordem: fileira.order };
      if (bloco) grupo.subtitulo = bloco.label;
      grupos.set(fileira.id, grupo);
    }
    grupo.paletes.push(palete);
  }

  const resultado: GrupoPaletes[] = [...grupos.values()]
    .sort((a, b) => a.ordem - b.ordem)
    .map(({ ordem: _ordem, ...grupo }) => grupo);
  resultado.push(...gruposInformados(pendentes.filter((p) => p.informedAddress), layout));
  pendentes = pendentes.filter((p) => !p.informedAddress);
  if (pendentes.length > 0) {
    resultado.push({ chave: 'sem-endereco', titulo: 'Localização pendente', subtitulo: 'Sem posição registrada', paletes: pendentes });
  }
  return resultado;
}
