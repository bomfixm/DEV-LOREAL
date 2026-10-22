import { z } from 'zod';
import { QuantidadeSchema } from './decimal.js';
import {
  CondicaoMaterialSchema,
  EstadoConferenciaSchema,
  EstadoFluxoSchema,
  EstadoLiberacaoSchema,
  TipoOrigemDocumentoSchema,
} from './estados.js';
import { EscopoConferenciaSchema, SituacaoConferenciaSchema } from './conferencia.js';

/**
 * Busca operacional (etapa 06; docs/DADOS-E-REGRAS.md e INTERFACES.md). Cada
 * resultado tem uma base de informação, que nunca é somada às outras:
 *
 * - PALETE: o próprio palete (código, QR ou endereço).
 * - SALDO_VALIDADO: saldo atual reconciliado/transferido (com reservado e disponível).
 * - OBSERVADO: contagem concluída e ainda não validada (sessão, escopo e pendências).
 * - DECLARADO_PALETE: linha declarada no cadastro do palete (documento; não comprova presença).
 * - DOCUMENTO: linha de documento importado, sem vínculo físico registrado.
 * - INVENTARIO: vínculo documental NF/documento × palete informado no
 *   inventário conferido (fonte e linha do arquivo); volumes como informados,
 *   sem quantidade de produto nem saldo.
 * - CONTEUDO: conteúdo registrado no palete (remetente e, quando houver, nota
 *   e Delivery), com a contagem de volumes vigente; sem produto nem saldo.
 * - ORIGEM_INVENTARIO: linha de origem do inventário ativo que ficou sem
 *   alocação (sem RUA, ou endereço em conflito com o registro atual): sem
 *   palete nem posição presumidos; volumes como informados.
 *
 * Identificadores (SKU, código de barras, lote, referências) são comparados
 * como texto, sem diferenciar maiúsculas, por igualdade ou início; a descrição
 * é flexível e sempre marcada como correspondência aproximada.
 */
export const CampoBuscaSchema = z.enum(['TUDO', 'PALETE', 'ENDERECO', 'SKU', 'CODIGO_BARRAS', 'LOTE', 'DOCUMENTO', 'NF', 'DESCRICAO']);
export type CampoBusca = z.infer<typeof CampoBuscaSchema>;
export const CAMPOS_BUSCA = CampoBuscaSchema.options;

export const BaseResultadoSchema = z.enum(['PALETE', 'SALDO_VALIDADO', 'OBSERVADO', 'DECLARADO_PALETE', 'DOCUMENTO', 'INVENTARIO', 'CONTEUDO', 'ORIGEM_INVENTARIO']);
export type BaseResultado = z.infer<typeof BaseResultadoSchema>;
/** Bases com produto (pistas dos claims, resumo por produto). */
export const BASES_CONTEUDO = ['SALDO_VALIDADO', 'OBSERVADO', 'DECLARADO_PALETE', 'DOCUMENTO'] as const satisfies readonly BaseResultado[];
/** Bases que a tela oferece como filtro (conteúdo + vínculos documentais do inventário). */
export const BASES_FILTRO_BUSCA = [...BASES_CONTEUDO, 'INVENTARIO', 'CONTEUDO', 'ORIGEM_INVENTARIO'] as const satisfies readonly BaseResultado[];

/** Como o texto correspondeu ao resultado. Prefixo e descrição não comprovam identificação. */
export const CorrespondenciaSchema = z.enum([
  'ID_PALETE',
  'CODIGO_PALETE',
  'CODIGO_PALETE_PARCIAL',
  'ENDERECO',
  'ENDERECO_PARCIAL',
  'SKU',
  'SKU_PREFIXO',
  'CODIGO_BARRAS',
  'CODIGO_BARRAS_PREFIXO',
  'LOTE',
  'LOTE_PREFIXO',
  'DOCUMENTO',
  'DOCUMENTO_PREFIXO',
  'NF',
  'NF_PREFIXO',
  'DESCRICAO_APROXIMADA',
  /** Sem texto: só filtros. */
  'FILTRO',
]);
export type Correspondencia = z.infer<typeof CorrespondenciaSchema>;

