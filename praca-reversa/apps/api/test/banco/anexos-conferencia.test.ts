import { AnexoConferenciaSchema, ConferenciaDetalheSchema, LIMITE_ANEXOS_CONFERENCIA, type ConferenciaDetalhe } from '@praca-reversa/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as http } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bancoDeTeste, chave, codigoErro, como, mutar, type SessaoTeste } from './apoio.js';
import { API, criarPalete, montarAmbiente, type Ambiente } from './claims-apoio.js';

/**
 * Etapa 09 — anexos privados da conferência (§5; T28 para anexos): tipo pelo
 * conteúdo, limite, nome recebido só como rótulo, escopo e permissão no envio
 * e no download, envio interrompido sem registro, integridade (SHA-256) e
 * imutabilidade garantidas também pelo banco. Arquivos fictícios gerados no teste.
 */
const db = bancoDeTeste();
let a: Ambiente;
let conferencia: ConferenciaDetalhe;

/** JPEG mínimo (assinatura + bytes aleatórios): o servidor confere só a assinatura do conteúdo. */
function jpeg(tamanho = 2_048): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(tamanho)]);
}

function enviar(s: SessaoTeste, conteudo: Buffer, nome = 'foto.jpg', k = chave(), id = conferencia.id) {
  return como(a.app, s, {
    method: 'POST',
    url: `${API}/conferencias/${id}/anexos`,
    payload: conteudo,
    headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': encodeURIComponent(nome), 'idempotency-key': k },
  });
}

async function detalhe(s: SessaoTeste = a.op): Promise<ConferenciaDetalhe> {
  const r = await como(a.app, s, { method: 'GET', url: `${API}/conferencias/${conferencia.id}` });
  expect(r.statusCode, r.body).toBe(200);
  return ConferenciaDetalheSchema.parse(r.json());
}

beforeAll(async () => {
  a = await montarAmbiente(db);
  const p = await criarPalete(a);
  const inicio = await mutar(a.app, a.op, 'POST', `${API}/paletes/${p.id}/conferencias`, { scope: 'COMPLETA', scopeDescription: null, expectedVersion: p.version });
  expect(inicio.statusCode, inicio.body).toBe(201);
  conferencia = ConferenciaDetalheSchema.parse(inicio.json());
});

afterAll(async () => {
  await a.app.close();
  await db.$disconnect();
});

