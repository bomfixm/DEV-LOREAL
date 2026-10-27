import { AceiteDocumentoSchema, DocumentoPublicadoSchema, ListaDocumentosSchema, SituacaoDocumentosSchema, type ListaDocumentos } from '@praca-reversa/contracts';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import type { Banco } from '../../src/db/cliente.js';
import { CONFIG_TESTE, ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, codigoErro, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste } from './apoio.js';

/**
 * Termos de uso e aviso de privacidade (27 out. 2026), contra PostgreSQL real
 * e dados fictícios: minuta não aparece em rota pública (T06); só quem tem
 * `documentos.administrar` registra a aprovação e publica; aceite da versão
 * exata, idempotente, sem aceitar por outro usuário nem retroativo (T07);
 * exigência desligada por padrão não bloqueia ninguém e, ligada, só bloqueia
 * depois de haver termos publicados; texto, aprovação e aceite imutáveis no
 * banco; cliente e operador sem acesso à validação interna (T03/T05).
 */
const API = '/api/v1';
let db: Banco;
let app: FastifyInstance;
let admin: SessaoTeste;
let sup: SessaoTeste;
let op: SessaoTeste;
let cliente: SessaoTeste;
let adminId: string;
let opId: string;

const TEXTO_1 = 'Texto fictício de teste dos termos de uso, versão um. Sem validade jurídica.';
const TEXTO_2 = 'Texto fictício de teste dos termos de uso, versão dois. Sem validade jurídica.';
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const a = await criarUsuario(db, 'administrador', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]);
  const o = await criarUsuario(db, 'operador', [[ID_ESCOPO_PRACA, 'OPERADOR']]);
  adminId = a.id;
  opId = o.id;
  admin = await entrar(app, a);
  op = await entrar(app, o);
  sup = await entrar(app, await criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]));
  cliente = await entrar(app, await criarUsuario(db, 'cliente.consulta', [[ID_ESCOPO_PRACA, 'CLIENTE_CONSULTA']]));
});

afterAll(async () => {
  await db.$disconnect();
});

async function lista(): Promise<ListaDocumentos> {
  const r = await como(app, admin, { method: 'GET', url: `${API}/admin/documentos` });
  expect(r.statusCode, r.body).toBe(200);
  return ListaDocumentosSchema.parse(r.json());
}

async function minuta(texto: string, tipo = 'TERMOS_DE_USO'): Promise<string> {
  const r = await mutar(app, admin, 'POST', `${API}/admin/documentos`, { type: tipo, title: 'Termos de uso (teste)', content: texto });
  expect(r.statusCode, r.body).toBe(201);
  return r.json<{ id: string }>().id;
}

async function aprovarEPublicar(id: string): Promise<void> {
  const ap = await mutar(app, admin, 'POST', `${API}/admin/documentos/${id}/aprovacao`, { reference: 'Parecer fictício de teste nº 1', responsible: 'Pessoa fictícia (função de teste)' });
  expect(ap.statusCode, ap.body).toBe(200);
  const pub = await mutar(app, admin, 'POST', `${API}/admin/documentos/${id}/publicacao`, {});
  expect(pub.statusCode, pub.body).toBe(200);
}

const publico = (slug: string) => app.inject({ method: 'GET', url: `${API}/documentos-publicos/${slug}` });

