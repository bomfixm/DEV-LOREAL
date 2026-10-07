import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { FalhaRequisicao, mensagemDeFalha, obterJson } from './cliente';
import { useGeracaoDados } from './recuperacao';

export type Carga<T> =
  | { estado: 'carregando' }
  | { estado: 'erro'; mensagem: string; codigo: string | null; status: number | null }
  | { estado: 'pronto'; dados: T };

interface Resultado<T> {
  chave: string;
  carga: Carga<T>;
}

/**
 * Consulta um recurso da API. O resultado fica associado à URL que o gerou:
 * uma resposta atrasada de um palete anterior nunca aparece para outro.
 * `versao` força nova consulta (por exemplo, quando a conexão volta).
 */
export function useRecurso<T>(url: string | null, schema: z.ZodType<T>, versao = 0) {
  const [tentativa, setTentativa] = useState(0);
  const [resultado, setResultado] = useState<Resultado<T> | null>(null);
  // Operação incerta confirmada no servidor (etapa 09): os recursos abertos são consultados de novo.
  const geracao = useGeracaoDados();
  const chave = url === null ? null : `${url}#${String(versao)}#${String(tentativa)}#${String(geracao)}`;

  useEffect(() => {
    if (url === null || chave === null) return;
    const controle = new AbortController();
    obterJson(url, schema, controle.signal).then(
      (dados) => {
        setResultado({ chave, carga: { estado: 'pronto', dados } });
      },
      (erro: unknown) => {
        if (controle.signal.aborted) return;
        const falha = erro instanceof FalhaRequisicao ? erro : null;
        setResultado({
          chave,
          carga: { estado: 'erro', mensagem: mensagemDeFalha(erro), codigo: falha?.codigo ?? null, status: falha?.status ?? null },
        });
      },
    );
    return () => {
      controle.abort();
    };
  }, [url, chave, schema]);

  const recarregar = useCallback(() => {
    setTentativa((t) => t + 1);
  }, []);

  const carga: Carga<T> | null =
    chave === null ? null : resultado?.chave === chave ? resultado.carga : { estado: 'carregando' };
  return { carga, recarregar };
}
