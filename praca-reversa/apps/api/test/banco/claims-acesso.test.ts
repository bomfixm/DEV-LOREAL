import {
  ClaimDetalheSchema,
  LoteImportacaoSchema,
  PaginaClaimsSchema,
  ResultadoConfirmacaoSchema,
  ResultadoEnvioSchema,
  ResumoClaimsSchema,
  type LoteImportacao,
} from '@praca-reversa/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, chave, codigoErro, como, criarUsuario, entrar, enviarArquivo, mutar, type SessaoTeste } from './apoio.js';
import { API, claimFalta, criarClaim, criarPalete, criarProduto, montarAmbiente, reconciliar, recuperar, segmentoDe, type Ambiente } from './claims-apoio.js';

/**
 * Acesso, escopo, anexos, importação e exportação de claims (etapa 07; T27,
 * T28): permissão conferida no servidor por ação; outro escopo responde como
 * inexistente; anexos privados; lista de claims pelo importador da etapa 06;
 * CSV protegido contra fórmulas e sem valores duplicados. Dados fictícios.
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

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

function anexar(s: SessaoTeste, claimId: string, conteudo: Buffer, nome = 'foto.png') {
  return como(a.app, s, {
    method: 'POST',
    url: `${API}/claims/${claimId}/anexos`,
    payload: conteudo,
    headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': encodeURIComponent(nome), 'idempotency-key': chave() },
  });
}

async function importarClaims(s: SessaoTeste, nome: string, conteudo: Buffer): Promise<LoteImportacao> {
  const envio = await enviarArquivo(a.app, s, 'CLAIMS', nome, conteudo);
  expect(envio.statusCode, envio.body).toBe(201);
  const e = ResultadoEnvioSchema.parse(envio.json());
  if (!e.batch || !e.structure) throw new Error(`lote: ${envio.body}`);
  const mapa = await mutar(a.app, s, 'PUT', `${API}/importacoes/${e.batch.id}/mapeamento`, {
    expectedVersion: e.batch.version,
    options: e.structure.options,
    decimalSeparator: 'VIRGULA',
    columns: e.structure.suggestedColumns,
  });
  expect(mapa.statusCode, mapa.body).toBe(200);
  return LoteImportacaoSchema.parse(mapa.json());
}

function confirmar(s: SessaoTeste, lote: LoteImportacao) {
  return mutar(a.app, s, 'POST', `${API}/importacoes/${lote.id}/confirmar`, { previewVersion: lote.previewVersion, reviewed: true });
}

const CAB = [
  'Referência do claim',
  'Linha do claim',
  'Motivo',
  'SKU',
  'Quantidade em análise',
  'Unidade',
  'Lote',
  'Tipo da origem',
  'Referência da origem',
  'Prazo',
  'Valor estimado',
  'Base do valor',
  'Moeda',
  'Fonte do valor',
].join(';');

function csv(linhas: string[]): Buffer {
  return Buffer.from([CAB, ...linhas].join('\r\n'), 'utf8');
}

describe('T27/T28: permissão por ação e escopo no servidor', () => {
  it('operador e consulta não acessam claims; aprovação financeira exige concessão explícita', async () => {
    await criarProduto(a, '001000', 'Produto fictício');
    const claim = await criarClaim(a, claimFalta('001000'));
    expect((await como(a.app, a.op, { method: 'GET', url: `${API}/claims` })).statusCode).toBe(403);
    expect((await como(a.app, a.consulta, { method: 'GET', url: `${API}/claims/${claim.id}` })).statusCode).toBe(403);
    expect((await mutar(a.app, a.op, 'POST', `${API}/claims`, claimFalta('001000'))).statusCode).toBe(403);
    const resultado = {
      type: 'REGULARIZACAO',
      decisionDate: '2026-10-05',
      lines: [{ lineId: claim.lines[0]?.id, quantity: '1' }],
      value: null,
      currency: null,
      source: 'Tentativa sem permissão',
      reference: 'NEG-1',
      evidenceIds: [],
      attachmentIds: [],
    };
    // T27: operador chamando a API de aprovação diretamente.
    const op = await mutar(a.app, a.op, 'POST', `${API}/claims/${claim.id}/resultados`, resultado);
    expect(op.statusCode).toBe(403);
    expect(codigoErro(op)).toBe('ACESSO_NEGADO');
    // Analista sem concessão e supervisor também não aprovam.
    expect((await mutar(a.app, a.analista, 'POST', `${API}/claims/${claim.id}/resultados`, resultado)).statusCode).toBe(403);
    expect((await mutar(a.app, a.sup, 'POST', `${API}/claims/${claim.id}/resultados`, resultado)).statusCode).toBe(403);
    // Supervisor consulta, mas não trata nem valida.
    expect((await como(a.app, a.sup, { method: 'GET', url: `${API}/claims/${claim.id}` })).statusCode).toBe(200);
    expect((await mutar(a.app, a.sup, 'POST', `${API}/claims/${claim.id}/situacao`, { expectedVersion: claim.version, to: 'BUSCA_EM_ANDAMENTO', reason: 'Tentativa' })).statusCode).toBe(403);
    const negados = await db.eventoAuditoria.count({ where: { escopoId: ID_ESCOPO_PRACA, acao: 'ACESSO_NEGADO' } });
    expect(negados).toBeGreaterThanOrEqual(6);
  });

  it('T28: outro escopo não vê caso, candidatos, histórico, anexo nem exportação; referência a palete de outro escopo é recusada', async () => {
    const produto = await criarProduto(a, '001001', 'Produto fictício');
    const p = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '2', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const claim = await criarClaim(a, claimFalta('001001', { externalReference: 'CLM-ESCOPO-A' }));
    const anexo = await anexar(a.analista, claim.id, PNG);
    expect(anexo.statusCode, anexo.body).toBe(200);
    const anexoId = anexo.json<{ id: string }>().id;
    const linha = claim.lines[0]?.id ?? '';
    for (const url of [
      `${API}/claims/${claim.id}`,
      `${API}/claims/${claim.id}/historico`,
      `${API}/claims/${claim.id}/linhas/${linha}/candidatos`,
      `${API}/claims/${claim.id}/anexos/${anexoId}`,
    ]) {
      const r = await como(a.app, a.outroEscopo, { method: 'GET', url });
      expect(r.statusCode, url).toBe(404);
    }
    const lista = PaginaClaimsSchema.parse((await como(a.app, a.outroEscopo, { method: 'GET', url: `${API}/claims` })).json());
    expect(lista.total).toBe(0);
    const exp = await como(a.app, a.outroEscopo, { method: 'GET', url: `${API}/claims/exportar` });
    expect(exp.statusCode).toBe(200);
    expect(exp.body).not.toContain('CLM-ESCOPO-A');
    // Caso do outro escopo usando o palete deste escopo como evidência: inexistente para ele.
    await mutar(a.app, a.outroEscopo, 'POST', `${API}/produtos`, { sku: '001001', description: 'Produto fictício', canonicalUnit: 'UN', active: true, barcodes: [] });
    const outroClaim = await mutar(a.app, a.outroEscopo, 'POST', `${API}/claims`, claimFalta('001001'));
    expect(outroClaim.statusCode, outroClaim.body).toBe(200);
    const oc = ClaimDetalheSchema.parse(outroClaim.json());
    const ev = await mutar(a.app, a.outroEscopo, 'POST', `${API}/claims/${oc.id}/evidencias`, {
      lineId: oc.lines[0]?.id,
      type: 'MATERIAL_CONFERIDO',
      palletId: p.id,
      segmentId: segmentoDe(p, '001001'),
      quantity: '1',
      description: 'Tentativa de usar palete de outro escopo.',
    });
    expect(ev.statusCode).toBe(404);
    // Responsável de outro escopo não é aceito.
    const usuarioOutro = await db.usuario.findFirstOrThrow({ where: { login: 'analista.outro' } });
    const resp = await mutar(a.app, a.analista, 'POST', `${API}/claims`, { ...claimFalta('001001'), responsibleId: usuarioOutro.id });
    expect(resp.statusCode).toBe(400);
  });

  it('administrador concede e retira a aprovação financeira só de analista; efeito imediato', async () => {
    const admin = await criarUsuario(db, 'admin.claims', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]);
    const sAdmin = await entrar(a.app, admin);
    const analista = await db.usuario.findFirstOrThrow({ where: { login: 'analista' } });
    const operador = await db.usuario.findFirstOrThrow({ where: { login: 'operador' } });
    const neg = await mutar(a.app, sAdmin, 'PUT', `${API}/admin/usuarios/${operador.id}/vinculo`, { role: 'OPERADOR', active: true, financialApproval: true });
    expect(neg.statusCode).toBe(400);
    const ok = await mutar(a.app, sAdmin, 'PUT', `${API}/admin/usuarios/${analista.id}/vinculo`, { role: 'ANALISTA_CLAIMS', active: true, financialApproval: true });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<{ financialApproval: boolean }>().financialApproval).toBe(true);
    const sessao = await como(a.app, a.analista, { method: 'GET', url: `${API}/sessao` });
    expect(sessao.json<{ permissions: string[] }>().permissions).toContain('claim.aprovar_financeiro');
    // Mudar o perfil retira a concessão.
    const sup = await mutar(a.app, sAdmin, 'PUT', `${API}/admin/usuarios/${analista.id}/vinculo`, { role: 'SUPERVISOR_ESTOQUE', active: true });
    expect(sup.json<{ financialApproval: boolean }>().financialApproval).toBe(false);
    const depois = await como(a.app, a.analista, { method: 'GET', url: `${API}/sessao` });
    expect(depois.json<{ permissions: string[] }>().permissions).not.toContain('claim.aprovar_financeiro');
  });
});

describe('Anexos privados', () => {
  it('aceita foto/PDF pelo conteúdo, recusa outros tipos e tamanho acima do limite; download protegido e auditado', async () => {
    await criarProduto(a, '001010', 'Produto fictício');
    const claim = await criarClaim(a, claimFalta('001010'));
    const texto = await anexar(a.analista, claim.id, Buffer.from('<script>alert(1)</script>'), 'foto.png');
    expect(texto.statusCode).toBe(415);
    expect(codigoErro(texto)).toBe('ANEXO_INVALIDO');
    const ok = await anexar(a.analista, claim.id, PNG, 'Foto do palete.png');
    expect(ok.statusCode, ok.body).toBe(200);
    const id = ok.json<{ id: string; contentType: string }>().id;
    expect(ok.json<{ contentType: string }>().contentType).toBe('image/png');
    // Mesmo conteúdo: o anexo existente.
    const repetido = await anexar(a.analista, claim.id, PNG, 'outra.png');
    expect(repetido.json<{ id: string }>().id).toBe(id);
    const baixar = await como(a.app, a.sup, { method: 'GET', url: `${API}/claims/${claim.id}/anexos/${id}` });
    expect(baixar.statusCode).toBe(200);
    expect(baixar.headers['content-type']).toBe('image/png');
    expect(baixar.headers['content-disposition']).toMatch(/^attachment; filename="Foto-do-palete\.png"$/);
    expect(baixar.headers['x-content-type-options']).toBe('nosniff');
    expect(baixar.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(baixar.rawPayload).equals(PNG)).toBe(true);
    expect(await db.eventoAuditoria.count({ where: { acao: 'CLAIM_ANEXO_BAIXADO' } })).toBe(1);
    expect((await como(a.app, a.op, { method: 'GET', url: `${API}/claims/${claim.id}/anexos/${id}` })).statusCode).toBe(403);
  });

  it('anexo acima do limite configurado é recusado antes de gravar', async () => {
    await criarProduto(a, '001011', 'Produto fictício');
    const claim = await criarClaim(a, claimFalta('001011'));
    // A sessão vale em outra instância com limite menor (mesmo banco): limite configurável.
    const app = await appDeTeste(db, { claims: { anexoMaxBytes: 1024 } });
    const grande = Buffer.concat([PNG, Buffer.alloc(4096)]);
    const r = await como(app, a.analista, {
      method: 'POST',
      url: `${API}/claims/${claim.id}/anexos`,
      payload: grande,
      headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': 'grande.png', 'idempotency-key': chave() },
    });
    await app.close();
    expect(r.statusCode).toBe(413);
    expect(codigoErro(r)).toBe('ANEXO_INVALIDO');
    expect(await db.anexoClaim.count()).toBe(0);
  });
});

describe('Importação da lista de claims (fluxo da etapa 06)', () => {
  it('modelos CSV e XLSX funcionam no próprio fluxo; linhas pendentes ficam em triagem; nada muda no estoque', async () => {
    await criarProduto(a, '000123', 'Xampu fictício 300 ml');
    for (const arquivo of ['claims.csv', 'claims.xlsx']) {
      const modelo = await como(a.app, a.analista, { method: 'GET', url: `${API}/importacoes/modelos/${arquivo}` });
      expect(modelo.statusCode, arquivo).toBe(200);
      const lote = await importarClaims(a.analista, arquivo, Buffer.from(modelo.rawPayload));
      expect(lote.counters.invalid, JSON.stringify(lote)).toBe(0);
      if (arquivo === 'claims.csv') {
        expect(lote.counters.validNew).toBe(3);
        const r = await confirmar(a.analista, lote);
        expect(r.statusCode, r.body).toBe(200);
        expect(ResultadoConfirmacaoSchema.parse(r.json()).batch.result).toMatchObject({ claimsCreated: 2, claimLinesCreated: 3 });
      } else {
        // Mesmo conteúdo do CSV já importado: duplicatas, nada novo.
        expect(lote.counters).toMatchObject({ validNew: 0, duplicate: 3 });
      }
    }
    const lista = PaginaClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims?texto=CLM-MODELO` })).json());
    expect(lista.items.map((i) => i.externalReference).sort()).toEqual(['CLM-MODELO-0001', 'CLM-MODELO-0002']);
    const avaria = lista.items.find((i) => i.externalReference === 'CLM-MODELO-0002');
    expect(avaria?.deadline).toBeNull();
    expect(avaria?.triage).toBe(true);
    expect(avaria?.chargeFinalized).toBe(true);
    expect(await db.saldoEstoque.count({ where: { escopoId: ID_ESCOPO_PRACA, quantidadeVinculada: { gt: 0 } } })).toBe(0);
  });

  it('caso com várias linhas e pendências; mesma linha em outro arquivo é duplicata; dado diferente é conflito sem sobrescrever decisão', async () => {
    const produto = await criarProduto(a, '001020', 'Produto fictício');
    const lote = await importarClaims(a.analista, 'claims.csv', csv([
      'IMP-0001;1;FALTA;001020;12;UN;L-01;DEVOLUCAO;DEV-A-01;30/10/2026;10,00;UNITARIO;BRL;Tabela fictícia',
      'IMP-0001;2;FALTA;001999;3;UN;;;;30/10/2026;;;BRL;Tabela fictícia',
      ';3;FALTA;001020;1;UN;;;;;;;;',
      'IMP-0002;1;AVARIA;001020;2;UN;;DEVOLUCAO;DEV-B-02;01/11/2026;5,005;TOTAL;BRL;Portal',
    ]));
    expect(lote.counters).toMatchObject({ validNew: 2, invalid: 2 });
    const linhas = await como(a.app, a.analista, { method: 'GET', url: `${API}/importacoes/${lote.id}/linhas?classificacao=INVALIDA` });
    const motivos = linhas.json<{ items: { reasons: { code: string }[] }[] }>().items.flatMap((i) => i.reasons.map((r) => r.code));
    expect(motivos).toEqual(expect.arrayContaining(['CHAVE_INCOMPLETA', 'CASAS_DECIMAIS']));
    expect(codigoErro(await confirmar(a.analista, lote))).toBe('IMPORTACAO_BLOQUEADA');

    const bom = await importarClaims(a.analista, 'claims2.csv', csv([
      'IMP-0001;1;FALTA;001020;12;UN;L-01;DEVOLUCAO;DEV-A-01;30/10/2026;10,00;UNITARIO;BRL;Tabela fictícia',
      'IMP-0001;2;FALTA;001999;3;UN;;;;30/10/2026;;;BRL;Tabela fictícia',
    ]));
    expect(bom.counters.validNew).toBe(2);
    expect((await confirmar(a.analista, bom)).statusCode).toBe(200);
    const caso = PaginaClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims?texto=IMP-0001` })).json()).items[0];
    expect(caso?.lineCount).toBe(2);
    expect(caso?.triage).toBe(true);

    // Recuperação validada no caso importado.
    const p = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '4', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const d = ClaimDetalheSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims/${caso?.id ?? ''}` })).json());
    await recuperar(a, d.id, d.lines[0]?.id ?? '', p.id, segmentoDe(p, '001020'), '3');

    // Outro arquivo: mesma linha igual → duplicata; mesma identidade com quantidade diferente → conflito.
    const outro = await importarClaims(a.analista, 'claims3.csv', csv([
      'IMP-0001;001;FALTA;001020;12;UN;L-01;DEVOLUCAO;DEV-A-01;30/10/2026;10,00;UNITARIO;BRL;Tabela fictícia',
      'IMP-0001;2;FALTA;001999;5;UN;;;;30/10/2026;;;BRL;Tabela fictícia',
    ]));
    expect(outro.counters).toMatchObject({ duplicate: 1, conflicting: 1, validNew: 0 });
    const depois = ClaimDetalheSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims/${d.id}` })).json());
    expect(depois.lines.map((l) => l.quantity)).toEqual(['12', '3']);
    expect(depois.lines[0]?.recovered).toBe('3');
  });

  it('dois lotes concorrentes com a mesma linha nova: só um grava; o outro é revalidado sem duplicar', async () => {
    await criarProduto(a, '001030', 'Produto fictício');
    const conteudoA = csv(['CONC-1;1;FALTA;001030;5;UN;;;;;;;;']);
    const conteudoB = csv(['CONC-1;1;FALTA;001030;5;UN;;;;;;;;', '']);
    const [la, lb] = await Promise.all([importarClaims(a.analista, 'a.csv', conteudoA), importarClaims(a.analista, 'b.csv', conteudoB)]);
    const [ra, rb] = await Promise.all([confirmar(a.analista, la), confirmar(a.analista, lb)]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 409]);
    expect(await db.claim.count({ where: { referenciaExterna: 'CONC-1' } })).toBe(1);
    expect(await db.linhaClaim.count({ where: { claim: { referenciaExterna: 'CONC-1' } } })).toBe(1);
  });

  it('caso encerrado não recebe linhas por importação; analista não importa devoluções e não vê lotes de outros tipos', async () => {
    await criarProduto(a, '001040', 'Produto fictício');
    const lote = await importarClaims(a.analista, 'x.csv', csv(['ENC-1;1;FALTA;001040;1;UN;;;;;;;;']));
    expect((await confirmar(a.analista, lote)).statusCode).toBe(200);
    const caso = PaginaClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims?texto=ENC-1` })).json()).items[0];
    const enc = await mutar(a.app, a.analista, 'POST', `${API}/claims/${caso?.id ?? ''}/encerrar`, {
      expectedVersion: 1,
      to: 'ENCERRADO',
      decision: 'Claim cancelado pelo cliente (fictício).',
      pendenciesAcknowledged: true,
    });
    expect(enc.statusCode, enc.body).toBe(200);
    const novo = await importarClaims(a.analista, 'y.csv', csv(['ENC-1;2;FALTA;001040;1;UN;;;;;;;;']));
    expect(novo.counters.conflicting).toBe(1);
    const dev = await enviarArquivo(a.app, a.analista, 'DEVOLUCOES', 'd.csv', Buffer.from('Referência da devolução;Linha\r\nX;1', 'utf8'));
    expect(dev.statusCode).toBe(403);
    const supClaims = await enviarArquivo(a.app, a.sup, 'CLAIMS', 'c.csv', csv(['S-1;1;FALTA;001040;1;UN;;;;;;;;']));
    expect(supClaims.statusCode).toBe(403);
    const lotes = await como(a.app, a.analista, { method: 'GET', url: `${API}/importacoes` });
    expect(lotes.statusCode).toBe(200);
    expect(lotes.json<{ items: { type: string }[] }>().items.every((l) => l.type === 'CLAIMS')).toBe(true);
    expect((await como(a.app, a.analista, { method: 'GET', url: `${API}/importacoes?tipo=PRODUTOS` })).statusCode).toBe(403);
  });
});

describe('Lista, resumo e exportação', () => {
  it('filtros, ordenação estável e paginação no servidor; prazo vencido pelo fuso da unidade; ordem inicial configurável', async () => {
    await criarProduto(a, '001050', 'Produto fictício');
    await criarClaim(a, claimFalta('001050', { deadline: '2026-09-01', priority: 'BAIXA', externalReference: 'L-VENCIDO' }));
    await criarClaim(a, claimFalta('001050', { deadline: null, priority: 'URGENTE', externalReference: 'L-SEMPRAZO' }));
    await criarClaim(a, claimFalta('001050', { deadline: '2026-12-01', priority: null, externalReference: 'L-FUTURO', reason: 'AVARIA' }));
    const prioridade = PaginaClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims` })).json());
    expect(prioridade.sort).toBe('PRIORIDADE');
    expect(prioridade.items.map((i) => i.externalReference)).toEqual(['L-SEMPRAZO', 'L-VENCIDO', 'L-FUTURO']);
    const prazo = PaginaClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims?ordem=PRAZO` })).json());
    expect(prazo.items.map((i) => i.externalReference)).toEqual(['L-VENCIDO', 'L-FUTURO', 'L-SEMPRAZO']);
    const vencido = PaginaClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims?prazo=VENCIDO` })).json());
    expect(vencido.items.map((i) => i.externalReference)).toEqual(['L-VENCIDO']);
    const semPrazo = PaginaClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims?pendencia=SEM_PRAZO` })).json());
    expect(semPrazo.items.map((i) => i.deadline)).toEqual([null]);
    const avaria = PaginaClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims?motivo=AVARIA` })).json());
    expect(avaria.total).toBe(1);
    const p1 = PaginaClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims?tamanho=2&pagina=1` })).json());
    const p2 = PaginaClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims?tamanho=2&pagina=2` })).json());
    expect(p1.total).toBe(3);
    expect([...p1.items, ...p2.items].map((i) => i.id)).toEqual(prioridade.items.map((i) => i.id));
    // Ordem inicial configurável (CLAIMS_ORDEM_PADRAO).
    const app2 = await appDeTeste(db, { claims: { ordemPadrao: 'PRAZO' } });
    const outraOrdem = PaginaClaimsSchema.parse((await como(app2, a.analista, { method: 'GET', url: `${API}/claims` })).json());
    await app2.close();
    expect(outraOrdem).toMatchObject({ sort: 'PRAZO', defaultSort: 'PRAZO' });
    expect(outraOrdem.items.map((i) => i.externalReference)).toEqual(['L-VENCIDO', 'L-FUTURO', 'L-SEMPRAZO']);
  });

  it('resumo e exportação não duplicam valores por junção; moedas separadas; CSV protegido contra fórmula', async () => {
    const produto = await criarProduto(a, '001060', 'Produto fictício');
    const p = (await reconciliar(a, (await criarPalete(a)).id, [{ productId: produto.id, quantity: '10', lot: 'L-01', ref: 'DEV-A-01' }])).palete;
    const dados = claimFalta('001060', { externalReference: '=HYPERLINK("x")' });
    const linha0 = dados.lines[0];
    if (!linha0) throw new Error('linha');
    const claim = await criarClaim(a, { ...dados, lines: [linha0, { ...linha0, lineRef: '2', quantity: '2' }] });
    const comRec = await recuperar(a, claim.id, claim.lines[0]?.id ?? '', p.id, segmentoDe(p, '001060'), '2');
    const r = await mutar(a.app, a.financeiro, 'POST', `${API}/claims/${claim.id}/resultados`, {
      type: 'REGULARIZACAO',
      decisionDate: '2026-10-06',
      lines: [
        { lineId: claim.lines[0]?.id, quantity: '2' },
        { lineId: claim.lines[1]?.id, quantity: '2' },
      ],
      value: '40.00',
      currency: 'BRL',
      source: 'Portal (fictício)',
      reference: 'REG-2L',
      evidenceIds: [comRec.evidences[0]?.id],
    });
    expect(r.statusCode, r.body).toBe(200);
    await criarClaim(a, claimFalta('001060', { currency: 'USD' }));
    const resumo = ResumoClaimsSchema.parse((await como(a.app, a.analista, { method: 'GET', url: `${API}/claims/resumo` })).json());
    expect(resumo.avoidedConfirmed).toEqual([{ currency: 'BRL', value: '40.00', results: 1 }]);
    expect(resumo.estimated).toEqual([
      { currency: 'BRL', value: '140.00', cases: 1, partialCases: 0 },
      { currency: 'USD', value: '120.00', cases: 1, partialCases: 0 },
    ]);
    expect(resumo.validatedRecovery).toEqual([{ unit: 'UN', quantity: '2', cases: 1 }]);
    const exp = await como(a.app, a.analista, { method: 'GET', url: `${API}/claims/exportar?ordem=RECENTES` });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toContain('text/csv');
    expect(exp.body).toContain(`"'=HYPERLINK(""x"")"`);
    expect(exp.body).not.toMatch(/;"=HYPERLINK/);
    const linhaCaso = exp.body.split('\r\n').find((l) => l.includes('HYPERLINK')) ?? '';
    expect(linhaCaso).toContain('"40,00 BRL"');
    expect(linhaCaso.match(/"40,00 BRL"/g)).toHaveLength(1);
    expect(linhaCaso).toContain(";140,00;");
    expect((await como(a.app, a.sup, { method: 'GET', url: `${API}/claims/exportar` })).statusCode).toBe(403);
  });
});
