/**
 * Confirmação da expedição física, correção de informação e retorno físico
 * (etapa 08; R24, R25).
 *
 * Confirmar é uma transação única: cria a expedição e a fotografia real,
 * baixa do saldo validado só o que foi enviado (evento EXPEDICAO por palete),
 * consome a reserva e libera explicitamente o restante, converte a capacidade
 * reservada em expedida e grava histórico, auditoria e idempotência. Uma
 * confirmação conclui a reserva (envio menor exige a confirmação explícita de
 * "quantidade enviada e restante a liberar"). Repetir com a mesma chave
 * devolve a saída original; outra chave encontra a reserva consumida; o
 * banco garante uma expedição por reserva e um evento por expedição × palete.
 *
 * Expedição concluída não é desfeita: correção de informação gera nova
 * versão com motivo, sem efeito físico. Retorno físico é registrado contra a
 * expedição original (limitado ao enviado − já retornado); só o recebimento
 * comprovado vira declaração no palete de destino, e a entrada no estoque
 * acontece pela conferência e reconciliação. Capacidade da janela não volta.
 */
import {
  compararQuantidades,
  normalizarQuantidade,
  somarQuantidades,
  subtrairQuantidades,
  type ConfirmarExpedicaoSchema,
  type CorrigirExpedicaoSchema,
  type Escopo,
  type ExpedicaoDetalhe,
  type RegistrarRetornoSchema,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { aplicarEvento, bloquearSaldos, recalcularResumoPaletes } from '../estoque/saldo.js';
import { calcularConsumo, type LinhaCarga, type MedidaCarga } from './capacidade.js';
import {
  bloquearJanela,
  bloquearReserva,
  codigoNumerado,
  exigirResponsavel,
  exigirVersao,
  janelaDaReserva,
  lerPaletes,
  proximoNumero,
  registrarEventoJanela,
  type Autor,
} from './comum.js';
import { criteriosDe, criteriosRegra, detalheExpedicao, lerJanela, lerMaterial, lerReserva, materialRegra, restricaoRegra } from './leitura.js';
import { janelaOperavel, problemasParaExpedir } from './regras.js';
import { exigirAnexosDaJanela } from './servico.js';
import { registrarMovimentacaoRelevante } from '../paletes/relogio.js';

type DadosConfirmar = z.output<typeof ConfirmarExpedicaoSchema>;
type DadosCorrigir = z.output<typeof CorrigirExpedicaoSchema>;
type DadosRetorno = z.output<typeof RegistrarRetornoSchema>;

const TOLERANCIA_FUTURO_MS = 5 * 60_000;
const qn = (d: Prisma.Decimal) => normalizarQuantidade(d.toFixed());

/** Documentos exigidos pela janela presentes (referência textual ou anexo da própria janela). */
async function conferirDocumentos(tx: Transacao, escopoId: string, janelaId: string, exigidos: readonly string[], documentos: DadosConfirmar['documents']): Promise<void> {
  const nomes = new Set(documentos.map((d) => d.name.trim().toLowerCase()));
  const faltam = exigidos.filter((e) => !nomes.has(e.trim().toLowerCase()));
  if (faltam.length > 0) {
    throw new ErroHttp(409, 'PENDENCIA_DOCUMENTAL', `Documento(s) exigido(s) pela janela ausente(s): ${faltam.join(', ')}. Informe a referência ou anexe o comprovante.`);
  }
  await exigirAnexosDaJanela(
    tx,
    escopoId,
    janelaId,
    documentos.flatMap((d) => (d.attachmentId === null ? [] : [d.attachmentId])),
  );
}

export async function confirmarExpedicao(tx: Transacao, escopo: Escopo, reservaId: string, dados: DadosConfirmar, autor: Autor, agora: Date): Promise<ExpedicaoDetalhe> {
  const janelaId = await janelaDaReserva(tx, escopo.id, reservaId);
  const janela = await bloquearJanela(tx, escopo.id, janelaId);
  const travada = await bloquearReserva(tx, escopo.id, reservaId);
  if (travada.situacao === 'CONSUMIDA') {
    const existente = await tx.expedicao.findFirst({ where: { escopoId: escopo.id, reservaId }, select: { codigo: true } });
    throw new ErroHttp(409, 'SITUACAO_INVALIDA', `A saída desta reserva já foi confirmada (${existente?.codigo ?? 'expedição registrada'}): nenhuma nova baixa é feita.`);
  }
  if (travada.situacao !== 'ATIVA') {
    throw new ErroHttp(409, 'SITUACAO_INVALIDA', `A reserva ${travada.codigo} foi ${travada.situacao === 'CANCELADA' ? 'cancelada' : 'liberada'} antes da saída: a expedição é recusada.`);
  }
  const situacao = janelaOperavel(janela.situacao);
  if (situacao) throw new ErroHttp(409, 'SITUACAO_INVALIDA', situacao);
  exigirVersao(travada.versao, dados.expectedVersion, `A reserva ${travada.codigo}`);
  const j = await lerJanela(tx, escopo.id, janelaId);
  const saida = new Date(dados.shippedAt);
  if (saida.getTime() > agora.getTime() + TOLERANCIA_FUTURO_MS) throw requisicaoInvalida('A saída confirmada não pode estar no futuro: registre a saída depois que ela acontecer.');
  if (j.saidaInicio === null || j.saidaFim === null || saida < j.saidaInicio || saida > j.saidaFim) {
    throw new ErroHttp(
      409,
      'SITUACAO_INVALIDA',
      'Saída fora do período autorizado da janela. Exceção exige decisão registrada: altere o período da janela com justificativa e fonte da autorização.',
    );
  }
  const responsavel = await exigirResponsavel(tx, escopo.id, dados.responsibleId);
  const reserva = await lerReserva(tx, escopo.id, reservaId);

  // Quantidades enviadas: todas as linhas, uma vez; positivas e no máximo o reservado.
  const enviadas = new Map(dados.lines.map((l) => [l.lineId, normalizarQuantidade(l.quantity)]));
  if (enviadas.size !== dados.lines.length || dados.lines.length !== reserva.linhas.length || reserva.linhas.some((l) => !enviadas.has(l.id))) {
    throw requisicaoInvalida('Informe a quantidade enviada de cada linha da reserva, uma vez (0 = nada desta linha).');
  }
  let parcial = false;
  for (const l of reserva.linhas) {
    const enviada = enviadas.get(l.id) ?? '0';
    const reservada = qn(l.quantidade);
    if (compararQuantidades(enviada, reservada) > 0) {
      throw new ErroHttp(409, 'CONFLITO', `${l.paleteCodigo} · ${l.sku}: enviado ${enviada} acima dos ${reservada} ${l.unidade} reservados. Aumento ou substituição exige nova reserva (revisão autorizada).`);
    }
    if (compararQuantidades(enviada, reservada) < 0) parcial = true;
  }
  if (parcial && !dados.remainderAcknowledged) {
    throw new ErroHttp(409, 'CONFLITO', 'Envio menor que o reservado: confirme explicitamente a quantidade enviada e o restante a liberar.');
  }
  await conferirDocumentos(tx, escopo.id, janelaId, j.documentosExigidos, dados.documents);

  // Material: bloqueios na ordem fixa e revalidação do estado atual.
  const paleteIds = [...new Set(reserva.linhas.map((l) => l.paleteId))];
  const paletes = await lerPaletes(tx, escopo.id, paleteIds, true);
  await bloquearSaldos(tx, escopo.id, paleteIds);
  const material = await lerMaterial(tx, escopo.id, { paleteIds });
  const porChave = new Map(material.map((m) => [`${m.palete_id}:${m.segmento_id}`, m]));
  const criterios = criteriosRegra(criteriosDe(j));
  const problemas: string[] = [];
  for (const l of reserva.linhas) {
    const enviada = enviadas.get(l.id) ?? '0';
    if (compararQuantidades(enviada, '0') === 0) continue;
    const m = porChave.get(`${l.paleteId}:${l.segmentoId}`);
    if (!m) {
      problemas.push(`${l.paleteCodigo} · ${l.sku}: saldo validado não encontrado.`);
      continue;
    }
    for (const p of problemasParaExpedir(materialRegra(m), criterios)) problemas.push(`${l.paleteCodigo} · ${l.sku}${l.lote ? ` lote ${l.lote}` : ''}: ${p}`);
    if (compararQuantidades(m.reservada, qn(l.quantidade)) < 0) problemas.push(`${l.paleteCodigo} · ${l.sku}: reserva no saldo incoerente.`);
  }
  if (problemas.length > 0) throw new ErroHttp(409, 'MATERIAL_INELEGIVEL', `Saída recusada; nada foi baixado. ${problemas.join(' ')}`);

  // Unidades de carga enviadas e medidas reais.
  const enviadasPorPalete = new Map<string, string>();
  for (const l of reserva.linhas) {
    const enviada = enviadas.get(l.id) ?? '0';
    if (compararQuantidades(enviada, '0') > 0) enviadasPorPalete.set(l.paleteId, somarQuantidades([enviadasPorPalete.get(l.paleteId) ?? '0', enviada]));
  }
  const reais = new Map(dados.loadUnits.map((u) => [u.palletId, u]));
  for (const u of dados.loadUnits) {
    if (!enviadasPorPalete.has(u.palletId)) throw requisicaoInvalida('Medida informada para unidade de carga que não foi enviada.');
    if (u.weightKg !== null && u.weightBase === null) throw requisicaoInvalida('Informe se o peso real é bruto ou líquido.');
  }
  const medidas = new Map<string, MedidaCarga>(
    [...reais.values()].map((u) => [
      u.palletId,
      {
        paleteId: u.palletId,
        caixas: u.boxes,
        pesoKg: u.weightKg === null ? null : normalizarQuantidade(u.weightKg),
        basePeso: u.weightBase,
        volumeM3: u.volumeM3 === null ? null : normalizarQuantidade(u.volumeM3),
        fonte: u.measurementSource,
      },
    ]),
  );
  const cargaEnviada: LinhaCarga[] = reserva.linhas
    .filter((l) => compararQuantidades(enviadas.get(l.id) ?? '0', '0') > 0)
    .map((l) => ({ paleteId: l.paleteId, paleteCodigo: l.paleteCodigo, sku: l.sku, unidade: l.unidade, quantidade: enviadas.get(l.id) ?? '0' }));
  const reservadoPorRestricao = new Map(reserva.metricas.map((m) => [m.restricaoId, qn(m.valor)]));
  const conversoes: { restricaoId: string; metrica: (typeof j.restricoes)[number]['metrica']; unidade: string; reservado: string; expedido: string }[] = [];
  const falhas: string[] = [];
  for (const r of j.restricoes.map(restricaoRegra)) {
    const consumo = calcularConsumo(r, cargaEnviada, medidas);
    const reservado = reservadoPorRestricao.get(r.id);
    if (reservado === undefined) {
      falhas.push(`Restrição de ${r.metrica} sem métrica na reserva: libere e refaça a reserva.`);
      continue;
    }
    if (consumo.valor === null) {
      falhas.push(`Medida real: ${consumo.mensagem}`);
      continue;
    }
    if (compararQuantidades(consumo.valor, reservado) > 0) {
      falhas.push(
        `Medida real de ${r.metrica === 'QUANTIDADE' ? `quantidade (${r.unidade})` : r.metrica} (${normalizarQuantidade(consumo.valor)}) maior que a reservada (${reservado}): registre a nova medida na preparação, que revalida a capacidade.`,
      );
      continue;
    }
    conversoes.push({ restricaoId: r.id, metrica: r.metrica, unidade: r.unidade, reservado, expedido: normalizarQuantidade(consumo.valor) });
  }
  if (falhas.length > 0) throw new ErroHttp(409, 'CAPACIDADE_INSUFICIENTE', `Saída recusada; nada foi baixado. ${falhas.join(' ')}`);

  // Palete inteiro que sai: todo o saldo validado enviado (sem restante nem conteúdo desconhecido).
  const saem = new Set(dados.loadUnits.filter((u) => u.palletLeaves).map((u) => u.palletId));
  for (const paleteId of saem) {
    const p = paletes.get(paleteId);
    const linhasDoPalete = material.filter((m) => m.palete_id === paleteId);
    const restante = linhasDoPalete.some((m) => {
      const linha = reserva.linhas.find((l) => l.paleteId === paleteId && l.segmentoId === m.segmento_id);
      const enviada = linha ? (enviadas.get(linha.id) ?? '0') : '0';
      return compararQuantidades(m.quantidade, enviada) !== 0;
    });
    if (p?.estado_conferencia !== 'RECONCILIADO' || restante) {
      throw new ErroHttp(
        409,
        'CONFLITO',
        `O palete ${p?.codigo ?? ''} tem saldo restante ou conteúdo não validado integralmente: ele permanece na posição (só o enviado sai do saldo).`,
      );
    }
  }

  // ---------- Gravação (tudo ou nada) ----------
  const numero = await proximoNumero(tx, escopo.id, 'expedicao');
  const expedicaoId = randomUUID();
  const codigo = codigoNumerado('EXP', numero);
  await tx.expedicao.create({
    data: {
      id: expedicaoId,
      escopoId: escopo.id,
      janelaId,
      reservaId,
      numero,
      codigo,
      saidaEm: saida,
      responsavelId: dados.responsibleId,
      confirmadaPorId: autor.usuarioId,
      confirmadaEm: agora,
      parcial,
      observacoes: dados.notes ?? null,
    },
  });
  for (const l of reserva.linhas) {
    const enviada = enviadas.get(l.id) ?? '0';
    const reservada = qn(l.quantidade);
    const liberada = subtrairQuantidades(reservada, enviada);
    await tx.linhaExpedicao.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        expedicaoId,
        linhaReservaId: l.id,
        paleteId: l.paleteId,
        segmentoId: l.segmentoId,
        unidade: l.unidade,
        sku: l.sku,
        descricao: l.descricao,
        lote: l.lote,
        origemTipo: l.origemTipo,
        origemReferencia: l.origemReferencia,
        condicao: l.condicao,
        paleteCodigo: l.paleteCodigo,
        posicaoCodigo: paletes.get(l.paleteId)?.posicao_codigo ?? null,
        quantidadeReservada: reservada,
        quantidadeEnviada: enviada,
        quantidadeLiberada: liberada,
      },
    });
    // Reserva consumida inteira (enviado + restante liberado); a parte enviada sai da liberação.
    await tx.$executeRaw`
      UPDATE saldo_estoque
         SET quantidade_reservada = quantidade_reservada - ${reservada}::numeric,
             quantidade_liberada = quantidade_liberada - ${enviada}::numeric
       WHERE escopo_id = ${escopo.id}::uuid AND palete_id = ${l.paleteId}::uuid AND segmento_id = ${l.segmentoId}::uuid`;
    await tx.linhaReserva.update({ where: { id: l.id }, data: { quantidadeEnviada: enviada, quantidadeLiberada: liberada } });
  }
  for (const [paleteId] of enviadasPorPalete) {
    const p = paletes.get(paleteId);
    const u = reais.get(paleteId);
    await tx.unidadeCargaExpedicao.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        expedicaoId,
        paleteId,
        paleteCodigo: p?.codigo ?? '',
        caixas: u?.boxes === null || u?.boxes === undefined ? null : Number(u.boxes),
        pesoKg: u?.weightKg ?? null,
        basePeso: u?.weightBase ?? null,
        volumeM3: u?.volumeM3 ?? null,
        fonteMedida: u?.measurementSource ?? null,
        paleteSaiu: saem.has(paleteId),
      },
    });
    // Baixa única do que foi enviado deste palete (evento EXPEDICAO).
    const linhasPalete = reserva.linhas.filter((l) => l.paleteId === paleteId && compararQuantidades(enviadas.get(l.id) ?? '0', '0') > 0);
    await aplicarEvento(tx, {
      escopoId: escopo.id,
      tipo: 'EXPEDICAO',
      paleteId,
      paleteDestinoId: null,
      sessaoId: null,
      eventoCorrigidoId: null,
      expedicaoId,
      motivo: `Expedição ${codigo} (janela ${j.codigo}, reserva ${reserva.codigo})`,
      autorId: autor.usuarioId,
      agora,
      linhas: linhasPalete.map((l) => {
        const m = porChave.get(`${l.paleteId}:${l.segmentoId}`);
        if (!m) throw new Error('Material da linha não encontrado.');
        const enviada = enviadas.get(l.id) ?? '0';
        return {
          paleteId,
          segmentoId: l.segmentoId,
          produtoId: m.produto_id,
          lote: m.lote,
          origemTipo: m.origem_tipo,
          origemReferencia: m.origem_referencia,
          condicao: m.condicao,
          linhagem: null,
          unidade: m.unidade,
          atual: normalizarQuantidade(m.quantidade),
          alvo: normalizarQuantidade(subtrairQuantidades(m.quantidade, enviada)),
          delta: subtrairQuantidades('0', enviada),
        };
      }),
    });
  }
  for (const c of conversoes) {
    const liberado = subtrairQuantidades(c.reservado, c.expedido);
    await tx.metricaExpedicao.create({
      data: { id: randomUUID(), escopoId: escopo.id, expedicaoId, restricaoId: c.restricaoId, metrica: c.metrica, unidade: c.unidade, valorReservado: c.reservado, valorExpedido: c.expedido, valorLiberado: liberado },
    });
    await tx.$executeRaw`
      UPDATE restricao_janela SET reservado = reservado - ${c.reservado}::numeric, expedido = expedido + ${c.expedido}::numeric, atualizado_em = ${agora}
       WHERE id = ${c.restricaoId}::uuid`;
  }
  for (const [ordem, d] of dados.documents.entries()) {
    await tx.documentoExpedicao.create({ data: { id: randomUUID(), escopoId: escopo.id, expedicaoId, versao: 1, ordem, nome: d.name, referencia: d.reference, anexoId: d.attachmentId } });
  }
  await tx.reservaJanela.update({
    where: { id: reservaId },
    data: {
      situacao: 'CONSUMIDA',
      consumoParcial: parcial,
      encerradaEm: agora,
      encerradaPorId: autor.usuarioId,
      motivoEncerramento: `Expedição ${codigo}${parcial ? ' (conclusão parcial: restante liberado)' : ''}`,
      versao: { increment: 1 },
    },
  });
  // Saída parcial de material: os paletes que continuam na praça reiniciam a contagem de 20 dias (os que saíram inteiros deixam de ter prazo).
  await registrarMovimentacaoRelevante(tx, escopo.id, [...enviadasPorPalete.keys()].filter((id) => !saem.has(id)), 'SAIDA_PARCIAL', agora);
  // Palete que saiu inteiro: sem posição e fluxo expedido (evento de localização próprio).
  for (const paleteId of saem) {
    const p = paletes.get(paleteId);
    if (!p) continue;
    // Sem posição registrada não há endereço a liberar; o fluxo expedido fica no palete.
    if (p.posicao_id !== null) await tx.eventoLocalizacao.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        paleteId,
        tipo: 'SAIDA_EXPEDICAO',
        posicaoOrigemId: p.posicao_id,
        posicaoOrigemCodigo: p.posicao_codigo,
        posicaoDestinoId: null,
        posicaoDestinoCodigo: null,
        motivo: `Saída na expedição ${codigo}`,
        autorId: autor.usuarioId,
        ocorridoEm: agora,
        versaoPaleteAnterior: p.versao,
        versaoPaletePosterior: p.versao + 1,
      },
    });
    await tx.palete.update({ where: { id: paleteId }, data: { posicaoId: null, estadoFluxo: 'EXPEDIDO', motivoPendencia: `Expedido em ${codigo}`, versao: { increment: 1 } } });
  }
  // O conteúdo dos paletes mudou: telas com a versão anterior recebem conflito.
  const restantes = [...enviadasPorPalete.keys()].filter((id) => !saem.has(id));
  if (restantes.length > 0) await tx.palete.updateMany({ where: { escopoId: escopo.id, id: { in: restantes } }, data: { versao: { increment: 1 } } });
  await recalcularResumoPaletes(tx, escopo.id, paleteIds);

  const totalEnviado = cargaEnviada.length;
  await registrarEventoJanela(tx, {
    escopoId: escopo.id,
    janelaId,
    reservaId,
    expedicaoId,
    tipo: 'EXPEDICAO_CONFIRMADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Expedição ${codigo} confirmada (responsável ${responsavel.nome}): ${String(totalEnviado)} linha(s) enviada(s) em ${String(enviadasPorPalete.size)} unidade(s) de carga${parcial ? '; conclusão parcial, restante liberado' : ''}. Baixa única do saldo.`,
    detalhes: { conversoes: conversoes.map((c) => ({ ...c })), paletesQueSairam: [...saem] },
  });
  await registrarEvento(tx, {
    acao: 'EXPEDICAO_CONFIRMADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'EXPEDICAO',
    alvoId: expedicaoId,
    detalhes: { codigo, reserva: reserva.codigo, janela: j.codigo, parcial, linhas: reserva.linhas.length, unidades: enviadasPorPalete.size },
    requestId: autor.requestId,
  });
  return detalheExpedicao(tx, escopo, expedicaoId);
}

