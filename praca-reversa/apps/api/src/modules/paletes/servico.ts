import {
  chaveDeCodigo,
  type AlterarPaleteSchema,
  type ArquivarPalete,
  type CadastroPaleteSchema,
  type Escopo,
  type PaleteDetalhe,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { camposDaViolacao, ehViolacaoUnica, restricaoDoBanco } from '../../db/erros.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { exigirSemConferenciaAtiva } from '../conferencia/servico.js';
import { consultarPalete } from '../praca/consultas.js';

export type DadosCadastro = z.output<typeof CadastroPaleteSchema>;
export type DadosAlteracao = z.output<typeof AlterarPaleteSchema>;

export interface Autor {
  usuarioId: string;
  requestId: string;
}

/** Formato do código interno gerado: provisório até a operação informar o seu padrão. */
function formatoInterno(escopo: Escopo): { prefixo: string; digitos: number } {
  return escopo.demo ? { prefixo: 'PAL-DEMO-', digitos: 3 } : { prefixo: 'PR-', digitos: 6 };
}

const escaparRegex = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function codigoDePosicao(tx: Transacao, escopoId: string, chave: string): Promise<string | null> {
  const linhas = await tx.$queryRaw<{ codigo: string }[]>`
    SELECT codigo FROM posicao
     WHERE escopo_id = ${escopoId}::uuid
       AND regexp_replace(upper(codigo), '[^A-Z0-9]', '', 'g') = ${chave}
     LIMIT 1`;
  return linhas[0]?.codigo ?? null;
}

/**
 * Próximo código interno do escopo. A linha da sequência fica bloqueada até o
 * fim da transação, então cadastros simultâneos recebem números diferentes;
 * números já usados (por exemplo, informados à mão) são pulados.
 */
async function gerarCodigo(tx: Transacao, escopo: Escopo): Promise<string> {
  const { prefixo, digitos } = formatoInterno(escopo);
  const padrao = `^${escaparRegex(prefixo)}([0-9]{1,9})$`;
  await tx.$executeRaw`
    INSERT INTO sequencia_palete (escopo_id, prefixo, digitos, proximo)
    SELECT ${escopo.id}::uuid, ${prefixo}, ${digitos},
           COALESCE(MAX(substring(codigo FROM ${padrao})::integer), 0) + 1
      FROM palete
     WHERE escopo_id = ${escopo.id}::uuid
    ON CONFLICT (escopo_id) DO NOTHING`;
  for (let tentativa = 0; tentativa < 1_000; tentativa++) {
    const [seq] = await tx.$queryRaw<{ prefixo: string; digitos: number; numero: number }[]>`
      UPDATE sequencia_palete SET proximo = proximo + 1
       WHERE escopo_id = ${escopo.id}::uuid
      RETURNING prefixo, digitos, proximo - 1 AS numero`;
    if (!seq) break;
    const codigo = `${seq.prefixo}${String(seq.numero).padStart(seq.digitos, '0')}`;
    const chave = chaveDeCodigo(codigo);
    const usado = await tx.palete.findFirst({ where: { escopoId: escopo.id, codigoBusca: chave }, select: { id: true } });
    if (!usado && (await codigoDePosicao(tx, escopo.id, chave)) === null) return codigo;
  }
  throw new ErroHttp(409, 'CONFLITO', 'Não foi possível gerar um código livre. Informe a identificação existente do palete.');
}

/** Código informado: único no escopo (inclusive arquivados) e diferente de código de posição. */
async function conferirCodigoInformado(tx: Transacao, escopo: Escopo, codigo: string): Promise<void> {
  const chave = chaveDeCodigo(codigo);
  const existente = await tx.palete.findFirst({
    where: { escopoId: escopo.id, codigoBusca: chave },
    select: { codigo: true, arquivadoEm: true },
  });
  if (existente?.arquivadoEm) {
    throw new ErroHttp(409, 'CONFLITO', `O código ${existente.codigo} pertence a um palete arquivado e não pode ser reutilizado.`);
  }
  if (existente) {
    throw new ErroHttp(409, 'CONFLITO', `Já existe o palete ${existente.codigo} com este código (ou equivalente) neste escopo.`);
  }
  const posicao = await codigoDePosicao(tx, escopo.id, chave);
  if (posicao !== null) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      `${codigo} é o código da posição ${posicao}. O ID do palete não pode ser o número da posição: a localização é registrada à parte.`,
    );
  }
}

