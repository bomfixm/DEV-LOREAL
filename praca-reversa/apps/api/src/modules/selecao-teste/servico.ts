/**
 * "Seleção cliente — teste": carrinho, envio, versões, pedidos de alteração e
 * respostas, em registros próprios do teste (tabelas `selecao_teste_*`).
 *
 * Regras (pedido de 20/10/2026):
 * - o estoque real só é lido (`carregarBase`); nenhuma escrita em estoque,
 *   paletes, notas, endereços, conferências, reservas ou agendas reais, nem em
 *   `evento_auditoria` (que dispararia a planilha única);
 * - publicado (apresentado ao escolher), solicitado e expedido são distintos;
 *   o apresentado é preservado e nunca reescrito sem ação explícita
 *   ("Usar dados atuais" depois de ver a diferença);
 * - quantidade desconhecida é `null` (análise), nunca zero; Delivery sem
 *   volumes discriminados não recebe o total da nota;
 * - palete inteiro + notas do mesmo palete não convivem (volumes contariam duas vezes);
 * - depois de enviada, a solicitação só muda por pedido de alteração aprovado,
 *   que gera nova versão (a enviada fica guardada).
 */
import { randomUUID } from 'node:crypto';
import {
  ApresentadoTesteSchema,
  ConteudoEstoqueTesteSchema,
  ItemVersaoTesteSchema,
  rotuloTipoDocumentoTeste,
  type AdicionarItensTesteSchema,
  type AgendaTeste,
  type AlterarItemTesteSchema,
  type AlterarSolicitacaoTesteSchema,
  type ApresentadoTeste,
  type AtualizarDadosTeste,
  type DiferencaTeste,
  type Escopo,
  type ItemSolicitacaoTeste,
  type ItemVersaoTeste,
  type ListaAgendasTeste,
  type ListaSolicitacoesTeste,
  type NovaSolicitacaoTesteSchema,
  type PedirAlteracaoTeste,
  type Permissao,
  type ResponderAlteracaoTeste,
  type SolicitacaoTeste,
  type TotaisSolicitacaoTeste,
  type VerificacaoTeste,
} from '@praca-reversa/contracts';
import { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import type { ItemSelecaoTeste, Prisma, SolicitacaoSelecaoTeste } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { carregarBase, type BasePainel, type PaleteBase } from '../paineis/base.js';
import { conteudoEstoque, conteudosNoEstoque, paleteDaBase } from './estoque.js';

type Db = Banco | Transacao;
type DadosNova = z.output<typeof NovaSolicitacaoTesteSchema>;
type DadosAdicionar = z.output<typeof AdicionarItensTesteSchema>;
type DadosItem = z.output<typeof AlterarItemTesteSchema>;
type DadosCabecalho = z.output<typeof AlterarSolicitacaoTesteSchema>;

export interface Autor {
  usuarioId: string;
}

const FUSO = 'America/Sao_Paulo';
const IdentificacaoSchema = ConteudoEstoqueTesteSchema.omit({ volumes: true, volumesBasis: true });
type Identificacao = z.infer<typeof IdentificacaoSchema>;

export const codigoSolicitacao = (n: number) => `TESTE-${String(n).padStart(6, '0')}`;

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
export const mesmaDelivery = (a: string | null, b: string | null) => normalizar(a ?? '') === normalizar(b ?? '');

function dataLocal(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const dataIso = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));
const pessoa = (u: { login: string; nome: string }) => ({ login: u.login, name: u.nome });
const volumesTexto = (n: number | null) => (n === null ? 'volumes não informados' : `${String(n)} volume${n === 1 ? '' : 's'}`);

export function textoDocumento(id: Pick<Identificacao, 'documentType' | 'documentNumber'> | null): string {
  if (id === null) return 'Palete inteiro';
  return id.documentNumber === null ? 'Documento não informado' : `${rotuloTipoDocumentoTeste(id.documentType)} ${id.documentNumber}`;
}

// ---------- Avaliação de cada item (quantidade definida × análise) ----------

export interface EntradaAvaliacao {
  scope: 'PALETE' | 'CONTEUDO';
  presented: ApresentadoTeste;
  registeredDelivery: string | null;
  requestedDelivery: string | null;
  requestedVolumes: number | null;
}

export interface Avaliacao {
  needsAnalysis: boolean;
  analysisReason: string | null;
  deliveryNotRegistered: boolean;
}

/** Item com quantidade definida entra no total; sem quantidade conhecida fica "em análise" (fora do total). */
export function avaliarItem(e: EntradaAvaliacao): Avaliacao {
  if (e.scope === 'PALETE') {
    if (e.presented.contents.length === 0) {
      return { needsAnalysis: true, analysisReason: 'Palete sem notas identificadas no cadastro: a operação confere o conteúdo e a quantidade.', deliveryNotRegistered: false };
    }
    if (e.presented.unknownContents > 0) {
      const n = e.presented.unknownContents;
      return {
        needsAnalysis: true,
        analysisReason: `${String(n)} nota${n === 1 ? '' : 's'} deste palete sem volumes informados: a operação confere a quantidade do palete.`,
        deliveryNotRegistered: false,
      };
    }
    return { needsAnalysis: false, analysisReason: null, deliveryNotRegistered: false };
  }
  const deliveryNotRegistered = e.requestedDelivery !== null && !mesmaDelivery(e.requestedDelivery, e.registeredDelivery);
  if (e.presented.volumes === null) {
    const pedido = e.requestedVolumes === null ? '' : ` Quantidade pedida: ${volumesTexto(e.requestedVolumes)} (a confirmar).`;
    return { needsAnalysis: true, analysisReason: `Volumes desta nota não informados no estoque: a operação confirma a quantidade.${pedido}`, deliveryNotRegistered };
  }
  if (e.requestedVolumes === null) {
    return {
      needsAnalysis: true,
      analysisReason: `Volumes da Delivery ${e.requestedDelivery ?? ''} não discriminados no cadastro desta nota (${volumesTexto(e.presented.volumes)} na nota): a operação analisa; o total da nota não é atribuído à Delivery.`,
      deliveryNotRegistered,
    };
  }
  return { needsAnalysis: false, analysisReason: null, deliveryNotRegistered };
}

