/**
 * Monta a planilha da praça a partir de um snapshot (26 out. 2026): três abas
 * — Inventário (mesmas 13 primeiras colunas da planilha da operação, depois
 * situação, pendência e rastreabilidade), Movimentações e Proteção e ajuda —
 * e, só se o histórico passar do limite por arquivo, arquivos de apoio com o
 * restante das Movimentações (período identificado; nada truncado em silêncio).
 *
 * Visual: faixa amarela DHL, títulos escuros, corpo claro, cabeçalho com
 * filtro (tabela do Excel), painel congelado, larguras legíveis, pendências
 * com fundo discreto. Mesclas só nos títulos; nenhuma no corpo. Texto sempre
 * como texto (nunca fórmula); quantidade conhecida como número; desconhecida
 * e pendente como texto explícito, fora de qualquer soma.
 */
import { letraDaColuna as letra } from '../importacao/arquivo/xlsx.js';
import type { EventoPlanilha, LinhaInventarioPlanilha, SnapshotPlanilha } from './dados.js';
import { estadoRestauracao, dataHoraBr, type ConfigPlanilha } from './situacao.js';
import { escreverPlanilha, type Celula, type EstiloCelula, type Folha, type Fundo, type Linha } from './xlsx.js';

export const ABA_INVENTARIO = 'Inventário';
export const ABA_MOVIMENTOS = 'Movimentações';
export const ABA_PROTECAO = 'Proteção e ajuda';
export const TABELA_INVENTARIO = 'InventarioPraca';
export const TABELA_MOVIMENTOS = 'MovimentosPraca';
export const LINHA_CABECALHO_INVENTARIO = 9;
export const LINHA_CABECALHO_MOVIMENTOS = 6;

/** As 13 primeiras na ordem da planilha da operação (copiar e colar entre as duas). */
export const COLUNAS_INVENTARIO = [
  'N° PALLET',
  'DELIVERY',
  'TIPO',
  'NUMERO',
  'VOLUMES',
  'REMETENTE',
  'MÊS AGENDA',
  'JANELA',
  'RUA',
  'DOCUMENTAÇÃO',
  'PALLET FULL',
  'PF/CNPJ',
  'INVENTÁRIO',
  'SITUAÇÃO',
  'PENDÊNCIA',
  'ORIGEM DOS VOLUMES',
  'CONFERÊNCIA',
  'FILEIRA',
  'TIPO DO PALETE',
  'PRODUTO NA CAIXA',
  'ORIGEM DO REGISTRO',
  'ID DO REGISTRO',
] as const;
export const COL = Object.fromEntries(COLUNAS_INVENTARIO.map((c, i) => [c, i])) as Readonly<Record<(typeof COLUNAS_INVENTARIO)[number], number>>;

export const COLUNAS_MOVIMENTOS = ['DATA E HORA (BRASÍLIA)', 'AÇÃO', 'N° PALLET', 'DOCUMENTO', 'ANTES', 'DEPOIS', 'RESPONSÁVEL', 'DESCRIÇÃO', 'FONTE', 'ID DO EVENTO'] as const;

/** Nome estável do arquivo: Praca-Reversa-<unidade>-<cliente>.xlsx (só letras, números e hífen). */
export function nomeArquivoPlanilha(unidade: string, cliente: string): string {
  return `${baseDoNome(unidade, cliente)}.xlsx`;
}

export function baseDoNome(unidade: string, cliente: string): string {
  const limpo = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^A-Za-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `Praca-Reversa-${limpo(unidade)}-${limpo(cliente)}`;
}

const compacto = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const r6 = (n: number) => `r${String(n).padStart(6, '0')}`;

/**
 * Nome da cópia de uma revisão (pasta "versoes"), com revisão, instante dos
 * dados e lote: <base>-r000123-20261026T120000Z-INV-000005[-antes-da-substituicao][-movimentacoes-02].xlsx.
 */
export function nomeVersao(base: string, revisao: number, instante: Date, rotulo: string, parte: number | null): string {
  const r = rotulo.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'sem-lote';
  return `${base}-${r6(revisao)}-${compacto(instante)}-${r}${parte === null ? '' : `-movimentacoes-${String(parte).padStart(2, '0')}`}.xlsx`;
}

export interface ContextoMontagem {
  revisao: number;
  geradoEm: Date;
  /** Lote ativo e marca de pré-substituição, para o nome das versões. */
  rotulo: string;
  config: ConfigPlanilha;
  /** Destino independente efetivo (escopo de demonstração: nenhum). */
  destino: { descricao: string; independente: boolean; motivo: string | null } | null;
}

