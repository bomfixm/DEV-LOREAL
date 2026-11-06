import { z } from 'zod';

/**
 * Separação do cliente (5 nov. 2026): a planilha do cliente diz quais notas
 * pegar, pela coluna NUMERO. Todo palete com uma dessas notas fica roxo no mapa
 * e a nota vem primeiro, destacada, na janela do palete. O cruzamento é feito na
 * leitura. Não reserva, não libera e não altera estoque.
 */

/**
 * NO_MAPA: em palete com posição; SEM_POSICAO: em palete fora do mapa;
 * EM_VALIDACAO: só em "Validação sem endereço"; SEM_PALETE: não está em palete nenhum.
 */
export const SituacaoNotaSeparacaoSchema = z.enum(['NO_MAPA', 'SEM_POSICAO', 'EM_VALIDACAO', 'SEM_PALETE']);
export type SituacaoNotaSeparacao = z.infer<typeof SituacaoNotaSeparacaoSchema>;

export const ROTULOS_SITUACAO_NOTA_SEPARACAO: Readonly<Record<SituacaoNotaSeparacao, string>> = {
  NO_MAPA: 'No mapa',
  SEM_POSICAO: 'Em palete sem posição',
  EM_VALIDACAO: 'Em validação (sem endereço)',
  SEM_PALETE: 'Sem palete',
};

export const LocalNotaSeparacaoSchema = z.object({
  palletId: z.uuid(),
  palletCode: z.string().min(1),
  positionCode: z.string().nullable(),
  address: z.string().nullable(),
});
export type LocalNotaSeparacao = z.infer<typeof LocalNotaSeparacaoSchema>;

export const NotaSeparacaoSchema = z.object({
  row: z.number().int().positive(),
  number: z.string().min(1),
  type: z.string().nullable(),
  delivery: z.string().nullable(),
  volumes: z.string().nullable(),
  sender: z.string().nullable(),
  /** Palete e rua como vieram na planilha do cliente (só referência; quem manda é a NUMERO). */
  informedPallet: z.string().nullable(),
  informedAddress: z.string().nullable(),
  /** Tudo o que veio na linha da planilha: coluna → valor. */
  values: z.record(z.string(), z.string()),
  situation: SituacaoNotaSeparacaoSchema,
  locations: z.array(LocalNotaSeparacaoSchema),
});
export type NotaSeparacao = z.infer<typeof NotaSeparacaoSchema>;

export const SeparacaoClienteSchema = z.object({
  id: z.uuid(),
  fileName: z.string().min(1),
  window: z.string().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.string().min(1),
  /** Paletes distintos com posição no mapa (os que ficam roxos). */
  palletsOnMap: z.number().int().nonnegative(),
  /** Todas as colunas da planilha, na ordem em que vieram. */
  headers: z.array(z.string()),
  notes: z.array(NotaSeparacaoSchema),
});
export type SeparacaoCliente = z.infer<typeof SeparacaoClienteSchema>;

/** Uma nota lida da planilha no navegador. */
export const NotaEnviadaSeparacaoSchema = z.object({
  row: z.number().int().positive(),
  number: z.string().trim().min(1).max(64),
  type: z.string().max(300).nullable(),
  delivery: z.string().max(300).nullable(),
  volumes: z.string().max(300).nullable(),
  sender: z.string().max(300).nullable(),
  informedPallet: z.string().max(300).nullable(),
  informedAddress: z.string().max(300).nullable(),
  values: z.record(z.string().max(100), z.string().max(300)),
});
export type NotaEnviadaSeparacao = z.infer<typeof NotaEnviadaSeparacaoSchema>;

/** POST /separacoes: o navegador lê a planilha e manda só as notas (o arquivo real passa do limite de envio da Vercel). */
export const EnviarSeparacaoSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  window: z.string().max(300).nullable(),
  headers: z.array(z.string().max(100)).max(200),
  notes: z.array(NotaEnviadaSeparacaoSchema).min(1).max(5_000),
});
export type EnviarSeparacao = z.infer<typeof EnviarSeparacaoSchema>;

export const ListaSeparacoesSchema = z.object({ items: z.array(SeparacaoClienteSchema) });
export type ListaSeparacoes = z.infer<typeof ListaSeparacoesSchema>;
