import { z } from 'zod';
import { ConferenciaItemSchema, ConferenciaVolumesPaleteSchema } from './conferencia-volumes.js';

/**
 * Conteúdo recebido no palete (cadastro de conteúdo, out. 2026): o que fica no
 * palete, identificado pelo remetente e, quando disponíveis, pela nota da
 * caixa (NF, NFD ou MI) e pelo Delivery. NF e Delivery podem ficar ambos
 * vazios; nada é inventado para salvar (nem SKU, nem código de barras). A
 * quantidade de volumes é tratada na conferência de volumes, separada do
 * cadastro: sem contagem, o conteúdo fica "Aguardando conferência" (nunca zero).
 */

export const TipoDocumentoConteudoSchema = z.enum(['NF', 'NFD', 'MI']);
export type TipoDocumentoConteudo = z.infer<typeof TipoDocumentoConteudoSchema>;

/** Texto livre de uma linha: espaços repetidos reduzidos, sem caracteres de controle. */
const textoLinha = (maximo: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(maximo, `Até ${String(maximo)} caracteres.`).regex(/^[^\p{Cc}]*$/u, 'Caracteres inválidos.'));

/** Opcional: vazio ou ausente = não informado (`null`). Números ficam como texto (zeros à esquerda preservados). */
const opcional = (maximo: number) =>
  z
    .union([z.null(), textoLinha(maximo)])
    .optional()
    .transform((v) => (v === undefined || v === null || v === '' ? null : v));

export const NovoConteudoSchema = z.object({
  sender: textoLinha(200).pipe(z.string().min(1, 'Informe o remetente.')),
  documentType: TipoDocumentoConteudoSchema.nullable().default(null),
  documentNumber: opcional(60),
  delivery: opcional(60),
  description: opcional(500),
});
export type NovoConteudo = z.input<typeof NovoConteudoSchema>;

/** Completar ou corrigir a identificação do mesmo conteúdo (contagem, palete e histórico preservados). */
export const AlterarConteudoSchema = NovoConteudoSchema.extend({
  expectedVersion: z.number().int().positive(),
});
export type AlterarConteudo = z.input<typeof AlterarConteudoSchema>;

/**
 * Origem da contagem: importada (volumes do inventário), contada agora no
 * aplicativo, contagem já feita informada ou BIPAGEM (Lidos da exportação da
 * bipagem, contagem informada pelo arquivo importado no palete).
 */
export const OrigemContagemSchema = z.enum(['IMPORTACAO', 'CONTAGEM_FISICA', 'CONTAGEM_INFORMADA', 'BIPAGEM']);
export type OrigemContagem = z.infer<typeof OrigemContagemSchema>;

export const ROTULOS_ORIGEM_CONTAGEM: Readonly<Record<OrigemContagem, string>> = {
  IMPORTACAO: 'contagem importada',
  CONTAGEM_FISICA: 'contada no aplicativo',
  CONTAGEM_INFORMADA: 'contagem já feita, informada',
  BIPAGEM: 'lidos na bipagem (importada)',
};

export const TipoConteudoSchema = z.enum(['REGISTRADO', 'IMPORTADO']);
export type TipoConteudo = z.infer<typeof TipoConteudoSchema>;

/** POST /paletes/:id/conteudos/contagens — registra o resultado (nunca edita uma contagem anterior). */
export const RegistrarContagemSchema = z.object({
  target: z.object({ kind: TipoConteudoSchema, id: z.uuid() }),
  counted: z.number().int('Volumes inteiros.').min(0).max(100_000),
  /** Previsto pelo documento, quando informado; ausente = previsto não informado (nunca copiado do contado). */
  expected: z.number().int('Volumes inteiros.').min(0).max(100_000).nullable().default(null),
  origin: z.enum(['CONTAGEM_FISICA', 'CONTAGEM_INFORMADA']),
  reference: opcional(200),
});
export type RegistrarContagem = z.input<typeof RegistrarContagemSchema>;

export const ContagemConteudoSchema = z.object({
  state: z.enum(['AGUARDANDO', 'REALIZADA']),
  /** Volumes contados/lidos (texto decimal); `null` = ainda não informado. */
  counted: z.string().nullable(),
  /** Volumes previstos; `null` = previsto não informado. */
  expected: z.string().nullable(),
  origin: OrigemContagemSchema.nullable(),
  at: z.iso.datetime().nullable(),
  by: z.string().nullable(),
  reference: z.string().nullable(),
});
export type ContagemConteudo = z.infer<typeof ContagemConteudoSchema>;

