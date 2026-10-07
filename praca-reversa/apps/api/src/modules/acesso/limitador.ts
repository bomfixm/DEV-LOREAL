/**
 * Limite de tentativas de login em memória, por janela deslizante.
 * Vale para uma instância da API; com várias instâncias, mover para o banco
 * ou para um armazenamento compartilhado (registrado em DECISOES.md).
 */
export interface RegraLimite {
  maximo: number;
  janelaMs: number;
}

export class LimitadorTentativas {
  private readonly registros = new Map<string, number[]>();
  private readonly regra: RegraLimite;
  private readonly agora: () => number;

  constructor(regra: RegraLimite, agora: () => number = Date.now) {
    this.regra = regra;
    this.agora = agora;
  }

  private recentes(chave: string): number[] {
    const limite = this.agora() - this.regra.janelaMs;
    const lista = (this.registros.get(chave) ?? []).filter((t) => t > limite);
    if (lista.length === 0) this.registros.delete(chave);
    else this.registros.set(chave, lista);
    return lista;
  }

  /** Segundos até liberar, ou 0 se a chave ainda pode tentar. */
  bloqueadoPor(chave: string): number {
    const lista = this.recentes(chave);
    if (lista.length < this.regra.maximo) return 0;
    const maisAntiga = lista[0] ?? this.agora();
    return Math.max(1, Math.ceil((maisAntiga + this.regra.janelaMs - this.agora()) / 1000));
  }

  registrar(chave: string): void {
    const lista = this.recentes(chave);
    lista.push(this.agora());
    this.registros.set(chave, lista);
  }

  limpar(chave: string): void {
    this.registros.delete(chave);
  }
}
