/**
 * Interpretação de cada célula mapeada (regras puras, sem banco). Nada é
 * reconstruído por suposição: identificador gravado como número, notação
 * científica, fórmula, quantidade ambígua ou com casas além do permitido
 * viram motivo específico de linha inválida.
 *
 * Regras documentadas (README, DECISOES D93–D104):
 * - Identificadores (SKU, código de barras, lote, referências, NF): texto exato,
 *   só os espaços das pontas são removidos.
 * - Linha/item do documento: texto; número inteiro do XLSX é aceito; só dígitos
 *   é comparado sem zeros à esquerda (chaveLinhaDocumento).
 * - Quantidade: > 0, até 3 casas, separador decimal escolhido, sem milhar.
 * - Data: DD/MM/AAAA ou AAAA-MM-DD; no XLSX, célula com formato de data.
 * - Unidade: maiúsculas, 1 a 10 letras/dígitos (regra já usada no cadastro).
 */
import { FORMATO_UNIDADE, normalizarQuantidade, type MotivoLinha, type SeparadorDecimal } from '@praca-reversa/contracts';
import type { CelulaTabela } from './arquivo/ler.js';

export type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: MotivoLinha };

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (code: string, field: string, message: string): Resultado<never> => ({ ok: false, motivo: { code, field, message } });

const CONTROLE = /[\p{Cc}\p{Cf}]/u;
const NOTACAO_CIENTIFICA = /^[+-]?\d+(?:[.,]\d+)?[eE][+-]?\d+$/;

export interface Campo {
  campo: string;
  rotulo: string;
}

/** Problemas comuns a qualquer célula: fórmula, erro do Excel, texto longo demais. */
function verificarCelula(c: CelulaTabela, f: Campo, maxCaracteres: number): Resultado<never> | null {
  if (c.formula) {
    return falha('FORMULA', f.campo, `${f.rotulo}: a célula tem fórmula. Fórmulas não são calculadas na importação; substitua por valores fixos na origem.`);
  }
  if (c.tipo === 'ERRO') return falha('ERRO_CELULA', f.campo, `${f.rotulo}: a célula tem erro do Excel (${c.texto ?? '#?'}).`);
  if (c.longa) return falha('TEXTO_LONGO', f.campo, `${f.rotulo}: a célula passa de ${String(maxCaracteres)} caracteres.`);
  return null;
}

/** Texto bruto da célula, como lido (para o relatório). */
export function textoLido(c: CelulaTabela | undefined): string | null {
  if (c === undefined) return null;
  const t = c.texto ?? '';
  const base = t.length > 200 ? `${t.slice(0, 200)}…` : t;
  return c.formula ? `(fórmula) ${base}` : base === '' ? null : base;
}

function vazia(c: CelulaTabela | undefined): boolean {
  return c === undefined || (!c.formula && (c.texto === null || c.texto.trim() === ''));
}

export function obrigatorio(c: CelulaTabela | undefined, f: Campo): MotivoLinha | null {
  return vazia(c) ? { code: 'CAMPO_OBRIGATORIO', field: f.campo, message: `${f.rotulo}: campo obrigatório vazio.` } : null;
}

/**
 * Identificador textual (SKU, código, lote, referência, NF). Número, data ou
 * booleano gravados pela planilha não são aceitos: zeros à esquerda ou dígitos
 * podem já ter sido perdidos na origem.
 */
export function identificador(c: CelulaTabela | undefined, f: Campo, maxCaracteres: number, opcoes: { semEspacos?: boolean; maximo?: number } = {}): Resultado<string | null> {
  if (vazia(c) || c === undefined) return ok(null);
  const problema = verificarCelula(c, f, maxCaracteres);
  if (problema) return problema;
  const bruto = c.texto ?? '';
  if (c.tipo === 'NUMERO' || c.tipo === 'DATA' || c.tipo === 'BOOLEANO') {
    return falha(
      'IDENTIFICADOR_NUMERICO',
      f.campo,
      `${f.rotulo}: a planilha gravou ${c.tipo === 'DATA' ? 'uma data' : 'um número'} (${bruto}), não texto. Zeros à esquerda ou dígitos podem ter sido perdidos: formate a coluna como Texto na origem e digite o código original.`,
    );
  }
  const valor = bruto.trim();
  if (NOTACAO_CIENTIFICA.test(valor)) {
    return falha('NOTACAO_CIENTIFICA', f.campo, `${f.rotulo}: "${valor}" está em notação científica (dígitos perdidos pela planilha). Corrija a origem com o código completo.`);
  }
  const maximo = opcoes.maximo ?? 64;
  if (valor.length > maximo) return falha('IDENTIFICADOR_INVALIDO', f.campo, `${f.rotulo}: até ${String(maximo)} caracteres.`);
  if (CONTROLE.test(valor)) return falha('IDENTIFICADOR_INVALIDO', f.campo, `${f.rotulo}: há caracteres de controle ou invisíveis.`);
  if (opcoes.semEspacos && !/^[\x21-\x7E]+$/.test(valor)) return falha('IDENTIFICADOR_INVALIDO', f.campo, `${f.rotulo}: sem espaços nem acentos.`);
  return ok(valor);
}

