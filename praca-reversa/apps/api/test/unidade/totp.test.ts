import { describe, expect, it } from 'vitest';
import {
  base32Codificar,
  base32Decodificar,
  cifrarSegredo,
  codigoDoPasso,
  decifrarSegredo,
  gerarCodigosRecuperacao,
  hashCodigoRecuperacao,
  passoDe,
  uriOtpauth,
  verificarTotp,
} from '../../src/modules/acesso/totp.js';

// Vetores oficiais do RFC 6238 (SHA-1, segredo ASCII "12345678901234567890"), 6 últimos dígitos.
const SEGREDO_RFC = Buffer.from('12345678901234567890');
const VETORES: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(VETORES)('gera o código oficial para o instante %i', (segundos, esperado) => {
    expect(codigoDoPasso(SEGREDO_RFC, passoDe(segundos * 1000))).toBe(esperado);
  });

  it('base32 vai e volta, e o segredo do RFC tem a forma conhecida', () => {
    expect(base32Codificar(SEGREDO_RFC)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decodificar('gezd gnbv-GY3TQOJQGEZDGNBVGY3TQOJQ====').equals(SEGREDO_RFC)).toBe(true);
    expect(() => base32Decodificar('1!')).toThrow();
  });

  it('aceita o passo atual e os vizinhos, recusa mais distantes', () => {
    const t = 1_700_000_000_000;
    const p = passoDe(t);
    expect(verificarTotp(SEGREDO_RFC, codigoDoPasso(SEGREDO_RFC, p), t, null)).toBe(p);
    expect(verificarTotp(SEGREDO_RFC, codigoDoPasso(SEGREDO_RFC, p - 1), t, null)).toBe(p - 1);
    expect(verificarTotp(SEGREDO_RFC, codigoDoPasso(SEGREDO_RFC, p + 1), t, null)).toBe(p + 1);
    expect(verificarTotp(SEGREDO_RFC, codigoDoPasso(SEGREDO_RFC, p - 2), t, null)).toBeNull();
    expect(verificarTotp(SEGREDO_RFC, codigoDoPasso(SEGREDO_RFC, p + 2), t, null)).toBeNull();
  });

  it('não aceita o mesmo código duas vezes nem um anterior ao último usado', () => {
    const t = 1_700_000_000_000;
    const p = passoDe(t);
    expect(verificarTotp(SEGREDO_RFC, codigoDoPasso(SEGREDO_RFC, p), t, p)).toBeNull();
    expect(verificarTotp(SEGREDO_RFC, codigoDoPasso(SEGREDO_RFC, p - 1), t, p)).toBeNull();
    expect(verificarTotp(SEGREDO_RFC, codigoDoPasso(SEGREDO_RFC, p + 1), t, p)).toBe(p + 1);
  });

  it('recusa formatos inválidos e aceita espaço no meio (como o aplicativo mostra)', () => {
    const t = 1_700_000_000_000;
    const c = codigoDoPasso(SEGREDO_RFC, passoDe(t));
    expect(verificarTotp(SEGREDO_RFC, '12345', t, null)).toBeNull();
    expect(verificarTotp(SEGREDO_RFC, 'abcdef', t, null)).toBeNull();
    expect(verificarTotp(SEGREDO_RFC, `${c.slice(0, 3)} ${c.slice(3)}`, t, null)).toBe(passoDe(t));
  });

  it('monta o endereço otpauth para o QR', () => {
    const uri = uriOtpauth('maria', SEGREDO_RFC);
    expect(uri).toMatch(/^otpauth:\/\/totp\/Pra%C3%A7a%20Reversa%3Amaria\?/);
    expect(uri).toContain('secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('segredo cifrado e códigos de recuperação', () => {
  const APP = 'segredo-da-aplicacao-com-mais-de-32-caracteres';

  it('cifra e decifra; o texto cifrado não mostra o segredo; chave errada ou adulteração falham', () => {
    const cifrado = cifrarSegredo(SEGREDO_RFC, APP);
    expect(cifrado).not.toContain(SEGREDO_RFC.toString('base64url'));
    expect(decifrarSegredo(cifrado, APP).equals(SEGREDO_RFC)).toBe(true);
    expect(cifrarSegredo(SEGREDO_RFC, APP)).not.toBe(cifrado);
    expect(() => decifrarSegredo(cifrado, 'outro-segredo-com-mais-de-32-caracteres-x')).toThrow();
    const partes = cifrado.split('.');
    partes[3] = Buffer.from('adulterado').toString('base64url');
    expect(() => decifrarSegredo(partes.join('.'), APP)).toThrow();
  });

  it('gera 8 códigos únicos no formato XXXXX-XXXXX; o hash ignora maiúsculas, hífen e espaço', () => {
    const codigos = gerarCodigosRecuperacao();
    expect(codigos).toHaveLength(8);
    expect(new Set(codigos).size).toBe(8);
    for (const c of codigos) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const c = codigos[0] ?? '';
    expect(hashCodigoRecuperacao(c.toLowerCase().replace('-', ' '), APP)).toBe(hashCodigoRecuperacao(c, APP));
    expect(hashCodigoRecuperacao(c, APP)).not.toBe(hashCodigoRecuperacao(codigos[1] ?? '', APP));
    expect(hashCodigoRecuperacao(c, APP)).toMatch(/^[0-9a-f]{64}$/);
  });
});
