import { API_PREFIXO, AtualizarTutorialSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { validar } from '../idempotencia/http.js';
import { exemploTutorial, gravarPreferencia, lerPreferencia } from './servico.js';

/**
 * Tutorial e ajuda (etapa 10):
 * - GET/PUT /preferencias/tutorial: situação do tutorial do próprio usuário
 *   (não depende do escopo; nenhum dado operacional);
 * - GET /ajuda/exemplo: exemplo real do escopo ativo para o primeiro percurso
 *   (somente leitura, com a permissão de consultar paletes).
 * O tutorial não grava nada no escopo operacional.
 */
export function registrarRotasAjuda(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  app.get(`${API_PREFIXO}/preferencias/tutorial`, async (request) => lerPreferencia(deps.db, contextoDe(request).sessao.usuario.id));

  app.put(`${API_PREFIXO}/preferencias/tutorial`, async (request) => {
    const dados = validar(AtualizarTutorialSchema, request.body, 'Situação do tutorial inválida.');
    return gravarPreferencia(deps.db, contextoDe(request).sessao.usuario.id, dados, deps.agora());
  });

  app.get(`${API_PREFIXO}/ajuda/exemplo`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request) =>
    exemploTutorial(deps.db, escopoAtivoDe(request), deps.agora()),
  );
}
