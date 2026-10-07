/**
 * Busca operacional no servidor (etapa 06). Uma consulta une as bases de
 * informação, cada linha com a sua base, sem somar uma na outra:
 *
 * - PALETE: código, ID/QR ou endereço;
 * - SALDO_VALIDADO: saldo_estoque atual (palete × segmento), com reservado;
 * - OBSERVADO: contagens concluídas e ainda não validadas, agregadas por
 *   sessão e segmento (como no detalhe do palete); recontagens substituídas,
 *   canceladas ou já reconciliadas não entram (são histórico);
 * - DECLARADO_PALETE: linhas declaradas no cadastro do palete;
 * - DOCUMENTO: linhas de documentos importados, sem palete (nenhum vínculo
 *   físico é presumido por coincidência de SKU).
 *
 * Identificadores comparados sem diferenciar maiúsculas, por igualdade ou
 * início (a partir de 3 caracteres); descrição por trecho, sem acentos,
 * marcada como aproximada. Paginação com ordenação estável (chave única no
 * fim). Localização e saldo são sempre os atuais.
 */
import {
  BASES_CONTEUDO,
  LIMITE_GRUPOS_RESUMO,
  LIMITE_PALETES_DESTACADOS,
  MINIMO_PARCIAL_BUSCA,
  chaveDeCodigo,
  extrairIdPalete,
  normalizarQuantidade,
  subtrairQuantidades,
  type BaseResultado,
  type Correspondencia,
  type Escopo,
  type FiltroBusca,
  type GrupoResumo,
  type ResultadoBusca,
  type RespostaBusca,
} from '@praca-reversa/contracts';
import type { Banco } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';

type Sql = Prisma.Sql;
const { sql, join, empty, raw } = Prisma;

/** Colunas da união, na ordem dos SELECTs de cada fonte (nomeadas no CTE). */
const COLUNAS_R = raw(
  `r (base, chave, correspondencia, palete_id, palete_codigo, posicao_id, posicao_codigo, estado_conferencia, estado_liberacao, estado_fluxo,
     motivo_pendencia, conferencia_ativa_id, produto_id, sku, descricao, descricao_pendente, lote, origem_tipo, origem_referencia, condicao,
     linhagem, quantidade, unidade, reservada, sessao_id, sessao_numero, sessao_escopo, sessao_situacao, sessao_pendencias, documento_id,
     documento_referencia, documento_linha, documento_nf, documento_data, quantidade_declarada, unidade_declarada, fator, lote_importacao_id, vinculo)`,
);

const ACENTOS = 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ';
const SEM_ACENTOS = 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn';

function semAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase();
}

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface Termo {
  texto: string;
  prefixo: string;
  parcial: boolean;
  descricao: string | null;
}

function termoDe(texto: string): Termo {
  return {
    texto,
    prefixo: `${escaparLike(texto)}%`,
    parcial: texto.length >= MINIMO_PARCIAL_BUSCA,
    descricao: texto.length >= MINIMO_PARCIAL_BUSCA ? `%${escaparLike(semAcentos(texto))}%` : null,
  };
}

/** Colunas de conteúdo de cada fonte, para montar a correspondência. */
interface ColunasConteudo {
  produtoId: Sql;
  sku: Sql;
  lote: Sql;
  origemTipo: Sql;
  origemReferencia: Sql;
  descricao: Sql;
  /** Documento importado: NF da linha e referência do documento. */
  notaFiscal?: Sql;
}

