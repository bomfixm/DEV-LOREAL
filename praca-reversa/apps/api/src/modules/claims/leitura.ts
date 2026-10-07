/**
 * Leitura dos claims (etapa 07): detalhe do caso, lista paginada com filtros
 * no servidor, resumo do módulo, histórico, responsáveis e exportação CSV.
 * Tudo restrito ao escopo ativo (o filtro de escopo vem antes de qualquer
 * outro). Bases separadas: estimado em análise, recuperação física
 * validada, valor evitado confirmado e perda confirmada nunca se somam; cada
 * agregado é calculado no seu próprio grão (sem duplicar valores por junção).
 */
import {
  PERMISSOES_POR_PERFIL,
  ROTULOS_MOTIVO_CLAIM,
  ROTULOS_SITUACAO_CLAIM,
  compararQuantidades,
  normalizarQuantidade,
  normalizarValor,
  somarQuantidades,
  subtrairQuantidades,
  totaisPorMoeda,
  type Anexo,
  type CandidatoInvestigado,
  type ClaimDetalhe,
  type ClaimResumo,
  type Escopo,
  type EventoClaim,
  type Evidencia,
  type FiltroClaims,
  type FiltroPendencia,
  type LinhaClaim,
  type OrdemClaims,
  type PaginaClaims,
  type PaginaHistoricoClaim,
  type Pendencia,
  type Perfil,
  type QuantidadePorUnidade,
  type Recuperacao,
  type ResultadoClaim,
  type ResumoClaims,
  type SituacaoClaim,
  type TipoEventoClaim,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';
import { naoEncontrado } from '../../http/erros.js';
import { estimadoDoCaso, estimativaTotalLinha, pendenciasDaLinha, porUnidade, transicoesPermitidas, type LinhaRegra } from './regras.js';

type Db = Banco | Transacao;
type Sql = Prisma.Sql;
const { sql, join } = Prisma;

const usuario = { select: { login: true, nome: true } } as const;
const resumoUsuario = (u: { login: string; nome: string }) => ({ login: u.login, name: u.nome });
const data = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));
const q = (d: Prisma.Decimal) => normalizarQuantidade(d.toFixed());
const qn = (d: Prisma.Decimal | null) => (d === null ? null : q(d));
const v = (d: Prisma.Decimal | null) => (d === null ? null : normalizarValor(d.toFixed()));

const selecaoAnexo = {
  id: true,
  nome: true,
  tipoConteudo: true,
  tamanho: true,
  sha256: true,
  enviadoEm: true,
  evidenciaId: true,
  resultadoId: true,
  enviadoPor: usuario,
} as const;

type AnexoLido = Prisma.AnexoClaimGetPayload<{ select: typeof selecaoAnexo }>;

export function anexoDe(a: AnexoLido): Anexo {
  return {
    id: a.id,
    name: a.nome,
    contentType: a.tipoConteudo as Anexo['contentType'],
    size: a.tamanho,
    sha256: a.sha256,
    uploadedBy: resumoUsuario(a.enviadoPor),
    uploadedAt: a.enviadoEm.toISOString(),
    evidenceId: a.evidenciaId,
    resultId: a.resultadoId,
  };
}

const selecaoCaso = {
  responsavel: { select: { id: true, login: true, nome: true } },
  criadoPor: usuario,
  encerradoPor: usuario,
  linhas: { orderBy: { ordem: 'asc' }, include: { produto: { select: { unidadeCanonica: true } } } },
  candidatos: {
    orderBy: { registradoEm: 'asc' },
    include: {
      palete: { select: { id: true, codigo: true } },
      registradoPor: usuario,
      conferenciaSolicitadaPor: usuario,
      sessaoVinculada: { select: { id: true, numero: true, situacao: true } },
    },
  },
  evidencias: {
    orderBy: { numero: 'asc' },
    include: {
      linha: { select: { identificador: true } },
      palete: { select: { id: true, codigo: true } },
      segmento: { include: { produto: { select: { sku: true, descricao: true } } } },
      sessao: { select: { id: true, numero: true } },
      linhaDocumento: { select: { id: true, referenciaLinha: true, documento: { select: { referencia: true } } } },
      autor: usuario,
      solicitadaPor: usuario,
      decididaPor: usuario,
      anexos: { select: selecaoAnexo, orderBy: { enviadoEm: 'asc' } },
    },
  },
  recuperacoes: {
    orderBy: { validadaEm: 'asc' },
    include: {
      linha: { select: { identificador: true } },
      palete: { select: { id: true, codigo: true } },
      segmento: { include: { produto: { select: { sku: true, descricao: true } } } },
      validadaPor: usuario,
      estornadaPor: usuario,
      vinculos: { include: { palete: { select: { id: true, codigo: true, posicaoId: true, posicao: { select: { codigo: true } } } } } },
    },
  },
  resultados: {
    orderBy: { numero: 'asc' },
    include: {
      autor: usuario,
      encerradoPor: usuario,
      correcoes: { select: { id: true } },
      linhas: { include: { linha: { select: { identificador: true, unidade: true, ordem: true } } } },
      anexos: { select: selecaoAnexo, orderBy: { enviadoEm: 'asc' } },
    },
  },
  anexos: { select: selecaoAnexo, orderBy: { enviadoEm: 'asc' } },
} satisfies Prisma.ClaimInclude;

