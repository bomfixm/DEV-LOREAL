import type { IndicadoresConferencia } from '@praca-reversa/contracts';
import { useId, type ReactNode } from 'react';
import { IconeAbrir } from '../../components/Icones';
import { ROTULOS_CONFERENCIA } from '../paletes/estados';
import { barrasConferencia, contagem, type UsoPosicoes } from './dashboard-dados';

/**
 * Peças do dashboard de Indicadores: indicador principal, módulo, anel de
 * ocupação e barras por estado. Cor sempre acompanhada de texto; número sem
 * base aparece como texto, nunca como zero.
 */

export type TomCartao = 'amarelo' | 'claro' | 'grafite' | 'suave';

/**
 * Indicador do topo: momento (posição atual × período), nome, número com
 * unidade e uma linha de contexto. Só vira botão quando há detalhe da mesma
 * métrica para abrir.
 */
export function Kpi({
  rotulo,
  quando,
  valor,
  unidade,
  contexto,
  selo,
  icone,
  tom,
  aoAbrir,
  acao,
  testId,
}: {
  rotulo: string;
  quando: string;
  valor: string;
  unidade?: string;
  contexto?: ReactNode;
  selo?: ReactNode;
  icone: ReactNode;
  tom: TomCartao;
  aoAbrir?: () => void;
  acao?: string;
  testId: string;
}) {
  const numero = /^[\d.]+$/.test(valor);
  const corpo = (
    <>
      <span className="ind-kpi-topo">
        <span className="ind-kpi-rotulo">{rotulo}</span>
        <span className="ind-kpi-icone" aria-hidden="true">
          {icone}
        </span>
      </span>
      <span className="ind-kpi-quando">{quando}</span>
      <span className="ind-kpi-numero">
        <strong className={numero ? 'ind-kpi-valor' : 'ind-kpi-valor ind-kpi-valor--texto'} data-testid={`${testId}-valor`}>
          {valor}
        </strong>
        {unidade !== undefined && numero && <span className="ind-kpi-unidade">{unidade}</span>}
        {selo}
      </span>
      {contexto !== undefined && <span className="ind-kpi-contexto">{contexto}</span>}
      {aoAbrir !== undefined && (
        <>
          <span className="ind-kpi-abrir" aria-hidden="true">
            <IconeAbrir />
          </span>
          <span className="visualmente-oculto"> — {acao ?? 'ver detalhe'}</span>
        </>
      )}
    </>
  );
  const classe = `ind-kpi ind-cartao ind-cartao--${tom}${aoAbrir ? ' ind-kpi--clicavel' : ''}`;
  return aoAbrir ? (
    <button type="button" className={classe} onClick={aoAbrir} title={acao} data-testid={testId}>
      {corpo}
    </button>
  ) : (
    <div className={classe} data-testid={testId}>
      {corpo}
    </div>
  );
}

/** Módulo com título, subtítulo curto, ação no canto e conteúdo. */
export function Modulo({
  titulo,
  subtitulo,
  selo,
  acao,
  tom = 'claro',
  classe,
  children,
  testId,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  selo?: ReactNode;
  acao?: ReactNode;
  tom?: TomCartao;
  classe?: string;
  children: ReactNode;
  testId: string;
}) {
  const id = useId();
  return (
    <section className={`ind-modulo ind-cartao ind-cartao--${tom}${classe ? ` ${classe}` : ''}`} aria-labelledby={id} data-testid={testId}>
      <header className="ind-modulo-topo">
        <div className="ind-modulo-titulos">
          <h3 id={id}>{titulo}</h3>
          {subtitulo !== undefined && <p className="ind-modulo-sub">{subtitulo}</p>}
        </div>
        {selo}
        {acao}
      </header>
      {children}
    </section>
  );
}

/** Ação discreta do canto do módulo (abre a aba ou o relatório da mesma métrica). */
export function AcaoModulo({ children, aoClicar, testId }: { children: ReactNode; aoClicar: () => void; testId?: string }) {
  return (
    <button type="button" className="ind-acao nao-imprimir" onClick={aoClicar} data-testid={testId}>
      {children}
      <IconeAbrir />
    </button>
  );
}

