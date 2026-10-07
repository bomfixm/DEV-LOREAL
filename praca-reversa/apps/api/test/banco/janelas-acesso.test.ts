import { PaginaJanelasSchema, PaginaMaterialSchema, ReservaDetalheSchema } from '@praca-reversa/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ID_ESCOPO_PRACA, bancoDeTeste, chave, codigoErro, como, criarUsuario, entrar, mutar, type SessaoTeste } from './apoio.js';
import { montarAmbiente, type Ambiente } from './claims-apoio.js';
import { API, corpoExpedicao, criarJanela, dadosJanela, expedir, expedirOk, idUsuario, janelaConfirmada, liberarMaterial, materialLiberado, pecas, reservar, reservarOk } from './janelas-apoio.js';

const db = bancoDeTeste();
let a: Ambiente;
let admin: SessaoTeste;

beforeAll(async () => {
  a = await montarAmbiente(db);
  const tecnico = await criarUsuario(db, 'admin.tecnico', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]);
  admin = await entrar(a.app, tecnico);
});
afterAll(async () => {
  await a.app.close();
  await db.$disconnect();
});

function anexar(s: SessaoTeste, janelaId: string) {
  return como(a.app, s, {
    method: 'POST',
    url: `${API}/janelas/${janelaId}/anexos`,
    payload: Buffer.from('%PDF-1.4\n% autorização fictícia\n'),
    headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': encodeURIComponent('autorizacao.pdf'), 'idempotency-key': chave() },
  });
}

