/**
 * Monta as três abas da planilha única (Inventário, Movimentações, Proteção e
 * ajuda) a partir de um snapshot. Indicadores calculados do mesmo recorte de
 * unidade e cliente da tabela; textos simples para quem não conhece o
 * projeto. Células de dados nunca são mescladas (só títulos e avisos).
 */
import { somarQuantidades } from '@praca-reversa/contracts';
import type { SnapshotPlanilha } from './dados.js';
import { estadoBackup, estadoRestauracao, type ConfigPlanilha, type Estado } from './situacao.js';
import { escreverPlanilha, type Celula, type EstiloCelula, type Folha, type Fundo, type Linha } from './xlsx.js';

export const TABELA_INVENTARIO = 'InventarioPraca';
export const TABELA_MOVIMENTOS = 'MovimentosPraca';
export const TABELA_PROTECAO = 'ProtecaoPraca';
export const LINHA_CABECALHO_INVENTARIO = 10;
export const LINHA_CABECALHO_MOVIMENTOS = 9;

export const COLUNAS_INVENTARIO = [
  'Endereço',
  'ID do palete',
  'NFD',
  'Remetente',
  'Cidade destino',
  'Volumes',
  'Palete full',
  'Mais de um palete para a mesma nota?',
  'Produto na caixa',
  'Situação da conferência ou alocação',
  'Delivery',
] as const;

export const COLUNAS_MOVIMENTOS = ['Data e hora (São Paulo)', 'ID do evento', 'Alteração', 'NFD', 'ID do palete', 'Origem', 'Destino', 'Responsável', 'Descrição'] as const;

/** Nome estável do arquivo: Praca-Reversa-<unidade>-<cliente>.xlsx (só letras, números e hífen). */
export function nomeArquivoPlanilha(unidade: string, cliente: string): string {
  const limpo = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^A-Za-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `Praca-Reversa-${limpo(unidade)}-${limpo(cliente)}.xlsx`;
}

const dataBr = (d: Date | null) => (d === null ? 'nenhuma' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d));

const DADO: EstiloCelula = { formato: 'texto', borda: 'leve' };
const cab = (col: number, valor: string, ultima: boolean): Celula => ({ col, valor, estilo: { fonte: 'cabecalho', fundo: 'amarelo', borda: 'cabecalho', quebra: true, formato: 'texto', horizontal: ultima ? 'esquerda' : undefined } });
const zebra = (i: number, e: EstiloCelula): EstiloCelula => ({ ...e, fundo: i % 2 === 1 ? 'zebra' : 'nenhum' });

const FUNDO_ESTADO: Readonly<Record<Estado, Fundo>> = {
  Atualizada: 'verdeClaro',
  'Atualização pendente': 'amareloClaro',
  Falhou: 'vermelhoClaro',
  'Não configurado': 'cinzaEstado',
  'Não testado': 'cinzaEstado',
};

/** Cabeçalho comum das abas: faixa amarela, título, subtítulo e avisos (mesclados só aqui). */
function cabecalho(ultimaCol: number, subtitulo: string, avisos: readonly string[]): { linhas: Linha[]; mesclas: string[] } {
  const fim = String.fromCharCode(65 + ultimaCol);
  const faixa: Celula[] = [];
  for (let c = 1; c <= ultimaCol; c += 1) faixa.push({ col: c, valor: null, estilo: { fundo: 'amarelo' } });
  const linhas: Linha[] = [
    { numero: 1, altura: 8, celulas: faixa },
    { numero: 2, altura: 30, celulas: [{ col: 1, valor: 'Praça Reversa', estilo: { fonte: 'titulo' } }] },
    { numero: 3, altura: 24, celulas: [{ col: 1, valor: subtitulo, estilo: { fonte: 'subtitulo', borda: 'detalhe' } }, ...range(2, ultimaCol).map((c) => ({ col: c, valor: null, estilo: { borda: 'detalhe' as const } }))] },
    ...avisos.map((a, i) => ({ numero: 4 + i, altura: 30, celulas: [{ col: 1, valor: a, estilo: { fonte: i === 0 ? ('negrito' as const) : ('aviso' as const), quebra: true } }] })),
  ];
  const mesclas = [`B2:${fim}2`, `B3:${fim}3`, ...avisos.map((_, i) => `B${String(4 + i)}:${fim}${String(4 + i)}`)];
  return { linhas, mesclas };
}

