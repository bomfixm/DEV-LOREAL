import { z } from 'zod';
import { UsuarioResumoSchema } from './acesso.js';
import { TipoAnexoSchema } from './claims.js';
import { UnidadeMedidaSchema, textoIdentificador, textoOpcional } from './codigos.js';
import { QuantidadeSchema, compararQuantidades, ehQuantidadeInteira } from './decimal.js';
import { CondicaoMaterialSchema, EstadoFluxoSchema, TipoOrigemDocumentoSchema } from './estados.js';

/**
 * Janelas de devolução, liberação de material, reservas, preparação,
 * expedição e retorno físico (etapa 08; docs/DADOS-E-REGRAS.md R11, R21–R26,
 * R29). Quantidades, pesos e volumes são decimais exatos em texto; datas e
 * horas trafegam em ISO 8601 (UTC gravado, apresentado no fuso da operação).
 */

export const SituacaoJanelaSchema = z.enum(['RASCUNHO', 'CONFIRMADA', 'PREPARACAO', 'ENCERRADA', 'CANCELADA']);
export type SituacaoJanela = z.infer<typeof SituacaoJanelaSchema>;
export const SITUACOES_JANELA = SituacaoJanelaSchema.options;
/** Situações em que a janela aceita reserva e expedição. */
export const SITUACOES_JANELA_OPERAVEIS = ['CONFIRMADA', 'PREPARACAO'] as const satisfies readonly SituacaoJanela[];

/**
 * Métrica de uma restrição de capacidade. QUANTIDADE usa a unidade do produto
 * informada na restrição (sem conversão presumida); CAIXAS e PALETES contam
 * unidades físicas inteiras; PESO_KG exige a base (bruto ou líquido);
 * VOLUME_M3 exige o volume medido da carga.
 */
export const MetricaCapacidadeSchema = z.enum(['QUANTIDADE', 'CAIXAS', 'PALETES', 'PESO_KG', 'VOLUME_M3']);
export type MetricaCapacidade = z.infer<typeof MetricaCapacidadeSchema>;
export const METRICAS_CAPACIDADE = MetricaCapacidadeSchema.options;
export const METRICAS_INTEIRAS: readonly MetricaCapacidade[] = ['CAIXAS', 'PALETES'];
/** Unidade apresentada das métricas de unidade fixa. */
export const UNIDADES_METRICA: Readonly<Record<Exclude<MetricaCapacidade, 'QUANTIDADE'>, string>> = {
  CAIXAS: 'caixas',
  PALETES: 'paletes',
  PESO_KG: 'kg',
  VOLUME_M3: 'm³',
};

export const BasePesoSchema = z.enum(['BRUTO', 'LIQUIDO']);
export type BasePeso = z.infer<typeof BasePesoSchema>;

export const SituacaoReservaSchema = z.enum(['ATIVA', 'LIBERADA', 'CONSUMIDA', 'CANCELADA']);
export type SituacaoReserva = z.infer<typeof SituacaoReservaSchema>;
export const SituacaoPreparacaoSchema = z.enum(['PENDENTE', 'PREPARADA', 'DIVERGENTE']);
export type SituacaoPreparacao = z.infer<typeof SituacaoPreparacaoSchema>;
export const TipoRetornoSchema = z.enum(['AVISO_DOCUMENTAL', 'RECEBIMENTO_FISICO']);
export type TipoRetorno = z.infer<typeof TipoRetornoSchema>;

export const TipoEventoLiberacaoSchema = z.enum([
  'LIBERAR',
  'REVOGAR',
  'BLOQUEAR',
  'DESBLOQUEAR',
  'BLOQUEAR_PALETE',
  'DESBLOQUEAR_PALETE',
  /** Liberação reduzida porque o saldo diminuiu (reconciliação, transferência, expedição). */
  'AJUSTE_SALDO',
  /** Material transferido de palete/linha bloqueada chega bloqueado. */
  'HERANCA_BLOQUEIO',
  /** Conversão dos estados de liberação anteriores à etapa 08. */
  'MIGRACAO',
]);
export type TipoEventoLiberacao = z.infer<typeof TipoEventoLiberacaoSchema>;

export const LIMITE_LINHAS_RESERVA = 200;
export const LIMITE_PAGINA_JANELAS = 100;
export const LIMITE_PAGINA_MATERIAL = 100;
export const LIMITE_DOCUMENTOS_EXIGIDOS = 20;

const MesSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido (AAAA-MM).');
const DataSchema = z.iso.date('Data inválida (AAAA-MM-DD).');
const DataHoraSchema = z.iso.datetime({ offset: true, message: 'Data e hora inválidas.' });
const texto = (min: number, max: number, rotulo: string) =>
  z
    .string()
    .trim()
    .min(min, `${rotulo}: pelo menos ${String(min)} caracteres.`)
    .max(max, `${rotulo}: até ${String(max)} caracteres.`)
    .regex(/^(?:[^\p{Cc}]|[\n\r\t])*$/u, `${rotulo}: caracteres inválidos.`);
const Motivo = texto(3, 500, 'Motivo');
const Versao = z.number().int().positive();
const Inteiro = z.string().regex(/^\d{1,9}$/, 'Informe um número inteiro.');

// ---------- Cadastro da janela ----------

