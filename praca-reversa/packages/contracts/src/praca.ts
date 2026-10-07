import { z } from 'zod';
import { LadoFaixaSchema, SituacaoEnderecoSchema } from './enderecos.js';

/**
 * Geometria do layout interno da praça (docs/MAPA-ZOOM.md, docs/LAYOUT-PRACA.md).
 *
 * Contrato: origem no canto superior esquerdo, x cresce para a direita e
 * y cresce para baixo. A unidade é a "unidade de desenho" do layout e não
 * representa metros até existir uma escala validada.
 */
const coordenada = z.number().int().nonnegative();
const dimensao = z.number().int().positive();

export const RetanguloSchema = z.object({
  x: coordenada,
  y: coordenada,
  width: dimensao,
  height: dimensao,
});
export type Retangulo = z.infer<typeof RetanguloSchema>;

export const TipoElementoSchema = z.enum(['ZONA', 'BLOCO', 'CORREDOR', 'DOCA']);
export type TipoElemento = z.infer<typeof TipoElementoSchema>;

/** Elemento de orientação sem estoque. `labelBox` é o espaço reservado ao título. */
export const ElementoLayoutSchema = RetanguloSchema.extend({
  id: z.uuid(),
  kind: TipoElementoSchema,
  code: z.string().min(1),
  label: z.string().min(1),
  fictional: z.boolean(),
  labelBox: RetanguloSchema.nullable(),
  /** Nome operacional autorizado do bloco (ex.: "Fileira 15"); o código não muda. */
  operationalName: z.string().min(1).nullable().default(null),
  /** Prefixo dos endereços reais do bloco ("15", "GR"). */
  addressPrefix: z.string().min(1).nullable().default(null),
});
export type ElementoLayout = z.infer<typeof ElementoLayoutSchema>;

export const FileiraSchema = RetanguloSchema.extend({
  id: z.uuid(),
  code: z.string().min(1),
  label: z.string().min(1),
  order: z.number().int().positive(),
  blockCode: z.string().min(1).nullable(),
  /** Espaço reservado ao rótulo da fileira, fora dos alvos de seleção. */
  labelBox: RetanguloSchema,
  /** Lado na vista de referência (faixa dupla) ou faixa única; nulo = não informado. */
  side: LadoFaixaSchema.nullable().default(null),
});
export type Fileira = z.infer<typeof FileiraSchema>;

/** Posição endereçável. O `id` é permanente; `code` é o texto legível. */
export const PosicaoSchema = RetanguloSchema.extend({
  id: z.uuid(),
  code: z.string().min(1),
  /** Código provisório: não substitui o endereço oficial, ainda desconhecido. */
  provisionalCode: z.boolean(),
  rowId: z.uuid(),
  number: z.number().int().positive(),
  available: z.boolean(),
  /** Motivo registrado quando a posição está indisponível. */
  unavailableReason: z.string().min(1).nullable(),
  /** A ocupação física já foi levantada pelo cadastro. */
  occupancySurveyed: z.boolean(),
  /** Área desativada (pronta para ativar): fora da disponibilidade e da ocupação ativa. */
  deactivated: z.boolean().default(false),
  /** Endereço real da tabela de correspondência (proposto ou confirmado); nulo = pendente. */
  address: z.object({ text: z.string().min(1), state: SituacaoEnderecoSchema }).nullable().default(null),
});
export type Posicao = z.infer<typeof PosicaoSchema>;

const LayoutBaseSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  /** Identificação do esquema de origem (ex.: "esquema-2026-10-02"). */
  version: z.string().min(1),
  /** Revisão da configuração: aumenta a cada alteração registrada no histórico. */
  revision: z.number().int().positive(),
  name: z.string().min(1),
  unit: z.literal('UNIDADE_DE_DESENHO'),
  origin: z.literal('SUPERIOR_ESQUERDO'),
  width: dimensao,
  height: dimensao,
  /** Capacidade total confirmada; `null` enquanto não houver levantamento. */
  totalCapacity: z.number().int().nonnegative().nullable(),
  schematic: z.boolean(),
  fictional: z.boolean(),
  elements: z.array(ElementoLayoutSchema),
  rows: z.array(FileiraSchema),
  positions: z.array(PosicaoSchema),
});
export type Layout = z.infer<typeof LayoutBaseSchema>;

