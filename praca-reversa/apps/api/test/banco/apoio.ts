import { SessaoSchema, type Perfil, type Sessao } from '@praca-reversa/contracts';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { criarApp, type OpcoesApp } from '../../src/app.js';
import { criarBanco, type Banco } from '../../src/db/cliente.js';
import { semearDemonstracao } from '../../src/demo/semear.js';
import { gerarHashSenha } from '../../src/modules/acesso/senhas.js';

export { ID_ESCOPO_NAVEGACAO, ID_ESCOPO_PRACA } from '../../src/demo/fixtures.js';

const arquivoEnv = new URL('../../../../.env', import.meta.url);
if (existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);

export const URL_TESTE = (() => {
  const url = process.env.DATABASE_URL_TESTE;
  if (!url) throw new Error('DATABASE_URL_TESTE não definido.');
  return url;
})();

export const CONFIG_TESTE = {
  ambiente: 'teste',
  cookieSeguro: false,
  appSegredo: 'segredo-somente-para-testes-automatizados-0123456789',
  sessaoInatividadeMinutos: 120,
  sessaoDuracaoMaximaHoras: 12,
  urlPublica: 'http://praca.teste.invalid:8080',
} as const;

export function bancoDeTeste(): Banco {
  return criarBanco(URL_TESTE, () => undefined);
}

const TABELAS = [
  'item_conferencia_volumes',
  'conferencia_volumes',
  'historico_conteudo',
  'historico_codigo_palete',
  'evento_volumes_janela',
  'meta_janela_volumes',
  'reconferencia_palete',
  'contagem_volumes',
  'conteudo_palete',
  'alteracao_planilha',
  'publicacao_planilha',
  'geracao_planilha',
  'envio_externo',
  'controle_planilha',
  'controle_protecao',
  'registro_protecao',
  'vinculo_selecao_reserva',
  'resolucao_linha_selecao',
  'linha_selecao',
  'selecao_cliente',
  'descricao_caixa_documento',
  'conteudo_documento_palete',
  'informacao_documento',
  'vinculo_documento_palete',
  'linha_inventario',
  'inventario_referencia',
  'endereco_posicao',
  'sequencia_endereco_faixa',
  'anexo_conferencia',
  'evento_janela',
  'anexo_janela',
  'linha_retorno',
  'retorno_expedicao',
  'correcao_expedicao',
  'documento_expedicao',
  'metrica_expedicao',
  'unidade_carga_expedicao',
  'linha_expedicao',
  'expedicao',
  'metrica_reserva',
  'unidade_carga_reserva',
  'linha_reserva',
  'reserva_janela',
  'versao_regras_janela',
  'restricao_janela',
  'janela_devolucao',
  'evento_liberacao',
  'evento_claim',
  'resultado_linha_claim',
  'anexo_claim',
  'vinculo_material_claim',
  'recuperacao_claim',
  'resultado_claim',
  'evidencia_claim',
  'candidato_claim',
  'linha_claim',
  'claim',
  'linha_documento_devolucao',
  'documento_devolucao',
  'linha_importacao',
  'arquivo_importacao',
  'lote_importacao',
  'evento_auditoria',
  'registro_idempotencia',
  'historico_layout',
  'sequencia_palete',
  'codigo_barras',
  'sessao',
  'preferencia_usuario',
  'vinculo',
  'item_declarado',
  'produto',
  'usuario',
  'evento_localizacao',
  'linha_evento_estoque',
  'evento_estoque',
  'saldo_estoque',
  'segmento_estoque',
  'revisao_observacao',
  'observacao_conferencia',
  'sessao_conferencia',
  'palete',
  'posicao',
  'fileira',
  'elemento_layout',
  'layout',
  'escopo',
  'cliente',
  'unidade',
];

