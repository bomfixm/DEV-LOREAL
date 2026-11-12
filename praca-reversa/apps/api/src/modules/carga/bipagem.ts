/**
 * Bipagem de um palete de embarque fracionado (Expedição DHL, 12 nov. 2026).
 *
 * A operação bipa as caixas que vão num palete de embarque e exporta a mesma
 * planilha "Etiquetas" da bipagem da praça (Tipo, Número, Volumes, Lidos,
 * Remetente; um arquivo = um palete de embarque). Aqui só se LÊ: para cada NF
 * com Lidos > 0, as ocorrências ativas da praça com o mesmo número (sem zeros à
 * esquerda), com o disponível para esta janela. Uma única origem com saldo
 * suficiente vem sugerida; mais de uma pede escolha; nenhuma fica pendente.
 * A gravação é a criação normal do palete fracionado, com as mesmas validações
 * (saldo, FULL, palete na praça) — nada é gravado nesta leitura.
 */
import type { AnaliseBipagemEmbarque, LimitesImportacao, LinhaBipagemEmbarque, OrigemBipagemEmbarque, TipoVeiculo } from '@praca-reversa/contracts';
import { identidadeEmbarque } from '@praca-reversa/contracts';
import type { Banco } from '../../db/cliente.js';
import { ErroHttp } from '../../http/erros.js';
import { ErroArquivo } from '../importacao/arquivo/erros.js';
import { interpretarBipagem, reconhecerBipagem } from '../importacao/bipagem.js';
import { analisarArquivo } from '../importacao/servico.js';
import { lerJanelaCarga } from './leitura.js';
import { disponibilidade, lerOcorrencias, type RefOcorrencia } from './origem.js';

const semZeros = (t: string): string => t.trim().replace(/^0+(?=\d)/u, '');

