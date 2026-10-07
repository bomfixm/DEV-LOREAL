import fastifyCookie from '@fastify/cookie';
import type { LimitesImportacao } from '@praca-reversa/contracts';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { lerVersao, type ConfigClaims } from './config.js';
import { ehFalhaDeConexao, type Banco } from './db/cliente.js';
import { ehRestricaoDeImportacao, restricaoDeClaim, restricaoDeConferencia, restricaoDeJanela } from './db/erros.js';
import { ErroHttp, corpoErro, enviarErro } from './http/erros.js';
import { ehRotaDaInterface, enviarIndice, registrarInterface } from './http/interface.js';
import { registrarSeguranca } from './http/seguranca.js';
import { criarAutenticacao, type ConfigAcesso, type Dependencias } from './modules/acesso/contexto.js';
import { registrarRotasOperacoes, registrarRotasVersao, type ConfigAplicativo } from './modules/aplicativo/rotas.js';
import { LimitadorTentativas, type RegraLimite } from './modules/acesso/limitador.js';
import { registrarRotasLogin, registrarRotasSessao } from './modules/acesso/rotas.js';
import { hashParaContaInexistente } from './modules/acesso/senhas.js';
import { ServicoSessoes } from './modules/acesso/sessoes.js';
import { registrarRotasAdmin } from './modules/admin/rotas.js';
import { registrarRotasAjuda } from './modules/ajuda/rotas.js';
import { registrarRotasIndicadores } from './modules/indicadores/rotas.js';
import { registrarRotasConferencia } from './modules/conferencia/rotas.js';
import { registrarRotasBusca } from './modules/busca/rotas.js';
import { registrarRotasEtiquetas } from './modules/etiquetas/rotas.js';
import { LIMITE_EXPORTACAO_PADRAO, LIMITES_IMPORTACAO_PADRAO, LIMITES_PLANILHA_PADRAO } from './modules/importacao/campos.js';
import { registrarRotasImportacao } from './modules/importacao/rotas.js';
import { registrarRotasClaims } from './modules/claims/rotas.js';
import { registrarRotasJanelas } from './modules/janelas/rotas.js';
import { registrarRotasLayout } from './modules/layout/rotas.js';
import { registrarRotasMovimentos } from './modules/movimentos/rotas.js';
import { registrarRotasPaletes } from './modules/paletes/rotas.js';
import { registrarRotasPraca } from './modules/praca/rotas.js';
import { registrarRotasProdutos } from './modules/produtos/rotas.js';
import { registrarRotasSaude } from './modules/saude/rotas.js';
import { registrarRotasSelecao } from './modules/selecao/rotas.js';
import { registrarRotasPlanilha } from './modules/planilha/rotas.js';
import type { ConfigPlanilha } from './modules/planilha/situacao.js';

export interface OpcoesApp {
  db: Banco;
  config: ConfigAcesso;
  /** Pasta do build da interface; `null` quando a interface é servida pelo Vite. */
  interfaceDir: string | null;
  logger?: FastifyServerOptions['logger'];
  agora?: () => Date;
  /** Falhas de login permitidas por conta e por IP numa janela de 15 minutos. */
  limitesLogin?: { porConta: RegraLimite; porIp: RegraLimite };
  /** Limites da importação (padrão em modules/importacao/campos.ts). */
  limitesImportacao?: Partial<LimitesImportacao>;
  /** Limites do inventário conferido e da seleção do cliente (padrão em modules/importacao/campos.ts). */
  limitesImportacaoPlanilha?: Partial<LimitesImportacao>;
  exportacaoMaxLinhas?: number;
  /** Ordenação inicial dos claims e limite de anexo (padrão: PRIORIDADE e 5 MB). */
  claims?: Partial<ConfigClaims>;
  /** Versão, caminho-base e política de rascunho local (padrão: package.json, "/", ativada fora de produção). */
  aplicativo?: Partial<ConfigAplicativo>;
  /** Planilha única (padrão: sem destino independente, agendador desligado, geração local em .dados/planilha). */
  planilha?: ConfigPlanilha;
}

const QUINZE_MINUTOS = 15 * 60_000;

/** Sem configuração: geração local só por pedido, sem destino independente. */
const PLANILHA_PADRAO: ConfigPlanilha = {
  automatica: false,
  destino: null,
  pastaLocal: '.dados/planilha',
  intervaloMs: 20_000,
  agruparMs: 30_000,
  reconciliarMs: 3_600_000,
  versoesManter: 60,
  eventosMax: 20_000,
  concessaoMs: 600_000,
  backup: { prazoHoras: 26, destinoDescricao: null, responsavel: null, restauracaoPrazoDias: 90 },
};

