import { z } from 'zod';
import { PerfilSchema } from './acesso.js';

/** Login: 3 a 64 caracteres minúsculos, dígitos, ponto, hífen ou sublinhado. */
export const NovoLoginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,64}$/, 'Use de 3 a 64 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.');

/** Política mínima de senha: 12 a 256 caracteres. */
export const NovaSenhaSchema = z.string().min(12, 'A senha precisa de pelo menos 12 caracteres.').max(256);

export const CriarUsuarioSchema = z.object({
  login: NovoLoginSchema,
  name: z.string().trim().min(2).max(120),
  initialPassword: NovaSenhaSchema,
  role: PerfilSchema,
});
export type CriarUsuario = z.infer<typeof CriarUsuarioSchema>;

export const AlterarVinculoSchema = z.object({
  role: PerfilSchema,
  active: z.boolean(),
  /**
   * Concessão explícita de `claim.aprovar_financeiro` (só analista de claims).
   * Ausente = mantém a atual; mudar para outro perfil retira a concessão.
   */
  financialApproval: z.boolean().optional(),
});
export type AlterarVinculo = z.infer<typeof AlterarVinculoSchema>;

export const AlterarContaSchema = z.object({ active: z.boolean() });
export type AlterarConta = z.infer<typeof AlterarContaSchema>;

export const UsuarioAdminSchema = z.object({
  id: z.uuid(),
  login: z.string().min(1),
  name: z.string().min(1),
  accountActive: z.boolean(),
  role: PerfilSchema,
  membershipActive: z.boolean(),
  financialApproval: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type UsuarioAdmin = z.infer<typeof UsuarioAdminSchema>;

export const ListaUsuariosSchema = z.object({ items: z.array(UsuarioAdminSchema) });
export type ListaUsuarios = z.infer<typeof ListaUsuariosSchema>;

export const ResultadoAuditoriaSchema = z.enum(['SUCESSO', 'NEGADO', 'FALHA']);

export const EventoAuditoriaSchema = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  action: z.string().min(1),
  result: ResultadoAuditoriaSchema,
  actor: z.object({ id: z.uuid(), login: z.string() }).nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
});
export type EventoAuditoria = z.infer<typeof EventoAuditoriaSchema>;

export const FiltroAuditoriaSchema = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  antesDe: z.iso.datetime().optional(),
});

export const ListaAuditoriaSchema = z.object({
  items: z.array(EventoAuditoriaSchema),
  nextCursor: z.iso.datetime().nullable(),
});
export type ListaAuditoria = z.infer<typeof ListaAuditoriaSchema>;

/** Cabeçalho obrigatório nas mutações administrativas. */
export const CABECALHO_IDEMPOTENCIA = 'idempotency-key';
export const ChaveIdempotenciaSchema = z.string().regex(/^[A-Za-z0-9_-]{8,200}$/);
