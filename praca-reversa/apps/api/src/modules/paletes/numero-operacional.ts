/**
 * Número operacional do palete (21 out. 2026): o código apresentado é o N°
 * Pallet da operação ("Palete 256"); o identificador gerado (PR-…) fica como
 * legado, pesquisável e nunca reutilizado. A troca preserva o ID técnico, a
 * etiqueta QR (link pelo ID), contagens e histórico, e fica registrada em
 * `historico_codigo_palete` e na auditoria.
 */
import { chaveDeCodigo } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Transacao } from '../../db/cliente.js';
import { ErroHttp } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';

/** Código gerado pelo sistema (sem número operacional): PR-000123 ou PAL-DEMO-001. */
export const ehCodigoGerado = (codigo: string): boolean => /^(PR|PAL-DEMO)-\d+$/.test(codigo);

export interface TrocaDeNumero {
  motivo: string;
  fonte: string | null;
  operacaoId: string;
  autorId: string | null;
  requestId: string;
  agora: Date;
}

/** Troca o código gerado do palete pelo número operacional (o anterior vira legado). Devolve o código anterior. */
export async function atribuirNumeroOperacional(tx: Transacao, escopoId: string, paleteId: string, numero: string, t: TrocaDeNumero): Promise<string> {
  const [atual] = await tx.$queryRaw<{ codigo: string; origem: string; legado: string | null }[]>`
    SELECT codigo, origem_codigo::text AS origem, codigo_legado AS legado FROM palete WHERE id = ${paleteId}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!atual) throw new ErroHttp(409, 'CONFLITO', 'Um palete do plano não existe mais.');
  if (!ehCodigoGerado(atual.codigo) || atual.legado !== null) throw new ErroHttp(409, 'CONFLITO', `O palete ${atual.codigo} já tem número operacional: não é trocado automaticamente.`);
  await tx.$executeRaw`
    UPDATE palete SET codigo = ${numero}, codigo_busca = ${chaveDeCodigo(numero)}, codigo_legado = ${atual.codigo},
                      origem_codigo = 'EXISTENTE', versao = versao + 1, atualizado_em = ${t.agora}
     WHERE id = ${paleteId}::uuid`;
  await tx.historicoCodigoPalete.create({
    data: {
      id: randomUUID(),
      escopoId,
      paleteId,
      codigoAnterior: atual.codigo,
      codigoNovo: numero,
      origemAnterior: atual.origem,
      origemNova: 'EXISTENTE',
      motivo: t.motivo.slice(0, 500),
      fonte: t.fonte,
      operacaoId: t.operacaoId,
      autorId: t.autorId,
      registradoEm: t.agora,
    },
  });
  await registrarEvento(tx, {
    acao: 'PALETE_NUMERO_OPERACIONAL',
    resultado: 'SUCESSO',
    atorUsuarioId: t.autorId,
    escopoId,
    alvoTipo: 'PALETE',
    alvoId: paleteId,
    detalhes: { operacao: t.operacaoId, de: atual.codigo, para: numero, fonte: t.fonte },
    requestId: t.requestId,
  });
  return atual.codigo;
}
