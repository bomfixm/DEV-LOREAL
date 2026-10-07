import { RespostaBuscaSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, como, criarUsuario, entrar, prepararDados, type SessaoTeste } from './apoio.js';

/**
 * Volumetria local (não é desempenho operacional): 2.000 paletes, 500
 * produtos, 6.000 saldos/segmentos, 6.000 linhas declaradas e 10.000 linhas de
 * documento (2.000 documentos), inseridos direto no banco de testes. Mede a
 * busca paginada e a exportação de 5.000 linhas pela API, no PostgreSQL 17
 * local, e confere que os totais por base batem com o banco.
 */
const API = '/api/v1';
const E = ID_ESCOPO_PRACA;
let db: Banco;
let app: FastifyInstance;
let sSup: SessaoTeste;
const medidas: string[] = [];

async function semear(): Promise<void> {
  const usuario = await db.usuario.findFirstOrThrow({ where: { login: 'supervisor' }, select: { id: true } });
  await db.$executeRawUnsafe(`
    INSERT INTO produto (id, escopo_id, sku, descricao, unidade_canonica, ativo, versao, criado_em, atualizado_em)
    SELECT gen_random_uuid(), '${E}', 'VSKU-' || lpad(n::text, 4, '0'), 'Xampu volume ' || n, 'UN', true, 1, now(), now()
      FROM generate_series(1, 500) n`);
  await db.$executeRawUnsafe(`
    INSERT INTO palete (id, escopo_id, codigo, codigo_busca, origem_codigo, estado_conferencia, estado_liberacao, estado_fluxo, versao, versao_saldo, criado_em, atualizado_em)
    SELECT gen_random_uuid(), '${E}', 'VOL-' || lpad(n::text, 6, '0'), 'VOL' || lpad(n::text, 6, '0'), 'EXISTENTE', 'RECONCILIADO', 'PENDENTE', 'EM_ESTOQUE', 1, 2, now(), now()
      FROM generate_series(1, 2000) n`);
  const base = `
    WITH base AS (
      SELECT p.id AS palete_id, j, (row_number() OVER (ORDER BY p.codigo, j) - 1)::int AS k
        FROM palete p CROSS JOIN generate_series(0, 2) j WHERE p.escopo_id = '${E}' AND p.codigo LIKE 'VOL-%'
    ), alvo AS (
      SELECT b.*, pr.id AS produto_id, pr.sku, pr.descricao FROM base b
        JOIN produto pr ON pr.escopo_id = '${E}' AND pr.sku = 'VSKU-' || lpad(((b.k % 500) + 1)::text, 4, '0')
    )`;
  await db.$executeRawUnsafe(`${base}
    INSERT INTO segmento_estoque (id, escopo_id, produto_id, lote, origem_tipo, origem_referencia, condicao, unidade, linhagem, chave)
    SELECT gen_random_uuid(), '${E}', a.produto_id, 'LV-' || a.k, 'DEVOLUCAO', 'DEV-V-' || (a.k % 1000), 'SAUDAVEL', 'UN', NULL,
           chave_segmento(a.produto_id, 'LV-' || a.k, 'DEVOLUCAO', 'DEV-V-' || (a.k % 1000), 'SAUDAVEL', NULL)
      FROM alvo a`);
  await db.$executeRawUnsafe(`${base}
    INSERT INTO saldo_estoque (id, escopo_id, palete_id, segmento_id, quantidade, quantidade_reservada, versao)
    SELECT gen_random_uuid(), '${E}', a.palete_id, s.id, (a.k % 20) + 1, 0, 1
      FROM alvo a JOIN segmento_estoque s ON s.escopo_id = '${E}' AND s.lote = 'LV-' || a.k`);
  await db.$executeRawUnsafe(`${base}
    INSERT INTO item_declarado (id, escopo_id, palete_id, ordem, produto_id, sku, descricao, lote, origem_tipo, origem_referencia, quantidade, unidade_medida)
    SELECT gen_random_uuid(), '${E}', a.palete_id, a.j, a.produto_id, a.sku, a.descricao, 'LV-' || a.k, 'DEVOLUCAO', 'DEV-V-' || (a.k % 1000), 10, 'UN' FROM alvo a`);
  const lote = randomUUID();
  await db.$executeRawUnsafe(`
    INSERT INTO lote_importacao (id, escopo_id, tipo, situacao, formato, nome_arquivo, hash_arquivo, tamanho_bytes, opcoes, separador_decimal, colunas,
                                 versao, versao_previa, assinatura_previa, previa_gerada_em, total_linhas, validas_novas, gravadas, resultado,
                                 criado_por_id, confirmado_por_id, confirmado_em)
    VALUES ('${lote}', '${E}', 'DEVOLUCOES', 'CONFIRMADO', 'CSV', 'volume.csv', repeat('a', 64), 1, '{}', 'VIRGULA', '{}', 2, 1, repeat('b', 64), now(),
            10000, 10000, 10000, '{}', '${usuario.id}', '${usuario.id}', now())`);
  await db.$executeRawUnsafe(`
    INSERT INTO documento_devolucao (id, escopo_id, tipo, referencia, lote_importacao_id)
    SELECT gen_random_uuid(), '${E}', 'DEVOLUCAO', 'DEV-VD-' || lpad(n::text, 5, '0'), '${lote}' FROM generate_series(1, 2000) n`);
  await db.$executeRawUnsafe(`
    INSERT INTO linha_documento_devolucao (id, escopo_id, documento_id, referencia_linha, chave_linha, produto_id, sku, quantidade_declarada, unidade_declarada,
                                           fator_conversao, quantidade_canonica, unidade_canonica, nota_fiscal, lote, data_documento, lote_importacao_id, linha_arquivo)
    SELECT gen_random_uuid(), '${E}', d.id, l::text, l::text, pr.id, pr.sku, 10, 'UN', 1, 10, 'UN', 'NF-' || substring(d.referencia from 8), NULL, NULL, '${lote}', l
      FROM documento_devolucao d CROSS JOIN generate_series(1, 5) l
      JOIN produto pr ON pr.escopo_id = '${E}' AND pr.sku = 'VSKU-' || lpad((((substring(d.referencia from 8)::int * 5 + l) % 500) + 1)::text, 4, '0')
     WHERE d.escopo_id = '${E}'`);
  await db.$executeRawUnsafe('ANALYZE');
}