/** CASE que diz como o texto correspondeu (NULL = não corresponde), conforme o campo escolhido. */
function correspondencia(c: ColunasConteudo, campo: FiltroBusca['campo'], t: Termo | null): Sql {
  if (t === null) return sql`'FILTRO'`;
  const ramos: Sql[] = [];
  const igual = (col: Sql) => sql`upper(${col}) = upper(${t.texto})`;
  const comeca = (col: Sql) => sql`upper(${col}) LIKE upper(${t.prefixo})`;
  const codigo = (cond: (col: Sql) => Sql) =>
    sql`EXISTS (SELECT 1 FROM codigo_barras cb WHERE cb.produto_id = ${c.produtoId} AND ${cond(sql`cb.codigo`)})`;
  const doc = sql`coalesce(${c.origemTipo}::text, '') <> 'NOTA_FISCAL'`;
  const nf = sql`${c.origemTipo}::text = 'NOTA_FISCAL'`;
  const quer = (alvo: FiltroBusca['campo']) => campo === 'TUDO' || campo === alvo;
  // Igualdades primeiro, depois inícios, por fim a descrição.
  if (quer('SKU')) ramos.push(sql`WHEN ${igual(c.sku)} THEN 'SKU'`);
  if (quer('CODIGO_BARRAS')) ramos.push(sql`WHEN ${codigo(igual)} THEN 'CODIGO_BARRAS'`);
  if (quer('LOTE')) ramos.push(sql`WHEN ${igual(c.lote)} THEN 'LOTE'`);
  if (quer('DOCUMENTO')) ramos.push(sql`WHEN ${doc} AND ${igual(c.origemReferencia)} THEN 'DOCUMENTO'`);
  if (quer('NF')) {
    ramos.push(sql`WHEN ${nf} AND ${igual(c.origemReferencia)} THEN 'NF'`);
    if (c.notaFiscal) ramos.push(sql`WHEN ${igual(c.notaFiscal)} THEN 'NF'`);
  }
  if (t.parcial) {
    if (quer('SKU')) ramos.push(sql`WHEN ${comeca(c.sku)} THEN 'SKU_PREFIXO'`);
    if (quer('CODIGO_BARRAS')) ramos.push(sql`WHEN ${codigo(comeca)} THEN 'CODIGO_BARRAS_PREFIXO'`);
    if (quer('LOTE')) ramos.push(sql`WHEN ${comeca(c.lote)} THEN 'LOTE_PREFIXO'`);
    if (quer('DOCUMENTO')) ramos.push(sql`WHEN ${doc} AND ${comeca(c.origemReferencia)} THEN 'DOCUMENTO_PREFIXO'`);
    if (quer('NF')) {
      ramos.push(sql`WHEN ${nf} AND ${comeca(c.origemReferencia)} THEN 'NF_PREFIXO'`);
      if (c.notaFiscal) ramos.push(sql`WHEN ${comeca(c.notaFiscal)} THEN 'NF_PREFIXO'`);
    }
  }
  if (quer('DESCRICAO') && t.descricao !== null) {
    ramos.push(sql`WHEN lower(translate(${c.descricao}, ${ACENTOS}, ${SEM_ACENTOS})) LIKE ${t.descricao} THEN 'DESCRICAO_APROXIMADA'`);
  }
  if (ramos.length === 0) return sql`NULL::text`;
  return sql`CASE ${join(ramos, ' ')} ELSE NULL END`;
}

/** Colunas do palete (situação atual e conferência em andamento) comuns às fontes com palete. */
const COLUNAS_PALETE = sql`
  p.id AS palete_id, p.codigo AS palete_codigo, p.posicao_id, pos.codigo AS posicao_codigo,
  p.estado_conferencia::text AS estado_conferencia, p.estado_liberacao::text AS estado_liberacao,
  p.estado_fluxo::text AS estado_fluxo, p.motivo_pendencia,
  (SELECT sa.id FROM sessao_conferencia sa WHERE sa.palete_id = p.id AND sa.ativa) AS conferencia_ativa_id`;

const SEM_PALETE = sql`
  NULL::uuid AS palete_id, NULL::text AS palete_codigo, NULL::uuid AS posicao_id, NULL::text AS posicao_codigo,
  NULL::text AS estado_conferencia, NULL::text AS estado_liberacao, NULL::text AS estado_fluxo, NULL::text AS motivo_pendencia,
  NULL::uuid AS conferencia_ativa_id`;

const SEM_SESSAO = sql`NULL::uuid AS sessao_id, NULL::int AS sessao_numero, NULL::text AS sessao_escopo, NULL::text AS sessao_situacao, NULL::int AS sessao_pendencias`;
const SEM_DOCUMENTO = sql`
  NULL::uuid AS documento_id, NULL::text AS documento_referencia, NULL::text AS documento_linha, NULL::text AS documento_nf,
  NULL::text AS documento_data, NULL::text AS quantidade_declarada, NULL::text AS unidade_declarada, NULL::text AS fator,
  NULL::uuid AS lote_importacao_id, NULL::jsonb AS vinculo`;

function filtrosPalete(f: FiltroBusca): Sql {
  const partes: Sql[] = [sql`p.arquivado_em IS NULL`];
  if (f.conferencia) partes.push(sql`p.estado_conferencia::text = ${f.conferencia}`);
  if (f.liberacao) partes.push(sql`p.estado_liberacao::text = ${f.liberacao}`);
  if (f.localizacao === 'COM_POSICAO') partes.push(sql`p.posicao_id IS NOT NULL`);
  if (f.localizacao === 'PENDENTE') partes.push(sql`p.posicao_id IS NULL`);
  if (f.emConferencia) partes.push(sql`EXISTS (SELECT 1 FROM sessao_conferencia sa WHERE sa.palete_id = p.id AND sa.ativa)`);
  return join(partes, ' AND ');
}

