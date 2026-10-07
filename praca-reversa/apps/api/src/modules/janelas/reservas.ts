/**
 * Reserva de estoque e capacidade (etapa 08; R11, R22, R23, R25).
 *
 * Fluxo: escolher janela → selecionar material/quantidades → revisar medidas
 * e critérios (prévia) → confirmar reserva → lista de preparação.
 *
 * A confirmação é uma transação: bloqueia a janela (capacidade agregada),
 * depois os paletes e as linhas de saldo (material), revalida tudo no
 * servidor (situação/versão da janela, critérios, liberação, disponível,
 * medidas, capacidade de todas as restrições) e grava linhas, unidades de
 * carga, métricas, histórico, auditoria e idempotência — ou nada. Reserva não
 * baixa estoque: saldo_estoque.quantidade_reservada (o controle de reservas
 * já existente) sobe, e o banco confere reservado ≤ liberado ≤ saldo,
 * reservado + vinculado ≤ saldo, reservado + expedido ≤ limite e a soma das
 * reservas ativas (gatilhos adiados).
 */
import {
  UNIDADE_PECA,
  compararQuantidades,
  ehQuantidadeInteira,
  normalizarQuantidade,
  subtrairQuantidades,
  type CancelarReservaSchema,
  type CriarReservaSchema,
  type Escopo,
  type PreviaReserva,
  type RegistrarPreparacaoSchema,
  type ReservaDetalhe,
  type UnidadeCargaEntradaSchema,
  type VerificacaoMetrica,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { bloquearSaldos, recalcularResumoPaletes } from '../estoque/saldo.js';
import { calcularConsumo, verificar, verificarTodas, type Consumo, type LinhaCarga, type MedidaCarga } from './capacidade.js';
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
import { criteriosDe, criteriosRegra, detalheReserva, lerJanela, lerMaterial, lerReserva, materialRegra, restricaoRegra, type JanelaLida } from './leitura.js';
import { janelaOperavel, problemasParaReservar } from './regras.js';

type DadosReserva = z.output<typeof CriarReservaSchema>;
type DadosUnidade = z.output<typeof UnidadeCargaEntradaSchema>;
type DadosCancelar = z.output<typeof CancelarReservaSchema>;
type DadosPreparacao = z.output<typeof RegistrarPreparacaoSchema>;

/** Tolerância para data/hora informada "agora" (relógios de dispositivos). */
const TOLERANCIA_FUTURO_MS = 5 * 60_000;

export function medidaDe(u: Pick<DadosUnidade, 'palletId' | 'boxes' | 'weightKg' | 'weightBase' | 'volumeM3' | 'measurementSource'>): MedidaCarga {
  return {
    paleteId: u.palletId,
    caixas: u.boxes,
    pesoKg: u.weightKg === null ? null : normalizarQuantidade(u.weightKg),
    basePeso: u.weightBase,
    volumeM3: u.volumeM3 === null ? null : normalizarQuantidade(u.volumeM3),
    fonte: u.measurementSource,
  };
}

interface Analise {
  janela: string[];
  versoes: string[];
  material: string[];
  capacidade: string[];
  metricas: VerificacaoMetrica[];
  consumos: Consumo[];
  linhas: PreviaReserva['lines'];
  material_: Awaited<ReturnType<typeof lerMaterial>>;
  paletes: Awaited<ReturnType<typeof lerPaletes>>;
}

/** Revalida a seleção contra o estado atual (na confirmação, depois dos bloqueios). */
async function analisar(db: Banco | Transacao, escopo: Escopo, j: JanelaLida, dados: DadosReserva, travar: boolean): Promise<Analise> {
  const paleteIds = [...new Set(dados.lines.map((l) => l.palletId))];
  for (const u of dados.loadUnits) {
    if (!paleteIds.includes(u.palletId)) throw requisicaoInvalida('Medida informada para palete fora da seleção.');
  }
  const paletes = await lerPaletes(db, escopo.id, paleteIds, travar);
  if (travar) await bloquearSaldos(db, escopo.id, paleteIds);
  const material = await lerMaterial(db, escopo.id, { paleteIds });
  const porChave = new Map(material.map((m) => [`${m.palete_id}:${m.segmento_id}`, m]));
  const criterios = criteriosRegra(criteriosDe(j));

  const janela: string[] = [];
  const situacao = janelaOperavel(j.situacao);
  if (situacao) janela.push(situacao);
  if (!j.criteriosDefinidos) janela.push('Critérios de material aceito pela janela ainda pendentes.');

  const versoes: string[] = [];
  const problemasMaterial: string[] = [];
  const linhas: PreviaReserva['lines'] = [];
  const carga: LinhaCarga[] = [];
  for (const l of dados.lines) {
    const palete = paletes.get(l.palletId);
    const m = porChave.get(`${l.palletId}:${l.segmentId}`);
    const problemas: string[] = [];
    if (!palete) problemas.push('Palete não encontrado neste escopo.');
    else if (palete.versao !== l.expectedPalletVersion) {
      versoes.push(`O palete ${palete.codigo} mudou desde a revisão (movimento, saldo ou liberação): revise os dados atuais.`);
      problemas.push('Palete alterado desde a revisão.');
    }
    if (!m) {
      problemas.push('Sem saldo validado deste material no palete (produto documental, conteúdo desconhecido ou observação não reconciliada não fornecem saldo).');
    } else {
      problemas.push(...problemasParaReservar(materialRegra(m), criterios, l.quantity).filter((p) => !p.startsWith('Critérios de material da janela')));
      if (m.unidade === UNIDADE_PECA && !ehQuantidadeInteira(l.quantity)) problemas.push('Quantidade em peças (UN) precisa ser inteira: nada é fracionado por suposição.');
    }
    const codigo = palete?.codigo ?? m?.palete_codigo ?? l.palletId;
    linhas.push({
      palletId: l.palletId,
      palletCode: codigo,
      segmentId: l.segmentId,
      sku: m?.sku ?? '?',
      quantity: normalizarQuantidade(l.quantity),
      available: m ? normalizarQuantidade(subtrairQuantidades(m.liberada, m.reservada)) : '0',
      unit: m?.unidade ?? '?',
      problems: problemas,
    });
    for (const p of problemas) problemasMaterial.push(`${codigo} · ${m?.sku ?? 'material'}${m?.lote ? ` lote ${m.lote}` : ''}: ${p}`);
    if (m) carga.push({ paleteId: l.palletId, paleteCodigo: codigo, sku: m.sku, unidade: m.unidade, quantidade: normalizarQuantidade(l.quantity) });
  }
  // Disponível real por linha (para a revisão), já descontado o reservado e o vinculado.
  for (const linha of linhas) {
    const m = porChave.get(`${linha.palletId}:${linha.segmentId}`);
    if (m) {
      const regra = materialRegra(m);
      const livre = subtrairQuantidades(subtrairQuantidades(regra.quantidade, regra.vinculada), regra.reservada);
      const liberadoLivre = subtrairQuantidades(regra.liberada, regra.reservada);
      const disp = compararQuantidades(livre, liberadoLivre) < 0 ? livre : liberadoLivre;
      linha.available = compararQuantidades(disp, '0') > 0 ? normalizarQuantidade(disp) : '0';
    }
  }
  const medidas = new Map(dados.loadUnits.map((u) => [u.palletId, medidaDe(u)]));
  const restricoes = j.restricoes.map(restricaoRegra);
  const { metricas, consumos, bloqueios } = verificarTodas(restricoes, carga, medidas);
  return {
    janela,
    versoes,
    material: problemasMaterial.filter((p) => !p.endsWith('Palete alterado desde a revisão.')),
    capacidade: bloqueios,
    metricas,
    consumos,
    linhas,
    material_: material,
    paletes,
  };
}

export async function previaReserva(db: Banco, escopo: Escopo, janelaId: string, dados: DadosReserva): Promise<PreviaReserva> {
  const j = await lerJanela(db, escopo.id, janelaId);
  const a = await analisar(db, escopo, j, dados, false);
  const bloqueios = [...a.janela, ...(j.versao !== dados.expectedWindowVersion ? ['A janela mudou desde a revisão.'] : []), ...a.versoes, ...a.material, ...a.capacidade];
  return { allowed: bloqueios.length === 0, blockers: [...new Set(bloqueios)], metrics: a.metricas, windowVersion: j.versao, lines: a.linhas };
}

export async function criarReserva(tx: Transacao, escopo: Escopo, janelaId: string, dados: DadosReserva, autor: Autor, agora: Date): Promise<ReservaDetalhe> {
  const travada = await bloquearJanela(tx, escopo.id, janelaId);
  exigirVersao(travada.versao, dados.expectedWindowVersion, `A janela ${travada.codigo}`);
  const j = await lerJanela(tx, escopo.id, janelaId);
  const a = await analisar(tx, escopo, j, dados, true);
  if (a.janela.length > 0) throw new ErroHttp(409, 'SITUACAO_INVALIDA', `Nada foi reservado. ${a.janela.join(' ')}`);
  if (a.versoes.length > 0) throw new ErroHttp(409, 'CONFLITO_VERSAO', `Nada foi reservado. ${a.versoes.join(' ')}`);
  if (a.material.length > 0) {
    const codigo = a.material.every((p) => p.includes('Disponível ')) ? 'SALDO_INSUFICIENTE' : 'MATERIAL_INELEGIVEL';
    throw new ErroHttp(409, codigo, `Nada foi reservado (a reserva é integral). ${a.material.join(' ')}`);
  }
  if (a.capacidade.length > 0) throw new ErroHttp(409, 'CAPACIDADE_INSUFICIENTE', `Nada foi reservado: todas as restrições precisam caber juntas. ${a.capacidade.join(' ')}`);

  const numero = await proximoNumero(tx, escopo.id, 'reserva_janela');
  const id = randomUUID();
  const codigo = codigoNumerado('RES', numero);
  const criterios = criteriosDe(j);
  await tx.reservaJanela.create({
    data: {
      id,
      escopoId: escopo.id,
      janelaId,
      numero,
      codigo,
      situacao: 'ATIVA',
      versaoRegras: j.versaoRegras,
      fotografiaCriterios: {
        criteria: { ...criterios },
        restrictions: a.metricas.map((m) => ({ metric: m.metric, unit: m.unit, weightBase: m.weightBase, limit: m.limit, reservedBefore: m.reserved, shippedBefore: m.shipped, requested: m.requested, basis: m.basis })),
        windowVersion: j.versao,
        rulesVersion: j.versaoRegras,
      },
      observacoes: dados.notes ?? null,
      criadoPorId: autor.usuarioId,
      criadoEm: agora,
    },
  });
  const porChave = new Map(a.material_.map((m) => [`${m.palete_id}:${m.segmento_id}`, m]));
  for (const l of dados.lines) {
    const m = porChave.get(`${l.palletId}:${l.segmentId}`);
    if (!m) throw new Error('Material analisado não encontrado.');
    const quantidade = normalizarQuantidade(l.quantity);
    await tx.linhaReserva.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        reservaId: id,
        paleteId: l.palletId,
        segmentoId: l.segmentId,
        quantidade,
        unidade: m.unidade,
        sku: m.sku,
        descricao: m.descricao,
        lote: m.lote,
        origemTipo: m.origem_tipo,
        origemReferencia: m.origem_referencia,
        condicao: m.condicao,
        paleteCodigo: m.palete_codigo,
        posicaoCodigo: m.posicao_codigo,
      },
    });
    await tx.$executeRaw`
      UPDATE saldo_estoque SET quantidade_reservada = quantidade_reservada + ${quantidade}::numeric
       WHERE escopo_id = ${escopo.id}::uuid AND palete_id = ${l.palletId}::uuid AND segmento_id = ${l.segmentId}::uuid`;
  }
  const medidas = new Map(dados.loadUnits.map((u) => [u.palletId, u]));
  for (const paleteId of [...new Set(dados.lines.map((l) => l.palletId))]) {
    const u = medidas.get(paleteId);
    await tx.unidadeCargaReserva.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        reservaId: id,
        paleteId,
        caixas: u?.boxes === null || u?.boxes === undefined ? null : Number(u.boxes),
        pesoKg: u?.weightKg ?? null,
        basePeso: u?.weightBase ?? null,
        volumeM3: u?.volumeM3 ?? null,
        fonteMedida: u?.measurementSource ?? null,
        informadoPorId: autor.usuarioId,
        informadoEm: agora,
      },
    });
  }
  for (const c of a.consumos) {
    const valor = c.valor ?? '0';
    await tx.metricaReserva.create({
      data: { id: randomUUID(), escopoId: escopo.id, reservaId: id, restricaoId: c.restricaoId, metrica: c.metrica, unidade: c.unidade, valor, valorInicial: valor, base: c.base },
    });
    await tx.$executeRaw`UPDATE restricao_janela SET reservado = reservado + ${valor}::numeric, atualizado_em = ${agora} WHERE id = ${c.restricaoId}::uuid`;
  }
  await recalcularResumoPaletes(tx, escopo.id, [...a.paletes.keys()]);
  const resumoMetricas = a.metricas.map((m) => `${m.requested ?? '?'} ${m.unit}`).join(', ');
  await registrarEventoJanela(tx, {
    escopoId: escopo.id,
    janelaId,
    reservaId: id,
    tipo: 'RESERVA_CRIADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Reserva ${codigo}: ${String(dados.lines.length)} linha(s) em ${String(a.paletes.size)} palete(s); capacidade ${resumoMetricas}.`,
    detalhes: { linhas: dados.lines.map((l) => ({ palete: l.palletId, segmento: l.segmentId, quantidade: normalizarQuantidade(l.quantity) })) },
  });
  await registrarEvento(tx, {
    acao: 'RESERVA_CRIADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'RESERVA',
    alvoId: id,
    detalhes: { codigo, janela: travada.codigo, linhas: dados.lines.length, paletes: a.paletes.size },
    requestId: autor.requestId,
  });
  return detalheReserva(tx, escopo, id, agora);
}