export const ConteudoPaleteSchema = z.object({
  id: z.uuid(),
  kind: TipoConteudoSchema,
  sender: z.string().nullable(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  delivery: z.string().nullable(),
  description: z.string().nullable(),
  /** Origem do registro importado (inventário/bipagem e linha); `null` no registrado à mão. */
  source: z.string().nullable(),
  /** Bipagem: tipo como exportado (NF-e, Minuta) — `documentType` é o código interno (NF, MI, NFD). */
  documentTypeOriginal: z.string().nullable().default(null),
  /** CNPJ do remetente como informado (bipagem); `null` = não informado. */
  senderCnpj: z.string().nullable().default(null),
  /** Cadastrado pela importação da bipagem: tipo e número vêm do arquivo (não mudam na edição). */
  fromBipagem: z.boolean().default(false),
  /** Marcador FULL da planilha (sequência manual, ex.: 01\\07), quando houver. */
  palletFull: z.string().nullable(),
  /** Inventário (coluna PALLET FULL): FULL ou FRACIONADO como na planilha; `null` = não informado. */
  fullKind: z.enum(['FULL', 'FRACIONADO']).nullable().default(null),
  /** Etiquetas FULL da linha (1/3, 2/3…): partes físicas do conjunto da nota; não multiplicam volumes. */
  fullTags: z.array(z.string()).default([]),
  /**
   * Conferência informada na linha do inventário (coluna INVENTÁRIO): data,
   * "VALIDAR" ou sem data. É da linha, não a conferência completa do palete.
   */
  inventoryCheck: z
    .object({ state: z.enum(['INFORMADA', 'A_VALIDAR', 'SEM_DATA']), date: z.iso.date().nullable(), text: z.string().nullable() })
    .nullable()
    .default(null),
  /** PF/CNPJ e DOCUMENTAÇÃO como na planilha (classificação e informação, não autorização). */
  classification: z.string().nullable().default(null),
  documentation: z.string().nullable().default(null),
  /** Vínculo importado: consta da versão ativa do inventário ou foi mantido sem constar dela (a validar no piso). */
  latestInventory: z.enum(['CONSTA', 'NAO_CONSTA']).nullable().default(null),
  /** Versão para completar a identificação (0 = importado, editado pela importação). */
  version: z.number().int().nonnegative(),
  count: ContagemConteudoSchema,
  /** Conferência mais recente desta ocorrência no palete atual (tabela de conferência). */
  check: ConferenciaItemSchema.nullable().default(null),
  /** Entrada no palete atual (registro, movimento ou resolução da validação). */
  allocatedAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
});
export type ConteudoPalete = z.infer<typeof ConteudoPaleteSchema>;

/** GET /paletes/:id/conteudos — conteúdo registrado e importado do palete, com a situação da conferência. */
export const ConteudosPaleteSchema = z.object({
  palletId: z.uuid(),
  items: z.array(ConteudoPaleteSchema),
  /** Documentos identificados distintos (tipo + número); uma NF com várias Deliveries conta 1. */
  documents: z.number().int().nonnegative(),
  /** Conteúdos sem número de documento (identificação pendente; não invalidam o registro). */
  withoutDocument: z.number().int().nonnegative(),
  /** FULL = uma única nota identificada e nenhum conteúdo sem documento. */
  full: z.enum(['FULL', 'MISTO', 'NAO_INFORMADO']),
  /** Inventário ativo do escopo; `inValidation` = base provisória ("Inventário em validação"), não disponibilidade certificada. */
  inventory: z.object({ code: z.string(), baseDate: z.iso.date().nullable(), inValidation: z.boolean() }).nullable().default(null),
  /** Assinatura do conjunto (ocorrências e quantidades atuais): a conferência em tabela a devolve para detectar mudança. */
  setSignature: z.string().default(''),
  /** Estado da conferência de volumes do palete. */
  volumeCheck: ConferenciaVolumesPaleteSchema.nullable().default(null),
});
export type ConteudosPalete = z.infer<typeof ConteudosPaleteSchema>;
