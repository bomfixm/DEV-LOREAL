import { z } from 'zod';
import { UsuarioResumoSchema } from './acesso.js';
import { UnidadeMedidaSchema, textoIdentificador, textoOpcional } from './codigos.js';
import { QuantidadeSchema, compararQuantidades } from './decimal.js';
import { CondicaoMaterialSchema, EstadoConferenciaSchema, EstadoFluxoSchema, EstadoLiberacaoSchema, TipoOrigemDocumentoSchema } from './estados.js';
import { SituacaoConferenciaSchema } from './conferencia.js';
import { MoedaSchema, ValorCalculadoSchema, ValorSchema } from './valores.js';

/**
 * Claims e rastreabilidade (etapa 07; docs/DADOS-E-REGRAS.md R15–R20).
 *
 * Um caso (claim) tem ID interno permanente, código legível (CLM-000001) e
 * referência externa textual opcional; cada linha tem identidade própria no
 * caso (texto). Busca por SKU encontra pistas, não prova. Recuperação física
 * validada e resultado da regularização (financeiro) são registros distintos;
 * valor estimado nunca é apresentado como valor evitado confirmado.
 */

export const MotivoClaimSchema = z.enum(['EXTRAVIO_FALTA', 'AVARIA', 'DIVERGENCIA_DOCUMENTAL']);
export type MotivoClaim = z.infer<typeof MotivoClaimSchema>;
export const MOTIVOS_CLAIM = MotivoClaimSchema.options;

/**
 * Situação operacional do caso. As três últimas são finais (decisão de
 * encerramento por perfil autorizado); reabrir volta a EM_ANALISE ou
 * BUSCA_EM_ANDAMENTO sem desfazer decisões nem liberar quantidades.
 */
export const SituacaoClaimSchema = z.enum([
  'EM_ANALISE',
  'BUSCA_EM_ANDAMENTO',
  'CANDIDATO_LOCALIZADO',
  'VALIDACAO_PENDENTE',
  'REGULARIZADO',
  'PERDA_CONFIRMADA',
  'ENCERRADO',
]);
export type SituacaoClaim = z.infer<typeof SituacaoClaimSchema>;
export const SITUACOES_CLAIM = SituacaoClaimSchema.options;
export const SITUACOES_FINAIS_CLAIM = ['REGULARIZADO', 'PERDA_CONFIRMADA', 'ENCERRADO'] as const satisfies readonly SituacaoClaim[];
export type SituacaoFinalClaim = (typeof SITUACOES_FINAIS_CLAIM)[number];
/** Situações escolhidas manualmente durante a investigação (ação explícita). */
export const SITUACOES_INVESTIGACAO = ['EM_ANALISE', 'BUSCA_EM_ANDAMENTO', 'CANDIDATO_LOCALIZADO'] as const satisfies readonly SituacaoClaim[];

export function situacaoFinal(s: SituacaoClaim): s is SituacaoFinalClaim {
  return (SITUACOES_FINAIS_CLAIM as readonly SituacaoClaim[]).includes(s);
}

/** Prioridade manual explícita; `null` = não definida. */
export const PrioridadeClaimSchema = z.enum(['URGENTE', 'ALTA', 'NORMAL', 'BAIXA']);
export type PrioridadeClaim = z.infer<typeof PrioridadeClaimSchema>;
export const PRIORIDADES_CLAIM = PrioridadeClaimSchema.options;

/** O valor estimado da linha é o total da linha ou o valor unitário (multiplicado pela quantidade em análise). */
export const BaseValorSchema = z.enum(['TOTAL_LINHA', 'UNITARIO']);
export type BaseValor = z.infer<typeof BaseValorSchema>;

export const OrigemCadastroClaimSchema = z.enum(['MANUAL', 'IMPORTACAO']);

export const CompatibilidadeSchema = z.enum(['COMPATIVEL', 'INCOMPATIVEL', 'PENDENTE', 'NAO_EXIGIDO']);
export type Compatibilidade = z.infer<typeof CompatibilidadeSchema>;

/** Base da pista de candidato. Nenhuma é somada a outra. */
export const BaseCandidatoSchema = z.enum(['SALDO_VALIDADO', 'OBSERVADO', 'DECLARADO_PALETE', 'DOCUMENTO', 'HISTORICO']);
export type BaseCandidato = z.infer<typeof BaseCandidatoSchema>;

export const SituacaoCandidatoSchema = z.enum(['EM_INVESTIGACAO', 'DESCARTADO']);
export const TipoEvidenciaSchema = z.enum(['MATERIAL_CONFERIDO', 'DOCUMENTO', 'DESCRICAO']);
export type TipoEvidencia = z.infer<typeof TipoEvidenciaSchema>;
export const SituacaoEvidenciaSchema = z.enum(['REGISTRADA', 'VALIDACAO_SOLICITADA', 'VALIDADA', 'REJEITADA']);
export type SituacaoEvidencia = z.infer<typeof SituacaoEvidenciaSchema>;
export const SituacaoRecuperacaoSchema = z.enum(['ATIVA', 'ESTORNADA']);
/** Resultado registrado por quem tem `claim.aprovar_financeiro`. */
export const TipoResultadoSchema = z.enum(['REGULARIZACAO', 'PERDA_CONFIRMADA']);
export type TipoResultado = z.infer<typeof TipoResultadoSchema>;
export const SituacaoResultadoSchema = z.enum(['VIGENTE', 'CORRIGIDO', 'ANULADO']);