export const RestricaoEntradaSchema = z
  .object({
    metric: MetricaCapacidadeSchema,
    /** Unidade do limite em QUANTIDADE (ex.: UN). Ignorada nas demais métricas. */
    unit: UnidadeMedidaSchema.nullable().optional(),
    /** Base do peso (obrigatória em PESO_KG). */
    weightBase: BasePesoSchema.nullable().optional(),
    /** Limite autorizado; `null` = pendente (nunca ilimitado). Zero = sem capacidade nessa métrica. */
    limit: QuantidadeSchema.nullable(),
  })
  .superRefine((r, ctx) => {
    if (r.metric === 'QUANTIDADE' && !r.unit) ctx.addIssue({ code: 'custom', path: ['unit'], message: 'Informe a unidade do limite em quantidade (ex.: UN).' });
    if (r.metric === 'PESO_KG' && !r.weightBase) ctx.addIssue({ code: 'custom', path: ['weightBase'], message: 'Informe se o limite de peso é bruto ou líquido.' });
    if (r.limit !== null && METRICAS_INTEIRAS.includes(r.metric) && !ehQuantidadeInteira(r.limit)) {
      ctx.addIssue({ code: 'custom', path: ['limit'], message: 'Caixas e paletes são unidades físicas inteiras.' });
    }
  });
export type RestricaoEntrada = z.input<typeof RestricaoEntradaSchema>;

export const CriteriosEntradaSchema = z
  .object({
    /** Critérios informados pelo cliente. `false` = pendentes (reserva bloqueada). */
    defined: z.boolean(),
    acceptedConditions: z.array(CondicaoMaterialSchema).max(3).default([]),
    /** Tipos de origem aceitos; `null` = qualquer origem. */
    acceptedOriginTypes: z.array(TipoOrigemDocumentoSchema).max(4).nullable().default(null),
    requireLot: z.boolean().default(false),
    requireOrigin: z.boolean().default(false),
    /** Documentos exigidos na expedição (nomes conforme o processo informado). */
    requiredDocuments: z.array(textoIdentificador(80, 'Documento')).max(LIMITE_DOCUMENTOS_EXIGIDOS).default([]),
    notes: textoOpcional(1000).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.defined && c.acceptedConditions.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['acceptedConditions'], message: 'Critérios definidos precisam aceitar ao menos uma condição de material.' });
    }
    if (c.acceptedOriginTypes !== null && c.acceptedOriginTypes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['acceptedOriginTypes'], message: 'Selecione ao menos um tipo de origem ou aceite qualquer origem.' });
    }
    if (new Set(c.requiredDocuments.map((d) => d.toLowerCase())).size !== c.requiredDocuments.length) {
      ctx.addIssue({ code: 'custom', path: ['requiredDocuments'], message: 'Documento exigido repetido.' });
    }
  });
export type CriteriosEntrada = z.input<typeof CriteriosEntradaSchema>;

export const AutorizacaoEntradaSchema = z.object({
  /** Fonte da confirmação (ex.: e-mail do cliente, portal, reunião). */
  source: textoIdentificador(120, 'Fonte da autorização').nullable().optional(),
  /** Referência textual (preserva zeros à esquerda). */
  reference: textoIdentificador(120, 'Referência da autorização').nullable().optional(),
  date: DataSchema.nullable().optional(),
  /** Responsável pela confirmação no cliente/operação (texto). */
  responsible: textoIdentificador(120, 'Responsável pela autorização').nullable().optional(),
});
export type AutorizacaoEntrada = z.input<typeof AutorizacaoEntradaSchema>;

const camposJanela = {
  name: textoIdentificador(120, 'Nome da janela'),
  clientReference: textoIdentificador(80, 'Referência do cliente').nullable().optional(),
  /** Mês de referência da visão mensal (AAAA-MM). */
  referenceMonth: MesSchema,
  /** Início e fim do intervalo autorizado de saída; `null` = pendente. */
  exitStart: DataHoraSchema.nullable().optional(),
  exitEnd: DataHoraSchema.nullable().optional(),
  preparationDeadline: DataHoraSchema.nullable().optional(),
  restrictions: z.array(RestricaoEntradaSchema).max(5).default([]),
  criteria: CriteriosEntradaSchema,
  authorization: AutorizacaoEntradaSchema.default({}),
  notes: textoOpcional(1000).optional(),
};

function conferirJanela(j: { exitStart?: string | null; exitEnd?: string | null; restrictions: readonly { metric: MetricaCapacidade }[] }, ctx: z.RefinementCtx): void {
  if ((j.exitStart ?? null) !== null && (j.exitEnd ?? null) !== null && Date.parse(j.exitEnd ?? '') < Date.parse(j.exitStart ?? '')) {
    ctx.addIssue({ code: 'custom', path: ['exitEnd'], message: 'O fim do intervalo de saída é anterior ao início.' });
  }
  if ((j.exitStart ?? null) === null !== ((j.exitEnd ?? null) === null)) {
    ctx.addIssue({ code: 'custom', path: ['exitEnd'], message: 'Informe início e fim do intervalo de saída (iguais para horário exato) ou deixe ambos pendentes.' });
  }
  const metricas = j.restrictions.map((r) => r.metric);
  if (new Set(metricas).size !== metricas.length) ctx.addIssue({ code: 'custom', path: ['restrictions'], message: 'Cada métrica aparece uma única vez na janela.' });
}

export const CriarJanelaSchema = z.object(camposJanela).superRefine(conferirJanela);
export type CriarJanela = z.input<typeof CriarJanelaSchema>;

