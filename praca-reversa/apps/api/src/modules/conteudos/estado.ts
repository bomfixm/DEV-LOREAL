/**
 * Quantidade atual e conferência de volumes (21 out. 2026).
 *
 * - Quantidade atual de uma ocorrência = a contagem mais recente DELA (pelo
 *   alvo, em qualquer palete onde foi contada) ou, sem contagem, os volumes do
 *   inventário. Antes, a leitura filtrava pelo palete e uma ocorrência movida
 *   voltava a mostrar o valor importado.
 * - Conferência por ocorrência: a mais recente depois de entrar no palete atual
 *   (conferência em tabela, contagem avulsa antiga ou conferência completa
 *   antiga do palete). Diferença = contado − anterior.
 * - Estado do palete: CONFERIDO / CONFERIDO_COM_DIFERENCA quando a última
 *   conferência completa abrange todos os conteúdos atuais; PARCIAL quando só
 *   parte foi conferida; NAO_CONFERIDO sem nenhuma. Separado da ocupação e da
 *   conferência por SKU.
 */
import type { ConferenciaItem, ConferenciaVolumesPalete } from '@praca-reversa/contracts';
import { createHash } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';

type Db = Banco | Transacao;

export type TipoAlvo = 'REGISTRADO' | 'IMPORTADO';

export interface OcorrenciaAtiva {
  kind: TipoAlvo;
  id: string;
  paleteId: string;
  alocadoEm: Date;
  /** Quantidade atual (inteira); `null` = desconhecida. */
  atual: number | null;
  documento: string;
}

interface Cobertura {
  alvo: string;
  em: Date;
  login: string | null;
  nome: string | null;
  anterior: number | null;
  contado: number | null;
  operacao: string | null;
  escopo: 'COMPLETA' | 'PARCIAL' | 'AVULSA';
}

interface Completa {
  palete_id: string;
  em: Date;
  login: string | null;
  nome: string | null;
  resultado: string;
  /** Registrada pela conferência em tabela (tem itens próprios). */
  com_itens: boolean;
}

/** Ocorrências ativas dos paletes (todos os do escopo quando `paleteIds` é nulo), com a quantidade atual. */
export async function ocorrenciasAtivas(db: Db, escopoId: string, paleteIds: readonly string[] | null): Promise<OcorrenciaAtiva[]> {
  const ids = paleteIds === null ? null : [...new Set(paleteIds)];
  if (ids !== null && ids.length === 0) return [];
  const linhas = await db.$queryRaw<{ kind: TipoAlvo; id: string; palete_id: string; alocado_em: Date; atual: number | null; documento: string }[]>`
    WITH itens AS (
      SELECT 'IMPORTADO'::text AS kind, v.id, v.palete_id, coalesce(v.alocado_em, v.criado_em) AS alocado_em,
             CASE WHEN v.volumes IS NOT NULL AND v.volumes = trunc(v.volumes) AND v.volumes <= 100000 THEN v.volumes::int END AS base,
             btrim(coalesce(v.tipo_documento, '') || ' ' || v.numero_documento) AS documento
        FROM vinculo_documento_palete v
       WHERE v.escopo_id = ${escopoId}::uuid AND v.situacao = 'ATIVO' AND (${ids}::uuid[] IS NULL OR v.palete_id = ANY(${ids}::uuid[]))
      UNION ALL
      SELECT 'REGISTRADO', c.id, c.palete_id, coalesce(c.alocado_em, c.criado_em), NULL::int,
             coalesce(nullif(btrim(coalesce(c.tipo_documento, '') || ' ' || coalesce(c.numero_documento, '')), ''), c.remetente)
        FROM conteudo_palete c
       WHERE c.escopo_id = ${escopoId}::uuid AND c.situacao = 'ATIVO' AND (${ids}::uuid[] IS NULL OR c.palete_id = ANY(${ids}::uuid[]))
    )
    SELECT i.kind, i.id::text, i.palete_id::text, i.alocado_em, coalesce(k.volumes_contados, i.base) AS atual, i.documento
      FROM itens i
      LEFT JOIN LATERAL (
        SELECT k.volumes_contados FROM contagem_volumes k
         WHERE k.escopo_id = ${escopoId}::uuid AND (k.conteudo_id = i.id OR k.vinculo_id = i.id)
         ORDER BY k.registrada_em DESC, k.id DESC LIMIT 1) k ON true
     ORDER BY i.palete_id, i.alocado_em, i.id`;
  return linhas.map((l) => ({ kind: l.kind, id: l.id, paleteId: l.palete_id, alocadoEm: l.alocado_em, atual: l.atual, documento: l.documento }));
}

