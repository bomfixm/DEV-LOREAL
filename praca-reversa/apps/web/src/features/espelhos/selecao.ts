import { decomporEnderecoEspelho, type Layout, type PaleteResumo } from '@praca-reversa/contracts';

/**
 * Seleção de espelhos direto no mapa (6 nov. 2026): clicar no nome da rua
 * marca a rua inteira, clicar no "F##" marca a fileira e clicar no palete
 * marca só ele. Clicar de novo desmarca. Só entram paletes em estoque ou
 * reservados que estão numa posição do mapa.
 */

const ELEGIVEIS = new Set(['EM_ESTOQUE', 'RESERVADO']);

export const elegivel = (p: Pick<PaleteResumo, 'positionId' | 'flowState'>): boolean => p.positionId !== null && ELEGIVEIS.has(p.flowState);

/** Paletes elegíveis por bloco (rua) e por fileira. */
export function indiceDoMapa(layout: Layout, paletes: readonly PaleteResumo[]): { porBloco: Map<string, string[]>; porFileira: Map<string, string[]>; elegiveis: Set<string> } {
  const fileiraDaPosicao = new Map(layout.positions.map((p) => [p.id, p.rowId]));
  const blocoDaFileira = new Map(layout.rows.map((f) => [f.id, f.blockCode]));
  const porBloco = new Map<string, string[]>();
  const porFileira = new Map<string, string[]>();
  const elegiveis = new Set<string>();
  for (const p of paletes) {
    if (!elegivel(p) || p.positionId === null) continue;
    const fileira = fileiraDaPosicao.get(p.positionId);
    if (fileira === undefined) continue;
    elegiveis.add(p.id);
    porFileira.set(fileira, [...(porFileira.get(fileira) ?? []), p.id]);
    const bloco = blocoDaFileira.get(fileira);
    if (bloco !== undefined && bloco !== null) porBloco.set(bloco, [...(porBloco.get(bloco) ?? []), p.id]);
  }
  return { porBloco, porFileira, elegiveis };
}

/** Marca o grupo inteiro; se já estava todo marcado, desmarca. */
export function alternarGrupo(atual: ReadonlySet<string>, grupo: readonly string[]): Set<string> {
  const novo = new Set(atual);
  if (grupo.length === 0) return novo;
  const tudo = grupo.every((id) => novo.has(id));
  for (const id of grupo) {
    if (tudo) novo.delete(id);
    else novo.add(id);
  }
  return novo;
}

/**
 * Ordem de impressão: rua a rua (Grade por último); em cada rua, endereços
 * ímpares crescentes e depois pares decrescentes (ida por um lado, volta pelo
 * outro). Sem endereço confirmado vai ao fim, por código.
 */
export function ordenarParaImpressao(ids: readonly string[], layout: Layout, paletes: readonly PaleteResumo[]): string[] {
  const posicao = new Map(layout.positions.map((p) => [p.id, p]));
  const info = new Map(
    paletes.map((p) => {
      const pos = p.positionId === null ? undefined : posicao.get(p.positionId);
      const texto = pos?.address?.state === 'CONFIRMADO' ? pos.address.text : null;
      return [p.id, { code: p.code, ...decomporEnderecoEspelho(texto) }] as const;
    }),
  );
  const rua = (row: string | null) => (row === null ? Number.POSITIVE_INFINITY : row === 'GR' ? 1e6 : Number(row));
  return [...ids].sort((a, b) => {
    const x = info.get(a);
    const y = info.get(b);
    if (x === undefined || y === undefined) return 0;
    if (rua(x.row) !== rua(y.row)) return rua(x.row) < rua(y.row) ? -1 : 1;
    if (x.number === null || y.number === null) return x.code.localeCompare(y.code, 'pt-BR', { numeric: true });
    const impar = (n: number) => n % 2 === 1;
    if (impar(x.number) !== impar(y.number)) return impar(x.number) ? -1 : 1;
    return impar(x.number) ? x.number - y.number : y.number - x.number;
  });
}
