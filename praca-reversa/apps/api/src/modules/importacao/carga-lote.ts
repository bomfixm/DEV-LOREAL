/**
 * Carga do inventário em lote a partir do pacote preparado
 * (schema `praca-reversa.importacao-inventario.v1`): os vínculos NF × endereço
 * já agrupados pela preparação são gravados de uma vez, sem cadastrar palete
 * por palete. Comando local (`npm run inventario:carregar`); não há rota HTTP.
 *
 * Usa as mesmas estruturas e serviços da importação do inventário conferido:
 * lote (CONFIRMADO, arquivo privado) → inventário de referência (fotografia,
 * todas as linhas de origem) → paletes pelo cadastro existente (código gerado
 * pela sequência do escopo; N° Pallet da planilha só como referência externa)
 * → vínculos documentais, com auditoria. Regras:
 *
 * - Identidade do palete = endereço completo ("15 - A120" ≠ "13 - A120").
 *   Endereço livre (verde em RUA) não ocupa posição nem cria palete: as NFs
 *   dele ficam como referência fora da praça (local atual não informado).
 * - Posição do mapa só pela tabela de correspondência CONFIRMADA; sem ela, o
 *   endereço fica informado e a posição no mapa pendente (nada presumido).
 * - Posição ocupada hoje por outro palete (movimento posterior ao inventário):
 *   o registro atual prevalece; as linhas do endereço ficam não aplicadas, com
 *   o conflito registrado. O resto do conjunto é aplicado na mesma transação.
 * - Volumes como informados (`null` = pendente, nunca zero); linhas repetidas
 *   agrupadas sem somar. Nada de saldo por SKU, liberação, reserva, claim ou
 *   expedição.
 * - Reenvio do mesmo pacote (id do lote ou hash do arquivo) não grava de novo;
 *   só registra localizações que passaram a ser resolvíveis (tabela
 *   confirmada depois da carga) de paletes nunca movimentados.
 * - Cidade destino e produto na caixa: valor não vazio do pacote só preenche o
 *   que está vazio; vazio nunca apaga o que foi preenchido no aplicativo.
 */
import {
  FORMATO_QUANTIDADE,
  normalizarEndereco,
  normalizarQuantidade,
  type Escopo,
  type MotivoLinha,
  type ResultadoGravacao,
} from '@praca-reversa/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Banco, Transacao } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { jsonCanonico } from '../idempotencia/executar.js';
import { resolverEnderecos, type EnderecoResolvido } from '../layout/enderecos.js';
import { moverPalete } from '../movimentos/servico.js';
import { cadastrarPalete } from '../paletes/servico.js';
import { contextoDocumental, hashContexto } from './identidade.js';
import { UNIDADE_VOLUMES, chaveDocumento, chaveVinculo, proximoNumeroInventario } from './inventario.js';

export const SCHEMA_PACOTE = 'praca-reversa.importacao-inventario.v1';

// ---------- Pacote ----------

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Quantidade = z.string().regex(FORMATO_QUANTIDADE, 'Quantidade decimal inválida (texto com ponto).');
const Linha = z.number().int().positive();

const LinhaFonteSchema = z.object({
  linha: Linha,
  chave_linha: Hex64,
  chave_conteudo: Hex64,
  tipo: z.string(),
  numero: z.string(),
  delivery: z.string(),
  remetente: z.string(),
  endereco_original: z.string(),
  endereco: z.string(),
  fileira: z.string().nullable(),
  codigo_local: z.string().nullable(),
  lado_regra: z.string().nullable(),
  numero_na_planilha: z.string(),
  endereco_livre: z.boolean(),
  volumes: Quantidade.nullable(),
  volumes_original: z.string(),
  marcador_full_original: z.string(),
  documentacao: z.string(),
  cidade_destino: z.string(),
  produto_na_caixa: z.string(),
  contexto_documental: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  chave_documento: Hex64.nullable(),
  campos_originais: z.record(z.string(), z.string()),
});
export type LinhaFonte = z.infer<typeof LinhaFonteSchema>;

const VinculoPacoteSchema = z.object({
  chave_vinculo: Hex64,
  chave_documento: Hex64,
  nfd: z.string().nullable(),
  numero_documento: z.string().min(1),
  tipo_documento: z.string().nullable(),
  delivery: z.string().nullable(),
  remetente: z.string(),
  remetentes_na_origem: z.array(z.string()),
  cidade_destino: z.string(),
  produto_na_caixa: z.string(),
  volumes: Quantidade.nullable(),
  volumes_base: z.string(),
  volumes_na_origem: z.array(z.object({ linha: Linha, valor: Quantidade.nullable(), texto_original: z.string() })),
  palete_full: z.boolean().nullable(),
  full_base: z.string(),
  marcadores_full_originais: z.array(z.string()),
  mais_de_um_palete_da_nfd_no_inventario: z.boolean(),
  quantidade_paletes_declarada_nfd: z.number().int().positive().nullable(),
  quantidade_enderecos_nfd_na_praca: z.number().int().nonnegative(),
  enderecos_nfd_na_praca: z.array(z.string()),
  enderecos_nfd_na_origem: z.array(z.string()),
  partes_full_neste_endereco: z.array(z.number().int().positive()),
  endereco: z.string().nullable(),
  endereco_referencia: z.string(),
  numero_palete_na_planilha: z.string().nullable(),
  linhas_origem: z.array(Linha).min(1),
  pendencias: z.array(z.string()),
  situacao_localizacao: z.enum(['INFORMADA_NO_INVENTARIO', 'FORA_DA_PRACA_SEM_ENDERECO_ATUAL']),
});
export type VinculoPacote = z.infer<typeof VinculoPacoteSchema>;

const SituacaoPosicaoSchema = z.enum(['COM_NFD_INFORMADA', 'ENDERECO_LIVRE', 'DOCUMENTO_PENDENTE', 'CONTEUDO_NAO_INFORMADO']);

const PosicaoPacoteSchema = z.object({
  endereco: z.string().min(1),
  enderecos_originais: z.array(z.string()).min(1),
  fileira: z.string().nullable(),
  codigo_local: z.string().nullable(),
  bloco_referencia: z.string().nullable(),
  lado_regra: z.string().nullable(),
  coordenadas_mapa: z.null(),
  numero_na_planilha: z.string().nullable(),
  numero_eh_id_permanente_palete: z.literal(false),
  endereco_livre: z.boolean(),
  situacao: SituacaoPosicaoSchema,
  palete_full: z.boolean().nullable(),
  vinculos_nfd: z.array(Hex64),
  vinculos_tipo_pendente: z.array(Hex64),
  linhas_origem: z.array(Linha),
});
export type PosicaoPacote = z.infer<typeof PosicaoPacoteSchema>;

export const PacoteCargaSchema = z.object({
  schema: z.literal(SCHEMA_PACOTE),
  id_lote: Hex64,
  fonte: z.object({ arquivo: z.string().min(1).max(200), sha256: Hex64, aba: z.string().min(1).max(120), cabecalhos: z.record(z.string(), z.string()) }),
  regras: z.object({
    endereco_chave: z.string(),
    cor_livre_rua: z.string().regex(/^[0-9A-F]{8}$/),
    produto_inicial: z.literal(''),
    cidade_destino_inicial: z.literal(''),
    volumes_desconhecidos: z.null(),
    somar_linhas_repetidas: z.literal(false),
    usar_numero_na_planilha_como_id_palete: z.literal(false),
    criar_saldo_sku_automaticamente: z.literal(false),
    criar_coordenadas_presumidas: z.literal(false),
    full: z.string(),
    mais_de_um_palete: z.string(),
    quantidade_enderecos: z.string(),
  }),
  campos_visiveis_nota: z.array(z.string()),
  blocos_fileiras: z.record(z.string(), z.string()),
  resumo: z.object({
    linhas_fonte: z.number().int().nonnegative(),
    linhas_nfd_endereco_nao_livre: z.number().int().nonnegative(),
    vinculos_nfd_na_praca: z.number().int().nonnegative(),
    numeros_nfd_distintos_na_praca: z.number().int().nonnegative(),
    enderecos_com_nfd_na_praca: z.number().int().nonnegative(),
    enderecos_livres: z.number().int().nonnegative(),
    vinculos_documentais_fora_da_praca: z.number().int().nonnegative(),
    documentos_tipo_pendente_na_praca: z.number().int().nonnegative(),
    grupos_de_linhas_exatamente_iguais: z.number().int().nonnegative(),
    nfd_com_volumes_pendentes_na_praca: z.number().int().nonnegative(),
    enderecos_com_full_sim: z.number().int().nonnegative(),
    enderecos_com_full_nao: z.number().int().nonnegative(),
    enderecos_com_full_pendente: z.number().int().nonnegative(),
  }),
  posicoes: z.array(PosicaoPacoteSchema),
  nfds_na_praca: z.array(VinculoPacoteSchema),
  documentos_fora_da_praca: z.array(VinculoPacoteSchema),
  documentos_tipo_pendente_na_praca: z.array(VinculoPacoteSchema),
  linhas_sem_numero_documento: z.array(LinhaFonteSchema),
  repeticoes_exatas: z.array(z.object({ linhas: z.array(Linha).min(2), endereco: z.string(), numero: z.string(), tratamento: z.string() })),
  numeros_na_planilha_em_varios_enderecos: z.array(z.object({ numero_na_planilha: z.string(), enderecos: z.array(z.string()), tratamento: z.string() })),
  linhas_fonte: z.array(LinhaFonteSchema).min(1),
});
export type PacoteCarga = z.infer<typeof PacoteCargaSchema>;

export interface PacoteLido {
  pacote: PacoteCarga;
  nomeArquivo: string;
  bytes: Buffer;
  /** SHA-256 do arquivo recebido (o pacote, não a planilha de origem). */
  hash: string;
}

/** Igualdade de listas sem ordem. */
const mesmoConjunto = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('\u001f') === [...b].sort().join('\u001f');

/**
 * Coerência interna do pacote: totais do resumo, linhas de origem cobertas uma
 * única vez, identidade documental recalculada igual à do pacote, endereços
 * de vínculo iguais aos das linhas, posições com os vínculos que citam.
 */
