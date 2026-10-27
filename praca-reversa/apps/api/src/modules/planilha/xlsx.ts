/**
 * Escrita da planilha única (XLSX sem macros): estilos próprios (Arial,
 * amarelo DHL #FFCC00 de destaque, títulos escuros, vermelho #D40511 só em
 * filetes), tabelas do Excel com filtro, painéis fixos, larguras, mesclas só
 * em títulos e valores tipados.
 *
 * Proteção contra fórmula injetada: todo texto vai como texto (inlineStr,
 * nunca <f>); textos que começam com = + - @ ou tabulação recebem também o
 * prefixo de aspas do Excel (quotePrefix), para continuarem texto se a célula
 * for editada. Só as fórmulas escritas por este módulo (indicadores) existem.
 */
import { escaparXml } from '../importacao/arquivo/xml.js';
import { letraDaColuna } from '../importacao/arquivo/xlsx.js';
import { textoXml } from '../importacao/arquivo/xlsx-escrita.js';
import { escreverZip } from '../importacao/arquivo/zip.js';

export const CORES = { amarelo: 'FFFFCC00', vermelho: 'FFD40511', texto: 'FF333333', escuro: 'FF1A1A1A', cinza: 'FF666666', branco: 'FFFFFFFF' } as const;

export type Fundo = 'nenhum' | 'amarelo' | 'amareloClaro' | 'cinzaClaro' | 'zebra' | 'verdeClaro' | 'vermelhoClaro' | 'cinzaEstado' | 'pendente' | 'referencia';
export type Fonte = 'normal' | 'negrito' | 'titulo' | 'subtitulo' | 'aviso' | 'indicador' | 'rotulo' | 'cabecalho' | 'vermelho';
export type Formato = 'geral' | 'texto' | 'inteiro' | 'decimal' | 'dataHora';

export interface EstiloCelula {
  fonte?: Fonte;
  fundo?: Fundo;
  borda?: 'nenhuma' | 'leve' | 'cabecalho' | 'detalhe';
  formato?: Formato;
  quebra?: boolean;
  horizontal?: 'esquerda' | 'centro' | 'direita';
}

export type Valor = string | number | Date | null | { formula: string; resultado: number | string };

export interface Celula {
  /** Coluna 0 = A. */
  col: number;
  valor: Valor;
  estilo?: EstiloCelula;
}

export interface Linha {
  /** Linha 1 = primeira. */
  numero: number;
  altura?: number;
  celulas: Celula[];
}

export interface Tabela {
  nome: string;
  /** Primeira coluna (0 = A), linha do cabeçalho e última linha de dados. */
  coluna: number;
  linhaCabecalho: number;
  ultimaLinha: number;
  colunas: readonly string[];
}

export interface Folha {
  nome: string;
  larguras: readonly number[];
  linhas: Linha[];
  mesclas: readonly string[];
  /** Colunas e linhas fixas (painel congelado). */
  fixar?: { colunas: number; linhas: number };
  tabela?: Tabela;
}

const FONTES: Readonly<Record<Fonte, string>> = {
  normal: `<sz val="11"/><color rgb="${CORES.texto}"/><name val="Arial"/><family val="2"/>`,
  negrito: `<b/><sz val="11"/><color rgb="${CORES.texto}"/><name val="Arial"/><family val="2"/>`,
  titulo: `<b/><sz val="18"/><color rgb="${CORES.escuro}"/><name val="Arial"/><family val="2"/>`,
  subtitulo: `<b/><sz val="12"/><color rgb="${CORES.escuro}"/><name val="Arial"/><family val="2"/>`,
  aviso: `<sz val="10"/><color rgb="${CORES.cinza}"/><name val="Arial"/><family val="2"/>`,
  indicador: `<b/><sz val="16"/><color rgb="${CORES.texto}"/><name val="Arial"/><family val="2"/>`,
  rotulo: `<sz val="10"/><color rgb="${CORES.cinza}"/><name val="Arial"/><family val="2"/>`,
  cabecalho: `<b/><sz val="10"/><color rgb="${CORES.escuro}"/><name val="Arial"/><family val="2"/>`,
  vermelho: `<b/><sz val="11"/><color rgb="${CORES.vermelho}"/><name val="Arial"/><family val="2"/>`,
};

