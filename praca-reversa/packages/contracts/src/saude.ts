import { z } from 'zod';

/** GET /api/v1/health: a API responde. Resposta mínima, sem configuração. */
export const SaudeSchema = z.object({ status: z.literal('ok') });
export type Saude = z.infer<typeof SaudeSchema>;

/** GET /api/v1/health/ready: a API consegue consultar o banco. 503 quando não. */
export const ProntidaoSchema = z.object({
  status: z.enum(['pronto', 'indisponivel']),
  database: z.enum(['disponivel', 'indisponivel']),
});
export type Prontidao = z.infer<typeof ProntidaoSchema>;

export const CodigoErroSchema = z.enum([
  'NAO_AUTENTICADO',
  'SESSAO_EXPIRADA',
  'CREDENCIAIS_INVALIDAS',
  'MUITAS_TENTATIVAS',
  'ACESSO_NEGADO',
  'SEM_ESCOPO',
  'CSRF_INVALIDO',
  'ORIGEM_INVALIDA',
  'IDEMPOTENCIA_AUSENTE',
  'IDEMPOTENCIA_CONFLITO',
  'NAO_ENCONTRADO',
  'REQUISICAO_INVALIDA',
  'CONFLITO',
  /** O registro mudou desde a última leitura (versão/revisão desatualizada). */
  'CONFLITO_VERSAO',
  /** Alteração de layout que deixaria a geometria incoerente. */
  'GEOMETRIA_INVALIDA',
  /** Código lido não cadastrado no escopo: nenhum SKU é associado por semelhança. */
  'CODIGO_NAO_CADASTRADO',
  /** Embalagem/unidade sem fator aprovado: conversão bloqueada. */
  'CONVERSAO_DESCONHECIDA',
  /** Código de embalagem incompatível com o modo de entrada escolhido. */
  'MODO_INCOMPATIVEL',
  /** Reconciliação incompatível com reservas/vínculos atuais: pendência registrada. */
  'CONFLITO_SALDO',
  /** Quantidade pedida maior que o disponível (saldo validado − reservas ativas). */
  'SALDO_INSUFICIENTE',
  /** Posição de destino ocupada, indisponível ou fora do layout ativo. */
  'DESTINO_INDISPONIVEL',
  /** Arquivo de importação incompatível, corrompido ou acima dos limites. */
  'ARQUIVO_INVALIDO',
  /** A prévia revisada não vale mais (arquivo, mapeamento ou dados mudaram): revisar a nova prévia. */
  'PREVIA_DESATUALIZADA',
  /** Há linhas inválidas ou conflitantes: a confirmação fica bloqueada. */
  'IMPORTACAO_BLOQUEADA',
  /** O conjunto de conteúdos do palete mudou depois de aberto (conferência ou correção): revisar antes de repetir. */
  'CONJUNTO_ALTERADO',
  /** Destino com conteúdo: confirmar antes de acrescentar (conteúdo e número do destino preservados). */
  'CONFIRMAR_DESTINO',
  /** Conteúdo com volumes separados ou expedidos numa janela: tratar na janela antes de corrigir. */
  'JANELA_VINCULADA',
  /** O mesmo arquivo já foi confirmado em outro lote. */
  'ARQUIVO_JA_IMPORTADO',
  /** Validação de recuperação recusada por regra (produto, unidade, lote, origem, condição, base). */
  'RECUPERACAO_BLOQUEADA',
  /** Quantidade acima do elegível do material ou do restante da linha do claim. */
  'QUANTIDADE_INDISPONIVEL',
  /** Anexo de tipo, tamanho ou conteúdo não aceito. */
  'ANEXO_INVALIDO',
  /** Capacidade da janela insuficiente, pendente ou incompatível (etapa 08). */
  'CAPACIDADE_INSUFICIENTE',
  /** Material bloqueado, não liberado ou fora dos critérios da janela. */
  'MATERIAL_INELEGIVEL',
  /** Janela ou reserva em situação que não permite a operação. */
  'SITUACAO_INVALIDA',
  /** Documento exigido ou medida necessária ausente. */
  'PENDENCIA_DOCUMENTAL',
  /** Interface de outra versão do contrato: gravação recusada até atualizar (etapa 09). */
  'VERSAO_INCOMPATIVEL',
  /** Retirada de palete vazio recusada: ainda há saldo validado, reserva ou vínculo (etapa 10). */
  'PALETE_NAO_VAZIO',
  /** Conteúdo do palete não é totalmente conhecido: nada é presumido vazio (etapa 10). */
  'CONTEUDO_DESCONHECIDO',
  /** Sequência de endereços incompatível com as posições desenhadas da faixa (complemento seleção do cliente). */
  'SEQUENCIA_INCOMPATIVEL',
  /** A conciliação/proposta revisada mudou (movimento, saldo, reserva ou nova versão): revisar de novo. */
  'CONCILIACAO_DESATUALIZADA',
  /** Seleção cliente — teste: o palete inteiro e notas dele ao mesmo tempo (os volumes contariam duas vezes). */
  'SELECAO_DUPLICADA',
  /** Seleção cliente — teste: o estoque consultado mudou desde a escolha; revisar antes de enviar. */
  'DADOS_ALTERADOS',
  /** Seleção cliente — teste: solicitação enviada não é editada (só com pedido de alteração aprovado). */
  'SOLICITACAO_BLOQUEADA',
  'BANCO_INDISPONIVEL',
  'ERRO_INTERNO',
]);
export type CodigoErro = z.infer<typeof CodigoErroSchema>;

export const ErroApiSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  requestId: z.string().optional(),
});
export type ErroApi = z.infer<typeof ErroApiSchema>;