export interface ArquivoMontado {
  papel: 'PRINCIPAL' | 'MOVIMENTACOES';
  nome: string;
  buffer: Buffer;
  /** Eventos de Movimentações neste arquivo e o período (mais recente → mais antigo). */
  eventos: EventoPlanilha[];
}

const DADO: EstiloCelula = { formato: 'texto', borda: 'leve' };
const cab = (col: number, valor: string): Celula => ({ col, valor, estilo: { fonte: 'cabecalho', fundo: 'amarelo', borda: 'cabecalho', quebra: true, formato: 'texto', horizontal: 'esquerda' } });
const FUNDO_GRUPO: Readonly<Record<LinhaInventarioPlanilha['grupo'], Fundo | null>> = { ESTOQUE: null, SEM_DOCUMENTO: null, SEM_CONTEUDO: null, VALIDACAO: 'pendente', PENDENTE: 'pendente', REFERENCIA: 'referencia' };

/** Faixa amarela, título, subtítulo e aviso (mesclados só no cabeçalho da aba). */
function topo(ultimaCol: number, titulo: string, subtitulo: string, aviso: string): { linhas: Linha[]; mesclas: string[] } {
  const faixa: Celula[] = [];
  for (let c = 0; c <= ultimaCol; c += 1) faixa.push({ col: c, valor: null, estilo: { fundo: 'amarelo' } });
  const fim = letra(Math.min(ultimaCol, 15));
  return {
    linhas: [
      { numero: 1, altura: 6, celulas: faixa },
      { numero: 2, altura: 28, celulas: [{ col: 0, valor: titulo, estilo: { fonte: 'titulo' } }] },
      { numero: 3, altura: 20, celulas: [{ col: 0, valor: subtitulo, estilo: { fonte: 'subtitulo' } }] },
      { numero: 4, altura: 30, celulas: [{ col: 0, valor: aviso, estilo: { fonte: 'aviso', quebra: true } }] },
    ],
    mesclas: [`A2:${fim}2`, `A3:${fim}3`, `A4:${fim}4`],
  };
}

const escopoTexto = (s: SnapshotPlanilha) => `${s.escopo.unidadeNome} (${s.escopo.unidade}) · ${s.escopo.clienteNome} (${s.escopo.cliente})${s.escopo.demonstracao ? ' · DADOS FICTÍCIOS DE DEMONSTRAÇÃO' : ''}`;
const loteTexto = (s: SnapshotPlanilha) => (s.loteAtivo === null ? 'nenhum inventário ativo' : `${s.loteAtivo.codigo} (${s.loteAtivo.descricao}, carregado em ${dataHoraBr(s.loteAtivo.criadoEm)})`);

