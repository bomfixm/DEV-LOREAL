/**
 * Configuração da planilha automática e da proteção dos dados (26 out. 2026).
 *
 * Destino independente (PLANILHA_DESTINO; o do backup completo é o mesmo, sob
 * "backups/", salvo BACKUP_DESTINO_EXTERNO):
 * - `s3://<bucket>/<prefixo>` — armazenamento S3 compatível; endereço e
 *   credenciais em PROTECAO_S3_* (credenciais só na configuração do servidor);
 * - `pasta:<caminho>` — compartilhamento de rede de outra máquina
 *   (\\servidor\pasta). Pasta no disco deste servidor, inclusive a
 *   sincronizada pelo OneDrive, é aceita mas NÃO conta como independente
 *   (a subida para a nuvem não é comprovável pelo aplicativo).
 */
import { hostname } from 'node:os';
import { isAbsolute } from 'node:path';
import { DestinoPasta, DestinoS3, type Destino } from './destino.js';

export interface Retencao {
  /** Últimas versões válidas mantidas sempre. */
  ultimas: number;
  /** Uma versão por dia (a última do dia) durante estes dias. */
  diariasDias: number;
  /** Versões anteriores a uma substituição do inventário: no mínimo estes dias. */
  preSubstituicaoDias: number;
}

export interface ConfigBackup {
  /** Backup diário pelo trabalhador (o anterior à substituição do inventário independe disto). */
  automatico: boolean;
  intervaloHoras: number;
  /** Prazo para considerar o último backup externo atrasado. */
  prazoHoras: number;
  /** Destino independente dos backups; `null` = não configurado. */
  destino: Destino | null;
  /** Pasta local dos backups (mesmo servidor; origem do envio). */
  pastaLocal: string;
  /** Variável de ambiente com a URL do banco copiado (o valor nunca aparece em argumento ou log). */
  variavelBanco: string;
  /** Backups verificados mantidos na pasta local (os anteriores a substituições ficam pela retenção própria). */
  manterLocal: number;
  retencao: Retencao;
  responsavel: string | null;
  /** Teste de restauração com dados reais mais antigo que isto fica "Atrasada". */
  restauracaoPrazoDias: number;
  /** Raiz do repositório (scripts de backup e restauração). */
  raiz: string;
}

export interface ConfigPlanilha {
  /** Trabalhador ligado neste processo (fila e concessão no banco). */
  automatica: boolean;
  /** Destino independente da planilha; `null` = não configurado (só geração local). */
  destino: Destino | null;
  /** Pasta da geração local, por escopo (no servidor; não conta como cópia independente). */
  pastaLocal: string;
  /** Intervalo do trabalhador. */
  intervaloMs: number;
  /** Quietude depois da última alteração antes de gerar (agrupa alterações próximas). */
  agruparMs: number;
  /** Com alterações contínuas, gera mesmo assim depois desta espera. */
  esperaMaximaMs: number;
  /** Conferência periódica do arquivo local (refaz se faltar ou não conferir). */
  reconciliarMs: number;
  concessaoMs: number;
  /** Alvo de publicação depois de uma alteração comum (não é garantia). */
  alvoMs: number;
  /** Alteração aguardando além disto aparece como "Atrasada". */
  atrasoMs: number;
  retencao: Retencao;
  /** Linhas de Movimentações por arquivo; além disso, arquivos de apoio (limite real do Excel: 1.048.576 linhas). */
  movimentosPorArquivo: number;
  /** Gerar a planilha e o backup ANTES de substituir o inventário ativo. */
  protegerSubstituicao: boolean;
  backup: ConfigBackup;
}

/** Sem configuração: geração local só por pedido, sem destino independente nem backup automático. */
export const PLANILHA_PADRAO: ConfigPlanilha = {
  automatica: false,
  destino: null,
  pastaLocal: '.dados/planilha',
  intervaloMs: 5_000,
  agruparMs: 10_000,
  esperaMaximaMs: 60_000,
  reconciliarMs: 3_600_000,
  concessaoMs: 600_000,
  alvoMs: 30_000,
  atrasoMs: 120_000,
  retencao: { ultimas: 50, diariasDias: 30, preSubstituicaoDias: 30 },
  movimentosPorArquivo: 1_000_000,
  protegerSubstituicao: false,
  backup: {
    automatico: false,
    intervaloHoras: 24,
    prazoHoras: 26,
    destino: null,
    pastaLocal: '.dados/backups',
    variavelBanco: 'DATABASE_URL',
    manterLocal: 14,
    retencao: { ultimas: 14, diariasDias: 30, preSubstituicaoDias: 30 },
    responsavel: null,
    restauracaoPrazoDias: 35,
    raiz: '.',
  },
};

const LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '.', '?']);
const ehLocal = (host: string) => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return LOCAIS.has(h) || h.startsWith('127.') || h === hostname().toLowerCase() || h.split('.')[0] === hostname().toLowerCase();
};

export const MOTIVO_PASTA_LOCAL =
  'Pasta no disco deste servidor (inclusive pasta sincronizada pelo OneDrive/SharePoint): a cópia fora do servidor não é comprovável pelo aplicativo.';

/** Pasta de destino: só compartilhamento de rede de outra máquina conta como independente. */
export function classificarPasta(caminho: string): { independente: boolean; motivo: string | null; descricao: string } {
  const unc = /^(?:\\\\|\/\/)([^\\/]+)[\\/]+([^\\/]+)/.exec(caminho);
  if (!unc?.[1] || !unc[2]) return { independente: false, motivo: MOTIVO_PASTA_LOCAL, descricao: 'Pasta no disco do servidor' };
  if (ehLocal(unc[1])) return { independente: false, motivo: 'Compartilhamento deste mesmo servidor: não protege contra a perda do servidor.', descricao: `Compartilhamento local \\\\${unc[1]}\\${unc[2]}` };
  return { independente: true, motivo: null, descricao: `Compartilhamento de rede \\\\${unc[1]}\\${unc[2]}` };
}

export interface CredenciaisS3 {
  endpoint?: string | undefined;
  regiao?: string | undefined;
  estilo?: string | undefined;
  chaveAcesso?: string | undefined;
  segredo?: string | undefined;
}

/**
 * Destino a partir da especificação (`s3://bucket/prefixo` ou `pasta:<caminho>`).
 * Planilha e backups usam chaves próprias (planilha/…, backups/…) no mesmo
 * destino. Erro de configuração interrompe a partida com mensagem sem segredo.
 */
export function criarDestino(espec: string, descricao: string | undefined, credenciais: CredenciaisS3): Destino {
  const s3 = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.*))?$/i.exec(espec.trim());
  if (s3?.[1]) {
    const { endpoint, chaveAcesso, segredo } = credenciais;
    if (!endpoint || !chaveAcesso || !segredo) throw new Error('Destino s3:// exige PROTECAO_S3_ENDPOINT, PROTECAO_S3_CHAVE_ACESSO e PROTECAO_S3_SEGREDO na configuração do servidor.');
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('PROTECAO_S3_ENDPOINT precisa ser uma URL (ex.: https://s3.sa-east-1.amazonaws.com).');
    }
    const local = ehLocal(url.hostname);
    if (url.protocol !== 'https:' && !local) throw new Error('PROTECAO_S3_ENDPOINT precisa usar https.');
    if (url.username || url.password || url.search) throw new Error('PROTECAO_S3_ENDPOINT não pode conter credencial nem parâmetros.');
    const prefixo = (s3[2] ?? '').replace(/^\/+|\/+$/g, '');
    const estilo = (credenciais.estilo ?? 'caminho').toLowerCase() === 'virtual' ? 'VIRTUAL' : 'CAMINHO';
    return new DestinoS3(
      { endpoint: url.origin, regiao: credenciais.regiao ?? 'us-east-1', bucket: s3[1], prefixo, estilo, chaveAcesso, segredo },
      descricao ?? `Armazenamento S3 compatível · ${url.hostname} · ${s3[1]}${prefixo === '' ? '' : `/${prefixo}`}`,
      !local,
      local ? 'Serviço S3 neste mesmo servidor: não protege contra a perda do servidor.' : null,
    );
  }
  const pasta = /^pasta:(.+)$/i.exec(espec.trim());
  const caminho = pasta?.[1]?.trim() ?? '';
  if (!pasta || !(isAbsolute(caminho) || /^(\\\\|\/\/)/.test(caminho))) throw new Error('O destino precisa ser "s3://<bucket>/<prefixo>" ou "pasta:<caminho absoluto>" (compartilhamento de rede de outra máquina).');
  const c = classificarPasta(caminho);
  return new DestinoPasta(caminho, descricao ?? c.descricao, c.independente, c.motivo);
}
