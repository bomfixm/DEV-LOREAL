/**
 * Conferência de volumes em tabela (21 out. 2026): o palete inteiro numa
 * operação, sem um formulário por nota.
 *
 * - COMPLETA: exige a declaração de conferência física e todas as ocorrências
 *   ativas; renova o prazo de 20 dias (autor autenticado, horário do servidor).
 * - PARCIAL: só as linhas verificadas; não marca o palete como conferido nem
 *   renova o prazo.
 * - Valor contado diferente do atual grava a contagem (nova quantidade atual,
 *   anterior e diferença guardados); igual ao atual só registra a abrangência.
 *   Zero é resultado (quantidade atual 0), nunca "vazio".
 * - O conjunto exibido (assinatura) é conferido com o palete travado: se algo
 *   entrou, saiu ou foi recontado nesse meio, nada é gravado e a tela pede revisão.
 */
import type { Escopo, RegistrarConferenciaVolumesSchema, ResultadoConferenciaVolumes } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { registrarReconferenciaCompleta, relogioDoPalete } from '../paletes/relogio.js';
import { assinaturaConjunto, calcularConferencia, ocorrenciasAtivas } from './estado.js';

type Dados = z.output<typeof RegistrarConferenciaVolumesSchema>;

export interface Autor {
  usuarioId: string;
  requestId: string;
}

const soma = (valores: readonly (number | null)[]): number | null => (valores.some((v) => v === null) ? null : valores.reduce<number>((t, v) => t + (v ?? 0), 0));