/** Quantidade atual de ocorrências quaisquer (ativas ou não), pelo alvo. */
export async function quantidadesAtuais(db: Db, escopoId: string, ids: readonly string[]): Promise<Map<string, number | null>> {
  if (ids.length === 0) return new Map();
  const linhas = await db.$queryRaw<{ id: string; atual: number | null }[]>`
    SELECT x.id::text, coalesce(
             (SELECT k.volumes_contados FROM contagem_volumes k
               WHERE k.escopo_id = ${escopoId}::uuid AND (k.conteudo_id = x.id OR k.vinculo_id = x.id)
               ORDER BY k.registrada_em DESC, k.id DESC LIMIT 1),
             (SELECT CASE WHEN v.volumes IS NOT NULL AND v.volumes = trunc(v.volumes) AND v.volumes <= 100000 THEN v.volumes::int END
                FROM vinculo_documento_palete v WHERE v.id = x.id)) AS atual
      FROM unnest(${[...new Set(ids)]}::uuid[]) AS x(id)`;
  return new Map(linhas.map((l) => [l.id, l.atual]));
}

/** Coberturas (conferências) das ocorrências: em tabela e contagens avulsas antigas. */
async function coberturas(db: Db, escopoId: string, alvos: readonly string[]): Promise<Cobertura[]> {
  if (alvos.length === 0) return [];
  return db.$queryRaw<Cobertura[]>`
    SELECT coalesce(i.conteudo_id, i.vinculo_id)::text AS alvo, cv.registrada_em AS em, u.login, u.nome,
           i.volumes_anteriores AS anterior, i.volumes_contados AS contado, cv.id::text AS operacao, cv.abrangencia AS escopo
      FROM item_conferencia_volumes i
      JOIN conferencia_volumes cv ON cv.id = i.conferencia_id
      JOIN usuario u ON u.id = cv.registrada_por_id
     WHERE i.escopo_id = ${escopoId}::uuid AND coalesce(i.conteudo_id, i.vinculo_id) = ANY(${[...alvos]}::uuid[])
    UNION ALL
    SELECT x.alvo::text, x.registrada_em, u.login, u.nome,
           coalesce(x.anterior, (SELECT CASE WHEN v.volumes = trunc(v.volumes) AND v.volumes <= 100000 THEN v.volumes::int END
                                   FROM vinculo_documento_palete v WHERE v.id = x.vinculo_id)),
           x.volumes_contados, NULL, 'AVULSA'
      FROM (
        SELECT coalesce(k.conteudo_id, k.vinculo_id) AS alvo, k.vinculo_id, k.registrada_em, k.registrada_por_id, k.volumes_contados, k.origem, k.conferencia_id,
               lag(k.volumes_contados) OVER (PARTITION BY coalesce(k.conteudo_id, k.vinculo_id) ORDER BY k.registrada_em, k.id) AS anterior
          FROM contagem_volumes k
         WHERE k.escopo_id = ${escopoId}::uuid AND coalesce(k.conteudo_id, k.vinculo_id) = ANY(${[...alvos]}::uuid[])) x
      JOIN usuario u ON u.id = x.registrada_por_id
     WHERE x.origem IN ('CONTAGEM_FISICA', 'CONTAGEM_INFORMADA') AND x.conferencia_id IS NULL`;
}

/** Última conferência completa de cada palete (inclui as registradas antes da tabela). */
async function completas(db: Db, escopoId: string, paleteIds: readonly string[]): Promise<Map<string, Completa>> {
  if (paleteIds.length === 0) return new Map();
  const linhas = await db.$queryRaw<Completa[]>`
    SELECT DISTINCT ON (r.palete_id) r.palete_id::text, r.registrada_em AS em, u.login, u.nome, r.resultado,
           EXISTS (SELECT 1 FROM conferencia_volumes cv WHERE cv.reconferencia_id = r.id) AS com_itens
      FROM reconferencia_palete r JOIN usuario u ON u.id = r.registrada_por_id
     WHERE r.escopo_id = ${escopoId}::uuid AND r.palete_id = ANY(${[...new Set(paleteIds)]}::uuid[])
     ORDER BY r.palete_id, r.registrada_em DESC, r.id DESC`;
  return new Map(linhas.map((l) => [l.palete_id, l]));
}

const NAO_CONFERIDO_ITEM: ConferenciaItem = { state: 'NAO_CONFERIDO', at: null, by: null, previous: null, counted: null, difference: null, operationId: null, scope: null };

export interface ConferenciaCalculada {
  porPalete: Map<string, ConferenciaVolumesPalete>;
  porItem: Map<string, ConferenciaItem>;
}

