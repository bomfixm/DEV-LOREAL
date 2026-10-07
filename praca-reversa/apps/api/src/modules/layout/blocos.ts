import { z } from 'zod';
import { doisDigitos, type ElementoGerado, type FileiraGerada, type PosicaoGerada, type RetanguloUd } from './tipos.js';

/** Recuo do contorno do bloco em volta das fileiras. */
export const RECUO_BLOCO = 6;
/** Distância entre o título do bloco e o contorno do bloco. */
export const FOLGA_TITULO = 8;

/**
 * Parâmetros de desenho do layout, em unidades de desenho (não são metros).
 * Usados para gerar blocos de fileiras: fileira única ou par de fileiras
 * próximas, com o título no espaço entre blocos.
 */
export const ParametrosGeometriaSchema = z
  .object({
    margem: z.number().int().min(RECUO_BLOCO).max(2_000),
    larguraRotuloFileira: z.number().int().min(16).max(2_000),
    larguraPosicao: z.number().int().positive().max(2_000),
    alturaPosicao: z.number().int().positive().max(2_000),
    espacoEntrePosicoes: z.number().int().nonnegative().max(2_000),
    espacoDentroDoPar: z.number().int().nonnegative().max(2_000),
    espacoEntreBlocos: z.number().int().positive().max(5_000),
    alturaTituloBloco: z.number().int().positive().max(2_000),
  })
  .refine((g) => g.espacoEntreBlocos >= g.alturaTituloBloco + FOLGA_TITULO + 2 * RECUO_BLOCO, 'espacoEntreBlocos não comporta o título do bloco.');
export type ParametrosGeometria = z.infer<typeof ParametrosGeometriaSchema>;

/**
 * Padrão para layouts configurados pelo aplicativo: as mesmas medidas do
 * esquema informado (examples/layout-praca-informado.json). Valores de desenho,
 * sem medição física da praça.
 */
export const PARAMETROS_PADRAO: ParametrosGeometria = {
  margem: 48,
  larguraRotuloFileira: 72,
  larguraPosicao: 80,
  alturaPosicao: 52,
  espacoEntrePosicoes: 8,
  espacoDentroDoPar: 12,
  espacoEntreBlocos: 88,
  alturaTituloBloco: 36,
};

export interface DefinicaoBloco {
  tipo: 'UNICA' | 'PAR';
  posicoesPorFileira: number;
  titulo: string;
}

export interface BlocoGerado {
  elemento: ElementoGerado;
  fileiras: FileiraGerada[];
  posicoes: PosicaoGerada[];
  /** Coordenada y da base das fileiras do bloco. */
  base: number;
}

export function larguraFileira(g: ParametrosGeometria, posicoes: number): number {
  return g.larguraRotuloFileira + posicoes * g.larguraPosicao + (posicoes - 1) * g.espacoEntrePosicoes;
}

/** Topo das fileiras do primeiro bloco (abaixo do espaço do título). */
export function topoInicial(g: ParametrosGeometria): number {
  return g.margem + g.alturaTituloBloco + FOLGA_TITULO;
}

/**
 * Gera um bloco a partir do topo das suas fileiras. Fileiras recebem códigos
 * sequenciais (F01, F02…); posições são numeradas a partir de 1 em cada
 * fileira (F01-P01…). Códigos provisórios; o título fica acima do bloco, fora
 * dos alvos de seleção.
 */
export function gerarBloco(
  g: ParametrosGeometria,
  bloco: DefinicaoBloco,
  local: { topo: number; ordemInicial: number; codigoBloco: string; ocupacaoLevantada: boolean },
): BlocoGerado {
  const quantidade = bloco.tipo === 'PAR' ? 2 : 1;
  const largura = larguraFileira(g, bloco.posicoesPorFileira);
  const fileiras: FileiraGerada[] = [];
  const posicoes: PosicaoGerada[] = [];

  for (let k = 0; k < quantidade; k++) {
    const ordem = local.ordemInicial + k;
    const codigo = `F${doisDigitos(ordem)}`;
    const yFileira = local.topo + k * (g.alturaPosicao + g.espacoDentroDoPar);
    fileiras.push({
      codigo,
      rotulo: codigo,
      ordem,
      blocoCodigo: local.codigoBloco,
      x: g.margem,
      y: yFileira,
      largura,
      altura: g.alturaPosicao,
      caixaRotulo: { x: g.margem, y: yFileira, largura: g.larguraRotuloFileira - 8, altura: g.alturaPosicao },
    });
    for (let n = 1; n <= bloco.posicoesPorFileira; n++) {
      posicoes.push({
        codigo: `${codigo}-P${doisDigitos(n)}`,
        fileiraCodigo: codigo,
        numero: n,
        x: g.margem + g.larguraRotuloFileira + (n - 1) * (g.larguraPosicao + g.espacoEntrePosicoes),
        y: yFileira,
        largura: g.larguraPosicao,
        altura: g.alturaPosicao,
        disponivel: true,
        ocupacaoLevantada: local.ocupacaoLevantada,
      });
    }
  }

  const alturaBloco = quantidade * g.alturaPosicao + (quantidade - 1) * g.espacoDentroDoPar;
  const caixaRotulo: RetanguloUd = {
    x: g.margem,
    y: local.topo - FOLGA_TITULO - g.alturaTituloBloco,
    largura,
    altura: g.alturaTituloBloco,
  };
  return {
    elemento: {
      codigo: local.codigoBloco,
      tipo: 'BLOCO',
      rotulo: bloco.titulo,
      ficticio: false,
      x: g.margem - RECUO_BLOCO,
      y: local.topo - RECUO_BLOCO,
      largura: largura + 2 * RECUO_BLOCO,
      altura: alturaBloco + 2 * RECUO_BLOCO,
      caixaRotulo,
    },
    fileiras,
    posicoes,
    base: local.topo + alturaBloco,
  };
}

/**
 * Espaço do título de uma zona: faixa no topo, dentro da zona. `null` quando
 * a zona é pequena demais (o nome continua no seletor e na lista).
 */
export function caixaTituloZona(r: RetanguloUd): RetanguloUd | null {
  if (r.largura < 48 || r.altura < 24) return null;
  return { x: r.x + 8, y: r.y + 6, largura: r.largura - 16, altura: Math.min(28, r.altura - 12) };
}