/** Filtro de palete informado: resultados sem palete (documentos) ficam de fora. */
function temFiltroPalete(f: FiltroBusca): boolean {
  return f.conferencia !== undefined || f.liberacao !== undefined || f.localizacao !== undefined || f.emConferencia === true;
}

function incluiBase(f: FiltroBusca, base: BaseResultado): boolean {
  return (f.base?.length ?? 0) === 0 || (f.base ?? []).includes(base);
}

/** União das fontes com as colunas comuns e a correspondência (`NULL` = fora do resultado). */
function uniao(escopoId: string, f: FiltroBusca): Sql | null {
  const texto = (f.texto ?? '').trim();
  const t = texto === '' ? null : termoDe(texto);
  const partes: Sql[] = [];
  const condicao = (col: Sql) => (f.condicao ? sql`AND ${col}::text = ${f.condicao}` : empty);
  const conteudoPorTexto = t === null ? (f.base?.length ?? 0) > 0 : f.campo !== 'PALETE' && f.campo !== 'ENDERECO';

  // Palete: código, ID/QR ou endereço; sem texto, lista os paletes dos filtros.
  if (incluiBase(f, 'PALETE') && (t === null || f.campo === 'TUDO' || f.campo === 'PALETE' || f.campo === 'ENDERECO') && (t !== null || f.condicao === undefined)) {
    const id = t === null ? null : extrairIdPalete(t.texto);
    const chave = t === null ? '' : chaveDeCodigo(t.texto);
    const posicao = sql`regexp_replace(upper(coalesce(pos.codigo, '')), '[^A-Z0-9]', '', 'g')`;
    let caso: Sql;
    if (t === null) caso = sql`'FILTRO'`;
    else if (id !== null) caso = sql`CASE WHEN p.id = ${id}::uuid THEN 'ID_PALETE' END`;
    else if (chave === '') caso = sql`NULL::text`;
    else if (f.campo === 'TUDO') caso = sql`CASE WHEN p.codigo_busca = ${chave} THEN 'CODIGO_PALETE' WHEN ${posicao} = ${chave} THEN 'ENDERECO' END`;
    else if (f.campo === 'PALETE') {
      caso = sql`CASE WHEN p.codigo_busca = ${chave} THEN 'CODIGO_PALETE' WHEN p.codigo_busca LIKE ${`%${chave}%`} THEN 'CODIGO_PALETE_PARCIAL' END`;
    } else caso = sql`CASE WHEN ${posicao} = ${chave} THEN 'ENDERECO' WHEN ${posicao} LIKE ${`%${chave}%`} THEN 'ENDERECO_PARCIAL' END`;
    partes.push(sql`
      SELECT 'PALETE' AS base, 'p:' || p.id::text AS chave, ${caso} AS correspondencia, ${COLUNAS_PALETE},
             NULL::uuid AS produto_id, NULL::text AS sku, NULL::text AS descricao, NULL::text AS descricao_pendente,
             NULL::text AS lote, NULL::text AS origem_tipo, NULL::text AS origem_referencia, NULL::text AS condicao, NULL::text AS linhagem,
             NULL::text AS quantidade, NULL::text AS unidade, NULL::text AS reservada, ${SEM_SESSAO}, ${SEM_DOCUMENTO}
        FROM palete p LEFT JOIN posicao pos ON pos.id = p.posicao_id
       WHERE p.escopo_id = ${escopoId}::uuid AND ${filtrosPalete(f)}`);
  }
  if (!conteudoPorTexto) return partes.length === 0 ? null : join(partes, ' UNION ALL ');

  if (incluiBase(f, 'SALDO_VALIDADO')) {
    const c = correspondencia(
      { produtoId: sql`pr.id`, sku: sql`pr.sku`, lote: sql`sg.lote`, origemTipo: sql`sg.origem_tipo`, origemReferencia: sql`sg.origem_referencia`, descricao: sql`pr.descricao` },
      f.campo,
      t,
    );
    partes.push(sql`
      SELECT 'SALDO_VALIDADO', 's:' || se.id::text, ${c}, ${COLUNAS_PALETE},
             pr.id, pr.sku, pr.descricao, NULL::text, sg.lote, sg.origem_tipo::text, sg.origem_referencia, sg.condicao::text, sg.linhagem,
             se.quantidade::text, sg.unidade, se.quantidade_reservada::text, ${SEM_SESSAO}, ${SEM_DOCUMENTO}
        FROM saldo_estoque se
        JOIN segmento_estoque sg ON sg.id = se.segmento_id
        JOIN produto pr ON pr.id = sg.produto_id
        JOIN palete p ON p.id = se.palete_id
        LEFT JOIN posicao pos ON pos.id = p.posicao_id
       WHERE se.escopo_id = ${escopoId}::uuid AND ${filtrosPalete(f)} ${condicao(sql`sg.condicao`)}`);
  }

  if (incluiBase(f, 'OBSERVADO')) {
    const c = correspondencia(
      { produtoId: sql`oc.produto_id`, sku: sql`pr.sku`, lote: sql`oc.lote`, origemTipo: sql`oc.origem_tipo`, origemReferencia: sql`oc.origem_referencia`, descricao: sql`pr.descricao` },
      f.campo,
      t,
    );
    partes.push(sql`
      SELECT 'OBSERVADO', 'o:' || s.id::text || ':' || md5(concat_ws(chr(31), oc.produto_id::text, coalesce(oc.lote, chr(30)), coalesce(oc.origem_tipo::text, chr(30)),
                                                                coalesce(oc.origem_referencia, chr(30)), oc.condicao::text)),
             ${c}, ${COLUNAS_PALETE},
             oc.produto_id, pr.sku, pr.descricao, NULL::text, oc.lote, oc.origem_tipo::text, oc.origem_referencia, oc.condicao::text, NULL::text,
             sum(oc.quantidade_canonica)::text, min(oc.unidade_canonica), NULL::text,
             s.id, s.numero, s.escopo_contagem::text, s.situacao::text,
             (SELECT count(*)::int FROM observacao_conferencia op WHERE op.sessao_id = s.id AND op.removida_em IS NULL AND op.pendencia IS NOT NULL),
             ${SEM_DOCUMENTO}
        FROM observacao_conferencia oc
        JOIN sessao_conferencia s ON s.id = oc.sessao_id
        JOIN produto pr ON pr.id = oc.produto_id
        JOIN palete p ON p.id = s.palete_id
        LEFT JOIN posicao pos ON pos.id = p.posicao_id
       WHERE oc.escopo_id = ${escopoId}::uuid AND oc.removida_em IS NULL AND oc.pendencia IS NULL AND oc.quantidade_canonica IS NOT NULL
         AND s.situacao = 'CONCLUIDA'
         AND s.concluida_em > coalesce((SELECT max(ev.ocorrido_em) FROM evento_estoque ev
                                         WHERE ev.palete_id = s.palete_id AND ev.tipo::text IN ('SALDO_INICIAL', 'AJUSTE_RECONCILIACAO')), '-infinity'::timestamptz)
         AND ${filtrosPalete(f)} ${condicao(sql`oc.condicao`)}
       GROUP BY s.id, s.numero, s.escopo_contagem, s.situacao, p.id, pos.codigo, oc.produto_id, pr.id, pr.sku, pr.descricao,
                oc.lote, oc.origem_tipo, oc.origem_referencia, oc.condicao`);
  }

  if (incluiBase(f, 'DECLARADO_PALETE')) {
    const c = correspondencia(
      { produtoId: sql`d.produto_id`, sku: sql`d.sku`, lote: sql`d.lote`, origemTipo: sql`d.origem_tipo`, origemReferencia: sql`d.origem_referencia`, descricao: sql`coalesce(pr.descricao, d.descricao)` },
      f.campo,
      t,
    );
    partes.push(sql`
      SELECT 'DECLARADO_PALETE', 'd:' || d.id::text, ${c}, ${COLUNAS_PALETE},
             d.produto_id, pr.sku, pr.descricao, CASE WHEN d.produto_id IS NULL THEN d.descricao END, d.lote, d.origem_tipo::text, d.origem_referencia,
             d.condicao::text, NULL::text, d.quantidade::text, d.unidade_medida, NULL::text, ${SEM_SESSAO}, ${SEM_DOCUMENTO}
        FROM item_declarado d
        JOIN palete p ON p.id = d.palete_id
        LEFT JOIN produto pr ON pr.id = d.produto_id
        LEFT JOIN posicao pos ON pos.id = p.posicao_id
       WHERE d.escopo_id = ${escopoId}::uuid AND ${filtrosPalete(f)} ${condicao(sql`d.condicao`)}`);
  }

  // Documento importado não tem palete nem condição: filtros de palete ou de condição o excluem.
  if (incluiBase(f, 'DOCUMENTO') && !temFiltroPalete(f) && f.condicao === undefined) {
    const c = correspondencia(
      {
        produtoId: sql`l.produto_id`,
        sku: sql`l.sku`,
        lote: sql`l.lote`,
        origemTipo: sql`doc.tipo`,
        origemReferencia: sql`doc.referencia`,
        descricao: sql`pr.descricao`,
        notaFiscal: sql`l.nota_fiscal`,
      },
      f.campo,
      t,
    );
    partes.push(sql`
      SELECT 'DOCUMENTO', 'l:' || l.id::text, ${c}, ${SEM_PALETE},
             l.produto_id, l.sku, pr.descricao, NULL::text, l.lote, doc.tipo::text, doc.referencia, NULL::text, NULL::text,
             l.quantidade_canonica::text, l.unidade_canonica, NULL::text, ${SEM_SESSAO},
             doc.id, doc.referencia, l.referencia_linha, l.nota_fiscal, to_char(l.data_documento, 'YYYY-MM-DD'),
             l.quantidade_declarada::text, l.unidade_declarada, l.fator_conversao::text, l.lote_importacao_id, NULL::jsonb
        FROM linha_documento_devolucao l
        JOIN documento_devolucao doc ON doc.id = l.documento_id
        JOIN produto pr ON pr.id = l.produto_id
       WHERE l.escopo_id = ${escopoId}::uuid`);
  }

  // Vínculo documental do inventário conferido: NF/documento × palete, sem produto nem condição.
  if (incluiBase(f, 'INVENTARIO') && f.condicao === undefined) {
    partes.push(sql`
      SELECT 'INVENTARIO', 'v:' || v.id::text, ${correspondenciaInventario(f.campo, t)}, ${COLUNAS_PALETE},
             NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
             NULL::text, NULL::text, NULL::text, ${SEM_SESSAO},
             NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::uuid,
             jsonb_build_object(
               'id', v.id, 'tipo', v.tipo_documento, 'numero', v.numero_documento, 'delivery', v.delivery,
               'volumes', v.volumes::text, 'unidade', v.unidade_volumes, 'documentacao', v.documentacao, 'palletFull', v.pallet_full,
               'conferido', v.conferido_externamente, 'enderecoInformado', coalesce(li.endereco_canonico, li.endereco_lido),
               'inventarioId', i.id, 'inventarioCodigo', i.codigo, 'referenciaConferencia', i.referencia_conferencia, 'linha', li.linha_arquivo)
        FROM vinculo_documento_palete v
        JOIN palete p ON p.id = v.palete_id
        JOIN inventario_referencia i ON i.id = v.inventario_id
        JOIN linha_inventario li ON li.id = v.linha_inventario_id
        LEFT JOIN posicao pos ON pos.id = p.posicao_id
       WHERE v.escopo_id = ${escopoId}::uuid AND v.situacao = 'ATIVO' AND ${filtrosPalete(f)}`);
  }
  return partes.length === 0 ? null : join(partes, ' UNION ALL ');
}

