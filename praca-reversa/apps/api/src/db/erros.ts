import { Prisma } from '../generated/prisma/client.js';

/** Violação de índice único (P2002). */
export function ehViolacaoUnica(erro: unknown): erro is Prisma.PrismaClientKnownRequestError {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002';
}

/**
 * Campos do índice violado, quando o Prisma informa (com o driver adapter, a
 * informação pode vir em `meta.target` ou na causa do adaptador).
 */
export function camposDaViolacao(erro: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = erro.meta as
    | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } } }
    | undefined;
  const campos: string[] = [];
  const juntar = (v: unknown) => {
    if (Array.isArray(v)) campos.push(...v.filter((x): x is string => typeof x === 'string'));
    else if (typeof v === 'string') campos.push(v);
  };
  juntar(meta?.target);
  juntar(meta?.driverAdapterError?.cause?.constraint?.fields);
  juntar(meta?.driverAdapterError?.cause?.constraint?.index);
  return campos.map((c) => c.replace(/"/g, ''));
}

/**
 * Conflito transitório do PostgreSQL: impasse (40P01) ou falha de
 * serialização (40001); o Prisma informa P2034 ("write conflict or deadlock").
 * A transação foi revertida inteira e pode ser repetida.
 */
export function ehConflitoTransitorio(erro: unknown): boolean {
  let atual: unknown = erro;
  for (let i = 0; i < 5 && typeof atual === 'object' && atual !== null; i++) {
    const o = atual as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown; originalCode?: unknown };
    if (o.code === 'P2034' || o.code === '40P01' || o.code === '40001' || o.originalCode === '40P01' || o.originalCode === '40001') return true;
    let texto = typeof o.message === 'string' ? o.message : '';
    try {
      const meta: unknown = JSON.stringify(o.meta);
      if (typeof meta === 'string') texto += ` ${meta}`;
    } catch {
      // meta não serializável: só a mensagem.
    }
    if (/deadlock detected|could not serialize access|\b40P01\b|\b40001\b/.test(texto)) return true;
    atual = o.cause;
  }
  return false;
}

/** Exceções dos gatilhos da etapa 04 (conferência e estoque validado). */
export const RESTRICOES_CONFERENCIA = [
  'PALETE_EM_CONFERENCIA',
  'CONFERENCIA_ENCERRADA',
  'CONFERENCIA_IMUTAVEL',
  'CONFERENCIA_TRANSICAO_INVALIDA',
  'OBSERVACAO_IMUTAVEL',
  'HISTORICO_IMUTAVEL',
] as const;
export type RestricaoConferencia = (typeof RESTRICOES_CONFERENCIA)[number];

/** Mensagem de exceção de gatilho da etapa 04, quando for o caso. */
export function restricaoDeConferencia(erro: unknown): RestricaoConferencia | null {
  let atual: unknown = erro;
  for (let i = 0; i < 5 && typeof atual === 'object' && atual !== null; i++) {
    const o = atual as { message?: unknown; meta?: unknown; cause?: unknown };
    let texto = typeof o.message === 'string' ? o.message : '';
    try {
      // JSON.stringify(undefined) devolve undefined em tempo de execução.
      const meta: unknown = JSON.stringify(o.meta);
      if (typeof meta === 'string') texto += ` ${meta}`;
    } catch {
      // meta não serializável: só a mensagem.
    }
    const encontrada = RESTRICOES_CONFERENCIA.find((r) => texto.includes(r));
    if (encontrada) return encontrada;
    atual = o.cause;
  }
  return null;
}

/**
 * Exceção lançada pelos gatilhos de proteção do banco (migração da etapa 03):
 * POSICAO_INVALIDA ou POSICAO_OCUPADA. Percorre a cadeia de causas.
 */
