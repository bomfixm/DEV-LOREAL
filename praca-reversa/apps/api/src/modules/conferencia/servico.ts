/**
 * Serviço da conferência e da reconciliação (etapa 04).
 *
 * Estratégia de conflito (R07), aplicada por palete e nunca à praça inteira:
 * - uma única sessão em andamento por palete (índice único no banco); iniciar,
 *   concluir, cancelar, recontar e reconciliar bloqueiam a linha do palete
 *   (SELECT … FOR UPDATE) e depois a da sessão, sempre nessa ordem;
 * - enquanto a sessão está em andamento, operações incompatíveis daquele palete
 *   (arquivar, mover, transferir e corrigir movimentação) são recusadas — no
 *   serviço e por gatilhos no banco;
 * - concluir exige a revisão do rascunho e a versão do palete vistas por quem
 *   conclui; reconciliar exige a versão do palete vista e que o conteúdo
 *   validado não tenha mudado desde o início da contagem (versao_saldo).
 */
import type {
  AlterarNotasConferenciaSchema,
  CancelarConferenciaSchema,
  ConcluirConferenciaSchema,
  ConferenciaDetalhe,
  CorrigirObservacaoSchema,
  EstadoConferencia,
  IniciarConferenciaSchema,
  NovaObservacaoSchema,
  PreviaReconciliacao,
  ReconciliarConferenciaSchema,
  RemoverObservacaoSchema,
  ResultadoObservacao,
  ResultadoReconciliacao,
  SolicitarRecontagemSchema,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica } from '../../db/erros.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, acessoNegado, corpoErro, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { aplicarEvento, bloquearSaldos, lerEventos, lerSaldoPalete, recalcularResumoPaletes, temEventoEstoque, ultimaReconciliacao } from '../estoque/saldo.js';
import type { Resposta } from '../idempotencia/executar.js';
import { resolverEntrada, type EntradaResolvida } from './entrada.js';
import { lerConferencia, totaisDaSessao } from './leitura.js';
import { planejarReconciliacao } from './regras.js';

export interface Autor {
  usuarioId: string;
  requestId: string;
}

type DadosIniciar = z.output<typeof IniciarConferenciaSchema>;
type DadosObservacao = z.output<typeof NovaObservacaoSchema>;
type DadosCorrecao = z.output<typeof CorrigirObservacaoSchema>;
type DadosRemocao = z.output<typeof RemoverObservacaoSchema>;
type DadosNotas = z.output<typeof AlterarNotasConferenciaSchema>;
type DadosConcluir = z.output<typeof ConcluirConferenciaSchema>;
type DadosCancelar = z.output<typeof CancelarConferenciaSchema>;
type DadosRecontagem = z.output<typeof SolicitarRecontagemSchema>;
type DadosReconciliar = z.output<typeof ReconciliarConferenciaSchema>;

export interface PaleteBloqueado {
  id: string;
  codigo: string;
  versao: number;
  versao_saldo: number;
  arquivado: boolean;
  expedido: boolean;
  posicao_id: string | null;
  estado_conferencia: EstadoConferencia;
  motivo_pendencia: string | null;
}

/** Bloqueia a linha do palete até o fim da transação (serializa operações daquele palete). */
export async function bloquearPalete(tx: Transacao, escopoId: string, paleteId: string): Promise<PaleteBloqueado> {
  const [palete] = await tx.$queryRaw<PaleteBloqueado[]>`
    SELECT id::text, codigo, versao, versao_saldo, arquivado_em IS NOT NULL AS arquivado, estado_fluxo = 'EXPEDIDO' AS expedido, posicao_id::text,
           estado_conferencia::text AS estado_conferencia, motivo_pendencia
      FROM palete
     WHERE id = ${paleteId}::uuid AND escopo_id = ${escopoId}::uuid
       FOR UPDATE`;
  if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
  return palete;
}

const selecaoBloqueio = {
  id: true,
  paleteId: true,
  numero: true,
  escopoContagem: true,
  motivo: true,
  situacao: true,
  revisao: true,
  versaoSaldoInicial: true,
  responsavelId: true,
  sessaoOrigemId: true,
  escopoCompletoConfirmado: true,
} as const satisfies Prisma.SessaoConferenciaSelect;

type SessaoBloqueada = Prisma.SessaoConferenciaGetPayload<{ select: typeof selecaoBloqueio }>;

async function bloquearSessao(tx: Transacao, escopoId: string, sessaoId: string): Promise<SessaoBloqueada> {
  const travada = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM sessao_conferencia WHERE id = ${sessaoId}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (travada.length === 0) throw naoEncontrado('Conferência não encontrada neste escopo.');
  return tx.sessaoConferencia.findUniqueOrThrow({ where: { id: sessaoId }, select: selecaoBloqueio });
}

