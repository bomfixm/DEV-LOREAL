import type { EstadoConferencia, Indicadores, IndicadoresConferencia, IndicadoresPraca, PeriodoAplicado } from '@praca-reversa/contracts';
import { formatarQuantidade } from '../../utils/numeros';

/**
 * Dados derivados do dashboard de Indicadores (pedido de 22/10/2026). Só
 * reorganizam os números que a API já devolve: nada é estimado, somado entre
 * unidades diferentes ou trocado por zero quando é desconhecido.
 */

export const ESTADOS_CONFERENCIA: readonly EstadoConferencia[] = ['NAO_CONFERIDO', 'PARCIAL', 'AGUARDANDO_VALIDACAO', 'RECONCILIADO'];

/** Contagem inteira em pt-BR (1.234). */
export function contagem(n: number): string {
  return formatarQuantidade(String(n));
}

/** "1 palete" / "3 paletes". */
export function plural(n: number, um: string, varios: string): string {
  return `${contagem(n)} ${n === 1 ? um : varios}`;
}

/** Porcentagem da API ("96.4") em pt-BR; `null` = sem base para cálculo (nunca "0%"). */
export function textoPercentual(p: string | null): string | null {
  return p === null ? null : `${p.replace('.', ',')}%`;
}

const dia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Período aplicado em forma curta: "01/10 a 22/10/2026" (ano repetido só quando muda; um dia só: "22/10/2026"). */
export function intervaloCurto(p: Pick<PeriodoAplicado, 'start' | 'end'>): string {
  const ano = (d: string) => d.slice(0, 4);
  if (p.start === p.end) return `${dia(p.end)}/${ano(p.end)}`;
  return ano(p.start) === ano(p.end) ? `${dia(p.start)} a ${dia(p.end)}/${ano(p.end)}` : `${dia(p.start)}/${ano(p.start)} a ${dia(p.end)}/${ano(p.end)}`;
}

export interface UsoPosicoes {
  /** Posições elegíveis: o denominador. */
  base: number;
  ocupadas: number;
  /** Elegíveis sem palete registrado (não é "palete livre" confirmado no local). */
  livres: number;
  /** Fora da base (não entram no gráfico). */
  indisponiveis: number;
  indisponiveisComPalete: number;
  /** Fração ocupada da base, só para desenhar; `null` sem base. */
  fracao: number | null;
}

/**
 * Ocupadas e livres da mesma base (posições elegíveis). As indisponíveis
 * ficam fora do denominador e do gráfico: nunca uma composição das posições
 * cadastradas com o percentual das elegíveis no centro.
 */
export function usoPosicoes(praca: IndicadoresPraca): UsoPosicoes | null {
  const p = praca.positions;
  if (p === null) return null;
  return {
    base: p.eligible,
    ocupadas: p.occupied,
    livres: p.free,
    indisponiveis: p.unavailable,
    indisponiveisComPalete: p.unavailableOccupied,
    fracao: p.eligible > 0 ? Math.min(1, p.occupied / p.eligible) : null,
  };
}

export interface BarraConferencia {
  estado: EstadoConferencia;
  valor: number;
  /** Parte dos paletes na praça (os estados são exclusivos e cobrem os paletes na praça). */
  fracao: number;
}

/** Barras por estado atual: só paletes (sessões e observações ficam à parte, em outra unidade). */
export function barrasConferencia(c: IndicadoresConferencia): { total: number; barras: BarraConferencia[] } {
  const total = ESTADOS_CONFERENCIA.reduce((s, e) => s + c.byState[e], 0);
  return {
    total,
    barras: ESTADOS_CONFERENCIA.map((estado) => {
      const valor = c.byState[estado];
      return { estado, valor, fracao: total > 0 ? valor / total : 0 };
    }),
  };
}

export interface PontoAtencao {
  chave: string;
  texto: string;
  tom: 'atencao' | 'alerta';
  /** Relatório que lista exatamente esses paletes (quando existe). */
  relatorio?: Record<string, string>;
}

/**
 * Pontos de atenção tirados só dos números da consulta (nenhuma regra nova,
 * nenhum vencimento ou meta presumidos). Contagem zero não gera ponto.
 */
export function pontosDeAtencao(d: Indicadores): PontoAtencao[] {
  const pontos: PontoAtencao[] = [];
  for (const f of d.estoque?.flow ?? []) {
    if (!f.consistent) pontos.push({ chave: `fluxo-${f.unit}`, tom: 'alerta', texto: `O fluxo do saldo validado em ${f.unit} não fecha: comunique o suporte.` });
  }
  if (d.positionsBasis.provisional) pontos.push({ chave: 'base', tom: 'atencao', texto: 'Base de posições provisória: validação do layout pendente.' });
  if (d.positionsBasis.changesInPeriod > 0) {
    pontos.push({
      chave: 'configuracao',
      tom: 'atencao',
      texto: `A configuração das posições mudou ${plural(d.positionsBasis.changesInPeriod, 'vez', 'vezes')} no período: o denominador da ocupação mudou.`,
    });
  }
  const praca = d.praca;
  if (praca !== null && praca.palletsLocationPending > 0) {
    pontos.push({
      chave: 'localizacao',
      tom: 'atencao',
      texto: `${plural(praca.palletsLocationPending, 'palete', 'paletes')} com localização pendente.`,
      relatorio: { tipo: 'paletes', localizacao: 'PENDENTE' },
    });
  }
  if (praca?.positions && praca.positions.unavailableOccupied > 0) {
    pontos.push({
      chave: 'indisponiveis',
      tom: 'atencao',
      texto: `${plural(praca.positions.unavailableOccupied, 'posição indisponível', 'posições indisponíveis')} com palete registrado (fora da base).`,
    });
  }
  if (d.estoque !== null && d.estoque.palletsWithUnknownContent > 0) {
    pontos.push({
      chave: 'desconhecido',
      tom: 'atencao',
      texto: `${plural(d.estoque.palletsWithUnknownContent, 'palete', 'paletes')} sem conteúdo totalmente validado: conferir e validar o conteúdo.`,
    });
  }
  const conf = d.conferencia;
  if (conf !== null && conf.byState.AGUARDANDO_VALIDACAO > 0) {
    pontos.push({
      chave: 'aguardando',
      tom: 'atencao',
      texto: `${plural(conf.byState.AGUARDANDO_VALIDACAO, 'palete contado', 'paletes contados')} aguardando validação.`,
      relatorio: { tipo: 'paletes', conferencia: 'AGUARDANDO_VALIDACAO' },
    });
  }
  if (conf !== null && conf.pendingObservations > 0) {
    pontos.push({
      chave: 'observacoes',
      tom: 'atencao',
      texto: `${plural(conf.pendingObservations, 'observação pendente', 'observações pendentes')} na conferência (produto não identificado ou fator desconhecido).`,
    });
  }
  return pontos;
}
