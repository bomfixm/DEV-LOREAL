import { z } from 'zod';
import { IndicadoresClaimsSchema, IndicadoresValoresSchema, PeriodoAplicadoSchema } from './indicadores.js';
import { SituacaoJanelaSchema } from './janelas.js';

/**
 * Painéis da operação DHL e do cliente (docs/INDICADORES.md, seção Painéis).
 * Métrica da janela em VOLUMES: a contagem operacional informada no
 * inventário/pedido (não é m³, caixas, paletes nem unidades de SKU). Tudo é
 * calculado pela API, no escopo ativo, numa leitura consistente.
 *
 * T = meta informada pelo cliente para a janela (vigente = a mais recente);
 * P = volumes separados aguardando expedição; E = volumes expedidos em
 * confirmações válidas. P e E são conjuntos distintos: expedir move de P para
 * E na mesma operação.
 */

const Contagem = z.number().int().min(0);
const Volumes = z.number().int().min(0);
const DataSchema = z.iso.date('Data inválida (AAAA-MM-DD).');
/** Porcentagem com duas casas ("81.25"); nula sem base. */
const PorcentagemSchema = z.string().regex(/^\d+\.\d{2}$/);

// ---------- Progresso da janela ----------

export const ProgressoVolumesSchema = z.object({
  /** T: meta em volumes (nula = sem meta informada; nunca vira zero). */
  requested: Volumes.nullable(),
  /** P: separados aguardando expedição. */
  separatedWaiting: Volumes,
  /** E: expedidos (confirmações válidas). */
  shipped: Volumes,
  /** P + E. */
  prepared: Volumes,
  /** max(T − P − E, 0); nulo sem meta. */
  missingToSeparate: Volumes.nullable(),
  /** max(T − E, 0); nulo sem meta. */
  missingToShip: Volumes.nullable(),
  /** (P + E) ÷ T; nulo sem meta ou com T = 0. Pode passar de 100 (valor real). */
  preparationPercent: PorcentagemSchema.nullable(),
  /** E ÷ T; nulo sem meta ou com T = 0. */
  shippingPercent: PorcentagemSchema.nullable(),
  /** Motivo da ausência de porcentagem ("Sem meta informada", "Sem base para cálculo"). */
  basisNote: z.string().nullable(),
  /** Excesso sobre a meta (só na visão interna; nulo sem excesso ou na visão do cliente). */
  excessPrepared: Volumes.nullable().default(null),
  excessShipped: Volumes.nullable().default(null),
});
export type ProgressoVolumes = z.infer<typeof ProgressoVolumesSchema>;

export const SEM_META = 'Sem meta informada';
export const SEM_BASE = 'Sem base para cálculo';

/** Duas casas, arredondamento comercial, só inteiros (sem ponto flutuante). */
function porcento(parte: number, total: number): string {
  const centesimos = Math.floor((parte * 10_000 + Math.floor(total / 2)) / total);
  return `${String(Math.floor(centesimos / 100))}.${String(centesimos % 100).padStart(2, '0')}`;
}

/**
 * Números da janela sem dupla contagem. `T` nulo (sem meta) ou zero não
 * produz porcentagem. Excesso preservado e informado (nunca recortado).
 */
export function progressoVolumes(t: number | null, p: number, e: number): ProgressoVolumes {
  if (!Number.isInteger(p) || !Number.isInteger(e) || p < 0 || e < 0 || (t !== null && (!Number.isInteger(t) || t < 0))) {
    throw new RangeError('Volumes devem ser inteiros não negativos.');
  }
  const preparados = p + e;
  if (t === null) {
    return {
      requested: null,
      separatedWaiting: p,
      shipped: e,
      prepared: preparados,
      missingToSeparate: null,
      missingToShip: null,
      preparationPercent: null,
      shippingPercent: null,
      basisNote: SEM_META,
      excessPrepared: null,
      excessShipped: null,
    };
  }
  return {
    requested: t,
    separatedWaiting: p,
    shipped: e,
    prepared: preparados,
    missingToSeparate: Math.max(t - preparados, 0),
    missingToShip: Math.max(t - e, 0),
    preparationPercent: t > 0 ? porcento(preparados, t) : null,
    shippingPercent: t > 0 ? porcento(e, t) : null,
    basisNote: t > 0 ? null : SEM_BASE,
    excessPrepared: preparados > t ? preparados - t : null,
    excessShipped: e > t ? e - t : null,
  };
}

