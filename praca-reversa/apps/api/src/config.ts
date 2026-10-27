import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LimitesImportacao } from '@praca-reversa/contracts';
import { criarDestino, type ConfigPlanilha } from './modules/protecao/configuracao.js';
import { z } from 'zod';

/** Pastas resolvidas a partir deste arquivo; valem para src/ (tsx) e dist/ (node). */
const RAIZ_API = new URL('../', import.meta.url);
export const RAIZ_REPOSITORIO = fileURLToPath(new URL('../../', RAIZ_API));
export const INTERFACE_PADRAO = fileURLToPath(new URL('../web/dist/', RAIZ_API));

const booleano = z.enum(['true', 'false']).transform((v) => v === 'true');

const AmbienteSchema = z.object({
  APP_AMBIENTE: z.enum(['desenvolvimento', 'teste', 'producao']).default('producao'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL precisa ser uma URL PostgreSQL.'),
  APP_SEGREDO: z.string().min(32, 'APP_SEGREDO precisa de pelo menos 32 caracteres.'),
  COOKIE_SEGURO: booleano.optional(),
  SESSAO_INATIVIDADE_MINUTOS: z.coerce.number().int().min(5).max(24 * 60).default(120),
  SESSAO_DURACAO_MAXIMA_HORAS: z.coerce.number().int().min(1).max(72).default(12),
  WEB_DIST: z.string().min(1).optional(),
  /** Endereço pelo qual os aparelhos da operação abrem o sistema (links das etiquetas QR). */
  APP_URL_PUBLICA: z.string().trim().min(1).optional(),
  // Limites da importação e da exportação (README, seção Importação).
  IMPORTACAO_ARQUIVO_MAX_MB: z.coerce.number().int().min(1).max(50).default(5),
  IMPORTACAO_LINHAS_MAX: z.coerce.number().int().min(1).max(50_000).default(5_000),
  IMPORTACAO_COLUNAS_MAX: z.coerce.number().int().min(1).max(200).default(50),
  IMPORTACAO_CELULA_MAX_CARACTERES: z.coerce.number().int().min(100).max(32_767).default(1_000),
  IMPORTACAO_DESCOMPACTADO_MAX_MB: z.coerce.number().int().min(1).max(500).default(50),
  IMPORTACAO_ZIP_ENTRADAS_MAX: z.coerce.number().int().min(10).max(5_000).default(300),
  IMPORTACAO_TEMPO_MAX_S: z.coerce.number().int().min(1).max(120).default(20),
  // Planilhas operacionais (inventário conferido e seleção do cliente): abas grandes, muitas células só formatadas.
  IMPORTACAO_PLANILHA_ARQUIVO_MAX_MB: z.coerce.number().int().min(1).max(100).default(40),
  IMPORTACAO_PLANILHA_DESCOMPACTADO_MAX_MB: z.coerce.number().int().min(1).max(1_000).default(320),
  IMPORTACAO_PLANILHA_LINHAS_MAX: z.coerce.number().int().min(1).max(50_000).default(10_000),
  IMPORTACAO_PLANILHA_TEMPO_MAX_S: z.coerce.number().int().min(1).max(300).default(120),
  BUSCA_EXPORTACAO_MAX_LINHAS: z.coerce.number().int().min(1).max(50_000).default(5_000),
  /** Ordenação inicial da lista de claims (proposta configurável). */
  CLAIMS_ORDEM_PADRAO: z.enum(['PRIORIDADE', 'PRAZO', 'VALOR', 'RECENTES']).default('PRIORIDADE'),
  /** Tamanho máximo de um anexo de claim (foto ou PDF), em MB. */
  CLAIMS_ANEXO_MAX_MB: z.coerce.number().int().min(1).max(20).default(5),
  /** Caminho-base público da instalação (ex.: /praca/); o proxy repassa o caminho completo. */
  CAMINHO_BASE: z.string().trim().min(1).optional(),
  /** Rascunho não enviado no armazenamento do navegador (sessionStorage); sempre desativado em produção. */
  PERSISTENCIA_LOCAL: z.enum(['ativada', 'desativada']).optional(),
  // Planilha automática e proteção (docs/IMPLANTACAO.md): trabalhador, destino independente, retenção e backup.
  PLANILHA_AUTOMATICA: z.enum(['ativada', 'desativada']).default('ativada'),
  /** "Seleção cliente — teste": desativada = rotas e permissões da funcionalidade somem (o restante segue igual). */
  SELECAO_CLIENTE_TESTE: z.enum(['ativada', 'desativada']).default('ativada'),
  /** Destino independente: "s3://<bucket>/<prefixo>" (PROTECAO_S3_*) ou "pasta:<compartilhamento de rede de outra máquina>". */
  PLANILHA_DESTINO: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1).optional()),
  PLANILHA_DESTINO_DESCRICAO: z.string().trim().min(3).max(200).optional(),
  PLANILHA_PASTA_LOCAL: z.string().trim().min(1).optional(),
  PLANILHA_INTERVALO_S: z.coerce.number().int().min(2).max(3_600).default(5),
  PLANILHA_AGRUPAR_S: z.coerce.number().int().min(0).max(3_600).default(10),
  PLANILHA_ESPERA_MAXIMA_S: z.coerce.number().int().min(10).max(3_600).default(60),
  PLANILHA_RECONCILIAR_MIN: z.coerce.number().int().min(5).max(1_440).default(60),
  PLANILHA_ALVO_S: z.coerce.number().int().min(5).max(3_600).default(30),
  PLANILHA_ATRASO_S: z.coerce.number().int().min(10).max(86_400).default(120),
  PLANILHA_VERSOES_MANTER: z.coerce.number().int().min(3).max(5_000).default(50),
  PLANILHA_DIARIAS_DIAS: z.coerce.number().int().min(0).max(3_650).default(30),
  PLANILHA_PRE_SUBSTITUICAO_DIAS: z.coerce.number().int().min(30).max(3_650).default(30),
  PLANILHA_MOVIMENTOS_POR_ARQUIVO: z.coerce.number().int().min(1_000).max(1_048_000).default(1_000_000),
  PLANILHA_CONCESSAO_MIN: z.coerce.number().int().min(1).max(120).default(10),
  /** Planilha e backup prévios obrigatórios antes de substituir o inventário ativo. */
  PLANILHA_PROTEGER_SUBSTITUICAO: z.enum(['ativada', 'desativada']).default('ativada'),
  // Armazenamento S3 compatível do destino independente (credenciais só aqui; nunca no front, no repositório ou no log).
  PROTECAO_S3_ENDPOINT: z.string().trim().min(1).optional(),
  PROTECAO_S3_REGIAO: z.string().trim().min(1).max(40).optional(),
  PROTECAO_S3_ESTILO: z.enum(['caminho', 'virtual']).optional(),
  PROTECAO_S3_CHAVE_ACESSO: z.string().trim().min(1).optional(),
  PROTECAO_S3_SEGREDO: z.string().trim().min(1).optional(),
  // Backup completo automático (rotina em scripts/recuperacao, chamada pelo trabalhador).
  BACKUP_AUTOMATICO: z.enum(['ativada', 'desativada']).default('ativada'),
  BACKUP_INTERVALO_HORAS: z.coerce.number().int().min(1).max(24 * 31).default(24),
  BACKUP_PRAZO_HORAS: z.coerce.number().int().min(1).max(24 * 31).default(26),
  /** Pasta local dos backups (mesmo servidor; origem do envio). */
  BACKUP_DESTINO: z.string().trim().min(1).optional(),
  /** Destino independente dos backups; padrão: o mesmo da planilha (chaves backups/…). */
  BACKUP_DESTINO_EXTERNO: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1).optional()),
  BACKUP_DESTINO_EXTERNO_DESCRICAO: z.string().trim().min(3).max(200).optional(),
  BACKUP_MANTER: z.coerce.number().int().min(2).max(1_000).default(14),
  BACKUP_DIARIOS_DIAS: z.coerce.number().int().min(0).max(3_650).default(30),
  BACKUP_PRE_SUBSTITUICAO_DIAS: z.coerce.number().int().min(30).max(3_650).default(30),
  BACKUP_RESPONSAVEL: z.string().trim().min(2).max(120).optional(),
  /** Variável com a URL do banco copiado (o valor nunca vai para argumento ou log). */
  BACKUP_VARIAVEL_BANCO: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default('DATABASE_URL'),
  RESTAURACAO_PRAZO_DIAS: z.coerce.number().int().min(1).max(730).default(35),
});

