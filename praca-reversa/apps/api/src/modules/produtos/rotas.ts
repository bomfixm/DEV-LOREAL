import {
  API_PREFIXO,
  AlterarProdutoSchema,
  CriarProdutoSchema,
  FiltroIdentificarSchema,
  FiltroProdutosSchema,
  type EmbalagemProduto,
  type ListaProdutos,
  type Produto,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica } from '../../db/erros.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { executarIdempotente } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder, validar } from '../idempotencia/http.js';
import { identificarCodigo, respostaIdentificacao } from './identificar.js';

const ParametrosSchema = z.object({ id: z.uuid() });

const selecao = {
  id: true,
  sku: true,
  descricao: true,
  unidadeCanonica: true,
  ativo: true,
  versao: true,
  criadoEm: true,
  atualizadoEm: true,
  codigosBarras: { select: { codigo: true, embalagem: true, fatorConversao: true }, orderBy: { codigo: 'asc' as const } },
  _count: { select: { declarados: true, observacoes: true, segmentos: true, linhasDocumento: true } },
} as const;

type LinhaProduto = Prisma.ProdutoGetPayload<{ select: typeof selecao }>;

function produto(p: LinhaProduto): Produto {
  return {
    id: p.id,
    sku: p.sku,
    description: p.descricao,
    canonicalUnit: p.unidadeCanonica,
    active: p.ativo,
    version: p.versao,
    barcodes: p.codigosBarras.map((c) => ({ code: c.codigo, packaging: c.embalagem, factor: c.fatorConversao?.toFixed() ?? null })),
    inUse: p._count.declarados + p._count.observacoes + p._count.segmentos + p._count.linhasDocumento > 0,
    createdAt: p.criadoEm.toISOString(),
    updatedAt: p.atualizadoEm.toISOString(),
  };
}

async function lerProduto(db: Banco | Transacao, escopoId: string, id: string): Promise<Produto> {
  const p = await db.produto.findFirst({ where: { id, escopoId }, select: selecao });
  if (!p) throw naoEncontrado('Produto não encontrado neste escopo.');
  return produto(p);
}

/** Código de barras já usado por outro produto do escopo. */
async function conferirCodigos(tx: Transacao, escopoId: string, codigos: readonly EmbalagemProduto[], produtoId: string | null): Promise<void> {
  if (codigos.length === 0) return;
  const existente = await tx.codigoBarras.findFirst({
    where: { escopoId, codigo: { in: codigos.map((c) => c.code) }, ...(produtoId ? { produtoId: { not: produtoId } } : {}) },
    select: { codigo: true, produto: { select: { sku: true } } },
  });
  if (existente) {
    throw new ErroHttp(409, 'CONFLITO', `O código de barras ${existente.codigo} já pertence ao SKU ${existente.produto.sku} neste escopo.`);
  }
}

function autorDe(request: FastifyRequest) {
  return { usuarioId: contextoDe(request).sessao.usuario.id, requestId: request.id };
}