export function conferirPacote(p: PacoteCarga): string[] {
  const erros: string[] = [];
  const r = p.resumo;
  const N = p.nfds_na_praca;
  const T = p.documentos_tipo_pendente_na_praca;
  const F = p.documentos_fora_da_praca;
  const confere = (rotulo: string, informado: number, contado: number) => {
    if (informado !== contado) erros.push(`Resumo: ${rotulo} informado ${String(informado)}, contado ${String(contado)}.`);
  };
  confere('linhas de origem', r.linhas_fonte, p.linhas_fonte.length);
  confere('vínculos NFD na praça', r.vinculos_nfd_na_praca, N.length);
  confere('NFDs distintas na praça', r.numeros_nfd_distintos_na_praca, new Set(N.map((v) => v.numero_documento)).size);
  confere('endereços com NFD', r.enderecos_com_nfd_na_praca, p.posicoes.filter((x) => x.situacao === 'COM_NFD_INFORMADA').length);
  confere('endereços livres', r.enderecos_livres, p.posicoes.filter((x) => x.endereco_livre).length);
  confere('vínculos fora da praça', r.vinculos_documentais_fora_da_praca, F.length);
  confere('documentos de tipo pendente', r.documentos_tipo_pendente_na_praca, T.length);
  confere('grupos de linhas iguais', r.grupos_de_linhas_exatamente_iguais, p.repeticoes_exatas.length);
  confere('NFDs com volumes pendentes', r.nfd_com_volumes_pendentes_na_praca, N.filter((v) => v.volumes === null).length);
  confere('endereços full', r.enderecos_com_full_sim, p.posicoes.filter((x) => !x.endereco_livre && x.palete_full === true).length);
  confere('endereços mistos', r.enderecos_com_full_nao, p.posicoes.filter((x) => !x.endereco_livre && x.palete_full === false).length);
  confere('endereços full pendente', r.enderecos_com_full_pendente, p.posicoes.filter((x) => !x.endereco_livre && x.palete_full === null).length);

  const linhas = new Map<number, LinhaFonte>();
  for (const l of p.linhas_fonte) {
    if (linhas.has(l.linha)) erros.push(`Linha ${String(l.linha)} repetida em linhas_fonte.`);
    linhas.set(l.linha, l);
    if (l.chave_documento !== null && l.chave_documento !== hashContexto(l.contexto_documental)) erros.push(`Linha ${String(l.linha)}: chave_documento não corresponde ao contexto documental.`);
    if (l.numero !== '') {
      const ctx = contextoDocumental(l.tipo, l.numero, l.delivery, l.remetente);
      if (ctx.join('\u001f') !== l.contexto_documental.join('\u001f')) erros.push(`Linha ${String(l.linha)}: contexto documental diferente da regra (tipo, número, DELIVERY ou remetente).`);
    }
  }
  const cobertas = new Map<number, string>();
  const cobrir = (linha: number, por: string) => {
    const antes = cobertas.get(linha);
    if (antes !== undefined) erros.push(`Linha ${String(linha)} citada por ${antes} e por ${por}.`);
    cobertas.set(linha, por);
  };
  const enderecosPosicao = new Map(p.posicoes.map((x) => [x.endereco, x]));
  if (enderecosPosicao.size !== p.posicoes.length) erros.push('Endereço repetido em posicoes.');
  const conferirVinculo = (v: VinculoPacote, grupo: 'NFD' | 'PENDENTE' | 'FORA') => {
    const rot = `${v.tipo_documento ?? 'tipo pendente'} ${v.numero_documento}`;
    if (grupo === 'NFD' && (v.tipo_documento !== 'NFD' || v.nfd !== v.numero_documento)) erros.push(`${rot}: vínculo da praça sem tipo NFD.`);
    if (grupo === 'PENDENTE' && (v.tipo_documento === 'NFD' || v.nfd !== null)) erros.push(`${rot}: documento de tipo pendente marcado como NFD.`);
    if (grupo !== 'FORA' && (v.endereco === null || v.situacao_localizacao !== 'INFORMADA_NO_INVENTARIO')) erros.push(`${rot}: vínculo da praça sem endereço.`);
    if (grupo === 'FORA' && (v.endereco !== null || v.situacao_localizacao !== 'FORA_DA_PRACA_SEM_ENDERECO_ATUAL')) erros.push(`${rot}: referência fora da praça com endereço atual.`);
    for (const n of v.linhas_origem) {
      cobrir(n, rot);
      const l = linhas.get(n);
      if (!l) {
        erros.push(`${rot}: linha de origem ${String(n)} não existe.`);
        continue;
      }
      if (l.chave_documento !== v.chave_documento || l.numero !== v.numero_documento) erros.push(`${rot}: linha ${String(n)} é de outro documento.`);
      if (l.endereco !== (v.endereco ?? v.endereco_referencia)) erros.push(`${rot}: linha ${String(n)} está em ${l.endereco}, não em ${v.endereco ?? v.endereco_referencia}.`);
      if (l.endereco_livre !== (grupo === 'FORA')) erros.push(`${rot}: linha ${String(n)} com situação de endereço livre incoerente.`);
    }
    if (!v.volumes_na_origem.every((x) => v.linhas_origem.includes(x.linha))) erros.push(`${rot}: volumes de linha que não é de origem.`);
    if (v.volumes !== null && v.linhas_origem.length > 1) erros.push(`${rot}: volumes somados de linhas agrupadas (o pacote não deve somar).`);
  };
  for (const v of N) conferirVinculo(v, 'NFD');
  for (const v of T) conferirVinculo(v, 'PENDENTE');
  for (const v of F) conferirVinculo(v, 'FORA');
  for (const l of p.linhas_sem_numero_documento) {
    cobrir(l.linha, 'linha sem número');
    if (l.numero !== '') erros.push(`Linha ${String(l.linha)}: listada sem número, mas tem número.`);
  }
  for (const n of linhas.keys()) if (!cobertas.has(n)) erros.push(`Linha ${String(n)} não está em nenhum vínculo nem nas linhas sem número.`);
  const chaves = new Set([...N, ...T, ...F].map((v) => v.chave_vinculo));
  if (chaves.size !== N.length + T.length + F.length) erros.push('chave_vinculo repetida.');
  const naPosicao = new Map<string, string>();
  for (const x of p.posicoes) {
    for (const k of [...x.vinculos_nfd, ...x.vinculos_tipo_pendente]) {
      if (naPosicao.has(k)) erros.push(`Vínculo ${k.slice(0, 8)} citado em duas posições.`);
      naPosicao.set(k, x.endereco);
    }
    if (x.endereco_livre && x.vinculos_nfd.length + x.vinculos_tipo_pendente.length > 0) erros.push(`${x.endereco}: endereço livre com vínculo na praça.`);
    const n = normalizarEndereco(x.enderecos_originais[0]);
    if (n.ok && n.endereco !== x.endereco) erros.push(`${x.endereco}: normalização do endereço original "${x.enderecos_originais[0] ?? ''}" dá ${n.endereco}.`);
  }
  for (const v of [...N, ...T]) {
    if (naPosicao.get(v.chave_vinculo) !== v.endereco) erros.push(`${v.numero_documento}: vínculo não aparece na posição ${v.endereco ?? ''}.`);
    if (enderecosPosicao.get(v.endereco ?? '')?.endereco_livre !== false) erros.push(`${v.numero_documento}: endereço ${v.endereco ?? ''} não é posição ocupada do pacote.`);
  }
  for (const x of p.posicoes) {
    const doEndereco = p.linhas_fonte.filter((l) => l.endereco === x.endereco).map((l) => String(l.linha));
    if (!mesmoConjunto(doEndereco, x.linhas_origem.map(String))) erros.push(`${x.endereco}: linhas de origem da posição diferentes das linhas do endereço.`);
  }
  return erros.slice(0, 50);
}

