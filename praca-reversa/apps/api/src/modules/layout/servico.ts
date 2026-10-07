import {
  chaveDeCodigo,
  intersectam,
  verificarLayout,
  type AlterarElemento,
  type AlterarPosicao,
  type CriarLayout,
  type Escopo,
  type HistoricoLayout,
  type Layout,
  type NovaZona,
  type NovoBloco,
  type ResultadoLayout,
  type RetirarPosicao,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica, restricaoDoBanco } from '../../db/erros.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import {
  PARAMETROS_PADRAO,
  ParametrosGeometriaSchema,
  caixaTituloZona,
  gerarBloco,
  larguraFileira,
  topoInicial,
  type ParametrosGeometria,
} from './blocos.js';
import { lerLayoutAtivo } from './leitura.js';
import { doisDigitos, type RetanguloUd } from './tipos.js';

export interface Autor {
  usuarioId: string;
  requestId: string;
}

export interface LayoutBloqueado {
  id: string;
  revisao: number;
  largura: number;
  altura: number;
  parametros: unknown;
}

export interface Registro {
  acao: string;
  alvoTipo: string;
  alvoId: string | null;
  resumo: string;
  antes: Prisma.InputJsonObject | null;
  depois: Prisma.InputJsonObject | null;
}

/**
 * Bloqueia a linha do layout ativo até o fim da transação: alterações de
 * layout do mesmo escopo acontecem uma de cada vez.
 */
export async function bloquearLayoutAtivo(tx: Transacao, escopoId: string): Promise<LayoutBloqueado> {
  const linhas = await tx.$queryRaw<LayoutBloqueado[]>`
    SELECT id::text AS id, revisao, largura, altura, parametros
      FROM layout
     WHERE escopo_id = ${escopoId}::uuid AND ativo
     ORDER BY criado_em DESC
     LIMIT 1
       FOR UPDATE`;
  const layout = linhas[0];
  if (!layout) throw naoEncontrado('Nenhum layout ativo neste escopo. Crie o layout antes de configurar blocos e posições.');
  return layout;
}

export function conferirRevisao(layout: LayoutBloqueado, esperada: number): void {
  if (layout.revisao !== esperada) {
    throw new ErroHttp(
      409,
      'CONFLITO_VERSAO',
      `O layout foi alterado por outra pessoa (revisão atual ${String(layout.revisao)}; você viu a ${String(esperada)}). Recarregue e confira antes de repetir.`,
    );
  }
}

function parametrosDe(layout: { parametros: unknown }): ParametrosGeometria {
  const resultado = ParametrosGeometriaSchema.safeParse(layout.parametros);
  return resultado.success ? resultado.data : PARAMETROS_PADRAO;
}

