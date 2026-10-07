import {
  FORMATO_QUANTIDADE,
  UNIDADE_PECA,
  compararQuantidades,
  ehQuantidadeInteira,
  normalizarQuantidade,
  somarQuantidades,
  subtrairQuantidades,
  type EstadoConferencia,
  type ItemSaldo,
  type Layout,
  type PaleteResumo,
  type TipoEventoEstoque,
} from '@praca-reversa/contracts';
import { FalhaRequisicao, mensagemDeFalha } from '../../api/cliente';
import { formatarQuantidade } from '../../utils/numeros';

/**
 * Regras de apresentação das movimentações (sem rede): o servidor continua
 * validando tudo; aqui só se evita enviar o que já se sabe inválido e se
 * explica cada resposta.
 */

export type TipoAviso = 'ok' | 'campo' | 'saldo' | 'destino' | 'conflito' | 'permissao' | 'rede' | 'bloqueio' | 'erro';

export interface Aviso {
  tipo: TipoAviso;
  titulo: string;
  texto: string;
  /** Resposta incerta: a operação pode ter sido registrada; reenviar com a mesma chave. */
  incerto: boolean;
}

/** Explica a falha de uma movimentação e diz se a resposta foi incerta. */
export function classificarFalha(erro: unknown): Aviso {
  const texto = mensagemDeFalha(erro);
  if (!(erro instanceof FalhaRequisicao)) return { tipo: 'erro', titulo: 'Falha inesperada', texto, incerto: true };
  // Etapa 09: nada saiu do aparelho (sem rede, versão incompatível, pedido anterior em confirmação).
  if (erro.tipo === 'bloqueio') {
    const titulo =
      erro.codigo === 'OPERACAO_EM_CONFIRMACAO' ? 'Pedido anterior em confirmação' : erro.codigo === 'VERSAO_INCOMPATIVEL' ? 'Versão incompatível' : 'Sem conexão: nada foi enviado';
    return { tipo: 'bloqueio', titulo, texto, incerto: false };
  }
  if (erro.tipo === 'formato' && erro.incerta) {
    return { tipo: 'rede', titulo: 'Resposta inválida do servidor', texto: `${texto} A movimentação pode ter sido registrada: verifique ou reenvie com a mesma chave.`, incerto: true };
  }
  if (erro.tipo === 'rede') {
    return {
      tipo: 'rede',
      titulo: 'Sem resposta do servidor',
      texto: 'Não dá para saber se a movimentação foi registrada. Reenvie quando a conexão voltar: a mesma chave garante que ela não seja duplicada.',
      incerto: true,
    };
  }
  if (erro.status !== null && erro.status >= 500) {
    return { tipo: 'erro', titulo: 'O servidor não concluiu a operação', texto: `${texto} Reenvie: a mesma chave impede duplicação.`, incerto: true };
  }
  if (erro.status === 403) return { tipo: 'permissao', titulo: 'Permissão negada', texto, incerto: false };
  if (erro.status === 404) return { tipo: 'erro', titulo: 'Não encontrado neste escopo', texto, incerto: false };
  if (erro.status === 400) return { tipo: 'campo', titulo: 'Confira os dados', texto, incerto: false };
  switch (erro.codigo) {
    case 'SALDO_INSUFICIENTE':
      return { tipo: 'saldo', titulo: 'Saldo insuficiente', texto, incerto: false };
    case 'DESTINO_INDISPONIVEL':
      return { tipo: 'destino', titulo: 'Destino indisponível', texto, incerto: false };
    case 'CONFLITO_VERSAO':
      return { tipo: 'conflito', titulo: 'Dados alterados por outra pessoa', texto, incerto: false };
    case 'CONFLITO':
      return { tipo: 'conflito', titulo: 'Operação incompatível com o estado atual', texto, incerto: false };
    case 'IDEMPOTENCIA_CONFLITO':
      return { tipo: 'erro', titulo: 'Pedido diferente com a mesma chave', texto, incerto: false };
    default:
      return { tipo: 'erro', titulo: 'Não registrado', texto, incerto: false };
  }
}

/** Disponível = saldo validado − reservas ativas. */
export function disponivel(item: Pick<ItemSaldo, 'quantity' | 'reserved'>): string {
  return normalizarQuantidade(subtrairQuantidades(item.quantity, item.reserved));
}

/** Texto digitado (aceita vírgula decimal) para o formato da API. */
export function normalizarDigitado(texto: string): string {
  return texto.trim().replace(',', '.');
}