/** Quantidade aceita: inteira, ≥ 1, até o informado; sem quantidade só quando a Delivery não está discriminada ou o volume é desconhecido. */
function validarQuantidade(e: EntradaAvaliacao, descricao: string): void {
  if (e.scope === 'PALETE') return;
  const v = e.presented.volumes;
  if (v === null) return;
  const deliveryNova = e.requestedDelivery !== null && !mesmaDelivery(e.requestedDelivery, e.registeredDelivery);
  if (e.requestedVolumes === null && !deliveryNova) {
    throw requisicaoInvalida(`Informe a quantidade de volumes de ${descricao} (de 1 a ${String(v)}).`);
  }
  if (e.requestedVolumes !== null && e.requestedVolumes > v) {
    throw new ErroHttp(
      409,
      'QUANTIDADE_INDISPONIVEL',
      `Pedido de ${volumesTexto(e.requestedVolumes)} acima dos ${volumesTexto(v)} informados para ${descricao}. Ajuste a quantidade; se houver divergência, explique na observação para a operação analisar.`,
    );
  }
}

// ---------- Apresentado (o que a pessoa viu ao escolher) ----------

function apresentadoPalete(p: PaleteBase, agora: Date): ApresentadoTeste {
  const contents = conteudosNoEstoque(p).map(conteudoEstoque);
  const conhecidos = contents.filter((c) => c.volumes !== null);
  return {
    at: agora.toISOString(),
    palletType: p.tipoPalete,
    // Sem nota identificada o volume é desconhecido (nunca zero).
    volumes: contents.length === 0 ? null : conhecidos.reduce((t, c) => t + (c.volumes ?? 0), 0),
    volumesBasis: null,
    contents,
    unknownContents: contents.length - conhecidos.length,
  };
}

function apresentadoConteudo(p: PaleteBase, c: ReturnType<typeof conteudoEstoque>, agora: Date): ApresentadoTeste {
  return { at: agora.toISOString(), palletType: p.tipoPalete, volumes: c.volumes, volumesBasis: c.volumesBasis, contents: [], unknownContents: 0 };
}

/** Quantidade do palete inteiro: a soma apresentada quando todas as notas têm volumes; senão, em análise. */
function quantidadePalete(a: ApresentadoTeste): number | null {
  return a.contents.length > 0 && a.unknownContents === 0 && a.volumes !== null && a.volumes > 0 ? a.volumes : null;
}

// ---------- Leitura das linhas gravadas ----------

interface ItemLido {
  linha: ItemSelecaoTeste;
  scope: 'PALETE' | 'CONTEUDO';
  presented: ApresentadoTeste;
  content: Identificacao | null;
}

function lerItem(linha: ItemSelecaoTeste): ItemLido {
  return {
    linha,
    scope: linha.abrangencia === 'PALETE' ? 'PALETE' : 'CONTEUDO',
    presented: ApresentadoTesteSchema.parse(linha.apresentado),
    content: linha.identificacao === null ? null : IdentificacaoSchema.parse(linha.identificacao),
  };
}

function entradaDe(i: ItemLido): EntradaAvaliacao {
  return {
    scope: i.scope,
    presented: i.presented,
    registeredDelivery: i.content?.delivery ?? null,
    requestedDelivery: i.linha.deliverySolicitada,
    requestedVolumes: i.linha.quantidadeSolicitada,
  };
}

function descreverItem(i: ItemLido): string {
  if (i.scope === 'PALETE') return `palete ${i.linha.paleteCodigo} inteiro`;
  const delivery = i.linha.deliverySolicitada === null ? '' : ` (Delivery ${i.linha.deliverySolicitada})`;
  return `${textoDocumento(i.content)}${delivery} do palete ${i.linha.paleteCodigo}`;
}

function textoPedido(i: ItemLido): string {
  const av = avaliarItem(entradaDe(i));
  return av.needsAnalysis ? 'quantidade em análise' : volumesTexto(i.linha.quantidadeSolicitada);
}

export function totais(itens: readonly ItemLido[]): TotaisSolicitacaoTeste {
  let definedVolumes = 0;
  let itemsInAnalysis = 0;
  for (const i of itens) {
    const av = avaliarItem(entradaDe(i));
    if (av.needsAnalysis || i.linha.quantidadeSolicitada === null) itemsInAnalysis += 1;
    else definedVolumes += i.linha.quantidadeSolicitada;
  }
  return { items: itens.length, pallets: new Set(itens.map((i) => i.linha.paleteId)).size, definedVolumes, itemsInAnalysis };
}

/** Soma pedida por conteúdo não passa do informado (várias Deliveries da mesma nota somam). */
function validarSomaConteudo(itens: readonly ItemLido[], ref: string): void {
  const doConteudo = itens.filter((i) => i.linha.conteudoRef === ref);
  const atual = doConteudo[doConteudo.length - 1];
  if (atual === undefined) return;
  const limite = atual.presented.volumes;
  if (limite === null) return;
  const soma = doConteudo.reduce((t, i) => t + (i.linha.quantidadeSolicitada ?? 0), 0);
  if (soma > limite) {
    throw new ErroHttp(
      409,
      'QUANTIDADE_INDISPONIVEL',
      `Somando os pedidos de ${textoDocumento(atual.content)} do palete ${atual.linha.paleteCodigo} (${doConteudo
        .map((i) => volumesTexto(i.linha.quantidadeSolicitada))
        .join(' + ')}), passa dos ${volumesTexto(limite)} informados. Ajuste as quantidades.`,
    );
  }
}

// ---------- Bloqueio, versão e histórico ----------

type SolicitacaoComItens = SolicitacaoSelecaoTeste & { itens: ItemSelecaoTeste[] };

