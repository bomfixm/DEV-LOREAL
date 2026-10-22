import { z } from 'zod';
import { UsuarioResumoSchema } from './acesso.js';
import { FullMistoSchema } from './paineis.js';

/**
 * "Seleção cliente — teste" (pedido de 20 out. 2026): o responsável interno
 * simula o cliente consultando o estoque e montando uma solicitação para uma
 * agenda de saída. O estoque real é só lido; carrinho, solicitações, versões,
 * pedidos de alteração e respostas ficam em registros próprios do teste.
 * Nada aqui baixa, reserva ou movimenta estoque, nem altera agendas reais.
 *
 * Quantidades: o publicado (volumes do conteúdo apresentados no momento da
 * escolha), o solicitado (o que a pessoa pediu) e o expedido (fora deste teste)
 * são informações distintas. Quantidade desconhecida é `null` (nunca zero).
 */

export const TEXTO_AMBIENTE_TESTE = 'Ambiente de teste — não movimenta estoque';

/** Tipo do documento como a operação o reconhece: NF-e, Minuta e NFD continuam distintos. */
export function rotuloTipoDocumentoTeste(tipo: string | null): string {
  if (tipo === null || tipo.trim() === '') return 'Documento';
  const t = tipo.trim().toUpperCase();
  if (t === 'NF' || t === 'NFE' || t === 'NF-E') return 'NF-e';
  if (t === 'MI' || t === 'MINUTA') return 'Minuta';
  if (t === 'NFD') return 'NFD';
  return tipo.trim();
}

/** Full/misto em palavras comuns (sem termo técnico sem explicação). */
export const EXPLICACAO_TIPO_PALETE: Record<z.infer<typeof FullMistoSchema>, string> = {
  FULL: 'Palete full: todo o palete é de uma única nota.',
  MISTO: 'Palete misto: o palete tem mais de uma nota.',
  NAO_INFORMADO: 'Composição não informada: o cadastro não identifica todas as notas deste palete.',
};

// ---------- Estoque consultado (só leitura) ----------

export const RefConteudoTesteSchema = z.object({
  /** Vínculo NF × palete do inventário ou conteúdo registrado no palete. */
  kind: z.enum(['VINCULO', 'CONTEUDO']),
  id: z.uuid(),
});
export type RefConteudoTeste = z.infer<typeof RefConteudoTesteSchema>;

export const VolumesBaseTesteSchema = z.enum(['CONTADO', 'INFORMADO']);

export const ConteudoEstoqueTesteSchema = z.object({
  ref: RefConteudoTesteSchema,
  /** Código interno (NF, MI, NFD); o rótulo vem de `rotuloTipoDocumentoTeste`. */
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  delivery: z.string().nullable(),
  sender: z.string().nullable(),
  /** Volumes disponíveis informados (contados ou informados no inventário, menos o já expedido); `null` = não informado. */
  volumes: z.number().int().nonnegative().nullable(),
  volumesBasis: VolumesBaseTesteSchema.nullable(),
});
export type ConteudoEstoqueTeste = z.infer<typeof ConteudoEstoqueTesteSchema>;

export const PaleteEstoqueTesteSchema = z.object({
  palletId: z.uuid(),
  palletCode: z.string().min(1),
  palletType: FullMistoSchema,
  contents: z.array(ConteudoEstoqueTesteSchema),
  /** Soma dos volumes informados; `unknownContents` = conteúdos sem volumes informados (não entram na soma). */
  volumes: z.object({ known: z.number().int().nonnegative(), unknownContents: z.number().int().nonnegative() }),
  /** Conteúdos que correspondem à pesquisa (vazio sem pesquisa ou quando o próprio palete corresponde). */
  matches: z.array(RefConteudoTesteSchema),
});
export type PaleteEstoqueTeste = z.infer<typeof PaleteEstoqueTesteSchema>;

export const TAMANHO_PAGINA_TESTE = 25;

