/**
 * Histórico operacional na projeção permitida (painel do cliente e lista
 * interna): reaproveita os registros existentes — cadastro do palete
 * ("Entrada registrada no sistema", não recebimento físico), localização
 * (movimento, correção, saída), transferência de conteúdo, conferência
 * concluída, contagem de volumes, reconferência completa, separação e
 * expedição por volumes. Nunca envia autor, login, motivo/justificativa
 * interna, observações nem payload de auditoria.
 *
 * Filtros por palete/NF/Delivery/remetente: eventos do palete entram quando
 * o palete tem (ou teve) o documento; eventos de um documento (contagem,
 * separação, expedição) só entram quando são do documento filtrado — outra
 * NF do mesmo palete misto não aparece. Ordem estável (data, chave).
 */
import { TAMANHO_PAGINA_PAINEL, rotuloEnderecoOperacional, type EventoCliente, type FiltroPainel, type HistoricoCliente, type TipoEventoCliente } from '@praca-reversa/contracts';
import type { Transacao } from '../../db/cliente.js';
import { resolverPeriodo } from '../indicadores/periodo.js';
import { contem, type BasePainel } from './base.js';

interface LinhaHistorico {
  chave: string;
  em: Date;
  tipo: TipoEventoCliente;
  palete_id: string;
  palete_codigo: string;
  doc_tipo: string | null;
  doc_numero: string | null;
  delivery: string | null;
  remetente: string | null;
  de: string | null;
  para: string | null;
  volumes: number | null;
  janela: string | null;
  janela_id: string | null;
  correcao: boolean;
}

const LIMITE = 20_000;

