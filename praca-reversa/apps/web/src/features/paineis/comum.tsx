import { ROTULO_ETAPA_SELECAO, ROTULO_EVENTO_CLIENTE, type EventoCliente, type LinhaEstoqueCliente, type PorRua, type ProgressoCliente, type ProgressoVolumes } from '@praca-reversa/contracts';
import { useState, type ReactNode } from 'react';
import type { Carga } from '../../api/use-recurso';
import { IconeAbrir, IconeAtualizar } from '../../components/Icones';
import { formatarDataHora } from '../../utils/datas';
import { ROTULO_FULL, porcento, textoVolumesRua, volumes, type ValoresFiltro } from './formato';

/** Data/hora da consulta e falha da atualização (os números exibidos são os da última consulta bem-sucedida). */
export function Atualizacao({ consultadoEm, carga, aoAtualizar }: { consultadoEm: string; carga: Carga<unknown> | null; aoAtualizar: () => void }) {
  return (
    <div className="painel-atualizacao" data-testid="painel-atualizacao">
      <p>
        Consultado em <strong data-testid="painel-consultado-em">{formatarDataHora(consultadoEm)}</strong> (horário de Brasília) · atualiza sozinho a cada minuto
        {carga?.estado === 'carregando' ? ' · atualizando…' : ''}
      </p>
      {carga?.estado === 'erro' && (
        <p className="mensagem-conflito" role="alert" data-testid="painel-falha-atualizacao">
          <strong>Falha ao atualizar:</strong> {carga.mensagem} Os números abaixo são da consulta de {formatarDataHora(consultadoEm)}.
        </p>
      )}
      <button type="button" className="botao-secundario botao-compacto" onClick={aoAtualizar} data-testid="painel-atualizar">
        <IconeAtualizar />
        Atualizar agora
      </button>
    </div>
  );
}

export type Tom = 'neutro' | 'atencao' | 'alerta' | 'ok';
const MARCADOR: Record<Tom, string> = { neutro: '', atencao: '◆ Atenção', alerta: '▲ Ação necessária', ok: '✓ Em dia' };

/**
 * Card do painel; com `aoAbrir`, abre a lista correspondente com os mesmos filtros.
 * `destaque`: o número principal da tela, em amarelo DHL cheio (um por tela).
 */
export function Card({
  titulo,
  valor,
  nota,
  tom = 'neutro',
  destaque = false,
  aoAbrir,
  testId,
}: {
  titulo: string;
  valor: ReactNode;
  nota?: ReactNode;
  tom?: Tom;
  destaque?: boolean;
  aoAbrir?: () => void;
  testId: string;
}) {
  const classe = `painel-card painel-card--${tom}${destaque ? ' painel-card--destaque' : ''}`;
  const conteudo = (
    <>
      <span className="painel-card-titulo">{titulo}</span>
      <strong className="painel-card-valor">{valor}</strong>
      {nota !== undefined && <span className="painel-card-nota">{nota}</span>}
      {MARCADOR[tom] !== '' && <span className={`painel-card-marcador painel-card-marcador--${tom}`}>{MARCADOR[tom]}</span>}
      {aoAbrir !== undefined && (
        <span className="painel-card-abrir">
          <IconeAbrir />
          <span className="visualmente-oculto">Ver lista</span>
        </span>
      )}
    </>
  );
  return aoAbrir ? (
    <button type="button" className={`${classe} painel-card--clicavel`} onClick={aoAbrir} data-testid={testId}>
      {conteudo}
    </button>
  ) : (
    <div className={classe} data-testid={testId}>
      {conteudo}
    </div>
  );
}

