import { z } from 'zod';

/**
 * Modelo visual do espelho de palete (editor de layout, nov. 2026).
 *
 * Só aparência: posição, largura e estilo de cada campo do documento. Os
 * valores (palete, endereço, notas…) vêm sempre do lote gerado pela API e
 * nunca ficam guardados no modelo. Coordenadas em milímetros a partir do canto
 * superior esquerdo da folha útil (A4 paisagem dentro da margem de 5 mm da
 * impressora: 287 × 199 mm); tamanho do texto em pontos. A tela, o zoom e a
 * janela não mudam esses números.
 */

export const PAPEL = { formato: 'A4', orientacao: 'paisagem', largura: 287, altura: 199 } as const;
/** Pixels CSS por milímetro (96 px por polegada), usado na conversão do arraste e das medições. */
export const PX_POR_MM = 96 / 25.4;
/** Passo do arraste e do teclado: posições sempre múltiplas de 0,5 mm. */
export const PASSO_MM = 0.5;

/** Fontes oferecidas: Inter vem com o sistema; as demais são do Windows (conferidas na tela antes de imprimir). */
export const FONTES = [
  { id: 'inter', rotulo: 'Inter', css: "'Inter Variable', Inter, Arial, sans-serif", carregar: "'Inter Variable'", sistema: false },
  { id: 'arial', rotulo: 'Arial', css: 'Arial, Helvetica, sans-serif', carregar: 'Arial', sistema: true },
  { id: 'verdana', rotulo: 'Verdana', css: 'Verdana, Geneva, sans-serif', carregar: 'Verdana', sistema: true },
  { id: 'georgia', rotulo: 'Georgia', css: 'Georgia, serif', carregar: 'Georgia', sistema: true },
  { id: 'courier', rotulo: 'Courier New', css: "'Courier New', Courier, monospace", carregar: "'Courier New'", sistema: true },
] as const;
export type FonteId = (typeof FONTES)[number]['id'];
export const cssDaFonte = (id: FonteId): string => FONTES.find((f) => f.id === id)?.css ?? FONTES[0].css;

/** Campos do documento, com identificador estável. A tabela de notas é um bloco só. */
export const CAMPOS = ['endereco', 'palete', 'continuacao', 'demo', 'tabela', 'emissao', 'legenda', 'formulario', 'divisoria'] as const;
export type CampoId = (typeof CAMPOS)[number];
export const NOME_CAMPO: Record<CampoId, string> = {
  endereco: 'Endereço',
  palete: 'Número do palete',
  continuacao: 'Continuação (n/N)',
  demo: 'Aviso de demonstração',
  tabela: 'Tabela de notas',
  emissao: 'Escopo e emissão',
  legenda: 'Legenda',
  formulario: 'Código do formulário',
  divisoria: 'Linha divisória',
};
/** Só elementos decorativos podem ser ocultados; dado do documento nunca some para "caber". */
export const OCULTAVEIS: ReadonlySet<CampoId> = new Set(['formulario', 'divisoria']);
/** Campos com rótulo pequeno opcional acima do valor. */
export const COM_ROTULO: ReadonlySet<CampoId> = new Set(['endereco', 'palete']);
/** Código impresso no formulário DHL (a moldura clássica já o traz no desenho). */
export const CODIGO_FORMULARIO = 'SF-164133/01';

export const COLUNAS_TABELA = ['DLV', 'TIPO', 'NÚMERO', 'OBS. OPERAÇÃO', 'VOLUMES', 'LIDO', 'REMETENTE', 'RUA', 'PALETE NUMBER'] as const;