/** Correção de informação (observações e documentos): nova versão com motivo, sem efeito físico. */
export async function corrigirExpedicao(tx: Transacao, escopo: Escopo, expedicaoId: string, dados: DadosCorrigir, autor: Autor, agora: Date): Promise<ExpedicaoDetalhe> {
  const [e] = await tx.$queryRaw<{ id: string; codigo: string; versao: number; janela_id: string; observacoes: string | null }[]>`
    SELECT id::text, codigo, versao, janela_id::text, observacoes FROM expedicao WHERE id = ${expedicaoId}::uuid AND escopo_id = ${escopo.id}::uuid FOR UPDATE`;
  if (!e) throw naoEncontrado('Expedição não encontrada neste escopo.');
  exigirVersao(e.versao, dados.expectedVersion, `A expedição ${e.codigo}`);
  const atuais = await tx.documentoExpedicao.findMany({ where: { expedicaoId, versao: e.versao }, orderBy: { ordem: 'asc' }, select: { nome: true, referencia: true, anexoId: true } });
  const novaVersao = e.versao + 1;
  const documentos = dados.documents ?? atuais.map((d) => ({ name: d.nome, reference: d.referencia, attachmentId: d.anexoId }));
  const janela = await lerJanela(tx, escopo.id, e.janela_id);
  await conferirDocumentos(tx, escopo.id, e.janela_id, janela.documentosExigidos, documentos);
  const observacoes = dados.notes === undefined ? e.observacoes : dados.notes;
  for (const [ordem, d] of documentos.entries()) {
    await tx.documentoExpedicao.create({ data: { id: randomUUID(), escopoId: escopo.id, expedicaoId, versao: novaVersao, ordem, nome: d.name, referencia: d.reference, anexoId: d.attachmentId } });
  }
  await tx.correcaoExpedicao.create({
    data: {
      id: randomUUID(),
      escopoId: escopo.id,
      expedicaoId,
      versao: novaVersao,
      motivo: dados.reason,
      antes: { notes: e.observacoes, documents: atuais.map((d) => ({ name: d.nome, reference: d.referencia, attachmentId: d.anexoId })) },
      depois: { notes: observacoes, documents: documentos.map((d) => ({ ...d })) },
      autorId: autor.usuarioId,
      criadoEm: agora,
    },
  });
  await tx.expedicao.update({ where: { id: expedicaoId }, data: { versao: novaVersao, observacoes } });
  await registrarEventoJanela(tx, {
    escopoId: escopo.id,
    janelaId: e.janela_id,
    expedicaoId,
    tipo: 'EXPEDICAO_CORRIGIDA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Informação da expedição ${e.codigo} corrigida (versão ${String(novaVersao)}): ${dados.reason}. Sem efeito físico no estoque.`,
  });
  await registrarEvento(tx, {
    acao: 'EXPEDICAO_CORRIGIDA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'EXPEDICAO',
    alvoId: expedicaoId,
    detalhes: { codigo: e.codigo, versao: novaVersao, motivo: dados.reason },
    requestId: autor.requestId,
  });
  return detalheExpedicao(tx, escopo, expedicaoId);
}

