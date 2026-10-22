import { readFileSync } from 'node:fs';

/** Credenciais aleatórias geradas a cada execução (não versionadas). */
export const ARQUIVO_CREDENCIAIS = '.dados/e2e/credenciais.json';

/** Escopo de testes de cadastro (não demonstrativo), criado em scripts/preparar-e2e.mjs. */
export const ESCOPO_CADASTRO = 'Unidade de teste E2E · Cliente de teste E2E';

export interface Credencial {
  login: string;
  senha: string;
}

export interface Credenciais {
  /** Administrador dos dois escopos de demonstração (comando admin:criar). */
  admin: Credencial;
  /** Consulta no escopo da praça informada. */
  consulta: Credencial;
  /** Consulta na praça informada; desativada durante o teste de administração. */
  descartavel: Credencial;
  /** Consulta somente no cenário de navegação. */
  restrito: Credencial;
  /** Consulta no cenário de navegação (testes de navegação com mais paletes). */
  consultaNavegacao: Credencial;
  /** Operador na praça informada (demonstração): imprime etiquetas, não altera contagens. */
  operadorDemo: Credencial;
  /** Supervisor na praça informada (demonstração): usado só nas capturas da conferência. */
  supervisorDemo: Credencial;
  /** Analista de claims na praça informada (demonstração): capturas da etapa 07. */
  analistaDemo: Credencial;
  /** Analista com aprovação financeira concedida na praça informada (demonstração). */
  financeiroDemo: Credencial;
  /** Administrador do escopo de cadastro (comando admin:criar com --unidade/--cliente). */
  adminCadastro: Credencial;
  /** Supervisor de estoque no escopo de cadastro: produtos, layout, paletes. */
  supervisor: Credencial;
  /** Operador no escopo de cadastro: paletes e etiquetas. */
  operador: Credencial;
  /** Consulta no escopo de cadastro. */
  consultaCadastro: Credencial;
  /** Analista de claims no escopo de cadastro. */
  analista: Credencial;
  /** Analista com aprovação financeira concedida no escopo de cadastro. */
  financeiro: Credencial;
  /** Administrador de um escopo sem paletes (etapa 10: tutorial em ambiente vazio). */
  adminVazio: Credencial;
  /** Consulta na praça informada que nunca viu o tutorial (um por perfil de aparelho). */
  tutorialComputador: Credencial;
  tutorialCelular: Credencial;
  /** Consulta na praça informada que responde "Agora não" ao convite. */
  tutorialAdiar: Credencial;
  /** Acesso de consulta do cliente (CLIENTE_CONSULTA) na praça informada (demonstração). */
  clienteDemo: Credencial;
}

export function credenciais(): Credenciais {
  return JSON.parse(readFileSync(ARQUIVO_CREDENCIAIS, 'utf8')) as Credenciais;
}
