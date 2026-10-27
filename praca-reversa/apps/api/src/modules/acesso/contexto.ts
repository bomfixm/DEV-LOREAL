import {
  permissoesDoVinculo,
  type Escopo,
  type LimitesImportacao,
  type EscopoComPerfil,
  type Perfil,
  type Permissao,
  type Sessao,
} from '@praca-reversa/contracts';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ConfigClaims, Configuracao } from '../../config.js';
import type { Banco } from '../../db/cliente.js';
import { ErroHttp, acessoNegado, naoAutenticado, sessaoExpirada } from '../../http/erros.js';
import { ehMutavel } from '../../http/seguranca.js';
import { registrarEvento } from '../auditoria/registrar.js';
import type { ConfigPlanilha } from '../protecao/configuracao.js';
import { escoposDoUsuario } from './escopos.js';
import type { LimitadorTentativas } from './limitador.js';
import type { ServicoSessoes, SessaoValida } from './sessoes.js';
import { iguaisEmTempoConstante, tokenCsrf } from './tokens.js';

export interface ContextoAcesso {
  sessao: SessaoValida;
  /** Identificador opaco (apenas em memória, para derivar o token anti-CSRF). */
  token: string;
  escopos: EscopoComPerfil[];
  escopoAtivo: Escopo | null;
  perfil: Perfil | null;
  permissoes: ReadonlySet<Permissao>;
}

declare module 'fastify' {
  interface FastifyRequest {
    acesso: ContextoAcesso | null;
  }
}

export type ConfigAcesso = Pick<
  Configuracao,
  'ambiente' | 'cookieSeguro' | 'appSegredo' | 'sessaoInatividadeMinutos' | 'sessaoDuracaoMaximaHoras' | 'urlPublica'
>;

export interface Dependencias {
  db: Banco;
  config: ConfigAcesso;
  agora: () => Date;
  sessoes: ServicoSessoes;
  limiteLoginPorConta: LimitadorTentativas;
  limiteLoginPorIp: LimitadorTentativas;
  /** Limites de arquivo e processamento da importação (configuráveis). */
  importacao: LimitesImportacao;
  /** Limites do inventário conferido e da seleção do cliente (planilhas operacionais grandes). */
  importacaoPlanilha: LimitesImportacao;
  /** Linhas máximas de uma exportação da busca (e da lista de claims). */
  exportacaoMaxLinhas: number;
  /** Ordenação inicial da lista de claims e limite de anexo. */
  claims: ConfigClaims;
  /** Caminho-base público (etapa 09), terminado em "/"; padrão "/". */
  caminhoBase?: string;
  /** "Seleção cliente — teste" ligada na instalação (padrão: ligada; acesso só por concessão). */
  selecaoClienteTeste: boolean;
  /** Planilha automática e proteção (destino, tempos, retenção, backup). */
  planilha: ConfigPlanilha;
}

export function nomeCookie(config: ConfigAcesso): string {
  // O prefixo __Host- exige Secure, caminho / e nenhum domínio.
  return config.cookieSeguro ? '__Host-pr_sessao' : 'pr_sessao';
}

export function opcoesCookie(config: ConfigAcesso): CookieSerializeOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSeguro,
    maxAge: config.sessaoDuracaoMaximaHoras * 3600,
  };
}

export function limparCookie(reply: FastifyReply, config: ConfigAcesso): void {
  reply.clearCookie(nomeCookie(config), { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSeguro });
}

export function contextoDe(request: FastifyRequest): ContextoAcesso {
  if (!request.acesso) throw naoAutenticado();
  return request.acesso;
}

/** Escopo ativo obrigatório: rotas de dados nunca usam escopo implícito. */
export function escopoAtivoDe(request: FastifyRequest): Escopo {
  const contexto = contextoDe(request);
  if (!contexto.escopoAtivo) throw new ErroHttp(403, 'SEM_ESCOPO', 'Escolha uma unidade/cliente com acesso para continuar.');
  return contexto.escopoAtivo;
}