function folhaInventario(s: SnapshotPlanilha, ctx: ContextoMontagem): Folha {
  const t = s.totais;
  const ultimaCol = COLUNAS_INVENTARIO.length - 1;
  const { linhas, mesclas } = topo(
    ultimaCol,
    'Praça Reversa · Inventário',
    `${escopoTexto(s)} · Revisão ${String(ctx.revisao)} · Dados de ${dataHoraBr(s.instante)} (Brasília) · Lote ativo ${loteTexto(s)}`,
    'Cópia para consulta gerada pelo aplicativo, que é a fonte oficial. Alterações feitas nesta planilha não voltam ao aplicativo. Filtre pelo cabeçalho (N° PALLET, NUMERO, DELIVERY, RUA, SITUAÇÃO…).',
  );
  const indicadores: [string, Celula['valor'], 'inteiro' | 'texto'][] = [
    ['Registros nos paletes', t.porGrupo.ESTOQUE + t.porGrupo.SEM_DOCUMENTO, 'inteiro'],
    ['Paletes na praça', t.paletesNaPraca, 'inteiro'],
    ['Volumes conhecidos (estoque)', t.volumesConhecidos, 'inteiro'],
    ['Estoque sem volume informado', t.estoqueSemVolume, 'inteiro'],
    ['Em validação (sem endereço)', t.porGrupo.VALIDACAO, 'inteiro'],
    ['Pendentes no lote ativo', t.porGrupo.PENDENTE, 'inteiro'],
    ['Volumes nas linhas filtradas', { formula: `SUBTOTAL(109,${TABELA_INVENTARIO}[VOLUMES])`, resultado: t.volumesConhecidos }, 'inteiro'],
  ];
  indicadores.forEach(([rotulo, valor, formato], i) => {
    const col = i * 2;
    linhas.push({ numero: 5, altura: 28, celulas: [{ col, valor: rotulo, estilo: { fonte: 'rotulo', fundo: 'cinzaClaro', quebra: true } }, { col: col + 1, valor: null, estilo: { fundo: 'cinzaClaro' } }] });
    linhas.push({ numero: 6, altura: 24, celulas: [{ col, valor, estilo: { fonte: 'indicador', fundo: 'cinzaClaro', formato, horizontal: 'esquerda' } }, { col: col + 1, valor: null, estilo: { fundo: 'cinzaClaro' } }] });
    mesclas.push(`${letra(col)}5:${letra(col + 1)}5`, `${letra(col)}6:${letra(col + 1)}6`);
  });
  const nota =
    t.linhas === 0
      ? 'Nenhum registro neste escopo (consulta concluída; não é falha).'
      : `VOLUMES soma só o estoque com quantidade conhecida (números). "Não informado" e pendências ficam em texto e não entram em soma: ${String(t.estoqueSemVolume)} registro(s) do estoque sem volume, ${String(t.porGrupo.VALIDACAO)} em validação, ${String(t.porGrupo.PENDENTE)} pendente(s) no lote ativo, ${String(t.porGrupo.SEM_DOCUMENTO + t.porGrupo.SEM_CONTEUDO)} sem documento/conteúdo, ${String(t.porGrupo.REFERENCIA)} referência(s) fora da praça${t.saidasTotais > 0 ? `; ${String(t.saidasTotais)} registro(s) com saída total aparecem só em Movimentações` : ''}. Soma de volumes não é saldo fisicamente validado; DOCUMENTAÇÃO = VALIDADA é condição documental, não conferência física.`;
  linhas.push({ numero: 7, altura: 42, celulas: [{ col: 0, valor: nota, estilo: { fonte: t.estoqueSemVolume > 0 ? 'vermelho' : 'aviso', quebra: true } }] });
  mesclas.push(`A7:${letra(15)}7`);
  linhas.push({ numero: LINHA_CABECALHO_INVENTARIO, altura: 32, celulas: COLUNAS_INVENTARIO.map((c, i) => cab(i, c)) });
  s.inventario.forEach((x, i) => {
    const fundo = FUNDO_GRUPO[x.grupo] ?? (i % 2 === 1 ? 'zebra' : 'nenhum');
    const d = (v: string | null, extra: EstiloCelula = {}): Pick<Celula, 'valor' | 'estilo'> => ({ valor: v === null || v === '' ? null : v, estilo: { ...DADO, fundo, ...extra } });
    const valores: Record<(typeof COLUNAS_INVENTARIO)[number], Pick<Celula, 'valor' | 'estilo'>> = {
      'N° PALLET': d(x.palete),
      DELIVERY: d(x.delivery),
      TIPO: d(x.tipo),
      NUMERO: d(x.numero),
      VOLUMES: x.volumes !== null ? { valor: x.volumes, estilo: { borda: 'leve', formato: 'inteiro', horizontal: 'direita', fundo } } : d(x.volumesTexto, { fonte: 'aviso' }),
      REMETENTE: d(x.remetente),
      'MÊS AGENDA': d(x.mesAgenda),
      JANELA: d(x.janela),
      RUA: d(x.endereco),
      DOCUMENTAÇÃO: d(x.documentacao),
      'PALLET FULL': d(x.palletFull),
      'PF/CNPJ': d(x.categoria),
      INVENTÁRIO: d(x.dataInventario),
      SITUAÇÃO: d(x.situacao, x.grupo === 'ESTOQUE' ? {} : { fonte: 'negrito' }),
      PENDÊNCIA: d(x.pendencia),
      'ORIGEM DOS VOLUMES': d(x.origemVolumes),
      CONFERÊNCIA: d(x.conferencia),
      FILEIRA: d(x.fileira),
      'TIPO DO PALETE': d(x.tipoPalete),
      'PRODUTO NA CAIXA': d(x.produto),
      'ORIGEM DO REGISTRO': d(x.origemRegistro),
      'ID DO REGISTRO': d(x.referencia, { fonte: 'aviso' }),
    };
    linhas.push({ numero: LINHA_CABECALHO_INVENTARIO + 1 + i, celulas: COLUNAS_INVENTARIO.map((c, col) => ({ col, ...valores[c] })) });
  });
  return {
    nome: ABA_INVENTARIO,
    larguras: [11, 14, 7, 14, 12, 34, 10, 10, 11, 14, 13, 9, 12, 34, 52, 22, 24, 8, 18, 26, 24, 38],
    linhas,
    mesclas,
    fixar: { colunas: 1, linhas: LINHA_CABECALHO_INVENTARIO },
    tabela: { nome: TABELA_INVENTARIO, coluna: 0, linhaCabecalho: LINHA_CABECALHO_INVENTARIO, ultimaLinha: LINHA_CABECALHO_INVENTARIO + Math.max(s.inventario.length, 1), colunas: COLUNAS_INVENTARIO },
  };
}

