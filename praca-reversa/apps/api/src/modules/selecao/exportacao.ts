/**
 * Exportações da seleção do cliente (CSV seguro: BOM, ponto e vírgula,
 * proteção contra fórmula, códigos como texto). Cada arquivo identifica o
 * horário, a seleção (pedido/versão), o inventário de referência, os filtros
 * e as bases consultadas. A lista de separação anterior à reserva é uma
 * PROPOSTA: não representa material reservado nem expedido.
 */
import { ROTULOS_ABRANGENCIA, ROTULOS_SITUACAO_CONCILIACAO, type ResultadoConciliacao, type TipoExportacaoSelecao } from '@praca-reversa/contracts';
import { celulaCsv, documentoCsv, quantidadeCsv } from '../../http/csv-seguro.js';
import { ehPendencia, type ResultadoCompleto } from './servico.js';

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

function referencia(i: ResultadoConciliacao): string {
  const r = i.request;
  return [r.palletRef ? `palete ${r.palletRef}` : null, r.documentNumber ? `${r.documentType ?? 'NF'} ${r.documentNumber}` : null, r.delivery ? `delivery ${r.delivery}` : null, r.sku ? `SKU ${r.sku}${r.lot ? ` lote ${r.lot}` : ''}` : null]
    .filter(Boolean)
    .join(' · ');
}

function situacoes(i: ResultadoConciliacao): string {
  return [i.situation, ...i.alsoSituations].map((s) => ROTULOS_SITUACAO_CONCILIACAO[s]).join(' + ');
}

