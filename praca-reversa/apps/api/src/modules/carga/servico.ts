/**
 * Expedição DHL — operações da montagem da carga (11 nov. 2026).
 *
 * Tudo em transação, com chave de idempotência (rotas) e versão esperada.
 * Nada aqui baixa estoque nem muda a situação do palete de origem: a baixa
 * continua no evento EXPEDICAO por volumes da janela (fluxo autorizado
 * existente). Ordem de bloqueio: veículo(s) por id → palete de embarque →
 * paletes de origem por id (evita impasse entre duas pessoas na mesma carga).
 */
import {
  CAPACIDADE_VEICULO,
  GRADE_PADRAO,
  identidadeEmbarque,
  rotuloPaleteEmbarque,
  type AcaoVeiculoSchema,
  type AlterarLinhasEmbarqueSchema,
  type AlterarVeiculoSchema,
  type CancelarEmbarqueSchema,
  type ConferirDocumentoSchema,
  type ConfirmarPosicaoSchema,
  type CriarPaleteEmbarqueSchema,
  type CriarVeiculoSchema,
  type EmitirSchema,
  type FisicoConferidoSchema,
  type IncluirNotasEmbarqueSchema,
  type PosicaoEmbarqueSchema,
  type TipoVeiculo,
  type TransferirEmbarqueSchema,
  type Escopo,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { fotografiaMapa, lerJanelaCarga } from './leitura.js';
import { disponibilidade, lerOcorrencias, ocorrenciasDoPalete, type RefOcorrencia } from './origem.js';

export interface Autor {
  usuarioId: string;
}

type Saida<T extends z.ZodType> = z.output<T>;

interface VeiculoTravado {
  id: string;
  janela_id: string;
  tipo: TipoVeiculo;
  sequencia: number;
  capacidade: number;
  fileiras: number;
  colunas: number;
  situacao: 'MONTAGEM' | 'FECHADO' | 'CANCELADO';
  versao: number;
}

interface PaleteTravado {
  id: string;
  veiculo_id: string;
  numero: number;
  posicao: number | null;
  posicao_confirmada: boolean;
  tipo: 'FULL' | 'FRACIONADO';
  palete_origem_id: string | null;
  revisao: number;
  fisico_revisao: number | null;
  situacao: 'ATIVO' | 'CANCELADO';
  versao: number;
}

const conflito = (mensagem: string) => new ErroHttp(409, 'CONFLITO', mensagem);

async function historico(tx: Transacao, escopoId: string, veiculoId: string, paleteId: string | null, tipo: string, detalhes: Record<string, unknown>, autor: Autor, agora: Date): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO evento_embarque (id, escopo_id, veiculo_id, palete_embarque_id, tipo, detalhes, autor_id, ocorrido_em)
    VALUES (${randomUUID()}::uuid, ${escopoId}::uuid, ${veiculoId}::uuid, ${paleteId}::uuid, ${tipo}, ${JSON.stringify(detalhes)}::jsonb, ${autor.usuarioId}::uuid, ${agora})`;
}

async function travarVeiculo(tx: Transacao, escopoId: string, veiculoId: string): Promise<VeiculoTravado> {
  const [v] = await tx.$queryRaw<VeiculoTravado[]>`
    SELECT id::text, janela_id::text, tipo, sequencia, capacidade, fileiras, colunas, situacao, versao
      FROM veiculo_carga WHERE id = ${veiculoId}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (!v) throw naoEncontrado('Veículo não encontrado neste escopo.');
  return v;
}

function exigirMontagem(v: VeiculoTravado, rotulo: string): void {
  if (v.situacao === 'FECHADO') throw conflito(`${rotulo}: a carga está fechada. Alterações de carga fechada exigem reabrir com motivo (supervisor).`);
  if (v.situacao === 'CANCELADO') throw conflito(`${rotulo}: o veículo foi cancelado.`);
}

function exigirVersao(atual: number, esperada: number, rotulo: string): void {
  if (atual !== esperada) throw new ErroHttp(409, 'CONFLITO_VERSAO', `${rotulo} foi alterado por outra pessoa. Os dados foram recarregados; confira antes de repetir.`);
}