/** Progresso na visão do cliente: sem a indicação interna de excesso. */
export const ProgressoClienteSchema = ProgressoVolumesSchema.omit({ excessPrepared: true, excessShipped: true });
export type ProgressoCliente = z.infer<typeof ProgressoClienteSchema>;

export function progressoParaCliente(p: ProgressoVolumes): ProgressoCliente {
  const { excessPrepared: _a, excessShipped: _b, ...resto } = p;
  return resto;
}

// ---------- Registro de meta, separação, expedição e estorno ----------

const MotivoSchema = z.string().trim().min(3, 'Informe o motivo (3 a 300 caracteres).').max(300);

export const RegistrarMetaVolumesSchema = z.object({
  /** Quantidade de volumes informada pelo cliente (inteiro, 0 ou mais). */
  volumes: z.number().int().min(0).max(10_000_000),
  /** Seleção (pedido/versão) a que a meta se refere, quando importada. */
  selectionId: z.uuid().nullable().default(null),
  /** Referência do cliente (e-mail, pedido, versão informada). */
  reference: z.string().trim().min(1).max(120).nullable().default(null),
});
export type RegistrarMetaVolumes = z.infer<typeof RegistrarMetaVolumesSchema>;

/** Conteúdo do palete: vínculo NF × palete importado OU conteúdo registrado (exatamente um). */
const AlvoConteudo = {
  linkId: z.uuid().nullable().default(null),
  contentId: z.uuid().nullable().default(null),
};
const exatamenteUm = (d: { linkId: string | null; contentId: string | null }) => (d.linkId === null) !== (d.contentId === null);

export const RegistrarSeparacaoVolumesSchema = z
  .object({
    ...AlvoConteudo,
    /** Linha da seleção atendida (opcional; precisa ser da seleção da meta). */
    selectionLineId: z.uuid().nullable().default(null),
    volumes: z.number().int().min(1).max(1_000_000),
  })
  .refine(exatamenteUm, {
    message: 'Informe o conteúdo (NF importada ou conteúdo registrado).',
    path: ['linkId'],
  });
export type RegistrarSeparacaoVolumes = z.infer<typeof RegistrarSeparacaoVolumesSchema>;

export const RegistrarExpedicaoVolumesSchema = z.object({
  items: z
    .array(
      z
        .object({
          ...AlvoConteudo,
          volumes: z.number().int().min(1).max(1_000_000),
        })
        .refine(exatamenteUm, { message: 'Informe o conteúdo de cada item.' }),
    )
    .min(1)
    .max(500),
  /** Documento/romaneio da saída, quando houver. */
  reference: z.string().trim().min(1).max(120).nullable().default(null),
});
export type RegistrarExpedicaoVolumes = z.infer<typeof RegistrarExpedicaoVolumesSchema>;

export const EstornarVolumesSchema = z.object({
  /** Evento de separação ou expedição a corrigir. */
  eventId: z.uuid(),
  /** Volumes a estornar (padrão: o que resta do evento). */
  volumes: z.number().int().min(1).max(1_000_000).nullable().default(null),
  reason: MotivoSchema,
});
export type EstornarVolumes = z.infer<typeof EstornarVolumesSchema>;

export const TipoEventoVolumesSchema = z.enum(['SEPARACAO', 'ESTORNO_SEPARACAO', 'EXPEDICAO', 'ESTORNO_EXPEDICAO']);
export type TipoEventoVolumes = z.infer<typeof TipoEventoVolumesSchema>;

// ---------- Volumes da janela (visão interna da operação) ----------

