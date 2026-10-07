import { useRef, useState } from 'react';
import { useChaves } from '../../api/chaves';
import type { Carga } from '../../api/use-recurso';
import { useConectado } from '../../hooks/ambiente';
import { classificarFalha, type Aviso } from './regras';

type Resultado<T> = { ok: true; dados: T } | { ok: false; aviso: Aviso };

/** Mantém a última leitura enquanto uma nova consulta carrega (sem piscar a tela). */
export function useUltimo<T>(carga: Carga<T> | null): T | null {
  const [ultimo, setUltimo] = useState<{ fonte: T } | null>(null);
  if (carga?.estado === 'pronto' && carga.dados !== ultimo?.fonte) setUltimo({ fonte: carga.dados });
  return ultimo?.fonte ?? null;
}

/**
 * Envio de uma movimentação com chave de idempotência estável por ação
 * (assinatura = operação + corpo). Resposta incerta (sem rede ou erro do
 * servidor) mantém a chave e guarda o envio para "Reenviar": o servidor
 * devolve o resultado original se a operação já tiver sido registrada.
 * Nada é guardado para execução automática posterior.
 */
export function useEnvio() {
  const chaves = useChaves();
  const conectado = useConectado();
  const [enviando, setEnviando] = useState(false);
  const pendente = useRef<(() => Promise<void>) | null>(null);
  const [temPendente, setTemPendente] = useState(false);

  async function enviar<T>(assinatura: string, chamada: (chave: string) => Promise<T>, aoTerminar: (r: Resultado<T>) => void): Promise<void> {
    setEnviando(true);
    try {
      const dados = await chamada(chaves.para(assinatura));
      chaves.concluir(assinatura);
      pendente.current = null;
      setTemPendente(false);
      aoTerminar({ ok: true, dados });
    } catch (erro) {
      const aviso = classificarFalha(erro);
      if (aviso.incerto) {
        // A mesma assinatura reutiliza a mesma chave no reenvio.
        pendente.current = () => enviar(assinatura, chamada, aoTerminar);
        setTemPendente(true);
      } else {
        chaves.concluir(assinatura, erro);
        pendente.current = null;
        setTemPendente(false);
      }
      aoTerminar({ ok: false, aviso });
    } finally {
      setEnviando(false);
    }
  }

  return {
    enviar,
    enviando,
    conectado,
    /** Há envio com resposta incerta aguardando reenvio (mesma chave). */
    temPendente,
    reenviar: (): void => {
      const acao = pendente.current;
      if (acao) void acao();
    },
    /** O usuário desistiu do envio incerto (ex.: mudou os dados). */
    descartar: (): void => {
      pendente.current = null;
      setTemPendente(false);
    },
  };
}
