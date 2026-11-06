import { NotasFotoPaleteSchema, ResultadoNotasFotoSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_NAVEGACAO, ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste } from './apoio.js';

const PALETE = '00000000-0000-4000-8000-000000000001';
let db: Banco;
let app: FastifyInstance;
let sup: SessaoTeste;
let consulta: SessaoTeste;
let outroEscopo: SessaoTeste;

const url = `/api/v1/paletes/${PALETE}/notas-foto`;

const enviar = (s: SessaoTeste, photoKey: string, corpo: object = {}) => mutar(app, s, 'POST', url, { photoKey, ...corpo });
const lista = async () => NotasFotoPaleteSchema.parse((await como(app, sup, { method: 'GET', url })).json());
const leitura = (id: string, corpo: object) => mutar(app, sup, 'POST', `/api/v1/notas-foto/${id}/leitura`, corpo);
const salvar = (itens: object[]) => mutar(app, sup, 'PUT', url, { items: itens });
const incluir = async (ids: string[]) => ResultadoNotasFotoSchema.parse((await mutar(app, sup, 'POST', `${url}/incluir`, { ids })).json());
const conteudos = async () => (await como(app, sup, { method: 'GET', url: `/api/v1/paletes/${PALETE}/conteudos` })).json<{ items: { documentNumber: string | null; count: { counted: string | null } }[] }>();

async function novaNota(marca: string) {
  const antes = new Set((await lista()).items.map((n) => n.id));
  expect((await enviar(sup, marca)).statusCode).toBe(201);
  const n = (await lista()).items.find((x) => !antes.has(x.id));
  if (!n) throw new Error('Nota não criada.');
  return n;
}

