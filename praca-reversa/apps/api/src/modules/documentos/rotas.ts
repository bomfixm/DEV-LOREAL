import {
  API_PREFIXO,
  AprovacaoDocumentoSchema,
  CorpoVazioSchema,
  NovaMinutaSchema,
  SLUG_DOCUMENTO,
  TipoDocumentoSchema,
  type TipoDocumento,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { contextoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { aceitar, criarMinuta, documentoPublicado, listarDocumentos, publicar, registrarAprovacao, situacaoDoUsuario } from './servico.js';

const TIPO_POR_SLUG = new Map<string, TipoDocumento>(TipoDocumentoSchema.options.map((t) => [SLUG_DOCUMENTO[t], t]));
const ParamId = z.object({ id: z.uuid() });

function corpo<T>(schema: z.ZodType<T>, valor: unknown, padrao: string): T {
  const r = schema.safeParse(valor ?? {});
  if (!r.success) throw requisicaoInvalida(r.error.issues[0]?.message ?? padrao);
  return r.data;
}

function idDe(params: unknown): string {
  const r = ParamId.safeParse(params);
  if (!r.success) throw naoEncontrado('Versão de documento não encontrada.');
  return r.data.id;
}

/** Sem autenticação: só a versão aprovada e publicada (nunca minuta, autor ou contagem de aceites). */
export function registrarRotasDocumentosPublicos(app: FastifyInstance, deps: Pick<Dependencias, 'db'>): void {
  app.get(`${API_PREFIXO}/documentos-publicos/:slug`, async (request) => {
    const { slug } = request.params as { slug: string };
    const tipo = TIPO_POR_SLUG.get(slug);
    if (tipo === undefined) throw naoEncontrado('Documento não encontrado.');
    return documentoPublicado(deps.db, tipo);
  });
}

export function registrarRotasDocumentos(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const administrar = { preHandler: auth.exigirPermissao('documentos.administrar') };

  app.get(`${API_PREFIXO}/admin/documentos`, administrar, async () => listarDocumentos(deps.db, deps.documentosExigirAceite));

  app.post(`${API_PREFIXO}/admin/documentos`, administrar, async (request, reply) => {
    const dados = corpo(NovaMinutaSchema, request.body, 'Minuta inválida.');
    const id = await criarMinuta(deps.db, contextoDe(request).sessao.usuario.id, dados, request.id);
    return reply.code(201).send({ id });
  });

  app.post(`${API_PREFIXO}/admin/documentos/:id/aprovacao`, administrar, async (request) => {
    const dados = corpo(AprovacaoDocumentoSchema, request.body, 'Aprovação inválida.');
    await registrarAprovacao(deps.db, contextoDe(request).sessao.usuario.id, idDe(request.params), dados, deps.agora(), request.id);
    return listarDocumentos(deps.db, deps.documentosExigirAceite);
  });

  app.post(`${API_PREFIXO}/admin/documentos/:id/publicacao`, administrar, async (request) => {
    corpo(CorpoVazioSchema, request.body, 'A publicação não recebe dados.');
    await publicar(deps.db, contextoDe(request).sessao.usuario.id, idDe(request.params), deps.agora(), request.id);
    return listarDocumentos(deps.db, deps.documentosExigirAceite);
  });

  // Qualquer usuário autenticado: o que está publicado e o aceite dele próprio.
  app.get(`${API_PREFIXO}/documentos/situacao`, async (request) =>
    situacaoDoUsuario(deps.db, contextoDe(request).sessao.usuario.id, deps.documentosExigirAceite),
  );

  // Usuário, versão e horário vêm do servidor: o corpo é vazio (campo extra = 400).
  app.post(`${API_PREFIXO}/documentos/:id/aceite`, async (request, reply) => {
    corpo(CorpoVazioSchema, request.body, 'O aceite não recebe dados: usuário, versão e horário vêm do servidor.');
    const r = await aceitar(deps.db, contextoDe(request).sessao.usuario.id, idDe(request.params), request.id);
    return reply.code(r.repeated ? 200 : 201).send(r);
  });
}
