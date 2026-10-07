import { API_PREFIXO, SessaoSchema, type Sessao } from '@praca-reversa/contracts';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { FalhaRequisicao, aoSessaoPerdida, definirTokenCsrf, enviarJson, mensagemDeFalha, obterJson } from '../api/cliente';
import { incertasDoContexto, limparIncertas, pendente } from '../api/incertas';
import { limparMemoriaBusca } from '../features/busca/estado';
import { limparMemoriaClaims } from '../features/claims/memoria';
import { contarNaoEnviadas, descartarDeOutrosUsuarios, descartarTodasNaoEnviadas } from '../features/conferencia/fila';
import { aoSessaoEncerradaEmOutraAba, avisarSessaoEncerrada, consultarOutrasAbas } from '../pwa/abas';

const URL_SESSAO = `${API_PREFIXO}/sessao`;

export type EstadoSessao =
  | { estado: 'verificando' }
  | { estado: 'anonimo'; aviso: string | null }
  | { estado: 'autenticado'; sessao: Sessao }
  | { estado: 'erro'; mensagem: string; semResposta: boolean };

export interface AcoesSessao {
  entrar: (login: string, senha: string) => Promise<string | null>;
  sair: () => Promise<void>;
  trocarEscopo: (escopoId: string) => Promise<string | null>;
  verificar: () => void;
}

/** Entradas da conferência e operações em confirmação desta aba (o que sair da conta descartaria). */
function pendenciasLocais(): number {
  return contarNaoEnviadas() + incertasDoContexto().filter(pendente).length;
}

/** Descarta tudo o que é da sessão neste navegador (memória e armazenamento da aba). */
function descartarMaterialLocal(): void {
  descartarTodasNaoEnviadas();
  limparIncertas();
}

/**
 * Estado da sessão no navegador. A prova de identidade é o cookie HttpOnly,
 * invisível para scripts; aqui ficam só os dados exibidos e o token anti-CSRF,
 * em memória. Perder a sessão descarta tudo isso; o que ainda não foi enviado
 * fica na memória da aplicação para o mesmo usuário reenviar depois de entrar
 * de novo. Sair da conta descarta também o não enviado (com aviso), nesta e
 * nas outras abas.
 */
export function useSessao(): [EstadoSessao, AcoesSessao] {
  const [estado, setEstado] = useState<EstadoSessao>({ estado: 'verificando' });
  const [verificacao, setVerificacao] = useState(0);

  const autenticar = useCallback((sessao: Sessao) => {
    definirTokenCsrf(sessao.csrfToken);
    // Outro usuário nesta aba: o que era do anterior não aparece nem é enviado.
    descartarDeOutrosUsuarios(sessao.user.id);
    setEstado({ estado: 'autenticado', sessao });
  }, []);

  const encerrar = useCallback((aviso: string | null) => {
    definirTokenCsrf(null);
    // Nenhum dado de busca permanece depois de sair ou perder a sessão.
    limparMemoriaBusca();
    limparMemoriaClaims();
    setEstado({ estado: 'anonimo', aviso });
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    obterJson(URL_SESSAO, SessaoSchema, controle.signal, true).then(autenticar, (erro: unknown) => {
      if (controle.signal.aborted) return;
      if (erro instanceof FalhaRequisicao && erro.status === 401) {
        encerrar(erro.codigo === 'SESSAO_EXPIRADA' ? 'Sessão expirada: entre novamente.' : null);
      } else {
        setEstado({ estado: 'erro', mensagem: mensagemDeFalha(erro), semResposta: erro instanceof FalhaRequisicao && erro.tipo === 'rede' });
      }
    });
    return () => {
      controle.abort();
    };
  }, [verificacao, autenticar, encerrar]);

  useEffect(() => {
    aoSessaoPerdida((motivo) => {
      encerrar(motivo === 'SESSAO_EXPIRADA' ? 'Sessão expirada: entre novamente. O que não foi enviado continua nesta aba para você revisar.' : 'Entre novamente para continuar.');
    });
    // Saiu em outra aba: esta também descarta o material local e volta ao login.
    aoSessaoEncerradaEmOutraAba(() => {
      descartarMaterialLocal();
      encerrar('A sessão foi encerrada em outra aba.');
    });
    return () => {
      aoSessaoPerdida(null);
      aoSessaoEncerradaEmOutraAba(null);
    };
  }, [encerrar]);

  const acoes: AcoesSessao = {
    entrar: async (login, senha) => {
      try {
        autenticar(await enviarJson('POST', URL_SESSAO, SessaoSchema, { corpo: { login, senha }, ignorar401: true }));
        return null;
      } catch (erro) {
        return mensagemDeFalha(erro);
      }
    },
    sair: async () => {
      const locais = pendenciasLocais();
      const outras = await consultarOutrasAbas();
      if (locais > 0 || outras.pendencias.length > 0) {
        const partes = [
          locais > 0 ? `${String(locais)} item(ns) não enviado(s) ou em confirmação nesta aba` : null,
          outras.pendencias.length > 0 ? `pendências em outra aba (${outras.pendencias.join(' ')})` : null,
        ].filter((p): p is string => p !== null);
        const seguir = window.confirm(
          `Há ${partes.join(' e ')}. Ao sair, isso é descartado deste navegador; o que o servidor já registrou continua registrado. Sair mesmo assim?`,
        );
        if (!seguir) return;
      }
      try {
        await enviarJson('DELETE', URL_SESSAO, z.null(), { ignorar401: true });
      } catch {
        // Mesmo sem resposta, o estado privado da interface é descartado.
      }
      descartarMaterialLocal();
      avisarSessaoEncerrada();
      encerrar('Você saiu.');
    },
    trocarEscopo: async (escopoId) => {
      const locais = pendenciasLocais();
      if (
        locais > 0 &&
        !window.confirm(
          `Há ${String(locais)} item(ns) não enviado(s) ou em confirmação. Eles ficam guardados para a unidade/cliente atual e não serão mostrados nem enviados na outra. Trocar mesmo assim?`,
        )
      ) {
        return null;
      }
      try {
        autenticar(await enviarJson('PUT', `${URL_SESSAO}/escopo`, SessaoSchema, { corpo: { scopeId: escopoId } }));
        return null;
      } catch (erro) {
        return mensagemDeFalha(erro);
      }
    },
    verificar: () => {
      setEstado({ estado: 'verificando' });
      setVerificacao((v) => v + 1);
    },
  };

  return [estado, acoes];
}
