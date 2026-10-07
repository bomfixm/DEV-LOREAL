import { CorrespondenciaEnderecosSchema, DocumentosPaleteSchema, ResultadoLayoutSchema, type DocumentosPalete, type Escopo } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { executarCarga, lerPacote, type PacoteLido } from '../../src/modules/importacao/carga-lote.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, codigoErro, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste, type UsuarioTeste } from './apoio.js';
import { bytesDoPacote, montarPacote, type LinhaTeste } from './pacote-carga.js';

/**
 * Carga do inventário em lote (pacote schema v1) contra PostgreSQL real, num
 * escopo operacional (não-demo) criado no teste: validação do pacote, gravação
 * integral, reenvio sem duplicar, cidade/produto preservados, NF em dois
 * endereços, palete misto, volumes pendentes, N° Pallet repetido, posição
 * ocupada em conflito e recusa do escopo de demonstração. Dados fictícios.
 */
const API = '/api/v1';
let db: Banco;
let app: FastifyInstance;
let escopo: Escopo;
let supervisor: UsuarioTeste;
let sup: SessaoTeste;

const A = { tipo: 'NFD', numero: '0001001', delivery: 'D-001', remetente: 'Remetente Fictício A' } as const;

/** Linhas do inventário fictício (linha 1 = título; 2 = cabeçalho). */
const LINHAS: LinhaTeste[] = [
  { linha: 3, ...A, endereco: '13 - A101', volumes: '3', marcador: '01\\02', numeroPlanilha: '501' },
  { linha: 4, tipo: 'NFD', numero: '0001002', delivery: 'D-002', remetente: 'Remetente B', endereco: '13 - A101', volumes: '2', numeroPlanilha: '501' },
  { linha: 5, ...A, endereco: '15 - A120', volumes: '1', marcador: '02\\02', numeroPlanilha: '502' },
  { linha: 6, tipo: 'NFD', numero: '0001003', remetente: 'Remetente C', endereco: '15 - A122', volumes: '4', numeroPlanilha: '171' },
  { linha: 7, tipo: 'NFD', numero: '0001003', remetente: 'Remetente C', endereco: '15 - A122', volumes: '4', numeroPlanilha: '171' },
  { linha: 8, tipo: 'NFD', numero: '0001004', remetente: 'Remetente D', endereco: '13  - A 120', volumes: '', numeroPlanilha: '171' },
  { linha: 9, numero: '0001005', remetente: 'Remetente E', endereco: '15 - A124', volumes: '1', numeroPlanilha: '503' },
  { linha: 10, tipo: 'MI', numero: '0001006', remetente: 'Remetente F', endereco: '15 - A124', volumes: '2', numeroPlanilha: '503' },
  { linha: 11, ...A, endereco: '15 - A126', livre: true, volumes: '2', marcador: '01\\02' },
  { linha: 12, remetente: 'Remetente G', endereco: '15 - A128', volumes: '5', numeroPlanilha: '504' },
  { linha: 13, endereco: '15 - A132', livre: true },
  { linha: 14, tipo: 'NFD', numero: '0001001', delivery: 'D-999', remetente: 'Remetente Outro', endereco: '15 - A134', volumes: '1', numeroPlanilha: '505' },
];

function lido(linhas: readonly LinhaTeste[] = LINHAS, opcoes: Parameters<typeof montarPacote>[1] = {}): PacoteLido {
  const r = lerPacote(bytesDoPacote(montarPacote(linhas, opcoes)), 'dados-importacao.json');
  if (!r.ok) throw new Error(`Pacote fictício recusado: ${r.erros.join(' | ')}`);
  return r.pacote;
}

