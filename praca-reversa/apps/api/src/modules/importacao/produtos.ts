/**
 * Importação do cadastro de produtos. Identidade: SKU no escopo (texto exato).
 * Cada linha traz um produto e, opcionalmente, um código de barras com
 * embalagem e fator; o mesmo SKU pode se repetir para outros códigos.
 *
 * - Produto já cadastrado com os mesmos dados → duplicata (não altera nada).
 * - Mesmo SKU com descrição ou unidade canônica diferente → conflito (a
 *   importação nunca sobrescreve; a unidade canônica em uso não muda).
 * - SKU que só difere de outro em maiúsculas/minúsculas → conflito.
 * - Código de barras de outro produto, ou com embalagem/fator diferente → conflito.
 * - Código novo para um produto existente → válido novo (acrescenta o código).
 * Cadastrar produto não cria saldo físico.
 */
import { UNIDADE_PECA, ehQuantidadeInteira, normalizarQuantidade, type MotivoLinha } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica } from '../../db/erros.js';
import { ErroHttp } from '../../http/erros.js';
import type { LinhaTabela } from './arquivo/ler.js';
import { identificador, obrigatorio, quantidade, textoLivre, unidade, type Campo, type Resultado } from './interpretar.js';
import { celulaDe, classificarLinha, lidosDaLinha, type Entrada, type LinhaClassificada } from './tipos.js';

const CAMPOS = {
  sku: { campo: 'sku', rotulo: 'SKU' },
  description: { campo: 'description', rotulo: 'Descrição' },
  canonicalUnit: { campo: 'canonicalUnit', rotulo: 'Unidade canônica' },
  barcode: { campo: 'barcode', rotulo: 'Código de barras' },
  packaging: { campo: 'packaging', rotulo: 'Embalagem do código' },
  factor: { campo: 'factor', rotulo: 'Fator' },
} as const satisfies Record<string, Campo>;

const MAX_CODIGOS_POR_PRODUTO = 20;

interface Interpretada {
  linha: LinhaTabela;
  lidos: Record<string, string | null>;
  erros: MotivoLinha[];
  avisos: MotivoLinha[];
  sku: string | null;
  descricao: string | null;
  unidade: string | null;
  codigo: string | null;
  embalagem: string | null;
  fator: string | null;
}

function aplicar<T>(r: Resultado<T>, erros: MotivoLinha[]): T | null {
  if (r.ok) return r.valor;
  erros.push(r.motivo);
  return null;
}

export function interpretarProdutos(e: Entrada): Interpretada[] {
  const max = e.limites.maxCellChars;
  return e.tabela.linhas.map((linha) => {
    const erros: MotivoLinha[] = [];
    const c = (campo: string) => celulaDe(linha, e.colunas, campo);
    for (const f of [CAMPOS.sku, CAMPOS.description, CAMPOS.canonicalUnit]) {
      const falta = obrigatorio(c(f.campo), f);
      if (falta) erros.push(falta);
    }
    const sku = aplicar(identificador(c('sku'), CAMPOS.sku, max), erros);
    const descricao = aplicar(textoLivre(c('description'), CAMPOS.description, max, 2, 200), erros);
    const un = aplicar(unidade(c('canonicalUnit'), CAMPOS.canonicalUnit, max), erros);
    const codigo = aplicar(identificador(c('barcode'), CAMPOS.barcode, max, { semEspacos: true }), erros);
    const embalagem = aplicar(unidade(c('packaging'), CAMPOS.packaging, max), erros);
    const fator = aplicar(quantidade(c('factor'), CAMPOS.factor, e.separador, max), erros);
    if (codigo !== null && embalagem === null && !erros.some((m) => m.field === 'packaging')) {
      erros.push({ code: 'EMBALAGEM_OBRIGATORIA', field: 'packaging', message: 'Embalagem do código: informe a embalagem do código de barras (ex.: UN ou CX).' });
    }
    if (codigo === null && (embalagem !== null || fator !== null) && !erros.some((m) => m.field === 'barcode')) {
      erros.push({ code: 'CODIGO_OBRIGATORIO', field: 'barcode', message: 'Código de barras: há embalagem/fator sem código. Informe o código ou deixe as colunas vazias.' });
    }
    return { linha, lidos: lidosDaLinha(linha, e.colunas), erros, avisos: [], sku, descricao, unidade: un, codigo, embalagem, fator };
  });
}

interface ProdutoExistente {
  id: string;
  sku: string;
  descricao: string;
  unidade: string;
  ativo: boolean;
}

interface CodigoExistente {
  codigo: string;
  produtoId: string;
  sku: string;
  embalagem: string;
  fator: string | null;
}

