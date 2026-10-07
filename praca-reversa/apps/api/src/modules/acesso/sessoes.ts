import type { Banco, Transacao } from '../../db/cliente.js';
import { gerarTokenSessao, hashToken } from './tokens.js';

export interface RegrasSessao {
  inatividadeMs: number;
  duracaoMaximaMs: number;
}

export interface SessaoValida {
  id: string;
  usuario: { id: string; login: string; nome: string };
  escopoAtivoId: string | null;
  expiraEm: Date;
}

export type ResultadoValidacao =
  | { estado: 'valida'; sessao: SessaoValida }
  | { estado: 'ausente' }
  | { estado: 'expirada' };

/** Atualiza "último uso" no máximo uma vez por minuto para poupar escritas. */
const INTERVALO_TOQUE_MS = 60_000;

export class ServicoSessoes {
  private readonly db: Banco;
  private readonly regras: RegrasSessao;
  private readonly agora: () => Date;

  constructor(db: Banco, regras: RegrasSessao, agora: () => Date) {
    this.db = db;
    this.regras = regras;
    this.agora = agora;
  }

  /** Cria sessão com identificador novo (renovado a cada login). */
  async criar(usuarioId: string, escopoAtivoId: string | null): Promise<{ token: string; sessao: SessaoValida }> {
    const token = gerarTokenSessao();
    const agora = this.agora();
    const registro = await this.db.sessao.create({
      data: {
        tokenHash: hashToken(token),
        usuarioId,
        escopoAtivoId,
        criadaEm: agora,
        ultimoUsoEm: agora,
        expiraEm: new Date(agora.getTime() + this.regras.duracaoMaximaMs),
      },
      include: { usuario: true },
    });
    return {
      token,
      sessao: {
        id: registro.id,
        usuario: { id: registro.usuario.id, login: registro.usuario.login, nome: registro.usuario.nome },
        escopoAtivoId: registro.escopoAtivoId,
        expiraEm: registro.expiraEm,
      },
    };
  }

  async validar(token: string): Promise<ResultadoValidacao> {
    const registro = await this.db.sessao.findUnique({ where: { tokenHash: hashToken(token) }, include: { usuario: true } });
    if (!registro) return { estado: 'ausente' };
    if (registro.revogadaEm) return { estado: 'expirada' };
    const agora = this.agora();
    const inativa = registro.ultimoUsoEm.getTime() + this.regras.inatividadeMs <= agora.getTime();
    if (registro.expiraEm.getTime() <= agora.getTime() || inativa) {
      await this.revogar(registro.id, 'EXPIRADA');
      return { estado: 'expirada' };
    }
    if (!registro.usuario.ativo) {
      await this.revogar(registro.id, 'CONTA_DESATIVADA');
      return { estado: 'expirada' };
    }
    if (agora.getTime() - registro.ultimoUsoEm.getTime() > INTERVALO_TOQUE_MS) {
      await this.db.sessao.update({ where: { id: registro.id }, data: { ultimoUsoEm: agora } });
    }
    return {
      estado: 'valida',
      sessao: {
        id: registro.id,
        usuario: { id: registro.usuario.id, login: registro.usuario.login, nome: registro.usuario.nome },
        escopoAtivoId: registro.escopoAtivoId,
        expiraEm: registro.expiraEm,
      },
    };
  }

  async revogar(sessaoId: string, motivo: string): Promise<void> {
    await this.db.sessao.updateMany({
      where: { id: sessaoId, revogadaEm: null },
      data: { revogadaEm: this.agora(), motivoRevogacao: motivo },
    });
  }

  async revogarPorToken(token: string, motivo: string): Promise<void> {
    await this.db.sessao.updateMany({
      where: { tokenHash: hashToken(token), revogadaEm: null },
      data: { revogadaEm: this.agora(), motivoRevogacao: motivo },
    });
  }

  async definirEscopo(sessaoId: string, escopoId: string): Promise<void> {
    await this.db.sessao.update({ where: { id: sessaoId }, data: { escopoAtivoId: escopoId } });
  }
}

/** Revoga todas as sessões ativas de um usuário (conta desativada). */
export async function revogarSessoesDoUsuario(tx: Transacao, usuarioId: string, motivo: string, agora: Date): Promise<number> {
  const r = await tx.sessao.updateMany({
    where: { usuarioId, revogadaEm: null },
    data: { revogadaEm: agora, motivoRevogacao: motivo },
  });
  return r.count;
}
