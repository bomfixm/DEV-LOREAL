import { API_PREFIXO } from '@praca-reversa/contracts';
import { paraEndereco } from '../base';
import { criarLoja, useLoja } from '../utils/loja';

/**
 * Estado real da conexão (etapa 09). `navigator.onLine` é só uma pista: o
 * estado vem das respostas da API e da verificação de prontidão.
 * - sem-conexao: o aparelho está sem rede (nada é enviado);
 * - servidor-sem-resposta: há rede, mas a API não respondeu (pode ser o
 *   servidor, um proxy ou a rede da operação);
 * - servidor-indisponivel: a API respondeu que não pode atender (5xx);
 * - banco-indisponivel: a API respondeu, mas o banco não.
 */
export type EstadoRede = 'verificando' | 'conectado' | 'sem-conexao' | 'servidor-sem-resposta' | 'servidor-indisponivel' | 'banco-indisponivel';

export interface EstadoConexao {
  rede: EstadoRede;
  /** Última resposta da API (epoch ms): base de "dados consultados às…". */
  ultimaRespostaEm: number | null;
}

export const lojaConexao = criarLoja<EstadoConexao>({ rede: 'verificando', ultimaRespostaEm: null });

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function definirRede(pedida: EstadoRede, respondeu: boolean): void {
  // Resposta que estava a caminho quando o aparelho perdeu a rede não desfaz o "sem conexão".
  const rede = !online() && pedida !== 'verificando' ? 'sem-conexao' : pedida;
  lojaConexao.definir((atual) =>
    atual.rede === rede && !respondeu ? atual : { rede, ultimaRespostaEm: respondeu ? Date.now() : atual.ultimaRespostaEm },
  );
}

/**
 * Resposta HTTP recebida da API (qualquer status). Ela prova que o servidor
 * responde, não que o banco voltou: "banco indisponível" só é desfeito pela
 * verificação de prontidão (que consulta o banco), feita logo em seguida.
 */
export function informarResposta(status: number, codigo: string | null): void {
  if (status === 503 && codigo === 'BANCO_INDISPONIVEL') definirRede('banco-indisponivel', true);
  else if (status >= 500) definirRede('servidor-indisponivel', true);
  else if (lojaConexao.ler().rede === 'banco-indisponivel') {
    lojaConexao.definir((atual) => ({ ...atual, ultimaRespostaEm: Date.now() }));
    agendarVerificacao(3_000);
  } else definirRede('conectado', true);
}

/** O pedido não teve resposta. */
export function informarFalhaDeRede(): void {
  definirRede(online() ? 'servidor-sem-resposta' : 'sem-conexao', false);
  agendarVerificacao(3_000);
}

/** Sem rede no aparelho: confirmações nem são enviadas. */
export function semRedeNoAparelho(): boolean {
  return !online();
}

let verificando: Promise<void> | null = null;
/** Pedido feito durante uma verificação em curso: repete ao terminar (vale o estado mais recente). */
let repetir = false;
let agendada: ReturnType<typeof setTimeout> | null = null;

/** GET /health/ready: a API responde e consegue consultar o banco. */
export function verificarConexao(): Promise<void> {
  if (verificando) {
    repetir = true;
    return verificando;
  }
  if (!online()) {
    definirRede('sem-conexao', false);
    return Promise.resolve();
  }
  verificando = fetch(paraEndereco(`${API_PREFIXO}/health/ready`), { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' })
    .then(
      (resposta) => {
        // Rede caiu enquanto a verificação estava em curso: vale o estado atual do aparelho.
        if (!online()) definirRede('sem-conexao', false);
        else if (resposta.ok) definirRede('conectado', true);
        else if (resposta.status === 503) definirRede('banco-indisponivel', true);
        else definirRede('servidor-indisponivel', true);
      },
      () => {
        definirRede(online() ? 'servidor-sem-resposta' : 'sem-conexao', false);
      },
    )
    .finally(() => {
      verificando = null;
      if (repetir) {
        repetir = false;
        void verificarConexao();
      }
    });
  return verificando;
}

function agendarVerificacao(ms: number): void {
  if (agendada !== null) return;
  agendada = setTimeout(() => {
    agendada = null;
    void verificarConexao();
  }, ms);
}

let iniciado = false;

/** Eventos do navegador e verificação periódica (mais frequente quando há falha). */
export function iniciarMonitorConexao(): () => void {
  if (iniciado) return () => undefined;
  iniciado = true;
  const aoMudar = () => {
    if (!online()) definirRede('sem-conexao', false);
    else {
      definirRede('verificando', false);
      void verificarConexao();
    }
  };
  window.addEventListener('online', aoMudar);
  window.addEventListener('offline', aoMudar);
  void verificarConexao();
  const intervalo = setInterval(() => {
    const { rede } = lojaConexao.ler();
    if (rede !== 'conectado' || document.visibilityState === 'visible') void verificarConexao();
  }, 30_000);
  return () => {
    iniciado = false;
    window.removeEventListener('online', aoMudar);
    window.removeEventListener('offline', aoMudar);
    clearInterval(intervalo);
  };
}

export function useConexao(): EstadoConexao {
  return useLoja(lojaConexao);
}

export const TEXTO_REDE: Record<EstadoRede, string> = {
  verificando: 'Verificando conexão…',
  conectado: 'Servidor disponível',
  'sem-conexao': 'Sem conexão',
  'servidor-sem-resposta': 'Servidor sem resposta',
  'servidor-indisponivel': 'Servidor indisponível',
  'banco-indisponivel': 'Banco indisponível',
};
