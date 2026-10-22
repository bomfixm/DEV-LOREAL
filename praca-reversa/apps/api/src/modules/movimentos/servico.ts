/**
 * Movimentações (etapa 05; docs/DADOS-E-REGRAS.md R10–R14): mudança de
 * localização do palete, transferência de saldo validado entre paletes e
 * correções vinculadas ao evento original.
 *
 * Concorrência (PostgreSQL em READ COMMITTED + bloqueios de linha, dentro da
 * transação da idempotência). Ordem fixa de aquisição, igual em todas as
 * operações de estoque, para não haver impasse:
 *   1. paletes envolvidos, em ordem crescente de ID (SELECT … FOR UPDATE);
 *   2. linhas de saldo desses paletes, em ordem (palete, segmento) (FOR UPDATE);
 *   3. posição de destino (FOR SHARE, aqui e no gatilho palete_posicao_valida).
 * Conferência, reconciliação e arquivamento também bloqueiam o palete antes de
 * qualquer outra linha. As validações de versão, conferência ativa, saldo e
 * ocupação são feitas depois dos bloqueios, contra o estado confirmado.
 *
 * Etapa 07: quantidade vinculada a recuperações de claim acompanha o material
 * quando a transferência passa da parte livre (claims/vinculos.ts); os
 * vínculos são bloqueados depois das linhas de saldo.
 *
 * Etapa 08: a liberação é do material (palete × segmento). A transferência
 * nunca libera: o material chega pendente de liberação no destino, e chega
 * bloqueado se vinha de palete ou linha bloqueada (estoque/saldo.ts). A parte
 * reservada não se move (R11). Palete expedido saiu da praça: não recebe nem
 * transfere conteúdo e não muda de posição.
 */
import {
  UNIDADE_PECA,
  compararQuantidades,
  ehQuantidadeInteira,
  normalizarQuantidade,
  somarQuantidades,
  subtrairQuantidades,
  type CorrigirLocalizacaoSchema,
  type CorrigirTransferenciaSchema,
  type Escopo,
  type EstadoConferencia,
  type EstadoFluxo,
  type MoverPaleteSchema,
  type PaleteDetalhe,
  type ResultadoMovimento,
  type ResultadoTransferencia,
  type RetirarPaleteVazioSchema,
  type TipoEventoEstoque,
  type TransferirSchema,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica, restricaoDoBanco } from '../../db/erros.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { exigirSemConferenciaAtiva, motivoPendencia } from '../conferencia/servico.js';
import { depositarVinculos, registrarMovimentoVinculos, retirarVinculos, vinculadaAMover } from '../claims/vinculos.js';
import { aplicarEvento, bloquearSaldos, lerEventos, type LinhaAplicar } from '../estoque/saldo.js';
import { registrarMovimentacaoRelevante } from '../paletes/relogio.js';
import { consultarPalete } from '../praca/consultas.js';
import { lerEventoLocalizacao, quantidadeCompensada } from './historico.js';

export interface Autor {
  usuarioId: string;
  requestId: string;
}

type DadosMover = z.output<typeof MoverPaleteSchema>;
type DadosTransferir = z.output<typeof TransferirSchema>;
type DadosCorrigirTransferencia = z.output<typeof CorrigirTransferenciaSchema>;
type DadosCorrigirLocalizacao = z.output<typeof CorrigirLocalizacaoSchema>;
type DadosRetirarVazio = z.output<typeof RetirarPaleteVazioSchema>;

interface PaleteTravado {
  id: string;
  codigo: string;
  versao: number;
  arquivado: boolean;
  posicao_id: string | null;
  posicao_codigo: string | null;
  estado_conferencia: EstadoConferencia;
  estado_fluxo: EstadoFluxo;
  bloqueio_motivo: string | null;
  motivo_pendencia: string | null;
}