type CasoLido = Prisma.ClaimGetPayload<{ include: typeof selecaoCaso }>;

export function linhaRegraDe(l: CasoLido['linhas'][number]): LinhaRegra {
  return {
    id: l.id,
    identificador: l.identificador,
    produtoId: l.produtoId,
    sku: l.sku,
    unidade: l.unidade,
    unidadeCanonica: l.produto?.unidadeCanonica ?? null,
    quantidade: q(l.quantidadeAnalise),
    lote: l.lote,
    loteExigido: l.loteExigido,
    origemTipo: l.origemTipo,
    origemReferencia: l.origemReferencia,
    origemLinha: l.origemLinha,
    valorEstimado: v(l.valorEstimado),
    baseValor: l.baseValor,
    recuperada: q(l.quantidadeRecuperada),
    coberta: q(l.quantidadeCoberta),
  };
}

function candidatoDe(c: CasoLido['candidatos'][number]): CandidatoInvestigado {
  return {
    id: c.id,
    lineId: c.linhaId,
    base: c.base,
    state: c.situacao,
    pallet: c.palete ? { id: c.palete.id, code: c.palete.codigo } : null,
    segmentId: c.segmentoId,
    documentLineId: c.linhaDocumentoId,
    snapshot: c.retrato as Record<string, unknown>,
    note: c.observacao,
    registeredBy: resumoUsuario(c.registradoPor),
    registeredAt: c.registradoEm.toISOString(),
    conference:
      c.conferenciaSolicitadaEm && c.conferenciaSolicitadaPor && c.notaConferencia !== null
        ? {
            requestedBy: resumoUsuario(c.conferenciaSolicitadaPor),
            requestedAt: c.conferenciaSolicitadaEm.toISOString(),
            note: c.notaConferencia,
            session: c.sessaoVinculada ? { id: c.sessaoVinculada.id, number: c.sessaoVinculada.numero, state: c.sessaoVinculada.situacao } : null,
          }
        : null,
    discardedReason: c.motivoDescarte,
    version: c.versao,
  };
}

function evidenciaDe(e: CasoLido['evidencias'][number]): Evidencia {
  return {
    id: e.id,
    number: e.numero,
    lineId: e.linhaId,
    lineRef: e.linha.identificador,
    type: e.tipo,
    state: e.situacao,
    candidateId: e.candidatoId,
    pallet: e.palete ? { id: e.palete.id, code: e.palete.codigo } : null,
    positionCodeAtTime: e.posicaoNaEpoca,
    segmentId: e.segmentoId,
    material: e.segmento
      ? {
          sku: e.segmento.produto.sku,
          description: e.segmento.produto.descricao,
          lot: e.segmento.lote,
          originType: e.segmento.origemTipo,
          originReference: e.segmento.origemReferencia,
          condition: e.segmento.condicao,
          unit: e.segmento.unidade,
        }
      : null,
    session: e.sessao ? { id: e.sessao.id, number: e.sessao.numero } : null,
    documentLine: e.linhaDocumento ? { id: e.linhaDocumento.id, reference: e.linhaDocumento.documento.referencia, lineReference: e.linhaDocumento.referenciaLinha } : null,
    quantity: qn(e.quantidade),
    unit: e.unidade,
    description: e.descricao,
    verifiableReference: e.referenciaVerificavel,
    snapshot: e.retrato as Record<string, unknown>,
    attachments: e.anexos.map(anexoDe),
    author: resumoUsuario(e.autor),
    registeredAt: e.registradaEm.toISOString(),
    request:
      e.quantidadeSolicitada && e.solicitadaPor && e.solicitadaEm
        ? { quantity: q(e.quantidadeSolicitada), note: e.notaSolicitacao, by: resumoUsuario(e.solicitadaPor), at: e.solicitadaEm.toISOString() }
        : null,
    decision:
      e.decididaPor && e.decididaEm && e.justificativaDecisao !== null
        ? { by: resumoUsuario(e.decididaPor), at: e.decididaEm.toISOString(), justification: e.justificativaDecisao }
        : null,
    version: e.versao,
  };
}

function recuperacaoDe(r: CasoLido['recuperacoes'][number]): Recuperacao {
  return {
    id: r.id,
    lineId: r.linhaId,
    lineRef: r.linha.identificador,
    evidenceId: r.evidenciaId,
    segmentId: r.segmentoId,
    material: {
      sku: r.segmento.produto.sku,
      description: r.segmento.produto.descricao,
      lot: r.segmento.lote,
      originType: r.segmento.origemTipo,
      originReference: r.segmento.origemReferencia,
      condition: r.segmento.condicao,
      unit: r.segmento.unidade,
    },
    palletAtValidation: { id: r.palete.id, code: r.palete.codigo, positionCode: r.posicaoNaEpoca },
    currentLocations: r.vinculos
      .map((x) => ({
        palletId: x.palete.id,
        palletCode: x.palete.codigo,
        positionId: x.palete.posicaoId,
        positionCode: x.palete.posicao?.codigo ?? null,
        quantity: q(x.quantidade),
      }))
      .sort((a, b) => a.palletCode.localeCompare(b.palletCode)),
    quantity: q(r.quantidade),
    unit: r.unidade,
    state: r.situacao,
    validatedBy: resumoUsuario(r.validadaPor),
    validatedAt: r.validadaEm.toISOString(),
    justification: r.justificativa,
    lotTreatment: r.tratativaLote,
    reversal:
      r.estornadaPor && r.estornadaEm && r.motivoEstorno !== null
        ? { by: resumoUsuario(r.estornadaPor), at: r.estornadaEm.toISOString(), reason: r.motivoEstorno }
        : null,
    version: r.versao,
  };
}