/**
 * Correspondência do vínculo do inventário: número do documento (NF) e
 * DELIVERY, como texto, por igualdade ou início. Número isolado não resolve
 * o contexto documental: o tipo vem junto no resultado.
 */
function correspondenciaInventario(campo: FiltroBusca['campo'], t: Termo | null): Sql {
  if (t === null) return sql`'FILTRO'`;
  const quer = (alvo: FiltroBusca['campo']) => campo === 'TUDO' || campo === alvo;
  const igual = (col: Sql) => sql`upper(${col}) = upper(${t.texto})`;
  const comeca = (col: Sql) => sql`upper(${col}) LIKE upper(${t.prefixo})`;
  const ramos: Sql[] = [];
  if (quer('NF')) ramos.push(sql`WHEN ${igual(sql`v.numero_documento`)} THEN 'NF'`);
  if (quer('DOCUMENTO')) ramos.push(sql`WHEN ${igual(sql`v.numero_documento`)} OR ${igual(sql`v.delivery`)} THEN 'DOCUMENTO'`);
  if (t.parcial) {
    if (quer('NF')) ramos.push(sql`WHEN ${comeca(sql`v.numero_documento`)} THEN 'NF_PREFIXO'`);
    if (quer('DOCUMENTO')) ramos.push(sql`WHEN ${comeca(sql`v.numero_documento`)} OR ${comeca(sql`v.delivery`)} THEN 'DOCUMENTO_PREFIXO'`);
  }
  if (ramos.length === 0) return sql`NULL::text`;
  return sql`CASE ${join(ramos, ' ')} ELSE NULL END`;
}

