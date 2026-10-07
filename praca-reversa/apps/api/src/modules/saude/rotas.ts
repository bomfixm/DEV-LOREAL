import { API_PREFIXO, type Prontidao, type Saude } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../../db/cliente.js';

const LIMITE_PRONTIDAO_MS = 3_000;

/**
 * /health: a API responde (sem expor configuração).
 * /health/ready: a API consegue consultar o banco; 503 quando não consegue.
 */
export function registrarRotasSaude(app: FastifyInstance, db: Banco): void {
  app.get(`${API_PREFIXO}/health`, (): Saude => ({ status: 'ok' }));

  app.get(`${API_PREFIXO}/health/ready`, async (request, reply) => {
    let tempo: NodeJS.Timeout | undefined;
    const disponivel = await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, rejeitar) => {
        tempo = setTimeout(() => {
          rejeitar(new Error('tempo esgotado'));
        }, LIMITE_PRONTIDAO_MS);
      }),
    ]).then(
      () => true,
      (erro: unknown) => {
        request.log.warn({ err: erro }, 'Banco indisponível na verificação de prontidão');
        return false;
      },
    );
    clearTimeout(tempo);
    if (disponivel) {
      const corpo: Prontidao = { status: 'pronto', database: 'disponivel' };
      return corpo;
    }
    const corpo: Prontidao = { status: 'indisponivel', database: 'indisponivel' };
    return reply.code(503).send(corpo);
  });
}
