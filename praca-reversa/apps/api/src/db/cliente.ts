import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type Banco = PrismaClient;
export type Transacao = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Prisma 7 com driver adapter `pg`. Tempo limite de conexão explícito: o
 * padrão do `pg` é esperar indefinidamente. Erros de conexões ociosas são
 * registrados em vez de derrubar o processo.
 */
export interface OpcoesPool {
  /** Conexões por processo (padrão 10; em Functions, poucas por instância). */
  max?: number;
  /** Espera para conectar (padrão 5 s; o Neon pode precisar acordar). */
  conexaoTimeoutMs?: number;
  ociosoTimeoutMs?: number;
}

export function criarBanco(databaseUrl: string, aoErroDoPool: (erro: Error) => void, opcoes: OpcoesPool = {}): Banco {
  const adapter = new PrismaPg(
    { connectionString: databaseUrl, max: opcoes.max ?? 10, connectionTimeoutMillis: opcoes.conexaoTimeoutMs ?? 5_000, idleTimeoutMillis: opcoes.ociosoTimeoutMs ?? 30_000 },
    { onPoolError: aoErroDoPool },
  );
  return new PrismaClient({ adapter });
}

/** Indica falha de comunicação com o banco (indisponível, recusado, tempo esgotado). */
export function ehFalhaDeConexao(erro: unknown): boolean {
  const texto = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
  const textos: string[] = [];
  let atual: unknown = erro;
  for (let i = 0; i < 5 && atual; i++) {
    if (typeof atual === 'object') {
      const o = atual as { code?: unknown; message?: unknown; name?: unknown; cause?: unknown; kind?: unknown };
      textos.push(texto(o.code), texto(o.message), texto(o.name), texto(o.kind));
      atual = o.cause;
    } else {
      textos.push(texto(atual));
      atual = undefined;
    }
  }
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|P1001|P1002|P1017|DatabaseNotReachable|Connection terminated|connection timeout|timeout exceeded when trying to connect|Can't reach database/i.test(textos.join(' '));
}