const FUNDOS: Readonly<Record<Fundo, string | null>> = {
  nenhum: null,
  amarelo: CORES.amarelo,
  amareloClaro: 'FFFFF5CC',
  cinzaClaro: 'FFF4F4F4',
  zebra: 'FFFAFAFA',
  verdeClaro: 'FFE3F1DF',
  vermelhoClaro: 'FFFBE0E2',
  cinzaEstado: 'FFE7E7E7',
  pendente: 'FFFDF0DC',
  referencia: 'FFEFEFEF',
};

const LEVE = 'FFD9D9D9';
const BORDAS = {
  nenhuma: '<border><left/><right/><top/><bottom/><diagonal/></border>',
  leve: `<border><left style="thin"><color rgb="${LEVE}"/></left><right style="thin"><color rgb="${LEVE}"/></right><top style="thin"><color rgb="${LEVE}"/></top><bottom style="thin"><color rgb="${LEVE}"/></bottom><diagonal/></border>`,
  cabecalho: `<border><left style="thin"><color rgb="${LEVE}"/></left><right style="thin"><color rgb="${LEVE}"/></right><top style="thin"><color rgb="${LEVE}"/></top><bottom style="medium"><color rgb="${CORES.vermelho}"/></bottom><diagonal/></border>`,
  detalhe: `<border><left/><right/><top/><bottom style="medium"><color rgb="${CORES.vermelho}"/></bottom><diagonal/></border>`,
} as const;

/** numFmtId: 0 geral, 49 texto, 3 "#,##0", 164 decimal até 3 casas, 165 data e hora. */
const FORMATOS: Readonly<Record<Formato, number>> = { geral: 0, texto: 49, inteiro: 3, decimal: 164, dataHora: 165 };
const FORMATOS_PROPRIOS = '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.###"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts>';

/** Registro de estilos: cada combinação vira um xf (sem repetir). */
class Estilos {
  private readonly fontes: Fonte[] = ['normal'];
  private readonly fundos: Fundo[] = ['nenhum'];
  private readonly bordas: (keyof typeof BORDAS)[] = ['nenhuma'];
  private readonly xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private readonly indice = new Map<string, number>();

  private posicao<T>(lista: T[], valor: T): number {
    const i = lista.indexOf(valor);
    if (i >= 0) return i;
    lista.push(valor);
    return lista.length - 1;
  }

  id(e: EstiloCelula, prefixo: boolean): number {
    const chave = JSON.stringify([e.fonte ?? 'normal', e.fundo ?? 'nenhum', e.borda ?? 'nenhuma', e.formato ?? 'geral', e.quebra ?? false, e.horizontal ?? null, prefixo]);
    const existente = this.indice.get(chave);
    if (existente !== undefined) return existente;
    const fonte = this.posicao(this.fontes, e.fonte ?? 'normal');
    // Os dois primeiros fills são reservados pelo Excel (none e gray125).
    const fundo = (e.fundo ?? 'nenhum') === 'nenhum' ? 0 : this.posicao(this.fundos, e.fundo ?? 'nenhum') + 1;
    const borda = this.posicao(this.bordas, e.borda ?? 'nenhuma');
    const fmt = FORMATOS[e.formato ?? 'geral'];
    const alinhamento =
      e.quebra || e.horizontal
        ? `<alignment vertical="center"${e.quebra ? ' wrapText="1"' : ''}${e.horizontal ? ` horizontal="${e.horizontal === 'esquerda' ? 'left' : e.horizontal === 'centro' ? 'center' : 'right'}"` : ''}/>`
        : '<alignment vertical="center"/>';
    const xf = `<xf numFmtId="${String(fmt)}" fontId="${String(fonte)}" fillId="${String(fundo)}" borderId="${String(borda)}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${prefixo ? ' quotePrefix="1"' : ''}>${alinhamento}</xf>`;
    this.xfs.push(xf);
    this.indice.set(chave, this.xfs.length - 1);
    return this.xfs.length - 1;
  }

