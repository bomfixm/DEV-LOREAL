/**
 * Notas por foto: rascunhos e fotos ficam em tabelas próprias, fora do estoque,
 * dos totais de volumes e do cliente. A leitura (OCR) roda no navegador e chega
 * aqui como sugestão: nunca passa por cima do que a pessoa digitou. A inclusão
 * usa o cadastro real, uma vez, e uma contagem só quando há volumes informados.
 */
import {
  compararIdentidade,
  type AlteracoesNotaFoto,
  type DecisaoNotaFoto,
  type Escopo,
  type IncluirNotasFotoSchema,
  type LeituraNotaFotoSchema,
  type NotaFoto,
  type NotasFotoPalete,
  type TipoEtiqueta,
} from '@praca-reversa/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { tipoDoConteudo } from '../claims/evidencias.js';
import { exigirPaleteAberto, registrarContagem, registrarConteudo } from '../conteudos/servico.js';

type Db = Banco | Transacao;

export interface Autor {
  usuarioId: string;
  requestId: string;
}

const CAMPOS: Readonly<Record<keyof AlteracoesNotaFoto, string>> = {
  documentType: 'tipoDocumento',
  documentNumber: 'numeroDocumento',
  sender: 'remetente',
  labelKind: 'tipoEtiqueta',
  delivery: 'delivery',
  volumes: 'volumes',
  decision: 'decisao',
};

const semZeros = (n: string) => n.trim().replace(/^0+(?=\d)/, '');

interface Existente {
  kind: 'REGISTRADO' | 'IMPORTADO';
  id: string;
  tipo: string | null;
  numero: string;
  cnpj: string | null;
  remetente: string | null;
}

async function existentesDoPalete(db: Db, escopoId: string, paleteId: string): Promise<Existente[]> {
  const [registrados, importados] = await Promise.all([
    db.conteudoPalete.findMany({ where: { escopoId, paleteId, situacao: 'ATIVO', numeroDocumento: { not: null } }, select: { id: true, tipoDocumento: true, numeroDocumento: true, cnpjRemetente: true, remetente: true } }),
    db.vinculoDocumentoPalete.findMany({ where: { escopoId, paleteId, situacao: 'ATIVO' }, select: { id: true, tipoDocumento: true, numeroDocumento: true, linhaInventario: { select: { remetente: true } } } }),
  ]);
  return [
    ...registrados.map((r): Existente => ({ kind: 'REGISTRADO', id: r.id, tipo: r.tipoDocumento, numero: r.numeroDocumento ?? '', cnpj: r.cnpjRemetente, remetente: r.remetente })),
    ...importados.map((v): Existente => ({ kind: 'IMPORTADO', id: v.id, tipo: v.tipoDocumento, numero: v.numeroDocumento, cnpj: null, remetente: v.linhaInventario.remetente })),
  ];
}

interface LinhaNota {
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  remetente: string | null;
  tipoEtiqueta: string | null;
  decisao: string | null;
}

/** Mesma nota no palete: nunca é decidido sozinho (sem CNPJ a foto não prova que é a mesma). */
function coincidencias(n: LinhaNota, existentes: readonly Existente[]): NotaFoto['existing'] {
  if (n.numeroDocumento === null) return [];
  const numero = semZeros(n.numeroDocumento);
  return existentes.flatMap((e) => {
    if (semZeros(e.numero) !== numero) return [];
    // O número já bate: a comparação decide só por remetente; o tipo da foto costuma estar vazio.
    const r = compararIdentidade({ tipo: e.tipo, numero: e.numero, cnpj: null, remetente: n.remetente }, { tipo: e.tipo, numero: e.numero, cnpj: e.cnpj, remetente: e.remetente });
    if (r === 'DIFERENTE') return [];
    return [{ kind: e.kind, id: e.id, label: `${e.tipo ?? 'Documento'} ${e.numero} · ${e.remetente ?? 'remetente não informado'}`, incomplete: true }];
  });
}

function faltando(n: LinhaNota, existentes: NotaFoto['existing']): string[] {
  const falta: string[] = [];
  if (n.numeroDocumento === null) falta.push('Número');
  if (n.remetente === null) falta.push('Remetente');
  if (n.tipoEtiqueta === null) falta.push('Etiqueta comum ou FULL');
  if (existentes.length > 0 && n.decisao === null) falta.push('Decidir: a nota já está no palete');
  return falta;
}

