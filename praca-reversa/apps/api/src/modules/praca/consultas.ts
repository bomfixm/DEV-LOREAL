import type { Escopo, FiltroPaletes, ItemDeclarado, ListaPaletes, PaleteDetalhe, PaleteResumo, Praca } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';
import { conferenciaDoPalete, conferenciasAtivas } from '../conferencia/leitura.js';
import { lerLayoutAtivo } from '../layout/leitura.js';
import { enderecosInformados } from '../paletes/notas.js';

const selecaoResumo = {
  id: true,
  codigo: true,
  posicaoId: true,
  estadoConferencia: true,
  estadoLiberacao: true,
  estadoFluxo: true,
  motivoPendencia: true,
  posicao: { select: { codigo: true } },
} as const;

type PaleteComPosicao = Prisma.PaleteGetPayload<{ select: typeof selecaoResumo }>;

type Informados = ReadonlyMap<string, { endereco: string }>;

/** Endereço informado no inventário só vale para palete sem posição (a posição registrada prevalece). */
async function informadosDe(db: Banco | Transacao, escopoId: string, paletes: readonly { id: string; posicaoId: string | null }[]): Promise<Informados> {
  return enderecosInformados(db, escopoId, paletes.filter((p) => p.posicaoId === null).map((p) => p.id));
}

function resumo(p: PaleteComPosicao, ativas: ReadonlyMap<string, string>, informados: Informados): PaleteResumo {
  return {
    id: p.id,
    code: p.codigo,
    positionId: p.posicaoId,
    positionCode: p.posicao?.codigo ?? null,
    countState: p.estadoConferencia,
    releaseState: p.estadoLiberacao,
    flowState: p.estadoFluxo,
    pendingReason: p.motivoPendencia,
    activeCountId: ativas.get(p.id) ?? null,
    informedAddress: p.posicaoId === null ? (informados.get(p.id)?.endereco ?? null) : null,
  };
}

/**
 * Layout ativo e ocupação resumida do escopo; conteúdo detalhado fica para a
 * seleção. Paletes arquivados não ocupam posição e ficam fora do mapa e da
 * lista (continuam acessíveis pelo ID).
 */
export async function consultarPraca(db: Banco, escopo: Escopo, agora: Date): Promise<Praca> {
  const [layout, paletes, ativas] = await Promise.all([
    lerLayoutAtivo(db, escopo.id),
    db.palete.findMany({ where: { escopoId: escopo.id, arquivadoEm: null }, select: selecaoResumo, orderBy: { codigo: 'asc' } }),
    conferenciasAtivas(db, escopo.id),
  ]);
  const informados = await informadosDe(db, escopo.id, paletes);
  return { scope: escopo, layout, pallets: paletes.map((p) => resumo(p, ativas, informados)), consultedAt: agora.toISOString() };
}

interface LinhaDeclarada {
  produtoId: string | null;
  sku: string | null;
  descricao: string;
  lote: string | null;
  origemTipo: ItemDeclarado['originType'];
  origemReferencia: string | null;
  quantidade: Prisma.Decimal;
  unidadeMedida: string;
  condicao: ItemDeclarado['condition'];
}

function declarado(l: LinhaDeclarada): ItemDeclarado {
  return {
    productId: l.produtoId,
    sku: l.sku,
    description: l.descricao,
    lot: l.lote,
    originType: l.origemTipo,
    originReference: l.origemReferencia,
    quantity: l.quantidade.toFixed(),
    unit: l.unidadeMedida,
    condition: l.condicao,
  };
}

const usuarioResumo = { select: { login: true, nome: true } } as const;
const pessoa = (u: { login: string; nome: string } | null) => (u ? { login: u.login, name: u.nome } : null);

/**
 * Detalhe restrito ao escopo ativo. Palete de outro escopo responde como
 * inexistente (`null`), sem revelar que existe.
 */
