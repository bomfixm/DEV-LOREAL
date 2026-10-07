import {
  API_PREFIXO,
  ExpedicaoDetalheSchema,
  JanelaDetalheSchema,
  ReservaDetalheSchema,
  ResponsaveisJanelaSchema,
  compararQuantidades,
  subtrairQuantidades,
  type BasePeso,
  type Permissao,
  type ReservaDetalhe,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { baixarArquivo, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeArquivo, IconeAtualizar } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarDataHora, paraEntradaLocal, paraIsoNoFuso } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { useAcoes, useUltimoPronto } from './acoes';
import { Capacidade } from './Capacidade';
import { ROTULOS_BASE_PESO, ROTULOS_CONDICAO, ROTULOS_PREPARACAO, ROTULOS_SITUACAO_RESERVA, q, textoOrigem } from './rotulos';

const decimal = (t: string) => t.trim().replace(',', '.');
const agoraLocal = () => paraEntradaLocal(new Date().toISOString());
const exibir = (v: string) => formatarQuantidade(v).replace(/\./g, '');
const vazioNulo = (t: string | undefined) => (t === undefined || t.trim() === '' ? null : t.trim());

interface MedidaReal {
  boxes: string;
  weightKg: string;
  weightBase: BasePeso;
  volumeM3: string;
  measurementSource: string;
  palletLeaves: boolean;
}

