/**
 * Cadastro e ciclo de vida das janelas de devolução (etapa 08; R21).
 *
 * Rascunho guarda informações pendentes (nada é inventado: sem data, limite
 * ou critério presumidos). Confirmar exige o registro da autorização (fonte,
 * referência, data, responsável) e o intervalo de saída. Depois de
 * confirmada, mudar limite, período ou critérios exige justificativa e fonte
 * e gera nova versão das regras; reduzir abaixo de reservado + expedido é
 * bloqueado. Encerrar/cancelar com reservas ativas exige liberá-las
 * explicitamente na mesma operação; expedições permanecem no histórico.
 */
import {
  METRICAS_INTEIRAS,
  ROTULOS_METRICA,
  ROTULOS_SITUACAO_JANELA,
  compararQuantidades,
  ehQuantidadeInteira,
  nomeArquivoSeguro,
  normalizarQuantidade,
  somarQuantidades,
  type AlterarJanelaSchema,
  type AnexoJanela,
  type CriarJanelaSchema,
  type CriteriosJanela,
  type EncerrarJanelaSchema,
  type Escopo,
  type JanelaDetalhe,
  type MetricaCapacidade,
  type RestricaoEntrada,
} from '@praca-reversa/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { tipoDoConteudo } from '../claims/evidencias.js';
import { bloquearJanela, codigoNumerado, exigirVersao, proximoNumero, registrarEventoJanela, type Autor } from './comum.js';
import { criteriosDe, detalheJanela, fusoDoEscopo, lerJanela, unidadeDaMetrica, type JanelaLida } from './leitura.js';
import { encerrarReservaSemSaida } from './reservas.js';

type DadosCriar = z.output<typeof CriarJanelaSchema>;
type DadosAlterar = z.output<typeof AlterarJanelaSchema>;
type DadosEncerrar = z.output<typeof EncerrarJanelaSchema>;

const dataOuNulo = (texto: string | null | undefined) => (texto === null || texto === undefined ? null : new Date(texto));

interface RestricaoNormalizada {
  metrica: MetricaCapacidade;
  unidade: string;
  basePeso: 'BRUTO' | 'LIQUIDO' | null;
  limite: string | null;
}

function normalizarRestricoes(lista: readonly z.output<typeof CriarJanelaSchema>['restrictions'][number][]): RestricaoNormalizada[] {
  return lista.map((r: RestricaoEntrada) => ({
    metrica: r.metric,
    unidade: unidadeDaMetrica(r.metric, r.unit),
    basePeso: r.metric === 'PESO_KG' ? (r.weightBase ?? null) : null,
    limite: r.limit === null ? null : normalizarQuantidade(r.limit),
  }));
}

function criteriosDosDados(d: DadosCriar['criteria']): CriteriosJanela {
  return {
    defined: d.defined,
    acceptedConditions: [...new Set(d.acceptedConditions)],
    acceptedOriginTypes: d.acceptedOriginTypes === null ? null : [...new Set(d.acceptedOriginTypes)],
    requireLot: d.requireLot,
    requireOrigin: d.requireOrigin,
    requiredDocuments: d.requiredDocuments,
    notes: d.notes ?? null,
  };
}

function camposCriterios(c: CriteriosJanela) {
  return {
    criteriosDefinidos: c.defined,
    condicoesAceitas: c.acceptedConditions,
    origemQualquer: c.acceptedOriginTypes === null,
    origensAceitas: c.acceptedOriginTypes ?? [],
    exigeLote: c.requireLot,
    exigeOrigem: c.requireOrigin,
    documentosExigidos: c.requiredDocuments,
    criteriosObservacao: c.notes,
  };
}

/** Fotografia das regras (período, critérios, limites) gravada em cada versão. */
function fotografia(exitStart: Date | null, exitEnd: Date | null, criterios: CriteriosJanela, restricoes: readonly RestricaoNormalizada[]): Prisma.InputJsonValue {
  return {
    exitStart: exitStart?.toISOString() ?? null,
    exitEnd: exitEnd?.toISOString() ?? null,
    criteria: { ...criterios },
    restrictions: restricoes.map((r) => ({ metric: r.metrica, unit: r.unidade, weightBase: r.basePeso, limit: r.limite })),
  };
}

function mesReferencia(texto: string): Date {
  return new Date(`${texto}-01T00:00:00Z`);
}

