/**
 * Aplicação do desenho aprovado (complemento "seleção do cliente"):
 *
 * - criarLayoutDesenhoAprovado: escopo sem layout com posições recebe o
 *   desenho completo (194 ativas + 300 desativadas) com os nomes confirmados;
 * - aplicarNomenclaturaAprovada: blocos FB01–FB07 já existentes recebem os
 *   nomes Fileiras 11–16/GR e os prefixos de endereço (IDs, QR, vínculos e
 *   histórico ficam como estão; idempotente);
 * - sincronizarLayoutComDesenho: atualiza um layout existente pelo CÓDIGO de
 *   elemento/fileira/posição (preserva IDs, nunca duplica posição); posições
 *   fora do desenho só são retiradas se estiverem livres. Usada no seed da
 *   demonstração.
 */
import type { CriarDesenhoAprovado, Escopo, ResultadoLayout } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Transacao } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { PARAMETROS_PADRAO } from './blocos.js';
import { gerarDesenhoAprovado, lerDesenhoAprovado, nomenclaturaAprovada, rotuloBloco, type ArquivoDesenhoAprovado } from './desenho-aprovado.js';
import type { LayoutGerado } from './tipos.js';

export interface AutorLayout {
  usuarioId: string;
  requestId: string;
}

function dadosElemento(e: LayoutGerado['elementos'][number]) {
  return {
    tipo: e.tipo,
    codigo: e.codigo,
    rotulo: e.rotulo,
    ficticio: e.ficticio,
    x: e.x,
    y: e.y,
    largura: e.largura,
    altura: e.altura,
    rotuloX: e.caixaRotulo?.x ?? null,
    rotuloY: e.caixaRotulo?.y ?? null,
    rotuloLargura: e.caixaRotulo?.largura ?? null,
    rotuloAltura: e.caixaRotulo?.altura ?? null,
    nomeOperacional: e.nomeOperacional ?? null,
    prefixoEndereco: e.prefixoEndereco ?? null,
  };
}

function dadosFileira(f: LayoutGerado['fileiras'][number]) {
  return {
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
    lado: f.lado ?? null,
  };
}

/** Disponibilidade da posição gerada (área desativada sempre indisponível). */
function disponibilidade(p: LayoutGerado['posicoes'][number]) {
  return {
    disponivel: p.disponivel,
    desativada: p.desativada ?? false,
    motivoIndisponibilidade: p.disponivel ? null : (p.motivoIndisponibilidade ?? null),
  };
}

/**
 * Atualiza o layout para o desenho gerado, casando pelo código. IDs existentes
 * são mantidos; o que falta é criado (com o ID sugerido quando livre); posições
 * fora do desenho são retiradas se livres; elementos fora do desenho saem.
 * Posição ocupada fora do desenho interrompe tudo (nada é movido por suposição).
 * Ordem: retirar sobras e liberar códigos antes de gravar as novas geometrias.
 */
