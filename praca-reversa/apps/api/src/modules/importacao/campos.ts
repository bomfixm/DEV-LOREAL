/**
 * Limites da importação (configuráveis por ambiente) e sugestão de mapeamento
 * pelo texto dos cabeçalhos. A sugestão só preenche a tela: quem importa
 * confirma as colunas antes de gerar a prévia.
 */
import { camposDoTipo, type LimitesImportacao, type TipoImportacao } from '@praca-reversa/contracts';

const MB = 1_048_576;

export const LIMITES_IMPORTACAO_PADRAO: LimitesImportacao = {
  maxBytes: 5 * MB,
  maxRows: 5_000,
  maxColumns: 50,
  maxCellChars: 1_000,
  maxUncompressedBytes: 50 * MB,
  maxZipEntries: 300,
  maxProcessingMs: 20_000,
};

/**
 * Inventário conferido e seleção do cliente: planilhas operacionais com abas
 * dimensionadas até a linha 1.048.576 (só formatação) e dezenas de MB de XML.
 * Células vazias são puladas na leitura; os limites continuam no servidor.
 */
export const LIMITES_PLANILHA_PADRAO: LimitesImportacao = {
  maxBytes: 40 * MB,
  maxRows: 10_000,
  maxColumns: 50,
  maxCellChars: 1_000,
  maxUncompressedBytes: 320 * MB,
  maxZipEntries: 300,
  maxProcessingMs: 120_000,
};

/** Linhas máximas de uma exportação da busca (CSV). */
export const LIMITE_EXPORTACAO_PADRAO = 5_000;

