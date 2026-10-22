import {
  API_PREFIXO,
  BuscaConteudoVolumesSchema,
  EstornarVolumesSchema,
  FiltroPainelSchema,
  ROTULO_ETAPA_SELECAO,
  ROTULO_EVENTO_CLIENTE,
  RegistrarExpedicaoVolumesSchema,
  RegistrarMetaVolumesSchema,
  RegistrarSeparacaoVolumesSchema,
  type FiltroPainel,
  type ResultadoVolumes,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Transacao } from '../../db/cliente.js';
import { z } from 'zod';
import { celulaCsv, documentoCsv, nomeDownload } from '../../http/csv-seguro.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { estoquePaginado, historicoPaginado, lerEstoque, lerHistorico, linhasJanelaCliente, painelCliente, painelOperacao } from './paineis.js';
import { buscarConteudos, estornarVolumes, registrarExpedicao, registrarMeta, registrarSeparacao, volumesDaJanela, type Autor } from './volumes.js';

const ParametrosSchema = z.object({ id: z.uuid() });
const FiltroPeriodoSchema = FiltroPainelSchema.pick({
  inicio: true,
  fim: true,
});

function autorDe(request: FastifyRequest): Autor {
  return {
    usuarioId: contextoDe(request).sessao.usuario.id,
    requestId: request.id,
  };
}

const ROTULO_FULL = {
  FULL: 'Full',
  MISTO: 'Misto',
  NAO_INFORMADO: 'Não informado',
} as const;

/**
 * Painéis (docs/INDICADORES.md, seção Painéis). Operação: `painel.operacao`
 * (perfis DHL). Cliente: `painel.cliente` — só leitura da projeção permitida,
 * no escopo da sessão (requisição direta a outro escopo não encontra nada).
 * Registros por volumes: meta = `janela.gerenciar`; separação =
 * `expedicao.preparar`; expedição = `expedicao.confirmar`; estorno = a
 * permissão da operação estornada. Mutações idempotentes e auditadas.
 */