const ORDEM = sql`
  CASE WHEN r.correspondencia IN ('FILTRO', 'ID_PALETE', 'CODIGO_PALETE', 'ENDERECO', 'SKU', 'CODIGO_BARRAS', 'LOTE', 'DOCUMENTO', 'NF') THEN 0
       WHEN r.correspondencia = 'DESCRICAO_APROXIMADA' THEN 2 ELSE 1 END,
  CASE r.base WHEN 'PALETE' THEN 0 WHEN 'SALDO_VALIDADO' THEN 1 WHEN 'OBSERVADO' THEN 2 WHEN 'DECLARADO_PALETE' THEN 3 WHEN 'INVENTARIO' THEN 4 ELSE 5 END,
  r.sku NULLS LAST, r.palete_codigo NULLS LAST, r.origem_referencia NULLS LAST, r.documento_linha NULLS LAST, r.chave`;

interface LinhaResultado {
  base: BaseResultado;
  chave: string;
  correspondencia: Correspondencia;
  palete_id: string | null;
  palete_codigo: string | null;
  posicao_id: string | null;
  posicao_codigo: string | null;
  estado_conferencia: string | null;
  estado_liberacao: string | null;
  estado_fluxo: string | null;
  motivo_pendencia: string | null;
  conferencia_ativa_id: string | null;
  produto_id: string | null;
  sku: string | null;
  descricao: string | null;
  descricao_pendente: string | null;
  lote: string | null;
  origem_tipo: string | null;
  origem_referencia: string | null;
  condicao: string | null;
  linhagem: string | null;
  quantidade: string | null;
  unidade: string | null;
  reservada: string | null;
  sessao_id: string | null;
  sessao_numero: number | null;
  sessao_escopo: string | null;
  sessao_situacao: string | null;
  sessao_pendencias: number | null;
  documento_id: string | null;
  documento_referencia: string | null;
  documento_linha: string | null;
  documento_nf: string | null;
  documento_data: string | null;
  quantidade_declarada: string | null;
  unidade_declarada: string | null;
  fator: string | null;
  lote_importacao_id: string | null;
  vinculo: VinculoLido | null;
  total: bigint;
}

