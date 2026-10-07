import {
  API_PREFIXO,
  AlterarClaimSchema,
  AnularResultadoSchema,
  CriarClaimSchema,
  DescartarCandidatoSchema,
  EncerrarClaimSchema,
  EstornarRecuperacaoSchema,
  FiltroCandidatosSchema,
  FiltroClaimsSchema,
  FiltroHistoricoClaimSchema,
  ROTULOS_MOTIVO_CLAIM,
  ROTULOS_SITUACAO_CLAIM,
  ReabrirClaimSchema,
  RegistrarCandidatoSchema,
  RegistrarEvidenciaSchema,
  RegistrarResultadoSchema,
  RejeitarValidacaoSchema,
  SolicitarConferenciaSchema,
  SolicitarValidacaoSchema,
  TransicaoClaimSchema,
  ValidarRecuperacaoSchema,
  nomeArquivoSeguro,
  type FiltroClaims,
  type QuantidadePorUnidade,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { celulaCsv, documentoCsv, nomeDownload } from '../../http/csv-seguro.js';
import { ErroHttp, requisicaoInvalida } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { candidatosDaLinha, descartarCandidato, registrarCandidato, solicitarConferencia } from './candidatos.js';
import { enviarAnexo, estornarRecuperacao, lerAnexo, registrarEvidencia, rejeitarValidacao, solicitarValidacao, validarRecuperacao } from './evidencias.js';
import { claimsParaExportar, detalheClaim, historicoClaim, listarClaims, responsaveisDoEscopo, resumirClaims } from './leitura.js';
import { anularResultado, registrarResultado } from './resultados.js';
import { alterarClaim, criarClaim, encerrarClaim, mudarSituacao, reabrirClaim, type Autor } from './servico.js';

const IdSchema = z.object({ id: z.uuid() });
const LinhaSchema = z.object({ id: z.uuid(), linhaId: z.uuid() });
const SubSchema = z.object({ id: z.uuid(), sub: z.uuid() });
const NOME_CABECALHO = 'x-arquivo-nome';
const LIMITES_TRANSACAO = { maxWait: 10_000, timeout: 30_000 };
const DATA_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

function textoUnidades(lista: readonly QuantidadePorUnidade[]): string {
  return lista.map((q) => `${q.quantity.replace('.', ',')} ${q.unit}`).join(' | ');
}

function textoValores(lista: readonly { currency: string; value: string }[]): string {
  return lista.map((v) => `${v.value.replace('.', ',')} ${v.currency}`).join(' | ');
}

function descreverFiltro(f: FiltroClaims): string {
  const partes: string[] = [];
  if (f.texto) partes.push(`texto: ${f.texto}`);
  if (f.motivo) partes.push(`motivo: ${ROTULOS_MOTIVO_CLAIM[f.motivo]}`);
  if (f.situacao && f.situacao.length > 0) partes.push(`situação: ${f.situacao.map((s) => ROTULOS_SITUACAO_CLAIM[s]).join(', ')}`);
  if (f.responsavel) partes.push(`responsável: ${f.responsavel === 'NENHUM' ? 'sem responsável' : f.responsavel}`);
  if (f.prazo) partes.push(`prazo: ${f.prazo}`);
  if (f.sku) partes.push(`SKU: ${f.sku}`);
  if (f.origem) partes.push(`origem: ${f.origem}`);
  if (f.pendencia) partes.push(`pendência: ${f.pendencia}`);
  if (f.prioridade) partes.push(`prioridade: ${f.prioridade}`);
  return partes.length === 0 ? 'nenhum' : partes.join('; ');
}

/**
 * Claims (etapa 07). Permissões conferidas no servidor por ação, sempre no
 * escopo ativo (registro de outro escopo responde como inexistente):
 * - claim.consultar: lista, resumo, detalhe, candidatos, histórico, anexos;
 * - claim.tratar: cadastro, edição, situação, candidatos, evidências,
 *   anexos, solicitação de validação e exportação;
 * - claim.validar: validar/rejeitar recuperação, estornar, encerrar, reabrir;
 * - claim.aprovar_financeiro (concessão explícita): resultados.
 */
export function registrarRotasClaims(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const consultar = auth.exigirPermissao('claim.consultar');
  const tratar = [auth.exigirPermissao('claim.consultar'), auth.exigirPermissao('claim.tratar')];
  const validarPerm = [auth.exigirPermissao('claim.consultar'), auth.exigirPermissao('claim.validar')];
  const financeiro = [auth.exigirPermissao('claim.consultar'), auth.exigirPermissao('claim.aprovar_financeiro')];

  function autorDe(request: FastifyRequest): Autor {
    return { usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id };
  }

  async function mutar<T>(request: FastifyRequest, operacao: string, payload: unknown, executar: (tx: Transacao, autor: Autor) => Promise<T>) {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    return executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao, chave, payload },
      async (tx) => ({ status: 200, corpo: (await executar(tx, autor)) as never }),
      LIMITES_TRANSACAO,
    );
  }

  app.get(`${API_PREFIXO}/claims`, { preHandler: consultar }, async (request) => {
    const filtro = validar(FiltroClaimsSchema, request.query, 'Filtro inválido.');
    return listarClaims(deps.db, escopoAtivoDe(request), filtro, deps.claims.ordemPadrao, deps.agora());
  });

  app.get(`${API_PREFIXO}/claims/resumo`, { preHandler: consultar }, async (request) => {
    const filtro = validar(FiltroClaimsSchema, request.query, 'Filtro inválido.');
    return resumirClaims(deps.db, escopoAtivoDe(request), filtro, deps.agora());
  });

  app.get(`${API_PREFIXO}/claims/responsaveis`, { preHandler: consultar }, async (request) => ({ items: await responsaveisDoEscopo(deps.db, escopoAtivoDe(request).id) }));

  app.get(`${API_PREFIXO}/claims/exportar`, { preHandler: tratar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const filtro = validar(FiltroClaimsSchema, request.query, 'Filtro inválido.');
    const limite = deps.exportacaoMaxLinhas;
    const agora = deps.agora();
    const { itens, total } = await claimsParaExportar(deps.db, escopo, filtro, deps.claims.ordemPadrao, limite, agora);
    await registrarEvento(deps.db, {
      acao: 'CLAIM_EXPORTADO',
      resultado: 'SUCESSO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopo.id,
      detalhes: { linhas: itens.length, total, limitada: total > itens.length },
      requestId: request.id,
    });
    const topo = [
      [celulaCsv('Exportação de claims — Praça Reversa')],
      [celulaCsv('Escopo'), celulaCsv(`${escopo.name}${escopo.demo ? ' (demonstração, dados fictícios)' : ''}`)],
      [celulaCsv('Filtros'), celulaCsv(descreverFiltro(filtro))],
      [celulaCsv('Gerado em'), celulaCsv(`${DATA_HORA.format(agora)} (horário de Brasília)`)],
      [celulaCsv('Linhas'), celulaCsv(total > itens.length ? `${String(itens.length)} de ${String(total)} (limitado a ${String(limite)}: refine os filtros)` : String(itens.length))],
      [
        celulaCsv('Bases'),
        celulaCsv(
          'Estimado em análise não é valor evitado. Recuperação física validada, valor evitado confirmado e perda confirmada são registros distintos. Unidades e moedas diferentes não se somam (separadas por |).',
        ),
      ],
      [],
      [
        'Código',
        'Referência externa',
        'Motivo',
        'Situação',
        'Prioridade',
        'Prazo',
        'Responsável',
        'Linhas',
        'Primeiro SKU',
        'Quantidade em análise',
        'Recuperação física validada',
        'Sem recuperação física validada',
        'Valor estimado em análise',
        'Moeda da estimativa',
        'Estimativa parcial',
        'Valor evitado confirmado',
        'Perda confirmada',
        'Validações pendentes',
        'Cobrança finalizada',
        'Em triagem',
      ].map((c) => celulaCsv(c)),
    ];
    const linhas = itens.map(({ resumo: r, semRecuperacao, evitado, perda }) => [
      celulaCsv(r.code),
      celulaCsv(r.externalReference ?? 'não informada'),
      celulaCsv(ROTULOS_MOTIVO_CLAIM[r.reason]),
      celulaCsv(ROTULOS_SITUACAO_CLAIM[r.state]),
      celulaCsv(r.priority ?? 'não definida'),
      celulaCsv(r.deadline ?? 'não informado'),
      celulaCsv(r.responsible?.login ?? 'sem responsável'),
      String(r.lineCount),
      celulaCsv(r.firstSku),
      celulaCsv(textoUnidades(r.inAnalysis)),
      celulaCsv(textoUnidades(r.validatedRecovery)),
      celulaCsv(textoUnidades(semRecuperacao)),
      r.estimated === null ? '' : r.estimated.replace('.', ','),
      celulaCsv(r.currency),
      r.estimatePartial ? 'sim' : 'não',
      celulaCsv(textoValores(evitado)),
      celulaCsv(textoValores(perda)),
      String(r.pendingValidations),
      r.chargeFinalized ? 'sim' : 'não',
      r.triage ? 'sim' : 'não',
    ]);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nomeDownload(`claims-${agora.toISOString().slice(0, 16).replace(/[:T]/g, '')}`)}.csv"`)
      .send(documentoCsv([...topo, ...linhas]));
  });

  app.post(`${API_PREFIXO}/claims`, { preHandler: tratar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const dados = validar(CriarClaimSchema, request.body, 'Dados do claim inválidos.');
    const resultado = await mutar(request, 'claim.criar', request.body, (tx, autor) => criarClaim(tx, escopo, dados, autor, deps.agora()));
    return responder(reply, resultado);
  });

  app.get(`${API_PREFIXO}/claims/:id`, { preHandler: consultar }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    return detalheClaim(deps.db, escopoAtivoDe(request).id, id, deps.agora());
  });

  app.put(`${API_PREFIXO}/claims/:id`, { preHandler: tratar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(AlterarClaimSchema, request.body, 'Dados do claim inválidos.');
    return responder(reply, await mutar(request, 'claim.alterar', { id, corpo: request.body }, (tx, autor) => alterarClaim(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/claims/:id/situacao`, { preHandler: tratar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(TransicaoClaimSchema, request.body, 'Situação inválida.');
    return responder(reply, await mutar(request, 'claim.situacao', { id, corpo: request.body }, (tx, autor) => mudarSituacao(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/claims/:id/encerrar`, { preHandler: validarPerm }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(EncerrarClaimSchema, request.body, 'Decisão de encerramento inválida.');
    return responder(reply, await mutar(request, 'claim.encerrar', { id, corpo: request.body }, (tx, autor) => encerrarClaim(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/claims/:id/reabrir`, { preHandler: validarPerm }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(ReabrirClaimSchema, request.body, 'Reabertura inválida.');
    return responder(reply, await mutar(request, 'claim.reabrir', { id, corpo: request.body }, (tx, autor) => reabrirClaim(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.get(`${API_PREFIXO}/claims/:id/historico`, { preHandler: consultar }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const filtro = validar(FiltroHistoricoClaimSchema, request.query, 'Página inválida.');
    return historicoClaim(deps.db, escopoAtivoDe(request).id, id, filtro.pagina, filtro.tamanho);
  });

  app.get(`${API_PREFIXO}/claims/:id/linhas/:linhaId/candidatos`, { preHandler: consultar }, async (request) => {
    const { id, linhaId } = validar(LinhaSchema, request.params, 'Identificador inválido.');
    const filtro = validar(FiltroCandidatosSchema, request.query, 'Página inválida.');
    return candidatosDaLinha(deps.db, escopoAtivoDe(request), id, linhaId, filtro.pagina, filtro.tamanho, deps.agora());
  });

  app.post(`${API_PREFIXO}/claims/:id/candidatos`, { preHandler: tratar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(RegistrarCandidatoSchema, request.body, 'Candidato inválido.');
    return responder(reply, await mutar(request, 'claim.candidato', { id, corpo: request.body }, (tx, autor) => registrarCandidato(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/claims/:id/candidatos/:sub/conferencia`, { preHandler: tratar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id, sub } = validar(SubSchema, request.params, 'Identificador inválido.');
    const dados = validar(SolicitarConferenciaSchema, request.body, 'Solicitação inválida.');
    return responder(
      reply,
      await mutar(request, 'claim.conferencia', { id, sub, corpo: request.body }, (tx, autor) => solicitarConferencia(tx, escopo, id, sub, dados, autor, deps.agora())),
    );
  });

  app.post(`${API_PREFIXO}/claims/:id/candidatos/:sub/descartar`, { preHandler: tratar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id, sub } = validar(SubSchema, request.params, 'Identificador inválido.');
    const dados = validar(DescartarCandidatoSchema, request.body, 'Descarte inválido.');
    return responder(
      reply,
      await mutar(request, 'claim.descartar', { id, sub, corpo: request.body }, (tx, autor) => descartarCandidato(tx, escopo, id, sub, dados, autor, deps.agora())),
    );
  });

  // Anexo: sessão, CSRF e permissão conferidos antes de ler o corpo; corpo binário limitado.
  void app.register((sub, _opcoes, pronto) => {
    sub.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: deps.claims.anexoMaxBytes }, (_request, corpo, feito) => {
      feito(null, corpo);
    });
    sub.post(
      `${API_PREFIXO}/claims/:id/anexos`,
      { bodyLimit: deps.claims.anexoMaxBytes, onRequest: [auth.autenticar, auth.exigirPermissao('claim.consultar'), auth.exigirPermissao('claim.tratar')] },
      async (request, reply) => {
        const escopo = escopoAtivoDe(request);
        const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
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
        const resultado = await mutar(request, 'claim.anexo', { id, nome, tamanho: conteudo.length }, (tx, autor) =>
          enviarAnexo(tx, escopo, id, nome, conteudo, deps.claims.anexoMaxBytes, autor, deps.agora()),
        );
        return responder(reply, resultado);
      },
    );
    pronto();
  });

  app.get(`${API_PREFIXO}/claims/:id/anexos/:sub`, { preHandler: consultar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id, sub } = validar(SubSchema, request.params, 'Identificador inválido.');
    const anexo = await lerAnexo(deps.db, escopo.id, id, sub);
    await registrarEvento(deps.db, {
      acao: 'CLAIM_ANEXO_BAIXADO',
      resultado: 'SUCESSO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopo.id,
      alvoTipo: 'CLAIM',
      alvoId: id,
      detalhes: { anexo: sub },
      requestId: request.id,
    });
    const extensao = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[anexo.tipoConteudo] ?? 'bin';
    const base = nomeDownload(anexo.nome.replace(/\.[A-Za-z0-9]{1,5}$/, '')) || 'anexo';
    return reply
      .header('content-type', anexo.tipoConteudo)
      .header('content-disposition', `attachment; filename="${base}.${extensao}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(Buffer.from(anexo.conteudo));
  });

  app.post(`${API_PREFIXO}/claims/:id/evidencias`, { preHandler: tratar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(RegistrarEvidenciaSchema, request.body, 'Evidência inválida.');
    return responder(reply, await mutar(request, 'claim.evidencia', { id, corpo: request.body }, (tx, autor) => registrarEvidencia(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/claims/:id/evidencias/:sub/solicitar-validacao`, { preHandler: tratar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id, sub } = validar(SubSchema, request.params, 'Identificador inválido.');
    const dados = validar(SolicitarValidacaoSchema, request.body, 'Solicitação inválida.');
    return responder(
      reply,
      await mutar(request, 'claim.solicitar_validacao', { id, sub, corpo: request.body }, (tx, autor) => solicitarValidacao(tx, escopo, id, sub, dados, autor, deps.agora())),
    );
  });

  app.post(`${API_PREFIXO}/claims/:id/evidencias/:sub/validar`, { preHandler: validarPerm }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id, sub } = validar(SubSchema, request.params, 'Identificador inválido.');
    const dados = validar(ValidarRecuperacaoSchema, request.body, 'Validação inválida.');
    let resultado;
    try {
      resultado = await mutar(request, 'claim.validar', { id, sub, corpo: request.body }, (tx, autor) => validarRecuperacao(tx, escopo, id, sub, dados, autor, deps.agora()));
    } catch (erro) {
      // Tentativa recusada por regra: auditada fora da transação desfeita.
      if (erro instanceof ErroHttp && (erro.codigo === 'RECUPERACAO_BLOQUEADA' || erro.codigo === 'QUANTIDADE_INDISPONIVEL')) {
        await registrarEvento(deps.db, {
          acao: 'CLAIM_VALIDACAO_RECUSADA',
          resultado: 'NEGADO',
          atorUsuarioId: contextoDe(request).sessao.usuario.id,
          escopoId: escopo.id,
          alvoTipo: 'CLAIM',
          alvoId: id,
          detalhes: { evidencia: sub, codigo: erro.codigo },
          requestId: request.id,
        }).catch((falha: unknown) => {
          request.log.error({ err: falha }, 'Falha ao auditar validação recusada');
        });
      }
      throw erro;
    }
    return responder(reply, resultado);
  });

  app.post(`${API_PREFIXO}/claims/:id/evidencias/:sub/rejeitar`, { preHandler: validarPerm }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id, sub } = validar(SubSchema, request.params, 'Identificador inválido.');
    const dados = validar(RejeitarValidacaoSchema, request.body, 'Rejeição inválida.');
    return responder(reply, await mutar(request, 'claim.rejeitar', { id, sub, corpo: request.body }, (tx, autor) => rejeitarValidacao(tx, escopo, id, sub, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/claims/:id/recuperacoes/:sub/estornar`, { preHandler: validarPerm }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id, sub } = validar(SubSchema, request.params, 'Identificador inválido.');
    const dados = validar(EstornarRecuperacaoSchema, request.body, 'Estorno inválido.');
    return responder(reply, await mutar(request, 'claim.estornar', { id, sub, corpo: request.body }, (tx, autor) => estornarRecuperacao(tx, escopo, id, sub, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/claims/:id/resultados`, { preHandler: financeiro }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(RegistrarResultadoSchema, request.body, 'Resultado inválido.');
    return responder(reply, await mutar(request, 'claim.resultado', { id, corpo: request.body }, (tx, autor) => registrarResultado(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/claims/:id/resultados/:sub/anular`, { preHandler: financeiro }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id, sub } = validar(SubSchema, request.params, 'Identificador inválido.');
    const dados = validar(AnularResultadoSchema, request.body, 'Anulação inválida.');
    return responder(reply, await mutar(request, 'claim.anular_resultado', { id, sub, corpo: request.body }, (tx, autor) => anularResultado(tx, escopo, id, sub, dados, autor, deps.agora())));
  });

}
