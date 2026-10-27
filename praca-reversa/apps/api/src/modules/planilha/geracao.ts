/**
 * Geração local de uma revisão da planilha (26 out. 2026), dentro da
 * concessão do escopo (`controle_planilha`: um trabalho por vez, com
 * expiração; um processo interrompido é retomado depois do prazo e a
 * tentativa que ficou "GERANDO" é registrada como falha).
 *
 * 1. Snapshot único (dados.ts) → arquivos montados → validados (validar.ts).
 * 2. Gravação na pasta local de versões (temporário + troca atômica +
 *    releitura) ANTES de registrar: o registro nunca aponta para arquivo
 *    ausente; arquivo de tentativa que falhou é removido.
 * 3. Numa transação: revisão = anterior + 1 (só se a concessão continua deste
 *    processo), geração GERADA e remoção das marcações incluídas no snapshot.
 *    Alteração confirmada depois do snapshot fica para a revisão seguinte.
 * 4. Falha: nada substituído, nenhuma revisão ocupada, espera crescente
 *    (30 s, dobrando até 30 min).
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Banco } from '../../db/cliente.js';
import type { ConfigPlanilha } from '../protecao/configuracao.js';
import { SUFIXO_PRE_SUBSTITUICAO, aplicarRetencaoLocal, gravarLocal, pastaDoEscopo, pastaVersoes } from './arquivos.js';
import { lerSnapshot } from './dados.js';
import { baseDoNome, montarArquivos } from './montar.js';
import { validarArquivos } from './validar.js';

export type MotivoGeracao = 'ALTERACAO' | 'RECONCILIACAO' | 'MANUAL' | 'PRE_SUBSTITUICAO';

/** Pontos de falha simulada (só testes). */
export interface Simulacao {
  falharLeitura?: boolean;
  corromper?: boolean;
  falharDestino?: boolean;
}

export interface ResultadoGeracao {
  situacao: 'GERADA' | 'FALHOU';
  revisao: number | null;
  erro: string | null;
}

export const esperaDaFalha = (falhas: number) => Math.min(30_000 * 2 ** Math.min(Math.max(falhas - 1, 0), 6), 30 * 60_000);
export const mensagemDe = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro)).slice(0, 500);

export interface Concessao {
  token: string;
  revisaoDados: number;
  revisaoPublicada: number;
}