export async function listarNotasFoto(db: Db, escopo: Escopo, paleteId: string): Promise<NotasFotoPalete> {
  const palete = await db.palete.findFirst({
    where: { id: paleteId, escopoId: escopo.id },
    select: { id: true, codigo: true, posicao: { select: { codigo: true, endereco: { select: { endereco: true, situacao: true } } } } },
  });
  if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
  const [notas, existentes, done] = await Promise.all([
    db.notaFoto.findMany({
      where: { escopoId: escopo.id, paleteId, situacao: 'RASCUNHO' },
      orderBy: { criadoEm: 'asc' },
      include: { fotos: { orderBy: { enviadoEm: 'asc' }, select: { id: true, nome: true, tamanho: true, enviadoEm: true } } },
    }),
    existentesDoPalete(db, escopo.id, paleteId),
    db.notaFoto.count({ where: { escopoId: escopo.id, paleteId, situacao: { in: ['INCLUIDA', 'VINCULADA'] } } }),
  ]);
  const endereco = palete.posicao?.endereco?.situacao === 'CONFIRMADO' ? palete.posicao.endereco.endereco : (palete.posicao?.codigo ?? null);
  return {
    pallet: { id: palete.id, code: palete.codigo, address: endereco },
    done,
    items: notas.map((n): NotaFoto => {
      const existing = coincidencias(n, existentes);
      return {
        id: n.id,
        version: n.versao,
        photos: n.fotos.map((f) => ({ id: f.id, fileName: f.nome, size: f.tamanho, sentAt: f.enviadoEm.toISOString() })),
        documentType: n.tipoDocumento as NotaFoto['documentType'],
        documentNumber: n.numeroDocumento,
        sender: n.remetente,
        labelKind: n.tipoEtiqueta as TipoEtiqueta | null,
        labelReference: n.referenciaEtiqueta,
        delivery: n.delivery,
        volumes: n.volumes,
        decision: n.decisao as DecisaoNotaFoto | null,
        read: { state: n.leituraSituacao as NotaFoto['read']['state'], rawText: n.leituraTexto, numberRaw: n.leituraNumeroBruto, candidates: n.leituraCandidatos as string[] },
        existing,
        missing: faltando(n, existing),
        createdAt: n.criadoEm.toISOString(),
      };
    }),
  };
}

/** Foto salva = rascunho novo. A mesma foto de novo (retry, duplo clique) devolve o que já existe. */
export async function enviarFoto(tx: Transacao, escopo: Escopo, paleteId: string, dados: { nome: string; conteudo: Buffer }, autor: Autor, agora: Date): Promise<NotasFotoPalete> {
  const palete = await exigirPaleteAberto(tx, escopo.id, paleteId);
  const tipo = tipoDoConteudo(dados.conteudo);
  if (tipo === null || tipo === 'application/pdf') throw new ErroHttp(415, 'ARQUIVO_INVALIDO', 'Formato de imagem não aceito: envie JPEG, PNG ou WEBP.');
  const sha256 = createHash('sha256').update(dados.conteudo).digest('hex');
  const repetida = await tx.fotoNota.findFirst({ where: { escopoId: escopo.id, paleteId, sha256, nota: { situacao: { not: 'DESCARTADA' } } }, select: { id: true } });
  if (repetida) return listarNotasFoto(tx, escopo, paleteId);
  const notaId = randomUUID();
  await tx.notaFoto.create({ data: { id: notaId, escopoId: escopo.id, paleteId, criadoPorId: autor.usuarioId, criadoEm: agora, atualizadoEm: agora } });
  await tx.fotoNota.create({
    data: { id: randomUUID(), escopoId: escopo.id, notaId, paleteId, nome: dados.nome.slice(0, 200), tipoConteudo: tipo, tamanho: dados.conteudo.length, sha256, conteudo: new Uint8Array(dados.conteudo), enviadoPorId: autor.usuarioId, enviadoEm: agora },
  });
  await registrarEvento(tx, { acao: 'NOTA_FOTO_ENVIADA', resultado: 'SUCESSO', atorUsuarioId: autor.usuarioId, escopoId: escopo.id, alvoTipo: 'PALETE', alvoId: paleteId, detalhes: { palete: palete.codigo, nota: notaId, tamanho: dados.conteudo.length }, requestId: autor.requestId });
  return listarNotasFoto(tx, escopo, paleteId);
}

