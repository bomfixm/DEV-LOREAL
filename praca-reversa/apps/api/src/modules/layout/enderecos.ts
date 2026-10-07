/**
 * Tabela explícita de correspondência entre posição desenhada e endereço real
 * (complemento "seleção do cliente"). Fluxo: a operação informa a sequência de
 * uma faixa (segmentos e sentido) → o servidor gera a proposta → quem revisa
 * confirma. Só a correspondência CONFIRMADA resolve um endereço para uma
 * posição do mapa; nada é presumido para faixas sem sequência (nem A101 como
 * início universal, nem paridade sozinha). Mudar a tabela não move paletes:
 * o vínculo do palete é com o ID da posição.
 */
import {
  chaveEndereco,
  expandirSegmentos,
  textoEndereco,
  type ConfirmarEnderecos,
  type CorrespondenciaEnderecos,
  type DefinirSequenciaSchema,
  type EnderecoNormalizado,
  type Escopo,
  type FaixaEnderecos,
  type LadoFaixa,
  type ResolucaoEndereco,
  type ResultadoLayout,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { bloquearLayoutAtivo, concluirAlteracao, conferirRevisao, type Autor } from './servico.js';

type DadosSequencia = z.output<typeof DefinirSequenciaSchema>;
type Db = Banco | Transacao;

const pessoa = (u: { login: string; nome: string } | null) => (u ? { login: u.login, name: u.nome } : null);

function ladoDe(lado: string | null): LadoFaixa | null {
  return lado === 'ESQUERDO' || lado === 'DIREITO' || lado === 'UNICO' ? lado : null;
}

/** Tabela de correspondência do layout ativo, por bloco e faixa. */
export async function lerCorrespondencia(db: Db, escopoId: string): Promise<CorrespondenciaEnderecos> {
  const layout = await db.layout.findFirst({
    where: { escopoId, ativo: true },
    orderBy: { criadoEm: 'desc' },
    select: {
      id: true,
      revisao: true,
      elementos: { where: { tipo: 'BLOCO' }, orderBy: { codigo: 'asc' } },
      fileiras: {
        orderBy: { ordem: 'asc' },
        include: {
          sequencia: { include: { informadoPor: { select: { login: true, nome: true } } } },
          posicoes: { where: { retiradaEm: null }, orderBy: { numero: 'asc' }, include: { endereco: true } },
        },
      },
    },
  });
  if (!layout) return { layoutId: null, revision: 0, blocks: [], pending: ['Nenhum layout ativo neste escopo.'], confirmedAddresses: 0, proposedAddresses: 0 };
  let confirmados = 0;
  let propostos = 0;
  const pendentes: string[] = [];
  const blocks = layout.elementos.map((b) => {
    const faixas = layout.fileiras.filter((f) => f.blocoCodigo === b.codigo && f.posicoes.length > 0);
    const desativado = faixas.length > 0 && faixas.every((f) => f.posicoes.every((p) => p.desativada));
    const rows: FaixaEnderecos[] = faixas.map((f) => {
      const enderecos = f.posicoes.flatMap((p) =>
        p.endereco
          ? [
              {
                positionId: p.id,
                positionCode: p.codigo,
                visualOrder: p.endereco.ordemVisual,
                address: p.endereco.endereco,
                state: p.endereco.situacao,
                origin: p.endereco.origem as 'SEQUENCIA' | 'MANUAL' | 'DEMONSTRACAO',
                confirmedAt: p.endereco.confirmadoEm?.toISOString() ?? null,
              },
            ]
          : [],
      );
      const conf = enderecos.filter((e) => e.state === 'CONFIRMADO').length;
      confirmados += conf;
      propostos += enderecos.length - conf;
      const state = enderecos.length === 0 ? 'SEM_SEQUENCIA' : conf === f.posicoes.length ? 'CONFIRMADA' : 'PROPOSTA';
      if (!desativado && b.prefixoEndereco !== null && state !== 'CONFIRMADA') {
        pendentes.push(
          `${b.nomeOperacional ?? b.codigo} · ${f.codigo} (${ladoDe(f.lado) === 'UNICO' ? 'faixa única' : ladoDe(f.lado) === 'ESQUERDO' ? 'lado esquerdo' : ladoDe(f.lado) === 'DIREITO' ? 'lado direito' : 'lado não informado'}): ${state === 'SEM_SEQUENCIA' ? 'sequência inicial/final e sentido não informados' : 'proposta aguardando confirmação'}.`,
        );
      }
      return {
        rowId: f.id,
        rowCode: f.codigo,
        side: ladoDe(f.lado),
        positions: f.posicoes.length,
        state,
        sequence: f.sequencia
          ? {
              segments: f.sequencia.segmentos,
              direction: f.sequencia.sentido,
              source: f.sequencia.fonte,
              notes: f.sequencia.observacao,
              informedAt: f.sequencia.informadoEm.toISOString(),
              informedBy: pessoa(f.sequencia.informadoPor),
            }
          : null,
        addresses: enderecos,
      };
    });
    if (!desativado && b.prefixoEndereco === null && faixas.length > 0) pendentes.push(`${b.codigo}: bloco sem prefixo de endereço (nome operacional não aplicado).`);
    return {
      elementId: b.id,
      code: b.codigo,
      label: b.rotulo,
      operationalName: b.nomeOperacional,
      addressPrefix: b.prefixoEndereco,
      deactivated: desativado,
      rows,
    };
  });
  return { layoutId: layout.id, revision: layout.revisao, blocks, pending: pendentes, confirmedAddresses: confirmados, proposedAddresses: propostos };
}

async function faixaDoLayout(tx: Transacao, layoutId: string, fileiraId: string) {
  const fileira = await tx.fileira.findFirst({
    where: { id: fileiraId, layoutId },
    include: { posicoes: { where: { retiradaEm: null }, orderBy: { numero: 'asc' }, include: { endereco: true } } },
  });
  if (!fileira) throw naoEncontrado('Faixa (fileira do desenho) não encontrada no layout ativo.');
  const bloco = fileira.blocoCodigo === null ? null : await tx.elementoLayout.findFirst({ where: { layoutId, codigo: fileira.blocoCodigo, tipo: 'BLOCO' } });
  if (!bloco?.prefixoEndereco) {
    throw new ErroHttp(409, 'CONFLITO', `A faixa ${fileira.codigo} pertence a um bloco sem prefixo de endereço: aplique o nome operacional (fileira ou GR) antes.`);
  }
  if (fileira.posicoes.length === 0) throw new ErroHttp(409, 'CONFLITO', `A faixa ${fileira.codigo} não tem posições desenhadas.`);
  return { fileira, bloco, prefixo: bloco.prefixoEndereco };
}

/**
 * Registra a sequência informada de uma faixa e gera a proposta (substitui a
 * proposta anterior). Trocar endereços já confirmados exige motivo.
 */
export async function definirSequencia(tx: Transacao, escopo: Escopo, fileiraId: string, dados: DadosSequencia, autor: Autor, agora: Date): Promise<ResultadoLayout> {
  const bloqueado = await bloquearLayoutAtivo(tx, escopo.id);
  conferirRevisao(bloqueado, dados.expectedRevision);
  const { fileira, bloco, prefixo } = await faixaDoLayout(tx, bloqueado.id, fileiraId);
  const expandida = expandirSegmentos(dados.segments);
  if (!expandida.ok) throw requisicaoInvalida(expandida.mensagem);
  const n = fileira.posicoes.length;
  if (expandida.codigos.length !== n) {
    throw new ErroHttp(
      422,
      'SEQUENCIA_INCOMPATIVEL',
      `A faixa ${fileira.codigo} tem ${String(n)} posições desenhadas e a sequência informada tem ${String(expandida.codigos.length)} endereço(s). Nada foi gravado.`,
    );
  }
  const confirmadas = fileira.posicoes.filter((p) => p.endereco?.situacao === 'CONFIRMADO');
  if (confirmadas.length > 0 && dados.replaceConfirmedReason === null) {
    throw new ErroHttp(409, 'CONFLITO', `A faixa ${fileira.codigo} já tem ${String(confirmadas.length)} endereço(s) confirmado(s). Informe o motivo para substituí-los.`);
  }
  const lado = ladoDe(fileira.lado) ?? 'UNICO';
  const propostas = fileira.posicoes.map((p, i) => {
    const codigo = dados.direction === 'P01_PRIMEIRO' ? expandida.codigos[i] : expandida.codigos[n - 1 - i];
    if (codigo === undefined) throw new Error('Sequência incompleta.');
    return { posicao: p, codigo, chave: chaveEndereco(prefixo, codigo) };
  });
  const chaves = propostas.map((p) => p.chave);
  const emOutraFaixa = await tx.enderecoPosicao.findFirst({
    where: { layoutId: bloqueado.id, chave: { in: chaves }, fileiraId: { not: fileira.id } },
    select: { endereco: true, posicao: { select: { codigo: true } } },
  });
  if (emOutraFaixa) {
    throw new ErroHttp(409, 'CONFLITO', `O endereço ${emOutraFaixa.endereco} já corresponde à posição ${emOutraFaixa.posicao.codigo} de outra faixa.`);
  }
  const antes = fileira.posicoes.flatMap((p) => (p.endereco ? [`${p.codigo}=${p.endereco.endereco} (${p.endereco.situacao.toLowerCase()})`] : []));
  await tx.enderecoPosicao.deleteMany({ where: { layoutId: bloqueado.id, fileiraId: fileira.id } });
  await tx.enderecoPosicao.createMany({
    data: propostas.map((p) => ({
      id: randomUUID(),
      escopoId: escopo.id,
      layoutId: bloqueado.id,
      posicaoId: p.posicao.id,
      fileiraId: fileira.id,
      prefixo,
      codigoLocal: p.codigo,
      endereco: textoEndereco(prefixo, p.codigo),
      chave: p.chave,
      lado,
      ordemVisual: p.posicao.numero,
      situacao: 'PROPOSTO' as const,
      origem: 'SEQUENCIA',
      propostoPorId: autor.usuarioId,
      propostoEm: agora,
    })),
  });
  const existente = await tx.sequenciaEnderecoFaixa.findFirst({ where: { escopoId: escopo.id, fileiraId: fileira.id }, select: { id: true } });
  const sequencia = {
    segmentos: dados.segments,
    sentido: dados.direction,
    fonte: dados.source,
    observacao: dados.notes,
    informadoPorId: autor.usuarioId,
    informadoEm: agora,
  };
  if (existente) await tx.sequenciaEnderecoFaixa.update({ where: { id: existente.id }, data: { ...sequencia, versao: { increment: 1 } } });
  else await tx.sequenciaEnderecoFaixa.create({ data: { id: randomUUID(), escopoId: escopo.id, layoutId: bloqueado.id, fileiraId: fileira.id, ...sequencia } });
  const primeira = propostas[0];
  const ultima = propostas.at(-1);
  return concluirAlteracao(tx, escopo.id, bloqueado, autor, {
    acao: 'SEQUENCIA_ENDERECOS_INFORMADA',
    alvoTipo: 'FILEIRA',
    alvoId: fileira.id,
    resumo: `${bloco.nomeOperacional ?? bloco.codigo} · ${fileira.codigo}: proposta de ${String(n)} endereço(s) (${primeira ? `${primeira.posicao.codigo} = ${textoEndereco(prefixo, primeira.codigo)}` : ''} … ${ultima ? `${ultima.posicao.codigo} = ${textoEndereco(prefixo, ultima.codigo)}` : ''}), a confirmar.${dados.replaceConfirmedReason ? ` Substituiu endereços confirmados: ${dados.replaceConfirmedReason}.` : ''}`,
    antes: antes.length > 0 ? { enderecos: antes } : null,
    depois: { segmentos: dados.segments, sentido: dados.direction, fonte: dados.source, propostos: n },
  });
}

/** Confirma a proposta revisada da faixa (todas as posições de uma vez). */
export async function confirmarEnderecos(tx: Transacao, escopo: Escopo, fileiraId: string, dados: ConfirmarEnderecos, autor: Autor, agora: Date): Promise<ResultadoLayout> {
  const bloqueado = await bloquearLayoutAtivo(tx, escopo.id);
  conferirRevisao(bloqueado, dados.expectedRevision);
  const { fileira, bloco } = await faixaDoLayout(tx, bloqueado.id, fileiraId);
  const propostos = fileira.posicoes.filter((p) => p.endereco?.situacao === 'PROPOSTO');
  if (propostos.length === 0) throw new ErroHttp(409, 'CONFLITO', `A faixa ${fileira.codigo} não tem proposta aguardando confirmação.`);
  if (propostos.length !== dados.expectedProposed) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `A proposta da faixa ${fileira.codigo} mudou (${String(propostos.length)} endereço(s)). Revise a proposta atual.`);
  }
  await tx.enderecoPosicao.updateMany({
    where: { layoutId: bloqueado.id, fileiraId: fileira.id, situacao: 'PROPOSTO' },
    data: { situacao: 'CONFIRMADO', confirmadoPorId: autor.usuarioId, confirmadoEm: agora, versao: { increment: 1 } },
  });
  return concluirAlteracao(tx, escopo.id, bloqueado, autor, {
    acao: 'ENDERECOS_CONFIRMADOS',
    alvoTipo: 'FILEIRA',
    alvoId: fileira.id,
    resumo: `${bloco.nomeOperacional ?? bloco.codigo} · ${fileira.codigo}: ${String(propostos.length)} endereço(s) confirmado(s) na tabela de correspondência.`,
    antes: null,
    depois: { confirmados: propostos.map((p) => `${p.codigo}=${p.endereco?.endereco ?? ''}`) },
  });
}

