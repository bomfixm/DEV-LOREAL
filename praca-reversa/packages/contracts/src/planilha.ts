import { z } from 'zod';

/**
 * Planilha automática e proteção dos dados (26 out. 2026): cópia de consulta
 * (Inventário, Movimentações, Proteção e ajuda) gerada depois das transações
 * confirmadas, com revisão crescente por escopo, e publicada num destino
 * independente quando configurado. O PostgreSQL continua sendo a fonte
 * oficial; a planilha não altera a operação.
 */

/** Estado de cada item pela evidência registrada (nunca verde só porque o servidor responde). */
export const EstadoProtecaoSchema = z.enum(['Atualizada', 'Atualizando', 'Aguardando', 'Atrasada', 'Falhou', 'Não configurado']);
export type EstadoProtecao = z.infer<typeof EstadoProtecaoSchema>;

export const ItemProtecaoSchema = z.object({
  resource: z.string().min(1),
  state: EstadoProtecaoSchema,
  lastSuccess: z.iso.datetime().nullable(),
  detail: z.string(),
});
export type ItemProtecao = z.infer<typeof ItemProtecaoSchema>;

/** Uma revisão gerada (arquivo validado na pasta local do servidor). */
export const RevisaoPlanilhaSchema = z.object({
  revision: z.number().int().positive(),
  reason: z.enum(['ALTERACAO', 'RECONCILIACAO', 'MANUAL', 'PRE_SUBSTITUICAO']),
  generatedAt: z.iso.datetime(),
  /** Instante do snapshot (todas as abas do mesmo momento). */
  dataAt: z.iso.datetime(),
  /** Alteração confirmada mais recente incluída. */
  lastChangeAt: z.iso.datetime().nullable(),
  changes: z.number().int().nonnegative(),
  activeBatch: z.string().nullable(),
  /** Cópia preservada antes de uma substituição do inventário. */
  preReplacement: z.boolean(),
  sizeBytes: z.number().int().positive(),
  files: z.number().int().positive(),
  records: z.record(z.string(), z.number()),
  /** Confirmada no destino independente (relida e conferida); `null` = só no servidor. */
  publishedAt: z.iso.datetime().nullable(),
  /** O arquivo ainda está na pasta local (a retenção pode ter removido versões antigas). */
  downloadable: z.boolean(),
});
export type RevisaoPlanilha = z.infer<typeof RevisaoPlanilhaSchema>;

export const FalhaProtecaoSchema = z.object({
  at: z.iso.datetime(),
  stage: z.enum(['GERACAO', 'ENVIO', 'BACKUP']),
  message: z.string(),
});
export type FalhaProtecao = z.infer<typeof FalhaProtecaoSchema>;

/** GET /planilha/situacao */
export const SituacaoPlanilhaSchema = z.object({
  fileName: z.string().min(1),
  automatic: z.boolean(),
  demo: z.boolean(),
  timezone: z.literal('America/Sao_Paulo'),
  /** Alvo de publicação depois de uma alteração comum (não é garantia) e limite para "Atrasada". */
  targetSeconds: z.number().int().positive(),
  delayLimitSeconds: z.number().int().positive(),
  destination: z.object({
    configured: z.boolean(),
    independent: z.boolean(),
    type: z.enum(['S3', 'PASTA']).nullable(),
    /** Onde consultar (sem credencial nem URL assinada). */
    description: z.string().nullable(),
    /** Por que não conta como independente. */
    reason: z.string().nullable(),
  }),
  /** Última alteração confirmada no aplicativo e a revisão que a inclui (ou incluirá, se pendente). */
  lastChange: z.object({ at: z.iso.datetime().nullable(), revision: z.number().int().nonnegative().nullable(), pending: z.boolean() }),
  pending: z.object({ count: z.number().int().nonnegative(), since: z.iso.datetime().nullable(), delaySeconds: z.number().int().nonnegative().nullable() }),
  working: z.boolean(),
  revisions: z.object({
    generated: z.number().int().nonnegative().nullable(),
    published: z.number().int().nonnegative().nullable(),
    publishedAt: z.iso.datetime().nullable(),
  }),
  items: z.array(ItemProtecaoSchema),
  latest: RevisaoPlanilhaSchema.nullable(),
  versions: z.array(RevisaoPlanilhaSchema),
  failures: z.array(FalhaProtecaoSchema),
  canPublish: z.boolean(),
  canDownload: z.boolean(),
  consultedAt: z.iso.datetime(),
});
export type SituacaoPlanilha = z.infer<typeof SituacaoPlanilhaSchema>;

/** POST /planilha/publicar ("Tentar novamente agora"): reprocessa geração, envio e backup pendentes. */
export const ResultadoPublicacaoPlanilhaSchema = z.object({
  result: z.enum(['PUBLICADA', 'GERADA', 'EM_DIA', 'FALHOU', 'OCUPADO']),
  revision: z.number().int().positive().nullable(),
  error: z.string().nullable(),
  situation: SituacaoPlanilhaSchema,
});
export type ResultadoPublicacaoPlanilha = z.infer<typeof ResultadoPublicacaoPlanilhaSchema>;