/** Posições ativas como parte do todo: ocupadas, livres confirmadas e com ocupação desconhecida. */
export function AnelOcupacao({
  ocupadas,
  livres,
  desconhecidas,
  desativadas,
  provisoria,
}: {
  ocupadas: number;
  livres: number;
  desconhecidas: number;
  desativadas: number;
  provisoria: boolean;
}) {
  const total = ocupadas + livres + desconhecidas;
  const partes = [
    { chave: 'ocupadas', rotulo: 'Ocupadas', valor: ocupadas },
    { chave: 'livres', rotulo: 'Livres confirmadas', valor: livres },
    { chave: 'desconhecidas', rotulo: 'Ocupação desconhecida', valor: desconhecidas },
  ];
  const raio = 52;
  const volta = 2 * Math.PI * raio;
  // Folga de 3 unidades entre partes vizinhas (o fundo separa as cores, sem contorno).
  const folga = partes.filter((p) => p.valor > 0).length > 1 ? 3 : 0;
  let inicio = 0;
  const arcos = partes.map((p) => {
    const comprimento = total > 0 ? (p.valor / total) * volta : 0;
    const arco = { ...p, inicio, traco: Math.max(comprimento - folga, 0) };
    inicio += comprimento;
    return arco;
  });
  return (
    <figure className="painel-anel" data-testid="anel-ocupacao">
      <div className="painel-anel-grafico">
        <svg viewBox="0 0 140 140" role="img" aria-label={`Posições ativas: ${partes.map((p) => `${p.rotulo.toLowerCase()} ${volumes(p.valor)}`).join(', ')}`}>
          {/* Trilho só sem posições: entre as partes, a folga mostra o fundo do cartão. */}
          {total === 0 && <circle className="painel-anel-trilho" cx="70" cy="70" r={raio} />}
          <g transform="rotate(-90 70 70)">
            {arcos
              .filter((a) => a.traco > 0)
              .map((a) => (
                <circle
                  key={a.chave}
                  className={`painel-anel-parte painel-anel-parte--${a.chave}`}
                  cx="70"
                  cy="70"
                  r={raio}
                  strokeDasharray={`${String(a.traco)} ${String(volta - a.traco)}`}
                  strokeDashoffset={-a.inicio}
                >
                  <title>{`${a.rotulo}: ${volumes(a.valor)}`}</title>
                </circle>
              ))}
          </g>
        </svg>
        <p className="painel-anel-centro">
          <strong>{volumes(ocupadas)}</strong>
          <span>de {volumes(total)} ativas</span>
        </p>
      </div>
      <figcaption>
        <ul className="painel-anel-legenda">
          {partes.map((p) => (
            <li key={p.chave}>
              <span className={`painel-legenda-cor painel-anel-cor--${p.chave}`} aria-hidden="true" />
              <span>{p.rotulo}</span>
              <strong>{volumes(p.valor)}</strong>
            </li>
          ))}
        </ul>
        <p className="painel-anel-nota">
          Sem palete registrado não é espaço livre. {volumes(desativadas)} desativada(s)/indisponível(is) fora da capacidade{provisoria ? ' · base provisória' : ''}.
        </p>
      </figcaption>
    </figure>
  );
}

/** Porcentagem da janela em anel (para em 100% no desenho; o valor real fica no texto). */
function AnelProgresso({ rotulo, porcentagem, serie }: { rotulo: string; porcentagem: string; serie: 'preparacao' | 'expedicao' }) {
  const raio = 34;
  const volta = 2 * Math.PI * raio;
  const preenchido = (Math.min(Number(porcentagem), 100) / 100) * volta;
  return (
    <div className="painel-anel-progresso">
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle className="painel-anel-trilho" cx="42" cy="42" r={raio} />
        {preenchido > 0 && (
          <circle
            className={`painel-anel-parte painel-anel-parte--${serie}`}
            cx="42"
            cy="42"
            r={raio}
            strokeDasharray={`${String(preenchido)} ${String(volta)}`}
            transform="rotate(-90 42 42)"
          />
        )}
      </svg>
      <strong>{porcento(porcentagem)}</strong>
      <span>{rotulo}</span>
    </div>
  );
}

/** Barra com texto: para em 100% na largura, o total real fica no texto. */
export function Barra({
  rotulo,
  valor,
  total,
  texto,
  tom,
  testId,
}: {
  rotulo: string;
  valor: number;
  total: number;
  texto: string;
  tom: 'preparacao' | 'expedicao' | 'paletes' | 'volumes' | 'solicitado';
  testId?: string;
}) {
  const largura = total <= 0 ? 0 : Math.min(100, (valor / total) * 100);
  return (
    <div className="painel-barra" data-testid={testId}>
      <span className="painel-barra-rotulo">{rotulo}</span>
      <span className="painel-barra-trilho" aria-hidden="true">
        <span className={`painel-barra-preenchida painel-barra--${tom}`} style={{ width: `${String(largura)}%` }} />
      </span>
      <span className="painel-barra-texto">{texto}</span>
    </div>
  );
}

