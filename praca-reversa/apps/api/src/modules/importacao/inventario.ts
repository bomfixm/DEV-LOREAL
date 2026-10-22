/**
 * Importação do inventário conferido (complemento "seleção do cliente").
 *
 * O arquivo informa NF/documento × palete × endereço × volumes. A prévia
 * propõe, por linha: vincular (palete existente), criar cadastro proposto,
 * atualizar informação, já importado, referência histórica/endereço livre,
 * repetida no arquivo ou requer resolução. A confirmação grava, numa única
 * transação, a fotografia (inventario_referencia + todas as linhas, aplicadas
 * ou não), os vínculos documentais e — pelos serviços existentes — os paletes
 * criados e as localizações registradas. Nunca cria saldo validado, nunca
 * libera material, nunca altera reservas, claims ou saídas, e nunca apaga ou
 * esvazia posições que o arquivo não cita (a importação é por registros, não
 * um reset da praça).
 *
 * Regras de identidade (docs/DECISOES.md):
 * - N° Pallet como identificador: o código do palete é o número informado
 *   (texto; número inteiro da planilha aceito com aviso). Como numeração de
 *   posição: a identidade vem do palete da posição confirmada, ou de um
 *   cadastro novo com código gerado.
 * - Endereço só vira posição pela tabela de correspondência CONFIRMADA;
 *   sem ela, a posição visual fica pendente (o endereço informado é guardado).
 * - O mesmo N° Pallet em dois endereços, ou dois paletes no mesmo endereço,
 *   exigem resolução. Registro atual divergente prevalece (aviso na revisão).
 * - Mesma NF no mesmo palete em linhas diferentes = parcelas (um vínculo por
 *   linha, volumes nunca somados); linha idêntica = repetida (agrupada).
 */
import {
  FORMATO_CODIGO_PALETE,
  chaveDeCodigo,
  normalizarEndereco,
  type EnderecoNormalizado,
  type Escopo,
  type MotivoLinha,
  type ParametrosInventario,
} from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { resolverEnderecos, type EnderecoResolvido } from '../layout/enderecos.js';
import { moverPalete } from '../movimentos/servico.js';
import { cadastrarPalete } from '../paletes/servico.js';
import type { CelulaTabela, LinhaTabela } from './arquivo/ler.js';
import { identidadeDocumento } from './identidade.js';
import { decimalExato, identificador, quantidade, textoLido, textoLivre, type Campo } from './interpretar.js';
import { celulaDe, lidosDaLinha, type Entrada, type LinhaClassificada } from './tipos.js';

const CAMPOS = {
  address: { campo: 'address', rotulo: 'RUA' },
  palletNumber: { campo: 'palletNumber', rotulo: 'N° Pallet' },
  documentNumber: { campo: 'documentNumber', rotulo: 'NUMERO' },
  documentType: { campo: 'documentType', rotulo: 'TIPO' },
  delivery: { campo: 'delivery', rotulo: 'DELIVERY' },
  volumes: { campo: 'volumes', rotulo: 'VOLUMES' },
  documentation: { campo: 'documentation', rotulo: 'DOCUMENTAÇÃO' },
  palletFull: { campo: 'palletFull', rotulo: 'PALLET FULL' },
  sender: { campo: 'sender', rotulo: 'REMETENTE' },
  scheduleMonth: { campo: 'scheduleMonth', rotulo: 'MÊS AGENDA' },
  windowRef: { campo: 'windowRef', rotulo: 'JANELA' },
  category: { campo: 'category', rotulo: 'PF/CNPJ' },
  addressStatus: { campo: 'addressStatus', rotulo: 'Situação do endereço' },
} as const satisfies Record<string, Campo>;

/** Unidade em que os volumes informados ficam (abrangência a confirmar com a operação). */
export const UNIDADE_VOLUMES = 'VOLUMES';
const SEP = '\u001f';

const aviso = (code: string, field: string | null, message: string): MotivoLinha => ({ code, field, message });

/** Chave do documento: contexto + número ("NFD|1750207"); sem tipo, "|1750207". */
export function chaveDocumento(tipo: string | null, numero: string): string {
  return `${tipo ?? ''}|${numero}`;
}

/**
 * Identificador de planilha operacional: texto como gravado; número inteiro
 * de até 15 dígitos aceito com aviso (o Excel não guarda zeros à esquerda);
 * notação científica ou mais de 15 dígitos = precisão já perdida (erro).
 */
export function identificadorPlanilha(c: CelulaTabela | undefined, f: Campo, max: number): { valor: string | null; erro?: MotivoLinha; aviso?: MotivoLinha } {
  if (c?.tipo === 'NUMERO' && !c.formula) {
    const t = (c.texto ?? '').trim();
    if (/^\d{1,15}$/.test(t)) {
      return {
        valor: t,
        aviso: aviso('IDENTIFICADOR_NUMERICO', f.campo, `${f.rotulo}: gravado como número na planilha (${t}); lido como texto. Zeros à esquerda que existissem na origem já não estão no arquivo.`),
      };
    }
    const d = decimalExato(t);
    if (d !== null && d.fracao === '' && d.inteiro.length > 15) {
      return {
        valor: null,
        erro: aviso('IDENTIFICADOR_TRUNCADO', f.campo, `${f.rotulo}: número com mais de 15 dígitos (${t}); o Excel já perdeu dígitos. Corrija a origem com o código completo como texto.`),
      };
    }
    return { valor: null, erro: aviso('IDENTIFICADOR_INVALIDO', f.campo, `${f.rotulo}: "${t}" não é um número inteiro de identificação.`) };
  }
  const r = identificador(c, f, max, { maximo: 64 });
  return r.ok ? { valor: r.valor } : { valor: null, erro: r.motivo };
}

export interface LinhaInventarioLida {
  linha: LinhaTabela;
  lidos: Record<string, string | null>;
  erros: MotivoLinha[];
  avisos: MotivoLinha[];
  enderecoLido: string | null;
  endereco: EnderecoNormalizado | null;
  enderecoLivre: boolean;
  /** Motivo da convenção de endereço livre (cor ou valor), quando aplicada. */
  regraLivre: string | null;
  numeroPalete: string | null;
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  delivery: string | null;
  volumes: string | null;
  volumesLido: string | null;
  documentacao: string | null;
  palletFull: string | null;
  remetente: string | null;
  mesAgenda: string | null;
  janela: string | null;
  categoria: string | null;
  extras: Record<string, string | null>;
}

