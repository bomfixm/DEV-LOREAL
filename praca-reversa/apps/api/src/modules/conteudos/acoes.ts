/**
 * Correção de conteúdos do palete (21 out. 2026): mover, enviar à validação
 * sem endereço, cancelar registro incorreto e resolver pendências da
 * validação escolhendo o destino no mapa.
 *
 * - Seleção por ID de ocorrência (nunca pelo número da NF); o conjunto é
 *   conferido com as linhas travadas: ocorrência que saiu, mudou de palete ou
 *   de situação → nada é gravado (CONJUNTO_ALTERADO).
 * - Mover preserva o ID e as contagens (a quantidade atual acompanha a
 *   ocorrência): encerra a alocação anterior e abre a nova, sem clonar. Destino
 *   ocupado exige confirmação e mantém o número e o conteúdo do destino;
 *   posição vazia cadastra o palete pelo cadastro existente (série do piso).
 *   Identidade coincidente no destino é informada, nunca fundida.
 * - Validação: a ocorrência sai do estoque físico do palete (o palete fica
 *   como último conhecido, HISTÓRICO); quantidade e história preservadas; sem
 *   expedição ou baixa fictícia.
 * - Cancelar: retira do estoque ativo um registro incorreto, com motivo e
 *   autor; o documento e outras ocorrências da mesma NF não mudam.
 * - Ocorrência com volumes separados ou expedidos numa janela não é corrigida
 *   aqui (impacto operacional sinalizado; nada muda em silêncio).
 */
import { compararIdentidade, type AcaoConteudosSchema, type Escopo, type ResolverValidacaoSchema, type ResultadoAcaoConteudos } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica } from '../../db/erros.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento, type AcaoAuditoria } from '../auditoria/registrar.js';
import { carregarDestino } from '../importacao/bipagem.js';
import { reservarNumeroPalete } from '../paletes/numeracao.js';
import { registrarMovimentacaoRelevante } from '../paletes/relogio.js';
import { cadastrarPalete } from '../paletes/servico.js';
import { quantidadesAtuais, type TipoAlvo } from './estado.js';

type DadosAcao = z.output<typeof AcaoConteudosSchema>;
type DadosResolver = z.output<typeof ResolverValidacaoSchema>;
type Destino = z.output<typeof ResolverValidacaoSchema>['destination'];

export interface Autor {
  usuarioId: string;
  requestId: string;
}

interface Ocorrencia {
  kind: TipoAlvo;
  id: string;
  situacao: string;
  palete_id: string;
  tipo: string | null;
  numero: string | null;
  remetente: string | null;
  cnpj: string | null;
}

interface RefPalete {
  id: string;
  codigo: string;
  endereco: string | null;
}

/** Código e endereço (real confirmado ou código da posição) do palete, para o histórico. */
async function refPalete(tx: Transacao, escopoId: string, paleteId: string): Promise<RefPalete> {
  const [p] = await tx.$queryRaw<RefPalete[]>`
    SELECT p.id::text, p.codigo, coalesce(CASE WHEN ep.situacao = 'CONFIRMADO' THEN ep.endereco END, pos.codigo) AS endereco
      FROM palete p LEFT JOIN posicao pos ON pos.id = p.posicao_id LEFT JOIN endereco_posicao ep ON ep.posicao_id = p.posicao_id
     WHERE p.id = ${paleteId}::uuid AND p.escopo_id = ${escopoId}::uuid`;
  if (!p) throw naoEncontrado('Palete não encontrado neste escopo.');
  return p;
}

const documento = (o: Pick<Ocorrencia, 'tipo' | 'numero' | 'remetente'>) =>
  o.numero === null ? `Conteúdo sem documento (${o.remetente ?? 'remetente não informado'})` : `${o.tipo ?? 'Documento'} ${o.numero}`;

