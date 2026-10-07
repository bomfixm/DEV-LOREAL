/**
 * Cadastro, edição e situação dos claims (etapa 07). Toda mutação roda na
 * transação da idempotência, com o caso bloqueado (FOR UPDATE) e versão
 * conferida; histórico do caso e auditoria na mesma transação.
 *
 * Ordem de bloqueio do módulo (igual em todas as operações, sem impasse com
 * as movimentações da etapa 05, que nunca bloqueiam claims):
 *   1. caso (claim) → 2. linhas do caso → 3. paletes (ordem de ID) →
 *   4. linhas de saldo → 5. vínculos de material.
 */
import {
  SITUACOES_FINAIS_CLAIM,
  compararQuantidades,
  normalizarQuantidade,
  normalizarValor,
  situacaoFinal,
  type AlterarClaimSchema,
  type ClaimDetalhe,
  type CriarClaimSchema,
  type EncerrarClaimSchema,
  type Escopo,
  type LinhaClaimEntradaSchema,
  type ReabrirClaimSchema,
  type SituacaoClaim,
  type TransicaoClaimSchema,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica } from '../../db/erros.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { chaveLinhaDocumento } from '../importacao/interpretar.js';
import { registrarEventoClaim } from './historico.js';
import { detalheClaim, PERFIS_RESPONSAVEIS } from './leitura.js';

export interface Autor {
  usuarioId: string;
  requestId: string;
}

type DadosCriar = z.output<typeof CriarClaimSchema>;
type DadosAlterar = z.output<typeof AlterarClaimSchema>;
type DadosLinha = z.output<typeof LinhaClaimEntradaSchema>;

export interface CasoTravado {
  id: string;
  codigo: string;
  situacao: SituacaoClaim;
  versao: number;
  motivo: 'EXTRAVIO_FALTA' | 'AVARIA' | 'DIVERGENCIA_DOCUMENTAL';
  moeda: string | null;
  cobranca_finalizada: boolean;
}

/** Bloqueia o caso (FOR UPDATE). Caso de outro escopo responde como inexistente. */
export async function bloquearCaso(tx: Transacao, escopoId: string, id: string): Promise<CasoTravado> {
  const [caso] = await tx.$queryRaw<CasoTravado[]>`
    SELECT id::text, codigo, situacao::text AS situacao, versao, motivo::text AS motivo, moeda, cobranca_finalizada
      FROM claim WHERE id = ${id}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!caso) throw naoEncontrado('Claim não encontrado neste escopo.');
  return caso;
}

export function exigirAberto(caso: CasoTravado, acao: string): void {
  if (situacaoFinal(caso.situacao)) {
    throw new ErroHttp(409, 'CONFLITO', `O caso ${caso.codigo} está encerrado: ${acao}. Reabra o caso (com motivo) antes.`);
  }
}

export function exigirVersaoCaso(caso: CasoTravado, esperada: number): void {
  if (caso.versao !== esperada) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `O caso ${caso.codigo} foi alterado desde a sua revisão. Os dados atuais foram recarregados: revise antes de repetir.`);
  }
}

/** Próximo número do caso no escopo (criações concorrentes esperam). */
export async function proximoNumero(tx: Transacao, escopoId: string): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`claim:${escopoId}`}, 0))`;
  const [linha] = await tx.$queryRaw<{ n: number }[]>`SELECT coalesce(max(numero), 0)::int + 1 AS n FROM claim WHERE escopo_id = ${escopoId}::uuid`;
  return linha?.n ?? 1;
}

export const codigoClaim = (numero: number) => `CLM-${String(numero).padStart(6, '0')}`;

/** Responsável: usuário ativo do escopo com perfil que trata claims (a referência não amplia escopo). */
export async function exigirResponsavel(tx: Transacao, escopoId: string, responsavelId: string | null): Promise<void> {
  if (responsavelId === null) return;
  const vinculo = await tx.vinculo.findFirst({
    where: { escopoId, usuarioId: responsavelId, ativo: true, perfil: { in: [...PERFIS_RESPONSAVEIS] }, usuario: { ativo: true } },
    select: { id: true },
  });
  if (!vinculo) throw requisicaoInvalida('O responsável precisa ser um usuário ativo deste escopo com acesso para tratar claims.');
}

