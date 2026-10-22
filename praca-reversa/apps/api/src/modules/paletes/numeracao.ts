/**
 * Número operacional do palete novo (21 out. 2026, D285): a série física do
 * piso, sem prefixo ("279"), distinta do ID técnico (UUID) e do endereço.
 *
 * - A linha do escopo em `numeracao_palete` fica bloqueada (FOR UPDATE) até o
 *   fim da transação: cadastros simultâneos recebem números diferentes. O
 *   código do palete também é único no banco (escopo + código).
 * - Pula as faixas reservadas (ex.: 1000–1015, paletes "com gato" aguardando
 *   o cliente) e todo número já usado — por palete (inclusive arquivado ou
 *   expedido) ou como N° Pallet em qualquer versão do inventário. Nunca
 *   reutiliza; reiniciar o servidor, importar ou liberar posição não mexe.
 * - Sem definição, começa no maior número conhecido até 999 + 1 (paletes e
 *   N° Pallet da planilha). `npm run paletes:numeracao` registra o ponto de
 *   partida informado pela operação e as faixas reservadas, com auditoria.
 */
import { chaveDeCodigo } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';

type Db = Banco | Transacao;

/** Maior número da série física considerado ao começar sem definição (os de 1000 em diante são outra série). */
const FIM_SERIE_INICIAL = 999;

export interface FaixaReservada {
  de: number;
  ate: number;
}

export interface Numeracao {
  proximo: number;
  reservados: FaixaReservada[];
  origem: string;
  atualizadoEm: Date;
}

export function lerFaixas(valor: unknown): FaixaReservada[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((x) => {
    if (!Array.isArray(x) || x.length !== 2) return [];
    const [de, ate] = x as unknown[];
    return typeof de === 'number' && typeof ate === 'number' && Number.isInteger(de) && Number.isInteger(ate) && de >= 1 && ate >= de ? [{ de, ate }] : [];
  });
}

/** Faixa "1000-1015" (ou um número só) → { de, ate }. */
export function faixaDeTexto(texto: string): FaixaReservada {
  const m = /^\s*(\d{1,9})\s*(?:-\s*(\d{1,9}))?\s*$/.exec(texto);
  if (!m) throw new Error(`Faixa inválida: "${texto}" (use 1000-1015).`);
  const de = Number(m[1]);
  const ate = m[2] === undefined ? de : Number(m[2]);
  if (de < 1 || ate < de) throw new Error(`Faixa inválida: "${texto}".`);
  return { de, ate };
}

/** Próximo número sem definição: maior número conhecido até 999 (código numérico de palete ou N° Pallet da planilha) + 1. */
export async function inicioPadrao(db: Db, escopoId: string): Promise<number> {
  const [r] = await db.$queryRaw<{ maior: number | null }[]>`
    SELECT max(n)::int AS maior FROM (
      SELECT CASE WHEN btrim(codigo) ~ '^[0-9]{1,9}$' THEN btrim(codigo)::bigint END AS n FROM palete WHERE escopo_id = ${escopoId}::uuid
      UNION ALL
      SELECT CASE WHEN btrim(numero_palete) ~ '^[0-9]{1,9}$' THEN btrim(numero_palete)::bigint END FROM linha_inventario WHERE escopo_id = ${escopoId}::uuid
    ) t WHERE n BETWEEN 1 AND ${FIM_SERIE_INICIAL}`;
  return (r?.maior ?? 0) + 1;
}

export async function lerNumeracao(db: Db, escopoId: string): Promise<Numeracao | null> {
  const n = await db.numeracaoPalete.findUnique({ where: { escopoId }, select: { proximo: true, reservados: true, origem: true, atualizadoEm: true } });
  return n === null ? null : { proximo: n.proximo, reservados: lerFaixas(n.reservados), origem: n.origem, atualizadoEm: n.atualizadoEm };
}