async function detalhe(tx: Transacao, escopo: Escopo, id: string, agora: Date): Promise<JanelaDetalhe> {
  return detalheJanela(tx, escopo, id, agora, await fusoDoEscopo(tx, escopo.id));
}

export async function criarJanela(tx: Transacao, escopo: Escopo, dados: DadosCriar, autor: Autor, agora: Date): Promise<JanelaDetalhe> {
  const numero = await proximoNumero(tx, escopo.id, 'janela_devolucao');
  const id = randomUUID();
  const criterios = criteriosDosDados(dados.criteria);
  const restricoes = normalizarRestricoes(dados.restrictions);
  const saidaInicio = dataOuNulo(dados.exitStart);
  const saidaFim = dataOuNulo(dados.exitEnd);
  await tx.janelaDevolucao.create({
    data: {
      id,
      escopoId: escopo.id,
      numero,
      codigo: codigoNumerado('JAN', numero),
      nome: dados.name,
      referenciaCliente: dados.clientReference ?? null,
      mesReferencia: mesReferencia(dados.referenceMonth),
      saidaInicio,
      saidaFim,
      prazoPreparacao: dataOuNulo(dados.preparationDeadline),
      ...camposCriterios(criterios),
      autorizacaoFonte: dados.authorization.source ?? null,
      autorizacaoReferencia: dados.authorization.reference ?? null,
      autorizacaoData: dados.authorization.date ? new Date(`${dados.authorization.date}T00:00:00Z`) : null,
      autorizacaoResponsavel: dados.authorization.responsible ?? null,
      observacoes: dados.notes ?? null,
      situacao: 'RASCUNHO',
      criadoPorId: autor.usuarioId,
      criadoEm: agora,
      atualizadoEm: agora,
    },
  });
  if (restricoes.length > 0) {
    await tx.restricaoJanela.createMany({
      data: restricoes.map((r) => ({ id: randomUUID(), escopoId: escopo.id, janelaId: id, ...r, atualizadoEm: agora })),
    });
  }
  await tx.versaoRegrasJanela.create({
    data: { id: randomUUID(), escopoId: escopo.id, janelaId: id, versao: 1, fotografia: fotografia(saidaInicio, saidaFim, criterios, restricoes), autorId: autor.usuarioId, criadoEm: agora },
  });
  await registrarEventoJanela(tx, { escopoId: escopo.id, janelaId: id, tipo: 'JANELA_CRIADA', autorId: autor.usuarioId, agora, resumo: `Janela ${codigoNumerado('JAN', numero)} cadastrada em rascunho.` });
  await registrarEvento(tx, {
    acao: 'JANELA_CRIADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'JANELA',
    alvoId: id,
    detalhes: { codigo: codigoNumerado('JAN', numero), restricoes: restricoes.length },
    requestId: autor.requestId,
  });
  return detalhe(tx, escopo, id, agora);
}

function chaveRestricao(r: RestricaoNormalizada) {
  return `${r.metrica}|${r.unidade}|${r.basePeso ?? ''}|${r.limite ?? 'pendente'}`;
}

function regrasMudaram(j: JanelaLida, saidaInicio: Date | null, saidaFim: Date | null, criterios: CriteriosJanela, restricoes: readonly RestricaoNormalizada[]): boolean {
  const atuais = j.restricoes.map((r) => chaveRestricao({ metrica: r.metrica, unidade: r.unidade, basePeso: r.basePeso, limite: r.limite === null ? null : normalizarQuantidade(r.limite.toFixed()) }));
  const novas = restricoes.map(chaveRestricao);
  return (
    (j.saidaInicio?.getTime() ?? null) !== (saidaInicio?.getTime() ?? null) ||
    (j.saidaFim?.getTime() ?? null) !== (saidaFim?.getTime() ?? null) ||
    JSON.stringify(criteriosDe(j)) !== JSON.stringify(criterios) ||
    JSON.stringify([...atuais].sort()) !== JSON.stringify([...novas].sort())
  );
}

