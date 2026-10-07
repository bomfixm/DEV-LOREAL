import { criarLoja, useLoja } from '../utils/loja';

/**
 * Instalação como aplicativo (etapa 09). A ação "Instalar aplicativo" só
 * aparece quando o navegador oferece o pedido de instalação
 * (beforeinstallprompt, Chromium); nos demais casos a interface mostra as
 * instruções do navegador ou segue pelo navegador. Nada aqui promete
 * instalação igual em todos os aparelhos.
 */
interface EventoInstalacao extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface EstadoInstalacao {
  /** Pedido de instalação disponível agora. */
  disponivel: boolean;
  instalado: boolean;
  standalone: boolean;
}

let pedido: EventoInstalacao | null = null;
export const lojaInstalacao = criarLoja<EstadoInstalacao>({ disponivel: false, instalado: false, standalone: false });

function emModoAplicativo(): boolean {
  if (typeof window === 'undefined') return false;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches;
}

/** Chamado cedo (main.tsx): o evento chega uma vez, antes de qualquer tela. */
export function capturarPedidoDeInstalacao(): void {
  lojaInstalacao.definir((e) => ({ ...e, standalone: emModoAplicativo() }));
  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    pedido = evento as EventoInstalacao;
    lojaInstalacao.definir((e) => ({ ...e, disponivel: true }));
  });
  window.addEventListener('appinstalled', () => {
    pedido = null;
    lojaInstalacao.definir((e) => ({ ...e, disponivel: false, instalado: true }));
  });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
    lojaInstalacao.definir((e) => ({ ...e, standalone: emModoAplicativo() }));
  });
}

export async function instalar(): Promise<'aceita' | 'recusada' | 'indisponivel'> {
  if (pedido === null) return 'indisponivel';
  const atual = pedido;
  pedido = null;
  lojaInstalacao.definir((e) => ({ ...e, disponivel: false }));
  await atual.prompt();
  const escolha = await atual.userChoice;
  return escolha.outcome === 'accepted' ? 'aceita' : 'recusada';
}

export function useInstalacao(): EstadoInstalacao {
  return useLoja(lojaInstalacao);
}

export type Plataforma = 'ios' | 'android-chromium' | 'android-firefox' | 'desktop-chromium' | 'desktop-firefox' | 'desktop-safari' | 'outro';

/** Pista pela identificação do navegador: serve só para escolher as instruções. */
export function plataformaProvavel(agente: string): Plataforma {
  const ua = agente.toLowerCase();
  const ios = /iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && ua.includes('mobile'));
  if (ios) return 'ios';
  if (ua.includes('android')) return ua.includes('firefox') ? 'android-firefox' : 'android-chromium';
  if (ua.includes('firefox')) return 'desktop-firefox';
  if (/edg\/|chrome\/|chromium\//.test(ua)) return 'desktop-chromium';
  if (ua.includes('safari')) return 'desktop-safari';
  return 'outro';
}

export const INSTRUCOES: Record<Plataforma, string> = {
  ios: 'iPhone/iPad: toque em Compartilhar e escolha “Adicionar à Tela de Início” (Safari; no iOS 16.4 ou mais novo também pelo Chrome, Edge e Firefox). O iPhone não mostra o botão “Instalar aplicativo”.',
  'android-chromium': 'Android (Chrome, Edge, Samsung Internet): abra o menu ⋮ e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.',
  'android-firefox': 'Android (Firefox): menu ⋮ → “Adicionar à tela inicial” cria um atalho que abre no Firefox (não é instalação completa).',
  'desktop-chromium': 'Computador (Chrome ou Edge): use o ícone de instalação na barra de endereços ou o menu ⋮ → “Instalar Praça Reversa”.',
  'desktop-firefox': 'Firefox no computador não instala aplicativos web: continue usando pelo navegador (todas as funções seguem disponíveis).',
  'desktop-safari': 'Safari no Mac: menu Arquivo → “Adicionar ao Dock”, quando disponível; senão, continue pelo navegador.',
  outro: 'Se o navegador oferecer “Instalar” ou “Adicionar à tela inicial” no menu, use essa opção; senão, continue pelo navegador.',
};
