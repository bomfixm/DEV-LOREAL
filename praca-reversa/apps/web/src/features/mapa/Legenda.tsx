import { ESTADOS_CONFERENCIA } from '@praca-reversa/contracts';
import { ROTULOS_CONFERENCIA, ROTULOS_ESTADO_VOLUMES } from '../paletes/estados';

const ESTADOS_VOLUMES = ['CONFERIDO', 'CONFERIDO_COM_DIFERENCA'] as const;

/**
 * Legenda do mapa (front aprovado): o preenchimento mostra ocupação e agenda
 * (verde = palete livre, neutro = estoque, lilás = separação para agenda); a
 * conferência aparece no contorno e no marcador do rótulo. Ao abrir, mostra
 * também posições e docas.
 */
export function Legenda({ nota = null }: { nota?: string | null }) {
  return (
    <details className="legenda">
      <summary>
        <span className="legenda-titulo">Legenda</span>
        <span className="legenda-resumo" aria-hidden="true">
          <span className="legenda-resumo-item">
            <span className="amostra amostra--livre" />
            Palete livre
          </span>
          <span className="legenda-resumo-item">
            <span className="amostra amostra--estoque" />
            Estoque
          </span>
          <span className="legenda-resumo-item">
            <span className="amostra amostra--agenda" />
            Separação para agenda
          </span>
          <span className="legenda-resumo-item">
            <span className="amostra amostra--reconferencia" />
            Reconferência necessária
          </span>
          {ESTADOS_CONFERENCIA.map((estado) => (
            <span key={estado} className="legenda-resumo-item">
              <span className={`amostra amostra--${estado}`} />
              {ROTULOS_CONFERENCIA[estado].curto}
            </span>
          ))}
          {ESTADOS_VOLUMES.map((estado) => (
            <span key={estado} className="legenda-resumo-item">
              <span className={`amostra amostra--${estado}`} />
              {ROTULOS_ESTADO_VOLUMES[estado].curto}
            </span>
          ))}
        </span>
      </summary>
      <ul>
        <li>
          <span className="amostra amostra--livre" aria-hidden="true" />
          <span>
            <strong>PALETE LIVRE</strong> — posição com desocupação confirmada, pronta para receber o próximo palete (verde só para isso)
          </span>
        </li>
        <li>
          <span className="amostra amostra--estoque" aria-hidden="true" />
          <span>Palete em estoque (preenchimento neutro; a conferência aparece no contorno e no rótulo)</span>
        </li>
        <li>
          <span className="amostra amostra--agenda" aria-hidden="true" />
          <span>
            <strong>Separação para agenda</strong> — palete com material reservado para uma janela (rótulo "AGENDA"); reservar não é saída nem libera a posição
          </span>
        </li>
        <li>
          <span className="amostra amostra--reconferencia" aria-hidden="true" />
          <span>
            <strong>⟳ Reconferência necessária</strong> — 20 dias sem movimentação nem reconferência completa (laranja, junto dos demais marcadores); não muda conferência, liberação nem reserva
          </span>
        </li>
        {ESTADOS_CONFERENCIA.map((estado) => {
          const rotulo = ROTULOS_CONFERENCIA[estado];
          return (
            <li key={estado}>
              <span className={`amostra amostra--${estado}`} aria-hidden="true" />
              <span>
                <span aria-hidden="true">{rotulo.marcador} </span>
                Contorno: {rotulo.texto}
              </span>
            </li>
          );
        })}
        {ESTADOS_VOLUMES.map((estado) => {
          const rotulo = ROTULOS_ESTADO_VOLUMES[estado];
          return (
            <li key={estado}>
              <span className={`amostra amostra--${estado}`} aria-hidden="true" />
              <span>
                <span aria-hidden="true">{rotulo.marcador} </span>
                Contorno: {rotulo.texto} (conferência de volumes; o preenchimento continua sendo a ocupação)
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
          Posição sem palete registrado (não comprova vazia: confirme no local para marcar como livre)
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
      {/* Sem a coluna da lista (etapa 2), a nota do layout fica aqui. */}
      {nota !== null && (
        <p className="legenda-nota" data-testid="nota-layout">
          {nota}
        </p>
      )}
    </details>
  );
}