/** Vite em `npm run dev`: a interface fica nesta origem; a API, no proxy. */
const ORIGEM_VITE_DEV = 'http://127.0.0.1:5173';

/**
 * URL base das etiquetas: somente protocolo, host e porta (sem caminho,
 * consulta ou fragmento). Em produção é obrigatória; nos demais ambientes,
 * sem valor, usa o endereço local da própria instalação.
 */
export function lerUrlPublica(valor: string | undefined, contexto: { producao: boolean; semInterface: boolean; host: string; port: number }): string {
  if (valor === undefined) {
    if (contexto.producao) throw new Error('APP_URL_PUBLICA é obrigatória em produção (endereço das etiquetas QR).');
    if (contexto.semInterface) return ORIGEM_VITE_DEV;
    const host = ['0.0.0.0', '::'].includes(contexto.host) ? '127.0.0.1' : contexto.host;
    return `http://${host.includes(':') ? `[${host}]` : host}:${String(contexto.port)}`;
  }
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error('APP_URL_PUBLICA precisa ser uma URL http(s), por exemplo https://praca.exemplo.interno');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('APP_URL_PUBLICA precisa usar http ou https.');
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('APP_URL_PUBLICA deve conter apenas protocolo, host e porta (sem caminho, consulta ou credenciais).');
  }
  return url.origin;
}

