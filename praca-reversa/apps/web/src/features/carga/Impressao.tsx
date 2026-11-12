import type { CargaJanela, PaleteEmbarque, TipoEmissao, VeiculoCarga } from '@praca-reversa/contracts';
import { formatarDataHora } from '../../utils/datas';
import { EspelhoEmbarque } from '../espelhos/EspelhoEmbarque';
import { layoutDoEmbarque } from '../espelhos/layout-armazenamento';
import type { LayoutEspelho } from '../espelhos/layout-modelo';
import { MapaVeiculo } from './MapaVeiculo';

export interface PedidoImpressao {
  kind: TipoEmissao;
  final: boolean;
  veiculoId: string;
  paleteId: string | null;
  /** Espelho: layout capturado na emissão (o editor não muda um pedido já aberto). */
  layout?: LayoutEspelho;
}

const Demo = ({ carga }: { carga: CargaJanela }) => (carga.scope.demo ? <p className="impr-demo">DEMONSTRAÇÃO — DADOS FICTÍCIOS</p> : null);

function Rascunho({ final }: { final: boolean }) {
  return final ? null : (
    <p className="impr-rascunho" aria-label="Rascunho">
      RASCUNHO — NÃO VALE PARA O EMBARQUE
    </p>
  );
}

/** Etiqueta física do palete de embarque: o número grande e a identidade completa. */
function Etiqueta({ carga, veiculo, p, final }: { carga: CargaJanela; veiculo: VeiculoCarga; p: PaleteEmbarque; final: boolean }) {
  return (
    <section className="impr-folha impr-etiqueta" aria-label={`Etiqueta ${p.identity}`}>
      <Demo carga={carga} />
      <Rascunho final={final} />
      <p className="impr-etiqueta-janela">
        Janela {carga.window.code} · {veiculo.label}
        {veiculo.plate ? ` · Placa ${veiculo.plate}` : ''}
      </p>
      <p className="impr-etiqueta-numero">{p.label}</p>
      <p className="impr-etiqueta-identidade">{p.identity}</p>
      <p className="impr-etiqueta-info">
        {p.kind === 'FULL' ? `FULL · origem ${p.sourcePalletCode ?? ''}` : 'FRACIONADO'} · {p.lines.length} NF(s) · {p.volumes} volume(s) · revisão {p.revision}
      </p>
      <p className="impr-rodape">Emitida em {formatarDataHora(carga.generatedAt)}</p>
    </section>
  );
}

/** Lista do conjunto de documentos do palete (administrativo separa e devolve à operação). */
function ListaDocumentos({ carga, veiculo, p }: { carga: CargaJanela; veiculo: VeiculoCarga; p: PaleteEmbarque }) {
  return (
    <section className="impr-folha impr-documentos" aria-label={`Documentos ${p.identity}`}>
      <Demo carga={carga} />
      <h2>Conjunto de documentos · {p.label}</h2>
      <p className="impr-documentos-identidade">{p.identity}</p>
      <p>
        {veiculo.label}
        {veiculo.plate ? ` · Placa ${veiculo.plate}` : ''} · {p.kind === 'FULL' ? `FULL (origem ${p.sourcePalletCode ?? ''})` : 'Fracionado'} · Revisão {p.revision} · {p.volumes} volume(s)
      </p>
      <table>
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Número</th>
            <th>Remetente</th>
            <th>Delivery</th>
            <th>Volumes</th>
            <th>Palete de origem</th>
            <th>Situação</th>
            <th>Separado ☐</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.documentType ?? '—'}</td>
              <td>{l.documentNumber ?? '—'}</td>
              <td>{l.sender ?? '—'}</td>
              <td>{l.delivery ?? '—'}</td>
              <td>{l.volumes}</td>
              <td>{l.sourcePalletCode}</td>
              <td>{l.doc === null ? 'Pendente' : l.doc.state === 'CONFERIDO' ? 'Conferido' : l.doc.state === 'FALTANTE' ? `Faltante: ${l.doc.note ?? ''}` : `Divergente: ${l.doc.note ?? ''}`}</td>
              <td>☐</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="impr-rodape">
        Uso interno DHL · Emitida em {formatarDataHora(carga.generatedAt)} · Físico: {p.physical.checked ? `conferido${p.physical.by ? ` por ${p.physical.by}` : ''}` : 'pendente'}
      </p>
    </section>
  );
}

