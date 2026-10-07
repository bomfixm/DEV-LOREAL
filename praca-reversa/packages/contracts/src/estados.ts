import { z } from 'zod';

/**
 * Estados propostos em docs/DADOS-E-REGRAS.md. Os valores são códigos estáveis;
 * os rótulos em português ficam na interface.
 */
export const EstadoConferenciaSchema = z.enum([
  'NAO_CONFERIDO',
  'PARCIAL',
  'AGUARDANDO_VALIDACAO',
  'RECONCILIADO',
]);
export type EstadoConferencia = z.infer<typeof EstadoConferenciaSchema>;

export const EstadoLiberacaoSchema = z.enum(['PENDENTE', 'BLOQUEADO', 'LIBERADO']);
export type EstadoLiberacao = z.infer<typeof EstadoLiberacaoSchema>;

export const EstadoFluxoSchema = z.enum(['EM_ESTOQUE', 'RESERVADO', 'EXPEDIDO', 'VAZIO_ARQUIVADO']);
export type EstadoFluxo = z.infer<typeof EstadoFluxoSchema>;

export const CondicaoMaterialSchema = z.enum(['SAUDAVEL', 'AVARIADO', 'EM_AVALIACAO']);
export type CondicaoMaterial = z.infer<typeof CondicaoMaterialSchema>;

/** Tipo do documento que declara uma linha de conteúdo (sem valor: origem pendente). */
export const TipoOrigemDocumentoSchema = z.enum(['DEVOLUCAO', 'NOTA_FISCAL', 'MANIFESTO', 'OUTRO']);
export type TipoOrigemDocumento = z.infer<typeof TipoOrigemDocumentoSchema>;

/** Como o código legível do palete foi definido no cadastro. */
export const OrigemCodigoPaleteSchema = z.enum(['EXISTENTE', 'GERADO', 'DEMONSTRACAO']);
export type OrigemCodigoPalete = z.infer<typeof OrigemCodigoPaleteSchema>;

export const ESTADOS_CONFERENCIA = EstadoConferenciaSchema.options;
export const TIPOS_ORIGEM_DOCUMENTO = TipoOrigemDocumentoSchema.options;
export const ESTADOS_LIBERACAO = EstadoLiberacaoSchema.options;
export const ESTADOS_FLUXO = EstadoFluxoSchema.options;
export const CONDICOES_MATERIAL = CondicaoMaterialSchema.options;
