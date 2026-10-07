/**
 * Consultas das janelas, reservas, expedições, histórico e filas de material
 * (etapa 08). Tudo restrito ao escopo ativo: registro de outro escopo
 * responde como inexistente.
 */
import {
  ROTULOS_METRICA,
  SITUACOES_JANELA_OPERAVEIS,
  UNIDADES_METRICA,
  compararQuantidades,
  normalizarQuantidade,
  type CondicaoMaterial,
  type CriteriosJanela,
  type Escopo,
  type ExpedicaoDetalhe,
  type ExpedicaoResumo,
  type FiltroJanelas,
  type FiltroMaterial,
  type JanelaDetalhe,
  type JanelaResumo,
  type MaterialExpedicao,
  type PaginaHistoricoJanela,
  type PaginaJanelas,
  type PaginaMaterial,
  type ReservaDetalhe,
  type ReservaResumo,
  type RestricaoJanela,
  type Retorno,
  type TipoEventoJanela,
  type TipoOrigemDocumento,
  type VersaoRegras,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';
import { naoEncontrado } from '../../http/erros.js';
import { restante, type RestricaoRegra } from './capacidade.js';
import { disponivelParaReserva, elegivel, pendenciasDoMaterial, problemasParaExpedir, type CriteriosRegra, type MaterialRegra } from './regras.js';

type Db = Banco | Transacao;
const usuario = { select: { login: true, nome: true } } as const;
const pessoa = (u: { login: string; nome: string }) => ({ login: u.login, name: u.nome });
const q = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : normalizarQuantidade(d.toFixed()));
const qn = (d: Prisma.Decimal) => normalizarQuantidade(d.toFixed());
const mes = (d: Date) => d.toISOString().slice(0, 7);

export const selecaoJanela = {
  id: true,
  codigo: true,
  nome: true,
  referenciaCliente: true,
  mesReferencia: true,
  saidaInicio: true,
  saidaFim: true,
  prazoPreparacao: true,
  criteriosDefinidos: true,
  condicoesAceitas: true,
  origemQualquer: true,
  origensAceitas: true,
  exigeLote: true,
  exigeOrigem: true,
  documentosExigidos: true,
  criteriosObservacao: true,
  autorizacaoFonte: true,
  autorizacaoReferencia: true,
  autorizacaoData: true,
  autorizacaoResponsavel: true,
  observacoes: true,
  situacao: true,
  versao: true,
  versaoRegras: true,
  restricoes: { orderBy: { metrica: 'asc' } },
} as const satisfies Prisma.JanelaDevolucaoSelect;

export type JanelaLida = Prisma.JanelaDevolucaoGetPayload<{ select: typeof selecaoJanela }>;
type LinhaRestricao = JanelaLida['restricoes'][number];

export function criteriosDe(j: Pick<JanelaLida, 'criteriosDefinidos' | 'condicoesAceitas' | 'origemQualquer' | 'origensAceitas' | 'exigeLote' | 'exigeOrigem' | 'documentosExigidos' | 'criteriosObservacao'>): CriteriosJanela {
  return {
    defined: j.criteriosDefinidos,
    acceptedConditions: j.condicoesAceitas,
    acceptedOriginTypes: j.origemQualquer ? null : j.origensAceitas,
    requireLot: j.exigeLote,
    requireOrigin: j.exigeOrigem,
    requiredDocuments: j.documentosExigidos,
    notes: j.criteriosObservacao,
  };
}

export function criteriosRegra(c: CriteriosJanela): CriteriosRegra {
  return {
    definidos: c.defined,
    condicoes: c.acceptedConditions,
    origemQualquer: c.acceptedOriginTypes === null,
    origens: c.acceptedOriginTypes ?? [],
    exigeLote: c.requireLot,
    exigeOrigem: c.requireOrigin,
  };
}

export function restricaoRegra(r: LinhaRestricao): RestricaoRegra {
  return { id: r.id, metrica: r.metrica, unidade: r.unidade, basePeso: r.basePeso, limite: q(r.limite), reservado: qn(r.reservado), expedido: qn(r.expedido) };
}

export function restricaoDe(r: LinhaRestricao): RestricaoJanela {
  const regra = restricaoRegra(r);
  const rest = restante(regra);
  return {
    id: r.id,
    metric: r.metrica,
    unit: r.unidade,
    weightBase: r.basePeso,
    limit: regra.limite,
    reserved: regra.reservado,
    shipped: regra.expedido,
    remaining: rest,
    state: regra.limite === null ? 'PENDENTE' : rest !== null && compararQuantidades(rest, '0') <= 0 ? 'SEM_CAPACIDADE' : 'OK',
  };
}

export function unidadeDaMetrica(metrica: RestricaoRegra['metrica'], unidadeInformada: string | null | undefined): string {
  return metrica === 'QUANTIDADE' ? (unidadeInformada ?? '') : UNIDADES_METRICA[metrica];
}