async function bloquear(tx: Transacao, escopoId: string, id: string): Promise<SolicitacaoComItens> {
  const linhas = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM selecao_teste_solicitacao WHERE escopo_id = ${escopoId}::uuid AND id = ${id}::uuid FOR UPDATE`;
  if (linhas.length === 0) throw naoEncontrado('Solicitação de teste não encontrada neste escopo.');
  return tx.solicitacaoSelecaoTeste.findUniqueOrThrow({ where: { id }, include: { itens: { orderBy: { ordem: 'asc' } } } });
}

function exigirEditavel(s: SolicitacaoSelecaoTeste, autor: Autor, versaoEsperada: number): void {
  if (s.situacao !== 'RASCUNHO' && s.situacao !== 'EM_REVISAO') {
    throw new ErroHttp(409, 'SOLICITACAO_BLOQUEADA', 'Solicitação enviada: não pode ser editada. Use “Solicitar alteração” e aguarde a resposta.');
  }
  if (s.criadoPorId !== autor.usuarioId) throw new ErroHttp(403, 'ACESSO_NEGADO', 'Só quem criou a solicitação altera o carrinho.');
  if (s.versao !== versaoEsperada) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', 'A solicitação mudou desde a sua última leitura (outra aba ou outra pessoa). Recarregue e confira antes de continuar.');
  }
}

async function tocar(tx: Transacao, s: SolicitacaoSelecaoTeste, agora: Date, extra: Prisma.SolicitacaoSelecaoTesteUpdateInput = {}): Promise<void> {
  await tx.solicitacaoSelecaoTeste.update({ where: { id: s.id }, data: { ...extra, versao: { increment: 1 }, atualizadoEm: agora } });
}

async function evento(tx: Transacao, s: SolicitacaoSelecaoTeste, tipo: string, autor: Autor, agora: Date, texto: string, extra: Record<string, Prisma.InputJsonValue | null> = {}): Promise<void> {
  await tx.eventoSelecaoTeste.create({
    data: { id: randomUUID(), escopoId: s.escopoId, solicitacaoId: s.id, tipo, autorId: autor.usuarioId, ocorridoEm: agora, detalhes: { texto, ...extra } },
  });
}

// ---------- Agendas ----------

const JANELA_USAVEL = { notIn: ['CANCELADA', 'ENCERRADA'] as ('CANCELADA' | 'ENCERRADA')[] };

export async function agendas(db: Db, escopo: Escopo): Promise<ListaAgendasTeste> {
  const janelas = await db.janelaDevolucao.findMany({
    where: { escopoId: escopo.id, situacao: JANELA_USAVEL },
    orderBy: [{ mesReferencia: 'desc' }, { numero: 'desc' }],
    take: 50,
    select: { id: true, codigo: true, nome: true, situacao: true, saidaInicio: true },
  });
  const proprias = await db.solicitacaoSelecaoTeste.groupBy({
    by: ['agendaChave', 'agendaReferencia', 'agendaData'],
    where: { escopoId: escopo.id, janelaId: null },
    _count: { _all: true },
    orderBy: { agendaReferencia: 'asc' },
  });
  return {
    windows: janelas.map((j) => ({ id: j.id, code: j.codigo, name: j.nome, status: j.situacao, date: j.saidaInicio === null ? null : dataLocal(j.saidaInicio) })),
    testAgendas: proprias.map((a) => ({ reference: a.agendaReferencia, date: dataIso(a.agendaData), requests: a._count._all })),
  };
}

export async function criarSolicitacao(tx: Transacao, escopo: Escopo, dados: DadosNova, autor: Autor, agora: Date): Promise<{ id: string; criada: boolean }> {
  let janelaId: string | null = null;
  let referencia: string;
  let data: Date | null;
  let chave: string;
  if ('windowId' in dados.agenda) {
    const janela = await tx.janelaDevolucao.findFirst({
      where: { escopoId: escopo.id, id: dados.agenda.windowId, situacao: JANELA_USAVEL },
      select: { id: true, codigo: true, nome: true, saidaInicio: true },
    });
    if (janela === null) throw naoEncontrado('Agenda não encontrada (ou encerrada/cancelada) neste escopo.');
    janelaId = janela.id;
    referencia = `${janela.codigo} · ${janela.nome}`.slice(0, 120).trim();
    data = janela.saidaInicio === null ? null : new Date(`${dataLocal(janela.saidaInicio)}T00:00:00.000Z`);
    chave = `JANELA:${janela.id}`;
  } else {
    referencia = dados.agenda.reference;
    data = dados.agenda.date === null ? null : new Date(`${dados.agenda.date}T00:00:00.000Z`);
    chave = `TESTE:${normalizar(referencia)}|${dados.agenda.date ?? ''}`;
  }
  if (dados.additional !== true) {
    // Um carrinho por pessoa e agenda: voltar à tela continua o mesmo rascunho.
    const rascunho = await tx.solicitacaoSelecaoTeste.findFirst({
      where: { escopoId: escopo.id, criadoPorId: autor.usuarioId, agendaChave: chave, situacao: 'RASCUNHO' },
      orderBy: { numero: 'desc' },
      select: { id: true },
    });
    if (rascunho !== null) return { id: rascunho.id, criada: false };
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`selecao_teste_numero:${escopo.id}`}, 0))`;
  const ultimo = await tx.solicitacaoSelecaoTeste.aggregate({ where: { escopoId: escopo.id }, _max: { numero: true } });
  const numero = (ultimo._max.numero ?? 0) + 1;
  const s = await tx.solicitacaoSelecaoTeste.create({
    data: {
      id: randomUUID(),
      escopoId: escopo.id,
      numero,
      codigo: codigoSolicitacao(numero),
      janelaId,
      agendaReferencia: referencia,
      agendaData: data,
      agendaChave: chave,
      observacao: dados.note ?? null,
      criadoPorId: autor.usuarioId,
      criadoEm: agora,
      atualizadoEm: agora,
    },
  });
  await evento(tx, s, 'CRIADA', autor, agora, `Solicitação criada para a agenda ${referencia}${data === null ? '' : ` (${dataIso(data) ?? ''})`}.`);
  return { id: s.id, criada: true };
}

// ---------- Carrinho ----------

