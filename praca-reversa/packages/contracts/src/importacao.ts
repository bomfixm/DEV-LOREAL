import { z } from 'zod';
import { UsuarioResumoSchema, type Permissao } from './acesso.js';

/**
 * Importação de cadastro de produtos e de documentos de devolução (etapa 06;
 * docs/DADOS-E-REGRAS.md R27 e R28) e de lista de claims (etapa 07). O
 * arquivo é lido e validado no servidor; a prévia classifica cada linha e a
 * confirmação revalida tudo antes de gravar. Importação documental nunca cria
 * recebimento físico, observação de contagem, saldo validado, ocupação de
 * posição nem liberação; a de claims cria só registros de investigação.
 */

/**
 * Complemento "seleção do cliente": INVENTARIO (inventário conferido: vínculos
 * NF × palete × endereço × volumes, sem saldo validado) e SELECAO_CLIENTE
 * (lista selecionada ou inventário com marcação; registra solicitações).
 */
export const TipoImportacaoSchema = z.enum(['PRODUTOS', 'DEVOLUCOES', 'CLAIMS', 'INVENTARIO', 'SELECAO_CLIENTE']);
export type TipoImportacao = z.infer<typeof TipoImportacaoSchema>;
export const TIPOS_IMPORTACAO = TipoImportacaoSchema.options;

export type AcaoImportacao = 'executar' | 'consultar';

/**
 * Permissões por tipo de importação (todas exigidas). Executar = enviar,
 * mapear, confirmar, descartar e baixar modelos; consultar = histórico, linhas
 * e relatório. O arquivo nunca amplia o que o perfil pode fazer.
 */
export const PERMISSOES_IMPORTACAO: Readonly<Record<TipoImportacao, Readonly<Record<AcaoImportacao, readonly Permissao[]>>>> = {
  PRODUTOS: { executar: ['importacao.executar', 'produto.cadastrar'], consultar: ['importacao.consultar'] },
  DEVOLUCOES: { executar: ['importacao.executar'], consultar: ['importacao.consultar'] },
  CLAIMS: { executar: ['claim.consultar', 'claim.tratar'], consultar: ['claim.consultar'] },
  INVENTARIO: { executar: ['importacao.executar', 'inventario.importar', 'palete.cadastrar'], consultar: ['importacao.consultar'] },
  SELECAO_CLIENTE: { executar: ['selecao.consultar', 'selecao.importar'], consultar: ['selecao.consultar'] },
};

/** Tipos que as permissões informadas permitem para a ação. */
export function tiposImportacaoPermitidos(permissoes: Iterable<Permissao>, acao: AcaoImportacao): TipoImportacao[] {
  const conjunto = new Set(permissoes);
  return TIPOS_IMPORTACAO.filter((t) => PERMISSOES_IMPORTACAO[t][acao].every((p) => conjunto.has(p)));
}

/** JSON: pacote preparado de carga em lote, carregado pelo comando local (não pela tela). */
export const FormatoArquivoSchema = z.enum(['CSV', 'XLSX', 'JSON']);
export type FormatoArquivo = z.infer<typeof FormatoArquivoSchema>;

/**
 * AGUARDANDO_MAPEAMENTO: arquivo recebido, nenhuma prévia gerada.
 * PREVIA: prévia gerada (versão atual em `previewVersion`).
 * CONFIRMADO: gravado; terminal.
 * DESCARTADO: abandonado por quem importa; terminal, nada gravado.
 */
export const SituacaoImportacaoSchema = z.enum(['AGUARDANDO_MAPEAMENTO', 'PREVIA', 'CONFIRMADO', 'DESCARTADO']);
export type SituacaoImportacao = z.infer<typeof SituacaoImportacaoSchema>;
export const SITUACOES_IMPORTACAO = SituacaoImportacaoSchema.options;

/** EXCLUIDA: fora da seleção pela regra de marcação (visível, registrada, não importada). */
export const ClassificacaoLinhaSchema = z.enum(['VALIDA_NOVA', 'DUPLICADA', 'INVALIDA', 'CONFLITANTE', 'EXCLUIDA']);
export type ClassificacaoLinha = z.infer<typeof ClassificacaoLinhaSchema>;
export const CLASSIFICACOES_LINHA = ClassificacaoLinhaSchema.options;

export const ResultadoLinhaSchema = z.enum(['GRAVADA', 'IGNORADA_DUPLICADA']);
export type ResultadoLinha = z.infer<typeof ResultadoLinhaSchema>;

// ---------- Campos ----------

export const CampoProdutoSchema = z.enum(['sku', 'description', 'canonicalUnit', 'barcode', 'packaging', 'factor']);
export const CampoDevolucaoSchema = z.enum(['returnReference', 'lineReference', 'sku', 'quantity', 'unit', 'invoice', 'lot', 'documentDate']);
export const CampoClaimSchema = z.enum([
  'externalReference',
  'lineRef',
  'reason',
  'sku',
  'quantity',
  'unit',
  'description',
  'lot',
  'lotRequired',
  'originType',
  'originReference',
  'originLine',
  'openedOn',
  'occurredOn',
  'deadline',
  'responsible',
  'priority',
  'estimatedValue',
  'valueBase',
  'currency',
  'valueSource',
  'externalStatus',
  'chargeReference',
  'chargeFinalized',
  'notes',
]);
export const CampoInventarioSchema = z.enum([
  'delivery',
  'documentType',
  'documentNumber',
  'volumes',
  'sender',
  'scheduleMonth',
  'windowRef',
  'address',
  'palletNumber',
  'documentation',
  'palletFull',
  'category',
  'addressStatus',
]);
export const CampoSelecaoSchema = z.enum([
  'inventoryLine',
  'windowRef',
  'palletCode',
  'documentType',
  'documentNumber',
  'delivery',
  'lineRef',
  'sku',
  'lot',
  'quantity',
  'unit',
  'mark',
  'scope',
  'address',
  'notes',
]);
export type CampoImportacao =
  | z.infer<typeof CampoProdutoSchema>
  | z.infer<typeof CampoDevolucaoSchema>
  | z.infer<typeof CampoClaimSchema>
  | z.infer<typeof CampoInventarioSchema>
  | z.infer<typeof CampoSelecaoSchema>;

