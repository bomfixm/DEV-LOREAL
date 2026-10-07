import { ClaimDetalheSchema, type ClaimDetalhe } from '@praca-reversa/contracts';
import { useState } from 'react';
import type { z } from 'zod';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';

export interface Mensagem {
  tipo: 'ok' | 'erro' | 'conflito';
  texto: string;
}

/**
 * Mutações do detalhe do claim: chave de idempotência por ação (reenvio após
 * falha de rede reaproveita a chave), sucesso só depois da resposta do
 * servidor, conflito de versão recarrega os dados atuais.
 */
export function useAcoesClaim(aoAtualizar: (d: ClaimDetalhe) => void, aoRecarregar: () => void) {
  const chaves = useChaves();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);

  async function executar<T = ClaimDetalhe>(
    assinatura: string,
    metodo: 'POST' | 'PUT',
    url: string,
    corpo: unknown,
    sucesso: string,
    schema: z.ZodType<T> = ClaimDetalheSchema as unknown as z.ZodType<T>,
  ): Promise<T | null> {
    setEnviando(assinatura);
    setMensagem(null);
    try {
      const r = await enviarJson(metodo, url, schema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      if (schema === (ClaimDetalheSchema as unknown)) aoAtualizar(r as unknown as ClaimDetalhe);
      setMensagem({ tipo: 'ok', texto: sucesso });
      return r;
    } catch (e) {
      chaves.concluir(assinatura, e);
      if (ehConflitoDeVersao(e)) {
        setMensagem({ tipo: 'conflito', texto: `${mensagemDeFalha(e)} Os dados atuais foram recarregados.` });
        aoRecarregar();
      } else if (e instanceof FalhaRequisicao && e.tipo === 'rede') {
        setMensagem({ tipo: 'erro', texto: 'Sem resposta do servidor: não é possível saber se a ação foi registrada. Repita a mesma ação: ela não será duplicada.' });
      } else {
        setMensagem({ tipo: 'erro', texto: mensagemDeFalha(e) });
      }
      return null;
    } finally {
      setEnviando(null);
    }
  }

  return { executar, enviando, mensagem, setMensagem };
}
