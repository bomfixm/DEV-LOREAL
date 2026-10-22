import { z } from 'zod';

/**
 * Importação fixa da bipagem "Etiquetas" (21 out. 2026; substitui a etapa 1
 * de 19 out. — docs/IMPORTACAO-BIPAGEM.md, D283–D288).
 *
 * Um arquivo = um único palete bipado. A exportação (aba "Etiquetas_1" na
 * amostra) é lida pelos cabeçalhos, sem mapeamento: Tipo, Número, Lidos e
 * Remetente (obrigatórios) e CNPJ Remetente e Última Leitura (opcionais). As
 * demais colunas (Status, Baixa indevida, Série, Leituras, Destino, Posicao,
 * Area…) não entram em regra nenhuma. Lidos é a quantidade (nunca Leituras).
 *
 * O destino é escolhido no mapa depois da prévia: posição livre = palete novo
 * com número da série do piso, gerado só na confirmação; posição ocupada =
 * o palete que está lá (número e conteúdo preservados; as notas são
 * acrescentadas). Nota repetida no mesmo palete (mesmo tipo, número, CNPJ e
 * remetente) pede decisão: "Revalidar" (mantém a existente e não acrescenta a
 * linha) ou "Importar separadamente" (nova entrada; as duas contam). Nada é
 * somado, fundido ou substituído. Nada exige SKU, Delivery ou validade.
 */

/** Tipos documentais reconhecidos na coluna Tipo e o código interno (conferido: NF = nota fiscal, MI = minuta). */
export const TIPOS_DOCUMENTO_BIPAGEM = [
  { codigo: 'NF', original: 'NF-e', grafias: ['nf e', 'nfe', 'nf', 'nota fiscal', 'nota fiscal eletronica'] },
  { codigo: 'MI', original: 'Minuta', grafias: ['minuta', 'mi'] },
  { codigo: 'NFD', original: 'NFD', grafias: ['nfd', 'nf d', 'nota fiscal de devolucao'] },
] as const;
export type CodigoTipoBipagem = (typeof TIPOS_DOCUMENTO_BIPAGEM)[number]['codigo'];

