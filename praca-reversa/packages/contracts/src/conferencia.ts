import { z } from 'zod';
import { UsuarioResumoSchema } from './acesso.js';
import { UNIDADE_PECA, UnidadeMedidaSchema, textoIdentificador, textoOpcional } from './codigos.js';
import { FORMATO_QUANTIDADE, QuantidadeComSinalSchema, QuantidadeSchema, ehQuantidadeInteira, paraMilesimos } from './decimal.js';
import { CondicaoMaterialSchema, EstadoConferenciaSchema, EstadoLiberacaoSchema, TipoOrigemDocumentoSchema } from './estados.js';
import { EventoEstoqueSchema, TipoEventoEstoqueSchema } from './estoque.js';

/**
 * Conferência física de um palete (etapa 04; docs/DADOS-E-REGRAS.md R05–R09).
 * Três informações ficam separadas em todo o contrato: quantidade declarada
 * (documento), quantidade observada (contagem) e saldo validado (reconciliação).
 */

/** Parcial: só uma parte física do palete; completa: todo o conteúdo físico. */
export const EscopoConferenciaSchema = z.enum(['PARCIAL', 'COMPLETA']);
export type EscopoConferencia = z.infer<typeof EscopoConferenciaSchema>;

/**
 * Situação da sessão. "Rascunho" e "em andamento" são o mesmo estado no
 * servidor (EM_ANDAMENTO): as observações gravadas formam o rascunho.
 * SUBSTITUIDA: concluída e depois substituída por uma recontagem concluída.
 */
export const SituacaoConferenciaSchema = z.enum(['EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA', 'RECONCILIADA', 'SUBSTITUIDA']);
export type SituacaoConferencia = z.infer<typeof SituacaoConferenciaSchema>;

/** Conferência comum ou recontagem/correção vinculada a uma conferência anterior. */
export const MotivoConferenciaSchema = z.enum(['CONFERENCIA', 'RECONTAGEM']);
export type MotivoConferencia = z.infer<typeof MotivoConferenciaSchema>;

/** Modo de entrada, sempre explícito: nada é deduzido do código sozinho. */
export const ModoEntradaSchema = z.enum(['MANUAL', 'LEITURA_UNIDADE', 'LEITURA_EMBALAGEM']);
export type ModoEntrada = z.infer<typeof ModoEntradaSchema>;

/** Observação que não pode virar saldo até ser resolvida. */
export const PendenciaObservacaoSchema = z.enum(['PRODUTO_NAO_IDENTIFICADO', 'FATOR_DESCONHECIDO']);
export type PendenciaObservacao = z.infer<typeof PendenciaObservacaoSchema>;

/** Código lido pelo leitor (que digita como teclado) ou digitado: SKU ou código de barras, sempre texto. */
export const CodigoLidoSchema = textoIdentificador(64, 'Código');

const versao = z.number().int().positive();
const justificativa = (rotulo: string) =>
  z.string().trim().min(3, `${rotulo}: 3 a 500 caracteres.`).max(500, `${rotulo}: 3 a 500 caracteres.`).regex(/^(?:[^\p{Cc}]|[\n\r\t])*$/u, `${rotulo}: caracteres inválidos.`);

// ---------- Entradas ----------

/** POST /paletes/:id/conferencias */
export const IniciarConferenciaSchema = z
  .object({
    scope: EscopoConferenciaSchema,
    /** O que será conferido; obrigatório na parcial (ex.: "camada superior", "somente SKU 000123"). */
    scopeDescription: textoOpcional(200).default(null),
    /** Versão do palete vista por quem inicia. */
    expectedVersion: versao,
  })
  .superRefine((dados, ctx) => {
    if (dados.scope === 'PARCIAL' && (dados.scopeDescription === null || dados.scopeDescription.length < 3)) {
      ctx.addIssue({ code: 'custom', path: ['scopeDescription'], message: 'Conferência parcial: descreva a parte física que será conferida.' });
    }
  });
