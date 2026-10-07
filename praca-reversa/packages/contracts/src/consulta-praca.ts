import { z } from 'zod';
import { EscopoSchema } from './acesso.js';
import { PaleteResumoSchema, type PaleteResumo } from './paletes.js';
import { LayoutSchema, type Layout } from './praca.js';

/**
 * Coerência entre paletes e layout: a posição do palete vem do vínculo
 * registrado; posição inexistente, de código divergente ou indisponível é
 * rejeitada. A capacidade por posição ainda é desconhecida (DESCOBERTA.md),
 * por isso o contrato não impõe um palete por posição.
 */
export function verificarOcupacao(layout: Layout, paletes: readonly PaleteResumo[]): string[] {
  const problemas: string[] = [];
  const posicoes = new Map(layout.positions.map((p) => [p.id, p]));
  const ids = new Set<string>();
  const codigos = new Set<string>();
  for (const palete of paletes) {
    if (ids.has(palete.id)) problemas.push(`ID de palete duplicado: ${palete.id}`);
    if (codigos.has(palete.code)) problemas.push(`Código de palete duplicado: ${palete.code}`);
    ids.add(palete.id);
    codigos.add(palete.code);
    if (palete.positionId === null) continue;
    const posicao = posicoes.get(palete.positionId);
    if (!posicao) {
      problemas.push(`Posição inexistente para ${palete.code}`);
      continue;
    }
    if (posicao.code !== palete.positionCode) problemas.push(`Código de posição divergente em ${palete.code}`);
    if (!posicao.available) problemas.push(`${palete.code} ocupa posição indisponível ${posicao.code}`);
  }
  return problemas;
}

/** GET /api/v1/praca: layout ativo e ocupação resumida do escopo ativo. */
export const PracaSchema = z
  .object({
    scope: EscopoSchema,
    layout: LayoutSchema.nullable(),
    pallets: z.array(PaleteResumoSchema),
    consultedAt: z.iso.datetime(),
  })
  .superRefine((praca, ctx) => {
    if (praca.layout === null) {
      if (praca.pallets.some((p) => p.positionId !== null)) {
        ctx.addIssue({ code: 'custom', message: 'Paletes com posição sem layout ativo.' });
      }
      return;
    }
    for (const problema of verificarOcupacao(praca.layout, praca.pallets)) {
      ctx.addIssue({ code: 'custom', message: problema });
    }
  });
export type Praca = z.infer<typeof PracaSchema>;
