/**
 * Notas do palete (carga do inventário em lote): os campos que o operador vê
 * em cada NF do palete — NFD, remetente, cidade destino, volumes, palete full,
 * mesma NFD em mais de um palete e produto na caixa — e as edições de cidade
 * destino e produto na caixa.
 *
 * - As indicações (palete full, outros locais da mesma NF) são calculadas dos
 *   vínculos ATIVOS de agora, não copiadas da fotografia: uma movimentação ou
 *   atualização válida muda o resultado. A fotografia do pacote fica ao lado,
 *   como referência.
 * - "Mesma NF" = mesma identidade documental (tipo, número e DELIVERY ou
 *   remetente). O mesmo número em outro contexto aparece só como candidato.
 * - Referência fora da praça = linha de endereço livre (verde) de inventário
 *   ativo: o material saiu daquela posição e o local atual não foi informado.
 * - Cidade destino vale para a NF (identidade) em todos os paletes; produto na
 *   caixa é do vínculo NF × palete. Ficam fora da fotografia imutável:
 *   reimportar campo vazio não apaga o que foi preenchido.
 */
import {
  normalizarQuantidade,
  type AlterarCidadeDestinoSchema,
  type AlterarProdutoNaCaixaSchema,
  type CandidatoNota,
  type DocumentoPalete,
  type DocumentosPalete,
  type Escopo,
  type LocalNota,
  type NovaDescricaoCaixaSchema,
  type PaleteFull,
  type RetirarDescricaoCaixaSchema,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ehViolacaoUnica } from '../../db/erros.js';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { identidadeDocumento, lerMarcadoresFull } from '../importacao/identidade.js';

type Db = Banco | Transacao;
type DadosCidade = z.output<typeof AlterarCidadeDestinoSchema>;
type DadosProduto = z.output<typeof AlterarProdutoNaCaixaSchema>;
type DadosCaixa = z.output<typeof NovaDescricaoCaixaSchema>;
type DadosRetirar = z.output<typeof RetirarDescricaoCaixaSchema>;

export interface Autor {
  usuarioId: string;
  requestId: string;
}

const pessoa = (u: { login: string; nome: string } | null) => (u ? { login: u.login, name: u.nome } : null);
const dia = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));

/** Fotografia gravada pela carga em lote (campos lidos com cuidado: JSON livre). */
interface Fotografia {
  paleteFull?: boolean | null;
  maisDeUmPalete?: boolean;
  quantidadePaletesDeclarada?: number | null;
  partesFullNesteEndereco?: number[];
  pendencias?: string[];
  volumesNaOrigem?: { linha: number; valor: string | null; texto: string }[];
}

function fotografiaDe(v: unknown): Fotografia | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null;
}

const fullDe = (v: boolean | null | undefined): PaleteFull | null => (v === undefined ? null : v === true ? 'FULL' : v === false ? 'MISTO' : 'NAO_INFORMADO');

/** Pendências do pacote em linguagem do operador. */
const TEXTO_PENDENCIA: Readonly<Record<string, string>> = {
  VOLUMES_EM_MULTIPLAS_LINHAS_A_CONFIRMAR: 'Volumes em mais de uma linha iguais na origem: confirmar (não foram somados).',
  VOLUMES_NAO_INFORMADOS_OU_INVALIDOS: 'Volumes não informados ou inválidos na origem.',
  MESMO_NUMERO_EM_CONTEXTOS_DOCUMENTAIS_DISTINTOS: 'O mesmo número aparece em outro contexto documental (outro DELIVERY/remetente): confira os candidatos.',
  TOTAL_PALETES_FULL_CONFLITANTE: 'Total de paletes no PALLET FULL diverge entre as linhas desta NF.',
  TIPO_DOCUMENTAL_PENDENTE: 'Tipo do documento não informado na origem (não é tratado como NFD).',
  DOCUMENTO_DE_OUTRO_TIPO: 'Documento de outro tipo (não é NFD).',
};

