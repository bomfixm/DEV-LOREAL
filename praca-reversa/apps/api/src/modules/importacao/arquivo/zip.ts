/**
 * Leitura restrita de arquivos ZIP (contêiner do XLSX), conforme a
 * especificação PKWARE APPNOTE: diretório central, cabeçalhos locais, métodos
 * 0 (sem compressão) e 8 (deflate). Proteções antes de descompactar: número de
 * entradas, tamanhos declarados, ZIP64, criptografia e nomes repetidos são
 * recusados. A descompressão de cada parte usa o zlib do Node com
 * `maxOutputLength` igual ao tamanho declarado, de modo que um cabeçalho que
 * mente não consegue expandir além do limite; o CRC-32 é conferido.
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { ErroArquivo } from './erros.js';

const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;
const MAX_COMENTARIO = 0xffff;

export interface EntradaZip {
  nome: string;
  metodo: number;
  tamanhoCompactado: number;
  tamanhoOriginal: number;
  crc: number;
  deslocamentoLocal: number;
}

export interface LimitesZip {
  maxEntradas: number;
  /** Soma máxima dos tamanhos descompactados declarados de todas as entradas. */
  maxTotalDescompactado: number;
}

const corrompido = () => new ErroArquivo('ZIP_INVALIDO', 'O arquivo XLSX está corrompido ou não é um XLSX válido. Abra no Excel e salve de novo como "Pasta de Trabalho do Excel (.xlsx)".');

export function pareceZip(conteudo: Buffer): boolean {
  return conteudo.length >= 4 && conteudo.readUInt32LE(0) === ASSINATURA_LOCAL;
}

