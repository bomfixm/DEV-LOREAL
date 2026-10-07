/**
 * Relatórios da etapa 10 (docs/INDICADORES.md). Um formato tabular único
 * (colunas, linhas, filtros, base, notas e totais) serve a tela, o CSV e a
 * impressão: os três mostram os mesmos filtros, base, horário e unidades.
 * Cada relatório é lido numa fotografia consistente (indicadores/consultas)
 * e paginado; a exportação usa o mesmo cálculo até o limite documentado.
 * Totais nunca somam unidades ou moedas diferentes; agregações com várias
 * relações são feitas em subconsultas por registro (sem multiplicar por junção).
 */
import {
  LIMITE_EXPORTACAO_RELATORIO,
  ROTULOS_MOTIVO_CLAIM,
  ROTULOS_SITUACAO_CLAIM,
  TAMANHO_PAGINA_RELATORIO,
  compararQuantidades,
  normalizarQuantidade,
  normalizarValor,
  somarQuantidades,
  subtrairQuantidades,
  type ColunaRelatorio,
  type Escopo,
  type FiltroRelatorio,
  type Relatorio,
  type TipoRelatorio,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { requisicaoInvalida } from '../../http/erros.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ESTIMADO_CASO } from '../claims/leitura.js';
import { basePosicoes, emFotografia, fluxoPorUnidade, montarFluxo } from './consultas.js';
import { periodoAplicado, resolverPeriodo, type Periodo } from './periodo.js';

const { sql, empty, join } = Prisma;
type Sql = Prisma.Sql;

const NA_PRACA = sql`p.arquivado_em IS NULL AND p.estado_fluxo::text IN ('EM_ESTOQUE', 'RESERVADO')`;

export const ROTULOS_CONFERENCIA = { NAO_CONFERIDO: 'Não conferido', PARCIAL: 'Conferência parcial', AGUARDANDO_VALIDACAO: 'Contado, aguardando validação', RECONCILIADO: 'Reconciliado' } as const;
const ROTULOS_LIBERACAO = { PENDENTE: 'Liberação pendente', BLOQUEADO: 'Bloqueado', LIBERADO: 'Liberado' } as const;
const ROTULOS_FLUXO = { EM_ESTOQUE: 'Em estoque', RESERVADO: 'Reservado', EXPEDIDO: 'Expedido', VAZIO_ARQUIVADO: 'Vazio arquivado' } as const;
const ROTULOS_CONDICAO = { SAUDAVEL: 'Saudável', AVARIADO: 'Avariado', EM_AVALIACAO: 'Em avaliação' } as const;
const ROTULOS_ORIGEM = { DEVOLUCAO: 'Devolução', NOTA_FISCAL: 'Nota fiscal', MANIFESTO: 'Manifesto', OUTRO: 'Outro' } as const;

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
/** Totais com o tipo do número (contagem, quantidade, valor): tela e CSV formatam igual. */
const cont = (label: string, v: number) => ({ label, value: String(v), kind: 'numero' as const });
const qtd = (label: string, v: string) => ({ label, value: v, kind: 'quantidade' as const });
const val = (label: string, v: string) => ({ label, value: v, kind: 'valor' as const });
const q = (v: string | null | undefined) => normalizarQuantidade(v ?? '0');
const rotulo = <T extends string>(mapa: Readonly<Record<T, string>>, valor: string | null): string | null =>
  valor === null ? null : valor in mapa ? mapa[valor as T] : valor;

interface PorUnidade {
  u: string;
  q: string;
}
/** "24 UN; 2 CX" (cada unidade separada; nunca um total entre unidades). */
function textoUnidades(itens: readonly PorUnidade[] | null): string | null {
  if (!itens || itens.length === 0) return null;
  return [...itens].sort((a, b) => a.u.localeCompare(b.u)).map((i) => `${q(i.q)} ${i.u}`).join('; ');
}
interface PorMoeda {
  m: string;
  v: string;
}
function textoMoedas(itens: readonly PorMoeda[] | null): string | null {
  if (!itens || itens.length === 0) return null;
  return [...itens].sort((a, b) => a.m.localeCompare(b.m)).map((i) => `${i.m} ${normalizarValor(i.v)}`).join('; ');
}

interface Pagina {
  limite: number;
  deslocamento: number;
  pagina: number;
}

function paginar(filtro: FiltroRelatorio, exportar: boolean): Pagina {
  if (exportar) return { limite: LIMITE_EXPORTACAO_RELATORIO, deslocamento: 0, pagina: 1 };
  return { limite: TAMANHO_PAGINA_RELATORIO, deslocamento: (filtro.pagina - 1) * TAMANHO_PAGINA_RELATORIO, pagina: filtro.pagina };
}

interface Base {
  escopo: Escopo;
  filtro: FiltroRelatorio;
  periodo: Periodo;
  pagina: Pagina;
  agora: Date;
}

type Montado = Omit<Relatorio, 'type' | 'scope' | 'period' | 'consultedAt' | 'page' | 'pageSize' | 'exportLimit'> & { usaPeriodo: boolean };

const filtroPeriodo = (p: Periodo) => ({ label: 'Período', value: `${p.start} a ${p.end} (${p.timezone}, início e fim inclusivos)` });

// ---------- Paletes e pendências ----------

const COLUNAS_PALETES: ColunaRelatorio[] = [
  { key: 'codigo', label: 'Palete', kind: 'codigo' },
  { key: 'id', label: 'ID permanente', kind: 'codigo' },
  { key: 'posicao', label: 'Endereço', kind: 'codigo' },
  { key: 'conferencia', label: 'Conferência', kind: 'texto' },
  { key: 'liberacao', label: 'Liberação', kind: 'texto' },
  { key: 'fluxo', label: 'Fluxo', kind: 'texto' },
  { key: 'emConferencia', label: 'Conferência em andamento', kind: 'texto' },
  { key: 'saldo', label: 'Saldo validado (por unidade)', kind: 'texto' },
  { key: 'declarado', label: 'Declarado em documento (não comprova presença)', kind: 'texto' },
  { key: 'obsPendentes', label: 'Observações pendentes', kind: 'numero' },
  { key: 'pendencia', label: 'Pendência', kind: 'texto' },
];

async function relatorioPaletes(tx: Transacao, b: Base): Promise<Montado> {
  const { escopo, filtro } = b;
  const condicoes: Sql[] = [sql`p.escopo_id = ${escopo.id}::uuid`, NA_PRACA];
  if (filtro.conferencia) condicoes.push(sql`p.estado_conferencia::text = ${filtro.conferencia}`);
  if (filtro.localizacao === 'COM_POSICAO') condicoes.push(sql`p.posicao_id IS NOT NULL`);
  if (filtro.localizacao === 'PENDENTE') condicoes.push(sql`p.posicao_id IS NULL`);
  const pendentes = sql`(p.estado_conferencia::text <> 'RECONCILIADO' OR p.posicao_id IS NULL OR p.motivo_pendencia IS NOT NULL
      OR EXISTS (SELECT 1 FROM sessao_conferencia c WHERE c.palete_id = p.id AND c.ativa))`;
  if (filtro.somentePendencias === '1') condicoes.push(pendentes);
  const onde = join(condicoes, ' AND ');
  const linhas = await tx.$queryRaw<
    {
      id: string;
      codigo: string;
      posicao: string | null;
      conferencia: string;
      liberacao: string;
      fluxo: string;
      pendencia: string | null;
      ativa: boolean;
      saldo: PorUnidade[] | null;
      declarado: PorUnidade[] | null;
      obs: bigint;
      total: bigint;
    }[]
  >`
    SELECT p.id::text, p.codigo, pos.codigo AS posicao, p.estado_conferencia::text AS conferencia, p.estado_liberacao::text AS liberacao,
           p.estado_fluxo::text AS fluxo, p.motivo_pendencia AS pendencia,
           EXISTS (SELECT 1 FROM sessao_conferencia c WHERE c.palete_id = p.id AND c.ativa) AS ativa,
           (SELECT json_agg(json_build_object('u', x.u, 'q', x.q)) FROM (
              SELECT sg.unidade AS u, sum(s.quantidade)::text AS q FROM saldo_estoque s JOIN segmento_estoque sg ON sg.id = s.segmento_id
               WHERE s.palete_id = p.id AND s.quantidade > 0 GROUP BY sg.unidade) x) AS saldo,
           (SELECT json_agg(json_build_object('u', x.u, 'q', x.q)) FROM (
              SELECT d.unidade_medida AS u, sum(d.quantidade)::text AS q FROM item_declarado d WHERE d.palete_id = p.id GROUP BY d.unidade_medida) x) AS declarado,
           (SELECT count(*) FROM observacao_conferencia o JOIN sessao_conferencia so ON so.id = o.sessao_id
             WHERE so.palete_id = p.id AND o.removida_em IS NULL AND o.pendencia IS NOT NULL AND so.situacao::text IN ('EM_ANDAMENTO', 'CONCLUIDA')) AS obs,
           count(*) OVER () AS total
      FROM palete p LEFT JOIN posicao pos ON pos.id = p.posicao_id
     WHERE ${onde}
     ORDER BY p.codigo
     LIMIT ${b.pagina.limite} OFFSET ${b.pagina.deslocamento}`;
  const resumo = await tx.$queryRaw<{ estado: string; n: bigint; sem_posicao: bigint }[]>`
    SELECT p.estado_conferencia::text AS estado, count(*) AS n, count(*) FILTER (WHERE p.posicao_id IS NULL) AS sem_posicao
      FROM palete p WHERE ${onde} GROUP BY 1 ORDER BY 1`;
  const saldos = await tx.$queryRaw<{ unidade: string; q: string }[]>`
    SELECT sg.unidade, sum(s.quantidade)::text AS q FROM saldo_estoque s JOIN segmento_estoque sg ON sg.id = s.segmento_id JOIN palete p ON p.id = s.palete_id
     WHERE ${onde} AND s.quantidade > 0 GROUP BY 1 ORDER BY 1`;
  const total = resumo.reduce((t, r) => t + n(r.n), 0);
  const naoValidados = resumo.filter((r) => r.estado !== 'RECONCILIADO').reduce((t, r) => t + n(r.n), 0);
  const filtros = [
    { label: 'Conferência', value: filtro.conferencia ? ROTULOS_CONFERENCIA[filtro.conferencia] : 'todas' },
    { label: 'Localização', value: filtro.localizacao === 'COM_POSICAO' ? 'com posição' : filtro.localizacao === 'PENDENTE' ? 'localização pendente' : 'todas' },
    { label: 'Somente com pendência', value: filtro.somentePendencias === '1' ? 'sim' : 'não' },
  ];
  return {
    usaPeriodo: false,
    title: 'Paletes e pendências de conferência e localização',
    filters: filtros,
    basis: [
      'Posição atual: paletes na praça (em estoque ou reservados); arquivados e expedidos ficam fora. Cada palete aparece uma vez, com qualquer número de produtos, documentos e evidências.',
      'Saldo validado: conferido e aprovado na reconciliação, por unidade. Declarado em documento: não comprova presença física e não é somado ao saldo.',
      'Conteúdo de palete não conferido ou parcial é desconhecido: aparece vazio, nunca como zero.',
      'Pendência: conferência não reconciliada, sem posição, motivo registrado ou conferência em andamento.',
    ],
    notes: naoValidados > 0 ? [`${String(naoValidados)} palete(s) deste resultado sem conteúdo totalmente validado: o saldo listado não representa todo o material físico.`] : [],
    columns: COLUNAS_PALETES,
    rows: linhas.map((l) => ({
      codigo: l.codigo,
      id: l.id,
      posicao: l.posicao ?? 'Localização pendente',
      conferencia: rotulo(ROTULOS_CONFERENCIA, l.conferencia),
      liberacao: rotulo(ROTULOS_LIBERACAO, l.liberacao),
      fluxo: rotulo(ROTULOS_FLUXO, l.fluxo),
      emConferencia: l.ativa ? 'Sim' : 'Não',
      saldo: textoUnidades(l.saldo),
      declarado: textoUnidades(l.declarado),
      obsPendentes: String(n(l.obs)),
      pendencia: l.pendencia,
    })),
    summary: [
      cont('Paletes', total),
      ...resumo.map((r) => cont(rotulo(ROTULOS_CONFERENCIA, r.estado) ?? r.estado, n(r.n))),
      cont('Sem posição (localização pendente)', resumo.reduce((t, r) => t + n(r.sem_posicao), 0)),
      ...saldos.map((s) => qtd(`Saldo validado (${s.unidade})`, q(s.q))),
    ],
    total,
  };
}

// ---------- Movimento do estoque validado ----------

const COLUNAS_ESTOQUE: ColunaRelatorio[] = [
  { key: 'sku', label: 'SKU', kind: 'codigo' },
  { key: 'descricao', label: 'Descrição', kind: 'texto' },
  { key: 'lote', label: 'Lote', kind: 'codigo' },
  { key: 'origem', label: 'Origem', kind: 'codigo' },
  { key: 'condicao', label: 'Condição', kind: 'texto' },
  { key: 'unidade', label: 'Unidade', kind: 'texto' },
  { key: 'inicial', label: 'Saldo inicial', kind: 'quantidade' },
  { key: 'entradas', label: 'Entradas validadas', kind: 'quantidade' },
  { key: 'saidas', label: 'Saídas confirmadas', kind: 'quantidade' },
  { key: 'ajustes', label: 'Ajustes líquidos', kind: 'quantidade' },
  { key: 'movido', label: 'Transferido entre paletes (não altera o total)', kind: 'quantidade' },
  { key: 'final', label: 'Saldo final', kind: 'quantidade' },
];

async function relatorioEstoque(tx: Transacao, b: Base): Promise<Montado> {
  const { escopo, filtro, periodo } = b;
  const sku = (filtro.sku ?? '').trim();
  const condicaoSku = sku === '' ? empty : sql`AND upper(pr.sku) LIKE ${`${sku.toUpperCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`;
  const linhas = await tx.$queryRaw<
    {
      sku: string;
      descricao: string;
      lote: string | null;
      origem_tipo: string | null;
      origem_referencia: string | null;
      condicao: string;
      unidade: string;
      inicial: string;
      entradas: string;
      saidas: string;
      ajustes: string;
      movido: string;
      final: string;
      total: bigint;
    }[]
  >`
    SELECT pr.sku, pr.descricao, sg.lote, sg.origem_tipo::text AS origem_tipo, sg.origem_referencia, sg.condicao::text AS condicao, sg.unidade,
           coalesce(sum(l.delta) FILTER (WHERE e.ocorrido_em < ${periodo.inicio}), 0)::text AS inicial,
           coalesce(sum(l.delta) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text = 'SALDO_INICIAL'), 0)::text AS entradas,
           coalesce(-sum(l.delta) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text = 'EXPEDICAO'), 0)::text AS saidas,
           coalesce(sum(l.delta) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text = 'AJUSTE_RECONCILIACAO'), 0)::text AS ajustes,
           coalesce(sum(l.delta) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio} AND e.tipo::text IN ('TRANSFERENCIA', 'CORRECAO_TRANSFERENCIA') AND l.delta > 0), 0)::text AS movido,
           coalesce(sum(l.delta), 0)::text AS final,
           count(*) OVER () AS total
      FROM linha_evento_estoque l
      JOIN evento_estoque e ON e.id = l.evento_id
      JOIN segmento_estoque sg ON sg.id = l.segmento_id
      JOIN produto pr ON pr.id = sg.produto_id
     WHERE l.escopo_id = ${escopo.id}::uuid AND e.ocorrido_em < ${periodo.fim} ${condicaoSku}
     GROUP BY sg.id, pr.sku, pr.descricao, sg.lote, sg.origem_tipo, sg.origem_referencia, sg.condicao, sg.unidade
    HAVING sum(l.delta) <> 0 OR count(*) FILTER (WHERE e.ocorrido_em >= ${periodo.inicio}) > 0
     ORDER BY pr.sku, sg.lote NULLS LAST, sg.origem_referencia NULLS LAST, sg.condicao, sg.unidade
     LIMIT ${b.pagina.limite} OFFSET ${b.pagina.deslocamento}`;
  const fluxo = montarFluxo(await fluxoPorUnidade(tx, escopo.id, periodo, sku === '' ? null : sku), null);
  return {
    usaPeriodo: true,
    title: 'Movimento do estoque validado por produto, lote e origem',
    filters: [filtroPeriodo(periodo), { label: 'SKU (começa com)', value: sku === '' ? 'todos' : sku }],
    basis: [
      'Saldo final = saldo inicial + entradas validadas − saídas confirmadas + ajustes líquidos, por unidade e por material (produto × lote × origem × condição).',
      'Datas: horário de registro de cada evento de estoque (reconciliação, transferência, correção e confirmação da expedição), no fuso da operação.',
      'Entradas validadas: primeira validação do conteúdo de um palete (inclui retorno físico depois de conferido e reconciliado). Ajustes: reconciliações posteriores.',
      'Transferências e correções entre paletes não alteram o total; consolidar paletes não é saída. Documento importado e quantidade observada não entram neste saldo.',
    ],
    notes: [
      'Material ainda não conferido/reconciliado não aparece aqui (conteúdo desconhecido).',
      ...fluxo.filter((f) => !f.consistent).map((f) => `Atenção: o fluxo em ${f.unit} não fechou (inicial + entradas − saídas + ajustes ≠ final). Comunique o suporte.`),
    ],
    columns: COLUNAS_ESTOQUE,
    rows: linhas.map((l) => ({
      sku: l.sku,
      descricao: l.descricao,
      lote: l.lote ?? 'Lote pendente',
      origem: l.origem_tipo === null ? 'Origem pendente' : `${rotulo(ROTULOS_ORIGEM, l.origem_tipo) ?? ''} ${l.origem_referencia ?? '(referência pendente)'}`,
      condicao: rotulo(ROTULOS_CONDICAO, l.condicao),
      unidade: l.unidade,
      inicial: q(l.inicial),
      entradas: q(l.entradas),
      saidas: q(l.saidas),
      ajustes: q(l.ajustes),
      movido: q(l.movido),
      final: q(l.final),
    })),
    summary: fluxo.flatMap((f) => [
      qtd(`Saldo inicial (${f.unit})`, f.opening),
      qtd(`Entradas validadas (${f.unit})`, f.entries),
      qtd(`Saídas confirmadas (${f.unit})`, f.exits),
      qtd(`Ajustes líquidos (${f.unit})`, f.adjustments),
      qtd(`Transferido entre paletes (${f.unit})`, f.transfersMoved),
      qtd(`Saldo final (${f.unit})`, f.closing),
    ]),
    total: n(linhas[0]?.total),
  };
}

// ---------- Expedições e retornos ----------

const COLUNAS_EXPEDICOES: ColunaRelatorio[] = [
  { key: 'expedicao', label: 'Expedição', kind: 'codigo' },
  { key: 'janela', label: 'Janela', kind: 'codigo' },
  { key: 'saidaEm', label: 'Saída física informada', kind: 'datahora' },
  { key: 'confirmadaEm', label: 'Confirmada no sistema', kind: 'datahora' },
  { key: 'parcial', label: 'Conclusão parcial', kind: 'texto' },
  { key: 'palete', label: 'Palete', kind: 'codigo' },
  { key: 'sku', label: 'SKU', kind: 'codigo' },
  { key: 'lote', label: 'Lote', kind: 'codigo' },
  { key: 'origem', label: 'Origem', kind: 'codigo' },
  { key: 'unidade', label: 'Unidade', kind: 'texto' },
  { key: 'reservado', label: 'Reservado', kind: 'quantidade' },
  { key: 'enviado', label: 'Enviado (baixa)', kind: 'quantidade' },
  { key: 'liberado', label: 'Restante liberado', kind: 'quantidade' },
  { key: 'retornado', label: 'Retornado (físico)', kind: 'quantidade' },
];

async function relatorioExpedicoes(tx: Transacao, b: Base): Promise<Montado> {
  const { escopo, periodo } = b;
  const linhas = await tx.$queryRaw<
    {
      expedicao: string;
      janela: string;
      saida_em: Date;
      confirmada_em: Date;
      parcial: boolean;
      palete: string;
      sku: string;
      lote: string | null;
      origem_tipo: string | null;
      origem_referencia: string | null;
      unidade: string;
      reservado: string;
      enviado: string;
      liberado: string;
      retornado: string;
      total: bigint;
    }[]
  >`
    SELECT x.codigo AS expedicao, j.codigo AS janela, x.saida_em, x.confirmada_em, x.parcial, le.palete_codigo AS palete, le.sku, le.lote,
           le.origem_tipo::text AS origem_tipo, le.origem_referencia, le.unidade, le.quantidade_reservada::text AS reservado,
           le.quantidade_enviada::text AS enviado, le.quantidade_liberada::text AS liberado, le.quantidade_retornada::text AS retornado,
           count(*) OVER () AS total
      FROM linha_expedicao le JOIN expedicao x ON x.id = le.expedicao_id JOIN janela_devolucao j ON j.id = x.janela_id
     WHERE x.escopo_id = ${escopo.id}::uuid AND x.confirmada_em >= ${periodo.inicio} AND x.confirmada_em < ${periodo.fim}
     ORDER BY x.confirmada_em, x.codigo, le.palete_codigo, le.sku, le.id
     LIMIT ${b.pagina.limite} OFFSET ${b.pagina.deslocamento}`;
  const [tot] = await tx.$queryRaw<{ expedicoes: bigint; parciais: bigint }[]>`
    SELECT count(*) AS expedicoes, count(*) FILTER (WHERE x.parcial) AS parciais FROM expedicao x
     WHERE x.escopo_id = ${escopo.id}::uuid AND x.confirmada_em >= ${periodo.inicio} AND x.confirmada_em < ${periodo.fim}`;
  const enviados = await tx.$queryRaw<{ unidade: string; q: string }[]>`
    SELECT le.unidade, sum(le.quantidade_enviada)::text AS q FROM linha_expedicao le JOIN expedicao x ON x.id = le.expedicao_id
     WHERE x.escopo_id = ${escopo.id}::uuid AND x.confirmada_em >= ${periodo.inicio} AND x.confirmada_em < ${periodo.fim} GROUP BY 1 ORDER BY 1`;
  const retornos = await tx.$queryRaw<{ tipo: string; n: bigint; unidade: string | null; q: string | null }[]>`
    SELECT r.tipo::text AS tipo, count(DISTINCT r.id) AS n, le.unidade, sum(lr.quantidade)::text AS q
      FROM retorno_expedicao r LEFT JOIN linha_retorno lr ON lr.retorno_id = r.id LEFT JOIN linha_expedicao le ON le.id = lr.linha_expedicao_id
     WHERE r.escopo_id = ${escopo.id}::uuid AND r.criado_em >= ${periodo.inicio} AND r.criado_em < ${periodo.fim}
     GROUP BY r.tipo, le.unidade ORDER BY 1, 3`;
  const fisicos = retornos.filter((r) => r.tipo === 'RECEBIMENTO_FISICO');
  const avisos = retornos.filter((r) => r.tipo === 'AVISO_DOCUMENTAL').reduce((t, r) => t + n(r.n), 0);
  return {
    usaPeriodo: true,
    title: 'Expedições confirmadas e retornos',
    filters: [filtroPeriodo(periodo)],
    basis: [
      'Uma linha por material expedido (palete × produto × lote × origem); a baixa do estoque acontece uma vez, na confirmação.',
      'O período usa o horário da confirmação no sistema (o mesmo do evento de baixa); a saída física informada aparece ao lado.',
      'Reserva não é expedição; cancelar reserva não altera o físico. Restante liberado voltou a ficar disponível.',
      'Retorno físico vira declaração no palete que recebeu e entra no saldo só depois de conferido e reconciliado; aviso documental não altera o saldo.',
    ],
    notes: [],
    columns: COLUNAS_EXPEDICOES,
    rows: linhas.map((l) => ({
      expedicao: l.expedicao,
      janela: l.janela,
      saidaEm: l.saida_em.toISOString(),
      confirmadaEm: l.confirmada_em.toISOString(),
      parcial: l.parcial ? 'Sim' : 'Não',
      palete: l.palete,
      sku: l.sku,
      lote: l.lote ?? 'Lote pendente',
      origem: l.origem_tipo === null ? 'Origem pendente' : `${rotulo(ROTULOS_ORIGEM, l.origem_tipo) ?? ''} ${l.origem_referencia ?? ''}`.trim(),
      unidade: l.unidade,
      reservado: q(l.reservado),
      enviado: q(l.enviado),
      liberado: q(l.liberado),
      retornado: q(l.retornado),
    })),
    summary: [
      cont('Expedições confirmadas', n(tot?.expedicoes)),
      cont('Com conclusão parcial', n(tot?.parciais)),
      ...enviados.map((e) => qtd(`Enviado (${e.unidade})`, q(e.q))),
      cont('Retornos físicos registrados', fisicos.reduce((t, r) => t + n(r.n), 0)),
      ...fisicos.filter((r) => r.unidade !== null).map((r) => qtd(`Retornado fisicamente (${r.unidade ?? ''}), aguardando conferência`, q(r.q))),
      cont('Avisos documentais de retorno (sem efeito no saldo)', avisos),
    ],
    total: n(linhas[0]?.total),
  };
}

// ---------- Claims ----------

const COLUNAS_CLAIMS: ColunaRelatorio[] = [
  { key: 'codigo', label: 'Claim', kind: 'codigo' },
  { key: 'referencia', label: 'Referência externa', kind: 'codigo' },
  { key: 'motivo', label: 'Motivo', kind: 'texto' },
  { key: 'situacao', label: 'Situação', kind: 'texto' },
  { key: 'abertoEm', label: 'Registrado em', kind: 'datahora' },
  { key: 'analise', label: 'Em análise (por unidade)', kind: 'texto' },
  { key: 'candidatos', label: 'Candidatos em investigação', kind: 'numero' },
  { key: 'recuperada', label: 'Recuperação física validada', kind: 'texto' },
  { key: 'estimado', label: 'Valor estimado (não é evitado)', kind: 'texto' },
  { key: 'evitado', label: 'Valor evitado confirmado', kind: 'texto' },
  { key: 'perda', label: 'Perda confirmada', kind: 'texto' },
  { key: 'historico', label: 'Resultados corrigidos/anulados', kind: 'numero' },
];

async function relatorioClaims(tx: Transacao, b: Base): Promise<Montado> {
  const { escopo, filtro, periodo } = b;
  const condicoes: Sql[] = [sql`c.escopo_id = ${escopo.id}::uuid`];
  if (filtro.situacao) condicoes.push(sql`c.situacao::text = ${filtro.situacao}`);
  if (filtro.motivo) condicoes.push(sql`c.motivo::text = ${filtro.motivo}`);
  const onde = join(condicoes, ' AND ');
  const linhas = await tx.$queryRaw<
    {
      codigo: string;
      referencia: string | null;
      motivo: string;
      situacao: string;
      criado_em: Date;
      moeda: string | null;
      analise: PorUnidade[] | null;
      recuperada: PorUnidade[] | null;
      estimado: string | null;
      evitado: PorMoeda[] | null;
      perda: PorMoeda[] | null;
      historico: bigint;
      candidatos: bigint;
      total: bigint;
    }[]
  >`
    SELECT c.codigo, c.referencia_externa AS referencia, c.motivo::text AS motivo, c.situacao::text AS situacao, c.criado_em, c.moeda,
           (SELECT json_agg(json_build_object('u', x.u, 'q', x.q)) FROM (SELECT l.unidade AS u, sum(l.quantidade_analise)::text AS q FROM linha_claim l WHERE l.claim_id = c.id GROUP BY l.unidade) x) AS analise,
           (SELECT json_agg(json_build_object('u', x.u, 'q', x.q)) FROM (SELECT l.unidade AS u, sum(l.quantidade_recuperada)::text AS q FROM linha_claim l
              WHERE l.claim_id = c.id GROUP BY l.unidade HAVING sum(l.quantidade_recuperada) > 0) x) AS recuperada,
           (${ESTIMADO_CASO})::text AS estimado,
           (SELECT json_agg(json_build_object('m', x.m, 'v', x.v)) FROM (SELECT r.moeda AS m, sum(r.valor)::text AS v FROM resultado_claim r
              WHERE r.claim_id = c.id AND r.situacao::text = 'VIGENTE' AND r.tipo::text = 'REGULARIZACAO' AND r.valor IS NOT NULL AND r.moeda IS NOT NULL GROUP BY r.moeda) x) AS evitado,
           (SELECT json_agg(json_build_object('m', x.m, 'v', x.v)) FROM (SELECT r.moeda AS m, sum(r.valor)::text AS v FROM resultado_claim r
              WHERE r.claim_id = c.id AND r.situacao::text = 'VIGENTE' AND r.tipo::text = 'PERDA_CONFIRMADA' AND r.valor IS NOT NULL AND r.moeda IS NOT NULL GROUP BY r.moeda) x) AS perda,
           (SELECT count(*) FROM resultado_claim r WHERE r.claim_id = c.id AND r.situacao::text <> 'VIGENTE') AS historico,
           (SELECT count(*) FROM candidato_claim k WHERE k.claim_id = c.id AND k.situacao::text = 'EM_INVESTIGACAO') AS candidatos,
           count(*) OVER () AS total
      FROM claim c WHERE ${onde}
     ORDER BY c.numero
     LIMIT ${b.pagina.limite} OFFSET ${b.pagina.deslocamento}`;
  const valores = await tx.$queryRaw<{ tipo: string; moeda: string; total: string; periodo: string | null }[]>`
    SELECT r.tipo::text AS tipo, r.moeda, sum(r.valor)::text AS total,
           (sum(r.valor) FILTER (WHERE r.registrado_em >= ${periodo.inicio} AND r.registrado_em < ${periodo.fim}))::text AS periodo
      FROM resultado_claim r JOIN claim c ON c.id = r.claim_id
     WHERE ${onde} AND r.situacao::text = 'VIGENTE' AND r.valor IS NOT NULL AND r.moeda IS NOT NULL
     GROUP BY 1, 2 ORDER BY 1, 2`;
  const recuperacoes = await tx.$queryRaw<{ unidade: string; q: string }[]>`
    SELECT r.unidade, sum(r.quantidade)::text AS q FROM recuperacao_claim r JOIN claim c ON c.id = r.claim_id
     WHERE ${onde} AND r.situacao::text = 'ATIVA' AND r.validada_em >= ${periodo.inicio} AND r.validada_em < ${periodo.fim} GROUP BY 1 ORDER BY 1`;
  const rotuloValor = (tipo: string) => (tipo === 'REGULARIZACAO' ? 'Valor evitado confirmado' : 'Perda confirmada');
  return {
    usaPeriodo: true,
    title: 'Claims: recuperações, regularizações e valores',
    filters: [
      filtroPeriodo(periodo),
      { label: 'Situação', value: filtro.situacao ? ROTULOS_SITUACAO_CLAIM[filtro.situacao] : 'todas' },
      { label: 'Motivo', value: filtro.motivo ? ROTULOS_MOTIVO_CLAIM[filtro.motivo] : 'todos' },
    ],
    basis: [
      'Linhas: casos do escopo na posição atual (filtros de situação e motivo). O período vale para os totais "no período".',
      'Candidato em investigação é pista, não recuperação. Recuperação física validada vem de vínculos válidos com o material (etapa 07), por unidade.',
      'Valor estimado não é valor evitado. Valor evitado e perda confirmados vêm de resultados vigentes registrados por perfil com aprovação financeira; correções substituem o resultado anterior e anulações saem do total (o histórico continua no caso).',
      'Moedas nunca são somadas entre si; uma recuperação parcial não confirma o valor integral do caso.',
    ],
    notes: [],
    columns: COLUNAS_CLAIMS,
    rows: linhas.map((l) => ({
      codigo: l.codigo,
      referencia: l.referencia,
      motivo: rotulo(ROTULOS_MOTIVO_CLAIM, l.motivo),
      situacao: rotulo(ROTULOS_SITUACAO_CLAIM, l.situacao),
      abertoEm: l.criado_em.toISOString(),
      analise: textoUnidades(l.analise),
      candidatos: String(n(l.candidatos)),
      recuperada: textoUnidades(l.recuperada),
      estimado: l.estimado === null || l.moeda === null ? null : `${l.moeda} ${normalizarValor(l.estimado)}`,
      evitado: textoMoedas(l.evitado),
      perda: textoMoedas(l.perda),
      historico: String(n(l.historico)),
    })),
    summary: [
      cont('Casos', n(linhas[0]?.total)),
      ...valores.map((v) => val(`${rotuloValor(v.tipo)} (${v.moeda}), vigente`, normalizarValor(v.total))),
      ...valores.filter((v) => v.periodo !== null).map((v) => val(`${rotuloValor(v.tipo)} (${v.moeda}), registrado no período`, normalizarValor(v.periodo ?? '0'))),
      ...recuperacoes.map((r) => qtd(`Recuperação validada no período (${r.unidade})`, q(r.q))),
    ],
    total: n(linhas[0]?.total),
  };
}

// ---------- Resumo do grupo de piloto ----------

const COLUNAS_PILOTO: ColunaRelatorio[] = [
  { key: 'unidade', label: 'Unidade', kind: 'texto' },
  { key: 'inicial', label: 'Saldo inicial do grupo (fotografia no início)', kind: 'quantidade' },
  { key: 'entradas', label: 'Entradas validadas', kind: 'quantidade' },
  { key: 'ajustes', label: 'Ajustes líquidos', kind: 'quantidade' },
  { key: 'saidas', label: 'Saídas confirmadas (expedição)', kind: 'quantidade' },
  { key: 'recebido', label: 'Recebido de fora do grupo', kind: 'quantidade' },
  { key: 'enviado', label: 'Enviado para fora do grupo', kind: 'quantidade' },
  { key: 'interno', label: 'Movido dentro do grupo (não altera o total)', kind: 'quantidade' },
  { key: 'final', label: 'Saldo final do grupo', kind: 'quantidade' },
];

async function relatorioPiloto(tx: Transacao, b: Base): Promise<Montado> {
  const { escopo, filtro, periodo } = b;
  const codigos = filtro.paletes ?? [];
  if (codigos.length === 0) throw requisicaoInvalida('Informe os códigos dos paletes do grupo do piloto (separados por vírgula, espaço ou linha).');
  const encontrados = await tx.$queryRaw<{ id: string; codigo: string; estado: string; ativo: boolean }[]>`
    SELECT p.id::text, p.codigo, p.estado_conferencia::text AS estado, ${NA_PRACA} AS ativo FROM palete p
     WHERE p.escopo_id = ${escopo.id}::uuid AND upper(p.codigo) = ANY(${codigos}::text[])`;
  const ids = encontrados.map((p) => p.id);
  const faltando = codigos.filter((c) => !encontrados.some((p) => p.codigo.toUpperCase() === c));
  const linhas =
    ids.length === 0
      ? []
      : await tx.$queryRaw<{ unidade: string; inicial: string; entradas: string; ajustes: string; saidas: string; recebido: string; enviado: string; interno: string; final: string }[]>`
          WITH linhas AS (
            SELECT sg.unidade, l.delta, e.tipo::text AS tipo, e.ocorrido_em,
                   CASE WHEN e.palete_destino_id IS NULL THEN NULL
                        WHEN l.palete_id = e.palete_id THEN e.palete_destino_id ELSE e.palete_id END AS outro
              FROM linha_evento_estoque l JOIN evento_estoque e ON e.id = l.evento_id JOIN segmento_estoque sg ON sg.id = l.segmento_id
             WHERE l.escopo_id = ${escopo.id}::uuid AND l.palete_id = ANY(${ids}::uuid[]) AND e.ocorrido_em < ${periodo.fim}
          )
          SELECT unidade,
                 coalesce(sum(delta) FILTER (WHERE ocorrido_em < ${periodo.inicio}), 0)::text AS inicial,
                 coalesce(sum(delta) FILTER (WHERE ocorrido_em >= ${periodo.inicio} AND tipo = 'SALDO_INICIAL'), 0)::text AS entradas,
                 coalesce(sum(delta) FILTER (WHERE ocorrido_em >= ${periodo.inicio} AND tipo = 'AJUSTE_RECONCILIACAO'), 0)::text AS ajustes,
                 coalesce(-sum(delta) FILTER (WHERE ocorrido_em >= ${periodo.inicio} AND tipo = 'EXPEDICAO'), 0)::text AS saidas,
                 coalesce(sum(delta) FILTER (WHERE ocorrido_em >= ${periodo.inicio} AND outro IS NOT NULL AND NOT (outro = ANY(${ids}::uuid[])) AND delta > 0), 0)::text AS recebido,
                 coalesce(-sum(delta) FILTER (WHERE ocorrido_em >= ${periodo.inicio} AND outro IS NOT NULL AND NOT (outro = ANY(${ids}::uuid[])) AND delta < 0), 0)::text AS enviado,
                 coalesce(sum(delta) FILTER (WHERE ocorrido_em >= ${periodo.inicio} AND outro = ANY(${ids}::uuid[]) AND delta > 0), 0)::text AS interno,
                 coalesce(sum(delta), 0)::text AS final
            FROM linhas GROUP BY unidade ORDER BY unidade`;
  const [atividade] =
    ids.length === 0
      ? [undefined]
      : await tx.$queryRaw<{ concluidas: bigint; reconciliadas: bigint; recontagens: bigint; retirados: bigint; saidas: bigint; movidos: bigint }[]>`
          SELECT (SELECT count(*) FROM sessao_conferencia c WHERE c.palete_id = ANY(${ids}::uuid[]) AND c.concluida_em >= ${periodo.inicio} AND c.concluida_em < ${periodo.fim}) AS concluidas,
                 (SELECT count(*) FROM sessao_conferencia c WHERE c.palete_id = ANY(${ids}::uuid[]) AND c.reconciliada_em >= ${periodo.inicio} AND c.reconciliada_em < ${periodo.fim}) AS reconciliadas,
                 (SELECT count(*) FROM sessao_conferencia c WHERE c.palete_id = ANY(${ids}::uuid[]) AND c.motivo::text = 'RECONTAGEM' AND c.iniciada_em >= ${periodo.inicio} AND c.iniciada_em < ${periodo.fim}) AS recontagens,
                 (SELECT count(*) FROM evento_localizacao e WHERE e.palete_id = ANY(${ids}::uuid[]) AND e.tipo::text = 'RETIRADA_VAZIO' AND e.ocorrido_em >= ${periodo.inicio} AND e.ocorrido_em < ${periodo.fim}) AS retirados,
                 (SELECT count(*) FROM evento_localizacao e WHERE e.palete_id = ANY(${ids}::uuid[]) AND e.tipo::text = 'SAIDA_EXPEDICAO' AND e.ocorrido_em >= ${periodo.inicio} AND e.ocorrido_em < ${periodo.fim}) AS saidas,
                 (SELECT count(*) FROM evento_localizacao e WHERE e.palete_id = ANY(${ids}::uuid[]) AND e.tipo::text IN ('MOVIMENTO', 'CORRECAO') AND e.ocorrido_em >= ${periodo.inicio} AND e.ocorrido_em < ${periodo.fim}) AS movidos`;
  const recuperacoes =
    ids.length === 0
      ? []
      : await tx.$queryRaw<{ unidade: string; q: string }[]>`
          SELECT r.unidade, sum(r.quantidade)::text AS q FROM recuperacao_claim r
           WHERE r.escopo_id = ${escopo.id}::uuid AND r.palete_id = ANY(${ids}::uuid[]) AND r.situacao::text = 'ATIVA'
             AND r.validada_em >= ${periodo.inicio} AND r.validada_em < ${periodo.fim} GROUP BY 1 ORDER BY 1`;
  const porEstado = new Map<string, number>();
  for (const p of encontrados.filter((x) => x.ativo)) porEstado.set(p.estado, (porEstado.get(p.estado) ?? 0) + 1);
  const notas = [
    'O grupo é a lista de códigos informada; incluir ou retirar paletes do grupo é mudança de escopo do piloto e muda a base da comparação.',
    'Fotografia inicial: saldo validado do grupo reconstruído pelos eventos até o início do período; a final, até o fim. Conteúdo não conferido continua desconhecido.',
  ];
  if (faltando.length > 0) notas.push(`Códigos não encontrados neste escopo (${String(faltando.length)}): ${faltando.slice(0, 50).join(', ')}${faltando.length > 50 ? '…' : ''}.`);
  const inativos = encontrados.filter((p) => !p.ativo).length;
  if (inativos > 0) notas.push(`${String(inativos)} palete(s) do grupo já saíram da praça (expedidos ou arquivados); continuam na comparação pelo histórico.`);
  const fechamento = linhas.map((l) => {
    const calc = subtrairQuantidades(somarQuantidades([q(l.inicial), q(l.entradas), q(l.ajustes), q(l.recebido)]), somarQuantidades([q(l.saidas), q(l.enviado)]));
    return compararQuantidades(calc, q(l.final)) === 0;
  });
  if (fechamento.some((ok) => !ok)) notas.push('Atenção: o fluxo do grupo não fechou numa unidade. Comunique o suporte.');
  return {
    usaPeriodo: true,
    title: 'Resumo comparável do grupo de piloto',
    filters: [filtroPeriodo(periodo), { label: 'Paletes do grupo', value: `${String(codigos.length)} código(s) informado(s), ${String(encontrados.length)} encontrado(s)` }],
    basis: [
      'Saldo final do grupo = inicial + entradas validadas + ajustes − saídas confirmadas + recebido de fora − enviado para fora (por unidade).',
      'Transferências dentro do grupo e consolidação não alteram o total; transferências que cruzam o limite do grupo aparecem separadas e não são entradas nem saídas da praça.',
      'Produto localizado, recuperação validada, claim regularizado, valor evitado e material expedido têm evidências diferentes e não são somados.',
      'Os números vêm do sistema; a comparação com o físico e a validação do responsável são registradas no roteiro do piloto (docs/ROTEIRO-DO-PILOTO.md).',
    ],
    notes: notas,
    columns: COLUNAS_PILOTO,
    rows: linhas.map((l) => ({
      unidade: l.unidade,
      inicial: q(l.inicial),
      entradas: q(l.entradas),
      ajustes: q(l.ajustes),
      saidas: q(l.saidas),
      recebido: q(l.recebido),
      enviado: q(l.enviado),
      interno: q(l.interno),
      final: q(l.final),
    })),
    summary: [
      cont('Paletes do grupo encontrados', encontrados.length),
      cont('Ainda na praça', encontrados.filter((p) => p.ativo).length),
      ...[...porEstado.entries()].map(([estado, total]) => cont(`Na praça — ${rotulo(ROTULOS_CONFERENCIA, estado) ?? estado}`, total)),
      cont('Conferências concluídas no período', n(atividade?.concluidas)),
      cont('Reconciliações no período', n(atividade?.reconciliadas)),
      cont('Recontagens solicitadas no período', n(atividade?.recontagens)),
      cont('Mudanças de localização no período', n(atividade?.movidos)),
      cont('Paletes vazios retirados (consolidação) no período', n(atividade?.retirados)),
      cont('Paletes que saíram inteiros na expedição no período', n(atividade?.saidas)),
      ...recuperacoes.map((r) => qtd(`Recuperação de claim validada no grupo (${r.unidade})`, q(r.q))),
    ],
    total: linhas.length,
  };
}

const MONTADORES: Record<TipoRelatorio, (tx: Transacao, b: Base) => Promise<Montado>> = {
  paletes: relatorioPaletes,
  estoque: relatorioEstoque,
  expedicoes: relatorioExpedicoes,
  claims: relatorioClaims,
  piloto: relatorioPiloto,
};

/** Relatório numa fotografia consistente; `exportar` lê até o limite da exportação. */
export async function gerarRelatorio(db: Banco, escopo: Escopo, tipo: TipoRelatorio, filtro: FiltroRelatorio, agora: Date, exportar: boolean): Promise<Relatorio> {
  const pagina = paginar(filtro, exportar);
  return emFotografia(db, async (tx) => {
    const periodo = await resolverPeriodo(tx, escopo.id, filtro, agora);
    const m = await MONTADORES[tipo](tx, { escopo, filtro, periodo, pagina, agora });
    const base = tipo === 'paletes' || tipo === 'piloto' ? await basePosicoes(tx, escopo.id, periodo) : null;
    const { usaPeriodo, ...resto } = m;
    return {
      ...resto,
      notes: base?.provisional ? [...m.notes, `${base.label}: endereços e posições podem mudar no ajuste do layout.`] : m.notes,
      type: tipo,
      scope: { name: escopo.name, demo: escopo.demo },
      period: usaPeriodo ? periodoAplicado(periodo) : null,
      consultedAt: agora.toISOString(),
      page: pagina.pagina,
      pageSize: pagina.limite,
      exportLimit: LIMITE_EXPORTACAO_RELATORIO,
    };
  });
}

/** Permissão de consulta de cada relatório (a exportação exige também `relatorio.exportar`). */
export const PERMISSAO_RELATORIO = {
  paletes: 'palete.consultar',
  estoque: 'palete.consultar',
  expedicoes: 'janela.consultar',
  claims: 'claim.consultar',
  piloto: 'palete.consultar',
} as const satisfies Record<TipoRelatorio, string>;