/** Trava e lê as ocorrências escolhidas; todas precisam estar na situação (e no palete) esperados. */
async function carregarOcorrencias(tx: Transacao, escopoId: string, alvos: readonly { kind: TipoAlvo; id: string }[], situacao: 'ATIVO' | 'VALIDACAO', paleteId: string | null): Promise<Ocorrencia[]> {
  const vinculos = alvos.filter((a) => a.kind === 'IMPORTADO').map((a) => a.id);
  const conteudos = alvos.filter((a) => a.kind === 'REGISTRADO').map((a) => a.id);
  const [v, c] = await Promise.all([
    vinculos.length === 0
      ? []
      : tx.$queryRaw<Ocorrencia[]>`
          SELECT 'IMPORTADO' AS kind, v.id::text, v.situacao, v.palete_id::text, v.tipo_documento AS tipo, v.numero_documento AS numero, li.remetente, NULL::text AS cnpj
            FROM vinculo_documento_palete v JOIN linha_inventario li ON li.id = v.linha_inventario_id
           WHERE v.escopo_id = ${escopoId}::uuid AND v.id = ANY(${vinculos}::uuid[])
           ORDER BY v.id FOR UPDATE OF v`,
    conteudos.length === 0
      ? []
      : tx.$queryRaw<Ocorrencia[]>`
          SELECT 'REGISTRADO' AS kind, c.id::text, c.situacao, c.palete_id::text, c.tipo_documento AS tipo, c.numero_documento AS numero, c.remetente,
                 coalesce(c.cnpj_remetente_digitos, c.cnpj_remetente) AS cnpj
            FROM conteudo_palete c
           WHERE c.escopo_id = ${escopoId}::uuid AND c.id = ANY(${conteudos}::uuid[])
           ORDER BY c.id FOR UPDATE`,
  ]);
  const lidas = [...v, ...c];
  const validas = lidas.filter((o) => o.situacao === situacao && (paleteId === null || o.palete_id === paleteId));
  const fora = alvos.length - validas.length;
  if (fora > 0) {
    // Quais mudaram (as que ainda existem no escopo); nada é gravado para nenhuma delas.
    const ok = new Set(validas.map((o) => o.id));
    const nomes = lidas.filter((o) => !ok.has(o.id)).map(documento);
    const quais = nomes.length === 0 ? '' : ` (${nomes.slice(0, 10).join('; ')}${nomes.length > 10 ? '; …' : ''})`;
    throw new ErroHttp(
      409,
      'CONJUNTO_ALTERADO',
      situacao === 'ATIVO'
        ? `${String(fora)} conteúdo(s) selecionado(s) não ${fora === 1 ? 'está' : 'estão'} mais neste palete${quais} (movido, enviado à validação ou cancelado por outra pessoa). Nada foi gravado: revise a seleção atualizada.`
        : `${String(fora)} pendência(s) selecionada(s) já ${fora === 1 ? 'foi resolvida' : 'foram resolvidas'} por outra pessoa${quais}. Nada foi gravado: revise a lista atualizada e confirme de novo as que continuam pendentes.`,
    );
  }
  // Ordem da seleção (o histórico e a resposta seguem a mesma ordem).
  const porId = new Map(lidas.map((o) => [o.id, o]));
  return alvos.map((a) => porId.get(a.id)).filter((o): o is Ocorrencia => o !== undefined);
}