/** Problema da quantidade pedida, ou `null` se ela pode ser enviada. */
export function problemaQuantidade(digitado: string, unidade: string, limite: string, rotuloLimite = 'disponível'): string | null {
  const q = normalizarDigitado(digitado);
  if (q === '') return 'Informe a quantidade.';
  if (!FORMATO_QUANTIDADE.test(q)) return 'Quantidade: número com até 3 casas decimais (ex.: 8 ou 1,5).';
  if (compararQuantidades(q, '0') <= 0) return 'A quantidade precisa ser maior que zero.';
  if (unidade === UNIDADE_PECA && !ehQuantidadeInteira(q)) return `Quantidade em peças (${UNIDADE_PECA}) precisa ser inteira.`;
  if (compararQuantidades(q, limite) > 0) return `Maior que o ${rotuloLimite}: ${formatarQuantidade(normalizarQuantidade(limite))} ${unidade}.`;
  return null;
}

export interface LinhaPrevia {
  papel: 'sai' | 'entra';
  paleteCodigo: string;
  antes: string;
  depois: string;
}

/** Efeito no saldo do segmento: sai de um palete e entra no outro (o total não muda). */
export function previaSaldo(
  segmentoId: string,
  quantidade: string,
  de: { codigo: string; itens: readonly ItemSaldo[] | null },
  para: { codigo: string; itens: readonly ItemSaldo[] | null },
): [LinhaPrevia, LinhaPrevia] {
  const q = normalizarQuantidade(normalizarDigitado(quantidade));
  const antesDe = de.itens?.find((i) => i.segmentId === segmentoId)?.quantity ?? '0';
  const antesPara = para.itens?.find((i) => i.segmentId === segmentoId)?.quantity ?? '0';
  return [
    { papel: 'sai', paleteCodigo: de.codigo, antes: normalizarQuantidade(antesDe), depois: normalizarQuantidade(subtrairQuantidades(antesDe, q)) },
    { papel: 'entra', paleteCodigo: para.codigo, antes: normalizarQuantidade(antesPara), depois: normalizarQuantidade(somarQuantidades([antesPara, q])) },
  ];
}

export interface PosicaoLivre {
  id: string;
  codigo: string;
  fileira: string;
}

/**
 * Posições que podem receber o palete: do layout ativo, disponíveis e sem
 * palete vinculado (posição individual). Filtradas pelo texto digitado.
 */
export function posicoesLivres(layout: Layout | null, paletes: readonly PaleteResumo[], texto: string, excetoId: string | null): PosicaoLivre[] {
  if (layout === null) return [];
  const ocupadas = new Set(paletes.flatMap((p) => (p.positionId === null ? [] : [p.positionId])));
  const fileiras = new Map(layout.rows.map((f) => [f.id, f.label]));
  const busca = texto.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return layout.positions
    .filter((p) => p.available && !ocupadas.has(p.id) && p.id !== excetoId)
    .filter((p) => busca === '' || p.code.replace(/[^A-Z0-9]/g, '').includes(busca))
    .map((p) => ({ id: p.id, codigo: p.code, fileira: fileiras.get(p.rowId) ?? '' }));
}

/** Situação do conteúdo em frase ("O palete X está …"), para avisos de saldo parcial conhecido. */
export const SITUACAO_CONTEUDO: Record<EstadoConferencia, string> = {
  NAO_CONFERIDO: 'não conferido',
  PARCIAL: 'com conferência parcial (restante desconhecido)',
  AGUARDANDO_VALIDACAO: 'com contagem aguardando validação',
  RECONCILIADO: 'reconciliado',
};

export const ROTULOS_EVENTO_ESTOQUE: Record<TipoEventoEstoque, string> = {
  SALDO_INICIAL: 'Saldo inicial (reconciliação)',
  AJUSTE_RECONCILIACAO: 'Ajuste de reconciliação',
  TRANSFERENCIA: 'Transferência entre paletes',
  CORRECAO_TRANSFERENCIA: 'Correção de transferência',
  EXPEDICAO: 'Baixa por expedição',
};

/** Motivos sugeridos (texto livre continua permitido; os motivos oficiais da operação estão em DESCOBERTA.md). */
export const MOTIVOS_SUGERIDOS = {
  mover: ['Reorganização da praça', 'Liberar posição', 'Correção de endereço registrado', 'Consolidação de paletes'],
  transferir: ['Consolidação de paletes', 'Separação por devolução', 'Separação por condição', 'Reorganização do conteúdo'],
} as const;