/** Palete da sessão bloqueado primeiro, depois a sessão (ordem fixa: evita impasse). */
async function bloquearPaleteDaSessao(tx: Transacao, escopoId: string, sessaoId: string) {
  const alvo = await tx.sessaoConferencia.findFirst({ where: { id: sessaoId, escopoId }, select: { paleteId: true } });
  if (!alvo) throw naoEncontrado('Conferência não encontrada neste escopo.');
  const palete = await bloquearPalete(tx, escopoId, alvo.paleteId);
  const sessao = await bloquearSessao(tx, escopoId, sessaoId);
  return { palete, sessao };
}

const SITUACOES: Record<string, string> = {
  EM_ANDAMENTO: 'em andamento',
  CONCLUIDA: 'concluída',
  CANCELADA: 'cancelada',
  RECONCILIADA: 'reconciliada',
  SUBSTITUIDA: 'substituída por recontagem',
};

function exigirEmAndamento(s: SessaoBloqueada): void {
  if (s.situacao !== 'EM_ANDAMENTO') {
    throw new ErroHttp(409, 'CONFLITO', `A conferência nº ${String(s.numero)} está ${SITUACOES[s.situacao] ?? s.situacao}: o rascunho não pode mais ser alterado.`);
  }
}

const pessoa = { select: { nome: true, login: true } } as const;

/**
 * Recusa a operação se o palete tem conferência em andamento. Proteção para
 * operações incompatíveis daquele palete (arquivar, mover, transferir, corrigir).
 */
export async function exigirSemConferenciaAtiva(tx: Transacao, escopoId: string, paleteId: string, operacao: string): Promise<void> {
  const ativa = await tx.sessaoConferencia.findFirst({
    where: { escopoId, paleteId, ativa: true },
    select: { numero: true, iniciadaEm: true, responsavel: pessoa },
  });
  if (ativa) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      `O palete está em conferência (nº ${String(ativa.numero)}${ativa.responsavel ? `, iniciada por ${ativa.responsavel.nome}` : ''}). ${operacao} fica bloqueado até a conferência ser concluída ou cancelada.`,
    );
  }
}

// ---------- Situação do palete ----------

/** Textos de pendência gerados pelo cadastro, pela carga de demonstração e por esta etapa; outros textos são preservados. */
const TEXTOS_DE_CONTAGEM = new Set([
  'Conteúdo desconhecido até a conferência',
  'Localização pendente; conteúdo desconhecido até a conferência',
  'Conteúdo desconhecido',
  'Endereço não registrado; conteúdo desconhecido',
  'Diferença de 3 unidades aguardando recontagem',
  'Conferência parcial; origem e lote pendentes',
  'Conferência parcial registrada; itens não contados continuam pendentes',
  'Localização pendente; conferência parcial registrada; itens não contados continuam pendentes',
  'Contagem completa aguardando validação',
  'Localização pendente; contagem completa aguardando validação',
  'Localização pendente',
]);

function motivoDeContagem(estado: EstadoConferencia, semPosicao: boolean): string | null {
  const local = semPosicao ? 'Localização pendente' : null;
  const contagem = {
    NAO_CONFERIDO: 'conteúdo desconhecido até a conferência',
    PARCIAL: 'conferência parcial registrada; itens não contados continuam pendentes',
    AGUARDANDO_VALIDACAO: 'contagem completa aguardando validação',
    RECONCILIADO: null,
  }[estado];
  if (local === null) return contagem === null ? null : contagem.charAt(0).toUpperCase() + contagem.slice(1);
  return contagem === null ? local : `${local}; ${contagem}`;
}

/**
 * Estado de conferência derivado das sessões e do estoque validado:
 * contagem completa concluída e não validada → aguardando validação; já
 * reconciliado → reconciliado; parcial concluída → parcial; senão não
 * conferido. Saldo recebido por transferência não torna o palete conferido:
 * só a reconciliação de uma contagem completa valida o conteúdo integral.
 */
async function estadoDerivado(tx: Transacao, escopoId: string, paleteId: string): Promise<EstadoConferencia> {
  const concluidas = await tx.sessaoConferencia.findMany({
    where: { escopoId, paleteId, situacao: 'CONCLUIDA' },
    select: { escopoContagem: true },
  });
  if (concluidas.some((s) => s.escopoContagem === 'COMPLETA')) return 'AGUARDANDO_VALIDACAO';
  if ((await ultimaReconciliacao(tx, escopoId, paleteId)) !== null) return 'RECONCILIADO';
  if (concluidas.length > 0) return 'PARCIAL';
  return 'NAO_CONFERIDO';
}

/**
 * Motivo de pendência do palete para o estado e a localização informados.
 * Textos que não foram gerados pela conferência/cadastro são preservados.
 */
export function motivoPendencia(estado: EstadoConferencia, semPosicao: boolean, atual: string | null): string | null {
  const preservar = atual !== null && !TEXTOS_DE_CONTAGEM.has(atual);
  return preservar ? atual : motivoDeContagem(estado, semPosicao);
}

