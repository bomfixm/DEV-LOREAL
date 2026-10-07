import { CABECALHO_IDEMPOTENCIA, ChaveIdempotenciaSchema } from '@praca-reversa/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ErroHttp, requisicaoInvalida } from '../../http/erros.js';
import type { ResultadoIdempotente } from './executar.js';

/** Cabeçalho Idempotency-Key obrigatório nas mutações. */
export function chaveIdempotencia(request: FastifyRequest): string {
  const chave = ChaveIdempotenciaSchema.safeParse(request.headers[CABECALHO_IDEMPOTENCIA]);
  if (!chave.success) {
    throw new ErroHttp(400, 'IDEMPOTENCIA_AUSENTE', 'Envie o cabeçalho Idempotency-Key (8 a 200 caracteres) nesta operação.');
  }
  return chave.data;
}

/** Envia o resultado; repetição com a mesma chave é sinalizada no cabeçalho. */
export function responder(reply: FastifyReply, resultado: ResultadoIdempotente): FastifyReply {
  if (resultado.repetido) reply.header('idempotency-replayed', 'true');
  return reply.code(resultado.status).send(resultado.corpo);
}

/** Valida dados recebidos; a primeira mensagem do contrato vai para a interface. */
export function validar<T>(schema: z.ZodType<T>, valor: unknown, padrao: string): T {
  const resultado = schema.safeParse(valor);
  if (!resultado.success) throw requisicaoInvalida(resultado.error.issues[0]?.message ?? padrao);
  return resultado.data;
}
