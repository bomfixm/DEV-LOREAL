import type { FullConfig } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ARQUIVO_CREDENCIAIS, ESCOPO_CADASTRO, type Credenciais, type Credencial } from './credenciais';

interface Sessao {
  cookie: string;
  csrf: string;
  scopes: { id: string; name: string }[];
}

/**
 * Cria os usuários de teste pela própria administração de acesso da API,
 * com senhas aleatórias (nada fixo em código). Os administradores vêm do
 * comando local admin:criar, executado em scripts/preparar-e2e.mjs. O layout
 * do escopo de cadastro é criado pela API de configuração (supervisor).
 */
export default async function configuracaoGlobal(config: FullConfig): Promise<void> {
  const base = String(config.projects[0]?.use.baseURL);
  const { admin, adminCadastro, adminVazio } = JSON.parse(readFileSync(ARQUIVO_CREDENCIAIS, 'utf8')) as Pick<Credenciais, 'admin' | 'adminCadastro' | 'adminVazio'>;

  const entrar = async (quem: Credencial): Promise<Sessao> => {
    const login = await fetch(`${base}/api/v1/sessao`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: quem.login, senha: quem.senha }),
    });
    if (!login.ok) throw new Error(`Login de ${quem.login} falhou: ${String(login.status)}`);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const corpo = (await login.json()) as { csrfToken: string; scopes: { id: string; name: string }[] };
    return { cookie, csrf: corpo.csrfToken, scopes: corpo.scopes };
  };
  const escopo = (sessao: Sessao, nome: string) => {
    const e = sessao.scopes.find((s) => s.name.startsWith(nome));
    if (!e) throw new Error(`Escopo ${nome} não encontrado.`);
    return e.id;
  };
  const enviar = async (sessao: Sessao, metodo: string, caminho: string, corpo: unknown, idempotente = true) => {
    const resposta = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        cookie: sessao.cookie,
        'x-csrf-token': sessao.csrf,
        ...(idempotente ? { 'idempotency-key': randomUUID() } : {}),
      },
      body: JSON.stringify(corpo),
    });
    if (!resposta.ok) throw new Error(`${metodo} ${caminho} falhou: ${String(resposta.status)} ${await resposta.text()}`);
    return resposta.json() as Promise<{ id: string; revision?: number }>;
  };
  const novo = async (sessao: Sessao, loginNovo: string, nome: string, perfil: string, aprovacaoFinanceira = false): Promise<Credencial> => {
    const senha = randomBytes(18).toString('base64url');
    const criado = await enviar(sessao, 'POST', '/api/v1/admin/usuarios', { login: loginNovo, name: nome, initialPassword: senha, role: perfil });
    // Concessão explícita da aprovação financeira de claims (etapa 07).
    if (aprovacaoFinanceira) await enviar(sessao, 'PUT', `/api/v1/admin/usuarios/${criado.id}/vinculo`, { role: perfil, active: true, financialApproval: true });
    return { login: loginNovo, senha };
  };

  // Escopos de demonstração.
  const sAdmin = await entrar(admin);
  await enviar(sAdmin, 'PUT', '/api/v1/sessao/escopo', { scopeId: escopo(sAdmin, 'Praça informada') }, false);
  const consulta = await novo(sAdmin, 'consulta.e2e', 'Consulta E2E', 'CONSULTA');
  const descartavel = await novo(sAdmin, 'descartavel.e2e', 'Conta a desativar', 'CONSULTA');
  const operadorDemo = await novo(sAdmin, 'operador.demo.e2e', 'Operador demonstração E2E', 'OPERADOR');
  const supervisorDemo = await novo(sAdmin, 'supervisor.demo.e2e', 'Supervisor demonstração E2E', 'SUPERVISOR_ESTOQUE');
  const analistaDemo = await novo(sAdmin, 'analista.demo.e2e', 'Analista de claims (demonstração)', 'ANALISTA_CLAIMS');
  const financeiroDemo = await novo(sAdmin, 'financeiro.demo.e2e', 'Aprovação financeira (demonstração)', 'ANALISTA_CLAIMS', true);
  // Etapa 10: usuários que ainda não viram o tutorial (convite de primeiro acesso).
  const tutorialComputador = await novo(sAdmin, 'tutorial.pc.e2e', 'Primeiro acesso (computador)', 'CONSULTA');
  const tutorialCelular = await novo(sAdmin, 'tutorial.cel.e2e', 'Primeiro acesso (celular)', 'CONSULTA');
  const tutorialAdiar = await novo(sAdmin, 'tutorial.adiar.e2e', 'Primeiro acesso (adiar)', 'CONSULTA');
  // Painéis: acesso de consulta do cliente (projeção permitida, sem mapa nem dados internos).
  const clienteDemo = await novo(sAdmin, 'cliente.demo.e2e', 'Cliente (consulta) demonstração', 'CLIENTE_CONSULTA');
  // Cenário de navegação. A troca entre escopos pela interface é testada com
  // o administrador, que tem vínculo nos dois.
  await enviar(sAdmin, 'PUT', '/api/v1/sessao/escopo', { scopeId: escopo(sAdmin, 'Cenário de navegação') }, false);
  const restrito = await novo(sAdmin, 'restrito.e2e', 'Restrito E2E', 'CONSULTA');
  const consultaNavegacao = await novo(sAdmin, 'consulta.nav.e2e', 'Consulta navegação E2E', 'CONSULTA');

  // Escopo de cadastro: usuários e layout inicial (15 primeiro, depois 17).
  const sAdminCadastro = await entrar(adminCadastro);
  await enviar(sAdminCadastro, 'PUT', '/api/v1/sessao/escopo', { scopeId: escopo(sAdminCadastro, ESCOPO_CADASTRO) }, false);
  const supervisor = await novo(sAdminCadastro, 'supervisor.e2e', 'Supervisor E2E', 'SUPERVISOR_ESTOQUE');
  const operador = await novo(sAdminCadastro, 'operador.e2e', 'Operador E2E', 'OPERADOR');
  const consultaCadastro = await novo(sAdminCadastro, 'consulta.cad.e2e', 'Consulta cadastro E2E', 'CONSULTA');
  const analista = await novo(sAdminCadastro, 'analista.e2e', 'Analista de claims E2E', 'ANALISTA_CLAIMS');
  const financeiro = await novo(sAdminCadastro, 'financeiro.e2e', 'Aprovação financeira E2E', 'ANALISTA_CLAIMS', true);
  const sSupervisor = await entrar(supervisor);
  let revisao = (await enviar(sSupervisor, 'POST', '/api/v1/layout', { name: 'Praça de teste E2E (esquema)' })).revision ?? 1;
  for (const bloco of [
    { kind: 'UNICA', positionsPerRow: 15, title: 'Início: fileira única de 15' },
    { kind: 'PAR', positionsPerRow: 15, title: 'Par de fileiras de 15' },
    { kind: 'PAR', positionsPerRow: 17, title: 'Par de fileiras de 17' },
  ]) {
    revisao = (await enviar(sSupervisor, 'POST', '/api/v1/layout/blocos', { expectedRevision: revisao, ...bloco })).revision ?? revisao;
  }

  // As demais contas já "viram" o convite (escolheram "Agora não"): as specs das etapas
  // anteriores testam a operação, não o primeiro acesso, e não mudam de layout por causa dele.
  const veteranos = [admin, adminCadastro, adminVazio, consulta, descartavel, restrito, consultaNavegacao, operadorDemo, supervisorDemo, analistaDemo, financeiroDemo, clienteDemo, supervisor, operador, consultaCadastro, analista, financeiro];
  for (const quem of veteranos) {
    const s = await entrar(quem);
    await enviar(s, 'PUT', '/api/v1/preferencias/tutorial', { state: 'ADIADO', step: null }, false);
  }

  const credenciais: Credenciais = {
    admin,
    consulta,
    descartavel,
    restrito,
    consultaNavegacao,
    operadorDemo,
    supervisorDemo,
    analistaDemo,
    financeiroDemo,
    adminCadastro,
    supervisor,
    operador,
    consultaCadastro,
    analista,
    financeiro,
    adminVazio,
    tutorialComputador,
    tutorialCelular,
    tutorialAdiar,
    clienteDemo,
  };
  writeFileSync(ARQUIVO_CREDENCIAIS, JSON.stringify(credenciais, null, 2), { mode: 0o600 });
}
