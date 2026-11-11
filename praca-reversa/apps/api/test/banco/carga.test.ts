import { CargaJanelaSchema, ConteudosPaleteSchema, OrigemEmbarqueSchema, type CargaJanela, type PaleteEmbarque } from '@praca-reversa/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { bancoDeTeste, codigoErro, como, mutar, type SessaoTeste } from './apoio.js';
import { API, criarPalete, montarAmbiente, type Ambiente } from './claims-apoio.js';
import { janelaConfirmada, pecas } from './janelas-apoio.js';

/**
 * Expedição DHL — carga por veículo (11 nov. 2026), contra PostgreSQL real e
 * pela API: veículos e capacidades, numeração por veículo, posições, FULL e
 * fracionado com disponível, físico × documentação, revisão do conteúdo,
 * emissões e ausência de baixa. Dados fictícios.
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

async function ok(r: Awaited<ReturnType<typeof mutar>>, status = 200): Promise<CargaJanela> {
  expect(r.statusCode, r.body).toBe(status);
  return CargaJanelaSchema.parse(r.json());
}

/** Palete de origem com conteúdos registrados e volumes contados. */
async function origemCom(volumes: number[]): Promise<{ id: string; code: string; conteudos: string[] }> {
  const p = await criarPalete(a);
  for (const [i, v] of volumes.entries()) {
    const r = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos`, { sender: 'Remetente Fictício', documentType: 'NF', documentNumber: `90${String(i + 1).padStart(4, '0')}${p.code.slice(-3)}` });
    expect(r.statusCode, r.body).toBe(201);
    const lista = ConteudosPaleteSchema.parse(r.json());
    const novo = lista.items.at(-1);
    if (!novo) throw new Error('sem conteúdo');
    const c = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos/contagens`, { target: { kind: novo.kind, id: novo.id }, counted: v, origin: 'CONTAGEM_FISICA' });
    expect(c.statusCode, c.body).toBeLessThan(300);
  }
  const lista = ConteudosPaleteSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/paletes/${p.id}/conteudos` })).json());
  return { id: p.id, code: p.code, conteudos: lista.items.map((i) => i.id) };
}

async function novaJanela(): Promise<string> {
  return (await janelaConfirmada(a, [pecas('100')])).id;
}

async function veiculo(janelaId: string, kind: 'CARRETA' | 'TRUCK', s: SessaoTeste = a.op): Promise<CargaJanela> {
  return ok(await mutar(a.app, s, 'POST', `${API}/cargas/janelas/${janelaId}/veiculos`, { kind }), 201);
}

const paletesDe = (c: CargaJanela, label: string): PaleteEmbarque[] => c.vehicles.find((v) => v.label === label)?.pallets.filter((p) => p.state === 'ATIVO') ?? [];
const um = (c: CargaJanela, label: string, numero: number): PaleteEmbarque => {
  const p = paletesDe(c, label).find((x) => x.number === numero);
  if (!p) throw new Error(`sem P${String(numero)} em ${label}`);
  return p;
};
const idVeiculo = (c: CargaJanela, label: string) => c.vehicles.find((v) => v.label === label)?.id ?? '';

describe('Expedição DHL — carga por veículo', () => {
  it('janela com duas carretas e um truck: capacidades 28/16, P07 em veículos diferentes, conflito de posição e número', async () => {
    const j = await novaJanela();
    await veiculo(j, 'CARRETA');
    await veiculo(j, 'CARRETA');
    let c = await veiculo(j, 'TRUCK');
    expect(c.vehicles.map((v) => [v.label, v.capacity, v.layoutConfirmed])).toEqual([
      ['Carreta 01', 28, false],
      ['Carreta 02', 28, false],
      ['Truck 01', 16, false],
    ]);
    const o1 = await origemCom([5]);
    const o2 = await origemCom([5]);
    const linha = async (o: { conteudos: string[] }, volumes: number) => ({ occurrence: { kind: 'CONTEUDO', id: o.conteudos[0] }, volumes });
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${idVeiculo(c, 'Carreta 01')}/paletes`, { kind: 'FRACIONADO', number: 7, position: 3, lines: [await linha(o1, 2)] }), 201);
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${idVeiculo(c, 'Carreta 02')}/paletes`, { kind: 'FRACIONADO', number: 7, position: 3, lines: [await linha(o2, 2)] }), 201);
    const p07a = um(c, 'Carreta 01', 7);
    const p07b = um(c, 'Carreta 02', 7);
    expect(p07a.identity).not.toBe(p07b.identity);
    expect(p07a.identity).toMatch(/Carreta 01 · Palete 07$/);
    // Número repetido no mesmo veículo e posição ocupada são recusados.
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${idVeiculo(c, 'Carreta 01')}/paletes`, { kind: 'FRACIONADO', number: 7, lines: [await linha(o1, 1)] }))).toBe('CONFLITO');
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${idVeiculo(c, 'Carreta 01')}/paletes`, { kind: 'FRACIONADO', position: 3, lines: [await linha(o1, 1)] }))).toBe('CONFLITO');
    // Posição fora do truck (16).
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${idVeiculo(c, 'Truck 01')}/paletes`, { kind: 'FRACIONADO', position: 17, lines: [await linha(o1, 1)] }))).toBe('REQUISICAO_INVALIDA');
    // Capacidade do truck: 16 paletes e o 17º é recusado.
    const truck = idVeiculo(c, 'Truck 01');
    const o3 = await origemCom([20]);
    for (let n = 1; n <= 16; n++) await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${truck}/paletes`, { kind: 'FRACIONADO', lines: [await linha(o3, 1)] }), 201);
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${truck}/paletes`, { kind: 'FRACIONADO', lines: [await linha(o3, 1)] }))).toBe('CONFLITO');
    // Consulta não monta.
    expect((await mutar(a.app, a.consulta, 'POST', `${API}/cargas/janelas/${j}/veiculos`, { kind: 'TRUCK' })).statusCode).toBe(403);
  });

  it('FULL leva o palete inteiro; fracionado 8 de 20 sem copiar 20; nada baixa ao alocar; FULL não duplica', async () => {
    const j = await novaJanela();
    let c = await veiculo(j, 'CARRETA');
    const carreta = idVeiculo(c, 'Carreta 01');
    const cheio = await origemCom([12, 4]);
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${carreta}/paletes`, { kind: 'FULL', sourcePalletId: cheio.id }), 201);
    const full = um(c, 'Carreta 01', 1);
    expect(full.volumes).toBe(16);
    expect(full.lines).toHaveLength(2);
    expect(full.sourcePalletCode).toBe(cheio.code);
    // O mesmo palete não sai FULL de novo nem fracionado em outra linha.
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${carreta}/paletes`, { kind: 'FULL', sourcePalletId: cheio.id }))).toBe('CONFLITO');
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${carreta}/paletes`, { kind: 'FRACIONADO', lines: [{ occurrence: { kind: 'CONTEUDO', id: cheio.conteudos[0] }, volumes: 1 }] }))).toBe('CONFLITO');

    const vinte = await origemCom([20]);
    const ocorrencia = { kind: 'CONTEUDO', id: vinte.conteudos[0] };
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${carreta}/paletes`, { kind: 'FRACIONADO', lines: [{ occurrence: ocorrencia, volumes: 8 }] }), 201);
    const frac = um(c, 'Carreta 01', 2);
    expect(frac.volumes).toBe(8);
    expect(frac.lines.map((l) => l.volumes)).toEqual([8]);
    // Disponível na origem: 12 (20 − 8); pedir 13 noutro palete é recusado.
    const origem = OrigemEmbarqueSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/cargas/janelas/${j}/origem?codigo=${encodeURIComponent(vinte.code)}` })).json());
    expect(origem.occurrences[0]?.available).toBe(12);
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${carreta}/paletes`, { kind: 'FRACIONADO', lines: [{ occurrence: ocorrencia, volumes: 13 }] }))).toBe('CONFLITO');
    // Nenhum evento de baixa por volumes nem mudança no palete de origem.
    const [eventos] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM evento_volumes_janela`;
    expect(Number(eventos?.n)).toBe(0);
    const [fluxo] = await db.$queryRaw<{ f: string }[]>`SELECT estado_fluxo::text AS f FROM palete WHERE id = ${vinte.id}::uuid`;
    expect(fluxo?.f).toBe('EM_ESTOQUE');
  });

  it('físico conferido × documentação: faltante deixa pendência; correção com histórico; conteúdo alterado reabre a revisão', async () => {
    const j = await novaJanela();
    let c = await veiculo(j, 'TRUCK');
    const truck = idVeiculo(c, 'Truck 01');
    const o = await origemCom([6, 3]);
    c = await ok(
      await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${truck}/paletes`, {
        kind: 'FRACIONADO',
        lines: o.conteudos.map((id) => ({ occurrence: { kind: 'CONTEUDO', id }, volumes: 2 })),
      }),
      201,
    );
    let p = um(c, 'Truck 01', 1);
    expect(p.docs.state).toBe('AGUARDANDO_FISICO');
    // O adm não confere antes do físico.
    const doc = (s: SessaoTeste, linha: string, state: string, note: string | null = null) => mutar(a.app, s, 'POST', `${API}/cargas/paletes/${p.id}/documentos`, { revision: p.revision, lineId: linha, state, note });
    expect(codigoErro(await doc(a.sup, p.lines[0]?.id ?? '', 'CONFERIDO'))).toBe('CONFLITO');
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/paletes/${p.id}/fisico`, { expectedVersion: p.version, revision: p.revision }));
    p = um(c, 'Truck 01', 1);
    expect(p.physical.checked).toBe(true);
    expect(p.docs.state).toBe('PENDENTE');
    // Operador não tem a permissão do administrativo.
    expect((await doc(a.op, p.lines[0]?.id ?? '', 'CONFERIDO')).statusCode).toBe(403);
    c = await ok(await doc(a.sup, p.lines[0]?.id ?? '', 'CONFERIDO'), 201);
    c = await ok(await doc(a.sup, p.lines[1]?.id ?? '', 'FALTANTE', 'Segunda via não veio'), 201);
    p = um(c, 'Truck 01', 1);
    expect(p.physical.checked).toBe(true);
    expect(p.docs).toMatchObject({ state: 'COM_PROBLEMA', checked: 1, missing: 1 });
    expect(c.vehicles[0]?.pending.join(' ')).toMatch(/faltante ou divergente/);
    // Faltante sem observação é recusado.
    expect(codigoErro(await doc(a.sup, p.lines[1]?.id ?? '', 'FALTANTE'))).toBe('REQUISICAO_INVALIDA');
    c = await ok(await doc(a.sup, p.lines[1]?.id ?? '', 'CONFERIDO'), 201);
    p = um(c, 'Truck 01', 1);
    expect(p.docs.state).toBe('CONFERIDA');
    // Alterar o conteúdo abre revisão nova: físico e documentação voltam a pendentes só neste palete.
    c = await ok(
      await mutar(a.app, a.op, 'PUT', `${API}/cargas/paletes/${p.id}/linhas`, {
        expectedVersion: p.version,
        lines: [{ occurrence: { kind: 'CONTEUDO', id: o.conteudos[0] }, volumes: 3 }],
      }),
    );
    p = um(c, 'Truck 01', 1);
    expect(p.revision).toBe(2);
    expect(p.physical.checked).toBe(false);
    expect(p.docs.state).toBe('AGUARDANDO_FISICO');
    expect(p.lines).toHaveLength(1);
    const [hist] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM evento_embarque WHERE tipo = 'DOCUMENTO_CONFERIDO'`;
    expect(Number(hist?.n)).toBe(3);
  });

  it('mover o P07 mantém o número; transferir muda a identidade e marca reimpressão; mapa final só com posições confirmadas', async () => {
    const j = await novaJanela();
    await veiculo(j, 'CARRETA');
    let c = await veiculo(j, 'CARRETA');
    const c1 = idVeiculo(c, 'Carreta 01');
    const o = await origemCom([10]);
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${c1}/paletes`, { kind: 'FRACIONADO', number: 7, position: 5, lines: [{ occurrence: { kind: 'CONTEUDO', id: o.conteudos[0] }, volumes: 4 }] }), 201);
    let p = um(c, 'Carreta 01', 7);
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/paletes/${p.id}/emissoes`, { kind: 'ETIQUETA', final: true }), 201);
    p = um(c, 'Carreta 01', 7);
    c = await ok(await mutar(a.app, a.op, 'PUT', `${API}/cargas/paletes/${p.id}/posicao`, { expectedVersion: p.version, position: 9 }));
    p = um(c, 'Carreta 01', 7);
    expect([p.number, p.position, p.positionConfirmed]).toEqual([7, 9, false]);
    expect(p.emissions.find((e) => e.kind === 'ETIQUETA')?.outdated).toBe(false);
    // Mapa final recusado sem confirmação; prévia aceita.
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${c1}/mapa`, { kind: 'MAPA', final: true }))).toBe('CONFLITO');
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/paletes/${p.id}/confirmacao`, { expectedVersion: p.version, confirmed: true }));
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${c1}/mapa`, { kind: 'MAPA', final: true }), 201);
    expect(c.vehicles[0]?.map).toMatchObject({ final: true, outdated: false });
    p = um(c, 'Carreta 01', 7);
    // Versão desatualizada é recusada (duas pessoas).
    expect(codigoErro(await mutar(a.app, a.op, 'PUT', `${API}/cargas/paletes/${p.id}/posicao`, { expectedVersion: p.version - 1, position: 1 }))).toBe('CONFLITO_VERSAO');
    // Transferir para a Carreta 02: mantém P07 (livre), perde a posição, etiqueta fica desatualizada e o mapa final também.
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/paletes/${p.id}/transferencia`, { expectedVersion: p.version, vehicleId: idVeiculo(c, 'Carreta 02') }));
    const t = um(c, 'Carreta 02', 7);
    expect(t.position).toBeNull();
    expect(t.identity).toMatch(/Carreta 02 · Palete 07$/);
    expect(t.emissions.find((e) => e.kind === 'ETIQUETA')?.outdated).toBe(true);
    expect(c.vehicles.find((v) => v.label === 'Carreta 01')?.map?.outdated).toBe(true);
  });

  it('repetir com a mesma chave não duplica; outra sessão lê a mesma carga; fechar exige pendências resolvidas', async () => {
    const j = await novaJanela();
    let c = await veiculo(j, 'TRUCK');
    const truck = idVeiculo(c, 'Truck 01');
    const o = await origemCom([4]);
    const corpo = { kind: 'FRACIONADO', position: 1, lines: [{ occurrence: { kind: 'CONTEUDO', id: o.conteudos[0] }, volumes: 4 }] };
    const r1 = await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${truck}/paletes`, corpo, 'chave-duplo-clique-0001');
    const r2 = await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${truck}/paletes`, corpo, 'chave-duplo-clique-0001');
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    const lida = CargaJanelaSchema.parse((await como(a.app, a.consulta, { method: 'GET', url: `${API}/cargas/janelas/${j}` })).json());
    expect(paletesDe(lida, 'Truck 01')).toHaveLength(1);
    c = lida;
    const v = c.vehicles[0];
    expect(codigoErro(await mutar(a.app, a.sup, 'POST', `${API}/cargas/veiculos/${truck}/situacao`, { expectedVersion: v?.version, action: 'FECHAR' }))).toBe('CONFLITO');
    // Operador não fecha carga.
    expect((await mutar(a.app, a.op, 'POST', `${API}/cargas/veiculos/${truck}/situacao`, { expectedVersion: v?.version, action: 'FECHAR' })).statusCode).toBe(403);
    let p = um(c, 'Truck 01', 1);
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/paletes/${p.id}/confirmacao`, { expectedVersion: p.version, confirmed: true }));
    p = um(c, 'Truck 01', 1);
    c = await ok(await mutar(a.app, a.op, 'POST', `${API}/cargas/paletes/${p.id}/fisico`, { expectedVersion: p.version, revision: p.revision }));
    p = um(c, 'Truck 01', 1);
    c = await ok(await mutar(a.app, a.sup, 'POST', `${API}/cargas/paletes/${p.id}/documentos`, { revision: p.revision, lineId: p.lines[0]?.id, state: 'CONFERIDO' }), 201);
    const ve = c.vehicles[0];
    c = await ok(await mutar(a.app, a.sup, 'PUT', `${API}/cargas/veiculos/${truck}`, { expectedVersion: ve?.version, name: null, plate: 'ABC1D23', rows: 8, cols: 2, layoutConfirmed: true }));
    expect(c.vehicles[0]?.pending).toEqual([]);
    c = await ok(await mutar(a.app, a.sup, 'POST', `${API}/cargas/veiculos/${truck}/situacao`, { expectedVersion: c.vehicles[0]?.version, action: 'FECHAR' }));
    expect(c.vehicles[0]?.state).toBe('FECHADO');
    p = um(c, 'Truck 01', 1);
    // Carga fechada não aceita mudança silenciosa.
    expect(codigoErro(await mutar(a.app, a.op, 'PUT', `${API}/cargas/paletes/${p.id}/posicao`, { expectedVersion: p.version, position: 2 }))).toBe('CONFLITO');
  });
});
