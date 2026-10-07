import { ListaProdutosSchema, PaleteDetalheSchema, PracaSchema, ProdutoSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import {
  ID_ESCOPO_NAVEGACAO,
  ID_ESCOPO_PRACA,
  appDeTeste,
  bancoDeTeste,
  como,
  codigoErro,
  criarUsuario,
  entrar,
  idPosicao,
  mutar,
  prepararDados,
  type SessaoTeste,
  type UsuarioTeste,
} from './apoio.js';

let db: Banco;
let app: FastifyInstance;
let sSupervisor: SessaoTeste;
let sOperador: SessaoTeste;
let sConsulta: SessaoTeste;
let sNavOperador: SessaoTeste;
let sNavSupervisor: SessaoTeste;
let sAdmin: SessaoTeste;
let consulta: UsuarioTeste;

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const usuarios = await Promise.all([
    criarUsuario(db, 'supervisor', [[ID_ESCOPO_PRACA, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'operador', [[ID_ESCOPO_PRACA, 'OPERADOR']]),
    criarUsuario(db, 'consulta', [[ID_ESCOPO_PRACA, 'CONSULTA']]),
    criarUsuario(db, 'nav.operador', [[ID_ESCOPO_NAVEGACAO, 'OPERADOR']]),
    criarUsuario(db, 'nav.supervisor', [[ID_ESCOPO_NAVEGACAO, 'SUPERVISOR_ESTOQUE']]),
    criarUsuario(db, 'admin', [[ID_ESCOPO_PRACA, 'ADMINISTRADOR']]),
  ]);
  const [supervisor, operador, umaConsulta, navOperador, navSupervisor, admin] = usuarios;
  [sSupervisor, sOperador, sConsulta, sNavOperador, sNavSupervisor, sAdmin] = await Promise.all([
    entrar(app, supervisor),
    entrar(app, operador),
    entrar(app, umaConsulta),
    entrar(app, navOperador),
    entrar(app, navSupervisor),
    entrar(app, admin),
  ]);
  consulta = usuarios[2];
});

afterAll(async () => {
  await db.$disconnect();
});

const produtoValido = (sku = ' 000123 ') => ({
  sku,
  description: 'Shampoo fictício 300 ml',
  canonicalUnit: 'un',
  active: true,
  barcodes: [
    { code: '0007891234567', packaging: 'UN', factor: '1' },
    { code: '00017891234564', packaging: 'CX', factor: '12' },
  ],
});

const linhaPendente = { sku: null, description: 'Caixa sem etiqueta', lot: null, originType: 'DEVOLUCAO', originReference: 'DEV-0099', quantity: '3', unit: 'UN' };

function novoPalete(sessao: SessaoTeste, corpo: object, chaveIdem?: string) {
  return mutar(app, sessao, 'POST', '/api/v1/paletes', corpo, chaveIdem);
}

async function praca(sessao: SessaoTeste) {
  return PracaSchema.parse((await como(app, sessao, { method: 'GET', url: '/api/v1/praca' })).json());
}

describe('produtos', () => {
  it('cria produto com SKU e códigos de barras em texto (zeros à esquerda) e fator explícito', async () => {
    const resposta = await mutar(app, sSupervisor, 'POST', '/api/v1/produtos', produtoValido());
    expect(resposta.statusCode).toBe(201);
    const produto = ProdutoSchema.parse(resposta.json());
    expect(produto).toMatchObject({ sku: '000123', canonicalUnit: 'UN', active: true, version: 1, inUse: false });
    expect(produto.barcodes).toEqual([
      { code: '00017891234564', packaging: 'CX', factor: '12' },
      { code: '0007891234567', packaging: 'UN', factor: '1' },
    ]);
    const lista = ListaProdutosSchema.parse((await como(app, sConsulta, { method: 'GET', url: '/api/v1/produtos?texto=0001' })).json());
    expect(lista.items.map((p) => p.sku)).toEqual(['000123']);
    // Cadastrar produto não cria saldo nem palete.
    expect(await db.saldoEstoque.count({ where: { segmento: { produto: { sku: '000123' } } } })).toBe(0);
  });

  it('somente quem tem permissão cadastra; outro escopo não vê o produto', async () => {
    expect((await mutar(app, sConsulta, 'POST', '/api/v1/produtos', produtoValido())).statusCode).toBe(403);
    expect((await mutar(app, sOperador, 'POST', '/api/v1/produtos', produtoValido())).statusCode).toBe(403);
    expect((await mutar(app, sAdmin, 'POST', '/api/v1/produtos', produtoValido())).statusCode).toBe(403);
    expect((await mutar(app, sSupervisor, 'POST', '/api/v1/produtos', produtoValido())).statusCode).toBe(201);
    const outroEscopo = ListaProdutosSchema.parse((await como(app, sNavOperador, { method: 'GET', url: '/api/v1/produtos' })).json());
    expect(outroEscopo.items).toEqual([]);
  });

  it('rejeita SKU repetido, fator incoerente e código de barras de outro produto', async () => {
    expect((await mutar(app, sSupervisor, 'POST', '/api/v1/produtos', produtoValido())).statusCode).toBe(201);
    const repetido = await mutar(app, sSupervisor, 'POST', '/api/v1/produtos', produtoValido('000123'));
    expect([repetido.statusCode, codigoErro(repetido)]).toEqual([409, 'CONFLITO']);
    const fatorNaCanonica = { ...produtoValido('A1'), barcodes: [{ code: '111', packaging: 'UN', factor: '12' }] };
    expect((await mutar(app, sSupervisor, 'POST', '/api/v1/produtos', fatorNaCanonica)).statusCode).toBe(400);
    const caixaFracionada = { ...produtoValido('A2'), barcodes: [{ code: '222', packaging: 'CX', factor: '1.5' }] };
    expect((await mutar(app, sSupervisor, 'POST', '/api/v1/produtos', caixaFracionada)).statusCode).toBe(400);
    const codigoDeOutro = { ...produtoValido('A3'), barcodes: [{ code: '0007891234567', packaging: 'UN', factor: '1' }] };
    const resposta = await mutar(app, sSupervisor, 'POST', '/api/v1/produtos', codigoDeOutro);
    expect([resposta.statusCode, codigoErro(resposta)]).toEqual([409, 'CONFLITO']);
    // Os produtos fictícios da carga de demonstração (DEMO-…) não contam.
    expect(await db.produto.count({ where: { NOT: { sku: { startsWith: 'DEMO-' } } } })).toBe(1);
  });

  it('alteração exige a versão vista e a unidade canônica fica travada depois de usada', async () => {
    const criado = ProdutoSchema.parse((await mutar(app, sSupervisor, 'POST', '/api/v1/produtos', produtoValido())).json());
    const alterar = (corpo: object) => mutar(app, sSupervisor, 'PUT', `/api/v1/produtos/${criado.id}`, corpo);
    const base = { description: 'Shampoo fictício 300 ml (revisado)', canonicalUnit: 'UN', active: true, barcodes: criado.barcodes };
    const ok = await alterar({ ...base, expectedVersion: 1 });
    expect(ProdutoSchema.parse(ok.json()).version).toBe(2);
    const atrasado = await alterar({ ...base, expectedVersion: 1 });
    expect([atrasado.statusCode, codigoErro(atrasado)]).toEqual([409, 'CONFLITO_VERSAO']);

    const linha = { sku: '000123', description: null, lot: '0042', originType: 'NOTA_FISCAL', originReference: '000456', quantity: '2', unit: 'CX' };
    expect((await novoPalete(sOperador, { code: { mode: 'GERAR' }, positionId: null, declaredItems: [linha] })).statusCode).toBe(201);
    const trocaUnidade = await alterar({ ...base, canonicalUnit: 'KG', barcodes: [], expectedVersion: 2 });
    expect([trocaUnidade.statusCode, codigoErro(trocaUnidade)]).toEqual([409, 'CONFLITO']);
  });
});

describe('cadastro de palete', () => {
  it('gera o próximo código, cria palete desconhecido e aparece para outro usuário autorizado', async () => {
    const posicao = await idPosicao(db, ID_ESCOPO_PRACA, 'F06-P17');
    const resposta = await novoPalete(sOperador, {
      code: { mode: 'GERAR' },
      positionId: posicao,
      notes: '  Recebido no fim do turno  ',
      declaredItems: [linhaPendente],
    });
    expect(resposta.statusCode).toBe(201);
    const criado = PaleteDetalheSchema.parse(resposta.json());
    expect(criado).toMatchObject({
      code: 'PAL-DEMO-007',
      codeOrigin: 'GERADO',
      positionId: posicao,
      positionCode: 'F06-P17',
      countState: 'NAO_CONFERIDO',
      releaseState: 'PENDENTE',
      flowState: 'EM_ESTOQUE',
      currentItems: null,
      observedCounts: [],
      activeCountId: null,
      lastReconciliation: null,
      notes: 'Recebido no fim do turno',
      createdBy: { login: 'operador' },
      version: 1,
      archived: null,
    });
    expect(criado.declaredItems).toEqual([
      { productId: null, sku: null, description: 'Caixa sem etiqueta', lot: null, originType: 'DEVOLUCAO', originReference: 'DEV-0099', quantity: '3', unit: 'UN', condition: null },
    ]);
    // Declaração não vira observação nem saldo.
    expect(await db.saldoEstoque.count({ where: { paleteId: criado.id } })).toBe(0);
    expect(await db.sessaoConferencia.count({ where: { paleteId: criado.id } })).toBe(0);

    // Outro usuário autorizado (consulta) vê no mapa, na lista e no detalhe.
    const vista = await praca(sConsulta);
    expect(vista.pallets.find((p) => p.id === criado.id)).toMatchObject({ code: 'PAL-DEMO-007', positionCode: 'F06-P17' });
    const detalhe = PaleteDetalheSchema.parse((await como(app, sConsulta, { method: 'GET', url: `/api/v1/paletes/${criado.id}` })).json());
    expect(detalhe.code).toBe('PAL-DEMO-007');
    expect(await db.eventoAuditoria.count({ where: { acao: 'PALETE_CADASTRADO', alvoId: criado.id } })).toBe(1);

    // "Reinício": outro cliente de banco e outra instância da API leem o mesmo registro.
    const outroBanco = bancoDeTeste();
    const outraApp = await appDeTeste(outroBanco);
    try {
      const sessao = await entrar(outraApp, consulta);
      const relido = PaleteDetalheSchema.parse((await como(outraApp, sessao, { method: 'GET', url: `/api/v1/paletes/${criado.id}` })).json());
      expect(relido).toMatchObject({ code: 'PAL-DEMO-007', positionCode: 'F06-P17' });
    } finally {
      await outraApp.close();
      await outroBanco.$disconnect();
    }
  });

  it('cadastros simultâneos com código gerado recebem códigos diferentes', async () => {
    const respostas = await Promise.all(Array.from({ length: 6 }, () => novoPalete(sOperador, { code: { mode: 'GERAR' }, positionId: null })));
    expect(respostas.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
    const codigos = respostas.map((r) => PaleteDetalheSchema.parse(r.json()).code).sort();
    expect(codigos).toEqual(['PAL-DEMO-007', 'PAL-DEMO-008', 'PAL-DEMO-009', 'PAL-DEMO-010', 'PAL-DEMO-011', 'PAL-DEMO-012']);
    // Sem posição: aparecem como localização pendente (fora do mapa).
    const vista = await praca(sConsulta);
    expect(vista.pallets.filter((p) => codigos.includes(p.code)).every((p) => p.positionId === null)).toBe(true);
  });

  it('código informado: normalizado, único (inclusive equivalente e arquivado) e diferente de posição', async () => {
    const informar = (valor: string) => novoPalete(sOperador, { code: { mode: 'INFORMAR', value: valor }, positionId: null });
    const criado = await informar(' pal-x-001 ');
    expect(PaleteDetalheSchema.parse(criado.json())).toMatchObject({ code: 'PAL-X-001', codeOrigin: 'EXISTENTE' });
    expect(PaleteDetalheSchema.parse((await informar('000123')).json()).code).toBe('000123');

    for (const repetido of ['PAL-X-001', 'PALX001', 'pal.x.001', 'PAL-DEMO-001', '000123']) {
      const r = await informar(repetido);
      expect([r.statusCode, codigoErro(r)], repetido).toEqual([409, 'CONFLITO']);
    }
    const posicao = await informar('F01-P05');
    expect(posicao.statusCode).toBe(409);
    expect(posicao.json<{ error: { message: string } }>().error.message).toMatch(/posição/);
    expect((await informar('PAL X 001')).statusCode).toBe(400);

    // Arquivado: o código continua reservado.
    const id = PaleteDetalheSchema.parse(criado.json()).id;
    const arquivado = await mutar(app, sSupervisor, 'POST', `/api/v1/paletes/${id}/arquivar`, { expectedVersion: 1, reason: 'Cadastro em duplicidade' });
    expect(arquivado.statusCode).toBe(200);
    const reutilizar = await informar('PAL-X-001');
    expect(reutilizar.statusCode).toBe(409);
    expect(reutilizar.json<{ error: { message: string } }>().error.message).toMatch(/arquivado/);
  });

  it('duas pessoas na mesma posição ao mesmo tempo: só uma atribuição, sem registro parcial', async () => {
    const posicao = await idPosicao(db, ID_ESCOPO_PRACA, 'F05-P10');
    const antes = { paletes: await db.palete.count(), linhas: await db.itemDeclarado.count(), eventos: await db.eventoAuditoria.count({ where: { acao: 'PALETE_CADASTRADO' } }) };
    const sessoes = [sOperador, sSupervisor, sOperador, sSupervisor, sOperador, sSupervisor];
    const respostas = await Promise.all(
      sessoes.map((s, i) =>
        novoPalete(s, { code: { mode: 'INFORMAR', value: `PAL-CONC-${String(i)}` }, positionId: posicao, declaredItems: [linhaPendente] }),
      ),
    );
    const status = respostas.map((r) => r.statusCode).sort();
    expect(status).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await db.palete.count({ where: { posicaoId: posicao } })).toBe(1);
    expect(await db.palete.count()).toBe(antes.paletes + 1);
    expect(await db.itemDeclarado.count()).toBe(antes.linhas + 1);
    expect(await db.eventoAuditoria.count({ where: { acao: 'PALETE_CADASTRADO' } })).toBe(antes.eventos + 1);
    expect(await db.registroIdempotencia.count({ where: { operacao: 'palete.cadastrar' } })).toBe(1);
  });

  it('nega posição ocupada, indisponível, retirada e de outro escopo', async () => {
    const tentar = (positionId: string) => novoPalete(sOperador, { code: { mode: 'GERAR' }, positionId });
    const ocupada = await tentar(await idPosicao(db, ID_ESCOPO_PRACA, 'F01-P01'));
    expect([ocupada.statusCode, codigoErro(ocupada)]).toEqual([409, 'CONFLITO']);

    const indisponivel = await idPosicao(db, ID_ESCOPO_PRACA, 'F03-P04');
    const layout = (await praca(sSupervisor)).layout;
    expect(
      (await mutar(app, sSupervisor, 'PATCH', `/api/v1/layout/posicoes/${indisponivel}`, {
        expectedRevision: layout?.revision,
        available: false,
        unavailableReason: 'Pilar no levantamento fictício',
      })).statusCode,
    ).toBe(200);
    expect((await tentar(indisponivel)).statusCode).toBe(409);

    const retirada = await idPosicao(db, ID_ESCOPO_PRACA, 'F03-P05');
    expect(
      (await mutar(app, sSupervisor, 'POST', `/api/v1/layout/posicoes/${retirada}/retirar`, { expectedRevision: 2, reason: 'Não existe no local' })).statusCode,
    ).toBe(200);
    expect((await tentar(retirada)).statusCode).toBe(409);

    const deOutroEscopo = await idPosicao(db, ID_ESCOPO_NAVEGACAO, 'C-02');
    expect((await tentar(deOutroEscopo)).statusCode).toBe(400);
    expect(await db.palete.count({ where: { escopoId: ID_ESCOPO_PRACA, codigo: { startsWith: 'PAL-DEMO-0' } } })).toBe(6);
  });

  it('permissões e escopo são verificados em chamadas diretas', async () => {
    const corpo = { code: { mode: 'GERAR' }, positionId: null };
    expect((await novoPalete(sConsulta, corpo)).statusCode).toBe(403);
    expect((await novoPalete(sAdmin, corpo)).statusCode).toBe(403);
    expect((await como(app, sOperador, { method: 'POST', url: '/api/v1/paletes', payload: corpo })).statusCode).toBe(400);
    expect(
      (await como(app, sOperador, { method: 'POST', url: '/api/v1/paletes', payload: corpo, headers: { 'idempotency-key': 'chave-sem-csrf-1' }, semCsrf: true })).statusCode,
    ).toBe(403);

    const criado = PaleteDetalheSchema.parse((await novoPalete(sOperador, corpo)).json());
    const deOutroEscopo = [
      await como(app, sNavOperador, { method: 'GET', url: `/api/v1/paletes/${criado.id}` }),
      await mutar(app, sNavSupervisor, 'PATCH', `/api/v1/paletes/${criado.id}`, { expectedVersion: 1, notes: 'x' }),
      await mutar(app, sNavSupervisor, 'POST', `/api/v1/paletes/${criado.id}/arquivar`, { expectedVersion: 1, reason: 'Teste' }),
    ];
    expect(deOutroEscopo.map((r) => r.statusCode)).toEqual([404, 404, 404]);
    expect((await mutar(app, sOperador, 'POST', `/api/v1/paletes/${criado.id}/arquivar`, { expectedVersion: 1, reason: 'Teste' })).statusCode).toBe(403);
    expect((await como(app, sNavOperador, { method: 'GET', url: `/api/v1/paletes/${criado.id}/escopo` })).statusCode).toBe(404);
    expect((await como(app, sConsulta, { method: 'GET', url: `/api/v1/paletes/${criado.id}/escopo` })).json()).toEqual({
      scopeId: ID_ESCOPO_PRACA,
      scopeName: 'Praça informada · demonstração',
    });
    expect(await db.palete.findUniqueOrThrow({ where: { id: criado.id } })).toMatchObject({ versao: 1, arquivadoEm: null });
  });

  it('edição de observações: versão, idempotência e conflito', async () => {
    const criado = PaleteDetalheSchema.parse((await novoPalete(sOperador, { code: { mode: 'GERAR' }, positionId: null })).json());
    const chaveIdem = 'edicao-observacao-1';
    const primeira = await mutar(app, sOperador, 'PATCH', `/api/v1/paletes/${criado.id}`, { expectedVersion: 1, notes: 'Filme rasgado' }, chaveIdem);
    const repetida = await mutar(app, sOperador, 'PATCH', `/api/v1/paletes/${criado.id}`, { expectedVersion: 1, notes: 'Filme rasgado' }, chaveIdem);
    expect(PaleteDetalheSchema.parse(primeira.json())).toMatchObject({ notes: 'Filme rasgado', version: 2 });
    expect(repetida.headers['idempotency-replayed']).toBe('true');
    expect((await db.palete.findUniqueOrThrow({ where: { id: criado.id } })).versao).toBe(2);
    const atrasada = await mutar(app, sSupervisor, 'PATCH', `/api/v1/paletes/${criado.id}`, { expectedVersion: 1, notes: 'Outra nota' });
    expect([atrasada.statusCode, codigoErro(atrasada)]).toEqual([409, 'CONFLITO_VERSAO']);
    expect((await db.palete.findUniqueOrThrow({ where: { id: criado.id } })).observacoes).toBe('Filme rasgado');
  });

  it('arquivar cadastro por engano libera a posição, sai do mapa e mantém o detalhe pelo ID', async () => {
    const posicao = await idPosicao(db, ID_ESCOPO_PRACA, 'F04-P02');
    const criado = PaleteDetalheSchema.parse((await novoPalete(sOperador, { code: { mode: 'GERAR' }, positionId: posicao })).json());
    const arquivado = await mutar(app, sSupervisor, 'POST', `/api/v1/paletes/${criado.id}/arquivar`, { expectedVersion: 1, reason: 'Registrado no escopo errado' });
    expect(PaleteDetalheSchema.parse(arquivado.json())).toMatchObject({
      positionId: null,
      flowState: 'VAZIO_ARQUIVADO',
      archived: { reason: 'Registrado no escopo errado', by: { login: 'supervisor' } },
    });
    expect((await praca(sConsulta)).pallets.some((p) => p.id === criado.id)).toBe(false);
    expect((await como(app, sConsulta, { method: 'GET', url: `/api/v1/paletes/${criado.id}` })).statusCode).toBe(200);
    expect((await mutar(app, sOperador, 'PATCH', `/api/v1/paletes/${criado.id}`, { expectedVersion: 2, notes: 'x' })).statusCode).toBe(409);
    expect((await novoPalete(sOperador, { code: { mode: 'GERAR' }, positionId: posicao })).statusCode).toBe(201);
    // Palete com conferência registrada não é arquivado por esta ação.
    const conferido = await mutar(app, sSupervisor, 'POST', '/api/v1/paletes/00000000-0000-4000-8000-000000000005/arquivar', { expectedVersion: 1, reason: 'Teste' });
    expect(conferido.statusCode).toBe(409);
  });

  it('linhas declaradas usam produto do cadastro e unidade conhecida; nada vira saldo', async () => {
    expect((await mutar(app, sSupervisor, 'POST', '/api/v1/produtos', produtoValido('000777'))).statusCode).toBe(201);
    const linha = (extra: object) => ({ sku: '000777', description: null, lot: '0042', originType: 'NOTA_FISCAL', originReference: '000456', quantity: '2', unit: 'CX', ...extra });
    const tentar = (linhas: object[]) => novoPalete(sOperador, { code: { mode: 'GERAR' }, positionId: null, declaredItems: linhas });

    expect((await tentar([linha({ unit: 'KG' })])).statusCode).toBe(400);
    expect((await tentar([linha({ sku: '999' })])).statusCode).toBe(400);
    expect((await tentar([linha({ unit: 'UN', quantity: '1.5' })])).statusCode).toBe(400);
    expect((await tentar([linha({ originType: null })])).statusCode).toBe(400);
    expect((await tentar([linha({ sku: null, description: null })])).statusCode).toBe(400);
    expect(await db.palete.count({ where: { escopoId: ID_ESCOPO_PRACA } })).toBe(6);

    const ok = PaleteDetalheSchema.parse((await tentar([linha({}), linhaPendente])).json());
    expect(ok.declaredItems).toMatchObject([
      { sku: '000777', description: 'Shampoo fictício 300 ml', lot: '0042', originType: 'NOTA_FISCAL', originReference: '000456', quantity: '2', unit: 'CX' },
      { sku: null, productId: null, description: 'Caixa sem etiqueta' },
    ]);
    expect(ok.declaredItems?.[0]?.productId).not.toBeNull();
    expect(ok.currentItems).toBeNull();
    expect(ok.countState).toBe('NAO_CONFERIDO');
  });

  it('gatilhos e índices do banco barram vínculos inválidos mesmo fora da API', async () => {
    const ocupada = await idPosicao(db, ID_ESCOPO_PRACA, 'F01-P01');
    await expect(db.$executeRaw`UPDATE posicao SET disponivel = false WHERE id = ${ocupada}::uuid`).rejects.toThrow(/POSICAO_OCUPADA/);
    await expect(db.$executeRaw`UPDATE posicao SET retirada_em = now(), motivo_retirada = 'x' WHERE id = ${ocupada}::uuid`).rejects.toThrow(/POSICAO_OCUPADA/);

    const livre = await idPosicao(db, ID_ESCOPO_PRACA, 'F02-P10');
    await db.$executeRaw`UPDATE posicao SET disponivel = false WHERE id = ${livre}::uuid`;
    await expect(
      db.$executeRaw`UPDATE palete SET posicao_id = ${livre}::uuid WHERE id = '00000000-0000-4000-8000-000000000002'::uuid`,
    ).rejects.toThrow(/POSICAO_INVALIDA/);
    // Segundo palete na mesma posição: índice único.
    await expect(
      db.$executeRaw`UPDATE palete SET posicao_id = ${ocupada}::uuid WHERE id = '00000000-0000-4000-8000-000000000002'::uuid`,
    ).rejects.toThrow(/unique|duplicate|P2002|23505/i);
    // Código fora do formato ou chave incoerente.
    await expect(db.$executeRaw`UPDATE palete SET codigo = 'pal minúsculo' WHERE id = '00000000-0000-4000-8000-000000000002'::uuid`).rejects.toThrow();
  });
});
