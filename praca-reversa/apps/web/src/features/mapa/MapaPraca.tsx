import 'leaflet/dist/leaflet.css';
import type { Layout, PaleteResumo } from '@praca-reversa/contracts';
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from 'react';
import { ControladorMapa, type MargensMapa, type OpcoesCentralizar, type VisaoMapa } from './controlador-mapa';

export interface MapaPracaHandle {
  centralizar(id: string, opcoes?: OpcoesCentralizar): boolean;
  visaoGeral(): void;
  focarElemento(codigo: string): void;
  ampliar(): void;
  reduzir(): void;
}

interface Props {
  ref?: Ref<MapaPracaHandle>;
  layout: Layout;
  paletes: readonly PaleteResumo[];
  selecionadoId: string | null;
  idsVisiveis: ReadonlySet<string> | null;
  /** Espaço ocupado pelos controles sobrepostos, respeitado ao enquadrar. */
  margens: MargensMapa;
  aoSelecionar: (id: string) => void;
  aoMudarVisao: (visao: VisaoMapa) => void;
}

/**
 * Integra o Leaflet ao React: o mapa é criado uma vez por layout e recebe
 * dados, seleção e filtro sem ser recriado, preservando a câmera.
 */
export function MapaPraca({ ref, layout, paletes, selecionadoId, idsVisiveis, margens, aoSelecionar, aoMudarVisao }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controladorRef = useRef<ControladorMapa | null>(null);
  const selecionar = useEffectEvent((id: string) => {
    aoSelecionar(id);
  });
  const mudarVisao = useEffectEvent((visao: VisaoMapa) => {
    aoMudarVisao(visao);
  });
  const margensAtuais = useEffectEvent(() => margens);

  useImperativeHandle(
    ref,
    () => ({
      centralizar: (id, opcoes) => controladorRef.current?.centralizar(id, opcoes) ?? false,
      visaoGeral: () => controladorRef.current?.visaoGeral(),
      focarElemento: (codigo) => controladorRef.current?.focarElemento(codigo),
      ampliar: () => controladorRef.current?.ampliar(),
      reduzir: () => controladorRef.current?.reduzir(),
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controlador = new ControladorMapa(container, layout, {
      aoSelecionar: (id) => {
        selecionar(id);
      },
      aoMudarVisao: (visao) => {
        mudarVisao(visao);
      },
    }, margensAtuais());
    controladorRef.current = controlador;
    return () => {
      controlador.destruir();
      controladorRef.current = null;
    };
  }, [layout]);

  useEffect(() => {
    controladorRef.current?.definirMargens(margens);
  }, [layout, margens]);

  useEffect(() => {
    controladorRef.current?.definirPaletes(paletes);
  }, [layout, paletes]);

  useEffect(() => {
    controladorRef.current?.selecionar(selecionadoId);
  }, [layout, paletes, selecionadoId]);

  useEffect(() => {
    controladorRef.current?.definirVisiveis(idsVisiveis);
  }, [layout, paletes, idsVisiveis]);

  return (
    <>
      <div
        ref={containerRef}
        className="mapa-praca"
        data-testid="mapa"
        role="application"
        aria-roledescription="mapa"
        aria-label={`Mapa: ${layout.name}`}
        aria-describedby="ajuda-mapa"
      />
      <p id="ajuda-mapa" className="visualmente-oculto">
        Setas movem a visão; mais e menos ampliam e reduzem; Home volta à visão geral; C centraliza o palete
        selecionado. Para escolher um palete pelo teclado, use a lista de paletes.
      </p>
    </>
  );
}