/** Posição de destino: layout ativo do escopo, disponível, não retirada e livre. Bloqueia a linha (FOR SHARE). */
async function conferirPosicao(tx: Transacao, escopo: Escopo, posicaoId: string): Promise<string> {
  const linhas = await tx.$queryRaw<{ codigo: string; disponivel: boolean; motivo: string | null; retirada: boolean; ativo: boolean }[]>`
    SELECT p.codigo, p.disponivel, p.motivo_indisponibilidade AS motivo, p.retirada_em IS NOT NULL AS retirada, l.ativo
      FROM posicao p
      JOIN layout l ON l.id = p.layout_id
     WHERE p.id = ${posicaoId}::uuid AND p.escopo_id = ${escopo.id}::uuid
       FOR SHARE OF p`;
  const posicao = linhas[0];
  if (!posicao) throw requisicaoInvalida('Posição não encontrada no layout deste escopo.');
  if (posicao.retirada || !posicao.ativo) throw new ErroHttp(409, 'CONFLITO', `A posição ${posicao.codigo} não está no layout ativo.`);
  if (!posicao.disponivel) {
    throw new ErroHttp(409, 'CONFLITO', `A posição ${posicao.codigo} está indisponível${posicao.motivo ? ` (${posicao.motivo})` : ''}.`);
  }
  const ocupante = await tx.palete.findFirst({ where: { escopoId: escopo.id, posicaoId }, select: { codigo: true } });
  if (ocupante) throw new ErroHttp(409, 'CONFLITO', `A posição ${posicao.codigo} já tem o palete ${ocupante.codigo}.`);
  return posicao.codigo;
}

interface LinhaPreparada {
  produtoId: string | null;
  sku: string | null;
  descricao: string;
  lote: string | null;
  origemTipo: DadosCadastro['declaredItems'][number]['originType'];
  origemReferencia: string | null;
  quantidade: string;
  unidadeMedida: string;
}

/**
 * Linhas declaradas: SKU informado precisa de produto ativo do escopo e de
 * unidade conhecida para ele (unidade canônica ou embalagem com fator). Sem
 * SKU, o produto fica pendente com a descrição do documento.
 */
async function prepararLinhas(tx: Transacao, escopo: Escopo, linhas: DadosCadastro['declaredItems']): Promise<LinhaPreparada[]> {
  const skus = [...new Set(linhas.flatMap((l) => (l.sku === null ? [] : [l.sku])))];
  const produtos = await tx.produto.findMany({
    where: { escopoId: escopo.id, sku: { in: skus }, ativo: true },
    select: { id: true, sku: true, descricao: true, unidadeCanonica: true, codigosBarras: { select: { embalagem: true } } },
  });
  const porSku = new Map(produtos.map((p) => [p.sku, p]));
  return linhas.map((l, indice) => {
    const base = {
      lote: l.lot,
      origemTipo: l.originType,
      origemReferencia: l.originReference,
      quantidade: l.quantity,
      unidadeMedida: l.unit,
    };
    if (l.sku === null) return { ...base, produtoId: null, sku: null, descricao: l.description ?? 'Produto pendente' };
    const produto = porSku.get(l.sku);
    if (!produto) {
      throw requisicaoInvalida(
        `Linha ${String(indice + 1)}: o SKU ${l.sku} não está cadastrado (ou está inativo) neste escopo. Cadastre o produto ou deixe o SKU em branco para registrá-lo como pendente.`,
      );
    }
    const unidades = new Set([produto.unidadeCanonica, ...produto.codigosBarras.map((c) => c.embalagem)]);
    if (!unidades.has(l.unit)) {
      throw requisicaoInvalida(
        `Linha ${String(indice + 1)}: a unidade ${l.unit} não está cadastrada para o SKU ${l.sku} (use ${[...unidades].join(', ')} ou cadastre a embalagem com fator).`,
      );
    }
    return { ...base, produtoId: produto.id, sku: produto.sku, descricao: produto.descricao };
  });
}

