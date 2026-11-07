import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { montarPoliticaDeConteudo, registrarSeguranca } from '../../src/http/seguranca.js';

const SCRIPT_TEMA = "\n      (function () { document.documentElement.setAttribute('data-tema', 'claro'); })();\n    ";
const INDICE = `<!doctype html><html><head>
<script>${SCRIPT_TEMA}</script>
<script type="module" crossorigin src="/assets/index-abc.js"></script>
</head><body><div id="raiz"></div></body></html>`;

describe('política de conteúdo', () => {
  it('libera só o script embutido pelo hash e nunca o script externo nem unsafe-inline em scripts', () => {
    const hash = createHash('sha256').update(SCRIPT_TEMA).digest('base64');
    const politica = montarPoliticaDeConteudo(INDICE);
    const scripts = politica.split('; ').find((d) => d.startsWith('script-src ')) ?? '';
    expect(scripts).toContain(`'sha256-${hash}'`);
    expect(scripts).toContain("'self'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain('http');
    // O script com src não gera hash: só o embutido.
    expect(scripts.match(/sha256-/g)).toHaveLength(1);
  });

  it('só fala com o próprio servidor e não aceita ser embutida em outro site', () => {
    const politica = montarPoliticaDeConteudo(INDICE);
    expect(politica).toContain("default-src 'self'");
    expect(politica).toContain("connect-src 'self'");
    expect(politica).toContain("frame-ancestors 'none'");
    expect(politica).toContain("object-src 'none'");
    expect(politica).toContain("base-uri 'self'");
  });
});

describe('cabeçalhos de segurança nas respostas', () => {
  async function responder(opcoes: Parameters<typeof registrarSeguranca>[2]) {
    const app = Fastify();
    registrarSeguranca(app, '/', opcoes);
    app.get('/api/v1/teste', () => ({ ok: true }));
    app.get('/', () => 'pagina');
    await app.ready();
    const resposta = await app.inject({ method: 'GET', url: '/' });
    await app.close();
    return resposta.headers;
  }

  it('envia política de conteúdo, câmera só do próprio site e isolamento de origem', async () => {
    const h = await responder({ politicaDeConteudo: montarPoliticaDeConteudo(INDICE) });
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['permissions-policy']).toContain('camera=(self)');
    expect(h['permissions-policy']).toContain('microphone=()');
    expect(h['permissions-policy']).toContain('geolocation=()');
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['cross-origin-resource-policy']).toBe('same-origin');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  it('só manda HSTS quando o servidor está sob HTTPS', async () => {
    expect((await responder({ hsts: false }))['strict-transport-security']).toBeUndefined();
    expect((await responder({ hsts: true }))['strict-transport-security']).toContain('max-age=31536000');
  });

  it('sem política configurada (interface servida pelo Vite) não inventa uma', async () => {
    expect((await responder({ politicaDeConteudo: null }))['content-security-policy']).toBeUndefined();
  });
});
