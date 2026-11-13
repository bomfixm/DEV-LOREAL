import { CargaJanelaSchema, ConteudosPaleteSchema, OrigemEmbarqueSchema, ResultadoInclusaoNotasSchema, SelecaoExpedicaoSchema, type CargaJanela, type ResultadoInclusaoNotas } from '@praca-reversa/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { bancoDeTeste, codigoErro, como, mutar } from './apoio.js';
import { API, criarPalete, montarAmbiente, type Ambiente } from './claims-apoio.js';
import { janelaConfirmada, pecas } from './janelas-apoio.js';

/**
 * Inclusão por nota na Expedição (13 nov. 2026), contra PostgreSQL real e pela
 * API: a nota entra sozinha (pelo ID da ocorrência, não pelo número), as demais
 * do palete ficam fora, repetição não duplica, o mesmo número em outro palete é
 * outra ocorrência, ID inválido nunca vira palete inteiro e o FULL continua com
 * a regra atual. Dados fictícios.
 */
let db: Banco;
let a: Ambiente;

beforeAll(() => {
  db = bancoDeTeste();
});
beforeEach(async () => {
  a = await montarAmbiente(db);
});
afterAll(async () => {
  await db.$disconnect();
});

interface Origem {
  id: string;
  code: string;
  notas: { id: string; numero: string }[];
}

/** Palete de origem com notas (número e volumes contados) registradas no aplicativo. */
async function origemCom(notas: { numero: string; volumes: number }[]): Promise<Origem> {
  const p = await criarPalete(a);
  for (const n of notas) {
    const r = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos`, { sender: 'Remetente Fictício', documentType: 'NF', documentNumber: n.numero });
    expect(r.statusCode, r.body).toBe(201);
    const novo = ConteudosPaleteSchema.parse(r.json()).items.at(-1);
    if (!novo) throw new Error('sem conteúdo');
    const c = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos/contagens`, { target: { kind: novo.kind, id: novo.id }, counted: n.volumes, origin: 'CONTAGEM_FISICA' });
    expect(c.statusCode, c.body).toBeLessThan(300);
  }
  const lista = ConteudosPaleteSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/paletes/${p.id}/conteudos` })).json());
  return { id: p.id, code: p.code, notas: lista.items.map((i) => ({ id: i.id, numero: i.documentNumber ?? '' })) };
}

const nota = (o: Origem, numero: string) => {
  const n = o.notas.find((x) => x.numero === numero);
  if (!n) throw new Error(`sem ${numero}`);
  return { kind: 'CONTEUDO' as const, id: n.id };
};

async function carreta(): Promise<{ janela: string; veiculo: string }> {
  const janela = (await janelaConfirmada(a, [pecas('100')])).id;
  const r = await mutar(a.app, a.op, 'POST', `${API}/cargas/janelas/${janela}/veiculos`, { kind: 'CARRETA' });
  expect(r.statusCode, r.body).toBe(201);
  const c = CargaJanelaSchema.parse(r.json());
  return { janela, veiculo: c.vehicles[0]?.id ?? '' };
}

async function incluir(veiculo: string, corpo: unknown): Promise<ResultadoInclusaoNotas> {
  const r = await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, corpo);
  expect(r.statusCode, r.body).toBe(201);
  return ResultadoInclusaoNotasSchema.parse(r.json());
}

async function carga(janela: string): Promise<CargaJanela> {
  return CargaJanelaSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/cargas/janelas/${janela}` })).json());
}

async function selecao(palete?: string) {
  return SelecaoExpedicaoSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/cargas/selecao${palete === undefined ? '' : `?palete=${palete}`}` })).json());
}

async function totalPaletesEmbarque(): Promise<number> {
  const [n] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM palete_embarque`;
  return Number(n?.n ?? 0);
}

