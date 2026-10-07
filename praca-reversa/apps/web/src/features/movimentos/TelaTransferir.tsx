import {
  API_PREFIXO,
  ListaPaletesSchema,
  PaleteDetalheSchema,
  ResultadoTransferenciaSchema,
  compararQuantidades,
  extrairIdPalete,
  type ItemSaldo,
  type PaleteDetalhe,
  type ResultadoTransferencia,
  type Sessao,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { enviarJson } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeVoltar } from '../../components/Icones';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { ROTULOS_CONDICAO, ROTULOS_CONFERENCIA, ROTULOS_LIBERACAO } from '../paletes/estados';
import { textoOrigem } from '../conferencia/rotulos';
import { AvisoMovimento, SemConexaoMovimento } from './comum';
import { useEnvio, useUltimo } from './use-envio';
import { MOTIVOS_SUGERIDOS, SITUACAO_CONTEUDO, disponivel, normalizarDigitado, previaSaldo, problemaQuantidade, type Aviso } from './regras';
import { AjudaTarefa } from '../ajuda/AjudaTarefa';

interface Props {
  id: string;
  sessao: Sessao;
  aoNavegar: Navegar;
  aoGravar: () => void;
}

const q = (valor: string, unidade: string) => `${formatarQuantidade(valor)} ${unidade}`;

/** Item do saldo validado da origem, com o disponível (saldo − reservas). */
function OpcaoItem({ item, escolhido, aoEscolher }: { item: ItemSaldo; escolhido: boolean; aoEscolher: () => void }) {
  const livre = disponivel(item);
  const semLivre = compararQuantidades(livre, '0') <= 0;
  return (
    <li>
      <label className={`opcao-item${escolhido ? ' opcao-item--ativa' : ''}${semLivre ? ' opcao-item--bloqueada' : ''}`}>
        <input type="radio" name="item-transferencia" checked={escolhido} disabled={semLivre} onChange={aoEscolher} />
        <span className="opcao-item-corpo">
          <span className="opcao-item-titulo">
            <strong>{item.sku}</strong> {item.description}
          </span>
          <span className="opcao-item-dados">
            <span className={item.lot === null ? 'pendente' : undefined}>Lote {item.lot ?? 'pendente'}</span>
            <span className={item.originType === null ? 'pendente' : undefined}>{textoOrigem(item.originType, item.originReference)}</span>
            <span>{ROTULOS_CONDICAO[item.condition]}</span>
            <span>Unidade {item.unit}</span>
          </span>
          <span className="opcao-item-saldos">
            <span>Saldo validado {q(item.quantity, item.unit)}</span>
            <span>Reservado {q(item.reserved, item.unit)}</span>
            {compararQuantidades(item.claimLinked, '0') > 0 && <span>Vinculado a claim {q(item.claimLinked, item.unit)}</span>}
            <strong>Disponível {q(livre, item.unit)}</strong>
          </span>
          {item.lineage !== null && <span className="bloco-nota">Lote/origem pendentes: registro próprio, não é unido a outro pendente.</span>}
        </span>
      </label>
    </li>
  );
}

/**
 * Transferir produtos: parte do saldo validado de um segmento vai de um
 * palete para outro, preservando produto, lote, origem, condição e unidade.
 * Só a parte livre se move (disponível = saldo validado − reservas ativas);
 * declarado ou apenas observado não é transferível.
 */