/** Conteúdo (NF × palete) com a base de volumes e o que já foi separado/expedido. */
export const ConteudoVolumesSchema = z.object({
  linkId: z.uuid().nullable(),
  contentId: z.uuid().nullable(),
  palletId: z.uuid(),
  palletCode: z.string(),
  address: z.string().nullable(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  delivery: z.string().nullable(),
  sender: z.string().nullable(),
  /** Volumes do conteúdo: contagem vigente quando houver; senão o informado. Nulo = não informado. */
  baseVolumes: Volumes.nullable(),
  basis: z.enum(['CONTADO', 'INFORMADO']).nullable(),
  /** Separado + expedido em todas as janelas (compromisso do conteúdo). */
  committedAllWindows: Volumes,
  /** Nesta janela. */
  separatedWaiting: Volumes,
  shipped: Volumes,
  /** Ainda disponível para separar (nulo sem base). */
  available: Volumes.nullable(),
});
export type ConteudoVolumes = z.infer<typeof ConteudoVolumesSchema>;

export const EventoVolumesSchema = z.object({
  id: z.uuid(),
  type: TipoEventoVolumesSchema,
  volumes: Volumes,
  at: z.iso.datetime(),
  palletCode: z.string(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  delivery: z.string().nullable(),
  selectionLineRow: z.number().int().nullable(),
  correctsEventId: z.uuid().nullable(),
  /** Restante estornável (só eventos de separação/expedição). */
  reversible: Volumes,
  reason: z.string().nullable(),
  by: z.object({ login: z.string(), name: z.string() }).nullable(),
});
export type EventoVolumes = z.infer<typeof EventoVolumesSchema>;

export const MetaVolumesSchema = z.object({
  volumes: Volumes,
  reference: z.string().nullable(),
  at: z.iso.datetime(),
  selection: z
    .object({
      id: z.uuid(),
      code: z.string(),
      orderRef: z.string(),
      version: z.number().int(),
      superseded: z.boolean(),
    })
    .nullable(),
});
export type MetaVolumes = z.infer<typeof MetaVolumesSchema>;

/** Etapa de uma linha selecionada pelo cliente (nunca "expedida" por importar a seleção). */
export const EtapaSelecaoSchema = z.enum(['NAO_LOCALIZADA', 'LOCALIZADA', 'EM_SEPARACAO', 'SEPARADA', 'EXPEDIDA']);
export type EtapaSelecao = z.infer<typeof EtapaSelecaoSchema>;

export const ROTULO_ETAPA_SELECAO: Record<EtapaSelecao, string> = {
  NAO_LOCALIZADA: 'Não localizada na base',
  LOCALIZADA: 'Localizada na base',
  EM_SEPARACAO: 'Em separação',
  SEPARADA: 'Separada',
  EXPEDIDA: 'Expedida',
};

export const LinhaSelecaoJanelaSchema = z.object({
  lineId: z.uuid(),
  row: z.number().int(),
  scope: z.enum(['PALETE', 'DOCUMENTO', 'LINHA_PRODUTO']),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  delivery: z.string().nullable(),
  palletRef: z.string().nullable(),
  /** Volumes pedidos na linha (nulo = não informado ou unidade não comparável). */
  requested: Volumes.nullable(),
  /** Volumes da base nos conteúdos localizados (contado/informado; nulo se algum desconhecido). */
  locatedVolumes: Volumes.nullable(),
  /** Restante da NF/palete fora do pedido (só quando pedido < base). */
  remainder: Volumes.nullable(),
  separatedWaiting: Volumes,
  shipped: Volumes,
  stage: EtapaSelecaoSchema,
  pallets: z.array(z.object({ code: z.string(), address: z.string().nullable() })),
});
export type LinhaSelecaoJanela = z.infer<typeof LinhaSelecaoJanelaSchema>;

export const ResumoEtapasSchema = z.object({
  lines: Contagem,
  notLocated: Contagem,
  located: Contagem,
  inSeparation: Contagem,
  separated: Contagem,
  shipped: Contagem,
});
export type ResumoEtapas = z.infer<typeof ResumoEtapasSchema>;

export const JanelaPainelSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  situation: SituacaoJanelaSchema,
  month: DataSchema,
  exitStart: z.iso.datetime().nullable(),
  exitEnd: z.iso.datetime().nullable(),
  preparationDeadline: z.iso.datetime().nullable(),
  goal: MetaVolumesSchema.nullable(),
  progress: ProgressoVolumesSchema,
  stages: ResumoEtapasSchema.nullable(),
  /** Soma das linhas selecionadas com volumes conhecidos (nula se alguma sem base). */
  selectedSum: Volumes.nullable().default(null),
  /** Meta − soma selecionada, para revisão interna (nunca corrigida sozinha). */
  goalDifference: z.number().int().nullable().default(null),
  /** Preparações ligadas a versão substituída da seleção: revisar. */
  needsReview: z.boolean().default(false),
});
export type JanelaPainel = z.infer<typeof JanelaPainelSchema>;

