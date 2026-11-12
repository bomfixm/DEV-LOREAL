import { z } from 'zod';

/**
 * Modelo visual dos espelhos (editor de layout, nov. 2026).
 *
 * Só aparência: posição, largura e estilo de cada campo do documento. Os
 * valores (palete, endereço, notas…) vêm sempre dos dados da API e nunca
 * ficam guardados no modelo. Coordenadas em milímetros a partir do canto
 * superior esquerdo da folha útil (A4 paisagem dentro da margem de 5 mm da
 * impressora: 287 × 199 mm); tamanho do texto em pontos. A tela, o zoom e a
 * janela não mudam esses números.
 *
 * Dois documentos usam o mesmo editor: o espelho da praça ("praca", tela
 * Imprimir espelhos) e o espelho de embarque da Expedição ("embarque", via do
 * cliente). Cada um tem seus campos e colunas.
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

export const DOCUMENTOS = ['praca', 'embarque'] as const;
export type TipoDocumento = (typeof DOCUMENTOS)[number];

/** Campos de cada documento, com identificador estável. A tabela é sempre um bloco só. */
export const CAMPOS_DO_DOCUMENTO = {
  praca: ['endereco', 'palete', 'continuacao', 'demo', 'tabela', 'emissao', 'legenda', 'formulario', 'divisoria'],
  embarque: ['palete', 'veiculo', 'janela', 'identidade', 'continuacao', 'rascunho', 'demo', 'tabela', 'emissao', 'formulario', 'divisoria'],
} as const;
export type CampoId = (typeof CAMPOS_DO_DOCUMENTO)[TipoDocumento][number];
export const camposDe = (l: { documento: TipoDocumento }): readonly CampoId[] => CAMPOS_DO_DOCUMENTO[l.documento];

export const NOME_CAMPO: Record<CampoId, string> = {
  endereco: 'Endereço',
  palete: 'Número do palete',
  veiculo: 'Veículo e placa',
  janela: 'Janela',
  identidade: 'Identidade, tipo e revisão',
  continuacao: 'Folha / continuação (n/N)',
  demo: 'Aviso de demonstração',
  rascunho: 'Aviso de rascunho',
  tabela: 'Tabela de notas',
  emissao: 'Escopo e emissão',
  legenda: 'Legenda',
  formulario: 'Código do formulário',
  divisoria: 'Linha divisória',
};
/** Só elementos decorativos podem ser ocultados; dado do documento nunca some para "caber". */
export const OCULTAVEIS: ReadonlySet<CampoId> = new Set(['formulario', 'divisoria']);
/** Campos com rótulo pequeno opcional acima do valor. */
export const COM_ROTULO: ReadonlySet<CampoId> = new Set(['endereco', 'palete', 'veiculo', 'janela']);
/** Código impresso no formulário DHL (a moldura clássica já o traz no desenho). */
export const CODIGO_FORMULARIO = 'SF-164133/01';

export const COLUNAS_DO_DOCUMENTO: Record<TipoDocumento, readonly string[]> = {
  praca: ['DLV', 'TIPO', 'NÚMERO', 'OBS. OPERAÇÃO', 'VOLUMES', 'LIDO', 'REMETENTE', 'RUA', 'PALETE NUMBER'],
  embarque: ['TIPO', 'NÚMERO', 'REMETENTE', 'DELIVERY', 'VOLUMES', 'CONFERÊNCIA'],
};
/** Colunas do espelho da praça (mantido para quem já usava o nome). */
export const COLUNAS_TABELA = COLUNAS_DO_DOCUMENTO.praca;

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
/** Textos livres: identificador próprio (nunca colide com um campo), só texto puro — React escapa tudo, sem HTML. */
export const PREFIXO_TEXTO = 'txt-';
export const MAX_TEXTOS = 30;
export const MAX_CARACTERES_TEXTO = 300;
const TextoLivreSchema = z.object({
  id: z.string().regex(/^txt-[a-z0-9]{1,20}$/u),
  // eslint-disable-next-line no-control-regex -- recusa caracteres de controle (só quebra de linha e tabulação passam)
  texto: z.string().max(MAX_CARACTERES_TEXTO).refine((s) => !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(s), 'Caractere de controle no texto.'),
  x: mm(0, PAPEL.largura),
  y: mm(0, PAPEL.altura),
  largura: mm(5, PAPEL.largura),
  estilo: EstiloSchema,
});
export type TextoLivre = z.infer<typeof TextoLivreSchema>;

