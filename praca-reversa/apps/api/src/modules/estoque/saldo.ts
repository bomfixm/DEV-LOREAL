/**
 * Estoque validado: segmentos, saldo por palete e eventos imutáveis. As
 * alterações acontecem só dentro da transação de quem chama (reconciliação,
 * transferência, correção e expedição), com os paletes envolvidos já
 * bloqueados.
 *
 * Etapa 08: a parte liberada para expedição nunca passa do saldo (quando o
 * saldo diminui, a liberação é limitada a ele: o não liberado sai primeiro) e
 * a entrada num palete chega pendente de liberação. Material vindo de palete
 * ou linha bloqueada chega bloqueado. O estado de liberação e de fluxo do
 * palete é um resumo recalculado na mesma transação.
 */
import {
  TIPOS_RECONCILIACAO,
  compararQuantidades,
  normalizarQuantidade,
  subtrairQuantidades,
  type EventoEstoque,
  type ItemSaldo,
  type TipoEventoEstoque,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp } from '../../http/erros.js';
import { chaveSegmento, type IdentidadeSegmento, type SaldoAtual } from '../conferencia/regras.js';

type Db = Banco | Transacao;

const selecaoSaldo = {
  quantidade: true,
  quantidadeReservada: true,
  quantidadeVinculada: true,
  quantidadeLiberada: true,
  bloqueioMotivo: true,
  bloqueadoEm: true,
  bloqueadoPor: { select: { login: true, nome: true } },
  segmento: {
    select: {
      id: true,
      chave: true,
      linhagem: true,
      produtoId: true,
      lote: true,
      origemTipo: true,
      origemReferencia: true,
      condicao: true,
      unidade: true,
      produto: { select: { sku: true, descricao: true } },
    },
  },
} as const;