/**
 * Caminho-base: "/" ou segmentos simples terminados em "/" (ex.: "/praca/").
 * Aceita sem a barra final; recusa "..", consulta, fragmento e barras duplas.
 */
export function lerCaminhoBase(valor: string | undefined): string {
  if (valor === undefined || valor === '/' || valor === '') return '/';
  const normalizado = valor.endsWith('/') ? valor : `${valor}/`;
  if (!/^\/(?:[A-Za-z0-9_~-][A-Za-z0-9._~-]*\/)+$/.test(normalizado) || normalizado.split('/').some((p) => p === '..' || p === '.')) {
    throw new Error('CAMINHO_BASE precisa ser "/" ou um caminho simples como /praca/ (letras, números, . _ ~ -).');
  }
  return normalizado;
}

/**
 * Política de rascunho no navegador. AGENTS.md proíbe dados reais da operação
 * em armazenamento acessível a scripts: em produção fica sempre desativada;
 * nos demais ambientes (dados fictícios) vem ativada, salvo configuração.
 */
export function lerPersistenciaLocal(valor: 'ativada' | 'desativada' | undefined, producao: boolean): boolean {
  if (producao) {
    if (valor === 'ativada') throw new Error('PERSISTENCIA_LOCAL=ativada não é permitida em produção (dados reais não ficam no navegador).');
    return false;
  }
  return valor !== 'desativada';
}

export type Ambiente = z.infer<typeof AmbienteSchema>['APP_AMBIENTE'];

export interface Configuracao {
  ambiente: Ambiente;
  host: string;
  port: number;
  logLevel: z.infer<typeof AmbienteSchema>['LOG_LEVEL'];
  databaseUrl: string;
  appSegredo: string;
  /** Cookie de sessão com Secure (exige HTTPS fora de localhost). */
  cookieSeguro: boolean;
  sessaoInatividadeMinutos: number;
  sessaoDuracaoMaximaHoras: number;
  /** Pasta do build da interface servido na mesma origem, ou `null` para não servir. */
  interfaceDir: string | null;
  /** Origem usada nos links das etiquetas (APP_URL_PUBLICA). */
  urlPublica: string;
  /** Caminho-base público (CAMINHO_BASE), terminado em "/". */
  caminhoBase: string;
  /** Rascunho não enviado no sessionStorage do navegador (PERSISTENCIA_LOCAL). */
  persistenciaLocal: boolean;
  versao: string;
  limitesImportacao: LimitesImportacao;
  /** Inventário conferido e seleção do cliente (planilhas operacionais). */
  limitesImportacaoPlanilha: LimitesImportacao;
  exportacaoMaxLinhas: number;
  claims: ConfigClaims;
  planilha: ConfigPlanilha;
  /** "Seleção cliente — teste" ligada na instalação (acesso continua só por concessão explícita). */
  selecaoClienteTeste: boolean;
}

export interface ConfigClaims {
  ordemPadrao: 'PRIORIDADE' | 'PRAZO' | 'VALOR' | 'RECENTES';
  anexoMaxBytes: number;
}

let versaoEmbutida: string | null = null;

/** Hospedagem empacotada: a versão vem do package.json importado no build da função. */
export function definirVersaoEmbutida(versao: string): void {
  versaoEmbutida = versao;
}

