import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Hash de senha com Argon2id (crypto.argon2 do Node.js 24, OpenSSL).
 * Parâmetros: 19 MiB, 2 passagens, 1 via — mínimo recomendado pela OWASP
 * para Argon2id. Formato PHC: $argon2id$v=19$m=…,t=…,p=…$sal$hash.
 */
export interface ParametrosArgon2 {
  memoria: number;
  passagens: number;
  paralelismo: number;
}

export const PARAMETROS_PADRAO: ParametrosArgon2 = { memoria: 19_456, passagens: 2, paralelismo: 1 };
const TAMANHO_SAL = 16;
const TAMANHO_HASH = 32;

function derivar(senha: string, sal: Buffer, p: ParametrosArgon2, tamanho: number): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    argon2(
      'argon2id',
      { message: senha, nonce: sal, memory: p.memoria, passes: p.passagens, parallelism: p.paralelismo, tagLength: tamanho },
      (erro, chave) => {
        if (erro) rejeitar(erro);
        else resolver(chave);
      },
    );
  });
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

export async function gerarHashSenha(senha: string, p: ParametrosArgon2 = PARAMETROS_PADRAO): Promise<string> {
  const sal = randomBytes(TAMANHO_SAL);
  const hash = await derivar(senha, sal, p, TAMANHO_HASH);
  return `$argon2id$v=19$m=${String(p.memoria)},t=${String(p.passagens)},p=${String(p.paralelismo)}$${b64(sal)}$${b64(hash)}`;
}

const FORMATO = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function verificarSenha(senha: string, hashArmazenado: string): Promise<boolean> {
  const partes = FORMATO.exec(hashArmazenado);
  if (!partes) return false;
  const [, m, t, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(String(hashB64), 'base64');
  const obtido = await derivar(
    senha,
    Buffer.from(String(salB64), 'base64'),
    { memoria: Number(m), passagens: Number(t), paralelismo: Number(p) },
    esperado.length,
  );
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

/** Hash fixo usado quando o login não existe, para igualar o tempo de resposta. */
let hashFicticio: Promise<string> | undefined;
export function hashParaContaInexistente(): Promise<string> {
  hashFicticio ??= gerarHashSenha(randomBytes(32).toString('hex'));
  return hashFicticio;
}