export async function alterarJanela(tx: Transacao, escopo: Escopo, id: string, dados: DadosAlterar, autor: Autor, agora: Date): Promise<JanelaDetalhe> {
  const travada = await bloquearJanela(tx, escopo.id, id);
  if (travada.situacao === 'ENCERRADA' || travada.situacao === 'CANCELADA') {
    throw new ErroHttp(409, 'SITUACAO_INVALIDA', `A janela ${travada.codigo} está ${ROTULOS_SITUACAO_JANELA[travada.situacao].toLowerCase()}: não é alterada.`);
  }
  exigirVersao(travada.versao, dados.expectedVersion, `A janela ${travada.codigo}`);
  const j = await lerJanela(tx, escopo.id, id);
  const criterios = criteriosDosDados(dados.criteria);
  const restricoes = normalizarRestricoes(dados.restrictions);
  const saidaInicio = dataOuNulo(dados.exitStart);
  const saidaFim = dataOuNulo(dados.exitEnd);
  const mudouRegras = regrasMudaram(j, saidaInicio, saidaFim, criterios, restricoes);
  if (mudouRegras && j.situacao !== 'RASCUNHO' && dados.ruleChange === null) {
    throw requisicaoInvalida('Janela confirmada: alterar limite, período ou critérios exige justificativa e fonte da nova autorização.');
  }
  if (j.situacao !== 'RASCUNHO') {
    const faltam: string[] = [];
    if (saidaInicio === null) faltam.push('intervalo de saída');
    if (dados.authorization.source == null || dados.authorization.reference == null || dados.authorization.date == null || dados.authorization.responsible == null) {
      faltam.push('registro da autorização');
    }
    if (faltam.length > 0) throw requisicaoInvalida(`Janela confirmada não volta a ter ${faltam.join(' e ')} pendente.`);
  }
  const [ativas, expedicoes] = await Promise.all([
    tx.reservaJanela.count({ where: { janelaId: id, situacao: 'ATIVA' } }),
    tx.expedicao.count({ where: { janelaId: id } }),
  ]);
  // Restrições: removidas, novas e alteradas, contra o que já foi reservado/expedido.
  const porMetrica = new Map(j.restricoes.map((r) => [r.metrica, r]));
  const novasMetricas = new Set(restricoes.map((r) => r.metrica));
  for (const r of j.restricoes) {
    if (!novasMetricas.has(r.metrica)) {
      const usada = (await tx.metricaReserva.count({ where: { restricaoId: r.id } })) + (await tx.metricaExpedicao.count({ where: { restricaoId: r.id } }));
      if (usada > 0) {
        throw new ErroHttp(409, 'CONFLITO', `A restrição de ${ROTULOS_METRICA[r.metrica].toLowerCase()} já foi usada por reservas/expedições: ajuste o limite em vez de removê-la.`);
      }
    }
  }
  for (const nova of restricoes) {
    const atual = porMetrica.get(nova.metrica);
    if (!atual) {
      if (ativas > 0 || expedicoes > 0) {
        throw new ErroHttp(
          409,
          'CONFLITO',
          `Nova restrição de ${ROTULOS_METRICA[nova.metrica].toLowerCase()} com reservas ativas ou expedições: as reservas existentes não têm essa medida. Libere as reservas ativas antes de acrescentar a restrição.`,
        );
      }
      continue;
    }
    const ocupado = somarQuantidades([atual.reservado.toFixed(), atual.expedido.toFixed()]);
    const emUso = compararQuantidades(ocupado, '0') > 0;
    if (emUso && (atual.unidade !== nova.unidade || atual.basePeso !== nova.basePeso)) {
      throw new ErroHttp(409, 'CONFLITO', `A unidade/base da restrição de ${ROTULOS_METRICA[nova.metrica].toLowerCase()} não muda com reservas ou expedições registradas.`);
    }
    if (emUso && nova.limite === null) {
      throw new ErroHttp(409, 'CAPACIDADE_INSUFICIENTE', `O limite de ${ROTULOS_METRICA[nova.metrica].toLowerCase()} não volta a ser pendente com ${normalizarQuantidade(ocupado)} reservado/expedido.`);
    }
    if (nova.limite !== null && compararQuantidades(nova.limite, ocupado) < 0) {
      throw new ErroHttp(
        409,
        'CAPACIDADE_INSUFICIENTE',
        `Novo limite de ${ROTULOS_METRICA[nova.metrica].toLowerCase()} (${nova.limite}) abaixo do já ocupado: reservado ${normalizarQuantidade(atual.reservado.toFixed())} + expedido ${normalizarQuantidade(atual.expedido.toFixed())}. Trate (libere) as reservas ativas antes de reduzir; o expedido permanece.`,
      );
    }
    if (nova.limite !== null && METRICAS_INTEIRAS.includes(nova.metrica) && !ehQuantidadeInteira(nova.limite)) {
      throw requisicaoInvalida('Caixas e paletes são unidades físicas inteiras.');
    }
  }
  for (const r of j.restricoes) if (!novasMetricas.has(r.metrica)) await tx.restricaoJanela.delete({ where: { id: r.id } });
  for (const nova of restricoes) {
    const atual = porMetrica.get(nova.metrica);
    if (atual) {
      await tx.restricaoJanela.update({ where: { id: atual.id }, data: { unidade: nova.unidade, basePeso: nova.basePeso, limite: nova.limite, atualizadoEm: agora } });
    } else {
      await tx.restricaoJanela.create({ data: { id: randomUUID(), escopoId: escopo.id, janelaId: id, ...nova, atualizadoEm: agora } });
    }
  }
  const versaoRegras = mudouRegras ? j.versaoRegras + 1 : j.versaoRegras;
  await tx.janelaDevolucao.update({
    where: { id },
    data: {
      nome: dados.name,
      referenciaCliente: dados.clientReference ?? null,
      mesReferencia: mesReferencia(dados.referenceMonth),
      saidaInicio,
      saidaFim,
      prazoPreparacao: dataOuNulo(dados.preparationDeadline),
      ...camposCriterios(criterios),
      autorizacaoFonte: dados.authorization.source ?? null,
      autorizacaoReferencia: dados.authorization.reference ?? null,
      autorizacaoData: dados.authorization.date ? new Date(`${dados.authorization.date}T00:00:00Z`) : null,
      autorizacaoResponsavel: dados.authorization.responsible ?? null,
      observacoes: dados.notes ?? null,
      versao: { increment: 1 },
      versaoRegras,
      atualizadoEm: agora,
    },
  });
  if (mudouRegras) {
    await tx.versaoRegrasJanela.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        janelaId: id,
        versao: versaoRegras,
        fotografia: fotografia(saidaInicio, saidaFim, criterios, restricoes),
        justificativa: dados.ruleChange?.justification ?? null,
        fonte: dados.ruleChange?.source ?? null,
        autorId: autor.usuarioId,
        criadoEm: agora,
      },
    });
  }
  await registrarEventoJanela(tx, {
    escopoId: escopo.id,
    janelaId: id,
    tipo: mudouRegras ? 'REGRAS_ALTERADAS' : 'JANELA_ALTERADA',
    autorId: autor.usuarioId,
    agora,
    resumo: mudouRegras
      ? `Regras alteradas (versão ${String(versaoRegras)})${dados.ruleChange ? `: ${dados.ruleChange.justification} — fonte: ${dados.ruleChange.source}` : ' em rascunho'}.`
      : 'Dados da janela alterados.',
    detalhes: { versaoRegras, reservasAtivas: ativas, expedicoes },
  });
  await registrarEvento(tx, {
    acao: 'JANELA_ALTERADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'JANELA',
    alvoId: id,
    detalhes: { codigo: j.codigo, regras: mudouRegras, versaoRegras, justificativa: dados.ruleChange?.justification ?? null, fonte: dados.ruleChange?.source ?? null },
    requestId: autor.requestId,
  });
  return detalhe(tx, escopo, id, agora);
}

