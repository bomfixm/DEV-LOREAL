import type { LoteImportacao, ParametrosInventario, ParametrosSelecao, TipoImportacao } from '@praca-reversa/contracts';

/**
 * Parâmetros da prévia das planilhas operacionais (complemento "seleção do
 * cliente"). Nada é presumido: significado do N° Pallet, convenções de cor,
 * tipos documentais, marcação e duplicidade são escolhas explícitas de quem
 * importa, gravadas com a prévia e revalidadas no servidor.
 */
export type ParametrosPlanilha = ParametrosInventario | ParametrosSelecao;

const INVENTARIO_VAZIO: ParametrosInventario = {
  description: '',
  definitive: false,
  countReference: '',
  countDate: null,
  countSource: null,
  palletNumberMeaning: null,
  freeAddressFontColors: [],
  freeAddressValues: [],
  documentTypes: [],
  replacesInventoryId: null,
  complementsInventoryId: null,
};

const SELECAO_VAZIA: ParametrosSelecao = {
  mode: 'LISTA',
  markValues: [],
  orderReference: '',
  orderVersionLabel: null,
  inventoryId: null,
  documentContext: 'DOCUMENTO_INVENTARIO',
  defaultDocumentType: null,
  documentWithoutQuantity: 'PENDENTE',
  duplicates: null,
  replacesSelectionId: null,
};

export function parametrosIniciais(tipo: TipoImportacao, gravados: LoteImportacao['parameters']): ParametrosPlanilha | null {
  if (tipo === 'INVENTARIO') return { ...INVENTARIO_VAZIO, ...(gravados as Partial<ParametrosInventario> | null) };
  if (tipo === 'SELECAO_CLIENTE') return { ...SELECAO_VAZIA, ...(gravados as Partial<ParametrosSelecao> | null) };
  return null;
}

/** O que falta para gerar a prévia (o servidor confere de novo). */
export function faltasParametros(tipo: TipoImportacao, p: ParametrosPlanilha | null, colunas: Readonly<Record<string, number | null>>): string[] {
  if (p === null) return [];
  const faltas: string[] = [];
  if (tipo === 'INVENTARIO') {
    const i = p as ParametrosInventario;
    if (i.description.trim() === '') faltas.push('Identifique a versão do inventário (descrição).');
    if (i.countReference.trim() === '') faltas.push('Informe a referência da conferência.');
  }
  if (tipo === 'SELECAO_CLIENTE') {
    const s = p as ParametrosSelecao;
    if (s.orderReference.trim() === '') faltas.push('Informe a referência do pedido do cliente.');
    if (s.mode === 'MARCACAO' && (colunas.mark ?? null) === null) faltas.push('Inventário com marcação: escolha a coluna de decisão (Marcação).');
    if (s.mode === 'MARCACAO' && s.markValues.length === 0) faltas.push('Inventário com marcação: informe os valores que significam seleção.');
  }
  return faltas;
}
