import { ESTADOS_CONFERENCIA, type EstadoConferencia } from '@praca-reversa/contracts';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { IconeImprimir } from '../../components/Icones';
import { SeloConferenciaExibida } from '../../components/Selos';
import { ROTULOS_CONFERENCIA } from './estados';
import { filtroAtivo, FILTRO_VAZIO, type Filtro, type GrupoPaletes } from './filtro';
import { SeloReconferencia } from './PrazoReconferencia';

/** Situação da consulta do filtro no servidor. */
export type EstadoFiltro =
  | { estado: 'inativo' }
  | { estado: 'filtrando' }
  | { estado: 'erro'; mensagem: string }
  | { estado: 'pronto'; total: number; truncado: boolean };

interface Props {
  grupos: readonly GrupoPaletes[];
  total: number;
  semEndereco: number;
  filtro: Filtro;
  estadoFiltro: EstadoFiltro;
  aoRepetirFiltro: () => void;
  selecionadoId: string | null;
  aoMudarFiltro: (filtro: Filtro) => void;
  aoEscolher: (id: string) => void;
  /** Enter na busca: código exato, ID ou link lido de um QR. */
  aoConfirmarBusca: (texto: string) => void;
  /** Abre a leitura pela câmera (etapa 09). */
  aoLerCodigo: () => void;
  /** Impressão das etiquetas do resultado do filtro (até o limite do lote). */
  aoImprimirResultado: (() => void) | null;
}

const PASSO_PAGINA = 10;

/**
 * Alternativa acessível ao mapa: os mesmos paletes, agrupados por fileira.
 * Um único item recebe Tab; setas, Home/End e PageUp/PageDown percorrem a
 * lista; Enter ou espaço escolhe e centraliza o palete no mapa.
 */
