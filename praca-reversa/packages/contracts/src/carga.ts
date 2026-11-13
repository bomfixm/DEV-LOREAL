import { z } from 'zod';
import { textoOpcional } from './codigos.js';

/**
 * Expedição DHL — montagem da carga por veículo (11 nov. 2026).
 *
 * Três referências distintas: o palete de origem na praça, o número do palete
 * naquela expedição (01..capacidade do veículo) e a posição física dentro do
 * veículo. Planejar, mover, conferir, imprimir ou recarregar nunca baixam
 * estoque: a baixa continua no evento EXPEDICAO por volumes da janela (Painel →
 * janela → Expedir).
 */

export const TipoVeiculoSchema = z.enum(['CARRETA', 'TRUCK']);
export type TipoVeiculo = z.infer<typeof TipoVeiculoSchema>;

/** Capacidade em paletes por tipo de veículo. */
export const CAPACIDADE_VEICULO: Readonly<Record<TipoVeiculo, number>> = { CARRETA: 28, TRUCK: 16 };
/** Grade provisória da vista de cima (fileiras da frente à porta × colunas) até a operação confirmar. */
export const GRADE_PADRAO: Readonly<Record<TipoVeiculo, { rows: number; cols: number }>> = { CARRETA: { rows: 14, cols: 2 }, TRUCK: { rows: 8, cols: 2 } };
export const ROTULO_VEICULO: Readonly<Record<TipoVeiculo, string>> = { CARRETA: 'Carreta', TRUCK: 'Truck' };

export const SituacaoVeiculoSchema = z.enum(['MONTAGEM', 'FECHADO', 'CANCELADO']);
export const TipoPaleteEmbarqueSchema = z.enum(['FULL', 'FRACIONADO']);
export type TipoPaleteEmbarque = z.infer<typeof TipoPaleteEmbarqueSchema>;
export const SituacaoDocEmbarqueSchema = z.enum(['CONFERIDO', 'FALTANTE', 'DIVERGENTE']);
export type SituacaoDocEmbarque = z.infer<typeof SituacaoDocEmbarqueSchema>;
export const TipoOcorrenciaSchema = z.enum(['VINCULO', 'CONTEUDO']);

const Versao = z.number().int().positive();
const Inteiro = (min: number, max: number) => z.number().int().min(min).max(max);

// ---------- Entradas ----------

export const CriarVeiculoSchema = z.object({
  kind: TipoVeiculoSchema,
  name: textoOpcional(60).default(null),
  plate: textoOpcional(12).default(null),
});
export type CriarVeiculo = z.input<typeof CriarVeiculoSchema>;

export const AlterarVeiculoSchema = z.object({
  expectedVersion: Versao,
  name: textoOpcional(60),
  plate: textoOpcional(12),
  rows: Inteiro(1, 40),
  cols: Inteiro(1, 4),
  layoutConfirmed: z.boolean(),
});
export type AlterarVeiculo = z.input<typeof AlterarVeiculoSchema>;

export const AcaoVeiculoSchema = z.object({
  expectedVersion: Versao,
  action: z.enum(['FECHAR', 'REABRIR', 'CANCELAR']),
  reason: textoOpcional(300).default(null),
});
export type AcaoVeiculo = z.input<typeof AcaoVeiculoSchema>;

export const LinhaEmbarqueEntradaSchema = z.object({
  occurrence: z.object({ kind: TipoOcorrenciaSchema, id: z.uuid() }),
  volumes: Inteiro(1, 1_000_000),
});
export type LinhaEmbarqueEntrada = z.input<typeof LinhaEmbarqueEntradaSchema>;

const Linhas = z
  .array(LinhaEmbarqueEntradaSchema)
  .min(1, 'Informe ao menos uma NF com volumes.')
  .max(300, 'Até 300 linhas por palete.')
  .refine((ls) => new Set(ls.map((l) => l.occurrence.id)).size === ls.length, 'Cada ocorrência aparece uma vez no palete (some os volumes na mesma linha).');

