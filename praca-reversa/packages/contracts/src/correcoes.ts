import { z } from 'zod';

/**
 * Correção de conteúdos do palete (21 out. 2026): mover para outro
 * palete/posição, enviar à validação sem endereço e cancelar registro
 * incorreto — uma ou várias ocorrências por vez, selecionadas pelo ID (nunca
 * pelo número da NF). Cada ação é uma operação: transação, conjunto conferido
 * no servidor, chave de idempotência e histórico com autor, data e motivo.
 * Só perfis internos com `conteudo.corrigir`; o cliente não vê nem faz nada disto.
 */

export const AlvoOcorrenciaSchema = z.object({ kind: z.enum(['REGISTRADO', 'IMPORTADO']), id: z.uuid() });
export type AlvoOcorrencia = z.infer<typeof AlvoOcorrenciaSchema>;

/** Destino escolhido no mapa: posição (vazia = palete novo pelo cadastro existente; ocupada = o palete dela) ou palete. */
export const DestinoOcorrenciaSchema = z.object({ kind: z.enum(['POSICAO', 'PALETE']), id: z.uuid() });
export type DestinoOcorrencia = z.infer<typeof DestinoOcorrenciaSchema>;

const motivo = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(3, 'Informe o motivo (3 caracteres ou mais).').max(300, 'Até 300 caracteres.'));

const itens = z
  .array(AlvoOcorrenciaSchema)
  .min(1, 'Selecione ao menos um conteúdo.')
  .max(1_000, 'Até 1.000 conteúdos por operação.')
  .refine((l) => new Set(l.map((x) => x.id)).size === l.length, 'Conteúdo repetido na seleção.');

/** POST /paletes/:id/conteudos/acoes — `items` são do palete :id (conjunto conferido no servidor). */
export const AcaoConteudosSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('MOVER'),
    items: itens,
    destination: DestinoOcorrenciaSchema,
    /** Destino com conteúdo: confirmação explícita (conteúdo e número do destino preservados). */
    confirmOccupied: z.boolean().default(false),
    reason: z.union([z.null(), motivo]).default(null),
  }),
  z.object({ action: z.literal('VALIDACAO'), items: itens, reason: motivo }),
  z.object({
    action: z.literal('CANCELAR'),
    items: itens,
    reason: motivo,
    confirm: z.literal(true, { error: 'Confirme o cancelamento do registro incorreto.' }),
  }),
]);
export type AcaoConteudos = z.input<typeof AcaoConteudosSchema>;

/** POST /validacao/resolver — pendências escolhidas e o destino verdadeiro no mapa. */
export const ResolverValidacaoSchema = z.object({
  items: itens,
  destination: DestinoOcorrenciaSchema,
  confirmOccupied: z.boolean().default(false),
  reason: z.union([z.null(), motivo]).default(null),
});
export type ResolverValidacao = z.input<typeof ResolverValidacaoSchema>;

const PaleteRefSchema = z.object({ id: z.uuid(), code: z.string(), address: z.string().nullable() });

export const ResultadoAcaoConteudosSchema = z.object({
  operationId: z.uuid(),
  action: z.enum(['MOVER', 'VALIDACAO', 'CANCELAR', 'RESOLUCAO']),
  affected: z.number().int().positive(),
  /** Volumes atuais das ocorrências afetadas (soma conhecida) e quantas estavam sem quantidade. */
  volumes: z.number().int().nonnegative(),
  withoutVolumes: z.number().int().nonnegative(),
  origin: PaleteRefSchema.extend({ remaining: z.number().int().nonnegative(), emptied: z.boolean() }).nullable(),
  destination: PaleteRefSchema.extend({ created: z.boolean(), items: z.number().int().nonnegative() }).nullable(),
  /** Avisos (identidade coincidente no destino, palete de origem vazio…): informam, nada é fundido. */
  warnings: z.array(z.string()),
});
export type ResultadoAcaoConteudos = z.infer<typeof ResultadoAcaoConteudosSchema>;

const PessoaSchema = z.object({ login: z.string().min(1), name: z.string().min(1) });

/** Evento real do histórico de uma ocorrência (nada reconstruído como se fosse auditado). */
export const EventoOcorrenciaSchema = z.object({
  at: z.iso.datetime(),
  type: z.enum(['IMPORTACAO', 'REGISTRO', 'CONTAGEM', 'CONFERENCIA', 'MOVIMENTO', 'VALIDACAO', 'RESOLUCAO', 'CANCELAMENTO', 'ENCERRAMENTO']),
  text: z.string(),
  /** `null` = autor não registrado. */
  by: PessoaSchema.nullable(),
  reason: z.string().nullable(),
  operationId: z.uuid().nullable(),
});
export type EventoOcorrencia = z.infer<typeof EventoOcorrenciaSchema>;

/** Pendência da fila "Validação urgente — sem endereço" (interna). */
export const ItemValidacaoSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['REGISTRADO', 'IMPORTADO']),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  sender: z.string().nullable(),
  delivery: z.string().nullable(),
  /** Quantidade atual (última contagem ou a do inventário); `null` = desconhecida. */
  volumes: z.number().int().nonnegative().nullable(),
  reason: z.string().nullable(),
  since: z.iso.datetime(),
  by: PessoaSchema.nullable(),
  /** Último palete/endereço conhecidos — HISTÓRICO, não localização atual. */
  lastKnown: PaleteRefSchema.nullable(),
  /** Origem do registro (inventário e linha, bipagem ou cadastro). */
  source: z.string().nullable(),
  /** Nomes internos para o detalhe administrativo. */
  technical: z.object({ occurrenceId: z.uuid(), batchId: z.uuid().nullable(), row: z.number().int().nullable(), inventory: z.string().nullable() }),
  history: z.array(EventoOcorrenciaSchema),
});
export type ItemValidacao = z.infer<typeof ItemValidacaoSchema>;

export const FilaValidacaoSchema = z.object({
  items: z.array(ItemValidacaoSchema),
  total: z.number().int().nonnegative(),
  volumes: z.number().int().nonnegative(),
});
export type FilaValidacao = z.infer<typeof FilaValidacaoSchema>;

/** Contagem da fila para o cartão do mapa. */
export const ResumoValidacaoSchema = z.object({ total: z.number().int().nonnegative(), volumes: z.number().int().nonnegative() });
export type ResumoValidacao = z.infer<typeof ResumoValidacaoSchema>;