export const LayoutEspelhoSchema = z
  .object({
    versao: z.literal(1),
    /** Modelos guardados antes do espelho de embarque não tinham o campo: eram da praça. */
    documento: z.enum(DOCUMENTOS).default('praca'),
    papel: z.object({ formato: z.literal('A4'), orientacao: z.literal('paisagem'), largura: z.literal(PAPEL.largura), altura: z.literal(PAPEL.altura) }),
    /** Guia de área útil (não é impressa). */
    margem: mm(0, 30),
    moldura: z.enum(['dhl', 'nenhuma']),
    tabela: z.object({
      colunas: z.array(mm(2, 60)).min(2).max(12),
      cabecalho: z.enum(['escuro', 'claro']),
      linhas: z.enum(['grade', 'horizontais']),
      /** Respiro vertical de cada célula, em mm. */
      espacamento: mm(0.3, 6),
    }),
    blocos: z.record(z.string(), BlocoSchema),
    /** Textos acrescentados pelo usuário (layouts antigos não tinham: lista vazia). */
    textos: z.array(TextoLivreSchema).max(MAX_TEXTOS).default([]),
  })
  .superRefine((l, ctx) => {
    if (new Set(l.textos.map((t) => t.id)).size !== l.textos.length) ctx.addIssue({ code: 'custom', message: 'Texto repetido no layout.', path: ['textos'] });
    const esperados = CAMPOS_DO_DOCUMENTO[l.documento] as readonly string[];
    const chaves = Object.keys(l.blocos);
    if (chaves.length !== esperados.length || !esperados.every((c) => c in l.blocos)) ctx.addIssue({ code: 'custom', message: 'Campos do layout não correspondem ao documento.', path: ['blocos'] });
    if (l.tabela.colunas.length !== COLUNAS_DO_DOCUMENTO[l.documento].length) ctx.addIssue({ code: 'custom', message: 'Colunas não correspondem ao documento.', path: ['tabela', 'colunas'] });
  });
export type EstiloTexto = z.infer<typeof EstiloSchema>;
export type BlocoLayout = z.infer<typeof BlocoSchema>;
export type LayoutEspelho = z.infer<typeof LayoutEspelhoSchema>;

const arred = (v: number) => Math.round(v * 10) / 10;
const BLOCO_RESERVA: BlocoLayout = { x: 10, y: 10, largura: 100, altura: null, estilo: { fonte: 'inter', tamanho: 9, negrito: false, alinhamento: 'esquerda' }, rotulo: false, visivel: true };

/** Bloco de um campo (o layout validado sempre tem todos os campos do seu documento). */
export function blocoDe(l: LayoutEspelho, campo: CampoId): BlocoLayout {
  return l.blocos[campo] ?? LAYOUT_PADRAO_DE[l.documento].blocos[campo] ?? BLOCO_RESERVA;
}

/**
 * Valida um modelo vindo de fora (armazenamento, modelo salvo) e o mantém dentro
 * da folha. Não aceita HTML, CSS nem campos desconhecidos: só números e opções da lista.
 */
export function lerLayout(valor: unknown, documento?: TipoDocumento): LayoutEspelho | null {
  const r = LayoutEspelhoSchema.safeParse(valor);
  if (!r.success || (documento !== undefined && r.data.documento !== documento)) return null;
  return normalizarLayout(r.data);
}