/** Produtos do cadastro pelo SKU exato (texto). SKU fora do cadastro fica pendente na linha. */
export async function produtosPorSku(tx: Transacao, escopoId: string, skus: readonly string[]): Promise<Map<string, { id: string; unidade: string }>> {
  if (skus.length === 0) return new Map();
  const produtos = await tx.produto.findMany({ where: { escopoId, sku: { in: [...new Set(skus)] } }, select: { id: true, sku: true, unidadeCanonica: true } });
  return new Map(produtos.map((p) => [p.sku, { id: p.id, unidade: p.unidadeCanonica }]));
}

function dataOuNulo(texto: string | null | undefined): Date | null {
  return texto ? new Date(`${texto}T00:00:00.000Z`) : null;
}

function dadosLinha(l: DadosLinha, produtos: Map<string, { id: string }>) {
  return {
    identificador: l.lineRef,
    chaveLinha: chaveLinhaDocumento(l.lineRef),
    produtoId: produtos.get(l.sku)?.id ?? null,
    sku: l.sku,
    descricao: l.description ?? null,
    quantidadeAnalise: normalizarQuantidade(l.quantity),
    unidade: l.unit,
    lote: l.lot ?? null,
    loteExigido: l.lotRequired,
    origemTipo: l.originType ?? null,
    origemReferencia: l.originReference ?? null,
    origemLinha: l.originLine ?? null,
    valorEstimado: l.estimatedValue ?? null,
    baseValor: l.valueBase ?? null,
  };
}

function cabecalho(d: DadosCriar | DadosAlterar) {
  return {
    referenciaExterna: d.externalReference ?? null,
    motivo: d.reason,
    prioridade: d.priority ?? null,
    prazo: dataOuNulo(d.deadline),
    dataAbertura: dataOuNulo(d.openedOn),
    dataOcorrencia: dataOuNulo(d.occurredOn),
    responsavelId: d.responsibleId ?? null,
    moeda: d.currency ?? null,
    fonteValor: d.valueSource ?? null,
    situacaoExterna: d.externalStatus ?? null,
    referenciaCobranca: d.chargeReference ?? null,
    cobrancaFinalizada: d.chargeFinalized,
    observacoes: d.notes ?? null,
  };
}

async function exigirReferenciaLivre(tx: Transacao, escopoId: string, referencia: string | null, outroQue: string | null): Promise<void> {
  if (referencia === null) return;
  const existente = await tx.claim.findFirst({ where: { escopoId, referenciaExterna: referencia, ...(outroQue ? { id: { not: outroQue } } : {}) }, select: { codigo: true } });
  if (existente) throw new ErroHttp(409, 'CONFLITO', `Já existe o claim ${existente.codigo} com a referência externa ${referencia} neste escopo: abra o caso existente.`);
}

/** Unidade em peças: quantidade inteira (R03). */
function exigirQuantidadesValidas(linhas: readonly DadosLinha[]): void {
  for (const l of linhas) {
    if (l.unit === 'UN' && !/^\d+$/.test(normalizarQuantidade(l.quantity))) {
      throw requisicaoInvalida(`Linha ${l.lineRef}: quantidade em peças (UN) precisa ser inteira.`);
    }
  }
}

export async function criarClaim(tx: Transacao, escopo: Escopo, dados: DadosCriar, autor: Autor, agora: Date): Promise<ClaimDetalhe> {
  exigirQuantidadesValidas(dados.lines);
  await exigirResponsavel(tx, escopo.id, dados.responsibleId ?? null);
  await exigirReferenciaLivre(tx, escopo.id, dados.externalReference ?? null, null);
  const chaves = new Set<string>();
  for (const l of dados.lines) {
    const chave = chaveLinhaDocumento(l.lineRef);
    if (chaves.has(chave)) throw requisicaoInvalida(`Linha ${l.lineRef} repetida no caso.`);
    chaves.add(chave);
  }
  const numero = await proximoNumero(tx, escopo.id);
  const produtos = await produtosPorSku(tx, escopo.id, dados.lines.map((l) => l.sku));
  const id = randomUUID();
  try {
    await tx.claim.create({
      data: {
        id,
        escopoId: escopo.id,
        numero,
        codigo: codigoClaim(numero),
        ...cabecalho(dados),
        situacao: 'EM_ANALISE',
        origemCadastro: 'MANUAL',
        criadoPorId: autor.usuarioId,
        criadoEm: agora,
        atualizadoEm: agora,
      },
    });
  } catch (erro) {
    if (ehViolacaoUnica(erro)) throw new ErroHttp(409, 'CONFLITO', 'Outro claim com a mesma referência externa acabou de ser registrado. Recarregue a lista.');
    throw erro;
  }
  await tx.linhaClaim.createMany({
    data: dados.lines.map((l, i) => ({ id: randomUUID(), escopoId: escopo.id, claimId: id, ordem: i + 1, criadoEm: agora, atualizadoEm: agora, ...dadosLinha(l, produtos) })),
  });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId: id,
    tipo: 'CASO_CRIADO',
    autorId: autor.usuarioId,
    agora,
    resumo: `Caso ${codigoClaim(numero)} registrado com ${String(dados.lines.length)} linha(s).`,
    detalhes: { motivo: dados.reason, linhas: dados.lines.length, referenciaExterna: dados.externalReference ?? null },
  });
  await registrarEvento(tx, {
    acao: 'CLAIM_CRIADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: id,
    detalhes: { codigo: codigoClaim(numero), motivo: dados.reason, linhas: dados.lines.length },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, id, agora);
}