export function ListaPaletes({
  grupos,
  total,
  semEndereco,
  filtro,
  estadoFiltro,
  aoRepetirFiltro,
  selecionadoId,
  aoMudarFiltro,
  aoEscolher,
  aoConfirmarBusca,
  aoLerCodigo,
  aoImprimirResultado,
}: Props) {
  const listaRef = useRef<HTMLDivElement>(null);
  const ordem = useMemo(() => grupos.flatMap((g) => g.paletes.map((p) => p.id)), [grupos]);
  const [focoId, setFocoId] = useState<string | null>(selecionadoId);
  const [ultimaSelecao, setUltimaSelecao] = useState(selecionadoId);
  if (selecionadoId !== ultimaSelecao) {
    setUltimaSelecao(selecionadoId);
    if (selecionadoId !== null) setFocoId(selecionadoId);
  }
  const idFoco = focoId !== null && ordem.includes(focoId) ? focoId : (ordem[0] ?? null);
  const quantidade = ordem.length;
  const ativo = filtroAtivo(filtro);

  useEffect(() => {
    if (selecionadoId === null) return;
    const item = listaRef.current?.querySelector(`[data-id="${CSS.escape(selecionadoId)}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [selecionadoId]);

  function focar(id: string) {
    setFocoId(id);
    listaRef.current?.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(id)}"]`)?.focus();
  }

  function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
    if (idFoco === null) return;
    const atual = ordem.indexOf(idFoco);
    const destinos: Record<string, number> = {
      ArrowDown: atual + 1,
      ArrowUp: atual - 1,
      Home: 0,
      End: ordem.length - 1,
      PageDown: atual + PASSO_PAGINA,
      PageUp: atual - PASSO_PAGINA,
    };
    const destino = destinos[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    const id = ordem[Math.min(Math.max(destino, 0), ordem.length - 1)];
    if (id !== undefined) focar(id);
  }

  return (
    <div className="lista-paletes">
      <div className="filtro-lista" role="search" aria-label="Filtrar paletes">
        <label className="campo">
          <span className="campo-rotulo">Código, posição ou link do QR</span>
          <input
            type="search"
            value={filtro.texto}
            placeholder="Ex.: PAL-DEMO-002, F01-P03 ou 15 - A120"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-describedby="ajuda-busca"
            onChange={(e) => {
              aoMudarFiltro({ ...filtro, texto: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                aoConfirmarBusca(filtro.texto);
              }
            }}
          />
          <span id="ajuda-busca" className="campo-ajuda">
            Também filtra pelo endereço (ex.: 15 - A120). Enter abre o palete do código exato ou do link lido no QR (leitor-teclado ou digitação).
          </span>
        </label>
        <button type="button" className="botao-secundario botao-ler-codigo" onClick={aoLerCodigo} data-testid="ler-codigo-praca">
          Ler código (câmera)
        </button>
        <label className="campo">
          <span className="campo-rotulo">Conferência</span>
          <select
            value={filtro.conferencia}
            onChange={(e) => {
              aoMudarFiltro({ ...filtro, conferencia: e.target.value as EstadoConferencia | 'TODOS' });
            }}
          >
            <option value="TODOS">Todas as situações</option>
            {ESTADOS_CONFERENCIA.map((estado) => (
              <option key={estado} value={estado}>
                {ROTULOS_CONFERENCIA[estado].texto}
              </option>
            ))}
          </select>
        </label>
        <label className="opcao" data-testid="filtro-reconferencia">
          <input
            type="checkbox"
            checked={filtro.reconferencia === true}
            onChange={(e) => {
              aoMudarFiltro({ ...filtro, reconferencia: e.target.checked });
            }}
          />
          <span>
            <span aria-hidden="true">⟳</span> Precisam de reconferência
          </span>
        </label>
        <div className="filtro-resumo">
          <p aria-live="polite" data-testid="contagem-lista">
            {estadoFiltro.estado === 'filtrando'
              ? 'Filtrando no servidor…'
              : ativo
                ? `${String(quantidade)} de ${String(total)} paletes`
                : `${String(total)} paletes`}
            {!ativo && semEndereco > 0 ? ` · ${String(semEndereco)} sem posição` : ''}
          </p>
          {ativo && (
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                aoMudarFiltro(FILTRO_VAZIO);
              }}
            >
              Limpar filtro
            </button>
          )}
        </div>
        {ativo && <p className="filtro-nota">O filtro é feito no servidor e também esmaece no mapa os paletes fora do resultado.</p>}
        {aoImprimirResultado !== null && estadoFiltro.estado === 'pronto' && quantidade > 0 && (
          <button type="button" className="botao-secundario botao-compacto" onClick={aoImprimirResultado} data-testid="etiquetas-resultado">
            <IconeImprimir />
            Etiquetas do resultado ({quantidade})
          </button>
        )}
        {estadoFiltro.estado === 'pronto' && estadoFiltro.truncado && (
          <p className="filtro-nota" role="status">
            Mostrando os primeiros {quantidade} de {estadoFiltro.total}. Refine o filtro.
          </p>
        )}
        {estadoFiltro.estado === 'erro' && (
          <div className="estado-erro" role="alert">
            <p>Não foi possível filtrar. {estadoFiltro.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={aoRepetirFiltro}>
              Tentar novamente
            </button>
          </div>
        )}
      </div>

      <div className="lista-rolagem" ref={listaRef} onKeyDown={aoTeclar} aria-busy={estadoFiltro.estado === 'filtrando'}>
        {quantidade === 0 ? (
          <div className="estado-vazio">
            <p>{total === 0 ? 'Nenhum palete registrado nesta praça.' : 'Nenhum palete corresponde ao filtro.'}</p>
          </div>
        ) : (
          grupos.map((grupo) => (
            <section key={grupo.chave} className="grupo-lista" aria-labelledby={`grupo-${grupo.chave}`}>
              <h3 id={`grupo-${grupo.chave}`} className="grupo-titulo">
                {grupo.titulo}
                {grupo.subtitulo !== undefined && <span className="grupo-subtitulo"> · {grupo.subtitulo}</span>}
                <span className="grupo-quantidade"> ({grupo.paletes.length})</span>
              </h3>
              <ul>
                {grupo.paletes.map((palete) => (
                  <li key={palete.id}>
                    <button
                      type="button"
                      className="item-palete"
                      data-id={palete.id}
                      data-codigo={palete.code}
                      tabIndex={palete.id === idFoco ? 0 : -1}
                      aria-current={palete.id === selecionadoId ? 'true' : undefined}
                      onFocus={() => {
                        setFocoId(palete.id);
                      }}
                      onClick={() => {
                        aoEscolher(palete.id);
                      }}
                    >
                      <span className="item-linha">
                        <span className="item-codigo">{palete.code}</span>
                        <span className="item-endereco">{palete.positionCode ?? (palete.informedAddress ? `${palete.informedAddress} · mapa pendente` : 'Sem posição')}</span>
                      </span>
                      <span className="item-linha">
                        <SeloConferenciaExibida palete={palete} curto />
                        {palete.activeCountId !== null && <span className="item-alerta item-alerta--conferencia">✎ Em conferência</span>}
                        {palete.releaseState === 'BLOQUEADO' && <span className="item-alerta">Bloqueado</span>}
                        {palete.reconference?.due === true && <SeloReconferencia r={palete.reconference} />}
                      </span>
                      {palete.reconference && (
                        <span className="item-linha item-prazo" data-testid="item-prazo-reconferencia">
                          {String(palete.reconference.daysWithoutMovement)} {palete.reconference.daysWithoutMovement === 1 ? 'dia' : 'dias'} sem movimentação
                          {palete.reconference.due ? '' : ` · reconferência em ${String(palete.reconference.daysUntilDue)} ${palete.reconference.daysUntilDue === 1 ? 'dia' : 'dias'}`}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
