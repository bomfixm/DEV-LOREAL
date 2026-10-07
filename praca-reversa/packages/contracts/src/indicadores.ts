import { z } from 'zod';
import { MotivoClaimSchema, SituacaoClaimSchema } from './claims.js';
import { QuantidadeComSinalSchema, QuantidadeSchema } from './decimal.js';
import { EstadoConferenciaSchema } from './estados.js';
import { BasePesoSchema, MetricaCapacidadeSchema, SituacaoJanelaSchema } from './janelas.js';
import { ValorCalculadoSchema } from './valores.js';

/**
 * Indicadores e relatórios (etapa 10; docs/INDICADORES.md). Tudo é calculado
 * no servidor, no escopo ativo, numa única leitura consistente (snapshot) por
 * consulta. Períodos são datas do fuso da operação (inicialmente
 * America/Sao_Paulo), com início e fim inclusivos; o servidor converte os
 * limites para instantes UTC [início 00:00, dia seguinte ao fim 00:00).
 */
const DataSchema = z.iso.date('Data inválida (AAAA-MM-DD).');

/** Maior período aceito numa consulta (dias). */
export const PERIODO_MAXIMO_DIAS = 366;
/** Rótulo exigido enquanto a configuração de posições não foi validada contra a praça. */
export const ROTULO_BASE_PROVISORIA = 'Base: posições cadastradas — validação do layout pendente';

/** Início ≤ fim e no máximo PERIODO_MAXIMO_DIAS (datas do fuso da operação). */
function conferirPeriodo(f: { inicio?: string | undefined; fim?: string | undefined }, ctx: z.RefinementCtx): void {
  if (f.inicio === undefined || f.fim === undefined) return;
  if (f.inicio > f.fim) {
    ctx.addIssue({ code: 'custom', message: 'A data inicial deve ser anterior ou igual à final.', path: ['fim'] });
    return;
  }
  const dias = (Date.parse(`${f.fim}T00:00:00Z`) - Date.parse(`${f.inicio}T00:00:00Z`)) / 86_400_000;
  if (dias >= PERIODO_MAXIMO_DIAS) ctx.addIssue({ code: 'custom', message: `Período de no máximo ${String(PERIODO_MAXIMO_DIAS)} dias.`, path: ['fim'] });
}

export const FiltroPeriodoSchema = z.object({ inicio: DataSchema.optional(), fim: DataSchema.optional() }).superRefine(conferirPeriodo);
export type FiltroPeriodo = z.infer<typeof FiltroPeriodoSchema>;

export const PeriodoAplicadoSchema = z.object({
  start: DataSchema,
  end: DataSchema,
  timezone: z.string(),
  /** Início inclusivo (00:00 do primeiro dia no fuso), em UTC. */
  startUtc: z.iso.datetime(),
  /** Fim exclusivo (00:00 do dia seguinte ao último, no fuso), em UTC. */
  endUtc: z.iso.datetime(),
  /** O período chega até hoje: o saldo final é o atual. */
  includesToday: z.boolean(),
});
export type PeriodoAplicado = z.infer<typeof PeriodoAplicadoSchema>;

const Contagem = z.number().int().min(0);
const QuantidadeUnidadeSchema = z.object({ unit: z.string(), quantity: QuantidadeComSinalSchema, lines: Contagem });
export type QuantidadeUnidade = z.infer<typeof QuantidadeUnidadeSchema>;
const ValorMoedaSchema = z.object({ currency: z.string(), value: ValorCalculadoSchema, count: Contagem });
export type ValorMoeda = z.infer<typeof ValorMoedaSchema>;

export const BasePosicoesSchema = z.object({
  label: z.string(),
  /** Configuração de posições ainda não validada contra a praça: ocupação/capacidade provisórias. */
  provisional: z.boolean(),
  layout: z
    .object({
      name: z.string(),
      revision: z.number().int(),
      schematic: z.boolean(),
      totalCapacity: z.number().int().nullable(),
      provisionalCodes: Contagem,
    })
    .nullable(),
  /** Alterações registradas na configuração do layout dentro do período (mudam o denominador). */
  changesInPeriod: Contagem,
});
export type BasePosicoes = z.infer<typeof BasePosicoesSchema>;

