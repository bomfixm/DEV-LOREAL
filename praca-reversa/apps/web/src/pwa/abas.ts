import { CAMINHO_BASE } from '../base';

/**
 * Coordenação entre abas/janelas da mesma instalação (etapa 09), pelo
 * BroadcastChannel do navegador. Só sinais e descrições curtas trafegam: nada
 * de dados de estoque, tokens ou rascunhos.
 * - consulta de pendências antes de atualizar ou sair;
 * - aviso de sessão encerrada (sair em uma aba limpa as outras).
 */
type Mensagem =
  | { tipo: 'consulta'; de: string; pedido: string }
  | { tipo: 'pendencias'; de: string; para: string; pedido: string; itens: string[] }
  | { tipo: 'sessao-encerrada'; de: string };

const ID_ABA = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
let canal: BroadcastChannel | null = null;
let fontePendencias: () => string[] = () => [];
let aoEncerrarEmOutraAba: (() => void) | null = null;
const respostas = new Map<string, string[][]>();

function abrir(): BroadcastChannel | null {
  if (canal !== null) return canal;
  if (typeof BroadcastChannel === 'undefined') return null;
  canal = new BroadcastChannel(`praca-reversa:${CAMINHO_BASE}`);
  canal.onmessage = (evento: MessageEvent<Mensagem>) => {
    const m = evento.data;
    if (m.de === ID_ABA) return;
    if (m.tipo === 'consulta') {
      canal?.postMessage({ tipo: 'pendencias', de: ID_ABA, para: m.de, pedido: m.pedido, itens: fontePendencias() } satisfies Mensagem);
    } else if (m.tipo === 'pendencias' && m.para === ID_ABA) {
      respostas.get(m.pedido)?.push(m.itens);
    } else if (m.tipo === 'sessao-encerrada') {
      aoEncerrarEmOutraAba?.();
    }
  };
  return canal;
}

/** O que esta aba informa às outras quando consultada. */
export function definirFonteDePendencias(fonte: () => string[]): void {
  fontePendencias = fonte;
  abrir();
}

export function aoSessaoEncerradaEmOutraAba(ouvinte: (() => void) | null): void {
  aoEncerrarEmOutraAba = ouvinte;
  abrir();
}

export function avisarSessaoEncerrada(): void {
  abrir()?.postMessage({ tipo: 'sessao-encerrada', de: ID_ABA } satisfies Mensagem);
}

/** Pergunta às outras abas abertas o que têm pendente (espera curta). */
export async function consultarOutrasAbas(esperaMs = 400): Promise<{ abas: number; pendencias: string[] }> {
  const c = abrir();
  if (c === null) return { abas: 0, pendencias: [] };
  const pedido = String(Math.random()).slice(2);
  respostas.set(pedido, []);
  c.postMessage({ tipo: 'consulta', de: ID_ABA, pedido } satisfies Mensagem);
  await new Promise((resolver) => setTimeout(resolver, esperaMs));
  const recebidas = respostas.get(pedido) ?? [];
  respostas.delete(pedido);
  return { abas: recebidas.length, pendencias: recebidas.flat() };
}
