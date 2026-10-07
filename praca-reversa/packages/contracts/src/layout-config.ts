import { z } from 'zod';
import { CodigoElementoSchema, CodigoPosicaoSchema } from './codigos.js';
import { FORMATO_PREFIXO_ENDERECO } from './enderecos.js';

/**
 * Configuração do layout (etapa 03). Toda alteração informa a revisão que o
 * usuário viu (`expectedRevision`): se outra pessoa alterou antes, a API
 * responde 409 e nada é gravado. IDs de posições nunca mudam; códigos e
 * coordenadas podem mudar sem afetar o vínculo dos paletes.
 */
const revisao = z.number().int().positive();
const rotulo = z.string().trim().min(2, 'Título: pelo menos 2 caracteres.').max(80, 'Título: até 80 caracteres.');
const deslocamento = z.number().int().min(-10_000).max(10_000);
const medida = z.number().int().positive().max(20_000);

export const CriarLayoutSchema = z.object({
  name: z.string().trim().min(2).max(120),
});
export type CriarLayout = z.infer<typeof CriarLayoutSchema>;

/** Bloco acrescentado ao final do layout (depois do último bloco desenhado). */
export const NovoBlocoSchema = z.object({
  expectedRevision: revisao,
  kind: z.enum(['UNICA', 'PAR']),
  positionsPerRow: z.number().int().min(1).max(60),
  title: rotulo,
});
export type NovoBloco = z.infer<typeof NovoBlocoSchema>;

/** Renomear ou deslocar um bloco/zona (junto com suas fileiras e posições). */
export const AlterarElementoSchema = z
  .object({
    expectedRevision: revisao,
    label: rotulo.optional(),
    dx: deslocamento.optional(),
    dy: deslocamento.optional(),
    /** Somente zonas: novas dimensões. */
    width: medida.optional(),
    height: medida.optional(),
    /** Somente blocos: nome operacional autorizado (ex.: "Fileira 15"); `null` remove. */
    operationalName: z.string().trim().min(2, 'Nome operacional: pelo menos 2 caracteres.').max(60).nullable().optional(),
    /** Somente blocos: prefixo do endereço real ("15", "GR"); `null` remove. */
    addressPrefix: z.string().trim().toUpperCase().regex(FORMATO_PREFIXO_ENDERECO, 'Prefixo: 1 a 4 letras ou dígitos (ex.: 15, GR).').nullable().optional(),
  })
  .refine(
    (a) =>
      a.label !== undefined ||
      (a.dx ?? 0) !== 0 ||
      (a.dy ?? 0) !== 0 ||
      a.width !== undefined ||
      a.height !== undefined ||
      a.operationalName !== undefined ||
      a.addressPrefix !== undefined,
    'Nenhuma alteração informada.',
  );
export type AlterarElemento = z.infer<typeof AlterarElementoSchema>;

export const NovaZonaSchema = z.object({
  expectedRevision: revisao,
  code: CodigoElementoSchema,
  label: rotulo,
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: medida,
  height: medida,
});
export type NovaZona = z.infer<typeof NovaZonaSchema>;

export const AlterarPosicaoSchema = z
  .object({
    expectedRevision: revisao,
    code: CodigoPosicaoSchema.optional(),
    /** `true` quando o código passa a ser o endereço oficial (deixa de ser provisório). */
    officialCode: z.boolean().optional(),
    available: z.boolean().optional(),
    unavailableReason: z.string().trim().min(3).max(200).nullable().optional(),
  })
  .refine(
    (a) => a.code !== undefined || a.officialCode !== undefined || a.available !== undefined,
    'Nenhuma alteração informada.',
  )
  .refine((a) => a.available !== false || (a.unavailableReason ?? null) !== null, {
    message: 'Informe o motivo da indisponibilidade.',
    path: ['unavailableReason'],
  });
export type AlterarPosicao = z.infer<typeof AlterarPosicaoSchema>;

/**
 * POST /layout/desenho-aprovado — cria o layout do desenho aprovado da praça
 * (examples/layout-desenho-aprovado.json): 194 posições ativas (FB01–FB07) e
 * 300 desativadas (DB01–DB07), com os nomes operacionais confirmados. Só em
 * escopo sem layout ativo com posições: nada existente é redesenhado.
 */
export const CriarDesenhoAprovadoSchema = z.object({
  name: z.string().trim().min(2).max(120).default('Praça da reversa — desenho aprovado'),
});
export type CriarDesenhoAprovado = z.input<typeof CriarDesenhoAprovadoSchema>;

export const RetirarPosicaoSchema = z.object({
  expectedRevision: revisao,
  reason: z.string().trim().min(3).max(300),
});
export type RetirarPosicao = z.infer<typeof RetirarPosicaoSchema>;

/** Resposta das alterações de layout. */
export const ResultadoLayoutSchema = z.object({
  layoutId: z.uuid(),
  revision: revisao,
  /** Resumo legível do que mudou. */
  summary: z.string().min(1),
});
export type ResultadoLayout = z.infer<typeof ResultadoLayoutSchema>;

export const ItemHistoricoLayoutSchema = z.object({
  revision: revisao,
  at: z.iso.datetime(),
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().nullable(),
  summary: z.string().min(1),
  actor: z.object({ login: z.string().min(1), name: z.string().min(1) }).nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
});
export type ItemHistoricoLayout = z.infer<typeof ItemHistoricoLayoutSchema>;

export const HistoricoLayoutSchema = z.object({ items: z.array(ItemHistoricoLayoutSchema) });
export type HistoricoLayout = z.infer<typeof HistoricoLayoutSchema>;
