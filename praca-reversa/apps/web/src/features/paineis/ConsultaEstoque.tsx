import { API_PREFIXO, EstoqueClienteSchema, HistoricoClienteSchema } from '@praca-reversa/contracts';
import { useState } from 'react';
import { baixarArquivo, mensagemDeFalha } from '../../api/cliente';
import { EstadoTela } from '../../components/Moldura';
import { formatarData } from '../../utils/datas';
import { Atualizacao, FormularioFiltros, LinhaTempo, Paginacao, TabelaEstoque } from './comum';
import { useConsultaViva } from './consulta-viva';
import { consultaDe, filtrosDe, volumes, type ValoresFiltro } from './formato';

const ROTULO_SITUACAO: Record<string, string> = {
  'sem-endereco': 'Só paletes sem endereço confirmado',
  full: 'Só paletes full',
  misto: 'Só paletes mistos',
  'sem-volume': 'Só conteúdos sem volume informado',
  reconferencia: 'Só paletes com reconferência vencida',
};

/**
 * Estoque (agora) e histórico (acontecimentos) com os filtros na URL. A
 * mesma consulta alimenta a tabela, os totais e a exportação. `base` decide
 * a projeção: interna (operação) ou do cliente.
 */
export function ConsultaEstoque({
  base,
  parametros,
  janelas,
  aoMudar,
  aoAbrirPalete,
}: {
  base: 'operacao' | 'cliente';
  parametros: string;
  janelas: readonly { id: string; code: string; name: string }[];
  aoMudar: (parametros: string) => void;
  aoAbrirPalete?: (id: string) => void;
}) {
  const [versao, setVersao] = useState(0);
  const [baixando, setBaixando] = useState<string | null>(null);
  const p = new URLSearchParams(parametros);
  const aba = p.get('aba') === 'historico' ? 'historico' : 'estoque';
  const pagina = Math.max(1, Number(p.get('pagina') ?? '1') || 1);
  const filtros = filtrosDe(parametros);
  const consulta = consultaDe({ ...filtros, ...(aba === 'estoque' ? { inicio: undefined, fim: undefined } : {}), pagina: pagina > 1 ? pagina : undefined });
  const estoque = useConsultaViva(aba === 'estoque' ? `${API_PREFIXO}/painel/${base}/estoque${consulta ? `?${consulta}` : ''}` : null, EstoqueClienteSchema, versao);
  const historico = useConsultaViva(aba === 'historico' ? `${API_PREFIXO}/painel/${base}/historico${consulta ? `?${consulta}` : ''}` : null, HistoricoClienteSchema, versao);
  const mudar = (v: ValoresFiltro & { aba?: string; pagina?: number }) => {
    aoMudar(consultaDe({ aba: aba === 'historico' ? 'historico' : undefined, ...v }));
  };
  const exportar = async (tipo: 'estoque' | 'historico') => {
    setBaixando(null);
    try {
      await baixarArquivo(`${API_PREFIXO}/painel/cliente/${tipo}/exportar${consulta ? `?${consulta}` : ''}`, `${tipo}.csv`);
    } catch (erro) {
      setBaixando(mensagemDeFalha(erro));
    }
  };

  return (
    <section className="cartao painel-secao" aria-label="Consulta" data-testid={`consulta-${base}`}>
      <div className="painel-abas" role="tablist" aria-label="Consulta">
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'estoque'}
          className={aba === 'estoque' ? 'aba aba--ativa' : 'aba'}
          onClick={() => {
            aoMudar(consultaDe({ ...filtros, inicio: undefined, fim: undefined }));
          }}
          data-testid="aba-estoque"
        >
          Estoque agora
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'historico'}
          className={aba === 'historico' ? 'aba aba--ativa' : 'aba'}
          onClick={() => {
            aoMudar(consultaDe({ ...filtros, situacao: undefined, aba: 'historico' }));
          }}
          data-testid="aba-historico"
        >
          Histórico
        </button>
      </div>
      <FormularioFiltros
        key={parametros}
        valores={filtros}
        janelas={janelas}
        periodo={aba === 'historico'}
        aoAplicar={(v) => {
          mudar({ ...v, situacao: filtros.situacao });
        }}
      />
      {filtros.situacao !== undefined && aba === 'estoque' && (
        <p className="painel-filtro-ativo">
          {ROTULO_SITUACAO[filtros.situacao] ?? filtros.situacao}{' '}
          <button
            type="button"
            className="botao-link"
            onClick={() => {
              mudar({ ...filtros, situacao: undefined });
            }}
          >
            remover
          </button>
        </p>
      )}
      {baixando !== null && (
        <p className="estado-erro" role="alert">
          {baixando}
        </p>
      )}
      {aba === 'estoque' ? (
        estoque.dados === null ? (
          <EstadoTela carga={estoque.carga ?? { estado: 'carregando' }} titulo="Não foi possível carregar o estoque" aoTentarNovamente={estoque.recarregar} />
        ) : (
          <>
            <Atualizacao
              consultadoEm={estoque.dados.consultedAt}
              carga={estoque.carga}
              aoAtualizar={() => {
                setVersao((x) => x + 1);
              }}
            />
            <p className="painel-totais" data-testid="estoque-totais">
              <strong>{volumes(estoque.dados.total)}</strong> registro(s) · <strong>{volumes(estoque.dados.totals.pallets)}</strong> palete(s) ·{' '}
              <strong>{volumes(estoque.dados.totals.documents)}</strong> documento(s) · <strong data-testid="estoque-total-volumes">{estoque.dados.totals.volumesCoverage.known === 0 ? 'volumes não informados' : volumes(estoque.dados.totals.volumes)}</strong> volume(s) (base
              conhecida em {estoque.dados.totals.volumesCoverage.known} de {estoque.dados.totals.volumesCoverage.total})
            </p>
            {base === 'cliente' && (
              <button
                type="button"
                className="botao-secundario botao-compacto"
                onClick={() => {
                  void exportar('estoque');
                }}
                data-testid="exportar-estoque"
              >
                Exportar estoque (CSV)
              </button>
            )}
            <TabelaEstoque linhas={estoque.dados.rows} {...(aoAbrirPalete ? { aoAbrirPalete } : {})} />
            <Paginacao
              total={estoque.dados.total}
              pagina={estoque.dados.page}
              tamanho={estoque.dados.pageSize}
              aoMudar={(n) => {
                mudar({ ...filtros, pagina: n });
              }}
            />
          </>
        )
      ) : historico.dados === null ? (
        <EstadoTela carga={historico.carga ?? { estado: 'carregando' }} titulo="Não foi possível carregar o histórico" aoTentarNovamente={historico.recarregar} />
      ) : (
        <>
          <Atualizacao
            consultadoEm={historico.dados.consultedAt}
            carga={historico.carga}
            aoAtualizar={() => {
              setVersao((x) => x + 1);
            }}
          />
          <p className="painel-totais">
            <strong>{volumes(historico.dados.total)}</strong> acontecimento(s)
            {historico.dados.availableFrom !== null ? ` · histórico disponível a partir de ${formatarData(historico.dados.availableFrom)}` : ' · sem histórico registrado'}. “Entrada registrada no
            sistema” é o cadastro, não a data de chegada física.
          </p>
          {base === 'cliente' && (
            <button
              type="button"
              className="botao-secundario botao-compacto"
              onClick={() => {
                void exportar('historico');
              }}
              data-testid="exportar-historico"
            >
              Exportar histórico (CSV)
            </button>
          )}
          <LinhaTempo eventos={historico.dados.events} />
          <Paginacao
            total={historico.dados.total}
            pagina={historico.dados.page}
            tamanho={historico.dados.pageSize}
            aoMudar={(n) => {
              mudar({ ...filtros, aba: 'historico', pagina: n });
            }}
          />
        </>
      )}
    </section>
  );
}
