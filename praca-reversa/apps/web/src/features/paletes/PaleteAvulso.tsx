import { API_PREFIXO, EscopoDoPaleteSchema, PaleteDetalheSchema, resumirPalete, type Permissao } from '@praca-reversa/contracts';
import { useState, type Ref } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeVoltar } from '../../components/Icones';
import type { AcaoPalete } from '../../rotas';
import { DetalhePalete } from './DetalhePalete';

interface Props {
  id: string;
  compacto: boolean;
  permissoes: readonly Permissao[];
  consultadoEm: string;
  tituloRef: Ref<HTMLHeadingElement>;
  aoFechar: () => void;
  aoImprimir: () => void;
  aoAbrirConferencia: (id: string) => void;
  aoMovimentar: (acao: AcaoPalete) => void;
  aoAlterado: () => void;
  aoTrocarEscopo: (escopoId: string) => Promise<string | null>;
}

/**
 * Palete aberto pelo link (QR) que não está no mapa nem na lista do escopo
 * ativo: arquivado, de outro escopo do usuário ou inexistente. Sem acesso, a
 * resposta é a mesma de palete inexistente.
 */
export function PaleteAvulso({
  id,
  compacto,
  permissoes,
  consultadoEm,
  tituloRef,
  aoFechar,
  aoImprimir,
  aoAbrirConferencia,
  aoMovimentar,
  aoAlterado,
  aoTrocarEscopo,
}: Props) {
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/paletes/${id}`, PaleteDetalheSchema, versao);
  const naoEncontrado = carga?.estado === 'erro' && carga.status === 404;
  const escopo = useRecurso(naoEncontrado ? `${API_PREFIXO}/paletes/${id}/escopo` : null, EscopoDoPaleteSchema);
  const [trocando, setTrocando] = useState<string | null>(null);

  if (carga?.estado === 'pronto') {
    return (
      <DetalhePalete
        resumo={resumirPalete(carga.dados)}
        carga={carga}
        local={null}
        consultadoEm={consultadoEm}
        compacto={compacto}
        permissoes={permissoes}
        tituloRef={tituloRef}
        aoCentralizar={() => undefined}
        aoFechar={aoFechar}
        aoRecarregar={recarregar}
        aoImprimir={aoImprimir}
        aoAbrirConferencia={aoAbrirConferencia}
        aoMovimentar={aoMovimentar}
        aoAlterado={() => {
          setVersao((v) => v + 1);
          aoAlterado();
        }}
      />
    );
  }

  return (
    <article className="detalhe" data-testid="palete-avulso" aria-labelledby="avulso-titulo">
      <header className="detalhe-topo">
        {compacto && (
          <button type="button" className="botao-voltar" onClick={aoFechar}>
            <IconeVoltar />
            Voltar ao mapa
          </button>
        )}
        <p className="detalhe-sobretitulo">Palete</p>
        <h2 id="avulso-titulo" ref={tituloRef} tabIndex={-1}>
          {naoEncontrado ? 'Palete não encontrado' : 'Abrindo palete…'}
        </h2>
        <p className="detalhe-id">
          ID <code>{id}</code>
        </p>
      </header>
      {carga === null || carga.estado === 'carregando' ? (
        <p className="estado-carregando">Carregando palete…</p>
      ) : naoEncontrado ? (
        <div className="estado-vazio" data-testid="palete-nao-encontrado">
          <p>Este palete não existe no escopo ativo ou você não tem acesso a ele.</p>
          {escopo.carga?.estado === 'pronto' ? (
            <>
              <p>
                Ele pertence a <strong>{escopo.carga.dados.scopeName}</strong>, onde você tem acesso.
              </p>
              <button
                type="button"
                className="botao-primario"
                disabled={trocando !== null}
                onClick={() => {
                  if (escopo.carga?.estado !== 'pronto') return;
                  setTrocando('trocando');
                  void aoTrocarEscopo(escopo.carga.dados.scopeId).then((falha) => {
                    setTrocando(falha);
                  });
                }}
              >
                Trocar para {escopo.carga.dados.scopeName}
              </button>
              {trocando !== null && trocando !== 'trocando' && (
                <p className="estado-erro" role="alert">
                  {trocando}
                </p>
              )}
            </>
          ) : (
            <p>Confira o código ou o QR. Se o palete deveria estar aqui, fale com o supervisor ou o administrador.</p>
          )}
        </div>
      ) : (
        <div className="estado-erro" role="alert">
          <p>Não foi possível abrir o palete. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
    </article>
  );
}