/** Vínculo do inventário (jsonb_build_object da base INVENTARIO). */
interface VinculoLido {
  id: string;
  tipo: string | null;
  numero: string;
  delivery: string | null;
  volumes: string | null;
  unidade: string;
  documentacao: string | null;
  palletFull: string | null;
  conferido: boolean;
  enderecoInformado: string | null;
  inventarioId: string;
  inventarioCodigo: string;
  referenciaConferencia: string;
  linha: number;
}

const q = (v: string | null) => (v === null ? null : normalizarQuantidade(v));

function resultado(l: LinhaResultado): ResultadoBusca {
  const palete =
    l.palete_id === null || l.palete_codigo === null
      ? null
      : {
          id: l.palete_id,
          code: l.palete_codigo,
          positionId: l.posicao_id,
          positionCode: l.posicao_codigo,
          countState: l.estado_conferencia as NonNullable<ResultadoBusca['pallet']>['countState'],
          releaseState: l.estado_liberacao as NonNullable<ResultadoBusca['pallet']>['releaseState'],
          flowState: l.estado_fluxo as NonNullable<ResultadoBusca['pallet']>['flowState'],
          pendingReason: l.motivo_pendencia,
          activeCountId: l.conferencia_ativa_id,
        };
  const quantidade = q(l.quantidade);
  const reservada = l.base === 'SALDO_VALIDADO' ? q(l.reservada) : null;
  return {
    key: l.chave,
    base: l.base,
    match: l.correspondencia,
    pallet: palete,
    product: l.produto_id !== null && l.sku !== null && l.descricao !== null ? { id: l.produto_id, sku: l.sku, description: l.descricao } : null,
    pendingDescription: l.descricao_pendente,
    lot: l.lote,
    originType: l.origem_tipo as ResultadoBusca['originType'],
    originReference: l.origem_referencia,
    condition: l.condicao as ResultadoBusca['condition'],
    lineage: l.linhagem,
    quantity: quantidade,
    unit: l.unidade,
    reserved: reservada,
    available: quantidade !== null && reservada !== null ? subtrairQuantidades(quantidade, reservada) : null,
    session:
      l.sessao_id === null || l.sessao_numero === null
        ? null
        : {
            id: l.sessao_id,
            number: l.sessao_numero,
            scope: l.sessao_escopo as 'PARCIAL' | 'COMPLETA',
            state: l.sessao_situacao as NonNullable<ResultadoBusca['session']>['state'],
            pendingLines: l.sessao_pendencias ?? 0,
          },
    document:
      l.documento_id === null || l.documento_referencia === null || l.documento_linha === null || l.quantidade_declarada === null || l.unidade_declarada === null || l.fator === null
        ? null
        : {
            id: l.documento_id,
            reference: l.documento_referencia,
            lineReference: l.documento_linha,
            invoice: l.documento_nf,
            date: l.documento_data,
            declaredQuantity: normalizarQuantidade(l.quantidade_declarada),
            declaredUnit: l.unidade_declarada,
            factor: normalizarQuantidade(l.fator),
            batchId: l.lote_importacao_id,
          },
    documentLink:
      l.vinculo === null
        ? null
        : {
            id: l.vinculo.id,
            documentType: l.vinculo.tipo,
            documentNumber: l.vinculo.numero,
            delivery: l.vinculo.delivery,
            volumes: q(l.vinculo.volumes),
            volumesUnit: l.vinculo.unidade,
            documentation: l.vinculo.documentacao,
            palletFull: l.vinculo.palletFull,
            externalCount: l.vinculo.conferido,
            informedAddress: l.vinculo.enderecoInformado,
            inventoryId: l.vinculo.inventarioId,
            inventoryCode: l.vinculo.inventarioCodigo,
            countReference: l.vinculo.referenciaConferencia,
            row: l.vinculo.linha,
          },
  };
}

