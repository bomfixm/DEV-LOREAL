import {
  ConteudosPaleteSchema,
  CorrespondenciaEnderecosSchema,
  DocumentosPaleteSchema,
  InventarioResumoSchema,
  PaginaLinhasInventarioSchema,
  PaleteDetalheSchema,
  PendenciasInventarioSchema,
  RespostaBuscaSchema,
  ResultadoLayoutSchema,
  type ConteudosPalete,
  type Escopo,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Banco } from '../../src/db/cliente.js';
import { executarCarga, lerPacote, type PacoteLido } from '../../src/modules/importacao/carga-lote.js';
import { converterInventarioLoreal } from '../../src/modules/importacao/inventario-loreal.js';
import { appDeTeste, bancoDeTeste, como, criarUsuario, entrar, mutar, prepararDados, type SessaoTeste, type UsuarioTeste } from './apoio.js';

/**
 * Inventário L'Oréal preparado (formato "1.0", base 20/10/2026) com dados
 * fictícios: conversão para o pacote de carga, linhas em revisão preservadas
 * sem alocação, FULL n/m e FRACIONADO como na planilha, conferência informada
 * por linha, "Inventário em validação", pendências agrupadas, busca das linhas
 * pendentes, reenvio sem duplicar e nova versão mantendo os ausentes.
 */
const API = '/api/v1';
let db: Banco;
let app: FastifyInstance;
let escopo: Escopo;
let supervisor: UsuarioTeste;
let sup: SessaoTeste;

const VAZIO = {
  numero_palete: null,
  endereco_origem: null,
  endereco: null,
  tipo_documento_origem: null,
  numero_documento: null,
  delivery: null,
  delivery_origem: null,
  volumes: null,
  remetente: null,
  palete_full: null,
  identificacao_full_origem: null,
  etiquetas_full: [],
  classificacao_pf_pj_origem: null,
  documentacao_origem: null,
  inventario_origem: null,
  data_conferencia_informada: null,
  mes_agenda_origem: null,
  janela_origem: null,
  provisorio: true,
  pendencias: [],
  elegivel_para_alocacao_apos_validacao_do_mapa: true,
  estado_preparacao: 'candidato_a_importacao_provisoria',
};
const registro = (linha: number, x: Record<string, unknown>) => ({ ...VAZIO, id_origem: `ficticio:${String(linha)}`, linha_origem: linha, ...x });
const NOTA_FULL = { tipo_documento_origem: 'NFD', numero_documento: '9059802', volumes: 117, remetente: 'Remetente Fictício A', palete_full: true, classificacao_pf_pj_origem: 'CNPJ', documentacao_origem: 'VALIDADA' };
const REPETIDA = { numero_palete: '301', endereco_origem: '13 - A107', endereco: '13 - A107', tipo_documento_origem: 'NFD', numero_documento: '7771', volumes: 5, remetente: 'Remetente Fictício C', estado_preparacao: 'revisao_necessaria', pendencias: ['duplicata_exata'] };

const REGISTROS = [
  // Mesma NF em dois paletes FULL: volumes de cada um, sem multiplicar.
  registro(3, { ...NOTA_FULL, numero_palete: '256', endereco_origem: '13 - A101', endereco: '13 - A101', identificacao_full_origem: '03/09', etiquetas_full: [{ parte: 3, total: 9, texto: '3/9' }], inventario_origem: '16-10', data_conferencia_informada: '2026-10-16' }),
  registro(4, { ...NOTA_FULL, numero_palete: '257', endereco_origem: '13 - A103', endereco: '13 - A103', identificacao_full_origem: '01/09', etiquetas_full: [{ parte: 1, total: 9, texto: '1/9' }], inventario_origem: 'VALIDAR', pendencias: ['conferencia_a_validar'] }),
  // Uma nota só, marcada FRACIONADO: nunca vira FULL.
  registro(5, { numero_palete: '300', endereco_origem: '13 - A105', endereco: '13 - A105', tipo_documento_origem: 'NFE', numero_documento: '5551', volumes: 4, remetente: 'Remetente Fictício B', palete_full: false, identificacao_full_origem: 'FRACIONADO', classificacao_pf_pj_origem: 'PF' }),
  // Em revisão: duas linhas iguais e uma com RUA = VALIDAR e sem N° Pallet.
  registro(6, REPETIDA),
  registro(7, REPETIDA),
  registro(8, { endereco_origem: 'VALIDAR', tipo_documento_origem: 'NFD', numero_documento: '8881', volumes: 2, remetente: 'Remetente Fictício D', estado_preparacao: 'revisao_necessaria', pendencias: ['endereco_a_validar', 'numero_palete_ausente'] }),
];
const PENDENCIAS = {
  ocorrencias: [
    { codigo: 'duplicata_exata', nivel: 'bloqueio', linhas_origem: [6, 7], descricao: 'Linhas 6 e 7 iguais' },
    { codigo: 'endereco_a_validar', nivel: 'bloqueio', linhas_origem: [8], descricao: 'VALIDAR' },
    { codigo: 'numero_palete_ausente', nivel: 'bloqueio', linhas_origem: [8], descricao: 'Sem número' },
    { codigo: 'conferencia_a_validar', nivel: 'atencao', linhas_origem: [4], descricao: 'VALIDAR não é data' },
  ],
};