/** Eventos do escopo (já filtrados por período, palete e janela), mais recentes primeiro. */
async function eventosDoEscopo(tx: Transacao, escopoId: string, inicio: Date | null, fim: Date | null, paletes: readonly string[] | null, janelaId: string | null): Promise<LinhaHistorico[]> {
  const todos = paletes === null;
  const ids = paletes ?? [];
  return tx.$queryRaw<LinhaHistorico[]>`
    WITH ev AS (
      SELECT 'P:' || p.id AS chave, p.criado_em AS em, 'ENTRADA_REGISTRADA' AS tipo, p.id AS palete_id, p.codigo AS palete_codigo,
             NULL::text AS doc_tipo, NULL::text AS doc_numero, NULL::text AS delivery, NULL::text AS remetente,
             NULL::text AS de, NULL::text AS para, NULL::int AS volumes, NULL::text AS janela, NULL::uuid AS janela_id, false AS correcao
        FROM palete p WHERE p.escopo_id = ${escopoId}::uuid
      UNION ALL
      SELECT 'L:' || e.id, e.ocorrido_em,
             CASE WHEN e.tipo::text = 'MOVIMENTO' AND e.posicao_origem_id IS NULL THEN 'LOCALIZACAO_REGISTRADA' ELSE CASE e.tipo::text WHEN 'MOVIMENTO' THEN 'LOCALIZACAO' WHEN 'CORRECAO' THEN 'CORRECAO_LOCALIZACAO' ELSE 'SAIDA_PRACA' END END,
             e.palete_id, p.codigo, NULL, NULL, NULL, NULL,
             CASE WHEN eo.situacao = 'CONFIRMADO' THEN eo.endereco END,
             CASE WHEN ed.situacao = 'CONFIRMADO' THEN ed.endereco END,
             NULL, NULL, NULL, e.tipo::text = 'CORRECAO'
        FROM evento_localizacao e
        JOIN palete p ON p.id = e.palete_id
        LEFT JOIN endereco_posicao eo ON eo.posicao_id = e.posicao_origem_id
        LEFT JOIN endereco_posicao ed ON ed.posicao_id = e.posicao_destino_id
       WHERE e.escopo_id = ${escopoId}::uuid
      UNION ALL
      SELECT 'T:' || t.id || ':' || lado.l, t.ocorrido_em, 'TRANSFERENCIA_CONTEUDO',
             CASE lado.l WHEN 'o' THEN t.palete_id ELSE t.palete_destino_id END,
             CASE lado.l WHEN 'o' THEN po.codigo ELSE pd.codigo END,
             NULL, NULL, NULL, NULL, 'Palete ' || po.codigo, 'Palete ' || pd.codigo, NULL, NULL, NULL, t.tipo::text = 'CORRECAO_TRANSFERENCIA'
        FROM evento_estoque t
        JOIN palete po ON po.id = t.palete_id
        JOIN palete pd ON pd.id = t.palete_destino_id
        CROSS JOIN (VALUES ('o'), ('d')) AS lado(l)
       WHERE t.escopo_id = ${escopoId}::uuid AND t.tipo::text IN ('TRANSFERENCIA', 'CORRECAO_TRANSFERENCIA') AND t.palete_destino_id IS NOT NULL
      UNION ALL
      SELECT 'C:' || s.id, s.concluida_em, 'CONFERENCIA', s.palete_id, p.codigo, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false
        FROM sessao_conferencia s JOIN palete p ON p.id = s.palete_id
       WHERE s.escopo_id = ${escopoId}::uuid AND s.concluida_em IS NOT NULL AND s.situacao::text IN ('CONCLUIDA', 'RECONCILIADA')
      UNION ALL
      SELECT 'K:' || k.id, k.registrada_em, 'CONTAGEM_VOLUMES', k.palete_id, p.codigo,
             coalesce(v.tipo_documento, c.tipo_documento), coalesce(v.numero_documento, c.numero_documento), coalesce(v.delivery, c.delivery),
             coalesce(li.remetente, c.remetente), NULL, NULL, k.volumes_contados, NULL, NULL, false
        FROM contagem_volumes k
        JOIN palete p ON p.id = k.palete_id
        LEFT JOIN vinculo_documento_palete v ON v.id = k.vinculo_id
        LEFT JOIN linha_inventario li ON li.id = v.linha_inventario_id
        LEFT JOIN conteudo_palete c ON c.id = k.conteudo_id
       -- Ocorrência em validação (sem endereço) ou cancelada não aparece na projeção.
       WHERE k.escopo_id = ${escopoId}::uuid AND coalesce(v.situacao, c.situacao) NOT IN ('VALIDACAO', 'CANCELADO')
      UNION ALL
      SELECT 'R:' || r.id, r.registrada_em, 'RECONFERENCIA', r.palete_id, p.codigo, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false
        FROM reconferencia_palete r JOIN palete p ON p.id = r.palete_id
       WHERE r.escopo_id = ${escopoId}::uuid
      UNION ALL
      SELECT 'V:' || x.id, x.ocorrido_em, x.tipo, x.palete_id, p.codigo,
             coalesce(v.tipo_documento, c.tipo_documento), coalesce(v.numero_documento, c.numero_documento), coalesce(v.delivery, c.delivery),
             coalesce(li.remetente, c.remetente), NULL, NULL, x.volumes, j.codigo, x.janela_id, x.tipo LIKE 'ESTORNO%'
        FROM evento_volumes_janela x
        JOIN palete p ON p.id = x.palete_id
        JOIN janela_devolucao j ON j.id = x.janela_id
        LEFT JOIN vinculo_documento_palete v ON v.id = x.vinculo_id
        LEFT JOIN linha_inventario li ON li.id = v.linha_inventario_id
        LEFT JOIN conteudo_palete c ON c.id = x.conteudo_id
       WHERE x.escopo_id = ${escopoId}::uuid
    )
    SELECT chave, em, tipo, palete_id::text, palete_codigo, doc_tipo, doc_numero, delivery, remetente, de, para, volumes, janela, janela_id::text, correcao
      FROM ev
     WHERE (${inicio}::timestamptz IS NULL OR em >= ${inicio}::timestamptz)
       AND (${fim}::timestamptz IS NULL OR em < ${fim}::timestamptz)
       AND (${todos}::boolean OR palete_id = ANY(${ids}::uuid[]))
       AND (${janelaId}::uuid IS NULL OR janela_id = ${janelaId}::uuid)
     ORDER BY em DESC, chave DESC
     LIMIT ${LIMITE}`;
}