/** Palete de embarque com o veículo travado antes (mesma ordem de bloqueio em todas as operações). */
async function travarPalete(tx: Transacao, escopoId: string, paleteId: string): Promise<{ p: PaleteTravado; v: VeiculoTravado }> {
  const [ref] = await tx.$queryRaw<{ veiculo_id: string }[]>`
    SELECT veiculo_id::text FROM palete_embarque WHERE id = ${paleteId}::uuid AND escopo_id = ${escopoId}::uuid`;
  if (!ref) throw naoEncontrado('Palete de embarque não encontrado neste escopo.');
  const v = await travarVeiculo(tx, escopoId, ref.veiculo_id);
  const [p] = await tx.$queryRaw<PaleteTravado[]>`
    SELECT id::text, veiculo_id::text, numero, posicao, posicao_confirmada, tipo, palete_origem_id::text, revisao, fisico_revisao, situacao, versao
      FROM palete_embarque WHERE id = ${paleteId}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
  if (p?.veiculo_id !== v.id) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O palete mudou de veículo enquanto a operação era preparada. Recarregue e confira.');
  return { p, v };
}

const rotuloDo = (v: VeiculoTravado, numero: number) => `${rotuloPaleteEmbarque(numero)} (${v.tipo === 'CARRETA' ? 'Carreta' : 'Truck'} ${String(v.sequencia).padStart(2, '0')})`;

async function ativosDoVeiculo(tx: Transacao, veiculoId: string): Promise<{ id: string; numero: number; posicao: number | null }[]> {
  return tx.$queryRaw`SELECT id::text, numero, posicao FROM palete_embarque WHERE veiculo_id = ${veiculoId}::uuid AND situacao = 'ATIVO'`;
}

function validarPosicao(v: VeiculoTravado, posicao: number, ativos: readonly { id: string; posicao: number | null; numero: number }[], ignorar: string | null): void {
  if (posicao < 1 || posicao > v.capacidade) throw requisicaoInvalida(`Posição ${String(posicao)} fora do veículo (1 a ${String(v.capacidade)}).`);
  const ocupante = ativos.find((a) => a.posicao === posicao && a.id !== ignorar);
  if (ocupante) throw conflito(`A posição ${String(posicao)} já tem o ${rotuloPaleteEmbarque(ocupante.numero)}. Uma posição não aceita dois paletes: libere-a primeiro.`);
}

function proximoNumero(v: VeiculoTravado, ativos: readonly { numero: number }[]): number {
  const usados = new Set(ativos.map((a) => a.numero));
  for (let n = 1; n <= v.capacidade; n++) if (!usados.has(n)) return n;
  throw conflito(`O veículo já tem ${String(v.capacidade)} paletes: capacidade completa.`);
}

// ---------- Linhas (origem e volumes) ----------

interface LinhaPronta {
  ref: RefOcorrencia;
  volumes: number;
  paleteOrigemId: string;
  paleteOrigemCodigo: string;
  tipo: string | null;
  numero: string | null;
  remetente: string | null;
  delivery: string | null;
}

/** Trava os paletes de origem (por id) e confere situação na praça. */
async function travarOrigens(tx: Transacao, escopoId: string, ids: readonly string[]): Promise<Map<string, { codigo: string; naPraca: boolean }>> {
  const unicos = [...new Set(ids)].sort();
  const saida = new Map<string, { codigo: string; naPraca: boolean }>();
  for (const id of unicos) {
    const [p] = await tx.$queryRaw<{ codigo: string; na_praca: boolean }[]>`
      SELECT codigo, (arquivado_em IS NULL AND estado_fluxo::text IN ('EM_ESTOQUE', 'RESERVADO')) AS na_praca
        FROM palete WHERE id = ${id}::uuid AND escopo_id = ${escopoId}::uuid FOR UPDATE`;
    if (!p) throw naoEncontrado('Palete de origem não encontrado neste escopo.');
    saida.set(id, { codigo: p.codigo, naPraca: p.na_praca });
  }
  return saida;
}

/** FULL ativo de um palete de origem (identidade do embarque), excluindo um palete de embarque. */
async function fullAtivo(tx: Transacao, escopoId: string, origemId: string, excluir: string | null): Promise<string | null> {
  const [f] = await tx.$queryRaw<{ codigo: string; tipo: TipoVeiculo; sequencia: number; numero: number }[]>`
    SELECT j.codigo, v.tipo, v.sequencia, pe.numero
      FROM palete_embarque pe JOIN veiculo_carga v ON v.id = pe.veiculo_id JOIN janela_devolucao j ON j.id = v.janela_id
     WHERE pe.escopo_id = ${escopoId}::uuid AND pe.palete_origem_id = ${origemId}::uuid AND pe.tipo = 'FULL' AND pe.situacao = 'ATIVO'
       AND v.situacao <> 'CANCELADO' AND (${excluir}::uuid IS NULL OR pe.id <> ${excluir}::uuid)
     LIMIT 1`;
  return f ? identidadeEmbarque(f.codigo, f.tipo, f.sequencia, f.numero) : null;
}

/**
 * Valida as linhas pedidas: ocorrência ativa, palete de origem na praça, base
 * conhecida e volumes ≤ disponível para a janela (sem o próprio palete).
 */
async function prepararLinhas(tx: Transacao, escopoId: string, janelaId: string, pedidas: readonly { ref: RefOcorrencia; volumes: number }[], excluirPalete: string | null): Promise<LinhaPronta[]> {
  const ocorrencias = await lerOcorrencias(tx, escopoId, pedidas.map((p) => p.ref));
  for (const p of pedidas) {
    const o = ocorrencias.get(p.ref.id);
    if (o?.kind !== p.ref.kind) throw naoEncontrado('Ocorrência de origem não encontrada neste escopo (NF do palete). Atualize a lista.');
  }
  const origens = await travarOrigens(
    tx,
    escopoId,
    pedidas.map((p) => ocorrencias.get(p.ref.id)?.palletId ?? ''),
  );
  // Disponibilidade depois de travar as origens: duas pessoas não usam a mesma parte.
  const bases = new Map([...ocorrencias.values()].map((o) => [o.id, o.base]));
  const disp = await disponibilidade(tx, escopoId, janelaId, [...ocorrencias.keys()], bases, excluirPalete);
  const saida: LinhaPronta[] = [];
  for (const p of pedidas) {
    const o = ocorrencias.get(p.ref.id);
    if (!o) continue;
    const origem = origens.get(o.palletId);
    const descricao = `${o.documentType ?? 'Documento'} ${o.documentNumber ?? 'sem número'} (palete ${o.palletCode})`;
    if (!o.ativa) throw conflito(`${descricao}: a ocorrência foi encerrada ou movida. Atualize a lista.`);
    if (origem?.naPraca !== true) throw conflito(`O palete ${o.palletCode} não está na praça: não entra na carga.`);
    const full = await fullAtivo(tx, escopoId, o.palletId, excluirPalete);
    if (full !== null) throw conflito(`O palete ${o.palletCode} já sai FULL em ${full}: não pode ser fracionado em outro palete.`);
    if (o.base === null) throw conflito(`${descricao}: volumes não informados. Registre a contagem na conferência de volumes antes de embarcar.`);
    const disponivel = disp.get(o.id)?.available ?? 0;
    if (p.volumes > disponivel) {
      throw conflito(`${descricao}: ${String(p.volumes)} volume(s) pedido(s), ${String(disponivel)} disponível(is) de ${String(o.base)} (o restante já está em outro palete de embarque ou expedido).`);
    }
    saida.push({
      ref: p.ref,
      volumes: p.volumes,
      paleteOrigemId: o.palletId,
      paleteOrigemCodigo: o.palletCode,
      tipo: o.documentType,
      numero: o.documentNumber,
      remetente: o.sender,
      delivery: o.delivery,
    });
  }
  return saida;
}

/** Linhas de um FULL: todo o conteúdo ativo do palete de origem com o disponível para esta janela. */
async function linhasDoFull(tx: Transacao, escopoId: string, janelaId: string, origemId: string, excluirPalete: string | null): Promise<LinhaPronta[]> {
  const origens = await travarOrigens(tx, escopoId, [origemId]);
  const origem = origens.get(origemId);
  if (origem?.naPraca !== true) throw conflito(`O palete ${origem?.codigo ?? ''} não está na praça: não entra na carga.`);
  const full = await fullAtivo(tx, escopoId, origemId, excluirPalete);
  if (full !== null) throw conflito(`O palete ${origem.codigo} já sai FULL em ${full}. Um FULL não vai em duas cargas ativas.`);
  const [fracionado] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM linha_palete_embarque l JOIN palete_embarque pe ON pe.id = l.palete_embarque_id JOIN veiculo_carga v ON v.id = pe.veiculo_id
     WHERE l.escopo_id = ${escopoId}::uuid AND l.palete_origem_id = ${origemId}::uuid AND l.removida_em IS NULL AND pe.situacao = 'ATIVO' AND v.situacao <> 'CANCELADO'
       AND (${excluirPalete}::uuid IS NULL OR pe.id <> ${excluirPalete}::uuid)`;
  if (Number(fracionado?.n ?? 0) > 0) throw conflito(`O palete ${origem.codigo} já tem NFs em paletes fracionados desta ou de outra carga: não pode sair FULL.`);
  const refs = await ocorrenciasDoPalete(tx, escopoId, origemId);
  if (refs.length === 0) throw conflito(`O palete ${origem.codigo} não tem conteúdo ativo registrado.`);
  const ocorrencias = await lerOcorrencias(tx, escopoId, refs);
  const semBase = [...ocorrencias.values()].filter((o) => o.base === null);
  if (semBase.length > 0) {
    throw conflito(`Palete ${origem.codigo}: ${String(semBase.length)} NF(s) sem volumes informados (${semBase.map((o) => o.documentNumber ?? 'sem número').slice(0, 5).join(', ')}). Registre a contagem antes de embarcar FULL.`);
  }
  const disp = await disponibilidade(tx, escopoId, janelaId, refs.map((r) => r.id), new Map([...ocorrencias.values()].map((o) => [o.id, o.base])), excluirPalete);
  const saida: LinhaPronta[] = [];
  for (const r of refs) {
    const o = ocorrencias.get(r.id);
    const v = disp.get(r.id)?.available ?? 0;
    if (!o || v <= 0) continue;
    saida.push({ ref: r, volumes: v, paleteOrigemId: origemId, paleteOrigemCodigo: origem.codigo, tipo: o.documentType, numero: o.documentNumber, remetente: o.sender, delivery: o.delivery });
  }
  if (saida.length === 0) throw conflito(`O palete ${origem.codigo} não tem volumes disponíveis: tudo já foi expedido ou está em outra carga.`);
  saida.sort((a, b) => `${a.tipo ?? ''}${a.numero ?? ''}`.localeCompare(`${b.tipo ?? ''}${b.numero ?? ''}`, 'pt-BR', { numeric: true }));
  return saida;
}

