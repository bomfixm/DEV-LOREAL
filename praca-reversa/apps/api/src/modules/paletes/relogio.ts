/**
 * Relógio da reconferência após 20 dias sem movimentação (por palete). Os
 * campos do palete só mudam na mesma transação de um evento real persistido:
 * operação revertida não grava, e a repetição idempotente devolve a resposta
 * guardada sem executar de novo. Consulta, renomeação, reenvio de inventário,
 * posição registrada pela carga, reserva, conferência parcial, rascunho ou
 * cancelamento não chamam estas funções.
 */
import {
  situacaoReconferencia,
  type OrigemInicioRelogio,
  type OrigemReconferencia,
  type ReconferenciaPalete,
  type TipoMovimentacaoRelevante,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';

type Db = Banco | Transacao;

/** Movimentação relevante: reinicia a contagem dos paletes afetados (origem e destino numa transferência). */
export async function registrarMovimentacaoRelevante(tx: Transacao, escopoId: string, paleteIds: readonly string[], tipo: TipoMovimentacaoRelevante, agora: Date): Promise<void> {
  const ids = [...new Set(paleteIds)];
  if (ids.length === 0) return;
  // Nunca volta no tempo (evento com data anterior à já registrada não reduz a última movimentação).
  await tx.$executeRaw`
    UPDATE palete SET ultima_movimentacao_em = ${agora}, ultima_movimentacao_tipo = ${tipo}
     WHERE escopo_id = ${escopoId}::uuid AND id = ANY(${ids}::uuid[])
       AND (ultima_movimentacao_em IS NULL OR ultima_movimentacao_em <= ${agora})`;
}

/** Reconferência completa (conferência completa concluída ou registrada na conferência de volumes): reinicia o prazo. */
export async function registrarReconferenciaCompleta(tx: Transacao, escopoId: string, paleteId: string, origem: OrigemReconferencia, autorId: string | null, agora: Date): Promise<void> {
  await tx.$executeRaw`
    UPDATE palete SET ultima_reconferencia_em = ${agora}, ultima_reconferencia_origem = ${origem}, ultima_reconferencia_por_id = ${autorId}::uuid
     WHERE escopo_id = ${escopoId}::uuid AND id = ${paleteId}::uuid
       AND (ultima_reconferencia_em IS NULL OR ultima_reconferencia_em <= ${agora})`;
}

/** Campos do relógio para `select` do Prisma. */
export const CAMPOS_RELOGIO = {
  relogioInicioEm: true,
  relogioInicioOrigem: true,
  ultimaMovimentacaoEm: true,
  ultimaMovimentacaoTipo: true,
  ultimaReconferenciaEm: true,
  ultimaReconferenciaOrigem: true,
  reconferenciaExigidaEm: true,
  reconferenciaExigidaMotivo: true,
  arquivadoEm: true,
  estadoFluxo: true,
} as const;

export interface CamposRelogio {
  relogioInicioEm: Date;
  relogioInicioOrigem: string;
  ultimaMovimentacaoEm: Date | null;
  ultimaMovimentacaoTipo: string | null;
  ultimaReconferenciaEm: Date | null;
  ultimaReconferenciaOrigem: string | null;
  reconferenciaExigidaEm?: Date | null;
  reconferenciaExigidaMotivo?: string | null;
  arquivadoEm: Date | null;
  estadoFluxo: string;
  ultimaReconferenciaPor?: { login: string; nome: string } | null;
}

/** Situação do prazo; `null` para palete expedido ou arquivado (o aviso não se aplica). */
export function reconferenciaDe(p: CamposRelogio, agora: Date): ReconferenciaPalete | null {
  if (p.arquivadoEm !== null || p.estadoFluxo === 'EXPEDIDO' || p.estadoFluxo === 'VAZIO_ARQUIVADO') return null;
  return situacaoReconferencia(
    {
      inicioEm: p.relogioInicioEm,
      inicioOrigem: p.relogioInicioOrigem as OrigemInicioRelogio,
      ultimaMovimentacaoEm: p.ultimaMovimentacaoEm,
      ultimaMovimentacaoTipo: p.ultimaMovimentacaoTipo as TipoMovimentacaoRelevante | null,
      ultimaReconferenciaEm: p.ultimaReconferenciaEm,
      ultimaReconferenciaOrigem: p.ultimaReconferenciaOrigem as OrigemReconferencia | null,
      ultimaReconferenciaPor: p.ultimaReconferenciaPor ? { login: p.ultimaReconferenciaPor.login, name: p.ultimaReconferenciaPor.nome } : null,
      exigidaEm: p.reconferenciaExigidaEm ?? null,
      exigidaMotivo: p.reconferenciaExigidaMotivo ?? null,
    },
    agora,
  );
}

/** Lê o relógio de um palete (detalhe) com quem fez a última reconferência. */
export async function relogioDoPalete(db: Db, escopoId: string, paleteId: string, agora: Date): Promise<ReconferenciaPalete | null> {
  const p = await db.palete.findFirst({
    where: { id: paleteId, escopoId },
    select: { ...CAMPOS_RELOGIO, ultimaReconferenciaPor: { select: { login: true, nome: true } } },
  });
  return p ? reconferenciaDe(p, agora) : null;
}
