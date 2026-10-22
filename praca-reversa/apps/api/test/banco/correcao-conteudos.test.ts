import { ConteudosPaleteSchema, FilaValidacaoSchema, ResultadoAcaoConteudosSchema, ResumoValidacaoSchema, type ConteudosPalete } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_PRACA, bancoDeTeste, chave, codigoErro, como, criarUsuario, entrar, mutar, type SessaoTeste } from './apoio.js';
import { API, criarPalete, montarAmbiente, type Ambiente } from './claims-apoio.js';
import { criarJanela, dadosJanela } from './janelas-apoio.js';

/**
 * Correção de conteúdos (21 out. 2026), contra PostgreSQL real: mover vários
 * para palete ocupado (confirmação, soma conservada, sem duplicar nem fundir),
 * para posição vazia (palete novo pelo cadastro), enviar à validação sem
 * endereço, resolver a validação no mapa, cancelar uma ocorrência sem afetar
 * outra da mesma NF, permissões (perfil máximo sim; operador, consulta e
 * cliente não) e a fila invisível ao cliente. Dados fictícios.
 */
let db: Banco;
let a: Ambiente;
let admin: SessaoTeste;
let cliente: SessaoTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  a = await montarAmbiente(db);
  admin = await entrar(a.app, await criarUsuario(db, 'administrador', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]));
  cliente = await entrar(a.app, await criarUsuario(db, 'cliente.consulta', [[ID_ESCOPO_PRACA, 'CLIENTE_CONSULTA']]));
});

afterAll(async () => {
  await db.$disconnect();
});

async function listar(paleteId: string): Promise<ConteudosPalete> {
  const r = await como(a.app, a.sup, { method: 'GET', url: `${API}/paletes/${paleteId}/conteudos` });
  expect(r.statusCode, r.body).toBe(200);
  return ConteudosPaleteSchema.parse(r.json());
}

/** Conteúdos registrados com quantidade atual (contagem informada). */
async function semear(paleteId: string, linhas: readonly { numero: string; remetente: string; volumes: number }[]): Promise<string[]> {
  const ids: string[] = [];
  for (const l of linhas) {
    const r = await mutar(a.app, a.op, 'POST', `${API}/paletes/${paleteId}/conteudos`, { sender: l.remetente, documentType: 'NFD', documentNumber: l.numero });
    expect(r.statusCode, r.body).toBe(201);
    const novo = ConteudosPaleteSchema.parse(r.json()).items.find((x) => !ids.includes(x.id));
    if (!novo) throw new Error('sem conteúdo novo');
    ids.push(novo.id);
    const c = await mutar(a.app, a.op, 'POST', `${API}/paletes/${paleteId}/conteudos/contagens`, { target: { kind: 'REGISTRADO', id: novo.id }, counted: l.volumes, origin: 'CONTAGEM_INFORMADA' });
    expect(c.statusCode, c.body).toBe(201);
  }
  return ids;
}

const soma = (l: ConteudosPalete) => l.items.reduce((t, i) => t + Number(i.count.counted ?? 0), 0);
const acao = (s: SessaoTeste, paleteId: string, corpo: Record<string, unknown>, k: string = chave()) => mutar(a.app, s, 'POST', `${API}/paletes/${paleteId}/conteudos/acoes`, corpo, k);
const item = (id: string) => ({ kind: 'REGISTRADO', id });

