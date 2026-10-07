/**
 * Capacidade das janelas (etapa 08; R21–R23). Regras puras, sem banco:
 * quanto uma seleção consome de cada restrição e se cabe no restante.
 *
 * - QUANTIDADE: soma das linhas na unidade da restrição. Unidade diferente não
 *   é convertida por suposição (incompatível; a fonte registrada é "mesma unidade").
 * - CAIXAS: contagem física de embalagens por unidade de carga (inteira).
 * - PALETES: unidades de carga físicas distintas (várias linhas no mesmo
 *   palete contam um); nunca frações de palete.
 * - PESO_KG: soma dos pesos medidos na base da restrição (bruto ou líquido,
 *   nunca misturados).
 * - VOLUME_M3: soma dos volumes medidos; não é inferido do número de paletes.
 *
 * Medida ausente = pendência; limite ausente = pendência (nunca ilimitado);
 * limite zero = sem capacidade. Todas as restrições precisam passar juntas.
 */
import {
  ROTULOS_BASE_PESO,
  ROTULOS_METRICA,
  compararQuantidades,
  normalizarQuantidade,
  somarQuantidades,
  subtrairQuantidades,
  type BasePeso,
  type MetricaCapacidade,
  type SituacaoVerificacao,
  type VerificacaoMetrica,
} from '@praca-reversa/contracts';

export interface RestricaoRegra {
  id: string;
  metrica: MetricaCapacidade;
  unidade: string;
  basePeso: BasePeso | null;
  /** `null` = limite pendente. */
  limite: string | null;
  reservado: string;
  expedido: string;
}

export interface LinhaCarga {
  paleteId: string;
  paleteCodigo: string;
  sku: string;
  unidade: string;
  quantidade: string;
}

export interface MedidaCarga {
  paleteId: string;
  caixas: string | null;
  pesoKg: string | null;
  basePeso: BasePeso | null;
  volumeM3: string | null;
  fonte: string | null;
}

export interface Consumo {
  restricaoId: string;
  metrica: MetricaCapacidade;
  unidade: string;
  /** `null` quando a medida é desconhecida ou incompatível. */
  valor: string | null;
  situacao: 'OK' | 'PENDENTE' | 'INCOMPATIVEL';
  mensagem: string;
  /** Fator/fonte usados no cálculo. */
  base: string;
}

const lista = (itens: readonly string[]) => (itens.length <= 3 ? itens.join(', ') : `${itens.slice(0, 3).join(', ')} e mais ${String(itens.length - 3)}`);

function rotuloRestricao(r: Pick<RestricaoRegra, 'metrica' | 'unidade' | 'basePeso'>): string {
  if (r.metrica === 'PESO_KG') return `peso ${r.basePeso ? ROTULOS_BASE_PESO[r.basePeso] : ''} (kg)`.replace('  ', ' ');
  if (r.metrica === 'QUANTIDADE') return `quantidade (${r.unidade})`;
  return ROTULOS_METRICA[r.metrica].toLowerCase();
}

/** Paletes (unidades de carga) distintos da seleção, na ordem de aparição. */
export function unidadesDaCarga(linhas: readonly LinhaCarga[]): { paleteId: string; paleteCodigo: string }[] {
  const vistos = new Map<string, string>();
  for (const l of linhas) if (!vistos.has(l.paleteId)) vistos.set(l.paleteId, l.paleteCodigo);
  return [...vistos].map(([paleteId, paleteCodigo]) => ({ paleteId, paleteCodigo }));
}

/** Quanto a seleção consome de uma restrição (sem olhar o limite). */
export function calcularConsumo(r: RestricaoRegra, linhas: readonly LinhaCarga[], medidas: ReadonlyMap<string, MedidaCarga>): Consumo {
  const comum = { restricaoId: r.id, metrica: r.metrica, unidade: r.unidade };
  const unidades = unidadesDaCarga(linhas);
  switch (r.metrica) {
    case 'QUANTIDADE': {
      const incompativeis = linhas.filter((l) => l.unidade !== r.unidade);
      if (incompativeis.length > 0) {
        return {
          ...comum,
          valor: null,
          situacao: 'INCOMPATIVEL',
          mensagem: `Limite em ${r.unidade}: ${lista(incompativeis.map((l) => `${l.sku} em ${l.unidade}`))} sem fator aprovado para ${r.unidade}. Nenhuma conversão é presumida.`,
          base: 'unidade incompatível',
        };
      }
      return { ...comum, valor: somarQuantidades(linhas.map((l) => l.quantidade)), situacao: 'OK', mensagem: 'Soma das quantidades na mesma unidade.', base: `mesma unidade (${r.unidade}), fator 1` };
    }
    case 'PALETES':
      return {
        ...comum,
        valor: String(unidades.length),
        situacao: 'OK',
        mensagem: 'Unidades de carga físicas distintas (várias linhas no mesmo palete contam uma).',
        base: 'contagem de paletes físicos distintos',
      };
    case 'CAIXAS':
    case 'VOLUME_M3':
    case 'PESO_KG': {
      const faltam: string[] = [];
      const baseErrada: string[] = [];
      const valores: string[] = [];
      const fontes = new Set<string>();
      for (const u of unidades) {
        const m = medidas.get(u.paleteId);
        const valor = r.metrica === 'CAIXAS' ? m?.caixas : r.metrica === 'VOLUME_M3' ? m?.volumeM3 : m?.pesoKg;
        if (valor === null || valor === undefined) {
          faltam.push(u.paleteCodigo);
          continue;
        }
        if (r.metrica === 'PESO_KG' && m?.basePeso !== r.basePeso) {
          baseErrada.push(`${u.paleteCodigo} (${m?.basePeso ? ROTULOS_BASE_PESO[m.basePeso] : 'sem base'})`);
          continue;
        }
        valores.push(valor);
        if (m?.fonte) fontes.add(m.fonte);
      }
      if (baseErrada.length > 0) {
        return {
          ...comum,
          valor: null,
          situacao: 'INCOMPATIVEL',
          mensagem: `Limite de peso ${r.basePeso ? ROTULOS_BASE_PESO[r.basePeso] : ''}: ${lista(baseErrada)} medido em outra base. Peso bruto e líquido não se misturam.`,
          base: 'base de peso incompatível',
        };
      }
      if (faltam.length > 0) {
        const qual = r.metrica === 'CAIXAS' ? 'Contagem de caixas' : r.metrica === 'VOLUME_M3' ? 'Volume (m³)' : 'Peso';
        return {
          ...comum,
          valor: null,
          situacao: 'PENDENTE',
          mensagem: `${qual} desconhecido da unidade de carga ${lista(faltam)}: informe a medida (com fonte) antes de reservar. ${r.metrica === 'VOLUME_M3' ? 'O volume não é inferido do número de paletes.' : r.metrica === 'CAIXAS' ? 'Peças soltas não viram caixas por suposição.' : ''}`.trim(),
          base: 'medida pendente',
        };
      }
      return {
        ...comum,
        valor: somarQuantidades(valores),
        situacao: 'OK',
        mensagem: 'Soma das medidas informadas das unidades de carga.',
        base: fontes.size === 0 ? 'medida informada' : `medida informada: ${lista([...fontes])}`,
      };
    }
  }
}

