/**
 * Resultado da regularização (etapa 07; R18–R19): decisão financeira
 * registrada por quem tem `claim.aprovar_financeiro`, separada da validação
 * da recuperação física. Exige data, linhas e quantidades cobertas, fonte,
 * referência verificável e evidência. Guarda o retrato da estimativa e da
 * fonte no momento (atualização posterior de preço não muda a decisão).
 * Valor confirmado diferente da estimativa (ou estimativa não derivável sem
 * presumir regra contratual) exige justificativa. Cobrança já finalizada
 * exige prova do resultado externo. O aplicativo não cancela, estorna nem
 * abre cobranças: só registra decisões.
 */
import {
  UNIDADE_PECA,
  compararQuantidades,
  compararValores,
  ehQuantidadeInteira,
  normalizarQuantidade,
  normalizarValor,
  somarValores,
  type AnularResultadoSchema,
  type ClaimDetalhe,
  type Escopo,
  type RegistrarResultadoSchema,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { exigirAnexosLivres } from './evidencias.js';
import { registrarEventoClaim } from './historico.js';
import { detalheClaim } from './leitura.js';
import { estimativaParaCobertura } from './regras.js';
import { bloquearCaso, exigirAberto, type Autor } from './servico.js';

type DadosResultado = z.output<typeof RegistrarResultadoSchema>;

/** Libera a cobertura de um resultado vigente (correção ou anulação). */
async function liberarCobertura(tx: Transacao, resultadoId: string, agora: Date): Promise<void> {
  const linhas = await tx.resultadoLinhaClaim.findMany({ where: { resultadoId }, select: { linhaId: true, quantidade: true } });
  for (const l of linhas) {
    await tx.$executeRaw`
      UPDATE linha_claim SET quantidade_coberta = quantidade_coberta - ${l.quantidade.toFixed()}::numeric, atualizado_em = ${agora} WHERE id = ${l.linhaId}::uuid`;
  }
}

export async function registrarResultado(tx: Transacao, escopo: Escopo, claimId: string, dados: DadosResultado, autor: Autor, agora: Date): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'resultados não são registrados');
  const claim = await tx.claim.findUniqueOrThrow({ where: { id: claimId }, select: { moeda: true, fonteValor: true, cobrancaFinalizada: true } });

  // Cobrança finalizada: a regularização depende da prova do resultado externo.
  if (claim.cobrancaFinalizada && dados.type === 'REGULARIZACAO' && (dados.externalResultReference ?? null) === null) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      'A cobrança deste caso já foi finalizada no cliente: a regularização só é registrada com a prova do resultado externo (referência do documento da área responsável). O aplicativo não cancela nem estorna cobranças.',
    );
  }

  // Correção: o resultado original sai de vigência (com motivo) e libera a cobertura antes.
  let original: { id: string; numero: number } | null = null;
  if (dados.correctsResultId !== null) {
    const r = await tx.resultadoClaim.findFirst({ where: { id: dados.correctsResultId, claimId, escopoId: escopo.id }, select: { id: true, numero: true, situacao: true } });
    if (!r) throw naoEncontrado('Resultado a corrigir não encontrado neste claim.');
    if (r.situacao !== 'VIGENTE') throw new ErroHttp(409, 'CONFLITO', `O resultado R${String(r.numero)} já foi corrigido ou anulado.`);
    original = { id: r.id, numero: r.numero };
  }

  // Linhas cobertas: bloqueadas em ordem; cobertura nunca passa da quantidade em análise.
  const ids = [...dados.lines.map((l) => l.lineId)].sort();
  await tx.$queryRaw`SELECT id FROM linha_claim WHERE claim_id = ${claimId}::uuid AND id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  if (original) {
    await liberarCobertura(tx, original.id, agora);
  }
  const linhas = await tx.linhaClaim.findMany({ where: { claimId, id: { in: ids } } });
  if (linhas.length !== ids.length) throw naoEncontrado('Linha não encontrada neste claim.');
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const estimativas = dados.lines.map((entrada) => {
    const l = porId.get(entrada.lineId);
    if (!l) throw naoEncontrado('Linha não encontrada neste claim.');
    const q = normalizarQuantidade(entrada.quantity);
    if (l.unidade === UNIDADE_PECA && !ehQuantidadeInteira(q)) throw requisicaoInvalida(`Linha ${l.identificador}: quantidade em peças (UN) precisa ser inteira.`);
    const livre = normalizarQuantidade(l.quantidadeAnalise.minus(l.quantidadeCoberta).toFixed());
    if (compararQuantidades(q, livre) > 0) {
      throw new ErroHttp(
        409,
        'QUANTIDADE_INDISPONIVEL',
        `Linha ${l.identificador}: a cobertura passa da quantidade em análise (${livre} ${l.unidade} ainda sem resultado). Recuperação parcial não confirma o valor integral.`,
      );
    }
    const regra = {
      valorEstimado: l.valorEstimado === null ? null : normalizarValor(l.valorEstimado.toFixed()),
      baseValor: l.baseValor,
      quantidade: normalizarQuantidade(l.quantidadeAnalise.toFixed()),
    };
    return {
      lineId: l.id,
      lineRef: l.identificador,
      estimatedValue: regra.valorEstimado,
      valueBase: l.baseValor,
      lineQuantity: regra.quantidade,
      coveredQuantity: q,
      estimateForCovered: estimativaParaCobertura(regra, q),
    };
  });
  const total = estimativas.every((e) => e.estimateForCovered !== null) ? somarValores(estimativas.map((e) => e.estimateForCovered ?? '0')) : null;
  const retratoEstimativa = { currency: claim.moeda, source: claim.fonteValor, lines: estimativas, total };

  // Valor confirmado ≠ estimativa (ou estimativa não derivável/de outra moeda) exige justificativa.
  if (dados.value !== null) {
    const igual = total !== null && dados.currency === claim.moeda && compararValores(normalizarValor(dados.value), total) === 0;
    if (!igual && (dados.valueJustification ?? '').trim().length < 10) {
      throw requisicaoInvalida(
        total === null
          ? 'A estimativa correspondente à quantidade coberta não é derivável sem presumir regra contratual: justifique o valor confirmado (com a evidência).'
          : `O valor confirmado (${normalizarValor(dados.value)} ${dados.currency ?? ''}) difere da estimativa correspondente (${total} ${claim.moeda ?? ''}): justifique a diferença.`,
      );
    }
  }

  // Evidências citadas: do caso e não rejeitadas.
  if (dados.evidenceIds.length > 0) {
    const evidencias = await tx.evidenciaClaim.findMany({ where: { claimId, escopoId: escopo.id, id: { in: dados.evidenceIds } }, select: { id: true, situacao: true, numero: true } });
    if (evidencias.length !== new Set(dados.evidenceIds).size) throw naoEncontrado('Evidência não encontrada neste claim.');
    const rejeitada = evidencias.find((e) => e.situacao === 'REJEITADA');
    if (rejeitada) throw new ErroHttp(409, 'CONFLITO', `A evidência E${String(rejeitada.numero)} foi rejeitada e não sustenta o resultado.`);
  }
  await exigirAnexosLivres(tx, escopo.id, claimId, dados.attachmentIds);

  if (original) {
    await tx.resultadoClaim.update({
      where: { id: original.id },
      data: { situacao: 'CORRIGIDO', encerradoPorId: autor.usuarioId, encerradoEm: agora, motivoEncerramento: dados.correctionReason ?? '', versao: { increment: 1 } },
    });
  }
  const [ultimo] = await tx.$queryRaw<{ n: number }[]>`SELECT coalesce(max(numero), 0)::int AS n FROM resultado_claim WHERE claim_id = ${claimId}::uuid`;
  const numero = (ultimo?.n ?? 0) + 1;
  const id = randomUUID();
  await tx.resultadoClaim.create({
    data: {
      id,
      escopoId: escopo.id,
      claimId,
      numero,
      tipo: dados.type,
      situacao: 'VIGENTE',
      dataDecisao: new Date(`${dados.decisionDate}T00:00:00.000Z`),
      valor: dados.value === null ? null : normalizarValor(dados.value),
      moeda: dados.currency,
      fonte: dados.source,
      referencia: dados.reference,
      referenciaResultadoExterno: dados.externalResultReference ?? null,
      justificativaValor: dados.valueJustification ?? null,
      estimativa: retratoEstimativa,
      evidencias: [...new Set(dados.evidenceIds)],
      autorId: autor.usuarioId,
      registradoEm: agora,
      corrigeId: original?.id ?? null,
      motivoCorrecao: original ? (dados.correctionReason ?? null) : null,
    },
  });
  await tx.resultadoLinhaClaim.createMany({
    data: dados.lines.map((l) => ({ id: randomUUID(), escopoId: escopo.id, resultadoId: id, linhaId: l.lineId, quantidade: normalizarQuantidade(l.quantity) })),
  });
  for (const l of dados.lines) {
    await tx.$executeRaw`
      UPDATE linha_claim SET quantidade_coberta = quantidade_coberta + ${normalizarQuantidade(l.quantity)}::numeric, atualizado_em = ${agora} WHERE id = ${l.lineId}::uuid`;
  }
  if (dados.attachmentIds.length > 0) await tx.anexoClaim.updateMany({ where: { id: { in: dados.attachmentIds }, claimId }, data: { resultadoId: id } });
  await tx.claim.update({ where: { id: claimId }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
  const cobertura = dados.lines.map((l) => `linha ${porId.get(l.lineId)?.identificador ?? ''}: ${normalizarQuantidade(l.quantity)} ${porId.get(l.lineId)?.unidade ?? ''}`).join('; ');
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    tipo: original ? 'RESULTADO_CORRIGIDO' : 'RESULTADO_REGISTRADO',
    autorId: autor.usuarioId,
    agora,
    resumo: `${original ? `Resultado R${String(original.numero)} corrigido por R${String(numero)}` : `Resultado R${String(numero)} registrado`} (${dados.type === 'REGULARIZACAO' ? 'regularização' : 'perda confirmada'}): ${cobertura}${
      dados.value === null ? '' : `; valor confirmado ${normalizarValor(dados.value)} ${dados.currency ?? ''}`
    }.`,
    relacionadoId: original?.id ?? id,
    detalhes: {
      resultado: numero,
      tipo: dados.type,
      valor: dados.value === null ? null : normalizarValor(dados.value),
      moeda: dados.currency,
      estimativa: total,
      fonte: dados.source,
      referencia: dados.reference,
      corrige: original?.numero ?? null,
    },
  });
  await registrarEvento(tx, {
    acao: original ? 'CLAIM_RESULTADO_CORRIGIDO' : 'CLAIM_RESULTADO_REGISTRADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo, resultado: numero, tipo: dados.type, corrige: original?.numero ?? null },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, claimId, agora);
}

export async function anularResultado(
  tx: Transacao,
  escopo: Escopo,
  claimId: string,
  resultadoId: string,
  dados: z.output<typeof AnularResultadoSchema>,
  autor: Autor,
  agora: Date,
): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'resultados não são anulados');
  const r = await tx.resultadoClaim.findFirst({ where: { id: resultadoId, claimId, escopoId: escopo.id }, select: { id: true, numero: true, situacao: true, versao: true } });
  if (!r) throw naoEncontrado('Resultado não encontrado neste claim.');
  if (r.versao !== dados.expectedVersion) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O resultado mudou desde a sua revisão. Recarregue.');
  if (r.situacao !== 'VIGENTE') throw new ErroHttp(409, 'CONFLITO', `O resultado R${String(r.numero)} já foi corrigido ou anulado.`);
  const linhas = await tx.resultadoLinhaClaim.findMany({ where: { resultadoId: r.id }, select: { linhaId: true } });
  const ids = linhas.map((l) => l.linhaId).sort();
  await tx.$queryRaw`SELECT id FROM linha_claim WHERE claim_id = ${claimId}::uuid AND id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  await liberarCobertura(tx, r.id, agora);
  await tx.resultadoClaim.update({
    where: { id: r.id },
    data: { situacao: 'ANULADO', encerradoPorId: autor.usuarioId, encerradoEm: agora, motivoEncerramento: dados.reason, versao: { increment: 1 } },
  });
  await tx.claim.update({ where: { id: claimId }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    tipo: 'RESULTADO_ANULADO',
    autorId: autor.usuarioId,
    agora,
    resumo: `Resultado R${String(r.numero)} anulado: ${dados.reason}. A quantidade volta a ficar sem resultado; nada é apagado.`,
    relacionadoId: r.id,
    detalhes: { resultado: r.numero, motivo: dados.reason },
  });
  await registrarEvento(tx, {
    acao: 'CLAIM_RESULTADO_ANULADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo, resultado: r.numero },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, claimId, agora);
}
