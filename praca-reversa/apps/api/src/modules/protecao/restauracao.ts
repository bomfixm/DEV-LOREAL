/**
 * Teste de restauração do backup REAL mais recente em banco isolado (26 out.
 * 2026). Nunca toca o banco em uso:
 *
 * 1. escolhe o backup: o último confirmado no destino independente (baixado e
 *    conferido arquivo a arquivo contra o `concluido.json`) ou, sem destino, o
 *    último verificado na pasta local do servidor;
 * 2. restaura num banco NOVO (nome com "restauracao") pelo script existente,
 *    que confere manifesto, migrações, cada tabela, anexos e relações e
 *    remove o banco se reprovar;
 * 3. conta, no banco restaurado, o inventário ativo, as pendências e as
 *    relações que a planilha usa (evidência do alcance do teste);
 * 4. remove o banco de teste e registra TESTE_RESTAURACAO (dados da operação)
 *    com data, backup, origem, ambiente e resultado verdadeiro.
 */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { criarBanco, type Banco } from '../../db/cliente.js';
import { mensagemDe } from '../planilha/geracao.js';
import { backupsLocais, bancoDaConfig, baixarBackup } from './backup.js';
import type { ConfigPlanilha } from './configuracao.js';

export interface ResultadoTeste {
  aprovado: boolean;
  backupId: string | null;
  origem: 'EXTERNO' | 'LOCAL' | null;
  ambiente: string | null;
  mensagem: string;
  contagens: Record<string, number> | null;
}

function rodar(script: string, args: string[], raiz: string): Promise<{ codigo: number | null; saida: string }> {
  return new Promise((resolver) => {
    const filho = spawn(process.execPath, [script, ...args], { cwd: raiz, env: process.env, windowsHide: true });
    let saida = '';
    filho.stdout.on('data', (d: Buffer) => (saida += d.toString('utf8')));
    filho.stderr.on('data', (d: Buffer) => (saida += d.toString('utf8')));
    filho.on('error', (e) => {
      resolver({ codigo: -1, saida: e.message });
    });
    filho.on('close', (codigo) => {
      resolver({ codigo, saida });
    });
  });
}

const CONTAGENS = `
  SELECT
    (SELECT count(*) FROM escopo)::int AS escopos,
    (SELECT count(*) FROM palete WHERE arquivado_em IS NULL AND estado_fluxo::text IN ('EM_ESTOQUE', 'RESERVADO'))::int AS paletes_na_praca,
    (SELECT count(*) FROM vinculo_documento_palete WHERE situacao = 'ATIVO')::int AS vinculos_ativos,
    (SELECT count(*) FROM vinculo_documento_palete WHERE situacao = 'VALIDACAO')::int AS vinculos_em_validacao,
    (SELECT count(*) FROM conteudo_palete WHERE situacao = 'ATIVO')::int AS conteudos_ativos,
    (SELECT count(*) FROM linha_inventario li JOIN inventario_referencia i ON i.id = li.inventario_id WHERE i.situacao = 'ATIVO' AND li.acao::text = 'REQUER_RESOLUCAO' AND li.resolvida_por_id IS NULL)::int AS linhas_em_revisao,
    (SELECT count(*) FROM contagem_volumes)::int AS contagens,
    (SELECT count(*) FROM historico_conteudo)::int AS historico_conteudo,
    (SELECT count(*) FROM evento_auditoria)::int AS eventos_auditoria,
    (SELECT count(*) FROM usuario)::int AS usuarios`;

/** Registra o resultado (e marca a planilha de todos os escopos para mostrar o teste). */
async function registrar(db: Banco, r: ResultadoTeste, iniciadoEm: Date, detalhes: Record<string, unknown>, responsavel: string | null): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.registroProtecao.create({
      data: {
        id: randomUUID(),
        tipo: 'TESTE_RESTAURACAO',
        situacao: r.aprovado ? 'VERIFICADO' : 'FALHOU',
        iniciadoEm,
        concluidoEm: new Date(),
        identificador: r.backupId,
        ambiente: r.ambiente,
        dados: 'OPERACAO',
        responsavel,
        mensagem: r.aprovado ? null : r.mensagem.slice(0, 500),
        detalhes: { ...detalhes, origem: r.origem, contagens: r.contagens },
      },
    });
    await tx.$executeRaw`INSERT INTO alteracao_planilha (escopo_id, origem) SELECT id, 'teste_restauracao' FROM escopo WHERE ativo`;
  });
}

