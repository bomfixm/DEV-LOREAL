/**
 * Importação de documentos de devolução: declaração documental, nunca estoque.
 * Não cria recebimento físico, observação de contagem, saldo validado,
 * ocupação de posição nem liberação de material.
 *
 * Chave de negócio de uma linha: referência da devolução + linha/item do
 * documento (no escopo). SKU isolado ou NF isolada não identificam a linha;
 * sem referência ou sem linha, a linha fica inválida (nenhuma chave é
 * inventada). Mesma chave e mesmo conteúdo → duplicata; mesma chave com SKU,
 * quantidade, unidade, lote, NF ou data diferentes → conflito, sem sobrescrita.
 */
import { UNIDADE_PECA, ehQuantidadeInteira, multiplicarExato, normalizarQuantidade, type MotivoLinha } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica } from '../../db/erros.js';
import { ErroHttp } from '../../http/erros.js';
import type { LinhaTabela } from './arquivo/ler.js';
import { chaveLinhaDocumento, data, identificador, linhaDocumento, obrigatorio, quantidade, unidade, type Campo, type Resultado } from './interpretar.js';
import { celulaDe, classificarLinha, lidosDaLinha, type Entrada, type LinhaClassificada } from './tipos.js';

const CAMPOS = {
  returnReference: { campo: 'returnReference', rotulo: 'Referência da devolução' },
  lineReference: { campo: 'lineReference', rotulo: 'Linha/item do documento' },
  sku: { campo: 'sku', rotulo: 'SKU' },
  quantity: { campo: 'quantity', rotulo: 'Quantidade declarada' },
  unit: { campo: 'unit', rotulo: 'Unidade declarada' },
  invoice: { campo: 'invoice', rotulo: 'NF' },
  lot: { campo: 'lot', rotulo: 'Lote' },
  documentDate: { campo: 'documentDate', rotulo: 'Data do documento' },
} as const satisfies Record<string, Campo>;

interface Interpretada {
  linha: LinhaTabela;
  lidos: Record<string, string | null>;
  erros: MotivoLinha[];
  referencia: string | null;
  referenciaLinha: string | null;
  sku: string | null;
  quantidade: string | null;
  unidade: string | null;
  notaFiscal: string | null;
  lote: string | null;
  data: string | null;
}

function aplicar<T>(r: Resultado<T>, erros: MotivoLinha[]): T | null {
  if (r.ok) return r.valor;
  erros.push(r.motivo);
  return null;
}

export function interpretarDevolucoes(e: Entrada): Interpretada[] {
  const max = e.limites.maxCellChars;
  return e.tabela.linhas.map((linha) => {
    const erros: MotivoLinha[] = [];
    const c = (campo: string) => celulaDe(linha, e.colunas, campo);
    const faltantes: MotivoLinha[] = [];
    for (const f of [CAMPOS.returnReference, CAMPOS.lineReference, CAMPOS.sku, CAMPOS.quantity, CAMPOS.unit]) {
      const falta = obrigatorio(c(f.campo), f);
      if (falta) faltantes.push(falta);
    }
    // Referência ou linha ausentes: a chave da linha não existe (não é inventada).
    if (faltantes.some((m) => m.field === 'returnReference' || m.field === 'lineReference')) {
      faltantes.push({
        code: 'CHAVE_INCOMPLETA',
        field: null,
        message: 'Sem a referência da devolução e a linha/item do documento a linha não pode ser identificada. Corrija o arquivo ou o mapeamento das colunas.',
      });
    }
    erros.push(...faltantes);
    const referencia = aplicar(identificador(c('returnReference'), CAMPOS.returnReference, max), erros);
    const referenciaLinha = aplicar(linhaDocumento(c('lineReference'), CAMPOS.lineReference, max), erros);
    const sku = aplicar(identificador(c('sku'), CAMPOS.sku, max), erros);
    const qtd = aplicar(quantidade(c('quantity'), CAMPOS.quantity, e.separador, max), erros);
    const un = aplicar(unidade(c('unit'), CAMPOS.unit, max), erros);
    const notaFiscal = aplicar(identificador(c('invoice'), CAMPOS.invoice, max), erros);
    const lote = aplicar(identificador(c('lot'), CAMPOS.lot, max), erros);
    const dataDocumento = aplicar(data(c('documentDate'), CAMPOS.documentDate, max), erros);
    if (un === UNIDADE_PECA && qtd !== null && !ehQuantidadeInteira(qtd)) {
      erros.push({ code: 'QUANTIDADE_NAO_INTEIRA', field: 'quantity', message: 'Quantidade declarada: em peças (UN) precisa ser inteira.' });
    }
    return {
      linha,
      lidos: lidosDaLinha(linha, e.colunas),
      erros,
      referencia,
      referenciaLinha,
      sku,
      quantidade: qtd,
      unidade: un,
      notaFiscal,
      lote,
      data: dataDocumento,
    };
  });
}