  xml(): string {
    const fills = this.fundos
      .slice(1)
      .map((f) => `<fill><patternFill patternType="solid"><fgColor rgb="${FUNDOS[f] ?? CORES.branco}"/><bgColor indexed="64"/></patternFill></fill>`);
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      FORMATOS_PROPRIOS +
      `<fonts count="${String(this.fontes.length)}">${this.fontes.map((f) => `<font>${FONTES[f]}</font>`).join('')}</fonts>` +
      `<fills count="${String(fills.length + 2)}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills.join('')}</fills>` +
      `<borders count="${String(this.bordas.length)}">${this.bordas.map((b) => BORDAS[b]).join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${String(this.xfs.length)}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleLight1" defaultPivotStyle="PivotStyleLight16"/>' +
      '</styleSheet>'
    );
  }
}

/** Texto que o Excel poderia interpretar como fórmula se a célula for editada. */
export function pareceFormula(texto: string): boolean {
  return /^[=+\-@\t\r]/.test(texto);
}

/** Data/hora UTC → número de série do Excel no horário de São Paulo (o Excel não guarda fuso). */
export function serialSaoPaulo(data: Date): number {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(data);
  const p = (t: string) => Number(partes.find((x) => x.type === t)?.value ?? '0');
  const local = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second'));
  return Math.round((local / 86_400_000 + 25_569) * 86_400) / 86_400;
}

const ref = (col: number, linha: number) => `${letraDaColuna(col)}${String(linha)}`;

function celulaXml(c: Celula, numero: number, estilos: Estilos): string {
  const r = ref(c.col, numero);
  const e = c.estilo ?? {};
  const v = c.valor;
  if (v === null) return `<c r="${r}" s="${String(estilos.id(e, false))}"/>`;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Número inválido em ${r}.`);
    return `<c r="${r}" s="${String(estilos.id(e, false))}"><v>${String(v)}</v></c>`;
  }
  if (v instanceof Date) return `<c r="${r}" s="${String(estilos.id({ ...e, formato: 'dataHora' }, false))}"><v>${String(serialSaoPaulo(v))}</v></c>`;
  if (typeof v === 'object') {
    const resultado = typeof v.resultado === 'number' ? `<v>${String(v.resultado)}</v>` : `<v>${escaparXml(v.resultado)}</v>`;
    return `<c r="${r}" s="${String(estilos.id(e, false))}"${typeof v.resultado === 'string' ? ' t="str"' : ''}><f>${escaparXml(v.formula)}</f>${resultado}</c>`;
  }
  return `<c r="${r}" s="${String(estilos.id(e, pareceFormula(v)))}" t="inlineStr"><is><t xml:space="preserve">${textoXml(v)}</t></is></c>`;
}

/** Une as entradas da mesma linha (uma <row> por número; a última célula da mesma coluna prevalece). */
function unirLinhas(entrada: readonly Linha[]): Linha[] {
  const porNumero = new Map<number, { altura?: number; celulas: Map<number, Celula> }>();
  for (const l of entrada) {
    const atual = porNumero.get(l.numero) ?? { celulas: new Map<number, Celula>() };
    if (l.altura !== undefined) atual.altura = Math.max(atual.altura ?? 0, l.altura);
    for (const c of l.celulas) atual.celulas.set(c.col, c);
    porNumero.set(l.numero, atual);
  }
  return [...porNumero.entries()]
    .sort(([a], [b]) => a - b)
    .map(([numero, l]) => ({ numero, ...(l.altura === undefined ? {} : { altura: l.altura }), celulas: [...l.celulas.values()] }));
}

function folhaXml(f: Folha, estilos: Estilos, indice: number): string {
  const linhas = unirLinhas(f.linhas);
  const ultimaLinha = Math.max(1, ...linhas.map((l) => l.numero));
  const ultimaColuna = Math.max(0, f.larguras.length - 1);
  const cols = f.larguras.map((w, i) => `<col min="${String(i + 1)}" max="${String(i + 1)}" width="${String(w)}" customWidth="1"/>`).join('');
  const fixar = f.fixar;
  const painel =
    fixar && (fixar.colunas > 0 || fixar.linhas > 0)
      ? `<pane${fixar.colunas > 0 ? ` xSplit="${String(fixar.colunas)}"` : ''}${fixar.linhas > 0 ? ` ySplit="${String(fixar.linhas)}"` : ''} topLeftCell="${ref(fixar.colunas, fixar.linhas + 1)}" activePane="${fixar.colunas > 0 && fixar.linhas > 0 ? 'bottomRight' : fixar.linhas > 0 ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
      : '';
  const dados = linhas
    .map((l) => {
      const celulas = [...l.celulas].sort((a, b) => a.col - b.col).map((c) => celulaXml(c, l.numero, estilos)).join('');
      return `<row r="${String(l.numero)}"${l.altura ? ` ht="${String(l.altura)}" customHeight="1"` : ''}>${celulas}</row>`;
    })
    .join('');
  const mesclas = f.mesclas.length > 0 ? `<mergeCells count="${String(f.mesclas.length)}">${f.mesclas.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${ref(ultimaColuna, ultimaLinha)}"/>` +
    `<sheetViews><sheetView showGridLines="0"${indice === 0 ? ' tabSelected="1"' : ''} workbookViewId="0">${painel}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${dados}</sheetData>` +
    mesclas +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    '<pageSetup orientation="landscape" fitToHeight="0"/>' +
    // NFD, Delivery e IDs são texto de propósito (zeros à esquerda): sem o aviso "número armazenado como texto".
    (f.tabela
      ? `<ignoredErrors><ignoredError sqref="${ref(f.tabela.coluna, f.tabela.linhaCabecalho)}:${ref(f.tabela.coluna + f.tabela.colunas.length - 1, Math.max(f.tabela.ultimaLinha, f.tabela.linhaCabecalho + 1))}" numberStoredAsText="1"/></ignoredErrors><tableParts count="1"><tablePart r:id="rId1"/></tableParts>`
      : '') +
    '</worksheet>'
  );
}