async function gravarLinhas(tx: Transacao, escopoId: string, paleteId: string, linhas: readonly LinhaPronta[]): Promise<void> {
  let ordem = 0;
  for (const l of linhas) {
    ordem++;
    await tx.$executeRaw`
      INSERT INTO linha_palete_embarque (id, escopo_id, palete_embarque_id, vinculo_id, conteudo_id, palete_origem_id, palete_origem_codigo, volumes,
                                         tipo_documento, numero_documento, remetente, delivery, ordem)
      VALUES (${randomUUID()}::uuid, ${escopoId}::uuid, ${paleteId}::uuid,
              ${l.ref.kind === 'VINCULO' ? l.ref.id : null}::uuid, ${l.ref.kind === 'CONTEUDO' ? l.ref.id : null}::uuid,
              ${l.paleteOrigemId}::uuid, ${l.paleteOrigemCodigo}, ${l.volumes}, ${l.tipo}, ${l.numero}, ${l.remetente}, ${l.delivery}, ${ordem})`;
  }
}

async function linhasAtuais(tx: Transacao, paleteId: string): Promise<{ id: string; alvo: string; volumes: number }[]> {
  return tx.$queryRaw`SELECT id::text, coalesce(vinculo_id, conteudo_id)::text AS alvo, volumes FROM linha_palete_embarque WHERE palete_embarque_id = ${paleteId}::uuid AND removida_em IS NULL ORDER BY ordem`;
}

/**
 * Troca as linhas mantendo o id das ocorrências que continuam. Linha que sai
 * com conferência documental registrada fica marcada como removida (o
 * registro continua); sem conferência, é apagada.
 *
 */
async function substituirLinhas(tx: Transacao, escopoId: string, paleteId: string, novas: readonly LinhaPronta[], agora: Date): Promise<{ mudou: boolean; antes: { alvo: string; volumes: number }[] }> {
  const atuais = await linhasAtuais(tx, paleteId);
  const antes = atuais.map((a) => ({ alvo: a.alvo, volumes: a.volumes }));
  const igual =
    atuais.length === novas.length &&
    atuais.every((a, i) => {
      const n = novas.at(i);
      return a.alvo === n?.ref.id && a.volumes === n.volumes;
    });
  if (igual) return { mudou: false, antes };
  // Linhas que permanecem (mesma ocorrência): atualiza volumes e ordem; mantém o id (o histórico documental continua ligado).
  const porAlvo = new Map(atuais.map((a) => [a.alvo, a]));
  const ficam = new Set<string>();
  let ordem = 0;
  for (const l of novas) {
    ordem++;
    const existente = porAlvo.get(l.ref.id);
    if (existente) {
      ficam.add(existente.id);
      await tx.$executeRaw`UPDATE linha_palete_embarque SET volumes = ${l.volumes}, ordem = ${ordem} WHERE id = ${existente.id}::uuid`;
    } else {
      await tx.$executeRaw`
        INSERT INTO linha_palete_embarque (id, escopo_id, palete_embarque_id, vinculo_id, conteudo_id, palete_origem_id, palete_origem_codigo, volumes,
                                           tipo_documento, numero_documento, remetente, delivery, ordem)
        VALUES (${randomUUID()}::uuid, ${escopoId}::uuid, ${paleteId}::uuid,
                ${l.ref.kind === 'VINCULO' ? l.ref.id : null}::uuid, ${l.ref.kind === 'CONTEUDO' ? l.ref.id : null}::uuid,
                ${l.paleteOrigemId}::uuid, ${l.paleteOrigemCodigo}, ${l.volumes}, ${l.tipo}, ${l.numero}, ${l.remetente}, ${l.delivery}, ${ordem})`;
    }
  }
  const saem = atuais.filter((a) => !ficam.has(a.id)).map((a) => a.id);
  if (saem.length > 0) {
    // Com conferência documental registrada, a linha só sai da carga (o registro fica); sem, é apagada.
    await tx.$executeRaw`UPDATE linha_palete_embarque SET removida_em = ${agora} WHERE id = ANY(${saem}::uuid[]) AND EXISTS (SELECT 1 FROM documento_embarque d WHERE d.linha_id = linha_palete_embarque.id)`;
    await tx.$executeRaw`DELETE FROM linha_palete_embarque WHERE id = ANY(${saem}::uuid[]) AND removida_em IS NULL`;
  }
  return { mudou: true, antes };
}

// ---------- Veículos ----------

export async function criarVeiculo(tx: Transacao, escopo: Escopo, janelaId: string, dados: Saida<typeof CriarVeiculoSchema>, autor: Autor, agora: Date): Promise<void> {
  const [j] = await tx.$queryRaw<{ situacao: string }[]>`
    SELECT situacao::text FROM janela_devolucao WHERE id = ${janelaId}::uuid AND escopo_id = ${escopo.id}::uuid FOR UPDATE`;
  if (!j) throw naoEncontrado('Janela não encontrada neste escopo.');
  if (j.situacao === 'CANCELADA' || j.situacao === 'ENCERRADA') throw conflito(`A janela está ${j.situacao === 'CANCELADA' ? 'cancelada' : 'encerrada'}: não recebe novos veículos.`);
  const [seq] = await tx.$queryRaw<{ n: number }[]>`
    SELECT coalesce(max(sequencia), 0) + 1 AS n FROM veiculo_carga WHERE janela_id = ${janelaId}::uuid AND tipo = ${dados.kind}`;
  const id = randomUUID();
  const grade = GRADE_PADRAO[dados.kind];
  await tx.$executeRaw`
    INSERT INTO veiculo_carga (id, escopo_id, janela_id, tipo, sequencia, capacidade, nome, placa, fileiras, colunas, criado_por_id, criado_em, atualizado_em)
    VALUES (${id}::uuid, ${escopo.id}::uuid, ${janelaId}::uuid, ${dados.kind}, ${seq?.n ?? 1}, ${CAPACIDADE_VEICULO[dados.kind]}, ${dados.name}, ${dados.plate},
            ${grade.rows}, ${grade.cols}, ${autor.usuarioId}::uuid, ${agora}, ${agora})`;
  await historico(tx, escopo.id, id, null, 'VEICULO_CRIADO', { tipo: dados.kind, sequencia: seq?.n ?? 1, placa: dados.plate }, autor, agora);
}

