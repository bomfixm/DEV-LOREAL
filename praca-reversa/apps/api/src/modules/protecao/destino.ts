/**
 * Destino independente das cópias (planilha e backup completo), 26 out. 2026.
 *
 * Dois tipos, os dois com a mesma garantia: `gravar` só devolve depois de
 * reler o arquivo NO DESTINO e conferir tamanho e SHA-256 (gravação remota
 * confirmada, não "arquivo temporário criado").
 *
 * - S3: armazenamento de objetos compatível com a API S3 (AWS S3, Cloudflare
 *   R2, Backblaze B2, MinIO…), assinatura AWS Signature V4 feita aqui
 *   (node:crypto + fetch, sem dependência nova). Cada PUT é atômico para quem
 *   lê (o objeto antigo ou o novo, nunca pela metade) e leva Content-MD5 (o
 *   serviço recusa corpo alterado no caminho).
 * - PASTA: compartilhamento de rede de OUTRA máquina (\\servidor\pasta). Grava
 *   num temporário na mesma pasta e renomeia por cima (troca atômica).
 *
 * Independência: decidida na configuração (config.ts) a partir do endereço —
 * pasta no disco deste servidor (inclusive a sincronizada pelo OneDrive, cuja
 * subida não é comprovável aqui) e serviço em localhost NÃO são independentes.
 * Credenciais ficam só na memória do processo; nunca em descrição, erro ou log.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

export type TipoDestino = 'S3' | 'PASTA';

export interface ObjetoDestino {
  chave: string;
  tamanho: number;
  modificadoEm: Date | null;
}

export interface Destino {
  readonly tipo: TipoDestino;
  /** Para a tela, a planilha e o registro: sem credencial nem caminho interno do servidor. */
  readonly descricao: string;
  /** Fora deste servidor (pelo tipo e endereço configurados). */
  readonly independente: boolean;
  /** Por que não conta como independente (nulo quando conta). */
  readonly motivo: string | null;
  /** Grava e confirma relendo do destino (tamanho e SHA-256). */
  gravar(chave: string, conteudo: Buffer, tipoConteudo: string): Promise<{ sha256: string; tamanho: number }>;
  /** Conteúdo do objeto, ou `null` se não existe. */
  ler(chave: string): Promise<Buffer | null>;
  listar(prefixo: string): Promise<ObjetoDestino[]>;
  apagar(chave: string): Promise<void>;
}

export const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** Chave relativa segura: letras, números, ponto, hífen, sublinhado e barra; sem "..", sem barra inicial. */
export function chaveValida(chave: string): string {
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(chave) || chave.split('/').some((p) => p === '.' || p === '..')) {
    throw new Error(`Chave de destino inválida: ${chave}`);
  }
  return chave;
}

class ErroDestino extends Error {}

function conferir(chave: string, esperado: Buffer, lido: Buffer | null): { sha256: string; tamanho: number } {
  const hash = sha256(esperado);
  if (lido === null) throw new ErroDestino(`Destino não devolveu ${chave} depois da gravação (gravação não confirmada).`);
  if (lido.length !== esperado.length || sha256(lido) !== hash) throw new ErroDestino(`O arquivo ${chave} relido do destino não confere com o enviado (tamanho ou SHA-256 diferente).`);
  return { sha256: hash, tamanho: esperado.length };
}

// ---------- Pasta (compartilhamento de rede) ----------

export class DestinoPasta implements Destino {
  readonly tipo = 'PASTA' as const;

  constructor(
    private readonly raiz: string,
    readonly descricao: string,
    readonly independente: boolean,
    readonly motivo: string | null,
  ) {}

  private caminho(chave: string): string {
    return join(this.raiz, ...chaveValida(chave).split('/'));
  }

  async gravar(chave: string, conteudo: Buffer, _tipoConteudo?: string): Promise<{ sha256: string; tamanho: number }> {
    const final = this.caminho(chave);
    mkdirSync(dirname(final), { recursive: true });
    const temporario = join(dirname(final), `.${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`);
    try {
      const fd = openSync(temporario, 'wx', 0o600);
      try {
        let escrito = 0;
        while (escrito < conteudo.length) escrito += writeSync(fd, conteudo, escrito, conteudo.length - escrito);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporario, final);
    } finally {
      rmSync(temporario, { force: true });
    }
    return Promise.resolve(conferir(chave, conteudo, await this.ler(chave)));
  }

  ler(chave: string): Promise<Buffer | null> {
    const c = this.caminho(chave);
    return Promise.resolve(existsSync(c) ? readFileSync(c) : null);
  }

