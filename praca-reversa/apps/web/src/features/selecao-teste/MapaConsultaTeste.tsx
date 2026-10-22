import { API_PREFIXO, PracaSchema } from '@praca-reversa/contracts';
import { useRef, useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeMais, IconeMenos } from '../../components/Icones';
import type { MargensMapa } from '../mapa/controlador-mapa';
import { MapaPraca, type MapaPracaHandle } from '../mapa/MapaPraca';

const MARGENS: MargensMapa = { topo: 16, direita: 64, base: 16, esquerda: 16 };

/**
 * Mapa da praça em modo consulta para a "Seleção cliente — teste": o mesmo
 * mapa (mesma fonte de dados), só para localizar o palete e abrir a janela da
 * seleção. Nenhuma ação operacional (receber, mover, conferir, etiqueta).
 */
export function MapaConsultaTeste({ aoEscolherPalete, aoVoltar }: { aoEscolherPalete: (id: string) => void; aoVoltar: () => void }) {
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/praca`, PracaSchema);
  const mapa = useRef<MapaPracaHandle>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const dados = carga?.estado === 'pronto' ? carga.dados : null;
  return (
    <section className="st-mapa" aria-label="Mapa da praça (consulta)" data-testid="st-mapa">
      <header className="st-mapa-topo">
        <div>
          <h3>Mapa da praça — consulta</h3>
          <p className="st-nota">Clique num palete para ver as notas e escolher o que pedir.</p>
        </div>
        <div className="st-mapa-acoes">
          <button type="button" className="botao-secundario" onClick={() => mapa.current?.focarPrincipal()}>
            Focar L’Oréal
          </button>
          <button type="button" className="botao-secundario" onClick={() => mapa.current?.visaoGeral()}>
            Ver praça completa
          </button>
          <button type="button" className="botao-primario" onClick={aoVoltar} data-testid="st-voltar-lista">
            Voltar à lista
          </button>
        </div>
      </header>
      <div className="st-mapa-area">
        {carga === null || carga.estado === 'carregando' ? (
          <p className="st-nota" role="status">
            Carregando o mapa…
          </p>
        ) : carga.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>{carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={recarregar}>
              Tentar novamente
            </button>
          </div>
        ) : dados?.layout === null || dados === null ? (
          <p className="st-nota">Esta praça ainda não tem layout cadastrado.</p>
        ) : (
          <>
            <MapaPraca
              ref={mapa}
              layout={dados.layout}
              paletes={dados.pallets}
              selecionadoId={selecionado}
              idsVisiveis={null}
              margens={MARGENS}
              aoSelecionar={(id) => {
                setSelecionado(id);
                aoEscolherPalete(id);
              }}
              aoMudarVisao={() => undefined}
            />
            <div className="st-mapa-zoom">
              <button type="button" className="botao-secundario botao-icone" onClick={() => mapa.current?.ampliar()} aria-label="Aproximar">
                <IconeMais />
              </button>
              <button type="button" className="botao-secundario botao-icone" onClick={() => mapa.current?.reduzir()} aria-label="Afastar">
                <IconeMenos />
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
