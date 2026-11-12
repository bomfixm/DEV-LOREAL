import type { CargaJanela, ConteudoPalete, LoteEspelhos, PaleteEmbarque, VeiculoCarga } from '@praca-reversa/contracts';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { CODIGO_FORMULARIO, COLUNAS_DO_DOCUMENTO, type CampoId, type TipoDocumento } from './layout-modelo';

/**
 * Texto de cada campo do espelho, sempre a partir dos dados da API. O editor
 * muda só a apresentação: nenhum valor é digitado nem guardado.
 */
export type PaleteDoLote = LoteEspelhos['items'][number];

export interface LinhaTabela {
  id: string;
  celulas: readonly string[];
  /** Linha de total: a primeira célula ocupa as colunas que faltam. */
  total?: boolean;
  /** Nota com lidos diferente dos volumes: linha em destaque (cinza e negrito, lê bem em P&B). */
  destaque?: boolean;
}
export interface TextoCampo {
  rotulo: string;
  valor: string;
  /** Texto usado quando o rótulo pequeno está desligado (ex.: "PALETE 03"). */
  semRotulo?: string;
}
/** Um espelho pronto para desenhar: dados de um palete, sem nada de aparência. */
export interface DocumentoEspelho {
  /** Identificador estável (id do palete). */
  id: string;
  /** Código mostrado na navegação, nos avisos e em `data-palete`. */
  codigo: string;
  tipo: TipoDocumento;
  cabecalho: readonly string[];
  linhas: readonly LinhaTabela[];
  vazio: string;
  texto: (campo: Exclude<CampoId, 'tabela' | 'divisoria'>, pagina: number, totalPaginas: number) => TextoCampo | null;
}

export function observacao(d: ConteudoPalete): string {
  if (d.check?.state === 'CONFERIDO_COM_DIFERENCA') return `CONFERIDO COM DIFERENÇA ${d.check.at === null ? '' : formatarData(d.check.at)}`;
  if (d.check?.state === 'CONFERIDO') return `CONFERIDO ${d.check.at === null ? '' : formatarData(d.check.at)}`;
  if (d.inventoryCheck?.state === 'INFORMADA' && d.inventoryCheck.date !== null) return `CONFERÊNCIA INFORMADA ${d.inventoryCheck.date.split('-').reverse().join('/')}`;
  if (d.count.state === 'REALIZADA') return `CONTAGEM REGISTRADA${d.count.at === null ? '' : ` ${formatarData(d.count.at)}`}`;
  return 'AGUARDANDO CONFERÊNCIA';
}