interface Ret {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Retângulos que precisam caber na área do desenho. */
function retangulosDe(layout: Layout): Ret[] {
  return [
    ...layout.elements.flatMap((e) => (e.labelBox ? [e, e.labelBox] : [e])),
    ...layout.rows.flatMap((f) => [f, f.labelBox]),
    ...layout.positions,
  ];
}

/**
 * Regras complementares às do contrato: corredores, docas e contornos de
 * bloco não cobrem posições de outros blocos.
 */
function problemasDeSobreposicao(layout: Layout): string[] {
  const problemas: string[] = [];
  const fileiras = new Map(layout.rows.map((f) => [f.id, f]));
  for (const e of layout.elements) {
    if (e.kind === 'ZONA') continue;
    for (const p of layout.positions) {
      const doProprioBloco = e.kind === 'BLOCO' && fileiras.get(p.rowId)?.blockCode === e.code;
      if (!doProprioBloco && intersectam(e, p)) problemas.push(`${e.label} sobre a posição ${p.code}`);
    }
  }
  return problemas;
}

/**
 * Fecha uma alteração: ajusta a área do desenho para caber tudo, valida a
 * geometria (sobreposições e títulos sobre posições), aumenta a revisão,
 * grava o histórico e o evento de auditoria. Qualquer problema reverte tudo.
 */
export async function concluirAlteracao(
  tx: Transacao,
  escopoId: string,
  bloqueado: LayoutBloqueado,
  autor: Autor,
  registro: Registro,
): Promise<ResultadoLayout> {
  const layout = await lerLayoutAtivo(tx, escopoId);
  if (!layout) throw naoEncontrado('Layout ativo não encontrado.');
  const g = parametrosDe(bloqueado);
  const retangulos = retangulosDe(layout);
  if (retangulos.some((r) => r.x < 0 || r.y < 0)) {
    throw new ErroHttp(422, 'GEOMETRIA_INVALIDA', 'A alteração levaria parte do desenho para fora da área (coordenadas negativas).');
  }
  const direita = Math.max(0, ...retangulos.map((r) => r.x + r.width));
  const base = Math.max(0, ...retangulos.map((r) => r.y + r.height));
  const largura = Math.max(bloqueado.largura, direita + g.margem);
  const altura = Math.max(bloqueado.altura, base + g.margem);

  const problemas = [...verificarLayout({ ...layout, width: largura, height: altura }), ...problemasDeSobreposicao(layout)];
  if (problemas.length > 0) {
    const resumo = problemas.slice(0, 3).join('; ');
    throw new ErroHttp(422, 'GEOMETRIA_INVALIDA', `Alteração recusada: ${resumo}${problemas.length > 3 ? '…' : ''}.`);
  }

  const revisao = bloqueado.revisao + 1;
  await tx.layout.update({ where: { id: bloqueado.id }, data: { revisao, largura, altura } });
  await tx.historicoLayout.create({
    data: {
      escopoId,
      layoutId: bloqueado.id,
      revisao,
      acao: registro.acao,
      alvoTipo: registro.alvoTipo,
      alvoId: registro.alvoId,
      resumo: registro.resumo,
      antes: registro.antes ?? Prisma.DbNull,
      depois: registro.depois ?? Prisma.DbNull,
      autorId: autor.usuarioId,
    },
  });
  await registrarEvento(tx, {
    acao: 'LAYOUT_ALTERADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: registro.alvoTipo,
    alvoId: registro.alvoId,
    detalhes: { revisao, operacao: registro.acao },
    requestId: autor.requestId,
  });
  return { layoutId: bloqueado.id, revision: revisao, summary: registro.resumo };
}

/** Converte erros do banco em respostas claras (gatilhos e índices únicos). */
function traduzirErroDoBanco(erro: unknown, unico: string): never {
  const restricao = restricaoDoBanco(erro);
  if (restricao === 'POSICAO_OCUPADA') {
    throw new ErroHttp(409, 'CONFLITO', 'A posição tem palete vinculado: não pode ficar indisponível nem ser retirada.');
  }
  if (ehViolacaoUnica(erro)) throw new ErroHttp(409, 'CONFLITO', unico);
  throw erro;
}

export async function criarLayout(tx: Transacao, escopo: Escopo, dados: CriarLayout, autor: Autor, agora: Date): Promise<ResultadoLayout> {
  // Serializa a criação por escopo: um único layout ativo.
  await tx.$queryRaw`SELECT id FROM escopo WHERE id = ${escopo.id}::uuid FOR UPDATE`;
  if (await tx.layout.findFirst({ where: { escopoId: escopo.id, ativo: true }, select: { id: true } })) {
    throw new ErroHttp(409, 'CONFLITO', 'Este escopo já tem um layout ativo. Configure blocos e posições nele.');
  }
  const g = PARAMETROS_PADRAO;
  const total = await tx.layout.count({ where: { escopoId: escopo.id } });
  const id = randomUUID();
  await tx.layout.create({
    data: {
      id,
      escopoId: escopo.id,
      codigo: `PRACA-${String(total + 1)}`,
      nome: dados.name,
      versao: `configurado-${agora.toISOString().slice(0, 10)}`,
      largura: 2 * g.margem + larguraFileira(g, 15),
      altura: topoInicial(g) + g.alturaPosicao + g.margem,
      capacidadeTotal: null,
      esquematico: true,
      ficticio: escopo.demo,
      parametros: g,
      observacao: 'Layout configurado no aplicativo. Medidas de desenho, sem levantamento físico; capacidade total não confirmada.',
    },
  });
  await registrarEvento(tx, {
    acao: 'LAYOUT_CRIADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'LAYOUT',
    alvoId: id,
    detalhes: { nome: dados.name },
    requestId: autor.requestId,
  });
  return { layoutId: id, revision: 1, summary: `Layout "${dados.name}" criado, ainda sem blocos.` };
}

export async function adicionarBloco(tx: Transacao, escopo: Escopo, dados: NovoBloco, autor: Autor): Promise<ResultadoLayout> {
  const bloqueado = await bloquearLayoutAtivo(tx, escopo.id);
  conferirRevisao(bloqueado, dados.expectedRevision);
  const g = parametrosDe(bloqueado);
  const layoutId = bloqueado.id;

  const [fileiras, posicoes, elementos] = await Promise.all([
    tx.fileira.findMany({ where: { layoutId }, select: { codigo: true, ordem: true, y: true, altura: true } }),
    tx.posicao.findMany({ where: { layoutId }, select: { codigo: true, y: true, altura: true, retiradaEm: true } }),
    tx.elementoLayout.findMany({ where: { layoutId }, select: { codigo: true, tipo: true, y: true, altura: true } }),
  ]);
  // O novo bloco vai depois de tudo o que está desenhado (exceto zonas, que podem envolver blocos).
  const bases = [
    ...fileiras.map((f) => f.y + f.altura),
    ...posicoes.filter((p) => p.retiradaEm === null).map((p) => p.y + p.altura),
    ...elementos.filter((e) => e.tipo !== 'ZONA').map((e) => e.y + e.altura),
  ];
  const topo = bases.length === 0 ? topoInicial(g) : Math.max(...bases) + g.espacoEntreBlocos;
  const ordemInicial = Math.max(0, ...fileiras.map((f) => f.ordem)) + 1;
  const codigosElementos = new Set(elementos.map((e) => e.codigo));
  let numero = elementos.filter((e) => e.tipo === 'BLOCO').length + 1;
  while (codigosElementos.has(`B${doisDigitos(numero)}`)) numero++;
  const codigoBloco = `B${doisDigitos(numero)}`;

  const gerado = gerarBloco(
    g,
    { tipo: dados.kind, posicoesPorFileira: dados.positionsPerRow, titulo: dados.title },
    { topo, ordemInicial, codigoBloco, ocupacaoLevantada: false },
  );

  // Códigos novos não podem coincidir com códigos existentes (inclusive de posições retiradas).
  const chavesPosicoes = new Set(posicoes.map((p) => chaveDeCodigo(p.codigo)));
  const repetida = gerado.posicoes.find((p) => chavesPosicoes.has(chaveDeCodigo(p.codigo)));
  if (repetida) throw new ErroHttp(409, 'CONFLITO', `Já existe posição com o código ${repetida.codigo}. Renomeie-a antes de acrescentar o bloco.`);
  const codigosFileiras = new Set(fileiras.map((f) => f.codigo));
  const fileiraRepetida = gerado.fileiras.find((f) => codigosFileiras.has(f.codigo));
  if (fileiraRepetida) throw new ErroHttp(409, 'CONFLITO', `Já existe fileira ${fileiraRepetida.codigo}.`);
  const paleteComCodigo = await tx.palete.findFirst({
    where: { escopoId: escopo.id, codigoBusca: { in: gerado.posicoes.map((p) => chaveDeCodigo(p.codigo)) } },
    select: { codigo: true },
  });
  if (paleteComCodigo) throw new ErroHttp(409, 'CONFLITO', `O código ${paleteComCodigo.codigo} já identifica um palete; posição e palete precisam de códigos distintos.`);

  const e = gerado.elemento;
  await tx.elementoLayout.create({
    data: {
      id: randomUUID(),
      escopoId: escopo.id,
      layoutId,
      tipo: 'BLOCO',
      codigo: e.codigo,
      rotulo: e.rotulo,
      ficticio: escopo.demo,
      x: e.x,
      y: e.y,
      largura: e.largura,
      altura: e.altura,
      rotuloX: e.caixaRotulo?.x ?? null,
      rotuloY: e.caixaRotulo?.y ?? null,
      rotuloLargura: e.caixaRotulo?.largura ?? null,
      rotuloAltura: e.caixaRotulo?.altura ?? null,
    },
  });
  const idsFileiras = new Map<string, string>();
  for (const f of gerado.fileiras) {
    const id = randomUUID();
    idsFileiras.set(f.codigo, id);
    await tx.fileira.create({
      data: {
        id,
        escopoId: escopo.id,
        layoutId,
        codigo: f.codigo,
        rotulo: f.rotulo,
        ordem: f.ordem,
        blocoCodigo: f.blocoCodigo,
        x: f.x,
        y: f.y,
        largura: f.largura,
        altura: f.altura,
        rotuloX: f.caixaRotulo.x,
        rotuloY: f.caixaRotulo.y,
        rotuloLargura: f.caixaRotulo.largura,
        rotuloAltura: f.caixaRotulo.altura,
      },
    });
  }
  await tx.posicao.createMany({
    data: gerado.posicoes.map((p) => ({
      id: randomUUID(),
      escopoId: escopo.id,
      layoutId,
      fileiraId: idsFileiras.get(p.fileiraCodigo) ?? '',
      codigo: p.codigo,
      codigoProvisorio: true,
      numero: p.numero,
      x: p.x,
      y: p.y,
      largura: p.largura,
      altura: p.altura,
      disponivel: true,
      ocupacaoLevantada: p.ocupacaoLevantada,
    })),
  });

  const codigos = gerado.fileiras.map((f) => f.codigo).join(' e ');
  const descricao = dados.kind === 'PAR' ? 'par de fileiras' : 'fileira única';
  return concluirAlteracao(tx, escopo.id, bloqueado, autor, {
    acao: 'BLOCO_ACRESCENTADO',
    alvoTipo: 'BLOCO',
    alvoId: codigoBloco,
    resumo: `Bloco ${codigoBloco} acrescentado ao final: ${descricao} de ${String(dados.positionsPerRow)} posições (${codigos}).`,
    antes: null,
    depois: {
      codigo: codigoBloco,
      titulo: dados.title,
      tipo: dados.kind,
      posicoesPorFileira: dados.positionsPerRow,
      fileiras: gerado.fileiras.map((f) => f.codigo),
    },
  });
}

/** Retângulo com título; deslocado junto ou recalculado (zonas). */
function retanguloElemento(e: { x: number; y: number; largura: number; altura: number }): RetanguloUd {
  return { x: e.x, y: e.y, largura: e.largura, altura: e.altura };
}

/** Faixa de título da zona, descartada se cobrir alguma posição. */
async function caixaZonaSemPosicoes(tx: Transacao, layoutId: string, r: RetanguloUd): Promise<RetanguloUd | null> {
  const caixa = caixaTituloZona(r);
  if (caixa === null) return null;
  // Filtro aproximado no banco (canto superior esquerdo); interseção exata em memória.
  const candidatas = await tx.posicao.findMany({
    where: { layoutId, retiradaEm: null, x: { lt: caixa.x + caixa.largura }, y: { lt: caixa.y + caixa.altura } },
    select: { x: true, y: true, largura: true, altura: true },
  });
  const cobre = candidatas.some((p) =>
    intersectam({ x: caixa.x, y: caixa.y, width: caixa.largura, height: caixa.altura }, { x: p.x, y: p.y, width: p.largura, height: p.altura }),
  );
  return cobre ? null : caixa;
}

export async function alterarElemento(
  tx: Transacao,
  escopo: Escopo,
  codigo: string,
  dados: AlterarElemento,
  autor: Autor,
): Promise<ResultadoLayout> {
  const bloqueado = await bloquearLayoutAtivo(tx, escopo.id);
  conferirRevisao(bloqueado, dados.expectedRevision);
  const elemento = await tx.elementoLayout.findFirst({ where: { layoutId: bloqueado.id, codigo } });
  if (!elemento) throw naoEncontrado('Bloco ou zona não encontrado no layout ativo.');
  if ((dados.width !== undefined || dados.height !== undefined) && elemento.tipo !== 'ZONA') {
    throw requisicaoInvalida('Somente zonas podem ser redimensionadas. Blocos têm o tamanho das suas fileiras.');
  }

  const dx = dados.dx ?? 0;
  const dy = dados.dy ?? 0;
  const novo: RetanguloUd = {
    x: elemento.x + dx,
    y: elemento.y + dy,
    largura: dados.width ?? elemento.largura,
    altura: dados.height ?? elemento.altura,
  };
  if (novo.x < 0 || novo.y < 0) {
    throw new ErroHttp(422, 'GEOMETRIA_INVALIDA', 'A alteração levaria parte do desenho para fora da área (coordenadas negativas).');
  }

  const operacional = dados.operationalName !== undefined || dados.addressPrefix !== undefined;
  if (operacional && elemento.tipo !== 'BLOCO') throw requisicaoInvalida('Nome operacional e prefixo de endereço são de blocos.');
  const nomeOperacional = dados.operationalName === undefined ? elemento.nomeOperacional : dados.operationalName;
  const prefixoEndereco = dados.addressPrefix === undefined ? elemento.prefixoEndereco : dados.addressPrefix;
  if (prefixoEndereco !== elemento.prefixoEndereco && elemento.prefixoEndereco !== null) {
    const usados = await tx.enderecoPosicao.count({ where: { layoutId: bloqueado.id, prefixo: elemento.prefixoEndereco } });
    if (usados > 0) {
      throw new ErroHttp(
        409,
        'CONFLITO',
        `O prefixo ${elemento.prefixoEndereco} já tem ${String(usados)} endereço(s) na tabela de correspondência. Revise a tabela antes de trocar o prefixo.`,
      );
    }
  }
  if (prefixoEndereco !== null && prefixoEndereco !== elemento.prefixoEndereco) {
    const outro = await tx.elementoLayout.findFirst({ where: { layoutId: bloqueado.id, prefixoEndereco, id: { not: elemento.id } }, select: { codigo: true } });
    if (outro) throw new ErroHttp(409, 'CONFLITO', `O prefixo ${prefixoEndereco} já pertence ao bloco ${outro.codigo}.`);
  }

  const fileiras = await tx.fileira.findMany({ where: { layoutId: bloqueado.id, blocoCodigo: codigo }, select: { id: true } });
  if (dx !== 0 || dy !== 0) {
    const ids = fileiras.map((f) => f.id);
    if (ids.length > 0) {
      const minimo = await tx.posicao.aggregate({ where: { fileiraId: { in: ids } }, _min: { x: true, y: true } });
      const minimoFileira = await tx.fileira.aggregate({ where: { id: { in: ids } }, _min: { x: true, y: true, rotuloX: true, rotuloY: true } });
      const valores = [
        (minimo._min.x ?? 0) + dx,
        (minimo._min.y ?? 0) + dy,
        (minimoFileira._min.x ?? 0) + dx,
        (minimoFileira._min.y ?? 0) + dy,
        (minimoFileira._min.rotuloX ?? 0) + dx,
        (minimoFileira._min.rotuloY ?? 0) + dy,
      ];
      if (valores.some((v) => v < 0)) {
        throw new ErroHttp(422, 'GEOMETRIA_INVALIDA', 'A alteração levaria parte do desenho para fora da área (coordenadas negativas).');
      }
      await tx.fileira.updateMany({
        where: { id: { in: ids } },
        data: { x: { increment: dx }, y: { increment: dy }, rotuloX: { increment: dx }, rotuloY: { increment: dy } },
      });
      await tx.posicao.updateMany({ where: { fileiraId: { in: ids } }, data: { x: { increment: dx }, y: { increment: dy } } });
    }
  }

  // O título acompanha o deslocamento; zona redimensionada (ou sem título) recalcula a faixa.
  const redimensionada = dados.width !== undefined || dados.height !== undefined;
  let caixa: RetanguloUd | null;
  if (elemento.tipo === 'ZONA' && (redimensionada || elemento.rotuloX === null)) {
    caixa = await caixaZonaSemPosicoes(tx, bloqueado.id, novo);
  } else if (elemento.rotuloX !== null && elemento.rotuloY !== null && elemento.rotuloLargura !== null && elemento.rotuloAltura !== null) {
    caixa = { x: elemento.rotuloX + dx, y: elemento.rotuloY + dy, largura: elemento.rotuloLargura, altura: elemento.rotuloAltura };
  } else {
    caixa = null;
  }
  await tx.elementoLayout.update({
    where: { id: elemento.id },
    data: {
      rotulo: dados.label ?? elemento.rotulo,
      x: novo.x,
      y: novo.y,
      largura: novo.largura,
      altura: novo.altura,
      rotuloX: caixa?.x ?? null,
      rotuloY: caixa?.y ?? null,
      rotuloLargura: caixa?.largura ?? null,
      rotuloAltura: caixa?.altura ?? null,
      nomeOperacional,
      prefixoEndereco,
    },
  });

  const partes: string[] = [];
  if (dados.label !== undefined && dados.label !== elemento.rotulo) partes.push(`título "${dados.label}"`);
  if (dx !== 0 || dy !== 0) partes.push(`deslocado ${String(dx)}, ${String(dy)} (com ${String(fileiras.length)} fileira(s))`);
  if (dados.width !== undefined || dados.height !== undefined) partes.push(`dimensões ${String(novo.largura)} × ${String(novo.altura)}`);
  if (nomeOperacional !== elemento.nomeOperacional) partes.push(`nome operacional ${nomeOperacional === null ? 'removido' : `"${nomeOperacional}"`}`);
  if (prefixoEndereco !== elemento.prefixoEndereco) partes.push(`prefixo de endereço ${prefixoEndereco ?? 'removido'}`);
  const antes = { rotulo: elemento.rotulo, nomeOperacional: elemento.nomeOperacional, prefixoEndereco: elemento.prefixoEndereco, ...retanguloElemento(elemento) };
  return concluirAlteracao(tx, escopo.id, bloqueado, autor, {
    acao: 'ELEMENTO_ALTERADO',
    alvoTipo: elemento.tipo,
    alvoId: elemento.codigo,
    resumo: `${elemento.tipo === 'ZONA' ? 'Zona' : 'Bloco'} ${elemento.codigo}: ${partes.join('; ') || 'sem mudança visível'}.`,
    antes,
    depois: { rotulo: dados.label ?? elemento.rotulo, nomeOperacional, prefixoEndereco, ...novo },
  });
}

export async function criarZona(tx: Transacao, escopo: Escopo, dados: NovaZona, autor: Autor): Promise<ResultadoLayout> {
  const bloqueado = await bloquearLayoutAtivo(tx, escopo.id);
  conferirRevisao(bloqueado, dados.expectedRevision);
  const retangulo: RetanguloUd = { x: dados.x, y: dados.y, largura: dados.width, altura: dados.height };
  const caixa = await caixaZonaSemPosicoes(tx, bloqueado.id, retangulo);
  try {
    await tx.elementoLayout.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        layoutId: bloqueado.id,
        tipo: 'ZONA',
        codigo: dados.code,
        rotulo: dados.label,
        ficticio: escopo.demo,
        x: retangulo.x,
        y: retangulo.y,
        largura: retangulo.largura,
        altura: retangulo.altura,
        rotuloX: caixa?.x ?? null,
        rotuloY: caixa?.y ?? null,
        rotuloLargura: caixa?.largura ?? null,
        rotuloAltura: caixa?.altura ?? null,
      },
    });
  } catch (erro) {
    traduzirErroDoBanco(erro, `Já existe bloco ou zona com o código ${dados.code}.`);
  }
  return concluirAlteracao(tx, escopo.id, bloqueado, autor, {
    acao: 'ZONA_CRIADA',
    alvoTipo: 'ZONA',
    alvoId: dados.code,
    resumo: `Zona ${dados.code} "${dados.label}" criada${caixa === null ? ' (título só na lista: não cabe sem cobrir posições)' : ''}.`,
    antes: null,
    depois: { codigo: dados.code, rotulo: dados.label, ...retangulo },
  });
}

