import type { ResultadoAcaoConteudos, ResultadoConferenciaVolumes } from '@praca-reversa/contracts';
import { formatarDataHora } from '../../utils/datas';

/** Texto curto da conferência gravada (aviso depois de fechar a tela). */
export function textoResultadoConferencia(r: ResultadoConferenciaVolumes): string {
  const base = `Palete ${r.palletCode}: conferência ${r.scope === 'COMPLETA' ? 'completa' : 'parcial'} registrada (${String(r.items)} conteúdo(s))`;
  const dif = r.differences.filter((d) => d.difference !== null && d.difference !== 0);
  const diferencas =
    dif.length === 0
      ? ' sem diferença.'
      : ` com ${String(dif.length)} diferença(s): ${dif
          .slice(0, 3)
          .map((d) => `${d.document} ${String(d.previous)} → ${String(d.counted)} (${(d.difference ?? 0) > 0 ? '+' : ''}${String(d.difference)})`)
          .join('; ')}${dif.length > 3 ? '…' : ''}.`;
  const prazo = r.scope === 'COMPLETA' && r.reconference !== null ? ` Próxima reconferência: ${formatarDataHora(r.reconference.nextAt)}.` : '';
  return `${base}${diferencas}${prazo}`;
}

/** Resumo da correção gravada (mover, validação, cancelar, resolver). */
export function textoResultadoAcao(r: ResultadoAcaoConteudos): string {
  const n = `${String(r.affected)} conteúdo(s)`;
  const vol = `${String(r.volumes)} volume(s)${r.withoutVolumes > 0 ? ` + ${String(r.withoutVolumes)} sem quantidade` : ''}`;
  const base =
    r.action === 'MOVER'
      ? `${n} movido(s) do palete ${r.origin?.code ?? ''} para o palete ${r.destination?.code ?? ''}${r.destination?.created ? ' (palete novo)' : ''} — ${vol}.`
      : r.action === 'VALIDACAO'
        ? `${n} do palete ${r.origin?.code ?? ''} enviado(s) para a validação sem endereço — ${vol}.`
        : r.action === 'CANCELAR'
          ? `${n} cancelado(s) no palete ${r.origin?.code ?? ''} — ${vol} retirado(s) do estoque ativo.`
          : `${n} alocado(s) no palete ${r.destination?.code ?? ''}${r.destination?.created ? ' (palete novo)' : ''} — ${vol}.`;
  return r.warnings.length === 0 ? base : `${base} ${r.warnings.join(' ')}`;
}