const ROTULOS_CAMPO: Record<string, string> = {
  referenciaExterna: 'referência externa',
  motivo: 'motivo',
  prioridade: 'prioridade',
  prazo: 'prazo',
  dataAbertura: 'data de abertura',
  dataOcorrencia: 'data da ocorrência',
  responsavelId: 'responsável',
  moeda: 'moeda',
  fonteValor: 'fonte do valor',
  situacaoExterna: 'situação externa',
  referenciaCobranca: 'referência da cobrança',
  cobrancaFinalizada: 'cobrança finalizada',
  observacoes: 'observações',
  sku: 'SKU',
  descricao: 'descrição',
  quantidadeAnalise: 'quantidade',
  unidade: 'unidade',
  lote: 'lote',
  loteExigido: 'lote exigido',
  origemTipo: 'tipo da origem',
  origemReferencia: 'origem',
  origemLinha: 'linha da origem',
  valorEstimado: 'valor estimado',
  baseValor: 'base do valor',
  produtoId: 'produto',
};

function comparavel(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'toFixed' in v && typeof (v).toFixed === 'function') return (v as { toFixed: () => string }).toFixed();
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function normalizarComparacao(campo: string, valor: string): string {
  if (valor === '') return '';
  if (campo === 'quantidadeAnalise') return normalizarQuantidade(valor);
  if (campo === 'valorEstimado') return normalizarValor(valor);
  return valor;
}

function diferencas(antes: Record<string, unknown>, depois: Record<string, unknown>): string[] {
  return Object.keys(depois).filter((k) => normalizarComparacao(k, comparavel(antes[k])) !== normalizarComparacao(k, comparavel(depois[k])));
}

/** Campos que sustentam recuperações e resultados: não mudam depois deles. */
const CAMPOS_PROTEGIDOS = ['produtoId', 'sku', 'unidade', 'lote', 'loteExigido', 'origemTipo', 'origemReferencia', 'origemLinha'];

