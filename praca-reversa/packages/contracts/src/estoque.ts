import { z } from 'zod';
import { UsuarioResumoSchema } from './acesso.js';
import { QuantidadeComSinalSchema, QuantidadeSchema } from './decimal.js';
import { CondicaoMaterialSchema, TipoOrigemDocumentoSchema } from './estados.js';

/**
 * Eventos de estoque validado (etapas 04 e 05). Imutáveis: correções geram
 * novo evento vinculado ao original.
 *
 * - SALDO_INICIAL / AJUSTE_RECONCILIACAO: reconciliação de conferência completa.
 * - TRANSFERENCIA: baixa no palete de origem e entrada no de destino, mesmo segmento.
 * - CORRECAO_TRANSFERENCIA: compensação (parcial ou total) de uma transferência.
 * - EXPEDICAO: baixa do material fisicamente enviado numa expedição confirmada (etapa 08).
 */
export const TipoEventoEstoqueSchema = z.enum(['SALDO_INICIAL', 'AJUSTE_RECONCILIACAO', 'TRANSFERENCIA', 'CORRECAO_TRANSFERENCIA', 'EXPEDICAO']);
export type TipoEventoEstoque = z.infer<typeof TipoEventoEstoqueSchema>;

/** Tipos que validam o conteúdo inteiro do palete (conferência completa reconciliada). */
export const TIPOS_RECONCILIACAO: readonly TipoEventoEstoque[] = ['SALDO_INICIAL', 'AJUSTE_RECONCILIACAO'];

export function ehReconciliacao(tipo: TipoEventoEstoque): boolean {
  return TIPOS_RECONCILIACAO.includes(tipo);
}

export const PaleteReferenciaSchema = z.object({ id: z.uuid(), code: z.string().min(1) });
export type PaleteReferencia = z.infer<typeof PaleteReferenciaSchema>;

export const LinhaEventoSchema = z.object({
  /** Palete cujo saldo a linha altera. */
  pallet: PaleteReferenciaSchema,
  segmentId: z.uuid(),
  segmentKey: z.string().min(1),
  productId: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  lot: z.string().min(1).nullable(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().min(1).nullable(),
  condition: CondicaoMaterialSchema,
  /** Identidade própria de segmento com lote/origem pendentes (não é unido a outro só por ter campos nulos). */
  lineage: z.string().min(1).nullable(),
  unit: z.string().min(1),
  before: QuantidadeSchema,
  delta: QuantidadeComSinalSchema,
  after: QuantidadeSchema,
});
export type LinhaEvento = z.infer<typeof LinhaEventoSchema>;

export const EventoEstoqueSchema = z.object({
  id: z.uuid(),
  type: TipoEventoEstoqueSchema,
  /** Palete principal (reconciliado, ou de onde a quantidade saiu). */
  pallet: PaleteReferenciaSchema,
  /** Palete que recebeu a quantidade (transferências e correções). */
  destination: PaleteReferenciaSchema.nullable(),
  session: z.object({ id: z.uuid(), number: z.number().int().positive() }).nullable(),
  reason: z.string().min(1),
  author: UsuarioResumoSchema.nullable(),
  at: z.iso.datetime(),
  /** Evento de estoque anterior do palete principal. */
  previousEventId: z.uuid().nullable(),
  /** Evento original compensado por esta correção. */
  correctedEventId: z.uuid().nullable(),
  lines: z.array(LinhaEventoSchema),
});
export type EventoEstoque = z.infer<typeof EventoEstoqueSchema>;