export const IndicadoresPracaSchema = z.object({
  /** Paletes na praça (em estoque ou reservados), cada um contado uma vez. */
  palletsInStock: Contagem,
  palletsReserved: Contagem,
  palletsWithPosition: Contagem,
  palletsLocationPending: Contagem,
  positions: z
    .object({
      /** Posições do layout ativo (não retiradas). */
      registered: Contagem,
      /** Disponíveis para palete: denominador da ocupação. */
      eligible: Contagem,
      occupied: Contagem,
      free: Contagem,
      /** Marcadas como indisponíveis: fora do denominador. */
      unavailable: Contagem,
      /** Indisponíveis com palete registrado (contadas à parte). */
      unavailableOccupied: Contagem,
    })
    .nullable(),
  /** Ocupação = ocupadas ÷ elegíveis, com uma casa; nula sem base. */
  occupancyPercent: z.string().nullable(),
  occupancyNote: z.string(),
  /** Áreas desenhadas que não são posições de estoque (classificação separada). */
  drawnAreas: z.object({ zones: Contagem, blocks: Contagem, corridors: Contagem, docks: Contagem }).nullable(),
  period: z.object({ registered: Contagem, moves: Contagem, retiredEmpty: Contagem, shippedWhole: Contagem }),
});
export type IndicadoresPraca = z.infer<typeof IndicadoresPracaSchema>;

export const IndicadoresConferenciaSchema = z.object({
  byState: z.record(EstadoConferenciaSchema, Contagem),
  activeCounts: Contagem,
  /** Observações sem produto identificado ou sem fator, em contagens não reconciliadas. */
  pendingObservations: Contagem,
  period: z.object({ started: Contagem, concluded: Contagem, reconciled: Contagem, recounts: Contagem, cancelled: Contagem }),
});
export type IndicadoresConferencia = z.infer<typeof IndicadoresConferenciaSchema>;

export const SaldoUnidadeSchema = z.object({
  unit: z.string(),
  validated: QuantidadeSchema,
  reserved: QuantidadeSchema,
  linked: QuantidadeSchema,
  /** Saldo validado − reservado (a parte vinculada a claim continua no estoque). */
  available: QuantidadeSchema,
  skus: Contagem,
  pallets: Contagem,
});
export type SaldoUnidade = z.infer<typeof SaldoUnidadeSchema>;

/** Saldo final = inicial + entradas validadas − saídas confirmadas + ajustes líquidos (por unidade). */
export const FluxoUnidadeSchema = z.object({
  unit: z.string(),
  opening: QuantidadeComSinalSchema,
  /** Primeira validação de conteúdo de palete (saldo inicial da reconciliação). */
  entries: QuantidadeComSinalSchema,
  /** Parte das entradas que é retorno físico reconciliado (palete que recebeu o retorno de uma expedição). */
  entriesFromReturns: QuantidadeComSinalSchema,
  exits: QuantidadeComSinalSchema,
  adjustments: QuantidadeComSinalSchema,
  /** Volume movido entre paletes do escopo (não altera o total). */
  transfersMoved: QuantidadeComSinalSchema,
  /** Soma das linhas de transferência e correção: sempre zero no escopo (conferido). */
  transfersNet: QuantidadeComSinalSchema,
  closing: QuantidadeComSinalSchema,
  /** Saldo validado atual (só quando o período chega até hoje). */
  current: QuantidadeComSinalSchema.nullable(),
  /** inicial + entradas − saídas + ajustes = final (e = atual, quando aplicável). */
  consistent: z.boolean(),
  events: z.object({ entries: Contagem, exits: Contagem, adjustments: Contagem, transfers: Contagem }),
});
export type FluxoUnidade = z.infer<typeof FluxoUnidadeSchema>;

export const IndicadoresEstoqueSchema = z.object({
  current: z.array(SaldoUnidadeSchema),
  /** Paletes na praça com conteúdo ainda desconhecido (não conferidos ou só parcialmente). */
  palletsWithUnknownContent: Contagem,
  documentary: z.object({
    declaredOnPallets: z.array(QuantidadeUnidadeSchema),
    importedDocuments: z.array(QuantidadeUnidadeSchema),
  }),
  flow: z.array(FluxoUnidadeSchema),
  returns: z.object({
    /** Retornos físicos registrados no período: declaração no palete que recebeu (entra no saldo só pela reconciliação). */
    physical: Contagem,
    physicalQuantity: z.array(QuantidadeUnidadeSchema),
    /** Avisos documentais de retorno: não alteram o saldo. */
    notices: Contagem,
  }),
});
export type IndicadoresEstoque = z.infer<typeof IndicadoresEstoqueSchema>;