async function medir(rotulo: string, url: string, repeticoes = 5): Promise<{ corpo: string; ms: number }> {
  const tempos: number[] = [];
  let corpo = '';
  for (let i = 0; i < repeticoes; i++) {
    const inicio = performance.now();
    const r = await como(app, sSup, { method: 'GET', url });
    tempos.push(performance.now() - inicio);
    expect(r.statusCode, r.body).toBe(200);
    corpo = r.body;
  }
  tempos.sort((a, b) => a - b);
  const mediana = tempos[Math.floor(tempos.length / 2)] ?? 0;
  medidas.push(`${rotulo}: mediana ${mediana.toFixed(0)} ms (máx. ${(tempos.at(-1) ?? 0).toFixed(0)} ms, ${String(repeticoes)} execuções)`);
  return { corpo, ms: mediana };
}

beforeAll(async () => {
  db = bancoDeTeste();
  await prepararDados(db);
  app = await appDeTeste(db);
  sSup = await entrar(app, await criarUsuario(db, 'supervisor', [[E, 'SUPERVISOR_ESTOQUE']]));
  const inicio = performance.now();
  await semear();
  medidas.push(`carga direta no banco: ${(performance.now() - inicio).toFixed(0)} ms`);
}, 300_000);

afterAll(async () => {
  console.log(`VOLUMETRIA (PostgreSQL 17 local)\n  ${medidas.join('\n  ')}`);
  await app.close();
  await db.$disconnect();
});