const mm = (min: number, max: number) => z.number().min(min).max(max);
const EstiloSchema = z.object({
  fonte: z.enum(FONTES.map((f) => f.id) as [FonteId, ...FonteId[]]),
  tamanho: mm(5, 72),
  negrito: z.boolean(),
  alinhamento: z.enum(['esquerda', 'centro', 'direita']),
});
const BlocoSchema = z.object({
  x: mm(0, PAPEL.largura),
  y: mm(0, PAPEL.altura),
  largura: mm(5, PAPEL.largura),
  /** Tabela: altura disponível na folha (define a paginação). Divisória: espessura. Textos: altura automática. */
  altura: mm(0.1, PAPEL.altura).nullable(),
  estilo: EstiloSchema,
  rotulo: z.boolean(),
  visivel: z.boolean(),
});
export const LayoutEspelhoSchema = z.object({
  versao: z.literal(1),
  papel: z.object({ formato: z.literal('A4'), orientacao: z.literal('paisagem'), largura: z.literal(PAPEL.largura), altura: z.literal(PAPEL.altura) }),
  /** Guia de área útil (não é impressa). */
  margem: mm(0, 30),
  moldura: z.enum(['dhl', 'nenhuma']),
  tabela: z.object({
    colunas: z.array(mm(2, 60)).length(COLUNAS_TABELA.length),
    cabecalho: z.enum(['escuro', 'claro']),
    linhas: z.enum(['grade', 'horizontais']),
    /** Respiro vertical de cada célula, em mm. */
    espacamento: mm(0.3, 6),
  }),
  blocos: z.object(Object.fromEntries(CAMPOS.map((c) => [c, BlocoSchema])) as Record<CampoId, typeof BlocoSchema>),
});
export type EstiloTexto = z.infer<typeof EstiloSchema>;
export type BlocoLayout = z.infer<typeof BlocoSchema>;
export type LayoutEspelho = z.infer<typeof LayoutEspelhoSchema>;

const arred = (v: number) => Math.round(v * 10) / 10;

/**
 * Valida um modelo vindo de fora (armazenamento, modelo salvo) e o mantém dentro
 * da folha. Não aceita HTML, CSS nem campos desconhecidos: só números e opções da lista.
 */
export function lerLayout(valor: unknown): LayoutEspelho | null {
  const r = LayoutEspelhoSchema.safeParse(valor);
  return r.success ? normalizarLayout(r.data) : null;
}

/** Garante que nenhum bloco comece fora da folha e que a largura caiba nela. */
export function normalizarLayout(l: LayoutEspelho): LayoutEspelho {
  const blocos = { ...l.blocos };
  for (const c of CAMPOS) {
    const b = blocos[c];
    const largura = arred(Math.min(Math.max(b.largura, 5), PAPEL.largura));
    const x = arred(Math.min(Math.max(b.x, 0), PAPEL.largura - largura));
    const altura = b.altura === null ? null : arred(Math.min(Math.max(b.altura, 0.1), PAPEL.altura));
    const y = arred(Math.min(Math.max(b.y, 0), PAPEL.altura - Math.max(altura ?? 0, 2)));
    blocos[c] = { ...b, x, y, largura, altura, rotulo: COM_ROTULO.has(c) && b.rotulo, visivel: OCULTAVEIS.has(c) ? b.visivel : true, estilo: { ...b.estilo, tamanho: arred(b.estilo.tamanho) } };
  }
  const soma = l.tabela.colunas.reduce((s, v) => s + v, 0);
  const colunas = l.tabela.colunas.map((v) => arred((v / soma) * 100));
  return { ...l, blocos, tabela: { ...l.tabela, colunas } };
}

const estilo = (fonte: FonteId, tamanho: number, negrito: boolean, alinhamento: EstiloTexto['alinhamento']): EstiloTexto => ({ fonte, tamanho, negrito, alinhamento });
const bloco = (x: number, y: number, largura: number, e: EstiloTexto, extra: Partial<BlocoLayout> = {}): BlocoLayout => ({ x, y, largura, altura: null, estilo: e, rotulo: false, visivel: true, ...extra });

/**
 * "Operacional limpo": endereço e palete grandes no topo (mais fáceis de achar
 * no corredor), notas em tabela leve com linhas finas, rodapé discreto. Fundo
 * branco, preto e cinza (lê bem em impressora P&B), vermelho só no aviso de demonstração.
 */
