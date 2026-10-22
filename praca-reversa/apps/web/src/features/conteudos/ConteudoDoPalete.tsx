import { API_PREFIXO, ConteudosPaleteSchema } from '@praca-reversa/contracts';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { agruparDocumentos } from '../paletes/documentos';
import { textoSequenciaFull } from '../paletes/volumes';
import { textoConferencia, textoVolumesConteudo } from './textos';

/**
 * "Ver mais": conteúdo do palete numa tabela simples — registrado à mão e
 * importado, uma linha por parcela (Delivery). Uma nota com duas Deliveries
 * conta 1 documento; conteúdo sem nota aparece como "Documento não informado"
 * e não é unido a outro. Volumes pela regra contados × previstos.
 */
export function ConteudoDoPalete({ paleteId, versao, aoConferir, aoRegistrar }: { paleteId: string; versao: number; aoConferir: (() => void) | null; aoRegistrar: (() => void) | null }) {
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/paletes/${paleteId}/conteudos`, ConteudosPaleteSchema, versao);
  const dados = carga?.estado === 'pronto' ? carga.dados : null;
  const grupos = dados === null ? [] : agruparDocumentos(dados.items);
  const vazio = (texto: string) => <span className="pendente">{texto}</span>;
  return (
    <section className="detalhe-secao" aria-labelledby="secao-conteudo-palete" data-testid="conteudo-do-palete">
      <h3 id="secao-conteudo-palete">Conteúdo do palete</h3>
      {carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar o conteúdo. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {dados === null && carga?.estado !== 'erro' && <p className="estado-carregando">Carregando conteúdo…</p>}
      {dados !== null && dados.items.length === 0 && <p className="sem-itens">Nenhum conteúdo registrado neste palete.</p>}
      {dados !== null && dados.items.length > 0 && (
        <div className="tabela-documentos-rolagem" data-testid="tabela-documentos">
          <p className="nota-resumo">
            <strong>
              {dados.documents} {dados.documents === 1 ? 'documento' : 'documentos'}
            </strong>
            {dados.withoutDocument > 0 && ` · ${String(dados.withoutDocument)} sem documento`}
            {dados.items.length > dados.documents + dados.withoutDocument && ` · ${String(dados.items.length)} parcelas (Deliveries)`}
            {dados.full === 'FULL' && ' · FULL'}
          </p>
          <table className="tabela-documentos">
            <thead>
              <tr>
                <th scope="col">Documento</th>
                <th scope="col">Delivery</th>
                <th scope="col">Remetente</th>
                <th scope="col">Volumes</th>
                <th scope="col">Conferência</th>
                <th scope="col">FULL</th>
              </tr>
            </thead>
            <tbody>
              {grupos.flatMap((g) =>
                g.parcelas.map((c, i) => {
                  const volumes = textoVolumesConteudo(c);
                  return (
                    <tr key={c.id} data-testid="linha-documento" data-numero={g.numero ?? ''} data-delivery={c.delivery ?? ''} data-kind={c.kind}>
                      {i === 0 && (
                        <th scope="rowgroup" rowSpan={g.parcelas.length}>
                          {g.numero === null ? vazio('Documento não informado') : `${g.tipo ?? 'Tipo não informado'} ${g.numero}`}
                        </th>
                      )}
                      <td>{c.delivery ?? vazio('Delivery não informado')}</td>
                      <td>{c.sender ?? vazio('Não informado')}</td>
                      <td data-testid="linha-documento-volumes" className={volumes.situacao === 'pendente' ? 'pendente' : undefined}>
                        {volumes.texto}
                      </td>
                      <td>{textoConferencia(c)}</td>
                      <td>{textoSequenciaFull(c.palletFull) ?? vazio('—')}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
      {(aoConferir !== null || aoRegistrar !== null) && (
        <div className="acoes-linha">
          {aoConferir !== null && (
            <button type="button" className="botao-secundario" onClick={aoConferir} data-testid="detalhe-conferir-volumes">
              Conferência de volumes
            </button>
          )}
          {aoRegistrar !== null && (
            <button type="button" className="botao-secundario" onClick={aoRegistrar} data-testid="detalhe-registrar-conteudo">
              Registrar conteúdo
            </button>
          )}
        </div>
      )}
    </section>
  );
}
