import {
  API_PREFIXO,
  PaginaJanelasSchema,
  PropostaJanelaSchema,
  ResultadoPropostaSchema,
  type BasePeso,
  type Permissao,
  type PropostaJanela as Proposta,
  type ResultadoProposta,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { MensagemAcao } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarQuantidade } from '../../utils/numeros';
import { ROTULOS_BASE_PESO, rotuloMetrica } from '../janelas/rotulos';

interface Medida {
  boxes: string;
  weightKg: string;
  weightBase: BasePeso;
  volumeM3: string;
  measurementSource: string;
}
const MEDIDA_VAZIA: Medida = { boxes: '', weightKg: '', weightBase: 'BRUTO', volumeM3: '', measurementSource: '' };
const decimal = (t: string) => t.trim().replace(',', '.');

/**
 * "Preparar para a janela": monta, no servidor, a proposta com as linhas
 * elegíveis escolhidas (nada é gravado), mostra o que fica de fora e a
 * verificação da etapa 08 (critérios, liberação, disponível, capacidade) e só
 * reserva com a confirmação explícita de quem revisou. A reserva é integral ou
 * nada; mudanças nos registros depois da revisão invalidam a proposta.
 */
export function PropostaJanela({
  selecaoId,
  linhas,
  permissoes,
  aoNavegar,
  aoReservado,
}: {
  selecaoId: string;
  /** Linhas escolhidas (IDs) e o número da linha no arquivo, para o texto. */
  linhas: readonly { id: string; row: number }[];
  permissoes: readonly Permissao[];
  aoNavegar: Navegar;
  aoReservado: () => void;
}) {
  const chaves = useChaves();
  const conectado = useConectado();
  const janelas = useRecurso(`${API_PREFIXO}/janelas?tamanho=100`, PaginaJanelasSchema);
  const operaveis = janelas.carga?.estado === 'pronto' ? janelas.carga.dados.items.filter((j) => j.state === 'CONFIRMADA' || j.state === 'PREPARACAO') : [];
  const [janelaId, setJanelaId] = useState('');
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [montando, setMontando] = useState(false);
  const [reservando, setReservando] = useState(false);
  const [revisado, setRevisado] = useState(false);
  const [medidas, setMedidas] = useState<Map<string, Medida>>(new Map());
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null>(null);
  const [resultado, setResultado] = useState<ResultadoProposta | null>(null);
  const janela = operaveis.find((j) => j.id === janelaId) ?? null;
  const metricas = new Set(janela?.restrictions.map((r) => r.metric) ?? []);
  const pedeMedidas = metricas.has('CAIXAS') || metricas.has('PESO_KG') || metricas.has('VOLUME_M3');
  const podeReservar = permissoes.includes('janela.reservar');
  const assinaturaLinhas = linhas.map((l) => l.id).join(',');
  const [linhasDaProposta, setLinhasDaProposta] = useState(assinaturaLinhas);
  // Outra escolha de linhas invalida a proposta montada.
  if (linhasDaProposta !== assinaturaLinhas) {
    setLinhasDaProposta(assinaturaLinhas);
    setProposta(null);
    setRevisado(false);
  }
  const paletes = proposta ? [...new Map(proposta.items.map((i) => [i.palletId, i.palletCode])).entries()] : [];

  async function montar() {
    setMontando(true);
    setMensagem(null);
    setResultado(null);
    setRevisado(false);
    try {
      const p = await enviarJson('POST', `${API_PREFIXO}/selecoes/${selecaoId}/proposta-janela`, PropostaJanelaSchema, { corpo: { windowId: janelaId, lineIds: linhas.map((l) => l.id) } });
      setProposta(p);
    } catch (e) {
      setProposta(null);
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(e) });
    } finally {
      setMontando(false);
    }
  }

  async function reservar() {
    if (!proposta) return;
    const corpo = {
      windowId: proposta.windowId,
      expectedWindowVersion: proposta.windowVersion,
      expectedSelectionVersion: proposta.selectionVersion,
      signature: proposta.signature,
      lineIds: proposta.lines.map((l) => l.lineId),
      loadUnits: pedeMedidas
        ? paletes.map(([palletId]) => {
            const m = medidas.get(palletId) ?? MEDIDA_VAZIA;
            return {
              palletId,
              boxes: m.boxes.trim() === '' ? null : m.boxes.trim(),
              weightKg: m.weightKg.trim() === '' ? null : decimal(m.weightKg),
              weightBase: m.weightKg.trim() === '' ? null : m.weightBase,
              volumeM3: m.volumeM3.trim() === '' ? null : decimal(m.volumeM3),
              measurementSource: m.measurementSource.trim() === '' ? null : m.measurementSource.trim(),
            };
          })
        : [],
      notes: null,
      reviewed: true as const,
    };
    const assinatura = `reservar-selecao:${selecaoId}:${proposta.signature}:${JSON.stringify(corpo.loadUnits)}`;
    setReservando(true);
    setMensagem(null);
    try {
      const r = await enviarJson('POST', `${API_PREFIXO}/selecoes/${selecaoId}/reservar`, ResultadoPropostaSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setResultado(r);
      setProposta(null);
      setMensagem({ tipo: 'ok', texto: `Reserva ${r.reservationCode} confirmada pelo fluxo da janela, com ${String(r.linkedLines)} vínculo(s) linha × reserva. Nada foi expedido.` });
      aoReservado();
    } catch (e) {
      chaves.concluir(assinatura, e);
      const codigo = e instanceof FalhaRequisicao ? e.codigo : null;
      if (codigo === 'CONCILIACAO_DESATUALIZADA' || codigo === 'CONFLITO_VERSAO') {
        setProposta(null);
        setMensagem({ tipo: 'conflito', texto: `${mensagemDeFalha(e)} Monte a proposta de novo para revisar.` });
        aoReservado();
      } else {
        setMensagem({ tipo: e instanceof FalhaRequisicao && e.tipo === 'rede' ? 'conflito' : 'erro', texto: mensagemDeFalha(e) });
      }
    } finally {
      setReservando(false);
    }
  }

  const mudarMedida = (palletId: string, parcial: Partial<Medida>) => {
    const nova = new Map(medidas);
    nova.set(palletId, { ...(medidas.get(palletId) ?? MEDIDA_VAZIA), ...parcial });
    setMedidas(nova);
    setRevisado(false);
  };

  return (
    <section className="cartao" aria-labelledby="titulo-proposta-janela" data-testid="secao-proposta-janela">
      <h3 id="titulo-proposta-janela">Preparar para a janela</h3>
      <p className="campo-ajuda">
        A proposta usa só as linhas escolhidas que têm material validado, liberado e disponível. As demais continuam visíveis como não atendidas. Importar e conciliar não
        reservam; a reserva só acontece aqui, revisada, e revalida tudo no servidor.
      </p>
      {linhas.length === 0 ? (
        <p className="estado-vazio">Marque na tabela as linhas elegíveis que vão para a janela.</p>
      ) : (
        <p>
          {linhas.length} linha(s) escolhida(s): {linhas.map((l) => l.row).join(', ')}.
        </p>
      )}
      <label className="campo">
        <span className="campo-rotulo">Janela de devolução</span>
        <select
          value={janelaId}
          onChange={(e) => {
            setJanelaId(e.target.value);
            setProposta(null);
            setRevisado(false);
          }}
          data-testid="escolher-janela"
        >
          <option value="">Escolha a janela…</option>
          {operaveis.map((j) => (
            <option key={j.id} value={j.id}>
              {j.code} — {j.name}
              {j.pendencies.length > 0 ? ' (com pendências)' : ''}
            </option>
          ))}
        </select>
        {janelas.carga?.estado === 'pronto' && operaveis.length === 0 && <span className="campo-ajuda">Nenhuma janela confirmada ou em preparação neste escopo.</span>}
      </label>
      <button type="button" className="botao-secundario" disabled={janelaId === '' || linhas.length === 0 || montando || !conectado} onClick={() => { void montar(); }} data-testid="montar-proposta">
        {montando ? 'Montando no servidor…' : 'Montar proposta (nada é gravado)'}
      </button>
      <MensagemAcao mensagem={mensagem} testId="mensagem-proposta" />
      {resultado && (
        <button
          type="button"
          className="botao-primario"
          onClick={() => {
            aoNavegar({ tipo: 'reserva', id: resultado.reservationId });
          }}
          data-testid="abrir-reserva"
        >
          Abrir a reserva {resultado.reservationCode} (lista de preparação)
        </button>
      )}
      {proposta && (
        <div className="proposta-janela" data-testid="proposta-janela">
          <h4>
            Proposta para {proposta.windowCode} (revisão da seleção v{proposta.selectionVersion}, janela v{proposta.windowVersion})
          </h4>
          {proposta.items.length > 0 ? (
            <div className="tabela-rolagem">
              <table className="tabela-comparacao" data-testid="itens-proposta">
                <caption className="visualmente-oculto">Material proposto por palete e endereço</caption>
                <thead>
                  <tr>
                    <th scope="col">Palete</th>
                    <th scope="col">Endereço atual</th>
                    <th scope="col">SKU / lote</th>
                    <th scope="col">Quantidade</th>
                  </tr>
                </thead>
                <tbody>
                  {proposta.items.map((i) => (
                    <tr key={`${i.lineId}:${i.palletId}:${i.segmentId}`}>
                      <td>{i.palletCode}</td>
                      <td>{i.address ?? i.positionCode ?? 'localização pendente'}</td>
                      <td>
                        {i.sku}
                        {i.lot ? ` · lote ${i.lot}` : ''}
                      </td>
                      <td>
                        {formatarQuantidade(i.quantity)} {i.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="estado-vazio">Nenhum material elegível nas linhas escolhidas: nada a reservar.</p>
          )}
          <ul className="linhas-proposta">
            {proposta.lines.map((l) => (
              <li key={l.lineId}>
                Linha {l.row}: proposto {formatarQuantidade(l.proposed)} {l.unit ?? ''}
                {l.requested !== null ? ` de ${formatarQuantidade(l.requested)} solicitados` : ''}
                {l.unmet !== null ? ` · ${formatarQuantidade(l.unmet)} não atendidos pelos registros` : ''}
                {l.notes.length > 0 ? ` · ${l.notes.join(' ')}` : ''}
              </li>
            ))}
          </ul>
          {proposta.excluded.length > 0 && (
            <div className="mensagem-conflito" role="note" data-testid="excluidas-proposta">
              <p>Ficam de fora (continuam visíveis como não atendidas):</p>
              <ul>
                {proposta.excluded.map((x) => (
                  <li key={x.lineId}>
                    Linha {x.row}: {x.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {proposta.reservation && (
            <div className={proposta.reservation.allowed ? 'mensagem-ok' : 'mensagem-conflito'} data-testid="verificacao-reserva">
              <p>
                <strong>{proposta.reservation.allowed ? 'Verificação da janela: pode reservar.' : 'Verificação da janela: a reserva seria recusada.'}</strong>
              </p>
              {proposta.reservation.blockers.length > 0 && (
                <ul>
                  {proposta.reservation.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              <ul>
                {proposta.reservation.metrics.map((m) => (
                  <li key={m.restrictionId}>
                    {rotuloMetrica(m)}: {m.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pedeMedidas && paletes.length > 0 && (
            <fieldset className="campo">
              <legend className="campo-rotulo">Medidas das unidades de carga (exigidas pela janela)</legend>
              {paletes.map(([palletId, codigo]) => {
                const m = medidas.get(palletId) ?? MEDIDA_VAZIA;
                return (
                  <div key={palletId} className="formulario-grade formulario-grade--compacta">
                    <strong>{codigo}</strong>
                    {metricas.has('CAIXAS') && (
                      <label className="campo">
                        <span className="campo-rotulo">Caixas</span>
                        <input inputMode="numeric" value={m.boxes} onChange={(e) => { mudarMedida(palletId, { boxes: e.target.value }); }} />
                      </label>
                    )}
                    {metricas.has('PESO_KG') && (
                      <>
                        <label className="campo">
                          <span className="campo-rotulo">Peso (kg)</span>
                          <input inputMode="decimal" value={m.weightKg} onChange={(e) => { mudarMedida(palletId, { weightKg: e.target.value }); }} />
                        </label>
                        <label className="campo">
                          <span className="campo-rotulo">Base do peso</span>
                          <select value={m.weightBase} onChange={(e) => { mudarMedida(palletId, { weightBase: e.target.value === 'LIQUIDO' ? 'LIQUIDO' : 'BRUTO' }); }}>
                            <option value="BRUTO">{ROTULOS_BASE_PESO.BRUTO}</option>
                            <option value="LIQUIDO">{ROTULOS_BASE_PESO.LIQUIDO}</option>
                          </select>
                        </label>
                      </>
                    )}
                    {metricas.has('VOLUME_M3') && (
                      <label className="campo">
                        <span className="campo-rotulo">Volume (m³)</span>
                        <input inputMode="decimal" value={m.volumeM3} onChange={(e) => { mudarMedida(palletId, { volumeM3: e.target.value }); }} />
                      </label>
                    )}
                    <label className="campo">
                      <span className="campo-rotulo">Fonte da medida</span>
                      <input value={m.measurementSource} maxLength={120} onChange={(e) => { mudarMedida(palletId, { measurementSource: e.target.value }); }} placeholder="ex.: balança, trena" />
                    </label>
                  </div>
                );
              })}
            </fieldset>
          )}
          {podeReservar ? (
            <>
              <label className="opcao">
                <input type="checkbox" checked={revisado} onChange={(e) => { setRevisado(e.target.checked); }} data-testid="revisei-proposta" />
                Revisei a proposta e as linhas que ficam de fora. Reservar tudo ou nada pelo fluxo da janela.
              </label>
              <button
                type="button"
                className="botao-primario"
                disabled={!revisado || reservando || !conectado || proposta.items.length === 0}
                onClick={() => {
                  void reservar();
                }}
                data-testid="confirmar-reserva-selecao"
              >
                {reservando ? 'Reservando no servidor…' : 'Confirmar reserva'}
              </button>
            </>
          ) : (
            <p className="campo-ajuda">Confirmar a reserva exige a permissão de reservar janelas (supervisor de estoque). A proposta pode ser exportada como lista de separação.</p>
          )}
        </div>
      )}
    </section>
  );
}
