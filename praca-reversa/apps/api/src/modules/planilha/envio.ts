/**
 * Publicação de uma revisão no destino independente (26 out. 2026), dentro
 * da concessão do escopo. Só a revisão gerada mais recente é enviada (as
 * intermediárias já foram superadas; o histórico está nas Movimentações).
 *
 * Ordem no destino (planilha/<base>/):
 * 1. o manifesto atual é lido: revisão igual ou mais nova lá = nada a enviar
 *    (idempotente) ou recusa (uma revisão antiga nunca sobrescreve a nova);
 * 2. as cópias da revisão vão para versoes/ (nome com revisão, data e lote),
 *    cada uma relida e conferida pelo SHA-256, mais o manifesto da versão;
 * 3. só então o arquivo de nome estável e, por último, o manifesto atual;
 * 4. registro CONFIRMADO (uma vez por revisão) e retenção das versões.
 * Falha: nada no banco muda além do registro da falha e da espera crescente;
 * a cópia anterior continua no destino.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Banco, Transacao } from '../../db/cliente.js';
import type { ConfigPlanilha } from '../protecao/configuracao.js';
import { sha256, type Destino } from '../protecao/destino.js';
import { TIPO_XLSX, lerConferido, lerNomeVersao, pastaVersoes, revisoesAManter } from './arquivos.js';
import { esperaDaFalha, mensagemDe, type Concessao, type Simulacao } from './geracao.js';
import { baseDoNome } from './montar.js';

export interface ResultadoEnvio {
  situacao: 'PUBLICADA' | 'EM_DIA' | 'NAO_CONFIGURADO' | 'FALHOU';
  revisao: number | null;
  erro: string | null;
}

export class RevisaoAntigaError extends Error {
  constructor(
    readonly noDestino: number,
    readonly tentada: number,
  ) {
    super(`O destino já tem a revisão ${String(noDestino)}; a revisão ${String(tentada)} é mais antiga e não sobrescreve.`);
  }
}

interface ArquivoRegistrado {
  papel: string;
  nome: string;
  sha256: string;
  tamanho: number;
  eventos?: number;
}

export interface ManifestoPlanilha {
  formato: 'praca-reversa-planilha';
  versaoFormato: 1;
  escopo: { unidade: string; cliente: string };
  revisao: number;
  arquivo: string;
  versao: string;
  sha256: string;
  tamanho: number;
  dadosEm: string;
  geradoEm: string;
  publicadoEm: string;
  loteAtivo: string | null;
  antesDaSubstituicao: boolean;
  arquivos: { papel: string; chave: string; sha256: string; tamanho: number }[];
}

const json = (x: unknown) => Buffer.from(`${JSON.stringify(x, null, 2)}\n`, 'utf8');
export const prefixoPlanilha = (base: string) => `planilha/${base}/`;

export async function lerManifesto(destino: Destino, chave: string): Promise<ManifestoPlanilha | null> {
  const b = await destino.ler(chave);
  if (b === null) return null;
  try {
    const m = JSON.parse(b.toString('utf8')) as Partial<ManifestoPlanilha>;
    return typeof m.revisao === 'number' && typeof m.sha256 === 'string' ? (m as ManifestoPlanilha) : null;
  } catch {
    return null;
  }
}

/** Envia ao destino a revisão gerada mais recente, se ainda não estiver lá. */
export async function enviar(db: Banco, escopoId: string, config: ConfigPlanilha, concessao: Concessao, opcoes: { agora: () => Date; simular?: Simulacao }): Promise<ResultadoEnvio> {
  const { agora } = opcoes;
  const escopo = await db.escopo.findUniqueOrThrow({ where: { id: escopoId }, select: { demonstracao: true, unidade: { select: { codigo: true } }, cliente: { select: { codigo: true } } } });
  const destino = config.destino;
  if (escopo.demonstracao || !destino?.independente) return { situacao: 'NAO_CONFIGURADO', revisao: null, erro: null };
  const ultima = await db.geracaoPlanilha.findFirst({ where: { escopoId, situacao: 'GERADA' }, orderBy: { revisao: 'desc' } });
  if (ultima?.revisao == null || ultima.revisao <= concessao.revisaoPublicada) return { situacao: 'EM_DIA', revisao: concessao.revisaoPublicada || null, erro: null };
  const revisao = ultima.revisao;
  const confirmar = async (tx: Transacao) => {
    await tx.$executeRaw`
      UPDATE controle_planilha SET revisao_publicada = GREATEST(revisao_publicada, ${revisao}), envio_falhas = 0, envio_proxima_em = NULL, envio_ultima_falha = NULL, envio_ultima_falha_em = NULL
       WHERE escopo_id = ${escopoId}::uuid AND publicando_por = ${concessao.token}`;
  };
  // Idempotência: a mesma revisão já confirmada (tentativa anterior que caiu depois do registro).
  const ja = await db.envioExterno.findFirst({ where: { tipo: 'PLANILHA', escopoId, referencia: String(revisao), situacao: 'CONFIRMADO' }, select: { id: true } });
  if (ja) {
    await db.$transaction(confirmar);
    concessao.revisaoPublicada = Math.max(concessao.revisaoPublicada, revisao);
    return { situacao: 'EM_DIA', revisao, erro: null };
  }
  const base = baseDoNome(escopo.unidade.codigo, escopo.cliente.codigo);
  const prefixo = prefixoPlanilha(base);
  const id = randomUUID();
  await db.envioExterno.create({ data: { id, tipo: 'PLANILHA', escopoId, referencia: String(revisao), situacao: 'ENVIANDO', destinoTipo: destino.tipo, destino: destino.descricao, iniciadoEm: agora() } });
  try {
    if (opcoes.simular?.falharDestino) throw new Error(`Destino indisponível: ${destino.descricao} (simulado).`);
    const registrados = (Array.isArray(ultima.arquivos) ? ultima.arquivos : []) as unknown as ArquivoRegistrado[];
    const pasta = pastaVersoes(config, escopoId);
    const conteudos = registrados.map((a) => {
      const b = lerConferido(join(pasta, a.nome), a.sha256);
      if (b === null) throw new Error(`A cópia local da revisão ${String(revisao)} (${a.nome}) não existe mais: uma nova revisão será gerada.`);
      return { a, b };
    });
    const principal = conteudos[0];
    if (principal?.a.papel !== 'PRINCIPAL') throw new Error('Registro da revisão sem arquivo principal.');
    const atual = await lerManifesto(destino, `${prefixo}${base}.manifesto.json`);
    if (atual !== null && atual.revisao > revisao) throw new RevisaoAntigaError(atual.revisao, revisao);
    const versao = (nome: string) => `${prefixo}versoes/${nome}`;
    const manifesto: ManifestoPlanilha = {
      formato: 'praca-reversa-planilha',
      versaoFormato: 1,
      escopo: { unidade: escopo.unidade.codigo, cliente: escopo.cliente.codigo },
      revisao,
      arquivo: `${prefixo}${base}.xlsx`,
      versao: versao(principal.a.nome),
      sha256: principal.a.sha256,
      tamanho: principal.a.tamanho,
      dadosEm: ultima.instanteDados?.toISOString() ?? '',
      geradoEm: ultima.concluidoEm?.toISOString() ?? '',
      publicadoEm: agora().toISOString(),
      loteAtivo: ultima.loteAtivo,
      antesDaSubstituicao: ultima.preSubstituicao,
      arquivos: conteudos.map(({ a }) => ({ papel: a.papel, chave: versao(a.nome), sha256: a.sha256, tamanho: a.tamanho })),
    };
    if (atual?.revisao !== revisao || atual.sha256 !== principal.a.sha256) {
      for (const { a, b } of conteudos) await destino.gravar(versao(a.nome), b, TIPO_XLSX);
      await destino.gravar(versao(principal.a.nome.replace(/\.xlsx$/, '.manifesto.json')), json(manifesto), 'application/json');
      await destino.gravar(`${prefixo}${base}.xlsx`, principal.b, TIPO_XLSX);
      await destino.gravar(`${prefixo}${base}.manifesto.json`, json(manifesto), 'application/json');
    }
    // Confirmação final: o manifesto atual no destino aponta esta revisão com o mesmo conteúdo.
    const confere = await lerManifesto(destino, `${prefixo}${base}.manifesto.json`);
    const arquivoAtual = await destino.ler(`${prefixo}${base}.xlsx`);
    if (confere?.revisao !== revisao || arquivoAtual === null || sha256(arquivoAtual) !== principal.a.sha256) throw new Error('O destino não confirmou a revisão publicada (manifesto ou arquivo atual diferente).');
    await db.$transaction(async (tx) => {
      await tx.envioExterno.update({
        where: { id },
        data: {
          situacao: 'CONFIRMADO',
          concluidoEm: agora(),
          chave: versao(principal.a.nome),
          hash: principal.a.sha256,
          tamanhoBytes: BigInt(conteudos.reduce((t, x) => t + x.a.tamanho, 0)),
          arquivos: conteudos.length,
          detalhes: { atual: `${prefixo}${base}.xlsx`, manifesto: `${prefixo}${base}.manifesto.json` },
        },
      });
      await confirmar(tx);
    });
    concessao.revisaoPublicada = revisao;
    await retencaoRemota(destino, base, config, agora(), revisao).catch(() => undefined);
    return { situacao: 'PUBLICADA', revisao, erro: null };
  } catch (erro) {
    const mensagem = mensagemDe(erro);
    await db.$transaction(async (tx) => {
      await tx.envioExterno.update({ where: { id }, data: { situacao: 'FALHOU', concluidoEm: agora(), erro: mensagem } });
      const [c] = await tx.$queryRaw<{ falhas: number }[]>`SELECT envio_falhas AS falhas FROM controle_planilha WHERE escopo_id = ${escopoId}::uuid FOR UPDATE`;
      const falhas = (c?.falhas ?? 0) + 1;
      await tx.$executeRaw`
        UPDATE controle_planilha SET envio_falhas = ${falhas}, envio_proxima_em = ${new Date(agora().getTime() + esperaDaFalha(falhas))}, envio_ultima_falha = ${mensagem}, envio_ultima_falha_em = ${agora()}
         WHERE escopo_id = ${escopoId}::uuid AND publicando_por = ${concessao.token}`;
      // Destino com revisão mais nova (ex.: banco restaurado de backup): a numeração passa dela e uma nova revisão é gerada.
      if (erro instanceof RevisaoAntigaError) {
        await tx.$executeRaw`UPDATE controle_planilha SET revisao_dados = GREATEST(revisao_dados, ${erro.noDestino}) WHERE escopo_id = ${escopoId}::uuid AND publicando_por = ${concessao.token}`;
        await tx.$executeRaw`INSERT INTO alteracao_planilha (escopo_id, origem) VALUES (${escopoId}::uuid, 'destino_com_revisao_mais_nova')`;
        concessao.revisaoDados = Math.max(concessao.revisaoDados, erro.noDestino);
      }
      if (/não existe mais|não confere com o registrado/.test(mensagem)) await tx.$executeRaw`INSERT INTO alteracao_planilha (escopo_id, origem) VALUES (${escopoId}::uuid, 'copia_local_invalida')`;
    });
    return { situacao: 'FALHOU', revisao, erro: mensagem };
  }
}