function folhaMovimentos(s: SnapshotPlanilha, ctx: ContextoMontagem, eventos: readonly EventoPlanilha[], parte: { numero: number; total: number; apoio: string[] }): Folha {
  const de = eventos.at(-1)?.em ?? null;
  const ate = eventos[0]?.em ?? null;
  const periodo = eventos.length === 0 ? 'nenhum evento' : `${String(eventos.length)} evento(s) de ${dataHoraBr(de)} a ${dataHoraBr(ate)}`;
  const aviso =
    parte.total === 1
      ? `Histórico completo: ${periodo}. Correções aparecem como novo evento ligado ao anterior; exportar ou substituir a base não gera movimento físico.`
      : parte.numero === 1
        ? `Histórico em ${String(parte.total)} arquivos (limite de linhas por arquivo). Este arquivo: os ${periodo}. Os mais antigos estão nos arquivos de apoio desta mesma revisão: ${parte.apoio.join(', ')}.`
        : `Arquivo de apoio ${String(parte.numero)} de ${String(parte.total)} das Movimentações da revisão ${String(ctx.revisao)}: ${periodo}. O inventário está no arquivo principal da mesma revisão.`;
  const { linhas, mesclas } = topo(COLUNAS_MOVIMENTOS.length - 1, 'Praça Reversa · Movimentações', `${escopoTexto(s)} · Revisão ${String(ctx.revisao)} · Dados de ${dataHoraBr(s.instante)} (Brasília)`, aviso);
  linhas.push({ numero: LINHA_CABECALHO_MOVIMENTOS, altura: 30, celulas: COLUNAS_MOVIMENTOS.map((c, i) => cab(i, c)) });
  eventos.forEach((e, i) => {
    const fundo: Fundo = i % 2 === 1 ? 'zebra' : 'nenhum';
    const t = (v: string | null): Celula['valor'] => (v === null || v === '' ? null : v);
    const est = (extra: EstiloCelula = {}): EstiloCelula => ({ ...DADO, fundo, ...extra });
    linhas.push({
      numero: LINHA_CABECALHO_MOVIMENTOS + 1 + i,
      celulas: [
        { col: 0, valor: e.em, estilo: { borda: 'leve', formato: 'dataHora', horizontal: 'esquerda', fundo } },
        { col: 1, valor: e.acao, estilo: est() },
        { col: 2, valor: t(e.palete), estilo: est() },
        { col: 3, valor: t(e.documento), estilo: est() },
        { col: 4, valor: t(e.antes), estilo: est() },
        { col: 5, valor: t(e.depois), estilo: est() },
        { col: 6, valor: e.responsavel, estilo: est() },
        { col: 7, valor: t(e.descricao), estilo: est() },
        { col: 8, valor: e.fonte, estilo: est({ fonte: 'aviso' }) },
        { col: 9, valor: e.id, estilo: est({ fonte: 'aviso' }) },
      ],
    });
  });
  return {
    nome: ABA_MOVIMENTOS,
    larguras: [18, 30, 11, 22, 26, 26, 30, 60, 18, 40],
    linhas,
    mesclas,
    fixar: { colunas: 0, linhas: LINHA_CABECALHO_MOVIMENTOS },
    tabela: { nome: TABELA_MOVIMENTOS, coluna: 0, linhaCabecalho: LINHA_CABECALHO_MOVIMENTOS, ultimaLinha: LINHA_CABECALHO_MOVIMENTOS + Math.max(eventos.length, 1), colunas: COLUNAS_MOVIMENTOS },
  };
}

