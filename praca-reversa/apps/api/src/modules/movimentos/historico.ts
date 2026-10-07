/**
 * Leitura do histórico de movimentações: eventos de localização e de estoque
 * do palete, com correções vinculadas. Tudo restrito ao escopo ativo.
 */
import {
  compararQuantidades,
  normalizarQuantidade,
  somarQuantidades,
  subtrairQuantidades,
  type Escopo,
  type EventoLocalizacao,
  type HistoricoPalete,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { historicoDoPalete } from '../conferencia/leitura.js';
import { lerEventos } from '../estoque/saldo.js';

type Db = Banco | Transacao;

const pessoa = (u: { login: string; nome: string } | null) => (u ? { login: u.login, name: u.nome } : null);

const selecaoLocalizacao = {
  id: true,
  tipo: true,
  paleteId: true,
  palete: { select: { codigo: true } },
  posicaoOrigemId: true,
  posicaoOrigemCodigo: true,
  posicaoDestinoId: true,
  posicaoDestinoCodigo: true,
  motivo: true,
  ocorridoEm: true,
  versaoPaletePosterior: true,
  eventoCorrigidoId: true,
  autor: { select: { login: true, nome: true } },
  correcoes: { orderBy: { ocorridoEm: 'asc' as const }, select: { id: true, ocorridoEm: true } },
} as const satisfies Prisma.EventoLocalizacaoSelect;

type LocalizacaoSelecionada = Prisma.EventoLocalizacaoGetPayload<{ select: typeof selecaoLocalizacao }>;

function posicao(id: string | null, codigo: string | null) {
  return id !== null && codigo !== null ? { id, code: codigo } : null;
}

function eventoLocalizacao(e: LocalizacaoSelecionada): EventoLocalizacao {
  return {
    id: e.id,
    type: e.tipo,
    pallet: { id: e.paleteId, code: e.palete.codigo },
    from: posicao(e.posicaoOrigemId, e.posicaoOrigemCodigo),
    to: posicao(e.posicaoDestinoId, e.posicaoDestinoCodigo),
    reason: e.motivo,
    author: pessoa(e.autor),
    at: e.ocorridoEm.toISOString(),
    correctedEventId: e.eventoCorrigidoId,
  };
}

/** Um evento de localização do escopo (para a resposta das operações). */
export async function lerEventoLocalizacao(db: Db, escopoId: string, id: string): Promise<EventoLocalizacao> {
  return eventoLocalizacao(await db.eventoLocalizacao.findFirstOrThrow({ where: { id, escopoId }, select: selecaoLocalizacao }));
}

/**
 * Quantidade de uma transferência já devolvida por correções: soma das
 * baixas das correções no palete que recebeu a transferência original.
 */
export async function quantidadeCompensada(db: Db, eventoId: string, paleteQueRecebeu: string): Promise<string> {
  const soma = await db.linhaEventoEstoque.aggregate({
    where: { paleteId: paleteQueRecebeu, evento: { eventoCorrigidoId: eventoId } },
    _sum: { delta: true },
  });
  return normalizarQuantidade(subtrairQuantidades('0', soma._sum.delta?.toFixed() ?? '0'));
}

/**
 * Histórico do palete: localização (com o endereço do cadastro e o atual),
 * eventos de estoque em que foi origem ou destino (transferências com o que
 * ainda pode ser compensado) e conferências. `null` fora do escopo.
 */
export async function historicoPalete(db: Banco, escopo: Escopo, paleteId: string): Promise<HistoricoPalete | null> {
  const p = await db.palete.findFirst({
    where: { id: paleteId, escopoId: escopo.id },
    select: {
      id: true,
      codigo: true,
      versao: true,
      criadoEm: true,
      criadoPor: { select: { login: true, nome: true } },
      posicao: { select: { id: true, codigo: true } },
    },
  });
  if (!p) return null;
  const localizacoes = await db.eventoLocalizacao.findMany({
    where: { escopoId: escopo.id, paleteId },
    // A versão do palete avança a cada evento: ordem exata, mesmo com horários iguais.
    orderBy: { versaoPaletePosterior: 'desc' },
    take: 200,
    select: selecaoLocalizacao,
  });
  const eventos = await lerEventos(db, escopo.id, { paleteId }, 200);
  const transferencias = eventos.filter((e) => e.type === 'TRANSFERENCIA').map((e) => e.id);
  const correcoes = await db.eventoEstoque.findMany({
    where: { escopoId: escopo.id, eventoCorrigidoId: { in: transferencias } },
    orderBy: { ocorridoEm: 'asc' },
    select: { id: true, ocorridoEm: true, eventoCorrigidoId: true, paleteId: true, linhas: { select: { paleteId: true, delta: true } } },
  });
  const conferencias = await historicoDoPalete(db, escopo.id, paleteId);
  const maisAntigo = localizacoes.at(-1);
  return {
    pallet: {
      id: p.id,
      code: p.codigo,
      createdAt: p.criadoEm.toISOString(),
      createdBy: pessoa(p.criadoPor),
      initialPosition: maisAntigo ? posicao(maisAntigo.posicaoOrigemId, maisAntigo.posicaoOrigemCodigo) : p.posicao ? { id: p.posicao.id, code: p.posicao.codigo } : null,
      currentPosition: p.posicao ? { id: p.posicao.id, code: p.posicao.codigo } : null,
      version: p.versao,
    },
    locationEvents: localizacoes.map((e, i) => ({
      ...eventoLocalizacao(e),
      latest: i === 0,
      correctedBy: e.correcoes.map((c) => ({ id: c.id, at: c.ocorridoEm.toISOString() })),
    })),
    stockEvents: eventos.map((e) => {
      if (e.type !== 'TRANSFERENCIA' || e.destination === null) return { ...e, remainingCompensable: null, correctedBy: [] };
      const recebido = e.lines.find((l) => l.pallet.id === e.destination?.id)?.delta ?? '0';
      const destas = correcoes.filter((c) => c.eventoCorrigidoId === e.id);
      // Cada correção baixa no palete que recebeu a transferência original.
      const devolvido = somarQuantidades(destas.flatMap((c) => c.linhas.filter((l) => l.paleteId === e.destination?.id).map((l) => subtrairQuantidades('0', l.delta.toFixed()))));
      const restante = subtrairQuantidades(recebido, devolvido);
      return {
        ...e,
        remainingCompensable: compararQuantidades(restante, '0') < 0 ? '0' : restante,
        correctedBy: destas.map((c) => ({ id: c.id, at: c.ocorridoEm.toISOString() })),
      };
    }),
    sessions: conferencias.sessions,
  };
}
