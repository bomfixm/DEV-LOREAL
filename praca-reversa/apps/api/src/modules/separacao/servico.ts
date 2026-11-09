/**
 * Separação do cliente: guarda as notas da planilha e cruza com os paletes na
 * leitura, pelo número (coluna NUMERO). Assim a marcação acompanha nota movida,
 * palete renumerado e bipagem nova. Não reserva, não libera e não altera estoque.
 */
import {
  ROTULOS_SITUACAO_NOTA_SEPARACAO,
  type EnviarSeparacao,
  type Escopo,
  type ListaSeparacoes,
  type LocalNotaSeparacao,
  type NotaSeparacao,
  type SeparacaoCliente,
  type SituacaoNotaSeparacao,
} from '@praca-reversa/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { escreverXlsx } from '../importacao/arquivo/xlsx-escrita.js';

type Db = Banco | Transacao;

export interface Autor {
  usuarioId: string;
  requestId: string;
}

/** Número para comparar: sem espaços e sem zeros à esquerda. */
export const chaveNota = (numero: string): string => numero.trim().replace(/^0+(?=.)/, '');

interface Ocorrencia {
  chave: string;
  palete_id: string;
  codigo: string;
  posicao_id: string | null;
  posicao_codigo: string | null;
  endereco: string | null;
  situacao: string;
}

/** Onde estão as notas das separações ativas (conteúdo registrado, bipagem e inventário). */
async function ocorrencias(db: Db, escopoId: string): Promise<Ocorrencia[]> {
  return db.$queryRaw<Ocorrencia[]>`
    SELECT DISTINCT n.chave, p.id::text AS palete_id, p.codigo, p.posicao_id::text AS posicao_id, pos.codigo AS posicao_codigo,
           CASE WHEN ep.situacao = 'CONFIRMADO' THEN ep.endereco END AS endereco, o.situacao
      FROM (
        SELECT palete_id, numero_documento, 'ATIVO' AS situacao FROM conteudo_palete
         WHERE escopo_id = ${escopoId}::uuid AND situacao = 'ATIVO' AND numero_documento IS NOT NULL
        UNION ALL
        SELECT palete_id, numero_documento, situacao FROM vinculo_documento_palete
         WHERE escopo_id = ${escopoId}::uuid AND situacao IN ('ATIVO', 'VALIDACAO')
      ) o
      JOIN separacao_cliente_nota n ON n.escopo_id = ${escopoId}::uuid AND n.chave = ltrim(btrim(o.numero_documento), '0')
      JOIN separacao_cliente s ON s.id = n.separacao_id AND s.situacao = 'ATIVA'
      JOIN palete p ON p.id = o.palete_id AND p.arquivado_em IS NULL
      LEFT JOIN posicao pos ON pos.id = p.posicao_id
      LEFT JOIN endereco_posicao ep ON ep.posicao_id = p.posicao_id`;
}

/** Paletes que ficam roxos: têm nota de separação ativa (nota em validação não conta: o local físico é desconhecido). */
export async function paletesComSeparacao(db: Db, escopoId: string): Promise<Set<string>> {
  return new Set((await ocorrencias(db, escopoId)).filter((o) => o.situacao === 'ATIVO').map((o) => o.palete_id));
}

/** Pares palete × separação ativa em que o palete tem nota ativa (a base da marca "separado"). */
async function separacoesDosPaletes(db: Db, escopoId: string): Promise<{ palete_id: string; separacao_id: string }[]> {
  return db.$queryRaw<{ palete_id: string; separacao_id: string }[]>`
    SELECT DISTINCT p.id::text AS palete_id, s.id::text AS separacao_id
      FROM (
        SELECT palete_id, numero_documento FROM conteudo_palete
         WHERE escopo_id = ${escopoId}::uuid AND situacao = 'ATIVO' AND numero_documento IS NOT NULL
        UNION ALL
        SELECT palete_id, numero_documento FROM vinculo_documento_palete
         WHERE escopo_id = ${escopoId}::uuid AND situacao = 'ATIVO'
      ) o
      JOIN separacao_cliente_nota n ON n.escopo_id = ${escopoId}::uuid AND n.chave = ltrim(btrim(o.numero_documento), '0')
      JOIN separacao_cliente s ON s.id = n.separacao_id AND s.situacao = 'ATIVA'
      JOIN palete p ON p.id = o.palete_id AND p.arquivado_em IS NULL`;
}

