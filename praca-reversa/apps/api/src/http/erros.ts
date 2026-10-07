import type { CodigoErro, ErroApi } from '@praca-reversa/contracts';
import type { FastifyReply } from 'fastify';

/** Erro de negócio ou de acesso com status HTTP e código estável para a interface. */
export class ErroHttp extends Error {
  readonly status: number;
  readonly codigo: CodigoErro;
  readonly cabecalhos: Readonly<Record<string, string>>;

  constructor(status: number, codigo: CodigoErro, mensagem: string, cabecalhos: Record<string, string> = {}) {
    super(mensagem);
    this.name = 'ErroHttp';
    this.status = status;
    this.codigo = codigo;
    this.cabecalhos = cabecalhos;
  }
}

export const naoAutenticado = () => new ErroHttp(401, 'NAO_AUTENTICADO', 'Entre com seu usuário para continuar.');
export const sessaoExpirada = () => new ErroHttp(401, 'SESSAO_EXPIRADA', 'Sua sessão terminou. Entre novamente.');
export const acessoNegado = () => new ErroHttp(403, 'ACESSO_NEGADO', 'Você não tem permissão para esta ação neste escopo.');
export const naoEncontrado = (mensagem = 'Recurso não encontrado.') => new ErroHttp(404, 'NAO_ENCONTRADO', mensagem);
export const requisicaoInvalida = (mensagem = 'Requisição inválida.') => new ErroHttp(400, 'REQUISICAO_INVALIDA', mensagem);

export function corpoErro(code: string, message: string, requestId?: string): ErroApi {
  return requestId === undefined ? { error: { code, message } } : { error: { code, message }, requestId };
}

export function enviarErro(reply: FastifyReply, status: number, code: CodigoErro, message: string): FastifyReply {
  return reply.code(status).send(corpoErro(code, message, reply.request.id));
}
