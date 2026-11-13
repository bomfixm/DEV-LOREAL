/**
 * Leitura da carga de uma janela (Expedição DHL): veículos, paletes de
 * embarque, linhas, conferência documental vigente e emissões, com as
 * pendências calculadas no servidor (nada é marcado como pronto só por estar
 * ocupado).
 */
import {
  TEXTO_BAIXA_CARGA,
  identidadeEmbarque,
  rotuloPaleteEmbarque,
  rotuloVeiculo,
  type CargaJanela,
  type EmissaoResumo,
  type JanelasCarga,
  type LinhaEmbarque,
  type PaleteEmbarque,
  type SelecaoExpedicao,
  type SituacaoDocs,
  type TipoVeiculo,
  type VeiculoCarga,
  type Escopo,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';
import { naoEncontrado } from '../../http/erros.js';

type Db = Banco | Transacao;

export interface JanelaLida {
  id: string;
  codigo: string;
  nome: string;
  situacao: string;
}

export async function lerJanelaCarga(db: Db, escopoId: string, janelaId: string): Promise<JanelaLida> {
  const [j] = await db.$queryRaw<JanelaLida[]>`
    SELECT id::text, codigo, nome, situacao::text FROM janela_devolucao WHERE id = ${janelaId}::uuid AND escopo_id = ${escopoId}::uuid`;
  if (!j) throw naoEncontrado('Janela não encontrada neste escopo.');
  return j;
}

export async function janelasParaCarga(db: Db, escopo: Escopo): Promise<JanelasCarga> {
  const linhas = await db.$queryRaw<{ id: string; codigo: string; nome: string; situacao: string; veiculos: bigint; paletes: bigint }[]>`
    SELECT j.id::text, j.codigo, j.nome, j.situacao::text,
           (SELECT count(*) FROM veiculo_carga v WHERE v.janela_id = j.id AND v.situacao <> 'CANCELADO') AS veiculos,
           (SELECT count(*) FROM palete_embarque pe JOIN veiculo_carga v ON v.id = pe.veiculo_id
             WHERE v.janela_id = j.id AND v.situacao <> 'CANCELADO' AND pe.situacao = 'ATIVO') AS paletes
      FROM janela_devolucao j
     WHERE j.escopo_id = ${escopo.id}::uuid AND j.situacao::text NOT IN ('CANCELADA')
     ORDER BY j.mes_referencia DESC, j.numero DESC
     LIMIT 200`;
  return { items: linhas.map((l) => ({ id: l.id, code: l.codigo, name: l.nome, state: l.situacao, vehicles: Number(l.veiculos), pallets: Number(l.paletes) })) };
}

interface VeiculoLinha {
  id: string;
  tipo: TipoVeiculo;
  sequencia: number;
  capacidade: number;
  nome: string | null;
  placa: string | null;
  fileiras: number;
  colunas: number;
  disposicao_confirmada: boolean;
  situacao: 'MONTAGEM' | 'FECHADO' | 'CANCELADO';
  versao: number;
}

interface PaleteLinha {
  id: string;
  veiculo_id: string;
  numero: number;
  posicao: number | null;
  posicao_confirmada: boolean;
  posicao_confirmada_em: Date | null;
  tipo: 'FULL' | 'FRACIONADO';
  palete_origem_id: string | null;
  origem_codigo: string | null;
  revisao: number;
  fisico_revisao: number | null;
  fisico_por: string | null;
  fisico_em: Date | null;
  situacao: 'ATIVO' | 'CANCELADO';
  motivo_cancelamento: string | null;
  versao: number;
}

interface EmissaoLinha {
  veiculo_id: string;
  palete_embarque_id: string | null;
  tipo: EmissaoResumo['kind'];
  final: boolean;
  revisao: number | null;
  identidade: string;
  fotografia: unknown;
  autor: string;
  emitido_em: Date;
}

/** Fotografia das posições de um veículo: confirmadas (mapa final) ou planejadas (prévia). */
export function fotografiaMapa(paletes: readonly { numero: number; posicao: number | null; posicao_confirmada: boolean; situacao: string }[], soConfirmadas: boolean): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const p of [...paletes].sort((a, b) => a.numero - b.numero)) if (p.situacao === 'ATIVO' && p.posicao !== null && (!soConfirmadas || p.posicao_confirmada)) saida[String(p.numero)] = p.posicao;
  return saida;
}