export interface DefinicaoCampo {
  campo: CampoImportacao;
  rotulo: string;
  obrigatorio: boolean;
  /** Identificador textual: zeros à esquerda preservados; número na planilha vira pendência. */
  identificador: boolean;
  ajuda: string;
}

/** Campos aceitos por tipo, na ordem dos modelos (README e modelos CSV/XLSX). */
export const CAMPOS_IMPORTACAO: Readonly<Record<TipoImportacao, readonly DefinicaoCampo[]>> = {
  PRODUTOS: [
    { campo: 'sku', rotulo: 'SKU', obrigatorio: true, identificador: true, ajuda: 'Texto; zeros à esquerda são preservados. Identidade do produto no escopo.' },
    { campo: 'description', rotulo: 'Descrição', obrigatorio: true, identificador: false, ajuda: '2 a 200 caracteres.' },
    { campo: 'canonicalUnit', rotulo: 'Unidade canônica', obrigatorio: true, identificador: false, ajuda: 'UN, CX, KG…; produtos em UN são contados em peças inteiras.' },
    { campo: 'barcode', rotulo: 'Código de barras', obrigatorio: false, identificador: true, ajuda: 'Texto, sem espaços; um código por linha (repita o SKU para outros códigos).' },
    { campo: 'packaging', rotulo: 'Embalagem do código', obrigatorio: false, identificador: false, ajuda: 'Obrigatória quando há código de barras (ex.: UN ou CX).' },
    {
      campo: 'factor',
      rotulo: 'Fator',
      obrigatorio: false,
      identificador: false,
      ajuda: 'Unidades canônicas por embalagem, aprovado. Vazio = fator pendente (código reconhecido, conversão bloqueada). Embalagem igual à unidade canônica: 1.',
    },
  ],
  DEVOLUCOES: [
    { campo: 'returnReference', rotulo: 'Referência da devolução', obrigatorio: true, identificador: true, ajuda: 'Texto; identifica o documento de devolução.' },
    {
      campo: 'lineReference',
      rotulo: 'Linha/item do documento',
      obrigatorio: true,
      identificador: true,
      ajuda: 'Texto ou número inteiro; com a referência da devolução, identifica a linha. Só dígitos: comparada sem zeros à esquerda.',
    },
    { campo: 'sku', rotulo: 'SKU', obrigatorio: true, identificador: true, ajuda: 'Precisa estar cadastrado e ativo no escopo.' },
    { campo: 'quantity', rotulo: 'Quantidade declarada', obrigatorio: true, identificador: false, ajuda: 'Maior que zero, até 3 casas decimais; separador decimal escolhido na prévia; sem separador de milhar.' },
    { campo: 'unit', rotulo: 'Unidade declarada', obrigatorio: true, identificador: false, ajuda: 'Unidade canônica do produto ou embalagem cadastrada com fator aprovado.' },
    { campo: 'invoice', rotulo: 'NF', obrigatorio: false, identificador: true, ajuda: 'Número da nota fiscal como texto. Vazio = pendente.' },
    { campo: 'lot', rotulo: 'Lote', obrigatorio: false, identificador: true, ajuda: 'Vazio = lote pendente (nunca inventado).' },
    { campo: 'documentDate', rotulo: 'Data do documento', obrigatorio: false, identificador: false, ajuda: 'DD/MM/AAAA ou AAAA-MM-DD; no XLSX, célula de data. Vazio = pendente.' },
  ],
  CLAIMS: [
    {
      campo: 'externalReference',
      rotulo: 'Referência do claim',
      obrigatorio: true,
      identificador: true,
      ajuda: 'Texto; identifica o caso no escopo (com a linha). Linhas com a mesma referência formam um caso. SKU sozinho não identifica um claim.',
    },
    {
      campo: 'lineRef',
      rotulo: 'Linha do claim',
      obrigatorio: true,
      identificador: true,
      ajuda: 'Texto ou número inteiro; identidade da linha dentro do caso. Só dígitos: comparada sem zeros à esquerda. Sem ela a linha não é identificada (nenhuma identidade é gerada).',
    },
    { campo: 'reason', rotulo: 'Motivo', obrigatorio: true, identificador: false, ajuda: 'FALTA (ou EXTRAVIO), AVARIA ou DIVERGENCIA DOCUMENTAL. Outros motivos só por configuração documentada.' },
    { campo: 'sku', rotulo: 'SKU', obrigatorio: true, identificador: true, ajuda: 'Texto. SKU fora do cadastro fica como pendência de triagem (não bloqueia a importação).' },
    { campo: 'quantity', rotulo: 'Quantidade em análise', obrigatorio: true, identificador: false, ajuda: 'Maior que zero, até 3 casas decimais; separador decimal escolhido na prévia; sem milhar.' },
    { campo: 'unit', rotulo: 'Unidade', obrigatorio: true, identificador: false, ajuda: 'UN, CX…; diferente da unidade canônica do produto fica como pendência (nenhuma conversão é presumida).' },
    { campo: 'description', rotulo: 'Descrição do produto', obrigatorio: false, identificador: false, ajuda: 'Texto livre, até 200 caracteres.' },
    { campo: 'lot', rotulo: 'Lote', obrigatorio: false, identificador: true, ajuda: 'Vazio = lote não informado (nunca inventado).' },
    { campo: 'lotRequired', rotulo: 'Lote exigido', obrigatorio: false, identificador: false, ajuda: 'SIM ou NAO (vazio = NAO). SIM: a validação exige o mesmo lote ou tratativa documentada.' },
    { campo: 'originType', rotulo: 'Tipo da origem', obrigatorio: false, identificador: false, ajuda: 'DEVOLUCAO, NOTA_FISCAL, MANIFESTO ou OUTRO. Obrigatório quando há referência de origem.' },
    { campo: 'originReference', rotulo: 'Referência da origem', obrigatorio: false, identificador: true, ajuda: 'Devolução/documento de origem como texto. Vazio = origem pendente.' },
    { campo: 'originLine', rotulo: 'Linha da origem', obrigatorio: false, identificador: true, ajuda: 'Linha/item no documento de origem, quando conhecida.' },
    { campo: 'openedOn', rotulo: 'Data de abertura', obrigatorio: false, identificador: false, ajuda: 'DD/MM/AAAA ou AAAA-MM-DD. Vazio = não informada.' },
    { campo: 'occurredOn', rotulo: 'Data da ocorrência', obrigatorio: false, identificador: false, ajuda: 'DD/MM/AAAA ou AAAA-MM-DD. Vazio = não informada.' },
    { campo: 'deadline', rotulo: 'Prazo', obrigatorio: false, identificador: false, ajuda: 'DD/MM/AAAA ou AAAA-MM-DD. Vazio = prazo não informado (nenhum prazo é calculado).' },
    { campo: 'responsible', rotulo: 'Responsável (login)', obrigatorio: false, identificador: true, ajuda: 'Login de usuário ativo do escopo com acesso para tratar claims. Vazio = sem responsável.' },
    { campo: 'priority', rotulo: 'Prioridade', obrigatorio: false, identificador: false, ajuda: 'URGENTE, ALTA, NORMAL ou BAIXA. Vazio = não definida.' },
    {
      campo: 'estimatedValue',
      rotulo: 'Valor estimado',
      obrigatorio: false,
      identificador: false,
      ajuda: 'Até 2 casas decimais, mesmo separador decimal da prévia, sem milhar nem símbolo de moeda. Exige base, moeda e fonte.',
    },
    { campo: 'valueBase', rotulo: 'Base do valor', obrigatorio: false, identificador: false, ajuda: 'TOTAL (total da linha, nunca multiplicado de novo) ou UNITARIO (multiplicado pela quantidade em análise).' },
    { campo: 'currency', rotulo: 'Moeda', obrigatorio: false, identificador: false, ajuda: 'Código de 3 letras (ex.: BRL). Uma moeda por caso.' },
    { campo: 'valueSource', rotulo: 'Fonte do valor', obrigatorio: false, identificador: false, ajuda: 'De onde veio a estimativa (ex.: tabela de preço, portal do cliente).' },
    { campo: 'externalStatus', rotulo: 'Situação externa', obrigatorio: false, identificador: false, ajuda: 'Situação no sistema do cliente, como texto (nada é alterado lá).' },
    { campo: 'chargeReference', rotulo: 'Referência da cobrança', obrigatorio: false, identificador: true, ajuda: 'Cobrança/tratativa no cliente, como texto.' },
    { campo: 'chargeFinalized', rotulo: 'Cobrança finalizada', obrigatorio: false, identificador: false, ajuda: 'SIM ou NAO (vazio = NAO). SIM: resultado só com prova do resultado externo.' },
    { campo: 'notes', rotulo: 'Observações', obrigatorio: false, identificador: false, ajuda: 'Texto livre, até 2000 caracteres.' },
  ],
  INVENTARIO: [
    {
      campo: 'address',
      rotulo: 'RUA (endereço completo)',
      obrigatorio: true,
      identificador: true,
      ajuda: 'Fileira ou GR + código local (ex.: 15 - A120). Espaços/caixa são ajustados por regra registrada; prefixo ausente ou número diferente não é corrigido.',
    },
    {
      campo: 'palletNumber',
      rotulo: 'N° Pallet',
      obrigatorio: true,
      identificador: true,
      ajuda: 'Número de palete informado. Confirme na prévia se identifica o palete ou numera a posição.',
    },
    { campo: 'documentNumber', rotulo: 'NUMERO (NF/documento)', obrigatorio: false, identificador: true, ajuda: 'Número documental como texto. Vazio = linha sem documento.' },
    { campo: 'documentType', rotulo: 'TIPO (contexto documental)', obrigatorio: false, identificador: true, ajuda: 'Ex.: NFD. Não é interpretado como origem/devolução sem definição operacional.' },
    { campo: 'delivery', rotulo: 'DELIVERY', obrigatorio: false, identificador: true, ajuda: 'Referência de entrega/processo, preservada como texto.' },
    {
      campo: 'volumes',
      rotulo: 'VOLUMES',
      obrigatorio: false,
      identificador: false,
      ajuda: 'Quantidade de volumes informada (zero é válido). Não vira unidades de produto, SKU nem saldo validado.',
    },
    { campo: 'documentation', rotulo: 'DOCUMENTAÇÃO', obrigatorio: false, identificador: false, ajuda: 'Situação documental informada; não libera material.' },
    { campo: 'palletFull', rotulo: 'PALLET FULL', obrigatorio: false, identificador: false, ajuda: 'Marcador de composição (ex.: 01\\07), preservado como texto; não cria paletes nem multiplica volumes.' },
    { campo: 'sender', rotulo: 'REMETENTE', obrigatorio: false, identificador: false, ajuda: 'Remetente informado.' },
    { campo: 'scheduleMonth', rotulo: 'MÊS AGENDA', obrigatorio: false, identificador: false, ajuda: 'Mês informado (texto); ano e data não são inventados.' },
    { campo: 'windowRef', rotulo: 'JANELA', obrigatorio: false, identificador: true, ajuda: 'Referência de janela informada (sem vínculo automático com a janela cadastrada).' },
    { campo: 'category', rotulo: 'PF/CNPJ', obrigatorio: false, identificador: false, ajuda: 'Categoria informada.' },
    {
      campo: 'addressStatus',
      rotulo: 'Situação do endereço (texto)',
      obrigatorio: false,
      identificador: false,
      ajuda: 'Equivalente textual da convenção de cor (CSV): os valores que significam "endereço livre" são escolhidos na prévia.',
    },
  ],
  SELECAO_CLIENTE: [
    { campo: 'palletCode', rotulo: 'Palete (N° Pallet ou código)', obrigatorio: false, identificador: true, ajuda: 'Identifica o palete do inventário/registro.' },
    { campo: 'documentNumber', rotulo: 'NF / número do documento', obrigatorio: false, identificador: true, ajuda: 'O significado (documento do inventário, origem da devolução…) é escolhido na prévia.' },
    { campo: 'documentType', rotulo: 'Tipo / contexto do documento', obrigatorio: false, identificador: true, ajuda: 'Ex.: NFD. Números iguais de contextos diferentes não são equivalentes.' },
    { campo: 'delivery', rotulo: 'DELIVERY / devolução', obrigatorio: false, identificador: true, ajuda: 'Referência de entrega/devolução como texto.' },
    { campo: 'inventoryLine', rotulo: 'Referência da linha do inventário', obrigatorio: false, identificador: true, ajuda: 'Linha ou referência do inventário enviado, quando o cliente a devolve.' },
    { campo: 'lineRef', rotulo: 'Linha do pedido', obrigatorio: false, identificador: true, ajuda: 'Identifica a solicitação dentro do pedido.' },
    { campo: 'sku', rotulo: 'SKU', obrigatorio: false, identificador: true, ajuda: 'Produto, quando a solicitação é por linha/produto. SKU sozinho não identifica a origem.' },
    { campo: 'lot', rotulo: 'Lote', obrigatorio: false, identificador: true, ajuda: 'Restrição de lote, quando informada.' },
    { campo: 'quantity', rotulo: 'Quantidade solicitada', obrigatorio: false, identificador: false, ajuda: 'Vazio = não informada (nunca zero). Até 3 casas; exige unidade.' },
    { campo: 'unit', rotulo: 'Unidade', obrigatorio: false, identificador: false, ajuda: 'UN, CX…; sem conversão presumida.' },
    { campo: 'mark', rotulo: 'Marcação (escolha do cliente)', obrigatorio: false, identificador: false, ajuda: 'Inventário com marcação: os valores que significam seleção são escolhidos na prévia.' },
    { campo: 'scope', rotulo: 'Abrangência', obrigatorio: false, identificador: false, ajuda: 'PALETE, NF (ou DOCUMENTO) ou LINHA. Vazio = regra registrada pela identificação da linha.' },
    { campo: 'windowRef', rotulo: 'Janela', obrigatorio: false, identificador: true, ajuda: 'Janela pedida pelo cliente, como texto.' },
    { campo: 'address', rotulo: 'Endereço informado (RUA)', obrigatorio: false, identificador: true, ajuda: 'Endereço que constava no arquivo; o atual vem dos registros.' },
    { campo: 'notes', rotulo: 'Observação', obrigatorio: false, identificador: false, ajuda: 'Texto livre, até 500 caracteres.' },
  ],
};