export async function alterarCabecalho(tx: Transacao, escopo: Escopo, id: string, dados: DadosCabecalho, autor: Autor, agora: Date): Promise<void> {
  const s = await bloquear(tx, escopo.id, id);
  exigirEditavel(s, autor, dados.expectedVersion);
  if ((s.observacao ?? null) === dados.note) return;
  await tocar(tx, s, agora, { observacao: dados.note });
  await evento(tx, s, 'OBSERVACAO_ALTERADA', autor, agora, dados.note === null ? 'Observação geral retirada.' : 'Observação geral da solicitação alterada.');
}

export async function adicionarItens(tx: Transacao, escopo: Escopo, id: string, dados: DadosAdicionar, autor: Autor, agora: Date): Promise<void> {
  const s = await bloquear(tx, escopo.id, id);
  exigirEditavel(s, autor, dados.expectedVersion);
  const base = await carregarBase(tx, escopo.id);
  const p = paleteDaBase(base, dados.palletId);
  let itens = s.itens.map(lerItem);
  const doPalete = itens.filter((i) => i.linha.paleteId === p.id);
  const inteiro = doPalete.find((i) => i.scope === 'PALETE');
  const notas = doPalete.filter((i) => i.scope === 'CONTEUDO');
  let ordem = s.itens.reduce((m, i) => Math.max(m, i.ordem), 0);

  const remover = async (alvos: ItemLido[], motivo: string) => {
    for (const a of alvos) {
      await tx.itemSelecaoTeste.delete({ where: { id: a.linha.id } });
      await evento(tx, s, 'ITEM_REMOVIDO', autor, agora, `Retirado: ${descreverItem(a)} (${motivo}).`);
    }
    const ids = new Set(alvos.map((a) => a.linha.id));
    itens = itens.filter((i) => !ids.has(i.linha.id));
  };

  if (dados.wholePallet) {
    if (inteiro !== undefined) throw new ErroHttp(409, 'SELECAO_DUPLICADA', `O palete ${p.codigo} inteiro já está na seleção.`);
    if (notas.length > 0) {
      if (!dados.replace) {
        throw new ErroHttp(
          409,
          'SELECAO_DUPLICADA',
          `Já há ${String(notas.length)} nota${notas.length === 1 ? '' : 's'} do palete ${p.codigo} na seleção. O palete inteiro inclui essas notas: para não contar os volumes duas vezes, troque as notas pelo palete inteiro ou mantenha só as notas.`,
        );
      }
      await remover(notas, 'trocado pelo palete inteiro');
    }
    const presented = apresentadoPalete(p, agora);
    ordem += 1;
    const quantidade = quantidadePalete(presented);
    await tx.itemSelecaoTeste.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        solicitacaoId: s.id,
        abrangencia: 'PALETE',
        paleteId: p.id,
        paleteCodigo: p.codigo,
        apresentado: presented,
        quantidadeSolicitada: quantidade,
        observacao: dados.note ?? null,
        ordem,
        criadoEm: agora,
        atualizadoEm: agora,
      },
    });
    await evento(tx, s, 'ITEM_ADICIONADO', autor, agora, `Adicionado: palete ${p.codigo} inteiro (${quantidade === null ? 'quantidade em análise' : volumesTexto(quantidade)}).`);
  } else {
    if (inteiro !== undefined) {
      if (!dados.replace) {
        throw new ErroHttp(
          409,
          'SELECAO_DUPLICADA',
          `O palete ${p.codigo} inteiro já está na seleção e inclui estas notas. Para pedir só algumas notas, troque o palete inteiro pelas notas escolhidas.`,
        );
      }
      await remover([inteiro], 'trocado pelas notas escolhidas');
    }
    const disponiveis = conteudosNoEstoque(p).map(conteudoEstoque);
    for (const pedido of dados.contents) {
      const c = disponiveis.find((d) => d.ref.kind === pedido.ref.kind && d.ref.id === pedido.ref.id);
      if (c === undefined) throw naoEncontrado(`Uma das notas escolhidas não está mais no palete ${p.codigo}. Abra o palete de novo para ver o conteúdo atual.`);
      const content: Identificacao = { ref: c.ref, documentType: c.documentType, documentNumber: c.documentNumber, delivery: c.delivery, sender: c.sender };
      const presented = apresentadoConteudo(p, c, agora);
      const entrada: EntradaAvaliacao = { scope: 'CONTEUDO', presented, registeredDelivery: c.delivery, requestedDelivery: pedido.delivery, requestedVolumes: pedido.volumes };
      const descricao = `${textoDocumento(content)} do palete ${p.codigo}`;
      if (itens.some((i) => i.linha.conteudoRef === c.ref.id && mesmaDelivery(i.linha.deliverySolicitada, pedido.delivery))) {
        throw new ErroHttp(409, 'SELECAO_DUPLICADA', `${descricao}${pedido.delivery === null ? '' : ` (Delivery ${pedido.delivery})`} já está na seleção. Ajuste a quantidade no carrinho.`);
      }
      validarQuantidade(entrada, descricao);
      ordem += 1;
      const linha = await tx.itemSelecaoTeste.create({
        data: {
          id: randomUUID(),
          escopoId: escopo.id,
          solicitacaoId: s.id,
          abrangencia: 'CONTEUDO',
          paleteId: p.id,
          paleteCodigo: p.codigo,
          conteudoAlvo: c.ref.kind,
          conteudoRef: c.ref.id,
          identificacao: content,
          apresentado: presented,
          deliverySolicitada: pedido.delivery,
          quantidadeSolicitada: pedido.volumes,
          observacao: pedido.note,
          ordem,
          criadoEm: agora,
          atualizadoEm: agora,
        },
      });
      const lido = lerItem(linha);
      itens.push(lido);
      validarSomaConteudo(itens, c.ref.id);
      await evento(tx, s, 'ITEM_ADICIONADO', autor, agora, `Adicionado: ${descreverItem(lido)} — ${textoPedido(lido)}.`);
    }
  }
  await tocar(tx, s, agora);
}

