/**
 * Leitor restrito de XLSX (Office Open XML, ECMA-376 Parte 1, SpreadsheetML).
 * Lê somente valores gravados: fórmulas não são calculadas (a célula é
 * sinalizada), macros e formatos binários são recusados e vínculos externos
 * nunca são abertos. O texto bruto de cada célula é preservado: números
 * chegam como foram gravados no XML (sem conversão para ponto flutuante) e
 * textos mantêm zeros à esquerda. Estilos informam se a célula está
 * formatada como texto ("@") ou como data.
 */
import { ErroArquivo, type Prazo } from './erros.js';
import { decodificarXml, decodificarXstring, percorrerXml, type Atributos } from './xml.js';
import { extrairEntrada, lerDiretorioZip, type EntradaZip } from './zip.js';

export type TipoValor = 'TEXTO' | 'NUMERO' | 'DATA' | 'BOOLEANO' | 'ERRO' | 'VAZIO';

export interface CelulaXlsx {
  coluna: number;
  tipo: TipoValor;
  /** NUMERO: texto do XML; DATA: AAAA-MM-DD (ou AAAA-MM-DDTHH:MM:SS); TEXTO: como gravado. */
  texto: string | null;
  formula: boolean;
  /** Célula formatada como texto ("@"). */
  formatoTexto: boolean;
  /** Cor de fonte gravada no estilo da célula (ARGB, ex.: FF00B050; tema: "TEMA:5"); nula = padrão. */
  corFonte: string | null;
}

interface EstiloCelula {
  texto: boolean;
  data: boolean;
  corFonte: string | null;
}

/** Cor do elemento <color> da fonte: rgb ARGB direto; tema/índice ficam identificados sem resolver a paleta. */
function corDe(a: Atributos): string | null {
  const rgb = a.get('rgb');
  if (rgb !== undefined && /^[0-9A-Fa-f]{8}$/.test(rgb)) return rgb.toUpperCase();
  const tema = a.get('theme');
  if (tema !== undefined) return `TEMA:${tema}${a.get('tint') ? `:${a.get('tint') ?? ''}` : ''}`;
  const indice = a.get('indexed');
  if (indice !== undefined) return `INDICE:${indice}`;
  return null;
}

export interface LinhaXlsx {
  numero: number;
  celulas: CelulaXlsx[];
}

export interface PlanilhaInfo {
  nome: string;
  oculta: boolean;
  parte: string;
}

export interface LimitesXlsx {
  maxEntradasZip: number;
  maxDescompactado: number;
  /** Linhas não vazias lidas no máximo (cabeçalho incluído). */
  maxLinhasLidas: number;
  maxColunas: number;
}

const TIPO_PRINCIPAL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const TIPOS_RECUSADOS: Readonly<Record<string, string>> = {
  'application/vnd.ms-excel.sheet.macroEnabled.main+xml': 'Arquivo com macros (.xlsm) não é aceito. Salve como "Pasta de Trabalho do Excel (.xlsx)".',
  'application/vnd.ms-excel.template.macroEnabled.main+xml': 'Modelo com macros (.xltm) não é aceito. Salve como .xlsx.',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml': 'Modelo do Excel (.xltx) não é aceito. Salve como .xlsx.',
  'application/vnd.ms-excel.sheet.binary.macroEnabled.main': 'Pasta binária (.xlsb) não é aceita. Salve como .xlsx.',
};

/** Formatos internos de data do Excel (ECMA-376 18.8.30 e variantes regionais). */
const FORMATOS_DATA_INTERNOS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const FORMATO_TEXTO_INTERNO = 49;
/** <c r="…" …/> autofechada não tem valor nem fórmula: pode ser pulada (a referência fixa a coluna das seguintes). */
const CELULA_VAZIA: ReadonlyMap<string, string> = new Map([['c', 'r']]);