export function camposDoTipo(tipo: TipoImportacao): readonly DefinicaoCampo[] {
  return CAMPOS_IMPORTACAO[tipo];
}

// ---------- Leitura do arquivo ----------

export const CodificacaoCsvSchema = z.enum(['UTF-8', 'UTF-16LE', 'UTF-16BE', 'WINDOWS-1252']);
export type CodificacaoCsv = z.infer<typeof CodificacaoCsvSchema>;
export const DelimitadorCsvSchema = z.enum(['PONTO_E_VIRGULA', 'VIRGULA', 'TABULACAO', 'BARRA_VERTICAL']);
export type DelimitadorCsv = z.infer<typeof DelimitadorCsvSchema>;
export const CARACTERE_DELIMITADOR: Readonly<Record<DelimitadorCsv, string>> = {
  PONTO_E_VIRGULA: ';',
  VIRGULA: ',',
  TABULACAO: '\t',
  BARRA_VERTICAL: '|',
};
export const SeparadorDecimalSchema = z.enum(['VIRGULA', 'PONTO']);
export type SeparadorDecimal = z.infer<typeof SeparadorDecimalSchema>;

export const LIMITE_LINHA_CABECALHO = 50;

/** Opções de leitura escolhidas na prévia (as não informadas são detectadas e mostradas). */
export const OpcoesLeituraSchema = z.object({
  /** XLSX: nome da planilha (aba). CSV: `null`. */
  sheet: z.string().min(1).max(100).nullable().default(null),
  /** Linha do cabeçalho (1 = primeira linha). */
  headerRow: z.coerce.number().int().min(1).max(LIMITE_LINHA_CABECALHO).default(1),
  /** CSV: codificação; `null` = detectar (BOM ou UTF-8 válido). */
  encoding: CodificacaoCsvSchema.nullable().default(null),
  /** CSV: delimitador; `null` = detectar pelo cabeçalho. */
  delimiter: DelimitadorCsvSchema.nullable().default(null),
});
export type OpcoesLeitura = z.infer<typeof OpcoesLeituraSchema>;

