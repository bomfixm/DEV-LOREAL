/**
 * Desenho aprovado da praça (Mapa_Praca_Reversa_Referencia.pdf): vista
 * superior com faixas verticais, P01 no topo e numeração crescendo para baixo
 * (convenção visual). A área desativada (DB01–DB07, 12 fileiras de 25) fica
 * acima, separada pelo corredor transversal; a área ativa (FB01–FB07: 17 à
 * esquerda, 15 à direita, topos alinhados) fica embaixo, com o corredor
 * frontal. Uma simples + cinco duplas + uma simples por área, com seis
 * corredores entre blocos; os eixos das duas áreas se alinham.
 *
 * Os códigos F/D/P são provisórios do desenho: P01 não equivale ao endereço
 * real nem ao número do palete. Endereços reais vêm da tabela de
 * correspondência (enderecos.ts). Nomes operacionais (Fileira 11–16, GR) e
 * prefixos dos endereços são os autorizados pelo operador.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { RAIZ_REPOSITORIO } from '../../config.js';
import { RECUO_BLOCO } from './blocos.js';
import { doisDigitos, type ElementoGerado, type FileiraGerada, type LayoutGerado, type PosicaoGerada } from './tipos.js';

const inteiroPositivo = z.number().int().positive();

export const ArquivoDesenhoAprovadoSchema = z.object({
  dataMode: z.literal('REFERENCIA'),
  fonte: z.string().min(1),
  aviso: z.string().min(1),
  versao: z.string().min(1),
  geometria: z.object({
    unidade: z.literal('UNIDADE_DE_DESENHO'),
    margem: inteiroPositivo,
    larguraPosicao: inteiroPositivo,
    alturaPosicao: inteiroPositivo,
    espacoEntrePosicoes: z.number().int().nonnegative(),
    espacoDentroDoPar: z.number().int().nonnegative(),
    larguraCorredor: inteiroPositivo,
    alturaTituloArea: inteiroPositivo,
    alturaTituloBloco: inteiroPositivo,
    alturaRotuloFileira: inteiroPositivo,
    alturaCorredorTransversal: inteiroPositivo,
    alturaCorredorFrontal: inteiroPositivo,
  }),
  areas: z
    .array(
      z.object({
        codigo: z.string().min(1),
        titulo: z.string().min(1),
        situacao: z.enum(['ATIVA', 'DESATIVADA']),
        prefixoBloco: z.string().regex(/^[A-Z]{1,3}$/),
        prefixoFileira: z.string().regex(/^[A-Z]{1,2}$/),
        prefixoCorredor: z.string().regex(/^[A-Z]{1,3}$/),
        blocos: z
          .array(
            z.object({
              tipo: z.enum(['UNICA', 'PAR']),
              posicoesPorFileira: z.number().int().min(1).max(60),
              nomeOperacional: z.string().min(2).max(60).optional(),
              prefixoEndereco: z.string().regex(/^[A-Z0-9]{1,4}$/).optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  corredores: z.object({
    transversal: z.object({ codigo: z.string().min(1), rotulo: z.string().min(1) }),
    frontal: z.object({ codigo: z.string().min(1), rotulo: z.string().min(1) }),
  }),
});
export type ArquivoDesenhoAprovado = z.infer<typeof ArquivoDesenhoAprovadoSchema>;

let embutido: unknown = null;

/** Hospedagem empacotada (Netlify Functions): o JSON vem por import estático, sem ler o disco por caminho relativo. */
export function definirDesenhoAprovadoEmbutido(conteudo: unknown): void {
  embutido = conteudo;
}

export function lerDesenhoAprovado(): ArquivoDesenhoAprovado {
  const conteudo: unknown = embutido ?? JSON.parse(readFileSync(`${RAIZ_REPOSITORIO}examples/layout-desenho-aprovado.json`, 'utf8'));
  return ArquivoDesenhoAprovadoSchema.parse(conteudo);
}

/** Motivo gravado nas posições da área desativada. */
export const MOTIVO_AREA_DESATIVADA = 'Área desativada do desenho aprovado: pronta para ativar (não comprova que a posição esteja vazia).';