/**
 * Retorno ligado à expedição original. Aviso documental (recusa, aviso) não
 * repõe saldo. Recebimento físico comprovado (evidência anexada) limita-se ao
 * enviado − já retornado (bloqueio da expedição + CHECK) e gera declaração no
 * palete de destino — cadastrado, não conferido e sem saldo —, preservando
 * produto, lote e origem; a entrada no estoque acontece só pela conferência e
 * reconciliação. Vínculos de claim e a capacidade da janela não mudam.
 */
export async function registrarRetorno(tx: Transacao, escopo: Escopo, expedicaoId: string, dados: DadosRetorno, autor: Autor, agora: Date): Promise<ExpedicaoDetalhe> {
  const [e] = await tx.$queryRaw<{ id: string; codigo: string; versao: number; janela_id: string }[]>`
    SELECT id::text, codigo, versao, janela_id::text FROM expedicao WHERE id = ${expedicaoId}::uuid AND escopo_id = ${escopo.id}::uuid FOR UPDATE`;
  if (!e) throw naoEncontrado('Expedição não encontrada neste escopo.');
  exigirVersao(e.versao, dados.expectedVersion, `A expedição ${e.codigo}`);
  const recebidoEm = new Date(dados.receivedAt);
  if (recebidoEm.getTime() > agora.getTime() + TOLERANCIA_FUTURO_MS) throw requisicaoInvalida('A data do retorno não pode estar no futuro.');
  await exigirAnexosDaJanela(tx, escopo.id, e.janela_id, dados.attachmentIds);
  const linhasExp = await tx.linhaExpedicao.findMany({ where: { expedicaoId } });
  const porId = new Map(linhasExp.map((l) => [l.id, l]));
  if (new Set(dados.lines.map((l) => l.expeditionLineId)).size !== dados.lines.length) throw requisicaoInvalida('Linha repetida no retorno.');
  const fisico = dados.type === 'RECEBIMENTO_FISICO';
  for (const l of dados.lines) {
    const linha = porId.get(l.expeditionLineId);
    if (!linha) throw requisicaoInvalida('Linha informada não pertence a esta expedição.');
    const limite = subtrairQuantidades(linha.quantidadeEnviada.toFixed(), linha.quantidadeRetornada.toFixed());
    if (compararQuantidades(l.quantity, linha.quantidadeEnviada.toFixed()) > 0 || (fisico && compararQuantidades(l.quantity, limite) > 0)) {
      throw new ErroHttp(
        409,
        'QUANTIDADE_INDISPONIVEL',
        `${linha.paleteCodigo} · ${linha.sku}: retorno de ${normalizarQuantidade(l.quantity)} acima do enviado ainda não retornado (${normalizarQuantidade(limite)} ${linha.unidade}).`,
      );
    }
  }
  let destino: { id: string; codigo: string } | null = null;
  if (fisico) {
    const destinoId = dados.destinationPalletId ?? '';
    const p = (await lerPaletes(tx, escopo.id, [destinoId], true)).get(destinoId);
    if (!p) throw requisicaoInvalida('Palete de destino não encontrado neste escopo.');
    const saldo = await tx.saldoEstoque.count({ where: { paleteId: p.id } });
    if (p.arquivado || p.estado_fluxo === 'EXPEDIDO' || p.estado_conferencia !== 'NAO_CONFERIDO' || saldo > 0 || p.conferencia_ativa) {
      throw new ErroHttp(
        409,
        'CONFLITO',
        `O palete ${p.codigo} não recebe o retorno: use um palete cadastrado para o recebimento, não conferido e sem saldo (um ID nunca é reutilizado para outra unidade física).`,
      );
    }
    destino = { id: p.id, codigo: p.codigo };
  }
  const numero = await proximoNumero(tx, escopo.id, 'retorno_expedicao');
  const retornoId = randomUUID();
  const codigo = codigoNumerado('RET', numero);
  await tx.retornoExpedicao.create({
    data: {
      id: retornoId,
      escopoId: escopo.id,
      expedicaoId,
      numero,
      codigo,
      tipo: dados.type,
      recebidoEm,
      motivo: dados.reason,
      condicao: dados.condition,
      paleteDestinoId: destino?.id ?? null,
      anexoIds: [...new Set(dados.attachmentIds)],
      observacoes: dados.notes ?? null,
      registradoPorId: autor.usuarioId,
      criadoEm: agora,
    },
  });
  let ordem = destino === null ? 0 : (((await tx.itemDeclarado.aggregate({ where: { paleteId: destino.id }, _max: { ordem: true } }))._max.ordem ?? -1) + 1);
  for (const l of dados.lines) {
    const linha = porId.get(l.expeditionLineId);
    if (!linha) continue;
    const linhaRetornoId = randomUUID();
    const quantidade = normalizarQuantidade(l.quantity);
    await tx.linhaRetorno.create({ data: { id: linhaRetornoId, escopoId: escopo.id, retornoId, linhaExpedicaoId: linha.id, quantidade } });
    if (destino === null) continue;
    await tx.linhaExpedicao.update({ where: { id: linha.id }, data: { quantidadeRetornada: { increment: quantidade } } });
    const segmento = await tx.segmentoEstoque.findUniqueOrThrow({ where: { id: linha.segmentoId }, select: { produtoId: true } });
    await tx.itemDeclarado.create({
      data: {
        escopoId: escopo.id,
        paleteId: destino.id,
        ordem: ordem++,
        produtoId: segmento.produtoId,
        sku: linha.sku,
        descricao: `${linha.descricao} — retorno ${codigo} da expedição ${e.codigo}`.slice(0, 200),
        lote: linha.lote,
        origemTipo: linha.origemTipo,
        origemReferencia: linha.origemReferencia,
        quantidade,
        unidadeMedida: linha.unidade,
        condicao: dados.condition,
        registradoPorId: autor.usuarioId,
        registradoEm: agora,
        linhaRetornoId,
      },
    });
  }
  // Material que voltou fisicamente para um palete: entrada de material (reinicia a contagem de 20 dias).
  if (destino !== null) await registrarMovimentacaoRelevante(tx, escopo.id, [destino.id], 'RETORNO_FISICO', agora);
  if (destino !== null) await tx.palete.update({ where: { id: destino.id }, data: { versao: { increment: 1 } } });
  await registrarEventoJanela(tx, {
    escopoId: escopo.id,
    janelaId: e.janela_id,
    expedicaoId,
    retornoId,
    tipo: 'RETORNO_REGISTRADO',
    autorId: autor.usuarioId,
    agora,
    resumo: fisico
      ? `Retorno físico ${codigo} da expedição ${e.codigo} recebido no palete ${destino?.codigo ?? ''}: entrada no estoque só após conferência e reconciliação. Capacidade da janela não volta.`
      : `Aviso documental ${codigo} da expedição ${e.codigo}: não repõe saldo.`,
    detalhes: { linhas: dados.lines.map((l) => ({ ...l })), tipo: dados.type },
  });
  await registrarEvento(tx, {
    acao: 'RETORNO_REGISTRADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'EXPEDICAO',
    alvoId: expedicaoId,
    detalhes: { codigo, expedicao: e.codigo, tipo: dados.type, linhas: dados.lines.length, destino: destino?.codigo ?? null },
    requestId: autor.requestId,
  });
  return detalheExpedicao(tx, escopo, expedicaoId);
}
