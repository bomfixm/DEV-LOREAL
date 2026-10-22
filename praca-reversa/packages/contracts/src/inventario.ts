import { z } from 'zod';
import { UsuarioResumoSchema } from './acesso.js';
import { MotivoLinhaSchema, SignificadoNumeroPaleteSchema } from './importacao.js';

/**
 * Inventário de referência (complemento "seleção do cliente"): a fotografia
 * do que foi informado ao cliente — NF/documento × palete × endereço ×
 * volumes, com fonte e data —, preservada mesmo depois de movimentos.
 *
 * Importar o inventário conferido registra vínculos documentais e, quando a
 * revisão confirma, cria/vincula paletes e registra a localização por meio
 * dos serviços existentes. Nunca cria saldo validado nem libera material: a
 * conferência externa é reconhecida à parte, no nível que o arquivo comprova
 * (NF, palete, endereço e volumes), sem inventar SKU ou peças.
 */

export const AcaoLinhaInventarioSchema = z.enum([
  'VINCULAR',
  'CRIAR_CADASTRO',
  'ATUALIZAR',
  'JA_IMPORTADO',
  'REFERENCIA_HISTORICA',
  'DUPLICADA_ARQUIVO',
  'REQUER_RESOLUCAO',
]);
export type AcaoLinhaInventario = z.infer<typeof AcaoLinhaInventarioSchema>;

export const ROTULOS_ACAO_INVENTARIO: Readonly<Record<AcaoLinhaInventario, string>> = {
  VINCULAR: 'Vincular',
  CRIAR_CADASTRO: 'Criar cadastro proposto',
  ATUALIZAR: 'Atualizar informação',
  JA_IMPORTADO: 'Já importado',
  REFERENCIA_HISTORICA: 'Referência histórica / endereço livre',
  DUPLICADA_ARQUIVO: 'Repetida no arquivo',
  REQUER_RESOLUCAO: 'Requer resolução',
};

export const SituacaoConferenciaExternaSchema = z.enum(['NAO_REGISTRADA', 'RECONHECIDA']);
export type SituacaoConferenciaExterna = z.infer<typeof SituacaoConferenciaExternaSchema>;

export const InventarioResumoSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  description: z.string().min(1),
  origin: z.enum(['IMPORTADO', 'APLICACAO']),
  state: z.enum(['ATIVO', 'SUBSTITUIDO']),
  countReference: z.string().min(1),
  /** Data da conferência informada (nunca presumida). */
  countDate: z.iso.date().nullable(),
  countSource: z.string().nullable(),
  fileName: z.string().nullable(),
  fileHash: z.string().nullable(),
  sheet: z.string().nullable(),
  batchId: z.uuid().nullable(),
  palletNumberMeaning: SignificadoNumeroPaleteSchema,
  /** Base provisória ("Inventário em validação"): saldos não são disponibilidade certificada. */
  inValidation: z.boolean().default(false),
  /** Data-base informada do arquivo (AAAA-MM-DD), quando houver. */
  baseDate: z.iso.date().nullable().default(null),
  totals: z.object({
    lines: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    historical: z.number().int().nonnegative(),
  }),
  externalCount: z.object({
    state: SituacaoConferenciaExternaSchema,
    reference: z.string().nullable(),
    date: z.iso.date().nullable(),
    source: z.string().nullable(),
    notes: z.string().nullable(),
    by: UsuarioResumoSchema.nullable(),
    at: z.iso.datetime().nullable(),
  }),
  replacesId: z.uuid().nullable(),
  replacedById: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: UsuarioResumoSchema.nullable(),
  version: z.number().int().positive(),
});
export type InventarioResumo = z.infer<typeof InventarioResumoSchema>;

