import { API_PREFIXO, PreferenciaTutorialSchema, type AtualizarTutorial, type Permissao, type PreferenciaTutorial } from '@praca-reversa/contracts';
import { createContext, useContext } from 'react';
import { enviarJson, obterJson } from '../../api/cliente';
import type { Navegar } from '../../rotas';
import { criarLoja, useLoja } from '../../utils/loja';

/**
 * Estado do tutorial de primeiro uso (etapa 10). Fica fora dos componentes
 * para continuar ativo quando o usuário navega entre telas; pertence a um
 * usuário (trocar de usuário encerra). A preferência (oferecido, adiado,
 * interrompido no passo N, concluído) fica no servidor, por usuário — nada
 * vai para o armazenamento do navegador.
 */
export interface EstadoTutorial {
  usuarioId: string | null;
  ativo: boolean;
  /** Passo atual, de 1 a PASSOS_TUTORIAL. */
  passo: number;
}

export const lojaTutorial = criarLoja<EstadoTutorial>({ usuarioId: null, ativo: false, passo: 1 });

export function iniciarTutorial(usuarioId: string, passo = 1): void {
  lojaTutorial.definir({ usuarioId, ativo: true, passo });
}

export function irParaPasso(passo: number): void {
  lojaTutorial.definir((a) => ({ ...a, passo }));
}

export function encerrarTutorial(): void {
  lojaTutorial.definir((a) => (a.ativo ? { ...a, ativo: false } : a));
}

export function useTutorial(): EstadoTutorial {
  return useLoja(lojaTutorial);
}

const URL_PREFERENCIA = `${API_PREFIXO}/preferencias/tutorial`;

/** Última preferência lida do servidor (por usuário). */
export const lojaPreferencia = criarLoja<{ usuarioId: string; dados: PreferenciaTutorial } | null>(null);

export function usePreferencia(usuarioId: string): PreferenciaTutorial | null {
  const p = useLoja(lojaPreferencia);
  return p?.usuarioId === usuarioId ? p.dados : null;
}

export async function carregarPreferencia(usuarioId: string): Promise<void> {
  try {
    const dados = await obterJson(URL_PREFERENCIA, PreferenciaTutorialSchema);
    lojaPreferencia.definir({ usuarioId, dados });
  } catch {
    // Sem a preferência, o convite simplesmente não aparece; a Ajuda continua disponível.
  }
}

/**
 * Grava a situação do tutorial. Falha (sem conexão, servidor) não atrapalha o
 * uso: a preferência fica como estava e o tutorial continua acessível pela Ajuda.
 */
export async function gravarPreferencia(usuarioId: string, dados: AtualizarTutorial): Promise<void> {
  try {
    const nova = await enviarJson('PUT', URL_PREFERENCIA, PreferenciaTutorialSchema, { corpo: dados });
    lojaPreferencia.definir({ usuarioId, dados: nova });
  } catch {
    // Nada a fazer: é só uma preferência de uso.
  }
}

/** "Agora não": o convite some na hora; a gravação no servidor segue em seguida. */
export function adiarTutorial(usuarioId: string): void {
  const atual = lojaPreferencia.ler();
  if (atual?.usuarioId === usuarioId) lojaPreferencia.definir({ usuarioId, dados: { ...atual.dados, state: 'ADIADO', step: null } });
  void gravarPreferencia(usuarioId, { state: 'ADIADO', step: null });
}

/** Dados da sessão de que a ajuda precisa (perfil, permissões, navegação). */
export interface ContextoAjuda {
  usuarioId: string;
  permissoes: readonly Permissao[];
  perfil: string | null;
  escopo: string;
  demo: boolean;
  navegar: Navegar;
}

export const ContextoAjudaReact = createContext<ContextoAjuda | null>(null);

export function useContextoAjuda(): ContextoAjuda | null {
  return useContext(ContextoAjudaReact);
}
