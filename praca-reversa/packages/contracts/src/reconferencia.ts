import { z } from 'zod';

/**
 * Reconferência após 20 dias sem movimentação (por palete). Base = o mais
 * recente entre o início (entrada do palete no sistema), a última
 * movimentação relevante e a última reconferência COMPLETA válida; a próxima
 * reconferência vence em base + 20 períodos completos de 24 horas (no limite
 * exato já é necessária). Aviso separado de conferência, liberação, avaria,
 * saldo e reserva: vencer não muda nenhum deles. Calculado pela API com o
 * relógio do servidor; instantes em UTC.
 */
export const DIAS_RECONFERENCIA = 20;
const DIA_MS = 24 * 60 * 60 * 1000;

/** CADASTRO = data de entrada do palete no sistema; IMPLANTACAO = data de implantação da regra (entrada desconhecida). */
export const OrigemInicioRelogioSchema = z.enum(['CADASTRO', 'IMPLANTACAO']);
export type OrigemInicioRelogio = z.infer<typeof OrigemInicioRelogioSchema>;

/** Movimentações que reiniciam a contagem (eventos reais persistidos). */
export const TipoMovimentacaoRelevanteSchema = z.enum([
  'MOVIMENTO',
  'CORRECAO_LOCALIZACAO',
  'RETIRADA_VAZIO',
  'TRANSFERENCIA_ENVIADA',
  'TRANSFERENCIA_RECEBIDA',
  'CORRECAO_TRANSFERENCIA',
  'SAIDA_PARCIAL',
  'RETORNO_FISICO',
  'ENTRADA_CONTEUDO',
]);
export type TipoMovimentacaoRelevante = z.infer<typeof TipoMovimentacaoRelevanteSchema>;

export const OrigemReconferenciaSchema = z.enum(['CONFERENCIA_COMPLETA', 'RECONFERENCIA_VOLUMES']);
export type OrigemReconferencia = z.infer<typeof OrigemReconferenciaSchema>;

export const ReconferenciaPaleteSchema = z.object({
  /** Início da contagem e a origem dessa data. */
  startedAt: z.iso.datetime(),
  startOrigin: OrigemInicioRelogioSchema,
  lastMovementAt: z.iso.datetime().nullable(),
  lastMovementType: TipoMovimentacaoRelevanteSchema.nullable(),
  /** Última reconferência COMPLETA válida; `null` = não registrada. */
  lastFullCountAt: z.iso.datetime().nullable(),
  lastFullCountOrigin: OrigemReconferenciaSchema.nullable(),
  lastFullCountBy: z.object({ login: z.string().min(1), name: z.string().min(1) }).nullable().default(null),
  /** Data prevista para a reconferência (base + 20 dias). */
  nextAt: z.iso.datetime(),
  /** Reconferência necessária: horário do servidor ≥ data prevista, ou exigida por decisão ainda não atendida. */
  due: z.boolean(),
  /** Exigida por decisão registrada (ex.: notas de linhas em revisão do inventário); some com a reconferência completa seguinte. */
  required: z.object({ at: z.iso.datetime(), reason: z.string().min(1) }).nullable().default(null),
  /** Dias completos desde a última movimentação ou, sem ela, desde a entrada (não conta a conferência). */
  daysWithoutMovement: z.number().int().nonnegative(),
  /** Dias até a data prevista, arredondando para cima; 0 quando vencida. */
  daysUntilDue: z.number().int().nonnegative(),
});
export type ReconferenciaPalete = z.infer<typeof ReconferenciaPaleteSchema>;

export interface RelogioPalete {
  inicioEm: Date;
  inicioOrigem: OrigemInicioRelogio;
  ultimaMovimentacaoEm: Date | null;
  ultimaMovimentacaoTipo: TipoMovimentacaoRelevante | null;
  ultimaReconferenciaEm: Date | null;
  ultimaReconferenciaOrigem: OrigemReconferencia | null;
  ultimaReconferenciaPor?: { login: string; name: string } | null;
  /** Reconferência exigida por decisão (data e motivo); atendida por reconferência completa posterior. */
  exigidaEm?: Date | null;
  exigidaMotivo?: string | null;
}

const maior = (datas: readonly (Date | null)[]): Date => new Date(Math.max(...datas.flatMap((d) => (d === null ? [] : [d.getTime()]))));

/** Situação do prazo no instante `agora` (horário do servidor). */
export function situacaoReconferencia(r: RelogioPalete, agora: Date): ReconferenciaPalete {
  const movimento = maior([r.inicioEm, r.ultimaMovimentacaoEm]);
  const base = maior([r.inicioEm, r.ultimaMovimentacaoEm, r.ultimaReconferenciaEm]);
  const proxima = new Date(base.getTime() + DIAS_RECONFERENCIA * DIA_MS);
  const restante = proxima.getTime() - agora.getTime();
  const exigida =
    r.exigidaEm !== null && r.exigidaEm !== undefined && (r.ultimaReconferenciaEm === null || r.ultimaReconferenciaEm < r.exigidaEm)
      ? { at: r.exigidaEm.toISOString(), reason: r.exigidaMotivo ?? 'Reconferência exigida.' }
      : null;
  const vencida = restante <= 0 || exigida !== null;
  return {
    startedAt: r.inicioEm.toISOString(),
    startOrigin: r.inicioOrigem,
    lastMovementAt: r.ultimaMovimentacaoEm?.toISOString() ?? null,
    lastMovementType: r.ultimaMovimentacaoTipo,
    lastFullCountAt: r.ultimaReconferenciaEm?.toISOString() ?? null,
    lastFullCountOrigin: r.ultimaReconferenciaOrigem,
    lastFullCountBy: r.ultimaReconferenciaPor ?? null,
    nextAt: proxima.toISOString(),
    due: vencida,
    required: exigida,
    daysWithoutMovement: Math.max(0, Math.floor((agora.getTime() - movimento.getTime()) / DIA_MS)),
    daysUntilDue: vencida ? 0 : Math.ceil(restante / DIA_MS),
  };
}

/** POST /paletes/:id/reconferencias — reconferência completa registrada na conferência de volumes. */
export const RegistrarReconferenciaSchema = z.object({
  /** Quem registra confirma que conferiu o palete inteiro (parcial não renova o prazo). */
  wholePallet: z.literal(true, { error: 'Confirme que o palete inteiro foi conferido.' }),
  result: z.enum(['SEM_DIFERENCA', 'COM_DIFERENCA']),
  notes: z.string().trim().max(500).nullable().default(null),
});
export type RegistrarReconferencia = z.input<typeof RegistrarReconferenciaSchema>;