export async function criarApp(opcoes: OpcoesApp): Promise<FastifyInstance> {
  const app = Fastify({ logger: opcoes.logger ?? false });
  const agora = opcoes.agora ?? (() => new Date());
  const relogio = () => agora().getTime();
  const limites = opcoes.limitesLogin ?? {
    porConta: { maximo: 5, janelaMs: QUINZE_MINUTOS },
    porIp: { maximo: 30, janelaMs: QUINZE_MINUTOS },
  };
  const deps: Dependencias = {
    db: opcoes.db,
    config: opcoes.config,
    agora,
    sessoes: new ServicoSessoes(
      opcoes.db,
      {
        inatividadeMs: opcoes.config.sessaoInatividadeMinutos * 60_000,
        duracaoMaximaMs: opcoes.config.sessaoDuracaoMaximaHoras * 3_600_000,
      },
      agora,
    ),
    limiteLoginPorConta: new LimitadorTentativas(limites.porConta, relogio),
    limiteLoginPorIp: new LimitadorTentativas(limites.porIp, relogio),
    importacao: { ...LIMITES_IMPORTACAO_PADRAO, ...opcoes.limitesImportacao },
    importacaoPlanilha: { ...LIMITES_PLANILHA_PADRAO, ...opcoes.limitesImportacaoPlanilha },
    exportacaoMaxLinhas: opcoes.exportacaoMaxLinhas ?? LIMITE_EXPORTACAO_PADRAO,
    claims: { ordemPadrao: 'PRIORIDADE', anexoMaxBytes: 5 * 1_048_576, ...opcoes.claims },
    caminhoBase: opcoes.aplicativo?.caminhoBase ?? '/',
  };
  void hashParaContaInexistente();
  const aplicativo: ConfigAplicativo = {
    versao: opcoes.aplicativo?.versao ?? lerVersao(),
    caminhoBase: opcoes.aplicativo?.caminhoBase ?? '/',
    persistenciaLocal: opcoes.aplicativo?.persistenciaLocal ?? opcoes.config.ambiente !== 'producao',
  };
  const base = aplicativo.caminhoBase;

  await app.register(fastifyCookie);
  app.decorateRequest('acesso', null);
  registrarSeguranca(app, base);

  app.setErrorHandler((erro, request, reply) => {
    if (erro instanceof ErroHttp) {
      for (const [nome, valor] of Object.entries(erro.cabecalhos)) reply.header(nome, valor);
      return enviarErro(reply, erro.status, erro.codigo, erro.message);
    }
    if (ehFalhaDeConexao(erro)) {
      request.log.error({ err: erro }, 'Banco indisponível');
      return enviarErro(reply, 503, 'BANCO_INDISPONIVEL', 'Banco de dados indisponível. Tente novamente em instantes.');
    }
    // Proteções do banco que só uma corrida alcança (o serviço valida antes).
    const restricao = restricaoDeConferencia(erro);
    if (restricao !== null) {
      return enviarErro(
        reply,
        409,
        'CONFLITO',
        restricao === 'PALETE_EM_CONFERENCIA'
          ? 'O palete entrou em conferência agora: esta operação fica bloqueada até a conferência terminar.'
          : 'A conferência mudou de situação enquanto o pedido era processado. Recarregue e confira.',
      );
    }
    const claim = restricaoDeClaim(erro);
    if (claim !== null) {
      // Proteções do banco dos claims (só uma corrida chega aqui: o serviço valida antes).
      return claim === 'QUANTIDADE'
        ? enviarErro(reply, 409, 'QUANTIDADE_INDISPONIVEL', 'A quantidade mudou enquanto o pedido era processado: a mesma quantidade física não sustenta duas recuperações. Recarregue e confira.')
        : enviarErro(reply, 409, 'CONFLITO', 'O caso mudou enquanto o pedido era processado. Nada foi gravado: recarregue e confira.');
    }
    const janela = restricaoDeJanela(erro);
    if (janela !== null) {
      // Proteções do banco das janelas (só uma corrida chega aqui: o serviço valida antes).
      const mensagens = {
        CAPACIDADE: ['CAPACIDADE_INSUFICIENTE', 'A capacidade da janela mudou enquanto o pedido era processado: nada foi gravado. Recarregue e revise.'],
        SALDO: ['SALDO_INSUFICIENTE', 'O saldo, a liberação ou as reservas mudaram enquanto o pedido era processado: nada foi gravado. Recarregue e revise.'],
        RETORNO: ['QUANTIDADE_INDISPONIVEL', 'O retorno passaria do enviado ainda não retornado: nada foi gravado.'],
        IMUTAVEL: ['CONFLITO', 'A janela, a reserva ou a expedição mudou enquanto o pedido era processado. Nada foi gravado: recarregue e confira.'],
      } as const;
      const [codigo, texto] = mensagens[janela];
      return enviarErro(reply, 409, codigo, texto);
    }
    if (ehRestricaoDeImportacao(erro)) {
      return enviarErro(reply, 409, 'CONFLITO', 'O lote de importação mudou de situação enquanto o pedido era processado. Recarregue e confira.');
    }
    const status = typeof erro === 'object' && erro !== null && 'statusCode' in erro ? Number(erro.statusCode) : 500;
    if (status === 413) {
      // Anexo de claim tem limite próprio (CLAIMS_ANEXO_MAX_MB).
      if (/\/(claims|janelas|conferencias)\/[^/]+\/anexos$/.test(request.url.split('?')[0] ?? '')) {
        return enviarErro(reply, 413, 'ANEXO_INVALIDO', `Anexo acima do limite de ${(deps.claims.anexoMaxBytes / 1_048_576).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB.`);
      }
      const mb = (b: number) => String(Math.round(b / 1_048_576));
      return enviarErro(
        reply,
        413,
        'ARQUIVO_INVALIDO',
        `Arquivo acima do limite: ${mb(deps.importacao.maxBytes)} MB para produtos, devoluções e claims; ${mb(deps.importacaoPlanilha.maxBytes)} MB para inventário conferido e seleção do cliente.`,
      );
    }
    if (status === 415) return enviarErro(reply, 415, 'REQUISICAO_INVALIDA', 'Formato de envio não aceito: dados em JSON; arquivos de importação como application/octet-stream.');
    if (status >= 400 && status < 500) return enviarErro(reply, status, 'REQUISICAO_INVALIDA', 'Requisição inválida.');
    request.log.error({ err: erro }, 'Falha ao processar requisição');
    return reply.code(500).send(corpoErro('ERRO_INTERNO', 'Erro interno. Tente novamente.', request.id));
  });

  const auth = criarAutenticacao(deps);
  // Com caminho-base (CAMINHO_BASE=/praca/), toda a API fica em /praca/api/v1.
  await app.register(
    async (raiz) => {
      registrarRotasSaude(raiz, opcoes.db);
      registrarRotasVersao(raiz, deps, aplicativo);
      registrarRotasLogin(raiz, deps);
      await raiz.register((privado, _opcoes, pronto) => {
        privado.addHook('preHandler', auth.autenticar);
        registrarRotasSessao(privado, deps);
        registrarRotasOperacoes(privado, deps);
        registrarRotasPraca(privado, deps, auth);
        registrarRotasPaletes(privado, deps, auth);
        registrarRotasConferencia(privado, deps, auth);
        registrarRotasMovimentos(privado, deps, auth);
        registrarRotasBusca(privado, deps, auth);
        registrarRotasImportacao(privado, deps, auth);
        registrarRotasClaims(privado, deps, auth);
        registrarRotasJanelas(privado, deps, auth);
        registrarRotasSelecao(privado, deps, auth);
        registrarRotasProdutos(privado, deps, auth);
        registrarRotasLayout(privado, deps, auth);
        registrarRotasEtiquetas(privado, deps, auth);
        registrarRotasAdmin(privado, deps, auth);
        registrarRotasAjuda(privado, deps, auth);
        registrarRotasIndicadores(privado, deps, auth);
        registrarRotasPlanilha(privado, deps, auth, opcoes.planilha ?? PLANILHA_PADRAO);
        pronto();
      });
    },
    { prefix: base === '/' ? '' : base.slice(0, -1) },
  );

  const servirInterface = opcoes.interfaceDir !== null;
  if (opcoes.interfaceDir !== null) await registrarInterface(app, opcoes.interfaceDir, base);

  app.setNotFoundHandler((request, reply) => {
    if (servirInterface && ehRotaDaInterface(request.method, request.url, base)) return enviarIndice(reply);
    // Raiz do servidor com caminho-base: leva à instalação.
    if (servirInterface && base !== '/' && request.method === 'GET' && (request.url === '/' || request.url === base.slice(0, -1))) {
      return reply.redirect(base);
    }
    return enviarErro(reply, 404, 'NAO_ENCONTRADO', 'Recurso não encontrado.');
  });

  return app;
}