export async function consultarPalete(db: Banco | Transacao, escopo: Escopo, id: string): Promise<PaleteDetalhe | null> {
  const ordem = { orderBy: { ordem: 'asc' as const } };
  const p = await db.palete.findFirst({
    where: { id, escopoId: escopo.id },
    select: {
      ...selecaoResumo,
      atualizadoEm: true,
      criadoEm: true,
      versao: true,
      observacoes: true,
      origemCodigo: true,
      arquivadoEm: true,
      motivoArquivamento: true,
      criadoPor: usuarioResumo,
      arquivadoPor: usuarioResumo,
      bloqueioMotivo: true,
      bloqueadoEm: true,
      bloqueadoPor: usuarioResumo,
      declarados: ordem,
    },
  });
  if (!p) return null;
  // Saldo validado só existe após reconciliação; contagens observadas vêm das sessões concluídas.
  const conferencia = await conferenciaDoPalete(db, escopo.id, id);
  return {
    ...resumo(p, new Map(conferencia.activeCountId ? [[id, conferencia.activeCountId]] : []), await informadosDe(db, escopo.id, [p])),
    ...conferencia,
    declaredItems: p.declarados.length === 0 ? null : p.declarados.map(declarado),
    dataSource: escopo.demo ? 'DEMONSTRACAO_FICTICIA' : 'OPERACAO',
    updatedAt: p.atualizadoEm.toISOString(),
    version: p.versao,
    notes: p.observacoes,
    createdAt: p.criadoEm.toISOString(),
    createdBy: pessoa(p.criadoPor),
    codeOrigin: p.origemCodigo,
    archived:
      p.arquivadoEm === null
        ? null
        : { at: p.arquivadoEm.toISOString(), reason: p.motivoArquivamento ?? 'Sem motivo registrado', by: pessoa(p.arquivadoPor) },
    palletBlock:
      p.bloqueioMotivo === null || p.bloqueadoEm === null ? null : { reason: p.bloqueioMotivo, at: p.bloqueadoEm.toISOString(), by: pessoa(p.bloqueadoPor) },
  };
}

/** Minúsculas, sem acentos e sem separadores: "A-01" e "a01" se equivalem. */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Filtro da lista por código do palete, da posição ou endereço (real confirmado ou informado no inventário) e situação de conferência, com limite. */
export async function filtrarPaletes(db: Banco, escopo: Escopo, filtro: FiltroPaletes): Promise<ListaPaletes> {
  const termo = normalizarBusca(filtro.texto ?? '');
  const conferencia = filtro.conferencia ?? null;
  const linhas = await db.$queryRaw<{ id: string; total: bigint }[]>`
    SELECT p.id::text AS id, count(*) OVER () AS total
    FROM palete p
    LEFT JOIN posicao pos ON pos.id = p.posicao_id
    WHERE p.escopo_id = ${escopo.id}::uuid
      AND p.arquivado_em IS NULL
      AND (${conferencia}::text IS NULL OR p.estado_conferencia::text = ${conferencia}::text)
      AND (
        ${termo}::text = ''
        OR regexp_replace(lower(p.codigo), '[^a-z0-9]', '', 'g') LIKE '%' || ${termo}::text || '%'
        OR regexp_replace(lower(coalesce(pos.codigo, '')), '[^a-z0-9]', '', 'g') LIKE '%' || ${termo}::text || '%'
        OR EXISTS (SELECT 1 FROM endereco_posicao ep
                    WHERE ep.posicao_id = p.posicao_id AND ep.situacao = 'CONFIRMADO'
                      AND regexp_replace(lower(ep.endereco), '[^a-z0-9]', '', 'g') LIKE '%' || ${termo}::text || '%')
        OR (p.posicao_id IS NULL AND EXISTS (
              SELECT 1 FROM linha_inventario li JOIN inventario_referencia i ON i.id = li.inventario_id
               WHERE li.palete_id = p.id AND li.aplicada AND NOT li.endereco_livre AND i.situacao = 'ATIVO'
                 AND regexp_replace(lower(coalesce(li.endereco_canonico, '')), '[^a-z0-9]', '', 'g') LIKE '%' || ${termo}::text || '%'))
      )
    ORDER BY p.codigo
    LIMIT ${filtro.limite}`;
  const total = Number(linhas[0]?.total ?? 0);
  const ids = linhas.map((l) => l.id);
  const [paletes, ativas] = await Promise.all([
    db.palete.findMany({ where: { escopoId: escopo.id, id: { in: ids } }, select: selecaoResumo, orderBy: { codigo: 'asc' } }),
    conferenciasAtivas(db, escopo.id, ids),
  ]);
  const informados = await informadosDe(db, escopo.id, paletes);
  return { items: paletes.map((p) => resumo(p, ativas, informados)), total, limit: filtro.limite, truncated: total > paletes.length };
}
