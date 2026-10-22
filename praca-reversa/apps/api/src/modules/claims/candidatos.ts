/**
 * Candidatos de uma linha de claim (etapa 07; R15). Reaproveita a união de
 * fontes da busca (etapa 06) para o SKU exato do produto da linha — saldo
 * validado, observação não reconciliada, declarado no palete e documento
 * importado —, mais o histórico de paletes que não têm mais o material.
 * Consultas paginadas; sem porcentagem de confiança: cada pista diz o que
 * coincide (produto, lote, origem, condição) e o que bloqueia a validação.
 * Localização e saldo são os atuais; o retrato de um candidato registrado
 * guarda como o registro estava quando a investigação começou.
 */
import {
  compararQuantidades,
  normalizarQuantidade,
  subtrairQuantidades,
  type Candidato,
  type Escopo,
  type RegistrarCandidatoSchema,
  type RespostaCandidatos,
  type SolicitarConferenciaSchema,
  type DescartarCandidatoSchema,
  type ClaimDetalhe,
  type TipoOrigemDocumento,
  type CondicaoMaterial,
  type EstadoConferencia,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { COLUNAS_R, resultadoDaLinha, uniaoDoSku, type LinhaResultado } from '../busca/consulta.js';
import { chaveLinhaDocumento } from '../importacao/interpretar.js';
import { registrarEventoClaim } from './historico.js';
import { detalheClaim, linhaRegraDe, lerCaso } from './leitura.js';
import { verificarMaterial, type LinhaRegra, type MaterialRegra } from './regras.js';
import { bloquearCaso, exigirAberto, gravarSituacao, type Autor } from './servico.js';

type Db = Banco | Transacao;
const { sql } = Prisma;

const LIMITE_HISTORICO = 10;

interface Extra {
  segmento_id: string | null;
  vinculada: string | null;
  saldo_versao: number | null;
  saldo_em: Date | null;
  sessao_em: Date | null;
  documento_em: Date | null;
  declarado_em: Date | null;
  arquivado: boolean | null;
}

/** Documento de origem citado pela linha (devolução + linha), quando importado. */
async function documentoDaLinha(db: Db, escopoId: string, l: LinhaRegra): Promise<{ produtoId: string; lote: string | null } | null> {
  if (l.origemTipo !== 'DEVOLUCAO' || l.origemReferencia === null || l.origemLinha === null) return null;
  const [doc] = await db.$queryRaw<{ produto_id: string; lote: string | null }[]>`
    SELECT ld.produto_id::text, ld.lote FROM linha_documento_devolucao ld JOIN documento_devolucao d ON d.id = ld.documento_id
     WHERE ld.escopo_id = ${escopoId}::uuid AND d.tipo::text = 'DEVOLUCAO' AND d.referencia = ${l.origemReferencia}
       AND ld.chave_linha = ${chaveLinhaDocumento(l.origemLinha)}`;
  return doc ? { produtoId: doc.produto_id, lote: doc.lote } : null;
}

const NOTA_BASE: Readonly<Record<Candidato['base'], string>> = {
  SALDO_VALIDADO: '',
  OBSERVADO: 'Observação concluída e ainda não reconciliada: permite investigar, mas não substitui o saldo reconciliado (reconcilie a conferência).',
  DECLARADO_PALETE: 'Declarado no cadastro do palete: documento, não comprova presença física (confira o palete).',
  DOCUMENTO: 'Linha de documento importado sem vínculo físico: continua documental (NF ou documento não provam recebimento físico).',
  HISTORICO: 'Histórico: o palete não tem mais este material (vazio, arquivado ou transferido); não prova presença atual.',
};

function material(l: { produto_id: string | null; sku: string | null; unidade: string | null; lote: string | null; origem_tipo: string | null; origem_referencia: string | null; condicao: string | null }): MaterialRegra {
  return {
    produtoId: l.produto_id,
    sku: l.sku,
    unidade: l.unidade,
    lote: l.lote,
    origemTipo: l.origem_tipo as TipoOrigemDocumento | null,
    origemReferencia: l.origem_referencia,
    condicao: l.condicao as CondicaoMaterial | null,
  };
}

/** Chave de investigação: mesma pista registrada (palete × segmento, sessão, documento). */
export function chaveInvestigacao(base: Candidato['base'], partes: { paleteId: string | null; segmentoId: string | null; sessaoId: string | null; linhaDocumentoId: string | null }): string {
  switch (base) {
    case 'SALDO_VALIDADO':
    case 'HISTORICO':
      return `${base}:${partes.paleteId ?? ''}:${partes.segmentoId ?? ''}`;
    case 'OBSERVADO':
      return `${base}:${partes.sessaoId ?? ''}`;
    case 'DECLARADO_PALETE':
      return `${base}:${partes.paleteId ?? ''}`;
    case 'DOCUMENTO':
      return `${base}:${partes.linhaDocumentoId ?? ''}`;
  }
}

function candidatoDe(
  base: Candidato['base'],
  r: ReturnType<typeof resultadoDaLinha> | null,
  linha: LinhaRegra,
  motivo: ClaimDetalhe['reason'],
  documento: { produtoId: string; lote: string | null } | null,
  investigacoes: Map<string, string>,
  chave: string,
  m: MaterialRegra,
  dados: Pick<Candidato, 'key' | 'pallet' | 'product' | 'segmentId' | 'quantity' | 'unit' | 'reserved' | 'session' | 'document' | 'evidenceAt'> & { linked?: string | null },
): Candidato {
  const v = verificarMaterial(linha, motivo, m, documento);
  const pistas = [...v.pistas];
  const bloqueios = [...v.bloqueios];
  if (v.bloqueioLote) bloqueios.push(`${v.bloqueioLote} (exige tratativa documentada na validação)`);
  if (NOTA_BASE[base] !== '') bloqueios.unshift(NOTA_BASE[base]);
  let elegivel: string | null = null;
  if (base === 'SALDO_VALIDADO' && dados.quantity !== null) {
    const reservado = dados.reserved ?? '0';
    const vinculado = dados.linked ?? '0';
    const livre = subtrairQuantidades(subtrairQuantidades(dados.quantity, reservado), vinculado);
    elegivel = compararQuantidades(livre, '0') > 0 ? normalizarQuantidade(livre) : '0';
    pistas.push(`Saldo validado: ${dados.quantity} ${dados.unit ?? ''}; elegível ${elegivel}.`);
    if (compararQuantidades(elegivel, '0') <= 0) {
      bloqueios.push(`Sem quantidade elegível: ${vinculado} vinculados a recuperações validadas, ${reservado} reservados.`);
    }
  }
  if (dados.pallet?.positionId === null) pistas.push('Localização pendente: o palete não tem posição no mapa.');
  if (r?.pallet?.activeCountId) bloqueios.push('Conferência em andamento no palete: aguarde a conclusão e a reconciliação.');
  return {
    ...dados,
    base,
    lot: m.lote,
    originType: m.origemTipo,
    originReference: m.origemReferencia,
    condition: m.condicao,
    linked: base === 'SALDO_VALIDADO' ? (dados.linked ?? '0') : null,
    eligible: elegivel,
    checks: v.checks,
    clues: pistas,
    blockers: bloqueios,
    validatable: base === 'SALDO_VALIDADO' && bloqueios.length === 0,
    investigationId: investigacoes.get(chave) ?? null,
  };
}

/** Pistas da linha (paginadas), com histórico separado. */
export async function candidatosDaLinha(db: Db, escopo: Escopo, claimId: string, linhaId: string, pagina: number, tamanho: number, agora: Date): Promise<RespostaCandidatos> {
  const caso = await lerCaso(db, escopo.id, claimId);
  const fonte = caso.linhas.find((l) => l.id === linhaId);
  if (!fonte) throw naoEncontrado('Linha não encontrada neste claim.');
  const linha = linhaRegraDe(fonte);
  const notas: string[] = ['Coincidência de SKU é pista, não prova. Só saldo validado (reconciliado) sustenta a validação de recuperação física.'];
  const vazio: RespostaCandidatos = { lineId: linhaId, items: [], total: 0, page: pagina, pageSize: tamanho, history: [], notes: notas, consultedAt: agora.toISOString() };
  if (linha.produtoId === null) {
    notas.push(`SKU ${linha.sku} fora do cadastro de produtos: nenhuma pista por produto. Procure pela nota, Delivery ou remetente na pesquisa do mapa, ou inclua o produto pela importação "Cadastro de produtos" e revise a linha.`);
    return vazio;
  }
  const investigacoes = new Map(
    caso.candidatos
      .filter((c) => c.linhaId === linhaId && c.situacao === 'EM_INVESTIGACAO')
      .map((c) => [chaveInvestigacao(c.base, { paleteId: c.paleteId, segmentoId: c.segmentoId, sessaoId: c.sessaoId, linhaDocumentoId: c.linhaDocumentoId }), c.id]),
  );
  const documento = await documentoDaLinha(db, escopo.id, linha);
  const cte = uniaoDoSku(escopo.id, linha.sku);
  const origemIgual = sql`(r.origem_tipo = ${linha.origemTipo} AND r.origem_referencia = ${linha.origemReferencia})`;
  const loteIgual = sql`(r.lote = ${linha.lote})`;
  const linhas =
    cte === null
      ? []
      : await db.$queryRaw<(LinhaResultado & Extra)[]>`
          WITH ${COLUNAS_R} AS (${cte})
          SELECT r.*, se.segmento_id::text AS segmento_id, se.quantidade_vinculada::text AS vinculada, se.versao AS saldo_versao, se.atualizado_em AS saldo_em,
                 s.concluida_em AS sessao_em, ld.criado_em AS documento_em, d.registrado_em AS declarado_em, NULL::boolean AS arquivado,
                 count(*) OVER () AS total
            FROM r
            LEFT JOIN saldo_estoque se ON r.base = 'SALDO_VALIDADO' AND se.id::text = substr(r.chave, 3)
            LEFT JOIN sessao_conferencia s ON r.base = 'OBSERVADO' AND s.id = r.sessao_id
            LEFT JOIN linha_documento_devolucao ld ON r.base = 'DOCUMENTO' AND ld.id::text = substr(r.chave, 3)
            LEFT JOIN item_declarado d ON r.base = 'DECLARADO_PALETE' AND d.id::text = substr(r.chave, 3)
           WHERE r.produto_id = ${linha.produtoId}::uuid
           ORDER BY CASE r.base WHEN 'SALDO_VALIDADO' THEN 0 WHEN 'OBSERVADO' THEN 1 WHEN 'DECLARADO_PALETE' THEN 2 ELSE 3 END,
                    CASE WHEN ${origemIgual} THEN 0 ELSE 1 END, CASE WHEN ${loteIgual} THEN 0 ELSE 1 END,
                    r.palete_codigo NULLS LAST, r.documento_referencia NULLS LAST, r.documento_linha NULLS LAST, r.chave
           LIMIT ${tamanho} OFFSET ${(pagina - 1) * tamanho}`;
  const total = linhas[0] ? Number(linhas[0].total) : 0;

  const items = linhas.map((l) => {
    const r = resultadoDaLinha(l);
    const base = r.base as Candidato['base'];
    const pallet = r.pallet
      ? {
          id: r.pallet.id,
          code: r.pallet.code,
          positionId: r.pallet.positionId,
          positionCode: r.pallet.positionCode,
          countState: r.pallet.countState,
          releaseState: r.pallet.releaseState,
          flowState: r.pallet.flowState,
          archived: false,
        }
      : null;
    const segmentoId = base === 'SALDO_VALIDADO' ? l.segmento_id : null;
    const chave = chaveInvestigacao(base, {
      paleteId: pallet?.id ?? null,
      segmentoId,
      sessaoId: r.session?.id ?? null,
      linhaDocumentoId: base === 'DOCUMENTO' ? r.key.slice(2) : null,
    });
    const quando = l.saldo_em ?? l.sessao_em ?? l.documento_em ?? l.declarado_em;
    return candidatoDe(base, r, linha, caso.motivo, documento, investigacoes, chave, material(l), {
      key: r.key,
      pallet,
      product: r.product,
      segmentId: segmentoId,
      quantity: r.quantity,
      unit: r.unit,
      reserved: r.reserved,
      linked: l.vinculada === null ? null : normalizarQuantidade(l.vinculada),
      session: r.session ? { id: r.session.id, number: r.session.number, state: r.session.state } : null,
      document: r.document ? { id: r.document.id, reference: r.document.reference, lineReference: r.document.lineReference, invoice: r.document.invoice } : null,
      evidenceAt: quando ? quando.toISOString() : null,
    });
  });

  // Histórico: palete × segmento do produto que já teve saldo e hoje não tem.
  const historico = await db.$queryRaw<
    {
      palete_id: string;
      palete_codigo: string;
      posicao_id: string | null;
      posicao_codigo: string | null;
      estado_conferencia: string;
      estado_liberacao: string;
      estado_fluxo: string;
      arquivado: boolean;
      segmento_id: string;
      produto_id: string;
      sku: string;
      descricao: string;
      lote: string | null;
      origem_tipo: string | null;
      origem_referencia: string | null;
      condicao: string;
      unidade: string;
      ultima: string;
      ocorrido_em: Date;
    }[]
  >`
    SELECT DISTINCT ON (le.palete_id, le.segmento_id)
           p.id::text AS palete_id, p.codigo AS palete_codigo, p.posicao_id::text, pos.codigo AS posicao_codigo,
           p.estado_conferencia::text AS estado_conferencia, p.estado_liberacao::text AS estado_liberacao, p.estado_fluxo::text AS estado_fluxo,
           p.arquivado_em IS NOT NULL AS arquivado, sg.id::text AS segmento_id, sg.produto_id::text, pr.sku, pr.descricao, sg.lote,
           sg.origem_tipo::text AS origem_tipo, sg.origem_referencia, sg.condicao::text AS condicao, sg.unidade,
           le.quantidade_anterior::text AS ultima, ev.ocorrido_em
      FROM linha_evento_estoque le
      JOIN evento_estoque ev ON ev.id = le.evento_id
      JOIN segmento_estoque sg ON sg.id = le.segmento_id
      JOIN produto pr ON pr.id = sg.produto_id
      JOIN palete p ON p.id = le.palete_id
      LEFT JOIN posicao pos ON pos.id = p.posicao_id
     WHERE le.escopo_id = ${escopo.id}::uuid AND sg.produto_id = ${linha.produtoId}::uuid AND le.quantidade_posterior = 0
       AND NOT EXISTS (SELECT 1 FROM saldo_estoque se WHERE se.palete_id = le.palete_id AND se.segmento_id = le.segmento_id)
     ORDER BY le.palete_id, le.segmento_id, ev.ocorrido_em DESC
     LIMIT ${LIMITE_HISTORICO}`;
  const history = historico.map((h) => {
    const pallet = {
      id: h.palete_id,
      code: h.palete_codigo,
      positionId: h.posicao_id,
      positionCode: h.posicao_codigo,
      countState: h.estado_conferencia as EstadoConferencia,
      releaseState: h.estado_liberacao as 'PENDENTE' | 'BLOQUEADO' | 'LIBERADO',
      flowState: h.estado_fluxo as 'EM_ESTOQUE' | 'RESERVADO' | 'EXPEDIDO' | 'VAZIO_ARQUIVADO',
      archived: h.arquivado,
    };
    const c = candidatoDe(
      'HISTORICO',
      null,
      linha,
      caso.motivo,
      documento,
      investigacoes,
      chaveInvestigacao('HISTORICO', { paleteId: h.palete_id, segmentoId: h.segmento_id, sessaoId: null, linhaDocumentoId: null }),
      material(h),
      {
        key: `h:${h.palete_id}:${h.segmento_id}`,
        pallet,
        product: { id: h.produto_id, sku: h.sku, description: h.descricao },
        segmentId: h.segmento_id,
        quantity: normalizarQuantidade(h.ultima),
        unit: h.unidade,
        reserved: null,
        session: null,
        document: null,
        evidenceAt: h.ocorrido_em.toISOString(),
      },
    );
    c.clues.unshift(`Último saldo conhecido ${normalizarQuantidade(h.ultima)} ${h.unidade} até ${h.ocorrido_em.toISOString().slice(0, 10)}.`);
    return c;
  });
  if (items.length === 0 && history.length === 0) notas.push('Nenhuma pista encontrada. Ausência de candidatos não prova perda.');
  return { lineId: linhaId, items, total, page: pagina, pageSize: tamanho, history, notes: notas, consultedAt: agora.toISOString() };
}

// ---------- Investigação registrada ----------

/**
 * Registra a pista na investigação da linha. O servidor relê o registro (não
 * confia em dados do cliente) e guarda o retrato da época.
 */
export async function registrarCandidato(tx: Transacao, escopo: Escopo, claimId: string, dados: z.output<typeof RegistrarCandidatoSchema>, autor: Autor, agora: Date): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'candidatos não são registrados');
  const linha = await tx.linhaClaim.findFirst({ where: { id: dados.lineId, claimId, escopoId: escopo.id }, include: { produto: { select: { unidadeCanonica: true } } } });
  if (!linha) throw naoEncontrado('Linha não encontrada neste claim.');
  if (linha.produtoId === null) throw new ErroHttp(409, 'CONFLITO', `SKU ${linha.sku} fora do cadastro de produtos: inclua-o pela importação "Cadastro de produtos" e revise a linha antes de investigar candidatos.`);
  const paleteId = dados.palletId ?? null;
  const segmentoId = dados.segmentId ?? null;
  const sessaoId = dados.sessionId ?? null;
  const linhaDocumentoId = dados.documentLineId ?? null;
  let retrato: Record<string, string | number | boolean | null>;
  let palete: { id: string; codigo: string; posicao: { codigo: string } | null } | null = null;
  if (dados.base !== 'DOCUMENTO') {
    if (paleteId === null) throw requisicaoInvalida('Informe o palete do candidato.');
    palete = await tx.palete.findFirst({ where: { id: paleteId, escopoId: escopo.id }, select: { id: true, codigo: true, posicao: { select: { codigo: true } } } });
    if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
  }
  const base = { palete: palete?.codigo ?? null, posicao: palete?.posicao?.codigo ?? null };
  switch (dados.base) {
    case 'SALDO_VALIDADO':
    case 'HISTORICO': {
      if (segmentoId === null) throw requisicaoInvalida('Informe o material (segmento) do candidato.');
      const segmento = await tx.segmentoEstoque.findFirst({ where: { id: segmentoId, escopoId: escopo.id }, include: { produto: { select: { sku: true } } } });
      if (!segmento) throw naoEncontrado('Material não encontrado neste escopo.');
      if (segmento.produtoId !== linha.produtoId) throw new ErroHttp(409, 'CONFLITO', 'O material é de outro produto.');
      const saldo = await tx.saldoEstoque.findUnique({ where: { paleteId_segmentoId: { paleteId: paleteId ?? '', segmentoId } } });
      if (dados.base === 'SALDO_VALIDADO' && !saldo) throw new ErroHttp(409, 'CONFLITO', 'O palete não tem mais saldo validado deste material: recarregue os candidatos.');
      retrato = {
        ...base,
        sku: segmento.produto.sku,
        lote: segmento.lote,
        origemTipo: segmento.origemTipo,
        origemReferencia: segmento.origemReferencia,
        condicao: segmento.condicao,
        unidade: segmento.unidade,
        quantidade: saldo ? normalizarQuantidade(saldo.quantidade.toFixed()) : null,
        vinculada: saldo ? normalizarQuantidade(saldo.quantidadeVinculada.toFixed()) : null,
      };
      break;
    }
    case 'OBSERVADO': {
      if (sessaoId === null) throw requisicaoInvalida('Informe a conferência observada.');
      const sessao = await tx.sessaoConferencia.findFirst({ where: { id: sessaoId, escopoId: escopo.id, paleteId: paleteId ?? '' }, select: { numero: true, situacao: true } });
      if (!sessao) throw naoEncontrado('Conferência não encontrada neste palete.');
      const observado = await tx.observacaoConferencia.aggregate({
        where: { sessaoId, produtoId: linha.produtoId, removidaEm: null, pendencia: null },
        _sum: { quantidadeCanonica: true },
      });
      retrato = { ...base, sessao: sessao.numero, situacaoSessao: sessao.situacao, observado: observado._sum.quantidadeCanonica?.toFixed() ?? null };
      break;
    }
    case 'DECLARADO_PALETE': {
      const declarados = await tx.itemDeclarado.aggregate({ where: { paleteId: paleteId ?? '', escopoId: escopo.id, produtoId: linha.produtoId }, _sum: { quantidade: true } });
      retrato = { ...base, declarado: declarados._sum.quantidade?.toFixed() ?? null };
      break;
    }
    case 'DOCUMENTO': {
      if (linhaDocumentoId === null) throw requisicaoInvalida('Informe a linha do documento.');
      const ld = await tx.linhaDocumentoDevolucao.findFirst({ where: { id: linhaDocumentoId, escopoId: escopo.id }, include: { documento: { select: { referencia: true } } } });
      if (!ld) throw naoEncontrado('Linha de documento não encontrada neste escopo.');
      if (ld.produtoId !== linha.produtoId) throw new ErroHttp(409, 'CONFLITO', 'A linha do documento é de outro produto.');
      retrato = { documento: ld.documento.referencia, linhaDocumento: ld.referenciaLinha, nf: ld.notaFiscal, lote: ld.lote, quantidade: ld.quantidadeCanonica.toFixed(), unidade: ld.unidadeCanonica };
      break;
    }
  }
  const chave = chaveInvestigacao(dados.base, { paleteId, segmentoId, sessaoId, linhaDocumentoId });
  const ativos = await tx.candidatoClaim.findMany({ where: { claimId, linhaId: linha.id, situacao: 'EM_INVESTIGACAO' } });
  if (ativos.some((c) => chaveInvestigacao(c.base, { paleteId: c.paleteId, segmentoId: c.segmentoId, sessaoId: c.sessaoId, linhaDocumentoId: c.linhaDocumentoId }) === chave)) {
    throw new ErroHttp(409, 'CONFLITO', 'Esta pista já está em investigação nesta linha.');
  }
  const id = randomUUID();
  await tx.candidatoClaim.create({
    data: {
      id,
      escopoId: escopo.id,
      claimId,
      linhaId: linha.id,
      base: dados.base,
      situacao: 'EM_INVESTIGACAO',
      paleteId: dados.base === 'DOCUMENTO' ? null : paleteId,
      segmentoId: dados.base === 'SALDO_VALIDADO' || dados.base === 'HISTORICO' ? segmentoId : null,
      sessaoId: dados.base === 'OBSERVADO' ? sessaoId : null,
      linhaDocumentoId: dados.base === 'DOCUMENTO' ? linhaDocumentoId : null,
      retrato: { ...retrato, chave },
      observacao: dados.note ?? null,
      registradoPorId: autor.usuarioId,
      registradoEm: agora,
    },
  });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    linhaId: linha.id,
    tipo: 'CANDIDATO_REGISTRADO',
    autorId: autor.usuarioId,
    agora,
    resumo: `Candidato em investigação (${dados.base}${palete ? `, palete ${palete.codigo}` : ''}).`,
    relacionadoId: id,
    detalhes: { base: dados.base, palete: palete?.codigo ?? null },
  });
  if (caso.situacao === 'EM_ANALISE' || caso.situacao === 'BUSCA_EM_ANDAMENTO') {
    await gravarSituacao(tx, escopo.id, caso, 'CANDIDATO_LOCALIZADO', 'Candidato registrado na investigação.', autor, agora);
  } else {
    await tx.claim.update({ where: { id: claimId }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
  }
  await registrarEvento(tx, {
    acao: 'CLAIM_CANDIDATO_REGISTRADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo, base: dados.base, palete: palete?.codigo ?? null },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, claimId, agora);
}

async function candidatoDoCaso(tx: Transacao, escopoId: string, claimId: string, id: string) {
  const c = await tx.candidatoClaim.findFirst({ where: { id, claimId, escopoId }, include: { palete: { select: { codigo: true } } } });
  if (!c) throw naoEncontrado('Candidato não encontrado neste claim.');
  return c;
}

/**
 * Pede conferência/recontagem do palete do candidato: registra a solicitação
 * e, se informada, vincula uma conferência existente do mesmo palete (os
 * responsáveis da conferência continuam os dela). Não cria nem altera
 * conferência nem saldo.
 */
export async function solicitarConferencia(
  tx: Transacao,
  escopo: Escopo,
  claimId: string,
  candidatoId: string,
  dados: z.output<typeof SolicitarConferenciaSchema>,
  autor: Autor,
  agora: Date,
): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'conferências não são solicitadas');
  const c = await candidatoDoCaso(tx, escopo.id, claimId, candidatoId);
  if (c.situacao !== 'EM_INVESTIGACAO') throw new ErroHttp(409, 'CONFLITO', 'Candidato descartado não recebe solicitação.');
  if (c.versao !== dados.expectedVersion) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O candidato foi alterado em outra tela. Recarregue.');
  if (c.paleteId === null) throw new ErroHttp(409, 'CONFLITO', 'Pista documental não tem palete para conferir.');
  let sessao: { id: string; numero: number } | null = null;
  if (dados.sessionId !== null) {
    sessao = await tx.sessaoConferencia.findFirst({ where: { id: dados.sessionId, escopoId: escopo.id, paleteId: c.paleteId }, select: { id: true, numero: true } });
    if (!sessao) throw naoEncontrado('Conferência não encontrada neste palete.');
  }
  await tx.candidatoClaim.update({
    where: { id: c.id },
    data: {
      conferenciaSolicitadaPorId: c.conferenciaSolicitadaPorId ?? autor.usuarioId,
      conferenciaSolicitadaEm: c.conferenciaSolicitadaEm ?? agora,
      notaConferencia: c.notaConferencia ? `${c.notaConferencia}\n${dados.note}` : dados.note,
      sessaoVinculadaId: sessao?.id ?? c.sessaoVinculadaId,
      versao: { increment: 1 },
    },
  });
  await tx.claim.update({ where: { id: claimId }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    linhaId: c.linhaId,
    tipo: 'CONFERENCIA_SOLICITADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Conferência do palete ${c.palete?.codigo ?? ''} solicitada${sessao ? ` (vinculada à conferência nº ${String(sessao.numero)})` : ''}: ${dados.note}`,
    relacionadoId: c.id,
    detalhes: { palete: c.palete?.codigo ?? null, conferencia: sessao?.numero ?? null },
  });
  await registrarEvento(tx, {
    acao: 'CLAIM_CONFERENCIA_SOLICITADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo, palete: c.palete?.codigo ?? null, conferencia: sessao?.numero ?? null },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, claimId, agora);
}

export async function descartarCandidato(
  tx: Transacao,
  escopo: Escopo,
  claimId: string,
  candidatoId: string,
  dados: z.output<typeof DescartarCandidatoSchema>,
  autor: Autor,
  agora: Date,
): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'candidatos não são descartados');
  const c = await candidatoDoCaso(tx, escopo.id, claimId, candidatoId);
  if (c.situacao !== 'EM_INVESTIGACAO') throw new ErroHttp(409, 'CONFLITO', 'O candidato já foi descartado.');
  if (c.versao !== dados.expectedVersion) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O candidato foi alterado em outra tela. Recarregue.');
  await tx.candidatoClaim.update({
    where: { id: c.id },
    data: { situacao: 'DESCARTADO', descartadoEm: agora, descartadoPorId: autor.usuarioId, motivoDescarte: dados.reason, versao: { increment: 1 } },
  });
  await tx.claim.update({ where: { id: claimId }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    linhaId: c.linhaId,
    tipo: 'CANDIDATO_DESCARTADO',
    autorId: autor.usuarioId,
    agora,
    resumo: `Candidato descartado${c.palete ? ` (palete ${c.palete.codigo})` : ''}: ${dados.reason}`,
    relacionadoId: c.id,
    detalhes: { motivo: dados.reason },
  });
  await registrarEvento(tx, {
    acao: 'CLAIM_CANDIDATO_DESCARTADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, claimId, agora);
}