/** Atualiza estado e pendência do palete; aumenta a versão quando algo muda (ou quando pedido). */
async function atualizarPalete(tx: Transacao, escopoId: string, palete: PaleteBloqueado, forcarVersao = false): Promise<EstadoConferencia> {
  const estado = await estadoDerivado(tx, escopoId, palete.id);
  const motivo = motivoPendencia(estado, palete.posicao_id === null, palete.motivo_pendencia);
  if (forcarVersao || estado !== palete.estado_conferencia || motivo !== palete.motivo_pendencia) {
    await tx.palete.update({
      where: { id: palete.id },
      data: { estadoConferencia: estado, motivoPendencia: motivo, versao: { increment: 1 } },
    });
  }
  // Resumo de liberação depende do estado de conferência (liberado só reconciliado).
  await recalcularResumoPaletes(tx, escopoId, [palete.id]);
  return estado;
}

async function detalhe(tx: Transacao, escopoId: string, id: string): Promise<ConferenciaDetalhe> {
  const d = await lerConferencia(tx, escopoId, id);
  if (!d) throw naoEncontrado('Conferência não encontrada neste escopo.');
  return d;
}

async function proximoNumero(tx: Transacao, paleteId: string): Promise<number> {
  const ultimo = await tx.sessaoConferencia.aggregate({ where: { paleteId }, _max: { numero: true } });
  return (ultimo._max.numero ?? 0) + 1;
}

async function exigirSemContagemPendente(tx: Transacao, escopoId: string, paleteId: string, exceto: string | null): Promise<void> {
  const pendente = await tx.sessaoConferencia.findFirst({
    where: { escopoId, paleteId, situacao: 'CONCLUIDA', escopoContagem: 'COMPLETA', ...(exceto ? { id: { not: exceto } } : {}) },
    select: { numero: true },
  });
  if (pendente) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      `Há uma contagem completa aguardando validação (nº ${String(pendente.numero)}). Reconcilie, cancele ou solicite recontagem dela antes de iniciar outra conferência.`,
    );
  }
}

function traduzirSessaoAtiva(erro: unknown): never {
  if (ehViolacaoUnica(erro)) {
    throw new ErroHttp(409, 'CONFLITO', 'Outra pessoa acabou de iniciar uma conferência neste palete. Abra a conferência em andamento.');
  }
  throw erro;
}

// ---------- Início ----------

export async function iniciarConferencia(
  tx: Transacao,
  escopoId: string,
  paleteId: string,
  dados: DadosIniciar,
  autor: Autor,
  agora: Date,
): Promise<ConferenciaDetalhe> {
  const palete = await bloquearPalete(tx, escopoId, paleteId);
  if (palete.arquivado) throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} está arquivado: não há conferência.`);
  if (palete.expedido) throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} foi expedido (saiu da praça): não há conferência. Retorno físico usa outro palete.`);
  await exigirSemConferenciaAtiva(tx, escopoId, paleteId, 'Iniciar outra conferência');
  if (palete.versao !== dados.expectedVersion) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `O palete ${palete.codigo} foi alterado. Os dados atuais foram recarregados; confira antes de iniciar.`);
  }
  await exigirSemContagemPendente(tx, escopoId, paleteId, null);
  const id = randomUUID();
  const numero = await proximoNumero(tx, paleteId);
  try {
    await tx.sessaoConferencia.create({
      data: {
        id,
        escopoId,
        paleteId,
        numero,
        escopoContagem: dados.scope,
        descricaoEscopo: dados.scopeDescription,
        motivo: 'CONFERENCIA',
        situacao: 'EM_ANDAMENTO',
        ativa: true,
        versaoPaleteInicial: palete.versao,
        versaoSaldoInicial: palete.versao_saldo,
        responsavelId: autor.usuarioId,
        iniciadaEm: agora,
        atualizadaEm: agora,
      },
    });
  } catch (erro) {
    traduzirSessaoAtiva(erro);
  }
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_INICIADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: 'CONFERENCIA',
    alvoId: id,
    detalhes: { palete: palete.codigo, numero, escopo: dados.scope, versaoPalete: palete.versao, versaoSaldo: palete.versao_saldo },
    requestId: autor.requestId,
  });
  return detalhe(tx, escopoId, id);
}

// ---------- Rascunho ----------

function dadosLinha(r: EntradaResolvida) {
  return {
    produtoId: r.produtoId,
    sku: r.sku,
    descricao: r.descricao,
    codigoLido: r.codigoLido,
    quantidadeInformada: r.quantidadeInformada,
    unidadeInformada: r.unidadeInformada,
    fatorConversao: r.fatorConversao,
    quantidadeCanonica: r.quantidadeCanonica,
    unidadeCanonica: r.unidadeCanonica,
    pendencia: r.pendencia,
  };
}

