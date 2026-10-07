import type { TipoEventoClaim } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Transacao } from '../../db/cliente.js';

/** Valores simples nos detalhes do histórico (nunca conteúdo de anexo ou dados de sessão). */
export type DetalhesEventoClaim = Record<string, string | number | boolean | null>;

export interface NovoEventoClaim {
  escopoId: string;
  claimId: string;
  linhaId?: string | null;
  tipo: TipoEventoClaim;
  autorId: string | null;
  agora: Date;
  resumo: string;
  /** Registro original quando o evento corrige, estorna, reabre ou move algo. */
  relacionadoId?: string | null;
  detalhes?: DetalhesEventoClaim;
}

/** Histórico de domínio do caso (imutável no banco). */
export async function registrarEventoClaim(tx: Transacao, e: NovoEventoClaim): Promise<string> {
  const id = randomUUID();
  await tx.eventoClaim.create({
    data: {
      id,
      escopoId: e.escopoId,
      claimId: e.claimId,
      linhaId: e.linhaId ?? null,
      tipo: e.tipo,
      autorId: e.autorId,
      ocorridoEm: e.agora,
      resumo: e.resumo,
      relacionadoId: e.relacionadoId ?? null,
      detalhes: (e.detalhes ?? {}),
    },
  });
  return id;
}