export async function analisarBipagemEmbarque(
  db: Banco,
  escopoId: string,
  janelaId: string,
  conteudo: Buffer,
  nomeArquivo: string,
  limites: LimitesImportacao,
): Promise<AnaliseBipagemEmbarque> {
  await lerJanelaCarga(db, escopoId, janelaId);
  const { formato } = analisarArquivo(conteudo, nomeArquivo, limites);
  let lidas: ReturnType<typeof interpretarBipagem>;
  let aba: string | null;
  try {
    const r = reconhecerBipagem(conteudo, formato, limites);
    aba = r.tabela.opcoes.sheet;
    lidas = interpretarBipagem({ tabela: r.tabela, colunas: r.colunas, separador: 'VIRGULA', limites });
  } catch (erro) {
    if (erro instanceof ErroArquivo) throw new ErroHttp(422, 'ARQUIVO_INVALIDO', erro.message);
    throw erro;
  }

  const comErro = lidas.filter((l) => l.erros.length > 0);
  const positivas = lidas.filter((l) => l.erros.length === 0 && (l.volumes ?? 0) > 0 && l.numeroDocumento !== null);
  const chaves = [...new Set(positivas.map((l) => semZeros(l.numeroDocumento ?? '')))];

  // Ocorrências ativas com esses números, em paletes não arquivados.
  const achadas =
    chaves.length === 0
      ? []
      : await db.$queryRaw<{ id: string; kind: 'VINCULO' | 'CONTEUDO'; chave: string }[]>`
          SELECT v.id::text, 'VINCULO' AS kind, regexp_replace(btrim(v.numero_documento), '^0+(?=\\d)', '') AS chave
            FROM vinculo_documento_palete v JOIN palete p ON p.id = v.palete_id
           WHERE v.escopo_id = ${escopoId}::uuid AND v.situacao = 'ATIVO' AND p.arquivado_em IS NULL
             AND regexp_replace(btrim(v.numero_documento), '^0+(?=\\d)', '') = ANY(${chaves}::text[])
          UNION ALL
          SELECT c.id::text, 'CONTEUDO' AS kind, regexp_replace(btrim(c.numero_documento), '^0+(?=\\d)', '') AS chave
            FROM conteudo_palete c JOIN palete p ON p.id = c.palete_id
           WHERE c.escopo_id = ${escopoId}::uuid AND c.situacao = 'ATIVO' AND p.arquivado_em IS NULL AND c.numero_documento IS NOT NULL
             AND regexp_replace(btrim(c.numero_documento), '^0+(?=\\d)', '') = ANY(${chaves}::text[])`;
  const refs: RefOcorrencia[] = achadas.map((a) => ({ kind: a.kind, id: a.id }));
  const ocorrencias = await lerOcorrencias(db, escopoId, refs);
  const disp = await disponibilidade(db, escopoId, janelaId, refs.map((r) => r.id), new Map([...ocorrencias.values()].map((o) => [o.id, o.base])), null);

  // Endereço, situação na praça e FULL ativo de cada palete de origem.
  const paleteIds = [...new Set([...ocorrencias.values()].map((o) => o.palletId))];
  const paletes =
    paleteIds.length === 0
      ? []
      : await db.$queryRaw<{ id: string; endereco: string | null; na_praca: boolean; full_codigo: string | null; full_tipo: TipoVeiculo | null; full_sequencia: number | null; full_numero: number | null }[]>`
          SELECT p.id::text,
                 coalesce((SELECT ep.endereco FROM endereco_posicao ep WHERE ep.escopo_id = p.escopo_id AND ep.posicao_id = p.posicao_id ORDER BY ep.id LIMIT 1), pos.codigo) AS endereco,
                 (p.arquivado_em IS NULL AND p.estado_fluxo::text IN ('EM_ESTOQUE', 'RESERVADO')) AS na_praca,
                 f.codigo AS full_codigo, f.tipo AS full_tipo, f.sequencia AS full_sequencia, f.numero AS full_numero
            FROM palete p
            LEFT JOIN posicao pos ON pos.id = p.posicao_id
            LEFT JOIN LATERAL (
              SELECT j.codigo, v.tipo, v.sequencia, pe.numero
                FROM palete_embarque pe JOIN veiculo_carga v ON v.id = pe.veiculo_id JOIN janela_devolucao j ON j.id = v.janela_id
               WHERE pe.escopo_id = p.escopo_id AND pe.palete_origem_id = p.id AND pe.tipo = 'FULL' AND pe.situacao = 'ATIVO' AND v.situacao <> 'CANCELADO'
               LIMIT 1) f ON true
           WHERE p.escopo_id = ${escopoId}::uuid AND p.id = ANY(${paleteIds}::uuid[])`;
  const infoPalete = new Map(paletes.map((p) => [p.id, p]));

  const porChave = new Map<string, OrigemBipagemEmbarque[]>();
  for (const a of achadas) {
    const o = ocorrencias.get(a.id);
    if (!o?.ativa) continue;
    const p = infoPalete.get(o.palletId);
    const d = disp.get(o.id);
    const lista = porChave.get(a.chave) ?? [];
    lista.push({
      kind: o.kind,
      id: o.id,
      documentType: o.documentType,
      documentNumber: o.documentNumber,
      sender: o.sender,
      delivery: o.delivery,
      base: o.base,
      available: d?.available ?? null,
      separatedHere: d?.separatedHere ?? 0,
      palletId: o.palletId,
      palletCode: o.palletCode,
      address: p?.endereco ?? null,
      onSite: p?.na_praca === true,
      fullIn: p?.full_codigo != null && p.full_tipo !== null && p.full_sequencia !== null && p.full_numero !== null ? identidadeEmbarque(p.full_codigo, p.full_tipo, p.full_sequencia, p.full_numero) : null,
    });
    porChave.set(a.chave, lista);
  }

  const lines: LinhaBipagemEmbarque[] = positivas.map((l) => {
    const volumes = l.volumes ?? 0;
    // Mais disponível primeiro; mesma ordem para a escolha na tela.
    const candidates = [...(porChave.get(semZeros(l.numeroDocumento ?? '')) ?? [])].sort((a, b) => (b.available ?? -1) - (a.available ?? -1) || a.palletCode.localeCompare(b.palletCode, 'pt-BR', { numeric: true }));
    const servem = candidates.filter((c) => c.onSite && c.fullIn === null && c.available !== null && c.available >= volumes);
    const problem = candidates.length === 0 ? 'SEM_ORIGEM' : servem.length === 0 ? 'SEM_SALDO' : servem.length > 1 ? 'ESCOLHER' : null;
    return {
      row: l.numero,
      type: l.tipoLido,
      number: l.numeroDocumento ?? '',
      sender: l.remetente,
      volumes,
      expectedVolumes: l.previstos,
      candidates,
      suggested: servem.length === 1 ? (servem[0]?.id ?? null) : null,
      problem,
    };
  });

  return {
    fileName: nomeArquivo,
    sheet: aba,
    lines,
    withoutReads: lidas.filter((l) => l.erros.length === 0 && l.volumes === 0).length,
    errors: comErro.map((l) => ({ row: l.numero, messages: l.erros.map((e) => e.message) })),
  };
}