export type IniciarConferencia = z.input<typeof IniciarConferenciaSchema>;

/** Campos de lote, origem, condição e evidência de uma observação. */
const CamposObservacao = {
  /** Vazio = lote pendente (nunca inventado). */
  lot: textoIdentificador(64, 'Lote').nullable().default(null),
  /** Vazio = origem pendente. */
  originType: TipoOrigemDocumentoSchema.nullable().default(null),
  originReference: textoIdentificador(64, 'Referência').nullable().default(null),
  condition: CondicaoMaterialSchema,
  note: textoOpcional(300).default(null),
  /** Referência a evidência existente (foto, documento); não é armazenamento de arquivo. */
  evidence: textoOpcional(200).default(null),
};

function refinarOrigem(dados: { originType: unknown; originReference: unknown }, ctx: z.RefinementCtx) {
  if (dados.originReference !== null && dados.originType === null) {
    ctx.addIssue({ code: 'custom', path: ['originType'], message: 'Informe o tipo do documento da referência de origem.' });
  }
}

/**
 * POST /conferencias/:id/observacoes — uma ação de entrada (uma leitura ou uma
 * quantidade digitada), com chave de idempotência própria.
 *
 * - LEITURA_UNIDADE: cada leitura soma 1 na unidade canônica; o código precisa ser da unidade.
 * - LEITURA_EMBALAGEM: cada leitura soma 1 embalagem do código lido, convertida pelo fator aprovado.
 * - MANUAL: quantidade e unidade digitadas, com produto escolhido ou identificado pelo código.
 *
 * Código não cadastrado ou fator desconhecido só viram linha quando
 * `registerAsPending` é verdadeiro: ficam como pendência, sem conversão.
 */
export const NovaObservacaoSchema = z
  .object({
    mode: ModoEntradaSchema,
    code: CodigoLidoSchema.nullable().default(null),
    productId: z.uuid().nullable().default(null),
    /** Embalagem escolhida no modo manual (código de barras cadastrado). */
    packagingCode: CodigoLidoSchema.nullable().default(null),
    quantity: z.string().regex(FORMATO_QUANTIDADE, 'Quantidade: número com até 3 casas decimais (ex.: 2 ou 1,5).').nullable().default(null),
    unit: UnidadeMedidaSchema.nullable().default(null),
    /** Descrição do item quando o produto não está identificado. */
    description: textoOpcional(200).default(null),
    registerAsPending: z.boolean().default(false),
    ...CamposObservacao,
  })
  .superRefine((dados, ctx) => {
    refinarOrigem(dados, ctx);
    if (dados.mode !== 'MANUAL') {
      if (dados.code === null) ctx.addIssue({ code: 'custom', path: ['code'], message: 'Leia ou digite o código.' });
      if (dados.quantity !== null || dados.unit !== null) {
        ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Na leitura, cada leitura vale 1: não informe quantidade.' });
      }
      return;
    }
    if (dados.quantity === null) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Informe a quantidade observada.' });
    } else if (paraMilesimos(dados.quantity) <= 0n) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'A quantidade observada precisa ser maior que zero.' });
    } else if (dados.unit === UNIDADE_PECA && !ehQuantidadeInteira(dados.quantity)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantidade em peças (UN) precisa ser inteira.' });
    }
    if (dados.unit === null) ctx.addIssue({ code: 'custom', path: ['unit'], message: 'Informe a unidade da quantidade.' });
    if (dados.productId === null && dados.code === null && !dados.registerAsPending) {
      ctx.addIssue({ code: 'custom', path: ['productId'], message: 'Escolha o produto, leia o código ou registre como pendência.' });
    }
  });
export type NovaObservacao = z.input<typeof NovaObservacaoSchema>;

