/**
 * Lista de estoque dos painéis (mesma definição para cards, tabela e
 * exportação): uma linha por conteúdo na praça (NF × palete), e uma linha
 * "identificação não informada" para palete sem conteúdo. Totais calculados
 * sobre as mesmas linhas filtradas: o total do card é a soma da tabela.
 */
import { TAMANHO_PAGINA_PAINEL, type EstoqueCliente, type EtapaSelecao, type FiltroPainel, type LinhaEstoqueCliente } from '@praca-reversa/contracts';
import { reconferenciaDe } from '../paletes/relogio.js';
import { contem, noEstoque, type BasePainel, type ConteudoBase, type PaleteBase } from './base.js';

export interface LinhaEstoqueInterna extends LinhaEstoqueCliente {
  identidade: string | null;
  conteudoId: string | null;
}

/** Etapa de cada conteúdo na janela filtrada (pelas linhas da seleção vigente e pelos registros da janela). */
export type EtapasDaJanela = Map<string, EtapaSelecao>;

function linhaDe(p: PaleteBase, c: ConteudoBase | null, etapas: EtapasDaJanela | null): LinhaEstoqueInterna {
  return {
    documentType: c?.tipo ?? null,
    documentNumber: c?.numero ?? null,
    delivery: c?.delivery ?? null,
    sender: c?.remetente ?? null,
    volumes: c?.atual ?? null,
    volumesBasis: c?.basis ?? null,
    palletCode: p.codigo,
    palletId: p.id,
    palletType: p.tipoPalete,
    address: p.endereco,
    street: p.endereco === null ? null : p.rua,
    windowStage: c === null || etapas === null ? null : (etapas.get(c.id) ?? null),
    identidade: c?.identidade ?? null,
    conteudoId: c?.id ?? null,
  };
}

/** Linhas filtradas (estoque = agora; o período não esconde estoque antigo). */
export function linhasEstoque(base: BasePainel, filtro: FiltroPainel, etapas: EtapasDaJanela | null, agora: Date): LinhaEstoqueInterna[] {
  const linhas: LinhaEstoqueInterna[] = [];
  for (const p of base.paletes) {
    if (filtro.palete !== undefined && !contem(p.codigo, filtro.palete)) continue;
    if (filtro.rua !== undefined && !contem(p.endereco === null ? null : p.rua, filtro.rua)) continue;
    if (filtro.situacao === 'sem-endereco' && p.endereco !== null) continue;
    if (filtro.situacao === 'full' && p.tipoPalete !== 'FULL') continue;
    if (filtro.situacao === 'misto' && p.tipoPalete !== 'MISTO') continue;
    if (filtro.situacao === 'reconferencia' && reconferenciaDe(p, agora)?.due !== true) continue;
    const conteudos = p.conteudos.filter(noEstoque);
    const candidatos: (ConteudoBase | null)[] = conteudos.length === 0 ? [null] : conteudos;
    for (const c of candidatos) {
      if (filtro.documento !== undefined && !contem(c?.numero ?? null, filtro.documento)) continue;
      if (filtro.delivery !== undefined && !contem(c?.delivery ?? null, filtro.delivery)) continue;
      if (filtro.remetente !== undefined && !contem(c?.remetente ?? null, filtro.remetente)) continue;
      if (filtro.situacao === 'sem-volume' && c?.atual !== null && c !== null) continue;
      if (etapas !== null && (c === null || !etapas.has(c.id))) continue;
      linhas.push(linhaDe(p, c, etapas));
    }
  }
  const rua = (l: LinhaEstoqueInterna) => l.street ?? '￿';
  return linhas.sort(
    (a, b) =>
      rua(a).localeCompare(rua(b), 'pt-BR', { numeric: true }) ||
      (a.address ?? '￿').localeCompare(b.address ?? '￿', 'pt-BR', {
        numeric: true,
      }) ||
      a.palletCode.localeCompare(b.palletCode, 'pt-BR', { numeric: true }) ||
      (a.documentNumber ?? '').localeCompare(b.documentNumber ?? '', 'pt-BR', {
        numeric: true,
      }),
  );
}

export function totaisEstoque(linhas: readonly LinhaEstoqueInterna[]): EstoqueCliente['totals'] {
  const conhecidas = linhas.filter((l) => l.conteudoId !== null && l.volumes !== null);
  const conteudos = linhas.filter((l) => l.conteudoId !== null).length;
  return {
    volumes: conhecidas.reduce((t, l) => t + (l.volumes ?? 0), 0),
    volumesCoverage: { known: conhecidas.length, total: conteudos },
    pallets: new Set(linhas.map((l) => l.palletCode)).size,
    documents: new Set(linhas.flatMap((l) => (l.identidade === null ? [] : [l.identidade]))).size,
  };
}

/** Página da lista. `interno` = false remove o ID do palete (projeção do cliente). */
export function paginaEstoque(linhas: readonly LinhaEstoqueInterna[], pagina: number, interno: boolean, consultadoEm: Date, fuso: string): EstoqueCliente {
  const inicio = (pagina - 1) * TAMANHO_PAGINA_PAINEL;
  return {
    consultedAt: consultadoEm.toISOString(),
    timezone: fuso,
    rows: linhas.slice(inicio, inicio + TAMANHO_PAGINA_PAINEL).map((l) => projetarLinha(l, interno)),
    total: linhas.length,
    page: pagina,
    pageSize: TAMANHO_PAGINA_PAINEL,
    totals: totaisEstoque(linhas),
  };
}

/** Só os campos do contrato (o cliente não recebe o ID interno do palete). */
export function projetarLinha(l: LinhaEstoqueInterna, interno: boolean): LinhaEstoqueCliente {
  return {
    documentType: l.documentType,
    documentNumber: l.documentNumber,
    delivery: l.delivery,
    sender: l.sender,
    volumes: l.volumes,
    volumesBasis: l.volumesBasis,
    palletCode: l.palletCode,
    palletId: interno ? l.palletId : null,
    palletType: l.palletType,
    address: l.address,
    street: l.street,
    windowStage: l.windowStage,
  };
}