/** Pendências que impedem reservar/expedir (texto operacional). */
export function pendenciasDaJanela(j: JanelaLida): string[] {
  const p: string[] = [];
  if (j.situacao === 'RASCUNHO') p.push('Rascunho: confirme a autorização do cliente para reservar.');
  if (j.saidaInicio === null) p.push('Data/horário de saída autorizado pendente.');
  if (j.autorizacaoFonte === null || j.autorizacaoReferencia === null || j.autorizacaoData === null || j.autorizacaoResponsavel === null) {
    p.push('Registro da autorização incompleto (fonte, referência, data e responsável).');
  }
  if (!j.criteriosDefinidos) p.push('Critérios de material aceito pendentes.');
  if (j.restricoes.length === 0) p.push('Nenhuma restrição de capacidade declarada: capacidade pendente (não é ilimitada).');
  for (const r of j.restricoes) {
    if (r.limite === null) p.push(`Limite de ${ROTULOS_METRICA[r.metrica].toLowerCase()} pendente (não é ilimitado).`);
  }
  return p;
}

function resumoJanela(j: JanelaLida, ativas: number, expedicoes: number): JanelaResumo {
  return {
    id: j.id,
    code: j.codigo,
    name: j.nome,
    clientReference: j.referenciaCliente,
    referenceMonth: mes(j.mesReferencia),
    state: j.situacao,
    exitStart: j.saidaInicio?.toISOString() ?? null,
    exitEnd: j.saidaFim?.toISOString() ?? null,
    preparationDeadline: j.prazoPreparacao?.toISOString() ?? null,
    restrictions: j.restricoes.map(restricaoDe),
    pendencies: j.situacao === 'ENCERRADA' || j.situacao === 'CANCELADA' ? [] : pendenciasDaJanela(j),
    activeReservations: ativas,
    expeditions: expedicoes,
    version: j.versao,
    rulesVersion: j.versaoRegras,
  };
}

async function contagens(db: Db, ids: readonly string[]) {
  const [ativas, expedicoes] = await Promise.all([
    db.reservaJanela.groupBy({ by: ['janelaId'], where: { janelaId: { in: [...ids] }, situacao: 'ATIVA' }, _count: { _all: true } }),
    db.expedicao.groupBy({ by: ['janelaId'], where: { janelaId: { in: [...ids] } }, _count: { _all: true } }),
  ]);
  return {
    ativas: new Map(ativas.map((a) => [a.janelaId, a._count._all])),
    expedicoes: new Map(expedicoes.map((a) => [a.janelaId, a._count._all])),
  };
}

