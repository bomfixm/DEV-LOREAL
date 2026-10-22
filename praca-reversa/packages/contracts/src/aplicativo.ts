import { z } from 'zod';
import { ChaveIdempotenciaSchema } from './admin.js';

/**
 * Etapa 09: compatibilidade entre interface (PWA) e API, consulta do resultado
 * de operações incertas e interpretação de leituras (câmera, leitor-teclado).
 */

/**
 * Versão do contrato entre interface e API. Aumenta quando uma mudança deixa
 * de servir a interfaces já abertas (rota, campo obrigatório ou significado
 * alterados). Interface e API do mesmo build têm o mesmo número.
 */
export const VERSAO_CONTRATO = 11;
/** Menor contrato de interface que a API aceita em gravações. */
export const CONTRATO_MINIMO_INTERFACE = 11;
/** Contrato da interface (no pedido) e da API (na resposta). */
export const CABECALHO_CONTRATO = 'x-praca-contrato';

/** A interface com este contrato pode gravar nesta API? */
export function contratoAceito(contratoInterface: number, api: { contract: number; minimumClientContract: number }): boolean {
  return Number.isInteger(contratoInterface) && contratoInterface >= api.minimumClientContract && contratoInterface <= api.contract;
}

/** GET /api/v1/versao (público): versões e políticas que a interface precisa antes de gravar. */
export const VersaoServidorSchema = z.object({
  application: z.string().min(1),
  contract: z.number().int().positive(),
  minimumClientContract: z.number().int().positive(),
  /** Política de rascunho no armazenamento do navegador (PERSISTENCIA_LOCAL); desligada em produção. */
  localDrafts: z.boolean(),
  /** Origem dos links das etiquetas QR (APP_URL_PUBLICA). */
  labelOrigin: z.string().min(1),
  /** Caminho-base da instalação ("/" ou "/praca/"). */
  basePath: z.string().regex(/^\/(?:[A-Za-z0-9._~-]+\/)*$/),
});
export type VersaoServidor = z.infer<typeof VersaoServidorSchema>;

export const ChaveOperacaoSchema = ChaveIdempotenciaSchema;

/**
 * GET /api/v1/operacoes/<chave>: resultado de um pedido com chave de
 * idempotência, só do usuário e do escopo ativo. REGISTRADA = o servidor
 * concluiu e guardou a resposta (repetir a mesma chave devolve a mesma
 * resposta, sem nova gravação). NAO_ENCONTRADA = nada foi concluído com esta
 * chave até agora; um pedido ainda em processamento também aparece assim, por
 * isso a interface só conclui "não registrado" depois do tempo-limite das
 * transações.
 */
export const ResultadoOperacaoSchema = z.object({
  key: z.string().min(1),
  state: z.enum(['REGISTRADA', 'NAO_ENCONTRADA']),
  operations: z.array(
    z.object({
      operation: z.string().min(1),
      status: z.number().int(),
      recordedAt: z.iso.datetime({ offset: true }),
      response: z.unknown(),
    }),
  ),
  checkedAt: z.iso.datetime({ offset: true }),
});
export type ResultadoOperacao = z.infer<typeof ResultadoOperacaoSchema>;

/**
 * Tempo máximo para um pedido ainda estar em processamento no servidor: a
 * maior espera + duração de transação dos serviços (confirmação de
 * importação: 10 s + 120 s), com margem. Antes disso, "não encontrada" quer
 * dizer só "ainda não concluída"; reenviar com a mesma chave é sempre seguro.
 */
export const LIMITE_PROCESSAMENTO_MS = 140_000;

// ---------- Leituras (câmera e leitor-teclado) ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESQUEMA = /^[a-z][a-z0-9+.-]*:/i;
/** Código de produto/embalagem: texto imprimível sem espaços (igual a CodigoBarrasSchema). */
const CODIGO = /^[\x21-\x7E]{1,64}$/;

export type Leitura =
  /** QR interno do palete (ID permanente ou link deste sistema). */
  | { tipo: 'palete'; id: string }
  /** Link de palete com outro endereço (outra instalação ou APP_URL_PUBLICA antiga): só abre por ação explícita. */
  | { tipo: 'palete-outra-origem'; id: string; origem: string }
  /** Endereço ou esquema não reconhecido: nada é aberto nem executado. */
  | { tipo: 'externo'; texto: string }
  /** Código de produto/embalagem como foi lido (zeros preservados). */
  | { tipo: 'codigo'; codigo: string }
  /** Vazio, longo demais ou com caracteres de controle. */
  | { tipo: 'invalido' };

export interface ContextoLeitura {
  /** Origens desta instalação (a aberta no navegador e a das etiquetas). */
  origens: readonly string[];
  /** Caminho-base, terminado em "/". */
  caminhoBase: string;
}

/** Partes usadas da URL (WHATWG URL, presente no navegador e no Node; este pacote não depende de DOM). */
interface UrlAnalisada {
  protocol: string;
  username: string;
  password: string;
  origin: string;
  pathname: string;
}
const ConstrutorUrl = (globalThis as unknown as { URL: new (texto: string) => UrlAnalisada }).URL;

function idDoCaminho(caminho: string, base: string): string | null {
  if (!caminho.startsWith(base)) return null;
  const resto = caminho.slice(base.length).replace(/\/$/, '');
  const partes = resto.split('/');
  if (partes.length !== 2 || partes[0] !== 'paletes') return null;
  const id = partes[1] ?? '';
  return UUID.test(id) ? id.toLowerCase() : null;
}

/**
 * Interpreta um texto lido. Só o ID de palete ou o link exato de palete desta
 * instalação abre o palete; qualquer outro endereço é tratado como externo e
 * mostrado como texto. O código de produto volta como foi lido (sem trocar
 * maiúsculas, sem remover zeros), só sem espaços/quebras das pontas.
 */
export function interpretarLeitura(texto: string, contexto: ContextoLeitura): Leitura {
  // Só espaços e quebras das pontas (sufixo do leitor-teclado); controle no meio torna inválido.
  const valor = texto.trim();
  if (valor === '' || valor.length > 2_048 || /\p{Cc}/u.test(valor)) return { tipo: 'invalido' };
  if (UUID.test(valor)) return { tipo: 'palete', id: valor.toLowerCase() };
  if (ESQUEMA.test(valor)) {
    let url: UrlAnalisada;
    try {
      url = new ConstrutorUrl(valor);
    } catch {
      return { tipo: 'externo', texto: valor.slice(0, 200) };
    }
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === '') {
      const local = contexto.origens.includes(url.origin);
      const id = idDoCaminho(url.pathname, local ? contexto.caminhoBase : '/') ?? (local ? null : idDoCaminhoQualquerBase(url.pathname));
      if (id !== null) return local ? { tipo: 'palete', id } : { tipo: 'palete-outra-origem', id, origem: url.origin };
    }
    return { tipo: 'externo', texto: valor.slice(0, 200) };
  }
  return CODIGO.test(valor) ? { tipo: 'codigo', codigo: valor } : { tipo: 'invalido' };
}

/** Link de outra instalação: aceita /paletes/<id> sob qualquer caminho-base. */
function idDoCaminhoQualquerBase(caminho: string): string | null {
  const m = /^(?:\/[A-Za-z0-9._~-]+)*\/paletes\/([0-9a-f-]{36})\/?$/i.exec(caminho);
  const id = m?.[1];
  return id !== undefined && UUID.test(id) ? id.toLowerCase() : null;
}
