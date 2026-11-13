/**
 * Regra dos 1,5 s (D334): o indicador de carregamento só aparece se uma busca
 * real continuar pendente quando completa {@link LIMITE_CARREGAMENTO_MS}.
 *
 * O controle é por área: cada busca da área entra com um id e sai quando
 * resolve, falha ou é cancelada. A área fica "lenta" enquanto existir ao menos
 * uma busca pendente que já passou do limite; concluir uma busca não esconde o
 * indicador das outras que ainda sustentam o carregamento, e uma busca antiga
 * que termina não esconde o indicador de uma nova (cada id tem o próprio
 * início). Sem React: testável com relógio falso.
 */

export const LIMITE_CARREGAMENTO_MS = 1500;

export interface Relogio {
  agora: () => number;
  agendar: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancelar: (id: ReturnType<typeof setTimeout>) => void;
}

const relogioPadrao: Relogio = {
  agora: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  agendar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (id) => {
    clearTimeout(id);
  },
};

export class ControleCarregamento {
  private readonly inicios = new Map<string, number>();
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private atual = false;

  constructor(
    private readonly aoMudar: (lento: boolean) => void,
    private readonly limite = LIMITE_CARREGAMENTO_MS,
    private readonly relogio: Relogio = relogioPadrao,
  ) {}

  /** A área está mostrando o indicador agora. */
  get lento(): boolean {
    return this.atual;
  }

  /** Quantas buscas da área ainda estão pendentes. */
  get pendentes(): number {
    return this.inicios.size;
  }

  /**
   * Uma busca começou. Chamar de novo com o mesmo id (nova renderização) não
   * reinicia o prazo. `inicio` permite informar quando a busca começou de fato.
   */
  iniciar(id: string, inicio = this.relogio.agora()): void {
    if (this.inicios.has(id)) return;
    this.inicios.set(id, inicio);
    this.reavaliar();
  }

  /** A busca resolveu, falhou ou foi cancelada: em todos os casos sai da área. */
  encerrar(id: string): void {
    if (!this.inicios.delete(id)) return;
    this.reavaliar();
  }

  /** Desmontagem ou troca de rota: cancela tudo, sem avisar. */
  descartar(): void {
    this.inicios.clear();
    this.limparTemporizador();
    this.atual = false;
  }

  private limparTemporizador(): void {
    if (this.temporizador !== null) {
      this.relogio.cancelar(this.temporizador);
      this.temporizador = null;
    }
  }

  private reavaliar(): void {
    this.limparTemporizador();
    const agora = this.relogio.agora();
    let lento = false;
    let proximo = Infinity;
    for (const inicio of this.inicios.values()) {
      const vence = inicio + this.limite;
      if (vence <= agora) lento = true;
      else proximo = Math.min(proximo, vence);
    }
    // Só agenda enquanto alguma busca ainda pode cruzar o limite e a área não está lenta.
    if (!lento && proximo !== Infinity) {
      this.temporizador = this.relogio.agendar(
        () => {
          this.temporizador = null;
          this.reavaliar();
        },
        Math.max(0, proximo - agora),
      );
    }
    if (lento !== this.atual) {
      this.atual = lento;
      this.aoMudar(lento);
    }
  }
}