const autor = () => ({ usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` });
const carregar = (p: PacoteLido, substitui: string | null = null, alvo: Escopo = escopo) => executarCarga(db, alvo, autor(), p, { substitui, descricao: null }, new Date('2026-10-06T12:00:00Z'));

async function paleteDoEndereco(endereco: string): Promise<{ id: string; codigo: string; posicaoId: string | null }> {
  const linha = await db.linhaInventario.findFirstOrThrow({ where: { escopoId: escopo.id, enderecoCanonico: endereco, aplicada: true }, select: { palete: { select: { id: true, codigo: true, posicaoId: true } } } });
  if (!linha.palete) throw new Error(`sem palete em ${endereco}`);
  return linha.palete;
}

async function notas(paleteId: string): Promise<DocumentosPalete> {
  const r = await como(app, sup, { method: 'GET', url: `${API}/paletes/${paleteId}/documentos` });
  expect(r.statusCode, r.body).toBe(200);
  return DocumentosPaleteSchema.parse(r.json());
}

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const unidade = await db.unidade.create({ data: { id: randomUUID(), codigo: 'UN-TESTE-CARGA', nome: 'Unidade operacional de teste', demonstracao: false } });
  const cliente = await db.cliente.create({ data: { id: randomUUID(), codigo: 'CLI-TESTE-CARGA', nome: 'Cliente de teste', demonstracao: false } });
  const e = await db.escopo.create({ data: { id: randomUUID(), unidadeId: unidade.id, clienteId: cliente.id, nome: 'Praça de teste · Cliente de teste', demonstracao: false } });
  escopo = { id: e.id, name: e.nome, unitCode: unidade.codigo, unitName: unidade.nome, clientCode: cliente.codigo, clientName: cliente.nome, demo: false };
  supervisor = await criarUsuario(db, 'supervisor.carga', [[e.id, 'SUPERVISOR_ESTOQUE']]);
  sup = await entrar(app, supervisor);
  // Desenho aprovado e a sequência confirmada da Fileira 13 (F04: A101–A133, ímpares).
  const desenho = await mutar(app, sup, 'POST', `${API}/layout/desenho-aprovado`, {});
  expect(desenho.statusCode, desenho.body).toBe(201);
  const c = CorrespondenciaEnderecosSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/layout/enderecos` })).json());
  const f04 = await db.fileira.findFirstOrThrow({ where: { escopoId: e.id, codigo: 'F04', layout: { ativo: true } }, select: { id: true } });
  const proposta = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${f04.id}/sequencia`, { expectedRevision: c.revision, segments: 'A101-A133/2', direction: 'P01_PRIMEIRO', source: 'Levantamento fictício' });
  expect(proposta.statusCode, proposta.body).toBe(200);
  const confirmar = await mutar(app, sup, 'POST', `${API}/layout/fileiras/${f04.id}/enderecos/confirmar`, { expectedRevision: ResultadoLayoutSchema.parse(proposta.json()).revision, expectedProposed: 17 });
  expect(confirmar.statusCode, confirmar.body).toBe(200);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('Leitura do pacote', () => {
  it('pacote coerente é aceito; schema diferente, resumo divergente e volumes somados de linhas agrupadas são recusados', () => {
    expect(lido().pacote.nfds_na_praca).toHaveLength(6);
    const base = montarPacote(LINHAS);
    const recusa = (p: unknown) => {
      const r = lerPacote(Buffer.from(JSON.stringify(p)), 'x.json');
      expect(r.ok).toBe(false);
      return r.ok ? [] : r.erros;
    };
    expect(recusa({ ...base, schema: 'outro.v2' }).join(' ')).toMatch(/não suportado/);
    expect(recusa({ ...base, resumo: { ...base.resumo, vinculos_nfd_na_praca: 7 } }).join(' ')).toMatch(/vínculos NFD na praça informado 7, contado 6/);
    const somado = { ...base, nfds_na_praca: base.nfds_na_praca.map((v) => (v.linhas_origem.length > 1 ? { ...v, volumes: '8' } : v)), resumo: { ...base.resumo, nfd_com_volumes_pendentes_na_praca: 1 } };
    expect(recusa(somado).join(' ')).toMatch(/volumes somados/);
    expect(recusa({ ...base, posicoes: base.posicoes.map((x) => ({ ...x, numero_eh_id_permanente_palete: true })) }).length).toBeGreaterThan(0);
    const r = lerPacote(Buffer.from('{não é json'), 'x.json');
    expect(r.ok).toBe(false);
  });
});

describe('Gravação da carga', () => {
  it('grava o conjunto: paletes com código gerado, vínculos, referências fora da praça e posição só pela tabela confirmada; nenhum saldo por SKU', async () => {
    const r = await carregar(lido());
    expect(r).toMatchObject({
      reenvio: false,
      inventarioCodigo: 'INV-000001',
      linhas: { total: 12, aplicadas: 9, historicas: 2, repetidas: 1, jaImportadas: 0, pendentes: 0 },
      vinculos: { criados: 8, atualizados: 0, jaExistentes: 0, emConflito: 0, tipoPendente: 2 },
      paletes: { criados: 7, existentes: 0, emConflito: 0, localizacoesRegistradas: 1, posicaoNoMapaPendente: 6 },
      referenciasForaDaPraca: 1,
      volumesPendentes: 2,
    });
    const paletes = await db.palete.findMany({ where: { escopoId: escopo.id }, select: { codigo: true, posicao: { select: { codigo: true } } } });
    expect(paletes).toHaveLength(7);
    // N° Pallet da planilha nunca vira o código/ID.
    expect(paletes.every((p) => /^PR-\d{6}$/.test(p.codigo))).toBe(true);
    expect(paletes.flatMap((p) => (p.posicao ? [p.posicao.codigo] : []))).toEqual(['F04-P01']);
    expect(await db.vinculoDocumentoPalete.count({ where: { escopoId: escopo.id, situacao: 'ATIVO' } })).toBe(8);
    // Endereços livres (15 - A126 e 15 - A132) não criam palete; endereço com espaços extras é normalizado.
    expect(await db.linhaInventario.count({ where: { escopoId: escopo.id, enderecoLivre: true, paleteId: null } })).toBe(2);
    expect((await paleteDoEndereco('13 - A120')).posicaoId).toBeNull();
    expect(await db.saldoEstoque.count({ where: { escopoId: escopo.id } })).toBe(0);
    const lote = await db.loteImportacao.findFirstOrThrow({ where: { escopoId: escopo.id, tipo: 'INVENTARIO' }, select: { situacao: true, formato: true } });
    expect(lote).toEqual({ situacao: 'CONFIRMADO', formato: 'JSON' });
    expect(await db.eventoAuditoria.count({ where: { escopoId: escopo.id, acao: 'INVENTARIO_IMPORTADO' } })).toBe(1);
  });

  it('notas do palete: misto com NF em dois endereços (atual e fora da praça), candidato de outro contexto, full, volumes pendentes, tipo pendente e conteúdo sem número', async () => {
    await carregar(lido());
    const a101 = await paleteDoEndereco('13 - A101');
    const misto = await notas(a101.id);
    expect(misto.palletFull).toMatchObject({ value: 'MISTO', imported: 'MISTO' });
    expect(misto.informedAddress).toBeNull(); // tem posição no mapa
    const nfA = misto.items.find((i) => i.documentNumber === '0001001');
    expect(nfA).toMatchObject({ isNfd: true, sender: 'Remetente Fictício A', volumes: '3', destinationCity: { value: '' }, productInBox: { value: '' } });
    expect(nfA?.multiplePallets).toMatchObject({ indicated: true, declaredPallets: 2, partsHere: [1] });
    expect(nfA?.multiplePallets.others.map((o) => [o.kind, o.address, o.mapPending])).toEqual([
      ['ATUAL', '15 - A120', true],
      ['FORA_DA_PRACA', '15 - A126', false],
    ]);
    expect(nfA?.multiplePallets.sameNumberElsewhere.map((c) => [c.delivery, c.address])).toEqual([['D-999', '15 - A134']]);

    const full = await notas((await paleteDoEndereco('15 - A120')).id);
    expect(full.palletFull.value).toBe('FULL');
    expect(full.informedAddress).toMatchObject({ address: '15 - A120', mapPending: true, inventoryCode: 'INV-000001' });

    const repetida = await notas((await paleteDoEndereco('15 - A122')).id);
    expect(repetida.items).toHaveLength(1);
    expect(repetida.items[0]).toMatchObject({ volumes: null, volumesByRow: [{ row: 6, value: '4' }, { row: 7, value: '4' }] });
    expect(repetida.items[0]?.pending.join(' ')).toMatch(/linhas? iguais na origem: confirmar \(não foram somados\)/);
    expect((await notas((await paleteDoEndereco('13 - A120')).id)).items[0]?.pending.join(' ')).toMatch(/Volumes pendentes: quantidade desconhecida/);
    // N° Pallet 171 em dois endereços: referência externa, cada endereço com o próprio palete.
    expect(repetida.externalReferences).toEqual([{ value: '171', inventoryCode: 'INV-000001', otherAddresses: ['13 - A120'] }]);
    expect((await paleteDoEndereco('13 - A120')).id).not.toBe((await paleteDoEndereco('15 - A122')).id);

    const pendente = await notas((await paleteDoEndereco('15 - A124')).id);
    expect(pendente.palletFull.value).toBe('MISTO');
    expect(pendente.items.map((i) => [i.documentType, i.isNfd])).toEqual([
      ['MI', false],
      [null, false],
    ]);

    const semNumero = await notas((await paleteDoEndereco('15 - A128')).id);
    expect(semNumero.items).toHaveLength(0);
    expect(semNumero.palletFull).toMatchObject({ value: 'NAO_INFORMADO', reason: expect.stringMatching(/conteúdo sem número/) as unknown });
    expect(semNumero.contentWithoutDocument).toEqual([{ row: 12, sender: 'Remetente G', volumes: '5', inventoryCode: 'INV-000001' }]);
  });

  it('reenvio do mesmo pacote não grava de novo e preserva os IDs', async () => {
    const p = lido();
    await carregar(p);
    const antes = await db.palete.findMany({ where: { escopoId: escopo.id }, select: { id: true }, orderBy: { id: 'asc' } });
    const r = await carregar(p);
    expect(r).toMatchObject({ reenvio: true, inventarioCodigo: 'INV-000001', vinculos: { criados: 0, jaExistentes: 8 }, paletes: { criados: 0, existentes: 7 } });
    expect(await db.palete.findMany({ where: { escopoId: escopo.id }, select: { id: true }, orderBy: { id: 'asc' } })).toEqual(antes);
    expect(await db.vinculoDocumentoPalete.count({ where: { escopoId: escopo.id } })).toBe(8);
    expect(await db.loteImportacao.count({ where: { escopoId: escopo.id } })).toBe(1);
  });

  it('cidade destino e produto na caixa preenchidos no aplicativo sobrevivem a nova versão do pacote (vazia ou com outro valor)', async () => {
    await carregar(lido());
    const a101 = await paleteDoEndereco('13 - A101');
    const nfA = (await notas(a101.id)).items.find((i) => i.documentNumber === '0001001');
    if (!nfA?.identity) throw new Error('sem identidade');
    const cidade = await mutar(app, sup, 'PUT', `${API}/paletes/${a101.id}/documentos/cidade-destino`, { identity: nfA.identity, expectedVersion: 0, value: '  Cidade   Manual ' });
    expect(cidade.statusCode, cidade.body).toBe(200);
    const produto = await mutar(app, sup, 'PUT', `${API}/paletes/${a101.id}/documentos/produto`, { identity: nfA.identity, expectedVersion: 0, value: 'Shampoo fictício' });
    expect(produto.statusCode, produto.body).toBe(200);
    const caixa = await mutar(app, sup, 'POST', `${API}/paletes/${a101.id}/documentos/caixas`, { identity: nfA.identity, group: 'Caixa 2', description: 'Condicionador fictício' });
    expect(caixa.statusCode, caixa.body).toBe(201);
    // Versão vista desatualizada: conflito.
    const velha = await mutar(app, sup, 'PUT', `${API}/paletes/${a101.id}/documentos/cidade-destino`, { identity: nfA.identity, expectedVersion: 0, value: 'Outra' });
    expect(velha.statusCode).toBe(409);
    expect(codigoErro(velha)).toBe('CONFLITO_VERSAO');
    // A cidade vale para a mesma NF no outro palete.
    const outro = await notas((await paleteDoEndereco('15 - A120')).id);
    expect(outro.items[0]?.destinationCity.value).toBe('Cidade Manual');
    expect(outro.items[0]?.productInBox.value).toBe('');

    // Nova versão: volumes da linha 4 corrigidos e cidade no pacote — substitui a INV-000001.
    const novas = LINHAS.map((l) => (l.linha === 4 ? { ...l, volumes: '5' } : l));
    const r = await carregar(lido(novas, { variante: 'v2', cidades: { '0001001': 'Cidade do Pacote', '0001003': 'Cidade Nova' } }), 'INV-000001');
    expect(r).toMatchObject({ reenvio: false, inventarioCodigo: 'INV-000002', vinculos: { criados: 0, atualizados: 1, jaExistentes: 7 }, paletes: { criados: 0, existentes: 7 }, camposPreenchidos: { cidades: 2 } });
    const depois = await notas(a101.id);
    const nfA2 = depois.items.find((i) => i.documentNumber === '0001001' && i.state === 'ATIVO');
    expect(nfA2?.destinationCity.value).toBe('Cidade Manual');
    expect(nfA2?.productInBox).toMatchObject({ value: 'Shampoo fictício', boxes: [{ group: 'Caixa 2', description: 'Condicionador fictício' }] });
    expect(depois.items.filter((i) => i.documentNumber === '0001002').map((i) => [i.state, i.volumes])).toEqual(
      expect.arrayContaining([
        ['ATIVO', '5'],
        ['ENCERRADO', '2'],
      ]),
    );
    expect((await notas((await paleteDoEndereco('15 - A122')).id)).items[0]?.destinationCity.value).toBe('Cidade Nova');
    // A outra identidade do número 0001001 (DELIVERY D-999) estava vazia: recebe a cidade do pacote.
    expect((await notas((await paleteDoEndereco('15 - A134')).id)).items[0]?.destinationCity.value).toBe('Cidade do Pacote');
  });

  it('posição ocupada hoje por outro palete: o endereço fica em conflito (não aplicado) e o resto é gravado', async () => {
    const f04p01 = await db.posicao.findFirstOrThrow({ where: { escopoId: escopo.id, codigo: 'F04-P01', layout: { ativo: true } }, select: { id: true } });
    const ocupante = await mutar(app, sup, 'POST', `${API}/paletes`, { code: { mode: 'GERAR' }, positionId: f04p01.id, notes: null, declaredItems: [] });
    expect(ocupante.statusCode, ocupante.body).toBe(201);
    const r = await carregar(lido());
    expect(r).toMatchObject({ linhas: { pendentes: 2, aplicadas: 7 }, vinculos: { criados: 6, emConflito: 2 }, paletes: { criados: 6, emConflito: 1, localizacoesRegistradas: 0 } });
    expect(r.pendencias.join(' ')).toMatch(/Conflitos com registros atuais/);
    const naoAplicadas = await db.linhaInventario.findMany({ where: { escopoId: escopo.id, acao: 'REQUER_RESOLUCAO' }, select: { linhaArquivo: true, aplicada: true, paleteId: true } });
    expect(naoAplicadas).toEqual(expect.arrayContaining([{ linhaArquivo: 3, aplicada: false, paleteId: null }, { linhaArquivo: 4, aplicada: false, paleteId: null }]));
    // O palete atual continua na posição, sem vínculos novos.
    const atual = await db.palete.findFirstOrThrow({ where: { posicaoId: f04p01.id }, select: { id: true, _count: { select: { documentos: true } } } });
    expect(atual._count.documentos).toBe(0);
  });

  it('escopo de demonstração é recusado sem gravar nada', async () => {
    const demo = await db.escopo.findUniqueOrThrow({ where: { id: ID_ESCOPO_PRACA }, include: { unidade: true, cliente: true } });
    const alvo: Escopo = { id: demo.id, name: demo.nome, unitCode: demo.unidade.codigo, unitName: demo.unidade.nome, clientCode: demo.cliente.codigo, clientName: demo.cliente.nome, demo: true };
    await expect(carregar(lido(), null, alvo)).rejects.toThrow(/demonstração/);
    expect(await db.inventarioReferencia.count({ where: { escopoId: ID_ESCOPO_PRACA, loteImportacao: { formato: 'JSON' } } })).toBe(0);
  });
});
