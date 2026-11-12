import type { ConteudoPalete, LoteEspelhos } from '@praca-reversa/contracts';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { CODIGO_FORMULARIO, type CampoId } from './layout-modelo';

/**
 * Texto de cada campo do espelho, sempre a partir do lote gerado pela API.
 * O editor muda só a apresentação: nenhum valor é digitado nem guardado.
 */
export type PaleteDoLote = LoteEspelhos['items'][number];

export function observacao(d: ConteudoPalete): string {
  if (d.check?.state === 'CONFERIDO_COM_DIFERENCA') return `CONFERIDO COM DIFERENÇA ${d.check.at === null ? '' : formatarData(d.check.at)}`;
  if (d.check?.state === 'CONFERIDO') return `CONFERIDO ${d.check.at === null ? '' : formatarData(d.check.at)}`;
  if (d.inventoryCheck?.state === 'INFORMADA' && d.inventoryCheck.date !== null) return `CONFERÊNCIA INFORMADA ${d.inventoryCheck.date.split('-').reverse().join('/')}`;
  if (d.count.state === 'REALIZADA') return `CONTAGEM REGISTRADA${d.count.at === null ? '' : ` ${formatarData(d.count.at)}`}`;
  return 'AGUARDANDO CONFERÊNCIA';
}

const traco = (v: string | number | null | undefined): string => (v === null || v === undefined || v === '' ? '—' : String(v));

/** Células de uma nota, na ordem de COLUNAS_TABELA. */
export function celulasDaNota(d: ConteudoPalete, p: PaleteDoLote): string[] {
  return [traco(d.delivery), traco(d.documentType), traco(d.documentNumber), observacao(d), traco(d.count.expected), traco(d.count.counted), traco(d.sender), p.address ?? 'PENDENTE', p.code];
}

export interface ContextoFolha {
  palete: PaleteDoLote;
  pagina: number;
  totalPaginas: number;
  escopo: LoteEspelhos['scope'];
  geradoEm: string;
}

/** Rótulo pequeno (opcional) e valor de cada campo de texto; `null` = não aparece nesta folha. */
export function textoDoCampo(campo: Exclude<CampoId, 'tabela' | 'divisoria'>, c: ContextoFolha): { rotulo: string; valor: string } | null {
  const p = c.palete;
  switch (campo) {
    case 'endereco':
      return { rotulo: 'ENDEREÇO', valor: p.address === null ? 'ENDEREÇO NÃO CONFIRMADO' : p.row === 'GR' ? p.address : `RUA ${p.address}` };
    case 'palete':
      return { rotulo: 'PALETE', valor: p.code };
    case 'continuacao':
      if (c.totalPaginas <= 1) return null;
      return { rotulo: '', valor: `${c.pagina === 0 ? 'Folha' : 'Continuação · folha'} ${String(c.pagina + 1)}/${String(c.totalPaginas)}` };
    case 'demo':
      return c.escopo.demo ? { rotulo: '', valor: 'DEMONSTRAÇÃO — DADOS FICTÍCIOS' } : null;
    case 'emissao':
      return { rotulo: '', valor: `${c.escopo.name} · Emitido em ${formatarDataHora(c.geradoEm)}` };
    case 'legenda':
      return { rotulo: '', valor: 'Volumes = previsto informado · Lido = contagem registrada · — = não informado' };
    case 'formulario':
      return { rotulo: '', valor: CODIGO_FORMULARIO };
  }
}

/** Texto de exemplo para campos que só aparecem em certos casos (mostrado esmaecido no editor). */
export function textoFantasma(campo: 'continuacao' | 'demo'): string {
  return campo === 'continuacao' ? 'Folha 1/2 (só com mais de uma folha)' : 'DEMONSTRAÇÃO — DADOS FICTÍCIOS (só no escopo de demonstração)';
}
