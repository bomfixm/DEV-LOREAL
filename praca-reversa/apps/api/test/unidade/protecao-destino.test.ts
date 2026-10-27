import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DestinoPasta, assinarSigV4, chaveValida, sha256 } from '../../src/modules/protecao/destino.js';
import { classificarPasta } from '../../src/modules/protecao/configuracao.js';

/**
 * Destino independente: assinatura AWS Signature V4 conferida com os exemplos
 * publicados pela AWS ("Signature Calculations for the Authorization Header:
 * Transferring Payload in a Single Chunk"), chaves seguras e pasta com troca
 * atômica e gravação confirmada.
 */
const AWS = { chaveAcesso: 'AKIAIOSFODNN7EXAMPLE', segredo: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', regiao: 'us-east-1', instante: new Date('2013-05-24T00:00:00Z') };
const VAZIO = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const assinatura = (a: string) => /Signature=([0-9a-f]{64})$/.exec(a)?.[1];

describe('AWS Signature V4 (exemplos da documentação da AWS)', () => {
  it('GET Object com Range', () => {
    const r = assinarSigV4({ ...AWS, metodo: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), cabecalhos: { Range: 'bytes=0-9', 'x-amz-content-sha256': VAZIO, 'x-amz-date': '20130524T000000Z' }, hashCorpo: VAZIO });
    expect(assinatura(r.authorization)).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(r.authorization).toContain('Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,');
  });

  it('PUT Object com caractere reservado na chave', () => {
    const corpo = sha256('Welcome to Amazon S3.');
    expect(corpo).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
    const r = assinarSigV4({
      ...AWS,
      metodo: 'PUT',
      url: new URL('https://examplebucket.s3.amazonaws.com/test%24file.text'),
      cabecalhos: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-date': '20130524T000000Z', 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': corpo },
      hashCorpo: corpo,
    });
    expect(assinatura(r.authorization)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('GET Bucket (listagem) com parâmetros de consulta ordenados', () => {
    const r = assinarSigV4({ ...AWS, metodo: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J'), cabecalhos: { 'x-amz-content-sha256': VAZIO, 'x-amz-date': '20130524T000000Z' }, hashCorpo: VAZIO });
    expect(assinatura(r.authorization)).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });
});

describe('Chaves e pasta', () => {
  let pastas: string[] = [];
  afterEach(() => {
    for (const p of pastas) rmSync(p, { recursive: true, force: true });
    pastas = [];
  });

  it('recusa chave com "..", barra inicial ou caracteres fora da lista', () => {
    expect(chaveValida('planilha/escopo/arquivo-r000001.xlsx')).toBe('planilha/escopo/arquivo-r000001.xlsx');
    for (const ruim of ['../fora.txt', '/absoluto.txt', 'a//b', 'a/../b', 'com espaço.txt', 'a\\b']) expect(() => chaveValida(ruim)).toThrow();
  });

  it('pasta: grava por troca atômica, relê, lista sem temporários e apaga', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'praca-destino-'));
    pastas.push(raiz);
    const d = new DestinoPasta(raiz, 'Pasta de teste', true, null);
    const a = await d.gravar('planilha/x/arquivo.xlsx', Buffer.from('versão 1'), 'application/octet-stream');
    expect(a.sha256).toBe(sha256(Buffer.from('versão 1')));
    await d.gravar('planilha/x/arquivo.xlsx', Buffer.from('versão 2'), 'application/octet-stream');
    expect((await d.ler('planilha/x/arquivo.xlsx'))?.toString()).toBe('versão 2');
    expect(await d.ler('planilha/x/nao-existe.xlsx')).toBeNull();
    expect((await d.listar('planilha/')).map((o) => o.chave)).toEqual(['planilha/x/arquivo.xlsx']);
    expect(readdirSync(join(raiz, 'planilha', 'x')).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    await d.apagar('planilha/x/arquivo.xlsx');
    expect(await d.listar('')).toEqual([]);
  });

  it('independência: pasta local e sincronizada não contam; compartilhamento de outra máquina conta', () => {
    expect(classificarPasta('C:\\Users\\Operacao\\OneDrive - Empresa\\Praca').independente).toBe(false);
    expect(classificarPasta('\\\\localhost\\copias').independente).toBe(false);
    expect(classificarPasta('\\\\127.0.0.1\\copias').independente).toBe(false);
    expect(classificarPasta('\\\\servidor-backup\\praca\\copias')).toMatchObject({ independente: true, motivo: null });
  });
});
