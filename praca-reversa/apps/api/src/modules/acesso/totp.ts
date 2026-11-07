import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Código de 6 dígitos que muda a cada 30 s (TOTP, RFC 6238 / HOTP, RFC 4226),
 * o mesmo padrão do Google Authenticator, Microsoft Authenticator e Authy.
 * Sem dependência externa: só o módulo `crypto` do Node.
 */
const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PERIODO_S = 30;
export const DIGITOS = 6;
/** Tolerância a relógios levemente diferentes: o passo atual, o anterior e o seguinte. */
const JANELA_PASSOS = 1;

export function base32Codificar(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO_BASE32.charAt((valor >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO_BASE32.charAt((valor << (5 - bits)) & 31);
  return saida;
}

export function base32Decodificar(texto: string): Buffer {
  const limpo = texto.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpo) {
    const i = ALFABETO_BASE32.indexOf(c);
    if (i < 0) throw new Error('Texto base32 inválido.');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function gerarSegredoTotp(): Buffer {
  return randomBytes(20);
}

/** Código de `DIGITOS` dígitos para o passo (contador) informado. */
export function codigoDoPasso(segredo: Buffer, passo: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const hmac = createHmac('sha1', segredo).update(contador).digest();
  const deslocamento = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const numero = (hmac.readUInt32BE(deslocamento) & 0x7fffffff) % 10 ** DIGITOS;
  return String(numero).padStart(DIGITOS, '0');
}

export function passoDe(instanteMs: number): number {
  return Math.floor(instanteMs / 1000 / PERIODO_S);
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Confere o código. Devolve o passo aceito, ou null. Um passo igual ou menor
 * que `ultimoPasso` é recusado: o mesmo código não vale duas vezes.
 */
export function verificarTotp(segredo: Buffer, codigo: string, instanteMs: number, ultimoPasso: number | null): number | null {
  const limpo = codigo.replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpo)) return null;
  const atual = passoDe(instanteMs);
  let aceito: number | null = null;
  // Percorre todos os passos da janela (sem parar no primeiro) para não variar o tempo.
  for (let p = atual - JANELA_PASSOS; p <= atual + JANELA_PASSOS; p++) {
    if (iguais(codigoDoPasso(segredo, p), limpo) && (ultimoPasso === null || p > ultimoPasso)) aceito = p;
  }
  return aceito;
}

export function uriOtpauth(login: string, segredo: Buffer, emissor = 'Praça Reversa'): string {
  const rotulo = encodeURIComponent(`${emissor}:${login}`);
  const parametros = new URLSearchParams({ secret: base32Codificar(segredo), issuer: emissor, algorithm: 'SHA1', digits: String(DIGITOS), period: String(PERIODO_S) });
  return `otpauth://totp/${rotulo}?${parametros.toString()}`;
}

function chaveDeCifra(appSegredo: string): Buffer {
  return createHmac('sha256', appSegredo).update('segundo-fator:cifra:v1').digest();
}

/** AES-256-GCM: o banco guarda só o segredo cifrado; sem APP_SEGREDO ele não serve. */
export function cifrarSegredo(segredo: Buffer, appSegredo: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chaveDeCifra(appSegredo), iv);
  const dados = Buffer.concat([cifra.update(segredo), cifra.final()]);
  return ['v1', iv.toString('base64url'), cifra.getAuthTag().toString('base64url'), dados.toString('base64url')].join('.');
}

export function decifrarSegredo(texto: string, appSegredo: string): Buffer {
  const [versao, iv, etiqueta, dados] = texto.split('.');
  if (versao !== 'v1' || !iv || !etiqueta || !dados) throw new Error('Segredo do segundo fator em formato desconhecido.');
  const decifra = createDecipheriv('aes-256-gcm', chaveDeCifra(appSegredo), Buffer.from(iv, 'base64url'));
  decifra.setAuthTag(Buffer.from(etiqueta, 'base64url'));
  return Buffer.concat([decifra.update(Buffer.from(dados, 'base64url')), decifra.final()]);
}

const ALFABETO_RECUPERACAO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Códigos de uso único para quem perder o celular: `XXXXX-XXXXX`. */
export function gerarCodigosRecuperacao(quantidade = 8): string[] {
  return Array.from({ length: quantidade }, () => {
    const bytes = randomBytes(10);
    const letras = Array.from(bytes, (b) => ALFABETO_RECUPERACAO[b % ALFABETO_RECUPERACAO.length]).join('');
    return `${letras.slice(0, 5)}-${letras.slice(5)}`;
  });
}

export function normalizarCodigoRecuperacao(codigo: string): string {
  return codigo.replace(/[\s-]/g, '').toUpperCase();
}

/** O banco guarda só o HMAC do código de recuperação. */
export function hashCodigoRecuperacao(codigo: string, appSegredo: string): string {
  return createHmac('sha256', appSegredo).update(`segundo-fator:recuperacao:${normalizarCodigoRecuperacao(codigo)}`).digest('hex');
}