export const IndicadoresClaimsSchema = z.object({
  cases: Contagem,
  open: Contagem,
  byState: z.array(z.object({ state: SituacaoClaimSchema, count: Contagem })),
  byReason: z.array(z.object({ reason: MotivoClaimSchema, count: Contagem })),
  /** Casos com candidato em investigação: pista, não recuperação. */
  casesWithCandidates: Contagem,
  candidatesInvestigating: Contagem,
  /** Recuperações físicas validadas e ativas, por unidade (sem conversão). */
  recoveredValidated: z.array(z.object({ unit: z.string(), quantity: QuantidadeSchema, cases: Contagem })),
  pendencies: z.array(z.object({ code: z.string(), count: Contagem })),
  period: z.object({
    opened: Contagem,
    recoveries: z.array(QuantidadeUnidadeSchema),
    reversals: Contagem,
    closed: Contagem,
  }),
});
export type IndicadoresClaims = z.infer<typeof IndicadoresClaimsSchema>;

export const IndicadoresValoresSchema = z.object({
  /** Estimativas de casos ainda não finalizados, por moeda (não é valor evitado). */
  estimatedInAnalysis: z.array(ValorMoedaSchema.extend({ partialCases: Contagem })),
  /** Resultados vigentes de regularização, por moeda. */
  avoidedConfirmed: z.array(ValorMoedaSchema),
  lossConfirmed: z.array(ValorMoedaSchema),
  /** Resultados substituídos por correção ou anulados (histórico preservado, fora dos totais). */
  corrections: z.object({ corrected: Contagem, annulled: Contagem }),
  period: z.object({ avoidedConfirmed: z.array(ValorMoedaSchema), lossConfirmed: z.array(ValorMoedaSchema) }),
});
export type IndicadoresValores = z.infer<typeof IndicadoresValoresSchema>;

export const RestricaoIndicadorSchema = z.object({
  metric: MetricaCapacidadeSchema,
  unit: z.string(),
  weightBase: BasePesoSchema.nullable(),
  limit: QuantidadeSchema.nullable(),
  reservedActive: QuantidadeSchema,
  shipped: QuantidadeSchema,
  remaining: QuantidadeComSinalSchema.nullable(),
});

export const IndicadoresJanelasSchema = z.object({
  windows: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      state: SituacaoJanelaSchema,
      exitStart: z.iso.datetime().nullable(),
      exitEnd: z.iso.datetime().nullable(),
      restrictions: z.array(RestricaoIndicadorSchema),
    }),
  ),
  truncated: z.boolean(),
  period: z.object({
    expeditions: Contagem,
    partialExpeditions: Contagem,
    shipped: z.array(QuantidadeUnidadeSchema),
    palletsShippedWhole: Contagem,
    reservationsCreated: Contagem,
    reservationsCancelled: Contagem,
  }),
});
export type IndicadoresJanelas = z.infer<typeof IndicadoresJanelasSchema>;

export const IndicadoresIdadeSchema = z.object({
  /** Saldo validado atual pelo mês da primeira entrada física validada do material (mesma regra do FIFO). */
  byMonth: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), unit: z.string(), quantity: QuantidadeSchema, lines: Contagem })),
  withoutEntryDate: z.array(QuantidadeUnidadeSchema),
  /** Referência apenas documental (data do documento importado), mostrada à parte. */
  documentReference: z.object({ lines: Contagem, oldest: DataSchema.nullable(), newest: DataSchema.nullable() }),
});
export type IndicadoresIdade = z.infer<typeof IndicadoresIdadeSchema>;

export const AreaIndicadorSchema = z.enum(['praca', 'conferencia', 'estoque', 'claims', 'valores', 'janelas', 'idade']);
export type AreaIndicador = z.infer<typeof AreaIndicadorSchema>;