interface LinhaProduto {
  id: string;
  sku: string;
  ativo: boolean;
  unidade: string;
}

interface ProdutoCadastro {
  id: string;
  sku: string;
  ativo: boolean;
  unidade: string;
  embalagens: { embalagem: string; fator: string | null }[];
}

interface LinhaExistente {
  documentoId: string;
  sku: string;
  quantidade: string;
  unidade: string;
  lote: string | null;
  notaFiscal: string | null;
  data: string | null;
  loteImportacaoId: string;
  linhaArquivo: number;
}

export interface EstadoDevolucoes {
  produtos: Map<string, ProdutoCadastro>;
  porSkuMaiusculo: Map<string, string[]>;
  documentos: Map<string, string>;
  /** referência + U+001F + chave da linha → linha já importada. */
  linhas: Map<string, LinhaExistente>;
}

const SEP = '\u001f';

/**
 * Produtos, documentos e linhas já importadas citados no arquivo. Na
 * confirmação, os produtos citados ficam bloqueados para leitura (FOR SHARE):
 * fator e unidade não mudam até o fim da gravação.
 */
export async function carregarEstadoDevolucoes(db: Banco | Transacao, escopoId: string, linhas: readonly Interpretada[], bloquear: boolean): Promise<EstadoDevolucoes> {
  const skus = [...new Set(linhas.flatMap((l) => (l.sku === null ? [] : [l.sku.toUpperCase()])))];
  const referencias = [...new Set(linhas.flatMap((l) => (l.referencia === null ? [] : [l.referencia])))];
  const produtos =
    skus.length === 0
      ? []
      : bloquear
        ? await db.$queryRaw<LinhaProduto[]>`
            SELECT id::text, sku, ativo, unidade_canonica AS unidade FROM produto
             WHERE escopo_id = ${escopoId}::uuid AND upper(sku) = ANY(${skus}::text[]) ORDER BY id FOR SHARE`
        : await db.$queryRaw<LinhaProduto[]>`
            SELECT id::text, sku, ativo, unidade_canonica AS unidade FROM produto
             WHERE escopo_id = ${escopoId}::uuid AND upper(sku) = ANY(${skus}::text[])`;
  const ids = produtos.map((p) => p.id);
  const embalagens =
    ids.length === 0
      ? []
      : await db.$queryRaw<{ produto_id: string; embalagem: string; fator: string | null }[]>`
          SELECT produto_id::text, embalagem, fator_conversao::text AS fator FROM codigo_barras
           WHERE escopo_id = ${escopoId}::uuid AND produto_id = ANY(${ids}::uuid[])`;
  const documentos =
    referencias.length === 0
      ? []
      : await db.$queryRaw<{ id: string; referencia: string }[]>`
          SELECT id::text, referencia FROM documento_devolucao
           WHERE escopo_id = ${escopoId}::uuid AND tipo = 'DEVOLUCAO' AND referencia = ANY(${referencias}::text[])`;
  const idsDocumentos = documentos.map((d) => d.id);
  const existentes =
    idsDocumentos.length === 0
      ? []
      : await db.$queryRaw<
          {
            documento_id: string;
            chave_linha: string;
            sku: string;
            quantidade: string;
            unidade: string;
            lote: string | null;
            nota_fiscal: string | null;
            data: string | null;
            lote_importacao_id: string;
            linha_arquivo: number;
          }[]
        >`
          SELECT documento_id::text, chave_linha, sku, quantidade_declarada::text AS quantidade, unidade_declarada AS unidade, lote, nota_fiscal,
                 to_char(data_documento, 'YYYY-MM-DD') AS data, lote_importacao_id::text, linha_arquivo
            FROM linha_documento_devolucao
           WHERE escopo_id = ${escopoId}::uuid AND documento_id = ANY(${idsDocumentos}::uuid[])`;
  const referenciaPorDocumento = new Map(documentos.map((d) => [d.id, d.referencia]));
  const porSkuMaiusculo = new Map<string, string[]>();
  for (const p of produtos) porSkuMaiusculo.set(p.sku.toUpperCase(), [...(porSkuMaiusculo.get(p.sku.toUpperCase()) ?? []), p.sku]);
  return {
    produtos: new Map(
      produtos.map((p) => [
        p.sku,
        {
          ...p,
          embalagens: embalagens.filter((e) => e.produto_id === p.id).map((e) => ({ embalagem: e.embalagem, fator: e.fator === null ? null : normalizarQuantidade(e.fator) })),
        },
      ]),
    ),
    porSkuMaiusculo,
    documentos: new Map(documentos.map((d) => [d.referencia, d.id])),
    linhas: new Map(
      existentes.map((l) => [
        `${referenciaPorDocumento.get(l.documento_id) ?? ''}${SEP}${l.chave_linha}`,
        {
          documentoId: l.documento_id,
          sku: l.sku,
          quantidade: normalizarQuantidade(l.quantidade),
          unidade: l.unidade,
          lote: l.lote,
          notaFiscal: l.nota_fiscal,
          data: l.data,
          loteImportacaoId: l.lote_importacao_id,
          linhaArquivo: l.linha_arquivo,
        },
      ]),
    ),
  };
}

