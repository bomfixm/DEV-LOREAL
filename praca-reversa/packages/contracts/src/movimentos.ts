import { z } from 'zod';
import { UsuarioResumoSchema } from './acesso.js';
import { CodigoPosicaoSchema } from './codigos.js';
import { ConferenciaResumoSchema } from './conferencia.js';
import { FORMATO_QUANTIDADE, QuantidadeSchema, paraMilesimos } from './decimal.js';
import { EventoEstoqueSchema, PaleteReferenciaSchema } from './estoque.js';
import { PaleteDetalheSchema } from './paletes.js';

/**
 * Movimentações (etapa 05; docs/DADOS-E-REGRAS.md R10–R14): mudança de
 * localização do palete e transferência de quantidade validada entre paletes,
 * com histórico e correções vinculadas ao original. Disponível = saldo
 * validado − reservas ativas; quantidade só declarada ou observada não é
 * transferível.
 */

const versao = z.number().int().positive();
const motivo = (rotulo: string) =>
  z
    .string()
    .trim()
    .min(3, `${rotulo}: 3 a 500 caracteres.`)
    .max(500, `${rotulo}: 3 a 500 caracteres.`)
    .regex(/^(?:[^\p{Cc}]|[\n\r\t])*$/u, `${rotulo}: caracteres inválidos.`);
const quantidadePositiva = z
  .string()
  .regex(FORMATO_QUANTIDADE, 'Quantidade: número com até 3 casas decimais (ex.: 8 ou 1,5).')
  // O Zod 4 executa o refine mesmo quando o formato falhou: só converte texto válido.
  .refine((q) => !FORMATO_QUANTIDADE.test(q) || paraMilesimos(q) > 0n, 'A quantidade precisa ser maior que zero.');

/**
 * SAIDA_EXPEDICAO (etapa 08): o palete inteiro saiu numa expedição confirmada e liberou a posição.
 * RETIRADA_VAZIO (etapa 10): palete vazio retirado da posição depois de uma consolidação; nenhuma unidade sai do estoque.
 */
export const TipoEventoLocalizacaoSchema = z.enum(['MOVIMENTO', 'CORRECAO', 'SAIDA_EXPEDICAO', 'RETIRADA_VAZIO']);
export type TipoEventoLocalizacao = z.infer<typeof TipoEventoLocalizacaoSchema>;

// ---------- Entradas ----------

/** POST /paletes/:id/movimentos — mudar o endereço do palete. */
export const MoverPaleteSchema = z.object({
  destinationPositionId: z.uuid(),
  /** Código da posição de destino confirmado por quem move (recusado se não for o atual). */
  confirmedPositionCode: CodigoPosicaoSchema,
  expectedVersion: versao,
  reason: motivo('Motivo da movimentação'),
});
export type MoverPalete = z.input<typeof MoverPaleteSchema>;

/**
 * POST /paletes/:id/retirada-vazio — o palete físico ficou vazio (por exemplo,
 * depois de transferir todo o conteúdo para outro palete) e sai da posição.
 * O servidor só aceita palete sem saldo validado, sem reserva/vínculo, sem
 * conferência em andamento e com o conteúdo conhecido por conferência completa
 * reconciliada. O ID e o código ficam arquivados (nunca reutilizados).
 */
export const RetirarPaleteVazioSchema = z.object({
  expectedVersion: versao,
  reason: motivo('Motivo da retirada'),
  /** Quem retira confirma que o palete físico está vazio. */
  confirmEmpty: z.literal(true, { error: 'Confirme que o palete físico está vazio.' }),
});
export type RetirarPaleteVazio = z.input<typeof RetirarPaleteVazioSchema>;

/** POST /transferencias — quantidade de um segmento de um palete para outro. */
export const TransferirSchema = z
  .object({
    sourcePalletId: z.uuid(),
    destinationPalletId: z.uuid(),
    segmentId: z.uuid(),
    quantity: quantidadePositiva,
    expectedSourceVersion: versao,
    expectedDestinationVersion: versao,
    reason: motivo('Motivo da transferência'),
  })
  .refine((t) => t.sourcePalletId !== t.destinationPalletId, { path: ['destinationPalletId'], message: 'Origem e destino precisam ser paletes diferentes.' });
export type Transferir = z.input<typeof TransferirSchema>;

