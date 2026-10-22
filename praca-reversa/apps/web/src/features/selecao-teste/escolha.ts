import type { ConteudoEstoqueTeste } from '@praca-reversa/contracts';
import { textoVolumes } from './textos';

/**
 * Avaliação de uma nota escolhida (mesma regra do servidor, que confere de
 * novo): quantidade inteira de 1 até o informado; sem quantidade só quando o
 * volume da nota é desconhecido ou a Delivery pedida não está discriminada no
 * cadastro — nesses casos o item vai para análise e não entra no total.
 */
export function avaliarEscolha(
  c: Pick<ConteudoEstoqueTeste, 'volumes' | 'delivery'>,
  e: { quantidade: string; delivery: string },
): { volumes: number | null; erro: string | null; analise: string | null } {
  const texto = e.quantidade.trim();
  const pedida = e.delivery.trim();
  const deliveryNova = pedida !== '' && pedida.toUpperCase() !== (c.delivery ?? '').trim().toUpperCase();
  if (texto === '') {
    if (c.volumes === null) return { volumes: null, erro: null, analise: 'Volumes desta nota não informados: a operação confirma a quantidade.' };
    if (deliveryNova) return { volumes: null, erro: null, analise: 'Sem quantidade: a Delivery vai para análise da operação (o total da nota não é atribuído a ela).' };
    return { volumes: null, erro: `Informe quantos volumes (de 1 a ${String(c.volumes)}).`, analise: null };
  }
  if (!/^\d+$/.test(texto)) return { volumes: null, erro: 'Use um número inteiro de volumes.', analise: null };
  const n = Number(texto);
  if (n < 1) return { volumes: null, erro: 'A quantidade mínima é 1 volume.', analise: null };
  if (c.volumes !== null && n > c.volumes) return { volumes: null, erro: `Acima dos ${textoVolumes(c.volumes)} informados. Ajuste ou explique na observação.`, analise: null };
  if (c.volumes === null) return { volumes: n, erro: null, analise: 'Volumes desta nota não informados no estoque: a quantidade pedida será confirmada pela operação.' };
  return { volumes: n, erro: null, analise: null };
}
