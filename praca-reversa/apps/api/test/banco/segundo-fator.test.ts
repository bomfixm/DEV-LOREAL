import { ErroApiSchema, SegundoFatorAtivadoSchema, SessaoSchema, SegundoFatorInicioSchema, SegundoFatorSituacaoSchema, UsuarioAdminSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { base32Decodificar, codigoDoPasso, passoDe } from '../../src/modules/acesso/totp.js';
import { ID_ESCOPO_PRACA, Relogio, appDeTeste, bancoDeTeste, como, cookieDe, criarUsuario, entrar, prepararDados, type UsuarioTeste } from './apoio.js';

let db: Banco;
let relogio: Relogio;
let app: FastifyInstance;
let maria: UsuarioTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  relogio = new Relogio();
  app = await appDeTeste(db, { agora: relogio.agora, limitesLogin: { porConta: { maximo: 4, janelaMs: 15 * 60_000 }, porIp: { maximo: 100, janelaMs: 15 * 60_000 } } });
  maria = await criarUsuario(db, 'maria.2fa', [[ID_ESCOPO_PRACA, 'OPERADOR']]);
});

afterAll(async () => {
  await db.$disconnect();
});

const codigoAgora = (segredo: Buffer) => codigoDoPasso(segredo, passoDe(relogio.agora().getTime()));
const passar30s = () => relogio.avancar(30_000);
const entrarCom = (login: string, senha: string, codigo?: string) =>
  app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { login, senha, ...(codigo === undefined ? {} : { codigo }) } });

/** Ativa o segundo fator da conta e devolve o segredo e os códigos de recuperação. */
async function ativar(): Promise<{ segredo: Buffer; recuperacao: string[] }> {
  const sessao = await entrar(app, maria);
  const inicio = SegundoFatorInicioSchema.parse((await como(app, sessao, { method: 'POST', url: '/api/v1/sessao/segundo-fator/iniciar' })).json());
  const segredo = base32Decodificar(inicio.secret);
  const r = await como(app, sessao, { method: 'POST', url: '/api/v1/sessao/segundo-fator/ativar', payload: { code: codigoAgora(segredo) } });
  expect(r.statusCode).toBe(200);
  const { recoveryCodes } = SegundoFatorAtivadoSchema.parse(r.json());
  await como(app, sessao, { method: 'DELETE', url: '/api/v1/sessao' });
  passar30s();
  return { segredo, recuperacao: recoveryCodes };
}