async function posicaoAtiva(tx: Transacao, layoutId: string, id: string) {
  const posicao = await tx.posicao.findFirst({ where: { id, layoutId, retiradaEm: null } });
  if (!posicao) throw naoEncontrado('Posição não encontrada no layout ativo deste escopo.');
  return posicao;
}

export async function alterarPosicao(
  tx: Transacao,
  escopo: Escopo,
  id: string,
  dados: AlterarPosicao,
  autor: Autor,
): Promise<ResultadoLayout> {
  const bloqueado = await bloquearLayoutAtivo(tx, escopo.id);
  conferirRevisao(bloqueado, dados.expectedRevision);
  const posicao = await posicaoAtiva(tx, bloqueado.id, id);
  const ocupante = await tx.palete.findFirst({ where: { escopoId: escopo.id, posicaoId: id }, select: { codigo: true } });

  const codigo = dados.code ?? posicao.codigo;
  if (codigo !== posicao.codigo) {
    const chave = chaveDeCodigo(codigo);
    const outras = await tx.posicao.findMany({ where: { layoutId: bloqueado.id, id: { not: id } }, select: { codigo: true } });
    if (outras.some((p) => chaveDeCodigo(p.codigo) === chave)) {
      throw new ErroHttp(409, 'CONFLITO', `Já existe posição com código equivalente a ${codigo} neste layout (inclusive retiradas).`);
    }
    if (await tx.palete.findFirst({ where: { escopoId: escopo.id, codigoBusca: chave }, select: { id: true } })) {
      throw new ErroHttp(409, 'CONFLITO', `O código ${codigo} já identifica um palete; posição e palete precisam de códigos distintos.`);
    }
  }
  const disponivel = dados.available ?? posicao.disponivel;
  if (!disponivel && posicao.disponivel && ocupante) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      `A posição ${posicao.codigo} tem o palete ${ocupante.codigo}: não pode ficar indisponível. Mudança de local é uma movimentação (etapa 05).`,
    );
  }
  const motivo = disponivel ? null : dados.available === false ? (dados.unavailableReason ?? null) : posicao.motivoIndisponibilidade;
  const provisorio = dados.officialCode === undefined ? posicao.codigoProvisorio : !dados.officialCode;
  // Área desativada: tornar disponível é a ativação explícita (a posição passa a receber paletes).
  const desativada = posicao.desativada && !disponivel;

  try {
    await tx.posicao.update({
      where: { id },
      data: { codigo, codigoProvisorio: provisorio, disponivel, motivoIndisponibilidade: motivo, desativada },
    });
  } catch (erro) {
    traduzirErroDoBanco(erro, `Já existe posição com o código ${codigo} neste layout.`);
  }

  const antes = {
    codigo: posicao.codigo,
    provisorio: posicao.codigoProvisorio,
    disponivel: posicao.disponivel,
    motivo: posicao.motivoIndisponibilidade,
    desativada: posicao.desativada,
  };
  const depois = { codigo, provisorio, disponivel, motivo, desativada };
  const partes: string[] = [];
  if (codigo !== posicao.codigo) partes.push(`código ${posicao.codigo} → ${codigo}`);
  if (provisorio !== posicao.codigoProvisorio) partes.push(provisorio ? 'código marcado como provisório' : 'código marcado como oficial');
  if (posicao.desativada && !desativada) partes.push('ativada (saiu da área desativada)');
  else if (disponivel !== posicao.disponivel) partes.push(disponivel ? 'disponível' : `indisponível (${motivo ?? ''})`);
  return concluirAlteracao(tx, escopo.id, bloqueado, autor, {
    acao: 'POSICAO_ALTERADA',
    alvoTipo: 'POSICAO',
    alvoId: id,
    resumo: `Posição ${posicao.codigo}: ${partes.join('; ') || 'sem mudança'}${ocupante ? ` (palete ${ocupante.codigo} continua vinculado pelo ID da posição)` : ''}.`,
    antes,
    depois,
  });
}

