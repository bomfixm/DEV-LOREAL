/**
 * Publicação da planilha de um escopo, depois das transações confirmadas (a
 * fila é a tabela `alteracao_planilha`, preenchida por gatilhos). Garantias:
 *
 * - um publicador por escopo: concessão em `controle_planilha` com expiração
 *   (um trabalho interrompido por reinício é retomado depois do prazo; a
 *   tentativa que ficou "GERANDO" é registrada como falha);
 * - versão crescente por escopo, e o destino recusa versão mais antiga;
 * - snapshot único (dados.ts); falha de leitura, tempo esgotado, geração ou
 *   validação incompleta nunca substitui o último arquivo bom;
 * - o arquivo é relido e conferido (linhas, cabeçalhos, NFD como texto) antes
 *   de publicar; as marcações incluídas só são apagadas depois do sucesso;
 * - falha no destino não desfaz nada da operação (só registra, conta falhas e
 *   agenda nova tentativa com espera crescente).
 */
import type { LimitesImportacao } from '@praca-reversa/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Banco } from '../../db/cliente.js';
import { lerTabela } from '../importacao/arquivo/ler.js';
import { lerSnapshot, type SnapshotPlanilha } from './dados.js';
import { VersaoAntigaError, publicarEmPasta, type ResultadoDestino } from './destino.js';
import { COLUNAS_INVENTARIO, COLUNAS_MOVIMENTOS, LINHA_CABECALHO_INVENTARIO, LINHA_CABECALHO_MOVIMENTOS, montarPlanilha, nomeArquivoPlanilha } from './montar.js';
import type { ConfigPlanilha } from './situacao.js';

export type MotivoPublicacao = 'ALTERACAO' | 'RECONCILIACAO' | 'MANUAL';

export interface ResultadoPublicacao {
  situacao: 'PUBLICADA' | 'GERADA_LOCAL' | 'FALHOU' | 'OCUPADO';
  versao: number | null;
  erro: string | null;
  arquivoLocal: string | null;
}

/** Pontos de falha simulada (só testes): leitura do banco, validação e destino. */
export interface Simulacao {
  falharLeitura?: boolean;
  falharDestino?: boolean;
  corromper?: boolean;
}

const LIMITES_LEITURA: LimitesImportacao = {
  maxBytes: 512 * 1_048_576,
  maxRows: 200_000,
  maxColumns: 60,
  maxCellChars: 32_767,
  maxUncompressedBytes: 2_048 * 1_048_576,
  maxZipEntries: 60,
  maxProcessingMs: 300_000,
};

/** Pasta local da geração do escopo (no servidor; não conta como cópia publicada). */
export function pastaLocalDoEscopo(config: ConfigPlanilha, escopoId: string): string {
  return join(config.pastaLocal, escopoId);
}

/** Reabre o arquivo gerado e confere estrutura e conteúdo com o snapshot. */
export function validarArquivo(buffer: Buffer, s: SnapshotPlanilha): void {
  const inv = lerTabela(buffer, 'XLSX', { sheet: 'Inventário', headerRow: LINHA_CABECALHO_INVENTARIO, encoding: null, delimiter: null }, LIMITES_LEITURA);
  const cab = inv.cabecalho.slice(1, 1 + COLUNAS_INVENTARIO.length).map((c) => c.texto);
  if (cab.join('|') !== COLUNAS_INVENTARIO.join('|')) throw new Error('Validação: cabeçalho do Inventário diferente do esperado.');
  if (inv.linhas.length < s.inventario.length) throw new Error(`Validação: Inventário com ${String(inv.linhas.length)} linhas lidas; esperadas ${String(s.inventario.length)}.`);
  s.inventario.forEach((x, i) => {
    const l = inv.linhas[i];
    const lido = (col: number) => l?.celulas[col]?.texto ?? null;
    if (l?.numero !== LINHA_CABECALHO_INVENTARIO + 1 + i || lido(3) !== x.nfd || lido(2) !== x.palete || lido(11) !== x.delivery) {
      throw new Error(`Validação: linha ${String(LINHA_CABECALHO_INVENTARIO + 1 + i)} do Inventário não confere (NFD, palete ou Delivery).`);
    }
    if (x.nfd !== null && l.celulas[3]?.tipo !== 'TEXTO') throw new Error(`Validação: NFD ${x.nfd} não ficou como texto.`);
  });
  const mov = lerTabela(buffer, 'XLSX', { sheet: 'Movimentações', headerRow: LINHA_CABECALHO_MOVIMENTOS, encoding: null, delimiter: null }, LIMITES_LEITURA);
  if (mov.cabecalho.slice(1, 1 + COLUNAS_MOVIMENTOS.length).map((c) => c.texto).join('|') !== COLUNAS_MOVIMENTOS.join('|')) throw new Error('Validação: cabeçalho de Movimentações diferente do esperado.');
  const ids = s.eventos.map((e) => e.id);
  const lidos = mov.linhas.slice(0, ids.length).map((l) => l.celulas[2]?.texto ?? null);
  if (lidos.join('|') !== ids.join('|') || new Set(ids).size !== ids.length) throw new Error('Validação: eventos de Movimentações não conferem (ID repetido ou ausente).');
}