interface LinhaResumo {
  base: BaseResultado;
  produto_id: string | null;
  sku: string | null;
  descricao: string;
  unidade: string;
  lote: string | null;
  origem_tipo: string | null;
  origem_referencia: string | null;
  condicao: string | null;
  quantidade: string | null;
  reservada: string | null;
  registros: bigint;
  paletes: bigint;
  detalhe: boolean;
}

/**
 * Resumo por base, produto e unidade, com a quebra por lote, origem e
 * condição. Cada linha das fontes é contada uma vez (sem junção entre bases).
 */
async function resumir(db: Banco, cte: Sql): Promise<{ grupos: GrupoResumo[]; truncado: boolean }> {
  const linhas = await db.$queryRaw<LinhaResumo[]>`
    WITH ${COLUNAS_R} AS (${cte})
    SELECT r.base, r.produto_id::text AS produto_id, r.sku, coalesce(r.descricao, r.descricao_pendente, 'Produto pendente') AS descricao, r.unidade,
           r.lote, r.origem_tipo, r.origem_referencia, r.condicao,
           sum(r.quantidade::numeric)::text AS quantidade, sum(r.reservada::numeric)::text AS reservada,
           count(*) AS registros, count(DISTINCT r.palete_id) AS paletes,
           GROUPING(r.lote, r.origem_tipo, r.origem_referencia, r.condicao) = 0 AS detalhe
      FROM r
     WHERE r.correspondencia IS NOT NULL AND r.base NOT IN ('PALETE', 'INVENTARIO')
     GROUP BY GROUPING SETS ((r.base, r.produto_id, r.sku, coalesce(r.descricao, r.descricao_pendente, 'Produto pendente'), r.unidade,
                              r.lote, r.origem_tipo, r.origem_referencia, r.condicao),
                             (r.base, r.produto_id, r.sku, coalesce(r.descricao, r.descricao_pendente, 'Produto pendente'), r.unidade))
     ORDER BY r.sku NULLS LAST, 4, CASE r.base WHEN 'SALDO_VALIDADO' THEN 1 WHEN 'OBSERVADO' THEN 2 WHEN 'DECLARADO_PALETE' THEN 3 ELSE 4 END, r.unidade,
              detalhe, r.lote NULLS FIRST, r.origem_referencia NULLS FIRST, r.condicao NULLS FIRST
     LIMIT 2000`;
  const grupos: GrupoResumo[] = [];
  const porChave = new Map<string, GrupoResumo>();
  for (const l of linhas) {
    const chave = [l.base, l.produto_id ?? `pendente:${l.descricao}`, l.unidade].join('\u001f');
    const observado = l.base === 'OBSERVADO';
    if (!l.detalhe) {
      if (grupos.length >= LIMITE_GRUPOS_RESUMO) continue;
      const g: GrupoResumo = {
        base: l.base,
        productId: l.produto_id,
        sku: l.sku,
        description: l.descricao,
        unit: l.unidade,
        quantity: observado ? null : q(l.quantidade),
        reserved: l.base === 'SALDO_VALIDADO' ? q(l.reservada) : null,
        available: null,
        records: Number(l.registros),
        pallets: Number(l.paletes),
        breakdown: [],
      };
      if (g.quantity !== null && g.reserved !== null) g.available = subtrairQuantidades(g.quantity, g.reserved);
      grupos.push(g);
      porChave.set(chave, g);
      continue;
    }
    const g = porChave.get(chave);
    if (!g || g.breakdown.length >= 20) continue;
    g.breakdown.push({
      lot: l.lote,
      originType: l.origem_tipo as GrupoResumo['breakdown'][number]['originType'],
      originReference: l.origem_referencia,
      condition: l.condicao as GrupoResumo['breakdown'][number]['condition'],
      quantity: observado ? null : q(l.quantidade),
      records: Number(l.registros),
    });
  }
  const totalGrupos = linhas.filter((l) => !l.detalhe).length;
  return { grupos, truncado: totalGrupos > grupos.length };
}

