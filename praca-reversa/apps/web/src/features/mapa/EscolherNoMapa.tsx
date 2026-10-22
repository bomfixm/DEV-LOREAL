import { API_PREFIXO, ListaPaletesSchema, PracaSchema, type DestinoOcorrencia } from '@praca-reversa/contracts';
import { useRef, useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeMais, IconeMenos } from '../../components/Icones';
import type { MargensMapa } from './controlador-mapa';
import { MapaPraca, type MapaPracaHandle } from './MapaPraca';
import './escolher-no-mapa.css';

const MARGENS: MargensMapa = { topo: 12, direita: 56, base: 12, esquerda: 12 };

export interface DestinoEscolhido {
  destino: DestinoOcorrencia;
  /** Texto para o operador: "Palete 300 (15 - A120)" ou "Posição livre 15 - A122 — palete novo". */
  descricao: string;
  /** O destino já tem palete (pode ter conteúdo: a API pede confirmação). */
  ocupado: boolean;
}

/**
 * Escolha do destino no mapa da praça (mover conteúdos, resolver a
 * validação): palete existente (o conteúdo é acrescentado, número
 * preservado) ou posição vazia (palete novo pelo cadastro existente). Também
 * aceita procurar o palete pelo número.
 */
export function EscolherNoMapa({ aoEscolher, excluirPaleteId = null }: { aoEscolher: (d: DestinoEscolhido) => void; excluirPaleteId?: string | null }) {
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/praca`, PracaSchema);
  const mapa = useRef<MapaPracaHandle>(null);
  const [busca, setBusca] = useState('');
  const termo = busca.trim();
  const lista = useRecurso(termo.length >= 1 ? `${API_PREFIXO}/paletes?texto=${encodeURIComponent(termo)}&limite=10` : null, ListaPaletesSchema);
  const achados = lista.carga?.estado === 'pronto' ? lista.carga.dados.items.filter((p) => p.flowState !== 'EXPEDIDO' && p.id !== excluirPaleteId) : [];
  const dados = carga?.estado === 'pronto' ? carga.dados : null;
  const enderecoDe = (posicaoId: string | null): string | null => {
    const p = posicaoId === null ? undefined : dados?.layout?.positions.find((x) => x.id === posicaoId);
    return p === undefined ? null : p.address?.state === 'CONFIRMADO' ? p.address.text : p.code;
  };
  const escolherPalete = (id: string) => {
    const p = dados?.pallets.find((x) => x.id === id) ?? achados.find((x) => x.id === id);
    if (!p || p.id === excluirPaleteId) return;
    const endereco = enderecoDe(p.positionId) ?? p.informedAddress ?? null;
    aoEscolher({ destino: { kind: 'PALETE', id: p.id }, descricao: `Palete ${p.code}${endereco === null ? '' : ` (${endereco})`}`, ocupado: true });
  };
  return (
    <div className="escolha-mapa" data-testid="escolher-no-mapa">
      <p className="campo-ajuda">
        Clique num <strong>palete</strong> para acrescentar a ele (o número e o conteúdo dele ficam) ou numa <strong>posição vazia</strong> para cadastrar um palete novo ali (número pela série do piso).
      </p>
      <div className="escolha-mapa-area">
        {carga === null || carga.estado === 'carregando' ? (
          <p className="estado-carregando">Carregando o mapa…</p>
        ) : carga.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>{carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={recarregar}>
              <IconeAtualizar />
              Tentar novamente
            </button>
          </div>
        ) : dados?.layout === null || dados === null ? (
          <p className="estado-vazio">Esta praça ainda não tem layout cadastrado: procure o palete pelo número abaixo.</p>
        ) : (
          <>
            <MapaPraca
              ref={mapa}
              layout={dados.layout}
              paletes={dados.pallets}
              selecionadoId={null}
              idsVisiveis={null}
              margens={MARGENS}
              aoSelecionar={escolherPalete}
              aoEscolherPosicao={(id) => {
                const ocupante = dados.pallets.find((x) => x.positionId === id);
                if (ocupante) {
                  escolherPalete(ocupante.id);
                  return;
                }
                aoEscolher({ destino: { kind: 'POSICAO', id }, descricao: `Posição vazia ${enderecoDe(id) ?? ''} — palete novo`, ocupado: false });
              }}
              aoMudarVisao={() => undefined}
            />
            <div className="escolha-mapa-zoom">
              <button type="button" className="botao-secundario botao-icone" onClick={() => mapa.current?.ampliar()} aria-label="Aproximar">
                <IconeMais />
              </button>
              <button type="button" className="botao-secundario botao-icone" onClick={() => mapa.current?.reduzir()} aria-label="Afastar">
                <IconeMenos />
              </button>
            </div>
          </>
        )}
      </div>
      <label className="campo">
        <span className="campo-rotulo">Ou procure o palete de destino pelo número</span>
        <input
          type="search"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
          }}
          placeholder="Ex.: 256, PR-000123 ou 15 - A120"
          data-testid="escolher-busca"
        />
      </label>
      {termo.length >= 1 && lista.carga?.estado === 'pronto' && achados.length === 0 && <p className="campo-ajuda">Nenhum palete encontrado.</p>}
      {achados.length > 0 && (
        <ul className="lista-documentos">
          {achados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="botao-link"
                onClick={() => {
                  escolherPalete(p.id);
                }}
                data-testid="escolher-palete"
              >
                Palete {p.code}
                {p.legacyCode !== null && ` (antes ${p.legacyCode})`}
                {p.positionId !== null ? ` · ${enderecoDe(p.positionId) ?? p.positionCode ?? ''}` : p.informedAddress ? ` · ${p.informedAddress}` : ' · sem posição'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