/** Correspondências que não identificam o registro com certeza (exigem conferência de quem busca). */
export const CORRESPONDENCIAS_APROXIMADAS: readonly Correspondencia[] = [
  'CODIGO_PALETE_PARCIAL',
  'ENDERECO_PARCIAL',
  'SKU_PREFIXO',
  'CODIGO_BARRAS_PREFIXO',
  'LOTE_PREFIXO',
  'DOCUMENTO_PREFIXO',
  'NF_PREFIXO',
  'DESCRICAO_APROXIMADA',
];

export const LocalizacaoFiltroSchema = z.enum(['COM_POSICAO', 'PENDENTE']);
export type LocalizacaoFiltro = z.infer<typeof LocalizacaoFiltroSchema>;

export const LIMITE_PAGINA_BUSCA = 100;
/** Maior deslocamento aceito (página × tamanho): refine a busca além disso. */
export const LIMITE_DESLOCAMENTO_BUSCA = 10_000;
/** Mínimo de caracteres para comparação por início ou descrição. */
export const MINIMO_PARCIAL_BUSCA = 3;

const listaDeBases = z
  .string()
  .max(200)
  .transform((texto, ctx) => {
    const partes = texto.split(',').map((p) => p.trim()).filter(Boolean);
    const bases: BaseResultado[] = [];
    for (const parte of partes) {
      const base = BaseResultadoSchema.safeParse(parte);
      if (!base.success) {
        ctx.addIssue({ code: 'custom', message: `Base desconhecida: ${parte}` });
        return z.NEVER;
      }
      if (!bases.includes(base.data)) bases.push(base.data);
    }
    return bases;
  });

/** GET /busca e GET /busca/exportar — validado também no servidor. */
export const FiltroBuscaSchema = z
  .object({
    texto: z.string().trim().max(120).optional(),
    campo: CampoBuscaSchema.default('TUDO'),
    /** Bases incluídas (separadas por vírgula); vazio = todas. */
    base: listaDeBases.optional(),
    conferencia: EstadoConferenciaSchema.optional(),
    liberacao: EstadoLiberacaoSchema.optional(),
    condicao: CondicaoMaterialSchema.optional(),
    localizacao: LocalizacaoFiltroSchema.optional(),
    emConferencia: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    pagina: z.coerce.number().int().min(1).default(1),
    tamanho: z.coerce.number().int().min(1).max(LIMITE_PAGINA_BUSCA).default(25),
  })
  .superRefine((f, ctx) => {
    if ((f.pagina - 1) * f.tamanho > LIMITE_DESLOCAMENTO_BUSCA) {
      ctx.addIssue({ code: 'custom', path: ['pagina'], message: `Página além do limite de ${String(LIMITE_DESLOCAMENTO_BUSCA)} resultados: refine a busca.` });
    }
  });
export type FiltroBusca = z.output<typeof FiltroBuscaSchema>;

/** Há critério para buscar (texto ou algum filtro). */
export function buscaTemCriterio(f: Pick<FiltroBusca, 'texto' | 'base' | 'conferencia' | 'liberacao' | 'condicao' | 'localizacao' | 'emConferencia'>): boolean {
  return (
    (f.texto ?? '') !== '' ||
    (f.base?.length ?? 0) > 0 ||
    f.conferencia !== undefined ||
    f.liberacao !== undefined ||
    f.condicao !== undefined ||
    f.localizacao !== undefined ||
    f.emConferencia === true
  );
}

const PaleteBuscaSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  positionId: z.uuid().nullable(),
  positionCode: z.string().min(1).nullable(),
  countState: EstadoConferenciaSchema,
  releaseState: EstadoLiberacaoSchema,
  flowState: EstadoFluxoSchema,
  pendingReason: z.string().nullable(),
  activeCountId: z.uuid().nullable(),
});
export type PaleteBusca = z.infer<typeof PaleteBuscaSchema>;