/** Chave de comparação da linha do documento (igual à função SQL `chave_linha_documento`). */
export function chaveLinhaDocumento(referencia: string): string {
  return /^[0-9]+$/.test(referencia) ? referencia.replace(/^0+/, '') || '0' : referencia;
}

/** Linha/item do documento: texto, ou número inteiro gravado pela planilha. */
export function linhaDocumento(c: CelulaTabela | undefined, f: Campo, maxCaracteres: number): Resultado<string | null> {
  if (c?.tipo === 'NUMERO' && !c.formula) {
    const t = (c.texto ?? '').trim();
    if (/^\d{1,15}$/.test(t)) return ok(t);
    return falha('IDENTIFICADOR_NUMERICO', f.campo, `${f.rotulo}: "${t}" não é um número inteiro de linha. Use o número do item ou texto.`);
  }
  return identificador(c, f, maxCaracteres);
}

export function textoLivre(c: CelulaTabela | undefined, f: Campo, maxCaracteres: number, minimo: number, maximo: number): Resultado<string | null> {
  if (vazia(c) || c === undefined) return ok(null);
  const problema = verificarCelula(c, f, maxCaracteres);
  if (problema) return problema;
  const valor = (c.texto ?? '').trim().replace(/\s+/g, ' ');
  if (valor.length < minimo || valor.length > maximo) return falha('TEXTO_INVALIDO', f.campo, `${f.rotulo}: de ${String(minimo)} a ${String(maximo)} caracteres.`);
  if (CONTROLE.test(valor)) return falha('TEXTO_INVALIDO', f.campo, `${f.rotulo}: há caracteres de controle ou invisíveis.`);
  return ok(valor);
}

export function unidade(c: CelulaTabela | undefined, f: Campo, maxCaracteres: number): Resultado<string | null> {
  if (vazia(c) || c === undefined) return ok(null);
  const problema = verificarCelula(c, f, maxCaracteres);
  if (problema) return problema;
  const valor = (c.texto ?? '').trim().toUpperCase();
  if (!FORMATO_UNIDADE.test(valor)) return falha('UNIDADE_INVALIDA', f.campo, `${f.rotulo}: "${(c.texto ?? '').trim()}" não é uma unidade válida (1 a 10 letras ou dígitos, ex.: UN, CX).`);
  return ok(valor);
}

/**
 * Converte um número gravado no XML do XLSX (ex.: "12", "1.5", "1E-3") em
 * texto decimal exato, sem ponto flutuante. `null` se não for número simples.
 */
export function decimalExato(texto: string): { inteiro: string; fracao: string; negativo: boolean } | null {
  const m = /^([+-])?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(texto.trim());
  if (!m) return null;
  const digitos = `${m[2] ?? ''}${m[3] ?? ''}`;
  const expoente = Number(m[4] ?? '0') - (m[3] ?? '').length;
  if (Math.abs(expoente) > 40) return null;
  let inteiro: string;
  let fracao: string;
  if (expoente >= 0) {
    inteiro = digitos + '0'.repeat(expoente);
    fracao = '';
  } else {
    const corte = digitos.length + expoente;
    inteiro = corte > 0 ? digitos.slice(0, corte) : '0';
    fracao = corte >= 0 ? digitos.slice(corte) : '0'.repeat(-corte) + digitos;
  }
  inteiro = inteiro.replace(/^0+(?=\d)/, '');
  fracao = fracao.replace(/0+$/, '');
  return { inteiro, fracao, negativo: m[1] === '-' };
}

/**
 * Quantidade exata (> 0, até 3 casas). Texto usa o separador decimal escolhido
 * e não aceita separador de milhar; número do XLSX é lido do XML sem
 * arredondar.
 */
