/**
 * Correção dos paletes já cadastrados (21 out. 2026, pedido
 * CORRECAO-PALETES-CONFERENCIA-E-REFERENCIAS5): a carga do inventário
 * associava o palete pelo ENDEREÇO; quando o N° Pallet do endereço mudou
 * (ex.: 11 - A42 tinha o palete 1 em 06/10 e o 256 em 20/10), o registro
 * técnico antigo (PR-000001) recebeu a nota nova e manteve as notas antigas.
 *
 * Esta correção, sobre o inventário ATIVO, sem ler arquivo nenhum:
 * 1. Número operacional: o palete na posição passa a se chamar pelo N° Pallet
 *    único que a fonte ativa informa naquele endereço ("Palete 256"); o PR-…
 *    fica como identificador legado (pesquisável, nunca reutilizado). UUID,
 *    QR, contagens e histórico não mudam. Endereço com mais de um número, número
 *    em mais de um endereço ou já usado por outro palete ficam pendentes.
 * 2. Notas antigas (vínculo de versão substituída que não consta da ativa):
 *    - a ativa põe a nota noutro palete → vínculo antigo ENCERRADO (o atual já a representa);
 *    - a ativa só a tem sem alocação (em revisão) → VALIDAÇÃO;
 *    - no endereço do palete a ativa informa OUTRO N° Pallet → VALIDAÇÃO (local físico desconhecido);
 *    - mesmo N° Pallet, endereço fora da fonte ativa, contagem positiva
 *      depois da data-base ou volumes numa janela → mantida (a ausência sozinha não basta).
 *    Conteúdo registrado à mão ou pela bipagem nunca é tocado. Palete movido
 *    depois do inventário ativo fica de fora (a fonte não descreve o local atual).
 */
import type { Escopo } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { registrarHistoricoConteudo } from '../conteudos/acoes.js';
import { atribuirNumeroOperacional, ehCodigoGerado } from './numero-operacional.js';

type Db = Banco | Transacao;

export interface TrocaNumero {
  paleteId: string;
  de: string;
  para: string;
  endereco: string;
}

export interface NumeroPendente {
  paleteId: string;
  codigo: string;
  endereco: string;
  motivo: string;
}

export interface DecisaoVinculo {
  vinculoId: string;
  paleteId: string;
  palete: string;
  endereco: string | null;
  documento: string;
  volumes: number | null;
  numeroAntigo: string | null;
  inventario: string;
  linha: number;
  decisao: 'ENCERRAR' | 'VALIDACAO' | 'MANTER';
  motivo: string;
}

export interface PlanoCorrecao {
  inventario: { id: string; codigo: string; dataBase: string | null; criadoEm: Date } | null;
  numeros: TrocaNumero[];
  numerosPendentes: NumeroPendente[];
  vinculos: DecisaoVinculo[];
  paletesMovidos: { paleteId: string; codigo: string }[];
}

