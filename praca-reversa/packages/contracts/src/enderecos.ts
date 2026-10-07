import { z } from 'zod';
import { UsuarioResumoSchema } from './acesso.js';

/**
 * Endereços reais da praça (complemento "seleção do cliente"). O endereço é
 * composto: fileira operacional ou GR + código local ("15 - A120"). O mesmo
 * código local em fileiras diferentes é outro endereço ("13 - A120"); nada é
 * buscado, atualizado ou vinculado só pelo código local.
 *
 * Regras de normalização registradas (o texto original é sempre preservado):
 * - N1 espaços nas pontas e repetidos são removidos;
 * - N2 letras em maiúsculas;
 * - N3 travessão (– ou —) vale como hífen;
 * - N4 espaços em volta do hífen e entre a letra e o número são ajustados
 *   ("15- A120", "15 - A 120" → "15 - A120").
 * Nunca: completar prefixo ausente ("A120"), acrescentar letra que o texto
 * não tem ("14 - 130" continua "14 - 130") ou mudar dígitos (zeros incluídos).
 */

export const FORMATO_PREFIXO_ENDERECO = /^[A-Z0-9]{1,4}$/;
export const FORMATO_CODIGO_LOCAL = /^[A-Z0-9]{1,8}$/;

export const REGRAS_NORMALIZACAO_ENDERECO: Readonly<Record<'N1' | 'N2' | 'N3' | 'N4', string>> = {
  N1: 'espaços nas pontas e repetidos removidos',
  N2: 'letras em maiúsculas',
  N3: 'travessão tratado como hífen',
  N4: 'espaços em volta do hífen e entre letra e número ajustados',
};
export type RegraNormalizacaoEndereco = keyof typeof REGRAS_NORMALIZACAO_ENDERECO;

export type EnderecoNormalizado =
  | {
      ok: true;
      prefixo: string;
      codigoLocal: string;
      /** "15 - A120" */
      endereco: string;
      /** "15|A120" */
      chave: string;
      /** Regras aplicadas (vazia = já estava no formato canônico). */
      regras: RegraNormalizacaoEndereco[];
    }
  | { ok: false; codigo: 'ENDERECO_VAZIO' | 'ENDERECO_SEM_FILEIRA' | 'ENDERECO_FORMATO'; mensagem: string };

const PADRAO_ENDERECO = /^([0-9]{1,2}|[A-Z]{1,3})-([A-Z]{0,2})([0-9]{1,5})$/;

export function chaveEndereco(prefixo: string, codigoLocal: string): string {
  return `${prefixo}|${codigoLocal}`;
}

export function textoEndereco(prefixo: string, codigoLocal: string): string {
  return `${prefixo} - ${codigoLocal}`;
}

/** Normaliza um endereço informado pelas regras N1–N4 (sem completar nem corrigir). */
export function normalizarEndereco(texto: string | null | undefined): EnderecoNormalizado {
  const original = texto ?? '';
  const aparado = original.trim();
  if (aparado === '') return { ok: false, codigo: 'ENDERECO_VAZIO', mensagem: 'Endereço vazio.' };
  const regras = new Set<RegraNormalizacaoEndereco>();
  if (aparado !== original || /\s{2,}/.test(aparado)) regras.add('N1');
  let t = aparado.replace(/\s+/g, ' ');
  if (/[–—]/.test(t)) {
    regras.add('N3');
    t = t.replace(/[–—]/g, '-');
  }
  if (t !== t.toUpperCase()) regras.add('N2');
  t = t.toUpperCase();
  const compacto = t.replace(/\s/g, '');
  const m = PADRAO_ENDERECO.exec(compacto);
  if (!m) {
    if (/^[A-Z]{0,2}[0-9]{1,5}$/.test(compacto)) {
      return { ok: false, codigo: 'ENDERECO_SEM_FILEIRA', mensagem: `"${aparado}" não informa a fileira (ou GR): o código local sozinho não identifica uma posição.` };
    }
    return { ok: false, codigo: 'ENDERECO_FORMATO', mensagem: `"${aparado}" não está no formato "fileira - código" (ex.: 15 - A120 ou GR - 5).` };
  }
  const prefixo = m[1] ?? '';
  const codigoLocal = `${m[2] ?? ''}${m[3] ?? ''}`;
  const endereco = textoEndereco(prefixo, codigoLocal);
  if (endereco !== t.trim()) regras.add('N4');
  return { ok: true, prefixo, codigoLocal, endereco, chave: chaveEndereco(prefixo, codigoLocal), regras: [...regras].sort() };
}

