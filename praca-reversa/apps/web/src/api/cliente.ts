import { CABECALHO_CONTRATO, ErroApiSchema, VERSAO_CONTRATO } from '@praca-reversa/contracts';
import type { z } from 'zod';
import { paraEndereco } from '../base';
import { inicioDeEnvio } from '../pwa/protecoes';
import { informarFalhaDeRede, informarResposta, semRedeNoAparelho } from './conexao';
import { descreverOperacao } from './descricoes';
import { bloqueioPara, concluirPorChave, registrarIncerta, type Metodo } from './incertas';
import { informarContratoApi, marcarIncompativel, versaoIncompativel } from './versao';

/**
 * rede: sem resposta; http: o servidor respondeu com erro; formato: resposta
 * fora do contrato (por exemplo, uma página HTML); bloqueio: nada foi enviado
 * (sem rede, versão incompatível ou outro pedido ainda em confirmação).
 */
export type TipoFalha = 'rede' | 'http' | 'formato' | 'bloqueio';

export class FalhaRequisicao extends Error {
  readonly tipo: TipoFalha;
  readonly status: number | null;
  /** Código estável enviado pela API (ex.: ACESSO_NEGADO), quando houver. */
  readonly codigo: string | null;
  /** O pedido pode ter sido gravado pelo servidor (resposta perdida ou erro do servidor). */
  readonly incerta: boolean;

  constructor(tipo: TipoFalha, mensagem: string, status: number | null = null, codigo: string | null = null, incerta = false) {
    super(mensagem);
    this.name = 'FalhaRequisicao';
    this.tipo = tipo;
    this.status = status;
    this.codigo = codigo;
    this.incerta = incerta;
  }
}

/**
 * Token anti-CSRF da sessão atual. Fica só em memória (nunca em
 * localStorage); após recarregar a página, vem de novo em GET /sessao.
 */
let tokenCsrf: string | null = null;
export function definirTokenCsrf(token: string | null): void {
  tokenCsrf = token;
}

type MotivoSessaoPerdida = 'NAO_AUTENTICADO' | 'SESSAO_EXPIRADA';
let aoPerderSessao: ((motivo: MotivoSessaoPerdida) => void) | null = null;
/** A interface registra aqui o que fazer quando a API informa sessão ausente ou expirada. */
export function aoSessaoPerdida(ouvinte: ((motivo: MotivoSessaoPerdida) => void) | null): void {
  aoPerderSessao = ouvinte;
}

export interface OpcoesRequisicao {
  corpo?: unknown;
  signal?: AbortSignal;
  /** Cabeçalho Idempotency-Key das mutações. */
  idempotencia?: string;
  /** Não avisar a interface em 401 (verificação inicial e login). */
  ignorar401?: boolean;
  /** Nome da operação no painel "em confirmação" (padrão: pela rota). */
  descricao?: string;
  /**
   * "tela": a própria tela guarda e verifica o pedido incerto (entradas da
   * conferência, que são independentes entre si). Padrão: painel global.
   */
  incerteza?: 'global' | 'tela';
}

const MUTAVEIS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Entrar, sair e trocar de escopo seguem permitidos com versão incompatível (para atualizar). */
const ROTA_SESSAO = /^\/api\/v1\/sessao(?:\/|$)/;

const TEXTO_SEM_REDE = 'Sem conexão: nada foi enviado. Confirmações exigem o servidor; tente de novo quando a conexão voltar.';
const TEXTO_INCOMPATIVEL = 'Esta tela é de uma versão incompatível com o servidor: nada foi enviado. Use "Atualizar" para carregar a versão nova; o que não foi enviado continua nesta tela.';
const TEXTO_INCERTO =
  'Sem resposta do servidor: o pedido pode ter sido registrado. Ele ficou "em confirmação": verifique o resultado ou repita a mesma ação (com a mesma chave, sem duplicar).';

