import { ROTULOS_SITUACAO_JANELA, type JanelaCliente, type JanelaPainel, type PorRua, type SituacaoJanela, type TarefaPainel } from '@praca-reversa/contracts';
import { useId, type ReactNode } from 'react';
import type { Carga } from '../../api/use-recurso';
import { IconeAbrir, IconeAtualizar } from '../../components/Icones';
import { FUSO_OPERACAO, formatarData, formatarDataHora } from '../../utils/datas';
import { textoVolumesRua, volumes } from './formato';
import { barrasJanela, numerosJanela } from './resumo-dados';

/**
 * Peças do resumo em uma tela (etapa 4, 19 out. 2026): linha de filtros,
 * cartões compactos, painéis com título e uma ação, e os gráficos simples.
 * Os números vêm prontos da API (mesmas regras de antes); listas completas e
 * definições abrem ao clicar.
 */

const formatoHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_OPERACAO, timeStyle: 'short' });

/** Página do resumo: o título fica no cabeçalho do aplicativo (sem repetir título e descrição). */
export function PaginaPainel({ titulo, testId, children }: { titulo: string; testId: string; children: ReactNode }) {
  return (
    <main className="principal principal--pagina principal--painel" data-testid={testId}>
      <div className="painel-tela">
        <h2 className="visualmente-oculto">{titulo}</h2>
        {children}
      </div>
    </main>
  );
}

/** Linha curta de filtros: janela, período (opcional) e atualizar; horário da consulta em texto discreto. */
export function BarraFiltros({
  janelas,
  janela,
  aoEscolherJanela,
  periodo,
  aoAplicarPeriodo,
  consultadoEm,
  carga,
  aoAtualizar,
  acoes,
}: {
  janelas: readonly { id: string; code: string; name: string; situation: SituacaoJanela }[];
  janela: string | null;
  aoEscolherJanela: (id: string) => void;
  periodo?: { inicio: string; fim: string };
  aoAplicarPeriodo?: (inicio: string, fim: string) => void;
  consultadoEm: string;
  carga: Carga<unknown> | null;
  aoAtualizar: () => void;
  acoes?: ReactNode;
}) {
  const id = useId();
  return (
    <form
      className="painel-filtros-linha"
      aria-label="Filtros do painel"
      data-testid="painel-filtros"
      onSubmit={(evento) => {
        evento.preventDefault();
        const f = new FormData(evento.currentTarget);
        const texto = (nome: string) => {
          const x = f.get(nome);
          return typeof x === 'string' ? x : '';
        };
        // Período mudado: nova consulta pela URL; senão, só atualiza os números.
        if (periodo !== undefined && aoAplicarPeriodo !== undefined && (texto('inicio') !== periodo.inicio || texto('fim') !== periodo.fim)) aoAplicarPeriodo(texto('inicio'), texto('fim'));
        else aoAtualizar();
      }}
    >
      <label className="painel-filtro">
        <span>Janela</span>
        <select
          value={janela ?? ''}
          disabled={janelas.length === 0}
          onChange={(evento) => {
            aoEscolherJanela(evento.target.value);
          }}
          data-testid="painel-janela-escolha"
        >
          {janelas.length === 0 && <option value="">Nenhuma janela</option>}
          {janelas.map((j) => (
            <option key={j.id} value={j.id}>
              {j.code} · {j.name} ({ROTULOS_SITUACAO_JANELA[j.situation]})
            </option>
          ))}
        </select>
      </label>
      {periodo !== undefined && (
        <div className="painel-filtro" role="group" aria-labelledby={`${id}-periodo`} key={`${periodo.inicio}-${periodo.fim}`}>
          <span id={`${id}-periodo`} title="Filtra janelas e acontecimentos; o estoque é sempre o de agora.">
            Período
          </span>
          <input type="date" name="inicio" defaultValue={periodo.inicio} aria-label="Período: de" data-testid="painel-inicio" />
          <span aria-hidden="true">a</span>
          <input type="date" name="fim" defaultValue={periodo.fim} aria-label="Período: até" data-testid="painel-fim" />
        </div>
      )}
      <button type="submit" className="botao-secundario botao-compacto painel-atualizar" data-testid="painel-atualizar">
        <IconeAtualizar />
        Atualizar
      </button>
      <p className="painel-hora" title={`Consulta de ${formatarDataHora(consultadoEm)} (horário de Brasília); os números se atualizam sozinhos a cada minuto.`}>
        Atualizado às{' '}
        <time dateTime={consultadoEm} data-testid="painel-consultado-em">
          {formatoHora.format(new Date(consultadoEm))}
        </time>
        {carga?.estado === 'carregando' ? ' · atualizando…' : ''}
      </p>
      {acoes !== undefined && <div className="painel-filtros-acoes">{acoes}</div>}
      {carga?.estado === 'erro' && (
        <p className="painel-falha" role="alert" data-testid="painel-falha-atualizacao">
          <strong>Falha ao atualizar:</strong> {carga.mensagem} Os números são da consulta de {formatarDataHora(consultadoEm)}.
        </p>
      )}
    </form>
  );
}

