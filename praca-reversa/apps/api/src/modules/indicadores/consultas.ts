/**
 * Painel de indicadores (etapa 10; docs/INDICADORES.md). Calculado no
 * servidor, no escopo ativo, numa única transação REPEATABLE READ somente
 * leitura: todos os números vêm da mesma fotografia do banco. Cada área só é
 * calculada (e devolvida) quando o perfil tem a permissão de consulta dela.
 *
 * Regras que impedem números enganosos:
 * - palete e posição contam uma vez (contagens sobre `palete`/`posicao`, sem
 *   junção com conteúdo, documentos ou evidências);
 * - ocupação = posições elegíveis ocupadas ÷ posições elegíveis do layout
 *   ativo; indisponíveis, corredores e áreas desenhadas ficam à parte; sem
 *   elegíveis não há porcentagem;
 * - quantidades por unidade (nunca um total entre unidades), valores por moeda;
 * - fluxo do saldo validado pelos eventos de estoque: inicial + entradas −
 *   saídas + ajustes = final; transferências e correções somam zero no escopo;
 * - claims: candidato não é recuperação; estimativa não é valor evitado;
 *   resultados corrigidos/anulados ficam fora dos totais (histórico mantido).
 */
import {
  ROTULO_BASE_PROVISORIA,
  compararQuantidades,
  normalizarQuantidade,
  normalizarValor,
  somarQuantidades,
  subtrairQuantidades,
  type AreaIndicador,
  type BasePosicoes,
  type Escopo,
  type FiltroPeriodo,
  type FluxoUnidade,
  type Indicadores,
  type IndicadoresClaims,
  type IndicadoresConferencia,
  type IndicadoresEstoque,
  type IndicadoresIdade,
  type IndicadoresJanelas,
  type IndicadoresPraca,
  type IndicadoresValores,
  type Permissao,
  type QuantidadeUnidade,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ESTIMADO_CASO, PENDENCIA_SQL } from '../claims/leitura.js';
import { unidadeDaMetrica } from '../janelas/leitura.js';
import { periodoAplicado, resolverPeriodo, type Periodo } from './periodo.js';

const { sql } = Prisma;

/** Paletes que ocupam a praça agora (cada um uma vez). */
const NA_PRACA = sql`p.arquivado_em IS NULL AND p.estado_fluxo::text IN ('EM_ESTOQUE', 'RESERVADO')`;
/** Situações finais do claim (decisão documentada). */
const FINAIS = ['REGULARIZADO', 'PERDA_CONFIRMADA', 'ENCERRADO'];
/** Janelas listadas no painel (as mais próximas do período). */
const LIMITE_JANELAS = 12;

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const q = (v: string | null | undefined) => normalizarQuantidade(v ?? '0');

/** Leitura consistente e somente leitura para indicadores e relatórios. */
export async function emFotografia<T>(db: Banco, executar: (tx: Transacao) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return executar(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 60_000 },
  );
}

// ---------- Base de posições ----------

