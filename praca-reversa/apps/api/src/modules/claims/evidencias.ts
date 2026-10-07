/**
 * Evidências, anexos e validação de recuperação física (etapa 07; R16–R17).
 *
 * Fluxo: selecionar caso/linha → investigar candidato → conferir material →
 * registrar evidência → solicitar validação → validar ou rejeitar com
 * justificativa. Só evidência de material conferido (palete × segmento com
 * saldo reconciliado) vai à validação; documento e descrição apoiam a
 * investigação e a decisão financeira, mas não comprovam presença física.
 *
 * A validação aloca a quantidade ao material rastreável (vínculo no saldo do
 * palete × segmento) na mesma transação que grava a recuperação, o histórico,
 * a auditoria e a idempotência. Bloqueios: caso → linha → palete → saldo.
 * Reservado + vinculado ≤ saldo e recuperada ≤ quantidade em análise são
 * conferidos pelo banco (CHECK) além do serviço; duas validações concorrentes
 * esperam uma pela outra no saldo e a segunda reavalia o elegível.
 */
import {
  UNIDADE_PECA,
  compararQuantidades,
  ehQuantidadeInteira,
  nomeArquivoSeguro,
  normalizarQuantidade,
  subtrairQuantidades,
  type ClaimDetalhe,
  type Escopo,
  type EstornarRecuperacaoSchema,
  type RegistrarEvidenciaSchema,
  type RejeitarValidacaoSchema,
  type SolicitarValidacaoSchema,
  type ValidarRecuperacaoSchema,
  type Anexo,
  type TIPOS_ANEXO,
} from '@praca-reversa/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { bloquearSaldos } from '../estoque/saldo.js';
import { registrarEventoClaim } from './historico.js';
import { anexoDe, detalheClaim } from './leitura.js';
import { situacaoAposDecisao, verificarMaterial, type LinhaRegra } from './regras.js';
import { bloquearCaso, exigirAberto, gravarSituacao, type Autor } from './servico.js';

type TipoAnexo = (typeof TIPOS_ANEXO)[number];

// ---------- Anexos ----------

/** Tipo pelo conteúdo (assinatura do arquivo), nunca pela extensão ou cabeçalho do cliente. */
export function tipoDoConteudo(conteudo: Buffer): TipoAnexo | null {
  if (conteudo.length >= 5 && conteudo.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (conteudo.length >= 8 && conteudo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (conteudo.length >= 3 && conteudo[0] === 0xff && conteudo[1] === 0xd8 && conteudo[2] === 0xff) return 'image/jpeg';
  if (conteudo.length >= 12 && conteudo.subarray(0, 4).toString('latin1') === 'RIFF' && conteudo.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Anexo privado do caso (foto ou PDF), limitado em tipo e tamanho. Mesmo
 * conteúdo já enviado ao caso devolve o anexo existente.
 */
export async function enviarAnexo(tx: Transacao, escopo: Escopo, claimId: string, nome: string, conteudo: Buffer, maxBytes: number, autor: Autor, agora: Date): Promise<Anexo> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'anexos não são acrescentados');
  if (conteudo.length === 0) throw new ErroHttp(400, 'ANEXO_INVALIDO', 'Arquivo vazio.');
  if (conteudo.length > maxBytes) throw new ErroHttp(413, 'ANEXO_INVALIDO', `Anexo acima do limite de ${String(Math.round(maxBytes / 1_048_576))} MB.`);
  const tipo = tipoDoConteudo(conteudo);
  if (tipo === null) throw new ErroHttp(415, 'ANEXO_INVALIDO', 'Tipo de anexo não aceito: envie foto (JPEG, PNG, WebP) ou PDF.');
  const sha256 = createHash('sha256').update(conteudo).digest('hex');
  const selecao = {
    id: true,
    nome: true,
    tipoConteudo: true,
    tamanho: true,
    sha256: true,
    enviadoEm: true,
    evidenciaId: true,
    resultadoId: true,
    enviadoPor: { select: { login: true, nome: true } },
  } as const;
  const existente = await tx.anexoClaim.findFirst({ where: { escopoId: escopo.id, claimId, sha256 }, select: selecao });
  if (existente) return anexoDe(existente);
  const id = randomUUID();
  const criado = await tx.anexoClaim.create({
    data: { id, escopoId: escopo.id, claimId, nome: nomeArquivoSeguro(nome), tipoConteudo: tipo, tamanho: conteudo.length, sha256, conteudo: new Uint8Array(conteudo), enviadoPorId: autor.usuarioId, enviadoEm: agora },
    select: selecao,
  });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    tipo: 'ANEXO_ENVIADO',
    autorId: autor.usuarioId,
    agora,
    resumo: `Anexo enviado (${tipo}, ${String(conteudo.length)} bytes).`,
    relacionadoId: id,
    detalhes: { tipo, tamanho: conteudo.length, sha256 },
  });
  await registrarEvento(tx, {
    acao: 'CLAIM_ANEXO_ENVIADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo, anexo: id, tipo, tamanho: conteudo.length },
    requestId: autor.requestId,
  });
  return anexoDe(criado);
}