/** Bloqueia os paletes em ordem de ID (ordem fixa: evita impasse entre operações cruzadas). */
async function bloquearPaletes(tx: Transacao, escopoId: string, ids: readonly string[]): Promise<Map<string, PaleteTravado>> {
  const ordenados = [...new Set(ids)].sort();
  const linhas = await tx.$queryRaw<PaleteTravado[]>`
    SELECT p.id::text, p.codigo, p.versao, p.arquivado_em IS NOT NULL AS arquivado, p.posicao_id::text,
           (SELECT s.codigo FROM posicao s WHERE s.id = p.posicao_id) AS posicao_codigo,
           p.estado_conferencia::text AS estado_conferencia, p.estado_fluxo::text AS estado_fluxo, p.bloqueio_motivo, p.motivo_pendencia
      FROM palete p
     WHERE p.escopo_id = ${escopoId}::uuid AND p.id = ANY(${ordenados}::uuid[])
     ORDER BY p.id
       FOR UPDATE OF p`;
  return new Map(linhas.map((l) => [l.id, l]));
}

/** Palete de outro escopo responde como inexistente (sem revelar que existe). */
function exigirPalete(paletes: Map<string, PaleteTravado>, id: string, papel = ''): PaleteTravado {
  const palete = paletes.get(id);
  if (!palete) throw naoEncontrado(`Palete${papel ? ` ${papel}` : ''} não encontrado neste escopo.`);
  return palete;
}

function exigirAtivo(palete: PaleteTravado, acao: string): void {
  if (palete.arquivado) throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} está arquivado: ${acao}.`);
  if (palete.estado_fluxo === 'EXPEDIDO') {
    throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} foi expedido (saiu da praça): ${acao}. Retorno físico usa outro palete.`);
  }
}

function exigirVersao(palete: PaleteTravado, esperada: number): void {
  if (palete.versao !== esperada) {
    throw new ErroHttp(
      409,
      'CONFLITO_VERSAO',
      `O palete ${palete.codigo} foi alterado desde a sua revisão${palete.posicao_codigo ? ` (agora em ${palete.posicao_codigo})` : ''}. Os dados atuais foram recarregados: revise antes de confirmar.`,
    );
  }
}

async function detalhe(tx: Transacao, escopo: Escopo, id: string, agora?: Date): Promise<PaleteDetalhe> {
  const d = await consultarPalete(tx, escopo, id, agora);
  if (!d) throw naoEncontrado('Palete não encontrado neste escopo.');
  return d;
}

// ---------- Localização ----------

interface Destino {
  id: string;
  codigo: string;
}

/**
 * Posição de destino válida: do layout ativo deste escopo, disponível, com o
 * código confirmado por quem move e sem outro palete (posição individual).
 * A corrida entre duas pessoas para o mesmo destino é decidida pelo índice
 * único (escopo, posição) do palete ao gravar.
 */
async function conferirDestino(tx: Transacao, escopoId: string, posicaoId: string, codigoConfirmado: string, paleteId: string): Promise<Destino> {
  const [posicao] = await tx.$queryRaw<{ codigo: string; disponivel: boolean; motivo: string | null; retirada: boolean; ativo: boolean }[]>`
    SELECT p.codigo, p.disponivel, p.motivo_indisponibilidade AS motivo, p.retirada_em IS NOT NULL AS retirada, l.ativo
      FROM posicao p
      JOIN layout l ON l.id = p.layout_id
     WHERE p.id = ${posicaoId}::uuid AND p.escopo_id = ${escopoId}::uuid
       FOR SHARE OF p`;
  if (!posicao) throw requisicaoInvalida('Posição de destino não encontrada no layout deste escopo.');
  if (posicao.retirada || !posicao.ativo) throw new ErroHttp(409, 'DESTINO_INDISPONIVEL', `A posição ${posicao.codigo} não está no layout ativo.`);
  if (!posicao.disponivel) {
    throw new ErroHttp(409, 'DESTINO_INDISPONIVEL', `A posição ${posicao.codigo} está indisponível${posicao.motivo ? ` (${posicao.motivo})` : ''}.`);
  }
  if (posicao.codigo !== codigoConfirmado) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `A posição escolhida tem o código ${posicao.codigo}, não ${codigoConfirmado}. Confira o destino e confirme novamente.`);
  }
  const ocupante = await tx.palete.findFirst({ where: { escopoId, posicaoId, id: { not: paleteId } }, select: { codigo: true } });
  if (ocupante) throw new ErroHttp(409, 'DESTINO_INDISPONIVEL', `A posição ${posicao.codigo} já tem o palete ${ocupante.codigo}. Escolha outro destino.`);
  return { id: posicaoId, codigo: posicao.codigo };
}