  listar(prefixo: string): Promise<ObjetoDestino[]> {
    const base = prefixo === '' ? this.raiz : this.caminho(prefixo.replace(/\/+$/, ''));
    if (!existsSync(base)) return Promise.resolve([]);
    const relativo = prefixo === '' ? '' : `${prefixo.replace(/\/+$/, '')}/`;
    const itens: ObjetoDestino[] = [];
    for (const nome of readdirSync(base, { recursive: true }).map(String)) {
      const partes = nome.split(sep);
      if (partes.some((p) => p.startsWith('.'))) continue;
      const info = statSync(join(base, nome));
      if (info.isFile()) itens.push({ chave: `${relativo}${partes.join('/')}`, tamanho: info.size, modificadoEm: info.mtime });
    }
    return Promise.resolve(itens.sort((a, b) => a.chave.localeCompare(b.chave)));
  }

  apagar(chave: string): Promise<void> {
    rmSync(this.caminho(chave), { force: true });
    return Promise.resolve();
  }
}

// ---------- S3 compatível (AWS Signature V4) ----------

export interface ConfigS3 {
  /** Origem do serviço, ex.: https://s3.sa-east-1.amazonaws.com ou https://<conta>.r2.cloudflarestorage.com. */
  endpoint: string;
  regiao: string;
  bucket: string;
  /** Prefixo das chaves no bucket (sem barras nas pontas; pode ser vazio). */
  prefixo: string;
  /** CAMINHO (https://host/bucket/chave) ou VIRTUAL (https://bucket.host/chave). */
  estilo: 'CAMINHO' | 'VIRTUAL';
  chaveAcesso: string;
  segredo: string;
  tempoLimiteMs?: number;
}