export function interpretarInventario(e: Entrada, p: ParametrosInventario): LinhaInventarioLida[] {
  const max = e.limites.maxCellChars;
  const mapeadas = new Set(Object.values(e.colunas).filter((c): c is number => c !== null));
  const extrasColunas = e.tabela.cabecalho.filter((c) => !mapeadas.has(c.indice) && c.texto !== '');
  const cores = new Set(p.freeAddressFontColors.map((c) => c.toUpperCase()));
  const valoresLivres = new Set(p.freeAddressValues.map((v) => v.trim().toUpperCase()));
  return e.tabela.linhas.map((linha) => {
    const erros: MotivoLinha[] = [];
    const avisos: MotivoLinha[] = [];
    const c = (campo: keyof typeof CAMPOS) => celulaDe(linha, e.colunas, campo);
    const ident = (campo: keyof typeof CAMPOS) => {
      const r = identificadorPlanilha(c(campo), CAMPOS[campo], max);
      if (r.erro) erros.push(r.erro);
      if (r.aviso) avisos.push(r.aviso);
      return r.valor;
    };
    const livre = (campo: keyof typeof CAMPOS, maximo = 500) => {
      const r = textoLivre(c(campo), CAMPOS[campo], max, 1, maximo);
      if (!r.ok) {
        erros.push(r.motivo);
        return null;
      }
      return r.valor;
    };
    // RUA: endereço completo normalizado por regra registrada; texto original preservado.
    const celulaEndereco = c('address');
    const enderecoLido = textoLido(celulaEndereco);
    let endereco: EnderecoNormalizado | null = null;
    if (celulaEndereco?.formula) {
      erros.push(aviso('FORMULA', 'address', 'RUA: a célula tem fórmula; fórmulas não são calculadas. Substitua por valores fixos na origem.'));
    } else if (enderecoLido !== null) {
      endereco = normalizarEndereco(enderecoLido);
      if (endereco.ok && endereco.regras.length > 0) {
        avisos.push(aviso('ENDERECO_NORMALIZADO', 'address', `RUA "${enderecoLido}" lida como "${endereco.endereco}" (regras ${endereco.regras.join(', ')}: espaços/caixa/separador; nada foi completado).`));
      }
    }
    const status = livre('addressStatus', 40);
    let regraLivre: string | null = null;
    const cor = celulaEndereco?.corFonte?.toUpperCase() ?? null;
    if (cor !== null && cores.has(cor)) regraLivre = `fonte ${cor} na coluna RUA (convenção de endereço livre confirmada)`;
    else if (status !== null && valoresLivres.has(status.toUpperCase())) regraLivre = `situação do endereço "${status}" (convenção de endereço livre confirmada)`;

    let volumes: string | null = null;
    const celulaVolumes = c('volumes');
    const volumesLido = textoLido(celulaVolumes);
    if (celulaVolumes?.formula) {
      avisos.push(aviso('VOLUMES_FORMULA', 'volumes', `VOLUMES: célula com fórmula (${volumesLido ?? ''}); o valor calculado não é usado: volumes pendentes.`));
    } else if (volumesLido !== null) {
      const r = quantidade(celulaVolumes, CAMPOS.volumes, e.separador, max, true);
      if (r.ok) volumes = r.valor;
      else avisos.push(aviso('VOLUMES_NAO_NUMERICO', 'volumes', `VOLUMES: "${volumesLido}" não é uma quantidade; preservado como informado (volumes pendentes).`));
    }
    const tipo = livre('documentType', 20);
    const extras: Record<string, string | null> = {};
    for (const col of extrasColunas) {
      const valor = textoLido(linha.celulas[col.indice]);
      if (valor !== null) extras[col.texto.slice(0, 80)] = valor;
    }
    return {
      linha,
      lidos: lidosDaLinha(linha, e.colunas),
      erros,
      avisos,
      enderecoLido,
      endereco,
      enderecoLivre: regraLivre !== null,
      regraLivre,
      numeroPalete: ident('palletNumber'),
      tipoDocumento: tipo === null ? null : tipo.toUpperCase(),
      numeroDocumento: ident('documentNumber'),
      delivery: ident('delivery'),
      volumes,
      volumesLido,
      documentacao: livre('documentation', 100),
      palletFull: livre('palletFull', 100),
      remetente: livre('sender', 200),
      mesAgenda: livre('scheduleMonth', 40),
      janela: livre('windowRef', 40),
      categoria: livre('category', 40),
      extras,
    };
  });
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
  ultimoMovimento: Date | null;
}

interface VinculoAtual {
  id: string;
  paleteId: string;
  tipoDocumento: string | null;
  volumes: string | null;
  documentacao: string | null;
  palletFull: string | null;
  inventarioId: string;
  inventarioCodigo: string;
  linhaArquivo: number;
}

export interface EstadoInventario {
  paletesPorChave: Map<string, PaleteAtual>;
  paletesPorId: Map<string, PaleteAtual>;
  codigosPosicao: Set<string>;
  enderecos: Map<string, EnderecoResolvido>;
  vinculos: Map<string, VinculoAtual>;
  anterior: { id: string; codigo: string } | null;
  complemento: { id: string; codigo: string; pendentes: Map<string, string> } | null;
}

/** Chave estável de um vínculo: palete (ID) + documento + delivery + ordem da parcela. */
export function chaveVinculo(paleteId: string, documento: string, delivery: string | null, ordem: number): string {
  return `${paleteId}${SEP}${documento}${SEP}${delivery ?? ''}${SEP}${String(ordem)}`;
}

/** Identificação da linha para casar reapresentações de pendências (texto, sem IDs). */
function chaveLinhaInventario(l: LinhaInventarioLida): string {
  return [l.numeroPalete ?? '', l.tipoDocumento ?? '', l.numeroDocumento ?? '', l.delivery ?? '', l.endereco?.ok ? l.endereco.chave : (l.enderecoLido ?? '')].join(SEP);
}

