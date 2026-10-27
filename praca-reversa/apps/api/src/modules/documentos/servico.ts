import { createHash } from 'node:crypto';
import type {
  AceiteDocumento,
  AprovacaoDocumento,
  DocumentoPublicado,
  ListaDocumentos,
  NovaMinuta,
  SituacaoDocumentos,
  TipoDocumento,
  VersaoDocumento,
} from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';

/**
 * Termos de uso e aviso de privacidade (27 out. 2026). Regras no servidor e
 * no banco (gatilhos da migração 20261027100000): texto imutável por versão,
 * situação só avança, uma publicada por tipo, aceite só da versão publicada
 * dos termos com o hash dela. Nenhuma ação aqui cria aprovação ou aceite por
 * conta própria: a referência da aprovação é digitada por quem a registra.
 */

export function hashConteudo(conteudo: string): string {
  return createHash('sha256').update(conteudo, 'utf8').digest('hex');
}

/**
 * Tabelas ausentes (migração ainda não aplicada na instalação): avisa em vez
 * de "erro interno". 409, não 5xx: a interface não deve anunciar servidor
 * fora do ar por causa disso.
 */
export async function semTabelaAusente<T>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (erro) {
    if ((erro as { code?: unknown }).code === 'P2021') {
      throw new ErroHttp(409, 'NAO_INSTALADO', 'Termos e privacidade ainda não foram instalados neste servidor (migração pendente).');
    }
    throw erro;
  }
}

const iso = (d: Date) => d.toISOString();
const isoOuNulo = (d: Date | null) => (d === null ? null : d.toISOString());

const instalado = (erro: unknown) => !(erro instanceof ErroHttp && erro.codigo === 'NAO_INSTALADO');

export async function documentoPublicado(db: Banco, tipo: TipoDocumento): Promise<DocumentoPublicado> {
  // Sem as tabelas, nada foi publicado: a resposta é a mesma de "não publicado".
  const d = await semTabelaAusente(() => db.documentoPublico.findFirst({ where: { tipo, situacao: 'PUBLICADO' } })).catch((erro: unknown) => {
    if (instalado(erro)) throw erro;
    return null;
  });
  if (d?.publicadoEm == null) {
    throw new ErroHttp(404, 'NAO_PUBLICADO', 'Este documento ainda não tem versão aprovada publicada.');
  }
  return { type: tipo, version: d.versao, title: d.titulo, content: d.conteudo, hash: d.hash, publishedAt: iso(d.publicadoEm) };
}

const incluirNomes = {
  criadoPor: { select: { nome: true } },
  aprovadoPor: { select: { nome: true } },
  publicadoPor: { select: { nome: true } },
  _count: { select: { aceites: true } },
} as const;

export async function listarDocumentos(db: Banco, exigirAceite: boolean): Promise<ListaDocumentos> {
  const linhas = await semTabelaAusente(() =>
    db.documentoPublico.findMany({ include: incluirNomes, orderBy: [{ tipo: 'asc' }, { versao: 'desc' }] }),
  );
  const items: VersaoDocumento[] = linhas.map((d) => ({
    id: d.id,
    type: d.tipo as TipoDocumento,
    version: d.versao,
    title: d.titulo,
    content: d.conteudo,
    hash: d.hash,
    status: d.situacao as VersaoDocumento['status'],
    createdAt: iso(d.criadoEm),
    createdBy: d.criadoPor.nome,
    approval:
      d.aprovadoEm === null
        ? null
        : {
            reference: d.aprovacaoReferencia ?? '',
            responsible: d.aprovacaoResponsavel ?? '',
            registeredBy: d.aprovadoPor?.nome ?? 'Autor não disponível',
            registeredAt: iso(d.aprovadoEm),
          },
    publishedAt: isoOuNulo(d.publicadoEm),
    publishedBy: d.publicadoEm === null ? null : (d.publicadoPor?.nome ?? 'Autor não disponível'),
    replacedAt: isoOuNulo(d.substituidoEm),
    acceptances: d._count.aceites,
  }));
  return { items, acceptanceRequired: exigirAceite };
}