export function corpoSessao(contexto: ContextoAcesso, config: ConfigAcesso): Sessao {
  return {
    user: { id: contexto.sessao.usuario.id, login: contexto.sessao.usuario.login, name: contexto.sessao.usuario.nome },
    activeScope: contexto.escopoAtivo,
    scopes: contexto.escopos,
    role: contexto.perfil,
    permissions: [...contexto.permissoes],
    csrfToken: tokenCsrf(contexto.token),
    expiresAt: contexto.sessao.expiraEm.toISOString(),
    idleTimeoutMinutes: config.sessaoInatividadeMinutos,
  };
}

export async function montarContexto(db: Banco, sessao: SessaoValida, token: string, selecaoTesteLigada: boolean): Promise<ContextoAcesso> {
  const escopos = await escoposDoUsuario(db, sessao.usuario.id);
  // Se o vínculo do escopo ativo foi removido, a sessão fica sem escopo até o
  // usuário escolher outro: nunca troca de escopo silenciosamente.
  const ativo = escopos.find((e) => e.id === sessao.escopoAtivoId);
  let escopoAtivo: Escopo | null = null;
  let perfil: Perfil | null = null;
  let aprovacaoFinanceira = false;
  let selecaoTeste = false;
  if (ativo) {
    const { role, financialApproval, clientSelectionTest, ...escopo } = ativo;
    escopoAtivo = escopo;
    perfil = role;
    aprovacaoFinanceira = financialApproval;
    selecaoTeste = clientSelectionTest && selecaoTesteLigada;
  }
  return {
    sessao,
    token,
    escopos,
    escopoAtivo,
    perfil,
    // Perfil + concessões explícitas do vínculo (aprovação financeira de claims; seleção cliente — teste).
    permissoes: new Set(permissoesDoVinculo(perfil, aprovacaoFinanceira, selecaoTeste)),
  };
}

/**
 * Autentica a requisição: sessão válida, usuário ativo, vínculos atuais e, em
 * métodos mutáveis, token anti-CSRF.
 */
export function criarAutenticacao(deps: Dependencias) {
  async function autenticar(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Rotas que autenticam antes de ler o corpo (envio de arquivo) não repetem a verificação.
    if (request.acesso) return;
    const token = request.cookies[nomeCookie(deps.config)];
    if (!token) throw naoAutenticado();
    const resultado = await deps.sessoes.validar(token);
    if (resultado.estado !== 'valida') {
      limparCookie(reply, deps.config);
      throw resultado.estado === 'expirada' ? sessaoExpirada() : naoAutenticado();
    }
    request.acesso = await montarContexto(deps.db, resultado.sessao, token, deps.selecaoClienteTeste);
    if (ehMutavel(request.method)) {
      const enviado = request.headers['x-csrf-token'];
      if (typeof enviado !== 'string' || !iguaisEmTempoConstante(enviado, tokenCsrf(token))) {
        throw new ErroHttp(403, 'CSRF_INVALIDO', 'Token de segurança ausente ou inválido. Recarregue a página.');
      }
    }
  }

  function exigirPermissao(permissao: Permissao) {
    return exigirAlguma([permissao]);
  }

  /** Basta uma das permissões (a verificação fina fica no serviço). */
  function exigirAlguma(permissoes: readonly Permissao[]) {
    const permissao = permissoes.join(' | ');
    return async function verificarPermissao(request: FastifyRequest): Promise<void> {
      const contexto = contextoDe(request);
      const escopo = escopoAtivoDe(request);
      if (permissoes.some((p) => contexto.permissoes.has(p))) return;
      await registrarEvento(deps.db, {
        acao: 'ACESSO_NEGADO',
        resultado: 'NEGADO',
        atorUsuarioId: contexto.sessao.usuario.id,
        escopoId: escopo.id,
        detalhes: { permissao, metodo: request.method, rota: request.routeOptions.url ?? request.url },
        requestId: request.id,
      }).catch((erro: unknown) => {
        request.log.error({ err: erro }, 'Falha ao registrar acesso negado');
      });
      throw acessoNegado();
    };
  }

  return { autenticar, exigirPermissao, exigirAlguma };
}

export type Autenticacao = ReturnType<typeof criarAutenticacao>;
