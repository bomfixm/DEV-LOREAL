import type { ProgressoCliente, ProgressoVolumes, TarefaPainel } from '@praca-reversa/contracts';
import { useEffect, useState } from 'react';
import { porcento, volumes } from './formato';

/**
 * Números do resumo (etapa 4) sem regra nova: tudo vem da API. Aqui só a
 * escolha de quais linhas mostrar e o texto de cada número.
 */

export interface NumeroJanela {
  chave: 'solicitado' | 'separado' | 'expedido' | 'falta-separar' | 'falta-expedir';
  rotulo: string;
  texto: string;
  /** Como o número é obtido (dica ao passar o mouse). */
  dica: string;
}

/** Solicitado (T), separado aguardando saída (P), expedido (E) e faltantes; sem meta, os faltantes não existem. */
export function numerosJanela(p: ProgressoVolumes | ProgressoCliente): NumeroJanela[] {
  const semMeta = 'Sem meta';
  return [
    { chave: 'solicitado', rotulo: 'Solicitado', texto: p.requested === null ? semMeta : volumes(p.requested), dica: 'Volumes pedidos pelo cliente para a janela (meta registrada).' },
    { chave: 'separado', rotulo: 'Separado', texto: volumes(p.separatedWaiting), dica: 'Separado e ainda aguardando saída (ao expedir, sai daqui e vai para Expedido).' },
    { chave: 'expedido', rotulo: 'Expedido', texto: volumes(p.shipped), dica: 'Saída confirmada.' },
    { chave: 'falta-separar', rotulo: 'Falta separar', texto: p.missingToSeparate === null ? semMeta : volumes(p.missingToSeparate), dica: 'Solicitado − Separado − Expedido (nunca abaixo de zero).' },
    { chave: 'falta-expedir', rotulo: 'Falta expedir', texto: p.missingToShip === null ? semMeta : volumes(p.missingToShip), dica: 'Solicitado − Expedido (nunca abaixo de zero).' },
  ];
}

/** Porcentagens só com meta válida (T > 0); sem meta, nenhuma barra. */
export function barrasJanela(p: ProgressoVolumes | ProgressoCliente): { preparacao: string; expedicao: string; larguraPreparacao: number; larguraExpedicao: number } | null {
  if (p.preparationPercent === null || p.shippingPercent === null) return null;
  return {
    preparacao: porcento(p.preparationPercent) ?? '',
    expedicao: porcento(p.shippingPercent) ?? '',
    // A barra para em 100% na largura; o valor real fica no texto.
    larguraPreparacao: Math.min(100, Math.max(0, Number(p.preparationPercent))),
    larguraExpedicao: Math.min(100, Math.max(0, Number(p.shippingPercent))),
  };
}

/**
 * Poucas prioridades úteis: uma de cada tipo por vez (reconferência,
 * separação, localização, NF sem palete), na ordem da API, até `n`.
 */
export function intercalarTarefas(itens: readonly TarefaPainel[], n: number): TarefaPainel[] {
  const grupos = new Map<TarefaPainel['kind'], TarefaPainel[]>();
  for (const t of itens) grupos.set(t.kind, [...(grupos.get(t.kind) ?? []), t]);
  const filas = [...grupos.values()];
  const saida: TarefaPainel[] = [];
  for (let i = 0; saida.length < n && filas.some((f) => f.length > i); i++) {
    for (const fila of filas) {
      const t = fila[i];
      if (t !== undefined && saida.length < n) saida.push(t);
    }
  }
  return saida;
}

/** Total de prioridades (as listas da API vêm limitadas; os totais não). */
export function totalTarefas(totais: { location: number; reconference: number; separation: number; documentsWithoutPallet: number }): number {
  return totais.location + totais.reconference + totais.separation + totais.documentsWithoutPallet;
}

/**
 * Quantas linhas cabem nas listas curtas do resumo: mais em telas altas
 * (1080 px), menos nas de 720–768 px. Só muda quantas linhas da mesma lista aparecem.
 */
export function useLinhasResumo(normal: number, alta: number): number {
  const consulta = '(min-width: 1024px) and (min-height: 950px)';
  const [ehAlta, setEhAlta] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(consulta).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(consulta);
    const mudar = () => {
      setEhAlta(m.matches);
    };
    m.addEventListener('change', mudar);
    return () => {
      m.removeEventListener('change', mudar);
    };
  }, []);
  return ehAlta ? alta : normal;
}