/** Conteúdo do anexo, só do caso e do escopo informados. */
export async function lerAnexo(db: Banco, escopoId: string, claimId: string, anexoId: string) {
  const anexo = await db.anexoClaim.findFirst({ where: { id: anexoId, claimId, escopoId }, select: { nome: true, tipoConteudo: true, conteudo: true, sha256: true } });
  if (!anexo) throw naoEncontrado('Anexo não encontrado neste claim.');
  return anexo;
}

/** Anexos ainda livres do caso, para vincular a uma evidência ou resultado. */
export async function exigirAnexosLivres(tx: Transacao, escopoId: string, claimId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const anexos = await tx.anexoClaim.findMany({ where: { escopoId, claimId, id: { in: [...ids] } }, select: { id: true, evidenciaId: true, resultadoId: true } });
  if (anexos.length !== new Set(ids).size) throw naoEncontrado('Anexo não encontrado neste claim.');
  if (anexos.some((a) => a.evidenciaId !== null || a.resultadoId !== null)) throw new ErroHttp(409, 'CONFLITO', 'Anexo já vinculado a outra evidência ou resultado.');
}

// ---------- Evidência ----------

async function linhaDoCaso(tx: Transacao, escopoId: string, claimId: string, linhaId: string, bloquear: boolean) {
  if (bloquear) await tx.$queryRaw`SELECT id FROM linha_claim WHERE id = ${linhaId}::uuid AND claim_id = ${claimId}::uuid FOR UPDATE`;
  const linha = await tx.linhaClaim.findFirst({ where: { id: linhaId, claimId, escopoId }, include: { produto: { select: { unidadeCanonica: true } } } });
  if (!linha) throw naoEncontrado('Linha não encontrada neste claim.');
  return linha;
}

