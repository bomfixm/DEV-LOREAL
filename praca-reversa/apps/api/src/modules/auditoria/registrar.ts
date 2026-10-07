import type { Banco, Transacao } from '../../db/cliente.js';

export type AcaoAuditoria =
  | 'LOGIN_SUCESSO'
  | 'LOGIN_FALHA'
  | 'LOGIN_BLOQUEADO'
  | 'LOGOUT'
  | 'ESCOPO_ALTERADO'
  | 'ACESSO_NEGADO'
  | 'USUARIO_CRIADO'
  | 'VINCULO_ALTERADO'
  | 'CONTA_DESATIVADA'
  | 'CONTA_REATIVADA'
  | 'ADMIN_BOOTSTRAP'
  | 'SEED_DEMONSTRACAO'
  | 'PRODUTO_CRIADO'
  | 'PRODUTO_ALTERADO'
  | 'PALETE_CADASTRADO'
  | 'PALETE_ALTERADO'
  | 'PALETE_ARQUIVADO'
  | 'ETIQUETA_EMITIDA'
  | 'LAYOUT_CRIADO'
  | 'LAYOUT_ALTERADO'
  | 'CONFERENCIA_INICIADA'
  | 'CONFERENCIA_NOTAS_ALTERADAS'
  | 'CONFERENCIA_OBSERVACAO_CORRIGIDA'
  | 'CONFERENCIA_OBSERVACAO_REMOVIDA'
  | 'CONFERENCIA_CONCLUIDA'
  | 'CONFERENCIA_CANCELADA'
  | 'CONFERENCIA_RECONTAGEM_SOLICITADA'
  | 'CONFERENCIA_RECONCILIADA'
  | 'CONFERENCIA_RECONCILIACAO_RECUSADA'
  | 'CONFERENCIA_ANEXO_ENVIADO'
  | 'CONFERENCIA_ANEXO_BAIXADO'
  | 'PALETE_MOVIDO'
  | 'MOVIMENTO_CORRIGIDO'
  | 'TRANSFERENCIA_REGISTRADA'
  | 'TRANSFERENCIA_CORRIGIDA'
  | 'IMPORTACAO_ENVIADA'
  | 'IMPORTACAO_PREVIA_GERADA'
  | 'IMPORTACAO_CONFIRMADA'
  | 'IMPORTACAO_FALHOU'
  | 'IMPORTACAO_DESCARTADA'
  | 'IMPORTACAO_RELATORIO_BAIXADO'
  | 'BUSCA_EXPORTADA'
  | 'CLAIM_CRIADO'
  | 'CLAIM_ALTERADO'
  | 'CLAIM_SITUACAO_ALTERADA'
  | 'CLAIM_CANDIDATO_REGISTRADO'
  | 'CLAIM_CONFERENCIA_SOLICITADA'
  | 'CLAIM_CANDIDATO_DESCARTADO'
  | 'CLAIM_ANEXO_ENVIADO'
  | 'CLAIM_ANEXO_BAIXADO'
  | 'CLAIM_EVIDENCIA_REGISTRADA'
  | 'CLAIM_VALIDACAO_SOLICITADA'
  | 'CLAIM_RECUPERACAO_VALIDADA'
  | 'CLAIM_VALIDACAO_REJEITADA'
  | 'CLAIM_VALIDACAO_RECUSADA'
  | 'CLAIM_RECUPERACAO_ESTORNADA'
  | 'CLAIM_VINCULO_MOVIDO'
  | 'CLAIM_RESULTADO_REGISTRADO'
  | 'CLAIM_RESULTADO_CORRIGIDO'
  | 'CLAIM_RESULTADO_ANULADO'
  | 'CLAIM_ENCERRADO'
  | 'CLAIM_REABERTO'
  | 'CLAIM_EXPORTADO'
  | 'MATERIAL_LIBERADO'
  | 'MATERIAL_LIBERACAO_REVOGADA'
  | 'MATERIAL_BLOQUEADO'
  | 'MATERIAL_DESBLOQUEADO'
  | 'PALETE_BLOQUEADO'
  | 'PALETE_DESBLOQUEADO'
  | 'JANELA_CRIADA'
  | 'JANELA_ALTERADA'
  | 'JANELA_CONFIRMADA'
  | 'JANELA_ENCERRADA'
  | 'JANELA_CANCELADA'
  | 'JANELA_ANEXO_ENVIADO'
  | 'JANELA_ANEXO_BAIXADO'
  | 'JANELA_EXPORTADA'
  | 'RESERVA_CRIADA'
  | 'RESERVA_CANCELADA'
  | 'RESERVA_LIBERADA'
  | 'PREPARACAO_REGISTRADA'
  | 'PREPARACAO_EXPORTADA'
  | 'EXPEDICAO_CONFIRMADA'
  | 'EXPEDICAO_CORRIGIDA'
  | 'RETORNO_REGISTRADO'
  | 'PALETE_VAZIO_RETIRADO'
  | 'RELATORIO_EXPORTADO'
  | 'INVENTARIO_IMPORTADO'
  | 'CONFERENCIA_EXTERNA_RECONHECIDA'
  | 'SELECAO_IMPORTADA'
  | 'SELECAO_RESOLUCAO_REGISTRADA'
  | 'SELECAO_RESOLUCAO_ANULADA'
  | 'SELECAO_ENCAMINHADA'
  | 'SELECAO_EXPORTADA'
  | 'INVENTARIO_CARGA_REENVIADA'
  | 'INVENTARIO_CARGA_FALHOU'
  | 'NOTA_CIDADE_DESTINO_ALTERADA'
  | 'NOTA_PRODUTO_ALTERADO'
  | 'NOTA_CAIXA_DESCRITA'
  | 'NOTA_CAIXA_RETIRADA'
  | 'PLANILHA_PUBLICACAO_SOLICITADA'
  | 'PLANILHA_ARQUIVO_BAIXADO';

/** Detalhes só aceitam valores simples: evita registrar objetos com dados sensíveis por engano. */
export type DetalhesAuditoria = Record<string, string | number | boolean | null>;

export interface EventoNovo {
  acao: AcaoAuditoria;
  resultado: 'SUCESSO' | 'NEGADO' | 'FALHA';
  atorUsuarioId?: string | null;
  escopoId?: string | null;
  alvoTipo?: string | null;
  alvoId?: string | null;
  detalhes?: DetalhesAuditoria;
  requestId?: string | null;
}

/**
 * Registra evento de auditoria (horário UTC do banco). Nunca recebe senha,
 * cookie, identificador de sessão ou token.
 */
export async function registrarEvento(db: Banco | Transacao, evento: EventoNovo): Promise<void> {
  await db.eventoAuditoria.create({
    data: {
      acao: evento.acao,
      resultado: evento.resultado,
      atorUsuarioId: evento.atorUsuarioId ?? null,
      escopoId: evento.escopoId ?? null,
      alvoTipo: evento.alvoTipo ?? null,
      alvoId: evento.alvoId ?? null,
      ...(evento.detalhes ? { detalhes: evento.detalhes } : {}),
      requestId: evento.requestId ?? null,
    },
  });
}