function preparado(registros: readonly object[], sha = 'a'.repeat(64)) {
  const revisao = registros.filter((r) => (r as { estado_preparacao: string }).estado_preparacao === 'revisao_necessaria').length;
  return {
    versao_formato: '1.0',
    resumo: { arquivo_origem: 'inventario-ficticio.xlsx', sha256_arquivo: sha, aba: 'Inventario ficticio', data_base: '2026-10-20', natureza: 'fictício', linhas_com_conteudo: registros.length, candidatos_a_alocacao_provisoria: registros.length - revisao, linhas_para_revisao: revisao },
    registros,
  };
}

function lido(registros: readonly object[] = REGISTROS, sha?: string): PacoteLido {
  const pacote = converterInventarioLoreal({ preparado: preparado(registros, sha), pendencias: PENDENCIAS });
  const r = lerPacote(Buffer.from(JSON.stringify(pacote), 'utf8'), 'inventario-preparado.json');
  if (!r.ok) throw new Error(`Pacote fictício recusado: ${r.erros.join(' | ')}`);
  return r.pacote;
}

const autor = () => ({ usuarioId: supervisor.id, requestId: `teste-${randomUUID()}` });
const carregar = (p: PacoteLido, opcoes: { substitui?: string; manterAusentes?: boolean } = {}) =>
  executarCarga(db, escopo, autor(), p, { substitui: opcoes.substitui ?? null, descricao: null, ...(opcoes.manterAusentes === undefined ? {} : { manterAusentes: opcoes.manterAusentes }) }, new Date('2026-10-20T15:00:00Z'));

async function conteudoDe(endereco: string): Promise<ConteudosPalete> {
  const p = await db.palete.findFirstOrThrow({ where: { escopoId: escopo.id, linhasInventario: { some: { enderecoCanonico: endereco, aplicada: true } } }, select: { id: true } });
  const r = await como(app, sup, { method: 'GET', url: `${API}/paletes/${p.id}/conteudos` });
  expect(r.statusCode, r.body).toBe(200);
  return ConteudosPaleteSchema.parse(r.json());
}

async function buscar(texto: string) {
  const b = await como(app, sup, { method: 'GET', url: `${API}/busca?texto=${encodeURIComponent(texto)}` });
  expect(b.statusCode, b.body).toBe(200);
  return RespostaBuscaSchema.parse(b.json()).items;
}

beforeAll(() => {
  db = bancoDeTeste();
});