function regraDe(l: Awaited<ReturnType<typeof linhaDoCaso>>): LinhaRegra {
  return {
    id: l.id,
    identificador: l.identificador,
    produtoId: l.produtoId,
    sku: l.sku,
    unidade: l.unidade,
    unidadeCanonica: l.produto?.unidadeCanonica ?? null,
    quantidade: normalizarQuantidade(l.quantidadeAnalise.toFixed()),
    lote: l.lote,
    loteExigido: l.loteExigido,
    origemTipo: l.origemTipo,
    origemReferencia: l.origemReferencia,
    origemLinha: l.origemLinha,
    valorEstimado: l.valorEstimado?.toFixed() ?? null,
    baseValor: l.baseValor,
    recuperada: normalizarQuantidade(l.quantidadeRecuperada.toFixed()),
    coberta: normalizarQuantidade(l.quantidadeCoberta.toFixed()),
  };
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function registrarEvidencia(tx: Transacao, escopo: Escopo, claimId: string, dados: z.output<typeof RegistrarEvidenciaSchema>, autor: Autor, agora: Date): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'evidências não são registradas');
  const linha = await linhaDoCaso(tx, escopo.id, claimId, dados.lineId, false);
  if (dados.candidateId) {
    const c = await tx.candidatoClaim.findFirst({ where: { id: dados.candidateId, claimId, linhaId: linha.id, escopoId: escopo.id }, select: { situacao: true } });
    if (!c) throw naoEncontrado('Candidato não encontrado nesta linha.');
    if (c.situacao !== 'EM_INVESTIGACAO') throw new ErroHttp(409, 'CONFLITO', 'Candidato descartado não sustenta evidência.');
  }
  await exigirAnexosLivres(tx, escopo.id, claimId, dados.attachmentIds);
  const retratoLinha = {
    linha: linha.identificador,
    versaoLinha: linha.versao,
    sku: linha.sku,
    quantidadeAnalise: normalizarQuantidade(linha.quantidadeAnalise.toFixed()),
    unidade: linha.unidade,
    lote: linha.lote,
    loteExigido: linha.loteExigido,
    origemTipo: linha.origemTipo,
    origemReferencia: linha.origemReferencia,
    origemLinha: linha.origemLinha,
  };
  let retrato: Record<string, unknown> = { linha: retratoLinha };
  let paleteId: string | null = null;
  let posicao: string | null = null;
  let segmentoId: string | null = null;
  let quantidade: string | null = dados.quantity ?? null;
  let unidade: string | null;
  let condicao: 'SAUDAVEL' | 'AVARIADO' | 'EM_AVALIACAO' | null = null;
  let sessaoId: string | null = null;
  let linhaDocumentoId: string | null = null;

  if (dados.type === 'MATERIAL_CONFERIDO') {
    paleteId = dados.palletId ?? null;
    segmentoId = dados.segmentId ?? null;
    const palete = await tx.palete.findFirst({
      where: { id: paleteId ?? '', escopoId: escopo.id },
      select: { id: true, codigo: true, versaoSaldo: true, arquivadoEm: true, posicao: { select: { codigo: true } } },
    });
    if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
    const saldo = await tx.saldoEstoque.findFirst({
      where: { paleteId: palete.id, segmentoId: segmentoId ?? '', escopoId: escopo.id },
      include: { segmento: { include: { produto: { select: { sku: true } } } } },
    });
    if (!saldo) throw new ErroHttp(409, 'CONFLITO', 'O palete não tem saldo validado deste material: confira e reconcilie antes de registrar a evidência de material conferido.');
    const qtd = normalizarQuantidade(quantidade ?? '0');
    if (compararQuantidades(qtd, '0') <= 0) throw requisicaoInvalida('Quantidade conferida precisa ser maior que zero.');
    if (saldo.segmento.unidade === UNIDADE_PECA && !ehQuantidadeInteira(qtd)) throw requisicaoInvalida('Quantidade em peças (UN) precisa ser inteira.');
    if (compararQuantidades(qtd, saldo.quantidade.toFixed()) > 0) {
      throw new ErroHttp(409, 'QUANTIDADE_INDISPONIVEL', `A quantidade conferida (${qtd}) passa do saldo validado do material no palete (${normalizarQuantidade(saldo.quantidade.toFixed())} ${saldo.segmento.unidade}).`);
    }
    if (dados.sessionId) {
      const sessao = await tx.sessaoConferencia.findFirst({ where: { id: dados.sessionId, escopoId: escopo.id, paleteId: palete.id }, select: { id: true, numero: true, situacao: true } });
      if (!sessao) throw naoEncontrado('Conferência não encontrada neste palete.');
      sessaoId = sessao.id;
      retrato = { ...retrato, conferencia: { numero: sessao.numero, situacao: sessao.situacao } };
    }
    quantidade = qtd;
    unidade = saldo.segmento.unidade;
    condicao = saldo.segmento.condicao;
    posicao = palete.posicao?.codigo ?? null;
    const verificacao = verificarMaterial(regraDe(linha), caso.motivo, {
      produtoId: saldo.segmento.produtoId,
      sku: saldo.segmento.produto.sku,
      unidade: saldo.segmento.unidade,
      lote: saldo.segmento.lote,
      origemTipo: saldo.segmento.origemTipo,
      origemReferencia: saldo.segmento.origemReferencia,
      condicao: saldo.segmento.condicao,
    });
    retrato = {
      ...retrato,
      palete: { codigo: palete.codigo, posicao, versaoSaldo: palete.versaoSaldo },
      material: {
        sku: saldo.segmento.produto.sku,
        lote: saldo.segmento.lote,
        origemTipo: saldo.segmento.origemTipo,
        origemReferencia: saldo.segmento.origemReferencia,
        condicao: saldo.segmento.condicao,
        unidade: saldo.segmento.unidade,
        linhagem: saldo.segmento.linhagem,
      },
      saldo: {
        quantidade: normalizarQuantidade(saldo.quantidade.toFixed()),
        reservada: normalizarQuantidade(saldo.quantidadeReservada.toFixed()),
        vinculada: normalizarQuantidade(saldo.quantidadeVinculada.toFixed()),
        versao: saldo.versao,
      },
      verificacao: { ...verificacao.checks, bloqueios: verificacao.bloqueios, lote: verificacao.bloqueioLote },
    };
  } else if (dados.type === 'DOCUMENTO') {
    const ld = await tx.linhaDocumentoDevolucao.findFirst({ where: { id: dados.documentLineId ?? '', escopoId: escopo.id }, include: { documento: { select: { referencia: true } } } });
    if (!ld) throw naoEncontrado('Linha de documento não encontrada neste escopo.');
    linhaDocumentoId = ld.id;
    retrato = {
      ...retrato,
      documento: { referencia: ld.documento.referencia, linha: ld.referenciaLinha, sku: ld.sku, lote: ld.lote, nf: ld.notaFiscal, quantidade: ld.quantidadeCanonica.toFixed(), unidade: ld.unidadeCanonica },
      nota: 'Documento registrado: não comprova recebimento físico.',
    };
    quantidade = quantidade === null ? null : normalizarQuantidade(quantidade);
    unidade = quantidade === null ? null : linha.unidade;
  } else {
    quantidade = quantidade === null ? null : normalizarQuantidade(quantidade);
    unidade = quantidade === null ? null : linha.unidade;
  }

  const [ultimo] = await tx.$queryRaw<{ n: number }[]>`SELECT coalesce(max(numero), 0)::int AS n FROM evidencia_claim WHERE claim_id = ${claimId}::uuid`;
  const numero = (ultimo?.n ?? 0) + 1;
  const id = randomUUID();
  await tx.evidenciaClaim.create({
    data: {
      id,
      escopoId: escopo.id,
      claimId,
      linhaId: linha.id,
      numero,
      tipo: dados.type,
      situacao: 'REGISTRADA',
      candidatoId: dados.candidateId ?? null,
      paleteId,
      posicaoNaEpoca: posicao,
      segmentoId,
      sessaoId,
      linhaDocumentoId,
      quantidade,
      unidade,
      condicao,
      descricao: dados.description,
      referenciaVerificavel: dados.verifiableReference ?? null,
      retrato: json(retrato),
      autorId: autor.usuarioId,
      registradaEm: agora,
    },
  });
  if (dados.attachmentIds.length > 0) await tx.anexoClaim.updateMany({ where: { id: { in: dados.attachmentIds }, claimId }, data: { evidenciaId: id } });
  await tx.claim.update({ where: { id: claimId }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    linhaId: linha.id,
    tipo: 'EVIDENCIA_REGISTRADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Evidência E${String(numero)} (${dados.type}) registrada${quantidade ? `: ${quantidade} ${unidade ?? ''}` : ''}${posicao ? ` no endereço ${posicao}` : ''}.`,
    relacionadoId: id,
    detalhes: { numero, tipo: dados.type, quantidade, unidade, posicao, anexos: dados.attachmentIds.length },
  });
  await registrarEvento(tx, {
    acao: 'CLAIM_EVIDENCIA_REGISTRADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo, evidencia: numero, tipo: dados.type },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, claimId, agora);
}

async function evidenciaDoCaso(tx: Transacao, escopoId: string, claimId: string, id: string) {
  const e = await tx.evidenciaClaim.findFirst({ where: { id, claimId, escopoId } });
  if (!e) throw naoEncontrado('Evidência não encontrada neste claim.');
  return e;
}

interface Retrato {
  linha?: { versaoLinha?: number };
  saldo?: { versao?: number };
}

/** Verificações comuns à solicitação e à validação, contra o estado atual (dentro dos bloqueios de quem chama). */
async function verificarRecuperacao(
  tx: Transacao,
  escopoId: string,
  motivo: 'EXTRAVIO_FALTA' | 'AVARIA' | 'DIVERGENCIA_DOCUMENTAL',
  e: Awaited<ReturnType<typeof evidenciaDoCaso>>,
  linha: Awaited<ReturnType<typeof linhaDoCaso>>,
  quantidade: string,
  tratativaLote: string | null,
): Promise<{ elegivel: string; restante: string; saldoVersao: number }> {
  if (e.tipo !== 'MATERIAL_CONFERIDO' || e.paleteId === null || e.segmentoId === null) {
    throw new ErroHttp(409, 'RECUPERACAO_BLOQUEADA', 'Só evidência de material conferido (saldo validado do palete) sustenta recuperação física. Documento, NF ou descrição apoiam a investigação, mas não comprovam presença.');
  }
  const retrato = e.retrato as Retrato;
  if (retrato.linha?.versaoLinha !== linha.versao) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `Os dados da linha ${linha.identificador} mudaram depois da evidência E${String(e.numero)}: registre nova evidência com os dados atuais.`);
  }
  const palete = await tx.palete.findFirst({ where: { id: e.paleteId, escopoId }, select: { codigo: true, arquivadoEm: true } });
  if (palete?.arquivadoEm !== null) throw new ErroHttp(409, 'RECUPERACAO_BLOQUEADA', 'O palete da evidência foi arquivado: a quantidade não pode ser validada nele.');
  const ativa = await tx.sessaoConferencia.count({ where: { paleteId: e.paleteId, ativa: true } });
  if (ativa > 0) throw new ErroHttp(409, 'RECUPERACAO_BLOQUEADA', `Há conferência em andamento no palete ${palete.codigo}: aguarde a conclusão e a reconciliação.`);
  const saldo = await tx.saldoEstoque.findFirst({
    where: { paleteId: e.paleteId, segmentoId: e.segmentoId, escopoId },
    include: { segmento: { include: { produto: { select: { sku: true } } } } },
  });
  if (!saldo) {
    throw new ErroHttp(409, 'RECUPERACAO_BLOQUEADA', `O palete ${palete.codigo} não tem mais saldo validado deste material (movido, ajustado ou expedido). Localize o material atual e registre nova evidência.`);
  }
  if (retrato.saldo?.versao !== saldo.versao) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `O saldo do material no palete ${palete.codigo} mudou depois da evidência E${String(e.numero)} (reconciliação ou transferência). Confira de novo e registre nova evidência.`);
  }
  const v = verificarMaterial(regraDe(linha), motivo, {
    produtoId: saldo.segmento.produtoId,
    sku: saldo.segmento.produto.sku,
    unidade: saldo.segmento.unidade,
    lote: saldo.segmento.lote,
    origemTipo: saldo.segmento.origemTipo,
    origemReferencia: saldo.segmento.origemReferencia,
    condicao: saldo.segmento.condicao,
  });
  if (linha.produto && linha.produto.unidadeCanonica !== linha.unidade) {
    v.bloqueios.push(`Unidade da linha (${linha.unidade}) diferente da unidade canônica do produto (${linha.produto.unidadeCanonica}).`);
  }
  if (v.bloqueios.length > 0) throw new ErroHttp(409, 'RECUPERACAO_BLOQUEADA', `Validação bloqueada: ${v.bloqueios.join(' ')}`);
  if (v.bloqueioLote !== null && (tratativaLote === null || tratativaLote.length < 10)) {
    throw new ErroHttp(409, 'RECUPERACAO_BLOQUEADA', `Validação bloqueada: ${v.bloqueioLote} Registre a tratativa documentada do lote para validar.`);
  }
  const q = normalizarQuantidade(quantidade);
  if (compararQuantidades(q, '0') <= 0) throw requisicaoInvalida('A quantidade precisa ser maior que zero.');
  if (saldo.segmento.unidade === UNIDADE_PECA && !ehQuantidadeInteira(q)) throw requisicaoInvalida('Quantidade em peças (UN) precisa ser inteira.');
  const elegivel = subtrairQuantidades(subtrairQuantidades(saldo.quantidade.toFixed(), saldo.quantidadeReservada.toFixed()), saldo.quantidadeVinculada.toFixed());
  const restante = subtrairQuantidades(linha.quantidadeAnalise.toFixed(), linha.quantidadeRecuperada.toFixed());
  if (compararQuantidades(q, elegivel) > 0) {
    throw new ErroHttp(
      409,
      'QUANTIDADE_INDISPONIVEL',
      `Quantidade acima do elegível do material no palete ${palete.codigo}: elegível ${normalizarQuantidade(compararQuantidades(elegivel, '0') > 0 ? elegivel : '0')} ${saldo.segmento.unidade} (saldo ${normalizarQuantidade(saldo.quantidade.toFixed())} − reservado ${normalizarQuantidade(saldo.quantidadeReservada.toFixed())} − vinculado a recuperações ${normalizarQuantidade(saldo.quantidadeVinculada.toFixed())}). A mesma quantidade física não sustenta duas recuperações.`,
    );
  }
  if (compararQuantidades(q, restante) > 0) {
    throw new ErroHttp(
      409,
      'QUANTIDADE_INDISPONIVEL',
      `Quantidade acima do restante da linha ${linha.identificador}: ${normalizarQuantidade(restante)} ${linha.unidade} sem recuperação validada (em análise ${normalizarQuantidade(linha.quantidadeAnalise.toFixed())}).`,
    );
  }
  return { elegivel, restante, saldoVersao: saldo.versao };
}