export async function basePosicoes(tx: Transacao, escopoId: string, periodo: Periodo): Promise<BasePosicoes> {
  const [l] = await tx.$queryRaw<{ nome: string; revisao: number; esquematico: boolean; capacidade_total: number | null; provisorios: bigint }[]>`
    SELECT l.nome, l.revisao, l.esquematico, l.capacidade_total,
           (SELECT count(*) FROM posicao p WHERE p.layout_id = l.id AND p.retirada_em IS NULL AND p.codigo_provisorio) AS provisorios
      FROM layout l WHERE l.escopo_id = ${escopoId}::uuid AND l.ativo ORDER BY l.criado_em DESC LIMIT 1`;
  const [mudancas] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM historico_layout h
     WHERE h.escopo_id = ${escopoId}::uuid AND h.ocorrido_em >= ${periodo.inicio} AND h.ocorrido_em < ${periodo.fim}`;
  const provisorios = n(l?.provisorios);
  // Desenho esquemático ou códigos provisórios: a configuração não foi validada contra a praça.
  const provisoria = !l || l.esquematico || provisorios > 0;
  return {
    label: provisoria ? ROTULO_BASE_PROVISORIA : `Base: posições cadastradas no layout ativo (revisão ${String(l.revisao)})`,
    provisional: provisoria,
    layout: l ? { name: l.nome, revision: l.revisao, schematic: l.esquematico, totalCapacity: l.capacidade_total, provisionalCodes: provisorios } : null,
    changesInPeriod: n(mudancas?.n),
  };
}

/** Uma casa decimal, arredondada (inteiros, sem ponto flutuante). */
export function porcentagem(parte: number, total: number): string | null {
  if (total <= 0) return null;
  const decimos = Math.floor((parte * 1000 + Math.floor(total / 2)) / total);
  return `${String(Math.floor(decimos / 10))}.${String(decimos % 10)}`;
}

async function praca(tx: Transacao, escopoId: string, periodo: Periodo, base: BasePosicoes): Promise<IndicadoresPraca> {
  const [p] = await tx.$queryRaw<{ total: bigint; reservados: bigint; com_posicao: bigint; sem_posicao: bigint }[]>`
    SELECT count(*) AS total, count(*) FILTER (WHERE p.estado_fluxo::text = 'RESERVADO') AS reservados,
           count(*) FILTER (WHERE p.posicao_id IS NOT NULL) AS com_posicao, count(*) FILTER (WHERE p.posicao_id IS NULL) AS sem_posicao
      FROM palete p WHERE p.escopo_id = ${escopoId}::uuid AND ${NA_PRACA}`;
  const [pos] = await tx.$queryRaw<{ cadastradas: bigint; elegiveis: bigint; ocupadas: bigint; indisponiveis: bigint; indisponiveis_ocupadas: bigint }[]>`
    SELECT count(*) AS cadastradas,
           count(*) FILTER (WHERE s.disponivel) AS elegiveis,
           count(*) FILTER (WHERE s.disponivel AND o.id IS NOT NULL) AS ocupadas,
           count(*) FILTER (WHERE NOT s.disponivel) AS indisponiveis,
           count(*) FILTER (WHERE NOT s.disponivel AND o.id IS NOT NULL) AS indisponiveis_ocupadas
      FROM posicao s
      JOIN layout l ON l.id = s.layout_id AND l.ativo
      LEFT JOIN palete o ON o.posicao_id = s.id
     WHERE s.escopo_id = ${escopoId}::uuid AND s.retirada_em IS NULL`;
  const areas = await tx.$queryRaw<{ tipo: string; n: bigint }[]>`
    SELECT e.tipo::text AS tipo, count(*) AS n FROM elemento_layout e JOIN layout l ON l.id = e.layout_id AND l.ativo
     WHERE e.escopo_id = ${escopoId}::uuid GROUP BY e.tipo`;
  const [per] = await tx.$queryRaw<{ cadastrados: bigint; movimentos: bigint; retirados: bigint; saidas: bigint }[]>`
    SELECT (SELECT count(*) FROM palete p WHERE p.escopo_id = ${escopoId}::uuid AND p.criado_em >= ${periodo.inicio} AND p.criado_em < ${periodo.fim}) AS cadastrados,
           count(*) FILTER (WHERE e.tipo::text IN ('MOVIMENTO', 'CORRECAO')) AS movimentos,
           count(*) FILTER (WHERE e.tipo::text = 'RETIRADA_VAZIO') AS retirados,
           count(*) FILTER (WHERE e.tipo::text = 'SAIDA_EXPEDICAO') AS saidas
      FROM evento_localizacao e WHERE e.escopo_id = ${escopoId}::uuid AND e.ocorrido_em >= ${periodo.inicio} AND e.ocorrido_em < ${periodo.fim}`;
  const temLayout = base.layout !== null;
  const elegiveis = n(pos?.elegiveis);
  const ocupadas = n(pos?.ocupadas);
  const porc = temLayout ? porcentagem(ocupadas, elegiveis) : null;
  const area = (tipo: string) => n(areas.find((a) => a.tipo === tipo)?.n);
  return {
    palletsInStock: n(p?.total),
    palletsReserved: n(p?.reservados),
    palletsWithPosition: n(p?.com_posicao),
    palletsLocationPending: n(p?.sem_posicao),
    positions: temLayout
      ? {
          registered: n(pos?.cadastradas),
          eligible: elegiveis,
          occupied: ocupadas,
          free: elegiveis - ocupadas,
          unavailable: n(pos?.indisponiveis),
          unavailableOccupied: n(pos?.indisponiveis_ocupadas),
        }
      : null,
    occupancyPercent: porc,
    occupancyNote: !temLayout
      ? 'Sem base para cálculo: escopo sem layout ativo.'
      : porc === null
        ? 'Sem base para cálculo: nenhuma posição elegível cadastrada.'
        : base.provisional
          ? 'Ocupação provisória sobre as posições cadastradas; não é a capacidade física definitiva.'
          : 'Ocupação sobre as posições elegíveis do layout ativo.',
    drawnAreas: temLayout ? { zones: area('ZONA'), blocks: area('BLOCO'), corridors: area('CORREDOR'), docks: area('DOCA') } : null,
    period: { registered: n(per?.cadastrados), moves: n(per?.movimentos), retiredEmpty: n(per?.retirados), shippedWhole: n(per?.saidas) },
  };
}

async function conferencia(tx: Transacao, escopoId: string, periodo: Periodo): Promise<IndicadoresConferencia> {
  const estados = await tx.$queryRaw<{ estado: string; n: bigint }[]>`
    SELECT p.estado_conferencia::text AS estado, count(*) AS n FROM palete p WHERE p.escopo_id = ${escopoId}::uuid AND ${NA_PRACA} GROUP BY 1`;
  const [s] = await tx.$queryRaw<{ ativas: bigint; pendentes: bigint; iniciadas: bigint; concluidas: bigint; reconciliadas: bigint; recontagens: bigint; canceladas: bigint }[]>`
    SELECT count(*) FILTER (WHERE c.ativa) AS ativas,
           (SELECT count(*) FROM observacao_conferencia o JOIN sessao_conferencia so ON so.id = o.sessao_id
             WHERE o.escopo_id = ${escopoId}::uuid AND o.removida_em IS NULL AND o.pendencia IS NOT NULL
               AND so.situacao::text IN ('EM_ANDAMENTO', 'CONCLUIDA')) AS pendentes,
           count(*) FILTER (WHERE c.iniciada_em >= ${periodo.inicio} AND c.iniciada_em < ${periodo.fim}) AS iniciadas,
           count(*) FILTER (WHERE c.concluida_em >= ${periodo.inicio} AND c.concluida_em < ${periodo.fim}) AS concluidas,
           count(*) FILTER (WHERE c.reconciliada_em >= ${periodo.inicio} AND c.reconciliada_em < ${periodo.fim}) AS reconciliadas,
           count(*) FILTER (WHERE c.motivo::text = 'RECONTAGEM' AND c.iniciada_em >= ${periodo.inicio} AND c.iniciada_em < ${periodo.fim}) AS recontagens,
           count(*) FILTER (WHERE c.cancelada_em >= ${periodo.inicio} AND c.cancelada_em < ${periodo.fim}) AS canceladas
      FROM sessao_conferencia c WHERE c.escopo_id = ${escopoId}::uuid`;
  const de = (e: string) => n(estados.find((x) => x.estado === e)?.n);
  return {
    byState: { NAO_CONFERIDO: de('NAO_CONFERIDO'), PARCIAL: de('PARCIAL'), AGUARDANDO_VALIDACAO: de('AGUARDANDO_VALIDACAO'), RECONCILIADO: de('RECONCILIADO') },
    activeCounts: n(s?.ativas),
    pendingObservations: n(s?.pendentes),
    period: { started: n(s?.iniciadas), concluded: n(s?.concluidas), reconciled: n(s?.reconciliadas), recounts: n(s?.recontagens), cancelled: n(s?.canceladas) },
  };
}

interface LinhaFluxo {
  unidade: string;
  inicial: string;
  entradas: string;
  retornos: string;
  saidas: string;
  ajustes: string;
  movido: string;
  transferencias: string;
  final: string;
  ev_entradas: bigint;
  ev_saidas: bigint;
  ev_ajustes: bigint;
  ev_transferencias: bigint;
}

/**
 * Fluxo do saldo validado por unidade, pelos eventos de estoque (data do
 * registro do evento, `ocorrido_em`). Cada linha de evento conta uma vez; uma
 * transferência tem a baixa na origem e a entrada no destino (soma zero).
 * `sku` restringe aos produtos cujo SKU começa com o texto (relatório).
 */
export async function fluxoPorUnidade(tx: Transacao, escopoId: string, periodo: Periodo, sku: string | null = null): Promise<LinhaFluxo[]> {
  const prefixo = sku === null ? null : `${sku.toUpperCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return tx.$queryRaw<LinhaFluxo[]>`
    SELECT sg.unidade,
           coalesce(sum(l.delta) FILTER (WHERE e.ocorrido_em < ${periodo.inicio}), 0)::text AS inicial,
           coalesce(sum(l.delta) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text = 'SALDO_INICIAL'), 0)::text AS entradas,
           coalesce(sum(l.delta) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text = 'SALDO_INICIAL'
             AND EXISTS (SELECT 1 FROM retorno_expedicao r WHERE r.escopo_id = e.escopo_id AND r.palete_destino_id = e.palete_id)), 0)::text AS retornos,
           coalesce(-sum(l.delta) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text = 'EXPEDICAO'), 0)::text AS saidas,
           coalesce(sum(l.delta) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text = 'AJUSTE_RECONCILIACAO'), 0)::text AS ajustes,
           coalesce(sum(l.delta) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text IN ('TRANSFERENCIA', 'CORRECAO_TRANSFERENCIA') AND l.delta > 0), 0)::text AS movido,
           coalesce(sum(l.delta) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text IN ('TRANSFERENCIA', 'CORRECAO_TRANSFERENCIA')), 0)::text AS transferencias,
           coalesce(sum(l.delta), 0)::text AS final,
           count(DISTINCT e.id) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text = 'SALDO_INICIAL') AS ev_entradas,
           count(DISTINCT e.id) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text = 'EXPEDICAO') AS ev_saidas,
           count(DISTINCT e.id) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text = 'AJUSTE_RECONCILIACAO') AS ev_ajustes,
           count(DISTINCT e.id) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text IN ('TRANSFERENCIA', 'CORRECAO_TRANSFERENCIA')) AS ev_transferencias
      FROM linha_evento_estoque l
      JOIN evento_estoque e ON e.id = l.evento_id
      JOIN segmento_estoque sg ON sg.id = l.segmento_id
     WHERE l.escopo_id = ${escopoId}::uuid AND e.ocorrido_em < ${periodo.fim}
       AND (${prefixo}::text IS NULL OR EXISTS (SELECT 1 FROM produto pr WHERE pr.id = sg.produto_id AND upper(pr.sku) LIKE ${prefixo}::text))
     GROUP BY sg.unidade
     ORDER BY sg.unidade`;
}

/** Monta e confere o fluxo: inicial + entradas − saídas + ajustes = final (= atual, se o período chega até hoje). */
export function montarFluxo(linhas: readonly LinhaFluxo[], atual: ReadonlyMap<string, string> | null): FluxoUnidade[] {
  const unidades = new Set([...linhas.map((l) => l.unidade), ...(atual ? [...atual.keys()] : [])]);
  return [...unidades].sort().map((unidade) => {
    const l = linhas.find((x) => x.unidade === unidade);
    const inicial = q(l?.inicial);
    const entradas = q(l?.entradas);
    const saidas = q(l?.saidas);
    const ajustes = q(l?.ajustes);
    const final = q(l?.final);
    const calculado = subtrairQuantidades(somarQuantidades([inicial, entradas, ajustes]), saidas);
    const corrente = atual ? (atual.get(unidade) ?? '0') : null;
    const transferencias = q(l?.transferencias);
    const consistente =
      compararQuantidades(calculado, final) === 0 && compararQuantidades(transferencias, '0') === 0 && (corrente === null || compararQuantidades(final, corrente) === 0);
    return {
      unit: unidade,
      opening: inicial,
      entries: entradas,
      entriesFromReturns: q(l?.retornos),
      exits: saidas,
      adjustments: ajustes,
      transfersMoved: q(l?.movido),
      transfersNet: transferencias,
      closing: final,
      current: corrente === null ? null : normalizarQuantidade(corrente),
      consistent: consistente,
      events: { entries: n(l?.ev_entradas), exits: n(l?.ev_saidas), adjustments: n(l?.ev_ajustes), transfers: n(l?.ev_transferencias) },
    };
  });
}

const quantidades = (linhas: readonly { unidade: string; quantidade: string; linhas: bigint }[]): QuantidadeUnidade[] =>
  linhas.map((l) => ({ unit: l.unidade, quantity: q(l.quantidade), lines: n(l.linhas) }));

async function estoque(tx: Transacao, escopoId: string, periodo: Periodo): Promise<IndicadoresEstoque> {
  const atual = await tx.$queryRaw<{ unidade: string; validado: string; reservado: string; vinculado: string; skus: bigint; paletes: bigint }[]>`
    SELECT sg.unidade, sum(s.quantidade)::text AS validado, sum(s.quantidade_reservada)::text AS reservado, sum(s.quantidade_vinculada)::text AS vinculado,
           count(DISTINCT sg.produto_id) FILTER (WHERE s.quantidade > 0) AS skus, count(DISTINCT s.palete_id) FILTER (WHERE s.quantidade > 0) AS paletes
      FROM saldo_estoque s JOIN segmento_estoque sg ON sg.id = s.segmento_id
     WHERE s.escopo_id = ${escopoId}::uuid
     GROUP BY sg.unidade HAVING sum(s.quantidade) <> 0 OR sum(s.quantidade_reservada) <> 0
     ORDER BY sg.unidade`;
  const [desconhecido] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM palete p WHERE p.escopo_id = ${escopoId}::uuid AND ${NA_PRACA} AND p.estado_conferencia::text <> 'RECONCILIADO'`;
  const declarados = await tx.$queryRaw<{ unidade: string; quantidade: string; linhas: bigint }[]>`
    SELECT d.unidade_medida AS unidade, sum(d.quantidade)::text AS quantidade, count(*) AS linhas
      FROM item_declarado d JOIN palete p ON p.id = d.palete_id
     WHERE d.escopo_id = ${escopoId}::uuid AND ${NA_PRACA} GROUP BY 1 ORDER BY 1`;
  const documentos = await tx.$queryRaw<{ unidade: string; quantidade: string; linhas: bigint }[]>`
    SELECT l.unidade_canonica AS unidade, sum(l.quantidade_canonica)::text AS quantidade, count(*) AS linhas
      FROM linha_documento_devolucao l WHERE l.escopo_id = ${escopoId}::uuid GROUP BY 1 ORDER BY 1`;
  const fluxo = await fluxoPorUnidade(tx, escopoId, periodo);
  const [ret] = await tx.$queryRaw<{ fisicos: bigint; avisos: bigint }[]>`
    SELECT count(*) FILTER (WHERE r.tipo::text = 'RECEBIMENTO_FISICO') AS fisicos, count(*) FILTER (WHERE r.tipo::text = 'AVISO_DOCUMENTAL') AS avisos
      FROM retorno_expedicao r WHERE r.escopo_id = ${escopoId}::uuid AND r.criado_em >= ${periodo.inicio} AND r.criado_em < ${periodo.fim}`;
  const retornados = await tx.$queryRaw<{ unidade: string; quantidade: string; linhas: bigint }[]>`
    SELECT le.unidade, sum(lr.quantidade)::text AS quantidade, count(*) AS linhas
      FROM linha_retorno lr JOIN retorno_expedicao r ON r.id = lr.retorno_id JOIN linha_expedicao le ON le.id = lr.linha_expedicao_id
     WHERE r.escopo_id = ${escopoId}::uuid AND r.tipo::text = 'RECEBIMENTO_FISICO' AND r.criado_em >= ${periodo.inicio} AND r.criado_em < ${periodo.fim}
     GROUP BY 1 ORDER BY 1`;
  const saldoAtual = new Map(atual.map((a) => [a.unidade, q(a.validado)]));
  return {
    current: atual.map((a) => ({
      unit: a.unidade,
      validated: q(a.validado),
      reserved: q(a.reservado),
      linked: q(a.vinculado),
      available: subtrairQuantidades(q(a.validado), q(a.reservado)),
      skus: n(a.skus),
      pallets: n(a.paletes),
    })),
    palletsWithUnknownContent: n(desconhecido?.n),
    documentary: { declaredOnPallets: quantidades(declarados), importedDocuments: quantidades(documentos) },
    flow: montarFluxo(fluxo, periodo.includesToday ? saldoAtual : null),
    returns: { physical: n(ret?.fisicos), physicalQuantity: quantidades(retornados), notices: n(ret?.avisos) },
  };
}

async function claims(tx: Transacao, escopoId: string, periodo: Periodo): Promise<IndicadoresClaims> {
  const situacoes = await tx.$queryRaw<{ situacao: IndicadoresClaims['byState'][number]['state']; n: bigint }[]>`
    SELECT c.situacao::text AS situacao, count(*) AS n FROM claim c WHERE c.escopo_id = ${escopoId}::uuid GROUP BY 1 ORDER BY 1`;
  const motivos = await tx.$queryRaw<{ motivo: IndicadoresClaims['byReason'][number]['reason']; n: bigint }[]>`
    SELECT c.motivo::text AS motivo, count(*) AS n FROM claim c WHERE c.escopo_id = ${escopoId}::uuid GROUP BY 1 ORDER BY 1`;
  const [cand] = await tx.$queryRaw<{ casos: bigint; candidatos: bigint }[]>`
    SELECT count(DISTINCT k.claim_id) AS casos, count(*) AS candidatos
      FROM candidato_claim k WHERE k.escopo_id = ${escopoId}::uuid AND k.situacao::text = 'EM_INVESTIGACAO'`;
  // Mesma definição do resumo de claims (etapa 07): quantidade recuperada validada das linhas.
  const recuperada = await tx.$queryRaw<{ unidade: string; quantidade: string; casos: bigint }[]>`
    SELECT l.unidade, sum(l.quantidade_recuperada)::text AS quantidade, count(DISTINCT l.claim_id) FILTER (WHERE l.quantidade_recuperada > 0) AS casos
      FROM linha_claim l JOIN claim c ON c.id = l.claim_id WHERE c.escopo_id = ${escopoId}::uuid
     GROUP BY l.unidade HAVING sum(l.quantidade_recuperada) > 0 ORDER BY l.unidade`;
  const codigos = Object.keys(PENDENCIA_SQL) as (keyof typeof PENDENCIA_SQL)[];
  const pendencias: { code: string; count: number }[] = [];
  for (const codigo of codigos) {
    const [r] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM claim c WHERE c.escopo_id = ${escopoId}::uuid AND ${PENDENCIA_SQL[codigo]}`;
    pendencias.push({ code: codigo, count: n(r?.n) });
  }
  const [per] = await tx.$queryRaw<{ abertos: bigint; encerrados: bigint; estornos: bigint }[]>`
    SELECT (SELECT count(*) FROM claim c WHERE c.escopo_id = ${escopoId}::uuid AND c.criado_em >= ${periodo.inicio} AND c.criado_em < ${periodo.fim}) AS abertos,
           (SELECT count(*) FROM claim c WHERE c.escopo_id = ${escopoId}::uuid AND c.encerrado_em >= ${periodo.inicio} AND c.encerrado_em < ${periodo.fim}) AS encerrados,
           (SELECT count(*) FROM recuperacao_claim r WHERE r.escopo_id = ${escopoId}::uuid AND r.estornada_em >= ${periodo.inicio} AND r.estornada_em < ${periodo.fim}) AS estornos`;
  const recuperacoes = await tx.$queryRaw<{ unidade: string; quantidade: string; linhas: bigint }[]>`
    SELECT r.unidade, sum(r.quantidade)::text AS quantidade, count(*) AS linhas FROM recuperacao_claim r
     WHERE r.escopo_id = ${escopoId}::uuid AND r.validada_em >= ${periodo.inicio} AND r.validada_em < ${periodo.fim} AND r.situacao::text = 'ATIVA'
     GROUP BY 1 ORDER BY 1`;
  const total = situacoes.reduce((t, s) => t + n(s.n), 0);
  return {
    cases: total,
    open: situacoes.filter((s) => !FINAIS.includes(s.situacao)).reduce((t, s) => t + n(s.n), 0),
    byState: situacoes.map((s) => ({ state: s.situacao, count: n(s.n) })),
    byReason: motivos.map((m) => ({ reason: m.motivo, count: n(m.n) })),
    casesWithCandidates: n(cand?.casos),
    candidatesInvestigating: n(cand?.candidatos),
    recoveredValidated: recuperada.map((r) => ({ unit: r.unidade, quantity: q(r.quantidade), cases: n(r.casos) })),
    pendencies: pendencias,
    period: { opened: n(per?.abertos), recoveries: quantidades(recuperacoes), reversals: n(per?.estornos), closed: n(per?.encerrados) },
  };
}