/** Codificação RFC 3986 da SigV4 (S3: a barra da chave fica literal no caminho). */
export function codificarSigV4(texto: string, manterBarra: boolean): string {
  const c = encodeURIComponent(texto).replace(/[!'()*]/g, (x) => `%${x.charCodeAt(0).toString(16).toUpperCase()}`);
  return manterBarra ? c.replace(/%2F/g, '/') : c;
}

export interface PedidoAssinado {
  metodo: string;
  url: URL;
  /** Cabeçalhos a assinar além de host (nomes em qualquer caixa). */
  cabecalhos: Readonly<Record<string, string>>;
  hashCorpo: string;
  regiao: string;
  chaveAcesso: string;
  segredo: string;
  instante: Date;
}

/** Instante no formato da SigV4 (20130524T000000Z). */
export const dataAmz = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** Cabeçalho Authorization da AWS Signature V4 (serviço s3). Função pura (testada com os exemplos da AWS). */
export function assinarSigV4(p: PedidoAssinado): { authorization: string; amzDate: string } {
  const amzDate = dataAmz(p.instante);
  const dia = amzDate.slice(0, 8);
  const cab = new Map<string, string>([['host', p.url.host]]);
  for (const [k, v] of Object.entries(p.cabecalhos)) cab.set(k.toLowerCase(), v.trim().replace(/\s+/g, ' '));
  const nomes = [...cab.keys()].sort();
  const consulta = [...p.url.searchParams.entries()]
    .map(([k, v]) => [codificarSigV4(k, false), codificarSigV4(v, false)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const caminho = p.url.pathname
    .split('/')
    .map((s) => codificarSigV4(decodeURIComponent(s), false))
    .join('/');
  const canonico = [p.metodo, caminho || '/', consulta, nomes.map((n) => `${n}:${cab.get(n) ?? ''}\n`).join(''), nomes.join(';'), p.hashCorpo].join('\n');
  const escopo = `${dia}/${p.regiao}/s3/aws4_request`;
  const assinar = ['AWS4-HMAC-SHA256', amzDate, escopo, sha256(canonico)].join('\n');
  const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();
  const chave = hmac(hmac(hmac(hmac(`AWS4${p.segredo}`, dia), p.regiao), 's3'), 'aws4_request');
  const assinatura = createHmac('sha256', chave).update(assinar).digest('hex');
  return { authorization: `AWS4-HMAC-SHA256 Credential=${p.chaveAcesso}/${escopo}, SignedHeaders=${nomes.join(';')}, Signature=${assinatura}`, amzDate };
}

const XML_TEXTO = (xml: string, tag: string): string[] => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1] ?? '');
const desfazerXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export class DestinoS3 implements Destino {
  readonly tipo = 'S3' as const;

  constructor(
    private readonly c: ConfigS3,
    readonly descricao: string,
    readonly independente: boolean,
    readonly motivo: string | null,
  ) {}

  private url(chave: string | null, consulta: Record<string, string> = {}): URL {
    const base = new URL(this.c.endpoint);
    const completa = chave === null ? null : [this.c.prefixo, chaveValida(chave)].filter((x) => x !== '').join('/');
    const caminhoObjeto = completa === null ? '' : `/${codificarSigV4(completa, true)}`;
    const url =
      this.c.estilo === 'VIRTUAL'
        ? new URL(`${base.protocol}//${this.c.bucket}.${base.host}${caminhoObjeto || '/'}`)
        : new URL(`${base.protocol}//${base.host}/${encodeURIComponent(this.c.bucket)}${caminhoObjeto}`);
    for (const [k, v] of Object.entries(consulta)) url.searchParams.set(k, v);
    return url;
  }

  private async pedir(metodo: 'GET' | 'PUT' | 'DELETE', url: URL, corpo: Buffer | null, extra: Record<string, string> = {}): Promise<Response> {
    const hashCorpo = sha256(corpo ?? Buffer.alloc(0));
    const instante = new Date();
    const cabecalhos = { ...extra, 'x-amz-content-sha256': hashCorpo, 'x-amz-date': dataAmz(instante) };
    const { authorization } = assinarSigV4({ metodo, url, cabecalhos, hashCorpo, regiao: this.c.regiao, chaveAcesso: this.c.chaveAcesso, segredo: this.c.segredo, instante });
    try {
      return await fetch(url, {
        method: metodo,
        headers: { ...cabecalhos, authorization },
        ...(corpo === null ? {} : { body: new Uint8Array(corpo) }),
        signal: AbortSignal.timeout(this.c.tempoLimiteMs ?? 120_000),
      });
    } catch (erro) {
      // Mensagem sem URL assinada nem credencial.
      throw new ErroDestino(`Destino S3 indisponível (${url.host}): ${erro instanceof Error ? erro.name : 'erro de rede'}.`);
    }
  }

  private async falha(r: Response, acao: string): Promise<ErroDestino> {
    const corpo = await r.text().catch(() => '');
    const codigo = XML_TEXTO(corpo, 'Code')[0] ?? '';
    return new ErroDestino(`Destino S3 recusou ${acao}: HTTP ${String(r.status)}${codigo ? ` (${codigo})` : ''}.`);
  }

  async gravar(chave: string, conteudo: Buffer, tipoConteudo: string): Promise<{ sha256: string; tamanho: number }> {
    const md5 = createHash('md5').update(conteudo).digest('base64');
    const r = await this.pedir('PUT', this.url(chave), conteudo, { 'content-type': tipoConteudo, 'content-md5': md5, 'x-amz-meta-sha256': sha256(conteudo) });
    if (!r.ok) throw await this.falha(r, `a gravação de ${chave}`);
    await r.arrayBuffer().catch(() => undefined);
    return conferir(chave, conteudo, await this.ler(chave));
  }

  async ler(chave: string): Promise<Buffer | null> {
    const r = await this.pedir('GET', this.url(chave), null);
    if (r.status === 404) {
      await r.arrayBuffer().catch(() => undefined);
      return null;
    }
    if (!r.ok) throw await this.falha(r, `a leitura de ${chave}`);
    return Buffer.from(await r.arrayBuffer());
  }

  async listar(prefixo: string): Promise<ObjetoDestino[]> {
    const base = this.c.prefixo === '' ? '' : `${this.c.prefixo}/`;
    const itens: ObjetoDestino[] = [];
    let continuacao: string | null = null;
    do {
      const consulta: Record<string, string> = { 'list-type': '2', prefix: `${base}${prefixo}` };
      if (continuacao !== null) consulta['continuation-token'] = continuacao;
      const r = await this.pedir('GET', this.url(null, consulta), null);
      if (!r.ok) throw await this.falha(r, 'a listagem');
      const xml = await r.text();
      for (const bloco of XML_TEXTO(xml, 'Contents')) {
        const chave = desfazerXml(XML_TEXTO(bloco, 'Key')[0] ?? '');
        if (!chave.startsWith(base)) continue;
        const data = XML_TEXTO(bloco, 'LastModified')[0];
        itens.push({ chave: chave.slice(base.length), tamanho: Number(XML_TEXTO(bloco, 'Size')[0] ?? 0), modificadoEm: data ? new Date(data) : null });
      }
      continuacao = (XML_TEXTO(xml, 'IsTruncated')[0] ?? 'false') === 'true' ? desfazerXml(XML_TEXTO(xml, 'NextContinuationToken')[0] ?? '') || null : null;
    } while (continuacao !== null);
    return itens.sort((a, b) => a.chave.localeCompare(b.chave));
  }

  async apagar(chave: string): Promise<void> {
    const r = await this.pedir('DELETE', this.url(chave), null);
    if (!r.ok && r.status !== 404) throw await this.falha(r, `a remoção de ${chave}`);
    await r.arrayBuffer().catch(() => undefined);
  }
}

/** Gravação de verificação (escreve, relê, apaga): comprova acesso e permissão sem tocar nas cópias. */
export async function verificarDestino(d: Destino, agora: Date): Promise<void> {
  const chave = `verificacao/teste-${agora.toISOString().replace(/[-:.]/g, '')}-${randomBytes(4).toString('hex')}.txt`;
  await d.gravar(chave, Buffer.from(`Praça Reversa: verificação de gravação em ${agora.toISOString()}\n`, 'utf8'), 'text/plain; charset=utf-8');
  await d.apagar(chave);
}