export async function alterarVeiculo(tx: Transacao, escopo: Escopo, veiculoId: string, dados: Saida<typeof AlterarVeiculoSchema>, autor: Autor, agora: Date): Promise<string> {
  const v = await travarVeiculo(tx, escopo.id, veiculoId);
  exigirMontagem(v, 'Veículo');
  exigirVersao(v.versao, dados.expectedVersion, 'O veículo');
  if (dados.rows * dados.cols < v.capacidade) throw requisicaoInvalida(`A grade ${String(dados.rows)} × ${String(dados.cols)} tem menos lugares que a capacidade (${String(v.capacidade)}).`);
  await tx.$executeRaw`
    UPDATE veiculo_carga SET nome = ${dados.name}, placa = ${dados.plate}, fileiras = ${dados.rows}, colunas = ${dados.cols},
           disposicao_confirmada = ${dados.layoutConfirmed}, versao = versao + 1, atualizado_em = ${agora}
     WHERE id = ${veiculoId}::uuid`;
  await historico(tx, escopo.id, veiculoId, null, 'VEICULO_ALTERADO', { nome: dados.name, placa: dados.plate, fileiras: dados.rows, colunas: dados.cols, disposicaoConfirmada: dados.layoutConfirmed }, autor, agora);
  return v.janela_id;
}

export async function acaoVeiculo(tx: Transacao, escopo: Escopo, veiculoId: string, dados: Saida<typeof AcaoVeiculoSchema>, autor: Autor, agora: Date, pendencias: (janelaId: string, veiculoId: string) => Promise<string[]>): Promise<string> {
  const v = await travarVeiculo(tx, escopo.id, veiculoId);
  exigirVersao(v.versao, dados.expectedVersion, 'O veículo');
  if (dados.action === 'FECHAR') {
    if (v.situacao !== 'MONTAGEM') throw conflito('Só uma carga em montagem pode ser fechada.');
    const faltam = await pendencias(v.janela_id, veiculoId);
    if (faltam.length > 0) throw conflito(`A carga ainda tem pendências: ${faltam.join(' ')}`);
    await tx.$executeRaw`UPDATE veiculo_carga SET situacao = 'FECHADO', versao = versao + 1, atualizado_em = ${agora} WHERE id = ${veiculoId}::uuid`;
    await historico(tx, escopo.id, veiculoId, null, 'VEICULO_FECHADO', { motivo: dados.reason }, autor, agora);
  } else if (dados.action === 'REABRIR') {
    if (v.situacao !== 'FECHADO') throw conflito('Só uma carga fechada pode ser reaberta.');
    if (dados.reason === null) throw requisicaoInvalida('Reabrir uma carga fechada exige o motivo.');
    await tx.$executeRaw`UPDATE veiculo_carga SET situacao = 'MONTAGEM', versao = versao + 1, atualizado_em = ${agora} WHERE id = ${veiculoId}::uuid`;
    await historico(tx, escopo.id, veiculoId, null, 'VEICULO_REABERTO', { motivo: dados.reason }, autor, agora);
  } else {
    if (v.situacao !== 'MONTAGEM') throw conflito(v.situacao === 'FECHADO' ? 'Carga fechada não é cancelada: reabra com motivo antes.' : 'O veículo já está cancelado.');
    if (dados.reason === null) throw requisicaoInvalida('Cancelar o veículo exige o motivo.');
    const ativos = await ativosDoVeiculo(tx, veiculoId);
    await tx.$executeRaw`UPDATE palete_embarque SET situacao = 'CANCELADO', motivo_cancelamento = ${`Veículo cancelado: ${dados.reason}`}, versao = versao + 1, atualizado_em = ${agora}
                          WHERE veiculo_id = ${veiculoId}::uuid AND situacao = 'ATIVO'`;
    await tx.$executeRaw`UPDATE veiculo_carga SET situacao = 'CANCELADO', versao = versao + 1, atualizado_em = ${agora} WHERE id = ${veiculoId}::uuid`;
    await historico(tx, escopo.id, veiculoId, null, 'VEICULO_CANCELADO', { motivo: dados.reason, paletes: ativos.length }, autor, agora);
  }
  return v.janela_id;
}

// ---------- Paletes de embarque ----------

