import type { EnviarSeparacao, NotaEnviadaSeparacao } from '@praca-reversa/contracts';

/**
 * Lê a planilha do cliente no navegador e devolve só as notas. A planilha real
 * tem 33 linhas e 6 MB (108 MB de células vazias formatadas): não caberia no
 * limite de envio da Vercel (4,5 MB). A aba é lida em fluxo, sem carregar tudo
 * na memória. Só XLSX; nada é presumido além dos cabeçalhos abaixo.
 */

const MAX_BYTES = 60 * 1_048_576;
const MAX_NOTAS = 5_000;

export class ErroPlanilha extends Error {}

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Cabeçalhos aceitos de cada coluna; só NUMERO é obrigatória. */
const COLUNAS = {
  numero: ['numero', 'numero da nf', 'nf', 'nota fiscal'],
  tipo: ['tipo', 'tipo documento'],
  delivery: ['delivery'],
  volumes: ['volumes', 'volume'],
  remetente: ['remetente'],
  palete: ['n do palete', 'n palete', 'n pallet', 'no pallet', 'n do pallet', 'palete'],
  rua: ['rua', 'endereco'],
  janela: ['janela'],
} as const;

const ENTIDADES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (t: string) =>
  t.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTIDADES[e] ?? '';
  });

interface EntradaZip {
  metodo: number;
  tamanho: number;
  inicioCabecalho: number;
}