/** Volumes separados aguardando ou expedidos numa janela: a correção fica para a janela (estorno), nunca em silêncio. */
async function exigirSemJanela(tx: Transacao, escopoId: string, ocorrencias: readonly Ocorrencia[]): Promise<void> {
  if (ocorrencias.length === 0) return;
  const linhas = await tx.$queryRaw<{ alvo: string; aguardando: bigint; expedido: bigint; janelas: string }[]>`
    SELECT coalesce(e.vinculo_id, e.conteudo_id)::text AS alvo,
           coalesce(sum(CASE e.tipo WHEN 'SEPARACAO' THEN e.volumes WHEN 'ESTORNO_SEPARACAO' THEN -e.volumes WHEN 'EXPEDICAO' THEN -e.volumes WHEN 'ESTORNO_EXPEDICAO' THEN e.volumes ELSE 0 END), 0) AS aguardando,
           coalesce(sum(CASE e.tipo WHEN 'EXPEDICAO' THEN e.volumes WHEN 'ESTORNO_EXPEDICAO' THEN -e.volumes ELSE 0 END), 0) AS expedido,
           string_agg(DISTINCT j.codigo, ', ') AS janelas
      FROM evento_volumes_janela e JOIN janela_devolucao j ON j.id = e.janela_id
     WHERE e.escopo_id = ${escopoId}::uuid AND coalesce(e.vinculo_id, e.conteudo_id) = ANY(${ocorrencias.map((o) => o.id)}::uuid[])
     GROUP BY 1`;
  const presas = linhas.filter((l) => l.aguardando > 0n || l.expedido > 0n);
  if (presas.length === 0) return;
  const porId = new Map(ocorrencias.map((o) => [o.id, o]));
  const descricao = presas
    .slice(0, 5)
    .map((l) => {
      const o = porId.get(l.alvo);
      return `${o ? documento(o) : l.alvo} (${l.aguardando > 0n ? `${String(l.aguardando)} separado(s) aguardando` : `${String(l.expedido)} expedido(s)`} na janela ${l.janelas})`;
    })
    .join('; ');
  throw new ErroHttp(409, 'JANELA_VINCULADA', `Conteúdo com volumes numa janela: ${descricao}. Trate na janela (estorno) antes de corrigir; nada foi alterado.`);
}

async function historico(
  tx: Transacao,
  escopoId: string,
  operacaoId: string,
  o: Ocorrencia,
  acao: 'MOVIMENTO' | 'VALIDACAO' | 'RESOLUCAO' | 'CANCELAMENTO' | 'ENCERRAMENTO',
  origem: RefPalete | null,
  destino: RefPalete | null,
  situacaoNova: string,
  volumes: number | null,
  motivo: string | null,
  autorId: string | null,
  agora: Date,
  detalhes: Prisma.InputJsonObject = {},
): Promise<void> {
  await tx.historicoConteudo.create({
    data: {
      id: randomUUID(),
      escopoId,
      operacaoId,
      conteudoId: o.kind === 'REGISTRADO' ? o.id : null,
      vinculoId: o.kind === 'IMPORTADO' ? o.id : null,
      acao,
      paleteOrigemId: origem?.id ?? null,
      codigoOrigem: origem?.codigo ?? null,
      enderecoOrigem: origem?.endereco ?? null,
      paleteDestinoId: destino?.id ?? null,
      codigoDestino: destino?.codigo ?? null,
      enderecoDestino: destino?.endereco ?? null,
      situacaoAnterior: o.situacao,
      situacaoNova,
      volumes,
      motivo,
      autorId,
      registradoEm: agora,
      detalhes,
    },
  });
}

/** Grava a nova situação/alocação de cada ocorrência (o vínculo importado preserva a fotografia). */
async function atualizar(tx: Transacao, ocorrencias: readonly Ocorrencia[], dados: { situacao: string; paleteId?: string; alocadoEm?: Date; encerrar?: { em: Date; por: string; motivo: string } }): Promise<void> {
  const vinculos = ocorrencias.filter((o) => o.kind === 'IMPORTADO').map((o) => o.id);
  const conteudos = ocorrencias.filter((o) => o.kind === 'REGISTRADO').map((o) => o.id);
  try {
    if (vinculos.length > 0) {
      await tx.vinculoDocumentoPalete.updateMany({
        where: { id: { in: vinculos } },
        data: {
          situacao: dados.situacao,
          ...(dados.paleteId === undefined ? {} : { paleteId: dados.paleteId }),
          ...(dados.alocadoEm === undefined ? {} : { alocadoEm: dados.alocadoEm }),
          ...(dados.encerrar === undefined ? {} : { encerradoEm: dados.encerrar.em, encerradoPorId: dados.encerrar.por, motivoEncerramento: dados.encerrar.motivo }),
        },
      });
    }
    if (conteudos.length > 0) {
      await tx.conteudoPalete.updateMany({
        where: { id: { in: conteudos } },
        data: {
          situacao: dados.situacao,
          ...(dados.paleteId === undefined ? {} : { paleteId: dados.paleteId }),
          ...(dados.alocadoEm === undefined ? {} : { alocadoEm: dados.alocadoEm }),
          versao: { increment: 1 },
          atualizadoEm: dados.alocadoEm ?? dados.encerrar?.em ?? new Date(),
        },
      });
    }
  } catch (erro) {
    if (ehViolacaoUnica(erro)) {
      throw new ErroHttp(409, 'CONFLITO', 'Já existe um vínculo ativo com a mesma chave de importação (a nota foi importada de novo). Confira a ocorrência ativa antes de repetir.');
    }
    throw erro;
  }
}

