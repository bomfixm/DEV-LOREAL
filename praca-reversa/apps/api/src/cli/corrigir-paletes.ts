/**
 * Correção dos paletes já cadastrados (21 out. 2026): número operacional da
 * fonte ativa e reconciliação das notas antigas (ver
 * modules/paletes/correcao-identidade.ts). Comando local, com acesso direto ao
 * banco; não lê planilha nenhuma.
 *
 * Uso:
 *   npm run paletes:corrigir -- --unidade <código> --cliente <código> --usuario <login>
 *     [--relatorio <arquivo.md>] [--executar]
 *
 * Sem --executar: só simula e grava o relatório. Com --executar: aplica numa
 * transação (faça antes `npm run backup:criar`). O usuário precisa poder
 * corrigir conteúdos (conteudo.corrigir).
 */
import { perfilPossui, type Escopo } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { carregarEnvLocal } from '../config.js';
import { criarBanco, type Banco } from '../db/cliente.js';
import { aplicarCorrecao, planejarCorrecao, type PlanoCorrecao } from '../modules/paletes/correcao-identidade.js';

async function resolverEscopo(db: Banco, unidade: string | undefined, cliente: string | undefined): Promise<Escopo> {
  if (!unidade || !cliente) throw new Error('Informe --unidade e --cliente.');
  const e = await db.escopo.findFirst({ where: { ativo: true, unidade: { codigo: unidade }, cliente: { codigo: cliente } }, include: { unidade: true, cliente: true } });
  if (!e) throw new Error(`Escopo ${unidade}/${cliente} não encontrado ou inativo.`);
  return { id: e.id, name: e.nome, unitCode: e.unidade.codigo, unitName: e.unidade.nome, clientCode: e.cliente.codigo, clientName: e.cliente.nome, demo: e.demonstracao };
}

async function resolverAutor(db: Banco, escopo: Escopo, login: string | undefined): Promise<{ usuarioId: string; login: string }> {
  if (!login) throw new Error('Informe --usuario <login> (quem aplica a correção fica registrado).');
  const v = await db.vinculo.findFirst({
    where: { escopoId: escopo.id, ativo: true, usuario: { login: login.trim().toLowerCase(), ativo: true } },
    select: { perfil: true, usuario: { select: { id: true, login: true } } },
  });
  if (!v) throw new Error(`O usuário ${login} não tem vínculo ativo no escopo ${escopo.name}.`);
  if (!perfilPossui(v.perfil, 'conteudo.corrigir')) throw new Error(`O perfil ${v.perfil} de ${login} não corrige conteúdos.`);
  return { usuarioId: v.usuario.id, login: v.usuario.login };
}

const celula = (t: string | number | null) => String(t ?? '—').replace(/\|/g, '/');

function relatorio(escopo: Escopo, plano: PlanoCorrecao, executado: boolean, login: string): string {
  const conta = (d: string) => plano.vinculos.filter((v) => v.decisao === d).length;
  const vol = (d: string) => plano.vinculos.filter((v) => v.decisao === d).reduce((t, v) => t + (v.volumes ?? 0), 0);
  const linhas = [
    `# Correção de paletes — ${escopo.name}`,
    '',
    `${executado ? 'APLICADA' : 'SIMULAÇÃO (nada gravado)'} em ${new Date().toISOString()} por ${login}. Inventário ativo: ${plano.inventario?.codigo ?? 'nenhum'} (base ${plano.inventario?.dataBase ?? 'não informada'}).`,
    '',
    `- Número operacional: ${String(plano.numeros.length)} palete(s) passam a usar o N° Pallet da fonte; ${String(plano.numerosPendentes.length)} pendente(s).`,
    `- Notas antigas fora da versão ativa: ${String(conta('VALIDACAO'))} para a validação (${String(vol('VALIDACAO'))} volumes), ${String(conta('ENCERRAR'))} encerradas (já representadas noutro palete, ${String(vol('ENCERRAR'))} volumes), ${String(conta('MANTER'))} mantidas (${String(vol('MANTER'))} volumes).`,
    `- Paletes movidos depois do inventário (fora da correção automática): ${String(plano.paletesMovidos.length)}${plano.paletesMovidos.length > 0 ? ` — ${plano.paletesMovidos.map((p) => p.codigo).join(', ')}` : ''}.`,
    '',
    '## Números operacionais',
    '',
    '| Antes | Depois | Endereço |',
    '| --- | --- | --- |',
    ...plano.numeros.map((n) => `| ${n.de} | ${n.para} | ${n.endereco} |`),
    '',
    '## Números pendentes',
    '',
    '| Palete | Endereço | Motivo |',
    '| --- | --- | --- |',
    ...plano.numerosPendentes.map((n) => `| ${n.codigo} | ${n.endereco} | ${celula(n.motivo)} |`),
    '',
    '## Notas antigas',
    '',
    '| Decisão | Palete | Endereço | Documento | Volumes | Origem | Motivo |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...plano.vinculos.map(
      (v) => `| ${v.decisao} | ${v.palete} | ${celula(v.endereco)} | ${celula(v.documento)} | ${celula(v.volumes)} | ${v.inventario} linha ${String(v.linha)}${v.numeroAntigo === null ? '' : ` (N° ${v.numeroAntigo})`} | ${celula(v.motivo)} |`,
    ),
    '',
  ];
  return linhas.join('\n');
}

async function principal(): Promise<number> {
  const { values } = parseArgs({
    options: {
      unidade: { type: 'string' },
      cliente: { type: 'string' },
      usuario: { type: 'string' },
      relatorio: { type: 'string' },
      executar: { type: 'boolean', default: false },
    },
  });
  carregarEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido.');
  const db = criarBanco(url, (erro) => {
    console.error(erro.message);
  });
  try {
    const escopo = await resolverEscopo(db, values.unidade, values.cliente);
    const autor = await resolverAutor(db, escopo, values.usuario);
    const plano = await planejarCorrecao(db, escopo.id);
    if (plano.inventario === null) throw new Error('O escopo não tem inventário ativo: nada a corrigir.');
    const motivo = 'Correção de 21/10/2026: palete identificado pelo N° Pallet, não pela posição (pedido CORRECAO-PALETES-CONFERENCIA-E-REFERENCIAS5).';
    if (values.executar) {
      const r = await db.$transaction(async (tx) => aplicarCorrecao(tx, escopo, plano, { usuarioId: autor.usuarioId, requestId: `cli-${randomUUID()}` }, new Date(), motivo), { timeout: 600_000, maxWait: 30_000 });
      console.log(`Aplicada (operação ${r.operacaoId}): ${String(r.numeros)} número(s) operacional(is), ${String(r.validacao)} nota(s) para a validação, ${String(r.encerrados)} encerrada(s), ${String(r.mantidos)} mantida(s).`);
    } else {
      console.log('Simulação: nada foi gravado. Use --executar para aplicar (depois de npm run backup:criar).');
    }
    const texto = relatorio(escopo, plano, values.executar, autor.login);
    const arquivo = values.relatorio ?? `../../.dados/correcoes/correcao-paletes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`;
    mkdirSync(dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, texto, 'utf8');
    console.log(texto.split('\n').slice(0, 8).join('\n'));
    console.log(`Relatório: ${arquivo}`);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

principal().then(
  (codigo) => process.exit(codigo),
  (erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : String(erro));
    process.exit(1);
  },
);