/** Preparação (P + E) e expedição (E) em barras separadas, com totais e faltantes. */
export function ProgressoJanela({ p, interno }: { p: ProgressoVolumes | ProgressoCliente; interno: boolean }) {
  const t = p.requested;
  const excesso = interno && 'excessPrepared' in p ? p : null;
  return (
    <div className="painel-progresso" data-testid="progresso-janela">
      <p className="painel-progresso-meta">
        <strong>Solicitado pelo cliente:</strong> {t === null ? 'Sem meta informada' : `${volumes(t)} volumes`}
        {p.basisNote !== null && t !== null && <span className="indicador-nota"> · {p.basisNote}</span>}
      </p>
      {/* Resumo visual; os mesmos números ficam nas barras abaixo (leitores de tela leem as barras). */}
      {p.preparationPercent !== null && p.shippingPercent !== null && (
        <div className="painel-progresso-aneis" aria-hidden="true">
          <AnelProgresso rotulo="preparados" porcentagem={p.preparationPercent} serie="preparacao" />
          <AnelProgresso rotulo="expedidos" porcentagem={p.shippingPercent} serie="expedicao" />
        </div>
      )}
      <Barra
        rotulo="Preparados (separados + expedidos)"
        valor={p.prepared}
        total={t ?? 0}
        tom="preparacao"
        testId="barra-preparacao"
        texto={`${volumes(p.prepared)}${t !== null ? ` de ${volumes(t)}` : ''}${p.preparationPercent !== null ? ` (${porcento(p.preparationPercent) ?? ''})` : ''}${p.missingToSeparate !== null ? ` · falta separar ${volumes(p.missingToSeparate)}` : ''}`}
      />
      <Barra
        rotulo="Expedidos"
        valor={p.shipped}
        total={t ?? 0}
        tom="expedicao"
        testId="barra-expedicao"
        texto={`${volumes(p.shipped)}${t !== null ? ` de ${volumes(t)}` : ''}${p.shippingPercent !== null ? ` (${porcento(p.shippingPercent) ?? ''})` : ''}${p.missingToShip !== null ? ` · falta expedir ${volumes(p.missingToShip)}` : ''}`}
      />
      <p className="indicador-nota">
        Separados aguardando saída: <strong data-testid="separados-aguardando">{volumes(p.separatedWaiting)}</strong> · expedidos: <strong>{volumes(p.shipped)}</strong> (conjuntos distintos: ao
        expedir, sai do separado e entra no expedido).
        {t === null && ' Sem meta informada: sem porcentagem.'}
      </p>
      {excesso !== null && (excesso.excessPrepared !== null || excesso.excessShipped !== null) && (
        <p className="mensagem-conflito" data-testid="excesso-meta">
          Acima da meta: {excesso.excessPrepared !== null ? `${volumes(excesso.excessPrepared)} preparado(s)` : ''}
          {excesso.excessShipped !== null ? ` · ${volumes(excesso.excessShipped)} expedido(s)` : ''} — confira com o cliente (nada foi ajustado).
        </p>
      )}
    </div>
  );
}

interface Coluna {
  chave: string;
  /** Nulo = não informado (desenhado sem altura e marcado "n/i", nunca como zero). */
  valor: number | null;
  texto: string;
}