export async function carregarEstadoInventario(db: Banco | Transacao, escopoId: string, linhas: readonly LinhaInventarioLida[], p: ParametrosInventario): Promise<EstadoInventario> {
  const chaves = [...new Set(linhas.flatMap((l) => (l.numeroPalete === null ? [] : [chaveDeCodigo(l.numeroPalete)])))];
  const enderecos = await resolverEnderecos(
    db,
    escopoId,
    linhas.flatMap((l) => (l.endereco?.ok ? [l.endereco] : [])),
  );
  const ocupantes = [...enderecos.values()].flatMap((e) => (e.ocupanteId === null ? [] : [e.ocupanteId]));
  const paletes = await db.palete.findMany({
    where: { escopoId, OR: [{ codigoBusca: { in: chaves } }, { id: { in: ocupantes } }] },
    select: {
      id: true,
      codigo: true,
      codigoBusca: true,
      versao: true,
      posicaoId: true,
      posicao: { select: { codigo: true } },
      arquivadoEm: true,
      estadoFluxo: true,
      localizacoes: { orderBy: { ocorridoEm: 'desc' }, take: 1, select: { ocorridoEm: true } },
    },
  });
  const atuais = paletes.map((x) => ({
    chave: x.codigoBusca,
    palete: {
      id: x.id,
      codigo: x.codigo,
      versao: x.versao,
      posicaoId: x.posicaoId,
      posicaoCodigo: x.posicao?.codigo ?? null,
      arquivado: x.arquivadoEm !== null,
      fluxo: x.estadoFluxo,
      ultimoMovimento: x.localizacoes[0]?.ocorridoEm ?? null,
    },
  }));
  const posicoes = chaves.length === 0 ? [] : await db.$queryRaw<{ chave: string }[]>`
      SELECT DISTINCT regexp_replace(upper(codigo), '[^A-Z0-9]', '', 'g') AS chave FROM posicao
       WHERE escopo_id = ${escopoId}::uuid AND regexp_replace(upper(codigo), '[^A-Z0-9]', '', 'g') = ANY(${chaves}::text[])`;
  const ids = paletes.map((x) => x.id);
  const vinculos =
    ids.length === 0
      ? []
      : await db.vinculoDocumentoPalete.findMany({
          where: { escopoId, situacao: 'ATIVO', paleteId: { in: ids } },
          select: {
            id: true,
            chave: true,
            paleteId: true,
            tipoDocumento: true,
            volumes: true,
            documentacao: true,
            palletFull: true,
            inventarioId: true,
            inventario: { select: { codigo: true } },
            linhaInventario: { select: { linhaArquivo: true } },
          },
        });
  const anterior = p.replacesInventoryId === null ? null : await db.inventarioReferencia.findFirst({ where: { id: p.replacesInventoryId, escopoId }, select: { id: true, codigo: true, situacao: true } });
  if (p.replacesInventoryId !== null && !anterior) throw new ErroHttp(404, 'NAO_ENCONTRADO', 'Inventário a substituir não encontrado neste escopo.');
  if (anterior && anterior.situacao !== 'ATIVO') throw new ErroHttp(409, 'CONFLITO', `O inventário ${anterior.codigo} já foi substituído por outra versão.`);
  let complemento: EstadoInventario['complemento'] = null;
  if (p.complementsInventoryId !== null) {
    const inv = await db.inventarioReferencia.findFirst({ where: { id: p.complementsInventoryId, escopoId }, select: { id: true, codigo: true, situacao: true } });
    if (!inv) throw new ErroHttp(404, 'NAO_ENCONTRADO', 'Inventário complementado não encontrado neste escopo.');
    const pendentes = await db.linhaInventario.findMany({
      where: { escopoId, inventarioId: inv.id, aplicada: false, resolvidaPorId: null, acao: { in: ['REQUER_RESOLUCAO'] } },
      select: { id: true, numeroPalete: true, tipoDocumento: true, numeroDocumento: true, delivery: true, enderecoCanonico: true, enderecoLido: true },
    });
    complemento = {
      id: inv.id,
      codigo: inv.codigo,
      pendentes: new Map(
        pendentes.map((x) => {
          const n = x.enderecoCanonico === null ? null : normalizarEndereco(x.enderecoCanonico);
          return [[x.numeroPalete ?? '', x.tipoDocumento ?? '', x.numeroDocumento ?? '', x.delivery ?? '', n?.ok ? n.chave : (x.enderecoLido ?? '')].join(SEP), x.id];
        }),
      ),
    };
  }
  return {
    paletesPorChave: new Map(atuais.map((a) => [a.chave, a.palete])),
    paletesPorId: new Map(atuais.map((a) => [a.palete.id, a.palete])),
    codigosPosicao: new Set(posicoes.map((x) => x.chave)),
    enderecos,
    vinculos: new Map(
      vinculos.map((v) => [
        v.chave,
        {
          id: v.id,
          paleteId: v.paleteId,
          tipoDocumento: v.tipoDocumento,
          volumes: v.volumes === null ? null : v.volumes.toFixed(),
          documentacao: v.documentacao,
          palletFull: v.palletFull,
          inventarioId: v.inventarioId,
          inventarioCodigo: v.inventario.codigo,
          linhaArquivo: v.linhaInventario.linhaArquivo,
        },
      ]),
    ),
    anterior: anterior ? { id: anterior.id, codigo: anterior.codigo } : null,
    complemento,
  };
}

// ---------- Classificação ----------

export type AcaoInventario = 'VINCULAR' | 'CRIAR_CADASTRO' | 'ATUALIZAR' | 'JA_IMPORTADO' | 'REFERENCIA_HISTORICA' | 'DUPLICADA_ARQUIVO' | 'REQUER_RESOLUCAO';

export interface LinhaPlanoInventario {
  numero: number;
  acao: AcaoInventario;
  aplicar: boolean;
  dados: LinhaInventarioLida;
  /** Identidade do palete no arquivo ("PAL:<código>" ou "POS:<endereço>"). */
  identidade: string | null;
  paleteExistenteId: string | null;
  /** Palete a criar por esta linha (primeira da identidade). */
  criarPalete: { codigo: string | null } | null;
  /** Posição a registrar (palete novo ou existente sem posição), da tabela confirmada. */
  registrarPosicao: { id: string; codigo: string } | null;
  posicaoResolvidaId: string | null;
  /** Vínculo documental: documento, ordem da parcela e vínculo atual a encerrar (atualização). */
  vinculo: { documento: string; ordem: number; encerrarId: string | null } | null;
  motivos: MotivoLinha[];
  chaveReapresentacao: string;
}

export interface PlanoInventario {
  parametros: ParametrosInventario;
  linhas: LinhaPlanoInventario[];
  /** Vínculos ativos da versão substituída que não constam desta versão (encerrados na confirmação). */
  encerrarDaVersaoAnterior: { id: string; descricao: string }[];
  estado: EstadoInventario;
  resumo: string[];
}

