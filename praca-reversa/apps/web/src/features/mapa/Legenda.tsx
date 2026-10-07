import { ESTADOS_CONFERENCIA } from '@praca-reversa/contracts';
import { ROTULOS_CONFERENCIA } from '../paletes/estados';

/**
 * Legenda do mapa. O resumo (sempre visível no computador) traz as quatro
 * situações de conferência; ao abrir, mostra também posições e docas.
 */
export function Legenda() {
  return (
    <details className="legenda">
      <summary>
        <span className="legenda-titulo">Legenda</span>
        <span className="legenda-resumo" aria-hidden="true">
          {ESTADOS_CONFERENCIA.map((estado) => (
            <span key={estado} className="legenda-resumo-item">
              <span className={`amostra amostra--${estado}`} />
              {ROTULOS_CONFERENCIA[estado].curto}
            </span>
          ))}
        </span>
      </summary>
      <ul>
        {ESTADOS_CONFERENCIA.map((estado) => {
          const rotulo = ROTULOS_CONFERENCIA[estado];
          return (
            <li key={estado}>
              <span className={`amostra amostra--${estado}`} aria-hidden="true" />
              <span>
                <span aria-hidden="true">{rotulo.marcador} </span>
                {rotulo.texto}
              </span>
            </li>
          );
        })}
        <li>
          <span className="amostra amostra--selecionado" aria-hidden="true" />
          Palete selecionado
        </li>
        <li>
          <span className="amostra amostra--desconhecida" aria-hidden="true" />
          Posição com ocupação desconhecida (sem levantamento)
        </li>
        <li>
          <span className="amostra amostra--sem-registro" aria-hidden="true" />
          Posição sem palete registrado (não comprova vazia)
        </li>
        <li>
          <span className="amostra amostra--indisponivel" aria-hidden="true" />
          Posição indisponível
        </li>
        <li>
          <span className="amostra amostra--desativada" aria-hidden="true" />
          Área desativada (pronta para ativar; fora da capacidade ativa)
        </li>
        <li>
          <span className="amostra amostra--doca" aria-hidden="true" />
          Doca (somente no cenário fictício)
        </li>
      </ul>
      <p className="legenda-nota">Borda tracejada no palete: conteúdo ainda não conhecido por completo. Uma posição desenhada não comprova ocupação. Endereço real (ex.: 15 - A101) só aparece quando a correspondência foi confirmada.</p>
    </details>
  );
}
