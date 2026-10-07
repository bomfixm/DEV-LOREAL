import { z } from 'zod';

/**
 * Planilha única e proteção dos dados: cópia para consulta (Inventário,
 * Movimentações, Proteção e ajuda), gerada depois das transações confirmadas
 * e publicada num destino independente quando configurado. O PostgreSQL
 * continua sendo a fonte oficial; a planilha não altera a operação.
 */

export const EstadoProtecaoSchema = z.enum(['Atualizada', 'Atualização pendente', 'Falhou', 'Não configurado', 'Não testado']);
export type EstadoProtecao = z.infer<typeof EstadoProtecaoSchema>;

export const ItemProtecaoSchema = z.object({
  resource: z.string().min(1),
  state: EstadoProtecaoSchema,
  lastSuccess: z.iso.datetime().nullable(),
  detail: z.string(),
});
export type ItemProtecao = z.infer<typeof ItemProtecaoSchema>;

export const VersaoPlanilhaSchema = z.object({
  version: z.number().int().positive(),
  state: z.enum(['GERANDO', 'PUBLICADA', 'GERADA_LOCAL', 'FALHOU']),
  reason: z.enum(['ALTERACAO', 'RECONCILIACAO', 'MANUAL']),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  snapshotAt: z.iso.datetime().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  destination: z.enum(['PASTA', 'LOCAL']).nullable(),
  identification: z.string().nullable(),
  error: z.string().nullable(),
  /** Linhas do inventário, notas sem alocação e eventos incluídos. */
  records: z.record(z.string(), z.number()).nullable(),
});
export type VersaoPlanilha = z.infer<typeof VersaoPlanilhaSchema>;

/** GET /planilha/situacao */
export const SituacaoPlanilhaSchema = z.object({
  fileName: z.string().min(1),
  automatic: z.boolean(),
  destinationConfigured: z.boolean(),
  /** Onde consultar (descrição configurada; nunca URL assinada nem credencial). */
  destinationDescription: z.string().nullable(),
  demo: z.boolean(),
  pending: z.object({ count: z.number().int().nonnegative(), since: z.iso.datetime().nullable(), delaySeconds: z.number().int().nonnegative().nullable() }),
  publishing: z.boolean(),
  items: z.array(ItemProtecaoSchema),
  /** Última versão gerada (publicada ou local) e o arquivo para download. */
  lastGenerated: VersaoPlanilhaSchema.nullable(),
  recent: z.array(VersaoPlanilhaSchema),
  canPublish: z.boolean(),
  canDownload: z.boolean(),
  consultedAt: z.iso.datetime(),
});
export type SituacaoPlanilha = z.infer<typeof SituacaoPlanilhaSchema>;

/** POST /planilha/publicar */
export const ResultadoPublicacaoPlanilhaSchema = z.object({
  result: z.enum(['PUBLICADA', 'GERADA_LOCAL', 'FALHOU', 'OCUPADO']),
  version: z.number().int().positive().nullable(),
  error: z.string().nullable(),
  situation: SituacaoPlanilhaSchema,
});
export type ResultadoPublicacaoPlanilha = z.infer<typeof ResultadoPublicacaoPlanilhaSchema>;
