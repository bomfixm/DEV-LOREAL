import { ConteudosPaleteSchema, PracaSchema, ResultadoConferenciaVolumesSchema, type ConteudosPalete } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, chave, codigoErro, como, mutar, type SessaoTeste } from './apoio.js';
import { API, criarPalete, montarAmbiente, type Ambiente } from './claims-apoio.js';

/**
 * Conferência de volumes em tabela (21 out. 2026), contra PostgreSQL real:
 * palete inteiro numa operação (50 notas de 1 volume), 130 recontados como 126
 * gravam 126 com anterior e diferença −4, parcial ≠ completa, zero ≠ vazio,
 * clique duplo/retry sem duplicar e conjunto alterado recusado. Dados fictícios.
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

async function listar(paleteId: string, s: SessaoTeste = a.op): Promise<ConteudosPalete> {
  const r = await como(a.app, s, { method: 'GET', url: `${API}/paletes/${paleteId}/conteudos` });
  expect(r.statusCode, r.body).toBe(200);
  return ConteudosPaleteSchema.parse(r.json());
}

/** Conteúdos registrados com a quantidade atual já informada (contagem anterior). */
async function semear(paleteId: string, volumes: readonly number[], prefixo = '0005'): Promise<string[]> {
  const ids: string[] = [];
  for (const i of volumes.keys()) {
    const r = await mutar(a.app, a.op, 'POST', `${API}/paletes/${paleteId}/conteudos`, { sender: `Remetente Fictício ${String(i)}`, documentType: 'NFD', documentNumber: `${prefixo}${String(i).padStart(3, '0')}` });
    expect(r.statusCode, r.body).toBe(201);
    const novo = ConteudosPaleteSchema.parse(r.json()).items.find((x) => !ids.includes(x.id));
    if (!novo) throw new Error('sem conteúdo novo');
    ids.push(novo.id);
  }
  const usuario = await db.usuario.findFirstOrThrow({ where: { login: 'operador' }, select: { id: true } });
  await db.contagemVolumes.createMany({
    data: ids.map((id, i) => ({
      id: randomUUID(),
      escopoId: ID_ESCOPO_PRACA,
      paleteId,
      conteudoId: id,
      volumesContados: volumes[i] ?? 0,
      origem: 'CONTAGEM_INFORMADA',
      referencia: 'Contagem anterior (teste)',
      registradaPorId: usuario.id,
      registradaEm: new Date(Date.now() - 60_000),
    })),
  });
  return ids;
}

function conferir(paleteId: string, corpo: Record<string, unknown>, chaveIdem: string = chave(), s: SessaoTeste = a.op) {
  return mutar(a.app, s, 'POST', `${API}/paletes/${paleteId}/conferencias-volumes`, corpo, chaveIdem);
}