async function avancarRascunho(tx: Transacao, sessaoId: string, agora: Date) {
  return tx.sessaoConferencia.update({
    where: { id: sessaoId },
    data: { revisao: { increment: 1 }, atualizadaEm: agora },
    select: { id: true, revisao: true, atualizadaEm: true, situacao: true },
  });
}

async function resultadoLinha(tx: Transacao, escopoId: string, linhaId: string, sessao: { id: string; revisao: number; atualizadaEm: Date; situacao: ResultadoObservacao['session']['state'] }): Promise<ResultadoObservacao> {
  const d = await lerConferencia(tx, escopoId, sessao.id);
  const linha = d?.lines.find((l) => l.id === linhaId);
  if (!linha) throw new Error('Linha recém-gravada não encontrada.');
  return { line: linha, session: { id: sessao.id, revision: sessao.revisao, updatedAt: sessao.atualizadaEm.toISOString(), state: sessao.situacao } };
}

/** Uma ação de entrada (leitura ou quantidade digitada) vira uma linha; leituras repetidas são linhas distintas. */
export async function registrarObservacao(
  tx: Transacao,
  escopoId: string,
  sessaoId: string,
  dados: DadosObservacao,
  autor: Autor,
  agora: Date,
): Promise<ResultadoObservacao> {
  const sessao = await bloquearSessao(tx, escopoId, sessaoId);
  exigirEmAndamento(sessao);
  const resolvida = await resolverEntrada(tx, escopoId, dados);
  const ultima = await tx.observacaoConferencia.aggregate({ where: { sessaoId }, _max: { ordem: true } });
  const id = randomUUID();
  await tx.observacaoConferencia.create({
    data: {
      id,
      escopoId,
      sessaoId,
      ordem: (ultima._max.ordem ?? 0) + 1,
      ...dadosLinha(resolvida),
      modoEntrada: dados.mode,
      lote: dados.lot,
      origemTipo: dados.originType,
      origemReferencia: dados.originReference,
      condicao: dados.condition,
      nota: dados.note,
      evidencia: dados.evidence,
      registradoPorId: autor.usuarioId,
      registradoEm: agora,
    },
  });
  return resultadoLinha(tx, escopoId, id, await avancarRascunho(tx, sessaoId, agora));
}

async function linhaParaAlterar(tx: Transacao, escopoId: string, sessaoId: string, linhaId: string, revisaoEsperada: number) {
  const linha = await tx.observacaoConferencia.findFirst({
    where: { id: linhaId, sessaoId, escopoId },
    select: {
      id: true,
      ordem: true,
      revisao: true,
      removidaEm: true,
      codigoLido: true,
      produtoId: true,
      sku: true,
      descricao: true,
      modoEntrada: true,
      quantidadeInformada: true,
      unidadeInformada: true,
      fatorConversao: true,
      quantidadeCanonica: true,
      unidadeCanonica: true,
      lote: true,
      origemTipo: true,
      origemReferencia: true,
      condicao: true,
      pendencia: true,
      nota: true,
      evidencia: true,
    },
  });
  if (!linha) throw naoEncontrado('Linha da conferência não encontrada.');
  if (linha.removidaEm !== null) throw new ErroHttp(409, 'CONFLITO', `A linha ${String(linha.ordem)} já foi removida do rascunho.`);
  if (linha.revisao !== revisaoEsperada) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `A linha ${String(linha.ordem)} foi alterada por outra pessoa. Recarregue e confira.`);
  }
  const { removidaEm: _r, ...anterior } = linha;
  const snapshot = {
    ...anterior,
    quantidadeInformada: linha.quantidadeInformada.toFixed(),
    fatorConversao: linha.fatorConversao?.toFixed() ?? null,
    quantidadeCanonica: linha.quantidadeCanonica?.toFixed() ?? null,
  };
  return { linha, snapshot };
}

/** Correção no rascunho: a linha avança uma revisão e o estado anterior fica no histórico. */
export async function corrigirObservacao(
  tx: Transacao,
  escopoId: string,
  sessaoId: string,
  linhaId: string,
  dados: DadosCorrecao,
  autor: Autor,
  agora: Date,
): Promise<ResultadoObservacao> {
  const sessao = await bloquearSessao(tx, escopoId, sessaoId);
  exigirEmAndamento(sessao);
  const { linha, snapshot } = await linhaParaAlterar(tx, escopoId, sessaoId, linhaId, dados.expectedRevision);
  const resolvida = await resolverEntrada(tx, escopoId, {
    mode: 'MANUAL',
    code: null,
    productId: dados.productId,
    packagingCode: dados.packagingCode,
    quantity: dados.quantity,
    unit: dados.unit,
    description: dados.description ?? (dados.productId === null ? linha.descricao : null),
    registerAsPending: dados.registerAsPending,
  });
  await tx.revisaoObservacao.create({
    data: { escopoId, observacaoId: linha.id, revisao: linha.revisao, acao: 'CORRIGIDA', anterior: snapshot, motivo: dados.reason, autorId: autor.usuarioId, ocorridoEm: agora },
  });
  await tx.observacaoConferencia.update({
    where: { id: linha.id },
    data: {
      ...dadosLinha(resolvida),
      codigoLido: resolvida.codigoLido ?? linha.codigoLido,
      lote: dados.lot,
      origemTipo: dados.originType,
      origemReferencia: dados.originReference,
      condicao: dados.condition,
      nota: dados.note,
      evidencia: dados.evidence,
      revisao: { increment: 1 },
    },
  });
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_OBSERVACAO_CORRIGIDA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: 'CONFERENCIA',
    alvoId: sessaoId,
    detalhes: { linha: linha.ordem, revisao: linha.revisao + 1, motivo: dados.reason },
    requestId: autor.requestId,
  });
  return resultadoLinha(tx, escopoId, linha.id, await avancarRascunho(tx, sessaoId, agora));
}

