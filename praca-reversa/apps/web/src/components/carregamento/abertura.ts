import { useSyncExternalStore } from 'react';

/**
 * Abertura pós-login (D334): toca uma vez por abertura da área autenticada
 * nesta instância do app — depois de um login aceito ou ao iniciar com a
 * sessão já confirmada pelo servidor. Rotas, renovação de sessão, troca de
 * unidade/cliente e novas renderizações não a repetem; sair da conta a rearma.
 */
type Estado = 'armada' | 'tocando' | 'encerrada';

let estado: Estado = 'armada';
const ouvintes = new Set<() => void>();

function mudar(novo: Estado): void {
  if (novo === estado) return;
  estado = novo;
  for (const ouvinte of ouvintes) ouvinte();
}

/**
 * Sessão confirmada: toca se ainda não tocou nesta abertura. Toca também com
 * "reduzir movimento" ligado no sistema (decisão do usuário, D335): os
 * computadores da operação costumam ter os efeitos de animação desligados.
 */
export function solicitarAbertura(): void {
  if (estado !== 'armada') return;
  mudar('tocando');
}

export function encerrarAbertura(): void {
  if (estado === 'tocando') mudar('encerrada');
}

/** Saiu da conta (ou perdeu a sessão): a próxima entrada pode tocar de novo. */
export function rearmarAbertura(): void {
  mudar('armada');
}

function assinar(avisar: () => void): () => void {
  ouvintes.add(avisar);
  return () => {
    ouvintes.delete(avisar);
  };
}

/** A abertura está na tela: os indicadores de carregamento esperam ela sair (sem dois overlays). */
export function useAberturaTocando(): boolean {
  return useSyncExternalStore(
    assinar,
    () => estado === 'tocando',
    () => false,
  );
}
