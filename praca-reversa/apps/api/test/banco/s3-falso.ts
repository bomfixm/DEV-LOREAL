import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { assinarSigV4 } from '../../src/modules/protecao/destino.js';

/**
 * Serviço S3 compatível mínimo, só para os testes (127.0.0.1, memória):
 * PUT/GET/DELETE de objeto e listagem ListObjectsV2 paginada. Confere a
 * assinatura AWS SigV4 de cada pedido, o x-amz-content-sha256 e o Content-MD5
 * do corpo. Simula indisponibilidade (`falhar`) e leitura adulterada
 * (`adulterarLeitura`). Nenhum dado sai da máquina.
 */
export interface S3Falso {
  endpoint: string;
  bucket: string;
  objetos: Map<string, Buffer>;
  falhar: boolean;
  adulterarLeitura: boolean;
  porPagina: number;
  pedidos: { metodo: string; chave: string }[];
  parar: () => Promise<void>;
}

export const CREDENCIAIS_FALSAS = { chaveAcesso: 'AKIDTESTEPRACA000001', segredo: 'segredo-ficticio-apenas-para-teste', regiao: 'us-east-1' } as const;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function corpo(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => {
      resolver(Buffer.concat(partes));
    });
    req.on('error', rejeitar);
  });
}

export async function iniciarS3Falso(bucket = 'copias-praca'): Promise<S3Falso> {
  const estado: Omit<S3Falso, 'endpoint' | 'parar'> = { bucket, objetos: new Map(), falhar: false, adulterarLeitura: false, porPagina: 1_000, pedidos: [] };
  const servidor = createServer((req, res) => {
    void (async () => {
      const b = await corpo(req);
      const url = new URL(`http://${req.headers.host ?? ''}${req.url ?? '/'}`);
      const responder = (status: number, conteudo: string | Buffer = '', tipo = 'application/xml') => {
        res.writeHead(status, { 'content-type': tipo });
        res.end(conteudo);
      };
      const erro = (status: number, codigo: string) => {
        responder(status, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${codigo}</Code></Error>`);
      };
      if (estado.falhar) { erro(503, 'ServiceUnavailable'); return; }
      // Assinatura: recalculada com os cabeçalhos assinados recebidos.
      const auth = req.headers.authorization ?? '';
      const assinados = /SignedHeaders=([^,]+)/.exec(auth)?.[1]?.split(';') ?? [];
      const data = String(req.headers['x-amz-date'] ?? '');
      const instante = new Date(`${data.slice(0, 4)}-${data.slice(4, 6)}-${data.slice(6, 8)}T${data.slice(9, 11)}:${data.slice(11, 13)}:${data.slice(13, 15)}Z`);
      const cabecalhos: Record<string, string> = {};
      for (const n of assinados) if (n !== 'host') cabecalhos[n] = String(req.headers[n] ?? '');
      const hashCorpo = String(req.headers['x-amz-content-sha256'] ?? '');
      const esperado = assinarSigV4({ metodo: req.method ?? 'GET', url, cabecalhos, hashCorpo, regiao: CREDENCIAIS_FALSAS.regiao, chaveAcesso: CREDENCIAIS_FALSAS.chaveAcesso, segredo: CREDENCIAIS_FALSAS.segredo, instante });
      if (Number.isNaN(instante.getTime()) || esperado.authorization !== auth) { erro(403, 'SignatureDoesNotMatch'); return; }
      if (createHash('sha256').update(b).digest('hex') !== hashCorpo) { erro(400, 'XAmzContentSHA256Mismatch'); return; }
      const partes = url.pathname.split('/').filter((p) => p !== '');
      if (decodeURIComponent(partes[0] ?? '') !== bucket) { erro(404, 'NoSuchBucket'); return; }
      const chave = partes.slice(1).map(decodeURIComponent).join('/');
      estado.pedidos.push({ metodo: req.method ?? '', chave });
      if (req.method === 'PUT') {
        const md5 = req.headers['content-md5'];
        if (typeof md5 === 'string' && createHash('md5').update(b).digest('base64') !== md5) { erro(400, 'BadDigest'); return; }
        estado.objetos.set(chave, b);
        res.setHeader('etag', `"${createHash('md5').update(b).digest('hex')}"`);
        responder(200); return;
      }
      if (req.method === 'DELETE') {
        estado.objetos.delete(chave);
        responder(204); return;
      }
      if (req.method === 'GET' && chave === '' && url.searchParams.get('list-type') === '2') {
        const prefixo = url.searchParams.get('prefix') ?? '';
        const todas = [...estado.objetos.keys()].filter((k) => k.startsWith(prefixo)).sort();
        const inicio = Number(url.searchParams.get('continuation-token') ?? '0');
        const pagina = todas.slice(inicio, inicio + estado.porPagina);
        const mais = inicio + estado.porPagina < todas.length;
        responder(
          200,
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><IsTruncated>${String(mais)}</IsTruncated>${mais ? `<NextContinuationToken>${String(inicio + estado.porPagina)}</NextContinuationToken>` : ''}${pagina.map((k) => `<Contents><Key>${xml(k)}</Key><Size>${String(estado.objetos.get(k)?.length ?? 0)}</Size><LastModified>2026-10-26T12:00:00.000Z</LastModified></Contents>`).join('')}</ListBucketResult>`,
        ); return;
      }
      if (req.method === 'GET') {
        const o = estado.objetos.get(chave);
        if (!o) { erro(404, 'NoSuchKey'); return; }
        const enviado = estado.adulterarLeitura && o.length > 0 ? Buffer.concat([o.subarray(0, o.length - 1), Buffer.from([(o.at(-1) ?? 0) ^ 0xff])]) : o;
        responder(200, enviado, 'application/octet-stream'); return;
      }
      erro(405, 'MethodNotAllowed');
    })();
  });
  await new Promise<void>((r) => {
    servidor.listen(0, '127.0.0.1', r);
  });
  const { port } = servidor.address() as AddressInfo;
  const s3 = estado as S3Falso;
  s3.endpoint = `http://127.0.0.1:${String(port)}`;
  s3.parar = () =>
    new Promise((r) => {
      servidor.close(() => {
        r();
      });
    });
  return s3;
}