/** Concessão exclusiva do escopo (ou `null` se outro trabalho está em andamento). */
export async function reivindicar(db: Banco, escopoId: string, concessaoMs: number, agora: Date): Promise<Concessao | null> {
  const token = randomUUID();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO controle_planilha (escopo_id) VALUES (${escopoId}::uuid) ON CONFLICT DO NOTHING`;
    const limite = new Date(agora.getTime() - concessaoMs);
    const [r] = await tx.$queryRaw<{ revisao_dados: number; revisao_publicada: number }[]>`
      UPDATE controle_planilha SET publicando_desde = ${agora}, publicando_por = ${token}
       WHERE escopo_id = ${escopoId}::uuid AND (publicando_desde IS NULL OR publicando_desde < ${limite})
       RETURNING revisao_dados, revisao_publicada`;
    if (!r) return null;
    // Trabalho anterior interrompido (reinício/queda): fica registrado como falha; nada foi substituído.
    const interrompido = 'Interrompido antes de concluir (reinício ou queda do processo); nada foi substituído.';
    await tx.$executeRaw`UPDATE geracao_planilha SET situacao = 'FALHOU', concluido_em = ${agora}, erro = ${interrompido} WHERE escopo_id = ${escopoId}::uuid AND situacao = 'GERANDO'`;
    await tx.$executeRaw`UPDATE envio_externo SET situacao = 'FALHOU', concluido_em = ${agora}, erro = ${interrompido} WHERE escopo_id = ${escopoId}::uuid AND tipo = 'PLANILHA' AND situacao = 'ENVIANDO'`;
    return { token, revisaoDados: r.revisao_dados, revisaoPublicada: r.revisao_publicada };
  });
}

export async function liberar(db: Banco, escopoId: string, token: string): Promise<void> {
  await db.$executeRaw`UPDATE controle_planilha SET publicando_desde = NULL, publicando_por = NULL WHERE escopo_id = ${escopoId}::uuid AND publicando_por = ${token}`;
}

/** Gera a revisão seguinte do escopo (a concessão já é deste processo). */
export async function gerar(
  db: Banco,
  escopoId: string,
  config: ConfigPlanilha,
  concessao: Concessao,
  opcoes: { motivo: MotivoGeracao; solicitadoPorId?: string | null; agora: () => Date; simular?: Simulacao },
): Promise<ResultadoGeracao> {
  const { agora } = opcoes;
  const id = randomUUID();
  await db.geracaoPlanilha.create({ data: { id, escopoId, situacao: 'GERANDO', motivo: opcoes.motivo, solicitadoPorId: opcoes.solicitadoPorId ?? null, iniciadoEm: agora() } });
  const gravados: string[] = [];
  let registrado = false;
  try {
    if (opcoes.simular?.falharLeitura) throw new Error('Leitura do banco indisponível (simulada).');
    const s = await lerSnapshot(db, escopoId);
    const revisao = concessao.revisaoDados + 1;
    const base = baseDoNome(s.escopo.unidade, s.escopo.cliente);
    const destino = s.escopo.demonstracao || config.destino === null ? null : { descricao: config.destino.descricao, independente: config.destino.independente, motivo: config.destino.motivo };
    const pre = opcoes.motivo === 'PRE_SUBSTITUICAO';
    const rotulo = `${s.loteAtivo?.codigo ?? 'sem-lote'}${pre ? SUFIXO_PRE_SUBSTITUICAO : ''}`;
    const arquivos = montarArquivos(s, { revisao, geradoEm: agora(), rotulo, config, destino }, base);
    if (opcoes.simular?.corromper && arquivos[0]) arquivos[0].buffer = arquivos[0].buffer.subarray(0, Math.floor(arquivos[0].buffer.length / 2));
    validarArquivos(arquivos, s, revisao);
    const pasta = pastaVersoes(config, escopoId);
    const registro = arquivos.map((a) => {
      const caminho = join(pasta, a.nome);
      gravados.push(caminho);
      const g = gravarLocal(caminho, a.buffer);
      return { papel: a.papel, nome: a.nome, sha256: g.sha256, tamanho: g.tamanho, eventos: a.eventos.length };
    });
    const principal = registro[0];
    if (!principal) throw new Error('Arquivo principal ausente.');
    const t = s.totais;
    await db.$transaction(async (tx) => {
      const r = await tx.$executeRaw`
        UPDATE controle_planilha SET revisao_dados = ${revisao}, falhas_seguidas = 0, proxima_tentativa_em = NULL, ultima_falha = NULL, ultima_falha_em = NULL
         WHERE escopo_id = ${escopoId}::uuid AND publicando_por = ${concessao.token} AND revisao_dados = ${revisao - 1}`;
      if (r !== 1) throw new Error('A concessão deste escopo passou para outro processo: nada foi registrado.');
      await tx.geracaoPlanilha.update({
        where: { id },
        data: {
          situacao: 'GERADA',
          revisao,
          concluidoEm: agora(),
          instanteDados: s.instante,
          ultimaAlteracaoEm: s.alteracoes.ultimaEm,
          alteracoesIncluidas: s.alteracoes.ids.length,
          loteAtivo: s.loteAtivo === null ? null : `${s.loteAtivo.codigo} · ${s.loteAtivo.descricao}`.slice(0, 300),
          preSubstituicao: pre,
          registros: { linhas: t.linhas, ...t.porGrupo, paletesNaPraca: t.paletesNaPraca, volumesConhecidos: t.volumesConhecidos, estoqueSemVolume: t.estoqueSemVolume, saidasTotais: t.saidasTotais, eventos: s.eventos.length },
          arquivos: registro,
          nomeArquivo: principal.nome,
          hashArquivo: principal.sha256,
          tamanhoBytes: principal.tamanho,
        },
      });
      if (s.alteracoes.ids.length > 0) await tx.$executeRaw`DELETE FROM alteracao_planilha WHERE id = ANY(${s.alteracoes.ids.map((v) => BigInt(v))}::bigint[])`;
    });
    registrado = true;
    concessao.revisaoDados = revisao;
    // Cópia "atual" de nome estável na pasta do escopo (conveniência; a versão é a referência).
    try {
      const atual = join(pastaDoEscopo(config, escopoId), `${base}.xlsx`);
      const tmp = `${atual}.${randomUUID().slice(0, 8)}.tmp`;
      copyFileSync(join(pasta, principal.nome), tmp);
      renameSync(tmp, atual);
    } catch {
      // A versão gravada continua válida; a cópia de conveniência é refeita na próxima revisão.
    }
    const publicada = concessao.revisaoPublicada;
    aplicarRetencaoLocal(pasta, base, config.retencao, agora(), new Set([revisao, publicada]));
    return { situacao: 'GERADA', revisao, erro: null };
  } catch (erro) {
    if (!registrado) for (const g of gravados) rmSync(g, { force: true });
    const mensagem = mensagemDe(erro);
    await db.$transaction(async (tx) => {
      await tx.geracaoPlanilha.update({ where: { id }, data: { situacao: 'FALHOU', concluidoEm: agora(), erro: mensagem } });
      const [c] = await tx.$queryRaw<{ falhas: number }[]>`SELECT falhas_seguidas AS falhas FROM controle_planilha WHERE escopo_id = ${escopoId}::uuid FOR UPDATE`;
      const falhas = (c?.falhas ?? 0) + 1;
      await tx.$executeRaw`
        UPDATE controle_planilha SET falhas_seguidas = ${falhas}, proxima_tentativa_em = ${new Date(agora().getTime() + esperaDaFalha(falhas))}, ultima_falha = ${mensagem}, ultima_falha_em = ${agora()}
         WHERE escopo_id = ${escopoId}::uuid AND publicando_por = ${concessao.token}`;
    });
    return { situacao: 'FALHOU', revisao: null, erro: mensagem };
  }
}