describe('Mover conteúdos', () => {
  it('vários para palete ocupado: exige confirmação, preserva o destino, conserva a soma e não funde a mesma NF', async () => {
    const origem = await criarPalete(a);
    const destino = await criarPalete(a);
    const [o1, o2, o3] = await semear(origem.id, [
      { numero: '0009001', remetente: 'Remetente Fictício A', volumes: 5 },
      { numero: '0009002', remetente: 'Remetente Fictício B', volumes: 7 },
      { numero: '0009003', remetente: 'Remetente Fictício C', volumes: 2 },
    ]);
    await semear(destino.id, [
      { numero: '0009001', remetente: 'Remetente Fictício A', volumes: 4 },
      { numero: '0009100', remetente: 'Remetente Fictício D', volumes: 1 },
    ]);
    if (!o1 || !o2 || !o3 || destino.positionId === null) throw new Error('fixture');
    const total = soma(await listar(origem.id)) + soma(await listar(destino.id));
    const corpo = { action: 'MOVER', items: [item(o1), item(o2)], destination: { kind: 'POSICAO', id: destino.positionId } };
    // Sem confirmação: nada muda.
    expect(codigoErro(await acao(a.sup, origem.id, corpo))).toBe('CONFIRMAR_DESTINO');
    expect((await listar(origem.id)).items).toHaveLength(3);
    const k = chave();
    const r = await acao(a.sup, origem.id, { ...corpo, confirmOccupied: true, reason: 'Conteúdo estava no palete errado (teste)' }, k);
    expect(r.statusCode, r.body).toBe(200);
    const res = ResultadoAcaoConteudosSchema.parse(r.json());
    expect(res).toMatchObject({ action: 'MOVER', affected: 2, volumes: 12, origin: { code: origem.code, remaining: 1, emptied: false }, destination: { code: destino.code, created: false, items: 4 } });
    expect(res.warnings.join(' ')).toMatch(/NFD 0009001 já existe no palete .*nada foi fundido/);
    // Repetição com a mesma chave: mesma resposta, nada duplicado.
    const repetida = await acao(a.sup, origem.id, { ...corpo, confirmOccupied: true, reason: 'Conteúdo estava no palete errado (teste)' }, k);
    expect(ResultadoAcaoConteudosSchema.parse(repetida.json()).operationId).toBe(res.operationId);
    expect(await db.historicoConteudo.count({ where: { acao: 'MOVIMENTO' } })).toBe(2);
    // Mesmo ID, contagens acompanham a ocorrência, número e conteúdo do destino preservados; soma conservada.
    const lo = await listar(origem.id);
    const ld = await listar(destino.id);
    expect(lo.items.map((i) => i.id)).toEqual([o3]);
    expect(ld.items).toHaveLength(4);
    expect(ld.items.find((i) => i.id === o1)?.count.counted).toBe('5');
    expect(ld.items.filter((i) => i.documentNumber === '0009001')).toHaveLength(2);
    expect(soma(lo) + soma(ld)).toBe(total);
    expect((await db.palete.findUniqueOrThrow({ where: { id: destino.id }, select: { codigo: true } })).codigo).toBe(destino.code);
    // Seleção desatualizada (já movida por outra pessoa): recusada sem gravar.
    expect(codigoErro(await acao(a.sup, origem.id, { ...corpo, confirmOccupied: true }))).toBe('CONJUNTO_ALTERADO');
    expect(await db.eventoAuditoria.count({ where: { acao: 'CONTEUDOS_MOVIDOS' } })).toBe(1);
  });

  it('posição vazia: o palete novo segue o cadastro existente (numeração do piso); o histórico registra origem, destino e autor', async () => {
    const origem = await criarPalete(a);
    const [o1] = await semear(origem.id, [{ numero: '0009201', remetente: 'Remetente Fictício E', volumes: 3 }]);
    if (!o1) throw new Error('fixture');
    const [livre] = await db.$queryRaw<{ id: string }[]>`
      SELECT pos.id::text FROM posicao pos JOIN layout l ON l.id = pos.layout_id
       WHERE pos.escopo_id = ${ID_ESCOPO_PRACA}::uuid AND l.ativo AND pos.disponivel AND NOT pos.desativada AND pos.retirada_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM palete p WHERE p.posicao_id = pos.id) ORDER BY pos.codigo LIMIT 1`;
    if (!livre) throw new Error('sem posição livre');
    const r = await acao(a.sup, origem.id, { action: 'MOVER', items: [item(o1)], destination: { kind: 'POSICAO', id: livre.id } });
    expect(r.statusCode, r.body).toBe(200);
    const res = ResultadoAcaoConteudosSchema.parse(r.json());
    expect(res.destination).toMatchObject({ created: true, items: 1 });
    expect(res.destination?.code).toMatch(/^\d+$/);
    expect(res.origin).toMatchObject({ remaining: 0, emptied: true });
    expect(res.warnings.join(' ')).toMatch(/ficou sem conteúdo ativo/);
    const h = await como(a.app, a.sup, { method: 'GET', url: `${API}/ocorrencias/${o1}/historico` });
    const eventos = h.json<{ items: { type: string; text: string; by: { login: string } | null }[] }>().items;
    expect(eventos.map((e) => e.type)).toEqual(['REGISTRO', 'CONTAGEM', 'MOVIMENTO']);
    expect(eventos[2]).toMatchObject({ by: { login: 'supervisor' } });
    expect(eventos[2]?.text).toContain(`palete ${origem.code}`);
  });
});

