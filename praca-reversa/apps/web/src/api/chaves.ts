import { useRef } from 'react';
import { FalhaRequisicao } from './cliente';

/**
 * Chave de idempotência por ação. Se a rede falhar antes da resposta, a nova
 * tentativa da mesma ação (mesma assinatura) reutiliza a chave e o servidor
 * não repete a alteração. Qualquer resposta do servidor encerra a chave.
 */
export function useChaves() {
  const chaves = useRef(new Map<string, string>());
  return {
    para(assinatura: string): string {
      let chave = chaves.current.get(assinatura);
      if (!chave) {
        chave = crypto.randomUUID();
        chaves.current.set(assinatura, chave);
      }
      return chave;
    },
    concluir(assinatura: string, erro?: unknown): void {
      // Resultado incerto (sem resposta, erro do servidor): a repetição usa a mesma chave.
      if (erro instanceof FalhaRequisicao && (erro.tipo === 'rede' || erro.incerta)) return;
      chaves.current.delete(assinatura);
    },
  };
}

/** Conflito de versão: outra pessoa alterou o registro desde a leitura. */
export function ehConflitoDeVersao(erro: unknown): boolean {
  return erro instanceof FalhaRequisicao && erro.codigo === 'CONFLITO_VERSAO';
}
