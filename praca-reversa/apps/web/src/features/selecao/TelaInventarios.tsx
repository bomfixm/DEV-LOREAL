import { API_PREFIXO, PaginaInventariosSchema, tiposImportacaoPermitidos, type Permissao } from '@praca-reversa/contracts';
import { useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeMais } from '../../components/Icones';
import { Pagina } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { formatarData, formatarDataHora } from '../../utils/datas';

const TAMANHO = 20;

/** Inventários de referência (fotografias do que foi informado ao cliente), com versões e conferência externa. */
export function TelaInventarios({ permissoes, aoNavegar }: { permissoes: readonly Permissao[]; aoNavegar: Navegar }) {
  const [pagina, setPagina] = useState(1);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/inventarios?pagina=${String(pagina)}&tamanho=${String(TAMANHO)}`, PaginaInventariosSchema);
  const dados = carga?.estado === 'pronto' ? carga.dados : null;
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / TAMANHO)) : 1;
  const podeImportar = tiposImportacaoPermitidos(permissoes, 'executar').includes('INVENTARIO');
  return (
    <Pagina
      titulo="Inventários de referência"
      testId="tela-inventarios"
      ajuda="selecao"
      rotuloVoltar="Voltar às seleções"
      aoVoltar={() => {
        aoNavegar({ tipo: 'selecoes' });
      }}
      descricao={
        <p>
          A fotografia do que foi informado: NF/documento × palete × endereço × volumes, com fonte e data. Ela é preservada mesmo depois de movimentos; a localização atual vem
          sempre dos registros. Volumes não viram unidades de produto nem saldo validado.
        </p>
      }
    >
      {podeImportar && (
        <button
          type="button"
          className="botao-primario"
          onClick={() => {
            aoNavegar({ tipo: 'nova-importacao', importar: 'INVENTARIO' });
          }}
          data-testid="importar-inventario-conferido"
        >
          <IconeMais />
          Importar inventário conferido
        </button>
      )}
      {carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar os inventários. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {carga?.estado === 'carregando' && <p className="estado-carregando">Carregando inventários…</p>}
      {dados?.total === 0 && (
        <div className="estado-vazio">
          <p>Nenhum inventário de referência registrado.</p>
          <p>
            {podeImportar
              ? 'Use "Importar inventário conferido" com o arquivo que a operação identificar como definitivo; a prévia mostra cada linha antes de qualquer gravação.'
              : 'Quem importa o inventário conferido é o supervisor de estoque.'}
          </p>
        </div>
      )}
      {dados && dados.total > 0 && (
        <>
          <ul className="lista-lotes" data-testid="lista-inventarios">
            {dados.items.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className="item-lote"
                  onClick={() => {
                    aoNavegar({ tipo: 'inventario', id: i.id });
                  }}
                  data-testid="item-inventario"
                >
                  <span className="item-lote-topo">
                    <strong>
                      {i.code} — {i.description}
                    </strong>
                    <span className={`selo-situacao-lote ${i.state === 'ATIVO' ? 'selo-situacao-lote--CONFIRMADO' : 'selo-situacao-lote--DESCARTADO'}`}>
                      {i.state === 'ATIVO' ? 'Vigente' : 'Substituído por versão nova'}
                    </span>
                  </span>
                  <span className="item-lote-dados">
                    Conferência {i.countReference}
                    {i.countDate ? ` de ${formatarData(`${i.countDate}T12:00:00Z`)}` : ' (data não informada)'} · {i.totals.lines} linha(s): {i.totals.applied} aplicada(s),{' '}
                    {i.totals.pending} pendente(s), {i.totals.historical} histórica(s)
                  </span>
                  <span className="item-lote-dados">
                    {i.fileName ?? 'gerado na aplicação'} · importado em {formatarDataHora(i.createdAt)}
                    {i.createdBy ? ` por ${i.createdBy.name}` : ''} · conferência externa {i.externalCount.state === 'RECONHECIDA' ? 'reconhecida' : 'não registrada'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <nav className="paginacao" aria-label="Páginas dos inventários">
            <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina((x) => x - 1); }}>
              Anterior
            </button>
            <span>
              Página {pagina} de {paginas}
            </span>
            <button type="button" className="botao-secundario botao-compacto" disabled={pagina >= paginas} onClick={() => { setPagina((x) => x + 1); }}>
              Próxima
            </button>
          </nav>
        </>
      )}
    </Pagina>
  );
}