/** PATCH /conferencias/:id/observacoes/:obsId — correção no rascunho, com a revisão vista. */
export const CorrigirObservacaoSchema = z
  .object({
    expectedRevision: versao,
    productId: z.uuid().nullable(),
    packagingCode: CodigoLidoSchema.nullable().default(null),
    quantity: z.string().regex(FORMATO_QUANTIDADE, 'Quantidade: número com até 3 casas decimais (ex.: 2 ou 1,5).'),
    unit: UnidadeMedidaSchema,
    description: textoOpcional(200).default(null),
    registerAsPending: z.boolean().default(false),
    reason: textoOpcional(300).default(null),
    ...CamposObservacao,
  })
  .superRefine((dados, ctx) => {
    refinarOrigem(dados, ctx);
    if (paraMilesimos(dados.quantity) <= 0n) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'A quantidade observada precisa ser maior que zero.' });
    } else if (dados.unit === UNIDADE_PECA && !ehQuantidadeInteira(dados.quantity)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantidade em peças (UN) precisa ser inteira.' });
    }
  });
export type CorrigirObservacao = z.input<typeof CorrigirObservacaoSchema>;

/** POST /conferencias/:id/observacoes/:obsId/remover — a linha fica no histórico. */
export const RemoverObservacaoSchema = z.object({ expectedRevision: versao, reason: textoOpcional(300).default(null) });
export type RemoverObservacao = z.input<typeof RemoverObservacaoSchema>;

/** PATCH /conferencias/:id — observações gerais do rascunho. */
export const AlterarNotasConferenciaSchema = z.object({ expectedRevision: versao, notes: textoOpcional(1000) });
export type AlterarNotasConferencia = z.input<typeof AlterarNotasConferenciaSchema>;

/** POST /conferencias/:id/concluir */
export const ConcluirConferenciaSchema = z.object({
  /** Revisão do rascunho revisada por quem conclui. */
  expectedRevision: versao,
  /** Versão atual do palete vista por quem conclui. */
  expectedPalletVersion: versao,
  /** Completa: confirmação de que todo o escopo físico do palete foi conferido. */
  confirmFullScope: z.boolean().default(false),
});
export type ConcluirConferencia = z.input<typeof ConcluirConferenciaSchema>;

/** POST /conferencias/:id/cancelar */
export const CancelarConferenciaSchema = z.object({ expectedRevision: versao, reason: justificativa('Motivo do cancelamento') });
export type CancelarConferencia = z.input<typeof CancelarConferenciaSchema>;

/** POST /conferencias/:id/recontagem — nova sessão vinculada, preservando a original. */
export const SolicitarRecontagemSchema = z.object({ expectedPalletVersion: versao, justification: justificativa('Justificativa da recontagem') });
export type SolicitarRecontagem = z.input<typeof SolicitarRecontagemSchema>;

/** POST /conferencias/:id/reconciliar */
export const ReconciliarConferenciaSchema = z.object({ expectedPalletVersion: versao, justification: justificativa('Justificativa da reconciliação') });
export type ReconciliarConferencia = z.input<typeof ReconciliarConferenciaSchema>;

/** GET /produtos/identificar?codigo= */
export const FiltroIdentificarSchema = z.object({ codigo: CodigoLidoSchema });

// ---------- Respostas ----------

export const IdentificacaoCodigoSchema = z.object({
  code: z.string().min(1),
  /** Como o código foi reconhecido: código de barras de embalagem ou SKU (unidade canônica). */
  match: z.enum(['CODIGO_BARRAS', 'SKU']),
  productId: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  active: z.boolean(),
  canonicalUnit: z.string().min(1),
  packaging: z.string().min(1),
  /** Unidades canônicas por embalagem; `null` = fator desconhecido (conversão bloqueada). */
  factor: QuantidadeSchema.nullable(),
  /** Todas as embalagens do produto, para a escolha no modo manual. */
  packagings: z.array(z.object({ code: z.string().min(1), packaging: z.string().min(1), factor: QuantidadeSchema.nullable() })),
});
export type IdentificacaoCodigo = z.infer<typeof IdentificacaoCodigoSchema>;

