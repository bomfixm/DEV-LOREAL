import { z } from 'zod';
import { UsuarioResumoSchema } from './acesso.js';
import { QuantidadeSchema } from './decimal.js';
import { CondicaoMaterialSchema, EstadoConferenciaSchema, EstadoFluxoSchema, EstadoLiberacaoSchema } from './estados.js';
import { ContextoDocumentoSelecaoSchema, ModalidadeSelecaoSchema } from './importacao.js';
import { PreviaReservaSchema, UnidadeCargaEntradaSchema } from './janelas.js';

/**
 * Seleção do cliente e conciliação (complemento). Percurso: inventário de
 * referência → seleção do cliente → conciliação com os registros → revisão de
 * pendências → lista de separação → reserva pelo fluxo da etapa 08.
 *
 * Importar e conciliar não alteram estoque, não reservam capacidade, não
 * liberam material e não confirmam saída. Vínculo/localização, base de
 * quantidade e elegibilidade para expedição são aspectos separados.
 */

export const AbrangenciaSelecaoSchema = z.enum(['PALETE', 'DOCUMENTO', 'LINHA_PRODUTO']);
export type AbrangenciaSelecao = z.infer<typeof AbrangenciaSelecaoSchema>;
export const ROTULOS_ABRANGENCIA: Readonly<Record<AbrangenciaSelecao, string>> = {
  PALETE: 'palete inteiro do inventário',
  DOCUMENTO: 'material de uma NF/devolução',
  LINHA_PRODUTO: 'linha/produto e quantidade',
};

export const SituacaoConciliacaoSchema = z.enum([
  'LOCALIZADO',
  'LOCALIZADO_COM_RESTRICAO',
  'DOCUMENTO_SEM_PALETE',
  'PALETE_SEM_ENDERECO',
  'NAO_ENCONTRADO',
  'AMBIGUO',
  'APENAS_HISTORICO',
  'QUANTIDADE_NAO_ATENDIDA',
  'INFORMACAO_PENDENTE',
]);
export type SituacaoConciliacao = z.infer<typeof SituacaoConciliacaoSchema>;
export const SITUACOES_CONCILIACAO = SituacaoConciliacaoSchema.options;

export const ROTULOS_SITUACAO_CONCILIACAO: Readonly<Record<SituacaoConciliacao, string>> = {
  LOCALIZADO: 'Localizado',
  LOCALIZADO_COM_RESTRICAO: 'Localizado com restrição',
  DOCUMENTO_SEM_PALETE: 'NF/documento sem palete',
  PALETE_SEM_ENDERECO: 'Palete sem endereço',
  NAO_ENCONTRADO: 'Não encontrado na base consultada',
  AMBIGUO: 'Identificação ambígua',
  APENAS_HISTORICO: 'Apenas referência histórica',
  QUANTIDADE_NAO_ATENDIDA: 'Quantidade não atendida',
  INFORMACAO_PENDENTE: 'Informação ainda pendente',
};

/** Orientação padrão de cada situação (próximo passo). */
export const PROXIMO_PASSO_SITUACAO: Readonly<Record<SituacaoConciliacao, string>> = {
  LOCALIZADO: 'Conferir na lista de separação e preparar para a janela quando houver saldo validado e liberado.',
  LOCALIZADO_COM_RESTRICAO: 'Resolver a restrição (bloqueio, liberação, reserva ou critério da janela) antes de reservar.',
  DOCUMENTO_SEM_PALETE: 'Investigar e vincular a NF a um palete (inventário ou conferência); não é perda nem claim.',
  PALETE_SEM_ENDERECO: 'Localizar o palete na praça e registrar a posição pelo movimento; nenhuma posição é presumida.',
  NAO_ENCONTRADO: 'Revisar a referência com o cliente e a base pesquisada; não é perda nem claim.',
  AMBIGUO: 'Escolher o candidato certo em "Resolver" (com motivo) ou pedir a referência completa.',
  APENAS_HISTORICO: 'Confirmar a localização atual: o endereço antigo não é apresentado como atual.',
  QUANTIDADE_NAO_ATENDIDA: 'Investigar a diferença; a quantidade identificada pode seguir, sem declarar perda.',
  INFORMACAO_PENDENTE: 'Completar a informação (conferência por produto, unidade, origem ou quantidade) antes de concluir.',
};

export const SelecaoResumoSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  orderReference: z.string().min(1),
  /** Revisão rastreada da mesma referência (1, 2…). */
  orderVersion: z.number().int().positive(),
  versionLabel: z.string().nullable(),
  mode: ModalidadeSelecaoSchema,
  state: z.enum(['REGISTRADA', 'SUBSTITUIDA']),
  inventory: z.object({ id: z.uuid(), code: z.string().min(1), description: z.string().min(1) }).nullable(),
  documentContext: ContextoDocumentoSelecaoSchema,
  batchId: z.uuid(),
  fileName: z.string().min(1),
  totalLines: z.number().int().nonnegative(),
  excludedLines: z.number().int().nonnegative(),
  replacesId: z.uuid().nullable(),
  replacedById: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: UsuarioResumoSchema.nullable(),
  version: z.number().int().positive(),
});
export type SelecaoResumo = z.infer<typeof SelecaoResumoSchema>;

