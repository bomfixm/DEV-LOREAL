import { z } from 'zod';
import { ConteudosPaleteSchema } from './conteudos.js';
export const OpcaoEspelhoSchema = z.object({ id: z.uuid(), code: z.string(), address: z.string().nullable(), row: z.string().nullable(), number: z.number().int().nullable() });
export const OpcoesEspelhosSchema = z.object({ items: z.array(OpcaoEspelhoSchema) });
export const FiltroEspelhosSchema = z.object({
  ids: z.string().transform((v) => v.split(',')).pipe(z.array(z.uuid()).min(1).max(250)).optional(),
  rows: z.string().transform((v) => [...new Set(v.split(','))]).pipe(z.array(z.string().trim().min(1).max(40)).min(1).max(40)).optional(),
  side: z.enum(['todos', 'impares', 'pares']).default('todos'),
}).refine((v) => (v.ids !== undefined) !== (v.rows !== undefined), 'Selecione uma rua ou paletes.');
export const LoteEspelhosSchema = z.object({ generatedAt: z.iso.datetime(), scope: z.object({ name: z.string(), demo: z.boolean() }), items: z.array(OpcaoEspelhoSchema.extend({ contents: ConteudosPaleteSchema })) });
export type OpcaoEspelho = z.infer<typeof OpcaoEspelhoSchema>;
export type LoteEspelhos = z.infer<typeof LoteEspelhosSchema>;
/** Endereço operacional confirmado: a paridade é da posição, nunca da fileira. */
export function decomporEnderecoEspelho(address: string | null): { row: string | null; number: number | null } {
  if (address === null) return { row: null, number: null };
  const a = /^(?:RUA|FILEIRA)?\s*(\d+)\s*-?\s*A(\d+)$/i.exec(address.trim());
  if (a) return { row: a[1] ?? null, number: Number(a[2]) };
  const gr = /^GR\s*-?\s*(\d+)$/i.exec(address.trim());
  return gr ? { row: 'GR', number: Number(gr[1]) } : { row: null, number: null };
}
export function selecionarEspelhos<T extends OpcaoEspelho>(items: readonly T[], row: string, side: 'todos' | 'impares' | 'pares'): T[] {
  return items.filter((p) => p.row === row && (side === 'todos' || (p.number !== null && p.number % 2 === (side === 'impares' ? 1 : 0))))
    .sort((a, b) => ((a.number ?? 0) - (b.number ?? 0)) * (side === 'pares' ? -1 : 1) || a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
}