/** Normalização dos textos de tipo e de cabeçalho: sem acentos, minúsculas, só letras/dígitos separados por espaço. */
export function normalizarRotuloBipagem(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tipo lido → código interno e grafia canônica; `null` = tipo não reconhecido. */
export function tipoDocumentoBipagem(texto: string): { codigo: CodigoTipoBipagem; original: string } | null {
  const n = normalizarRotuloBipagem(texto);
  const t = TIPOS_DOCUMENTO_BIPAGEM.find((x) => (x.grafias as readonly string[]).includes(n));
  return t ? { codigo: t.codigo, original: t.original } : null;
}

/** CNPJ/CPF só com dígitos (forma usada apenas na comparação; o texto original é guardado). */
export function digitosCnpj(texto: string): string {
  return texto.replace(/\D+/g, '');
}

// ---------- Identidade do documento (regra combinada com o usuário) ----------

/** Tipo para comparar: NF-e = NF = NFE; Minuta = MI; NFD é outro documento. Outros: o próprio texto normalizado. */
export function grupoTipoDocumento(tipo: string | null | undefined): string | null {
  const n = normalizarRotuloBipagem(tipo ?? '').replace(/ /g, '');
  if (n === '') return null;
  if (['nfe', 'nf', 'notafiscal', 'notafiscaleletronica'].includes(n)) return 'nfe';
  if (['mi', 'minuta'].includes(n)) return 'minuta';
  if (['nfd', 'notafiscaldedevolucao'].includes(n)) return 'nfd';
  return n;
}

/** Remetente para comparar: sem acentos, minúsculas e espaços simples (nada de agrupamento aproximado). */
export function remetenteComparavel(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** CNPJ comparável: exatamente 14 dígitos (zeros preservados); fora disso, `null` (nunca completado por suposição). */
export function cnpjComparavel(texto: string | null | undefined): string | null {
  const d = digitosCnpj(texto ?? '');
  return d.length === 14 ? d : null;
}

/** Número para comparar: texto exato, sem espaços nas pontas. */
const numeroComparavel = (texto: string | null | undefined) => (texto ?? '').replace(/\s+/g, ' ').trim();

export interface IdentidadeBipagem {
  tipo: string | null;
  numero: string | null;
  cnpj: string | null;
  remetente: string | null;
}

/**
 * Compara duas entradas DO MESMO PALETE (o chamador restringe):
 * - DIFERENTE: tipo ou número diferentes, ou CNPJ/remetente informados e
 *   diferentes nos dois lados — é outra entrada (sem aviso pelo número);
 * - INCOMPLETA: mesmo tipo e número, mas falta CNPJ ou remetente em algum
 *   lado — campos vazios nunca provam igualdade: pede decisão;
 * - COINCIDE: tipo, número, CNPJ e remetente iguais (volumes não importam).
 */
export function compararIdentidade(a: IdentidadeBipagem, b: IdentidadeBipagem): 'DIFERENTE' | 'INCOMPLETA' | 'COINCIDE' {
  const ta = grupoTipoDocumento(a.tipo);
  const tb = grupoTipoDocumento(b.tipo);
  const na = numeroComparavel(a.numero);
  const nb = numeroComparavel(b.numero);
  if (ta === null || tb === null || na === '' || nb === '') return 'INCOMPLETA';
  if (ta !== tb || na !== nb) return 'DIFERENTE';
  const ca = cnpjComparavel(a.cnpj);
  const cb = cnpjComparavel(b.cnpj);
  const ra = remetenteComparavel(a.remetente);
  const rb = remetenteComparavel(b.remetente);
  if ((ca !== null && cb !== null && ca !== cb) || (ra !== '' && rb !== '' && ra !== rb)) return 'DIFERENTE';
  if (ca === null || cb === null || ra === '' || rb === '') return 'INCOMPLETA';
  return 'COINCIDE';
}

/** Chave legível da identidade (tipo|número|CNPJ|remetente), guardada com a contagem para rastrear a origem. */
export function chaveIdentidadeBipagem(x: IdentidadeBipagem): string {
  return [grupoTipoDocumento(x.tipo) ?? '', numeroComparavel(x.numero), cnpjComparavel(x.cnpj) ?? digitosCnpj(x.cnpj ?? ''), remetenteComparavel(x.remetente)].join('|').slice(0, 300);
}

// ---------- Decisões, destino e parâmetros ----------

/**
 * Decisão por linha quando a identidade coincide (ou está incompleta) com
 * outra entrada do palete ou do próprio arquivo:
 * - REVALIDAR: mantém a entrada existente e não acrescenta esta linha (a
 *   quantidade antiga não muda; a linha fica no lote como ignorada);
 * - IMPORTAR_SEPARADO: cria outra entrada com a quantidade desta linha; as
 *   duas contam no total do palete (nenhuma linha é fundida ou alterada).
 */
export const DecisaoBipagemSchema = z.enum(['REVALIDAR', 'IMPORTAR_SEPARADO']);
export type DecisaoBipagem = z.infer<typeof DecisaoBipagemSchema>;

export const ROTULOS_DECISAO_BIPAGEM: Readonly<Record<DecisaoBipagem, string>> = {
  REVALIDAR: 'Revalidar: manter o que já está e não acrescentar esta linha',
  IMPORTAR_SEPARADO: 'Importar separadamente: nova entrada (as duas contam)',
};

/** Destino: posição escolhida no mapa ou o palete aberto (atalho a partir da janela do palete). */
export const DestinoBipagemSchema = z.object({ kind: z.enum(['POSICAO', 'PALETE']), id: z.uuid() });
export type DestinoBipagem = z.infer<typeof DestinoBipagemSchema>;

const LinhaArquivoSchema = z.number().int().positive();

/** Parâmetros da prévia (validados no servidor; entram na assinatura da prévia). */
export const ParametrosBipagemSchema = z.object({
  destination: DestinoBipagemSchema.nullable().default(null),
  decisions: z
    .array(z.object({ row: LinhaArquivoSchema, decision: DecisaoBipagemSchema }))
    .max(10_000)
    .default([]),
  /** O mesmo arquivo já foi importado antes e a pessoa confirma que é uma nova operação legítima. */
  newOperation: z.boolean().default(false),
});
export type ParametrosBipagem = z.output<typeof ParametrosBipagemSchema>;

/** Alvo existente no palete (conteúdo registrado ou vínculo do inventário). */
export const AlvoBipagemSchema = z.object({ kind: z.enum(['REGISTRADO', 'IMPORTADO']), id: z.uuid() });
export type AlvoBipagem = z.infer<typeof AlvoBipagemSchema>;

/**
 * Situação da linha com volumes lidos:
 * NOVO = entra como nova entrada; COINCIDENTE = mesma identidade (ou
 * identificação incompleta) de outra entrada: aguarda decisão;
 * REVALIDADO = decisão "Revalidar" (não entra); IMPORTAR_SEPARADO = decisão
 * "Importar separadamente" (entra como outra entrada).
 */
export const AcaoDocumentoBipagemSchema = z.enum(['NOVO', 'COINCIDENTE', 'REVALIDADO', 'IMPORTAR_SEPARADO']);
export type AcaoDocumentoBipagem = z.infer<typeof AcaoDocumentoBipagemSchema>;

export const ROTULOS_ACAO_DOCUMENTO_BIPAGEM: Readonly<Record<AcaoDocumentoBipagem, string>> = {
  NOVO: 'Nova entrada',
  COINCIDENTE: 'Nota repetida: escolha',
  REVALIDADO: 'Revalidada (não acrescentada)',
  IMPORTAR_SEPARADO: 'Importada separadamente',
};

/** Entrada que coincide com a linha: já no palete ou numa linha anterior do mesmo arquivo. */
export const CoincidenciaBipagemSchema = z.object({
  source: z.enum(['PALETE', 'ARQUIVO']),
  target: AlvoBipagemSchema.nullable(),
  row: LinhaArquivoSchema.nullable(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  senderCnpj: z.string().nullable(),
  sender: z.string().nullable(),
  /** Volumes da entrada coincidente (contagem vigente no palete ou Lidos da outra linha); `null` = não informado. */
  volumes: z.number().int().nonnegative().nullable(),
  /** De onde veio (bipagem e linha, registrado à mão, inventário…). */
  origin: z.string().min(1),
  /** Faltou CNPJ ou remetente em algum lado: não dá para afirmar que é a mesma nota. */
  incomplete: z.boolean(),
});
export type CoincidenciaBipagem = z.infer<typeof CoincidenciaBipagemSchema>;

export const DocumentoBipagemSchema = z.object({
  row: LinhaArquivoSchema,
  /** Tipo como na exportação (NF-e, Minuta) e o código interno (NF, MI, NFD). */
  type: z.string().min(1),
  typeCode: z.string().min(1),
  number: z.string().min(1),
  senderCnpj: z.string().nullable(),
  sender: z.string().min(1),
  /** Lidos da linha (volumes reais lidos). */
  volumes: z.number().int().positive(),
  /** "Última Leitura" como lida (AAAA-MM-DDTHH:MM[:SS], horário local da bipagem); `null` = sem a coluna ou vazia. */
  lastRead: z.string().nullable(),
  action: AcaoDocumentoBipagemSchema,
  matches: z.array(CoincidenciaBipagemSchema),
  decision: DecisaoBipagemSchema.nullable(),
  /** Decisão necessária e ainda não tomada (bloqueia a confirmação). */
  awaitingDecision: z.boolean(),
  notices: z.array(z.string().min(1)),
});
export type DocumentoBipagem = z.infer<typeof DocumentoBipagemSchema>;

/** Registro com Lidos = 0: relatado, não gera entrada (não comprova presença nem ausência). */
export const RegistroSemLeituraSchema = z.object({
  row: LinhaArquivoSchema,
  type: z.string().nullable(),
  number: z.string().nullable(),
  senderCnpj: z.string().nullable(),
  sender: z.string().nullable(),
});
export type RegistroSemLeitura = z.infer<typeof RegistroSemLeituraSchema>;

/** Palete de destino como o servidor o vê. */
export const PaleteDestinoBipagemSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  positionCode: z.string().nullable(),
  /** Endereço real confirmado da posição ou, sem posição, o informado no inventário. */
  address: z.string().nullable(),
  /** Endereço só informado (posição no mapa pendente). */
  mapPending: z.boolean(),
  archived: z.boolean(),
  shipped: z.boolean(),
});
export type PaleteDestinoBipagem = z.infer<typeof PaleteDestinoBipagemSchema>;

/**
 * Destino resolvido: NOVO_PALETE (posição livre; o número sai na confirmação)
 * ou PALETE_EXISTENTE (o palete da posição ou o aberto), com o que ele já tem.
 */
export const DestinoResumoBipagemSchema = z.object({
  kind: z.enum(['NOVO_PALETE', 'PALETE_EXISTENTE']),
  position: z.object({ id: z.uuid(), code: z.string().min(1), address: z.string().nullable() }).nullable(),
  pallet: PaleteDestinoBipagemSchema.nullable(),
  /** Entradas e volumes que o palete já tem (volumes conhecidos; as sem contagem à parte). */
  currentEntries: z.number().int().nonnegative(),
  currentVolumes: z.number().int().nonnegative(),
  currentUnknown: z.number().int().nonnegative(),
  /** O destino não pode receber esta importação (posição desativada, palete arquivado/expedido…). */
  blocked: z.string().nullable(),
});
export type DestinoResumoBipagem = z.infer<typeof DestinoResumoBipagemSchema>;

/** Campos de negócio lidos e a coluna reconhecida de cada um (opcional ausente: letra "—"). */
export const CampoReconhecidoBipagemSchema = z.object({ field: z.string().min(1), label: z.string().min(1), letter: z.string().min(1), header: z.string(), required: z.boolean().default(true) });

/** Resumo estruturado da prévia (gravado com a prévia; mesma fonte da confirmação). */
export const ResumoBipagemSchema = z.object({
  /** `null` = posição ainda não escolhida no mapa. */
  destination: DestinoResumoBipagemSchema.nullable(),
  sheet: z.string().nullable(),
  headerRow: z.number().int().positive(),
  columns: z.array(CampoReconhecidoBipagemSchema),
  counters: z.object({
    /** Linhas de dados analisadas. */
    records: z.number().int().nonnegative(),
    /** Linhas com Lidos > 0 (válidas). */
    withReads: z.number().int().nonnegative(),
    /** Linhas com Lidos = 0 (relatadas; não geram entrada). */
    withoutReads: z.number().int().nonnegative(),
    /** Linhas com erro (Lidos inválido, tipo desconhecido, campo obrigatório vazio…). */
    rowsWithErrors: z.number().int().nonnegative(),
    /** Soma de Lidos das linhas com volumes (o arquivo). */
    volumes: z.number().int().nonnegative(),
    /** Entradas que a confirmação grava e os volumes delas. */
    accepted: z.number().int().nonnegative(),
    volumesToAdd: z.number().int().nonnegative(),
    /** Linhas "Revalidar" (ignoradas) e as que aguardam decisão. */
    revalidated: z.number().int().nonnegative(),
    awaitingDecision: z.number().int().nonnegative(),
    byType: z.array(z.object({ type: z.string(), records: z.number().int().nonnegative(), withReads: z.number().int().nonnegative(), volumes: z.number().int().nonnegative() })),
  }),
  documents: z.array(DocumentoBipagemSchema),
  withoutReads: z.array(RegistroSemLeituraSchema),
  errors: z.array(z.object({ row: LinhaArquivoSchema, messages: z.array(z.string().min(1)) })),
  /** Importações anteriores do mesmo arquivo (aviso; a pessoa confirma se é nova operação). */
  previousImports: z.array(z.object({ batchId: z.uuid(), at: z.iso.datetime(), palletCode: z.string().nullable(), by: z.string().nullable() })),
  /** Motivos que impedem a confirmação agora (vazio = pode confirmar). */
  blockers: z.array(z.string().min(1)),
});
export type ResumoBipagem = z.infer<typeof ResumoBipagemSchema>;