function cabecalhosBase(metodo: string): Record<string, string> {
  const cabecalhos: Record<string, string> = { accept: 'application/json', [CABECALHO_CONTRATO]: String(VERSAO_CONTRATO) };
  if (metodo !== 'GET' && tokenCsrf) cabecalhos['x-csrf-token'] = tokenCsrf;
  return cabecalhos;
}

/** Bloqueios antes de enviar uma gravação: nada sai do aparelho. */
function conferirAntesDeGravar(metodo: string, url: string, chave: string | undefined, incerteza: 'global' | 'tela'): void {
  if (!MUTAVEIS.has(metodo)) return;
  if (semRedeNoAparelho()) throw new FalhaRequisicao('bloqueio', TEXTO_SEM_REDE, null, 'SEM_CONEXAO');
  if (versaoIncompativel() && !ROTA_SESSAO.test(url)) throw new FalhaRequisicao('bloqueio', TEXTO_INCOMPATIVEL, null, 'VERSAO_INCOMPATIVEL');
  if (chave !== undefined && incerteza === 'global') {
    const anterior = bloqueioPara(metodo, url, chave);
    if (anterior) {
      throw new FalhaRequisicao(
        'bloqueio',
        `Há um pedido anterior em confirmação para este registro (${anterior.descricao}). Verifique o resultado no aviso "Em confirmação" antes de enviar outro pedido.`,
        null,
        'OPERACAO_EM_CONFIRMACAO',
      );
    }
  }
}

function registrarSeIncerta(metodo: string, url: string, opcoes: OpcoesRequisicao, corpoReenviavel: boolean): void {
  if (!MUTAVEIS.has(metodo) || opcoes.idempotencia === undefined || (opcoes.incerteza ?? 'global') === 'tela') return;
  registrarIncerta({
    chave: opcoes.idempotencia,
    metodo: metodo as Metodo,
    url,
    corpo: corpoReenviavel ? opcoes.corpo : undefined,
    descricao: opcoes.descricao ?? descreverOperacao(metodo, url),
  });
}

function lerContrato(resposta: Response): void {
  const contrato = Number(resposta.headers.get(CABECALHO_CONTRATO));
  if (Number.isInteger(contrato) && contrato > 0) informarContratoApi(contrato);
}