export async function listarJanelas(db: Banco, escopo: Escopo, filtro: FiltroJanelas, agora: Date): Promise<PaginaJanelas> {
  const where: Prisma.JanelaDevolucaoWhereInput = {
    escopoId: escopo.id,
    ...(filtro.mes ? { mesReferencia: new Date(`${filtro.mes}-01T00:00:00Z`) } : {}),
    ...(filtro.situacao ? { situacao: filtro.situacao } : {}),
    ...(filtro.texto
      ? {
          OR: [
            { nome: { contains: filtro.texto, mode: 'insensitive' } },
            { codigo: { contains: filtro.texto, mode: 'insensitive' } },
            { referenciaCliente: { contains: filtro.texto, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [total, janelas] = await Promise.all([
    db.janelaDevolucao.count({ where }),
    db.janelaDevolucao.findMany({
      where,
      select: selecaoJanela,
      // Sem data: fim da lista do mês (nenhuma data é presumida).
      orderBy: [{ mesReferencia: 'asc' }, { saidaInicio: { sort: 'asc', nulls: 'last' } }, { numero: 'asc' }],
      skip: (filtro.pagina - 1) * filtro.tamanho,
      take: filtro.tamanho,
    }),
  ]);
  const c = await contagens(
    db,
    janelas.map((j) => j.id),
  );
  return {
    items: janelas.map((j) => resumoJanela(j, c.ativas.get(j.id) ?? 0, c.expedicoes.get(j.id) ?? 0)),
    total,
    page: filtro.pagina,
    pageSize: filtro.tamanho,
    consultedAt: agora.toISOString(),
  };
}

export async function lerJanela(db: Db, escopoId: string, id: string): Promise<JanelaLida> {
  const j = await db.janelaDevolucao.findFirst({ where: { id, escopoId }, select: selecaoJanela });
  if (!j) throw naoEncontrado('Janela não encontrada neste escopo.');
  return j;
}

function resumoReserva(r: {
  id: string;
  codigo: string;
  situacao: ReservaResumo['state'];
  consumoParcial: boolean;
  preparacao: ReservaResumo['preparation'];
  criadoEm: Date;
  criadoPor: { login: string; nome: string };
  linhas: { paleteId: string }[];
  metricas: { restricaoId: string; metrica: ReservaResumo['metrics'][number]['metric']; unidade: string; valor: Prisma.Decimal }[];
  expedicao: { id: string } | null;
}): ReservaResumo {
  return {
    id: r.id,
    code: r.codigo,
    state: r.situacao,
    partial: r.consumoParcial,
    preparation: r.preparacao,
    lineCount: r.linhas.length,
    palletCount: new Set(r.linhas.map((l) => l.paleteId)).size,
    metrics: r.metricas.map((m) => ({ restrictionId: m.restricaoId, metric: m.metrica, unit: m.unidade, value: qn(m.valor) })),
    createdAt: r.criadoEm.toISOString(),
    createdBy: pessoa(r.criadoPor),
    expeditionId: r.expedicao?.id ?? null,
  };
}

const selecaoResumoReserva = {
  id: true,
  codigo: true,
  situacao: true,
  consumoParcial: true,
  preparacao: true,
  criadoEm: true,
  criadoPor: usuario,
  linhas: { select: { paleteId: true } },
  metricas: { select: { restricaoId: true, metrica: true, unidade: true, valor: true } },
  expedicao: { select: { id: true } },
} as const satisfies Prisma.ReservaJanelaSelect;

const selecaoResumoExpedicao = {
  id: true,
  codigo: true,
  saidaEm: true,
  parcial: true,
  confirmadaEm: true,
  confirmadaPor: usuario,
  reserva: { select: { id: true, codigo: true } },
  _count: { select: { retornos: true } },
} as const satisfies Prisma.ExpedicaoSelect;

function resumoExpedicao(e: Prisma.ExpedicaoGetPayload<{ select: typeof selecaoResumoExpedicao }>): ExpedicaoResumo {
  return {
    id: e.id,
    code: e.codigo,
    reservationId: e.reserva.id,
    reservationCode: e.reserva.codigo,
    shippedAt: e.saidaEm.toISOString(),
    partial: e.parcial,
    confirmedBy: pessoa(e.confirmadaPor),
    confirmedAt: e.confirmadaEm.toISOString(),
    returns: e._count.retornos,
  };
}

function versaoRegras(v: { versao: number; criadoEm: Date; autor: { login: string; nome: string }; justificativa: string | null; fonte: string | null; fotografia: Prisma.JsonValue }): VersaoRegras {
  return {
    version: v.versao,
    at: v.criadoEm.toISOString(),
    by: pessoa(v.autor),
    justification: v.justificativa,
    source: v.fonte,
    snapshot: v.fotografia as VersaoRegras['snapshot'],
  };
}

export async function detalheJanela(db: Db, escopo: Escopo, id: string, agora: Date, fuso: string): Promise<JanelaDetalhe> {
  const j = await db.janelaDevolucao.findFirst({
    where: { id, escopoId: escopo.id },
    select: {
      ...selecaoJanela,
      criadoEm: true,
      atualizadoEm: true,
      criadoPor: usuario,
      confirmadaEm: true,
      confirmadaPor: usuario,
      encerradaEm: true,
      encerradaPor: usuario,
      motivoEncerramento: true,
      reservas: { select: selecaoResumoReserva, orderBy: { numero: 'desc' } },
      expedicoes: { select: selecaoResumoExpedicao, orderBy: { numero: 'desc' } },
      anexos: { select: { id: true, nome: true, tipoConteudo: true, tamanho: true, sha256: true, enviadoEm: true, enviadoPor: usuario }, orderBy: { enviadoEm: 'asc' } },
      versoes: { select: { versao: true, criadoEm: true, autor: usuario, justificativa: true, fonte: true, fotografia: true }, orderBy: { versao: 'desc' } },
    },
  });
  if (!j) throw naoEncontrado('Janela não encontrada neste escopo.');
  const ativas = j.reservas.filter((r) => r.situacao === 'ATIVA').length;
  return {
    ...resumoJanela(j, ativas, j.expedicoes.length),
    criteria: criteriosDe(j),
    authorization: {
      source: j.autorizacaoFonte,
      reference: j.autorizacaoReferencia,
      date: j.autorizacaoData?.toISOString().slice(0, 10) ?? null,
      responsible: j.autorizacaoResponsavel,
    },
    notes: j.observacoes,
    createdBy: pessoa(j.criadoPor),
    createdAt: j.criadoEm.toISOString(),
    updatedAt: j.atualizadoEm.toISOString(),
    confirmed: j.confirmadaEm && j.confirmadaPor ? { by: pessoa(j.confirmadaPor), at: j.confirmadaEm.toISOString() } : null,
    closure: j.encerradaEm && j.encerradaPor ? { by: pessoa(j.encerradaPor), at: j.encerradaEm.toISOString(), reason: j.motivoEncerramento ?? '' } : null,
    reservations: j.reservas.map(resumoReserva),
    expeditionsList: j.expedicoes.map(resumoExpedicao),
    attachments: j.anexos.map((a) => ({
      id: a.id,
      name: a.nome,
      contentType: a.tipoConteudo as JanelaDetalhe['attachments'][number]['contentType'],
      size: a.tamanho,
      sha256: a.sha256,
      uploadedAt: a.enviadoEm.toISOString(),
      uploadedBy: pessoa(a.enviadoPor),
    })),
    ruleVersions: j.versoes.map(versaoRegras),
    dataSource: escopo.demo ? 'DEMONSTRACAO_FICTICIA' : 'OPERACAO',
    timeZone: fuso,
    consultedAt: agora.toISOString(),
  };
}

/** Fuso da unidade do escopo (exibição); padrão America/Sao_Paulo. */
export async function fusoDoEscopo(db: Db, escopoId: string): Promise<string> {
  const [linha] = await db.$queryRaw<{ fuso: string }[]>`SELECT u.fuso FROM escopo e JOIN unidade u ON u.id = e.unidade_id WHERE e.id = ${escopoId}::uuid`;
  return linha?.fuso ?? 'America/Sao_Paulo';
}

// ---------- Material (saldo validado) ----------

export interface LinhaMaterial {
  palete_id: string;
  palete_codigo: string;
  palete_versao: number;
  arquivado: boolean;
  estado_fluxo: MaterialRegra['estadoFluxo'];
  estado_conferencia: MaterialRegra['estadoConferencia'];
  conferencia_ativa: boolean;
  palete_bloqueio: string | null;
  palete_bloqueio_login: string | null;
  palete_bloqueio_nome: string | null;
  posicao_id: string | null;
  posicao_codigo: string | null;
  segmento_id: string;
  produto_id: string;
  sku: string;
  descricao: string;
  lote: string | null;
  origem_tipo: TipoOrigemDocumento | null;
  origem_referencia: string | null;
  condicao: CondicaoMaterial;
  unidade: string;
  quantidade: string;
  reservada: string;
  liberada: string;
  vinculada: string;
  linha_bloqueio: string | null;
  linha_bloqueio_login: string | null;
  linha_bloqueio_nome: string | null;
  fifo: Date | null;
  data_documento: Date | null;
}

/** Saldo validado com tudo o que a elegibilidade usa. `paleteIds` restringe aos paletes informados. */
export async function lerMaterial(
  db: Db,
  escopoId: string,
  filtro: { texto?: string | undefined; condicao?: CondicaoMaterial | undefined; paleteIds?: readonly string[] | undefined; segmentoIds?: readonly string[] | undefined },
): Promise<LinhaMaterial[]> {
  const termo = (filtro.texto ?? '').trim().toLowerCase();
  const paletes = filtro.paleteIds ? [...filtro.paleteIds] : null;
  const segmentos = filtro.segmentoIds ? [...filtro.segmentoIds] : null;
  return db.$queryRaw<LinhaMaterial[]>`
    WITH entrada AS (
      SELECT l.segmento_id, min(e.ocorrido_em) AS fifo
        FROM linha_evento_estoque l JOIN evento_estoque e ON e.id = l.evento_id
       WHERE l.escopo_id = ${escopoId}::uuid AND l.delta > 0 AND e.tipo::text IN ('SALDO_INICIAL', 'AJUSTE_RECONCILIACAO')
       GROUP BY l.segmento_id
    )
    SELECT p.id::text AS palete_id, p.codigo AS palete_codigo, p.versao AS palete_versao, p.arquivado_em IS NOT NULL AS arquivado,
           p.estado_fluxo::text AS estado_fluxo, p.estado_conferencia::text AS estado_conferencia,
           EXISTS (SELECT 1 FROM sessao_conferencia c WHERE c.palete_id = p.id AND c.ativa) AS conferencia_ativa,
           p.bloqueio_motivo AS palete_bloqueio, ub.login AS palete_bloqueio_login, ub.nome AS palete_bloqueio_nome,
           p.posicao_id::text, pos.codigo AS posicao_codigo,
           sg.id::text AS segmento_id, sg.produto_id::text, pr.sku, pr.descricao, sg.lote, sg.origem_tipo::text AS origem_tipo, sg.origem_referencia,
           sg.condicao::text AS condicao, sg.unidade,
           s.quantidade::text, s.quantidade_reservada::text AS reservada, s.quantidade_liberada::text AS liberada, s.quantidade_vinculada::text AS vinculada,
           s.bloqueio_motivo AS linha_bloqueio, us.login AS linha_bloqueio_login, us.nome AS linha_bloqueio_nome,
           en.fifo,
           (SELECT min(ld.data_documento) FROM documento_devolucao d JOIN linha_documento_devolucao ld ON ld.documento_id = d.id
             WHERE d.escopo_id = ${escopoId}::uuid AND d.tipo = sg.origem_tipo AND d.referencia = sg.origem_referencia) AS data_documento
      FROM saldo_estoque s
      JOIN palete p ON p.id = s.palete_id
      JOIN segmento_estoque sg ON sg.id = s.segmento_id
      JOIN produto pr ON pr.id = sg.produto_id
      LEFT JOIN posicao pos ON pos.id = p.posicao_id
      LEFT JOIN usuario ub ON ub.id = p.bloqueado_por_id
      LEFT JOIN usuario us ON us.id = s.bloqueado_por_id
      LEFT JOIN entrada en ON en.segmento_id = s.segmento_id
     WHERE s.escopo_id = ${escopoId}::uuid AND p.arquivado_em IS NULL
       AND (${termo}::text = '' OR lower(pr.sku) LIKE '%' || ${termo}::text || '%' OR lower(p.codigo) LIKE '%' || ${termo}::text || '%'
            OR lower(coalesce(sg.lote, '')) LIKE '%' || ${termo}::text || '%' OR lower(pr.descricao) LIKE '%' || ${termo}::text || '%')
       AND (${filtro.condicao ?? null}::text IS NULL OR sg.condicao::text = ${filtro.condicao ?? null}::text)
       AND (${paletes}::uuid[] IS NULL OR s.palete_id = ANY(${paletes}::uuid[]))
       AND (${segmentos}::uuid[] IS NULL OR s.segmento_id = ANY(${segmentos}::uuid[]))
     ORDER BY en.fifo ASC NULLS LAST, p.codigo, pr.sku, sg.id`;
}

export function materialRegra(l: LinhaMaterial): MaterialRegra {
  return {
    paleteCodigo: l.palete_codigo,
    arquivado: l.arquivado,
    estadoFluxo: l.estado_fluxo,
    estadoConferencia: l.estado_conferencia,
    conferenciaAtiva: l.conferencia_ativa,
    paleteBloqueio: l.palete_bloqueio,
    linhaBloqueio: l.linha_bloqueio,
    quantidade: l.quantidade,
    reservada: l.reservada,
    liberada: l.liberada,
    vinculada: l.vinculada,
    condicao: l.condicao,
    lote: l.lote,
    origemTipo: l.origem_tipo,
    origemReferencia: l.origem_referencia,
  };
}

function itemMaterial(l: LinhaMaterial, criterios: CriteriosRegra | null): MaterialExpedicao {
  const regra = materialRegra(l);
  return {
    palletId: l.palete_id,
    palletCode: l.palete_codigo,
    palletVersion: l.palete_versao,
    positionId: l.posicao_id,
    positionCode: l.posicao_codigo,
    segmentId: l.segmento_id,
    productId: l.produto_id,
    sku: l.sku,
    description: l.descricao,
    lot: l.lote,
    originType: l.origem_tipo,
    originReference: l.origem_referencia,
    condition: l.condicao,
    unit: l.unidade,
    quantity: normalizarQuantidade(l.quantidade),
    reserved: normalizarQuantidade(l.reservada),
    released: normalizarQuantidade(l.liberada),
    claimLinked: normalizarQuantidade(l.vinculada),
    available: disponivelParaReserva(regra),
    fifoDate: l.fifo?.toISOString() ?? null,
    documentDate: l.data_documento?.toISOString().slice(0, 10) ?? null,
    pendencies: pendenciasDoMaterial(regra, criterios).map((p) => ({
      code: p.code,
      message: p.message,
      nextStep: p.nextStep,
      responsible:
        p.code === 'PALETE_BLOQUEADO' && l.palete_bloqueio_login && l.palete_bloqueio_nome
          ? { login: l.palete_bloqueio_login, name: l.palete_bloqueio_nome }
          : p.code === 'MATERIAL_BLOQUEADO' && l.linha_bloqueio_login && l.linha_bloqueio_nome
            ? { login: l.linha_bloqueio_login, name: l.linha_bloqueio_nome }
            : null,
    })),
  };
}

/**
 * Filas de material elegível e de pendências. Elegível: sem pendência que
 * bloqueie a linha e com disponível > 0 (FIFO pela primeira entrada física
 * validada; sem data, no fim — nenhuma idade é inventada). Pendências: linhas
 * com bloqueio, conferência pendente, critério da janela não atendido, parte
 * não liberada ou vinculada a claim.
 */
export async function filaMaterial(db: Banco, escopo: Escopo, filtro: FiltroMaterial, agora: Date): Promise<PaginaMaterial> {
  let criterios: CriteriosRegra | null = null;
  if (filtro.janela) criterios = criteriosRegra(criteriosDe(await lerJanela(db, escopo.id, filtro.janela)));
  const linhas = await lerMaterial(db, escopo.id, { texto: filtro.texto, condicao: filtro.condicao, paleteIds: filtro.palete ? [filtro.palete] : undefined });
  const itens = linhas.filter((l) => l.estado_fluxo !== 'EXPEDIDO');
  const selecionados =
    filtro.fila === 'ELEGIVEL'
      ? itens.filter((l) => elegivel(materialRegra(l), criterios))
      : itens.filter((l) => {
          const p = pendenciasDoMaterial(materialRegra(l), criterios);
          return p.length > 0;
        });
  const inicio = (filtro.pagina - 1) * filtro.tamanho;
  return {
    queue: filtro.fila,
    windowId: filtro.janela ?? null,
    items: selecionados.slice(inicio, inicio + filtro.tamanho).map((l) => itemMaterial(l, criterios)),
    total: selecionados.length,
    page: filtro.pagina,
    pageSize: filtro.tamanho,
    consultedAt: agora.toISOString(),
  };
}

// ---------- Reserva ----------

const selecaoReserva = {
  id: true,
  codigo: true,
  situacao: true,
  consumoParcial: true,
  versao: true,
  versaoRegras: true,
  fotografiaCriterios: true,
  observacoes: true,
  preparacao: true,
  preparadaEm: true,
  preparacaoResponsavel: usuario,
  preparacaoRegistradaPor: usuario,
  preparacaoRegistradaEm: true,
  preparacaoObservacoes: true,
  preparacaoDiferencas: true,
  criadoEm: true,
  criadoPor: usuario,
  encerradaEm: true,
  encerradaPor: usuario,
  motivoEncerramento: true,
  janela: { select: selecaoJanela },
  linhas: {
    orderBy: [{ paleteCodigo: 'asc' }, { sku: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      paleteId: true,
      segmentoId: true,
      quantidade: true,
      unidade: true,
      sku: true,
      descricao: true,
      lote: true,
      origemTipo: true,
      origemReferencia: true,
      condicao: true,
      paleteCodigo: true,
      posicaoCodigo: true,
      quantidadePreparada: true,
      quantidadeEnviada: true,
      quantidadeLiberada: true,
    },
  },
  unidadesCarga: {
    select: {
      paleteId: true,
      caixas: true,
      pesoKg: true,
      basePeso: true,
      volumeM3: true,
      fonteMedida: true,
      informadoEm: true,
      informadoPor: usuario,
      versao: true,
      palete: { select: { codigo: true } },
    },
  },
  metricas: { select: { restricaoId: true, metrica: true, unidade: true, valor: true, valorInicial: true, base: true } },
  expedicao: { select: selecaoResumoExpedicao },
} as const satisfies Prisma.ReservaJanelaSelect;

export type ReservaLida = Prisma.ReservaJanelaGetPayload<{ select: typeof selecaoReserva }>;

export async function lerReserva(db: Db, escopoId: string, id: string): Promise<ReservaLida> {
  const r = await db.reservaJanela.findFirst({ where: { id, escopoId }, select: selecaoReserva });
  if (!r) throw naoEncontrado('Reserva não encontrada neste escopo.');
  return r;
}

export async function detalheReserva(db: Db, escopo: Escopo, id: string, agora: Date): Promise<ReservaDetalhe> {
  const r = await lerReserva(db, escopo.id, id);
  const paleteIds = [...new Set(r.linhas.map((l) => l.paleteId))];
  const material = r.situacao === 'ATIVA' ? await lerMaterial(db, escopo.id, { paleteIds }) : [];
  const porChave = new Map(material.map((m) => [`${m.palete_id}:${m.segmento_id}`, m]));
  const paletes = await db.palete.findMany({
    where: { escopoId: escopo.id, id: { in: paleteIds } },
    select: { id: true, posicaoId: true, estadoFluxo: true, posicao: { select: { codigo: true } } },
  });
  const porPalete = new Map(paletes.map((p) => [p.id, p]));
  const criterios = criteriosRegra(criteriosDe(r.janela));
  const diferencas = Array.isArray(r.preparacaoDiferencas) ? r.preparacaoDiferencas.filter((d): d is string => typeof d === 'string') : [];
  return {
    id: r.id,
    code: r.codigo,
    window: {
      id: r.janela.id,
      code: r.janela.codigo,
      name: r.janela.nome,
      state: r.janela.situacao,
      version: r.janela.versao,
      exitStart: r.janela.saidaInicio?.toISOString() ?? null,
      exitEnd: r.janela.saidaFim?.toISOString() ?? null,
    },
    state: r.situacao,
    partial: r.consumoParcial,
    version: r.versao,
    rulesVersion: r.versaoRegras,
    criteriaSnapshot: (r.fotografiaCriterios as { criteria: CriteriosJanela }).criteria,
    lines: r.linhas.map((l) => {
      const p = porPalete.get(l.paleteId);
      const atual = porChave.get(`${l.paleteId}:${l.segmentoId}`);
      const problemas: string[] = [];
      if (r.situacao === 'ATIVA') {
        if (!atual) problemas.push('Saldo validado não encontrado neste palete: recarregue e confira.');
        else problemas.push(...problemasParaExpedir(materialRegra(atual), criterios));
      }
      return {
        id: l.id,
        palletId: l.paleteId,
        palletCode: l.paleteCodigo,
        snapshotPositionCode: l.posicaoCodigo,
        currentPositionId: p?.posicaoId ?? null,
        currentPositionCode: p?.posicao?.codigo ?? null,
        palletFlowState: p?.estadoFluxo ?? 'EM_ESTOQUE',
        segmentId: l.segmentoId,
        sku: l.sku,
        description: l.descricao,
        lot: l.lote,
        originType: l.origemTipo,
        originReference: l.origemReferencia,
        condition: l.condicao,
        unit: l.unidade,
        quantity: qn(l.quantidade),
        prepared: q(l.quantidadePreparada),
        shipped: q(l.quantidadeEnviada),
        releasedRemainder: q(l.quantidadeLiberada),
        currentProblems: problemas,
      };
    }),
    loadUnits: r.unidadesCarga
      .map((u) => ({
        palletId: u.paleteId,
        palletCode: u.palete.codigo,
        boxes: u.caixas === null ? null : String(u.caixas),
        weightKg: q(u.pesoKg),
        weightBase: u.basePeso,
        volumeM3: q(u.volumeM3),
        measurementSource: u.fonteMedida,
        informedBy: pessoa(u.informadoPor),
        informedAt: u.informadoEm.toISOString(),
        version: u.versao,
      }))
      .sort((a, b) => a.palletCode.localeCompare(b.palletCode)),
    metrics: r.metricas.map((m) => ({ restrictionId: m.restricaoId, metric: m.metrica, unit: m.unidade, value: qn(m.valor) })),
    windowMetrics: r.janela.restricoes.map(restricaoDe),
    preparation: {
      state: r.preparacao,
      preparedAt: r.preparadaEm?.toISOString() ?? null,
      responsible: r.preparacaoResponsavel ? pessoa(r.preparacaoResponsavel) : null,
      registeredBy: r.preparacaoRegistradaPor ? pessoa(r.preparacaoRegistradaPor) : null,
      registeredAt: r.preparacaoRegistradaEm?.toISOString() ?? null,
      notes: r.preparacaoObservacoes,
      differences: diferencas,
    },
    requiredDocuments: r.janela.documentosExigidos,
    notes: r.observacoes,
    createdBy: pessoa(r.criadoPor),
    createdAt: r.criadoEm.toISOString(),
    closure: r.encerradaEm && r.encerradaPor ? { by: pessoa(r.encerradaPor), at: r.encerradaEm.toISOString(), reason: r.motivoEncerramento ?? '' } : null,
    expedition: r.expedicao ? resumoExpedicao(r.expedicao) : null,
    dataSource: escopo.demo ? 'DEMONSTRACAO_FICTICIA' : 'OPERACAO',
    consultedAt: agora.toISOString(),
  };
}

// ---------- Expedição ----------

export async function detalheExpedicao(db: Db, escopo: Escopo, id: string): Promise<ExpedicaoDetalhe> {
  const e = await db.expedicao.findFirst({
    where: { id, escopoId: escopo.id },
    select: {
      id: true,
      codigo: true,
      saidaEm: true,
      parcial: true,
      confirmadaEm: true,
      observacoes: true,
      versao: true,
      responsavel: usuario,
      confirmadaPor: usuario,
      janela: { select: { id: true, codigo: true, nome: true } },
      reserva: { select: { id: true, codigo: true, situacao: true } },
      linhas: { orderBy: [{ paleteCodigo: 'asc' }, { sku: 'asc' }, { id: 'asc' }] },
      unidadesCarga: { orderBy: { paleteCodigo: 'asc' } },
      metricas: { orderBy: { metrica: 'asc' } },
      documentos: { orderBy: [{ versao: 'desc' }, { ordem: 'asc' }] },
      correcoes: { orderBy: { versao: 'asc' }, select: { criadoEm: true, autor: usuario, motivo: true, antes: true, depois: true } },
      eventosEstoque: { select: { id: true } },
      retornos: {
        orderBy: { numero: 'asc' },
        select: {
          id: true,
          codigo: true,
          tipo: true,
          recebidoEm: true,
          motivo: true,
          condicao: true,
          anexoIds: true,
          observacoes: true,
          criadoEm: true,
          registradoPor: usuario,
          paleteDestino: { select: { id: true, codigo: true } },
          linhas: { select: { linhaExpedicaoId: true, quantidade: true, linhaExpedicao: { select: { sku: true, lote: true, unidade: true } } } },
        },
      },
    },
  });
  if (!e) throw naoEncontrado('Expedição não encontrada neste escopo.');
  const versaoDocumentos = e.documentos[0]?.versao ?? null;
  return {
    id: e.id,
    code: e.codigo,
    window: { id: e.janela.id, code: e.janela.codigo, name: e.janela.nome },
    reservation: { id: e.reserva.id, code: e.reserva.codigo, state: e.reserva.situacao },
    shippedAt: e.saidaEm.toISOString(),
    responsible: pessoa(e.responsavel),
    confirmedBy: pessoa(e.confirmadaPor),
    confirmedAt: e.confirmadaEm.toISOString(),
    partial: e.parcial,
    lines: e.linhas.map((l) => ({
      id: l.id,
      reservationLineId: l.linhaReservaId,
      palletId: l.paleteId,
      palletCode: l.paleteCodigo,
      positionCodeAtExit: l.posicaoCodigo,
      segmentId: l.segmentoId,
      sku: l.sku,
      description: l.descricao,
      lot: l.lote,
      originType: l.origemTipo,
      originReference: l.origemReferencia,
      condition: l.condicao,
      unit: l.unidade,
      reserved: qn(l.quantidadeReservada),
      shipped: qn(l.quantidadeEnviada),
      releasedRemainder: qn(l.quantidadeLiberada),
      returned: qn(l.quantidadeRetornada),
    })),
    loadUnits: e.unidadesCarga.map((u) => ({
      palletId: u.paleteId,
      palletCode: u.paleteCodigo,
      boxes: u.caixas === null ? null : String(u.caixas),
      weightKg: q(u.pesoKg),
      weightBase: u.basePeso,
      volumeM3: q(u.volumeM3),
      measurementSource: u.fonteMedida,
      palletLeft: u.paleteSaiu,
    })),
    metrics: e.metricas.map((m) => ({ restrictionId: m.restricaoId, metric: m.metrica, unit: m.unidade, reserved: qn(m.valorReservado), shipped: qn(m.valorExpedido), released: qn(m.valorLiberado) })),
    documents: e.documentos.filter((d) => d.versao === versaoDocumentos).map((d) => ({ name: d.nome, reference: d.referencia, attachmentId: d.anexoId })),
    stockEventIds: e.eventosEstoque.map((x) => x.id),
    notes: e.observacoes,
    version: e.versao,
    corrections: e.correcoes.map((c) => ({ at: c.criadoEm.toISOString(), by: pessoa(c.autor), reason: c.motivo, before: c.antes, after: c.depois })),
    returns: e.retornos.map((r): Retorno => ({
      id: r.id,
      code: r.codigo,
      type: r.tipo,
      receivedAt: r.recebidoEm.toISOString(),
      reason: r.motivo,
      condition: r.condicao,
      destinationPallet: r.paleteDestino ? { id: r.paleteDestino.id, code: r.paleteDestino.codigo } : null,
      lines: r.linhas.map((l) => ({ expeditionLineId: l.linhaExpedicaoId, sku: l.linhaExpedicao.sku, lot: l.linhaExpedicao.lote, unit: l.linhaExpedicao.unidade, quantity: qn(l.quantidade) })),
      attachments: r.anexoIds,
      notes: r.observacoes,
      registeredBy: pessoa(r.registradoPor),
      registeredAt: r.criadoEm.toISOString(),
      nextStep:
        r.tipo === 'RECEBIMENTO_FISICO'
          ? `Conferir e reconciliar o palete ${r.paleteDestino?.codigo ?? ''}: a entrada no estoque acontece só pela reconciliação.`
          : 'Aviso documental não repõe saldo: aguarde o recebimento físico comprovado.',
    })),
    dataSource: escopo.demo ? 'DEMONSTRACAO_FICTICIA' : 'OPERACAO',
  };
}

// ---------- Histórico ----------

export async function historicoJanela(db: Banco, escopoId: string, id: string, pagina: number, tamanho: number): Promise<PaginaHistoricoJanela> {
  const janela = await db.janelaDevolucao.findFirst({ where: { id, escopoId }, select: { id: true } });
  if (!janela) throw naoEncontrado('Janela não encontrada neste escopo.');
  const where = { escopoId, janelaId: id };
  const [total, eventos] = await Promise.all([
    db.eventoJanela.count({ where }),
    db.eventoJanela.findMany({ where, orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }], skip: (pagina - 1) * tamanho, take: tamanho, include: { autor: usuario } }),
  ]);
  return {
    items: eventos.map((e) => ({
      id: e.id,
      type: e.tipo as TipoEventoJanela,
      at: e.ocorridoEm.toISOString(),
      by: pessoa(e.autor),
      summary: e.resumo,
      reservationId: e.reservaId,
      expeditionId: e.expedicaoId,
      returnId: e.retornoId,
      details: e.detalhes,
    })),
    total,
    page: pagina,
    pageSize: tamanho,
  };
}

/** A janela aceita reserva/expedição nesta situação. */
export const operavel = (s: JanelaLida['situacao']) => (SITUACOES_JANELA_OPERAVEIS as readonly string[]).includes(s);