export const CriarPaleteEmbarqueSchema = z
  .object({
    kind: TipoPaleteEmbarqueSchema,
    /** Nulo = próximo número livre do veículo. */
    number: Inteiro(1, 40).nullable().default(null),
    /** Posição planejada no veículo (opcional). */
    position: Inteiro(1, 40).nullable().default(null),
    /** FULL: o palete de origem inteiro. */
    sourcePalletId: z.uuid().nullable().default(null),
    /** FRACIONADO: as NFs e os volumes separados para este palete. */
    lines: z.array(LinhaEmbarqueEntradaSchema).default([]),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'FULL' && d.sourcePalletId === null) ctx.addIssue({ code: 'custom', message: 'FULL: escolha o palete de origem.', path: ['sourcePalletId'] });
    if (d.kind === 'FULL' && d.lines.length > 0) ctx.addIssue({ code: 'custom', message: 'FULL leva o conteúdo do palete de origem: não informe linhas.', path: ['lines'] });
    if (d.kind === 'FRACIONADO') {
      const r = Linhas.safeParse(d.lines);
      if (!r.success) ctx.addIssue({ code: 'custom', message: r.error.issues[0]?.message ?? 'Linhas inválidas.', path: ['lines'] });
      if (d.sourcePalletId !== null) ctx.addIssue({ code: 'custom', message: 'Fracionado: a origem fica em cada linha.', path: ['sourcePalletId'] });
    }
  });
export type CriarPaleteEmbarque = z.input<typeof CriarPaleteEmbarqueSchema>;

export const PosicaoEmbarqueSchema = z.object({ expectedVersion: Versao, position: Inteiro(1, 40).nullable() });
export type PosicaoEmbarque = z.input<typeof PosicaoEmbarqueSchema>;

export const ConfirmarPosicaoSchema = z.object({ expectedVersion: Versao, confirmed: z.boolean() });
export type ConfirmarPosicao = z.input<typeof ConfirmarPosicaoSchema>;

export const TransferirEmbarqueSchema = z.object({
  expectedVersion: Versao,
  vehicleId: z.uuid(),
  /** Nulo = mantém o número se estiver livre no destino; senão o próximo livre. */
  number: Inteiro(1, 40).nullable().default(null),
});
export type TransferirEmbarque = z.input<typeof TransferirEmbarqueSchema>;

export const AlterarLinhasEmbarqueSchema = z.object({ expectedVersion: Versao, lines: Linhas });
export type AlterarLinhasEmbarque = z.input<typeof AlterarLinhasEmbarqueSchema>;

/**
 * Inclusão por nota (ficha do palete, 13 nov. 2026): só as ocorrências pedidas
 * (vínculo/conteúdo pelo ID estável, nunca pelo número da NF), todas do mesmo
 * palete de origem. Nunca expande para o palete inteiro — isso é o FULL, ação
 * própria. Destino: palete fracionado existente do veículo (com a versão vista)
 * ou um fracionado novo. `volumes` nulo = todo o disponível da ocorrência.
 */
export const IncluirNotasEmbarqueSchema = z
  .object({
    sourcePalletId: z.uuid('Palete de origem sem identificação válida: nada foi incluído.'),
    lines: z
      .array(
        z.object({
          occurrence: z.object({ kind: TipoOcorrenciaSchema, id: z.uuid('Nota sem identificação válida: nada foi incluído (o palete inteiro não entra por esta ação).') }),
          volumes: Inteiro(1, 1_000_000).nullable().default(null),
        }),
      )
      .min(1, 'Escolha ao menos uma nota.')
      .max(300, 'Até 300 notas por vez.')
      .refine((ls) => new Set(ls.map((l) => l.occurrence.id)).size === ls.length, 'Cada nota aparece uma vez no pedido.'),
    /** Palete fracionado de destino; nulo = fracionado novo no veículo. */
    targetPalletId: z.uuid().nullable().default(null),
    expectedVersion: Versao.nullable().default(null),
  })
  .refine((d) => d.targetPalletId === null || d.expectedVersion !== null, { message: 'Versão do palete de destino ausente.', path: ['expectedVersion'] });
export type IncluirNotasEmbarque = z.input<typeof IncluirNotasEmbarqueSchema>;

export const FisicoConferidoSchema = z.object({ expectedVersion: Versao, revision: Inteiro(1, 100_000) });
export type FisicoConferido = z.input<typeof FisicoConferidoSchema>;

