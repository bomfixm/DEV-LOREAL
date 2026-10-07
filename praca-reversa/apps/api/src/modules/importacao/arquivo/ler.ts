/**
 * Leitura do arquivo enviado em uma tabela única (CSV ou XLSX), com as opções
 * escolhidas na prévia e os limites configurados. O formato é decidido pelo
 * conteúdo (assinatura dos bytes), não só pela extensão.
 */
import type { CodificacaoCsv, DelimitadorCsv, FormatoArquivo, LimitesImportacao, OpcoesLeitura } from '@praca-reversa/contracts';
import { decodificarCsv, detectarDelimitador, lerRegistrosCsv } from './csv.js';
import { ErroArquivo, Prazo } from './erros.js';
import { LeitorXlsx, letraDaColuna, type TipoValor } from './xlsx.js';
import { pareceZip } from './zip.js';

export interface CelulaTabela {
  texto: string | null;
  tipo: TipoValor;
  formula: boolean;
  formatoTexto: boolean;
  /** Texto além do limite de caracteres por célula. */
  longa: boolean;
  /** XLSX: cor de fonte gravada no estilo da célula (ARGB); CSV: nula. */
  corFonte?: string | null;
}

export interface LinhaTabela {
  numero: number;
  /** Por índice de coluna; ausente = vazia. */
  celulas: (CelulaTabela | undefined)[];
}

/** Formatos tabulares lidos pela tela (o JSON da carga em lote é lido só pelo comando local). */
export type FormatoTabela = Extract<FormatoArquivo, 'CSV' | 'XLSX'>;

export interface Tabela {
  formato: FormatoTabela;
  planilhas: { nome: string; oculta: boolean; linhas: number | null }[];
  opcoes: { sheet: string | null; headerRow: number; encoding: CodificacaoCsv | null; delimiter: DelimitadorCsv | null };
  interpretacao: string[];
  avisos: string[];
  cabecalho: { indice: number; letra: string; texto: string }[];
  linhas: LinhaTabela[];
  vazias: number;
}

const NOME_DELIMITADOR: Readonly<Record<DelimitadorCsv, string>> = {
  PONTO_E_VIRGULA: 'ponto e vírgula (;)',
  VIRGULA: 'vírgula (,)',
  TABULACAO: 'tabulação',
  BARRA_VERTICAL: 'barra vertical (|)',
};

/** CSV ou XLSX pelo conteúdo; recusa formatos binários e extensões incompatíveis. */
export function detectarFormato(conteudo: Buffer, nomeArquivo: string): FormatoTabela {
  const extensao = /\.([a-z0-9]{1,5})$/i.exec(nomeArquivo)?.[1]?.toLowerCase() ?? '';
  if (conteudo.length === 0) throw new ErroArquivo('ARQUIVO_VAZIO', 'O arquivo está vazio.');
  if (conteudo.length >= 8 && conteudo.readUInt32BE(0) === 0xd0cf11e0) {
    throw new ErroArquivo(
      'FORMATO_INCOMPATIVEL',
      'Formato .xls (Excel 97-2003) ou arquivo protegido por senha não é aceito. Abra no Excel e salve como "Pasta de Trabalho do Excel (.xlsx)" ou CSV.',
    );
  }
  if (pareceZip(conteudo)) {
    if (extensao !== 'xlsx') throw new ErroArquivo('FORMATO_INCOMPATIVEL', `O conteúdo é compactado, mas o arquivo tem extensão .${extensao || '?'}: envie um .xlsx ou um .csv.`);
    return 'XLSX';
  }
  if (extensao === 'xlsx') throw new ErroArquivo('FORMATO_INCOMPATIVEL', 'O arquivo tem extensão .xlsx, mas não é uma pasta de trabalho válida.');
  if (!['csv', 'txt', 'tsv'].includes(extensao)) throw new ErroArquivo('FORMATO_INCOMPATIVEL', 'Envie um arquivo CSV (.csv) ou XLSX (.xlsx).');
  if (conteudo.subarray(0, 5).toString('latin1') === '%PDF-') throw new ErroArquivo('FORMATO_INCOMPATIVEL', 'PDF não é aceito. Envie CSV ou XLSX.');
  return 'CSV';
}

function celulaTexto(texto: string, limite: number): CelulaTabela | undefined {
  if (texto === '') return undefined;
  return { texto, tipo: 'TEXTO', formula: false, formatoTexto: true, longa: texto.length > limite };
}

function cabecalhoDe(linha: LinhaTabela | undefined, numero: number): Tabela['cabecalho'] {
  if (!linha || linha.celulas.every((c) => c === undefined)) {
    throw new ErroArquivo('CABECALHO_VAZIO', `A linha ${String(numero)} (cabeçalho) está vazia. Escolha a linha em que ficam os títulos das colunas.`);
  }
  return linha.celulas.map((c, indice) => ({ indice, letra: letraDaColuna(indice), texto: (c?.texto ?? '').trim() }));
}

export function lerTabela(conteudo: Buffer, formato: FormatoTabela, opcoes: OpcoesLeitura, limites: LimitesImportacao): Tabela {
  const prazo = new Prazo(limites.maxProcessingMs);
  return formato === 'CSV' ? lerCsv(conteudo, opcoes, limites, prazo) : lerXlsx(conteudo, opcoes, limites, prazo);
}