export async function confirmarJanela(tx: Transacao, escopo: Escopo, id: string, versao: number, autor: Autor, agora: Date): Promise<JanelaDetalhe> {
  const travada = await bloquearJanela(tx, escopo.id, id);
  exigirVersao(travada.versao, versao, `A janela ${travada.codigo}`);
  if (travada.situacao !== 'RASCUNHO') throw new ErroHttp(409, 'SITUACAO_INVALIDA', `A janela ${travada.codigo} já está ${ROTULOS_SITUACAO_JANELA[travada.situacao].toLowerCase()}.`);
  const j = await lerJanela(tx, escopo.id, id);
  const faltam: string[] = [];
  if (j.saidaInicio === null) faltam.push('data/horário de saída autorizado');
  if (j.autorizacaoFonte === null) faltam.push('fonte da autorização');
  if (j.autorizacaoReferencia === null) faltam.push('referência da autorização');
  if (j.autorizacaoData === null) faltam.push('data da autorização');
  if (j.autorizacaoResponsavel === null) faltam.push('responsável pela autorização');
  if (faltam.length > 0) throw new ErroHttp(409, 'PENDENCIA_DOCUMENTAL', `Para confirmar, registre: ${faltam.join(', ')}. Nada é presumido.`);
  await tx.janelaDevolucao.update({ where: { id }, data: { situacao: 'CONFIRMADA', confirmadaEm: agora, confirmadaPorId: autor.usuarioId, versao: { increment: 1 }, atualizadoEm: agora } });
  await registrarEventoJanela(tx, {
    escopoId: escopo.id,
    janelaId: id,
    tipo: 'JANELA_CONFIRMADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Janela confirmada: autorização ${j.autorizacaoReferencia ?? ''} (${j.autorizacaoFonte ?? ''}).`,
  });
  await registrarEvento(tx, {
    acao: 'JANELA_CONFIRMADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'JANELA',
    alvoId: id,
    detalhes: { codigo: j.codigo, referencia: j.autorizacaoReferencia },
    requestId: autor.requestId,
  });
  return detalhe(tx, escopo, id, agora);
}