/** Lê o arquivo do pacote: JSON, schema v1 e coerência interna. Nada é gravado. */
export function lerPacote(conteudo: Buffer, nomeArquivo: string): { ok: true; pacote: PacoteLido } | { ok: false; erros: string[] } {
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (erro) {
    return { ok: false, erros: [`O arquivo não é JSON válido: ${erro instanceof Error ? erro.message : String(erro)}`] };
  }
  const versao = typeof bruto === 'object' && bruto !== null && 'schema' in bruto ? bruto.schema : undefined;
  if (versao !== SCHEMA_PACOTE) return { ok: false, erros: [`Schema do pacote "${String(versao)}" não suportado (esperado ${SCHEMA_PACOTE}).`] };
  const r = PacoteCargaSchema.safeParse(bruto);
  if (!r.success) return { ok: false, erros: r.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`) };
  const erros = conferirPacote(r.data);
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, pacote: { pacote: r.data, nomeArquivo, bytes: conteudo, hash: createHash('sha256').update(conteudo).digest('hex') } };
}

// ---------- Estado atual ----------

interface PaleteAtual {
  id: string;
  codigo: string;
  versao: number;
  posicaoId: string | null;
  posicaoCodigo: string | null;
  arquivado: boolean;
  fluxo: string;
  /** Já teve mudança de localização registrada (movimento posterior prevalece). */
  movimentado: boolean;
}

interface VinculoExistente {
  id: string;
  paleteId: string;
  assinatura: string;
}

interface LoteExistente {
  id: string;
  confirmadoEm: Date | null;
  inventarioId: string;
  inventarioCodigo: string;
}

export interface EstadoCarga {
  loteExistente: LoteExistente | null;
  enderecos: Map<string, EnderecoResolvido>;
  /** Palete ligado ao endereço (chave "15|A120") por inventário ativo anterior. */
  paletePorEndereco: Map<string, PaleteAtual>;
  vinculosPorChaveExterna: Map<string, VinculoExistente>;
  substitui: { id: string; codigo: string } | null;
  temLayout: boolean;
}

const assinaturaVinculo = (x: { paleteId: string; tipo: string | null; numero: string; delivery: string | null; volumes: string | null; documentacao: string | null; palletFull: string | null; identidade: string | null }) =>
  jsonCanonico([x.paleteId, x.tipo, x.numero, x.delivery, x.volumes === null ? null : normalizarQuantidade(x.volumes), x.documentacao, x.palletFull, x.identidade]);

async function carregarPaletes(db: Banco | Transacao, escopoId: string, ids: readonly string[]): Promise<Map<string, PaleteAtual>> {
  if (ids.length === 0) return new Map();
  const paletes = await db.palete.findMany({
    where: { escopoId, id: { in: [...new Set(ids)] } },
    select: { id: true, codigo: true, versao: true, posicaoId: true, posicao: { select: { codigo: true } }, arquivadoEm: true, estadoFluxo: true, _count: { select: { localizacoes: true } } },
  });
  return new Map(
    paletes.map((x) => [
      x.id,
      { id: x.id, codigo: x.codigo, versao: x.versao, posicaoId: x.posicaoId, posicaoCodigo: x.posicao?.codigo ?? null, arquivado: x.arquivadoEm !== null, fluxo: x.estadoFluxo, movimentado: x._count.localizacoes > 0 },
    ]),
  );
}

export async function carregarEstadoCarga(db: Banco | Transacao, escopoId: string, p: PacoteLido, substituiCodigo: string | null): Promise<EstadoCarga> {
  const pacote = p.pacote;
  const lote = await db.$queryRaw<{ id: string; confirmado_em: Date | null; inventario_id: string; inventario_codigo: string }[]>`
    SELECT l.id::text, l.confirmado_em, i.id::text AS inventario_id, i.codigo AS inventario_codigo
      FROM lote_importacao l JOIN inventario_referencia i ON i.lote_importacao_id = l.id
     WHERE l.escopo_id = ${escopoId}::uuid AND l.tipo::text = 'INVENTARIO' AND l.situacao = 'CONFIRMADO'
       AND (l.hash_arquivo = ${p.hash} OR l.parametros -> 'pacote' ->> 'idLote' = ${pacote.id_lote})
     ORDER BY l.confirmado_em LIMIT 1`;
  const normalizados = pacote.posicoes.map((x) => normalizarEndereco(x.endereco)).filter((n) => n.ok);
  const enderecos = await resolverEnderecos(db, escopoId, normalizados);
  const temLayout = (await db.layout.count({ where: { escopoId, ativo: true } })) > 0;
  // Palete do endereço por inventário ativo anterior (linha aplicada mais recente).
  const ligados = await db.$queryRaw<{ endereco: string; palete_id: string }[]>`
    SELECT DISTINCT ON (li.endereco_canonico) li.endereco_canonico AS endereco, li.palete_id::text
      FROM linha_inventario li JOIN inventario_referencia i ON i.id = li.inventario_id
     WHERE li.escopo_id = ${escopoId}::uuid AND li.aplicada AND NOT li.endereco_livre AND li.palete_id IS NOT NULL
       AND li.endereco_canonico = ANY(${pacote.posicoes.map((x) => x.endereco)}::text[]) AND i.situacao = 'ATIVO'
     ORDER BY li.endereco_canonico, li.criado_em DESC`;
  const vinculos = await db.vinculoDocumentoPalete.findMany({
    where: { escopoId, situacao: 'ATIVO', chaveExterna: { in: [...pacote.nfds_na_praca, ...pacote.documentos_tipo_pendente_na_praca].map((v) => v.chave_vinculo) } },
    select: { id: true, paleteId: true, chaveExterna: true, tipoDocumento: true, numeroDocumento: true, delivery: true, volumes: true, documentacao: true, palletFull: true, identidadeDocumento: true },
  });
  const paletes = await carregarPaletes(db, escopoId, ligados.map((l) => l.palete_id));
  const paletePorEndereco = new Map<string, PaleteAtual>();
  for (const l of ligados) {
    const n = normalizarEndereco(l.endereco);
    const palete = paletes.get(l.palete_id);
    if (n.ok && palete) paletePorEndereco.set(n.chave, palete);
  }
  let substitui: EstadoCarga['substitui'] = null;
  if (substituiCodigo !== null) {
    const inv = await db.inventarioReferencia.findFirst({ where: { escopoId, codigo: substituiCodigo }, select: { id: true, codigo: true, situacao: true } });
    if (!inv) throw new ErroHttp(404, 'NAO_ENCONTRADO', `Inventário ${substituiCodigo} não encontrado neste escopo.`);
    if (inv.situacao !== 'ATIVO') throw new ErroHttp(409, 'CONFLITO', `O ${inv.codigo} já foi substituído por outra versão.`);
    substitui = { id: inv.id, codigo: inv.codigo };
  }
  const [existente] = lote;
  return {
    loteExistente: existente ? { id: existente.id, confirmadoEm: existente.confirmado_em, inventarioId: existente.inventario_id, inventarioCodigo: existente.inventario_codigo } : null,
    enderecos,
    paletePorEndereco,
    vinculosPorChaveExterna: new Map(
      vinculos.flatMap((v) =>
        v.chaveExterna === null
          ? []
          : [
              [
                v.chaveExterna,
                {
                  id: v.id,
                  paleteId: v.paleteId,
                  assinatura: assinaturaVinculo({ paleteId: v.paleteId, tipo: v.tipoDocumento, numero: v.numeroDocumento, delivery: v.delivery, volumes: v.volumes?.toFixed() ?? null, documentacao: v.documentacao, palletFull: v.palletFull, identidade: v.identidadeDocumento }),
                },
              ] as const,
            ],
      ),
    ),
    substitui,
    temLayout,
  };
}

// ---------- Plano ----------

const aviso = (code: string, field: string | null, message: string): MotivoLinha => ({ code, field, message });

export type AcaoEndereco = 'CRIAR' | 'EXISTENTE' | 'CONFLITO';

export interface PlanoEndereco {
  endereco: string;
  chave: string | null;
  situacao: PosicaoPacote['situacao'];
  numeroPlanilha: string | null;
  resolvido: EnderecoResolvido | null;
  acao: AcaoEndereco;
  existente: PaleteAtual | null;
  /** Posição para o palete novo (tabela confirmada, disponível e livre). */
  posicaoNova: { id: string; codigo: string } | null;
  /** Localização a registrar para palete existente sem posição e nunca movimentado. */
  registrarPosicao: { id: string; codigo: string } | null;
  /** Posição no mapa resolvida pela tabela confirmada (fotografia da linha). */
  posicaoResolvidaId: string | null;
  motivos: MotivoLinha[];
  conflito: MotivoLinha | null;
  linhas: number[];
}

export type AcaoVinculo = 'CRIAR' | 'ATUALIZAR' | 'JA_IMPORTADO' | 'CONFLITO';

export interface PlanoVinculo {
  v: VinculoPacote;
  grupo: 'NFD' | 'PENDENTE';
  endereco: PlanoEndereco;
  acao: AcaoVinculo;
  encerrarId: string | null;
  linhaPrincipal: number;
}

export type AcaoLinha = 'VINCULAR' | 'CRIAR_CADASTRO' | 'ATUALIZAR' | 'JA_IMPORTADO' | 'REFERENCIA_HISTORICA' | 'DUPLICADA_ARQUIVO' | 'REQUER_RESOLUCAO';

export interface PlanoLinha {
  l: LinhaFonte;
  endereco: PlanoEndereco | null;
  enderecoCanonico: string | null;
  acao: AcaoLinha;
  aplicada: boolean;
  vinculo: PlanoVinculo | null;
  motivos: MotivoLinha[];
}

export interface PlanoCarga {
  pacote: PacoteLido;
  estado: EstadoCarga;
  enderecos: PlanoEndereco[];
  vinculos: PlanoVinculo[];
  linhas: PlanoLinha[];
  /** Linhas de texto do resumo do lote (prévia e relatório). */
  resumo: string[];
  /** Pendências para tratar depois (lista pequena, agrupada). */
  pendencias: string[];
}

/** Ordem de leitura: fileira 11…16, GR; código pelo número (não como texto). */
export function ordemEndereco(a: string, b: string): number {
  const pa = normalizarEndereco(a);
  const pb = normalizarEndereco(b);
  if (!pa.ok || !pb.ok) return a.localeCompare(b);
  const prefixo = (x: string) => (/^\d+$/.test(x) ? Number(x) : 1_000 + x.charCodeAt(0));
  const numero = (c: string) => Number(c.replace(/^[A-Z]+/, ''));
  return prefixo(pa.prefixo) - prefixo(pb.prefixo) || numero(pa.codigoLocal) - numero(pb.codigoLocal) || pa.codigoLocal.localeCompare(pb.codigoLocal);
}

function planejarEndereco(x: PosicaoPacote, estado: EstadoCarga): PlanoEndereco {
  const n = normalizarEndereco(x.endereco);
  const chave = n.ok ? n.chave : null;
  const resolvido = chave === null ? null : (estado.enderecos.get(chave) ?? null);
  const existente = chave === null ? null : (estado.paletePorEndereco.get(chave) ?? null);
  const motivos: MotivoLinha[] = [];
  const base: PlanoEndereco = {
    endereco: x.endereco,
    chave,
    situacao: x.situacao,
    numeroPlanilha: x.numero_na_planilha,
    resolvido,
    acao: 'CRIAR',
    existente,
    posicaoNova: null,
    registrarPosicao: null,
    posicaoResolvidaId: resolvido?.resolucao === 'POSICAO' ? resolvido.posicaoId : null,
    motivos,
    conflito: null,
    linhas: x.linhas_origem,
  };
  const pendenteMapa = () =>
    motivos.push(
      aviso(
        'POSICAO_NO_MAPA_PENDENTE',
        'address',
        !n.ok
          ? `Endereço "${x.endereco}" fora da regra conhecida: fica como referência informada; posição no mapa pendente.`
          : !estado.temLayout
            ? `Sem layout ativo neste escopo: ${x.endereco} fica informado; posição no mapa pendente.`
            : `${resolvido?.mensagem ?? `${x.endereco} sem correspondência.`} Endereço informado guardado; posição no mapa pendente (nenhuma coordenada presumida).`,
      ),
    );
  const livreParaPalete = resolvido?.resolucao === 'POSICAO' && resolvido.posicaoId !== null && resolvido.posicaoCodigo !== null && resolvido.disponivel && !resolvido.desativada;
  if (existente) {
    if (existente.arquivado || existente.fluxo === 'EXPEDIDO') {
      return {
        ...base,
        acao: 'CONFLITO',
        conflito: aviso(
          existente.arquivado ? 'PALETE_ARQUIVADO' : 'PALETE_EXPEDIDO',
          'address',
          `O palete ${existente.codigo}, ligado a ${x.endereco} por inventário anterior, ${existente.arquivado ? 'está arquivado' : 'já foi expedido (saiu da praça)'}: as linhas deste endereço não são aplicadas; revise antes de reapresentar.`,
        ),
      };
    }
    if (resolvido?.resolucao !== 'POSICAO') pendenteMapa();
    else if (existente.posicaoId === resolvido.posicaoId) {
      // Já está na posição do endereço.
    } else if (existente.posicaoId !== null) {
      motivos.push(aviso('ENDERECO_DIVERGENTE', 'address', `Nos registros atuais o palete ${existente.codigo} está em ${existente.posicaoCodigo ?? ''}: a localização atual prevalece; ${x.endereco} fica como informado.`));
    } else if (existente.movimentado) {
      motivos.push(aviso('LOCALIZACAO_MOVIMENTADA', 'address', `O palete ${existente.codigo} já teve localização registrada e corrigida depois do inventário: a posição não é registrada por esta carga.`));
    } else if (resolvido.ocupanteId !== null) {
      motivos.push(aviso('POSICAO_OCUPADA', 'address', `A posição ${resolvido.posicaoCodigo ?? ''} (${x.endereco}) tem o palete ${resolvido.ocupanteCodigo ?? ''} nos registros atuais: nada é sobrescrito (conflito de referência registrado).`));
    } else if (livreParaPalete && resolvido.posicaoId !== null && resolvido.posicaoCodigo !== null) {
      return { ...base, acao: 'EXISTENTE', registrarPosicao: { id: resolvido.posicaoId, codigo: resolvido.posicaoCodigo } };
    } else {
      motivos.push(aviso(resolvido.desativada ? 'POSICAO_DESATIVADA' : 'POSICAO_INDISPONIVEL', 'address', `A posição ${resolvido.posicaoCodigo ?? ''} de ${x.endereco} está ${resolvido.desativada ? 'desativada' : 'indisponível'}: o palete fica sem posição no mapa.`));
    }
    return { ...base, acao: 'EXISTENTE' };
  }
  if (resolvido?.resolucao === 'POSICAO' && resolvido.ocupanteId !== null) {
    return {
      ...base,
      acao: 'CONFLITO',
      conflito: aviso(
        'POSICAO_OCUPADA_REGISTRO_ATUAL',
        'address',
        `Nos registros atuais a posição ${resolvido.posicaoCodigo ?? ''} (${x.endereco}) tem o palete ${resolvido.ocupanteCodigo ?? ''} (movimento preservado): as linhas deste endereço ficam não aplicadas, com o conflito de referência registrado.`,
      ),
    };
  }
  if (livreParaPalete && resolvido.posicaoId !== null && resolvido.posicaoCodigo !== null) return { ...base, posicaoNova: { id: resolvido.posicaoId, codigo: resolvido.posicaoCodigo } };
  if (resolvido?.resolucao === 'POSICAO') {
    motivos.push(aviso(resolvido.desativada ? 'POSICAO_DESATIVADA' : 'POSICAO_INDISPONIVEL', 'address', `A posição ${resolvido.posicaoCodigo ?? ''} de ${x.endereco} está ${resolvido.desativada ? 'desativada' : 'indisponível'}: o palete é cadastrado sem posição no mapa.`));
  } else pendenteMapa();
  return base;
}

const TEXTO_SITUACAO: Readonly<Record<PosicaoPacote['situacao'], string>> = {
  COM_NFD_INFORMADA: 'com NFD',
  ENDERECO_LIVRE: 'livre',
  DOCUMENTO_PENDENTE: 'só documento de tipo pendente/outro tipo',
  CONTEUDO_NAO_INFORMADO: 'conteúdo não informado',
};

export function planejarCarga(p: PacoteLido, estado: EstadoCarga): PlanoCarga {
  const pacote = p.pacote;
  const enderecos = pacote.posicoes.filter((x) => !x.endereco_livre).map((x) => planejarEndereco(x, estado));
  enderecos.sort((a, b) => ordemEndereco(a.endereco, b.endereco));
  const enderecoPor = new Map(enderecos.map((e) => [e.endereco, e]));
  const livres = new Map(pacote.posicoes.filter((x) => x.endereco_livre).map((x) => [x.endereco, x]));

  const vinculos: PlanoVinculo[] = [...pacote.nfds_na_praca.map((v) => ({ v, grupo: 'NFD' as const })), ...pacote.documentos_tipo_pendente_na_praca.map((v) => ({ v, grupo: 'PENDENTE' as const }))].map(({ v, grupo }) => {
    const endereco = enderecoPor.get(v.endereco ?? '');
    if (!endereco) throw new Error(`Endereço ${v.endereco ?? ''} sem plano.`);
    const linhaPrincipal = Math.min(...v.linhas_origem);
    if (endereco.acao === 'CONFLITO') return { v, grupo, endereco, acao: 'CONFLITO' as const, encerrarId: null, linhaPrincipal };
    const existente = estado.vinculosPorChaveExterna.get(v.chave_vinculo);
    if (!existente) return { v, grupo, endereco, acao: 'CRIAR' as const, encerrarId: null, linhaPrincipal };
    const igual =
      endereco.existente !== null &&
      existente.assinatura ===
        assinaturaVinculo({
          paleteId: endereco.existente.id,
          tipo: v.tipo_documento,
          numero: v.numero_documento,
          delivery: v.delivery,
          volumes: v.volumes,
          documentacao: documentacaoDe(pacote, v),
          palletFull: marcadoresDe(v),
          identidade: v.chave_documento,
        });
    return igual ? { v, grupo, endereco, acao: 'JA_IMPORTADO' as const, encerrarId: existente.id, linhaPrincipal } : { v, grupo, endereco, acao: 'ATUALIZAR' as const, encerrarId: existente.id, linhaPrincipal };
  });
  const vinculoPorLinha = new Map<number, PlanoVinculo>();
  for (const pv of vinculos) vinculoPorLinha.set(pv.linhaPrincipal, pv);
  const agrupadaEm = new Map<number, number>();
  for (const pv of vinculos) for (const n of pv.v.linhas_origem) if (n !== pv.linhaPrincipal) agrupadaEm.set(n, pv.linhaPrincipal);
  const repeticao = new Map<number, number[]>();
  for (const r of pacote.repeticoes_exatas) for (const n of r.linhas) repeticao.set(n, r.linhas);
  const foraPorLinha = new Map<number, VinculoPacote>();
  for (const v of pacote.documentos_fora_da_praca) for (const n of v.linhas_origem) foraPorLinha.set(n, v);

  // Linha que cria o palete de cada endereço novo: a primeira (menor número) aplicada.
  const criadora = new Map<string, number>();
  const linhas: PlanoLinha[] = [...pacote.linhas_fonte]
    .sort((a, b) => a.linha - b.linha)
    .map((l) => {
      const n = normalizarEndereco(l.endereco);
      const enderecoCanonico = n.ok ? n.endereco : null;
      if (l.endereco_livre) {
        const fora = foraPorLinha.get(l.linha);
        const ocupante = n.ok ? estado.enderecos.get(n.chave) : undefined;
        const motivos = [
          aviso('ENDERECO_LIVRE', 'address', `Endereço livre (fonte ${pacote.regras.cor_livre_rua} em RUA): referência histórica; não ocupa ${l.endereco} nem cria palete.`),
          ...(fora
            ? [aviso('FORA_DA_PRACA', 'documentNumber', `${fora.tipo_documento ?? 'Documento'} ${fora.numero_documento}: material fora desta praça; localização atual não informada (nenhuma expedição é proposta).`)]
            : []),
          ...(ocupante?.ocupanteCodigo ? [aviso('LIVRE_COM_PALETE_ATUAL', 'address', `Nos registros atuais a posição ${ocupante.posicaoCodigo ?? ''} tem o palete ${ocupante.ocupanteCodigo}: nada é alterado.`)] : []),
          ...(!n.ok ? [aviso('ENDERECO_FORA_DA_REGRA', 'address', `Endereço "${l.endereco}" fora da regra conhecida: referência pendente.`)] : []),
        ];
        return { l, endereco: null, enderecoCanonico, acao: 'REFERENCIA_HISTORICA' as const, aplicada: false, vinculo: null, motivos };
      }
      const endereco = enderecoPor.get(l.endereco) ?? null;
      if (endereco === null) throw new Error(`Linha ${String(l.linha)}: endereço ${l.endereco} sem plano.`);
      if (endereco.acao === 'CONFLITO' && endereco.conflito !== null) {
        return { l, endereco, enderecoCanonico, acao: 'REQUER_RESOLUCAO' as const, aplicada: false, vinculo: null, motivos: [endereco.conflito] };
      }
      const motivos = [...endereco.motivos];
      const principal = agrupadaEm.get(l.linha);
      if (principal !== undefined) {
        const iguais = repeticao.get(l.linha);
        motivos.unshift(
          aviso(
            'REPETIDA_NO_ARQUIVO',
            null,
            iguais !== undefined
              ? `Igual à linha ${String(principal)} do arquivo: agrupada no mesmo vínculo; volumes não somados (pendentes de confirmação).`
              : `Mesmo documento da linha ${String(principal)} neste endereço: agrupada no mesmo vínculo; volumes não somados.`,
          ),
        );
        return { l, endereco, enderecoCanonico, acao: 'DUPLICADA_ARQUIVO' as const, aplicada: false, vinculo: null, motivos };
      }
      const pv = vinculoPorLinha.get(l.linha) ?? null;
      if (pv !== null && pv.acao === 'JA_IMPORTADO') {
        motivos.unshift(aviso('JA_IMPORTADO', null, 'Vínculo já registrado por carga anterior com os mesmos dados (chave externa): nada a gravar.'));
        return { l, endereco, enderecoCanonico, acao: 'JA_IMPORTADO' as const, aplicada: false, vinculo: pv, motivos };
      }
      if (pv === null) motivos.unshift(aviso('SEM_DOCUMENTO', 'documentNumber', 'Conteúdo sem número de documento: registrado no palete; não prova que a posição está vazia (palete full fica não informado).'));
      if (pv?.acao === 'ATUALIZAR') motivos.unshift(aviso('VINCULO_ATUALIZADO', null, 'Vínculo de carga anterior com outros dados: o anterior é encerrado (histórico preservado) e o novo registrado.'));
      if (pv?.grupo === 'PENDENTE') {
        motivos.unshift(aviso(pv.v.tipo_documento === null ? 'TIPO_DOCUMENTAL_PENDENTE' : 'DOCUMENTO_DE_OUTRO_TIPO', 'documentType', `${pv.v.tipo_documento ?? 'Tipo não informado'} ${pv.v.numero_documento}: preservado como documento pendente/outro tipo (não é NFD).`));
      }
      let acao: AcaoLinha = pv?.acao === 'ATUALIZAR' ? 'ATUALIZAR' : 'VINCULAR';
      if (endereco.acao === 'CRIAR' && !criadora.has(endereco.endereco)) {
        criadora.set(endereco.endereco, l.linha);
        acao = 'CRIAR_CADASTRO';
      }
      return { l, endereco, enderecoCanonico, acao, aplicada: true, vinculo: pv, motivos };
    });

  const conta = (a: AcaoLinha) => linhas.filter((x) => x.acao === a).length;
  const criar = enderecos.filter((e) => e.acao === 'CRIAR');
  const comPosicao = criar.filter((e) => e.posicaoNova !== null).length + enderecos.filter((e) => e.registrarPosicao !== null).length;
  const pendentesMapa = enderecos.filter((e) => e.acao !== 'CONFLITO' && e.posicaoNova === null && e.registrarPosicao === null && !(e.existente?.posicaoId != null)).length;
  const porSituacao = (s: PosicaoPacote['situacao']) => enderecos.filter((e) => e.situacao === s).length;
  const vConta = (a: AcaoVinculo, g?: 'NFD' | 'PENDENTE') => vinculos.filter((v) => v.acao === a && (g === undefined || v.grupo === g)).length;
  const resumo = [
    `Pacote ${pacote.id_lote.slice(0, 12)}… (${pacote.schema}) · fonte ${pacote.fonte.arquivo}, aba ${pacote.fonte.aba} (SHA-256 ${pacote.fonte.sha256.slice(0, 12)}…).`,
    `Linhas de origem: ${String(linhas.length)} — ${String(conta('CRIAR_CADASTRO'))} criam palete, ${String(conta('VINCULAR'))} vinculam, ${String(conta('ATUALIZAR'))} atualizam, ${String(conta('JA_IMPORTADO'))} já importadas, ${String(conta('DUPLICADA_ARQUIVO'))} repetidas (agrupadas sem somar), ${String(conta('REFERENCIA_HISTORICA'))} de endereço livre (referência), ${String(conta('REQUER_RESOLUCAO'))} requerem resolução.`,
    `Endereços ocupados: ${String(enderecos.length)} (${String(porSituacao('COM_NFD_INFORMADA'))} com NFD, ${String(porSituacao('DOCUMENTO_PENDENTE'))} só com documento pendente/outro tipo, ${String(porSituacao('CONTEUDO_NAO_INFORMADO'))} com conteúdo não informado) · ${String(livres.size)} livres (não ocupam posição).`,
    `Paletes: ${String(criar.length)} a cadastrar (código gerado; N° Pallet só como referência externa), ${String(enderecos.filter((e) => e.acao === 'EXISTENTE').length)} já existentes (ID preservado), ${String(enderecos.filter((e) => e.acao === 'CONFLITO').length)} endereço(s) em conflito.`,
    `Mapa: ${String(comPosicao)} posição(ões) a registrar pela tabela confirmada; ${String(pendentesMapa)} palete(s) com posição no mapa pendente (endereço informado guardado).`,
    `Vínculos NFD: ${String(vConta('CRIAR', 'NFD'))} novos, ${String(vConta('ATUALIZAR', 'NFD'))} atualizados, ${String(vConta('JA_IMPORTADO', 'NFD'))} já existentes, ${String(vConta('CONFLITO', 'NFD'))} em conflito · documentos de tipo pendente/MI: ${String(vConta('CRIAR', 'PENDENTE') + vConta('ATUALIZAR', 'PENDENTE'))} novos/atualizados, ${String(vConta('JA_IMPORTADO', 'PENDENTE'))} já existentes.`,
    `Referências fora da praça: ${String(pacote.documentos_fora_da_praca.length)} vínculos em endereço livre (localização atual não informada; nada é expedido nem proposto).`,
    'Saldo por SKU, liberação, reserva, claims e expedição: nada muda (volumes ficam na unidade do inventário; desconhecido continua desconhecido).',
  ];
  const volumesPendentes = vinculos.filter((x) => x.v.volumes === null);
  const tipoPendente = vinculos.filter((x) => x.grupo === 'PENDENTE');
  const semNumero = pacote.linhas_sem_numero_documento.filter((l) => !l.endereco_livre);
  const candidatos = [...new Set([...pacote.nfds_na_praca, ...pacote.documentos_tipo_pendente_na_praca, ...pacote.documentos_fora_da_praca].filter((v) => v.pendencias.includes('MESMO_NUMERO_EM_CONTEXTOS_DOCUMENTAIS_DISTINTOS')).map((v) => v.numero_documento))];
  const fullConflitante = [...new Set(pacote.nfds_na_praca.filter((v) => v.pendencias.includes('TOTAL_PALETES_FULL_CONFLITANTE')).map((v) => v.numero_documento))];
  const foraRegra = pacote.posicoes.filter((x) => !normalizarEndereco(x.endereco).ok || x.fileira === null).map((x) => `${x.endereco} (${TEXTO_SITUACAO[x.situacao]})`);
  const conflitos = enderecos.filter((e) => e.conflito !== null);
  const lista = (itens: readonly string[], max = 12) => `${itens.slice(0, max).join(', ')}${itens.length > max ? ` … (+${String(itens.length - max)})` : ''}`;
  const pendencias = [
    ...(conflitos.length > 0 ? [`Conflitos com registros atuais (não aplicados): ${lista(conflitos.map((c) => `${c.endereco}: ${c.conflito?.message ?? ''}`), 20)}`] : []),
    `Volumes pendentes (${String(volumesPendentes.length)} vínculos; desconhecido ≠ zero): ${lista(volumesPendentes.map((x) => `NFD ${x.v.numero_documento} em ${x.endereco.endereco}${x.v.linhas_origem.length > 1 ? ` (linhas ${x.v.linhas_origem.join(' e ')} iguais)` : ''}`), 25)}.`,
    `Documentos de tipo pendente/outro tipo na praça (${String(tipoPendente.length)}; ${String(tipoPendente.filter((x) => x.v.tipo_documento === 'MI').length)} MI): confirmar o tipo antes de tratá-los como NFD.`,
    `Referências fora da praça (${String(pacote.documentos_fora_da_praca.length)}): localização atual não informada — ${lista(pacote.documentos_fora_da_praca.map((v) => `${v.numero_documento} (era ${v.endereco_referencia})`), 10)}.`,
    `Conteúdo sem número de documento em endereço ocupado (${String(semNumero.length)} linhas em ${String(new Set(semNumero.map((l) => l.endereco)).size)} endereços): ${lista([...new Set(semNumero.map((l) => l.endereco))].sort(ordemEndereco))}.`,
    `Posição no mapa pendente: ${String(pendentesMapa)} palete(s) — confirme as sequências de endereço por faixa em Layout da praça → Endereços reais e rode a carga de novo para registrar as posições (nada é presumido).`,
    `Mesmo número em contextos documentais distintos (${String(candidatos.length)} números; candidatos mostrados na nota): ${lista(candidatos)}.`,
    ...(fullConflitante.length > 0 ? [`Total de paletes do PALLET FULL divergente entre linhas: NFD ${fullConflitante.join(', ')}.`] : []),
    ...pacote.numeros_na_planilha_em_varios_enderecos.map((x) => `N° Pallet ${x.numero_na_planilha} da planilha em ${x.enderecos.join(' e ')}: referência externa, não identifica palete (cada endereço tem o próprio palete).`),
    ...(foraRegra.length > 0 ? [`Endereços fora da regra conhecida (referência pendente): ${foraRegra.join(', ')}.`] : []),
  ];
  return { pacote: p, estado, enderecos, vinculos, linhas, resumo, pendencias };
}

function documentacaoDe(pacote: PacoteCarga, v: VinculoPacote): string | null {
  const l = pacote.linhas_fonte.find((x) => x.linha === Math.min(...v.linhas_origem));
  return l === undefined || l.documentacao === '' ? null : l.documentacao;
}

function marcadoresDe(v: VinculoPacote): string | null {
  const texto = v.marcadores_full_originais.filter((m) => m.trim() !== '').join(' ');
  return texto === '' ? null : texto.slice(0, 100);
}

// ---------- Gravação ----------

export interface ResultadoCarga {
  reenvio: boolean;
  loteId: string;
  inventarioId: string;
  inventarioCodigo: string;
  confirmadoEm: string | null;
  linhas: { total: number; aplicadas: number; historicas: number; repetidas: number; jaImportadas: number; pendentes: number };
  vinculos: { criados: number; atualizados: number; jaExistentes: number; emConflito: number; tipoPendente: number };
  paletes: { criados: number; existentes: number; emConflito: number; localizacoesRegistradas: number; posicaoNoMapaPendente: number };
  referenciasForaDaPraca: number;
  volumesPendentes: number;
  camposPreenchidos: { cidades: number; produtos: number };
  resumo: string[];
  pendencias: string[];
}

export interface AutorCarga {
  usuarioId: string;
  requestId: string;
}

/** Colunas do arquivo de origem → campos do inventário (pelo texto do cabeçalho). */
const CAMPO_POR_CABECALHO: Readonly<Record<string, string>> = {
  DELIVERY: 'delivery',
  TIPO: 'documentType',
  NUMERO: 'documentNumber',
  VOLUMES: 'volumes',
  REMETENTE: 'sender',
  'MÊS AGENDA': 'scheduleMonth',
  JANELA: 'windowRef',
  RUA: 'address',
  'N° PALLET': 'palletNumber',
  DOCUMENTAÇÃO: 'documentation',
  'PALLET FULL': 'palletFull',
  'PF/CNPJ': 'category',
};

function colunasDoPacote(p: PacoteCarga): { colunas: Record<string, number | null>; rotulo: Map<string, string> } {
  const colunas: Record<string, number | null> = {};
  const rotulo = new Map<string, string>();
  for (const [letra, cabecalho] of Object.entries(p.fonte.cabecalhos)) {
    const campo = CAMPO_POR_CABECALHO[cabecalho.trim().toUpperCase()];
    const indice = letra.toUpperCase().charCodeAt(0) - 65;
    if (campo !== undefined && /^[A-Z]$/i.test(letra)) {
      colunas[campo] = indice;
      rotulo.set(campo, cabecalho);
    }
  }
  return { colunas, rotulo };
}

const vazioParaNulo = (s: string) => (s.trim() === '' ? null : s.trim());

/** Valores e lidos da linha para o relatório do lote (mesmas chaves da importação do inventário). */
function linhaDoLote(x: PlanoLinha, rotulo: ReadonlyMap<string, string>, paleteCodigo: string | null) {
  const l = x.l;
  const lidos: Record<string, string | null> = {};
  for (const [campo, cab] of rotulo) lidos[campo] = vazioParaNulo(l.campos_originais[cab] ?? '');
  const classificacao =
    x.acao === 'REQUER_RESOLUCAO' ? ('CONFLITANTE' as const) : x.acao === 'JA_IMPORTADO' || x.acao === 'DUPLICADA_ARQUIVO' ? ('DUPLICADA' as const) : ('VALIDA_NOVA' as const);
  const posicao = x.endereco?.posicaoNova?.codigo ?? x.endereco?.registrarPosicao?.codigo ?? (x.endereco?.posicaoResolvidaId ? (x.endereco.resolvido?.posicaoCodigo ?? null) : null);
  return {
    classificacao,
    chave: `${x.enderecoCanonico ?? l.endereco}${l.numero !== '' ? ` · ${l.tipo || '?'} ${l.numero}` : ''}`,
    valores: {
      palletNumber: vazioParaNulo(l.numero_na_planilha),
      pallet: paleteCodigo,
      palletProposed: x.acao === 'CRIAR_CADASTRO' ? 'sim' : null,
      documentType: vazioParaNulo(l.tipo),
      documentNumber: vazioParaNulo(l.numero),
      delivery: vazioParaNulo(l.delivery),
      address: x.enderecoCanonico,
      position: l.endereco_livre ? null : posicao,
      positionState: l.endereco_livre ? 'endereço livre' : posicao !== null ? 'confirmada' : 'pendente',
      locate: x.endereco?.posicaoNova?.codigo ?? x.endereco?.registrarPosicao?.codigo ?? null,
      volumes: l.volumes,
      volumesUnit: l.volumes === null ? null : UNIDADE_VOLUMES,
      documentation: vazioParaNulo(l.documentacao),
      palletFull: vazioParaNulo(l.marcador_full_original),
      freeAddress: l.endereco_livre ? 'sim' : null,
    },
    lidos,
    motivos: classificacao === 'CONFLITANTE' ? x.motivos.slice(0, 1) : [],
    avisos: classificacao === 'CONFLITANTE' ? x.motivos.slice(1) : x.motivos,
  };
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * Executa a carga (ou o reenvio) numa transação: falha em qualquer passo
 * desfaz tudo. Recalcula estado e plano dentro da transação (bloqueio de
 * importação do escopo) — o resumo devolvido é o do que foi gravado.
 */
export async function executarCarga(
  db: Banco,
  escopo: Escopo,
  autor: AutorCarga,
  p: PacoteLido,
  opcoes: { substitui: string | null; descricao: string | null },
  agora: Date,
): Promise<ResultadoCarga> {
  if (escopo.demo) throw new ErroHttp(409, 'CONFLITO', 'A carga de dados reais não é feita em escopo de demonstração.');
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`importacao:${escopo.id}`}, 0))`;
      const estado = await carregarEstadoCarga(tx, escopo.id, p, opcoes.substitui);
      const plano = planejarCarga(p, estado);
      if (estado.loteExistente !== null) return reenviar(tx, escopo, autor, plano, estado.loteExistente, agora);
      return gravar(tx, escopo, autor, plano, opcoes.descricao, agora);
    },
    { maxWait: 20_000, timeout: 600_000 },
  );
}