export const PaginaSelecoesSchema = z.object({
  items: z.array(SelecaoResumoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type PaginaSelecoes = z.infer<typeof PaginaSelecoesSchema>;

export const FiltroSelecoesSchema = z.object({
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  tamanho: z.coerce.number().int().min(1).max(100).default(20),
});
export type FiltroSelecoes = z.infer<typeof FiltroSelecoesSchema>;

/** Diferenças de uma versão substitutiva em relação à anterior. */
export const DiferencasSelecaoSchema = z.object({
  previousId: z.uuid(),
  previousCode: z.string().min(1),
  added: z.array(z.object({ row: z.number().int().positive(), description: z.string() })),
  removed: z.array(z.object({ row: z.number().int().positive(), description: z.string() })),
  quantityChanged: z.array(z.object({ row: z.number().int().positive(), description: z.string(), before: z.string().nullable(), after: z.string().nullable() })),
  unchanged: z.number().int().nonnegative(),
  /** Reservas/saídas ligadas à versão anterior: revisar no fluxo da janela (nada é cancelado automaticamente). */
  reservationsToReview: z.array(z.object({ id: z.uuid(), code: z.string(), state: z.string(), lines: z.number().int().nonnegative() })),
});
export type DiferencasSelecao = z.infer<typeof DiferencasSelecaoSchema>;

export const SelecaoDetalheSchema = SelecaoResumoSchema.extend({
  parameters: z.object({
    markValues: z.array(z.string()),
    defaultDocumentType: z.string().nullable(),
    documentWithoutQuantity: z.enum(['TODO_MATERIAL_DO_INVENTARIO', 'PENDENTE']),
    duplicates: z.enum(['AGRUPAR_IDENTICAS', 'MANTER_SEPARADAS']).nullable(),
  }),
  differences: DiferencasSelecaoSchema.nullable(),
});
export type SelecaoDetalhe = z.infer<typeof SelecaoDetalheSchema>;

// ---------- Conciliação ----------

/** Material validado (palete × segmento) relacionado à solicitação. */
export const MaterialConciliadoSchema = z.object({
  segmentId: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  lot: z.string().nullable(),
  originType: z.string().nullable(),
  originReference: z.string().nullable(),
  condition: CondicaoMaterialSchema,
  unit: z.string().min(1),
  validated: QuantidadeSchema,
  reserved: QuantidadeSchema,
  released: QuantidadeSchema,
  linked: QuantidadeSchema,
  available: QuantidadeSchema,
  blocked: z.boolean(),
});
export type MaterialConciliado = z.infer<typeof MaterialConciliadoSchema>;

export const AlocacaoSchema = z.object({
  pallet: z.object({
    id: z.uuid(),
    code: z.string().min(1),
    version: z.number().int().positive(),
    countState: EstadoConferenciaSchema,
    releaseState: EstadoLiberacaoSchema,
    flowState: EstadoFluxoSchema,
    blocked: z.boolean(),
  }),
  /** Alocação confirmada nos registros atuais. */
  currentPosition: z.object({ id: z.uuid(), code: z.string().min(1), address: z.string().nullable() }).nullable(),
  /** Alocação informada no inventário (fotografia), com a fonte. */
  informedAddress: z.string().nullable(),
  informedSource: z.object({ inventoryCode: z.string().min(1), row: z.number().int().positive(), countDate: z.iso.date().nullable() }).nullable(),
  /** Endereço informado diferente do atual (movimento posterior ou correspondência pendente). */
  addressDiffers: z.boolean(),
  /** Documentos comprovados no palete que correspondem à solicitação. */
  documents: z.array(
    z.object({ documentKey: z.string(), documentType: z.string().nullable(), documentNumber: z.string(), delivery: z.string().nullable(), volumes: z.string().nullable(), unit: z.string() }),
  ),
  /** Documentos atuais do palete que não estavam no inventário de referência (não incluídos automaticamente). */
  documentsAddedAfter: z.array(z.string()),
  material: z.array(MaterialConciliadoSchema),
  restrictions: z.array(z.string()),
  eligibleForShipping: z.boolean(),
});
export type Alocacao = z.infer<typeof AlocacaoSchema>;

export const QuantidadesConciliacaoSchema = z.object({
  requested: QuantidadeSchema.nullable(),
  unit: z.string().nullable(),
  /** Volumes informados no inventário (unidade "volumes", nunca convertida). */
  informedVolumes: QuantidadeSchema.nullable(),
  /** Bases comparáveis na unidade solicitada (sem duplicar material). */
  validated: QuantidadeSchema.nullable(),
  reserved: QuantidadeSchema.nullable(),
  available: QuantidadeSchema.nullable(),
  /** Solicitado − identificado, quando comparáveis. */
  unmet: QuantidadeSchema.nullable(),
  comparable: z.boolean(),
  basis: z.string().min(1),
});
export type QuantidadesConciliacao = z.infer<typeof QuantidadesConciliacaoSchema>;

export const ResultadoConciliacaoSchema = z.object({
  lineId: z.uuid(),
  row: z.number().int().positive(),
  lineRef: z.string().nullable(),
  scope: AbrangenciaSelecaoSchema,
  scopeRule: z.string().min(1),
  request: z.object({
    palletRef: z.string().nullable(),
    documentType: z.string().nullable(),
    documentNumber: z.string().nullable(),
    delivery: z.string().nullable(),
    inventoryRef: z.string().nullable(),
    windowRef: z.string().nullable(),
    sku: z.string().nullable(),
    lot: z.string().nullable(),
    quantity: QuantidadeSchema.nullable(),
    unit: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  situation: SituacaoConciliacaoSchema,
  /** Situações adicionais (ex.: localizado e quantidade não atendida). */
  alsoSituations: z.array(SituacaoConciliacaoSchema),
  reasons: z.array(z.string()),
  nextStep: z.string().min(1),
  allocations: z.array(AlocacaoSchema),
  candidates: z.array(z.object({ palletId: z.uuid().nullable(), palletCode: z.string().nullable(), documentKey: z.string().nullable(), description: z.string() })),
  resolution: z
    .object({ palletId: z.uuid().nullable(), palletCode: z.string().nullable(), documentKey: z.string().nullable(), reason: z.string(), by: UsuarioResumoSchema.nullable(), at: z.iso.datetime() })
    .nullable(),
  quantities: QuantidadesConciliacaoSchema,
  /** Saídas já confirmadas desse material (histórico, separado do estoque atual). */
  shipped: z.array(z.object({ expeditionId: z.uuid(), code: z.string(), at: z.iso.datetime(), palletCode: z.string(), sku: z.string(), quantity: QuantidadeSchema, unit: z.string() })),
  /** Outras solicitações apontando o mesmo material físico (conflito de demanda possível). */
  demandConflicts: z.array(z.object({ selectionCode: z.string(), row: z.number().int().positive(), palletCode: z.string() })),
  /** Encaminhado à reserva (etapa 08) e expedido por esta linha. */
  forwarded: z.object({ reservedActive: QuantidadeSchema, shipped: QuantidadeSchema, reservations: z.array(z.string()) }),
  duplicateOfRow: z.number().int().positive().nullable(),
  /** Pode entrar numa proposta para a janela (material validado, liberado e disponível). */
  eligible: z.boolean(),
});
export type ResultadoConciliacao = z.infer<typeof ResultadoConciliacaoSchema>;

export const ResumoConciliacaoSchema = z.object({
  /** Linhas solicitadas (sem as agrupadas por duplicidade). */
  requestedLines: z.number().int().nonnegative(),
  /** Documentos distintos resolvidos (com palete comprovado). */
  resolvedDocuments: z.number().int().nonnegative(),
  /** Paletes físicos distintos (cada um contado uma vez). */
  distinctPallets: z.number().int().nonnegative(),
  bySituation: z.record(SituacaoConciliacaoSchema, z.number().int().nonnegative()),
  eligibleLines: z.number().int().nonnegative(),
  pendingLines: z.number().int().nonnegative(),
});
export type ResumoConciliacao = z.infer<typeof ResumoConciliacaoSchema>;

export const FiltroConciliacaoSchema = z.object({
  /** Situações separadas por vírgula; vazio = todas. */
  situacao: z
    .string()
    .max(300)
    .optional()
    .transform((t, ctx) => {
      if (t === undefined || t.trim() === '') return [] as SituacaoConciliacao[];
      const lista: SituacaoConciliacao[] = [];
      for (const p of t.split(',').map((x) => x.trim()).filter(Boolean)) {
        const s = SituacaoConciliacaoSchema.safeParse(p);
        if (!s.success) {
          ctx.addIssue({ code: 'custom', message: `Situação desconhecida: ${p}` });
          return z.NEVER;
        }
        if (!lista.includes(s.data)) lista.push(s.data);
      }
      return lista;
    }),
  texto: z.string().trim().max(64).optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  tamanho: z.coerce.number().int().min(1).max(500).default(100),
});
export type FiltroConciliacao = z.output<typeof FiltroConciliacaoSchema>;

/** GET /selecoes/:id/conciliacao */
export const ConciliacaoSchema = z.object({
  selection: SelecaoDetalheSchema,
  consultedAt: z.iso.datetime(),
  /** Bases consultadas (inventário de referência, vínculos atuais, saldo validado…). */
  basis: z.array(z.string()),
  /** Assinatura do resultado (todas as linhas): muda quando os registros mudam. */
  signature: z.string().regex(/^[0-9a-f]{64}$/),
  summary: ResumoConciliacaoSchema,
  items: z.array(ResultadoConciliacaoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type Conciliacao = z.infer<typeof ConciliacaoSchema>;

/** POST /selecoes/:id/linhas/:linha/resolucao — escolha explícita de um candidato. */
export const ResolverLinhaSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    palletId: z.uuid().nullable(),
    documentKey: z.string().trim().min(1).max(140).nullable(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((r) => r.palletId !== null || r.documentKey !== null, 'Escolha o palete ou o documento.');
export type ResolverLinha = z.infer<typeof ResolverLinhaSchema>;

export const AnularResolucaoSchema = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(300) });
export type AnularResolucao = z.infer<typeof AnularResolucaoSchema>;

// ---------- Proposta para a janela ----------

export const LIMITE_LINHAS_PROPOSTA = 200;

/** POST /selecoes/:id/proposta-janela — monta a proposta (nada é gravado). */
export const PropostaJanelaEntradaSchema = z.object({
  windowId: z.uuid(),
  lineIds: z.array(z.uuid()).min(1, 'Escolha ao menos uma linha.').max(LIMITE_LINHAS_PROPOSTA),
});
export type PropostaJanelaEntrada = z.infer<typeof PropostaJanelaEntradaSchema>;

export const ItemPropostaSchema = z.object({
  lineId: z.uuid(),
  palletId: z.uuid(),
  palletCode: z.string(),
  segmentId: z.uuid(),
  sku: z.string(),
  lot: z.string().nullable(),
  quantity: QuantidadeSchema,
  unit: z.string(),
  expectedPalletVersion: z.number().int().positive(),
  positionCode: z.string().nullable(),
  address: z.string().nullable(),
});
export type ItemProposta = z.infer<typeof ItemPropostaSchema>;

export const PropostaJanelaSchema = z.object({
  windowId: z.uuid(),
  windowCode: z.string(),
  windowVersion: z.number().int().positive(),
  selectionVersion: z.number().int().positive(),
  /** Assinatura das linhas elegíveis revisadas (mudança nos registros invalida a revisão). */
  signature: z.string().regex(/^[0-9a-f]{64}$/),
  items: z.array(ItemPropostaSchema),
  lines: z.array(
    z.object({
      lineId: z.uuid(),
      row: z.number().int().positive(),
      requested: QuantidadeSchema.nullable(),
      proposed: QuantidadeSchema,
      unit: z.string().nullable(),
      unmet: QuantidadeSchema.nullable(),
      notes: z.array(z.string()),
    }),
  ),
  /** Linhas escolhidas que não entram (continuam visíveis como não atendidas). */
  excluded: z.array(z.object({ lineId: z.uuid(), row: z.number().int().positive(), reason: z.string() })),
  /** Verificação da etapa 08 (critérios, liberação, disponível, capacidade). */
  reservation: PreviaReservaSchema.nullable(),
});
export type PropostaJanela = z.infer<typeof PropostaJanelaSchema>;

/** POST /selecoes/:id/reservar — confirma a proposta pelo fluxo de reserva (integral ou nada). */
export const ConfirmarPropostaSchema = z.object({
  windowId: z.uuid(),
  expectedWindowVersion: z.number().int().positive(),
  expectedSelectionVersion: z.number().int().positive(),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
  lineIds: z.array(z.uuid()).min(1).max(LIMITE_LINHAS_PROPOSTA),
  loadUnits: z.array(UnidadeCargaEntradaSchema).max(LIMITE_LINHAS_PROPOSTA).default([]),
  notes: z.string().trim().max(500).nullable().default(null),
  /** Quem confirma revisou a proposta e as linhas que ficaram de fora. */
  reviewed: z.literal(true),
});
export type ConfirmarProposta = z.input<typeof ConfirmarPropostaSchema>;

export const ResultadoPropostaSchema = z.object({
  reservationId: z.uuid(),
  reservationCode: z.string(),
  windowId: z.uuid(),
  linkedLines: z.number().int().nonnegative(),
});
export type ResultadoProposta = z.infer<typeof ResultadoPropostaSchema>;

// ---------- Exportações ----------

export const TipoExportacaoSelecaoSchema = z.enum(['separacao', 'pendencias', 'conciliacao']);
export type TipoExportacaoSelecao = z.infer<typeof TipoExportacaoSelecaoSchema>;