/** Endereço completo informado no inventário ativo, por palete (linhas aplicadas, a mais recente). */
export async function enderecosInformados(db: Db, escopoId: string, paleteIds: readonly string[]): Promise<Map<string, { endereco: string; inventario: string }>> {
  if (paleteIds.length === 0) return new Map();
  const linhas = await db.$queryRaw<{ palete_id: string; endereco: string; inventario: string }[]>`
    SELECT DISTINCT ON (li.palete_id) li.palete_id::text, li.endereco_canonico AS endereco, i.codigo AS inventario
      FROM linha_inventario li
      JOIN inventario_referencia i ON i.id = li.inventario_id
     WHERE li.escopo_id = ${escopoId}::uuid AND li.palete_id = ANY(${[...new Set(paleteIds)]}::uuid[])
       AND li.aplicada AND NOT li.endereco_livre AND li.endereco_canonico IS NOT NULL AND i.situacao = 'ATIVO'
     ORDER BY li.palete_id, li.criado_em DESC, li.linha_arquivo`;
  return new Map(linhas.map((l) => [l.palete_id, { endereco: l.endereco, inventario: l.inventario }]));
}

interface OutroVinculo {
  paleteId: string;
  paleteCodigo: string;
  expedido: boolean;
  posicaoCodigo: string | null;
  enderecoReal: string | null;
  identidade: string;
  tipo: string | null;
  numero: string;
  delivery: string | null;
  remetente: string | null;
  enderecoInformado: string | null;
  inventario: string;
  linha: number;
}