export async function alterarItem(tx: Transacao, escopo: Escopo, id: string, itemId: string, dados: DadosItem, autor: Autor, agora: Date): Promise<void> {
  const s = await bloquear(tx, escopo.id, id);
  exigirEditavel(s, autor, dados.expectedVersion);
  const itens = s.itens.map(lerItem);
  const item = itens.find((i) => i.linha.id === itemId);
  if (item === undefined) throw naoEncontrado('Item não encontrado nesta solicitação.');
  const volumes = dados.volumes === undefined ? item.linha.quantidadeSolicitada : dados.volumes;
  const delivery = dados.delivery === undefined ? item.linha.deliverySolicitada : dados.delivery;
  const nota = dados.note === undefined ? item.linha.observacao : dados.note;
  if (item.scope === 'PALETE') {
    if (delivery !== null) throw requisicaoInvalida('A Delivery é pedida por nota. Para pedir uma Delivery, escolha a nota no palete.');
    if (volumes !== item.linha.quantidadeSolicitada) throw requisicaoInvalida('No palete inteiro a quantidade é a do palete. Para pedir parte dos volumes, escolha as notas do palete.');
  } else {
    if (itens.some((i) => i.linha.id !== item.linha.id && i.linha.conteudoRef === item.linha.conteudoRef && mesmaDelivery(i.linha.deliverySolicitada, delivery))) {
      throw new ErroHttp(409, 'SELECAO_DUPLICADA', `${descreverItem(item)} já está na seleção com esta Delivery.`);
    }
    validarQuantidade({ ...entradaDe(item), requestedDelivery: delivery, requestedVolumes: volumes }, `${textoDocumento(item.content)} do palete ${item.linha.paleteCodigo}`);
  }
  const mudancas: string[] = [];
  if (volumes !== item.linha.quantidadeSolicitada) mudancas.push(`quantidade ${item.linha.quantidadeSolicitada === null ? 'em análise' : String(item.linha.quantidadeSolicitada)} → ${volumes === null ? 'em análise' : String(volumes)}`);
  if ((delivery ?? '') !== (item.linha.deliverySolicitada ?? '')) mudancas.push(`Delivery ${delivery ?? 'não indicada'}`);
  if ((nota ?? '') !== (item.linha.observacao ?? '')) mudancas.push(nota === null ? 'observação retirada' : 'observação alterada');
  if (mudancas.length === 0) return;
  const linha = await tx.itemSelecaoTeste.update({ where: { id: item.linha.id }, data: { quantidadeSolicitada: volumes, deliverySolicitada: delivery, observacao: nota, atualizadoEm: agora } });
  if (item.scope === 'CONTEUDO' && item.linha.conteudoRef !== null) {
    validarSomaConteudo(
      itens.map((i) => (i.linha.id === item.linha.id ? lerItem(linha) : i)),
      item.linha.conteudoRef,
    );
  }
  await evento(tx, s, 'ITEM_ALTERADO', autor, agora, `Alterado: ${descreverItem(item)} — ${mudancas.join('; ')}.`);
  await tocar(tx, s, agora);
}

export async function removerItem(tx: Transacao, escopo: Escopo, id: string, itemId: string, versaoEsperada: number, autor: Autor, agora: Date): Promise<void> {
  const s = await bloquear(tx, escopo.id, id);
  exigirEditavel(s, autor, versaoEsperada);
  const linha = s.itens.find((i) => i.id === itemId);
  if (linha === undefined) throw naoEncontrado('Item não encontrado nesta solicitação.');
  await tx.itemSelecaoTeste.delete({ where: { id: itemId } });
  await evento(tx, s, 'ITEM_REMOVIDO', autor, agora, `Retirado: ${descreverItem(lerItem(linha))}.`);
  await tocar(tx, s, agora);
}

// ---------- Conferência antes do envio ----------

const vt = (n: number | null) => (n === null ? 'não informado' : String(n));

/** Diferenças entre o apresentado e o estoque agora. Toda diferença pede revisão; `blocking` = ajustar ou retirar (não basta atualizar). */
export function diferencas(base: BasePainel, itens: readonly ItemLido[]): DiferencaTeste[] {
  const lista: DiferencaTeste[] = [];
  for (const i of itens) {
    const doc = i.scope === 'PALETE' ? null : textoDocumento(i.content);
    const d = (text: string, before: string | null, now: string | null, blocking: boolean, refreshable: boolean) =>
      lista.push({ itemId: i.linha.id, palletCode: i.linha.paleteCodigo, document: doc, text, before, now, blocking, refreshable });
    const p = base.paletePorId.get(i.linha.paleteId);
    if (p === undefined) {
      d('O palete saiu do estoque consultado. Retire o item ou fale com a operação.', i.linha.paleteCodigo, null, true, false);
      continue;
    }
    if (i.scope === 'PALETE') {
      const agora = apresentadoPalete(p, new Date(0));
      const antes = new Map(i.presented.contents.map((c) => [`${c.ref.kind}:${c.ref.id}`, c]));
      const depois = new Map(agora.contents.map((c) => [`${c.ref.kind}:${c.ref.id}`, c]));
      const saiu = [...antes.keys()].filter((k) => !depois.has(k)).length;
      const entrou = [...depois.keys()].filter((k) => !antes.has(k)).length;
      if (saiu > 0 || entrou > 0) d(`As notas do palete mudaram (${String(entrou)} entrou, ${String(saiu)} saiu).`, `${String(antes.size)} notas`, `${String(depois.size)} notas`, false, true);
      if (i.presented.volumes !== agora.volumes || i.presented.unknownContents !== agora.unknownContents) {
        d('Os volumes do palete mudaram.', `${vt(i.presented.volumes)}${i.presented.unknownContents > 0 ? ` + ${String(i.presented.unknownContents)} sem volume` : ''}`, `${vt(agora.volumes)}${agora.unknownContents > 0 ? ` + ${String(agora.unknownContents)} sem volume` : ''}`, false, true);
      }
      continue;
    }
    const c = conteudosNoEstoque(p)
      .map(conteudoEstoque)
      .find((x) => x.ref.id === i.linha.conteudoRef && x.ref.kind === i.linha.conteudoAlvo);
    if (c === undefined) {
      d('A nota não está mais neste palete. Retire o item ou fale com a operação.', doc, null, true, false);
      continue;
    }
    const pedido = i.linha.quantidadeSolicitada;
    if (c.volumes !== i.presented.volumes) {
      const acima = pedido !== null && c.volumes !== null && pedido > c.volumes;
      d(acima ? `Os volumes mudaram e o pedido (${String(pedido)}) passou do disponível agora.` : 'Os volumes informados mudaram.', vt(i.presented.volumes), vt(c.volumes), acima, true);
    } else if (pedido !== null && i.presented.volumes !== null && pedido > i.presented.volumes) {
      d(`O pedido (${String(pedido)}) passa dos volumes informados.`, vt(i.presented.volumes), vt(c.volumes), true, false);
    }
    if ((c.delivery ?? '') !== (i.content?.delivery ?? '')) d('A Delivery cadastrada mudou.', i.content?.delivery ?? 'não informada', c.delivery ?? 'não informada', false, true);
    if ((c.sender ?? '') !== (i.content?.sender ?? '')) d('O remetente cadastrado mudou.', i.content?.sender ?? 'não informado', c.sender ?? 'não informado', false, true);
  }
  return lista;
}

