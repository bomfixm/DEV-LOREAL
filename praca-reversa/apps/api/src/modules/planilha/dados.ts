/**
 * Snapshot da planilha de um escopo (26 out. 2026): inventário ATIVO,
 * pendências identificadas, movimentações e situação da proteção, lidos numa
 * única transação REPEATABLE READ READ ONLY — todas as abas do mesmo instante.
 *
 * Inventário (uma linha por registro, sem duplicar o que existe em duas
 * tabelas técnicas):
 * - ESTOQUE: ocorrência ATIVA (vínculo do inventário ou conteúdo registrado)
 *   em palete na praça; quantidade atual = a dos painéis (contagem mais
 *   recente ou informado, menos saídas). Desconhecida = "Não informado";
 *   saída total registrada sai do inventário (fica em Movimentações).
 * - SEM_DOCUMENTO / SEM_CONTEUDO: linha aplicada sem número de documento, e
 *   palete na praça sem nenhum conteúdo.
 * - VALIDACAO: ocorrência fora do estoque físico (sem endereço), com motivo.
 * - PENDENTE: linha do lote ativo ainda em revisão, repetida no arquivo ou sem
 *   registro ativo — nunca com endereço ou quantidade inventados.
 * - REFERENCIA: endereço livre na fonte (o material saiu daquela posição).
 * Uma linha do lote ativo que sustenta uma ocorrência sai uma vez só, na
 * ocorrência, com a origem (inventário e linha) para rastrear.
 *
 * Falha de leitura propaga erro (nunca vira planilha vazia); escopo sem
 * registros é resultado válido.
 */
import { ROTULOS_CAUSA_REVISAO } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { calcularConferencia, ocorrenciasAtivas } from '../conteudos/estado.js';
import { ordemEndereco } from '../importacao/carga-lote.js';
import { identidadeDocumento } from '../importacao/identidade.js';
import { LINHA_VIGENTE } from '../importacao/linhas-vigentes.js';
import { carregarBase } from '../paineis/base.js';

export type GrupoLinha = 'ESTOQUE' | 'SEM_DOCUMENTO' | 'SEM_CONTEUDO' | 'VALIDACAO' | 'PENDENTE' | 'REFERENCIA';

export interface LinhaInventarioPlanilha {
  grupo: GrupoLinha;
  palete: string | null;
  delivery: string | null;
  tipo: string | null;
  numero: string | null;
  /** Quantidade conhecida (só no estoque); `null` = ver `volumesTexto`. */
  volumes: number | null;
  /** Texto quando não há número no estoque: "Não informado", "Pendente: 12 informado(s)"… */
  volumesTexto: string | null;
  remetente: string | null;
  mesAgenda: string | null;
  janela: string | null;
  /** Endereço completo ("11 - A42"); `null` = sem endereço confirmado. */
  endereco: string | null;
  documentacao: string | null;
  palletFull: string | null;
  categoria: string | null;
  dataInventario: string | null;
  situacao: string;
  pendencia: string | null;
  origemVolumes: string;
  conferencia: string | null;
  fileira: string | null;
  tipoPalete: string | null;
  produto: string | null;
  origemRegistro: string;
  referencia: string;
}

export interface TotaisInventario {
  linhas: number;
  porGrupo: Record<GrupoLinha, number>;
  paletesNaPraca: number;
  volumesConhecidos: number;
  estoqueSemVolume: number;
  saidasTotais: number;
}

export interface EventoPlanilha {
  id: string;
  em: Date;
  acao: string;
  palete: string | null;
  documento: string | null;
  antes: string | null;
  depois: string | null;
  responsavel: string;
  descricao: string;
  fonte: string;
}

export interface ResumoEnvio {
  referencia: string;
  concluidoEm: Date;
  chave: string | null;
  destino: string;
}

export interface ResumoProtecao {
  tipo: string;
  situacao: string;
  concluidoEm: Date;
  identificador: string | null;
  tamanhoBytes: bigint | null;
  destino: string | null;
  foraDoServidor: boolean;
  ambiente: string | null;
  dados: string | null;
  mensagem: string | null;
  detalhes: Record<string, unknown> | null;
}

export interface SnapshotPlanilha {
  escopo: { id: string; nome: string; unidade: string; unidadeNome: string; cliente: string; clienteNome: string; demonstracao: boolean };
  instante: Date;
  loteAtivo: { codigo: string; descricao: string; criadoEm: Date; dataConferencia: Date | null } | null;
  inventario: LinhaInventarioPlanilha[];
  totais: TotaisInventario;
  /** Todos os eventos, mais recentes primeiro (a divisão em arquivos de apoio é da montagem). */
  eventos: EventoPlanilha[];
  alteracoes: { ids: string[]; ultimaEm: Date | null };
  ultimaPlanilhaPublicada: ResumoEnvio | null;
  ultimoBackupLocal: ResumoProtecao | null;
  ultimoBackupExterno: ResumoEnvio | null;
  ultimoTesteRestauracao: ResumoProtecao | null;
}

type Tx = Banco | Transacao;
type Detalhes = Record<string, unknown>;

const ROTULO_PENDENCIA: Readonly<Record<string, string>> = {
  ...ROTULOS_CAUSA_REVISAO,
  tipo_documento_ausente: 'Tipo do documento não informado',
  remetente_ausente: 'Remetente não informado',
  documento_composto_ou_textual: 'Documento composto ou em texto',
  prefixo_endereco_normalizado: 'Endereço normalizado (prefixo)',
  documento_ausente: 'Documento não informado',
  multiplas_etiquetas_full: 'Várias etiquetas FULL',
  conferencia_a_validar: 'Data do inventário a validar',
};

const LINHA_REPETIDA = 'Linha repetida no arquivo (não somada)';
const ROTULO_MOTIVO_LINHA: Readonly<Record<string, string>> = {
  REVISAO_ENDERECO_A_VALIDAR: 'Endereço a validar',
  REVISAO_FORMULA_SEM_VALIDACAO: 'Fórmula inválida na origem',
  EM_REVISAO: 'Em revisão',
};

const CONFERENCIA_ITEM: Readonly<Record<string, string>> = {
  NAO_CONFERIDO: 'Não conferido',
  CONFERIDO: 'Conferido',
  CONFERIDO_COM_DIFERENCA: 'Conferido com diferença',
};

const ORIGEM_CONTAGEM: Readonly<Record<string, string>> = {
  CONTAGEM_FISICA: 'Contado no aplicativo',
  CONTAGEM_INFORMADA: 'Contagem informada',
  BIPAGEM: 'Lido na bipagem',
};

