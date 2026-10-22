/**
 * Relatório de erros, conflitos e duplicidades de um lote (CSV), para corrigir
 * o arquivo de origem: número da linha, classificação, motivos e os valores
 * como foram lidos.
 */
import { CAMPOS_IMPORTACAO, ROTULOS_ACAO_LINHA, type LinhaImportacao, type LoteResumo, type OpcoesLeitura } from '@praca-reversa/contracts';
import { celulaCsv, documentoCsv } from '../../http/csv-seguro.js';

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export const ROTULO_CLASSIFICACAO: Readonly<Record<LinhaImportacao['classification'], string>> = {
  VALIDA_NOVA: 'Válida nova',
  DUPLICADA: 'Duplicada (ignorada)',
  INVALIDA: 'Inválida',
  CONFLITANTE: 'Conflitante',
  EXCLUIDA: 'Fora da seleção / deixada de fora',
};

const ROTULO_TIPO = {
  PRODUTOS: 'Cadastro de produtos',
  DEVOLUCOES: 'Documentos de devolução',
  CLAIMS: 'Lista de claims',
  INVENTARIO: 'Inventário conferido',
  SELECAO_CLIENTE: 'Seleção do cliente',
  BIPAGEM: 'Excel da bipagem (palete)',
} as const;

export function relatorioCsv(dados: { lote: LoteResumo; opcoes: OpcoesLeitura | null; linhas: readonly LinhaImportacao[] }, agora: Date): Buffer {
  const { lote, linhas } = dados;
  const campos = CAMPOS_IMPORTACAO[lote.type];
  const c = lote.counters;
  // Coluna "Ação" só nos tipos com ação por linha (inventário e seleção); os demais mantêm o formato anterior.
  const comAcao = lote.type === 'INVENTARIO' || lote.type === 'SELECAO_CLIENTE' || lote.type === 'BIPAGEM';
  const cab = (rotulo: string, valor: string) => [celulaCsv(rotulo), celulaCsv(valor)];
  const topo = [
    [celulaCsv('Relatório de erros, conflitos e duplicidades da importação')],
    cab('Lote', lote.id),
    cab('Tipo', ROTULO_TIPO[lote.type]),
    cab('Arquivo', lote.fileName),
    cab('SHA-256 do arquivo', lote.fileHash),
    ...(dados.opcoes?.sheet ? [cab('Planilha', dados.opcoes.sheet)] : []),
    cab('Situação do lote', lote.state),
    cab('Prévia', `versão ${String(lote.previewVersion)}`),
    cab(
      'Linhas',
      `${String(c.total)} de dados: ${String(c.validNew)} válidas novas, ${String(c.duplicate)} duplicadas, ${String(c.invalid)} inválidas, ${String(c.conflicting)} conflitantes${c.excluded > 0 ? `, ${String(c.excluded)} fora da seleção` : ''}${lote.state === 'CONFIRMADO' ? `; gravadas ${String(c.written)}, ignoradas ${String(c.ignored)}` : ''}`,
    ),
    cab('Relatório gerado em', `${DATA_HORA.format(agora)} (horário de Brasília)`),
    [],
    [celulaCsv('Linha do arquivo'), celulaCsv('Classificação'), ...(comAcao ? [celulaCsv('Ação')] : []), celulaCsv('Motivos'), celulaCsv('Avisos'), ...campos.map((f) => celulaCsv(`${f.rotulo} (como lido)`))],
  ];
  const corpo = linhas.map((l) => [
    celulaCsv(String(l.row)),
    celulaCsv(ROTULO_CLASSIFICACAO[l.classification]),
    ...(comAcao ? [celulaCsv(l.action === null ? null : (ROTULOS_ACAO_LINHA[l.action] ?? l.action))] : []),
    celulaCsv(l.reasons.map((m) => m.message).join(' | ')),
    celulaCsv(l.notices.map((m) => m.message).join(' | ')),
    ...campos.map((f) => celulaCsv(l.read[f.campo] ?? null)),
  ]);
  return documentoCsv([...topo, ...corpo]);
}
