import { somarQuantidades, type ConteudoPalete, type PaleteResumo } from '@praca-reversa/contracts';
import { formatarQuantidade } from '../../utils/numeros';

/** Texto de dado ausente na janela do palete (nunca um zero fabricado). */
export const NAO_INFORMADO = 'Não informado';

type ComContagem = Pick<ConteudoPalete, 'count'>;

/** Base dos volumes em poucas palavras: de onde vêm as contagens vigentes. */
export function baseDosVolumes(itens: readonly ComContagem[]): string | null {
  const origens = new Set(itens.flatMap((i) => (i.count.origin === null || i.count.counted === null ? [] : [i.count.origin])));
  if (origens.size === 0) return null;
  if (origens.size > 1) return 'contagens registradas';
  const [origem] = [...origens];
  return origem === 'BIPAGEM' ? 'lidos na bipagem' : origem === 'IMPORTACAO' ? 'do inventário' : 'contados';
}

/** Soma exata das contagens conhecidas (`null` = nenhuma) e quantos conteúdos estão sem contagem. */
export function somaContada(itens: readonly ComContagem[]): { total: string | null; semContagem: number } {
  const conhecidos = itens.flatMap((i) => (i.count.counted === null ? [] : [i.count.counted]));
  return { total: conhecidos.length === 0 ? null : somarQuantidades(conhecidos), semContagem: itens.length - conhecidos.length };
}

export function textoVolumes(v: { total: string | null; semContagem: number }): string {
  if (v.total === null) return NAO_INFORMADO;
  return `${formatarQuantidade(v.total)}${v.semContagem > 0 ? ` (+${String(v.semContagem)} sem contagem)` : ''}`;
}

/** Aviso curto de reconferência só quando pertinente: vencida ou a até 5 dias. */
export function avisoReconferencia(p: Pick<PaleteResumo, 'reconference'>): string | null {
  const r = p.reconference;
  if (r === null) return null;
  if (r.due) return 'Precisa conferir';
  if (r.daysUntilDue <= 5) return `Conferir em ${String(r.daysUntilDue)} ${r.daysUntilDue === 1 ? 'dia' : 'dias'}`;
  return null;
}

/** Data simples do inventário (AAAA-MM-DD) em DD/MM/AAAA, sem conversão de fuso. */
export function dataSimples(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a === undefined || m === undefined || d === undefined ? iso : `${d}/${m}/${a}`;
}

type DoInventario = Pick<ConteudoPalete, 'fullKind' | 'fullTags' | 'inventoryCheck' | 'latestInventory'>;

/** FULL com as etiquetas ("FULL 1/3, 2/3") ou "Fracionado", como na planilha; `null` = não informado. */
export function textoFull(itens: readonly DoInventario[]): string | null {
  const textos = new Set(
    itens.flatMap((i) => (i.fullKind === 'FRACIONADO' ? ['Fracionado'] : i.fullKind === 'FULL' ? [i.fullTags.length > 0 ? `FULL ${i.fullTags.join(', ')}` : 'FULL'] : [])),
  );
  return textos.size === 0 ? null : [...textos].join(' · ');
}

/** Conferência informada na linha do inventário: data, "a validar" ou sem data (nunca a data do envio). */
export function textoConferenciaInformada(itens: readonly DoInventario[]): string | null {
  const textos = new Set(
    itens.flatMap((i) => {
      const c = i.inventoryCheck;
      if (c === null) return [];
      if (c.state === 'INFORMADA' && c.date !== null) return [`Conferência ${dataSimples(c.date)}`];
      return [c.state === 'A_VALIDAR' ? 'Conferência a validar' : 'Conferência sem data'];
    }),
  );
  return textos.size === 0 ? null : [...textos].join(' · ');
}
