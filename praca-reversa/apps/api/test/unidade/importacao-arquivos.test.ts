import { CAMPOS_IMPORTACAO, type LimitesImportacao, type OpcoesLeitura } from '@praca-reversa/contracts';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { celulaCsv } from '../../src/http/csv-seguro.js';
import { decodificarCsv, detectarDelimitador, lerRegistrosCsv } from '../../src/modules/importacao/arquivo/csv.js';
import { ErroArquivo, Prazo } from '../../src/modules/importacao/arquivo/erros.js';
import { detectarFormato, lerTabela } from '../../src/modules/importacao/arquivo/ler.js';
import { dataDeSerial, formatoEhData } from '../../src/modules/importacao/arquivo/xlsx.js';
import { escreverXlsx } from '../../src/modules/importacao/arquivo/xlsx-escrita.js';
import { percorrerXml } from '../../src/modules/importacao/arquivo/xml.js';
import { escreverZip, extrairEntrada, lerDiretorioZip } from '../../src/modules/importacao/arquivo/zip.js';
import { LIMITES_IMPORTACAO_PADRAO, sugerirColunas } from '../../src/modules/importacao/campos.js';
import { gerarModelo } from '../../src/modules/importacao/modelos.js';

const PASTA = new URL('../fixtures/excel/', import.meta.url);
const fixture = (nome: string) => readFileSync(new URL(nome, PASTA));
const LIMITES: LimitesImportacao = { ...LIMITES_IMPORTACAO_PADRAO };
const OPCOES: OpcoesLeitura = { sheet: null, headerRow: 1, encoding: null, delimiter: null };
const BOM = String.fromCharCode(0xfeff);

function erroDe(fn: () => unknown): ErroArquivo {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErroArquivo) return e;
    throw e;
  }
  throw new Error('Esperava ErroArquivo.');
}

/** Valores de uma linha como "TIPO:texto" (F = fórmula). */
function celulas(conteudo: Buffer, formato: 'CSV' | 'XLSX', opcoes: Partial<OpcoesLeitura> = {}, limites: LimitesImportacao = LIMITES) {
  const t = lerTabela(conteudo, formato, { ...OPCOES, ...opcoes }, limites);
  return { tabela: t, linhas: t.linhas.map((l) => [l.numero, l.celulas.map((c) => (c ? `${c.tipo}${c.formula ? '+F' : ''}:${c.texto ?? ''}` : null))] as const) };
}

describe('ZIP do XLSX (limites antes de descompactar)', () => {
  const zip = escreverZip([
    { nome: 'a.xml', conteudo: Buffer.from('<a>' + 'x'.repeat(10_000) + '</a>') },
    { nome: 'b.xml', conteudo: Buffer.from('<b/>') },
  ]);

  it('lê o diretório e extrai com CRC conferido', () => {
    const dir = lerDiretorioZip(zip, { maxEntradas: 10, maxTotalDescompactado: 1_000_000 });
    expect([...dir.keys()]).toEqual(['a.xml', 'b.xml']);
    const a = dir.get('a.xml');
    if (!a) throw new Error('a.xml');
    expect(extrairEntrada(zip, a, 1_000_000).toString()).toHaveLength(10_007);
  });

  it('recusa entradas demais e conteúdo descompactado acima do limite (declarado)', () => {
    expect(erroDe(() => lerDiretorioZip(zip, { maxEntradas: 1, maxTotalDescompactado: 1_000_000 })).codigo).toBe('ZIP_ENTRADAS');
    expect(erroDe(() => lerDiretorioZip(zip, { maxEntradas: 10, maxTotalDescompactado: 5_000 })).codigo).toBe('ZIP_DESCOMPACTADO');
  });

  it('bomba de descompressão: tamanho declarado menor que o real é recusado sem expandir', () => {
    const grande = Buffer.alloc(5_000_000, 0x41);
    const original = escreverZip([{ nome: 'bomba.xml', conteudo: grande }]);
    expect(deflateRawSync(grande).length).toBeLessThan(10_000);
    // Falsifica o tamanho descompactado (local em 22, central em 24 depois da assinatura central).
    const falso = Buffer.from(original);
    const central = falso.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    falso.writeUInt32LE(1_000, 22);
    falso.writeUInt32LE(1_000, central + 24);
    const dir = lerDiretorioZip(falso, { maxEntradas: 10, maxTotalDescompactado: 10_000 });
    const entrada = dir.get('bomba.xml');
    if (!entrada) throw new Error('bomba.xml');
    expect(erroDe(() => extrairEntrada(falso, entrada, 10_000)).codigo).toBe('ZIP_INVALIDO');
  });

  it('CRC divergente e arquivo truncado são recusados', () => {
    const errado = Buffer.from(zip);
    const central = errado.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    errado.writeUInt32LE(0x12345678, central + 16);
    const dir = lerDiretorioZip(errado, { maxEntradas: 10, maxTotalDescompactado: 1_000_000 });
    const a = dir.get('a.xml');
    if (!a) throw new Error('a.xml');
    expect(erroDe(() => extrairEntrada(errado, a, 1_000_000)).codigo).toBe('ZIP_INVALIDO');
    expect(erroDe(() => lerDiretorioZip(zip.subarray(0, zip.length - 30), { maxEntradas: 10, maxTotalDescompactado: 1_000_000 })).codigo).toBe('ZIP_INVALIDO');
  });
});

