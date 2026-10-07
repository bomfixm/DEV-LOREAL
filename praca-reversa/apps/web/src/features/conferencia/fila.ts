import type { NovaObservacao } from '@praca-reversa/contracts';
import { z } from 'zod';
import type { Armazenamento } from '../../api/incertas';

/**
 * Entradas da conferência que o servidor ainda não confirmou (etapa 04,
 * revisto na etapa 09). O rascunho oficial fica no servidor; aqui fica só o
 * que não chegou lá, para a pessoa reenviar ou descartar — nunca reenviado
 * sozinho. Cada entrada guarda a própria chave de idempotência e o corpo
 * idêntico: reenviar não duplica.
 *
 * Situações:
 * - nao-enviada: nada saiu do aparelho (sem rede, versão incompatível) ou o
 *   servidor confirmou que não registrou;
 * - incerta: o pedido saiu e a resposta se perdeu (pode estar no rascunho);
 *   é verificada pela chave (GET /operacoes/<chave>) antes de qualquer reenvio;
 * - enviando / verificando: em curso.
 *
 * Isolamento: usuário, unidade/cliente (escopo) e conferência. Memória da
 * aplicação (sobrevive a sessão expirada e nova entrada do mesmo usuário) e,
 * só quando a política permite (PERSISTENCIA_LOCAL, nunca em produção), o
 * sessionStorage da aba com versão, data e o rótulo "não enviado". Sair da
 * conta apaga tudo; outro usuário não vê nem envia.
 */
export type EstadoEnvio = 'nao-enviada' | 'enviando' | 'incerta' | 'verificando';

export interface EnvioPendente {
  id: string;
  chave: string;
  corpo: NovaObservacao;
  resumo: string;
  estado: EstadoEnvio;
  erro: string | null;
  /** Momento da tentativa (epoch ms). */
  criadaEm: number;
}

export interface ContextoFila {
  usuarioId: string;
  escopoId: string;
  conferenciaId: string;
}

/** Rótulo gravado junto com as entradas no navegador. */
export const ROTULO_NAO_ENVIADO = 'não enviado';
const PREFIXO = 'pr-conferencia-nao-enviadas:';
const VERSAO_FORMATO = 2;

const memoria = new Map<string, EnvioPendente[]>();

let armazenamento: () => Armazenamento | null = () => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};
export function usarArmazenamentoFila(fonte: () => Armazenamento | null): void {
  armazenamento = fonte;
}

function chaveContexto(c: ContextoFila): string {
  return `${c.usuarioId}:${c.escopoId}:${c.conferenciaId}`;
}

function chaveArmazenamento(c: ContextoFila): string {
  return `${PREFIXO}v${String(VERSAO_FORMATO)}:${chaveContexto(c)}`;
}

// O corpo é guardado e reenviado exatamente como foi enviado da primeira vez:
// com a mesma chave, outro corpo seria recusado pela API (idempotência).
const GravadoSchema = z.object({
  versao: z.literal(VERSAO_FORMATO),
  rotulo: z.literal(ROTULO_NAO_ENVIADO),
  salvoEm: z.string(),
  usuarioId: z.string(),
  escopoId: z.string(),
  conferenciaId: z.string(),
  itens: z.array(
    z.object({
      id: z.string().min(1),
      chave: z.string().min(8),
      corpo: z.record(z.string(), z.unknown()),
      resumo: z.string(),
      criadaEm: z.number(),
      estado: z.enum(['nao-enviada', 'incerta']),
    }),
  ),
});

/** Gravadas no navegador (só com a política ativa). Em curso volta como incerta: precisa de verificação. */
export function lerGravadas(c: ContextoFila): EnvioPendente[] {
  const fonte = armazenamento();
  if (!fonte) return [];
  try {
    const texto = fonte.getItem(chaveArmazenamento(c));
    if (!texto) return [];
    const lido = GravadoSchema.safeParse(JSON.parse(texto));
    if (!lido.success || lido.data.usuarioId !== c.usuarioId || lido.data.escopoId !== c.escopoId || lido.data.conferenciaId !== c.conferenciaId) return [];
    return lido.data.itens.map((e) => ({ ...e, corpo: e.corpo as NovaObservacao, erro: null }));
  } catch {
    return [];
  }
}

