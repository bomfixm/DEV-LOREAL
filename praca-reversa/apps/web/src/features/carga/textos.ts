import type { PaleteEmbarque } from '@praca-reversa/contracts';

/** Selo curto da documentação (sempre com texto, não só cor). */
export function textoDocs(p: PaleteEmbarque): string {
  switch (p.docs.state) {
    case 'AGUARDANDO_FISICO':
      return 'Aguarda físico';
    case 'PENDENTE':
      return `Docs ${String(p.docs.checked)}/${String(p.docs.total)}`;
    case 'COM_PROBLEMA':
      return `Docs: ${String(p.docs.missing + p.docs.divergent)} problema(s)`;
    case 'CONFERIDA':
      return 'Docs conferidos';
  }
}
