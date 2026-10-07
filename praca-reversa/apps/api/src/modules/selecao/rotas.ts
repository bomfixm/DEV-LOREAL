import {
  API_PREFIXO,
  AnularResolucaoSchema,
  ConfirmarPropostaSchema,
  FiltroConciliacaoSchema,
  FiltroInventariosSchema,
  FiltroLinhasInventarioSchema,
  FiltroSelecoesSchema,
  PropostaJanelaEntradaSchema,
  ReconhecerConferenciaExternaSchema,
  ResolverLinhaSchema,
  TipoExportacaoSelecaoSchema,
  type Permissao,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { nomeDownload } from '../../http/csv-seguro.js';
import { acessoNegado } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import type { Transacao } from '../../db/cliente.js';
import { executarIdempotente, type Resposta } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { exportarSelecao } from './exportacao.js';
import { notasDoPalete } from '../paletes/notas.js';
import { lerInventario, linhasDoInventario, listarInventarios, reconhecerConferenciaExterna } from './inventarios.js';
import { anularResolucao, conciliar, conciliarTudo, lerSelecao, listarSelecoes, proposta, reservar, resolverLinha, type Autor } from './servico.js';

const IdSchema = z.object({ id: z.uuid() });
const LinhaSchema = z.object({ id: z.uuid(), linha: z.uuid() });
const ExportarSchema = z.object({ tipo: TipoExportacaoSelecaoSchema, situacao: z.string().max(300).optional(), texto: z.string().max(64).optional() });
const LIMITES_TRANSACAO = { maxWait: 10_000, timeout: 60_000 };

/**
 * Seleção do cliente, inventários de referência e conciliação (complemento).
 * Permissões conferidas no servidor, sempre no escopo ativo (registro de
 * outro escopo responde como inexistente):
 * - selecao.consultar: seleções, conciliação, inventários e pendências;
 * - selecao.importar: resolver identificação ambígua e montar a proposta para a janela;
 * - janela.reservar (além de selecao.importar): confirmar a reserva da proposta;
 * - selecao.exportar: lista de separação, pendências e conciliação (CSV);
 * - conferencia.reconciliar: reconhecer a conferência externa de um inventário;
 * - palete.consultar: documentos informados do palete.
 */
export function registrarRotasSelecao(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const p = (...lista: Permissao[]) => lista.map((x) => auth.exigirPermissao(x));

  function algum(lista: readonly Permissao[]) {
    return async function verificar(request: FastifyRequest): Promise<void> {
      const contexto = contextoDe(request);
      const escopo = escopoAtivoDe(request);
      if (lista.some((x) => contexto.permissoes.has(x))) return;
      await registrarEvento(deps.db, {
        acao: 'ACESSO_NEGADO',
        resultado: 'NEGADO',
        atorUsuarioId: contexto.sessao.usuario.id,
        escopoId: escopo.id,
        detalhes: { permissao: lista.join('|'), metodo: request.method, rota: request.routeOptions.url ?? request.url },
        requestId: request.id,
      });
      throw acessoNegado();
    };
  }

  function autorDe(request: FastifyRequest): Autor {
    return { usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id };
  }

  async function mutar(request: FastifyRequest, reply: FastifyReply, operacao: string, executar: (tx: Transacao, autor: Autor) => Promise<Resposta['corpo']>) {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao, chave: chaveIdempotencia(request), payload: { params: request.params, corpo: request.body } },
      async (tx) => ({ status: 200, corpo: await executar(tx, autor) }),
      LIMITES_TRANSACAO,
    );
    return responder(reply, resultado);
  }

  // ---------- Seleções ----------

  app.get(`${API_PREFIXO}/selecoes`, { preHandler: p('selecao.consultar') }, async (request) => {
    const filtro = validar(FiltroSelecoesSchema, request.query, 'Filtro inválido.');
    return listarSelecoes(deps.db, escopoAtivoDe(request).id, filtro);
  });

  app.get(`${API_PREFIXO}/selecoes/:id`, { preHandler: p('selecao.consultar') }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    return lerSelecao(deps.db, escopoAtivoDe(request).id, id);
  });

  app.get(`${API_PREFIXO}/selecoes/:id/conciliacao`, { preHandler: p('selecao.consultar') }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const filtro = validar(FiltroConciliacaoSchema, request.query, 'Filtro da conciliação inválido.');
    return conciliar(deps.db, escopoAtivoDe(request).id, id, filtro, deps.agora());
  });

  app.post(`${API_PREFIXO}/selecoes/:id/linhas/:linha/resolucao`, { preHandler: p('selecao.consultar', 'selecao.importar') }, async (request, reply) => {
    const { id, linha } = validar(LinhaSchema, request.params, 'Identificador inválido.');
    const dados = validar(ResolverLinhaSchema, request.body, 'Escolha o candidato e informe o motivo.');
    const escopo = escopoAtivoDe(request);
    return mutar(request, reply, 'selecao.resolver', (tx, autor) => resolverLinha(tx, escopo, id, linha, dados, autor, deps.agora()));
  });

  app.post(`${API_PREFIXO}/selecoes/:id/linhas/:linha/resolucao/anular`, { preHandler: p('selecao.consultar', 'selecao.importar') }, async (request, reply) => {
    const { id, linha } = validar(LinhaSchema, request.params, 'Identificador inválido.');
    const dados = validar(AnularResolucaoSchema, request.body, 'Informe o motivo da anulação.');
    const escopo = escopoAtivoDe(request);
    return mutar(request, reply, 'selecao.anular_resolucao', (tx, autor) => anularResolucao(tx, escopo, id, linha, dados, autor, deps.agora()));
  });

  // Proposta: só leitura (nada é gravado); exige quem pode importar seleção e consultar janelas.
  app.post(`${API_PREFIXO}/selecoes/:id/proposta-janela`, { preHandler: p('selecao.consultar', 'selecao.importar', 'janela.consultar') }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(PropostaJanelaEntradaSchema, request.body, 'Escolha a janela e as linhas.');
    return proposta(deps.db, escopoAtivoDe(request), id, dados);
  });

  app.post(`${API_PREFIXO}/selecoes/:id/reservar`, { preHandler: p('selecao.consultar', 'selecao.importar', 'janela.reservar') }, async (request, reply) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(ConfirmarPropostaSchema, request.body, 'Proposta inválida: revise e confirme de novo.');
    const escopo = escopoAtivoDe(request);
    return mutar(request, reply, 'selecao.reservar', (tx, autor) => reservar(tx, escopo, id, dados, autor, deps.agora()));
  });

  app.get(`${API_PREFIXO}/selecoes/:id/exportar`, { preHandler: p('selecao.consultar', 'selecao.exportar') }, async (request, reply) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const consulta = validar(ExportarSchema, request.query, 'Exportação inválida.');
    const escopo = escopoAtivoDe(request);
    const dados = await conciliarTudo(deps.db, escopo.id, id);
    const filtro = validar(FiltroConciliacaoSchema, { situacao: consulta.situacao, texto: consulta.texto }, 'Filtro inválido.');
    const termo = (filtro.texto ?? '').toUpperCase();
    const itens = dados.itens.filter(
      (i) =>
        (filtro.situacao.length === 0 || filtro.situacao.some((s) => i.situation === s || i.alsoSituations.includes(s))) &&
        (termo === '' || [i.request.palletRef, i.request.documentNumber, i.request.sku, i.lineRef].some((v) => v?.toUpperCase().includes(termo))),
    );
    const descricaoFiltro = [filtro.situacao.length > 0 ? `situação: ${filtro.situacao.join(', ')}` : null, termo ? `texto: ${termo}` : null].filter(Boolean).join('; ');
    const { conteudo, linhas } = exportarSelecao({ ...dados, itens }, consulta.tipo, descricaoFiltro, deps.agora());
    await registrarEvento(deps.db, {
      acao: 'SELECAO_EXPORTADA',
      resultado: 'SUCESSO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopo.id,
      alvoTipo: 'SELECAO_CLIENTE',
      alvoId: id,
      detalhes: { tipo: consulta.tipo, linhas, filtro: descricaoFiltro || null },
      requestId: request.id,
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('content-disposition', `attachment; filename="${nomeDownload(`${consulta.tipo}-${dados.selecao.code}`)}.csv"`)
      .send(conteudo);
  });

  // ---------- Inventários de referência ----------

  const consultarInventario = { preHandler: algum(['selecao.consultar', 'importacao.consultar']) };

  app.get(`${API_PREFIXO}/inventarios`, consultarInventario, async (request) => {
    const filtro = validar(FiltroInventariosSchema, request.query, 'Filtro inválido.');
    return listarInventarios(deps.db, escopoAtivoDe(request).id, filtro);
  });

  app.get(`${API_PREFIXO}/inventarios/:id`, consultarInventario, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    return lerInventario(deps.db, escopoAtivoDe(request).id, id);
  });

  app.get(`${API_PREFIXO}/inventarios/:id/linhas`, consultarInventario, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const filtro = validar(FiltroLinhasInventarioSchema, request.query, 'Filtro inválido.');
    return linhasDoInventario(deps.db, escopoAtivoDe(request).id, id, filtro);
  });

  app.post(`${API_PREFIXO}/inventarios/:id/conferencia-externa`, { preHandler: p('conferencia.reconciliar') }, async (request, reply) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(ReconhecerConferenciaExternaSchema, request.body, 'Informe a referência, a fonte e a data (quando conhecida) da conferência.');
    const escopo = escopoAtivoDe(request);
    return mutar(request, reply, 'inventario.conferencia_externa', (tx, autor) => reconhecerConferenciaExterna(tx, escopo, id, dados, autor, deps.agora()));
  });

  app.get(`${API_PREFIXO}/paletes/:id/documentos`, { preHandler: p('palete.consultar') }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    return notasDoPalete(deps.db, escopoAtivoDe(request).id, id);
  });
}