export type TomResumo = 'neutro' | 'atencao' | 'alerta';
const MARCA: Record<Exclude<TomResumo, 'neutro'>, { simbolo: string; nome: string }> = {
  atencao: { simbolo: '◆', nome: 'Atenção' },
  alerta: { simbolo: '▲', nome: 'Ação necessária' },
};

/**
 * Cartão compacto: rótulo, valor (com unidade), no máximo uma linha de
 * contexto e uma ação. Cor de situação sempre com símbolo e texto; nada de
 * "em dia" sem base para avaliar.
 */
export function CartaoResumo({
  rotulo,
  valor,
  unidade,
  contexto,
  tom = 'neutro',
  destaque = false,
  aoAbrir,
  acao = 'ver lista',
  dica,
  testId,
}: {
  rotulo: string;
  valor: string;
  unidade?: string;
  contexto?: ReactNode;
  tom?: TomResumo;
  destaque?: boolean;
  aoAbrir?: () => void;
  acao?: string;
  dica?: string;
  testId: string;
}) {
  // Valor em texto ("Não informado", "Sem meta") fica menor que um número.
  const ehNumero = /^[\d.]+$/.test(valor);
  const classe = `resumo-cartao resumo-cartao--${tom}${destaque ? ' resumo-cartao--destaque' : ''}${aoAbrir ? ' resumo-cartao--clicavel' : ''}`;
  const conteudo = (
    <>
      <span className="resumo-cartao-rotulo">{rotulo}</span>
      <span className="resumo-cartao-numero">
        <strong className={`painel-card-valor resumo-cartao-valor${ehNumero ? '' : ' resumo-cartao-valor--texto'}`}>{valor}</strong>
        {unidade !== undefined && ehNumero && <span className="resumo-cartao-unidade">{unidade}</span>}
        {/* Situação junto do número: símbolo visível e nome para leitores de tela (cor nunca sozinha). */}
        {tom !== 'neutro' && (
          <span className="resumo-cartao-marca" title={MARCA[tom].nome}>
            <span aria-hidden="true">{MARCA[tom].simbolo}</span>
            <span className="visualmente-oculto">{MARCA[tom].nome}</span>
          </span>
        )}
      </span>
      {contexto !== undefined && <span className="resumo-cartao-contexto">{contexto}</span>}
      {aoAbrir !== undefined && (
        <>
          <span className="resumo-cartao-abrir" aria-hidden="true">
            <IconeAbrir />
          </span>
          <span className="visualmente-oculto"> — {acao}</span>
        </>
      )}
    </>
  );
  return aoAbrir ? (
    <button type="button" className={classe} onClick={aoAbrir} title={dica} data-testid={testId}>
      {conteudo}
    </button>
  ) : (
    <div className={classe} title={dica} data-testid={testId}>
      {conteudo}
    </div>
  );
}

/** Painel do resumo: título curto, uma ação no canto e o conteúdo. */
export function BlocoResumo({ titulo, acao, children, testId, classe }: { titulo: string; acao?: ReactNode; children: ReactNode; testId: string; classe?: string }) {
  const id = useId();
  return (
    <section className={`painel-bloco${classe ? ` ${classe}` : ''}`} aria-labelledby={id} data-testid={testId}>
      <header className="painel-bloco-topo">
        <h3 id={id}>{titulo}</h3>
        {acao}
      </header>
      {children}
    </section>
  );
}

/** Ação discreta do canto do painel (abre a lista, a tabela ou a rota de detalhe). */
export function AcaoBloco({ children, aoClicar, testId, rotulo }: { children: ReactNode; aoClicar: () => void; testId?: string; rotulo?: string }) {
  return (
    <button type="button" className="painel-acao" onClick={aoClicar} data-testid={testId} aria-label={rotulo}>
      {children}
      <IconeAbrir />
    </button>
  );
}

