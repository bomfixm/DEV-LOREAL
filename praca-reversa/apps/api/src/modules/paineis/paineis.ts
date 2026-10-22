/**
 * Painel da operação (DHL) e painel do cliente: uma leitura consistente
 * (REPEATABLE READ, somente leitura) por consulta, no escopo da sessão.
 * Cards, listas e exportações usam as mesmas funções (base.ts, estoque.ts,
 * janelas.ts, historico.ts), então os totais coincidem com as linhas.
 *
 * Projeção do cliente: estoque (documento, Delivery, remetente, volumes,
 * full/misto, palete/endereço), janelas (meta, P, E, etapas) e histórico
 * permitido. Nunca: claims, valores, pendências internas, diferenças da meta
 * para revisão, excesso, motivos, autores/logins nem auditoria.
 */
import {
  progressoParaCliente,
  type Escopo,
  type EtapaSelecao,
  type FiltroPainel,
  type JanelaCliente,
  type JanelaPainel,
  type LinhasJanelaCliente,
  type PainelCliente,
  type PainelOperacao,
  type Permissao,
  type PorRua,
  type TarefaPainel,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { naoEncontrado } from '../../http/erros.js';
import { basePosicoes, claims, emFotografia, valores } from '../indicadores/consultas.js';
import { periodoAplicado, resolverPeriodo } from '../indicadores/periodo.js';
import { fusoDoEscopo } from '../janelas/leitura.js';
import { reconferenciaDe } from '../paletes/relogio.js';
import { SEM_ENDERECO, carregarBase, noEstoque, type BasePainel } from './base.js';
import { linhasEstoque, paginaEstoque, type EtapasDaJanela, type LinhaEstoqueInterna } from './estoque.js';
import { consultarHistorico, paginaHistorico, type ResultadoHistorico } from './historico.js';
import { CAMPOS_JANELA, metasDasJanelas, resumirJanela, somasDasJanelas, type JanelaLinha, type LinhasCalculadas } from './janelas.js';

const DIA_MS = 24 * 60 * 60 * 1000;
const LIMITE_TAREFAS = 25;

type JanelaResumida = JanelaPainel & {
  linhasCalculadas: LinhasCalculadas | null;
};

/** Rua: paletes e volumes (unidades distintas, nunca somadas entre si). */
function porRua(base: BasePainel): PorRua[] {
  const mapa = new Map<string, PorRua>();
  for (const p of base.paletes) {
    const rua = p.endereco === null ? SEM_ENDERECO : p.rua;
    const r = mapa.get(rua) ?? {
      street: rua,
      pallets: 0,
      volumes: 0,
      volumesUnknown: 0,
      contents: 0,
    };
    r.pallets += 1;
    for (const c of p.conteudos.filter(noEstoque)) {
      r.contents += 1;
      if (c.atual === null) r.volumesUnknown += 1;
      else r.volumes += c.atual;
    }
    mapa.set(rua, r);
  }
  // Ruas numeradas primeiro (Rua 11, Rua 12…), depois as demais áreas (ex.: Grade) e, por último, os paletes sem endereço confirmado.
  const grupo = (rua: string) => (rua === SEM_ENDERECO ? 2 : /^Rua\s*\d/i.test(rua) ? 0 : 1);
  return [...mapa.values()].sort((a, b) => grupo(a.street) - grupo(b.street) || a.street.localeCompare(b.street, 'pt-BR', { numeric: true }));
}

async function janelasDoEscopo(tx: Transacao, escopoId: string, base: BasePainel, onde: { situacoes?: string[] }): Promise<JanelaResumida[]> {
  const janelas: JanelaLinha[] = await tx.janelaDevolucao.findMany({
    where: {
      escopoId,
      ...(onde.situacoes ? { situacao: { in: onde.situacoes as JanelaLinha['situacao'][] } } : {}),
    },
    orderBy: [{ mesReferencia: 'desc' }, { numero: 'desc' }],
    take: 60,
    select: CAMPOS_JANELA,
  });
  const ids = janelas.map((j) => j.id);
  const [metas, somas] = [await metasDasJanelas(tx, escopoId, ids), await somasDasJanelas(tx, escopoId, ids)];
  const lista: JanelaResumida[] = [];
  for (const j of janelas) lista.push(await resumirJanela(tx, escopoId, j, metas.get(j.id), somas.get(j.id), base));
  return lista;
}

/** Próxima janela: aberta, com a saída mais próxima (sem data, por último). */
function proxima(janelas: readonly JanelaResumida[], agora: Date): JanelaResumida | null {
  const abertas = janelas.filter((j) => ['RASCUNHO', 'CONFIRMADA', 'PREPARACAO'].includes(j.situation) && (j.exitEnd === null || Date.parse(j.exitEnd) >= agora.getTime()));
  const data = (j: JanelaResumida) => Date.parse(j.exitStart ?? j.preparationDeadline ?? `${j.month}T00:00:00Z`);
  return [...abertas].sort((a, b) => data(a) - data(b))[0] ?? null;
}

const semLinhas = (j: JanelaResumida): JanelaPainel => {
  const { linhasCalculadas: _l, ...resto } = j;
  return resto;
};

// ---------- Operação (DHL) ----------

export async function painelOperacao(db: Banco, escopo: Escopo, permissoes: ReadonlySet<Permissao>, filtro: Pick<FiltroPainel, 'inicio' | 'fim'>, agora: Date): Promise<PainelOperacao> {
  return emFotografia(db, async (tx) => {
    const periodo = await resolverPeriodo(tx, escopo.id, { inicio: filtro.inicio, fim: filtro.fim }, agora);
    const base = await carregarBase(tx, escopo.id);
    const posBase = await basePosicoes(tx, escopo.id, periodo);
    const [pos] = await tx.$queryRaw<
      {
        ativas: bigint;
        ocupadas: bigint;
        livres: bigint;
        excluidas: bigint;
        total: bigint;
      }[]
    >`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE s.disponivel AND NOT s.desativada) AS ativas,
             count(*) FILTER (WHERE s.disponivel AND NOT s.desativada AND o.id IS NOT NULL) AS ocupadas,
             count(*) FILTER (WHERE s.disponivel AND NOT s.desativada AND o.id IS NULL AND s.livre_confirmada_em IS NOT NULL) AS livres,
             count(*) FILTER (WHERE NOT s.disponivel OR s.desativada) AS excluidas
        FROM posicao s JOIN layout l ON l.id = s.layout_id AND l.ativo
        LEFT JOIN palete o ON o.posicao_id = s.id
       WHERE s.escopo_id = ${escopo.id}::uuid AND s.retirada_em IS NULL`;
    const semPalete = await tx.$queryRaw<
      {
        id: string;
        linha: number;
        tipo: string | null;
        numero: string | null;
        endereco: string | null;
        codigo: string;
      }[]
    >`
      SELECT li.id::text, li.linha_arquivo AS linha, li.tipo_documento AS tipo, li.numero_documento AS numero, coalesce(li.endereco_canonico, li.endereco_lido) AS endereco, i.codigo
        FROM linha_inventario li JOIN inventario_referencia i ON i.id = li.inventario_id
       WHERE li.escopo_id = ${escopo.id}::uuid AND i.situacao = 'ATIVO' AND li.palete_id IS NULL AND NOT li.endereco_livre
         AND li.resolvida_por_id IS NULL AND li.acao::text = 'REQUER_RESOLUCAO'
       ORDER BY li.linha_arquivo`;
    const [expedidoTotal] = await tx.$queryRaw<{ e: bigint }[]>`
      SELECT coalesce(sum(volumes) FILTER (WHERE tipo = 'EXPEDICAO'), 0) - coalesce(sum(volumes) FILTER (WHERE tipo = 'ESTORNO_EXPEDICAO'), 0) AS e
        FROM evento_volumes_janela WHERE escopo_id = ${escopo.id}::uuid`;

    const conteudos = base.conteudos.filter(noEstoque);
    const reconf = base.paletes.map((p) => ({ p, r: reconferenciaDe(p, agora) })).filter((x) => x.r !== null);
    const vencidos = reconf.filter((x) => x.r?.due === true).sort((a, b) => Date.parse(a.r?.nextAt ?? '') - Date.parse(b.r?.nextAt ?? ''));
    const futuros = reconf.filter((x) => x.r?.due === false).map((x) => Date.parse(x.r?.nextAt ?? ''));
    const semEndereco = base.paletes.filter((p) => p.endereco === null);

    const todas = await janelasDoEscopo(tx, escopo.id, base, {});
    const doPeriodo = todas.filter((j) => j.situation !== 'CANCELADA' && j.month >= `${periodo.start.slice(0, 7)}-01` && j.month <= periodo.end);
    const prox = proxima(todas, agora);
    const separacao = todas.filter((j) => ['CONFIRMADA', 'PREPARACAO'].includes(j.situation) && (j.progress.missingToSeparate ?? 0) > 0);

    const tarefas: TarefaPainel[] = [
      ...vencidos.slice(0, LIMITE_TAREFAS).map((x): TarefaPainel => ({
        kind: 'RECONFERENCIA',
        label: `Reconferir ${x.p.codigo}`,
        detail: x.p.endereco ?? 'Sem endereço confirmado',
        palletId: x.p.id,
        palletCode: x.p.codigo,
        windowId: null,
        since: x.r?.nextAt ?? null,
      })),
      ...separacao.map((j): TarefaPainel => ({
        kind: 'SEPARACAO',
        label: `Separar ${String(j.progress.missingToSeparate ?? 0)} volume(s) — ${j.code}`,
        detail: j.name,
        palletId: null,
        palletCode: null,
        windowId: j.id,
        since: j.preparationDeadline,
      })),
      ...semEndereco.slice(0, LIMITE_TAREFAS).map((p): TarefaPainel => ({
        kind: 'LOCALIZACAO',
        label: `Localizar ${p.codigo}`,
        detail: p.posicaoCodigo === null ? 'Sem posição no mapa' : `Posição ${p.posicaoCodigo} sem endereço confirmado`,
        palletId: p.id,
        palletCode: p.codigo,
        windowId: null,
        since: null,
      })),
      ...semPalete.slice(0, LIMITE_TAREFAS).map((l): TarefaPainel => ({
        kind: 'NF_SEM_PALETE',
        label: `${l.tipo ?? 'Documento'} ${l.numero ?? 'sem número'} sem palete`,
        detail: `${l.codigo}, linha ${String(l.linha)}${l.endereco ? ` · informado: ${l.endereco}` : ''}`,
        palletId: null,
        palletCode: null,
        windowId: null,
        since: null,
      })),
    ];
    const identidades = new Set(conteudos.flatMap((c) => (c.identidade === null ? [] : [c.identidade])));
    const declarados = conteudos.filter((c) => c.declarado !== null);
    const contados = conteudos.filter((c) => c.contado !== null);
    const atuais = conteudos.filter((c) => c.atual !== null);
    const [primeiro] = await tx.$queryRaw<{ em: Date | null }[]>`SELECT min(criado_em) AS em FROM palete WHERE escopo_id = ${escopo.id}::uuid`;
    const temLayout = posBase.layout !== null;
    const ativas = Number(pos?.ativas ?? 0);
    const ocupadas = Number(pos?.ocupadas ?? 0);
    const livres = Number(pos?.livres ?? 0);
    return {
      scope: { id: escopo.id, name: escopo.name, demo: escopo.demo },
      consultedAt: agora.toISOString(),
      period: periodoAplicado(periodo),
      stock: {
        activePallets: base.paletes.length,
        palletsWithAddress: base.paletes.length - semEndereco.length,
        palletsWithoutAddress: semEndereco.length,
        contents: conteudos.length,
        documents: identidades.size,
        fullPallets: base.paletes.filter((p) => p.tipoPalete === 'FULL').length,
        mixedPallets: base.paletes.filter((p) => p.tipoPalete === 'MISTO').length,
        incomplete: {
          withoutDocument: conteudos.filter((c) => c.numero === null).length + base.paletes.filter((p) => p.semDocumento).length,
          withoutType: conteudos.filter((c) => c.numero !== null && c.tipo === null).length,
        },
        volumes: {
          informed: declarados.reduce((t, c) => t + (c.declarado ?? 0), 0),
          informedCoverage: {
            known: declarados.length,
            total: conteudos.length,
          },
          counted: contados.reduce((t, c) => t + (c.contado ?? 0), 0),
          countedCoverage: { known: contados.length, total: conteudos.length },
          current: atuais.reduce((t, c) => t + (c.atual ?? 0), 0),
          currentCoverage: { known: atuais.length, total: conteudos.length },
          shipped: Number(expedidoTotal?.e ?? 0),
        },
      },
      positions: temLayout
        ? {
            active: ativas,
            occupied: ocupadas,
            freeConfirmed: livres,
            unknown: ativas - ocupadas - livres,
            excluded: Number(pos?.excluidas ?? 0),
            provisional: posBase.provisional,
          }
        : null,
      location: {
        documentsWithoutPallet: semPalete.length,
        palletsWithoutAddress: semEndereco.length,
      },
      reconference: {
        due: vencidos.length,
        dueNext7Days: futuros.filter((t) => t - agora.getTime() <= 7 * DIA_MS).length,
        nextDueAt: futuros.length === 0 ? null : new Date(Math.min(...futuros)).toISOString(),
      },
      byStreet: porRua(base),
      windows: doPeriodo.map(semLinhas),
      nextWindow: prox === null ? null : semLinhas(prox),
      tasks: {
        items: tarefas,
        totals: {
          location: semEndereco.length,
          reconference: vencidos.length,
          separation: separacao.length,
          documentsWithoutPallet: semPalete.length,
        },
      },
      claims: permissoes.has('claim.consultar') ? await claims(tx, escopo.id, periodo) : null,
      values: permissoes.has('claim.consultar') ? await valores(tx, escopo.id, periodo) : null,
      historyFrom: primeiro?.em?.toISOString() ?? null,
    };
  });
}

// ---------- Estoque (lista dos cards; interna e do cliente) ----------

/** Etapas por conteúdo na janela filtrada: linhas da seleção vigente e conteúdos com registros na janela. */
async function etapasDaJanela(tx: Transacao, escopoId: string, janelaId: string, base: BasePainel, situacoes: string[] | null): Promise<EtapasDaJanela> {
  const j = await tx.janelaDevolucao.findFirst({
    where: {
      id: janelaId,
      escopoId,
      ...(situacoes ? { situacao: { in: situacoes as JanelaLinha['situacao'][] } } : {}),
    },
    select: CAMPOS_JANELA,
  });
  if (!j) throw naoEncontrado('Janela não encontrada neste escopo.');
  const [metas, somas] = [await metasDasJanelas(tx, escopoId, [janelaId]), await somasDasJanelas(tx, escopoId, [janelaId])];
  const r = await resumirJanela(tx, escopoId, j, metas.get(janelaId), somas.get(janelaId), base);
  const etapas: EtapasDaJanela = new Map();
  const ordem: EtapaSelecao[] = ['NAO_LOCALIZADA', 'LOCALIZADA', 'EM_SEPARACAO', 'SEPARADA', 'EXPEDIDA'];
  for (const l of r.linhasCalculadas?.linhas ?? []) {
    for (const c of r.linhasCalculadas?.conteudosPorLinha.get(l.lineId) ?? []) {
      const atual = etapas.get(c.id);
      if (atual === undefined || ordem.indexOf(l.stage) > ordem.indexOf(atual)) etapas.set(c.id, l.stage);
    }
  }
  for (const id of somas.get(janelaId)?.porAlvo.keys() ?? []) if (!etapas.has(id) && base.conteudoPorId.has(id)) etapas.set(id, 'EM_SEPARACAO');
  return etapas;
}

export const SITUACOES_CLIENTE = ['CONFIRMADA', 'PREPARACAO', 'ENCERRADA'];

export async function lerEstoque(db: Banco, escopo: Escopo, filtro: FiltroPainel, agora: Date, interno: boolean): Promise<{ linhas: LinhaEstoqueInterna[]; fuso: string }> {
  return emFotografia(db, async (tx) => {
    const base = await carregarBase(tx, escopo.id);
    const etapas = filtro.janela === undefined ? null : await etapasDaJanela(tx, escopo.id, filtro.janela, base, interno ? null : SITUACOES_CLIENTE);
    return {
      linhas: linhasEstoque(base, filtro, etapas, agora),
      fuso: await fusoDoEscopo(tx, escopo.id),
    };
  });
}

export async function estoquePaginado(db: Banco, escopo: Escopo, filtro: FiltroPainel, agora: Date, interno: boolean) {
  const { linhas, fuso } = await lerEstoque(db, escopo, filtro, agora, interno);
  return paginaEstoque(linhas, filtro.pagina, interno, agora, fuso);
}

// ---------- Histórico ----------

export async function lerHistorico(db: Banco, escopo: Escopo, filtro: FiltroPainel, agora: Date, todasPaginas: boolean): Promise<{ resultado: ResultadoHistorico; fuso: string }> {
  return emFotografia(db, async (tx) => {
    const base = await carregarBase(tx, escopo.id);
    if (filtro.janela !== undefined) {
      const j = await tx.janelaDevolucao.findFirst({
        where: { id: filtro.janela, escopoId: escopo.id },
        select: { id: true },
      });
      if (!j) throw naoEncontrado('Janela não encontrada neste escopo.');
    }
    return {
      resultado: await consultarHistorico(tx, escopo.id, filtro, base, agora, todasPaginas ? null : filtro.pagina),
      fuso: await fusoDoEscopo(tx, escopo.id),
    };
  });
}

export async function historicoPaginado(db: Banco, escopo: Escopo, filtro: FiltroPainel, agora: Date) {
  const { resultado, fuso } = await lerHistorico(db, escopo, filtro, agora, false);
  return paginaHistorico(resultado, filtro.pagina, agora, fuso);
}

// ---------- Cliente ----------

function janelaParaCliente(j: JanelaResumida): JanelaCliente {
  return {
    id: j.id,
    code: j.code,
    name: j.name,
    situation: j.situation,
    month: j.month,
    exitStart: j.exitStart,
    exitEnd: j.exitEnd,
    preparationDeadline: j.preparationDeadline,
    goal:
      j.goal === null
        ? null
        : {
            volumes: j.goal.volumes,
            reference: j.goal.reference,
            at: j.goal.at,
            selection:
              j.goal.selection === null
                ? null
                : {
                    orderRef: j.goal.selection.orderRef,
                    version: j.goal.selection.version,
                  },
          },
    progress: progressoParaCliente(j.progress),
    stages: j.stages,
  };
}

export async function painelCliente(db: Banco, escopo: Escopo, agora: Date): Promise<PainelCliente> {
  return emFotografia(db, async (tx) => {
    const base = await carregarBase(tx, escopo.id);
    const e = await tx.escopo.findUniqueOrThrow({
      where: { id: escopo.id },
      select: { cliente: { select: { nome: true } } },
    });
    const conteudos = base.conteudos.filter(noEstoque);
    const atuais = conteudos.filter((c) => c.atual !== null);
    const janelas = await janelasDoEscopo(tx, escopo.id, base, {
      situacoes: SITUACOES_CLIENTE,
    });
    const [primeiro] = await tx.$queryRaw<{ em: Date | null }[]>`SELECT min(criado_em) AS em FROM palete WHERE escopo_id = ${escopo.id}::uuid`;
    // Base provisória (convenção gravada na carga do inventário): o cliente vê o aviso, sem disponibilidade confirmada.
    const [validacao] = await tx.$queryRaw<{ base: string | null }[]>`
      SELECT convencoes ->> 'dataBase' AS base FROM inventario_referencia
       WHERE escopo_id = ${escopo.id}::uuid AND situacao = 'ATIVO' AND (convencoes ->> 'emValidacao')::boolean IS TRUE
       ORDER BY criado_em DESC LIMIT 1`;
    return {
      scope: {
        name: escopo.name,
        clientName: e.cliente.nome,
        demo: escopo.demo,
      },
      consultedAt: agora.toISOString(),
      timezone: await fusoDoEscopo(tx, escopo.id),
      stock: {
        pallets: base.paletes.length,
        documents: new Set(conteudos.flatMap((c) => (c.identidade === null ? [] : [c.identidade]))).size,
        contents: conteudos.length,
        fullPallets: base.paletes.filter((p) => p.tipoPalete === 'FULL').length,
        mixedPallets: base.paletes.filter((p) => p.tipoPalete === 'MISTO').length,
        locationUpdating: base.paletes.filter((p) => p.endereco === null).length,
        volumes: atuais.reduce((t, c) => t + (c.atual ?? 0), 0),
        volumesCoverage: { known: atuais.length, total: conteudos.length },
      },
      byStreet: porRua(base),
      windows: janelas.map(janelaParaCliente),
      historyFrom: primeiro?.em?.toISOString() ?? null,
      inventoryInValidation: validacao === undefined ? null : { baseDate: validacao.base },
    };
  });
}

export async function linhasJanelaCliente(db: Banco, escopo: Escopo, janelaId: string, agora: Date): Promise<LinhasJanelaCliente> {
  return emFotografia(db, async (tx) => {
    const j = await tx.janelaDevolucao.findFirst({
      where: {
        id: janelaId,
        escopoId: escopo.id,
        situacao: { in: SITUACOES_CLIENTE as JanelaLinha['situacao'][] },
      },
      select: CAMPOS_JANELA,
    });
    if (!j) throw naoEncontrado('Janela não encontrada.');
    const base = await carregarBase(tx, escopo.id);
    const [metas, somas] = [await metasDasJanelas(tx, escopo.id, [janelaId]), await somasDasJanelas(tx, escopo.id, [janelaId])];
    const r = await resumirJanela(tx, escopo.id, j, metas.get(janelaId), somas.get(janelaId), base);
    return {
      consultedAt: agora.toISOString(),
      window: janelaParaCliente(r),
      lines: (r.linhasCalculadas?.linhas ?? []).map((l) => {
        const { lineId: _id, ...resto } = l;
        return resto;
      }),
    };
  });
}
