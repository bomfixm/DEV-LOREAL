// Função da API do Praça Reversa na Vercel (Node.js, Build Output API).
// Atende /api/* com a MESMA aplicação Fastify (injeção de requisições), via o
// adaptador compartilhado com a versão Netlify. O build empacota este arquivo
// em .vercel/output/functions/api.func/index.mjs (scripts/vercel-build.mjs).
import type { IncomingMessage, ServerResponse } from 'node:http';
import pacoteApi from '../apps/api/package.json' with { type: 'json' };
import desenhoAprovado from '../examples/layout-desenho-aprovado.json' with { type: 'json' };
import caSupabase from './supabase-ca.pem';
import { definirVersaoEmbutida } from '../apps/api/src/config.ts';
import { definirDesenhoAprovadoEmbutido } from '../apps/api/src/modules/layout/desenho-aprovado.ts';
import { criarAppFuncao, criarObtentor, respostaIndisponivel, responderComFastify } from '../apps/api/src/netlify/adaptador.ts';

process.env.DB_SSL_CA ??= caSupabase;
definirVersaoEmbutida(pacoteApi.version);
definirDesenhoAprovadoEmbutido(desenhoAprovado);

const obterApp = criarObtentor(() => criarAppFuncao(process.env));

async function lerCorpo(req: IncomingMessage): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const parte of req) partes.push(Buffer.isBuffer(parte) ? parte : Buffer.from(parte as string));
  return Buffer.concat(partes);
}

/** O cabeçalho vem da borda da Vercel (sobrescrito por ela); nunca do visitante. */
function ipDoVisitante(req: IncomingMessage): string | undefined {
  const bruto = req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  return valor?.split(',')[0]?.trim() || undefined;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = String(req.headers['x-vercel-id'] ?? '');
  let resposta: Response;
  try {
    const app = await obterApp();
    const metodo = (req.method ?? 'GET').toUpperCase();
    const protocolo = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0]?.trim() || 'https';
    const host = String(req.headers.host ?? 'localhost');
    const cabecalhos = new Headers();
    for (const [nome, valor] of Object.entries(req.headers)) {
      if (valor === undefined) continue;
      for (const v of Array.isArray(valor) ? valor : [valor]) cabecalhos.append(nome, v);
    }
    const corpo = metodo === 'GET' || metodo === 'HEAD' ? undefined : new Uint8Array(await lerCorpo(req));
    const requisicao = new Request(`${protocolo}://${host}${req.url ?? '/'}`, { method: metodo, headers: cabecalhos, ...(corpo === undefined ? {} : { body: corpo }) });
    resposta = await responderComFastify(app, requisicao, { ip: ipDoVisitante(req), requestId });
  } catch (erro) {
    // Sem a URL do banco nem segredos; a próxima solicitação tenta inicializar de novo.
    console.error('Praça Reversa: falha na API', erro instanceof Error ? erro.message.replace(/postgres(ql)?:\/\/\S+/gi, '[url]') : 'erro');
    resposta = respostaIndisponivel(requestId || undefined);
  }
  res.statusCode = resposta.status;
  const cookies = resposta.headers.getSetCookie();
  resposta.headers.forEach((valor, nome) => {
    if (nome.toLowerCase() !== 'set-cookie') res.setHeader(nome, valor);
  });
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await resposta.arrayBuffer()));
}