export interface EstadoProdutos {
  porSku: Map<string, ProdutoExistente>;
  /** SKU em maiúsculas → SKUs cadastrados (detecta diferença só de caixa). */
  porSkuMaiusculo: Map<string, string[]>;
  codigos: Map<string, CodigoExistente>;
  codigosPorProduto: Map<string, number>;
}

/**
 * Produtos e códigos do escopo citados no arquivo. Na confirmação, os
 * produtos citados ficam bloqueados (FOR UPDATE) até o fim da transação.
 */
export async function carregarEstadoProdutos(db: Banco | Transacao, escopoId: string, linhas: readonly Interpretada[], bloquear: boolean): Promise<EstadoProdutos> {
  const skus = [...new Set(linhas.flatMap((l) => (l.sku === null ? [] : [l.sku.toUpperCase()])))];
  const codigos = [...new Set(linhas.flatMap((l) => (l.codigo === null ? [] : [l.codigo])))];
  const produtos =
    skus.length === 0
      ? []
      : bloquear
        ? await db.$queryRaw<{ id: string; sku: string; descricao: string; unidade: string; ativo: boolean }[]>`
            SELECT id::text, sku, descricao, unidade_canonica AS unidade, ativo FROM produto
             WHERE escopo_id = ${escopoId}::uuid AND upper(sku) = ANY(${skus}::text[])
             ORDER BY id FOR UPDATE`
        : await db.$queryRaw<{ id: string; sku: string; descricao: string; unidade: string; ativo: boolean }[]>`
            SELECT id::text, sku, descricao, unidade_canonica AS unidade, ativo FROM produto
             WHERE escopo_id = ${escopoId}::uuid AND upper(sku) = ANY(${skus}::text[])`;
  const ids = produtos.map((p) => p.id);
  const existentes =
    codigos.length === 0 && ids.length === 0
      ? []
      : await db.$queryRaw<{ codigo: string; produto_id: string; sku: string; embalagem: string; fator: string | null }[]>`
          SELECT cb.codigo, cb.produto_id::text, p.sku, cb.embalagem, cb.fator_conversao::text AS fator
            FROM codigo_barras cb JOIN produto p ON p.id = cb.produto_id
           WHERE cb.escopo_id = ${escopoId}::uuid AND (cb.codigo = ANY(${codigos}::text[]) OR cb.produto_id = ANY(${ids}::uuid[]))`;
  const porSkuMaiusculo = new Map<string, string[]>();
  for (const p of produtos) porSkuMaiusculo.set(p.sku.toUpperCase(), [...(porSkuMaiusculo.get(p.sku.toUpperCase()) ?? []), p.sku]);
  const codigosPorProduto = new Map<string, number>();
  for (const c of existentes) codigosPorProduto.set(c.produto_id, (codigosPorProduto.get(c.produto_id) ?? 0) + 1);
  return {
    porSku: new Map(produtos.map((p) => [p.sku, p])),
    porSkuMaiusculo,
    codigos: new Map(
      existentes
        .filter((c) => codigos.includes(c.codigo))
        .map((c) => [c.codigo, { codigo: c.codigo, produtoId: c.produto_id, sku: c.sku, embalagem: c.embalagem, fator: c.fator === null ? null : normalizarQuantidade(c.fator) }]),
    ),
    codigosPorProduto,
  };
}

export interface PlanoProdutos {
  produtosNovos: { id: string; sku: string; descricao: string; unidade: string }[];
  codigosNovos: { produtoId: string; codigo: string; embalagem: string; fator: string | null }[];
  /** Produtos já cadastrados que recebem código novo (versão +1). */
  produtosAlterados: Set<string>;
  registroPorLinha: Map<number, string>;
}

const fatorTexto = (f: string | null) => (f === null ? 'fator pendente' : `fator ${f}`);

