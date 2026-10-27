/**
 * Arquivos da planilha: gravação local (temporário + fsync + troca atômica +
 * releitura pelo SHA-256), nomes das versões e retenção — a mesma regra na
 * pasta local do servidor e no destino independente:
 *
 * - últimas N versões válidas sempre;
 * - a última de cada dia (horário de Brasília) durante D dias;
 * - as anteriores a uma substituição do inventário durante P dias;
 * - nunca a mais nova nem as protegidas (atual publicada); nunca todas.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConfigPlanilha, Retencao } from '../protecao/configuracao.js';

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const SUFIXO_PRE_SUBSTITUICAO = '-antes-da-substituicao';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export const pastaDoEscopo = (config: ConfigPlanilha, escopoId: string) => join(config.pastaLocal, escopoId);
export const pastaVersoes = (config: ConfigPlanilha, escopoId: string) => join(pastaDoEscopo(config, escopoId), 'versoes');

/** Grava por temporário na mesma pasta e troca atômica; relê e confere. */
export function gravarLocal(caminho: string, conteudo: Buffer): { sha256: string; tamanho: number } {
  mkdirSync(dirname(caminho), { recursive: true });
  const temporario = join(dirname(caminho), `.${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fd = openSync(temporario, 'wx', 0o600);
    try {
      let escrito = 0;
      while (escrito < conteudo.length) escrito += writeSync(fd, conteudo, escrito, conteudo.length - escrito);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporario, caminho);
  } finally {
    rmSync(temporario, { force: true });
  }
  const hash = sha(conteudo);
  if (sha(readFileSync(caminho)) !== hash) throw new Error('Arquivo gravado na pasta local não confere com o gerado (SHA-256).');
  return { sha256: hash, tamanho: conteudo.length };
}

/** Lê um arquivo local e confere o SHA-256 registrado (`null` se não existe). */
export function lerConferido(caminho: string, esperado: string): Buffer | null {
  if (!existsSync(caminho)) return null;
  const b = readFileSync(caminho);
  if (sha(b) !== esperado) throw new Error(`O arquivo ${caminho.split(/[\\/]/).pop() ?? ''} da pasta local não confere com o registrado (SHA-256): não é usado.`);
  return b;
}

export interface NomeVersao {
  revisao: number;
  instante: Date;
  pre: boolean;
}

const PADRAO = /-r(\d{6,})-(\d{8})T(\d{6})Z([-A-Za-z0-9]*)\.(?:xlsx|manifesto\.json)$/;

/** Revisão, instante e marca de pré-substituição a partir do nome de uma versão da base indicada. */
export function lerNomeVersao(nome: string, base: string): NomeVersao | null {
  if (!nome.startsWith(`${base}-r`)) return null;
  const m = PADRAO.exec(nome.slice(base.length));
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const d = m[2];
  const h = m[3];
  const instante = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}Z`);
  if (Number.isNaN(instante.getTime())) return null;
  return { revisao: Number(m[1]), instante, pre: (m[4] ?? '').includes(SUFIXO_PRE_SUBSTITUICAO) };
}

const diaBrasilia = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

/** Revisões a manter pela retenção (a mais nova e as protegidas sempre). */
export function revisoesAManter(versoes: readonly NomeVersao[], r: Retencao, agora: Date, protegidas: ReadonlySet<number>): Set<number> {
  const porRevisao = new Map<number, NomeVersao>();
  for (const v of versoes) {
    const atual = porRevisao.get(v.revisao);
    porRevisao.set(v.revisao, atual === undefined ? v : { ...atual, pre: atual.pre || v.pre });
  }
  const ordenadas = [...porRevisao.values()].sort((a, b) => b.revisao - a.revisao);
  const manter = new Set(protegidas);
  for (const v of ordenadas.slice(0, Math.max(1, r.ultimas))) manter.add(v.revisao);
  const dias = new Set<string>();
  for (const v of ordenadas) {
    const idade = agora.getTime() - v.instante.getTime();
    if (idade <= r.diariasDias * 86_400_000) {
      const dia = diaBrasilia(v.instante);
      if (!dias.has(dia)) {
        dias.add(dia);
        manter.add(v.revisao);
      }
    }
    if (v.pre && idade <= r.preSubstituicaoDias * 86_400_000) manter.add(v.revisao);
  }
  return manter;
}

/** Aplica a retenção numa pasta local de versões; devolve os nomes apagados. */
export function aplicarRetencaoLocal(pasta: string, base: string, r: Retencao, agora: Date, protegidas: ReadonlySet<number>): string[] {
  if (!existsSync(pasta)) return [];
  const nomes = readdirSync(pasta).filter((n) => !n.startsWith('.'));
  const lidos = nomes.flatMap((n) => {
    const v = lerNomeVersao(n, base);
    return v ? [{ n, v }] : [];
  });
  const manter = revisoesAManter(
    lidos.map((x) => x.v),
    r,
    agora,
    protegidas,
  );
  const apagar = lidos.filter((x) => !manter.has(x.v.revisao)).map((x) => x.n);
  for (const n of apagar) rmSync(join(pasta, n), { force: true });
  return apagar;
}
