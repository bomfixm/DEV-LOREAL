import { z } from 'zod';
import { TipoDocumentoConteudoSchema } from './conteudos.js';

/**
 * Notas por foto (6 nov. 2026): fotografar as etiquetas do palete, ler NF e
 * remetente por OCR no próprio aparelho e completar delivery e volumes numa
 * tabela. A foto serve só para agilizar a digitação: NÃO é enviada nem guardada.
 * Enquanto é rascunho nada entra em estoque; a inclusão usa o cadastro real, uma vez.
 *
 * "01/02" NÃO significa sempre FULL. FULL: referência do palete na sequência
 * (volumes são manuais). Etiqueta comum: volume 1 de 2 (o total é sugestão a
 * confirmar, nunca soma por foto). Sem evidência explícita, o tipo fica pendente.
 */

export const TipoEtiquetaSchema = z.enum(['COMUM', 'FULL']);
export type TipoEtiqueta = z.infer<typeof TipoEtiquetaSchema>;

export const ROTULOS_TIPO_ETIQUETA: Readonly<Record<TipoEtiqueta, string>> = { COMUM: 'Etiqueta comum', FULL: 'Etiqueta FULL' };

/** Decisão quando a nota já existe no palete. */
export const DecisaoNotaFotoSchema = z.enum(['VINCULAR_FOTO', 'OUTRA_OCORRENCIA']);
export type DecisaoNotaFoto = z.infer<typeof DecisaoNotaFotoSchema>;

export const ROTULOS_DECISAO_NOTA_FOTO: Readonly<Record<DecisaoNotaFoto, string>> = {
  VINCULAR_FOTO: 'Desconsiderar a entrada e vincular só a foto à nota existente',
  OUTRA_OCORRENCIA: 'Manter como outra ocorrência, sem somar à existente',
};

export interface LeituraEtiqueta {
  /** Número da NF sem zeros à esquerda e sem sufixo ("000094123-1" vira "94123"). */
  number: string | null;
  /** Como foi lido ("000094123-1"). */
  numberRaw: string | null;
  /** Mais de um número possível: nenhum é escolhido, a revisão decide. */
  candidates: string[];
  sender: string | null;
  /** Delivery da etiqueta L'Oréal ("Dlv: 89341358"). */
  delivery: string | null;
  /** Referência x/y como lida, normalizada ("1/2"). */
  reference: string | null;
  /** Só com evidência explícita no texto; sem ela, null (a revisão pede). */
  labelKind: TipoEtiqueta | null;
}

const semZeros = (n: string) => n.replace(/^0+(?=\d)/, '');

/** Linhas que não são a NF nem o remetente (destinatário, endereço, documentos, códigos). */
const FORA_DO_REMETENTE = /destinat|cnpj|cpf|\bcep\b|\bie\b|inscri|endere|\brua\b|\bav\b|avenida|rodovia|\bbairro\b|\bvolumes?\b|\bvol\b|\bfull\b|emiss|\bdata\b|\bpedido\b|\bdelivery\b|\bpeso\b|\bdanfe\b|\bchave\b|\bnota\s+fiscal\b/i;

function pareceEmpresa(linha: string): boolean {
  if (FORA_DO_REMETENTE.test(linha)) return false;
  const letras = linha.replace(/[^\p{L}]/gu, '');
  if (letras.length < 4) return false;
  // Ruído de OCR costuma ter mais símbolos e dígitos do que letras.
  return letras.length / linha.replace(/\s/g, '').length >= 0.6;
}

const limparNome = (t: string) => t.replace(/^[^\p{L}\d]+|[^\p{L}\d.)]+$/gu, '').replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * Interpreta o texto lido da etiqueta. Prioriza a faixa da NF ("000094123-1") e
 * o rótulo Remetente; o remetente sem rótulo é a primeira empresa depois da
 * faixa (nunca "a primeira empresa da foto": a caixa ao fundo tem outros textos).
 * Não inventa: na dúvida devolve null.
 */
