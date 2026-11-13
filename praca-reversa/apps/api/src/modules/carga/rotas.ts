/**
 * Rotas da Expedição DHL (carga por veículo). Consulta: `janela.consultar`.
 * Montagem, posição, físico conferido e emissões: `expedicao.preparar`.
 * Conferência documental: `expedicao.documentos`. Fechar, reabrir e cancelar
 * veículo: `expedicao.confirmar`. Toda mutação é idempotente, transacional e
 * devolve a carga atualizada da janela; nenhuma baixa estoque.
 */
import {
  API_PREFIXO,
  AcaoVeiculoSchema,
  AlterarLinhasEmbarqueSchema,
  AlterarVeiculoSchema,
  CancelarEmbarqueSchema,
  ConferirDocumentoSchema,
  ConfirmarPosicaoSchema,
  CriarPaleteEmbarqueSchema,
  CriarVeiculoSchema,
  EmitirSchema,
  FisicoConferidoSchema,
  IncluirNotasEmbarqueSchema,
  PosicaoEmbarqueSchema,
  TransferirEmbarqueSchema,
  identidadeEmbarque,
  nomeArquivoSeguro,
  type EventosEmbarque,
  type ResultadoInclusaoNotas,
  type OrigemEmbarque,
  type Escopo,
  type TipoVeiculo,
} from '@praca-reversa/contracts';
import { escreverXlsx } from '../importacao/arquivo/xlsx-escrita.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import { naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { analisarBipagemEmbarque } from './bipagem.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { cargaDaJanela, janelasParaCarga, lerJanelaCarga, selecaoExpedicao } from './leitura.js';
import { disponibilidade, lerOcorrencias, ocorrenciasDoPalete } from './origem.js';
import {
  acaoVeiculo,
  alterarLinhas,
  alterarVeiculo,
  cancelarPalete,
  conferirDocumento,
  confirmarPosicao,
  criarPalete,
  criarVeiculo,
  emitirMapa,
  emitirPalete,
  incluirNotas,
  marcarFisico,
  moverPosicao,
  transferirPalete,
  type Autor,
} from './servico.js';

const Id = z.object({ id: z.uuid() });
const BuscaOrigem = z.object({ codigo: z.string().trim().min(1).max(40) });
const Recarregar = z.object({ expectedVersion: z.number().int().positive() });
const SelecaoConsulta = z.object({ palete: z.uuid().optional() });

async function origemPorCodigo(db: Banco, escopo: Escopo, janelaId: string, codigo: string): Promise<OrigemEmbarque> {
  await lerJanelaCarga(db, escopo.id, janelaId);
  const [p] = await db.$queryRaw<{ id: string; codigo: string; endereco: string | null; na_praca: boolean }[]>`
    SELECT p.id::text, p.codigo,
           (SELECT ep.endereco FROM endereco_posicao ep WHERE ep.escopo_id = p.escopo_id AND ep.posicao_id = p.posicao_id ORDER BY ep.id LIMIT 1) AS endereco,
           (p.arquivado_em IS NULL AND p.estado_fluxo::text IN ('EM_ESTOQUE', 'RESERVADO')) AS na_praca
      FROM palete p
     WHERE p.escopo_id = ${escopo.id}::uuid AND (upper(p.codigo) = upper(${codigo}) OR upper(coalesce(p.codigo_legado, '')) = upper(${codigo}))
     ORDER BY (upper(p.codigo) = upper(${codigo})) DESC, p.arquivado_em NULLS FIRST
     LIMIT 1`;
  if (!p) throw naoEncontrado(`Palete ${codigo} não encontrado neste escopo.`);
  const refs = await ocorrenciasDoPalete(db, escopo.id, p.id);
  const ocorrencias = await lerOcorrencias(db, escopo.id, refs);
  const disp = await disponibilidade(db, escopo.id, janelaId, refs.map((r) => r.id), new Map([...ocorrencias.values()].map((o) => [o.id, o.base])), null);
  const [full] = await db.$queryRaw<{ codigo: string; tipo: TipoVeiculo; sequencia: number; numero: number }[]>`
    SELECT j.codigo, v.tipo, v.sequencia, pe.numero
      FROM palete_embarque pe JOIN veiculo_carga v ON v.id = pe.veiculo_id JOIN janela_devolucao j ON j.id = v.janela_id
     WHERE pe.escopo_id = ${escopo.id}::uuid AND pe.palete_origem_id = ${p.id}::uuid AND pe.tipo = 'FULL' AND pe.situacao = 'ATIVO' AND v.situacao <> 'CANCELADO'
     LIMIT 1`;
  return {
    palletId: p.id,
    code: p.codigo,
    address: p.endereco,
    onSite: p.na_praca,
    fullIn: full ? identidadeEmbarque(full.codigo, full.tipo, full.sequencia, full.numero) : null,
    occurrences: refs.flatMap((r) => {
      const o = ocorrencias.get(r.id);
      if (!o) return [];
      const d = disp.get(r.id);
      return [
        {
          kind: o.kind,
          id: o.id,
          documentType: o.documentType,
          documentNumber: o.documentNumber,
          sender: o.sender,
          delivery: o.delivery,
          base: o.base,
          available: d?.available ?? null,
          separatedHere: d?.separatedHere ?? 0,
        },
      ];
    }),
  };
}

