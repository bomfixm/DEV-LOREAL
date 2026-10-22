import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { useRecurso } from '../../api/use-recurso';

/**
 * Consulta com atualização automática (mesma estratégia do mapa): a cada
 * minuto com a tela visível, ao voltar à aba e ao focar a janela. Mantém os
 * últimos números e informa a falha da atualização, sem apresentá-los como
 * atuais.
 */
export function useConsultaViva<T>(url: string | null, schema: z.ZodType<T>, versao: number) {
  const { carga, recarregar } = useRecurso(url, schema, versao);
  const [ultimo, setUltimo] = useState<{ url: string; dados: T } | null>(null);
  useEffect(() => {
    const atualizar = () => {
      if (document.visibilityState === 'visible') recarregar();
    };
    const relogio = window.setInterval(atualizar, 60_000);
    document.addEventListener('visibilitychange', atualizar);
    window.addEventListener('focus', atualizar);
    return () => {
      window.clearInterval(relogio);
      document.removeEventListener('visibilitychange', atualizar);
      window.removeEventListener('focus', atualizar);
    };
  }, [recarregar]);
  if (url !== null && carga?.estado === 'pronto' && ultimo?.dados !== carga.dados) setUltimo({ url, dados: carga.dados });
  const dados = ultimo !== null && ultimo.url === url ? ultimo.dados : null;
  return { dados, carga, recarregar };
}
