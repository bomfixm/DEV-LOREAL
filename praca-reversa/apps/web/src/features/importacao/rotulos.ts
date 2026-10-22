import type { ClassificacaoLinha, CodificacaoCsv, DelimitadorCsv, SituacaoImportacao, TipoCelula, TipoImportacao } from '@praca-reversa/contracts';

export const ROTULOS_TIPO: Record<TipoImportacao, string> = {
  PRODUTOS: 'Cadastro de produtos',
  DEVOLUCOES: 'Documentos de devolução',
  CLAIMS: 'Lista de claims',
  INVENTARIO: 'Inventário conferido',
  SELECAO_CLIENTE: 'Seleção do cliente',
  BIPAGEM: 'Bipagem (palete)',
};

export const ROTULOS_SITUACAO: Record<SituacaoImportacao, string> = {
  AGUARDANDO_MAPEAMENTO: 'Aguardando colunas',
  PREVIA: 'Prévia para revisão',
  CONFIRMADO: 'Confirmado',
  DESCARTADO: 'Descartado',
};

export const ROTULOS_CLASSIFICACAO: Record<ClassificacaoLinha, { texto: string; marcador: string }> = {
  VALIDA_NOVA: { texto: 'Válida nova', marcador: '+' },
  DUPLICADA: { texto: 'Duplicada (ignorada)', marcador: '=' },
  INVALIDA: { texto: 'Inválida', marcador: '!' },
  CONFLITANTE: { texto: 'Conflitante', marcador: '≠' },
  EXCLUIDA: { texto: 'Fora da seleção', marcador: '−' },
};

export const ROTULOS_CODIFICACAO: Record<CodificacaoCsv, string> = {
  'UTF-8': 'UTF-8',
  'UTF-16LE': 'UTF-16 (little endian)',
  'UTF-16BE': 'UTF-16 (big endian)',
  'WINDOWS-1252': 'Windows-1252 (ANSI, CSV comum do Excel)',
};

export const ROTULOS_DELIMITADOR: Record<DelimitadorCsv, string> = {
  PONTO_E_VIRGULA: 'Ponto e vírgula (;)',
  VIRGULA: 'Vírgula (,)',
  TABULACAO: 'Tabulação',
  BARRA_VERTICAL: 'Barra vertical (|)',
};

export const ROTULOS_CELULA: Record<TipoCelula, string> = {
  TEXTO: 'texto',
  NUMERO: 'número',
  DATA: 'data',
  BOOLEANO: 'verdadeiro/falso',
  FORMULA: 'fórmula',
  ERRO: 'erro',
  VAZIO: 'vazia',
};

/** O que cada tipo nunca faz (texto da confirmação). */
export const ALCANCE_TIPO: Record<TipoImportacao, string> = {
  PRODUTOS: 'Cadastrar produtos e códigos de barras não cria saldo físico nem altera cadastros existentes.',
  DEVOLUCOES:
    'Importar documentos registra a declaração documental: não cria recebimento físico, contagem, saldo validado, ocupação de posição nem liberação de material.',
  CLAIMS:
    'Importar claims cria só casos e linhas de investigação: não altera estoque, condição, localização, recuperação, valor confirmado nem o sistema do cliente. Linhas incompletas ficam em triagem.',
  INVENTARIO:
    'Importar o inventário conferido registra a fotografia (NF × palete × endereço × volumes) e, nas linhas revisadas, cria/vincula paletes e registra a localização pela tabela de endereços confirmada. Não cria saldo validado por produto, não libera material e não altera reservas, claims nem saídas; volumes não viram unidades de produto.',
  SELECAO_CLIENTE:
    'Importar a seleção registra as solicitações do cliente (com pendências, quando houver). Não reserva, não libera, não altera estoque nem confirma saída: a conciliação e a proposta para a janela vêm depois.',
  BIPAGEM:
    'Importar a bipagem cadastra no palete escolhido cada documento com volumes lidos (Tipo, Número, CNPJ Remetente e Remetente) com a contagem informada (Lidos). Registros sem leitura ficam só no lote. Não exige SKU, não cria saldo por produto, não libera, não reserva e não expede.',
};

/** Valores extras da prévia do inventário conferido (além dos campos mapeados). */
export const ROTULOS_VALOR_EXTRA: Record<string, string> = {
  pallet: 'Palete resolvido/proposto',
  palletProposed: 'Cadastro proposto',
  position: 'Posição visual',
  positionState: 'Correspondência da posição',
  locate: 'Localização a registrar',
  volumesUnit: 'Unidade dos volumes',
  freeAddress: 'Endereço livre',
  scopeRule: 'Regra da abrangência',
  duplicateOf: 'Repetida da linha',
  noteVolumes: 'Volumes da nota neste palete',
  noteAction: 'Nota',
  destination: 'Destino',
};