export function classificarProdutos(linhas: readonly Interpretada[], estado: EstadoProdutos): { linhas: LinhaClassificada[]; plano: PlanoProdutos } {
  const vistosSku = new Map<string, { numero: number; descricao: string; unidade: string; id: string | null }>();
  const vistosMaiusculo = new Map<string, string>();
  const vistosCodigo = new Map<string, { numero: number; sku: string; embalagem: string; fator: string | null }>();
  const novosCodigosPorSku = new Map<string, number>();
  const plano: PlanoProdutos = { produtosNovos: [], codigosNovos: [], produtosAlterados: new Set(), registroPorLinha: new Map() };
  const resultado: LinhaClassificada[] = [];

  for (const l of linhas) {
    const erros = [...l.erros];
    const avisos = [...l.avisos];
    const conflitos: MotivoLinha[] = [];
    const duplicidades: MotivoLinha[] = [];
    let produtoNovo = false;
    let codigoNovo = false;
    let produtoId: string | null = null;
    let fatorEfetivo: string | null = l.fator;
    const numero = l.linha.numero;

    if (erros.length === 0 && l.sku !== null && l.descricao !== null && l.unidade !== null) {
      const sku = l.sku;
      let unidadeCanonica = l.unidade;
      const existente = estado.porSku.get(sku);
      const noArquivo = vistosSku.get(sku);
      if (existente) {
        if (existente.unidade !== l.unidade) {
          conflitos.push({
            code: 'UNIDADE_CANONICA_DIFERENTE',
            field: 'canonicalUnit',
            message: `O SKU ${sku} está cadastrado em ${existente.unidade}; o arquivo traz ${l.unidade}. A unidade canônica não é alterada por importação.`,
          });
        }
        if (existente.descricao !== l.descricao) {
          conflitos.push({
            code: 'DESCRICAO_DIFERENTE',
            field: 'description',
            message: `O SKU ${sku} está cadastrado como "${existente.descricao}". A importação não sobrescreve: corrija pelo cadastro de produtos (com versão) ou ajuste o arquivo.`,
          });
        }
        if (!existente.ativo) avisos.push({ code: 'PRODUTO_INATIVO', field: 'sku', message: `O SKU ${sku} está inativo no cadastro; a importação não o reativa.` });
        duplicidades.push({ code: 'DUPLICADA_EXISTENTE', field: 'sku', message: `SKU ${sku} já cadastrado com os mesmos dados.` });
        unidadeCanonica = existente.unidade;
        produtoId = existente.id;
      } else if (noArquivo) {
        if (noArquivo.unidade !== l.unidade || noArquivo.descricao !== l.descricao) {
          conflitos.push({
            code: 'CONFLITO_NO_ARQUIVO',
            field: 'sku',
            message: `A linha ${String(noArquivo.numero)} traz o mesmo SKU com ${noArquivo.unidade !== l.unidade ? `unidade ${noArquivo.unidade}` : `descrição "${noArquivo.descricao}"`}.`,
          });
        } else {
          duplicidades.push({ code: 'DUPLICADA_NO_ARQUIVO', field: 'sku', message: `SKU ${sku} igual ao da linha ${String(noArquivo.numero)}.` });
        }
        produtoId = noArquivo.id;
      } else {
        const semelhantes = [...(estado.porSkuMaiusculo.get(sku.toUpperCase()) ?? []), ...(vistosMaiusculo.has(sku.toUpperCase()) ? [vistosMaiusculo.get(sku.toUpperCase()) ?? ''] : [])].filter(
          (s) => s !== sku,
        );
        if (semelhantes.length > 0) {
          conflitos.push({
            code: 'SKU_SEMELHANTE',
            field: 'sku',
            message: `Já existe o SKU ${semelhantes[0] ?? ''}, que difere de ${sku} só em maiúsculas/minúsculas. Confira o código na origem: a importação não cria SKUs assim.`,
          });
        } else {
          produtoNovo = true;
        }
      }

      if (l.codigo !== null && l.embalagem !== null) {
        const codigo = l.codigo;
        if (l.embalagem === unidadeCanonica) {
          if (l.fator !== null && l.fator !== '1') {
            erros.push({ code: 'FATOR_INVALIDO', field: 'factor', message: `Fator: a embalagem ${l.embalagem} é a unidade canônica; o fator precisa ser 1.` });
          }
          fatorEfetivo = '1';
        } else if (l.fator === null) {
          avisos.push({
            code: 'FATOR_PENDENTE',
            field: 'factor',
            message: `Fator da embalagem ${l.embalagem} vazio: o código fica reconhecido, mas a conversão para ${unidadeCanonica} fica bloqueada até o fator ser aprovado.`,
          });
        } else if (unidadeCanonica === UNIDADE_PECA && !ehQuantidadeInteira(l.fator)) {
          erros.push({ code: 'FATOR_INVALIDO', field: 'factor', message: `Fator: produto contado em peças (UN) precisa de fator inteiro.` });
        }
        const exC = estado.codigos.get(codigo);
        const noArquivoC = vistosCodigo.get(codigo);
        if (exC) {
          if (exC.sku !== sku) {
            conflitos.push({ code: 'CODIGO_DE_OUTRO_PRODUTO', field: 'barcode', message: `O código de barras ${codigo} já pertence ao SKU ${exC.sku}.` });
          } else if (exC.embalagem !== l.embalagem || exC.fator !== fatorEfetivo) {
            conflitos.push({
              code: 'EMBALAGEM_DIFERENTE',
              field: 'barcode',
              message: `O código ${codigo} está cadastrado como ${exC.embalagem}, ${fatorTexto(exC.fator)}; o arquivo traz ${l.embalagem}, ${fatorTexto(fatorEfetivo)}. Nada é sobrescrito.`,
            });
          } else {
            duplicidades.push({ code: 'DUPLICADA_EXISTENTE', field: 'barcode', message: `Código ${codigo} já cadastrado para o SKU com a mesma embalagem e fator.` });
          }
        } else if (noArquivoC) {
          if (noArquivoC.sku !== sku || noArquivoC.embalagem !== l.embalagem || noArquivoC.fator !== fatorEfetivo) {
            conflitos.push({ code: 'CONFLITO_NO_ARQUIVO', field: 'barcode', message: `O código ${codigo} aparece na linha ${String(noArquivoC.numero)} com outro SKU, embalagem ou fator.` });
          } else {
            duplicidades.push({ code: 'DUPLICADA_NO_ARQUIVO', field: 'barcode', message: `Código ${codigo} igual ao da linha ${String(noArquivoC.numero)}.` });
          }
        } else {
          const atuais = (existente ? (estado.codigosPorProduto.get(existente.id) ?? 0) : 0) + (novosCodigosPorSku.get(sku) ?? 0);
          if (atuais >= MAX_CODIGOS_POR_PRODUTO) {
            erros.push({ code: 'LIMITE_CODIGOS', field: 'barcode', message: `O SKU ${sku} chegaria a mais de ${String(MAX_CODIGOS_POR_PRODUTO)} códigos de barras.` });
          } else {
            codigoNovo = true;
          }
        }
      }
    }

    const { classificacao, motivos } = classificarLinha(erros, conflitos, produtoNovo || codigoNovo, duplicidades);
    if ((classificacao === 'VALIDA_NOVA' || classificacao === 'DUPLICADA') && l.sku !== null && l.descricao !== null && l.unidade !== null) {
      if (produtoNovo) {
        produtoId = randomUUID();
        plano.produtosNovos.push({ id: produtoId, sku: l.sku, descricao: l.descricao, unidade: l.unidade });
        vistosSku.set(l.sku, { numero, descricao: l.descricao, unidade: l.unidade, id: produtoId });
        vistosMaiusculo.set(l.sku.toUpperCase(), l.sku);
      }
      if (codigoNovo && l.codigo !== null && l.embalagem !== null && produtoId !== null) {
        plano.codigosNovos.push({ produtoId, codigo: l.codigo, embalagem: l.embalagem, fator: fatorEfetivo });
        vistosCodigo.set(l.codigo, { numero, sku: l.sku, embalagem: l.embalagem, fator: fatorEfetivo });
        novosCodigosPorSku.set(l.sku, (novosCodigosPorSku.get(l.sku) ?? 0) + 1);
        if (estado.porSku.has(l.sku)) plano.produtosAlterados.add(produtoId);
      }
      if (classificacao === 'VALIDA_NOVA' && produtoId !== null) plano.registroPorLinha.set(numero, produtoId);
    }
    const chave = l.sku === null ? null : `SKU ${l.sku}${l.codigo === null ? '' : ` · código ${l.codigo}`}`;
    resultado.push({
      numero,
      classificacao,
      chave,
      valores: {
        sku: l.sku,
        description: l.descricao,
        canonicalUnit: l.unidade,
        barcode: l.codigo,
        packaging: l.embalagem,
        factor: l.codigo === null ? null : fatorEfetivo,
      },
      lidos: l.lidos,
      motivos,
      avisos,
    });
  }
  return { linhas: resultado, plano };
}

