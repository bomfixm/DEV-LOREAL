/** Fuso da operação (AGENTS.md). Timestamps chegam em UTC e são exibidos neste fuso. */
export const FUSO_OPERACAO = 'America/Sao_Paulo';

const formatoDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_OPERACAO,
  dateStyle: 'short',
  timeStyle: 'short',
});

export function formatarDataHora(isoUtc: string): string {
  const data = new Date(isoUtc);
  return Number.isNaN(data.getTime()) ? 'data inválida' : formatoDataHora.format(data);
}

const formatoData = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_OPERACAO, dateStyle: 'short' });

/** Somente a data, no fuso da operação (ex.: 02/10/2026). */
export function formatarData(isoUtc: string): string {
  const data = new Date(isoUtc);
  return Number.isNaN(data.getTime()) ? 'data inválida' : formatoData.format(data);
}

const formatoDataHoraSegundos = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_OPERACAO,
  dateStyle: 'short',
  timeStyle: 'medium',
});

/** Data e hora com segundos, no fuso da operação (ex.: 02/10/2026, 14:32:05): quando o rascunho foi gravado. */
export function formatarHora(isoUtc: string): string {
  const data = new Date(isoUtc);
  return Number.isNaN(data.getTime()) ? 'data inválida' : formatoDataHoraSegundos.format(data);
}

const partesNoFuso = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_OPERACAO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Hora de parede no fuso da operação, como se fosse UTC (para calcular o deslocamento). */
function paredeNoFuso(instante: number): number {
  const p = Object.fromEntries(partesNoFuso.formatToParts(new Date(instante)).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
}

/**
 * Data/hora digitada no fuso da operação ("2026-10-07T08:00", campo
 * datetime-local) para ISO em UTC. `null` quando inválida. Não presume
 * horário: o campo vazio continua pendente.
 */
export function paraIsoNoFuso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const alvo = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  let instante = alvo;
  for (let i = 0; i < 3; i++) instante = alvo - (paredeNoFuso(instante) - instante);
  return Number.isNaN(instante) ? null : new Date(instante).toISOString();
}

/** ISO em UTC para o valor de um campo datetime-local no fuso da operação. */
export function paraEntradaLocal(isoUtc: string | null): string {
  if (isoUtc === null) return '';
  const instante = Date.parse(isoUtc);
  if (Number.isNaN(instante)) return '';
  return new Date(paredeNoFuso(instante)).toISOString().slice(0, 16);
}

/** Mês (AAAA-MM) de agora no fuso da operação. */
export function mesAtual(agora = Date.now()): string {
  return new Date(paredeNoFuso(agora)).toISOString().slice(0, 7);
}

/** Mês deslocado ("2026-12" + 1 → "2027-01"). */
export function deslocarMes(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

const formatoMes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });

/** "Outubro de 2026". */
export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  const texto = formatoMes.format(new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, 1)));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
