/**
 * Inventários de referência (complemento "seleção do cliente"): consulta da
 * fotografia, linhas aplicadas/pendentes/históricas e reconhecimento da
 * conferência externa. As notas de um palete ficam em paletes/notas.ts.
 *
 * Reconhecer a conferência externa registra a evidência (referência, data,
 * fonte, responsável) e marca os vínculos documentais desse inventário como
 * conferidos no nível que o arquivo comprova (NF, palete, endereço, volumes).
 * Não altera saldo validado, estado de conferência por SKU, liberação,
 * reservas, claims nem saídas.
 */
import {
  ROTULOS_CAUSA_REVISAO,
  normalizarQuantidade,
  type Escopo,
  type FiltroInventarios,
  type FiltroLinhasInventario,
  type InventarioResumo,
  type LinhaInventario,
  type PaginaInventarios,
  type PaginaLinhasInventario,
  type PendenciasInventario,
  type ReconhecerConferenciaExterna,
  type ReconhecerConferenciaExternaSchema,
  type SignificadoNumeroPalete,
} from '@praca-reversa/contracts';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { paletesPorEndereco } from '../importacao/linhas-vigentes.js';

type Db = Banco | Transacao;
type DadosConferencia = z.output<typeof ReconhecerConferenciaExternaSchema>;

const pessoa = (u: { login: string; nome: string } | null) => (u ? { login: u.login, name: u.nome } : null);
const dia = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));

const inventarioSelect = {
  id: true,
  codigo: true,
  descricao: true,
  origem: true,
  situacao: true,
  referenciaConferencia: true,
  dataConferencia: true,
  fonteConferencia: true,
  nomeArquivo: true,
  hashArquivo: true,
  aba: true,
  loteImportacaoId: true,
  significadoNumeroPalete: true,
  convencoes: true,
  totalLinhas: true,
  aplicadas: true,
  pendentes: true,
  historicas: true,
  conferenciaExternaSituacao: true,
  conferenciaExternaReferencia: true,
  conferenciaExternaData: true,
  conferenciaExternaFonte: true,
  conferenciaExternaObservacao: true,
  conferenciaExternaEm: true,
  conferenciaExternaPor: { select: { login: true, nome: true } },
  substituiId: true,
  substituidoPor: { select: { id: true } },
  criadoEm: true,
  criadoPor: { select: { login: true, nome: true } },
  versao: true,
} as const satisfies Prisma.InventarioReferenciaSelect;

type InventarioLido = Prisma.InventarioReferenciaGetPayload<{ select: typeof inventarioSelect }>;

/** Valores de `extras` em texto (a carga de 20/10 guarda listas e objetos: etiquetas, conferência, pendências). */
function extrasEmTexto(extras: unknown): Record<string, string | null> {
  if (typeof extras !== 'object' || extras === null) return {};
  const texto = (v: unknown): string | null =>
    v === null || v === undefined
      ? null
      : typeof v === 'string'
        ? v
        : typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : Array.isArray(v)
            ? v.map((x) => texto(x) ?? '').join(', ')
            : Object.values(v as Record<string, unknown>).flatMap((x) => {
                const t = texto(x);
                return t === null ? [] : [t];
              }).join(' · ');
  return Object.fromEntries(Object.entries(extras as Record<string, unknown>).map(([k, v]) => [k, texto(v)]));
}

