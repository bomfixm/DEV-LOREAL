/**
 * Carga do inventário em lote a partir do pacote preparado (ZIP com
 * `dados-importacao.json` ou o próprio JSON). Comando local, com acesso direto
 * ao banco; não há rota HTTP equivalente.
 *
 * Uso:
 *   npm run inventario:carregar -- --arquivo <pacote.zip|dados-importacao.json> \
 *     --unidade <código> --cliente <código> --usuario <login> [--executar]
 *     [--substitui INV-000001] [--descricao "..."] [--relatorio <arquivo.md>]
 *
 * Sem --executar: lê, valida e mostra o resumo do lote e as pendências (nada
 * é gravado). Com --executar: grava tudo numa transação (integral ou nada).
 * Unidade e cliente também podem vir de PRACA_UNIDADE e PRACA_CLIENTE; nunca
 * é escolhido um escopo por suposição, e escopo de demonstração é recusado.
 * O usuário precisa de vínculo ativo no escopo com permissão de importar
 * inventário (supervisor de estoque). O relatório (dados reais) vai para
 * .dados/cargas/, fora do versionamento.
 */
import { perfilPossui, type Escopo } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { RAIZ_REPOSITORIO, carregarEnvLocal } from '../config.js';
import { criarBanco, type Banco } from '../db/cliente.js';
import { ErroHttp } from '../http/erros.js';
import { registrarEvento } from '../modules/auditoria/registrar.js';
import { extrairEntrada, lerDiretorioZip, pareceZip } from '../modules/importacao/arquivo/zip.js';
import { carregarEstadoCarga, executarCarga, lerPacote, planejarCarga, type PacoteLido, type ResultadoCarga } from '../modules/importacao/carga-lote.js';

const NOME_JSON = 'dados-importacao.json';
const LIMITE_BYTES = 64 * 1_048_576;

function lerArquivo(caminho: string): { conteudo: Buffer; nome: string } {
  const bruto = readFileSync(caminho);
  if (bruto.length > LIMITE_BYTES) throw new Error(`Arquivo acima de ${String(LIMITE_BYTES / 1_048_576)} MB.`);
  if (!pareceZip(bruto)) return { conteudo: bruto, nome: basename(caminho) };
  const entradas = lerDiretorioZip(bruto, { maxEntradas: 50, maxTotalDescompactado: LIMITE_BYTES });
  const entrada = [...entradas.values()].find((e) => basename(e.nome) === NOME_JSON);
  if (!entrada) throw new Error(`O pacote ${basename(caminho)} não contém ${NOME_JSON}.`);
  return { conteudo: extrairEntrada(bruto, entrada, LIMITE_BYTES), nome: `${basename(caminho)}:${NOME_JSON}` };
}

async function resolverEscopo(db: Banco, unidade: string | undefined, cliente: string | undefined): Promise<Escopo> {
  const operacionais = await db.escopo.findMany({
    where: { ativo: true, demonstracao: false },
    select: { nome: true, unidade: { select: { codigo: true } }, cliente: { select: { codigo: true } } },
  });
  const disponiveis = operacionais.map((e) => `${e.unidade.codigo}/${e.cliente.codigo} (${e.nome})`).join('; ') || 'nenhum';
  if (!unidade || !cliente) {
    throw new Error(`Informe --unidade e --cliente (ou PRACA_UNIDADE e PRACA_CLIENTE). Escopos operacionais existentes: ${disponiveis}.`);
  }
  const escopo = await db.escopo.findFirst({
    where: { ativo: true, unidade: { codigo: unidade }, cliente: { codigo: cliente } },
    include: { unidade: true, cliente: true },
  });
  if (!escopo) throw new Error(`Escopo ${unidade}/${cliente} não encontrado ou inativo. Escopos operacionais existentes: ${disponiveis}.`);
  if (escopo.demonstracao || escopo.unidade.demonstracao || escopo.cliente.demonstracao) {
    throw new Error(`O escopo ${escopo.nome} é de demonstração (dados fictícios): a carga de dados reais é recusada.`);
  }
  return {
    id: escopo.id,
    name: escopo.nome,
    unitCode: escopo.unidade.codigo,
    unitName: escopo.unidade.nome,
    clientCode: escopo.cliente.codigo,
    clientName: escopo.cliente.nome,
    demo: false,
  };
}

