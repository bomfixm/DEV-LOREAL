import type { ElementoLayout, Layout, PaleteResumo, Posicao, Retangulo } from '@praca-reversa/contracts';
import * as L from 'leaflet';
import { estadoExibido } from '../paletes/estados';
import { criarConversor, recuar, type Conversor, type PontoLayout } from './coordenadas';
import { areaPrincipal, enderecoCurto, margensLivres, nivelDetalhe, type Caixa, type Margens, type NivelDetalhe } from './enquadramento';

export const ZOOM_MAXIMO = 2;
/** Zoom mínimo ao centralizar um palete: código e situação legíveis. */
export const ZOOM_LEGIVEL = 0.75;
const RECUO_PALETE = 5;
/** Folga de arraste em volta da praça: com a coluna de ferramentas, a área precisa poder ficar fora do centro da tela. */
const MARGEM_LIMITES = 0.5;
/** Folga em volta da área enquadrada (px), além do espaço dos controles sobrepostos. */
const FOLGA_ENQUADRAMENTO: Margens = { topo: 12, direita: 12, base: 12, esquerda: 12 };

export { nivelDetalhe, type NivelDetalhe } from './enquadramento';

/**
 * Situação de ocupação de uma posição sem palete vinculado. Área desativada
 * (desenho aprovado) fica fora da capacidade ativa: pronta para ativar, não
 * "indisponível" por um motivo operacional.
 */
export function ocupacaoSemPalete(
  posicao: Pick<Posicao, 'available' | 'occupancySurveyed'> & Partial<Pick<Posicao, 'deactivated' | 'freeConfirmed'>>,
): 'desativada' | 'indisponivel' | 'livre' | 'sem-registro' | 'desconhecida' {
  if (posicao.deactivated === true) return 'desativada';
  if (!posicao.available) return 'indisponivel';
  // "Palete livre" só com desocupação confirmada; sem palete registrado não basta.
  if (posicao.freeConfirmed != null) return 'livre';
  return posicao.occupancySurveyed ? 'sem-registro' : 'desconhecida';
}

export const TEXTO_OCUPACAO = {
  desativada: 'desativada · pronta para ativar',
  indisponivel: 'indisponível',
  livre: 'PALETE LIVRE',
  'sem-registro': 'sem palete registrado',
  desconhecida: 'ocupação desconhecida',
} as const;

export interface VisaoMapa {
  zoom: number;
  zoomMinimo: number;
  zoomMaximo: number;
  nivel: NivelDetalhe;
  centro: PontoLayout;
}

export interface EventosMapa {
  aoSelecionar(id: string): void;
  /** Posição desenhada escolhida (sem palete por cima): abre o detalhe da posição. */
  aoEscolherPosicao?(posicaoId: string): void;
  aoMudarVisao(visao: VisaoMapa): void;
}

/** Espaço em px ocupado por controles sobrepostos em cada borda do mapa. */
export interface MargensMapa {
  topo: number;
  direita: number;
  base: number;
  esquerda: number;
}

const MARGENS_PADRAO: MargensMapa = { topo: 16, direita: 16, base: 16, esquerda: 16 };

export interface OpcoesCentralizar {
  /** Altura em px coberta por um painel na base do mapa (celular). */
  deslocamentoInferiorPx?: number;
  animar?: boolean;
}

interface Rotulavel {
  chave: string;
  paleteId: string | null;
  centro: L.LatLng;
  nivelMinimo: 1 | 3;
  criar: () => HTMLElement;
}

/** Enquadramento atual (atributo de inspeção do mapa). */
export type Enquadramento = 'principal' | 'completo' | 'elemento' | 'palete';

