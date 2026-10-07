/**
 * Seleção do cliente (complemento): consultas, conciliação, resolução de
 * identificação ambígua e encaminhamento à reserva da etapa 08.
 *
 * Importar e conciliar não alteram estoque. "Preparar para a janela" monta
 * uma proposta a partir das linhas elegíveis (material validado, liberado e
 * disponível); a confirmação revalida tudo no servidor (versão da seleção,
 * assinatura da conciliação das linhas, janela, liberação, disponível,
 * capacidade) e reserva pela mesma transação de `criarReserva` — integral ou
 * nada. Linhas com pendência continuam visíveis como não atendidas.
 */
import {
  ROTULOS_SITUACAO_CONCILIACAO,
  SITUACOES_CONCILIACAO,
  compararQuantidades,
  normalizarQuantidade,
  somarQuantidades,
  subtrairQuantidades,
  type Conciliacao,
  type ConfirmarPropostaSchema,
  type Escopo,
  type FiltroConciliacao,
  type FiltroSelecoes,
  type PaginaSelecoes,
  type PropostaJanela,
  type PropostaJanelaEntrada,
  type ResolverLinha,
  type AnularResolucao,
  type ResultadoConciliacao,
  type ResultadoProposta,
  type SelecaoDetalhe,
  type SelecaoResumo,
  type SituacaoConciliacao,
} from '@praca-reversa/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { jsonCanonico } from '../idempotencia/executar.js';
import { lerJanela } from '../janelas/leitura.js';
import { criarReserva, previaReserva } from '../janelas/reservas.js';
import { carregarBase, conciliarLinha, type BaseConciliacao, type LinhaSelecaoBase } from './conciliacao.js';

type Db = Banco | Transacao;
type DadosConfirmar = z.output<typeof ConfirmarPropostaSchema>;

export interface Autor {
  usuarioId: string;
  requestId: string;
}

const pessoa = (u: { login: string; nome: string } | null) => (u ? { login: u.login, name: u.nome } : null);

const selecaoSelect = {
  id: true,
  codigo: true,
  referenciaPedido: true,
  versaoPedido: true,
  rotuloVersao: true,
  modalidade: true,
  situacao: true,
  parametros: true,
  diferencas: true,
  totalLinhas: true,
  linhasExcluidas: true,
  substituiId: true,
  versao: true,
  criadoEm: true,
  inventarioId: true,
  loteImportacaoId: true,
  criadoPor: { select: { login: true, nome: true } },
  inventario: { select: { id: true, codigo: true, descricao: true } },
  loteImportacao: { select: { nomeArquivo: true } },
  substituidaPor: { select: { id: true } },
} as const satisfies Prisma.SelecaoClienteSelect;

type SelecaoLida = Prisma.SelecaoClienteGetPayload<{ select: typeof selecaoSelect }>;

interface ParametrosGravados {
  documentContext?: 'DOCUMENTO_INVENTARIO' | 'ORIGEM_DEVOLUCAO' | 'OUTRA_REFERENCIA';
  markValues?: string[];
  defaultDocumentType?: string | null;
  documentWithoutQuantity?: 'TODO_MATERIAL_DO_INVENTARIO' | 'PENDENTE';
  duplicates?: 'AGRUPAR_IDENTICAS' | 'MANTER_SEPARADAS' | null;
}

function parametrosDe(s: SelecaoLida): Required<ParametrosGravados> {
  const p = (s.parametros ?? {}) as ParametrosGravados;
  return {
    documentContext: p.documentContext ?? 'DOCUMENTO_INVENTARIO',
    markValues: p.markValues ?? [],
    defaultDocumentType: p.defaultDocumentType ?? null,
    documentWithoutQuantity: p.documentWithoutQuantity ?? 'PENDENTE',
    duplicates: p.duplicates ?? null,
  };
}

function resumo(s: SelecaoLida): SelecaoResumo {
  return {
    id: s.id,
    code: s.codigo,
    orderReference: s.referenciaPedido,
    orderVersion: s.versaoPedido,
    versionLabel: s.rotuloVersao,
    mode: s.modalidade,
    state: s.situacao,
    inventory: s.inventario ? { id: s.inventario.id, code: s.inventario.codigo, description: s.inventario.descricao } : null,
    documentContext: parametrosDe(s).documentContext,
    batchId: s.loteImportacaoId,
    fileName: s.loteImportacao.nomeArquivo,
    totalLines: s.totalLinhas,
    excludedLines: s.linhasExcluidas,
    replacesId: s.substituiId,
    replacedById: s.substituidaPor?.id ?? null,
    createdAt: s.criadoEm.toISOString(),
    createdBy: pessoa(s.criadoPor),
    version: s.versao,
  };
}