export const LIMITE_LINHAS_CLAIM = 200;
export const LIMITE_PAGINA_CLAIMS = 100;
export const LIMITE_PAGINA_CANDIDATOS = 50;

const DataSchema = z.iso.date('Data inválida (AAAA-MM-DD).');
const texto = (min: number, max: number, rotulo: string) =>
  z
    .string()
    .trim()
    .min(min, `${rotulo}: pelo menos ${String(min)} caracteres.`)
    .max(max, `${rotulo}: até ${String(max)} caracteres.`)
    .regex(/^(?:[^\p{Cc}]|[\n\r\t])*$/u, `${rotulo}: caracteres inválidos.`);

// ---------- Cadastro ----------

export const LinhaClaimEntradaSchema = z
  .object({
    /** Linha existente (na edição); ausente = nova linha. */
    id: z.uuid().optional(),
    /** Identidade da linha no caso (texto; ex.: "1", "A"). */
    lineRef: textoIdentificador(40, 'Linha'),
    sku: textoIdentificador(60, 'SKU'),
    description: textoOpcional(200).optional(),
    quantity: QuantidadeSchema,
    unit: UnidadeMedidaSchema,
    lot: textoIdentificador(60, 'Lote').nullable().optional(),
    /** Regra do cliente: o lote precisa coincidir para validar recuperação. */
    lotRequired: z.boolean().default(false),
    originType: TipoOrigemDocumentoSchema.nullable().optional(),
    originReference: textoIdentificador(80, 'Referência de origem').nullable().optional(),
    /** Linha/item no documento de origem. */
    originLine: textoIdentificador(40, 'Linha da origem').nullable().optional(),
    estimatedValue: ValorSchema.nullable().optional(),
    valueBase: BaseValorSchema.nullable().optional(),
  })
  .superRefine((l, ctx) => {
    if (compararQuantidades(l.quantity, '0') <= 0) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantidade em análise precisa ser maior que zero.' });
    if ((l.estimatedValue ?? null) === null !== ((l.valueBase ?? null) === null)) {
      ctx.addIssue({ code: 'custom', path: ['valueBase'], message: 'Informe se o valor estimado é total da linha ou unitário.' });
    }
    if ((l.originReference ?? null) !== null && (l.originType ?? null) === null) {
      ctx.addIssue({ code: 'custom', path: ['originType'], message: 'Informe o tipo da origem.' });
    }
  });
export type LinhaClaimEntrada = z.input<typeof LinhaClaimEntradaSchema>;

const cabecalhoClaim = {
  externalReference: textoIdentificador(80, 'Referência externa').nullable().optional(),
  reason: MotivoClaimSchema,
  priority: PrioridadeClaimSchema.nullable().optional(),
  deadline: DataSchema.nullable().optional(),
  openedOn: DataSchema.nullable().optional(),
  occurredOn: DataSchema.nullable().optional(),
  responsibleId: z.uuid().nullable().optional(),
  currency: MoedaSchema.nullable().optional(),
  valueSource: textoOpcional(200).optional(),
  externalStatus: textoOpcional(120).optional(),
  chargeReference: textoIdentificador(80, 'Referência da cobrança').nullable().optional(),
  /** Cobrança já finalizada financeiramente no sistema do cliente. */
  chargeFinalized: z.boolean().default(false),
  notes: textoOpcional(2000).optional(),
};

function refinarCabecalho(c: { currency?: string | null; valueSource?: string | null; lines: { estimatedValue?: string | null; lineRef: string }[] }, ctx: z.RefinementCtx) {
  const temValor = c.lines.some((l) => (l.estimatedValue ?? null) !== null);
  if (temValor && (c.currency ?? null) === null) ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Informe a moeda do valor estimado.' });
  if (temValor && (c.valueSource ?? null) === null) ctx.addIssue({ code: 'custom', path: ['valueSource'], message: 'Informe a fonte do valor estimado.' });
  const vistas = new Set<string>();
  for (const l of c.lines) {
    const chave = l.lineRef.toUpperCase();
    if (vistas.has(chave)) ctx.addIssue({ code: 'custom', path: ['lines'], message: `Linha ${l.lineRef} repetida no caso.` });
    vistas.add(chave);
  }
}

export const CriarClaimSchema = z
  .object({ ...cabecalhoClaim, lines: z.array(LinhaClaimEntradaSchema).min(1, 'Informe ao menos uma linha.').max(LIMITE_LINHAS_CLAIM) })
  .superRefine(refinarCabecalho);
export type CriarClaim = z.input<typeof CriarClaimSchema>;

export const AlterarClaimSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    ...cabecalhoClaim,
    lines: z.array(LinhaClaimEntradaSchema).min(1).max(LIMITE_LINHAS_CLAIM),
    reasonForChange: texto(3, 500, 'Motivo da alteração'),
  })
  .superRefine(refinarCabecalho);
