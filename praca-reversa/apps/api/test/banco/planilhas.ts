/**
 * Planilhas de teste no formato das operacionais (dados fictícios): título na
 * linha 1 e cabeçalho na linha 2, números gravados como número, fonte verde
 * gravada no estilo da célula, fórmula com valor em cache, aba de resumo e aba
 * oculta, e linhas só formatadas até a linha informada (sem valores).
 */
import { letraDaColuna } from '../../src/modules/importacao/arquivo/xlsx.js';
import { escaparXml } from '../../src/modules/importacao/arquivo/xml.js';
import { escreverZip } from '../../src/modules/importacao/arquivo/zip.js';

export const VERDE = 'FF00B050';

export type CelulaTeste = string | number | null | { valor: string | number; cor?: string; formula?: string };

export interface AbaTeste {
  nome: string;
  oculta?: boolean;
  /** Texto da linha 1 (título); sem ele, o cabeçalho fica na linha 1. */
  titulo?: string;
  cabecalho: readonly string[];
  linhas: readonly (readonly CelulaTeste[])[];
  /** Última linha "formatada" (células vazias com estilo), como abas dimensionadas até 1.048.576. */
  formatadasAte?: number;
}

export function xlsxTeste(abas: readonly AbaTeste[]): Buffer {
  const cores = [...new Set(abas.flatMap((a) => a.linhas.flatMap((l) => l.flatMap((c) => (c !== null && typeof c === 'object' && c.cor ? [c.cor] : [])))))];
  // Fontes: 0 padrão, 1 negrito, 2.. coloridas. Estilos: 0 geral, 1 cabeçalho, 2.. cor.
  const fontes = ['<font><sz val="11"/><name val="Aptos Narrow"/></font>', '<font><b/><sz val="11"/><name val="Aptos Narrow"/></font>', ...cores.map((c) => `<font><b/><sz val="12"/><color rgb="${c}"/><name val="Aptos Narrow"/></font>`)];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>', ...cores.map((_, i) => `<xf numFmtId="0" fontId="${String(i + 2)}" fillId="0" borderId="0" xfId="0" applyFont="1"/>`)];
  const estilos =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<fonts count="${String(fontes.length)}">${fontes.join('')}</fonts>` +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${String(xfs.length)}">${xfs.join('')}</cellXfs>` +
    // Formatação condicional com verde (dxf): não é avaliada pelo leitor.
    '<dxfs count="1"><dxf><font><color rgb="FF00B050"/></font></dxf></dxfs>' +
    '</styleSheet>';
  const celula = (ref: string, c: CelulaTeste, estiloBase: number): string => {
    if (c === null) return '';
    const v = typeof c === 'object' ? c.valor : c;
    const s = typeof c === 'object' && c.cor ? cores.indexOf(c.cor) + 2 : estiloBase;
    const f = typeof c === 'object' && c.formula ? `<f>${escaparXml(c.formula)}</f>` : '';
    if (typeof v === 'number') return `<c r="${ref}" s="${String(s)}">${f}<v>${String(v)}</v></c>`;
    return `<c r="${ref}" s="${String(s)}" t="inlineStr">${f}<is><t xml:space="preserve">${escaparXml(v)}</t></is></c>`;
  };
  const folha = (a: AbaTeste): string => {
    const inicio = a.titulo === undefined ? 1 : 2;
    const linhas: string[] = [];
    if (a.titulo !== undefined) linhas.push(`<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>${escaparXml(a.titulo)}</t></is></c><c r="B1" s="1"/></row>`);
    linhas.push(`<row r="${String(inicio)}">${a.cabecalho.map((t, i) => celula(`${letraDaColuna(i)}${String(inicio)}`, t, 1)).join('')}</row>`);
    a.linhas.forEach((l, k) => {
      const n = inicio + 1 + k;
      linhas.push(`<row r="${String(n)}">${l.map((c, i) => celula(`${letraDaColuna(i)}${String(n)}`, c, 0)).join('')}</row>`);
    });
    const ultimaComDados = inicio + a.linhas.length;
    for (let n = ultimaComDados + 1; n <= (a.formatadasAte ?? 0); n++) {
      linhas.push(`<row r="${String(n)}">${a.cabecalho.map((_, i) => `<c r="${letraDaColuna(i)}${String(n)}" s="0"/>`).join('')}</row>`);
    }
    const ultima = Math.max(ultimaComDados, a.formatadasAte ?? 0);
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<dimension ref="A1:${letraDaColuna(a.cabecalho.length - 1)}${String(ultima)}"/><sheetData>${linhas.join('')}</sheetData>` +
      `<conditionalFormatting sqref="A3:A${String(ultima)}"><cfRule type="containsText" dxfId="0" priority="1" operator="containsText" text="X"><formula>NOT(ISERROR(SEARCH("X",A3)))</formula></cfRule></conditionalFormatting>` +
      '</worksheet>'
    );
  };
  const xml = (s: string) => Buffer.from(s, 'utf8');
  return escreverZip([
    {
      nome: '[Content_Types].xml',
      conteudo: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
          '</Types>',
      ),
    },
    {
      nome: '_rels/.rels',
      conteudo: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
    },
    {
      nome: 'xl/workbook.xml',
      conteudo: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          abas.map((a, i) => `<sheet name="${escaparXml(a.nome)}" sheetId="${String(i + 1)}"${a.oculta ? ' state="hidden"' : ''} r:id="rId${String(i + 1)}"/>`).join('') +
          '</sheets></workbook>',
      ),
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      conteudo: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          abas.map((_, i) => `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`).join('') +
          `<Relationship Id="rId${String(abas.length + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { nome: 'xl/styles.xml', conteudo: xml(estilos) },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${String(i + 1)}.xml`, conteudo: xml(folha(a)) })),
  ]);
}

/** CSV com ponto e vírgula (texto), como exportado pelo Excel em pt-BR. */
export function csvTeste(cabecalho: readonly string[], linhas: readonly (readonly (string | number | null)[])[]): Buffer {
  const celula = (v: string | number | null) => (v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return Buffer.from(`\uFEFF${[cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n')}\r\n`, 'utf8');
}

export const CABECALHO_INVENTARIO = ['DELIVERY', 'TIPO', 'NUMERO', 'VOLUMES', 'REMETENTE', 'MÊS AGENDA', 'JANELA', 'RUA', 'N° Pallet', 'DOCUMENTAÇÃO', 'PALLET FULL', 'PF/CNPJ'] as const;