function elemento(tag: string, classe: string, texto?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function icone(conteudo: HTMLElement, classe = 'pr-ancora'): L.DivIcon {
  return L.divIcon({ html: conteudo, className: classe, iconSize: [0, 0] });
}

/**
 * Endereço mostrado no rótulo: o real confirmado (ex.: "15 - A101") com o
 * código da posição; proposto aparece como proposta; sem correspondência, só o
 * código provisório (nunca um endereço presumido).
 */
export function textoEndereco(posicao: Pick<Posicao, 'code' | 'address'> | undefined, codigo: string | null): string {
  const base = codigo ?? posicao?.code ?? '';
  const endereco = posicao?.address ?? null;
  if (endereco === null) return base;
  return endereco.state === 'CONFIRMADO' ? `${endereco.text} · ${base}` : `${base} (proposto ${endereco.text})`;
}

/** Endereço operacional como rótulo: "15 - A120"; na Grade, "GR9" (aceita "GR 9" e "GR - 9" sem mudar o número). */
export function enderecoOperacional(texto: string): string {
  const grade = /^GR\s*-?\s*(\d+)$/i.exec(texto.trim());
  return grade ? `GR${grade[1] ?? ''}` : texto;
}

/**
 * Rótulo principal da posição no mapa: o endereço operacional confirmado; o
 * código técnico (F/P) fica no detalhe. Proposta e posição sem correspondência
 * continuam mostrando o código (nunca um endereço presumido).
 */
export function rotuloEnderecoMapa(posicao: Pick<Posicao, 'code' | 'address'> | undefined, codigo: string | null): string {
  const endereco = posicao?.address ?? null;
  if (endereco?.state === 'CONFIRMADO') return enderecoOperacional(endereco.text);
  return textoEndereco(posicao, codigo);
}

function reduzirMovimento(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Controla o mapa Leaflet (CRS.Simple) fora do ciclo de renderização do React.
 * Navegar altera somente a câmera; nenhum método altera posições ou estoque.
 */
export class ControladorMapa {
  private readonly container: HTMLElement;
  private readonly eventos: EventosMapa;
  private readonly mapa: L.Map;
  private readonly conv: Conversor;
  private readonly limites: L.LatLngBounds;
  private readonly layout: Layout;
  private readonly posicoes: Map<string, Posicao>;
  private readonly larguraPalete: number;
  private readonly camadaPaletes = L.layerGroup();
  private readonly camadaRotulos = L.layerGroup();
  private readonly formas = new Map<string, L.Rectangle>();
  private readonly formasPosicao = new Map<string, L.Rectangle>();
  private readonly rotulosAtivos = new Map<string, { marcador: L.Marker; el: HTMLElement; paleteId: string | null }>();
  private readonly observador: ResizeObserver;
  /** Títulos limitados ao espaço reservado; ocultos quando não cabem. */
  private readonly rotulosEmCaixa: HTMLElement[] = [];
  private rotulaveis: Rotulavel[] = [];
  private selecionado: string | null = null;
  private visiveis: ReadonlySet<string> | null = null;
  private nivel: NivelDetalhe = 0;
  private margens: MargensMapa;
  /** Área principal (L'Oréal): enquadrada ao abrir e em "Focar L'Oréal". */
  private readonly principal: L.LatLngBounds;
  /** Caixas dos controles sobrepostos no momento do enquadramento (computador); `null` = margens fixas. */
  private readonly medirSobrepostos: (() => Caixa[] | null) | null;
  /** Enquadramento inicial aguardando o contêiner ter tamanho; qualquer comando de câmera o cancela. */
  private vistaInicialPendente = false;

  constructor(container: HTMLElement, layout: Layout, eventos: EventosMapa, margens: MargensMapa = MARGENS_PADRAO, medirSobrepostos: (() => Caixa[] | null) | null = null) {
    this.container = container;
    this.eventos = eventos;
    this.layout = layout;
    this.margens = margens;
    this.medirSobrepostos = medirSobrepostos;
    this.conv = criarConversor(layout.height);
    this.posicoes = new Map(layout.positions.map((p) => [p.id, p]));
    const referencia = layout.positions[0];
    this.larguraPalete = referencia ? recuar(referencia, RECUO_PALETE).width : 70;
    this.limites = this.limitesDe({ x: 0, y: 0, width: layout.width, height: layout.height });
    this.principal = this.limitesDe(areaPrincipal(layout));

    const animar = !reduzirMovimento();
    this.mapa = L.map(container, {
      crs: L.CRS.Simple,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      minZoom: -6,
      maxZoom: ZOOM_MAXIMO,
      maxBounds: this.limites.pad(MARGEM_LIMITES),
      maxBoundsViscosity: 1,
      bounceAtZoomLimits: false,
      zoomControl: false,
      attributionControl: false,
      trackResize: false,
      keyboardPanDelta: 120,
      zoomAnimation: animar,
      fadeAnimation: animar,
      markerZoomAnimation: animar,
      renderer: L.svg({ padding: 0.5 }),
    });

    this.desenharBase();
    this.camadaPaletes.addTo(this.mapa);
    this.camadaRotulos.addTo(this.mapa);

    this.mapa.on('movestart zoomstart', this.aoIniciarMovimento);
    this.mapa.on('zoomend', this.aoMudarZoom);
    this.mapa.on('moveend', this.aoMover);
    container.addEventListener('keydown', this.aoTeclar);
    this.ajustarZoomMinimo();
    // Vista inicial: a área principal inteira, no maior tamanho que cabe. Sem tamanho ainda
    // (contêiner oculto), enquadra provisoriamente e repete quando o tamanho chegar.
    const tamanho = this.mapa.getSize();
    this.vistaInicialPendente = tamanho.x === 0 || tamanho.y === 0;
    this.enquadrarExato(this.principal, false, 'principal');
    this.aoMudarZoom();
    this.aoMover();
    this.observador = new ResizeObserver(this.aoRedimensionar);
    this.observador.observe(container);
  }

  destruir(): void {
    this.observador.disconnect();
    this.container.removeEventListener('keydown', this.aoTeclar);
    this.mapa.off();
    this.mapa.remove();
    this.formas.clear();
    this.rotulosAtivos.clear();
  }

  /** Desenha os paletes a partir do vínculo de posição registrado (mesma fonte da lista). */
  definirPaletes(paletes: readonly PaleteResumo[]): void {
    this.camadaPaletes.clearLayers();
    this.formas.clear();
    const rotulaveis: Rotulavel[] = [];
    const ocupadas = new Set<string>();

    for (const palete of paletes) {
      const posicao = palete.positionId === null ? undefined : this.posicoes.get(palete.positionId);
      if (!posicao) continue; // localização pendente: aparece somente na lista
      ocupadas.add(posicao.id);
      const area = recuar(posicao, RECUO_PALETE);
      const forma = L.rectangle(this.limitesDe(area), {
        // Preenchimento: neutro = estoque, lilás = separação para agenda (reservado); conferência no contorno e no rótulo.
        // Reconferência vencida (20 dias): laranja adicional; agenda, conferência e seleção continuam com seus marcadores.
        className: `pr-palete pr-palete--${estadoExibido(palete).chave}${palete.activeCountId !== null ? ' pr-palete--em-conferencia' : ''}${palete.flowState === 'RESERVADO' ? ' pr-palete--agenda' : ''}${palete.reconference?.due === true ? ' pr-palete--reconferencia' : ''}`,
        bubblingMouseEvents: false,
      });
      forma.on('click', () => {
        this.eventos.aoSelecionar(palete.id);
      });
      forma.addTo(this.camadaPaletes);
      const caminho = forma.getElement();
      caminho?.setAttribute('data-palete-id', palete.id);
      caminho?.setAttribute('data-codigo', palete.code);
      caminho?.setAttribute('data-estado', estadoExibido(palete).chave);
      if (palete.activeCountId !== null) caminho?.setAttribute('data-em-conferencia', 'true');
      if (palete.flowState === 'RESERVADO') caminho?.setAttribute('data-agenda', 'true');
      this.formas.set(palete.id, forma);
      rotulaveis.push({
        chave: `p:${palete.id}`,
        paleteId: palete.id,
        centro: this.latLng(this.conv.centroDe(area)),
        nivelMinimo: 1,
        criar: () => this.criarRotuloPalete(palete),
      });
    }

    for (const posicao of this.posicoes.values()) {
      if (ocupadas.has(posicao.id)) continue;
      rotulaveis.push({
        chave: `e:${posicao.id}`,
        paleteId: null,
        centro: this.latLng(this.conv.centroDe(posicao)),
        // Posição em uso: endereço desde o primeiro nível; área desativada só de perto.
        nivelMinimo: posicao.deactivated ? 3 : 1,
        criar: () => this.criarRotuloPosicao(posicao),
      });
    }

    this.rotulaveis = rotulaveis;
    this.camadaRotulos.clearLayers();
    this.rotulosAtivos.clear();
    this.aplicarClasses();
    this.atualizarRotulos();
  }

  /**
   * Atualiza o estado das posições já desenhadas (ex.: "palete livre") sem
   * recriar o mapa nem perder a câmera; os rótulos são refeitos na próxima
   * definição de paletes.
   */
  definirPosicoes(posicoes: readonly Posicao[]): void {
    for (const p of posicoes) {
      if (!this.posicoes.has(p.id)) continue;
      this.posicoes.set(p.id, p);
      const el = this.formasPosicao.get(p.id)?.getElement();
      if (!el) continue;
      for (const c of [...el.classList]) if (c.startsWith('pr-posicao--')) el.classList.remove(c);
      el.classList.add(`pr-posicao--${ocupacaoSemPalete(p)}`);
      if (p.freeConfirmed) el.setAttribute('data-livre', 'true');
      else el.removeAttribute('data-livre');
    }
  }

  selecionar(id: string | null): void {
    this.selecionado = id;
    this.aplicarClasses();
    if (id !== null) this.formas.get(id)?.bringToFront();
  }

  /** Paletes que correspondem ao filtro da lista; os demais ficam esmaecidos. */
  definirVisiveis(ids: ReadonlySet<string> | null): void {
    this.visiveis = ids;
    this.aplicarClasses();
  }

  /**
   * Enquadra o palete em nível legível, onde ele estiver (também fora da área
   * principal). Retorna `false` se ele não está no mapa.
   */
  centralizar(id: string, opcoes: OpcoesCentralizar = {}): boolean {
    const forma = this.formas.get(id);
    if (!forma) return false;
    this.vistaInicialPendente = false;
    this.container.dataset.enquadramento = 'palete';
    const zoom = Math.min(Math.max(this.mapa.getZoom(), ZOOM_LEGIVEL), this.mapa.getMaxZoom());
    let centro = forma.getBounds().getCenter();
    const deslocamento = opcoes.deslocamentoInferiorPx ?? 0;
    if (deslocamento > 0) {
      centro = this.mapa.unproject(this.mapa.project(centro, zoom).add([0, deslocamento / 2]), zoom);
    }
    this.mapa.setView(centro, zoom, { animate: (opcoes.animar ?? true) && !reduzirMovimento() });
    return true;
  }

  /** Atualiza o espaço reservado aos controles; vale para o próximo enquadramento. */
  definirMargens(margens: MargensMapa): void {
    this.margens = margens;
  }

  /** "Ver praça completa": a praça inteira, inclusive as posições superiores. */
  visaoGeral(animar = true): void {
    this.vistaInicialPendente = false;
    this.enquadrarExato(this.limites, animar, 'completo');
  }

  /** "Focar L'Oréal": volta ao enquadramento inicial (área principal inteira). */
  focarPrincipal(animar = true): void {
    this.vistaInicialPendente = false;
    this.enquadrarExato(this.principal, animar, 'principal');
  }

  /** Enquadra uma zona ou bloco do layout. */
  focarElemento(codigo: string): void {
    const alvo = this.layout.elements.find((e) => e.code === codigo);
    if (!alvo) return;
    this.vistaInicialPendente = false;
    this.enquadrarExato(this.limitesDe(alvo), true, 'elemento');
  }

  ampliar(): void {
    this.vistaInicialPendente = false;
    this.mapa.zoomIn();
  }

  reduzir(): void {
    this.vistaInicialPendente = false;
    this.mapa.zoomOut();
  }

  /**
   * Maior zoom em que os limites cabem inteiros no espaço livre: entre os
   * controles sobrepostos medidos agora (computador) ou as margens fixas
   * (celular), com uma pequena folga. Zoom calculado, sem degrau fixo.
   */
  private enquadrarExato(limites: L.LatLngBounds, animar: boolean, tipo: Enquadramento): void {
    this.container.dataset.enquadramento = tipo;
    const tamanho = this.mapa.getSize();
    const no = this.mapa.project(limites.getNorthWest(), 0);
    const se = this.mapa.project(limites.getSouthEast(), 0);
    const larguraU = Math.abs(se.x - no.x);
    const alturaU = Math.abs(se.y - no.y);
    const caixas = this.medirSobrepostos?.() ?? null;
    const m: Margens = caixas === null ? this.margens : margensLivres(tamanho.x, tamanho.y, larguraU / Math.max(alturaU, 1), caixas, FOLGA_ENQUADRAMENTO);
    const livreX = tamanho.x - m.esquerda - m.direita;
    const livreY = tamanho.y - m.topo - m.base;
    if (livreX <= 0 || livreY <= 0 || larguraU <= 0 || alturaU <= 0) {
      // Sem espaço medido (contêiner oculto): enquadramento provisório.
      this.mapa.fitBounds(limites, { animate: false });
      return;
    }
    const zoom = Math.min(Math.max(this.mapa.getScaleZoom(Math.min(livreX / larguraU, livreY / alturaU), 0), this.mapa.getMinZoom()), this.mapa.getMaxZoom());
    // O centro dos limites vai para o centro do espaço livre (não do contêiner).
    const centro = this.mapa.unproject(this.mapa.project(limites.getCenter(), zoom).subtract(L.point((m.esquerda - m.direita) / 2, (m.topo - m.base) / 2)), zoom);
    const passo = this.mapa.options.zoomSnap;
    this.mapa.options.zoomSnap = 0;
    try {
      this.mapa.setView(centro, zoom, { animate: animar && !reduzirMovimento() });
    } finally {
      this.mapa.options.zoomSnap = passo;
    }
  }

  private limitesDe(r: Retangulo): L.LatLngBounds {
    const [[sul, oeste], [norte, leste]] = this.conv.limitesDe(r);
    return L.latLngBounds(L.latLng(sul, oeste), L.latLng(norte, leste));
  }

  private latLng(ponto: PontoLayout): L.LatLng {
    const [lat, lng] = this.conv.paraLatLng(ponto);
    return L.latLng(lat, lng);
  }

  /** Rótulo ancorado no canto superior esquerdo do espaço reservado e limitado a ele. */
  private rotuloEmCaixa(classe: string, texto: string, caixa: Retangulo): L.Marker {
    const el = elemento('div', `pr-rotulo-caixa ${classe}`);
    el.append(elemento('span', 'pr-rotulo-texto', texto));
    el.style.setProperty('--largura-ud', String(caixa.width));
    el.style.setProperty('--altura-ud', String(caixa.height));
    el.title = texto;
    this.rotulosEmCaixa.push(el);
    return L.marker(this.latLng({ x: caixa.x, y: caixa.y }), { interactive: false, keyboard: false, icon: icone(el) });
  }

  private desenharBase(): void {
    const base = L.layerGroup().addTo(this.mapa);
    const fixo = { interactive: false } as const;
    L.rectangle(this.limites, { ...fixo, className: 'pr-fundo' }).addTo(base);

    const classesElemento = (e: ElementoLayout) =>
      `pr-elemento pr-elemento--${e.kind}${e.fictional ? ' pr-elemento--ficticio' : ''}`;
    // Zonas e blocos por baixo; corredores e docas por cima delas.
    const ordem = { ZONA: 0, BLOCO: 1, CORREDOR: 2, DOCA: 2 } as const;
    for (const e of [...this.layout.elements].sort((a, b) => ordem[a.kind] - ordem[b.kind])) {
      L.rectangle(this.limitesDe(e), { ...fixo, className: classesElemento(e) }).addTo(base);
      if (e.labelBox) this.rotuloEmCaixa(`pr-titulo pr-titulo--${e.kind}`, e.label, e.labelBox).addTo(base);
    }

    for (const fileira of this.layout.rows) {
      this.rotuloEmCaixa('pr-rotulo-fileira', fileira.label, fileira.labelBox).addTo(base);
    }

    for (const posicao of this.layout.positions) {
      const forma = L.rectangle(this.limitesDe(posicao), {
        interactive: !posicao.deactivated,
        bubblingMouseEvents: false,
        className: `pr-posicao pr-posicao--${ocupacaoSemPalete(posicao)}`,
      });
      // O Leaflet só cria o elemento quando o mapa já tem visão: marcar no "add".
      forma.on('add', () => {
        forma.getElement()?.setAttribute('data-posicao', posicao.code);
        if (posicao.freeConfirmed) forma.getElement()?.setAttribute('data-livre', 'true');
      });
      if (!posicao.deactivated) {
        forma.on('click', () => {
          this.eventos.aoEscolherPosicao?.(posicao.id);
        });
      }
      forma.addTo(base);
      this.formasPosicao.set(posicao.id, forma);
      if (!posicao.available && !posicao.deactivated) {
        const { x, y, width: w, height: h } = recuar(posicao, 8);
        L.polyline(
          [
            [this.latLng({ x, y }), this.latLng({ x: x + w, y: y + h })],
            [this.latLng({ x: x + w, y }), this.latLng({ x, y: y + h })],
          ],
          { ...fixo, className: 'pr-posicao-x' },
        ).addTo(base);
      }
    }
  }

  private criarRotuloPalete(palete: PaleteResumo): HTMLElement {
    const { chave, rotulo } = estadoExibido(palete);
    const raiz = elemento('div', `pr-rotulo-palete pr-rotulo-palete--${chave}`);
    const posicao = palete.positionId === null ? undefined : this.posicoes.get(palete.positionId);
    // Endereço operacional em destaque; código do palete e código técnico da posição ficam como apoio.
    raiz.title = `${palete.code} · ${palete.positionCode ?? ''}`;
    raiz.append(
      // Curto (sem a rua) quando a posição é estreita; completo nos níveis seguintes.
      elemento('span', 'pr-rotulo-endereco pr-rotulo-endereco--curto', enderecoCurto(posicao, palete.positionCode)),
      elemento('span', 'pr-rotulo-endereco pr-rotulo-endereco--principal', rotuloEnderecoMapa(posicao, palete.positionCode)),
      elemento('span', 'pr-rotulo-codigo', palete.code),
      elemento('span', 'pr-rotulo-estado', `${rotulo.marcador} ${rotulo.curto}${palete.activeCountId !== null ? ' · ✎ em conferência' : ''}`),
    );
    if (palete.flowState === 'RESERVADO') raiz.append(elemento('span', 'pr-rotulo-agenda', 'AGENDA'));
    if (palete.reconference?.due === true) raiz.append(elemento('span', 'pr-rotulo-reconferencia', '⟳ Reconferência necessária'));
    return raiz;
  }

  private criarRotuloPosicao(posicao: Posicao): HTMLElement {
    const ocupacao = ocupacaoSemPalete(posicao);
    const raiz = elemento('div', `pr-rotulo-posicao pr-rotulo-posicao--${ocupacao}`);
    raiz.title = `${rotuloEnderecoMapa(posicao, posicao.code)} · ${posicao.code}`;
    raiz.append(
      elemento('span', 'pr-rotulo-endereco pr-rotulo-endereco--curto', enderecoCurto(posicao, posicao.code)),
      elemento('span', 'pr-rotulo-endereco pr-rotulo-endereco--principal', rotuloEnderecoMapa(posicao, posicao.code)),
      elemento('span', 'pr-rotulo-estado', TEXTO_OCUPACAO[ocupacao]),
    );
    return raiz;
  }

  private classesPalete(id: string): { selecionado: boolean; esmaecido: boolean } {
    return {
      selecionado: id === this.selecionado,
      esmaecido: this.visiveis !== null && !this.visiveis.has(id),
    };
  }

  private aplicarClasses(): void {
    for (const [id, forma] of this.formas) {
      const { selecionado, esmaecido } = this.classesPalete(id);
      const caminho = forma.getElement();
      caminho?.classList.toggle('pr-palete--selecionado', selecionado);
      caminho?.classList.toggle('pr-palete--esmaecido', esmaecido);
    }
    for (const rotulo of this.rotulosAtivos.values()) this.aplicarClassesRotulo(rotulo.el, rotulo.paleteId);
  }

  private aplicarClassesRotulo(el: HTMLElement, paleteId: string | null): void {
    if (paleteId === null) return;
    const { selecionado, esmaecido } = this.classesPalete(paleteId);
    el.classList.toggle('pr-rotulo-palete--selecionado', selecionado);
    el.classList.toggle('pr-rotulo-palete--esmaecido', esmaecido);
  }

  /** Mantém rótulos somente na área visível (com margem) e no nível de detalhe adequado. */
  private atualizarRotulos(): void {
    if (this.nivel === 0) {
      this.camadaRotulos.clearLayers();
      this.rotulosAtivos.clear();
      return;
    }
    const area = this.mapa.getBounds().pad(0.25);
    const desejados = new Set<string>();
    for (const r of this.rotulaveis) {
      if (r.nivelMinimo > this.nivel || !area.contains(r.centro)) continue;
      desejados.add(r.chave);
      if (this.rotulosAtivos.has(r.chave)) continue;
      const el = r.criar();
      this.aplicarClassesRotulo(el, r.paleteId);
      const marcador = L.marker(r.centro, { icon: icone(el), interactive: false, keyboard: false });
      marcador.addTo(this.camadaRotulos);
      this.rotulosAtivos.set(r.chave, { marcador, el, paleteId: r.paleteId });
    }
    for (const [chave, rotulo] of this.rotulosAtivos) {
      if (desejados.has(chave)) continue;
      this.camadaRotulos.removeLayer(rotulo.marcador);
      this.rotulosAtivos.delete(chave);
    }
  }

  private ajustarZoomMinimo(): void {
    const tamanho = this.mapa.getSize();
    if (tamanho.x === 0 || tamanho.y === 0) return;
    const ajuste = this.mapa.getBoundsZoom(this.limites, false, L.point(32, 32));
    this.mapa.setMinZoom(Math.floor((ajuste - 0.5) * 4) / 4);
  }

  private readonly aoMudarZoom = (): void => {
    const escala = L.CRS.Simple.scale(this.mapa.getZoom());
    const larguraPx = this.larguraPalete * escala;
    const nivel = nivelDetalhe(larguraPx);
    this.container.style.setProperty('--pr-palete-px', `${larguraPx.toFixed(1)}px`);
    this.container.style.setProperty('--pr-escala', escala.toFixed(4));
    if (nivel !== this.nivel) {
      this.container.classList.remove(`pr-nivel-${String(this.nivel)}`);
      this.nivel = nivel;
    }
    this.container.classList.add(`pr-nivel-${String(nivel)}`);
    // Título que não cabe no espaço reservado fica oculto neste zoom: nunca
    // invade posições selecionáveis. O nome continua no seletor e na lista.
    for (const el of this.rotulosEmCaixa) {
      el.classList.remove('pr-rotulo--sem-espaco');
      const texto = el.firstElementChild;
      const transborda =
        texto instanceof HTMLElement && (texto.offsetWidth > el.clientWidth || texto.offsetHeight > el.clientHeight);
      el.classList.toggle('pr-rotulo--sem-espaco', transborda);
    }
  };

  private readonly aoIniciarMovimento = (): void => {
    this.container.dataset.movendo = 'sim';
  };

  private readonly aoMover = (): void => {
    delete this.container.dataset.movendo;
    this.atualizarRotulos();
    const centro = this.mapa.getCenter();
    const ponto = this.conv.deLatLng([centro.lat, centro.lng]);
    const visao: VisaoMapa = {
      zoom: this.mapa.getZoom(),
      zoomMinimo: this.mapa.getMinZoom(),
      zoomMaximo: this.mapa.getMaxZoom(),
      nivel: this.nivel,
      centro: ponto,
    };
    // Atributos de inspeção para testes e suporte; não contêm dados de estoque.
    this.container.dataset.zoom = visao.zoom.toFixed(2);
    this.container.dataset.centroX = ponto.x.toFixed(1);
    this.container.dataset.centroY = ponto.y.toFixed(1);
    this.container.dataset.nivel = String(this.nivel);
    this.eventos.aoMudarVisao(visao);
  };

  /**
   * Novo tamanho (menu recolhido, janela redimensionada): mantém centro e zoom
   * da navegação do usuário. Só a vista inicial ainda pendente (contêiner que
   * estava oculto) é aplicada aqui, uma vez.
   */
  private readonly aoRedimensionar = (): void => {
    this.mapa.invalidateSize({ pan: true, animate: false });
    this.ajustarZoomMinimo();
    const tamanho = this.mapa.getSize();
    if (this.vistaInicialPendente && tamanho.x > 0 && tamanho.y > 0) {
      this.vistaInicialPendente = false;
      this.enquadrarExato(this.principal, false, 'principal');
    }
    this.aoMudarZoom();
    this.aoMover();
  };

  private readonly aoTeclar = (evento: KeyboardEvent): void => {
    if (evento.altKey || evento.ctrlKey || evento.metaKey) return;
    if (evento.key === 'Home') {
      evento.preventDefault();
      this.focarPrincipal();
    } else if ((evento.key === 'c' || evento.key === 'C') && this.selecionado !== null) {
      evento.preventDefault();
      this.centralizar(this.selecionado);
    }
  };
}
