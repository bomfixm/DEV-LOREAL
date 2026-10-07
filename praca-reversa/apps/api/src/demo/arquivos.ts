import {
  CondicaoMaterialSchema,
  EstadoConferenciaSchema,
  EstadoFluxoSchema,
  EstadoLiberacaoSchema,
} from '@praca-reversa/contracts';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { RAIZ_REPOSITORIO } from '../config.js';
import { ArquivoDesenhoAprovadoSchema } from '../modules/layout/desenho-aprovado.js';

const ItemExemploSchema = z.object({
  sku: z.string().min(1),
  description: z.string().min(1),
  lot: z.string().min(1).nullable(),
  returnReference: z.string().min(1).nullable(),
  quantity: z.number().int().nonnegative(),
  unit: z.string().min(1),
  condition: CondicaoMaterialSchema,
});
export type ItemExemplo = z.infer<typeof ItemExemploSchema>;

/** examples/paletes-demo.json (fornecido com a especificação). */
export const ArquivoPaletesSchema = z.object({
  dataMode: z.literal('DEMO'),
  notice: z.string().min(1),
  zone: z.string().min(1),
  rows: z.array(z.string().min(1)).min(1),
  columns: z.array(z.string().min(1)).min(1),
  pallets: z.array(
    z.object({
      id: z.uuid(),
      code: z.string().min(1),
      address: z.string().min(1).nullable(),
      countState: EstadoConferenciaSchema,
      releaseState: EstadoLiberacaoSchema,
      flowState: EstadoFluxoSchema,
      currentItems: z.array(ItemExemploSchema).nullable(),
      observations: z.array(ItemExemploSchema).nullable().optional(),
      declaredItems: z.array(ItemExemploSchema).nullable().optional(),
      pendingReason: z.string().min(1).nullable(),
    }),
  ),
});
export type ArquivoPaletes = z.infer<typeof ArquivoPaletesSchema>;

const inteiroPositivo = z.number().int().positive();

/** examples/layout-praca-informado.json: configuração central do esquema informado. */
export const ArquivoLayoutInformadoSchema = z.object({
  dataMode: z.literal('DEMO'),
  fonte: z.string().min(1),
  aviso: z.string().min(1),
  layout: z.object({
    id: z.uuid(),
    codigo: z.string().min(1),
    nome: z.string().min(1),
    versao: z.string().min(1),
    totalCapacity: z.number().int().nonnegative().nullable(),
  }),
  geometria: z.object({
    unidade: z.literal('UNIDADE_DE_DESENHO'),
    margem: inteiroPositivo,
    larguraRotuloFileira: inteiroPositivo,
    larguraPosicao: inteiroPositivo,
    alturaPosicao: inteiroPositivo,
    espacoEntrePosicoes: z.number().int().nonnegative(),
    espacoDentroDoPar: z.number().int().nonnegative(),
    espacoEntreBlocos: inteiroPositivo,
    alturaTituloBloco: inteiroPositivo,
  }),
  sequencia: z
    .array(
      z.object({
        tipo: z.enum(['UNICA', 'PAR']),
        posicoesPorFileira: inteiroPositivo,
        repeticoes: inteiroPositivo,
        situacao: z.string().min(1),
        titulo: z.string().min(1),
      }),
    )
    .min(1),
});
export type ArquivoLayoutInformado = z.infer<typeof ArquivoLayoutInformadoSchema>;

/** examples/mapeamento-fixtures-etapa-02.json: novas posições das fixtures da etapa 01. */
export const ArquivoMapeamentoSchema = z.object({
  dataMode: z.literal('DEMO'),
  motivo: z.string().min(1),
  mapeamento: z.array(
    z.object({
      paleteId: z.uuid(),
      codigo: z.string().min(1),
      enderecoEtapa01: z.string().min(1),
      posicaoEtapa02: z.string().min(1),
    }),
  ),
});
export type ArquivoMapeamento = z.infer<typeof ArquivoMapeamentoSchema>;

function ler<T>(nome: string, schema: z.ZodType<T>): T {
  const conteudo: unknown = JSON.parse(readFileSync(`${RAIZ_REPOSITORIO}examples/${nome}`, 'utf8'));
  return schema.parse(conteudo);
}

export function lerArquivosDemo() {
  return {
    paletes: ler('paletes-demo.json', ArquivoPaletesSchema),
    layoutInformado: ler('layout-praca-informado.json', ArquivoLayoutInformadoSchema),
    /** Desenho aprovado: geometria do layout da demonstração desde o complemento "seleção do cliente". */
    desenhoAprovado: ler('layout-desenho-aprovado.json', ArquivoDesenhoAprovadoSchema),
    mapeamento: ler('mapeamento-fixtures-etapa-02.json', ArquivoMapeamentoSchema),
  };
}
