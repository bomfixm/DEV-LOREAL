import { API_PREFIXO, LoteEspelhosSchema, PracaSchema, type ConteudoPalete, type LoteEspelhos } from '@praca-reversa/contracts';
import { useMemo, useRef, useState } from 'react';
import { paraEndereco } from '../../base';
import { useRecurso } from '../../api/use-recurso';
import { EstadoTela } from '../../components/Moldura';
import { IconeImprimir, IconeMais, IconeMenos } from '../../components/Icones';
import type { MargensMapa } from '../mapa/controlador-mapa';
import { MapaPraca, type MapaPracaHandle } from '../mapa/MapaPraca';
import '../mapa/escolher-no-mapa.css';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { paginarEspelho } from './paginas';
import { alternarGrupo, indiceDoMapa, ordenarParaImpressao } from './selecao';
import './espelhos.css';

const MARGENS: MargensMapa = { topo: 12, direita: 56, base: 12, esquerda: 12 };

function observacao(d: ConteudoPalete): string {
  if (d.check?.state === 'CONFERIDO_COM_DIFERENCA') return `CONFERIDO COM DIFERENÇA ${d.check.at === null ? '' : formatarData(d.check.at)}`;
  if (d.check?.state === 'CONFERIDO') return `CONFERIDO ${d.check.at === null ? '' : formatarData(d.check.at)}`;
  if (d.inventoryCheck?.state === 'INFORMADA' && d.inventoryCheck.date !== null) return `CONFERÊNCIA INFORMADA ${d.inventoryCheck.date.split('-').reverse().join('/')}`;
  if (d.count.state === 'REALIZADA') return `CONTAGEM REGISTRADA${d.count.at === null ? '' : ` ${formatarData(d.count.at)}`}`;
  return 'AGUARDANDO CONFERÊNCIA';
}
function Folhas({ lote }: { lote: LoteEspelhos }) {
  return <div className="espelhos-folhas">{lote.items.flatMap((p) => {
    const paginas = paginarEspelho(p.contents.items, p);
    return paginas.map((items, n) => <section className="espelho-folha" key={`${p.id}-${String(n)}`} aria-label={`Espelho ${p.code}, página ${String(n + 1)}`}>
      <img className="espelho-moldura" src={paraEndereco('/espelhos-moldura.png')} alt="" /><div className="espelho-interior">
        {lote.scope.demo && <strong className="espelho-demo">DEMONSTRAÇÃO — DADOS FICTÍCIOS</strong>}
        <h2>{p.address === null ? 'ENDEREÇO NÃO CONFIRMADO' : p.row === 'GR' ? p.address : `RUA ${p.address}`}</h2>
        <h3>PALETE {p.code}</h3>
        {paginas.length > 1 && <p className="espelho-continuacao">Continuação · {n + 1}/{paginas.length}</p>}
        <table><colgroup>{[10, 5, 10, 15, 7, 7, 25, 12, 9].map((w, i) => <col key={i} style={{ width: `${String(w)}%` }} />)}</colgroup>
          <thead><tr>{['DLV', 'TIPO', 'NÚMERO', 'OBS. OPERAÇÃO', 'VOLUMES', 'LIDO', 'REMETENTE', 'RUA', 'PALETE NUMBER'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{items.length === 0 ? <tr><td colSpan={9}>SEM CONTEÚDO REGISTRADO — CONFERÊNCIA PENDENTE</td></tr> : items.map((d) => <tr key={d.id}>
            <td>{d.delivery ?? '—'}</td><td>{d.documentType ?? '—'}</td><td>{d.documentNumber ?? '—'}</td><td>{observacao(d)}</td>
            <td>{d.count.expected ?? '—'}</td><td>{d.count.counted ?? '—'}</td><td>{d.sender ?? '—'}</td><td>{p.address ?? 'PENDENTE'}</td><td>{p.code}</td>
          </tr>)}</tbody>
        </table>
        <footer>{lote.scope.name} · Emitido em {formatarDataHora(lote.generatedAt)}<br />Volumes = previsto informado · Lido = contagem registrada · — = não informado</footer>
      </div>
    </section>);
  })}</div>;
}
export function TelaEspelhos({ aoVoltar }: { aoVoltar: () => void }) {
  const praca = useRecurso(`${API_PREFIXO}/praca`, PracaSchema);
  const mapa = useRef<MapaPracaHandle>(null);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [pedido, setPedido] = useState<string | null>(null);
  const previa = useRecurso(pedido, LoteEspelhosSchema);
  const dados = praca.carga?.estado === 'pronto' ? praca.carga.dados : null;
  const layout = dados?.layout ?? null;
  const indice = useMemo(() => (dados === null || layout === null ? null : indiceDoMapa(layout, dados.pallets)), [dados, layout]);
  if (praca.carga?.estado !== 'pronto' || dados === null) return <EstadoTela carga={praca.carga} titulo="Não foi possível carregar o mapa" aoTentarNovamente={praca.recarregar} />;
  const lote = previa.carga?.estado === 'pronto' ? previa.carga.dados : null;
  const alterar = (novo: Set<string>) => {
    setMarcados(novo);
    setPedido(null);
  };
  const grupo = (ids: readonly string[] | undefined) => {
    alterar(alternarGrupo(marcados, ids ?? []));
  };
  const total = marcados.size;
  return <main className="principal principal--pagina tela-espelhos" data-testid="tela-espelhos"><div className="pagina-conteudo">
    <header className="pagina-topo nao-imprimir"><h2>Imprimir espelhos</h2>
      <p>Escolha no mapa: clique no <strong>nome da rua</strong> para marcar a rua inteira, no <strong>F##</strong> para marcar a fileira ou num <strong>palete</strong> para marcar só ele. Clique de novo para desmarcar. O que está marcado fica <strong>branco</strong>.</p>
      <div className="acoes-linha"><button type="button" className="botao-secundario" onClick={aoVoltar}>Voltar ao mapa</button><button type="button" className="botao-secundario" onClick={() => { alterar(new Set()); praca.recarregar(); }}>Atualizar paletes</button></div>
    </header>
    <div className="escolha-mapa nao-imprimir" data-testid="espelhos-mapa">
      <div className="escolha-mapa-area">
        {layout === null ? <p className="estado-vazio">Esta praça ainda não tem layout cadastrado.</p> : <>
          <MapaPraca
            ref={mapa}
            layout={layout}
            paletes={dados.pallets}
            selecionadoId={null}
            idsVisiveis={null}
            margens={MARGENS}
            selecaoMultipla={marcados}
            aoSelecionar={(id) => { if (indice?.elegiveis.has(id) === true) grupo([id]); }}
            aoEscolherBloco={(codigo) => { grupo(indice?.porBloco.get(codigo)); }}
            aoEscolherFileira={(id) => { grupo(indice?.porFileira.get(id)); }}
            aoMudarVisao={() => undefined}
          />
          <div className="escolha-mapa-zoom">
            <button type="button" className="botao-secundario botao-icone" onClick={() => mapa.current?.ampliar()} aria-label="Aproximar"><IconeMais /></button>
            <button type="button" className="botao-secundario botao-icone" onClick={() => mapa.current?.reduzir()} aria-label="Afastar"><IconeMenos /></button>
          </div>
        </>}
      </div>
      <div className="espelhos-barra">
        <p data-testid="espelhos-contagem"><strong>{total}</strong> palete(s) marcado(s){total > 250 ? ' — o limite é 250 por impressão: desmarque alguma rua ou fileira.' : '.'}</p>
        <button type="button" className="botao-link" disabled={total === 0} onClick={() => { alterar(new Set()); }}>Limpar seleção</button>
        <button
          type="button"
          className="botao-primario"
          disabled={total === 0 || total > 250 || previa.carga?.estado === 'carregando'}
          onClick={() => {
            if (layout === null) return;
            const ids = ordenarParaImpressao([...marcados], layout, dados.pallets);
            setPedido(`${API_PREFIXO}/espelhos?${new URLSearchParams({ ids: ids.join(',') }).toString()}`);
            previa.recarregar();
          }}
        >{previa.carga?.estado === 'carregando' ? 'Preparando…' : 'Gerar prévia'}</button>
      </div>
    </div>
    {previa.carga !== null && previa.carga.estado !== 'pronto' && <div className="nao-imprimir"><EstadoTela carga={previa.carga} titulo="Não foi possível gerar os espelhos" aoTentarNovamente={previa.recarregar} /></div>}
    {lote !== null && <><div className="espelhos-imprimir nao-imprimir"><p>{lote.items.length} espelho(s), {lote.items.reduce((s, p) => s + paginarEspelho(p.contents.items, p).length, 0)} folha(s). Gerado em {formatarDataHora(lote.generatedAt)}.</p><p>Use A4 paisagem, escala 100%, sem cabeçalho e rodapé do navegador. Você também pode escolher “Salvar como PDF”.</p><button type="button" className="botao-primario" disabled={lote.items.length === 0} onClick={() => { window.print(); }}><IconeImprimir /> Imprimir espelhos</button></div><Folhas lote={lote} /></>}
  </div></main>;
}