function tabelaXml(t: Tabela, id: number): string {
  const intervalo = `${ref(t.coluna, t.linhaCabecalho)}:${ref(t.coluna + t.colunas.length - 1, Math.max(t.ultimaLinha, t.linhaCabecalho + 1))}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${String(id)}" name="${t.nome}" displayName="${t.nome}" ref="${intervalo}" totalsRowShown="0">` +
    `<autoFilter ref="${intervalo}"/>` +
    `<tableColumns count="${String(t.colunas.length)}">${t.colunas.map((c, i) => `<tableColumn id="${String(i + 1)}" name="${escaparXml(c)}"/>`).join('')}</tableColumns>` +
    '<tableStyleInfo name="TableStyleLight1" showFirstColumn="0" showLastColumn="0" showRowStripes="0" showColumnStripes="0"/>' +
    '</table>'
  );
}

/** Pasta de trabalho com as folhas na ordem; a primeira abre selecionada. */
export function escreverPlanilha(folhas: readonly Folha[], titulo: string): Buffer {
  const estilos = new Estilos();
  const xml = (s: string) => Buffer.from(s, 'utf8');
  const folhasXml = folhas.map((f, i) => folhaXml(f, estilos, i));
  const comTabela = folhas.map((f, i) => ({ f, i })).filter((x) => x.f.tabela !== undefined);
  const tipos =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    folhas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    comTabela.map((_, n) => `<Override PartName="/xl/tables/table${String(n + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`).join('') +
    '</Types>';
  const relsPacote =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';
  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escaparXml(titulo)}</dc:title><dc:creator>Praça Reversa</dc:creator></cp:coreProperties>`;
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
    folhas.map((f, i) => `<sheet name="${escaparXml(f.nome)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`).join('') +
    '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
  const relsWorkbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    folhas.map((_, i) => `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`).join('') +
    `<Relationship Id="rId${String(folhas.length + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';
  const partes = [
    { nome: '[Content_Types].xml', conteudo: xml(tipos) },
    { nome: '_rels/.rels', conteudo: xml(relsPacote) },
    { nome: 'docProps/core.xml', conteudo: xml(core) },
    { nome: 'xl/workbook.xml', conteudo: xml(workbook) },
    { nome: 'xl/_rels/workbook.xml.rels', conteudo: xml(relsWorkbook) },
    ...folhasXml.map((s, i) => ({ nome: `xl/worksheets/sheet${String(i + 1)}.xml`, conteudo: xml(s) })),
  ];
  comTabela.forEach(({ f, i }, n) => {
    const t = f.tabela;
    if (!t) return;
    partes.push({
      nome: `xl/worksheets/_rels/sheet${String(i + 1)}.xml.rels`,
      conteudo: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${String(n + 1)}.xml"/>` +
          '</Relationships>',
      ),
    });
    partes.push({ nome: `xl/tables/table${String(n + 1)}.xml`, conteudo: xml(tabelaXml(t, n + 1)) });
  });
  // styles.xml por último: o registro de estilos só fica completo depois das folhas.
  partes.push({ nome: 'xl/styles.xml', conteudo: xml(estilos.xml()) });
  return escreverZip(partes);
}