export type AlterarClaim = z.input<typeof AlterarClaimSchema>;

export const TransicaoClaimSchema = z.object({
  expectedVersion: z.number().int().positive(),
  to: z.enum(SITUACOES_INVESTIGACAO),
  reason: texto(3, 500, 'Motivo'),
});
export type TransicaoClaim = z.input<typeof TransicaoClaimSchema>;

export const EncerrarClaimSchema = z.object({
  expectedVersion: z.number().int().positive(),
  to: z.enum(SITUACOES_FINAIS_CLAIM),
  /** Decisão documentada que trata as pendências listadas. */
  decision: texto(10, 2000, 'Decisão'),
  pendenciesAcknowledged: z.literal(true, 'Confirme que a decisão trata as pendências listadas.'),
});
export type EncerrarClaim = z.input<typeof EncerrarClaimSchema>;

export const ReabrirClaimSchema = z.object({
  expectedVersion: z.number().int().positive(),
  to: z.enum(['EM_ANALISE', 'BUSCA_EM_ANDAMENTO']),
  reason: texto(10, 1000, 'Motivo da reabertura'),
});
export type ReabrirClaim = z.input<typeof ReabrirClaimSchema>;

// ---------- Candidatos ----------

export const FiltroCandidatosSchema = z.object({
  pagina: z.coerce.number().int().min(1).max(200).default(1),
  tamanho: z.coerce.number().int().min(1).max(LIMITE_PAGINA_CANDIDATOS).default(20),
});

const PaleteCandidatoSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  positionId: z.uuid().nullable(),
  positionCode: z.string().nullable(),
  countState: EstadoConferenciaSchema,
  releaseState: EstadoLiberacaoSchema,
  flowState: EstadoFluxoSchema,
  archived: z.boolean(),
});

export const VerificacoesCandidatoSchema = z.object({
  product: CompatibilidadeSchema,
  lot: CompatibilidadeSchema,
  origin: CompatibilidadeSchema,
  condition: CompatibilidadeSchema,
});
export type VerificacoesCandidato = z.infer<typeof VerificacoesCandidatoSchema>;

export const CandidatoSchema = z.object({
  key: z.string().min(1),
  base: BaseCandidatoSchema,
  /** Palete vinculado de fato ao registro; documento importado não tem palete. */
  pallet: PaleteCandidatoSchema.nullable(),
  product: z.object({ id: z.uuid(), sku: z.string(), description: z.string() }).nullable(),
  segmentId: z.uuid().nullable(),
  lot: z.string().nullable(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().nullable(),
  condition: CondicaoMaterialSchema.nullable(),
  quantity: QuantidadeSchema.nullable(),
  unit: z.string().nullable(),
  /** SALDO_VALIDADO: reservado, vinculado a recuperações validadas e elegível (saldo − reservado − vinculado). */
  reserved: QuantidadeSchema.nullable(),
  linked: QuantidadeSchema.nullable(),
  eligible: QuantidadeSchema.nullable(),
  session: z.object({ id: z.uuid(), number: z.number().int().positive(), state: SituacaoConferenciaSchema }).nullable(),
  document: z.object({ id: z.uuid(), reference: z.string(), lineReference: z.string(), invoice: z.string().nullable() }).nullable(),
  /** Data do registro que sustenta a pista (reconciliação, conclusão, importação ou último evento). */
  evidenceAt: z.iso.datetime().nullable(),
  checks: VerificacoesCandidatoSchema,
  /** Pistas concretas (sem porcentagem de confiança). */
  clues: z.array(z.string()),
  /** Pendências que bloqueiam a validação de recuperação com este registro. */
  blockers: z.array(z.string()),
  /** Pode sustentar validação de recuperação física (saldo validado sem bloqueios). */
  validatable: z.boolean(),
  /** Candidato já registrado na investigação desta linha. */
  investigationId: z.uuid().nullable(),
});
export type Candidato = z.infer<typeof CandidatoSchema>;

export const RespostaCandidatosSchema = z.object({
  lineId: z.uuid(),
  items: z.array(CandidatoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  /** Histórico (paletes vazios, arquivados ou que não têm mais este material): não prova presença atual. */
  history: z.array(CandidatoSchema),
  notes: z.array(z.string()),
  consultedAt: z.iso.datetime(),
});
export type RespostaCandidatos = z.infer<typeof RespostaCandidatosSchema>;

export const RegistrarCandidatoSchema = z.object({
  lineId: z.uuid(),
  base: BaseCandidatoSchema,
  palletId: z.uuid().nullable().optional(),
  segmentId: z.uuid().nullable().optional(),
  sessionId: z.uuid().nullable().optional(),
  documentLineId: z.uuid().nullable().optional(),
  note: textoOpcional(1000).optional(),
});
export type RegistrarCandidato = z.input<typeof RegistrarCandidatoSchema>;

export const SolicitarConferenciaSchema = z.object({
  expectedVersion: z.number().int().positive(),
  /** Conferência/recontagem existente do palete a vincular; `null` = só registrar a solicitação. */
  sessionId: z.uuid().nullable().default(null),
  note: texto(3, 1000, 'Observação'),
});

export const DescartarCandidatoSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: texto(3, 1000, 'Motivo'),
});

