/**
 * Fila interna "Validação urgente — sem endereço" e histórico real das
 * ocorrências (21 out. 2026). A fila não é posição física, não ocupa
 * capacidade e nunca chega ao cliente (rota interna; as consultas do cliente
 * só leem ocorrências ATIVAS). O último palete/endereço é HISTÓRICO.
 * O histórico mostra só eventos registrados: autor ausente = "não registrado",
 * nada é reconstruído como se tivesse sido auditado.
 */
import type { EventoOcorrencia, FilaValidacao, ItemValidacao, ResumoValidacao } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { quantidadesAtuais } from './estado.js';

type Db = Banco | Transacao;

const pessoa = (login: string | null, nome: string | null) => (login === null || nome === null ? null : { login, name: nome });

const TEXTO_ORIGEM: Readonly<Record<string, string>> = {
  CONTAGEM_FISICA: 'contada no aplicativo',
  CONTAGEM_INFORMADA: 'contagem já feita, informada',
  BIPAGEM: 'lidos na bipagem',
};

const rotuloPalete = (codigo: string | null, endereco: string | null) => (codigo === null ? 'palete não informado' : `palete ${codigo}${endereco === null ? '' : ` (${endereco})`}`);

/** Eventos registrados de cada ocorrência, em ordem de data. */
export async function historicoOcorrencias(db: Db, escopoId: string, ids: readonly string[]): Promise<Map<string, EventoOcorrencia[]>> {
  const mapa = new Map<string, EventoOcorrencia[]>();
  if (ids.length === 0) return mapa;
  const lista = [...new Set(ids)];
  const add = (id: string, e: EventoOcorrencia) => {
    mapa.set(id, [...(mapa.get(id) ?? []), e]);
  };
  const [vinculos, conteudos, contagens, conferencias, correcoes] = await Promise.all([
    db.$queryRaw<{ id: string; criado_em: Date; login: string | null; nome: string | null; inv: string; linha: number; npal: string | null; endereco: string | null; situacao: string; encerrado_em: Date | null; motivo: string | null; elogin: string | null; enome: string | null }[]>`
      SELECT v.id::text, v.criado_em, u.login, u.nome, i.codigo AS inv, li.linha_arquivo AS linha, li.numero_palete AS npal, coalesce(li.endereco_canonico, li.endereco_lido) AS endereco,
             v.situacao, v.encerrado_em, v.motivo_encerramento AS motivo, ue.login AS elogin, ue.nome AS enome
        FROM vinculo_documento_palete v JOIN inventario_referencia i ON i.id = v.inventario_id JOIN linha_inventario li ON li.id = v.linha_inventario_id
        LEFT JOIN usuario u ON u.id = v.criado_por_id LEFT JOIN usuario ue ON ue.id = v.encerrado_por_id
       WHERE v.escopo_id = ${escopoId}::uuid AND v.id = ANY(${lista}::uuid[])`,
    db.$queryRaw<{ id: string; criado_em: Date; login: string | null; nome: string | null; origem: string; arquivo: string | null; linha: number | null }[]>`
      SELECT c.id::text, c.criado_em, u.login, u.nome, c.origem, l.nome_arquivo AS arquivo, c.linha_arquivo AS linha
        FROM conteudo_palete c LEFT JOIN usuario u ON u.id = c.criado_por_id LEFT JOIN lote_importacao l ON l.id = c.lote_importacao_id
       WHERE c.escopo_id = ${escopoId}::uuid AND c.id = ANY(${lista}::uuid[])`,
    db.$queryRaw<{ alvo: string; em: Date; login: string | null; nome: string | null; contados: number; origem: string; conferencia: string | null; codigo: string }[]>`
      SELECT coalesce(k.conteudo_id, k.vinculo_id)::text AS alvo, k.registrada_em AS em, u.login, u.nome, k.volumes_contados AS contados, k.origem, k.conferencia_id::text AS conferencia, p.codigo
        FROM contagem_volumes k LEFT JOIN usuario u ON u.id = k.registrada_por_id JOIN palete p ON p.id = k.palete_id
       WHERE k.escopo_id = ${escopoId}::uuid AND coalesce(k.conteudo_id, k.vinculo_id) = ANY(${lista}::uuid[])`,
    db.$queryRaw<{ alvo: string; em: Date; login: string | null; nome: string | null; anterior: number | null; contado: number; abrangencia: string; operacao: string; codigo: string }[]>`
      SELECT coalesce(i.conteudo_id, i.vinculo_id)::text AS alvo, cv.registrada_em AS em, u.login, u.nome, i.volumes_anteriores AS anterior, i.volumes_contados AS contado,
             cv.abrangencia, cv.id::text AS operacao, p.codigo
        FROM item_conferencia_volumes i JOIN conferencia_volumes cv ON cv.id = i.conferencia_id JOIN palete p ON p.id = cv.palete_id
        LEFT JOIN usuario u ON u.id = cv.registrada_por_id
       WHERE i.escopo_id = ${escopoId}::uuid AND coalesce(i.conteudo_id, i.vinculo_id) = ANY(${lista}::uuid[])`,
    db.$queryRaw<{ alvo: string; em: Date; login: string | null; nome: string | null; acao: string; co: string | null; eo: string | null; cd: string | null; ed: string | null; motivo: string | null; operacao: string; volumes: number | null }[]>`
      SELECT coalesce(h.conteudo_id, h.vinculo_id)::text AS alvo, h.registrado_em AS em, u.login, u.nome, h.acao, h.codigo_origem AS co, h.endereco_origem AS eo,
             h.codigo_destino AS cd, h.endereco_destino AS ed, h.motivo, h.operacao_id::text AS operacao, h.volumes
        FROM historico_conteudo h LEFT JOIN usuario u ON u.id = h.autor_id
       WHERE h.escopo_id = ${escopoId}::uuid AND coalesce(h.conteudo_id, h.vinculo_id) = ANY(${lista}::uuid[])`,
  ]);
  for (const v of vinculos) {
    add(v.id, {
      at: v.criado_em.toISOString(),
      type: 'IMPORTACAO',
      text: `Importado do ${v.inv}, linha ${String(v.linha)}${v.npal === null && v.endereco === null ? '' : ` — na fonte: ${[v.npal === null ? null : `N° Pallet ${v.npal}`, v.endereco].filter((x) => x !== null).join(', ')}`}`,
      by: pessoa(v.login, v.nome),
      reason: null,
      operationId: null,
    });
    // Encerramento por versão nova do inventário (antes do histórico próprio).
    if (v.situacao === 'ENCERRADO' && v.encerrado_em !== null) {
      add(v.id, { at: v.encerrado_em.toISOString(), type: 'ENCERRAMENTO', text: 'Vínculo encerrado', by: pessoa(v.elogin, v.enome), reason: v.motivo, operationId: null });
    }
  }
  for (const c of conteudos) {
    add(c.id, {
      at: c.criado_em.toISOString(),
      type: 'REGISTRO',
      text: c.origem === 'BIPAGEM' ? `Importado da bipagem ${c.arquivo ?? ''}, linha ${String(c.linha ?? '?')}` : 'Registrado no palete',
      by: pessoa(c.login, c.nome),
      reason: null,
      operationId: null,
    });
  }
  for (const k of contagens) {
    if (k.conferencia !== null) continue; // aparece como conferência
    add(k.alvo, {
      at: k.em.toISOString(),
      type: 'CONTAGEM',
      text: `Contagem: ${String(k.contados)} volume(s) (${TEXTO_ORIGEM[k.origem] ?? k.origem}) no palete ${k.codigo}`,
      by: pessoa(k.login, k.nome),
      reason: null,
      operationId: null,
    });
  }
  for (const c of conferencias) {
    const dif = c.anterior === null ? '' : c.contado === c.anterior ? ' (sem diferença)' : ` (diferença ${c.contado - c.anterior > 0 ? '+' : ''}${String(c.contado - c.anterior)})`;
    add(c.alvo, {
      at: c.em.toISOString(),
      type: 'CONFERENCIA',
      text: `Conferência ${c.abrangencia === 'COMPLETA' ? 'completa' : 'parcial'} no palete ${c.codigo}: ${c.anterior === null ? 'sem referência' : String(c.anterior)} → ${String(c.contado)}${dif}`,
      by: pessoa(c.login, c.nome),
      reason: null,
      operationId: c.operacao,
    });
  }
  for (const h of correcoes) {
    const origem = rotuloPalete(h.co, h.eo);
    const destino = rotuloPalete(h.cd, h.ed);
    const texto =
      h.acao === 'MOVIMENTO'
        ? `Movido do ${origem} para o ${destino}`
        : h.acao === 'VALIDACAO'
          ? `Enviado à validação sem endereço (último conhecido: ${origem})`
          : h.acao === 'RESOLUCAO'
            ? `Validação resolvida: alocado no ${destino}`
            : h.acao === 'CANCELAMENTO'
              ? `Registro cancelado no ${origem}${h.volumes === null ? '' : ` (${String(h.volumes)} volume(s) retirados do estoque ativo)`}`
              : `Vínculo encerrado no ${origem}`;
    add(h.alvo, {
      at: h.em.toISOString(),
      type: h.acao === 'MOVIMENTO' ? 'MOVIMENTO' : h.acao === 'VALIDACAO' ? 'VALIDACAO' : h.acao === 'RESOLUCAO' ? 'RESOLUCAO' : h.acao === 'CANCELAMENTO' ? 'CANCELAMENTO' : 'ENCERRAMENTO',
      text: texto,
      by: pessoa(h.login, h.nome),
      reason: h.motivo,
      operationId: h.operacao,
    });
  }
  for (const [id, eventos] of mapa) mapa.set(id, eventos.sort((a, b) => a.at.localeCompare(b.at)));
  return mapa;
}