export function quantidade(c: CelulaTabela | undefined, f: Campo, separador: SeparadorDecimal, maxCaracteres: number, permitirZero = false): Resultado<string | null> {
  if (vazia(c) || c === undefined) return ok(null);
  const problema = verificarCelula(c, f, maxCaracteres);
  if (problema) return problema;
  const bruto = (c.texto ?? '').trim();
  let inteiro: string;
  let fracao: string;
  let exibido = bruto;
  if (c.tipo === 'NUMERO') {
    // O XLSX guarda números binários (IEEE 754) e o Excel os escreve com até 17
    // dígitos (1,005 vira "1.0049999999999999"). Lê-se a menor representação
    // decimal que identifica o mesmo valor — a que o Excel exibe —, sem arredondar.
    const numero = Number(bruto);
    const d = Number.isFinite(numero) && /^[+-]?\d/.test(bruto) ? decimalExato(String(numero)) : null;
    if (!d || d.negativo) return falha('QUANTIDADE_INVALIDA', f.campo, `${f.rotulo}: "${bruto}" não é uma quantidade válida.`);
    ({ inteiro, fracao } = d);
    exibido = String(numero);
  } else if (c.tipo === 'TEXTO') {
    const sep = separador === 'VIRGULA' ? ',' : '.';
    const outro = separador === 'VIRGULA' ? '.' : ',';
    if (bruto.includes(outro)) {
      return falha(
        'QUANTIDADE_AMBIGUA',
        f.campo,
        `${f.rotulo}: "${bruto}" contém "${outro}", mas o separador decimal escolhido é "${sep}". Separador de milhar não é aceito: corrija a origem ou escolha o outro separador decimal.`,
      );
    }
    const m = new RegExp(`^(\\d+)(?:\\${sep}(\\d+))?$`).exec(bruto);
    if (!m) return falha('QUANTIDADE_INVALIDA', f.campo, `${f.rotulo}: "${bruto}" não é um número (use só dígitos e "${sep}" para decimais).`);
    inteiro = (m[1] ?? '').replace(/^0+(?=\d)/, '');
    fracao = (m[2] ?? '').replace(/0+$/, '');
  } else {
    return falha('QUANTIDADE_INVALIDA', f.campo, `${f.rotulo}: a célula não tem um número (${c.tipo === 'DATA' ? 'é uma data' : 'tipo inesperado'}).`);
  }
  if (fracao.length > 3) {
    return falha('CASAS_DECIMAIS', f.campo, `${f.rotulo}: "${exibido}" tem mais de 3 casas decimais. Nada é arredondado: corrija a quantidade na origem.`);
  }
  if (inteiro.length > 15) return falha('QUANTIDADE_INVALIDA', f.campo, `${f.rotulo}: quantidade grande demais (até 15 dígitos inteiros).`);
  const texto = normalizarQuantidade(fracao === '' ? inteiro : `${inteiro}.${fracao}`);
  if (texto === '0' && !permitirZero) return falha('QUANTIDADE_INVALIDA', f.campo, `${f.rotulo}: precisa ser maior que zero.`);
  return ok(texto);
}

function dataValida(ano: number, mes: number, dia: number): boolean {
  if (ano < 1900 || ano > 2999 || mes < 1 || mes > 12 || dia < 1) return false;
  return dia <= new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Data do documento (AAAA-MM-DD). DD/MM/AAAA ou AAAA-MM-DD em texto; célula de data no XLSX. */
export function data(c: CelulaTabela | undefined, f: Campo, maxCaracteres: number): Resultado<string | null> {
  if (vazia(c) || c === undefined) return ok(null);
  const problema = verificarCelula(c, f, maxCaracteres);
  if (problema) return problema;
  const bruto = (c.texto ?? '').trim();
  if (c.tipo === 'DATA') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return ok(bruto);
    if (/^\d{4}-\d{2}-\d{2}T/.test(bruto)) return falha('DATA_COM_HORA', f.campo, `${f.rotulo}: a célula tem data e hora (${bruto.replace('T', ' ')}); informe só a data.`);
    return falha('DATA_INVALIDA', f.campo, `${f.rotulo}: data inválida na planilha (${bruto}).`);
  }
  if (c.tipo === 'NUMERO') {
    return falha('DATA_AMBIGUA', f.campo, `${f.rotulo}: "${bruto}" é um número sem formato de data. Use uma célula de data ou o texto DD/MM/AAAA.`);
  }
  if (c.tipo !== 'TEXTO') return falha('DATA_INVALIDA', f.campo, `${f.rotulo}: valor inválido.`);
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bruto);
  if (m) {
    const [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!dataValida(ano, mes, dia)) return falha('DATA_INVALIDA', f.campo, `${f.rotulo}: "${bruto}" não é uma data válida (DD/MM/AAAA).`);
    return ok(`${String(ano)}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bruto);
  if (m) {
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!dataValida(ano, mes, dia)) return falha('DATA_INVALIDA', f.campo, `${f.rotulo}: "${bruto}" não é uma data válida (AAAA-MM-DD).`);
    return ok(bruto);
  }
  return falha('DATA_INVALIDA', f.campo, `${f.rotulo}: "${bruto}" — use DD/MM/AAAA (dia/mês/ano com 4 dígitos) ou AAAA-MM-DD.`);
}