export const ConferirDocumentoSchema = z
  .object({
    revision: Inteiro(1, 100_000),
    lineId: z.uuid(),
    state: SituacaoDocEmbarqueSchema,
    note: textoOpcional(300).default(null),
  })
  .refine((d) => d.state === 'CONFERIDO' || d.note !== null, { message: 'Faltante ou divergente: descreva na observação.', path: ['note'] });
export type ConferirDocumento = z.input<typeof ConferirDocumentoSchema>;

export const CancelarEmbarqueSchema = z.object({
  expectedVersion: Versao,
  reason: z.string().trim().min(3, 'Informe o motivo.').max(300),
});
export type CancelarEmbarque = z.input<typeof CancelarEmbarqueSchema>;

export const TipoEmissaoSchema = z.enum(['ETIQUETA', 'ESPELHO', 'MAPA', 'DOCUMENTOS']);
export type TipoEmissao = z.infer<typeof TipoEmissaoSchema>;
export const EmitirSchema = z.object({ kind: TipoEmissaoSchema, final: z.boolean() });
export type Emitir = z.input<typeof EmitirSchema>;

// ---------- Saídas ----------

const Pessoa = z.object({ name: z.string() }).nullable();

export const OcorrenciaOrigemSchema = z.object({
  kind: TipoOcorrenciaSchema,
  id: z.uuid(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  sender: z.string().nullable(),
  delivery: z.string().nullable(),
  /** Volumes de referência (contagem vigente, senão o informado inteiro); nulo = não informado. */
  base: z.number().int().nullable(),
  /** Ainda disponível para embarque (base − consumido em outras janelas/paletes); nulo = base desconhecida. */
  available: z.number().int().nullable(),
  /** Separado aguardando nesta janela (Painel; informativo). */
  separatedHere: z.number().int(),
});
export type OcorrenciaOrigem = z.infer<typeof OcorrenciaOrigemSchema>;

export const OrigemEmbarqueSchema = z.object({
  palletId: z.uuid(),
  code: z.string(),
  address: z.string().nullable(),
  onSite: z.boolean(),
  /** Identidade do embarque em que este palete já sai FULL (ativo). */
  fullIn: z.string().nullable(),
  occurrences: z.array(OcorrenciaOrigemSchema),
});
export type OrigemEmbarque = z.infer<typeof OrigemEmbarqueSchema>;

/**
 * Bipagem de um palete de embarque fracionado (planilha "Etiquetas": Tipo, Número,
 * Volumes, Lidos, Remetente). Só leitura: para cada NF do arquivo, as origens na
 * praça onde ela está e quanto ainda pode embarcar. A gravação é a criação normal
 * do palete fracionado (mesmas validações).
 */
export const OrigemBipagemEmbarqueSchema = OcorrenciaOrigemSchema.extend({
  palletId: z.uuid(),
  palletCode: z.string(),
  address: z.string().nullable(),
  onSite: z.boolean(),
  /** Já sai FULL em outra carga ativa (não pode ser fracionado). */
  fullIn: z.string().nullable(),
});
export type OrigemBipagemEmbarque = z.infer<typeof OrigemBipagemEmbarqueSchema>;

export const ProblemaBipagemEmbarqueSchema = z.enum(['SEM_ORIGEM', 'ESCOLHER', 'SEM_SALDO']);
export type ProblemaBipagemEmbarque = z.infer<typeof ProblemaBipagemEmbarqueSchema>;

export const LinhaBipagemEmbarqueSchema = z.object({
  row: z.number().int().positive(),
  type: z.string().nullable(),
  number: z.string(),
  sender: z.string().nullable(),
  /** Lidos: volumes bipados para este palete de embarque. */
  volumes: z.number().int().positive(),
  /** Coluna "Volumes" da nota, quando vem. */
  expectedVolumes: z.number().int().nonnegative().nullable(),
  candidates: z.array(OrigemBipagemEmbarqueSchema),
  /** Origem sugerida: a única com saldo suficiente; nula = escolher ou pendente. */
  suggested: z.uuid().nullable(),
  /** SEM_ORIGEM: NF não está em nenhum palete; ESCOLHER: mais de uma origem serve; SEM_SALDO: nenhuma origem tem os volumes. */
  problem: ProblemaBipagemEmbarqueSchema.nullable(),
});
export type LinhaBipagemEmbarque = z.infer<typeof LinhaBipagemEmbarqueSchema>;

export const AnaliseBipagemEmbarqueSchema = z.object({
  fileName: z.string(),
  sheet: z.string().nullable(),
  lines: z.array(LinhaBipagemEmbarqueSchema),
  /** Linhas com Lidos = 0 (não entram). */
  withoutReads: z.number().int().nonnegative(),
  errors: z.array(z.object({ row: z.number().int().positive(), messages: z.array(z.string()) })),
});
export type AnaliseBipagemEmbarque = z.infer<typeof AnaliseBipagemEmbarqueSchema>;

export const LinhaEmbarqueSchema = z.object({
  id: z.uuid(),
  occurrence: z.object({ kind: TipoOcorrenciaSchema, id: z.uuid() }),
  sourcePalletId: z.uuid(),
  sourcePalletCode: z.string(),
  volumes: z.number().int(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  sender: z.string().nullable(),
  delivery: z.string().nullable(),
  /** Conferência documental vigente (revisão atual); null = pendente. */
  doc: z.object({ state: SituacaoDocEmbarqueSchema, note: z.string().nullable(), by: z.string(), at: z.iso.datetime() }).nullable(),
});
export type LinhaEmbarque = z.infer<typeof LinhaEmbarqueSchema>;

export const EmissaoResumoSchema = z.object({
  kind: TipoEmissaoSchema,
  final: z.boolean(),
  revision: z.number().int().nullable(),
  identity: z.string(),
  at: z.iso.datetime(),
  by: z.string(),
  /** A identidade, a revisão ou as posições mudaram desde a emissão: reemitir. */
  outdated: z.boolean(),
});
export type EmissaoResumo = z.infer<typeof EmissaoResumoSchema>;

export const SituacaoDocsSchema = z.enum(['AGUARDANDO_FISICO', 'PENDENTE', 'COM_PROBLEMA', 'CONFERIDA']);
export type SituacaoDocs = z.infer<typeof SituacaoDocsSchema>;

export const PaleteEmbarqueSchema = z.object({
  id: z.uuid(),
  vehicleId: z.uuid(),
  number: z.number().int(),
  /** "P07". */
  label: z.string(),
  /** "Janela X · Carreta 02 · Palete 07": igual no mapa, na etiqueta, nos documentos e no espelho. */
  identity: z.string(),
  position: z.number().int().nullable(),
  positionConfirmed: z.boolean(),
  positionConfirmedAt: z.iso.datetime().nullable(),
  kind: TipoPaleteEmbarqueSchema,
  sourcePalletId: z.uuid().nullable(),
  sourcePalletCode: z.string().nullable(),
  revision: z.number().int(),
  physical: z.object({ checked: z.boolean(), revision: z.number().int().nullable(), by: z.string().nullable(), at: z.iso.datetime().nullable() }),
  docs: z.object({ state: SituacaoDocsSchema, total: z.number().int(), checked: z.number().int(), missing: z.number().int(), divergent: z.number().int(), pending: z.number().int() }),
  volumes: z.number().int(),
  lines: z.array(LinhaEmbarqueSchema),
  state: z.enum(['ATIVO', 'CANCELADO']),
  cancelReason: z.string().nullable(),
  version: z.number().int(),
  emissions: z.array(EmissaoResumoSchema),
});
export type PaleteEmbarque = z.infer<typeof PaleteEmbarqueSchema>;

export const VeiculoCargaSchema = z.object({
  id: z.uuid(),
  kind: TipoVeiculoSchema,
  sequence: z.number().int(),
  /** "Carreta 02". */
  label: z.string(),
  name: z.string().nullable(),
  plate: z.string().nullable(),
  capacity: z.number().int(),
  rows: z.number().int(),
  cols: z.number().int(),
  layoutConfirmed: z.boolean(),
  state: SituacaoVeiculoSchema,
  version: z.number().int(),
  /** Paletes ativos (ocupação "12/28"). */
  occupied: z.number().int(),
  positioned: z.number().int(),
  confirmedPositions: z.number().int(),
  pallets: z.array(PaleteEmbarqueSchema),
  /** O que falta para fechar a carga (vazio = pode fechar). */
  pending: z.array(z.string()),
  map: EmissaoResumoSchema.nullable(),
});
export type VeiculoCarga = z.infer<typeof VeiculoCargaSchema>;

export const CargaJanelaSchema = z.object({
  window: z.object({ id: z.uuid(), code: z.string(), name: z.string(), state: z.string() }),
  vehicles: z.array(VeiculoCargaSchema),
  /** Texto fixo: onde a baixa acontece (nunca nesta tela). */
  stockEffect: z.string(),
  scope: z.object({ name: z.string(), demo: z.boolean() }),
  generatedAt: z.iso.datetime(),
});
export type CargaJanela = z.infer<typeof CargaJanelaSchema>;

export const JanelasCargaSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      state: z.string(),
      vehicles: z.number().int(),
      pallets: z.number().int(),
    }),
  ),
});
export type JanelasCarga = z.infer<typeof JanelasCargaSchema>;