export async function sincronizarLayoutComDesenho(
  tx: Transacao,
  escopoId: string,
  layoutId: string,
  gerado: LayoutGerado,
  ids: { elemento: (codigo: string) => string; fileira: (codigo: string) => string; posicao: (codigo: string) => string },
  agora: Date,
): Promise<{ criadas: number; atualizadas: number; retiradas: number }> {
  const [elementos, fileiras, posicoes, ocupadas] = await Promise.all([
    tx.elementoLayout.findMany({ where: { layoutId } }),
    tx.fileira.findMany({ where: { layoutId } }),
    tx.posicao.findMany({ where: { layoutId } }),
    tx.palete.findMany({ where: { escopoId, posicao: { layoutId } }, select: { posicaoId: true, codigo: true } }),
  ]);
  const ocupante = new Map(ocupadas.map((p) => [p.posicaoId, p.codigo]));
  const desejadas = new Set(gerado.posicoes.map((p) => p.codigo));
  const sobras = posicoes.filter((p) => p.retiradaEm === null && !desejadas.has(p.codigo));
  const sobraOcupada = sobras.find((p) => ocupante.has(p.id));
  if (sobraOcupada) {
    throw new Error(
      `A posição ${sobraOcupada.codigo} tem o palete ${ocupante.get(sobraOcupada.id) ?? ''} e não existe no desenho aprovado: mova o palete antes de aplicar o desenho.`,
    );
  }
  // Posições do desenho que estão ocupadas precisam continuar disponíveis.
  for (const p of gerado.posicoes) {
    const existente = posicoes.find((x) => x.codigo === p.codigo);
    if (existente && ocupante.has(existente.id) && !p.disponivel) {
      throw new Error(`A posição ${p.codigo} tem palete e ficaria desativada no desenho: ative-a ou mova o palete antes.`);
    }
  }
  for (const p of sobras) {
    await tx.posicao.update({ where: { id: p.id }, data: { retiradaEm: agora, motivoRetirada: 'Fora do desenho aprovado da praça (código não reutilizado).' } });
  }
  const elementosDesejados = new Set(gerado.elementos.map((e) => e.codigo));
  const elementosSobras = elementos.filter((e) => !elementosDesejados.has(e.codigo));
  if (elementosSobras.length > 0) await tx.elementoLayout.deleteMany({ where: { id: { in: elementosSobras.map((e) => e.id) } } });

  let criadas = 0;
  let atualizadas = 0;
  for (const e of gerado.elementos) {
    const existente = elementos.find((x) => x.codigo === e.codigo);
    if (existente) await tx.elementoLayout.update({ where: { id: existente.id }, data: dadosElemento(e) });
    else await tx.elementoLayout.create({ data: { id: ids.elemento(e.codigo), escopoId, layoutId, ...dadosElemento(e) } });
  }
  const idFileira = new Map<string, string>();
  for (const f of gerado.fileiras) {
    const existente = fileiras.find((x) => x.codigo === f.codigo);
    if (existente) {
      await tx.fileira.update({ where: { id: existente.id }, data: dadosFileira(f) });
      idFileira.set(f.codigo, existente.id);
    } else {
      const sugerido = ids.fileira(f.codigo);
      const id = fileiras.some((x) => x.id === sugerido) ? randomUUID() : sugerido;
      await tx.fileira.create({ data: { id, escopoId, layoutId, ...dadosFileira(f) } });
      idFileira.set(f.codigo, id);
    }
  }
  for (const p of gerado.posicoes) {
    const fileiraId = idFileira.get(p.fileiraCodigo);
    if (!fileiraId) throw new Error(`Fileira ${p.fileiraCodigo} ausente.`);
    const existente = posicoes.find((x) => x.codigo === p.codigo);
    const geometria = { fileiraId, numero: p.numero, x: p.x, y: p.y, largura: p.largura, altura: p.altura };
    if (existente) {
      if (existente.retiradaEm !== null) throw new Error(`A posição ${p.codigo} foi retirada antes e o código não é reutilizado.`);
      // Disponibilidade só muda para entrar/sair da área desativada do desenho.
      const d = disponibilidade(p);
      const mudaArea = existente.desativada !== d.desativada;
      await tx.posicao.update({
        where: { id: existente.id },
        data: { ...geometria, ...(mudaArea || d.desativada ? d : {}) },
      });
      atualizadas += 1;
    } else {
      const sugerido = ids.posicao(p.codigo);
      const id = posicoes.some((x) => x.id === sugerido) ? randomUUID() : sugerido;
      await tx.posicao.create({
        data: { id, escopoId, layoutId, codigo: p.codigo, codigoProvisorio: true, ocupacaoLevantada: p.ocupacaoLevantada, ...geometria, ...disponibilidade(p) },
      });
      criadas += 1;
    }
  }
  return { criadas, atualizadas, retiradas: sobras.length };
}

