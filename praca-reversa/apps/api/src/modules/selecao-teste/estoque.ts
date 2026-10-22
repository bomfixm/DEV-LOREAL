/**
 * "Seleção cliente — teste": consulta do estoque (só leitura). Mesma base dos
 * painéis (`carregarBase`): paletes na praça, uma linha por conteúdo (vínculo
 * NF × palete do inventário ou conteúdo registrado), volumes = contagem vigente
 * ou informado no inventário menos o já expedido; desconhecido fica `null`.
 * Nada aqui grava: o teste nunca altera estoque, paletes, notas ou endereços.
 */
import {
  TAMANHO_PAGINA_TESTE,
  rotuloTipoDocumentoTeste,
  type ConteudoEstoqueTeste,
  type EstoqueTeste,
  type FiltroEstoqueTeste,
  type PaleteEstoqueTeste,
  type PaleteTeste,
  type RefConteudoTeste,
} from '@praca-reversa/contracts';
import type { Escopo } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { naoEncontrado } from '../../http/erros.js';
import { SEM_ENDERECO, carregarBase, contem, noEstoque, type BasePainel, type ConteudoBase, type PaleteBase } from '../paineis/base.js';

type Db = Banco | Transacao;

export function conteudoEstoque(c: ConteudoBase): ConteudoEstoqueTeste {
  return {
    ref: { kind: c.alvo, id: c.id },
    documentType: c.tipo,
    documentNumber: c.numero,
    delivery: c.delivery,
    sender: c.remetente,
    volumes: c.atual,
    volumesBasis: c.atual === null ? null : c.basis,
  };
}

/** Conteúdos do palete que continuam no estoque (expedido por inteiro sai). */
export function conteudosNoEstoque(p: PaleteBase): ConteudoBase[] {
  return p.conteudos.filter(noEstoque);
}

/** Pesquisa por tipo + número ("NF 900123", "NF-e 900123", "Minuta 4410" ou só o número), remetente ou Delivery. */
function conteudoCorresponde(c: ConteudoBase, termo: string): boolean {
  const candidatos = [c.remetente, c.delivery, c.numero];
  if (c.numero !== null) candidatos.push(`${c.tipo ?? ''}${c.numero}`, `${rotuloTipoDocumentoTeste(c.tipo)}${c.numero}`);
  return candidatos.some((v) => contem(v, termo));
}

export function linhaPalete(p: PaleteBase, termo: string | undefined): PaleteEstoqueTeste | null {
  const conteudos = conteudosNoEstoque(p);
  let matches: RefConteudoTeste[] = [];
  if (termo !== undefined && termo !== '') {
    if (!contem(p.codigo, termo)) {
      matches = conteudos.filter((c) => conteudoCorresponde(c, termo)).map((c) => ({ kind: c.alvo, id: c.id }));
      if (matches.length === 0) return null;
    }
  }
  const lista = conteudos.map(conteudoEstoque);
  return {
    palletId: p.id,
    palletCode: p.codigo,
    palletType: p.tipoPalete,
    contents: lista,
    volumes: {
      known: lista.reduce((t, c) => t + (c.volumes ?? 0), 0),
      unknownContents: lista.filter((c) => c.volumes === null).length,
    },
    matches,
  };
}

export async function estoqueTeste(db: Db, escopo: Escopo, filtro: FiltroEstoqueTeste, agora: Date): Promise<EstoqueTeste> {
  const base = await carregarBase(db, escopo.id);
  const termo = filtro.texto === undefined || filtro.texto === '' ? undefined : filtro.texto;
  const linhas = base.paletes
    .map((p) => linhaPalete(p, termo))
    .filter((l): l is PaleteEstoqueTeste => l !== null)
    .sort((a, b) => a.palletCode.localeCompare(b.palletCode, 'pt-BR', { numeric: true }));
  const inicio = (filtro.pagina - 1) * TAMANHO_PAGINA_TESTE;
  return {
    consultedAt: agora.toISOString(),
    rows: linhas.slice(inicio, inicio + TAMANHO_PAGINA_TESTE),
    total: linhas.length,
    page: filtro.pagina,
    pageSize: TAMANHO_PAGINA_TESTE,
  };
}

/** Palete no estoque consultado (ou 404: fora da praça, arquivado ou de outro escopo). */
export function paleteDaBase(base: BasePainel, paleteId: string): PaleteBase {
  const p = base.paletePorId.get(paleteId);
  if (p === undefined) throw naoEncontrado('Palete fora do estoque consultado (arquivado, expedido ou de outro escopo).');
  return p;
}

export async function paleteTeste(db: Db, escopo: Escopo, paleteId: string, agora: Date): Promise<PaleteTeste> {
  const base = await carregarBase(db, escopo.id);
  const p = paleteDaBase(base, paleteId);
  const conteudos = conteudosNoEstoque(p);
  // "Mais informações": só o que existe no cadastro (nada é obrigatório).
  const registrados = await db.conteudoPalete.findMany({
    where: { escopoId: escopo.id, paleteId, situacao: 'ATIVO' },
    select: { id: true, cnpjRemetente: true, descricao: true },
  });
  const produtosNaCaixa = await db.conteudoDocumentoPalete.findMany({
    where: { escopoId: escopo.id, paleteId, NOT: { produtoNaCaixa: '' } },
    select: { identidadeDocumento: true, produtoNaCaixa: true },
  });
  const saldos = await db.saldoEstoque.findMany({
    where: { escopoId: escopo.id, paleteId, quantidade: { gt: 0 } },
    select: { segmento: { select: { lote: true, produto: { select: { sku: true, descricao: true } } } } },
  });
  const porRegistro = new Map(registrados.map((r) => [r.id, r]));
  const produtoPor = new Map(produtosNaCaixa.map((r) => [r.identidadeDocumento, r.produtoNaCaixa.trim()]));
  const vazio = (v: string | null | undefined) => (v === null || v === undefined || v.trim() === '' ? null : v.trim());
  const skus = new Map<string, { sku: string; description: string; lot: string | null }>();
  for (const s of saldos) {
    const item = { sku: s.segmento.produto.sku, description: s.segmento.produto.descricao, lot: vazio(s.segmento.lote) };
    skus.set(`${item.sku}|${item.lot ?? ''}`, item);
  }
  return {
    consultedAt: agora.toISOString(),
    palletId: p.id,
    palletCode: p.codigo,
    palletType: p.tipoPalete,
    contents: conteudos.map((c) => {
      const registro = c.alvo === 'CONTEUDO' ? porRegistro.get(c.id) : undefined;
      const produto = c.identidade === null ? null : (produtoPor.get(c.identidade) ?? null);
      return { ...conteudoEstoque(c), cnpj: vazio(registro?.cnpjRemetente), description: vazio(registro?.descricao) ?? vazio(produto) };
    }),
    moreInfo: {
      address: p.endereco,
      street: p.endereco === null || p.rua === SEM_ENDERECO ? null : p.rua,
      skus: [...skus.values()].sort((a, b) => a.sku.localeCompare(b.sku, 'pt-BR', { numeric: true })),
    },
  };
}