export function registrarRotasPaineis(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  // ---------- Operação (DHL) ----------
  app.get(`${API_PREFIXO}/painel/operacao`, { preHandler: auth.exigirPermissao('painel.operacao') }, async (request) => {
    const filtro = validar(FiltroPeriodoSchema, request.query, 'Período inválido.');
    return painelOperacao(deps.db, escopoAtivoDe(request), contextoDe(request).permissoes, filtro, deps.agora());
  });

  app.get(`${API_PREFIXO}/painel/operacao/estoque`, { preHandler: auth.exigirPermissao('painel.operacao') }, async (request) => {
    const filtro = validar(FiltroPainelSchema, request.query, 'Filtros inválidos.');
    return estoquePaginado(deps.db, escopoAtivoDe(request), filtro, deps.agora(), true);
  });

  app.get(`${API_PREFIXO}/painel/operacao/historico`, { preHandler: auth.exigirPermissao('painel.operacao') }, async (request) => {
    const filtro = validar(FiltroPainelSchema, request.query, 'Filtros inválidos.');
    return historicoPaginado(deps.db, escopoAtivoDe(request), filtro, deps.agora());
  });

  app.get(`${API_PREFIXO}/janelas/:id/volumes`, { preHandler: auth.exigirPermissao('painel.operacao') }, async (request) => {
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de janela inválido.');
    return volumesDaJanela(deps.db, escopoAtivoDe(request), id, deps.agora());
  });

  app.get(`${API_PREFIXO}/janelas/:id/volumes/conteudos`, { preHandler: auth.exigirPermissao('expedicao.preparar') }, async (request) => {
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de janela inválido.');
    const { texto } = validar(BuscaConteudoVolumesSchema, request.query, 'Informe palete, NF, Delivery, remetente ou endereço.');
    return {
      items: await buscarConteudos(deps.db, escopoAtivoDe(request), id, texto),
    };
  });

  const mutacao =
    (operacao: string, executar: (request: FastifyRequest, id: string, autor: Autor, tx: Transacao) => Promise<ResultadoVolumes>) => async (request: FastifyRequest, reply: FastifyReply) => {
      const escopo = escopoAtivoDe(request);
      const autor = autorDe(request);
      const chave = chaveIdempotencia(request);
      const { id } = validar(ParametrosSchema, request.params, 'Identificador de janela inválido.');
      const resultado = await executarIdempotente(
        deps.db,
        deps.config.appSegredo,
        {
          escopoId: escopo.id,
          usuarioId: autor.usuarioId,
          operacao,
          chave,
          payload: { id, corpo: request.body },
        },
        async (tx) => ({
          status: 201,
          corpo: await executar(request, id, autor, tx),
        }),
      );
      return responder(reply, resultado);
    };

  app.post(
    `${API_PREFIXO}/janelas/:id/volumes/meta`,
    { preHandler: auth.exigirPermissao('janela.gerenciar') },
    mutacao('janela.volumes.meta', (request, id, autor, tx) => {
      const dados = validar(RegistrarMetaVolumesSchema, request.body, 'Informe a quantidade de volumes (inteiro, 0 ou mais).');
      return registrarMeta(tx, escopoAtivoDe(request), id, dados, autor, deps.agora());
    }),
  );

  app.post(
    `${API_PREFIXO}/janelas/:id/volumes/separacoes`,
    { preHandler: auth.exigirPermissao('expedicao.preparar') },
    mutacao('janela.volumes.separar', (request, id, autor, tx) => {
      const dados = validar(RegistrarSeparacaoVolumesSchema, request.body, 'Informe o conteúdo e os volumes separados (inteiro, 1 ou mais).');
      return registrarSeparacao(tx, escopoAtivoDe(request), id, dados, autor, deps.agora());
    }),
  );

  app.post(
    `${API_PREFIXO}/janelas/:id/volumes/expedicoes`,
    { preHandler: auth.exigirPermissao('expedicao.confirmar') },
    mutacao('janela.volumes.expedir', (request, id, autor, tx) => {
      const dados = validar(RegistrarExpedicaoVolumesSchema, request.body, 'Informe os conteúdos e os volumes expedidos.');
      return registrarExpedicao(tx, escopoAtivoDe(request), id, dados, autor, deps.agora());
    }),
  );

  app.post(
    `${API_PREFIXO}/janelas/:id/volumes/estornos`,
    {
      preHandler: auth.exigirAlguma(['expedicao.preparar', 'expedicao.confirmar']),
    },
    mutacao('janela.volumes.estornar', (request, id, autor, tx) => {
      const dados = validar(EstornarVolumesSchema, request.body, 'Informe o registro, os volumes e o motivo do estorno.');
      return estornarVolumes(tx, escopoAtivoDe(request), id, dados, autor, contextoDe(request).permissoes, deps.agora());
    }),
  );

  // ---------- Cliente (projeção permitida) ----------
  const cliente = { preHandler: auth.exigirPermissao('painel.cliente') };

  app.get(`${API_PREFIXO}/painel/cliente`, cliente, async (request) => painelCliente(deps.db, escopoAtivoDe(request), deps.agora()));

  app.get(`${API_PREFIXO}/painel/cliente/estoque`, cliente, async (request) => {
    const filtro = validar(FiltroPainelSchema, request.query, 'Filtros inválidos.');
    return estoquePaginado(deps.db, escopoAtivoDe(request), semFiltroInterno(filtro), deps.agora(), false);
  });

  app.get(`${API_PREFIXO}/painel/cliente/janelas/:id`, cliente, async (request) => {
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de janela inválido.');
    return linhasJanelaCliente(deps.db, escopoAtivoDe(request), id, deps.agora());
  });

  app.get(`${API_PREFIXO}/painel/cliente/historico`, cliente, async (request) => {
    const filtro = validar(FiltroPainelSchema, request.query, 'Filtros inválidos.');
    return historicoPaginado(deps.db, escopoAtivoDe(request), filtro, deps.agora());
  });

  app.get(`${API_PREFIXO}/painel/cliente/estoque/exportar`, cliente, async (request, reply) => {
    const filtro = semFiltroInterno(validar(FiltroPainelSchema, request.query, 'Filtros inválidos.'));
    const escopo = escopoAtivoDe(request);
    const agora = deps.agora();
    const { linhas, fuso } = await lerEstoque(deps.db, escopo, filtro, agora, false);
    const csv = documentoCsv([
      [`Estoque consultado em ${dataHora(agora, fuso)} (${fuso})`].map(celulaCsv),
      ['Tipo do documento', 'Número', 'Delivery', 'Remetente', 'Volumes', 'Base dos volumes', 'Palete', 'Full/misto', 'Endereço', 'Rua', 'Etapa na janela'].map(celulaCsv),
      ...linhas.map((l) =>
        [
          l.documentType,
          l.documentNumber ?? 'Não informado',
          l.delivery,
          l.sender,
          l.volumes === null ? 'Não informado' : String(l.volumes),
          l.volumesBasis === 'CONTADO' ? 'Contado' : l.volumesBasis === 'INFORMADO' ? 'Informado no inventário' : null,
          l.palletCode,
          ROTULO_FULL[l.palletType],
          l.address ?? 'Localização em atualização',
          l.street,
          l.windowStage === null ? null : ROTULO_ETAPA_SELECAO[l.windowStage],
        ].map(celulaCsv),
      ),
    ]);
    await auditarExportacao(request, 'ESTOQUE', linhas.length);
    return enviarCsv(reply, `estoque-${agora.toISOString().slice(0, 16).replace(/[:T]/g, '')}`, csv);
  });

  app.get(`${API_PREFIXO}/painel/cliente/historico/exportar`, cliente, async (request, reply) => {
    const filtro = validar(FiltroPainelSchema, request.query, 'Filtros inválidos.');
    const escopo = escopoAtivoDe(request);
    const agora = deps.agora();
    const { resultado, fuso } = await lerHistorico(deps.db, escopo, filtro, agora, true);
    const csv = documentoCsv([
      [`Histórico consultado em ${dataHora(agora, fuso)} (${fuso})`].map(celulaCsv),
      ['Data e hora', 'Ação', 'Palete', 'Tipo do documento', 'Número', 'Delivery', 'De', 'Para', 'Volumes', 'Janela', 'Correção'].map(celulaCsv),
      ...resultado.eventos.map((e) =>
        [
          dataHora(new Date(e.at), fuso),
          ROTULO_EVENTO_CLIENTE[e.type],
          e.palletCode,
          e.documentType,
          e.documentNumber,
          e.delivery,
          e.from,
          e.to,
          e.volumes === null ? null : String(e.volumes),
          e.windowCode,
          e.correction ? 'Sim' : 'Não',
        ].map(celulaCsv),
      ),
    ]);
    await auditarExportacao(request, 'HISTORICO', resultado.eventos.length);
    return enviarCsv(reply, `historico-${agora.toISOString().slice(0, 16).replace(/[:T]/g, '')}`, csv);
  });

  async function auditarExportacao(request: FastifyRequest, tipo: string, linhas: number): Promise<void> {
    await registrarEvento(deps.db, {
      acao: 'PAINEL_CLIENTE_EXPORTADO',
      resultado: 'SUCESSO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopoAtivoDe(request).id,
      alvoTipo: 'PAINEL',
      alvoId: tipo,
      detalhes: { linhas },
      requestId: request.id,
    });
  }
}

/** Filtro "precisa de reconferência" é indicação interna: não vale na visão do cliente. */
function semFiltroInterno(f: FiltroPainel): FiltroPainel {
  return f.situacao === 'reconferencia' ? { ...f, situacao: undefined } : f;
}

function dataHora(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);
}

function enviarCsv(reply: FastifyReply, nome: string, csv: Buffer) {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('content-disposition', `attachment; filename="${nomeDownload(nome)}.csv"`)
    .send(csv);
}