/**
 * Seleção atual da Expedição: o que está nos veículos em montagem das janelas
 * abertas do escopo. `notes` conta documentos por palete de origem (a linha da
 * ficha do palete; sem número, cada ocorrência), não volumes nem cliques.
 */
export const SelecaoExpedicaoSchema = z.object({
  notes: z.number().int().nonnegative(),
  volumes: z.number().int().nonnegative(),
  vehicles: z.array(z.object({ id: z.uuid(), windowId: z.uuid(), windowCode: z.string(), label: z.string(), notes: z.number().int().nonnegative() })),
  /** Com `?palete=`: ocorrências desse palete de origem já em algum embarque ativo (onde e quantos volumes). */
  pallet: z.array(z.object({ occurrenceId: z.uuid(), identity: z.string(), volumes: z.number().int(), vehicleState: SituacaoVeiculoSchema })),
});
export type SelecaoExpedicao = z.infer<typeof SelecaoExpedicaoSchema>;

const NotaIncluida = z.object({
  occurrence: z.object({ kind: TipoOcorrenciaSchema, id: z.uuid() }),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  sourcePalletCode: z.string(),
});

export const ResultadoInclusaoNotasSchema = z.object({
  added: z.array(NotaIncluida.extend({ volumes: z.number().int().positive() })),
  /** Já estavam na seleção desta janela: não contam de novo nem mudam a quantidade. */
  skipped: z.array(NotaIncluida.extend({ identity: z.string() })),
  pallet: z.object({ id: z.uuid(), label: z.string(), identity: z.string(), created: z.boolean() }),
  windowId: z.uuid(),
  vehicleId: z.uuid(),
  selection: SelecaoExpedicaoSchema,
});
export type ResultadoInclusaoNotas = z.infer<typeof ResultadoInclusaoNotasSchema>;