export function lerVersao(): string {
  if (versaoEmbutida !== null) return versaoEmbutida;
  const pacote: unknown = JSON.parse(readFileSync(new URL('package.json', RAIZ_API), 'utf8'));
  return z.object({ version: z.string().min(1) }).parse(pacote).version;
}

/** Carrega o .env da raiz do repositório, se existir (desenvolvimento local). */
export function carregarEnvLocal(): void {
  const arquivo = `${RAIZ_REPOSITORIO}.env`;
  if (existsSync(arquivo)) process.loadEnvFile(arquivo);
}

/**
 * Lê a configuração do ambiente. Em `npm run dev`, `--sem-interface` desliga o
 * build estático (o Vite serve a interface) e `--porta=N` fixa a porta que o
 * proxy do Vite espera, mesmo que o ambiente tenha uma variável PORT genérica.
 */
export function lerConfiguracao(env: NodeJS.ProcessEnv, argv: readonly string[]): Configuracao {
  const portaArgumento = argv.find((a) => a.startsWith('--porta='))?.slice('--porta='.length);
  const ambiente = AmbienteSchema.parse(portaArgumento === undefined ? env : { ...env, PORT: portaArgumento });
  if (ambiente.APP_AMBIENTE === 'producao' && ambiente.APP_SEGREDO.includes('TROQUE')) {
    throw new Error('APP_SEGREDO ainda contém o valor de exemplo.');
  }
  // WEB_DIST relativo vale a partir da raiz do repositório (o servidor estático exige caminho absoluto).
  const pastaInterface = ambiente.WEB_DIST === undefined ? INTERFACE_PADRAO : resolve(RAIZ_REPOSITORIO, ambiente.WEB_DIST);
  const semInterface = argv.includes('--sem-interface');
  const servirInterface = !semInterface && existsSync(`${pastaInterface}/index.html`);
  const urlPublica = lerUrlPublica(ambiente.APP_URL_PUBLICA, {
    producao: ambiente.APP_AMBIENTE === 'producao',
    semInterface,
    host: ambiente.HOST,
    port: ambiente.PORT,
  });
  return {
    ambiente: ambiente.APP_AMBIENTE,
    host: ambiente.HOST,
    port: ambiente.PORT,
    logLevel: ambiente.LOG_LEVEL,
    databaseUrl: ambiente.DATABASE_URL,
    appSegredo: ambiente.APP_SEGREDO,
    cookieSeguro: ambiente.COOKIE_SEGURO ?? ambiente.APP_AMBIENTE === 'producao',
    sessaoInatividadeMinutos: ambiente.SESSAO_INATIVIDADE_MINUTOS,
    sessaoDuracaoMaximaHoras: ambiente.SESSAO_DURACAO_MAXIMA_HORAS,
    interfaceDir: servirInterface ? pastaInterface : null,
    urlPublica,
    caminhoBase: lerCaminhoBase(ambiente.CAMINHO_BASE),
    persistenciaLocal: lerPersistenciaLocal(ambiente.PERSISTENCIA_LOCAL, ambiente.APP_AMBIENTE === 'producao'),
    versao: lerVersao(),
    limitesImportacao: {
      maxBytes: ambiente.IMPORTACAO_ARQUIVO_MAX_MB * 1_048_576,
      maxRows: ambiente.IMPORTACAO_LINHAS_MAX,
      maxColumns: ambiente.IMPORTACAO_COLUNAS_MAX,
      maxCellChars: ambiente.IMPORTACAO_CELULA_MAX_CARACTERES,
      maxUncompressedBytes: ambiente.IMPORTACAO_DESCOMPACTADO_MAX_MB * 1_048_576,
      maxZipEntries: ambiente.IMPORTACAO_ZIP_ENTRADAS_MAX,
      maxProcessingMs: ambiente.IMPORTACAO_TEMPO_MAX_S * 1_000,
    },
    limitesImportacaoPlanilha: {
      maxBytes: ambiente.IMPORTACAO_PLANILHA_ARQUIVO_MAX_MB * 1_048_576,
      maxRows: ambiente.IMPORTACAO_PLANILHA_LINHAS_MAX,
      maxColumns: ambiente.IMPORTACAO_COLUNAS_MAX,
      maxCellChars: ambiente.IMPORTACAO_CELULA_MAX_CARACTERES,
      maxUncompressedBytes: ambiente.IMPORTACAO_PLANILHA_DESCOMPACTADO_MAX_MB * 1_048_576,
      maxZipEntries: ambiente.IMPORTACAO_ZIP_ENTRADAS_MAX,
      maxProcessingMs: ambiente.IMPORTACAO_PLANILHA_TEMPO_MAX_S * 1_000,
    },
    exportacaoMaxLinhas: ambiente.BUSCA_EXPORTACAO_MAX_LINHAS,
    claims: { ordemPadrao: ambiente.CLAIMS_ORDEM_PADRAO, anexoMaxBytes: ambiente.CLAIMS_ANEXO_MAX_MB * 1_048_576 },
    planilha: lerConfigPlanilha(ambiente),
    selecaoClienteTeste: ambiente.SELECAO_CLIENTE_TESTE === 'ativada',
  };
}