/** Conferência das ocorrências ativas e dos paletes (os sem ocorrência ativa ficam NAO_CONFERIDO com 0 itens). */
export async function calcularConferencia(db: Db, escopoId: string, ocorrencias: readonly OcorrenciaAtiva[], paleteIds: readonly string[]): Promise<ConferenciaCalculada> {
  const todos = [...new Set([...paleteIds, ...ocorrencias.map((o) => o.paleteId)])];
  const [cobs, comp] = await Promise.all([
    coberturas(
      db,
      escopoId,
      ocorrencias.map((o) => o.id),
    ),
    completas(db, escopoId, todos),
  ]);
  const maisRecente = new Map<string, Cobertura>();
  const alocacao = new Map(ocorrencias.map((o) => [o.id, o.alocadoEm.getTime()]));
  for (const c of cobs) {
    const desde = alocacao.get(c.alvo);
    // Só vale a conferência feita depois da entrada no palete atual.
    if (desde === undefined || c.em.getTime() < desde) continue;
    const atual = maisRecente.get(c.alvo);
    if (atual === undefined || c.em.getTime() > atual.em.getTime() || (c.em.getTime() === atual.em.getTime() && c.escopo !== 'AVULSA')) maisRecente.set(c.alvo, c);
  }
  const porItem = new Map<string, ConferenciaItem>();
  const porPalete = new Map<string, ConferenciaVolumesPalete>();
  const grupos = new Map<string, OcorrenciaAtiva[]>();
  for (const o of ocorrencias) grupos.set(o.paleteId, [...(grupos.get(o.paleteId) ?? []), o]);
  for (const paleteId of todos) {
    const itens = grupos.get(paleteId) ?? [];
    const completa = comp.get(paleteId) ?? null;
    let cobertos = 0;
    let diferencas = 0;
    let todosNaCompleta = completa !== null && itens.length > 0;
    for (const o of itens) {
      const c = maisRecente.get(o.id);
      const naCompleta = completa !== null && completa.em.getTime() >= o.alocadoEm.getTime();
      if (!naCompleta) todosNaCompleta = false;
      if (c !== undefined) {
        const diferenca = c.anterior === null || c.contado === null ? null : c.contado - c.anterior;
        if (diferenca !== null && diferenca !== 0) diferencas++;
        cobertos++;
        porItem.set(o.id, {
          state: diferenca !== null && diferenca !== 0 ? 'CONFERIDO_COM_DIFERENCA' : 'CONFERIDO',
          at: c.em.toISOString(),
          by: c.login === null || c.nome === null ? null : { login: c.login, name: c.nome },
          previous: c.anterior,
          counted: c.contado,
          difference: diferenca,
          operationId: c.operacao,
          scope: c.escopo,
        });
      } else if (naCompleta) {
        // Conferência completa antiga (antes da tabela): abrange o conteúdo presente, sem valores por linha.
        cobertos++;
        porItem.set(o.id, {
          state: 'CONFERIDO',
          at: completa.em.toISOString(),
          by: completa.login === null || completa.nome === null ? null : { login: completa.login, name: completa.nome },
          previous: null,
          counted: null,
          difference: null,
          operationId: null,
          scope: 'COMPLETA',
        });
      } else porItem.set(o.id, NAO_CONFERIDO_ITEM);
    }
    // Completa antiga "com diferença" sem valores por linha continua mostrando a diferença.
    const diferencaAntiga = completa !== null && !completa.com_itens && completa.resultado === 'COM_DIFERENCA';
    const state: ConferenciaVolumesPalete['state'] =
      itens.length === 0 ? 'NAO_CONFERIDO' : todosNaCompleta ? (diferencas > 0 || diferencaAntiga ? 'CONFERIDO_COM_DIFERENCA' : 'CONFERIDO') : cobertos > 0 ? 'PARCIAL' : 'NAO_CONFERIDO';
    porPalete.set(paleteId, {
      state,
      items: itens.length,
      covered: cobertos,
      differences: diferencas,
      lastCompleteAt: completa?.em.toISOString() ?? null,
      lastCompleteBy: completa?.login == null || completa.nome === null ? null : { login: completa.login, name: completa.nome },
    });
  }
  return { porItem, porPalete };
}

/** Estado da conferência de volumes de vários paletes (mapa e lista). */
export async function conferenciaDosPaletes(db: Db, escopoId: string, paleteIds: readonly string[]): Promise<Map<string, ConferenciaVolumesPalete>> {
  if (paleteIds.length === 0) return new Map();
  const ocorrencias = await ocorrenciasAtivas(db, escopoId, paleteIds);
  return (await calcularConferencia(db, escopoId, ocorrencias, paleteIds)).porPalete;
}

/** Assinatura do conjunto (ocorrências e quantidades atuais): muda quando algo entra, sai ou é recontado. */
export function assinaturaConjunto(ocorrencias: readonly Pick<OcorrenciaAtiva, 'kind' | 'id' | 'atual'>[]): string {
  const texto = [...ocorrencias]
    .map((o) => `${o.kind}:${o.id}:${o.atual === null ? '-' : String(o.atual)}`)
    .sort()
    .join('|');
  return createHash('sha256').update(texto).digest('hex').slice(0, 40);
}