/** Consulta da estrutura com outras opções (GET /importacoes/:id/estrutura). */
export const ConsultaEstruturaSchema = z.object({
  sheet: z.string().min(1).max(100).optional(),
  headerRow: z.coerce.number().int().min(1).max(LIMITE_LINHA_CABECALHO).optional(),
  encoding: CodificacaoCsvSchema.optional(),
  delimiter: DelimitadorCsvSchema.optional(),
});
export type ConsultaEstrutura = z.infer<typeof ConsultaEstruturaSchema>;

export const TipoCelulaSchema = z.enum(['TEXTO', 'NUMERO', 'DATA', 'BOOLEANO', 'FORMULA', 'ERRO', 'VAZIO']);
export type TipoCelula = z.infer<typeof TipoCelulaSchema>;

export const CelulaAmostraSchema = z.object({ text: z.string().nullable(), kind: TipoCelulaSchema });

/** Estrutura lida no servidor: planilhas, cabeçalhos, amostra e interpretação aplicada. */
export const EstruturaArquivoSchema = z.object({
  format: FormatoArquivoSchema,
  /** XLSX: abas da pasta de trabalho; `rows` só para a aba lida (as demais não são processadas). */
  sheets: z.array(z.object({ name: z.string(), hidden: z.boolean(), rows: z.number().int().nonnegative().nullable() })),
  options: z.object({
    sheet: z.string().nullable(),
    headerRow: z.number().int().positive(),
    encoding: CodificacaoCsvSchema.nullable(),
    delimiter: DelimitadorCsvSchema.nullable(),
  }),
  /** Como o arquivo foi interpretado (codificação, BOM, delimitador, aspas, sistema de datas…). */
  interpretation: z.array(z.string()),
  headers: z.array(z.object({ index: z.number().int().nonnegative(), letter: z.string(), text: z.string() })),
  sample: z.array(z.object({ row: z.number().int().positive(), cells: z.array(CelulaAmostraSchema) })),
  /** Linhas não vazias depois do cabeçalho. */
  dataRows: z.number().int().nonnegative(),
  emptyRows: z.number().int().nonnegative(),
  /** Sugestão de mapeamento pelo texto dos cabeçalhos (sempre confirmada por quem importa). */
  suggestedColumns: z.record(z.string(), z.number().int().nonnegative().nullable()),
  warnings: z.array(z.string()),
  /**
   * XLSX: cores de fonte gravadas diretamente nas células de dados, por coluna
   * (ARGB, ex.: FF00B050). Formatação condicional não é avaliada. Uma cor só
   * ganha significado quando quem importa a escolhe para uma convenção.
   */
  fontColors: z
    .array(z.object({ index: z.number().int().nonnegative(), colors: z.array(z.object({ color: z.string().min(1), cells: z.number().int().positive() })) }))
    .default([]),
});
export type EstruturaArquivo = z.infer<typeof EstruturaArquivoSchema>;

