import { API_PREFIXO, IncluirNotasFotoSchema, LeituraNotaFotoSchema, SalvarNotasFotoSchema, nomeArquivoSeguro } from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { descartarNota, enviarFoto, incluirNota, lerFoto, listarNotasFoto, registrarLeitura, salvarNota, type Autor } from './servico.js';

const ParametrosSchema = z.object({ id: z.uuid() });
/** A tela reduz a foto antes de enviar; a Vercel aceita até 4,5 MB por requisição. */
const MAX_FOTO = 4 * 1_048_576;

export function registrarRotasNotasFoto(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const autorDe = (request: FastifyRequest): Autor => ({ usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id });
  const idDe = (request: FastifyRequest) => validar(ParametrosSchema, request.params, 'Identificador inválido.').id;
  const LIMITES = { maxWait: 10_000, timeout: 60_000 };

  void app.register((sub, _opcoes, pronto) => {
    sub.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_FOTO }, (_request, corpo, feito) => {
      feito(null, corpo);
    });
    sub.post(`${API_PREFIXO}/paletes/:id/notas-foto/fotos`, { bodyLimit: MAX_FOTO, onRequest: [auth.autenticar, auth.exigirPermissao('palete.cadastrar')] }, async (request, reply) => {
      const escopo = escopoAtivoDe(request);
      const autor = autorDe(request);
      const paleteId = idDe(request);
      const chave = chaveIdempotencia(request);
      if (!Buffer.isBuffer(request.body)) throw requisicaoInvalida('Envie a imagem como application/octet-stream.');
      const conteudo = request.body;
      const cabecalho = request.headers['x-arquivo-nome'];
      let nome = 'foto.jpg';
      if (typeof cabecalho === 'string') {
        try {
          nome = nomeArquivoSeguro(decodeURIComponent(cabecalho));
        } catch {
          throw requisicaoInvalida('Nome do arquivo inválido.');
        }
      }
      const resultado = await executarIdempotente(
        deps.db,
        deps.config.appSegredo,
        { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'nota-foto.enviar', chave, payload: { paleteId, nome, tamanho: conteudo.length } },
        async (tx) => ({ status: 201, corpo: await enviarFoto(tx, escopo, paleteId, { nome, conteudo }, autor, deps.agora()) }),
        LIMITES,
      );
      return responder(reply, resultado);
    });
    pronto();
  });

  app.get(`${API_PREFIXO}/paletes/:id/notas-foto`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request) => listarNotasFoto(deps.db, escopoAtivoDe(request), idDe(request)));

  app.get(`${API_PREFIXO}/notas-foto/fotos/:id`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request, reply) => {
    const foto = await lerFoto(deps.db, escopoAtivoDe(request).id, idDe(request));
    if (!foto) throw naoEncontrado('Foto não encontrada neste escopo.');
    return reply.header('content-type', foto.tipo).header('cache-control', 'private, no-store').send(Buffer.from(foto.conteudo));
  });

  app.post(`${API_PREFIXO}/notas-foto/:id/leitura`, { bodyLimit: 64 * 1024, preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const id = idDe(request);
    const dados = validar(LeituraNotaFotoSchema, request.body, 'Leitura inválida.');
    return deps.db.$transaction((tx) => registrarLeitura(tx, escopo, id, dados, deps.agora()), LIMITES);
  });

  app.post(`${API_PREFIXO}/notas-foto/:id/descartar`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const id = idDe(request);
    return deps.db.$transaction((tx) => descartarNota(tx, escopo, id, autor, deps.agora()), LIMITES);
  });

  /** Cada nota na própria transação: em erro parcial, a resposta diz o que ficou salvo e o que não ficou. */
  async function porNota(ids: readonly string[], executar: (id: string) => Promise<void>) {
    const results: { id: string; ok: boolean; message: string | null }[] = [];
    for (const id of ids) {
      try {
        await executar(id);
        results.push({ id, ok: true, message: null });
      } catch (erro) {
        results.push({ id, ok: false, message: erro instanceof Error ? erro.message : 'Falha ao gravar esta nota.' });
      }
    }
    return results;
  }

  app.put(`${API_PREFIXO}/paletes/:id/notas-foto`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const paleteId = idDe(request);
    const { items } = validar(SalvarNotasFotoSchema, request.body, 'Alterações inválidas.');
    const porId = new Map(items.map((i) => [i.id, i]));
    const results = await porNota([...porId.keys()], async (id) => {
      const item = porId.get(id);
      if (item) await deps.db.$transaction((tx) => salvarNota(tx, escopo, paleteId, item, autor, deps.agora()), LIMITES);
    });
    return { results, list: await listarNotasFoto(deps.db, escopo, paleteId) };
  });

  app.post(`${API_PREFIXO}/paletes/:id/notas-foto/incluir`, { preHandler: auth.exigirPermissao('palete.cadastrar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const paleteId = idDe(request);
    const { ids } = validar(IncluirNotasFotoSchema, request.body, 'Selecione as notas.');
    const results = await porNota([...new Set(ids)], (id) => deps.db.$transaction((tx) => incluirNota(tx, escopo, paleteId, id, autor, deps.agora()), LIMITES));
    return { results, list: await listarNotasFoto(deps.db, escopo, paleteId) };
  });
}
