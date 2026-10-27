/**
 * Planilha e proteção no aplicativo (26 out. 2026), sempre do escopo ativo:
 * - situação (perfis internos com praca.consultar; o cliente não tem);
 * - "Tentar novamente agora" (planilha.publicar): reprocessa de verdade a
 *   geração devida, a conferência da cópia local e do destino, o envio e o
 *   backup pendente, ignorando a espera depois de falhas;
 * - download da última revisão gerada e das anteriores ainda preservadas
 *   (planilha.baixar): arquivo relido e conferido pelo SHA-256 registrado,
 *   com revisão e situação da publicação nos cabeçalhos; auditado.
 * Backup completo nunca é servido pelo aplicativo (só no destino, com acesso
 * próprio dos administradores).
 */
import { API_PREFIXO, type FalhaProtecao, type ItemProtecao, type RevisaoPlanilha, type SituacaoPlanilha } from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Banco } from '../../db/cliente.js';
import { naoEncontrado } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { processarBackups } from '../protecao/backup.js';
import type { ConfigPlanilha } from '../protecao/configuracao.js';
import { TIPO_XLSX, lerConferido, pastaVersoes } from './arquivos.js';
import { nomeArquivoPlanilha } from './montar.js';
import { processarEscopo } from './processar.js';
import { estadoBackup, estadoDestino, estadoGeracao, estadoPublicacao, estadoRestauracao, estadoVersaoAnterior, type ItemSituacao } from './situacao.js';

const item = (x: ItemSituacao): ItemProtecao => ({ resource: x.recurso, state: x.estado, lastSuccess: x.ultimoSucesso?.toISOString() ?? null, detail: x.detalhe });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

interface GeracaoLinha {
  revisao: number | null;
  motivo: string;
  concluidoEm: Date | null;
  instanteDados: Date | null;
  ultimaAlteracaoEm: Date | null;
  alteracoesIncluidas: number;
  loteAtivo: string | null;
  preSubstituicao: boolean;
  tamanhoBytes: number | null;
  arquivos: unknown;
  registros: unknown;
}

const arquivosDe = (g: GeracaoLinha) => (Array.isArray(g.arquivos) ? (g.arquivos as { papel: string; nome: string; sha256: string; tamanho: number }[]) : []);

function revisaoContrato(g: GeracaoLinha, publicadaEm: Date | null, baixavel: boolean): RevisaoPlanilha {
  return {
    revision: g.revisao ?? 0,
    reason: g.motivo as RevisaoPlanilha['reason'],
    generatedAt: iso(g.concluidoEm) ?? '',
    dataAt: iso(g.instanteDados) ?? '',
    lastChangeAt: iso(g.ultimaAlteracaoEm),
    changes: g.alteracoesIncluidas,
    activeBatch: g.loteAtivo,
    preReplacement: g.preSubstituicao,
    sizeBytes: g.tamanhoBytes ?? 1,
    files: Math.max(1, arquivosDe(g).length),
    records: typeof g.registros === 'object' && g.registros !== null ? (g.registros as Record<string, number>) : {},
    publishedAt: iso(publicadaEm),
    downloadable: baixavel,
  };
}