export const CandidatoInvestigadoSchema = z.object({
  id: z.uuid(),
  lineId: z.uuid(),
  base: BaseCandidatoSchema,
  state: SituacaoCandidatoSchema,
  pallet: z.object({ id: z.uuid(), code: z.string() }).nullable(),
  segmentId: z.uuid().nullable(),
  documentLineId: z.uuid().nullable(),
  /** Dados do registro quando a investigação começou (a localização atual é consultada à parte). */
  snapshot: z.record(z.string(), z.unknown()),
  note: z.string().nullable(),
  registeredBy: UsuarioResumoSchema,
  registeredAt: z.iso.datetime(),
  conference: z
    .object({
      requestedBy: UsuarioResumoSchema,
      requestedAt: z.iso.datetime(),
      note: z.string(),
      session: z.object({ id: z.uuid(), number: z.number().int().positive(), state: SituacaoConferenciaSchema }).nullable(),
    })
    .nullable(),
  discardedReason: z.string().nullable(),
  version: z.number().int().positive(),
});
export type CandidatoInvestigado = z.infer<typeof CandidatoInvestigadoSchema>;

// ---------- Anexos ----------

export const TIPOS_ANEXO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const TipoAnexoSchema = z.enum(TIPOS_ANEXO);

export const AnexoSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  contentType: TipoAnexoSchema,
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uploadedBy: UsuarioResumoSchema,
  uploadedAt: z.iso.datetime(),
  evidenceId: z.uuid().nullable(),
  resultId: z.uuid().nullable(),
});
export type Anexo = z.infer<typeof AnexoSchema>;

// ---------- Evidências e validação ----------

export const RegistrarEvidenciaSchema = z
  .object({
    lineId: z.uuid(),
    type: TipoEvidenciaSchema,
    candidateId: z.uuid().nullable().optional(),
    palletId: z.uuid().nullable().optional(),
    segmentId: z.uuid().nullable().optional(),
    sessionId: z.uuid().nullable().optional(),
    documentLineId: z.uuid().nullable().optional(),
    quantity: QuantidadeSchema.nullable().optional(),
    description: texto(10, 2000, 'Descrição'),
    verifiableReference: textoOpcional(200).optional(),
    attachmentIds: z.array(z.uuid()).max(10).default([]),
  })
  .superRefine((e, ctx) => {
    if (e.type === 'MATERIAL_CONFERIDO' && ((e.palletId ?? null) === null || (e.segmentId ?? null) === null)) {
      ctx.addIssue({ code: 'custom', path: ['segmentId'], message: 'Material conferido: escolha o palete e o material (saldo validado).' });
    }
    if (e.type === 'MATERIAL_CONFERIDO' && (e.quantity ?? null) === null) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Material conferido: informe a quantidade conferida.' });
    }
    if (e.type === 'DOCUMENTO' && (e.documentLineId ?? null) === null) {
      ctx.addIssue({ code: 'custom', path: ['documentLineId'], message: 'Documento: escolha a linha do documento registrado.' });
    }
    if (e.type === 'DESCRICAO' && (e.verifiableReference ?? null) === null && e.attachmentIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['verifiableReference'], message: 'Descrição: informe uma referência verificável ou anexe a evidência.' });
    }
  });
export type RegistrarEvidencia = z.input<typeof RegistrarEvidenciaSchema>;

export const SolicitarValidacaoSchema = z.object({
  expectedVersion: z.number().int().positive(),
  quantity: QuantidadeSchema,
  note: textoOpcional(1000).optional(),
});
export type SolicitarValidacao = z.input<typeof SolicitarValidacaoSchema>;

export const ValidarRecuperacaoSchema = z.object({
  expectedVersion: z.number().int().positive(),
  /** Quantidade validada (até a solicitada). */
  quantity: QuantidadeSchema,
  justification: texto(10, 2000, 'Justificativa'),
  /** Tratativa documentada para lote exigido divergente ou desconhecido. */
  lotTreatment: textoOpcional(1000).optional(),
});
export type ValidarRecuperacao = z.input<typeof ValidarRecuperacaoSchema>;

export const RejeitarValidacaoSchema = z.object({
  expectedVersion: z.number().int().positive(),
  justification: texto(10, 2000, 'Justificativa'),
});
export type RejeitarValidacao = z.input<typeof RejeitarValidacaoSchema>;

export const EstornarRecuperacaoSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: texto(10, 1000, 'Motivo do estorno'),
});
export type EstornarRecuperacao = z.input<typeof EstornarRecuperacaoSchema>;

