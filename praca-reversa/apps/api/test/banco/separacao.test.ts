import { ListaSeparacoesSchema, PracaSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste } from './apoio.js';

const PALETE_COM_NOTA = '00000000-0000-4000-8000-000000000005';

let db: Banco;
let app: FastifyInstance;
let sSupervisor: SessaoTeste;
let sConsulta: SessaoTeste;

const notas = (numeros: readonly string[]) => ({
  fileName: 'separacao.xlsx',
  window: '2026-11-10',
  headers: ['NUMERO', 'NFD', 'CHAVE DE ACESSO'],
  notes: numeros.map((number, i) => ({ row: i + 2, number, type: 'NFD', delivery: null, volumes: '2', sender: 'Remetente teste', informedPallet: '1002', informedAddress: '13 - A126', values: { NUMERO: number, NFD: '8607134', 'CHAVE DE ACESSO': '2326' } })),
});

const enviar = (s: SessaoTeste, corpo: object) => mutar(app, s, 'POST', '/api/v1/separacoes', corpo);

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const [sup, cons] = await Promise.all([criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]), criarUsuario(db, 'consulta', [[ID_ESCOPO_PRACA, 'OPERADOR']])]);
  sSupervisor = await entrar(app, sup);
  sConsulta = await entrar(app, cons);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('Separação do cliente', () => {
  it('palete com a nota fica roxo e a nota vem marcada; sem palete e sem posição aparecem no relatório; encerrar tira o roxo', async () => {
    const id = PALETE_COM_NOTA;
    const agora = new Date();
    const usuario = (await db.usuario.findFirstOrThrow({ where: { login: 'supervisor' }, select: { id: true } })).id;
    const criar = (paleteId: string, numero: string) =>
      db.conteudoPalete.create({ data: { id: randomUUID(), escopoId: ID_ESCOPO_PRACA, paleteId, remetente: 'R', tipoDocumento: 'NFD', numeroDocumento: numero, criadoPorId: usuario, criadoEm: agora, atualizadoEm: agora } });
    await criar(id, '00123');
    await criar(id, '999');

    const r = await enviar(sSupervisor, notas(['123', '777']));
    expect(r.statusCode).toBe(201);
    const separacao = ListaSeparacoesSchema.parse(r.json()).items[0];
    expect(separacao?.window).toBe('2026-11-10');
    const [achada, faltando] = separacao?.notes ?? [];
    expect(separacao?.headers).toEqual(['NUMERO', 'NFD', 'CHAVE DE ACESSO']);
    expect(achada).toMatchObject({ number: '123', informedPallet: '1002', values: { NFD: '8607134', 'CHAVE DE ACESSO': '2326' } });
    expect(achada?.locations.map((l) => l.palletId)).toEqual([id]);
    expect(faltando).toMatchObject({ number: '777', situation: 'SEM_PALETE', locations: [] });

    // Mapa: só o palete com a nota fica roxo.
    const mapa = PracaSchema.parse((await como(app, sConsulta, { method: 'GET', url: '/api/v1/praca' })).json());
    expect(mapa.pallets.filter((p) => p.clientSeparation === true).map((p) => p.id)).toEqual([id]);

    // Janela do palete: a nota pedida vem marcada (mesmo com zeros à esquerda); a outra, não.
    const conteudo = (await como(app, sConsulta, { method: 'GET', url: `/api/v1/paletes/${id}/conteudos` })).json<{ items: { documentNumber: string | null; clientSeparation?: boolean }[] }>();
    expect(conteudo.items.find((i) => i.documentNumber === '00123')?.clientSeparation).toBe(true);
    expect(conteudo.items.find((i) => i.documentNumber === '999')?.clientSeparation).toBeUndefined();

    // Relatório em Excel.
    const rel = await como(app, sConsulta, { method: 'GET', url: `/api/v1/separacoes/${separacao?.id ?? ''}/relatorio` });
    expect(rel.statusCode).toBe(200);
    expect(rel.headers['content-type']).toContain('spreadsheetml');
    expect(rel.rawPayload.subarray(0, 2).toString()).toBe('PK');

    // A mesma planilha de novo é recusada; consulta não envia nem encerra.
    expect((await enviar(sSupervisor, notas(['123', '777']))).statusCode).toBe(409);
    expect((await enviar(sConsulta, notas(['5']))).statusCode).toBe(403);
    expect((await mutar(app, sConsulta, 'POST', `/api/v1/separacoes/${separacao?.id ?? ''}/encerrar`, {})).statusCode).toBe(403);

    // Encerrar tira o roxo e a marcação; nada mais muda.
    expect((await mutar(app, sSupervisor, 'POST', `/api/v1/separacoes/${separacao?.id ?? ''}/encerrar`, {})).statusCode).toBe(200);
    const depois = PracaSchema.parse((await como(app, sConsulta, { method: 'GET', url: '/api/v1/praca' })).json());
    expect(depois.pallets.some((p) => p.clientSeparation === true)).toBe(false);
    expect(await db.conteudoPalete.count({ where: { paleteId: id, numeroDocumento: '00123' } })).toBe(1);
  });

  it('separado para agenda: marca e desfaz só em palete roxo; o mapa mostra; encerrar a separação apaga a marca', async () => {
    const id = PALETE_COM_NOTA;
    const agora = new Date();
    const usuario = (await db.usuario.findFirstOrThrow({ where: { login: 'supervisor' }, select: { id: true } })).id;
    await db.conteudoPalete.create({ data: { id: randomUUID(), escopoId: ID_ESCOPO_PRACA, paleteId: id, remetente: 'R', tipoDocumento: 'NFD', numeroDocumento: '321', criadoPorId: usuario, criadoEm: agora, atualizadoEm: agora } });
    const marcar = (s: SessaoTeste, paleteId: string, separated: boolean) => mutar(app, s, 'POST', `/api/v1/paletes/${paleteId}/separado-agenda`, { separated });
    const feitos = async () => PracaSchema.parse((await como(app, sSupervisor, { method: 'GET', url: '/api/v1/praca' })).json()).pallets.filter((p) => p.clientSeparationDone === true).map((p) => p.id);

    // Sem separação ativa o palete não é roxo: não há o que marcar.
    expect((await marcar(sSupervisor, id, true)).statusCode).toBe(409);
    const separacao = ListaSeparacoesSchema.parse((await enviar(sSupervisor, notas(['321']))).json()).items[0];
    expect(await feitos()).toEqual([]);

    expect((await marcar(sSupervisor, id, true)).statusCode).toBe(200);
    expect(await feitos()).toEqual([id]);
    expect((await marcar(sSupervisor, id, true)).statusCode).toBe(200); // repetir não duplica
    expect(await db.separacaoClientePalete.count({ where: { paleteId: id } })).toBe(1);
    expect((await marcar(sSupervisor, randomUUID(), true)).statusCode).toBe(404);

    expect((await marcar(sSupervisor, id, false)).statusCode).toBe(200);
    expect(await feitos()).toEqual([]);

    expect((await marcar(sSupervisor, id, true)).statusCode).toBe(200);
    expect((await mutar(app, sSupervisor, 'POST', `/api/v1/separacoes/${separacao?.id ?? ''}/encerrar`, {})).statusCode).toBe(200);
    expect(await feitos()).toEqual([]);
    expect((await marcar(sSupervisor, id, true)).statusCode).toBe(409);
  });

  it('nota em palete fora do mapa fica como SEM_POSICAO, com o palete indicado', async () => {
    const agora = new Date();
    const usuario = (await db.usuario.findFirstOrThrow({ where: { login: 'supervisor' }, select: { id: true } })).id;
    const palete = (await mutar(app, sSupervisor, 'POST', '/api/v1/paletes', { code: { mode: 'GERAR' }, positionId: null })).json<{ id: string; code: string }>();
    await db.conteudoPalete.create({ data: { id: randomUUID(), escopoId: ID_ESCOPO_PRACA, paleteId: palete.id, remetente: 'R', tipoDocumento: 'NFD', numeroDocumento: '555', criadoPorId: usuario, criadoEm: agora, atualizadoEm: agora } });
    const r = await enviar(sSupervisor, notas(['555']));
    const nota = ListaSeparacoesSchema.parse(r.json()).items[0]?.notes[0];
    expect(nota).toMatchObject({ situation: 'SEM_POSICAO', locations: [{ palletCode: palete.code, positionCode: null }] });
  });
});
