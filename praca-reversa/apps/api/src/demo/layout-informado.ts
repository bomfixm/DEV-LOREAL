import { gerarBloco, larguraFileira, ParametrosGeometriaSchema, topoInicial } from '../modules/layout/blocos.js';
import { doisDigitos, type ElementoGerado, type FileiraGerada, type LayoutGerado, type PosicaoGerada } from '../modules/layout/tipos.js';
import type { ArquivoLayoutInformado } from './arquivos.js';

/**
 * Gera o esquema informado (15 primeiro, depois 17) a partir da configuração
 * central. Fileiras numeradas do início para o outro extremo (F01, F02…);
 * posições numeradas a partir de 1 em cada fileira (F01-P01…). Os títulos dos
 * blocos ficam no espaço entre blocos, fora dos alvos de seleção.
 */
export function gerarLayoutInformado(config: ArquivoLayoutInformado): LayoutGerado {
  const resultado = ParametrosGeometriaSchema.safeParse(config.geometria);
  if (!resultado.success) throw new Error(resultado.error.issues[0]?.message ?? 'Geometria inválida.');
  const g = resultado.data;

  const elementos: ElementoGerado[] = [];
  const fileiras: FileiraGerada[] = [];
  const posicoes: PosicaoGerada[] = [];
  let topo = topoInicial(g);
  let numeroBloco = 0;

  for (const bloco of config.sequencia) {
    for (let r = 0; r < bloco.repeticoes; r++) {
      numeroBloco++;
      const gerado = gerarBloco(
        g,
        { tipo: bloco.tipo, posicoesPorFileira: bloco.posicoesPorFileira, titulo: bloco.titulo },
        // Esquema ainda sem levantamento: ocupação desconhecida.
        { topo, ordemInicial: fileiras.length + 1, codigoBloco: `B${doisDigitos(numeroBloco)}`, ocupacaoLevantada: false },
      );
      elementos.push(gerado.elemento);
      fileiras.push(...gerado.fileiras);
      posicoes.push(...gerado.posicoes);
      topo = gerado.base + g.espacoEntreBlocos;
    }
  }

  const maiorFileira = Math.max(...config.sequencia.map((b) => b.posicoesPorFileira));
  return {
    largura: 2 * g.margem + larguraFileira(g, maiorFileira),
    altura: topo - g.espacoEntreBlocos + g.margem,
    elementos,
    fileiras,
    posicoes,
  };
}
