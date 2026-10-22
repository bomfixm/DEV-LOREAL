import { z } from 'zod';
import { UsuarioResumoSchema } from './acesso.js';
import { CodigoPaleteSchema, UNIDADE_PECA, UnidadeMedidaSchema, textoIdentificador, textoOpcional } from './codigos.js';
import { ConferenciaResumoSchema, ContagemObservadaSchema } from './conferencia.js';
import { FORMATO_QUANTIDADE, QuantidadeSchema } from './decimal.js';
import { ReconferenciaPaleteSchema } from './reconferencia.js';
import { ConferenciaVolumesPaleteSchema } from './conferencia-volumes.js';
import { TipoEventoEstoqueSchema } from './estoque.js';
import {
  CondicaoMaterialSchema,
  EstadoConferenciaSchema,
  EstadoFluxoSchema,
  EstadoLiberacaoSchema,
  OrigemCodigoPaleteSchema,
  TipoOrigemDocumentoSchema,
} from './estados.js';

export { FORMATO_QUANTIDADE, QuantidadeSchema };

/**
 * Saldo validado de um segmento no palete (reconciliação ou transferência de
 * saldo validado). O segmento é a identidade do material: produto, lote,
 * origem e condição; lote e origem desconhecidos ficam `null` (pendentes) e o
 * segmento recebe uma linhagem própria, para que dois registros pendentes
 * distintos não se unam só por terem campos nulos. SKU, lote e referências
 * são textos (preservam zeros à esquerda).
 */
export const BloqueioSchema = z.object({ reason: z.string().min(1), at: z.iso.datetime(), by: UsuarioResumoSchema.nullable() });
export type Bloqueio = z.infer<typeof BloqueioSchema>;

export const ItemSaldoSchema = z.object({
  segmentId: z.uuid(),
  productId: z.uuid(),
  sku: z.string().min(1),
  description: z.string().min(1),
  lot: z.string().min(1).nullable(),
  originType: TipoOrigemDocumentoSchema.nullable(),
  originReference: z.string().min(1).nullable(),
  condition: CondicaoMaterialSchema,
  /** Linhagem do segmento com lote/origem pendentes; `null` quando lote e origem são conhecidos. */
  lineage: z.string().min(1).nullable(),
  quantity: QuantidadeSchema,
  /** Unidade canônica do produto. */
  unit: z.string().min(1),
  /** Parte reservada (reservas ativas); reserva não baixa o físico. */
  reserved: QuantidadeSchema,
  /**
   * Parte vinculada a recuperações de claim validadas (etapa 07): continua no
   * estoque, não é reserva; acompanha o material em transferências.
   */
  claimLinked: QuantidadeSchema.default('0'),
  /**
   * Parte liberada para expedição por ação autorizada (etapa 08). Conferência
   * e recuperação de claim não liberam; reservado ≤ liberado ≤ saldo.
   */
  released: QuantidadeSchema.default('0'),
  /** Bloqueio deste material (motivo, quando e quem); `null` = sem bloqueio próprio. */
  blocked: BloqueioSchema.nullable().default(null),
});
export type ItemSaldo = z.infer<typeof ItemSaldoSchema>;

const PaleteResumoBaseSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  positionId: z.uuid().nullable(),
  /** Código (provisório) da posição vinculada. */
  positionCode: z.string().min(1).nullable(),
  countState: EstadoConferenciaSchema,
  releaseState: EstadoLiberacaoSchema,
  flowState: EstadoFluxoSchema,
  pendingReason: z.string().min(1).nullable(),
  /** Conferência em andamento neste palete (rascunho no servidor), se houver. */
  activeCountId: z.uuid().nullable(),
  /**
   * Endereço completo informado no inventário ("15 - A120") para o palete sem
   * posição no mapa: identifica o local enquanto a correspondência com o
   * desenho está pendente. Nunca é uma posição presumida.
   */
  informedAddress: z.string().min(1).nullable().optional(),
  /** Reconferência após 20 dias sem movimentação; `null` = não se aplica (expedido ou arquivado). */
  reconference: ReconferenciaPaleteSchema.nullable().default(null),
  /** Conferência de volumes (não conferido, parcial, conferido, com diferença): separada da ocupação. */
  volumeCheck: ConferenciaVolumesPaleteSchema.nullable().default(null),
  /** Identificador legado (ex.: PR-000001) quando o código passou a ser o número operacional. */
  legacyCode: z.string().min(1).nullable().default(null),
});
export type PaleteResumo = z.infer<typeof PaleteResumoBaseSchema>;