/** Situação viva da planilha e da proteção do escopo. */
export async function lerSituacao(db: Banco, escopoId: string, config: ConfigPlanilha, permissoes: ReadonlySet<string>, agora: Date): Promise<SituacaoPlanilha> {
  const escopo = await db.escopo.findUniqueOrThrow({ where: { id: escopoId }, select: { demonstracao: true, unidade: { select: { codigo: true } }, cliente: { select: { codigo: true } } } });
  const demo = escopo.demonstracao;
  const [pend] = await db.$queryRaw<{ n: number; desde: Date | null; ultima: Date | null }[]>`
    SELECT count(*)::int AS n, min(criado_em) AS desde, max(criado_em) AS ultima FROM alteracao_planilha WHERE escopo_id = ${escopoId}::uuid`;
  const c = await db.controlePlanilha.findUnique({ where: { escopoId } });
  const controle = {
    revisaoDados: c?.revisaoDados ?? 0,
    revisaoPublicada: c?.revisaoPublicada ?? 0,
    falhasSeguidas: c?.falhasSeguidas ?? 0,
    ultimaFalha: c?.ultimaFalha ?? null,
    ultimaFalhaEm: c?.ultimaFalhaEm ?? null,
    envioFalhas: c?.envioFalhas ?? 0,
    envioUltimaFalha: c?.envioUltimaFalha ?? null,
    envioUltimaFalhaEm: c?.envioUltimaFalhaEm ?? null,
    publicandoDesde: c?.publicandoDesde ?? null,
  };
  const geradas = (await db.geracaoPlanilha.findMany({ where: { escopoId, situacao: 'GERADA' }, orderBy: { revisao: 'desc' }, take: 15 })) as GeracaoLinha[];
  const envios = await db.envioExterno.findMany({ where: { tipo: 'PLANILHA', escopoId, situacao: 'CONFIRMADO' }, orderBy: { concluidoEm: 'desc' }, take: 30, select: { referencia: true, concluidoEm: true, chave: true, destino: true } });
  const publicadaEm = new Map(envios.map((e) => [Number(e.referencia), e.concluidoEm]));
  const resumoEnvio = (e: (typeof envios)[number] | undefined) => (e?.concluidoEm ? { referencia: e.referencia, concluidoEm: e.concluidoEm, chave: e.chave, destino: e.destino } : null);
  const pendentes = { quantidade: pend?.n ?? 0, desde: pend?.desde ?? null };
  const ultima = geradas[0];
  const ultimaLida = ultima?.revisao != null && ultima.concluidoEm && ultima.instanteDados ? { revisao: ultima.revisao, concluidoEm: ultima.concluidoEm, instanteDados: ultima.instanteDados } : null;
  const backupLocal = await db.registroProtecao.findFirst({ where: { tipo: 'BACKUP', situacao: 'VERIFICADO' }, orderBy: { concluidoEm: 'desc' } });
  const backupExterno = await db.envioExterno.findFirst({ where: { tipo: 'BACKUP', situacao: 'CONFIRMADO' }, orderBy: { concluidoEm: 'desc' } });
  const teste = await db.registroProtecao.findFirst({ where: { tipo: 'TESTE_RESTAURACAO' }, orderBy: { concluidoEm: 'desc' } });
  const ctrlBackup = await db.controleProtecao.findUnique({ where: { chave: 'BACKUP' } });
  const falhaDestino = await db.envioExterno.findFirst({ where: { situacao: 'FALHOU', OR: [{ escopoId }, { tipo: 'BACKUP' }] }, orderBy: { concluidoEm: 'desc' }, select: { concluidoEm: true, erro: true } });
  const ultimoEnvio = await db.envioExterno.findFirst({ where: { situacao: 'CONFIRMADO', OR: [{ escopoId }, { tipo: 'BACKUP' }] }, orderBy: { concluidoEm: 'desc' }, select: { referencia: true, concluidoEm: true, chave: true, destino: true } });
  const resumoProt = (x: typeof backupLocal) =>
    x === null
      ? null
      : { tipo: x.tipo, situacao: x.situacao, concluidoEm: x.concluidoEm, identificador: x.identificador, tamanhoBytes: x.tamanhoBytes, destino: x.destino, foraDoServidor: x.foraDoServidor, ambiente: x.ambiente, dados: x.dados, mensagem: x.mensagem, detalhes: typeof x.detalhes === 'object' && x.detalhes !== null ? (x.detalhes as Record<string, unknown>) : null };
  const efetiva: ConfigPlanilha = demo ? { ...config, destino: null } : config;
  const items = [
    estadoDestino(config, demo, resumoEnvio(ultimoEnvio ?? undefined), { em: falhaDestino?.concluidoEm ?? null, mensagem: falhaDestino?.erro ?? null }),
    estadoGeracao(config, demo, controle, pendentes, ultimaLida, agora),
    estadoPublicacao(config, demo, controle, pendentes, ultimaLida, resumoEnvio(envios[0]), agora),
    estadoVersaoAnterior(efetiva, demo, resumoEnvio(envios[1])),
    estadoBackup(config, resumoProt(backupLocal), backupExterno?.concluidoEm ? { referencia: backupExterno.referencia, concluidoEm: backupExterno.concluidoEm, chave: backupExterno.chave, destino: backupExterno.destino } : null, { executandoDesde: ctrlBackup?.executandoDesde ?? null, falhas: ctrlBackup?.falhas ?? 0, ultimaFalha: ctrlBackup?.ultimaFalha ?? null, ultimaFalhaEm: ctrlBackup?.ultimaFalhaEm ?? null }, agora),
    estadoRestauracao(config, resumoProt(teste), agora),
  ].map(item);
  // Lista: existência e tamanho (o download confere o SHA-256 antes de entregar).
  const baixavel = (g: GeracaoLinha) =>
    arquivosDe(g).length > 0 &&
    arquivosDe(g).every((a) => {
      const caminho = join(pastaVersoes(config, escopoId), a.nome);
      return existsSync(caminho) && statSync(caminho).size === a.tamanho;
    });
  const versions = geradas.map((g) => revisaoContrato(g, publicadaEm.get(g.revisao ?? -1) ?? null, baixavel(g)));
  const falhas = await db.$queryRaw<{ em: Date; etapa: string; erro: string }[]>`
    (SELECT concluido_em AS em, 'GERACAO' AS etapa, erro FROM geracao_planilha WHERE escopo_id = ${escopoId}::uuid AND situacao = 'FALHOU' ORDER BY concluido_em DESC LIMIT 5)
    UNION ALL
    (SELECT concluido_em, CASE tipo WHEN 'BACKUP' THEN 'BACKUP' ELSE 'ENVIO' END, erro FROM envio_externo WHERE situacao = 'FALHOU' AND (escopo_id = ${escopoId}::uuid OR tipo = 'BACKUP') ORDER BY concluido_em DESC LIMIT 5)
    UNION ALL
    (SELECT ultima_falha_em, 'BACKUP', ultima_falha FROM controle_protecao WHERE ultima_falha IS NOT NULL)
    ORDER BY em DESC LIMIT 8`;
  const ultimaPublicada = envios[0];
  return {
    fileName: nomeArquivoPlanilha(escopo.unidade.codigo, escopo.cliente.codigo),
    automatic: config.automatica,
    demo,
    timezone: 'America/Sao_Paulo',
    targetSeconds: Math.round(config.alvoMs / 1_000),
    delayLimitSeconds: Math.round(config.atrasoMs / 1_000),
    destination: {
      configured: !demo && config.destino !== null,
      independent: !demo && config.destino?.independente === true,
      type: demo ? null : (config.destino?.tipo ?? null),
      description: demo ? null : (config.destino?.descricao ?? null),
      reason: demo ? 'Escopo de demonstração: dados fictícios nunca vão para o destino da operação.' : (config.destino?.motivo ?? null),
    },
    lastChange:
      pendentes.quantidade > 0
        ? { at: iso(pend?.ultima), revision: controle.revisaoDados + 1, pending: true }
        : { at: iso(ultima?.ultimaAlteracaoEm), revision: ultima?.revisao ?? null, pending: false },
    pending: { count: pendentes.quantidade, since: iso(pendentes.desde), delaySeconds: pendentes.desde === null ? null : Math.max(0, Math.round((agora.getTime() - pendentes.desde.getTime()) / 1_000)) },
    working: controle.publicandoDesde !== null,
    revisions: { generated: ultima?.revisao ?? null, published: controle.revisaoPublicada > 0 ? controle.revisaoPublicada : null, publishedAt: iso(ultimaPublicada?.concluidoEm) },
    items,
    latest: versions[0] ?? null,
    versions,
    failures: falhas.map((f): FalhaProtecao => ({ at: f.em.toISOString(), stage: f.etapa as FalhaProtecao['stage'], message: f.erro })),
    canPublish: permissoes.has('planilha.publicar'),
    canDownload: permissoes.has('planilha.baixar') && (versions[0]?.downloadable ?? false),
    consultedAt: agora.toISOString(),
  };
}

