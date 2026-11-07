import {
  API_PREFIXO,
  CodigoSegundoFatorSchema,
  DesativarSegundoFatorSchema,
  ERRO_SEGUNDO_FATOR_NECESSARIO,
  LoginSchema,
  TrocaEscopoSchema,
  type SegundoFatorAtivado,
  type SegundoFatorInicio,
  type SegundoFatorSituacao,
} from '@praca-reversa/contracts';
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
import { revogarSessoesDoUsuario } from './sessoes.js';

const CREDENCIAIS_INVALIDAS = 'Usuário ou senha inválidos.';

/** POST /sessao (login) é público; as demais rotas exigem sessão. */
export function registrarRotasLogin(app: FastifyInstance, deps: Dependencias): void {
  app.post(`${API_PREFIXO}/sessao`, async (request, reply) => {
    const dados = LoginSchema.safeParse(request.body);
    if (!dados.success) throw requisicaoInvalida('Informe usuário e senha.');
    const login = dados.data.login.trim().toLowerCase();

    const espera = Math.max(await deps.limiteLoginPorConta.bloqueadoPor(login), await deps.limiteLoginPorIp.bloqueadoPor(request.ip));
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
      await deps.limiteLoginPorConta.registrar(login);
      await deps.limiteLoginPorIp.registrar(request.ip);
      await registrarEvento(deps.db, {
        acao: 'LOGIN_FALHA',
        resultado: 'NEGADO',
        atorUsuarioId: usuario?.id ?? null,
        detalhes: { motivo: usuario && senhaConfere ? 'conta_inativa' : 'credenciais' },
        requestId: request.id,
      });
      throw new ErroHttp(401, 'CREDENCIAIS_INVALIDAS', CREDENCIAIS_INVALIDAS);
    }

    // Segundo fator: senha certa não basta para quem ativou. Sem código, o cliente pede e repete o envio.
    let metodoSegundoFator: 'TOTP' | 'RECUPERACAO' | null = null;
    if (await deps.segundoFator.exigido(usuario.id)) {
      if (!dados.data.codigo) {
        throw new ErroHttp(401, ERRO_SEGUNDO_FATOR_NECESSARIO, 'Digite o código do aplicativo autenticador.');
      }
      metodoSegundoFator = await deps.segundoFator.conferir(usuario.id, dados.data.codigo);
      if (metodoSegundoFator === null) {
        await deps.limiteLoginPorConta.registrar(login);
        await deps.limiteLoginPorIp.registrar(request.ip);
        await registrarEvento(deps.db, {
          acao: 'LOGIN_FALHA',
          resultado: 'NEGADO',
          atorUsuarioId: usuario.id,
          detalhes: { motivo: 'segundo_fator' },
          requestId: request.id,
        });
        throw new ErroHttp(401, 'CODIGO_INVALIDO', 'Código inválido ou já usado. Tente o código atual do aplicativo.');
      }
    }

    await deps.limiteLoginPorConta.limpar(login);
    const anterior = request.cookies[nomeCookie(deps.config)];
    if (anterior) await deps.sessoes.revogarPorToken(anterior, 'NOVO_LOGIN');

    const escopos = await escoposDoUsuario(deps.db, usuario.id);
    const { token, sessao } = await deps.sessoes.criar(usuario.id, escopos[0]?.id ?? null);
    const contexto = await montarContexto(deps.db, sessao, token, deps.selecaoClienteTeste);
    reply.setCookie(nomeCookie(deps.config), token, opcoesCookie(deps.config));
    await registrarEvento(deps.db, {
      acao: 'LOGIN_SUCESSO',
      resultado: 'SUCESSO',
      atorUsuarioId: usuario.id,
      escopoId: contexto.escopoAtivo?.id ?? null,
      ...(metodoSegundoFator ? { detalhes: { segundoFator: metodoSegundoFator } } : {}),
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

  // Encerra TODAS as sessões abertas do usuário (inclusive esta), em qualquer aparelho.
  app.delete(`${API_PREFIXO}/sessao/todas`, async (request, reply) => {
    const contexto = contextoDe(request);
    const encerradas = await revogarSessoesDoUsuario(deps.db, contexto.sessao.usuario.id, 'LOGOUT_TODOS', new Date());
    limparCookie(reply, deps.config);
    await registrarEvento(deps.db, {
      acao: 'LOGOUT_TODOS',
      resultado: 'SUCESSO',
      atorUsuarioId: contexto.sessao.usuario.id,
      escopoId: contexto.escopoAtivo?.id ?? null,
      detalhes: { sessoesEncerradas: encerradas },
      requestId: request.id,
    });
    return reply.code(204).send();
  });

  // ---- Verificação em duas etapas (da própria conta) ----
  const URL_2FA = `${API_PREFIXO}/sessao/segundo-fator`;
  // Erros de código aqui contam no mesmo limite do login, sob uma chave própria da conta.
  const chaveLimite = (usuarioId: string) => `2fa:${usuarioId}`;
  async function checarLimite(usuarioId: string): Promise<void> {
    const espera = await deps.limiteLoginPorConta.bloqueadoPor(chaveLimite(usuarioId));
    if (espera > 0) {
      throw new ErroHttp(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas de código. Aguarde alguns minutos e tente novamente.', { 'retry-after': String(espera) });
    }
  }

  app.get(URL_2FA, async (request): Promise<SegundoFatorSituacao> => {
    const s = await deps.segundoFator.situacao(contextoDe(request).sessao.usuario.id);
    return { enabled: s.ativo, recoveryCodesLeft: s.codigosRecuperacaoRestantes };
  });

  app.post(`${URL_2FA}/iniciar`, async (request): Promise<SegundoFatorInicio> => {
    const { usuario } = contextoDe(request).sessao;
    const r = await deps.segundoFator.iniciar(usuario.id, usuario.login);
    if (r === 'JA_ATIVO') throw new ErroHttp(409, 'CONFLITO', 'A verificação em duas etapas já está ativa. Desative-a antes de cadastrar de novo.');
    return { secret: r.segredo, otpauthUri: r.uri };
  });

  app.post(`${URL_2FA}/ativar`, async (request): Promise<SegundoFatorAtivado> => {
    const contexto = contextoDe(request);
    const dados = CodigoSegundoFatorSchema.safeParse(request.body);
    if (!dados.success) throw requisicaoInvalida('Informe o código de 6 dígitos.');
    const usuarioId = contexto.sessao.usuario.id;
    await checarLimite(usuarioId);
    const r = await deps.segundoFator.ativar(usuarioId, dados.data.code);
    if (r === 'JA_ATIVO') throw new ErroHttp(409, 'CONFLITO', 'A verificação em duas etapas já está ativa.');
    if (r === 'SEM_CADASTRO') throw requisicaoInvalida('Comece o cadastro antes de confirmar o código.');
    if (r === 'CODIGO_INVALIDO') {
      await deps.limiteLoginPorConta.registrar(chaveLimite(usuarioId));
      throw new ErroHttp(422, 'CODIGO_INVALIDO', 'Código inválido. Confira o código atual no aplicativo e a hora do celular.');
    }
    await deps.limiteLoginPorConta.limpar(chaveLimite(usuarioId));
    await registrarEvento(deps.db, {
      acao: 'SEGUNDO_FATOR_ATIVADO',
      resultado: 'SUCESSO',
      atorUsuarioId: usuarioId,
      escopoId: contexto.escopoAtivo?.id ?? null,
      requestId: request.id,
    });
    return { recoveryCodes: r };
  });

  app.post(`${URL_2FA}/desativar`, async (request, reply) => {
    const contexto = contextoDe(request);
    const dados = DesativarSegundoFatorSchema.safeParse(request.body);
    if (!dados.success) throw requisicaoInvalida('Informe a senha e um código.');
    const usuarioId = contexto.sessao.usuario.id;
    await checarLimite(usuarioId);
    const registro = await deps.db.usuario.findUnique({ where: { id: usuarioId } });
    const senhaConfere = registro ? await verificarSenha(dados.data.password, registro.senhaHash) : false;
    const codigoConfere = senhaConfere ? (await deps.segundoFator.conferir(usuarioId, dados.data.code)) !== null : false;
    if (!senhaConfere || !codigoConfere) {
      await deps.limiteLoginPorConta.registrar(chaveLimite(usuarioId));
      throw new ErroHttp(422, 'CODIGO_INVALIDO', 'Senha ou código inválidos.');
    }
    await deps.limiteLoginPorConta.limpar(chaveLimite(usuarioId));
    await deps.segundoFator.remover(usuarioId);
    await registrarEvento(deps.db, {
      acao: 'SEGUNDO_FATOR_DESATIVADO',
      resultado: 'SUCESSO',
      atorUsuarioId: usuarioId,
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
    const atualizado = await montarContexto(deps.db, { ...contexto.sessao, escopoAtivoId: destino.id }, contexto.token, deps.selecaoClienteTeste);
    return corpoSessao(atualizado, deps.config);
  });
}
