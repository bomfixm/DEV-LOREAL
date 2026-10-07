import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Identificador opaco de sessão: 256 bits aleatórios. */
export function gerarTokenSessao(): string {
  return randomBytes(32).toString('base64url');
}

/** No banco fica apenas o SHA-256 do identificador. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Token anti-CSRF derivado do identificador de sessão (HMAC). Só quem lê
 * respostas da própria origem o recebe; o cookie HttpOnly não é legível por
 * scripts, e nada além do hash da sessão é guardado.
 */
export function tokenCsrf(tokenSessao: string): string {
  return createHmac('sha256', tokenSessao).update('praca-reversa:csrf:v1').digest('base64url');
}

export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