async function valores(tx: Transacao, escopoId: string, periodo: Periodo): Promise<IndicadoresValores> {
  // Estimativa (mesma definição do resumo de claims), só de casos ainda não finalizados.
  const estimado = await tx.$queryRaw<{ moeda: string; valor: string; casos: bigint; parciais: bigint }[]>`
    SELECT e.moeda, sum(e.valor)::text AS valor, count(*) AS casos, count(*) FILTER (WHERE e.parcial) AS parciais
      FROM (SELECT c.moeda, ${ESTIMADO_CASO} AS valor,
                   coalesce((SELECT bool_or(lv.valor_estimado IS NULL) FROM linha_claim lv WHERE lv.claim_id = c.id), false) AS parcial
              FROM claim c WHERE c.escopo_id = ${escopoId}::uuid AND c.situacao::text NOT IN ('REGULARIZADO', 'PERDA_CONFIRMADA', 'ENCERRADO')) e
     WHERE e.moeda IS NOT NULL AND e.valor IS NOT NULL GROUP BY e.moeda ORDER BY e.moeda`;
  const resultados = await tx.$queryRaw<{ tipo: string; moeda: string; valor: string; n: bigint; no_periodo: string | null; n_periodo: bigint }[]>`
    SELECT r.tipo::text AS tipo, r.moeda, sum(r.valor)::text AS valor, count(*) AS n,
           (sum(r.valor) FILTER (WHERE r.registrado_em >= ${periodo.inicio} AND r.registrado_em < ${periodo.fim}))::text AS no_periodo,
           count(*) FILTER (WHERE r.registrado_em >= ${periodo.inicio} AND r.registrado_em < ${periodo.fim}) AS n_periodo
      FROM resultado_claim r
     WHERE r.escopo_id = ${escopoId}::uuid AND r.situacao::text = 'VIGENTE' AND r.valor IS NOT NULL AND r.moeda IS NOT NULL
     GROUP BY r.tipo, r.moeda ORDER BY r.tipo, r.moeda`;
  const [corr] = await tx.$queryRaw<{ corrigidos: bigint; anulados: bigint }[]>`
    SELECT count(*) FILTER (WHERE r.situacao::text = 'CORRIGIDO') AS corrigidos, count(*) FILTER (WHERE r.situacao::text = 'ANULADO') AS anulados
      FROM resultado_claim r WHERE r.escopo_id = ${escopoId}::uuid`;
  const de = (tipo: string, periodoSo: boolean) =>
    resultados
      .filter((r) => r.tipo === tipo && (!periodoSo || n(r.n_periodo) > 0))
      .map((r) => ({ currency: r.moeda, value: normalizarValor(periodoSo ? (r.no_periodo ?? '0') : r.valor), count: n(periodoSo ? r.n_periodo : r.n) }));
  return {
    estimatedInAnalysis: estimado.map((e) => ({ currency: e.moeda, value: normalizarValor(e.valor), count: n(e.casos), partialCases: n(e.parciais) })),
    avoidedConfirmed: de('REGULARIZACAO', false),
    lossConfirmed: de('PERDA_CONFIRMADA', false),
    corrections: { corrected: n(corr?.corrigidos), annulled: n(corr?.anulados) },
    period: { avoidedConfirmed: de('REGULARIZACAO', true), lossConfirmed: de('PERDA_CONFIRMADA', true) },
  };
}

