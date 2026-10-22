/**
 * Snapshot da planilha única de um escopo: inventário (vínculo NFD × palete,
 * notas sem alocação), movimentações (eventos confirmados) e situação da
 * proteção, lidos numa única transação REPEATABLE READ READ ONLY — todas as
 * abas do mesmo instante, sem misturar endereços de momentos diferentes.
 *
 * Regras (as mesmas das notas do palete): palete full e "mais de um palete"
 * recalculados dos vínculos ativos; endereço livre do inventário vira nota sem
 * alocação (referência, nunca ocupação); volumes desconhecidos ficam vazios;
 * MI/tipo pendente não aparece como NFD. Falha de leitura propaga erro (nunca
 * vira planilha vazia); escopo sem registros é um resultado válido.
 */
import type { Banco } from '../../db/cliente.js';
import { identidadeDocumento, lerMarcadoresFull } from '../importacao/identidade.js';
import { ordemEndereco } from '../importacao/carga-lote.js';
import { LINHA_VIGENTE } from '../importacao/linhas-vigentes.js';

export interface LinhaInventarioPlanilha {
  endereco: string;
  palete: string | null;
  nfd: string | null;
  remetente: string | null;
  cidade: string | null;
  /** Decimal exato em texto; `null` = desconhecido (nunca zero). */
  volumes: string | null;
  paleteFull: 'Sim' | 'Não' | 'Não informado';
  maisDeUmPalete: 'Sim' | 'Não';
  produto: string | null;
  situacao: string;
  delivery: string | null;
  semAlocacao: boolean;
  /** Palete na praça sem nota vinculada (só conteúdo sem número, ou nada informado): não é vínculo. */
  semNota: boolean;
  identidade: string | null;
}

export interface EventoPlanilha {
  id: string;
  em: Date;
  alteracao: string;
  nfd: string | null;
  palete: string | null;
  origem: string | null;
  destino: string | null;
  responsavel: string | null;
  descricao: string;
}

export interface PublicacaoResumo {
  versao: number;
  situacao: string;
  concluidoEm: Date | null;
  instanteSnapshot: Date | null;
  identificacao: string | null;
  versaoAnterior: string | null;
  erro: string | null;
}

export interface ProtecaoResumo {
  tipo: string;
  situacao: string;
  concluidoEm: Date;
  identificador: string | null;
  tamanhoBytes: bigint | null;
  destino: string | null;
  foraDoServidor: boolean;
  ambiente: string | null;
  dados: string | null;
  mensagem: string | null;
}

export interface SnapshotPlanilha {
  escopo: { id: string; nome: string; unidade: string; unidadeNome: string; cliente: string; clienteNome: string; demonstracao: boolean };
  instante: Date;
  inventario: LinhaInventarioPlanilha[];
  eventos: EventoPlanilha[];
  /** Eventos omitidos por limite (os mais antigos) e o período coberto. */
  eventosTotal: number;
  alteracoesVistas: string[];
  pendentes: { quantidade: number; desde: Date | null };
  controle: { falhasSeguidas: number; ultimaFalha: string | null; ultimaFalhaEm: Date | null };
  ultimaPublicada: PublicacaoResumo | null;
  ultimaGerada: PublicacaoResumo | null;
  ultimaFalha: PublicacaoResumo | null;
  ultimoBackupVerificado: ProtecaoResumo | null;
  ultimoBackup: ProtecaoResumo | null;
  ultimoTesteRestauracao: ProtecaoResumo | null;
}

const ROTULO_CONFERENCIA: Readonly<Record<string, string>> = {
  NAO_CONFERIDO: 'Não conferido',
  PARCIAL: 'Conferência parcial',
  AGUARDANDO_VALIDACAO: 'Conferência aguardando validação',
  RECONCILIADO: 'Conferido e validado',
};