const dataCurta = (d: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d);
const vazio = (s: string | null | undefined): string | null => (s === null || s === undefined || s.trim() === '' ? null : s.trim());
const objeto = (v: unknown): Detalhes => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Detalhes) : {});
const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const texto = (d: Detalhes, k: string): string | null => {
  const v = d[k];
  return typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;
};

/** Data do inventário informada na linha (coluna INVENTÁRIO da fonte), como texto. */
function dataInventario(extras: unknown): string | null {
  const c = objeto(objeto(extras).conferencia);
  const data = texto(c, 'data');
  if (data !== null && /^\d{4}-\d{2}-\d{2}/.test(data)) return `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;
  return vazio(texto(c, 'texto'));
}

/** Pendências de revisão de uma linha (códigos da preparação), em texto curto. */
function pendenciasDaLinha(extras: unknown, soBloqueio: boolean): string[] {
  const e = objeto(extras);
  return textos(e.pendencias)
    .filter((c) => c !== 'conferencia_sem_data' && (!soBloqueio || c in ROTULOS_CAUSA_REVISAO))
    .map((c) => ROTULO_PENDENCIA[c] ?? c.replace(/_/g, ' '));
}

/** Linha alocada por decisão de revisão: "Alocado por decisão (21/10): causas". */
function decisaoDaLinha(extras: unknown): string | null {
  const d = objeto(objeto(extras).decisaoRevisao);
  const causas = textos(d.causas).map((c) => ROTULO_PENDENCIA[c] ?? c.replace(/_/g, ' '));
  if (causas.length === 0) return null;
  const dia = /(\d{2}\/\d{2})/.exec(texto(d, 'decisao') ?? '')?.[1];
  return `Alocado por decisão de revisão${dia ? ` (${dia})` : ''}: ${causas.join(', ')}`;
}

function marcadorFull(palletFull: string | null, extras: unknown): string | null {
  const etiquetas = textos(objeto(extras).etiquetasFull);
  const base = vazio(palletFull);
  if (base !== null) return base;
  return etiquetas.length > 0 ? etiquetas.join(' ') : null;
}

interface LinhaOrigem {
  id: string;
  linha_arquivo: number;
  inventario: string;
  remetente: string | null;
  mes_agenda: string | null;
  janela: string | null;
  documentacao: string | null;
  pallet_full: string | null;
  categoria: string | null;
  extras: unknown;
}

const TIPO_PALETE: Readonly<Record<string, string>> = { FULL: 'Full (uma nota)', MISTO: 'Misto (várias notas)', NAO_INFORMADO: 'Não informado' };

/** Lê o snapshot do escopo. */
export async function lerSnapshot(db: Banco, escopoId: string): Promise<SnapshotPlanilha> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const [{ instante }] = (await tx.$queryRaw<{ instante: Date }[]>`SELECT now() AS instante`) as [{ instante: Date }];
      const e = await tx.escopo.findUniqueOrThrow({ where: { id: escopoId }, include: { unidade: true, cliente: true } });
      const lote = await tx.inventarioReferencia.findFirst({
        where: { escopoId, situacao: 'ATIVO', origem: 'IMPORTADO' },
        orderBy: { criadoEm: 'desc' },
        select: { id: true, codigo: true, descricao: true, criadoEm: true, dataConferencia: true },
      });
      const inventario = await linhasDoInventario(tx, escopoId, lote?.id ?? null);
      const eventos = await eventosDoEscopo(tx, escopoId);
      const marcas = await tx.$queryRaw<{ id: string; criado_em: Date }[]>`SELECT id::text, criado_em FROM alteracao_planilha WHERE escopo_id = ${escopoId}::uuid ORDER BY id`;
      const envio = (tipo: string, escopo: string | null) =>
        tx.envioExterno
          .findFirst({ where: { tipo, escopoId: escopo, situacao: 'CONFIRMADO' }, orderBy: { concluidoEm: 'desc' }, select: { referencia: true, concluidoEm: true, chave: true, destino: true } })
          .then((x) => (x?.concluidoEm ? { referencia: x.referencia, concluidoEm: x.concluidoEm, chave: x.chave, destino: x.destino } : null));
      const prot = (tipo: string, situacao?: string) =>
        tx.registroProtecao.findFirst({ where: { tipo, ...(situacao ? { situacao } : {}) }, orderBy: { concluidoEm: 'desc' } }).then((x) =>
          x === null
            ? null
            : { tipo: x.tipo, situacao: x.situacao, concluidoEm: x.concluidoEm, identificador: x.identificador, tamanhoBytes: x.tamanhoBytes, destino: x.destino, foraDoServidor: x.foraDoServidor, ambiente: x.ambiente, dados: x.dados, mensagem: x.mensagem, detalhes: objeto(x.detalhes) },
        );
      // Uma consulta por vez: a transação usa uma única conexão.
      const ultimaPlanilhaPublicada = await envio('PLANILHA', escopoId);
      const ultimoBackupExterno = await envio('BACKUP', null);
      const ultimoBackupLocal = await prot('BACKUP', 'VERIFICADO');
      const ultimoTesteRestauracao = await prot('TESTE_RESTAURACAO');
      return {
        escopo: { id: e.id, nome: e.nome, unidade: e.unidade.codigo, unidadeNome: e.unidade.nome, cliente: e.cliente.codigo, clienteNome: e.cliente.nome, demonstracao: e.demonstracao },
        instante,
        loteAtivo: lote === null ? null : { codigo: lote.codigo, descricao: lote.descricao, criadoEm: lote.criadoEm, dataConferencia: lote.dataConferencia },
        ...inventario,
        eventos,
        alteracoes: { ids: marcas.map((m) => m.id), ultimaEm: marcas.reduce<Date | null>((m, x) => (m === null || x.criado_em > m ? x.criado_em : m), null) },
        ultimaPlanilhaPublicada,
        ultimoBackupLocal,
        ultimoBackupExterno,
        ultimoTesteRestauracao,
      };
    },
    { isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 180_000 },
  );
}

async function linhasDoInventario(tx: Tx, escopoId: string, loteId: string | null): Promise<{ inventario: LinhaInventarioPlanilha[]; totais: TotaisInventario }> {
  const base = await carregarBase(tx, escopoId);

  // Vínculos (ATIVO e VALIDACAO): linha própria e a linha correspondente do lote ativo (mesma identidade e endereço).
  const vinculos = await tx.$queryRaw<
    ({ id: string; situacao: string; palete_id: string; tipo: string | null; numero: string; delivery: string | null; volumes: string | null; documentacao: string | null; pallet_full: string | null; identidade: string | null; criado_em: Date } & {
      lo: LinhaOrigem;
      la: LinhaOrigem | null;
    })[]
  >`
    SELECT v.id::text, v.situacao, v.palete_id::text, v.tipo_documento AS tipo, v.numero_documento AS numero, v.delivery, v.volumes::text, v.documentacao, v.pallet_full,
           v.identidade_documento AS identidade, v.criado_em,
           json_build_object('id', lo.id, 'linha_arquivo', lo.linha_arquivo, 'inventario', io.codigo, 'remetente', lo.remetente, 'mes_agenda', lo.mes_agenda, 'janela', lo.janela_referencia,
                             'documentacao', lo.documentacao, 'pallet_full', lo.pallet_full, 'categoria', lo.categoria, 'extras', lo.extras) AS lo,
           CASE WHEN la.id IS NULL THEN NULL ELSE
           json_build_object('id', la.id, 'linha_arquivo', la.linha_arquivo, 'inventario', la.inventario, 'remetente', la.remetente, 'mes_agenda', la.mes_agenda, 'janela', la.janela_referencia,
                             'documentacao', la.documentacao, 'pallet_full', la.pallet_full, 'categoria', la.categoria, 'extras', la.extras) END AS la
      FROM vinculo_documento_palete v
      JOIN linha_inventario lo ON lo.id = v.linha_inventario_id
      JOIN inventario_referencia io ON io.id = lo.inventario_id
      LEFT JOIN LATERAL (
        SELECT l2.id, l2.linha_arquivo, i2.codigo AS inventario, l2.remetente, l2.mes_agenda, l2.janela_referencia, l2.documentacao, l2.pallet_full, l2.categoria, l2.extras
          FROM linha_inventario l2 JOIN inventario_referencia i2 ON i2.id = l2.inventario_id AND i2.situacao = 'ATIVO'
         WHERE io.situacao <> 'ATIVO' AND l2.escopo_id = v.escopo_id AND l2.acao::text = 'JA_IMPORTADO'
           AND l2.identidade_documento = v.identidade_documento AND l2.endereco_canonico = lo.endereco_canonico
         ORDER BY l2.criado_em DESC, l2.linha_arquivo LIMIT 1) la ON true
     WHERE v.escopo_id = ${escopoId}::uuid AND v.situacao IN ('ATIVO', 'VALIDACAO')`;
  const vinculoPor = new Map(vinculos.map((v) => [v.id, v]));
  const linhasRepresentadas = new Set(vinculos.flatMap((v) => [v.lo.id, ...(v.la ? [v.la.id] : [])]));

  const conteudos = await tx.$queryRaw<
    { id: string; situacao: string; palete_id: string; remetente: string; tipo: string | null; numero: string | null; delivery: string | null; descricao: string | null; origem: string; linha_arquivo: number | null; lote: string | null; criado_em: Date }[]
  >`
    SELECT c.id::text, c.situacao, c.palete_id::text, c.remetente, c.tipo_documento AS tipo, c.numero_documento AS numero, c.delivery, c.descricao, c.origem, c.linha_arquivo,
           (SELECT i.codigo FROM inventario_referencia i WHERE i.lote_importacao_id = c.lote_importacao_id LIMIT 1) AS lote, c.criado_em
      FROM conteudo_palete c WHERE c.escopo_id = ${escopoId}::uuid AND c.situacao IN ('ATIVO', 'VALIDACAO')`;
  const conteudoPor = new Map(conteudos.map((c) => [c.id, c]));

  const paletes = await tx.$queryRaw<
    { id: string; codigo: string; endereco: string | null; prefixo: string | null; fluxo: string; arquivado: boolean; exigida: Date | null; reconferida: Date | null }[]
  >`
    SELECT p.id::text, p.codigo, CASE WHEN ep.situacao = 'CONFIRMADO' THEN ep.endereco END AS endereco, CASE WHEN ep.situacao = 'CONFIRMADO' THEN ep.prefixo END AS prefixo,
           p.estado_fluxo::text AS fluxo, p.arquivado_em IS NOT NULL AS arquivado, p.reconferencia_exigida_em AS exigida, p.ultima_reconferencia_em AS reconferida
      FROM palete p LEFT JOIN endereco_posicao ep ON ep.posicao_id = p.posicao_id
     WHERE p.escopo_id = ${escopoId}::uuid`;
  const paletePor = new Map(paletes.map((p) => [p.id, p]));
  // Endereço informado pelo inventário vigente (palete sem posição confirmada no mapa).
  const informado = new Map(
    (
      await tx.$queryRaw<{ palete_id: string; endereco: string }[]>`
        SELECT DISTINCT ON (li.palete_id) li.palete_id::text, li.endereco_canonico AS endereco
          FROM linha_inventario li JOIN inventario_referencia i ON i.id = li.inventario_id
         WHERE li.escopo_id = ${escopoId}::uuid AND li.endereco_canonico IS NOT NULL AND ${LINHA_VIGENTE}
         ORDER BY li.palete_id, li.criado_em DESC, li.linha_arquivo`
    ).map((l) => [l.palete_id, l.endereco]),
  );
  const enderecoDe = (p: { id: string; endereco: string | null }) => p.endereco ?? informado.get(p.id) ?? null;
  const ondeEsta = (p: { id: string; endereco: string | null }) =>
    p.endereco !== null ? 'No palete' : informado.has(p.id) ? 'No palete (endereço informado no inventário; posição no mapa a confirmar)' : 'No palete (localização pendente)';

  const origemContagem = new Map(
    (
      await tx.$queryRaw<{ alvo: string; origem: string }[]>`
        SELECT DISTINCT ON (coalesce(conteudo_id, vinculo_id)) coalesce(conteudo_id, vinculo_id)::text AS alvo, origem
          FROM contagem_volumes WHERE escopo_id = ${escopoId}::uuid
         ORDER BY coalesce(conteudo_id, vinculo_id), registrada_em DESC, id DESC`
    ).map((c) => [c.alvo, c.origem]),
  );
  const produtos = new Map(
    (
      await tx.conteudoDocumentoPalete.findMany({
        where: { escopoId },
        select: { paleteId: true, identidadeDocumento: true, produtoNaCaixa: true, descricoes: { where: { removidaEm: null }, orderBy: { criadoEm: 'asc' }, select: { grupo: true, descricao: true } } },
      })
    ).map((c) => [`${c.paleteId}|${c.identidadeDocumento}`, [c.produtoNaCaixa, ...c.descricoes.map((d) => `${d.grupo}: ${d.descricao}`)].filter((x) => x.trim() !== '').join('; ')]),
  );
  const ocorrencias = await ocorrenciasAtivas(tx, escopoId, null);
  const conferencia = await calcularConferencia(tx, escopoId, ocorrencias, base.paletes.map((p) => p.id));

  const linhas: LinhaInventarioPlanilha[] = [];
  let saidasTotais = 0;
  const reconferenciaExigida = (paleteId: string) => {
    const p = paletePor.get(paleteId);
    return p?.exigida != null && (p.reconferida === null || p.reconferida < p.exigida);
  };

  // ESTOQUE: ocorrências ativas nos paletes da praça (a base dos painéis).
  for (const p of base.paletes) {
    const info = paletePor.get(p.id);
    const fileira = info?.prefixo ?? null;
    for (const c of p.conteudos) {
      if (c.base !== null && c.expedido > 0 && c.atual === 0) {
        saidasTotais += 1;
        continue;
      }
      const v = c.alvo === 'VINCULO' ? vinculoPor.get(c.id) : undefined;
      const r = c.alvo === 'CONTEUDO' ? conteudoPor.get(c.id) : undefined;
      const fonte = v ? (v.la ?? v.lo) : null;
      const item = conferencia.porItem.get(c.id);
      const pend = [
        fonte ? decisaoDaLinha(fonte.extras) : null,
        reconferenciaExigida(p.id) ? 'Reconferência exigida' : null,
        c.numero !== null && c.tipo === null ? 'Tipo do documento não informado' : null,
        c.declaradoInvalido && c.contado === null ? 'Volumes da fonte não inteiros (a conferir)' : null,
      ].filter((x): x is string => x !== null);
      const identidade = c.identidade ?? (c.numero === null ? null : identidadeDocumento(c.tipo, c.numero, c.delivery, c.remetente));
      linhas.push({
        grupo: 'ESTOQUE',
        palete: p.codigo,
        delivery: c.delivery,
        tipo: c.tipo,
        numero: c.numero,
        volumes: c.atual,
        volumesTexto: c.atual === null ? 'Não informado' : null,
        remetente: vazio(fonte?.remetente ?? c.remetente),
        mesAgenda: vazio(fonte?.mes_agenda),
        janela: vazio(fonte?.janela),
        endereco: enderecoDe(p),
        documentacao: vazio(fonte?.documentacao ?? v?.documentacao),
        palletFull: fonte ? marcadorFull(v?.pallet_full ?? fonte.pallet_full, fonte.extras) : null,
        categoria: vazio(fonte?.categoria),
        dataInventario: fonte ? dataInventario(fonte.extras) : null,
        situacao: `${ondeEsta(p)}${c.expedido > 0 ? ` · saída parcial de ${String(c.expedido)} volume(s)` : ''}`,
        pendencia: pend.length > 0 ? pend.join(' · ') : null,
        origemVolumes: c.contado !== null ? (ORIGEM_CONTAGEM[origemContagem.get(c.id) ?? ''] ?? 'Contagem registrada') : c.declarado !== null ? 'Informado no inventário' : 'Não informado',
        conferencia: item ? `${CONFERENCIA_ITEM[item.state] ?? item.state}${item.at ? ` em ${dataCurta(new Date(item.at))}` : ''}` : null,
        fileira,
        tipoPalete: TIPO_PALETE[p.tipoPalete] ?? null,
        produto: vazio([identidade ? produtos.get(`${p.id}|${identidade}`) : null, r?.descricao].filter((x) => x).join('; ')),
        origemRegistro: fonte
          ? `${fonte.inventario} · linha ${String(fonte.linha_arquivo)}`
          : r
            ? r.origem === 'BIPAGEM'
              ? `Bipagem${r.lote ? ` ${r.lote}` : ''}${r.linha_arquivo !== null ? ` · linha ${String(r.linha_arquivo)}` : ''}`
              : `Cadastro no aplicativo em ${dataCurta(r.criado_em)}`
            : 'Registro do aplicativo',
        referencia: c.id,
      });
    }
  }

  // VALIDACAO: fora do estoque físico; motivo e último palete conhecido do histórico.
  const emValidacao = [...vinculos.filter((v) => v.situacao === 'VALIDACAO').map((v) => v.id), ...conteudos.filter((c) => c.situacao === 'VALIDACAO').map((c) => c.id)];
  if (emValidacao.length > 0) {
    const historico = new Map(
      (
        await tx.$queryRaw<{ alvo: string; motivo: string | null; em: Date; codigo: string | null; endereco: string | null }[]>`
          SELECT DISTINCT ON (coalesce(conteudo_id, vinculo_id)) coalesce(conteudo_id, vinculo_id)::text AS alvo, motivo, registrado_em AS em, codigo_origem AS codigo, endereco_origem AS endereco
            FROM historico_conteudo
           WHERE escopo_id = ${escopoId}::uuid AND situacao_nova = 'VALIDACAO' AND coalesce(conteudo_id, vinculo_id) = ANY(${emValidacao}::uuid[])
           ORDER BY coalesce(conteudo_id, vinculo_id), registrado_em DESC, id DESC`
      ).map((h) => [h.alvo, h]),
    );
    const quantidades = new Map(
      (
        await tx.$queryRaw<{ id: string; atual: number | null }[]>`
          SELECT x.id::text, coalesce(
                   (SELECT k.volumes_contados FROM contagem_volumes k WHERE k.escopo_id = ${escopoId}::uuid AND (k.conteudo_id = x.id OR k.vinculo_id = x.id) ORDER BY k.registrada_em DESC, k.id DESC LIMIT 1),
                   (SELECT CASE WHEN v.volumes = trunc(v.volumes) AND v.volumes <= 100000 THEN v.volumes::int END FROM vinculo_documento_palete v WHERE v.id = x.id)) AS atual
            FROM unnest(${emValidacao}::uuid[]) AS x(id)`
      ).map((q) => [q.id, q.atual]),
    );
    for (const alvo of emValidacao) {
      const v = vinculoPor.get(alvo);
      const r = conteudoPor.get(alvo);
      const h = historico.get(alvo);
      const fonte = v ? (v.la ?? v.lo) : null;
      const ultimo = paletePor.get(v?.palete_id ?? r?.palete_id ?? '');
      const q = quantidades.get(alvo) ?? null;
      linhas.push({
        grupo: 'VALIDACAO',
        palete: null,
        delivery: v?.delivery ?? r?.delivery ?? null,
        tipo: v?.tipo ?? r?.tipo ?? null,
        numero: v?.numero ?? r?.numero ?? null,
        volumes: null,
        volumesTexto: q === null ? 'Não informado' : `Pendente: ${String(q)} volume(s) a localizar`,
        remetente: vazio(fonte?.remetente ?? r?.remetente),
        mesAgenda: vazio(fonte?.mes_agenda),
        janela: vazio(fonte?.janela),
        endereco: null,
        documentacao: vazio(fonte?.documentacao ?? v?.documentacao),
        palletFull: fonte ? marcadorFull(v?.pallet_full ?? fonte.pallet_full, fonte.extras) : null,
        categoria: vazio(fonte?.categoria),
        dataInventario: fonte ? dataInventario(fonte.extras) : null,
        situacao: 'Em validação — sem endereço (fora do estoque físico)',
        pendencia: `Validação${h ? ` desde ${dataCurta(h.em)}` : ''}: ${vazio(h?.motivo) ?? 'motivo não registrado'}${ultimo ? ` · último palete conhecido ${ultimo.codigo}${h?.endereco ? ` (${h.endereco})` : ''}` : ''}`,
        origemVolumes: q === null ? 'Não informado' : 'Última quantidade registrada',
        conferencia: null,
        fileira: null,
        tipoPalete: null,
        produto: vazio(r?.descricao),
        origemRegistro: fonte ? `${fonte.inventario} · linha ${String(fonte.linha_arquivo)}` : r ? (r.origem === 'BIPAGEM' ? `Bipagem${r.lote ? ` ${r.lote}` : ''}` : 'Cadastro no aplicativo') : 'Registro do aplicativo',
        referencia: alvo,
      });
    }
  }

  // Linhas do inventário: sem documento (aplicadas), endereço livre e as do lote ativo sem ocorrência.
  const linhasInv = await tx.$queryRaw<
    {
      id: string;
      linha_arquivo: number;
      inventario: string;
      ativo: boolean;
      acao: string;
      aplicada: boolean;
      vigente: boolean;
      livre: boolean;
      palete_id: string | null;
      delivery: string | null;
      tipo: string | null;
      numero: string | null;
      volumes: string | null;
      volumes_lido: string | null;
      remetente: string | null;
      mes_agenda: string | null;
      janela: string | null;
      endereco: string | null;
      endereco_lido: string | null;
      numero_palete: string | null;
      documentacao: string | null;
      pallet_full: string | null;
      categoria: string | null;
      extras: unknown;
      motivos: unknown;
      resolvida: boolean;
      com_vinculo: boolean;
    }[]
  >`
    SELECT li.id::text, li.linha_arquivo, i.codigo AS inventario, i.situacao = 'ATIVO' AS ativo, li.acao::text AS acao, li.aplicada, ${LINHA_VIGENTE} AS vigente, li.endereco_livre AS livre,
           li.palete_id::text, li.delivery, li.tipo_documento AS tipo, li.numero_documento AS numero, li.volumes::text, li.volumes_lido, li.remetente, li.mes_agenda,
           li.janela_referencia AS janela, li.endereco_canonico AS endereco, li.endereco_lido, li.numero_palete, li.documentacao, li.pallet_full, li.categoria, li.extras, li.motivos,
           li.resolvida_por_id IS NOT NULL AS resolvida,
           EXISTS (SELECT 1 FROM vinculo_documento_palete vv WHERE vv.linha_inventario_id = li.id) AS com_vinculo
      FROM linha_inventario li JOIN inventario_referencia i ON i.id = li.inventario_id
     WHERE li.escopo_id = ${escopoId}::uuid
       AND (i.id = ${loteId}::uuid OR (i.situacao = 'ATIVO' AND li.numero_documento IS NULL AND li.palete_id IS NOT NULL) OR (i.situacao = 'ATIVO' AND li.endereco_livre))
     ORDER BY li.linha_arquivo`;
  const naPraca = new Map(base.paletes.map((p) => [p.id, p]));
  const comLinhaSemDoc = new Set<string>();
  for (const l of linhasInv) {
    if (linhasRepresentadas.has(l.id)) continue;
    const comum = {
      delivery: l.delivery,
      tipo: l.tipo,
      numero: l.numero,
      remetente: vazio(l.remetente),
      mesAgenda: vazio(l.mes_agenda),
      janela: vazio(l.janela),
      documentacao: vazio(l.documentacao),
      palletFull: marcadorFull(l.pallet_full, l.extras),
      categoria: vazio(l.categoria),
      dataInventario: dataInventario(l.extras),
      conferencia: null,
      produto: null,
      origemRegistro: `${l.inventario} · linha ${String(l.linha_arquivo)}`,
      referencia: l.id,
    };
    const informados = vazio(l.volumes_lido) ?? (l.volumes === null ? null : l.volumes.replace(/\.0+$/, ''));
    if (l.numero === null && l.palete_id !== null && l.aplicada && l.vigente && !l.livre) {
      const p = naPraca.get(l.palete_id);
      if (!p) continue;
      comLinhaSemDoc.add(p.id);
      linhas.push({
        ...comum,
        grupo: 'SEM_DOCUMENTO',
        palete: p.codigo,
        volumes: null,
        volumesTexto: informados === null ? 'Não informado' : `Sem documento: ${informados} informado(s)`,
        endereco: enderecoDe(p),
        situacao: 'No palete — documento não informado no inventário',
        pendencia: 'Documento não informado na fonte (conteúdo sem identificação)',
        origemVolumes: informados === null ? 'Não informado' : 'Informado no inventário',
        fileira: paletePor.get(p.id)?.prefixo ?? null,
        tipoPalete: TIPO_PALETE[p.tipoPalete] ?? null,
      });
      continue;
    }
    if (l.livre && l.numero !== null) {
      linhas.push({
        ...comum,
        grupo: 'REFERENCIA',
        palete: null,
        volumes: null,
        volumesTexto: informados === null ? 'Não informado' : `Fora da praça: ${informados} informado(s)`,
        endereco: null,
        situacao: 'Fora da praça — endereço livre na fonte',
        pendencia: `Endereço ${l.endereco ?? l.endereco_lido ?? '?'} livre no ${l.inventario}: local atual não informado`,
        origemVolumes: informados === null ? 'Não informado' : 'Informado no inventário',
        fileira: null,
        tipoPalete: null,
      });
      continue;
    }
    if (!l.ativo || l.aplicada || l.resolvida || l.com_vinculo || l.numero === null && l.acao !== 'REQUER_RESOLUCAO') continue;
    // Lote ativo: em revisão, repetida no arquivo ou sem registro ativo no aplicativo.
    const motivos = (Array.isArray(l.motivos) ? l.motivos : []).map((m) => texto(objeto(m), 'code') ?? '');
    const causas = pendenciasDaLinha(l.extras, l.acao === 'REQUER_RESOLUCAO');
    const pendencia =
      l.acao === 'DUPLICADA_ARQUIVO'
        ? LINHA_REPETIDA
        : l.acao === 'REQUER_RESOLUCAO'
          ? `Em revisão: ${(causas.length > 0 ? causas : motivos.map((m) => ROTULO_MOTIVO_LINHA[m] ?? m)).join(', ') || 'motivo não informado'}`
          : 'Linha do lote ativo sem registro ativo no aplicativo (encerrado ou cancelado depois da carga)';
    linhas.push({
      ...comum,
      grupo: 'PENDENTE',
      palete: null,
      volumes: null,
      volumesTexto: informados === null ? 'Não informado' : `Pendente: ${informados} informado(s)`,
      endereco: null,
      situacao: `Pendente no lote ativo${l.endereco ?? l.endereco_lido ? ` (endereço na fonte: ${l.endereco ?? l.endereco_lido ?? ''}${l.numero_palete ? `, N° Pallet ${l.numero_palete}` : ''})` : ''}`,
      pendencia,
      origemVolumes: informados === null ? 'Não informado' : 'Informado na fonte (não somado)',
      fileira: null,
      tipoPalete: null,
    });
  }

  // Palete na praça sem nenhum conteúdo registrado (nem linha sem documento).
  for (const p of base.paletes) {
    if (p.conteudos.length > 0 || comLinhaSemDoc.has(p.id)) continue;
    linhas.push({
      grupo: 'SEM_CONTEUDO',
      palete: p.codigo,
      delivery: null,
      tipo: null,
      numero: null,
      volumes: null,
      volumesTexto: 'Não informado',
      remetente: null,
      mesAgenda: null,
      janela: null,
      endereco: enderecoDe(p),
      documentacao: null,
      palletFull: null,
      categoria: null,
      dataInventario: null,
      situacao: 'Palete na praça sem conteúdo registrado',
      pendencia: 'Conteúdo não registrado (não prova palete vazio)',
      origemVolumes: 'Não informado',
      conferencia: null,
      fileira: paletePor.get(p.id)?.prefixo ?? null,
      tipoPalete: null,
      produto: null,
      origemRegistro: 'Cadastro do palete',
      referencia: p.id,
    });
  }

  const ORDEM: Readonly<Record<GrupoLinha, number>> = { ESTOQUE: 0, SEM_DOCUMENTO: 0, SEM_CONTEUDO: 0, VALIDACAO: 1, PENDENTE: 2, REFERENCIA: 3 };
  linhas.sort(
    (a, b) =>
      ORDEM[a.grupo] - ORDEM[b.grupo] ||
      (a.endereco === null ? 1 : 0) - (b.endereco === null ? 1 : 0) ||
      ordemEndereco(a.endereco ?? '', b.endereco ?? '') ||
      (a.palete ?? '').localeCompare(b.palete ?? '', 'pt-BR', { numeric: true }) ||
      (a.numero ?? '').localeCompare(b.numero ?? '', 'pt-BR', { numeric: true }) ||
      a.origemRegistro.localeCompare(b.origemRegistro, 'pt-BR', { numeric: true }) ||
      a.referencia.localeCompare(b.referencia),
  );
  return { inventario: linhas, totais: totalizar(linhas, saidasTotais) };
}

/** Totais da aba Inventário (também usados para conferir o arquivo gerado). */
export function totalizar(linhas: readonly LinhaInventarioPlanilha[], saidasTotais: number): TotaisInventario {
  const porGrupo: Record<GrupoLinha, number> = { ESTOQUE: 0, SEM_DOCUMENTO: 0, SEM_CONTEUDO: 0, VALIDACAO: 0, PENDENTE: 0, REFERENCIA: 0 };
  let volumes = 0;
  let semVolume = 0;
  for (const l of linhas) {
    porGrupo[l.grupo] += 1;
    if (l.volumes !== null) volumes += l.volumes;
    if (l.grupo === 'ESTOQUE' && l.volumes === null) semVolume += 1;
  }
  const paletes = new Set(linhas.filter((l) => l.grupo === 'ESTOQUE' || l.grupo === 'SEM_DOCUMENTO' || l.grupo === 'SEM_CONTEUDO').map((l) => l.palete));
  return { linhas: linhas.length, porGrupo, paletesNaPraca: paletes.size, volumesConhecidos: volumes, estoqueSemVolume: semVolume, saidasTotais };
}

// ---------- Movimentações ----------

/**
 * Ações de auditoria que entram em Movimentações. As que têm detalhe por
 * ocorrência noutra tabela (troca de número do palete, correções de conteúdo,
 * contagens avulsas, separação/expedição em volumes) entram pelo detalhe, com
 * antes e depois — sem repetir o mesmo fato.
 */
export const ACOES_MOVIMENTACAO: Readonly<Record<string, string>> = {
  PALETE_CADASTRADO: 'Cadastro de palete',
  PALETE_ALTERADO: 'Cadastro do palete alterado',
  PALETE_ARQUIVADO: 'Cadastro arquivado',
  PALETE_MOVIDO: 'Movimentação do palete',
  MOVIMENTO_CORRIGIDO: 'Correção de movimentação',
  PALETE_VAZIO_RETIRADO: 'Palete vazio retirado',
  PALETE_BLOQUEADO: 'Palete bloqueado',
  PALETE_DESBLOQUEADO: 'Palete desbloqueado',
  TRANSFERENCIA_REGISTRADA: 'Transferência',
  TRANSFERENCIA_CORRIGIDA: 'Correção de transferência',
  CONFERENCIA_CONCLUIDA: 'Conferência concluída',
  CONFERENCIA_RECONCILIADA: 'Conferência validada',
  CONFERENCIA_CANCELADA: 'Conferência cancelada',
  CONFERENCIA_VOLUMES_REGISTRADA: 'Conferência de volumes',
  RECONFERENCIA_REGISTRADA: 'Reconferência do palete',
  CONFERENCIA_EXTERNA_RECONHECIDA: 'Conferência externa reconhecida',
  NOTA_CIDADE_DESTINO_ALTERADA: 'Cidade destino informada',
  NOTA_PRODUTO_ALTERADO: 'Produto na caixa informado',
  NOTA_CAIXA_DESCRITA: 'Descrição de caixa',
  NOTA_CAIXA_RETIRADA: 'Descrição de caixa retirada',
  INVENTARIO_IMPORTADO: 'Inventário importado',
  INVENTARIO_CARGA_REENVIADA: 'Inventário reenviado',
  IMPORTACAO_CONFIRMADA: 'Importação confirmada',
  BIPAGEM_IMPORTADA: 'Bipagem importada',
  POSICAO_LIVRE_CONFIRMADA: 'Posição confirmada livre',
  CONTEUDO_REGISTRADO: 'Conteúdo registrado',
  CONTEUDO_ALTERADO: 'Identificação do conteúdo completada',
  VALIDACAO_RESOLVIDA: 'Validação resolvida',
  RECONCILIACAO_ALOCACOES: 'Reconciliação das alocações',
  MATERIAL_LIBERADO: 'Material liberado',
  MATERIAL_LIBERACAO_REVOGADA: 'Liberação revogada',
  MATERIAL_BLOQUEADO: 'Material bloqueado',
  MATERIAL_DESBLOQUEADO: 'Material desbloqueado',
  RESERVA_CRIADA: 'Reserva para janela',
  RESERVA_CANCELADA: 'Reserva cancelada',
  EXPEDICAO_CONFIRMADA: 'Saída (expedição do palete)',
  EXPEDICAO_CORRIGIDA: 'Correção de saída',
  RETORNO_REGISTRADO: 'Retorno registrado',
  PRODUTO_CRIADO: 'Cadastro de produto',
  PRODUTO_ALTERADO: 'Produto alterado',
};

function descreverAuditoria(acao: string, d: Detalhes): Pick<EventoPlanilha, 'palete' | 'documento' | 'antes' | 'depois' | 'descricao'> {
  const palete = texto(d, 'codigo') ?? texto(d, 'palete');
  const doc = texto(d, 'documento') ?? (texto(d, 'numero') ? `${texto(d, 'tipo') ?? 'Documento'} ${texto(d, 'numero') ?? ''}` : null);
  const motivo = texto(d, 'motivo');
  const base = { palete, documento: doc, antes: texto(d, 'de') ?? texto(d, 'antes'), depois: texto(d, 'para') ?? texto(d, 'depois') };
  switch (acao) {
    case 'PALETE_MOVIDO':
    case 'MOVIMENTO_CORRIGIDO':
      return { ...base, antes: texto(d, 'de') ?? 'Sem posição', depois: texto(d, 'para') ?? 'Sem posição', descricao: motivo ?? 'Mudança de localização registrada.' };
    case 'PALETE_VAZIO_RETIRADO':
      return { ...base, depois: 'Retirado', descricao: motivo ?? 'Palete vazio retirado da posição.' };
    case 'PALETE_CADASTRADO':
      return { ...base, depois: texto(d, 'posicao') ?? 'Sem posição', descricao: `Palete cadastrado${texto(d, 'posicao') ? ` na posição ${texto(d, 'posicao') ?? ''}` : ' (localização pendente)'}.` };
    case 'NOTA_CAIXA_DESCRITA':
      return { ...base, descricao: `${texto(d, 'grupo') ?? 'Caixa'}: ${texto(d, 'descricao') ?? ''}` };
    case 'NOTA_CAIXA_RETIRADA':
      return { ...base, descricao: `${texto(d, 'grupo') ?? 'Caixa'} retirada: ${motivo ?? ''}` };
    case 'POSICAO_LIVRE_CONFIRMADA':
      return { ...base, palete: null, antes: texto(d, 'endereco') ?? texto(d, 'posicao'), descricao: `Posição confirmada livre${texto(d, 'observacao') ? `: ${texto(d, 'observacao') ?? ''}` : '.'}` };
    case 'CONTEUDO_REGISTRADO':
    case 'CONTEUDO_ALTERADO':
      return { ...base, descricao: `${texto(d, 'remetente') ?? ''} · ${doc ?? 'Documento não informado'} · ${texto(d, 'delivery') ? `Delivery ${texto(d, 'delivery') ?? ''}` : 'Delivery não informado'}` };
    case 'CONFERENCIA_VOLUMES_REGISTRADA':
      return {
        ...base,
        antes: texto(d, 'volumesAntes'),
        depois: texto(d, 'volumesDepois'),
        descricao: `Conferência ${texto(d, 'abrangencia') === 'PARCIAL' || texto(d, 'scope') === 'PARCIAL' ? 'parcial' : 'completa'}: ${texto(d, 'itens') ?? '?'} item(ns), ${texto(d, 'diferencas') ?? '0'} com diferença.`,
      };
    case 'BIPAGEM_IMPORTADA':
      return { ...base, palete: texto(d, 'palete'), descricao: `Bipagem (arquivo ${texto(d, 'arquivo') ?? ''}): ${texto(d, 'registros') ?? texto(d, 'notas') ?? '0'} registro(s).` };
    case 'INVENTARIO_IMPORTADO':
    case 'INVENTARIO_CARGA_REENVIADA':
      return { ...base, palete: null, descricao: `${texto(d, 'codigo') ?? 'Inventário'}${texto(d, 'substitui') ? ` (substitui ${texto(d, 'substitui') ?? ''})` : ''}: ${texto(d, 'vinculos') ?? '0'} vínculo(s), ${texto(d, 'paletesCriados') ?? '0'} palete(s) cadastrado(s).` };
    case 'EXPEDICAO_CONFIRMADA':
      return { ...base, palete: null, depois: texto(d, 'janela'), descricao: `Saída ${texto(d, 'codigo') ?? ''}${d.parcial === true ? ' (parcial)' : ''}.` };
    default:
      return { ...base, descricao: motivo ?? ACOES_MOVIMENTACAO[acao] ?? acao };
  }
}

const ACAO_CONTEUDO: Readonly<Record<string, string>> = {
  MOVIMENTO: 'Conteúdo movido',
  VALIDACAO: 'Conteúdo enviado à validação',
  RESOLUCAO: 'Validação resolvida (conteúdo alocado)',
  CANCELAMENTO: 'Registro de conteúdo cancelado',
  ENCERRAMENTO: 'Registro de conteúdo encerrado',
};

const ACAO_VOLUMES: Readonly<Record<string, string>> = {
  SEPARACAO: 'Separação para janela (volumes)',
  ESTORNO_SEPARACAO: 'Estorno de separação',
  EXPEDICAO: 'Saída (expedição de volumes)',
  ESTORNO_EXPEDICAO: 'Estorno de saída',
};

const pessoa = (nome: string | null, login: string | null) => (nome === null || login === null ? 'Não registrado' : `${nome} (${login})`);
const local = (codigo: string | null, endereco: string | null) => (codigo === null && endereco === null ? null : [codigo ? `Palete ${codigo}` : null, endereco].filter((x) => x !== null).join(' · '));

async function eventosDoEscopo(tx: Tx, escopoId: string): Promise<EventoPlanilha[]> {
  const acoes = Object.keys(ACOES_MOVIMENTACAO);
  // Uma consulta por vez: a transação usa uma única conexão.
  const auditoria = await tx.eventoAuditoria.findMany({
    where: { escopoId, resultado: 'SUCESSO', acao: { in: acoes } },
    select: { id: true, ocorridoEm: true, acao: true, detalhes: true, ator: { select: { nome: true, login: true } } },
  });
  const conteudo = await tx.$queryRaw<{ id: string; em: Date; acao: string; antes: string; depois: string; co: string | null; eo: string | null; cd: string | null; ed: string | null; volumes: number | null; motivo: string | null; nome: string | null; login: string | null; doc: string | null }[]>`
    SELECT h.id::text, h.registrado_em AS em, h.acao, h.situacao_anterior AS antes, h.situacao_nova AS depois, h.codigo_origem AS co, h.endereco_origem AS eo, h.codigo_destino AS cd,
           h.endereco_destino AS ed, h.volumes, h.motivo, u.nome, u.login,
           coalesce(btrim(coalesce(v.tipo_documento, '') || ' ' || v.numero_documento), nullif(btrim(coalesce(c.tipo_documento, '') || ' ' || coalesce(c.numero_documento, '')), ''), c.remetente) AS doc
      FROM historico_conteudo h
      LEFT JOIN usuario u ON u.id = h.autor_id
      LEFT JOIN vinculo_documento_palete v ON v.id = h.vinculo_id
      LEFT JOIN conteudo_palete c ON c.id = h.conteudo_id
       WHERE h.escopo_id = ${escopoId}::uuid`;
  const contagens = await tx.$queryRaw<{ id: string; em: Date; contados: number; anterior: number | null; informado: string | null; origem: string; referencia: string | null; nome: string; login: string; palete: string; doc: string | null }[]>`
    SELECT k.id::text, k.registrada_em AS em, k.volumes_contados AS contados,
           lag(k.volumes_contados) OVER (PARTITION BY coalesce(k.conteudo_id, k.vinculo_id) ORDER BY k.registrada_em, k.id) AS anterior,
           v.volumes::text AS informado, k.origem, k.referencia, u.nome, u.login, p.codigo AS palete,
           coalesce(btrim(coalesce(v.tipo_documento, '') || ' ' || v.numero_documento), nullif(btrim(coalesce(c.tipo_documento, '') || ' ' || coalesce(c.numero_documento, '')), ''), c.remetente) AS doc
      FROM contagem_volumes k
      JOIN usuario u ON u.id = k.registrada_por_id
      JOIN palete p ON p.id = k.palete_id
      LEFT JOIN vinculo_documento_palete v ON v.id = k.vinculo_id
      LEFT JOIN conteudo_palete c ON c.id = k.conteudo_id
       WHERE k.escopo_id = ${escopoId}::uuid`;
  const codigos = await tx.$queryRaw<{ id: string; em: Date; anterior: string; novo: string; motivo: string; nome: string | null; login: string | null }[]>`
    SELECT h.id::text, h.registrado_em AS em, h.codigo_anterior AS anterior, h.codigo_novo AS novo, h.motivo, u.nome, u.login
      FROM historico_codigo_palete h LEFT JOIN usuario u ON u.id = h.autor_id
       WHERE h.escopo_id = ${escopoId}::uuid`;
  const volumes = await tx.$queryRaw<{ id: string; em: Date; tipo: string; volumes: number; motivo: string | null; janela: string; palete: string; nome: string; login: string; doc: string | null }[]>`
    SELECT e.id::text, e.ocorrido_em AS em, e.tipo, e.volumes, e.motivo, j.codigo AS janela, p.codigo AS palete, u.nome, u.login,
           coalesce(btrim(coalesce(v.tipo_documento, '') || ' ' || v.numero_documento), nullif(btrim(coalesce(c.tipo_documento, '') || ' ' || coalesce(c.numero_documento, '')), ''), c.remetente) AS doc
      FROM evento_volumes_janela e
      JOIN janela_devolucao j ON j.id = e.janela_id
      JOIN palete p ON p.id = e.palete_id
      JOIN usuario u ON u.id = e.autor_id
      LEFT JOIN vinculo_documento_palete v ON v.id = e.vinculo_id
      LEFT JOIN conteudo_palete c ON c.id = e.conteudo_id
       WHERE e.escopo_id = ${escopoId}::uuid`;
  const eventos: EventoPlanilha[] = [
    ...auditoria.map((a) => ({
      id: `A-${a.id}`,
      em: a.ocorridoEm,
      acao: ACOES_MOVIMENTACAO[a.acao] ?? a.acao,
      responsavel: a.ator ? `${a.ator.nome} (${a.ator.login})` : 'Sistema',
      fonte: 'Auditoria',
      ...descreverAuditoria(a.acao, objeto(a.detalhes)),
    })),
    ...conteudo.map((h) => ({
      id: `H-${h.id}`,
      em: h.em,
      acao: ACAO_CONTEUDO[h.acao] ?? h.acao,
      palete: h.cd ?? h.co,
      documento: h.doc,
      antes: h.acao === 'RESOLUCAO' ? 'Em validação' : (local(h.co, h.eo) ?? h.antes),
      depois: h.acao === 'VALIDACAO' ? 'Em validação (sem endereço)' : h.acao === 'CANCELAMENTO' ? 'Cancelado' : h.acao === 'ENCERRAMENTO' ? 'Encerrado' : (local(h.cd, h.ed) ?? h.depois),
      responsavel: pessoa(h.nome, h.login),
      descricao: `${h.volumes === null ? 'Volumes não informados' : `${String(h.volumes)} volume(s)`}${h.motivo ? ` · ${h.motivo}` : ''}`,
      fonte: 'Histórico do conteúdo',
    })),
    ...contagens.map((k) => {
      const informado = k.informado === null ? null : k.informado.replace(/\.0+$/, '');
      return {
        id: `C-${k.id}`,
        em: k.em,
        acao: 'Contagem de volumes',
        palete: k.palete,
        documento: k.doc,
        antes: k.anterior !== null ? String(k.anterior) : informado !== null ? `${informado} (informado)` : 'Não informado',
        depois: String(k.contados),
        responsavel: pessoa(k.nome, k.login),
        descricao: `${ORIGEM_CONTAGEM[k.origem] ?? k.origem}${k.referencia ? ` · ${k.referencia}` : ''}`,
        fonte: 'Contagem',
      };
    }),
    ...codigos.map((c) => ({ id: `N-${c.id}`, em: c.em, acao: 'Número do palete', palete: c.novo, documento: null, antes: c.anterior, depois: c.novo, responsavel: pessoa(c.nome, c.login), descricao: c.motivo, fonte: 'Código do palete' })),
    ...volumes.map((v) => ({
      id: `V-${v.id}`,
      em: v.em,
      acao: ACAO_VOLUMES[v.tipo] ?? v.tipo,
      palete: v.palete,
      documento: v.doc,
      antes: null,
      depois: `${String(v.volumes)} volume(s)`,
      responsavel: pessoa(v.nome, v.login),
      descricao: `Janela ${v.janela}${v.motivo ? ` · ${v.motivo}` : ''}`,
      fonte: 'Janela (volumes)',
    })),
  ];
  return eventos.sort((a, b) => b.em.getTime() - a.em.getTime() || a.id.localeCompare(b.id));
}