const ACOES_APLICAVEIS: readonly AcaoInventario[] = ['VINCULAR', 'CRIAR_CADASTRO', 'ATUALIZAR'];

function classificacaoDe(acao: AcaoInventario, temErro: boolean): LinhaClassificada['classificacao'] {
  if (acao === 'REQUER_RESOLUCAO') return temErro ? 'INVALIDA' : 'CONFLITANTE';
  if (acao === 'JA_IMPORTADO' || acao === 'DUPLICADA_ARQUIVO') return 'DUPLICADA';
  return 'VALIDA_NOVA';
}

/** Situação da posição informada para a linha, com aviso para quem revisa. */
function posicaoDaLinha(l: LinhaInventarioLida, estado: EstadoInventario): { resolvido: EnderecoResolvido | null; aviso: MotivoLinha | null } {
  if (l.endereco === null) return { resolvido: null, aviso: aviso('ENDERECO_AUSENTE', 'address', 'RUA vazia: localização não informada nesta linha.') };
  if (!l.endereco.ok) return { resolvido: null, aviso: aviso(l.endereco.codigo, 'address', `${l.endereco.mensagem} Posição visual pendente; nada é presumido.`) };
  const r = estado.enderecos.get(l.endereco.chave) ?? null;
  if (r?.resolucao !== 'POSICAO') {
    return { resolvido: r, aviso: aviso('POSICAO_VISUAL_PENDENTE', 'address', `${r?.mensagem ?? `${l.endereco.endereco} sem correspondência.`} O endereço fica registrado como informado; o palete não é colocado no mapa por aproximação.`) };
  }
  if (r.desativada) return { resolvido: r, aviso: aviso('POSICAO_DESATIVADA', 'address', `${l.endereco.endereco} corresponde à posição ${r.posicaoCodigo ?? ''}, que está desativada: não recebe palete sem ativação explícita.`) };
  if (!r.disponivel) return { resolvido: r, aviso: aviso('POSICAO_INDISPONIVEL', 'address', `A posição ${r.posicaoCodigo ?? ''} está indisponível: a localização não é registrada.`) };
  return { resolvido: r, aviso: null };
}

function textoData(d: Date): string {
  return d.toISOString().slice(0, 10).split('-').reverse().join('/');
}

