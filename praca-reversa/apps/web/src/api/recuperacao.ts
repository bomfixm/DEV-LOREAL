import { API_PREFIXO, ResultadoOperacaoSchema, type ResultadoOperacao } from '@praca-reversa/contracts';
import { z } from 'zod';
import { formatarHora } from '../utils/datas';
import { criarLoja, useLoja } from '../utils/loja';
import { FalhaRequisicao, enviarJson, mensagemDeFalha, obterJson } from './cliente';
import { aindaPodeProcessar, alterarIncerta, incertasDoContexto, lojaIncertas, pendente, type OperacaoIncerta } from './incertas';

/**
 * Recuperação de operações incertas (etapa 09): consulta autenticada do
 * resultado (somente leitura) e reenvio do mesmo pedido com a mesma chave.
 * Nada é reenviado sozinho: a verificação é automática, o reenvio é sempre
 * uma ação da pessoa.
 */

/** Consulta o servidor pela chave. */
export function consultarOperacao(chave: string): Promise<ResultadoOperacao> {
  return obterJson(`${API_PREFIXO}/operacoes/${encodeURIComponent(chave)}`, ResultadoOperacaoSchema);
}

/** Aumenta quando uma operação incerta é confirmada: as telas consultam os dados de novo. */
export const lojaGeracaoDados = criarLoja(0);
export function avisarDadosAlterados(): void {
  lojaGeracaoDados.definir((g) => g + 1);
}
export function useGeracaoDados(): number {
  return useLoja(lojaGeracaoDados);
}

export function decidir(item: OperacaoIncerta, resultado: ResultadoOperacao, agora = Date.now()): Pick<OperacaoIncerta, 'situacao' | 'mensagem'> {
  if (resultado.state === 'REGISTRADA') {
    const registro = resultado.operations[0];
    const quando = registro ? formatarHora(registro.recordedAt) : '';
    return { situacao: 'confirmada', mensagem: `Registrada pelo servidor${quando ? ` (pedido das ${quando})` : ''}. Nada foi repetido.` };
  }
  if (aindaPodeProcessar(item, agora)) {
    return {
      situacao: 'incerta',
      mensagem: 'Ainda sem registro no servidor; o pedido pode estar em processamento. Repetir com a mesma chave é seguro.',
    };
  }
  return { situacao: 'nao-registrada', mensagem: 'O servidor não registrou este pedido. Ele pode ser descartado ou enviado de novo (mesma chave).' };
}

const emVerificacao = new Set<string>();

export async function verificarIncerta(item: OperacaoIncerta): Promise<void> {
  if (emVerificacao.has(item.id)) return;
  emVerificacao.add(item.id);
  alterarIncerta(item.id, { situacao: 'verificando' });
  try {
    const resultado = await consultarOperacao(item.chave);
    const decisao = decidir(item, resultado);
    alterarIncerta(item.id, { ...decisao, verificadaEm: Date.now() });
    if (decisao.situacao === 'confirmada') avisarDadosAlterados();
  } catch (erro) {
    alterarIncerta(item.id, {
      situacao: 'incerta',
      verificadaEm: Date.now(),
      mensagem: `Não foi possível verificar agora: ${mensagemDeFalha(erro)}`,
    });
  } finally {
    emVerificacao.delete(item.id);
  }
}

/** Reenvio do pedido idêntico (mesma chave e corpo): o servidor devolve o resultado original se já gravou. */
export async function reenviarIncerta(item: OperacaoIncerta): Promise<void> {
  if (item.corpo === undefined) return;
  alterarIncerta(item.id, { situacao: 'verificando', mensagem: 'Reenviando com a mesma chave…' });
  try {
    await enviarJson(item.metodo, item.url, z.unknown(), { corpo: item.corpo, idempotencia: item.chave, descricao: item.descricao });
    avisarDadosAlterados();
  } catch (erro) {
    // O cliente já marcou recusa (4xx) ou manteve incerta (rede/5xx).
    if (erro instanceof FalhaRequisicao && (erro.tipo === 'bloqueio' || erro.tipo === 'formato')) {
      alterarIncerta(item.id, { situacao: 'incerta', mensagem: mensagemDeFalha(erro) });
    } else if (erro instanceof FalhaRequisicao && (erro.tipo === 'rede' || erro.incerta)) {
      alterarIncerta(item.id, { situacao: 'incerta', mensagem: 'Sem resposta outra vez: o resultado continua incerto.' });
    }
  }
}

/** Verifica todas as pendentes do contexto atual (ao entrar, reconectar ou reabrir). */
export function verificarPendentes(): void {
  for (const item of incertasDoContexto(lojaIncertas.ler())) {
    if (pendente(item)) void verificarIncerta(item);
  }
}
