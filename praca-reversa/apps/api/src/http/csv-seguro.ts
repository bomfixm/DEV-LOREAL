/**
 * CSV para download (relatórios e exportações): UTF-8 com BOM, ponto e
 * vírgula, CRLF, todas as células entre aspas. Proteção contra injeção de
 * fórmula (OWASP "CSV Injection"): texto que começa com = + - @ tabulação ou
 * CR (e as variantes de largura total) recebe um apóstrofo no relatório para
 * não ser interpretado como fórmula pela planilha. O valor original continua
 * intacto no banco.
 */
const BOM = String.fromCharCode(0xfeff);
const INICIO_PERIGOSO = /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;

export function celulaCsv(valor: string | null): string {
  if (valor === null || valor === '') return '';
  const seguro = INICIO_PERIGOSO.test(valor) ? `'${valor}` : valor;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/** Quantidade decimal exata no formato brasileiro (vírgula decimal, sem milhar). */
export function quantidadeCsv(valor: string | null): string {
  return valor === null ? '' : valor.replace('.', ',');
}

export function documentoCsv(linhas: readonly (readonly string[])[]): Buffer {
  return Buffer.from(`${BOM}${linhas.map((l) => l.join(';')).join('\r\n')}\r\n`, 'utf8');
}

/** Nome de arquivo para Content-Disposition (ASCII simples). */
export function nomeDownload(base: string): string {
  return base.normalize('NFD').replace(/[\u0300-\u036F]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120);
}