/** Remoção no rascunho: a linha deixa de contar, mas fica registrada com autor, horário e motivo. */
export async function removerObservacao(
  tx: Transacao,
  escopoId: string,
  sessaoId: string,
  linhaId: string,
  dados: DadosRemocao,
  autor: Autor,
  agora: Date,
): Promise<ResultadoObservacao> {
  const sessao = await bloquearSessao(tx, escopoId, sessaoId);
  exigirEmAndamento(sessao);
  const { linha, snapshot } = await linhaParaAlterar(tx, escopoId, sessaoId, linhaId, dados.expectedRevision);
  await tx.revisaoObservacao.create({
    data: { escopoId, observacaoId: linha.id, revisao: linha.revisao, acao: 'REMOVIDA', anterior: snapshot, motivo: dados.reason, autorId: autor.usuarioId, ocorridoEm: agora },
  });
  await tx.observacaoConferencia.update({
    where: { id: linha.id },
    data: { removidaEm: agora, removidaPorId: autor.usuarioId, motivoRemocao: dados.reason, revisao: { increment: 1 } },
  });
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_OBSERVACAO_REMOVIDA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: 'CONFERENCIA',
    alvoId: sessaoId,
    detalhes: { linha: linha.ordem, motivo: dados.reason },
    requestId: autor.requestId,
  });
  return resultadoLinha(tx, escopoId, linha.id, await avancarRascunho(tx, sessaoId, agora));
}

export async function alterarNotas(
  tx: Transacao,
  escopoId: string,
  sessaoId: string,
  dados: DadosNotas,
  autor: Autor,
  agora: Date,
): Promise<ConferenciaDetalhe> {
  const sessao = await bloquearSessao(tx, escopoId, sessaoId);
  exigirEmAndamento(sessao);
  if (sessao.revisao !== dados.expectedRevision) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O rascunho recebeu alterações de outra pessoa. Recarregue e confira as observações.');
  }
  await tx.sessaoConferencia.update({ where: { id: sessaoId }, data: { observacoes: dados.notes, revisao: { increment: 1 }, atualizadaEm: agora } });
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_NOTAS_ALTERADAS',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: 'CONFERENCIA',
    alvoId: sessaoId,
    detalhes: { revisao: sessao.revisao + 1 },
    requestId: autor.requestId,
  });
  return detalhe(tx, escopoId, sessaoId);
}

// ---------- Conclusão, cancelamento e recontagem ----------

export async function concluirConferencia(
  tx: Transacao,
  escopoId: string,
  sessaoId: string,
  dados: DadosConcluir,
  autor: Autor,
  agora: Date,
): Promise<ConferenciaDetalhe> {
  const { palete, sessao } = await bloquearPaleteDaSessao(tx, escopoId, sessaoId);
  exigirEmAndamento(sessao);
  if (sessao.revisao !== dados.expectedRevision) {
    throw new ErroHttp(
      409,
      'CONFLITO_VERSAO',
      `A conferência recebeu alterações depois da sua revisão (agora na revisão ${String(sessao.revisao)}). Revise o rascunho atual antes de concluir.`,
    );
  }
  if (palete.versao !== dados.expectedPalletVersion) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `O palete ${palete.codigo} foi alterado durante a conferência. Confira os dados atuais antes de concluir.`);
  }
  if (palete.versao_saldo !== sessao.versaoSaldoInicial) {
    throw new ErroHttp(
      409,
      'CONFLITO_VERSAO',
      `O conteúdo validado do palete ${palete.codigo} mudou desde o início desta contagem. Cancele esta conferência e conte novamente.`,
    );
  }
  const linhas = await tx.observacaoConferencia.count({ where: { sessaoId, removidaEm: null } });
  if (sessao.escopoContagem === 'COMPLETA' && !dados.confirmFullScope) {
    throw requisicaoInvalida('Conferência completa: confirme que todo o escopo físico do palete foi conferido.');
  }
  if (sessao.escopoContagem === 'PARCIAL' && linhas === 0) {
    throw requisicaoInvalida('Conferência parcial sem observações: registre o que foi contado ou cancele a conferência.');
  }
  await tx.sessaoConferencia.update({
    where: { id: sessaoId },
    data: {
      situacao: 'CONCLUIDA',
      ativa: null,
      concluidaEm: agora,
      concluidaPorId: autor.usuarioId,
      escopoCompletoConfirmado: sessao.escopoContagem === 'COMPLETA',
      atualizadaEm: agora,
    },
  });
  if (sessao.sessaoOrigemId !== null) {
    // Recontagem concluída substitui a contagem de origem ainda não validada (que fica preservada).
    await tx.sessaoConferencia.updateMany({ where: { id: sessao.sessaoOrigemId, situacao: 'CONCLUIDA' }, data: { situacao: 'SUBSTITUIDA' } });
  }
  const estado = await atualizarPalete(tx, escopoId, palete);
  const { totais, pendencias } = await totaisDaSessao(tx, escopoId, sessaoId);
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_CONCLUIDA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: 'CONFERENCIA',
    alvoId: sessaoId,
    detalhes: {
      palete: palete.codigo,
      numero: sessao.numero,
      escopo: sessao.escopoContagem,
      linhas,
      segmentos: totais.length,
      pendencias: pendencias.length,
      estadoPalete: estado,
    },
    requestId: autor.requestId,
  });
  return detalhe(tx, escopoId, sessaoId);
}