export const FiltroEstoqueTesteSchema = z.object({
  /** Palete, tipo e número do documento, remetente ou Delivery. */
  texto: z.string().trim().max(80, 'Pesquisa muito longa.').optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type FiltroEstoqueTeste = z.infer<typeof FiltroEstoqueTesteSchema>;

export const EstoqueTesteSchema = z.object({
  consultedAt: z.iso.datetime(),
  rows: z.array(PaleteEstoqueTesteSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type EstoqueTeste = z.infer<typeof EstoqueTesteSchema>;

export const ConteudoPaleteTesteSchema = ConteudoEstoqueTesteSchema.extend({
  /** "Mais informações" (só quando houver): CNPJ do remetente e produto/descrição. */
  cnpj: z.string().nullable(),
  description: z.string().nullable(),
});
export type ConteudoPaleteTeste = z.infer<typeof ConteudoPaleteTesteSchema>;

export const PaleteTesteSchema = z.object({
  consultedAt: z.iso.datetime(),
  palletId: z.uuid(),
  palletCode: z.string().min(1),
  palletType: FullMistoSchema,
  contents: z.array(ConteudoPaleteTesteSchema),
  moreInfo: z.object({
    /** Endereço físico confirmado ("15 - A120", "GR9"); `null` = em atualização. */
    address: z.string().nullable(),
    street: z.string().nullable(),
    /** Produtos com saldo validado neste palete (SKU); vazio = não há. */
    skus: z.array(z.object({ sku: z.string(), description: z.string(), lot: z.string().nullable() })),
  }),
});
export type PaleteTeste = z.infer<typeof PaleteTesteSchema>;

// ---------- Agendas de referência ----------

export const AgendaTesteSchema = z.discriminatedUnion('kind', [
  /** Janela de devolução existente: só referência (nada dela é alterado). */
  z.object({ kind: z.literal('JANELA'), windowId: z.uuid(), code: z.string(), name: z.string(), date: z.iso.date().nullable() }),
  /** Agenda identificada só neste teste (sem integração com o fluxo real). */
  z.object({ kind: z.literal('TESTE'), reference: z.string(), date: z.iso.date().nullable() }),
]);
export type AgendaTeste = z.infer<typeof AgendaTesteSchema>;

export const ListaAgendasTesteSchema = z.object({
  windows: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string(), status: z.string(), date: z.iso.date().nullable() })),
  testAgendas: z.array(z.object({ reference: z.string(), date: z.iso.date().nullable(), requests: z.number().int().nonnegative() })),
});
export type ListaAgendasTeste = z.infer<typeof ListaAgendasTesteSchema>;

const textoOpcional = (max: number, mensagem: string) =>
  z
    .string()
    .trim()
    .max(max, mensagem)
    .nullable()
    .transform((v) => (v === null || v === '' ? null : v));

export const NovaSolicitacaoTesteSchema = z.object({
  agenda: z.union([
    z.object({ windowId: z.uuid() }),
    z.object({
      reference: z.string().trim().min(2, 'Informe a referência da agenda (ex.: agenda de novembro).').max(120, 'Referência muito longa.'),
      date: z.iso.date('Data inválida.').nullable(),
    }),
  ]),
  note: textoOpcional(1000, 'Observação muito longa (máximo 1.000 caracteres).').optional(),
  /** Criar outra solicitação mesmo havendo um rascunho seu para a mesma agenda (solicitação adicional). */
  additional: z.boolean().optional(),
});
export type NovaSolicitacaoTeste = z.input<typeof NovaSolicitacaoTesteSchema>;

// ---------- Solicitação ----------

export const SituacaoSolicitacaoTesteSchema = z.enum(['RASCUNHO', 'ENVIADA', 'ALTERACAO_SOLICITADA', 'EM_REVISAO']);
export type SituacaoSolicitacaoTeste = z.infer<typeof SituacaoSolicitacaoTesteSchema>;
export const ROTULO_SITUACAO_SOLICITACAO_TESTE: Record<SituacaoSolicitacaoTeste, string> = {
  RASCUNHO: 'Carrinho (não enviada)',
  ENVIADA: 'Enviada',
  ALTERACAO_SOLICITADA: 'Alteração pedida',
  EM_REVISAO: 'Revisão autorizada',
};

export const SituacaoAlteracaoTesteSchema = z.enum(['PENDENTE', 'APROVADA', 'RECUSADA']);
export type SituacaoAlteracaoTeste = z.infer<typeof SituacaoAlteracaoTesteSchema>;
export const ROTULO_SITUACAO_ALTERACAO_TESTE: Record<SituacaoAlteracaoTeste, string> = {
  PENDENTE: 'Aguardando resposta',
  APROVADA: 'Aprovada',
  RECUSADA: 'Recusada',
};

/** O que foi apresentado à pessoa quando escolheu o item (preservado; nunca reescrito pelo estoque). */
export const ApresentadoTesteSchema = z.object({
  at: z.iso.datetime(),
  palletType: FullMistoSchema,
  /** Volumes do conteúdo (item de nota) ou soma dos volumes conhecidos (palete inteiro). */
  volumes: z.number().int().nonnegative().nullable(),
  volumesBasis: VolumesBaseTesteSchema.nullable(),
  /** Palete inteiro: as notas apresentadas. */
  contents: z.array(ConteudoEstoqueTesteSchema),
  /** Palete inteiro: conteúdos sem volumes informados. */
  unknownContents: z.number().int().nonnegative(),
});
export type ApresentadoTeste = z.infer<typeof ApresentadoTesteSchema>;

export const ItemSolicitacaoTesteSchema = z.object({
  id: z.uuid(),
  scope: z.enum(['PALETE', 'CONTEUDO']),
  palletId: z.uuid(),
  palletCode: z.string(),
  /** Nota escolhida (nula no palete inteiro). */
  content: ConteudoEstoqueTesteSchema.omit({ volumes: true, volumesBasis: true }).nullable(),
  presented: ApresentadoTesteSchema,
  /** Delivery pedida pelo cliente (pode não existir no cadastro: pertence só à solicitação). */
  requestedDelivery: z.string().nullable(),
  /** Volumes pedidos; `null` = sem quantidade definida (análise da operação). */
  requestedVolumes: z.number().int().positive().nullable(),
  needsAnalysis: z.boolean(),
  analysisReason: z.string().nullable(),
  /** Delivery pedida que não está discriminada no cadastro do conteúdo (a operação confere). */
  deliveryNotRegistered: z.boolean(),
  note: z.string().nullable(),
  /** O mesmo conteúdo/palete em outras solicitações da mesma agenda (aviso para conferência; não bloqueia). */
  otherRequests: z.array(z.object({ id: z.uuid(), code: z.string(), status: SituacaoSolicitacaoTesteSchema, detail: z.string() })),
});
export type ItemSolicitacaoTeste = z.infer<typeof ItemSolicitacaoTesteSchema>;

/** Item como enviado numa versão: o apresentado, o estoque conferido no envio e o solicitado. */
export const ItemVersaoTesteSchema = ItemSolicitacaoTesteSchema.omit({ otherRequests: true }).extend({
  atSend: z.object({ volumes: z.number().int().nonnegative().nullable(), volumesBasis: VolumesBaseTesteSchema.nullable() }),
});
export type ItemVersaoTeste = z.infer<typeof ItemVersaoTesteSchema>;

export const TotaisSolicitacaoTesteSchema = z.object({
  items: z.number().int().nonnegative(),
  pallets: z.number().int().nonnegative(),
  /** Soma só dos itens com quantidade definida (sem análise pendente). */
  definedVolumes: z.number().int().nonnegative(),
  itemsInAnalysis: z.number().int().nonnegative(),
});
export type TotaisSolicitacaoTeste = z.infer<typeof TotaisSolicitacaoTesteSchema>;

export const VersaoSolicitacaoTesteSchema = z.object({
  number: z.number().int().min(1),
  sentAt: z.iso.datetime(),
  sentBy: UsuarioResumoSchema,
  note: z.string().nullable(),
  totals: TotaisSolicitacaoTesteSchema,
  /** Pedido de alteração aprovado que originou esta versão (a partir da 2ª). */
  changeRequestId: z.uuid().nullable(),
  items: z.array(ItemVersaoTesteSchema),
});
export type VersaoSolicitacaoTeste = z.infer<typeof VersaoSolicitacaoTesteSchema>;

export const AlteracaoTesteSchema = z.object({
  id: z.uuid(),
  baseVersion: z.number().int().min(1),
  reason: z.string(),
  status: SituacaoAlteracaoTesteSchema,
  requestedBy: UsuarioResumoSchema,
  requestedAt: z.iso.datetime(),
  respondedBy: UsuarioResumoSchema.nullable(),
  respondedAt: z.iso.datetime().nullable(),
  response: z.string().nullable(),
  resultingVersion: z.number().int().min(1).nullable(),
});
export type AlteracaoTeste = z.infer<typeof AlteracaoTesteSchema>;

export const EventoSolicitacaoTesteSchema = z.object({
  at: z.iso.datetime(),
  by: UsuarioResumoSchema,
  text: z.string(),
});

export const SolicitacaoTesteSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  status: SituacaoSolicitacaoTesteSchema,
  /** Versão do registro (proteção contra edição desatualizada). */
  version: z.number().int().min(1),
  agenda: AgendaTesteSchema,
  note: z.string().nullable(),
  createdBy: UsuarioResumoSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  sentVersion: z.number().int().nonnegative(),
  items: z.array(ItemSolicitacaoTesteSchema),
  totals: TotaisSolicitacaoTesteSchema,
  versions: z.array(VersaoSolicitacaoTesteSchema),
  changeRequests: z.array(AlteracaoTesteSchema),
  history: z.array(EventoSolicitacaoTesteSchema),
  /** O que a pessoa da sessão pode fazer agora (o servidor confere de novo em cada ação). */
  can: z.object({ edit: z.boolean(), send: z.boolean(), requestChange: z.boolean(), respond: z.boolean() }),
});
export type SolicitacaoTeste = z.infer<typeof SolicitacaoTesteSchema>;

export const ResumoSolicitacaoTesteSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  status: SituacaoSolicitacaoTesteSchema,
  agenda: AgendaTesteSchema,
  createdBy: UsuarioResumoSchema,
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  sentVersion: z.number().int().nonnegative(),
  totals: TotaisSolicitacaoTesteSchema,
  pendingChange: z.boolean(),
  mine: z.boolean(),
});
export type ResumoSolicitacaoTeste = z.infer<typeof ResumoSolicitacaoTesteSchema>;

export const ListaSolicitacoesTesteSchema = z.object({ items: z.array(ResumoSolicitacaoTesteSchema) });
export type ListaSolicitacoesTeste = z.infer<typeof ListaSolicitacoesTesteSchema>;

// ---------- Mutações (todas com Idempotency-Key) ----------

const VersaoEsperadaSchema = z.number().int().min(1);
const DeliverySchema = z
  .string()
  .trim()
  .max(60, 'Delivery muito longa (máximo 60 caracteres).')
  .nullable()
  .transform((v) => (v === null || v === '' ? null : v));
const ObservacaoItemSchema = textoOpcional(500, 'Observação muito longa (máximo 500 caracteres).');
const VolumesPedidosSchema = z.number({ error: 'Informe a quantidade em volumes (número inteiro).' }).int('Use um número inteiro de volumes.').min(1, 'A quantidade mínima é 1 volume.').max(1_000_000).nullable();