/**
 * Cancela (ação própria) ou libera (encerramento/cancelamento da janela) uma
 * reserva ativa antes da saída: estoque disponível e capacidade voltam na
 * mesma transação; a reserva fica no histórico. Reserva já encerrada não
 * libera de novo. A janela já está bloqueada por quem chama.
 */
export async function encerrarReservaSemSaida(
  tx: Transacao,
  escopo: Escopo,
  janelaId: string,
  reservaId: string,
  situacao: 'CANCELADA' | 'LIBERADA',
  motivo: string,
  autor: Autor,
  agora: Date,
  versaoEsperada?: number,
): Promise<void> {
  const r = await bloquearReserva(tx, escopo.id, reservaId);
  if (r.janela_id !== janelaId) throw new Error('Reserva de outra janela.');
  if (r.situacao !== 'ATIVA') {
    throw new ErroHttp(
      409,
      'SITUACAO_INVALIDA',
      r.situacao === 'CONSUMIDA'
        ? `A reserva ${r.codigo} já foi expedida: cancelar não repõe o material enviado (retorno físico tem fluxo próprio).`
        : `A reserva ${r.codigo} já está ${r.situacao === 'CANCELADA' ? 'cancelada' : 'liberada'}: nada é liberado de novo.`,
    );
  }
  if (versaoEsperada !== undefined) exigirVersao(r.versao, versaoEsperada, `A reserva ${r.codigo}`);
  const linhas = await tx.linhaReserva.findMany({ where: { reservaId }, select: { id: true, paleteId: true, segmentoId: true, quantidade: true } });
  const paleteIds = [...new Set(linhas.map((l) => l.paleteId))];
  await lerPaletes(tx, escopo.id, paleteIds, true);
  await bloquearSaldos(tx, escopo.id, paleteIds);
  for (const l of linhas) {
    await tx.$executeRaw`
      UPDATE saldo_estoque SET quantidade_reservada = quantidade_reservada - ${l.quantidade.toFixed()}::numeric
       WHERE escopo_id = ${escopo.id}::uuid AND palete_id = ${l.paleteId}::uuid AND segmento_id = ${l.segmentoId}::uuid`;
    await tx.linhaReserva.update({ where: { id: l.id }, data: { quantidadeEnviada: '0', quantidadeLiberada: l.quantidade } });
  }
  const metricas = await tx.metricaReserva.findMany({ where: { reservaId }, select: { restricaoId: true, valor: true } });
  for (const m of metricas) {
    await tx.$executeRaw`UPDATE restricao_janela SET reservado = reservado - ${m.valor.toFixed()}::numeric, atualizado_em = ${agora} WHERE id = ${m.restricaoId}::uuid`;
  }
  await tx.reservaJanela.update({
    where: { id: reservaId },
    data: { situacao, encerradaEm: agora, encerradaPorId: autor.usuarioId, motivoEncerramento: motivo.slice(0, 500), versao: { increment: 1 } },
  });
  await recalcularResumoPaletes(tx, escopo.id, paleteIds);
  await registrarEventoJanela(tx, {
    escopoId: escopo.id,
    janelaId,
    reservaId,
    tipo: situacao === 'CANCELADA' ? 'RESERVA_CANCELADA' : 'RESERVA_LIBERADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Reserva ${r.codigo} ${situacao === 'CANCELADA' ? 'cancelada' : 'liberada'} antes da saída: ${motivo}. Estoque disponível e capacidade liberados; saldo físico inalterado.`,
  });
  await registrarEvento(tx, {
    acao: situacao === 'CANCELADA' ? 'RESERVA_CANCELADA' : 'RESERVA_LIBERADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'RESERVA',
    alvoId: reservaId,
    detalhes: { codigo: r.codigo, motivo, linhas: linhas.length },
    requestId: autor.requestId,
  });
}