function resumo(i: InventarioLido): InventarioResumo {
  const conv = typeof i.convencoes === 'object' && i.convencoes !== null ? (i.convencoes as Record<string, unknown>) : {};
  return {
    id: i.id,
    code: i.codigo,
    description: i.descricao,
    origin: i.origem === 'APLICACAO' ? 'APLICACAO' : 'IMPORTADO',
    state: i.situacao,
    countReference: i.referenciaConferencia,
    countDate: dia(i.dataConferencia),
    countSource: i.fonteConferencia,
    fileName: i.nomeArquivo,
    fileHash: i.hashArquivo,
    sheet: i.aba,
    batchId: i.loteImportacaoId,
    palletNumberMeaning: i.significadoNumeroPalete as SignificadoNumeroPalete,
    inValidation: conv.emValidacao === true,
    baseDate: typeof conv.dataBase === 'string' ? conv.dataBase : null,
    totals: { lines: i.totalLinhas, applied: i.aplicadas, pending: i.pendentes, historical: i.historicas },
    externalCount: {
      state: i.conferenciaExternaSituacao === 'RECONHECIDA' ? 'RECONHECIDA' : 'NAO_REGISTRADA',
      reference: i.conferenciaExternaReferencia,
      date: dia(i.conferenciaExternaData),
      source: i.conferenciaExternaFonte,
      notes: i.conferenciaExternaObservacao,
      by: pessoa(i.conferenciaExternaPor),
      at: i.conferenciaExternaEm?.toISOString() ?? null,
    },
    replacesId: i.substituiId,
    replacedById: i.substituidoPor?.id ?? null,
    createdAt: i.criadoEm.toISOString(),
    createdBy: pessoa(i.criadoPor),
    version: i.versao,
  };
}

async function lerBruto(db: Db, escopoId: string, id: string): Promise<InventarioLido> {
  // Bipagens de palete (BIP-…) ficam no histórico de importações e nas notas do palete, não como inventário de referência.
  const i = await db.inventarioReferencia.findFirst({ where: { id, escopoId, origem: { not: 'BIPAGEM' } }, select: inventarioSelect });
  if (!i) throw naoEncontrado('Inventário de referência não encontrado neste escopo.');
  return i;
}

export async function listarInventarios(db: Db, escopoId: string, filtro: FiltroInventarios): Promise<PaginaInventarios> {
  const [total, itens] = await Promise.all([
    db.inventarioReferencia.count({ where: { escopoId, origem: { not: 'BIPAGEM' } } }),
    db.inventarioReferencia.findMany({ where: { escopoId, origem: { not: 'BIPAGEM' } }, select: inventarioSelect, orderBy: [{ criadoEm: 'desc' }, { id: 'asc' }], skip: (filtro.pagina - 1) * filtro.tamanho, take: filtro.tamanho }),
  ]);
  return { items: itens.map(resumo), total, page: filtro.pagina, pageSize: filtro.tamanho };
}

export async function lerInventario(db: Db, escopoId: string, id: string): Promise<InventarioResumo> {
  return resumo(await lerBruto(db, escopoId, id));
}