const IdentidadeMaterialSchema = z.object({
  sku: z.string(),
  description: z.string(),
  lot: z.string().nullable(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().nullable(),
  condition: CondicaoMaterialSchema,
  unit: z.string(),
});

export const EvidenciaSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  lineId: z.uuid(),
  lineRef: z.string(),
  type: TipoEvidenciaSchema,
  state: SituacaoEvidenciaSchema,
  candidateId: z.uuid().nullable(),
  pallet: z.object({ id: z.uuid(), code: z.string() }).nullable(),
  /** Endereço do palete no momento da evidência (a localização atual é consultada à parte). */
  positionCodeAtTime: z.string().nullable(),
  segmentId: z.uuid().nullable(),
  material: IdentidadeMaterialSchema.nullable(),
  session: z.object({ id: z.uuid(), number: z.number().int().positive() }).nullable(),
  documentLine: z.object({ id: z.uuid(), reference: z.string(), lineReference: z.string() }).nullable(),
  quantity: QuantidadeSchema.nullable(),
  unit: z.string().nullable(),
  description: z.string(),
  verifiableReference: z.string().nullable(),
  snapshot: z.record(z.string(), z.unknown()),
  attachments: z.array(AnexoSchema),
  author: UsuarioResumoSchema,
  registeredAt: z.iso.datetime(),
  request: z.object({ quantity: QuantidadeSchema, note: z.string().nullable(), by: UsuarioResumoSchema, at: z.iso.datetime() }).nullable(),
  decision: z.object({ by: UsuarioResumoSchema, at: z.iso.datetime(), justification: z.string() }).nullable(),
  version: z.number().int().positive(),
});
export type Evidencia = z.infer<typeof EvidenciaSchema>;

export const RecuperacaoSchema = z.object({
  id: z.uuid(),
  lineId: z.uuid(),
  lineRef: z.string(),
  evidenceId: z.uuid(),
  segmentId: z.uuid(),
  material: IdentidadeMaterialSchema,
  /** Palete e endereço na validação (histórico). */
  palletAtValidation: z.object({ id: z.uuid(), code: z.string(), positionCode: z.string().nullable() }),
  /** Onde a quantidade vinculada está agora (transferências preservam o vínculo). */
  currentLocations: z.array(
    z.object({ palletId: z.uuid(), palletCode: z.string(), positionId: z.uuid().nullable(), positionCode: z.string().nullable(), quantity: QuantidadeSchema }),
  ),
  quantity: QuantidadeSchema,
  unit: z.string(),
  state: SituacaoRecuperacaoSchema,
  validatedBy: UsuarioResumoSchema,
  validatedAt: z.iso.datetime(),
  justification: z.string(),
  lotTreatment: z.string().nullable(),
  reversal: z.object({ by: UsuarioResumoSchema, at: z.iso.datetime(), reason: z.string() }).nullable(),
  version: z.number().int().positive(),
});
export type Recuperacao = z.infer<typeof RecuperacaoSchema>;

// ---------- Resultado da regularização ----------

export const RegistrarResultadoSchema = z
  .object({
    type: TipoResultadoSchema,
    decisionDate: DataSchema,
    lines: z
      .array(z.object({ lineId: z.uuid(), quantity: QuantidadeSchema }))
      .min(1, 'Informe as linhas e quantidades cobertas.')
      .max(LIMITE_LINHAS_CLAIM),
    /** Valor confirmado (evitado na regularização; perda na perda confirmada). */
    value: ValorSchema.nullable(),
    currency: MoedaSchema.nullable(),
    source: texto(3, 200, 'Fonte'),
    reference: texto(3, 200, 'Referência verificável'),
    /** Prova do resultado externo (obrigatória quando a cobrança já está finalizada). */
    externalResultReference: textoOpcional(200).optional(),
    /** Justificativa quando o valor difere da estimativa (ou ela não é derivável). */
    valueJustification: textoOpcional(2000).optional(),
    evidenceIds: z.array(z.uuid()).max(20).default([]),
    attachmentIds: z.array(z.uuid()).max(10).default([]),
    /** Correção: resultado vigente substituído por este (exige motivo). */
    correctsResultId: z.uuid().nullable().default(null),
    correctionReason: textoOpcional(1000).optional(),
  })
  .superRefine((r, ctx) => {
    if ((r.value === null) !== (r.currency === null)) ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Informe valor e moeda juntos.' });
    if (r.evidenceIds.length === 0 && r.attachmentIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['evidenceIds'], message: 'O resultado precisa de evidência: escolha uma evidência registrada ou anexe o comprovante.' });
    }
    if (r.correctsResultId !== null && (r.correctionReason ?? null) === null) {
      ctx.addIssue({ code: 'custom', path: ['correctionReason'], message: 'Informe o motivo da correção.' });
    }
    const ids = new Set<string>();
    for (const l of r.lines) {
      if (ids.has(l.lineId)) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Linha repetida no resultado.' });
      ids.add(l.lineId);
      if (compararQuantidades(l.quantity, '0') <= 0) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Quantidade coberta precisa ser maior que zero.' });
    }
  });
export type RegistrarResultado = z.input<typeof RegistrarResultadoSchema>;

export const AnularResultadoSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: texto(10, 1000, 'Motivo da anulação'),
});