describe('T27/T28: permissões por ação e escopo nas janelas', () => {
  it('perfis sem permissão recebem 403 mesmo em chamada direta; tentativas ficam auditadas', async () => {
    const { p, seg } = await materialLiberado(a, 'ACS-A', '10');
    const j = await janelaConfirmada(a, [pecas('50')]);
    const r = await reservarOk(a, j, [{ p, seg, q: '4' }]);
    const negadosAntes = await db.eventoAuditoria.count({ where: { acao: 'ACESSO_NEGADO' } });

    // Consulta: lê, não altera.
    expect((await como(a.app, a.consulta, { method: 'GET', url: `${API}/janelas` })).statusCode).toBe(200);
    expect((await como(a.app, a.consulta, { method: 'GET', url: `${API}/reservas/${r.id}` })).statusCode).toBe(200);
    expect((await mutar(a.app, a.consulta, 'POST', `${API}/janelas`, dadosJanela([pecas('1')]))).statusCode).toBe(403);
    expect((await reservar(a, j, [{ p, seg, q: '1' }], [], a.consulta)).statusCode).toBe(403);
    expect((await liberarMaterial(a, p, seg, '1', a.consulta)).statusCode).toBe(403);
    expect((await como(a.app, a.consulta, { method: 'GET', url: `${API}/janelas/exportar` })).statusCode).toBe(403);
    expect((await anexar(a.consulta, j.id)).statusCode).toBe(403);

    // Operador: prepara, mas não reserva, não libera, não expede, não cancela.
    expect((await reservar(a, j, [{ p, seg, q: '1' }], [], a.op)).statusCode).toBe(403);
    expect((await liberarMaterial(a, p, seg, '1', a.op)).statusCode).toBe(403);
    expect((await expedir(a, r, await corpoExpedicao(a, r), a.op)).statusCode).toBe(403);
    expect((await mutar(a.app, a.op, 'POST', `${API}/reservas/${r.id}/cancelar`, { expectedVersion: r.version, reason: 'Tentativa (fictício)' })).statusCode).toBe(403);
    const prep = await mutar(a.app, a.op, 'POST', `${API}/reservas/${r.id}/preparacao`, {
      expectedVersion: r.version,
      preparedAt: new Date(Date.now() - 60_000).toISOString(),
      responsibleId: await idUsuario(a, 'operador'),
      lines: r.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })),
      loadUnits: [],
      notes: null,
    });
    expect(prep.statusCode, prep.body).toBe(200);
    expect(ReservaDetalheSchema.parse(prep.json()).preparation.state).toBe('PREPARADA');
    expect((await anexar(a.op, j.id)).statusCode).toBe(200);

    // Analista de claims: só consulta.
    expect((await mutar(a.app, a.analista, 'POST', `${API}/janelas/${j.id}/confirmar`, { expectedVersion: j.version })).statusCode).toBe(403);
    // Administrador técnico não altera nem consulta estoque/janelas.
    expect((await como(a.app, admin, { method: 'GET', url: `${API}/janelas` })).statusCode).toBe(403);
    const atual = ReservaDetalheSchema.parse((await como(a.app, a.sup, { method: 'GET', url: `${API}/reservas/${r.id}` })).json());
    const e = await expedirOk(a, atual, await corpoExpedicao(a, atual));
    const retornoOp = await mutar(a.app, a.op, 'POST', `${API}/expedicoes/${e.id}/retornos`, {
      expectedVersion: e.version,
      type: 'AVISO_DOCUMENTAL',
      receivedAt: new Date(Date.now() - 60_000).toISOString(),
      reason: 'Aviso fictício',
      condition: 'SAUDAVEL',
      destinationPalletId: null,
      lines: [],
      attachmentIds: [],
      notes: null,
    });
    expect(retornoOp.statusCode).toBe(403);
    expect((await mutar(a.app, a.op, 'POST', `${API}/expedicoes/${e.id}/correcao`, { expectedVersion: e.version, reason: 'Tentativa (fictício)' })).statusCode).toBe(403);
    expect(await db.eventoAuditoria.count({ where: { acao: 'ACESSO_NEGADO' } })).toBeGreaterThanOrEqual(negadosAntes + 12);
  });

  it('outro escopo: janela, reserva, expedição, anexos e filas respondem como inexistentes', async () => {
    const { p, seg } = await materialLiberado(a, 'ACS-B', '5');
    const j = await janelaConfirmada(a, [pecas('50')]);
    const anexo = await anexar(a.sup, j.id);
    const anexoId = anexo.json<{ id: string }>().id;
    const r = await reservarOk(a, j, [{ p, seg, q: '2' }]);
    const e = await expedirOk(a, r, await corpoExpedicao(a, r));
    const o = a.outroEscopo;
    for (const url of [`${API}/janelas/${j.id}`, `${API}/reservas/${r.id}`, `${API}/expedicoes/${e.id}`, `${API}/janelas/${j.id}/anexos/${anexoId}`, `${API}/janelas/${j.id}/historico`]) {
      const resp = await como(a.app, o, { method: 'GET', url });
      expect([url, resp.statusCode]).toEqual([url, 404]);
    }
    const lista = PaginaJanelasSchema.parse((await como(a.app, o, { method: 'GET', url: `${API}/janelas` })).json());
    expect(lista.items.find((x) => x.id === j.id)).toBeUndefined();
    const material = PaginaMaterialSchema.parse((await como(a.app, o, { method: 'GET', url: `${API}/material-expedicao?texto=ACS-B` })).json());
    expect(material.total).toBe(0);
    // Mutações sobre registros de outro escopo: inexistentes (nada muda).
    const c = await mutar(a.app, a.outroEscopo, 'POST', `${API}/reservas/${r.id}/cancelar`, { expectedVersion: r.version, reason: 'Outro escopo' });
    expect(c.statusCode).toBe(403);
    // Anexo privado no próprio escopo: download com cabeçalhos de proteção.
    const download = await como(a.app, a.consulta, { method: 'GET', url: `${API}/janelas/${j.id}/anexos/${anexoId}` });
    expect([download.statusCode, download.headers['cache-control'], download.headers['content-security-policy']]).toEqual([200, expect.stringContaining('no-store'), "default-src 'none'; sandbox"]);
  });

  it('cenário 17: exportação com o mesmo filtro, sem duplicar por junções, protegida contra fórmulas', async () => {
    const j = await criarJanela(a, dadosJanela([pecas('10'), { metric: 'PALETES', limit: '2' }], { name: '=HYPERLINK("http://x")', clientReference: '+0001' }));
    await anexar(a.sup, j.id);
    await anexar(a.sup, j.id);
    const csv = await como(a.app, a.sup, { method: 'GET', url: `${API}/janelas/exportar?texto=${encodeURIComponent('=HYPERLINK')}` });
    expect(csv.statusCode).toBe(200);
    const linhas = csv.body.split('\r\n').filter((l) => l.includes(j.code));
    // Uma linha por restrição (2), mesmo com anexos e versões.
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(linhas[0]).toContain(`"'+0001"`);
    expect(await db.eventoAuditoria.count({ where: { acao: 'JANELA_EXPORTADA' } })).toBeGreaterThan(0);
    // Operador não exporta lista de preparação.
    const { p, seg } = await materialLiberado(a, 'ACS-C', '3');
    const jc = await janelaConfirmada(a, [pecas('10')]);
    const r = await reservarOk(a, jc, [{ p, seg, q: '1' }]);
    expect((await como(a.app, a.op, { method: 'GET', url: `${API}/reservas/${r.id}/preparacao.csv` })).statusCode).toBe(403);
    expect((await como(a.app, a.sup, { method: 'GET', url: `${API}/reservas/${r.id}/preparacao.csv` })).statusCode).toBe(200);
    // Reserva sem permissão de reserva: rejeitada antes de qualquer gravação.
    const negada = await reservar(a, jc, [{ p, seg, q: '1' }], [], a.analista);
    expect([negada.statusCode, codigoErro(negada)]).toEqual([403, 'ACESSO_NEGADO']);
  });
});