export async function alterarClaim(tx: Transacao, escopo: Escopo, id: string, dados: DadosAlterar, autor: Autor, agora: Date): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, id);
  exigirAberto(caso, 'os dados não mudam');
  exigirVersaoCaso(caso, dados.expectedVersion);
  exigirQuantidadesValidas(dados.lines);
  await exigirResponsavel(tx, escopo.id, dados.responsibleId ?? null);
  await exigirReferenciaLivre(tx, escopo.id, dados.externalReference ?? null, id);
  const atual = await tx.claim.findUniqueOrThrow({ where: { id } });
  await tx.$queryRaw`SELECT id FROM linha_claim WHERE claim_id = ${id}::uuid ORDER BY id FOR UPDATE`;
  const existentes = await tx.linhaClaim.findMany({ where: { claimId: id }, orderBy: { ordem: 'asc' } });
  const porId = new Map(existentes.map((l) => [l.id, l]));
  const informadas = new Set(dados.lines.flatMap((l) => (l.id ? [l.id] : [])));
  for (const l of existentes) {
    if (!informadas.has(l.id)) throw requisicaoInvalida(`A linha ${l.identificador} não foi enviada: linhas de claim não são apagadas (corrija os dados dela).`);
  }
  const chaves = new Map(existentes.map((l) => [l.chaveLinha, l.id]));
  const produtos = await produtosPorSku(tx, escopo.id, dados.lines.map((l) => l.sku));

  const alteracoes: string[] = [];
  const novoCabecalho = cabecalho(dados);
  const mudouCabecalho = diferencas(atual, novoCabecalho);
  alteracoes.push(...mudouCabecalho.map((c) => ROTULOS_CAMPO[c] ?? c));
  if (mudouCabecalho.includes('motivo') && (await tx.recuperacaoClaim.count({ where: { claimId: id, situacao: 'ATIVA' } })) > 0) {
    throw new ErroHttp(409, 'CONFLITO', 'O motivo não muda depois de recuperação validada: estorne as recuperações (com motivo) ou registre a decisão.');
  }

  let ordem = existentes.reduce((m, l) => Math.max(m, l.ordem), 0);
  for (const l of dados.lines) {
    const novo = dadosLinha(l, produtos);
    if (l.id === undefined) {
      if (chaves.has(novo.chaveLinha)) throw requisicaoInvalida(`A linha ${l.lineRef} já existe no caso.`);
      ordem += 1;
      const linhaId = randomUUID();
      chaves.set(novo.chaveLinha, linhaId);
      await tx.linhaClaim.create({ data: { id: linhaId, escopoId: escopo.id, claimId: id, ordem, criadoEm: agora, atualizadoEm: agora, ...novo } });
      alteracoes.push(`linha ${l.lineRef} acrescentada`);
      await registrarEventoClaim(tx, {
        escopoId: escopo.id,
        claimId: id,
        linhaId,
        tipo: 'CASO_ALTERADO',
        autorId: autor.usuarioId,
        agora,
        resumo: `Linha ${l.lineRef} acrescentada (${novo.sku}, ${novo.quantidadeAnalise} ${novo.unidade}).`,
        detalhes: { motivo: dados.reasonForChange },
      });
      continue;
    }
    const antes = porId.get(l.id);
    if (!antes) throw requisicaoInvalida('Linha informada não pertence a este caso.');
    if (antes.chaveLinha !== novo.chaveLinha) throw requisicaoInvalida(`A identidade da linha ${antes.identificador} não muda.`);
    const { identificador: _i, chaveLinha: _c, ...comparar } = novo;
    const mudou = diferencas(antes, comparar);
    if (mudou.length === 0) continue;
    const recuperada = antes.quantidadeRecuperada.toFixed();
    const coberta = antes.quantidadeCoberta.toFixed();
    const comRegistro = compararQuantidades(recuperada, '0') > 0 || compararQuantidades(coberta, '0') > 0;
    const protegidos = mudou.filter((c) => CAMPOS_PROTEGIDOS.includes(c));
    if (comRegistro && protegidos.length > 0) {
      throw new ErroHttp(
        409,
        'CONFLITO',
        `Linha ${antes.identificador}: ${protegidos.map((c) => ROTULOS_CAMPO[c] ?? c).join(', ')} não mudam depois de recuperação validada ou resultado registrado.`,
      );
    }
    const minimo = compararQuantidades(recuperada, coberta) >= 0 ? recuperada : coberta;
    if (compararQuantidades(novo.quantidadeAnalise, minimo) < 0) {
      throw new ErroHttp(409, 'CONFLITO', `Linha ${antes.identificador}: a quantidade em análise não pode ficar abaixo de ${normalizarQuantidade(minimo)} ${antes.unidade} já validados ou cobertos.`);
    }
    await tx.linhaClaim.update({ where: { id: antes.id }, data: { ...comparar, versao: { increment: 1 }, atualizadoEm: agora } });
    alteracoes.push(`linha ${antes.identificador}: ${mudou.map((c) => ROTULOS_CAMPO[c] ?? c).join(', ')}`);
    await registrarEventoClaim(tx, {
      escopoId: escopo.id,
      claimId: id,
      linhaId: antes.id,
      tipo: 'CASO_ALTERADO',
      autorId: autor.usuarioId,
      agora,
      resumo: `Linha ${antes.identificador} alterada: ${mudou.map((c) => ROTULOS_CAMPO[c] ?? c).join(', ')}.`,
      detalhes: {
        motivo: dados.reasonForChange,
        ...Object.fromEntries(mudou.flatMap((c) => [[`${c}Antes`, comparavel((antes as unknown as Record<string, unknown>)[c]) || null], [`${c}Depois`, comparavel((comparar as Record<string, unknown>)[c]) || null]])),
      },
    });
  }
  if (alteracoes.length === 0) return detalheClaim(tx, escopo.id, id, agora);

  await tx.claim.update({ where: { id }, data: { ...novoCabecalho, versao: { increment: 1 }, atualizadoEm: agora } });
  if (mudouCabecalho.length > 0) {
    await registrarEventoClaim(tx, {
      escopoId: escopo.id,
      claimId: id,
      tipo: 'CASO_ALTERADO',
      autorId: autor.usuarioId,
      agora,
      resumo: `Dados do caso alterados: ${mudouCabecalho.map((c) => ROTULOS_CAMPO[c] ?? c).join(', ')}.`,
      detalhes: {
        motivo: dados.reasonForChange,
        ...Object.fromEntries(
          mudouCabecalho.flatMap((c) => [[`${c}Antes`, comparavel((atual as unknown as Record<string, unknown>)[c]) || null], [`${c}Depois`, comparavel((novoCabecalho as Record<string, unknown>)[c]) || null]]),
        ),
      },
    });
  }
  await registrarEvento(tx, {
    acao: 'CLAIM_ALTERADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: id,
    detalhes: { codigo: caso.codigo, alteracoes: alteracoes.length },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, id, agora);
}

