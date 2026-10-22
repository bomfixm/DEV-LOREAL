/**
 * Cadastro de conteúdo e conferência de volumes (out. 2026).
 *
 * - Conteúdo registrado: remetente obrigatório; tipo (NF, NFD, MI), número,
 *   Delivery e descrição opcionais — NF e Delivery podem ficar ambos vazios.
 *   Cada registro tem identidade própria (nada é unido pelo remetente nem por
 *   estar vazio); completar a identificação atualiza o mesmo registro.
 * - Conteúdo importado: os vínculos documentais do inventário/bipagem
 *   aparecem na mesma lista; volumes importados = contagem realizada.
 * - Contagem: acrescentada (nunca editada) para um conteúdo registrado ou um
 *   vínculo importado; a mais recente vale. Previsto só quando informado.
 *   Sem contagem = aguardando conferência (nunca zero). Nada aqui cria saldo
 *   por SKU, reserva, saída ou libera posição.
 */
import {
  normalizarQuantidade,
  type AlterarConteudoSchema,
  type ConteudoPalete,
  type ConteudosPalete,
  type ContagemConteudo,
  type Escopo,
  type NovoConteudoSchema,
  type OrigemContagem,
  type ReconferenciaPalete,
  type RegistrarContagemSchema,
  type RegistrarReconferenciaSchema,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { registrarMovimentacaoRelevante, registrarReconferenciaCompleta, relogioDoPalete } from '../paletes/relogio.js';
import { linhasAtuaisDosVinculos } from '../importacao/linhas-vigentes.js';
import { assinaturaConjunto, calcularConferencia, ocorrenciasAtivas } from './estado.js';

type Db = Banco | Transacao;
type DadosNovo = z.output<typeof NovoConteudoSchema>;
type DadosAlterar = z.output<typeof AlterarConteudoSchema>;
type DadosContagem = z.output<typeof RegistrarContagemSchema>;

export interface Autor {
  usuarioId: string;
  requestId: string;
}

interface ContagemLida {
  conteudo_id: string | null;
  vinculo_id: string | null;
  volumes_contados: number;
  volumes_previstos: number | null;
  origem: string;
  referencia: string | null;
  registrada_em: Date;
  autor: string | null;
}

const AGUARDANDO: ContagemConteudo = { state: 'AGUARDANDO', counted: null, expected: null, origin: null, at: null, by: null, reference: null };

function daContagem(c: ContagemLida): ContagemConteudo {
  return {
    state: 'REALIZADA',
    counted: String(c.volumes_contados),
    expected: c.volumes_previstos === null ? null : String(c.volumes_previstos),
    origin: c.origem as OrigemContagem,
    at: c.registrada_em.toISOString(),
    by: c.autor,
    reference: c.referencia,
  };
}

type ConferenciaLinha = NonNullable<ConteudoPalete['inventoryCheck']>;

/**
 * Campos do inventário preparado guardados na linha (`extras`, carga de
 * 20/10/2026): FULL/FRACIONADO como na planilha, etiquetas e a conferência
 * informada na linha. Linhas de cargas anteriores não têm esses campos.
 */
function doInventario(extras: unknown): Pick<ConteudoPalete, 'fullKind' | 'fullTags' | 'inventoryCheck'> {
  const e = typeof extras === 'object' && extras !== null ? (extras as Record<string, unknown>) : {};
  const texto = typeof e.identificacaoFull === 'string' ? e.identificacaoFull.trim().toUpperCase() : '';
  const etiquetas = Array.isArray(e.etiquetasFull) ? e.etiquetasFull.filter((x): x is string => typeof x === 'string') : [];
  // FRACIONADO preservado como veio (nunca reclassificado como FULL por haver uma nota só).
  const fullKind = texto === 'FRACIONADO' ? 'FRACIONADO' : etiquetas.length > 0 || e.paleteFull === true ? 'FULL' : null;
  const c = typeof e.conferencia === 'object' && e.conferencia !== null ? (e.conferencia as Record<string, unknown>) : null;
  const situacao = c?.situacao;
  const inventoryCheck: ConferenciaLinha | null =
    situacao === 'INFORMADA' || situacao === 'A_VALIDAR' || situacao === 'SEM_DATA'
      ? { state: situacao, date: typeof c?.data === 'string' ? c.data : null, text: typeof c?.texto === 'string' && c.texto.trim() !== '' ? c.texto : null }
      : null;
  return { fullKind, fullTags: etiquetas, inventoryCheck };
}

/** Inventário ativo do escopo e se a base é provisória ("em validação", convenção gravada na carga). */
async function inventarioAtivo(db: Db, escopoId: string): Promise<ConteudosPalete['inventory']> {
  const i = await db.inventarioReferencia.findFirst({ where: { escopoId, situacao: 'ATIVO' }, orderBy: { criadoEm: 'desc' }, select: { codigo: true, convencoes: true } });
  if (!i) return null;
  const c = typeof i.convencoes === 'object' && i.convencoes !== null ? (i.convencoes as Record<string, unknown>) : {};
  return { code: i.codigo, baseDate: typeof c.dataBase === 'string' ? c.dataBase : null, inValidation: c.emValidacao === true };
}

/** Palete do escopo que pode receber conteúdo (nem arquivado nem expedido). */
async function exigirPaleteAberto(tx: Transacao, escopoId: string, paleteId: string): Promise<{ id: string; codigo: string }> {
  const [p] = await tx.$queryRaw<{ id: string; codigo: string; arquivado: boolean; fluxo: string }[]>`
    SELECT id::text, codigo, arquivado_em IS NOT NULL AS arquivado, estado_fluxo::text AS fluxo
      FROM palete WHERE id = ${paleteId}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!p) throw naoEncontrado('Palete não encontrado neste escopo.');
  if (p.arquivado) throw new ErroHttp(409, 'CONFLITO', `O palete ${p.codigo} está arquivado: não recebe conteúdo.`);
  if (p.fluxo === 'EXPEDIDO') throw new ErroHttp(409, 'CONFLITO', `O palete ${p.codigo} já foi expedido: não recebe conteúdo.`);
  return { id: p.id, codigo: p.codigo };
}

/** Conteúdo do palete: registrado à mão e importado, com a contagem mais recente de cada um. */
export async function conteudosDoPalete(db: Db, escopoId: string, paleteId: string): Promise<ConteudosPalete> {
  const palete = await db.palete.findFirst({ where: { id: paleteId, escopoId }, select: { id: true } });
  if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
  const [registrados, importados] = await Promise.all([
    db.conteudoPalete.findMany({
      where: { escopoId, paleteId, situacao: 'ATIVO' },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      include: { loteImportacao: { select: { nomeArquivo: true } } },
    }),
    db.vinculoDocumentoPalete.findMany({
      where: { escopoId, paleteId, situacao: 'ATIVO' },
      orderBy: [{ tipoDocumento: 'asc' }, { numeroDocumento: 'asc' }, { criadoEm: 'asc' }],
      include: {
        inventario: { select: { codigo: true, situacao: true } },
        linhaInventario: { select: { id: true, linhaArquivo: true, remetente: true } },
      },
    }),
  ]);
  // Contagem vigente = a mais recente de cada ocorrência, pelo alvo (uma ocorrência movida leva as contagens consigo).
  const alvos = [...registrados.map((r) => r.id), ...importados.map((v) => v.id)];
  const contagens =
    alvos.length === 0
      ? []
      : await db.$queryRaw<ContagemLida[]>`
          SELECT DISTINCT ON (coalesce(c.conteudo_id, c.vinculo_id))
                 c.conteudo_id::text, c.vinculo_id::text, c.volumes_contados, c.volumes_previstos, c.origem, c.referencia, c.registrada_em, u.nome AS autor
            FROM contagem_volumes c
            LEFT JOIN usuario u ON u.id = c.registrada_por_id
           WHERE c.escopo_id = ${escopoId}::uuid AND coalesce(c.conteudo_id, c.vinculo_id) = ANY(${alvos}::uuid[])
           ORDER BY coalesce(c.conteudo_id, c.vinculo_id), c.registrada_em DESC, c.id DESC`;
  const contagemPor = new Map(contagens.map((c) => [c.conteudo_id ?? c.vinculo_id ?? '', c]));
  // Vínculo mantido de versão substituída: a origem citada é a linha da planilha atual.
  const atuais = await linhasAtuaisDosVinculos(db, escopoId, importados.map((v) => v.id));
  // Linha em vigor de cada vínculo: a da versão ativa (mantido) ou a própria.
  const linhaDe = (v: (typeof importados)[number]) => atuais.get(v.id)?.id ?? v.linhaInventario.id;
  const [linhas, inventario] = await Promise.all([
    db.linhaInventario.findMany({ where: { escopoId, id: { in: [...new Set(importados.map(linhaDe))] } }, select: { id: true, extras: true, documentacao: true, categoria: true } }),
    inventarioAtivo(db, escopoId),
  ]);
  const linhaPor = new Map(linhas.map((l) => [l.id, l]));

  const items: ConteudoPalete[] = [
    ...importados.map((v): ConteudoPalete => {
      const c = contagemPor.get(v.id);
      const importada: ContagemConteudo | null =
        v.volumes === null
          ? null
          : { state: 'REALIZADA', counted: normalizarQuantidade(v.volumes.toFixed()), expected: null, origin: 'IMPORTACAO', at: v.criadoEm.toISOString(), by: null, reference: v.inventario.codigo };
      const linha = linhaPor.get(linhaDe(v));
      return {
        id: v.id,
        kind: 'IMPORTADO',
        sender: atuais.get(v.id)?.remetente ?? v.linhaInventario.remetente,
        documentType: v.tipoDocumento,
        documentNumber: v.numeroDocumento,
        delivery: v.delivery,
        description: null,
        source: `${atuais.get(v.id)?.inventario.codigo ?? v.inventario.codigo}, linha ${String(atuais.get(v.id)?.linhaArquivo ?? v.linhaInventario.linhaArquivo)}`,
        documentTypeOriginal: null,
        senderCnpj: null,
        fromBipagem: false,
        palletFull: v.palletFull,
        ...doInventario(linha?.extras),
        classification: linha?.categoria ?? null,
        documentation: linha?.documentacao ?? v.documentacao,
        // Mantido de versão substituída sem linha correspondente na ativa: não consta do inventário atual (a validar no piso).
        latestInventory: inventario === null ? null : v.inventario.situacao === 'ATIVO' || atuais.has(v.id) ? 'CONSTA' : 'NAO_CONSTA',
        version: 0,
        count: c ? daContagem(c) : (importada ?? AGUARDANDO),
        check: null,
        allocatedAt: (v.alocadoEm ?? v.criadoEm).toISOString(),
        createdAt: v.criadoEm.toISOString(),
      };
    }),
    ...registrados.map(
      (r): ConteudoPalete => ({
        id: r.id,
        kind: 'REGISTRADO',
        sender: r.remetente,
        documentType: r.tipoDocumento,
        documentNumber: r.numeroDocumento,
        delivery: r.delivery,
        description: r.descricao,
        source: r.origem === 'BIPAGEM' ? `Bipagem ${r.loteImportacao?.nomeArquivo ?? ''}, linha ${String(r.linhaArquivo ?? '?')}` : null,
        documentTypeOriginal: r.tipoDocumentoOriginal,
        senderCnpj: r.cnpjRemetente,
        fromBipagem: r.origem === 'BIPAGEM',
        palletFull: null,
        fullKind: null,
        fullTags: [],
        inventoryCheck: null,
        classification: null,
        documentation: null,
        latestInventory: null,
        version: r.versao,
        count: ((c) => (c ? daContagem(c) : AGUARDANDO))(contagemPor.get(r.id)),
        check: null,
        allocatedAt: (r.alocadoEm ?? r.criadoEm).toISOString(),
        createdAt: r.criadoEm.toISOString(),
      }),
    ),
  ];

  // Documentos identificados = tipo + número (+ CNPJ do remetente, quando informado) distintos; várias Deliveries da mesma nota contam 1.
  const documentos = new Set(items.flatMap((i) => (i.documentNumber === null ? [] : [`${i.documentType ?? ''}|${i.documentNumber}|${(i.senderCnpj ?? '').replace(/\D+/g, '')}`])));
  const semDocumento = items.filter((i) => i.documentNumber === null).length;
  // FRACIONADO na planilha: uma nota só não basta para tratar o palete como full.
  const fracionado = items.some((i) => i.fullKind === 'FRACIONADO' || (i.palletFull ?? '').trim().toUpperCase() === 'FRACIONADO');
  const full = documentos.size >= 2 ? 'MISTO' : documentos.size === 1 && semDocumento === 0 && !fracionado ? 'FULL' : 'NAO_INFORMADO';
  // Conferência por linha e do palete, e a assinatura do conjunto exibido (a conferência em tabela a devolve).
  const ocorrencias = await ocorrenciasAtivas(db, escopoId, [paleteId]);
  const conferencia = await calcularConferencia(db, escopoId, ocorrencias, [paleteId]);
  for (const i of items) i.check = conferencia.porItem.get(i.id) ?? null;
  return {
    palletId: paleteId,
    items,
    documents: documentos.size,
    withoutDocument: semDocumento,
    full,
    inventory: inventario,
    setSignature: assinaturaConjunto(ocorrencias),
    volumeCheck: conferencia.porPalete.get(paleteId) ?? null,
  };
}

/** Registra um conteúdo novo no palete (sem contagem: aguardando conferência). */
export async function registrarConteudo(tx: Transacao, escopo: Escopo, paleteId: string, dados: DadosNovo, autor: Autor, agora: Date): Promise<ConteudosPalete> {
  const palete = await exigirPaleteAberto(tx, escopo.id, paleteId);
  const id = randomUUID();
  await tx.conteudoPalete.create({
    data: {
      id,
      escopoId: escopo.id,
      paleteId,
      remetente: dados.sender,
      tipoDocumento: dados.documentType,
      numeroDocumento: dados.documentNumber,
      delivery: dados.delivery,
      descricao: dados.description,
      criadoPorId: autor.usuarioId,
      criadoEm: agora,
      atualizadoEm: agora,
    },
  });
  // Entrada de material no palete: reinicia a contagem de 20 dias (completar a identificação depois não).
  await registrarMovimentacaoRelevante(tx, escopo.id, [paleteId], 'ENTRADA_CONTEUDO', agora);
  await registrarEvento(tx, {
    acao: 'CONTEUDO_REGISTRADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: paleteId,
    detalhes: { palete: palete.codigo, conteudo: id, remetente: dados.sender, tipo: dados.documentType, numero: dados.documentNumber, delivery: dados.delivery },
    requestId: autor.requestId,
  });
  return conteudosDoPalete(tx, escopo.id, paleteId);
}

/** Completa ou corrige a identificação do mesmo conteúdo; contagens, palete e histórico ficam. */
export async function alterarConteudo(tx: Transacao, escopo: Escopo, paleteId: string, conteudoId: string, dados: DadosAlterar, autor: Autor, agora: Date): Promise<ConteudosPalete> {
  const palete = await exigirPaleteAberto(tx, escopo.id, paleteId);
  const [atual] = await tx.$queryRaw<{ versao: number; remetente: string; tipo: string | null; numero: string | null; delivery: string | null; descricao: string | null; origem: string }[]>`
    SELECT versao, remetente, tipo_documento AS tipo, numero_documento AS numero, delivery, descricao, origem
      FROM conteudo_palete
     WHERE id = ${conteudoId}::uuid AND escopo_id = ${escopo.id}::uuid AND palete_id = ${paleteId}::uuid AND situacao = 'ATIVO'
       FOR UPDATE`;
  if (!atual) throw naoEncontrado('Conteúdo não encontrado neste palete.');
  if (atual.versao !== dados.expectedVersion) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O conteúdo foi alterado por outra pessoa. Os dados atuais foram recarregados; confira antes de repetir.');
  }
  // Conteúdo da bipagem: tipo e número formam a identidade com o CNPJ (vêm do arquivo); Delivery, descrição e remetente se completam aqui.
  if (atual.origem === 'BIPAGEM' && (dados.documentType !== atual.tipo || dados.documentNumber !== atual.numero)) {
    throw new ErroHttp(409, 'CONFLITO', 'Tipo e número deste conteúdo vêm da bipagem e não mudam aqui; complete só Delivery, descrição ou remetente.');
  }
  await tx.conteudoPalete.update({
    where: { id: conteudoId },
    data: {
      remetente: dados.sender,
      tipoDocumento: dados.documentType,
      numeroDocumento: dados.documentNumber,
      delivery: dados.delivery,
      descricao: dados.description,
      versao: { increment: 1 },
      atualizadoPorId: autor.usuarioId,
      atualizadoEm: agora,
    },
  });
  await registrarEvento(tx, {
    acao: 'CONTEUDO_ALTERADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: paleteId,
    detalhes: {
      palete: palete.codigo,
      conteudo: conteudoId,
      remetente: dados.sender,
      tipo: dados.documentType,
      numero: dados.documentNumber,
      delivery: dados.delivery,
      descricao: dados.description,
      remetenteAntes: atual.remetente,
      tipoAntes: atual.tipo,
      numeroAntes: atual.numero,
      deliveryAntes: atual.delivery,
      descricaoAntes: atual.descricao,
    },
    requestId: autor.requestId,
  });
  return conteudosDoPalete(tx, escopo.id, paleteId);
}

/** Registra o resultado de uma contagem (contada agora ou já feita); não altera identificação nem estoque. */
export async function registrarContagem(tx: Transacao, escopo: Escopo, paleteId: string, dados: DadosContagem, autor: Autor, agora: Date): Promise<ConteudosPalete> {
  const palete = await exigirPaleteAberto(tx, escopo.id, paleteId);
  const alvo =
    dados.target.kind === 'REGISTRADO'
      ? await tx.conteudoPalete.findFirst({ where: { id: dados.target.id, escopoId: escopo.id, paleteId, situacao: 'ATIVO' }, select: { id: true } })
      : await tx.vinculoDocumentoPalete.findFirst({ where: { id: dados.target.id, escopoId: escopo.id, paleteId, situacao: 'ATIVO' }, select: { id: true } });
  if (!alvo) throw naoEncontrado('Conteúdo não encontrado neste palete.');
  await tx.contagemVolumes.create({
    data: {
      id: randomUUID(),
      escopoId: escopo.id,
      paleteId,
      conteudoId: dados.target.kind === 'REGISTRADO' ? alvo.id : null,
      vinculoId: dados.target.kind === 'IMPORTADO' ? alvo.id : null,
      volumesContados: dados.counted,
      volumesPrevistos: dados.expected,
      origem: dados.origin,
      referencia: dados.reference,
      registradaPorId: autor.usuarioId,
      registradaEm: agora,
    },
  });
  await registrarEvento(tx, {
    acao: 'CONTAGEM_VOLUMES_REGISTRADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: paleteId,
    detalhes: { palete: palete.codigo, alvoTipo: dados.target.kind, alvoId: dados.target.id, contados: dados.counted, previstos: dados.expected, origem: dados.origin, referencia: dados.reference },
    requestId: autor.requestId,
  });
  return conteudosDoPalete(tx, escopo.id, paleteId);
}

/**
 * Reconferência COMPLETA do palete registrada na conferência de volumes: quem
 * registra confirma que conferiu o palete inteiro (sem diferença também vale;
 * diferenças ficam nas contagens de volumes). Reinicia o prazo de 20 dias sem
 * mudar conferência por SKU, liberação, reserva, saldo nem a fotografia
 * importada. Palete arquivado ou expedido é recusado.
 */
export async function registrarReconferencia(tx: Transacao, escopo: Escopo, paleteId: string, dados: z.infer<typeof RegistrarReconferenciaSchema>, autor: Autor, agora: Date): Promise<ReconferenciaPalete> {
  const palete = await exigirPaleteAberto(tx, escopo.id, paleteId);
  const [registrados, importados] = await Promise.all([
    tx.conteudoPalete.count({ where: { escopoId: escopo.id, paleteId, situacao: 'ATIVO' } }),
    tx.vinculoDocumentoPalete.count({ where: { escopoId: escopo.id, paleteId, situacao: 'ATIVO' } }),
  ]);
  const id = randomUUID();
  const observacao = dados.notes === null || dados.notes.trim() === '' ? null : dados.notes.trim();
  await tx.reconferenciaPalete.create({
    data: { id, escopoId: escopo.id, paleteId, resultado: dados.result, observacao, conteudos: registrados + importados, registradaPorId: autor.usuarioId, registradaEm: agora },
  });
  await registrarReconferenciaCompleta(tx, escopo.id, paleteId, 'RECONFERENCIA_VOLUMES', autor.usuarioId, agora);
  await registrarEvento(tx, {
    acao: 'RECONFERENCIA_REGISTRADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: paleteId,
    detalhes: { palete: palete.codigo, reconferencia: id, resultado: dados.result, conteudos: registrados + importados },
    requestId: autor.requestId,
  });
  const situacao = await relogioDoPalete(tx, escopo.id, paleteId, agora);
  if (!situacao) throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} não tem prazo de reconferência (arquivado ou expedido).`);
  return situacao;
}
