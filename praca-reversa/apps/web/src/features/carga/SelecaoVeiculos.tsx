import type { CargaJanela, TipoVeiculo, VeiculoCarga } from '@praca-reversa/contracts';
import { useMemo, useState } from 'react';
import { formatarDataHora } from '../../utils/datas';

type Tom = 'neutro' | 'info' | 'aviso' | 'ok' | 'cancelado';

/** Situação resumida do veículo para o card (sempre com texto, nunca só cor). */
function situacaoVeiculo(v: VeiculoCarga): { texto: string; tom: Tom } {
  if (v.state === 'CANCELADO') return { texto: 'Cancelada', tom: 'cancelado' };
  if (v.state === 'FECHADO') return { texto: 'Carga fechada', tom: 'ok' };
  if (v.occupied === 0) return { texto: 'Não iniciada', tom: 'neutro' };
  if (v.pending.length === 0) return { texto: 'Pronta para fechar', tom: 'ok' };
  if (v.confirmedPositions > 0) return { texto: 'Carregando', tom: 'aviso' };
  return { texto: 'Em montagem', tom: 'info' };
}

const pct = (a: number, b: number) => (b <= 0 ? 0 : Math.round((a / b) * 100));
const ativosDe = (v: VeiculoCarga) => v.pallets.filter((p) => p.state === 'ATIVO');

/**
 * Desenho lateral do veículo (frente à esquerda, como no mapa deitado): o baú
 * aparece em corte, com uma fatia por fileira — cheia quando a fileira tem
 * palete confirmado no carregamento, amarela quando só planejado.
 */
function DesenhoVeiculo({ v }: { v: VeiculoCarga }) {
  const carreta = v.kind === 'CARRETA';
  const largura = carreta ? 244 : 212;
  const bau = carreta ? { x: 50, y: 10, w: 190, h: 58 } : { x: 54, y: 14, w: 150, h: 54 };
  const rodas = carreta ? [24, 62, 190, 214] : [26, 158, 182];
  const porPos = new Map(ativosDe(v).flatMap((p) => (p.position === null ? [] : [[p.position, p] as const])));
  const fatias = Array.from({ length: v.rows }, (_, i) => {
    const doRow = Array.from({ length: v.cols }, (_, c) => porPos.get(i * v.cols + c + 1)).filter((p) => p !== undefined);
    if (doRow.length === 0) return 'vazia';
    return doRow.some((p) => !p.positionConfirmed) ? 'planejada' : 'confirmada';
  });
  const ix = bau.x + 5;
  const iw = bau.w - 10;
  const passo = iw / Math.max(1, v.rows);
  return (
    <svg className="selv-desenho" viewBox={`0 0 ${String(largura)} 92`} aria-hidden="true" focusable="false">
      {/* chão */}
      <line x1="2" x2={largura - 2} y1="88" y2="88" className="selv-chao" />
      {/* cabine */}
      <path className="selv-cabine" d={carreta ? 'M6 76 V40 Q6 26 20 26 H40 Q46 26 46 32 V76 Z' : 'M6 76 V38 Q6 22 22 22 H44 Q50 22 50 28 V76 Z'} />
      <path className="selv-vidro" d={carreta ? 'M10 44 Q10 31 20 31 H40 V46 H10 Z' : 'M10 42 Q10 27 22 27 H44 V44 H10 Z'} />
      <rect className="selv-faixa" x="6" y={carreta ? 56 : 56} width={carreta ? 40 : 44} height="5" />
      {/* chassi */}
      <rect className="selv-chassi" x="6" y="74" width={bau.x + bau.w - 6} height="5" rx="2" />
      {/* baú em corte */}
      <rect className="selv-bau" x={bau.x} y={bau.y} width={bau.w} height={bau.h} rx="3" />
      {fatias.map((f, i) =>
        f === 'vazia' ? null : (
          <rect key={i} className={`selv-fatia selv-fatia--${f}`} x={ix + i * passo + 1} y={bau.y + 6} width={Math.max(1, passo - 2)} height={bau.h - 12} rx="1.5" />
        ),
      )}
      {/* rodas */}
      {rodas.map((cx) => (
        <g key={cx}>
          <circle className="selv-pneu" cx={cx} cy="80" r="9" />
          <circle className="selv-aro" cx={cx} cy="80" r="3.5" />
        </g>
      ))}
    </svg>
  );
}