function range(de: number, ate: number): number[] {
  const r: number[] = [];
  for (let i = de; i <= ate; i += 1) r.push(i);
  return r;
}

function escopoTexto(s: SnapshotPlanilha): string {
  return `${s.escopo.unidadeNome} (${s.escopo.unidade}) · ${s.escopo.clienteNome} (${s.escopo.cliente})${s.escopo.demonstracao ? ' · DADOS FICTÍCIOS DE DEMONSTRAÇÃO' : ''}`;
}

function folhaInventario(s: SnapshotPlanilha, versao: number): Folha {
  const naPracaTudo = s.inventario.filter((x) => !x.semAlocacao && !x.endereco.startsWith('Fora da praça'));
  const naPraca = naPracaTudo.filter((x) => !x.semNota);
  const semVolume = naPraca.filter((x) => x.volumes === null).length;
  const totalVolumes = Number(somarQuantidades(naPraca.flatMap((x) => (x.volumes === null ? [] : [x.volumes]))));
  const visiveis = Number(somarQuantidades(s.inventario.flatMap((x) => (x.volumes === null ? [] : [x.volumes]))));
  const semAlocacao = s.inventario.filter((x) => x.semAlocacao).length;
  const { linhas, mesclas } = cabecalho(11, 'Inventário atual', [
    escopoTexto(s),
    `Dados de ${dataBr(s.instante)} (São Paulo) · versão ${String(versao)} · última publicação concluída antes desta: ${dataBr(s.ultimaPublicada?.concluidoEm ?? null)}.`,
    'Cada linha relaciona uma nota a um palete: a mesma nota em dois paletes aparece em duas linhas, cada uma com os seus volumes. Use os filtros do cabeçalho (inclusive Delivery). Esta planilha é só para consulta: as alterações são feitas no aplicativo.',
  ]);
  const indicador = (col: number, rotulo: string, valor: number | { formula: string; resultado: number }, larg: number) => {
    linhas.push({ numero: 7, altura: 30, celulas: [{ col, valor: rotulo, estilo: { fonte: 'rotulo', fundo: 'cinzaClaro', quebra: true } }] });
    const inteiro = typeof valor === 'number' ? Number.isInteger(valor) : Number.isInteger(valor.resultado);
    linhas.push({ numero: 8, altura: 26, celulas: [{ col, valor, estilo: { fonte: 'indicador', fundo: 'cinzaClaro', formato: inteiro ? 'inteiro' : 'decimal', horizontal: 'esquerda' } }] });
    if (larg > 1) {
      for (const n of [7, 8]) mesclas.push(`${String.fromCharCode(65 + col)}${String(n)}:${String.fromCharCode(65 + col + larg - 1)}${String(n)}`);
      for (let c = col + 1; c < col + larg; c += 1) for (const n of [7, 8]) linhas.push({ numero: n, celulas: [{ col: c, valor: null, estilo: { fundo: 'cinzaClaro' } }] });
    }
  };
  indicador(1, 'Vínculos nota × palete na praça', naPraca.length, 2);
  indicador(3, 'Números de NFD distintos na praça', new Set(naPraca.flatMap((x) => (x.nfd === null ? [] : [x.nfd]))).size, 2);
  indicador(5, 'Paletes distintos', new Set(naPracaTudo.map((x) => x.palete)).size, 1);
  indicador(6, semVolume > 0 ? 'Volumes informados (parcial)' : 'Volumes informados', totalVolumes, 2);
  indicador(8, 'Linhas sem volume · sem alocação', 0, 1);
  indicador(9, 'Volumes nas linhas filtradas', { formula: `SUBTOTAL(109,${TABELA_INVENTARIO}[Volumes])`, resultado: visiveis }, 3);
  // Célula de texto para "sem volume · sem alocação" (dois números distintos, não somáveis).
  const dupla = linhas.find((l) => l.numero === 8 && l.celulas.some((c) => c.col === 8));
  if (dupla) dupla.celulas = [{ col: 8, valor: `${String(semVolume)} · ${String(semAlocacao)}`, estilo: { fonte: 'indicador', fundo: 'cinzaClaro', formato: 'texto' } }];
  linhas.push({
    numero: 9,
    altura: 30,
    celulas: [
      {
        col: 1,
        valor:
          semVolume > 0
            ? `Total parcial: ${String(semVolume)} vínculo(s) na praça sem volume informado (em branco não é zero). Vínculos não são notas distintas nem paletes distintos.`
            : 'Todos os vínculos da praça têm volume informado. Vínculos não são notas distintas nem paletes distintos.',
        estilo: { fonte: semVolume > 0 ? 'vermelho' : 'aviso', quebra: true },
      },
    ],
  });
  mesclas.push('B9:L9');
  linhas.push({ numero: LINHA_CABECALHO_INVENTARIO, altura: 46, celulas: COLUNAS_INVENTARIO.map((t, i) => cab(i + 1, t, i === COLUNAS_INVENTARIO.length - 1)) });
  s.inventario.forEach((x, i) => {
    const t = (v: string | null): string | null => (v === null || v === '' ? null : v);
    linhas.push({
      numero: LINHA_CABECALHO_INVENTARIO + 1 + i,
      celulas: [
        { col: 1, valor: x.endereco, estilo: zebra(i, { ...DADO, fonte: x.semAlocacao ? 'vermelho' : 'normal' }) },
        { col: 2, valor: t(x.palete), estilo: zebra(i, DADO) },
        { col: 3, valor: t(x.nfd), estilo: zebra(i, DADO) },
        { col: 4, valor: t(x.remetente), estilo: zebra(i, DADO) },
        { col: 5, valor: t(x.cidade), estilo: zebra(i, DADO) },
        { col: 6, valor: x.volumes === null ? null : Number(x.volumes), estilo: zebra(i, { borda: 'leve', formato: x.volumes !== null && Number.isInteger(Number(x.volumes)) ? 'inteiro' : 'decimal', horizontal: 'direita' }) },
        { col: 7, valor: x.paleteFull, estilo: zebra(i, { ...DADO, horizontal: 'centro' }) },
        { col: 8, valor: x.maisDeUmPalete, estilo: zebra(i, { ...DADO, horizontal: 'centro' }) },
        { col: 9, valor: t(x.produto), estilo: zebra(i, { ...DADO, quebra: true }) },
        { col: 10, valor: x.situacao, estilo: zebra(i, { ...DADO, quebra: true }) },
        { col: 11, valor: t(x.delivery), estilo: zebra(i, DADO) },
      ],
    });
  });
  const ultima = LINHA_CABECALHO_INVENTARIO + Math.max(s.inventario.length, 1);
  const notas = [
    s.inventario.length === 0 ? 'Nenhum vínculo nem nota sem alocação neste escopo (consulta concluída; não é falha).' : null,
    'Volumes: caixas/volumes informados para a nota naquele palete. Em branco = informação pendente (não é zero). Peças por produto só existem depois da conferência.',
    'Palete full: o palete inteiro tem uma única nota. "Não informado" = informação insuficiente. Uma nota pode ocupar vários paletes ("Mais de um palete…" = Sim).',
    'Sem alocação: nota de um endereço que ficou livre (RUA verde no inventário de origem). O material saiu desta praça; o local atual não foi informado. Não é ocupação.',
  ].filter((x): x is string => x !== null);
  notas.forEach((n, i) => {
    linhas.push({ numero: ultima + 2 + i, altura: 30, celulas: [{ col: 1, valor: n, estilo: { fonte: 'aviso', quebra: true } }] });
    mesclas.push(`B${String(ultima + 2 + i)}:L${String(ultima + 2 + i)}`);
  });
  return {
    nome: 'Inventário',
    larguras: [2.5, 16, 13, 12, 30, 18, 11, 13, 19, 30, 50, 14],
    linhas,
    mesclas,
    fixar: { colunas: 4, linhas: LINHA_CABECALHO_INVENTARIO },
    tabela: { nome: TABELA_INVENTARIO, coluna: 1, linhaCabecalho: LINHA_CABECALHO_INVENTARIO, ultimaLinha: ultima, colunas: COLUNAS_INVENTARIO },
  };
}