interface LinhaNova {
  id: string;
  numero: number;
  referencia: string;
  referenciaLinha: string;
  chaveLinha: string;
  produtoId: string;
  sku: string;
  quantidade: string;
  unidade: string;
  fator: string;
  canonica: string;
  unidadeCanonica: string;
  notaFiscal: string | null;
  lote: string | null;
  data: string | null;
}

export interface PlanoDevolucoes {
  documentosNovos: { id: string; referencia: string }[];
  documentoPorReferencia: Map<string, string>;
  linhasNovas: LinhaNova[];
  registroPorLinha: Map<number, string>;
}

interface Conteudo {
  sku: string;
  quantidade: string;
  unidade: string;
  lote: string | null;
  notaFiscal: string | null;
  data: string | null;
}

/** Diferenças relevantes entre o conteúdo registrado e o do arquivo. */
function diferencas(antes: Conteudo, depois: Conteudo): string[] {
  const vazio = (v: string | null) => v ?? 'pendente';
  const lista: string[] = [];
  if (antes.sku !== depois.sku) lista.push(`SKU ${antes.sku} → ${depois.sku}`);
  if (antes.quantidade !== depois.quantidade || antes.unidade !== depois.unidade) lista.push(`quantidade ${antes.quantidade} ${antes.unidade} → ${depois.quantidade} ${depois.unidade}`);
  if (antes.lote !== depois.lote) lista.push(`lote ${vazio(antes.lote)} → ${vazio(depois.lote)}`);
  if (antes.notaFiscal !== depois.notaFiscal) lista.push(`NF ${vazio(antes.notaFiscal)} → ${vazio(depois.notaFiscal)}`);
  if (antes.data !== depois.data) lista.push(`data ${vazio(antes.data)} → ${vazio(depois.data)}`);
  return lista;
}