function verificarLocalizacao(palete: PaleteResumo): string[] {
  return (palete.positionId === null) === (palete.positionCode === null)
    ? []
    : [`Posição e código da posição precisam estar ambos registrados ou ambos pendentes (${palete.code})`];
}

export const PaleteResumoSchema = PaleteResumoBaseSchema.superRefine((palete, ctx) => {
  for (const problema of verificarLocalizacao(palete)) ctx.addIssue({ code: 'custom', message: problema });
});

export const OrigemDadosSchema = z.enum(['DEMONSTRACAO_FICTICIA', 'OPERACAO']);
export type OrigemDados = z.infer<typeof OrigemDadosSchema>;

/**
 * Linha declarada em documento (nota, devolução, manifesto). Cada linha tem a
 * própria origem, então um palete pode reunir várias devoluções. Produto,
 * lote e origem desconhecidos ficam `null` (pendentes); a quantidade é a do
 * documento e nunca vira saldo físico.
 */
export const ItemDeclaradoSchema = z
  .object({
    /** Produto do cadastro; `null` = produto pendente de identificação. */
    productId: z.uuid().nullable(),
    sku: z.string().min(1).nullable(),
    description: z.string().min(1),
    lot: z.string().min(1).nullable(),
    originType: TipoOrigemDocumentoSchema.nullable(),
    originReference: z.string().min(1).nullable(),
    quantity: QuantidadeSchema,
    unit: z.string().min(1),
    /** Condição informada no documento; `null` = não informada. */
    condition: CondicaoMaterialSchema.nullable(),
  })
  .refine((i) => i.originReference === null || i.originType !== null, 'Referência de origem sem tipo de documento.');
export type ItemDeclarado = z.infer<typeof ItemDeclaradoSchema>;

const ReferenciaEventoSchema = z.object({
  eventId: z.uuid(),
  type: TipoEventoEstoqueSchema,
  at: z.iso.datetime(),
  by: UsuarioResumoSchema.nullable(),
  session: z.object({ id: z.uuid(), number: z.number().int().positive() }).nullable(),
});

const PaleteDetalheBaseSchema = PaleteResumoBaseSchema.extend({
  /**
   * Saldo validado conhecido no palete. `null` enquanto nenhum evento de
   * estoque o definiu. Só é o conteúdo integral quando o palete está
   * reconciliado: num palete não conferido, mostra apenas o que chegou por
   * transferência de saldo validado (o restante continua desconhecido).
   * `[]` = nenhum saldo validado restante (não prova palete físico vazio).
   */
  currentItems: z.array(ItemSaldoSchema).nullable(),
  /** Contagens concluídas depois da última reconciliação, ainda não validadas (cada uma separada: parciais não se somam). */
  observedCounts: z.array(ContagemObservadaSchema),
  /** Conferência em andamento (rascunho no servidor). */
  activeCount: ConferenciaResumoSchema.nullable(),
  /** Última reconciliação (conteúdo integral validado por conferência completa). */
  lastReconciliation: ReferenciaEventoSchema.nullable(),
  /** Último evento de estoque de qualquer tipo que alterou o saldo deste palete. */
  lastStockEvent: ReferenciaEventoSchema.nullable(),
  /** Quantidades declaradas em documento; não comprovam presença física. */
  declaredItems: z.array(ItemDeclaradoSchema).nullable(),
  dataSource: OrigemDadosSchema,
  updatedAt: z.iso.datetime(),
  /** Versão do registro, para proteção contra alteração desatualizada. */
  version: z.number().int().positive(),
  notes: z.string().min(1).nullable(),
  /** Data de cadastro (UTC). */
  createdAt: z.iso.datetime(),
  /** Responsável pelo cadastro; `null` nos registros da carga de demonstração. */
  createdBy: UsuarioResumoSchema.nullable(),
  codeOrigin: OrigemCodigoPaleteSchema,
  archived: z
    .object({ at: z.iso.datetime(), reason: z.string().min(1), by: UsuarioResumoSchema.nullable() })
    .nullable(),
  /** Bloqueio do palete inteiro (inclusive conteúdo que chegar depois), etapa 08. */
  palletBlock: BloqueioSchema.nullable().default(null),
});
export type PaleteDetalhe = z.infer<typeof PaleteDetalheBaseSchema>;

