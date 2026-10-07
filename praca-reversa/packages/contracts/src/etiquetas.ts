import { z } from 'zod';

/** Máximo de etiquetas por pedido (impressão em lote). */
export const LIMITE_ETIQUETAS = 50;

/** GET /api/v1/etiquetas?ids=<uuid>,<uuid>… */
export const FiltroEtiquetasSchema = z.object({
  ids: z
    .string()
    .trim()
    .min(1)
    .transform((texto) => [...new Set(texto.split(',').map((id) => id.trim().toLowerCase()))])
    .pipe(z.array(z.uuid()).min(1).max(LIMITE_ETIQUETAS)),
});

export const AmbienteSchema = z.enum(['desenvolvimento', 'teste', 'producao']);
export type Ambiente = z.infer<typeof AmbienteSchema>;

/**
 * Dados de uma etiqueta interna. O QR contém somente `url` (rota autenticada do
 * palete pelo ID permanente): sem produto, quantidade, documento ou credencial.
 * A posição é informação da data de impressão, não identidade do palete.
 */
export const EtiquetaSchema = z.object({
  palletId: z.uuid(),
  code: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  positionCode: z.string().min(1).nullable(),
  positionProvisional: z.boolean().nullable(),
});
export type Etiqueta = z.infer<typeof EtiquetaSchema>;

export const LoteEtiquetasSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    environment: AmbienteSchema,
    /** URL base configurada no servidor (APP_URL_PUBLICA). */
    baseUrl: z.url({ protocol: /^https?$/ }),
    /** A URL base aponta para este computador (localhost): não abre em outro aparelho. */
    localAddress: z.boolean(),
    scope: z.object({ name: z.string().min(1), demo: z.boolean() }),
    labels: z.array(EtiquetaSchema).min(1).max(LIMITE_ETIQUETAS),
  })
  .superRefine((lote, ctx) => {
    for (const etiqueta of lote.labels) {
      if (etiqueta.url !== urlDoPalete(lote.baseUrl, etiqueta.palletId)) {
        ctx.addIssue({ code: 'custom', message: `Link da etiqueta ${etiqueta.code} não corresponde ao ID do palete.` });
      }
    }
  });
export type LoteEtiquetas = z.infer<typeof LoteEtiquetasSchema>;

/** Rota autenticada do palete na interface. */
export function urlDoPalete(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/paletes/${id}`;
}

/** Endereços que só funcionam no próprio computador. */
export function ehEnderecoLocal(host: string): boolean {
  const nome = host.replace(/^\[|\]$/g, '').toLowerCase();
  return nome === 'localhost' || nome.endsWith('.localhost') || nome === '::1' || nome.startsWith('127.') || nome === '0.0.0.0';
}