async function bloquearNota(tx: Transacao, escopoId: string, id: string): Promise<void> {
  const [n] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM nota_foto WHERE id = ${id}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!n) throw naoEncontrado('Nota não encontrada neste escopo.');
}

/** Leitura atrasada ou repetida preenche só o que a pessoa não editou; a sugestão de volumes nunca vira valor. */
export async function registrarLeitura(tx: Transacao, escopo: Escopo, notaId: string, dados: z.output<typeof LeituraNotaFotoSchema>, agora: Date): Promise<NotasFotoPalete> {
  await bloquearNota(tx, escopo.id, notaId);
  const n = await tx.notaFoto.findFirstOrThrow({ where: { id: notaId, escopoId: escopo.id } });
  if (n.situacao !== 'RASCUNHO') return listarNotasFoto(tx, escopo, n.paleteId);
  const editados = new Set(n.camposEditados as string[]);
  const livre = (campo: keyof AlteracoesNotaFoto) => !editados.has(campo);
  await tx.notaFoto.update({
    where: { id: notaId },
    data: {
      leituraSituacao: dados.failed ? 'FALHOU' : 'LIDA',
      leituraTexto: dados.rawText,
      leituraNumeroBruto: dados.numberRaw,
      leituraCandidatos: dados.candidates,
      atualizadoEm: agora,
      referenciaEtiqueta: dados.reference,
      ...(livre('documentNumber') && dados.number !== null ? { numeroDocumento: dados.number } : {}),
      ...(livre('sender') && dados.sender !== null ? { remetente: dados.sender } : {}),
      ...(livre('labelKind') && dados.labelKind !== null ? { tipoEtiqueta: dados.labelKind } : {}),
    },
  });
  return listarNotasFoto(tx, escopo, n.paleteId);
}

const vazioParaNulo = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim());

/** Salva as alterações de uma nota: só os campos enviados, marcados como editados pela pessoa. */
export async function salvarNota(tx: Transacao, escopo: Escopo, paleteId: string, item: { id: string; expectedVersion: number; changes: AlteracoesNotaFoto }, autor: Autor, agora: Date): Promise<void> {
  await bloquearNota(tx, escopo.id, item.id);
  const n = await tx.notaFoto.findFirstOrThrow({ where: { id: item.id, escopoId: escopo.id, paleteId } });
  if (n.situacao !== 'RASCUNHO') throw new ErroHttp(409, 'CONFLITO', 'Esta nota já foi incluída ou descartada.');
  const c = item.changes;
  const dados = {
    ...(c.documentType !== undefined ? { tipoDocumento: c.documentType } : {}),
    ...(c.documentNumber !== undefined ? { numeroDocumento: vazioParaNulo(c.documentNumber) ?? null } : {}),
    ...(c.sender !== undefined ? { remetente: vazioParaNulo(c.sender) ?? null } : {}),
    ...(c.labelKind !== undefined ? { tipoEtiqueta: c.labelKind } : {}),
    ...(c.delivery !== undefined ? { delivery: vazioParaNulo(c.delivery) ?? null } : {}),
    ...(c.volumes !== undefined ? { volumes: c.volumes } : {}),
    ...(c.decision !== undefined ? { decisao: c.decision } : {}),
  };
  if (n.versao !== item.expectedVersion) {
    // Repetição do mesmo salvamento (rede caiu na resposta) não é conflito.
    const iguais = Object.entries(dados).every(([campo, valor]) => (n as unknown as Record<string, unknown>)[campo] === valor);
    if (iguais) return;
    throw new ErroHttp(409, 'CONFLITO_VERSAO', 'Outra pessoa alterou esta nota: atualize e confira.');
  }
  const editados = [...new Set([...(n.camposEditados as string[]), ...Object.keys(c).filter((k) => k in CAMPOS)])];
  await tx.notaFoto.update({ where: { id: item.id }, data: { ...dados, camposEditados: editados, versao: { increment: 1 }, atualizadoPorId: autor.usuarioId, atualizadoEm: agora } });
}

