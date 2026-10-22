import { ConteudosPaleteSchema, type ConteudosPalete } from '@praca-reversa/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_PRACA, bancoDeTeste, codigoErro, como, mutar } from './apoio.js';
import { API, criarPalete, montarAmbiente, palete, type Ambiente } from './claims-apoio.js';

/**
 * Cadastro de conteúdo e conferência de volumes (out. 2026), contra
 * PostgreSQL real: remetente obrigatório; NF/NFD/MI, número, Delivery e
 * descrição opcionais (NF e Delivery podem ficar ambos vazios); identidade
 * própria por registro; completar a identificação preserva a contagem;
 * contagem acrescentada (contada ou já feita), nunca zero quando ausente;
 * previsto só quando informado. Dados fictícios.
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

async function listar(paleteId: string): Promise<ConteudosPalete> {
  const r = await como(a.app, a.op, { method: 'GET', url: `${API}/paletes/${paleteId}/conteudos` });
  expect(r.statusCode, r.body).toBe(200);
  return ConteudosPaleteSchema.parse(r.json());
}

async function registrar(paleteId: string, corpo: Record<string, unknown>): Promise<ConteudosPalete> {
  const r = await mutar(a.app, a.op, 'POST', `${API}/paletes/${paleteId}/conteudos`, corpo);
  expect(r.statusCode, r.body).toBe(201);
  return ConteudosPaleteSchema.parse(r.json());
}

describe('Registrar conteúdo', () => {
  it('aceita nota + Delivery, só nota, só Delivery e nenhuma referência — sem SKU, unidade, código de barras ou volumes', async () => {
    const p = await criarPalete(a);
    await registrar(p.id, { sender: 'Remetente Fictício A', documentType: 'NF', documentNumber: '000123', delivery: 'DLV-0001' });
    await registrar(p.id, { sender: 'Remetente Fictício A', documentType: 'NFD', documentNumber: '000456' });
    await registrar(p.id, { sender: 'Remetente Fictício B', delivery: '0080012345' });
    const lista = await registrar(p.id, { sender: '  Remetente   Fictício C ', documentNumber: '', delivery: '', description: '' });
    expect(lista.items.map((i) => [i.kind, i.sender, i.documentType, i.documentNumber, i.delivery, i.count.state, i.count.counted])).toEqual([
      ['REGISTRADO', 'Remetente Fictício A', 'NF', '000123', 'DLV-0001', 'AGUARDANDO', null],
      ['REGISTRADO', 'Remetente Fictício A', 'NFD', '000456', null, 'AGUARDANDO', null],
      ['REGISTRADO', 'Remetente Fictício B', null, null, '0080012345', 'AGUARDANDO', null],
      ['REGISTRADO', 'Remetente Fictício C', null, null, null, 'AGUARDANDO', null],
    ]);
    // Zeros à esquerda preservados; documentos = notas identificadas distintas; sem documento contado à parte.
    expect(lista.documents).toBe(2);
    expect(lista.withoutDocument).toBe(2);
    expect(lista.full).toBe('MISTO');
    // Persistido: a leitura depois (outra requisição) devolve o mesmo.
    expect((await listar(p.id)).items).toHaveLength(4);
    expect(await db.eventoAuditoria.count({ where: { acao: 'CONTEUDO_REGISTRADO', alvoId: p.id } })).toBe(4);
  });

  it('MI aceito; tipo inválido, remetente vazio ou texto longo demais são recusados; consulta não cadastra', async () => {
    const p = await criarPalete(a);
    await registrar(p.id, { sender: 'Remetente Fictício', documentType: 'MI', documentNumber: '0007' });
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos`, { sender: 'X', documentType: 'NFE' }))).toBe('REQUISICAO_INVALIDA');
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos`, { sender: '   ' }))).toBe('REQUISICAO_INVALIDA');
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos`, { sender: 'X', documentNumber: '9'.repeat(61) }))).toBe('REQUISICAO_INVALIDA');
    expect((await mutar(a.app, a.consulta, 'POST', `${API}/paletes/${p.id}/conteudos`, { sender: 'X' })).statusCode).toBe(403);
    // Usuário de outro escopo não alcança o palete (sem permissão ou não encontrado).
    expect([403, 404]).toContain((await mutar(a.app, a.outroEscopo, 'POST', `${API}/paletes/${p.id}/conteudos`, { sender: 'X' })).statusCode);
    expect((await listar(p.id)).items.map((i) => i.documentType)).toEqual(['MI']);
  });

  it('dois conteúdos do mesmo remetente sem NF e sem Delivery continuam distintos; repetir a mesma chave não duplica', async () => {
    const p = await criarPalete(a);
    const corpo = { sender: 'Remetente Repetido' };
    const r1 = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos`, corpo, 'chave-unica-1');
    const r2 = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos`, corpo, 'chave-unica-1');
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect((await listar(p.id)).items).toHaveLength(1);
    await registrar(p.id, corpo);
    const lista = await listar(p.id);
    expect(lista.items).toHaveLength(2);
    expect(new Set(lista.items.map((i) => i.id)).size).toBe(2);
  });

  it('completar a identificação depois preserva o registro, a contagem e o palete; versão antiga é recusada', async () => {
    const p = await criarPalete(a);
    const [item] = (await registrar(p.id, { sender: 'Remetente Fictício' })).items;
    if (!item) throw new Error('sem item');
    // Contagem já feita registrada com identificação vazia.
    const c = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id: item.id }, counted: 10, origin: 'CONTAGEM_INFORMADA', reference: 'Contagem do turno' });
    expect(c.statusCode, c.body).toBe(201);
    const r = await mutar(a.app, a.op, 'PUT', `${API}/paletes/${p.id}/conteudos/${item.id}`, { expectedVersion: 1, sender: 'Remetente Fictício', documentType: 'NF', documentNumber: '0001', delivery: 'DLV-9' });
    expect(r.statusCode, r.body).toBe(200);
    const [atual] = ConteudosPaleteSchema.parse(r.json()).items;
    expect(atual).toMatchObject({ id: item.id, documentType: 'NF', documentNumber: '0001', delivery: 'DLV-9', version: 2, count: { state: 'REALIZADA', counted: '10', expected: null, origin: 'CONTAGEM_INFORMADA', reference: 'Contagem do turno' } });
    expect(codigoErro(await mutar(a.app, a.op, 'PUT', `${API}/paletes/${p.id}/conteudos/${item.id}`, { expectedVersion: 1, sender: 'Outro' }))).toBe('CONFLITO_VERSAO');
    expect(await db.eventoAuditoria.count({ where: { acao: 'CONTEUDO_ALTERADO', alvoId: p.id } })).toBe(1);
  });

  it('contagem: física ou já feita, mesmo sem identificação; previsto só quando informado; a mais recente vale e a anterior fica', async () => {
    const p = await criarPalete(a);
    const [item] = (await registrar(p.id, { sender: 'Remetente Fictício' })).items;
    if (!item) throw new Error('sem item');
    expect(item.count).toMatchObject({ state: 'AGUARDANDO', counted: null, expected: null });
    const contar = (corpo: Record<string, unknown>) => mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id: item.id }, ...corpo });
    expect((await contar({ counted: 8, origin: 'CONTAGEM_FISICA' })).statusCode).toBe(201);
    let [atual] = (await listar(p.id)).items;
    expect(atual?.count).toMatchObject({ state: 'REALIZADA', counted: '8', expected: null, origin: 'CONTAGEM_FISICA' });
    expect((await contar({ counted: 8, expected: 10, origin: 'CONTAGEM_INFORMADA' })).statusCode).toBe(201);
    [atual] = (await listar(p.id)).items;
    expect(atual?.count).toMatchObject({ counted: '8', expected: '10', origin: 'CONTAGEM_INFORMADA' });
    expect(await db.contagemVolumes.count({ where: { conteudoId: item.id } })).toBe(2);
    // Contagem não é editada nem apagada no banco (correção = nova contagem).
    await expect(db.contagemVolumes.updateMany({ where: { conteudoId: item.id }, data: { volumesContados: 1 } })).rejects.toThrow();
    // Inválidos: negativo, fracionário, origem desconhecida; consulta não registra contagem.
    expect(codigoErro(await contar({ counted: -1, origin: 'CONTAGEM_FISICA' }))).toBe('REQUISICAO_INVALIDA');
    expect(codigoErro(await contar({ counted: 1.5, origin: 'CONTAGEM_FISICA' }))).toBe('REQUISICAO_INVALIDA');
    expect(codigoErro(await contar({ counted: 1, origin: 'IMPORTACAO' }))).toBe('REQUISICAO_INVALIDA');
    expect((await mutar(a.app, a.consulta, 'POST', `${API}/paletes/${p.id}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id: item.id }, counted: 1, origin: 'CONTAGEM_FISICA' })).statusCode).toBe(403);
    // Registrar conteúdo e contagem não altera estoque nem localização do palete.
    const depois = await palete(a, p.id);
    expect(depois.positionId).toBe(p.positionId);
    expect(depois.currentItems).toEqual(p.currentItems);
    expect(depois.countState).toBe(p.countState);
  });

  it('palete arquivado não recebe conteúdo', async () => {
    const p = await criarPalete(a);
    const arq = await mutar(a.app, a.sup, 'POST', `${API}/paletes/${p.id}/arquivar`, { expectedVersion: (await palete(a, p.id)).version, reason: 'Cadastro de teste' });
    expect(arq.statusCode, arq.body).toBe(200);
    expect(codigoErro(await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos`, { sender: 'X' }))).toBe('CONFLITO');
  });
});

describe('Planilha única com conteúdo registrado', () => {
  it('cada conteúdo registrado vira uma linha; identificação ausente aparece como não informada e a contagem vigente entra nos volumes', async () => {
    const p = await criarPalete(a);
    const [item] = (await registrar(p.id, { sender: 'Remetente Planilha' })).items;
    await registrar(p.id, { sender: 'Remetente Planilha', documentType: 'NFD', documentNumber: '000789', delivery: 'DLV-7' });
    const c = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id: item?.id }, counted: 6, origin: 'CONTAGEM_FISICA' });
    expect(c.statusCode, c.body).toBe(201);
    const { lerSnapshot } = await import('../../src/modules/planilha/dados.js');
    const linhas = (await lerSnapshot(db, ID_ESCOPO_PRACA, 100)).inventario.filter((l) => l.palete === p.code);
    const semDocumento = linhas.find((l) => l.nfd === null);
    const comNota = linhas.find((l) => l.nfd === '000789');
    expect(linhas).toHaveLength(2);
    expect([semDocumento?.remetente, semDocumento?.delivery, semDocumento?.volumes]).toEqual(['Remetente Planilha', null, '6']);
    expect([comNota?.remetente, comNota?.delivery, comNota?.volumes]).toEqual(['Remetente Planilha', 'DLV-7', null]);
    expect(semDocumento?.situacao).toMatch(/documento não informado · Delivery não informado · Volumes contados no aplicativo/);
    expect(comNota?.situacao).toMatch(/NFD 000789 · Aguardando conferência/);
  });
});

describe('Busca do conteúdo registrado', () => {
  it('localiza por remetente, Delivery e número (zeros à esquerda), também sem nota; mostra a contagem vigente', async () => {
    const p = await criarPalete(a);
    const [semNada] = (await registrar(p.id, { sender: 'Remetente Busca Fictício' })).items;
    await registrar(p.id, { sender: 'Outro Remetente', documentType: 'NF', documentNumber: '000555', delivery: 'DLV-BUSCA-1' });
    await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id: semNada?.id }, counted: 5, expected: 6, origin: 'CONTAGEM_INFORMADA' });
    const buscar = async (texto: string) => {
      const r = await como(a.app, a.op, { method: 'GET', url: `${API}/busca?texto=${encodeURIComponent(texto)}` });
      expect(r.statusCode, r.body).toBe(200);
      return r.json<{ items: { base: string; match: string; pallet: { id: string } | null; contentLink: { sender: string; documentNumber: string | null; counted: string | null; expected: string | null } | null }[]; palletIds: string[] }>();
    };
    const porRemetente = await buscar('remetente busca fictício');
    expect(porRemetente.items.filter((i) => i.base === 'CONTEUDO').map((i) => [i.match, i.pallet?.id, i.contentLink?.documentNumber, i.contentLink?.counted, i.contentLink?.expected])).toEqual([
      ['DOCUMENTO', p.id, null, '5', '6'],
    ]);
    expect(porRemetente.palletIds).toContain(p.id);
    expect((await buscar('DLV-BUSCA-1')).items.filter((i) => i.base === 'CONTEUDO').map((i) => i.contentLink?.sender)).toEqual(['Outro Remetente']);
    expect((await buscar('000555')).items.filter((i) => i.base === 'CONTEUDO').map((i) => i.match)).toEqual(['NF']);
    expect((await buscar('555')).items.filter((i) => i.base === 'CONTEUDO')).toHaveLength(0);
  });
});
