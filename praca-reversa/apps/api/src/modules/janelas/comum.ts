/**
 * Apoio do módulo de janelas (etapa 08): bloqueios em ordem fixa, numeração,
 * responsáveis e histórico de domínio.
 *
 * Ordem de bloqueio de todas as operações de janela (evita impasse com as
 * etapas 05 e 07, que começam pelos paletes ou pelo claim e nunca bloqueiam
 * janela depois):
 *   janela → reserva(s) em ordem de ID → paletes em ordem de ID → linhas de
 *   saldo (estoque/saldo.ts) → expedição (retorno) → palete de destino.
 */
import { PERMISSOES_POR_PERFIL, type Perfil, type SituacaoJanela, type SituacaoReserva, type TipoEventoJanela } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';

export interface Autor {
  usuarioId: string;
  requestId: string;
}

export interface JanelaTravada {
  id: string;
  codigo: string;
  nome: string;
  situacao: SituacaoJanela;
  versao: number;
  versao_regras: number;
}

/** Bloqueia a janela (FOR UPDATE): serializa capacidade, situação e regras dela. */
export async function bloquearJanela(tx: Transacao, escopoId: string, id: string): Promise<JanelaTravada> {
  const [j] = await tx.$queryRaw<JanelaTravada[]>`
    SELECT id::text, codigo, nome, situacao::text AS situacao, versao, versao_regras
      FROM janela_devolucao WHERE id = ${id}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!j) throw naoEncontrado('Janela não encontrada neste escopo.');
  return j;
}

export interface ReservaTravada {
  id: string;
  codigo: string;
  janela_id: string;
  situacao: SituacaoReserva;
  versao: number;
}

/** Janela da reserva (sem bloqueio), para começar pela janela na ordem fixa. */
export async function janelaDaReserva(db: Banco | Transacao, escopoId: string, reservaId: string): Promise<string> {
  const r = await db.reservaJanela.findFirst({ where: { id: reservaId, escopoId }, select: { janelaId: true } });
  if (!r) throw naoEncontrado('Reserva não encontrada neste escopo.');
  return r.janelaId;
}

export async function bloquearReserva(tx: Transacao, escopoId: string, id: string): Promise<ReservaTravada> {
  const [r] = await tx.$queryRaw<ReservaTravada[]>`
    SELECT id::text, codigo, janela_id::text, situacao::text AS situacao, versao
      FROM reserva_janela WHERE id = ${id}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!r) throw naoEncontrado('Reserva não encontrada neste escopo.');
  return r;
}

export interface PaleteDaCarga {
  id: string;
  codigo: string;
  versao: number;
  arquivado: boolean;
  estado_fluxo: 'EM_ESTOQUE' | 'RESERVADO' | 'EXPEDIDO' | 'VAZIO_ARQUIVADO';
  estado_conferencia: 'NAO_CONFERIDO' | 'PARCIAL' | 'AGUARDANDO_VALIDACAO' | 'RECONCILIADO';
  bloqueio_motivo: string | null;
  posicao_id: string | null;
  posicao_codigo: string | null;
  conferencia_ativa: boolean;
}

/** Paletes em ordem de ID; `travar` = FOR UPDATE (mesma ordem das movimentações). */
export async function lerPaletes(tx: Transacao | Banco, escopoId: string, ids: readonly string[], travar: boolean): Promise<Map<string, PaleteDaCarga>> {
  const ordenados = [...new Set(ids)].sort();
  if (ordenados.length === 0) return new Map();
  const linhas = travar
    ? await tx.$queryRaw<PaleteDaCarga[]>`
        SELECT p.id::text, p.codigo, p.versao, p.arquivado_em IS NOT NULL AS arquivado, p.estado_fluxo::text AS estado_fluxo,
               p.estado_conferencia::text AS estado_conferencia, p.bloqueio_motivo, p.posicao_id::text,
               (SELECT s.codigo FROM posicao s WHERE s.id = p.posicao_id) AS posicao_codigo,
               EXISTS (SELECT 1 FROM sessao_conferencia c WHERE c.palete_id = p.id AND c.ativa) AS conferencia_ativa
          FROM palete p WHERE p.escopo_id = ${escopoId}::uuid AND p.id = ANY(${ordenados}::uuid[])
         ORDER BY p.id FOR UPDATE OF p`
    : await tx.$queryRaw<PaleteDaCarga[]>`
        SELECT p.id::text, p.codigo, p.versao, p.arquivado_em IS NOT NULL AS arquivado, p.estado_fluxo::text AS estado_fluxo,
               p.estado_conferencia::text AS estado_conferencia, p.bloqueio_motivo, p.posicao_id::text,
               (SELECT s.codigo FROM posicao s WHERE s.id = p.posicao_id) AS posicao_codigo,
               EXISTS (SELECT 1 FROM sessao_conferencia c WHERE c.palete_id = p.id AND c.ativa) AS conferencia_ativa
          FROM palete p WHERE p.escopo_id = ${escopoId}::uuid AND p.id = ANY(${ordenados}::uuid[])
         ORDER BY p.id`;
  return new Map(linhas.map((l) => [l.id, l]));
}