beforeAll(() => {
  db = bancoDeTeste();
});
beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const [a, b, c] = await Promise.all([
    criarUsuario(db, 'foto.sup', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'foto.consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]),
    criarUsuario(db, 'foto.outro', [[ID_ESCOPO_NAVEGACAO, 'SUPERVISOR_ESTOQUE']]),
  ]);
  sup = await entrar(app, a);
  consulta = await entrar(app, b);
  outroEscopo = await entrar(app, c);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('Notas por foto', () => {
  it('foto lida vira rascunho fora do estoque, sem imagem no servidor; a mesma foto de novo não duplica', async () => {
    const antes = (await conteudos()).items.length;
    const n = await novaNota('a');
    expect(n).toMatchObject({ documentNumber: null, volumes: null, labelKind: null, read: { state: 'LIDA' }, photoKey: 'a' });
    expect((await enviar(sup, 'a')).statusCode).toBe(201);
    expect((await lista()).items).toHaveLength(1);
    expect((await conteudos()).items).toHaveLength(antes);
    // Falha de leitura não impede: a linha fica vazia para digitar.
    expect((await enviar(sup, 'b', { failed: true })).statusCode).toBe(201);
    expect((await lista()).items.find((x) => x.photoKey === 'b')).toMatchObject({ read: { state: 'FALHOU' }, documentNumber: null });
    // Não existe rota nem tabela de imagem.
    const tabelas = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'foto_nota'`;
    expect(Number(tabelas[0]?.n)).toBe(0);
  });

  it('FULL: 1/2 não vira volumes; 100 digitado persiste e entra uma vez; incluir de novo não duplica', async () => {
    const n = await novaNota('full');
    await leitura(n.id, { number: '94123', numberRaw: '000094123-1', sender: 'Atacadao S.A', reference: '1/2', rawText: 'x' });
    const lida = (await lista()).items[0];
    expect(lida).toMatchObject({ documentNumber: '94123', sender: 'Atacadao S.A', labelReference: '1/2', volumes: null, labelKind: null });
    expect(lida?.missing).toContain('Etiqueta comum ou FULL');
    const pendente = await incluir([n.id]);
    expect(pendente.results[0]).toMatchObject({ ok: false });
    expect((await conteudos()).items.some((i) => i.documentNumber === '94123')).toBe(false);

    await salvar([{ id: n.id, expectedVersion: lida?.version ?? 1, changes: { labelKind: 'FULL', volumes: 100 } }]);
    expect((await lista()).items[0]).toMatchObject({ labelKind: 'FULL', volumes: 100, missing: [] });
    expect((await incluir([n.id])).results[0]).toMatchObject({ ok: true });
    expect((await incluir([n.id])).results[0]).toMatchObject({ ok: true });
    const achadas = (await conteudos()).items.filter((i) => i.documentNumber === '94123');
    expect(achadas).toHaveLength(1);
    expect(achadas[0]?.count.counted).toBe('100');
    expect((await lista()).items).toHaveLength(0);
  });

  it('leitura atrasada não desfaz o que a pessoa digitou; volumes vazios ficam vazios e incluem sem contagem', async () => {
    const n = await novaNota('atraso');
    await salvar([{ id: n.id, expectedVersion: n.version, changes: { documentNumber: '777', sender: 'Digitado Ltda', labelKind: 'COMUM' } }]);
    await leitura(n.id, { number: '94123', sender: 'Atacadao S.A', reference: '1/2' });
    const depois = (await lista()).items[0];
    expect(depois).toMatchObject({ documentNumber: '777', sender: 'Digitado Ltda', labelKind: 'COMUM', labelReference: '1/2', volumes: null });
    expect((await incluir([n.id])).results[0]).toMatchObject({ ok: true });
    expect((await conteudos()).items.find((i) => i.documentNumber === '777')?.count.counted).toBeNull();
  });

  it('nota já no palete pede decisão: vincular só a foto não soma nem cria cadastro; remetente diferente é outra nota', async () => {
    expect((await mutar(app, sup, 'POST', `/api/v1/paletes/${PALETE}/conteudos`, { sender: 'Atacadao S.A', documentType: 'NFD', documentNumber: '94123', delivery: null, description: null })).statusCode).toBe(201);
    const qtd = (await conteudos()).items.length;

    const mesma = await novaNota('dup');
    await salvar([{ id: mesma.id, expectedVersion: mesma.version, changes: { documentNumber: '000094123', sender: 'Atacadao S.A', labelKind: 'COMUM', volumes: 5 } }]);
    const pedido = (await lista()).items.find((n) => n.id === mesma.id);
    expect(pedido?.existing).toHaveLength(1);
    expect((await incluir([mesma.id])).results[0]).toMatchObject({ ok: false });
    await salvar([{ id: mesma.id, expectedVersion: pedido?.version ?? 1, changes: { decision: 'VINCULAR_FOTO' } }]);
    expect((await incluir([mesma.id])).results[0]).toMatchObject({ ok: true });
    expect((await conteudos()).items).toHaveLength(qtd);

    const outra = await novaNota('outra');
    await salvar([{ id: outra.id, expectedVersion: outra.version, changes: { documentNumber: '94123', sender: 'Outra Empresa', labelKind: 'COMUM' } }]);
    expect((await lista()).items.find((n) => n.id === outra.id)?.existing).toEqual([]);
  });

  it('salvamento parcial diz o que falhou; versão antiga é conflito; permissão e escopo são respeitados', async () => {
    const a = await novaNota('p1');
    const b = await novaNota('p2');
    await salvar([{ id: b.id, expectedVersion: b.version, changes: { delivery: '1' } }]);
    const r = ResultadoNotasFotoSchema.parse((await salvar([{ id: a.id, expectedVersion: a.version, changes: { delivery: '9' } }, { id: b.id, expectedVersion: b.version, changes: { delivery: '2' } }])).json());
    expect(r.results.map((x) => x.ok)).toEqual([true, false]);

    expect((await enviar(consulta, 'sem')).statusCode).toBe(403);
    expect((await como(app, outroEscopo, { method: 'GET', url })).statusCode).toBe(404);
  });
});
