import {
  API_PREFIXO,
  CORRESPONDENCIAS_APROXIMADAS,
  type BaseResultado,
  type CampoBusca,
  type CondicaoMaterial,
  type Correspondencia,
  type EstadoConferencia,
  type EstadoLiberacao,
  type LocalizacaoFiltro,
} from '@praca-reversa/contracts';

/** Critérios da busca na tela (o servidor valida tudo de novo). */
export interface CriteriosBusca {
  texto: string;
  campo: CampoBusca;
  bases: BaseResultado[];
  conferencia: EstadoConferencia | '';
  liberacao: EstadoLiberacao | '';
  condicao: CondicaoMaterial | '';
  localizacao: LocalizacaoFiltro | '';
  emConferencia: boolean;
}

export const CRITERIOS_VAZIOS: CriteriosBusca = {
  texto: '',
  campo: 'TUDO',
  bases: [],
  conferencia: '',
  liberacao: '',
  condicao: '',
  localizacao: '',
  emConferencia: false,
};

export const TAMANHO_PAGINA = 25;

export function temCriterio(c: CriteriosBusca): boolean {
  return c.texto.trim() !== '' || c.bases.length > 0 || c.conferencia !== '' || c.liberacao !== '' || c.condicao !== '' || c.localizacao !== '' || c.emConferencia;
}

/** Parâmetros da consulta (mesmos para a busca e a exportação). */
export function parametrosBusca(c: CriteriosBusca, pagina: number): URLSearchParams {
  const p = new URLSearchParams();
  const texto = c.texto.trim().slice(0, 120);
  if (texto) p.set('texto', texto);
  if (c.campo !== 'TUDO') p.set('campo', c.campo);
  if (c.bases.length > 0) p.set('base', c.bases.join(','));
  if (c.conferencia) p.set('conferencia', c.conferencia);
  if (c.liberacao) p.set('liberacao', c.liberacao);
  if (c.condicao) p.set('condicao', c.condicao);
  if (c.localizacao) p.set('localizacao', c.localizacao);
  if (c.emConferencia) p.set('emConferencia', 'true');
  p.set('pagina', String(pagina));
  p.set('tamanho', String(TAMANHO_PAGINA));
  return p;
}

export const urlBusca = (c: CriteriosBusca, pagina: number) => `${API_PREFIXO}/busca?${parametrosBusca(c, pagina).toString()}`;

export function urlExportacao(c: CriteriosBusca): string {
  const p = parametrosBusca(c, 1);
  p.delete('pagina');
  p.delete('tamanho');
  return `${API_PREFIXO}/busca/exportar?${p.toString()}`;
}

export const ROTULOS_CAMPO: Record<CampoBusca, string> = {
  TUDO: 'Tudo (identificadores exatos ou início; descrição)',
  PALETE: 'Palete (código ou link do QR)',
  ENDERECO: 'Endereço',
  SKU: 'SKU',
  CODIGO_BARRAS: 'Código de barras',
  LOTE: 'Lote',
  DOCUMENTO: 'Devolução / referência do documento',
  NF: 'NF',
  DESCRICAO: 'Descrição (aproximada)',
};

export const ROTULOS_BASE: Record<BaseResultado, { texto: string; curto: string; marcador: string }> = {
  PALETE: { texto: 'Palete', curto: 'Palete', marcador: '▣' },
  SALDO_VALIDADO: { texto: 'Saldo validado', curto: 'Validado', marcador: '✓' },
  OBSERVADO: { texto: 'Observado em conferência (não validado)', curto: 'Observado', marcador: '…' },
  DECLARADO_PALETE: { texto: 'Declarado no cadastro do palete', curto: 'Declarado', marcador: '✎' },
  DOCUMENTO: { texto: 'Documento importado (sem vínculo físico)', curto: 'Documento', marcador: '▤' },
  INVENTARIO: { texto: 'Vínculo informado no inventário (NF × palete)', curto: 'Inventário', marcador: '⇄' },
};

export const ROTULOS_CORRESPONDENCIA: Record<Correspondencia, string> = {
  ID_PALETE: 'ID do palete (QR)',
  CODIGO_PALETE: 'Código do palete',
  CODIGO_PALETE_PARCIAL: 'Parte do código do palete',
  ENDERECO: 'Endereço',
  ENDERECO_PARCIAL: 'Parte do endereço',
  SKU: 'SKU exato',
  SKU_PREFIXO: 'SKU começa com o texto',
  CODIGO_BARRAS: 'Código de barras exato',
  CODIGO_BARRAS_PREFIXO: 'Código de barras começa com o texto',
  LOTE: 'Lote exato',
  LOTE_PREFIXO: 'Lote começa com o texto',
  DOCUMENTO: 'Referência exata',
  DOCUMENTO_PREFIXO: 'Referência começa com o texto',
  NF: 'NF exata',
  NF_PREFIXO: 'NF começa com o texto',
  DESCRICAO_APROXIMADA: 'Descrição aproximada',
  FILTRO: 'Filtro',
};

export function aproximada(c: Correspondencia): boolean {
  return CORRESPONDENCIAS_APROXIMADAS.includes(c);
}

/**
 * Memória da busca por usuário e escopo, só na memória desta aba: volta ao
 * mesmo resultado depois de abrir um palete, o histórico ou outra página, sem
 * gravar nada no armazenamento do navegador. Some ao sair da conta ou
 * recarregar a página.
 */
export interface MemoriaBusca {
  criterios: CriteriosBusca;
  pagina: number;
  /** Resultado escolhido por último (realçado ao voltar). */
  escolhido: string | null;
  /** O painel lateral estava na busca. */
  ativo: boolean;
}

const memoria = new Map<string, MemoriaBusca>();

export function lerMemoriaBusca(chave: string): MemoriaBusca | null {
  return memoria.get(chave) ?? null;
}

export function gravarMemoriaBusca(chave: string, valor: MemoriaBusca): void {
  memoria.set(chave, valor);
}

export function limparMemoriaBusca(): void {
  memoria.clear();
}
