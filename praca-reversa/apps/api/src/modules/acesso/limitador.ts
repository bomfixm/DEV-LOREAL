import { createHmac } from 'node:crypto';
import type { Banco } from '../../db/cliente.js';

/**
 * Limite de tentativas de login por janela deslizante, guardado no banco: o
 * bloqueio sobrevive a reinícios do servidor e vale para todas as instâncias.
 * O banco não guarda o login digitado nem o IP, só um HMAC deles.
 */
export interface RegraLimite {
  maximo: number;
  janelaMs: number;
}

export type TipoLimite = 'CONTA' | 'IP';

/** Falhas mais antigas que isso são apagadas na próxima falha registrada. */
const RETENCAO_MS = 24 * 3_600_000;

export class LimitadorTentativas {
  constructor(
    private readonly db: Banco,
    private readonly tipo: TipoLimite,
    private readonly regra: RegraLimite,
    private readonly segredo: string,
    private readonly agora: () => number = Date.now,
  ) {}

  private chave(valor: string): string {
    return createHmac('sha256', this.segredo).update(`limite-login:${this.tipo}:${valor}`).digest('hex');
  }

  /** Segundos até liberar, ou 0 se a chave ainda pode tentar. */
  async bloqueadoPor(valor: string): Promise<number> {
    const desde = new Date(this.agora() - this.regra.janelaMs);
    const recentes = await this.db.tentativaLogin.findMany({
      where: { tipo: this.tipo, chave: this.chave(valor), ocorridoEm: { gt: desde } },
      orderBy: { ocorridoEm: 'asc' },
      take: this.regra.maximo,
      select: { ocorridoEm: true },
    });
    if (recentes.length < this.regra.maximo) return 0;
    const maisAntiga = recentes[0]?.ocorridoEm.getTime() ?? this.agora();
    return Math.max(1, Math.ceil((maisAntiga + this.regra.janelaMs - this.agora()) / 1000));
  }

  async registrar(valor: string): Promise<void> {
    const agora = this.agora();
    await this.db.tentativaLogin.create({ data: { tipo: this.tipo, chave: this.chave(valor), ocorridoEm: new Date(agora) } });
    // Limpeza oportunista: a tabela não cresce além do que o limite precisa.
    await this.db.tentativaLogin.deleteMany({ where: { ocorridoEm: { lt: new Date(agora - RETENCAO_MS) } } });
  }

  async limpar(valor: string): Promise<void> {
    await this.db.tentativaLogin.deleteMany({ where: { tipo: this.tipo, chave: this.chave(valor) } });
  }
}