beforeEach(async () => {
  await prepararDados(db);
  app = await appDeTeste(db);
  const unidade = await db.unidade.create({ data: { id: randomUUID(), codigo: 'UN-TESTE-LOREAL', nome: 'Unidade operacional de teste', demonstracao: false } });
  const cliente = await db.cliente.create({ data: { id: randomUUID(), codigo: 'CLI-TESTE-LOREAL', nome: 'Cliente de teste', demonstracao: false } });
  const e = await db.escopo.create({ data: { id: randomUUID(), unidadeId: unidade.id, clienteId: cliente.id, nome: 'Praça de teste · Cliente de teste', demonstracao: false } });
  escopo = { id: e.id, name: e.nome, unitCode: unidade.codigo, unitName: unidade.nome, clientCode: cliente.codigo, clientName: cliente.nome, demo: false };
  supervisor = await criarUsuario(db, 'supervisor.loreal', [[e.id, 'SUPERVISOR_ESTOQUE']]);
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

describe('Inventário preparado (formato 1.0)', () => {
  it('converte: candidatos viram vínculos sem multiplicar volumes; linhas com bloqueio ficam em revisão; base em validação', () => {
    const { pacote } = lido();
    expect(pacote.linhas_fonte).toHaveLength(6);
    expect(pacote.linhas_em_revisao.map((r) => [r.linha, r.motivos.filter((m) => m.nivel === 'bloqueio').map((m) => m.codigo)])).toEqual([
      [6, ['duplicata_exata']],
      [7, ['duplicata_exata']],
      [8, ['endereco_a_validar', 'numero_palete_ausente']],
    ]);
    expect(pacote.nfds_na_praca.map((v) => [v.endereco, v.numero_documento, v.volumes])).toEqual([
      ['13 - A101', '9059802', '117'],
      ['13 - A103', '9059802', '117'],
    ]);
    expect(pacote.documentos_tipo_pendente_na_praca.map((v) => [v.endereco, v.tipo_documento, v.numero_documento])).toEqual([['13 - A105', 'NFE', '5551']]);
    expect([pacote.em_validacao, pacote.data_base]).toEqual([true, '2026-10-20']);
  });

  it('grava: revisão sem palete nem vínculo; janela com FULL/Fracionado, conferência por linha e "em validação"; pendências agrupadas; busca; reenvio não duplica', async () => {
    const p = lido();
    const r = await carregar(p);
    expect(r).toMatchObject({ reenvio: false, linhas: { total: 6, aplicadas: 3, emRevisao: 3 }, vinculos: { criados: 3, mantidosAusentes: 0 }, paletes: { criados: 3 } });
    const revisao = await db.linhaInventario.findMany({ where: { escopoId: escopo.id, linhaArquivo: { in: [6, 7, 8] } }, select: { acao: true, aplicada: true, paleteId: true, _count: { select: { vinculos: true } } } });
    expect(revisao).toEqual(Array.from({ length: 3 }, () => ({ acao: 'REQUER_RESOLUCAO', aplicada: false, paleteId: null, _count: { vinculos: 0 } })));
    expect(await db.vinculoDocumentoPalete.count({ where: { escopoId: escopo.id, situacao: 'ATIVO' } })).toBe(3);

    const a101 = await conteudoDe('13 - A101');
    expect(a101.inventory).toEqual({ code: 'INV-000001', baseDate: '2026-10-20', inValidation: true });
    expect(a101.items.map((i) => [i.documentNumber, i.count.counted, i.fullKind, i.fullTags, i.inventoryCheck, i.classification, i.documentation, i.latestInventory])).toEqual([
      ['9059802', '117', 'FULL', ['3/9'], { state: 'INFORMADA', date: '2026-10-16', text: '16-10' }, 'CNPJ', 'VALIDADA', 'CONSTA'],
    ]);
    expect((await conteudoDe('13 - A103')).items[0]?.inventoryCheck).toEqual({ state: 'A_VALIDAR', date: null, text: 'VALIDAR' });
    // FRACIONADO com uma nota só: preservado, nunca reclassificado como full.
    const a105 = await conteudoDe('13 - A105');
    expect([a105.full, a105.items[0]?.fullKind, a105.items[0]?.inventoryCheck?.state]).toEqual(['NAO_INFORMADO', 'FRACIONADO', 'SEM_DATA']);
    const notas = await como(app, sup, { method: 'GET', url: `${API}/paletes/${a105.palletId}/documentos` });
    expect(DocumentosPaleteSchema.parse(notas.json()).palletFull.value).toBe('NAO_INFORMADO');

    // Inventário: base em validação, linhas (extras em texto) e pendências agrupadas por causa → endereço/N° Pallet.
    const inv = await db.inventarioReferencia.findFirstOrThrow({ where: { escopoId: escopo.id }, select: { id: true } });
    const resumo = InventarioResumoSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/inventarios/${inv.id}` })).json());
    expect([resumo.inValidation, resumo.baseDate, resumo.totals.pending]).toEqual([true, '2026-10-20', 3]);
    const linhas = await como(app, sup, { method: 'GET', url: `${API}/inventarios/${inv.id}/linhas?situacao=PENDENTES` });
    expect(linhas.statusCode, linhas.body).toBe(200);
    expect(PaginaLinhasInventarioSchema.parse(linhas.json()).items.map((l) => [l.row, l.reasons.find((m) => m.code.startsWith('REVISAO_'))?.code])).toEqual([
      [6, 'REVISAO_DUPLICATA_EXATA'],
      [7, 'REVISAO_DUPLICATA_EXATA'],
      [8, 'REVISAO_ENDERECO_A_VALIDAR'],
    ]);
    const pend = PendenciasInventarioSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/inventarios/${inv.id}/pendencias` })).json());
    expect(pend.totalLines).toBe(3);
    expect(pend.groups.map((g) => [g.cause, g.description, g.lines, g.places])).toEqual([
      ['REVISAO_DUPLICATA_EXATA', 'Linhas iguais (possível recontagem duplicada)', 2, [{ address: '13 - A107', palletNumbers: ['301'], rows: [6, 7] }]],
      ['REVISAO_ENDERECO_A_VALIDAR', 'Endereço a validar (RUA = VALIDAR)', 1, [{ address: 'VALIDAR', palletNumbers: [], rows: [8] }]],
      ['REVISAO_NUMERO_PALETE_AUSENTE', 'N° Pallet ausente', 1, [{ address: 'VALIDAR', palletNumbers: [], rows: [8] }]],
    ]);

    // Busca interna: as linhas em revisão aparecem, sem palete, com a causa.
    const pendente = (await buscar('8881')).filter((i) => i.base === 'ORIGEM_INVENTARIO');
    expect(pendente.map((i) => [i.pallet, i.inventoryOrigin?.row, i.inventoryOrigin?.informedAddress])).toEqual([[null, 8, 'VALIDAR']]);
    expect(pendente[0]?.inventoryOrigin?.reason).toMatch(/^Em revisão — Endereço a validar \(RUA = VALIDAR\): VALIDAR/);
    // Mesma correspondência: a ordem entre as duas linhas não é garantida.
    const repetidas = (await buscar('7771')).filter((i) => i.base === 'ORIGEM_INVENTARIO').map((i) => i.inventoryOrigin?.row ?? 0);
    expect(repetidas.sort((a, b) => a - b)).toEqual([6, 7]);

    // Reenvio do mesmo arquivo: nada duplicado nem somado.
    const re = await carregar(p);
    expect(re).toMatchObject({ reenvio: true, linhas: { total: 6, emRevisao: 3 } });
    expect(await db.linhaInventario.count({ where: { escopoId: escopo.id } })).toBe(6);
    expect(await db.vinculoDocumentoPalete.count({ where: { escopoId: escopo.id } })).toBe(3);
    expect((await conteudoDe('13 - A101')).items.map((i) => i.count.counted)).toEqual(['117']);
  });

  it('nova versão com "manter ausentes": o vínculo que não consta continua ativo e é marcado; a opção exige substituição', async () => {
    await carregar(lido());
    const semFracionado = REGISTROS.filter((r) => r.linha_origem !== 5);
    await expect(carregar(lido(semFracionado, 'b'.repeat(64)), { manterAusentes: true })).rejects.toThrow(/substituir/);
    const r = await carregar(lido(semFracionado, 'b'.repeat(64)), { substitui: 'INV-000001', manterAusentes: true });
    expect(r).toMatchObject({ inventarioCodigo: 'INV-000002', vinculos: { criados: 0, jaExistentes: 2, mantidosAusentes: 1 } });
    // O mesmo comando repetido é reenvio (a substituição já foi feita por este arquivo): nada é gravado.
    const repetido = await carregar(lido(semFracionado, 'b'.repeat(64)), { substitui: 'INV-000001', manterAusentes: true });
    expect([repetido.reenvio, repetido.inventarioCodigo]).toEqual([true, 'INV-000002']);
    expect(await db.vinculoDocumentoPalete.count({ where: { escopoId: escopo.id, situacao: 'ATIVO' } })).toBe(3);
    const a105 = await conteudoDe('13 - A105');
    expect([a105.inventory?.code, a105.items[0]?.latestInventory]).toEqual(['INV-000002', 'NAO_CONSTA']);
    // O mantido igual passa a citar a linha da versão ativa.
    const a101 = await conteudoDe('13 - A101');
    expect([a101.items[0]?.latestInventory, a101.items[0]?.source]).toEqual(['CONSTA', 'INV-000002, linha 3']);
  });

  it('endereço corrigido por decisão ("13 - A9" é 13 - A109): a linha vai para o endereço correto, o texto da planilha fica guardado e o palete é reconferido', () => {
    const foraDaRegra = registro(9, { numero_palete: '1012', endereco_origem: '13 - A9', endereco: '13 - A9', tipo_documento_origem: 'NFD', numero_documento: '9991', volumes: 3, remetente: 'Remetente Fictício E', estado_preparacao: 'revisao_necessaria' });
    const pendencias = { ocorrencias: [...PENDENCIAS.ocorrencias, { codigo: 'endereco_fora_da_regra', nivel: 'bloqueio', linhas_origem: [9], descricao: '13 - A9: não corrigir por suposição' }] };
    const decisao = { causas: ['duplicata_exata'], decisao: 'Usuário em 21/10/2026' };
    // Sem a correção, continua em revisão (a causa não foi liberada).
    expect(converterInventarioLoreal({ preparado: preparado([...REGISTROS, foraDaRegra]), pendencias, alocarRevisao: decisao }).linhas_em_revisao.map((r) => r.linha)).toEqual([8, 9]);
    const pacote = converterInventarioLoreal({ preparado: preparado([...REGISTROS, foraDaRegra]), pendencias, alocarRevisao: decisao, corrigirEnderecos: [{ de: '13 - A9', para: '13 - A109' }] });
    expect(pacote.linhas_em_revisao.map((r) => r.linha)).toEqual([8]);
    expect(pacote.nfds_na_praca.filter((v) => v.numero_documento === '9991').map((v) => [v.endereco, v.volumes, v.linhas_origem])).toEqual([['13 - A109', '3', [9]]]);
    const linha = pacote.linhas_fonte.find((l) => l.linha === 9);
    expect([linha?.endereco, linha?.endereco_original, linha?.campos_originais.RUA]).toEqual(['13 - A109', '13 - A9', '13 - A9']);
    expect(pacote.reconferencia_exigida.find((r) => r.endereco === '13 - A109')?.motivo).toMatch(/Endereço da planilha 13 - A9 lido como 13 - A109/);
    expect(lerPacote(Buffer.from(JSON.stringify(pacote), 'utf8'), 'x.json').ok).toBe(true);
  });

  it('decisão sobre linhas em revisão: as liberadas vão para o palete do endereço (sem somar) com reconferência necessária, até a reconferência completa', async () => {
    await carregar(lido());
    const decisao = { causas: ['duplicata_exata', 'numero_palete_ausente'], decisao: 'Usuário em 21/10/2026: manter no palete e reconferir' };
    const pacote = converterInventarioLoreal({ preparado: preparado(REGISTROS), pendencias: PENDENCIAS, alocarRevisao: decisao });
    // Linha 8 também tem RUA = VALIDAR (causa não liberada e sem endereço): continua em revisão.
    expect(pacote.linhas_em_revisao.map((r) => r.linha)).toEqual([8]);
    expect(pacote.nfds_na_praca.filter((v) => v.endereco === '13 - A107').map((v) => [v.numero_documento, v.volumes, v.linhas_origem])).toEqual([['7771', null, [6, 7]]]);
    expect(pacote.reconferencia_exigida.map((r) => r.endereco)).toEqual(['13 - A107']);
    expect(pacote.reconferencia_exigida[0]?.motivo).toMatch(/Linhas iguais \(possível recontagem duplicada\).*Usuário em 21\/10\/2026/);

    const lidoDecisao = lerPacote(Buffer.from(JSON.stringify(pacote), 'utf8'), 'inventario-preparado.json');
    if (!lidoDecisao.ok) throw new Error(lidoDecisao.erros.join(' | '));
    const r = await carregar(lidoDecisao.pacote, { substitui: 'INV-000001', manterAusentes: true });
    expect(r).toMatchObject({ inventarioCodigo: 'INV-000002', linhas: { emRevisao: 1 }, vinculos: { criados: 1, jaExistentes: 3, mantidosAusentes: 0 }, paletes: { criados: 1, reconferenciaExigida: 1 } });

    // Palete de 13 - A107: a nota (duas linhas iguais, volumes a confirmar) e a reconferência necessária com o motivo.
    const a107 = await conteudoDe('13 - A107');
    expect(a107.items.map((i) => [i.documentNumber, i.count.counted])).toEqual([['7771', null]]);
    const detalhe = async () => PaleteDetalheSchema.parse((await como(app, sup, { method: 'GET', url: `${API}/paletes/${a107.palletId}` })).json());
    const antes = await detalhe();
    expect([antes.reconference?.due, antes.reconference?.required?.reason]).toEqual([true, expect.stringMatching(/Conferir o palete/)]);
    // Os demais paletes não ficam marcados.
    expect((await db.palete.count({ where: { escopoId: escopo.id, reconferenciaExigidaEm: { not: null } } }))).toBe(1);

    // Reconferência completa registrada: a marca sai.
    const reconf = await mutar(app, sup, 'POST', `${API}/paletes/${a107.palletId}/reconferencias`, { wholePallet: true, result: 'SEM_DIFERENCA', notes: null });
    expect(reconf.statusCode, reconf.body).toBe(201);
    const depois = await detalhe();
    expect([depois.reconference?.due, depois.reconference?.required]).toEqual([false, null]);
  });
});