describe('XML estrito', () => {
  it('decodifica entidades, CDATA e prefixos de namespace', () => {
    const textos: string[] = [];
    const nomes: string[] = [];
    percorrerXml('<?xml version="1.0"?><x:a xmlns:x="u"><x:b v="1 &amp; 2">A &lt; B &#233; &#x41;</x:b><c><![CDATA[<cru>]]></c></x:a>', {
      abrir: (n, a) => {
        nomes.push(`${n}${a.get('v') ? `[${a.get('v') ?? ''}]` : ''}`);
      },
      texto: (t) => textos.push(t),
    });
    expect(nomes).toEqual(['a', 'b[1 & 2]', 'c']);
    expect(textos).toEqual(['A < B é A', '<cru>']);
  });

  it('recusa DOCTYPE/ENTITY, entidade desconhecida e tags desbalanceadas', () => {
    expect(erroDe(() => percorrerXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', {})).codigo).toBe('XML_DTD');
    expect(erroDe(() => percorrerXml('<a>&nada;</a>', {})).codigo).toBe('XML_INVALIDO');
    expect(erroDe(() => percorrerXml('<a><b></a></b>', {})).codigo).toBe('XML_INVALIDO');
    expect(erroDe(() => percorrerXml('<a>', {})).codigo).toBe('XML_INVALIDO');
  });
});

describe('XLSX salvo pelo Microsoft Excel (fixtures geradas por scripts/gerar-fixtures-excel.ps1)', () => {
  it('lista as abas e lê a escolhida: texto com zeros, número, fórmula sinalizada e data', () => {
    const { tabela, linhas } = celulas(fixture('devolucoes-varias-abas.xlsx'), 'XLSX', { sheet: 'Devoluções' });
    expect(tabela.planilhas.map((p) => p.nome)).toEqual(['Instruções', 'Devoluções', 'Resumo']);
    expect(tabela.cabecalho.map((c) => c.texto)).toEqual(CAMPOS_IMPORTACAO.DEVOLUCOES.map((c) => (c.campo === 'lineReference' ? 'Linha' : c.campo === 'unit' ? 'Unidade' : c.rotulo)));
    const porLinha = new Map(linhas);
    expect(porLinha.get(2)).toEqual(['TEXTO:DEV-XL-0001', 'NUMERO:1', 'TEXTO:000123', 'NUMERO:100', 'TEXTO:UN', 'TEXTO:000045678', 'TEXTO:0042', 'DATA:2026-09-15']);
    expect(porLinha.get(4)?.[2]).toBe('NUMERO:123');
    expect(porLinha.get(6)?.[3]).toBe('NUMERO+F:100');
    expect(tabela.avisos.join(' ')).toMatch(/fórmula/);
    // A primeira aba visível é a escolhida por padrão (aqui, a de instruções).
    expect(lerTabela(fixture('devolucoes-varias-abas.xlsx'), 'XLSX', OPCOES, LIMITES).opcoes.sheet).toBe('Instruções');
  });

  it('formato Strict Open XML dá o mesmo resultado', () => {
    expect(celulas(fixture('devolucoes-strict.xlsx'), 'XLSX', { sheet: 'Devoluções' }).linhas).toEqual(celulas(fixture('devolucoes-varias-abas.xlsx'), 'XLSX', { sheet: 'Devoluções' }).linhas);
  });

  it('CSV UTF-8 do Excel: BOM, aspas duplicadas e ponto e vírgula dentro de aspas', () => {
    const { tabela, linhas } = celulas(fixture('produtos-excel-utf8.csv'), 'CSV');
    expect(tabela.opcoes).toMatchObject({ encoding: 'UTF-8', delimiter: 'PONTO_E_VIRGULA' });
    expect(tabela.cabecalho.map((c) => c.texto)).toEqual(['SKU', 'Descrição', 'Unidade canônica', 'Código de barras', 'Embalagem do código', 'Fator']);
    expect(linhas[0]?.[1]).toEqual(['TEXTO:000123', 'TEXTO:Xampu fictício "suave" 300 ml', 'TEXTO:UN', 'TEXTO:0200000123001', 'TEXTO:UN', 'TEXTO:1']);
    expect(linhas[2]?.[1][1]).toBe('TEXTO:Pó descolorante fictício; a granel');
  });

  it('CSV do Excel em Windows-1252: recusado como UTF-8, lido com a codificação escolhida', () => {
    expect(erroDe(() => lerTabela(fixture('produtos-excel-ansi.csv'), 'CSV', OPCOES, LIMITES)).codigo).toBe('CODIFICACAO');
    const { linhas } = celulas(fixture('produtos-excel-ansi.csv'), 'CSV', { encoding: 'WINDOWS-1252' });
    expect(linhas[0]?.[1][1]).toBe('TEXTO:Xampu fictício "suave" 300 ml');
  });
});

describe('XLSX: formatos recusados e escrita dos modelos', () => {
  it('modelo escrito pelo aplicativo volta igual (texto com zeros, número, caracteres especiais)', () => {
    const controle = String.fromCharCode(7);
    const xlsx = escreverXlsx([
      { nome: 'Dados', colunas: [{ titulo: 'SKU', largura: 10, texto: true }, { titulo: 'Qtd', largura: 8, texto: false }], linhas: [['000123', 12.5], [`A&B <x> "y" _x0041_${controle}`, null]] },
      { nome: 'Outra', colunas: [{ titulo: 'X', largura: 8, texto: true }], linhas: [] },
    ]);
    const { tabela, linhas } = celulas(xlsx, 'XLSX');
    expect(tabela.planilhas.map((p) => p.nome)).toEqual(['Dados', 'Outra']);
    expect(linhas).toEqual([
      [2, ['TEXTO:000123', 'NUMERO:12.5']],
      [3, [`TEXTO:A&B <x> "y" _x0041_${controle}`]],
    ]);
  });

  it('macros, modelo e formatos antigos são recusados', () => {
    const xlsx = escreverXlsx([{ nome: 'Dados', colunas: [{ titulo: 'A', largura: 8, texto: true }], linhas: [['1']] }]);
    const dir = lerDiretorioZip(xlsx, { maxEntradas: 50, maxTotalDescompactado: 1_000_000 });
    const partes = [...dir.values()].map((e) => ({ nome: e.nome, conteudo: extrairEntrada(xlsx, e, 1_000_000) }));
    const comTipo = (tipo: string) =>
      escreverZip(partes.map((p) => (p.nome === '[Content_Types].xml' ? { ...p, conteudo: Buffer.from(p.conteudo.toString().replace('spreadsheetml.sheet.main+xml', tipo)) } : p)));
    expect(erroDe(() => lerTabela(comTipo('X').subarray(0), 'XLSX', OPCOES, LIMITES)).codigo).toBe('XLSX_INVALIDO');
    const xlsm = escreverZip(
      partes.map((p) =>
        p.nome === '[Content_Types].xml'
          ? { ...p, conteudo: Buffer.from(p.conteudo.toString().replace('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml')) }
          : p,
      ),
    );
    expect(erroDe(() => lerTabela(xlsm, 'XLSX', OPCOES, LIMITES)).message).toMatch(/macros/);
    const comVba = escreverZip([...partes, { nome: 'xl/vbaProject.bin', conteudo: Buffer.from('vba') }]);
    expect(erroDe(() => lerTabela(comVba, 'XLSX', OPCOES, LIMITES)).codigo).toBe('XLSX_MACROS');
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]);
    expect(erroDe(() => detectarFormato(ole, 'antigo.xls')).message).toMatch(/xls/);
    expect(erroDe(() => detectarFormato(Buffer.from('%PDF-1.7'), 'a.csv')).codigo).toBe('FORMATO_INCOMPATIVEL');
    expect(erroDe(() => detectarFormato(Buffer.from('a;b'), 'dados.json')).codigo).toBe('FORMATO_INCOMPATIVEL');
    expect(erroDe(() => detectarFormato(Buffer.from('a;b'), 'planilha.xlsx')).codigo).toBe('FORMATO_INCOMPATIVEL');
    expect(erroDe(() => detectarFormato(xlsx, 'planilha.csv')).codigo).toBe('FORMATO_INCOMPATIVEL');
    expect(erroDe(() => detectarFormato(Buffer.alloc(0), 'vazio.csv')).codigo).toBe('ARQUIVO_VAZIO');
    expect(detectarFormato(xlsx, 'Planilha.XLSX')).toBe('XLSX');
  });

  it('datas: série do Excel (1900 com 29/02/1900 fictício, 1904) e códigos de formato', () => {
    expect(dataDeSerial('46280', false)).toBe('2026-09-15');
    expect(dataDeSerial('1', false)).toBe('1900-01-01');
    expect(dataDeSerial('61', false)).toBe('1900-03-01');
    expect(dataDeSerial('60', false)).toBeNull();
    expect(dataDeSerial('0', true)).toBe('1904-01-01');
    expect(dataDeSerial('46280.5', false)).toBe('2026-09-15T12:00:00');
    expect(formatoEhData('dd/mm/yyyy')).toBe(true);
    expect(formatoEhData('[$-416]d" de "mmmm" de "yyyy')).toBe(true);
    expect(formatoEhData('0.00')).toBe(false);
    expect(formatoEhData('"Lote"@')).toBe(false);
    expect(formatoEhData('[Red]0')).toBe(false);
  });
});