export const IndicadoresSchema = z.object({
  scope: z.object({ id: z.uuid(), name: z.string(), demo: z.boolean() }),
  period: PeriodoAplicadoSchema,
  /** Instante da leitura (snapshot único de todos os números). */
  consultedAt: z.iso.datetime(),
  positionsBasis: BasePosicoesSchema,
  praca: IndicadoresPracaSchema.nullable(),
  conferencia: IndicadoresConferenciaSchema.nullable(),
  estoque: IndicadoresEstoqueSchema.nullable(),
  claims: IndicadoresClaimsSchema.nullable(),
  valores: IndicadoresValoresSchema.nullable(),
  janelas: IndicadoresJanelasSchema.nullable(),
  idade: IndicadoresIdadeSchema.nullable(),
  /** Áreas fora do perfil (o servidor não devolve esses números). */
  restricted: z.array(AreaIndicadorSchema),
  /** Indicadores sem base de medição registrada (pendências explícitas). */
  unavailable: z.array(z.object({ title: z.string(), reason: z.string() })),
});
export type Indicadores = z.infer<typeof IndicadoresSchema>;

// ---------- Relatórios ----------

export const TipoRelatorioSchema = z.enum(['paletes', 'estoque', 'expedicoes', 'claims', 'piloto']);
export type TipoRelatorio = z.infer<typeof TipoRelatorioSchema>;
export const TIPOS_RELATORIO = TipoRelatorioSchema.options;

/** Linhas por página na tela e máximo de linhas por exportação CSV. */
export const TAMANHO_PAGINA_RELATORIO = 50;
export const LIMITE_EXPORTACAO_RELATORIO = 5_000;
/** Paletes de um grupo de piloto (códigos informados). */
export const LIMITE_GRUPO_PILOTO = 300;

const CodigosSchema = z
  .string()
  .max(LIMITE_GRUPO_PILOTO * 40)
  .transform((texto) => [...new Set(texto.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))])
  .refine((lista) => lista.length <= LIMITE_GRUPO_PILOTO, { message: `No máximo ${String(LIMITE_GRUPO_PILOTO)} paletes por grupo.` });

export const FiltroRelatorioSchema = z
  .object({
    inicio: DataSchema.optional(),
    fim: DataSchema.optional(),
    conferencia: EstadoConferenciaSchema.optional(),
    localizacao: z.enum(['COM_POSICAO', 'PENDENTE']).optional(),
    somentePendencias: z.enum(['1', '0']).optional(),
    sku: z.string().trim().max(60).optional(),
    situacao: SituacaoClaimSchema.optional(),
    motivo: MotivoClaimSchema.optional(),
    paletes: CodigosSchema.optional(),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .superRefine(conferirPeriodo);
export type FiltroRelatorio = z.infer<typeof FiltroRelatorioSchema>;

export const TipoColunaSchema = z.enum(['texto', 'codigo', 'quantidade', 'valor', 'data', 'datahora', 'numero']);
export const ColunaRelatorioSchema = z.object({ key: z.string(), label: z.string(), kind: TipoColunaSchema });
export type ColunaRelatorio = z.infer<typeof ColunaRelatorioSchema>;

export const RelatorioSchema = z.object({
  type: TipoRelatorioSchema,
  title: z.string(),
  scope: z.object({ name: z.string(), demo: z.boolean() }),
  period: PeriodoAplicadoSchema.nullable(),
  consultedAt: z.iso.datetime(),
  /** Filtros aplicados, como aparecem na tela, no CSV e na impressão. */
  filters: z.array(z.object({ label: z.string(), value: z.string() })),
  /** Base de cada número (o que entra e o que não entra). */
  basis: z.array(z.string()),
  /** Dados ausentes e universo parcial, visíveis no relatório. */
  notes: z.array(z.string()),
  columns: z.array(ColunaRelatorioSchema),
  rows: z.array(z.record(z.string(), z.string().nullable())),
  /** Totais por unidade/moeda (nunca uma soma entre unidades ou moedas diferentes). */
  summary: z.array(z.object({ label: z.string(), value: z.string(), kind: TipoColunaSchema })),
  total: Contagem,
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  exportLimit: z.number().int().min(1),
});
export type Relatorio = z.infer<typeof RelatorioSchema>;

/** Texto exato da quantidade com unidade, sem somar unidades diferentes ("24 UN; 2 CX"). */
export function quantidadesPorUnidade(itens: readonly { unit: string; quantity: string }[]): string {
  return itens.length === 0 ? '' : itens.map((i) => `${i.quantity} ${i.unit}`).join('; ');
}