export async function criarMinuta(db: Banco, autorId: string, dados: NovaMinuta, requestId: string): Promise<string> {
  const hash = hashConteudo(dados.content);
  return semTabelaAusente(() =>
    db.$transaction(async (tx) => {
      // Numeração sem corrida: uma criação por tipo de cada vez.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`documento_publico:${dados.type}`}))`;
      const repetida = await tx.documentoPublico.findFirst({ where: { tipo: dados.type, hash }, select: { versao: true } });
      if (repetida !== null) {
        throw new ErroHttp(409, 'MINUTA_REPETIDA', `Este texto já é a versão ${String(repetida.versao)} deste documento. Texto novo gera versão nova.`);
      }
      const ultima = await tx.documentoPublico.aggregate({ where: { tipo: dados.type }, _max: { versao: true } });
      const versao = (ultima._max.versao ?? 0) + 1;
      const d = await tx.documentoPublico.create({
        data: { tipo: dados.type, versao, titulo: dados.title, conteudo: dados.content, hash, situacao: 'MINUTA', criadoPorId: autorId },
      });
      await registrarEvento(tx, {
        acao: 'DOCUMENTO_MINUTA_CRIADA',
        resultado: 'SUCESSO',
        atorUsuarioId: autorId,
        alvoTipo: 'documento_publico',
        alvoId: d.id,
        detalhes: { tipo: dados.type, versao, hash },
        requestId,
      });
      return d.id;
    }),
  );
}

async function travar(tx: Transacao, id: string) {
  const linhas = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "documento_publico" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (linhas.length === 0) throw naoEncontrado('Versão de documento não encontrada.');
  const d = await tx.documentoPublico.findUnique({ where: { id } });
  if (d === null) throw naoEncontrado('Versão de documento não encontrada.');
  return d;
}

export async function registrarAprovacao(db: Banco, autorId: string, id: string, dados: AprovacaoDocumento, agora: Date, requestId: string): Promise<void> {
  await semTabelaAusente(() =>
    db.$transaction(async (tx) => {
      const d = await travar(tx, id);
      if (d.situacao !== 'MINUTA') {
        throw new ErroHttp(409, 'SITUACAO_INVALIDA', `A versão ${String(d.versao)} já está ${d.situacao.toLowerCase()}: a aprovação registrada não é reescrita.`);
      }
      await tx.documentoPublico.update({
        where: { id },
        data: { situacao: 'APROVADO', aprovacaoReferencia: dados.reference, aprovacaoResponsavel: dados.responsible, aprovadoPorId: autorId, aprovadoEm: agora },
      });
      await registrarEvento(tx, {
        acao: 'DOCUMENTO_APROVACAO_REGISTRADA',
        resultado: 'SUCESSO',
        atorUsuarioId: autorId,
        alvoTipo: 'documento_publico',
        alvoId: id,
        detalhes: { tipo: d.tipo, versao: d.versao, hash: d.hash },
        requestId,
      });
    }),
  );
}