export const ResultadoBuscaSchema = z
  .object({
    /** Identificador estável do resultado (base + registro). */
    key: z.string().min(1),
    base: BaseResultadoSchema,
    match: CorrespondenciaSchema,
    /** Palete vinculado de fato (nunca presumido por coincidência de SKU). */
    pallet: PaleteBuscaSchema.nullable(),
    product: z.object({ id: z.uuid(), sku: z.string().min(1), description: z.string().min(1) }).nullable(),
    /** Descrição do produto pendente (linha declarada sem SKU). */
    pendingDescription: z.string().nullable(),
    lot: z.string().nullable(),
    originType: TipoOrigemDocumentoSchema.nullable(),
    originReference: z.string().nullable(),
    condition: CondicaoMaterialSchema.nullable(),
    /** Registro pendente com identidade própria (lote/origem pendentes). */
    lineage: z.string().nullable(),
    /** Quantidade na base do resultado; `null` no resultado PALETE (conteúdo no detalhe). */
    quantity: QuantidadeSchema.nullable(),
    unit: z.string().nullable(),
    /** SALDO_VALIDADO: parte reservada e disponível (saldo − reservas). */
    reserved: QuantidadeSchema.nullable(),
    available: QuantidadeSchema.nullable(),
    /** OBSERVADO: sessão de conferência concluída e ainda não validada. */
    session: z
      .object({ id: z.uuid(), number: z.number().int().positive(), scope: EscopoConferenciaSchema, state: SituacaoConferenciaSchema, pendingLines: z.number().int().nonnegative() })
      .nullable(),
    /** DOCUMENTO: documento importado e quantidade original declarada. */
    document: z
      .object({
        id: z.uuid(),
        reference: z.string().min(1),
        lineReference: z.string().min(1),
        invoice: z.string().nullable(),
        date: z.iso.date().nullable(),
        declaredQuantity: QuantidadeSchema,
        declaredUnit: z.string().min(1),
        factor: QuantidadeSchema,
        batchId: z.uuid().nullable(),
      })
      .nullable(),
    /**
     * INVENTARIO: vínculo documental ativo do inventário conferido. Volumes
     * como informados (unidade própria), nunca convertidos em peças; o
     * endereço informado é a fotografia, o atual está em `pallet`.
     */
    documentLink: z
      .object({
        id: z.uuid(),
        documentType: z.string().nullable(),
        documentNumber: z.string().min(1),
        delivery: z.string().nullable(),
        volumes: QuantidadeSchema.nullable(),
        volumesUnit: z.string().min(1),
        documentation: z.string().nullable(),
        palletFull: z.string().nullable(),
        externalCount: z.boolean(),
        informedAddress: z.string().nullable(),
        inventoryId: z.uuid(),
        inventoryCode: z.string().min(1),
        countReference: z.string().min(1),
        row: z.number().int().positive(),
      })
      .nullable()
      .default(null),
    /** CONTEUDO: conteúdo registrado no palete; nota e Delivery podem faltar; volumes = contagem vigente. */
    contentLink: z
      .object({
        id: z.uuid(),
        sender: z.string().min(1),
        documentType: z.string().nullable(),
        documentNumber: z.string().nullable(),
        delivery: z.string().nullable(),
        description: z.string().nullable(),
        counted: QuantidadeSchema.nullable(),
        expected: QuantidadeSchema.nullable(),
      })
      .nullable()
      .default(null),
    /**
     * ORIGEM_INVENTARIO: linha de origem sem alocação (palete e posição não
     * presumidos). `informedAddress` nulo = endereço não informado (sem RUA).
     */
    inventoryOrigin: z
      .object({
        lineId: z.uuid(),
        inventoryId: z.uuid(),
        inventoryCode: z.string().min(1),
        row: z.number().int().positive(),
        documentType: z.string().nullable(),
        documentNumber: z.string().nullable(),
        delivery: z.string().nullable(),
        sender: z.string().nullable(),
        volumes: QuantidadeSchema.nullable(),
        volumesRead: z.string().nullable(),
        informedAddress: z.string().nullable(),
        palletNumber: z.string().nullable(),
        reason: z.string().nullable(),
      })
      .nullable()
      .default(null),
  })
  .superRefine((r, ctx) => {
    const erro = (m: string) => {
      ctx.addIssue({ code: 'custom', message: `${m} (${r.key})` });
    };
    if (r.base === 'DOCUMENTO' && (r.pallet !== null || r.document === null)) erro('Documento importado não tem palete presumido');
    if (r.base === 'INVENTARIO' && (r.documentLink === null || r.quantity !== null)) erro('Vínculo do inventário sem quantidade de produto presumida');
    if (r.base !== 'INVENTARIO' && r.documentLink !== null) erro('Vínculo documental só na base do inventário');
    if (r.base === 'CONTEUDO' && (r.contentLink === null || r.quantity !== null)) erro('Conteúdo registrado sem quantidade de produto presumida');
    if (r.base !== 'CONTEUDO' && r.contentLink !== null) erro('Conteúdo registrado só na base própria');
    if (r.base === 'ORIGEM_INVENTARIO' && (r.inventoryOrigin === null || r.pallet !== null || r.quantity !== null)) erro('Origem sem alocação não tem palete nem quantidade presumidos');
    if (r.base !== 'ORIGEM_INVENTARIO' && r.inventoryOrigin !== null) erro('Origem sem alocação só na base própria');
    if (r.base !== 'DOCUMENTO' && r.base !== 'ORIGEM_INVENTARIO' && r.pallet === null) erro('Resultado físico sem palete');
    if (r.base === 'PALETE' && r.quantity !== null) erro('Resultado de palete sem quantidade presumida');
    if (r.base === 'OBSERVADO' && r.session === null) erro('Observação sem sessão');
    if (r.base === 'SALDO_VALIDADO' && (r.reserved === null || r.available === null)) erro('Saldo sem reservado/disponível');
  });
