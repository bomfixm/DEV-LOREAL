/**
 * Cria o primeiro administrador de um ou mais escopos. Comando local, com
 * acesso direto ao banco; não existe rota HTTP equivalente nem senha padrão.
 * Recusa-se se algum escopo alvo já tiver administrador ativo: as demais
 * contas são criadas pela administração de acesso da interface/API.
 *
 * Uso:
 *   npm run admin:criar -- --login maria --nome "Maria Souza"
 *     (todos os escopos existentes)
 *   npm run admin:criar -- --login maria --nome "Maria Souza" --unidade U1 --cliente C1
 *     [--unidade-nome "..." --cliente-nome "..."]  (cria o escopo se não existir)
 * A senha é digitada sem eco (ou lida da primeira linha da entrada padrão).
 */
import { parseArgs } from 'node:util';
import { carregarEnvLocal } from '../config.js';
import { criarBanco } from '../db/cliente.js';
import { criarPrimeiroAdministrador } from '../modules/acesso/bootstrap.js';
import { obterSenhaDoOperador } from './entrada-senha.js';

async function principal() {
  const { values } = parseArgs({
    options: {
      login: { type: 'string' },
      nome: { type: 'string' },
      unidade: { type: 'string' },
      cliente: { type: 'string' },
      'unidade-nome': { type: 'string' },
      'cliente-nome': { type: 'string' },
    },
  });
  if (!values.login || !values.nome) {
    console.error('Uso: npm run admin:criar -- --login <login> --nome "<nome>" [--unidade <código> --cliente <código>]');
    process.exit(1);
  }
  carregarEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido.');
  const senha = await obterSenhaDoOperador();
  const db = criarBanco(url, (erro) => {
    console.error(erro.message);
  });
  try {
    const resultado = await criarPrimeiroAdministrador(db, {
      login: values.login,
      nome: values.nome,
      senha,
      unidade: values.unidade ? { codigo: values.unidade, nome: values['unidade-nome'] } : undefined,
      cliente: values.cliente ? { codigo: values.cliente, nome: values['cliente-nome'] } : undefined,
    });
    console.log(`Administrador "${values.login.toLowerCase()}" criado com acesso a: ${resultado.escopos.join(', ')}.`);
  } finally {
    await db.$disconnect();
  }
}

await principal().catch((erro: unknown) => {
  const mensagem =
    erro instanceof Error && 'issues' in erro ? 'Login ou senha fora da política (login 3–64, senha mínima de 12 caracteres).' : erro instanceof Error ? erro.message : String(erro);
  console.error(mensagem);
  process.exit(1);
});