/** Busca paginada. Sem critério (texto ou filtro), devolve vazio. */
export async function buscar(db: Banco, escopo: Escopo, f: FiltroBusca, agora: Date): Promise<RespostaBusca> {
  const cte = uniao(escopo.id, f);
  const vazio: RespostaBusca = {
    items: [],
    total: 0,
    page: f.pagina,
    pageSize: f.tamanho,
    summary: [],
    summaryTruncated: false,
    palletIds: [],
    palletIdsTruncated: false,
    consultedAt: agora.toISOString(),
  };
  if (cte === null || !temCriterio(f)) return vazio;
  const linhas = await db.$queryRaw<LinhaResultado[]>`
    WITH ${COLUNAS_R} AS (${cte})
    SELECT r.*, count(*) OVER () AS total FROM r WHERE r.correspondencia IS NOT NULL
     ORDER BY ${ORDEM}
     LIMIT ${f.tamanho} OFFSET ${(f.pagina - 1) * f.tamanho}`;
  const total = linhas[0] ? Number(linhas[0].total) : await contar(db, cte);
  const [resumo, paletes] = await Promise.all([
    total === 0 ? Promise.resolve({ grupos: [], truncado: false }) : resumir(db, cte),
    total === 0
      ? Promise.resolve([])
      : db.$queryRaw<{ palete_id: string }[]>`
          WITH ${COLUNAS_R} AS (${cte})
          SELECT DISTINCT r.palete_id::text AS palete_id FROM r WHERE r.correspondencia IS NOT NULL AND r.palete_id IS NOT NULL
           ORDER BY 1 LIMIT ${LIMITE_PALETES_DESTACADOS + 1}`,
  ]);
  return {
    items: linhas.map(resultado),
    total,
    page: f.pagina,
    pageSize: f.tamanho,
    summary: resumo.grupos,
    summaryTruncated: resumo.truncado,
    palletIds: paletes.slice(0, LIMITE_PALETES_DESTACADOS).map((p) => p.palete_id),
    palletIdsTruncated: paletes.length > LIMITE_PALETES_DESTACADOS,
    consultedAt: agora.toISOString(),
  };
}

async function contar(db: Banco, cte: Sql): Promise<number> {
  const [linha] = await db.$queryRaw<{ total: bigint }[]>`WITH ${COLUNAS_R} AS (${cte}) SELECT count(*) AS total FROM r WHERE r.correspondencia IS NOT NULL`;
  return Number(linha?.total ?? 0);
}

function temCriterio(f: FiltroBusca): boolean {
  return (
    (f.texto ?? '').trim() !== '' ||
    (f.base?.length ?? 0) > 0 ||
    f.conferencia !== undefined ||
    f.liberacao !== undefined ||
    f.condicao !== undefined ||
    f.localizacao !== undefined ||
    f.emConferencia === true
  );
}

/**
 * União das bases de conteúdo para um SKU exato (pistas dos claims, etapa 07):
 * a mesma consulta da busca, sem a base PALETE. Quem chama filtra pelo
 * produto e pagina (WITH  AS (...)).
 */
export function uniaoDoSku(escopoId: string, sku: string): Sql | null {
  return uniao(escopoId, { texto: sku, campo: 'SKU', base: [...BASES_CONTEUDO], pagina: 1, tamanho: 1 });
}

export { COLUNAS_R, resultado as resultadoDaLinha, type LinhaResultado };

/** Todos os resultados (até o limite) na mesma ordem da tela, para exportação. */
export async function buscarParaExportar(db: Banco, escopo: Escopo, f: FiltroBusca, limite: number): Promise<{ itens: ResultadoBusca[]; total: number }> {
  const cte = uniao(escopo.id, f);
  if (cte === null || !temCriterio(f)) return { itens: [], total: 0 };
  const linhas = await db.$queryRaw<LinhaResultado[]>`
    WITH ${COLUNAS_R} AS (${cte})
    SELECT r.*, count(*) OVER () AS total FROM r WHERE r.correspondencia IS NOT NULL
     ORDER BY ${ORDEM}
     LIMIT ${limite}`;
  return { itens: linhas.map(resultado), total: linhas[0] ? Number(linhas[0].total) : 0 };
}