/** Grava o novo vínculo de posição (a anterior fica sem este palete) e avança a versão do palete. */
async function gravarPosicao(tx: Transacao, palete: PaleteTravado, destino: Destino | null): Promise<void> {
  try {
    await tx.palete.update({
      where: { id: palete.id },
      data: {
        posicaoId: destino?.id ?? null,
        motivoPendencia: motivoPendencia(palete.estado_conferencia, destino === null, palete.motivo_pendencia),
        versao: { increment: 1 },
      },
    });
  } catch (erro) {
    if (ehViolacaoUnica(erro) || restricaoDoBanco(erro) !== null) {
      throw new ErroHttp(
        409,
        'DESTINO_INDISPONIVEL',
        `Outra pessoa acabou de ocupar a posição ${destino?.codigo ?? ''} ou ela ficou indisponível. O palete continua onde estava; escolha outro destino.`,
      );
    }
    throw erro;
  }
}

async function registrarLocalizacao(
  tx: Transacao,
  escopoId: string,
  palete: PaleteTravado,
  tipo: 'MOVIMENTO' | 'CORRECAO' | 'RETIRADA_VAZIO',
  destino: Destino | null,
  motivo: string,
  autor: Autor,
  agora: Date,
  corrigido: string | null,
  relogio = true,
): Promise<string> {
  const id = randomUUID();
  // Mudança efetiva de localização reinicia a contagem de 20 dias (a posição registrada pela carga do inventário não).
  if (relogio) await registrarMovimentacaoRelevante(tx, escopoId, [palete.id], tipo === 'MOVIMENTO' ? 'MOVIMENTO' : tipo === 'CORRECAO' ? 'CORRECAO_LOCALIZACAO' : 'RETIRADA_VAZIO', agora);
  await tx.eventoLocalizacao.create({
    data: {
      id,
      escopoId,
      paleteId: palete.id,
      tipo,
      posicaoOrigemId: palete.posicao_id,
      posicaoOrigemCodigo: palete.posicao_codigo,
      posicaoDestinoId: destino?.id ?? null,
      posicaoDestinoCodigo: destino?.codigo ?? null,
      motivo,
      autorId: autor.usuarioId,
      ocorridoEm: agora,
      versaoPaleteAnterior: palete.versao,
      versaoPaletePosterior: palete.versao + 1,
      eventoCorrigidoId: corrigido,
    },
  });
  return id;
}

/**
 * Muda o endereço do palete: ID, código, QR, conteúdo e conferência ficam
 * como estão (nenhuma entrada nova por produto). Vínculo, versão, evento de
 * localização e auditoria na mesma transação.
 */
