/**
 * Backup completo automático (26 out. 2026), separado da planilha:
 *
 * - cria o backup pela rotina existente (scripts/recuperacao/rotina-backup.mjs:
 *   snapshot REPEATABLE READ coerente, manifesto com SHA-256 por arquivo,
 *   conferência e registro VERIFICADO/FALHOU em `registro_protecao`), num
 *   processo filho (o da API não para);
 * - diário (BACKUP_INTERVALO_HORAS) e antes de cada substituição do inventário;
 * - envia ao destino independente: cada arquivo relido e conferido; por
 *   último `concluido.json` (sem ele a pasta remota não vale como backup);
 * - retenção no destino: últimos N, um por dia por D dias, os anteriores a
 *   substituições por P dias; nunca o mais novo completo.
 * Uma rotina por vez (`controle_protecao`, chave BACKUP, com expiração).
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Banco } from '../../db/cliente.js';
import { revisoesAManter } from '../planilha/arquivos.js';
import { esperaDaFalha, mensagemDe } from '../planilha/geracao.js';
import type { ConfigPlanilha } from './configuracao.js';
import { sha256, type Destino } from './destino.js';

export type MotivoBackup = 'DIARIO' | 'PRE_SUBSTITUICAO' | 'MANUAL';

export interface ResultadoBackup {
  situacao: 'OK' | 'FALHOU' | 'OCUPADO';
  /** Backup criado nesta execução (nulo se só enviou ou não era devido). */
  backupId: string | null;
  enviados: string[];
  erro: string | null;
}

const CONCESSAO_MS = 60 * 60_000;
const PASTA_BACKUP = /^praca-reversa-backup-.+-(\d{8})-(\d{6})Z-[0-9a-f]{8}$/;

async function reivindicar(db: Banco, agora: Date): Promise<string | null> {
  const token = randomUUID();
  await db.$executeRaw`INSERT INTO controle_protecao (chave) VALUES ('BACKUP') ON CONFLICT DO NOTHING`;
  const n = await db.$executeRaw`
    UPDATE controle_protecao SET executando_desde = ${agora}, executando_por = ${token}
     WHERE chave = 'BACKUP' AND (executando_desde IS NULL OR executando_desde < ${new Date(agora.getTime() - CONCESSAO_MS)})`;
  return n === 1 ? token : null;
}

async function liberar(db: Banco, token: string): Promise<void> {
  await db.$executeRaw`UPDATE controle_protecao SET executando_desde = NULL, executando_por = NULL WHERE chave = 'BACKUP' AND executando_por = ${token}`;
}

async function registrarFalha(db: Banco, token: string, mensagem: string, agora: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    const [c] = await tx.$queryRaw<{ falhas: number }[]>`SELECT falhas FROM controle_protecao WHERE chave = 'BACKUP' FOR UPDATE`;
    const falhas = (c?.falhas ?? 0) + 1;
    await tx.$executeRaw`
      UPDATE controle_protecao SET falhas = ${falhas}, proxima_em = ${new Date(agora.getTime() + esperaDaFalha(falhas))}, ultima_falha = ${mensagem}, ultima_falha_em = ${agora}
       WHERE chave = 'BACKUP' AND executando_por = ${token}`;
  });
}

/** Cria o backup local verificado (processo filho); devolve o ID e a pasta. */
export function executarBackupLocal(config: ConfigPlanilha, motivo: MotivoBackup): Promise<{ id: string; pasta: string }> {
  const b = config.backup;
  const script = join(b.raiz, 'scripts', 'recuperacao', 'rotina-backup.mjs');
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, [script, `--origem=${b.variavelBanco}`, `--destino=${b.pastaLocal}`, '--sem-retencao', `--motivo=${motivo}`], {
      cwd: b.raiz,
      env: process.env,
      windowsHide: true,
    });
    let saida = '';
    let erros = '';
    filho.stdout.on('data', (d: Buffer) => (saida += d.toString('utf8')));
    filho.stderr.on('data', (d: Buffer) => (erros += d.toString('utf8')));
    filho.on('error', (e) => {
      rejeitar(new Error(`Rotina de backup não iniciou: ${e.message}`));
    });
    filho.on('close', (codigo) => {
      const id = /^BACKUP_ID=(\S+)$/m.exec(saida)?.[1];
      const pasta = /^BACKUP_PASTA=(.+)$/m.exec(saida)?.[1]?.trim();
      if (codigo === 0 && id && pasta) resolver({ id, pasta });
      else rejeitar(new Error(`Backup falhou (código ${String(codigo)}): ${(erros || saida).trim().split('\n').slice(-1)[0] ?? 'sem mensagem'}`.slice(0, 500)));
    });
  });
}