/**
 * Alteração. Em rascunho, os campos mudam livremente (com versão). Depois de
 * confirmada, mudar limite, período ou critérios exige justificativa e fonte
 * (`ruleChange`) e gera nova versão das regras; fotografias anteriores não mudam.
 */
export const AlterarJanelaSchema = z
  .object({
    ...camposJanela,
    expectedVersion: Versao,
    ruleChange: z.object({ justification: Motivo, source: textoIdentificador(120, 'Fonte da alteração') }).nullable().default(null),
  })
  .superRefine(conferirJanela);
export type AlterarJanela = z.input<typeof AlterarJanelaSchema>;

export const ConfirmarJanelaSchema = z.object({ expectedVersion: Versao });
export const EncerrarJanelaSchema = z.object({
  expectedVersion: Versao,
  reason: Motivo,
  /** Liberar explicitamente as reservas ativas na mesma operação (sem isso, reservas ativas bloqueiam). */
  releaseActiveReservations: z.boolean().default(false),
});
export type EncerrarJanela = z.input<typeof EncerrarJanelaSchema>;

export const FiltroJanelasSchema = z.object({
  mes: MesSchema.optional(),
  situacao: SituacaoJanelaSchema.optional(),
  texto: z.string().trim().max(64).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  tamanho: z.coerce.number().int().min(1).max(LIMITE_PAGINA_JANELAS).default(30),
});
export type FiltroJanelas = z.infer<typeof FiltroJanelasSchema>;

// ---------- Leitura da janela ----------

export const SituacaoMetricaSchema = z.enum(['OK', 'PENDENTE', 'SEM_CAPACIDADE']);

export const RestricaoJanelaSchema = z.object({
  id: z.uuid(),
  metric: MetricaCapacidadeSchema,
  unit: z.string().min(1),
  weightBase: BasePesoSchema.nullable(),
  /** `null` = limite pendente (nunca ilimitado). */
  limit: QuantidadeSchema.nullable(),
  /** Reservas ativas (ainda não expedidas). */
  reserved: QuantidadeSchema,
  /** Expedições confirmadas. */
  shipped: QuantidadeSchema,
  /** limite − reservado − expedido; `null` com limite pendente. */
  remaining: QuantidadeSchema.nullable(),
  state: SituacaoMetricaSchema,
});
export type RestricaoJanela = z.infer<typeof RestricaoJanelaSchema>;

export const CriteriosJanelaSchema = z.object({
  defined: z.boolean(),
  acceptedConditions: z.array(CondicaoMaterialSchema),
  acceptedOriginTypes: z.array(TipoOrigemDocumentoSchema).nullable(),
  requireLot: z.boolean(),
  requireOrigin: z.boolean(),
  requiredDocuments: z.array(z.string().min(1)),
  notes: z.string().nullable(),
});
export type CriteriosJanela = z.infer<typeof CriteriosJanelaSchema>;

export const AutorizacaoJanelaSchema = z.object({
  source: z.string().nullable(),
  reference: z.string().nullable(),
  date: DataSchema.nullable(),
  responsible: z.string().nullable(),
});

const RegistroAutorSchema = z.object({ by: UsuarioResumoSchema, at: z.iso.datetime() });

export const JanelaResumoSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  clientReference: z.string().nullable(),
  referenceMonth: MesSchema,
  state: SituacaoJanelaSchema,
  exitStart: z.iso.datetime().nullable(),
  exitEnd: z.iso.datetime().nullable(),
  preparationDeadline: z.iso.datetime().nullable(),
  restrictions: z.array(RestricaoJanelaSchema),
  /** Pendências que impedem reservar/expedir (texto operacional). */
  pendencies: z.array(z.string().min(1)),
  activeReservations: z.number().int().nonnegative(),
  expeditions: z.number().int().nonnegative(),
  version: Versao,
  rulesVersion: Versao,
});
export type JanelaResumo = z.infer<typeof JanelaResumoSchema>;

export const PaginaJanelasSchema = z.object({
  items: z.array(JanelaResumoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  consultedAt: z.iso.datetime(),
});
export type PaginaJanelas = z.infer<typeof PaginaJanelasSchema>;

export const AnexoJanelaSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  contentType: TipoAnexoSchema,
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uploadedBy: UsuarioResumoSchema,
  uploadedAt: z.iso.datetime(),
});
export type AnexoJanela = z.infer<typeof AnexoJanelaSchema>;

export const VersaoRegrasSchema = z.object({
  version: Versao,
  at: z.iso.datetime(),
  by: UsuarioResumoSchema,
  justification: z.string().nullable(),
  source: z.string().nullable(),
  /** Fotografia das regras nesta versão (período, critérios e limites). */
  snapshot: z.object({
    exitStart: z.iso.datetime().nullable(),
    exitEnd: z.iso.datetime().nullable(),
    criteria: CriteriosJanelaSchema,
    restrictions: z.array(z.object({ metric: MetricaCapacidadeSchema, unit: z.string(), weightBase: BasePesoSchema.nullable(), limit: QuantidadeSchema.nullable() })),
  }),
});
export type VersaoRegras = z.infer<typeof VersaoRegrasSchema>;

export const MetricaValorSchema = z.object({
  restrictionId: z.uuid(),
  metric: MetricaCapacidadeSchema,
  unit: z.string().min(1),
  value: QuantidadeSchema,
});
export type MetricaValor = z.infer<typeof MetricaValorSchema>;

