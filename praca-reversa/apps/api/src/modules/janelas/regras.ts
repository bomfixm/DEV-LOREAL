/**
 * Elegibilidade do material para reserva/expedição (etapa 08; R11, R22, R26).
 * Regras puras: o serviço aplica as mesmas funções na fila, na reserva e na
 * confirmação de saída (revalidação no servidor).
 *
 * Disponível para reserva = min(liberado − reservado, saldo − vinculado − reservado).
 * Conferência ou recuperação de claim não liberam; a parte vinculada a claim
 * não é reservável (reservado + vinculado ≤ saldo, etapa 07).
 */
import {
  ROTULOS_SITUACAO_JANELA,
  compararQuantidades,
  normalizarQuantidade,
  subtrairQuantidades,
  type CodigoPendenciaMaterial,
  type CondicaoMaterial,
  type EstadoConferencia,
  type EstadoFluxo,
  type SituacaoJanela,
  type TipoOrigemDocumento,
} from '@praca-reversa/contracts';

export interface MaterialRegra {
  paleteCodigo: string;
  arquivado: boolean;
  estadoFluxo: EstadoFluxo;
  estadoConferencia: EstadoConferencia;
  conferenciaAtiva: boolean;
  paleteBloqueio: string | null;
  linhaBloqueio: string | null;
  quantidade: string;
  reservada: string;
  liberada: string;
  vinculada: string;
  condicao: CondicaoMaterial;
  lote: string | null;
  origemTipo: TipoOrigemDocumento | null;
  origemReferencia: string | null;
}

export interface CriteriosRegra {
  definidos: boolean;
  condicoes: readonly CondicaoMaterial[];
  origemQualquer: boolean;
  origens: readonly TipoOrigemDocumento[];
  exigeLote: boolean;
  exigeOrigem: boolean;
}

export interface Pendencia {
  code: CodigoPendenciaMaterial;
  message: string;
  nextStep: string;
  /** Impede reservar/expedir a linha inteira (não só uma parte). */
  bloqueia: boolean;
}

const ROTULOS_CONDICAO: Record<CondicaoMaterial, string> = { SAUDAVEL: 'saudável', AVARIADO: 'avariado', EM_AVALIACAO: 'em avaliação' };

const maximo0 = (q: string) => (compararQuantidades(q, '0') > 0 ? normalizarQuantidade(q) : '0');
const menor = (a: string, b: string) => (compararQuantidades(a, b) <= 0 ? a : b);

/** Reservável agora (antes de bloqueios e critérios). */
export function disponivelParaReserva(m: Pick<MaterialRegra, 'quantidade' | 'reservada' | 'liberada' | 'vinculada'>): string {
  const liberadoLivre = subtrairQuantidades(m.liberada, m.reservada);
  const fisicoLivre = subtrairQuantidades(subtrairQuantidades(m.quantidade, m.vinculada), m.reservada);
  return maximo0(menor(liberadoLivre, fisicoLivre));
}

/** Critérios do material na janela (vazio = compatível). */
export function falhasDeCriterio(m: Pick<MaterialRegra, 'condicao' | 'lote' | 'origemTipo' | 'origemReferencia'>, c: CriteriosRegra): Pendencia[] {
  if (!c.definidos) {
    return [{ code: 'CRITERIOS_PENDENTES', message: 'Critérios de material da janela ainda não informados.', nextStep: 'Registrar os critérios aceitos pelo cliente na janela.', bloqueia: true }];
  }
  const falhas: Pendencia[] = [];
  if (!c.condicoes.includes(m.condicao)) {
    falhas.push({
      code: 'CRITERIO_CONDICAO',
      message: `Condição ${ROTULOS_CONDICAO[m.condicao]} não aceita pela janela (aceita: ${c.condicoes.map((x) => ROTULOS_CONDICAO[x]).join(', ')}).`,
      nextStep: 'Destinar conforme o processo autorizado ou escolher outra janela.',
      bloqueia: true,
    });
  }
  if (c.exigeOrigem && (m.origemTipo === null || m.origemReferencia === null)) {
    falhas.push({ code: 'CRITERIO_ORIGEM', message: 'A janela exige origem comprovada e a origem deste material está pendente.', nextStep: 'Comprovar a origem por conferência/recontagem.', bloqueia: true });
  } else if (!c.origemQualquer && (m.origemTipo === null || !c.origens.includes(m.origemTipo))) {
    falhas.push({ code: 'CRITERIO_ORIGEM', message: `Tipo de origem ${m.origemTipo ?? 'pendente'} não aceito pela janela.`, nextStep: 'Escolher material de origem aceita ou outra janela.', bloqueia: true });
  }
  if (c.exigeLote && m.lote === null) {
    falhas.push({ code: 'CRITERIO_LOTE', message: 'A janela exige lote conhecido e o lote deste material está pendente.', nextStep: 'Identificar o lote por conferência/recontagem.', bloqueia: true });
  }
  return falhas;
}

/**
 * Pendências do material. As que `bloqueia` impedem a linha inteira; as
 * demais descrevem só uma parte (não liberada, vinculada a claim).
 */
