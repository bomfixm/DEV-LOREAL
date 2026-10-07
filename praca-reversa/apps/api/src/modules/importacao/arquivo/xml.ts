/**
 * Leitor XML mínimo e estrito para as partes de um XLSX (SpreadsheetML,
 * ECMA-376). Percorre o documento emitindo abertura, fechamento e texto.
 * Recusa DOCTYPE/ENTITY (sem expansão de entidades externas ou recursivas),
 * entidades desconhecidas e tags desbalanceadas. Nomes chegam sem prefixo de
 * namespace (x:c e c são o mesmo elemento), o que também cobre o formato
 * "Strict Open XML".
 */
import { ErroArquivo, type Prazo } from './erros.js';

export type Atributos = ReadonlyMap<string, string>;

export interface EventosXml {
  abrir?(nome: string, atributos: Atributos, vazio: boolean): void;
  fechar?(nome: string): void;
  texto?(texto: string): void;
}

const malformado = (detalhe: string) => new ErroArquivo('XML_INVALIDO', `O XLSX tem conteúdo interno inválido (${detalhe}). Abra no Excel e salve de novo.`);

/** Texto UTF-8 (com ou sem BOM) ou UTF-16 com BOM, como permitido pela especificação. */
export function decodificarXml(conteudo: Buffer): string {
  try {
    if (conteudo[0] === 0xff && conteudo[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(conteudo.subarray(2));
    if (conteudo[0] === 0xfe && conteudo[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(conteudo.subarray(2));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(conteudo);
  } catch {
    throw malformado('codificação de texto');
  }
}

function localDe(nome: string): string {
  const i = nome.indexOf(':');
  return i < 0 ? nome : nome.slice(i + 1);
}

const ENTIDADES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Substitui referências de entidade/caractere. Entidade desconhecida é erro (XML não declara outras). */
export function decodificarEntidades(texto: string): string {
  if (!texto.includes('&')) return texto;
  let saida = '';
  let i = 0;
  for (;;) {
    const amp = texto.indexOf('&', i);
    if (amp < 0) return saida + texto.slice(i);
    const fim = texto.indexOf(';', amp);
    if (fim < 0 || fim - amp > 12) throw malformado('entidade');
    saida += texto.slice(i, amp);
    const nome = texto.slice(amp + 1, fim);
    if (nome.startsWith('#')) {
      const codigo = nome[1] === 'x' || nome[1] === 'X' ? Number.parseInt(nome.slice(2), 16) : Number.parseInt(nome.slice(1), 10);
      const valido = /^#(x[0-9a-fA-F]+|[0-9]+)$/.test(nome) && codigo > 0 && codigo <= 0x10ffff && (codigo < 0xd800 || codigo > 0xdfff);
      if (!valido) throw malformado('referência de caractere');
      saida += String.fromCodePoint(codigo);
    } else {
      const valor = ENTIDADES[nome];
      if (valor === undefined) throw malformado('entidade desconhecida');
      saida += valor;
    }
    i = fim + 1;
  }
}

const ATRIBUTO = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

function lerAtributos(corpo: string, inicio: number): Map<string, string> {
  const atributos = new Map<string, string>();
  let p = inicio;
  while (p < corpo.length) {
    if (/^\s*$/.test(corpo.slice(p))) break;
    ATRIBUTO.lastIndex = p;
    const m = ATRIBUTO.exec(corpo);
    if (!m) throw malformado('atributo');
    const nome = m[1] ?? '';
    // xmlns e prefixos de namespace não interessam ao leitor.
    if (nome !== 'xmlns' && !nome.startsWith('xmlns:')) atributos.set(localDe(nome), decodificarEntidades(m[2] ?? m[3] ?? ''));
    p = ATRIBUTO.lastIndex;
  }
  return atributos;
}

export interface OpcoesPercurso {
  /**
   * Elementos autofechados (sem conteúdo) que podem ser ignorados sem eventos
   * quando trazem o atributo indicado — ex.: células vazias só formatadas
   * (`<c r="B9" s="31"/>`), que em planilhas reais chegam a milhões. O
   * atributo exigido garante que nada depende da posição implícita.
   */
  ignorarVaziosCom?: ReadonlyMap<string, string>;
}

/** Percorre o XML chamando os eventos. `prazo` interrompe documentos que demoram demais. */
export function percorrerXml(xml: string, eventos: EventosXml, prazo?: Prazo, opcoes: OpcoesPercurso = {}): void {
  const ignorar = opcoes.ignorarVaziosCom;
  const pilha: string[] = [];
  const n = xml.length;
  let i = 0;
  let raiz = false;
  while (i < n) {
    prazo?.verificar();
    const lt = xml.indexOf('<', i);
    const fimTexto = lt < 0 ? n : lt;
    if (fimTexto > i) {
      const bruto = xml.slice(i, fimTexto);
      if (pilha.length > 0) {
        // Decodifica sempre: entidade inválida é erro mesmo em texto que o leitor ignora.
        const texto = decodificarEntidades(bruto);
        eventos.texto?.(texto);
      }
      else if (!/^\s*$/.test(bruto)) throw malformado('texto fora do elemento raiz');
    }
    if (lt < 0) break;
    if (xml.startsWith('<?', lt)) {
      const fim = xml.indexOf('?>', lt + 2);
      if (fim < 0) throw malformado('instrução');
      const instrucao = xml.slice(lt + 2, fim);
      const codificacao = /^xml\s[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(instrucao)?.[1];
      if (codificacao !== undefined && !/^utf-?(8|16)$/i.test(codificacao)) throw malformado(`codificação ${codificacao}`);
      i = fim + 2;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const fim = xml.indexOf('-->', lt + 4);
      if (fim < 0) throw malformado('comentário');
      i = fim + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const fim = xml.indexOf(']]>', lt + 9);
      if (fim < 0 || pilha.length === 0) throw malformado('CDATA');
      eventos.texto?.(xml.slice(lt + 9, fim));
      i = fim + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      throw new ErroArquivo('XML_DTD', 'O XLSX contém declarações de tipo de documento (DOCTYPE/ENTITY), que não são aceitas por segurança.');
    }
    if (xml.startsWith('</', lt)) {
      const fim = xml.indexOf('>', lt + 2);
      if (fim < 0) throw malformado('fechamento');
      const nome = xml.slice(lt + 2, fim).trim();
      if (pilha.pop() !== nome) throw malformado('elementos desbalanceados');
      eventos.fechar?.(localDe(nome));
      i = fim + 1;
      continue;
    }
    // Abertura: procura o '>' fora de aspas.
    let j = lt + 1;
    let aspas = 0;
    for (; j < n; j++) {
      const c = xml.charCodeAt(j);
      if (aspas !== 0) {
        if (c === aspas) aspas = 0;
      } else if (c === 34 || c === 39) {
        aspas = c;
      } else if (c === 62) {
        break;
      }
    }
    if (j >= n) throw malformado('abertura');
    if (ignorar !== undefined && xml.charCodeAt(j - 1) === 47 && pilha.length > 0) {
      // Autofechado: <nome ... />. Ignorado inteiro se o nome está na lista e traz o atributo exigido.
      const espaco = xml.indexOf(' ', lt + 1);
      if (espaco > 0 && espaco < j) {
        const exigido = ignorar.get(localDe(xml.slice(lt + 1, espaco)));
        if (exigido !== undefined && xml.slice(espaco, j).includes(` ${exigido}=`)) {
          i = j + 1;
          continue;
        }
      }
    }
    let corpo = xml.slice(lt + 1, j);
    const vazio = corpo.endsWith('/');
    if (vazio) corpo = corpo.slice(0, -1);
    const fimNome = corpo.search(/[\s]/);
    const nome = fimNome < 0 ? corpo : corpo.slice(0, fimNome);
    if (nome === '' || /[<>&"']/.test(nome)) throw malformado('nome de elemento');
    if (pilha.length === 0) {
      if (raiz) throw malformado('mais de um elemento raiz');
      raiz = true;
    }
    const atributos = fimNome < 0 ? new Map<string, string>() : lerAtributos(corpo, fimNome);
    eventos.abrir?.(localDe(nome), atributos, vazio);
    if (vazio) eventos.fechar?.(localDe(nome));
    else pilha.push(nome);
    i = j + 1;
  }
  if (pilha.length > 0 || !raiz) throw malformado('documento incompleto');
}

/**
 * Escape de caracteres do OOXML (ST_Xstring): `_xHHHH_` representa um
 * caractere (o Excel grava assim quebras de linha e controles).
 */
export function decodificarXstring(texto: string): string {
  if (!texto.includes('_x')) return texto;
  return texto.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

export function escaparXml(texto: string): string {
  return texto.replace(/[<>&"]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;'));
}
