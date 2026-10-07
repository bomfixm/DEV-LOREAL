import { API_PREFIXO, VERSAO_CONTRATO, VersaoServidorSchema, contratoAceito, type VersaoServidor } from '@praca-reversa/contracts';
import { paraEndereco } from '../base';
import { criarLoja, useLoja } from '../utils/loja';

/**
 * Compatibilidade entre esta interface e a API (etapa 09). Com contrato
 * incompatível, nenhuma gravação é enviada: a tela orienta "Atualizar" e
 * mantém o que ainda não foi enviado.
 */
export interface EstadoVersao {
  servidor: VersaoServidor | null;
  /** Contrato informado pela API na última resposta (cabeçalho). */
  contratoApi: number | null;
  incompativel: boolean;
}

export const lojaVersao = criarLoja<EstadoVersao>({ servidor: null, contratoApi: null, incompativel: false });

let consulta: Promise<void> | null = null;

/** GET /versao (público). Falha de rede não muda o estado conhecido. */
export function consultarVersao(): Promise<void> {
  consulta ??= fetch(paraEndereco(`${API_PREFIXO}/versao`), { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' })
    .then(async (resposta) => {
      if (!resposta.ok) return;
      const lido = VersaoServidorSchema.safeParse(await resposta.json().catch(() => null));
      if (!lido.success) return;
      lojaVersao.definir((atual) => ({ ...atual, servidor: lido.data, contratoApi: lido.data.contract, incompativel: !contratoAceito(VERSAO_CONTRATO, lido.data) }));
    })
    .catch(() => undefined)
    .finally(() => {
      consulta = null;
    });
  return consulta;
}

/** Cabeçalho x-praca-contrato de uma resposta: mudou → confirma pela rota /versao. */
export function informarContratoApi(contrato: number): void {
  const { contratoApi } = lojaVersao.ler();
  if (contratoApi === contrato) return;
  lojaVersao.definir((atual) => ({ ...atual, contratoApi: contrato, incompativel: atual.incompativel || contrato < VERSAO_CONTRATO }));
  void consultarVersao();
}

/** A API recusou uma gravação desta interface (VERSAO_INCOMPATIVEL). */
export function marcarIncompativel(): void {
  lojaVersao.definir((atual) => (atual.incompativel ? atual : { ...atual, incompativel: true }));
  void consultarVersao();
}

export function versaoIncompativel(): boolean {
  return lojaVersao.ler().incompativel;
}

/**
 * Rascunho no armazenamento do navegador só quando a API informa que a
 * política permite (nunca em produção). Antes da resposta: só memória.
 */
export function persistenciaLocalPermitida(): boolean {
  return lojaVersao.ler().servidor?.localDrafts === true;
}

export function useVersao(): EstadoVersao {
  return useLoja(lojaVersao);
}