// ---------- Sequências por faixa ----------

export const LIMITE_POSICOES_FAIXA = 200;

export type SegmentosExpandidos = { ok: true; codigos: string[] } | { ok: false; mensagem: string };

const SEGMENTO = /^([A-Z]{0,2})([0-9]{1,5})(?:-([A-Z]{0,2})([0-9]{1,5}))?(?:\/([0-9]{1,2}))?$/;

/**
 * Expande segmentos informados ("A101-A133/2, A79-A89/2", "GR" usa só
 * números: "1-15") na ordem escrita. Início maior que o fim desce. A largura
 * dos dígitos do início é mantida (A09-A12 → A09, A10, A11, A12). Código
 * repetido é erro: cada endereço identifica uma posição.
 */
export function expandirSegmentos(texto: string): SegmentosExpandidos {
  const partes = texto
    .toUpperCase()
    .split(/[,;\n]/)
    .map((p) => p.replace(/\s+/g, ''))
    .filter((p) => p !== '');
  if (partes.length === 0) return { ok: false, mensagem: 'Informe ao menos um segmento (ex.: A101-A133/2).' };
  const codigos: string[] = [];
  for (const parte of partes) {
    const m = SEGMENTO.exec(parte);
    if (!m) return { ok: false, mensagem: `Segmento "${parte}" inválido. Use código, início-fim ou início-fim/passo (ex.: A101-A133/2).` };
    const letra = m[1] ?? '';
    const digitosInicio = m[2] ?? '';
    const inicio = Number(digitosInicio);
    const passo = m[5] === undefined ? 1 : Number(m[5]);
    if (passo < 1) return { ok: false, mensagem: `Segmento "${parte}": o passo precisa ser 1 ou mais.` };
    if (m[4] === undefined) {
      if (m[5] !== undefined) return { ok: false, mensagem: `Segmento "${parte}": passo sem fim do intervalo.` };
      codigos.push(`${letra}${digitosInicio}`);
      continue;
    }
    if ((m[3] ?? '') !== letra) return { ok: false, mensagem: `Segmento "${parte}": início e fim precisam ter a mesma letra.` };
    const fim = Number(m[4]);
    const largura = digitosInicio.length;
    const sobe = fim >= inicio;
    if (Math.abs(fim - inicio) % passo !== 0) {
      return { ok: false, mensagem: `Segmento "${parte}": com passo ${String(passo)}, o intervalo não termina em ${letra}${m[4]}. Confira início, fim e passo.` };
    }
    for (let n = inicio; sobe ? n <= fim : n >= fim; n += sobe ? passo : -passo) {
      codigos.push(`${letra}${String(n).padStart(largura, '0')}`);
      if (codigos.length > LIMITE_POSICOES_FAIXA) return { ok: false, mensagem: `A sequência passa de ${String(LIMITE_POSICOES_FAIXA)} endereços.` };
    }
  }
  const vistos = new Set<string>();
  for (const c of codigos) {
    if (vistos.has(c)) return { ok: false, mensagem: `O código ${c} aparece mais de uma vez na sequência.` };
    vistos.add(c);
  }
  for (const c of codigos) if (!FORMATO_CODIGO_LOCAL.test(c)) return { ok: false, mensagem: `Código local ${c} inválido (até 8 letras/dígitos).` };
  return { ok: true, codigos };
}

// ---------- API ----------

export const LadoFaixaSchema = z.enum(['ESQUERDO', 'DIREITO', 'UNICO']);
export type LadoFaixa = z.infer<typeof LadoFaixaSchema>;
export const ROTULOS_LADO: Readonly<Record<LadoFaixa, string>> = { ESQUERDO: 'lado esquerdo', DIREITO: 'lado direito', UNICO: 'faixa única' };

export const SentidoSequenciaSchema = z.enum(['P01_PRIMEIRO', 'P01_ULTIMO']);
export type SentidoSequencia = z.infer<typeof SentidoSequenciaSchema>;
export const ROTULOS_SENTIDO: Readonly<Record<SentidoSequencia, string>> = {
  P01_PRIMEIRO: 'P01 (topo do desenho) recebe o primeiro endereço',
  P01_ULTIMO: 'P01 (topo do desenho) recebe o último endereço',
};

export const SituacaoEnderecoSchema = z.enum(['PROPOSTO', 'CONFIRMADO']);
export type SituacaoEndereco = z.infer<typeof SituacaoEnderecoSchema>;

const revisao = z.number().int().positive();