/** Paletes roxos já marcados como separados para a agenda em todas as separações ativas em que aparecem. */
export async function paletesSeparados(db: Db, escopoId: string): Promise<Set<string>> {
  const [pares, marcas] = await Promise.all([
    separacoesDosPaletes(db, escopoId),
    db.separacaoClientePalete.findMany({ where: { escopoId, separacao: { situacao: 'ATIVA' } }, select: { paleteId: true, separacaoId: true } }),
  ]);
  const marcado = new Set(marcas.map((m) => `${m.paleteId}:${m.separacaoId}`));
  const pendentes = new Set(pares.filter((x) => !marcado.has(`${x.palete_id}:${x.separacao_id}`)).map((x) => x.palete_id));
  return new Set(pares.map((x) => x.palete_id).filter((id) => !pendentes.has(id)));
}

/**
 * Marca (ou desfaz) "separado para a agenda" num palete roxo: vale para as
 * separações ativas em que ele tem nota. Não reserva, não libera e não altera estoque.
 */
export async function marcarPaleteSeparado(tx: Transacao, escopo: Escopo, paleteId: string, separado: boolean, autor: Autor, agora: Date): Promise<{ palletId: string; separated: boolean }> {
  const palete = await tx.palete.findFirst({ where: { id: paleteId, escopoId: escopo.id, arquivadoEm: null }, select: { id: true, codigo: true } });
  if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
  const separacoes = (await separacoesDosPaletes(tx, escopo.id)).filter((x) => x.palete_id === palete.id).map((x) => x.separacao_id);
  if (separacoes.length === 0) throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} não tem nota de uma separação ativa do cliente (não está roxo).`);
  if (separado) {
    await tx.separacaoClientePalete.createMany({
      data: separacoes.map((separacaoId) => ({ id: randomUUID(), escopoId: escopo.id, separacaoId, paleteId: palete.id, marcadoPor: autor.usuarioId, marcadoEm: agora })),
      skipDuplicates: true,
    });
  } else {
    await tx.separacaoClientePalete.deleteMany({ where: { escopoId: escopo.id, paleteId: palete.id, separacaoId: { in: separacoes } } });
  }
  await registrarEvento(tx, {
    acao: 'PALETE_SEPARADO_AGENDA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: palete.id,
    detalhes: { codigo: palete.codigo, separado, separacoes: separacoes.join(',') },
    requestId: autor.requestId,
  });
  return { palletId: palete.id, separated: separado };
}

/** Chaves das notas pedidas nas separações ativas. */
export async function chavesEmSeparacao(db: Db, escopoId: string): Promise<Set<string>> {
  const linhas = await db.$queryRaw<{ chave: string }[]>`
    SELECT DISTINCT n.chave FROM separacao_cliente_nota n JOIN separacao_cliente s ON s.id = n.separacao_id
     WHERE n.escopo_id = ${escopoId}::uuid AND s.situacao = 'ATIVA'`;
  return new Set(linhas.map((l) => l.chave));
}

export async function listarSeparacoes(db: Db, escopoId: string): Promise<ListaSeparacoes> {
  const [separacoes, achadas] = await Promise.all([
    db.separacaoCliente.findMany({
      where: { escopoId, situacao: 'ATIVA' },
      orderBy: { criadoEm: 'desc' },
      include: { criadoPor: { select: { nome: true } }, notas: { orderBy: { linhaArquivo: 'asc' } } },
    }),
    ocorrencias(db, escopoId),
  ]);
  const porChave = new Map<string, Ocorrencia[]>();
  for (const o of achadas) porChave.set(o.chave, [...(porChave.get(o.chave) ?? []), o]);
  const local = (o: Ocorrencia): LocalNotaSeparacao => ({ palletId: o.palete_id, palletCode: o.codigo, positionCode: o.posicao_codigo, address: o.endereco });
  const items = separacoes.map((s): SeparacaoCliente => {
    const noMapa = new Set<string>();
    const notes = s.notas.map((n): NotaSeparacao => {
      const todas = porChave.get(n.chave) ?? [];
      const ativas = todas.filter((o) => o.situacao === 'ATIVO');
      const comPosicao = ativas.filter((o) => o.posicao_id !== null);
      comPosicao.forEach((o) => noMapa.add(o.palete_id));
      const situation: SituacaoNotaSeparacao = comPosicao.length > 0 ? 'NO_MAPA' : ativas.length > 0 ? 'SEM_POSICAO' : todas.length > 0 ? 'EM_VALIDACAO' : 'SEM_PALETE';
      return {
        row: n.linhaArquivo,
        number: n.numeroDocumento,
        type: n.tipoDocumento,
        delivery: n.delivery,
        volumes: n.volumes,
        sender: n.remetente,
        informedPallet: n.paleteInformado,
        informedAddress: n.enderecoInformado,
        values: n.valores as Record<string, string>,
        situation,
        locations: (comPosicao.length > 0 ? comPosicao : ativas.length > 0 ? ativas : todas).map(local),
      };
    });
    return { id: s.id, fileName: s.nomeArquivo, window: s.janela, createdAt: s.criadoEm.toISOString(), createdBy: s.criadoPor.nome, palletsOnMap: noMapa.size, headers: s.cabecalhos as string[], notes };
  });
  return { items };
}

export async function registrarSeparacao(tx: Transacao, escopo: Escopo, dados: EnviarSeparacao, autor: Autor, agora: Date): Promise<ListaSeparacoes> {
  // A mesma lista de notas não é ativada duas vezes (compara o conteúdo, não o nome do arquivo).
  const hash = createHash('sha256').update(JSON.stringify(dados.notes)).digest('hex');
  const repetida = await tx.separacaoCliente.findFirst({ where: { escopoId: escopo.id, situacao: 'ATIVA', sha256: hash }, select: { id: true } });
  if (repetida) throw new ErroHttp(409, 'CONFLITO', 'Esta mesma planilha já está ativa.');
  const id = randomUUID();
  await tx.separacaoCliente.create({ data: { id, escopoId: escopo.id, nomeArquivo: dados.fileName, sha256: hash, janela: dados.window, cabecalhos: dados.headers, criadoPorId: autor.usuarioId, criadoEm: agora } });
  await tx.separacaoClienteNota.createMany({
    data: dados.notes.map((n) => ({
      id: randomUUID(),
      escopoId: escopo.id,
      separacaoId: id,
      linhaArquivo: n.row,
      numeroDocumento: n.number,
      chave: chaveNota(n.number),
      tipoDocumento: n.type,
      delivery: n.delivery,
      volumes: n.volumes,
      remetente: n.sender,
      paleteInformado: n.informedPallet,
      enderecoInformado: n.informedAddress,
      valores: n.values,
    })),
  });
  await registrarEvento(tx, {
    acao: 'SEPARACAO_CLIENTE_ENVIADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'SEPARACAO',
    alvoId: id,
    detalhes: { arquivo: dados.fileName, janela: dados.window, notas: dados.notes.length },
    requestId: autor.requestId,
  });
  return listarSeparacoes(tx, escopo.id);
}

/** Tira a marcação do mapa; as notas ficam guardadas e nada mais muda. */
export async function encerrarSeparacao(tx: Transacao, escopo: Escopo, id: string, autor: Autor, agora: Date): Promise<ListaSeparacoes> {
  const r = await tx.separacaoCliente.updateMany({ where: { id, escopoId: escopo.id, situacao: 'ATIVA' }, data: { situacao: 'ENCERRADA', encerradoPorId: autor.usuarioId, encerradoEm: agora } });
  if (r.count !== 1) throw naoEncontrado('Separação ativa não encontrada.');
  await registrarEvento(tx, {
    acao: 'SEPARACAO_CLIENTE_ENCERRADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'SEPARACAO',
    alvoId: id,
    detalhes: {},
    requestId: autor.requestId,
  });
  return listarSeparacoes(tx, escopo.id);
}

/**
 * Relatório em Excel: situação e local no sistema, seguidos de todas as colunas
 * que o cliente mandou. Primeira aba: notas sem palete ou sem posição; segunda: no mapa.
 */
export function relatorioXlsx(s: SeparacaoCliente): Buffer {
  const t = (titulo: string, largura = 18) => ({ titulo, largura, texto: true });
  const colunas = [t('Situação', 28), t('Palete no sistema', 20), t('Endereço no sistema', 22), ...s.headers.map((h) => t(h))];
  const linha = (n: NotaSeparacao) => [
    ROTULOS_SITUACAO_NOTA_SEPARACAO[n.situation],
    n.locations.map((l) => l.palletCode).join(', ') || null,
    n.locations.flatMap((l) => (l.address === null ? [] : [l.address])).join(', ') || null,
    ...s.headers.map((h) => n.values[h] ?? null),
  ];
  return escreverXlsx([
    { nome: 'Sem palete ou posicao', colunas, linhas: s.notes.filter((n) => n.situation !== 'NO_MAPA').map(linha) },
    { nome: 'No mapa', colunas, linhas: s.notes.filter((n) => n.situation === 'NO_MAPA').map(linha) },
  ]);
}
