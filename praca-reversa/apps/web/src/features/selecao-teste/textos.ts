import {
  API_PREFIXO,
  rotuloTipoDocumentoTeste,
  type AgendaTeste,
  type ConteudoEstoqueTeste,
  type FullMisto,
  type ItemSolicitacaoTeste,
} from '@praca-reversa/contracts';
import { formatarData } from '../../utils/datas';

/** Rotas da API da "Seleção cliente — teste". */
export const API_TESTE = `${API_PREFIXO}/selecao-teste`;

/** "NF-e 900123", "Minuta 4410", "NFD 0003001"; sem número: "Documento não informado". */
export function textoDocumento(c: Pick<ConteudoEstoqueTeste, 'documentType' | 'documentNumber'> | null): string {
  if (c === null) return 'Palete inteiro';
  return c.documentNumber === null ? 'Documento não informado' : `${rotuloTipoDocumentoTeste(c.documentType)} ${c.documentNumber}`;
}

/** "5 volumes", "1 volume", "não informado". */
export function textoVolumes(n: number | null): string {
  if (n === null) return 'não informado';
  return `${n.toLocaleString('pt-BR')} volume${n === 1 ? '' : 's'}`;
}

/** Full/misto em palavras comuns (rótulo curto + explicação). */
export const TIPO_PALETE: Record<FullMisto, { rotulo: string; explicacao: string }> = {
  FULL: { rotulo: 'Full', explicacao: 'todo o palete é de uma única nota' },
  MISTO: { rotulo: 'Misto', explicacao: 'o palete tem mais de uma nota' },
  NAO_INFORMADO: { rotulo: 'Composição não informada', explicacao: 'o cadastro não identifica todas as notas deste palete' },
};

export function textoAgenda(a: AgendaTeste): string {
  const data = a.date === null ? '' : ` · ${formatarData(`${a.date}T12:00:00Z`)}`;
  return a.kind === 'JANELA' ? `${a.code} · ${a.name}${data}` : `${a.reference}${data} (agenda de teste)`;
}

/** Quantidade pedida de um item, sem apresentar análise como quantidade confirmada. */
export function textoPedido(i: Pick<ItemSolicitacaoTeste, 'needsAnalysis' | 'requestedVolumes'>): string {
  if (i.needsAnalysis) return i.requestedVolumes === null ? 'Sem quantidade definida (análise)' : `${textoVolumes(i.requestedVolumes)} (a confirmar)`;
  return textoVolumes(i.requestedVolumes);
}

/**
 * Volumes de um palete em palavras: sem nota identificada = conteúdo não
 * identificado; notas sem volume informado aparecem à parte (nada vira zero).
 */
export function textoVolumesPalete(notas: number, conhecidos: number | null, semVolume: number): string {
  if (notas === 0 || conhecidos === null) return 'conteúdo não identificado';
  if (semVolume === notas) return 'volumes não informados';
  return `${textoVolumes(conhecidos)}${semVolume > 0 ? ` + ${String(semVolume)} nota${semVolume === 1 ? '' : 's'} sem volume` : ''}`;
}

/** Remetentes distintos de uma lista de conteúdos. */
export function remetentes(conteudos: readonly Pick<ConteudoEstoqueTeste, 'sender'>[]): string[] {
  return [...new Set(conteudos.flatMap((c) => (c.sender === null ? [] : [c.sender])))];
}

/** Chave estável de um conteúdo (vínculo do inventário ou conteúdo registrado). */
export const chaveConteudo = (c: Pick<ConteudoEstoqueTeste, 'ref'>) => `${c.ref.kind}:${c.ref.id}`;