export const AdicionarItensTesteSchema = z
  .object({
    expectedVersion: VersaoEsperadaSchema,
    palletId: z.uuid(),
    wholePallet: z.boolean(),
    /** Observação do palete inteiro. */
    note: ObservacaoItemSchema.optional(),
    contents: z
      .array(
        z.object({
          ref: RefConteudoTesteSchema,
          volumes: VolumesPedidosSchema,
          delivery: DeliverySchema,
          note: ObservacaoItemSchema,
        }),
      )
      .max(500)
      .default([]),
    /** Trocar o palete inteiro pelas notas escolhidas (ou as notas pelo palete inteiro), depois do aviso de conflito. */
    replace: z.boolean().default(false),
  })
  .refine((v) => v.wholePallet || v.contents.length > 0, { message: 'Escolha o palete inteiro ou ao menos uma nota.' });
export type AdicionarItensTeste = z.input<typeof AdicionarItensTesteSchema>;

export const AlterarItemTesteSchema = z.object({
  expectedVersion: VersaoEsperadaSchema,
  volumes: VolumesPedidosSchema.optional(),
  delivery: DeliverySchema.optional(),
  note: ObservacaoItemSchema.optional(),
});
export type AlterarItemTeste = z.input<typeof AlterarItemTesteSchema>;