/**
 * Encerra ou cancela. Reservas ativas bloqueiam, salvo liberação explícita
 * na mesma operação (estoque e capacidade liberados; reservas no histórico).
 * Cancelar não vale para janela com expedição confirmada (encerre-a).
 */
export async function encerrarJanela(
  tx: Transacao,
  escopo: Escopo,
  id: string,
  destino: 'ENCERRADA' | 'CANCELADA',
  dados: DadosEncerrar,
  autor: Autor,
  agora: Date,
): Promise<JanelaDetalhe> {
  const travada = await bloquearJanela(tx, escopo.id, id);
  exigirVersao(travada.versao, dados.expectedVersion, `A janela ${travada.codigo}`);
  const permitidas = destino === 'ENCERRADA' ? ['CONFIRMADA', 'PREPARACAO'] : ['RASCUNHO', 'CONFIRMADA', 'PREPARACAO'];
  if (!permitidas.includes(travada.situacao)) {
    throw new ErroHttp(409, 'SITUACAO_INVALIDA', `A janela ${travada.codigo} está ${ROTULOS_SITUACAO_JANELA[travada.situacao].toLowerCase()}: não pode ser ${destino === 'ENCERRADA' ? 'encerrada' : 'cancelada'}.`);
  }
  if (destino === 'CANCELADA' && (await tx.expedicao.count({ where: { janelaId: id } })) > 0) {
    throw new ErroHttp(409, 'SITUACAO_INVALIDA', 'Janela com expedição confirmada não é cancelada: as saídas permanecem no histórico. Encerre a janela.');
  }
  const ativas = await tx.reservaJanela.findMany({ where: { janelaId: id, situacao: 'ATIVA' }, select: { id: true, codigo: true }, orderBy: { id: 'asc' } });
  if (ativas.length > 0 && !dados.releaseActiveReservations) {
    throw new ErroHttp(
      409,
      'SITUACAO_INVALIDA',
      `Há ${String(ativas.length)} reserva(s) ativa(s) (${ativas.map((r) => r.codigo).join(', ')}): libere-as explicitamente para ${destino === 'ENCERRADA' ? 'encerrar' : 'cancelar'} a janela.`,
    );
  }
  for (const r of ativas) {
    await encerrarReservaSemSaida(tx, escopo, id, r.id, 'LIBERADA', `${destino === 'ENCERRADA' ? 'Encerramento' : 'Cancelamento'} da janela: ${dados.reason}`, autor, agora);
  }
  await tx.janelaDevolucao.update({
    where: { id },
    data: { situacao: destino, encerradaEm: agora, encerradaPorId: autor.usuarioId, motivoEncerramento: dados.reason, versao: { increment: 1 }, atualizadoEm: agora },
  });
  await registrarEventoJanela(tx, {
    escopoId: escopo.id,
    janelaId: id,
    tipo: destino === 'ENCERRADA' ? 'JANELA_ENCERRADA' : 'JANELA_CANCELADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `${destino === 'ENCERRADA' ? 'Janela encerrada' : 'Janela cancelada'}: ${dados.reason}${ativas.length > 0 ? ` (${String(ativas.length)} reserva(s) liberada(s))` : ''}.`,
    detalhes: { reservasLiberadas: ativas.map((r) => r.codigo) },
  });
  await registrarEvento(tx, {
    acao: destino === 'ENCERRADA' ? 'JANELA_ENCERRADA' : 'JANELA_CANCELADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'JANELA',
    alvoId: id,
    detalhes: { codigo: travada.codigo, motivo: dados.reason, reservasLiberadas: ativas.length },
    requestId: autor.requestId,
  });
  return detalhe(tx, escopo, id, agora);
}

