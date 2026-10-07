/**
 * Vínculos de material das recuperações de claim (etapa 07; R17).
 *
 * A quantidade de um segmento (identidade rastreável do material: produto,
 * lote, origem, condição e linhagem) num palete usada como prova de uma
 * recuperação validada fica vinculada: saldo_estoque.quantidade_vinculada é a
 * soma dos vínculos daquele palete × segmento (conferida no COMMIT por
 * gatilho adiado). Vínculo não é reserva nem baixa: o material continua em
 * estoque. Reservado + vinculado ≤ saldo (CHECK), então a mesma quantidade
 * física não sustenta duas recuperações.
 *
 * Transferência e correção de transferência preservam o segmento; quando a
 * quantidade movida passa da parte livre (saldo − reservado − vinculado), o
 * vínculo acompanha o material até o palete de destino, com evento no
 * histórico do caso. Nenhuma cota nova surge no destino: lá a mesma
 * quantidade chega já vinculada.
 */
import { compararQuantidades, normalizarQuantidade, somarQuantidades, subtrairQuantidades } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Transacao } from '../../db/cliente.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { registrarEventoClaim } from './historico.js';

export interface ParteMovida {
  recuperacaoId: string;
  claimId: string;
  claimCodigo: string;
  linhaId: string;
  quantidade: string;
}

/** Quantidade vinculada que precisa acompanhar a transferência (a parte livre sai primeiro). */
export function vinculadaAMover(saldo: string, reservado: string, vinculado: string, quantidade: string): string {
  const livre = subtrairQuantidades(subtrairQuantidades(saldo, reservado), vinculado);
  const falta = subtrairQuantidades(quantidade, compararQuantidades(livre, '0') > 0 ? livre : '0');
  return compararQuantidades(falta, '0') > 0 ? normalizarQuantidade(falta) : '0';
}

/**
 * Retira `quantidade` dos vínculos do palete × segmento (recuperações mais
 * antigas primeiro) e baixa a quantidade vinculada do saldo. Linhas de saldo
 * já bloqueadas por quem chama.
 */
export async function retirarVinculos(tx: Transacao, escopoId: string, paleteId: string, segmentoId: string, quantidade: string, agora: Date): Promise<ParteMovida[]> {
  const vinculos = await tx.$queryRaw<{ id: string; recuperacao_id: string; quantidade: string; claim_id: string; linha_id: string; codigo: string }[]>`
    SELECT v.id::text, v.recuperacao_id::text, v.quantidade::text, r.claim_id::text, r.linha_id::text, c.codigo
      FROM vinculo_material_claim v
      JOIN recuperacao_claim r ON r.id = v.recuperacao_id
      JOIN claim c ON c.id = r.claim_id
     WHERE v.escopo_id = ${escopoId}::uuid AND v.palete_id = ${paleteId}::uuid AND v.segmento_id = ${segmentoId}::uuid
     ORDER BY r.validada_em, r.id
       FOR UPDATE OF v`;
  const partes: ParteMovida[] = [];
  let restante = normalizarQuantidade(quantidade);
  for (const v of vinculos) {
    if (compararQuantidades(restante, '0') <= 0) break;
    const disponivel = normalizarQuantidade(v.quantidade);
    const parte = compararQuantidades(disponivel, restante) <= 0 ? disponivel : restante;
    if (compararQuantidades(parte, disponivel) === 0) {
      await tx.vinculoMaterialClaim.delete({ where: { id: v.id } });
    } else {
      await tx.vinculoMaterialClaim.update({ where: { id: v.id }, data: { quantidade: subtrairQuantidades(disponivel, parte), atualizadoEm: agora } });
    }
    partes.push({ recuperacaoId: v.recuperacao_id, claimId: v.claim_id, claimCodigo: v.codigo, linhaId: v.linha_id, quantidade: parte });
    restante = subtrairQuantidades(restante, parte);
  }
  if (compararQuantidades(restante, '0') !== 0) throw new Error('Vínculos de claim insuficientes para a quantidade vinculada do saldo.');
  const total = somarQuantidades(partes.map((p) => p.quantidade));
  await tx.$executeRaw`
    UPDATE saldo_estoque SET quantidade_vinculada = quantidade_vinculada - ${total}::numeric
     WHERE escopo_id = ${escopoId}::uuid AND palete_id = ${paleteId}::uuid AND segmento_id = ${segmentoId}::uuid`;
  return partes;
}

/** Deposita as partes no palete de destino (linha de saldo já existente e bloqueada). */
export async function depositarVinculos(tx: Transacao, escopoId: string, paleteId: string, segmentoId: string, partes: readonly ParteMovida[], agora: Date): Promise<void> {
  for (const p of partes) {
    await tx.$executeRaw`
      INSERT INTO vinculo_material_claim (id, escopo_id, recuperacao_id, palete_id, segmento_id, quantidade, atualizado_em)
      VALUES (${randomUUID()}::uuid, ${escopoId}::uuid, ${p.recuperacaoId}::uuid, ${paleteId}::uuid, ${segmentoId}::uuid, ${p.quantidade}::numeric, ${agora})
      ON CONFLICT (recuperacao_id, palete_id) DO UPDATE
        SET quantidade = vinculo_material_claim.quantidade + EXCLUDED.quantidade, atualizado_em = EXCLUDED.atualizado_em`;
  }
  const total = somarQuantidades(partes.map((p) => p.quantidade));
  const n = await tx.$executeRaw`
    UPDATE saldo_estoque SET quantidade_vinculada = quantidade_vinculada + ${total}::numeric
     WHERE escopo_id = ${escopoId}::uuid AND palete_id = ${paleteId}::uuid AND segmento_id = ${segmentoId}::uuid`;
  if (n !== 1) throw new Error('Saldo de destino ausente ao depositar vínculos de claim.');
}

/** Histórico do caso e auditoria: o vínculo acompanhou o material (evento de estoque de origem). */
export async function registrarMovimentoVinculos(
  tx: Transacao,
  escopoId: string,
  partes: readonly ParteMovida[],
  de: { id: string; codigo: string },
  para: { id: string; codigo: string },
  unidade: string,
  eventoEstoqueId: string,
  autor: { usuarioId: string; requestId: string },
  agora: Date,
): Promise<string[]> {
  const notas: string[] = [];
  for (const p of partes) {
    await registrarEventoClaim(tx, {
      escopoId,
      claimId: p.claimId,
      linhaId: p.linhaId,
      tipo: 'VINCULO_MOVIDO',
      autorId: autor.usuarioId,
      agora,
      resumo: `${p.quantidade} ${unidade} vinculados à recuperação acompanharam a movimentação do palete ${de.codigo} para o ${para.codigo} (mesmo material).`,
      relacionadoId: p.recuperacaoId,
      detalhes: { eventoEstoque: eventoEstoqueId, origem: de.codigo, destino: para.codigo, quantidade: p.quantidade, unidade },
    });
    notas.push(`${p.quantidade} ${unidade} vinculados à recuperação do claim ${p.claimCodigo} acompanharam o material para o palete ${para.codigo} (vínculo preservado; nenhuma cota nova).`);
  }
  for (const claimId of new Set(partes.map((p) => p.claimId))) {
    await registrarEvento(tx, {
      acao: 'CLAIM_VINCULO_MOVIDO',
      resultado: 'SUCESSO',
      atorUsuarioId: autor.usuarioId,
      escopoId,
      alvoTipo: 'CLAIM',
      alvoId: claimId,
      detalhes: { eventoEstoque: eventoEstoqueId, origem: de.codigo, destino: para.codigo },
      requestId: autor.requestId,
    });
  }
  return notas;
}