/** Diretório central do ZIP, validado contra os limites antes de qualquer descompressão. */
export function lerDiretorioZip(conteudo: Buffer, limites: LimitesZip): Map<string, EntradaZip> {
  const inicioBusca = Math.max(0, conteudo.length - (22 + MAX_COMENTARIO));
  let fim = -1;
  for (let i = conteudo.length - 22; i >= inicioBusca; i--) {
    if (conteudo.readUInt32LE(i) === ASSINATURA_FIM) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw corrompido();
  const disco = conteudo.readUInt16LE(fim + 4);
  const discoCentral = conteudo.readUInt16LE(fim + 6);
  const entradasDisco = conteudo.readUInt16LE(fim + 8);
  const entradas = conteudo.readUInt16LE(fim + 10);
  const tamanhoCentral = conteudo.readUInt32LE(fim + 12);
  const inicioCentral = conteudo.readUInt32LE(fim + 16);
  if (entradas === 0xffff || tamanhoCentral === 0xffffffff || inicioCentral === 0xffffffff) {
    throw new ErroArquivo('ZIP64', 'Arquivo XLSX grande demais (formato ZIP64 não é aceito). Divida o arquivo em partes menores.');
  }
  if (disco !== 0 || discoCentral !== 0 || entradasDisco !== entradas) throw corrompido();
  if (entradas > limites.maxEntradas) {
    throw new ErroArquivo('ZIP_ENTRADAS', `O XLSX tem ${String(entradas)} partes internas; o limite é ${String(limites.maxEntradas)}. Remova imagens/objetos ou salve só os dados.`);
  }
  if (inicioCentral + tamanhoCentral > fim) throw corrompido();

  const mapa = new Map<string, EntradaZip>();
  let total = 0;
  let p = inicioCentral;
  for (let n = 0; n < entradas; n++) {
    if (p + 46 > fim || conteudo.readUInt32LE(p) !== ASSINATURA_CENTRAL) throw corrompido();
    const flags = conteudo.readUInt16LE(p + 8);
    const metodo = conteudo.readUInt16LE(p + 10);
    const crc = conteudo.readUInt32LE(p + 16);
    const tamanhoCompactado = conteudo.readUInt32LE(p + 20);
    const tamanhoOriginal = conteudo.readUInt32LE(p + 24);
    const tamNome = conteudo.readUInt16LE(p + 28);
    const tamExtra = conteudo.readUInt16LE(p + 30);
    const tamComentario = conteudo.readUInt16LE(p + 32);
    const deslocamentoLocal = conteudo.readUInt32LE(p + 42);
    const fimEntrada = p + 46 + tamNome + tamExtra + tamComentario;
    if (fimEntrada > fim) throw corrompido();
    const nome = conteudo.subarray(p + 46, p + 46 + tamNome).toString((flags & 0x0800) !== 0 ? 'utf8' : 'latin1');
    if ((flags & 0x0001) !== 0) throw new ErroArquivo('ZIP_CRIPTOGRAFADO', 'O arquivo está protegido por senha. Remova a proteção e salve de novo.');
    if (tamanhoCompactado === 0xffffffff || tamanhoOriginal === 0xffffffff || deslocamentoLocal === 0xffffffff) {
      throw new ErroArquivo('ZIP64', 'Arquivo XLSX grande demais (formato ZIP64 não é aceito).');
    }
    if (mapa.has(nome)) throw corrompido();
    total += tamanhoOriginal;
    if (total > limites.maxTotalDescompactado) {
      throw new ErroArquivo(
        'ZIP_DESCOMPACTADO',
        `O conteúdo descompactado do XLSX passa de ${String(Math.round(limites.maxTotalDescompactado / 1_048_576))} MB. Divida o arquivo ou remova abas, imagens e formatação desnecessárias.`,
      );
    }
    mapa.set(nome, { nome, metodo, tamanhoCompactado, tamanhoOriginal, crc, deslocamentoLocal });
    p = fimEntrada;
  }
  return mapa;
}

/** Descompacta uma entrada, sem ultrapassar o tamanho declarado, e confere o CRC-32. */
export function extrairEntrada(conteudo: Buffer, entrada: EntradaZip, maxBytes: number): Buffer {
  if (entrada.tamanhoOriginal > maxBytes) {
    throw new ErroArquivo('ZIP_DESCOMPACTADO', `Uma parte do XLSX (${entrada.nome}) passa do limite de leitura. Divida o arquivo em partes menores.`);
  }
  const p = entrada.deslocamentoLocal;
  if (p + 30 > conteudo.length || conteudo.readUInt32LE(p) !== ASSINATURA_LOCAL) throw corrompido();
  const inicio = p + 30 + conteudo.readUInt16LE(p + 26) + conteudo.readUInt16LE(p + 28);
  const dados = conteudo.subarray(inicio, inicio + entrada.tamanhoCompactado);
  if (dados.length !== entrada.tamanhoCompactado) throw corrompido();
  let saida: Buffer;
  if (entrada.metodo === 0) {
    saida = Buffer.from(dados);
  } else if (entrada.metodo === 8) {
    try {
      // maxOutputLength: deflate que expande além do declarado é recusado (bomba de descompressão).
      saida = inflateRawSync(dados, { maxOutputLength: Math.max(1, entrada.tamanhoOriginal) });
    } catch {
      throw corrompido();
    }
  } else {
    throw new ErroArquivo('ZIP_METODO', 'O XLSX usa um método de compressão não suportado. Salve de novo pelo Excel.');
  }
  if (saida.length !== entrada.tamanhoOriginal || crc32(saida) >>> 0 !== entrada.crc >>> 0) throw corrompido();
  return saida;
}

// ---------- Escrita (modelos XLSX) ----------

export interface ArquivoNoZip {
  nome: string;
  conteudo: Buffer;
}

/**
 * Monta um ZIP com deflate. Data fixa (1/1/1980) para que o mesmo modelo gere
 * sempre os mesmos bytes.
 */
export function escreverZip(arquivos: readonly ArquivoNoZip[]): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const compactado = deflateRawSync(a.conteudo, { level: 9 });
    const crc = crc32(a.conteudo) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(ASSINATURA_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compactado.length, 18);
    local.writeUInt32LE(a.conteudo.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(ASSINATURA_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compactado.length, 20);
    central.writeUInt32LE(a.conteudo.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    locais.push(local, nome, compactado);
    centrais.push(central, nome);
    deslocamento += local.length + nome.length + compactado.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(ASSINATURA_FIM, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}