/** Cadastro de produtos do escopo. Cadastrar um produto não cria saldo físico. */
export function registrarRotasProdutos(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  app.get(`${API_PREFIXO}/produtos`, { preHandler: auth.exigirPermissao('produto.consultar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const filtro = validar(FiltroProdutosSchema, request.query, 'Filtro inválido: texto até 64 caracteres e limite de 1 a 200.');
    const texto = filtro.texto ?? '';
    const where: Prisma.ProdutoWhereInput = {
      escopoId: escopo.id,
      ...(filtro.inativos ? {} : { ativo: true }),
      ...(texto === ''
        ? {}
        : { OR: [{ sku: { contains: texto, mode: 'insensitive' } }, { descricao: { contains: texto, mode: 'insensitive' } }] }),
    };
    const [total, itens] = await Promise.all([
      deps.db.produto.count({ where }),
      deps.db.produto.findMany({ where, select: selecao, orderBy: { sku: 'asc' }, take: filtro.limite }),
    ]);
    const corpo: ListaProdutos = { items: itens.map(produto), total, truncated: total > itens.length };
    return corpo;
  });

  /**
   * Identifica um código lido ou digitado (código de barras ou SKU, texto
   * exato). Não encontrado → 404 com CODIGO_NAO_CADASTRADO: nada é associado
   * por semelhança.
   */
  app.get(`${API_PREFIXO}/produtos/identificar`, { preHandler: auth.exigirPermissao('produto.consultar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const { codigo } = validar(FiltroIdentificarSchema, request.query, 'Informe o código lido (até 64 caracteres).');
    const identificacao = await identificarCodigo(deps.db, escopo.id, codigo);
    if (!identificacao) {
      throw new ErroHttp(404, 'CODIGO_NAO_CADASTRADO', `Código ${codigo} não cadastrado neste escopo. Nenhum SKU foi associado.`);
    }
    return respostaIdentificacao(identificacao);
  });

  app.post(`${API_PREFIXO}/produtos`, { preHandler: auth.exigirPermissao('produto.cadastrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const dados = validar(CriarProdutoSchema, request.body, 'Dados do produto inválidos.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'produto.criar', chave, payload: { corpo: request.body } },
      async (tx) => {
        await conferirCodigos(tx, escopo.id, dados.barcodes, null);
        let id: string;
        try {
          ({ id } = await tx.produto.create({
            data: {
              escopoId: escopo.id,
              sku: dados.sku,
              descricao: dados.description,
              unidadeCanonica: dados.canonicalUnit,
              ativo: dados.active,
              criadoPorId: autor.usuarioId,
              // O escopo do código de barras vem do produto (chave composta).
              codigosBarras: {
                create: dados.barcodes.map((c) => ({
                  codigo: c.code,
                  embalagem: c.packaging,
                  fatorConversao: c.factor,
                  registradoPorId: autor.usuarioId,
                })),
              },
            },
            select: { id: true },
          }));
        } catch (erro) {
          if (ehViolacaoUnica(erro)) throw new ErroHttp(409, 'CONFLITO', `Já existe produto com o SKU ${dados.sku} neste escopo.`);
          throw erro;
        }
        await registrarEvento(tx, {
          acao: 'PRODUTO_CRIADO',
          resultado: 'SUCESSO',
          atorUsuarioId: autor.usuarioId,
          escopoId: escopo.id,
          alvoTipo: 'PRODUTO',
          alvoId: id,
          detalhes: { sku: dados.sku, unidade: dados.canonicalUnit, codigosBarras: dados.barcodes.length },
          requestId: autor.requestId,
        });
        return { status: 201, corpo: await lerProduto(tx, escopo.id, id) };
      },
    );
    return responder(reply, resultado);
  });

  app.put(`${API_PREFIXO}/produtos/:id`, { preHandler: auth.exigirPermissao('produto.cadastrar') }, async (request, reply) => {
    const escopo = escopoAtivoDe(request);
    const autor = autorDe(request);
    const chave = chaveIdempotencia(request);
    const { id } = validar(ParametrosSchema, request.params, 'Identificador de produto inválido.');
    const dados = validar(AlterarProdutoSchema, request.body, 'Dados do produto inválidos.');
    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: autor.usuarioId, operacao: 'produto.alterar', chave, payload: { id, corpo: request.body } },
      async (tx) => {
        const atual = await lerProduto(tx, escopo.id, id);
        if (atual.version !== dados.expectedVersion) {
          throw new ErroHttp(409, 'CONFLITO_VERSAO', `O produto ${atual.sku} foi alterado por outra pessoa. Recarregue e confira.`);
        }
        if (atual.inUse && dados.canonicalUnit !== atual.canonicalUnit) {
          throw new ErroHttp(409, 'CONFLITO', `O SKU ${atual.sku} já tem quantidades declaradas em ${atual.canonicalUnit}: a unidade canônica não pode mudar.`);
        }
        await conferirCodigos(tx, escopo.id, dados.barcodes, id);
        const atualizado = await tx.produto.updateMany({
          where: { id, escopoId: escopo.id, versao: dados.expectedVersion },
          data: { descricao: dados.description, unidadeCanonica: dados.canonicalUnit, ativo: dados.active, versao: { increment: 1 } },
        });
        if (atualizado.count !== 1) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O produto foi alterado por outra pessoa. Recarregue e confira.');
        // Códigos de barras ainda não são referenciados por outros registros: a lista é substituída.
        await tx.codigoBarras.deleteMany({ where: { escopoId: escopo.id, produtoId: id } });
        await tx.codigoBarras.createMany({
          data: dados.barcodes.map((c) => ({
            escopoId: escopo.id,
            produtoId: id,
            codigo: c.code,
            embalagem: c.packaging,
            fatorConversao: c.factor,
            registradoPorId: autor.usuarioId,
          })),
        });
        await registrarEvento(tx, {
          acao: 'PRODUTO_ALTERADO',
          resultado: 'SUCESSO',
          atorUsuarioId: autor.usuarioId,
          escopoId: escopo.id,
          alvoTipo: 'PRODUTO',
          alvoId: id,
          detalhes: {
            sku: atual.sku,
            versao: dados.expectedVersion + 1,
            ativoAnterior: atual.active,
            ativoNovo: dados.active,
            codigosBarras: dados.barcodes.length,
          },
          requestId: autor.requestId,
        });
        return { status: 200, corpo: await lerProduto(tx, escopo.id, id) };
      },
    );
    return responder(reply, resultado);
  });
}