const dataBr = (iso: string | null) => (iso === null ? 'data-base não informada' : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`);

/** Plano da correção (só leitura). */
export async function planejarCorrecao(db: Db, escopoId: string): Promise<PlanoCorrecao> {
  const inv = await db.inventarioReferencia.findFirst({
    where: { escopoId, situacao: 'ATIVO', origem: { not: 'BIPAGEM' } },
    orderBy: { criadoEm: 'desc' },
    select: { id: true, codigo: true, convencoes: true, criadoEm: true },
  });
  if (!inv) return { inventario: null, numeros: [], numerosPendentes: [], vinculos: [], paletesMovidos: [] };
  const conv = typeof inv.convencoes === 'object' && inv.convencoes !== null ? (inv.convencoes as Record<string, unknown>) : {};
  const dataBase = typeof conv.dataBase === 'string' ? conv.dataBase : null;
  const inventario = { id: inv.id, codigo: inv.codigo, dataBase, criadoEm: inv.criadoEm };

  // Paletes com posição confirmada, os números que a fonte ativa informa no endereço e se foram movidos depois do inventário.
  const paletes = await db.$queryRaw<{ id: string; codigo: string; legado: string | null; origem: string; endereco: string; numeros: string[]; movido: boolean }[]>`
    SELECT p.id::text, p.codigo, p.codigo_legado AS legado, p.origem_codigo::text AS origem, ep.endereco,
           coalesce(array_agg(DISTINCT btrim(l.numero_palete)) FILTER (WHERE l.numero_palete IS NOT NULL AND btrim(l.numero_palete) <> ''), '{}') AS numeros,
           EXISTS (SELECT 1 FROM evento_localizacao e WHERE e.palete_id = p.id AND e.ocorrido_em > ${inv.criadoEm}) AS movido
      FROM palete p
      JOIN endereco_posicao ep ON ep.posicao_id = p.posicao_id AND ep.situacao = 'CONFIRMADO'
      LEFT JOIN linha_inventario l ON l.escopo_id = p.escopo_id AND l.inventario_id = ${inv.id}::uuid AND l.endereco_canonico = ep.endereco AND NOT l.endereco_livre
     WHERE p.escopo_id = ${escopoId}::uuid AND p.arquivado_em IS NULL AND p.estado_fluxo::text NOT IN ('EXPEDIDO', 'VAZIO_ARQUIVADO')
     GROUP BY p.id, ep.endereco`;
  const usados = await db.$queryRaw<{ chave: string; id: string }[]>`
    SELECT regexp_replace(upper(x.c), '[^A-Z0-9]', '', 'g') AS chave, p.id::text
      FROM palete p CROSS JOIN LATERAL (VALUES (p.codigo), (p.codigo_legado)) AS x(c)
     WHERE p.escopo_id = ${escopoId}::uuid AND x.c IS NOT NULL`;
  const donoDe = new Map<string, Set<string>>();
  for (const u of usados) donoDe.set(u.chave, new Set([...(donoDe.get(u.chave) ?? []), u.id]));
  const chave = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const enderecosDoNumero = new Map<string, number>();
  for (const p of paletes) if (p.numeros.length === 1) enderecosDoNumero.set(p.numeros[0] ?? '', (enderecosDoNumero.get(p.numeros[0] ?? '') ?? 0) + 1);

  const numeros: TrocaNumero[] = [];
  const numerosPendentes: NumeroPendente[] = [];
  const paletesMovidos = paletes.filter((p) => p.movido).map((p) => ({ paleteId: p.id, codigo: p.codigo }));
  for (const p of paletes) {
    if (p.movido || p.numeros.length === 0) continue;
    const pendente = (motivo: string) => numerosPendentes.push({ paleteId: p.id, codigo: p.codigo, endereco: p.endereco, motivo });
    if (p.numeros.length > 1) {
      pendente(`A fonte informa mais de um N° Pallet em ${p.endereco} (${p.numeros.join(', ')}): número a confirmar no piso.`);
      continue;
    }
    const numero = p.numeros[0] ?? '';
    if (chave(numero) === chave(p.codigo)) continue;
    if ((enderecosDoNumero.get(numero) ?? 0) > 1) {
      pendente(`O N° Pallet ${numero} aparece em mais de um endereço na fonte: número a confirmar.`);
      continue;
    }
    const donos = [...(donoDe.get(chave(numero)) ?? [])].filter((id) => id !== p.id);
    if (donos.length > 0) {
      pendente(`O número ${numero} já identifica outro palete (código ou identificador legado): não é reutilizado.`);
      continue;
    }
    if (p.origem !== 'GERADO' || !ehCodigoGerado(p.codigo)) {
      pendente(`O palete ${p.codigo} já tem número próprio; a fonte informa ${numero}: confirmar qual vale.`);
      continue;
    }
    numeros.push({ paleteId: p.id, de: p.codigo, para: numero, endereco: p.endereco });
  }

  // Vínculos ativos de versões substituídas que não constam da ativa (mesma regra da marca "não consta").
  const linhas = await db.$queryRaw<
    {
      id: string;
      palete_id: string;
      codigo: string;
      endereco: string | null;
      documento: string;
      volumes: number | null;
      npal: string | null;
      inv: string;
      linha: number;
      movido: boolean;
      janela: boolean;
      confirmado: boolean;
      em_outro: string | null;
      na_ativa: boolean;
      numeros_end: string[] | null;
      end_na_fonte: boolean;
    }[]
  >`
    WITH ativa AS (SELECT * FROM linha_inventario WHERE escopo_id = ${escopoId}::uuid AND inventario_id = ${inv.id}::uuid)
    SELECT v.id::text, v.palete_id::text, p.codigo, ep.endereco, btrim(coalesce(v.tipo_documento, '') || ' ' || v.numero_documento) AS documento,
           coalesce((SELECT k.volumes_contados FROM contagem_volumes k WHERE k.vinculo_id = v.id ORDER BY k.registrada_em DESC, k.id DESC LIMIT 1),
                    CASE WHEN v.volumes = trunc(v.volumes) AND v.volumes <= 100000 THEN v.volumes::int END) AS volumes,
           nullif(btrim(lo.numero_palete), '') AS npal, io.codigo AS inv, lo.linha_arquivo AS linha,
           EXISTS (SELECT 1 FROM evento_localizacao e WHERE e.palete_id = p.id AND e.ocorrido_em > ${inv.criadoEm}) AS movido,
           EXISTS (SELECT 1 FROM evento_volumes_janela x WHERE x.vinculo_id = v.id) AS janela,
           EXISTS (SELECT 1 FROM contagem_volumes k WHERE k.vinculo_id = v.id AND k.palete_id = v.palete_id AND k.volumes_contados > 0
                     AND k.origem IN ('CONTAGEM_FISICA', 'CONTAGEM_INFORMADA') AND k.registrada_em >= coalesce(${dataBase}::date, ${inv.criadoEm}::timestamptz)) AS confirmado,
           (SELECT pa.codigo || coalesce(' (' || ea.endereco || ')', '') FROM ativa a JOIN palete pa ON pa.id = a.palete_id
              LEFT JOIN endereco_posicao ea ON ea.posicao_id = pa.posicao_id AND ea.situacao = 'CONFIRMADO'
             WHERE a.identidade_documento = v.identidade_documento AND a.palete_id IS NOT NULL AND a.palete_id <> v.palete_id
               AND (a.aplicada OR a.acao::text IN ('JA_IMPORTADO', 'DUPLICADA_ARQUIVO'))
               AND EXISTS (SELECT 1 FROM vinculo_documento_palete o WHERE o.palete_id = a.palete_id AND o.situacao = 'ATIVO' AND o.identidade_documento = v.identidade_documento)
             ORDER BY a.linha_arquivo LIMIT 1) AS em_outro,
           EXISTS (SELECT 1 FROM ativa a WHERE a.identidade_documento = v.identidade_documento) AS na_ativa,
           (SELECT array_agg(DISTINCT btrim(a.numero_palete)) FROM ativa a
             WHERE a.endereco_canonico = ep.endereco AND NOT a.endereco_livre AND a.numero_palete IS NOT NULL AND btrim(a.numero_palete) <> '') AS numeros_end,
           EXISTS (SELECT 1 FROM ativa a WHERE a.endereco_canonico = ep.endereco AND NOT a.endereco_livre) AS end_na_fonte
      FROM vinculo_documento_palete v
      JOIN inventario_referencia io ON io.id = v.inventario_id AND io.situacao <> 'ATIVO' AND io.origem <> 'BIPAGEM'
      JOIN linha_inventario lo ON lo.id = v.linha_inventario_id
      JOIN palete p ON p.id = v.palete_id
      LEFT JOIN endereco_posicao ep ON ep.posicao_id = p.posicao_id AND ep.situacao = 'CONFIRMADO'
     WHERE v.escopo_id = ${escopoId}::uuid AND v.situacao = 'ATIVO' AND p.arquivado_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM ativa a WHERE a.acao::text = 'JA_IMPORTADO' AND a.identidade_documento = v.identidade_documento AND a.endereco_canonico = lo.endereco_canonico)
     ORDER BY p.codigo, lo.linha_arquivo`;
  const vinculos = linhas.map((l): DecisaoVinculo => {
    const base = { vinculoId: l.id, paleteId: l.palete_id, palete: l.codigo, endereco: l.endereco, documento: l.documento, volumes: l.volumes, numeroAntigo: l.npal, inventario: l.inv, linha: l.linha };
    const fonte = `${inv.codigo} (base ${dataBr(dataBase)})`;
    if (l.janela) return { ...base, decisao: 'MANTER', motivo: 'Tem volumes registrados numa janela: tratar na janela.' };
    if (l.movido) return { ...base, decisao: 'MANTER', motivo: 'Palete movido depois do inventário ativo: a fonte não descreve o local atual.' };
    if (l.confirmado) return { ...base, decisao: 'MANTER', motivo: 'Contagem positiva neste palete depois da data-base (validação humana).' };
    if (l.em_outro !== null) return { ...base, decisao: 'ENCERRAR', motivo: `Consta do ${fonte} no palete ${l.em_outro}: o vínculo antigo é encerrado (a ocorrência atual já representa a nota).` };
    if (l.na_ativa) return { ...base, decisao: 'VALIDACAO', motivo: `Consta do ${fonte} só sem alocação (linha em revisão): local físico a confirmar.` };
    const numerosEnd = l.numeros_end ?? [];
    if (l.endereco === null || !l.end_na_fonte) return { ...base, decisao: 'MANTER', motivo: `Endereço fora do ${fonte}: a ausência sozinha não basta.` };
    if (numerosEnd.length === 0) return { ...base, decisao: 'MANTER', motivo: `O ${fonte} não informa N° Pallet em ${l.endereco}: sem como comparar, a ausência sozinha não basta.` };
    if (l.npal !== null && numerosEnd.includes(l.npal)) return { ...base, decisao: 'MANTER', motivo: `Mesmo N° Pallet (${l.npal}) no endereço do ${fonte}: a ausência sozinha não basta.` };
    return {
      ...base,
      decisao: 'VALIDACAO',
      motivo: `No ${fonte}, ${l.endereco} tem o palete ${numerosEnd.join('/')}; esta nota (${l.inv}${l.npal === null ? '' : `, N° Pallet ${l.npal}`}) não consta da versão atual: local físico desconhecido.`,
    };
  });
  return { inventario, numeros, numerosPendentes, vinculos, paletesMovidos };
}

export interface ResultadoCorrecao {
  operacaoId: string;
  numeros: number;
  encerrados: number;
  validacao: number;
  mantidos: number;
}

/** Aplica o plano numa transação (nada é apagado; tudo fica no histórico e na auditoria). */
export async function aplicarCorrecao(tx: Transacao, escopo: Escopo, plano: PlanoCorrecao, autor: { usuarioId: string; requestId: string }, agora: Date, motivoGeral: string): Promise<ResultadoCorrecao> {
  const operacaoId = randomUUID();
  // Mesmo bloqueio da carga do inventário: nenhuma carga roda junto com a correção.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`importacao:${escopo.id}`}, 0))`;
  for (const t of plano.numeros) {
    const [atual] = await tx.$queryRaw<{ codigo: string }[]>`SELECT codigo FROM palete WHERE id = ${t.paleteId}::uuid AND escopo_id = ${escopo.id}::uuid`;
    if (atual?.codigo !== t.de) throw new Error(`O palete ${t.de} mudou desde o plano: refaça a simulação.`);
    await atribuirNumeroOperacional(tx, escopo.id, t.paleteId, t.para, {
      motivo: `Número operacional informado na fonte (N° Pallet ${t.para} em ${t.endereco}). ${motivoGeral}`,
      fonte: plano.inventario?.codigo ?? null,
      operacaoId,
      autorId: autor.usuarioId,
      requestId: autor.requestId,
      agora,
    });
  }
  // Motivos com o número novo dos paletes; as decisões precisam ser as mesmas da simulação.
  const replanejado = plano.numeros.length === 0 ? plano : await planejarCorrecao(tx, escopo.id);
  const decisaoDe = (p: PlanoCorrecao) => p.vinculos.map((v) => `${v.vinculoId}:${v.decisao}`).sort().join('|');
  if (decisaoDe(replanejado) !== decisaoDe(plano)) throw new Error('Os dados mudaram desde a simulação: refaça a simulação antes de aplicar.');
  let encerrados = 0;
  let validacao = 0;
  for (const d of replanejado.vinculos) {
    if (d.decisao === 'MANTER') continue;
    const [v] = await tx.$queryRaw<{ situacao: string; palete_id: string }[]>`
      SELECT situacao, palete_id::text FROM vinculo_documento_palete WHERE id = ${d.vinculoId}::uuid AND escopo_id = ${escopo.id}::uuid FOR UPDATE`;
    if (v?.situacao !== 'ATIVO' || v.palete_id !== d.paleteId) continue; // já tratado por outra pessoa: nada a fazer
    const [ref] = await tx.$queryRaw<{ id: string; codigo: string; endereco: string | null }[]>`
      SELECT p.id::text, p.codigo, coalesce(CASE WHEN ep.situacao = 'CONFIRMADO' THEN ep.endereco END, pos.codigo) AS endereco
        FROM palete p LEFT JOIN posicao pos ON pos.id = p.posicao_id LEFT JOIN endereco_posicao ep ON ep.posicao_id = p.posicao_id WHERE p.id = ${d.paleteId}::uuid`;
    const ocorrencia = { kind: 'IMPORTADO' as const, id: d.vinculoId, situacao: 'ATIVO', palete_id: d.paleteId, tipo: null, numero: null, remetente: null, cnpj: null };
    const motivo = `${d.motivo} ${motivoGeral}`.slice(0, 300);
    if (d.decisao === 'ENCERRAR') {
      await tx.vinculoDocumentoPalete.update({ where: { id: d.vinculoId }, data: { situacao: 'ENCERRADO', encerradoEm: agora, encerradoPorId: autor.usuarioId, motivoEncerramento: motivo } });
      await registrarHistoricoConteudo(tx, escopo.id, operacaoId, ocorrencia, 'ENCERRAMENTO', ref ?? null, null, 'ENCERRADO', d.volumes, motivo, autor.usuarioId, agora, { reconciliacao: true });
      encerrados++;
    } else {
      await tx.vinculoDocumentoPalete.update({ where: { id: d.vinculoId }, data: { situacao: 'VALIDACAO' } });
      await registrarHistoricoConteudo(tx, escopo.id, operacaoId, ocorrencia, 'VALIDACAO', ref ?? null, null, 'VALIDACAO', d.volumes, motivo, autor.usuarioId, agora, { reconciliacao: true });
      validacao++;
    }
  }
  const mantidos = plano.vinculos.filter((d) => d.decisao === 'MANTER').length;
  await registrarEvento(tx, {
    acao: 'RECONCILIACAO_ALOCACOES',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'ESCOPO',
    alvoId: escopo.id,
    detalhes: { operacao: operacaoId, inventario: plano.inventario?.codigo ?? null, numeros: plano.numeros.length, encerrados, validacao, mantidos, motivo: motivoGeral },
    requestId: autor.requestId,
  });
  return { operacaoId, numeros: plano.numeros.length, encerrados, validacao, mantidos };
}