/** Pares rótulo/valor da aba Proteção e ajuda (também conferidos na validação). */
export function itensDaCopia(s: SnapshotPlanilha, ctx: ContextoMontagem, apoio: readonly string[]): [string, string][] {
  const destino = ctx.destino;
  const pub = s.ultimaPlanilhaPublicada;
  const b = s.ultimoBackupLocal;
  const be = s.ultimoBackupExterno;
  const r = estadoRestauracao(ctx.config, s.ultimoTesteRestauracao, s.instante);
  return [
    ['Escopo', `${escopoTexto(s)} [${s.escopo.unidade}/${s.escopo.cliente}]`],
    ['Revisão dos dados', String(ctx.revisao)],
    ['Lote ativo', loteTexto(s)],
    ['Dados capturados em', `${dataHoraBr(s.instante)} (Brasília) · ${s.instante.toISOString()} (UTC)`],
    ['Fuso', 'Horários desta planilha em Brasília (America/Sao_Paulo); os metadados guardam o instante completo em UTC.'],
    ['Gerada em', `${dataHoraBr(ctx.geradoEm)} (Brasília) · ${ctx.geradoEm.toISOString()} (UTC)`],
    ['Alterações incluídas', `${String(s.alteracoes.ids.length)} desde a revisão anterior${s.alteracoes.ultimaEm ? ` (a mais recente confirmada em ${dataHoraBr(s.alteracoes.ultimaEm)})` : ''}`],
    [
      'Destino independente',
      destino === null ? 'Não configurado: esta cópia fica só no servidor do aplicativo.' : destino.independente ? destino.descricao : `${destino.descricao} — não conta como independente: ${destino.motivo ?? ''}`,
    ],
    ['Última publicação independente comprovada', pub === null ? 'Nenhuma até a geração desta revisão.' : `Revisão ${pub.referencia} em ${dataHoraBr(pub.concluidoEm)} (relida e conferida no destino).`],
    ['Arquivos desta revisão', apoio.length === 0 ? 'Só este arquivo.' : `Este arquivo e ${String(apoio.length)} de apoio (Movimentações mais antigas): ${apoio.join(', ')}.`],
    ['Backup completo (servidor)', b === null ? 'Nenhum backup verificado registrado.' : `${dataHoraBr(b.concluidoEm)} · ${b.identificador ?? ''}`],
    ['Backup completo (destino independente)', be === null ? 'Nenhum confirmado até a geração desta revisão.' : `${dataHoraBr(be.concluidoEm)} · ${be.referencia}`],
    ['Teste de restauração', `${r.estado}: ${r.detalhe}`],
  ];
}