export async function verificar(db: Db, escopo: Escopo, id: string, agora: Date): Promise<VerificacaoTeste> {
  const s = await db.solicitacaoSelecaoTeste.findFirst({ where: { escopoId: escopo.id, id }, include: { itens: { orderBy: { ordem: 'asc' } } } });
  if (s === null) throw naoEncontrado('Solicitação de teste não encontrada neste escopo.');
  const base = await carregarBase(db, escopo.id);
  return { checkedAt: agora.toISOString(), differences: diferencas(base, s.itens.map(lerItem)) };
}

/** "Usar dados atuais": a pessoa viu a diferença e aceita o estoque de agora nestes itens (quantidade pedida não muda). */
export async function atualizarDados(tx: Transacao, escopo: Escopo, id: string, dados: AtualizarDadosTeste, autor: Autor, agora: Date): Promise<void> {
  const s = await bloquear(tx, escopo.id, id);
  exigirEditavel(s, autor, dados.expectedVersion);
  const base = await carregarBase(tx, escopo.id);
  const textos: string[] = [];
  for (const itemId of new Set(dados.itemIds)) {
    const linha = s.itens.find((i) => i.id === itemId);
    if (linha === undefined) throw naoEncontrado('Item não encontrado nesta solicitação.');
    const item = lerItem(linha);
    const p = base.paletePorId.get(linha.paleteId);
    if (p === undefined) throw new ErroHttp(409, 'DADOS_ALTERADOS', `O palete ${linha.paleteCodigo} saiu do estoque: retire o item.`);
    if (item.scope === 'PALETE') {
      const presented = apresentadoPalete(p, agora);
      await tx.itemSelecaoTeste.update({ where: { id: linha.id }, data: { apresentado: presented, quantidadeSolicitada: quantidadePalete(presented), atualizadoEm: agora } });
    } else {
      const c = conteudosNoEstoque(p)
        .map(conteudoEstoque)
        .find((x) => x.ref.id === linha.conteudoRef && x.ref.kind === linha.conteudoAlvo);
      if (c === undefined) throw new ErroHttp(409, 'DADOS_ALTERADOS', `${textoDocumento(item.content)} não está mais no palete ${linha.paleteCodigo}: retire o item.`);
      const content: Identificacao = { ref: c.ref, documentType: c.documentType, documentNumber: c.documentNumber, delivery: c.delivery, sender: c.sender };
      await tx.itemSelecaoTeste.update({ where: { id: linha.id }, data: { apresentado: apresentadoConteudo(p, c, agora), identificacao: content, atualizadoEm: agora } });
    }
    textos.push(descreverItem(item));
  }
  await evento(tx, s, 'DADOS_ATUALIZADOS', autor, agora, `Dados do estoque atualizados depois de revisar as diferenças: ${textos.join('; ')}. Quantidades pedidas mantidas.`);
  await tocar(tx, s, agora);
}

// ---------- Envio, alteração e resposta ----------