/** PUT /layout/fileiras/:id/sequencia — gera a proposta da faixa (substitui a proposta anterior). */
export const DefinirSequenciaSchema = z.object({
  expectedRevision: revisao,
  segments: z.string().trim().min(1, 'Informe a sequência.').max(300),
  direction: SentidoSequenciaSchema,
  source: z.string().trim().min(3, 'Informe a fonte (3 a 200 caracteres).').max(200),
  notes: z.string().trim().max(500).nullable().default(null),
  /** Necessário para trocar endereços já confirmados da faixa (com motivo). */
  replaceConfirmedReason: z.string().trim().min(3).max(300).nullable().default(null),
});
export type DefinirSequencia = z.input<typeof DefinirSequenciaSchema>;

/** POST /layout/fileiras/:id/enderecos/confirmar */
export const ConfirmarEnderecosSchema = z.object({
  expectedRevision: revisao,
  /** Quantos endereços propostos quem confirma revisou (outro número = proposta mudou). */
  expectedProposed: z.number().int().positive(),
});
export type ConfirmarEnderecos = z.infer<typeof ConfirmarEnderecosSchema>;

export const EnderecoCorrespondenciaSchema = z.object({
  positionId: z.uuid(),
  positionCode: z.string().min(1),
  visualOrder: z.number().int().positive(),
  address: z.string().min(1),
  state: SituacaoEnderecoSchema,
  origin: z.enum(['SEQUENCIA', 'MANUAL', 'DEMONSTRACAO']),
  confirmedAt: z.iso.datetime().nullable(),
});
export type EnderecoCorrespondencia = z.infer<typeof EnderecoCorrespondenciaSchema>;

export const SituacaoFaixaSchema = z.enum(['SEM_SEQUENCIA', 'PROPOSTA', 'CONFIRMADA']);
export type SituacaoFaixa = z.infer<typeof SituacaoFaixaSchema>;

export const FaixaEnderecosSchema = z.object({
  rowId: z.uuid(),
  rowCode: z.string().min(1),
  side: LadoFaixaSchema.nullable(),
  /** Posições desenhadas (não retiradas) da faixa. */
  positions: z.number().int().nonnegative(),
  state: SituacaoFaixaSchema,
  sequence: z
    .object({
      segments: z.string(),
      direction: SentidoSequenciaSchema,
      source: z.string(),
      notes: z.string().nullable(),
      informedAt: z.iso.datetime(),
      informedBy: UsuarioResumoSchema.nullable(),
    })
    .nullable(),
  addresses: z.array(EnderecoCorrespondenciaSchema),
});
export type FaixaEnderecos = z.infer<typeof FaixaEnderecosSchema>;

export const BlocoEnderecosSchema = z.object({
  elementId: z.uuid(),
  code: z.string().min(1),
  label: z.string().min(1),
  operationalName: z.string().nullable(),
  addressPrefix: z.string().nullable(),
  /** Área desativada (todas as posições desativadas). */
  deactivated: z.boolean(),
  rows: z.array(FaixaEnderecosSchema),
});
export type BlocoEnderecos = z.infer<typeof BlocoEnderecosSchema>;

/** GET /layout/enderecos — tabela de correspondência do layout ativo. */
export const CorrespondenciaEnderecosSchema = z.object({
  layoutId: z.uuid().nullable(),
  revision: z.number().int().nonnegative(),
  blocks: z.array(BlocoEnderecosSchema),
  /** Resumo do que falta confirmar (texto para a tela e a documentação). */
  pending: z.array(z.string()),
  confirmedAddresses: z.number().int().nonnegative(),
  proposedAddresses: z.number().int().nonnegative(),
});
export type CorrespondenciaEnderecos = z.infer<typeof CorrespondenciaEnderecosSchema>;

/**
 * Resultado da resolução de um endereço informado contra a tabela confirmada.
 * - POSICAO: correspondência confirmada (posição do mapa);
 * - PROPOSTA: há correspondência, mas ainda não confirmada (não usada);
 * - SEM_POSICAO: prefixo conhecido, endereço sem posição visual (correspondência pendente);
 * - PREFIXO_DESCONHECIDO: nenhum bloco com esta fileira/GR;
 * - INVALIDO: texto fora do formato.
 */
export const ResolucaoEnderecoSchema = z.enum(['POSICAO', 'PROPOSTA', 'SEM_POSICAO', 'PREFIXO_DESCONHECIDO', 'INVALIDO']);
export type ResolucaoEndereco = z.infer<typeof ResolucaoEnderecoSchema>;
