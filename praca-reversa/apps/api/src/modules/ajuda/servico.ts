import {
  PASSOS_TUTORIAL,
  VERSAO_TUTORIAL,
  type AtualizarTutorial,
  type BaseResultado,
  type Escopo,
  type ExemploTutorial,
  type PreferenciaTutorial,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';

type Db = Banco | Transacao;

/**
 * Preferência do tutorial (etapa 10), por usuário. Sem registro = nunca
 * oferecido. Um percurso de versão nova volta a ser oferecido a quem concluiu
 * ou adiou o anterior.
 */
export async function lerPreferencia(db: Db, usuarioId: string): Promise<PreferenciaTutorial> {
  const p = await db.preferenciaUsuario.findUnique({ where: { usuarioId } });
  if (!p || p.tutorialVersao < VERSAO_TUTORIAL) return { state: 'NAO_INICIADO', step: null, version: VERSAO_TUTORIAL, updatedAt: p?.atualizadoEm.toISOString() ?? null };
  return { state: p.tutorialSituacao, step: p.tutorialPasso, version: p.tutorialVersao, updatedAt: p.atualizadoEm.toISOString() };
}

export async function gravarPreferencia(db: Db, usuarioId: string, dados: AtualizarTutorial, agora: Date): Promise<PreferenciaTutorial> {
  const passo = dados.state === 'INTERROMPIDO' ? Math.min(dados.step ?? 1, PASSOS_TUTORIAL) : null;
  const valores = { tutorialSituacao: dados.state, tutorialPasso: passo, tutorialVersao: VERSAO_TUTORIAL, atualizadoEm: agora };
  await db.preferenciaUsuario.upsert({ where: { usuarioId }, create: { usuarioId, ...valores }, update: valores });
  return lerPreferencia(db, usuarioId);
}

interface LinhaExemplo {
  produto_id: string;
  sku: string;
  descricao: string;
  unidade: string;
  palete_id: string;
  palete_codigo: string;
  posicao_codigo: string | null;
  paletes: bigint;
  saldo: boolean;
  observado: boolean;
  declarado: boolean;
  documento: boolean;
}

/**
 * Exemplo real do escopo ativo para o primeiro percurso (somente leitura):
 * um SKU com saldo validado num palete com posição, de preferência um que
 * aparece em mais de um palete ou base (para mostrar que o mesmo SKU pode
 * estar em vários lugares). Sem saldo validado, um palete com posição; sem
 * palete, nenhum exemplo (o tutorial oferece outro próximo passo).
 */
export async function exemploTutorial(db: Banco, escopo: Escopo, agora: Date): Promise<ExemploTutorial> {
  const [p] = await db.$queryRaw<LinhaExemplo[]>`
    WITH com_saldo AS (
      SELECT sg.produto_id, s.palete_id, s.quantidade, pa.codigo AS palete_codigo, pos.codigo AS posicao_codigo
        FROM saldo_estoque s
        JOIN segmento_estoque sg ON sg.id = s.segmento_id
        JOIN palete pa ON pa.id = s.palete_id
        JOIN posicao pos ON pos.id = pa.posicao_id
       WHERE s.escopo_id = ${escopo.id}::uuid AND s.quantidade > 0 AND pa.arquivado_em IS NULL AND pa.estado_fluxo::text <> 'EXPEDIDO'
    ), candidatos AS (
      SELECT produto_id FROM com_saldo GROUP BY produto_id ORDER BY count(DISTINCT palete_id) DESC, produto_id LIMIT 200
    ), lugares AS (
      SELECT c.produto_id,
             (SELECT count(DISTINCT x.palete_id) FROM (
                SELECT cs.palete_id FROM com_saldo cs WHERE cs.produto_id = c.produto_id
                UNION SELECT d.palete_id FROM item_declarado d JOIN palete pd ON pd.id = d.palete_id
                       WHERE d.escopo_id = ${escopo.id}::uuid AND d.produto_id = c.produto_id AND pd.arquivado_em IS NULL
                UNION SELECT se.palete_id FROM observacao_conferencia o JOIN sessao_conferencia se ON se.id = o.sessao_id
                       WHERE o.escopo_id = ${escopo.id}::uuid AND o.produto_id = c.produto_id AND o.removida_em IS NULL AND se.situacao::text = 'CONCLUIDA'
             ) x) AS paletes,
             EXISTS (SELECT 1 FROM observacao_conferencia o JOIN sessao_conferencia se ON se.id = o.sessao_id
                      WHERE o.escopo_id = ${escopo.id}::uuid AND o.produto_id = c.produto_id AND o.removida_em IS NULL AND se.situacao::text = 'CONCLUIDA') AS observado,
             EXISTS (SELECT 1 FROM item_declarado d WHERE d.escopo_id = ${escopo.id}::uuid AND d.produto_id = c.produto_id) AS declarado,
             EXISTS (SELECT 1 FROM linha_documento_devolucao l WHERE l.escopo_id = ${escopo.id}::uuid AND l.produto_id = c.produto_id) AS documento
        FROM candidatos c
    )
    SELECT pr.id::text AS produto_id, pr.sku, pr.descricao, pr.unidade_canonica AS unidade,
           cs.palete_id::text, cs.palete_codigo, cs.posicao_codigo, l.paletes, true AS saldo, l.observado, l.declarado, l.documento
      FROM lugares l
      JOIN produto pr ON pr.id = l.produto_id
      JOIN LATERAL (SELECT * FROM com_saldo cs WHERE cs.produto_id = l.produto_id ORDER BY cs.quantidade DESC, cs.palete_codigo LIMIT 1) cs ON true
     ORDER BY l.paletes DESC, (l.observado::int + l.declarado::int + l.documento::int) DESC, pr.sku
     LIMIT 1`;
  const consultedAt = agora.toISOString();
  if (p) {
    const bases: BaseResultado[] = ['SALDO_VALIDADO'];
    if (p.observado) bases.push('OBSERVADO');
    if (p.declarado) bases.push('DECLARADO_PALETE');
    if (p.documento) bases.push('DOCUMENTO');
    return {
      kind: 'PRODUTO',
      demo: escopo.demo,
      product: { sku: p.sku, description: p.descricao, unit: p.unidade },
      pallet: { id: p.palete_id, code: p.palete_codigo, positionCode: p.posicao_codigo },
      occurrences: { pallets: Number(p.paletes), bases },
      reason: null,
      consultedAt,
    };
  }
  // Sem saldo validado: um palete (de preferência com endereço) para pesquisar pelo código.
  const palete = await db.palete.findFirst({
    where: { escopoId: escopo.id, arquivadoEm: null, estadoFluxo: { not: 'EXPEDIDO' } },
    orderBy: [{ posicaoId: { sort: 'asc', nulls: 'last' } }, { codigo: 'asc' }],
    select: { id: true, codigo: true, posicao: { select: { codigo: true } } },
  });
  if (palete) {
    return {
      kind: 'PALETE',
      demo: escopo.demo,
      product: null,
      pallet: { id: palete.id, code: palete.codigo, positionCode: palete.posicao?.codigo ?? null },
      occurrences: { pallets: 1, bases: ['PALETE'] },
      reason: 'Ainda não há produto com saldo validado neste escopo: o exemplo usa o código de um palete.',
      consultedAt,
    };
  }
  return {
    kind: 'NENHUM',
    demo: escopo.demo,
    product: null,
    pallet: null,
    occurrences: { pallets: 0, bases: [] },
    reason: 'Nenhum palete cadastrado neste escopo ainda.',
    consultedAt,
  };
}
