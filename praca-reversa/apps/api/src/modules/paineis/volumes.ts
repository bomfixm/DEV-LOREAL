/**
 * Registro operacional da janela em VOLUMES (sem SKU): meta informada pelo
 * cliente, separação, confirmação de expedição e estorno. Cada operação é
 * transacional, idempotente (rota), auditada e só acrescenta eventos.
 *
 * - Separar: o conteúdo precisa estar na praça com volumes conhecidos
 *   (contagem vigente ou informado); a soma separada + expedida em TODAS as
 *   janelas não passa da base (o mesmo conteúdo não atende pedidos
 *   incompatíveis). Bloqueio do palete serializa operações concorrentes.
 * - Expedir: só o separado aguardando desta janela; P → E na mesma
 *   transação. Saída de volumes reinicia o prazo de reconferência do palete.
 * - Estornar: evento próprio ligado ao corrigido (motivo obrigatório); o
 *   estorno de separação não desfaz o que já foi expedido.
 */
import {
  type Escopo,
  type EstornarVolumes,
  type EventoVolumes,
  type Permissao,
  type RegistrarExpedicaoVolumes,
  type RegistrarMetaVolumes,
  type RegistrarSeparacaoVolumes,
  type ResultadoVolumes,
  type VolumesJanela,
  type ConteudoVolumes,
  progressoVolumes,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp, acessoNegado, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { emFotografia } from '../indicadores/consultas.js';
import { fusoDoEscopo } from '../janelas/leitura.js';
import { registrarMovimentacaoRelevante } from '../paletes/relogio.js';
import { carregarBase, contem, pe, volumesInteiros, type ConteudoBase } from './base.js';
import { CAMPOS_JANELA, chavePalete, conteudoVolumes, metaParaContrato, metasDasJanelas, resumirJanela, somasDasJanelas, type JanelaLinha } from './janelas.js';

export interface Autor {
  usuarioId: string;
  requestId: string;
}

const SITUACOES_ABERTAS = new Set(['RASCUNHO', 'CONFIRMADA', 'PREPARACAO']);

async function janelaParaRegistro(tx: Transacao, escopoId: string, janelaId: string): Promise<JanelaLinha> {
  // Bloqueio da janela: metas e eventos da mesma janela entram em ordem.
  const [bloqueada] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM janela_devolucao WHERE id = ${janelaId}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!bloqueada) throw naoEncontrado('Janela não encontrada neste escopo.');
  const j = await tx.janelaDevolucao.findUniqueOrThrow({
    where: { id: janelaId },
    select: CAMPOS_JANELA,
  });
  if (!SITUACOES_ABERTAS.has(j.situacao)) throw new ErroHttp(409, 'CONFLITO', `A janela ${j.codigo} está ${j.situacao === 'ENCERRADA' ? 'encerrada' : 'cancelada'}: não recebe registros de volumes.`);
  return j;
}

async function progressoDaJanela(tx: Transacao, escopoId: string, janelaId: string) {
  const [metas, somas] = await Promise.all([metasDasJanelas(tx, escopoId, [janelaId]), somasDasJanelas(tx, escopoId, [janelaId])]);
  const { p, e } = pe(
    somas.get(janelaId)?.total ?? {
      separado: 0,
      estornoSeparado: 0,
      expedido: 0,
      estornoExpedido: 0,
    },
  );
  return progressoVolumes(metas.get(janelaId)?.[0]?.volumes ?? null, p, e);
}

// ---------- Meta ----------

export async function registrarMeta(tx: Transacao, escopo: Escopo, janelaId: string, dados: RegistrarMetaVolumes, autor: Autor, agora: Date): Promise<ResultadoVolumes> {
  const j = await janelaParaRegistro(tx, escopo.id, janelaId);
  if (dados.selectionId !== null) {
    const s = await tx.selecaoCliente.findFirst({
      where: { id: dados.selectionId, escopoId: escopo.id },
      select: { id: true },
    });
    if (!s) throw naoEncontrado('Seleção não encontrada neste escopo.');
  }
  const id = randomUUID();
  await tx.metaJanelaVolumes.create({
    data: {
      id,
      escopoId: escopo.id,
      janelaId,
      selecaoId: dados.selectionId,
      volumes: dados.volumes,
      referencia: dados.reference,
      informadoPorId: autor.usuarioId,
      informadoEm: agora,
    },
  });
  await registrarEvento(tx, {
    acao: 'META_JANELA_REGISTRADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'JANELA',
    alvoId: janelaId,
    detalhes: {
      janela: j.codigo,
      volumes: dados.volumes,
      selecao: dados.selectionId,
      referencia: dados.reference,
    },
    requestId: autor.requestId,
  });
  return {
    windowId: janelaId,
    events: [id],
    progress: await progressoDaJanela(tx, escopo.id, janelaId),
  };
}

