import { ConteudosPaleteSchema, CorrespondenciaEnderecosSchema, DocumentosPaleteSchema, RespostaBuscaSchema, ResultadoLayoutSchema, type DocumentosPalete, type Escopo } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { carregarEstadoCarga, executarCarga, lerPacote, planejarCarga, type PacoteLido } from '../../src/modules/importacao/carga-lote.js';
import { ID_ESCOPO_PRACA, appDeTeste, bancoDeTeste, codigoErro, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste, type UsuarioTeste } from './apoio.js';
import { bytesDoPacote, montarPacote, type LinhaTeste } from './pacote-carga.js';

/**
 * Carga do inventário em lote (pacote schema v1) contra PostgreSQL real, num
 * escopo operacional (não-demo) criado no teste: validação do pacote, gravação
 * integral, reenvio sem duplicar, cidade/produto preservados, NF em dois
 * endereços, palete misto, volumes pendentes, N° Pallet repetido, posição
 * ocupada em conflito e recusa do escopo de demonstração; linhas sem RUA
 * (pendentes, sem palete), endereço só proposto, diferenças da substituição
 * e preservação de conteúdo registrado e de movimento posterior. Dados fictícios.
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
  { linha: 3, ...A, endereco: '13 - A101', volumes: '3', marcador: '01\\02', numeroPlanilha: '501', mesAgenda: 'OUT/2026', janela: 'J1' },
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

/** Linhas sem RUA (como as três do pacote real, com dados fictícios): uma sem tipo com N° Pallet, uma NFD com Delivery. */
const SEM_RUA: LinhaTeste[] = [
  { linha: 15, numero: '0002001', endereco: '', volumes: '38', numeroPlanilha: '181' },
  { linha: 16, tipo: 'NFD', numero: '0002002', delivery: 'D-777', remetente: 'Remetente H', endereco: '', volumes: '9' },
];

/** Erros de um pacote recusado (texto único). */
function recusar(p: unknown): string {
  const r = lerPacote(Buffer.from(JSON.stringify(p)), 'x.json');
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.erros.join(' | ');
}

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

  it('linhas sem RUA: extensão opcional (pacote antigo continua aceito); sem a extensão, linha marcada livre ou alterada, o pacote é recusado', () => {
    const comSemRua = montarPacote([...LINHAS, ...SEM_RUA]);
    const aceito = lerPacote(bytesDoPacote(comSemRua), 'x.json');
    expect(aceito.ok && aceito.pacote.pacote.linhas_sem_endereco.map((l) => l.linha)).toEqual([15, 16]);
    // Pacote anterior (sem o campo): assume lista vazia.
    const { linhas_sem_endereco: _vazio, ...antigo } = montarPacote(LINHAS);
    const r = lerPacote(Buffer.from(JSON.stringify(antigo)), 'x.json');
    expect(r.ok && r.pacote.pacote.linhas_sem_endereco).toEqual([]);
    // Linhas sem RUA sem a extensão ficam descobertas.
    const { linhas_sem_endereco: _ignorado, ...semExtensao } = comSemRua;
    expect(recusar(semExtensao)).toMatch(/Linha 15 não está em nenhum vínculo/);
    const marcar = (alterar: (l: (typeof comSemRua.linhas_sem_endereco)[number]) => object) => ({ ...comSemRua, linhas_sem_endereco: comSemRua.linhas_sem_endereco.map((l, i) => (i === 0 ? alterar(l) : l)) });
    expect(recusar(marcar((l) => ({ ...l, endereco_livre: true })))).toMatch(/não pode ser marcada como livre/);
    expect(recusar(marcar((l) => ({ ...l, volumes: '99' })))).toMatch(/não corresponde à linha de origem/);
  });

  it('número do documento acima de 200 caracteres é recusado na leitura (nada é truncado)', () => {
    const base = montarPacote(LINHAS);
    const longo = { ...base, nfds_na_praca: base.nfds_na_praca.map((v, i) => (i === 0 ? { ...v, numero_documento: '1'.repeat(201) } : v)) };
    expect(recusar(longo)).toMatch(/acima de 200 caracteres/);
  });
});