const traco = (v: string | number | null | undefined): string => (v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * Lidos menos volumes da nota (ex.: 10 lidos de 18 = −8). `null` quando são
 * iguais ou falta um dos dois: aí o espelho fica normal.
 */
export function diferencaDeVolumes(d: Pick<ConteudoPalete, 'count'>): number | null {
  const { expected, counted } = d.count;
  if (expected === null || counted === null) return null;
  const diferenca = Number(counted) - Number(expected);
  return Number.isFinite(diferenca) && diferenca !== 0 ? diferenca : null;
}

/** Células de uma nota, na ordem das colunas do espelho da praça. Com diferença, o lido leva "(−n)" / "(+n)". */
export function celulasDaNota(d: ConteudoPalete, p: PaleteDoLote): string[] {
  const diferenca = diferencaDeVolumes(d);
  const lido = diferenca === null ? traco(d.count.counted) : `${traco(d.count.counted)} (${diferenca < 0 ? '−' : '+'}${String(Math.abs(diferenca))})`;
  return [traco(d.delivery), traco(d.documentType), traco(d.documentNumber), observacao(d), traco(d.count.expected), lido, traco(d.sender), p.address ?? 'PENDENTE', p.code];
}

function continuacao(pagina: number, total: number): TextoCampo | null {
  if (total <= 1) return null;
  return { rotulo: '', valor: `${pagina === 0 ? 'Folha' : 'Continuação · folha'} ${String(pagina + 1)}/${String(total)}` };
}
const DEMO: TextoCampo = { rotulo: '', valor: 'DEMONSTRAÇÃO — DADOS FICTÍCIOS' };

/** Espelho da praça (tela Imprimir espelhos). */
export function documentoDaPraca(p: PaleteDoLote, lote: Pick<LoteEspelhos, 'scope' | 'generatedAt'>): DocumentoEspelho {
  return {
    id: p.id,
    codigo: p.code,
    tipo: 'praca',
    cabecalho: COLUNAS_DO_DOCUMENTO.praca,
    linhas: p.contents.items.map((d) => ({ id: d.id, celulas: celulasDaNota(d, p), ...(diferencaDeVolumes(d) === null ? {} : { destaque: true }) })),
    vazio: 'SEM CONTEÚDO REGISTRADO — CONFERÊNCIA PENDENTE',
    texto: (campo, pagina, total) => {
      switch (campo) {
        case 'endereco':
          return { rotulo: 'ENDEREÇO', valor: p.address === null ? 'ENDEREÇO NÃO CONFIRMADO' : p.row === 'GR' ? p.address : `RUA ${p.address}` };
        case 'palete':
          return { rotulo: 'PALETE', valor: p.code, semRotulo: `PALETE ${p.code}` };
        case 'continuacao':
          return continuacao(pagina, total);
        case 'demo':
          return lote.scope.demo ? DEMO : null;
        case 'emissao':
          return { rotulo: '', valor: `${lote.scope.name} · Emitido em ${formatarDataHora(lote.generatedAt)}` };
        case 'legenda':
          return { rotulo: '', valor: 'Volumes = volumes da nota · Lido = contagem registrada · (−n) = lidos a menos que os volumes (linha em destaque) · — = não informado' };
        case 'formulario':
          return { rotulo: '', valor: CODIGO_FORMULARIO };
        default:
          return null;
      }
    },
  };
}

/**
 * Espelho de embarque (Expedição, via do cliente): janela, veículo, número do
 * palete e só as NFs/volumes desta saída. Sem observações internas, saldos da
 * praça, outras janelas ou nomes internos (mesmo conteúdo de antes do editor).
 */
export function documentoDoEmbarque(carga: CargaJanela, veiculo: VeiculoCarga, p: PaleteEmbarque, final: boolean): DocumentoEspelho {
  const numero = String(p.number).padStart(2, '0');
  const placa = veiculo.plate ? ` · Placa ${veiculo.plate}` : '';
  const fisico = p.physical.checked && p.physical.at ? ` (físico conferido em ${formatarDataHora(p.physical.at)})` : '';
  return {
    id: p.id,
    codigo: `${veiculo.label} · ${p.label}`,
    tipo: 'embarque',
    cabecalho: COLUNAS_DO_DOCUMENTO.embarque,
    linhas: [
      ...p.lines.map((l) => ({ id: l.id, celulas: [traco(l.documentType), traco(l.documentNumber), traco(l.sender), traco(l.delivery), String(l.volumes), ''] })),
      { id: `${p.id}:total`, celulas: ['TOTAL DO PALETE', String(p.volumes), ''], total: true },
    ],
    vazio: 'SEM NF NESTE PALETE',
    texto: (campo, pagina, total) => {
      switch (campo) {
        case 'palete':
          return { rotulo: 'PALETE', valor: numero, semRotulo: `PALETE ${numero}` };
        case 'veiculo':
          return { rotulo: 'VEÍCULO', valor: `${veiculo.label.toUpperCase()}${placa.toUpperCase()}` };
        case 'janela':
          return { rotulo: 'JANELA', valor: `${carga.window.code} — ${carga.window.name}`, semRotulo: `Janela ${carga.window.code} — ${carga.window.name}${placa}` };
        case 'identidade':
          return { rotulo: '', valor: `${p.identity} · ${p.kind === 'FULL' ? 'FULL' : 'FRACIONADO'} · Revisão ${String(p.revision)}` };
        case 'continuacao':
          return continuacao(pagina, total);
        case 'rascunho':
          return final ? null : { rotulo: '', valor: 'RASCUNHO — NÃO VALE PARA O EMBARQUE' };
        case 'demo':
          return carga.scope.demo ? DEMO : null;
        case 'emissao':
          return { rotulo: '', valor: `Via do cliente · ${carga.scope.name} · Emitido em ${formatarDataHora(carga.generatedAt)} · Volumes = conferidos para esta saída${fisico}` };
        case 'formulario':
          return { rotulo: '', valor: CODIGO_FORMULARIO };
        default:
          return null;
      }
    },
  };
}

/** Texto de exemplo para campos que só aparecem em certos casos (mostrado esmaecido no editor). */
export function textoFantasma(campo: CampoId): string | null {
  if (campo === 'continuacao') return 'Folha 1/2 (só com mais de uma folha)';
  if (campo === 'demo') return 'DEMONSTRAÇÃO — DADOS FICTÍCIOS (só no escopo de demonstração)';
  if (campo === 'rascunho') return 'RASCUNHO — NÃO VALE PARA O EMBARQUE (só no rascunho)';
  return null;
}