describe('Validação sem endereço e cancelamento', () => {
  it('enviar à validação, consultar a fila (interna) e resolver escolhendo o destino; o cliente não alcança nada disso', async () => {
    const p = await criarPalete(a);
    const destino = await criarPalete(a);
    const [v1, v2] = await semear(p.id, [
      { numero: '0009301', remetente: 'Remetente Fictício F', volumes: 6 },
      { numero: '0009302', remetente: 'Remetente Fictício G', volumes: 8 },
    ]);
    if (!v1 || !v2) throw new Error('fixture');
    expect(codigoErro(await acao(a.sup, p.id, { action: 'VALIDACAO', items: [item(v1)], reason: '' }))).toBe('REQUISICAO_INVALIDA');
    const r = await acao(a.sup, p.id, { action: 'VALIDACAO', items: [item(v1), item(v2)], reason: 'Não encontrado no palete na conferência (teste)' });
    expect(r.statusCode, r.body).toBe(200);
    expect((await listar(p.id)).items).toHaveLength(0);
    // Quantidade e história preservadas; nenhuma expedição fictícia.
    expect(await db.contagemVolumes.count({ where: { conteudoId: { in: [v1, v2] } } })).toBe(2);
    expect(await db.eventoVolumesJanela.count()).toBe(0);
    const fila = FilaValidacaoSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/validacao` })).json());
    expect(fila).toMatchObject({ total: 2, volumes: 14 });
    expect(fila.items[0]).toMatchObject({ documentNumber: '0009301', volumes: 6, reason: 'Não encontrado no palete na conferência (teste)', by: { login: 'supervisor' }, lastKnown: { id: p.id, code: p.code } });
    expect(fila.items[0]?.history.map((e) => e.type)).toEqual(['REGISTRO', 'CONTAGEM', 'VALIDACAO']);
    expect(ResumoValidacaoSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/validacao/resumo` })).json())).toEqual({ total: 2, volumes: 14 });
    // Cliente e consulta: nenhuma rota da fila; o painel do cliente não traz as notas em validação.
    for (const url of [`${API}/validacao`, `${API}/validacao/resumo`, `${API}/ocorrencias/${v1}/historico`]) {
      expect((await como(a.app, cliente, { method: 'GET', url })).statusCode).toBe(403);
    }
    expect((await como(a.app, a.consulta, { method: 'GET', url: `${API}/validacao` })).statusCode).toBe(403);
    const painel = await como(a.app, cliente, { method: 'GET', url: `${API}/painel/cliente/estoque` });
    expect(painel.statusCode, painel.body).toBe(200);
    expect(painel.body).not.toContain('0009301');
    expect((await mutar(a.app, cliente, 'POST', `${API}/validacao/resolver`, { items: [item(v1)], destination: { kind: 'PALETE', id: destino.id } })).statusCode).toBe(403);
    // Operador consulta a fila, mas não resolve.
    expect((await mutar(a.app, a.op, 'POST', `${API}/validacao/resolver`, { items: [item(v1)], destination: { kind: 'PALETE', id: destino.id } })).statusCode).toBe(403);
    // Resolver as duas de uma vez no destino escolhido (vazio de conteúdo: sem confirmação).
    const resolver = await mutar(a.app, a.sup, 'POST', `${API}/validacao/resolver`, { items: [item(v1), item(v2)], destination: { kind: 'PALETE', id: destino.id }, reason: 'Encontradas no palete do lado (teste)' });
    expect(resolver.statusCode, resolver.body).toBe(200);
    expect(ResultadoAcaoConteudosSchema.parse(resolver.json())).toMatchObject({ action: 'RESOLUCAO', affected: 2, volumes: 14, destination: { id: destino.id, items: 2 } });
    expect((await listar(destino.id)).items.map((i) => i.count.counted).sort()).toEqual(['6', '8']);
    expect(ResumoValidacaoSchema.parse((await como(a.app, a.op, { method: 'GET', url: `${API}/validacao/resumo` })).json()).total).toBe(0);
    // Repetir a resolução (já resolvida): recusada.
    expect(codigoErro(await mutar(a.app, a.sup, 'POST', `${API}/validacao/resolver`, { items: [item(v1)], destination: { kind: 'PALETE', id: p.id } }))).toBe('CONJUNTO_ALTERADO');
  });

  it('cancelar uma ocorrência não afeta outra da mesma NF; o perfil máximo cancela; operador e cliente não', async () => {
    const p = await criarPalete(a);
    const [c1, c2] = await semear(p.id, [
      { numero: '0009401', remetente: 'Remetente Fictício H', volumes: 2 },
      { numero: '0009401', remetente: 'Remetente Fictício H', volumes: 3 },
    ]);
    if (!c1 || !c2) throw new Error('fixture');
    const corpo = { action: 'CANCELAR', items: [item(c1)], reason: 'Registro duplicado por engano (teste)', confirm: true };
    expect((await acao(a.op, p.id, corpo)).statusCode).toBe(403);
    expect((await acao(cliente, p.id, corpo)).statusCode).toBe(403);
    expect(codigoErro(await acao(admin, p.id, { ...corpo, confirm: false }))).toBe('REQUISICAO_INVALIDA');
    const r = await acao(admin, p.id, corpo);
    expect(r.statusCode, r.body).toBe(200);
    expect(ResultadoAcaoConteudosSchema.parse(r.json())).toMatchObject({ action: 'CANCELAR', affected: 1, volumes: 2, origin: { remaining: 1 } });
    const lista = await listar(p.id);
    expect(lista.items.map((i) => [i.id, i.documentNumber, i.count.counted])).toEqual([[c2, '0009401', '3']]);
    expect(await db.conteudoPalete.findUniqueOrThrow({ where: { id: c1 }, select: { situacao: true } })).toEqual({ situacao: 'CANCELADO' });
    const h = await db.historicoConteudo.findFirstOrThrow({ where: { conteudoId: c1 }, select: { acao: true, volumes: true, motivo: true, autor: { select: { login: true } } } });
    expect(h).toEqual({ acao: 'CANCELAMENTO', volumes: 2, motivo: 'Registro duplicado por engano (teste)', autor: { login: 'administrador' } });
    // Histórico é só acrescentado.
    await expect(db.historicoConteudo.updateMany({ where: { conteudoId: c1 }, data: { motivo: 'outro' } })).rejects.toThrow();
    // A fila de validação não recebe cancelados.
    expect(FilaValidacaoSchema.parse((await como(a.app, admin, { method: 'GET', url: `${API}/validacao` })).json()).total).toBe(0);
  });

  it('conteúdo com volumes separados numa janela não é corrigido aqui (impacto sinalizado, nada muda)', async () => {
    const p = await criarPalete(a);
    const [c1] = await semear(p.id, [{ numero: '0009501', remetente: 'Remetente Fictício I', volumes: 4 }]);
    if (!c1) throw new Error('fixture');
    const janela = await criarJanela(a, dadosJanela([]));
    const usuario = await db.usuario.findFirstOrThrow({ where: { login: 'supervisor' }, select: { id: true } });
    await db.eventoVolumesJanela.create({ data: { id: randomUUID(), escopoId: ID_ESCOPO_PRACA, janelaId: janela.id, conteudoId: c1, paleteId: p.id, tipo: 'SEPARACAO', volumes: 2, autorId: usuario.id, ocorridoEm: new Date() } });
    expect(codigoErro(await acao(a.sup, p.id, { action: 'VALIDACAO', items: [item(c1)], reason: 'Teste de janela' }))).toBe('JANELA_VINCULADA');
    expect((await listar(p.id)).items).toHaveLength(1);
  });
});