async function janelas(tx: Transacao, escopoId: string, periodo: Periodo): Promise<IndicadoresJanelas> {
  // Janelas cujo intervalo de saída cruza o período ou, sem intervalo, cujo mês de referência está nele.
  const lista = await tx.$queryRaw<{ id: string; codigo: string; nome: string; situacao: IndicadoresJanelas['windows'][number]['state']; saida_inicio: Date | null; saida_fim: Date | null }[]>`
    SELECT j.id::text, j.codigo, j.nome, j.situacao::text AS situacao, j.saida_inicio, j.saida_fim
      FROM janela_devolucao j
     WHERE j.escopo_id = ${escopoId}::uuid
       AND ((j.saida_inicio IS NOT NULL AND j.saida_inicio < ${periodo.fim} AND coalesce(j.saida_fim, j.saida_inicio) >= ${periodo.inicio})
            OR (j.saida_inicio IS NULL AND j.mes_referencia >= date_trunc('month', ${periodo.start}::date) AND j.mes_referencia <= ${periodo.end}::date))
     ORDER BY j.saida_inicio ASC NULLS LAST, j.codigo
     LIMIT ${LIMITE_JANELAS + 1}`;
  const ids = lista.slice(0, LIMITE_JANELAS).map((j) => j.id);
  const restricoes =
    ids.length === 0
      ? []
      : await tx.$queryRaw<{ janela_id: string; metrica: IndicadoresJanelas['windows'][number]['restrictions'][number]['metric']; unidade: string; base_peso: 'BRUTO' | 'LIQUIDO' | null; limite: string | null; reservado: string; expedido: string }[]>`
          SELECT r.janela_id::text, r.metrica::text AS metrica, r.unidade, r.base_peso::text AS base_peso, r.limite::text, r.reservado::text, r.expedido::text
            FROM restricao_janela r WHERE r.escopo_id = ${escopoId}::uuid AND r.janela_id = ANY(${ids}::uuid[]) ORDER BY r.janela_id, r.metrica`;
  const [exp] = await tx.$queryRaw<{ expedicoes: bigint; parciais: bigint; reservas: bigint; canceladas: bigint; inteiros: bigint }[]>`
    SELECT (SELECT count(*) FROM expedicao x WHERE x.escopo_id = ${escopoId}::uuid AND x.confirmada_em >= ${periodo.inicio} AND x.confirmada_em < ${periodo.fim}) AS expedicoes,
           (SELECT count(*) FROM expedicao x WHERE x.escopo_id = ${escopoId}::uuid AND x.parcial AND x.confirmada_em >= ${periodo.inicio} AND x.confirmada_em < ${periodo.fim}) AS parciais,
           (SELECT count(*) FROM reserva_janela r WHERE r.escopo_id = ${escopoId}::uuid AND r.criado_em >= ${periodo.inicio} AND r.criado_em < ${periodo.fim}) AS reservas,
           (SELECT count(*) FROM reserva_janela r WHERE r.escopo_id = ${escopoId}::uuid AND r.situacao::text IN ('CANCELADA', 'LIBERADA')
               AND r.encerrada_em >= ${periodo.inicio} AND r.encerrada_em < ${periodo.fim}) AS canceladas,
           (SELECT count(*) FROM evento_localizacao e WHERE e.escopo_id = ${escopoId}::uuid AND e.tipo::text = 'SAIDA_EXPEDICAO'
               AND e.ocorrido_em >= ${periodo.inicio} AND e.ocorrido_em < ${periodo.fim}) AS inteiros`;
  const enviados = await tx.$queryRaw<{ unidade: string; quantidade: string; linhas: bigint }[]>`
    SELECT le.unidade, sum(le.quantidade_enviada)::text AS quantidade, count(*) AS linhas
      FROM linha_expedicao le JOIN expedicao x ON x.id = le.expedicao_id
     WHERE x.escopo_id = ${escopoId}::uuid AND x.confirmada_em >= ${periodo.inicio} AND x.confirmada_em < ${periodo.fim} AND le.quantidade_enviada > 0
     GROUP BY 1 ORDER BY 1`;
  return {
    windows: lista.slice(0, LIMITE_JANELAS).map((j) => ({
      id: j.id,
      code: j.codigo,
      name: j.nome,
      state: j.situacao,
      exitStart: j.saida_inicio?.toISOString() ?? null,
      exitEnd: j.saida_fim?.toISOString() ?? null,
      restrictions: restricoes
        .filter((r) => r.janela_id === j.id)
        .map((r) => {
          const reservado = q(r.reservado);
          const expedido = q(r.expedido);
          return {
            metric: r.metrica,
            unit: unidadeDaMetrica(r.metrica, r.unidade),
            weightBase: r.base_peso,
            limit: r.limite === null ? null : q(r.limite),
            reservedActive: reservado,
            shipped: expedido,
            // Limite pendente não é ilimitado: sem limite, sem restante.
            remaining: r.limite === null ? null : subtrairQuantidades(subtrairQuantidades(q(r.limite), reservado), expedido),
          };
        }),
    })),
    truncated: lista.length > LIMITE_JANELAS,
    period: {
      expeditions: n(exp?.expedicoes),
      partialExpeditions: n(exp?.parciais),
      shipped: quantidades(enviados),
      palletsShippedWhole: n(exp?.inteiros),
      reservationsCreated: n(exp?.reservas),
      reservationsCancelled: n(exp?.canceladas),
    },
  };
}