/**
 * Entradas do contexto: memória da aplicação; sem nada na memória e com a
 * política ativa, as gravadas no navegador.
 */
export function lerNaoEnviadas(c: ContextoFila, persistir: boolean | null): EnvioPendente[] {
  const naMemoria = memoria.get(chaveContexto(c));
  // Em curso quando a tela saiu (sessão expirada, navegação): o pedido pode ter chegado — verificar.
  if (naMemoria !== undefined) return naMemoria.map((e) => (e.estado === 'enviando' || e.estado === 'verificando' ? { ...e, estado: 'incerta' } : e));
  return persistir === true ? lerGravadas(c) : [];
}

/**
 * Aplica o resultado de um envio também na memória da aplicação: a tela pode
 * ter saído antes da resposta (sessão expirada), e o resultado não pode se
 * perder. `null` remove a entrada.
 */
export function alterarNaMemoria(c: ContextoFila, id: string, mudanca: Partial<EnvioPendente> | null, persistir: boolean | null): void {
  const itens = memoria.get(chaveContexto(c));
  if (itens === undefined) return;
  gravarNaoEnviadas(c, mudanca === null ? itens.filter((e) => e.id !== id) : itens.map((e) => (e.id === id ? { ...e, ...mudanca } : e)), persistir);
}

/**
 * Atualiza memória e, conforme a política, o navegador. Política ainda
 * desconhecida (`null`): só a memória; nada gravado nem apagado no navegador.
 */
export function gravarNaoEnviadas(c: ContextoFila, itens: readonly EnvioPendente[], persistir: boolean | null): void {
  const chave = chaveContexto(c);
  if (itens.length === 0) memoria.delete(chave);
  else memoria.set(chave, [...itens]);
  if (persistir === null) return;
  const fonte = armazenamento();
  if (!fonte) return;
  try {
    const guardaveis = itens;
    if (!persistir || guardaveis.length === 0) {
      fonte.removeItem(chaveArmazenamento(c));
      return;
    }
    fonte.setItem(
      chaveArmazenamento(c),
      JSON.stringify({
        versao: VERSAO_FORMATO,
        rotulo: ROTULO_NAO_ENVIADO,
        salvoEm: new Date().toISOString(),
        usuarioId: c.usuarioId,
        escopoId: c.escopoId,
        conferenciaId: c.conferenciaId,
        // Em curso conta como incerta: se a aba fechar agora, o pedido pode ter chegado.
        itens: guardaveis.map(({ id, chave: k, corpo, resumo, criadaEm, estado }) => ({
          id,
          chave: k,
          corpo,
          resumo,
          criadaEm,
          estado: estado === 'nao-enviada' ? 'nao-enviada' : 'incerta',
        })),
      }),
    );
  } catch {
    // Armazenamento indisponível: as entradas continuam só na memória.
  }
}

/** Quantas entradas não confirmadas existem na memória (todas as conferências do usuário). */
export function contarNaoEnviadas(usuarioId?: string): number {
  let total = 0;
  for (const [chave, itens] of memoria) if (usuarioId === undefined || chave.startsWith(`${usuarioId}:`)) total += itens.length;
  return total;
}

function removerGravadas(filtro: (chave: string) => boolean): void {
  const fonte = armazenamento();
  if (!fonte) return;
  try {
    const chaves: string[] = [];
    for (let i = 0; i < fonte.length; i++) {
      const chave = fonte.key(i);
      if (chave?.startsWith(PREFIXO) && filtro(chave)) chaves.push(chave);
    }
    for (const chave of chaves) fonte.removeItem(chave);
  } catch {
    // Sem armazenamento: nada a remover.
  }
}

/** Ao sair da conta, nada de conferência fica guardado (memória e navegador). */
export function descartarTodasNaoEnviadas(): void {
  memoria.clear();
  removerGravadas(() => true);
}

/**
 * Entrou outro usuário: o que era do anterior some (não aparece nem é
 * enviado). Também remove formatos antigos (etapa 04, sem escopo/versão).
 */
export function descartarDeOutrosUsuarios(usuarioId: string): void {
  for (const chave of [...memoria.keys()]) if (!chave.startsWith(`${usuarioId}:`)) memoria.delete(chave);
  removerGravadas((chave) => !chave.startsWith(`${PREFIXO}v${String(VERSAO_FORMATO)}:${usuarioId}:`));
}