// ---------- Parâmetros por tipo (complemento: seleção do cliente) ----------

/**
 * Significado do N° Pallet: identidade do palete, numeração da posição ou
 * referência externa ainda sem significado confirmado (carga em lote: guardada
 * à parte, nunca usada como ID; a identidade vem do endereço completo).
 */
export const SignificadoNumeroPaleteSchema = z.enum(['IDENTIFICADOR_PALETE', 'NUMERACAO_POSICAO', 'REFERENCIA_EXTERNA']);
export type SignificadoNumeroPalete = z.infer<typeof SignificadoNumeroPaleteSchema>;

const textoParametro = (maximo: number) => z.string().trim().min(1).max(maximo).regex(/^[^\p{Cc}]*$/u, 'Caracteres inválidos.');
const CorArgbSchema = z.string().trim().toUpperCase().regex(/^[0-9A-F]{8}$/, 'Cor no formato ARGB (8 dígitos hexadecimais, ex.: FF00B050).');

/**
 * Definição operacional de um tipo documental do inventário (ex.: NFD), usada
 * para relacionar o documento à origem dos segmentos de estoque. Sem definição,
 * nenhuma equivalência é presumida pela sigla.
 */
export const DefinicaoTipoDocumentoSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20),
  meaning: textoParametro(200),
  originType: z.enum(['DEVOLUCAO', 'NOTA_FISCAL', 'MANIFESTO', 'OUTRO']),
});
export type DefinicaoTipoDocumento = z.infer<typeof DefinicaoTipoDocumentoSchema>;

