import {
  API_PREFIXO,
  AlterarCidadeDestinoSchema,
  AlterarPaleteSchema,
  AlterarProdutoNaCaixaSchema,
  ArquivarPaleteSchema,
  CadastroPaleteSchema,
  NovaDescricaoCaixaSchema,
  RetirarDescricaoCaixaSchema,
  perfilPossui,
  type EscopoDoPalete,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { naoEncontrado } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { adicionarDescricaoCaixa, alterarCidadeDestino, alterarProdutoNaCaixa, retirarDescricaoCaixa } from './notas.js';
import { alterarPalete, arquivarPalete, cadastrarPalete, type Autor } from './servico.js';

const ParametrosSchema = z.object({ id: z.uuid() });
const ParametrosCaixaSchema = z.object({ id: z.uuid(), descricao: z.uuid() });

function autorDe(request: FastifyRequest): Autor {
  return { usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id };
}

/** Cadastro de paletes. Mutações idempotentes, transacionais e auditadas. */
export function registrarRotasPaletes(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  app.post(`${API_PREFIXO}/paletes`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const dados = validar(CadastroPaleteSchema, request.body, 'Dados do palete inválidos.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'palete.cadastrar', chave, payload: { corpo: request.body } },
      async (tx) => ({ status: 201, corpo: await cadastrarPalete(tx, escopo, dados, autor) }),
    );
    return responder(reply, resultado);
  });

  app.patch(`${API_PREFIXO}/paletes/:id`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(AlterarPaleteSchema, request.body, 'Dados do palete inválidos.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'palete.alterar', chave, payload: { id, corpo: request.body } },
      async (tx) => ({ status: 200, corpo: await alterarPalete(tx, escopo, id, dados, autor) }),
    );
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/paletes/:id/arquivar`, { preHandler: auth.exigirPermissao('palete.arquivar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(ArquivarPaleteSchema, request.body, 'Informe o motivo do arquivamento.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'palete.arquivar', chave, payload: { id, corpo: request.body } },
      async (tx) => ({ status: 200, corpo: await arquivarPalete(tx, escopo, id, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  /**
   * Notas do palete (carga do inventário em lote): cidade destino da NF,
   * produto na caixa do vínculo NF × palete e descrições por caixa/grupo.
   * Informação descritiva: não cria saldo por SKU, não libera nem reserva.
   */
  app.put(`${API_PREFIXO}/paletes/:id/documentos/cidade-destino`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(AlterarCidadeDestinoSchema, request.body, 'Cidade destino inválida (até 120 caracteres).');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'nota.cidade_destino', chave, payload: { id, corpo: request.body } },
      async (tx) => ({ status: 200, corpo: await alterarCidadeDestino(tx, escopo, id, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  app.put(`${API_PREFIXO}/paletes/:id/documentos/produto`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(AlterarProdutoNaCaixaSchema, request.body, 'Produto na caixa inválido (até 500 caracteres).');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'nota.produto', chave, payload: { id, corpo: request.body } },
      async (tx) => ({ status: 200, corpo: await alterarProdutoNaCaixa(tx, escopo, id, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/paletes/:id/documentos/caixas`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(NovaDescricaoCaixaSchema, request.body, 'Informe a caixa/grupo e a descrição do produto.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'nota.caixa', chave, payload: { id, corpo: request.body } },
      async (tx) => ({ status: 201, corpo: await adicionarDescricaoCaixa(tx, escopo, id, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/paletes/:id/documentos/caixas/:descricao/retirar`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id, descricao } = validar(ParametrosCaixaSchema, request.params, 'Identificador inválido.');
    const dados = validar(RetirarDescricaoCaixaSchema, request.body, 'Informe o motivo da retirada.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'nota.caixa_retirar', chave, payload: { id, descricao, corpo: request.body } },
      async (tx) => ({ status: 200, corpo: await retirarDescricaoCaixa(tx, escopo, id, descricao, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  /**
   * Para links de QR abertos em outro escopo: informa a qual unidade/cliente
   * o palete pertence, somente se o usuário pode consultá-lo lá. Caso
   * contrário, o mesmo 404 de palete inexistente.
   */
  app.get(`${API_PREFIXO}/paletes/:id/escopo`, async (request) => {
    const contexto = contextoDe(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const palete = await deps.db.palete.findUnique({ where: { id }, select: { escopoId: true, escopo: { select: { nome: true } } } });
    const vinculo = palete ? contexto.escopos.find((e) => e.id === palete.escopoId) : undefined;
    if (palete && vinculo && perfilPossui(vinculo.role, 'palete.consultar')) {
      const corpo: EscopoDoPalete = { scopeId: palete.escopoId, scopeName: palete.escopo.nome };
      return corpo;
    }
    if (palete) {
      await registrarEvento(deps.db, {
        acao: 'ACESSO_NEGADO',
        resultado: 'NEGADO',
        atorUsuarioId: contexto.sessao.usuario.id,
        escopoId: palete.escopoId,
        alvoTipo: 'PALETE',
        alvoId: id,
        detalhes: { motivo: 'consulta_de_escopo_sem_acesso' },
        requestId: request.id,
      });
    }
    throw naoEncontrado('Palete não encontrado.');
  });
}