function detalhe(s: SelecaoLida): SelecaoDetalhe {
  const p = parametrosDe(s);
  return {
    ...resumo(s),
    parameters: { markValues: p.markValues, defaultDocumentType: p.defaultDocumentType, documentWithoutQuantity: p.documentWithoutQuantity, duplicates: p.duplicates },
    differences: (s.diferencas as SelecaoDetalhe['differences'] | null) ?? null,
  };
}

async function lerSelecaoBruta(db: Db, escopoId: string, id: string): Promise<SelecaoLida> {
  const s = await db.selecaoCliente.findFirst({ where: { id, escopoId }, select: selecaoSelect });
  if (!s) throw naoEncontrado('Seleção do cliente não encontrada neste escopo.');
  return s;
}

export async function listarSelecoes(db: Db, escopoId: string, filtro: FiltroSelecoes): Promise<PaginaSelecoes> {
  const [total, itens] = await Promise.all([
    db.selecaoCliente.count({ where: { escopoId } }),
    db.selecaoCliente.findMany({
      where: { escopoId },
      select: selecaoSelect,
      orderBy: [{ criadoEm: 'desc' }, { id: 'asc' }],
      skip: (filtro.pagina - 1) * filtro.tamanho,
      take: filtro.tamanho,
    }),
  ]);
  return { items: itens.map(resumo), total, page: filtro.pagina, pageSize: filtro.tamanho };
}

export async function lerSelecao(db: Db, escopoId: string, id: string): Promise<SelecaoDetalhe> {
  return detalhe(await lerSelecaoBruta(db, escopoId, id));
}

async function linhasDaSelecao(db: Db, escopoId: string, selecaoId: string): Promise<LinhaSelecaoBase[]> {
  const linhas = await db.linhaSelecao.findMany({
    where: { escopoId, selecaoId },
    orderBy: { linhaArquivo: 'asc' },
    include: { duplicadaDe: { select: { linhaArquivo: true } } },
  });
  return linhas.map((l) => ({
    id: l.id,
    linhaArquivo: l.linhaArquivo,
    referenciaLinha: l.referenciaLinha,
    abrangencia: l.abrangencia,
    regraAbrangencia: l.regraAbrangencia,
    paleteReferencia: l.paleteReferencia,
    tipoDocumento: l.tipoDocumento,
    numeroDocumento: l.numeroDocumento,
    chaveDocumento: l.chaveDocumento,
    delivery: l.delivery,
    referenciaInventario: l.referenciaInventario,
    janelaReferencia: l.janelaReferencia,
    sku: l.sku,
    lote: l.lote,
    quantidade: l.quantidade === null ? null : normalizarQuantidade(l.quantidade.toFixed()),
    unidade: l.unidade,
    observacao: l.observacao,
    duplicadaDeLinha: l.duplicadaDe?.linhaArquivo ?? null,
  }));
}

export interface ResultadoCompleto {
  selecao: SelecaoDetalhe;
  base: BaseConciliacao;
  itens: (ResultadoConciliacao & { paleteIds: string[]; segmentosElegiveis: { paleteId: string; segmentoId: string; disponivel: string }[] })[];
}