/** Parâmetros da importação do inventário conferido. */
export const ParametrosInventarioSchema = z.object({
  /** Identificação da versão (ex.: "definitivo conferido em 28/09"). */
  description: textoParametro(200),
  /** Quem importa confirma que este é o arquivo identificado pela operação como definitivo. */
  definitive: z.boolean().default(false),
  countReference: textoParametro(120),
  /** Data da conferência informada (AAAA-MM-DD); nunca presumida pelo envio ou pelo nome da aba. */
  countDate: z.iso.date().nullable().default(null),
  countSource: textoParametro(200).nullable().default(null),
  /** `null` = ainda não confirmado (a prévia mostra; a confirmação exige a escolha). */
  palletNumberMeaning: SignificadoNumeroPaleteSchema.nullable().default(null),
  /** Cores de fonte da coluna RUA que significam "endereço livre" (convenção vigente). */
  freeAddressFontColors: z.array(CorArgbSchema).max(10).default([]),
  /** Valores da coluna "Situação do endereço" que significam "endereço livre" (CSV). */
  freeAddressValues: z.array(textoParametro(40)).max(20).default([]),
  documentTypes: z.array(DefinicaoTipoDocumentoSchema).max(20).default([]),
  /** Versão anterior deste inventário (revisão com diferenças). */
  replacesInventoryId: z.uuid().nullable().default(null),
  /** Reapresentação corrigida das pendências de um inventário já importado. */
  complementsInventoryId: z.uuid().nullable().default(null),
});
export type ParametrosInventario = z.output<typeof ParametrosInventarioSchema>;

export const ModalidadeSelecaoSchema = z.enum(['LISTA', 'MARCACAO']);
export type ModalidadeSelecao = z.infer<typeof ModalidadeSelecaoSchema>;

/**
 * Significado da coluna de NF da seleção: o documento como aparece no
 * inventário (TIPO + NUMERO), a origem da devolução nos registros de estoque ou
 * outra referência (só comparada como texto, sem equivalência presumida).
 */
export const ContextoDocumentoSelecaoSchema = z.enum(['DOCUMENTO_INVENTARIO', 'ORIGEM_DEVOLUCAO', 'OUTRA_REFERENCIA']);
export type ContextoDocumentoSelecao = z.infer<typeof ContextoDocumentoSelecaoSchema>;

/** Parâmetros da importação da seleção do cliente. */
export const ParametrosSelecaoSchema = z.object({
  mode: ModalidadeSelecaoSchema,
  /** Inventário com marcação: valores que significam seleção (comparados sem diferenciar maiúsculas). */
  markValues: z.array(textoParametro(40)).max(20).default([]),
  orderReference: textoParametro(80),
  orderVersionLabel: textoParametro(40).nullable().default(null),
  inventoryId: z.uuid().nullable().default(null),
  documentContext: ContextoDocumentoSelecaoSchema,
  /** Tipo documental quando a coluna não existe (explícito; nunca deduzido). */
  defaultDocumentType: z.string().trim().toUpperCase().min(1).max(20).nullable().default(null),
  /** NF sem quantidade: todo o material dela no inventário (configurado) ou pendente. */
  documentWithoutQuantity: z.enum(['TODO_MATERIAL_DO_INVENTARIO', 'PENDENTE']).default('PENDENTE'),
  /** Linhas repetidas: agrupar as idênticas (sem somar) ou manter separadas; `null` = decidir na prévia. */
  duplicates: z.enum(['AGRUPAR_IDENTICAS', 'MANTER_SEPARADAS']).nullable().default(null),
  /** Versão anterior da mesma solicitação (substituição rastreada). */
  replacesSelectionId: z.uuid().nullable().default(null),
});
export type ParametrosSelecao = z.output<typeof ParametrosSelecaoSchema>;

/** PUT /importacoes/:id/mapeamento — gera nova prévia (a anterior deixa de valer). */
export const MapeamentoSchema = z.object({
  /** Versão do lote vista por quem mapeia. */
  expectedVersion: z.number().int().positive(),
  options: OpcoesLeituraSchema,
  decimalSeparator: SeparadorDecimalSchema,
  /** Campo → índice da coluna (0 = primeira); `null` ou ausente = não mapeado. */
  columns: z.record(z.string(), z.number().int().min(0).max(999).nullable()),
  /** Parâmetros do tipo (inventário e seleção), validados no servidor pelo esquema do tipo. */
  parameters: z.record(z.string(), z.json()).nullable().default(null),
});
export type Mapeamento = z.input<typeof MapeamentoSchema>;

/** Verifica campos conhecidos, obrigatórios e colunas repetidas. Lista vazia = coerente. */
export function verificarMapeamento(tipo: TipoImportacao, colunas: Readonly<Record<string, number | null>>): string[] {
  const problemas: string[] = [];
  const definicoes = camposDoTipo(tipo);
  const conhecidos = new Set<string>(definicoes.map((d) => d.campo));
  for (const campo of Object.keys(colunas)) if (!conhecidos.has(campo)) problemas.push(`Campo desconhecido para este tipo: ${campo}.`);
  for (const d of definicoes) {
    if (d.obrigatorio && (colunas[d.campo] === undefined || colunas[d.campo] === null)) problemas.push(`Escolha a coluna de "${d.rotulo}" (obrigatório).`);
  }
  const usadas = new Map<number, string>();
  for (const d of definicoes) {
    const coluna = colunas[d.campo];
    if (coluna === undefined || coluna === null) continue;
    const outro = usadas.get(coluna);
    if (outro !== undefined) problemas.push(`A mesma coluna foi escolhida para "${outro}" e "${d.rotulo}".`);
    usadas.set(coluna, d.rotulo);
  }
  return problemas;
}