/** Selo curto junto ao número (base provisória, demonstração). */
export function Selo({ children, tom = 'aviso', testId }: { children: ReactNode; tom?: 'aviso' | 'neutro'; testId?: string }) {
  return (
    <span className={`ind-selo ind-selo--${tom}`} data-testid={testId}>
      {children}
    </span>
  );
}

/** Número com nome e nota curta, para as listas de detalhe. */
export function Numero({ rotulo, valor, nota, testId }: { rotulo: string; valor: ReactNode; nota?: ReactNode; testId?: string }) {
  return (
    <div className="ind-numero" data-testid={testId}>
      <dt>{rotulo}</dt>
      <dd>
        <strong className="ind-numero-valor">{valor}</strong>
        {nota !== undefined && <span className="ind-numero-nota">{nota}</span>}
      </dd>
    </div>
  );
}

/**
 * Anel de ocupação: ocupadas (amarelo) sobre as livres (trilho) da mesma
 * base de posições elegíveis. O percentual exibido é o da API.
 */
export function AnelOcupacao({ uso, percentual, provisoria, testId }: { uso: UsoPosicoes; percentual: string; provisoria: boolean; testId: string }) {
  const raio = 52;
  const circunferencia = 2 * Math.PI * raio;
  const fracao = uso.fracao ?? 0;
  const descricao = `Ocupação${provisoria ? ' provisória' : ''} ${percentual}: ${contagem(uso.ocupadas)} ocupadas e ${contagem(uso.livres)} livres de ${contagem(uso.base)} posições elegíveis`;
  return (
    <figure className="ind-anel" data-testid={testId}>
      <svg viewBox="0 0 128 128" role="img" aria-label={descricao}>
        <circle className="ind-anel-trilho" cx="64" cy="64" r={raio} />
        {fracao > 0 && (
          <circle
            className="ind-anel-cheio"
            cx="64"
            cy="64"
            r={raio}
            strokeDasharray={`${String(circunferencia * fracao)} ${String(circunferencia)}`}
            transform="rotate(-90 64 64)"
          />
        )}
      </svg>
      <figcaption className="ind-anel-centro" aria-hidden="true">
        <strong>{percentual}</strong>
        <span>{provisoria ? 'provisória' : 'ocupação'}</span>
      </figcaption>
    </figure>
  );
}

/**
 * Paletes por estado de conferência (posição atual): uma barra por estado,
 * com nome completo e contagem. Os estados são exclusivos e cobrem os paletes
 * na praça; sessões e observações nunca entram aqui.
 */
export function BarrasConferencia({
  conferencia,
  aoAbrir,
  prefixo,
}: {
  conferencia: IndicadoresConferencia;
  aoAbrir: ((estado: string) => void) | null;
  prefixo: string;
}) {
  const { barras } = barrasConferencia(conferencia);
  return (
    <ul className="ind-barras">
      {barras.map((b) => {
        const nome = ROTULOS_CONFERENCIA[b.estado].texto;
        return (
          <li key={b.estado} className="ind-barra-linha" data-testid={`${prefixo}${b.estado}`} title={ROTULOS_CONFERENCIA[b.estado].descricao}>
            <span className="ind-barra-nome">{nome}</span>
            {aoAbrir === null ? (
              <strong className="ind-barra-valor">{contagem(b.valor)}</strong>
            ) : (
              <button
                type="button"
                className="ind-barra-valor ind-barra-botao"
                onClick={() => {
                  aoAbrir(b.estado);
                }}
              >
                {contagem(b.valor)}
                <span className="visualmente-oculto"> — ver os paletes: {nome}</span>
              </button>
            )}
            <span className="ind-barra-trilho" aria-hidden="true">
              <span className={`ind-barra ind-barra--${b.estado}`} style={{ width: `${String(b.fracao * 100)}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