/** Concilia todas as linhas (sem paginação): usado na tela, nas exportações e na proposta. */
export async function conciliarTudo(db: Db, escopoId: string, selecaoId: string): Promise<ResultadoCompleto> {
  const s = await lerSelecaoBruta(db, escopoId, selecaoId);
  const linhas = await linhasDaSelecao(db, escopoId, selecaoId);
  const p = parametrosDe(s);
  const base = await carregarBase(
    db,
    escopoId,
    { id: s.id, inventarioId: s.inventarioId, referenciaPedido: s.referenciaPedido, parametros: { documentContext: p.documentContext, documentWithoutQuantity: p.documentWithoutQuantity, defaultDocumentType: p.defaultDocumentType } },
    linhas,
  );
  const principais = linhas.filter((l) => l.duplicadaDeLinha === null);
  const parciais = principais.map((l) => ({ l, r: conciliarLinha(l, base) }));
  // Conflito de demanda: duas solicitações apontando o mesmo material físico (não cria duas disponibilidades).
  const porPalete = new Map<string, { linha: number; codigo: string }[]>();
  for (const { l, r } of parciais) {
    for (const a of r.allocations) porPalete.set(a.pallet.id, [...(porPalete.get(a.pallet.id) ?? []), { linha: l.linhaArquivo, codigo: a.pallet.code }]);
  }
  const itens = parciais.map(({ l, r }) => {
    const internos = r.allocations.flatMap((a) =>
      (porPalete.get(a.pallet.id) ?? []).filter((x) => x.linha !== l.linhaArquivo).map((x) => ({ selectionCode: s.codigo, row: x.linha, palletCode: x.codigo })),
    );
    const externos = base.demandaExterna
      .filter(
        (d) =>
          (d.chaveDocumento !== null && l.chaveDocumento !== null && d.chaveDocumento === l.chaveDocumento) ||
          (d.paleteReferencia !== null && r.allocations.some((a) => a.pallet.code.toUpperCase() === (d.paleteReferencia ?? '').toUpperCase())),
      )
      .map((d) => ({ selectionCode: d.selecaoCodigo, row: d.linhaArquivo, palletCode: r.allocations[0]?.pallet.code ?? d.paleteReferencia ?? '' }));
    const conflitos = [...internos, ...externos];
    const reasons = conflitos.length > 0 && r.allocations.some((a) => a.material.length > 0) ? [...r.reasons, `Possível conflito de demanda com ${conflitos.map((c) => `${c.selectionCode} linha ${String(c.row)}`).join(', ')}: a reserva é única (etapa 08).`] : r.reasons;
    return { ...r, reasons, demandConflicts: conflitos };
  });
  return { selecao: detalhe(s), base, itens };
}

function assinaturaDe(itens: readonly ResultadoConciliacao[]): string {
  return createHash('sha256')
    .update(
      jsonCanonico(
        itens.map((i) => [
          i.lineId,
          i.situation,
          i.alsoSituations,
          i.allocations.map((a) => [a.pallet.id, a.pallet.version, a.currentPosition?.id ?? null, a.material.map((m) => [m.segmentId, m.validated, m.reserved, m.released, m.available, m.blocked])]),
          i.resolution?.palletId ?? null,
          i.resolution?.documentKey ?? null,
          i.forwarded,
        ]),
      ),
    )
    .digest('hex');
}

const PENDENCIAS: readonly SituacaoConciliacao[] = ['DOCUMENTO_SEM_PALETE', 'PALETE_SEM_ENDERECO', 'NAO_ENCONTRADO', 'AMBIGUO', 'APENAS_HISTORICO', 'QUANTIDADE_NAO_ATENDIDA', 'INFORMACAO_PENDENTE', 'LOCALIZADO_COM_RESTRICAO'];

export function ehPendencia(i: Pick<ResultadoConciliacao, 'situation' | 'alsoSituations'>): boolean {
  return [i.situation, ...i.alsoSituations].some((s) => PENDENCIAS.includes(s));
}

function basesConsultadas(base: BaseConciliacao): string[] {
  return [
    base.inventario ? `Inventário de referência ${base.inventario.codigo}${base.inventario.dataConferencia ? ` (conferência de ${base.inventario.dataConferencia.split('-').reverse().join('/')})` : ''}: alocação informada (fotografia).` : 'Sem inventário de referência: só os registros atuais.',
    'Vínculos documentais atuais NF × palete e posições atuais (alocação confirmada nos registros).',
    'Saldo validado por produto (palete × segmento), reservas ativas, liberação e bloqueios atuais.',
    'Documentos de devolução importados e expedições confirmadas (histórico de saída).',
  ];
}