/**
 * Coerência entre estado de conferência e conteúdo (docs/DADOS-E-REGRAS.md,
 * R04, R05, R08 e R10): saldo validado só existe depois de um evento de
 * estoque; o estado "reconciliado" só vem de reconciliação (uma transferência
 * recebida não torna o palete conferido); palete não conferido não tem
 * observações físicas; parcial não aparece como completa.
 */
export function verificarConteudoPalete(palete: PaleteDetalhe): string[] {
  const problemas = verificarLocalizacao(palete);
  if (palete.countState === 'RECONCILIADO' && (palete.currentItems === null || palete.lastReconciliation === null)) {
    problemas.push(`Palete reconciliado sem saldo validado por reconciliação (${palete.code})`);
  }
  if ((palete.currentItems === null) !== (palete.lastStockEvent === null)) {
    problemas.push(`Saldo validado e último evento de estoque incoerentes (${palete.code})`);
  }
  if (palete.lastReconciliation !== null && (palete.lastStockEvent === null || (palete.countState !== 'RECONCILIADO' && palete.countState !== 'AGUARDANDO_VALIDACAO'))) {
    problemas.push(`Reconciliação registrada sem evento de estoque ou com estado de conferência incompatível (${palete.code})`);
  }
  if (palete.countState === 'NAO_CONFERIDO' && palete.observedCounts.length > 0) {
    problemas.push(`Palete não conferido com observações físicas (${palete.code})`);
  }
  if (palete.countState === 'PARCIAL' && !palete.observedCounts.some((c) => c.session.scope === 'PARCIAL')) {
    problemas.push(`Conferência parcial sem contagem parcial registrada (${palete.code})`);
  }
  if (palete.countState === 'AGUARDANDO_VALIDACAO' && !palete.observedCounts.some((c) => c.session.scope === 'COMPLETA')) {
    problemas.push(`Aguardando validação sem contagem completa concluída (${palete.code})`);
  }
  if ((palete.activeCount?.id ?? null) !== palete.activeCountId) {
    problemas.push(`Conferência ativa incoerente (${palete.code})`);
  }
  if (palete.archived !== null && (palete.positionId !== null || palete.flowState !== 'VAZIO_ARQUIVADO' || palete.activeCountId !== null)) {
    problemas.push(`Palete arquivado com posição, fluxo ou conferência ativos (${palete.code})`);
  }
  return problemas;
}

export const PaleteDetalheSchema = PaleteDetalheBaseSchema.superRefine((palete, ctx) => {
  for (const problema of verificarConteudoPalete(palete)) ctx.addIssue({ code: 'custom', message: problema });
});

export function resumirPalete(palete: PaleteDetalhe): PaleteResumo {
  return {
    id: palete.id,
    code: palete.code,
    positionId: palete.positionId,
    positionCode: palete.positionCode,
    countState: palete.countState,
    releaseState: palete.releaseState,
    flowState: palete.flowState,
    pendingReason: palete.pendingReason,
    activeCountId: palete.activeCountId,
    reconference: palete.reconference,
    volumeCheck: palete.volumeCheck,
    legacyCode: palete.legacyCode,
  };
}