describe('anexos da conferência', () => {
  it('foto válida: privada, com hash e autoria; download só autenticado e sem execução', async () => {
    const conteudo = jpeg();
    const r = await enviar(a.op, conteudo, 'palete-frente.jpg');
    expect(r.statusCode, r.body).toBe(201);
    const anexo = AnexoConferenciaSchema.parse(r.json());
    expect(anexo).toMatchObject({ contentType: 'image/jpeg', size: conteudo.length, sha256: createHash('sha256').update(conteudo).digest('hex'), uploadedBy: { login: 'operador' } });
    expect((await detalhe()).attachments.map((x) => x.id)).toEqual([anexo.id]);

    // Perfil de consulta do mesmo escopo lê; o conteúdo é o mesmo e não vira página.
    const baixado = await como(a.app, a.consulta, { method: 'GET', url: `${API}/conferencias/${conferencia.id}/anexos/${anexo.id}` });
    expect(baixado.statusCode).toBe(200);
    expect(baixado.rawPayload.equals(conteudo)).toBe(true);
    expect(baixado.headers['content-type']).toBe('image/jpeg');
    expect(baixado.headers['content-disposition']).toMatch(/^attachment; filename="palete-frente\.jpg"$/);
    expect(baixado.headers['x-content-type-options']).toBe('nosniff');
    expect(baixado.headers['content-security-policy']).toContain('sandbox');
    expect(String(baixado.headers['cache-control'])).toContain('no-store');
    expect(baixado.headers['x-anexo-sha256']).toBe(anexo.sha256);
    expect(await db.eventoAuditoria.count({ where: { acao: 'CONFERENCIA_ANEXO_BAIXADO', alvoId: conferencia.id } })).toBe(1);

    // Sem sessão: nada.
    expect((await a.app.inject({ method: 'GET', url: `${API}/conferencias/${conferencia.id}/anexos/${anexo.id}` })).statusCode).toBe(401);

    // Mesmo conteúdo de novo (outra chave): devolve o anexo existente, sem duplicar.
    const repetido = await enviar(a.op, conteudo, 'outra-copia.jpg');
    expect(repetido.statusCode).toBe(201);
    expect(AnexoConferenciaSchema.parse(repetido.json()).id).toBe(anexo.id);
    expect(await db.anexoConferencia.count({ where: { conferenciaId: conferencia.id } })).toBe(1);
  });

  it('nome recebido nunca vira caminho: separadores e controle são removidos', async () => {
    const r = await enviar(a.op, jpeg(), '../../etc/passwd\\..\\x.jpg');
    expect(r.statusCode, r.body).toBe(201);
    const anexo = AnexoConferenciaSchema.parse(r.json());
    expect(anexo.name).not.toMatch(/[/\\]/);
    const baixado = await como(a.app, a.op, { method: 'GET', url: `${API}/conferencias/${conferencia.id}/anexos/${anexo.id}` });
    expect(baixado.headers['content-disposition']).not.toMatch(/[/\\]/);
  });

  it('tipo e tamanho inválidos são recusados pelo conteúdo, não pelo nome', async () => {
    const html = await enviar(a.op, Buffer.from('<html><script>alert(1)</script></html>'), 'foto.jpg');
    expect(html.statusCode).toBe(415);
    expect(codigoErro(html)).toBe('ANEXO_INVALIDO');
    const texto = await enviar(a.op, Buffer.from('apenas texto'), 'nota.pdf');
    expect(texto.statusCode).toBe(415);
    const vazio = await enviar(a.op, Buffer.alloc(0));
    expect(vazio.statusCode).toBe(400);
    const grande = await enviar(a.op, jpeg(5 * 1_048_576));
    expect(grande.statusCode).toBe(413);
    expect(codigoErro(grande)).toBe('ANEXO_INVALIDO');
  });

  it('outro escopo e perfil sem permissão: nem envio nem leitura (T28)', async () => {
    const anexo = (await detalhe()).attachments[0];
    expect(anexo).toBeDefined();
    const deFora = await como(a.app, a.outroEscopo, { method: 'GET', url: `${API}/conferencias/${conferencia.id}/anexos/${anexo?.id ?? ''}` });
    expect([403, 404]).toContain(deFora.statusCode);
    expect(deFora.rawPayload.includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
    const envioDeFora = await enviar(a.outroEscopo, jpeg());
    expect([403, 404]).toContain(envioDeFora.statusCode);
    const consulta = await enviar(a.consulta, jpeg());
    expect(consulta.statusCode).toBe(403);
    // Anexo de outra conferência não é lido por este caminho.
    const inexistente = await como(a.app, a.op, { method: 'GET', url: `${API}/conferencias/${conferencia.id}/anexos/${randomUUID()}` });
    expect(inexistente.statusCode).toBe(404);
  });

  it('envio interrompido no meio não deixa anexo nem metadado', async () => {
    const antes = await db.anexoConferencia.count();
    await a.app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = a.app.server.address() as AddressInfo;
    await new Promise<void>((resolver) => {
      const pedido = http({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `${API}/conferencias/${conferencia.id}/anexos`,
        headers: {
          cookie: a.op.cookie,
          'x-csrf-token': a.op.csrf,
          'idempotency-key': chave(),
          'content-type': 'application/octet-stream',
          'content-length': '200000',
          'x-arquivo-nome': 'incompleta.jpg',
        },
      });
      pedido.on('error', () => {
        resolver();
      });
      pedido.on('response', (r) => {
        r.resume();
        resolver();
      });
      pedido.write(jpeg(50_000));
      setTimeout(() => {
        pedido.destroy();
        resolver();
      }, 300);
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(await db.anexoConferencia.count()).toBe(antes);
  });

  it('banco garante integridade (hash do conteúdo) e imutabilidade', async () => {
    const existente = await db.anexoConferencia.findFirstOrThrow({ where: { conferenciaId: conferencia.id } });
    const conteudo = jpeg(64);
    await expect(
      db.anexoConferencia.create({
        data: {
          id: randomUUID(),
          escopoId: existente.escopoId,
          conferenciaId: conferencia.id,
          nome: 'adulterado.jpg',
          tipoConteudo: 'image/jpeg',
          tamanho: conteudo.length,
          sha256: 'a'.repeat(64),
          conteudo: new Uint8Array(conteudo),
          enviadoPorId: existente.enviadoPorId,
          enviadoEm: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE anexo_conferencia SET nome = 'trocado.jpg' WHERE id = ${existente.id}::uuid`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM anexo_conferencia WHERE id = ${existente.id}::uuid`).rejects.toThrow();
  });

  it('só durante a contagem e até o limite por conferência', async () => {
    const atuais = (await detalhe()).attachments.length;
    for (let i = atuais; i < LIMITE_ANEXOS_CONFERENCIA; i++) {
      const r = await enviar(a.op, jpeg(32));
      expect(r.statusCode, r.body).toBe(201);
    }
    const alemDoLimite = await enviar(a.op, jpeg(32));
    expect(alemDoLimite.statusCode).toBe(409);
    expect(codigoErro(alemDoLimite)).toBe('ANEXO_INVALIDO');

    const atual = await detalhe();
    const cancelada = await mutar(a.app, a.op, 'POST', `${API}/conferencias/${conferencia.id}/cancelar`, { expectedRevision: atual.revision, reason: 'Fim do teste (fictício)' });
    expect(cancelada.statusCode, cancelada.body).toBe(200);
    const depois = await enviar(a.op, jpeg(32));
    expect(depois.statusCode).toBe(409);
    // Os anexos continuam legíveis no histórico.
    expect((await detalhe()).attachments).toHaveLength(LIMITE_ANEXOS_CONFERENCIA);
  });
});
