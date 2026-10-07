import {
  API_PREFIXO,
  AnexoJanelaSchema,
  CONDICOES_MATERIAL,
  ExpedicaoDetalheSchema,
  JanelaDetalheSchema,
  ListaPaletesSchema,
  type CondicaoMaterial,
  type Permissao,
  type TipoRetorno,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { useChaves } from '../../api/chaves';
import { enviarArquivo, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarDataHora, paraEntradaLocal, paraIsoNoFuso } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { useAcoes, useUltimoPronto } from './acoes';
import { ROTULOS_BASE_PESO, ROTULOS_CONDICAO, ROTULOS_RETORNO, q, rotuloMetrica, textoOrigem } from './rotulos';

const decimal = (t: string) => t.trim().replace(',', '.');

/**
 * Expedição confirmada (imutável): linhas reservadas/enviadas/liberadas,
 * unidades de carga e medidas reais, capacidade convertida, documentos e
 * eventos de baixa. Não há botão de desfazer: correção de informação gera
 * nova versão com motivo; retorno físico é registrado contra a saída original
 * (a entrada no estoque é a conferência e reconciliação do palete de destino).
 */
export function TelaExpedicao({ id, permissoes, aoNavegar, aoGravar }: { id: string; permissoes: readonly Permissao[]; aoNavegar: Navegar; aoGravar: () => void }) {
  const conectado = useConectado();
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/expedicoes/${id}`, ExpedicaoDetalheSchema, versao);
  const e = useUltimoPronto(carga);
  const janela = useRecurso(e === null ? null : `${API_PREFIXO}/janelas/${e.window.id}`, JanelaDetalheSchema, versao);
  const recarregarTudo = () => {
    setVersao((v) => v + 1);
  };
  const acoes = useAcoes(recarregarTudo);
  const chaves = useChaves();
  const [painel, setPainel] = useState<'retorno' | 'correcao' | null>(null);
  const [tipo, setTipo] = useState<TipoRetorno>('RECEBIMENTO_FISICO');
  const [quando, setQuando] = useState(() => paraEntradaLocal(new Date().toISOString()));
  const [motivo, setMotivo] = useState('');
  const [condicao, setCondicao] = useState<CondicaoMaterial>('SAUDAVEL');
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [codigoDestino, setCodigoDestino] = useState('');
  const [anexosSel, setAnexosSel] = useState<string[]>([]);
  const [observacao, setObservacao] = useState('');
  const [erroAnexo, setErroAnexo] = useState<string | null>(null);
  const busca = useRecurso(codigoDestino.trim().length >= 3 ? `${API_PREFIXO}/paletes?texto=${encodeURIComponent(codigoDestino.trim())}&limite=10` : null, ListaPaletesSchema);
  const candidatos = busca.carga?.estado === 'pronto' ? busca.carga.dados.items.filter((p) => p.countState === 'NAO_CONFERIDO' && p.flowState !== 'EXPEDIDO') : [];
  const [destino, setDestino] = useState<string>('');
  const pode = (p: Permissao) => permissoes.includes(p);
  const voltar = () => {
    aoNavegar(e ? { tipo: 'janela', id: e.window.id, aba: 'reservas' } : { tipo: 'janelas', mes: null });
  };
  if (e === null) {
    return (
      <Pagina titulo="Expedição" testId="tela-expedicao" aoVoltar={voltar} rotuloVoltar="Voltar à janela">
        {carga?.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>{carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={recarregar}>
              <IconeAtualizar />
              Tentar novamente
            </button>
          </div>
        ) : (
          <p className="estado-carregando">Carregando expedição…</p>
        )}
      </Pagina>
    );
  }
  const anexos = janela.carga?.estado === 'pronto' ? janela.carga.dados.attachments : [];
  const ocupado = acoes.enviando !== null || !conectado;
  const linhasRetorno = e.lines
    .map((l) => ({ l, texto: qtds[l.id] ?? '' }))
    .filter((x) => x.texto.trim() !== '');

  return (
    <Pagina ajuda="saida"
      titulo={`Expedição ${e.code}`}
      testId="tela-expedicao"
      aoVoltar={voltar}
      rotuloVoltar="Voltar à janela"
      descricao={
        <p>
          <span className="selo selo-ok" data-testid="situacao-expedicao">
            Saída confirmada{e.partial ? ' · conclusão parcial (restante liberado)' : ''}
          </span>{' '}
          {formatarDataHora(e.shippedAt)} · responsável {e.responsible.name} · confirmada por {e.confirmedBy.name} em {formatarDataHora(e.confirmedAt)} · janela{' '}
          <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'janela', id: e.window.id, aba: null }); }}>
            {e.window.code}
          </button>{' '}
          · reserva{' '}
          <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'reserva', id: e.reservation.id }); }}>
            {e.reservation.code}
          </button>
          {e.dataSource === 'DEMONSTRACAO_FICTICIA' ? ' · dados fictícios' : ''}
        </p>
      }
    >
      <section className="cartao">
        <h3>Linhas (baixa única do enviado)</h3>
        <div className="tabela-rolagem">
          <table className="tabela-comparacao" data-testid="linhas-expedicao">
            <thead>
              <tr>
                <th>Palete</th>
                <th>Endereço na saída</th>
                <th>Produto</th>
                <th>Lote</th>
                <th>Origem</th>
                <th>Reservado</th>
                <th>Enviado</th>
                <th>Restante liberado</th>
                <th>Retornado (físico)</th>
              </tr>
            </thead>
            <tbody>
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <td data-rotulo="Palete">{l.palletCode}</td>
                  <td data-rotulo="Endereço na saída">{l.positionCodeAtExit ?? 'sem posição'}</td>
                  <td data-rotulo="Produto">
                    <strong>{l.sku}</strong> {l.description} · {ROTULOS_CONDICAO[l.condition]}
                  </td>
                  <td data-rotulo="Lote">{l.lot ?? 'pendente'}</td>
                  <td data-rotulo="Origem">{l.originReference ? `${textoOrigem(l.originType)}${l.originReference}` : 'pendente'}</td>
                  <td data-rotulo="Reservado">
                    {formatarQuantidade(l.reserved)} {l.unit}
                  </td>
                  <td data-rotulo="Enviado">{formatarQuantidade(l.shipped)}</td>
                  <td data-rotulo="Restante liberado">{formatarQuantidade(l.releasedRemainder)}</td>
                  <td data-rotulo="Retornado (físico)">{formatarQuantidade(l.returned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h4>Capacidade convertida</h4>
        <ul className="lista-criterios">
          {e.metrics.map((m) => (
            <li key={m.restrictionId}>
              {rotuloMetrica({ metric: m.metric, unit: m.unit, weightBase: null })}: reservado {q(m.reserved)} → expedido {q(m.shipped)} · liberado {q(m.released)}
            </li>
          ))}
        </ul>
        <h4>Unidades de carga enviadas</h4>
        <ul className="lista-criterios">
          {e.loadUnits.map((u) => (
            <li key={u.palletId}>
              {u.palletCode}
              {u.palletLeft ? ' · palete inteiro saiu (posição liberada)' : ' · saldo restante permanece no palete'}
              {u.boxes !== null ? ` · ${u.boxes} cx` : ''}
              {u.weightKg !== null ? ` · ${formatarQuantidade(u.weightKg)} kg ${u.weightBase ? ROTULOS_BASE_PESO[u.weightBase] : ''}` : ''}
              {u.volumeM3 !== null ? ` · ${formatarQuantidade(u.volumeM3)} m³` : ''}
              {u.measurementSource ? ` (fonte: ${u.measurementSource})` : ''}
            </li>
          ))}
        </ul>
        <h4>Documentos (versão {e.version})</h4>
        <ul className="lista-criterios">
          {e.documents.length === 0 && <li>Nenhum documento exigido.</li>}
          {e.documents.map((d) => (
            <li key={d.name}>
              {d.name}: {d.reference ?? ''}
              {d.attachmentId ? ' · anexo privado' : ''}
            </li>
          ))}
        </ul>
        {e.notes && <p>Observações: {e.notes}</p>}
        <p className="campo-ajuda">Eventos de estoque (baixa): {e.stockEventIds.length}. Uma expedição concluída não é desfeita: cancelar não repõe estoque.</p>
      </section>

      {e.corrections.length > 0 && (
        <section className="cartao">
          <h3>Correções de informação</h3>
          <ul className="lista-historico-claim">
            {e.corrections.map((c, i) => (
              <li key={`${c.at}-${String(i)}`}>
                {formatarDataHora(c.at)} · {c.by.name}: {c.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cartao" data-testid="retornos">
        <h3>Retornos ({e.returns.length})</h3>
        {e.returns.length === 0 && <p className="estado-vazio">Nenhum retorno registrado.</p>}
        <ul className="lista-historico-claim">
          {e.returns.map((r) => (
            <li key={r.id} data-testid="item-retorno">
              <strong>
                {r.code} · {ROTULOS_RETORNO[r.type]}
              </strong>{' '}
              · {formatarDataHora(r.receivedAt)} · {r.registeredBy.name}
              <p>
                {r.reason} · {ROTULOS_CONDICAO[r.condition]}
                {r.destinationPallet ? ` · palete ${r.destinationPallet.code}` : ''} · {r.lines.map((l) => `${l.sku} ${formatarQuantidade(l.quantity)} ${l.unit}`).join(', ') || 'sem quantidade'}
              </p>
              <p className="campo-ajuda">Próximo passo: {r.nextStep}</p>
              {r.destinationPallet && (
                <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'palete', id: r.destinationPallet?.id ?? '' }); }}>
                  Abrir palete {r.destinationPallet.code}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="acoes-linha">
        {pode('expedicao.retorno') && (
          <button type="button" className="botao-secundario" onClick={() => { setPainel('retorno'); }} data-testid="abrir-retorno">
            Registrar retorno físico
          </button>
        )}
        {pode('expedicao.confirmar') && (
          <button type="button" className="botao-secundario" onClick={() => { setPainel('correcao'); }} data-testid="abrir-correcao">
            Corrigir informação
          </button>
        )}
      </div>

      {painel !== null && (
        <form
          className="cartao painel-acao"
          data-testid={`painel-${painel}`}
          onSubmit={(ev) => {
            ev.preventDefault();
            if (painel === 'correcao') {
              void acoes
                .executar(`corrigir:${e.id}:${String(e.version)}`, 'POST', `${API_PREFIXO}/expedicoes/${e.id}/correcao`, { expectedVersion: e.version, reason: motivo, notes: observacao.trim() || null }, ExpedicaoDetalheSchema, 'Informação corrigida (nova versão; sem efeito físico).')
                .then((d) => {
                  if (d) {
                    setPainel(null);
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
            const corpo = {
              expectedVersion: e.version,
              type: tipo,
              receivedAt: instante,
              reason: motivo,
              condition: condicao,
              destinationPalletId: tipo === 'RECEBIMENTO_FISICO' ? destino || null : null,
              lines: linhasRetorno.map((x) => ({ expeditionLineId: x.l.id, quantity: decimal(x.texto) })),
              attachmentIds: anexosSel,
              notes: observacao.trim() || null,
            };
            void acoes.executar(`retorno:${e.id}:${JSON.stringify(corpo)}`, 'POST', `${API_PREFIXO}/expedicoes/${e.id}/retornos`, corpo, ExpedicaoDetalheSchema, tipo === 'RECEBIMENTO_FISICO' ? 'Retorno físico registrado: confira e reconcilie o palete de destino para a entrada no estoque.' : 'Aviso registrado (não repõe saldo).').then((d) => {
              if (d) {
                setPainel(null);
                aoGravar();
                recarregarTudo();
              }
            });
          }}
        >
          {painel === 'correcao' ? (
            <>
              <h3>Corrigir informação da expedição</h3>
              <p>Gera nova versão com motivo. Não altera estoque, capacidade nem as quantidades enviadas.</p>
              <label className="campo">
                <span className="campo-rotulo">Motivo</span>
                <input value={motivo} maxLength={500} onChange={(ev) => { setMotivo(ev.target.value); }} data-testid="motivo-correcao" />
              </label>
              <label className="campo">
                <span className="campo-rotulo">Observações corrigidas</span>
                <input value={observacao} maxLength={500} onChange={(ev) => { setObservacao(ev.target.value); }} />
              </label>
            </>
          ) : (
            <>
              <h3>Registrar retorno ligado a {e.code}</h3>
              <p className="campo-ajuda">
                Aviso documental ou recusa não repõe saldo. Recebimento físico comprovado (com evidência) vira declaração no palete de destino; a entrada no estoque acontece só pela conferência e reconciliação. A capacidade da janela original não volta.
              </p>
              <div className="formulario-grade">
                <label className="campo">
                  <span className="campo-rotulo">Tipo</span>
                  <select value={tipo} onChange={(ev) => { setTipo(ev.target.value as TipoRetorno); }} data-testid="tipo-retorno">
                    <option value="RECEBIMENTO_FISICO">{ROTULOS_RETORNO.RECEBIMENTO_FISICO}</option>
                    <option value="AVISO_DOCUMENTAL">{ROTULOS_RETORNO.AVISO_DOCUMENTAL}</option>
                  </select>
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Data/hora (Brasília)</span>
                  <input type="datetime-local" value={quando} onChange={(ev) => { setQuando(ev.target.value); }} />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Condição</span>
                  <select value={condicao} onChange={(ev) => { setCondicao(ev.target.value as CondicaoMaterial); }}>
                    {CONDICOES_MATERIAL.map((c) => (
                      <option key={c} value={c}>
                        {ROTULOS_CONDICAO[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Motivo</span>
                  <input value={motivo} maxLength={500} onChange={(ev) => { setMotivo(ev.target.value); }} data-testid="motivo-retorno" />
                </label>
              </div>
              <div className="tabela-rolagem">
                <table className="tabela-comparacao">
                  <thead>
                    <tr>
                      <th>Linha enviada</th>
                      <th>Enviado</th>
                      <th>Já retornado</th>
                      <th>Retornado agora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.lines
                      .filter((l) => l.shipped !== '0')
                      .map((l) => (
                        <tr key={l.id}>
                          <td data-rotulo="Linha enviada">
                            {l.palletCode} · {l.sku} {l.lot ? `lote ${l.lot}` : ''}
                          </td>
                          <td data-rotulo="Enviado">
                            {formatarQuantidade(l.shipped)} {l.unit}
                          </td>
                          <td data-rotulo="Já retornado">{formatarQuantidade(l.returned)}</td>
                          <td data-rotulo="Retornado agora">
                            <input className="campo-numero" value={qtds[l.id] ?? ''} inputMode="decimal" onChange={(ev) => { setQtds({ ...qtds, [l.id]: ev.target.value }); }} data-testid="quantidade-retorno" aria-label={`Quantidade retornada de ${l.sku}`} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {tipo === 'RECEBIMENTO_FISICO' && (
                <div className="formulario-grade">
                  <label className="campo">
                    <span className="campo-rotulo">Palete que recebeu (código; cadastrado e não conferido)</span>
                    <input value={codigoDestino} maxLength={40} onChange={(ev) => { setCodigoDestino(ev.target.value); setDestino(''); }} data-testid="codigo-destino-retorno" />
                  </label>
                  <label className="campo">
                    <span className="campo-rotulo">Escolha o palete</span>
                    <select value={destino} onChange={(ev) => { setDestino(ev.target.value); }} data-testid="destino-retorno">
                      <option value="">{candidatos.length === 0 ? 'Nenhum palete não conferido encontrado' : 'Escolha…'}</option>
                      {candidatos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} {p.positionCode ? `(${p.positionCode})` : '(sem posição)'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'novo-palete' }); }}>
                    Cadastrar palete para o recebimento
                  </button>
                </div>
              )}
              <fieldset className="campo">
                <legend className="campo-rotulo">Evidências (anexos privados da janela)</legend>
                {anexos.map((a) => (
                  <label key={a.id} className="campo--linha">
                    <input type="checkbox" checked={anexosSel.includes(a.id)} onChange={(ev) => { setAnexosSel(ev.target.checked ? [...anexosSel, a.id] : anexosSel.filter((x) => x !== a.id)); }} />
                    <span>{a.name}</span>
                  </label>
                ))}
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  disabled={!conectado}
                  data-testid="anexo-retorno"
                  onChange={(ev) => {
                    const arquivo = ev.target.files?.[0];
                    ev.target.value = '';
                    if (!arquivo) return;
                    setErroAnexo(null);
                    const assinatura = `anexo-retorno:${e.id}:${arquivo.name}:${String(arquivo.size)}`;
                    enviarArquivo(`${API_PREFIXO}/janelas/${e.window.id}/anexos`, arquivo, arquivo.name, AnexoJanelaSchema, chaves.para(assinatura)).then(
                      (a) => {
                        chaves.concluir(assinatura);
                        setAnexosSel([...anexosSel.filter((x) => x !== a.id), a.id]);
                        janela.recarregar();
                      },
                      (erro: unknown) => {
                        chaves.concluir(assinatura, erro);
                        setErroAnexo(mensagemDeFalha(erro));
                      },
                    );
                  }}
                />
                {erroAnexo && <span className="campo-erro">{erroAnexo}</span>}
              </fieldset>
              <label className="campo">
                <span className="campo-rotulo">Observações</span>
                <input value={observacao} maxLength={500} onChange={(ev) => { setObservacao(ev.target.value); }} />
              </label>
            </>
          )}
          <div className="acoes-linha">
            <button type="submit" className="botao-primario" disabled={ocupado || motivo.trim().length < 3} data-testid={`enviar-${painel}`}>
              {acoes.enviando !== null ? 'Enviando…' : painel === 'correcao' ? 'Registrar correção' : 'Registrar retorno'}
            </button>
            <button type="button" className="botao-link" onClick={() => { setPainel(null); }}>
              Voltar
            </button>
          </div>
        </form>
      )}
      <MensagemAcao mensagem={acoes.mensagem} testId="mensagem-acao-expedicao" />
    </Pagina>
  );
}
