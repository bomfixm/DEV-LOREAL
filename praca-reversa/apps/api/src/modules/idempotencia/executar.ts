import { createHmac } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ehConflitoTransitorio } from '../../db/erros.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp } from '../../http/erros.js';

/** Tentativas para conflitos transitórios do banco (impasse, serialização). */
const TENTATIVAS_TRANSITORIAS = 3;

export interface PedidoIdempotente {
  escopoId: string;
  usuarioId: string;
  operacao: string;
  chave: string;
  /** Método, rota, parâmetros e corpo do pedido. */
  payload: unknown;
}

export interface Resposta {
  status: number;
  corpo: Prisma.InputJsonValue;
}

export interface ResultadoIdempotente {
  status: number;
  corpo: unknown;
  repetido: boolean;
}

/** JSON com chaves ordenadas, para que o mesmo pedido gere sempre o mesmo hash. */
export function jsonCanonico(valor: unknown): string {
  if (valor === undefined) return 'null';
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  const entradas = Object.entries(valor as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${jsonCanonico(v)}`).join(',')}}`;
}

/**
 * HMAC com o segredo da aplicação: o banco não guarda hash simples de pedidos
 * que contenham senha (o que permitiria testar senhas fora do sistema).
 */
export function hashPayload(segredo: string, payload: unknown): string {
  return createHmac('sha256', segredo).update(jsonCanonico(payload)).digest('hex');
}

async function buscar(db: Banco, p: PedidoIdempotente) {
  return db.registroIdempotencia.findUnique({
    where: {
      escopoId_usuarioId_operacao_chave: { escopoId: p.escopoId, usuarioId: p.usuarioId, operacao: p.operacao, chave: p.chave },
    },
  });
}

function repetir(registro: { payloadHash: string; statusHttp: number; resposta: unknown }, hash: string): ResultadoIdempotente {
  if (registro.payloadHash !== hash) {
    throw new ErroHttp(422, 'IDEMPOTENCIA_CONFLITO', 'Esta chave de idempotência já foi usada com outro pedido.');
  }
  return { status: registro.statusHttp, corpo: registro.resposta, repetido: true };
}

/**
 * Executa uma mutação uma única vez por (escopo, usuário, operação, chave).
 *
 * O registro de idempotência é inserido antes da mutação, na mesma transação.
 * Um pedido concorrente com a mesma chave espera no índice único; quando a
 * primeira transação confirma, ele recebe violação de unicidade e devolve o
 * resultado guardado. A mutação, o evento de auditoria e o resultado são
 * confirmados ou revertidos juntos.
 */
export async function executarIdempotente(
  db: Banco,
  segredo: string,
  pedido: PedidoIdempotente,
  mutacao: (tx: Transacao) => Promise<Resposta>,
  /** Limites da transação interativa (padrão do Prisma 7: espera 2 s, duração 5 s). */
  limites?: { maxWait?: number; timeout?: number },
): Promise<ResultadoIdempotente> {
  const hash = hashPayload(segredo, pedido.payload);
  const anterior = await buscar(db, pedido);
  if (anterior) return repetir(anterior, hash);

  for (let tentativa = 1; ; tentativa++) {
    try {
      return await db.$transaction(async (tx) => {
        const chave = { escopoId: pedido.escopoId, usuarioId: pedido.usuarioId, operacao: pedido.operacao, chave: pedido.chave };
        await tx.registroIdempotencia.create({ data: { ...chave, payloadHash: hash, statusHttp: 0, resposta: {} } });
        const resposta = await mutacao(tx);
        await tx.registroIdempotencia.update({
          where: { escopoId_usuarioId_operacao_chave: chave },
          data: { statusHttp: resposta.status, resposta: resposta.corpo },
        });
        return { status: resposta.status, corpo: resposta.corpo, repetido: false };
      }, limites);
    } catch (erro) {
      // Reenvio concorrente com a mesma chave: a operação já concluída é reconhecida antes de qualquer nova validação.
      const concorrente = await buscar(db, pedido);
      if (concorrente) return repetir(concorrente, hash);
      // Impasse ou falha de serialização do PostgreSQL: a transação inteira foi
      // revertida; repete-se um número limitado de vezes.
      if (tentativa < TENTATIVAS_TRANSITORIAS && ehConflitoTransitorio(erro)) {
        await new Promise((r) => setTimeout(r, 25 * tentativa + Math.floor(Math.random() * 25)));
        continue;
      }
      throw erro;
    }
  }
}
