import { z } from 'zod';
import { BaseResultadoSchema } from './busca.js';

/**
 * Tutorial de primeiro uso e preferência do usuário (etapa 10). A
 * preferência fica no servidor, por usuário: só a situação do tutorial e o
 * passo em que parou (nenhum dado operacional, nenhuma credencial).
 */
export const SituacaoTutorialSchema = z.enum(['NAO_INICIADO', 'ADIADO', 'INTERROMPIDO', 'CONCLUIDO']);
export type SituacaoTutorial = z.infer<typeof SituacaoTutorialSchema>;

/** Versão do percurso: um percurso novo pode ser oferecido de novo a quem concluiu o anterior. */
export const VERSAO_TUTORIAL = 1;
/** Passos do primeiro percurso ("encontrar um produto e saber em qual palete/endereço ele está"). */
export const PASSOS_TUTORIAL = 6;

export const PreferenciaTutorialSchema = z.object({
  state: SituacaoTutorialSchema,
  /** Passo em que o usuário saiu (1…PASSOS_TUTORIAL); nulo fora de INTERROMPIDO. */
  step: z.number().int().min(1).max(PASSOS_TUTORIAL).nullable(),
  version: z.number().int().min(1),
  updatedAt: z.iso.datetime().nullable(),
});
export type PreferenciaTutorial = z.infer<typeof PreferenciaTutorialSchema>;

export const AtualizarTutorialSchema = z
  .object({
    state: z.enum(['ADIADO', 'INTERROMPIDO', 'CONCLUIDO']),
    step: z.number().int().min(1).max(PASSOS_TUTORIAL).nullable(),
  })
  .strict()
  .refine((d) => (d.state === 'INTERROMPIDO') === (d.step !== null), { message: 'Informe o passo somente ao interromper.' });
export type AtualizarTutorial = z.infer<typeof AtualizarTutorialSchema>;

/**
 * Exemplo do primeiro percurso, descoberto no escopo ativo (somente leitura):
 * - PRODUTO: SKU com saldo validado num palete com posição (de preferência um
 *   SKU que aparece em mais de um palete ou base);
 * - PALETE: não há saldo validado, mas há palete com posição (o percurso
 *   pesquisa o código do palete);
 * - NENHUM: escopo sem palete com posição; o tutorial mostra um próximo passo
 *   válido sem pedir para criar estoque.
 */
export const ExemploTutorialSchema = z.object({
  kind: z.enum(['PRODUTO', 'PALETE', 'NENHUM']),
  demo: z.boolean(),
  product: z.object({ sku: z.string(), description: z.string(), unit: z.string() }).nullable(),
  pallet: z.object({ id: z.uuid(), code: z.string(), positionCode: z.string().nullable() }).nullable(),
  /** Onde o SKU aparece no escopo: paletes distintos e bases (saldo, observado, declarado, documento). */
  occurrences: z.object({ pallets: z.number().int().min(0), bases: z.array(BaseResultadoSchema) }),
  /** Motivo quando não há exemplo de produto. */
  reason: z.string().nullable(),
  consultedAt: z.iso.datetime(),
});
export type ExemploTutorial = z.infer<typeof ExemploTutorialSchema>;