/**
 * POST /transferencias/:eventoId/correcao — devolve (compensa) parte ou toda a
 * quantidade de uma transferência: sai do palete que recebeu e volta ao de
 * origem. Versões vistas dos dois paletes.
 */
export const CorrigirTransferenciaSchema = z.object({
  quantity: quantidadePositiva,
  /** Versão do palete que recebeu na transferência original (de onde a quantidade sai agora). */
  expectedSourceVersion: versao,
  /** Versão do palete de origem da transferência original (para onde a quantidade volta). */
  expectedDestinationVersion: versao,
  reason: motivo('Motivo da correção'),
});
export type CorrigirTransferencia = z.input<typeof CorrigirTransferenciaSchema>;

/**
 * POST /movimentos/:eventoId/correcao — corrige o último movimento de
 * localização: o palete vai para a posição informada (por padrão a anterior),
 * validada contra a ocupação atual. `null` só quando a localização anterior
 * era pendente.
 */
export const CorrigirLocalizacaoSchema = z
  .object({
    destinationPositionId: z.uuid().nullable(),
    confirmedPositionCode: CodigoPosicaoSchema.nullable(),
    expectedVersion: versao,
    reason: motivo('Motivo da correção'),
  })
  .refine((c) => (c.destinationPositionId === null) === (c.confirmedPositionCode === null), {
    path: ['confirmedPositionCode'],
    message: 'Confirme o código da posição de destino.',
  });
export type CorrigirLocalizacao = z.input<typeof CorrigirLocalizacaoSchema>;

// ---------- Respostas ----------

export const PosicaoReferenciaSchema = z.object({ id: z.uuid(), code: z.string().min(1) });

export const EventoLocalizacaoSchema = z.object({
  id: z.uuid(),
  type: TipoEventoLocalizacaoSchema,
  pallet: PaleteReferenciaSchema,
  /** Posição anterior; `null` = localização pendente. Código como era no momento. */
  from: PosicaoReferenciaSchema.nullable(),
  to: PosicaoReferenciaSchema.nullable(),
  reason: z.string().min(1),
  author: UsuarioResumoSchema.nullable(),
  at: z.iso.datetime(),
  correctedEventId: z.uuid().nullable(),
});
export type EventoLocalizacao = z.infer<typeof EventoLocalizacaoSchema>;

export const ResultadoMovimentoSchema = z.object({ event: EventoLocalizacaoSchema, pallet: PaleteDetalheSchema });
export type ResultadoMovimento = z.infer<typeof ResultadoMovimentoSchema>;

export const ResultadoTransferenciaSchema = z.object({
  event: EventoEstoqueSchema,
  source: PaleteDetalheSchema,
  destination: PaleteDetalheSchema,
  /** Avisos (ex.: contagem aguardando validação que ficou desatualizada). */
  notes: z.array(z.string().min(1)),
});
export type ResultadoTransferencia = z.infer<typeof ResultadoTransferenciaSchema>;

/** Histórico de localização e conteúdo (GET /paletes/:id/historico). */
export const HistoricoPaleteSchema = z.object({
  pallet: z.object({
    id: z.uuid(),
    code: z.string().min(1),
    createdAt: z.iso.datetime(),
    createdBy: UsuarioResumoSchema.nullable(),
    /** Posição no cadastro (antes do primeiro movimento registrado); `null` = pendente. */
    initialPosition: PosicaoReferenciaSchema.nullable(),
    currentPosition: PosicaoReferenciaSchema.nullable(),
    version: z.number().int().positive(),
  }),
  locationEvents: z.array(
    EventoLocalizacaoSchema.extend({
      /** Último movimento de localização do palete: só ele pode ser corrigido. */
      latest: z.boolean(),
      correctedBy: z.array(z.object({ id: z.uuid(), at: z.iso.datetime() })),
    }),
  ),
  stockEvents: z.array(
    EventoEstoqueSchema.extend({
      /** Transferências: quantidade ainda não compensada por correções. */
      remainingCompensable: QuantidadeSchema.nullable(),
      correctedBy: z.array(z.object({ id: z.uuid(), at: z.iso.datetime() })),
    }),
  ),
  sessions: z.array(ConferenciaResumoSchema),
});
export type HistoricoPalete = z.infer<typeof HistoricoPaleteSchema>;
