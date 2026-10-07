import {
  API_PREFIXO,
  AlterarJanelaSchema,
  CancelarReservaSchema,
  ConfirmarExpedicaoSchema,
  ConfirmarJanelaSchema,
  CorrigirExpedicaoSchema,
  CriarJanelaSchema,
  CriarReservaSchema,
  EncerrarJanelaSchema,
  FiltroHistoricoJanelaSchema,
  FiltroJanelasSchema,
  FiltroMaterialSchema,
  LiberacaoMaterialSchema,
  ROTULOS_BASE_PESO,
  ROTULOS_METRICA,
  ROTULOS_SITUACAO_JANELA,
  RegistrarPreparacaoSchema,
  RegistrarRetornoSchema,
  nomeArquivoSeguro,
  type Permissao,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { celulaCsv, documentoCsv, nomeDownload, quantidadeCsv } from '../../http/csv-seguro.js';
import { acessoNegado, requisicaoInvalida } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { responsaveisExpedicao, type Autor } from './comum.js';
import { confirmarExpedicao, corrigirExpedicao, registrarRetorno } from './expedicao.js';
import { detalheExpedicao, detalheJanela, detalheReserva, filaMaterial, fusoDoEscopo, historicoJanela, listarJanelas } from './leitura.js';
import { alterarLiberacao, historicoLiberacao } from './liberacao.js';
import { cancelarReserva, criarReserva, previaReserva, registrarPreparacao } from './reservas.js';
import { alterarJanela, confirmarJanela, criarJanela, encerrarJanela, enviarAnexoJanela, lerAnexoJanela } from './servico.js';

const IdSchema = z.object({ id: z.uuid() });
const SubSchema = z.object({ id: z.uuid(), sub: z.uuid() });
const NOME_CABECALHO = 'x-arquivo-nome';
const LIMITES_TRANSACAO = { maxWait: 10_000, timeout: 30_000 };
const ROTULOS_ORIGEM_CSV = { DEVOLUCAO: 'Devolução', NOTA_FISCAL: 'Nota fiscal', MANIFESTO: 'Manifesto', OUTRO: 'Outro' } as const;
const ROTULOS_CONDICAO_CSV = { SAUDAVEL: 'Saudável', AVARIADO: 'Avariado', EM_AVALIACAO: 'Em avaliação' } as const;

/**
 * Janelas, liberação, reservas, preparação, expedição e retorno (etapa 08).
 * Permissões conferidas no servidor por ação, sempre no escopo ativo
 * (registro de outro escopo responde como inexistente):
 * - janela.consultar: listas, detalhes, filas de material, histórico, anexos;
 * - janela.gerenciar: cadastrar, alterar, confirmar, encerrar, cancelar;
 * - material.liberar: liberar/revogar/bloquear/desbloquear material e palete;
 * - janela.reservar: prévia, reserva e cancelamento de reserva;
 * - expedicao.preparar: separação e medidas;
 * - expedicao.confirmar: confirmar saída e corrigir informação;
 * - expedicao.retorno: retorno físico/aviso;
 * - janela.exportar: CSV da lista de preparação e do resumo das janelas.
 */
export function registrarRotasJanelas(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const p = (...lista: Permissao[]) => lista.map((x) => auth.exigirPermissao(x));
  const consultar = p('janela.consultar');

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

  async function mutar<T>(request: FastifyRequest, operacao: string, payload: unknown, executar: (tx: Transacao, autor: Autor) => Promise<T>) {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    return executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao, chave: chaveIdempotencia(request), payload },
      async (tx) => ({ status: 200, corpo: (await executar(tx, autor)) as never }),
      LIMITES_TRANSACAO,
    );
  }

  // ---------- Janelas ----------

  app.get(`${API_PREFIXO}/janelas`, { preHandler: consultar }, async (request) => {
    const filtro = validar(FiltroJanelasSchema, request.query, 'Filtro inválido.');
    return listarJanelas(deps.db, escopoAtivoDe(request), filtro, deps.agora());
  });

  app.get(`${API_PREFIXO}/janelas/responsaveis`, { preHandler: consultar }, async (request) => ({ items: await responsaveisExpedicao(deps.db, escopoAtivoDe(request).id) }));

  app.get(`${API_PREFIXO}/janelas/exportar`, { preHandler: p('janela.consultar', 'janela.exportar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const filtro = validar(FiltroJanelasSchema, request.query, 'Filtro inválido.');
    const agora = deps.agora();
    const pagina = await listarJanelas(deps.db, escopo, { ...filtro, pagina: 1, tamanho: 100 }, agora);
    const fuso = await fusoDoEscopo(deps.db, escopo.id);
    const dataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, dateStyle: 'short', timeStyle: 'short' });
    await registrarEvento(deps.db, {
      acao: 'JANELA_EXPORTADA',
      resultado: 'SUCESSO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopo.id,
      detalhes: { linhas: pagina.items.length, total: pagina.total },
      requestId: request.id,
    });
    const topo = [
      [celulaCsv('Janelas de devolução — Praça Reversa')],
      [celulaCsv('Escopo'), celulaCsv(`${escopo.name}${escopo.demo ? ' (demonstração, dados fictícios)' : ''}`)],
      [celulaCsv('Filtros'), celulaCsv([filtro.mes ? `mês ${filtro.mes}` : '', filtro.situacao ? `situação ${ROTULOS_SITUACAO_JANELA[filtro.situacao]}` : '', filtro.texto ? `texto ${filtro.texto}` : ''].filter(Boolean).join('; ') || 'nenhum')],
      [celulaCsv('Gerado em'), celulaCsv(`${dataHora.format(agora)} (${fuso})`)],
      [celulaCsv('Linhas'), celulaCsv(pagina.total > pagina.items.length ? `${String(pagina.items.length)} de ${String(pagina.total)} (refine os filtros)` : String(pagina.items.length))],
      [celulaCsv('Bases'), celulaCsv('Uma linha por janela × restrição. Restante = limite − reservado ativo − expedido. Limite pendente não é ilimitado. Consolidar paletes não é volume expedido.')],
      [],
      ['Código', 'Nome', 'Referência do cliente', 'Mês', 'Situação', 'Saída (início)', 'Saída (fim)', 'Métrica', 'Unidade', 'Limite', 'Reservado ativo', 'Expedido', 'Restante', 'Reservas ativas', 'Expedições', 'Pendências'].map((c) => celulaCsv(c)),
    ];
    const linhas = pagina.items.flatMap((j) => {
      const base = [
        celulaCsv(j.code),
        celulaCsv(j.name),
        celulaCsv(j.clientReference),
        celulaCsv(j.referenceMonth),
        celulaCsv(ROTULOS_SITUACAO_JANELA[j.state]),
        celulaCsv(j.exitStart ? dataHora.format(new Date(j.exitStart)) : 'pendente'),
        celulaCsv(j.exitEnd ? dataHora.format(new Date(j.exitEnd)) : 'pendente'),
      ];
      const fim = [String(j.activeReservations), String(j.expeditions), celulaCsv(j.pendencies.join(' | '))];
      if (j.restrictions.length === 0) return [[...base, celulaCsv('nenhuma restrição'), '', '', '', '', '', ...fim]];
      return j.restrictions.map((r) => [
        ...base,
        celulaCsv(`${ROTULOS_METRICA[r.metric]}${r.weightBase ? ` ${ROTULOS_BASE_PESO[r.weightBase]}` : ''}`),
        celulaCsv(r.unit),
        r.limit === null ? celulaCsv('pendente') : quantidadeCsv(r.limit),
        quantidadeCsv(r.reserved),
        quantidadeCsv(r.shipped),
        r.remaining === null ? celulaCsv('pendente') : quantidadeCsv(r.remaining),
        ...fim,
      ]);
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nomeDownload(`janelas-${agora.toISOString().slice(0, 16).replace(/[:T]/g, '')}`)}.csv"`)
      .send(documentoCsv([...topo, ...linhas]));
  });

  app.post(`${API_PREFIXO}/janelas`, { preHandler: p('janela.consultar', 'janela.gerenciar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const dados = validar(CriarJanelaSchema, request.body, 'Dados da janela inválidos.');
    return responder(reply, await mutar(request, 'janela.criar', request.body, (tx, autor) => criarJanela(tx, escopo, dados, autor, deps.agora())));
  });

  app.get(`${API_PREFIXO}/janelas/:id`, { preHandler: consultar }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    return detalheJanela(deps.db, escopo, id, deps.agora(), await fusoDoEscopo(deps.db, escopo.id));
  });

  app.put(`${API_PREFIXO}/janelas/:id`, { preHandler: p('janela.consultar', 'janela.gerenciar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(AlterarJanelaSchema, request.body, 'Dados da janela inválidos.');
    return responder(reply, await mutar(request, 'janela.alterar', { id, corpo: request.body }, (tx, autor) => alterarJanela(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/janelas/:id/confirmar`, { preHandler: p('janela.consultar', 'janela.gerenciar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(ConfirmarJanelaSchema, request.body, 'Confirmação inválida.');
    return responder(reply, await mutar(request, 'janela.confirmar', { id, corpo: request.body }, (tx, autor) => confirmarJanela(tx, escopo, id, dados.expectedVersion, autor, deps.agora())));
  });

  for (const [acao, destino] of [
    ['encerrar', 'ENCERRADA'],
    ['cancelar', 'CANCELADA'],
  ] as const) {
    app.post(`${API_PREFIXO}/janelas/:id/${acao}`, { preHandler: p('janela.consultar', 'janela.gerenciar') }, async (request, reply) => {
      const escopo = escopoAtivoDe(request);
      const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
      const dados = validar(EncerrarJanelaSchema, request.body, 'Informe o motivo.');
      return responder(reply, await mutar(request, `janela.${acao}`, { id, corpo: request.body }, (tx, autor) => encerrarJanela(tx, escopo, id, destino, dados, autor, deps.agora())));
    });
  }

  app.get(`${API_PREFIXO}/janelas/:id/historico`, { preHandler: consultar }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const filtro = validar(FiltroHistoricoJanelaSchema, request.query, 'Página inválida.');
    return historicoJanela(deps.db, escopoAtivoDe(request).id, id, filtro.pagina, filtro.tamanho);
  });

  // Anexo: sessão, CSRF e permissão conferidos antes de ler o corpo; corpo binário limitado.
  void app.register((sub, _opcoes, pronto) => {
    sub.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: deps.claims.anexoMaxBytes }, (_request, corpo, feito) => {
      feito(null, corpo);
    });
    sub.post(
      `${API_PREFIXO}/janelas/:id/anexos`,
      {
        bodyLimit: deps.claims.anexoMaxBytes,
        onRequest: [auth.autenticar, auth.exigirPermissao('janela.consultar'), algum(['janela.gerenciar', 'expedicao.preparar', 'expedicao.confirmar', 'expedicao.retorno'])],
      },
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
        return responder(
          reply,
          await mutar(request, 'janela.anexo', { id, nome, tamanho: conteudo.length }, (tx, autor) =>
            enviarAnexoJanela(tx, escopo, id, nome, conteudo, deps.claims.anexoMaxBytes, autor, deps.agora()),
          ),
        );
      },
    );
    pronto();
  });

  app.get(`${API_PREFIXO}/janelas/:id/anexos/:sub`, { preHandler: consultar }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id, sub } = validar(SubSchema, request.params, 'Identificador inválido.');
    const anexo = await lerAnexoJanela(deps.db, escopo.id, id, sub);
    await registrarEvento(deps.db, {
      acao: 'JANELA_ANEXO_BAIXADO',
      resultado: 'SUCESSO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopo.id,
      alvoTipo: 'JANELA',
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

  // ---------- Material e liberação ----------

  app.get(`${API_PREFIXO}/material-expedicao`, { preHandler: consultar }, async (request) => {
    const filtro = validar(FiltroMaterialSchema, request.query, 'Filtro inválido.');
    return filaMaterial(deps.db, escopoAtivoDe(request), filtro, deps.agora());
  });

  app.get(`${API_PREFIXO}/paletes/:id/liberacao`, { preHandler: p('palete.consultar') }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    return { items: await historicoLiberacao(deps.db, escopoAtivoDe(request).id, id) };
  });

  app.post(`${API_PREFIXO}/paletes/:id/liberacao`, { preHandler: p('palete.consultar', 'material.liberar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(LiberacaoMaterialSchema, request.body, 'Dados da liberação inválidos.');
    return responder(reply, await mutar(request, 'material.liberacao', { id, corpo: request.body }, (tx, autor) => alterarLiberacao(tx, escopo, id, dados, autor, deps.agora())));
  });

  // ---------- Reservas ----------

  app.post(`${API_PREFIXO}/janelas/:id/reservas/previa`, { preHandler: p('janela.consultar', 'janela.reservar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(CriarReservaSchema, request.body, 'Seleção inválida.');
    return previaReserva(deps.db, escopo, id, dados);
  });

  app.post(`${API_PREFIXO}/janelas/:id/reservas`, { preHandler: p('janela.consultar', 'janela.reservar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(CriarReservaSchema, request.body, 'Seleção inválida.');
    return responder(reply, await mutar(request, 'reserva.criar', { id, corpo: request.body }, (tx, autor) => criarReserva(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.get(`${API_PREFIXO}/reservas/:id`, { preHandler: consultar }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    return detalheReserva(deps.db, escopoAtivoDe(request), id, deps.agora());
  });

  app.post(`${API_PREFIXO}/reservas/:id/cancelar`, { preHandler: p('janela.consultar', 'janela.reservar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(CancelarReservaSchema, request.body, 'Informe o motivo.');
    return responder(reply, await mutar(request, 'reserva.cancelar', { id, corpo: request.body }, (tx, autor) => cancelarReserva(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/reservas/:id/preparacao`, { preHandler: p('janela.consultar', 'expedicao.preparar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(RegistrarPreparacaoSchema, request.body, 'Preparação inválida.');
    return responder(reply, await mutar(request, 'reserva.preparacao', { id, corpo: request.body }, (tx, autor) => registrarPreparacao(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.get(`${API_PREFIXO}/reservas/:id/preparacao.csv`, { preHandler: p('janela.consultar', 'janela.exportar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const agora = deps.agora();
    const r = await detalheReserva(deps.db, escopo, id, agora);
    const fuso = await fusoDoEscopo(deps.db, escopo.id);
    const dataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, dateStyle: 'short', timeStyle: 'short' });
    await registrarEvento(deps.db, {
      acao: 'PREPARACAO_EXPORTADA',
      resultado: 'SUCESSO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopo.id,
      alvoTipo: 'RESERVA',
      alvoId: id,
      detalhes: { codigo: r.code, linhas: r.lines.length },
      requestId: request.id,
    });
    const medidas = new Map(r.loadUnits.map((u) => [u.palletId, u]));
    const topo = [
      [celulaCsv('Lista de preparação — documento operacional interno (Praça Reversa)')],
      [celulaCsv('Escopo'), celulaCsv(`${escopo.name}${escopo.demo ? ' (demonstração, dados fictícios)' : ''}`)],
      [celulaCsv('Janela'), celulaCsv(`${r.window.code} — ${r.window.name}`)],
      [celulaCsv('Reserva'), celulaCsv(`${r.code} (${r.state})`)],
      [celulaCsv('Saída autorizada'), celulaCsv(r.window.exitStart ? `${dataHora.format(new Date(r.window.exitStart))} a ${dataHora.format(new Date(r.window.exitEnd ?? r.window.exitStart))}` : 'pendente')],
      [celulaCsv('Documentos exigidos'), celulaCsv(r.requiredDocuments.join(' | ') || 'nenhum informado')],
      [celulaCsv('Gerado em'), celulaCsv(`${dataHora.format(agora)} (${fuso})`)],
      [celulaCsv('Observação'), celulaCsv('Preparar não baixa estoque nem confirma saída. Endereço atual pode diferir do registrado na reserva.')],
      [],
      [
        'Palete',
        'Endereço atual',
        'Endereço na reserva',
        'Unidade de carga',
        'SKU',
        'Descrição',
        'Lote',
        'Origem',
        'Quantidade',
        'Unidade',
        'Condição',
        'Separado',
        'Caixas',
        'Peso (kg)',
        'Base do peso',
        'Volume (m³)',
        'Fonte da medida',
        'Impedimentos atuais',
      ].map((c) => celulaCsv(c)),
    ];
    const linhas = r.lines.map((l) => {
      const u = medidas.get(l.palletId);
      return [
        celulaCsv(l.palletCode),
        celulaCsv(l.currentPositionCode ?? 'sem posição'),
        celulaCsv(l.snapshotPositionCode ?? 'sem posição'),
        celulaCsv(l.palletCode),
        celulaCsv(l.sku),
        celulaCsv(l.description),
        celulaCsv(l.lot ?? 'pendente'),
        celulaCsv(l.originReference ? `${l.originType ? ROTULOS_ORIGEM_CSV[l.originType] : ''} ${l.originReference}`.trim() : 'pendente'),
        quantidadeCsv(l.quantity),
        celulaCsv(l.unit),
        celulaCsv(ROTULOS_CONDICAO_CSV[l.condition]),
        quantidadeCsv(l.prepared),
        celulaCsv(u?.boxes ?? ''),
        quantidadeCsv(u?.weightKg ?? null),
        celulaCsv(u?.weightBase ? ROTULOS_BASE_PESO[u.weightBase] : ''),
        quantidadeCsv(u?.volumeM3 ?? null),
        celulaCsv(u?.measurementSource ?? ''),
        celulaCsv(l.currentProblems.join(' | ')),
      ];
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nomeDownload(`preparacao-${r.code}`)}.csv"`)
      .send(documentoCsv([...topo, ...linhas]));
  });

  // ---------- Expedição e retorno ----------

  app.post(`${API_PREFIXO}/reservas/:id/expedicao`, { preHandler: p('janela.consultar', 'expedicao.confirmar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(ConfirmarExpedicaoSchema, request.body, 'Confirmação da expedição inválida.');
    return responder(reply, await mutar(request, 'expedicao.confirmar', { id, corpo: request.body }, (tx, autor) => confirmarExpedicao(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.get(`${API_PREFIXO}/expedicoes/:id`, { preHandler: consultar }, async (request) => {
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    return detalheExpedicao(deps.db, escopoAtivoDe(request), id);
  });

  app.post(`${API_PREFIXO}/expedicoes/:id/correcao`, { preHandler: p('janela.consultar', 'expedicao.confirmar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(CorrigirExpedicaoSchema, request.body, 'Correção inválida.');
    return responder(reply, await mutar(request, 'expedicao.corrigir', { id, corpo: request.body }, (tx, autor) => corrigirExpedicao(tx, escopo, id, dados, autor, deps.agora())));
  });

  app.post(`${API_PREFIXO}/expedicoes/:id/retornos`, { preHandler: p('janela.consultar', 'expedicao.retorno') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const { id } = validar(IdSchema, request.params, 'Identificador inválido.');
    const dados = validar(RegistrarRetornoSchema, request.body, 'Retorno inválido.');
    return responder(reply, await mutar(request, 'expedicao.retorno', { id, corpo: request.body }, (tx, autor) => registrarRetorno(tx, escopo, id, dados, autor, deps.agora())));
  });
}
