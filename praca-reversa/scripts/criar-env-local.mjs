// Cria o .env local a partir do .env.example com uma senha aleatória para o
// PostgreSQL de desenvolvimento. Não sobrescreve um .env existente.
// Uso: npm run env:local
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');
const destino = resolve(raiz, '.env');

if (existsSync(destino)) {
  console.log('.env já existe; nada foi alterado.');
  process.exit(0);
}

const senha = randomBytes(24).toString('base64url');
const segredo = randomBytes(48).toString('base64url');
const modelo = readFileSync(resolve(raiz, '.env.example'), 'utf8');
const conteudo =
  `# Gerado por npm run env:local em ${new Date().toISOString()}. Não versionar.\n` +
  modelo.replaceAll('TROQUE_ESTA_SENHA', senha).replace('TROQUE_ESTE_SEGREDO_POR_UM_VALOR_ALEATORIO', segredo).replace(/^# Modelo de configuração[\s\S]*?\n\n/, '');

writeFileSync(destino, conteudo, { encoding: 'utf8', mode: 0o600 });
console.log('.env criado com senha do PostgreSQL local e segredo da aplicação aleatórios (os valores não são exibidos).');