/** Janela selecionada: solicitado, separado, expedido e faltantes; barras de preparação e expedição só com meta válida. */
export function ResumoJanela({ janela, interno, vazio }: { janela: JanelaPainel | JanelaCliente | null; interno: boolean; vazio: string }) {
  if (janela === null) return <p className="painel-vazio">{vazio}</p>;
  const p = janela.progress;
  const barras = barrasJanela(p);
  const interna = interno && 'goalDifference' in janela ? janela : null;
  const excesso = interno && 'excessPrepared' in p ? p : null;
  return (
    <div className="resumo-janela" data-testid="progresso-janela">
      <p className="resumo-janela-nome">
        <strong>{janela.code}</strong> · {janela.name}
        <span className="resumo-nota">
          {' '}
          · {ROTULOS_SITUACAO_JANELA[janela.situation]}
          {janela.exitStart !== null ? ` · saída ${formatarData(janela.exitStart)}` : ' · saída sem data'}
        </span>
      </p>
      <dl className="resumo-numeros" aria-label="Volumes da janela">
        {numerosJanela(p).map((n) => (
          <div key={n.chave} className={`resumo-numero resumo-numero--${n.chave}`} title={n.dica}>
            <dt>{n.rotulo}</dt>
            <dd className={/^[\d.]+$/.test(n.texto) ? undefined : 'resumo-numero--texto'} data-testid={`janela-${n.chave}`}>
              {n.texto}
            </dd>
          </div>
        ))}
      </dl>
      {barras === null ? (
        <p className="resumo-nota">{p.requested === null ? 'Sem meta informada: sem porcentagem.' : (p.basisNote ?? 'Meta zero: sem porcentagem.')} Números em volumes.</p>
      ) : (
        <div className="resumo-barras">
          <BarraPercentual rotulo="Preparação" dica="(Separado + Expedido) ÷ Solicitado" largura={barras.larguraPreparacao} texto={barras.preparacao} serie="preparacao" testId="barra-preparacao" />
          <BarraPercentual rotulo="Expedição" dica="Expedido ÷ Solicitado" largura={barras.larguraExpedicao} texto={barras.expedicao} serie="expedicao" testId="barra-expedicao" />
        </div>
      )}
      {excesso !== null && (excesso.excessPrepared !== null || excesso.excessShipped !== null) && (
        <p className="resumo-alerta" data-testid="excesso-meta">
          <span aria-hidden="true">▲ </span>
          Acima da meta: {excesso.excessPrepared !== null ? `${volumes(excesso.excessPrepared)} preparado(s)` : ''}
          {excesso.excessShipped !== null ? ` · ${volumes(excesso.excessShipped)} expedido(s)` : ''} — conferir com o cliente.
        </p>
      )}
      {interna?.goalDifference != null && (
        <p className="resumo-alerta">
          <span aria-hidden="true">▲ </span>Meta e seleção diferem em {volumes(Math.abs(interna.goalDifference))} volume(s): revisar com o cliente.
        </p>
      )}
      {interna?.needsReview === true && (
        <p className="resumo-alerta">
          <span aria-hidden="true">▲ </span>Seleção revisada pelo cliente: conferir as preparações.
        </p>
      )}
    </div>
  );
}

function BarraPercentual({ rotulo, dica, largura, texto, serie, testId }: { rotulo: string; dica: string; largura: number; texto: string; serie: 'preparacao' | 'expedicao'; testId: string }) {
  return (
    <div className="resumo-barra" title={dica} data-testid={testId}>
      <span className="resumo-barra-rotulo">{rotulo}</span>
      <span className="resumo-barra-trilho" aria-hidden="true">
        <span className={`resumo-barra-cheia painel-barra--${serie}`} style={{ width: `${String(largura)}%` }} />
      </span>
      <span className="resumo-barra-texto">{texto}</span>
    </div>
  );
}