describe('verificação em duas etapas', () => {
  it('sem ativar, o login continua só com a senha', async () => {
    expect((await entrarCom(maria.login, maria.senha)).statusCode).toBe(200);
  });

  it('cadastro: só vale depois de confirmar um código certo; o banco guarda o segredo cifrado', async () => {
    const sessao = await entrar(app, maria);
    const inicio = SegundoFatorInicioSchema.parse((await como(app, sessao, { method: 'POST', url: '/api/v1/sessao/segundo-fator/iniciar' })).json());
    expect(inicio.otpauthUri).toContain(`secret=${inicio.secret}`);

    // Cadastro iniciado e não confirmado: o login ainda não pede código.
    expect((await entrarCom(maria.login, maria.senha)).statusCode).toBe(200);
    expect(SegundoFatorSituacaoSchema.parse((await como(app, sessao, { method: 'GET', url: '/api/v1/sessao/segundo-fator' })).json()).enabled).toBe(false);

    const errado = await como(app, sessao, { method: 'POST', url: '/api/v1/sessao/segundo-fator/ativar', payload: { code: '000000' } });
    expect(errado.statusCode).toBe(422);
    expect(ErroApiSchema.parse(errado.json()).error.code).toBe('CODIGO_INVALIDO');

    const linha = await db.segundoFator.findUniqueOrThrow({ where: { usuarioId: maria.id } });
    expect(linha.segredoCifrado).not.toContain(inicio.secret);
    expect(linha.ativadoEm).toBeNull();

    const certo = await como(app, sessao, { method: 'POST', url: '/api/v1/sessao/segundo-fator/ativar', payload: { code: codigoAgora(base32Decodificar(inicio.secret)) } });
    expect(certo.statusCode).toBe(200);
    expect(SegundoFatorAtivadoSchema.parse(certo.json()).recoveryCodes).toHaveLength(8);
    const depois = await db.segundoFator.findUniqueOrThrow({ where: { usuarioId: maria.id } });
    expect(depois.ativadoEm).not.toBeNull();
    // Os códigos de recuperação ficam só como hash.
    const texto = JSON.stringify(depois);
    for (const c of SegundoFatorAtivadoSchema.parse(certo.json()).recoveryCodes) expect(texto).not.toContain(c);

    const eventos = await db.eventoAuditoria.findMany({ where: { atorUsuarioId: maria.id, acao: 'SEGUNDO_FATOR_ATIVADO' } });
    expect(eventos).toHaveLength(1);
    expect(JSON.stringify(eventos)).not.toContain(inicio.secret);

    // Não dá para recomeçar o cadastro por cima de um ativo.
    expect((await como(app, sessao, { method: 'POST', url: '/api/v1/sessao/segundo-fator/iniciar' })).statusCode).toBe(409);
  });

  it('login: senha certa sem código pede o código; código errado falha; certo entra; o mesmo código não vale duas vezes', async () => {
    const { segredo } = await ativar();

    const semCodigo = await entrarCom(maria.login, maria.senha);
    expect(semCodigo.statusCode).toBe(401);
    expect(ErroApiSchema.parse(semCodigo.json()).error.code).toBe('SEGUNDO_FATOR_NECESSARIO');
    expect(semCodigo.headers['set-cookie']).toBeUndefined();

    const errado = await entrarCom(maria.login, maria.senha, '123456');
    expect(errado.statusCode).toBe(401);
    expect(ErroApiSchema.parse(errado.json()).error.code).toBe('CODIGO_INVALIDO');

    // Código certo com senha errada: não entra (e não revela se o código estava certo).
    const senhaErrada = await entrarCom(maria.login, 'senha-errada-qualquer', codigoAgora(segredo));
    expect(senhaErrada.statusCode).toBe(401);
    expect(ErroApiSchema.parse(senhaErrada.json()).error.code).toBe('CREDENCIAIS_INVALIDAS');

    const codigo = codigoAgora(segredo);
    const entrou = await entrarCom(maria.login, maria.senha, codigo);
    expect(entrou.statusCode).toBe(200);
    const sucesso = await db.eventoAuditoria.findFirstOrThrow({ where: { atorUsuarioId: maria.id, acao: 'LOGIN_SUCESSO' }, orderBy: { ocorridoEm: 'desc' } });
    expect(sucesso.detalhes).toEqual({ segundoFator: 'TOTP' });

    // Repetir o mesmo código (mesma janela de 30 s) é recusado.
    const repetido = await entrarCom(maria.login, maria.senha, codigo);
    expect(repetido.statusCode).toBe(401);
    expect(ErroApiSchema.parse(repetido.json()).error.code).toBe('CODIGO_INVALIDO');
  });

  it('código de recuperação entra uma vez só e é consumido', async () => {
    const { recuperacao } = await ativar();
    const codigo = recuperacao[0] ?? '';
    const entrou = await entrarCom(maria.login, maria.senha, codigo.toLowerCase());
    expect(entrou.statusCode).toBe(200);
    const sucesso = await db.eventoAuditoria.findFirstOrThrow({ where: { atorUsuarioId: maria.id, acao: 'LOGIN_SUCESSO' }, orderBy: { ocorridoEm: 'desc' } });
    expect(sucesso.detalhes).toEqual({ segundoFator: 'RECUPERACAO' });
    expect((await entrarCom(maria.login, maria.senha, codigo)).statusCode).toBe(401);
    expect((await entrarCom(maria.login, maria.senha, recuperacao[1] ?? '')).statusCode).toBe(200);
    expect((await db.segundoFator.findUniqueOrThrow({ where: { usuarioId: maria.id } })).codigosRecuperacao).toHaveLength(6);
  });

  it('erros de código contam no bloqueio por tentativas', async () => {
    await ativar();
    for (let i = 0; i < 4; i++) expect((await entrarCom(maria.login, maria.senha, '111111')).statusCode).toBe(401);
    const bloqueado = await entrarCom(maria.login, maria.senha, '111111');
    expect(bloqueado.statusCode).toBe(429);
  });

  it('desativar exige senha e código; depois o login volta a ser só senha', async () => {
    const { segredo } = await ativar();
    const entrou = await entrarCom(maria.login, maria.senha, codigoAgora(segredo));
    const corpo = SessaoSchema.parse(entrou.json());
    const sessao = { cookie: cookieDe(entrou), csrf: corpo.csrfToken, corpo };

    const semSenha = await como(app, sessao, { method: 'POST', url: '/api/v1/sessao/segundo-fator/desativar', payload: { password: 'errada-errada', code: codigoAgora(segredo) } });
    expect(semSenha.statusCode).toBe(422);
    passar30s();
    const ok = await como(app, sessao, { method: 'POST', url: '/api/v1/sessao/segundo-fator/desativar', payload: { password: maria.senha, code: codigoAgora(segredo) } });
    expect(ok.statusCode).toBe(204);
    expect(await db.segundoFator.count({ where: { usuarioId: maria.id } })).toBe(0);
    expect((await entrarCom(maria.login, maria.senha)).statusCode).toBe(200);
  });

  it('administrador redefine o segundo fator de quem perdeu o celular; operador não pode', async () => {
    await ativar();
    const admin = await criarUsuario(db, 'admin.2fa', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]);
    const operador = await criarUsuario(db, 'operador.2fa', [[ID_ESCOPO_PRACA, 'OPERADOR']]);

    const lista = await como(app, await entrar(app, admin), { method: 'GET', url: '/api/v1/admin/usuarios' });
    const mariaNaLista = lista.json<{ items: unknown[] }>().items.map((i) => UsuarioAdminSchema.parse(i)).find((u) => u.login === maria.login);
    expect(mariaNaLista?.twoFactor).toBe(true);

    const negado = await como(app, await entrar(app, operador), { method: 'POST', url: `/api/v1/admin/usuarios/${maria.id}/segundo-fator/redefinir`, payload: { password: operador.senha }, headers: { 'idempotency-key': 'chave-operador-0001' } });
    expect(negado.statusCode).toBe(403);
    expect(await db.segundoFator.count({ where: { usuarioId: maria.id } })).toBe(1);

    const sessaoAdmin = await entrar(app, admin);

    // Sem a senha do próprio admin, ou com a senha errada, a redefinição é recusada (sessão sequestrada não basta).
    const semSenha = await como(app, sessaoAdmin, { method: 'POST', url: `/api/v1/admin/usuarios/${maria.id}/segundo-fator/redefinir`, headers: { 'idempotency-key': 'chave-admin-sem-senha' } });
    expect(semSenha.statusCode).toBe(400);
    const senhaErrada = await como(app, sessaoAdmin, { method: 'POST', url: `/api/v1/admin/usuarios/${maria.id}/segundo-fator/redefinir`, payload: { password: 'errada-errada-errada' }, headers: { 'idempotency-key': 'chave-admin-senha-errada' } });
    expect(senhaErrada.statusCode).toBe(422);
    expect(await db.segundoFator.count({ where: { usuarioId: maria.id } })).toBe(1);

    const r = await como(app, sessaoAdmin, { method: 'POST', url: `/api/v1/admin/usuarios/${maria.id}/segundo-fator/redefinir`, payload: { password: admin.senha }, headers: { 'idempotency-key': 'chave-admin-redefinir-1' } });
    expect(r.statusCode).toBe(200);
    expect(UsuarioAdminSchema.parse(r.json()).twoFactor).toBe(false);
    expect(await db.segundoFator.count({ where: { usuarioId: maria.id } })).toBe(0);
    expect((await entrarCom(maria.login, maria.senha)).statusCode).toBe(200);
    const evento = await db.eventoAuditoria.findFirstOrThrow({ where: { acao: 'SEGUNDO_FATOR_REDEFINIDO', alvoId: maria.id } });
    expect(evento.atorUsuarioId).toBe(admin.id);
  });
});