/** Colunas de uma única medida (uma cor, valor no topo, rótulo embaixo); clique abre a lista da rua. */
function GraficoColunas({
  titulo,
  nota,
  serie,
  colunas,
  aoAbrir,
}: {
  titulo: string;
  nota?: string;
  serie: 'paletes' | 'volumes';
  colunas: readonly Coluna[];
  aoAbrir?: (chave: string) => void;
}) {
  const maximo = Math.max(...colunas.map((c) => c.valor ?? 0), 1);
  return (
    <figure className="painel-colunas">
      <figcaption className="painel-colunas-titulo">
        {titulo}
        {nota !== undefined && <span className="indicador-nota"> · {nota}</span>}
      </figcaption>
      <ul className="painel-colunas-area">
        {colunas.map((c) => {
          const altura = c.valor === null ? 0 : (c.valor / maximo) * 100;
          const dica = `${c.chave}: ${c.texto}`;
          const conteudo = (
            <>
              {/* Valor logo acima do topo da coluna (o nome acessível vem do rótulo do botão). */}
              <span className="painel-coluna-trilho" aria-hidden="true">
                <span className="painel-coluna-valor">{c.valor === null ? 'n/i' : volumes(c.valor)}</span>
                <span className={`painel-coluna-barra painel-coluna-barra--${serie}`} style={{ height: `${String(altura)}%` }} />
              </span>
              <span className="painel-coluna-rotulo">{c.chave === 'Sem endereço confirmado' ? 'Sem endereço' : c.chave}</span>
            </>
          );
          return (
            <li key={c.chave} data-rua={c.chave}>
              {aoAbrir ? (
                <button
                  type="button"
                  className="painel-coluna painel-coluna--clicavel"
                  data-dica={dica}
                  aria-label={dica}
                  onClick={() => {
                    aoAbrir(c.chave);
                  }}
                >
                  {conteudo}
                </button>
              ) : (
                <div className="painel-coluna" data-dica={dica} role="img" aria-label={dica}>
                  {conteudo}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/** Paletes e volumes por rua: medidas diferentes, cada uma no próprio gráfico (nunca dois eixos). */
export function GraficoRuas({ ruas, aoAbrir }: { ruas: readonly PorRua[]; aoAbrir?: (rua: string) => void }) {
  if (ruas.length === 0) return <p className="estado-vazio">Nenhum palete na praça.</p>;
  const semVolume = ruas.filter((r) => r.contents === 0 || r.volumesUnknown > 0);
  return (
    <div className="painel-grafico-ruas" data-testid="grafico-ruas">
      <div className="painel-colunas-par">
        <GraficoColunas titulo="Paletes" serie="paletes" colunas={ruas.map((r) => ({ chave: r.street, valor: r.pallets, texto: `${volumes(r.pallets)} palete(s)` }))} aoAbrir={aoAbrir} />
        <GraficoColunas
          titulo="Volumes"
          nota="contado quando houver; senão informado"
          serie="volumes"
          colunas={ruas.map((r) => ({ chave: r.street, valor: r.contents === 0 || r.contents === r.volumesUnknown ? null : r.volumes, texto: textoVolumesRua(r) }))}
          aoAbrir={aoAbrir}
        />
      </div>
      {semVolume.length > 0 && (
        <p className="indicador-nota">
          “n/i” = não informado (não é zero). Sem volume informado:{' '}
          {semVolume.map((r) => `${r.street} (${r.contents === 0 ? 'conteúdo não registrado' : `${String(r.volumesUnknown)} conteúdo(s)`})`).join(' · ')}.
        </p>
      )}
      <details className="painel-dados">
        <summary>Ver números em tabela</summary>
        <div className="tabela-rolagem">
          <table className="tabela-indicadores">
            <thead>
              <tr>
                <th scope="col">Rua / área</th>
                <th scope="col">Paletes</th>
                <th scope="col">Volumes</th>
              </tr>
            </thead>
            <tbody>
              {ruas.map((r) => (
                <tr key={r.street}>
                  <td>{r.street}</td>
                  <td>{volumes(r.pallets)}</td>
                  <td>{textoVolumesRua(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Comparação das janelas: solicitado, separado aguardando saída e expedido (mesma escala por janela). */
export function ComparacaoJanelas({
  janelas,
  aoAbrir,
}: {
  janelas: readonly { id: string; code: string; name: string; progress: ProgressoVolumes | ProgressoCliente }[];
  aoAbrir: (id: string) => void;
}) {
  if (janelas.length === 0) return <p className="estado-vazio">Nenhuma janela cadastrada no período.</p>;
  const maximo = Math.max(...janelas.map((j) => Math.max(j.progress.requested ?? 0, j.progress.prepared)), 1);
  return (
    <div className="painel-janelas" data-testid="comparacao-janelas">
      <p className="painel-legenda">
        <span className="painel-legenda-item">
          <span className="painel-legenda-cor painel-barra--solicitado" aria-hidden="true" /> Solicitado
        </span>
        <span className="painel-legenda-item">
          <span className="painel-legenda-cor painel-barra--preparacao" aria-hidden="true" /> Separado aguardando saída
        </span>
        <span className="painel-legenda-item">
          <span className="painel-legenda-cor painel-barra--expedicao" aria-hidden="true" /> Expedido
        </span>
      </p>
      <ul>
        {janelas.map((j) => (
          <li key={j.id}>
            <button
              type="button"
              className="painel-rua painel-rua--clicavel"
              onClick={() => {
                aoAbrir(j.id);
              }}
              data-testid={`janela-${j.code}`}
            >
              <span className="painel-rua-nome">
                {j.code} · {j.name}
              </span>
              <Barra
                rotulo="Solicitado"
                valor={j.progress.requested ?? 0}
                total={maximo}
                tom="solicitado"
                texto={j.progress.requested === null ? 'Sem meta informada' : `${volumes(j.progress.requested)} volumes`}
              />
              <Barra rotulo="Separado aguardando" valor={j.progress.separatedWaiting} total={maximo} tom="preparacao" texto={`${volumes(j.progress.separatedWaiting)} volumes`} />
              <Barra rotulo="Expedido" valor={j.progress.shipped} total={maximo} tom="expedicao" texto={`${volumes(j.progress.shipped)} volumes`} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tabela do estoque por NF/Delivery (mesmas linhas da exportação). */
export function TabelaEstoque({ linhas, aoAbrirPalete }: { linhas: readonly LinhaEstoqueCliente[]; aoAbrirPalete?: (id: string) => void }) {
  if (linhas.length === 0) return <p className="estado-vazio">Nenhum registro com estes filtros.</p>;
  return (
    <div className="tabela-rolagem">
      <table className="tabela-indicadores tabela-painel" data-testid="tabela-estoque">
        <thead>
          <tr>
            <th scope="col">NF / documento</th>
            <th scope="col">Delivery</th>
            <th scope="col">Remetente</th>
            <th scope="col">Volumes</th>
            <th scope="col">Palete</th>
            <th scope="col">Full/misto</th>
            <th scope="col">Endereço</th>
            <th scope="col">Situação na janela</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={`${l.palletCode}-${l.documentType ?? ''}-${l.documentNumber ?? ''}-${l.delivery ?? ''}-${String(i)}`}>
              <td data-rotulo="NF / documento">{l.documentNumber === null ? <em>Não informado</em> : `${l.documentType ?? 'Tipo não informado'} ${l.documentNumber}`}</td>
              <td data-rotulo="Delivery">{l.delivery ?? '—'}</td>
              <td data-rotulo="Remetente">{l.sender ?? <em>Não informado</em>}</td>
              <td data-rotulo="Volumes">
                {volumes(l.volumes)}
                {l.volumesBasis !== null && <span className="indicador-nota"> ({l.volumesBasis === 'CONTADO' ? 'contado' : 'informado'})</span>}
              </td>
              <td data-rotulo="Palete">
                {aoAbrirPalete && l.palletId !== null ? (
                  <button
                    type="button"
                    className="botao-link"
                    onClick={() => {
                      if (l.palletId !== null) aoAbrirPalete(l.palletId);
                    }}
                  >
                    {l.palletCode}
                  </button>
                ) : (
                  l.palletCode
                )}
              </td>
              <td data-rotulo="Full/misto">{ROTULO_FULL[l.palletType]}</td>
              <td data-rotulo="Endereço">{l.address ?? <em>Localização em atualização</em>}</td>
              <td data-rotulo="Situação na janela">{l.windowStage === null ? '—' : ROTULO_ETAPA_SELECAO[l.windowStage]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Linha do tempo: eventos operacionais permitidos (correções identificadas, sem somar duas vezes). */
export function LinhaTempo({ eventos }: { eventos: readonly EventoCliente[] }) {
  if (eventos.length === 0) return <p className="estado-vazio">Nenhum acontecimento com estes filtros.</p>;
  return (
    <ol className="painel-linha-tempo" data-testid="linha-tempo">
      {eventos.map((e) => (
        <li key={e.key} className={e.correction ? 'painel-evento painel-evento--correcao' : 'painel-evento'}>
          <time dateTime={e.at}>{formatarDataHora(e.at)}</time>
          <strong>
            {ROTULO_EVENTO_CLIENTE[e.type]}
            {e.correction ? ' (correção)' : ''}
          </strong>
          <span>
            Palete {e.palletCode}
            {e.documentNumber !== null ? ` · ${e.documentType ?? 'Documento'} ${e.documentNumber}` : ''}
            {e.delivery !== null ? ` · Delivery ${e.delivery}` : ''}
            {e.from !== null || e.to !== null ? ` · ${e.from ?? '—'} → ${e.to ?? '—'}` : ''}
            {e.volumes !== null ? ` · ${volumes(e.volumes)} volume(s)` : ''}
            {e.windowCode !== null ? ` · janela ${e.windowCode}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

const CAMPOS_TEXTO: readonly [keyof ValoresFiltro, string][] = [
  ['rua', 'Rua'],
  ['palete', 'Palete'],
  ['documento', 'NF / NFD / MI'],
  ['delivery', 'Delivery'],
  ['remetente', 'Remetente'],
];

/** Filtros dos painéis (aplicados pela URL: voltar mostra a mesma consulta). */
export function FormularioFiltros({
  valores,
  janelas,
  periodo,
  aoAplicar,
}: {
  valores: ValoresFiltro;
  janelas?: readonly { id: string; code: string; name: string }[];
  periodo: boolean;
  aoAplicar: (v: ValoresFiltro) => void;
}) {
  const [form, setForm] = useState<ValoresFiltro>(valores);
  const campo = (chave: keyof ValoresFiltro, rotulo: string, tipo = 'text') => (
    <label className="campo" key={chave}>
      <span className="campo-rotulo">{rotulo}</span>
      <input
        type={tipo}
        value={form[chave] ?? ''}
        maxLength={80}
        onChange={(e) => {
          setForm({ ...form, [chave]: e.target.value });
        }}
        data-testid={`filtro-${chave}`}
      />
    </label>
  );
  return (
    <form
      className="filtro-periodo painel-filtros"
      aria-label="Filtros"
      onSubmit={(e) => {
        e.preventDefault();
        aoAplicar(form);
      }}
    >
      {janelas !== undefined && (
        <label className="campo">
          <span className="campo-rotulo">Janela</span>
          <select
            value={form.janela ?? ''}
            onChange={(e) => {
              setForm({ ...form, janela: e.target.value });
            }}
            data-testid="filtro-janela"
          >
            <option value="">Todas (estoque atual)</option>
            {janelas.map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} · {j.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {periodo && campo('inicio', 'Período: de', 'date')}
      {periodo && campo('fim', 'até', 'date')}
      {CAMPOS_TEXTO.map(([chave, rotulo]) => campo(chave, rotulo))}
      <button type="submit" className="botao-primario botao-compacto" data-testid="filtros-aplicar">
        Aplicar filtros
      </button>
      <button
        type="button"
        className="botao-link"
        onClick={() => {
          setForm({});
          aoAplicar({});
        }}
      >
        Limpar
      </button>
    </form>
  );
}

/** Paginação simples (total e página da resposta). */
export function Paginacao({ total, pagina, tamanho, aoMudar }: { total: number; pagina: number; tamanho: number; aoMudar: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  if (paginas <= 1) return null;
  return (
    <nav className="painel-paginacao" aria-label="Páginas">
      <button
        type="button"
        className="botao-secundario botao-compacto"
        disabled={pagina <= 1}
        onClick={() => {
          aoMudar(pagina - 1);
        }}
      >
        Anterior
      </button>
      <span>
        Página {pagina} de {paginas}
      </span>
      <button
        type="button"
        className="botao-secundario botao-compacto"
        disabled={pagina >= paginas}
        onClick={() => {
          aoMudar(pagina + 1);
        }}
      >
        Próxima
      </button>
    </nav>
  );
}