/** Nomenclatura confirmada: bloco do desenho → nome operacional e prefixo do endereço. */
export function nomenclaturaAprovada(config: ArquivoDesenhoAprovado): { codigo: string; nome: string; prefixo: string }[] {
  const lista: { codigo: string; nome: string; prefixo: string }[] = [];
  for (const area of config.areas) {
    area.blocos.forEach((b, i) => {
      if (b.nomeOperacional !== undefined && b.prefixoEndereco !== undefined) {
        lista.push({ codigo: `${area.prefixoBloco}${doisDigitos(i + 1)}`, nome: b.nomeOperacional, prefixo: b.prefixoEndereco });
      }
    });
  }
  return lista;
}

/** Título exibido do bloco: nome operacional com o código do desenho. */
export function rotuloBloco(codigo: string, tipo: 'UNICA' | 'PAR', nomeOperacional: string | null, desativado: boolean): string {
  if (nomeOperacional !== null) return `${nomeOperacional} · ${codigo}`;
  return `${codigo} · ${tipo === 'PAR' ? 'duplo' : 'simples'}${desativado ? ' · desativado' : ''}`;
}

export function gerarDesenhoAprovado(config: ArquivoDesenhoAprovado): LayoutGerado {
  const g = config.geometria;
  const elementos: ElementoGerado[] = [];
  const fileiras: FileiraGerada[] = [];
  const posicoes: PosicaoGerada[] = [];

  // Colunas (x) de cada bloco: iguais nas duas áreas, para os eixos se alinharem.
  const larguraBloco = (tipo: 'UNICA' | 'PAR') => (tipo === 'PAR' ? 2 * g.larguraPosicao + g.espacoDentroDoPar : g.larguraPosicao);
  const referencia = config.areas[0]?.blocos ?? [];
  const xs: number[] = [];
  let cursor = g.margem;
  for (const b of referencia) {
    xs.push(cursor);
    cursor += larguraBloco(b.tipo) + g.larguraCorredor;
  }
  const larguraTotal = cursor - g.larguraCorredor + g.margem;
  for (const area of config.areas) {
    if (area.blocos.length !== referencia.length || area.blocos.some((b, i) => b.tipo !== referencia[i]?.tipo)) {
      throw new Error(`A área ${area.codigo} não tem a mesma sequência de blocos: os eixos não se alinham.`);
    }
  }

  let y = g.margem;
  let ordem = 0;
  config.areas.forEach((area, indiceArea) => {
    const desativada = area.situacao === 'DESATIVADA';
    const topoArea = y;
    const tituloBlocoY = topoArea + g.alturaTituloArea;
    const topoFaixa = tituloBlocoY + g.alturaTituloBloco + 8 + RECUO_BLOCO;
    const primeiraY = topoFaixa + g.alturaRotuloFileira + 4;
    let base = primeiraY;
    let numeroFileira = 0;
    area.blocos.forEach((bloco, i) => {
      const codigoBloco = `${area.prefixoBloco}${doisDigitos(i + 1)}`;
      const x0 = xs[i] ?? g.margem;
      const quantidade = bloco.tipo === 'PAR' ? 2 : 1;
      let baseBloco = primeiraY;
      for (let k = 0; k < quantidade; k++) {
        numeroFileira += 1;
        ordem += 1;
        const codigo = `${area.prefixoFileira}${doisDigitos(numeroFileira)}`;
        const x = x0 + k * (g.larguraPosicao + g.espacoDentroDoPar);
        const alturaPosicoes = bloco.posicoesPorFileira * g.alturaPosicao + (bloco.posicoesPorFileira - 1) * g.espacoEntrePosicoes;
        const fim = primeiraY + alturaPosicoes;
        baseBloco = Math.max(baseBloco, fim);
        fileiras.push({
          codigo,
          rotulo: codigo,
          ordem,
          blocoCodigo: codigoBloco,
          x,
          y: topoFaixa,
          largura: g.larguraPosicao,
          altura: fim - topoFaixa,
          caixaRotulo: { x, y: topoFaixa, largura: g.larguraPosicao, altura: g.alturaRotuloFileira },
          lado: quantidade === 1 ? 'UNICO' : k === 0 ? 'ESQUERDO' : 'DIREITO',
        });
        for (let n = 1; n <= bloco.posicoesPorFileira; n++) {
          posicoes.push({
            codigo: `${codigo}-P${doisDigitos(n)}`,
            fileiraCodigo: codigo,
            numero: n,
            x,
            y: primeiraY + (n - 1) * (g.alturaPosicao + g.espacoEntrePosicoes),
            largura: g.larguraPosicao,
            altura: g.alturaPosicao,
            disponivel: !desativada,
            ocupacaoLevantada: false,
            desativada,
            motivoIndisponibilidade: desativada ? MOTIVO_AREA_DESATIVADA : null,
          });
        }
      }
      base = Math.max(base, baseBloco);
      const largura = larguraBloco(bloco.tipo);
      elementos.push({
        codigo: codigoBloco,
        tipo: 'BLOCO',
        rotulo: rotuloBloco(codigoBloco, bloco.tipo, bloco.nomeOperacional ?? null, desativada),
        ficticio: false,
        x: x0 - RECUO_BLOCO,
        y: topoFaixa - RECUO_BLOCO,
        largura: largura + 2 * RECUO_BLOCO,
        altura: baseBloco - topoFaixa + 2 * RECUO_BLOCO,
        caixaRotulo: { x: x0 - RECUO_BLOCO, y: tituloBlocoY, largura: largura + 2 * RECUO_BLOCO, altura: g.alturaTituloBloco },
        nomeOperacional: bloco.nomeOperacional ?? null,
        prefixoEndereco: bloco.prefixoEndereco ?? null,
      });
    });
    const baseArea = base + RECUO_BLOCO + 12;
    // Corredores longitudinais entre blocos (seis por área), ao longo das faixas.
    for (let i = 0; i + 1 < area.blocos.length; i++) {
      const bloco = area.blocos[i];
      if (!bloco) continue;
      const xCorredor = (xs[i] ?? 0) + larguraBloco(bloco.tipo) + RECUO_BLOCO + 4;
      const larguraCorredor = g.larguraCorredor - 2 * (RECUO_BLOCO + 4);
      const codigo = `${area.prefixoCorredor}${doisDigitos(i + 1)}`;
      elementos.push({
        codigo,
        tipo: 'CORREDOR',
        rotulo: `${codigo} · corredor`,
        ficticio: false,
        x: xCorredor,
        y: topoFaixa,
        largura: larguraCorredor,
        altura: base - topoFaixa,
        caixaRotulo: { x: xCorredor, y: topoFaixa, largura: larguraCorredor, altura: g.alturaRotuloFileira },
      });
    }
    elementos.push({
      codigo: area.codigo,
      tipo: 'ZONA',
      rotulo: area.titulo,
      ficticio: false,
      x: g.margem - RECUO_BLOCO - 8,
      y: topoArea,
      largura: larguraTotal - 2 * g.margem + 2 * (RECUO_BLOCO + 8),
      altura: baseArea - topoArea,
      caixaRotulo: { x: g.margem, y: topoArea + 6, largura: larguraTotal - 2 * g.margem, altura: Math.min(28, g.alturaTituloArea - 8) },
    });
    y = baseArea + 8;
    const corredor = indiceArea + 1 < config.areas.length ? config.corredores.transversal : config.corredores.frontal;
    const altura = indiceArea + 1 < config.areas.length ? g.alturaCorredorTransversal : g.alturaCorredorFrontal;
    elementos.push({
      codigo: corredor.codigo,
      tipo: 'CORREDOR',
      rotulo: corredor.rotulo,
      ficticio: false,
      x: g.margem,
      y,
      largura: larguraTotal - 2 * g.margem,
      altura,
      caixaRotulo: { x: g.margem + 8, y: y + Math.max(0, Math.floor((altura - 28) / 2)), largura: larguraTotal - 2 * g.margem - 16, altura: 28 },
    });
    y += altura + 8;
  });

  return { largura: larguraTotal, altura: y - 8 + g.margem, elementos, fileiras, posicoes };
}
