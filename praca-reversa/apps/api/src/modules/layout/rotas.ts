import {
  API_PREFIXO,
  AlterarElementoSchema,
  AlterarPosicaoSchema,
  CodigoElementoSchema,
  ConfirmarEnderecosSchema,
  CriarDesenhoAprovadoSchema,
  CriarLayoutSchema,
  DefinirSequenciaSchema,
  NovaZonaSchema,
  NovoBlocoSchema,
  RetirarPosicaoSchema,
  type Escopo,
  type ResultadoLayout,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import {
  adicionarBloco,
  alterarElemento,
  alterarPosicao,
  criarLayout,
  criarZona,
  listarHistorico,
  retirarPosicao,
  type Autor,
} from './servico.js';
import { aplicarNomenclaturaAprovada, criarLayoutDesenhoAprovado } from './aplicar-desenho.js';
import { confirmarEnderecos, definirSequencia, lerCorrespondencia } from './enderecos.js';

const ParametrosPosicaoSchema = z.object({ id: z.uuid() });
const ParametrosFileiraSchema = z.object({ id: z.uuid() });
const RevisaoSchema = z.object({ expectedRevision: z.number().int().positive() });
const ParametrosElementoSchema = z.object({ codigo: CodigoElementoSchema });
const FiltroHistoricoSchema = z.object({ limite: z.coerce.number().int().min(1).max(200).default(50) });

/** Valida o pedido antes da transação e devolve a alteração a executar. */
type Preparar = (request: FastifyRequest, escopo: Escopo) => (tx: Transacao, autor: Autor) => Promise<ResultadoLayout>;

/**
 * Configuração do layout do escopo ativo. Geometria e ocupação ficam
 * separadas: nenhuma rota daqui altera o vínculo de palete. Toda alteração
 * exige a revisão vista pelo usuário e gera uma revisão nova no histórico.
 */
export function registrarRotasLayout(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const configurar = { preHandler: auth.exigirPermissao('layout.configurar') };

  function alteracao(operacao: string, preparar: Preparar, status = 200) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const escopo = escopoAtivoDe(request);
      const autor: Autor = { usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id };
      const chave = chaveIdempotencia(request);
      const executar = preparar(request, escopo);
      const resultado = await executarIdempotente(
        deps.db,
        deps.config.appSegredo,
        { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao, chave, payload: { params: request.params, corpo: request.body } },
        async (tx) => ({ status, corpo: await executar(tx, autor) }),
      );
      return responder(reply, resultado);
    };
  }

  app.post(
    `${API_PREFIXO}/layout`,
    configurar,
    alteracao(
      'layout.criar',
      (request, escopo) => {
        const dados = validar(CriarLayoutSchema, request.body, 'Informe o nome do layout.');
        return (tx, autor) => criarLayout(tx, escopo, dados, autor, deps.agora());
      },
      201,
    ),
  );

  app.post(
    `${API_PREFIXO}/layout/blocos`,
    configurar,
    alteracao(
      'layout.bloco',
      (request, escopo) => {
        const dados = validar(NovoBlocoSchema, request.body, 'Dados do bloco inválidos.');
        return (tx, autor) => adicionarBloco(tx, escopo, dados, autor);
      },
      201,
    ),
  );

  app.patch(
    `${API_PREFIXO}/layout/elementos/:codigo`,
    configurar,
    alteracao('layout.elemento', (request, escopo) => {
      const { codigo } = validar(ParametrosElementoSchema, request.params, 'Código de bloco ou zona inválido.');
      const dados = validar(AlterarElementoSchema, request.body, 'Alteração inválida.');
      return (tx, autor) => alterarElemento(tx, escopo, codigo, dados, autor);
    }),
  );

  app.post(
    `${API_PREFIXO}/layout/zonas`,
    configurar,
    alteracao(
      'layout.zona',
      (request, escopo) => {
        const dados = validar(NovaZonaSchema, request.body, 'Dados da zona inválidos.');
        return (tx, autor) => criarZona(tx, escopo, dados, autor);
      },
      201,
    ),
  );

  app.patch(
    `${API_PREFIXO}/layout/posicoes/:id`,
    configurar,
    alteracao('layout.posicao', (request, escopo) => {
      const { id } = validar(ParametrosPosicaoSchema, request.params, 'Identificador de posição inválido.');
      const dados = validar(AlterarPosicaoSchema, request.body, 'Alteração de posição inválida.');
      return (tx, autor) => alterarPosicao(tx, escopo, id, dados, autor);
    }),
  );

  app.post(
    `${API_PREFIXO}/layout/posicoes/:id/retirar`,
    configurar,
    alteracao('layout.retirar_posicao', (request, escopo) => {
      const { id } = validar(ParametrosPosicaoSchema, request.params, 'Identificador de posição inválido.');
      const dados = validar(RetirarPosicaoSchema, request.body, 'Informe o motivo da retirada.');
      return (tx, autor) => retirarPosicao(tx, escopo, id, dados, autor, deps.agora());
    }),
  );

  app.post(
    `${API_PREFIXO}/layout/desenho-aprovado`,
    configurar,
    alteracao(
      'layout.desenho_aprovado',
      (request, escopo) => {
        const dados = validar(CriarDesenhoAprovadoSchema, request.body ?? {}, 'Dados do layout inválidos.');
        return (tx, autor) => criarLayoutDesenhoAprovado(tx, escopo, dados, autor, deps.agora());
      },
      201,
    ),
  );

  app.post(
    `${API_PREFIXO}/layout/nomenclatura-aprovada`,
    configurar,
    alteracao('layout.nomenclatura', (request, escopo) => {
      const { expectedRevision } = validar(RevisaoSchema, request.body, 'Informe a revisão do layout.');
      return (tx, autor) => aplicarNomenclaturaAprovada(tx, escopo, expectedRevision, autor);
    }),
  );

  app.put(
    `${API_PREFIXO}/layout/fileiras/:id/sequencia`,
    configurar,
    alteracao('layout.sequencia', (request, escopo) => {
      const { id } = validar(ParametrosFileiraSchema, request.params, 'Identificador de faixa inválido.');
      const dados = validar(DefinirSequenciaSchema, request.body, 'Sequência inválida.');
      return (tx, autor) => definirSequencia(tx, escopo, id, dados, autor, deps.agora());
    }),
  );

  app.post(
    `${API_PREFIXO}/layout/fileiras/:id/enderecos/confirmar`,
    configurar,
    alteracao('layout.confirmar_enderecos', (request, escopo) => {
      const { id } = validar(ParametrosFileiraSchema, request.params, 'Identificador de faixa inválido.');
      const dados = validar(ConfirmarEnderecosSchema, request.body, 'Confirmação inválida.');
      return (tx, autor) => confirmarEnderecos(tx, escopo, id, dados, autor, deps.agora());
    }),
  );

  app.get(`${API_PREFIXO}/layout/enderecos`, { preHandler: auth.exigirPermissao('praca.consultar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    return lerCorrespondencia(deps.db, escopo.id);
  });

  app.get(`${API_PREFIXO}/layout/historico`, { preHandler: auth.exigirPermissao('praca.consultar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const { limite } = validar(FiltroHistoricoSchema, request.query, 'Limite de 1 a 200.');
    return listarHistorico(deps.db, escopo.id, limite);
  });
}
