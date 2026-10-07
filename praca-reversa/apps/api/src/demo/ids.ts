import { createHash } from 'node:crypto';

/** Namespace próprio das fixtures da Praça Reversa. */
const NAMESPACE = Buffer.from('b1f7c0de5e7a4c1b9a6e7d3f2a1b0c9d', 'hex');

/**
 * UUID versão 5 (SHA-1, RFC 9562) derivado de um nome estável. Usado só nas
 * fixtures: o mesmo seed gera sempre os mesmos IDs, sem depender de ordem.
 */
export function idDeterministico(nome: string): string {
  const hash = createHash('sha1').update(NAMESPACE).update(nome, 'utf8').digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * UUID determinístico igual ao da função SQL `uuid_deterministico` (MD5 do
 * nome, versão 3, variante RFC 9562). A migração da etapa 04 converteu a carga
 * legada da demonstração com esses IDs; o seed usa os mesmos, então rodar o
 * seed depois da migração não duplica nada.
 */
export function idDemoMd5(nome: string): string {
  const hash = createHash('md5').update(nome, 'utf8').digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x30;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