function traduzirConflito(erro: unknown): never {
  if (restricaoDoBanco(erro) !== null) throw new ErroHttp(409, 'CONFLITO', 'A posição ficou indisponível ou fora do layout ativo. Escolha outra posição.');
  if (ehViolacaoUnica(erro)) {
    const campos = camposDaViolacao(erro).join(' ');
    if (campos.includes('posicao')) throw new ErroHttp(409, 'CONFLITO', 'Outra pessoa acabou de registrar um palete nesta posição. Escolha outra posição.');
    if (campos.includes('codigo')) throw new ErroHttp(409, 'CONFLITO', 'Outra pessoa acabou de usar este código de palete. Confira e tente outro.');
    throw new ErroHttp(409, 'CONFLITO', 'Código ou posição já em uso. Recarregue e confira.');
  }
  throw erro;
}

export async function cadastrarPalete(tx: Transacao, escopo: Escopo, dados: DadosCadastro, autor: Autor): Promise<PaleteDetalhe> {
  let codigo: string;
  if (dados.code.mode === 'INFORMAR') {
    codigo = dados.code.value;
    await conferirCodigoInformado(tx, escopo, codigo);
  } else {
    codigo = await gerarCodigo(tx, escopo);
  }
  const posicaoCodigo = dados.positionId === null ? null : await conferirPosicao(tx, escopo, dados.positionId);
  const linhas = await prepararLinhas(tx, escopo, dados.declaredItems);

  const id = randomUUID();
  try {
    await tx.palete.create({
      data: {
        id,
        escopoId: escopo.id,
        codigo,
        codigoBusca: chaveDeCodigo(codigo),
        origemCodigo: dados.code.mode === 'INFORMAR' ? 'EXISTENTE' : 'GERADO',
        posicaoId: dados.positionId,
        // Palete novo: conteúdo desconhecido até a conferência (etapa 04).
        estadoConferencia: 'NAO_CONFERIDO',
        estadoLiberacao: 'PENDENTE',
        estadoFluxo: 'EM_ESTOQUE',
        motivoPendencia:
          dados.positionId === null ? 'Localização pendente; conteúdo desconhecido até a conferência' : 'Conteúdo desconhecido até a conferência',
        observacoes: dados.notes,
        criadoPorId: autor.usuarioId,
      },
    });
  } catch (erro) {
    traduzirConflito(erro);
  }
  if (linhas.length > 0) {
    await tx.itemDeclarado.createMany({
      data: linhas.map((l, ordem) => ({ ...l, escopoId: escopo.id, paleteId: id, ordem, registradoPorId: autor.usuarioId })),
    });
  }
  await registrarEvento(tx, {
    acao: 'PALETE_CADASTRADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: id,
    detalhes: {
      codigo,
      origemCodigo: dados.code.mode === 'INFORMAR' ? 'EXISTENTE' : 'GERADO',
      posicao: posicaoCodigo,
      linhasDeclaradas: linhas.length,
    },
    requestId: autor.requestId,
  });
  const detalhe = await consultarPalete(tx, escopo, id);
  if (!detalhe) throw new Error('Palete recém-cadastrado não encontrado.');
  return detalhe;
}