export async function cancelarReserva(tx: Transacao, escopo: Escopo, reservaId: string, dados: DadosCancelar, autor: Autor, agora: Date): Promise<ReservaDetalhe> {
  const janelaId = await janelaDaReserva(tx, escopo.id, reservaId);
  await bloquearJanela(tx, escopo.id, janelaId);
  await encerrarReservaSemSaida(tx, escopo, janelaId, reservaId, 'CANCELADA', dados.reason, autor, agora, dados.expectedVersion);
  return detalheReserva(tx, escopo, reservaId, agora);
}

// ---------- Preparação ----------

/**
 * Registro de separação/preparação: responsável, data e quantidades
 * conferidas. Não baixa estoque nem confirma saída. Diferença fica registrada
 * (DIVERGENTE) para recontagem ou correção da reserva; o saldo não é ajustado
 * para bater com o planejado. Medidas novas revalidam todas as capacidades
 * (a fotografia anterior fica no histórico).
 */
export async function registrarPreparacao(tx: Transacao, escopo: Escopo, reservaId: string, dados: DadosPreparacao, autor: Autor, agora: Date): Promise<ReservaDetalhe> {
  const janelaId = await janelaDaReserva(tx, escopo.id, reservaId);
  const janela = await bloquearJanela(tx, escopo.id, janelaId);
  const r = await bloquearReserva(tx, escopo.id, reservaId);
  if (r.situacao !== 'ATIVA') throw new ErroHttp(409, 'SITUACAO_INVALIDA', `A reserva ${r.codigo} não está ativa: a preparação não é registrada.`);
  exigirVersao(r.versao, dados.expectedVersion, `A reserva ${r.codigo}`);
  const situacao = janelaOperavel(janela.situacao);
  if (situacao) throw new ErroHttp(409, 'SITUACAO_INVALIDA', situacao);
  await exigirResponsavel(tx, escopo.id, dados.responsibleId);
  const preparadaEm = new Date(dados.preparedAt);
  if (preparadaEm.getTime() > agora.getTime() + TOLERANCIA_FUTURO_MS) throw requisicaoInvalida('A data da preparação não pode estar no futuro.');

  const reserva = await lerReserva(tx, escopo.id, reservaId);
  const porLinha = new Map(dados.lines.map((l) => [l.lineId, normalizarQuantidade(l.quantity)]));
  if (porLinha.size !== dados.lines.length || reserva.linhas.some((l) => !porLinha.has(l.id)) || dados.lines.length !== reserva.linhas.length) {
    throw requisicaoInvalida('Informe a quantidade separada de cada linha da reserva, uma vez.');
  }
  const diferencas: string[] = [];
  for (const l of reserva.linhas) {
    const separada = porLinha.get(l.id) ?? '0';
    const reservada = normalizarQuantidade(l.quantidade.toFixed());
    if (compararQuantidades(separada, reservada) !== 0) {
      diferencas.push(`${l.paleteCodigo} · ${l.sku}${l.lote ? ` lote ${l.lote}` : ''}: separado ${separada} de ${reservada} ${l.unidade} reservados.`);
    }
  }

  // Medidas atualizadas: revalidam todas as restrições antes de gravar.
  if (dados.loadUnits.length > 0) {
    const atuais = new Map(reserva.unidadesCarga.map((u) => [u.paleteId, u]));
    for (const u of dados.loadUnits) if (!atuais.has(u.palletId)) throw requisicaoInvalida('Medida informada para palete fora da reserva.');
    const medidas = new Map<string, MedidaCarga>(
      reserva.unidadesCarga.map((u) => [
        u.paleteId,
        { paleteId: u.paleteId, caixas: u.caixas === null ? null : String(u.caixas), pesoKg: u.pesoKg?.toFixed() ?? null, basePeso: u.basePeso, volumeM3: u.volumeM3?.toFixed() ?? null, fonte: u.fonteMedida },
      ]),
    );
    for (const u of dados.loadUnits) medidas.set(u.palletId, medidaDe(u));
    const carga: LinhaCarga[] = reserva.linhas.map((l) => ({ paleteId: l.paleteId, paleteCodigo: l.paleteCodigo, sku: l.sku, unidade: l.unidade, quantidade: l.quantidade.toFixed() }));
    const restricoes = (await lerJanela(tx, escopo.id, janelaId)).restricoes.map(restricaoRegra);
    const atualPorRestricao = new Map(reserva.metricas.map((m) => [m.restricaoId, m.valor.toFixed()]));
    const falhas: string[] = [];
    const novos: { restricaoId: string; antes: string; depois: string }[] = [];
    for (const res of restricoes) {
      const consumo = calcularConsumo(res, carga, medidas);
      const antes = atualPorRestricao.get(res.id) ?? '0';
      const v = verificar(res, consumo, antes);
      if (v.state !== 'OK' || consumo.valor === null) falhas.push(v.message);
      else novos.push({ restricaoId: res.id, antes, depois: consumo.valor });
    }
    if (falhas.length > 0) throw new ErroHttp(409, 'CAPACIDADE_INSUFICIENTE', `Medidas não registradas: a capacidade precisa ser revalidada. ${falhas.join(' ')}`);
    const fotografiaAnterior = reserva.unidadesCarga.map((u) => ({ palete: u.palete.codigo, caixas: u.caixas, pesoKg: u.pesoKg?.toFixed() ?? null, base: u.basePeso, volumeM3: u.volumeM3?.toFixed() ?? null, fonte: u.fonteMedida, versao: u.versao }));
    for (const u of dados.loadUnits) {
      await tx.unidadeCargaReserva.update({
        where: { reservaId_paleteId: { reservaId, paleteId: u.palletId } },
        data: {
          caixas: u.boxes === null ? null : Number(u.boxes),
          pesoKg: u.weightKg,
          basePeso: u.weightBase,
          volumeM3: u.volumeM3,
          fonteMedida: u.measurementSource,
          informadoPorId: autor.usuarioId,
          informadoEm: agora,
          versao: { increment: 1 },
        },
      });
    }
    for (const n of novos) {
      const delta = subtrairQuantidades(n.depois, n.antes);
      if (compararQuantidades(delta, '0') === 0) continue;
      await tx.metricaReserva.update({ where: { reservaId_restricaoId: { reservaId, restricaoId: n.restricaoId } }, data: { valor: n.depois } });
      await tx.$executeRaw`UPDATE restricao_janela SET reservado = reservado + ${delta}::numeric, atualizado_em = ${agora} WHERE id = ${n.restricaoId}::uuid`;
    }
    await registrarEventoJanela(tx, {
      escopoId: escopo.id,
      janelaId,
      reservaId,
      tipo: 'MEDIDAS_ALTERADAS',
      autorId: autor.usuarioId,
      agora,
      resumo: `Medidas da carga atualizadas na preparação da reserva ${r.codigo}; capacidade revalidada.`,
      detalhes: { antes: fotografiaAnterior, depois: dados.loadUnits.map((u) => ({ ...u })) as unknown as Prisma.InputJsonValue },
    });
  }

  for (const l of reserva.linhas) await tx.linhaReserva.update({ where: { id: l.id }, data: { quantidadePreparada: porLinha.get(l.id) ?? '0' } });
  const estado = diferencas.length === 0 ? 'PREPARADA' : 'DIVERGENTE';
  await tx.reservaJanela.update({
    where: { id: reservaId },
    data: {
      preparacao: estado,
      preparadaEm,
      preparacaoResponsavelId: dados.responsibleId,
      preparacaoRegistradaPorId: autor.usuarioId,
      preparacaoRegistradaEm: agora,
      preparacaoObservacoes: dados.notes ?? null,
      preparacaoDiferencas: diferencas,
      versao: { increment: 1 },
    },
  });
  if (janela.situacao === 'CONFIRMADA') {
    await tx.janelaDevolucao.update({ where: { id: janelaId }, data: { situacao: 'PREPARACAO', versao: { increment: 1 }, atualizadoEm: agora } });
    await registrarEventoJanela(tx, { escopoId: escopo.id, janelaId, tipo: 'PREPARACAO_INICIADA', autorId: autor.usuarioId, agora, resumo: 'Janela em preparação (primeira separação registrada).' });
  }
  await registrarEventoJanela(tx, {
    escopoId: escopo.id,
    janelaId,
    reservaId,
    tipo: 'PREPARACAO_REGISTRADA',
    autorId: autor.usuarioId,
    agora,
    resumo:
      estado === 'PREPARADA'
        ? `Reserva ${r.codigo} separada/preparada conforme o reservado (não baixa estoque nem confirma saída).`
        : `Reserva ${r.codigo} com diferença na separação: ${diferencas.join(' ')} Recontagem ou correção da reserva necessária; o saldo não foi ajustado.`,
    detalhes: { diferencas },
  });
  await registrarEvento(tx, {
    acao: 'PREPARACAO_REGISTRADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'RESERVA',
    alvoId: reservaId,
    detalhes: { codigo: r.codigo, estado, diferencas: diferencas.length, medidas: dados.loadUnits.length },
    requestId: autor.requestId,
  });
  return detalheReserva(tx, escopo, reservaId, agora);
}
