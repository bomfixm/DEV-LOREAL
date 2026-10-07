import {
  API_PREFIXO,
  CONTRATO_MINIMO_INTERFACE,
  ChaveOperacaoSchema,
  VERSAO_CONTRATO,
  type ResultadoOperacao,
  type VersaoServidor,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requisicaoInvalida } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Dependencias } from '../acesso/contexto.js';

export interface ConfigAplicativo {
  versao: string;
  /** Caminho-base público, terminado em "/". */
  caminhoBase: string;
  /** Política de rascunho no armazenamento do navegador. */
  persistenciaLocal: boolean;
}

/**
 * GET /versao (público): versão do aplicativo e do contrato, política de
 * rascunho local e endereço das etiquetas. Nada de configuração sensível.
 */
export function registrarRotasVersao(app: FastifyInstance, deps: Pick<Dependencias, 'config'>, aplicativo: ConfigAplicativo): void {
  app.get(`${API_PREFIXO}/versao`, (): VersaoServidor => ({
    application: aplicativo.versao,
    contract: VERSAO_CONTRATO,
    minimumClientContract: CONTRATO_MINIMO_INTERFACE,
    localDrafts: aplicativo.persistenciaLocal,
    labelOrigin: deps.config.urlPublica,
    basePath: aplicativo.caminhoBase,
  }));
}

const ParametrosSchema = z.object({ chave: ChaveOperacaoSchema });

/**
 * GET /operacoes/<chave>: resultado autenticado de um pedido com chave de
 * idempotência, só do próprio usuário no escopo ativo. Somente leitura: não
 * repete nem conclui nada; a resposta guardada é a mesma que um reenvio com a
 * mesma chave devolveria. O hash do pedido nunca sai do servidor.
 */
export function registrarRotasOperacoes(app: FastifyInstance, deps: Dependencias): void {
  app.get(`${API_PREFIXO}/operacoes/:chave`, async (request): Promise<ResultadoOperacao> => {
    const parametros = ParametrosSchema.safeParse(request.params);
    if (!parametros.success) throw requisicaoInvalida('Chave de operação inválida (8 a 200 caracteres: letras, números, _ ou -).');
    const escopo = escopoAtivoDe(request);
    const usuarioId = contextoDe(request).sessao.usuario.id;
    const registros = await deps.db.registroIdempotencia.findMany({
      where: { escopoId: escopo.id, usuarioId, chave: parametros.data.chave },
      select: { operacao: true, statusHttp: true, resposta: true, criadoEm: true },
      orderBy: { criadoEm: 'asc' },
    });
    // statusHttp 0 só existe dentro da transação ainda aberta; fora dela não é visível.
    const concluidos = registros.filter((r) => r.statusHttp > 0);
    return {
      key: parametros.data.chave,
      state: concluidos.length > 0 ? 'REGISTRADA' : 'NAO_ENCONTRADA',
      operations: concluidos.map((r) => ({ operation: r.operacao, status: r.statusHttp, recordedAt: r.criadoEm.toISOString(), response: r.resposta })),
      checkedAt: deps.agora().toISOString(),
    };
  });
}