interface BackupLocal {
  id: string;
  nome: string;
  pasta: string;
  instante: Date;
}

/** Nome do banco copiado (o backup leva o nome no nome da pasta). */
export function bancoDaConfig(config: ConfigPlanilha): string | null {
  try {
    return decodeURIComponent(new URL(process.env[config.backup.variavelBanco] ?? '').pathname.slice(1)) || null;
  } catch {
    return null;
  }
}

/** Backups completos deste banco na pasta local (manifesto presente), mais novos primeiro. */
export function backupsLocais(pasta: string, banco: string | null): BackupLocal[] {
  if (!existsSync(pasta) || banco === null) return [];
  return readdirSync(pasta)
    .flatMap((nome) => {
      const m = nome.startsWith(`praca-reversa-backup-${banco}-`) ? PASTA_BACKUP.exec(nome) : null;
      const manifesto = join(pasta, nome, 'manifesto.json');
      if (!m?.[1] || !m[2] || !existsSync(manifesto)) return [];
      try {
        const id = (JSON.parse(readFileSync(manifesto, 'utf8')) as { id?: unknown }).id;
        const d = m[1];
        const h = m[2];
        return typeof id === 'string'
          ? [{ id, nome, pasta: join(pasta, nome), instante: new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}Z`) }]
          : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.instante.getTime() - a.instante.getTime());
}

function arquivosDa(pasta: string): string[] {
  return readdirSync(pasta, { recursive: true })
    .map(String)
    .filter((n) => statSync(join(pasta, n)).isFile())
    .sort();
}

/** Envia a pasta do backup e, por último, `concluido.json`. */
async function enviarBackup(db: Banco, destino: Destino, b: BackupLocal, motivo: string | null, agora: () => Date): Promise<void> {
  const id = randomUUID();
  await db.envioExterno.create({ data: { id, tipo: 'BACKUP', referencia: b.id, situacao: 'ENVIANDO', destinoTipo: destino.tipo, destino: destino.descricao, iniciadoEm: agora() } });
  try {
    const arquivos: { chave: string; sha256: string; tamanho: number }[] = [];
    for (const rel of arquivosDa(b.pasta)) {
      const chave = `backups/${b.nome}/${relative(b.pasta, join(b.pasta, rel)).split(sep).join('/')}`;
      const g = await destino.gravar(chave, readFileSync(join(b.pasta, rel)), 'application/octet-stream');
      arquivos.push({ chave, ...g });
    }
    const manifesto = arquivos.find((a) => a.chave.endsWith('/manifesto.json'));
    if (!manifesto) throw new Error(`Backup ${b.id} sem manifesto.json na pasta local.`);
    const concluido = { formato: 'praca-reversa-backup-envio', versaoFormato: 1, id: b.id, pasta: b.nome, motivo, instante: b.instante.toISOString(), enviadoEm: agora().toISOString(), arquivos };
    await destino.gravar(`backups/${b.nome}/concluido.json`, Buffer.from(`${JSON.stringify(concluido, null, 2)}\n`, 'utf8'), 'application/json');
    await db.$transaction(async (tx) => {
      await tx.envioExterno.update({
        where: { id },
        data: { situacao: 'CONFIRMADO', concluidoEm: agora(), chave: manifesto.chave, hash: manifesto.sha256, tamanhoBytes: BigInt(arquivos.reduce((t, a) => t + a.tamanho, 0)), arquivos: arquivos.length + 1, detalhes: { pasta: b.nome, motivo } },
      });
      // A aba Proteção e ajuda passa a mostrar o backup externo na próxima revisão.
      await tx.$executeRaw`INSERT INTO alteracao_planilha (escopo_id, origem) SELECT id, 'envio_backup' FROM escopo WHERE ativo`;
    });
  } catch (erro) {
    await db.envioExterno.update({ where: { id }, data: { situacao: 'FALHOU', concluidoEm: agora(), erro: mensagemDe(erro) } });
    throw erro;
  }
}

/** Retenção dos backups no destino; pastas incompletas antigas (envio interrompido) também saem. */
export async function retencaoBackupsRemotos(destino: Destino, config: ConfigPlanilha, agora: Date): Promise<string[]> {
  const objetos = await destino.listar('backups/');
  const pastas = new Map<string, string[]>();
  for (const o of objetos) {
    const nome = o.chave.split('/')[1] ?? '';
    pastas.set(nome, [...(pastas.get(nome) ?? []), o.chave]);
  }
  const versoes: { nome: string; revisao: number; instante: Date; pre: boolean; completo: boolean }[] = [];
  for (const [nome, chaves] of pastas) {
    const m = PASTA_BACKUP.exec(nome);
    if (!m?.[1] || !m[2]) continue;
    const instante = new Date(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}Z`);
    const completo = chaves.includes(`backups/${nome}/concluido.json`);
    let pre = false;
    if (completo) {
      const c = await destino.ler(`backups/${nome}/concluido.json`);
      pre = c !== null && /"motivo":\s*"PRE_SUBSTITUICAO"/.test(c.toString('utf8'));
    }
    versoes.push({ nome, revisao: Math.floor(instante.getTime() / 1_000), instante, pre, completo });
  }
  const completos = versoes.filter((v) => v.completo);
  const manter = revisoesAManter(completos, config.backup.retencao, agora, new Set());
  const apagar = versoes.filter((v) => (v.completo ? !manter.has(v.revisao) : agora.getTime() - v.instante.getTime() > 2 * 86_400_000)).map((v) => v.nome);
  for (const nome of apagar) for (const chave of pastas.get(nome) ?? []) await destino.apagar(chave);
  return apagar;
}

/**
 * Retenção na pasta local: só os backups criados por esta rotina (motivo
 * registrado: DIARIO, PRE_SUBSTITUICAO ou MANUAL). Cópias manuais antigas,
 * sem registro, nunca são apagadas automaticamente; o mais novo e os ainda não
 * confirmados no destino independente também ficam.
 */
export async function retencaoBackupsLocais(db: Banco, config: ConfigPlanilha, agora: Date): Promise<string[]> {
  const b = config.backup;
  const locais = backupsLocais(b.pastaLocal, bancoDaConfig(config));
  const registros = await db.registroProtecao.findMany({ where: { tipo: 'BACKUP', situacao: 'VERIFICADO', identificador: { in: locais.map((l) => l.id) } }, select: { identificador: true, detalhes: true } });
  const motivo = new Map(
    registros.flatMap((r) => {
      const m = typeof r.detalhes === 'object' && r.detalhes !== null && 'motivo' in r.detalhes ? (r.detalhes as { motivo?: unknown }).motivo : null;
      return typeof m === 'string' && r.identificador !== null ? [[r.identificador, m] as const] : [];
    }),
  );
  const geridos = locais.filter((l) => motivo.has(l.id));
  const confirmados = new Set(
    b.destino?.independente === true
      ? (await db.envioExterno.findMany({ where: { tipo: 'BACKUP', situacao: 'CONFIRMADO', referencia: { in: geridos.map((l) => l.id) } }, select: { referencia: true } })).map((e) => e.referencia)
      : geridos.map((l) => l.id),
  );
  const versoes = geridos.map((l) => ({ l, revisao: Math.floor(l.instante.getTime() / 1_000), instante: l.instante, pre: motivo.get(l.id) === 'PRE_SUBSTITUICAO' }));
  const protegidos = new Set(versoes.filter((v) => !confirmados.has(v.l.id)).map((v) => v.revisao));
  const maisNovo = versoes[0];
  if (maisNovo) protegidos.add(maisNovo.revisao);
  const manter = revisoesAManter(versoes, { ...b.retencao, ultimas: b.manterLocal }, agora, protegidos);
  const apagar = versoes.filter((v) => !manter.has(v.revisao));
  for (const v of apagar) rmSync(v.l.pasta, { recursive: true, force: true });
  return apagar.map((v) => v.l.nome);
}

/** Faz o backup devido (ou pedido) e envia ao destino o que falta. */
export async function processarBackups(db: Banco, config: ConfigPlanilha, opcoes: { agora?: () => Date; forcar?: boolean; motivo?: MotivoBackup; ignorarEspera?: boolean }): Promise<ResultadoBackup> {
  const agora = opcoes.agora ?? (() => new Date());
  const token = await reivindicar(db, agora());
  if (token === null) return { situacao: 'OCUPADO', backupId: null, enviados: [], erro: null };
  try {
    const b = config.backup;
    const controle = await db.controleProtecao.findUniqueOrThrow({ where: { chave: 'BACKUP' } });
    const ultimo = await db.registroProtecao.findFirst({ where: { tipo: 'BACKUP', situacao: 'VERIFICADO' }, orderBy: { concluidoEm: 'desc' }, select: { concluidoEm: true } });
    const devido = opcoes.forcar === true || (b.automatico && (ultimo === null || agora().getTime() - ultimo.concluidoEm.getTime() >= b.intervaloHoras * 3_600_000));
    const esperando = opcoes.forcar !== true && opcoes.ignorarEspera !== true && controle.proximaEm !== null && controle.proximaEm > agora();
    let backupId: string | null = null;
    const enviados: string[] = [];
    try {
      if (devido && !esperando) backupId = (await executarBackupLocal(config, opcoes.motivo ?? 'DIARIO')).id;
      const destino = b.destino;
      if (destino !== null && destino.independente && !esperando) {
        const locais = backupsLocais(b.pastaLocal, bancoDaConfig(config));
        const confirmados = new Set(
          (await db.envioExterno.findMany({ where: { tipo: 'BACKUP', situacao: 'CONFIRMADO', referencia: { in: locais.map((l) => l.id) } }, select: { referencia: true } })).map((e) => e.referencia),
        );
        const motivos = new Map(
          (await db.registroProtecao.findMany({ where: { tipo: 'BACKUP', identificador: { in: locais.map((l) => l.id) } }, select: { identificador: true, detalhes: true } })).map((r) => [
            r.identificador ?? '',
            typeof r.detalhes === 'object' && r.detalhes !== null && 'motivo' in r.detalhes && typeof (r.detalhes as { motivo?: unknown }).motivo === 'string' ? (r.detalhes as { motivo: string }).motivo : null,
          ]),
        );
        const limitePre = agora().getTime() - b.retencao.preSubstituicaoDias * 86_400_000;
        // O mais novo e os anteriores a substituições ainda na retenção; os demais já foram superados.
        const aEnviar = locais.filter((l, i) => !confirmados.has(l.id) && (i === 0 || (motivos.get(l.id) === 'PRE_SUBSTITUICAO' && l.instante.getTime() >= limitePre)));
        for (const l of aEnviar.reverse()) {
          await enviarBackup(db, destino, l, motivos.get(l.id) ?? null, agora);
          enviados.push(l.id);
        }
        await retencaoBackupsRemotos(destino, config, agora()).catch(() => undefined);
      }
    } catch (erro) {
      const mensagem = mensagemDe(erro);
      await registrarFalha(db, token, mensagem, agora());
      return { situacao: 'FALHOU', backupId, enviados, erro: mensagem };
    }
    if (backupId !== null) await retencaoBackupsLocais(db, config, agora()).catch(() => undefined);
    if (backupId !== null || enviados.length > 0) await db.$executeRaw`UPDATE controle_protecao SET falhas = 0, proxima_em = NULL, ultima_falha = NULL, ultima_falha_em = NULL WHERE chave = 'BACKUP' AND executando_por = ${token}`;
    return { situacao: 'OK', backupId, enviados, erro: null };
  } finally {
    await liberar(db, token);
  }
}

/** Confere uma pasta de backup baixada do destino contra o `concluido.json` (antes de restaurar). */
export async function baixarBackup(destino: Destino, nome: string, para: string, gravar: (caminho: string, b: Buffer) => void): Promise<{ id: string; instante: string; motivo: string | null }> {
  const c = await destino.ler(`backups/${nome}/concluido.json`);
  if (c === null) throw new Error(`Backup ${nome} incompleto no destino (sem concluido.json).`);
  const concluido = JSON.parse(c.toString('utf8')) as { id: string; instante: string; motivo: string | null; arquivos: { chave: string; sha256: string; tamanho: number }[] };
  for (const a of concluido.arquivos) {
    const b = await destino.ler(a.chave);
    if (b?.length !== a.tamanho || sha256(b) !== a.sha256) throw new Error(`Arquivo ${a.chave} do backup no destino ausente ou diferente do enviado.`);
    gravar(join(para, ...a.chave.slice(`backups/${nome}/`.length).split('/')), b);
  }
  return { id: concluido.id, instante: concluido.instante, motivo: concluido.motivo };
}