export const OPERACIONAL_LIMPO: LayoutEspelho = {
  versao: 1,
  papel: { ...PAPEL },
  margem: 8,
  moldura: 'nenhuma',
  // OBS. OPERAÇÃO cabe "AGUARDANDO CONFERÊNCIA" numa linha; remetente longo quebra dentro da própria coluna.
  tabela: { colunas: [10, 4.5, 9.5, 19, 7, 5, 26, 8, 11], cabecalho: 'claro', linhas: 'horizontais', espacamento: 1.6 },
  blocos: {
    endereco: bloco(10, 9, 180, estilo('inter', 30, true, 'esquerda'), { rotulo: true }),
    palete: bloco(192, 9, 85, estilo('inter', 24, true, 'direita'), { rotulo: true }),
    continuacao: bloco(192, 29, 85, estilo('inter', 8, false, 'direita')),
    demo: bloco(10, 29.5, 170, estilo('inter', 8, true, 'esquerda')),
    divisoria: bloco(10, 36, 267, estilo('inter', 8, false, 'esquerda'), { altura: 0.4 }),
    tabela: bloco(10, 41, 267, estilo('inter', 9, false, 'esquerda'), { altura: 137 }),
    emissao: bloco(10, 181.5, 190, estilo('inter', 7, false, 'esquerda')),
    legenda: bloco(10, 185.5, 190, estilo('inter', 7, false, 'esquerda')),
    formulario: bloco(217, 181.5, 60, estilo('inter', 7, false, 'direita')),
  },
};

/** Aparência anterior ao editor (moldura DHL, títulos centralizados, tabela com grade e cabeçalho escuro). */
export const CLASSICO: LayoutEspelho = {
  versao: 1,
  papel: { ...PAPEL },
  margem: 19,
  moldura: 'dhl',
  tabela: { colunas: [10, 5, 10, 15, 7, 7, 25, 12, 9], cabecalho: 'escuro', linhas: 'grade', espacamento: 2 },
  blocos: {
    demo: bloco(19, 20, 249, estilo('arial', 10, true, 'centro')),
    endereco: bloco(19, 26, 249, estilo('arial', 26, true, 'centro')),
    palete: bloco(19, 39, 249, estilo('arial', 17, true, 'centro')),
    continuacao: bloco(19, 48, 249, estilo('arial', 8, false, 'centro')),
    tabela: bloco(19, 53, 249, estilo('arial', 9, true, 'centro'), { altura: 114 }),
    emissao: bloco(19, 171, 249, estilo('arial', 7, false, 'esquerda')),
    legenda: bloco(19, 174.5, 249, estilo('arial', 7, false, 'esquerda')),
    formulario: bloco(200, 186, 60, estilo('arial', 7, false, 'direita'), { visivel: false }),
    divisoria: bloco(19, 50, 249, estilo('arial', 8, false, 'esquerda'), { altura: 0.3, visivel: false }),
  },
};

export const MODELOS_DO_SISTEMA = [
  { id: 'sistema:operacional-limpo', nome: 'Operacional limpo', layout: OPERACIONAL_LIMPO },
  { id: 'sistema:classico', nome: 'Clássico (moldura DHL)', layout: CLASSICO },
] as const;

/** Padrão de quem nunca recebeu um layout aplicado. Aplicar a um lote não muda este valor. */
export const LAYOUT_PADRAO = OPERACIONAL_LIMPO;

/** Assinatura estável (mesmo layout → mesmo texto), usada para comparar e deduplicar. */
export function assinaturaLayout(l: LayoutEspelho): string {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(ordenar(l));
}

/** Arredonda ao passo de 0,5 mm (arraste e teclado): o mesmo gesto dá o mesmo número em qualquer zoom. */
export const noPasso = (v: number): number => Math.round(v / PASSO_MM) * PASSO_MM;

/** Altera um bloco e devolve o layout já dentro da folha. */
export function alterarBloco(l: LayoutEspelho, campo: CampoId, mudanca: Partial<Omit<BlocoLayout, 'estilo'>> & { estilo?: Partial<EstiloTexto> }): LayoutEspelho {
  const atual = l.blocos[campo];
  const novo: BlocoLayout = { ...atual, ...mudanca, estilo: { ...atual.estilo, ...mudanca.estilo } };
  return normalizarLayout({ ...l, blocos: { ...l.blocos, [campo]: novo } });
}
