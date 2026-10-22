import {
  API_PREFIXO,
  AcaoConteudosSchema,
  AlterarConteudoSchema,
  NovoConteudoSchema,
  RegistrarConferenciaVolumesSchema,
  RegistrarContagemSchema,
  RegistrarReconferenciaSchema,
  ResolverValidacaoSchema,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { executarAcaoConteudos, resolverValidacao } from './acoes.js';
import { registrarConferenciaVolumes } from './conferencia-tabela.js';
import { alterarConteudo, conteudosDoPalete, registrarConteudo, registrarContagem, registrarReconferencia, type Autor } from './servico.js';
import { filaValidacao, historicoOcorrencias, resumoValidacao } from './validacao.js';

const ParametrosSchema = z.object({ id: z.uuid() });
const ParametrosConteudoSchema = z.object({ id: z.uuid(), conteudo: z.uuid() });
const ParametrosOcorrenciaSchema = z.object({ ocorrencia: z.uuid() });

function autorDe(request: FastifyRequest): Autor {
  return { usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id };
}

/**
 * Conteúdo do palete e conferência de volumes. Cadastrar e completar a
 * identificação = `palete.cadastrar`; registrar contagem = `conferencia.registrar`.
 * Mutações idempotentes, transacionais e auditadas.
 */
export function registrarRotasConteudos(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  app.get(`${API_PREFIXO}/paletes/:id/conteudos`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request) => {
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    return conteudosDoPalete(deps.db, escopoAtivoDe(request).id, id);
  });

  app.post(`${API_PREFIXO}/paletes/:id/conteudos`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(NovoConteudoSchema, request.body, 'Informe o remetente; nota, Delivery e descrição são opcionais.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'conteudo.registrar', chave, payload: { id, corpo: request.body } },
      async (tx) => ({ status: 201, corpo: await registrarConteudo(tx, escopo, id, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  app.put(`${API_PREFIXO}/paletes/:id/conteudos/:conteudo`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id, conteudo } = validar(ParametrosConteudoSchema, request.params, 'Identificador inválido.');
    const dados = validar(AlterarConteudoSchema, request.body, 'Informe o remetente; nota, Delivery e descrição são opcionais.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'conteudo.alterar', chave, payload: { id, conteudo, corpo: request.body } },
      async (tx) => ({ status: 200, corpo: await alterarConteudo(tx, escopo, id, conteudo, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/paletes/:id/conteudos/contagens`, { preHandler: auth.exigirPermissao('conferencia.registrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(RegistrarContagemSchema, request.body, 'Informe os volumes contados (número inteiro, 0 ou mais).');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'conteudo.contagem', chave, payload: { id, corpo: request.body } },
      async (tx) => ({ status: 201, corpo: await registrarContagem(tx, escopo, id, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  // Reconferência completa do palete (prazo de 20 dias): mesma permissão da conferência de volumes.
  app.post(`${API_PREFIXO}/paletes/:id/reconferencias`, { preHandler: auth.exigirPermissao('conferencia.registrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(RegistrarReconferenciaSchema, request.body, 'Confirme que o palete inteiro foi conferido e informe o resultado.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'palete.reconferencia', chave, payload: { id, corpo: request.body } },
      async (tx) => ({ status: 201, corpo: await registrarReconferencia(tx, escopo, id, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  // Conferência de volumes em tabela (palete inteiro numa operação; completa ou parcial).
  app.post(`${API_PREFIXO}/paletes/:id/conferencias-volumes`, { preHandler: auth.exigirPermissao('conferencia.registrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(RegistrarConferenciaVolumesSchema, request.body, 'Revise a conferência: volumes inteiros (0 ou mais) e, na completa, a declaração de conferência física.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'palete.conferencia_volumes', chave, payload: { id, corpo: request.body } },
      async (tx) => ({ status: 201, corpo: await registrarConferenciaVolumes(tx, escopo, id, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  // Correção de conteúdos: mover, enviar à validação, cancelar (perfis internos com conteudo.corrigir).
  app.post(`${API_PREFIXO}/paletes/:id/conteudos/acoes`, { preHandler: auth.exigirPermissao('conteudo.corrigir') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(AcaoConteudosSchema, request.body, 'Revise a ação: conteúdos selecionados, destino e motivo.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'conteudo.acao', chave, payload: { id, corpo: request.body } },
      async (tx) => ({ status: 200, corpo: await executarAcaoConteudos(tx, escopo, id, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  // Validação urgente — sem endereço (interna; o cliente não tem a permissão).
  app.get(`${API_PREFIXO}/validacao`, { preHandler: auth.exigirPermissao('validacao.consultar') }, async (request) => filaValidacao(deps.db, escopoAtivoDe(request).id));
  app.get(`${API_PREFIXO}/validacao/resumo`, { preHandler: auth.exigirPermissao('validacao.consultar') }, async (request) => resumoValidacao(deps.db, escopoAtivoDe(request).id));

  app.post(`${API_PREFIXO}/validacao/resolver`, { preHandler: auth.exigirPermissao('conteudo.corrigir') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const dados = validar(ResolverValidacaoSchema, request.body, 'Selecione as pendências e escolha o destino no mapa.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'validacao.resolver', chave, payload: { corpo: request.body } },
      async (tx) => ({ status: 200, corpo: await resolverValidacao(tx, escopo, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  // Histórico real de uma ocorrência (interno).
  app.get(`${API_PREFIXO}/ocorrencias/:ocorrencia/historico`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request) => {
    const { ocorrencia } = validar(ParametrosOcorrenciaSchema, request.params, 'Identificador inválido.');
    return { items: (await historicoOcorrencias(deps.db, escopoAtivoDe(request).id, [ocorrencia])).get(ocorrencia) ?? [] };
  });
}
