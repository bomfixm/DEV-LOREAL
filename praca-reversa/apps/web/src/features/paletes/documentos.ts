export interface DocumentoAgrupado<T> {
  chave: string;
  tipo: string | null;
  /** `null` = documento não informado (cada conteúdo sem número fica no próprio grupo, nunca unido a outro). */
  numero: string | null;
  /** Uma parcela por conteúdo/vínculo: Deliveries diferentes (ou sem Delivery) da mesma nota neste palete. */
  parcelas: T[];
}

interface Identificavel {
  documentType: string | null;
  documentNumber: string | null;
  state?: string;
  /** Bipagem: CNPJ do remetente (o mesmo número de outro remetente é outro documento) e tipo como exportado. */
  senderCnpj?: string | null;
  documentTypeOriginal?: string | null;
}

/**
 * Documentos do palete para a consulta: conteúdos ativos agrupados por tipo
 * e número. Uma NF com duas Deliveries conta 1 documento e mostra 2 parcelas,
 * cada uma com os próprios volumes (nunca o total da nota repetido). Conteúdo
 * sem número não é unido a nenhum outro (identidade própria).
 */
export function agruparDocumentos<T extends Identificavel>(itens: readonly T[]): DocumentoAgrupado<T>[] {
  const grupos = new Map<string, DocumentoAgrupado<T>>();
  itens.forEach((item, indice) => {
    if (item.state === 'ENCERRADO') return;
    const cnpj = (item.senderCnpj ?? '').replace(/\D+/g, '');
    const chave = item.documentNumber === null ? `sem-documento:${String(indice)}` : `${item.documentType ?? ''}|${item.documentNumber}|${cnpj}`;
    const grupo = grupos.get(chave);
    if (grupo) grupo.parcelas.push(item);
    else grupos.set(chave, { chave, tipo: item.documentTypeOriginal ?? item.documentType, numero: item.documentNumber, parcelas: [item] });
  });
  return [...grupos.values()];
}

/** Documentos identificados distintos (os sem número não contam como documento). */
export function contarDocumentos(itens: readonly Identificavel[]): number {
  return agruparDocumentos(itens).filter((g) => g.numero !== null).length;
}