/** Paletes do escopo que correspondem aos filtros de palete/rua/documento (nulo = sem filtro). */
async function paletesFiltrados(tx: Transacao, escopoId: string, filtro: FiltroPainel, base: BasePainel): Promise<string[] | null> {
  const porDocumento = filtro.documento !== undefined || filtro.delivery !== undefined || filtro.remetente !== undefined;
  if (filtro.palete === undefined && filtro.rua === undefined && !porDocumento) return null;
  let ids: Set<string> | null = null;
  if (filtro.palete !== undefined) {
    const todos = await tx.palete.findMany({
      where: { escopoId },
      select: { id: true, codigo: true },
    });
    ids = new Set(todos.filter((p) => contem(p.codigo, filtro.palete)).map((p) => p.id));
  }
  if (filtro.rua !== undefined) {
    const daRua = new Set(base.paletes.filter((p) => p.endereco !== null && contem(p.rua, filtro.rua)).map((p) => p.id));
    ids = ids === null ? daRua : new Set([...ids].filter((id) => daRua.has(id)));
  }
  if (porDocumento) {
    // Documentos em qualquer situação (o histórico inclui o que já saiu ou foi substituído).
    const docs = await tx.$queryRaw<
      {
        palete_id: string;
        numero: string | null;
        delivery: string | null;
        remetente: string | null;
      }[]
    >`
      SELECT v.palete_id::text, v.numero_documento AS numero, v.delivery, li.remetente
        FROM vinculo_documento_palete v JOIN linha_inventario li ON li.id = v.linha_inventario_id
       WHERE v.escopo_id = ${escopoId}::uuid AND v.situacao NOT IN ('VALIDACAO', 'CANCELADO')
      UNION ALL
      SELECT c.palete_id::text, c.numero_documento, c.delivery, c.remetente FROM conteudo_palete c
       WHERE c.escopo_id = ${escopoId}::uuid AND c.situacao NOT IN ('VALIDACAO', 'CANCELADO')`;
    const comDoc = new Set(docs.filter((d) => casaDocumento(d, filtro)).map((d) => d.palete_id));
    ids = ids === null ? comDoc : new Set([...ids].filter((id) => comDoc.has(id)));
  }
  return [...(ids ?? [])];
}

function casaDocumento(
  d: {
    numero: string | null;
    delivery: string | null;
    remetente: string | null;
  },
  filtro: FiltroPainel,
): boolean {
  return contem(d.numero, filtro.documento) && contem(d.delivery, filtro.delivery) && contem(d.remetente, filtro.remetente);
}

export interface ResultadoHistorico {
  eventos: EventoCliente[];
  total: number;
  disponivelDesde: Date | null;
}

/** Histórico filtrado e paginado (todas as páginas com `pagina` = null, para exportação). */
export async function consultarHistorico(tx: Transacao, escopoId: string, filtro: FiltroPainel, base: BasePainel, agora: Date, pagina: number | null): Promise<ResultadoHistorico> {
  const periodo = filtro.inicio !== undefined || filtro.fim !== undefined ? await resolverPeriodo(tx, escopoId, { inicio: filtro.inicio, fim: filtro.fim }, agora) : null;
  const paletes = await paletesFiltrados(tx, escopoId, filtro, base);
  const linhas = paletes !== null && paletes.length === 0 ? [] : await eventosDoEscopo(tx, escopoId, periodo?.inicio ?? null, periodo?.fim ?? null, paletes, filtro.janela ?? null);
  const porDocumento = filtro.documento !== undefined || filtro.delivery !== undefined || filtro.remetente !== undefined;
  // Evento de um documento só entra quando é do documento filtrado.
  const filtradas = porDocumento
    ? linhas.filter(
        (l) =>
          l.doc_numero === null ||
          casaDocumento(
            {
              numero: l.doc_numero,
              delivery: l.delivery,
              remetente: l.remetente,
            },
            filtro,
          ),
      )
    : linhas;
  const [primeiro] = await tx.$queryRaw<{ em: Date | null }[]>`SELECT min(criado_em) AS em FROM palete WHERE escopo_id = ${escopoId}::uuid`;
  const inicio = pagina === null ? 0 : (pagina - 1) * TAMANHO_PAGINA_PAINEL;
  const fatia = pagina === null ? filtradas : filtradas.slice(inicio, inicio + TAMANHO_PAGINA_PAINEL);
  return {
    eventos: fatia.map((l) => ({
      key: l.chave,
      at: l.em.toISOString(),
      type: l.tipo,
      palletCode: l.palete_codigo,
      documentType: l.doc_tipo,
      documentNumber: l.doc_numero,
      delivery: l.delivery,
      from: l.de === null ? null : l.de.startsWith('Palete ') ? l.de : rotuloEnderecoOperacional(l.de),
      to: l.para === null ? null : l.para.startsWith('Palete ') ? l.para : rotuloEnderecoOperacional(l.para),
      volumes: l.volumes,
      windowCode: l.janela,
      correction: l.correcao,
    })),
    total: filtradas.length,
    disponivelDesde: primeiro?.em ?? null,
  };
}

export function paginaHistorico(r: ResultadoHistorico, pagina: number, agora: Date, fuso: string): HistoricoCliente {
  return {
    consultedAt: agora.toISOString(),
    timezone: fuso,
    events: r.eventos,
    total: r.total,
    page: pagina,
    pageSize: TAMANHO_PAGINA_PAINEL,
    availableFrom: r.disponivelDesde?.toISOString() ?? null,
  };
}