/** Configuração da planilha e da proteção a partir do ambiente (comandos locais). */
export function lerConfigProtecao(env: NodeJS.ProcessEnv): ConfigPlanilha {
  return lerConfigPlanilha(AmbienteSchema.parse(env));
}

/**
 * Planilha automática e proteção: destino independente da planilha
 * (PLANILHA_DESTINO) e dos backups (BACKUP_DESTINO_EXTERNO, padrão: o mesmo),
 * tempos, retenção e backup. Sem destino, a planilha é gerada só no servidor e
 * aparece como "Não configurado"; pasta local não conta como independente.
 */
export function lerConfigPlanilha(a: z.infer<typeof AmbienteSchema>): ConfigPlanilha {
  const s3 = { endpoint: a.PROTECAO_S3_ENDPOINT, regiao: a.PROTECAO_S3_REGIAO, estilo: a.PROTECAO_S3_ESTILO, chaveAcesso: a.PROTECAO_S3_CHAVE_ACESSO, segredo: a.PROTECAO_S3_SEGREDO };
  const destino = a.PLANILHA_DESTINO === undefined ? null : criarDestino(a.PLANILHA_DESTINO, a.PLANILHA_DESTINO_DESCRICAO, s3);
  const destinoBackup = a.BACKUP_DESTINO_EXTERNO === undefined ? destino : criarDestino(a.BACKUP_DESTINO_EXTERNO, a.BACKUP_DESTINO_EXTERNO_DESCRICAO, s3);
  return {
    automatica: a.PLANILHA_AUTOMATICA === 'ativada',
    destino,
    pastaLocal: resolve(RAIZ_REPOSITORIO, a.PLANILHA_PASTA_LOCAL ?? '.dados/planilha'),
    intervaloMs: a.PLANILHA_INTERVALO_S * 1_000,
    agruparMs: a.PLANILHA_AGRUPAR_S * 1_000,
    esperaMaximaMs: a.PLANILHA_ESPERA_MAXIMA_S * 1_000,
    reconciliarMs: a.PLANILHA_RECONCILIAR_MIN * 60_000,
    concessaoMs: a.PLANILHA_CONCESSAO_MIN * 60_000,
    alvoMs: a.PLANILHA_ALVO_S * 1_000,
    atrasoMs: a.PLANILHA_ATRASO_S * 1_000,
    retencao: { ultimas: a.PLANILHA_VERSOES_MANTER, diariasDias: a.PLANILHA_DIARIAS_DIAS, preSubstituicaoDias: a.PLANILHA_PRE_SUBSTITUICAO_DIAS },
    movimentosPorArquivo: a.PLANILHA_MOVIMENTOS_POR_ARQUIVO,
    protegerSubstituicao: a.PLANILHA_PROTEGER_SUBSTITUICAO === 'ativada',
    backup: {
      automatico: a.BACKUP_AUTOMATICO === 'ativada',
      intervaloHoras: a.BACKUP_INTERVALO_HORAS,
      prazoHoras: a.BACKUP_PRAZO_HORAS,
      destino: destinoBackup,
      pastaLocal: resolve(RAIZ_REPOSITORIO, a.BACKUP_DESTINO ?? '.dados/backups'),
      variavelBanco: a.BACKUP_VARIAVEL_BANCO,
      manterLocal: a.BACKUP_MANTER,
      retencao: { ultimas: a.BACKUP_MANTER, diariasDias: a.BACKUP_DIARIOS_DIAS, preSubstituicaoDias: a.BACKUP_PRE_SUBSTITUICAO_DIAS },
      responsavel: a.BACKUP_RESPONSAVEL ?? null,
      restauracaoPrazoDias: a.RESTAURACAO_PRAZO_DIAS,
      raiz: RAIZ_REPOSITORIO,
    },
  };
}
