import type { ConteudoPalete } from '@praca-reversa/contracts';
/** Reserva espaço para texto longo; nunca corta notas para caber na folha. */
export function paginarEspelho(items: readonly ConteudoPalete[], local: { code: string; address: string | null }): ConteudoPalete[][] {
  const pages: ConteudoPalete[][] = [[]];
  let height = 0;
  for (const item of items) {
    const lines = Math.max(3, Math.ceil(local.code.length / 8), Math.ceil((local.address?.length ?? 0) / 11), Math.ceil((item.sender?.length ?? 0) / 23), Math.ceil((item.delivery?.length ?? 0) / 9), Math.ceil((item.documentNumber?.length ?? 0) / 10), Math.ceil((item.documentType?.length ?? 0) / 5));
    const rowHeight = 5 + lines * 4.2;
    if (height + rowHeight > 92 && (pages.at(-1)?.length ?? 0) > 0) { pages.push([]); height = 0; }
    pages.at(-1)?.push(item);
    height += rowHeight;
  }
  return pages;
}