// ---------- Conteúdo (vínculo ou registrado) ----------

interface Alvo {
  vinculoId: string | null;
  conteudoId: string | null;
  paleteId: string;
  paleteCodigo: string;
  descricao: string;
  base: number | null;
}

/** Lê o conteúdo e bloqueia o palete (operações do mesmo palete em ordem). */
async function alvoBloqueado(tx: Transacao, escopoId: string, linkId: string | null, contentId: string | null, exigirNaPraca: boolean): Promise<Alvo> {
  const [c] =
    linkId !== null
      ? await tx.$queryRaw<
          {
            palete_id: string;
            situacao: string;
            tipo: string | null;
            numero: string | null;
            volumes: string | null;
          }[]
        >`
          SELECT palete_id::text, situacao, tipo_documento AS tipo, numero_documento AS numero, volumes::text AS volumes
            FROM vinculo_documento_palete WHERE id = ${linkId}::uuid AND escopo_id = ${escopoId}::uuid`
      : await tx.$queryRaw<
          {
            palete_id: string;
            situacao: string;
            tipo: string | null;
            numero: string | null;
            volumes: string | null;
          }[]
        >`
          SELECT palete_id::text, situacao, tipo_documento AS tipo, numero_documento AS numero, NULL::text AS volumes
            FROM conteudo_palete WHERE id = ${contentId}::uuid AND escopo_id = ${escopoId}::uuid`;
  if (!c) throw naoEncontrado('Conteúdo não encontrado neste escopo.');
  const [p] = await tx.$queryRaw<{ codigo: string; arquivado: boolean; fluxo: string }[]>`
    SELECT codigo, arquivado_em IS NOT NULL AS arquivado, estado_fluxo::text AS fluxo FROM palete WHERE id = ${c.palete_id}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!p) throw naoEncontrado('Palete não encontrado neste escopo.');
  const descricao = `${c.tipo ?? 'Documento'} ${c.numero ?? 'sem número'} no palete ${p.codigo}`;
  if (exigirNaPraca) {
    if (c.situacao !== 'ATIVO') throw new ErroHttp(409, 'CONFLITO', `${descricao}: o conteúdo foi encerrado por uma versão posterior; atualize a lista.`);
    if (p.arquivado || !['EM_ESTOQUE', 'RESERVADO'].includes(p.fluxo)) throw new ErroHttp(409, 'CONFLITO', `O palete ${p.codigo} não está na praça: não recebe separação.`);
  }
  const [contagem] = await tx.$queryRaw<{ volumes: number }[]>`
    SELECT volumes_contados AS volumes FROM contagem_volumes
     WHERE escopo_id = ${escopoId}::uuid AND (vinculo_id = ${linkId}::uuid OR conteudo_id = ${contentId}::uuid)
     ORDER BY registrada_em DESC, id DESC LIMIT 1`;
  const informado = volumesInteiros(c.volumes);
  return {
    vinculoId: linkId,
    conteudoId: contentId,
    paleteId: c.palete_id,
    paleteCodigo: p.codigo,
    descricao,
    base: contagem?.volumes ?? informado.valor,
  };
}

/** Somas vigentes do conteúdo: em todas as janelas e nesta. */
async function somasDoAlvo(tx: Transacao, escopoId: string, alvo: Alvo, janelaId: string): Promise<{ comprometido: number; p: number; e: number }> {
  const linhas = await tx.$queryRaw<{ janela_id: string; tipo: string; volumes: bigint }[]>`
    SELECT janela_id::text, tipo, sum(volumes) AS volumes FROM evento_volumes_janela
     WHERE escopo_id = ${escopoId}::uuid AND (vinculo_id = ${alvo.vinculoId}::uuid OR conteudo_id = ${alvo.conteudoId}::uuid)
     GROUP BY 1, 2`;
  const por = new Map<
    string,
    {
      separado: number;
      estornoSeparado: number;
      expedido: number;
      estornoExpedido: number;
    }
  >();
  for (const l of linhas) {
    const s = por.get(l.janela_id) ?? {
      separado: 0,
      estornoSeparado: 0,
      expedido: 0,
      estornoExpedido: 0,
    };
    const n = Number(l.volumes);
    if (l.tipo === 'SEPARACAO') s.separado += n;
    else if (l.tipo === 'ESTORNO_SEPARACAO') s.estornoSeparado += n;
    else if (l.tipo === 'EXPEDICAO') s.expedido += n;
    else s.estornoExpedido += n;
    por.set(l.janela_id, s);
  }
  let comprometido = 0;
  for (const s of por.values()) {
    const r = pe(s);
    comprometido += r.p + r.e;
  }
  const desta = pe(
    por.get(janelaId) ?? {
      separado: 0,
      estornoSeparado: 0,
      expedido: 0,
      estornoExpedido: 0,
    },
  );
  return { comprometido, p: desta.p, e: desta.e };
}

// ---------- Separação ----------

export async function registrarSeparacao(tx: Transacao, escopo: Escopo, janelaId: string, dados: RegistrarSeparacaoVolumes, autor: Autor, agora: Date): Promise<ResultadoVolumes> {
  const j = await janelaParaRegistro(tx, escopo.id, janelaId);
  const alvo = await alvoBloqueado(tx, escopo.id, dados.linkId, dados.contentId, true);
  if (alvo.base === null) {
    throw new ErroHttp(409, 'CONFLITO', `${alvo.descricao}: volumes não informados. Registre a contagem na conferência de volumes antes de separar.`);
  }
  let selecaoId: string | null = null;
  if (dados.selectionLineId !== null) {
    const linha = await tx.linhaSelecao.findFirst({
      where: { id: dados.selectionLineId, escopoId: escopo.id },
      select: {
        selecaoId: true,
        linhaArquivo: true,
        abrangencia: true,
        numeroDocumento: true,
        tipoDocumento: true,
        paleteReferencia: true,
        selecao: { select: { situacao: true, codigo: true } },
      },
    });
    if (!linha) throw naoEncontrado('Linha da seleção não encontrada neste escopo.');
    if (linha.selecao.situacao !== 'REGISTRADA') throw new ErroHttp(409, 'CONFLITO', `A seleção ${linha.selecao.codigo} foi substituída: use a linha da versão vigente.`);
    const metas = await metasDasJanelas(tx, escopo.id, [janelaId]);
    const vigente = metas.get(janelaId)?.[0]?.vigente ?? null;
    if (vigente?.id !== linha.selecaoId) {
      throw new ErroHttp(409, 'CONFLITO', `A linha ${String(linha.linhaArquivo)} não é da seleção vigente ligada à meta da janela ${j.codigo}.`);
    }
    const [doc] =
      dados.linkId !== null
        ? await tx.$queryRaw<{ tipo: string | null; numero: string | null }[]>`SELECT tipo_documento AS tipo, numero_documento AS numero FROM vinculo_documento_palete WHERE id = ${dados.linkId}::uuid`
        : await tx.$queryRaw<{ tipo: string | null; numero: string | null }[]>`SELECT tipo_documento AS tipo, numero_documento AS numero FROM conteudo_palete WHERE id = ${dados.contentId}::uuid`;
    const confere =
      linha.abrangencia === 'PALETE'
        ? linha.paleteReferencia !== null && chavePalete(linha.paleteReferencia) === chavePalete(alvo.paleteCodigo)
        : linha.numeroDocumento !== null && doc?.numero === linha.numeroDocumento && (linha.tipoDocumento === null || doc.tipo === linha.tipoDocumento);
    if (!confere) throw new ErroHttp(409, 'CONFLITO', `${alvo.descricao} não corresponde à linha ${String(linha.linhaArquivo)} da seleção.`);
    selecaoId = linha.selecaoId;
  }
  const somas = await somasDoAlvo(tx, escopo.id, alvo, janelaId);
  if (somas.comprometido + dados.volumes > alvo.base) {
    const livre = Math.max(alvo.base - somas.comprometido, 0);
    throw new ErroHttp(
      409,
      'CONFLITO',
      `${alvo.descricao}: ${String(alvo.base)} volume(s) na base, ${String(somas.comprometido)} já separado(s)/expedido(s) em janelas; disponível ${String(livre)}. A mesma parte não atende dois pedidos.`,
    );
  }
  const id = randomUUID();
  await tx.eventoVolumesJanela.create({
    data: {
      id,
      escopoId: escopo.id,
      janelaId,
      selecaoId,
      linhaSelecaoId: dados.selectionLineId,
      vinculoId: alvo.vinculoId,
      conteudoId: alvo.conteudoId,
      paleteId: alvo.paleteId,
      tipo: 'SEPARACAO',
      volumes: dados.volumes,
      autorId: autor.usuarioId,
      ocorridoEm: agora,
    },
  });
  await registrarEvento(tx, {
    acao: 'SEPARACAO_VOLUMES_REGISTRADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'JANELA',
    alvoId: janelaId,
    detalhes: {
      janela: j.codigo,
      palete: alvo.paleteCodigo,
      conteudo: alvo.descricao,
      volumes: dados.volumes,
      evento: id,
    },
    requestId: autor.requestId,
  });
  return {
    windowId: janelaId,
    events: [id],
    progress: await progressoDaJanela(tx, escopo.id, janelaId),
  };
}

// ---------- Expedição ----------

export async function registrarExpedicao(tx: Transacao, escopo: Escopo, janelaId: string, dados: RegistrarExpedicaoVolumes, autor: Autor, agora: Date): Promise<ResultadoVolumes> {
  const j = await janelaParaRegistro(tx, escopo.id, janelaId);
  const repetidos = new Set<string>();
  const ids: string[] = [];
  const paletes = new Set<string>();
  // Ordem estável (por palete) para evitar impasse entre expedições simultâneas.
  const itens = [...dados.items].sort((a, b) => (a.linkId ?? a.contentId ?? '').localeCompare(b.linkId ?? b.contentId ?? ''));
  for (const item of itens) {
    const chave = item.linkId ?? item.contentId ?? '';
    if (repetidos.has(chave)) throw new ErroHttp(400, 'REQUISICAO_INVALIDA', 'O mesmo conteúdo aparece duas vezes na expedição: informe uma linha por conteúdo.');
    repetidos.add(chave);
    const alvo = await alvoBloqueado(tx, escopo.id, item.linkId, item.contentId, false);
    const somas = await somasDoAlvo(tx, escopo.id, alvo, janelaId);
    if (item.volumes > somas.p) {
      throw new ErroHttp(
        409,
        'CONFLITO',
        `${alvo.descricao}: ${String(somas.p)} volume(s) separado(s) aguardando nesta janela; não é possível expedir ${String(item.volumes)}. Registre a separação antes.`,
      );
    }
    const id = randomUUID();
    await tx.eventoVolumesJanela.create({
      data: {
        id,
        escopoId: escopo.id,
        janelaId,
        vinculoId: alvo.vinculoId,
        conteudoId: alvo.conteudoId,
        paleteId: alvo.paleteId,
        tipo: 'EXPEDICAO',
        volumes: item.volumes,
        motivo: null,
        autorId: autor.usuarioId,
        ocorridoEm: agora,
      },
    });
    ids.push(id);
    paletes.add(alvo.paleteId);
  }
  // Saída de volumes é movimentação física: reinicia o prazo de reconferência.
  await registrarMovimentacaoRelevante(tx, escopo.id, [...paletes], 'SAIDA_PARCIAL', agora);
  await registrarEvento(tx, {
    acao: 'EXPEDICAO_VOLUMES_CONFIRMADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'JANELA',
    alvoId: janelaId,
    detalhes: {
      janela: j.codigo,
      itens: dados.items.length,
      volumes: dados.items.reduce((t, i) => t + i.volumes, 0),
      referencia: dados.reference,
    },
    requestId: autor.requestId,
  });
  return {
    windowId: janelaId,
    events: ids,
    progress: await progressoDaJanela(tx, escopo.id, janelaId),
  };
}

// ---------- Estorno ----------

export async function estornarVolumes(
  tx: Transacao,
  escopo: Escopo,
  janelaId: string,
  dados: EstornarVolumes,
  autor: Autor,
  permissoes: ReadonlySet<Permissao>,
  agora: Date,
): Promise<ResultadoVolumes> {
  const j = await janelaParaRegistro(tx, escopo.id, janelaId);
  const ev = await tx.eventoVolumesJanela.findFirst({
    where: { id: dados.eventId, escopoId: escopo.id, janelaId },
    select: {
      id: true,
      tipo: true,
      volumes: true,
      vinculoId: true,
      conteudoId: true,
      selecaoId: true,
      linhaSelecaoId: true,
      estornos: { select: { volumes: true } },
    },
  });
  if (!ev) throw naoEncontrado('Registro de separação/expedição não encontrado nesta janela.');
  if (ev.tipo !== 'SEPARACAO' && ev.tipo !== 'EXPEDICAO') throw new ErroHttp(409, 'CONFLITO', 'Um estorno não é estornado: registre a operação novamente.');
  if (!permissoes.has(ev.tipo === 'SEPARACAO' ? 'expedicao.preparar' : 'expedicao.confirmar')) throw acessoNegado();
  const alvo = await alvoBloqueado(tx, escopo.id, ev.vinculoId, ev.conteudoId, false);
  const restante = ev.volumes - ev.estornos.reduce((t, x) => t + x.volumes, 0);
  const volumes = dados.volumes ?? restante;
  if (restante <= 0) throw new ErroHttp(409, 'CONFLITO', 'Este registro já foi estornado por inteiro.');
  if (volumes > restante) throw new ErroHttp(409, 'CONFLITO', `Só ${String(restante)} volume(s) deste registro podem ser estornados.`);
  const somas = await somasDoAlvo(tx, escopo.id, alvo, janelaId);
  if (ev.tipo === 'SEPARACAO' && volumes > somas.p) {
    throw new ErroHttp(409, 'CONFLITO', `${alvo.descricao}: só ${String(somas.p)} volume(s) aguardam expedição; o já expedido não volta pela correção da separação (estorne a expedição primeiro).`);
  }
  const id = randomUUID();
  const tipo = ev.tipo === 'SEPARACAO' ? 'ESTORNO_SEPARACAO' : 'ESTORNO_EXPEDICAO';
  await tx.eventoVolumesJanela.create({
    data: {
      id,
      escopoId: escopo.id,
      janelaId,
      selecaoId: ev.selecaoId,
      linhaSelecaoId: ev.linhaSelecaoId,
      vinculoId: ev.vinculoId,
      conteudoId: ev.conteudoId,
      paleteId: alvo.paleteId,
      tipo,
      volumes,
      motivo: dados.reason,
      eventoCorrigidoId: ev.id,
      autorId: autor.usuarioId,
      ocorridoEm: agora,
    },
  });
  await registrarEvento(tx, {
    acao: 'VOLUMES_ESTORNADOS',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'JANELA',
    alvoId: janelaId,
    detalhes: {
      janela: j.codigo,
      tipo,
      volumes,
      eventoCorrigido: ev.id,
      conteudo: alvo.descricao,
      motivo: dados.reason,
    },
    requestId: autor.requestId,
  });
  return {
    windowId: janelaId,
    events: [id],
    progress: await progressoDaJanela(tx, escopo.id, janelaId),
  };
}

// ---------- Leitura (visão interna da janela) ----------

/** Volumes da janela: meta, histórico das metas, conteúdos com separação, linhas da seleção vigente e eventos. */
export async function volumesDaJanela(db: Banco, escopo: Escopo, janelaId: string, agora: Date): Promise<VolumesJanela> {
  return emFotografia(db, async (tx) => {
    const j = await tx.janelaDevolucao.findFirst({
      where: { id: janelaId, escopoId: escopo.id },
      select: CAMPOS_JANELA,
    });
    if (!j) throw naoEncontrado('Janela não encontrada neste escopo.');
    const [base, metas, somas, fuso] = [
      await carregarBase(tx, escopo.id),
      await metasDasJanelas(tx, escopo.id, [janelaId]),
      await somasDasJanelas(tx, escopo.id, [janelaId]),
      await fusoDoEscopo(tx, escopo.id),
    ];
    const resumo = await resumirJanela(tx, escopo.id, j, metas.get(janelaId), somas.get(janelaId), base);
    const { linhasCalculadas, ...janela } = resumo;
    const eventos = await tx.eventoVolumesJanela.findMany({
      where: { escopoId: escopo.id, janelaId },
      orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
      take: 500,
      select: {
        id: true,
        tipo: true,
        volumes: true,
        ocorridoEm: true,
        motivo: true,
        eventoCorrigidoId: true,
        palete: { select: { codigo: true } },
        vinculo: {
          select: {
            tipoDocumento: true,
            numeroDocumento: true,
            delivery: true,
          },
        },
        conteudo: {
          select: {
            tipoDocumento: true,
            numeroDocumento: true,
            delivery: true,
          },
        },
        linhaSelecao: { select: { linhaArquivo: true } },
        autor: { select: { login: true, nome: true } },
        estornos: { select: { volumes: true } },
      },
    });
    const comEvento = new Set([...(somas.get(janelaId)?.porAlvo.keys() ?? [])]);
    const conteudos: ConteudoVolumes[] = base.conteudos.filter((c) => comEvento.has(c.id)).map((c) => conteudoVolumes(c, base, janelaId));
    const notas: string[] = [];
    const meta = metas.get(janelaId)?.[0];
    if (meta?.selecao && meta.vigente && meta.selecao.id !== meta.vigente.id) {
      notas.push(`A seleção ${meta.selecao.codigo} da meta foi substituída pela versão ${String(meta.vigente.versaoPedido)} (${meta.vigente.codigo}): confira a meta e as preparações.`);
    }
    if (janela.needsReview) notas.push('Há separações registradas em linha de versão substituída da seleção: revise-as (nada foi desfeito).');
    return {
      consultedAt: agora.toISOString(),
      timezone: fuso,
      window: janela,
      goals: (metas.get(janelaId) ?? []).map(metaParaContrato),
      contents: conteudos,
      lines: linhasCalculadas?.linhas ?? [],
      events: eventos.map((e): EventoVolumes => ({
        id: e.id,
        type: e.tipo as EventoVolumes['type'],
        volumes: e.volumes,
        at: e.ocorridoEm.toISOString(),
        palletCode: e.palete.codigo,
        documentType: e.vinculo?.tipoDocumento ?? e.conteudo?.tipoDocumento ?? null,
        documentNumber: e.vinculo?.numeroDocumento ?? e.conteudo?.numeroDocumento ?? null,
        delivery: e.vinculo?.delivery ?? e.conteudo?.delivery ?? null,
        selectionLineRow: e.linhaSelecao?.linhaArquivo ?? null,
        correctsEventId: e.eventoCorrigidoId,
        reversible: e.tipo === 'SEPARACAO' || e.tipo === 'EXPEDICAO' ? Math.max(e.volumes - e.estornos.reduce((t, x) => t + x.volumes, 0), 0) : 0,
        reason: e.motivo,
        by: { login: e.autor.login, name: e.autor.nome },
      })),
      reviewNotes: notas,
    };
  });
}

/** Busca de conteúdos do estoque atual para separar (palete, NF/NFD/MI, Delivery ou remetente). */
export async function buscarConteudos(db: Banco, escopo: Escopo, janelaId: string, texto: string): Promise<ConteudoVolumes[]> {
  const j = await db.janelaDevolucao.findFirst({
    where: { id: janelaId, escopoId: escopo.id },
    select: { id: true },
  });
  if (!j) throw naoEncontrado('Janela não encontrada neste escopo.');
  const base = await carregarBase(db, escopo.id);
  const achados: ConteudoBase[] = base.conteudos.filter((c) => {
    const pal = base.paletePorId.get(c.paleteId);
    return contem(pal?.codigo ?? null, texto) || contem(c.numero, texto) || contem(c.delivery, texto) || contem(c.remetente, texto) || contem(pal?.endereco ?? null, texto);
  });
  return achados.slice(0, 100).map((c) => conteudoVolumes(c, base, janelaId));
}
