import { API_PREFIXO, LoteEspelhosSchema, OpcoesEspelhosSchema, selecionarEspelhos, type ConteudoPalete, type LoteEspelhos } from '@praca-reversa/contracts';
import { useState } from 'react';
import { paraEndereco } from '../../base';
import { useRecurso } from '../../api/use-recurso';
import { EstadoTela } from '../../components/Moldura';
import { IconeImprimir } from '../../components/Icones';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { paginarEspelho } from './paginas';
import './espelhos.css';

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
  const opcoes = useRecurso(`${API_PREFIXO}/espelhos/opcoes`, OpcoesEspelhosSchema);
  const [modo, setModo] = useState<'rua' | 'paletes'>('rua');
  const [ruasMarcadas, setRuasMarcadas] = useState<string[]>([]);
  const [lado, setLado] = useState<'todos' | 'impares' | 'pares'>('todos');
  const [ids, setIds] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const [pedido, setPedido] = useState<string | null>(null);
  const previa = useRecurso(pedido, LoteEspelhosSchema);
  if (opcoes.carga?.estado !== 'pronto') return <EstadoTela carga={opcoes.carga} titulo="Não foi possível carregar os paletes" aoTentarNovamente={opcoes.recarregar} />;
  const items = opcoes.carga.dados.items;
  const ruas = [...new Set(items.flatMap((p) => p.row === null ? [] : [p.row]))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  const selecionados = modo === 'rua' ? ruasMarcadas.flatMap((r) => selecionarEspelhos(items, r, lado)) : items.filter((p) => ids.includes(p.id));
  const alterar = () => { setPedido(null); };
  const lote = previa.carga?.estado === 'pronto' ? previa.carga.dados : null;
  return <main className="principal principal--pagina tela-espelhos" data-testid="tela-espelhos"><div className="pagina-conteudo">
    <header className="pagina-topo nao-imprimir"><h2>Imprimir espelhos</h2><p>Selecione rua/fileira, um lado ou paletes. Confira a prévia em A4 paisagem antes de imprimir.</p>
      <div className="acoes-linha"><button type="button" className="botao-secundario" onClick={aoVoltar}>Voltar ao mapa</button><button type="button" className="botao-secundario" onClick={() => { alterar(); opcoes.recarregar(); }}>Atualizar paletes</button></div>
    </header>
    <form className="espelhos-selecao nao-imprimir" onSubmit={(e) => { e.preventDefault(); const params = modo === 'rua' ? new URLSearchParams({ rows: ruasMarcadas.join(','), side: lado }) : new URLSearchParams({ ids: ids.join(',') }); setPedido(`${API_PREFIXO}/espelhos?${params.toString()}`); previa.recarregar(); }}>
      <label className="campo"><span className="campo-rotulo">Selecionar por</span><select value={modo} onChange={(e) => { setModo(e.target.value as 'rua' | 'paletes'); alterar(); }}><option value="rua">Rua / fileira</option><option value="paletes">Paletes específicos</option></select></label>
      {modo === 'rua' ? <div className="acoes-linha">
        <fieldset><legend>Ruas / fileiras (marque uma ou várias)</legend><div className="acoes-linha"><button type="button" className="botao-link" onClick={() => { setRuasMarcadas(ruas); alterar(); }}>Selecionar todas as ruas</button><button type="button" className="botao-link" onClick={() => { setRuasMarcadas(ruas.filter((r) => /^\d+$/.test(r) && Number(r) % 2 === 1)); alterar(); }}>Ruas ímpares (11, 13, 15…)</button><button type="button" className="botao-link" onClick={() => { setRuasMarcadas(ruas.filter((r) => /^\d+$/.test(r) && Number(r) % 2 === 0)); alterar(); }}>Ruas pares (12, 14, 16…)</button><button type="button" className="botao-link" onClick={() => { setRuasMarcadas([]); alterar(); }}>Limpar ruas</button></div><div className="espelhos-ruas">{ruas.map((r) => <label key={r}><input type="checkbox" checked={ruasMarcadas.includes(r)} onChange={(e) => { setRuasMarcadas(e.target.checked ? ruas.filter((v) => v === r || ruasMarcadas.includes(v)) : ruasMarcadas.filter((v) => v !== r)); alterar(); }} /> {r === 'GR' ? 'Grade' : `Rua ${r}`}</label>)}</div></fieldset>
        <label className="campo"><span className="campo-rotulo">Endereços</span><select value={lado} onChange={(e) => { setLado(e.target.value as typeof lado); alterar(); }}><option value="todos">Todos os endereços</option><option value="impares">Ímpares (A101, A103…)</option><option value="pares">Pares (A102, A104…)</option></select></label>
      </div> : <fieldset><legend>Marque os paletes</legend><label className="campo"><span className="campo-rotulo">Buscar palete ou endereço</span><input value={busca} onChange={(e) => { setBusca(e.target.value); }} /></label>
        <div className="espelhos-paletes">{items.filter((p) => `${p.code} ${p.address ?? ''}`.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR'))).map((p) => <label key={p.id}><input type="checkbox" checked={ids.includes(p.id)} onChange={(e) => { setIds(e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id)); alterar(); }} /> Palete {p.code} · {p.address ?? 'Endereço não confirmado'}</label>)}</div>
        <button type="button" className="botao-link" onClick={() => { setIds([]); alterar(); }}>Limpar seleção</button></fieldset>}
      <p>{selecionados.length} palete(s) selecionado(s). {modo === 'rua' && lado === 'pares' ? 'Pares em ordem decrescente.' : ''}</p>
      {selecionados.length > 250 && <p role="alert" className="mensagem-conflito">Selecione até 250 paletes por impressão: desmarque alguma rua ou use o lado dos endereços.</p>}
      {items.length === 0 && <p>Nenhum palete ativo neste escopo.</p>}
      <button type="submit" className="botao-primario" disabled={selecionados.length === 0 || selecionados.length > 250 || previa.carga?.estado === 'carregando'}>{previa.carga?.estado === 'carregando' ? 'Preparando…' : 'Gerar prévia'}</button>
    </form>
    {previa.carga !== null && previa.carga.estado !== 'pronto' && <div className="nao-imprimir"><EstadoTela carga={previa.carga} titulo="Não foi possível gerar os espelhos" aoTentarNovamente={previa.recarregar} /></div>}
    {lote !== null && <><div className="espelhos-imprimir nao-imprimir"><p>{lote.items.length} espelho(s), {lote.items.reduce((s, p) => s + paginarEspelho(p.contents.items, p).length, 0)} folha(s). Gerado em {formatarDataHora(lote.generatedAt)}.</p><p>Use A4 paisagem, escala 100%, sem cabeçalho e rodapé do navegador. Você também pode escolher “Salvar como PDF”.</p><button type="button" className="botao-primario" disabled={lote.items.length === 0} onClick={() => { window.print(); }}><IconeImprimir /> Imprimir espelhos</button></div><Folhas lote={lote} /></>}
  </div></main>;
}