function folhaMovimentos(s: SnapshotPlanilha): Folha {
  const truncado = s.eventosTotal > s.eventos.length;
  const maisAntigo = s.eventos.at(-1)?.em ?? null;
  const maisRecente = s.eventos[0]?.em ?? null;
  const { linhas, mesclas } = cabecalho(9, 'Movimentações registradas', [
    escopoTexto(s),
    `Dados de ${dataBr(s.instante)} (São Paulo). Eventos confirmados no aplicativo, mais recentes primeiro; cada evento aparece uma vez pelo seu ID (movimento de palete misto não se repete por nota).`,
    truncado
      ? `Histórico reduzido por tamanho: mostrando os ${String(s.eventos.length)} eventos mais recentes de ${String(s.eventosTotal)} (de ${dataBr(maisAntigo)} a ${dataBr(maisRecente)}). O histórico completo continua no aplicativo e nos backups; versões anteriores desta planilha ficam na pasta "versoes" do destino.`
      : `Histórico completo: ${String(s.eventosTotal)} evento(s)${maisAntigo ? ` de ${dataBr(maisAntigo)} a ${dataBr(maisRecente)}` : ''}. Correções preservam o evento anterior e aparecem como um novo evento.`,
  ]);
  linhas.push({ numero: LINHA_CABECALHO_MOVIMENTOS, altura: 34, celulas: COLUNAS_MOVIMENTOS.map((t, i) => cab(i + 1, t, i === COLUNAS_MOVIMENTOS.length - 1)) });
  s.eventos.forEach((e, i) => {
    const t = (v: string | null): string | null => (v === null || v === '' ? null : v);
    linhas.push({
      numero: LINHA_CABECALHO_MOVIMENTOS + 1 + i,
      celulas: [
        { col: 1, valor: e.em, estilo: zebra(i, { borda: 'leve', formato: 'dataHora', horizontal: 'esquerda' }) },
        { col: 2, valor: e.id, estilo: zebra(i, DADO) },
        { col: 3, valor: e.alteracao, estilo: zebra(i, DADO) },
        { col: 4, valor: t(e.nfd), estilo: zebra(i, DADO) },
        { col: 5, valor: t(e.palete), estilo: zebra(i, DADO) },
        { col: 6, valor: t(e.origem), estilo: zebra(i, DADO) },
        { col: 7, valor: t(e.destino), estilo: zebra(i, DADO) },
        { col: 8, valor: t(e.responsavel), estilo: zebra(i, DADO) },
        { col: 9, valor: e.descricao, estilo: zebra(i, { ...DADO, quebra: true }) },
      ],
    });
  });
  const ultima = LINHA_CABECALHO_MOVIMENTOS + Math.max(s.eventos.length, 1);
  if (s.eventos.length === 0) {
    linhas.push({ numero: ultima + 2, celulas: [{ col: 1, valor: 'Nenhum evento operacional registrado neste escopo (consulta concluída; não é falha).', estilo: { fonte: 'aviso' } }] });
    mesclas.push(`B${String(ultima + 2)}:J${String(ultima + 2)}`);
  }
  return {
    nome: 'Movimentações',
    larguras: [2.5, 17, 38, 24, 12, 13, 18, 18, 26, 54],
    linhas,
    mesclas,
    fixar: { colunas: 3, linhas: LINHA_CABECALHO_MOVIMENTOS },
    tabela: { nome: TABELA_MOVIMENTOS, coluna: 1, linhaCabecalho: LINHA_CABECALHO_MOVIMENTOS, ultimaLinha: ultima, colunas: COLUNAS_MOVIMENTOS },
  };
}