describe('Minutas, aprovação e publicação', () => {
  it('sem publicação: rota pública responde "não publicado" e minuta não aparece (T06)', async () => {
    expect(codigoErro(await publico('termos'))).toBe('NAO_PUBLICADO');
    expect(codigoErro(await publico('privacidade'))).toBe('NAO_PUBLICADO');
    await minuta(TEXTO_1);
    const r = await publico('termos');
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain('versão um');
    expect((await publico('outro')).statusCode).toBe(404);
    // Ninguém fica bloqueado: exigência desligada por padrão.
    expect((await como(app, op, { method: 'GET', url: `${API}/praca` })).statusCode).toBe(200);
    const s = SituacaoDocumentosSchema.parse((await como(app, op, { method: 'GET', url: `${API}/documentos/situacao` })).json());
    expect(s).toMatchObject({ acceptanceRequired: false, terms: null, privacy: null, pending: false });
  });

  it('só documentos.administrar cria, aprova e publica; supervisor, operador e cliente recebem 403 (T07)', async () => {
    const id = await minuta(TEXTO_1);
    for (const s of [sup, op, cliente]) {
      expect(codigoErro(await como(app, s, { method: 'GET', url: `${API}/admin/documentos` }))).toBe('ACESSO_NEGADO');
      expect(codigoErro(await mutar(app, s, 'POST', `${API}/admin/documentos`, { type: 'TERMOS_DE_USO', title: 'X', content: TEXTO_2 }))).toBe('ACESSO_NEGADO');
      expect(codigoErro(await mutar(app, s, 'POST', `${API}/admin/documentos/${id}/aprovacao`, { reference: 'Referência qualquer', responsible: 'Alguém' }))).toBe('ACESSO_NEGADO');
      expect(codigoErro(await mutar(app, s, 'POST', `${API}/admin/documentos/${id}/publicacao`, {}))).toBe('ACESSO_NEGADO');
    }
    expect((await lista()).items[0]?.status).toBe('MINUTA');
  });

  it('minuta não publica sem aprovação; aprovação exige referência; publicação usa o hash do conteúdo; texto novo = versão nova', async () => {
    const v1 = await minuta(TEXTO_1);
    expect(codigoErro(await mutar(app, admin, 'POST', `${API}/admin/documentos/${v1}/publicacao`, {}))).toBe('SITUACAO_INVALIDA');
    expect(codigoErro(await mutar(app, admin, 'POST', `${API}/admin/documentos/${v1}/aprovacao`, { reference: 'ok', responsible: 'Pessoa' }))).toBe('REQUISICAO_INVALIDA');
    expect(codigoErro(await mutar(app, admin, 'POST', `${API}/admin/documentos`, { type: 'TERMOS_DE_USO', title: 'Repetida', content: TEXTO_1 }))).toBe('MINUTA_REPETIDA');
    await aprovarEPublicar(v1);
    // Aprovação registrada não é reescrita.
    expect(codigoErro(await mutar(app, admin, 'POST', `${API}/admin/documentos/${v1}/aprovacao`, { reference: 'Outra referência', responsible: 'Outra pessoa' }))).toBe('SITUACAO_INVALIDA');
    const p1 = DocumentoPublicadoSchema.parse((await publico('termos')).json());
    expect(p1).toMatchObject({ type: 'TERMOS_DE_USO', version: 1, content: TEXTO_1, hash: sha(TEXTO_1) });
    expect(JSON.stringify(p1)).not.toContain('Parecer');
    const v2 = await minuta(TEXTO_2);
    expect(DocumentoPublicadoSchema.parse((await publico('termos')).json()).version).toBe(1);
    await aprovarEPublicar(v2);
    expect(DocumentoPublicadoSchema.parse((await publico('termos')).json())).toMatchObject({ version: 2, hash: sha(TEXTO_2) });
    const l = await lista();
    expect(l.items.map((i) => [i.version, i.status])).toEqual([
      [2, 'PUBLICADO'],
      [1, 'SUBSTITUIDO'],
    ]);
    expect(l.items[1]?.approval).toMatchObject({ reference: 'Parecer fictício de teste nº 1', registeredBy: expect.any(String) as string });
    const eventos = await db.eventoAuditoria.findMany({ where: { acao: { startsWith: 'DOCUMENTO_' } }, orderBy: { ocorridoEm: 'asc' } });
    expect(eventos.map((e) => e.acao)).toEqual([
      'DOCUMENTO_MINUTA_CRIADA',
      'DOCUMENTO_APROVACAO_REGISTRADA',
      'DOCUMENTO_PUBLICADO',
      'DOCUMENTO_MINUTA_CRIADA',
      'DOCUMENTO_APROVACAO_REGISTRADA',
      'DOCUMENTO_PUBLICADO',
    ]);
    expect(eventos.every((e) => e.atorUsuarioId === adminId)).toBe(true);
  });
});