/** Grava o plano. Violação de unicidade (gravação concorrente) → prévia desatualizada. */
export async function gravarProdutos(tx: Transacao, escopoId: string, usuarioId: string, plano: PlanoProdutos): Promise<{ produtosCriados: number; codigosAdicionados: number }> {
  try {
    if (plano.produtosNovos.length > 0) {
      await tx.produto.createMany({
        data: plano.produtosNovos.map((p) => ({ id: p.id, escopoId, sku: p.sku, descricao: p.descricao, unidadeCanonica: p.unidade, ativo: true, criadoPorId: usuarioId })),
      });
    }
    if (plano.codigosNovos.length > 0) {
      await tx.codigoBarras.createMany({
        data: plano.codigosNovos.map((c) => ({ escopoId, produtoId: c.produtoId, codigo: c.codigo, embalagem: c.embalagem, fatorConversao: c.fator, registradoPorId: usuarioId })),
      });
    }
  } catch (erro) {
    if (ehViolacaoUnica(erro)) {
      throw new ErroHttp(409, 'PREVIA_DESATUALIZADA', 'Outro cadastro com o mesmo SKU ou código de barras foi gravado agora. A prévia foi atualizada: revise antes de confirmar.');
    }
    throw erro;
  }
  for (const id of plano.produtosAlterados) {
    await tx.produto.updateMany({ where: { id, escopoId }, data: { versao: { increment: 1 } } });
  }
  return { produtosCriados: plano.produtosNovos.length, codigosAdicionados: plano.codigosNovos.length };
}