const RevisaoSchema = z.object({ revisao: z.coerce.number().int().positive() });

export function registrarRotasPlanilha(app: FastifyInstance, deps: Dependencias, auth: Autenticacao, config: ConfigPlanilha): void {
  app.get(`${API_PREFIXO}/planilha/situacao`, { preHandler: auth.exigirPermissao('praca.consultar') }, async (request) => {
    const contexto = contextoDe(request);
    return lerSituacao(deps.db, escopoAtivoDe(request).id, config, contexto.permissoes, deps.agora());
  });

  app.post(`${API_PREFIXO}/planilha/publicar`, { preHandler: auth.exigirPermissao('planilha.publicar') }, async (request) => {
    const contexto = contextoDe(request);
    const escopo = escopoAtivoDe(request);
    await registrarEvento(deps.db, { acao: 'PLANILHA_PUBLICACAO_SOLICITADA', resultado: 'SUCESSO', atorUsuarioId: contexto.sessao.usuario.id, escopoId: escopo.id, alvoTipo: 'PLANILHA', alvoId: escopo.id, requestId: request.id });
    const r = await processarEscopo(deps.db, escopo.id, config, { gerar: 'SE_DEVIDO', motivo: 'MANUAL', enviar: true, reconciliar: true, ignorarEspera: true, solicitadoPorId: contexto.sessao.usuario.id, agora: deps.agora });
    // Backup devido ou envio pendente também é reprocessado (sem forçar um backup novo se o do dia já existe).
    if (!escopo.demo && config.backup.destino !== null) await processarBackups(deps.db, config, { agora: deps.agora, ignorarEspera: true }).catch(() => undefined);
    const situacao = await lerSituacao(deps.db, escopo.id, config, contexto.permissoes, deps.agora());
    if (r.situacao === 'OCUPADO') return { result: 'OCUPADO', revision: null, error: null, situation: situacao };
    const falha = r.geracao?.situacao === 'FALHOU' ? r.geracao : r.envio?.situacao === 'FALHOU' ? r.envio : null;
    const result = falha ? 'FALHOU' : r.envio?.situacao === 'PUBLICADA' ? 'PUBLICADA' : r.geracao?.situacao === 'GERADA' ? 'GERADA' : 'EM_DIA';
    return { result, revision: r.geracao?.revisao ?? r.envio?.revisao ?? situacao.revisions.generated, error: falha?.erro ?? null, situation: situacao };
  });

  const enviarArquivo = async (request: FastifyRequest, reply: FastifyReply, revisao: number | null) => {
    const contexto = contextoDe(request);
    const escopo = escopoAtivoDe(request);
    const g = await deps.db.geracaoPlanilha.findFirst({ where: { escopoId: escopo.id, situacao: 'GERADA', ...(revisao === null ? {} : { revisao }) }, orderBy: { revisao: 'desc' } });
    if (g?.revisao == null) throw naoEncontrado(revisao === null ? 'Nenhuma planilha gerada ainda para este escopo.' : 'Revisão não encontrada neste escopo.');
    const principal = (Array.isArray(g.arquivos) ? (g.arquivos as { papel: string; nome: string; sha256: string }[]) : []).find((a) => a.papel === 'PRINCIPAL');
    const conteudo = principal ? lerConferido(join(pastaVersoes(config, escopo.id), principal.nome), principal.sha256) : null;
    if (principal === undefined || conteudo === null) throw naoEncontrado(`A revisão ${String(g.revisao)} não está mais na pasta do servidor (retenção). Consulte o destino independente.`);
    const publicada = await deps.db.envioExterno.findFirst({ where: { tipo: 'PLANILHA', escopoId: escopo.id, referencia: String(g.revisao), situacao: 'CONFIRMADO' }, select: { concluidoEm: true } });
    await registrarEvento(deps.db, {
      acao: 'PLANILHA_ARQUIVO_BAIXADO',
      resultado: 'SUCESSO',
      atorUsuarioId: contexto.sessao.usuario.id,
      escopoId: escopo.id,
      alvoTipo: 'PLANILHA',
      alvoId: escopo.id,
      detalhes: { arquivo: principal.nome, revisao: g.revisao, bytes: conteudo.length, publicada: publicada !== null },
      requestId: request.id,
    });
    return reply
      .header('content-type', TIPO_XLSX)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('x-planilha-revisao', String(g.revisao))
      .header('x-planilha-dados-em', g.instanteDados?.toISOString() ?? '')
      .header('x-planilha-publicada', publicada?.concluidoEm ? publicada.concluidoEm.toISOString() : 'nao')
      .header('content-disposition', `attachment; filename="${principal.nome}"`)
      .send(conteudo);
  };

  app.get(`${API_PREFIXO}/planilha/arquivo`, { preHandler: auth.exigirPermissao('planilha.baixar') }, async (request, reply) => enviarArquivo(request, reply, null));
  app.get(`${API_PREFIXO}/planilha/revisoes/:revisao/arquivo`, { preHandler: auth.exigirPermissao('planilha.baixar') }, async (request, reply) => {
    const r = RevisaoSchema.safeParse(request.params);
    if (!r.success) throw naoEncontrado('Revisão inválida.');
    return enviarArquivo(request, reply, r.data.revisao);
  });
}