/** Partes de um todo numa barra segmentada, com legenda e números (cor nunca sozinha). */
export function BarraSegmentada({ partes, rotulo, total }: { partes: readonly { chave: string; rotulo: string; valor: number; dica?: string }[]; rotulo: string; total: string }) {
  const soma = partes.reduce((s, p) => s + p.valor, 0);
  return (
    <div className="resumo-situacao">
      <div className="resumo-segmentos" role="img" aria-label={`${rotulo}: ${partes.map((p) => `${p.rotulo.toLowerCase()} ${volumes(p.valor)}`).join(', ')}`}>
        {soma > 0 &&
          partes
            .filter((p) => p.valor > 0)
            .map((p) => <span key={p.chave} className={`resumo-segmento resumo-cor--${p.chave}`} style={{ flexGrow: p.valor }} title={`${p.rotulo}: ${volumes(p.valor)}`} />)}
      </div>
      <ul className={partes.length > 3 ? 'resumo-legenda resumo-legenda--colunas' : 'resumo-legenda'}>
        {partes.map((p) => (
          <li key={p.chave} title={p.dica} data-parte={p.chave}>
            <span className={`resumo-cor resumo-cor--${p.chave}`} aria-hidden="true" />
            <span>{p.rotulo}</span>
            <strong>{volumes(p.valor)}</strong>
          </li>
        ))}
      </ul>
      <p className="resumo-nota">{total}</p>
    </div>
  );
}

/** Volumes por rua em colunas (uma medida, unidade no rodapé); clique abre a lista da rua. */
export function VolumesPorRua({ ruas, aoAbrir }: { ruas: readonly PorRua[]; aoAbrir: (rua: string) => void }) {
  if (ruas.length === 0) return <p className="painel-vazio">Nenhum palete na praça.</p>;
  const valor = (r: PorRua) => (r.contents === 0 || r.contents === r.volumesUnknown ? null : r.volumes);
  const maximo = Math.max(...ruas.map((r) => valor(r) ?? 0), 1);
  const naoInformado = ruas.some((r) => valor(r) === null || r.volumesUnknown > 0);
  return (
    <figure className="resumo-colunas" data-testid="grafico-ruas">
      {ruas.every((r) => valor(r) === null) && <p className="painel-vazio">Nenhuma rua com volume informado ou contado. Toque numa rua para ver os paletes.</p>}
      <ul className="resumo-colunas-area">
        {ruas.map((r) => {
          const v = valor(r);
          const dica = `${r.street}: ${textoVolumesRua(r)} · ${volumes(r.pallets)} palete(s)`;
          return (
            <li key={r.street} data-rua={r.street}>
              <button
                type="button"
                className="resumo-coluna"
                aria-label={dica}
                title={dica}
                onClick={() => {
                  aoAbrir(r.street);
                }}
              >
                <span className="resumo-coluna-trilho" aria-hidden="true">
                  <span className="resumo-coluna-valor">{v === null ? 'n/i' : volumes(v)}</span>
                  <span className="resumo-coluna-barra" style={{ height: `${String(v === null ? 0 : (v / maximo) * 100)}%` }} />
                </span>
                <span className="resumo-coluna-rotulo" aria-hidden="true">
                  {r.street === 'Sem endereço confirmado' ? 'Sem endereço' : r.street}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <figcaption className="resumo-nota">Em volumes (contado; senão informado){naoInformado ? ' · n/i = não informado (não é zero)' : ''}</figcaption>
    </figure>
  );
}

const ROTULO_TAREFA: Record<TarefaPainel['kind'], string> = {
  RECONFERENCIA: 'Reconferência',
  SEPARACAO: 'Separação',
  LOCALIZACAO: 'Localização',
  NF_SEM_PALETE: 'NF sem palete',
};

/** Linhas de prioridade: marca do tipo (cor; o texto já diz o que fazer), o que fazer (abre o palete, a janela ou o inventário) e a data. */
export function ListaPrioridades({ itens, aoAbrir, testId }: { itens: readonly TarefaPainel[]; aoAbrir: (t: TarefaPainel) => void; testId?: string }) {
  return (
    <ul className="resumo-prioridades" data-testid={testId}>
      {itens.map((t, i) => (
        <li key={`${t.kind}-${t.palletId ?? t.windowId ?? t.label}-${String(i)}`} className={`resumo-prioridade resumo-prioridade--${t.kind.toLowerCase()}`}>
          <span className="resumo-prioridade-tipo" title={ROTULO_TAREFA[t.kind]}>
            <span className="visualmente-oculto">{ROTULO_TAREFA[t.kind]}: </span>
          </span>
          <button
            type="button"
            className="botao-link"
            onClick={() => {
              aoAbrir(t);
            }}
          >
            {t.label}
          </button>
          {t.since !== null && (
            <span className="resumo-nota">
              {t.kind === 'RECONFERENCIA' ? 'venceu' : 'prazo'} {formatarData(t.since)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
