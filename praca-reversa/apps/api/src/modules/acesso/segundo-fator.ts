import type { Banco } from '../../db/cliente.js';
import {
  cifrarSegredo,
  decifrarSegredo,
  gerarCodigosRecuperacao,
  gerarSegredoTotp,
  hashCodigoRecuperacao,
  normalizarCodigoRecuperacao,
  uriOtpauth,
  base32Codificar,
  verificarTotp,
} from './totp.js';

export interface SituacaoSegundoFator {
  ativo: boolean;
  codigosRecuperacaoRestantes: number;
}

export type ResultadoConferencia = 'TOTP' | 'RECUPERACAO' | null;

/** Verificação em duas etapas: cadastro, conferência no login e remoção. */
export class ServicoSegundoFator {
  constructor(
    private readonly db: Banco,
    private readonly appSegredo: string,
    private readonly agora: () => Date,
  ) {}

  async situacao(usuarioId: string): Promise<SituacaoSegundoFator> {
    const r = await this.db.segundoFator.findUnique({ where: { usuarioId } });
    if (!r?.ativadoEm) return { ativo: false, codigosRecuperacaoRestantes: 0 };
    return { ativo: true, codigosRecuperacaoRestantes: r.codigosRecuperacao.length };
  }

  /** Começa (ou recomeça) o cadastro: segredo novo, ainda não ativo. Recusa se já estiver ativo. */
  async iniciar(usuarioId: string, login: string): Promise<{ segredo: string; uri: string } | 'JA_ATIVO'> {
    const atual = await this.db.segundoFator.findUnique({ where: { usuarioId } });
    if (atual?.ativadoEm) return 'JA_ATIVO';
    const segredo = gerarSegredoTotp();
    const segredoCifrado = cifrarSegredo(segredo, this.appSegredo);
    await this.db.segundoFator.upsert({
      where: { usuarioId },
      create: { usuarioId, segredoCifrado },
      update: { segredoCifrado, ultimoPasso: null, codigosRecuperacao: [] },
    });
    return { segredo: base32Codificar(segredo), uri: uriOtpauth(login, segredo) };
  }

  /** Confirma o cadastro com um código do aplicativo e devolve os códigos de recuperação (só desta vez). */
  async ativar(usuarioId: string, codigo: string): Promise<string[] | 'SEM_CADASTRO' | 'CODIGO_INVALIDO' | 'JA_ATIVO'> {
    const r = await this.db.segundoFator.findUnique({ where: { usuarioId } });
    if (!r) return 'SEM_CADASTRO';
    if (r.ativadoEm) return 'JA_ATIVO';
    const passo = verificarTotp(decifrarSegredo(r.segredoCifrado, this.appSegredo), codigo, this.agora().getTime(), r.ultimoPasso);
    if (passo === null) return 'CODIGO_INVALIDO';
    const codigos = gerarCodigosRecuperacao();
    await this.db.segundoFator.update({
      where: { usuarioId },
      data: { ativadoEm: this.agora(), ultimoPasso: passo, codigosRecuperacao: codigos.map((c) => hashCodigoRecuperacao(c, this.appSegredo)) },
    });
    return codigos;
  }

  async exigido(usuarioId: string): Promise<boolean> {
    return (await this.situacao(usuarioId)).ativo;
  }

  /**
   * Confere um código do aplicativo (6 dígitos) ou de recuperação. Cada um só vale uma vez:
   * o aplicativo guarda o último passo aceito; o de recuperação é removido ao usar.
   */
  async conferir(usuarioId: string, codigo: string): Promise<ResultadoConferencia> {
    const r = await this.db.segundoFator.findUnique({ where: { usuarioId } });
    if (!r?.ativadoEm) return null;

    const passo = verificarTotp(decifrarSegredo(r.segredoCifrado, this.appSegredo), codigo, this.agora().getTime(), r.ultimoPasso);
    if (passo !== null) {
      // Atualização condicional: duas tentativas simultâneas com o mesmo código não passam as duas.
      const gravou = await this.db.segundoFator.updateMany({
        where: { usuarioId, OR: [{ ultimoPasso: null }, { ultimoPasso: { lt: passo } }] },
        data: { ultimoPasso: passo },
      });
      return gravou.count === 1 ? 'TOTP' : null;
    }

    if (normalizarCodigoRecuperacao(codigo).length === 10) {
      const hash = hashCodigoRecuperacao(codigo, this.appSegredo);
      if (r.codigosRecuperacao.includes(hash)) {
        const restantes = r.codigosRecuperacao.filter((h) => h !== hash);
        const gravou = await this.db.segundoFator.updateMany({
          where: { usuarioId, codigosRecuperacao: { has: hash } },
          data: { codigosRecuperacao: restantes },
        });
        return gravou.count === 1 ? 'RECUPERACAO' : null;
      }
    }
    return null;
  }

  /** Remove o segundo fator (o próprio usuário, com senha e código; ou o administrador, se perdeu o celular). */
  async remover(usuarioId: string): Promise<boolean> {
    const r = await this.db.segundoFator.deleteMany({ where: { usuarioId } });
    return r.count > 0;
  }
}