/** Registra a localização (serviço de movimentação) de um palete existente nunca movimentado. */
async function registrarLocalizacao(tx: Transacao, escopo: Escopo, autor: AutorCarga, paleteId: string, destino: { id: string; codigo: string }, motivo: string, agora: Date): Promise<void> {
  const atual = await tx.palete.findFirst({ where: { id: paleteId, escopoId: escopo.id }, select: { versao: true } });
  if (!atual) throw new ErroHttp(409, 'CONFLITO', 'Um palete do plano não existe mais.');
  await moverPalete(tx, escopo, paleteId, { destinationPositionId: destino.id, confirmedPositionCode: destino.codigo, expectedVersion: atual.versao, reason: motivo }, autor, agora);
}

async function reenviar(tx: Transacao, escopo: Escopo, autor: AutorCarga, plano: PlanoCarga, lote: LoteExistente, agora: Date): Promise<ResultadoCarga> {
  // Mesmo pacote: nada é gravado de novo. Só localizações que agora resolvem (tabela confirmada depois).
  let localizacoes = 0;
  for (const e of plano.enderecos) {
    if (e.acao === 'EXISTENTE' && e.registrarPosicao !== null && e.existente !== null) {
      await registrarLocalizacao(tx, escopo, autor, e.existente.id, e.registrarPosicao, `Localização informada no ${lote.inventarioCodigo} (${e.endereco}), resolvida pela tabela de endereços confirmada.`, agora);
      localizacoes += 1;
    }
  }
  const pacote = plano.pacote.pacote;
  const esperadas = pacote.nfds_na_praca.length + pacote.documentos_tipo_pendente_na_praca.length;
  const ativos = plano.vinculos.filter((v) => plano.estado.vinculosPorChaveExterna.has(v.v.chave_vinculo)).length;
  await registrarEvento(tx, {
    acao: 'INVENTARIO_CARGA_REENVIADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'INVENTARIO',
    alvoId: lote.inventarioId,
    detalhes: { codigo: lote.inventarioCodigo, idLote: pacote.id_lote, hashPacote: plano.pacote.hash, vinculosAtivos: ativos, vinculosNoPacote: esperadas, localizacoes, origem: 'comando_local' },
    requestId: autor.requestId,
  });
  const linhas = await tx.linhaInventario.groupBy({ by: ['acao', 'aplicada'], where: { escopoId: escopo.id, inventarioId: lote.inventarioId }, _count: { _all: true } });
  const n = (f: (x: (typeof linhas)[number]) => boolean) => linhas.filter(f).reduce((s, x) => s + x._count._all, 0);
  return {
    reenvio: true,
    loteId: lote.id,
    inventarioId: lote.inventarioId,
    inventarioCodigo: lote.inventarioCodigo,
    confirmadoEm: lote.confirmadoEm?.toISOString() ?? null,
    linhas: {
      total: n(() => true),
      aplicadas: n((x) => x.aplicada),
      historicas: n((x) => x.acao === 'REFERENCIA_HISTORICA'),
      repetidas: n((x) => x.acao === 'DUPLICADA_ARQUIVO'),
      jaImportadas: n((x) => x.acao === 'JA_IMPORTADO'),
      pendentes: n((x) => x.acao === 'REQUER_RESOLUCAO'),
    },
    vinculos: { criados: 0, atualizados: 0, jaExistentes: ativos, emConflito: esperadas - ativos, tipoPendente: plano.vinculos.filter((v) => v.grupo === 'PENDENTE').length },
    paletes: {
      criados: 0,
      existentes: plano.enderecos.filter((e) => e.acao === 'EXISTENTE').length,
      emConflito: plano.enderecos.filter((e) => e.acao === 'CONFLITO').length,
      localizacoesRegistradas: localizacoes,
      posicaoNoMapaPendente: plano.enderecos.filter((e) => e.existente !== null && e.existente.posicaoId === null && e.registrarPosicao === null).length,
    },
    referenciasForaDaPraca: pacote.documentos_fora_da_praca.length,
    volumesPendentes: plano.vinculos.filter((v) => v.v.volumes === null).length,
    camposPreenchidos: { cidades: 0, produtos: 0 },
    resumo: [`Pacote já importado em ${lote.confirmadoEm?.toISOString() ?? '?'} como ${lote.inventarioCodigo}: nada foi gravado de novo.`, `Vínculos do pacote ativos: ${String(ativos)} de ${String(esperadas)}.`, `Localizações registradas agora (tabela confirmada depois da carga): ${String(localizacoes)}.`],
    pendencias: plano.pendencias,
  };
}