export async function criarPalete(tx: Transacao, escopo: Escopo, veiculoId: string, dados: Saida<typeof CriarPaleteEmbarqueSchema>, autor: Autor, agora: Date): Promise<string> {
  const v = await travarVeiculo(tx, escopo.id, veiculoId);
  exigirMontagem(v, 'Veículo');
  const ativos = await ativosDoVeiculo(tx, veiculoId);
  if (ativos.length >= v.capacidade) throw conflito(`O veículo já tem ${String(v.capacidade)} paletes: capacidade completa.`);
  const numero = dados.number ?? proximoNumero(v, ativos);
  if (numero > v.capacidade) throw requisicaoInvalida(`Número ${String(numero)} acima da capacidade do veículo (01 a ${String(v.capacidade).padStart(2, '0')}).`);
  if (ativos.some((a) => a.numero === numero)) throw conflito(`O ${rotuloPaleteEmbarque(numero)} já existe neste veículo. Escolha outro número.`);
  if (dados.position !== null) validarPosicao(v, dados.position, ativos, null);
  const linhas =
    dados.kind === 'FULL'
      ? await linhasDoFull(tx, escopo.id, v.janela_id, dados.sourcePalletId ?? '', null)
      : await prepararLinhas(
          tx,
          escopo.id,
          v.janela_id,
          dados.lines.map((l) => ({ ref: l.occurrence, volumes: l.volumes })),
          null,
        );
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO palete_embarque (id, escopo_id, veiculo_id, numero, posicao, tipo, palete_origem_id, criado_por_id, criado_em, atualizado_em)
    VALUES (${id}::uuid, ${escopo.id}::uuid, ${veiculoId}::uuid, ${numero}, ${dados.position}, ${dados.kind},
            ${dados.kind === 'FULL' ? dados.sourcePalletId : null}::uuid, ${autor.usuarioId}::uuid, ${agora}, ${agora})`;
  await gravarLinhas(tx, escopo.id, id, linhas);
  await historico(
    tx,
    escopo.id,
    veiculoId,
    id,
    'PALETE_CRIADO',
    { numero, tipo: dados.kind, posicao: dados.position, origem: linhas[0]?.paleteOrigemCodigo ?? null, linhas: linhas.map((l) => ({ nf: l.numero, origem: l.paleteOrigemCodigo, volumes: l.volumes })) },
    autor,
    agora,
  );
  return v.janela_id;
}

/** Onde cada ocorrência já está nos paletes de embarque ativos da janela (identidade e volumes). */
async function jaNaJanela(tx: Transacao, escopoId: string, janelaId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const linhas = await tx.$queryRaw<{ alvo: string; codigo: string; tipo: TipoVeiculo; sequencia: number; numero: number }[]>`
    SELECT DISTINCT ON (coalesce(l.conteudo_id, l.vinculo_id)) coalesce(l.conteudo_id, l.vinculo_id)::text AS alvo, j.codigo, v.tipo, v.sequencia, pe.numero
      FROM linha_palete_embarque l
      JOIN palete_embarque pe ON pe.id = l.palete_embarque_id
      JOIN veiculo_carga v ON v.id = pe.veiculo_id
      JOIN janela_devolucao j ON j.id = v.janela_id
     WHERE l.escopo_id = ${escopoId}::uuid AND coalesce(l.conteudo_id, l.vinculo_id) = ANY(${ids}::uuid[])
       AND l.removida_em IS NULL AND pe.situacao = 'ATIVO' AND v.situacao <> 'CANCELADO' AND v.janela_id = ${janelaId}::uuid
     ORDER BY coalesce(l.conteudo_id, l.vinculo_id), pe.criado_em`;
  return new Map(linhas.map((l) => [l.alvo, identidadeEmbarque(l.codigo, l.tipo, l.sequencia, l.numero)]));
}

export interface InclusaoNotas {
  janelaId: string;
  added: { occurrence: RefOcorrencia; documentType: string | null; documentNumber: string | null; sourcePalletCode: string; volumes: number }[];
  skipped: { occurrence: RefOcorrencia; documentType: string | null; documentNumber: string | null; sourcePalletCode: string; identity: string }[];
  pallet: { id: string; label: string; identity: string; created: boolean };
}

/**
 * Inclusão por nota (ficha do palete): só as ocorrências pedidas, pelo ID
 * estável, todas do palete de origem informado. Nunca expande para o palete
 * inteiro (isso é o FULL de `criarPalete`). Ocorrência já na seleção desta
 * janela não entra de novo nem tem a quantidade sobrescrita; se todas já
 * estavam, é conflito (nada muda). As demais validações são as do fracionado
 * (`prepararLinhas`: na praça, sem FULL ativo, volumes conhecidos e
 * disponíveis). Destino: fracionado existente do veículo (versão vista) ou um
 * fracionado novo. Nada baixa estoque.
 */
export async function incluirNotas(tx: Transacao, escopo: Escopo, veiculoId: string, dados: Saida<typeof IncluirNotasEmbarqueSchema>, autor: Autor, agora: Date): Promise<InclusaoNotas> {
  const v = await travarVeiculo(tx, escopo.id, veiculoId);
  exigirMontagem(v, 'Veículo');
  let destino: PaleteTravado | null = null;
  if (dados.targetPalletId !== null) {
    const t = await travarPalete(tx, escopo.id, dados.targetPalletId);
    if (t.v.id !== v.id) throw new ErroHttp(409, 'CONFLITO_VERSAO', 'O palete de destino mudou de veículo. Atualize a lista e escolha de novo.');
    destino = t.p;
    if (destino.situacao !== 'ATIVO') throw conflito(`O ${rotuloPaleteEmbarque(destino.numero)} foi cancelado: escolha outro destino.`);
    if (destino.tipo !== 'FRACIONADO') throw conflito(`O ${rotuloPaleteEmbarque(destino.numero)} é FULL (leva um palete inteiro): a nota entra num fracionado.`);
    exigirVersao(destino.versao, dados.expectedVersion ?? 0, `O ${rotuloPaleteEmbarque(destino.numero)}`);
  }
  const origens = await travarOrigens(tx, escopo.id, [dados.sourcePalletId]);
  const origem = origens.get(dados.sourcePalletId);
  const refs = dados.lines.map((l) => l.occurrence);
  const ocorrencias = await lerOcorrencias(tx, escopo.id, refs);
  // Cada nota precisa existir, ser do tipo informado e estar no palete de origem informado: nada de achar "a mesma NF" em outro palete.
  for (const r of refs) {
    const o = ocorrencias.get(r.id);
    if (o?.kind !== r.kind) throw naoEncontrado('Nota não encontrada neste escopo (identificação inválida ou removida). Nada foi incluído; atualize a ficha do palete.');
    if (o.palletId !== dados.sourcePalletId) throw conflito(`A ${o.documentType ?? 'nota'} ${o.documentNumber ?? 'sem número'} não está no palete ${origem?.codigo ?? ''}: nada foi incluído. Atualize a ficha do palete.`);
  }
  const ja = await jaNaJanela(
    tx,
    escopo.id,
    v.janela_id,
    refs.map((r) => r.id),
  );
  const nota = (r: RefOcorrencia) => {
    const o = ocorrencias.get(r.id);
    return { occurrence: r, documentType: o?.documentType ?? null, documentNumber: o?.documentNumber ?? null, sourcePalletCode: o?.palletCode ?? origem?.codigo ?? '' };
  };
  const skipped = refs.flatMap((r) => {
    const onde = ja.get(r.id);
    return onde === undefined ? [] : [{ ...nota(r), identity: onde }];
  });
  const novas = dados.lines.filter((l) => !ja.has(l.occurrence.id));
  if (novas.length === 0) {
    const [s] = skipped;
    throw new ErroHttp(
      409,
      'CONFLITO',
      skipped.length === 1 && s
        ? `${s.documentType ?? 'Nota'} ${s.documentNumber ?? 'sem número'} já está na expedição (${s.identity}). Nada mudou; para alterar os volumes, edite esse palete na Expedição.`
        : `As ${String(skipped.length)} notas já estão na expedição desta janela. Nada mudou.`,
    );
  }
  // Volumes: o pedido (parcial) ou todo o disponível para esta janela.
  const bases = new Map([...ocorrencias.values()].map((o) => [o.id, o.base]));
  const disp = await disponibilidade(
    tx,
    escopo.id,
    v.janela_id,
    novas.map((l) => l.occurrence.id),
    bases,
    null,
  );
  const pedidas = novas.map((l) => {
    const o = ocorrencias.get(l.occurrence.id);
    const descricao = `${o?.documentType ?? 'Nota'} ${o?.documentNumber ?? 'sem número'}`;
    const disponivel = disp.get(l.occurrence.id)?.available ?? null;
    if (l.volumes !== null) return { ref: l.occurrence, volumes: l.volumes };
    if (disponivel === null) throw conflito(`${descricao}: volumes não informados. Registre a contagem na conferência de volumes antes de embarcar.`);
    if (disponivel <= 0) throw conflito(`${descricao}: nenhum volume disponível (já está em outro palete de embarque ou expedido).`);
    return { ref: l.occurrence, volumes: disponivel };
  });
  const linhas = await prepararLinhas(tx, escopo.id, v.janela_id, pedidas, null);
  const j = await lerJanelaCarga(tx, escopo.id, v.janela_id);
  const detalhesLinhas = linhas.map((l) => ({ nf: l.numero, origem: l.paleteOrigemCodigo, volumes: l.volumes }));
  let pallet: InclusaoNotas['pallet'];
  if (destino === null) {
    const ativos = await ativosDoVeiculo(tx, v.id);
    if (ativos.length >= v.capacidade) throw conflito(`O veículo já tem ${String(v.capacidade)} paletes: capacidade completa. Escolha um fracionado existente.`);
    const numero = proximoNumero(v, ativos);
    const id = randomUUID();
    await tx.$executeRaw`
      INSERT INTO palete_embarque (id, escopo_id, veiculo_id, numero, posicao, tipo, palete_origem_id, criado_por_id, criado_em, atualizado_em)
      VALUES (${id}::uuid, ${escopo.id}::uuid, ${v.id}::uuid, ${numero}, NULL, 'FRACIONADO', NULL, ${autor.usuarioId}::uuid, ${agora}, ${agora})`;
    await gravarLinhas(tx, escopo.id, id, linhas);
    await historico(tx, escopo.id, v.id, id, 'PALETE_CRIADO', { numero, tipo: 'FRACIONADO', posicao: null, inclusao: 'POR_NOTA', origem: origem?.codigo ?? null, linhas: detalhesLinhas }, autor, agora);
    pallet = { id, label: rotuloPaleteEmbarque(numero), identity: identidadeEmbarque(j.codigo, v.tipo, v.sequencia, numero), created: true };
  } else {
    const [m] = await tx.$queryRaw<{ ordem: number }[]>`SELECT coalesce(max(ordem), 0)::int AS ordem FROM linha_palete_embarque WHERE palete_embarque_id = ${destino.id}::uuid`;
    let ordem = m?.ordem ?? 0;
    for (const l of linhas) {
      ordem++;
      await tx.$executeRaw`
        INSERT INTO linha_palete_embarque (id, escopo_id, palete_embarque_id, vinculo_id, conteudo_id, palete_origem_id, palete_origem_codigo, volumes,
                                           tipo_documento, numero_documento, remetente, delivery, ordem)
        VALUES (${randomUUID()}::uuid, ${escopo.id}::uuid, ${destino.id}::uuid,
                ${l.ref.kind === 'VINCULO' ? l.ref.id : null}::uuid, ${l.ref.kind === 'CONTEUDO' ? l.ref.id : null}::uuid,
                ${l.paleteOrigemId}::uuid, ${l.paleteOrigemCodigo}, ${l.volumes}, ${l.tipo}, ${l.numero}, ${l.remetente}, ${l.delivery}, ${ordem})`;
    }
    // Conteúdo mudou: revisão nova (físico, documentação e espelho deste palete são revistos), como em "Alterar NFs".
    await tx.$executeRaw`UPDATE palete_embarque SET revisao = revisao + 1, versao = versao + 1, atualizado_em = ${agora} WHERE id = ${destino.id}::uuid`;
    await historico(
      tx,
      escopo.id,
      v.id,
      destino.id,
      'CONTEUDO_ALTERADO',
      { numero: destino.numero, revisaoAnterior: destino.revisao, revisaoNova: destino.revisao + 1, inclusao: 'POR_NOTA', acrescentadas: detalhesLinhas },
      autor,
      agora,
    );
    pallet = { id: destino.id, label: rotuloPaleteEmbarque(destino.numero), identity: identidadeEmbarque(j.codigo, v.tipo, v.sequencia, destino.numero), created: false };
  }
  return {
    janelaId: v.janela_id,
    added: linhas.map((l) => ({ ...nota(l.ref), volumes: l.volumes })),
    skipped,
    pallet,
  };
}

export async function moverPosicao(tx: Transacao, escopo: Escopo, paleteId: string, dados: Saida<typeof PosicaoEmbarqueSchema>, autor: Autor, agora: Date): Promise<string> {
  const { p, v } = await travarPalete(tx, escopo.id, paleteId);
  exigirMontagem(v, rotuloDo(v, p.numero));
  if (p.situacao !== 'ATIVO') throw conflito('Palete de embarque cancelado.');
  exigirVersao(p.versao, dados.expectedVersion, `O ${rotuloPaleteEmbarque(p.numero)}`);
  if (dados.position === p.posicao) return v.janela_id;
  if (dados.position !== null) validarPosicao(v, dados.position, await ativosDoVeiculo(tx, v.id), p.id);
  // Mudar de lugar zera a confirmação (a nova posição precisa ser confirmada no carregamento). Conteúdo e número não mudam.
  await tx.$executeRaw`
    UPDATE palete_embarque SET posicao = ${dados.position}, posicao_confirmada = false, posicao_confirmada_por_id = NULL, posicao_confirmada_em = NULL,
           versao = versao + 1, atualizado_em = ${agora}
     WHERE id = ${paleteId}::uuid`;
  await historico(tx, escopo.id, v.id, p.id, 'POSICAO_ALTERADA', { numero: p.numero, de: p.posicao, para: dados.position }, autor, agora);
  return v.janela_id;
}

export async function confirmarPosicao(tx: Transacao, escopo: Escopo, paleteId: string, dados: Saida<typeof ConfirmarPosicaoSchema>, autor: Autor, agora: Date): Promise<string> {
  const { p, v } = await travarPalete(tx, escopo.id, paleteId);
  exigirMontagem(v, rotuloDo(v, p.numero));
  if (p.situacao !== 'ATIVO') throw conflito('Palete de embarque cancelado.');
  exigirVersao(p.versao, dados.expectedVersion, `O ${rotuloPaleteEmbarque(p.numero)}`);
  if (dados.confirmed && p.posicao === null) throw conflito('Defina a posição no veículo antes de confirmar o carregamento.');
  if (dados.confirmed === p.posicao_confirmada) return v.janela_id;
  await tx.$executeRaw`
    UPDATE palete_embarque SET posicao_confirmada = ${dados.confirmed},
           posicao_confirmada_por_id = ${dados.confirmed ? autor.usuarioId : null}::uuid, posicao_confirmada_em = ${dados.confirmed ? agora : null},
           versao = versao + 1, atualizado_em = ${agora}
     WHERE id = ${paleteId}::uuid`;
  await historico(tx, escopo.id, v.id, p.id, dados.confirmed ? 'POSICAO_CONFIRMADA' : 'POSICAO_DESCONFIRMADA', { numero: p.numero, posicao: p.posicao }, autor, agora);
  return v.janela_id;
}

export async function transferirPalete(tx: Transacao, escopo: Escopo, paleteId: string, dados: Saida<typeof TransferirEmbarqueSchema>, autor: Autor, agora: Date): Promise<string> {
  const [ref] = await tx.$queryRaw<{ veiculo_id: string }[]>`SELECT veiculo_id::text FROM palete_embarque WHERE id = ${paleteId}::uuid AND escopo_id = ${escopo.id}::uuid`;
  if (!ref) throw naoEncontrado('Palete de embarque não encontrado neste escopo.');
  if (ref.veiculo_id === dados.vehicleId) throw requisicaoInvalida('O palete já está neste veículo: use "Mover" para trocar de posição.');
  // Trava os dois veículos em ordem de id.
  const [primeiro, segundo] = [ref.veiculo_id, dados.vehicleId].sort();
  const t1 = await travarVeiculo(tx, escopo.id, primeiro ?? '');
  const t2 = await travarVeiculo(tx, escopo.id, segundo ?? '');
  const origem = t1.id === ref.veiculo_id ? t1 : t2;
  const destino = t1.id === dados.vehicleId ? t1 : t2;
  const { p } = await travarPalete(tx, escopo.id, paleteId);
  exigirMontagem(origem, rotuloDo(origem, p.numero));
  exigirMontagem(destino, 'Veículo de destino');
  if (destino.janela_id !== origem.janela_id) throw conflito('A transferência é só entre veículos da mesma janela.');
  if (p.situacao !== 'ATIVO') throw conflito('Palete de embarque cancelado.');
  exigirVersao(p.versao, dados.expectedVersion, `O ${rotuloPaleteEmbarque(p.numero)}`);
  const ativos = await ativosDoVeiculo(tx, destino.id);
  if (ativos.length >= destino.capacidade) throw conflito(`O veículo de destino já tem ${String(destino.capacidade)} paletes: capacidade completa.`);
  const livre = (n: number) => n <= destino.capacidade && !ativos.some((a) => a.numero === n);
  const numero = dados.number ?? (livre(p.numero) ? p.numero : proximoNumero(destino, ativos));
  if (!livre(numero)) throw conflito(`O ${rotuloPaleteEmbarque(numero)} já existe no veículo de destino (ou passa da capacidade).`);
  await tx.$executeRaw`
    UPDATE palete_embarque SET veiculo_id = ${destino.id}::uuid, numero = ${numero}, posicao = NULL, posicao_confirmada = false,
           posicao_confirmada_por_id = NULL, posicao_confirmada_em = NULL, versao = versao + 1, atualizado_em = ${agora}
     WHERE id = ${paleteId}::uuid`;
  const j = await lerJanelaCarga(tx, escopo.id, origem.janela_id);
  const antes = identidadeEmbarque(j.codigo, origem.tipo, origem.sequencia, p.numero);
  const depois = identidadeEmbarque(j.codigo, destino.tipo, destino.sequencia, numero);
  const detalhes = { de: antes, para: depois, reimprimir: 'Etiqueta, espelho e lista de documentos com a identidade anterior ficam desatualizados: reemita.' };
  await historico(tx, escopo.id, origem.id, p.id, 'PALETE_TRANSFERIDO', detalhes, autor, agora);
  await historico(tx, escopo.id, destino.id, p.id, 'PALETE_TRANSFERIDO', detalhes, autor, agora);
  return origem.janela_id;
}

/** Fracionado: troca as NFs/volumes. FULL: recarrega do palete de origem. Mudança abre revisão nova. */
export async function alterarLinhas(tx: Transacao, escopo: Escopo, paleteId: string, dados: Saida<typeof AlterarLinhasEmbarqueSchema> | { expectedVersion: number; lines: null }, autor: Autor, agora: Date): Promise<string> {
  const { p, v } = await travarPalete(tx, escopo.id, paleteId);
  exigirMontagem(v, rotuloDo(v, p.numero));
  if (p.situacao !== 'ATIVO') throw conflito('Palete de embarque cancelado.');
  exigirVersao(p.versao, dados.expectedVersion, `O ${rotuloPaleteEmbarque(p.numero)}`);
  let novas: LinhaPronta[];
  if (dados.lines === null) {
    if (p.tipo !== 'FULL' || p.palete_origem_id === null) throw requisicaoInvalida('Só um FULL é recarregado do palete de origem.');
    novas = await linhasDoFull(tx, escopo.id, v.janela_id, p.palete_origem_id, p.id);
  } else {
    if (p.tipo === 'FULL') throw conflito('FULL leva o palete de origem inteiro: use "Recarregar do palete de origem".');
    novas = await prepararLinhas(
      tx,
      escopo.id,
      v.janela_id,
      dados.lines.map((l) => ({ ref: l.occurrence, volumes: l.volumes })),
      p.id,
    );
  }
  const r = await substituirLinhas(tx, escopo.id, p.id, novas, agora);
  if (!r.mudou) return v.janela_id;
  // Revisão nova: físico, documentação e espelho deste palete precisam ser revistos (os outros paletes não mudam).
  await tx.$executeRaw`UPDATE palete_embarque SET revisao = revisao + 1, versao = versao + 1, atualizado_em = ${agora} WHERE id = ${paleteId}::uuid`;
  await historico(
    tx,
    escopo.id,
    v.id,
    p.id,
    'CONTEUDO_ALTERADO',
    { numero: p.numero, revisaoAnterior: p.revisao, revisaoNova: p.revisao + 1, antes: r.antes, depois: novas.map((l) => ({ alvo: l.ref.id, nf: l.numero, volumes: l.volumes })) },
    autor,
    agora,
  );
  return v.janela_id;
}

export async function marcarFisico(tx: Transacao, escopo: Escopo, paleteId: string, dados: Saida<typeof FisicoConferidoSchema>, autor: Autor, agora: Date): Promise<string> {
  const { p, v } = await travarPalete(tx, escopo.id, paleteId);
  exigirMontagem(v, rotuloDo(v, p.numero));
  if (p.situacao !== 'ATIVO') throw conflito('Palete de embarque cancelado.');
  exigirVersao(p.versao, dados.expectedVersion, `O ${rotuloPaleteEmbarque(p.numero)}`);
  if (dados.revision !== p.revisao) throw new ErroHttp(409, 'CONFLITO_VERSAO', `O conteúdo do ${rotuloPaleteEmbarque(p.numero)} mudou (revisão ${String(p.revisao)}). Confira de novo a versão atual.`);
  if (p.fisico_revisao === p.revisao) return v.janela_id;
  const [n] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM linha_palete_embarque WHERE palete_embarque_id = ${paleteId}::uuid AND removida_em IS NULL`;
  if (Number(n?.n ?? 0) === 0) throw conflito('Palete sem NFs: nada a conferir.');
  await tx.$executeRaw`
    UPDATE palete_embarque SET fisico_revisao = revisao, fisico_por_id = ${autor.usuarioId}::uuid, fisico_em = ${agora}, versao = versao + 1, atualizado_em = ${agora}
     WHERE id = ${paleteId}::uuid`;
  await historico(tx, escopo.id, v.id, p.id, 'FISICO_CONFERIDO', { numero: p.numero, revisao: p.revisao }, autor, agora);
  return v.janela_id;
}