/** Código de formato personalizado que representa data/hora (d, m, y, h, s fora de aspas e colchetes). */
export function formatoEhData(codigo: string): boolean {
  const limpo = codigo
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, '')
    .split(';')[0] ?? '';
  return /[dmyhs]/i.test(limpo.replace(/General/gi, ''));
}

export function colunaDeReferencia(ref: string): number | null {
  const m = /^\$?([A-Z]{1,3})\$?\d*$/i.exec(ref);
  if (!m?.[1]) return null;
  let n = 0;
  for (const c of m[1].toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export function letraDaColuna(indice: number): string {
  let n = indice + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Data do número de série do Excel (sistema 1900, com o 29/02/1900 fictício, ou 1904). `null` se inválida. */
export function dataDeSerial(serial: string, data1904: boolean): string | null {
  const valor = Number(serial);
  if (!Number.isFinite(valor) || valor < 0 || valor > 2_958_465) return null;
  const dias = Math.floor(valor);
  const fracao = valor - dias;
  let base: number;
  if (data1904) {
    base = Date.UTC(1904, 0, 1) + dias * 86_400_000;
  } else {
    if (dias === 60 || dias === 0) return null; // 29/02/1900 não existiu; 0 = 00/01/1900
    base = Date.UTC(1899, 11, dias < 60 ? 31 : 30) + dias * 86_400_000;
  }
  const data = new Date(base).toISOString().slice(0, 10);
  if (fracao === 0) return data;
  const segundos = Math.round(fracao * 86_400);
  const hh = String(Math.floor(segundos / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor((segundos % 3600) / 60)).padStart(2, '0');
  const ss = String(segundos % 60).padStart(2, '0');
  return `${data}T${hh}:${mm}:${ss}`;
}

function atributo(atributos: Atributos, nome: string): string | undefined {
  return atributos.get(nome);
}

function juntarCaminho(base: string, alvo: string): string {
  if (alvo.startsWith('/')) return alvo.slice(1);
  const partes = base.split('/').slice(0, -1);
  for (const p of alvo.split('/')) {
    if (p === '..') partes.pop();
    else if (p !== '.' && p !== '') partes.push(p);
  }
  return partes.join('/');
}

interface Relacao {
  tipo: string;
  alvo: string;
  externo: boolean;
}

export class LeitorXlsx {
  readonly planilhas: PlanilhaInfo[] = [];
  readonly avisos: string[] = [];
  data1904 = false;
  private readonly entradas: Map<string, EntradaZip>;
  private compartilhados: string[] | null = null;
  private estilos: EstiloCelula[] | null = null;
  private partesEstilos: string | null = null;
  private parteTextos: string | null = null;

  private constructor(
    private readonly conteudo: Buffer,
    private readonly limites: LimitesXlsx,
    private readonly prazo: Prazo,
  ) {
    this.entradas = lerDiretorioZip(conteudo, { maxEntradas: limites.maxEntradasZip, maxTotalDescompactado: limites.maxDescompactado });
  }

  static abrir(conteudo: Buffer, limites: LimitesXlsx, prazo: Prazo): LeitorXlsx {
    const leitor = new LeitorXlsx(conteudo, limites, prazo);
    leitor.carregarPasta();
    return leitor;
  }

  private parte(caminho: string): string | null {
    const entrada = this.entradas.get(caminho);
    if (!entrada) return null;
    return decodificarXml(extrairEntrada(this.conteudo, entrada, this.limites.maxDescompactado));
  }

  private relacoes(caminhoParte: string): Map<string, Relacao> {
    const pasta = caminhoParte.split('/').slice(0, -1).join('/');
    const nome = caminhoParte.split('/').pop() ?? '';
    const xml = this.parte(`${pasta === '' ? '' : `${pasta}/`}_rels/${nome}.rels`);
    const mapa = new Map<string, Relacao>();
    if (xml === null) return mapa;
    percorrerXml(
      xml,
      {
        abrir: (elemento, a) => {
          if (elemento !== 'Relationship') return;
          const id = atributo(a, 'Id');
          const alvo = atributo(a, 'Target');
          if (id === undefined || alvo === undefined) return;
          const externo = atributo(a, 'TargetMode') === 'External';
          mapa.set(id, { tipo: atributo(a, 'Type') ?? '', alvo: externo ? alvo : juntarCaminho(caminhoParte, alvo), externo });
        },
      },
      this.prazo,
    );
    return mapa;
  }

  private carregarPasta(): void {
    const tipos = this.parte('[Content_Types].xml');
    if (tipos === null) throw new ErroArquivo('XLSX_INVALIDO', 'O arquivo compactado não é uma pasta de trabalho do Excel (.xlsx).');
    const sobrescritos = new Map<string, string>();
    percorrerXml(
      tipos,
      {
        abrir: (elemento, a) => {
          if (elemento === 'Override') sobrescritos.set((atributo(a, 'PartName') ?? '').replace(/^\//, ''), atributo(a, 'ContentType') ?? '');
        },
      },
      this.prazo,
    );
    const relacoesPacote = this.relacoesDoPacote();
    const principal = [...relacoesPacote.values()].find((r) => r.tipo.endsWith('/officeDocument') && !r.externo);
    if (!principal) throw new ErroArquivo('XLSX_INVALIDO', 'O arquivo compactado não é uma pasta de trabalho do Excel (.xlsx).');
    const tipoPrincipal = sobrescritos.get(principal.alvo) ?? '';
    const recusa = TIPOS_RECUSADOS[tipoPrincipal];
    if (recusa !== undefined) throw new ErroArquivo('XLSX_FORMATO', recusa);
    if (tipoPrincipal !== TIPO_PRINCIPAL) throw new ErroArquivo('XLSX_INVALIDO', 'O arquivo não é uma pasta de trabalho do Excel (.xlsx).');
    for (const nome of this.entradas.keys()) {
      if (/vbaProject\.bin$/i.test(nome) || /^xl\/macrosheets\//i.test(nome)) {
        throw new ErroArquivo('XLSX_MACROS', 'O arquivo contém macros, que não são aceitas nem executadas. Salve uma cópia sem macros (.xlsx).');
      }
    }
    if ([...this.entradas.keys()].some((n) => /^xl\/externalLinks\//i.test(n))) {
      this.avisos.push('A pasta tem vínculos com outros arquivos: eles não são abertos nem atualizados; só os valores gravados são lidos.');
    }

    const workbook = this.parte(principal.alvo);
    if (workbook === null) throw new ErroArquivo('XLSX_INVALIDO', 'A pasta de trabalho do XLSX está ausente.');
    const relacoes = this.relacoes(principal.alvo);
    const folhas: { nome: string; oculta: boolean; rid: string }[] = [];
    percorrerXml(
      workbook,
      {
        abrir: (elemento, a) => {
          if (elemento === 'workbookPr') {
            const d = atributo(a, 'date1904');
            this.data1904 = d === '1' || d === 'true';
          } else if (elemento === 'sheet') {
            const estado = atributo(a, 'state');
            folhas.push({ nome: atributo(a, 'name') ?? '', oculta: estado === 'hidden' || estado === 'veryHidden', rid: atributo(a, 'id') ?? '' });
          }
        },
      },
      this.prazo,
    );
    for (const f of folhas) {
      const rel = relacoes.get(f.rid);
      // Só planilhas de dados (gráficos e caixas de diálogo não têm linhas para importar).
      if (!rel || rel.externo || !rel.tipo.endsWith('/worksheet')) continue;
      this.planilhas.push({ nome: f.nome, oculta: f.oculta, parte: rel.alvo });
    }
    if (this.planilhas.length === 0) throw new ErroArquivo('XLSX_SEM_PLANILHA', 'O XLSX não tem nenhuma planilha de dados.');
    for (const rel of relacoes.values()) {
      if (rel.externo) continue;
      if (rel.tipo.endsWith('/sharedStrings')) this.parteTextos = rel.alvo;
      if (rel.tipo.endsWith('/styles')) this.partesEstilos = rel.alvo;
    }
  }

  private relacoesDoPacote(): Map<string, Relacao> {
    const xml = this.parte('_rels/.rels');
    const mapa = new Map<string, Relacao>();
    if (xml === null) return mapa;
    percorrerXml(
      xml,
      {
        abrir: (elemento, a) => {
          if (elemento !== 'Relationship') return;
          const id = atributo(a, 'Id') ?? '';
          const alvo = atributo(a, 'Target') ?? '';
          const externo = atributo(a, 'TargetMode') === 'External';
          mapa.set(id, { tipo: atributo(a, 'Type') ?? '', alvo: externo ? alvo : alvo.replace(/^\/+/, ''), externo });
        },
      },
      this.prazo,
    );
    return mapa;
  }

  /** Textos compartilhados (sharedStrings): rich text concatenado; leitura fonética (rPh) ignorada. */
  private textosCompartilhados(): string[] {
    if (this.compartilhados !== null) return this.compartilhados;
    const lista: string[] = [];
    const xml = this.parteTextos === null ? null : this.parte(this.parteTextos);
    if (xml !== null) {
      let atual: string[] | null = null;
      let emTexto = false;
      let fonetica = 0;
      percorrerXml(
        xml,
        {
          abrir: (elemento, _a, vazio) => {
            if (elemento === 'si') atual = [];
            else if (elemento === 'rPh') fonetica += vazio ? 0 : 1;
            else if (elemento === 't' && !vazio) emTexto = true;
          },
          fechar: (elemento) => {
            if (elemento === 'si') {
              lista.push(decodificarXstring((atual ?? []).join('')));
              atual = null;
            } else if (elemento === 'rPh') fonetica = Math.max(0, fonetica - 1);
            else if (elemento === 't') emTexto = false;
          },
          texto: (t) => {
            if (emTexto && fonetica === 0 && atual !== null) atual.push(t);
          },
        },
        this.prazo,
      );
    }
    this.compartilhados = lista;
    return lista;
  }

  /** Por índice de estilo (cellXfs): formato de texto, de data e cor da fonte. */
  private estilosCelula(): EstiloCelula[] {
    if (this.estilos !== null) return this.estilos;
    const lista: EstiloCelula[] = [];
    const xml = this.partesEstilos === null ? null : this.parte(this.partesEstilos);
    if (xml !== null) {
      const personalizados = new Map<number, string>();
      let emCellXfs = false;
      const formatos: number[] = [];
      const fontesXf: number[] = [];
      const coresFonte: (string | null)[] = [];
      let emFontes = false;
      let emDxfs = false;
      let fonteAtual = -1;
      percorrerXml(
        xml,
        {
          abrir: (elemento, a) => {
            if (elemento === 'numFmt') personalizados.set(Number(atributo(a, 'numFmtId')), atributo(a, 'formatCode') ?? '');
            else if (elemento === 'cellXfs') emCellXfs = true;
            else if (elemento === 'dxfs') emDxfs = true;
            else if (elemento === 'fonts' && !emDxfs) emFontes = true;
            else if (elemento === 'font' && emFontes) {
              fonteAtual = coresFonte.length;
              coresFonte.push(null);
            } else if (elemento === 'color' && emFontes && fonteAtual >= 0) coresFonte[fonteAtual] = corDe(a);
            else if (elemento === 'xf' && emCellXfs) {
              formatos.push(Number(atributo(a, 'numFmtId') ?? '0'));
              fontesXf.push(Number(atributo(a, 'fontId') ?? '0'));
            }
          },
          fechar: (elemento) => {
            if (elemento === 'cellXfs') emCellXfs = false;
            else if (elemento === 'fonts') emFontes = false;
            else if (elemento === 'dxfs') emDxfs = false;
            else if (elemento === 'font') fonteAtual = -1;
          },
        },
        this.prazo,
      );
      formatos.forEach((id, indice) => {
        const codigo = personalizados.get(id);
        lista.push({
          texto: id === FORMATO_TEXTO_INTERNO || codigo === '@',
          data: codigo !== undefined ? formatoEhData(codigo) : FORMATOS_DATA_INTERNOS.has(id),
          corFonte: coresFonte[fontesXf[indice] ?? 0] ?? null,
        });
      });
    }
    this.estilos = lista;
    return lista;
  }

  /**
   * Linhas não vazias da planilha, na ordem. Recusa dados além do limite de
   * colunas e mais linhas que o limite (sem continuar lendo).
   */
  lerPlanilha(nome: string): LinhaXlsx[] {
    const info = this.planilhas.find((p) => p.nome === nome);
    if (!info) throw new ErroArquivo('PLANILHA_INEXISTENTE', `A planilha "${nome}" não existe neste arquivo.`);
    const xml = this.parte(info.parte);
    if (xml === null) throw new ErroArquivo('XLSX_INVALIDO', `A planilha "${nome}" está ausente no arquivo.`);
    const textos = this.textosCompartilhados();
    const estilos = this.estilosCelula();
    const linhas: LinhaXlsx[] = [];

    let linhaAtual: LinhaXlsx | null = null;
    let ultimaLinha = 0;
    let ultimaColuna = -1;
    let celula: { coluna: number; tipo: string; estilo: number; formula: boolean; valor: string[] | null; inline: string[] | null } | null = null;
    let emValor = false;
    let emInline = false;
    let emTextoInline = false;
    let fonetica = 0;

    const fecharLinha = () => {
      if (linhaAtual && linhaAtual.celulas.length > 0) {
        if (linhas.length >= this.limites.maxLinhasLidas) {
          throw new ErroArquivo('LIMITE_LINHAS', `A planilha passa do limite de linhas da importação (${String(this.limites.maxLinhasLidas)} linhas preenchidas, cabeçalho incluído). Divida o arquivo.`);
        }
        linhas.push(linhaAtual);
      }
      linhaAtual = null;
    };

    percorrerXml(
      xml,
      {
        abrir: (elemento, a, vazio) => {
          if (elemento === 'row') {
            const r = Number(atributo(a, 'r') ?? String(ultimaLinha + 1));
            if (!Number.isInteger(r) || r < 1) throw new ErroArquivo('XLSX_INVALIDO', 'Número de linha inválido no XLSX.');
            ultimaLinha = r;
            ultimaColuna = -1;
            linhaAtual = { numero: r, celulas: [] };
            if (vazio) fecharLinha();
          } else if (elemento === 'c') {
            const ref = atributo(a, 'r');
            const coluna = ref === undefined ? ultimaColuna + 1 : colunaDeReferencia(ref);
            if (coluna === null) throw new ErroArquivo('XLSX_INVALIDO', 'Referência de célula inválida no XLSX.');
            ultimaColuna = coluna;
            celula = { coluna, tipo: atributo(a, 't') ?? 'n', estilo: Number(atributo(a, 's') ?? '0'), formula: false, valor: null, inline: null };
            if (vazio) this.fecharCelula(celula, linhaAtual, textos, estilos);
          } else if (celula !== null) {
            if (elemento === 'f') celula.formula = true;
            else if (elemento === 'v' && !vazio) {
              emValor = true;
              celula.valor = [];
            } else if (elemento === 'is') {
              emInline = !vazio;
              celula.inline = [];
            } else if (elemento === 'rPh' && emInline && !vazio) fonetica += 1;
            else if (elemento === 't' && emInline && !vazio) emTextoInline = true;
          }
        },
        fechar: (elemento) => {
          if (elemento === 'row') fecharLinha();
          else if (elemento === 'c' && celula !== null) {
            this.fecharCelula(celula, linhaAtual, textos, estilos);
            celula = null;
          } else if (elemento === 'v') emValor = false;
          else if (elemento === 'is') emInline = false;
          else if (elemento === 'rPh') fonetica = Math.max(0, fonetica - 1);
          else if (elemento === 't') emTextoInline = false;
        },
        texto: (t) => {
          if (celula === null) return;
          if (emValor) celula.valor?.push(t);
          else if (emTextoInline && fonetica === 0) celula.inline?.push(t);
        },
      },
      this.prazo,
      // Células vazias só formatadas (milhões em abas dimensionadas até a linha 1.048.576) são puladas.
      { ignorarVaziosCom: CELULA_VAZIA },
    );
    return linhas;
  }

  private fecharCelula(
    c: { coluna: number; tipo: string; estilo: number; formula: boolean; valor: string[] | null; inline: string[] | null },
    linha: LinhaXlsx | null,
    textos: readonly string[],
    estilos: readonly EstiloCelula[],
  ): void {
    if (linha === null) throw new ErroArquivo('XLSX_INVALIDO', 'Célula fora de linha no XLSX.');
    const estilo = estilos[c.estilo] ?? { texto: false, data: false, corFonte: null };
    const valor = c.valor === null ? null : c.valor.join('');
    let tipo: TipoValor;
    let texto: string | null;
    switch (c.tipo) {
      case 's': {
        const indice = Number(valor);
        const t = Number.isInteger(indice) ? textos[indice] : undefined;
        if (valor !== null && t === undefined) throw new ErroArquivo('XLSX_INVALIDO', 'Texto compartilhado inexistente no XLSX.');
        tipo = t === undefined ? 'VAZIO' : 'TEXTO';
        texto = t ?? null;
        break;
      }
      case 'inlineStr':
        texto = c.inline === null ? null : decodificarXstring(c.inline.join(''));
        tipo = texto === null ? 'VAZIO' : 'TEXTO';
        break;
      case 'str':
        texto = valor === null ? null : decodificarXstring(valor);
        tipo = texto === null ? 'VAZIO' : 'TEXTO';
        break;
      case 'b':
        tipo = valor === null ? 'VAZIO' : 'BOOLEANO';
        texto = valor === null ? null : valor === '1' ? 'VERDADEIRO' : 'FALSO';
        break;
      case 'e':
        tipo = 'ERRO';
        texto = valor;
        break;
      case 'd': {
        // Data ISO 8601 gravada como texto (t="d"): meia-noite vira só a data.
        const iso = valor?.trim() ?? null;
        tipo = iso === null || iso === '' ? 'VAZIO' : 'DATA';
        texto = iso === null ? null : (/^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?Z?)?$/.exec(iso)?.[1] ?? iso);
        break;
      }
      default:
        if (valor === null || valor.trim() === '') {
          tipo = 'VAZIO';
          texto = null;
        } else if (estilo.data) {
          tipo = 'DATA';
          texto = dataDeSerial(valor.trim(), this.data1904) ?? valor.trim();
        } else {
          tipo = 'NUMERO';
          texto = valor.trim();
        }
    }
    if (tipo === 'VAZIO' && !c.formula) return;
    if (tipo === 'TEXTO' && texto === '' && !c.formula) return;
    if (c.coluna >= this.limites.maxColunas) {
      throw new ErroArquivo(
        'LIMITE_COLUNAS',
        `Há dados na coluna ${letraDaColuna(c.coluna)} (linha ${String(linha.numero)}); o limite é de ${String(this.limites.maxColunas)} colunas. Remova as colunas extras.`,
      );
    }
    linha.celulas.push({ coluna: c.coluna, tipo, texto, formula: c.formula, formatoTexto: estilo.texto, corFonte: estilo.corFonte });
  }
}