export async function testarRestauracao(db: Banco, config: ConfigPlanilha, opcoes: { origem?: 'EXTERNO' | 'LOCAL'; manterBanco?: boolean }): Promise<ResultadoTeste> {
  const b = config.backup;
  const iniciadoEm = new Date();
  const temporaria = mkdtempSync(join(tmpdir(), 'praca-teste-restauracao-'));
  const ambiente = `praca_reversa_restauracao_teste_${iniciadoEm.toISOString().slice(0, 10).replace(/-/g, '')}_${randomBytes(3).toString('hex')}`;
  const resultado: ResultadoTeste = { aprovado: false, backupId: null, origem: null, ambiente, mensagem: '', contagens: null };
  const detalhes: Record<string, unknown> = {};
  let pasta: string;
  try {
    // 1. Backup a testar.
    const externo = b.destino?.independente === true && opcoes.origem !== 'LOCAL' ? await db.envioExterno.findFirst({ where: { tipo: 'BACKUP', situacao: 'CONFIRMADO' }, orderBy: { concluidoEm: 'desc' } }) : null;
    if (opcoes.origem === 'EXTERNO' && externo === null) throw new Error('Nenhum backup confirmado no destino independente para testar.');
    if (externo !== null && b.destino !== null) {
      const nome = typeof externo.detalhes === 'object' && externo.detalhes !== null && 'pasta' in externo.detalhes ? String((externo.detalhes as { pasta: unknown }).pasta) : '';
      pasta = join(temporaria, nome);
      const lido = await baixarBackup(b.destino, nome, pasta, (caminho, conteudo) => {
        mkdirSync(dirname(caminho), { recursive: true });
        writeFileSync(caminho, conteudo);
      });
      resultado.backupId = lido.id;
      resultado.origem = 'EXTERNO';
      detalhes.instanteBackup = lido.instante;
      detalhes.destino = b.destino.descricao;
    } else {
      const local = backupsLocais(b.pastaLocal, bancoDaConfig(config))[0];
      if (!local) throw new Error('Nenhum backup verificado na pasta local do servidor para testar.');
      pasta = local.pasta;
      resultado.backupId = local.id;
      resultado.origem = 'LOCAL';
      detalhes.instanteBackup = local.instante.toISOString();
    }
    // 2. Restauração com comparação completa (o script remove o banco se reprovar).
    const relatorio = join(temporaria, 'relatorio.json');
    const r = await rodar(join(b.raiz, 'scripts', 'recuperacao', 'restaurar-backup.mjs'), [`--backup=${pasta}`, `--destino=${ambiente}`, `--servidor=${b.variavelBanco}`, `--relatorio=${relatorio}`], b.raiz);
    let rel: { resultado?: string; tabelas?: number; linhas?: number; chavesEstrangeirasVerificadas?: number; duracaoMs?: number; falhas?: string[] } = {};
    try {
      rel = JSON.parse(readFileSync(relatorio, 'utf8')) as typeof rel;
    } catch {
      rel = { resultado: 'FALHOU', falhas: [r.saida.trim().split('\n').slice(-1)[0] ?? 'sem relatório'] };
    }
    Object.assign(detalhes, { tabelas: rel.tabelas ?? null, linhas: rel.linhas ?? null, relacoes: rel.chavesEstrangeirasVerificadas ?? null, duracaoMs: rel.duracaoMs ?? null });
    if (r.codigo !== 0 || rel.resultado !== 'APROVADA') throw new Error(`Restauração reprovada: ${(rel.falhas ?? []).slice(0, 3).join('; ') || 'sem detalhe'}`);
    // 3. Alcance: inventário, pendências e relações no banco restaurado.
    const url = new URL(process.env[b.variavelBanco] ?? '');
    url.pathname = `/${ambiente}`;
    const restaurado = criarBanco(url.href, () => undefined);
    try {
      const [linha] = await restaurado.$queryRawUnsafe<Record<string, number>[]>(CONTAGENS);
      resultado.contagens = linha ?? null;
    } finally {
      await restaurado.$disconnect();
    }
    resultado.aprovado = true;
    resultado.mensagem = `Backup ${resultado.backupId} (${resultado.origem === 'EXTERNO' ? 'cópia do destino independente' : 'cópia local'}) restaurado e comparado: ${String(rel.tabelas ?? '?')} tabelas, ${String(rel.linhas ?? '?')} linhas, ${String(rel.chavesEstrangeirasVerificadas ?? '?')} relações sem órfãos.`;
  } catch (erro) {
    resultado.mensagem = mensagemDe(erro);
  } finally {
    // 4. Banco de teste removido (salvo pedido explícito para análise).
    if (!opcoes.manterBanco) {
      try {
        // Nome gerado aqui (letras, números e _): seguro para a instrução.
        await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${ambiente}" WITH (FORCE)`);
      } catch {
        // Banco de teste não removido: o nome contém "restauracao_teste" e fica visível para limpeza manual.
      }
    }
    rmSync(temporaria, { recursive: true, force: true });
  }
  await registrar(db, resultado, iniciadoEm, detalhes, b.responsavel);
  return resultado;
}