interface DestinoGravado {
  ref: RefPalete;
  criado: boolean;
  avisos: string[];
}

/** Resolve e trava o destino; posição vazia cadastra o palete pelo cadastro existente (série do piso). */
async function prepararDestino(
  tx: Transacao,
  escopo: Escopo,
  destino: Destino,
  confirmarOcupado: boolean,
  origemId: string | null,
  movidas: readonly Ocorrencia[],
  autor: Autor,
  agora: Date,
  nota: string,
): Promise<DestinoGravado> {
  const d = await carregarDestino(tx, escopo.id, destino, true);
  if (d === null) throw requisicaoInvalida('Escolha o destino no mapa.');
  if (d.bloqueio !== null) throw new ErroHttp(409, 'CONFLITO', d.bloqueio);
  if (d.tipo === 'PALETE_EXISTENTE') {
    if (d.palete === null) throw new ErroHttp(409, 'CONFLITO', 'Palete de destino ausente.');
    if (d.palete.id === origemId) throw requisicaoInvalida('O destino é o próprio palete de origem: escolha outro palete ou posição.');
    if (d.alvos.length > 0 && !confirmarOcupado) {
      throw new ErroHttp(
        409,
        'CONFIRMAR_DESTINO',
        `O palete ${d.palete.codigo}${d.palete.endereco === null ? '' : ` (${d.palete.endereco})`} já tem ${String(d.alvos.length)} conteúdo(s): confirme para acrescentar (o conteúdo e o número dele ficam).`,
      );
    }
    const avisos: string[] = [];
    for (const o of movidas) {
      const igual = d.alvos.find((x) => compararIdentidade({ tipo: o.tipo, numero: o.numero, cnpj: o.cnpj, remetente: o.remetente }, { tipo: x.tipo, numero: x.numero, cnpj: x.cnpj, remetente: x.remetente }) !== 'DIFERENTE');
      if (igual && o.numero !== null) avisos.push(`${documento(o)} já existe no palete ${d.palete.codigo} (outra ocorrência, ${igual.fonte}): as duas ficam, nada foi fundido.`);
    }
    return { ref: { id: d.palete.id, codigo: d.palete.codigo, endereco: d.palete.endereco ?? d.posicao?.endereco ?? d.posicao?.codigo ?? null }, criado: false, avisos };
  }
  if (d.posicao === null) throw new ErroHttp(409, 'CONFLITO', 'Posição de destino ausente.');
  const numero = await reservarNumeroPalete(tx, escopo.id, agora);
  const detalhe = await cadastrarPalete(tx, escopo, { code: { mode: 'INFORMAR', value: numero }, positionId: d.posicao.id, notes: nota.slice(0, 500), declaredItems: [] }, autor, agora, { codigoDaNumeracao: true });
  return { ref: { id: detalhe.id, codigo: detalhe.code, endereco: d.posicao.endereco ?? d.posicao.codigo }, criado: true, avisos: [] };
}