export const EventosEmbarqueSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), kind: z.string(), details: z.record(z.string(), z.unknown()), by: z.string(), at: z.iso.datetime(), pallet: z.string().nullable() })),
});
export type EventosEmbarque = z.infer<typeof EventosEmbarqueSchema>;

export const PessoaSchema = Pessoa;

/** Onde a baixa acontece: fixo, mostrado na tela e devolvido pela API. */
export const TEXTO_BAIXA_CARGA =
  'Esta tela não baixa estoque. A baixa continua no registro de expedição por volumes da janela (Painel → janela → Expedir), feito uma vez pelo fluxo autorizado.';

/** "P07". */
export function rotuloPaleteEmbarque(numero: number): string {
  return `P${String(numero).padStart(2, '0')}`;
}
/** "Carreta 02". */
export function rotuloVeiculo(tipo: TipoVeiculo, sequencia: number): string {
  return `${ROTULO_VEICULO[tipo]} ${String(sequencia).padStart(2, '0')}`;
}
/** "Janela JAN-0010 · Carreta 02 · Palete 07". */
export function identidadeEmbarque(janela: string, tipo: TipoVeiculo, sequencia: number, numero: number): string {
  return `Janela ${janela} · ${rotuloVeiculo(tipo, sequencia)} · Palete ${String(numero).padStart(2, '0')}`;
}