export const LinhaObservacaoSchema = z.object({
  id: z.uuid(),
  order: z.number().int().positive(),
  productId: z.uuid().nullable(),
  sku: z.string().min(1).nullable(),
  description: z.string().min(1),
  codeRead: z.string().min(1).nullable(),
  entryMode: ModoEntradaSchema,
  /** Quantidade como informada, na unidade informada. */
  quantity: QuantidadeSchema,
  unit: z.string().min(1),
  /** Fator usado na conversão; `null` = desconhecido. */
  factor: QuantidadeSchema.nullable(),
  /** Quantidade exata na unidade canônica; `null` enquanto pendente. */
  canonicalQuantity: QuantidadeSchema.nullable(),
  canonicalUnit: z.string().min(1).nullable(),
  lot: z.string().min(1).nullable(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().min(1).nullable(),
  condition: CondicaoMaterialSchema,
  pending: PendenciaObservacaoSchema.nullable(),
  note: z.string().min(1).nullable(),
  evidence: z.string().min(1).nullable(),
  revision: z.number().int().positive(),
  registeredAt: z.iso.datetime(),
  /** `null` somente em registros da carga de demonstração. */
  registeredBy: UsuarioResumoSchema.nullable(),
  corrected: z.object({ at: z.iso.datetime(), by: UsuarioResumoSchema.nullable() }).nullable(),
  removed: z.object({ at: z.iso.datetime(), by: UsuarioResumoSchema.nullable(), reason: z.string().min(1).nullable() }).nullable(),
});
export type LinhaObservacao = z.infer<typeof LinhaObservacaoSchema>;

/** Soma das linhas ativas convertidas, por identidade de segmento (produto, lote, origem, condição). */
export const TotalObservadoSchema = z.object({
  key: z.string().min(1),
  productId: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  lot: z.string().min(1).nullable(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().min(1).nullable(),
  condition: CondicaoMaterialSchema,
  quantity: QuantidadeSchema,
  unit: z.string().min(1),
  lines: z.number().int().positive(),
});
export type TotalObservado = z.infer<typeof TotalObservadoSchema>;

/** Linha que não entra em saldo até ser resolvida. */
export const PendenciaConferenciaSchema = z.object({
  lineId: z.uuid(),
  kind: PendenciaObservacaoSchema,
  description: z.string().min(1),
  sku: z.string().min(1).nullable(),
  codeRead: z.string().min(1).nullable(),
  quantity: QuantidadeSchema,
  unit: z.string().min(1),
});
export type PendenciaConferencia = z.infer<typeof PendenciaConferenciaSchema>;

export const ConferenciaResumoSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  palletId: z.uuid(),
  scope: EscopoConferenciaSchema,
  scopeDescription: z.string().min(1).nullable(),
  kind: MotivoConferenciaSchema,
  origin: z.object({ id: z.uuid(), number: z.number().int().positive() }).nullable(),
  state: SituacaoConferenciaSchema,
  revision: z.number().int().positive(),
  responsible: UsuarioResumoSchema.nullable(),
  startedAt: z.iso.datetime(),
  /** Última gravação do rascunho no servidor. */
  updatedAt: z.iso.datetime(),
  concludedAt: z.iso.datetime().nullable(),
  concludedBy: UsuarioResumoSchema.nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  reconciledAt: z.iso.datetime().nullable(),
  activeLines: z.number().int().nonnegative(),
  pendingLines: z.number().int().nonnegative(),
});
export type ConferenciaResumo = z.infer<typeof ConferenciaResumoSchema>;

/** Contagem concluída (parcial ou completa) ainda não reconciliada, com o que foi observado. */
export const ContagemObservadaSchema = z.object({
  session: ConferenciaResumoSchema,
  items: z.array(TotalObservadoSchema),
  pending: z.array(PendenciaConferenciaSchema),
});
export type ContagemObservada = z.infer<typeof ContagemObservadaSchema>;

