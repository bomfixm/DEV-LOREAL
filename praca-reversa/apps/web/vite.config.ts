import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** API usada pelo proxy de desenvolvimento e do preview (mesma origem para a interface). */
const API_DESTINO = process.env.API_DESTINO ?? 'http://127.0.0.1:3000';

/**
 * Caminho-base da instalação (etapa 09): o mesmo CAMINHO_BASE do servidor,
 * do ambiente ou do .env da raiz (o ambiente prevalece). "/" por padrão.
 */
function caminhoBase(): string {
  let valor = process.env.CAMINHO_BASE;
  const env = new URL('../../.env', import.meta.url);
  if (valor === undefined && existsSync(env)) valor = parseEnv(readFileSync(env, 'utf8')).CAMINHO_BASE;
  if (valor === undefined || valor === '' || valor === '/') return '/';
  const base = valor.endsWith('/') ? valor : `${valor}/`;
  if (!/^\/(?:[A-Za-z0-9_~-][A-Za-z0-9._~-]*\/)+$/.test(base)) throw new Error(`CAMINHO_BASE inválido: ${valor}`);
  return base;
}

const BASE = caminhoBase();
const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const VERSAO = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  base: BASE,
  define: {
    __VERSAO_INTERFACE__: JSON.stringify(VERSAO),
  },
  plugins: [
    react(),
    VitePWA({
      // Etapa 09: a nova versão espera a ação "Atualizar" (aviso na interface,
      // src/pwa/atualizacao.ts); nada é ativado durante uma contagem.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'robots.txt', 'icons/apple-touch-icon-180.png'],
      manifest: {
        // Endereços relativos ao manifest: valem com qualquer caminho-base.
        // Com "/", o id continua resolvendo para "/" (mesma identidade da etapa 01).
        id: './',
        name: 'Praça Reversa',
        short_name: 'Praça Reversa',
        description: 'Mapa de paletes e devoluções. Demonstração com dados fictícios.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#F4F4F1',
        theme_color: '#FFCC00',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Somente a casca da interface (e o decodificador da câmera). Respostas da
        // API, downloads e anexos nunca são guardados pelo service worker: sem
        // conexão, a interface informa a falta de dados.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,txt,wasm}'],
        // Decodificador WebAssembly da câmera (~1,1 MB).
        maximumFileSizeToCacheInBytes: 3 * 1_048_576,
        // O index.html só responde navegações da interface: nunca a API,
        // downloads ou arquivos (caminho com extensão).
        navigateFallback: 'index.html',
        navigateFallbackAllowlist: [new RegExp(`^${escapar(BASE)}`)],
        navigateFallbackDenylist: [new RegExp(`^${escapar(BASE)}api(?:/|$)`), /\/[^/?]+\.[^/?]+(?:\?.*)?$/],
        cleanupOutdatedCaches: true,
        // Sem runtimeCaching: nada fora do precache entra no Cache Storage.
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { [`${BASE}api`]: API_DESTINO },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: { [`${BASE}api`]: API_DESTINO },
  },
  build: {
    sourcemap: true,
    outDir: process.env.PASTA_SAIDA_WEB ?? 'dist',
    rolldownOptions: {
      output: {
        // Leaflet (mapa) em bloco próprio: carregado na abertura junto com o restante, mas sem
        // inflar o bloco principal acima do aviso de 500 kB (etapa 10).
        codeSplitting: { groups: [{ name: 'leaflet', test: /node_modules[\\/]leaflet[\\/]/ }] },
      },
    },
  },
});
