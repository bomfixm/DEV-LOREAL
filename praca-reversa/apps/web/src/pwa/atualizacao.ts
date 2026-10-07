import { registerSW } from 'virtual:pwa-register';
import { pendente, incertasDoContexto, lojaIncertas } from '../api/incertas';
import { criarLoja, useLoja } from '../utils/loja';
import { consultarOutrasAbas } from './abas';
import { lojaEnviosEmCurso, lojaProtecoes } from './protecoes';

/**
 * Service worker e atualização controlada (etapa 09).
 * - Nova versão instalada fica esperando: a interface mostra o aviso e a ação
 *   "Atualizar"; nada é ativado sozinho.
 * - "Atualizar" só recarrega depois de conferir as proteções desta aba
 *   (confirmação em curso, operação em confirmação, entrada só na memória).
 * - Quando outra aba ativa a versão nova, esta aba não recarrega: avisa que
 *   continua na versão anterior até a pessoa atualizar (sem troca silenciosa).
 */
export interface EstadoAtualizacao {
  suportado: boolean;
  registrado: boolean;
  novaVersao: boolean;
  ativadaEmOutraAba: boolean;
  prontoOffline: boolean;
  erro: string | null;
}

export const lojaAtualizacao = criarLoja<EstadoAtualizacao>({
  suportado: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  registrado: false,
  novaVersao: false,
  ativadaEmOutraAba: false,
  prontoOffline: false,
  erro: null,
});

let atualizarSW: ((recarregar?: boolean) => Promise<void>) | null = null;
let iniciadaAqui = false;
const INTERVALO_VERIFICACAO_MS = 30 * 60_000;

function alterar(mudanca: Partial<EstadoAtualizacao>): void {
  lojaAtualizacao.definir((atual) => ({ ...atual, ...mudanca }));
}

/**
 * Remove caches que não são o precache da casca (versões antigas ou
 * criados por engano) e qualquer resposta da API que esteja em cache.
 */
export async function limparCachesInadequados(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    for (const nome of await caches.keys()) {
      if (!nome.startsWith('workbox-precache-v2-')) {
        await caches.delete(nome);
        continue;
      }
      const cache = await caches.open(nome);
      for (const pedido of await cache.keys()) {
        if (new URL(pedido.url).pathname.includes('/api/')) await cache.delete(pedido);
      }
    }
  } catch {
    // Cache Storage indisponível (navegação privada): nada a limpar.
  }
}

export function iniciarServiceWorker(): void {
  if (!lojaAtualizacao.ler().suportado || atualizarSW !== null) return;
  void limparCachesInadequados();
  atualizarSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      alterar({ novaVersao: true });
    },
    onOfflineReady() {
      alterar({ prontoOffline: true });
    },
    // Chamado em toda aba quando a versão nova assume o controle.
    onNeedReload() {
      if (iniciadaAqui) window.location.reload();
      else alterar({ novaVersao: false, ativadaEmOutraAba: true });
    },
    onRegisteredSW(_url, registro) {
      alterar({ registrado: true });
      if (!registro) return;
      // Procura versão nova de tempos em tempos e ao voltar para a aba (sem ativar).
      setInterval(() => {
        if (navigator.onLine) void registro.update().catch(() => undefined);
      }, INTERVALO_VERIFICACAO_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) void registro.update().catch(() => undefined);
      });
    },
    onRegisterError(erro: unknown) {
      alterar({ erro: erro instanceof Error ? erro.message : 'Falha ao registrar o service worker.' });
    },
  });
}

/** O que impede recarregar esta aba agora (vazio = pode atualizar). */
export function impedimentosParaAtualizar(): string[] {
  const motivos: string[] = [];
  const envios = lojaEnviosEmCurso.ler();
  if (envios > 0) motivos.push(`${String(envios)} confirmação(ões) aguardando resposta do servidor.`);
  const incertas = incertasDoContexto(lojaIncertas.ler()).filter(pendente);
  if (incertas.length > 0) motivos.push(`${String(incertas.length)} operação(ões) em confirmação: verifique o resultado antes de atualizar.`);
  for (const p of lojaProtecoes.ler()) if (p.bloqueia) motivos.push(p.descricao);
  return motivos;
}

/** Avisos que não impedem (contagem aberta com rascunho no servidor). */
export function avisosAoAtualizar(): string[] {
  return lojaProtecoes
    .ler()
    .filter((p) => !p.bloqueia)
    .map((p) => p.descricao);
}

export type ResultadoAtualizacao = { ok: true } | { ok: false; motivos: string[] };

/**
 * Ação "Atualizar". Com impedimentos, nada acontece e eles são listados.
 * Outras abas com edição pendente são informadas, mas não recarregam.
 */
export async function atualizarAgora(): Promise<ResultadoAtualizacao> {
  const motivos = impedimentosParaAtualizar();
  if (motivos.length > 0) return { ok: false, motivos };
  const outras = await consultarOutrasAbas();
  if (outras.pendencias.length > 0) {
    const seguir = window.confirm(
      `Outra aba do Praça Reversa tem edição pendente (${outras.pendencias.join(' ')}). Ela continuará na versão anterior até ser atualizada lá. Atualizar esta aba agora?`,
    );
    if (!seguir) return { ok: false, motivos: ['Atualização adiada: outra aba tem edição pendente.'] };
  }
  iniciadaAqui = true;
  const { novaVersao } = lojaAtualizacao.ler();
  if (novaVersao && atualizarSW) {
    await atualizarSW(true);
    // Se a versão nova não assumir em alguns segundos, recarrega mesmo assim (nada pendente aqui).
    setTimeout(() => {
      window.location.reload();
    }, 5_000);
  } else {
    window.location.reload();
  }
  return { ok: true };
}

export function useAtualizacao(): EstadoAtualizacao {
  return useLoja(lojaAtualizacao);
}