/** Notas (vínculos documentais) do palete com os campos do operador e as indicações recalculadas. */
export async function notasDoPalete(db: Db, escopoId: string, paleteId: string): Promise<DocumentosPalete> {
  const palete = await db.palete.findFirst({
    where: { id: paleteId, escopoId },
    select: { id: true, codigo: true, posicaoId: true, posicao: { select: { codigo: true, endereco: { select: { endereco: true, situacao: true } } } } },
  });
  if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
  const vinculos = await db.vinculoDocumentoPalete.findMany({
    where: { escopoId, paleteId },
    orderBy: [{ situacao: 'asc' }, { tipoDocumento: 'asc' }, { numeroDocumento: 'asc' }, { criadoEm: 'asc' }],
    include: {
      inventario: { select: { id: true, codigo: true, descricao: true, referenciaConferencia: true, dataConferencia: true } },
      linhaInventario: { select: { linhaArquivo: true, enderecoCanonico: true, enderecoLido: true, remetente: true } },
    },
  });
  const identidadeDe = (v: (typeof vinculos)[number]) =>
    v.identidadeDocumento ?? identidadeDocumento(v.tipoDocumento, v.numeroDocumento, v.delivery, v.linhaInventario.remetente);
  const ativos = vinculos.filter((v) => v.situacao === 'ATIVO');
  const numeros = [...new Set(ativos.map((v) => v.numeroDocumento))];
  const identidades = [...new Set(ativos.map(identidadeDe))];

  // Outros paletes com o mesmo número (mesma identidade = outro local; outra identidade = candidato).
  const outrosBrutos =
    numeros.length === 0
      ? []
      : await db.vinculoDocumentoPalete.findMany({
          where: { escopoId, situacao: 'ATIVO', numeroDocumento: { in: numeros }, paleteId: { not: paleteId }, palete: { arquivadoEm: null } },
          select: {
            paleteId: true,
            identidadeDocumento: true,
            tipoDocumento: true,
            numeroDocumento: true,
            delivery: true,
            palete: { select: { codigo: true, estadoFluxo: true, posicao: { select: { codigo: true, endereco: { select: { endereco: true, situacao: true } } } } } },
            inventario: { select: { codigo: true } },
            linhaInventario: { select: { linhaArquivo: true, enderecoCanonico: true, remetente: true } },
          },
        });
  const outros: OutroVinculo[] = outrosBrutos.map((o) => ({
    paleteId: o.paleteId,
    paleteCodigo: o.palete.codigo,
    expedido: o.palete.estadoFluxo === 'EXPEDIDO',
    posicaoCodigo: o.palete.posicao?.codigo ?? null,
    enderecoReal: o.palete.posicao?.endereco?.situacao === 'CONFIRMADO' ? o.palete.posicao.endereco.endereco : null,
    identidade: o.identidadeDocumento ?? identidadeDocumento(o.tipoDocumento, o.numeroDocumento, o.delivery, o.linhaInventario.remetente),
    tipo: o.tipoDocumento,
    numero: o.numeroDocumento,
    delivery: o.delivery,
    remetente: o.linhaInventario.remetente,
    enderecoInformado: o.linhaInventario.enderecoCanonico,
    inventario: o.inventario.codigo,
    linha: o.linhaInventario.linhaArquivo,
  }));
  // Referências fora da praça: endereço livre no inventário ativo (material saiu; local atual não informado).
  const foraBrutos =
    numeros.length === 0
      ? []
      : await db.linhaInventario.findMany({
          where: { escopoId, enderecoLivre: true, numeroDocumento: { in: numeros }, inventario: { situacao: 'ATIVO' } },
          select: { linhaArquivo: true, tipoDocumento: true, numeroDocumento: true, delivery: true, remetente: true, identidadeDocumento: true, enderecoCanonico: true, enderecoLido: true, inventario: { select: { codigo: true } } },
          orderBy: { linhaArquivo: 'asc' },
        });
  const fora = foraBrutos.map((f) => ({
    ...f,
    identidade: f.identidadeDocumento ?? identidadeDocumento(f.tipoDocumento, f.numeroDocumento ?? '', f.delivery, f.remetente),
  }));
  const [informacoes, conteudos, semDocumento, referencias, informado] = await Promise.all([
    identidades.length === 0
      ? []
      : db.informacaoDocumento.findMany({ where: { escopoId, identidadeDocumento: { in: identidades } }, select: { identidadeDocumento: true, cidadeDestino: true, versao: true } }),
    db.conteudoDocumentoPalete.findMany({
      where: { escopoId, paleteId },
      select: {
        identidadeDocumento: true,
        produtoNaCaixa: true,
        versao: true,
        descricoes: { where: { removidaEm: null }, orderBy: { criadoEm: 'asc' }, select: { id: true, grupo: true, descricao: true, criadoEm: true, criadoPor: { select: { login: true, nome: true } } } },
      },
    }),
    db.linhaInventario.findMany({
      where: { escopoId, paleteId, aplicada: true, numeroDocumento: null, inventario: { situacao: 'ATIVO' } },
      orderBy: { linhaArquivo: 'asc' },
      select: { linhaArquivo: true, remetente: true, volumes: true, inventario: { select: { codigo: true } } },
    }),
    db.linhaInventario.findMany({
      where: { escopoId, paleteId, aplicada: true, numeroPalete: { not: null }, inventario: { situacao: 'ATIVO' } },
      distinct: ['inventarioId', 'numeroPalete'],
      select: { numeroPalete: true, inventarioId: true, enderecoCanonico: true, inventario: { select: { codigo: true } } },
    }),
    palete.posicaoId === null ? enderecosInformados(db, escopoId, [paleteId]) : Promise.resolve(new Map<string, { endereco: string; inventario: string }>()),
  ]);
  const outrosEnderecosDaReferencia = await Promise.all(
    referencias.map(async (r) => {
      const mesmos = await db.linhaInventario.findMany({
        where: { escopoId, inventarioId: r.inventarioId, numeroPalete: r.numeroPalete, enderecoCanonico: { not: r.enderecoCanonico } },
        distinct: ['enderecoCanonico'],
        select: { enderecoCanonico: true },
      });
      return { value: r.numeroPalete ?? '', inventoryCode: r.inventario.codigo, otherAddresses: mesmos.flatMap((m) => (m.enderecoCanonico === null ? [] : [m.enderecoCanonico])).sort() };
    }),
  );
  const cidadePor = new Map(informacoes.map((i) => [i.identidadeDocumento, i]));
  const conteudoPor = new Map(conteudos.map((c) => [c.identidadeDocumento, c]));

  // Palete full dos vínculos atuais: 1 identidade NFD sem conteúdo sem documento = full; 2+ = misto; o resto, não informado.
  let full: PaleteFull;
  let motivo: string;
  if (identidades.length >= 2) {
    full = 'MISTO';
    motivo = `${String(identidades.length)} documentos diferentes neste palete.`;
  } else if (identidades.length === 1 && ativos.every((v) => v.tipoDocumento === 'NFD') && semDocumento.length === 0) {
    full = 'FULL';
    motivo = 'Uma única NFD neste palete, com registros suficientes.';
  } else {
    full = 'NAO_INFORMADO';
    motivo =
      identidades.length === 0
        ? semDocumento.length > 0
          ? 'Há conteúdo sem número de documento no inventário e nenhum documento vinculado: informação insuficiente.'
          : 'Nenhum documento vinculado a este palete.'
        : semDocumento.length > 0
          ? 'Há conteúdo sem número de documento no inventário: informação insuficiente.'
          : 'O único documento não é uma NFD (tipo pendente ou outro tipo): informação insuficiente.';
  }
  const importado = ativos.map((v) => fotografiaDe(v.fotografia)).find((f): f is Fotografia => f !== null && 'paleteFull' in f);

  const items = vinculos.map((v): DocumentoPalete => {
    const identidade = identidadeDe(v);
    const foto = fotografiaDe(v.fotografia);
    const marcadores = lerMarcadoresFull([v.palletFull]);
    const declarados = foto?.quantidadePaletesDeclarada ?? marcadores.total;
    const mesmos: LocalNota[] = [
      ...outros
        .filter((o) => o.identidade === identidade)
        .map((o) => ({
          // Palete expedido saiu da praça: não é localização atual.
          kind: o.expedido ? ('FORA_DA_PRACA' as const) : ('ATUAL' as const),
          palletId: o.paleteId,
          palletCode: o.paleteCodigo,
          positionCode: o.posicaoCodigo,
          address: o.enderecoReal ?? o.enderecoInformado,
          mapPending: !o.expedido && o.posicaoCodigo === null,
          inventoryCode: o.inventario,
          row: o.linha,
        })),
      ...fora
        .filter((f) => f.identidade === identidade)
        .map((f) => ({
          kind: 'FORA_DA_PRACA' as const,
          palletId: null,
          palletCode: null,
          positionCode: null,
          address: f.enderecoCanonico ?? f.enderecoLido,
          mapPending: false,
          inventoryCode: f.inventario.codigo,
          row: f.linhaArquivo,
        })),
    ];
    const candidatos: CandidatoNota[] = [
      ...outros
        .filter((o) => o.numero === v.numeroDocumento && o.identidade !== identidade)
        .map((o) => ({ documentType: o.tipo, documentNumber: o.numero, delivery: o.delivery, sender: o.remetente, palletId: o.paleteId, palletCode: o.paleteCodigo, address: o.enderecoReal ?? o.enderecoInformado, kind: o.expedido ? ('FORA_DA_PRACA' as const) : ('ATUAL' as const) })),
      ...fora
        .filter((f) => f.numeroDocumento === v.numeroDocumento && f.identidade !== identidade)
        .map((f) => ({ documentType: f.tipoDocumento, documentNumber: f.numeroDocumento ?? v.numeroDocumento, delivery: f.delivery, sender: f.remetente, palletId: null, palletCode: null, address: f.enderecoCanonico ?? f.enderecoLido, kind: 'FORA_DA_PRACA' as const })),
    ];
    const volumesPorLinha = foto?.volumesNaOrigem ?? [];
    const pendencias = [
      ...(v.volumes === null && !(foto?.pendencias ?? []).includes('VOLUMES_EM_MULTIPLAS_LINHAS_A_CONFIRMAR') ? ['Volumes pendentes: quantidade desconhecida (não é saldo disponível).'] : []),
      ...(foto?.pendencias ?? []).flatMap((p) => (p === 'VOLUMES_NAO_INFORMADOS_OU_INVALIDOS' && v.volumes === null ? [] : [TEXTO_PENDENCIA[p] ?? p])),
      ...(v.tipoDocumento !== 'NFD' && !(foto?.pendencias ?? []).some((p) => p === 'TIPO_DOCUMENTAL_PENDENTE' || p === 'DOCUMENTO_DE_OUTRO_TIPO')
        ? [v.tipoDocumento === null ? (TEXTO_PENDENCIA.TIPO_DOCUMENTAL_PENDENTE ?? '') : `Documento ${v.tipoDocumento} (não é NFD).`]
        : []),
    ];
    const cidade = cidadePor.get(identidade);
    const conteudo = conteudoPor.get(identidade);
    return {
      id: v.id,
      documentType: v.tipoDocumento,
      documentNumber: v.numeroDocumento,
      documentKey: v.chaveDocumento,
      delivery: v.delivery,
      volumes: v.volumes === null ? null : normalizarQuantidade(v.volumes.toFixed()),
      volumesUnit: v.unidadeVolumes,
      documentation: v.documentacao,
      palletFull: v.palletFull,
      state: v.situacao === 'ENCERRADO' ? 'ENCERRADO' : 'ATIVO',
      externalCount: v.conferidoExternamente,
      endedAt: v.encerradoEm?.toISOString() ?? null,
      endReason: v.motivoEncerramento,
      informedAddress: v.linhaInventario.enderecoCanonico ?? v.linhaInventario.enderecoLido,
      source: {
        inventoryId: v.inventario.id,
        inventoryCode: v.inventario.codigo,
        description: v.inventario.descricao,
        countReference: v.inventario.referenciaConferencia,
        countDate: dia(v.inventario.dataConferencia),
        row: v.linhaInventario.linhaArquivo,
        importedAt: v.criadoEm.toISOString(),
      },
      identity: identidade,
      isNfd: v.tipoDocumento === 'NFD',
      sender: v.linhaInventario.remetente,
      destinationCity: { value: cidade?.cidadeDestino ?? '', version: cidade?.versao ?? 0 },
      productInBox: {
        value: conteudo?.produtoNaCaixa ?? '',
        version: conteudo?.versao ?? 0,
        boxes: (conteudo?.descricoes ?? []).map((d) => ({ id: d.id, group: d.grupo, description: d.descricao, createdAt: d.criadoEm.toISOString(), createdBy: pessoa(d.criadoPor) })),
      },
      volumesByRow: volumesPorLinha.length > 1 || (v.volumes === null && volumesPorLinha.length > 0) ? volumesPorLinha.map((x) => ({ row: x.linha, value: x.valor, text: x.texto })) : [],
      multiplePallets: {
        indicated: (declarados ?? 0) > 1 || mesmos.length > 0,
        declaredPallets: declarados ?? null,
        partsHere: foto?.partesFullNesteEndereco ?? marcadores.partes,
        others: mesmos,
        sameNumberElsewhere: candidatos,
      },
      pending: v.situacao === 'ATIVO' ? pendencias : [],
    };
  });

  const naoAplicadas = await db.linhaInventario.findMany({
    where: { escopoId, aplicada: false, resolvidaPorId: null, OR: [{ paleteId }, { numeroPalete: { equals: palete.codigo, mode: 'insensitive' } }] },
    orderBy: { linhaArquivo: 'asc' },
    take: 200,
    select: { linhaArquivo: true, numeroDocumento: true, acao: true, motivos: true, inventario: { select: { codigo: true } } },
  });
  const endereco = informado.get(paleteId);
  return {
    palletId: palete.id,
    items,
    notApplied: naoAplicadas.map((l) => ({
      inventoryCode: l.inventario.codigo,
      row: l.linhaArquivo,
      documentNumber: l.numeroDocumento,
      action: l.acao,
      reason: (l.motivos as { message?: string }[])[0]?.message ?? null,
    })),
    palletFull: { value: full, imported: importado === undefined ? null : fullDe(importado.paleteFull), reason: motivo },
    informedAddress: endereco === undefined ? null : { address: endereco.endereco, mapPending: true, inventoryCode: endereco.inventario },
    externalReferences: outrosEnderecosDaReferencia.filter((r) => r.value !== ''),
    contentWithoutDocument: semDocumento.map((s) => ({
      row: s.linhaArquivo,
      sender: s.remetente,
      volumes: s.volumes === null ? null : normalizarQuantidade(s.volumes.toFixed()),
      inventoryCode: s.inventario.codigo,
    })),
  };
}