/** Situação de comparação de um vínculo (produto + origem). */
export const SituacaoVinculoSchema = z.enum([
  /** Declarado e observado iguais. */
  'CONFERE',
  /** Observado menor que o declarado. */
  'FALTA',
  /** Observado maior que o declarado. */
  'SOBRA',
  /** Sem declaração para o vínculo: comparação indisponível (não se presume zero). */
  'SEM_DECLARACAO',
  /** Declaração em unidade sem fator aprovado, ou observação pendente de conversão. */
  'INDISPONIVEL',
  /** Conferência parcial: o que não foi contado continua pendente; diferença não calculada. */
  'PARCIAL',
]);
export type SituacaoVinculo = z.infer<typeof SituacaoVinculoSchema>;

export const VinculoComparacaoSchema = z.object({
  key: z.string().min(1),
  productId: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().min(1).nullable(),
  /** Unidade canônica do produto, em que as três quantidades são apresentadas. */
  unit: z.string().min(1),
  /** Quantidade declarada em documento (convertida); `null` = sem declaração ou sem conversão. */
  declared: QuantidadeSchema.nullable(),
  declaredLots: z.array(z.string().min(1).nullable()),
  /** Quantidade observada nesta contagem (linhas convertidas). */
  observed: QuantidadeSchema.nullable(),
  observedDetail: z.array(z.object({ lot: z.string().min(1).nullable(), condition: CondicaoMaterialSchema, quantity: QuantidadeSchema })),
  /** Saldo validado atual do mesmo vínculo; `null` = palete nunca reconciliado. */
  validated: QuantidadeSchema.nullable(),
  /** Observado − declarado, somente em contagem completa com as duas quantidades disponíveis. */
  difference: QuantidadeComSinalSchema.nullable(),
  status: SituacaoVinculoSchema,
  notes: z.array(z.string().min(1)),
});
export type VinculoComparacao = z.infer<typeof VinculoComparacaoSchema>;

export const ComparacaoSchema = z.object({
  scope: EscopoConferenciaSchema,
  links: z.array(VinculoComparacaoSchema),
  /** Linhas declaradas com produto pendente: não comparáveis. */
  declaredWithoutProduct: z.array(
    z.object({ description: z.string().min(1), quantity: QuantidadeSchema, unit: z.string().min(1), originReference: z.string().min(1).nullable() }),
  ),
  pending: z.array(PendenciaConferenciaSchema),
});
export type Comparacao = z.infer<typeof ComparacaoSchema>;

export const PaleteDaConferenciaSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  positionCode: z.string().min(1).nullable(),
  version: z.number().int().positive(),
  countState: EstadoConferenciaSchema,
  releaseState: EstadoLiberacaoSchema,
  archived: z.boolean(),
});

/**
 * Foto ou documento da conferência (etapa 09): privado, imutável, tipo
 * conferido pelo conteúdo no servidor. Não comprova sozinho origem, liberação
 * nem regularização.
 */
export const AnexoConferenciaSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uploadedBy: UsuarioResumoSchema,
  uploadedAt: z.iso.datetime(),
});
export type AnexoConferencia = z.infer<typeof AnexoConferenciaSchema>;
/** Anexos por conferência (fotos do palete, nota de entrega). */
export const LIMITE_ANEXOS_CONFERENCIA = 20;

