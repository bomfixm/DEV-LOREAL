/**
 * Liberação do material para expedição (etapa 08; R22, R26). Ação autorizada
 * (`material.liberar`) e auditada, por palete × segmento: liberar uma
 * quantidade (critério, fonte e referência), revogar, bloquear e desbloquear
 * a linha, e bloquear/desbloquear o palete inteiro. Conferência e recuperação
 * de claim não liberam. Liberação parcial identifica a quantidade; um palete
 * misto nunca é liberado inteiro por validar uma linha.
 *
 * Ordem de bloqueio: palete → linhas de saldo (igual às movimentações).
 * Reservado ≤ liberado ≤ saldo é conferido também por CHECK.
 */
import {
  compararQuantidades,
  normalizarQuantidade,
  somarQuantidades,
  subtrairQuantidades,
  type Escopo,
  type EventoLiberacao,
  type LiberacaoMaterialSchema,
  type PaleteDetalhe,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { bloquearSaldos, recalcularResumoPaletes } from '../estoque/saldo.js';
import { consultarPalete } from '../praca/consultas.js';
import { exigirVersao, lerPaletes, type Autor } from './comum.js';

type DadosLiberacao = z.output<typeof LiberacaoMaterialSchema>;

const ACAO_AUDITORIA = {
  LIBERAR: 'MATERIAL_LIBERADO',
  REVOGAR: 'MATERIAL_LIBERACAO_REVOGADA',
  BLOQUEAR: 'MATERIAL_BLOQUEADO',
  DESBLOQUEAR: 'MATERIAL_DESBLOQUEADO',
  BLOQUEAR_PALETE: 'PALETE_BLOQUEADO',
  DESBLOQUEAR_PALETE: 'PALETE_DESBLOQUEADO',
} as const;

export async function alterarLiberacao(tx: Transacao, escopo: Escopo, paleteId: string, dados: DadosLiberacao, autor: Autor, agora: Date): Promise<PaleteDetalhe> {
  const palete = (await lerPaletes(tx, escopo.id, [paleteId], true)).get(paleteId);
  if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
  if (palete.arquivado || palete.estado_fluxo === 'EXPEDIDO') {
    throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} não está mais na praça (arquivado ou expedido).`);
  }
  if (palete.conferencia_ativa) {
    throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} está em conferência: a liberação fica bloqueada até a conferência terminar.`);
  }
  exigirVersao(palete.versao, dados.expectedVersion, `O palete ${palete.codigo}`);

  let segmentoId: string | null = null;
  let quantidade: string | null = null;
  let antes: string | null = null;
  let depois: string | null = null;
  let sku: string | null = null;

  if (dados.action === 'BLOQUEAR_PALETE' || dados.action === 'DESBLOQUEAR_PALETE') {
    const bloquear = dados.action === 'BLOQUEAR_PALETE';
    if (bloquear === (palete.bloqueio_motivo !== null)) {
      throw new ErroHttp(409, 'CONFLITO', bloquear ? `O palete ${palete.codigo} já está bloqueado: ${palete.bloqueio_motivo ?? ''}` : `O palete ${palete.codigo} não está bloqueado.`);
    }
    await tx.palete.update({
      where: { id: palete.id },
      data: bloquear
        ? { bloqueioMotivo: dados.reason, bloqueadoEm: agora, bloqueadoPorId: autor.usuarioId, versao: { increment: 1 } }
        : { bloqueioMotivo: null, bloqueadoEm: null, bloqueadoPorId: null, versao: { increment: 1 } },
    });
  } else {
    segmentoId = dados.segmentId;
    await bloquearSaldos(tx, escopo.id, [palete.id]);
    const linha = await tx.saldoEstoque.findUnique({
      where: { paleteId_segmentoId: { paleteId: palete.id, segmentoId } },
      select: { quantidade: true, quantidadeReservada: true, quantidadeLiberada: true, bloqueioMotivo: true, segmento: { select: { produto: { select: { sku: true } }, unidade: true, lote: true } } },
    });
    if (!linha) throw naoEncontrado(`O palete ${palete.codigo} não tem saldo validado deste material.`);
    sku = linha.segmento.produto.sku;
    const unidade = linha.segmento.unidade;
    const saldo = linha.quantidade.toFixed();
    const reservada = linha.quantidadeReservada.toFixed();
    antes = normalizarQuantidade(linha.quantidadeLiberada.toFixed());
    if (dados.action === 'LIBERAR' || dados.action === 'REVOGAR') {
      quantidade = normalizarQuantidade(dados.quantity);
      if (compararQuantidades(quantidade, '0') <= 0) throw new ErroHttp(400, 'REQUISICAO_INVALIDA', 'Informe uma quantidade maior que zero.');
      if (dados.action === 'LIBERAR') {
        if (palete.estado_conferencia !== 'RECONCILIADO') {
          throw new ErroHttp(409, 'MATERIAL_INELEGIVEL', `O palete ${palete.codigo} não está reconciliado: só material com conteúdo integral validado é liberado.`);
        }
        if (palete.bloqueio_motivo !== null || linha.bloqueioMotivo !== null) {
          throw new ErroHttp(409, 'MATERIAL_INELEGIVEL', `Material bloqueado (${linha.bloqueioMotivo ?? palete.bloqueio_motivo ?? ''}): trate e desbloqueie antes de liberar.`);
        }
        depois = somarQuantidades([antes, quantidade]);
        if (compararQuantidades(depois, saldo) > 0) {
          throw new ErroHttp(
            409,
            'SALDO_INSUFICIENTE',
            `Liberação acima do saldo validado de ${sku}: saldo ${normalizarQuantidade(saldo)} ${unidade}, já liberado ${antes}, não liberado ${subtrairQuantidades(saldo, antes)}.`,
          );
        }
      } else {
        depois = subtrairQuantidades(antes, quantidade);
        if (compararQuantidades(depois, reservada) < 0) {
          throw new ErroHttp(
            409,
            'CONFLITO',
            `A revogação deixaria a liberação (${compararQuantidades(depois, '0') < 0 ? '0' : normalizarQuantidade(depois)}) abaixo dos ${normalizarQuantidade(reservada)} ${unidade} reservados: cancele ou libere a reserva antes.`,
          );
        }
      }
      await tx.saldoEstoque.update({
        where: { paleteId_segmentoId: { paleteId: palete.id, segmentoId } },
        data: { quantidadeLiberada: depois },
      });
    } else {
      const bloquear = dados.action === 'BLOQUEAR';
      if (bloquear === (linha.bloqueioMotivo !== null)) {
        throw new ErroHttp(409, 'CONFLITO', bloquear ? `Este material já está bloqueado: ${linha.bloqueioMotivo ?? ''}` : 'Este material não está bloqueado.');
      }
      await tx.saldoEstoque.update({
        where: { paleteId_segmentoId: { paleteId: palete.id, segmentoId } },
        data: bloquear ? { bloqueioMotivo: dados.reason, bloqueadoEm: agora, bloqueadoPorId: autor.usuarioId } : { bloqueioMotivo: null, bloqueadoEm: null, bloqueadoPorId: null },
      });
      depois = antes;
    }
    await tx.palete.update({ where: { id: palete.id }, data: { versao: { increment: 1 } } });
  }

  await tx.eventoLiberacao.create({
    data: {
      id: randomUUID(),
      escopoId: escopo.id,
      paleteId: palete.id,
      segmentoId,
      tipo: dados.action,
      quantidade,
      liberadaAnterior: antes,
      liberadaPosterior: depois,
      criterio: dados.action === 'LIBERAR' ? dados.criterion : null,
      fonte: dados.action === 'LIBERAR' ? dados.source : null,
      referencia: dados.action === 'LIBERAR' ? dados.reference : null,
      motivo: dados.reason,
      autorId: autor.usuarioId,
      ocorridoEm: agora,
    },
  });
  await recalcularResumoPaletes(tx, escopo.id, [palete.id]);
  await registrarEvento(tx, {
    acao: ACAO_AUDITORIA[dados.action],
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: palete.id,
    detalhes: { codigo: palete.codigo, segmento: segmentoId, sku, quantidade, antes, depois, motivo: dados.reason, fonte: dados.action === 'LIBERAR' ? dados.source : null },
    requestId: autor.requestId,
  });
  const detalhe = await consultarPalete(tx, escopo, palete.id);
  if (!detalhe) throw naoEncontrado('Palete não encontrado neste escopo.');
  return detalhe;
}

