/**
 * Base comum dos painéis (operação DHL e cliente): estoque atual por conteúdo
 * do palete, lido numa única leitura consistente. Nada é copiado para tabela
 * de painel; tudo vem dos registros que alimentam o mapa e os cadastros.
 *
 * Regras (docs/INDICADORES.md, seção Painéis):
 * - estoque atual = paletes na praça (não arquivados, EM_ESTOQUE ou RESERVADO);
 *   cada palete conta uma vez, mesmo com várias NFs;
 * - conteúdo = vínculo NF × palete ATIVO (inventário) ou conteúdo registrado
 *   ATIVO; versões encerradas não entram;
 * - volumes do conteúdo = contagem vigente (a mais recente) quando houver;
 *   senão o informado no inventário — nunca previsto + contado; informado
 *   fracionário não é arredondado (fica "não informado");
 * - volumes expedidos pelos painéis saem do atual (P e E por janela vêm dos
 *   eventos `evento_volumes_janela`);
 * - documento = identidade fiscal (tipo, número e Delivery/remetente): o
 *   mesmo número com remetentes diferentes são documentos diferentes.
 */
import { rotuloEnderecoOperacional, type FullMisto } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { identidadeDocumento } from '../importacao/identidade.js';
import { LINHA_VIGENTE } from '../importacao/linhas-vigentes.js';
import type { CamposRelogio } from '../paletes/relogio.js';

type Db = Banco | Transacao;

export const SEM_ENDERECO = 'Sem endereço confirmado';

export interface SomaJanela {
  separado: number;
  estornoSeparado: number;
  expedido: number;
  estornoExpedido: number;
}

/** P (separado aguardando) e E (expedido) a partir das somas dos eventos. */
export function pe(s: SomaJanela): { p: number; e: number } {
  const e = s.expedido - s.estornoExpedido;
  return { p: s.separado - s.estornoSeparado - e, e };
}

export interface ConteudoBase {
  alvo: 'VINCULO' | 'CONTEUDO';
  id: string;
  paleteId: string;
  tipo: string | null;
  numero: string | null;
  delivery: string | null;
  remetente: string | null;
  /** Identidade documental (nula sem número de documento). */
  identidade: string | null;
  /** PALLET FULL da planilha = FRACIONADO: o palete nunca é tratado como full por ter uma nota só. */
  fracionado: boolean;
  declarado: number | null;
  declaradoInvalido: boolean;
  contado: number | null;
  /** Contado quando houver; senão informado. */
  base: number | null;
  basis: 'CONTADO' | 'INFORMADO' | null;
  criadoEm: Date;
  porJanela: Map<string, SomaJanela>;
  /** Separado + expedido vigentes em todas as janelas (compromisso). */
  comprometido: number;
  /** Expedido vigente em todas as janelas. */
  expedido: number;
  /** Base − expedido; nulo sem base. */
  atual: number | null;
}

export interface PaleteBase extends CamposRelogio {
  id: string;
  codigo: string;
  posicaoId: string | null;
  posicaoCodigo: string | null;
  /** Endereço operacional confirmado ("15 - A120", "GR9"). */
  endereco: string | null;
  rua: string;
  conteudos: ConteudoBase[];
  /** Linha vigente do inventário sem número de documento neste palete. */
  semDocumento: boolean;
  tipoPalete: FullMisto;
  criadoEm: Date;
}

export interface BasePainel {
  paletes: PaleteBase[];
  paletePorId: Map<string, PaleteBase>;
  conteudos: ConteudoBase[];
  /** Conteúdos por id (vínculo ou conteúdo registrado). */
  conteudoPorId: Map<string, ConteudoBase>;
}

/** Volumes informados: só inteiros (sem arredondar fração). */
export function volumesInteiros(texto: string | null): {
  valor: number | null;
  invalido: boolean;
} {
  if (texto === null) return { valor: null, invalido: false };
  const m = /^(\d+)(?:\.0+)?$/.exec(texto.trim());
  if (!m?.[1]) return { valor: null, invalido: true };
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? { valor: n, invalido: false } : { valor: null, invalido: true };
}