/** Ações de auditoria que entram em Movimentações (eventos operacionais confirmados). */
export const ACOES_MOVIMENTACAO: Readonly<Record<string, string>> = {
  PALETE_CADASTRADO: 'Cadastro de palete',
  PALETE_ALTERADO: 'Cadastro do palete alterado',
  PALETE_ARQUIVADO: 'Cadastro arquivado',
  PALETE_MOVIDO: 'Movimentação',
  MOVIMENTO_CORRIGIDO: 'Correção de movimentação',
  PALETE_VAZIO_RETIRADO: 'Palete vazio retirado',
  TRANSFERENCIA_REGISTRADA: 'Transferência',
  TRANSFERENCIA_CORRIGIDA: 'Correção de transferência',
  CONFERENCIA_CONCLUIDA: 'Conferência concluída',
  CONFERENCIA_RECONCILIADA: 'Conferência validada',
  CONFERENCIA_CANCELADA: 'Conferência cancelada',
  PRODUTO_CRIADO: 'Cadastro de produto',
  PRODUTO_ALTERADO: 'Produto alterado',
  NOTA_CIDADE_DESTINO_ALTERADA: 'Cidade destino informada',
  NOTA_PRODUTO_ALTERADO: 'Produto na caixa informado',
  NOTA_CAIXA_DESCRITA: 'Descrição de caixa',
  NOTA_CAIXA_RETIRADA: 'Descrição de caixa retirada',
  INVENTARIO_IMPORTADO: 'Inventário importado',
  BIPAGEM_IMPORTADA: 'Notas da bipagem importadas',
  POSICAO_LIVRE_CONFIRMADA: 'Posição confirmada livre',
  CONTEUDO_REGISTRADO: 'Conteúdo registrado',
  CONTEUDO_ALTERADO: 'Identificação do conteúdo completada',
  CONTAGEM_VOLUMES_REGISTRADA: 'Contagem de volumes',
  MATERIAL_LIBERADO: 'Material liberado',
  MATERIAL_LIBERACAO_REVOGADA: 'Liberação revogada',
  MATERIAL_BLOQUEADO: 'Material bloqueado',
  MATERIAL_DESBLOQUEADO: 'Material desbloqueado',
  PALETE_BLOQUEADO: 'Palete bloqueado',
  PALETE_DESBLOQUEADO: 'Palete desbloqueado',
  RESERVA_CRIADA: 'Reserva para janela',
  RESERVA_CANCELADA: 'Reserva cancelada',
  EXPEDICAO_CONFIRMADA: 'Saída (expedição)',
  EXPEDICAO_CORRIGIDA: 'Correção de saída',
  RETORNO_REGISTRADO: 'Retorno registrado',
};

type Detalhes = Record<string, unknown>;
const texto = (d: Detalhes, k: string): string | null => {
  const v = d[k];
  return typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;
};