export async function moverPalete(
  tx: Transacao,
  escopo: Escopo,
  paleteId: string,
  dados: DadosMover,
  autor: Autor,
  agora: Date,
  /** `relogio: false`: posição informada pela carga do inventário (dado de origem, não movimento físico). */
  opcoes: { relogio?: boolean } = {},
): Promise<ResultadoMovimento> {
  const palete = exigirPalete(await bloquearPaletes(tx, escopo.id, [paleteId]), paleteId);
  exigirAtivo(palete, 'não é movido');
  await exigirSemConferenciaAtiva(tx, escopo.id, palete.id, 'A mudança de localização');
  exigirVersao(palete, dados.expectedVersion);
  if (dados.destinationPositionId === palete.posicao_id) {
    throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} já está na posição ${palete.posicao_codigo ?? ''}.`);
  }
  const destino = await conferirDestino(tx, escopo.id, dados.destinationPositionId, dados.confirmedPositionCode, palete.id);
  await gravarPosicao(tx, palete, destino);
  const eventoId = await registrarLocalizacao(tx, escopo.id, palete, 'MOVIMENTO', destino, dados.reason, autor, agora, null, opcoes.relogio ?? true);
  await registrarEvento(tx, {
    acao: 'PALETE_MOVIDO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: palete.id,
    detalhes: { codigo: palete.codigo, de: palete.posicao_codigo, para: destino.codigo, motivo: dados.reason, evento: eventoId },
    requestId: autor.requestId,
  });
  return { event: await lerEventoLocalizacao(tx, escopo.id, eventoId), pallet: await detalhe(tx, escopo, palete.id, agora) };
}

/**
 * Corrige o último movimento de localização do palete: novo evento vinculado
 * ao original, validado contra a posição atual e a ocupação do destino
 * escolhido. Nunca restaura cegamente um endereço antigo: um movimento
 * seguido de outro não é mais corrigível (registra-se um novo movimento).
 */
export async function corrigirMovimento(
  tx: Transacao,
  escopo: Escopo,
  eventoId: string,
  dados: DadosCorrigirLocalizacao,
  autor: Autor,
  agora: Date,
  /** `relogio: false`: corrige a posição registrada pela carga do inventário por erro na tabela de endereços (dado de origem, não movimento físico). */
  opcoes: { relogio?: boolean } = {},
): Promise<ResultadoMovimento> {
  const original = await tx.eventoLocalizacao.findFirst({
    where: { id: eventoId, escopoId: escopo.id },
    select: { id: true, paleteId: true, posicaoOrigemId: true, posicaoDestinoId: true, posicaoDestinoCodigo: true },
  });
  if (!original) throw naoEncontrado('Movimento não encontrado neste escopo.');
  const palete = exigirPalete(await bloquearPaletes(tx, escopo.id, [original.paleteId]), original.paleteId);
  const ultimo = await tx.eventoLocalizacao.findFirst({
    where: { escopoId: escopo.id, paleteId: palete.id },
    orderBy: { versaoPaletePosterior: 'desc' },
    select: { id: true, posicaoDestinoCodigo: true },
  });
  if (ultimo?.id !== original.id) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      `Este movimento já foi seguido por outro (palete agora em ${ultimo?.posicaoDestinoCodigo ?? 'localização pendente'}). Só o último movimento pode ser corrigido; para mudar de novo, use "Mover palete".`,
    );
  }
  exigirAtivo(palete, 'a localização não é corrigida');
  await exigirSemConferenciaAtiva(tx, escopo.id, palete.id, 'A correção de localização');
  exigirVersao(palete, dados.expectedVersion);
  if (palete.posicao_id !== original.posicaoDestinoId) {
    throw new ErroHttp(409, 'CONFLITO', `A localização atual do palete ${palete.codigo} não é a registrada por este movimento. Recarregue o histórico.`);
  }
  let destino: Destino | null = null;
  if (dados.destinationPositionId === null) {
    if (original.posicaoOrigemId !== null) throw requisicaoInvalida('Informe a posição correta do palete.');
  } else {
    if (dados.destinationPositionId === palete.posicao_id) throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} já está nesta posição.`);
    destino = await conferirDestino(tx, escopo.id, dados.destinationPositionId, dados.confirmedPositionCode ?? '', palete.id);
  }
  await gravarPosicao(tx, palete, destino);
  const id = await registrarLocalizacao(tx, escopo.id, palete, 'CORRECAO', destino, dados.reason, autor, agora, original.id, opcoes.relogio ?? true);
  await registrarEvento(tx, {
    acao: 'MOVIMENTO_CORRIGIDO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: palete.id,
    detalhes: { codigo: palete.codigo, de: palete.posicao_codigo, para: destino?.codigo ?? null, motivo: dados.reason, evento: id, corrigido: original.id },
    requestId: autor.requestId,
  });
  return { event: await lerEventoLocalizacao(tx, escopo.id, id), pallet: await detalhe(tx, escopo, palete.id, agora) };
}

/**
 * Retira da posição um palete físico que ficou vazio (etapa 10; consolidação,
 * T29): nenhuma unidade sai do estoque — a quantidade já foi transferida para
 * outro palete por evento próprio. Só aceita palete sem saldo validado, sem
 * reserva ou vínculo de claim, sem conferência em andamento e com o conteúdo
 * conhecido (conferência completa reconciliada): conteúdo desconhecido nunca é
 * presumido vazio. O ID e o código ficam arquivados (nunca reutilizados); a
 * posição fica livre; o evento de localização guarda de onde saiu.
 */