// ---------- Prévia, lote e linhas ----------

export const MotivoLinhaSchema = z.object({ code: z.string().min(1), field: z.string().nullable(), message: z.string().min(1) });
export type MotivoLinha = z.infer<typeof MotivoLinhaSchema>;

export const ContadoresImportacaoSchema = z.object({
  total: z.number().int().nonnegative(),
  empty: z.number().int().nonnegative(),
  validNew: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  conflicting: z.number().int().nonnegative(),
  /** Seleção por marcação: linhas fora da seleção (visíveis, não importadas). */
  excluded: z.number().int().nonnegative().default(0),
  /** Depois da confirmação: linhas gravadas e duplicatas ignoradas. */
  written: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
});
export type ContadoresImportacao = z.infer<typeof ContadoresImportacaoSchema>;

export const ResultadoGravacaoSchema = z.object({
  productsCreated: z.number().int().nonnegative(),
  barcodesAdded: z.number().int().nonnegative(),
  documentsCreated: z.number().int().nonnegative(),
  documentLinesCreated: z.number().int().nonnegative(),
  /** Lista de claims: casos criados e linhas acrescentadas (só investigação). */
  claimsCreated: z.number().int().nonnegative().default(0),
  claimLinesCreated: z.number().int().nonnegative().default(0),
  /** Inventário conferido: fotografia, linhas e o que foi aplicado (nunca saldo validado). */
  inventoryId: z.uuid().nullable().default(null),
  inventoryLines: z.number().int().nonnegative().default(0),
  inventoryLinesApplied: z.number().int().nonnegative().default(0),
  inventoryLinesPending: z.number().int().nonnegative().default(0),
  documentLinksCreated: z.number().int().nonnegative().default(0),
  palletsCreated: z.number().int().nonnegative().default(0),
  palletsLocated: z.number().int().nonnegative().default(0),
  /** Seleção do cliente registrada. */
  selectionId: z.uuid().nullable().default(null),
  selectionLines: z.number().int().nonnegative().default(0),
});
export type ResultadoGravacao = z.infer<typeof ResultadoGravacaoSchema>;

export const LimitesImportacaoSchema = z.object({
  maxBytes: z.number().int().positive(),
  maxRows: z.number().int().positive(),
  maxColumns: z.number().int().positive(),
  maxCellChars: z.number().int().positive(),
  maxUncompressedBytes: z.number().int().positive(),
  maxZipEntries: z.number().int().positive(),
  maxProcessingMs: z.number().int().positive(),
});
export type LimitesImportacao = z.infer<typeof LimitesImportacaoSchema>;

export const LoteResumoSchema = z.object({
  id: z.uuid(),
  type: TipoImportacaoSchema,
  state: SituacaoImportacaoSchema,
  format: FormatoArquivoSchema,
  fileName: z.string().min(1),
  /** SHA-256 do arquivo (hexadecimal). */
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  fileSize: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  createdBy: UsuarioResumoSchema.nullable(),
  confirmedAt: z.iso.datetime().nullable(),
  confirmedBy: UsuarioResumoSchema.nullable(),
  discardedAt: z.iso.datetime().nullable(),
  previewVersion: z.number().int().nonnegative(),
  counters: ContadoresImportacaoSchema,
  /** Última tentativa de confirmação que falhou (nada foi gravado). */
  lastFailure: z.object({ at: z.iso.datetime(), message: z.string().min(1) }).nullable(),
});
export type LoteResumo = z.infer<typeof LoteResumoSchema>;

export const LoteImportacaoSchema = LoteResumoSchema.extend({
  /** Versão do registro do lote (mapeamento, confirmação, descarte). */
  version: z.number().int().positive(),
  previewGeneratedAt: z.iso.datetime().nullable(),
  options: OpcoesLeituraSchema.nullable(),
  decimalSeparator: SeparadorDecimalSchema.nullable(),
  columns: z.record(z.string(), z.number().int().nonnegative().nullable()).nullable(),
  /** Parâmetros do tipo usados na prévia atual (inventário e seleção). */
  parameters: z.record(z.string(), z.json()).nullable().default(null),
  /** Resumo da prévia atual (totais por ação, diferenças de versão, avisos gerais). */
  previewSummary: z.array(z.string()).default([]),
  /** Confirmação permitida agora (prévia atual sem inválidas nem conflitantes). */
  canConfirm: z.boolean(),
  /** Por que a confirmação está bloqueada, quando estiver. */
  blockReason: z.string().nullable(),
  result: ResultadoGravacaoSchema.nullable(),
  limits: LimitesImportacaoSchema,
});
export type LoteImportacao = z.infer<typeof LoteImportacaoSchema>;

export const LinhaImportacaoSchema = z.object({
  /** Número da linha no arquivo (como aparece na planilha/editor). */
  row: z.number().int().positive(),
  classification: ClassificacaoLinhaSchema,
  /** Chave de negócio, quando todos os componentes existem. */
  key: z.string().nullable(),
  /** Valores interpretados (texto exato; quantidades no formato canônico). */
  values: z.record(z.string(), z.string().nullable()),
  /** Valores como lidos no arquivo (para corrigir a origem). */
  read: z.record(z.string(), z.string().nullable()),
  reasons: z.array(MotivoLinhaSchema),
  notices: z.array(MotivoLinhaSchema),
  result: ResultadoLinhaSchema.nullable(),
  /** Inventário/seleção: ação proposta ou realizada (vincular, criar cadastro, referência histórica…). */
  action: z.string().nullable().default(null),
});
export type LinhaImportacao = z.infer<typeof LinhaImportacaoSchema>;