export function TelaTransferir({ id, sessao, aoNavegar, aoGravar }: Props) {
  const [versao, setVersao] = useState(0);
  const cargaOrigem = useRecurso(`${API_PREFIXO}/paletes/${id}`, PaleteDetalheSchema, versao);
  const origem: PaleteDetalhe | null = useUltimo(cargaOrigem.carga);
  const [segmentoId, setSegmentoId] = useState<string | null>(null);
  const [quantidade, setQuantidade] = useState('');
  const [busca, setBusca] = useState('');
  const [destinoId, setDestinoId] = useState<string | null>(null);
  const termo = busca.trim();
  const idLido = extrairIdPalete(termo);
  const cargaBusca = useRecurso(
    destinoId === null && idLido === null && termo.length >= 2 ? `${API_PREFIXO}/paletes?texto=${encodeURIComponent(termo)}&limite=20` : null,
    ListaPaletesSchema,
  );
  const cargaDestino = useRecurso(destinoId === null ? null : `${API_PREFIXO}/paletes/${destinoId}`, PaleteDetalheSchema, versao);
  const destinoLido = useUltimo(cargaDestino.carga);
  const destino = destinoLido?.id === destinoId ? destinoLido : null;
  const [motivo, setMotivo] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [resultado, setResultado] = useState<ResultadoTransferencia | null>(null);
  const envio = useEnvio();

  const voltar = () => {
    aoNavegar({ tipo: 'palete', id });
  };
  const mudou = () => {
    setConfirmado(false);
    envio.descartar();
  };

  if (origem === null) {
    const erro = cargaOrigem.carga?.estado === 'erro' ? cargaOrigem.carga : null;
    return (
      <main className="principal principal--pagina" data-testid="tela-transferir">
        <div className="pagina-conteudo">
          {erro ? (
            <div className="estado-erro estado-tela" role="alert">
              <h2>{erro.status === 404 ? 'Palete não encontrado' : 'Não foi possível carregar o palete'}</h2>
              <p>{erro.status === 404 ? 'Ele não existe no escopo ativo ou você não tem acesso a ele.' : erro.mensagem}</p>
              <div className="acoes-linha">
                <button type="button" className="botao-primario" onClick={() => { setVersao((v) => v + 1); }}>
                  <IconeAtualizar />
                  Tentar novamente
                </button>
                <button type="button" className="botao-secundario" onClick={() => { aoNavegar({ tipo: 'praca' }); }}>
                  Voltar ao mapa
                </button>
              </div>
            </div>
          ) : (
            <p className="estado-carregando" aria-busy="true">
              Carregando palete…
            </p>
          )}
        </div>
      </main>
    );
  }

  if (resultado !== null) {
    const e = resultado.event;
    return (
      <main className="principal principal--pagina" data-testid="tela-transferir">
        <div className="pagina-conteudo">
          <section className="cartao cartao-sucesso" role="status" data-testid="transferencia-confirmada">
            <h2>Transferência registrada</h2>
            <p>
              Registrada em {formatarDataHora(e.at)} (horário de Brasília) por {e.author?.name ?? '—'}: {e.reason}.
            </p>
            <ul className="lista-historico">
              {e.lines.map((l) => (
                <li key={`${l.pallet.id}:${l.segmentId}`}>
                  <strong>{l.pallet.code}</strong>: {l.sku} · lote {l.lot ?? 'pendente'} · {textoOrigem(l.originType, l.originReference)} · {ROTULOS_CONDICAO[l.condition]} —{' '}
                  {q(l.before, l.unit)} → <strong>{q(l.after, l.unit)}</strong>
                </li>
              ))}
            </ul>
            <ul className="notas-reconciliacao">
              {resultado.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <div className="acoes-linha">
              <button type="button" className="botao-primario" onClick={voltar}>
                Ver palete {resultado.source.code}
              </button>
              <button type="button" className="botao-secundario" onClick={() => { aoNavegar({ tipo: 'palete', id: resultado.destination.id }); }}>
                Ver palete {resultado.destination.code}
              </button>
              <button type="button" className="botao-secundario" onClick={() => { aoNavegar({ tipo: 'historico', id }); }}>
                Ver histórico
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const itens = origem.currentItems ?? [];
  const item = itens.find((i) => i.segmentId === segmentoId) ?? null;
  const livre = item === null ? '0' : disponivel(item);
  const problema = item === null ? null : problemaQuantidade(quantidade, item.unit, livre);
  const bloqueioOrigem =
    origem.archived !== null
      ? 'Cadastro arquivado: não transfere conteúdo.'
      : origem.activeCountId !== null
        ? 'Há conferência em andamento neste palete: transferências ficam bloqueadas até ela ser concluída ou cancelada.'
        : null;
  const bloqueioDestino =
    destino === null
      ? null
      : destino.id === origem.id
        ? 'Origem e destino precisam ser paletes diferentes.'
        : destino.archived !== null
          ? `O palete ${destino.code} está arquivado e não recebe conteúdo.`
          : destino.activeCountId !== null
            ? `O palete ${destino.code} está em conferência: transferências para ele ficam bloqueadas.`
            : destino.releaseState === 'LIBERADO' && origem.releaseState !== 'LIBERADO'
              ? `O palete ${destino.code} está liberado e o material de ${origem.code} não: a transferência o liberaria para expedição. Escolha um destino não liberado.`
              : null;
  const motivoValido = motivo.trim().length >= 3;
  const quantidadeOk = item !== null && quantidade.trim() !== '' && problema === null;
  const previa = item !== null && destino !== null && quantidadeOk ? previaSaldo(item.segmentId, quantidade, { codigo: origem.code, itens: origem.currentItems }, { codigo: destino.code, itens: destino.currentItems }) : null;
  const pronto = previa !== null && bloqueioOrigem === null && bloqueioDestino === null && motivoValido && confirmado && envio.conectado && !envio.enviando;
  const resultadosBusca = cargaBusca.carga?.estado === 'pronto' ? cargaBusca.carga.dados.items.filter((p) => p.id !== origem.id) : [];

  function confirmar() {
    if (origem === null || destino === null || item === null) return;
    const corpo = {
      sourcePalletId: origem.id,
      destinationPalletId: destino.id,
      segmentId: item.segmentId,
      quantity: normalizarDigitado(quantidade),
      expectedSourceVersion: origem.version,
      expectedDestinationVersion: destino.version,
      reason: motivo.trim(),
    };
    setAviso(null);
    void envio.enviar(
      `transferir:${JSON.stringify(corpo)}`,
      (chave) => enviarJson('POST', `${API_PREFIXO}/transferencias`, ResultadoTransferenciaSchema, { corpo, idempotencia: chave }),
      (r) => {
        if (r.ok) {
          setResultado(r.dados);
          aoGravar();
          return;
        }
        setAviso(r.aviso);
        if (!r.aviso.incerto) {
          setConfirmado(false);
          setVersao((v) => v + 1);
        }
      },
    );
  }

  return (
    <main className="principal principal--pagina" data-testid="tela-transferir">
      <div className="pagina-conteudo tela-movimento">
        <header className="pagina-topo">
          <button type="button" className="botao-voltar" onClick={voltar}>
            <IconeVoltar />
            Palete {origem.code}
          </button>
          <h2>Transferir produtos de {origem.code}</h2>
          <p className="bloco-nota">
            Move saldo validado entre paletes: o total em estoque não muda e nada é expedido. Material avariado ou bloqueado continua como está.
          </p>
        </header>
        <AjudaTarefa tarefa="mover" />

        {bloqueioOrigem !== null && (
          <p className="mensagem-conflito" role="alert" data-testid="transferir-bloqueado">
            {bloqueioOrigem}
          </p>
        )}

        <section className="cartao" aria-labelledby="transferir-item">
          <h3 id="transferir-item">1. Item (segmento) do palete {origem.code}</h3>
          {origem.currentItems === null ? (
            <p className="aviso-conteudo aviso-conteudo--desconhecido" data-testid="sem-saldo-transferivel">
              Este palete não tem saldo validado. Quantidade declarada em documento ou apenas observada em conferência não é transferível: conclua uma
              conferência completa e a reconciliação.
            </p>
          ) : itens.length === 0 ? (
            <p className="sem-itens">Nenhum saldo validado restante neste palete.</p>
          ) : (
            <ul className="lista-opcoes-item" aria-label="Itens com saldo validado">
              {itens.map((i) => (
                <OpcaoItem
                  key={i.segmentId}
                  item={i}
                  escolhido={i.segmentId === segmentoId}
                  aoEscolher={() => {
                    setSegmentoId(i.segmentId);
                    mudou();
                  }}
                />
              ))}
            </ul>
          )}
          {origem.countState !== 'RECONCILIADO' && origem.currentItems !== null && (
            <p className="bloco-nota">
              Palete {SITUACAO_CONTEUDO[origem.countState]}: a lista mostra só o saldo validado conhecido (recebido por transferência).
            </p>
          )}
        </section>

        {item !== null && bloqueioOrigem === null && (
          <section className="cartao" aria-labelledby="transferir-quantidade">
            <h3 id="transferir-quantidade">2. Quantidade</h3>
            <label className="campo campo--curto">
              <span className="campo-rotulo">
                Quantidade a transferir ({item.unit}) — disponível {q(livre, item.unit)}
              </span>
              <input
                value={quantidade}
                inputMode="decimal"
                autoComplete="off"
                onChange={(e) => {
                  setQuantidade(e.target.value);
                  mudou();
                }}
                aria-invalid={problema !== null}
                data-testid="quantidade-transferir"
              />
            </label>
            {problema !== null && quantidade.trim() !== '' && (
              <p className="campo-erro" role="alert" data-testid="erro-quantidade">
                {problema}
              </p>
            )}
            {compararQuantidades(item.reserved, '0') > 0 && (
              <p className="bloco-nota">
                {q(item.reserved, item.unit)} reservado(s) não se movem: só a parte livre pode ser transferida. Realocar reserva exige tratativa explícita.
              </p>
            )}
            {compararQuantidades(item.claimLinked, '0') > 0 && (
              <p className="bloco-nota" data-testid="nota-vinculo-claim">
                {q(item.claimLinked, item.unit)} vinculado(s) a recuperação de claim: sai primeiro a parte sem vínculo; se a quantidade passar dela, o vínculo acompanha o
                material para o destino (mesma identidade, nenhuma cota nova).
              </p>
            )}
          </section>
        )}

        {item !== null && bloqueioOrigem === null && (
          <section className="cartao" aria-labelledby="transferir-destino">
            <h3 id="transferir-destino">3. Palete de destino</h3>
            {destinoId === null ? (
              <>
                <label className="campo">
                  <span className="campo-rotulo">Código do palete de destino, ou leia o QR da etiqueta</span>
                  <input
                    value={busca}
                    autoComplete="off"
                    autoCapitalize="characters"
                    onChange={(e) => { setBusca(e.target.value); }}
                    data-testid="busca-destino"
                  />
                </label>
                {idLido !== null && (
                  <button type="button" className="botao-secundario" onClick={() => { setDestinoId(idLido); mudou(); }}>
                    Usar o palete do QR lido
                  </button>
                )}
                {cargaBusca.carga?.estado === 'erro' && <p className="estado-erro">{cargaBusca.carga.mensagem}</p>}
                {resultadosBusca.length > 0 && (
                  <ul className="lista-escolha lista-escolha--paletes" aria-label="Paletes encontrados">
                    {resultadosBusca.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="escolha"
                          onClick={() => {
                            setDestinoId(p.id);
                            mudou();
                          }}
                        >
                          <strong>{p.code}</strong>
                          <span>
                            {p.positionCode ?? 'sem posição'} · {ROTULOS_CONFERENCIA[p.countState].texto}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {cargaBusca.carga?.estado === 'pronto' && resultadosBusca.length === 0 && <p className="sem-itens">Nenhum outro palete encontrado.</p>}
              </>
            ) : destino === null ? (
              cargaDestino.carga?.estado === 'erro' ? (
                <div className="estado-erro" role="alert">
                  <p>{cargaDestino.carga.status === 404 ? 'Palete de destino não encontrado neste escopo.' : cargaDestino.carga.mensagem}</p>
                  <button type="button" className="botao-link" onClick={() => { setDestinoId(null); }}>
                    Escolher outro destino
                  </button>
                </div>
              ) : (
                <p className="estado-carregando">Carregando palete de destino…</p>
              )
            ) : (
              <div className="destino-escolhido" data-testid="destino-escolhido">
                <p>
                  <strong>{destino.code}</strong> · {destino.positionCode ?? 'localização pendente'} · {ROTULOS_CONFERENCIA[destino.countState].texto}
                </p>
                <button
                  type="button"
                  className="botao-link"
                  onClick={() => {
                    setDestinoId(null);
                    mudou();
                  }}
                >
                  Trocar destino
                </button>
                {bloqueioDestino !== null && (
                  <p className="mensagem-conflito" role="alert">
                    {bloqueioDestino}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {previa !== null && item !== null && destino !== null && bloqueioDestino === null && (
          <section className="cartao previa-movimento" aria-labelledby="transferir-previa" data-testid="previa-transferencia">
            <h3 id="transferir-previa">4. Revise antes de confirmar</h3>
            <p>
              <strong>{item.sku}</strong> {item.description} · lote {item.lot ?? 'pendente'} · {textoOrigem(item.originType, item.originReference)} ·{' '}
              {ROTULOS_CONDICAO[item.condition]} · {formatarQuantidade(normalizarDigitado(quantidade))} {item.unit}
            </p>
            <div className="tabela-rolagem">
              <table className="tabela-comparacao tabela-previa">
                <thead>
                  <tr>
                    <th scope="col">Palete</th>
                    <th scope="col">Saldo antes</th>
                    <th scope="col">Saldo depois</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.map((l) => (
                    <tr key={l.papel}>
                      <th scope="row" data-rotulo="Palete">
                        {l.paleteCodigo} ({l.papel === 'sai' ? 'origem' : 'destino'})
                      </th>
                      <td data-rotulo="Saldo antes">{q(l.antes, item.unit)}</td>
                      <td data-rotulo="Saldo depois">
                        <strong>{q(l.depois, item.unit)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {destino.releaseState !== origem.releaseState && (
              <p className="bloco-nota">O material passa a seguir a liberação do palete {destino.code} ({ROTULOS_LIBERACAO[destino.releaseState].toLowerCase()}).</p>
            )}
            {destino.countState !== 'RECONCILIADO' && (
              <p className="bloco-nota">
                O palete {destino.code} continua {SITUACAO_CONTEUDO[destino.countState]}: só este item passa a ter saldo validado conhecido;
                o restante do conteúdo segue pendente.
              </p>
            )}
            <label className="campo">
              <span className="campo-rotulo">Motivo da transferência</span>
              <input
                value={motivo}
                maxLength={500}
                list="motivos-transferir"
                onChange={(e) => {
                  setMotivo(e.target.value);
                  mudou();
                }}
                data-testid="motivo-transferir"
              />
              <datalist id="motivos-transferir">
                {MOTIVOS_SUGERIDOS.transferir.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <p className="bloco-nota">Responsável: {sessao.user.name}.</p>
            <label className="opcao opcao--destaque">
              <input type="checkbox" checked={confirmado} onChange={(e) => { setConfirmado(e.target.checked); }} data-testid="confirmar-transferencia-check" />
              Confirmo a transferência de {formatarQuantidade(normalizarDigitado(quantidade))} {item.unit} de {origem.code} para {destino.code}.
            </label>
            {!envio.conectado && <SemConexaoMovimento />}
            <div className="acoes-linha">
              <button type="button" className="botao-primario" disabled={!pronto} onClick={confirmar} data-testid="confirmar-transferencia">
                {envio.enviando ? 'Enviando…' : 'Confirmar transferência'}
              </button>
              <button type="button" className="botao-link" onClick={voltar}>
                Cancelar
              </button>
            </div>
          </section>
        )}

        <AvisoMovimento aviso={aviso} podeReenviar={envio.temPendente && envio.conectado} enviando={envio.enviando} aoReenviar={envio.reenviar} testId="aviso-transferir" />
      </div>
    </main>
  );
}