export async function conciliar(db: Db, escopoId: string, selecaoId: string, filtro: FiltroConciliacao, agora: Date): Promise<Conciliacao> {
  const { selecao, base, itens } = await conciliarTudo(db, escopoId, selecaoId);
  const bySituation = Object.fromEntries(SITUACOES_CONCILIACAO.map((s) => [s, itens.filter((i) => i.situation === s || i.alsoSituations.includes(s)).length])) as Conciliacao['summary']['bySituation'];
  const documentos = new Set(itens.flatMap((i) => i.allocations.flatMap((a) => a.documents.map((d) => d.documentKey))));
  const paletes = new Set(itens.flatMap((i) => i.allocations.map((a) => a.pallet.id)));
  const termo = (filtro.texto ?? '').trim().toUpperCase();
  const filtrados = itens.filter((i) => {
    if (filtro.situacao.length > 0 && !filtro.situacao.some((s) => i.situation === s || i.alsoSituations.includes(s))) return false;
    if (termo === '') return true;
    return [i.request.palletRef, i.request.documentNumber, i.request.sku, i.request.delivery, i.lineRef, ...i.allocations.map((a) => a.pallet.code)].some((v) => v?.toUpperCase().includes(termo) === true);
  });
  const inicio = (filtro.pagina - 1) * filtro.tamanho;
  return {
    selection: selecao,
    consultedAt: agora.toISOString(),
    basis: basesConsultadas(base),
    signature: assinaturaDe(itens),
    summary: {
      requestedLines: itens.length,
      resolvedDocuments: documentos.size,
      distinctPallets: paletes.size,
      bySituation,
      eligibleLines: itens.filter((i) => i.eligible).length,
      pendingLines: itens.filter(ehPendencia).length,
    },
    items: filtrados.slice(inicio, inicio + filtro.tamanho).map(({ paleteIds: _p, segmentosElegiveis: _s, ...i }) => i),
    total: filtrados.length,
    page: filtro.pagina,
    pageSize: filtro.tamanho,
  };
}

// ---------- Resolução explícita ----------