function folhaProtecao(s: SnapshotPlanilha, ctx: ContextoMontagem, apoio: readonly string[]): Folha {
  const { linhas, mesclas } = topo(
    2,
    'Praça Reversa · Proteção e ajuda',
    `${escopoTexto(s)} · Revisão ${String(ctx.revisao)}`,
    'O aplicativo é a fonte oficial; esta planilha é uma cópia de consulta gerada automaticamente depois de cada alteração confirmada (aplicativo → planilha, nunca o contrário). A tela "Planilha e proteção" do aplicativo mostra a situação atual.',
  );
  let n = 6;
  const secao = (titulo: string) => {
    linhas.push({ numero: n, altura: 22, celulas: [{ col: 0, valor: titulo, estilo: { fonte: 'subtitulo', borda: 'detalhe' } }, { col: 1, valor: null, estilo: { borda: 'detalhe' } }] });
    n += 1;
  };
  const par = (rotulo: string, valor: string) => {
    linhas.push({ numero: n, altura: valor.length > 120 ? 44 : 22, celulas: [{ col: 0, valor: rotulo, estilo: { fonte: 'negrito', fundo: 'cinzaClaro', borda: 'leve', quebra: true } }, { col: 1, valor, estilo: { ...DADO, quebra: true } }] });
    n += 1;
  };
  const passo = (texto: string) => {
    linhas.push({ numero: n, altura: texto.length > 120 ? 44 : 22, celulas: [{ col: 0, valor: null }, { col: 1, valor: texto, estilo: { quebra: true, formato: 'texto' } }] });
    n += 1;
  };
  secao('Esta cópia');
  for (const [rotulo, valor] of itensDaCopia(s, ctx, apoio)) par(rotulo, valor);
  n += 1;
  secao('Como consultar e recuperar');
  const local = ctx.destino?.independente ? ctx.destino.descricao : null;
  for (const t of [
    '1. Filtre a aba Inventário pelo cabeçalho: N° PALLET, NUMERO, DELIVERY, RUA ou SITUAÇÃO. Linhas "Em validação" e "Pendente" não são estoque confirmado e não somam em VOLUMES.',
    '2. Movimentações mostra o que mudou, quando, por quem, antes e depois (mais recentes primeiro). O ID do evento identifica cada registro.',
    `3. Aplicativo fora do ar: ${local ? `abra o destino independente (${local}) com o seu acesso autorizado` : 'sem destino independente configurado, use a última cópia baixada'}. Em "planilha/${baseDoNome(s.escopo.unidade, s.escopo.cliente)}/" ficam o arquivo atual e o manifesto (revisão e SHA-256); em "versoes/", as anteriores com revisão e data no nome.`,
    '4. Confira "Dados capturados em" antes de usar a cópia: alterações feitas depois dela não estão aqui.',
    '5. Recuperar o sistema (usuários, permissões, histórico, anexos) exige o backup completo, restaurado pelo responsável técnico num banco isolado e conferido — nunca sobre o banco em uso. Esta planilha não substitui o backup.',
  ])
    passo(t);
  n += 1;
  secao('Limites');
  for (const t of [
    `Atualização automática depois de cada alteração confirmada, com alvo de até ${String(Math.round(ctx.config.alvoMs / 1_000))} s em condições normais: é um alvo de funcionamento, não garantia de atualização instantânea.`,
    'Editar esta planilha não altera o aplicativo; importar dados é outro fluxo, com permissão e validação.',
    'A planilha traz o inventário ativo, as pendências e o histórico; não traz usuários, permissões, anexos nem estruturas técnicas.',
    `Retenção das versões: últimas ${String(ctx.config.retencao.ultimas)}, uma por dia por ${String(ctx.config.retencao.diariasDias)} dias e as anteriores a substituições do inventário por ${String(ctx.config.retencao.preSubstituicaoDias)} dias; a última cópia válida nunca é apagada.`,
  ])
    passo(t);
  n += 1;
  secao('Termos');
  for (const [termo, explicacao] of [
    ['N° PALLET', 'Número operacional do palete (o mesmo da planilha da operação). Diferente de RUA, que é a posição física (ex.: 11 - A42).'],
    ['VOLUMES', 'Volumes atuais do registro naquele palete: contagem mais recente ou informado no inventário, menos as saídas. Texto = não somado.'],
    ['Em validação', 'Registro retirado do estoque físico por não ter endereço comprovado; aguarda localização no piso.'],
    ['Pendente no lote ativo', 'Linha do inventário carregado ainda em revisão ou repetida: endereço e quantidade da fonte não foram confirmados.'],
    ['DOCUMENTAÇÃO', 'Condição documental informada (ex.: VALIDADA). Não é conferência física.'],
    ['Revisão', 'Número crescente do estado dos dados capturado pelo aplicativo; cópias mais antigas nunca substituem uma mais nova.'],
  ] as const)
    par(termo, explicacao);
  return { nome: ABA_PROTECAO, larguras: [34, 120, 4], linhas, mesclas };
}

/**
 * Arquivos da revisão: o principal (três abas) e, se as Movimentações
 * passarem do limite por arquivo, os de apoio (as mais antigas).
 */
export function montarArquivos(s: SnapshotPlanilha, ctx: ContextoMontagem, base: string): ArquivoMontado[] {
  const limite = Math.max(1, ctx.config.movimentosPorArquivo);
  const partes: EventoPlanilha[][] = [];
  for (let i = 0; i < s.eventos.length; i += limite) partes.push(s.eventos.slice(i, i + limite));
  if (partes.length === 0) partes.push([]);
  const nomes = partes.map((_, i) => nomeVersao(base, ctx.revisao, s.instante, ctx.rotulo, i === 0 ? null : i + 1));
  const apoio = nomes.slice(1);
  const titulo = `Praça Reversa — ${s.escopo.unidade} · ${s.escopo.cliente} · revisão ${String(ctx.revisao)}`;
  return partes.map((eventos, i) => {
    const folha = folhaMovimentos(s, ctx, eventos, { numero: i + 1, total: partes.length, apoio });
    const folhas = i === 0 ? [folhaInventario(s, ctx), folha, folhaProtecao(s, ctx, apoio)] : [folha];
    return { papel: i === 0 ? 'PRINCIPAL' : 'MOVIMENTACOES', nome: nomes[i] ?? '', buffer: escreverPlanilha(folhas, titulo), eventos };
  });
}