export async function cancelarConferencia(
  tx: Transacao,
  escopoId: string,
  sessaoId: string,
  dados: DadosCancelar,
  autor: Autor & { podeValidar: boolean },
  agora: Date,
): Promise<ConferenciaDetalhe> {
  const { palete, sessao } = await bloquearPaleteDaSessao(tx, escopoId, sessaoId);
  if (sessao.situacao === 'EM_ANDAMENTO') {
    if (sessao.responsavelId !== autor.usuarioId && !autor.podeValidar) throw acessoNegado();
  } else if (sessao.situacao === 'CONCLUIDA') {
    if (!autor.podeValidar) throw acessoNegado();
  } else {
    throw new ErroHttp(409, 'CONFLITO', `A conferência nº ${String(sessao.numero)} está ${SITUACOES[sessao.situacao] ?? sessao.situacao} e não pode ser cancelada.`);
  }
  if (sessao.revisao !== dados.expectedRevision) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', 'A conferência foi alterada por outra pessoa. Recarregue e confira antes de cancelar.');
  }
  await tx.sessaoConferencia.update({
    where: { id: sessaoId },
    data: { situacao: 'CANCELADA', ativa: null, canceladaEm: agora, canceladaPorId: autor.usuarioId, motivoCancelamento: dados.reason },
  });
  const estado = await atualizarPalete(tx, escopoId, palete);
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_CANCELADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: 'CONFERENCIA',
    alvoId: sessaoId,
    detalhes: { palete: palete.codigo, numero: sessao.numero, situacaoAnterior: sessao.situacao, motivo: dados.reason, estadoPalete: estado },
    requestId: autor.requestId,
  });
  return detalhe(tx, escopoId, sessaoId);
}