describe('Volumetria local da busca', () => {
  it('SKU exato: totais por base iguais aos do banco, sem somar bases', async () => {
    const { corpo } = await medir('SKU exato (VSKU-0001), página de 25', `${API}/busca?texto=VSKU-0001&campo=SKU`);
    const r = RespostaBuscaSchema.parse(JSON.parse(corpo));
    const [esperado] = await db.$queryRaw<{ saldos: bigint; declarados: bigint; documentos: bigint; soma: string }[]>`
      SELECT (SELECT count(*) FROM saldo_estoque se JOIN segmento_estoque s ON s.id = se.segmento_id JOIN produto p ON p.id = s.produto_id WHERE p.sku = 'VSKU-0001') AS saldos,
             (SELECT count(*) FROM item_declarado WHERE sku = 'VSKU-0001') AS declarados,
             (SELECT count(*) FROM linha_documento_devolucao WHERE sku = 'VSKU-0001') AS documentos,
             (SELECT sum(se.quantidade)::text FROM saldo_estoque se JOIN segmento_estoque s ON s.id = se.segmento_id JOIN produto p ON p.id = s.produto_id WHERE p.sku = 'VSKU-0001') AS soma`;
    if (!esperado) throw new Error('consulta');
    expect(r.total).toBe(Number(esperado.saldos + esperado.declarados + esperado.documentos));
    const saldo = r.summary.find((g) => g.base === 'SALDO_VALIDADO');
    expect(saldo?.quantity).toBe(Number(esperado.soma).toString());
    expect(saldo?.records).toBe(Number(esperado.saldos));
    expect(r.summary.find((g) => g.base === 'DOCUMENTO')?.records).toBe(Number(esperado.documentos));
  });

  it('início do SKU, descrição aproximada, lote, documento e palete; exportação de 5.000 linhas', async () => {
    const prefixo = RespostaBuscaSchema.parse(JSON.parse((await medir('SKU começa com (VSKU-01: 100 produtos), página de 25', `${API}/busca?texto=VSKU-01&campo=SKU`)).corpo));
    expect(prefixo.total).toBeGreaterThan(2_000);
    expect(prefixo.items).toHaveLength(25);
    const ultima = RespostaBuscaSchema.parse(
      JSON.parse((await medir('mesma busca, página 80 (deslocamento 1.975)', `${API}/busca?texto=VSKU-01&campo=SKU&pagina=80`)).corpo),
    );
    expect(ultima.items.length).toBeGreaterThan(0);
    const descricao = RespostaBuscaSchema.parse(JSON.parse((await medir('descrição aproximada ("volume 42")', `${API}/busca?texto=volume%2042&campo=DESCRICAO`)).corpo));
    expect(descricao.total).toBeGreaterThan(0);
    expect(descricao.items.every((i) => i.match === 'DESCRICAO_APROXIMADA')).toBe(true);
    const lote = RespostaBuscaSchema.parse(JSON.parse((await medir('lote exato (LV-4321)', `${API}/busca?texto=LV-4321&campo=LOTE`)).corpo));
    expect(lote.items.map((i) => i.base).sort()).toEqual(['DECLARADO_PALETE', 'SALDO_VALIDADO']);
    const doc = RespostaBuscaSchema.parse(JSON.parse((await medir('documento exato (DEV-VD-01234)', `${API}/busca?texto=DEV-VD-01234&campo=DOCUMENTO`)).corpo));
    expect(doc.total).toBe(5);
    const pal = RespostaBuscaSchema.parse(JSON.parse((await medir('palete pelo código (VOL-001500), campo Tudo', `${API}/busca?texto=VOL-001500`)).corpo));
    expect(pal.items.map((i) => i.match)).toEqual(['CODIGO_PALETE']);
    const exp = await medir('exportação CSV (5.000 linhas de VSKU-0)', `${API}/busca/exportar?texto=VSKU-0&campo=SKU`, 3);
    const linhas = exp.corpo.split('\r\n').filter((l) => /^"(Saldo validado|Declarado|Documento)/.test(l));
    expect(linhas).toHaveLength(5_000);
    expect(exp.corpo).toMatch(/"5000 de \d+ \(limitado a 5000 linhas: refine os filtros\)"/);
  });
});