function ehJson(resposta: Response): boolean {
  return (resposta.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

function tratarErroHttp(resposta: Response, corpo: unknown, opcoes: OpcoesRequisicao, metodo: string, url: string, corpoReenviavel: boolean): never {
  const erroApi = ErroApiSchema.safeParse(corpo);
  const codigo = erroApi.success ? erroApi.data.error.code : null;
  const mensagem = erroApi.success ? erroApi.data.error.message : `A API respondeu com o código ${String(resposta.status)}.`;
  informarResposta(resposta.status, codigo);
  if (resposta.status === 401 && !opcoes.ignorar401 && (codigo === 'NAO_AUTENTICADO' || codigo === 'SESSAO_EXPIRADA')) {
    aoPerderSessao?.(codigo);
  }
  if (codigo === 'VERSAO_INCOMPATIVEL') marcarIncompativel();
  // Erro do servidor numa gravação: a transação pode ter sido confirmada antes da falha.
  const incerta = MUTAVEIS.has(metodo) && resposta.status >= 500 && opcoes.idempotencia !== undefined;
  if (incerta) registrarSeIncerta(metodo, url, opcoes, corpoReenviavel);
  else if (MUTAVEIS.has(metodo) && opcoes.idempotencia !== undefined) concluirPorChave(opcoes.idempotencia, 'recusada', `Recusada pelo servidor: ${mensagem}`);
  throw new FalhaRequisicao('http', incerta ? `${mensagem} ${TEXTO_INCERTO}` : mensagem, resposta.status, codigo, incerta);
}

async function requisitar(metodo: string, url: string, opcoes: OpcoesRequisicao): Promise<{ resposta: Response; corpo: unknown }> {
  conferirAntesDeGravar(metodo, url, opcoes.idempotencia, opcoes.incerteza ?? 'global');
  const cabecalhos = cabecalhosBase(metodo);
  if (opcoes.corpo !== undefined) cabecalhos['content-type'] = 'application/json';
  if (opcoes.idempotencia) cabecalhos['idempotency-key'] = opcoes.idempotencia;

  // Confirmação em curso: a atualização da versão espera a resposta.
  const fimDoEnvio = MUTAVEIS.has(metodo) ? inicioDeEnvio() : () => undefined;
  let resposta: Response;
  try {
    resposta = await fetch(paraEndereco(url), {
      method: metodo,
      headers: cabecalhos,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opcoes.signal ?? null,
      ...(opcoes.corpo !== undefined ? { body: JSON.stringify(opcoes.corpo) } : {}),
    });
  } catch (erro) {
    fimDoEnvio();
    if (opcoes.signal?.aborted) throw erro;
    informarFalhaDeRede();
    const incerta = MUTAVEIS.has(metodo) && opcoes.idempotencia !== undefined;
    registrarSeIncerta(metodo, url, opcoes, true);
    throw new FalhaRequisicao('rede', incerta ? TEXTO_INCERTO : 'Sem resposta da API. Verifique a conexão e tente novamente.', null, null, incerta);
  }
  fimDoEnvio();
  lerContrato(resposta);

  if (resposta.ok && resposta.status !== 204 && !ehJson(resposta)) {
    // Página HTML (fallback de proxy ou de cache) nunca vale como sucesso da API.
    informarResposta(resposta.status, null);
    const incerta = MUTAVEIS.has(metodo) && opcoes.idempotencia !== undefined;
    registrarSeIncerta(metodo, url, opcoes, true);
    throw new FalhaRequisicao('formato', 'O servidor respondeu com uma página em vez de dados da API. Nada foi exibido como confirmado.', resposta.status, null, incerta);
  }
  const corpo: unknown = resposta.status === 204 ? null : await resposta.json().catch(() => null);
  if (!resposta.ok) return tratarErroHttp(resposta, corpo, opcoes, metodo, url, true);
  informarResposta(resposta.status, null);
  if (MUTAVEIS.has(metodo) && opcoes.idempotencia !== undefined) {
    concluirPorChave(
      opcoes.idempotencia,
      'confirmada',
      resposta.headers.get('idempotency-replayed') === 'true' ? 'Confirmada: o servidor já tinha registrado este pedido (nada foi repetido).' : 'Confirmada pelo servidor.',
    );
  }
  return { resposta, corpo };
}

function validar<T>(corpo: unknown, schema: z.ZodType<T>): T {
  const resultado = schema.safeParse(corpo);
  if (!resultado.success) {
    throw new FalhaRequisicao('formato', 'A API enviou dados em formato inesperado. Nada foi exibido como confirmado.');
  }
  return resultado.data;
}

/**
 * Envio de arquivo (importação, anexo): corpo binário, nome no cabeçalho.
 * Mesmas regras das mutações: token anti-CSRF, chave de idempotência e
 * validação da resposta; sucesso só depois da resposta do servidor. O arquivo
 * nunca é guardado no navegador: uma falha pede para escolher de novo.
 */
export async function enviarArquivo<T>(url: string, arquivo: Blob, nome: string, schema: z.ZodType<T>, idempotencia: string, descricao?: string): Promise<T> {
  const opcoes: OpcoesRequisicao = { idempotencia, ...(descricao !== undefined ? { descricao } : {}) };
  conferirAntesDeGravar('POST', url, idempotencia, 'global');
  const cabecalhos = cabecalhosBase('POST');
  cabecalhos['content-type'] = 'application/octet-stream';
  cabecalhos['x-arquivo-nome'] = encodeURIComponent(nome);
  cabecalhos['idempotency-key'] = idempotencia;
  const fimDoEnvio = inicioDeEnvio();
  let resposta: Response;
  try {
    resposta = await fetch(paraEndereco(url), { method: 'POST', headers: cabecalhos, credentials: 'same-origin', cache: 'no-store', body: arquivo });
  } catch {
    fimDoEnvio();
    informarFalhaDeRede();
    registrarSeIncerta('POST', url, opcoes, false);
    throw new FalhaRequisicao('rede', `Arquivo não confirmado: ${TEXTO_INCERTO}`, null, null, true);
  }
  fimDoEnvio();
  lerContrato(resposta);
  if (resposta.ok && !ehJson(resposta)) {
    informarResposta(resposta.status, null);
    registrarSeIncerta('POST', url, opcoes, false);
    throw new FalhaRequisicao('formato', 'O servidor respondeu com uma página em vez de dados da API: o arquivo não aparece como enviado.', resposta.status, null, true);
  }
  const corpo: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) return tratarErroHttp(resposta, corpo, opcoes, 'POST', url, false);
  informarResposta(resposta.status, null);
  concluirPorChave(idempotencia, 'confirmada', 'Arquivo confirmado pelo servidor.');
  return validar(corpo, schema);
}

/**
 * Baixa um arquivo da API (relatório, exportação, anexo) com a sessão atual.
 * Erros viram FalhaRequisicao (nada é salvo); uma página HTML no lugar do
 * arquivo é recusada; o conteúdo não fica guardado na interface.
 */
export async function baixarArquivo(url: string, nomePadrao: string): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch(paraEndereco(url), {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'text/csv, application/octet-stream, application/pdf, image/*, application/json', [CABECALHO_CONTRATO]: String(VERSAO_CONTRATO) },
    });
  } catch {
    informarFalhaDeRede();
    throw new FalhaRequisicao('rede', 'Sem resposta da API. Verifique a conexão e tente novamente.');
  }
  lerContrato(resposta);
  if (!resposta.ok) {
    const erroApi = ErroApiSchema.safeParse(await resposta.json().catch(() => null));
    informarResposta(resposta.status, erroApi.success ? erroApi.data.error.code : null);
    if (resposta.status === 401 && erroApi.success && (erroApi.data.error.code === 'NAO_AUTENTICADO' || erroApi.data.error.code === 'SESSAO_EXPIRADA')) {
      aoPerderSessao?.(erroApi.data.error.code);
    }
    throw new FalhaRequisicao('http', erroApi.success ? erroApi.data.error.message : `A API respondeu com o código ${String(resposta.status)}.`, resposta.status, erroApi.success ? erroApi.data.error.code : null);
  }
  informarResposta(resposta.status, null);
  if ((resposta.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
    throw new FalhaRequisicao('formato', 'O servidor respondeu com uma página em vez do arquivo. Nada foi salvo.', resposta.status);
  }
  const nome = /filename="([^"]+)"/.exec(resposta.headers.get('content-disposition') ?? '')?.[1] ?? nomePadrao;
  const endereco = URL.createObjectURL(await resposta.blob());
  const link = document.createElement('a');
  link.href = endereco;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(endereco);
  }, 1_000);
}

/** GET com validação da resposta pelo contrato compartilhado. */
export async function obterJson<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal, ignorar401 = false): Promise<T> {
  const { corpo } = await requisitar('GET', url, { ...(signal ? { signal } : {}), ignorar401 });
  return validar(corpo, schema);
}

/** Mutação JSON. A interface só mostra sucesso depois da resposta do servidor. */
export async function enviarJson<T>(
  metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  schema: z.ZodType<T>,
  opcoes: OpcoesRequisicao = {},
): Promise<T> {
  const { corpo } = await requisitar(metodo, url, opcoes);
  return validar(corpo, schema);
}

export function mensagemDeFalha(erro: unknown): string {
  if (erro instanceof FalhaRequisicao) return erro.message;
  return 'Falha inesperada ao consultar a API.';
}