/** Restante da restrição: limite − reservado − expedido (`null` com limite pendente). */
export function restante(r: Pick<RestricaoRegra, 'limite' | 'reservado' | 'expedido'>): string | null {
  return r.limite === null ? null : normalizarQuantidade(subtrairQuantidades(subtrairQuantidades(r.limite, r.reservado), r.expedido));
}

/**
 * Verifica se o consumo cabe na restrição. `devolvido` é a parte já
 * reservada por esta mesma reserva (revalidação de medidas na preparação).
 */
export function verificar(r: RestricaoRegra, consumo: Consumo, devolvido = '0'): VerificacaoMetrica {
  const rest = restante(r);
  const disponivel = rest === null ? null : somarQuantidades([rest, devolvido]);
  const base = {
    restrictionId: r.id,
    metric: r.metrica,
    unit: r.unidade,
    weightBase: r.basePeso,
    limit: r.limite === null ? null : normalizarQuantidade(r.limite),
    reserved: normalizarQuantidade(r.reservado),
    shipped: normalizarQuantidade(r.expedido),
    remaining: rest,
    requested: consumo.valor === null ? null : normalizarQuantidade(consumo.valor),
    basis: consumo.base,
  };
  const rotulo = rotuloRestricao(r);
  let state: SituacaoVerificacao;
  let message: string;
  if (r.limite === null) {
    state = 'PENDENTE';
    message = `Limite de ${rotulo} pendente: capacidade desconhecida não é ilimitada. Registre o limite autorizado antes de reservar.`;
  } else if (consumo.situacao !== 'OK' || consumo.valor === null) {
    state = consumo.situacao === 'INCOMPATIVEL' ? 'INCOMPATIVEL' : 'PENDENTE';
    message = consumo.mensagem;
  } else if (disponivel !== null && compararQuantidades(consumo.valor, disponivel) > 0) {
    state = 'EXCEDE';
    message =
      compararQuantidades(r.limite, '0') === 0
        ? `Limite de ${rotulo} é zero: a janela não tem capacidade nessa métrica.`
        : `A seleção usa ${normalizarQuantidade(consumo.valor)} de ${rotulo}, acima do restante ${normalizarQuantidade(disponivel)} (limite ${normalizarQuantidade(r.limite)} − reservado ${normalizarQuantidade(r.reservado)} − expedido ${normalizarQuantidade(r.expedido)}).`;
  } else {
    state = 'OK';
    message = `Cabe: usa ${normalizarQuantidade(consumo.valor)} de ${rotulo}; restam ${normalizarQuantidade(subtrairQuantidades(disponivel ?? '0', consumo.valor))}.`;
  }
  return { ...base, state, message };
}

/** Verifica todas as restrições; a janela sem restrição declarada fica pendente de capacidade. */
export function verificarTodas(
  restricoes: readonly RestricaoRegra[],
  linhas: readonly LinhaCarga[],
  medidas: ReadonlyMap<string, MedidaCarga>,
  devolvidos: ReadonlyMap<string, string> = new Map(),
): { metricas: VerificacaoMetrica[]; consumos: Consumo[]; bloqueios: string[] } {
  const pares = restricoes.map((r) => {
    const consumo = calcularConsumo(r, linhas, medidas);
    return { consumo, metrica: verificar(r, consumo, devolvidos.get(r.id) ?? '0') };
  });
  const consumos = pares.map((p) => p.consumo);
  const metricas = pares.map((p) => p.metrica);
  const bloqueios = metricas.filter((m) => m.state !== 'OK').map((m) => m.message);
  if (restricoes.length === 0) bloqueios.unshift('A janela não tem nenhuma restrição de capacidade declarada: capacidade pendente (não é ilimitada).');
  return { metricas, consumos, bloqueios };
}
