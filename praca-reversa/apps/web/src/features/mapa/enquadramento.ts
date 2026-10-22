import type { ElementoLayout, Posicao, Retangulo } from '@praca-reversa/contracts';

/**
 * Enquadramento do mapa (20 out. 2026): a vista inicial mostra a área
 * principal (L'Oréal) inteira, com as posições vazias, no maior tamanho que
 * cabe no espaço livre entre os controles sobrepostos. Nada aqui altera
 * posições ou endereços: só calcula retângulos e margens.
 */

/**
 * 0: sem rótulos; 1: endereço curto de cada posição ("A120"); 2: endereço
 * completo (código só no palete selecionado); 3: endereço, código e situação
 * (e o estado das posições vazias).
 */
export type NivelDetalhe = 0 | 1 | 2 | 3;

export function nivelDetalhe(larguraPaletePx: number): NivelDetalhe {
  if (larguraPaletePx >= 112) return 3;
  if (larguraPaletePx >= 60) return 2;
  if (larguraPaletePx >= 30) return 1;
  return 0;
}

export interface Margens {
  topo: number;
  direita: number;
  base: number;
  esquerda: number;
}

/** Caixa de um controle sobreposto, em px relativos ao canto superior esquerdo do mapa. */
export interface Caixa {
  esquerda: number;
  topo: number;
  direita: number;
  base: number;
}

export function uniao(retangulos: readonly Retangulo[]): Retangulo | null {
  if (retangulos.length === 0) return null;
  const x0 = Math.min(...retangulos.map((r) => r.x));
  const y0 = Math.min(...retangulos.map((r) => r.y));
  const x1 = Math.max(...retangulos.map((r) => r.x + r.width));
  const y1 = Math.max(...retangulos.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function contem(r: Retangulo, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

/**
 * Área principal da praça: as zonas do layout que têm posições em uso (não
 * desativadas) — no desenho aprovado, "Praça da reversa · L'Oréal", embaixo;
 * a área desativada de cima fica de fora. Sem zona com posição em uso, o
 * conjunto das posições em uso; sem nenhuma, a praça inteira.
 */
export function areaPrincipal(layout: {
  width: number;
  height: number;
  elements: readonly Pick<ElementoLayout, 'kind' | 'x' | 'y' | 'width' | 'height'>[];
  positions: readonly Pick<Posicao, 'x' | 'y' | 'width' | 'height' | 'deactivated'>[];
}): Retangulo {
  const emUso = layout.positions.filter((p) => !p.deactivated);
  const centros = emUso.map((p) => ({ x: p.x + p.width / 2, y: p.y + p.height / 2 }));
  const zonas = layout.elements.filter((e) => e.kind === 'ZONA' && centros.some((c) => contem(e, c.x, c.y)));
  return uniao(zonas) ?? uniao(emUso) ?? { x: 0, y: 0, width: layout.width, height: layout.height };
}

/**
 * Margens do enquadramento: cada controle sobreposto ocupa a borda que menos
 * reduz o tamanho da área (a área é alta e a tela larga: quem está no canto
 * vai para a lateral, quem é largo fica em cima ou embaixo). `minimas` é a
 * folga em volta da área; `folga` separa a área de cada controle.
 */
export function margensLivres(largura: number, altura: number, proporcao: number, caixas: readonly Caixa[], minimas: Margens, folga = 10): Margens {
  const validas = caixas
    .map((c) => ({ esquerda: Math.max(0, c.esquerda), topo: Math.max(0, c.topo), direita: Math.min(largura, c.direita), base: Math.min(altura, c.base) }))
    .filter((c) => c.direita > c.esquerda && c.base > c.topo)
    // Até 6 controles (4^6 combinações); os maiores pesam mais no resultado.
    .sort((a, b) => (b.direita - b.esquerda) * (b.base - b.topo) - (a.direita - a.esquerda) * (a.base - a.topo))
    .slice(0, 6);
  let melhor: Margens = { ...minimas };
  let melhorValor = -Infinity;
  for (let k = 0; k < 4 ** validas.length; k++) {
    const m: Margens = { ...minimas };
    let n = k;
    for (const c of validas) {
      const lado = n % 4;
      n = Math.floor(n / 4);
      if (lado === 0) m.esquerda = Math.max(m.esquerda, c.direita + folga);
      else if (lado === 1) m.direita = Math.max(m.direita, largura - c.esquerda + folga);
      else if (lado === 2) m.topo = Math.max(m.topo, c.base + folga);
      else m.base = Math.max(m.base, altura - c.topo + folga);
    }
    const livreLargura = largura - m.esquerda - m.direita;
    const livreAltura = altura - m.topo - m.base;
    if (livreLargura <= 0 || livreAltura <= 0) continue;
    // Altura útil equivalente: o lado que limita o enquadramento.
    const valor = Math.min(livreLargura / proporcao, livreAltura);
    if (valor > melhorValor + 0.01) {
      melhor = m;
      melhorValor = valor;
    }
  }
  return melhor;
}

/**
 * Endereço curto para posição estreita: sem o número da rua, que está no
 * título do bloco ("15 - A120" → "A120"; "GR - 9" → "GR9"). Proposta e
 * posição sem correspondência mostram só o número da posição (nunca um
 * endereço presumido).
 */
export function enderecoCurto(posicao: Pick<Posicao, 'code' | 'address'> | undefined, codigo: string | null): string {
  const endereco = posicao?.address ?? null;
  if (endereco?.state === 'CONFIRMADO') {
    const texto = endereco.text.trim();
    const grade = /^GR\s*-?\s*(\d+)$/i.exec(texto);
    if (grade) return `GR${grade[1] ?? ''}`;
    const rua = /^\d+\s*-\s*(.+)$/.exec(texto);
    return rua?.[1]?.trim() ?? texto;
  }
  const base = codigo ?? posicao?.code ?? '';
  const numero = /-(P\d+)$/i.exec(base);
  return numero?.[1] ?? base;
}
