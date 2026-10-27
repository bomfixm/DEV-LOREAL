import { z } from 'zod';

/**
 * Termos de uso e aviso de privacidade (27 out. 2026). Cada texto é uma versão
 * imutável identificada por tipo + número + hash SHA-256 do conteúdo:
 * MINUTA → APROVADO (referência da aprovação humana registrada por quem tem
 * `documentos.administrar`) → PUBLICADO (um por tipo) → SUBSTITUIDO. Só a
 * versão publicada aparece sem autenticação; minutas ficam na área do
 * administrador. O aceite vale para a versão exata dos termos de uso e só é
 * exigido quando a instalação ativa `DOCUMENTOS_EXIGIR_ACEITE`; o aviso de
 * privacidade é informativo (não é consentimento).
 */

export const TipoDocumentoSchema = z.enum(['TERMOS_DE_USO', 'AVISO_DE_PRIVACIDADE']);
export type TipoDocumento = z.infer<typeof TipoDocumentoSchema>;

export const SituacaoDocumentoSchema = z.enum(['MINUTA', 'APROVADO', 'PUBLICADO', 'SUBSTITUIDO']);
export type SituacaoDocumento = z.infer<typeof SituacaoDocumentoSchema>;

/** Endereço público (sem autenticação) de cada tipo: /termos e /privacidade. */
export const SLUG_DOCUMENTO: Readonly<Record<TipoDocumento, string>> = {
  TERMOS_DE_USO: 'termos',
  AVISO_DE_PRIVACIDADE: 'privacidade',
};

export const NOME_DOCUMENTO: Readonly<Record<TipoDocumento, string>> = {
  TERMOS_DE_USO: 'Termos de uso',
  AVISO_DE_PRIVACIDADE: 'Aviso de privacidade',
};

const hash = z.string().regex(/^[0-9a-f]{64}$/);

/** GET /documentos-publicos/:slug — somente a versão publicada (404 NAO_PUBLICADO sem ela). */
export const DocumentoPublicadoSchema = z.object({
  type: TipoDocumentoSchema,
  version: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
  hash,
  publishedAt: z.iso.datetime(),
});
export type DocumentoPublicado = z.infer<typeof DocumentoPublicadoSchema>;

/** Uma versão na área do administrador (com o texto para a prévia interna). */
export const VersaoDocumentoSchema = z.object({
  id: z.uuid(),
  type: TipoDocumentoSchema,
  version: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
  hash,
  status: SituacaoDocumentoSchema,
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  approval: z
    .object({ reference: z.string(), responsible: z.string(), registeredBy: z.string(), registeredAt: z.iso.datetime() })
    .nullable(),
  publishedAt: z.iso.datetime().nullable(),
  publishedBy: z.string().nullable(),
  replacedAt: z.iso.datetime().nullable(),
  acceptances: z.number().int().nonnegative(),
});
export type VersaoDocumento = z.infer<typeof VersaoDocumentoSchema>;

/** GET /admin/documentos */
export const ListaDocumentosSchema = z.object({
  items: z.array(VersaoDocumentoSchema),
  /** DOCUMENTOS_EXIGIR_ACEITE da instalação (padrão: desativada). */
  acceptanceRequired: z.boolean(),
});
export type ListaDocumentos = z.infer<typeof ListaDocumentosSchema>;

const texto = (min: number, max: number, rotulo: string) =>
  z
    .string()
    .transform((s) => s.replace(/\r\n/g, '\n').trim())
    .pipe(z.string().min(min, `Informe ${rotulo}.`).max(max, `${rotulo[0]?.toUpperCase() ?? ''}${rotulo.slice(1)}: até ${String(max)} caracteres.`));

/** POST /admin/documentos — nova minuta (o servidor numera a versão e calcula o hash). */
export const NovaMinutaSchema = z
  .object({
    type: TipoDocumentoSchema,
    title: texto(3, 160, 'o título'),
    content: texto(20, 200_000, 'o texto'),
  })
  .strict();
export type NovaMinuta = z.infer<typeof NovaMinutaSchema>;

/**
 * POST /admin/documentos/:id/aprovacao — registra a referência da aprovação
 * humana (parecer, ata, e-mail corporativo, protocolo). O registro não é a
 * aprovação: só documenta quem aprovou fora do sistema e onde conferir.
 */
export const AprovacaoDocumentoSchema = z
  .object({
    reference: texto(5, 300, 'a referência da aprovação'),
    responsible: texto(3, 160, 'quem aprovou (nome e função)'),
  })
  .strict();
export type AprovacaoDocumento = z.infer<typeof AprovacaoDocumentoSchema>;

/** POST /admin/documentos/:id/publicacao e POST /documentos/:id/aceite — corpo vazio (usuário, versão e horário vêm do servidor). */
export const CorpoVazioSchema = z.object({}).strict();

const resumoPublicado = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  hash,
  publishedAt: z.iso.datetime(),
});

/** GET /documentos/situacao — o que está publicado e o aceite do usuário da sessão. */
export const SituacaoDocumentosSchema = z.object({
  acceptanceRequired: z.boolean(),
  terms: resumoPublicado.extend({ acceptedAt: z.iso.datetime().nullable() }).nullable(),
  privacy: resumoPublicado.nullable(),
  /** Termos publicados ainda não aceitos e exigidos pela instalação. */
  pending: z.boolean(),
});
export type SituacaoDocumentos = z.infer<typeof SituacaoDocumentosSchema>;

/** Resposta do aceite (repetir o aceite da mesma versão devolve o mesmo horário). */
export const AceiteDocumentoSchema = z.object({
  documentId: z.uuid(),
  version: z.number().int().positive(),
  hash,
  acceptedAt: z.iso.datetime(),
  repeated: z.boolean(),
});
export type AceiteDocumento = z.infer<typeof AceiteDocumentoSchema>;
