import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unidade',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'apps/web/src/**/*.test.ts', 'apps/api/test/unidade/**/*.test.ts'],
        },
      },
      {
        // PostgreSQL real (DATABASE_URL_TESTE). Arquivos em série: o banco é compartilhado.
        test: {
          name: 'banco',
          environment: 'node',
          include: ['apps/api/test/banco/**/*.test.ts'],
          globalSetup: ['apps/api/test/banco/preparar-banco.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
