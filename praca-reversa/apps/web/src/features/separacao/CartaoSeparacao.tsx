import { ROTULOS_SITUACAO_NOTA_SEPARACAO, type NotaSeparacao, type SeparacaoCliente } from '@praca-reversa/contracts';
import { IconeArquivo } from '../../components/Icones';
import { formatarDataHora } from '../../utils/datas';

const dataJanela = (j: string | null) => (j === null ? 'não informada' : /^\d{4}-\d{2}-\d{2}/.test(j) ? `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}` : j);

function TabelaNotas({ notas }: { notas: readonly NotaSeparacao[] }) {
  return (
    <div className="janela-tabela-rolagem" role="region" aria-label="Notas sem palete ou sem posição" tabIndex={0}>
      <table className="janela-tabela" data-testid="separacao-pendentes">
        <thead>
          <tr>
            <th scope="col">Situação</th>
            <th scope="col">Número</th>
            <th scope="col">Remetente</th>
            <th scope="col" className="numero">
              Volumes
            </th>
            <th scope="col">Na planilha</th>
            <th scope="col">Palete no sistema</th>
          </tr>
        </thead>
        <tbody>
          {notas.map((n) => (
            <tr key={n.row} data-numero={n.number}>
              <td>{ROTULOS_SITUACAO_NOTA_SEPARACAO[n.situation]}</td>
              <td>{n.number}</td>
              <td>{n.sender ?? '—'}</td>
              <td className="numero">{n.volumes ?? '—'}</td>
              <td>{[n.informedPallet === null ? null : `Palete ${n.informedPallet}`, n.informedAddress].filter(Boolean).join(' · ') || '—'}</td>
              <td>{n.locations.map((l) => l.palletCode).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CartaoSeparacao({ s, podeGravar, ocupado, aoEncerrar, aoBaixar }: { s: SeparacaoCliente; podeGravar: boolean; ocupado: boolean; aoEncerrar: () => void; aoBaixar: () => void }) {
  const fora = s.notes.filter((n) => n.situation !== 'NO_MAPA');
  const noMapa = s.notes.length - fora.length;
  return (
    <section className="cartao" data-testid="separacao-cartao">
      <h2>Planilha do cliente · janela {dataJanela(s.window)}</h2>
      <p className="tabela-nota">
        {s.fileName} · enviada em {formatarDataHora(s.createdAt)} por {s.createdBy}
      </p>
      <p data-testid="separacao-resumo">
        <strong>{s.palletsOnMap}</strong> palete(s) em roxo no mapa · <strong>{noMapa}</strong> de {s.notes.length} linha(s) com nota no mapa · <strong>{fora.length}</strong> sem palete ou sem posição
      </p>
      <div className="acoes-linha">
        <button type="button" className="botao-secundario" onClick={aoBaixar} data-testid="separacao-baixar">
          <IconeArquivo />
          Baixar relatório em Excel
        </button>
        {podeGravar && (
          <button type="button" className="botao-secundario" disabled={ocupado} onClick={aoEncerrar} data-testid="separacao-encerrar">
            Encerrar (tirar o roxo do mapa)
          </button>
        )}
      </div>
      {fora.length > 0 && <TabelaNotas notas={fora} />}
    </section>
  );
}