async function idade(tx: Transacao, escopoId: string): Promise<IndicadoresIdade> {
  // Mesma referência do FIFO da etapa 08: primeira entrada física validada do material (segmento).
  const meses = await tx.$queryRaw<{ mes: string | null; unidade: string; quantidade: string; linhas: bigint }[]>`
    WITH entrada AS (
      SELECT l.segmento_id, min(e.ocorrido_em) AS primeira
        FROM linha_evento_estoque l JOIN evento_estoque e ON e.id = l.evento_id
       WHERE l.escopo_id = ${escopoId}::uuid AND l.delta > 0 AND e.tipo::text IN ('SALDO_INICIAL', 'AJUSTE_RECONCILIACAO')
       GROUP BY l.segmento_id
    ), fuso AS (SELECT u.fuso FROM escopo es JOIN unidade u ON u.id = es.unidade_id WHERE es.id = ${escopoId}::uuid)
    SELECT to_char(en.primeira AT TIME ZONE (SELECT fuso FROM fuso), 'YYYY-MM') AS mes, sg.unidade, sum(s.quantidade)::text AS quantidade, count(*) AS linhas
      FROM saldo_estoque s JOIN segmento_estoque sg ON sg.id = s.segmento_id LEFT JOIN entrada en ON en.segmento_id = s.segmento_id
     WHERE s.escopo_id = ${escopoId}::uuid AND s.quantidade > 0
     GROUP BY 1, 2 ORDER BY 1 NULLS LAST, 2`;
  const [doc] = await tx.$queryRaw<{ linhas: bigint; antiga: string | null; recente: string | null }[]>`
    SELECT count(*) AS linhas, to_char(min(l.data_documento), 'YYYY-MM-DD') AS antiga, to_char(max(l.data_documento), 'YYYY-MM-DD') AS recente
      FROM linha_documento_devolucao l WHERE l.escopo_id = ${escopoId}::uuid AND l.data_documento IS NOT NULL`;
  return {
    byMonth: meses.filter((m) => m.mes !== null).map((m) => ({ month: m.mes ?? '', unit: m.unidade, quantity: q(m.quantidade), lines: n(m.linhas) })),
    withoutEntryDate: meses.filter((m) => m.mes === null).map((m) => ({ unit: m.unidade, quantity: q(m.quantidade), lines: n(m.linhas) })),
    documentReference: { lines: n(doc?.linhas), oldest: doc?.antiga ?? null, newest: doc?.recente ?? null },
  };
}