/**
 * Cria o layout do desenho aprovado. Só em escopo sem layout ativo, ou com
 * layout ativo ainda vazio (criado no aplicativo sem blocos), que é usado.
 */
export async function criarLayoutDesenhoAprovado(
  tx: Transacao,
  escopo: Escopo,
  dados: Required<Pick<CriarDesenhoAprovado, 'name'>>,
  autor: AutorLayout,
  agora: Date,
  config: ArquivoDesenhoAprovado = lerDesenhoAprovado(),
): Promise<ResultadoLayout> {
  await tx.$queryRaw`SELECT id FROM escopo WHERE id = ${escopo.id}::uuid FOR UPDATE`;
  const ativo = await tx.layout.findFirst({ where: { escopoId: escopo.id, ativo: true }, select: { id: true, revisao: true, _count: { select: { posicoes: true } } } });
  if (ativo && ativo._count.posicoes > 0) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      'Este escopo já tem layout com posições: o desenho aprovado não redesenha um layout em uso. Use "Aplicar nomes operacionais" se os blocos FB01–FB07 já existem.',
    );
  }
  const gerado = gerarDesenhoAprovado(config);
  const observacao = `${config.fonte} ${config.aviso}`;
  let layoutId: string;
  let revisao: number;
  if (ativo) {
    layoutId = ativo.id;
    revisao = ativo.revisao + 1;
    await tx.layout.update({ where: { id: layoutId }, data: { largura: gerado.largura, altura: gerado.altura, versao: config.versao, observacao, revisao } });
  } else {
    layoutId = randomUUID();
    revisao = 1;
    const total = await tx.layout.count({ where: { escopoId: escopo.id } });
    await tx.layout.create({
      data: {
        id: layoutId,
        escopoId: escopo.id,
        codigo: `PRACA-${String(total + 1)}`,
        nome: dados.name,
        versao: config.versao,
        largura: gerado.largura,
        altura: gerado.altura,
        capacidadeTotal: null,
        esquematico: true,
        ficticio: escopo.demo,
        parametros: PARAMETROS_PADRAO,
        observacao,
      },
    });
  }
  const r = await sincronizarLayoutComDesenho(tx, escopo.id, layoutId, gerado, { elemento: () => randomUUID(), fileira: () => randomUUID(), posicao: () => randomUUID() }, agora);
  const ativas = gerado.posicoes.filter((p) => p.disponivel).length;
  const desativadas = gerado.posicoes.length - ativas;
  const resumo = `Desenho aprovado aplicado: ${String(ativas)} posições ativas e ${String(desativadas)} desativadas (prontas para ativar), com os nomes operacionais confirmados.`;
  if (ativo) {
    await tx.historicoLayout.create({
      data: {
        escopoId: escopo.id,
        layoutId,
        revisao,
        acao: 'DESENHO_APROVADO_APLICADO',
        alvoTipo: 'LAYOUT',
        alvoId: layoutId,
        resumo,
        antes: Prisma.DbNull,
        depois: { versao: config.versao, posicoes: r.criadas },
        autorId: autor.usuarioId,
      },
    });
  }
  await registrarEvento(tx, {
    acao: ativo ? 'LAYOUT_ALTERADO' : 'LAYOUT_CRIADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'LAYOUT',
    alvoId: layoutId,
    detalhes: { operacao: 'DESENHO_APROVADO', versao: config.versao, ativas, desativadas },
    requestId: autor.requestId,
  });
  return { layoutId, revision: revisao, summary: resumo };
}

/**
 * Nomes operacionais confirmados nos blocos FB01–FB07 existentes (sem mexer em
 * geometria, IDs, QR, vínculos ou histórico de posições). Idempotente.
 */
