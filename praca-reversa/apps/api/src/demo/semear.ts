/**
 * Seed da demonstração (dados fictícios). Repetível: insere somente o que
 * falta e nunca altera registros operacionais; não toca em escopos que não
 * sejam de demonstração. O comando fica em src/cli/semear-demo.ts.
 *
 * Complemento "seleção do cliente": um layout de demonstração que já existe
 * com outra versão de desenho é sincronizado pelo código (elemento, fileira,
 * posição) — IDs, QR e vínculos de paletes preservados, nenhuma posição
 * duplicada; posição fora do desenho só é retirada se estiver livre.
 */
import { textoEndereco, chaveEndereco } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../db/cliente.js';
import { sincronizarLayoutComDesenho } from '../modules/layout/aplicar-desenho.js';
import type { LayoutGerado } from '../modules/layout/tipos.js';
import { lerArquivosDemo } from './arquivos.js';
import { ID_CLIENTE_DEMO, montarFixturesDemo, validarFixtures, type FixturesDemo } from './fixtures.js';
import { registrarEvento } from '../modules/auditoria/registrar.js';

export interface ResultadoSeed {
  inseridos: Record<keyof FixturesDemo, number>;
  /** Layouts de demonstração atualizados para a versão de desenho das fixtures. */
  sincronizados: number;
}

/** Desenho das fixtures de um layout, na forma usada pela sincronização. */
function desenhoDasFixtures(f: FixturesDemo, layoutId: string): LayoutGerado {
  const l = f.layouts.find((x) => x.id === layoutId);
  if (!l) throw new Error('Layout da demonstração ausente nas fixtures.');
  const caixa = (x: number | null | undefined, y: number | null | undefined, w: number | null | undefined, h: number | null | undefined) =>
    x == null || y == null || w == null || h == null ? null : { x, y, largura: w, altura: h };
  return {
    largura: l.largura,
    altura: l.altura,
    elementos: f.elementos
      .filter((e) => e.layoutId === layoutId)
      .map((e) => ({
        codigo: e.codigo,
        tipo: e.tipo,
        rotulo: e.rotulo,
        ficticio: e.ficticio ?? false,
        x: e.x,
        y: e.y,
        largura: e.largura,
        altura: e.altura,
        caixaRotulo: caixa(e.rotuloX, e.rotuloY, e.rotuloLargura, e.rotuloAltura),
        nomeOperacional: e.nomeOperacional ?? null,
        prefixoEndereco: e.prefixoEndereco ?? null,
      })),
    fileiras: f.fileiras
      .filter((r) => r.layoutId === layoutId)
      .map((r) => ({
        codigo: r.codigo,
        rotulo: r.rotulo,
        ordem: r.ordem,
        blocoCodigo: r.blocoCodigo ?? null,
        x: r.x,
        y: r.y,
        largura: r.largura,
        altura: r.altura,
        caixaRotulo: { x: r.rotuloX, y: r.rotuloY, largura: r.rotuloLargura, altura: r.rotuloAltura },
        lado: (r.lado ?? null) as 'ESQUERDO' | 'DIREITO' | 'UNICO' | null,
      })),
    posicoes: f.posicoes
      .filter((p) => p.layoutId === layoutId)
      .map((p) => ({
        codigo: p.codigo,
        fileiraCodigo: f.fileiras.find((r) => r.id === p.fileiraId)?.codigo ?? '',
        numero: p.numero,
        x: p.x,
        y: p.y,
        largura: p.largura,
        altura: p.altura,
        disponivel: p.disponivel ?? true,
        ocupacaoLevantada: p.ocupacaoLevantada ?? false,
        desativada: p.desativada ?? false,
        motivoIndisponibilidade: p.motivoIndisponibilidade ?? null,
      })),
  };
}