/** Retenção das versões no destino (nunca a atual publicada nem a mais nova). */
export async function retencaoRemota(destino: Destino, base: string, config: ConfigPlanilha, agora: Date, atual: number): Promise<string[]> {
  const prefixo = `${prefixoPlanilha(base)}versoes/`;
  const objetos = await destino.listar(prefixo);
  const lidos = objetos.flatMap((o) => {
    const v = lerNomeVersao(o.chave.slice(prefixo.length), base);
    return v ? [{ chave: o.chave, v }] : [];
  });
  const manter = revisoesAManter(
    lidos.map((x) => x.v),
    config.retencao,
    agora,
    new Set([atual]),
  );
  const apagar = lidos.filter((x) => !manter.has(x.v.revisao)).map((x) => x.chave);
  for (const c of apagar) await destino.apagar(c);
  return apagar;
}

/**
 * Reconciliação do destino: se o manifesto atual sumiu ou não confere com a
 * revisão registrada como publicada, a marca de publicada volta à revisão que
 * está lá (ou zero) e a revisão gerada mais recente é enviada de novo.
 */
export async function reconciliarDestino(db: Banco, escopoId: string, config: ConfigPlanilha, concessao: Concessao): Promise<boolean> {
  const destino = config.destino;
  if (destino === null || !destino.independente || concessao.revisaoPublicada === 0) return false;
  const escopo = await db.escopo.findUniqueOrThrow({ where: { id: escopoId }, select: { demonstracao: true, unidade: { select: { codigo: true } }, cliente: { select: { codigo: true } } } });
  if (escopo.demonstracao) return false;
  const base = baseDoNome(escopo.unidade.codigo, escopo.cliente.codigo);
  const m = await lerManifesto(destino, `${prefixoPlanilha(base)}${base}.manifesto.json`);
  const publicada = await db.geracaoPlanilha.findFirst({ where: { escopoId, revisao: concessao.revisaoPublicada }, select: { hashArquivo: true } });
  if (m !== null && m.revisao >= concessao.revisaoPublicada && (m.revisao !== concessao.revisaoPublicada || m.sha256 === publicada?.hashArquivo)) return false;
  const presente = m === null ? 0 : Math.min(m.revisao, concessao.revisaoPublicada - 1);
  await db.$executeRaw`UPDATE controle_planilha SET revisao_publicada = ${presente} WHERE escopo_id = ${escopoId}::uuid AND publicando_por = ${concessao.token}`;
  concessao.revisaoPublicada = presente;
  return true;
}