function resultadoDe(r: CasoLido['resultados'][number]): ResultadoClaim {
  return {
    id: r.id,
    number: r.numero,
    type: r.tipo,
    state: r.situacao,
    decisionDate: data(r.dataDecisao) ?? '',
    lines: r.linhas
      .sort((a, b) => a.linha.ordem - b.linha.ordem)
      .map((l) => ({ lineId: l.linhaId, lineRef: l.linha.identificador, quantity: q(l.quantidade), unit: l.linha.unidade })),
    value: v(r.valor),
    currency: r.moeda,
    source: r.fonte,
    reference: r.referencia,
    externalResultReference: r.referenciaResultadoExterno,
    valueJustification: r.justificativaValor,
    estimateSnapshot: r.estimativa as ResultadoClaim['estimateSnapshot'],
    evidenceIds: r.evidencias as string[],
    attachments: r.anexos.map(anexoDe),
    author: resumoUsuario(r.autor),
    registeredAt: r.registradoEm.toISOString(),
    correctsResultId: r.corrigeId,
    correctionReason: r.motivoCorrecao,
    closure:
      r.encerradoPor && r.encerradoEm && r.motivoEncerramento !== null
        ? { by: resumoUsuario(r.encerradoPor), at: r.encerradoEm.toISOString(), reason: r.motivoEncerramento, replacedById: r.correcoes[0]?.id ?? null }
        : null,
    version: r.versao,
  };
}

/** Caso do escopo com tudo o que o detalhe mostra; outro escopo responde como inexistente. */
export async function lerCaso(db: Db, escopoId: string, id: string): Promise<CasoLido> {
  const caso = await db.claim.findFirst({ where: { id, escopoId }, include: selecaoCaso });
  if (!caso) throw naoEncontrado('Claim não encontrado neste escopo.');
  return caso;
}