export function classificarInventario(lidas: readonly LinhaInventarioLida[], estado: EstadoInventario, p: ParametrosInventario): { linhas: LinhaClassificada[]; plano: PlanoInventario } {
  // Referência externa (significado não confirmado) nunca vira identidade do palete: vale o endereço.
  const porIdentificador = p.palletNumberMeaning !== 'NUMERACAO_POSICAO' && p.palletNumberMeaning !== 'REFERENCIA_EXTERNA';
  const identidadeDe = (l: LinhaInventarioLida): string | null => {
    if (porIdentificador) return l.numeroPalete === null ? null : `PAL:${chaveDeCodigo(l.numeroPalete)}`;
    return l.endereco?.ok ? `POS:${l.endereco.chave}` : null;
  };
  // Conflitos dentro do arquivo (linhas que ocupam: as de endereço livre não contam).
  const enderecosPorPalete = new Map<string, Map<string, number[]>>();
  const paletesPorEndereco = new Map<string, Map<string, number[]>>();
  for (const l of lidas) {
    if (l.enderecoLivre || l.erros.length > 0) continue;
    const id = identidadeDe(l);
    const end = l.endereco?.ok ? l.endereco.chave : null;
    if (id === null || end === null) continue;
    const a = enderecosPorPalete.get(id) ?? new Map<string, number[]>();
    a.set(end, [...(a.get(end) ?? []), l.linha.numero]);
    enderecosPorPalete.set(id, a);
    const b = paletesPorEndereco.get(end) ?? new Map<string, number[]>();
    b.set(id, [...(b.get(id) ?? []), l.linha.numero]);
    paletesPorEndereco.set(end, b);
  }

  const vistas = new Map<string, number>();
  const ordens = new Map<string, number>();
  const paletesPlanejados = new Map<string, { existenteId: string | null; codigo: string | null; posicao: { id: string; codigo: string } | null }>();
  const posicoesReservadas = new Set<string>();
  const chavesNovas = new Set<string>();
  const plano: PlanoInventario = { parametros: p, linhas: [], encerrarDaVersaoAnterior: [], estado, resumo: [] };
  const resultado: LinhaClassificada[] = [];

  for (const l of lidas) {
    const motivos: MotivoLinha[] = [...l.avisos];
    const erros = [...l.erros];
    const conflitos: MotivoLinha[] = [];
    const identidade = identidadeDe(l);
    let acao: AcaoInventario;
    let paleteExistente: PaleteAtual | null = null;
    let criar: { codigo: string | null } | null = null;
    let registrar: { id: string; codigo: string } | null = null;
    let vinculo: LinhaPlanoInventario['vinculo'] = null;
    const { resolvido, aviso: avisoPosicao } = posicaoDaLinha(l, estado);
    if (avisoPosicao && !l.enderecoLivre) motivos.push(avisoPosicao);
    const posicaoResolvidaId = resolvido?.resolucao === 'POSICAO' ? resolvido.posicaoId : null;
    const assinaturaLinha = [identidade, l.tipoDocumento, l.numeroDocumento, l.delivery, l.volumes, l.volumesLido, l.documentacao, l.palletFull, l.endereco?.ok ? l.endereco.chave : l.enderecoLido, l.enderecoLivre].join(SEP);

    if (l.enderecoLivre) {
      acao = 'REFERENCIA_HISTORICA';
      motivos.push(aviso('ENDERECO_LIVRE', 'address', `Endereço livre pela convenção vigente (${l.regraLivre ?? ''}): linha preservada como referência histórica; não ocupa a posição nem cria vínculo.`));
      if (resolvido?.ocupanteCodigo) {
        motivos.push(aviso('LIVRE_COM_PALETE_ATUAL', 'address', `Nos registros atuais a posição ${resolvido.posicaoCodigo ?? ''} tem o palete ${resolvido.ocupanteCodigo}: nada é alterado; revise no mapa.`));
      }
    } else if (erros.length > 0) {
      acao = 'REQUER_RESOLUCAO';
    } else if (vistas.has(assinaturaLinha)) {
      acao = 'DUPLICADA_ARQUIVO';
      motivos.push(aviso('REPETIDA_NO_ARQUIVO', null, `Igual à linha ${String(vistas.get(assinaturaLinha) ?? '')} do arquivo: agrupada com ela (decisão registrada); volumes não são somados.`));
    } else {
      // Identidade do palete.
      if (identidade === null) {
        conflitos.push(
          porIdentificador
            ? aviso('PALETE_SEM_IDENTIFICACAO', 'palletNumber', 'Sem N° Pallet: a identidade do palete não existe nesta linha (nenhum palete é criado por suposição).')
            : aviso('PALETE_SEM_IDENTIFICACAO', 'address', 'N° Pallet é numeração de posição e o endereço não foi lido: a identidade do palete não pode ser determinada.'),
        );
      } else if (porIdentificador && l.numeroPalete !== null && !FORMATO_CODIGO_PALETE.test(l.numeroPalete.trim().toUpperCase())) {
        conflitos.push(aviso('PALETE_CODIGO_INVALIDO', 'palletNumber', `N° Pallet "${l.numeroPalete}" não é um código de palete válido (letras, números e . _ / -; parece outro dado, como um endereço).`));
      } else if (porIdentificador && l.numeroPalete !== null && estado.codigosPosicao.has(chaveDeCodigo(l.numeroPalete))) {
        conflitos.push(aviso('PALETE_IGUAL_POSICAO', 'palletNumber', `N° Pallet ${l.numeroPalete} é igual ao código de uma posição: identidade e localização precisam ser distintas.`));
      }
      const end = l.endereco?.ok ? l.endereco.chave : null;
      if (identidade !== null && conflitos.length === 0) {
        const outrosEnderecos = [...(enderecosPorPalete.get(identidade)?.entries() ?? [])].filter(([e]) => e !== end);
        if (outrosEnderecos.length > 0 && porIdentificador) {
          conflitos.push(
            aviso('PALETE_EM_DOIS_ENDERECOS', 'palletNumber', `O N° Pallet ${l.numeroPalete ?? ''} aparece em outro endereço no arquivo (linha ${outrosEnderecos.map(([, n]) => n.join(', ')).join(', ')}): resolva antes de vincular.`),
          );
        }
        if (end !== null) {
          const outrosPaletes = [...(paletesPorEndereco.get(end)?.entries() ?? [])].filter(([i]) => i !== identidade);
          if (outrosPaletes.length > 0) {
            conflitos.push(aviso('ENDERECO_COM_DOIS_PALETES', 'address', `O endereço ${l.endereco?.ok ? l.endereco.endereco : ''} aparece para outro palete no arquivo (linha ${outrosPaletes.map(([, n]) => n.join(', ')).join(', ')}).`));
          }
        }
      }
      if (identidade !== null && conflitos.length === 0) {
        if (porIdentificador) paleteExistente = estado.paletesPorChave.get(identidade.slice(4)) ?? null;
        else if (resolvido?.ocupanteId) paleteExistente = estado.paletesPorId.get(resolvido.ocupanteId) ?? null;
        if (paleteExistente?.arquivado) conflitos.push(aviso('PALETE_ARQUIVADO', 'palletNumber', `O palete ${paleteExistente.codigo} está arquivado: não recebe vínculos.`));
        else if (paleteExistente?.fluxo === 'EXPEDIDO') {
          conflitos.push(aviso('PALETE_EXPEDIDO', 'palletNumber', `O palete ${paleteExistente.codigo} já foi expedido: a linha descreve material que saiu da praça (revise a saída antes de vincular).`));
        } else if (!porIdentificador && posicaoResolvidaId === null) {
          conflitos.push(aviso('PALETE_SEM_IDENTIFICACAO', 'address', 'N° Pallet é numeração de posição e o endereço não tem posição confirmada: o palete não pode ser identificado.'));
        }
      }
      if (conflitos.length > 0) {
        acao = 'REQUER_RESOLUCAO';
      } else if (identidade !== null) {
        const planejado = paletesPlanejados.get(identidade);
        const posicaoLivre =
          resolvido?.resolucao === 'POSICAO' && resolvido.disponivel && !resolvido.desativada && resolvido.posicaoId !== null && resolvido.posicaoCodigo !== null && !posicoesReservadas.has(resolvido.posicaoId)
            ? { id: resolvido.posicaoId, codigo: resolvido.posicaoCodigo }
            : null;
        if (paleteExistente) {
          // Registro atual prevalece sobre o endereço informado.
          if (paleteExistente.posicaoId !== null && posicaoResolvidaId !== null && paleteExistente.posicaoId !== posicaoResolvidaId) {
            const posterior =
              p.countDate === null
                ? 'a data da conferência não foi informada'
                : paleteExistente.ultimoMovimento !== null && paleteExistente.ultimoMovimento.getTime() > Date.parse(`${p.countDate}T23:59:59.999Z`)
                  ? `há movimentação confirmada em ${textoData(paleteExistente.ultimoMovimento)}, depois da conferência`
                  : 'sem movimentação posterior registrada';
            motivos.push(
              aviso('ENDERECO_DIVERGENTE', 'address', `Nos registros atuais o palete ${paleteExistente.codigo} está em ${paleteExistente.posicaoCodigo ?? ''} (${posterior}): a localização atual prevalece; o endereço do arquivo fica como informado.`),
            );
          } else if (paleteExistente.posicaoId === null && planejado?.posicao === undefined && posicaoLivre !== null) {
            if (resolvido?.ocupanteId === null) registrar = posicaoLivre;
          }
          if (resolvido?.ocupanteId && resolvido.ocupanteId !== paleteExistente.id && paleteExistente.posicaoId !== posicaoResolvidaId) {
            motivos.push(aviso('POSICAO_OCUPADA', 'address', `A posição ${resolvido.posicaoCodigo ?? ''} tem o palete ${resolvido.ocupanteCodigo ?? ''} nos registros atuais: nada é sobrescrito.`));
          }
          paletesPlanejados.set(identidade, { existenteId: paleteExistente.id, codigo: paleteExistente.codigo, posicao: registrar ?? planejado?.posicao ?? null });
        } else if (!planejado) {
          if (resolvido?.ocupanteId) {
            motivos.push(aviso('POSICAO_OCUPADA', 'address', `A posição ${resolvido.posicaoCodigo ?? ''} tem o palete ${resolvido.ocupanteCodigo ?? ''} nos registros atuais: o cadastro novo fica sem localização (nada é sobrescrito).`));
          } else if (posicaoLivre !== null) {
            registrar = posicaoLivre;
          }
          criar = { codigo: porIdentificador ? (l.numeroPalete?.trim().toUpperCase() ?? null) : null };
          paletesPlanejados.set(identidade, { existenteId: null, codigo: criar.codigo, posicao: registrar });
        }
        if (registrar !== null) posicoesReservadas.add(registrar.id);
        // Vínculo documental.
        const paleteId = paleteExistente?.id ?? null;
        if (l.numeroDocumento !== null) {
          const documento = chaveDocumento(l.tipoDocumento, l.numeroDocumento);
          const grupo = `${identidade}${SEP}${documento}${SEP}${l.delivery ?? ''}`;
          const ordem = (ordens.get(grupo) ?? 0) + 1;
          ordens.set(grupo, ordem);
          if (ordem > 1) {
            motivos.push(aviso('PARCELA', 'documentNumber', `Mesma NF/documento e delivery em outra linha deste palete: tratada como parcela distinta (volumes mostrados por linha, sem soma).`));
          }
          const existente = paleteId === null ? undefined : estado.vinculos.get(chaveVinculo(paleteId, documento, l.delivery, ordem));
          if (paleteId !== null) chavesNovas.add(chaveVinculo(paleteId, documento, l.delivery, ordem));
          if (existente) {
            const mudou =
              existente.volumes !== l.volumes || existente.documentacao !== l.documentacao || existente.palletFull !== l.palletFull || existente.tipoDocumento !== l.tipoDocumento;
            vinculo = mudou ? { documento, ordem, encerrarId: existente.id } : null;
            if (mudou) {
              motivos.push(
                aviso('VINCULO_ATUALIZADO', null, `Vínculo já registrado pelo ${existente.inventarioCodigo} (linha ${String(existente.linhaArquivo)}) com outros dados: o anterior é encerrado (histórico preservado) e o novo registrado.`),
              );
            }
          } else {
            vinculo = { documento, ordem, encerrarId: null };
          }
        } else {
          motivos.push(aviso('SEM_DOCUMENTO', 'documentNumber', 'Linha sem número de documento: só a identidade e a localização do palete são consideradas.'));
        }
        if (criar !== null) acao = 'CRIAR_CADASTRO';
        else if (vinculo !== null && vinculo.encerrarId === null) acao = 'VINCULAR';
        else if (vinculo !== null || registrar !== null) acao = 'ATUALIZAR';
        else if (paleteExistente === null && planejado) acao = 'VINCULAR';
        else acao = 'JA_IMPORTADO';
        if (acao === 'VINCULAR' && vinculo === null) acao = 'JA_IMPORTADO';
        if (acao === 'JA_IMPORTADO') motivos.push(aviso('JA_IMPORTADO', null, 'Nada a gravar: vínculo e localização já correspondem aos registros.'));
      } else {
        acao = 'REQUER_RESOLUCAO';
      }
    }
    if (acao !== 'DUPLICADA_ARQUIVO') vistas.set(assinaturaLinha, l.linha.numero);
    const classificacao = classificacaoDe(acao, erros.length > 0);
    const motivosLinha = classificacao === 'INVALIDA' ? erros : classificacao === 'CONFLITANTE' ? conflitos : [];
    const planejado = identidade === null ? undefined : paletesPlanejados.get(identidade);
    const linhaPlano: LinhaPlanoInventario = {
      numero: l.linha.numero,
      acao,
      aplicar: ACOES_APLICAVEIS.includes(acao),
      dados: l,
      identidade,
      paleteExistenteId: paleteExistente?.id ?? null,
      criarPalete: criar,
      registrarPosicao: registrar,
      posicaoResolvidaId: l.enderecoLivre ? null : posicaoResolvidaId,
      vinculo,
      motivos: [...motivosLinha, ...motivos],
      chaveReapresentacao: chaveLinhaInventario(l),
    };
    plano.linhas.push(linhaPlano);
    resultado.push({
      numero: l.linha.numero,
      classificacao,
      chave: identidade === null ? null : `${l.numeroPalete !== null ? `palete ${l.numeroPalete}` : 'palete da posição'}${l.numeroDocumento !== null ? ` · ${l.tipoDocumento ?? '?'} ${l.numeroDocumento}` : ''}`,
      valores: {
        palletNumber: l.numeroPalete,
        pallet: paleteExistente?.codigo ?? planejado?.codigo ?? (criar !== null ? '(código gerado)' : null),
        palletProposed: criar !== null ? 'sim' : null,
        documentType: l.tipoDocumento,
        documentNumber: l.numeroDocumento,
        delivery: l.delivery,
        address: l.endereco?.ok ? l.endereco.endereco : null,
        position: l.enderecoLivre ? null : (resolvido?.posicaoCodigo ?? null),
        positionState: l.enderecoLivre ? 'endereço livre' : resolvido?.resolucao === 'POSICAO' ? 'confirmada' : 'pendente',
        locate: registrar?.codigo ?? null,
        volumes: l.volumes,
        volumesUnit: l.volumes === null ? null : UNIDADE_VOLUMES,
        documentation: l.documentacao,
        palletFull: l.palletFull,
        freeAddress: l.enderecoLivre ? 'sim' : null,
      },
      lidos: l.lidos,
      motivos: motivosLinha,
      avisos: classificacao === 'VALIDA_NOVA' || classificacao === 'DUPLICADA' ? motivos : [...motivos],
      acao,
    });
  }

  // Versão nova: vínculos ativos da versão substituída que não constam mais.
  if (estado.anterior !== null) {
    for (const [chave, v] of estado.vinculos) {
      if (v.inventarioId === estado.anterior.id && !chavesNovas.has(chave)) {
        plano.encerrarDaVersaoAnterior.push({ id: v.id, descricao: `${v.tipoDocumento ?? ''} linha ${String(v.linhaArquivo)} do ${v.inventarioCodigo}` });
      }
    }
  }
  const conta = (a: AcaoInventario) => plano.linhas.filter((x) => x.acao === a).length;
  const pendentesPosicao = plano.linhas.filter((x) => x.aplicar && x.posicaoResolvidaId === null).length;
  const tipos = new Map<string, number>();
  for (const x of plano.linhas) if (x.dados.tipoDocumento !== null) tipos.set(x.dados.tipoDocumento, (tipos.get(x.dados.tipoDocumento) ?? 0) + 1);
  const definidos = new Set(p.documentTypes.map((d) => d.code));
  const semDefinicao = [...tipos.entries()].filter(([t]) => !definidos.has(t));
  plano.resumo = [
    `Ações: ${String(conta('VINCULAR'))} vincular · ${String(conta('CRIAR_CADASTRO'))} criar cadastro proposto · ${String(conta('ATUALIZAR'))} atualizar informação · ${String(conta('JA_IMPORTADO'))} já importado · ${String(conta('REFERENCIA_HISTORICA'))} referência histórica/endereço livre · ${String(conta('DUPLICADA_ARQUIVO'))} repetida no arquivo · ${String(conta('REQUER_RESOLUCAO'))} requer resolução.`,
    `Paletes: ${String(plano.linhas.filter((x) => x.criarPalete !== null).length)} cadastro(s) proposto(s); ${String(plano.linhas.filter((x) => x.registrarPosicao !== null).length)} localização(ões) a registrar pela tabela confirmada; ${String(pendentesPosicao)} linha(s) aplicável(is) com posição visual pendente.`,
    'Saldo validado por produto não muda: o arquivo informa NF, palete, endereço e volumes (SKU, lote e peças continuam desconhecidos).',
    ...(semDefinicao.length > 0
      ? [`Tipos documentais sem definição operacional (não relacionados à origem dos segmentos): ${semDefinicao.map(([t, n]) => `${t} (${String(n)})`).join(', ')}.`]
      : []),
    ...(estado.anterior !== null
      ? [`Versão nova do ${estado.anterior.codigo}: ${String(plano.encerrarDaVersaoAnterior.length)} vínculo(s) da versão anterior não constam deste arquivo e serão encerrados na confirmação (histórico preservado).`]
      : []),
    ...(estado.complemento !== null
      ? [`Reapresentação de pendências do ${estado.complemento.codigo}: ${String(plano.linhas.filter((x) => x.aplicar && estado.complemento?.pendentes.has(x.chaveReapresentacao)).length)} linha(s) resolvem pendências registradas.`]
      : []),
  ];
  return { linhas: resultado, plano };
}