function mesmaFotografia(a: unknown, b: Record<string, number>): boolean {
  if (typeof a !== 'object' || a === null) return false;
  const x = a as Record<string, unknown>;
  const ka = Object.keys(x).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && x[k] === b[k]);
}

/** Carga completa da janela (todos os veículos, inclusive cancelados para histórico). */
export async function cargaDaJanela(db: Db, escopo: Escopo, janelaId: string, agora: Date): Promise<CargaJanela> {
  const j = await lerJanelaCarga(db, escopo.id, janelaId);
  const veiculos = await db.$queryRaw<VeiculoLinha[]>`
    SELECT id::text, tipo, sequencia, capacidade, nome, placa, fileiras, colunas, disposicao_confirmada, situacao, versao
      FROM veiculo_carga WHERE escopo_id = ${escopo.id}::uuid AND janela_id = ${janelaId}::uuid
     ORDER BY CASE situacao WHEN 'CANCELADO' THEN 1 ELSE 0 END, tipo, sequencia`;
  const ids = veiculos.map((v) => v.id);
  const paletes =
    ids.length === 0
      ? []
      : await db.$queryRaw<PaleteLinha[]>`
          SELECT pe.id::text, pe.veiculo_id::text, pe.numero, pe.posicao, pe.posicao_confirmada, pe.posicao_confirmada_em, pe.tipo,
                 pe.palete_origem_id::text, po.codigo AS origem_codigo, pe.revisao, pe.fisico_revisao, uf.nome AS fisico_por, pe.fisico_em,
                 pe.situacao, pe.motivo_cancelamento, pe.versao
            FROM palete_embarque pe
            LEFT JOIN palete po ON po.id = pe.palete_origem_id
            LEFT JOIN usuario uf ON uf.id = pe.fisico_por_id
           WHERE pe.escopo_id = ${escopo.id}::uuid AND pe.veiculo_id = ANY(${ids}::uuid[])
           ORDER BY pe.numero, pe.criado_em`;
  const pids = paletes.map((p) => p.id);
  const [linhas, docs, emissoes] =
    pids.length === 0 && ids.length === 0
      ? [[], [], []]
      : await Promise.all([
          pids.length === 0
            ? []
            : db.$queryRaw<
                {
                  id: string;
                  palete_embarque_id: string;
                  vinculo_id: string | null;
                  conteudo_id: string | null;
                  palete_origem_id: string;
                  palete_origem_codigo: string;
                  volumes: number;
                  tipo_documento: string | null;
                  numero_documento: string | null;
                  remetente: string | null;
                  delivery: string | null;
                }[]
              >`
                SELECT id::text, palete_embarque_id::text, vinculo_id::text, conteudo_id::text, palete_origem_id::text, palete_origem_codigo, volumes,
                       tipo_documento, numero_documento, remetente, delivery
                  FROM linha_palete_embarque WHERE escopo_id = ${escopo.id}::uuid AND palete_embarque_id = ANY(${pids}::uuid[]) AND removida_em IS NULL
                 ORDER BY ordem, id`,
          pids.length === 0
            ? []
            : db.$queryRaw<{ linha_id: string; situacao: 'CONFERIDO' | 'FALTANTE' | 'DIVERGENTE'; observacao: string | null; autor: string; registrado_em: Date }[]>`
                SELECT DISTINCT ON (d.linha_id) d.linha_id::text, d.situacao, d.observacao, u.nome AS autor, d.registrado_em
                  FROM documento_embarque d
                  JOIN palete_embarque pe ON pe.id = d.palete_embarque_id AND pe.revisao = d.revisao
                  JOIN usuario u ON u.id = d.autor_id
                 WHERE d.escopo_id = ${escopo.id}::uuid AND d.palete_embarque_id = ANY(${pids}::uuid[])
                 ORDER BY d.linha_id, d.registrado_em DESC, d.id DESC`,
          db.$queryRaw<EmissaoLinha[]>`
            SELECT DISTINCT ON (e.veiculo_id, e.palete_embarque_id, e.tipo)
                   e.veiculo_id::text, e.palete_embarque_id::text, e.tipo, e.final, e.revisao, e.identidade, e.fotografia, u.nome AS autor, e.emitido_em
              FROM emissao_embarque e JOIN usuario u ON u.id = e.autor_id
             WHERE e.escopo_id = ${escopo.id}::uuid AND e.veiculo_id = ANY(${ids}::uuid[])
             ORDER BY e.veiculo_id, e.palete_embarque_id, e.tipo, e.emitido_em DESC, e.id DESC`,
        ]);
  const docPor = new Map(docs.map((d) => [d.linha_id, d]));
  const linhasPor = new Map<string, LinhaEmbarque[]>();
  for (const l of linhas) {
    const d = docPor.get(l.id);
    const lista = linhasPor.get(l.palete_embarque_id) ?? [];
    lista.push({
      id: l.id,
      occurrence: l.vinculo_id !== null ? { kind: 'VINCULO', id: l.vinculo_id } : { kind: 'CONTEUDO', id: l.conteudo_id ?? '' },
      sourcePalletId: l.palete_origem_id,
      sourcePalletCode: l.palete_origem_codigo,
      volumes: l.volumes,
      documentType: l.tipo_documento,
      documentNumber: l.numero_documento,
      sender: l.remetente,
      delivery: l.delivery,
      doc: d ? { state: d.situacao, note: d.observacao, by: d.autor, at: d.registrado_em.toISOString() } : null,
    });
    linhasPor.set(l.palete_embarque_id, lista);
  }
  const emissoesPalete = new Map<string, EmissaoLinha[]>();
  const mapaPor = new Map<string, EmissaoLinha>();
  for (const e of emissoes) {
    if (e.palete_embarque_id === null) {
      if (e.tipo === 'MAPA') mapaPor.set(e.veiculo_id, e);
      continue;
    }
    const lista = emissoesPalete.get(e.palete_embarque_id) ?? [];
    lista.push(e);
    emissoesPalete.set(e.palete_embarque_id, lista);
  }

  const veiculosSaida: VeiculoCarga[] = veiculos.map((v) => {
    const doVeiculo = paletes.filter((p) => p.veiculo_id === v.id);
    const ativos = doVeiculo.filter((p) => p.situacao === 'ATIVO');
    const pallets: PaleteEmbarque[] = doVeiculo.map((p) => {
      const identidade = identidadeEmbarque(j.codigo, v.tipo, v.sequencia, p.numero);
      const ls = linhasPor.get(p.id) ?? [];
      const fisico = p.fisico_revisao !== null && p.fisico_revisao === p.revisao;
      const conferidos = ls.filter((l) => l.doc?.state === 'CONFERIDO').length;
      const faltantes = ls.filter((l) => l.doc?.state === 'FALTANTE').length;
      const divergentes = ls.filter((l) => l.doc?.state === 'DIVERGENTE').length;
      const pendentes = ls.length - conferidos - faltantes - divergentes;
      const situacaoDocs: SituacaoDocs = !fisico ? 'AGUARDANDO_FISICO' : faltantes + divergentes > 0 ? 'COM_PROBLEMA' : pendentes > 0 || ls.length === 0 ? 'PENDENTE' : 'CONFERIDA';
      const emissions: EmissaoResumo[] = (emissoesPalete.get(p.id) ?? []).map((e) => ({
        kind: e.tipo,
        final: e.final,
        revision: e.revisao,
        identity: e.identidade,
        at: e.emitido_em.toISOString(),
        by: e.autor,
        // Etiqueta segue a identidade; espelho e lista de documentos seguem também a revisão do conteúdo.
        outdated: e.identidade !== identidade || (e.tipo !== 'ETIQUETA' && e.revisao !== p.revisao),
      }));
      return {
        id: p.id,
        vehicleId: v.id,
        number: p.numero,
        label: rotuloPaleteEmbarque(p.numero),
        identity: identidade,
        position: p.posicao,
        positionConfirmed: p.posicao_confirmada,
        positionConfirmedAt: p.posicao_confirmada_em?.toISOString() ?? null,
        kind: p.tipo,
        sourcePalletId: p.palete_origem_id,
        sourcePalletCode: p.origem_codigo,
        revision: p.revisao,
        physical: { checked: fisico, revision: p.fisico_revisao, by: p.fisico_por, at: p.fisico_em?.toISOString() ?? null },
        docs: { state: situacaoDocs, total: ls.length, checked: conferidos, missing: faltantes, divergent: divergentes, pending: pendentes },
        volumes: ls.reduce((s, l) => s + l.volumes, 0),
        lines: ls,
        state: p.situacao,
        cancelReason: p.motivo_cancelamento,
        version: p.versao,
        emissions,
      };
    });
    const ativosSaida = pallets.filter((p) => p.state === 'ATIVO');
    const pending: string[] = [];
    if (ativosSaida.length === 0) pending.push('Nenhum palete na carga.');
    const semPosicao = ativosSaida.filter((p) => p.position === null).length;
    if (semPosicao > 0) pending.push(`${String(semPosicao)} palete(s) sem posição no veículo.`);
    const naoConfirmada = ativosSaida.filter((p) => p.position !== null && !p.positionConfirmed).length;
    if (naoConfirmada > 0) pending.push(`${String(naoConfirmada)} posição(ões) planejada(s) sem confirmação no carregamento.`);
    const semFisico = ativosSaida.filter((p) => !p.physical.checked).length;
    if (semFisico > 0) pending.push(`${String(semFisico)} palete(s) sem físico conferido.`);
    const docsProblema = ativosSaida.filter((p) => p.docs.state === 'COM_PROBLEMA').length;
    if (docsProblema > 0) pending.push(`${String(docsProblema)} palete(s) com documento faltante ou divergente.`);
    const docsPendentes = ativosSaida.filter((p) => p.docs.state === 'PENDENTE').length;
    if (docsPendentes > 0) pending.push(`${String(docsPendentes)} palete(s) com documentação pendente.`);
    if (!v.disposicao_confirmada) pending.push('Disposição do veículo provisória: confirme a grade com a operação.');
    const m = mapaPor.get(v.id);
    return {
      id: v.id,
      kind: v.tipo,
      sequence: v.sequencia,
      label: rotuloVeiculo(v.tipo, v.sequencia),
      name: v.nome,
      plate: v.placa,
      capacity: v.capacidade,
      rows: v.fileiras,
      cols: v.colunas,
      layoutConfirmed: v.disposicao_confirmada,
      state: v.situacao,
      version: v.versao,
      occupied: ativosSaida.length,
      positioned: ativosSaida.filter((p) => p.position !== null).length,
      confirmedPositions: ativosSaida.filter((p) => p.positionConfirmed).length,
      pallets,
      pending: v.situacao === 'CANCELADO' ? [] : pending,
      map: m
        ? {
            kind: 'MAPA',
            final: m.final,
            revision: null,
            identity: m.identidade,
            at: m.emitido_em.toISOString(),
            by: m.autor,
            outdated: !mesmaFotografia((m.fotografia as { posicoes?: unknown }).posicoes, fotografiaMapa(ativos, m.final)),
          }
        : null,
    };
  });

  return {
    window: { id: j.id, code: j.codigo, name: j.nome, state: j.situacao },
    vehicles: veiculosSaida,
    stockEffect: TEXTO_BAIXA_CARGA,
    scope: { name: escopo.name, demo: escopo.demo },
    generatedAt: agora.toISOString(),
  };
}

