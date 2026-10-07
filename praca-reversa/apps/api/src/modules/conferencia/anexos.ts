/**
 * Anexos da conferência (etapa 09): foto do palete, nota de entrega. Mesmas
 * regras dos anexos de claims e janelas: bytes privados no banco, tipo pelo
 * conteúdo, limite de tamanho, SHA-256 (conferido também por CHECK), autor e
 * horário; imutáveis; sem URL pública. Só entram durante a contagem
 * (EM_ANDAMENTO) e não mudam saldo, liberação nem a própria contagem.
 */
import { LIMITE_ANEXOS_CONFERENCIA, nomeArquivoSeguro, type AnexoConferencia } from '@praca-reversa/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { tipoDoConteudo } from '../claims/evidencias.js';
import type { Autor } from './servico.js';

const selecao = { id: true, nome: true, tipoConteudo: true, tamanho: true, sha256: true, enviadoEm: true, enviadoPor: { select: { login: true, nome: true } } } as const;

export function anexoConferencia(a: {
  id: string;
  nome: string;
  tipoConteudo: string;
  tamanho: number;
  sha256: string;
  enviadoEm: Date;
  enviadoPor: { login: string; nome: string };
}): AnexoConferencia {
  return {
    id: a.id,
    name: a.nome,
    contentType: a.tipoConteudo as AnexoConferencia['contentType'],
    size: a.tamanho,
    sha256: a.sha256,
    uploadedBy: { login: a.enviadoPor.login, name: a.enviadoPor.nome },
    uploadedAt: a.enviadoEm.toISOString(),
  };
}

export async function anexosDaConferencia(db: Banco | Transacao, escopoId: string, conferenciaId: string): Promise<AnexoConferencia[]> {
  const anexos = await db.anexoConferencia.findMany({ where: { escopoId, conferenciaId }, select: selecao, orderBy: [{ enviadoEm: 'asc' }, { id: 'asc' }] });
  return anexos.map(anexoConferencia);
}

/**
 * Grava o anexo junto com a auditoria e a chave de idempotência (mesma
 * transação): um envio interrompido não deixa metadado sem arquivo nem
 * arquivo sem metadado. O nome recebido é só rótulo (sanitizado); nunca vira
 * caminho. Mesmo conteúdo na mesma conferência devolve o anexo existente.
 */
export async function enviarAnexoConferencia(
  tx: Transacao,
  escopoId: string,
  conferenciaId: string,
  nome: string,
  conteudo: Buffer,
  maxBytes: number,
  autor: Autor,
  agora: Date,
): Promise<AnexoConferencia> {
  const travada = await tx.$queryRaw<{ situacao: string; numero: number; palete_id: string }[]>`
    SELECT situacao::text, numero, palete_id::text FROM sessao_conferencia WHERE id = ${conferenciaId}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  const sessao = travada[0];
  if (!sessao) throw naoEncontrado('Conferência não encontrada neste escopo.');
  if (sessao.situacao !== 'EM_ANDAMENTO') {
    throw new ErroHttp(409, 'CONFLITO', `A conferência nº ${String(sessao.numero)} não está em andamento: anexos só entram durante a contagem.`);
  }
  if (conteudo.length === 0) throw new ErroHttp(400, 'ANEXO_INVALIDO', 'Arquivo vazio.');
  if (conteudo.length > maxBytes) throw new ErroHttp(413, 'ANEXO_INVALIDO', `Anexo acima do limite de ${String(Math.round(maxBytes / 1_048_576))} MB.`);
  const tipo = tipoDoConteudo(conteudo);
  if (tipo === null) throw new ErroHttp(415, 'ANEXO_INVALIDO', 'Tipo de anexo não aceito: envie foto (JPEG, PNG, WebP) ou PDF.');
  const sha256 = createHash('sha256').update(conteudo).digest('hex');
  const existente = await tx.anexoConferencia.findFirst({ where: { escopoId, conferenciaId, sha256 }, select: selecao });
  if (existente) return anexoConferencia(existente);
  const quantidade = await tx.anexoConferencia.count({ where: { escopoId, conferenciaId } });
  if (quantidade >= LIMITE_ANEXOS_CONFERENCIA) {
    throw new ErroHttp(409, 'ANEXO_INVALIDO', `Esta conferência já tem ${String(LIMITE_ANEXOS_CONFERENCIA)} anexos (limite).`);
  }
  const id = randomUUID();
  const criado = await tx.anexoConferencia.create({
    data: {
      id,
      escopoId,
      conferenciaId,
      nome: nomeArquivoSeguro(nome),
      tipoConteudo: tipo,
      tamanho: conteudo.length,
      sha256,
      conteudo: new Uint8Array(conteudo),
      enviadoPorId: autor.usuarioId,
      enviadoEm: agora,
    },
    select: selecao,
  });
  await registrarEvento(tx, {
    acao: 'CONFERENCIA_ANEXO_ENVIADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId,
    alvoTipo: 'CONFERENCIA',
    alvoId: conferenciaId,
    detalhes: { numero: sessao.numero, palete: sessao.palete_id, anexo: id, tipo, tamanho: conteudo.length, sha256 },
    requestId: autor.requestId,
  });
  return anexoConferencia(criado);
}

/** Conteúdo do anexo, só da conferência e do escopo informados (outro escopo: 404). */
export async function lerAnexoConferencia(db: Banco, escopoId: string, conferenciaId: string, anexoId: string) {
  const anexo = await db.anexoConferencia.findFirst({
    where: { id: anexoId, conferenciaId, escopoId },
    select: { nome: true, tipoConteudo: true, conteudo: true, sha256: true },
  });
  if (!anexo) throw naoEncontrado('Anexo não encontrado nesta conferência.');
  return anexo;
}
