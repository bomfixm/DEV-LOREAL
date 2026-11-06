import { API_PREFIXO, ListaSeparacoesSchema, type Permissao } from '@praca-reversa/contracts';
import { useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { useChaves } from '../../api/chaves';
import { baixarArquivo, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeArquivo } from '../../components/Icones';
import { CartaoSeparacao } from './CartaoSeparacao';
import { ErroPlanilha, lerPlanilhaSeparacao } from './ler-planilha';

/**
 * Envio da planilha do cliente na tela "Seleção do cliente": o botão fica ao
 * lado de "Importar seleção" e a lista logo abaixo. Ao enviar, os paletes com
 * notas da coluna NUMERO ficam roxos no mapa. Não reserva, não libera e não
 * altera estoque.
 */
export function useSeparacaoCliente(permissoes: readonly Permissao[], aoGravar: () => void): { botao: ReactNode; lista: ReactNode } {
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/separacoes`, ListaSeparacoesSchema);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const chaves = useChaves();
  const podeGravar = permissoes.includes('selecao.importar');
  const itens = carga?.estado === 'pronto' ? carga.dados.items : null;

  async function executar(assinatura: string, acao: (chave: string) => Promise<unknown>) {
    setEnviando(true);
    setErro(null);
    try {
      await acao(chaves.para(assinatura));
      chaves.concluir(assinatura);
      recarregar();
      aoGravar();
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(e instanceof ErroPlanilha ? e.message : mensagemDeFalha(e));
    } finally {
      setEnviando(false);
    }
  }

  const botao = podeGravar ? (
    <>
      <input
        ref={entrada}
        type="file"
        accept=".xlsx,.xlsm"
        hidden
        aria-label="Planilha do cliente"
        data-testid="separacao-arquivo"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = '';
          if (arquivo === undefined) return;
          void executar(`separacao:${arquivo.name}:${String(arquivo.size)}:${String(arquivo.lastModified)}`, async (chave) =>
            enviarJson('POST', `${API_PREFIXO}/separacoes`, ListaSeparacoesSchema, { corpo: await lerPlanilhaSeparacao(arquivo, arquivo.name), idempotencia: chave }),
          );
        }}
      />
      <button
        type="button"
        className="botao-primario"
        disabled={enviando}
        data-testid="separacao-enviar"
        onClick={() => {
          entrada.current?.click();
        }}
      >
        <IconeArquivo />
        {enviando ? 'Enviando…' : 'Enviar planilha do cliente'}
      </button>
    </>
  ) : null;

  const lista = (
    <>
      {erro !== null && (
        <p className="estado-erro" role="alert" data-testid="separacao-erro">
          {erro}
        </p>
      )}
      {carga?.estado === 'erro' && (
        <p className="estado-erro" role="alert">
          Não foi possível consultar as planilhas do cliente.
        </p>
      )}
      {itens?.map((s) => (
        <CartaoSeparacao
          key={s.id}
          s={s}
          podeGravar={podeGravar}
          ocupado={enviando}
          aoBaixar={() => {
            baixarArquivo(`${API_PREFIXO}/separacoes/${s.id}/relatorio`, `notas-separacao-${s.window ?? 'cliente'}.xlsx`).catch((e: unknown) => {
              setErro(mensagemDeFalha(e));
            });
          }}
          aoEncerrar={() => {
            void executar(`separacao-encerrar:${s.id}`, (chave) => enviarJson('POST', `${API_PREFIXO}/separacoes/${s.id}/encerrar`, z.unknown(), { corpo: {}, idempotencia: chave }));
          }}
        />
      ))}
    </>
  );
  return { botao, lista };
}
