import { CABECALHO_CONTRATO, CONTRATO_MINIMO_INTERFACE, VERSAO_CONTRATO, contratoAceito } from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ErroHttp } from './erros.js';

const METODOS_MUTAVEIS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function ehMutavel(metodo: string): boolean {
  return METODOS_MUTAVEIS.has(metodo);
}

/**
 * Defesa de origem para requisições mutáveis (complementa o token anti-CSRF e
 * o cookie SameSite=Strict): o navegador precisa declarar mesma origem quando
 * informa `Origin` ou `Sec-Fetch-Site`. Requisições sem esses cabeçalhos
 * (ferramentas locais, testes) seguem para as demais verificações.
 */
export function verificarOrigem(request: FastifyRequest): void {
  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    throw new ErroHttp(403, 'ORIGEM_INVALIDA', 'Requisição de outra origem recusada.');
  }
  const origem = request.headers.origin;
  if (typeof origem === 'string') {
    let host: string;
    try {
      host = new URL(origem).host;
    } catch {
      throw new ErroHttp(403, 'ORIGEM_INVALIDA', 'Requisição de outra origem recusada.');
    }
    if (host !== request.headers.host) throw new ErroHttp(403, 'ORIGEM_INVALIDA', 'Requisição de outra origem recusada.');
  }
}

/**
 * Contrato da interface (etapa 09): uma tela de outra versão não grava. Sem o
 * cabeçalho (ferramentas locais, testes de API) segue normalmente; entrar,
 * sair e trocar de escopo continuam permitidos para a tela poder atualizar.
 */
export function verificarContrato(request: FastifyRequest, prefixoApi: string): void {
  const valor = request.headers[CABECALHO_CONTRATO];
  if (valor === undefined) return;
  const caminho = (request.url.split('?')[0] ?? '').slice(prefixoApi.length);
  if (caminho === 'v1/sessao' || caminho.startsWith('v1/sessao/')) return;
  const contrato = Number(Array.isArray(valor) ? valor[0] : valor);
  if (!contratoAceito(contrato, { contract: VERSAO_CONTRATO, minimumClientContract: CONTRATO_MINIMO_INTERFACE })) {
    throw new ErroHttp(
      409,
      'VERSAO_INCOMPATIVEL',
      'Esta tela é de outra versão do Praça Reversa e não pode gravar. Nada foi registrado: atualize o aplicativo e confira os dados antes de repetir.',
    );
  }
}

export function registrarSeguranca(app: FastifyInstance, caminhoBase = '/'): void {
  const prefixoApi = `${caminhoBase}api/`;
  // Só JSON é aceito: formulários de outros sites (text/plain, urlencoded,
  // multipart) recebem 415 sem chegar às rotas.
  app.removeContentTypeParser('text/plain');

  app.addHook('onRequest', (request, _reply, pronto) => {
    try {
      if (request.url.startsWith(prefixoApi) && ehMutavel(request.method)) {
        verificarOrigem(request);
        verificarContrato(request, prefixoApi);
      }
      pronto();
    } catch (erro) {
      pronto(erro as Error);
    }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    if (request.url.startsWith(prefixoApi)) {
      // Nada da API vai para cache (HTTP nem service worker; ver vite.config.ts).
      reply.header('cache-control', 'no-store');
      reply.header(CABECALHO_CONTRATO, String(VERSAO_CONTRATO));
    }
  });
}