describe('Aceite', () => {
  it('versão exata, idempotente, sem aceitar por outro usuário nem versão substituída; aviso de privacidade não é consentimento (T07/T08)', async () => {
    const v1 = await minuta(TEXTO_1);
    await aprovarEPublicar(v1);
    const aviso = await minuta('Aviso de privacidade fictício de teste, sem validade jurídica.', 'AVISO_DE_PRIVACIDADE');
    await aprovarEPublicar(aviso);
    // Payload tentando outro usuário/horário: 400, nada gravado.
    expect(codigoErro(await mutar(app, op, 'POST', `${API}/documentos/${v1}/aceite`, { userId: adminId, acceptedAt: '2020-01-01T00:00:00Z' }))).toBe('REQUISICAO_INVALIDA');
    expect(await db.aceiteDocumento.count()).toBe(0);
    const r1 = await mutar(app, op, 'POST', `${API}/documentos/${v1}/aceite`, {});
    expect(r1.statusCode, r1.body).toBe(201);
    const a1 = AceiteDocumentoSchema.parse(r1.json());
    const r2 = await mutar(app, op, 'POST', `${API}/documentos/${v1}/aceite`, {});
    expect(r2.statusCode).toBe(200);
    expect(AceiteDocumentoSchema.parse(r2.json())).toMatchObject({ acceptedAt: a1.acceptedAt, repeated: true, hash: sha(TEXTO_1) });
    const gravados = await db.aceiteDocumento.findMany();
    expect(gravados).toHaveLength(1);
    expect(gravados[0]?.usuarioId).toBe(opId);
    expect(await db.eventoAuditoria.count({ where: { acao: 'DOCUMENTO_ACEITO' } })).toBe(1);
    // Aviso de privacidade: informativo, sem aceite.
    expect(codigoErro(await mutar(app, op, 'POST', `${API}/documentos/${aviso}/aceite`, {}))).toBe('SITUACAO_INVALIDA');
    // Nova versão: o aceite anterior não vale para ela; a substituída não recebe aceite novo.
    const v2 = await minuta(TEXTO_2);
    expect(codigoErro(await mutar(app, op, 'POST', `${API}/documentos/${v2}/aceite`, {}))).toBe('NAO_ENCONTRADO');
    await aprovarEPublicar(v2);
    expect(codigoErro(await mutar(app, sup, 'POST', `${API}/documentos/${v1}/aceite`, {}))).toBe('SITUACAO_INVALIDA');
    const s = SituacaoDocumentosSchema.parse((await como(app, op, { method: 'GET', url: `${API}/documentos/situacao` })).json());
    expect(s.terms).toMatchObject({ version: 2, acceptedAt: null });
    expect(s.privacy?.version).toBe(1);
  });

  it('duplo clique simultâneo grava um aceite e um evento', async () => {
    const v1 = await minuta(TEXTO_1);
    await aprovarEPublicar(v1);
    const respostas = await Promise.all([1, 2, 3].map(() => mutar(app, op, 'POST', `${API}/documentos/${v1}/aceite`, {})));
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
    expect(await db.aceiteDocumento.count()).toBe(1);
    expect(await db.eventoAuditoria.count({ where: { acao: 'DOCUMENTO_ACEITO' } })).toBe(1);
  });
});

describe('Exigência do aceite (DOCUMENTOS_EXIGIR_ACEITE)', () => {
  it('ligada: ninguém é bloqueado sem termos publicados; publicados, só sessão e documentos até aceitar; versão nova exige de novo', async () => {
    // Mesmo banco, instalação com a exigência ligada; as sessões valem nos dois (ficam no banco).
    const exigindo = await criarApp({ db, config: CONFIG_TESTE, interfaceDir: null, documentosExigirAceite: true });
    const s = await entrar(exigindo, await criarUsuario(db, 'operador.exigencia', [[ID_ESCOPO_PRACA, 'OPERADOR']]));
    expect((await como(exigindo, s, { method: 'GET', url: `${API}/praca` })).statusCode).toBe(200);
    const v1 = await minuta(TEXTO_1);
    expect((await como(exigindo, s, { method: 'GET', url: `${API}/praca` })).statusCode).toBe(200);
    await aprovarEPublicar(v1);
    expect(codigoErro(await como(exigindo, s, { method: 'GET', url: `${API}/praca` }))).toBe('ACEITE_PENDENTE');
    expect(codigoErro(await mutar(exigindo, s, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId: null, declaredItems: [] }))).toBe('ACEITE_PENDENTE');
    expect((await como(exigindo, s, { method: 'GET', url: `${API}/sessao` })).statusCode).toBe(200);
    expect(SituacaoDocumentosSchema.parse((await como(exigindo, s, { method: 'GET', url: `${API}/documentos/situacao` })).json()).pending).toBe(true);
    expect((await mutar(exigindo, s, 'POST', `${API}/documentos/${v1}/aceite`, {})).statusCode).toBe(201);
    expect((await como(exigindo, s, { method: 'GET', url: `${API}/praca` })).statusCode).toBe(200);
    // Versão nova: o aceite da anterior não vale.
    const v2 = await minuta(TEXTO_2);
    await aprovarEPublicar(v2);
    expect(codigoErro(await como(exigindo, s, { method: 'GET', url: `${API}/praca` }))).toBe('ACEITE_PENDENTE');
    // Instalação com a exigência desligada (padrão): a mesma sessão segue sem bloqueio.
    expect((await como(app, s, { method: 'GET', url: `${API}/praca` })).statusCode).toBe(200);
    await exigindo.close();
  });
});

