import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// O Prisma 7 não carrega .env sozinho. O .env local fica na raiz do repositório.
const arquivoEnv = new URL('../../.env', import.meta.url);
if (existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrações e comandos administrativos: conexão DIRETA (DIRECT_URL, sem pooler) quando existir; a aplicação usa DATABASE_URL (pooled).
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
});