function dentro(r: Retangulo, layout: Pick<Layout, 'width' | 'height'>): boolean {
  return r.x + r.width <= layout.width && r.y + r.height <= layout.height;
}

function contem(externo: Retangulo, interno: Retangulo): boolean {
  return (
    interno.x >= externo.x &&
    interno.y >= externo.y &&
    interno.x + interno.width <= externo.x + externo.width &&
    interno.y + interno.height <= externo.y + externo.height
  );
}

/** Interseção com área positiva (encostar na borda não conta). */
export function intersectam(a: Retangulo, b: Retangulo): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Posições sobrepostas e títulos sobre posições. Varredura por x para manter
 * o custo baixo em layouts grandes.
 */
function verificarSobreposicoes(layout: Pick<Layout, 'elements' | 'rows' | 'positions'>, problemas: string[]): void {
  const porX = [...layout.positions].sort((a, b) => a.x - b.x);
  for (let i = 0; i < porX.length; i++) {
    const a = porX[i];
    if (!a) continue;
    for (let j = i + 1; j < porX.length; j++) {
      const b = porX[j];
      if (!b || b.x >= a.x + a.width) break;
      if (intersectam(a, b)) problemas.push(`Posições sobrepostas: ${a.code} e ${b.code}`);
    }
  }
  const caixas = [
    ...layout.elements.flatMap((e) => (e.labelBox ? [{ dono: e.code, caixa: e.labelBox }] : [])),
    ...layout.rows.map((f) => ({ dono: f.code, caixa: f.labelBox })),
  ];
  for (const { dono, caixa } of caixas) {
    for (const p of porX) {
      if (p.x >= caixa.x + caixa.width) break;
      if (intersectam(caixa, p)) problemas.push(`Título de ${dono} sobre a posição ${p.code}`);
    }
  }
}

/** Inconsistências estruturais do layout. Lista vazia significa layout coerente. */
export function verificarLayout(layout: Layout): string[] {
  const problemas: string[] = [];
  const unicos = (rotulo: string, valores: string[]) => {
    const vistos = new Set<string>();
    for (const v of valores) {
      if (vistos.has(v)) problemas.push(`${rotulo} duplicado: ${v}`);
      vistos.add(v);
    }
  };
  unicos('Elemento', layout.elements.map((e) => e.code));
  unicos('Fileira', layout.rows.map((f) => f.code));
  unicos('Posição', layout.positions.map((p) => p.code));
  unicos('ID', [...layout.elements, ...layout.rows, ...layout.positions].map((x) => x.id));

  for (const e of layout.elements) {
    if (!dentro(e, layout)) problemas.push(`Elemento fora dos limites: ${e.code}`);
    if (e.labelBox && !dentro(e.labelBox, layout)) problemas.push(`Título fora dos limites: ${e.code}`);
  }
  const fileiras = new Map(layout.rows.map((f) => [f.id, f]));
  for (const f of layout.rows) {
    if (!dentro(f, layout) || !dentro(f.labelBox, layout)) problemas.push(`Fileira fora dos limites: ${f.code}`);
  }
  for (const p of layout.positions) {
    const fileira = fileiras.get(p.rowId);
    if (!fileira) problemas.push(`Fileira inexistente na posição ${p.code}`);
    else if (!contem(fileira, p)) problemas.push(`Posição ${p.code} fora da fileira ${fileira.code}`);
    if (!dentro(p, layout)) problemas.push(`Posição fora dos limites: ${p.code}`);
  }
  verificarSobreposicoes(layout, problemas);
  return problemas;
}

export const LayoutSchema = LayoutBaseSchema.superRefine((layout, ctx) => {
  for (const problema of verificarLayout(layout)) ctx.addIssue({ code: 'custom', message: problema });
});
