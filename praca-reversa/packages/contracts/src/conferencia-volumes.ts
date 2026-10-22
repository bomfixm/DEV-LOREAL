import { z } from 'zod';
import { ReconferenciaPaleteSchema } from './reconferencia.js';

/**
 * Conferência de volumes em tabela (21 out. 2026). Uma operação cobre o palete
 * inteiro (COMPLETA: o operador declara que conferiu fisicamente todos os
 * conteúdos; renova o prazo de 20 dias) ou só as linhas verificadas
 * (PARCIAL: não renova o prazo nem marca o palete como conferido). A
 * quantidade atual é só referência; a contada vira a quantidade atual quando
 * difere (130 → 126 grava 126, guarda 130 e a diferença −4). Ocupação,
 * conferência e divergência são informações separadas.
 */

/** Estado da conferência de volumes do palete (derivado no servidor). */
export const EstadoConferenciaVolumesSchema = z.enum(['NAO_CONFERIDO', 'PARCIAL', 'CONFERIDO', 'CONFERIDO_COM_DIFERENCA']);
export type EstadoConferenciaVolumes = z.infer<typeof EstadoConferenciaVolumesSchema>;

export const ROTULOS_CONFERENCIA_VOLUMES: Readonly<Record<EstadoConferenciaVolumes, { texto: string; curto: string; marcador: string }>> = {
  NAO_CONFERIDO: { texto: 'Não conferido', curto: 'Não conferido', marcador: '?' },
  PARCIAL: { texto: 'Conferido parcialmente', curto: 'Parcial', marcador: '½' },
  CONFERIDO: { texto: 'Conferido sem diferença', curto: 'Conferido', marcador: '✓' },
  CONFERIDO_COM_DIFERENCA: { texto: 'Conferido com diferença', curto: 'Com diferença', marcador: '≠' },
};

const PessoaSchema = z.object({ login: z.string().min(1), name: z.string().min(1) });

/** Resumo da conferência de volumes do palete (mapa, lista, detalhe e janela). */
export const ConferenciaVolumesPaleteSchema = z.object({
  state: EstadoConferenciaVolumesSchema,
  /** Conteúdos ativos do palete agora. */
  items: z.number().int().nonnegative(),
  /** Conteúdos abrangidos por conferência depois de entrarem no palete. */
  covered: z.number().int().nonnegative(),
  /** Conteúdos cuja conferência mais recente encontrou diferença (divergência visível). */
  differences: z.number().int().nonnegative(),
  lastCompleteAt: z.iso.datetime().nullable(),
  lastCompleteBy: PessoaSchema.nullable(),
});
export type ConferenciaVolumesPalete = z.infer<typeof ConferenciaVolumesPaleteSchema>;

/** Conferência de uma ocorrência (linha da tabela). */
export const ConferenciaItemSchema = z.object({
  state: z.enum(['NAO_CONFERIDO', 'CONFERIDO', 'CONFERIDO_COM_DIFERENCA']),
  at: z.iso.datetime().nullable(),
  by: PessoaSchema.nullable(),
  /** Quantidade antes da conferência mais recente (`null` = não havia referência). */
  previous: z.number().int().nonnegative().nullable(),
  counted: z.number().int().nonnegative().nullable(),
  /** contado − anterior; `null` sem referência anterior. */
  difference: z.number().int().nullable(),
  /** Operação de conferência (consulta do conjunto); `null` em contagem avulsa antiga. */
  operationId: z.uuid().nullable(),
  scope: z.enum(['COMPLETA', 'PARCIAL', 'AVULSA']).nullable(),
});
export type ConferenciaItem = z.infer<typeof ConferenciaItemSchema>;

const volumes = z.number({ error: 'Informe os volumes contados (número inteiro).' }).int('Volumes inteiros.').min(0, 'Volumes não podem ser negativos.').max(100_000);

/** POST /paletes/:id/conferencias-volumes */
export const RegistrarConferenciaVolumesSchema = z
  .object({
    scope: z.enum(['COMPLETA', 'PARCIAL']),
    /** Declaração explícita de conferência física de todos os conteúdos (obrigatória na completa). */
    physicalDeclaration: z.boolean(),
    /** Assinatura do conjunto exibido (GET dos conteúdos): conjunto mudou = conferência recusada para revisão. */
    setSignature: z.string().min(1).max(200),
    lines: z
      .array(z.object({ kind: z.enum(['REGISTRADO', 'IMPORTADO']), id: z.uuid(), counted: volumes }))
      .min(1, 'Marque ao menos um conteúdo conferido.')
      .max(2_000),
    notes: z.string().trim().max(500).nullable().default(null),
  })
  .superRefine((c, ctx) => {
    if (c.scope === 'COMPLETA' && !c.physicalDeclaration) {
      ctx.addIssue({ code: 'custom', path: ['physicalDeclaration'], message: 'Declare que conferiu fisicamente todos os conteúdos do palete.' });
    }
    const ids = new Set(c.lines.map((l) => l.id));
    if (ids.size !== c.lines.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Conteúdo repetido na conferência.' });
  });
export type RegistrarConferenciaVolumes = z.input<typeof RegistrarConferenciaVolumesSchema>;

export const DiferencaConferidaSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['REGISTRADO', 'IMPORTADO']),
  document: z.string(),
  previous: z.number().int().nonnegative().nullable(),
  counted: z.number().int().nonnegative(),
  difference: z.number().int().nullable(),
});
export type DiferencaConferida = z.infer<typeof DiferencaConferidaSchema>;

/** Resposta: o que foi gravado (fecha a tela só depois dela). */
export const ResultadoConferenciaVolumesSchema = z.object({
  operationId: z.uuid(),
  palletId: z.uuid(),
  palletCode: z.string(),
  scope: z.enum(['COMPLETA', 'PARCIAL']),
  at: z.iso.datetime(),
  by: PessoaSchema,
  items: z.number().int().positive(),
  changed: z.number().int().nonnegative(),
  differences: z.array(DiferencaConferidaSchema),
  volumesBefore: z.number().int().nonnegative().nullable(),
  volumesAfter: z.number().int().nonnegative().nullable(),
  volumeCheck: ConferenciaVolumesPaleteSchema,
  reconference: ReconferenciaPaleteSchema.nullable(),
});
export type ResultadoConferenciaVolumes = z.infer<typeof ResultadoConferenciaVolumesSchema>;