async function bloquearSelecao(tx: Transacao, escopoId: string, id: string): Promise<{ versao: number; situacao: string; codigo: string }> {
  const [s] = await tx.$queryRaw<{ versao: number; situacao: string; codigo: string }[]>`
    SELECT versao, situacao::text AS situacao, codigo FROM selecao_cliente WHERE id = ${id}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!s) throw naoEncontrado('Seleção do cliente não encontrada neste escopo.');
  return s;
}

function exigirVersaoSelecao(atual: { versao: number; codigo: string }, esperada: number): void {
  if (atual.versao !== esperada) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `A seleção ${atual.codigo} mudou desde a sua revisão (resolução ou encaminhamento de outra pessoa). Recarregue e confira.`);
  }
}

export async function resolverLinha(tx: Transacao, escopo: Escopo, selecaoId: string, linhaId: string, dados: ResolverLinha, autor: Autor, agora: Date): Promise<SelecaoDetalhe> {
  const s = await bloquearSelecao(tx, escopo.id, selecaoId);
  exigirVersaoSelecao(s, dados.expectedVersion);
  if (s.situacao !== 'REGISTRADA') throw new ErroHttp(409, 'SITUACAO_INVALIDA', `A seleção ${s.codigo} foi substituída por outra versão: resolva na versão atual.`);
  const linha = await tx.linhaSelecao.findFirst({ where: { id: linhaId, selecaoId, escopoId: escopo.id }, select: { id: true, linhaArquivo: true } });
  if (!linha) throw naoEncontrado('Linha da seleção não encontrada.');
  // O candidato escolhido precisa estar entre os da conciliação atual (nada fora do que foi mostrado).
  const { itens } = await conciliarTudo(tx, escopo.id, selecaoId);
  const atual = itens.find((i) => i.lineId === linhaId);
  if (!atual) throw requisicaoInvalida('Linha agrupada por duplicidade: resolva a linha original.');
  if (atual.resolution !== null) throw new ErroHttp(409, 'CONFLITO', 'Esta linha já tem uma resolução: anule-a antes de escolher outra.');
  const valido = atual.candidates.some((c) => (dados.palletId === null || c.palletId === dados.palletId) && (dados.documentKey === null || c.documentKey === dados.documentKey) && (c.palletId !== null || c.documentKey !== null));
  if (!valido) throw requisicaoInvalida('Escolha um dos candidatos mostrados na conciliação desta linha.');
  if (dados.palletId !== null && !(await tx.palete.findFirst({ where: { id: dados.palletId, escopoId: escopo.id }, select: { id: true } }))) {
    throw naoEncontrado('Palete não encontrado neste escopo.');
  }
  await tx.resolucaoLinhaSelecao.create({
    data: { id: randomUUID(), escopoId: escopo.id, linhaSelecaoId: linhaId, paleteId: dados.palletId, chaveDocumento: dados.documentKey, motivo: dados.reason, autorId: autor.usuarioId, criadoEm: agora },
  });
  await tx.selecaoCliente.update({ where: { id: selecaoId }, data: { versao: { increment: 1 } } });
  await registrarEvento(tx, {
    acao: 'SELECAO_RESOLUCAO_REGISTRADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'LINHA_SELECAO',
    alvoId: linhaId,
    detalhes: { selecao: s.codigo, linha: linha.linhaArquivo, palete: dados.palletId, documento: dados.documentKey, motivo: dados.reason },
    requestId: autor.requestId,
  });
  return lerSelecao(tx, escopo.id, selecaoId);
}

export async function anularResolucao(tx: Transacao, escopo: Escopo, selecaoId: string, linhaId: string, dados: AnularResolucao, autor: Autor, agora: Date): Promise<SelecaoDetalhe> {
  const s = await bloquearSelecao(tx, escopo.id, selecaoId);
  exigirVersaoSelecao(s, dados.expectedVersion);
  const r = await tx.resolucaoLinhaSelecao.findFirst({ where: { escopoId: escopo.id, linhaSelecaoId: linhaId, anuladaEm: null, linhaSelecao: { selecaoId } }, select: { id: true } });
  if (!r) throw naoEncontrado('Nenhuma resolução ativa nesta linha.');
  await tx.resolucaoLinhaSelecao.update({ where: { id: r.id }, data: { anuladaEm: agora, anuladaPorId: autor.usuarioId, motivoAnulacao: dados.reason } });
  await tx.selecaoCliente.update({ where: { id: selecaoId }, data: { versao: { increment: 1 } } });
  await registrarEvento(tx, {
    acao: 'SELECAO_RESOLUCAO_ANULADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'LINHA_SELECAO',
    alvoId: linhaId,
    detalhes: { selecao: s.codigo, motivo: dados.reason },
    requestId: autor.requestId,
  });
  return lerSelecao(tx, escopo.id, selecaoId);
}

// ---------- Proposta para a janela e reserva ----------

interface ItemPlanejado {
  lineId: string;
  paleteId: string;
  segmentoId: string;
  quantidade: string;
}

/**
 * Distribui as linhas escolhidas sobre o material elegível, sem usar o mesmo
 * saldo duas vezes: linha/produto com quantidade pega até o que falta (já
 * descontado o reservado e o expedido por esta linha); NF/palete pegam todo o
 * disponível das origens correspondentes.
 */
function planejar(itens: ResultadoCompleto['itens'], linhas: readonly string[]): { planejados: ItemPlanejado[]; excluidas: PropostaJanela['excluded']; notas: Map<string, string[]> } {
  const usado = new Map<string, string>();
  const planejados: ItemPlanejado[] = [];
  const excluidas: PropostaJanela['excluded'] = [];
  const notas = new Map<string, string[]>();
  for (const id of linhas) {
    const i = itens.find((x) => x.lineId === id);
    if (!i) {
      excluidas.push({ lineId: id, row: 1, reason: 'Linha inexistente ou agrupada por duplicidade.' });
      continue;
    }
    if (!i.eligible) {
      excluidas.push({ lineId: id, row: i.row, reason: `${ROTULOS_SITUACAO_CONCILIACAO[i.situation]}: ${i.reasons[0] ?? 'sem material elegível'}` });
      continue;
    }
    let restante: string | null = null;
    if (i.request.quantity !== null && i.quantities.comparable) {
      restante = subtrairQuantidades(subtrairQuantidades(i.request.quantity, i.forwarded.reservedActive), i.forwarded.shipped);
      if (compararQuantidades(restante, '0') <= 0) {
        excluidas.push({ lineId: id, row: i.row, reason: 'Quantidade solicitada já encaminhada (reserva ativa ou expedida): nada a acrescentar.' });
        continue;
      }
    }
    const nota: string[] = [];
    for (const s of i.segmentosElegiveis) {
      const k = `${s.paleteId}:${s.segmentoId}`;
      const livre = subtrairQuantidades(s.disponivel, usado.get(k) ?? '0');
      if (compararQuantidades(livre, '0') <= 0) {
        nota.push('Parte do material já entrou nesta proposta por outra linha (não é contada duas vezes).');
        continue;
      }
      const q = restante === null ? livre : compararQuantidades(restante, livre) < 0 ? restante : livre;
      planejados.push({ lineId: id, paleteId: s.paleteId, segmentoId: s.segmentoId, quantidade: normalizarQuantidade(q) });
      usado.set(k, normalizarQuantidade(subtrairQuantidades(s.disponivel, subtrairQuantidades(livre, q))));
      if (restante !== null) {
        restante = subtrairQuantidades(restante, q);
        if (compararQuantidades(restante, '0') <= 0) break;
      }
    }
    if (!planejados.some((p) => p.lineId === id)) excluidas.push({ lineId: id, row: i.row, reason: 'Sem disponível livre nesta proposta.' });
    if (restante !== null && compararQuantidades(restante, '0') > 0) nota.push(`${normalizarQuantidade(restante)} ${i.request.unit ?? ''} continuam não atendidos pelos registros.`);
    notas.set(id, nota);
  }
  return { planejados, excluidas, notas };
}

function assinaturaProposta(selecaoVersao: number, janelaVersao: number, itens: readonly { lineId: string; paleteId: string; segmentoId: string; quantidade: string; versaoPalete: number }[]): string {
  return createHash('sha256')
    .update(jsonCanonico([selecaoVersao, janelaVersao, itens.map((i) => [i.lineId, i.paleteId, i.segmentoId, i.quantidade, i.versaoPalete])]))
    .digest('hex');
}

async function montar(db: Db, escopo: Escopo, selecaoId: string, janelaId: string, linhas: readonly string[]) {
  const s = await lerSelecaoBruta(db, escopo.id, selecaoId);
  if (s.situacao !== 'REGISTRADA') throw new ErroHttp(409, 'SITUACAO_INVALIDA', `A seleção ${s.codigo} foi substituída: prepare a janela pela versão atual.`);
  const tudo = await conciliarTudo(db, escopo.id, selecaoId);
  const janela = await lerJanela(db, escopo.id, janelaId);
  const { planejados, excluidas, notas } = planejar(tudo.itens, linhas);
  const versoes = new Map(tudo.itens.flatMap((i) => i.allocations.map((a) => [a.pallet.id, a.pallet.version] as const)));
  // Linhas da reserva: uma por palete × segmento (partes de linhas diferentes somadas sem duplicar material).
  const porMaterial = new Map<string, { paleteId: string; segmentoId: string; quantidade: string }>();
  for (const p of planejados) {
    const k = `${p.paleteId}:${p.segmentoId}`;
    const atual = porMaterial.get(k);
    porMaterial.set(k, { paleteId: p.paleteId, segmentoId: p.segmentoId, quantidade: atual ? normalizarQuantidade(somarQuantidades([atual.quantidade, p.quantidade])) : p.quantidade });
  }
  const assinatura = assinaturaProposta(
    s.versao,
    janela.versao,
    planejados.map((p) => ({ ...p, versaoPalete: versoes.get(p.paleteId) ?? 0 })),
  );
  return { s, tudo, janela, planejados, excluidas, notas, versoes, porMaterial, assinatura };
}

export async function proposta(db: Banco, escopo: Escopo, selecaoId: string, dados: PropostaJanelaEntrada): Promise<PropostaJanela> {
  const m = await montar(db, escopo, selecaoId, dados.windowId, dados.lineIds);
  const linhasReserva = [...m.porMaterial.values()].map((x) => ({ palletId: x.paleteId, segmentId: x.segmentoId, quantity: x.quantidade, expectedPalletVersion: m.versoes.get(x.paleteId) ?? 1 }));
  const reserva = linhasReserva.length === 0 ? null : await previaReserva(db, escopo, dados.windowId, { expectedWindowVersion: m.janela.versao, lines: linhasReserva, loadUnits: [] });
  const material = new Map(m.tudo.itens.flatMap((i) => i.allocations.flatMap((a) => a.material.map((x) => [`${a.pallet.id}:${x.segmentId}`, { a, x }] as const))));
  return {
    windowId: dados.windowId,
    windowCode: m.janela.codigo,
    windowVersion: m.janela.versao,
    selectionVersion: m.s.versao,
    signature: m.assinatura,
    items: m.planejados.map((p) => {
      const info = material.get(`${p.paleteId}:${p.segmentoId}`);
      return {
        lineId: p.lineId,
        palletId: p.paleteId,
        palletCode: info?.a.pallet.code ?? '',
        segmentId: p.segmentoId,
        sku: info?.x.sku ?? '',
        lot: info?.x.lot ?? null,
        quantity: p.quantidade,
        unit: info?.x.unit ?? '',
        expectedPalletVersion: m.versoes.get(p.paleteId) ?? 1,
        positionCode: info?.a.currentPosition?.code ?? null,
        address: info?.a.currentPosition?.address ?? null,
      };
    }),
    lines: dados.lineIds.flatMap((id) => {
      const i = m.tudo.itens.find((x) => x.lineId === id);
      if (!i || m.excluidas.some((e) => e.lineId === id)) return [];
      const proposto = m.planejados.filter((p) => p.lineId === id).reduce((t, p) => normalizarQuantidade(somarQuantidades([t, p.quantidade])), '0');
      const restante = i.request.quantity === null || !i.quantities.comparable ? null : subtrairQuantidades(subtrairQuantidades(subtrairQuantidades(i.request.quantity, i.forwarded.reservedActive), i.forwarded.shipped), proposto);
      return [
        {
          lineId: id,
          row: i.row,
          requested: i.request.quantity,
          proposed: proposto,
          unit: i.request.unit,
          unmet: restante !== null && compararQuantidades(restante, '0') > 0 ? normalizarQuantidade(restante) : null,
          notes: m.notas.get(id) ?? [],
        },
      ];
    }),
    excluded: m.excluidas,
    reservation: reserva,
  };
}

/** Confirma a proposta revisada: revalida tudo e reserva pela etapa 08, com os vínculos linha × reserva. */
export async function reservar(tx: Transacao, escopo: Escopo, selecaoId: string, dados: DadosConfirmar, autor: Autor, agora: Date): Promise<ResultadoProposta> {
  const travada = await bloquearSelecao(tx, escopo.id, selecaoId);
  exigirVersaoSelecao(travada, dados.expectedSelectionVersion);
  const m = await montar(tx, escopo, selecaoId, dados.windowId, dados.lineIds);
  if (m.assinatura !== dados.signature) {
    throw new ErroHttp(409, 'CONCILIACAO_DESATUALIZADA', 'Os registros mudaram desde a revisão da proposta (movimento, saldo, liberação, reserva ou resolução). Nada foi reservado: monte a proposta de novo.');
  }
  if (m.porMaterial.size === 0) throw new ErroHttp(409, 'MATERIAL_INELEGIVEL', 'Nenhuma linha escolhida tem material elegível: nada foi reservado.');
  const reserva = await criarReserva(
    tx,
    escopo,
    dados.windowId,
    {
      expectedWindowVersion: dados.expectedWindowVersion,
      lines: [...m.porMaterial.values()].map((x) => ({ palletId: x.paleteId, segmentId: x.segmentoId, quantity: x.quantidade, expectedPalletVersion: m.versoes.get(x.paleteId) ?? 1 })),
      loadUnits: dados.loadUnits,
      notes: dados.notes ?? `Seleção ${m.s.codigo} (pedido ${m.s.referenciaPedido}, versão ${String(m.s.versaoPedido)}).`,
    },
    autor,
    agora,
  );
  const linhasReserva = await tx.linhaReserva.findMany({ where: { reservaId: reserva.id }, select: { id: true, paleteId: true, segmentoId: true } });
  const porMaterial = new Map(linhasReserva.map((l) => [`${l.paleteId}:${l.segmentoId}`, l.id]));
  for (const p of m.planejados) {
    const linhaReservaId = porMaterial.get(`${p.paleteId}:${p.segmentoId}`);
    if (!linhaReservaId) throw new Error('Linha de reserva não encontrada para o material proposto.');
    await tx.vinculoSelecaoReserva.create({
      data: { id: randomUUID(), escopoId: escopo.id, selecaoId, linhaSelecaoId: p.lineId, reservaId: reserva.id, linhaReservaId, quantidade: p.quantidade, criadoPorId: autor.usuarioId, criadoEm: agora },
    });
  }
  await tx.selecaoCliente.update({ where: { id: selecaoId }, data: { versao: { increment: 1 } } });
  await registrarEvento(tx, {
    acao: 'SELECAO_ENCAMINHADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'SELECAO_CLIENTE',
    alvoId: selecaoId,
    detalhes: { selecao: m.s.codigo, reserva: reserva.code, janela: m.janela.codigo, linhas: new Set(m.planejados.map((p) => p.lineId)).size, foraDaProposta: m.excluidas.length },
    requestId: autor.requestId,
  });
  return { reservationId: reserva.id, reservationCode: reserva.code, windowId: dados.windowId, linkedLines: new Set(m.planejados.map((p) => p.lineId)).size };
}