export async function aplicarNomenclaturaAprovada(
  tx: Transacao,
  escopo: Escopo,
  revisaoEsperada: number,
  autor: AutorLayout,
  config: ArquivoDesenhoAprovado = lerDesenhoAprovado(),
): Promise<ResultadoLayout> {
  const [layout] = await tx.$queryRaw<{ id: string; revisao: number }[]>`
    SELECT id::text AS id, revisao FROM layout WHERE escopo_id = ${escopo.id}::uuid AND ativo ORDER BY criado_em DESC LIMIT 1 FOR UPDATE`;
  if (!layout) throw new ErroHttp(404, 'NAO_ENCONTRADO', 'Nenhum layout ativo neste escopo.');
  if (layout.revisao !== revisaoEsperada) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `O layout foi alterado por outra pessoa (revisão atual ${String(layout.revisao)}). Recarregue e confira.`);
  }
  const nomes = nomenclaturaAprovada(config);
  const blocos = await tx.elementoLayout.findMany({ where: { layoutId: layout.id, codigo: { in: nomes.map((n) => n.codigo) }, tipo: 'BLOCO' } });
  const faltam = nomes.filter((n) => !blocos.some((b) => b.codigo === n.codigo));
  if (faltam.length > 0) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      `Os blocos ${faltam.map((f) => f.codigo).join(', ')} não existem neste layout: a nomenclatura só é aplicada aos blocos existentes do desenho aprovado.`,
    );
  }
  const outros = await tx.elementoLayout.findMany({
    where: { layoutId: layout.id, prefixoEndereco: { in: nomes.map((n) => n.prefixo) }, codigo: { notIn: nomes.map((n) => n.codigo) } },
    select: { codigo: true, prefixoEndereco: true },
  });
  if (outros.length > 0) throw new ErroHttp(409, 'CONFLITO', `O prefixo ${outros[0]?.prefixoEndereco ?? ''} já está no bloco ${outros[0]?.codigo ?? ''}.`);
  const mudancas: { codigo: string; antes: string | null; depois: string }[] = [];
  for (const n of nomes) {
    const b = blocos.find((x) => x.codigo === n.codigo);
    if (!b || (b.nomeOperacional === n.nome && b.prefixoEndereco === n.prefixo)) continue;
    const fileiras = await tx.fileira.count({ where: { layoutId: layout.id, blocoCodigo: b.codigo } });
    await tx.elementoLayout.update({
      where: { id: b.id },
      data: { nomeOperacional: n.nome, prefixoEndereco: n.prefixo, rotulo: rotuloBloco(b.codigo, fileiras > 1 ? 'PAR' : 'UNICA', n.nome, false) },
    });
    mudancas.push({ codigo: b.codigo, antes: b.nomeOperacional, depois: n.nome });
  }
  if (mudancas.length === 0) return { layoutId: layout.id, revision: layout.revisao, summary: 'Os nomes operacionais já estavam aplicados: nada mudou.' };
  const revisao = layout.revisao + 1;
  const resumo = `Nomes operacionais aplicados: ${mudancas.map((m) => `${m.codigo} → ${m.depois}`).join('; ')}.`;
  await tx.layout.update({ where: { id: layout.id }, data: { revisao } });
  await tx.historicoLayout.create({
    data: {
      escopoId: escopo.id,
      layoutId: layout.id,
      revisao,
      acao: 'NOMENCLATURA_APLICADA',
      alvoTipo: 'LAYOUT',
      alvoId: layout.id,
      resumo,
      antes: { blocos: mudancas.map((m) => ({ codigo: m.codigo, nome: m.antes })) },
      depois: { blocos: mudancas.map((m) => ({ codigo: m.codigo, nome: m.depois })) },
      autorId: autor.usuarioId,
    },
  });
  await registrarEvento(tx, {
    acao: 'LAYOUT_ALTERADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'LAYOUT',
    alvoId: layout.id,
    detalhes: { revisao, operacao: 'NOMENCLATURA_APLICADA', blocos: mudancas.length },
    requestId: autor.requestId,
  });
  return { layoutId: layout.id, revision: revisao, summary: resumo };
}
