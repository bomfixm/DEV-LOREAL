/**
 * Ocorrências de origem e disponibilidade para embarque (Expedição DHL).
 *
 * Ocorrência = vínculo NF × palete do inventário OU conteúdo registrado (nunca
 * agrupado só pelo número da NF). Volumes de referência = contagem vigente,
 * senão o informado inteiro do inventário (mesma regra da separação por
 * volumes, D234). Consumo por janela J = max(expedido em J, alocado em paletes
 * de embarque ativos de J): a baixa registrada e a montagem da mesma janela
 * descrevem a mesma saída e não somam duas vezes. Disponível para a janela K =
 * base − Σ consumo das outras janelas − alocado em K (sem o palete em edição).
 */
import type { OcorrenciaOrigem } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { volumesInteiros } from '../paineis/base.js';

type Db = Banco | Transacao;

export interface OcorrenciaLida extends OcorrenciaOrigem {
  palletId: string;
  palletCode: string;
  ativa: boolean;
}

export interface RefOcorrencia {
  kind: 'VINCULO' | 'CONTEUDO';
  id: string;
}

const chave = (r: RefOcorrencia) => r.id;

/** Lê as ocorrências pedidas (qualquer palete) com documento e volumes de referência. */
export async function lerOcorrencias(db: Db, escopoId: string, refs: readonly RefOcorrencia[]): Promise<Map<string, Omit<OcorrenciaLida, 'available' | 'separatedHere'>>> {
  const vinculos = refs.filter((r) => r.kind === 'VINCULO').map(chave);
  const conteudos = refs.filter((r) => r.kind === 'CONTEUDO').map(chave);
  const [lv, lc] = await Promise.all([
    vinculos.length === 0
      ? []
      : db.$queryRaw<{ id: string; palete_id: string; codigo: string; situacao: string; tipo: string | null; numero: string | null; delivery: string | null; volumes: string | null; remetente: string | null }[]>`
          SELECT v.id::text, v.palete_id::text, p.codigo, v.situacao, v.tipo_documento AS tipo, v.numero_documento AS numero, v.delivery, v.volumes::text AS volumes, li.remetente
            FROM vinculo_documento_palete v
            JOIN palete p ON p.id = v.palete_id
            LEFT JOIN linha_inventario li ON li.id = v.linha_inventario_id
           WHERE v.escopo_id = ${escopoId}::uuid AND v.id = ANY(${vinculos}::uuid[])`,
    conteudos.length === 0
      ? []
      : db.$queryRaw<{ id: string; palete_id: string; codigo: string; situacao: string; tipo: string | null; numero: string | null; delivery: string | null; remetente: string | null }[]>`
          SELECT c.id::text, c.palete_id::text, p.codigo, c.situacao, c.tipo_documento AS tipo, c.numero_documento AS numero, c.delivery, c.remetente
            FROM conteudo_palete c JOIN palete p ON p.id = c.palete_id
           WHERE c.escopo_id = ${escopoId}::uuid AND c.id = ANY(${conteudos}::uuid[])`,
  ]);
  const todos = [...vinculos, ...conteudos];
  const contagens =
    todos.length === 0
      ? []
      : await db.$queryRaw<{ alvo: string; volumes: number }[]>`
          SELECT DISTINCT ON (coalesce(conteudo_id, vinculo_id)) coalesce(conteudo_id, vinculo_id)::text AS alvo, volumes_contados AS volumes
            FROM contagem_volumes
           WHERE escopo_id = ${escopoId}::uuid AND coalesce(conteudo_id, vinculo_id) = ANY(${todos}::uuid[])
           ORDER BY coalesce(conteudo_id, vinculo_id), registrada_em DESC, id DESC`;
  const contagem = new Map(contagens.map((c) => [c.alvo, c.volumes]));
  const saida = new Map<string, Omit<OcorrenciaLida, 'available' | 'separatedHere'>>();
  for (const v of lv) {
    saida.set(v.id, {
      kind: 'VINCULO',
      id: v.id,
      palletId: v.palete_id,
      palletCode: v.codigo,
      ativa: v.situacao === 'ATIVO',
      documentType: v.tipo,
      documentNumber: v.numero,
      sender: v.remetente,
      delivery: v.delivery,
      base: contagem.get(v.id) ?? volumesInteiros(v.volumes).valor,
    });
  }
  for (const c of lc) {
    saida.set(c.id, {
      kind: 'CONTEUDO',
      id: c.id,
      palletId: c.palete_id,
      palletCode: c.codigo,
      ativa: c.situacao === 'ATIVO',
      documentType: c.tipo,
      documentNumber: c.numero,
      sender: c.remetente,
      delivery: c.delivery,
      base: contagem.get(c.id) ?? null,
    });
  }
  return saida;
}