export const EstimativaLinhaSchema = z.object({
  lineId: z.uuid(),
  lineRef: z.string(),
  estimatedValue: ValorSchema.nullable(),
  valueBase: BaseValorSchema.nullable(),
  lineQuantity: QuantidadeSchema,
  coveredQuantity: QuantidadeSchema,
  /** Estimativa correspondente à quantidade coberta, quando derivável sem presunção. */
  estimateForCovered: ValorCalculadoSchema.nullable(),
});

export const ResultadoClaimSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  type: TipoResultadoSchema,
  state: SituacaoResultadoSchema,
  decisionDate: DataSchema,
  lines: z.array(z.object({ lineId: z.uuid(), lineRef: z.string(), quantity: QuantidadeSchema, unit: z.string() })),
  value: ValorSchema.nullable(),
  currency: z.string().nullable(),
  source: z.string(),
  reference: z.string(),
  externalResultReference: z.string().nullable(),
  valueJustification: z.string().nullable(),
  /** Estimativa e fonte no momento da decisão (atualização posterior de preço não altera). */
  estimateSnapshot: z.object({
    currency: z.string().nullable(),
    source: z.string().nullable(),
    lines: z.array(EstimativaLinhaSchema),
    total: ValorCalculadoSchema.nullable(),
  }),
  evidenceIds: z.array(z.uuid()),
  attachments: z.array(AnexoSchema),
  author: UsuarioResumoSchema,
  registeredAt: z.iso.datetime(),
  correctsResultId: z.uuid().nullable(),
  correctionReason: z.string().nullable(),
  closure: z.object({ by: UsuarioResumoSchema, at: z.iso.datetime(), reason: z.string(), replacedById: z.uuid().nullable() }).nullable(),
  version: z.number().int().positive(),
});
export type ResultadoClaim = z.infer<typeof ResultadoClaimSchema>;

// ---------- Detalhe e lista ----------

export const QuantidadePorUnidadeSchema = z.object({ unit: z.string(), quantity: QuantidadeSchema });
export type QuantidadePorUnidade = z.infer<typeof QuantidadePorUnidadeSchema>;
export const ValorPorMoedaSchema = z.object({ currency: z.string(), value: ValorCalculadoSchema });
export type ValorPorMoeda = z.infer<typeof ValorPorMoedaSchema>;

export const CodigoPendenciaSchema = z.enum([
  'SEM_REFERENCIA_EXTERNA',
  'PRODUTO_NAO_CADASTRADO',
  'UNIDADE_INCOMPATIVEL',
  'ORIGEM_PENDENTE',
  'LOTE_PENDENTE',
  'SEM_PRAZO',
  'SEM_RESPONSAVEL',
  'VALOR_SEM_ESTIMATIVA',
  'VALIDACAO_PENDENTE',
  'SEM_RECUPERACAO_VALIDADA',
  'AVARIA_EM_AVALIACAO',
  'COBRANCA_FINALIZADA',
  'SEM_RESULTADO',
]);
export type CodigoPendencia = z.infer<typeof CodigoPendenciaSchema>;
/** Pendências de cadastro (caso em triagem). */
export const PENDENCIAS_TRIAGEM: readonly CodigoPendencia[] = ['SEM_REFERENCIA_EXTERNA', 'PRODUTO_NAO_CADASTRADO', 'UNIDADE_INCOMPATIVEL', 'ORIGEM_PENDENTE', 'LOTE_PENDENTE'];

export const PendenciaSchema = z.object({
  code: CodigoPendenciaSchema,
  message: z.string(),
  lineId: z.uuid().nullable(),
  /** Bloqueia a validação de recuperação desta linha. */
  blocksValidation: z.boolean(),
});
export type Pendencia = z.infer<typeof PendenciaSchema>;