async function resolverAutor(db: Banco, escopo: Escopo, login: string | undefined): Promise<{ usuarioId: string; login: string }> {
  if (!login) throw new Error('Informe --usuario <login> (supervisor de estoque do escopo): a carga fica registrada em nome dele.');
  const vinculo = await db.vinculo.findFirst({
    where: { escopoId: escopo.id, ativo: true, usuario: { login: login.trim().toLowerCase(), ativo: true } },
    select: { perfil: true, usuario: { select: { id: true, login: true } } },
  });
  if (!vinculo) throw new Error(`O usuário ${login} não tem vínculo ativo no escopo ${escopo.name}.`);
  if (!perfilPossui(vinculo.perfil, 'inventario.importar')) throw new Error(`O perfil ${vinculo.perfil} de ${login} não pode importar inventário (use um supervisor de estoque).`);
  return { usuarioId: vinculo.usuario.id, login: vinculo.usuario.login };
}

function relatorio(escopo: Escopo, login: string, p: PacoteLido, r: ResultadoCarga): string {
  const linhas = [
    `# Carga do inventário em lote — ${r.inventarioCodigo}`,
    '',
    `- Escopo: ${escopo.name} (${escopo.unitCode}/${escopo.clientCode})`,
    `- Usuário: ${login}`,
    `- Pacote: ${p.nomeArquivo} (SHA-256 ${p.hash}); id do lote ${p.pacote.id_lote}`,
    `- Fonte: ${p.pacote.fonte.arquivo}, aba ${p.pacote.fonte.aba} (SHA-256 ${p.pacote.fonte.sha256})`,
    `- ${r.reenvio ? 'Reenvio: nada gravado de novo' : 'Gravado'} em ${r.confirmadoEm ?? '?'} · lote ${r.loteId}`,
    '',
    '## Resultado',
    '',
    `- Linhas de origem: ${String(r.linhas.total)} (aplicadas ${String(r.linhas.aplicadas)}, endereço livre/referência ${String(r.linhas.historicas)}, repetidas agrupadas ${String(r.linhas.repetidas)}, já importadas ${String(r.linhas.jaImportadas)}, não aplicadas por conflito ${String(r.linhas.pendentes)})`,
    `- Vínculos: ${String(r.vinculos.criados)} criados, ${String(r.vinculos.atualizados)} atualizados, ${String(r.vinculos.jaExistentes)} já existentes, ${String(r.vinculos.emConflito)} em conflito (${String(r.vinculos.tipoPendente)} de tipo pendente/MI)`,
    `- Paletes: ${String(r.paletes.criados)} cadastrados, ${String(r.paletes.existentes)} já existentes, ${String(r.paletes.emConflito)} endereço(s) em conflito; ${String(r.paletes.localizacoesRegistradas)} localização(ões) registrada(s); ${String(r.paletes.posicaoNoMapaPendente)} com posição no mapa pendente`,
    `- Referências fora da praça: ${String(r.referenciasForaDaPraca)} · volumes pendentes: ${String(r.volumesPendentes)}`,
    '',
    '## Resumo do lote',
    '',
    ...r.resumo.map((x) => `- ${x}`),
    '',
    '## Pendências para tratar depois',
    '',
    ...r.pendencias.map((x) => `- ${x}`),
    '',
  ];
  return linhas.join('\n');
}