export const ReservaResumoSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  state: SituacaoReservaSchema,
  /** Consumida com envio menor que o reservado (restante liberado). */
  partial: z.boolean(),
  preparation: SituacaoPreparacaoSchema,
  lineCount: z.number().int().nonnegative(),
  palletCount: z.number().int().nonnegative(),
  metrics: z.array(MetricaValorSchema),
  createdAt: z.iso.datetime(),
  createdBy: UsuarioResumoSchema,
  expeditionId: z.uuid().nullable(),
});
export type ReservaResumo = z.infer<typeof ReservaResumoSchema>;

export const ExpedicaoResumoSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  reservationId: z.uuid(),
  reservationCode: z.string().min(1),
  shippedAt: z.iso.datetime(),
  partial: z.boolean(),
  confirmedBy: UsuarioResumoSchema,
  confirmedAt: z.iso.datetime(),
  returns: z.number().int().nonnegative(),
});
export type ExpedicaoResumo = z.infer<typeof ExpedicaoResumoSchema>;

export const JanelaDetalheSchema = JanelaResumoSchema.extend({
  criteria: CriteriosJanelaSchema,
  authorization: AutorizacaoJanelaSchema,
  notes: z.string().nullable(),
  createdBy: UsuarioResumoSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  confirmed: RegistroAutorSchema.nullable(),
  closure: RegistroAutorSchema.extend({ reason: z.string() }).nullable(),
  reservations: z.array(ReservaResumoSchema),
  expeditionsList: z.array(ExpedicaoResumoSchema),
  attachments: z.array(AnexoJanelaSchema),
  ruleVersions: z.array(VersaoRegrasSchema),
  dataSource: z.enum(['DEMONSTRACAO_FICTICIA', 'OPERACAO']),
  timeZone: z.string().min(1),
  consultedAt: z.iso.datetime(),
});
export type JanelaDetalhe = z.infer<typeof JanelaDetalheSchema>;

// ---------- Liberação do material ----------

const LiberacaoBase = { expectedVersion: Versao };
export const LiberacaoMaterialSchema = z.discriminatedUnion('action', [
  z.object({
    ...LiberacaoBase,
    action: z.literal('LIBERAR'),
    segmentId: z.uuid(),
    /** Quantidade acrescentada à parte liberada (liberação parcial identifica a quantidade). */
    quantity: QuantidadeSchema,
    criterion: texto(3, 300, 'Critério'),
    source: textoIdentificador(120, 'Fonte'),
    reference: textoIdentificador(120, 'Referência').nullable().default(null),
    reason: Motivo,
  }),
  z.object({ ...LiberacaoBase, action: z.literal('REVOGAR'), segmentId: z.uuid(), quantity: QuantidadeSchema, reason: Motivo }),
  z.object({ ...LiberacaoBase, action: z.literal('BLOQUEAR'), segmentId: z.uuid(), reason: Motivo }),
  z.object({ ...LiberacaoBase, action: z.literal('DESBLOQUEAR'), segmentId: z.uuid(), reason: Motivo }),
  z.object({ ...LiberacaoBase, action: z.literal('BLOQUEAR_PALETE'), reason: Motivo }),
  z.object({ ...LiberacaoBase, action: z.literal('DESBLOQUEAR_PALETE'), reason: Motivo }),
]);
export type LiberacaoMaterial = z.input<typeof LiberacaoMaterialSchema>;

export const EventoLiberacaoSchema = z.object({
  id: z.uuid(),
  type: TipoEventoLiberacaoSchema,
  segmentId: z.uuid().nullable(),
  sku: z.string().nullable(),
  lot: z.string().nullable(),
  quantity: QuantidadeSchema.nullable(),
  releasedBefore: QuantidadeSchema.nullable(),
  releasedAfter: QuantidadeSchema.nullable(),
  criterion: z.string().nullable(),
  source: z.string().nullable(),
  reference: z.string().nullable(),
  reason: z.string().min(1),
  by: UsuarioResumoSchema.nullable(),
  at: z.iso.datetime(),
});
export type EventoLiberacao = z.infer<typeof EventoLiberacaoSchema>;

export const HistoricoLiberacaoSchema = z.object({ items: z.array(EventoLiberacaoSchema) });

// ---------- Material elegível e pendências ----------

export const CodigoPendenciaMaterialSchema = z.enum([
  'PALETE_BLOQUEADO',
  'MATERIAL_BLOQUEADO',
  'NAO_LIBERADO',
  'CONFERENCIA_PENDENTE',
  'CONFERENCIA_EM_ANDAMENTO',
  'CRITERIO_CONDICAO',
  'CRITERIO_ORIGEM',
  'CRITERIO_LOTE',
  'CRITERIOS_PENDENTES',
  'VINCULADO_CLAIM',
]);
export type CodigoPendenciaMaterial = z.infer<typeof CodigoPendenciaMaterialSchema>;

export const PendenciaMaterialSchema = z.object({
  code: CodigoPendenciaMaterialSchema,
  message: z.string().min(1),
  /** Quem registrou o bloqueio, quando conhecido. */
  responsible: UsuarioResumoSchema.nullable(),
  nextStep: z.string().min(1),
});
export type PendenciaMaterial = z.infer<typeof PendenciaMaterialSchema>;