export function pendenciasDoMaterial(m: MaterialRegra, criterios: CriteriosRegra | null): Pendencia[] {
  const p: Pendencia[] = [];
  if (m.arquivado || m.estadoFluxo === 'EXPEDIDO') {
    p.push({ code: 'CONFERENCIA_PENDENTE', message: 'Palete fora do estoque (arquivado ou expedido).', nextStep: 'Nenhum: o palete não está na praça.', bloqueia: true });
    return p;
  }
  if (m.paleteBloqueio !== null) {
    p.push({ code: 'PALETE_BLOQUEADO', message: `Palete ${m.paleteCodigo} bloqueado: ${m.paleteBloqueio}`, nextStep: 'Tratar o motivo e desbloquear o palete (perfil autorizado, com motivo).', bloqueia: true });
  }
  if (m.linhaBloqueio !== null) {
    p.push({ code: 'MATERIAL_BLOQUEADO', message: `Material bloqueado: ${m.linhaBloqueio}`, nextStep: 'Tratar o motivo e desbloquear o material (perfil autorizado, com motivo).', bloqueia: true });
  }
  if (m.conferenciaAtiva) {
    p.push({ code: 'CONFERENCIA_EM_ANDAMENTO', message: 'Conferência em andamento neste palete.', nextStep: 'Concluir ou cancelar a conferência.', bloqueia: true });
  } else if (m.estadoConferencia !== 'RECONCILIADO') {
    p.push({
      code: 'CONFERENCIA_PENDENTE',
      message:
        m.estadoConferencia === 'AGUARDANDO_VALIDACAO'
          ? 'Contagem completa aguardando validação: o saldo pode mudar.'
          : 'Conteúdo do palete não validado integralmente (conteúdo desconhecido ou contagem parcial).',
      nextStep: 'Conferir e reconciliar o palete.',
      bloqueia: true,
    });
  }
  if (criterios !== null) p.push(...falhasDeCriterio(m, criterios));
  const naoLiberado = maximo0(subtrairQuantidades(m.quantidade, m.liberada));
  if (compararQuantidades(naoLiberado, '0') > 0) {
    p.push({
      code: 'NAO_LIBERADO',
      message: `${naoLiberado} aguardando liberação para expedição (liberado ${normalizarQuantidade(m.liberada)} de ${normalizarQuantidade(m.quantidade)}).`,
      nextStep: 'Liberar a quantidade por ação autorizada, com critério e fonte.',
      bloqueia: compararQuantidades(m.liberada, m.reservada) <= 0,
    });
  }
  if (compararQuantidades(m.vinculada, '0') > 0) {
    p.push({
      code: 'VINCULADO_CLAIM',
      message: `${normalizarQuantidade(m.vinculada)} vinculado(s) a recuperação de claim validada: não reservável nesta versão.`,
      nextStep: 'Aguardar a decisão de destino do material recuperado (docs/DESCOBERTA.md).',
      bloqueia: false,
    });
  }
  return p;
}

/** Material elegível: nenhuma pendência que bloqueie a linha e algo disponível. */
export function elegivel(m: MaterialRegra, criterios: CriteriosRegra | null): boolean {
  return !pendenciasDoMaterial(m, criterios).some((x) => x.bloqueia) && compararQuantidades(disponivelParaReserva(m), '0') > 0;
}

/** Problemas que impedem reservar `quantidade` deste material agora. */
export function problemasParaReservar(m: MaterialRegra, criterios: CriteriosRegra, quantidade: string): string[] {
  const bloqueios = pendenciasDoMaterial(m, criterios)
    .filter((x) => x.bloqueia)
    .map((x) => x.message);
  if (bloqueios.length > 0) return bloqueios;
  const disponivel = disponivelParaReserva(m);
  if (compararQuantidades(quantidade, disponivel) > 0) {
    return [
      `Disponível ${disponivel} (liberado ${normalizarQuantidade(m.liberada)} − reservado ${normalizarQuantidade(m.reservada)}; saldo ${normalizarQuantidade(m.quantidade)}, vinculado a claim ${normalizarQuantidade(m.vinculada)}), pedido ${normalizarQuantidade(quantidade)}.`,
    ];
  }
  return [];
}

/**
 * Impedimentos para expedir a parte reservada: bloqueio posterior, conferência
 * em curso/pendente ou critério atual. A liberação já cobre o reservado (CHECK).
 */
export function problemasParaExpedir(m: MaterialRegra, criterios: CriteriosRegra): string[] {
  return pendenciasDoMaterial(m, criterios)
    .filter((x) => x.bloqueia && x.code !== 'NAO_LIBERADO')
    .map((x) => x.message);
}

/** Situações em que reserva e expedição são aceitas. */
export function janelaOperavel(situacao: SituacaoJanela): string | null {
  return situacao === 'CONFIRMADA' || situacao === 'PREPARACAO'
    ? null
    : `A janela está ${ROTULOS_SITUACAO_JANELA[situacao].toLowerCase()}: reserva e expedição exigem janela confirmada ou em preparação.`;
}