/** Ocorrências ativas de um palete de origem (vínculos do inventário e conteúdos registrados). */
export async function ocorrenciasDoPalete(db: Db, escopoId: string, paleteId: string): Promise<RefOcorrencia[]> {
  const linhas = await db.$queryRaw<{ id: string; kind: 'VINCULO' | 'CONTEUDO' }[]>`
    SELECT id::text, 'VINCULO' AS kind FROM vinculo_documento_palete WHERE escopo_id = ${escopoId}::uuid AND palete_id = ${paleteId}::uuid AND situacao = 'ATIVO'
    UNION ALL
    SELECT id::text, 'CONTEUDO' AS kind FROM conteudo_palete WHERE escopo_id = ${escopoId}::uuid AND palete_id = ${paleteId}::uuid AND situacao = 'ATIVO'`;
  return linhas.map((l) => ({ kind: l.kind, id: l.id }));
}

/**
 * Disponível para a janela `janelaId` por ocorrência, sem contar as linhas do
 * palete de embarque `excluirPalete` (edição). Também devolve o separado
 * aguardando nesta janela (informativo).
 */
export async function disponibilidade(
  db: Db,
  escopoId: string,
  janelaId: string,
  ids: readonly string[],
  bases: ReadonlyMap<string, number | null>,
  excluirPalete: string | null,
): Promise<Map<string, { available: number | null; separatedHere: number }>> {
  const saida = new Map<string, { available: number | null; separatedHere: number }>();
  if (ids.length === 0) return saida;
  const [eventos, alocados] = await Promise.all([
    db.$queryRaw<{ alvo: string; janela_id: string; tipo: string; volumes: bigint }[]>`
      SELECT coalesce(conteudo_id, vinculo_id)::text AS alvo, janela_id::text, tipo, sum(volumes) AS volumes
        FROM evento_volumes_janela
       WHERE escopo_id = ${escopoId}::uuid AND coalesce(conteudo_id, vinculo_id) = ANY(${ids}::uuid[])
       GROUP BY 1, 2, 3`,
    db.$queryRaw<{ alvo: string; janela_id: string; volumes: bigint }[]>`
      SELECT coalesce(l.conteudo_id, l.vinculo_id)::text AS alvo, v.janela_id::text, sum(l.volumes) AS volumes
        FROM linha_palete_embarque l
        JOIN palete_embarque pe ON pe.id = l.palete_embarque_id
        JOIN veiculo_carga v ON v.id = pe.veiculo_id
       WHERE l.escopo_id = ${escopoId}::uuid AND coalesce(l.conteudo_id, l.vinculo_id) = ANY(${ids}::uuid[])
         AND l.removida_em IS NULL AND pe.situacao = 'ATIVO' AND v.situacao <> 'CANCELADO'
         AND (${excluirPalete}::uuid IS NULL OR pe.id <> ${excluirPalete}::uuid)
       GROUP BY 1, 2`,
  ]);
  interface Soma {
    e: number;
    sep: number;
    alocado: number;
  }
  const por = new Map<string, Map<string, Soma>>();
  const soma = (alvo: string, janela: string): Soma => {
    let m = por.get(alvo);
    if (!m) por.set(alvo, (m = new Map<string, Soma>()));
    let s = m.get(janela);
    if (!s) m.set(janela, (s = { e: 0, sep: 0, alocado: 0 }));
    return s;
  };
  for (const ev of eventos) {
    const s = soma(ev.alvo, ev.janela_id);
    const n = Number(ev.volumes);
    if (ev.tipo === 'EXPEDICAO') s.e += n;
    else if (ev.tipo === 'ESTORNO_EXPEDICAO') s.e -= n;
    else if (ev.tipo === 'SEPARACAO') s.sep += n;
    else if (ev.tipo === 'ESTORNO_SEPARACAO') s.sep -= n;
  }
  for (const a of alocados) soma(a.alvo, a.janela_id).alocado += Number(a.volumes);
  for (const id of ids) {
    const m: Map<string, Soma> = por.get(id) ?? new Map<string, Soma>();
    const desta = m.get(janelaId) ?? { e: 0, sep: 0, alocado: 0 };
    let outras = 0;
    for (const [janela, s] of m) if (janela !== janelaId) outras += Math.max(s.e, s.alocado);
    const base = bases.get(id) ?? null;
    // Separado aguardando nesta janela = separado − expedido (Painel, D233).
    const separatedHere = Math.max(desta.sep - desta.e, 0);
    saida.set(id, { available: base === null ? null : Math.max(base - outras - desta.alocado, 0), separatedHere });
  }
  return saida;
}