/** Mapa da carga: final só com posições confirmadas; prévia identificada como tal. */
function MapaCarga({ carga, veiculo, final }: { carga: CargaJanela; veiculo: VeiculoCarga; final: boolean }) {
  const ativos = veiculo.pallets.filter((p) => p.state === 'ATIVO' && p.position !== null && (!final || p.positionConfirmed)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return (
    <section className="impr-folha impr-mapa" aria-label={`Mapa ${veiculo.label}`}>
      <Demo carga={carga} />
      {final ? <p className="impr-final">MAPA DA CARGA — POSIÇÕES CONFIRMADAS NO CARREGAMENTO</p> : <p className="impr-rascunho">PRÉVIA DA MONTAGEM — POSIÇÕES PLANEJADAS, NÃO CONFIRMADAS</p>}
      <h2>
        Janela {carga.window.code} · {veiculo.label}
        {veiculo.plate ? ` · Placa ${veiculo.plate}` : ''}
      </h2>
      <p>
        {ativos.length} palete(s) · {ativos.reduce((s, p) => s + p.volumes, 0)} volume(s)
        {!veiculo.layoutConfirmed ? ' · Disposição do veículo provisória' : ''}
      </p>
      <div className="impr-mapa-corpo">
        <MapaVeiculo
          veiculo={veiculo}
          selecionado={null}
          posicaoEscolhida={null}
          movendo={null}
          aoEscolherPosicao={() => undefined}
          aoEscolherPalete={() => undefined}
          impressao={{ soConfirmadas: final }}
        />
        <table>
          <thead>
            <tr>
              <th>Pos.</th>
              <th>Palete</th>
              <th>Tipo</th>
              <th>NFs</th>
              <th>Volumes</th>
            </tr>
          </thead>
          <tbody>
            {ativos.map((p) => (
              <tr key={p.id}>
                <td>{String(p.position ?? 0).padStart(2, '0')}</td>
                <td>{p.label}</td>
                <td>{p.kind === 'FULL' ? 'FULL' : 'Frac.'}</td>
                <td>{p.lines.map((l) => l.documentNumber ?? 's/ nº').join(', ')}</td>
                <td>{p.volumes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="impr-rodape">Emitido em {formatarDataHora(carga.generatedAt)}</p>
    </section>
  );
}

export function ImpressaoCarga({ carga, pedido, aoPronto }: { carga: CargaJanela; pedido: PedidoImpressao; aoPronto: () => void }) {
  const veiculo = carga.vehicles.find((v) => v.id === pedido.veiculoId);
  if (!veiculo) return null;
  const p = veiculo.pallets.find((x) => x.id === pedido.paleteId);
  return (
    <div className="carga-impressao" data-testid="carga-impressao" data-tipo={pedido.kind}>
      {pedido.kind === 'MAPA' && <MapaCarga carga={carga} veiculo={veiculo} final={pedido.final} />}
      {pedido.kind === 'ETIQUETA' && p && <Etiqueta carga={carga} veiculo={veiculo} p={p} final={pedido.final} />}
      {pedido.kind === 'ESPELHO' && p && <EspelhoEmbarque carga={carga} veiculo={veiculo} p={p} final={pedido.final} layout={pedido.layout ?? layoutDoEmbarque()} aoPronto={aoPronto} />}
      {pedido.kind === 'DOCUMENTOS' && p && <ListaDocumentos carga={carga} veiculo={veiculo} p={p} />}
    </div>
  );
}
