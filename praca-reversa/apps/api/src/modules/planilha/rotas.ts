/**
 * Planilha única no aplicativo: situação (todos que consultam a praça),
 * "tentar novamente" (planilha.publicar) e download do último arquivo gerado
 * (relatorio.exportar), sempre do escopo ativo. A publicação não altera a
 * operação; a falha dela não desfaz nenhuma gravação.
 */
import { API_PREFIXO, type ItemProtecao, type SituacaoPlanilha, type VersaoPlanilha } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Banco } from '../../db/cliente.js';
import { naoEncontrado } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { nomeArquivoPlanilha } from './montar.js';
import { pastaLocalDoEscopo, publicarPlanilha } from './publicacao.js';
import { estadoBackup, estadoPublicacao, estadoRestauracao, type ConfigPlanilha, type ItemSituacao } from './situacao.js';

const DATA_BR = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

const item = (x: ItemSituacao): ItemProtecao => ({
  resource: x.recurso,
  state: x.estado,
  lastSuccess: x.ultimoSucesso?.toISOString() ?? null,
  detail: x.detalhe,
});

function versao(p: {
  versao: number;
  situacao: string;
  motivo: string;
  iniciadoEm: Date;
  concluidoEm: Date | null;
  instanteSnapshot: Date | null;
  tamanhoBytes: number | null;
  destino: string | null;
  identificacaoPublicacao: string | null;
  erro: string | null;
  registros: unknown;
}): VersaoPlanilha {
  return {
    version: p.versao,
    state: p.situacao as VersaoPlanilha['state'],
    reason: p.motivo as VersaoPlanilha['reason'],
    startedAt: p.iniciadoEm.toISOString(),
    finishedAt: p.concluidoEm?.toISOString() ?? null,
    snapshotAt: p.instanteSnapshot?.toISOString() ?? null,
    sizeBytes: p.tamanhoBytes,
    destination: p.destino as VersaoPlanilha['destination'],
    identification: p.identificacaoPublicacao,
    error: p.erro,
    records: typeof p.registros === 'object' && p.registros !== null ? (p.registros as Record<string, number>) : null,
  };
}

/** Situação viva da planilha e da proteção do escopo. */
export async function lerSituacao(db: Banco, escopoId: string, config: ConfigPlanilha, permissoes: ReadonlySet<string>, agora: Date): Promise<SituacaoPlanilha> {
  const escopo = await db.escopo.findUniqueOrThrow({ where: { id: escopoId }, select: { demonstracao: true, unidade: { select: { codigo: true } }, cliente: { select: { codigo: true } } } });
  const destino = escopo.demonstracao ? null : config.destino;
  const efetiva: ConfigPlanilha = { ...config, destino };
  const [pend] = await db.$queryRaw<{ n: number; desde: Date | null }[]>`SELECT count(*)::int AS n, min(criado_em) AS desde FROM alteracao_planilha WHERE escopo_id = ${escopoId}::uuid`;
  const controle = await db.controlePlanilha.findUnique({ where: { escopoId } });
  const recentes = await db.publicacaoPlanilha.findMany({ where: { escopoId }, orderBy: { versao: 'desc' }, take: 10 });
  const ultimaPublicada = await db.publicacaoPlanilha.findFirst({ where: { escopoId, situacao: 'PUBLICADA' }, orderBy: { versao: 'desc' } });
  const ultimaGerada = await db.publicacaoPlanilha.findFirst({ where: { escopoId, situacao: { in: ['PUBLICADA', 'GERADA_LOCAL'] } }, orderBy: { versao: 'desc' } });
  const prot = (tipo: string, situacao?: string) =>
    db.registroProtecao.findFirst({ where: { tipo, ...(situacao ? { situacao } : {}) }, orderBy: { concluidoEm: 'desc' } });
  const [backupOk, backup, teste] = await Promise.all([prot('BACKUP', 'VERIFICADO'), prot('BACKUP'), prot('TESTE_RESTAURACAO')]);
  const pendentes = pend?.n ?? 0;
  const desde = pend?.desde ?? null;
  const publicacao = estadoPublicacao(
    efetiva,
    {
      pendentes,
      desde,
      falhasSeguidas: controle?.falhasSeguidas ?? 0,
      ultimaFalha: controle?.ultimaFalha ?? null,
      ultimaFalhaEm: controle?.ultimaFalhaEm ?? null,
      ultimaPublicada: ultimaPublicada
        ? { versao: ultimaPublicada.versao, situacao: ultimaPublicada.situacao, concluidoEm: ultimaPublicada.concluidoEm, instanteSnapshot: ultimaPublicada.instanteSnapshot, identificacao: ultimaPublicada.identificacaoPublicacao, versaoAnterior: ultimaPublicada.versaoAnteriorPreservada, erro: null }
        : null,
      publicandoDesde: controle?.publicandoDesde ?? null,
    },
    agora,
  );
  const local: ItemSituacao = ultimaGerada
    ? { recurso: 'Geração local (servidor)', estado: ultimaGerada.situacao === 'PUBLICADA' || destino === null ? 'Atualizada' : 'Atualização pendente', ultimoSucesso: ultimaGerada.concluidoEm, detalhe: `Versão ${String(ultimaGerada.versao)} com os dados de ${ultimaGerada.instanteSnapshot ? DATA_BR.format(ultimaGerada.instanteSnapshot) : '?'} (cópia no servidor; não substitui o destino independente).` }
    : { recurso: 'Geração local (servidor)', estado: 'Atualização pendente', ultimoSucesso: null, detalhe: 'Nenhuma versão gerada ainda.' };
  const versaoAnterior: ItemSituacao =
    destino === null
      ? { recurso: 'Versão anterior preservada', estado: 'Não configurado', ultimoSucesso: null, detalhe: 'Sem destino independente não há pasta de versões anteriores fora do servidor.' }
      : ultimaPublicada?.versaoAnteriorPreservada
        ? { recurso: 'Versão anterior preservada', estado: 'Atualizada', ultimoSucesso: ultimaPublicada.concluidoEm, detalhe: `${ultimaPublicada.versaoAnteriorPreservada} (até ${String(config.versoesManter)} versões mantidas).` }
        : { recurso: 'Versão anterior preservada', estado: 'Atualização pendente', ultimoSucesso: null, detalhe: 'Ainda não há versão anterior publicada no destino.' };
  const resumo = (x: typeof backupOk) =>
    x === null ? null : { tipo: x.tipo, situacao: x.situacao, concluidoEm: x.concluidoEm, identificador: x.identificador, tamanhoBytes: x.tamanhoBytes, destino: x.destino, foraDoServidor: x.foraDoServidor, ambiente: x.ambiente, dados: x.dados, mensagem: x.mensagem };
  return {
    fileName: nomeArquivoPlanilha(escopo.unidade.codigo, escopo.cliente.codigo),
    automatic: config.automatica,
    destinationConfigured: destino !== null,
    destinationDescription: destino?.descricao ?? null,
    demo: escopo.demonstracao,
    pending: { count: pendentes, since: desde?.toISOString() ?? null, delaySeconds: desde === null ? null : Math.max(0, Math.round((agora.getTime() - desde.getTime()) / 1_000)) },
    publishing: controle?.publicandoDesde !== null && controle?.publicandoDesde !== undefined,
    items: [publicacao, local, versaoAnterior, estadoBackup(config, resumo(backupOk), resumo(backup), agora), estadoRestauracao(config, resumo(teste), agora)].map(item),
    lastGenerated: ultimaGerada ? versao(ultimaGerada) : null,
    recent: recentes.map(versao),
    canPublish: permissoes.has('planilha.publicar'),
    canDownload: permissoes.has('relatorio.exportar') && ultimaGerada !== null,
    consultedAt: agora.toISOString(),
  };
}

