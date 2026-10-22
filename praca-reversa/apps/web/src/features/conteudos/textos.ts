import { ROTULOS_ORIGEM_CONTAGEM, type ConteudoPalete } from '@praca-reversa/contracts';
import { apresentarVolumes } from '../paletes/volumes';

type Identificacao = Pick<ConteudoPalete, 'documentType' | 'documentNumber' | 'delivery'> & { documentTypeOriginal?: string | null };

/** "NF 000123" ou "Documento não informado" (tipo ausente com número = "Tipo não informado 000123"); bipagem mostra o tipo como exportado (NF-e, Minuta). */
export function textoDocumento(c: Identificacao): string {
  return c.documentNumber === null ? 'Documento não informado' : `${c.documentTypeOriginal ?? c.documentType ?? 'Tipo não informado'} ${c.documentNumber}`;
}

export function textoDelivery(c: Identificacao): string {
  return c.delivery === null ? 'Delivery não informado' : `Delivery ${c.delivery}`;
}

/** Identificação pendente (sem nota e sem Delivery): mostrada à parte da conferência; não invalida o registro. */
export function identificacaoPendente(c: Identificacao): boolean {
  return c.documentNumber === null && c.delivery === null;
}

/** Situação da conferência de volumes de um conteúdo, para selo e leitura. */
export function textoConferencia(c: Pick<ConteudoPalete, 'count'>): string {
  return c.count.state === 'AGUARDANDO' ? 'Aguardando conferência' : `Contagem realizada${c.count.origin ? ` (${ROTULOS_ORIGEM_CONTAGEM[c.count.origin]})` : ''}`;
}

/** Volumes de um conteúdo pela regra contados × previstos. */
export function textoVolumesConteudo(c: Pick<ConteudoPalete, 'count'>): ReturnType<typeof apresentarVolumes> {
  return apresentarVolumes(c.count.counted, c.count.expected);
}