async function reivindicar(db: Banco, escopoId: string, token: string, concessaoMs: number, agora: Date): Promise<number | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO controle_planilha (escopo_id) VALUES (${escopoId}::uuid) ON CONFLICT DO NOTHING`;
    const limite = new Date(agora.getTime() - concessaoMs);
    const [r] = await tx.$queryRaw<{ versao: number }[]>`
      UPDATE controle_planilha SET publicando_desde = ${agora}, publicando_por = ${token}, versao_atual = versao_atual + 1
       WHERE escopo_id = ${escopoId}::uuid AND (publicando_desde IS NULL OR publicando_desde < ${limite})
       RETURNING versao_atual AS versao`;
    if (!r) return null;
    // Tentativa anterior interrompida (reinício/queda) fica registrada como falha: nada foi substituído.
    await tx.$executeRaw`
      UPDATE publicacao_planilha SET situacao = 'FALHOU', concluido_em = ${agora},
             erro = 'Interrompida antes de concluir (reinício ou queda do processo); nada foi substituído no destino.'
       WHERE escopo_id = ${escopoId}::uuid AND situacao = 'GERANDO'`;
    return r.versao;
  });
}

/** Gera e publica a planilha do escopo agora (ou devolve OCUPADO se outra publicação está em andamento). */
export async function publicarPlanilha(
  db: Banco,
  escopoId: string,
  config: ConfigPlanilha,
  opcoes: { motivo: MotivoPublicacao; solicitadoPorId?: string | null; agora?: () => Date; simular?: Simulacao },
): Promise<ResultadoPublicacao> {
  const agora = opcoes.agora ?? (() => new Date());
  const token = randomUUID();
  const versao = await reivindicar(db, escopoId, token, config.concessaoMs, agora());
  if (versao === null) return { situacao: 'OCUPADO', versao: null, erro: null, arquivoLocal: null };
  const publicacaoId = randomUUID();
  await db.publicacaoPlanilha.create({
    data: { id: publicacaoId, escopoId, versao, situacao: 'GERANDO', motivo: opcoes.motivo, solicitadoPorId: opcoes.solicitadoPorId ?? null, iniciadoEm: agora() },
  });
  const escopo = await db.escopo.findUniqueOrThrow({ where: { id: escopoId }, select: { demonstracao: true, unidade: { select: { codigo: true } }, cliente: { select: { codigo: true } } } });
  // Dados fictícios nunca vão para o destino da operação.
  const destino = escopo.demonstracao ? null : config.destino;
  const nome = nomeArquivoPlanilha(escopo.unidade.codigo, escopo.cliente.codigo);
  let s: SnapshotPlanilha | null = null;
  try {
    if (opcoes.simular?.falharLeitura) throw new Error('Leitura do banco indisponível (simulada).');
    s = await lerSnapshot(db, escopoId, config.eventosMax);
    const { buffer } = montarPlanilha(s, versao, { ...config, destino });
    const conteudo = opcoes.simular?.corromper ? buffer.subarray(0, Math.floor(buffer.length / 2)) : buffer;
    validarArquivo(conteudo, s);
    const hash = createHash('sha256').update(conteudo).digest('hex');
    // Cópia local sempre (download pelo aplicativo); publicação externa só com destino independente.
    const local = pastaLocalDoEscopo(config, escopoId);
    mkdirSync(local, { recursive: true });
    const resultadoLocal = publicarEmPasta(local, nome, conteudo, versao, s.instante, Math.min(config.versoesManter, 10));
    let externo: ResultadoDestino | null = null;
    if (destino !== null) {
      if (opcoes.simular?.falharDestino) throw new Error(`Destino indisponível: ${destino.descricao} (simulado).`);
      externo = publicarEmPasta(destino.caminho, nome, conteudo, versao, s.instante, config.versoesManter);
    }
    const registros = {
      linhasInventario: s.inventario.length,
      vinculosNaPraca: s.inventario.filter((x) => !x.semAlocacao).length,
      notasSemAlocacao: s.inventario.filter((x) => x.semAlocacao).length,
      eventos: s.eventos.length,
      eventosTotal: s.eventosTotal,
    };
    const vistas = s.alteracoesVistas;
    await db.$transaction(async (tx) => {
      await tx.publicacaoPlanilha.update({
        where: { id: publicacaoId },
        data: {
          situacao: externo !== null ? 'PUBLICADA' : 'GERADA_LOCAL',
          concluidoEm: agora(),
          instanteSnapshot: s?.instante ?? agora(),
          alteracoesIncluidas: vistas.length,
          registros,
          nomeArquivo: nome,
          hashArquivo: hash,
          tamanhoBytes: conteudo.length,
          destino: externo !== null ? 'PASTA' : 'LOCAL',
          identificacaoPublicacao: externo?.identificacao ?? resultadoLocal.identificacao,
          versaoAnteriorPreservada: externo?.versaoAnterior ?? resultadoLocal.versaoAnterior,
        },
      });
      if (vistas.length > 0) await tx.$executeRaw`DELETE FROM alteracao_planilha WHERE id = ANY(${vistas.map((v) => BigInt(v))}::bigint[])`;
      await tx.$executeRaw`
        UPDATE controle_planilha SET publicando_desde = NULL, publicando_por = NULL, falhas_seguidas = 0, proxima_tentativa_em = NULL,
               ultima_falha = NULL, ultima_falha_em = NULL
         WHERE escopo_id = ${escopoId}::uuid AND publicando_por = ${token}`;
    });
    return { situacao: externo !== null ? 'PUBLICADA' : 'GERADA_LOCAL', versao, erro: null, arquivoLocal: join(local, nome) };
  } catch (erro) {
    const mensagem = (erro instanceof Error ? erro.message : String(erro)).slice(0, 500);
    await db.$transaction(async (tx) => {
      await tx.publicacaoPlanilha.update({
        where: { id: publicacaoId },
        data: { situacao: 'FALHOU', concluidoEm: agora(), erro: mensagem, instanteSnapshot: s?.instante ?? null, alteracoesIncluidas: s?.alteracoesVistas.length ?? 0 },
      });
      const [c] = await tx.$queryRaw<{ falhas: number }[]>`SELECT falhas_seguidas AS falhas FROM controle_planilha WHERE escopo_id = ${escopoId}::uuid FOR UPDATE`;
      const falhas = (c?.falhas ?? 0) + 1;
      const espera = Math.min(30_000 * 2 ** Math.min(falhas - 1, 6), 30 * 60_000);
      // Destino com versão mais nova (por exemplo, banco restaurado de um backup): a numeração avança além dela.
      if (erro instanceof VersaoAntigaError) await tx.$executeRaw`UPDATE controle_planilha SET versao_atual = GREATEST(versao_atual, ${erro.publicada}) WHERE escopo_id = ${escopoId}::uuid`;
      await tx.$executeRaw`
        UPDATE controle_planilha SET publicando_desde = NULL, publicando_por = NULL, falhas_seguidas = ${falhas},
               proxima_tentativa_em = ${new Date(agora().getTime() + espera)}, ultima_falha = ${mensagem}, ultima_falha_em = ${agora()}
         WHERE escopo_id = ${escopoId}::uuid AND publicando_por = ${token}`;
    });
    return { situacao: 'FALHOU', versao, erro: mensagem, arquivoLocal: null };
  }
}

/** Escopos com publicação devida: alterações agrupadas há tempo suficiente ou reconciliação vencida. */
export async function escoposDevidos(db: Banco, config: ConfigPlanilha, agora: Date): Promise<{ escopoId: string; motivo: MotivoPublicacao }[]> {
  const agrupar = new Date(agora.getTime() - config.agruparMs);
  const limiteEspera = new Date(agora.getTime() - config.agruparMs * 5);
  const reconciliar = new Date(agora.getTime() - config.reconciliarMs);
  const linhas = await db.$queryRaw<{ escopo_id: string; pendente: boolean }[]>`
    SELECT e.id::text AS escopo_id,
           EXISTS (SELECT 1 FROM alteracao_planilha a WHERE a.escopo_id = e.id) AS pendente
      FROM escopo e
      LEFT JOIN controle_planilha c ON c.escopo_id = e.id
     WHERE e.ativo AND NOT e.demonstracao
       AND (c.proxima_tentativa_em IS NULL OR c.proxima_tentativa_em <= ${agora})
       AND (
         (EXISTS (SELECT 1 FROM alteracao_planilha a WHERE a.escopo_id = e.id)
          AND ((SELECT max(a.criado_em) FROM alteracao_planilha a WHERE a.escopo_id = e.id) <= ${agrupar}
               OR (SELECT min(a.criado_em) FROM alteracao_planilha a WHERE a.escopo_id = e.id) <= ${limiteEspera}))
         OR NOT EXISTS (SELECT 1 FROM publicacao_planilha p WHERE p.escopo_id = e.id AND p.situacao IN ('PUBLICADA', 'GERADA_LOCAL') AND p.concluido_em > ${reconciliar})
       )
     ORDER BY e.id`;
  return linhas.map((l) => ({ escopoId: l.escopo_id, motivo: l.pendente ? 'ALTERACAO' : 'RECONCILIACAO' }));
}