// ---------- Edições ----------

/** Palete editável do escopo com vínculo ATIVO da identidade informada. */
async function exigirNotaDoPalete(tx: Transacao, escopoId: string, paleteId: string, identidade: string) {
  const palete = await tx.palete.findFirst({ where: { id: paleteId, escopoId }, select: { codigo: true, arquivadoEm: true } });
  if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
  if (palete.arquivadoEm !== null) throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} está arquivado e não pode ser alterado.`);
  const vinculos = await tx.vinculoDocumentoPalete.findMany({
    where: { escopoId, paleteId, situacao: 'ATIVO' },
    select: { identidadeDocumento: true, tipoDocumento: true, numeroDocumento: true, delivery: true, linhaInventario: { select: { remetente: true } } },
  });
  const vinculo = vinculos.find((v) => (v.identidadeDocumento ?? identidadeDocumento(v.tipoDocumento, v.numeroDocumento, v.delivery, v.linhaInventario.remetente)) === identidade);
  if (!vinculo) throw naoEncontrado('Esta nota não está vinculada a este palete (o vínculo pode ter sido encerrado). Recarregue.');
  return { codigo: palete.codigo, tipo: vinculo.tipoDocumento, numero: vinculo.numeroDocumento };
}

function conflitoVersao(): never {
  throw new ErroHttp(409, 'CONFLITO_VERSAO', 'A nota foi alterada por outra pessoa. Os dados atuais foram recarregados; confira antes de repetir.');
}

/** Cidade destino da NF (identidade): vale para a mesma NF em todos os paletes. */
export async function alterarCidadeDestino(tx: Transacao, escopo: Escopo, paleteId: string, dados: DadosCidade, autor: Autor, agora: Date): Promise<DocumentosPalete> {
  const nota = await exigirNotaDoPalete(tx, escopo.id, paleteId, dados.identity);
  const [atual] = await tx.$queryRaw<{ id: string; cidade: string; versao: number }[]>`
    SELECT id::text, cidade_destino AS cidade, versao FROM informacao_documento
     WHERE escopo_id = ${escopo.id}::uuid AND identidade_documento = ${dados.identity} FOR UPDATE`;
  if ((atual?.versao ?? 0) !== dados.expectedVersion) conflitoVersao();
  if (atual === undefined) {
    try {
      await tx.informacaoDocumento.create({
        data: { id: randomUUID(), escopoId: escopo.id, identidadeDocumento: dados.identity, tipoDocumento: nota.tipo, numeroDocumento: nota.numero, cidadeDestino: dados.value, atualizadoPorId: autor.usuarioId, atualizadoEm: agora },
      });
    } catch (erro) {
      if (ehViolacaoUnica(erro)) conflitoVersao();
      throw erro;
    }
  } else if (atual.cidade !== dados.value) {
    await tx.informacaoDocumento.update({ where: { id: atual.id }, data: { cidadeDestino: dados.value, versao: { increment: 1 }, atualizadoPorId: autor.usuarioId, atualizadoEm: agora } });
  }
  if ((atual?.cidade ?? '') !== dados.value) {
    await registrarEvento(tx, {
      acao: 'NOTA_CIDADE_DESTINO_ALTERADA',
      resultado: 'SUCESSO',
      atorUsuarioId: autor.usuarioId,
      escopoId: escopo.id,
      alvoTipo: 'DOCUMENTO',
      alvoId: dados.identity,
      detalhes: { documento: `${nota.tipo ?? '?'} ${nota.numero}`, palete: nota.codigo, antes: atual?.cidade ?? '', depois: dados.value },
      requestId: autor.requestId,
    });
  }
  return notasDoPalete(tx, escopo.id, paleteId);
}

/** Linha do produto na caixa (cria vazia na primeira edição). Bloqueada até o fim da transação. */
async function conteudoParaAlterar(tx: Transacao, escopoId: string, paleteId: string, identidade: string, agora: Date, autor: Autor) {
  const [atual] = await tx.$queryRaw<{ id: string; produto: string; versao: number }[]>`
    SELECT id::text, produto_na_caixa AS produto, versao FROM conteudo_documento_palete
     WHERE escopo_id = ${escopoId}::uuid AND palete_id = ${paleteId}::uuid AND identidade_documento = ${identidade} FOR UPDATE`;
  return { atual: atual ?? null, criar: () => tx.conteudoDocumentoPalete.create({ data: { id: randomUUID(), escopoId, paleteId, identidadeDocumento: identidade, produtoNaCaixa: '', atualizadoPorId: autor.usuarioId, atualizadoEm: agora } }) };
}

/** Produto na caixa do vínculo NF × palete (descrição livre; não cria saldo por SKU). */
export async function alterarProdutoNaCaixa(tx: Transacao, escopo: Escopo, paleteId: string, dados: DadosProduto, autor: Autor, agora: Date): Promise<DocumentosPalete> {
  const nota = await exigirNotaDoPalete(tx, escopo.id, paleteId, dados.identity);
  const { atual } = await conteudoParaAlterar(tx, escopo.id, paleteId, dados.identity, agora, autor);
  if ((atual?.versao ?? 0) !== dados.expectedVersion) conflitoVersao();
  if (atual === null) {
    try {
      await tx.conteudoDocumentoPalete.create({
        data: { id: randomUUID(), escopoId: escopo.id, paleteId, identidadeDocumento: dados.identity, produtoNaCaixa: dados.value, atualizadoPorId: autor.usuarioId, atualizadoEm: agora },
      });
    } catch (erro) {
      if (ehViolacaoUnica(erro)) conflitoVersao();
      throw erro;
    }
  } else if (atual.produto !== dados.value) {
    await tx.conteudoDocumentoPalete.update({ where: { id: atual.id }, data: { produtoNaCaixa: dados.value, versao: { increment: 1 }, atualizadoPorId: autor.usuarioId, atualizadoEm: agora } });
  }
  if ((atual?.produto ?? '') !== dados.value) {
    await registrarEvento(tx, {
      acao: 'NOTA_PRODUTO_ALTERADO',
      resultado: 'SUCESSO',
      atorUsuarioId: autor.usuarioId,
      escopoId: escopo.id,
      alvoTipo: 'PALETE',
      alvoId: paleteId,
      detalhes: { documento: `${nota.tipo ?? '?'} ${nota.numero}`, palete: nota.codigo, antes: atual?.produto ?? '', depois: dados.value, saldoPorSkuAlterado: false },
      requestId: autor.requestId,
    });
  }
  return notasDoPalete(tx, escopo.id, paleteId);
}

/** Descrição de uma caixa ou grupo de caixas da NF neste palete (acréscimo; nada é exigido para as demais). */
export async function adicionarDescricaoCaixa(tx: Transacao, escopo: Escopo, paleteId: string, dados: DadosCaixa, autor: Autor, agora: Date): Promise<DocumentosPalete> {
  const nota = await exigirNotaDoPalete(tx, escopo.id, paleteId, dados.identity);
  const c = await conteudoParaAlterar(tx, escopo.id, paleteId, dados.identity, agora, autor);
  let conteudoId = c.atual?.id ?? null;
  if (conteudoId === null) {
    try {
      conteudoId = (await c.criar()).id;
    } catch (erro) {
      if (ehViolacaoUnica(erro)) conflitoVersao();
      throw erro;
    }
  }
  const id = randomUUID();
  await tx.descricaoCaixaDocumento.create({ data: { id, escopoId: escopo.id, conteudoId, grupo: dados.group, descricao: dados.description, criadoPorId: autor.usuarioId, criadoEm: agora } });
  await registrarEvento(tx, {
    acao: 'NOTA_CAIXA_DESCRITA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: paleteId,
    detalhes: { documento: `${nota.tipo ?? '?'} ${nota.numero}`, palete: nota.codigo, grupo: dados.group, descricao: dados.description, descricaoId: id },
    requestId: autor.requestId,
  });
  return notasDoPalete(tx, escopo.id, paleteId);
}

/** Retira uma descrição de caixa (registro preservado com autoria e motivo). */
export async function retirarDescricaoCaixa(tx: Transacao, escopo: Escopo, paleteId: string, descricaoId: string, dados: DadosRetirar, autor: Autor, agora: Date): Promise<DocumentosPalete> {
  const [d] = await tx.$queryRaw<{ removida: boolean; grupo: string; palete_id: string }[]>`
    SELECT d.removida_em IS NOT NULL AS removida, d.grupo, c.palete_id::text
      FROM descricao_caixa_documento d JOIN conteudo_documento_palete c ON c.id = d.conteudo_id
     WHERE d.id = ${descricaoId}::uuid AND d.escopo_id = ${escopo.id}::uuid FOR UPDATE OF d`;
  if (d?.palete_id !== paleteId) throw naoEncontrado('Descrição de caixa não encontrada neste palete.');
  if (d.removida) throw new ErroHttp(409, 'CONFLITO', 'Esta descrição já foi retirada.');
  const palete = await tx.palete.findFirst({ where: { id: paleteId, escopoId: escopo.id }, select: { codigo: true, arquivadoEm: true } });
  if (!palete) throw naoEncontrado('Palete não encontrado neste escopo.');
  if (palete.arquivadoEm !== null) throw new ErroHttp(409, 'CONFLITO', `O palete ${palete.codigo} está arquivado e não pode ser alterado.`);
  await tx.descricaoCaixaDocumento.update({ where: { id: descricaoId }, data: { removidaEm: agora, removidaPorId: autor.usuarioId, motivoRemocao: dados.reason } });
  await registrarEvento(tx, {
    acao: 'NOTA_CAIXA_RETIRADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'PALETE',
    alvoId: paleteId,
    detalhes: { palete: palete.codigo, grupo: d.grupo, descricaoId, motivo: dados.reason },
    requestId: autor.requestId,
  });
  return notasDoPalete(tx, escopo.id, paleteId);
}