function lerCentral(b: ArrayBuffer): Map<string, EntradaZip> {
  const v = new DataView(b);
  let fim = -1;
  for (let i = b.byteLength - 22; i >= Math.max(0, b.byteLength - 66_000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new ErroPlanilha('Este arquivo não é uma planilha .xlsx.');
  const total = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const entradas = new Map<string, EntradaZip>();
  const texto = new TextDecoder();
  for (let i = 0; i < total; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new ErroPlanilha('Planilha .xlsx danificada.');
    const metodo = v.getUint16(p + 10, true);
    const tamanho = v.getUint32(p + 20, true);
    const nome = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true);
    const comentario = v.getUint16(p + 32, true);
    const inicioCabecalho = v.getUint32(p + 42, true);
    entradas.set(texto.decode(new Uint8Array(b, p + 46, nome)), { metodo, tamanho, inicioCabecalho });
    p += 46 + nome + extra + comentario;
  }
  return entradas;
}

function fluxoDe(b: ArrayBuffer, e: EntradaZip): ReadableStream<Uint8Array> {
  const v = new DataView(b);
  const inicio = e.inicioCabecalho + 30 + v.getUint16(e.inicioCabecalho + 26, true) + v.getUint16(e.inicioCabecalho + 28, true);
  const dados = new Blob([new Uint8Array(b, inicio, e.tamanho)]).stream();
  if (e.metodo === 0) return dados;
  if (e.metodo !== 8) throw new ErroPlanilha('Planilha .xlsx com compressão não suportada.');
  return dados.pipeThrough(new DecompressionStream('deflate-raw'));
}

async function textoDe(b: ArrayBuffer, e: EntradaZip | undefined): Promise<string> {
  if (e === undefined) return '';
  return new Response(fluxoDe(b, e)).text();
}

async function compartilhadas(b: ArrayBuffer, e: EntradaZip | undefined): Promise<string[]> {
  const xml = await textoDe(b, e);
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    decodificar(
      [...(m[1] ?? '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((t) => t[1] ?? '')
        .join(''),
    ),
  );
}

async function primeiraAba(b: ArrayBuffer, entradas: Map<string, EntradaZip>): Promise<EntradaZip> {
  const livro = await textoDe(b, entradas.get('xl/workbook.xml'));
  const rels = await textoDe(b, entradas.get('xl/_rels/workbook.xml.rels'));
  const id = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(livro)?.[1];
  const rel = id === undefined ? undefined : [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${id}"`));
  const alvo = rel === undefined ? undefined : /Target="([^"]+)"/.exec(rel)?.[1];
  const caminho = alvo === undefined ? undefined : alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo}`;
  const aba = (caminho === undefined ? undefined : entradas.get(caminho)) ?? [...entradas].find(([n]) => /^xl\/worksheets\/[^/]+\.xml$/.test(n))?.[1];
  if (aba === undefined) throw new ErroPlanilha('A planilha não tem nenhuma aba.');
  return aba;
}

const colunaDe = (ref: string) => {
  let n = 0;
  for (const c of ref) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

/** Células com valor de uma linha `<row>`: coluna → texto. */
export function celulasDaLinha(xml: string, textos: readonly string[]): Map<number, string> {
  const r = new Map<number, string>();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const corpo = m[2];
    if (corpo === undefined) continue;
    const atributos = m[1] ?? '';
    const ref = /\br="([A-Z]+)\d+"/.exec(atributos)?.[1];
    if (ref === undefined) continue;
    const tipo = /\bt="([a-zA-Z]+)"/.exec(atributos)?.[1];
    let valor: string | undefined;
    if (tipo === 'inlineStr') valor = decodificar([...corpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? '').join(''));
    else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      if (v === undefined) continue;
      valor = tipo === 's' ? textos[Number(v)] : tipo === 'str' ? decodificar(v) : v.replace(/\.0+$/, '');
    }
    const limpo = (valor ?? '').trim();
    if (limpo !== '') r.set(colunaDe(ref), limpo.slice(0, 300));
  }
  return r;
}

/** Janela gravada como data do Excel (número de série) vira AAAA-MM-DD; texto fica como veio. */
export function janelaLida(t: string): string {
  if (!/^\d{5}$/.test(t)) return t;
  return new Date(Date.UTC(1899, 11, 30) + Number(t) * 86_400_000).toISOString().slice(0, 10);
}

/** Percorre as linhas da aba em fluxo, entregando só as que têm valor. */
async function percorrer(fluxo: ReadableStream<Uint8Array>, aoLer: (numero: number, xml: string) => void): Promise<void> {
  const leitor = fluxo.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let resto = '';
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) return;
    resto += value;
    const fim = resto.lastIndexOf('</row>');
    // Sem linha completa neste pedaço: continua acumulando.
    if (fim < 0) continue;
    // Linha vazia autofechada (<row .../>) sairia emendada na seguinte.
    const pronto = resto.slice(0, fim + 6).replace(/<row\b[^>]*\/>/g, '');
    resto = resto.slice(fim + 6);
    for (const m of pronto.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const corpo = m[2] ?? '';
      if (!corpo.includes('<v>') && !corpo.includes('<t')) continue;
      aoLer(Number(/\br="(\d+)"/.exec(m[1] ?? '')?.[1] ?? 0), corpo);
    }
  }
}

type Colunas = Record<keyof typeof COLUNAS, number | undefined>;

/** Valor gravado como data pelo Excel é mostrado como data só na coluna JANELA; o resto fica como veio. */

export async function lerPlanilhaSeparacao(arquivo: Blob, nomeArquivo: string): Promise<EnviarSeparacao> {
  if (arquivo.size > MAX_BYTES) throw new ErroPlanilha('Arquivo acima de 60 MB.');
  const b = await arquivo.arrayBuffer();
  const entradas = lerCentral(b);
  const textos = await compartilhadas(b, entradas.get('xl/sharedStrings.xml'));
  const aba = await primeiraAba(b, entradas);
  const notes: NotaEnviadaSeparacao[] = [];
  const estado: { janela: string | null; col: Colunas | null; titulos: Map<number, string> } = { janela: null, col: null, titulos: new Map() };
  await percorrer(fluxoDe(b, aba), (numero, xml) => {
    const celulas = celulasDaLinha(xml, textos);
    if (celulas.size === 0) return;
    if (estado.col === null) {
      estado.titulos = new Map([...celulas].map(([c, t]) => [c, t.slice(0, 100)]));
      const nomes = new Map([...celulas].map(([c, t]) => [normalizar(t), c]));
      const achar = (lista: readonly string[]) => lista.map((n) => nomes.get(n)).find((c) => c !== undefined);
      estado.col = { numero: achar(COLUNAS.numero), tipo: achar(COLUNAS.tipo), delivery: achar(COLUNAS.delivery), volumes: achar(COLUNAS.volumes), remetente: achar(COLUNAS.remetente), palete: achar(COLUNAS.palete), rua: achar(COLUNAS.rua), janela: achar(COLUNAS.janela) };
      if (estado.col.numero === undefined) throw new ErroPlanilha('A planilha não tem a coluna NUMERO na primeira linha.');
      return;
    }
    const c = estado.col;
    const valor = (i: number | undefined) => (i === undefined ? null : (celulas.get(i) ?? null));
    const lida = valor(c.janela);
    if (estado.janela === null && lida !== null) estado.janela = janelaLida(lida);
    const num = valor(c.numero);
    if (num === null) return;
    if (notes.length >= MAX_NOTAS) throw new ErroPlanilha(`A planilha tem mais de ${String(MAX_NOTAS)} notas.`);
    const values: Record<string, string> = {};
    for (const [coluna, titulo] of estado.titulos) {
      const v = celulas.get(coluna);
      if (v !== undefined) values[titulo] = coluna === c.janela ? janelaLida(v) : v;
    }
    notes.push({ row: numero, number: num, type: valor(c.tipo), delivery: valor(c.delivery), volumes: valor(c.volumes), sender: valor(c.remetente), informedPallet: valor(c.palete), informedAddress: valor(c.rua), values });
  });
  if (estado.col === null) throw new ErroPlanilha('A planilha está vazia.');
  if (notes.length === 0) throw new ErroPlanilha('Nenhuma nota na coluna NUMERO desta planilha.');
  return { fileName: nomeArquivo.slice(0, 200), window: estado.janela, headers: [...new Set(estado.titulos.values())], notes };
}
