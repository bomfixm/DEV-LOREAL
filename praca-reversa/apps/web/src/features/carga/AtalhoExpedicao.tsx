import { IconeCaminhao } from '../../components/Icones';
import type { Rota } from '../../rotas';
import { useSelecaoExpedicao } from './selecao-expedicao';
import './voo-carrinho.css';

/**
 * Atalho flutuante "Expedição · N" no canto do mapa: aparece com a primeira
 * nota na seleção (veículos em montagem) e some quando ela esvazia. Abre a
 * Expedição que já existe — no veículo, se a seleção estiver num só.
 */
export function AtalhoExpedicao({ ativo, versao, aoNavegar }: { ativo: boolean; versao: number; aoNavegar: (rota: Rota) => void }) {
  const selecao = useSelecaoExpedicao(ativo, versao);
  const notas = selecao?.notes ?? 0;
  if (selecao === null || notas === 0) return null;
  const [unico] = selecao.vehicles;
  const janelas = new Set(selecao.vehicles.map((v) => v.windowId));
  const destino: Rota =
    selecao.vehicles.length === 1 && unico
      ? { tipo: 'carga', janela: unico.windowId, veiculo: unico.id, visao: 'operacao' }
      : { tipo: 'carga', janela: janelas.size === 1 ? (unico?.windowId ?? null) : null, veiculo: null, visao: 'operacao' };
  const texto = `${String(notas)} ${notas === 1 ? 'nota' : 'notas'}`;
  return (
    <button
      type="button"
      className="atalho-expedicao"
      data-atalho-expedicao=""
      data-testid="atalho-expedicao"
      data-notas={notas}
      aria-label={`Expedição: ${texto} na seleção atual. Abrir a Expedição`}
      title={`${texto} em ${String(selecao.vehicles.length)} veículo(s) em montagem. Abrir a Expedição`}
      onClick={() => {
        aoNavegar(destino);
      }}
    >
      <IconeCaminhao />
      <span>Expedição</span>
      <span className="atalho-expedicao-contador" aria-hidden="true">
        · {notas}
      </span>
    </button>
  );
}