export async function conferirDocumento(tx: Transacao, escopo: Escopo, paleteId: string, dados: Saida<typeof ConferirDocumentoSchema>, autor: Autor, agora: Date): Promise<string> {
  const { p, v } = await travarPalete(tx, escopo.id, paleteId);
  exigirMontagem(v, rotuloDo(v, p.numero));
  if (p.situacao !== 'ATIVO') throw conflito('Palete de embarque cancelado.');
  if (dados.revision !== p.revisao) throw new ErroHttp(409, 'CONFLITO_VERSAO', `O conteúdo do ${rotuloPaleteEmbarque(p.numero)} mudou (revisão ${String(p.revisao)}). Recarregue: a conferência vale para a versão atual.`);
  if (p.fisico_revisao !== p.revisao) throw conflito(`O ${rotuloPaleteEmbarque(p.numero)} ainda não teve o físico conferido nesta revisão: a documentação espera a operação.`);
  const [linha] = await tx.$queryRaw<{ numero: string | null }[]>`
    SELECT numero_documento AS numero FROM linha_palete_embarque WHERE id = ${dados.lineId}::uuid AND palete_embarque_id = ${paleteId}::uuid AND removida_em IS NULL`;
  if (!linha) throw naoEncontrado('NF não encontrada neste palete de embarque.');
  await tx.$executeRaw`
    INSERT INTO documento_embarque (id, escopo_id, palete_embarque_id, linha_id, revisao, situacao, observacao, autor_id, registrado_em)
    VALUES (${randomUUID()}::uuid, ${escopo.id}::uuid, ${paleteId}::uuid, ${dados.lineId}::uuid, ${p.revisao}, ${dados.state}, ${dados.note}, ${autor.usuarioId}::uuid, ${agora})`;
  // A conferência documental não muda versão nem quantidades do palete.
  await historico(tx, escopo.id, v.id, p.id, 'DOCUMENTO_CONFERIDO', { numero: p.numero, nf: linha.numero, situacao: dados.state, observacao: dados.note, revisao: p.revisao }, autor, agora);
  return v.janela_id;
}