interface Pendente {
  kind: 'REGISTRADO' | 'IMPORTADO';
  id: string;
  tipo: string | null;
  numero: string | null;
  remetente: string | null;
  delivery: string | null;
  palete_id: string;
  codigo: string;
  endereco: string | null;
  fonte: string | null;
  lote: string | null;
  linha: number | null;
  inventario: string | null;
  desde: Date | null;
  motivo: string | null;
  login: string | null;
  nome: string | null;
  co: string | null;
  eo: string | null;
  criado_em: Date;
}

/** Pendências da validação (mais antigas primeiro), com histórico. */
export async function filaValidacao(db: Db, escopoId: string): Promise<FilaValidacao> {
  const linhas = await db.$queryRaw<Pendente[]>`
    WITH pend AS (
      SELECT 'IMPORTADO'::text AS kind, v.id, v.tipo_documento AS tipo, v.numero_documento AS numero, li.remetente, v.delivery, v.palete_id,
             i.codigo || ', linha ' || li.linha_arquivo AS fonte, v.inventario_id IS NOT NULL AS tem_inv, li.lote_importacao_id AS lote, li.linha_arquivo AS linha, i.codigo AS inventario, v.criado_em
        FROM vinculo_documento_palete v JOIN linha_inventario li ON li.id = v.linha_inventario_id JOIN inventario_referencia i ON i.id = v.inventario_id
       WHERE v.escopo_id = ${escopoId}::uuid AND v.situacao = 'VALIDACAO'
      UNION ALL
      SELECT 'REGISTRADO', c.id, c.tipo_documento, c.numero_documento, c.remetente, c.delivery, c.palete_id,
             CASE WHEN c.origem = 'BIPAGEM' THEN 'Bipagem, linha ' || coalesce(c.linha_arquivo::text, '?') ELSE 'Registrado à mão' END, false, c.lote_importacao_id, c.linha_arquivo, NULL, c.criado_em
        FROM conteudo_palete c
       WHERE c.escopo_id = ${escopoId}::uuid AND c.situacao = 'VALIDACAO'
    )
    SELECT x.kind, x.id::text, x.tipo, x.numero, x.remetente, x.delivery, x.palete_id::text, p.codigo,
           coalesce(CASE WHEN ep.situacao = 'CONFIRMADO' THEN ep.endereco END, pos.codigo) AS endereco,
           x.fonte, x.lote::text, x.linha, x.inventario, h.registrado_em AS desde, h.motivo, u.login, u.nome, h.codigo_origem AS co, h.endereco_origem AS eo, x.criado_em
      FROM pend x
      JOIN palete p ON p.id = x.palete_id
      LEFT JOIN posicao pos ON pos.id = p.posicao_id
      LEFT JOIN endereco_posicao ep ON ep.posicao_id = p.posicao_id
      LEFT JOIN LATERAL (
        SELECT * FROM historico_conteudo h
         WHERE h.escopo_id = ${escopoId}::uuid AND (h.conteudo_id = x.id OR h.vinculo_id = x.id) AND h.acao = 'VALIDACAO'
         ORDER BY h.registrado_em DESC LIMIT 1) h ON true
      LEFT JOIN usuario u ON u.id = h.autor_id
     ORDER BY coalesce(h.registrado_em, x.criado_em), x.tipo NULLS LAST, x.numero`;
  const ids = linhas.map((l) => l.id);
  const [qtd, historicos] = await Promise.all([quantidadesAtuais(db, escopoId, ids), historicoOcorrencias(db, escopoId, ids)]);
  const items = linhas.map(
    (l): ItemValidacao => ({
      id: l.id,
      kind: l.kind,
      documentType: l.tipo,
      documentNumber: l.numero,
      sender: l.remetente,
      delivery: l.delivery,
      volumes: qtd.get(l.id) ?? null,
      reason: l.motivo,
      since: (l.desde ?? l.criado_em).toISOString(),
      by: pessoa(l.login, l.nome),
      // Último conhecido: o registrado no envio à validação (HISTÓRICO); sem ele, o palete gravado na ocorrência.
      lastKnown: { id: l.palete_id, code: l.co ?? l.codigo, address: l.co === null ? l.endereco : l.eo },
      source: l.fonte,
      technical: { occurrenceId: l.id, batchId: l.lote, row: l.linha, inventory: l.inventario },
      history: historicos.get(l.id) ?? [],
    }),
  );
  return { items, total: items.length, volumes: items.reduce((t, i) => t + (i.volumes ?? 0), 0) };
}

/** Quantidade de pendências (cartão do mapa). */
export async function resumoValidacao(db: Db, escopoId: string): Promise<ResumoValidacao> {
  const [r] = await db.$queryRaw<{ total: bigint; ids: string[] | null }[]>`
    SELECT count(*) AS total, array_agg(id::text) AS ids FROM (
      SELECT id FROM vinculo_documento_palete WHERE escopo_id = ${escopoId}::uuid AND situacao = 'VALIDACAO'
      UNION ALL
      SELECT id FROM conteudo_palete WHERE escopo_id = ${escopoId}::uuid AND situacao = 'VALIDACAO') x`;
  const ids = r?.ids ?? [];
  const qtd = await quantidadesAtuais(db, escopoId, ids);
  return { total: Number(r?.total ?? 0), volumes: [...qtd.values()].reduce<number>((t, v) => t + (v ?? 0), 0) };
}
