import { API_PREFIXO, EnviarSeparacaoSchema, MarcarSeparadoSchema } from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { nomeDownload } from '../../http/csv-seguro.js';
import { naoEncontrado } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { encerrarSeparacao, listarSeparacoes, marcarPaleteSeparado, registrarSeparacao, relatorioSeparadosXlsx, relatorioXlsx, type Autor } from './servico.js';

const ParametrosSchema = z.object({ id: z.uuid() });
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Separação do cliente: enviar a planilha, consultar o cruzamento, baixar o relatório e encerrar. */
export function registrarRotasSeparacao(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const autorDe = (request: FastifyRequest): Autor => ({ usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id });

  app.post(`${API_PREFIXO}/separacoes`, { bodyLimit: 4 * 1_048_576, preHandler: auth.exigirPermissao('selecao.importar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const dados = validar(EnviarSeparacaoSchema, request.body, 'Notas da separação inválidas.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'separacao.enviar', chave, payload: { corpo: request.body } },
      async (tx) => ({ status: 201, corpo: await registrarSeparacao(tx, escopo, dados, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  // Marca manual "separado para a agenda" no palete roxo (operação do dia a dia: perfis que movimentam).
  app.post(`${API_PREFIXO}/paletes/:id/separado-agenda`, { preHandler: auth.exigirPermissao('movimento.registrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de palete inválido.');
    const dados = validar(MarcarSeparadoSchema, request.body, 'Informe se o palete está separado.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'separacao.palete_separado', chave: chaveIdempotencia(request), payload: { id, corpo: request.body } },
      async (tx) => ({ status: 200, corpo: await marcarPaleteSeparado(tx, escopo, id, dados.separated, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });

  app.get(`${API_PREFIXO}/separacoes`, { preHandler: auth.exigirPermissao('selecao.consultar') }, async (request) => listarSeparacoes(deps.db, escopoAtivoDe(request).id));

  app.get(`${API_PREFIXO}/separacoes/:id/relatorio`, { preHandler: auth.exigirPermissao('selecao.consultar') }, async (request, reply) => {
    const { id } = validar(ParametrosSchema, request.params, 'Identificador inválido.');
    const separacao = (await listarSeparacoes(deps.db, escopoAtivoDe(request).id)).items.find((s) => s.id === id);
    if (!separacao) throw naoEncontrado('Separação ativa não encontrada.');
    return reply
      .header('content-type', TIPO_XLSX)
      .header('cache-control', 'no-store')
      .header('content-disposition', `attachment; filename="${nomeDownload(`notas-separacao-${separacao.window ?? 'cliente'}`)}.xlsx"`)
      .send(relatorioXlsx(separacao));
  });

  // Exporta o que já foi marcado como separado para a agenda.
  app.get(`${API_PREFIXO}/separacoes/:id/separados`, { preHandler: auth.exigirPermissao('selecao.consultar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador inválido.');
    const { somente } = validar(z.object({ somente: z.enum(['falta']).optional() }), request.query, 'Parâmetro inválido.');
    const separacao = (await listarSeparacoes(deps.db, escopo.id)).items.find((s) => s.id === id);
    if (!separacao) throw naoEncontrado('Separação ativa não encontrada.');
    const falta = somente === 'falta';
    return reply
      .header('content-type', TIPO_XLSX)
      .header('cache-control', 'no-store')
      .header('content-disposition', `attachment; filename="${nomeDownload(`${falta ? 'falta-separar' : 'separados'}-${separacao.window ?? 'cliente'}`)}.xlsx"`)
      .send(await relatorioSeparadosXlsx(deps.db, escopo.id, separacao, falta));
  });

  app.post(`${API_PREFIXO}/separacoes/:id/encerrar`, { preHandler: auth.exigirPermissao('selecao.importar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador inválido.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'separacao.encerrar', chave, payload: { id } },
      async (tx) => ({ status: 200, corpo: await encerrarSeparacao(tx, escopo, id, autor, deps.agora()) }),
    );
    return responder(reply, resultado);
  });
}
