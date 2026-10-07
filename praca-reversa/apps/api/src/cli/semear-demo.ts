/**
 * Seed explícito da demonstração. Recusa-se a rodar com APP_AMBIENTE=producao
 * (ou sem APP_AMBIENTE).
 *
 * Uso: npm run db:semear-demo
 */
import { carregarEnvLocal } from '../config.js';
import { criarBanco } from '../db/cliente.js';
import { semearDemonstracao } from '../demo/semear.js';

async function principal() {
  carregarEnvLocal();
  const ambiente = process.env.APP_AMBIENTE ?? 'producao';
  if (ambiente === 'producao') {
    console.error('Seed de demonstração recusado: APP_AMBIENTE é "producao" (ou não foi definido).');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não definido.');
    process.exit(1);
  }
  const db = criarBanco(url, (erro) => {
    console.error(erro.message);
  });
  try {
    const { inseridos } = await semearDemonstracao(db);
    const total = Object.values(inseridos).reduce((a, b) => a + b, 0);
    console.log(total === 0 ? 'Demonstração já estava completa; nada foi inserido.' : 'Demonstração semeada (dados fictícios):');
    if (total > 0) for (const [tabela, n] of Object.entries(inseridos)) console.log(`  ${tabela}: ${String(n)}`);
  } finally {
    await db.$disconnect();
  }
}

await principal().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