/** Garante que nenhum bloco comece fora da folha e que a largura caiba nela. */
export function normalizarLayout(l: LayoutEspelho): LayoutEspelho {
  const blocos: Record<string, BlocoLayout> = {};
  for (const c of camposDe(l)) {
    const b = blocoDe(l, c);
    const largura = arred(Math.min(Math.max(b.largura, 5), PAPEL.largura));
    const x = arred(Math.min(Math.max(b.x, 0), PAPEL.largura - largura));
    const altura = b.altura === null ? null : arred(Math.min(Math.max(b.altura, 0.1), PAPEL.altura));
    const y = arred(Math.min(Math.max(b.y, 0), PAPEL.altura - Math.max(altura ?? 0, 2)));
    blocos[c] = { ...b, x, y, largura, altura, rotulo: COM_ROTULO.has(c) && b.rotulo, visivel: OCULTAVEIS.has(c) ? b.visivel : true, estilo: { ...b.estilo, tamanho: arred(b.estilo.tamanho) } };
  }
  const soma = l.tabela.colunas.reduce((s, v) => s + v, 0);
  const colunas = l.tabela.colunas.map((v) => arred((v / soma) * 100));
  const textos = l.textos.map((t) => {
    const largura = arred(Math.min(Math.max(t.largura, 5), PAPEL.largura));
    return { ...t, largura, x: arred(Math.min(Math.max(t.x, 0), PAPEL.largura - largura)), y: arred(Math.min(Math.max(t.y, 0), PAPEL.altura - 2)), estilo: { ...t.estilo, tamanho: arred(Math.min(Math.max(t.estilo.tamanho, 5), 72)) } };
  });
  return { ...l, blocos, tabela: { ...l.tabela, colunas }, textos };
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
  documento: 'praca',
  papel: { ...PAPEL },
  margem: 8,
  moldura: 'nenhuma',
  // OBS. OPERAÇÃO cabe "AGUARDANDO CONFERÊNCIA" numa linha; remetente longo quebra dentro da própria coluna.
  tabela: { colunas: [10, 4.5, 9.5, 19, 7, 5, 26, 8, 11], cabecalho: 'claro', linhas: 'horizontais', espacamento: 1.6 },
  textos: [],
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
  documento: 'praca',
  papel: { ...PAPEL },
  margem: 19,
  moldura: 'dhl',
  tabela: { colunas: [10, 5, 10, 15, 7, 7, 25, 12, 9], cabecalho: 'escuro', linhas: 'grade', espacamento: 2 },
  textos: [],
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

/**
 * Espelho de embarque "Operacional limpo": veículo e janela à esquerda, número
 * do palete grande à direita, NFs desta saída em tabela leve com espaço para a
 * conferência à mão. Fundo branco; vermelho só nos avisos (demonstração, rascunho).
 */
export const EMBARQUE_LIMPO: LayoutEspelho = {
  versao: 1,
  documento: 'embarque',
  papel: { ...PAPEL },
  margem: 8,
  moldura: 'nenhuma',
  tabela: { colunas: [7, 13, 36, 16, 10, 18], cabecalho: 'claro', linhas: 'horizontais', espacamento: 2.2 },
  textos: [],
  blocos: {
    veiculo: bloco(10, 9, 190, estilo('inter', 24, true, 'esquerda'), { rotulo: true }),
    janela: bloco(10, 23, 175, estilo('inter', 11, false, 'esquerda'), { rotulo: true }),
    identidade: bloco(10, 32.5, 175, estilo('inter', 8.5, false, 'esquerda')),
    palete: bloco(207, 9, 70, estilo('inter', 40, true, 'direita'), { rotulo: true }),
    continuacao: bloco(207, 30, 70, estilo('inter', 8, false, 'direita')),
    rascunho: bloco(187, 34, 90, estilo('inter', 8, true, 'direita')),
    demo: bloco(10, 37, 150, estilo('inter', 8, true, 'esquerda')),
    divisoria: bloco(10, 42, 267, estilo('inter', 8, false, 'esquerda'), { altura: 0.4 }),
    tabela: bloco(10, 46, 267, estilo('inter', 9.5, false, 'esquerda'), { altura: 130 }),
    emissao: bloco(10, 180.5, 200, estilo('inter', 7, false, 'esquerda')),
    formulario: bloco(217, 180.5, 60, estilo('inter', 7, false, 'direita')),
  },
};

/** Espelho de embarque como era antes do editor (moldura DHL, centralizado, grade com cabeçalho escuro). */
export const EMBARQUE_CLASSICO: LayoutEspelho = {
  versao: 1,
  documento: 'embarque',
  papel: { ...PAPEL },
  margem: 19,
  moldura: 'dhl',
  tabela: { colunas: [8, 14, 34, 18, 12, 14], cabecalho: 'escuro', linhas: 'grade', espacamento: 2 },
  textos: [],
  blocos: {
    demo: bloco(19, 17.5, 249, estilo('arial', 9, true, 'centro')),
    rascunho: bloco(19, 21.5, 249, estilo('arial', 9, true, 'centro')),
    veiculo: bloco(19, 26, 249, estilo('arial', 22, true, 'centro')),
    palete: bloco(19, 36, 249, estilo('arial', 20, true, 'centro')),
    janela: bloco(19, 45, 249, estilo('arial', 12, true, 'centro')),
    identidade: bloco(19, 51, 249, estilo('arial', 10, false, 'centro')),
    continuacao: bloco(19, 56, 249, estilo('arial', 8, false, 'centro')),
    tabela: bloco(19, 60, 249, estilo('arial', 9, true, 'centro'), { altura: 107 }),
    emissao: bloco(19, 170.5, 249, estilo('arial', 7, false, 'esquerda')),
    formulario: bloco(200, 186, 60, estilo('arial', 7, false, 'direita'), { visivel: false }),
    divisoria: bloco(19, 58, 249, estilo('arial', 8, false, 'esquerda'), { altura: 0.3, visivel: false }),
  },
};

export const MODELOS_DO_SISTEMA = [
  { id: 'sistema:operacional-limpo', nome: 'Operacional limpo', layout: OPERACIONAL_LIMPO },
  { id: 'sistema:classico', nome: 'Clássico (moldura DHL)', layout: CLASSICO },
  { id: 'sistema:embarque-limpo', nome: 'Operacional limpo', layout: EMBARQUE_LIMPO },
  { id: 'sistema:embarque-classico', nome: 'Clássico (moldura DHL)', layout: EMBARQUE_CLASSICO },
] as const;

/** Padrão de quem nunca recebeu um layout aplicado. Aplicar não muda estes valores. */
export const LAYOUT_PADRAO_DE: Record<TipoDocumento, LayoutEspelho> = { praca: OPERACIONAL_LIMPO, embarque: EMBARQUE_LIMPO };
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

// ---------- Itens do editor: campos do documento e textos livres ----------

/** Item selecionável: um campo (`CampoId`) ou um texto livre (`txt-…`). */
export type ItemId = string;
export const ehTexto = (id: ItemId): boolean => id.startsWith(PREFIXO_TEXTO);
const ehCampo = (l: LayoutEspelho, id: ItemId): id is CampoId => (camposDe(l) as readonly string[]).includes(id);
export const itensDe = (l: LayoutEspelho): ItemId[] => [...camposDe(l), ...l.textos.map((t) => t.id)];

/** Nome mostrado no editor e nos avisos. */
export function nomeDoItem(l: LayoutEspelho, id: ItemId): string {
  if (ehCampo(l, id)) return NOME_CAMPO[id];
  const t = l.textos.find((x) => x.id === id);
  if (t === undefined) return 'Texto';
  const curto = t.texto.replace(/\s+/gu, ' ').trim();
  return `Texto “${curto.length > 24 ? `${curto.slice(0, 24)}…` : curto || 'vazio'}”`;
}

/** Caixa de um item no formato de bloco (texto livre: altura automática, sem rótulo). */
export function caixaDoItem(l: LayoutEspelho, id: ItemId): BlocoLayout {
  if (ehCampo(l, id)) return blocoDe(l, id);
  const t = l.textos.find((x) => x.id === id);
  return t === undefined ? BLOCO_RESERVA : { x: t.x, y: t.y, largura: t.largura, altura: null, estilo: t.estilo, rotulo: false, visivel: true };
}

type Mudanca = Partial<Omit<BlocoLayout, 'estilo'>> & { estilo?: Partial<EstiloTexto> };

/** Altera um campo ou texto livre; devolve o layout já dentro da folha. */
export function alterarItem(l: LayoutEspelho, id: ItemId, m: Mudanca & { texto?: string }): LayoutEspelho {
  if (ehCampo(l, id)) {
    const { texto: _texto, ...resto } = m;
    return alterarBloco(l, id, resto);
  }
  const textos = l.textos.map((t) => (t.id !== id ? t : {
    ...t,
    x: m.x ?? t.x,
    y: m.y ?? t.y,
    largura: m.largura ?? t.largura,
    estilo: { ...t.estilo, ...m.estilo },
    texto: m.texto === undefined ? t.texto : m.texto.slice(0, MAX_CARACTERES_TEXTO),
  }));
  return normalizarLayout({ ...l, textos });
}

/** Aplica a mesma mudança (calculada por item) a vários itens. */
export function alterarItens(l: LayoutEspelho, ids: readonly ItemId[], m: (caixa: BlocoLayout, id: ItemId) => Mudanca): LayoutEspelho {
  return ids.reduce((acc, id) => alterarItem(acc, id, m(caixaDoItem(acc, id), id)), l);
}

/**
 * Move vários itens juntos a partir das posições em `origem` (início do
 * arraste). O deslocamento é limitado para o grupo inteiro caber na folha,
 * então o desenho do grupo não se deforma na borda.
 */
export function deslocarItens(l: LayoutEspelho, ids: readonly ItemId[], dx: number, dy: number, origem: LayoutEspelho = l): LayoutEspelho {
  const caixas = ids.map((id) => ({ id, c: caixaDoItem(origem, id) }));
  if (caixas.length === 0) return l;
  const limitar = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  const ddx = limitar(dx, Math.max(...caixas.map(({ c }) => -c.x)), Math.min(...caixas.map(({ c }) => PAPEL.largura - c.x - c.largura)));
  const ddy = limitar(dy, Math.max(...caixas.map(({ c }) => -c.y)), Math.min(...caixas.map(({ c }) => PAPEL.altura - c.y - Math.max(c.altura ?? 0, 2))));
  return caixas.reduce((acc, { id, c }) => alterarItem(acc, id, { x: arred(c.x + ddx), y: arred(c.y + ddy) }), l);
}

/** Alinha as posições dos itens entre si (pela caixa do grupo). */
export function alinharItens(l: LayoutEspelho, ids: readonly ItemId[], modo: 'esquerda' | 'centro' | 'direita' | 'topo'): LayoutEspelho {
  const caixas = ids.map((id) => caixaDoItem(l, id));
  if (caixas.length < 2) return l;
  const esquerda = Math.min(...caixas.map((c) => c.x));
  const direita = Math.max(...caixas.map((c) => c.x + c.largura));
  const topo = Math.min(...caixas.map((c) => c.y));
  return alterarItens(l, ids, (c) => (modo === 'esquerda' ? { x: esquerda } : modo === 'direita' ? { x: direita - c.largura } : modo === 'centro' ? { x: (esquerda + direita) / 2 - c.largura / 2 } : { y: topo }));
}

/** Aumenta ou diminui o texto de cada item (a linha divisória não tem texto). */
export function ajustarTamanho(l: LayoutEspelho, ids: readonly ItemId[], delta: number): LayoutEspelho {
  return alterarItens(l, ids.filter((id) => id !== 'divisoria'), (c) => ({ estilo: { tamanho: Math.min(Math.max(c.estilo.tamanho + delta, 5), 72) } }));
}

/** Acrescenta um texto livre com o próximo id livre (`txt-1`, `txt-2`…). Além do limite, devolve null. */
export function adicionarTexto(l: LayoutEspelho, texto = 'Novo texto'): { layout: LayoutEspelho; id: string } | null {
  if (l.textos.length >= MAX_TEXTOS) return null;
  let n = 1;
  while (l.textos.some((t) => t.id === `${PREFIXO_TEXTO}${String(n)}`)) n += 1;
  const id = `${PREFIXO_TEXTO}${String(n)}`;
  const novo: TextoLivre = { id, texto, x: Math.max(l.margem, 10), y: 100, largura: 90, estilo: estilo('inter', 12, false, 'esquerda') };
  return { layout: normalizarLayout({ ...l, textos: [...l.textos, novo] }), id };
}

export function removerTextos(l: LayoutEspelho, ids: readonly ItemId[]): LayoutEspelho {
  return { ...l, textos: l.textos.filter((t) => !ids.includes(t.id)) };
}

/** Altera um bloco e devolve o layout já dentro da folha. */
export function alterarBloco(l: LayoutEspelho, campo: CampoId, mudanca: Partial<Omit<BlocoLayout, 'estilo'>> & { estilo?: Partial<EstiloTexto> }): LayoutEspelho {
  const atual = blocoDe(l, campo);
  const novo: BlocoLayout = { ...atual, ...mudanca, estilo: { ...atual.estilo, ...mudanca.estilo } };
  return normalizarLayout({ ...l, blocos: { ...l.blocos, [campo]: novo } });
}