/** Lê o estoque atual do escopo (paletes na praça, conteúdos ativos, contagens e eventos de volumes). */
export async function carregarBase(db: Db, escopoId: string): Promise<BasePainel> {
  const paletes = await db.$queryRaw<
    {
      id: string;
      codigo: string;
      posicao_id: string | null;
      posicao_codigo: string | null;
      endereco: string | null;
      rua: string | null;
      criado_em: Date;
      relogio_inicio_em: Date;
      relogio_inicio_origem: string;
      ultima_movimentacao_em: Date | null;
      ultima_movimentacao_tipo: string | null;
      ultima_reconferencia_em: Date | null;
      ultima_reconferencia_origem: string | null;
      reconferencia_exigida_em: Date | null;
      reconferencia_exigida_motivo: string | null;
      estado_fluxo: string;
    }[]
  >`
    SELECT p.id::text, p.codigo, p.posicao_id::text, pos.codigo AS posicao_codigo,
           CASE WHEN ep.situacao = 'CONFIRMADO' THEN ep.endereco END AS endereco,
           coalesce(nullif(btrim(el.nome_operacional), ''), el.rotulo) AS rua,
           p.criado_em, p.relogio_inicio_em, p.relogio_inicio_origem, p.ultima_movimentacao_em, p.ultima_movimentacao_tipo,
           p.ultima_reconferencia_em, p.ultima_reconferencia_origem, p.reconferencia_exigida_em, p.reconferencia_exigida_motivo, p.estado_fluxo::text
      FROM palete p
      LEFT JOIN posicao pos ON pos.id = p.posicao_id
      LEFT JOIN endereco_posicao ep ON ep.posicao_id = pos.id
      LEFT JOIN fileira f ON f.id = pos.fileira_id
      LEFT JOIN elemento_layout el ON el.layout_id = f.layout_id AND el.codigo = f.bloco_codigo
     WHERE p.escopo_id = ${escopoId}::uuid AND p.arquivado_em IS NULL AND p.estado_fluxo::text IN ('EM_ESTOQUE', 'RESERVADO')
     ORDER BY p.codigo`;
  const conteudos = await db.$queryRaw<
    {
      alvo: 'VINCULO' | 'CONTEUDO';
      id: string;
      palete_id: string;
      tipo: string | null;
      numero: string | null;
      delivery: string | null;
      remetente: string | null;
      identidade: string | null;
      fracionado: boolean;
      declarado: string | null;
      criado_em: Date;
    }[]
  >`
    SELECT 'VINCULO' AS alvo, v.id::text, v.palete_id::text, v.tipo_documento AS tipo, v.numero_documento AS numero, v.delivery,
           li.remetente, v.identidade_documento AS identidade, upper(btrim(coalesce(v.pallet_full, ''))) = 'FRACIONADO' AS fracionado, v.volumes::text AS declarado, v.criado_em
      FROM vinculo_documento_palete v
      JOIN palete p ON p.id = v.palete_id
      JOIN linha_inventario li ON li.id = v.linha_inventario_id
     WHERE v.escopo_id = ${escopoId}::uuid AND v.situacao = 'ATIVO' AND p.arquivado_em IS NULL AND p.estado_fluxo::text IN ('EM_ESTOQUE', 'RESERVADO')
    UNION ALL
    SELECT 'CONTEUDO', c.id::text, c.palete_id::text, c.tipo_documento, c.numero_documento, c.delivery, c.remetente, NULL, false, NULL, c.criado_em
      FROM conteudo_palete c
      JOIN palete p ON p.id = c.palete_id
     WHERE c.escopo_id = ${escopoId}::uuid AND c.situacao = 'ATIVO' AND p.arquivado_em IS NULL AND p.estado_fluxo::text IN ('EM_ESTOQUE', 'RESERVADO')
     ORDER BY 3, 5 NULLS LAST, 2`;
  const contagens = await db.$queryRaw<{ alvo: string; volumes: number }[]>`
    SELECT DISTINCT ON (coalesce(conteudo_id, vinculo_id)) coalesce(conteudo_id, vinculo_id)::text AS alvo, volumes_contados AS volumes
      FROM contagem_volumes WHERE escopo_id = ${escopoId}::uuid
     ORDER BY coalesce(conteudo_id, vinculo_id), registrada_em DESC, id DESC`;
  const somas = await db.$queryRaw<
    {
      alvo: string;
      janela_id: string;
      sep: bigint;
      est_sep: bigint;
      exp: bigint;
      est_exp: bigint;
    }[]
  >`
    SELECT coalesce(vinculo_id, conteudo_id)::text AS alvo, janela_id::text,
           coalesce(sum(volumes) FILTER (WHERE tipo = 'SEPARACAO'), 0) AS sep,
           coalesce(sum(volumes) FILTER (WHERE tipo = 'ESTORNO_SEPARACAO'), 0) AS est_sep,
           coalesce(sum(volumes) FILTER (WHERE tipo = 'EXPEDICAO'), 0) AS exp,
           coalesce(sum(volumes) FILTER (WHERE tipo = 'ESTORNO_EXPEDICAO'), 0) AS est_exp
      FROM evento_volumes_janela WHERE escopo_id = ${escopoId}::uuid GROUP BY 1, 2`;
  const semDocumento = new Set(
    (
      await db.$queryRaw<{ palete_id: string }[]>`
        SELECT DISTINCT li.palete_id::text FROM linha_inventario li JOIN inventario_referencia i ON i.id = li.inventario_id
         WHERE li.escopo_id = ${escopoId}::uuid AND li.numero_documento IS NULL AND i.situacao = 'ATIVO' AND ${LINHA_VIGENTE}`
    ).map((l) => l.palete_id),
  );

  const contadoPor = new Map(contagens.map((c) => [c.alvo, c.volumes]));
  const somasPor = new Map<string, Map<string, SomaJanela>>();
  for (const s of somas) {
    const m = somasPor.get(s.alvo) ?? new Map<string, SomaJanela>();
    m.set(s.janela_id, {
      separado: Number(s.sep),
      estornoSeparado: Number(s.est_sep),
      expedido: Number(s.exp),
      estornoExpedido: Number(s.est_exp),
    });
    somasPor.set(s.alvo, m);
  }

  const lista: ConteudoBase[] = conteudos.map((c) => {
    const declarado = volumesInteiros(c.declarado);
    const contado = contadoPor.get(c.id) ?? null;
    const base = contado ?? declarado.valor;
    const porJanela = somasPor.get(c.id) ?? new Map<string, SomaJanela>();
    let comprometido = 0;
    let expedido = 0;
    for (const s of porJanela.values()) {
      const { p, e } = pe(s);
      comprometido += p + e;
      expedido += e;
    }
    const identidade = c.identidade ?? (c.numero === null ? null : identidadeDocumento(c.tipo, c.numero, c.delivery, c.remetente));
    return {
      alvo: c.alvo,
      id: c.id,
      paleteId: c.palete_id,
      tipo: c.tipo,
      numero: c.numero,
      delivery: c.delivery,
      remetente: c.remetente,
      identidade,
      fracionado: c.fracionado,
      declarado: declarado.valor,
      declaradoInvalido: declarado.invalido,
      contado,
      base,
      basis: contado !== null ? 'CONTADO' : declarado.valor !== null ? 'INFORMADO' : null,
      criadoEm: c.criado_em,
      porJanela,
      comprometido,
      expedido,
      atual: base === null ? null : Math.max(base - expedido, 0),
    };
  });

  const porPalete = new Map<string, ConteudoBase[]>();
  for (const c of lista) porPalete.set(c.paleteId, [...(porPalete.get(c.paleteId) ?? []), c]);
  const base: PaleteBase[] = paletes.map((p) => {
    const cs = porPalete.get(p.id) ?? [];
    const ids = new Set(cs.flatMap((c) => (c.identidade === null ? [] : [c.identidade])));
    const naoIdentificado = semDocumento.has(p.id) || cs.some((c) => c.identidade === null);
    const tipoPalete: FullMisto = ids.size >= 2 ? 'MISTO' : ids.size === 1 && !naoIdentificado && !cs.some((c) => c.fracionado) ? 'FULL' : 'NAO_INFORMADO';
    return {
      id: p.id,
      codigo: p.codigo,
      posicaoId: p.posicao_id,
      posicaoCodigo: p.posicao_codigo,
      endereco: p.endereco === null ? null : rotuloEnderecoOperacional(p.endereco),
      rua: p.posicao_id === null ? SEM_ENDERECO : (p.rua ?? SEM_ENDERECO),
      conteudos: cs,
      semDocumento: semDocumento.has(p.id),
      tipoPalete,
      criadoEm: p.criado_em,
      relogioInicioEm: p.relogio_inicio_em,
      relogioInicioOrigem: p.relogio_inicio_origem,
      ultimaMovimentacaoEm: p.ultima_movimentacao_em,
      ultimaMovimentacaoTipo: p.ultima_movimentacao_tipo,
      ultimaReconferenciaEm: p.ultima_reconferencia_em,
      ultimaReconferenciaOrigem: p.ultima_reconferencia_origem,
      reconferenciaExigidaEm: p.reconferencia_exigida_em,
      reconferenciaExigidaMotivo: p.reconferencia_exigida_motivo,
      arquivadoEm: null,
      estadoFluxo: p.estado_fluxo,
    };
  });
  return {
    paletes: base,
    paletePorId: new Map(base.map((p) => [p.id, p])),
    conteudos: lista,
    conteudoPorId: new Map(lista.map((c) => [c.id, c])),
  };
}

/** Conteúdo que ainda está na praça (expedido por inteiro sai do estoque atual). */
export function noEstoque(c: ConteudoBase): boolean {
  return !(c.expedido > 0 && c.atual === 0);
}

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Contém (sem acentos, maiúsculas, sem separadores): "15-a120" encontra "15 - A120". */
export function contem(valor: string | null, termo: string | undefined): boolean {
  if (termo === undefined) return true;
  if (valor === null) return false;
  return normalizar(valor).includes(normalizar(termo));
}