/** Ações por linha do inventário conferido e da seleção, com o rótulo exibido. */
export const ROTULOS_ACAO_LINHA: Readonly<Record<string, string>> = {
  VINCULAR: 'vincular',
  CRIAR_CADASTRO: 'criar cadastro proposto',
  ATUALIZAR: 'atualizar informação',
  JA_IMPORTADO: 'já importado',
  REFERENCIA_HISTORICA: 'referência histórica / endereço livre',
  DUPLICADA_ARQUIVO: 'repetida no arquivo (agrupada, sem somar)',
  REQUER_RESOLUCAO: 'requer resolução',
  SOLICITACAO: 'solicitação',
  EXCLUIDA_MARCACAO: 'fora da seleção (marcação)',
  DUPLICIDADE_AGRUPADA: 'repetida (agrupada, sem somar)',
};

export const LIMITE_LINHAS_PAGINA = 200;
/** Ações do inventário conferido que entram no conjunto aplicado (as demais ficam registradas como não aplicadas). */
export const ACOES_INVENTARIO_APLICAVEIS = ['VINCULAR', 'CRIAR_CADASTRO', 'ATUALIZAR'] as const;
export const FiltroLinhasSchema = z.object({
  classificacao: ClassificacaoLinhaSchema.optional(),
  /** Inventário conferido: só as linhas aplicáveis (vincular, criar cadastro, atualizar). */
  aplicaveis: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  tamanho: z.coerce.number().int().min(1).max(LIMITE_LINHAS_PAGINA).default(50),
});
export type FiltroLinhas = z.infer<typeof FiltroLinhasSchema>;

export const PaginaLinhasSchema = z.object({
  items: z.array(LinhaImportacaoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  previewVersion: z.number().int().nonnegative(),
});
export type PaginaLinhas = z.infer<typeof PaginaLinhasSchema>;

/** POST /importacoes — resposta do envio do arquivo. */
export const ResultadoEnvioSchema = z.object({
  /** Lote criado (nulo quando o mesmo arquivo já foi confirmado antes). */
  batch: LoteImportacaoSchema.nullable(),
  structure: EstruturaArquivoSchema.nullable(),
  /** Mesmo arquivo (hash) do mesmo tipo já confirmado: o resultado existente, sem nova importação. */
  alreadyImported: LoteResumoSchema.nullable(),
  /** Outras prévias abertas do mesmo arquivo (aviso; a confirmação concorrente é protegida no banco). */
  openDuplicates: z.array(z.uuid()),
});
export type ResultadoEnvio = z.infer<typeof ResultadoEnvioSchema>;

/** POST /importacoes/:id/confirmar */
export const ConfirmarImportacaoSchema = z.object({
  /** Versão da prévia revisada; outra versão = prévia desatualizada. */
  previewVersion: z.number().int().positive(),
  /** Quem confirma declara ter revisado a prévia. */
  reviewed: z.literal(true),
  /**
   * Inventário conferido: o conjunto aplicado é escolhido explicitamente —
   * quantas linhas aplicáveis quem confirma revisou e quais deixou de fora
   * agora (ficam registradas como não aplicadas, como as pendências).
   */
  expectedApplicable: z.number().int().nonnegative().optional(),
  excludedRows: z.array(z.number().int().positive()).max(5_000).default([]),
});
export type ConfirmarImportacao = z.input<typeof ConfirmarImportacaoSchema>;

export const ResultadoConfirmacaoSchema = z.object({
  batch: LoteImportacaoSchema,
  /** O lote já estava confirmado: resultado existente, nada foi importado de novo. */
  alreadyConfirmed: z.boolean(),
});
export type ResultadoConfirmacao = z.infer<typeof ResultadoConfirmacaoSchema>;

export const DescartarImportacaoSchema = z.object({ expectedVersion: z.number().int().positive() });
export type DescartarImportacao = z.infer<typeof DescartarImportacaoSchema>;

export const LIMITE_LOTES_PAGINA = 100;
export const FiltroLotesSchema = z.object({
  tipo: TipoImportacaoSchema.optional(),
  situacao: SituacaoImportacaoSchema.optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  tamanho: z.coerce.number().int().min(1).max(LIMITE_LOTES_PAGINA).default(20),
});
export type FiltroLotes = z.infer<typeof FiltroLotesSchema>;

export const PaginaLotesSchema = z.object({
  items: z.array(LoteResumoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type PaginaLotes = z.infer<typeof PaginaLotesSchema>;

/** Arquivos de modelo (dados fictícios) aceitos pelo próprio fluxo. */
export const ArquivoModeloSchema = z.enum([
  'produtos.csv',
  'produtos.xlsx',
  'devolucoes.csv',
  'devolucoes.xlsx',
  'claims.csv',
  'claims.xlsx',
  'inventario.csv',
  'inventario.xlsx',
  'selecao.csv',
  'selecao.xlsx',
]);
export type ArquivoModelo = z.infer<typeof ArquivoModeloSchema>;
export const ARQUIVOS_MODELO = ArquivoModeloSchema.options;

/** Nome do arquivo enviado: só para exibição (sem caminho nem caracteres de controle). */
export function nomeArquivoSeguro(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? '';
  const limpo = base.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 200);
  return limpo === '' ? 'arquivo' : limpo;
}
