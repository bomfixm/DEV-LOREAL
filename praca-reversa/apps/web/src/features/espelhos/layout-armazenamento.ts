import { assinaturaLayout, LAYOUT_PADRAO, lerLayout, type LayoutEspelho } from './layout-modelo';

/**
 * Onde o layout aplicado fica guardado: neste computador (localStorage), por
 * palete (id estável) — não há tabela de modelos no servidor e a aparência não
 * mexe em estoque. Só aparência: nenhum valor de palete entra aqui.
 *
 * - `aplicados[idDoPalete]` → assinatura do layout aplicado a ele;
 * - `layouts[assinatura]` → o layout (deduplicado: 250 paletes com o mesmo layout guardam uma cópia);
 * - `modelos` → "Salvar como modelo" (nome + assinatura).
 * Quem não tem layout aplicado usa o padrão do sistema, que nunca é alterado por aqui.
 */
export const CHAVE_ARMAZENAMENTO = 'praca-reversa:espelhos-layout:v1';

export interface ModeloSalvo {
  id: string;
  nome: string;
  layout: LayoutEspelho;
  criadoEm: string;
}
interface Bruto {
  layouts: Record<string, unknown>;
  aplicados: Record<string, string>;
  modelos: { id: string; nome: string; layout: string; criadoEm: string }[];
}
export interface MemoriaLayouts {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
}

const vazio = (): Bruto => ({ layouts: {}, aplicados: {}, modelos: [] });

function ler(memoria: MemoriaLayouts | null): Bruto {
  if (memoria === null) return vazio();
  try {
    const v = JSON.parse(memoria.getItem(CHAVE_ARMAZENAMENTO) ?? 'null') as Partial<Bruto> | null;
    if (v === null || typeof v !== 'object') return vazio();
    const objeto = (o: unknown): o is Record<string, unknown> => o !== null && typeof o === 'object' && !Array.isArray(o);
    const aplicados = objeto(v.aplicados) ? Object.fromEntries(Object.entries(v.aplicados).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};
    const modelos = Array.isArray(v.modelos) ? v.modelos.filter((m) => objeto(m) && typeof m.id === 'string' && typeof m.nome === 'string' && typeof m.layout === 'string' && typeof m.criadoEm === 'string') : [];
    return { layouts: objeto(v.layouts) ? v.layouts : {}, aplicados, modelos };
  } catch {
    return vazio();
  }
}

function gravar(memoria: MemoriaLayouts | null, b: Bruto): void {
  if (memoria === null) return;
  // Descarta layouts que nenhum palete nem modelo usa mais.
  const usados = new Set([...Object.values(b.aplicados), ...b.modelos.map((m) => m.layout)]);
  const layouts = Object.fromEntries(Object.entries(b.layouts).filter(([k]) => usados.has(k)));
  memoria.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify({ ...b, layouts }));
}

/** Memória do navegador, se houver (testes passam a sua). */
export function memoriaDoNavegador(): MemoriaLayouts | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Layout aplicado a cada palete pedido (padrão do sistema quando não há, ou quando o guardado não passa na validação). */
export function layoutsDosPaletes(ids: readonly string[], memoria: MemoriaLayouts | null = memoriaDoNavegador()): Map<string, LayoutEspelho> {
  const b = ler(memoria);
  const cache = new Map<string, LayoutEspelho | null>();
  const r = new Map<string, LayoutEspelho>();
  for (const id of ids) {
    const assinatura = b.aplicados[id];
    if (assinatura === undefined) { r.set(id, LAYOUT_PADRAO); continue; }
    if (!cache.has(assinatura)) cache.set(assinatura, lerLayout(b.layouts[assinatura]));
    r.set(id, cache.get(assinatura) ?? LAYOUT_PADRAO);
  }
  return r;
}

/** Aplica um layout exatamente aos ids informados (lista fixada no clique); os demais não mudam. */
export function aplicarLayout(ids: readonly string[], layout: LayoutEspelho, memoria: MemoriaLayouts | null = memoriaDoNavegador()): void {
  const valido = lerLayout(layout);
  if (valido === null) throw new Error('Layout inválido.');
  const b = ler(memoria);
  const assinatura = assinaturaLayout(valido);
  b.layouts[assinatura] = valido;
  for (const id of ids) b.aplicados[id] = assinatura;
  gravar(memoria, b);
}

export function modelosSalvos(memoria: MemoriaLayouts | null = memoriaDoNavegador()): ModeloSalvo[] {
  const b = ler(memoria);
  return b.modelos.flatMap((m) => {
    const layout = lerLayout(b.layouts[m.layout]);
    return layout === null ? [] : [{ id: m.id, nome: m.nome, layout, criadoEm: m.criadoEm }];
  });
}

/** "Salvar como modelo": guarda só a aparência. Nome repetido substitui o modelo anterior com esse nome. */
export function salvarModelo(nome: string, layout: LayoutEspelho, agora: Date = new Date(), memoria: MemoriaLayouts | null = memoriaDoNavegador()): ModeloSalvo {
  const limpo = nome.trim().slice(0, 60);
  const valido = lerLayout(layout);
  if (limpo === '' || valido === null) throw new Error('Informe um nome para o modelo.');
  const b = ler(memoria);
  const assinatura = assinaturaLayout(valido);
  b.layouts[assinatura] = valido;
  const existente = b.modelos.find((m) => m.nome.toLocaleLowerCase('pt-BR') === limpo.toLocaleLowerCase('pt-BR'));
  const modelo = { id: existente?.id ?? `salvo:${agora.getTime().toString(36)}`, nome: limpo, layout: assinatura, criadoEm: agora.toISOString() };
  b.modelos = [...b.modelos.filter((m) => m.id !== modelo.id), modelo];
  gravar(memoria, b);
  return { ...modelo, layout: valido };
}

export function excluirModelo(id: string, memoria: MemoriaLayouts | null = memoriaDoNavegador()): void {
  const b = ler(memoria);
  b.modelos = b.modelos.filter((m) => m.id !== id);
  gravar(memoria, b);
}
