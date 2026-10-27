/**
 * Planilha automática e proteção dos dados por comando (26 out. 2026), com a
 * mesma configuração do servidor (.env). Nenhum segredo é impresso.
 *
 *   npm run protecao:processar             uma volta do trabalhador (planilha de todos os escopos + backup devido);
 *                                          para agendador externo (Agendador de Tarefas, cron) quando o servidor
 *                                          não fica ligado o tempo todo
 *   npm run protecao:backup                backup completo agora (e envio ao destino independente)
 *   npm run protecao:teste-restauracao     restaura o backup real mais recente num banco ISOLADO, compara e registra
 *                                          [--origem=externo|local] [--manter-banco]
 *   npm run protecao:verificar-destino     grava, relê e apaga um arquivo de teste no destino independente
 *   npm run protecao:situacao              situação da planilha e da proteção por escopo
 */
import { parseArgs } from 'node:util';
import { carregarEnvLocal, lerConfigProtecao } from '../config.js';
import { criarBanco } from '../db/cliente.js';
import { lerSituacao } from '../modules/planilha/rotas.js';
import { processarBackups } from '../modules/protecao/backup.js';
import { verificarDestino } from '../modules/protecao/destino.js';
import { testarRestauracao } from '../modules/protecao/restauracao.js';
import { voltaCompleta } from '../modules/protecao/trabalhador.js';

carregarEnvLocal();
const { positionals, values } = parseArgs({ allowPositionals: true, options: { origem: { type: 'string' }, 'manter-banco': { type: 'boolean', default: false } } });
const comando = positionals[0] ?? '';
const config = lerConfigProtecao(process.env);
const url = process.env[config.backup.variavelBanco];
if (!url) throw new Error(`${config.backup.variavelBanco} não está definida.`);
const db = criarBanco(url, (erro) => {
  console.error(erro.message);
});
const log = {
  info: (d: object, m: string) => {
    console.log(m, JSON.stringify(d));
  },
  warn: (d: object, m: string) => {
    console.warn(m, JSON.stringify(d));
  },
  error: (d: object, m: string) => {
    console.error(m, JSON.stringify(d));
  },
};

async function principal(): Promise<number> {
  switch (comando) {
    case 'processar': {
      const r = await voltaCompleta(db, config, log);
      console.log(`Volta concluída: ${String(r.escopos)} escopo(s) com trabalho devido; backup ${r.backup.situacao}${r.backup.backupId ? ` (novo ${r.backup.backupId})` : ''}${r.backup.enviados.length ? `, enviados ${r.backup.enviados.join(', ')}` : ''}${r.backup.erro ? `: ${r.backup.erro}` : ''}.`);
      return r.backup.situacao === 'FALHOU' ? 1 : 0;
    }
    case 'backup': {
      const r = await processarBackups(db, config, { forcar: true, motivo: 'MANUAL' });
      console.log(`Backup: ${r.situacao}${r.backupId ? ` · ${r.backupId}` : ''}${r.enviados.length ? ` · enviado(s) ao destino: ${r.enviados.join(', ')}` : config.backup.destino?.independente ? '' : ' · destino independente não configurado (fica só no servidor)'}${r.erro ? ` · ${r.erro}` : ''}`);
      return r.situacao === 'OK' ? 0 : 1;
    }
    case 'teste-restauracao': {
      const origem = values.origem === 'externo' ? 'EXTERNO' : values.origem === 'local' ? 'LOCAL' : undefined;
      const r = await testarRestauracao(db, config, { ...(origem ? { origem } : {}), manterBanco: values['manter-banco'] });
      console.log(`Teste de restauração ${r.aprovado ? 'APROVADO' : 'REPROVADO'} (registrado): ${r.mensagem}`);
      if (r.contagens) console.log(`Alcance no banco isolado ${r.ambiente ?? ''}: ${JSON.stringify(r.contagens)}`);
      return r.aprovado ? 0 : 2;
    }
    case 'verificar-destino': {
      let falhou = false;
      for (const [nome, d] of [
        ['Planilha', config.destino],
        ['Backup', config.backup.destino],
      ] as const) {
        if (d === null) {
          console.log(`${nome}: destino não configurado.`);
          continue;
        }
        try {
          await verificarDestino(d, new Date());
          console.log(`${nome}: ${d.descricao} · gravação confirmada (escrita, releitura com SHA-256 e remoção)${d.independente ? '' : ` · NÃO conta como independente: ${d.motivo ?? ''}`}.`);
        } catch (erro) {
          falhou = true;
          console.log(`${nome}: ${d.descricao} · FALHOU: ${erro instanceof Error ? erro.message : String(erro)}`);
        }
      }
      return falhou ? 1 : 0;
    }
    case 'situacao': {
      const escopos = await db.escopo.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } });
      for (const e of escopos) {
        const s = await lerSituacao(db, e.id, config, new Set(), new Date());
        console.log(`\n${e.nome}${s.demo ? ' (demonstração)' : ''}: revisão gerada ${String(s.revisions.generated ?? '—')}, publicada ${String(s.revisions.published ?? '—')}, ${String(s.pending.count)} alteração(ões) aguardando.`);
        for (const i of s.items) console.log(`  - ${i.resource}: ${i.state} — ${i.detail}`);
      }
      return 0;
    }
    default:
      console.error('Use: processar | backup | teste-restauracao [--origem=externo|local] [--manter-banco] | verificar-destino | situacao');
      return 1;
  }
}

try {
  process.exitCode = await principal();
} finally {
  await db.$disconnect();
}