export async function enviar(tx: Transacao, escopo: Escopo, id: string, versaoEsperada: number, autor: Autor, agora: Date): Promise<void> {
  const s = await bloquear(tx, escopo.id, id);
  exigirEditavel(s, autor, versaoEsperada);
  const itens = s.itens.map(lerItem);
  if (itens.length === 0) throw requisicaoInvalida('Adicione ao menos um item antes de enviar.');
  const base = await carregarBase(tx, escopo.id);
  const difs = diferencas(base, itens);
  if (difs.length > 0) {
    throw new ErroHttp(
      409,
      'DADOS_ALTERADOS',
      `O estoque mudou desde a escolha de ${String(new Set(difs.map((d) => d.itemId)).size)} item(ns). Revise as diferenças antes de enviar; nenhuma quantidade foi alterada.`,
    );
  }
  for (const i of itens) validarQuantidade(entradaDe(i), descreverItem(i));
  const copia: ItemVersaoTeste[] = itens.map((i) => {
    const p = paleteDaBase(base, i.linha.paleteId);
    const atual = i.scope === 'PALETE' ? apresentadoPalete(p, agora) : null;
    const c =
      i.scope === 'CONTEUDO'
        ? conteudosNoEstoque(p)
            .map(conteudoEstoque)
            .find((x) => x.ref.id === i.linha.conteudoRef)
        : undefined;
    return ItemVersaoTesteSchema.parse({
      ...itemContrato(i),
      atSend: atual !== null ? { volumes: atual.volumes, volumesBasis: null } : { volumes: c?.volumes ?? null, volumesBasis: c?.volumesBasis ?? null },
    });
  });
  const t = totais(itens);
  const numero = s.versaoEnviada + 1;
  let alteracaoId: string | null = null;
  if (s.situacao === 'EM_REVISAO') {
    const aprovada = await tx.alteracaoSelecaoTeste.findFirst({
      where: { escopoId: escopo.id, solicitacaoId: s.id, situacao: 'APROVADA', versaoResultante: null },
      orderBy: { solicitadaEm: 'desc' },
      select: { id: true },
    });
    if (aprovada === null) throw new ErroHttp(409, 'SITUACAO_INVALIDA', 'Revisão sem pedido de alteração aprovado. Recarregue a solicitação.');
    alteracaoId = aprovada.id;
    await tx.alteracaoSelecaoTeste.update({ where: { id: aprovada.id }, data: { versaoResultante: numero } });
  }
  await tx.versaoSelecaoTeste.create({
    data: {
      id: randomUUID(),
      escopoId: escopo.id,
      solicitacaoId: s.id,
      numero,
      itens: copia,
      observacao: s.observacao,
      totalVolumes: t.definedVolumes,
      itensEmAnalise: t.itemsInAnalysis,
      alteracaoId,
      enviadaPorId: autor.usuarioId,
      enviadaEm: agora,
    },
  });
  await tocar(tx, s, agora, { situacao: 'ENVIADA', versaoEnviada: numero, enviadaEm: s.enviadaEm ?? agora });
  const resumo = `${String(t.items)} ite${t.items === 1 ? 'm' : 'ns'}, ${volumesTexto(t.definedVolumes)} com quantidade definida${t.itemsInAnalysis > 0 ? `, ${String(t.itemsInAnalysis)} em análise` : ''}`;
  await evento(tx, s, numero === 1 ? 'ENVIADA' : 'REVISAO_ENVIADA', autor, agora, `${numero === 1 ? 'Enviada' : 'Revisão enviada'} (versão ${String(numero)}): ${resumo}.`, { versao: numero });
}

export async function pedirAlteracao(tx: Transacao, escopo: Escopo, id: string, dados: PedirAlteracaoTeste, autor: Autor, agora: Date): Promise<void> {
  const s = await bloquear(tx, escopo.id, id);
  if (s.situacao === 'RASCUNHO') throw new ErroHttp(409, 'SITUACAO_INVALIDA', 'A solicitação ainda não foi enviada: ajuste o carrinho diretamente.');
  if (s.situacao === 'ALTERACAO_SOLICITADA') throw new ErroHttp(409, 'SITUACAO_INVALIDA', 'Já existe um pedido de alteração aguardando resposta.');
  if (s.situacao === 'EM_REVISAO') throw new ErroHttp(409, 'SITUACAO_INVALIDA', 'A revisão já foi autorizada: ajuste o carrinho e envie a revisão.');
  if (s.criadoPorId !== autor.usuarioId) throw new ErroHttp(403, 'ACESSO_NEGADO', 'Só quem enviou a solicitação pede alteração.');
  await tx.alteracaoSelecaoTeste.create({
    data: { id: randomUUID(), escopoId: escopo.id, solicitacaoId: s.id, versaoBase: s.versaoEnviada, justificativa: dados.reason, solicitadaPorId: autor.usuarioId, solicitadaEm: agora },
  });
  await tocar(tx, s, agora, { situacao: 'ALTERACAO_SOLICITADA' });
  await evento(tx, s, 'ALTERACAO_SOLICITADA', autor, agora, `Pedido de alteração (sobre a versão ${String(s.versaoEnviada)}): “${dados.reason}”.`);
}

export async function responderAlteracao(tx: Transacao, escopo: Escopo, id: string, alteracaoId: string, dados: ResponderAlteracaoTeste, autor: Autor, agora: Date): Promise<void> {
  const s = await bloquear(tx, escopo.id, id);
  const alteracao = await tx.alteracaoSelecaoTeste.findFirst({ where: { escopoId: escopo.id, solicitacaoId: s.id, id: alteracaoId } });
  if (alteracao === null) throw naoEncontrado('Pedido de alteração não encontrado nesta solicitação.');
  if (alteracao.situacao !== 'PENDENTE' || s.situacao !== 'ALTERACAO_SOLICITADA') throw new ErroHttp(409, 'SITUACAO_INVALIDA', 'Este pedido de alteração já foi respondido.');
  const aprovar = dados.decision === 'APROVAR';
  await tx.alteracaoSelecaoTeste.update({
    where: { id: alteracao.id },
    data: { situacao: aprovar ? 'APROVADA' : 'RECUSADA', respondidaPorId: autor.usuarioId, respondidaEm: agora, resposta: dados.response },
  });
  // Aprovar só autoriza a revisão: a seleção muda quando o solicitante editar e enviar a nova versão.
  await tocar(tx, s, agora, { situacao: aprovar ? 'EM_REVISAO' : 'ENVIADA' });
  await evento(tx, s, aprovar ? 'ALTERACAO_APROVADA' : 'ALTERACAO_RECUSADA', autor, agora, `Alteração ${aprovar ? 'aprovada (revisão liberada)' : 'recusada'}: “${dados.response}”.`);
}

// ---------- Leitura para a interface ----------

function itemContrato(i: ItemLido): Omit<ItemSolicitacaoTeste, 'otherRequests'> {
  const av = avaliarItem(entradaDe(i));
  return {
    id: i.linha.id,
    scope: i.scope,
    palletId: i.linha.paleteId,
    palletCode: i.linha.paleteCodigo,
    content: i.content,
    presented: i.presented,
    requestedDelivery: i.linha.deliverySolicitada,
    requestedVolumes: i.linha.quantidadeSolicitada,
    needsAnalysis: av.needsAnalysis,
    analysisReason: av.analysisReason,
    deliveryNotRegistered: av.deliveryNotRegistered,
    note: i.linha.observacao,
  };
}

function agendaDe(s: { janelaId: string | null; agendaReferencia: string; agendaData: Date | null; janela: { codigo: string; nome: string } | null }): AgendaTeste {
  if (s.janelaId !== null && s.janela !== null) return { kind: 'JANELA', windowId: s.janelaId, code: s.janela.codigo, name: s.janela.nome, date: dataIso(s.agendaData) };
  return { kind: 'TESTE', reference: s.agendaReferencia, date: dataIso(s.agendaData) };
}