/** Número já usado: código de palete (qualquer situação) ou N° Pallet em qualquer versão do inventário. */
async function usado(db: Db, escopoId: string, numero: number): Promise<boolean> {
  const texto = String(numero);
  const [r] = await db.$queryRaw<{ usado: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM palete WHERE escopo_id = ${escopoId}::uuid AND codigo_busca = ${chaveDeCodigo(texto)})
        OR EXISTS (SELECT 1 FROM linha_inventario WHERE escopo_id = ${escopoId}::uuid
                     AND CASE WHEN btrim(numero_palete) ~ '^[0-9]{1,15}$' THEN btrim(numero_palete)::numeric END = ${numero}) AS usado`;
  return r?.usado === true;
}

/**
 * Próximo número livre, a partir de `proximo`: salta faixas reservadas e
 * números usados. Só lê; quem grava é `reservarNumeroPalete`.
 */
export async function previsaoNumeroPalete(db: Db, escopoId: string): Promise<number> {
  const n = await lerNumeracao(db, escopoId);
  return primeiroLivre(db, escopoId, n?.proximo ?? (await inicioPadrao(db, escopoId)), n?.reservados ?? []);
}

async function primeiroLivre(db: Db, escopoId: string, inicio: number, reservados: readonly FaixaReservada[]): Promise<number> {
  let n = inicio;
  for (let tentativas = 0; tentativas < 100_000; tentativas += 1) {
    const faixa = reservados.find((f) => n >= f.de && n <= f.ate);
    if (faixa !== undefined) {
      n = faixa.ate + 1;
      continue;
    }
    if (!(await usado(db, escopoId, n))) return n;
    n += 1;
  }
  throw new Error('Não foi possível encontrar um número de palete livre.');
}

/**
 * Reserva o próximo número na transação (linha da numeração travada até o
 * fim dela): grava `proximo` = número + 1 e devolve o número como texto.
 */
export async function reservarNumeroPalete(tx: Transacao, escopoId: string, agora: Date): Promise<string> {
  const inicio = await inicioPadrao(tx, escopoId);
  await tx.$executeRaw`
    INSERT INTO numeracao_palete (escopo_id, proximo, reservados, origem, atualizado_em)
    VALUES (${escopoId}::uuid, ${inicio}, '[]'::jsonb, 'maior número conhecido até 999 + 1', ${agora})
    ON CONFLICT (escopo_id) DO NOTHING`;
  const [linha] = await tx.$queryRaw<{ proximo: number; reservados: unknown }[]>`
    SELECT proximo, reservados FROM numeracao_palete WHERE escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!linha) throw new Error('Numeração de paletes indisponível.');
  const numero = await primeiroLivre(tx, escopoId, linha.proximo, lerFaixas(linha.reservados));
  await tx.$executeRaw`UPDATE numeracao_palete SET proximo = ${numero + 1}, atualizado_em = ${agora} WHERE escopo_id = ${escopoId}::uuid`;
  return String(numero);
}

/** Define o ponto de partida (último número usado) e as faixas reservadas, informados pela operação. */
export async function definirNumeracao(
  tx: Transacao,
  escopoId: string,
  dados: { ultimo: number; reservados: readonly FaixaReservada[]; origem: string },
  autorId: string,
  agora: Date,
): Promise<void> {
  const reservados = JSON.stringify(dados.reservados.map((f) => [f.de, f.ate]));
  await tx.$executeRaw`
    INSERT INTO numeracao_palete (escopo_id, proximo, reservados, origem, atualizado_em, atualizado_por_id)
    VALUES (${escopoId}::uuid, ${dados.ultimo + 1}, ${reservados}::jsonb, ${dados.origem}, ${agora}, ${autorId}::uuid)
    ON CONFLICT (escopo_id) DO UPDATE SET proximo = EXCLUDED.proximo, reservados = EXCLUDED.reservados, origem = EXCLUDED.origem,
      atualizado_em = EXCLUDED.atualizado_em, atualizado_por_id = EXCLUDED.atualizado_por_id`;
}