// ---------- Gravação ----------

export interface ResultadoInventario {
  inventarioId: string;
  linhas: number;
  aplicadas: number;
  pendentes: number;
  vinculos: number;
  paletesCriados: number;
  localizacoes: number;
}

export async function proximoNumeroInventario(tx: Transacao, escopoId: string): Promise<number> {
  // Bipagens (BIP-…) têm numeração própria.
  const [r] = await tx.$queryRaw<{ n: number }[]>`SELECT COALESCE(MAX(numero), 0)::int + 1 AS n FROM inventario_referencia WHERE escopo_id = ${escopoId}::uuid AND origem <> 'BIPAGEM'`;
  return r?.n ?? 1;
}

/**
 * Grava a fotografia, as linhas e o que foi aplicado. Chamado na transação
 * da confirmação (bloqueio da importação do escopo já obtido): falha em
 * qualquer passo desfaz tudo.
 */
export async function gravarInventario(
  tx: Transacao,
  escopo: Escopo,
  autor: { usuarioId: string; requestId: string },
  lote: { id: string; nomeArquivo: string; hashArquivo: string; aba: string | null },
  plano: PlanoInventario,
  excluidas: ReadonlySet<number>,
  agora: Date,
): Promise<{ resultado: ResultadoInventario; registros: Map<number, string> }> {
  const p = plano.parametros;
  if (p.palletNumberMeaning === null) throw new ErroHttp(409, 'IMPORTACAO_BLOQUEADA', 'Confirme o significado do N° Pallet antes de importar.');
  const numero = await proximoNumeroInventario(tx, escopo.id);
  const inventarioId = randomUUID();
  const codigoInventario = `INV-${String(numero).padStart(6, '0')}`;
  const aplicaveis = plano.linhas.filter((l) => l.aplicar && !excluidas.has(l.numero));
  await tx.inventarioReferencia.create({
    data: {
      id: inventarioId,
      escopoId: escopo.id,
      numero,
      codigo: codigoInventario,
      descricao: p.description,
      origem: 'IMPORTADO',
      loteImportacaoId: lote.id,
      referenciaConferencia: p.countReference,
      dataConferencia: p.countDate === null ? null : new Date(`${p.countDate}T00:00:00.000Z`),
      fonteConferencia: p.countSource,
      nomeArquivo: lote.nomeArquivo,
      hashArquivo: lote.hashArquivo,
      aba: lote.aba,
      significadoNumeroPalete: p.palletNumberMeaning,
      convencoes: {
        freeAddressFontColors: p.freeAddressFontColors,
        freeAddressValues: p.freeAddressValues,
        documentTypes: p.documentTypes,
        definitive: p.definitive,
      },
      situacao: 'ATIVO',
      substituiId: plano.estado.anterior?.id ?? null,
      totalLinhas: plano.linhas.length,
      aplicadas: aplicaveis.length,
      pendentes: plano.linhas.filter((l) => l.acao === 'REQUER_RESOLUCAO' || (l.aplicar && excluidas.has(l.numero))).length,
      historicas: plano.linhas.filter((l) => l.acao === 'REFERENCIA_HISTORICA').length,
      criadoPorId: autor.usuarioId,
      criadoEm: agora,
    },
  });
  if (plano.estado.anterior !== null) {
    const r = await tx.inventarioReferencia.updateMany({ where: { id: plano.estado.anterior.id, escopoId: escopo.id, situacao: 'ATIVO' }, data: { situacao: 'SUBSTITUIDO', versao: { increment: 1 } } });
    if (r.count !== 1) throw new ErroHttp(409, 'PREVIA_DESATUALIZADA', `O ${plano.estado.anterior.codigo} foi substituído por outra versão enquanto a prévia era revisada.`);
  }

  const paletePorIdentidade = new Map<string, string>();
  // Cadastro proposto por identidade (vem da primeira linha; se ela ficar de fora, a próxima aplicada cria).
  const criacoes = new Map<string, { codigo: string | null; posicao: { id: string; codigo: string } | null }>();
  for (const l of plano.linhas) {
    if (l.criarPalete !== null && l.identidade !== null && !criacoes.has(l.identidade)) criacoes.set(l.identidade, { codigo: l.criarPalete.codigo, posicao: l.registrarPosicao });
  }
  let paletesCriados = 0;
  let localizacoes = 0;
  let vinculos = 0;
  const registros = new Map<number, string>();
  const motivo = `Inventário conferido ${codigoInventario} (referência ${p.countReference})`;
  for (const l of plano.linhas) {
    const aplicar = l.aplicar && !excluidas.has(l.numero);
    let paleteId: string | null = l.paleteExistenteId ?? (l.identidade === null ? null : (paletePorIdentidade.get(l.identidade) ?? null));
    if (aplicar && l.identidade !== null) {
      const criacao = criacoes.get(l.identidade);
      if (paleteId === null && criacao !== undefined) {
        const detalhe = await cadastrarPalete(
          tx,
          escopo,
          {
            code: criacao.codigo === null ? { mode: 'GERAR' } : { mode: 'INFORMAR', value: criacao.codigo },
            positionId: criacao.posicao?.id ?? null,
            notes: `Cadastro proposto pelo ${codigoInventario} (linha ${String(l.numero)}); conteúdo por produto desconhecido até a conferência por SKU.`,
            declaredItems: [],
          },
          autor,
          agora,
        );
        paleteId = detalhe.id;
        paletesCriados += 1;
        if (criacao.posicao !== null) localizacoes += 1;
      } else if (paleteId !== null && l.registrarPosicao !== null && l.paleteExistenteId !== null) {
        const atual = await tx.palete.findFirst({ where: { id: paleteId, escopoId: escopo.id }, select: { versao: true } });
        if (!atual) throw new ErroHttp(409, 'PREVIA_DESATUALIZADA', 'Um palete da prévia não existe mais.');
        await moverPalete(
          tx,
          escopo,
          paleteId,
          { destinationPositionId: l.registrarPosicao.id, confirmedPositionCode: l.registrarPosicao.codigo, expectedVersion: atual.versao, reason: `Localização informada no ${motivo}.` },
          autor,
          agora,
        );
        localizacoes += 1;
      }
      if (paleteId !== null) paletePorIdentidade.set(l.identidade, paleteId);
    }
    const linhaId = randomUUID();
    const d = l.dados;
    const reapresentada = aplicar && plano.estado.complemento !== null ? (plano.estado.complemento.pendentes.get(l.chaveReapresentacao) ?? null) : null;
    await tx.linhaInventario.create({
      data: {
        id: linhaId,
        escopoId: escopo.id,
        inventarioId,
        loteImportacaoId: lote.id,
        linhaArquivo: l.numero,
        delivery: d.delivery,
        tipoDocumento: d.tipoDocumento,
        numeroDocumento: d.numeroDocumento,
        chaveDocumento: d.numeroDocumento === null ? null : chaveDocumento(d.tipoDocumento, d.numeroDocumento),
        identidadeDocumento: d.numeroDocumento === null ? null : identidadeDocumento(d.tipoDocumento, d.numeroDocumento, d.delivery, d.remetente),
        volumes: d.volumes,
        volumesLido: d.volumesLido,
        remetente: d.remetente,
        mesAgenda: d.mesAgenda,
        janelaReferencia: d.janela,
        enderecoLido: d.enderecoLido,
        enderecoCanonico: d.endereco?.ok ? d.endereco.endereco : null,
        enderecoLivre: d.enderecoLivre,
        numeroPalete: d.numeroPalete,
        documentacao: d.documentacao,
        palletFull: d.palletFull,
        categoria: d.categoria,
        extras: d.extras,
        paleteId: aplicar ? paleteId : null,
        posicaoId: l.posicaoResolvidaId,
        acao: l.acao,
        aplicada: aplicar,
        motivos: [...l.motivos, ...(l.aplicar && !aplicar ? [aviso('NAO_SELECIONADA', null, 'Linha aplicável deixada de fora na confirmação: registrada como não aplicada.')] : [])],
        criadoEm: agora,
      },
    });
    if (reapresentada !== null) {
      await tx.linhaInventario.update({ where: { id: reapresentada }, data: { resolvidaPorId: linhaId } });
    }
    if (aplicar && paleteId !== null && l.vinculo !== null && d.numeroDocumento !== null) {
      if (l.vinculo.encerrarId !== null) {
        await tx.vinculoDocumentoPalete.update({
          where: { id: l.vinculo.encerrarId },
          data: { situacao: 'ENCERRADO', encerradoEm: agora, encerradoPorId: autor.usuarioId, motivoEncerramento: `Atualizado pela linha ${String(l.numero)} do ${codigoInventario}.` },
        });
      }
      const id = randomUUID();
      await tx.vinculoDocumentoPalete.create({
        data: {
          id,
          escopoId: escopo.id,
          paleteId,
          inventarioId,
          linhaInventarioId: linhaId,
          tipoDocumento: d.tipoDocumento,
          numeroDocumento: d.numeroDocumento,
          chaveDocumento: l.vinculo.documento,
          identidadeDocumento: identidadeDocumento(d.tipoDocumento, d.numeroDocumento, d.delivery, d.remetente),
          delivery: d.delivery,
          volumes: d.volumes,
          unidadeVolumes: UNIDADE_VOLUMES,
          documentacao: d.documentacao,
          palletFull: d.palletFull,
          chave: chaveVinculo(paleteId, l.vinculo.documento, d.delivery, l.vinculo.ordem),
          situacao: 'ATIVO',
          criadoPorId: autor.usuarioId,
          criadoEm: agora,
        },
      });
      vinculos += 1;
    }
    if (aplicar) registros.set(l.numero, linhaId);
  }
  for (const v of plano.encerrarDaVersaoAnterior) {
    await tx.vinculoDocumentoPalete.update({
      where: { id: v.id },
      data: { situacao: 'ENCERRADO', encerradoEm: agora, encerradoPorId: autor.usuarioId, motivoEncerramento: `Não consta da versão ${codigoInventario}.` },
    });
  }
  await registrarEvento(tx, {
    acao: 'INVENTARIO_IMPORTADO',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'INVENTARIO',
    alvoId: inventarioId,
    detalhes: {
      codigo: codigoInventario,
      lote: lote.id,
      linhas: plano.linhas.length,
      aplicadas: aplicaveis.length,
      vinculos,
      paletesCriados,
      localizacoes,
      encerradosVersaoAnterior: plano.encerrarDaVersaoAnterior.length,
      substitui: plano.estado.anterior?.codigo ?? null,
      complementa: plano.estado.complemento?.codigo ?? null,
    },
    requestId: autor.requestId,
  });
  return {
    resultado: {
      inventarioId,
      linhas: plano.linhas.length,
      aplicadas: aplicaveis.length,
      pendentes: plano.linhas.length - aplicaveis.length,
      vinculos,
      paletesCriados,
      localizacoes,
    },
    registros,
  };
}