export async function detalhe(db: Db, escopo: Escopo, id: string, usuarioId: string, permissoes: ReadonlySet<Permissao>): Promise<SolicitacaoTeste> {
  const s = await db.solicitacaoSelecaoTeste.findFirst({
    where: { escopoId: escopo.id, id },
    include: {
      itens: { orderBy: { ordem: 'asc' } },
      janela: { select: { codigo: true, nome: true } },
      criadoPor: { select: { login: true, nome: true } },
      versoes: { orderBy: { numero: 'asc' }, include: { enviadaPor: { select: { login: true, nome: true } } } },
      alteracoes: {
        orderBy: { solicitadaEm: 'asc' },
        include: { solicitadaPor: { select: { login: true, nome: true } }, respondidaPor: { select: { login: true, nome: true } } },
      },
      eventos: { orderBy: [{ ocorridoEm: 'asc' }, { id: 'asc' }], include: { autor: { select: { login: true, nome: true } } } },
    },
  });
  if (s === null) throw naoEncontrado('Solicitação de teste não encontrada neste escopo.');
  const itens = s.itens.map(lerItem);
  // Mesmo conteúdo/palete em outras solicitações enviadas da mesma agenda: aviso, sem bloquear complementos.
  const outros = (
    await db.itemSelecaoTeste.findMany({
      where: { escopoId: escopo.id, solicitacao: { agendaChave: s.agendaChave, id: { not: s.id }, situacao: { not: 'RASCUNHO' } } },
      include: { solicitacao: { select: { id: true, codigo: true, situacao: true } } },
    })
  ).map((o) => ({ lido: lerItem(o), solicitacao: o.solicitacao }));
  const solicitar = permissoes.has('selecao_teste.solicitar');
  const autor = s.criadoPorId === usuarioId;
  const editavel = (s.situacao === 'RASCUNHO' || s.situacao === 'EM_REVISAO') && autor && solicitar;
  return {
    id: s.id,
    code: s.codigo,
    status: s.situacao,
    version: s.versao,
    agenda: agendaDe(s),
    note: s.observacao,
    createdBy: pessoa(s.criadoPor),
    createdAt: s.criadoEm.toISOString(),
    updatedAt: s.atualizadoEm.toISOString(),
    sentAt: s.enviadaEm?.toISOString() ?? null,
    sentVersion: s.versaoEnviada,
    items: itens.map((i) => ({
      ...itemContrato(i),
      otherRequests: outros
        .filter(
          (o) =>
            (i.linha.conteudoRef !== null && o.lido.linha.conteudoRef === i.linha.conteudoRef) ||
            (o.lido.linha.paleteId === i.linha.paleteId && (i.scope === 'PALETE' || o.lido.scope === 'PALETE')),
        )
        .map((o) => ({ id: o.solicitacao.id, code: o.solicitacao.codigo, status: o.solicitacao.situacao, detail: `${descreverItem(o.lido)} — ${textoPedido(o.lido)}` })),
    })),
    totals: totais(itens),
    versions: s.versoes.map((v) => {
      const itensVersao = z.array(ItemVersaoTesteSchema).parse(v.itens);
      return {
        number: v.numero,
        sentAt: v.enviadaEm.toISOString(),
        sentBy: pessoa(v.enviadaPor),
        note: v.observacao,
        totals: {
          items: itensVersao.length,
          pallets: new Set(itensVersao.map((x) => x.palletId)).size,
          definedVolumes: v.totalVolumes,
          itemsInAnalysis: v.itensEmAnalise,
        },
        changeRequestId: v.alteracaoId,
        items: itensVersao,
      };
    }),
    changeRequests: s.alteracoes.map((a) => ({
      id: a.id,
      baseVersion: a.versaoBase,
      reason: a.justificativa,
      status: a.situacao,
      requestedBy: pessoa(a.solicitadaPor),
      requestedAt: a.solicitadaEm.toISOString(),
      respondedBy: a.respondidaPor === null ? null : pessoa(a.respondidaPor),
      respondedAt: a.respondidaEm?.toISOString() ?? null,
      response: a.resposta,
      resultingVersion: a.versaoResultante,
    })),
    history: s.eventos.map((e) => {
      const texto = typeof e.detalhes === 'object' && e.detalhes !== null && 'texto' in e.detalhes && typeof e.detalhes.texto === 'string' ? e.detalhes.texto : e.tipo;
      return { at: e.ocorridoEm.toISOString(), by: pessoa(e.autor), text: texto };
    }),
    can: {
      edit: editavel,
      send: editavel && itens.length > 0,
      requestChange: s.situacao === 'ENVIADA' && autor && solicitar,
      respond: s.situacao === 'ALTERACAO_SOLICITADA' && permissoes.has('selecao_teste.responder'),
    },
  };
}

export async function listar(db: Db, escopo: Escopo, usuarioId: string): Promise<ListaSolicitacoesTeste> {
  const lista = await db.solicitacaoSelecaoTeste.findMany({
    where: { escopoId: escopo.id },
    orderBy: { numero: 'desc' },
    take: 500,
    include: {
      itens: true,
      janela: { select: { codigo: true, nome: true } },
      criadoPor: { select: { login: true, nome: true } },
      alteracoes: { where: { situacao: 'PENDENTE' }, select: { id: true } },
    },
  });
  return {
    items: lista.map((s) => ({
      id: s.id,
      code: s.codigo,
      status: s.situacao,
      agenda: agendaDe(s),
      createdBy: pessoa(s.criadoPor),
      createdAt: s.criadoEm.toISOString(),
      sentAt: s.enviadaEm?.toISOString() ?? null,
      sentVersion: s.versaoEnviada,
      totals: totais(s.itens.map(lerItem)),
      pendingChange: s.alteracoes.length > 0,
      mine: s.criadoPorId === usuarioId,
    })),
  };
}