export async function solicitarValidacao(
  tx: Transacao,
  escopo: Escopo,
  claimId: string,
  evidenciaId: string,
  dados: z.output<typeof SolicitarValidacaoSchema>,
  autor: Autor,
  agora: Date,
): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'validações não são solicitadas');
  const e = await evidenciaDoCaso(tx, escopo.id, claimId, evidenciaId);
  if (e.versao !== dados.expectedVersion) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'A evidência foi alterada em outra tela. Recarregue.');
  if (e.situacao !== 'REGISTRADA') throw new ErroHttp(409, 'CONFLITO', `A evidência E${String(e.numero)} já foi enviada para validação.`);
  const linha = await linhaDoCaso(tx, escopo.id, claimId, e.linhaId, false);
  const q = normalizarQuantidade(dados.quantity);
  if (e.quantidade !== null && compararQuantidades(q, e.quantidade.toFixed()) > 0) {
    throw requisicaoInvalida(`A quantidade solicitada passa da quantidade conferida na evidência (${normalizarQuantidade(e.quantidade.toFixed())}).`);
  }
  // Verificação antecipada (sem alocar): bloqueios conhecidos já voltam agora; lote divergente vai ao validador.
  await verificarRecuperacao(tx, escopo.id, caso.motivo, e, linha, q, 'tratativa a definir pelo validador');
  await tx.evidenciaClaim.update({
    where: { id: e.id },
    data: { situacao: 'VALIDACAO_SOLICITADA', quantidadeSolicitada: q, notaSolicitacao: dados.note ?? null, solicitadaPorId: autor.usuarioId, solicitadaEm: agora, versao: { increment: 1 } },
  });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    linhaId: linha.id,
    tipo: 'VALIDACAO_SOLICITADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Validação solicitada: ${q} ${linha.unidade} pela evidência E${String(e.numero)}.`,
    relacionadoId: e.id,
    detalhes: { evidencia: e.numero, quantidade: q, unidade: linha.unidade },
  });
  if (caso.situacao !== 'VALIDACAO_PENDENTE') {
    await gravarSituacao(tx, escopo.id, caso, 'VALIDACAO_PENDENTE', 'Validação de recuperação solicitada.', autor, agora);
  } else {
    await tx.claim.update({ where: { id: claimId }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
  }
  await registrarEvento(tx, {
    acao: 'CLAIM_VALIDACAO_SOLICITADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo, evidencia: e.numero, quantidade: q },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, claimId, agora);
}

async function situacaoDepoisDaDecisao(tx: Transacao, escopoId: string, caso: Awaited<ReturnType<typeof bloquearCaso>>, autor: Autor, agora: Date): Promise<void> {
  const restantes = await tx.evidenciaClaim.count({ where: { claimId: caso.id, situacao: 'VALIDACAO_SOLICITADA' } });
  const para = situacaoAposDecisao(restantes);
  if (para !== caso.situacao) await gravarSituacao(tx, escopoId, caso, para, 'Validação decidida.', autor, agora);
  else await tx.claim.update({ where: { id: caso.id }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
}

export async function validarRecuperacao(
  tx: Transacao,
  escopo: Escopo,
  claimId: string,
  evidenciaId: string,
  dados: z.output<typeof ValidarRecuperacaoSchema>,
  autor: Autor,
  agora: Date,
): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'recuperações não são validadas');
  const e = await evidenciaDoCaso(tx, escopo.id, claimId, evidenciaId);
  if (e.versao !== dados.expectedVersion) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'A evidência mudou desde a sua revisão (outra decisão ou solicitação). Recarregue antes de decidir.');
  if (e.situacao !== 'VALIDACAO_SOLICITADA' || e.quantidadeSolicitada === null) throw new ErroHttp(409, 'CONFLITO', `A evidência E${String(e.numero)} não está aguardando validação.`);
  const linha = await linhaDoCaso(tx, escopo.id, claimId, e.linhaId, true);
  if (e.paleteId === null || e.segmentoId === null) throw new ErroHttp(409, 'RECUPERACAO_BLOQUEADA', 'Evidência sem material conferido.');
  // Bloqueios na ordem fixa: palete → linha de saldo (concorrentes esperam e reavaliam).
  await tx.$queryRaw`SELECT id FROM palete WHERE id = ${e.paleteId}::uuid AND escopo_id = ${escopo.id}::uuid FOR UPDATE`;
  await bloquearSaldos(tx, escopo.id, [e.paleteId]);
  const q = normalizarQuantidade(dados.quantity);
  if (compararQuantidades(q, e.quantidadeSolicitada.toFixed()) > 0) {
    throw requisicaoInvalida(`A quantidade validada passa da solicitada (${normalizarQuantidade(e.quantidadeSolicitada.toFixed())}).`);
  }
  const tratativa = dados.lotTreatment ?? null;
  const { restante } = await verificarRecuperacao(tx, escopo.id, caso.motivo, e, linha, q, tratativa);
  const palete = await tx.palete.findUniqueOrThrow({ where: { id: e.paleteId }, select: { codigo: true, posicao: { select: { codigo: true } } } });

  await tx.evidenciaClaim.update({
    where: { id: e.id },
    data: { situacao: 'VALIDADA', decididaPorId: autor.usuarioId, decididaEm: agora, justificativaDecisao: dados.justification, versao: { increment: 1 } },
  });
  const recuperacaoId = randomUUID();
  await tx.recuperacaoClaim.create({
    data: {
      id: recuperacaoId,
      escopoId: escopo.id,
      claimId,
      linhaId: linha.id,
      evidenciaId: e.id,
      segmentoId: e.segmentoId,
      paleteId: e.paleteId,
      posicaoNaEpoca: palete.posicao?.codigo ?? null,
      quantidade: q,
      unidade: linha.unidade,
      situacao: 'ATIVA',
      validadaPorId: autor.usuarioId,
      validadaEm: agora,
      justificativa: dados.justification,
      tratativaLote: tratativa,
      retrato: json({ evidencia: e.numero, retratoEvidencia: e.retrato, solicitada: e.quantidadeSolicitada.toFixed(), palete: palete.codigo }),
    },
  });
  await tx.vinculoMaterialClaim.create({
    data: { id: randomUUID(), escopoId: escopo.id, recuperacaoId, paleteId: e.paleteId, segmentoId: e.segmentoId, quantidade: q, atualizadoEm: agora },
  });
  await tx.$executeRaw`
    UPDATE saldo_estoque SET quantidade_vinculada = quantidade_vinculada + ${q}::numeric
     WHERE escopo_id = ${escopo.id}::uuid AND palete_id = ${e.paleteId}::uuid AND segmento_id = ${e.segmentoId}::uuid`;
  await tx.$executeRaw`
    UPDATE linha_claim SET quantidade_recuperada = quantidade_recuperada + ${q}::numeric, atualizado_em = ${agora}
     WHERE id = ${linha.id}::uuid`;
  const sem = normalizarQuantidade(subtrairQuantidades(restante, q));
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    linhaId: linha.id,
    tipo: 'RECUPERACAO_VALIDADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Recuperação física validada: ${q} ${linha.unidade} (evidência E${String(e.numero)}, palete ${palete.codigo}). Linha ${linha.identificador}: ${sem} ${linha.unidade} sem recuperação física validada.`,
    relacionadoId: recuperacaoId,
    detalhes: { evidencia: e.numero, quantidade: q, palete: palete.codigo, restante: sem, tratativaLote: tratativa !== null },
  });
  await situacaoDepoisDaDecisao(tx, escopo.id, caso, autor, agora);
  await registrarEvento(tx, {
    acao: 'CLAIM_RECUPERACAO_VALIDADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo, evidencia: e.numero, quantidade: q, palete: palete.codigo, recuperacao: recuperacaoId },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, claimId, agora);
}

export async function rejeitarValidacao(
  tx: Transacao,
  escopo: Escopo,
  claimId: string,
  evidenciaId: string,
  dados: z.output<typeof RejeitarValidacaoSchema>,
  autor: Autor,
  agora: Date,
): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'validações não são decididas');
  const e = await evidenciaDoCaso(tx, escopo.id, claimId, evidenciaId);
  if (e.versao !== dados.expectedVersion) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'A evidência mudou desde a sua revisão. Recarregue antes de decidir.');
  if (e.situacao !== 'VALIDACAO_SOLICITADA') throw new ErroHttp(409, 'CONFLITO', `A evidência E${String(e.numero)} não está aguardando validação.`);
  await tx.evidenciaClaim.update({
    where: { id: e.id },
    data: { situacao: 'REJEITADA', decididaPorId: autor.usuarioId, decididaEm: agora, justificativaDecisao: dados.justification, versao: { increment: 1 } },
  });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    linhaId: e.linhaId,
    tipo: 'VALIDACAO_REJEITADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Validação da evidência E${String(e.numero)} rejeitada: ${dados.justification}`,
    relacionadoId: e.id,
    detalhes: { evidencia: e.numero },
  });
  await situacaoDepoisDaDecisao(tx, escopo.id, caso, autor, agora);
  await registrarEvento(tx, {
    acao: 'CLAIM_VALIDACAO_REJEITADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo, evidencia: e.numero },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, claimId, agora);
}

/**
 * Estorno (correção) de recuperação validada: evento vinculado à original,
 * com motivo; libera a alocação do material onde ela estiver agora. Bloqueado
 * se um resultado vigente cita a evidência (corrija ou anule o resultado
 * antes). Não altera estoque.
 */
export async function estornarRecuperacao(
  tx: Transacao,
  escopo: Escopo,
  claimId: string,
  recuperacaoId: string,
  dados: z.output<typeof EstornarRecuperacaoSchema>,
  autor: Autor,
  agora: Date,
): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, claimId);
  exigirAberto(caso, 'recuperações não são estornadas');
  const r = await tx.recuperacaoClaim.findFirst({ where: { id: recuperacaoId, claimId, escopoId: escopo.id }, include: { evidencia: { select: { numero: true } } } });
  if (!r) throw naoEncontrado('Recuperação não encontrada neste claim.');
  if (r.versao !== dados.expectedVersion) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'A recuperação mudou desde a sua revisão. Recarregue.');
  if (r.situacao !== 'ATIVA') throw new ErroHttp(409, 'CONFLITO', 'Esta recuperação já foi estornada.');
  const dependentes = await tx.$queryRaw<{ numero: number }[]>`
    SELECT numero FROM resultado_claim
     WHERE claim_id = ${claimId}::uuid AND situacao::text = 'VIGENTE' AND evidencias @> ${JSON.stringify([r.evidenciaId])}::jsonb`;
  if (dependentes.length > 0) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      `O resultado R${String(dependentes[0]?.numero ?? '')} cita a evidência desta recuperação: corrija ou anule o resultado (perfil com aprovação financeira) antes do estorno.`,
    );
  }
  await linhaDoCaso(tx, escopo.id, claimId, r.linhaId, true);
  // Paletes onde o vínculo está agora, bloqueados na ordem fixa; relidos depois dos bloqueios.
  let paletes: string[] = [];
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const atuais = (await tx.vinculoMaterialClaim.findMany({ where: { recuperacaoId: r.id }, select: { paleteId: true } })).map((v) => v.paleteId).sort();
    const novos = atuais.filter((p) => !paletes.includes(p));
    if (novos.length === 0 && tentativa > 0) break;
    paletes = [...new Set([...paletes, ...atuais])].sort();
    await tx.$queryRaw`SELECT id FROM palete WHERE escopo_id = ${escopo.id}::uuid AND id = ANY(${paletes}::uuid[]) ORDER BY id FOR UPDATE`;
    await bloquearSaldos(tx, escopo.id, paletes);
  }
  const ativas = await tx.sessaoConferencia.count({ where: { paleteId: { in: paletes }, ativa: true } });
  if (ativas > 0) throw new ErroHttp(409, 'CONFLITO', 'Há conferência em andamento num palete com o material vinculado: aguarde a conclusão para estornar.');
  const vinculos = await tx.$queryRaw<{ id: string; palete_id: string; segmento_id: string; quantidade: string }[]>`
    SELECT id::text, palete_id::text, segmento_id::text, quantidade::text FROM vinculo_material_claim WHERE recuperacao_id = ${r.id}::uuid FOR UPDATE`;
  for (const v of vinculos) {
    await tx.$executeRaw`
      UPDATE saldo_estoque SET quantidade_vinculada = quantidade_vinculada - ${v.quantidade}::numeric
       WHERE palete_id = ${v.palete_id}::uuid AND segmento_id = ${v.segmento_id}::uuid`;
    await tx.vinculoMaterialClaim.delete({ where: { id: v.id } });
  }
  const q = normalizarQuantidade(r.quantidade.toFixed());
  await tx.recuperacaoClaim.update({
    where: { id: r.id },
    data: { situacao: 'ESTORNADA', estornadaPorId: autor.usuarioId, estornadaEm: agora, motivoEstorno: dados.reason, versao: { increment: 1 } },
  });
  await tx.$executeRaw`
    UPDATE linha_claim SET quantidade_recuperada = quantidade_recuperada - ${q}::numeric, atualizado_em = ${agora} WHERE id = ${r.linhaId}::uuid`;
  await tx.claim.update({ where: { id: claimId }, data: { versao: { increment: 1 }, atualizadoEm: agora } });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId,
    linhaId: r.linhaId,
    tipo: 'RECUPERACAO_ESTORNADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Recuperação de ${q} ${r.unidade} (evidência E${String(r.evidencia.numero)}) estornada: ${dados.reason}. A quantidade volta a ficar sem recuperação validada e o material deixa de estar vinculado.`,
    relacionadoId: r.id,
    detalhes: { quantidade: q, evidencia: r.evidencia.numero, motivo: dados.reason },
  });
  await registrarEvento(tx, {
    acao: 'CLAIM_RECUPERACAO_ESTORNADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: claimId,
    detalhes: { codigo: caso.codigo, recuperacao: r.id, quantidade: q },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, claimId, agora);
}
