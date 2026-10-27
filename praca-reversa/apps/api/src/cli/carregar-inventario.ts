/**
 * Carga do inventário em lote a partir do pacote preparado (ZIP com
 * `dados-importacao.json` ou o próprio JSON). Comando local, com acesso direto
 * ao banco; não há rota HTTP equivalente.
 *
 * Uso:
 *   npm run inventario:carregar -- --arquivo <pacote.zip|dados-importacao.json> \
 *     --unidade <código> --cliente <código> --usuario <login> [--executar]
 *     [--substitui INV-000001] [--manter-ausentes] [--descricao "..."] [--relatorio <arquivo.md>]
 *
 * Também aceita o inventário L'Oréal preparado (formato "1.0", 20/10/2026):
 * o ZIP com `dados/inventario-preparado.json` + `pendencias.json` (+
 * `inventario-origem.json`) ou o próprio `inventario-preparado.json` com os
 * arquivos irmãos na mesma pasta; ele é convertido para o pacote de carga e
 * segue o mesmo caminho. `--manter-ausentes` (com --substitui): os vínculos
 * ativos que não constam da versão nova continuam ativos, a validar no piso.
 * `--alocar-revisao <causa,causa…> --decisao "<texto>"` (só no formato
 * preparado): linhas em revisão cujas causas de bloqueio estão todas na lista
 * vão para o palete do endereço, que fica com "Reconferência necessária".
 * `--corrigir-endereco "15 - A22=15 - A122"` (repetível, com --alocar-revisao):
 * lê aquele endereço da planilha como o outro (o texto original fica guardado).
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { RAIZ_REPOSITORIO, carregarEnvLocal, lerConfigProtecao } from '../config.js';
import { criarBanco, type Banco } from '../db/cliente.js';
import { ErroHttp } from '../http/erros.js';
import { registrarEvento } from '../modules/auditoria/registrar.js';
import { extrairEntrada, lerDiretorioZip, pareceZip } from '../modules/importacao/arquivo/zip.js';
import { carregarEstadoCarga, executarCarga, lerPacote, planejarCarga, type PacoteLido, type ResultadoCarga } from '../modules/importacao/carga-lote.js';
import { converterInventarioLoreal } from '../modules/importacao/inventario-loreal.js';
import { protegerAntesDaSubstituicao } from '../modules/protecao/substituicao.js';

const NOME_JSON = 'dados-importacao.json';
const LIMITE_BYTES = 64 * 1_048_576;

const PREPARADO = 'inventario-preparado.json';
const PENDENCIAS = 'pendencias.json';
const ORIGEM = 'inventario-origem.json';

const json = (b: Buffer): unknown => JSON.parse(b.toString('utf8').replace(/^\uFEFF/, ''));

type AlocarRevisao = { causas: readonly string[]; decisao: string; corrigir: readonly { de: string; para: string }[] } | null;

/** Inventário L'Oréal preparado (formato 1.0) → pacote de carga (bytes do JSON convertido). */
function converter(preparado: Buffer, pendencias: Buffer | null, origem: Buffer | null, nome: string, alocar: AlocarRevisao): { conteudo: Buffer; nome: string } {
  if (pendencias === null) throw new Error(`Faltou ${PENDENCIAS} junto do ${PREPARADO}: sem ele os motivos das linhas em revisão se perderiam.`);
  const pacote = converterInventarioLoreal({ preparado: json(preparado), pendencias: json(pendencias), ...(origem === null ? {} : { origem: json(origem) }), ...(alocar === null ? {} : { alocarRevisao: { causas: alocar.causas, decisao: alocar.decisao }, corrigirEnderecos: alocar.corrigir }) });
  return { conteudo: Buffer.from(JSON.stringify(pacote), 'utf8'), nome: `${nome} (convertido para o pacote de carga)` };
}