export const ConferenciaDetalheSchema = ConferenciaResumoSchema.extend({
  justification: z.string().min(1).nullable(),
  notes: z.string().min(1).nullable(),
  initialPalletVersion: z.number().int().positive(),
  fullScopeConfirmed: z.boolean(),
  cancelledBy: UsuarioResumoSchema.nullable(),
  cancelReason: z.string().min(1).nullable(),
  reconciledBy: UsuarioResumoSchema.nullable(),
  reconciliationJustification: z.string().min(1).nullable(),
  reconciliationEventId: z.uuid().nullable(),
  supersededBy: z.object({ id: z.uuid(), number: z.number().int().positive() }).nullable(),
  recounts: z.array(z.object({ id: z.uuid(), number: z.number().int().positive(), state: SituacaoConferenciaSchema })),
  /** Reconciliação recusada por conflito com o estado atual, registrada para tratamento. */
  pendingReconciliation: z.object({ at: z.iso.datetime(), reason: z.string().min(1) }).nullable(),
  /** O conteúdo do palete mudou depois do início desta contagem: ela não pode ser reconciliada. */
  outdated: z.boolean(),
  pallet: PaleteDaConferenciaSchema,
  lines: z.array(LinhaObservacaoSchema),
  totals: z.array(TotalObservadoSchema),
  pending: z.array(PendenciaConferenciaSchema),
  /** `null` enquanto em andamento: a quantidade esperada fica oculta durante a contagem (R06). */
  comparison: ComparacaoSchema.nullable(),
  /** Anexos privados (etapa 09), do mais antigo ao mais recente. */
  attachments: z.array(AnexoConferenciaSchema).default([]),
});
export type ConferenciaDetalhe = z.infer<typeof ConferenciaDetalheSchema>;

/** Resposta de uma entrada: a linha criada e o estado do rascunho no servidor. */
export const ResultadoObservacaoSchema = z.object({
  line: LinhaObservacaoSchema,
  session: z.object({ id: z.uuid(), revision: z.number().int().positive(), updatedAt: z.iso.datetime(), state: SituacaoConferenciaSchema }),
});
export type ResultadoObservacao = z.infer<typeof ResultadoObservacaoSchema>;

export const LinhaReconciliacaoSchema = z.object({
  segmentKey: z.string().min(1),
  /** Segmento existente; `null` = será criado pela reconciliação. */
  segmentId: z.uuid().nullable(),
  productId: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  lot: z.string().min(1).nullable(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().min(1).nullable(),
  condition: CondicaoMaterialSchema,
  /** Identidade própria do segmento com lote/origem pendentes. */
  lineage: z.string().min(1).nullable(),
  unit: z.string().min(1),
  current: QuantidadeSchema,
  target: QuantidadeSchema,
  delta: QuantidadeComSinalSchema,
  reserved: QuantidadeSchema,
  /** Vinculada a recuperações de claim validadas: o alvo não pode ficar abaixo de reservado + vinculado. */
  claimLinked: QuantidadeSchema.default('0'),
});
export type LinhaReconciliacao = z.infer<typeof LinhaReconciliacaoSchema>;

/** GET /conferencias/:id/reconciliacao — prévia dos efeitos, sem gravar nada. */
export const PreviaReconciliacaoSchema = z.object({
  sessionId: z.uuid(),
  palletId: z.uuid(),
  palletCode: z.string().min(1),
  palletVersion: z.number().int().positive(),
  eventType: TipoEventoEstoqueSchema.extract(['SALDO_INICIAL', 'AJUSTE_RECONCILIACAO']),
  allowed: z.boolean(),
  /** Motivos que impedem a reconciliação agora. */
  blockers: z.array(z.string().min(1)),
  /** Segmentos que mudam (inclusive os que vão a zero por ausência verificada). */
  changes: z.array(LinhaReconciliacaoSchema),
  unchanged: z.number().int().nonnegative(),
  releaseState: EstadoLiberacaoSchema,
  notes: z.array(z.string().min(1)),
});
export type PreviaReconciliacao = z.infer<typeof PreviaReconciliacaoSchema>;

export const ResultadoReconciliacaoSchema = z.object({ event: EventoEstoqueSchema, session: ConferenciaDetalheSchema });
export type ResultadoReconciliacao = z.infer<typeof ResultadoReconciliacaoSchema>;

/** GET /paletes/:id/conferencias — histórico de conferências e eventos de estoque do palete. */
export const HistoricoConferenciasSchema = z.object({
  sessions: z.array(ConferenciaResumoSchema),
  events: z.array(EventoEstoqueSchema),
});
export type HistoricoConferencias = z.infer<typeof HistoricoConferenciasSchema>;
