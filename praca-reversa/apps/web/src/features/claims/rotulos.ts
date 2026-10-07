import type {
  BaseCandidato,
  CodigoPendencia,
  Compatibilidade,
  FiltroPendencia,
  OrdemClaims,
  PrioridadeClaim,
  QuantidadePorUnidade,
  TipoEventoClaim,
  TipoEvidencia,
  TipoOrigemDocumento,
  TipoResultado,
} from '@praca-reversa/contracts';
import { formatarQuantidade } from '../../utils/numeros';

export { ROTULOS_MOTIVO_CLAIM as ROTULOS_MOTIVO, ROTULOS_SITUACAO_CLAIM as ROTULOS_SITUACAO } from '@praca-reversa/contracts';

export const ROTULOS_PRIORIDADE: Record<PrioridadeClaim, string> = { URGENTE: 'Urgente', ALTA: 'Alta', NORMAL: 'Normal', BAIXA: 'Baixa' };

export const ROTULOS_ORDEM: Record<OrdemClaims, string> = {
  PRIORIDADE: 'Prioridade manual, depois prazo',
  PRAZO: 'Prazo (mais próximo primeiro)',
  VALOR: 'Valor estimado (por moeda)',
  RECENTES: 'Registrados mais recentes',
};

export const ROTULOS_FILTRO_PENDENCIA: Record<FiltroPendencia, string> = {
  TRIAGEM: 'Em triagem (cadastro incompleto)',
  VALIDACAO_PENDENTE: 'Validação pendente',
  COBRANCA_FINALIZADA: 'Cobrança finalizada sem prova externa',
  SEM_RESPONSAVEL: 'Sem responsável',
  SEM_PRAZO: 'Prazo não informado',
  SEM_RECUPERACAO_VALIDADA: 'Com quantidade sem recuperação validada',
};

export const ROTULOS_PENDENCIA: Record<CodigoPendencia, string> = {
  SEM_REFERENCIA_EXTERNA: 'Sem referência externa',
  PRODUTO_NAO_CADASTRADO: 'Produto fora do cadastro',
  UNIDADE_INCOMPATIVEL: 'Unidade incompatível',
  ORIGEM_PENDENTE: 'Origem pendente',
  LOTE_PENDENTE: 'Lote pendente',
  SEM_PRAZO: 'Prazo não informado',
  SEM_RESPONSAVEL: 'Sem responsável',
  VALOR_SEM_ESTIMATIVA: 'Valor sem estimativa',
  VALIDACAO_PENDENTE: 'Validação pendente',
  SEM_RECUPERACAO_VALIDADA: 'Sem recuperação física validada',
  AVARIA_EM_AVALIACAO: 'Avaria em avaliação',
  COBRANCA_FINALIZADA: 'Cobrança finalizada',
  SEM_RESULTADO: 'Sem resultado registrado',
};

export const ROTULOS_BASE: Record<BaseCandidato, string> = {
  SALDO_VALIDADO: 'Saldo validado (reconciliado)',
  OBSERVADO: 'Observado, não reconciliado',
  DECLARADO_PALETE: 'Declarado no palete (documento)',
  DOCUMENTO: 'Documento importado (sem vínculo físico)',
  HISTORICO: 'Histórico (não prova presença atual)',
};

export const ROTULOS_COMPAT: Record<Compatibilidade, { texto: string; marcador: string }> = {
  COMPATIVEL: { texto: 'compatível', marcador: '✓' },
  INCOMPATIVEL: { texto: 'incompatível', marcador: '✗' },
  PENDENTE: { texto: 'pendente', marcador: '?' },
  NAO_EXIGIDO: { texto: 'não exigido', marcador: '–' },
};

export const ROTULOS_TIPO_EVIDENCIA: Record<TipoEvidencia, string> = {
  MATERIAL_CONFERIDO: 'Material conferido (saldo validado)',
  DOCUMENTO: 'Documento registrado',
  DESCRICAO: 'Descrição com referência verificável',
};

export const ROTULOS_SITUACAO_EVIDENCIA = {
  REGISTRADA: 'Registrada',
  VALIDACAO_SOLICITADA: 'Validação solicitada',
  VALIDADA: 'Validada',
  REJEITADA: 'Rejeitada',
} as const;

export const ROTULOS_TIPO_RESULTADO: Record<TipoResultado, string> = { REGULARIZACAO: 'Regularização (valor evitado)', PERDA_CONFIRMADA: 'Perda/avaria confirmada' };

export const ROTULOS_ORIGEM: Record<TipoOrigemDocumento, string> = { DEVOLUCAO: 'Devolução', NOTA_FISCAL: 'NF', MANIFESTO: 'Manifesto', OUTRO: 'Outro documento' };

export const ROTULOS_EVENTO: Record<TipoEventoClaim, string> = {
  CASO_CRIADO: 'Caso registrado',
  CASO_IMPORTADO: 'Caso importado',
  CASO_ALTERADO: 'Dados alterados',
  LINHA_IMPORTADA: 'Linha importada',
  SITUACAO_ALTERADA: 'Situação alterada',
  CANDIDATO_REGISTRADO: 'Candidato em investigação',
  CONFERENCIA_SOLICITADA: 'Conferência solicitada',
  CANDIDATO_DESCARTADO: 'Candidato descartado',
  ANEXO_ENVIADO: 'Anexo enviado',
  EVIDENCIA_REGISTRADA: 'Evidência registrada',
  VALIDACAO_SOLICITADA: 'Validação solicitada',
  RECUPERACAO_VALIDADA: 'Recuperação física validada',
  VALIDACAO_REJEITADA: 'Validação rejeitada',
  RECUPERACAO_ESTORNADA: 'Recuperação estornada',
  VINCULO_MOVIDO: 'Vínculo acompanhou o material',
  RESULTADO_REGISTRADO: 'Resultado registrado',
  RESULTADO_CORRIGIDO: 'Resultado corrigido',
  RESULTADO_ANULADO: 'Resultado anulado',
  CASO_ENCERRADO: 'Caso encerrado',
  CASO_REABERTO: 'Caso reaberto',
};

/** "12 UN · 2 CX" (unidades nunca somadas entre si); "—" quando vazio. */
export function textoUnidades(lista: readonly QuantidadePorUnidade[], vazio = '0'): string {
  return lista.length === 0 ? vazio : lista.map((q) => `${formatarQuantidade(q.quantity)} ${q.unit}`).join(' · ');
}

/** Valor exato em pt-BR com a moeda ("1.250,50 BRL"), sem ponto flutuante. */
export function formatarValor(valor: string, moeda: string | null): string {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(valor);
  if (!m) return `${valor}${moeda ? ` ${moeda}` : ''}`;
  const inteiro = (m[2] ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fracao = (m[3] ?? '').padEnd(2, '0');
  return `${m[1] ?? ''}${inteiro},${fracao}${moeda ? ` ${moeda}` : ''}`;
}

export function textoValores(lista: readonly { currency: string; value: string }[], vazio = 'nenhum'): string {
  return lista.length === 0 ? vazio : lista.map((v) => formatarValor(v.value, v.currency)).join(' · ');
}

/** Data AAAA-MM-DD exibida como DD/MM/AAAA, sem fuso (data informada). */
export function formatarDataInformada(data: string | null, vazio = 'não informado'): string {
  if (data === null) return vazio;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  return m ? `${m[3] ?? ''}/${m[2] ?? ''}/${m[1] ?? ''}` : data;
}