describe('Conferência em tabela', () => {
  it('50 notas de 1 volume: conferência completa numa única operação, sem contagens repetidas, com prazo renovado', async () => {
    const p = await criarPalete(a);
    const ids = await semear(p.id, Array.from({ length: 50 }, () => 1));
    const antes = await listar(p.id);
    expect(antes.volumeCheck).toMatchObject({ state: 'NAO_CONFERIDO', items: 50, covered: 0 });
    // Sem a declaração física, a completa é recusada (abrir a tabela não confere nada).
    const semDeclaracao = await conferir(p.id, { scope: 'COMPLETA', physicalDeclaration: false, setSignature: antes.setSignature, lines: ids.map((id) => ({ kind: 'REGISTRADO', id, counted: 1 })) });
    expect(codigoErro(semDeclaracao)).toBe('REQUISICAO_INVALIDA');
    // Completa sem todas as linhas: recusada (parcial é outra escolha).
    expect(codigoErro(await conferir(p.id, { scope: 'COMPLETA', physicalDeclaration: true, setSignature: antes.setSignature, lines: ids.slice(1).map((id) => ({ kind: 'REGISTRADO', id, counted: 1 })) }))).toBe('REQUISICAO_INVALIDA');
    const r = await conferir(p.id, { scope: 'COMPLETA', physicalDeclaration: true, setSignature: antes.setSignature, lines: ids.map((id) => ({ kind: 'REGISTRADO', id, counted: 1 })) });
    expect(r.statusCode, r.body).toBe(201);
    const res = ResultadoConferenciaVolumesSchema.parse(r.json());
    expect(res).toMatchObject({ scope: 'COMPLETA', items: 50, changed: 0, differences: [], volumesBefore: 50, volumesAfter: 50, volumeCheck: { state: 'CONFERIDO', items: 50, covered: 50, differences: 0 } });
    expect(res.reconference?.lastFullCountAt).toBe(res.at);
    // Uma operação, 50 itens abrangidos, nenhuma contagem nova (valores iguais), consulta do conjunto pela operação.
    expect(await db.conferenciaVolumes.count({ where: { paleteId: p.id } })).toBe(1);
    expect(await db.itemConferenciaVolumes.count({ where: { conferenciaId: res.operationId } })).toBe(50);
    expect(await db.contagemVolumes.count({ where: { paleteId: p.id, conferenciaId: { not: null } } })).toBe(0);
    const depois = await listar(p.id);
    expect(depois.items.every((i) => i.check?.state === 'CONFERIDO' && i.check.operationId === res.operationId)).toBe(true);
    // Mapa: o mesmo estado derivado (ocupação continua a mesma).
    const praca = PracaSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/praca` })).json());
    expect(praca.pallets.find((x) => x.id === p.id)?.volumeCheck).toMatchObject({ state: 'CONFERIDO', covered: 50 });
  });

  it('130 recontados como 126: saldo atual 126, anterior 130, diferença −4, "conferido com diferença" — também depois de reiniciar', async () => {
    const p = await criarPalete(a);
    const [alvo, outro, zerado] = await semear(p.id, [130, 4, 2]);
    if (!alvo || !outro || !zerado) throw new Error('sem conteúdos');
    const antes = await listar(p.id);
    const r = await conferir(p.id, {
      scope: 'COMPLETA',
      physicalDeclaration: true,
      setSignature: antes.setSignature,
      lines: [
        { kind: 'REGISTRADO', id: alvo, counted: 126 },
        { kind: 'REGISTRADO', id: outro, counted: 4 },
        { kind: 'REGISTRADO', id: zerado, counted: 0 },
      ],
      notes: 'Recontagem fictícia',
    });
    expect(r.statusCode, r.body).toBe(201);
    const res = ResultadoConferenciaVolumesSchema.parse(r.json());
    expect(res.differences.map((d) => [d.id, d.previous, d.counted, d.difference])).toEqual([
      [alvo, 130, 126, -4],
      [zerado, 2, 0, -2],
    ]);
    expect(res).toMatchObject({ changed: 2, volumesBefore: 136, volumesAfter: 130, volumeCheck: { state: 'CONFERIDO_COM_DIFERENCA', differences: 2 } });
    // Persistido: outra leitura (e outra instância da API, como depois de reiniciar) mostra 126, nunca 130 nem 130+126.
    const app2 = await appDeTeste(db);
    try {
      const r2 = await como(app2, a.op, { method: 'GET', url: `${API}/paletes/${p.id}/conteudos` });
      const lista = ConteudosPaleteSchema.parse(r2.json());
      const item = lista.items.find((i) => i.id === alvo);
      expect(item?.count.counted).toBe('126');
      expect(item?.check).toMatchObject({ state: 'CONFERIDO_COM_DIFERENCA', previous: 130, counted: 126, difference: -4 });
      // Zero contado é resultado (0), não vazio nem saldo positivo fantasma.
      expect(lista.items.find((i) => i.id === zerado)?.count.counted).toBe('0');
      expect(lista.items.find((i) => i.id === outro)?.check?.state).toBe('CONFERIDO');
      expect(lista.volumeCheck?.state).toBe('CONFERIDO_COM_DIFERENCA');
    } finally {
      await app2.close();
    }
    // A contagem antiga fica no histórico; a nova aponta a operação.
    const contagens = await db.contagemVolumes.findMany({ where: { conteudoId: alvo }, orderBy: { registradaEm: 'asc' }, select: { volumesContados: true, conferenciaId: true } });
    expect(contagens).toEqual([
      { volumesContados: 130, conferenciaId: null },
      { volumesContados: 126, conferenciaId: res.operationId },
    ]);
    expect(await db.eventoAuditoria.count({ where: { acao: 'CONFERENCIA_VOLUMES_REGISTRADA', alvoId: p.id } })).toBe(1);
  });

  it('volume negativo ou fracionário é recusado sem gravar; a tabela continua com o conjunto anterior', async () => {
    const p = await criarPalete(a);
    const [id] = await semear(p.id, [3]);
    const { setSignature } = await listar(p.id);
    for (const counted of [-1, 1.5]) {
      expect(codigoErro(await conferir(p.id, { scope: 'PARCIAL', physicalDeclaration: false, setSignature, lines: [{ kind: 'REGISTRADO', id, counted }] }))).toBe('REQUISICAO_INVALIDA');
    }
    expect(await db.conferenciaVolumes.count({ where: { paleteId: p.id } })).toBe(0);
    expect((await listar(p.id)).items[0]?.count.counted).toBe('3');
  });

  it('parcial atualiza só o conferido, não renova o prazo e não vira completa; completa com diferença deixa de ser "não conferido"', async () => {
    const p = await criarPalete(a);
    const ids = await semear(p.id, [5, 6, 7]);
    const prazoAntes = (await db.palete.findUniqueOrThrow({ where: { id: p.id }, select: { ultimaReconferenciaEm: true } })).ultimaReconferenciaEm;
    const t1 = await listar(p.id);
    const parcial = await conferir(p.id, { scope: 'PARCIAL', physicalDeclaration: false, setSignature: t1.setSignature, lines: [{ kind: 'REGISTRADO', id: ids[0], counted: 4 }] });
    expect(parcial.statusCode, parcial.body).toBe(201);
    expect(ResultadoConferenciaVolumesSchema.parse(parcial.json())).toMatchObject({ scope: 'PARCIAL', volumeCheck: { state: 'PARCIAL', covered: 1, items: 3, differences: 1 } });
    expect((await db.palete.findUniqueOrThrow({ where: { id: p.id }, select: { ultimaReconferenciaEm: true } })).ultimaReconferenciaEm).toEqual(prazoAntes);
    expect(await db.reconferenciaPalete.count({ where: { paleteId: p.id } })).toBe(0);
    const t2 = await listar(p.id);
    expect(t2.items.find((i) => i.id === ids[0])?.count.counted).toBe('4');
    expect(t2.items.find((i) => i.id === ids[1])?.check?.state).toBe('NAO_CONFERIDO');
    const completa = await conferir(p.id, { scope: 'COMPLETA', physicalDeclaration: true, setSignature: t2.setSignature, lines: ids.map((id, i) => ({ kind: 'REGISTRADO', id, counted: [4, 6, 9][i] })) });
    expect(completa.statusCode, completa.body).toBe(201);
    expect(ResultadoConferenciaVolumesSchema.parse(completa.json()).volumeCheck.state).toBe('CONFERIDO_COM_DIFERENCA');
    expect(await db.reconferenciaPalete.count({ where: { paleteId: p.id, resultado: 'COM_DIFERENCA' } })).toBe(1);
  });

  it('clique duplo e nova tentativa com a mesma chave não duplicam; conjunto alterado depois de aberto é recusado sem gravar', async () => {
    const p = await criarPalete(a);
    const ids = await semear(p.id, [10, 20]);
    const t = await listar(p.id);
    const corpo = { scope: 'COMPLETA', physicalDeclaration: true, setSignature: t.setSignature, lines: ids.map((id) => ({ kind: 'REGISTRADO', id, counted: 9 })) };
    const k = chave();
    const [r1, r2] = await Promise.all([conferir(p.id, corpo, k), conferir(p.id, corpo, k)]);
    const respostas = [r1, r2].map((r) => r.statusCode).sort();
    expect(respostas[0]).toBe(201);
    const r3 = await conferir(p.id, corpo, k);
    expect(r3.statusCode).toBe(201);
    expect(await db.conferenciaVolumes.count({ where: { paleteId: p.id } })).toBe(1);
    expect(await db.contagemVolumes.count({ where: { paleteId: p.id, conferenciaId: { not: null } } })).toBe(2);
    // Mesma tabela (assinatura antiga) enviada como nova operação: o conjunto mudou (recontado) → recusada.
    expect(codigoErro(await conferir(p.id, corpo))).toBe('CONJUNTO_ALTERADO');
    // Conteúdo novo entra depois de abrir a tabela: recusada e nada gravado.
    const t2 = await listar(p.id);
    await semear(p.id, [1], '0006');
    const recusada = await conferir(p.id, { ...corpo, setSignature: t2.setSignature });
    expect(codigoErro(recusada)).toBe('CONJUNTO_ALTERADO');
    expect(await db.conferenciaVolumes.count({ where: { paleteId: p.id } })).toBe(1);
    // Estado: conteúdo novo depois da completa = parcial (não abrangido).
    expect((await listar(p.id)).volumeCheck).toMatchObject({ state: 'PARCIAL', covered: 2, items: 3 });
  });

  it('consulta não confere; outro escopo não alcança o palete', async () => {
    const p = await criarPalete(a);
    const ids = await semear(p.id, [1]);
    const t = await listar(p.id);
    const corpo = { scope: 'PARCIAL', physicalDeclaration: false, setSignature: t.setSignature, lines: [{ kind: 'REGISTRADO', id: ids[0], counted: 1 }] };
    expect((await conferir(p.id, corpo, chave(), a.consulta)).statusCode).toBe(403);
    expect([403, 404]).toContain((await conferir(p.id, corpo, chave(), a.outroEscopo)).statusCode);
    expect(await db.conferenciaVolumes.count()).toBe(0);
  });
});
