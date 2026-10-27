import {
  API_PREFIXO,
  ArquivoModeloSchema,
  ConfirmarImportacaoSchema,
  ConsultaEstruturaSchema,
  DescartarImportacaoSchema,
  FiltroLinhasSchema,
  FiltroLotesSchema,
  MapeamentoSchema,
  TipoImportacaoSchema,
  PERMISSOES_IMPORTACAO,
  nomeArquivoSeguro,
  tiposImportacaoPermitidos,
  type AcaoImportacao,
  type TipoImportacao,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { nomeDownload } from '../../http/csv-seguro.js';
import { ErroHttp, acessoNegado, requisicaoInvalida } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { executarIdempotente, type Resposta } from '../idempotencia/executar.js';
import { protegerAntesDaSubstituicao } from '../protecao/substituicao.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { paleteDestino, paleteDestinoParaContrato } from './bipagem.js';
import { gerarModelo, tipoDoModelo } from './modelos.js';
import { relatorioCsv } from './relatorio.js';
import {
  analisarArquivo,
  confirmar,
  consultarEstrutura,
  dadosRelatorio,
  descartar,
  detalharLote,
  gerarPrevia,
  linhasDoLote,
  listarLotes,
  registrarEnvio,
  registrarFalha,
  revalidarPrevia,
  TIPOS_PLANILHA,
  type Autor,
  type LimitesPorTipo,
} from './servico.js';

const IdSchema = z.object({ id: z.uuid() });
const EnvioSchema = z.object({ tipo: TipoImportacaoSchema, palete: z.uuid().optional() });
const NOME_CABECALHO = 'x-arquivo-nome';

/** Prévia e confirmação leem e classificam o arquivo inteiro: limites maiores que os padrões. */
const LIMITES_TRANSACAO = { maxWait: 10_000, timeout: 120_000 };

/**
 * Importação de produtos, documentos de devolução (etapa 06) e lista de
 * claims (etapa 07), com permissões por tipo (PERMISSOES_IMPORTACAO). Tudo
 * restrito ao escopo ativo: lote de outro escopo responde como inexistente.
 * O arquivo é recebido como `application/octet-stream`, com sessão, CSRF e
 * permissão conferidos antes de ler o corpo.
 */
export function registrarRotasImportacao(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const limites: LimitesPorTipo = (tipo) => (TIPOS_PLANILHA.includes(tipo) ? deps.importacaoPlanilha : deps.importacao);
  /** Corpo aceito no envio: o maior limite; o do tipo é conferido em seguida. */
  const maiorCorpo = Math.max(deps.importacao.maxBytes, deps.importacaoPlanilha.maxBytes);

  function autorDe(request: FastifyRequest): Autor {
    return { usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id };
  }

  async function negar(request: FastifyRequest, permissao: string): Promise<never> {
    await registrarEvento(deps.db, {
      acao: 'ACESSO_NEGADO',
      resultado: 'NEGADO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopoAtivoDe(request).id,
      detalhes: { permissao, metodo: request.method, rota: request.routeOptions.url ?? request.url },
      requestId: request.id,
    });
    throw acessoNegado();
  }

  /** Permissões do tipo para a ação (o arquivo não amplia o que o perfil pode fazer). */
  async function exigirTipo(request: FastifyRequest, tipo: TipoImportacao, acao: AcaoImportacao = 'executar'): Promise<void> {
    const permissoes = contextoDe(request).permissoes;
    const falta = PERMISSOES_IMPORTACAO[tipo][acao].find((p) => !permissoes.has(p));
    if (falta !== undefined) await negar(request, falta);
  }

  /** Algum tipo permitido para a ação. */
  function exigirAlgum(acao: AcaoImportacao) {
    return async function verificar(request: FastifyRequest): Promise<void> {
      escopoAtivoDe(request);
      if (tiposImportacaoPermitidos(contextoDe(request).permissoes, acao).length === 0) await negar(request, acao === 'executar' ? 'importacao.executar' : 'importacao.consultar');
    };
  }

  async function mutar(request: FastifyRequest, operacao: string, payload: unknown, executar: (tx: Transacao, autor: Autor) => Promise<Resposta>) {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    return executarIdempotente(deps.db, deps.config.appSegredo, { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao, chave, payload }, (tx) => executar(tx, autor), LIMITES_TRANSACAO);
  }

  // Envio do arquivo: autenticação e permissão antes de ler o corpo; corpo binário limitado.
  void app.register((sub, _opcoes, pronto) => {
    sub.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: maiorCorpo }, (_request, corpo, feito) => {
      feito(null, corpo);
    });
    sub.post(
      `${API_PREFIXO}/importacoes`,
      {
        bodyLimit: maiorCorpo,
        onRequest: [
          auth.autenticar,
          exigirAlgum('executar'),
          async (request) => {
            const { tipo } = validar(EnvioSchema, request.query, 'Informe o tipo da importação: PRODUTOS, DEVOLUCOES, CLAIMS, INVENTARIO, SELECAO_CLIENTE ou BIPAGEM.');
            await exigirTipo(request, tipo);
          },
        ],
      },
      async (request, reply) => {
        const escopo = escopoAtivoDe(request);
        const { tipo, palete } = validar(EnvioSchema, request.query, 'Informe o tipo da importação.');
        if (!Buffer.isBuffer(request.body)) throw requisicaoInvalida('Envie o arquivo como application/octet-stream.');
        const cabecalho = request.headers[NOME_CABECALHO];
        let nome = 'arquivo';
        if (typeof cabecalho === 'string') {
          try {
            nome = nomeArquivoSeguro(decodeURIComponent(cabecalho));
          } catch {
            throw requisicaoInvalida('Nome do arquivo inválido.');
          }
        }
        const conteudo = request.body;
        const analise = analisarArquivo(conteudo, nome, limites(tipo));
        const paleteId = tipo === 'BIPAGEM' ? (palete ?? null) : null;
        const resultado = await mutar(request, 'importacao.enviar', { tipo, nome, hash: analise.hash, palete: paleteId }, (tx, autor) =>
          registrarEnvio(tx, escopo, autor, { tipo, nomeArquivo: nome, conteudo, ...analise, paleteId }, limites, deps.agora()),
        );
        return responder(reply, resultado);
      },
    );
    pronto();
  });

  app.get(`${API_PREFIXO}/importacoes`, { preHandler: exigirAlgum('consultar') }, async (request) => {
    const filtro = validar(FiltroLotesSchema, request.query, 'Filtro inválido.');
    const permitidos = tiposImportacaoPermitidos(contextoDe(request).permissoes, 'consultar');
    if (filtro.tipo !== undefined && !permitidos.includes(filtro.tipo)) await exigirTipo(request, filtro.tipo, 'consultar');
    return listarLotes(deps.db, escopoAtivoDe(request).id, filtro, permitidos);
  });

  /** Limites configurados (para a tela de envio). */
  app.get(`${API_PREFIXO}/importacoes/limites`, { preHandler: exigirAlgum('executar') }, (request) => {
    const { tipo } = validar(z.object({ tipo: TipoImportacaoSchema.optional() }), request.query, 'Tipo de importação inválido.');
    return limites(tipo ?? 'PRODUTOS');
  });

  app.get(`${API_PREFIXO}/importacoes/modelos/:arquivo`, { preHandler: exigirAlgum('executar') }, async (request, reply) => {
    const { arquivo } = validar(z.object({ arquivo: ArquivoModeloSchema }), request.params, 'Modelo inexistente.');
    await exigirTipo(request, tipoDoModelo(arquivo));
    const { conteudo, tipoConteudo } = gerarModelo(arquivo);
    return reply
      .header('content-type', tipoConteudo)
      .header('content-disposition', `attachment; filename="modelo-${arquivo}"`)
      .send(conteudo);
  });

  /** Bipagem: palete de destino como o servidor o vê (código, posição, endereço), mostrado durante toda a importação. */
  app.get(`${API_PREFIXO}/importacoes/bipagem/destino/:id`, { preHandler: exigirAlgum('consultar') }, async (request) => {
    await exigirTipo(request, 'BIPAGEM', 'consultar');
    const { id } = validar(IdSchema, request.params, 'Identificador de palete inválido.');
    return paleteDestinoParaContrato(await paleteDestino(deps.db, escopoAtivoDe(request).id, id));
  });

  app.get(`${API_PREFIXO}/importacoes/:id`, { preHandler: exigirAlgum('consultar') }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de lote inválido.');
    const lote = await detalharLote(deps.db, escopoAtivoDe(request).id, id, limites);
    await exigirTipo(request, lote.type, 'consultar');
    return lote;
  });

  app.get(`${API_PREFIXO}/importacoes/:id/linhas`, { preHandler: exigirAlgum('consultar') }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de lote inválido.');
    const filtro = validar(FiltroLinhasSchema, request.query, 'Filtro de linhas inválido.');
    const lote = await detalharLote(deps.db, escopoAtivoDe(request).id, id, limites);
    await exigirTipo(request, lote.type, 'consultar');
    return linhasDoLote(deps.db, escopoAtivoDe(request).id, id, filtro);
  });

  app.get(`${API_PREFIXO}/importacoes/:id/estrutura`, { preHandler: exigirAlgum('executar') }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador de lote inválido.');
    const consulta = validar(ConsultaEstruturaSchema, request.query, 'Opções de leitura inválidas.');
    const escopo = escopoAtivoDe(request);
    const lote = await detalharLote(deps.db, escopo.id, id, limites);
    await exigirTipo(request, lote.type);
    return consultarEstrutura(deps.db, escopo.id, id, consulta, limites);
  });

  app.put(`${API_PREFIXO}/importacoes/:id/mapeamento`, { preHandler: exigirAlgum('executar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de lote inválido.');
    // Permissão do tipo do lote antes de ler o corpo (sem ela, 403 — não um erro de validação).
    const lote = await detalharLote(deps.db, escopo.id, id, limites);
    await exigirTipo(request, lote.type);
    const dados = validar(MapeamentoSchema, request.body, 'Mapeamento inválido.');
    const resultado = await mutar(request, 'importacao.mapear', { id, corpo: request.body }, async (tx, autor) => ({
      status: 200,
      corpo: await gerarPrevia(tx, escopo, autor, id, dados, limites, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/importacoes/:id/confirmar`, { preHandler: exigirAlgum('executar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de lote inválido.');
    const lote = await detalharLote(deps.db, escopo.id, id, limites);
    await exigirTipo(request, lote.type);
    const dados = validar(ConfirmarImportacaoSchema, request.body, 'Informe a versão da prévia revisada e confirme a revisão.');
    // Substituição do inventário ativo: planilha e backup da base atual ANTES da troca (recusa se não houver cópia verificada).
    const substitui = lote.type === 'INVENTARIO' && lote.state !== 'CONFIRMADO' ? lote.parameters?.replacesInventoryId : null;
    if (typeof substitui === 'string' && deps.planilha.protegerSubstituicao) await protegerAntesDaSubstituicao(deps.db, escopo.id, deps.planilha, autor, substitui);
    let resultado;
    try {
      resultado = await mutar(request, 'importacao.confirmar', { id, corpo: request.body }, async (tx, a) => ({
        status: 200,
        corpo: await confirmar(tx, escopo, a, id, dados, limites, deps.agora()),
      }));
    } catch (erro) {
      if (erro instanceof ErroHttp && erro.codigo === 'PREVIA_DESATUALIZADA' && dados.previewVersion === lote.previewVersion) {
        // Dados mudaram desde a revisão: a prévia é refeita (nova versão) para nova revisão.
        await revalidarPrevia(deps.db, escopo, autor, id, limites, deps.agora()).catch((falha: unknown) => {
          request.log.error({ err: falha }, 'Falha ao revalidar a prévia');
        });
      } else if (!(erro instanceof ErroHttp)) {
        // Falha inesperada: a transação foi desfeita inteira; o histórico registra o estado real.
        await registrarFalha(deps.db, escopo, autor, id, deps.agora()).catch((falha: unknown) => {
          request.log.error({ err: falha }, 'Falha ao registrar a falha da importação');
        });
      }
      throw erro;
    }
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/importacoes/:id/descartar`, { preHandler: exigirAlgum('executar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de lote inválido.');
    const lote = await detalharLote(deps.db, escopo.id, id, limites);
    await exigirTipo(request, lote.type);
    const dados = validar(DescartarImportacaoSchema, request.body, 'Informe a versão do lote.');
    const resultado = await mutar(request, 'importacao.descartar', { id, corpo: request.body }, async (tx, autor) => ({
      status: 200,
      corpo: await descartar(tx, escopo, autor, id, dados.expectedVersion, limites, deps.agora()),
    }));
    return responder(reply, resultado);
  });

  app.get(`${API_PREFIXO}/importacoes/:id/relatorio.csv`, { preHandler: exigirAlgum('consultar') }, async (request, reply: FastifyReply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador de lote inválido.');
    const dados = await dadosRelatorio(deps.db, escopo.id, id);
    await exigirTipo(request, dados.lote.type, 'consultar');
    await registrarEvento(deps.db, {
      acao: 'IMPORTACAO_RELATORIO_BAIXADO',
      resultado: 'SUCESSO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopo.id,
      alvoTipo: 'LOTE_IMPORTACAO',
      alvoId: id,
      detalhes: { linhas: dados.linhas.length },
      requestId: request.id,
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nomeDownload(`relatorio-importacao-${id.slice(0, 8)}`)}.csv"`)
      .send(relatorioCsv(dados, deps.agora()));
  });
}
