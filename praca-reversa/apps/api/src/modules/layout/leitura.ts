import { LadoFaixaSchema, OrigemPosicaoLivreSchema, type LadoFaixa, type Layout } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';

const ladoDe = (lado: string | null): LadoFaixa | null => {
  const r = LadoFaixaSchema.safeParse(lado);
  return r.success ? r.data : null;
};

const caixa = (x: number | null, y: number | null, w: number | null, h: number | null) =>
  x === null || y === null || w === null || h === null ? null : { x, y, width: w, height: h };

/**
 * Layout ativo do escopo no formato do contrato. Posições retiradas ficam de
 * fora do desenho (seus IDs e códigos continuam reservados no banco), assim
 * como fileiras sem nenhuma posição desenhada. Cada posição leva o endereço
 * real da tabela de correspondência (proposto ou confirmado), quando houver.
 */
export async function lerLayoutAtivo(db: Banco | Transacao, escopoId: string): Promise<Layout | null> {
  const l = await db.layout.findFirst({
    where: { escopoId, ativo: true },
    orderBy: { criadoEm: 'desc' },
    include: {
      elementos: { orderBy: { codigo: 'asc' } },
      fileiras: { orderBy: { ordem: 'asc' } },
      posicoes: {
        where: { retiradaEm: null },
        orderBy: [{ fileira: { ordem: 'asc' } }, { numero: 'asc' }],
        include: { endereco: { select: { endereco: true, situacao: true } } },
      },
    },
  });
  if (!l) return null;
  const comPosicoes = new Set(l.posicoes.map((p) => p.fileiraId));
  return {
    id: l.id,
    code: l.codigo,
    version: l.versao,
    revision: l.revisao,
    name: l.nome,
    unit: 'UNIDADE_DE_DESENHO',
    origin: 'SUPERIOR_ESQUERDO',
    width: l.largura,
    height: l.altura,
    totalCapacity: l.capacidadeTotal,
    schematic: l.esquematico,
    fictional: l.ficticio,
    elements: l.elementos.map((e) => ({
      id: e.id,
      kind: e.tipo,
      code: e.codigo,
      label: e.rotulo,
      fictional: e.ficticio,
      x: e.x,
      y: e.y,
      width: e.largura,
      height: e.altura,
      labelBox: caixa(e.rotuloX, e.rotuloY, e.rotuloLargura, e.rotuloAltura),
      operationalName: e.nomeOperacional,
      addressPrefix: e.prefixoEndereco,
    })),
    rows: l.fileiras.filter((f) => comPosicoes.has(f.id)).map((f) => ({
      id: f.id,
      code: f.codigo,
      label: f.rotulo,
      order: f.ordem,
      blockCode: f.blocoCodigo,
      x: f.x,
      y: f.y,
      width: f.largura,
      height: f.altura,
      labelBox: { x: f.rotuloX, y: f.rotuloY, width: f.rotuloLargura, height: f.rotuloAltura },
      side: ladoDe(f.lado),
    })),
    positions: l.posicoes.map((p) => ({
      id: p.id,
      code: p.codigo,
      provisionalCode: p.codigoProvisorio,
      rowId: p.fileiraId,
      number: p.numero,
      x: p.x,
      y: p.y,
      width: p.largura,
      height: p.altura,
      available: p.disponivel,
      unavailableReason: p.motivoIndisponibilidade,
      occupancySurveyed: p.ocupacaoLevantada,
      deactivated: p.desativada,
      address: p.endereco ? { text: p.endereco.endereco, state: p.endereco.situacao } : null,
      freeConfirmed:
        p.livreConfirmadaEm !== null && OrigemPosicaoLivreSchema.safeParse(p.livreOrigem).success
          ? { at: p.livreConfirmadaEm.toISOString(), origin: OrigemPosicaoLivreSchema.parse(p.livreOrigem) }
          : null,
    })),
  };
}
