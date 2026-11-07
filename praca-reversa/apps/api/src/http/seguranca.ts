import { CABECALHO_CONTRATO, CONTRATO_MINIMO_INTERFACE, VERSAO_CONTRATO, contratoAceito } from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
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

/**
 * Política de conteúdo: a página só executa scripts do próprio servidor (mais os
 * scripts embutidos do index.html, liberados um a um pelo hash) e só conversa
 * com o próprio servidor. Assim, um texto malicioso que consiga entrar numa tela
 * não roda código nem envia dados para fora. `wasm-unsafe-eval` é exigido pelo
 * leitor de código de barras e pelo OCR (WebAssembly local); `blob:` serve a
 * foto da câmera e os trabalhadores. Estilos embutidos são necessários para o
 * React (atributo style) e não executam código.
 */
export function montarPoliticaDeConteudo(indiceHtml: string | null): string {
  const hashes: string[] = [];
  if (indiceHtml !== null) {
    for (const achado of indiceHtml.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const conteudo = achado[1] ?? '';
      if (conteudo.trim() === '') continue;
      hashes.push(`'sha256-${createHash('sha256').update(conteudo).digest('base64')}'`);
    }
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export interface OpcoesSeguranca {
  /** Política de conteúdo (ver `montarPoliticaDeConteudo`); `null` não envia. */
  politicaDeConteudo?: string | null;
  /** Só com HTTPS: manda o navegador usar sempre cadeado neste endereço. */
  hsts?: boolean;
}

export function registrarSeguranca(app: FastifyInstance, caminhoBase = '/', opcoes: OpcoesSeguranca = {}): void {
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
    // A câmera é usada pela própria tela (leitura de código e foto da nota); o resto fica desligado.
    reply.header('permissions-policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    if (opcoes.politicaDeConteudo) reply.header('content-security-policy', opcoes.politicaDeConteudo);
    if (opcoes.hsts === true) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (request.url.startsWith(prefixoApi)) {
      // Nada da API vai para cache (HTTP nem service worker; ver vite.config.ts).
      reply.header('cache-control', 'no-store');
      reply.header(CABECALHO_CONTRATO, String(VERSAO_CONTRATO));
    }
  });
}