export async function linhasDoInventario(db: Db, escopoId: string, id: string, filtro: FiltroLinhasInventario): Promise<PaginaLinhasInventario> {
  await lerBruto(db, escopoId, id);
  const termo = (filtro.texto ?? '').trim();
  const where: Prisma.LinhaInventarioWhereInput = {
    escopoId,
    inventarioId: id,
    ...(filtro.situacao === 'APLICADAS' ? { aplicada: true } : filtro.situacao === 'PENDENTES' ? { aplicada: false, acao: 'REQUER_RESOLUCAO' } : filtro.situacao === 'HISTORICAS' ? { acao: 'REFERENCIA_HISTORICA' } : {}),
    ...(termo === ''
      ? {}
      : {
          OR: [
            { numeroDocumento: { contains: termo, mode: 'insensitive' } },
            { numeroPalete: { contains: termo, mode: 'insensitive' } },
            { enderecoCanonico: { contains: termo, mode: 'insensitive' } },
            { delivery: { contains: termo, mode: 'insensitive' } },
          ],
        }),
  };
  const [total, linhas] = await Promise.all([
    db.linhaInventario.count({ where }),
    db.linhaInventario.findMany({
      where,
      orderBy: { linhaArquivo: 'asc' },
      skip: (filtro.pagina - 1) * filtro.tamanho,
      take: filtro.tamanho,
      include: { palete: { select: { id: true, codigo: true } }, posicao: { select: { id: true, codigo: true } } },
    }),
  ]);
  // Já importada ou repetida agrupada gravada sem palete (versão anterior do carregador): mostra o palete do endereço.
  const semPalete = linhas.filter((l) => l.palete === null && (l.acao === 'JA_IMPORTADO' || l.acao === 'DUPLICADA_ARQUIVO') && !l.enderecoLivre && l.enderecoCanonico !== null);
  const porEndereco = await paletesPorEndereco(db, escopoId, semPalete.flatMap((l) => (l.enderecoCanonico === null ? [] : [l.enderecoCanonico])));
  const codigos = new Map(
    porEndereco.size === 0 ? [] : (await db.palete.findMany({ where: { escopoId, id: { in: [...new Set(porEndereco.values())] } }, select: { id: true, codigo: true } })).map((p) => [p.id, p.codigo]),
  );
  const paleteDaLinha = (l: (typeof linhas)[number]): LinhaInventario['pallet'] => {
    if (l.palete) return { id: l.palete.id, code: l.palete.codigo };
    if (!semPalete.includes(l) || l.enderecoCanonico === null) return null;
    const id = porEndereco.get(l.enderecoCanonico);
    const codigo = id === undefined ? undefined : codigos.get(id);
    return id === undefined || codigo === undefined ? null : { id, code: codigo };
  };
  return {
    items: linhas.map(
      (l): LinhaInventario => ({
        id: l.id,
        row: l.linhaArquivo,
        batchId: l.loteImportacaoId,
        delivery: l.delivery,
        documentType: l.tipoDocumento,
        documentNumber: l.numeroDocumento,
        volumes: l.volumes === null ? null : normalizarQuantidade(l.volumes.toFixed()),
        volumesRead: l.volumesLido,
        sender: l.remetente,
        scheduleMonth: l.mesAgenda,
        windowRef: l.janelaReferencia,
        addressRead: l.enderecoLido,
        address: l.enderecoCanonico,
        freeAddress: l.enderecoLivre,
        palletNumber: l.numeroPalete,
        documentation: l.documentacao,
        palletFull: l.palletFull,
        category: l.categoria,
        extras: extrasEmTexto(l.extras),
        pallet: paleteDaLinha(l),
        position: l.posicao ? { id: l.posicao.id, code: l.posicao.codigo } : null,
        action: l.acao,
        applied: l.aplicada,
        reasons: l.motivos as LinhaInventario['reasons'],
        resolvedById: l.resolvidaPorId,
      }),
    ),
    total,
    page: filtro.pagina,
    pageSize: filtro.tamanho,
  };
}

/** Reconhece a conferência externa do inventário (evidência separada da importação documental). */
export async function reconhecerConferenciaExterna(
  tx: Transacao,
  escopo: Escopo,
  id: string,
  dados: DadosConferencia | ReconhecerConferenciaExterna,
  autor: { usuarioId: string; requestId: string },
  agora: Date,
): Promise<InventarioResumo> {
  const [atual] = await tx.$queryRaw<{ versao: number; situacao: string; codigo: string; conferencia: string }[]>`
    SELECT versao, situacao::text AS situacao, codigo, conferencia_externa_situacao AS conferencia
      FROM inventario_referencia WHERE id = ${id}::uuid AND escopo_id = ${escopo.id}::uuid FOR UPDATE`;
  if (!atual) throw naoEncontrado('Inventário de referência não encontrado neste escopo.');
  if (atual.versao !== dados.expectedVersion) throw new ErroHttp(409, 'CONFLITO_VERSAO', `O ${atual.codigo} mudou desde a sua revisão. Recarregue e confira.`);
  if (atual.conferencia === 'RECONHECIDA') throw new ErroHttp(409, 'CONFLITO', `A conferência externa do ${atual.codigo} já foi reconhecida.`);
  await tx.inventarioReferencia.update({
    where: { id },
    data: {
      conferenciaExternaSituacao: 'RECONHECIDA',
      conferenciaExternaReferencia: dados.reference,
      conferenciaExternaData: dados.date === null ? null : new Date(`${dados.date}T00:00:00.000Z`),
      conferenciaExternaFonte: dados.source,
      conferenciaExternaObservacao: dados.notes ?? null,
      conferenciaExternaPorId: autor.usuarioId,
      conferenciaExternaEm: agora,
      versao: { increment: 1 },
    },
  });
  const r = await tx.vinculoDocumentoPalete.updateMany({ where: { escopoId: escopo.id, inventarioId: id, situacao: 'ATIVO' }, data: { conferidoExternamente: true } });
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_EXTERNA_RECONHECIDA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'INVENTARIO',
    alvoId: id,
    detalhes: { codigo: atual.codigo, referencia: dados.reference, data: dados.date, fonte: dados.source, vinculos: r.count, saldoValidadoAlterado: false },
    requestId: autor.requestId,
  });
  return lerInventario(tx, escopo.id, id);
}