export async function retirarPaleteVazio(
  tx: Transacao,
  escopo: Escopo,
  paleteId: string,
  dados: DadosRetirarVazio,
  autor: Autor,
  agora: Date,
): Promise<ResultadoMovimento> {
  const palete = exigirPalete(await bloquearPaletes(tx, escopo.id, [paleteId]), paleteId);
  exigirAtivo(palete, 'não é retirado de novo');
  await exigirSemConferenciaAtiva(tx, escopo.id, palete.id, 'A retirada do palete vazio');
  exigirVersao(palete, dados.expectedVersion);
  await bloquearSaldos(tx, escopo.id, [palete.id]);
  const [saldo] = await tx.$queryRaw<{ quantidade: string; reservada: string; vinculada: string }[]>`
    SELECT coalesce(sum(quantidade), 0)::text AS quantidade, coalesce(sum(quantidade_reservada), 0)::text AS reservada,
           coalesce(sum(quantidade_vinculada), 0)::text AS vinculada
      FROM saldo_estoque WHERE escopo_id = ${escopo.id}::uuid AND palete_id = ${palete.id}::uuid`;
  if (compararQuantidades(saldo?.quantidade ?? '0', '0') !== 0 || compararQuantidades(saldo?.reservada ?? '0', '0') !== 0 || compararQuantidades(saldo?.vinculada ?? '0', '0') !== 0) {
    throw new ErroHttp(
      409,
      'PALETE_NAO_VAZIO',
      `O palete ${palete.codigo} ainda tem saldo validado (${normalizarQuantidade(saldo?.quantidade ?? '0')} no total). Transfira o conteúdo para outro palete antes de retirar o palete vazio; a retirada não baixa estoque.`,
    );
  }
  if (palete.estado_conferencia !== 'RECONCILIADO') {
    throw new ErroHttp(
      409,
      'CONTEUDO_DESCONHECIDO',
      `O conteúdo do palete ${palete.codigo} não é totalmente conhecido (${palete.estado_conferencia === 'AGUARDANDO_VALIDACAO' ? 'contagem aguardando validação' : 'sem conferência completa reconciliada'}). Faça e reconcilie uma conferência completa que registre o palete vazio antes de retirá-lo.`,
    );
  }
  if (palete.posicao_id === null) throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} não ocupa posição: não há endereço a liberar.`);
  const motivo = `Palete vazio retirado da posição (consolidação): ${dados.reason}`;
  await tx.palete.update({
    where: { id: palete.id },
    data: { posicaoId: null, estadoFluxo: 'VAZIO_ARQUIVADO', arquivadoEm: agora, arquivadoPorId: autor.usuarioId, motivoArquivamento: motivo, motivoPendencia: null, versao: { increment: 1 } },
  });
  const id = await registrarLocalizacao(tx, escopo.id, palete, 'RETIRADA_VAZIO', null, motivo, autor, agora, null);
  await registrarEvento(tx, {
    acao: 'PALETE_VAZIO_RETIRADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: palete.id,
    detalhes: { codigo: palete.codigo, de: palete.posicao_codigo, motivo: dados.reason, evento: id },
    requestId: autor.requestId,
  });
  return { event: await lerEventoLocalizacao(tx, escopo.id, id), pallet: await detalhe(tx, escopo, palete.id, agora) };
}

// ---------- Transferência ----------

interface PlanoTransferencia {
  linhas: [LinhaAplicar, LinhaAplicar];
  sku: string;
  lote: string | null;
  unidade: string;
  quantidade: string;
  /** Parte da quantidade que está vinculada a recuperações de claim e leva o vínculo junto. */
  vinculada: string;
}

/**
 * Baixa em `de` e entrada em `para` do mesmo segmento (produto, lote, origem,
 * condição e linhagem preservados). Só a parte não reservada se move:
 * disponível = saldo validado − reservas ativas. Quantidade vinculada a
 * recuperação de claim pode se mover (o vínculo vai junto), depois da parte
 * livre. Linhas de saldo já bloqueadas.
 */
async function planejarTransferencia(
  tx: Transacao,
  de: PaleteTravado,
  para: PaleteTravado,
  segmentoId: string,
  quantidade: string,
  contexto: 'transferir' | 'devolver',
): Promise<PlanoTransferencia> {
  const selecao = {
    quantidade: true,
    quantidadeReservada: true,
    quantidadeVinculada: true,
    segmento: {
      select: {
        id: true,
        produtoId: true,
        lote: true,
        origemTipo: true,
        origemReferencia: true,
        condicao: true,
        linhagem: true,
        unidade: true,
        produto: { select: { sku: true } },
      },
    },
  } as const;
  const origem = await tx.saldoEstoque.findUnique({ where: { paleteId_segmentoId: { paleteId: de.id, segmentoId } }, select: selecao });
  if (!origem) {
    throw new ErroHttp(409, 'SALDO_INSUFICIENTE', `O palete ${de.codigo} não tem saldo validado deste item (disponível 0). Recarregue o conteúdo.`);
  }
  const s = origem.segmento;
  if (s.unidade === UNIDADE_PECA && !ehQuantidadeInteira(quantidade)) {
    throw requisicaoInvalida(`Quantidade em peças (${UNIDADE_PECA}) precisa ser inteira.`);
  }
  const saldo = origem.quantidade.toFixed();
  const reservado = origem.quantidadeReservada.toFixed();
  const disponivel = subtrairQuantidades(saldo, reservado);
  const q = normalizarQuantidade(quantidade);
  if (compararQuantidades(q, disponivel) > 0) {
    throw new ErroHttp(
      409,
      'SALDO_INSUFICIENTE',
      `Saldo insuficiente para ${contexto} ${q} ${s.unidade} de ${s.produto.sku}${s.lote ? ` lote ${s.lote}` : ''} do palete ${de.codigo}: disponível ${normalizarQuantidade(disponivel)} ${s.unidade} (saldo validado ${normalizarQuantidade(saldo)} − reservado ${normalizarQuantidade(reservado)}). ${
        contexto === 'devolver'
          ? 'O material pode já ter sido reservado ou transferido adiante: a correção não restaura saldos antigos.'
          : 'A parte reservada só se move por tratativa explícita.'
      }`,
    );
  }
  const destino = await tx.saldoEstoque.findUnique({ where: { paleteId_segmentoId: { paleteId: para.id, segmentoId } }, select: { quantidade: true } });
  const atualDestino = destino?.quantidade.toFixed() ?? '0';
  const identidade = { produtoId: s.produtoId, lote: s.lote, origemTipo: s.origemTipo, origemReferencia: s.origemReferencia, condicao: s.condicao };
  const comum = { ...identidade, segmentoId: s.id, linhagem: s.linhagem, unidade: s.unidade };
  return {
    linhas: [
      { ...comum, paleteId: de.id, atual: normalizarQuantidade(saldo), alvo: normalizarQuantidade(subtrairQuantidades(saldo, q)), delta: subtrairQuantidades('0', q) },
      { ...comum, paleteId: para.id, atual: normalizarQuantidade(atualDestino), alvo: normalizarQuantidade(somarQuantidades([atualDestino, q])), delta: q },
    ],
    sku: s.produto.sku,
    lote: s.lote,
    unidade: s.unidade,
    quantidade: q,
    vinculada: vinculadaAMover(saldo, reservado, origem.quantidadeVinculada.toFixed(), q),
  };
}

/** Avisos sobre o efeito da transferência nos paletes (nada muda além do saldo dos dois). */
async function avisos(tx: Transacao, escopoId: string, de: PaleteTravado, para: PaleteTravado, plano: PlanoTransferencia): Promise<string[]> {
  const notas: string[] = ['Transferência entre paletes não é expedição nem liberação: o total em estoque não muda e a condição do material é preservada.'];
  notas.push(`O material chega ao palete ${para.codigo} pendente de liberação para expedição: a liberação é por palete × material e exige ação autorizada.`);
  const noDestino = await tx.saldoEstoque.findUnique({
    where: { paleteId_segmentoId: { paleteId: para.id, segmentoId: plano.linhas[1].segmentoId ?? '' } },
    select: { bloqueioMotivo: true },
  });
  if ((noDestino?.bloqueioMotivo ?? null) !== null) notas.push(`O material está bloqueado no palete ${para.codigo}: ${noDestino?.bloqueioMotivo ?? ''}.`);
  if (para.bloqueio_motivo !== null) notas.push(`O palete ${para.codigo} está bloqueado inteiro: ${para.bloqueio_motivo}.`);
  if (para.estado_conferencia !== 'RECONCILIADO') {
    notas.push(
      `O palete ${para.codigo} continua ${para.estado_conferencia === 'NAO_CONFERIDO' ? 'não conferido' : 'sem conteúdo integral validado'}: só o item recebido tem saldo validado conhecido; o restante segue pendente de conferência.`,
    );
  }
  if (compararQuantidades(plano.linhas[0].alvo, '0') === 0) {
    notas.push(`O saldo validado deste item no palete ${de.codigo} chegou a zero. Isso não comprova que o palete físico está vazio: cadastro e localização continuam.`);
  }
  const aguardando = await tx.sessaoConferencia.findMany({
    where: { escopoId, paleteId: { in: [de.id, para.id] }, situacao: 'CONCLUIDA', escopoContagem: 'COMPLETA' },
    select: { numero: true, paleteId: true },
  });
  for (const a of aguardando) {
    const codigo = a.paleteId === de.id ? de.codigo : para.codigo;
    notas.push(`A contagem completa nº ${String(a.numero)} do palete ${codigo}, aguardando validação, ficou desatualizada: solicite recontagem antes de reconciliar.`);
  }
  return notas;
}

async function gravarTransferencia(
  tx: Transacao,
  escopo: Escopo,
  tipo: Extract<TipoEventoEstoque, 'TRANSFERENCIA' | 'CORRECAO_TRANSFERENCIA'>,
  de: PaleteTravado,
  para: PaleteTravado,
  plano: PlanoTransferencia,
  motivo: string,
  autor: Autor,
  agora: Date,
  corrigido: string | null,
): Promise<ResultadoTransferencia> {
  const segmentoId = plano.linhas[0].segmentoId;
  if (segmentoId === null) throw new Error('Transferência sem segmento.');
  // Vínculos de claim saem do palete de origem antes da baixa (reservado + vinculado ≤ saldo).
  const partes = compararQuantidades(plano.vinculada, '0') > 0 ? await retirarVinculos(tx, escopo.id, de.id, segmentoId, plano.vinculada, agora) : [];
  const { eventoId } = await aplicarEvento(tx, {
    escopoId: escopo.id,
    tipo,
    paleteId: de.id,
    paleteDestinoId: para.id,
    sessaoId: null,
    eventoCorrigidoId: corrigido,
    motivo,
    autorId: autor.usuarioId,
    agora,
    linhas: plano.linhas,
  });
  // Material saiu de um palete e entrou no outro: os dois reiniciam a contagem de 20 dias.
  await registrarMovimentacaoRelevante(tx, escopo.id, [de.id], tipo === 'TRANSFERENCIA' ? 'TRANSFERENCIA_ENVIADA' : 'CORRECAO_TRANSFERENCIA', agora);
  await registrarMovimentacaoRelevante(tx, escopo.id, [para.id], tipo === 'TRANSFERENCIA' ? 'TRANSFERENCIA_RECEBIDA' : 'CORRECAO_TRANSFERENCIA', agora);
  const notasVinculo =
    partes.length === 0
      ? []
      : await (async () => {
          await depositarVinculos(tx, escopo.id, para.id, segmentoId, partes, agora);
          return registrarMovimentoVinculos(tx, escopo.id, partes, de, para, plano.unidade, eventoId, autor, agora);
        })();
  // O conteúdo dos dois paletes mudou: telas com a versão anterior recebem conflito.
  await tx.palete.updateMany({ where: { escopoId: escopo.id, id: { in: [de.id, para.id] } }, data: { versao: { increment: 1 } } });
  await registrarEvento(tx, {
    acao: tipo === 'TRANSFERENCIA' ? 'TRANSFERENCIA_REGISTRADA' : 'TRANSFERENCIA_CORRIGIDA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'EVENTO_ESTOQUE',
    alvoId: eventoId,
    detalhes: {
      origem: de.codigo,
      destino: para.codigo,
      sku: plano.sku,
      lote: plano.lote,
      quantidade: plano.quantidade,
      unidade: plano.unidade,
      motivo,
      corrigido,
      vinculadaClaim: plano.vinculada,
    },
    requestId: autor.requestId,
  });
  const notas = [...(await avisos(tx, escopo.id, de, para, plano)), ...notasVinculo];
  const [evento] = await lerEventos(tx, escopo.id, { eventoId });
  if (!evento) throw new Error('Evento recém-gravado não encontrado.');
  return { event: evento, source: await detalhe(tx, escopo, de.id, agora), destination: await detalhe(tx, escopo, para.id, agora), notes: notas };
}

/**
 * Transfere quantidade validada de um segmento entre dois paletes do mesmo
 * escopo: baixa na origem, entrada no destino, evento com as duas linhas,
 * versões e auditoria numa única transação (falha em qualquer parte reverte
 * tudo, inclusive o registro de idempotência).
 */
export async function transferir(tx: Transacao, escopo: Escopo, dados: DadosTransferir, autor: Autor, agora: Date): Promise<ResultadoTransferencia> {
  const paletes = await bloquearPaletes(tx, escopo.id, [dados.sourcePalletId, dados.destinationPalletId]);
  const de = exigirPalete(paletes, dados.sourcePalletId, 'de origem');
  const para = exigirPalete(paletes, dados.destinationPalletId, 'de destino');
  exigirAtivo(de, 'não transfere conteúdo');
  exigirAtivo(para, 'não recebe conteúdo');
  await exigirSemConferenciaAtiva(tx, escopo.id, de.id, `A transferência a partir do palete ${de.codigo}`);
  await exigirSemConferenciaAtiva(tx, escopo.id, para.id, `A transferência para o palete ${para.codigo}`);
  exigirVersao(de, dados.expectedSourceVersion);
  exigirVersao(para, dados.expectedDestinationVersion);
  await bloquearSaldos(tx, escopo.id, [de.id, para.id]);
  const plano = await planejarTransferencia(tx, de, para, dados.segmentId, dados.quantity, 'transferir');
  return gravarTransferencia(tx, escopo, 'TRANSFERENCIA', de, para, plano, dados.reason, autor, agora, null);
}

/**
 * Correção de transferência: evento compensatório vinculado ao original, no
 * sentido inverso (sai do palete que recebeu, volta ao de origem). Limitada
 * ao que ainda não foi compensado e ao disponível atual do palete que
 * recebeu: se o material já foi consumido, reservado ou transferido, nada é
 * restaurado automaticamente.
 */
export async function corrigirTransferencia(
  tx: Transacao,
  escopo: Escopo,
  eventoId: string,
  dados: DadosCorrigirTransferencia,
  autor: Autor,
  agora: Date,
): Promise<ResultadoTransferencia> {
  const original = await tx.eventoEstoque.findFirst({
    where: { id: eventoId, escopoId: escopo.id },
    select: { id: true, tipo: true, paleteId: true, paleteDestinoId: true },
  });
  if (!original) throw naoEncontrado('Movimentação não encontrada neste escopo.');
  if (original.tipo !== 'TRANSFERENCIA' || original.paleteDestinoId === null) {
    throw new ErroHttp(409, 'CONFLITO', 'Só transferências entre paletes são corrigidas por compensação. Reconciliações seguem o fluxo de conferência e recontagem.');
  }
  const paletes = await bloquearPaletes(tx, escopo.id, [original.paleteId, original.paleteDestinoId]);
  const de = exigirPalete(paletes, original.paleteDestinoId, 'que recebeu a transferência');
  const para = exigirPalete(paletes, original.paleteId, 'de origem da transferência');
  exigirAtivo(de, 'a correção não é registrada');
  exigirAtivo(para, 'a correção não é registrada');
  await exigirSemConferenciaAtiva(tx, escopo.id, de.id, `A correção (palete ${de.codigo})`);
  await exigirSemConferenciaAtiva(tx, escopo.id, para.id, `A correção (palete ${para.codigo})`);
  exigirVersao(de, dados.expectedSourceVersion);
  exigirVersao(para, dados.expectedDestinationVersion);
  await bloquearSaldos(tx, escopo.id, [de.id, para.id]);
  const recebida = await tx.linhaEventoEstoque.findFirstOrThrow({
    where: { eventoId: original.id, paleteId: original.paleteDestinoId },
    select: { segmentoId: true, delta: true, segmento: { select: { unidade: true } } },
  });
  const restante = subtrairQuantidades(recebida.delta.toFixed(), await quantidadeCompensada(tx, original.id, original.paleteDestinoId));
  if (compararQuantidades(dados.quantity, restante) > 0) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      `A correção não pode compensar mais do que o ainda não compensado desta transferência: restam ${normalizarQuantidade(restante)} ${recebida.segmento.unidade}.`,
    );
  }
  const plano = await planejarTransferencia(tx, de, para, recebida.segmentoId, dados.quantity, 'devolver');
  return gravarTransferencia(tx, escopo, 'CORRECAO_TRANSFERENCIA', de, para, plano, dados.reason, autor, agora, original.id);
}
