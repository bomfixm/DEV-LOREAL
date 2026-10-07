import {
  compararQuantidades,
  type ContagemObservada,
  type ItemDeclarado,
  type ItemSaldo,
  type PaleteDetalhe,
  type TipoOrigemDocumento,
  type TotalObservado,
} from '@praca-reversa/contracts';
import { formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { ROTULOS_CONDICAO } from './estados';

export interface LinhaConteudo {
  chave: string;
  sku: string;
  /** Produto ainda não identificado no cadastro. */
  skuPendente: boolean;
  descricao: string;
  lote: string;
  lotePendente: boolean;
  origem: string;
  origemPendente: boolean;
  codigoBarras: string | null;
  condicao: string;
  quantidade: string;
  /** Parte reservada do saldo validado (reservas ativas), quando houver. */
  reservado: string | null;
  /** Parte vinculada a recuperações de claim validadas (não é reserva), quando houver. */
  vinculado: string | null;
  /** Lote/origem pendentes com identidade própria (não se une a outro registro pendente). */
  registroProprio: boolean;
}

/** Uma contagem concluída e ainda não validada, apresentada separadamente (parciais não se somam). */
export interface ContagemApresentada {
  sessaoId: string;
  titulo: string;
  nota: string;
  linhas: LinhaConteudo[];
  pendencias: number;
}

/**
 * Como o conteúdo do palete pode ser apresentado. Cada variante deixa claro o
 * grau de confiança: desconhecido, observado parcialmente, contado sem
 * validação ou saldo validado. Nenhuma variante transforma desconhecido em
 * zero. A declaração documental aparece à parte e não comprova presença física.
 */
export type ApresentacaoConteudo = (
  | { tipo: 'desconhecido'; titulo: string; explicacao: string; saldoConhecido: LinhaConteudo[] | null }
  | { tipo: 'parcial'; titulo: string; explicacao: string; contagens: ContagemApresentada[]; saldoConhecido: LinhaConteudo[] | null }
  | { tipo: 'aguardando'; titulo: string; explicacao: string; contagens: ContagemApresentada[]; saldoAnterior: LinhaConteudo[] | null }
  | { tipo: 'validado'; titulo: string; explicacao: string; saldo: LinhaConteudo[]; contagens: ContagemApresentada[] }
) & { declarados: LinhaConteudo[] };

export const ROTULOS_ORIGEM_DOCUMENTO: Record<TipoOrigemDocumento, string> = {
  DEVOLUCAO: 'Devolução',
  NOTA_FISCAL: 'Nota fiscal',
  MANIFESTO: 'Manifesto',
  OUTRO: 'Outro documento',
};

function origemTexto(tipo: TipoOrigemDocumento | null, referencia: string | null): string {
  if (tipo === null) return 'Origem pendente';
  return `${ROTULOS_ORIGEM_DOCUMENTO[tipo]}${referencia === null ? ' (referência pendente)' : ` ${referencia}`}`;
}

/** Saldo validado ou total observado: produto identificado, lote/origem possivelmente pendentes. */
function linhasDeSegmentos(itens: readonly (ItemSaldo | TotalObservado)[], prefixo: string): LinhaConteudo[] {
  return itens.map((item, indice) => ({
    chave: `${prefixo}-${String(indice)}-${item.sku}`,
    sku: item.sku,
    skuPendente: false,
    descricao: item.description,
    lote: item.lot ?? 'Lote pendente',
    lotePendente: item.lot === null,
    origem: origemTexto(item.originType, item.originReference),
    origemPendente: item.originType === null || item.originReference === null,
    codigoBarras: null,
    condicao: ROTULOS_CONDICAO[item.condition],
    quantidade: `${formatarQuantidade(item.quantity)} ${item.unit}`,
    reservado: 'reserved' in item && compararQuantidades(item.reserved, '0') > 0 ? `${formatarQuantidade(item.reserved)} ${item.unit}` : null,
    vinculado: 'claimLinked' in item && compararQuantidades(item.claimLinked, '0') > 0 ? `${formatarQuantidade(item.claimLinked)} ${item.unit}` : null,
    registroProprio: 'lineage' in item && item.lineage !== null,
  }));
}

/** Linhas declaradas: cada uma com a própria origem documental (ou pendente). */
export function linhasDeclaradas(itens: readonly ItemDeclarado[] | null): LinhaConteudo[] {
  return (itens ?? []).map((item, indice) => ({
    chave: `dec-${String(indice)}-${item.sku ?? 'pendente'}`,
    sku: item.sku ?? 'Produto pendente',
    skuPendente: item.sku === null,
    descricao: item.description,
    lote: item.lot ?? 'Lote pendente',
    lotePendente: item.lot === null,
    origem: origemTexto(item.originType, item.originReference),
    origemPendente: item.originType === null || item.originReference === null,
    codigoBarras: null,
    condicao: item.condition === null ? 'Não informada' : ROTULOS_CONDICAO[item.condition],
    quantidade: `${formatarQuantidade(item.quantity)} ${item.unit}`,
    reservado: null,
    vinculado: null,
    registroProprio: false,
  }));
}

function contagem(c: ContagemObservada): ContagemApresentada {
  const s = c.session;
  const quem = s.concludedBy?.name ?? s.responsible?.name ?? 'carga de demonstração';
  const quando = s.concludedAt === null ? '' : `, ${formatarDataHora(s.concludedAt)}`;
  const escopo = s.scope === 'PARCIAL' ? `parcial${s.scopeDescription ? ` (${s.scopeDescription})` : ''}` : 'completa';
  return {
    sessaoId: s.id,
    titulo: `Conferência nº ${String(s.number)} — ${escopo}`,
    nota: `${s.kind === 'RECONTAGEM' ? 'Recontagem. ' : ''}Concluída por ${quem}${quando}. Observado, ainda não validado.`,
    linhas: linhasDeSegmentos(c.items, `obs-${s.id}`),
    pendencias: c.pending.length,
  };
}

export function apresentarConteudo(palete: PaleteDetalhe): ApresentacaoConteudo {
  const declarados = linhasDeclaradas(palete.declaredItems);
  const contagens = palete.observedCounts.map(contagem);
  // Palete ainda não conferido por inteiro pode ter recebido saldo validado por transferência:
  // só esse item é conhecido; o restante continua desconhecido (nada vira zero).
  const saldoConhecido = palete.currentItems === null ? null : linhasDeSegmentos(palete.currentItems, 'saldo');
  switch (palete.countState) {
    case 'NAO_CONFERIDO':
      return {
        tipo: 'desconhecido',
        titulo: 'Conteúdo desconhecido',
        explicacao:
          saldoConhecido === null
            ? 'Este palete ainda não foi conferido. Nenhuma quantidade física é presumida até a conferência.'
            : 'Este palete ainda não foi conferido por inteiro. Só o saldo recebido por transferência é conhecido; o restante continua desconhecido até a conferência.',
        saldoConhecido,
        declarados,
      };
    case 'PARCIAL':
      return {
        tipo: 'parcial',
        titulo: 'Conferência parcial',
        explicacao: 'Itens observados até agora. O restante do palete continua desconhecido; isto não é saldo validado.',
        contagens,
        saldoConhecido,
        declarados,
      };
    case 'AGUARDANDO_VALIDACAO':
      return {
        tipo: 'aguardando',
        titulo: 'Contado, aguardando validação',
        explicacao: 'As quantidades observadas ainda não são saldo validado. A reconciliação é feita por perfil autorizado.',
        contagens,
        saldoAnterior: palete.currentItems === null ? null : linhasDeSegmentos(palete.currentItems, 'saldo'),
        declarados,
      };
    case 'RECONCILIADO':
      return {
        tipo: 'validado',
        titulo: 'Saldo validado',
        explicacao:
          palete.currentItems?.length === 0
            ? 'Conteúdo conferido e reconciliado: nenhum item no saldo validado (ausência verificada em conferência completa).'
            : 'Conteúdo conferido e reconciliado.',
        saldo: linhasDeSegmentos(palete.currentItems ?? [], 'saldo'),
        contagens,
        declarados,
      };
  }
}