export const FilaMaterialSchema = z.enum(['ELEGIVEL', 'PENDENTE']);
export type FilaMaterial = z.infer<typeof FilaMaterialSchema>;

export const FiltroMaterialSchema = z.object({
  /** Janela cujos critérios se aplicam (sem janela: só liberação, bloqueios e conferência). */
  janela: z.uuid().optional(),
  fila: FilaMaterialSchema.default('ELEGIVEL'),
  texto: z.string().trim().max(64).optional(),
  condicao: CondicaoMaterialSchema.optional(),
  palete: z.uuid().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  tamanho: z.coerce.number().int().min(1).max(LIMITE_PAGINA_MATERIAL).default(30),
});
export type FiltroMaterial = z.infer<typeof FiltroMaterialSchema>;

export const MaterialExpedicaoSchema = z.object({
  palletId: z.uuid(),
  palletCode: z.string().min(1),
  palletVersion: Versao,
  positionId: z.uuid().nullable(),
  positionCode: z.string().nullable(),
  segmentId: z.uuid(),
  productId: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  lot: z.string().nullable(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().nullable(),
  condition: CondicaoMaterialSchema,
  unit: z.string().min(1),
  /** Saldo físico validado. */
  quantity: QuantidadeSchema,
  /** Reservas ativas de todas as janelas. */
  reserved: QuantidadeSchema,
  released: QuantidadeSchema,
  claimLinked: QuantidadeSchema,
  /** Reservável agora: liberado − reservado, sem a parte vinculada a claim. */
  available: QuantidadeSchema,
  /** Primeira entrada física comprovada (reconciliação) do material no escopo. */
  fifoDate: z.iso.datetime().nullable(),
  /** Data documental de referência (importação), separada da entrada física. */
  documentDate: DataSchema.nullable(),
  pendencies: z.array(PendenciaMaterialSchema),
});
export type MaterialExpedicao = z.infer<typeof MaterialExpedicaoSchema>;

export const PaginaMaterialSchema = z.object({
  queue: FilaMaterialSchema,
  windowId: z.uuid().nullable(),
  items: z.array(MaterialExpedicaoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  consultedAt: z.iso.datetime(),
});
export type PaginaMaterial = z.infer<typeof PaginaMaterialSchema>;

// ---------- Reserva ----------

/** Medidas da unidade de carga (o palete físico): só as exigidas pelas restrições da janela. */
export const UnidadeCargaEntradaSchema = z
  .object({
    palletId: z.uuid(),
    boxes: Inteiro.nullable().default(null),
    weightKg: QuantidadeSchema.nullable().default(null),
    weightBase: BasePesoSchema.nullable().default(null),
    volumeM3: QuantidadeSchema.nullable().default(null),
    /** Fonte da medida (ex.: balança, trena, contagem física). */
    measurementSource: textoIdentificador(120, 'Fonte da medida').nullable().default(null),
  })
  .superRefine((u, ctx) => {
    if (u.weightKg !== null && u.weightBase === null) ctx.addIssue({ code: 'custom', path: ['weightBase'], message: 'Informe se o peso é bruto ou líquido.' });
    if ((u.boxes !== null || u.weightKg !== null || u.volumeM3 !== null) && u.measurementSource === null) {
      ctx.addIssue({ code: 'custom', path: ['measurementSource'], message: 'Informe a fonte da medida.' });
    }
  });
export type UnidadeCargaEntrada = z.input<typeof UnidadeCargaEntradaSchema>;

export const LinhaReservaEntradaSchema = z
  .object({
    palletId: z.uuid(),
    segmentId: z.uuid(),
    quantity: QuantidadeSchema,
    /** Versão do palete revisada na seleção (dados alterados invalidam a revisão). */
    expectedPalletVersion: Versao,
  })
  .refine((l) => compararQuantidades(l.quantity, '0') > 0, { path: ['quantity'], message: 'Quantidade a reservar precisa ser maior que zero.' });

export const CriarReservaSchema = z
  .object({
    expectedWindowVersion: Versao,
    lines: z.array(LinhaReservaEntradaSchema).min(1, 'Selecione ao menos uma linha.').max(LIMITE_LINHAS_RESERVA),
    loadUnits: z.array(UnidadeCargaEntradaSchema).max(LIMITE_LINHAS_RESERVA).default([]),
    notes: textoOpcional(500).optional(),
  })
  .superRefine((r, ctx) => {
    const chaves = r.lines.map((l) => `${l.palletId}:${l.segmentId}`);
    if (new Set(chaves).size !== chaves.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Linha repetida na seleção.' });
    const unidades = r.loadUnits.map((u) => u.palletId);
    if (new Set(unidades).size !== unidades.length) ctx.addIssue({ code: 'custom', path: ['loadUnits'], message: 'Unidade de carga repetida.' });
  });
export type CriarReserva = z.input<typeof CriarReservaSchema>;

export const SituacaoVerificacaoSchema = z.enum(['OK', 'EXCEDE', 'PENDENTE', 'INCOMPATIVEL']);
export type SituacaoVerificacao = z.infer<typeof SituacaoVerificacaoSchema>;

export const VerificacaoMetricaSchema = z.object({
  restrictionId: z.uuid(),
  metric: MetricaCapacidadeSchema,
  unit: z.string().min(1),
  weightBase: BasePesoSchema.nullable(),
  limit: QuantidadeSchema.nullable(),
  reserved: QuantidadeSchema,
  shipped: QuantidadeSchema,
  remaining: QuantidadeSchema.nullable(),
  /** Quanto esta operação consome (`null` quando a medida é desconhecida ou incompatível). */
  requested: QuantidadeSchema.nullable(),
  state: SituacaoVerificacaoSchema,
  message: z.string().min(1),
  /** Fator e fonte usados (ex.: "mesma unidade (UN)", "volume medido: trena"). */
  basis: z.string().min(1),
});
export type VerificacaoMetrica = z.infer<typeof VerificacaoMetricaSchema>;

export const PreviaReservaSchema = z.object({
  allowed: z.boolean(),
  blockers: z.array(z.string().min(1)),
  metrics: z.array(VerificacaoMetricaSchema),
  windowVersion: Versao,
  lines: z.array(
    z.object({
      palletId: z.uuid(),
      palletCode: z.string(),
      segmentId: z.uuid(),
      sku: z.string(),
      quantity: QuantidadeSchema,
      available: QuantidadeSchema,
      unit: z.string(),
      problems: z.array(z.string()),
    }),
  ),
});
export type PreviaReserva = z.infer<typeof PreviaReservaSchema>;

export const CancelarReservaSchema = z.object({ expectedVersion: Versao, reason: Motivo });
export type CancelarReserva = z.input<typeof CancelarReservaSchema>;

export const UnidadeCargaSchema = z.object({
  palletId: z.uuid(),
  palletCode: z.string().min(1),
  boxes: z.string().nullable(),
  weightKg: QuantidadeSchema.nullable(),
  weightBase: BasePesoSchema.nullable(),
  volumeM3: QuantidadeSchema.nullable(),
  measurementSource: z.string().nullable(),
  informedBy: UsuarioResumoSchema,
  informedAt: z.iso.datetime(),
  version: Versao,
});
export type UnidadeCarga = z.infer<typeof UnidadeCargaSchema>;

export const LinhaReservaSchema = z.object({
  id: z.uuid(),
  palletId: z.uuid(),
  palletCode: z.string().min(1),
  /** Endereço registrado na fotografia da reserva. */
  snapshotPositionCode: z.string().nullable(),
  /** Endereço atual do palete (pode ter mudado por movimento). */
  currentPositionId: z.uuid().nullable(),
  currentPositionCode: z.string().nullable(),
  palletFlowState: EstadoFluxoSchema,
  segmentId: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  lot: z.string().nullable(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().nullable(),
  condition: CondicaoMaterialSchema,
  unit: z.string().min(1),
  quantity: QuantidadeSchema,
  prepared: QuantidadeSchema.nullable(),
  shipped: QuantidadeSchema.nullable(),
  releasedRemainder: QuantidadeSchema.nullable(),
  /** Impedimentos atuais para expedir esta linha (bloqueio, conferência, saldo). */
  currentProblems: z.array(z.string().min(1)),
});
export type LinhaReserva = z.infer<typeof LinhaReservaSchema>;

export const PreparacaoSchema = z.object({
  state: SituacaoPreparacaoSchema,
  preparedAt: z.iso.datetime().nullable(),
  responsible: UsuarioResumoSchema.nullable(),
  registeredBy: UsuarioResumoSchema.nullable(),
  registeredAt: z.iso.datetime().nullable(),
  notes: z.string().nullable(),
  differences: z.array(z.string()),
});

export const ReservaDetalheSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  window: z.object({ id: z.uuid(), code: z.string(), name: z.string(), state: SituacaoJanelaSchema, version: Versao, exitStart: z.iso.datetime().nullable(), exitEnd: z.iso.datetime().nullable() }),
  state: SituacaoReservaSchema,
  partial: z.boolean(),
  version: Versao,
  rulesVersion: Versao,
  /** Critérios e limites da janela no momento da reserva. */
  criteriaSnapshot: CriteriosJanelaSchema,
  lines: z.array(LinhaReservaSchema),
  loadUnits: z.array(UnidadeCargaSchema),
  metrics: z.array(MetricaValorSchema),
  /** Situação atual de cada restrição da janela, para a revisão. */
  windowMetrics: z.array(RestricaoJanelaSchema),
  preparation: PreparacaoSchema,
  requiredDocuments: z.array(z.string()),
  notes: z.string().nullable(),
  createdBy: UsuarioResumoSchema,
  createdAt: z.iso.datetime(),
  closure: RegistroAutorSchema.extend({ reason: z.string() }).nullable(),
  expedition: ExpedicaoResumoSchema.nullable(),
  dataSource: z.enum(['DEMONSTRACAO_FICTICIA', 'OPERACAO']),
  consultedAt: z.iso.datetime(),
});
export type ReservaDetalhe = z.infer<typeof ReservaDetalheSchema>;

// ---------- Preparação ----------

export const RegistrarPreparacaoSchema = z.object({
  expectedVersion: Versao,
  preparedAt: DataHoraSchema,
  responsibleId: z.uuid(),
  /** Quantidades conferidas na separação, por linha da reserva. */
  lines: z.array(z.object({ lineId: z.uuid(), quantity: QuantidadeSchema })).min(1).max(LIMITE_LINHAS_RESERVA),
  /** Medidas atualizadas na preparação (revalidam a capacidade); vazio = mantém as da reserva. */
  loadUnits: z.array(UnidadeCargaEntradaSchema).max(LIMITE_LINHAS_RESERVA).default([]),
  notes: textoOpcional(500).optional(),
});
export type RegistrarPreparacao = z.input<typeof RegistrarPreparacaoSchema>;

// ---------- Expedição ----------

export const DocumentoEntradaSchema = z
  .object({
    name: textoIdentificador(80, 'Documento'),
    /** Referência textual do documento (preserva zeros à esquerda). */
    reference: textoIdentificador(120, 'Referência do documento').nullable().default(null),
    attachmentId: z.uuid().nullable().default(null),
  })
  .refine((d) => d.reference !== null || d.attachmentId !== null, { path: ['reference'], message: 'Informe a referência ou anexe o documento.' });

export const ConfirmarExpedicaoSchema = z
  .object({
    /** Versão da reserva revisada. */
    expectedVersion: Versao,
    shippedAt: DataHoraSchema,
    responsibleId: z.uuid(),
    /** Quantidade efetivamente enviada por linha (0 = nada desta linha; o restante é liberado). */
    lines: z.array(z.object({ lineId: z.uuid(), quantity: QuantidadeSchema })).min(1).max(LIMITE_LINHAS_RESERVA),
    /** Medidas reais das unidades de carga enviadas. */
    loadUnits: z
      .array(
        z.object({
          palletId: z.uuid(),
          boxes: Inteiro.nullable().default(null),
          weightKg: QuantidadeSchema.nullable().default(null),
          weightBase: BasePesoSchema.nullable().default(null),
          volumeM3: QuantidadeSchema.nullable().default(null),
          measurementSource: textoIdentificador(120, 'Fonte da medida').nullable().default(null),
          /** O palete físico inteiro saiu (todo o conteúdo validado enviado): libera a posição. */
          palletLeaves: z.boolean().default(false),
        }),
      )
      .max(LIMITE_LINHAS_RESERVA)
      .default([]),
    documents: z.array(DocumentoEntradaSchema).max(LIMITE_DOCUMENTOS_EXIGIDOS).default([]),
    /** Confirmação explícita de "quantidade enviada e restante a liberar" quando o envio é menor que o reservado. */
    remainderAcknowledged: z.boolean().default(false),
    notes: textoOpcional(500).optional(),
  })
  .refine((e) => e.lines.some((l) => compararQuantidades(l.quantity, '0') > 0), { path: ['lines'], message: 'Nenhuma quantidade enviada: para não expedir, cancele a reserva.' });
export type ConfirmarExpedicao = z.input<typeof ConfirmarExpedicaoSchema>;

export const CorrigirExpedicaoSchema = z.object({
  expectedVersion: Versao,
  reason: Motivo,
  notes: textoOpcional(500).optional(),
  documents: z.array(DocumentoEntradaSchema).max(LIMITE_DOCUMENTOS_EXIGIDOS).optional(),
});
export type CorrigirExpedicao = z.input<typeof CorrigirExpedicaoSchema>;

export const LinhaExpedicaoSchema = z.object({
  id: z.uuid(),
  reservationLineId: z.uuid(),
  palletId: z.uuid(),
  palletCode: z.string().min(1),
  positionCodeAtExit: z.string().nullable(),
  segmentId: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  lot: z.string().nullable(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().nullable(),
  condition: CondicaoMaterialSchema,
  unit: z.string().min(1),
  reserved: QuantidadeSchema,
  shipped: QuantidadeSchema,
  releasedRemainder: QuantidadeSchema,
  /** Retornos físicos já registrados desta linha. */
  returned: QuantidadeSchema,
});
export type LinhaExpedicao = z.infer<typeof LinhaExpedicaoSchema>;

export const MetricaExpedicaoSchema = z.object({
  restrictionId: z.uuid(),
  metric: MetricaCapacidadeSchema,
  unit: z.string().min(1),
  reserved: QuantidadeSchema,
  shipped: QuantidadeSchema,
  released: QuantidadeSchema,
});

export const DocumentoExpedicaoSchema = z.object({ name: z.string().min(1), reference: z.string().nullable(), attachmentId: z.uuid().nullable() });

export const LinhaRetornoSchema = z.object({ expeditionLineId: z.uuid(), sku: z.string(), lot: z.string().nullable(), unit: z.string(), quantity: QuantidadeSchema });

export const RetornoSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  type: TipoRetornoSchema,
  receivedAt: z.iso.datetime(),
  reason: z.string().min(1),
  condition: CondicaoMaterialSchema,
  destinationPallet: z.object({ id: z.uuid(), code: z.string() }).nullable(),
  lines: z.array(LinhaRetornoSchema),
  attachments: z.array(z.uuid()),
  notes: z.string().nullable(),
  registeredBy: UsuarioResumoSchema,
  registeredAt: z.iso.datetime(),
  nextStep: z.string().min(1),
});
export type Retorno = z.infer<typeof RetornoSchema>;

export const ExpedicaoDetalheSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  window: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  reservation: z.object({ id: z.uuid(), code: z.string(), state: SituacaoReservaSchema }),
  shippedAt: z.iso.datetime(),
  responsible: UsuarioResumoSchema,
  confirmedBy: UsuarioResumoSchema,
  confirmedAt: z.iso.datetime(),
  partial: z.boolean(),
  lines: z.array(LinhaExpedicaoSchema),
  loadUnits: z.array(
    z.object({
      palletId: z.uuid(),
      palletCode: z.string(),
      boxes: z.string().nullable(),
      weightKg: QuantidadeSchema.nullable(),
      weightBase: BasePesoSchema.nullable(),
      volumeM3: QuantidadeSchema.nullable(),
      measurementSource: z.string().nullable(),
      palletLeft: z.boolean(),
    }),
  ),
  metrics: z.array(MetricaExpedicaoSchema),
  documents: z.array(DocumentoExpedicaoSchema),
  stockEventIds: z.array(z.uuid()),
  notes: z.string().nullable(),
  version: Versao,
  corrections: z.array(z.object({ at: z.iso.datetime(), by: UsuarioResumoSchema, reason: z.string(), before: z.unknown(), after: z.unknown() })),
  returns: z.array(RetornoSchema),
  dataSource: z.enum(['DEMONSTRACAO_FICTICIA', 'OPERACAO']),
});
export type ExpedicaoDetalhe = z.infer<typeof ExpedicaoDetalheSchema>;

