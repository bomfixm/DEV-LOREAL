import 'leaflet/dist/leaflet.css';
import type { Layout, PaleteResumo } from '@praca-reversa/contracts';
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from 'react';
import { ControladorMapa, type MargensMapa, type OpcoesCentralizar, type VisaoMapa } from './controlador-mapa';
import type { Caixa } from './enquadramento';

export interface MapaPracaHandle {
  centralizar(id: string, opcoes?: OpcoesCentralizar): boolean;
  /** Ver praça completa (inclui as posições superiores). */
  visaoGeral(): void;
  /** Focar L'Oréal: volta ao enquadramento inicial da área principal. */
  focarPrincipal(): void;
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
  /**
   * Seletor dos controles sobrepostos (irmãos do mapa) medidos na hora de
   * enquadrar; quando informado, substitui `margens`.
   */
  sobrepostos?: string;
  aoSelecionar: (id: string) => void;
  /** Posição escolhida no mapa (sem palete por cima). */
  aoEscolherPosicao?: (posicaoId: string) => void;
  aoMudarVisao: (visao: VisaoMapa) => void;
}

/**
 * Integra o Leaflet ao React: o mapa é criado uma vez por layout e recebe
 * dados, seleção e filtro sem ser recriado, preservando a câmera.
 */
export function MapaPraca({ ref, layout, paletes, selecionadoId, idsVisiveis, margens, sobrepostos, aoSelecionar, aoEscolherPosicao, aoMudarVisao }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controladorRef = useRef<ControladorMapa | null>(null);
  const layoutAtual = useEffectEvent(() => layout);
  const selecionar = useEffectEvent((id: string) => {
    aoSelecionar(id);
  });
  const escolherPosicao = useEffectEvent((id: string) => {
    aoEscolherPosicao?.(id);
  });
  const mudarVisao = useEffectEvent((visao: VisaoMapa) => {
    aoMudarVisao(visao);
  });
  const margensAtuais = useEffectEvent(() => margens);
  // Caixas dos controles sobrepostos em px relativos ao mapa, medidas na hora (o controle visível agora).
  const medirSobrepostos = useEffectEvent((): Caixa[] | null => {
    const container = containerRef.current;
    if (sobrepostos === undefined || !container?.parentElement) return null;
    const base = container.getBoundingClientRect();
    return [...container.parentElement.querySelectorAll<HTMLElement>(sobrepostos)].map((el) => {
      const r = el.getBoundingClientRect();
      return { esquerda: r.left - base.left, topo: r.top - base.top, direita: r.right - base.left, base: r.bottom - base.top };
    });
  });

  useImperativeHandle(
    ref,
    () => ({
      centralizar: (id, opcoes) => controladorRef.current?.centralizar(id, opcoes) ?? false,
      visaoGeral: () => controladorRef.current?.visaoGeral(),
      focarPrincipal: () => controladorRef.current?.focarPrincipal(),
      focarElemento: (codigo) => controladorRef.current?.focarElemento(codigo),
      ampliar: () => controladorRef.current?.ampliar(),
      reduzir: () => controladorRef.current?.reduzir(),
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controlador = new ControladorMapa(container, layoutAtual(), {
      aoSelecionar: (id) => {
        selecionar(id);
      },
      aoEscolherPosicao: (id) => {
        escolherPosicao(id);
      },
      aoMudarVisao: (visao) => {
        mudarVisao(visao);
      },
    }, margensAtuais(), () => medirSobrepostos());
    controladorRef.current = controlador;
    return () => {
      controlador.destruir();
      controladorRef.current = null;
    };
    // Recriado só com outro layout ou outra revisão: ocupação e "palete livre" mudam sem perder a câmera.
  }, [layout.id, layout.revision]);

  useEffect(() => {
    controladorRef.current?.definirPosicoes(layout.positions);
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
        Setas movem a visão; mais e menos ampliam e reduzem; Home volta ao enquadramento da L'Oréal; C centraliza o palete
        selecionado. Para escolher um palete pelo teclado, use a lista de paletes.
      </p>
    </>
  );
}
