import {
  API_PREFIXO,
  AlterarNotasConferenciaSchema,
  CancelarConferenciaSchema,
  ConcluirConferenciaSchema,
  CorrigirObservacaoSchema,
  IniciarConferenciaSchema,
  NovaObservacaoSchema,
  ReconciliarConferenciaSchema,
  RemoverObservacaoSchema,
  SolicitarRecontagemSchema,
  nomeArquivoSeguro,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { nomeDownload } from '../../http/csv-seguro.js';
import { naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { executarIdempotente, type Resposta } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import type { Transacao } from '../../db/cliente.js';
import { enviarAnexoConferencia, lerAnexoConferencia } from './anexos.js';
import { historicoDoPalete, lerConferencia } from './leitura.js';
import {
  alterarNotas,
  cancelarConferencia,
  concluirConferencia,
  corrigirObservacao,
  iniciarConferencia,
  previaReconciliacao,
  reconciliarConferencia,
  registrarObservacao,
  removerObservacao,
  solicitarRecontagem,
  type Autor,
} from './servico.js';

const IdSchema = z.object({ id: z.uuid() });
const LinhaSchema = z.object({ id: z.uuid(), linhaId: z.uuid() });
const AnexoParametrosSchema = z.object({ id: z.uuid(), anexoId: z.uuid() });
/** Nome original do anexo (só rótulo, codificado como URI). */
const NOME_CABECALHO = 'x-arquivo-nome';
const EXTENSOES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Concorrência real em reconciliação: espera maior pelo bloqueio do palete. */
const LIMITES_RECONCILIACAO = { maxWait: 10_000, timeout: 20_000 };

function autorDe(request: FastifyRequest): Autor {
  return { usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id };
}

/**
 * Conferência e reconciliação. Leitura com `palete.consultar`; registrar,
 * concluir, cancelar a própria e recontar com `conferencia.registrar`;
 * reconciliar (e cancelar contagem de outra pessoa ou já concluída) com
 * `conferencia.reconciliar`. Tudo restrito ao escopo ativo (outro escopo: 404).
 */
export function registrarRotasConferencia(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  /** Mutação idempotente: registro da chave, alteração e auditoria numa transação. */
  async function mutar(
    request: FastifyRequest,
    operacao: string,
    payload: unknown,
    executar: (tx: Transacao, escopoId: string, autor: Autor) => Promise<Resposta>,
    limites?: { maxWait?: number; timeout?: number },
  ) {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    return executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao, chave, payload },
      (tx) => executar(tx, escopo.id, autor),
      limites,
    );
  }

  app.get(`${API_PREFIXO}/paletes/:id/conferencias`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de palete inválido.');
    const palete = await deps.db.palete.findFirst({ where: { id, escopoId: escopo.id }, select: { id: true } });
    if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
    return historicoDoPalete(deps.db, escopo.id, id);
  });

  app.post(`${API_PREFIXO}/paletes/:id/conferencias`, { preHandler: auth.exigirPermissao('conferencia.registrar') }, async (request, reply) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(IniciarConferenciaSchema, request.body, 'Dados da conferência inválidos.');
    const resultado = await mutar(request, 'conferencia.iniciar', { id, corpo: request.body }, async (tx, escopoId, autor) => ({
      status: 201,
      corpo: await iniciarConferencia(tx, escopoId, id, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.get(`${API_PREFIXO}/conferencias/:id`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de conferência inválido.');
    const detalhe = await lerConferencia(deps.db, escopo.id, id);
    if (detalhe) return detalhe;
    const outra = await deps.db.sessaoConferencia.findUnique({ where: { id }, select: { escopoId: true } });
    if (outra) {
      await registrarEvento(deps.db, {
        acao: 'ACESSO_NEGADO',
        resultado: 'NEGADO',
        atorUsuarioId: contextoDe(request).sessao.usuario.id,
        escopoId: outra.escopoId,
        alvoTipo: 'CONFERENCIA',
        alvoId: id,
        detalhes: { motivo: 'conferencia_de_outro_escopo', escopoAtivo: escopo.id },
        requestId: request.id,
      });
    }
    throw naoEncontrado('Conferência não encontrada neste escopo.');
  });

  // Anexo (etapa 09): sessão, CSRF e permissão conferidos antes de ler o corpo; corpo binário limitado.
  void app.register((sub, _opcoes, pronto) => {
    sub.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: deps.claims.anexoMaxBytes }, (_request, corpo, feito) => {
      feito(null, corpo);
    });
    sub.post(
      `${API_PREFIXO}/conferencias/:id/anexos`,
      { bodyLimit: deps.claims.anexoMaxBytes, onRequest: [auth.autenticar, auth.exigirPermissao('conferencia.registrar')] },
      async (request, reply) => {
        const { id } = validar(IdSchema, request.params, 'Identificador de conferência inválido.');
        if (!Buffer.isBuffer(request.body)) throw requisicaoInvalida('Envie o anexo como application/octet-stream.');
        const cabecalho = request.headers[NOME_CABECALHO];
        let nome = 'anexo';
        if (typeof cabecalho === 'string') {
          try {
            nome = nomeArquivoSeguro(decodeURIComponent(cabecalho));
          } catch {
            throw requisicaoInvalida('Nome do arquivo inválido.');
          }
        }
        const conteudo = request.body;
        const resultado = await mutar(request, 'conferencia.anexo', { id, nome, tamanho: conteudo.length }, async (tx, escopoId, autor) => ({
          status: 201,
          corpo: await enviarAnexoConferencia(tx, escopoId, id, nome, conteudo, deps.claims.anexoMaxBytes, autor, deps.agora()),
        }));
        return responder(reply, resultado);
      },
    );
    pronto();
  });

  app.get(`${API_PREFIXO}/conferencias/:id/anexos/:anexoId`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id, anexoId } = validar(AnexoParametrosSchema, request.params, 'Identificador inválido.');
    const anexo = await lerAnexoConferencia(deps.db, escopo.id, id, anexoId);
    await registrarEvento(deps.db, {
      acao: 'CONFERENCIA_ANEXO_BAIXADO',
      resultado: 'SUCESSO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopo.id,
      alvoTipo: 'CONFERENCIA',
      alvoId: id,
      detalhes: { anexo: anexoId },
      requestId: request.id,
    });
    const base = nomeDownload(anexo.nome.replace(/\.[A-Za-z0-9]{1,5}$/, '')) || 'anexo';
    // Nunca exibido como página: download com tipo fixo, sem cache e sem execução.
    return reply
      .header('content-type', anexo.tipoConteudo)
      .header('content-disposition', `attachment; filename="${base}.${EXTENSOES[anexo.tipoConteudo] ?? 'bin'}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('x-anexo-sha256', anexo.sha256)
      .send(Buffer.from(anexo.conteudo));
  });

  app.patch(`${API_PREFIXO}/conferencias/:id`, { preHandler: auth.exigirPermissao('conferencia.registrar') }, async (request, reply) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de conferência inválido.');
    const dados = validar(AlterarNotasConferenciaSchema, request.body, 'Observações inválidas.');
    const resultado = await mutar(request, 'conferencia.notas', { id, corpo: request.body }, async (tx, escopoId, autor) => ({
      status: 200,
      corpo: await alterarNotas(tx, escopoId, id, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/conferencias/:id/observacoes`, { preHandler: auth.exigirPermissao('conferencia.registrar') }, async (request, reply) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de conferência inválido.');
    const dados = validar(NovaObservacaoSchema, request.body, 'Entrada inválida.');
    const resultado = await mutar(request, 'conferencia.observar', { id, corpo: request.body }, async (tx, escopoId, autor) => ({
      status: 201,
      corpo: await registrarObservacao(tx, escopoId, id, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.patch(
    `${API_PREFIXO}/conferencias/:id/observacoes/:linhaId`,
    { preHandler: auth.exigirPermissao('conferencia.registrar') },
    async (request, reply) => {
      const { id, linhaId } = validar(LinhaSchema, request.params, 'Identificador inválido.');
      const dados = validar(CorrigirObservacaoSchema, request.body, 'Correção inválida.');
      const resultado = await mutar(request, 'conferencia.corrigir', { id, linhaId, corpo: request.body }, async (tx, escopoId, autor) => ({
        status: 200,
        corpo: await corrigirObservacao(tx, escopoId, id, linhaId, dados, autor, deps.agora()),
      }));
      return responder(reply, resultado);
    },
  );

  app.post(
    `${API_PREFIXO}/conferencias/:id/observacoes/:linhaId/remover`,
    { preHandler: auth.exigirPermissao('conferencia.registrar') },
    async (request, reply) => {
      const { id, linhaId } = validar(LinhaSchema, request.params, 'Identificador inválido.');
      const dados = validar(RemoverObservacaoSchema, request.body, 'Remoção inválida.');
      const resultado = await mutar(request, 'conferencia.remover', { id, linhaId, corpo: request.body }, async (tx, escopoId, autor) => ({
        status: 200,
        corpo: await removerObservacao(tx, escopoId, id, linhaId, dados, autor, deps.agora()),
      }));
      return responder(reply, resultado);
    },
  );

  app.post(`${API_PREFIXO}/conferencias/:id/concluir`, { preHandler: auth.exigirPermissao('conferencia.registrar') }, async (request, reply) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de conferência inválido.');
    const dados = validar(ConcluirConferenciaSchema, request.body, 'Dados da conclusão inválidos.');
    const resultado = await mutar(request, 'conferencia.concluir', { id, corpo: request.body }, async (tx, escopoId, autor) => ({
      status: 200,
      corpo: await concluirConferencia(tx, escopoId, id, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/conferencias/:id/cancelar`, { preHandler: auth.exigirPermissao('conferencia.registrar') }, async (request, reply) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de conferência inválido.');
    const dados = validar(CancelarConferenciaSchema, request.body, 'Informe o motivo do cancelamento (3 a 500 caracteres).');
    const podeValidar = contextoDe(request).permissoes.has('conferencia.reconciliar');
    const resultado = await mutar(request, 'conferencia.cancelar', { id, corpo: request.body }, async (tx, escopoId, autor) => ({
      status: 200,
      corpo: await cancelarConferencia(tx, escopoId, id, dados, { ...autor, podeValidar }, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/conferencias/:id/recontagem`, { preHandler: auth.exigirPermissao('conferencia.registrar') }, async (request, reply) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de conferência inválido.');
    const dados = validar(SolicitarRecontagemSchema, request.body, 'Informe a justificativa da recontagem (3 a 500 caracteres).');
    const resultado = await mutar(request, 'conferencia.recontar', { id, corpo: request.body }, async (tx, escopoId, autor) => ({
      status: 201,
      corpo: await solicitarRecontagem(tx, escopoId, id, dados, autor, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.get(`${API_PREFIXO}/conferencias/:id/reconciliacao`, { preHandler: auth.exigirPermissao('conferencia.reconciliar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de conferência inválido.');
    return previaReconciliacao(deps.db, escopo.id, id);
  });

  app.post(
    `${API_PREFIXO}/conferencias/:id/reconciliar`,
    { preHandler: auth.exigirPermissao('conferencia.reconciliar') },
    async (request, reply) => {
      const { id } = validar(IdSchema, request.params, 'Identificador de conferência inválido.');
      const dados = validar(ReconciliarConferenciaSchema, request.body, 'Informe a justificativa da reconciliação (3 a 500 caracteres).');
      const resultado = await mutar(
        request,
        'conferencia.reconciliar',
        { id, corpo: request.body },
        (tx, escopoId, autor) => reconciliarConferencia(tx, escopoId, id, dados, autor, deps.agora()),
        LIMITES_RECONCILIACAO,
      );
      return responder(reply, resultado);
    },
  );
}