/** Endereços fictícios: só em faixas ainda sem nenhuma correspondência (nunca sobrescreve). */
async function aplicarEnderecosDemo(tx: Transacao, f: FixturesDemo, base: Date): Promise<number> {
  let inseridos = 0;
  const porFileira = new Map<string, FixturesDemo['enderecos']>();
  for (const e of f.enderecos) porFileira.set(`${e.layoutId}:${e.fileiraCodigo}`, [...(porFileira.get(`${e.layoutId}:${e.fileiraCodigo}`) ?? []), e]);
  for (const lista of porFileira.values()) {
    const primeiro = lista[0];
    if (!primeiro) continue;
    const fileira = await tx.fileira.findFirst({ where: { layoutId: primeiro.layoutId, codigo: primeiro.fileiraCodigo }, select: { id: true } });
    if (!fileira) continue;
    if ((await tx.enderecoPosicao.count({ where: { fileiraId: fileira.id } })) > 0) continue;
    const posicoes = await tx.posicao.findMany({ where: { layoutId: primeiro.layoutId, fileiraId: fileira.id, retiradaEm: null }, select: { id: true, codigo: true } });
    const porCodigo = new Map(posicoes.map((p) => [p.codigo, p.id]));
    const dados = lista.flatMap((e) => {
      const posicaoId = porCodigo.get(e.posicaoCodigo);
      if (!posicaoId) return [];
      return [
        {
          id: randomUUID(),
          escopoId: e.escopoId,
          layoutId: e.layoutId,
          posicaoId,
          fileiraId: fileira.id,
          prefixo: e.prefixo,
          codigoLocal: e.codigoLocal,
          endereco: textoEndereco(e.prefixo, e.codigoLocal),
          chave: chaveEndereco(e.prefixo, e.codigoLocal),
          lado: e.lado,
          ordemVisual: e.ordemVisual,
          situacao: 'CONFIRMADO' as const,
          origem: 'DEMONSTRACAO',
          propostoEm: base,
          confirmadoEm: base,
        },
      ];
    });
    inseridos += (await tx.enderecoPosicao.createMany({ data: dados, skipDuplicates: true })).count;
  }
  return inseridos;
}