export const LinhaClaimSchema = z.object({
  id: z.uuid(),
  lineRef: z.string(),
  order: z.number().int().positive(),
  productId: z.uuid().nullable(),
  sku: z.string(),
  description: z.string().nullable(),
  quantity: QuantidadeSchema,
  unit: z.string(),
  canonicalUnit: z.string().nullable(),
  lot: z.string().nullable(),
  lotRequired: z.boolean(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().nullable(),
  originLine: z.string().nullable(),
  estimatedValue: ValorSchema.nullable(),
  valueBase: BaseValorSchema.nullable(),
  /** Estimativa total da linha (unitário × quantidade, ou o total informado). */
  estimateTotal: ValorCalculadoSchema.nullable(),
  /** Quantidade com recuperação física validada (ativa). */
  recovered: QuantidadeSchema,
  /** Quantidade sem recuperação física validada. */
  remaining: QuantidadeSchema,
  /** Quantidade coberta por resultados vigentes (regularização ou perda). */
  covered: QuantidadeSchema,
  coveredRegularized: QuantidadeSchema,
  coveredLoss: QuantidadeSchema,
  pendencies: z.array(PendenciaSchema),
  version: z.number().int().positive(),
});
export type LinhaClaim = z.infer<typeof LinhaClaimSchema>;

export const TotaisClaimSchema = z.object({
  inAnalysis: z.array(QuantidadePorUnidadeSchema),
  validatedRecovery: z.array(QuantidadePorUnidadeSchema),
  withoutValidatedRecovery: z.array(QuantidadePorUnidadeSchema),
  /** Valor estimado em análise (não é valor evitado). */
  estimated: z.array(ValorPorMoedaSchema),
  /** Alguma linha sem valor estimado: o total é parcial. */
  estimatePartial: z.boolean(),
  avoidedConfirmed: z.array(ValorPorMoedaSchema),
  lossConfirmed: z.array(ValorPorMoedaSchema),
  regularizedQuantity: z.array(QuantidadePorUnidadeSchema),
  lossConfirmedQuantity: z.array(QuantidadePorUnidadeSchema),
  /** Quantidade ainda sem resultado (perda/avaria em tratativa). */
  inTreatmentQuantity: z.array(QuantidadePorUnidadeSchema),
});
export type TotaisClaim = z.infer<typeof TotaisClaimSchema>;

const ResponsavelSchema = z.object({ id: z.uuid(), login: z.string(), name: z.string() });

export const ClaimDetalheSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  externalReference: z.string().nullable(),
  reason: MotivoClaimSchema,
  state: SituacaoClaimSchema,
  priority: PrioridadeClaimSchema.nullable(),
  deadline: DataSchema.nullable(),
  openedOn: DataSchema.nullable(),
  occurredOn: DataSchema.nullable(),
  responsible: ResponsavelSchema.nullable(),
  currency: z.string().nullable(),
  valueSource: z.string().nullable(),
  externalStatus: z.string().nullable(),
  chargeReference: z.string().nullable(),
  chargeFinalized: z.boolean(),
  notes: z.string().nullable(),
  origin: OrigemCadastroClaimSchema,
  importBatchId: z.uuid().nullable(),
  createdBy: UsuarioResumoSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  closure: z.object({ by: UsuarioResumoSchema, at: z.iso.datetime(), decision: z.string() }).nullable(),
  version: z.number().int().positive(),
  lines: z.array(LinhaClaimSchema),
  totals: TotaisClaimSchema,
  pendencies: z.array(PendenciaSchema),
  candidates: z.array(CandidatoInvestigadoSchema),
  evidences: z.array(EvidenciaSchema),
  recoveries: z.array(RecuperacaoSchema),
  results: z.array(ResultadoClaimSchema),
  attachments: z.array(AnexoSchema),
  /** Situações manuais disponíveis agora. */
  allowedTransitions: z.array(SituacaoClaimSchema),
  consultedAt: z.iso.datetime(),
});
export type ClaimDetalhe = z.infer<typeof ClaimDetalheSchema>;

export const OrdemClaimsSchema = z.enum(['PRIORIDADE', 'PRAZO', 'VALOR', 'RECENTES']);
export type OrdemClaims = z.infer<typeof OrdemClaimsSchema>;
export const FiltroPrazoSchema = z.enum(['VENCIDO', 'PROXIMOS_7_DIAS', 'COM_PRAZO', 'SEM_PRAZO']);
export const FiltroPendenciaSchema = z.enum(['TRIAGEM', 'VALIDACAO_PENDENTE', 'COBRANCA_FINALIZADA', 'SEM_RESPONSAVEL', 'SEM_PRAZO', 'SEM_RECUPERACAO_VALIDADA']);
export type FiltroPendencia = z.infer<typeof FiltroPendenciaSchema>;

const listaSituacoes = z
  .string()
  .max(300)
  .transform((t, ctx) => {
    const lista: SituacaoClaim[] = [];
    for (const parte of t.split(',').map((p) => p.trim()).filter(Boolean)) {
      const s = SituacaoClaimSchema.safeParse(parte);
      if (!s.success) {
        ctx.addIssue({ code: 'custom', message: `Situação desconhecida: ${parte}` });
        return z.NEVER;
      }
      if (!lista.includes(s.data)) lista.push(s.data);
    }
    return lista;
  });

/** GET /claims, /claims/resumo e /claims/exportar (validado no servidor). */
export const FiltroClaimsSchema = z.object({
  texto: z.string().trim().max(80).optional(),
  motivo: MotivoClaimSchema.optional(),
  situacao: listaSituacoes.optional(),
  /** UUID do responsável ou NENHUM. */
  responsavel: z.union([z.uuid(), z.literal('NENHUM')]).optional(),
  prazo: FiltroPrazoSchema.optional(),
  sku: z.string().trim().min(1).max(60).optional(),
  origem: z.string().trim().min(1).max(80).optional(),
  pendencia: FiltroPendenciaSchema.optional(),
  prioridade: z.union([PrioridadeClaimSchema, z.literal('NENHUMA')]).optional(),
  ordem: OrdemClaimsSchema.optional(),
  pagina: z.coerce.number().int().min(1).max(1000).default(1),
  tamanho: z.coerce.number().int().min(1).max(LIMITE_PAGINA_CLAIMS).default(25),
});
export type FiltroClaims = z.output<typeof FiltroClaimsSchema>;

