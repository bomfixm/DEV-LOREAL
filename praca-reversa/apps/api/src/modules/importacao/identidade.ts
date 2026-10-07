/**
 * Identidade documental (carga do inventário em lote): o número da NF sozinho
 * não identifica o documento. O contexto é [tipo ou TIPO_PENDENTE, número,
 * DELIVERY e o valor dele] ou, sem DELIVERY, [tipo, número, REMETENTE e o nome
 * informado]. A identidade é o SHA-256 do JSON desse contexto — o mesmo cálculo
 * da `chave_documento` do pacote preparado (conferido linha a linha na carga),
 * para que vínculos da planilha e do pacote se agrupem do mesmo jeito.
 */
import { createHash } from 'node:crypto';

export type ContextoDocumental = readonly [string, string, 'DELIVERY' | 'REMETENTE', string];

const vazio = (v: string | null | undefined) => v === null || v === undefined || v.trim() === '';

/** Remetente no contexto: NFKD sem acentos, espaços colapsados, maiúsculas ("Atacadão S.a" → "ATACADAO S.A"; "L´oreal" → "L OREAL"). */
export function normalizarRemetente(remetente: string | null): string {
  return (remetente ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function contextoDocumental(tipo: string | null, numero: string, delivery: string | null, remetente: string | null): ContextoDocumental {
  return [vazio(tipo) ? 'TIPO_PENDENTE' : (tipo ?? ''), numero, vazio(delivery) ? 'REMETENTE' : 'DELIVERY', vazio(delivery) ? normalizarRemetente(remetente) : (delivery ?? '')];
}

export function hashContexto(contexto: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(contexto)).digest('hex');
}

export function identidadeDocumento(tipo: string | null, numero: string, delivery: string | null, remetente: string | null): string {
  return hashContexto(contextoDocumental(tipo, numero, delivery, remetente));
}

/**
 * Total de paletes declarado pelo marcador PALLET FULL ("01\\02", "01\\02 02\\02"):
 * o denominador, se for o mesmo em todas as partes; `null` se ausente ou
 * inconsistente. Partes = numeradores. Nada é multiplicado nem presumido.
 */
export function lerMarcadoresFull(textos: readonly (string | null)[]): { total: number | null; partes: number[] } {
  const totais = new Set<number>();
  const partes: number[] = [];
  for (const texto of textos) {
    for (const m of (texto ?? '').matchAll(/(\d{1,3})\s*[\\/]\s*(\d{1,3})/g)) {
      const parte = Number(m[1]);
      const total = Number(m[2]);
      if (parte >= 1 && total >= 1 && parte <= total) {
        totais.add(total);
        if (!partes.includes(parte)) partes.push(parte);
      }
    }
  }
  const [unico] = totais;
  return { total: totais.size === 1 && unico !== undefined ? unico : null, partes: partes.sort((a, b) => a - b) };
}