/** Totais e pendências calculados dos registros (bases separadas). */
export function montarDetalhe(caso: CasoLido, agora: Date): ClaimDetalhe {
  const linhasRegra = caso.linhas.map(linhaRegraDe);
  const vigentes = caso.resultados.filter((r) => r.situacao === 'VIGENTE');
  const cobertaPorTipo = (linhaId: string, tipo: 'REGULARIZACAO' | 'PERDA_CONFIRMADA') =>
    somarQuantidades(vigentes.filter((r) => r.tipo === tipo).flatMap((r) => r.linhas.filter((l) => l.linhaId === linhaId).map((l) => q(l.quantidade))));
  const pendentes = caso.evidencias.filter((e) => e.situacao === 'VALIDACAO_SOLICITADA').length;

  const linhas: LinhaClaim[] = linhasRegra.map((l) => {
    const regularizada = cobertaPorTipo(l.id, 'REGULARIZACAO');
    const perda = cobertaPorTipo(l.id, 'PERDA_CONFIRMADA');
    const fonte = caso.linhas.find((x) => x.id === l.id);
    return {
      id: l.id,
      lineRef: l.identificador,
      order: fonte?.ordem ?? 1,
      productId: l.produtoId,
      sku: l.sku,
      description: fonte?.descricao ?? null,
      quantity: l.quantidade,
      unit: l.unidade,
      canonicalUnit: l.unidadeCanonica,
      lot: l.lote,
      lotRequired: l.loteExigido,
      originType: l.origemTipo,
      originReference: l.origemReferencia,
      originLine: l.origemLinha,
      estimatedValue: l.valorEstimado,
      valueBase: l.baseValor,
      estimateTotal: estimativaTotalLinha(l),
      recovered: l.recuperada,
      remaining: subtrairQuantidades(l.quantidade, l.recuperada),
      covered: l.coberta,
      coveredRegularized: regularizada,
      coveredLoss: perda,
      pendencies: pendenciasDaLinha(l, caso.motivo, regularizada),
      version: fonte?.versao ?? 1,
    };
  });

  const pendencias: Pendencia[] = [];
  const caso1 = (code: Pendencia['code'], message: string) => pendencias.push({ code, message, lineId: null, blocksValidation: false });
  if (caso.referenciaExterna === null) caso1('SEM_REFERENCIA_EXTERNA', 'Referência externa do claim não informada.');
  if (caso.prazo === null) caso1('SEM_PRAZO', 'Prazo não informado (nenhum prazo é calculado).');
  if (caso.responsavelId === null) caso1('SEM_RESPONSAVEL', 'Caso sem responsável.');
  if (linhasRegra.some((l) => l.valorEstimado === null)) caso1('VALOR_SEM_ESTIMATIVA', 'Há linha sem valor estimado: o total estimado é parcial ou inexistente.');
  if (pendentes > 0) caso1('VALIDACAO_PENDENTE', `${String(pendentes)} validação(ões) de recuperação aguardando decisão.`);
  const provaExterna = vigentes.some((r) => r.tipo === 'REGULARIZACAO' && r.referenciaResultadoExterno !== null);
  if (caso.cobrancaFinalizada && !provaExterna) {
    caso1('COBRANCA_FINALIZADA', 'Cobrança já finalizada no cliente: pendência da área responsável até a prova do resultado externo (o aplicativo não altera a cobrança).');
  }
  if (linhasRegra.some((l) => compararQuantidades(l.coberta, l.quantidade) < 0)) {
    caso1('SEM_RESULTADO', 'Há quantidade sem resultado registrado (perda/avaria em tratativa ou regularização pendente).');
  }
  pendencias.push(...linhas.flatMap((l) => l.pendencies));

  const valores = (tipo: 'REGULARIZACAO' | 'PERDA_CONFIRMADA') =>
    totaisPorMoeda(
      vigentes.filter((r) => r.tipo === tipo && r.valor !== null && r.moeda !== null).map((r) => ({ moeda: r.moeda ?? '', valor: v(r.valor) ?? '0' })),
    );
  const quantidadesResultado = (tipo: 'REGULARIZACAO' | 'PERDA_CONFIRMADA') =>
    porUnidade(vigentes.filter((r) => r.tipo === tipo).flatMap((r) => r.linhas.map((l) => ({ unidade: l.linha.unidade, quantidade: q(l.quantidade) }))));
  const estimativa = estimadoDoCaso(linhasRegra, caso.moeda);

  return {
    id: caso.id,
    code: caso.codigo,
    externalReference: caso.referenciaExterna,
    reason: caso.motivo,
    state: caso.situacao,
    priority: caso.prioridade,
    deadline: data(caso.prazo),
    openedOn: data(caso.dataAbertura),
    occurredOn: data(caso.dataOcorrencia),
    responsible: caso.responsavel ? { id: caso.responsavel.id, login: caso.responsavel.login, name: caso.responsavel.nome } : null,
    currency: caso.moeda,
    valueSource: caso.fonteValor,
    externalStatus: caso.situacaoExterna,
    chargeReference: caso.referenciaCobranca,
    chargeFinalized: caso.cobrancaFinalizada,
    notes: caso.observacoes,
    origin: caso.origemCadastro,
    importBatchId: caso.loteImportacaoId,
    createdBy: resumoUsuario(caso.criadoPor),
    createdAt: caso.criadoEm.toISOString(),
    updatedAt: caso.atualizadoEm.toISOString(),
    closure:
      caso.encerradoPor && caso.encerradoEm && caso.decisaoEncerramento !== null
        ? { by: resumoUsuario(caso.encerradoPor), at: caso.encerradoEm.toISOString(), decision: caso.decisaoEncerramento }
        : null,
    version: caso.versao,
    lines: linhas,
    totals: {
      inAnalysis: porUnidade(linhasRegra.map((l) => ({ unidade: l.unidade, quantidade: l.quantidade }))),
      validatedRecovery: porUnidade(linhasRegra.map((l) => ({ unidade: l.unidade, quantidade: l.recuperada }))),
      withoutValidatedRecovery: porUnidade(linhasRegra.map((l) => ({ unidade: l.unidade, quantidade: subtrairQuantidades(l.quantidade, l.recuperada) }))),
      estimated: estimativa.estimado,
      estimatePartial: estimativa.parcial,
      avoidedConfirmed: valores('REGULARIZACAO'),
      lossConfirmed: valores('PERDA_CONFIRMADA'),
      regularizedQuantity: quantidadesResultado('REGULARIZACAO'),
      lossConfirmedQuantity: quantidadesResultado('PERDA_CONFIRMADA'),
      inTreatmentQuantity: porUnidade(linhasRegra.map((l) => ({ unidade: l.unidade, quantidade: subtrairQuantidades(l.quantidade, l.coberta) }))),
    },
    pendencies: pendencias,
    candidates: caso.candidatos.map(candidatoDe),
    evidences: caso.evidencias.map(evidenciaDe),
    recoveries: caso.recuperacoes.map(recuperacaoDe),
    results: caso.resultados.map(resultadoDe),
    attachments: caso.anexos.map(anexoDe),
    allowedTransitions: transicoesPermitidas(caso.situacao, pendentes),
    consultedAt: agora.toISOString(),
  };
}

export async function detalheClaim(db: Db, escopoId: string, id: string, agora: Date): Promise<ClaimDetalhe> {
  return montarDetalhe(await lerCaso(db, escopoId, id), agora);
}

// ---------- Lista, resumo e exportação ----------

