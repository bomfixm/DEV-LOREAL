/**
 * Adaptador da API para Netlify Functions (API v2: `Request` → `Response`),
 * sem servidor nem porta: a MESMA aplicação Fastify (`criarApp`) atende pela
 * injeção de requisições (`app.inject`), com todas as rotas, autenticação,
 * CSRF, perfis, escopo, idempotência e controle de versão.
 *
 * - Aplicação e pool criados uma vez por instância; se a criação falhar, a
 *   promessa é descartada e a próxima solicitação tenta de novo (nada fica
 *   rejeitado em cache). O pool não é encerrado ao fim de cada solicitação.
 * - Corpo como bytes (uploads/downloads binários sem conversão para texto);
 *   cabeçalhos repetidos (vários `Set-Cookie`) preservados.
 * - IP vem do metadado da plataforma (`context.ip`); `Host` vem da URL da
 *   solicitação recebida pela plataforma (a defesa de origem compara com ele).
 *   Cabeçalhos `X-Forwarded-*` do visitante não são considerados.
 */
import type { FastifyInstance, InjectOptions } from 'fastify';
import { criarApp } from '../app.js';
import { lerConfiguracao } from '../config.js';
import { criarBanco } from '../db/cliente.js';

export interface ContextoFuncao {
  ip?: string;
  requestId?: string;
}

/** Promessa única por instância; descartada em falha (a próxima chamada tenta de novo). */
export function criarObtentor<T>(criar: () => Promise<T>): () => Promise<T> {
  let atual: Promise<T> | null = null;
  return () => {
    atual ??= criar().catch((erro: unknown) => {
      atual = null;
      throw erro;
    });
    return atual;
  };
}

const numero = (v: string | undefined, padrao: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : padrao;
};

/** Aplicação para a função: sem interface (a CDN serve os arquivos), sem agendador contínuo. */
export async function criarAppFuncao(env: NodeJS.ProcessEnv): Promise<FastifyInstance> {
  const config = lerConfiguracao(env, ['--sem-interface']);
  const db = criarBanco(
    config.databaseUrl,
    (erro) => {
      console.error('Erro em conexão ociosa do banco', erro.message);
    },
    { max: numero(env.DB_POOL_MAX, 3, 1, 20), conexaoTimeoutMs: numero(env.DB_CONEXAO_TIMEOUT_MS, 15_000, 1_000, 50_000), ociosoTimeoutMs: 10_000 },
  );
  const app = await criarApp({
    db,
    config,
    interfaceDir: null,
    limitesImportacao: config.limitesImportacao,
    limitesImportacaoPlanilha: config.limitesImportacaoPlanilha,
    exportacaoMaxLinhas: config.exportacaoMaxLinhas,
    claims: config.claims,
    aplicativo: { versao: config.versao, caminhoBase: config.caminhoBase, persistenciaLocal: config.persistenciaLocal },
    planilha: { ...config.planilha, automatica: false },
    logger: { level: config.logLevel, redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'] },
  });
  await app.ready();
  return app;
}

const SEM_CORPO = new Set([101, 204, 205, 304]);
const NAO_REPASSAR = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'host', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip']);

/** Converte a solicitação da plataforma numa injeção no Fastify e a resposta de volta. */
export async function responderComFastify(app: FastifyInstance, req: Request, contexto: ContextoFuncao): Promise<Response> {
  const url = new URL(req.url);
  const metodo = req.method.toUpperCase();
  const corpo = metodo === 'GET' || metodo === 'HEAD' ? undefined : Buffer.from(await req.arrayBuffer());
  const cabecalhos: Record<string, string> = {};
  req.headers.forEach((valor, nome) => {
    if (!NAO_REPASSAR.has(nome.toLowerCase())) cabecalhos[nome.toLowerCase()] = valor;
  });
  cabecalhos.host = url.host;
  const r = await app.inject({
    method: metodo as NonNullable<InjectOptions['method']>,
    url: `${url.pathname}${url.search}`,
    headers: cabecalhos,
    ...(corpo === undefined ? {} : { payload: corpo }),
    remoteAddress: contexto.ip ?? '0.0.0.0',
  });
  const saida = new Headers();
  for (const [nome, valor] of Object.entries(r.headers)) {
    if (valor === undefined || NAO_REPASSAR.has(nome.toLowerCase())) continue;
    for (const v of Array.isArray(valor) ? valor : [valor]) saida.append(nome, String(v));
  }
  const semCorpo = metodo === 'HEAD' || SEM_CORPO.has(r.statusCode);
  return new Response(semCorpo ? null : new Uint8Array(r.rawPayload), { status: r.statusCode, headers: saida });
}

/** Resposta da API quando a aplicação não inicializa (banco indisponível, configuração ausente). */
export function respostaIndisponivel(requestId: string | undefined): Response {
  return new Response(
    JSON.stringify({ error: { code: 'BANCO_INDISPONIVEL', message: 'Serviço indisponível no momento. Tente novamente em instantes.' }, ...(requestId ? { requestId } : {}) }),
    { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5' } },
  );
}
