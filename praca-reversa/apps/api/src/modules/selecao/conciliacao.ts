/**
 * Conciliação da seleção do cliente com os registros (complemento).
 *
 * Executada no servidor, no escopo ativo, a cada consulta (localização e
 * saldos são sempre os atuais). Para cada solicitação, separa três aspectos:
 * vínculo/localização (paletes e endereços), base de quantidade (volumes
 * informados × saldo validado/reservado/disponível na unidade pedida) e
 * elegibilidade para expedição (material validado, liberado, disponível e sem
 * bloqueio). Nunca cria estoque, alocação, perda ou claim.
 *
 * Ordem de identificação: resolução explícita registrada → referência do
 * inventário/pedido → palete (ID permanente pelo código) → documento com
 * contexto (tipo + número) → SKU com origem. Número isolado (sem tipo, com
 * mais de um contexto) e SKU sem documento não resolvem identidade: viram
 * "identificação ambígua" com os candidatos.
 */
import {
  PROXIMO_PASSO_SITUACAO,
  compararQuantidades,
  normalizarQuantidade,
  somarQuantidades,
  subtrairQuantidades,
  type Alocacao,
  type DefinicaoTipoDocumento,
  type EstadoConferencia,
  type EstadoFluxo,
  type EstadoLiberacao,
  type MaterialConciliado,
  type ParametrosSelecao,
  type ResultadoConciliacao,
  type SituacaoConciliacao,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { lerMaterial, materialRegra, type LinhaMaterial } from '../janelas/leitura.js';
import { disponivelParaReserva, pendenciasDoMaterial } from '../janelas/regras.js';

type Db = Banco | Transacao;

const zero = '0';
const soma = (a: string, b: string) => normalizarQuantidade(somarQuantidades([a, b]));
const positivo = (q: string) => compararQuantidades(q, zero) > 0;

export interface LinhaSelecaoBase {
  id: string;
  linhaArquivo: number;
  referenciaLinha: string | null;
  abrangencia: 'PALETE' | 'DOCUMENTO' | 'LINHA_PRODUTO';
  regraAbrangencia: string;
  paleteReferencia: string | null;
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  chaveDocumento: string | null;
  delivery: string | null;
  referenciaInventario: string | null;
  janelaReferencia: string | null;
  sku: string | null;
  lote: string | null;
  quantidade: string | null;
  unidade: string | null;
  observacao: string | null;
  duplicadaDeLinha: number | null;
}

interface LinhaInventarioBase {
  id: string;
  linhaArquivo: number;
  paleteId: string | null;
  numeroPalete: string | null;
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  chaveDocumento: string | null;
  delivery: string | null;
  volumes: string | null;
  enderecoCanonico: string | null;
  enderecoLido: string | null;
  enderecoLivre: boolean;
  aplicada: boolean;
  acao: string;
}

interface VinculoBase {
  id: string;
  paleteId: string;
  tipoDocumento: string | null;
  numeroDocumento: string;
  chaveDocumento: string;
  delivery: string | null;
  volumes: string | null;
  unidade: string;
  situacao: string;
  inventarioId: string;
  linhaArquivo: number;
  enderecoInformado: string | null;
}

interface PaleteBase {
  id: string;
  codigo: string;
  versao: number;
  posicaoId: string | null;
  posicaoCodigo: string | null;
  endereco: string | null;
  fluxo: EstadoFluxo;
  conferencia: EstadoConferencia;
  liberacao: EstadoLiberacao;
  bloqueio: string | null;
  arquivado: boolean;
}

interface ExpedicaoBase {
  expedicaoId: string;
  codigo: string;
  em: Date;
  paleteId: string;
  paleteCodigo: string;
  segmentoId: string;
  sku: string;
  origemTipo: string | null;
  origemReferencia: string | null;
  quantidade: string;
  unidade: string;
}

export interface BaseConciliacao {
  parametros: Pick<ParametrosSelecao, 'documentContext' | 'documentWithoutQuantity' | 'defaultDocumentType'>;
  inventario: { id: string; codigo: string; dataConferencia: string | null; definicoes: Map<string, DefinicaoTipoDocumento> } | null;
  inventarioLinhas: LinhaInventarioBase[];
  vinculos: VinculoBase[];
  paletes: Map<string, PaleteBase>;
  paletePorCodigo: Map<string, PaleteBase>;
  material: LinhaMaterial[];
  expedicoes: ExpedicaoBase[];
  documentosImportados: Map<string, { referencia: string; linha: string; sku: string }[]>;
  resolucoes: Map<string, { paleteId: string | null; chaveDocumento: string | null; motivo: string; autor: { login: string; name: string } | null; em: Date }>;
  encaminhadas: Map<string, { reservado: string; expedido: string; reservas: string[] }>;
  demandaExterna: { selecaoCodigo: string; linhaArquivo: number; paleteReferencia: string | null; chaveDocumento: string | null; numeroDocumento: string | null }[];
}

const chave = (codigo: string) => codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Carrega as bases citadas pelas linhas da seleção (consultas em lote, escopo restrito). */
export async function carregarBase(
  db: Db,
  escopoId: string,
  selecao: { id: string; inventarioId: string | null; referenciaPedido: string; parametros: BaseConciliacao['parametros'] },
  linhas: readonly LinhaSelecaoBase[],
): Promise<BaseConciliacao> {
  const numeros = [...new Set(linhas.flatMap((l) => (l.numeroDocumento === null ? [] : [l.numeroDocumento])))];
  const deliveries = [...new Set(linhas.flatMap((l) => (l.delivery === null ? [] : [l.delivery])))];
  const codigosPalete = [...new Set(linhas.flatMap((l) => (l.paleteReferencia === null ? [] : [chave(l.paleteReferencia)])))];
  const skus = [...new Set(linhas.flatMap((l) => (l.sku === null ? [] : [l.sku.toUpperCase()])))];
  const inv =
    selecao.inventarioId === null
      ? null
      : await db.inventarioReferencia.findFirst({ where: { id: selecao.inventarioId, escopoId }, select: { id: true, codigo: true, dataConferencia: true, convencoes: true } });
  const definicoes = new Map<string, DefinicaoTipoDocumento>();
  const conv = inv?.convencoes as { documentTypes?: DefinicaoTipoDocumento[] } | undefined;
  for (const d of conv?.documentTypes ?? []) definicoes.set(d.code.toUpperCase(), d);
  const inventarioLinhas =
    inv === null
      ? []
      : await db.linhaInventario.findMany({
          where: {
            escopoId,
            inventarioId: inv.id,
            OR: [
              { numeroDocumento: { in: numeros } },
              { numeroPalete: { in: [...new Set(linhas.flatMap((l) => (l.paleteReferencia === null ? [] : [l.paleteReferencia])))] } },
              { linhaArquivo: { in: linhas.flatMap((l) => (l.referenciaInventario !== null && /^\d{1,7}$/.test(l.referenciaInventario) ? [Number(l.referenciaInventario)] : [])) } },
            ],
          },
          select: {
            id: true,
            linhaArquivo: true,
            paleteId: true,
            numeroPalete: true,
            tipoDocumento: true,
            numeroDocumento: true,
            chaveDocumento: true,
            delivery: true,
            volumes: true,
            enderecoCanonico: true,
            enderecoLido: true,
            enderecoLivre: true,
            aplicada: true,
            acao: true,
          },
        });
  const paletesDiretos = await db.palete.findMany({ where: { escopoId, codigoBusca: { in: codigosPalete } }, select: { id: true } });
  const vinculos = await db.vinculoDocumentoPalete.findMany({
    where: {
      escopoId,
      OR: [{ numeroDocumento: { in: numeros } }, { paleteId: { in: [...paletesDiretos.map((p) => p.id), ...inventarioLinhas.flatMap((l) => (l.paleteId === null ? [] : [l.paleteId]))] } }],
    },
    select: {
      id: true,
      paleteId: true,
      tipoDocumento: true,
      numeroDocumento: true,
      chaveDocumento: true,
      delivery: true,
      volumes: true,
      unidadeVolumes: true,
      situacao: true,
      inventarioId: true,
      linhaInventario: { select: { linhaArquivo: true, enderecoCanonico: true, enderecoLido: true } },
    },
  });
  const materialPorSku = skus.length === 0 ? [] : await db.$queryRaw<{ palete_id: string }[]>`
      SELECT DISTINCT s.palete_id::text FROM saldo_estoque s JOIN segmento_estoque sg ON sg.id = s.segmento_id JOIN produto pr ON pr.id = sg.produto_id
       WHERE s.escopo_id = ${escopoId}::uuid AND upper(pr.sku) = ANY(${skus}::text[]) AND s.quantidade > 0`;
  const idsPaletes = [
    ...new Set([
      ...paletesDiretos.map((p) => p.id),
      ...vinculos.map((v) => v.paleteId),
      ...inventarioLinhas.flatMap((l) => (l.paleteId === null ? [] : [l.paleteId])),
      ...materialPorSku.map((m) => m.palete_id),
    ]),
  ];
  const paletes = await db.palete.findMany({
    where: { escopoId, id: { in: idsPaletes } },
    select: {
      id: true,
      codigo: true,
      codigoBusca: true,
      versao: true,
      posicaoId: true,
      posicao: { select: { codigo: true, endereco: { select: { endereco: true, situacao: true } } } },
      estadoFluxo: true,
      estadoConferencia: true,
      estadoLiberacao: true,
      bloqueioMotivo: true,
      arquivadoEm: true,
    },
  });
  const paletesBase = paletes.map(
    (p): PaleteBase & { codigoBusca: string } => ({
      id: p.id,
      codigo: p.codigo,
      codigoBusca: p.codigoBusca,
      versao: p.versao,
      posicaoId: p.posicaoId,
      posicaoCodigo: p.posicao?.codigo ?? null,
      endereco: p.posicao?.endereco?.situacao === 'CONFIRMADO' ? p.posicao.endereco.endereco : null,
      fluxo: p.estadoFluxo,
      conferencia: p.estadoConferencia,
      liberacao: p.estadoLiberacao,
      bloqueio: p.bloqueioMotivo,
      arquivado: p.arquivadoEm !== null,
    }),
  );
  const material = idsPaletes.length === 0 ? [] : await lerMaterial(db, escopoId, { paleteIds: idsPaletes });
  const expedicoes =
    idsPaletes.length === 0
      ? []
      : await db.linhaExpedicao.findMany({
          where: { escopoId, paleteId: { in: idsPaletes }, quantidadeEnviada: { gt: 0 } },
          select: {
            expedicaoId: true,
            paleteId: true,
            segmentoId: true,
            quantidadeEnviada: true,
            unidade: true,
            sku: true,
            origemTipo: true,
            origemReferencia: true,
            palete: { select: { codigo: true } },
            expedicao: { select: { codigo: true, confirmadaEm: true } },
          },
        });
  const docs =
    numeros.length + deliveries.length === 0
      ? []
      : await db.linhaDocumentoDevolucao.findMany({
          where: { escopoId, OR: [{ notaFiscal: { in: numeros } }, { documento: { referencia: { in: [...numeros, ...deliveries] } } }] },
          select: { notaFiscal: true, referenciaLinha: true, sku: true, documento: { select: { referencia: true } } },
        });
  const documentosImportados = new Map<string, { referencia: string; linha: string; sku: string }[]>();
  for (const d of docs) {
    for (const k of new Set([d.notaFiscal, d.documento.referencia].filter((x): x is string => x !== null))) {
      documentosImportados.set(k, [...(documentosImportados.get(k) ?? []), { referencia: d.documento.referencia, linha: d.referenciaLinha, sku: d.sku }]);
    }
  }
  const ids = linhas.map((l) => l.id);
  const resolucoes = await db.resolucaoLinhaSelecao.findMany({
    where: { escopoId, linhaSelecaoId: { in: ids }, anuladaEm: null },
    select: { linhaSelecaoId: true, paleteId: true, chaveDocumento: true, motivo: true, criadoEm: true, autor: { select: { login: true, nome: true } } },
  });
  const encaminhamentos = await db.vinculoSelecaoReserva.findMany({
    where: { escopoId, linhaSelecaoId: { in: ids } },
    select: {
      linhaSelecaoId: true,
      quantidade: true,
      reserva: { select: { codigo: true, situacao: true } },
      linhaReserva: { select: { quantidade: true, quantidadeEnviada: true } },
    },
  });
  const encaminhadas = new Map<string, { reservado: string; expedido: string; reservas: string[] }>();
  for (const e of encaminhamentos) {
    const atual = encaminhadas.get(e.linhaSelecaoId) ?? { reservado: zero, expedido: zero, reservas: [] };
    const q = e.quantidade.toFixed();
    if (e.reserva.situacao === 'ATIVA') atual.reservado = soma(atual.reservado, q);
    if (e.reserva.situacao === 'CONSUMIDA' && e.linhaReserva.quantidadeEnviada !== null) {
      // Expedido proporcional ao enviado da linha de reserva (sem contar duas vezes).
      const enviado = e.linhaReserva.quantidadeEnviada.toFixed();
      atual.expedido = soma(atual.expedido, compararQuantidades(enviado, q) < 0 ? enviado : q);
    }
    if (!atual.reservas.includes(e.reserva.codigo)) atual.reservas.push(e.reserva.codigo);
    encaminhadas.set(e.linhaSelecaoId, atual);
  }
  const demandaExterna = await db.linhaSelecao.findMany({
    where: {
      escopoId,
      selecaoId: { not: selecao.id },
      selecao: { situacao: 'REGISTRADA', referenciaPedido: { not: selecao.referenciaPedido } },
      duplicadaDeId: null,
      OR: [{ numeroDocumento: { in: numeros } }, { paleteReferencia: { in: linhas.flatMap((l) => (l.paleteReferencia === null ? [] : [l.paleteReferencia])) } }],
    },
    select: { linhaArquivo: true, paleteReferencia: true, chaveDocumento: true, numeroDocumento: true, selecao: { select: { codigo: true } } },
    take: 2_000,
  });
  return {
    parametros: selecao.parametros,
    inventario: inv === null ? null : { id: inv.id, codigo: inv.codigo, dataConferencia: inv.dataConferencia?.toISOString().slice(0, 10) ?? null, definicoes },
    inventarioLinhas: inventarioLinhas.map((l) => ({ ...l, volumes: l.volumes === null ? null : l.volumes.toFixed() })),
    vinculos: vinculos.map((v) => ({
      id: v.id,
      paleteId: v.paleteId,
      tipoDocumento: v.tipoDocumento,
      numeroDocumento: v.numeroDocumento,
      chaveDocumento: v.chaveDocumento,
      delivery: v.delivery,
      volumes: v.volumes === null ? null : v.volumes.toFixed(),
      unidade: v.unidadeVolumes,
      situacao: v.situacao,
      inventarioId: v.inventarioId,
      linhaArquivo: v.linhaInventario.linhaArquivo,
      enderecoInformado: v.linhaInventario.enderecoCanonico ?? v.linhaInventario.enderecoLido,
    })),
    paletes: new Map(paletesBase.map((p) => [p.id, p])),
    paletePorCodigo: new Map(paletesBase.map((p) => [p.codigoBusca, p])),
    material,
    expedicoes: expedicoes.map((e) => ({
      expedicaoId: e.expedicaoId,
      codigo: e.expedicao.codigo,
      em: e.expedicao.confirmadaEm,
      paleteId: e.paleteId,
      paleteCodigo: e.palete.codigo,
      segmentoId: e.segmentoId,
      sku: e.sku,
      origemTipo: e.origemTipo,
      origemReferencia: e.origemReferencia,
      quantidade: e.quantidadeEnviada.toFixed(),
      unidade: e.unidade,
    })),
    documentosImportados,
    resolucoes: new Map(
      resolucoes.map((r) => [r.linhaSelecaoId, { paleteId: r.paleteId, chaveDocumento: r.chaveDocumento, motivo: r.motivo, autor: { login: r.autor.login, name: r.autor.nome }, em: r.criadoEm }]),
    ),
    encaminhadas,
    demandaExterna: demandaExterna.map((d) => ({
      selecaoCodigo: d.selecao.codigo,
      linhaArquivo: d.linhaArquivo,
      paleteReferencia: d.paleteReferencia,
      chaveDocumento: d.chaveDocumento,
      numeroDocumento: d.numeroDocumento,
    })),
  };
}

// ---------- Regras puras ----------

/** O segmento tem a origem do documento pedido (contexto explícito; nada pela sigla). */
/** Contexto documental de uma chave "TIPO|NUMERO" (sem tipo = `null`). */
function tipoDaChave(chave: string): string | null {
  const tipo = chave.slice(0, Math.max(0, chave.indexOf('|')));
  return tipo === '' ? null : tipo;
}

function origemDoDocumento(
  m: Pick<LinhaMaterial, 'origem_tipo' | 'origem_referencia'>,
  doc: { tipo: string | null; numero: string; delivery: string | null },
  base: BaseConciliacao,
): boolean | null {
  const contexto = base.parametros.documentContext;
  if (contexto === 'OUTRA_REFERENCIA') return null;
  if (contexto === 'ORIGEM_DEVOLUCAO') {
    return m.origem_tipo === 'DEVOLUCAO' && (m.origem_referencia === doc.numero || (doc.delivery !== null && m.origem_referencia === doc.delivery));
  }
  const definicao = doc.tipo === null ? undefined : base.inventario?.definicoes.get(doc.tipo);
  if (!definicao) return null;
  return m.origem_tipo === definicao.originType && m.origem_referencia === doc.numero;
}

function materialConciliado(m: LinhaMaterial): MaterialConciliado {
  const regra = materialRegra(m);
  return {
    segmentId: m.segmento_id,
    sku: m.sku,
    description: m.descricao,
    lot: m.lote,
    originType: m.origem_tipo,
    originReference: m.origem_referencia,
    condition: m.condicao,
    unit: m.unidade,
    validated: normalizarQuantidade(m.quantidade),
    reserved: normalizarQuantidade(m.reservada),
    released: normalizarQuantidade(m.liberada),
    linked: normalizarQuantidade(m.vinculada),
    available: disponivelParaReserva(regra),
    blocked: m.linha_bloqueio !== null || m.palete_bloqueio !== null,
  };
}

/** Restrições que impedem a expedição do material (texto para a tela). */
function restricoesDe(m: LinhaMaterial): string[] {
  return pendenciasDoMaterial(materialRegra(m), null)
    .filter((p) => p.bloqueia || p.code === 'NAO_LIBERADO')
    .map((p) => p.message);
}

export interface ContextoLinha {
  linha: LinhaSelecaoBase;
  base: BaseConciliacao;
  /** Linhas da própria seleção que apontam para o mesmo palete (conflito de demanda interno). */
  internas: Map<string, { linhaArquivo: number; paleteCodigo: string }[]>;
}

/** Concilia uma solicitação contra as bases carregadas (função pura). */
export function conciliarLinha(l: LinhaSelecaoBase, base: BaseConciliacao): Omit<ResultadoConciliacao, 'demandConflicts'> & { paleteIds: string[]; segmentosElegiveis: { paleteId: string; segmentoId: string; disponivel: string }[] } {
  const motivos: string[] = [];
  const situacoes: SituacaoConciliacao[] = [];
  const candidatos: ResultadoConciliacao['candidates'] = [];
  const resolucao = base.resolucoes.get(l.id) ?? null;
  const tipo = l.tipoDocumento;
  const numero = l.numeroDocumento;
  const ativos = base.vinculos.filter((v) => v.situacao === 'ATIVO');
  let documentosAlvo: string[] = [];

  // Documento: contexto + número; número isolado com vários contextos é ambíguo.
  if (numero !== null) {
    const doNumero = [...new Set([...base.vinculos.filter((v) => v.numeroDocumento === numero).map((v) => v.chaveDocumento), ...base.inventarioLinhas.filter((x) => x.numeroDocumento === numero && x.chaveDocumento !== null).map((x) => x.chaveDocumento ?? '')])];
    if (resolucao?.chaveDocumento) documentosAlvo = [resolucao.chaveDocumento];
    else if (tipo !== null) documentosAlvo = doNumero.filter((k) => k === `${tipo}|${numero}`);
    else if (doNumero.length > 1) {
      situacoes.push('AMBIGUO');
      motivos.push(`O número ${numero} aparece em mais de um contexto documental (${doNumero.map((k) => tipoDaChave(k) ?? 'sem tipo').join(', ')}): o número isolado não identifica o documento.`);
      for (const k of doNumero) candidatos.push({ palletId: null, palletCode: null, documentKey: k, description: `${tipoDaChave(k) ?? 'sem tipo'} ${numero}` });
    } else documentosAlvo = doNumero;
    if (tipo !== null && documentosAlvo.length === 0 && doNumero.length > 0) {
      motivos.push(`O número ${numero} existe com outro contexto (${doNumero.map((k) => tipoDaChave(k) ?? 'sem tipo').join(', ')}), não como ${tipo}: números iguais de contextos diferentes não são equivalentes.`);
    }
  }

  // Paletes candidatos por abrangência.
  let paleteIds: string[] = [];
  const paletePedido = l.paleteReferencia === null ? null : (base.paletePorCodigo.get(chave(l.paleteReferencia)) ?? null);
  if (resolucao?.paleteId) paleteIds = [resolucao.paleteId];
  else if (l.abrangencia === 'PALETE') paleteIds = paletePedido ? [paletePedido.id] : [];
  else if (l.abrangencia === 'DOCUMENTO') {
    paleteIds = [...new Set(ativos.filter((v) => documentosAlvo.includes(v.chaveDocumento) && (l.delivery === null || v.delivery === null || v.delivery === l.delivery)).map((v) => v.paleteId))];
    if (paletePedido) paleteIds = paleteIds.filter((id) => id === paletePedido.id);
  } else if (l.sku !== null) {
    const doSku = base.material.filter((m) => m.sku.toUpperCase() === (l.sku ?? '').toUpperCase() && (l.lote === null || m.lote === l.lote));
    if (numero === null) {
      const porPalete = [...new Set(doSku.map((m) => m.palete_id))];
      if (porPalete.length > 0 && !situacoes.includes('AMBIGUO')) {
        situacoes.push('AMBIGUO');
        motivos.push(`SKU ${l.sku} sem documento de origem: o SKU sozinho não identifica a origem (${String(porPalete.length)} palete(s) com o produto).`);
        for (const id of porPalete) candidatos.push({ palletId: id, palletCode: base.paletes.get(id)?.codigo ?? null, documentKey: null, description: `${l.sku} no palete ${base.paletes.get(id)?.codigo ?? ''}` });
      }
    } else {
      const comOrigem = doSku.filter((m) => documentosAlvo.some((k) => origemDoDocumento(m, { tipo: tipoDaChave(k), numero, delivery: l.delivery }, base) === true));
      paleteIds = [...new Set([...comOrigem.map((m) => m.palete_id), ...ativos.filter((v) => documentosAlvo.includes(v.chaveDocumento)).map((v) => v.paleteId)])];
    }
  }
  if (situacoes.includes('AMBIGUO') && resolucao === null) paleteIds = [];

  // Alocações atuais (paletes na praça) e históricas.
  const allocations: Alocacao[] = [];
  const historicos: string[] = [];
  const segmentosElegiveis: { paleteId: string; segmentoId: string; disponivel: string }[] = [];
  let validado = zero;
  let reservado = zero;
  let disponivel = zero;
  let comparavel = l.quantidade !== null && l.unidade !== null;
  let volumes: string | null = null;
  const inventarioDoc = base.inventarioLinhas.filter((x) => (documentosAlvo.length > 0 ? x.chaveDocumento !== null && documentosAlvo.includes(x.chaveDocumento) : false) || (l.abrangencia === 'PALETE' && l.paleteReferencia !== null && x.numeroPalete !== null && chave(x.numeroPalete) === chave(l.paleteReferencia)));
  for (const id of paleteIds) {
    const p = base.paletes.get(id);
    if (!p) continue;
    if (p.arquivado || p.fluxo === 'EXPEDIDO') {
      historicos.push(`${p.codigo} (${p.arquivado ? 'arquivado' : 'expedido'})`);
      continue;
    }
    const vincs = ativos.filter((v) => v.paleteId === id && (l.abrangencia === 'PALETE' || documentosAlvo.includes(v.chaveDocumento)));
    const informada = inventarioDoc.find((x) => x.paleteId === id) ?? base.inventarioLinhas.find((x) => x.paleteId === id) ?? null;
    const enderecoInformado = informada ? (informada.enderecoCanonico ?? informada.enderecoLido) : (vincs[0]?.enderecoInformado ?? null);
    // Documentos atuais do palete que não estavam no inventário de referência (palete inteiro).
    const docsInventario = new Set(base.inventarioLinhas.filter((x) => x.paleteId === id && x.chaveDocumento !== null).map((x) => x.chaveDocumento ?? ''));
    const depois = l.abrangencia === 'PALETE' && base.inventario !== null ? [...new Set(ativos.filter((v) => v.paleteId === id && !docsInventario.has(v.chaveDocumento)).map((v) => v.chaveDocumento))] : [];
    const materiais = base.material.filter((m) => m.palete_id === id);
    const relevantes = materiais.filter((m) => {
      if (l.abrangencia === 'LINHA_PRODUTO') {
        if (m.sku.toUpperCase() !== (l.sku ?? '').toUpperCase() || (l.lote !== null && m.lote !== l.lote)) return false;
        return numero === null ? resolucao !== null : documentosAlvo.some((k) => origemDoDocumento(m, { tipo: tipoDaChave(k), numero, delivery: l.delivery }, base) === true);
      }
      if (l.abrangencia === 'DOCUMENTO') return numero !== null && documentosAlvo.some((k) => origemDoDocumento(m, { tipo: tipoDaChave(k), numero, delivery: l.delivery }, base) === true);
      // Palete inteiro: só o material das NFs que constavam do inventário (nada acrescentado depois entra sozinho).
      if (base.inventario === null) return false;
      return [...docsInventario].some((k) => {
        const n = k.slice(k.indexOf('|') + 1);
        return origemDoDocumento(m, { tipo: tipoDaChave(k), numero: n, delivery: null }, base) === true;
      });
    });
    const restricoes = [...new Set(relevantes.flatMap(restricoesDe))];
    if (p.bloqueio !== null && !restricoes.some((r) => r.startsWith('Palete'))) restricoes.push(`Palete ${p.codigo} bloqueado: ${p.bloqueio}`);
    for (const m of relevantes) {
      const regra = materialRegra(m);
      const disp = disponivelParaReserva(regra);
      const bloqueia = pendenciasDoMaterial(regra, null).some((x) => x.bloqueia);
      if (comparavel && m.unidade === l.unidade) {
        validado = soma(validado, m.quantidade);
        reservado = soma(reservado, m.reservada);
        if (!bloqueia) disponivel = soma(disponivel, disp);
      } else if (comparavel) {
        comparavel = false;
        motivos.push(`O material está em ${m.unidade} e a solicitação em ${l.unidade ?? '?'}: sem fator aprovado, as quantidades não são comparadas.`);
      }
      if (!bloqueia && positivo(disp)) segmentosElegiveis.push({ paleteId: id, segmentoId: m.segmento_id, disponivel: disp });
    }
    for (const v of vincs) if (v.volumes !== null) volumes = volumes === null ? v.volumes : soma(volumes, v.volumes);
    allocations.push({
      pallet: { id: p.id, code: p.codigo, version: p.versao, countState: p.conferencia, releaseState: p.liberacao, flowState: p.fluxo, blocked: p.bloqueio !== null },
      currentPosition: p.posicaoId === null || p.posicaoCodigo === null ? null : { id: p.posicaoId, code: p.posicaoCodigo, address: p.endereco },
      informedAddress: enderecoInformado,
      informedSource: informada && base.inventario ? { inventoryCode: base.inventario.codigo, row: informada.linhaArquivo, countDate: base.inventario.dataConferencia } : null,
      addressDiffers: enderecoInformado !== null && (p.endereco === null || p.endereco !== enderecoInformado),
      documents: vincs.map((v) => ({ documentKey: v.chaveDocumento, documentType: v.tipoDocumento, documentNumber: v.numeroDocumento, delivery: v.delivery, volumes: v.volumes, unit: v.unidade })),
      documentsAddedAfter: depois,
      material: relevantes.map(materialConciliado),
      restrictions: restricoes,
      eligibleForShipping: relevantes.some((m) => !pendenciasDoMaterial(materialRegra(m), null).some((x) => x.bloqueia) && positivo(disponivelParaReserva(materialRegra(m)))),
    });
  }

  // Situação principal.
  const comPosicao = allocations.filter((a) => a.currentPosition !== null);
  if (!situacoes.includes('AMBIGUO')) {
    if (allocations.length > 0) {
      if (comPosicao.length === 0) {
        situacoes.push('PALETE_SEM_ENDERECO');
        motivos.push('Palete identificado sem posição registrada: a localização atual está pendente (nenhuma posição é presumida).');
      } else {
        if (allocations.length > 1) motivos.push(`Material em ${String(allocations.length)} paletes (localizações distintas, sem duplicar quantidade).`);
        if (comPosicao.length < allocations.length) motivos.push(`${String(allocations.length - comPosicao.length)} palete(s) sem posição registrada.`);
        const restritos = allocations.filter((a) => a.restrictions.length > 0 || a.pallet.blocked);
        situacoes.push(restritos.length > 0 ? 'LOCALIZADO_COM_RESTRICAO' : 'LOCALIZADO');
        for (const a of restritos) motivos.push(`${a.pallet.code}: ${a.restrictions.join(' · ') || 'palete bloqueado'}`);
      }
      for (const a of allocations) if (a.addressDiffers && a.informedAddress !== null) motivos.push(`${a.pallet.code}: endereço informado no inventário ${a.informedAddress}; atual ${a.currentPosition?.address ?? a.currentPosition?.code ?? 'sem posição'} (o atual prevalece).`);
      for (const a of allocations) if (a.documentsAddedAfter.length > 0) motivos.push(`${a.pallet.code}: documentos registrados depois do inventário (${a.documentsAddedAfter.join(', ')}) não entram automaticamente.`);
    } else {
      const historicoInv = inventarioDoc.filter((x) => x.enderecoLivre || !x.aplicada);
      const encerrados = base.vinculos.filter((v) => v.situacao === 'ENCERRADO' && documentosAlvo.includes(v.chaveDocumento));
      const importados = numero === null ? [] : [...(base.documentosImportados.get(numero) ?? []), ...(l.delivery === null ? [] : (base.documentosImportados.get(l.delivery) ?? []))];
      if (l.abrangencia === 'PALETE' && paletePedido !== null && paletePedido.posicaoId === null && !paletePedido.arquivado && paletePedido.fluxo !== 'EXPEDIDO') {
        situacoes.push('PALETE_SEM_ENDERECO');
        motivos.push(`Palete ${paletePedido.codigo} sem posição registrada.`);
      } else if (historicos.length > 0 || encerrados.length > 0 || historicoInv.some((x) => x.enderecoLivre)) {
        situacoes.push('APENAS_HISTORICO');
        motivos.push(
          `Só há referência histórica${historicos.length > 0 ? ` (palete ${historicos.join(', ')})` : ''}${historicoInv.some((x) => x.enderecoLivre) ? ` (endereço livre no inventário: ${historicoInv.filter((x) => x.enderecoLivre).map((x) => x.enderecoCanonico ?? x.enderecoLido ?? '').join(', ')})` : ''}${encerrados.length > 0 ? ' (vínculo encerrado por versão posterior)' : ''}: o endereço antigo não é apresentado como atual.`,
        );
      } else if (inventarioDoc.length > 0 || importados.length > 0) {
        situacoes.push('DOCUMENTO_SEM_PALETE');
        motivos.push(
          inventarioDoc.length > 0
            ? `${tipo ?? 'Documento'} ${numero ?? ''} consta do ${base.inventario?.codigo ?? 'inventário'} (linha ${inventarioDoc.map((x) => String(x.linhaArquivo)).join(', ')}) sem vínculo aplicado a palete: pendência a resolver na importação.`
            : `${numero ?? ''} consta de documento de devolução importado (${importados.map((d) => `${d.referencia} linha ${d.linha}`).join(', ')}) sem alocação física registrada.`,
        );
      } else if (l.abrangencia === 'PALETE' && l.paleteReferencia !== null && base.inventarioLinhas.some((x) => x.numeroPalete !== null && chave(x.numeroPalete) === chave(l.paleteReferencia ?? ''))) {
        situacoes.push('INFORMACAO_PENDENTE');
        motivos.push(`O palete ${l.paleteReferencia} consta do inventário sem cadastro aplicado: resolva a pendência da importação.`);
      } else {
        situacoes.push('NAO_ENCONTRADO');
        motivos.push(`Nenhum registro correspondente nas bases consultadas (${base.inventario ? `${base.inventario.codigo}, ` : ''}vínculos atuais, saldo validado e documentos importados).`);
      }
    }
  }

  // Quantidade e base de comparação.
  const encaminhada = base.encaminhadas.get(l.id) ?? { reservado: zero, expedido: zero, reservas: [] };
  let faltante: string | null = null;
  let basis: string;
  if (l.quantidade !== null && l.unidade !== null) {
    if (comparavel && allocations.some((a) => a.material.length > 0)) {
      const identificado = validado;
      if (compararQuantidades(l.quantidade, identificado) > 0) {
        faltante = normalizarQuantidade(subtrairQuantidades(l.quantidade, identificado));
        situacoes.push('QUANTIDADE_NAO_ATENDIDA');
        motivos.push(`Solicitado ${normalizarQuantidade(l.quantidade)} ${l.unidade}; identificado ${identificado} ${l.unidade} no saldo validado: ${faltante} ainda não atendido pelos registros (não é perda nem claim).`);
      }
      basis = `saldo validado em ${l.unidade} (palete × segmento com a origem pedida)`;
    } else {
      comparavel = false;
      if (allocations.length > 0) {
        situacoes.push('INFORMACAO_PENDENTE');
        motivos.push('A quantidade solicitada não pode ser comparada: não há saldo validado por produto na unidade pedida para esta origem (o inventário informa volumes, não unidades).');
      }
      basis = 'sem base comparável (volumes informados não são unidades de produto)';
    }
  } else {
    comparavel = false;
    basis = l.abrangencia === 'DOCUMENTO' && base.parametros.documentWithoutQuantity === 'TODO_MATERIAL_DO_INVENTARIO' ? 'todo o material da NF que constava no inventário' : 'quantidade não informada';
    if (l.abrangencia === 'LINHA_PRODUTO' && allocations.length > 0) {
      situacoes.push('INFORMACAO_PENDENTE');
      motivos.push('Linha/produto sem quantidade: nada é presumido (nem zero, nem a quantidade fiscal).');
    }
    if (l.abrangencia === 'DOCUMENTO' && base.parametros.documentWithoutQuantity === 'PENDENTE' && allocations.length > 0) {
      situacoes.push('INFORMACAO_PENDENTE');
      motivos.push('NF sem quantidade e sem configuração de "todo o material": a quantidade fica pendente.');
    }
  }
  if (allocations.length > 0 && segmentosElegiveis.length === 0 && !situacoes.includes('INFORMACAO_PENDENTE') && !situacoes.includes('LOCALIZADO_COM_RESTRICAO')) {
    const semMaterial = allocations.every((a) => a.material.length === 0);
    if (semMaterial) {
      situacoes.push('INFORMACAO_PENDENTE');
      motivos.push(
        base.parametros.documentContext === 'DOCUMENTO_INVENTARIO' && tipo !== null && !base.inventario?.definicoes.has(tipo)
          ? `Localizado, mas sem saldo validado relacionado: o tipo ${tipo} não tem definição operacional para relacionar a NF à origem dos segmentos.`
          : 'Localizado, mas sem saldo validado por produto desta origem: conferência por SKU pendente antes de reservar.',
      );
    }
  }

  const expedidos = base.expedicoes.filter(
    (e) =>
      (l.abrangencia === 'PALETE' ? paleteIds.includes(e.paleteId) : numero !== null && documentosAlvo.some((k) => origemDoDocumento({ origem_tipo: e.origemTipo as LinhaMaterial['origem_tipo'], origem_referencia: e.origemReferencia }, { tipo: tipoDaChave(k), numero, delivery: l.delivery }, base) === true)) &&
      (l.sku === null || e.sku.toUpperCase() === l.sku.toUpperCase()),
  );
  if (expedidos.length > 0) motivos.push(`Há saída já confirmada deste material (${[...new Set(expedidos.map((e) => e.codigo))].join(', ')}): mostrada à parte, não volta como disponível.`);

  const ordem: readonly SituacaoConciliacao[] = ['AMBIGUO', 'NAO_ENCONTRADO', 'DOCUMENTO_SEM_PALETE', 'APENAS_HISTORICO', 'PALETE_SEM_ENDERECO', 'QUANTIDADE_NAO_ATENDIDA', 'LOCALIZADO_COM_RESTRICAO', 'INFORMACAO_PENDENTE', 'LOCALIZADO'];
  const unicas = [...new Set(situacoes)].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
  const principal = unicas[0] ?? 'INFORMACAO_PENDENTE';
  const elegivel = segmentosElegiveis.length > 0 && !unicas.includes('AMBIGUO') && !(l.abrangencia === 'LINHA_PRODUTO' && l.quantidade === null) && !(l.abrangencia === 'DOCUMENTO' && l.quantidade === null && base.parametros.documentWithoutQuantity === 'PENDENTE');
  return {
    lineId: l.id,
    row: l.linhaArquivo,
    lineRef: l.referenciaLinha,
    scope: l.abrangencia,
    scopeRule: l.regraAbrangencia,
    request: {
      palletRef: l.paleteReferencia,
      documentType: l.tipoDocumento,
      documentNumber: l.numeroDocumento,
      delivery: l.delivery,
      inventoryRef: l.referenciaInventario,
      windowRef: l.janelaReferencia,
      sku: l.sku,
      lot: l.lote,
      quantity: l.quantidade,
      unit: l.unidade,
      notes: l.observacao,
    },
    situation: principal,
    alsoSituations: unicas.slice(1),
    reasons: motivos,
    nextStep: PROXIMO_PASSO_SITUACAO[principal],
    allocations,
    candidates: candidatos,
    resolution: resolucao
      ? {
          palletId: resolucao.paleteId,
          palletCode: resolucao.paleteId === null ? null : (base.paletes.get(resolucao.paleteId)?.codigo ?? null),
          documentKey: resolucao.chaveDocumento,
          reason: resolucao.motivo,
          by: resolucao.autor,
          at: resolucao.em.toISOString(),
        }
      : null,
    quantities: {
      requested: l.quantidade,
      unit: l.unidade,
      informedVolumes: volumes,
      validated: comparavel ? validado : null,
      reserved: comparavel ? reservado : null,
      available: comparavel ? disponivel : null,
      unmet: faltante,
      comparable: comparavel,
      basis,
    },
    shipped: expedidos.map((e) => ({ expeditionId: e.expedicaoId, code: e.codigo, at: e.em.toISOString(), palletCode: e.paleteCodigo, sku: e.sku, quantity: e.quantidade, unit: e.unidade })),
    forwarded: { reservedActive: encaminhada.reservado, shipped: encaminhada.expedido, reservations: encaminhada.reservas },
    duplicateOfRow: l.duplicadaDeLinha,
    eligible: elegivel,
    paleteIds: allocations.map((a) => a.pallet.id),
    segmentosElegiveis,
  };
}
