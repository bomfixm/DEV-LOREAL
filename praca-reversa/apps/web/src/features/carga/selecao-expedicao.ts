import { API_PREFIXO, SelecaoExpedicaoSchema, type SelecaoExpedicao } from '@praca-reversa/contracts';
import { useEffect, useSyncExternalStore } from 'react';
import { obterJson } from '../../api/cliente';

/**
 * Seleção atual da Expedição para o atalho do mapa: sempre a do servidor (nada
 * é somado no navegador). Lida ao abrir o mapa e quando os dados mudam;
 * depois de uma inclusão, a resposta do servidor já traz a seleção nova.
 */
let atual: SelecaoExpedicao | null = null;
let geracao = 0;
const ouvintes = new Set<() => void>();

function publicar(s: SelecaoExpedicao | null): void {
  atual = s;
  for (const o of ouvintes) o();
}

/** Seleção devolvida por uma inclusão (descarta leituras mais antigas ainda em andamento). */
export function definirSelecao(s: SelecaoExpedicao): void {
  geracao++;
  publicar(s);
}

/** Consulta a seleção no servidor; falha mantém a última conhecida. */
export async function atualizarSelecao(): Promise<void> {
  const minha = ++geracao;
  try {
    const s = await obterJson(`${API_PREFIXO}/cargas/selecao`, SelecaoExpedicaoSchema);
    if (minha === geracao) publicar(s);
  } catch {
    // Sem conexão: o atalho continua com o último número confirmado.
  }
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/** Seleção atual (null = ainda não lida ou sem permissão). `versao` muda → consulta de novo. */
export function useSelecaoExpedicao(ativo: boolean, versao: number): SelecaoExpedicao | null {
  const s = useSyncExternalStore(assinar, () => atual);
  useEffect(() => {
    if (ativo) void atualizarSelecao();
  }, [ativo, versao]);
  return ativo ? s : null;
}