export function registrarRotasPlanilha(app: FastifyInstance, deps: Dependencias, auth: Autenticacao, config: ConfigPlanilha): void {
  app.get(`${API_PREFIXO}/planilha/situacao`, { preHandler: auth.exigirPermissao('praca.consultar') }, async (request) => {
    const contexto = contextoDe(request);
    return lerSituacao(deps.db, escopoAtivoDe(request).id, config, contexto.permissoes, deps.agora());
  });

  app.post(`${API_PREFIXO}/planilha/publicar`, { preHandler: auth.exigirPermissao('planilha.publicar') }, async (request) => {
    const contexto = contextoDe(request);
    const escopo = escopoAtivoDe(request);
    await registrarEvento(deps.db, {
      acao: 'PLANILHA_PUBLICACAO_SOLICITADA',
      resultado: 'SUCESSO',
      atorUsuarioId: contexto.sessao.usuario.id,
      escopoId: escopo.id,
      alvoTipo: 'PLANILHA',
      alvoId: escopo.id,
      requestId: request.id,
    });
    const r = await publicarPlanilha(deps.db, escopo.id, config, { motivo: 'MANUAL', solicitadoPorId: contexto.sessao.usuario.id, agora: deps.agora });
    return { result: r.situacao, version: r.versao, error: r.erro, situation: await lerSituacao(deps.db, escopo.id, config, contexto.permissoes, deps.agora()) };
  });

  app.get(`${API_PREFIXO}/planilha/arquivo`, { preHandler: auth.exigirPermissao('relatorio.exportar') }, async (request, reply) => {
    const contexto = contextoDe(request);
    const escopo = escopoAtivoDe(request);
    const nome = nomeArquivoPlanilha(escopo.unitCode, escopo.clientCode);
    const caminho = join(pastaLocalDoEscopo(config, escopo.id), nome);
    if (!existsSync(caminho)) throw naoEncontrado('Nenhuma planilha gerada ainda para este escopo.');
    const conteudo = readFileSync(caminho);
    await registrarEvento(deps.db, {
      acao: 'PLANILHA_ARQUIVO_BAIXADO',
      resultado: 'SUCESSO',
      atorUsuarioId: contexto.sessao.usuario.id,
      escopoId: escopo.id,
      alvoTipo: 'PLANILHA',
      alvoId: escopo.id,
      detalhes: { arquivo: nome, bytes: conteudo.length },
      requestId: request.id,
    });
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `attachment; filename="${nome}"`)
      .send(conteudo);
  });
}
