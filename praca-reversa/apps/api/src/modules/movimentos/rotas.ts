import {
  API_PREFIXO,
  ConfirmarPosicaoLivreSchema,
  CorrigirLocalizacaoSchema,
  CorrigirTransferenciaSchema,
  MoverPaleteSchema,
  RetirarPaleteVazioSchema,
  TransferirSchema,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { naoEncontrado } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { executarIdempotente, type Resposta } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { historicoPalete } from './historico.js';
import { confirmarPosicaoLivre } from './posicao-livre.js';
import { corrigirMovimento, corrigirTransferencia, moverPalete, retirarPaleteVazio, transferir, type Autor } from './servico.js';

const IdSchema = z.object({ id: z.uuid() });

/** Concorrência real entre movimentações: espera maior pelos bloqueios dos paletes. */
const LIMITES_MOVIMENTO = { maxWait: 10_000, timeout: 20_000 };

/**
 * Movimentações. Mover e transferir com `movimento.registrar`; corrigir com
 * `movimento.corrigir`; histórico com `palete.consultar`. Tudo restrito ao
 * escopo ativo (palete, posição ou evento de outro escopo: inexistente). A
 * permissão é conferida antes de devolver um resultado guardado pela
 * idempotência. Nada é confirmado sem resposta do servidor.
 */
export function registrarRotasMovimentos(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  async function mutar(request: FastifyRequest, operacao: string, payload: unknown, executar: (tx: Transacao, autor: Autor) => Promise<Resposta>) {
    const escopo = escopoAtivoDe(request);
    const autor: Autor = { usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id };
    const chave = chaveIdempotencia(request);
    return executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao, chave, payload },
      (tx) => executar(tx, autor),
      LIMITES_MOVIMENTO,
    );
  }

  app.post(`${API_PREFIXO}/paletes/:id/movimentos`, { preHandler: auth.exigirPermissao('movimento.registrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(MoverPaleteSchema, request.body, 'Dados da movimentação inválidos.');
    const resultado = await mutar(request, 'movimento.mover', { id, corpo: request.body }, async (tx, autor) => ({
      status: 200,
      corpo: await moverPalete(tx, escopo, id, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  // Etapa 10: palete vazio sai da posição (consolidação) sem baixa de estoque.
  app.post(`${API_PREFIXO}/paletes/:id/retirada-vazio`, { preHandler: auth.exigirPermissao('movimento.registrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(RetirarPaleteVazioSchema, request.body, 'Dados da retirada inválidos.');
    const resultado = await mutar(request, 'movimento.retirar_vazio', { id, corpo: request.body }, async (tx, autor) => ({
      status: 200,
      corpo: await retirarPaleteVazio(tx, escopo, id, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  // Ajustes 08/10: posição com desocupação conferida no local vira "palete livre" (histórico na auditoria).
  app.post(`${API_PREFIXO}/posicoes/:id/livre`, { preHandler: auth.exigirPermissao('movimento.registrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de posição inválido.');
    const dados = validar(ConfirmarPosicaoLivreSchema, request.body, 'Confirme que a posição foi conferida vazia no local.');
    const resultado = await mutar(request, 'posicao.livre', { id, corpo: request.body }, async (tx, autor) => ({
      status: 200,
      corpo: await confirmarPosicaoLivre(tx, escopo, id, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/movimentos/:id/correcao`, { preHandler: auth.exigirPermissao('movimento.corrigir') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de movimento inválido.');
    const dados = validar(CorrigirLocalizacaoSchema, request.body, 'Dados da correção inválidos.');
    const resultado = await mutar(request, 'movimento.corrigir_localizacao', { id, corpo: request.body }, async (tx, autor) => ({
      status: 200,
      corpo: await corrigirMovimento(tx, escopo, id, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/transferencias`, { preHandler: auth.exigirPermissao('movimento.registrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const dados = validar(TransferirSchema, request.body, 'Dados da transferência inválidos.');
    const resultado = await mutar(request, 'movimento.transferir', { corpo: request.body }, async (tx, autor) => ({
      status: 200,
      corpo: await transferir(tx, escopo, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/transferencias/:id/correcao`, { preHandler: auth.exigirPermissao('movimento.corrigir') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de transferência inválido.');
    const dados = validar(CorrigirTransferenciaSchema, request.body, 'Dados da correção inválidos.');
    const resultado = await mutar(request, 'movimento.corrigir_transferencia', { id, corpo: request.body }, async (tx, autor) => ({
      status: 200,
      corpo: await corrigirTransferencia(tx, escopo, id, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.get(`${API_PREFIXO}/paletes/:id/historico`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de palete inválido.');
    const historico = await historicoPalete(deps.db, escopo, id);
    if (historico) return historico;
    const outro = await deps.db.palete.findUnique({ where: { id }, select: { escopoId: true } });
    if (outro) {
      await registrarEvento(deps.db, {
        acao: 'ACESSO_NEGADO',
        resultado: 'NEGADO',
        atorUsuarioId: contextoDe(request).sessao.usuario.id,
        escopoId: outro.escopoId,
        alvoTipo: 'PALETE',
        alvoId: id,
        detalhes: { motivo: 'historico_de_outro_escopo', escopoAtivo: escopo.id },
        requestId: request.id,
      });
    }
    throw naoEncontrado('Palete não encontrado neste escopo.');
  });
}
