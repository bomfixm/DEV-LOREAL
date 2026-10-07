import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { semearDemonstracao } from '../../src/demo/semear.js';
import { ID_ESCOPO_NAVEGACAO, ID_ESCOPO_PRACA, bancoDeTeste, prepararDados } from './apoio.js';

let db: Banco;

beforeAll(async () => {
  db = bancoDeTeste();
  await prepararDados(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('migração em PostgreSQL vazio', () => {
  it('aplicou a migração versionada', async () => {
    const linhas = await db.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at FROM _prisma_migrations`;
    expect(linhas.map((l) => l.migration_name).sort()).toEqual([
      '20261002055425_inicial',
      '20261002180000_cadastro_etiquetas',
      '20261002230000_conferencia_reconciliacao',
      '20261002233000_movimentacoes',
      '20261003090000_busca_importacao',
      '20261004090000_claims_rastreabilidade',
      '20261005090000_janelas_expedicao',
      '20261006090000_anexos_conferencia',
      '20261007090000_tutorial_indicadores',
      '20261008090000_selecao_cliente_conciliacao',
      '20261009090000_carga_inventario_lote',
      '20261010090000_planilha_unica_protecao',
    ]);
    expect(linhas.every((l) => l.finished_at !== null)).toBe(true);
    const versao = await db.$queryRaw<{ server_version: string }[]>`SHOW server_version`;
    expect(versao[0]?.server_version).toMatch(/^17\./);
  });

  it('impõe no banco quantidade não negativa e login normalizado', async () => {
    const saldo = await db.saldoEstoque.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_PRACA } });
    await expect(db.saldoEstoque.update({ where: { id: saldo.id }, data: { quantidade: '-1' } })).rejects.toThrow();
    await expect(db.saldoEstoque.update({ where: { id: saldo.id }, data: { quantidadeReservada: '999' } })).rejects.toThrow();
    await expect(db.usuario.create({ data: { login: 'Maiusculo', nome: 'X', senhaHash: 'x' } })).rejects.toThrow();
  });

  it('impede no banco vínculo de palete com posição de outro escopo', async () => {
    const posicaoDeOutro = await db.posicao.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_NAVEGACAO } });
    await expect(
      db.palete.create({
        data: {
          id: randomUUID(),
          escopoId: ID_ESCOPO_PRACA,
          codigo: 'PAL-CRUZADO',
          codigoBusca: 'PALCRUZADO',
          origemCodigo: 'EXISTENTE',
          posicaoId: posicaoDeOutro.id,
          estadoConferencia: 'NAO_CONFERIDO',
          estadoLiberacao: 'PENDENTE',
          estadoFluxo: 'EM_ESTOQUE',
        },
      }),
    // O gatilho de posição (mesmo escopo) e a chave estrangeira composta barram o vínculo.
    ).rejects.toThrow(/Foreign key|foreign key|P2003|POSICAO_INVALIDA/);
  });

  it('código de palete é único por escopo, não globalmente', async () => {
    const existente = await db.palete.findFirstOrThrow({ where: { escopoId: ID_ESCOPO_PRACA } });
    const dados = {
      codigo: existente.codigo,
      codigoBusca: existente.codigoBusca,
      origemCodigo: 'EXISTENTE' as const,
      estadoConferencia: 'NAO_CONFERIDO' as const,
      estadoLiberacao: 'PENDENTE' as const,
      estadoFluxo: 'EM_ESTOQUE' as const,
    };
    await expect(db.palete.create({ data: { ...dados, id: randomUUID(), escopoId: ID_ESCOPO_PRACA } })).rejects.toThrow();
    const outro = await db.palete.create({ data: { ...dados, id: randomUUID(), escopoId: ID_ESCOPO_NAVEGACAO } });
    await db.palete.delete({ where: { id: outro.id } });
  });
});

describe('seed de demonstração', () => {
  it('é repetível e não altera registros existentes', async () => {
    const antes = await db.palete.findUniqueOrThrow({ where: { id: '00000000-0000-4000-8000-000000000002' } });
    await db.palete.update({ where: { id: antes.id }, data: { motivoPendencia: 'Alterado no teste' } });
    const resultado = await semearDemonstracao(db);
    expect(Object.values(resultado.inseridos).every((n) => n === 0)).toBe(true);
    const depois = await db.palete.findUniqueOrThrow({ where: { id: antes.id } });
    expect(depois.motivoPendencia).toBe('Alterado no teste');
    await db.palete.update({ where: { id: antes.id }, data: { motivoPendencia: antes.motivoPendencia } });
  });

  it('marca os escopos como demonstração e mantém a capacidade total desconhecida', async () => {
    const escopos = await db.escopo.findMany({ orderBy: { criadoEm: 'asc' } });
    expect(escopos.map((e) => e.nome)).toEqual(['Praça informada · demonstração', 'Cenário de navegação · fictício']);
    expect(escopos.every((e) => e.demonstracao)).toBe(true);
    const layouts = await db.layout.findMany();
    expect(layouts.every((l) => l.capacidadeTotal === null)).toBe(true);
  });

  it('aplica o desenho aprovado: 7 blocos ativos (Fileiras 11–16/GR) e 7 desativados, faixas verticais', async () => {
    const fileiras = await db.fileira.findMany({
      where: { escopoId: ID_ESCOPO_PRACA },
      orderBy: { ordem: 'asc' },
      include: { _count: { select: { posicoes: true } } },
    });
    const ativas = fileiras.filter((f) => f.codigo.startsWith('F'));
    const desativadas = fileiras.filter((f) => f.codigo.startsWith('D'));
    expect(ativas.map((f) => f.codigo)).toEqual(['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12']);
    expect(ativas.map((f) => f._count.posicoes)).toEqual([17, 17, 17, 17, 17, 17, 17, 15, 15, 15, 15, 15]);
    expect(ativas.map((f) => f.blocoCodigo)).toEqual(['FB01', 'FB02', 'FB02', 'FB03', 'FB03', 'FB04', 'FB04', 'FB05', 'FB05', 'FB06', 'FB06', 'FB07']);
    expect(ativas.map((f) => f.lado)).toEqual(['UNICO', ...Array.from({ length: 5 }, () => ['ESQUERDO', 'DIREITO']).flat(), 'UNICO']);
    expect(desativadas).toHaveLength(12);
    expect(desativadas.every((f) => f._count.posicoes === 25)).toBe(true);
    const blocos = await db.elementoLayout.findMany({ where: { escopoId: ID_ESCOPO_PRACA, codigo: { startsWith: 'FB' } }, orderBy: { codigo: 'asc' } });
    expect(blocos.map((b) => [b.codigo, b.nomeOperacional, b.prefixoEndereco])).toEqual([
      ['FB01', 'Fileira 11', '11'],
      ['FB02', 'Fileira 12', '12'],
      ['FB03', 'Fileira 13', '13'],
      ['FB04', 'Fileira 14', '14'],
      ['FB05', 'Fileira 15', '15'],
      ['FB06', 'Fileira 16', '16'],
      ['FB07', 'GR — Grade', 'GR'],
    ]);

    // Faixas verticais: dentro do par as faixas ficam próximas; entre blocos o espaço é maior.
    const gap = (a: number, b: number) => (ativas[b]?.x ?? 0) - ((ativas[a]?.x ?? 0) + (ativas[a]?.largura ?? 0));
    const dentroDosPares = [gap(1, 2), gap(3, 4), gap(5, 6), gap(7, 8), gap(9, 10)];
    const entreBlocos = [gap(0, 1), gap(2, 3), gap(4, 5), gap(6, 7), gap(8, 9), gap(10, 11)];
    expect(Math.max(...dentroDosPares)).toBeLessThan(Math.min(...entreBlocos));
    // Ordem da esquerda para a direita: x cresce com a ordem.
    expect([...ativas].sort((a, b) => a.x - b.x).map((f) => f.codigo)).toEqual(ativas.map((f) => f.codigo));
  });

  it('numera posições a partir de 1 em cada faixa, com código provisório, ocupação não levantada e 300 desativadas fora da capacidade ativa', async () => {
    const posicoes = await db.posicao.findMany({ where: { escopoId: ID_ESCOPO_PRACA }, include: { fileira: true } });
    expect(posicoes).toHaveLength(494);
    for (const p of posicoes) {
      expect(p.codigo).toBe(`${p.fileira.codigo}-P${String(p.numero).padStart(2, '0')}`);
      expect(p.codigoProvisorio).toBe(true);
      expect(p.ocupacaoLevantada).toBe(false);
    }
    expect(posicoes.filter((p) => p.numero === 1)).toHaveLength(24);
    expect(posicoes.filter((p) => p.desativada)).toHaveLength(300);
    expect(posicoes.filter((p) => p.desativada).every((p) => p.fileira.codigo.startsWith('D'))).toBe(true);
    expect(posicoes.filter((p) => !p.desativada)).toHaveLength(194);
  });

  it('preserva IDs e conteúdo das fixtures e aplica o mapeamento documentado', async () => {
    const informados = await db.palete.findMany({
      where: { escopoId: ID_ESCOPO_PRACA },
      include: {
        posicao: true,
        saldos: { include: { segmento: { include: { produto: true } } }, orderBy: { quantidade: 'desc' } },
        conferencias: true,
        declarados: true,
      },
      orderBy: { codigo: 'asc' },
    });
    expect(informados.map((p) => [p.id.slice(-3), p.codigo, p.posicao?.codigo])).toEqual([
      ['001', 'PAL-DEMO-001', 'F01-P01'],
      ['002', 'PAL-DEMO-002', 'F01-P02'],
      ['003', 'PAL-DEMO-003', 'F01-P03'],
      ['004', 'PAL-DEMO-004', 'F02-P01'],
      ['005', 'PAL-DEMO-005', 'F02-P02'],
      ['006', 'PAL-DEMO-006', 'F02-P03'],
    ]);
    const p001 = informados[0];
    expect(p001?.saldos.map((s) => [s.segmento.produto.sku, s.quantidade.toFixed()])).toEqual([
      ['DEMO-101', '24'],
      ['DEMO-102', '12'],
    ]);
    const p002 = informados[1];
    expect([p002?.saldos.length, p002?.conferencias.length, p002?.declarados.length]).toEqual([0, 0, 0]);

    // Cenário de navegação: mesmos IDs e endereços da etapa 01.
    const p150 = await db.palete.findUniqueOrThrow({ where: { id: '00000000-0000-4000-8000-000000000150' }, include: { posicao: true } });
    expect([p150.codigo, p150.escopoId, p150.posicao?.codigo]).toEqual(['PAL-DEMO-150', ID_ESCOPO_NAVEGACAO, 'I-21']);
    expect(await db.palete.count({ where: { escopoId: ID_ESCOPO_NAVEGACAO } })).toBe(337);
    expect(await db.palete.count({ where: { escopoId: ID_ESCOPO_NAVEGACAO, posicaoId: null } })).toBe(2);
  });
});

describe('persistência', () => {
  it('registros continuam disponíveis após reiniciar o cliente do banco', async () => {
    const usuario = await db.usuario.create({ data: { login: 'persistencia', nome: 'Teste', senhaHash: 'x' } });
    await db.$disconnect();
    db = bancoDeTeste();
    expect(await db.usuario.findUnique({ where: { id: usuario.id } })).not.toBeNull();
    expect(await db.palete.count()).toBe(343);
  });
});
