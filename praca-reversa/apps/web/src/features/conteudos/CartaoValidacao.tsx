import { API_PREFIXO, ResumoValidacaoSchema } from '@praca-reversa/contracts';
import { useRecurso } from '../../api/use-recurso';
import './correcoes.css';

/**
 * Atalho compacto da fila interna "Validação urgente — sem endereço" (21 out.
 * 2026): fora do desenho da praça, não é posição nem ocupa capacidade. Só
 * aparece para perfis internos com a permissão e quando há pendências.
 */
export function CartaoValidacao({ versao, aoAbrir, compacto = false }: { versao: number; aoAbrir: () => void; compacto?: boolean }) {
  const { carga } = useRecurso(`${API_PREFIXO}/validacao/resumo`, ResumoValidacaoSchema, versao);
  const r = carga?.estado === 'pronto' ? carga.dados : null;
  if (r === null || r.total === 0) return null;
  return (
    <button type="button" className={compacto ? 'cartao-validacao cartao-validacao--compacto' : 'cartao-validacao'} onClick={aoAbrir} data-testid="cartao-validacao">
      <span className="cartao-validacao-valor">{r.total}</span>
      <span className="cartao-validacao-texto">
        <strong>Validação urgente — sem endereço</strong>
        <span>
          {r.total === 1 ? '1 conteúdo' : `${String(r.total)} conteúdos`} · {r.volumes} volume(s) fora do mapa
        </span>
      </span>
    </button>
  );
}