/** Esvazia o banco de testes e, por padrão, aplica o seed de demonstração. */
export async function prepararDados(db: Banco, comDemonstracao = true): Promise<void> {
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${TABELAS.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  if (comDemonstracao) await semearDemonstracao(db, new Date('2026-10-01T12:00:00Z'));
}

/** Relógio controlável para expiração de sessão e janelas de limite. */
export class Relogio {
  private atual = new Date('2026-10-02T12:00:00.000Z');
  readonly agora = (): Date => new Date(this.atual.getTime());
  avancar(ms: number): void {
    this.atual = new Date(this.atual.getTime() + ms);
  }
}

export interface UsuarioTeste {
  id: string;
  login: string;
  senha: string;
}

/** Usuário de teste com senha aleatória (nada fixo em código). */
export async function criarUsuario(
  db: Banco,
  login: string,
  vinculos: readonly (readonly [string, Perfil])[],
  ativo = true,
): Promise<UsuarioTeste> {
  const senha = randomBytes(12).toString('base64url');
  const usuario = await db.usuario.create({
    data: {
      login,
      nome: `Usuário ${login}`,
      senhaHash: await gerarHashSenha(senha),
      ativo,
      vinculos: { create: vinculos.map(([escopoId, perfil]) => ({ escopoId, perfil })) },
    },
  });
  return { id: usuario.id, login, senha };
}

export async function appDeTeste(
  db: Banco,
  extra: Partial<Pick<OpcoesApp, 'agora' | 'limitesLogin' | 'limitesImportacao' | 'limitesImportacaoPlanilha' | 'exportacaoMaxLinhas' | 'claims'>> = {},
): Promise<FastifyInstance> {
  return criarApp({ db, config: CONFIG_TESTE, interfaceDir: null, ...extra, ...(process.env.LOG_TESTE ? { logger: { level: "error" } } : {}) });
}

export interface SessaoTeste {
  cookie: string;
  csrf: string;
  corpo: Sessao;
}

export function cookieDe(resposta: LightMyRequestResponse): string {
  const cabecalho = resposta.headers['set-cookie'];
  const linha = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
  if (!linha) throw new Error('Resposta sem Set-Cookie.');
  return linha.split(';')[0] ?? '';
}

export async function entrar(app: FastifyInstance, usuario: Pick<UsuarioTeste, 'login' | 'senha'>): Promise<SessaoTeste> {
  const resposta = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { login: usuario.login, senha: usuario.senha } });
  if (resposta.statusCode !== 200) throw new Error(`Login falhou: ${String(resposta.statusCode)} ${resposta.body}`);
  const corpo = SessaoSchema.parse(resposta.json());
  return { cookie: cookieDe(resposta), csrf: corpo.csrfToken, corpo };
}

/** Requisição autenticada; envia o token anti-CSRF salvo indicação contrária. */
export function como(
  app: FastifyInstance,
  sessao: SessaoTeste,
  opcoes: InjectOptions & { semCsrf?: boolean },
): Promise<LightMyRequestResponse> {
  const { semCsrf, headers, ...resto } = opcoes;
  return app.inject({
    ...resto,
    headers: { ...headers, cookie: sessao.cookie, ...(semCsrf ? {} : { 'x-csrf-token': sessao.csrf }) },
  });
}

export function chave(): string {
  return `teste-${randomBytes(9).toString('base64url')}`;
}

/** Mutação autenticada com token anti-CSRF e chave de idempotência (nova, salvo indicação). */
export function mutar(
  app: FastifyInstance,
  sessao: SessaoTeste,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload: unknown,
  chaveIdem: string = chave(),
): Promise<LightMyRequestResponse> {
  return como(app, sessao, { method, url, payload: payload as InjectOptions['payload'], headers: { 'idempotency-key': chaveIdem } });
}

/** ID permanente da posição pelo código no layout ativo do escopo. */
export async function idPosicao(db: Banco, escopoId: string, codigo: string): Promise<string> {
  const posicao = await db.posicao.findFirstOrThrow({ where: { escopoId, codigo, layout: { ativo: true } }, select: { id: true } });
  return posicao.id;
}

/** Código de erro estável de uma resposta da API. */
export function codigoErro(resposta: LightMyRequestResponse): string {
  const corpo = resposta.json<{ error?: { code?: string } }>();
  return corpo.error?.code ?? `(sem erro: ${String(resposta.statusCode)})`;
}

/** Envia um arquivo de importação como o navegador faz (octet-stream, nome no cabeçalho). */
export function enviarArquivo(
  app: FastifyInstance,
  sessao: SessaoTeste,
  tipo: 'PRODUTOS' | 'DEVOLUCOES' | 'CLAIMS' | 'INVENTARIO' | 'SELECAO_CLIENTE',
  nome: string,
  conteudo: Buffer,
  chaveIdem: string = chave(),
): Promise<LightMyRequestResponse> {
  return como(app, sessao, {
    method: 'POST',
    url: `/api/v1/importacoes?tipo=${tipo}`,
    payload: conteudo,
    headers: { 'content-type': 'application/octet-stream', 'x-arquivo-nome': encodeURIComponent(nome), 'idempotency-key': chaveIdem },
  });
}
