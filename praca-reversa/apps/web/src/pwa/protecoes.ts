import { useEffect, useId } from 'react';
import { criarLoja, useLoja } from '../utils/loja';

/**
 * O que precisa ser resolvido antes de recarregar a aplicação para uma nova
 * versão (etapa 09). Telas registram proteções enquanto estão abertas:
 * - bloqueia: recarregar agora perderia ou repetiria algo (entrada só na
 *   memória, confirmação em curso, operação em confirmação);
 * - não bloqueia: só informa (contagem aberta com rascunho salvo no servidor).
 */
export interface Protecao {
  id: string;
  descricao: string;
  bloqueia: boolean;
}

export const lojaProtecoes = criarLoja<readonly Protecao[]>([]);

/** Gravações enviadas e ainda sem resposta (qualquer tela). */
export const lojaEnviosEmCurso = criarLoja(0);

export function inicioDeEnvio(): () => void {
  lojaEnviosEmCurso.definir((n) => n + 1);
  let encerrado = false;
  return () => {
    if (encerrado) return;
    encerrado = true;
    lojaEnviosEmCurso.definir((n) => Math.max(0, n - 1));
  };
}

/** Registra uma proteção enquanto `descricao` não for nula e o componente estiver montado. */
export function useProtecao(descricao: string | null, bloqueia: boolean): void {
  const id = useId();
  useEffect(() => {
    if (descricao === null) return;
    lojaProtecoes.definir((lista) => [...lista.filter((p) => p.id !== id), { id, descricao, bloqueia }]);
    return () => {
      lojaProtecoes.definir((lista) => lista.filter((p) => p.id !== id));
    };
  }, [id, descricao, bloqueia]);
}

export function useProtecoes(): readonly Protecao[] {
  return useLoja(lojaProtecoes);
}

export function useEnviosEmCurso(): number {
  return useLoja(lojaEnviosEmCurso);
}
