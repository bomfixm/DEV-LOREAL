import { PERIODO_MAXIMO_DIAS, type FiltroPeriodo, type PeriodoAplicado } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { requisicaoInvalida } from '../../http/erros.js';
import { fusoDoEscopo } from '../janelas/leitura.js';

type Db = Banco | Transacao;

/** Limites do período em UTC: [início, fim) — Date para as consultas. */
export interface Periodo extends PeriodoAplicado {
  inicio: Date;
  fim: Date;
}

/**
 * Período em datas do fuso da operação (padrão: do primeiro dia do mês atual
 * até hoje). Os limites são convertidos pelo PostgreSQL (`AT TIME ZONE`), que
 * conhece as regras do fuso: início = 00:00 do primeiro dia; fim exclusivo =
 * 00:00 do dia seguinte ao último. Um evento às 23:59:59 do último dia entra;
 * um às 00:00 do dia seguinte, não — nada se perde nem se repete na virada.
 */
export async function resolverPeriodo(db: Db, escopoId: string, filtro: FiltroPeriodo, agora: Date): Promise<Periodo> {
  const fuso = await fusoDoEscopo(db, escopoId);
  const [hojeLinha] = await db.$queryRaw<{ hoje: string; mes: string }[]>`
    SELECT to_char((${agora}::timestamptz AT TIME ZONE ${fuso})::date, 'YYYY-MM-DD') AS hoje,
           to_char(date_trunc('month', (${agora}::timestamptz AT TIME ZONE ${fuso}))::date, 'YYYY-MM-DD') AS mes`;
  const hoje = hojeLinha?.hoje ?? agora.toISOString().slice(0, 10);
  const inicioMes = hojeLinha?.mes ?? `${hoje.slice(0, 7)}-01`;
  let inicio = filtro.inicio ?? (filtro.fim ? `${filtro.fim.slice(0, 7)}-01` : inicioMes);
  let fim = filtro.fim ?? (inicio > hoje ? inicio : hoje);
  if (inicio > fim) [inicio, fim] = [fim, inicio];
  const dias = (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000;
  if (dias >= PERIODO_MAXIMO_DIAS) throw requisicaoInvalida(`Período de no máximo ${String(PERIODO_MAXIMO_DIAS)} dias: informe também a data final.`);
  const [limites] = await db.$queryRaw<{ inicio: Date; fim: Date }[]>`
    SELECT (${inicio}::date::timestamp AT TIME ZONE ${fuso}) AS inicio,
           ((${fim}::date + 1)::timestamp AT TIME ZONE ${fuso}) AS fim`;
  if (!limites) throw new Error('Falha ao calcular o período.');
  return {
    start: inicio,
    end: fim,
    timezone: fuso,
    startUtc: limites.inicio.toISOString(),
    endUtc: limites.fim.toISOString(),
    includesToday: fim >= hoje,
    inicio: limites.inicio,
    fim: limites.fim,
  };
}

/** Período só com os campos do contrato. */
export function periodoAplicado(p: Periodo): PeriodoAplicado {
  return { start: p.start, end: p.end, timezone: p.timezone, startUtc: p.startUtc, endUtc: p.endUtc, includesToday: p.includesToday };
}