export async function semearDemonstracao(db: Banco, base = new Date()): Promise<ResultadoSeed> {
  const fixtures = montarFixturesDemo(lerArquivosDemo(), base);
  validarFixtures(fixtures);

  // Os IDs e códigos de demonstração não podem coincidir com dados operacionais.
  const conflitos = [
    ...(await db.unidade.findMany({
      where: { OR: fixtures.unidades.map((u) => ({ OR: [{ id: u.id }, { codigo: u.codigo }] })), demonstracao: false },
    })),
    ...(await db.cliente.findMany({ where: { OR: [{ id: ID_CLIENTE_DEMO }, { codigo: fixtures.clientes[0]?.codigo ?? '' }], demonstracao: false } })),
    ...(await db.escopo.findMany({ where: { id: { in: fixtures.escopos.map((e) => e.id) }, demonstracao: false } })),
  ];
  if (conflitos.length > 0) throw new Error('Há registros operacionais com IDs ou códigos da demonstração. Seed cancelado.');

  return db.$transaction(
    async (tx) => {
      const opcoes = { skipDuplicates: true } as const;
      // Layouts já existentes não recebem inserções às cegas: são sincronizados pelo código.
      const existentes = await tx.layout.findMany({
        where: { id: { in: fixtures.layouts.map((l) => l.id) } },
        select: { id: true, escopoId: true, versao: true, revisao: true, escopo: { select: { demonstracao: true } } },
      });
      const idsExistentes = new Set(existentes.map((l) => l.id));
      const novos = <T extends { layoutId: string }>(lista: T[]) => lista.filter((x) => !idsExistentes.has(x.layoutId));
      const inseridos = {
        unidades: (await tx.unidade.createMany({ data: fixtures.unidades, ...opcoes })).count,
        clientes: (await tx.cliente.createMany({ data: fixtures.clientes, ...opcoes })).count,
        escopos: (await tx.escopo.createMany({ data: fixtures.escopos, ...opcoes })).count,
        layouts: (await tx.layout.createMany({ data: fixtures.layouts, ...opcoes })).count,
        elementos: (await tx.elementoLayout.createMany({ data: novos(fixtures.elementos), ...opcoes })).count,
        fileiras: (await tx.fileira.createMany({ data: novos(fixtures.fileiras), ...opcoes })).count,
        posicoes: (await tx.posicao.createMany({ data: novos(fixtures.posicoes), ...opcoes })).count,
        paletes: 0,
        produtos: 0,
        codigosBarras: 0,
        declarados: 0,
        segmentos: 0,
        eventos: 0,
        saldos: 0,
        linhasEvento: 0,
        sessoes: 0,
        observacoes: 0,
        enderecos: 0,
      };
      let sincronizados = 0;
      for (const l of existentes) {
        const alvo = fixtures.layouts.find((x) => x.id === l.id);
        if (!alvo || !l.escopo.demonstracao || l.versao === alvo.versao) continue;
        const gerado = desenhoDasFixtures(fixtures, l.id);
        const idPorCodigo = (lista: readonly { id?: string; codigo: string; layoutId: string }[]) => {
          const mapa = new Map(lista.filter((x) => x.layoutId === l.id).map((x) => [x.codigo, x.id ?? randomUUID()]));
          return (codigo: string) => mapa.get(codigo) ?? randomUUID();
        };
        const r = await sincronizarLayoutComDesenho(
          tx,
          l.escopoId,
          l.id,
          gerado,
          { elemento: idPorCodigo(fixtures.elementos), fileira: idPorCodigo(fixtures.fileiras), posicao: idPorCodigo(fixtures.posicoes) },
          base,
        );
        const revisao = l.revisao + 1;
        await tx.layout.update({
          where: { id: l.id },
          data: { versao: alvo.versao, nome: alvo.nome, largura: alvo.largura, altura: alvo.altura, observacao: alvo.observacao ?? null, revisao },
        });
        await tx.historicoLayout.create({
          data: {
            escopoId: l.escopoId,
            layoutId: l.id,
            revisao,
            acao: 'DESENHO_APROVADO_APLICADO',
            alvoTipo: 'LAYOUT',
            alvoId: l.id,
            resumo: `Demonstração atualizada para ${alvo.versao}: ${String(r.atualizadas)} posição(ões) mantidas pelo código (IDs e vínculos preservados), ${String(r.criadas)} criada(s), ${String(r.retiradas)} retirada(s) por estar fora do desenho.`,
            antes: { versao: l.versao },
            depois: { versao: alvo.versao, ...r },
          },
        });
        sincronizados += 1;
      }
      Object.assign(inseridos, {
        paletes: (await tx.palete.createMany({ data: fixtures.paletes, ...opcoes })).count,
        produtos: (await tx.produto.createMany({ data: fixtures.produtos, ...opcoes })).count,
        codigosBarras: (await tx.codigoBarras.createMany({ data: fixtures.codigosBarras, ...opcoes })).count,
        declarados: (await tx.itemDeclarado.createMany({ data: fixtures.declarados, ...opcoes })).count,
        segmentos: (await tx.segmentoEstoque.createMany({ data: fixtures.segmentos, ...opcoes })).count,
        eventos: (await tx.eventoEstoque.createMany({ data: fixtures.eventos, ...opcoes })).count,
        saldos: (await tx.saldoEstoque.createMany({ data: fixtures.saldos, ...opcoes })).count,
        linhasEvento: (await tx.linhaEventoEstoque.createMany({ data: fixtures.linhasEvento, ...opcoes })).count,
        sessoes: (await tx.sessaoConferencia.createMany({ data: fixtures.sessoes, ...opcoes })).count,
        observacoes: (await tx.observacaoConferencia.createMany({ data: fixtures.observacoes, ...opcoes })).count,
        enderecos: await aplicarEnderecosDemo(tx, fixtures, base),
      });
      const total = Object.values(inseridos).reduce((a, b) => a + b, 0) + sincronizados;
      if (total > 0) {
        for (const escopo of fixtures.escopos) {
          await registrarEvento(tx, {
            acao: 'SEED_DEMONSTRACAO',
            resultado: 'SUCESSO',
            escopoId: escopo.id,
            detalhes: { registrosInseridos: total, layoutsSincronizados: sincronizados },
          });
        }
      }
      return { inseridos, sincronizados };
    },
    { timeout: 60_000 },
  );
}