/** Indicadores sem medição registrada (não estimados como resultado). */
const INDISPONIVEIS: Indicadores['unavailable'] = [
  {
    title: 'Produtividade e tempo poupado',
    reason:
      'Sem registro de esforço (horas de trabalho por tarefa) e sem base comparável anterior ao aplicativo. O tempo entre abrir e concluir uma conferência não comprova tempo de trabalho ativo; nada é estimado como economia confirmada.',
  },
  {
    title: 'Metas, faixas de idade e prioridade do cliente',
    reason: 'Critérios do cliente ainda não informados (docs/DESCOBERTA.md): a idade aparece por mês de entrada, sem faixas ou metas inventadas.',
  },
];

export async function consultarIndicadores(db: Banco, escopo: Escopo, permissoes: ReadonlySet<Permissao>, filtro: FiltroPeriodo, agora: Date): Promise<Indicadores> {
  const pode = (p: Permissao) => permissoes.has(p);
  const restritas: AreaIndicador[] = [];
  const area = async <T>(nome: AreaIndicador, permissao: Permissao, calcular: () => Promise<T>): Promise<T | null> => {
    if (pode(permissao)) return calcular();
    restritas.push(nome);
    return null;
  };
  return emFotografia(db, async (tx) => {
    const periodo = await resolverPeriodo(tx, escopo.id, filtro, agora);
    const base = await basePosicoes(tx, escopo.id, periodo);
    const resultado: Indicadores = {
      scope: { id: escopo.id, name: escopo.name, demo: escopo.demo },
      period: periodoAplicado(periodo),
      consultedAt: agora.toISOString(),
      positionsBasis: base,
      praca: await area('praca', 'palete.consultar', () => praca(tx, escopo.id, periodo, base)),
      conferencia: await area('conferencia', 'palete.consultar', () => conferencia(tx, escopo.id, periodo)),
      estoque: await area('estoque', 'palete.consultar', () => estoque(tx, escopo.id, periodo)),
      claims: await area('claims', 'claim.consultar', () => claims(tx, escopo.id, periodo)),
      valores: await area('valores', 'claim.consultar', () => valores(tx, escopo.id, periodo)),
      janelas: await area('janelas', 'janela.consultar', () => janelas(tx, escopo.id, periodo)),
      idade: await area('idade', 'palete.consultar', () => idade(tx, escopo.id)),
      restricted: restritas,
      unavailable: INDISPONIVEIS,
    };
    return resultado;
  });
}