async function principal(): Promise<number> {
  const { values } = parseArgs({
    options: {
      arquivo: { type: 'string' },
      unidade: { type: 'string' },
      cliente: { type: 'string' },
      usuario: { type: 'string' },
      executar: { type: 'boolean', default: false },
      substitui: { type: 'string' },
      descricao: { type: 'string' },
      relatorio: { type: 'string' },
    },
  });
  if (!values.arquivo) {
    console.error('Uso: npm run inventario:carregar -- --arquivo <pacote.zip|dados-importacao.json> --unidade <código> --cliente <código> --usuario <login> [--executar]');
    return 1;
  }
  carregarEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido.');
  const { conteudo, nome } = lerArquivo(resolve(values.arquivo));
  const lido = lerPacote(conteudo, nome);
  if (!lido.ok) {
    console.error('Pacote recusado (nada foi gravado):');
    for (const e of lido.erros) console.error(`  - ${e}`);
    return 1;
  }
  const p = lido.pacote;
  console.log(`Pacote lido e conferido: ${p.pacote.schema}, ${String(p.pacote.linhas_fonte.length)} linhas de origem, ${String(p.pacote.nfds_na_praca.length)} vínculos NFD, ${String(p.pacote.posicoes.length)} endereços.`);
  const db = criarBanco(url, (erro) => {
    console.error(erro.message);
  });
  try {
    const escopo = await resolverEscopo(db, values.unidade ?? process.env.PRACA_UNIDADE, values.cliente ?? process.env.PRACA_CLIENTE);
    const autor = await resolverAutor(db, escopo, values.usuario);
    console.log(`Escopo: ${escopo.name} (${escopo.unitCode}/${escopo.clientCode}) · usuário ${autor.login} · ambiente ${process.env.APP_AMBIENTE ?? 'producao'}`);
    const estado = await carregarEstadoCarga(db, escopo.id, p, values.substitui ?? null);
    const plano = planejarCarga(p, estado);
    console.log(estado.loteExistente ? `\nEste pacote já foi importado como ${estado.loteExistente.inventarioCodigo}: o reenvio não grava de novo.` : '\nResumo do lote:');
    for (const linha of plano.resumo) console.log(`  - ${linha}`);
    console.log('\nPendências (lista para tratar depois):');
    for (const linha of plano.pendencias) console.log(`  - ${linha}`);
    if (!values.executar) {
      console.log('\nPrévia: nada foi gravado. Rode de novo com --executar para gravar o conjunto (integral ou nada).');
      return 0;
    }
    const requestId = `cli-carga-${randomUUID()}`;
    let r: ResultadoCarga;
    try {
      r = await executarCarga(db, escopo, { usuarioId: autor.usuarioId, requestId }, p, { substitui: values.substitui ?? null, descricao: values.descricao ?? null }, new Date());
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await registrarEvento(db, {
        acao: 'INVENTARIO_CARGA_FALHOU',
        resultado: 'FALHA',
        atorUsuarioId: autor.usuarioId,
        escopoId: escopo.id,
        alvoTipo: 'PACOTE_CARGA',
        alvoId: p.pacote.id_lote,
        detalhes: { hashPacote: p.hash, mensagem: mensagem.slice(0, 300), origem: 'comando_local' },
        requestId,
      }).catch(() => undefined);
      console.error(`\nCarga revertida (nada foi gravado): ${erro instanceof ErroHttp ? `${erro.codigo}: ` : ''}${mensagem}`);
      return 1;
    }
    console.log(`\n${r.reenvio ? 'Reenvio' : 'Carga gravada'}: ${r.inventarioCodigo} (lote ${r.loteId}).`);
    console.log(`  Linhas: ${String(r.linhas.total)} · aplicadas ${String(r.linhas.aplicadas)} · referência/endereço livre ${String(r.linhas.historicas)} · repetidas ${String(r.linhas.repetidas)} · já importadas ${String(r.linhas.jaImportadas)} · conflito ${String(r.linhas.pendentes)}`);
    console.log(`  Vínculos: criados ${String(r.vinculos.criados)} · atualizados ${String(r.vinculos.atualizados)} · já existentes ${String(r.vinculos.jaExistentes)} · em conflito ${String(r.vinculos.emConflito)} (tipo pendente/MI ${String(r.vinculos.tipoPendente)})`);
    console.log(`  Paletes: cadastrados ${String(r.paletes.criados)} · já existentes ${String(r.paletes.existentes)} · conflito ${String(r.paletes.emConflito)} · localizações registradas ${String(r.paletes.localizacoesRegistradas)} · posição no mapa pendente ${String(r.paletes.posicaoNoMapaPendente)}`);
    console.log(`  Referências fora da praça ${String(r.referenciasForaDaPraca)} · volumes pendentes ${String(r.volumesPendentes)} · cidades/produtos preenchidos ${String(r.camposPreenchidos.cidades)}/${String(r.camposPreenchidos.produtos)}`);
    const destino = values.relatorio ? resolve(values.relatorio) : resolve(RAIZ_REPOSITORIO, '.dados', 'cargas', `${r.inventarioCodigo}-${r.reenvio ? 'reenvio-' : ''}${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, relatorio(escopo, autor.login, p, r), 'utf8');
    console.log(`  Relatório (dados reais, fora do versionamento): ${destino}`);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

await principal()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : String(erro));
    process.exitCode = 1;
  });
