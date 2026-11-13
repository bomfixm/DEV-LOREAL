import { useEffect, useRef, useState } from 'react';
import { ControleCarregamento } from './atraso';

const SEPARADOR = '\u0000';

/**
 * Regra dos 1,5 s para uma área da tela (D334). `buscas` lista os ids das
 * buscas pendentes que sustentam a área: a contagem de cada uma começa quando
 * ela entra na lista e para quando sai (resolveu, falhou ou foi cancelada).
 * Re-renderizar com os mesmos ids não reinicia o prazo; desmontar (troca de
 * rota) cancela o temporizador.
 */
export function useCarregamentoLento(buscas: readonly string[]): boolean {
  const [lento, setLento] = useState(false);
  const [controle] = useState(() => new ControleCarregamento(setLento));
  const ativos = useRef(new Set<string>());
  const assinatura = buscas.join(SEPARADOR);

  useEffect(() => {
    const novos = new Set(assinatura === '' ? [] : assinatura.split(SEPARADOR));
    for (const id of ativos.current) if (!novos.has(id)) controle.encerrar(id);
    for (const id of novos) controle.iniciar(id);
    ativos.current = novos;
  }, [controle, assinatura]);

  useEffect(
    () => () => {
      controle.descartar();
      ativos.current = new Set();
    },
    [controle],
  );

  return buscas.length > 0 && lento;
}
