/**
 * Linhas do inventário que sustentam a informação atual de um palete
 * (endereço informado, referências). Uma nova versão do inventário mantém os
 * vínculos iguais ("já importado"): o vínculo mantido continua apontando para a
 * linha da versão em que foi gravado, agora substituída. Por isso vale a linha
 * do inventário ativo que liga o palete (aplicada, já importada ou repetida
 * agrupada) ou a que sustenta um vínculo documental ativo.
 */
import type { Banco, Transacao } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';

const { sql } = Prisma;

/** Fragmento SQL sobre os apelidos `li` (linha_inventario) e `i` (inventario_referencia). */
export const LINHA_VIGENTE = sql`(li.palete_id IS NOT NULL AND NOT li.endereco_livre AND (
  (i.situacao = 'ATIVO' AND (li.aplicada OR li.acao::text IN ('JA_IMPORTADO', 'DUPLICADA_ARQUIVO')))
  OR EXISTS (SELECT 1 FROM vinculo_documento_palete vv WHERE vv.linha_inventario_id = li.id AND vv.situacao = 'ATIVO')))`;

/** Linha da versão ativa que corresponde a um vínculo mantido (fotografia atual da origem). */
export interface LinhaAtualVinculo {
  id: string;
  linhaArquivo: number;
  enderecoCanonico: string | null;
  enderecoLido: string | null;
  remetente: string | null;
  mesAgenda: string | null;
  janelaReferencia: string | null;
  inventario: { id: string; codigo: string; descricao: string; referenciaConferencia: string; dataConferencia: Date | null };
}

/**
 * Para cada vínculo ativo gravado por uma versão já substituída do
 * inventário: a linha "já importada" da versão ativa com a mesma identidade
 * documental e o mesmo endereço (a menor, quando repetida). A origem citada
 * (inventário, linha, remetente, mês de agenda, janela) passa a ser a da
 * planilha atual; sem correspondência, vale a linha do próprio vínculo.
 */
export async function linhasAtuaisDosVinculos(db: Banco | Transacao, escopoId: string, vinculoIds: readonly string[]): Promise<Map<string, LinhaAtualVinculo>> {
  if (vinculoIds.length === 0) return new Map();
  const linhas = await db.$queryRaw<
    {
      vinculo_id: string;
      linha_id: string;
      linha_arquivo: number;
      endereco_canonico: string | null;
      endereco_lido: string | null;
      remetente: string | null;
      mes_agenda: string | null;
      janela_referencia: string | null;
      inventario_id: string;
      codigo: string;
      descricao: string;
      referencia_conferencia: string;
      data_conferencia: Date | null;
    }[]
  >`
    SELECT DISTINCT ON (v.id) v.id::text AS vinculo_id, l2.id::text AS linha_id, l2.linha_arquivo, l2.endereco_canonico, l2.endereco_lido, l2.remetente, l2.mes_agenda, l2.janela_referencia,
           i2.id::text AS inventario_id, i2.codigo, i2.descricao, i2.referencia_conferencia, i2.data_conferencia
      FROM vinculo_documento_palete v
      JOIN inventario_referencia io ON io.id = v.inventario_id AND io.situacao <> 'ATIVO'
      JOIN linha_inventario lo ON lo.id = v.linha_inventario_id
      JOIN linha_inventario l2 ON l2.escopo_id = v.escopo_id AND l2.acao::text = 'JA_IMPORTADO'
                              AND l2.identidade_documento = v.identidade_documento AND l2.endereco_canonico = lo.endereco_canonico
      JOIN inventario_referencia i2 ON i2.id = l2.inventario_id AND i2.situacao = 'ATIVO'
     WHERE v.escopo_id = ${escopoId}::uuid AND v.situacao = 'ATIVO' AND v.id = ANY(${[...new Set(vinculoIds)]}::uuid[])
     ORDER BY v.id, l2.criado_em DESC, l2.linha_arquivo`;
  return new Map(
    linhas.map((l) => [
      l.vinculo_id,
      {
        id: l.linha_id,
        linhaArquivo: l.linha_arquivo,
        enderecoCanonico: l.endereco_canonico,
        enderecoLido: l.endereco_lido,
        remetente: l.remetente,
        mesAgenda: l.mes_agenda,
        janelaReferencia: l.janela_referencia,
        inventario: { id: l.inventario_id, codigo: l.codigo, descricao: l.descricao, referenciaConferencia: l.referencia_conferencia, dataConferencia: l.data_conferencia },
      },
    ]),
  );
}

/** Fragmento SQL: a linha atual (alias `la`) de cada vínculo `v` mantido de versão substituída (LEFT JOIN LATERAL). */
export const LINHA_ATUAL_DO_VINCULO = sql`LEFT JOIN LATERAL (
    SELECT l2.linha_arquivo, l2.endereco_canonico, l2.endereco_lido, l2.remetente, i2.id AS inventario_id, i2.codigo AS inventario_codigo, i2.referencia_conferencia
      FROM linha_inventario lo
      JOIN inventario_referencia io ON io.id = lo.inventario_id AND io.situacao <> 'ATIVO'
      JOIN linha_inventario l2 ON l2.escopo_id = lo.escopo_id AND l2.acao::text = 'JA_IMPORTADO'
                              AND l2.identidade_documento = v.identidade_documento AND l2.endereco_canonico = lo.endereco_canonico
      JOIN inventario_referencia i2 ON i2.id = l2.inventario_id AND i2.situacao = 'ATIVO'
     WHERE lo.id = v.linha_inventario_id
     ORDER BY l2.criado_em DESC, l2.linha_arquivo
     LIMIT 1) la ON true`;

/**
 * Palete ligado a cada endereço completo ("15 - A120") por qualquer versão do
 * inventário: a linha mais recente com palete. Uma versão nova reaproveita o
 * palete (ID, QR e histórico) em vez de cadastrar outro no mesmo endereço.
 */
export async function paletesPorEndereco(db: Banco | Transacao, escopoId: string, enderecos: readonly string[]): Promise<Map<string, string>> {
  if (enderecos.length === 0) return new Map();
  const linhas = await db.$queryRaw<{ endereco: string; palete_id: string }[]>`
    SELECT DISTINCT ON (li.endereco_canonico) li.endereco_canonico AS endereco, li.palete_id::text
      FROM linha_inventario li
     WHERE li.escopo_id = ${escopoId}::uuid AND NOT li.endereco_livre AND li.palete_id IS NOT NULL
       AND li.endereco_canonico = ANY(${[...new Set(enderecos)]}::text[])
     ORDER BY li.endereco_canonico, li.criado_em DESC, li.linha_arquivo`;
  return new Map(linhas.map((l) => [l.endereco, l.palete_id]));
}