describe('Expedição — inclusão por nota', () => {
  it('só a NF 37953 (2 volumes) entra; a 740896 fica fora; repetir não duplica; contador sobe 1', async () => {
    const { janela, veiculo } = await carreta();
    const o = await origemCom([
      { numero: '37953', volumes: 2 },
      { numero: '740896', volumes: 5 },
      { numero: '51234', volumes: 3 },
    ]);
    expect((await selecao()).notes).toBe(0);

    const r = await incluir(veiculo, { sourcePalletId: o.id, lines: [{ occurrence: nota(o, '37953') }] });
    expect(r.added.map((x) => [x.documentNumber, x.sourcePalletCode, x.volumes])).toEqual([['37953', o.code, 2]]);
    expect(r.skipped).toEqual([]);
    expect(r.pallet.created).toBe(true);
    expect(r.selection.notes).toBe(1);
    expect(r.selection.volumes).toBe(2);
    expect(r.selection.pallet.map((p) => p.occurrenceId)).toEqual([nota(o, '37953').id]);

    // No servidor: um fracionado com uma única linha; as outras notas continuam disponíveis por inteiro.
    const c = await carga(janela);
    const ativos = c.vehicles[0]?.pallets.filter((p) => p.state === 'ATIVO') ?? [];
    expect(ativos).toHaveLength(1);
    expect(ativos[0]?.kind).toBe('FRACIONADO');
    expect(ativos[0]?.lines.map((l) => [l.documentNumber, l.volumes])).toEqual([['37953', 2]]);
    const origem = OrigemEmbarqueSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/cargas/janelas/${janela}/origem?codigo=${encodeURIComponent(o.code)}` })).json());
    expect(Object.fromEntries(origem.occurrences.map((x) => [x.documentNumber, x.available]))).toEqual({ '37953': 0, '740896': 5, '51234': 3 });

    // Repetir (outro clique, outra chave): conflito, nada muda, contador continua 1.
    const repetida = await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, { sourcePalletId: o.id, lines: [{ occurrence: nota(o, '37953') }] });
    expect(codigoErro(repetida)).toBe('CONFLITO');
    expect(repetida.json<{ error: { message: string } }>().error.message).toMatch(/já está na expedição/);
    expect((await selecao()).notes).toBe(1);
    expect((await carga(janela)).vehicles[0]?.pallets.flatMap((p) => p.lines)).toHaveLength(1);

    // Nada baixa estoque nem muda o palete de origem.
    const [ev] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM evento_volumes_janela`;
    expect(Number(ev?.n)).toBe(0);
    const [fluxo] = await db.$queryRaw<{ f: string }[]>`SELECT estado_fluxo::text AS f FROM palete WHERE id = ${o.id}::uuid`;
    expect(fluxo?.f).toBe('EM_ESTOQUE');
  });

  it('mesmo número de NF em outro palete é outra ocorrência; nota de outro palete ou ID inválido nunca incluem o palete inteiro', async () => {
    const { veiculo } = await carreta();
    const o1 = await origemCom([
      { numero: '37953', volumes: 2 },
      { numero: '740896', volumes: 5 },
    ]);
    const o2 = await origemCom([{ numero: '37953', volumes: 4 }]);
    await incluir(veiculo, { sourcePalletId: o1.id, lines: [{ occurrence: nota(o1, '37953') }] });
    // A 37953 do outro palete não é "a mesma nota": entra à parte, com os volumes dela.
    const r2 = await incluir(veiculo, { sourcePalletId: o2.id, lines: [{ occurrence: nota(o2, '37953') }] });
    expect(r2.added.map((x) => [x.sourcePalletCode, x.volumes])).toEqual([[o2.code, 4]]);
    expect(r2.selection.notes).toBe(2);

    const antes = await totalPaletesEmbarque();
    // Ocorrência de um palete informada como de outro: recusada, nada incluído.
    const trocada = await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, { sourcePalletId: o2.id, lines: [{ occurrence: nota(o1, '740896') }] });
    expect(codigoErro(trocada)).toBe('CONFLITO');
    // ID ausente/inválido: recusado na validação; ID inexistente: não encontrado. Nenhum palete (FULL ou não) é criado.
    const invalido = await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, { sourcePalletId: o1.id, lines: [{ occurrence: { kind: 'CONTEUDO', id: '37953' } }] });
    expect(codigoErro(invalido)).toBe('REQUISICAO_INVALIDA');
    expect(invalido.json<{ error: { message: string } }>().error.message).toMatch(/palete inteiro não entra/);
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, { sourcePalletId: o1.id, lines: [] }))).toBe('REQUISICAO_INVALIDA');
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, { sourcePalletId: o1.id, lines: [{ occurrence: { kind: 'CONTEUDO', id: '00000000-0000-4000-8000-000000000000' } }] }))).toBe('NAO_ENCONTRADO');
    expect(await totalPaletesEmbarque()).toBe(antes);
    expect((await selecao()).notes).toBe(2);
    // Só consulta não inclui.
    expect((await mutar(a.app, a.consulta, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, { sourcePalletId: o1.id, lines: [{ occurrence: nota(o1, '740896') }] })).statusCode).toBe(403);
  });

  it('palete inteiro depois de uma NF dele: regra atual recusa o FULL; as restantes entram sem duplicar; parcial e destino existente', async () => {
    const { janela, veiculo } = await carreta();
    const o = await origemCom([
      { numero: '37953', volumes: 2 },
      { numero: '740896', volumes: 5 },
      { numero: '51234', volumes: 3 },
    ]);
    const r = await incluir(veiculo, { sourcePalletId: o.id, lines: [{ occurrence: nota(o, '37953') }] });
    // O FULL do mesmo palete continua recusado pela regra existente (nota já fracionada).
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/paletes`, { kind: 'FULL', sourcePalletId: o.id }))).toBe('CONFLITO');
    // As restantes (com a já incluída no pedido) vão para o mesmo fracionado: a 37953 é pulada, a 740896 entra parcial (1 de 5).
    const p = (await carga(janela)).vehicles[0]?.pallets.find((x) => x.id === r.pallet.id);
    const r2 = await incluir(veiculo, {
      sourcePalletId: o.id,
      targetPalletId: r.pallet.id,
      expectedVersion: p?.version,
      lines: [{ occurrence: nota(o, '37953') }, { occurrence: nota(o, '740896'), volumes: 1 }, { occurrence: nota(o, '51234') }],
    });
    expect(r2.pallet.created).toBe(false);
    expect(r2.skipped.map((x) => x.documentNumber)).toEqual(['37953']);
    expect(r2.added.map((x) => [x.documentNumber, x.volumes])).toEqual([
      ['740896', 1],
      ['51234', 3],
    ]);
    expect(r2.selection.notes).toBe(3);
    const depois = (await carga(janela)).vehicles[0]?.pallets.find((x) => x.id === r.pallet.id);
    expect(depois?.lines.map((l) => [l.documentNumber, l.volumes])).toEqual([
      ['37953', 2],
      ['740896', 1],
      ['51234', 3],
    ]);
    expect(depois?.revision).toBe((p?.revision ?? 0) + 1);
    // Versão vista desatualizada: conflito de versão, nada muda.
    const o2 = await origemCom([{ numero: '88001', volumes: 1 }]);
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, { sourcePalletId: o2.id, targetPalletId: r.pallet.id, expectedVersion: p?.version, lines: [{ occurrence: nota(o2, '88001') }] }))).toBe('CONFLITO_VERSAO');
    // Volumes acima do disponível: recusado.
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, { sourcePalletId: o2.id, lines: [{ occurrence: nota(o2, '88001'), volumes: 2 }] }))).toBe('CONFLITO');

    // Palete que já sai FULL: a nota dele não entra fracionada; destino FULL não recebe nota.
    const cheio = await origemCom([{ numero: '90001', volumes: 4 }]);
    const cf = CargaJanelaSchema.parse((await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/paletes`, { kind: 'FULL', sourcePalletId: cheio.id })).json());
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, { sourcePalletId: cheio.id, lines: [{ occurrence: nota(cheio, '90001') }] }))).toBe('CONFLITO');
    const full = cf.vehicles[0]?.pallets.find((x) => x.kind === 'FULL');
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${veiculo}/notas`, { sourcePalletId: o2.id, targetPalletId: full?.id, expectedVersion: full?.version, lines: [{ occurrence: nota(o2, '88001') }] }))).toBe('CONFLITO');
    // O FULL conta as notas dele na seleção: 3 + 1.
    const s = await selecao(o.id);
    expect(s.notes).toBe(4);
    expect(s.pallet).toHaveLength(3);
  });
});
