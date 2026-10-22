/**
 * "Palete livre" (ajustes de 08/10/2026): quem está no local confirma que uma
 * posição sem palete está fisicamente vazia, para orientar onde guardar os
 * próximos paletes. A falta de palete registrado não basta (pode haver palete
 * sem endereço informado). Movimento, saída e retirada registrados marcam a
 * origem como livre por gatilho; qualquer palete que ocupe a posição limpa a
 * marcação (migração `20261012090000_posicao_livre`). Histórico na auditoria.
 */
import type { ConfirmarPosicaoLivreSchema, Escopo, ResultadoPosicaoLivre } from '@praca-reversa/contracts';
import type { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import type { Autor } from './servico.js';

type Dados = z.output<typeof ConfirmarPosicaoLivreSchema>;

export async function confirmarPosicaoLivre(tx: Transacao, escopo: Escopo, posicaoId: string, dados: Dados, autor: Autor, agora: Date): Promise<ResultadoPosicaoLivre> {
  const [p] = await tx.$queryRaw<
    { id: string; codigo: string; disponivel: boolean; desativada: boolean; retirada: boolean; ativo: boolean; endereco: string | null; ocupante: string | null; livre_em: Date | null; livre_origem: string | null }[]
  >`
    SELECT pos.id::text, pos.codigo, pos.disponivel, pos.desativada, pos.retirada_em IS NOT NULL AS retirada, l.ativo,
           CASE WHEN e.situacao = 'CONFIRMADO' THEN e.endereco END AS endereco,
           (SELECT pa.codigo FROM palete pa WHERE pa.posicao_id = pos.id) AS ocupante,
           pos.livre_confirmada_em AS livre_em, pos.livre_origem
      FROM posicao pos
      JOIN layout l ON l.id = pos.layout_id
      LEFT JOIN endereco_posicao e ON e.posicao_id = pos.id
     WHERE pos.id = ${posicaoId}::uuid AND pos.escopo_id = ${escopo.id}::uuid
       FOR UPDATE OF pos`;
  if (!p || !p.ativo || p.retirada) throw naoEncontrado('Posição não encontrada no layout ativo deste escopo.');
  if (p.desativada) throw new ErroHttp(409, 'CONFLITO', `A posição ${p.codigo} está desativada: não entra nas posições livres.`);
  if (!p.disponivel) throw new ErroHttp(409, 'CONFLITO', `A posição ${p.codigo} está indisponível: não recebe paletes.`);
  if (p.ocupante !== null) {
    throw new ErroHttp(409, 'CONFLITO', `A posição ${p.codigo} tem o palete ${p.ocupante} registrado: mova ou retire o palete antes (a desocupação vem do movimento).`);
  }
  if (p.livre_em !== null && p.livre_origem !== null) {
    return { positionId: p.id, code: p.codigo, freeConfirmed: { at: p.livre_em.toISOString(), origin: p.livre_origem as ResultadoPosicaoLivre['freeConfirmed']['origin'] } };
  }
  await tx.posicao.update({ where: { id: p.id }, data: { livreConfirmadaEm: agora, livreConfirmadaPorId: autor.usuarioId, livreOrigem: 'CONFIRMACAO' } });
  await registrarEvento(tx, {
    acao: 'POSICAO_LIVRE_CONFIRMADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'POSICAO',
    alvoId: p.id,
    detalhes: { posicao: p.codigo, endereco: p.endereco, observacao: dados.note },
    requestId: autor.requestId,
  });
  return { positionId: p.id, code: p.codigo, freeConfirmed: { at: agora.toISOString(), origin: 'CONFIRMACAO' } };
}