export function restricaoDoBanco(erro: unknown): 'POSICAO_INVALIDA' | 'POSICAO_OCUPADA' | null {
  const textoDe = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v === undefined) return '';
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  };
  let atual: unknown = erro;
  for (let i = 0; i < 5 && typeof atual === 'object' && atual !== null; i++) {
    const o = atual as { message?: unknown; meta?: unknown; cause?: unknown };
    const texto = `${textoDe(o.message)} ${textoDe(o.meta)}`;
    if (texto.includes('POSICAO_OCUPADA')) return 'POSICAO_OCUPADA';
    if (texto.includes('POSICAO_INVALIDA')) return 'POSICAO_INVALIDA';
    atual = o.cause;
  }
  return null;
}

/** Exceção dos gatilhos da importação (etapa 06): lote, linha ou documento que não pode mudar. */
export function ehRestricaoDeImportacao(erro: unknown): boolean {
  let atual: unknown = erro;
  for (let i = 0; i < 5 && typeof atual === 'object' && atual !== null; i++) {
    const o = atual as { message?: unknown; meta?: unknown; cause?: unknown };
    let texto = typeof o.message === 'string' ? o.message : '';
    try {
      const meta: unknown = JSON.stringify(o.meta);
      if (typeof meta === 'string') texto += ` ${meta}`;
    } catch {
      // meta não serializável: só a mensagem.
    }
    if (texto.includes('IMPORTACAO_IMUTAVEL')) return true;
    atual = o.cause;
  }
  return false;
}

/**
 * Proteções do banco dos claims (etapa 07): quantidade além do saldo ou da
 * linha (CHECK), registro imutável ou incoerente (gatilhos). Percorre causas.
 */
export function restricaoDeClaim(erro: unknown): 'QUANTIDADE' | 'IMUTAVEL' | null {
  let atual: unknown = erro;
  for (let i = 0; i < 5 && typeof atual === 'object' && atual !== null; i++) {
    const o = atual as { message?: unknown; meta?: unknown; cause?: unknown };
    let texto = typeof o.message === 'string' ? o.message : '';
    try {
      const meta: unknown = JSON.stringify(o.meta);
      if (typeof meta === 'string') texto += ` ${meta}`;
    } catch {
      // meta não serializável: só a mensagem.
    }
    if (texto.includes('saldo_vinculo_dentro_do_saldo') || texto.includes('linha_claim_quantidades')) return 'QUANTIDADE';
    if (texto.includes('CLAIM_IMUTAVEL') || texto.includes('CLAIM_INCOERENTE')) return 'IMUTAVEL';
    atual = o.cause;
  }
  return null;
}

/**
 * Proteções do banco das janelas (etapa 08): capacidade além do limite,
 * liberação/reserva fora do saldo, retorno acima do enviado (CHECK) e
 * registro imutável ou total incoerente (gatilhos). Percorre causas.
 */
export function restricaoDeJanela(erro: unknown): 'CAPACIDADE' | 'SALDO' | 'RETORNO' | 'IMUTAVEL' | null {
  let atual: unknown = erro;
  for (let i = 0; i < 5 && typeof atual === 'object' && atual !== null; i++) {
    const o = atual as { message?: unknown; meta?: unknown; cause?: unknown };
    let texto = typeof o.message === 'string' ? o.message : '';
    try {
      const meta: unknown = JSON.stringify(o.meta);
      if (typeof meta === 'string') texto += ` ${meta}`;
    } catch {
      // meta não serializável: só a mensagem.
    }
    if (texto.includes('restricao_dentro_do_limite')) return 'CAPACIDADE';
    if (texto.includes('saldo_liberacao_coerente') || texto.includes('saldo_nao_negativo')) return 'SALDO';
    if (texto.includes('linha_expedicao_retorno_limite')) return 'RETORNO';
    if (texto.includes('JANELA_IMUTAVEL') || texto.includes('JANELA_INCOERENTE') || texto.includes('RESERVA_INCOERENTE')) return 'IMUTAVEL';
    atual = o.cause;
  }
  return null;
}
