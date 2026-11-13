import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControleCarregamento, LIMITE_CARREGAMENTO_MS, type Relogio } from './atraso';

/** Relógio sobre os temporizadores falsos do Vitest. */
const relogio: Relogio = {
  agora: () => Date.now(),
  agendar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (id) => {
    clearTimeout(id);
  },
};

/** Busca simulada: resolve ou falha depois de `ms`, avisando o controle (como o useRecurso faz). */
function buscar(controle: ControleCarregamento, id: string, ms: number, resultado: 'pronto' | 'erro' = 'pronto') {
  controle.iniciar(id);
  return new Promise<string>((resolve, reject) => {
    setTimeout(() => {
      controle.encerrar(id);
      if (resultado === 'pronto') resolve(id);
      else reject(new Error(id));
    }, ms);
  });
}

describe('regra dos 1,5 s do indicador de carregamento', () => {
  let mudancas: { em: number; lento: boolean }[];
  let controle: ControleCarregamento;
  let t0: number;

  beforeEach(() => {
    vi.useFakeTimers();
    t0 = Date.now();
    mudancas = [];
    controle = new ControleCarregamento((lento) => mudancas.push({ em: Date.now() - t0, lento }), LIMITE_CARREGAMENTO_MS, relogio);
  });

  afterEach(() => {
    controle.descartar();
    vi.useRealTimers();
  });

  it('busca de 1.200 ms: o indicador nunca aparece e os dados chegam na hora', async () => {
    const dados = buscar(controle, 'mapa', 1200);
    await vi.advanceTimersByTimeAsync(1200);
    await expect(dados).resolves.toBe('mapa');
    expect(mudancas).toEqual([]);
    expect(controle.lento).toBe(false);
    // Nenhum temporizador fica para trás.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mudancas).toEqual([]);
  });

  it('busca de 2.500 ms: aparece aos 1.500 ms e sai assim que os dados chegam', async () => {
    const dados = buscar(controle, 'mapa', 2500);
    await vi.advanceTimersByTimeAsync(1499);
    expect(controle.lento).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(controle.lento).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(dados).resolves.toBe('mapa');
    expect(controle.lento).toBe(false);
    expect(mudancas).toEqual([
      { em: 1500, lento: true },
      { em: 2500, lento: false },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('nova renderização (mesmo id) não reinicia o prazo', async () => {
    controle.iniciar('lista');
    await vi.advanceTimersByTimeAsync(1000);
    controle.iniciar('lista');
    await vi.advanceTimersByTimeAsync(500);
    expect(controle.lento).toBe(true);
  });

  it('buscas concorrentes: concluir uma não esconde o indicador da outra que continua', async () => {
    const curta = buscar(controle, 'a', 1800);
    const longa = buscar(controle, 'b', 3000);
    await vi.advanceTimersByTimeAsync(1500);
    expect(controle.lento).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    await curta;
    expect(controle.lento).toBe(true);
    expect(controle.pendentes).toBe(1);
    await vi.advanceTimersByTimeAsync(1200);
    await longa;
    expect(controle.lento).toBe(false);
    // Uma só aparição para a área: os indicadores não se sobrepõem nem piscam.
    expect(mudancas).toEqual([
      { em: 1500, lento: true },
      { em: 3000, lento: false },
    ]);
  });

  it('resposta antiga não esconde o indicador de uma busca nova (cada busca tem o próprio início)', async () => {
    controle.iniciar('palete-1');
    await vi.advanceTimersByTimeAsync(1000);
    controle.iniciar('palete-2');
    // A antiga chega aos 1.400 ms: a nova continua contando a partir do próprio início.
    await vi.advanceTimersByTimeAsync(400);
    controle.encerrar('palete-1');
    expect(controle.lento).toBe(false);
    await vi.advanceTimersByTimeAsync(1099);
    expect(controle.lento).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(controle.lento).toBe(true);
    // Encerrar de novo a antiga (resposta atrasada) não mexe na nova.
    controle.encerrar('palete-1');
    expect(controle.lento).toBe(true);
  });

  it('erro depois do limite encerra o indicador sem temporizador pendente', async () => {
    const falha = buscar(controle, 'claims', 2000, 'erro');
    falha.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(falha).rejects.toThrow('claims');
    expect(controle.lento).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('erro antes do limite: o indicador nunca aparece', async () => {
    const falha = buscar(controle, 'claims', 300, 'erro');
    falha.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mudancas).toEqual([]);
  });

  it('cancelamento antes do limite cancela o temporizador', async () => {
    controle.iniciar('busca');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(800);
    controle.encerrar('busca');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mudancas).toEqual([]);
  });

  it('troca de rota/desmontagem descarta tudo: nenhum aviso depois', async () => {
    controle.iniciar('a');
    controle.iniciar('b');
    await vi.advanceTimersByTimeAsync(700);
    controle.descartar();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mudancas).toEqual([]);
    expect(controle.lento).toBe(false);
  });

  it('respeita o início informado (busca que começou durante a abertura)', async () => {
    // A busca começou 1.300 ms antes de a área assumir o controle (ex.: durante a abertura).
    controle.iniciar('mapa', Date.now() - 1300);
    await vi.advanceTimersByTimeAsync(199);
    expect(controle.lento).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(controle.lento).toBe(true);
    // Já passada do limite ao entrar: aparece na hora.
    controle.descartar();
    controle.iniciar('outra', Date.now() - 2000);
    expect(controle.lento).toBe(true);
  });
});