function descreverEvento(acao: string, d: Detalhes): Pick<EventoPlanilha, 'nfd' | 'palete' | 'origem' | 'destino' | 'descricao'> {
  const palete = texto(d, 'codigo') ?? texto(d, 'palete');
  const documento = texto(d, 'documento');
  const nfd = documento?.startsWith('NFD ') ? documento.slice(4) : null;
  const base = { nfd, palete, origem: null as string | null, destino: null as string | null };
  const motivo = texto(d, 'motivo');
  switch (acao) {
    case 'PALETE_MOVIDO':
    case 'MOVIMENTO_CORRIGIDO':
      return { ...base, origem: texto(d, 'de') ?? 'Sem posição', destino: texto(d, 'para') ?? 'Sem posição', descricao: motivo ?? 'Mudança de localização registrada.' };
    case 'PALETE_VAZIO_RETIRADO':
      return { ...base, origem: texto(d, 'de'), destino: 'Retirado', descricao: motivo ?? 'Palete vazio retirado da posição.' };
    case 'PALETE_CADASTRADO':
      return { ...base, destino: texto(d, 'posicao') ?? 'Sem posição', descricao: `Palete cadastrado${texto(d, 'posicao') ? ` na posição ${texto(d, 'posicao') ?? ''}` : ' (localização pendente)'}.` };
    case 'NOTA_CIDADE_DESTINO_ALTERADA':
      return { ...base, descricao: `Cidade destino: "${texto(d, 'antes') ?? ''}" → "${texto(d, 'depois') ?? ''}".` };
    case 'NOTA_PRODUTO_ALTERADO':
      return { ...base, descricao: `Produto na caixa: "${texto(d, 'antes') ?? ''}" → "${texto(d, 'depois') ?? ''}".` };
    case 'NOTA_CAIXA_DESCRITA':
      return { ...base, descricao: `${texto(d, 'grupo') ?? 'Caixa'}: ${texto(d, 'descricao') ?? ''}` };
    case 'NOTA_CAIXA_RETIRADA':
      return { ...base, descricao: `${texto(d, 'grupo') ?? 'Caixa'} retirada: ${motivo ?? ''}` };
    case 'POSICAO_LIVRE_CONFIRMADA':
      return { ...base, palete: null, origem: texto(d, 'endereco') ?? texto(d, 'posicao'), descricao: `Palete livre confirmado no local${texto(d, 'observacao') ? `: ${texto(d, 'observacao') ?? ''}` : '.'}` };
    case 'CONTEUDO_REGISTRADO':
    case 'CONTEUDO_ALTERADO': {
      const doc = texto(d, 'numero');
      const tipo = texto(d, 'tipo');
      const delivery = texto(d, 'delivery');
      return {
        ...base,
        nfd: tipo === 'NFD' ? doc : null,
        descricao: `${texto(d, 'remetente') ?? ''} · ${doc ? `${tipo ?? 'Documento'} ${doc}` : 'Documento não informado'} · ${delivery ? `Delivery ${delivery}` : 'Delivery não informado'}`,
      };
    }
    case 'CONTAGEM_VOLUMES_REGISTRADA':
      return {
        ...base,
        descricao: `${texto(d, 'contados') ?? '?'} volume(s) ${texto(d, 'origem') === 'CONTAGEM_FISICA' ? 'contados no aplicativo' : texto(d, 'origem') === 'BIPAGEM' ? 'lidos na bipagem' : 'de contagem já feita'}${texto(d, 'previstos') ? ` · previsto ${texto(d, 'previstos') ?? ''}` : ' · previsto não informado'}${texto(d, 'referencia') ? ` (${texto(d, 'referencia') ?? ''})` : ''}.`,
      };
    case 'BIPAGEM_IMPORTADA':
      // Bipagem real (19 out. 2026): registros, leituras, volumes e o que mudou no palete; eventos anteriores mantêm o texto antigo.
      if (texto(d, 'registros') !== null) {
        return {
          ...base,
          palete: texto(d, 'palete'),
          descricao: `Bipagem (arquivo ${texto(d, 'arquivo') ?? ''}): ${texto(d, 'registros') ?? '0'} registro(s), ${texto(d, 'comLeitura') ?? '0'} com volumes lidos, ${texto(d, 'volumes') ?? '0'} volume(s); ${texto(d, 'conteudosNovos') ?? '0'} conteúdo(s) novo(s), ${texto(d, 'contagens') ?? '0'} contagem(ns) registrada(s).`,
        };
      }
      return { ...base, palete: texto(d, 'palete'), descricao: `${texto(d, 'codigo') ?? 'Bipagem'}:${texto(d, 'notas') ?? '0'} nota(s), ${texto(d, 'vinculos') ?? '0'} vínculo(s)${texto(d, 'encerrados') && texto(d, 'encerrados') !== '0' ? `, ${texto(d, 'encerrados') ?? ''} substituído(s)` : ''} (arquivo ${texto(d, 'arquivo') ?? ''}).` };
    case 'INVENTARIO_IMPORTADO':
      return { ...base, palete: null, descricao: `${texto(d, 'codigo') ?? 'Inventário'}: ${texto(d, 'vinculos') ?? '0'} vínculos, ${texto(d, 'paletesCriados') ?? '0'} paletes cadastrados.` };
    case 'PRODUTO_CRIADO':
    case 'PRODUTO_ALTERADO':
      return { ...base, palete: null, descricao: `SKU ${texto(d, 'sku') ?? ''}`.trim() };
    case 'EXPEDICAO_CONFIRMADA':
      return { ...base, palete: null, destino: texto(d, 'janela'), descricao: `Saída ${texto(d, 'codigo') ?? ''} (reserva ${texto(d, 'reserva') ?? ''})${d.parcial === true ? ', parcial' : ''}.` };
    case 'CONFERENCIA_CONCLUIDA':
    case 'CONFERENCIA_RECONCILIADA':
      return { ...base, descricao: `Conferência ${texto(d, 'numero') ?? ''}${texto(d, 'estadoPalete') ? ` · palete ${ROTULO_CONFERENCIA[texto(d, 'estadoPalete') ?? '']?.toLowerCase() ?? ''}` : ''}.` };
    default:
      return { ...base, origem: texto(d, 'origem') ?? texto(d, 'de'), destino: texto(d, 'destino') ?? texto(d, 'para'), descricao: motivo ?? ACOES_MOVIMENTACAO[acao] ?? acao };
  }
}