/** Saldo validado atual do palete, com a identidade de cada segmento. */
export async function lerSaldoPalete(db: Db, escopoId: string, paleteId: string): Promise<SaldoAtual[]> {
  const linhas = await db.saldoEstoque.findMany({ where: { escopoId, paleteId }, select: selecaoSaldo });
  return linhas
    .map((l) => ({
      segmentoId: l.segmento.id,
      chave: l.segmento.chave,
      linhagem: l.segmento.linhagem,
      produtoId: l.segmento.produtoId,
      lote: l.segmento.lote,
      origemTipo: l.segmento.origemTipo,
      origemReferencia: l.segmento.origemReferencia,
      condicao: l.segmento.condicao,
      sku: l.segmento.produto.sku,
      descricao: l.segmento.produto.descricao,
      unidade: l.segmento.unidade,
      quantidade: l.quantidade.toFixed(),
      reservada: l.quantidadeReservada.toFixed(),
      vinculada: l.quantidadeVinculada.toFixed(),
      liberada: l.quantidadeLiberada.toFixed(),
      bloqueio: l.bloqueioMotivo === null || l.bloqueadoEm === null ? null : { motivo: l.bloqueioMotivo, em: l.bloqueadoEm, por: l.bloqueadoPor },
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku) || (a.lote ?? '').localeCompare(b.lote ?? '') || a.chave.localeCompare(b.chave));
}

export function itemSaldo(s: SaldoAtual): ItemSaldo {
  return {
    segmentId: s.segmentoId,
    productId: s.produtoId,
    sku: s.sku,
    description: s.descricao,
    lot: s.lote,
    originType: s.origemTipo,
    originReference: s.origemReferencia,
    condition: s.condicao,
    lineage: s.linhagem,
    quantity: s.quantidade,
    unit: s.unidade,
    reserved: s.reservada,
    claimLinked: s.vinculada,
    released: s.liberada ?? '0',
    blocked: s.bloqueio
      ? { reason: s.bloqueio.motivo, at: s.bloqueio.em.toISOString(), by: s.bloqueio.por ? { login: s.bloqueio.por.login, name: s.bloqueio.por.nome } : null }
      : null,
  };
}

/**
 * Recalcula o resumo de liberação e o fluxo dos paletes (funções SQL
 * resumo_liberacao_palete / resumo_fluxo_palete da migração da etapa 08).
 * Não muda a versão do palete: reserva e liberação não são conteúdo.
 */
export async function recalcularResumoPaletes(tx: Transacao, escopoId: string, paleteIds: readonly string[]): Promise<void> {
  if (paleteIds.length === 0) return;
  await tx.$executeRaw`
    UPDATE palete SET estado_liberacao = resumo_liberacao_palete(id), estado_fluxo = resumo_fluxo_palete(id)
     WHERE escopo_id = ${escopoId}::uuid AND id = ANY(${[...new Set(paleteIds)]}::uuid[])`;
}

/**
 * Bloqueia (FOR UPDATE) as linhas de saldo dos paletes, na ordem de ID, até o
 * fim da transação. Reservas concorrentes da mesma linha esperam e reavaliam
 * a própria condição depois da confirmação (READ COMMITTED do PostgreSQL).
 */
export async function bloquearSaldos(tx: Transacao, escopoId: string, paleteIds: readonly string[]): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM saldo_estoque
     WHERE escopo_id = ${escopoId}::uuid AND palete_id = ANY(${[...paleteIds]}::uuid[])
     ORDER BY palete_id, segmento_id
       FOR UPDATE`;
}

/**
 * Segmento com a identidade informada, criado se ainda não existir. A chave
 * única (escopo, chave) resolve criações concorrentes sem duplicar.
 */
export async function obterSegmento(
  tx: Transacao,
  escopoId: string,
  s: IdentidadeSegmento & { unidade: string; linhagem: string | null },
): Promise<string> {
  const chave = chaveSegmento(s);
  await tx.$executeRaw`
    INSERT INTO segmento_estoque (id, escopo_id, produto_id, lote, origem_tipo, origem_referencia, condicao, unidade, linhagem, chave)
    VALUES (${randomUUID()}::uuid, ${escopoId}::uuid, ${s.produtoId}::uuid, ${s.lote}, ${s.origemTipo}::"TipoOrigemDocumento",
            ${s.origemReferencia}, ${s.condicao}::"CondicaoMaterial", ${s.unidade}, ${s.linhagem}, ${chave})
    ON CONFLICT (escopo_id, chave) DO NOTHING`;
  const segmento = await tx.segmentoEstoque.findUniqueOrThrow({ where: { escopoId_chave: { escopoId, chave } }, select: { id: true } });
  return segmento.id;
}

/** Variação de um segmento num palete. `segmentoId` nulo: segmento novo (reconciliação). */
export interface LinhaAplicar extends IdentidadeSegmento {
  paleteId: string;
  segmentoId: string | null;
  linhagem: string | null;
  unidade: string;
  atual: string;
  alvo: string;
  delta: string;
}

export interface NovoEvento {
  escopoId: string;
  tipo: TipoEventoEstoque;
  /** Palete reconciliado, ou de onde a quantidade sai. */
  paleteId: string;
  /** Palete que recebe (transferência e correção). */
  paleteDestinoId: string | null;
  sessaoId: string | null;
  eventoCorrigidoId: string | null;
  motivo: string;
  autorId: string;
  agora: Date;
  linhas: readonly LinhaAplicar[];
  /** Expedição que origina a baixa (tipo EXPEDICAO). */
  expedicaoId?: string | null;
}

/**
 * Evento de estoque que deixou o saldo do palete na versão atual (último
 * evento em que ele foi principal ou destino), ou `null` se não houver.
 */
export async function eventoDaVersao(db: Db, escopoId: string, paleteId: string, versaoSaldo: number): Promise<string | null> {
  const [porVersao] = await db.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM evento_estoque
     WHERE escopo_id = ${escopoId}::uuid
       AND ((palete_id = ${paleteId}::uuid AND versao_saldo_posterior = ${versaoSaldo})
            OR (palete_destino_id = ${paleteId}::uuid AND versao_saldo_destino_posterior = ${versaoSaldo}))
     LIMIT 1`;
  if (porVersao) return porVersao.id;
  const ultimo = await db.eventoEstoque.findFirst({
    where: { escopoId, OR: [{ paleteId }, { paleteDestinoId: paleteId }] },
    orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  return ultimo?.id ?? null;
}

/**
 * Grava o evento e aplica as linhas no saldo, na transação de quem chama
 * (paletes e linhas de saldo já bloqueados). Segmento que vai a zero deixa de
 * ter linha de saldo (o evento guarda a passagem a zero). A versão de conteúdo
 * de cada palete envolvido avança uma vez. A ordem das linhas é a de
 * gravação: na transferência, a baixa na origem vem antes da entrada.
 */
export async function aplicarEvento(tx: Transacao, e: NovoEvento): Promise<{ eventoId: string; versoes: Map<string, number> }> {
  const ids = e.paleteDestinoId === null ? [e.paleteId] : [e.paleteId, e.paleteDestinoId];
  const paletes = await tx.palete.findMany({ where: { escopoId: e.escopoId, id: { in: ids } }, select: { id: true, versaoSaldo: true } });
  const versao = new Map(paletes.map((p) => [p.id, p.versaoSaldo]));
  const principal = versao.get(e.paleteId);
  const destino = e.paleteDestinoId === null ? null : versao.get(e.paleteDestinoId);
  if (principal === undefined || destino === undefined) throw new Error('Palete do evento não encontrado no escopo.');
  const eventoId = randomUUID();
  await tx.eventoEstoque.create({
    data: {
      id: eventoId,
      escopoId: e.escopoId,
      tipo: e.tipo,
      paleteId: e.paleteId,
      paleteDestinoId: e.paleteDestinoId,
      sessaoId: e.sessaoId,
      eventoCorrigidoId: e.eventoCorrigidoId,
      expedicaoId: e.expedicaoId ?? null,
      motivo: e.motivo,
      autorId: e.autorId,
      ocorridoEm: e.agora,
      eventoAnteriorId: await eventoDaVersao(tx, e.escopoId, e.paleteId, principal),
      versaoSaldoAnterior: principal,
      versaoSaldoPosterior: principal + 1,
      versaoSaldoDestinoAnterior: destino,
      versaoSaldoDestinoPosterior: destino === null ? null : destino + 1,
    },
  });
  // Bloqueios de origem (palete inteiro ou linha) acompanham o material que sai.
  const bloqueioOrigem = new Map<string, string>();
  if (e.paleteDestinoId !== null) {
    const origem = await tx.palete.findUniqueOrThrow({ where: { id: e.paleteId }, select: { codigo: true, bloqueioMotivo: true } });
    const linhasOrigem = await tx.saldoEstoque.findMany({ where: { paleteId: e.paleteId }, select: { segmentoId: true, bloqueioMotivo: true } });
    for (const l of linhasOrigem) {
      const motivo = l.bloqueioMotivo ?? origem.bloqueioMotivo;
      if (motivo !== null) bloqueioOrigem.set(l.segmentoId, `Herdado do palete ${origem.codigo}: ${motivo}`.slice(0, 500));
    }
  }
  for (const l of e.linhas) {
    if (!ids.includes(l.paleteId)) throw new Error('Linha de evento fora dos paletes do evento.');
    const segmentoId = l.segmentoId ?? (await obterSegmento(tx, e.escopoId, l));
    const anterior = await tx.saldoEstoque.findUnique({
      where: { paleteId_segmentoId: { paleteId: l.paleteId, segmentoId } },
      select: { quantidadeLiberada: true, bloqueioMotivo: true },
    });
    if (compararQuantidades(l.alvo, '0') === 0) {
      const removidas = await tx.saldoEstoque.deleteMany({ where: { paleteId: l.paleteId, segmentoId, quantidadeReservada: 0, quantidadeVinculada: 0 } });
      if (removidas.count !== 1) {
        throw new ErroHttp(409, 'CONFLITO_SALDO', 'O saldo mudou durante a operação (reserva ativa ou quantidade vinculada a claim). Recarregue e confira.');
      }
    } else {
      // A parte liberada nunca passa do saldo: quando o saldo diminui, o não liberado sai primeiro.
      await tx.$executeRaw`
        INSERT INTO saldo_estoque (id, escopo_id, palete_id, segmento_id, quantidade, atualizado_em)
        VALUES (${randomUUID()}::uuid, ${e.escopoId}::uuid, ${l.paleteId}::uuid, ${segmentoId}::uuid, ${l.alvo}::numeric, ${e.agora})
        ON CONFLICT (palete_id, segmento_id) DO UPDATE
           SET quantidade = EXCLUDED.quantidade,
               quantidade_liberada = LEAST(saldo_estoque.quantidade_liberada, EXCLUDED.quantidade),
               versao = saldo_estoque.versao + 1,
               atualizado_em = EXCLUDED.atualizado_em`;
    }
    const liberadaAntes = anterior?.quantidadeLiberada.toFixed() ?? '0';
    if (compararQuantidades(liberadaAntes, l.alvo) > 0) {
      await registrarLiberacaoAutomatica(tx, e, l.paleteId, segmentoId, 'AJUSTE_SALDO', {
        quantidade: subtrairQuantidades(liberadaAntes, l.alvo),
        antes: liberadaAntes,
        depois: l.alvo,
        motivo: `Saldo do material passou a ${normalizarQuantidade(l.alvo)}: a parte liberada foi limitada ao saldo (${e.tipo}).`,
        eventoId,
      });
    }
    const herdado = bloqueioOrigem.get(segmentoId);
    if (
      l.paleteId === e.paleteDestinoId &&
      compararQuantidades(l.delta, '0') > 0 &&
      herdado !== undefined &&
      (anterior?.bloqueioMotivo ?? null) === null
    ) {
      await tx.saldoEstoque.update({
        where: { paleteId_segmentoId: { paleteId: l.paleteId, segmentoId } },
        data: { bloqueioMotivo: herdado, bloqueadoEm: e.agora, bloqueadoPorId: e.autorId },
      });
      await registrarLiberacaoAutomatica(tx, e, l.paleteId, segmentoId, 'HERANCA_BLOQUEIO', { quantidade: null, antes: null, depois: null, motivo: herdado, eventoId });
    }
    await tx.linhaEventoEstoque.create({
      data: {
        escopoId: e.escopoId,
        eventoId,
        paleteId: l.paleteId,
        segmentoId,
        quantidadeAnterior: l.atual,
        delta: l.delta,
        quantidadePosterior: l.alvo,
      },
    });
  }
  for (const id of ids) await tx.palete.update({ where: { id }, data: { versaoSaldo: { increment: 1 } } });
  await recalcularResumoPaletes(tx, e.escopoId, ids);
  return { eventoId, versoes: new Map(ids.map((id) => [id, (versao.get(id) ?? 0) + 1])) };
}

async function registrarLiberacaoAutomatica(
  tx: Transacao,
  e: NovoEvento,
  paleteId: string,
  segmentoId: string,
  tipo: 'AJUSTE_SALDO' | 'HERANCA_BLOQUEIO',
  d: { quantidade: string | null; antes: string | null; depois: string | null; motivo: string; eventoId: string },
): Promise<void> {
  await tx.eventoLiberacao.create({
    data: {
      id: randomUUID(),
      escopoId: e.escopoId,
      paleteId,
      segmentoId,
      tipo,
      quantidade: d.quantidade,
      liberadaAnterior: d.antes,
      liberadaPosterior: d.depois,
      motivo: d.motivo,
      autorId: e.autorId,
      ocorridoEm: e.agora,
      eventoEstoqueId: d.eventoId,
    },
  });
}

const usuarioResumo = { select: { login: true, nome: true } } as const;
const paleteRef = { select: { id: true, codigo: true } } as const;

/**
 * Eventos de estoque (mais recentes primeiro), com as linhas. Com `paleteId`,
 * os eventos em que o palete foi principal ou destino.
 */
export async function lerEventos(
  db: Db,
  escopoId: string,
  filtro: { paleteId?: string; eventoId?: string; ids?: readonly string[] },
  limite = 100,
): Promise<EventoEstoque[]> {
  const eventos = await db.eventoEstoque.findMany({
    where: {
      escopoId,
      ...(filtro.paleteId ? { OR: [{ paleteId: filtro.paleteId }, { paleteDestinoId: filtro.paleteId }] } : {}),
      ...(filtro.eventoId ? { id: filtro.eventoId } : {}),
      ...(filtro.ids ? { id: { in: [...filtro.ids] } } : {}),
    },
    orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
    take: limite,
    select: {
      id: true,
      tipo: true,
      motivo: true,
      ocorridoEm: true,
      eventoAnteriorId: true,
      eventoCorrigidoId: true,
      palete: paleteRef,
      paleteDestino: paleteRef,
      autor: usuarioResumo,
      sessao: { select: { id: true, numero: true } },
      linhas: {
        select: {
          quantidadeAnterior: true,
          delta: true,
          quantidadePosterior: true,
          palete: paleteRef,
          segmento: {
            select: {
              id: true,
              chave: true,
              linhagem: true,
              produtoId: true,
              lote: true,
              origemTipo: true,
              origemReferencia: true,
              condicao: true,
              unidade: true,
              produto: { select: { sku: true, descricao: true } },
            },
          },
        },
      },
    },
  });
  return eventos.map((e) => ({
    id: e.id,
    type: e.tipo,
    pallet: { id: e.palete.id, code: e.palete.codigo },
    destination: e.paleteDestino ? { id: e.paleteDestino.id, code: e.paleteDestino.codigo } : null,
    session: e.sessao ? { id: e.sessao.id, number: e.sessao.numero } : null,
    reason: e.motivo,
    author: e.autor ? { login: e.autor.login, name: e.autor.nome } : null,
    at: e.ocorridoEm.toISOString(),
    previousEventId: e.eventoAnteriorId,
    correctedEventId: e.eventoCorrigidoId,
    lines: e.linhas
      .map((l) => ({
        pallet: { id: l.palete.id, code: l.palete.codigo },
        segmentId: l.segmento.id,
        segmentKey: l.segmento.chave,
        productId: l.segmento.produtoId,
        sku: l.segmento.produto.sku,
        description: l.segmento.produto.descricao,
        lot: l.segmento.lote,
        originType: l.segmento.origemTipo,
        originReference: l.segmento.origemReferencia,
        condition: l.segmento.condicao,
        lineage: l.segmento.linhagem,
        unit: l.segmento.unidade,
        before: l.quantidadeAnterior.toFixed(),
        delta: l.delta.toFixed(),
        after: l.quantidadePosterior.toFixed(),
      }))
      // Baixa (palete principal) antes da entrada; depois por SKU e segmento.
      .sort(
        (a, b) =>
          Number(a.pallet.id !== e.palete.id) - Number(b.pallet.id !== e.palete.id) || a.sku.localeCompare(b.sku) || a.segmentKey.localeCompare(b.segmentKey),
      ),
  }));
}

/** Última reconciliação do palete (SALDO_INICIAL ou AJUSTE_RECONCILIACAO). */
export async function ultimaReconciliacao(db: Db, escopoId: string, paleteId: string) {
  return db.eventoEstoque.findFirst({
    where: { escopoId, paleteId, tipo: { in: [...TIPOS_RECONCILIACAO] } },
    orderBy: [{ ocorridoEm: 'desc' }, { versaoSaldoPosterior: 'desc' }],
    select: { id: true, tipo: true, ocorridoEm: true, autor: usuarioResumo, sessao: { select: { id: true, numero: true } } },
  });
}

/** O palete já teve algum evento de estoque (como principal ou destino). */
export async function temEventoEstoque(db: Db, escopoId: string, paleteId: string): Promise<boolean> {
  return (await db.eventoEstoque.count({ where: { escopoId, OR: [{ paleteId }, { paleteDestinoId: paleteId }] }, take: 1 })) > 0;
}