describe('CSV: leitura no servidor, sem conversão de valores', () => {
  const ler = (texto: string, opcoes: Partial<OpcoesLeitura> = {}) => celulas(Buffer.from(texto, 'utf8'), 'CSV', opcoes);

  it('aspas, aspas duplicadas, quebra de linha dentro de aspas e número da linha física', () => {
    const { linhas, tabela } = ler('SKU;Nota\r\n"000123";"a ""b""\nc"\r\n\r\n00456;x\r\n');
    expect(linhas).toEqual([
      [2, ['TEXTO:000123', 'TEXTO:a "b"\nc']],
      [5, ['TEXTO:00456', 'TEXTO:x']],
    ]);
    expect(tabela.vazias).toBe(1);
  });

  it('aspas inválidas ou não fechadas são erro com a linha', () => {
    expect(erroDe(() => ler('a;b\n"x"y;z\n')).message).toMatch(/linha 2/);
    expect(erroDe(() => ler('a;b\n1;2\n"aberta;3\n')).message).toMatch(/Aspas não fechadas a partir da linha 3/);
  });

  it('detecta o delimitador pelo cabeçalho; vírgula decimal entre aspas não confunde', () => {
    expect(detectarDelimitador('SKU,Quantidade\n"001","1,5"\n"002","2"\n')).toBe('VIRGULA');
    expect(detectarDelimitador('SKU;Quantidade\n001;1,5\n002;2\n')).toBe('PONTO_E_VIRGULA');
    expect(detectarDelimitador('SKU\tQuantidade\n001\t1,5\n')).toBe('TABULACAO');
    expect(lerRegistrosCsv('a|b\n1|2', 'BARRA_VERTICAL', { maxRegistros: 10, maxColunas: 10 })[1]?.campos).toEqual(['1', '2']);
  });

  it('UTF-16 com BOM e UTF-8 inválido', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('SKU;Qtd\r\n007;1\r\n', 'utf16le')]);
    expect(decodificarCsv(utf16, null)).toMatchObject({ codificacao: 'UTF-16LE', bom: true });
    expect(celulas(utf16, 'CSV').linhas[0]?.[1][0]).toBe('TEXTO:007');
    expect(erroDe(() => decodificarCsv(Buffer.from([0x53, 0xe7, 0x3b]), null)).codigo).toBe('CODIFICACAO');
    expect(erroDe(() => decodificarCsv(Buffer.from([0x61, 0x00, 0x62]), 'UTF-8')).codigo).toBe('FORMATO_INCOMPATIVEL');
    expect(decodificarCsv(Buffer.from(`${BOM}a;b`, 'utf8'), 'WINDOWS-1252').codificacao).toBe('UTF-8');
  });

  it('limites de linhas, colunas e tempo', () => {
    const muitas = `SKU\n${Array.from({ length: 12 }, (_, i) => String(i)).join('\n')}\n`;
    expect(erroDe(() => lerTabela(Buffer.from(muitas), 'CSV', OPCOES, { ...LIMITES, maxRows: 10 })).codigo).toBe('LIMITE_LINHAS');
    expect(lerTabela(Buffer.from(muitas), 'CSV', OPCOES, { ...LIMITES, maxRows: 12 }).linhas).toHaveLength(12);
    expect(erroDe(() => lerTabela(Buffer.from('a;b;c;d\n1;2;3;4\n'), 'CSV', OPCOES, { ...LIMITES, maxColumns: 3 })).codigo).toBe('LIMITE_COLUNAS');
    // Delimitador final vazio não conta como coluna.
    expect(lerTabela(Buffer.from('a;b;c;\n1;2;3;\n'), 'CSV', OPCOES, { ...LIMITES, maxColumns: 3 }).linhas).toHaveLength(1);
    let relogio = 0;
    const prazo = new Prazo(1_000, () => relogio);
    relogio = 5_000;
    expect(
      erroDe(() => {
        for (let i = 0; i < 5_000; i++) prazo.verificar();
      }).codigo,
    ).toBe('TEMPO_EXCEDIDO');
  });

  it('XLSX acima do limite de linhas e de colunas', () => {
    const linhas = Array.from({ length: 20 }, (_, i) => [`S${String(i)}`, i] as const);
    const xlsx = escreverXlsx([{ nome: 'D', colunas: [{ titulo: 'SKU', largura: 8, texto: true }, { titulo: 'Q', largura: 8, texto: false }], linhas }]);
    expect(erroDe(() => lerTabela(xlsx, 'XLSX', OPCOES, { ...LIMITES, maxRows: 10 })).codigo).toBe('LIMITE_LINHAS');
    expect(erroDe(() => lerTabela(xlsx, 'XLSX', OPCOES, { ...LIMITES, maxColumns: 1 })).codigo).toBe('LIMITE_COLUNAS');
    expect(erroDe(() => lerTabela(xlsx, 'XLSX', OPCOES, { ...LIMITES, maxUncompressedBytes: 500 })).codigo).toBe('ZIP_DESCOMPACTADO');
  });

  it('cabeçalho em outra linha e cabeçalho vazio', () => {
    const { tabela } = ler('Planilha fictícia\n\nSKU;Qtd\n001;2\n', { headerRow: 3 });
    expect(tabela.cabecalho.map((c) => c.texto)).toEqual(['SKU', 'Qtd']);
    expect(erroDe(() => ler('a;b\n\n1;2\n', { headerRow: 2 })).codigo).toBe('CABECALHO_VAZIO');
  });
});