export function classificarDevolucoes(linhas: readonly Interpretada[], estado: EstadoDevolucoes): { linhas: LinhaClassificada[]; plano: PlanoDevolucoes } {
  const plano: PlanoDevolucoes = { documentosNovos: [], documentoPorReferencia: new Map(estado.documentos), linhasNovas: [], registroPorLinha: new Map() };
  const vistas = new Map<string, Conteudo & { numero: number }>();
  const resultado: LinhaClassificada[] = [];

  for (const l of linhas) {
    const erros = [...l.erros];
    const conflitos: MotivoLinha[] = [];
    const duplicidades: MotivoLinha[] = [];
    let nova = false;
    let fator: string | null = null;
    let canonica: string | null = null;
    let produto: ProdutoCadastro | undefined;
    const chaveLinha = l.referenciaLinha === null ? null : chaveLinhaDocumento(l.referenciaLinha);

    if (l.sku !== null) {
      produto = estado.produtos.get(l.sku);
      if (!produto) {
        const semelhante = (estado.porSkuMaiusculo.get(l.sku.toUpperCase()) ?? [])[0];
        erros.push({
          code: 'SKU_NAO_CADASTRADO',
          field: 'sku',
          message: `SKU ${l.sku} não cadastrado neste escopo${semelhante ? ` (existe ${semelhante}, que difere em maiúsculas/minúsculas)` : ''}. Importe o produto ("Cadastro de produtos") e gere a prévia de novo; nenhum outro SKU é associado.`,
        });
      } else if (!produto.ativo) {
        erros.push({ code: 'SKU_INATIVO', field: 'sku', message: `SKU ${l.sku} está inativo no cadastro. Reative o produto antes de importar a devolução.` });
      }
    }
    if (produto && produto.ativo && l.unidade !== null && l.quantidade !== null) {
      if (l.unidade === produto.unidade) {
        fator = '1';
      } else {
        const fatores = [...new Set(produto.embalagens.filter((e) => e.embalagem === l.unidade).map((e) => e.fator))];
        if (fatores.length === 0) {
          const unidades = [produto.unidade, ...new Set(produto.embalagens.map((e) => e.embalagem))].filter((u, i, a) => a.indexOf(u) === i);
          erros.push({
            code: 'UNIDADE_INCOMPATIVEL',
            field: 'unit',
            message: `A unidade ${l.unidade} não está cadastrada para o SKU ${produto.sku} (cadastradas: ${unidades.join(', ')}). Cadastre a embalagem com fator aprovado ou corrija o arquivo.`,
          });
        } else if (fatores.length > 1) {
          erros.push({ code: 'FATOR_AMBIGUO', field: 'unit', message: `O SKU ${produto.sku} tem mais de um fator para ${l.unidade}. Corrija o cadastro do produto.` });
        } else if (fatores[0] === null || fatores[0] === undefined) {
          erros.push({
            code: 'FATOR_DESCONHECIDO',
            field: 'unit',
            message: `O fator de ${l.unidade} do SKU ${produto.sku} ainda não foi aprovado: a quantidade não é convertida. Aprove o fator no cadastro do produto e gere a prévia de novo.`,
          });
        } else {
          fator = fatores[0];
        }
      }
      if (fator !== null) {
        canonica = multiplicarExato(l.quantidade, fator);
        if (canonica === null) {
          erros.push({ code: 'CONVERSAO_INEXATA', field: 'quantity', message: `${l.quantidade} ${l.unidade} × fator ${fator} não dá uma quantidade exata com até 3 casas.` });
        } else if (produto.unidade === UNIDADE_PECA && !ehQuantidadeInteira(canonica) && !erros.some((m) => m.code === 'QUANTIDADE_NAO_INTEIRA')) {
          erros.push({ code: 'QUANTIDADE_NAO_INTEIRA', field: 'quantity', message: `Convertida para peças, ${canonica} UN não é inteira.` });
          canonica = null;
        }
      }
    }

    if (erros.length === 0 && l.referencia !== null && chaveLinha !== null && l.sku !== null && l.quantidade !== null && l.unidade !== null && produto && fator !== null && canonica !== null) {
      const chave = `${l.referencia}${SEP}${chaveLinha}`;
      const conteudo: Conteudo = { sku: l.sku, quantidade: l.quantidade, unidade: l.unidade, lote: l.lote, notaFiscal: l.notaFiscal, data: l.data };
      const existente = estado.linhas.get(chave);
      const noArquivo = vistas.get(chave);
      if (existente) {
        const mudou = diferencas(existente, conteudo);
        if (mudou.length > 0) {
          conflitos.push({
            code: 'CONFLITO_EXISTENTE',
            field: null,
            message: `A linha ${l.referenciaLinha} da devolução ${l.referencia} já foi importada (lote ${existente.loteImportacaoId.slice(0, 8)}, linha ${String(existente.linhaArquivo)} do arquivo) com outro conteúdo: ${mudou.join('; ')}. Nada é sobrescrito.`,
          });
        } else {
          duplicidades.push({
            code: 'DUPLICADA_EXISTENTE',
            field: null,
            message: `Linha ${l.referenciaLinha} da devolução ${l.referencia} já importada com o mesmo conteúdo (lote ${existente.loteImportacaoId.slice(0, 8)}).`,
          });
        }
      } else if (noArquivo) {
        const mudou = diferencas(noArquivo, conteudo);
        if (mudou.length > 0) {
          conflitos.push({ code: 'CONFLITO_NO_ARQUIVO', field: null, message: `A linha ${String(noArquivo.numero)} do arquivo tem a mesma devolução e linha com outro conteúdo: ${mudou.join('; ')}.` });
        } else {
          duplicidades.push({ code: 'DUPLICADA_NO_ARQUIVO', field: null, message: `Igual à linha ${String(noArquivo.numero)} do arquivo.` });
        }
      } else {
        nova = true;
      }
    }

    const { classificacao, motivos } = classificarLinha(erros, conflitos, nova, duplicidades);
    if (classificacao === 'VALIDA_NOVA' && l.referencia !== null && l.referenciaLinha !== null && chaveLinha !== null && l.sku !== null && produto && fator !== null && canonica !== null && l.quantidade !== null && l.unidade !== null) {
      vistas.set(`${l.referencia}${SEP}${chaveLinha}`, { numero: l.linha.numero, sku: l.sku, quantidade: l.quantidade, unidade: l.unidade, lote: l.lote, notaFiscal: l.notaFiscal, data: l.data });
      if (!plano.documentoPorReferencia.has(l.referencia)) {
        const id = randomUUID();
        plano.documentosNovos.push({ id, referencia: l.referencia });
        plano.documentoPorReferencia.set(l.referencia, id);
      }
      const id = randomUUID();
      plano.linhasNovas.push({
        id,
        numero: l.linha.numero,
        referencia: l.referencia,
        referenciaLinha: l.referenciaLinha,
        chaveLinha,
        produtoId: produto.id,
        sku: produto.sku,
        quantidade: l.quantidade,
        unidade: l.unidade,
        fator,
        canonica,
        unidadeCanonica: produto.unidade,
        notaFiscal: l.notaFiscal,
        lote: l.lote,
        data: l.data,
      });
      plano.registroPorLinha.set(l.linha.numero, id);
    }
    resultado.push({
      numero: l.linha.numero,
      classificacao,
      chave: l.referencia !== null && chaveLinha !== null ? `devolução ${l.referencia} · linha ${chaveLinha}` : null,
      valores: {
        returnReference: l.referencia,
        lineReference: l.referenciaLinha,
        sku: l.sku,
        quantity: l.quantidade,
        unit: l.unidade,
        invoice: l.notaFiscal,
        lot: l.lote,
        documentDate: l.data,
        factor: fator,
        canonicalQuantity: canonica,
        canonicalUnit: produto?.unidade ?? null,
      },
      lidos: l.lidos,
      motivos,
      avisos: [
        ...(l.lote === null && erros.length === 0 ? [{ code: 'LOTE_PENDENTE', field: 'lot', message: 'Lote não informado: fica pendente (nenhum lote é presumido).' }] : []),
      ],
    });
  }
  return { linhas: resultado, plano };
}