function Card({ v, aoAbrir }: { v: VeiculoCarga; aoAbrir: () => void }) {
  const s = situacaoVeiculo(v);
  const ps = ativosDe(v);
  const volumes = ps.reduce((t, p) => t + p.volumes, 0);
  const fisico = ps.filter((p) => p.physical.checked).length;
  const docs = ps.filter((p) => p.docs.state === 'CONFERIDA').length;
  const problema = ps.some((p) => p.docs.state === 'COM_PROBLEMA');
  const carregado = pct(v.confirmedPositions, v.occupied);
  return (
    <button type="button" className={`selv-card selv-card--${s.tom}`} onClick={aoAbrir} data-testid={`card-${v.label}`} aria-label={`Abrir ${v.label}: ${s.texto}, ${String(v.occupied)} de ${String(v.capacity)} paletes`}>
      <span className="selv-card-topo">
        <span className="selv-card-texto">
          <span className={`selv-chip selv-chip--${s.tom}`}>
            <span className="selv-ponto" aria-hidden="true" />
            {s.texto}
          </span>
          <span className="selv-card-titulo">{v.label}</span>
          {v.name && <span className="selv-card-nome">{v.name}</span>}
          <span className="selv-card-numeros">
            {v.occupied}/{v.capacity} paletes <span className="selv-suave">({pct(v.occupied, v.capacity)}%)</span>
          </span>
          <span className="selv-card-numeros selv-suave">{volumes} volumes</span>
        </span>
        <DesenhoVeiculo v={v} />
      </span>
      <span className="selv-card-base">
        <span className="selv-card-linha">
          <strong>{v.plate ? `Placa ${v.plate}` : 'Sem placa'}</strong>
          <span className="selv-suave">
            Físico {fisico}/{ps.length} · Docs {docs}/{ps.length}
            {problema ? <span className="marca-erro"> · ! problema</span> : null}
          </span>
        </span>
        <span className="selv-card-linha">
          <span>Carregamento confirmado</span>
          <strong>{v.occupied === 0 ? '—' : `${String(v.confirmedPositions)}/${String(v.occupied)} · ${String(carregado)}%`}</strong>
        </span>
        <span className="selv-barra" role="progressbar" aria-label={`Carregamento confirmado de ${v.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={carregado}>
          <span className="selv-barra-cheia" style={{ width: `${String(carregado)}%` }} />
        </span>
        {v.state === 'MONTAGEM' && v.occupied > 0 && v.pending.length > 0 && (
          <span className="selv-suave selv-pendencias">
            {v.pending.length} pendência{v.pending.length > 1 ? 's' : ''} para fechar
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Tela de seleção da Expedição: resumo da janela e um card por veículo.
 * Tocar no card abre o mapa daquele veículo.
 */
export function SelecaoVeiculos({
  dados,
  podePreparar,
  ocupado,
  aoAbrir,
  aoAdicionar,
}: {
  dados: CargaJanela;
  podePreparar: boolean;
  ocupado: boolean;
  aoAbrir: (v: VeiculoCarga) => void;
  aoAdicionar: (kind: TipoVeiculo) => void;
}) {
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'TODOS' | 'CARRETA' | 'TRUCK'>('TODOS');
  const validos = dados.vehicles.filter((v) => v.state !== 'CANCELADO');
  const cancelados = dados.vehicles.filter((v) => v.state === 'CANCELADO');
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return validos.filter(
      (v) => (filtro === 'TODOS' || v.kind === filtro) && (t === '' || [v.label, v.plate ?? '', v.name ?? ''].some((x) => x.toLowerCase().includes(t))),
    );
  }, [validos, busca, filtro]);
  const capacidade = validos.reduce((t, v) => t + v.capacity, 0);
  const alocados = validos.reduce((t, v) => t + v.occupied, 0);
  const paletes = validos.flatMap(ativosDe);
  const docsOk = paletes.filter((p) => p.docs.state === 'CONFERIDA').length;
  const docsProblema = paletes.filter((p) => p.docs.state === 'COM_PROBLEMA').length;
  const prontos = validos.filter((v) => v.state === 'MONTAGEM' && v.occupied > 0 && v.pending.length === 0).length;
  const fechados = validos.filter((v) => v.state === 'FECHADO').length;
  const montagem = validos.filter((v) => v.state === 'MONTAGEM').length;

  return (
    <div className="selv" data-testid="selecao-veiculos">
      <section className="selv-resumo" aria-label="Resumo da janela">
        <header className="selv-resumo-topo">
          <h3>Janela {dados.window.code}</h3>
          <span className="selv-suave">Atualizado em {formatarDataHora(dados.generatedAt)}</span>
        </header>
        <div className="selv-kpis">
          <div className="selv-kpi" data-testid="kpi-veiculos">
            <span className="selv-kpi-rotulo">Veículos na janela</span>
            <strong className="selv-kpi-valor">{validos.length}</strong>
            <span className="selv-suave">
              {montagem} em montagem · {fechados} fechada{fechados === 1 ? '' : 's'}
            </span>
          </div>
          <div className="selv-kpi" data-testid="kpi-paletes">
            <span className="selv-kpi-rotulo">Paletes alocados</span>
            <strong className="selv-kpi-valor">
              {alocados}/{capacidade}
            </strong>
            <span className="selv-suave">{pct(alocados, capacidade)}% da capacidade</span>
          </div>
          <div className="selv-kpi" data-testid="kpi-docs">
            <span className="selv-kpi-rotulo">Documentos conferidos</span>
            <strong className="selv-kpi-valor">
              {docsOk}/{paletes.length}
            </strong>
            <span className={docsProblema > 0 ? 'marca-erro' : 'selv-suave'}>{docsProblema > 0 ? `${String(docsProblema)} com problema` : 'Nenhum problema'}</span>
          </div>
          <div className="selv-kpi" data-testid="kpi-prontos">
            <span className="selv-kpi-rotulo">Prontas para fechar</span>
            <strong className="selv-kpi-valor">{String(prontos).padStart(2, '0')}</strong>
            <span className="selv-suave">Sem pendências</span>
          </div>
        </div>
      </section>

      <section className="selv-lista" aria-label="Veículos da janela">
        <header className="selv-lista-topo">
          <h3>Veículos da janela</h3>
          <div className="selv-ferramentas">
            <input type="search" className="selv-busca" placeholder="Buscar placa ou veículo" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar veículo" data-testid="selv-busca" />
            <div className="carga-visao" role="group" aria-label="Tipo de veículo">
              {(['TODOS', 'CARRETA', 'TRUCK'] as const).map((f) => (
                <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
                  {f === 'TODOS' ? 'Todos' : f === 'CARRETA' ? 'Carretas' : 'Trucks'}
                </button>
              ))}
            </div>
            {podePreparar && (
              <>
                <button type="button" className="botao-primario botao-compacto" disabled={ocupado} onClick={() => aoAdicionar('CARRETA')} data-testid="adicionar-carreta">
                  + Carreta (28)
                </button>
                <button type="button" className="botao-secundario botao-compacto" disabled={ocupado} onClick={() => aoAdicionar('TRUCK')} data-testid="adicionar-truck">
                  + Truck (16)
                </button>
              </>
            )}
          </div>
        </header>
        {validos.length === 0 ? (
          <p className="estado-vazio" data-testid="carga-sem-veiculo">
            Nenhum veículo nesta janela. {podePreparar ? 'Adicione uma carreta ou um truck.' : ''}
          </p>
        ) : lista.length === 0 ? (
          <p className="estado-vazio">Nenhum veículo encontrado com esse filtro.</p>
        ) : (
          <div className="selv-grade">
            {lista.map((v) => (
              <Card key={v.id} v={v} aoAbrir={() => aoAbrir(v)} />
            ))}
          </div>
        )}
        {cancelados.length > 0 && (
          <details className="selv-cancelados">
            <summary>
              {cancelados.length} veículo{cancelados.length > 1 ? 's' : ''} cancelado{cancelados.length > 1 ? 's' : ''}
            </summary>
            <div className="selv-grade">
              {cancelados.map((v) => (
                <Card key={v.id} v={v} aoAbrir={() => aoAbrir(v)} />
              ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