export async function registrarConferenciaVolumes(tx: Transacao, escopo: Escopo, paleteId: string, dados: Dados, autor: Autor, agora: Date): Promise<ResultadoConferenciaVolumes> {
  // Palete travado: movimentos e outras conferências do mesmo palete esperam esta terminar.
  const [p] = await tx.$queryRaw<{ id: string; codigo: string; arquivado: boolean; fluxo: string }[]>`
    SELECT id::text, codigo, arquivado_em IS NOT NULL AS arquivado, estado_fluxo::text AS fluxo
      FROM palete WHERE id = ${paleteId}::uuid AND escopo_id = ${escopo.id}::uuid FOR UPDATE`;
  if (!p) throw naoEncontrado('Palete não encontrado neste escopo.');
  if (p.arquivado || p.fluxo === 'EXPEDIDO') throw new ErroHttp(409, 'CONFLITO', `O palete ${p.codigo} ${p.arquivado ? 'está arquivado' : 'já foi expedido'}: não é conferido.`);

  const ocorrencias = await ocorrenciasAtivas(tx, escopo.id, [paleteId]);
  if (ocorrencias.length === 0) throw new ErroHttp(409, 'CONFLITO', `O palete ${p.codigo} não tem conteúdo para conferir.`);
  if (assinaturaConjunto(ocorrencias) !== dados.setSignature) {
    throw new ErroHttp(
      409,
      'CONJUNTO_ALTERADO',
      'O conteúdo do palete mudou depois que a tabela foi aberta (entrada, saída ou outra contagem). Nada foi gravado: revise o conjunto atualizado e conclua de novo.',
    );
  }
  const porId = new Map(ocorrencias.map((o) => [o.id, o]));
  for (const l of dados.lines) {
    const o = porId.get(l.id);
    if (o?.kind !== l.kind) throw new ErroHttp(409, 'CONJUNTO_ALTERADO', 'Uma linha da conferência não pertence mais a este palete. Revise o conjunto atualizado.');
  }
  if (dados.scope === 'COMPLETA' && dados.lines.length !== ocorrencias.length) {
    throw requisicaoInvalida(`A conferência completa abrange todos os ${String(ocorrencias.length)} conteúdos do palete; para só uma parte, use a conferência parcial.`);
  }

  const linhas = dados.lines.map((l) => {
    const o = porId.get(l.id);
    if (!o) throw new Error('linha sem ocorrência');
    return { ...l, anterior: o.atual, documento: o.documento, alterada: o.atual === null || o.atual !== l.counted };
  });
  const diferencas = linhas.filter((l) => l.anterior !== null && l.anterior !== l.counted);
  const alteradas = linhas.filter((l) => l.alterada);
  const resultado = diferencas.length > 0 ? 'COM_DIFERENCA' : 'SEM_DIFERENCA';
  const observacao = dados.notes === null || dados.notes === '' ? null : dados.notes;
  const operacaoId = randomUUID();

  let reconferenciaId: string | null = null;
  if (dados.scope === 'COMPLETA') {
    reconferenciaId = randomUUID();
    await tx.reconferenciaPalete.create({
      data: { id: reconferenciaId, escopoId: escopo.id, paleteId, resultado, observacao, conteudos: ocorrencias.length, registradaPorId: autor.usuarioId, registradaEm: agora },
    });
  }
  const volumesAntes = soma(linhas.map((l) => l.anterior));
  const volumesDepois = soma(linhas.map((l) => l.counted));
  await tx.conferenciaVolumes.create({
    data: {
      id: operacaoId,
      escopoId: escopo.id,
      paleteId,
      abrangencia: dados.scope,
      resultado,
      declaracaoFisica: dados.physicalDeclaration,
      assinaturaConjunto: dados.setSignature,
      itens: linhas.length,
      alterados: alteradas.length,
      diferencas: diferencas.length,
      volumesAntes,
      volumesDepois,
      observacao,
      reconferenciaId,
      registradaPorId: autor.usuarioId,
      registradaEm: agora,
    },
  });
  // Saldo e histórico juntos: a contagem gravada é a nova quantidade atual; a linha guarda anterior e contado.
  for (const l of linhas) {
    const contagemId = l.alterada ? randomUUID() : null;
    if (contagemId !== null) {
      await tx.contagemVolumes.create({
        data: {
          id: contagemId,
          escopoId: escopo.id,
          paleteId,
          conteudoId: l.kind === 'REGISTRADO' ? l.id : null,
          vinculoId: l.kind === 'IMPORTADO' ? l.id : null,
          volumesContados: l.counted,
          volumesPrevistos: null,
          origem: 'CONTAGEM_FISICA',
          referencia: dados.scope === 'COMPLETA' ? 'Conferência completa do palete' : 'Conferência parcial do palete',
          registradaPorId: autor.usuarioId,
          registradaEm: agora,
          conferenciaId: operacaoId,
        },
      });
    }
    await tx.itemConferenciaVolumes.create({
      data: {
        id: randomUUID(),
        escopoId: escopo.id,
        conferenciaId: operacaoId,
        conteudoId: l.kind === 'REGISTRADO' ? l.id : null,
        vinculoId: l.kind === 'IMPORTADO' ? l.id : null,
        volumesAnteriores: l.anterior,
        volumesContados: l.counted,
        contagemId,
      },
    });
  }
  if (dados.scope === 'COMPLETA') await registrarReconferenciaCompleta(tx, escopo.id, paleteId, 'RECONFERENCIA_VOLUMES', autor.usuarioId, agora);

  const resumoDiferencas = linhas
    .filter((l) => l.anterior === null || l.anterior !== l.counted)
    .map((l) => ({ id: l.id, kind: l.kind, document: l.documento, previous: l.anterior, counted: l.counted, difference: l.anterior === null ? null : l.counted - l.anterior }));
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_VOLUMES_REGISTRADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: paleteId,
    detalhes: {
      palete: p.codigo,
      operacao: operacaoId,
      abrangencia: dados.scope,
      resultado,
      itens: linhas.length,
      alterados: alteradas.length,
      volumesAntes,
      volumesDepois,
      diferencas: resumoDiferencas.length,
      detalheDiferencas: resumoDiferencas.slice(0, 40).map((d) => `${d.document}: ${d.previous === null ? '?' : String(d.previous)} → ${String(d.counted)}`).join('; ') || null,
    },
    requestId: autor.requestId,
  });

  const depois = await ocorrenciasAtivas(tx, escopo.id, [paleteId]);
  const estado = await calcularConferencia(tx, escopo.id, depois, [paleteId]);
  const autorDados = await tx.usuario.findUniqueOrThrow({ where: { id: autor.usuarioId }, select: { login: true, nome: true } });
  return {
    operationId: operacaoId,
    palletId: paleteId,
    palletCode: p.codigo,
    scope: dados.scope,
    at: agora.toISOString(),
    by: { login: autorDados.login, name: autorDados.nome },
    items: linhas.length,
    changed: alteradas.length,
    differences: resumoDiferencas,
    volumesBefore: volumesAntes,
    volumesAfter: volumesDepois,
    volumeCheck: estado.porPalete.get(paleteId) ?? { state: 'NAO_CONFERIDO', items: 0, covered: 0, differences: 0, lastCompleteAt: null, lastCompleteBy: null },
    reconference: await relogioDoPalete(tx, escopo.id, paleteId, agora),
  };
}
