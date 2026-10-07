/**
 * Leitura de CSV (RFC 4180 com as variações comuns do Excel brasileiro):
 * codificação pelo BOM, UTF-8 estrito ou Windows-1252 escolhido; delimitador
 * ; , tabulação ou | (detectado pelo cabeçalho ou escolhido); campos entre
 * aspas com aspas duplicadas e quebras de linha. Todos os valores são texto:
 * nada é convertido em número aqui. Cada registro guarda a linha física em
 * que começa (para o relatório de erros).
 */
import { CARACTERE_DELIMITADOR, type CodificacaoCsv, type DelimitadorCsv } from '@praca-reversa/contracts';
import { ErroArquivo, type Prazo } from './erros.js';

export interface TextoCsv {
  texto: string;
  codificacao: CodificacaoCsv;
  bom: boolean;
}

/** Decodifica o arquivo. O BOM, quando existe, prevalece sobre a escolha. */
export function decodificarCsv(conteudo: Buffer, escolhida: CodificacaoCsv | null): TextoCsv {
  let codificacao: CodificacaoCsv;
  let inicio = 0;
  let bom = true;
  if (conteudo[0] === 0xef && conteudo[1] === 0xbb && conteudo[2] === 0xbf) {
    codificacao = 'UTF-8';
    inicio = 3;
  } else if (conteudo[0] === 0xff && conteudo[1] === 0xfe) {
    codificacao = 'UTF-16LE';
    inicio = 2;
  } else if (conteudo[0] === 0xfe && conteudo[1] === 0xff) {
    codificacao = 'UTF-16BE';
    inicio = 2;
  } else {
    bom = false;
    codificacao = escolhida ?? 'UTF-8';
  }
  const rotulo = { 'UTF-8': 'utf-8', 'UTF-16LE': 'utf-16le', 'UTF-16BE': 'utf-16be', 'WINDOWS-1252': 'windows-1252' }[codificacao];
  let texto: string;
  try {
    texto = new TextDecoder(rotulo, { fatal: true, ignoreBOM: true }).decode(conteudo.subarray(inicio));
  } catch {
    throw new ErroArquivo(
      'CODIFICACAO',
      codificacao === 'UTF-8'
        ? 'O arquivo não está em UTF-8. Se foi salvo pelo Excel como "CSV (separado por vírgulas)", escolha a codificação Windows-1252 e gere a prévia de novo — ou salve como "CSV UTF-8".'
        : `O arquivo não pôde ser lido como ${codificacao}. Escolha outra codificação.`,
    );
  }
  if (texto.includes('\u0000')) throw new ErroArquivo('FORMATO_INCOMPATIVEL', 'O arquivo não parece ser um CSV de texto (há bytes nulos). Envie CSV ou XLSX.');
  return { texto, codificacao, bom };
}

export interface RegistroCsv {
  /** Linha física (1 = primeira) em que o registro começa. */
  linha: number;
  campos: string[];
}

export interface LimitesCsv {
  maxRegistros: number;
  maxColunas: number;
}

/** Lê registros com o delimitador informado. Aspas inválidas ou não fechadas são erro (sem correção silenciosa). */
export function lerRegistrosCsv(texto: string, delimitador: DelimitadorCsv, limites: LimitesCsv, prazo?: Prazo): RegistroCsv[] {
  const sep = CARACTERE_DELIMITADOR[delimitador];
  const registros: RegistroCsv[] = [];
  let campos: string[] = [];
  let campo = '';
  let linhaFisica = 1;
  let inicioRegistro = 1;
  let i = 0;
  const n = texto.length;
  let emAspas = false;
  let inicioAspas = 0;
  let campoComAspas = false;

  const fecharCampo = () => {
    campos.push(campo);
    campo = '';
    campoComAspas = false;
  };
  const fecharRegistro = () => {
    fecharCampo();
    // Delimitadores finais vazios não contam como colunas.
    let ultimo = campos.length;
    while (ultimo > 0 && campos[ultimo - 1] === '') ultimo--;
    if (ultimo > limites.maxColunas) {
      throw new ErroArquivo('LIMITE_COLUNAS', `A linha ${String(inicioRegistro)} tem ${String(ultimo)} colunas; o limite é ${String(limites.maxColunas)}. Confira o delimitador.`);
    }
    registros.push({ linha: inicioRegistro, campos });
    if (registros.length > limites.maxRegistros) {
      throw new ErroArquivo('LIMITE_LINHAS', `O arquivo passa do limite de linhas da importação (${String(limites.maxRegistros)} linhas lidas). Divida o arquivo.`);
    }
    campos = [];
  };

  while (i < n) {
    prazo?.verificar();
    const c = texto.charAt(i);
    if (emAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        emAspas = false;
        i++;
        const proximo = texto[i];
        if (i < n && proximo !== sep && proximo !== '\n' && proximo !== '\r') {
          throw new ErroArquivo('CSV_ASPAS', `Aspas inválidas na linha ${String(linhaFisica)}: depois de fechar as aspas deve vir o delimitador ou o fim da linha.`);
        }
        continue;
      }
      if (c === '\n' || (c === '\r' && texto[i + 1] !== '\n')) linhaFisica++;
      campo += c;
      i++;
      continue;
    }
    if (c === '"' && campo === '' && !campoComAspas) {
      emAspas = true;
      campoComAspas = true;
      inicioAspas = linhaFisica;
      i++;
      continue;
    }
    if (c === sep) {
      fecharCampo();
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      fecharRegistro();
      i += c === '\r' && texto[i + 1] === '\n' ? 2 : 1;
      linhaFisica++;
      inicioRegistro = linhaFisica;
      continue;
    }
    campo += c;
    i++;
  }
  if (emAspas) throw new ErroArquivo('CSV_ASPAS', `Aspas não fechadas a partir da linha ${String(inicioAspas)}.`);
  if (campo !== '' || campos.length > 0 || campoComAspas) fecharRegistro();
  return registros;
}

const ORDEM_DELIMITADORES: readonly DelimitadorCsv[] = ['PONTO_E_VIRGULA', 'VIRGULA', 'TABULACAO', 'BARRA_VERTICAL'];

/**
 * Detecta o delimitador pelos primeiros registros: o que dá ao cabeçalho mais
 * de uma coluna e mantém o mesmo número de colunas nas linhas seguintes. Em
 * empate, ponto e vírgula (padrão do Excel em português).
 */
export function detectarDelimitador(texto: string): DelimitadorCsv {
  const limite = 64 * 1024;
  const amostra = texto.length <= limite ? texto : texto.slice(0, Math.max(texto.lastIndexOf('\n', limite), 1));
  let melhor: { d: DelimitadorCsv; pontos: number } | null = null;
  for (const d of ORDEM_DELIMITADORES) {
    let registros: RegistroCsv[];
    try {
      registros = lerRegistrosCsv(amostra, d, { maxRegistros: 1_000_000, maxColunas: 1_000_000 }).slice(0, 30);
    } catch {
      continue;
    }
    const naoVazios = registros.filter((r) => r.campos.some((c) => c.trim() !== ''));
    const cabecalho = naoVazios[0];
    if (!cabecalho || cabecalho.campos.length < 2) continue;
    const resto = naoVazios.slice(1, -1);
    const coerentes = resto.length === 0 ? 1 : resto.filter((r) => r.campos.length === cabecalho.campos.length).length / resto.length;
    const pontos = coerentes * 1000 + Math.min(cabecalho.campos.length, 999);
    if (melhor === null || pontos > melhor.pontos) melhor = { d, pontos };
  }
  return melhor?.d ?? 'PONTO_E_VIRGULA';
}