describe('Banco: imutabilidade e coerência', () => {
  it('texto, aprovação e aceite não mudam; versão publicada não é apagada; hash errado é recusado', async () => {
    const v1 = await minuta(TEXTO_1);
    await aprovarEPublicar(v1);
    await mutar(app, op, 'POST', `${API}/documentos/${v1}/aceite`, {});
    await expect(db.$executeRaw`UPDATE "documento_publico" SET "conteudo" = 'alterado' WHERE "id" = ${v1}::uuid`).rejects.toThrow(/DOCUMENTO_IMUTAVEL|documento_publico_coerente/);
    await expect(db.$executeRaw`UPDATE "documento_publico" SET "aprovacao_referencia" = 'Outra referência' WHERE "id" = ${v1}::uuid`).rejects.toThrow(/DOCUMENTO_IMUTAVEL/);
    await expect(db.$executeRaw`UPDATE "documento_publico" SET "situacao" = 'MINUTA', "aprovado_em" = NULL WHERE "id" = ${v1}::uuid`).rejects.toThrow(/DOCUMENTO_IMUTAVEL/);
    await expect(db.$executeRaw`DELETE FROM "documento_publico" WHERE "id" = ${v1}::uuid`).rejects.toThrow(/DOCUMENTO_IMUTAVEL/);
    await expect(db.$executeRaw`UPDATE "aceite_documento" SET "aceito_em" = now() - interval '1 day'`).rejects.toThrow(/ACEITE_IMUTAVEL/);
    await expect(db.$executeRaw`DELETE FROM "aceite_documento"`).rejects.toThrow(/ACEITE_IMUTAVEL/);
    // Auditoria: só acrescentada (nem a aplicação nem um usuário do banco da aplicação reescreve).
    await expect(db.$executeRaw`UPDATE "evento_auditoria" SET "resultado" = 'FALHA' WHERE "acao" = 'DOCUMENTO_ACEITO'`).rejects.toThrow(/REGISTRO_IMUTAVEL/);
    await expect(db.$executeRaw`DELETE FROM "evento_auditoria"`).rejects.toThrow(/REGISTRO_IMUTAVEL/);
    await expect(
      db.$executeRaw`INSERT INTO "documento_publico" ("id", "tipo", "versao", "titulo", "conteudo", "hash", "situacao", "criado_por_id")
        VALUES (gen_random_uuid(), 'AVISO_DE_PRIVACIDADE', 1, 'Aviso', 'Conteúdo fictício', ${'0'.repeat(64)}, 'MINUTA', ${adminId}::uuid)`,
    ).rejects.toThrow(/documento_publico_coerente/);
    // Aceite direto no banco de versão não publicada / com hash diferente: recusado.
    const v2 = await minuta(TEXTO_2);
    await expect(
      db.$executeRaw`INSERT INTO "aceite_documento" ("id", "documento_id", "usuario_id", "hash") VALUES (gen_random_uuid(), ${v2}::uuid, ${opId}::uuid, ${sha(TEXTO_2)})`,
    ).rejects.toThrow(/ACEITE_INVALIDO/);
  });
});

describe('Validação interna fora do alcance do cliente e do operador (T03/T05)', () => {
  it('cliente não lê a fila nem o resumo; operador e cliente não resolvem pela API', async () => {
    expect(codigoErro(await como(app, cliente, { method: 'GET', url: `${API}/validacao` }))).toBe('ACESSO_NEGADO');
    expect(codigoErro(await como(app, cliente, { method: 'GET', url: `${API}/validacao/resumo` }))).toBe('ACESSO_NEGADO');
    const corpo = { items: [{ kind: 'REGISTRADO', id: '00000000-0000-4000-8000-000000000001' }], destination: { kind: 'PALETE', id: '00000000-0000-4000-8000-000000000002' }, reason: 'Teste de permissão' };
    for (const s of [op, cliente]) expect(codigoErro(await mutar(app, s, 'POST', `${API}/validacao/resolver`, corpo))).toBe('ACESSO_NEGADO');
  });
});