export function interpretarEtiqueta(texto: string): LeituraEtiqueta {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  const faixa = /(?<![\d])(0{2,}\d{3,9})\s*-\s*\d{1,3}(?!\d)/;
  const rotulada = /(?:\bN\.?\s*F\.?\s*(?:-?\s*e)?\b|\bNFD\b|\bNOTA\s+FISCAL\b)\s*(?:N[º°o.]*)?\s*[:.-]?\s*(\d{3,9})(?!\d)/i;

  const fortes = new Map<string, { bruto: string; indice: number }>();
  const fracos = new Map<string, { bruto: string; indice: number }>();
  linhas.forEach((linha, indice) => {
    const f = faixa.exec(linha);
    if (f?.[1] !== undefined) {
      const n = semZeros(f[1]);
      if (!fortes.has(n)) fortes.set(n, { bruto: f[0].replace(/\s+/g, ''), indice });
    }
    const r = rotulada.exec(linha);
    if (r?.[1] !== undefined) {
      const n = semZeros(r[1]);
      if (!fracos.has(n)) fracos.set(n, { bruto: r[1], indice });
    }
  });
  const fonte = fortes.size > 0 ? fortes : fracos;
  const candidatos = [...fonte.keys()];
  const unico = candidatos.length === 1 ? candidatos[0] : undefined;
  const achado = unico === undefined ? undefined : fonte.get(unico);

  // Remetente: rótulo primeiro; sem ele, a primeira empresa depois da faixa da NF.
  let sender: string | null = null;
  for (let i = 0; i < linhas.length && sender === null; i++) {
    const m = /remetente\s*[:-]?\s*(.*)$/i.exec(linhas[i] ?? '');
    if (!m) continue;
    const valor = limparNome(m[1] ?? '');
    if (valor !== '' && pareceEmpresa(valor)) sender = valor;
    else {
      const proxima = linhas[i + 1];
      if (proxima !== undefined && pareceEmpresa(proxima)) sender = limparNome(proxima);
    }
  }
  if (sender === null && achado !== undefined && fortes.size > 0) {
    const proxima = linhas.slice(achado.indice + 1).find(pareceEmpresa);
    if (proxima !== undefined) sender = limparNome(proxima);
  }

  // Etiqueta L'Oréal: "Cl: NOME" é o remetente e "Dlv: 89341358" é a delivery (o OCR confunde o "C" de Cl e o "l" de Dlv).
  if (sender === null) {
    for (const linha of linhas) {
      const m = /(?:^|[^\p{L}])[CG][lI1i]\s*:\s*(.+)$/u.exec(linha);
      const valor = limparNome(m?.[1] ?? '');
      if (valor !== '' && pareceEmpresa(valor)) {
        sender = valor;
        break;
      }
    }
  }
  let delivery: string | null = null;
  for (const linha of linhas) {
    const m = /\bD\s*[lIi1!|]+\s*v\s*[:.]?\s*(\d[\d ]{5,12}\d)/i.exec(linha);
    if (m?.[1] !== undefined) {
      delivery = m[1].replace(/\s/g, '');
      break;
    }
  }

  // Referência x/y: a barra de data (dd/mm/aaaa) fica de fora.
  const referencias = new Set<string>();
  for (const linha of linhas) {
    if (/emiss|\bdata\b/i.test(linha)) continue;
    // O OCR lê o CEP com barra ("202/0450"): não é fração.
    if (/\bCEP\b/i.test(linha)) continue;
    for (const m of linha.matchAll(/(?<![\d/])(\d{1,5})\s*\/\s*(\d{1,5})(?![\d/])/g)) {
      const x = Number(m[1]);
      const y = Number(m[2]);
      if (x >= 1 && y >= x) referencias.add(`${String(x)}/${String(y)}`);
    }
  }
  const reference = referencias.size === 1 ? ([...referencias][0] ?? null) : null;

  // Tipo só com evidência explícita: a presença de uma fração não indica FULL.
  const inteiro = linhas.join(' ');
  const labelKind: TipoEtiqueta | null = /\bFULL\b/i.test(inteiro) ? 'FULL' : null;

  return {
    number: unico ?? null,
    numberRaw: achado?.bruto ?? null,
    candidates: candidatos.length > 1 ? candidatos : [],
    sender: sender === '' ? null : sender,
    delivery,
    reference,
    labelKind,
  };
}

/**
 * Códigos de barras da etiqueta: quando legíveis, valem mais que o texto.
 * DHL: "12040854711-1-1545732-24-LOU-22" = NF 1545732, volume 22 de 24.
 * L'Oréal: a delivery é o código de 8 dígitos (Load e Carton têm 10 e 20).
 */
export function interpretarCodigos(valores: readonly string[]): { number: string | null; reference: string | null; delivery: string | null; raw: string | null } {
  for (const v of valores) {
    const m = /^\d{6,}-\d+-(\d{3,})-(\d+)-[A-Z]{2,5}-(\d+)$/.exec(v.trim());
    if (m) return { number: semZeros(m[1] ?? ''), reference: `${String(Number(m[3]))}/${String(Number(m[2]))}`, delivery: null, raw: v.trim() };
  }
  const delivery = valores.map((v) => v.trim()).find((v) => /^\d{8}$/.test(v));
  return { number: null, reference: null, delivery: delivery ?? null, raw: delivery ?? null };
}