/** Muda a situação registrando o evento (usado pelas ações explícitas do servidor). */
export async function gravarSituacao(
  tx: Transacao,
  escopoId: string,
  caso: CasoTravado,
  para: SituacaoClaim,
  motivo: string,
  autor: Autor,
  agora: Date,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (caso.situacao === para && Object.keys(extra).length === 0) return;
  await tx.claim.update({ where: { id: caso.id }, data: { situacao: para, versao: { increment: 1 }, atualizadoEm: agora, ...extra } });
  await registrarEventoClaim(tx, {
    escopoId,
    claimId: caso.id,
    tipo: 'SITUACAO_ALTERADA',
    autorId: autor.usuarioId,
    agora,
    resumo: `Situação: ${caso.situacao} → ${para}. ${motivo}`,
    detalhes: { de: caso.situacao, para, motivo },
  });
  caso.situacao = para;
  caso.versao += 1;
}

export async function mudarSituacao(tx: Transacao, escopo: Escopo, id: string, dados: z.output<typeof TransicaoClaimSchema>, autor: Autor, agora: Date): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, id);
  exigirAberto(caso, 'a situação não muda');
  exigirVersaoCaso(caso, dados.expectedVersion);
  if (caso.situacao === 'VALIDACAO_PENDENTE') {
    throw new ErroHttp(409, 'CONFLITO', 'Há validação de recuperação aguardando decisão: valide ou rejeite antes de mudar a situação.');
  }
  if (caso.situacao === dados.to) return detalheClaim(tx, escopo.id, id, agora);
  const de = caso.situacao;
  await gravarSituacao(tx, escopo.id, caso, dados.to, dados.reason, autor, agora);
  await registrarEvento(tx, {
    acao: 'CLAIM_SITUACAO_ALTERADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: id,
    detalhes: { codigo: caso.codigo, de, para: dados.to },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, id, agora);
}

/**
 * Encerramento: decisão documentada por perfil autorizado. Regularizado e
 * perda confirmada exigem que os resultados vigentes cubram cada linha;
 * nenhum encerramento com validação pendente. Ausência de candidatos não
 * prova perda: a perda confirmada vem de resultado registrado.
 */