/** Chave de contagem da seleção: a linha da ficha do palete (documento no palete de origem); sem número, a própria ocorrência. */
const CHAVE_NOTA = `CASE WHEN l.numero_documento IS NULL THEN coalesce(l.conteudo_id, l.vinculo_id)::text
                         ELSE l.palete_origem_id::text || '|' || coalesce(l.tipo_documento, '') || '|' || l.numero_documento END`;

/**
 * Seleção atual da Expedição (atalho flutuante do mapa): linhas ativas dos
 * veículos em montagem das janelas abertas do escopo. Com `paleteId`, também
 * onde cada ocorrência desse palete de origem já está (qualquer veículo não cancelado).
 */
export async function selecaoExpedicao(db: Db, escopoId: string, paleteId: string | null): Promise<SelecaoExpedicao> {
  const filtro = Prisma.sql`
      FROM linha_palete_embarque l
      JOIN palete_embarque pe ON pe.id = l.palete_embarque_id AND pe.situacao = 'ATIVO'
      JOIN veiculo_carga v ON v.id = pe.veiculo_id AND v.situacao = 'MONTAGEM'
      JOIN janela_devolucao j ON j.id = v.janela_id AND j.situacao::text NOT IN ('CANCELADA', 'ENCERRADA')
     WHERE l.escopo_id = ${escopoId}::uuid AND l.removida_em IS NULL`;
  const chave = Prisma.raw(CHAVE_NOTA);
  const [[total], porVeiculo, doPalete] = await Promise.all([
    db.$queryRaw<{ notas: bigint; volumes: bigint | null }[]>`SELECT count(DISTINCT ${chave}) AS notas, sum(l.volumes) AS volumes ${filtro}`,
    db.$queryRaw<{ id: string; janela_id: string; codigo: string; tipo: TipoVeiculo; sequencia: number; notas: bigint }[]>`
      SELECT v.id::text, v.janela_id::text, j.codigo, v.tipo, v.sequencia, count(DISTINCT ${chave}) AS notas ${filtro}
       GROUP BY v.id, v.janela_id, j.codigo, v.tipo, v.sequencia
       ORDER BY j.codigo, v.tipo, v.sequencia`,
    paleteId === null
      ? Promise.resolve([])
      : db.$queryRaw<{ alvo: string; codigo: string; tipo: TipoVeiculo; sequencia: number; numero: number; volumes: number; situacao: 'MONTAGEM' | 'FECHADO' }[]>`
          SELECT coalesce(l.conteudo_id, l.vinculo_id)::text AS alvo, j.codigo, v.tipo, v.sequencia, pe.numero, l.volumes, v.situacao
            FROM linha_palete_embarque l
            JOIN palete_embarque pe ON pe.id = l.palete_embarque_id AND pe.situacao = 'ATIVO'
            JOIN veiculo_carga v ON v.id = pe.veiculo_id AND v.situacao <> 'CANCELADO'
            JOIN janela_devolucao j ON j.id = v.janela_id AND j.situacao::text NOT IN ('CANCELADA', 'ENCERRADA')
           WHERE l.escopo_id = ${escopoId}::uuid AND l.palete_origem_id = ${paleteId}::uuid AND l.removida_em IS NULL
           ORDER BY j.codigo, v.tipo, v.sequencia, pe.numero`,
  ]);
  return {
    notes: Number(total?.notas ?? 0),
    volumes: Number(total?.volumes ?? 0),
    vehicles: porVeiculo.map((v) => ({ id: v.id, windowId: v.janela_id, windowCode: v.codigo, label: rotuloVeiculo(v.tipo, v.sequencia), notes: Number(v.notas) })),
    pallet: doPalete.map((l) => ({ occurrenceId: l.alvo, identity: identidadeEmbarque(l.codigo, l.tipo, l.sequencia, l.numero), volumes: l.volumes, vehicleState: l.situacao })),
  };
}