type Foto = { quantidadePaletesDeclarada?: number | null } | null;
const naoVazio = (s: string | undefined): string | null => (s === undefined || s === '' ? null : s);
const fotoDe = (v: unknown): Foto => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null);

/** Lê o snapshot do escopo. `limiteEventos` limita a aba Movimentações (os mais recentes). */
export async function lerSnapshot(db: Banco, escopoId: string, limiteEventos: number): Promise<SnapshotPlanilha> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const [{ instante }] = (await tx.$queryRaw<{ instante: Date }[]>`SELECT now() AS instante`) as [{ instante: Date }];
      const e = await tx.escopo.findUniqueOrThrow({ where: { id: escopoId }, include: { unidade: true, cliente: true } });
      const vinculos = await tx.vinculoDocumentoPalete.findMany({
        where: { escopoId, situacao: 'ATIVO', palete: { arquivadoEm: null } },
        select: {
          id: true,
          paleteId: true,
          tipoDocumento: true,
          numeroDocumento: true,
          delivery: true,
          volumes: true,
          palletFull: true,
          identidadeDocumento: true,
          fotografia: true,
          linhaInventario: { select: { remetente: true } },
          palete: {
            select: {
              codigo: true,
              estadoConferencia: true,
              estadoFluxo: true,
              posicao: { select: { codigo: true, endereco: { select: { endereco: true, situacao: true } } } },
            },
          },
        },
      });
      const identidadeDe = (v: (typeof vinculos)[number]) => v.identidadeDocumento ?? identidadeDocumento(v.tipoDocumento, v.numeroDocumento, v.delivery, v.linhaInventario.remetente);
      const informados = new Map(
        (
          await tx.$queryRaw<{ palete_id: string; endereco: string }[]>`
            SELECT DISTINCT ON (li.palete_id) li.palete_id::text, li.endereco_canonico AS endereco
              FROM linha_inventario li JOIN inventario_referencia i ON i.id = li.inventario_id
             WHERE li.escopo_id = ${escopoId}::uuid AND li.endereco_canonico IS NOT NULL AND ${LINHA_VIGENTE}
             ORDER BY li.palete_id, li.criado_em DESC, li.linha_arquivo`
        ).map((l) => [l.palete_id, l.endereco]),
      );
      const semDocumento = new Set(
        (
          await tx.$queryRaw<{ palete_id: string }[]>`
            SELECT DISTINCT li.palete_id::text FROM linha_inventario li JOIN inventario_referencia i ON i.id = li.inventario_id
             WHERE li.escopo_id = ${escopoId}::uuid AND li.aplicada AND li.numero_documento IS NULL AND li.palete_id IS NOT NULL AND i.situacao = 'ATIVO'`
        ).map((l) => l.palete_id),
      );
      const livres = await tx.linhaInventario.findMany({
        where: { escopoId, enderecoLivre: true, numeroDocumento: { not: null }, inventario: { situacao: 'ATIVO' } },
        select: { linhaArquivo: true, tipoDocumento: true, numeroDocumento: true, delivery: true, remetente: true, volumes: true, identidadeDocumento: true, enderecoCanonico: true, enderecoLido: true, inventario: { select: { codigo: true } } },
        orderBy: [{ numeroDocumento: 'asc' }, { linhaArquivo: 'asc' }],
      });
      const [cidades, conteudos] = await Promise.all([
        tx.informacaoDocumento.findMany({ where: { escopoId }, select: { identidadeDocumento: true, cidadeDestino: true } }),
        tx.conteudoDocumentoPalete.findMany({
          where: { escopoId },
          select: { paleteId: true, identidadeDocumento: true, produtoNaCaixa: true, descricoes: { where: { removidaEm: null }, orderBy: { criadoEm: 'asc' }, select: { grupo: true, descricao: true } } },
        }),
      ]);
      const cidadePor = new Map(cidades.map((c) => [c.identidadeDocumento, c.cidadeDestino]));
      // Conferência de volumes: contagem vigente (a mais recente) de cada conteúdo registrado ou vínculo importado.
      const contagemVigente = new Map(
        (
          await tx.$queryRaw<{ alvo: string; volumes: number; origem: string }[]>`
            SELECT DISTINCT ON (coalesce(conteudo_id, vinculo_id)) coalesce(conteudo_id, vinculo_id)::text AS alvo, volumes_contados AS volumes, origem
              FROM contagem_volumes WHERE escopo_id = ${escopoId}::uuid
             ORDER BY coalesce(conteudo_id, vinculo_id), registrada_em DESC, id DESC`
        ).map((c) => [c.alvo, c]),
      );
      const produtoPor = new Map(
        conteudos.map((c) => [`${c.paleteId}|${c.identidadeDocumento}`, [c.produtoNaCaixa, ...c.descricoes.map((d) => `${d.grupo}: ${d.descricao}`)].filter((x) => x.trim() !== '').join('; ')]),
      );
      // Identidades por palete (palete full) e paletes por identidade (mais de um palete).
      const identidadesPorPalete = new Map<string, Set<string>>();
      const paletesPorIdentidade = new Map<string, Set<string>>();
      const tiposPorPalete = new Map<string, Set<string | null>>();
      for (const v of vinculos) {
        const id = identidadeDe(v);
        identidadesPorPalete.set(v.paleteId, (identidadesPorPalete.get(v.paleteId) ?? new Set()).add(id));
        tiposPorPalete.set(v.paleteId, (tiposPorPalete.get(v.paleteId) ?? new Set()).add(v.tipoDocumento));
        if (v.palete.estadoFluxo !== 'EXPEDIDO') paletesPorIdentidade.set(id, (paletesPorIdentidade.get(id) ?? new Set()).add(v.paleteId));
      }
      const foraPorIdentidade = new Map<string, number>();
      const identidadeLivre = (l: (typeof livres)[number]) => l.identidadeDocumento ?? identidadeDocumento(l.tipoDocumento, l.numeroDocumento ?? '', l.delivery, l.remetente);
      for (const l of livres) foraPorIdentidade.set(identidadeLivre(l), (foraPorIdentidade.get(identidadeLivre(l)) ?? 0) + 1);
      const declarado = new Map<string, number>();
      for (const v of vinculos) {
        const n = fotoDe(v.fotografia)?.quantidadePaletesDeclarada ?? lerMarcadoresFull([v.palletFull]).total;
        if (n !== null) declarado.set(identidadeDe(v), Math.max(n, declarado.get(identidadeDe(v)) ?? 0));
      }
      const maisDeUm = (id: string) => ((declarado.get(id) ?? 0) > 1 || (paletesPorIdentidade.get(id)?.size ?? 0) + (foraPorIdentidade.get(id) ?? 0) > 1 ? 'Sim' : 'Não');
      const fullDe = (paleteId: string): LinhaInventarioPlanilha['paleteFull'] => {
        const ids = identidadesPorPalete.get(paleteId)?.size ?? 0;
        if (ids >= 2) return 'Não';
        const tipos = tiposPorPalete.get(paleteId) ?? new Set();
        return ids === 1 && [...tipos].every((t) => t === 'NFD') && !semDocumento.has(paleteId) ? 'Sim' : 'Não informado';
      };
      const documento = (tipo: string | null, numero: string) => (tipo === 'NFD' ? null : tipo === null ? `Documento de tipo não informado ${numero} (não confirmado como NFD)` : `Documento ${tipo} ${numero} (não é NFD)`);
      const inventario: LinhaInventarioPlanilha[] = vinculos.map((v) => {
        const id = identidadeDe(v);
        const p = v.palete;
        const real = p.posicao?.endereco?.situacao === 'CONFIRMADO' ? p.posicao.endereco.endereco : null;
        const expedido = p.estadoFluxo === 'EXPEDIDO';
        const endereco = expedido ? 'Fora da praça (expedido)' : (real ?? informados.get(v.paleteId) ?? 'Sem alocação');
        const alocacao = expedido
          ? 'Expedido (saiu da praça)'
          : p.posicao
            ? `Posição ${p.posicao.codigo}${real === null ? ' (endereço real a confirmar)' : ''}`
            : informados.has(v.paleteId)
              ? 'Posição no mapa pendente'
              : 'Localização pendente';
        const outro = documento(v.tipoDocumento, v.numeroDocumento);
        return {
          endereco,
          palete: p.codigo,
          nfd: v.tipoDocumento === 'NFD' ? v.numeroDocumento : null,
          remetente: v.linhaInventario.remetente,
          cidade: naoVazio(cidadePor.get(id)),
          volumes: contagemVigente.has(v.id) ? String(contagemVigente.get(v.id)?.volumes) : v.volumes === null ? null : v.volumes.toFixed(),
          paleteFull: fullDe(v.paleteId),
          maisDeUmPalete: maisDeUm(id),
          produto: naoVazio(produtoPor.get(`${v.paleteId}|${id}`)),
          situacao: [outro, ROTULO_CONFERENCIA[p.estadoConferencia] ?? p.estadoConferencia, alocacao, v.volumes === null && !contagemVigente.has(v.id) ? 'volumes pendentes' : null].filter((x) => x !== null).join(' · '),
          delivery: v.delivery,
          semAlocacao: false,
          semNota: false,
          identidade: id,
        };
      });
      // Paletes da praça sem nota: uma linha por conteúdo sem número do inventário (ou uma linha "sem nota").
      const semNotas = await tx.palete.findMany({
        where: { escopoId, arquivadoEm: null, documentos: { none: { situacao: 'ATIVO' } }, conteudos: { none: { situacao: 'ATIVO' } } },
        select: {
          id: true,
          codigo: true,
          estadoConferencia: true,
          estadoFluxo: true,
          posicao: { select: { codigo: true, endereco: { select: { endereco: true, situacao: true } } } },
          linhasInventario: {
            where: { aplicada: true, numeroDocumento: null, inventario: { situacao: 'ATIVO' } },
            orderBy: { linhaArquivo: 'asc' },
            select: { remetente: true, volumes: true, delivery: true, linhaArquivo: true },
          },
        },
      });
      for (const p of semNotas) {
        const real = p.posicao?.endereco?.situacao === 'CONFIRMADO' ? p.posicao.endereco.endereco : null;
        const expedido = p.estadoFluxo === 'EXPEDIDO';
        const endereco = expedido ? 'Fora da praça (expedido)' : (real ?? informados.get(p.id) ?? 'Localização pendente');
        const alocacao = expedido ? 'Expedido (saiu da praça)' : p.posicao ? `Posição ${p.posicao.codigo}` : informados.has(p.id) ? 'Posição no mapa pendente' : 'Localização pendente';
        const conteudos = p.linhasInventario.length > 0 ? p.linhasInventario : [null];
        for (const c of conteudos) {
          inventario.push({
            endereco,
            palete: p.codigo,
            nfd: null,
            remetente: c?.remetente ?? null,
            cidade: null,
            volumes: c?.volumes?.toFixed() ?? null,
            paleteFull: 'Não informado',
            maisDeUmPalete: 'Não',
            produto: null,
            situacao: [
              c === null ? 'Palete sem nota informada' : 'Palete sem nota informada: conteúdo sem número de documento no inventário (não prova posição vazia)',
              ROTULO_CONFERENCIA[p.estadoConferencia] ?? p.estadoConferencia,
              alocacao,
            ].join(' · '),
            delivery: c?.delivery ?? null,
            semAlocacao: false,
            semNota: true,
            identidade: null,
          });
        }
      }
      // Conteúdo registrado (cadastro de conteúdo): uma linha por registro; identificação ausente aparece como não informada.
      const registrados = await tx.conteudoPalete.findMany({
        where: { escopoId, situacao: 'ATIVO', palete: { arquivadoEm: null } },
        orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          remetente: true,
          tipoDocumento: true,
          numeroDocumento: true,
          delivery: true,
          descricao: true,
          paleteId: true,
          palete: { select: { codigo: true, estadoConferencia: true, estadoFluxo: true, posicao: { select: { codigo: true, endereco: { select: { endereco: true, situacao: true } } } } } },
        },
      });
      for (const r of registrados) {
        const p = r.palete;
        const real = p.posicao?.endereco?.situacao === 'CONFIRMADO' ? p.posicao.endereco.endereco : null;
        const expedido = p.estadoFluxo === 'EXPEDIDO';
        const endereco = expedido ? 'Fora da praça (expedido)' : (real ?? informados.get(r.paleteId) ?? 'Localização pendente');
        const alocacao = expedido ? 'Expedido (saiu da praça)' : p.posicao ? `Posição ${p.posicao.codigo}` : informados.has(r.paleteId) ? 'Posição no mapa pendente' : 'Localização pendente';
        const contagem = contagemVigente.get(r.id);
        inventario.push({
          endereco,
          palete: p.codigo,
          nfd: r.tipoDocumento === 'NFD' ? r.numeroDocumento : null,
          remetente: r.remetente,
          cidade: null,
          volumes: contagem === undefined ? null : String(contagem.volumes),
          paleteFull: 'Não informado',
          maisDeUmPalete: 'Não',
          produto: r.descricao,
          situacao: [
            r.numeroDocumento === null ? 'Conteúdo registrado: documento não informado' : `Conteúdo registrado: ${r.tipoDocumento ?? 'documento de tipo não informado'} ${r.numeroDocumento}`,
            r.delivery === null ? 'Delivery não informado' : null,
            contagem === undefined ? 'Aguardando conferência' : contagem.origem === 'CONTAGEM_FISICA' ? 'Volumes contados no aplicativo' : contagem.origem === 'BIPAGEM' ? 'Volumes lidos na bipagem' : 'Volumes de contagem já feita',
            alocacao,
          ]
            .filter((x) => x !== null)
            .join(' · '),
          delivery: r.delivery,
          semAlocacao: false,
          semNota: r.numeroDocumento === null,
          identidade: null,
        });
      }
      for (const l of livres) {
        const id = identidadeLivre(l);
        inventario.push({
          endereco: 'Sem alocação',
          palete: null,
          nfd: l.tipoDocumento === 'NFD' ? l.numeroDocumento : null,
          remetente: l.remetente,
          cidade: naoVazio(cidadePor.get(id)),
          volumes: l.volumes === null ? null : l.volumes.toFixed(),
          paleteFull: 'Não informado',
          maisDeUmPalete: maisDeUm(id),
          produto: null,
          situacao: [
            documento(l.tipoDocumento, l.numeroDocumento ?? ''),
            `Sem alocação: saiu desta praça (endereço antigo ${l.enderecoCanonico ?? l.enderecoLido ?? '?'} livre no ${l.inventario.codigo}, linha ${String(l.linhaArquivo)}); local atual não informado`,
          ]
            .filter((x) => x !== null)
            .join(' · '),
          delivery: l.delivery,
          semAlocacao: true,
          semNota: false,
          identidade: id,
        });
      }
      const especial = (x: LinhaInventarioPlanilha) => (x.semAlocacao ? 2 : x.endereco.startsWith('Fora da praça') ? 1 : 0);
      inventario.sort(
        (a, b) =>
          especial(a) - especial(b) ||
          ordemEndereco(a.endereco, b.endereco) ||
          (a.palete ?? '').localeCompare(b.palete ?? '') ||
          (a.nfd ?? a.situacao).localeCompare(b.nfd ?? b.situacao, 'pt-BR', { numeric: true }),
      );

      const acoes = Object.keys(ACOES_MOVIMENTACAO);
      const [eventosTotal, auditoria] = await Promise.all([
        tx.eventoAuditoria.count({ where: { escopoId, resultado: 'SUCESSO', acao: { in: acoes } } }),
        tx.eventoAuditoria.findMany({
          where: { escopoId, resultado: 'SUCESSO', acao: { in: acoes } },
          orderBy: [{ ocorridoEm: 'desc' }, { id: 'asc' }],
          take: limiteEventos,
          select: { id: true, ocorridoEm: true, acao: true, detalhes: true, ator: { select: { nome: true, login: true } } },
        }),
      ]);
      const eventos = auditoria.map((a): EventoPlanilha => {
        const d = (typeof a.detalhes === 'object' && a.detalhes !== null && !Array.isArray(a.detalhes) ? a.detalhes : {}) as Detalhes;
        return { id: a.id, em: a.ocorridoEm, alteracao: ACOES_MOVIMENTACAO[a.acao] ?? a.acao, responsavel: a.ator ? `${a.ator.nome} (${a.ator.login})` : 'Sistema', ...descreverEvento(a.acao, d) };
      });

      const alteracoes = await tx.$queryRaw<{ id: string; criado_em: Date }[]>`SELECT id::text, criado_em FROM alteracao_planilha WHERE escopo_id = ${escopoId}::uuid ORDER BY id`;
      const controle = await tx.controlePlanilha.findUnique({ where: { escopoId } });
      const pub = (situacao: string[]) =>
        tx.publicacaoPlanilha.findFirst({ where: { escopoId, situacao: { in: situacao } }, orderBy: { versao: 'desc' } }).then((x) =>
          x === null
            ? null
            : { versao: x.versao, situacao: x.situacao, concluidoEm: x.concluidoEm, instanteSnapshot: x.instanteSnapshot, identificacao: x.identificacaoPublicacao, versaoAnterior: x.versaoAnteriorPreservada, erro: x.erro },
        );
      const prot = (tipo: string, situacao?: string) =>
        tx.registroProtecao.findFirst({ where: { tipo, ...(situacao ? { situacao } : {}) }, orderBy: { concluidoEm: 'desc' } }).then((x) =>
          x === null
            ? null
            : { tipo: x.tipo, situacao: x.situacao, concluidoEm: x.concluidoEm, identificador: x.identificador, tamanhoBytes: x.tamanhoBytes, destino: x.destino, foraDoServidor: x.foraDoServidor, ambiente: x.ambiente, dados: x.dados, mensagem: x.mensagem },
        );
      const [ultimaPublicada, ultimaGerada, ultimaFalha, ultimoBackupVerificado, ultimoBackup, ultimoTesteRestauracao] = await Promise.all([
        pub(['PUBLICADA']),
        pub(['PUBLICADA', 'GERADA_LOCAL']),
        pub(['FALHOU']),
        prot('BACKUP', 'VERIFICADO'),
        prot('BACKUP'),
        prot('TESTE_RESTAURACAO'),
      ]);
      return {
        escopo: { id: e.id, nome: e.nome, unidade: e.unidade.codigo, unidadeNome: e.unidade.nome, cliente: e.cliente.codigo, clienteNome: e.cliente.nome, demonstracao: e.demonstracao },
        instante,
        inventario,
        eventos,
        eventosTotal,
        alteracoesVistas: alteracoes.map((a) => a.id),
        pendentes: { quantidade: alteracoes.length, desde: alteracoes[0]?.criado_em ?? null },
        controle: { falhasSeguidas: controle?.falhasSeguidas ?? 0, ultimaFalha: controle?.ultimaFalha ?? null, ultimaFalhaEm: controle?.ultimaFalhaEm ?? null },
        ultimaPublicada,
        ultimaGerada,
        ultimaFalha,
        ultimoBackupVerificado,
        ultimoBackup,
        ultimoTesteRestauracao,
      };
    },
    { isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 120_000 },
  );
}