describe('Gravação da carga', () => {
  it('grava o conjunto: paletes pelo N° Pallet único (sem ele, código gerado), vínculos, referências fora da praça e posição só pela tabela confirmada; nenhum saldo por SKU', async () => {
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
    // N° Pallet único do endereço = número operacional (código); o 171 aparece em dois endereços: código gerado. O ID técnico é outro.
    expect(paletes.map((p) => p.codigo).filter((c) => !/^PR-\d{6}$/.test(c)).sort()).toEqual(['501', '502', '503', '504', '505']);
    expect(paletes.filter((p) => /^PR-\d{6}$/.test(p.codigo))).toHaveLength(2);
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
    // Delivery, sequência FULL (marcador), mês de agenda e janela da linha de origem; ausentes = null (não informado).
    expect(nfA).toMatchObject({ delivery: 'D-001', palletFull: '01\\02', scheduleMonth: 'OUT/2026', windowRef: 'J1' });
    expect(misto.items.find((i) => i.documentNumber === '0001002')).toMatchObject({ scheduleMonth: null, windowRef: null });

    // Pesquisa única também por remetente (igual ou início) e por DELIVERY: localiza o vínculo e o palete, sem abrir nada.
    const buscar = async (texto: string) => {
      const r = await como(app, sup, { method: 'GET', url: `${API}/busca?texto=${encodeURIComponent(texto)}` });
      expect(r.statusCode, r.body).toBe(200);
      return r.json<{ items: { base: string; match: string; pallet: { id: string } | null }[] }>().items.filter((i) => i.base === 'INVENTARIO');
    };
    const porRemetente = await buscar('remetente b');
    expect(porRemetente.map((i) => [i.match, i.pallet?.id])).toEqual([['DOCUMENTO', a101.id]]);
    expect((await buscar('Remetente Fic')).every((i) => i.match === 'DOCUMENTO_PREFIXO')).toBe(true);
    expect((await buscar('Remetente Fic')).length).toBeGreaterThan(0);
    expect((await buscar('D-002')).map((i) => i.pallet?.id)).toEqual([a101.id]);

    // Conteúdo do palete (cadastro de conteúdo): vínculos importados entram na mesma lista; volumes importados = contagem realizada.
    const conteudos = async (paleteId: string) => {
      const r = await como(app, sup, { method: 'GET', url: `${API}/paletes/${paleteId}/conteudos` });
      expect(r.statusCode, r.body).toBe(200);
      return ConteudosPaleteSchema.parse(r.json());
    };
    const doMisto = await conteudos(a101.id);
    expect(doMisto.items.map((i) => [i.kind, i.documentNumber, i.count.state, i.count.counted, i.count.origin])).toEqual([
      ['IMPORTADO', '0001001', 'REALIZADA', '3', 'IMPORTACAO'],
      ['IMPORTADO', '0001002', 'REALIZADA', '2', 'IMPORTACAO'],
    ]);
    expect(doMisto.documents).toBe(2);
    // Volume vazio no inventário = aguardando conferência (nunca zero); a contagem já feita pode ser registrada sem recontar.
    const paleteSemVolume = await paleteDoEndereco('13 - A120');
    const [semVolume] = (await conteudos(paleteSemVolume.id)).items;
    expect(semVolume).toMatchObject({ kind: 'IMPORTADO', documentNumber: '0001004', count: { state: 'AGUARDANDO', counted: null } });
    const c = await mutar(app, sup, 'POST', `${API}/paletes/${paleteSemVolume.id}/conteudos/contagens`, { target: { kind: 'IMPORTADO', id: semVolume?.id }, counted: 4, origin: 'CONTAGEM_INFORMADA' });
    expect(c.statusCode, c.body).toBe(201);
    expect((await conteudos(paleteSemVolume.id)).items[0]?.count).toMatchObject({ state: 'REALIZADA', counted: '4', expected: null, origin: 'CONTAGEM_INFORMADA' });
    // O vínculo importado não é alterado pela contagem (fica o que foi importado; a contagem vigente vale na tela e na planilha).
    expect((await db.vinculoDocumentoPalete.findUniqueOrThrow({ where: { id: semVolume?.id ?? '' }, select: { volumes: true } })).volumes).toBeNull();
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

  it('linhas sem RUA: guardadas no inventário sem palete nem posição, pendentes, consultáveis e localizadas pela busca; reenvio não duplica', async () => {
    const p = lido([...LINHAS, ...SEM_RUA]);
    const r = await carregar(p);
    expect(r).toMatchObject({ linhas: { total: 14, aplicadas: 9, pendentes: 2, semEndereco: 2 }, paletes: { criados: 7 }, vinculos: { criados: 8 } });
    expect(r.pendencias.join(' ')).toMatch(/Linhas sem endereço \(preservadas, sem alocação\): linha 15: 0002001, linha 16: 0002002/);
    const linhas = await db.linhaInventario.findMany({
      where: { escopoId: escopo.id, linhaArquivo: { in: [15, 16] } },
      select: { linhaArquivo: true, acao: true, aplicada: true, paleteId: true, posicaoId: true, enderecoCanonico: true, enderecoLido: true, numeroDocumento: true, delivery: true, volumes: true, numeroPalete: true },
      orderBy: { linhaArquivo: 'asc' },
    });
    expect(linhas.map((l) => [l.linhaArquivo, l.acao, l.aplicada, l.paleteId, l.posicaoId, l.enderecoCanonico, l.enderecoLido, l.numeroDocumento, l.delivery, l.volumes?.toFixed() ?? null, l.numeroPalete])).toEqual([
      [15, 'REQUER_RESOLUCAO', false, null, null, null, null, '0002001', null, '38', '181'],
      [16, 'REQUER_RESOLUCAO', false, null, null, null, null, '0002002', 'D-777', '9', null],
    ]);
    // Consulta do inventário: filtro "Requerem resolução", sem endereço nem palete.
    const inv = await db.inventarioReferencia.findFirstOrThrow({ where: { escopoId: escopo.id }, select: { id: true } });
    const consulta = await como(app, sup, { method: 'GET', url: `${API}/inventarios/${inv.id}/linhas?situacao=PENDENTES` });
    expect(consulta.statusCode, consulta.body).toBe(200);
    const pendentes = consulta.json<{ items: { row: number; address: string | null; addressRead: string | null; pallet: unknown; reasons: { code: string }[] }[] }>().items;
    expect(pendentes.map((l) => [l.row, l.address, l.addressRead, l.pallet, l.reasons[0]?.code])).toEqual([
      [15, null, null, null, 'ENDERECO_NAO_INFORMADO'],
      [16, null, null, null, 'ENDERECO_NAO_INFORMADO'],
    ]);
    // Busca: a origem é localizada, sem palete nem posição presumidos.
    const buscar = async (texto: string) => {
      const b = await como(app, sup, { method: 'GET', url: `${API}/busca?texto=${encodeURIComponent(texto)}` });
      expect(b.statusCode, b.body).toBe(200);
      return RespostaBuscaSchema.parse(b.json()).items;
    };
    const porDelivery = (await buscar('D-777')).filter((i) => i.base === 'ORIGEM_INVENTARIO');
    expect(porDelivery.map((i) => [i.match, i.pallet, i.inventoryOrigin?.documentNumber, i.inventoryOrigin?.informedAddress, i.inventoryOrigin?.row, i.inventoryOrigin?.volumes])).toEqual([['DOCUMENTO', null, '0002002', null, 16, '9']]);
    expect((await buscar('0002001')).map((i) => [i.base, i.match, i.inventoryOrigin?.palletNumber])).toEqual([['ORIGEM_INVENTARIO', 'NF', '181']]);
    // Reenvio: nada duplicado.
    const re = await carregar(p);
    expect(re).toMatchObject({ reenvio: true, linhas: { total: 14, pendentes: 2, semEndereco: 2 } });
    expect(await db.linhaInventario.count({ where: { escopoId: escopo.id } })).toBe(14);
    expect(await db.palete.count({ where: { escopoId: escopo.id } })).toBe(7);
  });

  it('número composto da origem (lista por vírgulas com mais de 64 caracteres) é conservado por inteiro, sem dividir volumes', async () => {
    const lista = '9001, 9002345, 9003, 09004, 90005,9006, 90007, 90008,9009,9010, 9011';
    expect(lista.length).toBeGreaterThan(64);
    const r = await carregar(lido([{ linha: 3, numero: lista, remetente: 'Remetente L', endereco: '13 - A103', volumes: '15' }]));
    expect(r).toMatchObject({ vinculos: { criados: 1, tipoPendente: 1 } });
    const v = await db.vinculoDocumentoPalete.findFirstOrThrow({ where: { escopoId: escopo.id }, select: { numeroDocumento: true, tipoDocumento: true, volumes: true } });
    expect([v.numeroDocumento, v.tipoDocumento, v.volumes?.toFixed()]).toEqual([lista, null, '15']);
    // A cidade destino editada no aplicativo também guarda o número inteiro.
    const palete = await paleteDoEndereco('13 - A103');
    const [nota] = (await notas(palete.id)).items;
    if (!nota?.identity) throw new Error('sem identidade');
    expect(nota.documentNumber).toBe(lista);
    const cidade = await mutar(app, sup, 'PUT', `${API}/paletes/${palete.id}/documentos/cidade-destino`, { identity: nota.identity, expectedVersion: 0, value: 'Cidade fictícia' });
    expect(cidade.statusCode, cidade.body).toBe(200);
  });

  it('posição registrada pelo reenvio depois de confirmar a faixa não é movimentação: o prazo de reconferência não reinicia', async () => {
    const p = lido([{ linha: 3, tipo: 'NFD', numero: '0004001', remetente: 'Remetente R', endereco: '15 - A101', volumes: '2' }]);
    await carregar(p);
    const select = { id: true, posicaoId: true, relogioInicioEm: true, ultimaMovimentacaoEm: true } as const;
    const antes = await db.palete.findFirstOrThrow({ where: { escopoId: escopo.id }, select });
    expect([antes.posicaoId, antes.relogioInicioEm.toISOString(), antes.ultimaMovimentacaoEm]).toEqual([null, '2026-10-06T12:00:00.000Z', null]);
    const c = CorrespondenciaEnderecosSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/layout/enderecos` })).json());
    const faixa = c.blocks.find((b) => b.addressPrefix === '15' && !b.deactivated)?.rows.find((r) => r.side === 'ESQUERDO');
    if (!faixa) throw new Error('sem faixa esquerda da Fileira 15');
    const proposta = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${faixa.rowId}/sequencia`, { expectedRevision: c.revision, segments: `A101-A${String(101 + 2 * (faixa.positions - 1))}/2`, direction: 'P01_PRIMEIRO', source: 'Levantamento fictício' });
    expect(proposta.statusCode, proposta.body).toBe(200);
    const confirmar = await mutar(app, sup, 'POST', `${API}/layout/fileiras/${faixa.rowId}/enderecos/confirmar`, { expectedRevision: ResultadoLayoutSchema.parse(proposta.json()).revision, expectedProposed: faixa.positions });
    expect(confirmar.statusCode, confirmar.body).toBe(200);
    const r = await carregar(p);
    expect(r).toMatchObject({ reenvio: true, paletes: { localizacoesRegistradas: 1 } });
    const depois = await db.palete.findUniqueOrThrow({ where: { id: antes.id }, select });
    expect(depois.posicaoId).not.toBeNull();
    expect([depois.relogioInicioEm, depois.ultimaMovimentacaoEm]).toEqual([antes.relogioInicioEm, null]);
  });

  it('endereço só proposto (sequência não confirmada) não aloca posição', async () => {
    const c = CorrespondenciaEnderecosSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/layout/enderecos` })).json());
    const faixa = c.blocks.find((b) => b.addressPrefix === '15' && !b.deactivated)?.rows[0];
    if (!faixa) throw new Error('sem faixa da Fileira 15');
    const fim = 101 + 2 * (faixa.positions - 1);
    const proposta = await mutar(app, sup, 'PUT', `${API}/layout/fileiras/${faixa.rowId}/sequencia`, { expectedRevision: c.revision, segments: `A101-A${String(fim)}/2`, direction: 'P01_PRIMEIRO', source: 'Levantamento fictício (não confirmado)' });
    expect(proposta.statusCode, proposta.body).toBe(200);
    const r = await carregar(lido([{ linha: 3, tipo: 'NFD', numero: '0003001', remetente: 'Remetente P', endereco: '15 - A101', volumes: '1' }]));
    expect(r).toMatchObject({ paletes: { criados: 1, localizacoesRegistradas: 0, posicaoNoMapaPendente: 1 } });
    expect((await paleteDoEndereco('15 - A101')).posicaoId).toBeNull();
    const linha = await db.linhaInventario.findFirstOrThrow({ where: { escopoId: escopo.id, linhaArquivo: 3 }, select: { posicaoId: true, motivos: true } });
    expect(linha.posicaoId).toBeNull();
    expect(JSON.stringify(linha.motivos)).toMatch(/POSICAO_NO_MAPA_PENDENTE/);
  });

  it('substituição: a prévia mostra as diferenças; conteúdo registrado e movimento posterior são preservados', async () => {
    await carregar(lido());
    const a101 = await paleteDoEndereco('13 - A101');
    // Conteúdo registrado no aplicativo (manual) no palete do 15 - A128.
    const p128 = await paleteDoEndereco('15 - A128');
    const conteudo = await mutar(app, sup, 'POST', `${API}/paletes/${p128.id}/conteudos`, { sender: 'Remetente manual', documentType: null, documentNumber: '', delivery: '', description: '' });
    expect(conteudo.statusCode, conteudo.body).toBe(201);
    // Movimento posterior: o palete de 13 - A101 (F04-P01) vai para F04-P03.
    const f04p03 = await db.posicao.findFirstOrThrow({ where: { escopoId: escopo.id, codigo: 'F04-P03', layout: { ativo: true } }, select: { id: true } });
    const { versao } = await db.palete.findUniqueOrThrow({ where: { id: a101.id }, select: { versao: true } });
    const mov = await mutar(app, sup, 'POST', `${API}/paletes/${a101.id}/movimentos`, { destinationPositionId: f04p03.id, confirmedPositionCode: 'F04-P03', expectedVersion: versao, reason: 'Reorganização fictícia' });
    expect(mov.statusCode, mov.body).toBe(200);
    // Nova versão: sem 15 - A134 (linha 14), volumes da linha 4 corrigidos e mês/janela da linha 3 alterados (metadados: vínculo mantido).
    const novas = LINHAS.filter((l) => l.linha !== 14).map((l) => (l.linha === 4 ? { ...l, volumes: '5' } : l.linha === 3 ? { ...l, mesAgenda: 'NOV/2026', janela: 'J2' } : l));
    const p2 = lido(novas, { variante: 'v2' });
    const plano = planejarCarga(p2, await carregarEstadoCarga(db, escopo.id, p2, 'INV-000001'));
    expect(plano.resumo.join(' ')).toMatch(/Substitui INV-000001: 8 vínculos ativos — 6 mantidos, 1 atualizados .*1 encerrados por não constarem desta versão/);
    expect(plano.resumo.join(' ')).toMatch(/Endereços do INV-000001 fora desta versão: 1 .*15 - A134/);
    // Sem --substitui, a prévia avisa do inventário ativo anterior.
    const semSubstituir = planejarCarga(p2, await carregarEstadoCarga(db, escopo.id, p2, null));
    expect(semSubstituir.pendencias.join(' ')).toMatch(/Inventário ativo anterior neste escopo: INV-000001\. .*--substitui INV-000001/);
    const r = await carregar(p2, 'INV-000001');
    expect(r).toMatchObject({ inventarioCodigo: 'INV-000002', vinculos: { criados: 0, atualizados: 1, jaExistentes: 6 }, paletes: { criados: 0 } });
    expect(await db.vinculoDocumentoPalete.count({ where: { escopoId: escopo.id, situacao: 'ATIVO' } })).toBe(7);
    // Conteúdo registrado continua; o palete movido continua onde está; o palete do endereço ausente é preservado.
    expect(await db.conteudoPalete.count({ where: { escopoId: escopo.id, situacao: 'ATIVO' } })).toBe(1);
    expect((await db.palete.findUniqueOrThrow({ where: { id: a101.id }, select: { posicaoId: true } })).posicaoId).toBe(f04p03.id);
    expect(await db.palete.count({ where: { escopoId: escopo.id, arquivadoEm: null } })).toBe(7);
    expect(await db.inventarioReferencia.findMany({ where: { escopoId: escopo.id }, select: { codigo: true, situacao: true }, orderBy: { numero: 'asc' } })).toEqual([
      { codigo: 'INV-000001', situacao: 'SUBSTITUIDO' },
      { codigo: 'INV-000002', situacao: 'ATIVO' },
    ]);
    // Vínculo mantido (NF A em 13 - A101): a origem citada é a planilha atual, com o mês de agenda e a janela novos.
    expect((await notas(a101.id)).items.find((i) => i.documentNumber === '0001001')).toMatchObject({ scheduleMonth: 'NOV/2026', windowRef: 'J2', source: { inventoryCode: 'INV-000002', row: 3 } });
    const busca = await como(app, sup, { method: 'GET', url: API + '/busca?texto=0001001' });
    expect(RespostaBuscaSchema.parse(busca.json()).items.filter((i) => i.base === 'INVENTARIO' && i.pallet?.id === a101.id).map((i) => [i.documentLink?.inventoryCode, i.documentLink?.row])).toEqual([['INV-000002', 3]]);
    // Palete com vínculo só mantido (15 - A120): endereço informado continua, citado pela versão ativa; a linha já importada guarda o palete.
    const p120 = await paleteDoEndereco('15 - A120');
    expect((await notas(p120.id)).informedAddress).toMatchObject({ address: '15 - A120', inventoryCode: 'INV-000002' });
    const praca = await como(app, sup, { method: 'GET', url: `${API}/praca` });
    expect(praca.json<{ pallets: { id: string; informedAddress: string | null }[] }>().pallets.find((x) => x.id === p120.id)?.informedAddress).toBe('15 - A120');
    expect(await db.linhaInventario.findFirstOrThrow({ where: { escopoId: escopo.id, linhaArquivo: 5, inventario: { codigo: 'INV-000002' } }, select: { acao: true, aplicada: true, paleteId: true } })).toEqual({ acao: 'JA_IMPORTADO', aplicada: false, paleteId: p120.id });
    // Próxima versão: todos os endereços reconhecem o palete existente (nenhum cadastro novo).
    const p3 = lido(novas, { variante: 'v3' });
    const plano3 = planejarCarga(p3, await carregarEstadoCarga(db, escopo.id, p3, 'INV-000002'));
    expect(plano3.enderecos.filter((e) => e.acao === 'CRIAR').map((e) => e.endereco)).toEqual([]);
  });

  it('escopo de demonstração é recusado sem gravar nada', async () => {
    const demo = await db.escopo.findUniqueOrThrow({ where: { id: ID_ESCOPO_PRACA }, include: { unidade: true, cliente: true } });
    const alvo: Escopo = { id: demo.id, name: demo.nome, unitCode: demo.unidade.codigo, unitName: demo.unidade.nome, clientCode: demo.cliente.codigo, clientName: demo.cliente.nome, demo: true };
    await expect(carregar(lido(), null, alvo)).rejects.toThrow(/demonstração/);
    expect(await db.inventarioReferencia.count({ where: { escopoId: ID_ESCOPO_PRACA, loteImportacao: { formato: 'JSON' } } })).toBe(0);
  });
});