/** Filtro da lista de paletes, validado também no servidor. */
export const LIMITE_MAXIMO_PALETES = 500;
export const FiltroPaletesSchema = z.object({
  texto: z.string().trim().max(64).optional(),
  conferencia: EstadoConferenciaSchema.optional(),
  /** "sim": só paletes com reconferência necessária (20 dias), pelo horário do servidor. */
  reconferencia: z.enum(['sim']).optional(),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO_PALETES).default(200),
});
export type FiltroPaletes = z.infer<typeof FiltroPaletesSchema>;

export const ListaPaletesSchema = z.object({
  items: z.array(PaleteResumoSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  truncated: z.boolean(),
});
export type ListaPaletes = z.infer<typeof ListaPaletesSchema>;

// ---------- Cadastro ----------

const inteiro = (q: string) => /^\d+$/.test(q);

/**
 * Linha declarada informada no cadastro. Sem SKU, o produto fica pendente e a
 * descrição do documento é obrigatória. Sem tipo/referência, a origem fica
 * pendente. Não existe campo de saldo: contagem e reconciliação são da etapa 04.
 */
export const LinhaDeclaradaEntradaSchema = z
  .object({
    sku: textoIdentificador(64, 'SKU').nullable(),
    description: textoOpcional(200).default(null),
    lot: textoIdentificador(64, 'Lote').nullable(),
    originType: TipoOrigemDocumentoSchema.nullable(),
    originReference: textoIdentificador(64, 'Referência').nullable(),
    quantity: z.string().regex(FORMATO_QUANTIDADE, 'Quantidade declarada: número com até 3 casas decimais (ex.: 2 ou 1,5).'),
    unit: UnidadeMedidaSchema,
  })
  .superRefine((linha, ctx) => {
    if (linha.sku === null && (linha.description === null || linha.description.length < 2)) {
      ctx.addIssue({ code: 'custom', path: ['description'], message: 'Produto pendente: descreva o item como está no documento.' });
    }
    if (linha.originReference !== null && linha.originType === null) {
      ctx.addIssue({ code: 'custom', path: ['originType'], message: 'Informe o tipo do documento da referência.' });
    }
    if (Number(linha.quantity) <= 0) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'A quantidade declarada precisa ser maior que zero.' });
    }
    if (linha.unit === UNIDADE_PECA && !inteiro(linha.quantity)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantidade em peças (UN) precisa ser inteira.' });
    }
  });
export type LinhaDeclaradaEntrada = z.infer<typeof LinhaDeclaradaEntradaSchema>;

export const CadastroPaleteSchema = z.object({
  /** Código existente da operação ou geração pela sequência interna do escopo. */
  code: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('GERAR') }),
    z.object({ mode: z.literal('INFORMAR'), value: CodigoPaleteSchema }),
  ]),
  /** Localização inicial opcional: ID permanente da posição no layout ativo. */
  positionId: z.uuid().nullable(),
  notes: textoOpcional(500).default(null),
  declaredItems: z.array(LinhaDeclaradaEntradaSchema).max(50, 'Até 50 linhas declaradas por cadastro.').default([]),
});
export type CadastroPalete = z.input<typeof CadastroPaleteSchema>;

/** Edição do cadastro: somente observações. Localização muda pela movimentação (POST /paletes/:id/movimentos). */
export const AlterarPaleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
  notes: textoOpcional(500),
});
export type AlterarPalete = z.input<typeof AlterarPaleteSchema>;

/** Arquivar um cadastro feito por engano: o código continua reservado. */
export const ArquivarPaleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3, 'Informe o motivo (3 a 300 caracteres).').max(300),
});
export type ArquivarPalete = z.infer<typeof ArquivarPaleteSchema>;

/** Escopo ao qual pertence um palete, para quem tem acesso a esse escopo. */
export const EscopoDoPaleteSchema = z.object({ scopeId: z.uuid(), scopeName: z.string().min(1) });
export type EscopoDoPalete = z.infer<typeof EscopoDoPaleteSchema>;
