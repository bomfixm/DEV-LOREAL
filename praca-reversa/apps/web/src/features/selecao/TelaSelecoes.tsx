import { API_PREFIXO, PaginaSelecoesSchema, tiposImportacaoPermitidos, type Permissao } from '@praca-reversa/contracts';
import { useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeMais } from '../../components/Icones';
import { Pagina } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { ROTULOS_MODALIDADE } from './rotulos';

const TAMANHO = 20;

/**
 * Seleção do cliente: histórico das listas importadas (com versões
 * substitutivas), acesso à conciliação e às pendências de cada uma e aos
 * inventários de referência. Importar e conciliar não reservam nem alteram
 * estoque.
 */
export function TelaSelecoes({ permissoes, aoNavegar }: { permissoes: readonly Permissao[]; aoNavegar: Navegar }) {
  const [pagina, setPagina] = useState(1);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/selecoes?pagina=${String(pagina)}&tamanho=${String(TAMANHO)}`, PaginaSelecoesSchema);
  const dados = carga?.estado === 'pronto' ? carga.dados : null;
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / TAMANHO)) : 1;
  const executar = tiposImportacaoPermitidos(permissoes, 'executar');

  return (
    <Pagina
      titulo="Seleção do cliente"
      testId="tela-selecoes"
      ajuda="selecao"
      aoVoltar={() => {
        aoNavegar({ tipo: 'praca' });
      }}
      descricao={
        <p>
          Inventário de referência → seleção do cliente → conciliação com os registros → pendências → lista de separação → reserva pelo fluxo da janela. Importar e conciliar não
          reservam, não liberam e não alteram estoque.
        </p>
      }
    >
      <div className="acoes-linha">
        {executar.includes('SELECAO_CLIENTE') && (
          <button
            type="button"
            className="botao-primario"
            onClick={() => {
              aoNavegar({ tipo: 'nova-importacao', importar: 'SELECAO_CLIENTE' });
            }}
            data-testid="importar-selecao"
          >
            <IconeMais />
            Importar seleção
          </button>
        )}
        <button
          type="button"
          className="botao-secundario"
          onClick={() => {
            aoNavegar({ tipo: 'inventarios' });
          }}
          data-testid="abrir-inventarios"
        >
          Inventários de referência
        </button>
        {executar.includes('INVENTARIO') && (
          <button
            type="button"
            className="botao-secundario"
            onClick={() => {
              aoNavegar({ tipo: 'nova-importacao', importar: 'INVENTARIO' });
            }}
            data-testid="importar-inventario"
          >
            Importar inventário conferido
          </button>
        )}
      </div>
      {carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar as seleções. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {carga?.estado === 'carregando' && <p className="estado-carregando">Carregando seleções…</p>}
      {dados?.total === 0 && (
        <div className="estado-vazio" data-testid="selecoes-vazio">
          <p>Nenhuma seleção do cliente registrada neste escopo.</p>
          <p>
            {executar.includes('SELECAO_CLIENTE')
              ? 'Use "Importar seleção" com a lista devolvida pelo cliente (lista já selecionada ou inventário com a coluna de marcação). Se a lista cita o inventário enviado, importe antes o inventário conferido.'
              : 'Quem importa a seleção é o supervisor de estoque. Assim que houver uma lista, ela aparece aqui para consulta e exportação.'}
          </p>
        </div>
      )}
      {dados && dados.total > 0 && (
        <>
          <ul className="lista-lotes" data-testid="lista-selecoes">
            {dados.items.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="item-lote"
                  onClick={() => {
                    aoNavegar({ tipo: 'selecao', id: s.id, situacao: null });
                  }}
                  data-testid="item-selecao"
                  data-codigo={s.code}
                >
                  <span className="item-lote-topo">
                    <strong>
                      {s.code} · pedido {s.orderReference} (versão {s.orderVersion}
                      {s.versionLabel ? `, cliente: ${s.versionLabel}` : ''})
                    </strong>
                    <span className={`selo-situacao-lote ${s.state === 'SUBSTITUIDA' ? 'selo-situacao-lote--DESCARTADO' : 'selo-situacao-lote--CONFIRMADO'}`}>
                      {s.state === 'SUBSTITUIDA' ? 'Substituída por versão nova' : 'Registrada'}
                    </span>
                  </span>
                  <span className="item-lote-dados">
                    {ROTULOS_MODALIDADE[s.mode]} · {s.totalLines} solicitação(ões){s.excludedLines > 0 ? ` · ${String(s.excludedLines)} linha(s) fora da seleção` : ''} · inventário{' '}
                    {s.inventory ? s.inventory.code : 'não informado'}
                  </span>
                  <span className="item-lote-dados">
                    {s.fileName} · importada em {formatarDataHora(s.createdAt)}
                    {s.createdBy ? ` por ${s.createdBy.name}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <nav className="paginacao" aria-label="Páginas das seleções">
            <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina((p) => p - 1); }}>
              Anterior
            </button>
            <span>
              Página {pagina} de {paginas} ({dados.total} seleção(ões))
            </span>
            <button type="button" className="botao-secundario botao-compacto" disabled={pagina >= paginas} onClick={() => { setPagina((p) => p + 1); }}>
              Próxima
            </button>
          </nav>
        </>
      )}
    </Pagina>
  );
}