export const ClaimResumoSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  externalReference: z.string().nullable(),
  reason: MotivoClaimSchema,
  state: SituacaoClaimSchema,
  priority: PrioridadeClaimSchema.nullable(),
  deadline: DataSchema.nullable(),
  responsible: ResponsavelSchema.nullable(),
  firstSku: z.string(),
  lineCount: z.number().int().positive(),
  inAnalysis: z.array(QuantidadePorUnidadeSchema),
  validatedRecovery: z.array(QuantidadePorUnidadeSchema),
  currency: z.string().nullable(),
  estimated: ValorCalculadoSchema.nullable(),
  estimatePartial: z.boolean(),
  chargeFinalized: z.boolean(),
  pendingValidations: z.number().int().nonnegative(),
  triage: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type ClaimResumo = z.infer<typeof ClaimResumoSchema>;

export const PaginaClaimsSchema = z.object({
  items: z.array(ClaimResumoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  sort: OrdemClaimsSchema,
  /** Ordenação inicial configurada (proposta; CLAIMS_ORDEM_PADRAO). */
  defaultSort: OrdemClaimsSchema,
  today: DataSchema,
  consultedAt: z.iso.datetime(),
});
export type PaginaClaims = z.infer<typeof PaginaClaimsSchema>;

/** Resumo do módulo (não são indicadores gerais): bases separadas, sem somar moedas nem unidades. */
export const ResumoClaimsSchema = z.object({
  cases: z.number().int().nonnegative(),
  byState: z.array(z.object({ state: SituacaoClaimSchema, count: z.number().int().nonnegative() })),
  pendencies: z.array(z.object({ code: FiltroPendenciaSchema, count: z.number().int().nonnegative() })),
  validatedRecovery: z.array(QuantidadePorUnidadeSchema.extend({ cases: z.number().int().nonnegative() })),
  estimated: z.array(ValorPorMoedaSchema.extend({ cases: z.number().int().nonnegative(), partialCases: z.number().int().nonnegative() })),
  avoidedConfirmed: z.array(ValorPorMoedaSchema.extend({ results: z.number().int().nonnegative() })),
  lossConfirmed: z.array(ValorPorMoedaSchema.extend({ results: z.number().int().nonnegative() })),
  /** Base de cálculo apresentada junto do resumo. */
  basis: z.array(z.string()),
  consultedAt: z.iso.datetime(),
});
export type ResumoClaims = z.infer<typeof ResumoClaimsSchema>;

export const TipoEventoClaimSchema = z.enum([
  'CASO_CRIADO',
  'CASO_IMPORTADO',
  'CASO_ALTERADO',
  'LINHA_IMPORTADA',
  'SITUACAO_ALTERADA',
  'CANDIDATO_REGISTRADO',
  'CONFERENCIA_SOLICITADA',
  'CANDIDATO_DESCARTADO',
  'ANEXO_ENVIADO',
  'EVIDENCIA_REGISTRADA',
  'VALIDACAO_SOLICITADA',
  'RECUPERACAO_VALIDADA',
  'VALIDACAO_REJEITADA',
  'RECUPERACAO_ESTORNADA',
  'VINCULO_MOVIDO',
  'RESULTADO_REGISTRADO',
  'RESULTADO_CORRIGIDO',
  'RESULTADO_ANULADO',
  'CASO_ENCERRADO',
  'CASO_REABERTO',
]);
export type TipoEventoClaim = z.infer<typeof TipoEventoClaimSchema>;

export const EventoClaimSchema = z.object({
  id: z.uuid(),
  type: TipoEventoClaimSchema,
  at: z.iso.datetime(),
  author: UsuarioResumoSchema.nullable(),
  lineRef: z.string().nullable(),
  summary: z.string(),
  /** Registro original quando o evento corrige/estorna/reabre algo. */
  relatedId: z.uuid().nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type EventoClaim = z.infer<typeof EventoClaimSchema>;

export const FiltroHistoricoClaimSchema = z.object({
  pagina: z.coerce.number().int().min(1).max(1000).default(1),
  tamanho: z.coerce.number().int().min(1).max(100).default(50),
});

export const PaginaHistoricoClaimSchema = z.object({
  items: z.array(EventoClaimSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type PaginaHistoricoClaim = z.infer<typeof PaginaHistoricoClaimSchema>;

/** Usuários do escopo que podem ser responsáveis (perfil com claim.tratar ou claim.validar). */
export const ResponsaveisClaimSchema = z.object({ items: z.array(ResponsavelSchema) });

export const ROTULOS_MOTIVO_CLAIM: Readonly<Record<MotivoClaim, string>> = {
  EXTRAVIO_FALTA: 'Extravio/falta',
  AVARIA: 'Avaria',
  DIVERGENCIA_DOCUMENTAL: 'Divergência documental',
};

export const ROTULOS_SITUACAO_CLAIM: Readonly<Record<SituacaoClaim, string>> = {
  EM_ANALISE: 'Em análise',
  BUSCA_EM_ANDAMENTO: 'Busca em andamento',
  CANDIDATO_LOCALIZADO: 'Candidato localizado',
  VALIDACAO_PENDENTE: 'Validação pendente',
  REGULARIZADO: 'Regularizado',
  PERDA_CONFIRMADA: 'Perda confirmada',
  ENCERRADO: 'Encerrado',
};