/** Histórico de liberação do palete (mais recente primeiro). */
export async function historicoLiberacao(db: Banco, escopoId: string, paleteId: string): Promise<EventoLiberacao[]> {
  const palete = await db.palete.findFirst({ where: { id: paleteId, escopoId }, select: { id: true } });
  if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
  const eventos = await db.eventoLiberacao.findMany({
    where: { escopoId, paleteId },
    orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      tipo: true,
      segmentoId: true,
      quantidade: true,
      liberadaAnterior: true,
      liberadaPosterior: true,
      criterio: true,
      fonte: true,
      referencia: true,
      motivo: true,
      ocorridoEm: true,
      autor: { select: { login: true, nome: true } },
      segmento: { select: { lote: true, produto: { select: { sku: true } } } },
    },
  });
  return eventos.map((e) => ({
    id: e.id,
    type: e.tipo as EventoLiberacao['type'],
    segmentId: e.segmentoId,
    sku: e.segmento?.produto.sku ?? null,
    lot: e.segmento?.lote ?? null,
    quantity: e.quantidade === null ? null : normalizarQuantidade(e.quantidade.toFixed()),
    releasedBefore: e.liberadaAnterior === null ? null : normalizarQuantidade(e.liberadaAnterior.toFixed()),
    releasedAfter: e.liberadaPosterior === null ? null : normalizarQuantidade(e.liberadaPosterior.toFixed()),
    criterion: e.criterio,
    source: e.fonte,
    reference: e.referencia,
    reason: e.motivo,
    by: e.autor ? { login: e.autor.login, name: e.autor.nome } : null,
    at: e.ocorridoEm.toISOString(),
  }));
}