export function registrarRotasCarga(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const autorDe = (request: FastifyRequest): Autor => ({ usuarioId: contextoDe(request).sessao.usuario.id });

  app.get(`${API_PREFIXO}/cargas/janelas`, { preHandler: auth.exigirPermissao('janela.consultar') }, async (request) => janelasParaCarga(deps.db, escopoAtivoDe(request)));

  // Seleção atual (contador do atalho no mapa) e, com ?palete=, onde as notas desse palete já estão.
  app.get(`${API_PREFIXO}/cargas/selecao`, { preHandler: auth.exigirPermissao('janela.consultar') }, async (request) => {
    const { palete } = validar(SelecaoConsulta, request.query, 'Palete inválido.');
    return selecaoExpedicao(deps.db, escopoAtivoDe(request).id, palete ?? null);
  });

  app.get(`${API_PREFIXO}/cargas/janelas/:id`, { preHandler: auth.exigirPermissao('janela.consultar') }, async (request) => {
    const { id } = validar(Id, request.params, 'Identificador de janela inválido.');
    return cargaDaJanela(deps.db, escopoAtivoDe(request), id, deps.agora());
  });

  // Excel com tudo o que já está nos veículos da janela (uma linha por nota), para PROCV com a planilha do cliente.
  app.get(`${API_PREFIXO}/cargas/janelas/:id/relatorio`, { preHandler: auth.exigirPermissao('janela.consultar') }, async (request, reply) => {
    const { id } = validar(Id, request.params, 'Identificador de janela inválido.');
    const c = await cargaDaJanela(deps.db, escopoAtivoDe(request), id, deps.agora());
    const t = (titulo: string, largura = 18) => ({ titulo, largura, texto: true });
    const colunas = [t('Nota', 16), t('Tipo', 12), t('Remetente', 30), t('Delivery', 16), t('Volumes', 10), t('Veículo', 14), t('Placa', 12), t('Palete', 10), t('Posição', 10), t('Palete de origem', 18), t('Carregamento confirmado', 22), t('Físico conferido', 16), t('Documentos', 16)];
    const linhas: (string | null)[][] = [];
    for (const v of c.vehicles.filter((x) => x.state !== 'CANCELADO')) {
      for (const p of v.pallets.filter((x) => x.state === 'ATIVO')) {
        for (const l of p.lines) {
          linhas.push([l.documentNumber, l.documentType, l.sender, l.delivery, String(l.volumes), v.label, v.plate, p.label, p.position === null ? null : String(p.position), l.sourcePalletCode, p.positionConfirmed ? 'Sim' : 'Não', p.physical.checked ? 'Sim' : 'Não', p.docs.state]);
        }
      }
    }
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('cache-control', 'no-store')
      .header('content-disposition', `attachment; filename="${nomeArquivoSeguro(`expedicao-${c.window.code}`)}.xlsx"`)
      .send(escreverXlsx([{ nome: 'Na expedicao', colunas, linhas }]));
  });

  app.get(`${API_PREFIXO}/cargas/janelas/:id/origem`, { preHandler: auth.exigirPermissao('expedicao.preparar') }, async (request) => {
    const { id } = validar(Id, request.params, 'Identificador de janela inválido.');
    const { codigo } = validar(BuscaOrigem, request.query, 'Informe o código do palete de origem.');
    return origemPorCodigo(deps.db, escopoAtivoDe(request), id, codigo);
  });

  // Bipagem do palete fracionado: só leitura (origens e disponível); autenticação e permissão antes de ler o corpo.
  void app.register((sub, _opcoes, pronto) => {
    const limite = deps.importacaoPlanilha.maxBytes;
    sub.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: limite }, (_request, corpo, feito) => {
      feito(null, corpo);
    });
    sub.post(`${API_PREFIXO}/cargas/janelas/:id/bipagem`, { bodyLimit: limite, onRequest: [auth.autenticar, auth.exigirPermissao('expedicao.preparar')] }, async (request) => {
      const { id } = validar(Id, request.params, 'Identificador de janela inválido.');
      if (!Buffer.isBuffer(request.body)) throw requisicaoInvalida('Envie o arquivo da bipagem como application/octet-stream.');
      const cabecalho = request.headers['x-arquivo-nome'];
      let nome = 'bipagem';
      if (typeof cabecalho === 'string') {
        try {
          nome = nomeArquivoSeguro(decodeURIComponent(cabecalho));
        } catch {
          throw requisicaoInvalida('Nome do arquivo inválido.');
        }
      }
      return analisarBipagemEmbarque(deps.db, escopoAtivoDe(request).id, id, request.body, nome, deps.importacaoPlanilha);
    });
    pronto();
  });

  app.get(`${API_PREFIXO}/cargas/veiculos/:id/historico`, { preHandler: auth.exigirPermissao('janela.consultar') }, async (request): Promise<EventosEmbarque> => {
    const { id } = validar(Id, request.params, 'Identificador de veículo inválido.');
    const escopo = escopoAtivoDe(request);
    const linhas = await deps.db.$queryRaw<{ id: string; tipo: string; detalhes: Record<string, unknown>; autor: string; ocorrido_em: Date; numero: number | null }[]>`
      SELECT e.id::text, e.tipo, e.detalhes, u.nome AS autor, e.ocorrido_em, pe.numero
        FROM evento_embarque e JOIN usuario u ON u.id = e.autor_id LEFT JOIN palete_embarque pe ON pe.id = e.palete_embarque_id
       WHERE e.escopo_id = ${escopo.id}::uuid AND e.veiculo_id = ${id}::uuid
       ORDER BY e.ocorrido_em DESC, e.id DESC LIMIT 300`;
    return { items: linhas.map((l) => ({ id: l.id, kind: l.tipo, details: l.detalhes, by: l.autor, at: l.ocorrido_em.toISOString(), pallet: l.numero === null ? null : `P${String(l.numero).padStart(2, '0')}` })) };
  });

  /** Mutação idempotente que devolve a carga atualizada da janela. */
  const mutacao =
    (operacao: string, status: number, executar: (request: FastifyRequest, id: string, escopo: Escopo, autor: Autor, tx: Transacao, agora: Date) => Promise<string>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const escopo = escopoAtivoDe(request);
      const autor = autorDe(request);
      const chave = chaveIdempotencia(request);
      const { id } = validar(Id, request.params, 'Identificador inválido.');
      const resultado = await executarIdempotente(deps.db, deps.config.appSegredo, { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao, chave, payload: { id, corpo: request.body } }, async (tx) => {
        const agora = deps.agora();
        const janelaId = await executar(request, id, escopo, autor, tx, agora);
        return { status, corpo: await cargaDaJanela(tx, escopo, janelaId, agora) };
      });
      return responder(reply, resultado);
    };

  const preparar = { preHandler: auth.exigirPermissao('expedicao.preparar') };

  app.post(
    `${API_PREFIXO}/cargas/janelas/:id/veiculos`,
    preparar,
    mutacao('carga.veiculo.criar', 201, async (request, id, escopo, autor, tx, agora) => {
      await criarVeiculo(tx, escopo, id, validar(CriarVeiculoSchema, request.body, 'Escolha Carreta ou Truck.'), autor, agora);
      return id;
    }),
  );
  app.put(
    `${API_PREFIXO}/cargas/veiculos/:id`,
    preparar,
    mutacao('carga.veiculo.alterar', 200, (request, id, escopo, autor, tx, agora) => alterarVeiculo(tx, escopo, id, validar(AlterarVeiculoSchema, request.body, 'Dados do veículo inválidos.'), autor, agora)),
  );
  app.post(
    `${API_PREFIXO}/cargas/veiculos/:id/situacao`,
    { preHandler: auth.exigirPermissao('expedicao.confirmar') },
    mutacao('carga.veiculo.situacao', 200, (request, id, escopo, autor, tx, agora) =>
      acaoVeiculo(tx, escopo, id, validar(AcaoVeiculoSchema, request.body, 'Ação inválida.'), autor, agora, async (janelaId, veiculoId) => {
        const carga = await cargaDaJanela(tx, escopo, janelaId, agora);
        return carga.vehicles.find((v) => v.id === veiculoId)?.pending ?? [];
      }),
    ),
  );
  app.post(
    `${API_PREFIXO}/cargas/veiculos/:id/paletes`,
    preparar,
    mutacao('carga.palete.criar', 201, (request, id, escopo, autor, tx, agora) =>
      criarPalete(tx, escopo, id, validar(CriarPaleteEmbarqueSchema, request.body, 'FULL: palete de origem; Fracionado: NFs e volumes.'), autor, agora),
    ),
  );
  // Inclusão por nota (ficha do palete): rota e processamento próprios; nunca expande para o palete inteiro (isso é o FULL acima).
  app.post(`${API_PREFIXO}/cargas/veiculos/:id/notas`, preparar, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(Id, request.params, 'Identificador de veículo inválido.');
    const dados = validar(IncluirNotasEmbarqueSchema, request.body, 'Nota sem identificação válida: nada foi incluído.');
    const resultado = await executarIdempotente(deps.db, deps.config.appSegredo, { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'carga.notas.incluir', chave, payload: { id, corpo: request.body } }, async (tx) => {
      const r = await incluirNotas(tx, escopo, id, dados, autor, deps.agora());
      const corpo: ResultadoInclusaoNotas = {
        added: r.added,
        skipped: r.skipped,
        pallet: r.pallet,
        windowId: r.janelaId,
        vehicleId: id,
        selection: await selecaoExpedicao(tx, escopo.id, dados.sourcePalletId),
      };
      return { status: 201, corpo };
    });
    return responder(reply, resultado);
  });

  app.post(
    `${API_PREFIXO}/cargas/veiculos/:id/mapa`,
    preparar,
    mutacao('carga.mapa.emitir', 201, (request, id, escopo, autor, tx, agora) => emitirMapa(tx, escopo, id, validar(EmitirSchema, request.body, 'Emissão inválida.'), autor, agora)),
  );
  app.put(
    `${API_PREFIXO}/cargas/paletes/:id/posicao`,
    preparar,
    mutacao('carga.palete.posicao', 200, (request, id, escopo, autor, tx, agora) => moverPosicao(tx, escopo, id, validar(PosicaoEmbarqueSchema, request.body, 'Posição inválida.'), autor, agora)),
  );
  app.post(
    `${API_PREFIXO}/cargas/paletes/:id/confirmacao`,
    preparar,
    mutacao('carga.palete.confirmacao', 200, (request, id, escopo, autor, tx, agora) =>
      confirmarPosicao(tx, escopo, id, validar(ConfirmarPosicaoSchema, request.body, 'Confirmação inválida.'), autor, agora),
    ),
  );
  app.post(
    `${API_PREFIXO}/cargas/paletes/:id/transferencia`,
    preparar,
    mutacao('carga.palete.transferir', 200, (request, id, escopo, autor, tx, agora) =>
      transferirPalete(tx, escopo, id, validar(TransferirEmbarqueSchema, request.body, 'Transferência inválida.'), autor, agora),
    ),
  );
  app.put(
    `${API_PREFIXO}/cargas/paletes/:id/linhas`,
    preparar,
    mutacao('carga.palete.linhas', 200, (request, id, escopo, autor, tx, agora) =>
      alterarLinhas(tx, escopo, id, validar(AlterarLinhasEmbarqueSchema, request.body, 'Informe as NFs e os volumes.'), autor, agora),
    ),
  );
  app.post(
    `${API_PREFIXO}/cargas/paletes/:id/recarregar-origem`,
    preparar,
    mutacao('carga.palete.recarregar', 200, (request, id, escopo, autor, tx, agora) => {
      const { expectedVersion } = validar(Recarregar, request.body, 'Versão do palete ausente.');
      return alterarLinhas(tx, escopo, id, { expectedVersion, lines: null }, autor, agora);
    }),
  );
  app.post(
    `${API_PREFIXO}/cargas/paletes/:id/fisico`,
    preparar,
    mutacao('carga.palete.fisico', 200, (request, id, escopo, autor, tx, agora) => marcarFisico(tx, escopo, id, validar(FisicoConferidoSchema, request.body, 'Revisão ausente.'), autor, agora)),
  );
  app.post(
    `${API_PREFIXO}/cargas/paletes/:id/documentos`,
    { preHandler: auth.exigirPermissao('expedicao.documentos') },
    mutacao('carga.palete.documento', 201, (request, id, escopo, autor, tx, agora) =>
      conferirDocumento(tx, escopo, id, validar(ConferirDocumentoSchema, request.body, 'Situação do documento inválida.'), autor, agora),
    ),
  );
  app.post(
    `${API_PREFIXO}/cargas/paletes/:id/cancelamento`,
    preparar,
    mutacao('carga.palete.cancelar', 200, (request, id, escopo, autor, tx, agora) => cancelarPalete(tx, escopo, id, validar(CancelarEmbarqueSchema, request.body, 'Informe o motivo.'), autor, agora)),
  );
  app.post(
    `${API_PREFIXO}/cargas/paletes/:id/emissoes`,
    { preHandler: auth.exigirAlguma(['expedicao.preparar', 'expedicao.documentos']) },
    mutacao('carga.palete.emitir', 201, (request, id, escopo, autor, tx, agora) => emitirPalete(tx, escopo, id, validar(EmitirSchema, request.body, 'Emissão inválida.'), autor, agora)),
  );
}