export async function cancelarPalete(tx: Transacao, escopo: Escopo, paleteId: string, dados: Saida<typeof CancelarEmbarqueSchema>, autor: Autor, agora: Date): Promise<string> {
  const { p, v } = await travarPalete(tx, escopo.id, paleteId);
  exigirMontagem(v, rotuloDo(v, p.numero));
  if (p.situacao !== 'ATIVO') throw conflito('Palete de embarque já cancelado.');
  exigirVersao(p.versao, dados.expectedVersion, `O ${rotuloPaleteEmbarque(p.numero)}`);
  await tx.$executeRaw`
    UPDATE palete_embarque SET situacao = 'CANCELADO', motivo_cancelamento = ${dados.reason}, posicao_confirmada = false, versao = versao + 1, atualizado_em = ${agora}
     WHERE id = ${paleteId}::uuid`;
  await historico(tx, escopo.id, v.id, p.id, 'PALETE_CANCELADO', { numero: p.numero, motivo: dados.reason }, autor, agora);
  return v.janela_id;
}

// ---------- Emissões ----------

export async function emitirPalete(tx: Transacao, escopo: Escopo, paleteId: string, dados: Saida<typeof EmitirSchema>, autor: Autor, agora: Date): Promise<string> {
  if (dados.kind === 'MAPA') throw requisicaoInvalida('O mapa é emitido pelo veículo.');
  const { p, v } = await travarPalete(tx, escopo.id, paleteId);
  if (p.situacao !== 'ATIVO') throw conflito('Palete de embarque cancelado: nada a emitir.');
  if (dados.final && dados.kind === 'ESPELHO' && p.fisico_revisao !== p.revisao) {
    throw conflito(`Espelho final do ${rotuloPaleteEmbarque(p.numero)} só depois do físico conferido nesta revisão. Emita como rascunho para conferir.`);
  }
  const j = await lerJanelaCarga(tx, escopo.id, v.janela_id);
  const identidade = identidadeEmbarque(j.codigo, v.tipo, v.sequencia, p.numero);
  const linhas = await tx.$queryRaw<{ numero: string | null; volumes: number }[]>`
    SELECT numero_documento AS numero, volumes FROM linha_palete_embarque WHERE palete_embarque_id = ${paleteId}::uuid AND removida_em IS NULL ORDER BY ordem`;
  await tx.$executeRaw`
    INSERT INTO emissao_embarque (id, escopo_id, veiculo_id, palete_embarque_id, tipo, final, revisao, identidade, fotografia, autor_id, emitido_em)
    VALUES (${randomUUID()}::uuid, ${escopo.id}::uuid, ${v.id}::uuid, ${paleteId}::uuid, ${dados.kind}, ${dados.final}, ${p.revisao}, ${identidade},
            ${JSON.stringify({ linhas })}::jsonb, ${autor.usuarioId}::uuid, ${agora})`;
  await historico(tx, escopo.id, v.id, p.id, 'EMISSAO', { tipo: dados.kind, final: dados.final, revisao: p.revisao, identidade }, autor, agora);
  return v.janela_id;
}