function normalizarCabecalho(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Textos de cabeçalho reconhecidos por campo (comparação sem acentos, maiúsculas nem pontuação). */
const SINONIMOS: Readonly<Record<string, readonly string[]>> = {
  sku: ['sku', 'codigo do produto', 'cod produto', 'codigo produto', 'produto sku', 'material'],
  description: ['descricao', 'descricao do produto', 'nome do produto', 'produto', 'nome'],
  canonicalUnit: ['unidade canonica', 'unidade', 'unidade de medida', 'um', 'un medida'],
  barcode: ['codigo de barras', 'cod barras', 'codigo barras', 'ean', 'gtin', 'dun', 'ean dun'],
  packaging: ['embalagem', 'embalagem do codigo', 'unidade do codigo', 'unidade da embalagem'],
  factor: ['fator', 'fator de conversao', 'fator conversao', 'quantidade por embalagem', 'qtd por embalagem'],
  returnReference: ['referencia da devolucao', 'devolucao', 'referencia devolucao', 'numero da devolucao', 'n devolucao', 'documento', 'referencia'],
  lineReference: ['linha', 'linha item do documento', 'linha do documento', 'item', 'item do documento', 'item da devolucao', 'linha da devolucao'],
  quantity: ['quantidade declarada', 'quantidade', 'qtd', 'qtde', 'qtd declarada'],
  unit: ['unidade declarada', 'unidade', 'un', 'unidade de medida', 'um'],
  invoice: ['nf', 'nota fiscal', 'numero da nf', 'n nf', 'nfe', 'numero nota fiscal'],
  lot: ['lote', 'numero do lote', 'lote do produto'],
  documentDate: ['data do documento', 'data', 'data de emissao', 'emissao', 'data da devolucao'],
  // Lista de claims (etapa 07).
  externalReference: ['referencia do claim', 'claim', 'numero do claim', 'n claim', 'referencia externa', 'id do claim', 'protocolo'],
  lineRef: ['linha do claim', 'linha', 'item', 'item do claim'],
  reason: ['motivo', 'motivo do claim', 'tipo do claim', 'tipo de ocorrencia'],
  lotRequired: ['lote exigido', 'exige lote'],
  originType: ['tipo da origem', 'tipo de origem', 'tipo do documento de origem'],
  originReference: ['referencia da origem', 'origem', 'devolucao de origem', 'devolucao', 'documento de origem'],
  originLine: ['linha da origem', 'item da origem', 'linha da devolucao', 'item da devolucao'],
  openedOn: ['data de abertura', 'abertura', 'data do claim'],
  occurredOn: ['data da ocorrencia', 'ocorrencia'],
  deadline: ['prazo', 'data limite', 'vencimento', 'prazo de resposta'],
  responsible: ['responsavel login', 'responsavel', 'login do responsavel', 'analista'],
  priority: ['prioridade'],
  estimatedValue: ['valor estimado', 'valor', 'valor do claim'],
  valueBase: ['base do valor', 'tipo do valor'],
  currency: ['moeda'],
  valueSource: ['fonte do valor', 'fonte'],
  externalStatus: ['situacao externa', 'status externo', 'status no cliente'],
  chargeReference: ['referencia da cobranca', 'cobranca', 'numero da cobranca'],
  chargeFinalized: ['cobranca finalizada', 'cobranca encerrada'],
  notes: ['observacoes', 'observacao', 'obs'],
  // Inventário conferido e seleção do cliente (complemento): cabeçalhos do modelo operacional.
  address: ['rua', 'endereco', 'rua endereco', 'endereco completo', 'endereco informado rua', 'endereco informado'],
  palletNumber: ['n pallet', 'no pallet', 'n palete', 'numero pallet', 'numero do pallet', 'numero do palete', 'pallet'],
  documentNumber: ['numero', 'nf', 'nota fiscal', 'numero nf', 'numero da nf', 'nf documento', 'nf numero do documento'],
  documentType: ['tipo', 'tipo documento', 'tipo do documento', 'contexto documental', 'tipo contexto do documento'],
  delivery: ['delivery', 'entrega', 'delivery devolucao'],
  volumes: ['volumes', 'volume', 'qtd volumes', 'quantidade de volumes'],
  documentation: ['documentacao', 'situacao documental'],
  palletFull: ['pallet full', 'palete full', 'palete completo'],
  sender: ['remetente'],
  scheduleMonth: ['mes agenda', 'mes da agenda'],
  windowRef: ['janela', 'janela de devolucao'],
  category: ['pf cnpj', 'categoria', 'pf ou cnpj'],
  addressStatus: ['situacao do endereco', 'endereco livre', 'status do endereco', 'situacao do endereco texto'],
  palletCode: ['palete', 'pallet', 'n pallet', 'no pallet', 'n palete', 'codigo do palete', 'palete n pallet ou codigo'],
  inventoryLine: ['linha do inventario', 'referencia do inventario', 'referencia da linha do inventario'],
  mark: ['marcacao', 'selecao', 'selecionado', 'devolver', 'escolha', 'marcacao escolha do cliente'],
  scope: ['abrangencia'],
};

/**
 * Exportação real da bipagem (amostra de 19 out. 2026): Tipo, Número, Lidos,
 * CNPJ Remetente e Remetente, reconhecidos pelo nome (sem acentos, maiúsculas,
 * pontuação nem espaços extras). "Leituras" e "Série" nunca são confundidas
 * com Lidos e Número (comparação do título inteiro, não de partes).
 */
const SINONIMOS_BIPAGEM: Readonly<Record<string, readonly string[]>> = {
  documentType: ['tipo', 'tipo documento', 'tipo do documento', 'tipo de documento', 'tipo doc'],
  documentNumber: ['numero', 'numero do documento', 'numero documento', 'n documento', 'no documento', 'n', 'no', 'numero da nota', 'numero nf', 'documento'],
  readVolumes: ['lidos', 'volumes lidos', 'qtd lidos', 'qtde lidos', 'quantidade lida', 'quantidade de lidos', 'lidas'],
  senderCnpj: ['cnpj remetente', 'cnpj do remetente', 'remetente cnpj', 'cnpj cpf remetente', 'cpf cnpj remetente', 'cnpj'],
  sender: ['remetente', 'nome do remetente', 'remetente nome', 'nome remetente', 'razao social remetente', 'razao social do remetente'],
  lastRead: ['ultima leitura', 'data ultima leitura', 'data da ultima leitura', 'data leitura', 'data da leitura', 'ultima bipagem'],
};

/** Coluna sugerida para cada campo do tipo (igualdade com um sinônimo; cada coluna é usada uma vez). */
export function sugerirColunas(tipo: TipoImportacao, cabecalhos: readonly { indice: number; texto: string }[]): Record<string, number | null> {
  const normalizados = cabecalhos.map((c) => ({ indice: c.indice, texto: normalizarCabecalho(c.texto) }));
  const usadas = new Set<number>();
  const sugestao: Record<string, number | null> = {};
  for (const definicao of camposDoTipo(tipo)) {
    const sinonimos = (tipo === 'BIPAGEM' ? SINONIMOS_BIPAGEM[definicao.campo] : SINONIMOS[definicao.campo]) ?? [];
    let escolhida: number | null = null;
    for (const s of [normalizarCabecalho(definicao.rotulo), ...sinonimos]) {
      const achada = normalizados.find((c) => c.texto === s && !usadas.has(c.indice));
      if (achada) {
        escolhida = achada.indice;
        break;
      }
    }
    if (escolhida !== null) usadas.add(escolhida);
    sugestao[definicao.campo] = escolhida;
  }
  return sugestao;
}