// ---------- Retorno físico ----------

export const RegistrarRetornoSchema = z
  .object({
    expectedVersion: Versao,
    type: TipoRetornoSchema,
    receivedAt: DataHoraSchema,
    reason: Motivo,
    condition: CondicaoMaterialSchema,
    /** Palete que recebeu fisicamente o retorno (cadastrado, não conferido e sem saldo). */
    destinationPalletId: z.uuid().nullable().default(null),
    lines: z.array(z.object({ expeditionLineId: z.uuid(), quantity: QuantidadeSchema })).max(LIMITE_LINHAS_RESERVA).default([]),
    attachmentIds: z.array(z.uuid()).max(10).default([]),
    notes: textoOpcional(500).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.type === 'RECEBIMENTO_FISICO') {
      if (r.destinationPalletId === null) ctx.addIssue({ code: 'custom', path: ['destinationPalletId'], message: 'Informe o palete que recebeu o retorno.' });
      if (r.lines.length === 0) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Informe as linhas e quantidades retornadas.' });
      if (r.attachmentIds.length === 0) ctx.addIssue({ code: 'custom', path: ['attachmentIds'], message: 'Recebimento físico exige evidência anexada.' });
    }
    for (const [i, l] of r.lines.entries()) {
      if (compararQuantidades(l.quantity, '0') <= 0) ctx.addIssue({ code: 'custom', path: ['lines', i, 'quantity'], message: 'Quantidade retornada precisa ser maior que zero.' });
    }
  });