function ListaPreparacao({ r, aoNavegar }: { r: ReservaDetalhe; aoNavegar: Navegar }) {
  const medidas = new Map(r.loadUnits.map((u) => [u.palletId, u]));
  return (
    <div className="tabela-rolagem lista-preparacao">
      <table className="tabela-comparacao" data-testid="lista-preparacao">
        <thead>
          <tr>
            <th>Palete / unidade de carga</th>
            <th>Endereço atual</th>
            <th>Na reserva</th>
            <th>Produto</th>
            <th>Lote</th>
            <th>Origem</th>
            <th>Quantidade</th>
            <th>Condição</th>
            <th>Separado</th>
            <th>Medidas</th>
            <th>Impedimentos</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => {
            const u = medidas.get(l.palletId);
            const mudou = l.currentPositionCode !== l.snapshotPositionCode;
            return (
              <tr key={l.id} data-testid="linha-preparacao">
                <td data-rotulo="Palete / unidade de carga">
                  <button
                    type="button"
                    className="botao-link"
                    onClick={() => {
                      aoNavegar({ tipo: 'palete', id: l.palletId, reserva: r.id });
                    }}
                    data-testid="abrir-palete-preparacao"
                  >
                    {l.palletCode}
                  </button>
                  {l.palletFlowState === 'EXPEDIDO' ? ' (expedido)' : ''}
                </td>
                <td data-rotulo="Endereço atual" className={mudou ? 'pendente' : undefined}>{l.currentPositionCode ?? 'sem posição'}</td>
                <td data-rotulo="Na reserva">
                  {l.snapshotPositionCode ?? 'sem posição'}
                  {mudou ? ' (mudou)' : ''}
                </td>
                <td data-rotulo="Produto">
                  <strong>{l.sku}</strong> {l.description}
                </td>
                <td data-rotulo="Lote">{l.lot ?? 'pendente'}</td>
                <td data-rotulo="Origem">{l.originReference ? `${textoOrigem(l.originType)}${l.originReference}` : 'pendente'}</td>
                <td data-rotulo="Quantidade">
                  {formatarQuantidade(l.quantity)} {l.unit}
                  {l.shipped !== null ? ` · enviado ${formatarQuantidade(l.shipped)} · liberado ${formatarQuantidade(l.releasedRemainder ?? '0')}` : ''}
                </td>
                <td data-rotulo="Condição">{ROTULOS_CONDICAO[l.condition]}</td>
                <td data-rotulo="Separado">{l.prepared === null ? '—' : formatarQuantidade(l.prepared)}</td>
                <td data-rotulo="Medidas" className="tabela-nota">
                  {u
                    ? [u.boxes !== null ? `${u.boxes} cx` : null, u.weightKg !== null ? `${formatarQuantidade(u.weightKg)} kg ${u.weightBase ? ROTULOS_BASE_PESO[u.weightBase] : ''}` : null, u.volumeM3 !== null ? `${formatarQuantidade(u.volumeM3)} m³` : null]
                        .filter(Boolean)
                        .join(' · ') || 'não informadas'
                    : '—'}
                </td>
                <td data-rotulo="Impedimentos" className={l.currentProblems.length > 0 ? 'pendente' : undefined}>{l.currentProblems.join(' ') || 'nenhum'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Reserva: lista de preparação (consultável, imprimível, CSV; abre o palete
 * no mapa e volta), registro de separação, confirmação da expedição física
 * (baixa única; envio menor mostra "enviado e restante a liberar") e
 * cancelamento antes da saída.
 */
export function TelaReserva({ id, permissoes, aoNavegar, aoGravar }: { id: string; permissoes: readonly Permissao[]; aoNavegar: Navegar; aoGravar: () => void }) {
  const conectado = useConectado();
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/reservas/${id}`, ReservaDetalheSchema, versao);
  const r = useUltimoPronto(carga);
  const responsaveis = useRecurso(`${API_PREFIXO}/janelas/responsaveis`, ResponsaveisJanelaSchema);
  const janela = useRecurso(r === null ? null : `${API_PREFIXO}/janelas/${r.window.id}`, JanelaDetalheSchema, versao);
  const recarregarTudo = () => {
    setVersao((v) => v + 1);
  };
  const acoes = useAcoes(recarregarTudo);
  const [painel, setPainel] = useState<'preparar' | 'expedir' | 'cancelar' | null>(null);
  const [quando, setQuando] = useState(agoraLocal);
  const [responsavel, setResponsavel] = useState('');
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [medidas, setMedidas] = useState<Record<string, MedidaReal>>({});
  const [docs, setDocs] = useState<Record<string, { reference: string; attachmentId: string }>>({});
  const [ciente, setCiente] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erroCsv, setErroCsv] = useState<string | null>(null);
  const pode = (p: Permissao) => permissoes.includes(p);
  const voltar = () => {
    aoNavegar(r ? { tipo: 'janela', id: r.window.id, aba: 'reservas' } : { tipo: 'janelas', mes: null });
  };

  if (r === null) {
    return (
      <Pagina titulo="Reserva" testId="tela-reserva" aoVoltar={voltar} rotuloVoltar="Voltar à janela">
        {carga?.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>{carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={recarregar}>
              <IconeAtualizar />
              Tentar novamente
            </button>
          </div>
        ) : (
          <p className="estado-carregando">Carregando reserva…</p>
        )}
      </Pagina>
    );
  }

  const ativa = r.state === 'ATIVA';
  const metricas = new Set(r.windowMetrics.map((m) => m.metric));
  const pedeMedidas = metricas.has('CAIXAS') || metricas.has('PESO_KG') || metricas.has('VOLUME_M3');
  const qtd = (lineId: string, reservado: string) => qtds[lineId] ?? exibir(reservado);
  const medidaDe = (palletId: string): MedidaReal => {
    const atual = medidas[palletId];
    if (atual) return atual;
    const u = r.loadUnits.find((x) => x.palletId === palletId);
    return {
      boxes: u?.boxes ?? '',
      weightKg: u?.weightKg ? exibir(u.weightKg) : '',
      weightBase: u?.weightBase ?? 'BRUTO',
      volumeM3: u?.volumeM3 ? exibir(u.volumeM3) : '',
      measurementSource: u?.measurementSource ?? '',
      palletLeaves: false,
    };
  };
  const linhasEnvio = r.lines.map((l) => {
    const enviado = decimal(qtd(l.id, l.quantity));
    const valido = /^\d{1,15}(\.\d{1,3})?$/.test(enviado);
    return { l, enviado, valido, restante: valido ? subtrairQuantidades(l.quantity, enviado) : null };
  });
  const parcial = linhasEnvio.some((x) => x.restante !== null && compararQuantidades(x.restante, '0') > 0);
  const paletesEnviados = [...new Set(linhasEnvio.filter((x) => x.valido && compararQuantidades(x.enviado, '0') > 0).map((x) => x.l.palletId))];
  const anexos = janela.carga?.estado === 'pronto' ? janela.carga.dados.attachments : [];
  const medidaCorpo = (palletId: string, comSaida: boolean) => {
    const m = medidaDe(palletId);
    return {
      palletId,
      boxes: m.boxes.trim() === '' ? null : m.boxes.trim(),
      weightKg: m.weightKg.trim() === '' ? null : decimal(m.weightKg),
      weightBase: m.weightKg.trim() === '' ? null : m.weightBase,
      volumeM3: m.volumeM3.trim() === '' ? null : decimal(m.volumeM3),
      measurementSource: m.measurementSource.trim() === '' ? null : m.measurementSource.trim(),
      ...(comSaida ? { palletLeaves: m.palletLeaves } : {}),
    };
  };
  const mudarMedida = (palletId: string, parcialMedida: Partial<MedidaReal>) => {
    setMedidas({ ...medidas, [palletId]: { ...medidaDe(palletId), ...parcialMedida } });
  };
  const camposMedida = (palletId: string, codigo: string, comSaida: boolean) => {
    const m = medidaDe(palletId);
    return (
      <fieldset key={palletId} className="formulario-grade formulario-grade--compacta" data-testid="medidas-reais">
        <legend>Unidade de carga {codigo}</legend>
        {metricas.has('CAIXAS') && (
          <label className="campo">
            <span className="campo-rotulo">Caixas</span>
            <input value={m.boxes} inputMode="numeric" onChange={(e) => { mudarMedida(palletId, { boxes: e.target.value }); }} />
          </label>
        )}
        {metricas.has('PESO_KG') && (
          <>
            <label className="campo">
              <span className="campo-rotulo">Peso (kg)</span>
              <input value={m.weightKg} inputMode="decimal" onChange={(e) => { mudarMedida(palletId, { weightKg: e.target.value }); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Base</span>
              <select value={m.weightBase} onChange={(e) => { mudarMedida(palletId, { weightBase: e.target.value as BasePeso }); }}>
                <option value="BRUTO">{ROTULOS_BASE_PESO.BRUTO}</option>
                <option value="LIQUIDO">{ROTULOS_BASE_PESO.LIQUIDO}</option>
              </select>
            </label>
          </>
        )}
        {metricas.has('VOLUME_M3') && (
          <label className="campo">
            <span className="campo-rotulo">Volume (m³)</span>
            <input value={m.volumeM3} inputMode="decimal" onChange={(e) => { mudarMedida(palletId, { volumeM3: e.target.value }); }} data-testid="volume-real" />
          </label>
        )}
        {pedeMedidas && (
          <label className="campo">
            <span className="campo-rotulo">Fonte da medida</span>
            <input value={m.measurementSource} maxLength={120} onChange={(e) => { mudarMedida(palletId, { measurementSource: e.target.value }); }} />
          </label>
        )}
        {comSaida && (
          <label className="campo--linha">
            <input type="checkbox" checked={m.palletLeaves} onChange={(e) => { mudarMedida(palletId, { palletLeaves: e.target.checked }); }} data-testid="palete-sai" />
            <span>O palete físico inteiro sai (todo o saldo validado enviado; a posição fica livre)</span>
          </label>
        )}
      </fieldset>
    );
  };
  const ocupado = acoes.enviando !== null || !conectado;

  return (
    <Pagina ajuda="saida"
      titulo={`Reserva ${r.code}`}
      testId="tela-reserva"
      aoVoltar={voltar}
      rotuloVoltar="Voltar à janela"
      descricao={
        <p>
          <span className={`selo selo-reserva selo-reserva--${r.state}`} data-testid="situacao-reserva">
            {ROTULOS_SITUACAO_RESERVA[r.state]}
            {r.partial ? ' · conclusão parcial (restante liberado)' : ''}
          </span>{' '}
          Janela{' '}
          <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'janela', id: r.window.id, aba: null }); }}>
            {r.window.code} · {r.window.name}
          </button>{' '}
          · saída autorizada {r.window.exitStart ? `${formatarDataHora(r.window.exitStart)} a ${formatarDataHora(r.window.exitEnd ?? r.window.exitStart)}` : 'pendente'}
          {ativa ? ` · ${ROTULOS_PREPARACAO[r.preparation.state]}` : ''}
          {r.dataSource === 'DEMONSTRACAO_FICTICIA' ? ' · dados fictícios' : ''}
        </p>
      }
    >
      <section className="cartao" aria-label="Lista de preparação">
        <div className="cartao-janela-topo">
          <h3>Lista de preparação (documento operacional interno)</h3>
          <div className="acoes-linha nao-imprimir">
            <button type="button" className="botao-secundario botao-compacto" onClick={() => { window.print(); }} data-testid="imprimir-preparacao">
              Imprimir
            </button>
            {pode('janela.exportar') && (
              <button
                type="button"
                className="botao-secundario botao-compacto"
                data-testid="exportar-preparacao"
                onClick={() => {
                  setErroCsv(null);
                  baixarArquivo(`${API_PREFIXO}/reservas/${r.id}/preparacao.csv`, `preparacao-${r.code}.csv`).catch((e: unknown) => {
                    setErroCsv(mensagemDeFalha(e));
                  });
                }}
              >
                <IconeArquivo />
                CSV
              </button>
            )}
          </div>
        </div>
        {erroCsv && <p className="estado-erro">{erroCsv}</p>}
        <ListaPreparacao r={r} aoNavegar={aoNavegar} />
        <p className="campo-ajuda">
          Documentos exigidos: {r.requiredDocuments.join(', ') || 'nenhum informado'} · preparar não baixa estoque nem confirma saída · endereço atual pode diferir do registrado na reserva.
        </p>
        {r.preparation.state !== 'PENDENTE' && (
          <p className={r.preparation.state === 'DIVERGENTE' ? 'mensagem-conflito' : 'mensagem-ok'} data-testid="preparacao-registrada">
            {ROTULOS_PREPARACAO[r.preparation.state]} em {r.preparation.preparedAt ? formatarDataHora(r.preparation.preparedAt) : ''} · responsável {r.preparation.responsible?.name ?? ''}
            {r.preparation.differences.length > 0 ? ` · ${r.preparation.differences.join(' ')} Recontagem ou correção da reserva necessária; o saldo não é ajustado.` : ''}
          </p>
        )}
      </section>

      <section className="cartao" aria-label="Capacidade">
        <h3>Capacidade da janela agora</h3>
        <Capacidade restricoes={r.windowMetrics} compacta />
        <p className="campo-ajuda">Esta reserva: {r.metrics.map((m) => `${q(m.value)} ${m.unit}`).join(' · ')}</p>
      </section>

      {ativa && (
        <div className="acoes-linha nao-imprimir">
          {pode('expedicao.preparar') && (
            <button type="button" className="botao-secundario" onClick={() => { setPainel('preparar'); }} data-testid="abrir-preparar">
              Registrar separação/preparação
            </button>
          )}
          {pode('expedicao.confirmar') && (
            <button type="button" className="botao-primario" onClick={() => { setPainel('expedir'); }} data-testid="abrir-expedir">
              Confirmar expedição
            </button>
          )}
          {pode('janela.reservar') && (
            <button type="button" className="botao-perigo" onClick={() => { setPainel('cancelar'); }} data-testid="abrir-cancelar-reserva">
              Cancelar reserva
            </button>
          )}
        </div>
      )}
      {r.expedition && (
        <p className="mensagem-ok">
          Expedida em {formatarDataHora(r.expedition.shippedAt)} ·{' '}
          <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'expedicao', id: r.expedition?.id ?? '' }); }} data-testid="abrir-expedicao">
            {r.expedition.code}
          </button>
        </p>
      )}
      {r.closure && !r.expedition && (
        <p className="mensagem-conflito">
          {ROTULOS_SITUACAO_RESERVA[r.state]} em {formatarDataHora(r.closure.at)} por {r.closure.by.name}: {r.closure.reason}
        </p>
      )}

      {ativa && painel !== null && (
        <form
          className="cartao painel-acao nao-imprimir"
          data-testid={`painel-${painel}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (painel === 'cancelar') {
              void acoes
                .executar(`cancelar:${r.id}`, 'POST', `${API_PREFIXO}/reservas/${r.id}/cancelar`, { expectedVersion: r.version, reason: motivo }, ReservaDetalheSchema, 'Reserva cancelada: estoque disponível e capacidade liberados.')
                .then((d) => {
                  if (d) {
                    setPainel(null);
                    aoGravar();
                    recarregarTudo();
                  }
                });
              return;
            }
            const instante = paraIsoNoFuso(quando);
            if (instante === null) {
              acoes.setMensagem({ tipo: 'erro', texto: 'Informe data e hora válidas.' });
              return;
            }
            if (painel === 'preparar') {
              const corpo = {
                expectedVersion: r.version,
                preparedAt: instante,
                responsibleId: responsavel,
                lines: r.lines.map((l) => ({ lineId: l.id, quantity: decimal(qtd(l.id, l.quantity)) })),
                loadUnits: pedeMedidas && Object.keys(medidas).length > 0 ? r.loadUnits.map((u) => medidaCorpo(u.palletId, false)) : [],
                notes: observacao.trim() || null,
              };
              void acoes.executar(`preparar:${r.id}:${JSON.stringify(corpo)}`, 'POST', `${API_PREFIXO}/reservas/${r.id}/preparacao`, corpo, ReservaDetalheSchema, 'Preparação registrada (não baixa estoque).').then((d) => {
                if (d) {
                  setPainel(null);
                  recarregarTudo();
                }
              });
              return;
            }
            const corpo = {
              expectedVersion: r.version,
              shippedAt: instante,
              responsibleId: responsavel,
              lines: linhasEnvio.map((x) => ({ lineId: x.l.id, quantity: x.enviado })),
              loadUnits: paletesEnviados.map((p) => medidaCorpo(p, true)),
              documents: r.requiredDocuments.map((nome) => ({ name: nome, reference: vazioNulo(docs[nome]?.reference), attachmentId: vazioNulo(docs[nome]?.attachmentId) })),
              remainderAcknowledged: ciente,
              notes: observacao.trim() || null,
            };
            void acoes.executar(`expedir:${r.id}:${JSON.stringify(corpo)}`, 'POST', `${API_PREFIXO}/reservas/${r.id}/expedicao`, corpo, ExpedicaoDetalheSchema, 'Expedição confirmada: baixa única registrada.').then((d) => {
              if (d) {
                aoGravar();
                aoNavegar({ tipo: 'expedicao', id: d.id });
              }
            });
          }}
        >
          {painel === 'cancelar' ? (
            <>
              <h3>Cancelar reserva antes da saída</h3>
              <p>Estoque disponível e capacidade voltam na mesma operação; a reserva fica no histórico. Material já expedido nunca volta por cancelamento.</p>
              <label className="campo">
                <span className="campo-rotulo">Motivo</span>
                <input value={motivo} maxLength={500} onChange={(e) => { setMotivo(e.target.value); }} data-testid="motivo-cancelar-reserva" />
              </label>
            </>
          ) : (
            <>
              <h3>{painel === 'preparar' ? 'Registrar separação/preparação' : 'Confirmar expedição física'}</h3>
              <p className="campo-ajuda">
                {painel === 'preparar'
                  ? 'Confirme as quantidades separadas. Diferença fica registrada para recontagem ou correção da reserva; o saldo não é ajustado.'
                  : 'Registre o que saiu de fato. Imprimir a lista, preparar ou chegar à data da janela não confirmam saída. A baixa acontece uma única vez.'}
              </p>
              <div className="formulario-grade">
                <label className="campo">
                  <span className="campo-rotulo">{painel === 'preparar' ? 'Data/hora da separação' : 'Data/hora da saída'} (Brasília)</span>
                  <input type="datetime-local" value={quando} onChange={(e) => { setQuando(e.target.value); }} data-testid="quando" />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Responsável</span>
                  <select value={responsavel} onChange={(e) => { setResponsavel(e.target.value); }} data-testid="responsavel">
                    <option value="">Escolha…</option>
                    {responsaveis.carga?.estado === 'pronto' &&
                      responsaveis.carga.dados.items.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="tabela-rolagem">
                <table className="tabela-comparacao">
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Reservado</th>
                      <th>{painel === 'preparar' ? 'Separado' : 'Enviado'}</th>
                      {painel === 'expedir' && <th>Restante a liberar</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {linhasEnvio.map((x) => (
                      <tr key={x.l.id}>
                        <td data-rotulo="Linha">
                          {x.l.palletCode} · {x.l.sku} {x.l.lot ? `lote ${x.l.lot}` : ''}
                        </td>
                        <td data-rotulo="Reservado">
                          {formatarQuantidade(x.l.quantity)} {x.l.unit}
                        </td>
                        <td data-rotulo="Quantidade">
                          <input
                            className="campo-numero"
                            value={qtd(x.l.id, x.l.quantity)}
                            inputMode="decimal"
                            aria-label={`Quantidade de ${x.l.sku} no palete ${x.l.palletCode}`}
                            onChange={(e) => { setQtds({ ...qtds, [x.l.id]: e.target.value }); }}
                            data-testid="quantidade-linha"
                          />
                        </td>
                        {painel === 'expedir' && <td data-rotulo="Restante a liberar" className={x.restante !== null && compararQuantidades(x.restante, '0') > 0 ? 'pendente' : undefined}>{x.restante === null ? 'inválido' : formatarQuantidade(x.restante.replace(/^-/, '−'))}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pedeMedidas && painel === 'preparar' && (
                <details>
                  <summary>Atualizar medidas da carga (revalida a capacidade)</summary>
                  {r.loadUnits.map((u) => camposMedida(u.palletId, u.palletCode, false))}
                </details>
              )}
              {painel === 'expedir' && (
                <>
                  {paletesEnviados.map((p) => camposMedida(p, r.lines.find((l) => l.palletId === p)?.palletCode ?? '', true))}
                  {r.requiredDocuments.length > 0 && (
                    <fieldset className="campo">
                      <legend className="campo-rotulo">Documentos exigidos pela janela</legend>
                      {r.requiredDocuments.map((nome) => (
                        <div key={nome} className="formulario-grade formulario-grade--compacta">
                          <label className="campo">
                            <span className="campo-rotulo">{nome}: referência</span>
                            <input value={docs[nome]?.reference ?? ''} maxLength={120} onChange={(e) => { setDocs({ ...docs, [nome]: { reference: e.target.value, attachmentId: docs[nome]?.attachmentId ?? '' } }); }} data-testid="documento-referencia" />
                          </label>
                          <label className="campo">
                            <span className="campo-rotulo">ou anexo da janela</span>
                            <select value={docs[nome]?.attachmentId ?? ''} onChange={(e) => { setDocs({ ...docs, [nome]: { reference: docs[nome]?.reference ?? '', attachmentId: e.target.value } }); }}>
                              <option value="">—</option>
                              {anexos.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ))}
                    </fieldset>
                  )}
                  {parcial && (
                    <div className="cartao-confirmacao cartao-confirmacao--pendente" data-testid="aviso-parcial">
                      <p>
                        <strong>Quantidade enviada e restante a liberar:</strong>{' '}
                        {linhasEnvio
                          .filter((x) => x.restante !== null && compararQuantidades(x.restante, '0') > 0)
                          .map((x) => `${x.l.sku} (${x.l.palletCode}): enviado ${formatarQuantidade(x.enviado)}, restante ${formatarQuantidade(x.restante ?? '0')} ${x.l.unit} liberado`)
                          .join(' · ')}
                        . A reserva será concluída parcialmente; o restante físico continua no estoque e precisa de nova reserva para outra saída.
                      </p>
                      <label className="campo--linha">
                        <input type="checkbox" checked={ciente} onChange={(e) => { setCiente(e.target.checked); }} data-testid="ciente-parcial" />
                        <span>Confirmo o envio parcial e a liberação do restante</span>
                      </label>
                    </div>
                  )}
                </>
              )}
              <label className="campo">
                <span className="campo-rotulo">Observações</span>
                <input value={observacao} maxLength={500} onChange={(e) => { setObservacao(e.target.value); }} />
              </label>
            </>
          )}
          <div className="acoes-linha">
            <button
              type="submit"
              className={painel === 'cancelar' ? 'botao-perigo' : 'botao-primario'}
              disabled={ocupado || (painel === 'cancelar' ? motivo.trim().length < 3 : responsavel === '' || (painel === 'expedir' && parcial && !ciente))}
              data-testid={`enviar-${painel}`}
            >
              {acoes.enviando !== null ? 'Enviando…' : painel === 'cancelar' ? 'Cancelar reserva' : painel === 'preparar' ? 'Registrar preparação' : 'Confirmar expedição'}
            </button>
            <button type="button" className="botao-link" onClick={() => { setPainel(null); }}>
              Voltar
            </button>
            {!conectado && <span className="campo-ajuda">Sem conexão: nenhuma saída é confirmada localmente.</span>}
          </div>
        </form>
      )}
      <MensagemAcao mensagem={acoes.mensagem} testId="mensagem-acao-reserva" />
      <p className="campo-ajuda">
        Criada em {formatarDataHora(r.createdAt)} por {r.createdBy.name} · versão {r.version} · regras da janela v{r.rulesVersion} na reserva · consultado em {formatarDataHora(r.consultedAt)}
      </p>
    </Pagina>
  );
}