export async function publicar(db: Banco, autorId: string, id: string, agora: Date, requestId: string): Promise<void> {
  await semTabelaAusente(() =>
    db.$transaction(async (tx) => {
      const d = await travar(tx, id);
      if (d.situacao !== 'APROVADO') {
        throw new ErroHttp(
          409,
          'SITUACAO_INVALIDA',
          d.situacao === 'MINUTA'
            ? 'Minuta não é publicada: registre antes a referência da aprovação humana.'
            : `A versão ${String(d.versao)} já está ${d.situacao.toLowerCase()}.`,
        );
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`documento_publico:${d.tipo}`}))`;
      const anterior = await tx.documentoPublico.findFirst({ where: { tipo: d.tipo, situacao: 'PUBLICADO' }, select: { id: true, versao: true } });
      if (anterior !== null) {
        await tx.documentoPublico.update({ where: { id: anterior.id }, data: { situacao: 'SUBSTITUIDO', substituidoEm: agora } });
      }
      await tx.documentoPublico.update({ where: { id }, data: { situacao: 'PUBLICADO', publicadoPorId: autorId, publicadoEm: agora } });
      await registrarEvento(tx, {
        acao: 'DOCUMENTO_PUBLICADO',
        resultado: 'SUCESSO',
        atorUsuarioId: autorId,
        alvoTipo: 'documento_publico',
        alvoId: id,
        detalhes: { tipo: d.tipo, versao: d.versao, hash: d.hash, versaoSubstituida: anterior?.versao ?? null },
        requestId,
      });
    }),
  );
}

/** Termos publicados ainda não aceitos pelo usuário (null = nada pendente ou nada publicado). */
export async function termosPendentes(db: Banco, usuarioId: string): Promise<{ id: string; versao: number } | null> {
  const termos = await semTabelaAusente(() =>
    db.documentoPublico.findFirst({
      where: { tipo: 'TERMOS_DE_USO', situacao: 'PUBLICADO' },
      select: { id: true, versao: true, aceites: { where: { usuarioId }, select: { id: true } } },
    }),
  ).catch((erro: unknown) => {
    if (instalado(erro)) throw erro;
    return null;
  });
  return termos === null || termos.aceites.length > 0 ? null : { id: termos.id, versao: termos.versao };
}

export async function situacaoDoUsuario(db: Banco, usuarioId: string, exigirAceite: boolean): Promise<SituacaoDocumentos> {
  const publicados = await semTabelaAusente(() =>
    db.documentoPublico.findMany({
      where: { situacao: 'PUBLICADO' },
      select: { id: true, tipo: true, versao: true, titulo: true, hash: true, publicadoEm: true, aceites: { where: { usuarioId }, select: { aceitoEm: true } } },
    }),
  ).catch((erro: unknown) => {
    if (instalado(erro)) throw erro;
    return [];
  });
  const termos = publicados.find((d) => d.tipo === 'TERMOS_DE_USO') ?? null;
  const aviso = publicados.find((d) => d.tipo === 'AVISO_DE_PRIVACIDADE') ?? null;
  const resumo = (d: NonNullable<typeof termos>) => ({ id: d.id, version: d.versao, title: d.titulo, hash: d.hash, publishedAt: iso(d.publicadoEm ?? new Date(0)) });
  const aceitoEm = termos?.aceites[0]?.aceitoEm ?? null;
  return {
    acceptanceRequired: exigirAceite,
    terms: termos === null ? null : { ...resumo(termos), acceptedAt: isoOuNulo(aceitoEm) },
    privacy: aviso === null ? null : resumo(aviso),
    pending: exigirAceite && termos !== null && aceitoEm === null,
  };
}

/**
 * Aceite da versão publicada dos termos pelo usuário da sessão. Repetir
 * devolve o registro existente (sem duplicar); versão substituída ou aviso de
 * privacidade não recebem aceite.
 */
export async function aceitar(db: Banco, usuarioId: string, documentoId: string, requestId: string): Promise<AceiteDocumento> {
  return semTabelaAusente(() =>
    db.$transaction(async (tx) => {
      const d = await tx.documentoPublico.findUnique({ where: { id: documentoId }, select: { id: true, tipo: true, versao: true, hash: true, situacao: true } });
      if (d === null || d.situacao === 'MINUTA' || d.situacao === 'APROVADO') throw naoEncontrado('Versão publicada não encontrada.');
      if (d.tipo !== 'TERMOS_DE_USO') {
        throw new ErroHttp(409, 'SITUACAO_INVALIDA', 'O aviso de privacidade é informativo: não há aceite a registrar.');
      }
      const existente = await tx.aceiteDocumento.findUnique({ where: { documentoId_usuarioId: { documentoId, usuarioId } } });
      if (existente !== null) {
        return { documentId: d.id, version: d.versao, hash: existente.hash, acceptedAt: iso(existente.aceitoEm), repeated: true };
      }
      if (d.situacao !== 'PUBLICADO') {
        throw new ErroHttp(409, 'SITUACAO_INVALIDA', `A versão ${String(d.versao)} foi substituída: leia e aceite a versão publicada atual.`);
      }
      // Duplo clique: a chave única (documento, usuário) decide; o segundo devolve o primeiro.
      const inseridos = await tx.$executeRaw`
        INSERT INTO "aceite_documento" ("id", "documento_id", "usuario_id", "hash")
        VALUES (gen_random_uuid(), ${documentoId}::uuid, ${usuarioId}::uuid, ${d.hash})
        ON CONFLICT ("documento_id", "usuario_id") DO NOTHING`;
      const gravado = await tx.aceiteDocumento.findUniqueOrThrow({ where: { documentoId_usuarioId: { documentoId, usuarioId } } });
      if (inseridos === 0) return { documentId: d.id, version: d.versao, hash: gravado.hash, acceptedAt: iso(gravado.aceitoEm), repeated: true };
      await registrarEvento(tx, {
        acao: 'DOCUMENTO_ACEITO',
        resultado: 'SUCESSO',
        atorUsuarioId: usuarioId,
        alvoTipo: 'documento_publico',
        alvoId: documentoId,
        detalhes: { tipo: d.tipo, versao: d.versao, hash: d.hash },
        requestId,
      });
      return { documentId: d.id, version: d.versao, hash: gravado.hash, acceptedAt: iso(gravado.aceitoEm), repeated: false };
    }),
  );
}
