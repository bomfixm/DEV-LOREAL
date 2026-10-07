import { API_PREFIXO, LoginSchema, TrocaEscopoSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { ErroHttp, acessoNegado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import {
  contextoDe,
  corpoSessao,
  limparCookie,
  montarContexto,
  nomeCookie,
  opcoesCookie,
  type Dependencias,
} from './contexto.js';
import { escoposDoUsuario } from './escopos.js';
import { hashParaContaInexistente, verificarSenha } from './senhas.js';

const CREDENCIAIS_INVALIDAS = 'Usuário ou senha inválidos.';

/** POST /sessao (login) é público; as demais rotas exigem sessão. */
export function registrarRotasLogin(app: FastifyInstance, deps: Dependencias): void {
  app.post(`${API_PREFIXO}/sessao`, async (request, reply) => {
    const dados = LoginSchema.safeParse(request.body);
    if (!dados.success) throw requisicaoInvalida('Informe usuário e senha.');
    const login = dados.data.login.trim().toLowerCase();

    const espera = Math.max(deps.limiteLoginPorConta.bloqueadoPor(login), deps.limiteLoginPorIp.bloqueadoPor(request.ip));
    if (espera > 0) {
      await registrarEvento(deps.db, {
        acao: 'LOGIN_BLOQUEADO',
        resultado: 'NEGADO',
        detalhes: { motivo: 'limite_de_tentativas' },
        requestId: request.id,
      });
      throw new ErroHttp(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas de entrada. Aguarde alguns minutos e tente novamente.', {
        'retry-after': String(espera),
      });
    }

    const usuario = await deps.db.usuario.findUnique({ where: { login } });
    // Mesmo custo de verificação para conta inexistente: o tempo de resposta
    // não revela se o login existe.
    const senhaConfere = await verificarSenha(dados.data.senha, usuario?.senhaHash ?? (await hashParaContaInexistente()));
    if (!usuario || !senhaConfere || !usuario.ativo) {
      deps.limiteLoginPorConta.registrar(login);
      deps.limiteLoginPorIp.registrar(request.ip);
      await registrarEvento(deps.db, {
        acao: 'LOGIN_FALHA',
        resultado: 'NEGADO',
        atorUsuarioId: usuario?.id ?? null,
        detalhes: { motivo: usuario && senhaConfere ? 'conta_inativa' : 'credenciais' },
        requestId: request.id,
      });
      throw new ErroHttp(401, 'CREDENCIAIS_INVALIDAS', CREDENCIAIS_INVALIDAS);
    }

    deps.limiteLoginPorConta.limpar(login);
    const anterior = request.cookies[nomeCookie(deps.config)];
    if (anterior) await deps.sessoes.revogarPorToken(anterior, 'NOVO_LOGIN');

    const escopos = await escoposDoUsuario(deps.db, usuario.id);
    const { token, sessao } = await deps.sessoes.criar(usuario.id, escopos[0]?.id ?? null);
    const contexto = await montarContexto(deps.db, sessao, token);
    reply.setCookie(nomeCookie(deps.config), token, opcoesCookie(deps.config));
    await registrarEvento(deps.db, {
      acao: 'LOGIN_SUCESSO',
      resultado: 'SUCESSO',
      atorUsuarioId: usuario.id,
      escopoId: contexto.escopoAtivo?.id ?? null,
      requestId: request.id,
    });
    return corpoSessao(contexto, deps.config);
  });
}

export function registrarRotasSessao(app: FastifyInstance, deps: Dependencias): void {
  app.get(`${API_PREFIXO}/sessao`, (request) => corpoSessao(contextoDe(request), deps.config));

  app.delete(`${API_PREFIXO}/sessao`, async (request, reply) => {
    const contexto = contextoDe(request);
    await deps.sessoes.revogar(contexto.sessao.id, 'LOGOUT');
    limparCookie(reply, deps.config);
    await registrarEvento(deps.db, {
      acao: 'LOGOUT',
      resultado: 'SUCESSO',
      atorUsuarioId: contexto.sessao.usuario.id,
      escopoId: contexto.escopoAtivo?.id ?? null,
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  app.put(`${API_PREFIXO}/sessao/escopo`, async (request) => {
    const contexto = contextoDe(request);
    const dados = TrocaEscopoSchema.safeParse(request.body);
    if (!dados.success) throw requisicaoInvalida('Escopo inválido.');
    const destino = contexto.escopos.find((e) => e.id === dados.data.scopeId);
    if (!destino) {
      const existe = await deps.db.escopo.findUnique({ where: { id: dados.data.scopeId }, select: { id: true } });
      await registrarEvento(deps.db, {
        acao: 'ESCOPO_ALTERADO',
        resultado: 'NEGADO',
        atorUsuarioId: contexto.sessao.usuario.id,
        escopoId: existe?.id ?? null,
        detalhes: { escopoSolicitado: dados.data.scopeId, escopoAtual: contexto.escopoAtivo?.id ?? null },
        requestId: request.id,
      });
      throw acessoNegado();
    }
    await deps.sessoes.definirEscopo(contexto.sessao.id, destino.id);
    await registrarEvento(deps.db, {
      acao: 'ESCOPO_ALTERADO',
      resultado: 'SUCESSO',
      atorUsuarioId: contexto.sessao.usuario.id,
      escopoId: destino.id,
      detalhes: { escopoAnterior: contexto.escopoAtivo?.id ?? null },
      requestId: request.id,
    });
    const atualizado = await montarContexto(deps.db, { ...contexto.sessao, escopoAtivoId: destino.id }, contexto.token);
    return corpoSessao(atualizado, deps.config);
  });
}