export const VersaoTesteSchema = z.object({ expectedVersion: VersaoEsperadaSchema });
export type VersaoTeste = z.infer<typeof VersaoTesteSchema>;

export const AlterarSolicitacaoTesteSchema = z.object({
  expectedVersion: VersaoEsperadaSchema,
  note: textoOpcional(1000, 'Observação muito longa (máximo 1.000 caracteres).'),
});
export type AlterarSolicitacaoTeste = z.input<typeof AlterarSolicitacaoTesteSchema>;

export const AtualizarDadosTesteSchema = z.object({
  expectedVersion: VersaoEsperadaSchema,
  itemIds: z.array(z.uuid()).min(1).max(500),
});
export type AtualizarDadosTeste = z.infer<typeof AtualizarDadosTesteSchema>;

export const PedirAlteracaoTesteSchema = z.object({
  reason: z.string().trim().min(5, 'Explique o que precisa mudar (ao menos 5 caracteres). Ex.: "Faltou selecionar 10 notas".').max(1000, 'Explicação muito longa.'),
});
export type PedirAlteracaoTeste = z.infer<typeof PedirAlteracaoTesteSchema>;

export const ResponderAlteracaoTesteSchema = z.object({
  decision: z.enum(['APROVAR', 'RECUSAR']),
  response: z.string().trim().min(2, 'Registre a resposta para quem pediu.').max(1000, 'Resposta muito longa.'),
});
export type ResponderAlteracaoTeste = z.infer<typeof ResponderAlteracaoTesteSchema>;

// ---------- Conferência antes do envio ----------

export const DiferencaTesteSchema = z.object({
  itemId: z.uuid(),
  palletCode: z.string(),
  /** "NF-e 900123" (nulo no palete inteiro). */
  document: z.string().nullable(),
  /** O que mudou, em linguagem simples. */
  text: z.string(),
  before: z.string().nullable(),
  now: z.string().nullable(),
  /** O pedido não pode seguir assim (quantidade acima do agora disponível ou conteúdo fora do estoque). */
  blocking: z.boolean(),
  /** "Usar dados atuais" vale para este item (conteúdo ainda existe). */
  refreshable: z.boolean(),
});
export type DiferencaTeste = z.infer<typeof DiferencaTesteSchema>;

export const VerificacaoTesteSchema = z.object({
  checkedAt: z.iso.datetime(),
  differences: z.array(DiferencaTesteSchema),
});
export type VerificacaoTeste = z.infer<typeof VerificacaoTesteSchema>;
