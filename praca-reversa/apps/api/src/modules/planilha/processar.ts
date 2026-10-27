/**
 * Trabalho da planilha de um escopo numa concessão: gerar a revisão devida,
 * conferir a cópia local e o destino (reconciliação) e enviar a revisão mais
 * recente ao destino independente. Chamado pelo trabalhador (alterações
 * agrupadas), por "Tentar novamente agora" e antes de uma substituição do
 * inventário. Concessão ocupada = OCUPADO (nada é feito em paralelo).
 */
import { join } from 'node:path';
import type { Banco } from '../../db/cliente.js';
import type { ConfigPlanilha } from '../protecao/configuracao.js';
import { lerConferido, pastaVersoes } from './arquivos.js';
import { enviar, reconciliarDestino, type ResultadoEnvio } from './envio.js';
import { gerar, liberar, reivindicar, type MotivoGeracao, type ResultadoGeracao, type Simulacao } from './geracao.js';

export type ResultadoProcesso =
  | { situacao: 'OCUPADO' }
  | { situacao: 'CONCLUIDO'; geracao: ResultadoGeracao | null; envio: ResultadoEnvio | null; reconciliado: boolean; esperando: boolean };

export interface OpcoesProcesso {
  /** SE_DEVIDO = há alteração aguardando, nenhuma revisão ainda ou cópia local inválida; SEMPRE = gera mesmo sem alteração. */
  gerar: 'SE_DEVIDO' | 'SEMPRE' | 'NAO';
  motivo: MotivoGeracao;
  enviar: boolean;
  reconciliar?: boolean;
  /** Ignora a espera crescente depois de falhas ("Tentar novamente agora"). */
  ignorarEspera?: boolean;
  solicitadoPorId?: string | null;
  agora?: () => Date;
  simular?: Simulacao;
}

/** A cópia local da revisão mais recente existe e confere? */
async function copiaLocalValida(db: Banco, escopoId: string, config: ConfigPlanilha): Promise<boolean> {
  const g = await db.geracaoPlanilha.findFirst({ where: { escopoId, situacao: 'GERADA' }, orderBy: { revisao: 'desc' }, select: { arquivos: true } });
  if (g === null) return false;
  const arquivos = (Array.isArray(g.arquivos) ? g.arquivos : []) as unknown as { nome: string; sha256: string }[];
  try {
    return arquivos.length > 0 && arquivos.every((a) => lerConferido(join(pastaVersoes(config, escopoId), a.nome), a.sha256) !== null);
  } catch {
    return false;
  }
}

export async function processarEscopo(db: Banco, escopoId: string, config: ConfigPlanilha, o: OpcoesProcesso): Promise<ResultadoProcesso> {
  const agora = o.agora ?? (() => new Date());
  const concessao = await reivindicar(db, escopoId, config.concessaoMs, agora());
  if (concessao === null) return { situacao: 'OCUPADO' };
  try {
    const controle = await db.controlePlanilha.findUniqueOrThrow({ where: { escopoId } });
    let esperando = false;
    let geracao: ResultadoGeracao | null = null;
    let motivo = o.motivo;
    let devido = o.gerar === 'SEMPRE';
    if (o.gerar === 'SE_DEVIDO') {
      const [p] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM alteracao_planilha WHERE escopo_id = ${escopoId}::uuid`;
      devido = (p?.n ?? 0) > 0 || !(await copiaLocalValida(db, escopoId, config));
      if (devido && (p?.n ?? 0) === 0 && motivo === 'ALTERACAO') motivo = 'RECONCILIACAO';
    }
    if (devido) {
      if (!o.ignorarEspera && controle.proximaTentativaEm !== null && controle.proximaTentativaEm > agora()) esperando = true;
      else geracao = await gerar(db, escopoId, config, concessao, { motivo, solicitadoPorId: o.solicitadoPorId ?? null, agora, ...(o.simular ? { simular: o.simular } : {}) });
    }
    let reconciliado = false;
    if (o.reconciliar && geracao?.situacao !== 'FALHOU') reconciliado = await reconciliarDestino(db, escopoId, config, concessao).catch(() => false);
    let envio: ResultadoEnvio | null = null;
    if (o.enviar && geracao?.situacao !== 'FALHOU') {
      if (!o.ignorarEspera && controle.envioProximaEm !== null && controle.envioProximaEm > agora()) esperando = true;
      else envio = await enviar(db, escopoId, config, concessao, { agora, ...(o.simular ? { simular: o.simular } : {}) });
    }
    return { situacao: 'CONCLUIDO', geracao, envio, reconciliado, esperando };
  } finally {
    await liberar(db, escopoId, concessao.token);
  }
}

export interface EscopoDevido {
  escopoId: string;
  gerar: boolean;
  enviar: boolean;
}

/**
 * Escopos com trabalho devido agora: alterações agrupadas (quietude de
 * `agruparMs` ou espera máxima), nenhuma revisão gerada, ou revisão gerada
 * ainda não confirmada no destino — respeitando a espera depois de falhas.
 * Escopos de demonstração só por pedido manual.
 */
export async function escoposDevidos(db: Banco, config: ConfigPlanilha, agora: Date): Promise<EscopoDevido[]> {
  const linhas = await db.$queryRaw<
    { escopo_id: string; pendentes: number; desde: Date | null; ultima: Date | null; proxima: Date | null; envio_proxima: Date | null; publicada: number | null; gerada: number | null }[]
  >`
    SELECT e.id::text AS escopo_id,
           (SELECT count(*)::int FROM alteracao_planilha a WHERE a.escopo_id = e.id) AS pendentes,
           (SELECT min(a.criado_em) FROM alteracao_planilha a WHERE a.escopo_id = e.id) AS desde,
           (SELECT max(a.criado_em) FROM alteracao_planilha a WHERE a.escopo_id = e.id) AS ultima,
           c.proxima_tentativa_em AS proxima, c.envio_proxima_em AS envio_proxima, c.revisao_publicada AS publicada,
           (SELECT max(g.revisao) FROM geracao_planilha g WHERE g.escopo_id = e.id AND g.situacao = 'GERADA') AS gerada
      FROM escopo e LEFT JOIN controle_planilha c ON c.escopo_id = e.id
     WHERE e.ativo AND NOT e.demonstracao
     ORDER BY e.id`;
  const destino = config.destino?.independente === true;
  return linhas
    .map((l) => {
      const agrupadas = l.pendentes > 0 && ((l.ultima !== null && agora.getTime() - l.ultima.getTime() >= config.agruparMs) || (l.desde !== null && agora.getTime() - l.desde.getTime() >= config.esperaMaximaMs));
      const gerar = (agrupadas || l.gerada === null) && (l.proxima === null || l.proxima <= agora);
      const enviar = destino && (gerar || (l.gerada !== null && l.gerada > (l.publicada ?? 0))) && (l.envio_proxima === null || l.envio_proxima <= agora);
      return { escopoId: l.escopo_id, gerar, enviar };
    })
    .filter((x) => x.gerar || x.enviar);
}