export const PaginaInventariosSchema = z.object({
  items: z.array(InventarioResumoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type PaginaInventarios = z.infer<typeof PaginaInventariosSchema>;

export const FiltroInventariosSchema = z.object({
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  tamanho: z.coerce.number().int().min(1).max(100).default(20),
});
export type FiltroInventarios = z.infer<typeof FiltroInventariosSchema>;

export const LinhaInventarioSchema = z.object({
  id: z.uuid(),
  /** Linha do arquivo de origem. */
  row: z.number().int().positive(),
  batchId: z.uuid(),
  delivery: z.string().nullable(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  volumes: z.string().nullable(),
  volumesRead: z.string().nullable(),
  sender: z.string().nullable(),
  scheduleMonth: z.string().nullable(),
  windowRef: z.string().nullable(),
  addressRead: z.string().nullable(),
  address: z.string().nullable(),
  freeAddress: z.boolean(),
  palletNumber: z.string().nullable(),
  documentation: z.string().nullable(),
  palletFull: z.string().nullable(),
  category: z.string().nullable(),
  /** Demais colunas do arquivo (cabeçalho → valor). */
  extras: z.record(z.string(), z.string().nullable()),
  pallet: z.object({ id: z.uuid(), code: z.string().min(1) }).nullable(),
  /** Posição do mapa resolvida pela tabela confirmada na importação (fotografia). */
  position: z.object({ id: z.uuid(), code: z.string().min(1) }).nullable(),
  action: AcaoLinhaInventarioSchema,
  applied: z.boolean(),
  reasons: z.array(MotivoLinhaSchema),
  resolvedById: z.uuid().nullable(),
});
export type LinhaInventario = z.infer<typeof LinhaInventarioSchema>;

export const FiltroLinhasInventarioSchema = z.object({
  situacao: z.enum(['TODAS', 'APLICADAS', 'PENDENTES', 'HISTORICAS']).default('TODAS'),
  texto: z.string().trim().max(64).optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  tamanho: z.coerce.number().int().min(1).max(200).default(50),
});
export type FiltroLinhasInventario = z.infer<typeof FiltroLinhasInventarioSchema>;

export const PaginaLinhasInventarioSchema = z.object({
  items: z.array(LinhaInventarioSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type PaginaLinhasInventario = z.infer<typeof PaginaLinhasInventarioSchema>;

/**
 * Causas de revisão do inventário preparado (pendências com bloqueio, código
 * original em minúsculas): nome curto para agrupar. Código desconhecido usa
 * a descrição da própria ocorrência.
 */
export const ROTULOS_CAUSA_REVISAO: Readonly<Record<string, string>> = {
  endereco_a_validar: 'Endereço a validar (RUA = VALIDAR)',
  numero_palete_ausente: 'N° Pallet ausente',
  endereco_fora_da_regra: 'Endereço fora da regra do mapa',
  duplicata_exata: 'Linhas iguais (possível recontagem duplicada)',
  palete_em_multiplos_enderecos: 'Mesmo N° Pallet em mais de um endereço',
  endereco_com_multiplos_paletes: 'Endereço com mais de um N° Pallet',
  possivel_recontagem_com_quantidade_diferente: 'Possível recontagem com quantidade diferente',
  formula_sem_validacao: 'Fórmula inválida na origem',
  revisao_necessaria: 'Revisão indicada pela preparação',
};

/**
 * GET /inventarios/:id/pendencias — linhas que requerem resolução agrupadas
 * por causa e, dentro dela, por endereço e N° Pallet. Uma linha com mais de
 * uma causa aparece em cada grupo (`totalLines` conta cada linha uma vez).
 * Volumes não são somados (a revisão decide o que vale).
 */
export const GrupoPendenciasInventarioSchema = z.object({
  cause: z.string().min(1),
  description: z.string().min(1),
  lines: z.number().int().nonnegative(),
  places: z.array(
    z.object({
      /** Endereço normalizado ou, sem ele, o informado; `null` = sem endereço. */
      address: z.string().nullable(),
      palletNumbers: z.array(z.string()),
      rows: z.array(z.number().int().positive()),
    }),
  ),
});
export type GrupoPendenciasInventario = z.infer<typeof GrupoPendenciasInventarioSchema>;

export const PendenciasInventarioSchema = z.object({
  inventoryId: z.uuid(),
  totalLines: z.number().int().nonnegative(),
  groups: z.array(GrupoPendenciasInventarioSchema),
});
export type PendenciasInventario = z.infer<typeof PendenciasInventarioSchema>;

/**
 * POST /inventarios/:id/conferencia-externa — reconhece a conferência externa
 * informada (referência, data, fonte), separada da importação documental. Não
 * altera saldo validado, liberação, reservas nem estado de conferência por SKU.
 */
export const ReconhecerConferenciaExternaSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reference: z.string().trim().min(1).max(120),
  date: z.iso.date().nullable(),
  source: z.string().trim().min(3).max(200),
  notes: z.string().trim().max(500).nullable().default(null),
});
export type ReconhecerConferenciaExterna = z.input<typeof ReconhecerConferenciaExternaSchema>;

/** Identidade documental: SHA-256 (hexadecimal) do contexto [tipo, número, DELIVERY|REMETENTE, valor]. */
export const IdentidadeDocumentoSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Identidade documental inválida.');

/**
 * Palete full: uma única identidade documental (NFD) no palete e registros
 * suficientes = FULL; mais de um documento = MISTO; informação insuficiente
 * (sem documento, só tipo pendente ou conteúdo sem número) = NAO_INFORMADO.
 * Calculado dos vínculos atuais; a fotografia do pacote fica como referência.
 */
export const PaleteFullSchema = z.enum(['FULL', 'MISTO', 'NAO_INFORMADO']);
export type PaleteFull = z.infer<typeof PaleteFullSchema>;

export const ROTULOS_PALETE_FULL: Readonly<Record<PaleteFull, string>> = {
  FULL: 'Full (uma única nota)',
  MISTO: 'Misto (várias notas)',
  NAO_INFORMADO: 'Não informado',
};

/** Outro local da mesma NF (identidade documental): palete atual ou referência fora da praça. */
export const LocalNotaSchema = z.object({
  /** ATUAL: outro palete com vínculo ativo; FORA_DA_PRACA: endereço livre no inventário (material saiu, local atual não informado). */
  kind: z.enum(['ATUAL', 'FORA_DA_PRACA']),
  palletId: z.uuid().nullable(),
  palletCode: z.string().nullable(),
  /** Posição do mapa, quando registrada. */
  positionCode: z.string().nullable(),
  /** Endereço completo: o real da posição confirmada ou o informado no inventário. */
  address: z.string().nullable(),
  /** Sem posição no mapa (endereço informado, correspondência pendente). */
  mapPending: z.boolean(),
  inventoryCode: z.string().nullable(),
  row: z.number().int().positive().nullable(),
});
export type LocalNota = z.infer<typeof LocalNotaSchema>;

/** Mesmo número em outro contexto documental (outro DELIVERY/remetente/tipo): candidato, não a mesma nota. */
export const CandidatoNotaSchema = z.object({
  documentType: z.string().nullable(),
  documentNumber: z.string().min(1),
  delivery: z.string().nullable(),
  sender: z.string().nullable(),
  palletId: z.uuid().nullable(),
  palletCode: z.string().nullable(),
  address: z.string().nullable(),
  kind: z.enum(['ATUAL', 'FORA_DA_PRACA']),
});
export type CandidatoNota = z.infer<typeof CandidatoNotaSchema>;

export const DescricaoCaixaSchema = z.object({
  id: z.uuid(),
  group: z.string().min(1),
  description: z.string().min(1),
  createdAt: z.iso.datetime(),
  createdBy: UsuarioResumoSchema.nullable(),
});
export type DescricaoCaixa = z.infer<typeof DescricaoCaixaSchema>;

/** Vínculo documental do palete (detalhe do palete e busca por NF). */
export const DocumentoPaleteSchema = z.object({
  id: z.uuid(),
  documentType: z.string().nullable(),
  documentNumber: z.string().min(1),
  documentKey: z.string().min(1),
  delivery: z.string().nullable(),
  /** Volumes como informados (unidade abaixo); nunca convertidos em peças. `null` = pendente (desconhecido). */
  volumes: z.string().nullable(),
  volumesUnit: z.string().min(1),
  documentation: z.string().nullable(),
  palletFull: z.string().nullable(),
  state: z.enum(['ATIVO', 'ENCERRADO']),
  /** Conferência externa reconhecida no nível documental. */
  externalCount: z.boolean(),
  endedAt: z.iso.datetime().nullable(),
  endReason: z.string().nullable(),
  /** Endereço informado no inventário (alocação informada, não a atual). */
  informedAddress: z.string().nullable(),
  source: z.object({
    inventoryId: z.uuid(),
    inventoryCode: z.string().min(1),
    description: z.string().min(1),
    countReference: z.string().min(1),
    countDate: z.iso.date().nullable(),
    row: z.number().int().positive(),
    importedAt: z.iso.datetime(),
  }),
  /** Campos da nota mostrados ao operador (carga em lote). */
  identity: IdentidadeDocumentoSchema.nullable().default(null),
  /** NFD = nota de devolução; outro tipo (MI) ou tipo pendente não é chamado de NFD. */
  isNfd: z.boolean().default(false),
  sender: z.string().nullable().default(null),
  /** MÊS AGENDA e JANELA da linha de origem, como informados (manual ou agenda do cliente); `null` = não informado. */
  scheduleMonth: z.string().nullable().default(null),
  windowRef: z.string().nullable().default(null),
  /** Vazia = não informada (editável depois; nunca inferida do remetente). `version` 0 = ainda sem registro. */
  destinationCity: z.object({ value: z.string(), version: z.number().int().nonnegative() }).default({ value: '', version: 0 }),
  /** Produto na caixa: descrição livre do vínculo NF × palete e descrições por caixa/grupo. */
  productInBox: z
    .object({ value: z.string(), version: z.number().int().nonnegative(), boxes: z.array(DescricaoCaixaSchema) })
    .default({ value: '', version: 0, boxes: [] }),
  /** Volumes por linha de origem quando o vínculo agrupa linhas (volumes pendentes, não somados). */
  volumesByRow: z.array(z.object({ row: z.number().int().positive(), value: z.string().nullable(), text: z.string() })).default([]),
  /** Mesma NF em mais de um palete: indicação, quantidade declarada e demais locais. */
  multiplePallets: z
    .object({
      indicated: z.boolean(),
      /** Total de paletes declarado (marcador "01\\02" do inventário), quando conhecido. */
      declaredPallets: z.number().int().positive().nullable(),
      /** Partes do marcador neste endereço (ex.: [1, 2] em "01\\02 02\\02"). Não multiplicam volumes nem criam posições. */
      partsHere: z.array(z.number().int().positive()),
      others: z.array(LocalNotaSchema),
      /** Mesmo número em outro contexto documental (candidatos). */
      sameNumberElsewhere: z.array(CandidatoNotaSchema),
    })
    .default({ indicated: false, declaredPallets: null, partsHere: [], others: [], sameNumberElsewhere: [] }),
  /** Pendências do vínculo para tratar depois (texto para o operador). */
  pending: z.array(z.string()).default([]),
});
export type DocumentoPalete = z.infer<typeof DocumentoPaleteSchema>;

/** GET /paletes/:id/documentos */
export const DocumentosPaleteSchema = z.object({
  palletId: z.uuid(),
  items: z.array(DocumentoPaleteSchema),
  /** Linhas de inventário que citam este palete sem vínculo aplicado (pendências e referências históricas). */
  notApplied: z.array(
    z.object({ inventoryCode: z.string(), row: z.number().int().positive(), documentNumber: z.string().nullable(), action: AcaoLinhaInventarioSchema, reason: z.string().nullable() }),
  ),
  /** Palete full calculado dos vínculos ativos (e a fotografia importada, quando houver). */
  palletFull: z.object({ value: PaleteFullSchema, imported: PaleteFullSchema.nullable(), reason: z.string() }).default({ value: 'NAO_INFORMADO', imported: null, reason: 'Sem vínculos documentais.' }),
  /** Endereço completo informado no inventário e se a posição no mapa está pendente. */
  informedAddress: z.object({ address: z.string().min(1), mapPending: z.boolean(), inventoryCode: z.string().min(1) }).nullable().default(null),
  /** N° Pallet da planilha: referência externa (não é ID do palete; o mesmo número pode estar em outro endereço). */
  externalReferences: z.array(z.object({ value: z.string().min(1), inventoryCode: z.string().min(1), otherAddresses: z.array(z.string()) })).default([]),
  /** Linhas do inventário com conteúdo sem número de documento neste palete (não provam posição vazia). */
  contentWithoutDocument: z.array(z.object({ row: z.number().int().positive(), sender: z.string().nullable(), volumes: z.string().nullable(), inventoryCode: z.string() })).default([]),
});
export type DocumentosPalete = z.infer<typeof DocumentosPaleteSchema>;

const textoNota = (maximo: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(maximo).regex(/^[^\p{Cc}]*$/u, 'Caracteres inválidos.'));

/** PUT /paletes/:id/documentos/cidade-destino — vale para a NF (identidade) em todos os paletes. Vazio limpa. */
export const AlterarCidadeDestinoSchema = z.object({
  identity: IdentidadeDocumentoSchema,
  /** Versão vista (0 = ainda sem registro). */
  expectedVersion: z.number().int().nonnegative(),
  value: textoNota(120),
});
export type AlterarCidadeDestino = z.input<typeof AlterarCidadeDestinoSchema>;

/** PUT /paletes/:id/documentos/produto — produto na caixa do vínculo NF × palete. Vazio limpa. */
export const AlterarProdutoNaCaixaSchema = z.object({
  identity: IdentidadeDocumentoSchema,
  expectedVersion: z.number().int().nonnegative(),
  value: textoNota(500),
});
export type AlterarProdutoNaCaixa = z.input<typeof AlterarProdutoNaCaixaSchema>;

/** POST /paletes/:id/documentos/caixas — descrição de uma caixa ou grupo de caixas da NF neste palete. */
export const NovaDescricaoCaixaSchema = z.object({
  identity: IdentidadeDocumentoSchema,
  group: textoNota(60).pipe(z.string().min(1, 'Informe a caixa ou o grupo (ex.: Caixa 3).')),
  description: textoNota(300).pipe(z.string().min(1, 'Descreva o produto da caixa.')),
});
export type NovaDescricaoCaixa = z.input<typeof NovaDescricaoCaixaSchema>;

/** POST /paletes/:id/documentos/caixas/:descricaoId/retirar — retira com motivo (registro preservado). */
export const RetirarDescricaoCaixaSchema = z.object({
  reason: textoNota(300).pipe(z.string().min(3, 'Informe o motivo (3 caracteres ou mais).')),
});
export type RetirarDescricaoCaixa = z.input<typeof RetirarDescricaoCaixaSchema>;
