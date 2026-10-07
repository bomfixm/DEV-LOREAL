/**
 * Escrita mínima de XLSX para os modelos de importação: textos em células de
 * texto (formato "@", também como estilo padrão das colunas de
 * identificadores, para que o que for digitado depois continue texto),
 * números como números, cabeçalho congelado. Só valores: sem fórmulas, macros
 * ou vínculos.
 */
import { escaparXml } from './xml.js';
import { letraDaColuna } from './xlsx.js';
import { escreverZip } from './zip.js';

export interface ColunaModelo {
  titulo: string;
  largura: number;
  /** Coluna de texto (identificadores): estilo "@" nas células e na coluna inteira. */
  texto: boolean;
}

export interface PlanilhaModelo {
  nome: string;
  colunas: readonly ColunaModelo[];
  /** Texto (string) ou número (number); `null` = célula vazia. */
  linhas: readonly (readonly (string | number | null)[])[];
}

const ESTILO_GERAL = 0;
const ESTILO_TEXTO = 1;
const ESTILO_CABECALHO = 2;

/** Caracteres de controle (exceto tabulação e quebras) vão como _xHHHH_ (ST_Xstring). */
export function textoXml(texto: string): string {
  const escapado = escaparXml(texto.replace(/_x[0-9A-Fa-f]{4}_/g, (m) => `_x005F_${m.slice(1)}`));
  let saida = '';
  for (const c of escapado) {
    const codigo = c.charCodeAt(0);
    const controle = codigo < 0x20 && codigo !== 0x09 && codigo !== 0x0a && codigo !== 0x0d;
    saida += controle ? `_x${codigo.toString(16).toUpperCase().padStart(4, '0')}_` : c;
  }
  return saida;
}

function celula(ref: string, valor: string | number, estilo: number): string {
  if (typeof valor === 'number') return `<c r="${ref}" s="${String(estilo)}"><v>${String(valor)}</v></c>`;
  return `<c r="${ref}" s="${String(estilo)}" t="inlineStr"><is><t xml:space="preserve">${textoXml(valor)}</t></is></c>`;
}

function planilhaXml(p: PlanilhaModelo): string {
  const cols = p.colunas
    .map((c, i) => `<col min="${String(i + 1)}" max="${String(i + 1)}" width="${String(c.largura)}" customWidth="1"${c.texto ? ` style="${String(ESTILO_TEXTO)}"` : ''}/>`)
    .join('');
  const cabecalho = `<row r="1">${p.colunas.map((c, i) => celula(`${letraDaColuna(i)}1`, c.titulo, ESTILO_CABECALHO)).join('')}</row>`;
  const linhas = p.linhas
    .map((linha, l) => {
      const numero = l + 2;
      const celulas = linha
        .map((v, i) => (v === null ? '' : celula(`${letraDaColuna(i)}${String(numero)}`, v, p.colunas[i]?.texto ? ESTILO_TEXTO : ESTILO_GERAL)))
        .join('');
      return `<row r="${String(numero)}">${celulas}</row>`;
    })
    .join('');
  const ultima = `${letraDaColuna(Math.max(p.colunas.length - 1, 0))}${String(p.linhas.length + 1)}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${ultima}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${cabecalho}${linhas}</sheetData>` +
    '</worksheet>'
  );
}

const ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Pasta de trabalho com as planilhas na ordem informada (a primeira é a lida por padrão). */
export function escreverXlsx(planilhas: readonly PlanilhaModelo[]): Buffer {
  const xml = (s: string) => Buffer.from(s, 'utf8');
  const tipos =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    planilhas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '</Types>';
  const relsPacote =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView/></bookViews><sheets>' +
    planilhas.map((p, i) => `<sheet name="${escaparXml(p.nome)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`).join('') +
    '</sheets></workbook>';
  const relsWorkbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    planilhas
      .map((_, i) => `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`)
      .join('') +
    `<Relationship Id="rId${String(planilhas.length + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';
  return escreverZip([
    { nome: '[Content_Types].xml', conteudo: xml(tipos) },
    { nome: '_rels/.rels', conteudo: xml(relsPacote) },
    { nome: 'xl/workbook.xml', conteudo: xml(workbook) },
    { nome: 'xl/_rels/workbook.xml.rels', conteudo: xml(relsWorkbook) },
    { nome: 'xl/styles.xml', conteudo: xml(ESTILOS) },
    ...planilhas.map((p, i) => ({ nome: `xl/worksheets/sheet${String(i + 1)}.xml`, conteudo: xml(planilhaXml(p)) })),
  ]);
}