/**
 * Pendências do inventário agrupadas por causa → endereço/N° Pallet: uma
 * decisão sobre um grupo ou endereço pode resolver muitas linhas. Causa =
 * motivos de revisão (REVISAO_*); sem eles, o primeiro motivo da linha.
 */
export async function pendenciasDoInventario(db: Db, escopoId: string, id: string): Promise<PendenciasInventario> {
  await lerBruto(db, escopoId, id);
  const linhas = await db.linhaInventario.findMany({
    where: { escopoId, inventarioId: id, aplicada: false, acao: 'REQUER_RESOLUCAO' },
    select: { linhaArquivo: true, enderecoCanonico: true, enderecoLido: true, numeroPalete: true, motivos: true },
    orderBy: { linhaArquivo: 'asc' },
  });
  interface Lugar {
    address: string | null;
    palletNumbers: Set<string>;
    rows: number[];
  }
  const grupos = new Map<string, { description: string; rows: Set<number>; places: Map<string, Lugar> }>();
  for (const l of linhas) {
    const motivos = Array.isArray(l.motivos) ? (l.motivos as { code?: unknown; message?: unknown }[]) : [];
    const lidos = motivos.flatMap((m) => (typeof m.code === 'string' && typeof m.message === 'string' ? [{ code: m.code, message: m.message }] : []));
    const revisao = lidos.filter((m) => m.code.startsWith('REVISAO_'));
    const causas = revisao.length > 0 ? revisao : lidos.slice(0, 1);
    const endereco = l.enderecoCanonico ?? l.enderecoLido;
    for (const c of causas.length > 0 ? causas : [{ code: 'SEM_MOTIVO', message: 'Requer resolução (motivo não registrado).' }]) {
      const rotulo = c.code.startsWith('REVISAO_') ? ROTULOS_CAUSA_REVISAO[c.code.slice('REVISAO_'.length).toLowerCase()] : undefined;
      const g = grupos.get(c.code) ?? { description: rotulo ?? c.message, rows: new Set<number>(), places: new Map<string, Lugar>() };
      g.rows.add(l.linhaArquivo);
      const lugar = g.places.get(endereco ?? '') ?? { address: endereco, palletNumbers: new Set<string>(), rows: [] };
      if (l.numeroPalete !== null) lugar.palletNumbers.add(l.numeroPalete);
      lugar.rows.push(l.linhaArquivo);
      g.places.set(endereco ?? '', lugar);
      grupos.set(c.code, g);
    }
  }
  const natural = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });
  return {
    inventoryId: id,
    totalLines: linhas.length,
    groups: [...grupos.entries()]
      .map(([cause, g]) => ({
        cause,
        description: g.description,
        lines: g.rows.size,
        places: [...g.places.values()]
          .sort((a, b) => (a.address === null ? 1 : b.address === null ? -1 : natural(a.address, b.address)))
          .map((x) => ({ address: x.address, palletNumbers: [...x.palletNumbers].sort(natural), rows: x.rows })),
      }))
      .sort((a, b) => b.lines - a.lines || a.cause.localeCompare(b.cause)),
  };
}