function lerArquivo(caminho: string, alocar: AlocarRevisao): { conteudo: Buffer; nome: string } {
  const bruto = readFileSync(caminho);
  if (bruto.length > LIMITE_BYTES) throw new Error(`Arquivo acima de ${String(LIMITE_BYTES / 1_048_576)} MB.`);
  if (!pareceZip(bruto)) {
    if (basename(caminho) === PREPARADO) {
      const irmao = (n: string) => (existsSync(join(dirname(caminho), n)) ? readFileSync(join(dirname(caminho), n)) : null);
      return converter(bruto, irmao(PENDENCIAS), irmao(ORIGEM), basename(caminho), alocar);
    }
    if (alocar !== null) throw new Error('--alocar-revisao só vale para o inventário preparado (inventario-preparado.json).');
    return { conteudo: bruto, nome: basename(caminho) };
  }
  const entradas = [...lerDiretorioZip(bruto, { maxEntradas: 50, maxTotalDescompactado: LIMITE_BYTES }).values()];
  const ler = (n: string) => {
    const e = entradas.find((x) => basename(x.nome) === n);
    return e === undefined ? null : extrairEntrada(bruto, e, LIMITE_BYTES);
  };
  const pacote = ler(NOME_JSON);
  if (pacote !== null) {
    if (alocar !== null) throw new Error('--alocar-revisao só vale para o inventário preparado (inventario-preparado.json).');
    return { conteudo: pacote, nome: `${basename(caminho)}:${NOME_JSON}` };
  }
  const preparado = ler(PREPARADO);
  if (preparado !== null) return converter(preparado, ler(PENDENCIAS), ler(ORIGEM), `${basename(caminho)}:${PREPARADO}`, alocar);
  throw new Error(`O pacote ${basename(caminho)} não contém ${NOME_JSON} nem ${PREPARADO}.`);
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
    `- Linhas de origem: ${String(r.linhas.total)} (aplicadas ${String(r.linhas.aplicadas)}, endereço livre/referência ${String(r.linhas.historicas)}, repetidas agrupadas ${String(r.linhas.repetidas)}, já importadas ${String(r.linhas.jaImportadas)}, requerem resolução ${String(r.linhas.pendentes)}: ${String(r.linhas.semEndereco)} sem endereço, ${String(r.linhas.emRevisao)} em revisão — sem alocação — e ${String(r.linhas.pendentes - r.linhas.semEndereco - r.linhas.emRevisao)} por conflito)`,
    `- Vínculos: ${String(r.vinculos.criados)} criados, ${String(r.vinculos.atualizados)} atualizados, ${String(r.vinculos.jaExistentes)} já existentes, ${String(r.vinculos.emConflito)} em conflito (${String(r.vinculos.tipoPendente)} de tipo pendente/MI); ${String(r.vinculos.mantidosAusentes)} ativos sem constar desta versão, mantidos para validar`,
    `- Paletes: ${String(r.paletes.criados)} cadastrados, ${String(r.paletes.existentes)} já existentes, ${String(r.paletes.emConflito)} endereço(s) em conflito; ${String(r.paletes.localizacoesRegistradas)} localização(ões) registrada(s); ${String(r.paletes.posicaoNoMapaPendente)} com posição no mapa pendente; ${String(r.paletes.reconferenciaExigida)} com reconferência necessária por decisão`,
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
      'manter-ausentes': { type: 'boolean', default: false },
      'alocar-revisao': { type: 'string' },
      'corrigir-endereco': { type: 'string', multiple: true },
      decisao: { type: 'string' },
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
  const causas = (values['alocar-revisao'] ?? '').split(',').map((c) => c.trim()).filter((c) => c !== '');
  const decisao = (values.decisao ?? '').trim();
  if (causas.length > 0 && decisao.length < 5) throw new Error('--alocar-revisao exige --decisao "<quem decidiu, quando e o quê>".');
  const corrigir = (values['corrigir-endereco'] ?? []).map((c) => {
    const [de, para] = c.split('=').map((x) => x.trim());
    if (!de || !para) throw new Error(`--corrigir-endereco "${c}": use "<endereço da planilha>=<endereço correto>".`);
    return { de, para };
  });
  if (corrigir.length > 0 && causas.length === 0) throw new Error('--corrigir-endereco só vale junto de --alocar-revisao e --decisao.');
  const { conteudo, nome } = lerArquivo(resolve(values.arquivo), causas.length === 0 ? null : { causas, decisao, corrigir });
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
    const manterAusentes = values['manter-ausentes'];
    if (manterAusentes && !values.substitui) throw new Error('--manter-ausentes só vale junto de --substitui <INV-…>.');
    const plano = planejarCarga(p, estado, { manterAusentes });
    console.log(estado.loteExistente ? `\nEste pacote já foi importado como ${estado.loteExistente.inventarioCodigo}: o reenvio não grava de novo.` : '\nResumo do lote:');
    for (const linha of plano.resumo) console.log(`  - ${linha}`);
    console.log('\nPendências (lista para tratar depois):');
    for (const linha of plano.pendencias) console.log(`  - ${linha}`);
    if (!values.executar) {
      console.log('\nPrévia: nada foi gravado. Rode de novo com --executar para gravar o conjunto (integral ou nada).');
      return 0;
    }
    const requestId = `cli-carga-${randomUUID()}`;
    if (values.substitui !== undefined && !estado.loteExistente) {
      // Substituição do inventário ativo: planilha e backup da base atual antes da troca (sem cópia verificada, nada é gravado).
      const protecao = lerConfigProtecao(process.env);
      if (protecao.protegerSubstituicao) {
        console.log('\nProteção prévia: gerando a planilha e o backup completo da base atual…');
        const p = await protegerAntesDaSubstituicao(db, escopo.id, protecao, { usuarioId: autor.usuarioId, requestId }, values.substitui);
        console.log(`  - Planilha revisão ${String(p.revisao)} (${p.planilhaPublicada ? 'publicada no destino independente' : 'no servidor; envio pelo trabalhador'}); backup ${p.backupId} (${p.backupEnviado ? 'enviado ao destino' : 'verificado no servidor; envio pelo trabalhador'}).`);
      }
    }
    let r: ResultadoCarga;
    try {
      r = await executarCarga(db, escopo, { usuarioId: autor.usuarioId, requestId }, p, { substitui: values.substitui ?? null, descricao: values.descricao ?? null, manterAusentes }, new Date());
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
    console.log(`  Linhas: ${String(r.linhas.total)} · aplicadas ${String(r.linhas.aplicadas)} · referência/endereço livre ${String(r.linhas.historicas)} · repetidas ${String(r.linhas.repetidas)} · já importadas ${String(r.linhas.jaImportadas)} · sem endereço (sem alocação) ${String(r.linhas.semEndereco)} · em revisão (sem alocação) ${String(r.linhas.emRevisao)} · conflito ${String(r.linhas.pendentes - r.linhas.semEndereco - r.linhas.emRevisao)}`);
    console.log(`  Vínculos: criados ${String(r.vinculos.criados)} · atualizados ${String(r.vinculos.atualizados)} · já existentes ${String(r.vinculos.jaExistentes)} · em conflito ${String(r.vinculos.emConflito)} (tipo pendente/MI ${String(r.vinculos.tipoPendente)}) · ativos sem constar desta versão (mantidos) ${String(r.vinculos.mantidosAusentes)}`);
    console.log(`  Paletes: cadastrados ${String(r.paletes.criados)} · já existentes ${String(r.paletes.existentes)} · conflito ${String(r.paletes.emConflito)} · localizações registradas ${String(r.paletes.localizacoesRegistradas)} · posição no mapa pendente ${String(r.paletes.posicaoNoMapaPendente)} · reconferência necessária ${String(r.paletes.reconferenciaExigida)}`);
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