/** Inclui no cadastro real, uma vez: repetir (duplo clique, retry) não duplica. */
export async function incluirNota(tx: Transacao, escopo: Escopo, paleteId: string, id: string, autor: Autor, agora: Date): Promise<void> {
  await bloquearNota(tx, escopo.id, id);
  const n = await tx.notaFoto.findFirstOrThrow({ where: { id, escopoId: escopo.id, paleteId } });
  if (n.situacao === 'INCLUIDA' || n.situacao === 'VINCULADA') return;
  if (n.situacao !== 'RASCUNHO') throw new ErroHttp(409, 'CONFLITO', 'Esta nota foi descartada.');
  const existentes = coincidencias(n, await existentesDoPalete(tx, escopo.id, paleteId));
  const falta = faltando(n, existentes);
  if (falta.length > 0) throw new ErroHttp(409, 'CONFLITO', `Falta: ${falta.join(', ')}.`);
  const fim = { atualizadoPorId: autor.usuarioId, atualizadoEm: agora, versao: { increment: 1 } };
  const primeiro = existentes[0];
  if (n.decisao === 'VINCULAR_FOTO' && primeiro !== undefined) {
    // Só a foto: nem quantidade nem cadastro novo na nota que já existe.
    await tx.notaFoto.update({ where: { id }, data: { ...fim, situacao: 'VINCULADA', ...(primeiro.kind === 'REGISTRADO' ? { conteudoId: primeiro.id } : { vinculoId: primeiro.id }) } });
  } else {
    const conteudoId = randomUUID();
    const descricao = n.tipoEtiqueta === 'FULL' ? `Etiqueta FULL${n.referenciaEtiqueta === null ? '' : ` ${n.referenciaEtiqueta}`}` : null;
    await registrarConteudo(tx, escopo, paleteId, { sender: n.remetente ?? '', documentType: n.tipoDocumento as 'NF' | 'NFD' | 'MI' | null, documentNumber: n.numeroDocumento, delivery: n.delivery, description: descricao }, autor, agora, conteudoId);
    if (n.volumes !== null) {
      await registrarContagem(tx, escopo, paleteId, { target: { kind: 'REGISTRADO', id: conteudoId }, counted: n.volumes, expected: null, origin: 'CONTAGEM_INFORMADA', reference: 'Notas por foto' }, autor, agora);
    }
    await tx.notaFoto.update({ where: { id }, data: { ...fim, situacao: 'INCLUIDA', conteudoId } });
  }
  await registrarEvento(tx, { acao: 'NOTA_FOTO_INCLUIDA', resultado: 'SUCESSO', atorUsuarioId: autor.usuarioId, escopoId: escopo.id, alvoTipo: 'PALETE', alvoId: paleteId, detalhes: { nota: id, numero: n.numeroDocumento, decisao: n.decisao, volumes: n.volumes }, requestId: autor.requestId });
}

export async function descartarNota(tx: Transacao, escopo: Escopo, id: string, autor: Autor, agora: Date): Promise<NotasFotoPalete> {
  await bloquearNota(tx, escopo.id, id);
  const n = await tx.notaFoto.findFirstOrThrow({ where: { id, escopoId: escopo.id } });
  if (n.situacao === 'RASCUNHO') await tx.notaFoto.update({ where: { id }, data: { situacao: 'DESCARTADA', atualizadoPorId: autor.usuarioId, atualizadoEm: agora } });
  return listarNotasFoto(tx, escopo, n.paleteId);
}

export type DadosIncluir = z.output<typeof IncluirNotasFotoSchema>;

export async function lerFoto(db: Db, escopoId: string, id: string): Promise<{ conteudo: Uint8Array; tipo: string } | null> {
  const f = await db.fotoNota.findFirst({ where: { id, escopoId }, select: { conteudo: true, tipoConteudo: true } });
  return f ? { conteudo: f.conteudo, tipo: f.tipoConteudo } : null;
}
