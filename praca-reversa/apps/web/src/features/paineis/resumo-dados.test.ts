import { progressoVolumes, type TarefaPainel } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import { barrasJanela, intercalarTarefas, numerosJanela, totalTarefas } from './resumo-dados';

const tarefa = (kind: TarefaPainel['kind'], label: string): TarefaPainel => ({ kind, label, detail: null, palletId: null, palletCode: null, windowId: null, since: null });

describe('resumo do painel (etapa 4)', () => {
  it('janela em volumes: exemplo fictício T 8.000, P 4.500, E 2.000', () => {
    const p = progressoVolumes(8000, 4500, 2000);
    expect(numerosJanela(p).map((n) => [n.rotulo, n.texto])).toEqual([
      ['Solicitado', '8.000'],
      ['Separado', '4.500'],
      ['Expedido', '2.000'],
      ['Falta separar', '1.500'],
      ['Falta expedir', '6.000'],
    ]);
    expect(barrasJanela(p)).toEqual({ preparacao: '81,25%', expedicao: '25,00%', larguraPreparacao: 81.25, larguraExpedicao: 25 });
  });

  it('sem meta (ou meta zero) não há porcentagem nem faltante inventado', () => {
    const semMeta = progressoVolumes(null, 30, 10);
    expect(numerosJanela(semMeta).map((n) => n.texto)).toEqual(['Sem meta', '30', '10', 'Sem meta', 'Sem meta']);
    expect(barrasJanela(semMeta)).toBeNull();
    expect(barrasJanela(progressoVolumes(0, 0, 0))).toBeNull();
  });

  it('acima da meta: a barra para em 100% e o texto mostra o valor real', () => {
    const b = barrasJanela(progressoVolumes(10, 6, 9));
    expect(b?.preparacao).toBe('150,00%');
    expect(b?.larguraPreparacao).toBe(100);
    expect(b?.larguraExpedicao).toBe(90);
  });

  it('prioridades: uma de cada tipo por vez, na ordem da API, até o limite', () => {
    const itens = [tarefa('RECONFERENCIA', 'R1'), tarefa('RECONFERENCIA', 'R2'), tarefa('RECONFERENCIA', 'R3'), tarefa('SEPARACAO', 'S1'), tarefa('LOCALIZACAO', 'L1'), tarefa('LOCALIZACAO', 'L2'), tarefa('NF_SEM_PALETE', 'N1')];
    expect(intercalarTarefas(itens, 4).map((t) => t.label)).toEqual(['R1', 'S1', 'L1', 'N1']);
    expect(intercalarTarefas(itens, 6).map((t) => t.label)).toEqual(['R1', 'S1', 'L1', 'N1', 'R2', 'L2']);
    expect(intercalarTarefas([], 4)).toEqual([]);
    expect(totalTarefas({ location: 2, reconference: 3, separation: 1, documentsWithoutPallet: 0 })).toBe(6);
  });
});