/** Grava documentos e linhas (declaração documental). Unicidade violada → prévia desatualizada. */
export async function gravarDevolucoes(
  tx: Transacao,
  escopoId: string,
  loteImportacaoId: string,
  plano: PlanoDevolucoes,
): Promise<{ documentosCriados: number; linhasCriadas: number }> {
  try {
    if (plano.documentosNovos.length > 0) {
      await tx.documentoDevolucao.createMany({
        data: plano.documentosNovos.map((d) => ({ id: d.id, escopoId, tipo: 'DEVOLUCAO', referencia: d.referencia, loteImportacaoId })),
      });
    }
    if (plano.linhasNovas.length > 0) {
      await tx.linhaDocumentoDevolucao.createMany({
        data: plano.linhasNovas.map((l) => ({
          id: l.id,
          escopoId,
          documentoId: plano.documentoPorReferencia.get(l.referencia) ?? '',
          referenciaLinha: l.referenciaLinha,
          chaveLinha: l.chaveLinha,
          produtoId: l.produtoId,
          sku: l.sku,
          quantidadeDeclarada: l.quantidade,
          unidadeDeclarada: l.unidade,
          fatorConversao: l.fator,
          quantidadeCanonica: l.canonica,
          unidadeCanonica: l.unidadeCanonica,
          notaFiscal: l.notaFiscal,
          lote: l.lote,
          dataDocumento: l.data === null ? null : new Date(`${l.data}T00:00:00.000Z`),
          loteImportacaoId,
          linhaArquivo: l.numero,
        })),
      });
    }
  } catch (erro) {
    if (ehViolacaoUnica(erro)) {
      throw new ErroHttp(409, 'PREVIA_DESATUALIZADA', 'Outra importação gravou agora uma linha com a mesma devolução e linha. A prévia foi atualizada: revise antes de confirmar.');
    }
    throw erro;
  }
  return { documentosCriados: plano.documentosNovos.length, linhasCriadas: plano.linhasNovas.length };
}