export async function retirarPosicao(
  tx: Transacao,
  escopo: Escopo,
  id: string,
  dados: RetirarPosicao,
  autor: Autor,
  agora: Date,
): Promise<ResultadoLayout> {
  const bloqueado = await bloquearLayoutAtivo(tx, escopo.id);
  conferirRevisao(bloqueado, dados.expectedRevision);
  const posicao = await posicaoAtiva(tx, bloqueado.id, id);
  const ocupante = await tx.palete.findFirst({ where: { escopoId: escopo.id, posicaoId: id }, select: { codigo: true } });
  if (ocupante) {
    throw new ErroHttp(409, 'CONFLITO', `A posição ${posicao.codigo} tem o palete ${ocupante.codigo}: não pode ser retirada do desenho.`);
  }
  try {
    await tx.posicao.update({ where: { id }, data: { retiradaEm: agora, motivoRetirada: dados.reason } });
  } catch (erro) {
    traduzirErroDoBanco(erro, 'Conflito ao retirar a posição.');
  }
  return concluirAlteracao(tx, escopo.id, bloqueado, autor, {
    acao: 'POSICAO_RETIRADA',
    alvoTipo: 'POSICAO',
    alvoId: id,
    resumo: `Posição ${posicao.codigo} retirada do desenho: ${dados.reason}. O código não será reutilizado.`,
    antes: { codigo: posicao.codigo, disponivel: posicao.disponivel },
    depois: { codigo: posicao.codigo, retirada: true, motivo: dados.reason },
  });
}

export async function listarHistorico(db: Banco, escopoId: string, limite: number): Promise<HistoricoLayout> {
  const itens = await db.historicoLayout.findMany({
    where: { escopoId, layout: { ativo: true } },
    include: { autor: { select: { login: true, nome: true } } },
    orderBy: [{ ocorridoEm: 'desc' }, { revisao: 'desc' }],
    take: limite,
  });
  const objeto = (v: Prisma.JsonValue): Record<string, unknown> | null =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  return {
    items: itens.map((h) => ({
      revision: h.revisao,
      at: h.ocorridoEm.toISOString(),
      action: h.acao,
      targetType: h.alvoTipo,
      targetId: h.alvoId,
      summary: h.resumo,
      actor: h.autor ? { login: h.autor.login, name: h.autor.nome } : null,
      before: objeto(h.antes),
      after: objeto(h.depois),
    })),
  };
}