export type RegistrarRetorno = z.input<typeof RegistrarRetornoSchema>;

// ---------- Histórico ----------

export const TipoEventoJanelaSchema = z.enum([
  'JANELA_CRIADA',
  'JANELA_ALTERADA',
  'REGRAS_ALTERADAS',
  'JANELA_CONFIRMADA',
  'PREPARACAO_INICIADA',
  'JANELA_ENCERRADA',
  'JANELA_CANCELADA',
  'ANEXO_ENVIADO',
  'RESERVA_CRIADA',
  'RESERVA_CANCELADA',
  'RESERVA_LIBERADA',
  'PREPARACAO_REGISTRADA',
  'MEDIDAS_ALTERADAS',
  'EXPEDICAO_CONFIRMADA',
  'EXPEDICAO_CORRIGIDA',
  'RETORNO_REGISTRADO',
]);
export type TipoEventoJanela = z.infer<typeof TipoEventoJanelaSchema>;

export const EventoJanelaSchema = z.object({
  id: z.uuid(),
  type: TipoEventoJanelaSchema,
  at: z.iso.datetime(),
  by: UsuarioResumoSchema,
  summary: z.string().min(1),
  reservationId: z.uuid().nullable(),
  expeditionId: z.uuid().nullable(),
  returnId: z.uuid().nullable(),
  details: z.unknown(),
});
export type EventoJanela = z.infer<typeof EventoJanelaSchema>;

export const FiltroHistoricoJanelaSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  tamanho: z.coerce.number().int().min(1).max(100).default(30),
});

export const PaginaHistoricoJanelaSchema = z.object({
  items: z.array(EventoJanelaSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type PaginaHistoricoJanela = z.infer<typeof PaginaHistoricoJanelaSchema>;

export const ResponsaveisJanelaSchema = z.object({ items: z.array(z.object({ id: z.uuid(), login: z.string(), name: z.string() })) });

// ---------- Rótulos ----------

export const ROTULOS_SITUACAO_JANELA: Readonly<Record<SituacaoJanela, string>> = {
  RASCUNHO: 'Rascunho',
  CONFIRMADA: 'Confirmada',
  PREPARACAO: 'Em preparação',
  ENCERRADA: 'Encerrada',
  CANCELADA: 'Cancelada',
};
export const ROTULOS_METRICA: Readonly<Record<MetricaCapacidade, string>> = {
  QUANTIDADE: 'Quantidade',
  CAIXAS: 'Caixas',
  PALETES: 'Paletes',
  PESO_KG: 'Peso',
  VOLUME_M3: 'Volume',
};
export const ROTULOS_SITUACAO_RESERVA: Readonly<Record<SituacaoReserva, string>> = {
  ATIVA: 'Ativa',
  LIBERADA: 'Liberada',
  CONSUMIDA: 'Consumida',
  CANCELADA: 'Cancelada',
};
export const ROTULOS_BASE_PESO: Readonly<Record<BasePeso, string>> = { BRUTO: 'bruto', LIQUIDO: 'líquido' };