/** Total indicado na etiqueta: só na comum. Em FULL "1/2" é sequência, não quantidade; é sugestão, nunca o físico. */
export function totalIndicado(tipo: TipoEtiqueta | null, referencia: string | null): number | null {
  if (tipo !== 'COMUM' || referencia === null) return null;
  const y = Number(referencia.split('/')[1]);
  return Number.isInteger(y) && y > 0 ? y : null;
}

const texto = (max: number) => z.string().trim().max(max);

export const ExistenteNotaFotoSchema = z.object({
  kind: z.enum(['REGISTRADO', 'IMPORTADO']),
  id: z.uuid(),
  label: z.string(),
  /** Falta CNPJ ou remetente: não dá para afirmar que é a mesma nota. */
  incomplete: z.boolean(),
});

export const NotaFotoSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  /** Identifica a foto de origem no aparelho (a imagem não vai ao servidor). */
  photoKey: z.string().nullable(),
  documentType: TipoDocumentoConteudoSchema.nullable(),
  documentNumber: z.string().nullable(),
  sender: z.string().nullable(),
  labelKind: TipoEtiquetaSchema.nullable(),
  labelReference: z.string().nullable(),
  delivery: z.string().nullable(),
  /** Vazio = não informado (nunca zero). */
  volumes: z.number().int().nullable(),
  decision: DecisaoNotaFotoSchema.nullable(),
  read: z.object({
    state: z.enum(['LIDA', 'FALHOU']),
    rawText: z.string().nullable(),
    numberRaw: z.string().nullable(),
    candidates: z.array(z.string()),
    /** Veio do código de barras (exato). */
    fromBarcode: z.boolean(),
  }),
  /** Mesma nota já no palete: pede decisão, nunca soma. */
  existing: z.array(ExistenteNotaFotoSchema),
  /** O que falta para incluir (texto para a pessoa). */
  missing: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type NotaFoto = z.infer<typeof NotaFotoSchema>;

export const NotasFotoPaleteSchema = z.object({
  pallet: z.object({ id: z.uuid(), code: z.string(), address: z.string().nullable() }),
  items: z.array(NotaFotoSchema),
  /** Já incluídas ou vinculadas neste palete. */
  done: z.number().int().nonnegative(),
});
export type NotasFotoPalete = z.infer<typeof NotasFotoPaleteSchema>;

/** Resultado da leitura feita no navegador: guardado como sugestão; nunca passa por cima do que a pessoa digitou. */
export const LeituraNotaFotoSchema = z.object({
  failed: z.boolean().default(false),
  rawText: texto(8_000).nullable().default(null),
  number: texto(60).nullable().default(null),
  numberRaw: texto(60).nullable().default(null),
  candidates: z.array(texto(60)).max(10).default([]),
  sender: texto(200).nullable().default(null),
  delivery: texto(60).nullable().default(null),
  /** Número ou delivery vieram do código de barras (exatos); senão, do texto: pedir conferência. */
  fromBarcode: z.boolean().default(false),
  reference: texto(30).nullable().default(null),
  labelKind: TipoEtiquetaSchema.nullable().default(null),
});
export type LeituraNotaFoto = z.input<typeof LeituraNotaFotoSchema>;

/** Nova linha a partir de uma foto lida no aparelho: só o texto e a chave (repetir não duplica). */
export const CriarNotaFotoSchema = LeituraNotaFotoSchema.extend({ photoKey: texto(300).min(1) });

const alteracoes = z
  .object({
    documentType: TipoDocumentoConteudoSchema.nullable(),
    documentNumber: texto(60).nullable(),
    sender: texto(200).nullable(),
    labelKind: TipoEtiquetaSchema.nullable(),
    delivery: texto(60).nullable(),
    volumes: z.number().int().min(0).max(100_000).nullable(),
    decision: DecisaoNotaFotoSchema.nullable(),
  })
  .partial();
export type AlteracoesNotaFoto = z.infer<typeof alteracoes>;

export const SalvarNotasFotoSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), expectedVersion: z.number().int().positive(), changes: alteracoes })).min(1).max(500),
});
export const IncluirNotasFotoSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) });

/** Resultado por nota: o que foi salvo e o que não foi, sem perder o resto. */
export const ResultadoNotasFotoSchema = z.object({
  results: z.array(z.object({ id: z.uuid(), ok: z.boolean(), message: z.string().nullable() })),
  list: NotasFotoPaleteSchema,
});
export type ResultadoNotasFoto = z.infer<typeof ResultadoNotasFotoSchema>;