async function gravar(tx: Transacao, escopo: Escopo, autor: AutorCarga, plano: PlanoCarga, descricao: string | null, agora: Date): Promise<ResultadoCarga> {
  const p = plano.pacote;
  const pacote = p.pacote;
  const { colunas, rotulo } = colunasDoPacote(pacote);
  const loteId = randomUUID();
  const numero = await proximoNumeroInventario(tx, escopo.id);
  const inventarioId = randomUUID();
  const codigoInventario = `INV-${String(numero).padStart(6, '0')}`;
  const motivoCodigo = `${codigoInventario} (carga em lote do pacote ${pacote.id_lote.slice(0, 12)})`;

  const parametros = {
    description: (descricao ?? `Inventário ${pacote.fonte.aba} — carga em lote`).slice(0, 200),
    definitive: true,
    countReference: pacote.fonte.aba.slice(0, 120),
    countDate: null,
    countSource: `Pacote preparado de ${pacote.fonte.arquivo}`.slice(0, 200),
    palletNumberMeaning: 'REFERENCIA_EXTERNA',
    freeAddressFontColors: [pacote.regras.cor_livre_rua],
    freeAddressValues: [],
    documentTypes: [{ code: 'NFD', meaning: 'Nota de devolução (NFD), conforme o pacote de carga', originType: 'NOTA_FISCAL' }],
    replacesInventoryId: plano.estado.substitui?.id ?? null,
    complementsInventoryId: null,
    pacote: { schema: pacote.schema, idLote: pacote.id_lote, hashFonte: pacote.fonte.sha256, arquivoFonte: pacote.fonte.arquivo, aba: pacote.fonte.aba, comando: 'inventario:carregar' },
  };

  // 1. Lote (arquivo privado) já como recebido; contadores e resultado ao final.
  await tx.loteImportacao.create({
    data: {
      id: loteId,
      escopoId: escopo.id,
      tipo: 'INVENTARIO',
      situacao: 'PREVIA',
      formato: 'JSON',
      nomeArquivo: p.nomeArquivo.slice(0, 200),
      hashArquivo: p.hash,
      tamanhoBytes: p.bytes.length,
      criadoPorId: autor.usuarioId,
      criadoEm: agora,
      opcoes: { sheet: pacote.fonte.aba, headerRow: 2, encoding: 'UTF-8', delimiter: null },
      parametros,
      separadorDecimal: 'PONTO',
      colunas,
      versao: 1,
      versaoPrevia: 1,
      previaGeradaEm: agora,
      assinaturaPrevia: createHash('sha256').update(jsonCanonico(plano.linhas.map((x) => [x.l.linha, x.acao, x.aplicada, x.endereco?.acao ?? null, x.vinculo?.acao ?? null]))).digest('hex'),
    },
  });
  await tx.arquivoImportacao.create({ data: { loteId, escopoId: escopo.id, conteudo: new Uint8Array(p.bytes) } });

  // 2. Inventário de referência (fotografia).
  const aplicadas = plano.linhas.filter((x) => x.aplicada).length;
  await tx.inventarioReferencia.create({
    data: {
      id: inventarioId,
      escopoId: escopo.id,
      numero,
      codigo: codigoInventario,
      descricao: (descricao ?? `Inventário ${pacote.fonte.aba} — carga em lote do pacote preparado`).slice(0, 200),
      origem: 'IMPORTADO',
      loteImportacaoId: loteId,
      referenciaConferencia: pacote.fonte.aba.slice(0, 120),
      dataConferencia: null,
      fonteConferencia: `Pacote preparado de ${pacote.fonte.arquivo}`.slice(0, 200),
      nomeArquivo: pacote.fonte.arquivo,
      hashArquivo: pacote.fonte.sha256,
      aba: pacote.fonte.aba,
      significadoNumeroPalete: 'REFERENCIA_EXTERNA',
      convencoes: {
        freeAddressFontColors: [pacote.regras.cor_livre_rua],
        freeAddressValues: [],
        documentTypes: [{ code: 'NFD', meaning: 'Nota de devolução (NFD), conforme o pacote de carga', originType: 'NOTA_FISCAL' }],
        definitive: true,
        pacote: { schema: pacote.schema, idLote: pacote.id_lote, hashPacote: p.hash, regras: pacote.regras, blocosFileiras: pacote.blocos_fileiras },
      },
      situacao: 'ATIVO',
      substituiId: plano.estado.substitui?.id ?? null,
      totalLinhas: plano.linhas.length,
      aplicadas,
      pendentes: plano.linhas.filter((x) => x.acao === 'REQUER_RESOLUCAO').length,
      historicas: plano.linhas.filter((x) => x.acao === 'REFERENCIA_HISTORICA').length,
      criadoPorId: autor.usuarioId,
      criadoEm: agora,
    },
  });
  if (plano.estado.substitui !== null) {
    const r = await tx.inventarioReferencia.updateMany({ where: { id: plano.estado.substitui.id, escopoId: escopo.id, situacao: 'ATIVO' }, data: { situacao: 'SUBSTITUIDO', versao: { increment: 1 } } });
    if (r.count !== 1) throw new ErroHttp(409, 'CONFLITO', `O ${plano.estado.substitui.codigo} foi substituído por outra versão durante a carga.`);
  }

  // 3. Paletes pelo cadastro existente (código gerado; posição só pela tabela confirmada).
  const paletePor = new Map<string, { id: string; codigo: string }>();
  let criados = 0;
  let localizacoes = 0;
  for (const e of plano.enderecos) {
    if (e.acao === 'CONFLITO') continue;
    if (e.acao === 'EXISTENTE' && e.existente !== null) {
      paletePor.set(e.endereco, { id: e.existente.id, codigo: e.existente.codigo });
      if (e.registrarPosicao !== null) {
        await registrarLocalizacao(tx, escopo, autor, e.existente.id, e.registrarPosicao, `Localização informada no ${motivoCodigo}: ${e.endereco}.`, agora);
        localizacoes += 1;
      }
      continue;
    }
    const referencia = e.numeroPlanilha === null ? '' : ` N° Pallet na planilha: ${e.numeroPlanilha} (referência externa, não é o ID).`;
    const detalhe = await cadastrarPalete(
      tx,
      escopo,
      {
        code: { mode: 'GERAR' },
        positionId: e.posicaoNova?.id ?? null,
        notes: `Cadastrado pela carga do ${codigoInventario}: endereço ${e.endereco}${e.posicaoNova === null ? ' (posição no mapa pendente)' : ''}.${referencia} Conteúdo por produto desconhecido até a conferência.`.slice(0, 500),
        declaredItems: [],
      },
      autor,
    );
    paletePor.set(e.endereco, { id: detalhe.id, codigo: detalhe.code });
    criados += 1;
    if (e.posicaoNova !== null) localizacoes += 1;
  }

  // 4. Linhas do inventário (todas, aplicadas ou não).
  const idLinha = new Map<number, string>();
  const dadosLinhas = plano.linhas.map((x) => {
    const l = x.l;
    const id = randomUUID();
    idLinha.set(l.linha, id);
    const tipo = vazioParaNulo(l.tipo)?.toUpperCase() ?? null;
    const numeroDoc = vazioParaNulo(l.numero);
    const palete = x.endereco === null ? undefined : paletePor.get(x.endereco.endereco);
    return {
      id,
      escopoId: escopo.id,
      inventarioId,
      loteImportacaoId: loteId,
      linhaArquivo: l.linha,
      delivery: vazioParaNulo(l.delivery),
      tipoDocumento: tipo,
      numeroDocumento: numeroDoc,
      chaveDocumento: numeroDoc === null ? null : chaveDocumento(tipo, numeroDoc),
      identidadeDocumento: numeroDoc === null ? null : l.chave_documento,
      volumes: l.volumes,
      volumesLido: vazioParaNulo(l.volumes_original),
      remetente: vazioParaNulo(l.remetente),
      mesAgenda: vazioParaNulo(l.campos_originais['MÊS AGENDA'] ?? ''),
      janelaReferencia: vazioParaNulo(l.campos_originais.JANELA ?? ''),
      enderecoLido: vazioParaNulo(l.endereco_original),
      enderecoCanonico: x.enderecoCanonico,
      enderecoLivre: l.endereco_livre,
      numeroPalete: vazioParaNulo(l.numero_na_planilha),
      documentacao: vazioParaNulo(l.documentacao),
      palletFull: vazioParaNulo(l.marcador_full_original),
      categoria: vazioParaNulo(l.campos_originais['PF/CNPJ'] ?? ''),
      extras: json({}),
      paleteId: x.aplicada ? (palete?.id ?? null) : null,
      posicaoId: l.endereco_livre ? null : (x.endereco?.posicaoResolvidaId ?? null),
      acao: x.acao,
      aplicada: x.aplicada,
      motivos: json(x.motivos),
      criadoEm: agora,
    };
  });
  for (const d of dadosLinhas) if (d.aplicada && d.paleteId === null) throw new Error(`Linha ${String(d.linhaArquivo)} aplicada sem palete.`);
  for (let i = 0; i < dadosLinhas.length; i += 500) await tx.linhaInventario.createMany({ data: dadosLinhas.slice(i, i + 500) });

  // 5. Vínculos documentais (encerramento do anterior quando os dados mudaram).
  const paletesAfetados = [...new Set([...paletePor.values()].map((x) => x.id))];
  const encerrar = plano.vinculos.filter((v) => v.acao === 'ATUALIZAR' && v.encerrarId !== null);
  for (const v of encerrar) {
    await tx.vinculoDocumentoPalete.update({
      where: { id: v.encerrarId ?? '' },
      data: { situacao: 'ENCERRADO', encerradoEm: agora, encerradoPorId: autor.usuarioId, motivoEncerramento: `Atualizado pela linha ${String(v.linhaPrincipal)} do ${codigoInventario}.` },
    });
  }
  const chavesAtivas = new Set(
    (await tx.vinculoDocumentoPalete.findMany({ where: { escopoId: escopo.id, situacao: 'ATIVO', paleteId: { in: paletesAfetados } }, select: { chave: true } })).map((x) => x.chave),
  );
  const novos = plano.vinculos.filter((v) => v.acao === 'CRIAR' || v.acao === 'ATUALIZAR');
  const dadosVinculos = novos.map((pv) => {
    const v = pv.v;
    const palete = paletePor.get(pv.endereco.endereco);
    const linhaId = idLinha.get(pv.linhaPrincipal);
    if (!palete || !linhaId) throw new Error(`Vínculo ${v.numero_documento}: palete ou linha ausente.`);
    const documento = chaveDocumento(v.tipo_documento, v.numero_documento);
    let ordem = 1;
    while (chavesAtivas.has(chaveVinculo(palete.id, documento, v.delivery, ordem))) ordem += 1;
    const chave = chaveVinculo(palete.id, documento, v.delivery, ordem);
    chavesAtivas.add(chave);
    return {
      id: randomUUID(),
      escopoId: escopo.id,
      paleteId: palete.id,
      inventarioId,
      linhaInventarioId: linhaId,
      tipoDocumento: v.tipo_documento,
      numeroDocumento: v.numero_documento,
      chaveDocumento: documento,
      delivery: v.delivery,
      volumes: v.volumes,
      unidadeVolumes: UNIDADE_VOLUMES,
      documentacao: documentacaoDe(pacote, v),
      palletFull: marcadoresDe(v),
      chave,
      identidadeDocumento: v.chave_documento,
      chaveExterna: v.chave_vinculo,
      fotografia: json({
        idLote: pacote.id_lote,
        paleteFull: v.palete_full,
        fullBase: v.full_base,
        maisDeUmPalete: v.mais_de_um_palete_da_nfd_no_inventario,
        quantidadePaletesDeclarada: v.quantidade_paletes_declarada_nfd,
        quantidadeEnderecosNaPraca: v.quantidade_enderecos_nfd_na_praca,
        enderecosNaPraca: v.enderecos_nfd_na_praca,
        enderecosNaOrigem: v.enderecos_nfd_na_origem,
        partesFullNesteEndereco: v.partes_full_neste_endereco,
        marcadores: v.marcadores_full_originais,
        pendencias: v.pendencias,
        volumesBase: v.volumes_base,
        volumesNaOrigem: v.volumes_na_origem.map((x) => ({ linha: x.linha, valor: x.valor, texto: x.texto_original })),
        linhasOrigem: v.linhas_origem,
        numeroPaletePlanilha: v.numero_palete_na_planilha,
        remetentesNaOrigem: v.remetentes_na_origem,
      }),
      situacao: 'ATIVO',
      criadoPorId: autor.usuarioId,
      criadoEm: agora,
    };
  });
  for (let i = 0; i < dadosVinculos.length; i += 500) await tx.vinculoDocumentoPalete.createMany({ data: dadosVinculos.slice(i, i + 500) });
  if (plano.estado.substitui !== null) {
    const mantidas = new Set([...plano.vinculos.filter((v) => v.acao === 'JA_IMPORTADO').flatMap((v) => (v.encerrarId === null ? [] : [v.encerrarId]))]);
    const antigos = await tx.vinculoDocumentoPalete.findMany({ where: { escopoId: escopo.id, inventarioId: plano.estado.substitui.id, situacao: 'ATIVO' }, select: { id: true } });
    for (const a of antigos.filter((x) => !mantidas.has(x.id))) {
      await tx.vinculoDocumentoPalete.update({
        where: { id: a.id },
        data: { situacao: 'ENCERRADO', encerradoEm: agora, encerradoPorId: autor.usuarioId, motivoEncerramento: `Não consta da versão ${codigoInventario}.` },
      });
    }
  }

  // 6. Cidade destino e produto na caixa: só preenchem o que está vazio (vazio nunca apaga).
  let cidades = 0;
  let produtos = 0;
  for (const pv of plano.vinculos.filter((x) => x.acao !== 'CONFLITO')) {
    const palete = paletePor.get(pv.endereco.endereco);
    const cidade = pv.v.cidade_destino.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (cidade !== '') {
      const atual = await tx.informacaoDocumento.findUnique({ where: { escopoId_identidadeDocumento: { escopoId: escopo.id, identidadeDocumento: pv.v.chave_documento } }, select: { id: true, cidadeDestino: true } });
      if (!atual) {
        await tx.informacaoDocumento.create({ data: { id: randomUUID(), escopoId: escopo.id, identidadeDocumento: pv.v.chave_documento, tipoDocumento: pv.v.tipo_documento, numeroDocumento: pv.v.numero_documento, cidadeDestino: cidade, atualizadoPorId: autor.usuarioId, atualizadoEm: agora } });
        cidades += 1;
      } else if (atual.cidadeDestino === '') {
        await tx.informacaoDocumento.update({ where: { id: atual.id }, data: { cidadeDestino: cidade, versao: { increment: 1 }, atualizadoPorId: autor.usuarioId, atualizadoEm: agora } });
        cidades += 1;
      }
    }
    const produto = pv.v.produto_na_caixa.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (produto !== '' && palete) {
      const atual = await tx.conteudoDocumentoPalete.findUnique({
        where: { escopoId_paleteId_identidadeDocumento: { escopoId: escopo.id, paleteId: palete.id, identidadeDocumento: pv.v.chave_documento } },
        select: { id: true, produtoNaCaixa: true },
      });
      if (!atual) {
        await tx.conteudoDocumentoPalete.create({ data: { id: randomUUID(), escopoId: escopo.id, paleteId: palete.id, identidadeDocumento: pv.v.chave_documento, produtoNaCaixa: produto, atualizadoPorId: autor.usuarioId, atualizadoEm: agora } });
        produtos += 1;
      } else if (atual.produtoNaCaixa === '') {
        await tx.conteudoDocumentoPalete.update({ where: { id: atual.id }, data: { produtoNaCaixa: produto, versao: { increment: 1 }, atualizadoPorId: autor.usuarioId, atualizadoEm: agora } });
        produtos += 1;
      }
    }
  }

  // 7. Linhas do lote (relatório e tela de importações), contadores, resultado e auditoria.
  const paleteDaLinha = (x: PlanoLinha) => (x.endereco === null ? null : (paletePor.get(x.endereco.endereco)?.codigo ?? null));
  const linhasLote = plano.linhas.map((x) => ({ x, r: linhaDoLote(x, rotulo, paleteDaLinha(x)) }));
  for (let i = 0; i < linhasLote.length; i += 500) {
    await tx.linhaImportacao.createMany({
      data: linhasLote.slice(i, i + 500).map(({ x, r }) => ({
        escopoId: escopo.id,
        loteId,
        numero: x.l.linha,
        classificacao: r.classificacao,
        chave: r.chave,
        valores: json(r.valores),
        lidos: json(r.lidos),
        motivos: json(r.motivos),
        avisos: json(r.avisos),
        resultado: r.classificacao === 'VALIDA_NOVA' ? ('GRAVADA' as const) : r.classificacao === 'DUPLICADA' ? ('IGNORADA_DUPLICADA' as const) : null,
        registroId: r.classificacao === 'VALIDA_NOVA' ? (idLinha.get(x.l.linha) ?? null) : null,
        acao: x.acao,
      })),
    });
  }
  const cont = (c: string) => linhasLote.filter((y) => y.r.classificacao === c).length;
  const vinculosCriados = plano.vinculos.filter((v) => v.acao === 'CRIAR').length;
  const vinculosAtualizados = plano.vinculos.filter((v) => v.acao === 'ATUALIZAR').length;
  const resultado: ResultadoGravacao = {
    productsCreated: 0,
    barcodesAdded: 0,
    documentsCreated: 0,
    documentLinesCreated: 0,
    claimsCreated: 0,
    claimLinesCreated: 0,
    inventoryId: inventarioId,
    inventoryLines: plano.linhas.length,
    inventoryLinesApplied: aplicadas,
    inventoryLinesPending: plano.linhas.length - aplicadas,
    documentLinksCreated: dadosVinculos.length,
    palletsCreated: criados,
    palletsLocated: localizacoes,
    selectionId: null,
    selectionLines: 0,
  };
  await tx.loteImportacao.update({
    where: { id: loteId },
    data: {
      situacao: 'CONFIRMADO',
      resumoPrevia: { linhas: plano.resumo, bloqueio: null },
      totalLinhas: plano.linhas.length,
      validasNovas: cont('VALIDA_NOVA'),
      duplicadas: cont('DUPLICADA'),
      invalidas: 0,
      conflitantes: cont('CONFLITANTE'),
      gravadas: cont('VALIDA_NOVA'),
      ignoradas: cont('DUPLICADA'),
      resultado: json(resultado),
      confirmadoPorId: autor.usuarioId,
      confirmadoEm: agora,
      versao: { increment: 1 },
    },
  });
  await registrarEvento(tx, {
    acao: 'INVENTARIO_IMPORTADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'INVENTARIO',
    alvoId: inventarioId,
    detalhes: {
      codigo: codigoInventario,
      lote: loteId,
      origem: 'carga_em_lote',
      idLote: pacote.id_lote,
      hashFonte: pacote.fonte.sha256,
      hashPacote: p.hash,
      linhas: plano.linhas.length,
      aplicadas,
      vinculos: dadosVinculos.length,
      paletesCriados: criados,
      localizacoes,
      substitui: plano.estado.substitui?.codigo ?? null,
      saldoValidadoAlterado: false,
    },
    requestId: autor.requestId,
  });
  await registrarEvento(tx, {
    acao: 'IMPORTACAO_CONFIRMADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'LOTE_IMPORTACAO',
    alvoId: loteId,
    detalhes: { tipo: 'INVENTARIO', formato: 'JSON', origem: 'comando_local', gravadas: cont('VALIDA_NOVA'), ignoradas: cont('DUPLICADA'), conflitantes: cont('CONFLITANTE'), inventario: inventarioId },
    requestId: autor.requestId,
  });
  return {
    reenvio: false,
    loteId,
    inventarioId,
    inventarioCodigo: codigoInventario,
    confirmadoEm: agora.toISOString(),
    linhas: {
      total: plano.linhas.length,
      aplicadas,
      historicas: plano.linhas.filter((x) => x.acao === 'REFERENCIA_HISTORICA').length,
      repetidas: plano.linhas.filter((x) => x.acao === 'DUPLICADA_ARQUIVO').length,
      jaImportadas: plano.linhas.filter((x) => x.acao === 'JA_IMPORTADO').length,
      pendentes: plano.linhas.filter((x) => x.acao === 'REQUER_RESOLUCAO').length,
    },
    vinculos: {
      criados: vinculosCriados,
      atualizados: vinculosAtualizados,
      jaExistentes: plano.vinculos.filter((v) => v.acao === 'JA_IMPORTADO').length,
      emConflito: plano.vinculos.filter((v) => v.acao === 'CONFLITO').length,
      tipoPendente: plano.vinculos.filter((v) => v.grupo === 'PENDENTE' && v.acao !== 'CONFLITO').length,
    },
    paletes: {
      criados,
      existentes: plano.enderecos.filter((e) => e.acao === 'EXISTENTE').length,
      emConflito: plano.enderecos.filter((e) => e.acao === 'CONFLITO').length,
      localizacoesRegistradas: localizacoes,
      posicaoNoMapaPendente: plano.enderecos.filter((e) => e.acao !== 'CONFLITO' && e.posicaoNova === null && e.registrarPosicao === null && !(e.existente?.posicaoId != null)).length,
    },
    referenciasForaDaPraca: pacote.documentos_fora_da_praca.length,
    volumesPendentes: plano.vinculos.filter((v) => v.v.volumes === null && v.acao !== 'CONFLITO').length,
    camposPreenchidos: { cidades, produtos },
    resumo: plano.resumo,
    pendencias: plano.pendencias,
  };
}