type TabelaNumerada = 'janela_devolucao' | 'reserva_janela' | 'expedicao' | 'retorno_expedicao';

/** Próximo número do escopo (bloqueio consultivo por tabela e escopo até o fim da transação). */
export async function proximoNumero(tx: Transacao, escopoId: string, tabela: TabelaNumerada): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tabela}:${escopoId}`}, 0))`;
  const [linha] =
    tabela === 'janela_devolucao'
      ? await tx.$queryRaw<{ n: number }[]>`SELECT coalesce(max(numero), 0)::int + 1 AS n FROM janela_devolucao WHERE escopo_id = ${escopoId}::uuid`
      : tabela === 'reserva_janela'
        ? await tx.$queryRaw<{ n: number }[]>`SELECT coalesce(max(numero), 0)::int + 1 AS n FROM reserva_janela WHERE escopo_id = ${escopoId}::uuid`
        : tabela === 'expedicao'
          ? await tx.$queryRaw<{ n: number }[]>`SELECT coalesce(max(numero), 0)::int + 1 AS n FROM expedicao WHERE escopo_id = ${escopoId}::uuid`
          : await tx.$queryRaw<{ n: number }[]>`SELECT coalesce(max(numero), 0)::int + 1 AS n FROM retorno_expedicao WHERE escopo_id = ${escopoId}::uuid`;
  return linha?.n ?? 1;
}

export const codigoNumerado = (prefixo: 'JAN' | 'RES' | 'EXP' | 'RET', numero: number) => `${prefixo}-${String(numero).padStart(6, '0')}`;

/** Perfis que podem ser responsáveis pela preparação/saída (os que preparam a carga). */
export const PERFIS_RESPONSAVEIS_EXPEDICAO: readonly Perfil[] = (Object.keys(PERMISSOES_POR_PERFIL) as Perfil[]).filter((p) =>
  PERMISSOES_POR_PERFIL[p].includes('expedicao.preparar'),
);

/** Responsável: usuário ativo deste escopo com perfil que prepara carga (a referência não amplia escopo). */
export async function exigirResponsavel(tx: Transacao, escopoId: string, usuarioId: string): Promise<{ login: string; nome: string }> {
  const vinculo = await tx.vinculo.findFirst({
    where: { escopoId, usuarioId, ativo: true, perfil: { in: [...PERFIS_RESPONSAVEIS_EXPEDICAO] }, usuario: { ativo: true } },
    select: { usuario: { select: { login: true, nome: true } } },
  });
  if (!vinculo) throw requisicaoInvalida('O responsável precisa ser um usuário ativo deste escopo com acesso à preparação/expedição.');
  return vinculo.usuario;
}

export async function responsaveisExpedicao(db: Banco, escopoId: string) {
  const vinculos = await db.vinculo.findMany({
    where: { escopoId, ativo: true, perfil: { in: [...PERFIS_RESPONSAVEIS_EXPEDICAO] }, usuario: { ativo: true } },
    include: { usuario: { select: { id: true, login: true, nome: true } } },
    orderBy: { usuario: { login: 'asc' } },
  });
  return vinculos.map((v) => ({ id: v.usuario.id, login: v.usuario.login, name: v.usuario.nome }));
}

/** Histórico de domínio da janela (imutável). */
export async function registrarEventoJanela(
  tx: Transacao,
  e: {
    escopoId: string;
    janelaId: string;
    tipo: TipoEventoJanela;
    autorId: string;
    agora: Date;
    resumo: string;
    reservaId?: string | null;
    expedicaoId?: string | null;
    retornoId?: string | null;
    detalhes?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.eventoJanela.create({
    data: {
      id: randomUUID(),
      escopoId: e.escopoId,
      janelaId: e.janelaId,
      reservaId: e.reservaId ?? null,
      expedicaoId: e.expedicaoId ?? null,
      retornoId: e.retornoId ?? null,
      tipo: e.tipo,
      autorId: e.autorId,
      ocorridoEm: e.agora,
      resumo: e.resumo.slice(0, 500),
      detalhes: e.detalhes ?? {},
    },
  });
}

export function exigirVersao(atual: number, esperada: number, oque: string): void {
  if (atual !== esperada) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `${oque} foi alterado(a) desde a sua revisão. Os dados atuais foram recarregados: revise antes de confirmar.`);
  }
}