/** Recontagem/correção: nova sessão vinculada à original, com justificativa; as observações originais ficam preservadas. */
export async function solicitarRecontagem(
  tx: Transacao,
  escopoId: string,
  sessaoId: string,
  dados: DadosRecontagem,
  autor: Autor,
  agora: Date,
): Promise<ConferenciaDetalhe> {
  const { palete, sessao: origem } = await bloquearPaleteDaSessao(tx, escopoId, sessaoId);
  if (origem.situacao !== 'CONCLUIDA' && origem.situacao !== 'RECONCILIADA') {
    throw new ErroHttp(
      409,
      'CONFLITO',
      `Recontagem só de conferência concluída ou reconciliada; a nº ${String(origem.numero)} está ${SITUACOES[origem.situacao] ?? origem.situacao}.`,
    );
  }
  if (palete.arquivado) throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} está arquivado.`);
  await exigirSemConferenciaAtiva(tx, escopoId, palete.id, 'Iniciar a recontagem');
  if (palete.versao !== dados.expectedPalletVersion) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `O palete ${palete.codigo} foi alterado. Confira os dados atuais antes de pedir a recontagem.`);
  }
  await exigirSemContagemPendente(tx, escopoId, palete.id, origem.id);
  const original = await tx.sessaoConferencia.findUniqueOrThrow({ where: { id: origem.id }, select: { descricaoEscopo: true } });
  const id = randomUUID();
  const numero = await proximoNumero(tx, palete.id);
  try {
    await tx.sessaoConferencia.create({
      data: {
        id,
        escopoId,
        paleteId: palete.id,
        numero,
        escopoContagem: origem.escopoContagem,
        descricaoEscopo: original.descricaoEscopo,
        motivo: 'RECONTAGEM',
        sessaoOrigemId: origem.id,
        justificativa: dados.justification,
        situacao: 'EM_ANDAMENTO',
        ativa: true,
        versaoPaleteInicial: palete.versao,
        versaoSaldoInicial: palete.versao_saldo,
        responsavelId: autor.usuarioId,
        iniciadaEm: agora,
        atualizadaEm: agora,
      },
    });
  } catch (erro) {
    traduzirSessaoAtiva(erro);
  }
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_RECONTAGEM_SOLICITADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: 'CONFERENCIA',
    alvoId: id,
    detalhes: { palete: palete.codigo, numero, origem: origem.numero, situacaoOrigem: origem.situacao, justificativa: dados.justification },
    requestId: autor.requestId,
  });
  return detalhe(tx, escopoId, id);
}

// ---------- Reconciliação ----------

interface Analise {
  bloqueios: string[];
  plano: ReturnType<typeof planejarReconciliacao>;
  tipo: 'SALDO_INICIAL' | 'AJUSTE_RECONCILIACAO';
}

/** Verifica versão, escopo, unidade/conversões e pendências; calcula o plano contra o saldo atual. */
async function analisar(
  db: Banco | Transacao,
  escopoId: string,
  sessao: Pick<SessaoBloqueada, 'id' | 'numero' | 'situacao' | 'escopoContagem' | 'versaoSaldoInicial' | 'escopoCompletoConfirmado' | 'paleteId'>,
  palete: { versaoSaldo: number; arquivado: boolean },
): Promise<Analise> {
  const bloqueios: string[] = [];
  if (sessao.situacao !== 'CONCLUIDA') bloqueios.push(`A conferência nº ${String(sessao.numero)} está ${SITUACOES[sessao.situacao] ?? sessao.situacao}.`);
  if (sessao.escopoContagem !== 'COMPLETA') {
    bloqueios.push('Conferência parcial não substitui o saldo integral do palete: registra observações e pendências (decisão da etapa 04).');
  }
  if (sessao.escopoContagem === 'COMPLETA' && !sessao.escopoCompletoConfirmado) bloqueios.push('Escopo completo não confirmado na conclusão.');
  if (palete.arquivado) bloqueios.push('Palete arquivado.');
  const ativa = await db.sessaoConferencia.findFirst({ where: { escopoId, paleteId: sessao.paleteId, ativa: true }, select: { numero: true } });
  if (ativa) bloqueios.push(`Há conferência em andamento neste palete (nº ${String(ativa.numero)}).`);
  if (palete.versaoSaldo !== sessao.versaoSaldoInicial) {
    bloqueios.push('O conteúdo validado do palete mudou depois do início desta contagem: é necessária recontagem.');
  }
  const { totais, pendencias } = await totaisDaSessao(db, escopoId, sessao.id);
  if (pendencias.length > 0) {
    bloqueios.push(
      `${String(pendencias.length)} observação(ões) pendente(s) (código não cadastrado ou fator desconhecido). Cadastre o produto/fator e solicite recontagem.`,
    );
  }
  const saldo = await lerSaldoPalete(db, escopoId, sessao.paleteId);
  const plano = planejarReconciliacao(totais, saldo, sessao.id);
  // Saldo inicial só no primeiro evento de estoque do palete; depois de uma
  // transferência recebida, a reconciliação ajusta o saldo conhecido.
  const tipo = (await temEventoEstoque(db, escopoId, sessao.paleteId)) ? 'AJUSTE_RECONCILIACAO' : 'SALDO_INICIAL';
  return { bloqueios, plano, tipo };
}

const NOTAS_RECONCILIACAO = [
  'A reconciliação grava saldo, evento, vínculo com a conferência e auditoria numa única transação.',
  'Não libera material (bloqueado continua bloqueado; quantidade acrescida chega pendente de liberação; redução limita a parte liberada ao novo saldo), não encerra claim e não confirma expedição.',
  'Ajustes são calculados contra o saldo validado atual; nenhum saldo antigo é restaurado.',
];

/** Prévia dos efeitos da reconciliação, sem gravar nada. */
export async function previaReconciliacao(db: Banco, escopoId: string, sessaoId: string): Promise<PreviaReconciliacao> {
  const sessao = await db.sessaoConferencia.findFirst({ where: { id: sessaoId, escopoId }, select: selecaoBloqueio });
  if (!sessao) throw naoEncontrado('Conferência não encontrada neste escopo.');
  const palete = await db.palete.findFirstOrThrow({
    where: { id: sessao.paleteId, escopoId },
    select: { id: true, codigo: true, versao: true, versaoSaldo: true, arquivadoEm: true, estadoLiberacao: true },
  });
  const { bloqueios, plano, tipo } = await analisar(db, escopoId, sessao, { versaoSaldo: palete.versaoSaldo, arquivado: palete.arquivadoEm !== null });
  return {
    sessionId: sessao.id,
    palletId: palete.id,
    palletCode: palete.codigo,
    palletVersion: palete.versao,
    eventType: tipo,
    allowed: bloqueios.length === 0 && plano.conflitos.length === 0,
    blockers: [...bloqueios, ...plano.conflitos],
    changes: plano.mudancas.map((m) => ({
      segmentKey: m.chave,
      segmentId: m.segmentoId,
      productId: m.produtoId,
      sku: m.sku,
      description: m.descricao,
      lot: m.lote,
      originType: m.origemTipo,
      originReference: m.origemReferencia,
      condition: m.condicao,
      lineage: m.linhagem,
      unit: m.unidade,
      current: m.atual,
      target: m.alvo,
      delta: m.delta,
      reserved: m.reservada,
      claimLinked: m.vinculada,
    })),
    unchanged: plano.inalterados,
    releaseState: palete.estadoLiberacao,
    notes: NOTAS_RECONCILIACAO,
  };
}

/**
 * Reconcilia uma contagem completa: saldo inicial (primeira vez) ou ajustes
 * contra o saldo atual. Saldo, evento, vínculo com a conferência, estado e
 * versão do palete e auditoria na mesma transação (a da idempotência).
 * Conflito com reservas: nada muda no saldo; a pendência fica registrada.
 */
export async function reconciliarConferencia(
  tx: Transacao,
  escopoId: string,
  sessaoId: string,
  dados: DadosReconciliar,
  autor: Autor,
  agora: Date,
): Promise<Resposta> {
  const { palete, sessao } = await bloquearPaleteDaSessao(tx, escopoId, sessaoId);
  if (sessao.situacao === 'RECONCILIADA') {
    throw new ErroHttp(409, 'CONFLITO', `A conferência nº ${String(sessao.numero)} já foi reconciliada.`);
  }
  if (palete.versao !== dados.expectedPalletVersion) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `O palete ${palete.codigo} foi alterado desde a sua revisão. Confira os dados atuais antes de reconciliar.`);
  }
  // Linhas de saldo bloqueadas antes do plano: uma reserva concorrente espera e
  // reavalia o disponível depois desta transação.
  await bloquearSaldos(tx, escopoId, [palete.id]);
  const { bloqueios, plano, tipo } = await analisar(tx, escopoId, sessao, { versaoSaldo: palete.versao_saldo, arquivado: palete.arquivado });
  if (bloqueios.length > 0) {
    const versao = bloqueios.some((b) => b.includes('mudou depois do início'));
    throw new ErroHttp(409, versao ? 'CONFLITO_VERSAO' : 'CONFLITO', bloqueios.join(' '));
  }
  if (plano.conflitos.length > 0) {
    // Nada é sobrescrito: a pendência fica registrada para tratamento.
    const motivo = `Reconciliação recusada: ${plano.conflitos.join(' ')}`;
    await tx.sessaoConferencia.update({ where: { id: sessaoId }, data: { pendenciaReconciliacao: motivo, pendenciaRegistradaEm: agora } });
    await registrarEvento(tx, {
      acao: 'CONFERENCIA_RECONCILIACAO_RECUSADA',
      resultado: 'NEGADO',
      atorUsuarioId: autor.usuarioId,
      escopoId,
      alvoTipo: 'CONFERENCIA',
      alvoId: sessaoId,
      detalhes: { palete: palete.codigo, numero: sessao.numero, conflitos: plano.conflitos.length },
      requestId: autor.requestId,
    });
    return { status: 409, corpo: { ...corpoErro('CONFLITO_SALDO', `${motivo} Pendência registrada para tratamento.`, autor.requestId) } };
  }
  const { eventoId } = await aplicarEvento(tx, {
    escopoId,
    paleteId: palete.id,
    paleteDestinoId: null,
    tipo,
    sessaoId,
    eventoCorrigidoId: null,
    motivo: dados.justification,
    autorId: autor.usuarioId,
    agora,
    linhas: plano.mudancas.map((m) => ({ ...m, paleteId: palete.id })),
  });
  await tx.sessaoConferencia.update({
    where: { id: sessaoId },
    data: { situacao: 'RECONCILIADA', reconciliadaEm: agora, reconciliadaPorId: autor.usuarioId, justificativaReconciliacao: dados.justification },
  });
  const estado = await atualizarPalete(tx, escopoId, palete, true);
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_RECONCILIADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: 'CONFERENCIA',
    alvoId: sessaoId,
    detalhes: {
      palete: palete.codigo,
      numero: sessao.numero,
      evento: eventoId,
      tipo,
      linhasAlteradas: plano.mudancas.length,
      inalterados: plano.inalterados,
      versaoSaldo: palete.versao_saldo + 1,
      estadoPalete: estado,
    },
    requestId: autor.requestId,
  });
  const [evento] = await lerEventos(tx, escopoId, { eventoId });
  if (!evento) throw new Error('Evento recém-gravado não encontrado.');
  const corpo: ResultadoReconciliacao = { event: evento, session: await detalhe(tx, escopoId, sessaoId) };
  return { status: 200, corpo };
}