export type ResultadoBusca = z.infer<typeof ResultadoBuscaSchema>;

/**
 * Resumo por produto, base e unidade. Bases nunca se somam entre si;
 * observações não são somadas (contagens podem se sobrepor); unidades
 * diferentes ficam em linhas diferentes (sem conversão presumida).
 */
export const GrupoResumoSchema = z.object({
  base: BaseResultadoSchema,
  productId: z.uuid().nullable(),
  sku: z.string().nullable(),
  description: z.string().min(1),
  unit: z.string().min(1),
  /** Soma na base; `null` em OBSERVADO (não somado). */
  quantity: QuantidadeSchema.nullable(),
  reserved: QuantidadeSchema.nullable(),
  available: QuantidadeSchema.nullable(),
  records: z.number().int().nonnegative(),
  pallets: z.number().int().nonnegative(),
  /** Distinções preservadas: lote, origem e condição. */
  breakdown: z.array(
    z.object({
      lot: z.string().nullable(),
      originType: TipoOrigemDocumentoSchema.nullable(),
      originReference: z.string().nullable(),
      condition: CondicaoMaterialSchema.nullable(),
      quantity: QuantidadeSchema.nullable(),
      records: z.number().int().nonnegative(),
    }),
  ),
});
export type GrupoResumo = z.infer<typeof GrupoResumoSchema>;

export const LIMITE_GRUPOS_RESUMO = 30;
export const LIMITE_PALETES_DESTACADOS = 500;

export const RespostaBuscaSchema = z.object({
  items: z.array(ResultadoBuscaSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  summary: z.array(GrupoResumoSchema),
  summaryTruncated: z.boolean(),
  /** Paletes com algum resultado (para destacar no mapa), até o limite. */
  palletIds: z.array(z.uuid()),
  palletIdsTruncated: z.boolean(),
  consultedAt: z.iso.datetime(),
});
export type RespostaBusca = z.infer<typeof RespostaBuscaSchema>;
