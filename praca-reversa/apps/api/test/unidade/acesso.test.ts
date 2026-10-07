import { argon2 } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LimitadorTentativas } from '../../src/modules/acesso/limitador.js';
import { gerarHashSenha, verificarSenha } from '../../src/modules/acesso/senhas.js';
import { gerarTokenSessao, hashToken, iguaisEmTempoConstante, tokenCsrf } from '../../src/modules/acesso/tokens.js';
import { hashPayload, jsonCanonico } from '../../src/modules/idempotencia/executar.js';

describe('Argon2id', () => {
  it('a implementação do Node confere com o vetor de teste da RFC 9106 (seção 5.3)', async () => {
    const tag = await new Promise<Buffer>((resolver, rejeitar) => {
      argon2(
        'argon2id',
        {
          message: Buffer.alloc(32, 0x01),
          nonce: Buffer.alloc(16, 0x02),
          secret: Buffer.alloc(8, 0x03),
          associatedData: Buffer.alloc(12, 0x04),
          parallelism: 4,
          tagLength: 32,
          memory: 32,
          passes: 3,
        },
        (erro, chave) => {
          if (erro) rejeitar(erro);
          else resolver(chave);
        },
      );
    });
    expect(tag.toString('hex')).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  });

  it('gera hash PHC com sal aleatório e verifica somente a senha correta', async () => {
    const a = await gerarHashSenha('correta-horse-battery');
    const b = await gerarHashSenha('correta-horse-battery');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b);
    expect(await verificarSenha('correta-horse-battery', a)).toBe(true);
    expect(await verificarSenha('correta-horse-batterY', a)).toBe(false);
    expect(await verificarSenha('qualquer', 'formato-invalido')).toBe(false);
  });
});

describe('tokens de sessão e CSRF', () => {
  it('identificador opaco com 256 bits e hash SHA-256 armazenável', () => {
    const token = gerarTokenSessao();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gerarTokenSessao()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('token anti-CSRF é estável por sessão e diferente entre sessões', () => {
    const a = gerarTokenSessao();
    const b = gerarTokenSessao();
    expect(tokenCsrf(a)).toBe(tokenCsrf(a));
    expect(tokenCsrf(a)).not.toBe(tokenCsrf(b));
    expect(tokenCsrf(a)).not.toContain(a);
    expect(iguaisEmTempoConstante('abc', 'abc')).toBe(true);
    expect(iguaisEmTempoConstante('abc', 'abd')).toBe(false);
    expect(iguaisEmTempoConstante('abc', 'abcd')).toBe(false);
  });
});

describe('limite de tentativas', () => {
  it('bloqueia na janela e libera quando as tentativas saem dela', () => {
    let agora = 0;
    const limitador = new LimitadorTentativas({ maximo: 3, janelaMs: 1_000 }, () => agora);
    for (let i = 0; i < 3; i++) limitador.registrar('maria');
    expect(limitador.bloqueadoPor('maria')).toBe(1);
    expect(limitador.bloqueadoPor('outra')).toBe(0);
    agora = 1_001;
    expect(limitador.bloqueadoPor('maria')).toBe(0);
    limitador.registrar('maria');
    limitador.limpar('maria');
    expect(limitador.bloqueadoPor('maria')).toBe(0);
  });
});

describe('hash de idempotência', () => {
  it('JSON canônico independe da ordem das chaves', () => {
    expect(jsonCanonico({ b: 1, a: { d: [1, 2], c: null } })).toBe(jsonCanonico({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(jsonCanonico({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('HMAC depende do segredo e do conteúdo', () => {
    const p = { corpo: { login: 'x', initialPassword: 'segredo' } };
    expect(hashPayload('s1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', p)).not.toBe(hashPayload('s2-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', p));
    expect(hashPayload('s1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', p)).toBe(hashPayload('s1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', { ...p }));
  });
});