async function paleteParaAlterar(tx: Transacao, escopo: Escopo, id: string, versaoEsperada: number) {
  const atual = await tx.palete.findFirst({
    where: { id, escopoId: escopo.id },
    select: {
      codigo: true,
      versao: true,
      observacoes: true,
      arquivadoEm: true,
      estadoConferencia: true,
      posicao: { select: { codigo: true } },
      _count: { select: { saldos: true, eventos: true, eventosDestino: true, conferencias: { where: { situacao: { not: 'CANCELADA' } } } } },
    },
  });
  if (!atual) throw naoEncontrado('Palete não encontrado neste escopo.');
  if (atual.arquivadoEm) throw new ErroHttp(409, 'CONFLITO', `O palete ${atual.codigo} está arquivado e não pode ser alterado.`);
  if (atual.versao !== versaoEsperada) {
    throw new ErroHttp(409, 'CONFLITO_VERSAO', `O palete ${atual.codigo} foi alterado por outra pessoa. Os dados atuais foram recarregados; confira antes de repetir.`);
  }
  return atual;
}

/** Edição do cadastro: somente observações, com proteção de versão. */
export async function alterarPalete(tx: Transacao, escopo: Escopo, id: string, dados: DadosAlteracao, autor: Autor): Promise<PaleteDetalhe> {
  const atual = await paleteParaAlterar(tx, escopo, id, dados.expectedVersion);
  const resultado = await tx.palete.updateMany({
    where: { id, escopoId: escopo.id, versao: dados.expectedVersion },
    data: { observacoes: dados.notes, versao: { increment: 1 } },
  });
  if (resultado.count !== 1) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O palete foi alterado por outra pessoa. Recarregue e confira.');
  await registrarEvento(tx, {
    acao: 'PALETE_ALTERADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: id,
    detalhes: { codigo: atual.codigo, campo: 'observacoes', versao: dados.expectedVersion + 1 },
    requestId: autor.requestId,
  });
  const detalhe = await consultarPalete(tx, escopo, id);
  if (!detalhe) throw naoEncontrado('Palete não encontrado neste escopo.');
  return detalhe;
}

/**
 * Arquiva um cadastro feito por engano: só sem conferência registrada. Libera
 * o vínculo de posição (registrado na auditoria) e mantém o código reservado.
 */
export async function arquivarPalete(
  tx: Transacao,
  escopo: Escopo,
  id: string,
  dados: ArquivarPalete,
  autor: Autor,
  agora: Date,
): Promise<PaleteDetalhe> {
  const atual = await paleteParaAlterar(tx, escopo, id, dados.expectedVersion);
  await exigirSemConferenciaAtiva(tx, escopo.id, id, 'O arquivamento');
  if (atual.estadoConferencia !== 'NAO_CONFERIDO' || atual._count.conferencias > 0 || atual._count.saldos > 0 || atual._count.eventos > 0 || atual._count.eventosDestino > 0) {
    throw new ErroHttp(
      409,
      'CONFLITO',
      'Somente cadastro sem conferência pode ser arquivado aqui. Palete com contagem segue o fluxo de estoque (conferência e movimentos).',
    );
  }
  const resultado = await tx.palete.updateMany({
    where: { id, escopoId: escopo.id, versao: dados.expectedVersion },
    data: {
      arquivadoEm: agora,
      arquivadoPorId: autor.usuarioId,
      motivoArquivamento: dados.reason,
      estadoFluxo: 'VAZIO_ARQUIVADO',
      posicaoId: null,
      motivoPendencia: 'Cadastro arquivado',
      versao: { increment: 1 },
    },
  });
  if (resultado.count !== 1) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O palete foi alterado por outra pessoa. Recarregue e confira.');
  await registrarEvento(tx, {
    acao: 'PALETE_ARQUIVADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: id,
    detalhes: { codigo: atual.codigo, posicaoAnterior: atual.posicao?.codigo ?? null, motivo: dados.reason },
    requestId: autor.requestId,
  });
  const detalhe = await consultarPalete(tx, escopo, id);
  if (!detalhe) throw naoEncontrado('Palete não encontrado neste escopo.');
  return detalhe;
}