export async function emitirMapa(tx: Transacao, escopo: Escopo, veiculoId: string, dados: Saida<typeof EmitirSchema>, autor: Autor, agora: Date): Promise<string> {
  if (dados.kind !== 'MAPA') throw requisicaoInvalida('Pelo veículo só se emite o mapa da carga.');
  const v = await travarVeiculo(tx, escopo.id, veiculoId);
  if (v.situacao === 'CANCELADO') throw conflito('Veículo cancelado: nada a emitir.');
  const paletes = await tx.$queryRaw<{ numero: number; posicao: number | null; posicao_confirmada: boolean; situacao: string }[]>`
    SELECT numero, posicao, posicao_confirmada, situacao FROM palete_embarque WHERE veiculo_id = ${veiculoId}::uuid AND situacao = 'ATIVO'`;
  if (dados.final) {
    if (paletes.length === 0) throw conflito('Mapa final sem paletes na carga.');
    const faltam = paletes.filter((p) => !p.posicao_confirmada);
    if (faltam.length > 0) throw conflito(`Mapa final reflete só posições confirmadas no carregamento: ${String(faltam.length)} palete(s) ainda sem confirmação. Emita a prévia ou confirme as posições.`);
  }
  const j = await lerJanelaCarga(tx, escopo.id, v.janela_id);
  const identidade = `Janela ${j.codigo} · ${v.tipo === 'CARRETA' ? 'Carreta' : 'Truck'} ${String(v.sequencia).padStart(2, '0')}`;
  await tx.$executeRaw`
    INSERT INTO emissao_embarque (id, escopo_id, veiculo_id, palete_embarque_id, tipo, final, revisao, identidade, fotografia, autor_id, emitido_em)
    VALUES (${randomUUID()}::uuid, ${escopo.id}::uuid, ${veiculoId}::uuid, NULL, 'MAPA', ${dados.final}, NULL, ${identidade},
            ${JSON.stringify({ posicoes: fotografiaMapa(paletes, dados.final) })}::jsonb, ${autor.usuarioId}::uuid, ${agora})`;
  await historico(tx, escopo.id, veiculoId, null, 'EMISSAO', { tipo: 'MAPA', final: dados.final, identidade }, autor, agora);
  return v.janela_id;
}
