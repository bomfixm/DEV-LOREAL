import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Fluxos da interface contra o build real servido pela API (mesma origem),
 * com PostgreSQL próprio (DATABASE_URL_E2E), em perfil de computador e de
 * celular emulado.
 *
 * Navegador: Chromium do Playwright (`npx playwright install chromium`) ou um
 * navegador instalado indicado em PLAYWRIGHT_CANAL (por exemplo, chrome).
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const PORTA = Number(process.env.PORTA_E2E ?? 4310);
const URL_BASE = `http://127.0.0.1:${String(PORTA)}`;
/** Etapa 09: a mesma aplicação sob caminho-base (CAMINHO_BASE=/praca/), em outra porta. */
const PORTA_CAMINHO_BASE = Number(process.env.PORTA_E2E_CAMINHO_BASE ?? 4311);
const ORIGEM_CAMINHO_BASE = `http://127.0.0.1:${String(PORTA_CAMINHO_BASE)}`;
const SO_CAMINHO_BASE = /caminho-base\.spec\.ts/;
const canal = process.env.PLAYWRIGHT_CANAL;
const navegador = canal ? { channel: canal } : {};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/configuracao-global.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: URL_BASE,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'computador',
      testIgnore: SO_CAMINHO_BASE,
      use: { ...devices['Desktop Chrome'], ...navegador, viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'celular',
      testIgnore: SO_CAMINHO_BASE,
      use: { ...devices['Pixel 7'], ...navegador },
    },
    {
      name: 'caminho-base',
      testMatch: SO_CAMINHO_BASE,
      use: { ...devices['Desktop Chrome'], ...navegador, viewport: { width: 1440, height: 900 }, baseURL: `${ORIGEM_CAMINHO_BASE}/praca/` },
    },
  ],
  webServer: [
    {
      // Prepara o banco de E2E (migração, seed, administrador) e sobe a API com o build da interface.
      command: 'node scripts/preparar-e2e.mjs && node apps/api/dist/server.js',
      url: `${URL_BASE}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(PORTA),
        HOST: '127.0.0.1',
        LOG_LEVEL: 'warn',
        APP_AMBIENTE: 'teste',
        COOKIE_SEGURO: 'false',
        CAMINHO_BASE: '/',
        // Links das etiquetas QR: o próprio servidor de teste (endereço local).
        APP_URL_PUBLICA: URL_BASE,
        DATABASE_URL: process.env.DATABASE_URL_E2E ?? '',
      },
    },
    {
      // Etapa 09: build da interface com caminho-base em dist-praca e a mesma API sob /praca/ (mesmo banco de E2E).
      command: 'npm run build -w @praca-reversa/web && node apps/api/dist/server.js',
      url: `${ORIGEM_CAMINHO_BASE}/praca/api/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        PORT: String(PORTA_CAMINHO_BASE),
        HOST: '127.0.0.1',
        LOG_LEVEL: 'warn',
        APP_AMBIENTE: 'teste',
        COOKIE_SEGURO: 'false',
        CAMINHO_BASE: '/praca/',
        PASTA_SAIDA_WEB: 'dist-praca',
        WEB_DIST: 'apps/web/dist-praca',
        APP_URL_PUBLICA: ORIGEM_CAMINHO_BASE,
        DATABASE_URL: process.env.DATABASE_URL_E2E ?? '',
      },
    },
  ],
});