export const VolumesJanelaSchema = z.object({
  consultedAt: z.iso.datetime(),
  timezone: z.string(),
  window: JanelaPainelSchema,
  goals: z.array(MetaVolumesSchema),
  contents: z.array(ConteudoVolumesSchema),
  lines: z.array(LinhaSelecaoJanelaSchema),
  events: z.array(EventoVolumesSchema),
  /** Linhas da seleção vigente cujo atendimento usa versão substituída. */
  reviewNotes: z.array(z.string()),
});
export type VolumesJanela = z.infer<typeof VolumesJanelaSchema>;

export const ResultadoVolumesSchema = z.object({
  windowId: z.uuid(),
  events: z.array(z.uuid()),
  progress: ProgressoVolumesSchema,
});
export type ResultadoVolumes = z.infer<typeof ResultadoVolumesSchema>;

/** Busca de conteúdos para separar (palete, NF/NFD/MI ou Delivery). */
export const BuscaConteudoVolumesSchema = z.object({
  texto: z.string().trim().min(1).max(80),
});

// ---------- Filtros ----------

const Texto = z.string().trim().min(1).max(80).optional();

/** Filtros dos painéis e listas (guardados na URL). Estoque = agora; período filtra acontecimentos e janelas. */
export const FiltroPainelSchema = z.object({
  janela: z.uuid().optional(),
  inicio: DataSchema.optional(),
  fim: DataSchema.optional(),
  rua: Texto,
  palete: Texto,
  documento: Texto,
  delivery: Texto,
  remetente: Texto,
  /** Lista de estoque: só sem endereço / só full / só misto. */
  situacao: z.enum(['sem-endereco', 'full', 'misto', 'sem-volume', 'reconferencia']).optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type FiltroPainel = z.infer<typeof FiltroPainelSchema>;

export const TAMANHO_PAGINA_PAINEL = 50;

// ---------- Painel da operação (DHL) ----------

const Cobertura = z.object({ known: Contagem, total: Contagem });

export const VolumesEstoqueSchema = z.object({
  /** Soma dos informados no inventário (conteúdos com valor informado). */
  informed: Volumes,
  informedCoverage: Cobertura,
  /** Soma das contagens vigentes (conferência de volumes). */
  counted: Volumes,
  countedCoverage: Cobertura,
  /** Atual: contado quando houver, senão informado, menos o expedido. */
  current: Volumes,
  currentCoverage: Cobertura,
  /** Volumes já expedidos pelos painéis (descontados do atual). */
  shipped: Volumes,
});
export type VolumesEstoque = z.infer<typeof VolumesEstoqueSchema>;

export const PorRuaSchema = z.object({
  street: z.string(),
  pallets: Contagem,
  volumes: Volumes,
  /** Conteúdos sem volume conhecido nesta rua. */
  volumesUnknown: Contagem,
  /** Conteúdos (NF × palete) no estoque desta rua; 0 = conteúdo não registrado (volume não é zero). */
  contents: Contagem.default(0),
});
export type PorRua = z.infer<typeof PorRuaSchema>;

export const TarefaPainelSchema = z.object({
  kind: z.enum(['LOCALIZACAO', 'RECONFERENCIA', 'SEPARACAO', 'NF_SEM_PALETE']),
  label: z.string(),
  detail: z.string().nullable(),
  palletId: z.uuid().nullable(),
  palletCode: z.string().nullable(),
  windowId: z.uuid().nullable(),
  /** Desde quando (reconferência vencida: o vencimento). */
  since: z.iso.datetime().nullable(),
});
export type TarefaPainel = z.infer<typeof TarefaPainelSchema>;

export const PainelOperacaoSchema = z.object({
  scope: z.object({ id: z.uuid(), name: z.string(), demo: z.boolean() }),
  consultedAt: z.iso.datetime(),
  period: PeriodoAplicadoSchema,
  stock: z.object({
    activePallets: Contagem,
    palletsWithAddress: Contagem,
    palletsWithoutAddress: Contagem,
    contents: Contagem,
    documents: Contagem,
    fullPallets: Contagem,
    mixedPallets: Contagem,
    incomplete: z.object({ withoutDocument: Contagem, withoutType: Contagem }),
    volumes: VolumesEstoqueSchema,
  }),
  positions: z
    .object({
      active: Contagem,
      occupied: Contagem,
      freeConfirmed: Contagem,
      unknown: Contagem,
      excluded: Contagem,
      provisional: z.boolean(),
    })
    .nullable(),
  location: z.object({
    documentsWithoutPallet: Contagem,
    palletsWithoutAddress: Contagem,
  }),
  reconference: z.object({
    due: Contagem,
    dueNext7Days: Contagem,
    nextDueAt: z.iso.datetime().nullable(),
  }),
  byStreet: z.array(PorRuaSchema),
  windows: z.array(JanelaPainelSchema),
  nextWindow: JanelaPainelSchema.nullable(),
  tasks: z.object({
    items: z.array(TarefaPainelSchema),
    totals: z.object({
      location: Contagem,
      reconference: Contagem,
      separation: Contagem,
      documentsWithoutPallet: Contagem,
    }),
  }),
  /** Só com claim.consultar (visão interna): casos e valores estimados × confirmados separados. */
  claims: IndicadoresClaimsSchema.nullable(),
  values: IndicadoresValoresSchema.nullable(),
  historyFrom: z.iso.datetime().nullable(),
});
export type PainelOperacao = z.infer<typeof PainelOperacaoSchema>;

// ---------- Painel do cliente (projeção permitida) ----------

export const FullMistoSchema = z.enum(['FULL', 'MISTO', 'NAO_INFORMADO']);
export type FullMisto = z.infer<typeof FullMistoSchema>;

export const LinhaEstoqueClienteSchema = z.object({
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  delivery: z.string().nullable(),
  sender: z.string().nullable(),
  /** Nulo = não informado (nunca zero presumido). */
  volumes: Volumes.nullable(),
  volumesBasis: z.enum(['CONTADO', 'INFORMADO']).nullable(),
  palletCode: z.string(),
  /** Só na visão interna (abre o palete no mapa); nulo na do cliente. */
  palletId: z.uuid().nullable().default(null),
  palletType: FullMistoSchema,
  /** Endereço operacional ("15 - A120", "GR9"); nulo = localização em atualização. */
  address: z.string().nullable(),
  street: z.string().nullable(),
  /** Etapa na janela filtrada (nula fora de janela). */
  windowStage: EtapaSelecaoSchema.nullable(),
});
export type LinhaEstoqueCliente = z.infer<typeof LinhaEstoqueClienteSchema>;

export const EstoqueClienteSchema = z.object({
  consultedAt: z.iso.datetime(),
  timezone: z.string(),
  rows: z.array(LinhaEstoqueClienteSchema),
  total: Contagem,
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totals: z.object({
    volumes: Volumes,
    volumesCoverage: Cobertura,
    pallets: Contagem,
    documents: Contagem,
  }),
});
export type EstoqueCliente = z.infer<typeof EstoqueClienteSchema>;

export const TipoEventoClienteSchema = z.enum([
  'ENTRADA_REGISTRADA',
  'LOCALIZACAO_REGISTRADA',
  'LOCALIZACAO',
  'CORRECAO_LOCALIZACAO',
  'SAIDA_PRACA',
  'TRANSFERENCIA_CONTEUDO',
  'CONFERENCIA',
  'CONTAGEM_VOLUMES',
  'RECONFERENCIA',
  'SEPARACAO',
  'ESTORNO_SEPARACAO',
  'EXPEDICAO',
  'ESTORNO_EXPEDICAO',
]);
export type TipoEventoCliente = z.infer<typeof TipoEventoClienteSchema>;

export const ROTULO_EVENTO_CLIENTE: Record<TipoEventoCliente, string> = {
  ENTRADA_REGISTRADA: 'Entrada registrada no sistema',
  LOCALIZACAO_REGISTRADA: 'Localização registrada no sistema',
  LOCALIZACAO: 'Mudança de localização',
  CORRECAO_LOCALIZACAO: 'Correção de localização',
  SAIDA_PRACA: 'Saída da praça',
  TRANSFERENCIA_CONTEUDO: 'Transferência de conteúdo',
  CONFERENCIA: 'Conferência registrada',
  CONTAGEM_VOLUMES: 'Contagem de volumes registrada',
  RECONFERENCIA: 'Reconferência completa registrada',
  SEPARACAO: 'Separação registrada',
  ESTORNO_SEPARACAO: 'Correção de separação',
  EXPEDICAO: 'Expedição confirmada',
  ESTORNO_EXPEDICAO: 'Correção de expedição',
};

export const EventoClienteSchema = z.object({
  /** Chave estável do evento (ordem e paginação). */
  key: z.string(),
  at: z.iso.datetime(),
  type: TipoEventoClienteSchema,
  palletCode: z.string(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  delivery: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  volumes: Volumes.nullable(),
  windowCode: z.string().nullable(),
  /** Correção de outro evento (a quantidade não é somada duas vezes). */
  correction: z.boolean(),
});
export type EventoCliente = z.infer<typeof EventoClienteSchema>;

export const HistoricoClienteSchema = z.object({
  consultedAt: z.iso.datetime(),
  timezone: z.string(),
  events: z.array(EventoClienteSchema),
  total: Contagem,
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  /** Primeiro registro disponível (nada antes disso é inventado). */
  availableFrom: z.iso.datetime().nullable(),
});
export type HistoricoCliente = z.infer<typeof HistoricoClienteSchema>;

export const JanelaClienteSchema = JanelaPainelSchema.omit({
  selectedSum: true,
  goalDifference: true,
  needsReview: true,
}).extend({
  goal: z
    .object({
      volumes: Volumes,
      reference: z.string().nullable(),
      at: z.iso.datetime(),
      selection: z.object({ orderRef: z.string(), version: z.number().int() }).nullable(),
    })
    .nullable(),
  progress: ProgressoClienteSchema,
});
export type JanelaCliente = z.infer<typeof JanelaClienteSchema>;

export const PainelClienteSchema = z.object({
  scope: z.object({
    name: z.string(),
    clientName: z.string(),
    demo: z.boolean(),
  }),
  consultedAt: z.iso.datetime(),
  timezone: z.string(),
  stock: z.object({
    pallets: Contagem,
    documents: Contagem,
    contents: Contagem,
    fullPallets: Contagem,
    mixedPallets: Contagem,
    locationUpdating: Contagem,
    volumes: Volumes,
    volumesCoverage: Cobertura,
  }),
  byStreet: z.array(PorRuaSchema),
  windows: z.array(JanelaClienteSchema),
  historyFrom: z.iso.datetime().nullable(),
  /** Inventário ativo em validação (base provisória): os números não são disponibilidade confirmada. */
  inventoryInValidation: z.object({ baseDate: z.iso.date().nullable() }).nullable().default(null),
});
export type PainelCliente = z.infer<typeof PainelClienteSchema>;

export const LinhasJanelaClienteSchema = z.object({
  consultedAt: z.iso.datetime(),
  window: JanelaClienteSchema,
  lines: z.array(LinhaSelecaoJanelaSchema.omit({ lineId: true })),
});
export type LinhasJanelaCliente = z.infer<typeof LinhasJanelaClienteSchema>;

/** Endereço operacional para exibição: "GR - 9" → "GR9"; demais como confirmados ("15 - A120"). */
export function rotuloEnderecoOperacional(texto: string): string {
  const grade = /^GR\s*-?\s*(\d+)$/i.exec(texto.trim());
  return grade ? `GR${grade[1] ?? ''}` : texto;
}

/** Unidades da seleção aceitas como VOLUMES (sem conversão de caixas/unidades). */
export function unidadeEhVolume(unidade: string | null): boolean {
  if (unidade === null) return false;
  const u = unidade.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\.$/, '');
  return ['VOL', 'VOLS', 'VOLUME', 'VOLUMES', 'VL', 'VLS'].includes(u);
}