function lerCsv(conteudo: Buffer, opcoes: OpcoesLeitura, limites: LimitesImportacao, prazo: Prazo): Tabela {
  const { texto, codificacao, bom } = decodificarCsv(conteudo, opcoes.encoding);
  const delimitador = opcoes.delimiter ?? detectarDelimitador(texto);
  const registros = lerRegistrosCsv(texto, delimitador, { maxRegistros: (limites.maxRows + opcoes.headerRow) * 2, maxColunas: limites.maxColumns }, prazo);
  const linhas: LinhaTabela[] = registros.map((r) => ({ numero: r.linha, celulas: r.campos.map((c) => celulaTexto(c, limites.maxCellChars)) }));
  const cabecalho = cabecalhoDe(linhas[opcoes.headerRow - 1], opcoes.headerRow);
  const corpo = linhas.slice(opcoes.headerRow);
  const dados = corpo.filter((l) => l.celulas.some((c) => c !== undefined && (c.texto ?? '').trim() !== ''));
  if (dados.length > limites.maxRows) {
    throw new ErroArquivo('LIMITE_LINHAS', `O arquivo tem ${String(dados.length)} linhas de dados; o limite é ${String(limites.maxRows)}. Divida o arquivo.`);
  }
  return {
    formato: 'CSV',
    planilhas: [],
    opcoes: { sheet: null, headerRow: opcoes.headerRow, encoding: codificacao, delimiter: delimitador },
    interpretacao: [
      `Codificação ${codificacao}${bom ? ' (indicada pelo BOM do arquivo)' : opcoes.encoding ? ' (escolhida)' : ' (sem BOM; conferida como UTF-8 válido)'}.`,
      `Delimitador: ${NOME_DELIMITADOR[delimitador]}${opcoes.delimiter ? ' (escolhido)' : ' (detectado pelo cabeçalho)'}.`,
      'Campos entre aspas aceitos; aspas duplicadas dentro do campo viram uma aspa; quebras de linha dentro de aspas são mantidas.',
      'Todos os valores do CSV são lidos como texto: zeros à esquerda são preservados e nada é convertido sem regra explícita.',
      `Cabeçalho na linha ${String(opcoes.headerRow)}; ${String(dados.length)} linha(s) de dados; espaços nas pontas dos valores são removidos.`,
      'Número da linha = linha física do arquivo onde o registro começa.',
    ],
    avisos: [],
    cabecalho,
    linhas: dados,
    vazias: corpo.length - dados.length,
  };
}

function lerXlsx(conteudo: Buffer, opcoes: OpcoesLeitura, limites: LimitesImportacao, prazo: Prazo): Tabela {
  const leitor = LeitorXlsx.abrir(
    conteudo,
    {
      maxEntradasZip: limites.maxZipEntries,
      maxDescompactado: limites.maxUncompressedBytes,
      maxLinhasLidas: limites.maxRows + opcoes.headerRow,
      maxColunas: limites.maxColumns,
    },
    prazo,
  );
  const escolhida = opcoes.sheet === null ? (leitor.planilhas.find((p) => !p.oculta) ?? leitor.planilhas[0]) : leitor.planilhas.find((p) => p.nome === opcoes.sheet);
  if (!escolhida) throw new ErroArquivo('PLANILHA_INEXISTENTE', `A planilha "${opcoes.sheet ?? ''}" não existe neste arquivo.`);
  const lidas = leitor.lerPlanilha(escolhida.nome);
  const linhas: LinhaTabela[] = lidas.map((l) => {
    const celulas: (CelulaTabela | undefined)[] = [];
    for (const c of l.celulas) {
      celulas[c.coluna] = {
        texto: c.texto,
        tipo: c.tipo,
        formula: c.formula,
        formatoTexto: c.formatoTexto,
        longa: (c.texto ?? '').length > limites.maxCellChars,
        corFonte: c.corFonte,
      };
    }
    return { numero: l.numero, celulas };
  });
  const cabecalho = cabecalhoDe(
    linhas.find((l) => l.numero === opcoes.headerRow),
    opcoes.headerRow,
  );
  const dados = linhas.filter((l) => l.numero > opcoes.headerRow);
  if (dados.length > limites.maxRows) {
    throw new ErroArquivo('LIMITE_LINHAS', `A planilha tem ${String(dados.length)} linhas de dados; o limite é ${String(limites.maxRows)}. Divida o arquivo.`);
  }
  const ultima = dados.at(-1)?.numero ?? opcoes.headerRow;
  const formulas = dados.some((l) => l.celulas.some((c) => c?.formula));
  const indice = leitor.planilhas.indexOf(escolhida) + 1;
  return {
    formato: 'XLSX',
    planilhas: leitor.planilhas.map((p) => ({ nome: p.nome, oculta: p.oculta, linhas: p === escolhida ? dados.length : null })),
    opcoes: { sheet: escolhida.nome, headerRow: opcoes.headerRow, encoding: null, delimiter: null },
    interpretacao: [
      `Planilha "${escolhida.nome}" (${String(indice)} de ${String(leitor.planilhas.length)})${opcoes.sheet === null ? ', a primeira visível' : ''}.`,
      `Cabeçalho na linha ${String(opcoes.headerRow)}; ${String(dados.length)} linha(s) de dados.`,
      'Valores lidos como gravados no arquivo: textos mantêm zeros à esquerda; números são lidos do arquivo sem arredondamento.',
      `Datas: células com formato de data, pelo sistema de datas ${leitor.data1904 ? '1904' : '1900'} do arquivo.`,
      'Fórmulas, macros e vínculos externos nunca são executados; células com fórmula ficam pendentes nos campos importados.',
    ],
    avisos: [
      ...leitor.avisos,
      ...(formulas ? ['Há células com fórmula: o valor gravado não é usado nos campos importados (a linha fica inválida até a origem ter valores fixos).'] : []),
      ...(escolhida.oculta ? ['A planilha escolhida está oculta no Excel.'] : []),
    ],
    cabecalho,
    linhas: dados,
    vazias: ultima - opcoes.headerRow - dados.length,
  };
}