export async function encerrarClaim(tx: Transacao, escopo: Escopo, id: string, dados: z.output<typeof EncerrarClaimSchema>, autor: Autor, agora: Date): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, id);
  exigirAberto(caso, 'já há decisão de encerramento');
  exigirVersaoCaso(caso, dados.expectedVersion);
  const pendentes = await tx.evidenciaClaim.count({ where: { claimId: id, situacao: 'VALIDACAO_SOLICITADA' } });
  if (pendentes > 0) throw new ErroHttp(409, 'CONFLITO', 'Há validação de recuperação aguardando decisão: valide ou rejeite antes de encerrar.');
  const linhas = await tx.linhaClaim.findMany({ where: { claimId: id }, orderBy: { ordem: 'asc' } });
  const vigentes = await tx.resultadoLinhaClaim.findMany({ where: { resultado: { claimId: id, situacao: 'VIGENTE' } }, include: { resultado: { select: { tipo: true } } } });
  if (dados.to === 'REGULARIZADO' || dados.to === 'PERDA_CONFIRMADA') {
    const descobertas = linhas.filter((l) => compararQuantidades(l.quantidadeCoberta.toFixed(), l.quantidadeAnalise.toFixed()) < 0);
    if (descobertas.length > 0) {
      throw new ErroHttp(
        409,
        'CONFLITO',
        `${dados.to === 'REGULARIZADO' ? 'Regularizado' : 'Perda confirmada'} exige resultado registrado cobrindo cada linha; sem resultado: ${descobertas.map((l) => `linha ${l.identificador}`).join(', ')}. Registre o resultado (perfil com aprovação financeira) ou encerre com outra decisão documentada.`,
      );
    }
    const tipos = new Set(vigentes.map((r) => r.resultado.tipo));
    if (dados.to === 'REGULARIZADO' && tipos.has('PERDA_CONFIRMADA')) {
      throw new ErroHttp(409, 'CONFLITO', 'Há perda confirmada registrada: o caso não é encerrado como regularizado (use perda confirmada ou encerrado, com decisão).');
    }
    if (dados.to === 'PERDA_CONFIRMADA' && !tipos.has('PERDA_CONFIRMADA')) {
      throw new ErroHttp(409, 'CONFLITO', 'Perda confirmada exige resultado de perda registrado por perfil autorizado. Ausência de candidatos não prova perda.');
    }
  }
  const de = caso.situacao;
  await gravarSituacao(tx, escopo.id, caso, dados.to, dados.decision, autor, agora, {
    encerradoEm: agora,
    encerradoPorId: autor.usuarioId,
    decisaoEncerramento: dados.decision,
  });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId: id,
    tipo: 'CASO_ENCERRADO',
    autorId: autor.usuarioId,
    agora,
    resumo: `Caso encerrado como ${dados.to}: ${dados.decision}`,
    detalhes: { de, para: dados.to, decisao: dados.decision, pendenciasTratadas: true },
  });
  await registrarEvento(tx, {
    acao: 'CLAIM_ENCERRADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: id,
    detalhes: { codigo: caso.codigo, de, para: dados.to },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, id, agora);
}

/**
 * Reabertura: volta à investigação com motivo. Não desfaz regularização,
 * resultados nem recuperações; a decisão anterior fica no histórico.
 */
export async function reabrirClaim(tx: Transacao, escopo: Escopo, id: string, dados: z.output<typeof ReabrirClaimSchema>, autor: Autor, agora: Date): Promise<ClaimDetalhe> {
  const caso = await bloquearCaso(tx, escopo.id, id);
  exigirVersaoCaso(caso, dados.expectedVersion);
  if (!(SITUACOES_FINAIS_CLAIM as readonly string[]).includes(caso.situacao)) throw new ErroHttp(409, 'CONFLITO', `O caso ${caso.codigo} não está encerrado.`);
  const anterior = await tx.claim.findUniqueOrThrow({ where: { id }, select: { decisaoEncerramento: true, encerradoEm: true } });
  const de = caso.situacao;
  await gravarSituacao(tx, escopo.id, caso, dados.to, dados.reason, autor, agora, { encerradoEm: null, encerradoPorId: null, decisaoEncerramento: null });
  await registrarEventoClaim(tx, {
    escopoId: escopo.id,
    claimId: id,
    tipo: 'CASO_REABERTO',
    autorId: autor.usuarioId,
    agora,
    resumo: `Caso reaberto (${de} → ${dados.to}): ${dados.reason}. Recuperações, vínculos e resultados registrados continuam valendo.`,
    detalhes: { de, para: dados.to, motivo: dados.reason, decisaoAnterior: anterior.decisaoEncerramento, encerradoEm: anterior.encerradoEm?.toISOString() ?? null },
  });
  await registrarEvento(tx, {
    acao: 'CLAIM_REABERTO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'CLAIM',
    alvoId: id,
    detalhes: { codigo: caso.codigo, de, para: dados.to },
    requestId: autor.requestId,
  });
  return detalheClaim(tx, escopo.id, id, agora);
}
