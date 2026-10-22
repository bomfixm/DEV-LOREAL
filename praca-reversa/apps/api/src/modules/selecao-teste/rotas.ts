import {
  API_PREFIXO,
  AdicionarItensTesteSchema,
  AlterarItemTesteSchema,
  AlterarSolicitacaoTesteSchema,
  AtualizarDadosTesteSchema,
  FiltroEstoqueTesteSchema,
  NovaSolicitacaoTesteSchema,
  PedirAlteracaoTesteSchema,
  ResponderAlteracaoTesteSchema,
  VersaoTesteSchema,
  type Escopo,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { estoqueTeste, paleteTeste } from './estoque.js';
import {
  adicionarItens,
  agendas,
  alterarCabecalho,
  alterarItem,
  atualizarDados,
  criarSolicitacao,
  detalhe,
  enviar,
  listar,
  pedirAlteracao,
  removerItem,
  responderAlteracao,
  verificar,
  type Autor,
} from './servico.js';

const IdSchema = z.object({ id: z.uuid() });
const ItemSchema = z.object({ id: z.uuid(), itemId: z.uuid() });
const AlteracaoSchema = z.object({ id: z.uuid(), alteracaoId: z.uuid() });
const BASE = `${API_PREFIXO}/selecao-teste`;
/** Envio e conferências leem o estoque inteiro do escopo: transação com folga. */
const LIMITES = { maxWait: 5_000, timeout: 20_000 };

/**
 * "Seleção cliente — teste" (pedido de 20/10/2026). Só existe com a
 * funcionalidade ligada (SELECAO_CLIENTE_TESTE) e só para quem tem a concessão
 * explícita no vínculo (responsável interno): `selecao_teste.solicitar` para
 * consultar, montar o carrinho, enviar e pedir alteração;
 * `selecao_teste.responder` para aprovar ou recusar alterações. O estoque é
 * só lido; as gravações vão para as tabelas próprias do teste, com chave de
 * idempotência e versão da solicitação.
 */
export function registrarRotasSelecaoTeste(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const solicitar = { preHandler: auth.exigirPermissao('selecao_teste.solicitar') };
  const consultar = { preHandler: auth.exigirAlguma(['selecao_teste.solicitar', 'selecao_teste.responder']) };
  const responderAlt = { preHandler: auth.exigirPermissao('selecao_teste.responder') };
  const autorDe = (request: FastifyRequest): Autor => ({ usuarioId: contextoDe(request).sessao.usuario.id });

  const corpoDetalhe = (request: FastifyRequest, db: Transacao, escopo: Escopo, id: string) =>
    detalhe(db, escopo, id, contextoDe(request).sessao.usuario.id, contextoDe(request).permissoes);

  /** Mutação idempotente que devolve a solicitação atualizada. */
  const mutacao =
    (operacao: string, executar: (request: FastifyRequest, tx: Transacao, escopo: Escopo, autor: Autor) => Promise<{ id: string; status?: number }>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const escopo = escopoAtivoDe(request);
      const autor = autorDe(request);
      const resultado = await executarIdempotente(
        deps.db,
        deps.config.appSegredo,
        { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao, chave: chaveIdempotencia(request), payload: { params: request.params, corpo: request.body } },
        async (tx) => {
          const { id, status } = await executar(request, tx, escopo, autor);
          return { status: status ?? 200, corpo: await corpoDetalhe(request, tx, escopo, id) };
        },
        LIMITES,
      );
      return responder(reply, resultado);
    };

  // ---------- Consulta do estoque (só leitura) ----------
  app.get(`${BASE}/estoque`, solicitar, async (request) => {
    const filtro = validar(FiltroEstoqueTesteSchema, request.query, 'Pesquisa inválida.');
    return estoqueTeste(deps.db, escopoAtivoDe(request), filtro, deps.agora());
  });

  app.get(`${BASE}/paletes/:id`, solicitar, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de palete inválido.');
    return paleteTeste(deps.db, escopoAtivoDe(request), id, deps.agora());
  });

  app.get(`${BASE}/agendas`, solicitar, async (request) => agendas(deps.db, escopoAtivoDe(request)));

  // ---------- Solicitações de teste ----------
  app.get(`${BASE}/solicitacoes`, consultar, async (request) => listar(deps.db, escopoAtivoDe(request), contextoDe(request).sessao.usuario.id));

  app.get(`${BASE}/solicitacoes/:id`, consultar, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de solicitação inválido.');
    return detalhe(deps.db, escopoAtivoDe(request), id, contextoDe(request).sessao.usuario.id, contextoDe(request).permissoes);
  });

  app.get(`${BASE}/solicitacoes/:id/verificacao`, solicitar, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de solicitação inválido.');
    return verificar(deps.db, escopoAtivoDe(request), id, deps.agora());
  });

  app.post(
    `${BASE}/solicitacoes`,
    solicitar,
    mutacao('selecao_teste.criar', async (request, tx, escopo, autor) => {
      const dados = validar(NovaSolicitacaoTesteSchema, request.body, 'Informe a agenda de referência.');
      const r = await criarSolicitacao(tx, escopo, dados, autor, deps.agora());
      return { id: r.id, status: r.criada ? 201 : 200 };
    }),
  );

  app.patch(
    `${BASE}/solicitacoes/:id`,
    solicitar,
    mutacao('selecao_teste.cabecalho', async (request, tx, escopo, autor) => {
      const { id } = validar(IdSchema, request.params, 'Identificador de solicitação inválido.');
      const dados = validar(AlterarSolicitacaoTesteSchema, request.body, 'Observação inválida.');
      await alterarCabecalho(tx, escopo, id, dados, autor, deps.agora());
      return { id };
    }),
  );

  app.post(
    `${BASE}/solicitacoes/:id/itens`,
    solicitar,
    mutacao('selecao_teste.adicionar', async (request, tx, escopo, autor) => {
      const { id } = validar(IdSchema, request.params, 'Identificador de solicitação inválido.');
      const dados = validar(AdicionarItensTesteSchema, request.body, 'Escolha o palete inteiro ou ao menos uma nota.');
      await adicionarItens(tx, escopo, id, dados, autor, deps.agora());
      return { id };
    }),
  );

  app.patch(
    `${BASE}/solicitacoes/:id/itens/:itemId`,
    solicitar,
    mutacao('selecao_teste.alterar_item', async (request, tx, escopo, autor) => {
      const { id, itemId } = validar(ItemSchema, request.params, 'Identificador de item inválido.');
      const dados = validar(AlterarItemTesteSchema, request.body, 'Quantidade, Delivery ou observação inválida.');
      await alterarItem(tx, escopo, id, itemId, dados, autor, deps.agora());
      return { id };
    }),
  );

  app.post(
    `${BASE}/solicitacoes/:id/itens/:itemId/remocao`,
    solicitar,
    mutacao('selecao_teste.remover_item', async (request, tx, escopo, autor) => {
      const { id, itemId } = validar(ItemSchema, request.params, 'Identificador de item inválido.');
      const { expectedVersion } = validar(VersaoTesteSchema, request.body, 'Versão da solicitação ausente.');
      await removerItem(tx, escopo, id, itemId, expectedVersion, autor, deps.agora());
      return { id };
    }),
  );

  app.post(
    `${BASE}/solicitacoes/:id/atualizacao-dados`,
    solicitar,
    mutacao('selecao_teste.atualizar_dados', async (request, tx, escopo, autor) => {
      const { id } = validar(IdSchema, request.params, 'Identificador de solicitação inválido.');
      const dados = validar(AtualizarDadosTesteSchema, request.body, 'Escolha os itens a atualizar.');
      await atualizarDados(tx, escopo, id, dados, autor, deps.agora());
      return { id };
    }),
  );

  app.post(
    `${BASE}/solicitacoes/:id/envio`,
    solicitar,
    mutacao('selecao_teste.enviar', async (request, tx, escopo, autor) => {
      const { id } = validar(IdSchema, request.params, 'Identificador de solicitação inválido.');
      const { expectedVersion } = validar(VersaoTesteSchema, request.body, 'Versão da solicitação ausente.');
      await enviar(tx, escopo, id, expectedVersion, autor, deps.agora());
      return { id, status: 201 };
    }),
  );

  app.post(
    `${BASE}/solicitacoes/:id/alteracoes`,
    solicitar,
    mutacao('selecao_teste.pedir_alteracao', async (request, tx, escopo, autor) => {
      const { id } = validar(IdSchema, request.params, 'Identificador de solicitação inválido.');
      const dados = validar(PedirAlteracaoTesteSchema, request.body, 'Explique o que precisa mudar.');
      await pedirAlteracao(tx, escopo, id, dados, autor, deps.agora());
      return { id, status: 201 };
    }),
  );

  app.post(
    `${BASE}/solicitacoes/:id/alteracoes/:alteracaoId/resposta`,
    responderAlt,
    mutacao('selecao_teste.responder_alteracao', async (request, tx, escopo, autor) => {
      const { id, alteracaoId } = validar(AlteracaoSchema, request.params, 'Identificador do pedido de alteração inválido.');
      const dados = validar(ResponderAlteracaoTesteSchema, request.body, 'Escolha aprovar ou recusar e registre a resposta.');
      await responderAlteracao(tx, escopo, id, alteracaoId, dados, autor, deps.agora());
      return { id };
    }),
  );
}
