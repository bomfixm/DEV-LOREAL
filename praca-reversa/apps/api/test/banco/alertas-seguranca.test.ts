import { ListaAlertasSegurancaSchema } from '@praca-reversa/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, como, criarUsuario, entrar, prepararDados } from './apoio.js';

let db: Banco;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function eventos(acao: string, quantidade: number, minutosAtras = 5) {
  const quando = new Date(Date.now() - minutosAtras * 60_000);
  await db.eventoAuditoria.createMany({
    data: Array.from({ length: quantidade }, () => ({ acao, resultado: 'NEGADO' as const, ocorridoEm: quando })),
  });
}

describe('alertas de segurança', () => {
  it('sem atividade anormal, não há alertas', async () => {
    const app = await appDeTeste(db);
    const admin = await criarUsuario(db, 'admin.alertas', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]);
    const sessao = await entrar(app, admin);
    const r = await como(app, sessao, { method: 'GET', url: '/api/v1/admin/alertas-seguranca' });
    expect(r.statusCode).toBe(200);
    expect(ListaAlertasSegurancaSchema.parse(r.json()).items).toEqual([]);
    await app.close();
  });

  it('dispara por limite, sobe de nível e ignora eventos fora da janela', async () => {
    const app = await appDeTeste(db);
    const admin = await criarUsuario(db, 'admin.alertas2', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]);
    const sessao = await entrar(app, admin);

    await eventos('LOGIN_FALHA', 12); // acima de 10, abaixo de 30 → atenção
    await eventos('LOGIN_BLOQUEADO', 1); // limite 1 → atenção
    await eventos('ACESSO_NEGADO', 50); // ≥ 40 → alta
    await eventos('BUSCA_EXPORTADA', 20, 180); // há 3 h: fora da janela de 1 h
    await eventos('PALETE_ARQUIVADO', 9); // abaixo do limite

    const r = await como(app, sessao, { method: 'GET', url: '/api/v1/admin/alertas-seguranca' });
    const itens = ListaAlertasSegurancaSchema.parse(r.json()).items;
    expect(itens.map((i) => i.code)).toEqual(['ACESSOS_NEGADOS', 'SENHAS_ERRADAS', 'LOGIN_BLOQUEADO']);
    expect(itens[0]).toMatchObject({ level: 'ALTA', count: 50 });
    expect(itens[1]).toMatchObject({ level: 'ATENCAO', count: 12 });
    await app.close();
  });

  it('só administrador consulta', async () => {
    const app = await appDeTeste(db);
    const operador = await criarUsuario(db, 'operador.alertas', [[ID_ESCOPO_PRACA, 'OPERADOR']]);
    const sessao = await entrar(app, operador);
    const r = await como(app, sessao, { method: 'GET', url: '/api/v1/admin/alertas-seguranca' });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
