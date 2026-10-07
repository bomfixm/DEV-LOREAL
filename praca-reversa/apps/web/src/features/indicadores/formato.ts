import type { ColunaRelatorio, PeriodoAplicado } from '@praca-reversa/contracts';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';

/** Quantidade exata em pt-BR, com sinal (−3). */
export function fq(valor: string): string {
  return valor.startsWith('-') ? `−${formatarQuantidade(valor.slice(1))}` : formatarQuantidade(valor);
}

/** Valor monetário exato em pt-BR com duas casas (sem ponto flutuante). */
export function fv(valor: string): string {
  const negativo = valor.startsWith('-');
  const [inteiro = '0', fracao = ''] = (negativo ? valor.slice(1) : valor).split('.');
  const casas = fracao.length <= 2 ? fracao.padEnd(2, '0') : fracao.replace(/0+$/, '').padEnd(2, '0');
  return `${negativo ? '−' : ''}${formatarQuantidade(inteiro)},${casas}`;
}

/** "01/10/2026 a 05/10/2026 (America/Sao_Paulo, início e fim inclusivos)". */
export function textoPeriodo(p: PeriodoAplicado): string {
  const data = (d: string) => formatarData(`${d}T12:00:00Z`);
  return `${data(p.start)} a ${data(p.end)} (${p.timezone}, início e fim inclusivos)${p.includesToday ? '; inclui hoje: o saldo final é o atual' : ''}`;
}

/** Célula do relatório conforme o tipo da coluna (mesmo valor do CSV, só formatado). */
export function formatarCelula(coluna: ColunaRelatorio, valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  switch (coluna.kind) {
    case 'quantidade':
      return fq(valor);
    case 'valor':
      return fv(valor);
    case 'datahora':
      return formatarDataHora(valor);
    case 'data':
      return formatarData(`${valor}T12:00:00Z`);
    default:
      return valor;
  }
}