describe('Modelos de importação', () => {
  it('modelos CSV e XLSX trazem os campos aceitos, com sugestão completa de colunas e zeros preservados', () => {
    for (const [arquivo, tipo] of [
      ['produtos.csv', 'PRODUTOS'],
      ['produtos.xlsx', 'PRODUTOS'],
      ['devolucoes.csv', 'DEVOLUCOES'],
      ['devolucoes.xlsx', 'DEVOLUCOES'],
    ] as const) {
      const { conteudo } = gerarModelo(arquivo);
      const formato = detectarFormato(conteudo, arquivo);
      const tabela = lerTabela(conteudo, formato, OPCOES, LIMITES);
      expect(tabela.cabecalho.map((c) => c.texto)).toEqual(CAMPOS_IMPORTACAO[tipo].map((c) => c.rotulo));
      const sugestao = sugerirColunas(tipo, tabela.cabecalho);
      expect(Object.values(sugestao).every((v) => v !== null)).toBe(true);
      expect(tabela.linhas[0]?.celulas[tipo === 'PRODUTOS' ? 0 : 2]?.texto).toBe('000123');
      if (formato === 'XLSX') {
        expect(tabela.planilhas.map((p) => p.nome)).toEqual([tipo === 'PRODUTOS' ? 'Produtos' : 'Devoluções', 'Instruções']);
        expect(tabela.linhas[0]?.celulas[0]?.formatoTexto).toBe(true);
      }
    }
  });
});

describe('CSV de download contra fórmulas', () => {
  it('prefixa apóstrofo em texto que começa com = + - @ tab ou CR, e escapa aspas', () => {
    expect(celulaCsv('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(celulaCsv('+1')).toBe(`"'+1"`);
    expect(celulaCsv('-2+3')).toBe(`"'-2+3"`);
    expect(celulaCsv('@SOMA')).toBe(`"'@SOMA"`);
    expect(celulaCsv('\tx')).toBe(`"'\tx"`);
    expect(celulaCsv(`${String.fromCharCode(0xff1d)}1`)).toBe(`"'${String.fromCharCode(0xff1d)}1"`);
    expect(celulaCsv('000123')).toBe('"000123"');
    expect(celulaCsv(null)).toBe('');
  });
});