export interface EnderecoResolvido {
  resolucao: ResolucaoEndereco;
  posicaoId: string | null;
  posicaoCodigo: string | null;
  disponivel: boolean;
  desativada: boolean;
  /** Palete atualmente vinculado à posição (registros atuais). */
  ocupanteId: string | null;
  ocupanteCodigo: string | null;
  mensagem: string;
}

/**
 * Resolve endereços normalizados contra a tabela confirmada do layout ativo.
 * A chave inclui a fileira: "15 - A120" e "13 - A120" são posições distintas.
 * Equivalência aproximada (ex.: letra ausente) vira só sugestão no texto.
 */
export async function resolverEnderecos(db: Db, escopoId: string, enderecos: readonly EnderecoNormalizado[]): Promise<Map<string, EnderecoResolvido>> {
  const resultado = new Map<string, EnderecoResolvido>();
  const validos = enderecos.filter((e): e is Extract<EnderecoNormalizado, { ok: true }> => e.ok);
  if (validos.length === 0) return resultado;
  const layout = await db.layout.findFirst({ where: { escopoId, ativo: true }, orderBy: { criadoEm: 'desc' }, select: { id: true } });
  const prefixos = new Set(
    layout === null
      ? []
      : (await db.elementoLayout.findMany({ where: { layoutId: layout.id, prefixoEndereco: { not: null } }, select: { prefixoEndereco: true } })).map((e) => e.prefixoEndereco ?? ''),
  );
  const linhas =
    layout === null
      ? []
      : await db.enderecoPosicao.findMany({
          where: { layoutId: layout.id, prefixo: { in: [...new Set(validos.map((v) => v.prefixo))] } },
          select: {
            chave: true,
            prefixo: true,
            codigoLocal: true,
            situacao: true,
            posicao: { select: { id: true, codigo: true, disponivel: true, desativada: true, retiradaEm: true, palete: { select: { id: true, codigo: true } } } },
          },
        });
  const porChave = new Map(linhas.map((l) => [l.chave, l]));
  const semLetra = new Map<string, string>();
  for (const l of linhas) semLetra.set(`${l.prefixo}|${l.codigoLocal.replace(/^[A-Z]+/, '')}`, textoEndereco(l.prefixo, l.codigoLocal));
  for (const e of validos) {
    if (resultado.has(e.chave)) continue;
    const vazio = { posicaoId: null, posicaoCodigo: null, disponivel: false, desativada: false, ocupanteId: null, ocupanteCodigo: null };
    if (!prefixos.has(e.prefixo)) {
      resultado.set(e.chave, { ...vazio, resolucao: 'PREFIXO_DESCONHECIDO', mensagem: `Nenhum bloco do mapa tem o prefixo ${e.prefixo} (fileira ou GR).` });
      continue;
    }
    const l = porChave.get(e.chave);
    if (l?.posicao.retiradaEm === null) {
      const base = {
        posicaoId: l.posicao.id,
        posicaoCodigo: l.posicao.codigo,
        disponivel: l.posicao.disponivel,
        desativada: l.posicao.desativada,
        ocupanteId: l.posicao.palete?.id ?? null,
        ocupanteCodigo: l.posicao.palete?.codigo ?? null,
      };
      resultado.set(
        e.chave,
        l.situacao === 'CONFIRMADO'
          ? { ...base, resolucao: 'POSICAO', mensagem: `${e.endereco} corresponde à posição ${l.posicao.codigo}.` }
          : { ...base, resolucao: 'PROPOSTA', mensagem: `${e.endereco} tem correspondência proposta (${l.posicao.codigo}) ainda não confirmada.` },
      );
      continue;
    }
    const sugestao = semLetra.get(`${e.prefixo}|${e.codigoLocal.replace(/^[A-Z]+/, '')}`);
    resultado.set(e.chave, {
      ...vazio,
      resolucao: 'SEM_POSICAO',
      mensagem: `${e.endereco} ainda não tem posição visual na tabela de correspondência${sugestao !== undefined && sugestao !== e.endereco ? ` (existe ${sugestao}; o arquivo não foi corrigido)` : ''}.`,
    });
  }
  return resultado;
}

/** Endereços reais das posições (para exibir junto do código da posição). */
export async function enderecosDasPosicoes(db: Db, posicaoIds: readonly string[]): Promise<Map<string, { endereco: string; confirmado: boolean }>> {
  if (posicaoIds.length === 0) return new Map();
  const linhas = await db.enderecoPosicao.findMany({ where: { posicaoId: { in: [...new Set(posicaoIds)] } }, select: { posicaoId: true, endereco: true, situacao: true } });
  return new Map(linhas.map((l) => [l.posicaoId, { endereco: l.endereco, confirmado: l.situacao === 'CONFIRMADO' }]));
}