// ---------- Anexos ----------

/**
 * Anexo privado da janela (autorização, documentos da expedição, evidência de
 * retorno). Tipo pelo conteúdo; mesmo conteúdo devolve o anexo existente.
 */
export async function enviarAnexoJanela(tx: Transacao, escopo: Escopo, janelaId: string, nome: string, conteudo: Buffer, maxBytes: number, autor: Autor, agora: Date): Promise<AnexoJanela> {
  const janela = await bloquearJanela(tx, escopo.id, janelaId);
  if (janela.situacao === 'CANCELADA') throw new ErroHttp(409, 'SITUACAO_INVALIDA', 'Janela cancelada não recebe anexos.');
  if (conteudo.length === 0) throw new ErroHttp(400, 'ANEXO_INVALIDO', 'Arquivo vazio.');
  if (conteudo.length > maxBytes) throw new ErroHttp(413, 'ANEXO_INVALIDO', `Anexo acima do limite de ${String(Math.round(maxBytes / 1_048_576))} MB.`);
  const tipo = tipoDoConteudo(conteudo);
  if (tipo === null) throw new ErroHttp(415, 'ANEXO_INVALIDO', 'Tipo de anexo não aceito: envie foto (JPEG, PNG, WebP) ou PDF.');
  const sha256 = createHash('sha256').update(conteudo).digest('hex');
  const selecao = { id: true, nome: true, tipoConteudo: true, tamanho: true, sha256: true, enviadoEm: true, enviadoPor: { select: { login: true, nome: true } } } as const;
  const paraContrato = (a: { id: string; nome: string; tipoConteudo: string; tamanho: number; sha256: string; enviadoEm: Date; enviadoPor: { login: string; nome: string } }): AnexoJanela => ({
    id: a.id,
    name: a.nome,
    contentType: a.tipoConteudo as AnexoJanela['contentType'],
    size: a.tamanho,
    sha256: a.sha256,
    uploadedAt: a.enviadoEm.toISOString(),
    uploadedBy: { login: a.enviadoPor.login, name: a.enviadoPor.nome },
  });
  const existente = await tx.anexoJanela.findFirst({ where: { escopoId: escopo.id, janelaId, sha256 }, select: selecao });
  if (existente) return paraContrato(existente);
  const id = randomUUID();
  const criado = await tx.anexoJanela.create({
    data: { id, escopoId: escopo.id, janelaId, nome: nomeArquivoSeguro(nome), tipoConteudo: tipo, tamanho: conteudo.length, sha256, conteudo: new Uint8Array(conteudo), enviadoPorId: autor.usuarioId, enviadoEm: agora },
    select: selecao,
  });
  await registrarEventoJanela(tx, { escopoId: escopo.id, janelaId, tipo: 'ANEXO_ENVIADO', autorId: autor.usuarioId, agora, resumo: `Anexo enviado (${tipo}, ${String(conteudo.length)} bytes).`, detalhes: { anexo: id, sha256 } });
  await registrarEvento(tx, {
    acao: 'JANELA_ANEXO_ENVIADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'JANELA',
    alvoId: janelaId,
    detalhes: { codigo: janela.codigo, anexo: id, tipo, tamanho: conteudo.length },
    requestId: autor.requestId,
  });
  return paraContrato(criado);
}

export async function lerAnexoJanela(db: Banco, escopoId: string, janelaId: string, anexoId: string) {
  const anexo = await db.anexoJanela.findFirst({ where: { id: anexoId, janelaId, escopoId }, select: { nome: true, tipoConteudo: true, conteudo: true } });
  if (!anexo) throw naoEncontrado('Anexo não encontrado nesta janela.');
  return anexo;
}

/** Anexos informados pertencem à janela. */
export async function exigirAnexosDaJanela(tx: Transacao, escopoId: string, janelaId: string, ids: readonly string[]): Promise<void> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return;
  const encontrados = await tx.anexoJanela.count({ where: { escopoId, janelaId, id: { in: unicos } } });
  if (encontrados !== unicos.length) throw requisicaoInvalida('Anexo informado não pertence a esta janela.');
}