function folhaProtecao(s: SnapshotPlanilha, versao: number, config: ConfigPlanilha): Folha {
  const { linhas, mesclas } = cabecalho(4, 'Proteção dos dados e ajuda', [
    escopoTexto(s),
    `Dados de ${dataBr(s.instante)} (São Paulo) · versão ${String(versao)}. Esta aba mostra a situação registrada até esse horário; durante uma falha ela pode ficar desatualizada — a tela "Planilha e proteção" do aplicativo mostra a situação atual.`,
    'Se o aplicativo ficar indisponível, consulte a última planilha publicada (veja "Onde consultar"). A recuperação do sistema é feita pelo backup completo, nunca por esta planilha.',
  ]);
  const destino = config.destino;
  const falhas = s.controle.falhasSeguidas;
  const itens: { recurso: string; estado: string; sucesso: Date | null; detalhe: string }[] = [
    { recurso: 'Esta planilha', estado: `Versão ${String(versao)}`, sucesso: s.instante, detalhe: `Gerada a partir dos dados de ${dataBr(s.instante)}; inclui ${String(s.pendentes.quantidade)} alteração(ões) confirmada(s) desde a versão anterior.` },
    destino === null
      ? { recurso: 'Planilha no destino independente', estado: 'Não configurado', sucesso: null, detalhe: 'Destino independente não configurado: este arquivo é uma cópia gerada no servidor do aplicativo e não fica disponível se o servidor parar.' }
      : {
          recurso: 'Planilha no destino independente',
          estado: falhas > 0 ? 'Falhou' : 'Atualizada',
          sucesso: s.ultimaPublicada?.concluidoEm ?? null,
          detalhe:
            falhas > 0
              ? `${String(falhas)} tentativa(s) anterior(es) falharam (última em ${dataBr(s.controle.ultimaFalhaEm)}: ${s.controle.ultimaFalha ?? ''}). Esta versão foi gerada para nova tentativa; o arquivo no destino só muda depois de validado.`
              : `Publicada somente depois de validada; última publicação concluída antes desta: ${dataBr(s.ultimaPublicada?.concluidoEm ?? null)}.`,
        },
    {
      recurso: 'Alterações aguardando sincronização',
      estado: falhas > 0 ? 'Falhou' : destino === null ? 'Não configurado' : 'Atualizada',
      sucesso: null,
      detalhe: `${String(s.pendentes.quantidade)} marcação(ões) incluídas nesta versão${s.pendentes.desde ? ` (a mais antiga de ${dataBr(s.pendentes.desde)})` : ''}; falhas seguidas antes desta versão: ${String(falhas)}.`,
    },
    destino === null
      ? { recurso: 'Versão anterior preservada', estado: 'Não configurado', sucesso: null, detalhe: 'Sem destino independente não há pasta de versões anteriores.' }
      : {
          recurso: 'Versão anterior preservada',
          estado: s.ultimaPublicada ? 'Atualizada' : 'Não configurado',
          sucesso: s.ultimaPublicada?.concluidoEm ?? null,
          detalhe: s.ultimaPublicada
            ? `Versão ${String(s.ultimaPublicada.versao)} (dados de ${dataBr(s.ultimaPublicada.instanteSnapshot)}) é guardada na pasta "versoes" ao publicar esta; até ${String(config.versoesManter)} versões mantidas.`
            : 'Ainda não há versão anterior publicada.',
        },
    ((x) => ({ recurso: x.recurso, estado: x.estado, sucesso: x.ultimoSucesso, detalhe: x.detalhe }))(estadoBackup(config, s.ultimoBackupVerificado, s.ultimoBackup, s.instante)),
    ((x) => ({ recurso: x.recurso, estado: x.estado, sucesso: x.ultimoSucesso, detalhe: x.detalhe }))(estadoRestauracao(config, s.ultimoTesteRestauracao, s.instante)),
    {
      recurso: 'Onde consultar as cópias',
      estado: destino === null ? 'Não configurado' : 'Atualizada',
      sucesso: null,
      detalhe: `${destino === null ? 'Planilha: sem destino independente configurado.' : `Planilha: ${destino.descricao} (acesso restrito a quem pode ver o arquivo completo).`} Backup: ${config.backup.destinoDescricao ?? 'destino não configurado'}${config.backup.responsavel ? ` · responsável: ${config.backup.responsavel}` : ''}.`,
    },
  ];
  linhas.push({ numero: 9, altura: 30, celulas: ['Recurso', 'Situação', 'Último sucesso', 'Detalhe / onde consultar'].map((t, i) => cab(i + 1, t, i === 3)) });
  itens.forEach((it, i) => {
    const fundo = (FUNDO_ESTADO as Readonly<Record<string, Fundo | undefined>>)[it.estado] ?? 'cinzaClaro';
    linhas.push({
      numero: 10 + i,
      altura: 45,
      celulas: [
        { col: 1, valor: it.recurso, estilo: { ...DADO, fonte: 'negrito', quebra: true } },
        { col: 2, valor: it.estado, estilo: { ...DADO, fonte: 'negrito', fundo, quebra: true } },
        { col: 3, valor: it.sucesso, estilo: { borda: 'leve', formato: 'dataHora', horizontal: 'esquerda' } },
        { col: 4, valor: it.detalhe, estilo: { ...DADO, quebra: true } },
      ],
    });
  });
  let n = 10 + itens.length + 1;
  const titulo = (t: string) => {
    linhas.push({ numero: n, altura: 22, celulas: [{ col: 1, valor: t, estilo: { fonte: 'subtitulo', borda: 'detalhe' } }, ...[2, 3, 4].map((c) => ({ col: c, valor: null, estilo: { borda: 'detalhe' as const } }))] });
    mesclas.push(`B${String(n)}:E${String(n)}`);
    n += 1;
  };
  titulo('Como consultar');
  for (const passo of [
    '1. Abra Inventário e filtre pela NFD, pelo Delivery ou pelo endereço completo.',
    '2. Consulte Movimentações para ver o que mudou, quando e por quem.',
    '3. Confira o horário "Dados de" antes de usar a cópia durante uma indisponibilidade do aplicativo.',
    '4. Para recuperar o sistema, peça ao responsável técnico a restauração pelo backup completo.',
  ]) {
    linhas.push({ numero: n, altura: 20, celulas: [{ col: 1, valor: passo, estilo: { quebra: true } }] });
    mesclas.push(`B${String(n)}:E${String(n)}`);
    n += 1;
  }
  n += 1;
  titulo('Termos da operação');
  const termos: [string, string][] = [
    ['NFD', 'Número da nota fiscal de devolução. O mesmo número em outro contexto (outro Delivery ou remetente) não é unido automaticamente.'],
    ['Delivery', 'Código que identifica a entrega no inventário de origem. Mantido como texto, com zeros à esquerda.'],
    ['Endereço', 'Local físico completo, como 13 - A103 (fileira + código). Diferente do ID do palete e do antigo "N° Pallet" da planilha de origem.'],
    ['ID do palete', 'Identificação permanente do palete no aplicativo (código PR-…), nunca reutilizada.'],
    ['Volumes', 'Caixas/volumes informados para a nota naquele palete. Em branco = informação pendente, não zero.'],
    ['Palete full', 'Palete inteiro com uma única nota. Não quer dizer que a nota ocupa só um palete.'],
    ['Mais de um palete', 'A mesma nota foi identificada em mais de um palete (ou o inventário declara mais de um).'],
    ['Informação pendente', 'Dado ainda não informado ou a confirmar (por exemplo, volumes ou tipo do documento).'],
    ['Cópia anterior', 'Versão preservada da planilha, com data e número, para consultar outro momento.'],
    ['Backup completo', 'Cópia própria do banco e anexos para restaurar o sistema. Esta planilha não é backup.'],
  ];
  for (const [termo, explicacao] of termos) {
    linhas.push({ numero: n, altura: 30, celulas: [{ col: 1, valor: termo, estilo: { fonte: 'negrito', fundo: 'cinzaClaro', borda: 'leve' } }, { col: 2, valor: explicacao, estilo: { borda: 'leve', quebra: true } }] });
    mesclas.push(`C${String(n)}:E${String(n)}`);
    n += 1;
  }
  return {
    nome: 'Proteção e ajuda',
    larguras: [2.5, 30, 24, 20, 80],
    linhas,
    mesclas,
    tabela: { nome: TABELA_PROTECAO, coluna: 1, linhaCabecalho: 9, ultimaLinha: 9 + itens.length, colunas: ['Recurso', 'Situação', 'Último sucesso', 'Detalhe / onde consultar'] },
  };
}

export function montarPlanilha(s: SnapshotPlanilha, versao: number, config: ConfigPlanilha): { buffer: Buffer; folhas: Folha[] } {
  const folhas = [folhaInventario(s, versao), folhaMovimentos(s), folhaProtecao(s, versao, config)];
  return { buffer: escreverPlanilha(folhas, `Praça Reversa — ${s.escopo.unidade} · ${s.escopo.cliente}`), folhas };
}