/** Data de hoje no fuso da unidade do escopo (prazo vencido / próximos dias). */
export async function hojeNoEscopo(db: Db, escopoId: string, agora: Date): Promise<string> {
  const [linha] = await db.$queryRaw<{ fuso: string }[]>`
    SELECT u.fuso FROM escopo e JOIN unidade u ON u.id = e.unidade_id WHERE e.id = ${escopoId}::uuid`;
  const fuso = linha?.fuso ?? 'America/Sao_Paulo';
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

const FINAIS = sql`('REGULARIZADO', 'PERDA_CONFIRMADA', 'ENCERRADO')`;

/** Caso em triagem: algum campo necessário para validar ainda pendente (igual a PENDENCIAS_TRIAGEM). */
const TRIAGEM = sql`(c.referencia_externa IS NULL OR EXISTS (
  SELECT 1 FROM linha_claim lt LEFT JOIN produto pt ON pt.id = lt.produto_id
   WHERE lt.claim_id = c.id
     AND (lt.produto_id IS NULL OR pt.unidade_canonica <> lt.unidade OR lt.origem_referencia IS NULL
          OR lt.origem_tipo::text = 'NOTA_FISCAL' OR (lt.lote_exigido AND lt.lote IS NULL))))`;

/** Pendências do caso (mesma definição no resumo, na lista e nos indicadores da etapa 10). */
export const PENDENCIA_SQL: Readonly<Record<FiltroPendencia, Sql>> = {
  TRIAGEM,
  VALIDACAO_PENDENTE: sql`EXISTS (SELECT 1 FROM evidencia_claim ep WHERE ep.claim_id = c.id AND ep.situacao::text = 'VALIDACAO_SOLICITADA')`,
  COBRANCA_FINALIZADA: sql`(c.cobranca_finalizada AND NOT EXISTS (SELECT 1 FROM resultado_claim rp WHERE rp.claim_id = c.id AND rp.situacao::text = 'VIGENTE'
                             AND rp.tipo::text = 'REGULARIZACAO' AND rp.referencia_resultado_externo IS NOT NULL))`,
  SEM_RESPONSAVEL: sql`c.responsavel_id IS NULL`,
  SEM_PRAZO: sql`c.prazo IS NULL`,
  SEM_RECUPERACAO_VALIDADA: sql`EXISTS (SELECT 1 FROM linha_claim lr WHERE lr.claim_id = c.id AND lr.quantidade_recuperada < lr.quantidade_analise)`,
};

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Condições do filtro; o escopo vem sempre primeiro. */
function condicoes(escopoId: string, f: FiltroClaims, hoje: string): Sql {
  const partes: Sql[] = [sql`c.escopo_id = ${escopoId}::uuid`];
  const texto = (f.texto ?? '').trim();
  if (texto !== '') {
    const prefixo = `${escaparLike(texto.toUpperCase())}%`;
    partes.push(sql`(upper(c.codigo) LIKE ${prefixo} OR upper(c.referencia_externa) LIKE ${prefixo}
                     OR EXISTS (SELECT 1 FROM linha_claim lx WHERE lx.claim_id = c.id AND lx.escopo_id = ${escopoId}::uuid
                                AND (upper(lx.sku) LIKE ${prefixo} OR upper(lx.origem_referencia) LIKE ${prefixo})))`);
  }
  if (f.motivo) partes.push(sql`c.motivo::text = ${f.motivo}`);
  if (f.situacao && f.situacao.length > 0) partes.push(sql`c.situacao::text = ANY(${f.situacao}::text[])`);
  if (f.responsavel === 'NENHUM') partes.push(sql`c.responsavel_id IS NULL`);
  else if (f.responsavel) partes.push(sql`c.responsavel_id = ${f.responsavel}::uuid`);
  if (f.prazo === 'VENCIDO') partes.push(sql`c.prazo < ${hoje}::date AND c.situacao::text NOT IN ${FINAIS}`);
  if (f.prazo === 'PROXIMOS_7_DIAS') partes.push(sql`c.prazo BETWEEN ${hoje}::date AND (${hoje}::date + 7) AND c.situacao::text NOT IN ${FINAIS}`);
  if (f.prazo === 'COM_PRAZO') partes.push(sql`c.prazo IS NOT NULL`);
  if (f.prazo === 'SEM_PRAZO') partes.push(sql`c.prazo IS NULL`);
  if (f.sku) partes.push(sql`EXISTS (SELECT 1 FROM linha_claim ls WHERE ls.claim_id = c.id AND ls.escopo_id = ${escopoId}::uuid AND upper(ls.sku) = upper(${f.sku}))`);
  if (f.origem) {
    partes.push(
      sql`EXISTS (SELECT 1 FROM linha_claim lo WHERE lo.claim_id = c.id AND lo.escopo_id = ${escopoId}::uuid AND upper(lo.origem_referencia) = upper(${f.origem}))`,
    );
  }
  if (f.pendencia) partes.push(PENDENCIA_SQL[f.pendencia]);
  if (f.prioridade === 'NENHUMA') partes.push(sql`c.prioridade IS NULL`);
  else if (f.prioridade) partes.push(sql`c.prioridade::text = ${f.prioridade}`);
  return join(partes, ' AND ');
}

/** Estimativa do caso: soma das linhas (unitário × quantidade ou total da linha). */
export const ESTIMADO_CASO = sql`(SELECT sum(CASE WHEN le.base_valor::text = 'UNITARIO' THEN le.valor_estimado * le.quantidade_analise ELSE le.valor_estimado END)
                             FROM linha_claim le WHERE le.claim_id = c.id)`;

function ordem(o: OrdemClaims): Sql {
  switch (o) {
    case 'PRIORIDADE':
      return sql`CASE c.prioridade::text WHEN 'URGENTE' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'NORMAL' THEN 2 WHEN 'BAIXA' THEN 3 ELSE 4 END, c.prazo ASC NULLS LAST, c.numero ASC`;
    case 'PRAZO':
      return sql`c.prazo ASC NULLS LAST, c.numero ASC`;
    case 'VALOR':
      // Valores só se comparam dentro da mesma moeda: agrupados por moeda.
      return sql`c.moeda ASC NULLS LAST, ${ESTIMADO_CASO} DESC NULLS LAST, c.numero ASC`;
    case 'RECENTES':
      return sql`c.criado_em DESC, c.numero DESC`;
  }
}

interface LinhaLista {
  id: string;
  codigo: string;
  referencia_externa: string | null;
  motivo: ClaimResumo['reason'];
  situacao: SituacaoClaim;
  prioridade: ClaimResumo['priority'];
  prazo: string | null;
  responsavel_id: string | null;
  responsavel_login: string | null;
  responsavel_nome: string | null;
  primeiro_sku: string;
  linhas: number;
  em_analise: { unit: string; quantity: string }[] | null;
  recuperada: { unit: string; quantity: string }[] | null;
  moeda: string | null;
  estimado: string | null;
  estimado_parcial: boolean;
  cobranca_finalizada: boolean;
  pendentes: number;
  triagem: boolean;
  atualizado_em: Date;
  total: bigint;
}

const POR_UNIDADE = (coluna: string) =>
  Prisma.raw(`(SELECT json_agg(json_build_object('unit', x.u, 'quantity', x.q::text) ORDER BY x.u)
                 FROM (SELECT lu.unidade AS u, sum(lu.${coluna}) AS q FROM linha_claim lu WHERE lu.claim_id = c.id GROUP BY lu.unidade) x WHERE x.q > 0)`);

function unidades(lista: { unit: string; quantity: string }[] | null): QuantidadePorUnidade[] {
  return (lista ?? []).map((i) => ({ unit: i.unit, quantity: normalizarQuantidade(i.quantity) }));
}

async function consultarLista(db: Db, escopoId: string, f: FiltroClaims, o: OrdemClaims, hoje: string, limite: number, deslocamento: number): Promise<LinhaLista[]> {
  return db.$queryRaw<LinhaLista[]>`
    SELECT c.id::text, c.codigo, c.referencia_externa, c.motivo::text AS motivo, c.situacao::text AS situacao, c.prioridade::text AS prioridade,
           to_char(c.prazo, 'YYYY-MM-DD') AS prazo, c.responsavel_id::text, u.login AS responsavel_login, u.nome AS responsavel_nome,
           (SELECT lp.sku FROM linha_claim lp WHERE lp.claim_id = c.id ORDER BY lp.ordem LIMIT 1) AS primeiro_sku,
           (SELECT count(*)::int FROM linha_claim lc WHERE lc.claim_id = c.id) AS linhas,
           ${POR_UNIDADE('quantidade_analise')} AS em_analise,
           ${POR_UNIDADE('quantidade_recuperada')} AS recuperada,
           c.moeda, ${ESTIMADO_CASO}::text AS estimado,
           coalesce((SELECT bool_or(lv.valor_estimado IS NULL) AND bool_or(lv.valor_estimado IS NOT NULL) FROM linha_claim lv WHERE lv.claim_id = c.id), false) AS estimado_parcial,
           c.cobranca_finalizada,
           (SELECT count(*)::int FROM evidencia_claim ev WHERE ev.claim_id = c.id AND ev.situacao::text = 'VALIDACAO_SOLICITADA') AS pendentes,
           ${TRIAGEM} AS triagem,
           c.atualizado_em,
           count(*) OVER () AS total
      FROM claim c LEFT JOIN usuario u ON u.id = c.responsavel_id
     WHERE ${condicoes(escopoId, f, hoje)}
     ORDER BY ${ordem(o)}
     LIMIT ${limite} OFFSET ${deslocamento}`;
}

function resumoDe(l: LinhaLista): ClaimResumo {
  return {
    id: l.id,
    code: l.codigo,
    externalReference: l.referencia_externa,
    reason: l.motivo,
    state: l.situacao,
    priority: l.prioridade,
    deadline: l.prazo,
    responsible: l.responsavel_id && l.responsavel_login && l.responsavel_nome ? { id: l.responsavel_id, login: l.responsavel_login, name: l.responsavel_nome } : null,
    firstSku: l.primeiro_sku,
    lineCount: l.linhas,
    inAnalysis: unidades(l.em_analise),
    validatedRecovery: unidades(l.recuperada),
    currency: l.moeda,
    estimated: l.estimado === null ? null : normalizarValor(l.estimado),
    estimatePartial: l.estimado_parcial,
    chargeFinalized: l.cobranca_finalizada,
    pendingValidations: l.pendentes,
    triage: l.triagem,
    updatedAt: l.atualizado_em.toISOString(),
  };
}

export async function listarClaims(db: Db, escopo: Escopo, f: FiltroClaims, ordemPadrao: OrdemClaims, agora: Date): Promise<PaginaClaims> {
  const hoje = await hojeNoEscopo(db, escopo.id, agora);
  const o = f.ordem ?? ordemPadrao;
  const linhas = await consultarLista(db, escopo.id, f, o, hoje, f.tamanho, (f.pagina - 1) * f.tamanho);
  let total = linhas[0] ? Number(linhas[0].total) : 0;
  if (linhas.length === 0 && f.pagina > 1) {
    const [contagem] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM claim c WHERE ${condicoes(escopo.id, f, hoje)}`;
    total = Number(contagem?.n ?? 0);
  }
  return { items: linhas.map(resumoDe), total, page: f.pagina, pageSize: f.tamanho, sort: o, defaultSort: ordemPadrao, today: hoje, consultedAt: agora.toISOString() };
}

export async function resumirClaims(db: Db, escopo: Escopo, f: FiltroClaims, agora: Date): Promise<ResumoClaims> {
  const hoje = await hojeNoEscopo(db, escopo.id, agora);
  const filtro = condicoes(escopo.id, f, hoje);
  const filtrados = sql`SELECT c.id FROM claim c WHERE ${filtro}`;
  const [porSituacao, pendencias, recuperada, estimado, valores] = await Promise.all([
    db.$queryRaw<{ situacao: SituacaoClaim; n: bigint }[]>`
      SELECT c.situacao::text AS situacao, count(*) AS n FROM claim c WHERE ${filtro} GROUP BY c.situacao ORDER BY c.situacao`,
    db.$queryRaw<Record<FiltroPendencia, bigint>[]>`
      SELECT ${join(
        (Object.keys(PENDENCIA_SQL) as FiltroPendencia[]).map((k) => sql`count(*) FILTER (WHERE ${PENDENCIA_SQL[k]}) AS ${Prisma.raw(`"${k}"`)}`),
        ', ',
      )}
        FROM claim c WHERE ${filtro}`,
    db.$queryRaw<{ unidade: string; quantidade: string; casos: bigint }[]>`
      SELECT l.unidade, sum(l.quantidade_recuperada)::text AS quantidade, count(DISTINCT l.claim_id) FILTER (WHERE l.quantidade_recuperada > 0) AS casos
        FROM linha_claim l WHERE l.claim_id IN (${filtrados}) GROUP BY l.unidade HAVING sum(l.quantidade_recuperada) > 0 ORDER BY l.unidade`,
    db.$queryRaw<{ moeda: string; valor: string; casos: bigint; parciais: bigint }[]>`
      SELECT e.moeda, sum(e.valor)::text AS valor, count(*) AS casos, count(*) FILTER (WHERE e.parcial) AS parciais
        FROM (SELECT c.moeda, ${ESTIMADO_CASO} AS valor,
                     coalesce((SELECT bool_or(lv.valor_estimado IS NULL) FROM linha_claim lv WHERE lv.claim_id = c.id), false) AS parcial
                FROM claim c WHERE ${filtro}) e
       WHERE e.moeda IS NOT NULL AND e.valor IS NOT NULL GROUP BY e.moeda ORDER BY e.moeda`,
    db.$queryRaw<{ tipo: string; moeda: string; valor: string; n: bigint }[]>`
      SELECT r.tipo::text AS tipo, r.moeda, sum(r.valor)::text AS valor, count(*) AS n
        FROM resultado_claim r
       WHERE r.claim_id IN (${filtrados}) AND r.situacao::text = 'VIGENTE' AND r.valor IS NOT NULL
       GROUP BY r.tipo, r.moeda ORDER BY r.tipo, r.moeda`,
  ]);
  const p = pendencias[0];
  return {
    cases: porSituacao.reduce((t, s) => t + Number(s.n), 0),
    byState: porSituacao.map((s) => ({ state: s.situacao, count: Number(s.n) })),
    pendencies: (Object.keys(PENDENCIA_SQL) as FiltroPendencia[]).map((code) => ({ code, count: Number(p?.[code] ?? 0) })),
    validatedRecovery: recuperada.map((r) => ({ unit: r.unidade, quantity: normalizarQuantidade(r.quantidade), cases: Number(r.casos) })),
    estimated: estimado.map((e) => ({ currency: e.moeda, value: normalizarValor(e.valor), cases: Number(e.casos), partialCases: Number(e.parciais) })),
    avoidedConfirmed: valores
      .filter((r) => r.tipo === 'REGULARIZACAO')
      .map((r) => ({ currency: r.moeda, value: normalizarValor(r.valor), results: Number(r.n) })),
    lossConfirmed: valores
      .filter((r) => r.tipo === 'PERDA_CONFIRMADA')
      .map((r) => ({ currency: r.moeda, value: normalizarValor(r.valor), results: Number(r.n) })),
    basis: [
      'Casos do escopo ativo com os filtros aplicados.',
      'Estimado em análise: soma das estimativas das linhas (unitário × quantidade ou total da linha), por moeda; não é valor evitado.',
      'Recuperação física validada: recuperações ativas, por unidade (sem conversão).',
      'Valor evitado e perda confirmados: resultados vigentes registrados por perfil autorizado, por moeda.',
    ],
    consultedAt: agora.toISOString(),
  };
}

/** Linhas para a exportação CSV (mesmos filtros e ordem da lista), até o limite. */
export async function claimsParaExportar(db: Db, escopo: Escopo, f: FiltroClaims, ordemPadrao: OrdemClaims, limite: number, agora: Date) {
  const hoje = await hojeNoEscopo(db, escopo.id, agora);
  const linhas = await consultarLista(db, escopo.id, f, f.ordem ?? ordemPadrao, hoje, limite, 0);
  const ids = linhas.map((l) => l.id);
  const valores =
    ids.length === 0
      ? []
      : await db.$queryRaw<{ claim_id: string; tipo: string; moeda: string; valor: string }[]>`
          SELECT r.claim_id::text, r.tipo::text AS tipo, r.moeda, sum(r.valor)::text AS valor
            FROM resultado_claim r
           WHERE r.escopo_id = ${escopo.id}::uuid AND r.claim_id = ANY(${ids}::uuid[]) AND r.situacao::text = 'VIGENTE' AND r.valor IS NOT NULL
           GROUP BY r.claim_id, r.tipo, r.moeda`;
  const semRecuperacao =
    ids.length === 0
      ? []
      : await db.$queryRaw<{ claim_id: string; unidade: string; q: string }[]>`
          SELECT l.claim_id::text, l.unidade, sum(l.quantidade_analise - l.quantidade_recuperada)::text AS q
            FROM linha_claim l WHERE l.escopo_id = ${escopo.id}::uuid AND l.claim_id = ANY(${ids}::uuid[]) GROUP BY l.claim_id, l.unidade`;
  return {
    total: linhas[0] ? Number(linhas[0].total) : 0,
    itens: linhas.map((l) => ({
      resumo: resumoDe(l),
      semRecuperacao: porUnidade(semRecuperacao.filter((s) => s.claim_id === l.id).map((s) => ({ unidade: s.unidade, quantidade: normalizarQuantidade(s.q) }))),
      evitado: valores.filter((r) => r.claim_id === l.id && r.tipo === 'REGULARIZACAO').map((r) => ({ currency: r.moeda, value: normalizarValor(r.valor) })),
      perda: valores.filter((r) => r.claim_id === l.id && r.tipo === 'PERDA_CONFIRMADA').map((r) => ({ currency: r.moeda, value: normalizarValor(r.valor) })),
    })),
  };
}

export const ROTULOS_EXPORTACAO = { motivo: ROTULOS_MOTIVO_CLAIM, situacao: ROTULOS_SITUACAO_CLAIM };

// ---------- Histórico e responsáveis ----------

export async function historicoClaim(db: Db, escopoId: string, claimId: string, pagina: number, tamanho: number): Promise<PaginaHistoricoClaim> {
  const existe = await db.claim.count({ where: { id: claimId, escopoId } });
  if (existe === 0) throw naoEncontrado('Claim não encontrado neste escopo.');
  const where = { escopoId, claimId };
  const [total, eventos] = await Promise.all([
    db.eventoClaim.count({ where }),
    db.eventoClaim.findMany({
      where,
      orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * tamanho,
      take: tamanho,
      include: { autor: usuario, linha: { select: { identificador: true } } },
    }),
  ]);
  const items: EventoClaim[] = eventos.map((e) => ({
    id: e.id,
    type: e.tipo as TipoEventoClaim,
    at: e.ocorridoEm.toISOString(),
    author: e.autor ? resumoUsuario(e.autor) : null,
    lineRef: e.linha?.identificador ?? null,
    summary: e.resumo,
    relatedId: e.relacionadoId,
    details: e.detalhes as Record<string, unknown>,
  }));
  return { items, total, page: pagina, pageSize: tamanho };
}

/** Perfis que tratam claims (podem ser responsáveis). */
export const PERFIS_RESPONSAVEIS: readonly Perfil[] = (Object.keys(PERMISSOES_POR_PERFIL) as Perfil[]).filter((p) => PERMISSOES_POR_PERFIL[p].includes('claim.tratar'));

export async function responsaveisDoEscopo(db: Db, escopoId: string) {
  const vinculos = await db.vinculo.findMany({
    where: { escopoId, ativo: true, perfil: { in: [...PERFIS_RESPONSAVEIS] }, usuario: { ativo: true } },
    include: { usuario: { select: { id: true, login: true, nome: true } } },
    orderBy: { usuario: { login: 'asc' } },
  });
  return vinculos.map((v) => ({ id: v.usuario.id, login: v.usuario.login, name: v.usuario.nome }));
}

