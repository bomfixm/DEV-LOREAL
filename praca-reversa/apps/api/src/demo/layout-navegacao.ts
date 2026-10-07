import { doisDigitos, type ElementoGerado, type FileiraGerada, type LayoutGerado, type PosicaoGerada } from '../modules/layout/tipos.js';

/**
 * Cenário de navegação fictício (zonas Norte e Sul da etapa 01), mantido como
 * fixture separada para testar navegação com mais elementos. Não representa a
 * praça real. Medidas em unidades de desenho, sem escala física.
 */
export const GEOMETRIA = {
  margem: 40,
  larguraPosicao: 80,
  alturaPosicao: 52,
  espacoColunas: 8,
  larguraRotuloRua: 64,
  cabecalhoZona: 48,
  corredor: 40,
  espacoZonas: 96,
  folga: 16,
  larguraDoca: 160,
  alturaDoca: 64,
  espacoDocas: 48,
  quantidadeDocas: 6,
} as const;

export interface ZonaPlanejada {
  id: string;
  name: string;
  ruas: readonly string[];
  colunas: readonly string[];
}

function intervaloLetras(inicio: string, fim: string): string[] {
  const letras: string[] = [];
  for (let c = inicio.charCodeAt(0); c <= fim.charCodeAt(0); c++) letras.push(String.fromCharCode(c));
  return letras;
}

function colunasNumeradas(quantidade: number): string[] {
  return Array.from({ length: quantidade }, (_, i) => doisDigitos(i + 1));
}

export const ZONAS_NAVEGACAO: readonly ZonaPlanejada[] = [
  { id: 'Z-NORTE', name: 'Zona Norte (fictícia)', ruas: intervaloLetras('C', 'J'), colunas: colunasNumeradas(24) },
  { id: 'Z-SUL', name: 'Zona Sul (fictícia)', ruas: intervaloLetras('K', 'R'), colunas: colunasNumeradas(24) },
];

/** Posições indisponíveis do cenário fictício (mesmas da etapa 01). */
export const ENDERECOS_INDISPONIVEIS: ReadonlySet<string> = new Set(['D-12', 'D-13', 'G-01', 'L-20', 'O-07', 'R-24']);

/** Posições sem palete do cenário: padrão determinístico da etapa 01, sem significado operacional. */
export function posicaoVaziaDemo(rua: string, coluna: string): boolean {
  return (rua.charCodeAt(0) * 7 + Number(coluna) * 5) % 9 === 0;
}

function medidas(zona: ZonaPlanejada): { largura: number; altura: number } {
  const g = GEOMETRIA;
  const colunas = zona.colunas.length;
  const ruas = zona.ruas.length;
  return {
    largura: g.larguraRotuloRua + colunas * g.larguraPosicao + (colunas - 1) * g.espacoColunas + g.folga,
    altura: g.cabecalhoZona + ruas * g.alturaPosicao + (ruas - 1) * g.corredor + g.folga,
  };
}

export function gerarLayoutNavegacao(zonas: readonly ZonaPlanejada[] = ZONAS_NAVEGACAO): LayoutGerado {
  const g = GEOMETRIA;
  const elementos: ElementoGerado[] = [];
  const fileiras: FileiraGerada[] = [];
  const posicoes: PosicaoGerada[] = [];
  const x = g.margem;
  let y = g.margem;
  let ordem = 0;
  let larguraMaxima = 0;

  zonas.forEach((zona, indiceZona) => {
    const { largura, altura } = medidas(zona);
    if (indiceZona > 0) {
      elementos.push({
        codigo: `COR-PRINCIPAL-${String(indiceZona)}`,
        tipo: 'CORREDOR',
        rotulo: 'Corredor principal (fictício)',
        ficticio: true,
        x,
        y: y - g.espacoZonas,
        largura,
        altura: g.espacoZonas,
        caixaRotulo: { x, y: y - g.espacoZonas, largura, altura: g.espacoZonas },
      });
    }
    elementos.push({
      codigo: zona.id,
      tipo: 'ZONA',
      rotulo: zona.name,
      ficticio: true,
      x,
      y,
      largura,
      altura,
      // Título dentro da faixa de cabeçalho da própria zona.
      caixaRotulo: { x: x + 8, y: y + 8, largura: largura - 16, altura: g.cabecalhoZona - 16 },
    });

    const larguraRuas = zona.colunas.length * g.larguraPosicao + (zona.colunas.length - 1) * g.espacoColunas;
    zona.ruas.forEach((rua, indiceRua) => {
      ordem++;
      const yRua = y + g.cabecalhoZona + indiceRua * (g.alturaPosicao + g.corredor);
      fileiras.push({
        codigo: rua,
        rotulo: `Rua ${rua}`,
        ordem,
        blocoCodigo: zona.id,
        x: x + 4,
        y: yRua,
        largura: g.larguraRotuloRua - 4 + larguraRuas,
        altura: g.alturaPosicao,
        caixaRotulo: { x: x + 4, y: yRua, largura: g.larguraRotuloRua - 12, altura: g.alturaPosicao },
      });
      zona.colunas.forEach((coluna, indiceColuna) => {
        const codigo = `${rua}-${coluna}`;
        posicoes.push({
          codigo,
          fileiraCodigo: rua,
          numero: indiceColuna + 1,
          x: x + g.larguraRotuloRua + indiceColuna * (g.larguraPosicao + g.espacoColunas),
          y: yRua,
          largura: g.larguraPosicao,
          altura: g.alturaPosicao,
          disponivel: !ENDERECOS_INDISPONIVEIS.has(codigo),
          // Cenário fictício com cadastro completo: posição sem palete = sem registro.
          ocupacaoLevantada: true,
        });
      });
      const proxima = zona.ruas[indiceRua + 1];
      if (proxima !== undefined) {
        const corredor = { x: x + g.larguraRotuloRua, y: yRua + g.alturaPosicao, largura: larguraRuas, altura: g.corredor };
        elementos.push({
          codigo: `COR-${rua}-${proxima}`,
          tipo: 'CORREDOR',
          rotulo: `Corredor ${rua}–${proxima} (fictício)`,
          ficticio: true,
          ...corredor,
          caixaRotulo: corredor,
        });
      }
    });
    y += altura + g.espacoZonas;
    larguraMaxima = Math.max(larguraMaxima, largura);
  });

  const yDocas = y - g.espacoZonas + g.espacoDocas;
  for (let i = 0; i < g.quantidadeDocas; i++) {
    const doca = { x: x + i * (g.larguraDoca + g.espacoDocas), y: yDocas, largura: g.larguraDoca, altura: g.alturaDoca };
    elementos.push({
      codigo: `DOCA-${doisDigitos(i + 1)}`,
      tipo: 'DOCA',
      rotulo: `Doca ${doisDigitos(i + 1)} (fictícia)`,
      ficticio: true,
      ...doca,
      caixaRotulo: doca,
    });
  }

  return {
    largura: x + Math.max(larguraMaxima, g.quantidadeDocas * (g.larguraDoca + g.espacoDocas)) + g.margem,
    altura: yDocas + g.alturaDoca + g.margem,
    elementos,
    fileiras,
    posicoes,
  };
}
