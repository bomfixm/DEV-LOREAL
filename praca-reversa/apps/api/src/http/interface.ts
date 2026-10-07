import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const SEM_CACHE = 'no-cache';
const IMUTAVEL = 'public, max-age=31536000, immutable';

/**
 * O build precisa ter sido gerado para o mesmo caminho-base (CAMINHO_BASE no
 * build e no servidor); senão os arquivos e o service worker apontariam para
 * outro lugar. Falha clara na inicialização em vez de tela em branco.
 */
export function conferirBuildDaInterface(pasta: string, caminhoBase: string): void {
  const indice = readFileSync(join(pasta, 'index.html'), 'utf8');
  if (!indice.includes(`src="${caminhoBase}assets/`)) {
    throw new Error(
      `A interface em ${pasta} não foi gerada para o caminho-base "${caminhoBase}". Gere de novo com CAMINHO_BASE=${caminhoBase} npm run build.`,
    );
  }
}

/**
 * Serve o build da interface na mesma origem da API. Arquivos com hash em
 * /assets são imutáveis; index.html, manifest e service worker são revalidados
 * a cada abertura para que uma nova versão seja detectada.
 */
export async function registrarInterface(app: FastifyInstance, pasta: string, caminhoBase = '/'): Promise<void> {
  conferirBuildDaInterface(pasta, caminhoBase);
  await app.register(fastifyStatic, {
    root: pasta,
    prefix: caminhoBase,
    wildcard: false,
    cacheControl: false,
    setHeaders: (reply: FastifyReply, caminho: string) => {
      reply.header('cache-control', caminho.includes(`${sep}assets${sep}`) ? IMUTAVEL : SEM_CACHE);
    },
  });
}

/**
 * Rota da aplicação de página única: caminho sem extensão, dentro do
 * caminho-base e fora de /api. Pedidos à API, downloads e arquivos nunca
 * recebem o index.html como resposta.
 */
export function ehRotaDaInterface(metodo: string, url: string, caminhoBase = '/'): boolean {
  if (metodo !== 'GET' && metodo !== 'HEAD') return false;
  const caminho = url.split('?')[0] ?? '';
  if (!caminho.startsWith(caminhoBase)) return false;
  const interno = caminho.slice(caminhoBase.length);
  if (interno === 'api' || interno.startsWith('api/')) return false;
  const ultimo = interno.split('/').pop() ?? '';
  return !ultimo.includes('.');
}

export function enviarIndice(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', SEM_CACHE).sendFile('index.html');
}