async function restantes(tx: Transacao, escopoId: string, paleteId: string): Promise<number> {
  const [r] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT (SELECT count(*) FROM vinculo_documento_palete WHERE escopo_id = ${escopoId}::uuid AND palete_id = ${paleteId}::uuid AND situacao = 'ATIVO')
         + (SELECT count(*) FROM conteudo_palete WHERE escopo_id = ${escopoId}::uuid AND palete_id = ${paleteId}::uuid AND situacao = 'ATIVO') AS n`;
  return Number(r?.n ?? 0);
}

function somaVolumes(ocorrencias: readonly Ocorrencia[], qtd: ReadonlyMap<string, number | null>): { volumes: number; semVolumes: number } {
  let volumes = 0;
  let semVolumes = 0;
  for (const o of ocorrencias) {
    const v = qtd.get(o.id) ?? null;
    if (v === null) semVolumes++;
    else volumes += v;
  }
  return { volumes, semVolumes };
}

const acaoAuditoria = (a: DadosAcao['action']): AcaoAuditoria => (a === 'MOVER' ? 'CONTEUDOS_MOVIDOS' : a === 'VALIDACAO' ? 'CONTEUDOS_VALIDACAO' : 'CONTEUDOS_CANCELADOS');

/** Mover, enviar à validação ou cancelar ocorrências do palete :id. */
export async function executarAcaoConteudos(tx: Transacao, escopo: Escopo, paleteId: string, dados: DadosAcao, autor: Autor, agora: Date): Promise<ResultadoAcaoConteudos> {
  const [p] = await tx.$queryRaw<{ codigo: string; arquivado: boolean; fluxo: string }[]>`
    SELECT codigo, arquivado_em IS NOT NULL AS arquivado, estado_fluxo::text AS fluxo FROM palete WHERE id = ${paleteId}::uuid AND escopo_id = ${escopo.id}::uuid FOR UPDATE`;
  if (!p) throw naoEncontrado('Palete não encontrado neste escopo.');
  if (p.arquivado || p.fluxo === 'EXPEDIDO') throw new ErroHttp(409, 'CONFLITO', `O palete ${p.codigo} ${p.arquivado ? 'está arquivado' : 'já foi expedido'}: o conteúdo dele não é corrigido aqui.`);
  const ocorrencias = await carregarOcorrencias(tx, escopo.id, dados.items, 'ATIVO', paleteId);
  await exigirSemJanela(tx, escopo.id, ocorrencias);
  const origem = await refPalete(tx, escopo.id, paleteId);
  const qtd = await quantidadesAtuais(
    tx,
    escopo.id,
    ocorrencias.map((o) => o.id),
  );
  const operacaoId = randomUUID();
  const motivo = dados.reason;
  let destino: DestinoGravado | null = null;

  if (dados.action === 'MOVER') {
    destino = await prepararDestino(tx, escopo, dados.destination, dados.confirmOccupied, paleteId, ocorrencias, autor, agora, `Cadastrado ao mover conteúdos do palete ${origem.codigo}.`);
    await atualizar(tx, ocorrencias, { situacao: 'ATIVO', paleteId: destino.ref.id, alocadoEm: agora });
    for (const o of ocorrencias) await historico(tx, escopo.id, operacaoId, o, 'MOVIMENTO', origem, destino.ref, 'ATIVO', qtd.get(o.id) ?? null, motivo, autor.usuarioId, agora, { paleteCriado: destino.criado });
    await registrarMovimentacaoRelevante(tx, escopo.id, [paleteId], 'TRANSFERENCIA_ENVIADA', agora);
    await registrarMovimentacaoRelevante(tx, escopo.id, [destino.ref.id], 'TRANSFERENCIA_RECEBIDA', agora);
  } else if (dados.action === 'VALIDACAO') {
    await atualizar(tx, ocorrencias, { situacao: 'VALIDACAO' });
    for (const o of ocorrencias) await historico(tx, escopo.id, operacaoId, o, 'VALIDACAO', origem, null, 'VALIDACAO', qtd.get(o.id) ?? null, motivo, autor.usuarioId, agora);
  } else {
    await atualizar(tx, ocorrencias, { situacao: 'CANCELADO', encerrar: { em: agora, por: autor.usuarioId, motivo: dados.reason } });
    for (const o of ocorrencias) await historico(tx, escopo.id, operacaoId, o, 'CANCELAMENTO', origem, null, 'CANCELADO', qtd.get(o.id) ?? null, motivo, autor.usuarioId, agora);
  }

  const restam = await restantes(tx, escopo.id, paleteId);
  const avisos = [...(destino?.avisos ?? [])];
  if (restam === 0) avisos.push(`O palete ${origem.codigo} ficou sem conteúdo ativo: a posição continua ocupada até a retirada do palete vazio ser registrada.`);
  const { volumes, semVolumes } = somaVolumes(ocorrencias, qtd);
  await registrarEvento(tx, {
    acao: acaoAuditoria(dados.action),
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: paleteId,
    detalhes: {
      operacao: operacaoId,
      palete: origem.codigo,
      endereco: origem.endereco,
      ocorrencias: ocorrencias.length,
      documentos: ocorrencias.slice(0, 60).map(documento).join('; ') + (ocorrencias.length > 60 ? ' …' : ''),
      volumes,
      motivo,
      destino: destino?.ref.codigo ?? null,
      enderecoDestino: destino?.ref.endereco ?? null,
      paleteCriado: destino?.criado ?? false,
    },
    requestId: autor.requestId,
  });
  return {
    operationId: operacaoId,
    action: dados.action,
    affected: ocorrencias.length,
    volumes,
    withoutVolumes: semVolumes,
    origin: { id: origem.id, code: origem.codigo, address: origem.endereco, remaining: restam, emptied: restam === 0 },
    destination: destino === null ? null : { id: destino.ref.id, code: destino.ref.codigo, address: destino.ref.endereco, created: destino.criado, items: await restantes(tx, escopo.id, destino.ref.id) },
    warnings: avisos,
  };
}

/** Resolve pendências da validação: destino verdadeiro escolhido no mapa (uma ou várias de uma vez). */
export async function resolverValidacao(tx: Transacao, escopo: Escopo, dados: DadosResolver, autor: Autor, agora: Date): Promise<ResultadoAcaoConteudos> {
  const ocorrencias = await carregarOcorrencias(tx, escopo.id, dados.items, 'VALIDACAO', null);
  const qtd = await quantidadesAtuais(
    tx,
    escopo.id,
    ocorrencias.map((o) => o.id),
  );
  const operacaoId = randomUUID();
  const destino = await prepararDestino(tx, escopo, dados.destination, dados.confirmOccupied, null, ocorrencias, autor, agora, 'Cadastrado ao resolver a validação sem endereço.');
  await atualizar(tx, ocorrencias, { situacao: 'ATIVO', paleteId: destino.ref.id, alocadoEm: agora });
  const ultimos = new Map<string, RefPalete>();
  for (const o of ocorrencias) {
    const ultimo = ultimos.get(o.palete_id) ?? (await refPalete(tx, escopo.id, o.palete_id));
    ultimos.set(o.palete_id, ultimo);
    await historico(tx, escopo.id, operacaoId, o, 'RESOLUCAO', ultimo, destino.ref, 'ATIVO', qtd.get(o.id) ?? null, dados.reason, autor.usuarioId, agora, { paleteCriado: destino.criado, ultimoConhecido: true });
  }
  await registrarMovimentacaoRelevante(tx, escopo.id, [destino.ref.id], 'ENTRADA_CONTEUDO', agora);
  const { volumes, semVolumes } = somaVolumes(ocorrencias, qtd);
  await registrarEvento(tx, {
    acao: 'VALIDACAO_RESOLVIDA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: destino.ref.id,
    detalhes: {
      operacao: operacaoId,
      destino: destino.ref.codigo,
      enderecoDestino: destino.ref.endereco,
      paleteCriado: destino.criado,
      ocorrencias: ocorrencias.length,
      documentos: ocorrencias.slice(0, 60).map(documento).join('; ') + (ocorrencias.length > 60 ? ' …' : ''),
      volumes,
      motivo: dados.reason,
    },
    requestId: autor.requestId,
  });
  return {
    operationId: operacaoId,
    action: 'RESOLUCAO',
    affected: ocorrencias.length,
    volumes,
    withoutVolumes: semVolumes,
    origin: null,
    destination: { id: destino.ref.id, code: destino.ref.codigo, address: destino.ref.endereco, created: destino.criado, items: await restantes(tx, escopo.id, destino.ref.id) },
    warnings: destino.avisos,
  };
}

export { historico as registrarHistoricoConteudo, refPalete, type Ocorrencia };
