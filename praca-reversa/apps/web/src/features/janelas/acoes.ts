import { useState } from 'react';
import type { z } from 'zod';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import type { Carga } from '../../api/use-recurso';

export interface Mensagem {
  tipo: 'ok' | 'erro' | 'conflito';
  texto: string;
}

/**
 * Mutações das janelas, reservas e expedições: chave de idempotência por
 * ação (reenvio após falha de rede reaproveita a chave e não duplica a
 * operação), sucesso só depois da resposta do servidor, conflito de versão
 * recarrega os dados atuais. Sem conexão, nada é confirmado localmente.
 */
export function useAcoes(aoRecarregar: () => void) {
  const chaves = useChaves();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);

  async function executar<T>(assinatura: string, metodo: 'POST' | 'PUT', url: string, corpo: unknown, schema: z.ZodType<T>, sucesso: string): Promise<T | null> {
    setEnviando(assinatura);
    setMensagem(null);
    try {
      const r = await enviarJson(metodo, url, schema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: sucesso });
      return r;
    } catch (e) {
      chaves.concluir(assinatura, e);
      if (ehConflitoDeVersao(e)) {
        setMensagem({ tipo: 'conflito', texto: `${mensagemDeFalha(e)} Os dados atuais foram recarregados.` });
        aoRecarregar();
      } else if (e instanceof FalhaRequisicao && e.tipo === 'rede') {
        setMensagem({
          tipo: 'erro',
          texto: 'Sem resposta do servidor: não é possível saber se a ação foi registrada. Nada é confirmado sem a resposta da API; repita a mesma ação (ela não será duplicada).',
        });
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

/**
 * Últimos dados prontos de um recurso: durante uma nova consulta (depois de
 * uma gravação), a tela continua mostrando o que já tinha, sem desmontar
 * formulários abertos.
 */
export function useUltimoPronto<T>(carga: Carga<T> | null): T | null {
  const [ultimo, setUltimo] = useState<T | null>(null);
  const atual = carga?.estado === 'pronto' ? carga.dados : null;
  if (atual !== null && atual !== ultimo) setUltimo(atual);
  return atual ?? ultimo;
}