export function exportarSelecao(dados: ResultadoCompleto, tipo: TipoExportacaoSelecao, filtro: string, agora: Date): { conteudo: Buffer; linhas: number } {
  const s = dados.selecao;
  const cab = (rotulo: string, valor: string) => [celulaCsv(rotulo), celulaCsv(valor)];
  const titulo =
    tipo === 'separacao'
      ? 'Lista de separação por palete/endereço — PROPOSTA (não é reserva nem expedição; a reserva usa a lista de preparação da janela)'
      : tipo === 'pendencias'
        ? 'Relatório de pendências da seleção do cliente'
        : 'Conciliação completa da seleção do cliente';
  const topo: string[][] = [
    [celulaCsv(titulo)],
    cab('Seleção', `${s.code} · pedido ${s.orderReference} · versão ${String(s.orderVersion)}${s.versionLabel ? ` (cliente: ${s.versionLabel})` : ''}${s.state === 'SUBSTITUIDA' ? ' · SUBSTITUÍDA por versão posterior' : ''}`),
    cab('Inventário de referência', s.inventory ? `${s.inventory.code} — ${s.inventory.description}` : 'não informado'),
    cab('Gerado em', `${DATA_HORA.format(agora)} (horário de Brasília)`),
    cab('Filtros', filtro || 'nenhum'),
    cab('Base da consulta', 'registros atuais (posições, vínculos, saldo validado, reservas e liberação no momento da exportação); alocação informada = fotografia do inventário'),
    [],
  ];
  let corpo: string[][];
  if (tipo === 'separacao') {
    corpo = [
      [
        'Endereço atual',
        'Posição (desenho)',
        'Palete',
        'Linha do pedido',
        'Abrangência',
        'Documento',
        'Delivery',
        'Volumes informados',
        'SKU',
        'Lote',
        'Quantidade solicitada',
        'Unidade',
        'Saldo validado (desta origem)',
        'Disponível',
        'Situação',
        'Restrições',
      ].map(celulaCsv),
    ];
    const linhas: { ordem: string; celulas: string[] }[] = [];
    for (const i of dados.itens) {
      for (const a of i.allocations) {
        const material = a.material.map((m) => `${m.sku}${m.lot ? ` (${m.lot})` : ''}: ${m.validated.replace('.', ',')} ${m.unit}`).join(' | ');
        const disponivel = a.material.map((m) => `${m.sku}: ${m.available.replace('.', ',')} ${m.unit}`).join(' | ');
        linhas.push({
          ordem: `${a.currentPosition?.address ?? a.currentPosition?.code ?? '~'}|${a.pallet.code}|${String(i.row).padStart(6, '0')}`,
          celulas: [
            celulaCsv(a.currentPosition?.address ?? null),
            celulaCsv(a.currentPosition?.code ?? 'sem posição registrada'),
            celulaCsv(a.pallet.code),
            celulaCsv(i.lineRef ?? String(i.row)),
            celulaCsv(ROTULOS_ABRANGENCIA[i.scope]),
            celulaCsv(a.documents.map((d) => `${d.documentType ?? ''} ${d.documentNumber}`.trim()).join(' | ') || (i.request.documentNumber ?? null)),
            celulaCsv(i.request.delivery),
            celulaCsv(a.documents.map((d) => (d.volumes === null ? null : `${d.volumes.replace('.', ',')} ${d.unit.toLowerCase()}`)).filter(Boolean).join(' | ') || null),
            celulaCsv(i.request.sku),
            celulaCsv(i.request.lot),
            quantidadeCsv(i.request.quantity),
            celulaCsv(i.request.unit),
            celulaCsv(material || null),
            celulaCsv(disponivel || null),
            celulaCsv(situacoes(i)),
            celulaCsv(a.restrictions.join(' | ') || null),
          ],
        });
      }
    }
    corpo.push(...linhas.sort((x, y) => x.ordem.localeCompare(y.ordem, 'pt-BR')).map((l) => l.celulas));
  } else if (tipo === 'pendencias') {
    corpo = [['Linha do arquivo', 'Linha do pedido', 'Referência', 'Situação', 'Motivos', 'Base consultada', 'Ação necessária'].map(celulaCsv)];
    for (const i of dados.itens.filter(ehPendencia)) {
      corpo.push([
        celulaCsv(String(i.row)),
        celulaCsv(i.lineRef),
        celulaCsv(referencia(i)),
        celulaCsv(situacoes(i)),
        celulaCsv(i.reasons.join(' | ')),
        celulaCsv(i.quantities.basis),
        celulaCsv(i.nextStep),
      ]);
    }
  } else {
    corpo = [
      [
        'Linha do arquivo',
        'Linha do pedido',
        'Abrangência',
        'Referência',
        'Quantidade solicitada',
        'Unidade',
        'Paletes encontrados',
        'Endereços atuais',
        'Endereços informados no inventário',
        'Volumes informados',
        'Validado',
        'Reservado',
        'Disponível',
        'Não atendido',
        'Base da quantidade',
        'Encaminhado (reserva ativa)',
        'Expedido por esta solicitação',
        'Saídas anteriores',
        'Situação',
        'Motivos',
      ].map(celulaCsv),
    ];
    for (const i of dados.itens) {
      corpo.push([
        celulaCsv(String(i.row)),
        celulaCsv(i.lineRef),
        celulaCsv(ROTULOS_ABRANGENCIA[i.scope]),
        celulaCsv(referencia(i)),
        quantidadeCsv(i.request.quantity),
        celulaCsv(i.request.unit),
        celulaCsv(i.allocations.map((a) => a.pallet.code).join(' | ') || null),
        celulaCsv(i.allocations.map((a) => a.currentPosition?.address ?? a.currentPosition?.code ?? `${a.pallet.code}: sem posição`).join(' | ') || null),
        celulaCsv(i.allocations.map((a) => a.informedAddress).filter(Boolean).join(' | ') || null),
        quantidadeCsv(i.quantities.informedVolumes),
        quantidadeCsv(i.quantities.validated),
        quantidadeCsv(i.quantities.reserved),
        quantidadeCsv(i.quantities.available),
        quantidadeCsv(i.quantities.unmet),
        celulaCsv(i.quantities.basis),
        quantidadeCsv(i.forwarded.reservedActive),
        quantidadeCsv(i.forwarded.shipped),
        celulaCsv(i.shipped.map((e) => `${e.code}: ${e.quantity.replace('.', ',')} ${e.unit} ${e.sku}`).join(' | ') || null),
        celulaCsv(situacoes(i)),
        celulaCsv(i.reasons.join(' | ')),
      ]);
    }
  }
  return { conteudo: documentoCsv([...topo, ...corpo]), linhas: corpo.length - 1 };
}
