import { API_PREFIXO, ConteudosPaleteSchema, type PaleteResumo } from '@praca-reversa/contracts';
import type { Ref } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAlvo, IconeFechar } from '../../components/Icones';
import { SeloConferencia } from '../../components/Selos';
import { formatarQuantidade } from '../../utils/numeros';
import { ROTULOS_FLUXO } from './estados';
import { textoSequenciaFull, volumesDoPalete } from './volumes';
import { SeloReconferencia } from './PrazoReconferencia';

interface Props {
  palete: PaleteResumo;
  /** Endereço operacional ("16 - A101") da posição ou o informado no inventário; `null` = sem endereço. */
  endereco: string | null;
  /** No celular fica sobre a base do mapa; no computador, no painel ao lado. */
  compacto: boolean;
  /** Aumenta depois de gravações: documentos consultados de novo. */
  versao: number;
  verMaisRef: Ref<HTMLButtonElement>;
  aoVerMais: () => void;
  aoCentralizar: () => void;
  aoFechar: () => void;
  /** "Conferir palete" (conferência de volumes, com a reconferência completa); `null` = sem permissão. */
  aoConferir?: (() => void) | null;
}

/** Documentos, volumes e FULL do palete, das notas vinculadas (nada presumido quando falta informação). */
function Composicao({ paleteId, versao }: { paleteId: string; versao: number }) {
  const { carga } = useRecurso(`${API_PREFIXO}/paletes/${paleteId}/conteudos`, ConteudosPaleteSchema, versao);
  if (carga === null || carga.estado === 'carregando') return <p className="resumo-composicao estado-carregando">Carregando conteúdo…</p>;
  if (carga.estado === 'erro') return <p className="resumo-composicao pendente">Conteúdo indisponível agora ({carga.mensagem}).</p>;
  const { items, documents, withoutDocument, full } = carga.dados;
  if (items.length === 0) {
    return (
      <p className="resumo-composicao" data-testid="resumo-composicao">
        Nenhum conteúdo registrado · volumes não informados
      </p>
    );
  }
  // Documentos = notas identificadas distintas (várias Deliveries da mesma nota contam 1); volumes = contagens deste palete.
  const { total, pendentes } = volumesDoPalete(items);
  const sequencia = full === 'FULL' ? textoSequenciaFull(items.find((i) => i.palletFull !== null)?.palletFull ?? null) : null;
  return (
    <p className="resumo-composicao" data-testid="resumo-composicao">
      <span>
        {documents} {documents === 1 ? 'documento' : 'documentos'}
        {withoutDocument > 0 && ` + ${String(withoutDocument)} sem documento`}
      </span>
      <span className={total === null ? 'pendente' : undefined} data-testid="resumo-volumes">
        {total === null ? 'Aguardando conferência' : `${formatarQuantidade(total)} volumes contados`}
        {total !== null && pendentes > 0 && ` · ${String(pendentes)} aguardando conferência`}
      </span>
      {full === 'FULL' && (
        <span className="resumo-full" data-testid="resumo-full">
          FULL{sequencia !== null && ` · ${sequencia}`}
        </span>
      )}
    </p>
  );
}

/**
 * Resumo do palete selecionado (ajustes de 08/10/2026): número operacional,
 * endereço, situação, documentos e volumes. "Ver mais" abre a consulta
 * completa; nada abre sozinho ao entrar na tela ou ao pesquisar.
 */
export function ResumoSelecao({ palete, endereco, compacto, versao, verMaisRef, aoVerMais, aoCentralizar, aoFechar, aoConferir = null }: Props) {
  return (
    <section
      className={compacto ? 'resumo-selecao' : 'resumo-selecao resumo-selecao--painel'}
      aria-label={`Palete selecionado: ${palete.code}`}
      data-testid="resumo-selecao"
      data-palete-id={palete.id}
    >
      <div className="resumo-info">
        <p className="resumo-codigo">
          <span className="resumo-rotulo">Palete</span> {palete.code}
        </p>
        <p className="resumo-endereco" data-testid="resumo-endereco">
          {endereco ?? (palete.positionCode !== null ? `Posição ${palete.positionCode}` : 'Sem endereço registrado')}
        </p>
        <SeloConferencia estado={palete.countState} />
      </div>
      {palete.flowState === 'RESERVADO' && (
        <p className="resumo-situacao">
          <span className="selo-agenda" data-testid="resumo-agenda">
            Separação para agenda
          </span>
        </p>
      )}
      {palete.reconference && (
        <p className="resumo-situacao" data-testid="resumo-reconferencia">
          <SeloReconferencia r={palete.reconference} />
          <span>
            {String(palete.reconference.daysWithoutMovement)} {palete.reconference.daysWithoutMovement === 1 ? 'dia' : 'dias'} sem movimentação
          </span>
        </p>
      )}
      <p className="resumo-situacao">
        {ROTULOS_FLUXO[palete.flowState]}
        {palete.activeCountId !== null && <span className="item-alerta item-alerta--conferencia">✎ Em conferência</span>}
      </p>
      <Composicao key={palete.id} paleteId={palete.id} versao={versao} />
      <div className="resumo-acoes">
        <button type="button" className="botao-primario" ref={verMaisRef} onClick={aoVerMais} data-tutorial="ver-conteudo" data-testid="ver-mais">
          Ver mais
        </button>
        {aoConferir !== null && palete.reconference !== null && (
          <button type="button" className={palete.reconference.due ? 'botao-primario' : 'botao-secundario'} onClick={aoConferir} data-testid="resumo-conferir-palete">
            Conferir palete
          </button>
        )}
        <button
          type="button"
          className="botao-secundario botao-icone"
          onClick={aoCentralizar}
          disabled={palete.positionId === null}
          aria-label="Centralizar no mapa"
          title="Centralizar no mapa"
        >
          <IconeAlvo />
        </button>
        <button type="button" className="botao-secundario botao-icone" onClick={aoFechar} aria-label="Fechar seleção" title="Fechar seleção">
          <IconeFechar />
        </button>
      </div>
    </section>
  );
}
